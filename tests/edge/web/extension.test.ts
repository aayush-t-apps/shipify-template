// The web chat stays an extension (ADR 0036, "The extension and the core"): only app.ts mounts it,
// its form keeps step with GitHub's Repeat form, and its page stays light: plain files, no
// libraries, no inline script, under 42 KB as sent; Mermaid draws diagrams only in the sandboxed
// frame.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { agentsSeen, parseUse } from "../../../cli/contracts/index.ts";
import {
  REPEAT_KINDS,
  REPEAT_WHEN,
  repeatModels,
  repeatProblems,
} from "../../../edge/src/web/forms.ts";
import { BASE, MERMAID } from "../../../edge/src/web/routes.ts";
import { ROOT } from "../../helpers.ts";

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
}

describe("the extension", () => {
  it("only app.ts imports it: the core, the door and the watch don't know it's there", () => {
    const importers = [...files("edge/src"), ...files("cli")]
      .filter((f) => f.endsWith(".ts") && !f.startsWith("edge/src/web/"))
      .filter((f) => /from\s+["'][./]*(?:src\/)?web\//.test(readFileSync(join(ROOT, f), "utf8")));
    expect(importers).toEqual(["edge/src/app.ts"]);
  });
});

describe("the New repeat form", () => {
  const form = parse(readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/4-repeat.yml"), "utf8")) as {
    body: {
      id: string;
      type: string;
      attributes: { label: string; options?: string[]; description?: string };
    }[];
  };
  const field = (id: string) => form.body.find((b) => b.id === id)?.attributes;

  it("has GitHub's Repeat form's fields, choices and examples", () => {
    expect(form.body.map((b) => b.attributes.label)).toEqual([
      "What",
      "When",
      "Kind",
      "Check",
      "Model",
    ]);
    expect(field("kind")?.options).toEqual([...REPEAT_KINDS]);
    // Its Model is words, as a `use` line says them: nothing to keep in step.
    expect(form.body.find((b) => b.id === "model")?.type).toBe("input");
    // The page's choices are the agents as the file makes them, each a pick the core takes.
    const choices = repeatModels();
    const all = Object.fromEntries(agentsSeen());
    for (const c of choices.slice(1))
      expect(parseUse(c.words, all, { agent: "claude" }, "claude"), c.words).toBeDefined();
    expect(choices.find((c) => c.words === "pi-vercel")?.label).toBe("Pi · Vercel");
    for (const example of REPEAT_WHEN.split(", "))
      expect(field("when")?.description).toContain(example);
  });

  it("checks the answers as the core will", () => {
    const ok = { what: "x", when: "every day at 09:00", kind: REPEAT_KINDS[0] };
    expect(repeatProblems(ok)).toEqual([]);
    expect(repeatProblems({ ...ok, when: "every 5 minutes" }).join(" ")).toContain("too often");
    expect(repeatProblems({ ...ok, kind: REPEAT_KINDS[1], when: "every 30 minutes" })).toHaveLength(
      1,
    );
    expect(repeatProblems({ ...ok, kind: REPEAT_KINDS[2] }).join(" ")).toContain("Name the check");
    expect(repeatProblems({ ...ok, what: " ", kind: "?" })).toHaveLength(2);
  });
});

/** A small fake DOM, enough for the page's own h() and a part drawn with it. */
class El {
  children: El[] = [];
  attrs: Record<string, string> = {};
  on: Record<string, (e: unknown) => void> = {};
  style: Record<string, string> = {};
  className = "";
  disabled = false;
  parent?: El;
  text?: string;
  constructor(public tag: string) {}
  setAttribute(k: string, v: unknown) {
    this.attrs[k] = String(v);
  }
  addEventListener(k: string, f: (e: unknown) => void) {
    this.on[k] = f;
  }
  append(...c: (El | string)[]) {
    for (const x of c) {
      const n = typeof x === "string" ? Object.assign(new El("#text"), { text: x }) : x;
      n.parent = this;
      this.children.push(n);
    }
  }
  get open() {
    return "open" in this.attrs;
  }
  get lastChild() {
    return this.children.at(-1);
  }
  get textContent(): string {
    return this.text ?? this.children.map((c) => c.textContent).join("");
  }
  set textContent(t: string) {
    this.text = t;
    this.children = [];
  }
  after(n: El) {
    const p = this.parent as El;
    p.children.splice(p.children.indexOf(this) + 1, 0, n);
    n.parent = p;
  }
  replaceWith(n: El) {
    const p = this.parent as El;
    p.children[p.children.indexOf(this)] = n;
    n.parent = p;
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelector(s: string) {
    return this.all().find((e) => e.className.split(" ").includes(s.slice(1))) ?? null;
  }
  click() {
    if (!this.disabled) this.on.click?.({ currentTarget: this });
  }
  replaceChildren(...c: (El | string)[]) {
    this.children = [];
    this.text = undefined;
    this.append(...c);
  }
  get classList() {
    const l = () => this.className.split(" ").filter(Boolean);
    return {
      add: (c: string) => {
        this.className = [...l(), c].join(" ");
      },
      remove: (c: string) => {
        this.className = l()
          .filter((x) => x !== c)
          .join(" ");
      },
    };
  }
  focus() {}
  scrollIntoView() {}
  isConnected = true;
}

/** The fake DOM as the page's globals, while `f` runs. */
async function inFakeDom<T>(f: (make: (tag: string) => El) => Promise<T>) {
  const make = (tag: string) => new El(tag);
  vi.stubGlobal("document", {
    createElement: make,
    createElementNS: (_: string, t: string) => make(t),
    head: make("head"),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("confirm", () => true);
  try {
    return await f(make);
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("the page", () => {
  const dir = "edge/public/admin/chat";
  const have = existsSync(join(ROOT, dir));

  // 40 KB as planned, then 44 with diagrams, pictures full size and earlier messages, then 64 with
  // the designed stylesheet and icons (ADR 0036), then 68 with PRs to review, Reopen, older tasks,
  // the ticked model menu and the box's health check (task #188), then 72 with filters, an effort
  // chip of its own and the run shown in its thread as soon as the list knows, then 76 with Stop,
  // Starting… and buttons that wait while they send, with a Retry, then 80 with the send button that
  // stops a run and a run let go once it has answered, then 82 with More models… (/models), then
  // 88 with the model picker (agents as tabs, a search, the effort), then 104 with the redesign
  // (ADR 0039: three panes, the task's info, the picker with each model's facts, Status & setup as
  // a summary and a table). Since 2026-10-07 it's measured as a phone gets it, compressed (gzip, as
  // Cloudflare sends it): 40 KB, the page about 36 KB then (106 KB as written, comments kept), then
  // 41 with the gateways row of the model picker (task: Vercel's gateway; the page was at 40.0), then
  // 42 with a run that stays (ADR 0057; the page was at 41.0). A library or a picture slipped in still
  // fails it.
  // Its service worker (ADR 0050) loads on its own after the page, then is a 304: 2 KB of its own.
  // The notification's icon and badge (PNG, made from icon.svg) are fetched by the phone when one
  // shows, never by the page, so they live outside the sign-in (/note/): 8 KB of their own.
  // Parts loaded the first time they're needed (ADR 0065), each with a budget of its own, so the
  // page you open every day doesn't carry them: workspace.js and .css (a project's page, the doc
  // pane, Files, Ctrl+K; its tab row went in ADR 0069: 7.7 KB to 6.7), 9 KB; setup.js (Status &
  // setup), 5 KB. With Setup and Files moved out, and the list's projects in, the page went from
  // 41.8 KB to 40.1. Sub-tasks (ADR 0066): the list's bar, fold and Waiting took the page to 40.7;
  // the Plan card (2.4 KB) did not fit in workspace.js's room (it took it to 8.9 of 9), so it is
  // plan.js and .css, loaded only for a task with parts: 3 KB. The sweep of ADR 0069 (find in a
  // chat, Copy on code, drafts kept, clocks that tick, a copy kept a thread a key) took the page to
  // 42.0: New repeat (repeat.js, 3 KB) and the model picker (pick.js, loaded by compose.js when its
  // chip opens, 4 KB) went out, to 39.4. Files in R2 with drag and drop anywhere (ADR 0069, part
  // 1) took the page to 40.4, and workspace.js (Files by chat, Delete, Share) to 7.2. Export (a
  // project's zip, built in the browser with no library) is export.js, loaded on first use: 3 KB.
  // Projects you make, the Desk and the Library (ADR 0069, parts 4 to 8) took the page to 41.7 KB
  // with the list's projects, New chat here and the Desk's hook in it, once Repeats went to
  // repeat.js (4 KB with its form) and the Library to desk.js: project.js (a project's page, Move
  // to project), 3 KB; desk.js (the Desk, Jot, New project, the Library), 4 KB. Export reading each
  // thread whole (a page of 100 at a time), a big zip's size said first, safe names and a zip
  // stored where the browser can't deflate took export.js from 2.9 KB to 3.6: 4 KB. The Desk is
  // the first screen, a phone's too, so desk.js and .css load with the page and count in it
  // (FIRST): 44.5 KB with them, 45.1 with the list read while the Desk shows and a project's box
  // sending as every box does. To 41.5: the Library (library.js) and New project's form (to
  // project.js) went out of desk.js (2.9 KB to 1.8; with its .css, 3 KB); the picker's styles went
  // to pick.css, with pick.js (4.6 KB: 5), Status & setup's to setup.css, with setup.js and the
  // switch for notifications (5.1 KB: 6), New repeat's to repeat.css (3.9 of 4); Find in this chat
  // (find.js), diagrams (draw.js) and a file you add, sent up and a photo made smaller (attach.js,
  // by compose.js), load the first time they're used: 2 KB each, as library.js.
  const LAZY = {
    workspace: 9,
    setup: 6,
    plan: 3,
    repeat: 4,
    pick: 5,
    export: 4,
    project: 3,
    desk: 3,
    library: 2,
    find: 2,
    draw: 2,
    attach: 2,
  };
  /** Parts loaded as the page is, on the first screen: they count in its 42 KB too. */
  const FIRST = ["desk"];
  it.skipIf(!have)("is plain files of its own, under 42 KB as sent, its worker under 2 KB", () => {
    const list = files(dir);
    for (const want of ["index.html", "app.js", "compose.js", "app.css", "manifest.json", "sw.js"])
      expect(list).toContain(`${dir}/${want}`);
    const gz = (f: string) => gzipSync(readFileSync(join(ROOT, f))).length;
    const worker = `${dir}/sw.js`;
    const part = (f: string) => /^(\w+)\./.exec(f.slice(dir.length + 1))?.[1] ?? "";
    // The Desk is the first screen (ADR 0069): desk.js and .css load with the page, so they count.
    const lazy = (f: string) => part(f) in LAZY && !FIRST.includes(part(f));
    const sent = list.filter((f) => f !== worker && !lazy(f)).reduce((n, f) => n + gz(f), 0);
    expect(sent).toBeLessThan(42 * 1024);
    for (const [k, kb] of Object.entries(LAZY)) {
      const mine = list.filter((f) => part(f) === k);
      expect(mine.length, k).toBeGreaterThan(0);
      expect(
        mine.reduce((n, f) => n + gz(f), 0),
        k,
      ).toBeLessThan(kb * 1024);
    }
    expect(list.filter((f) => f.endsWith(".png"))).toEqual([]);
    const note = files("edge/public/note");
    expect(note.sort()).toEqual(["edge/public/note/badge.png", "edge/public/note/icon.png"]);
    expect(note.reduce((n, f) => n + readFileSync(join(ROOT, f)).length, 0)).toBeLessThan(8 * 1024);
    expect(gz(worker)).toBeLessThan(2 * 1024);
  });

  it.skipIf(!have)("takes Android's shares inside its scope, files of any type", () => {
    const m = JSON.parse(readFileSync(join(ROOT, dir, "manifest.json"), "utf8"));
    expect(m.share_target).toMatchObject({
      action: `${BASE}/share`,
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files" }] },
    });
    expect(m.share_target.action.startsWith(m.scope)).toBe(true);
  });

  // The page names them only as it loads them: never in index.html, never imported at the top.
  it.skipIf(!have)("loads its parts only when they're needed (ADR 0065)", () => {
    const html = readFileSync(join(ROOT, dir, "index.html"), "utf8");
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    for (const k of Object.keys(LAZY)) {
      expect(html, k).not.toContain(`${k}.`);
      expect(js, k).not.toMatch(new RegExp(`^import[^;]*${k}`, "m"));
    }
    expect(js).toContain("import(`./${k}.js`)");
    expect(js).toContain('lazy("workspace")');
    expect(js).toContain('lazy("setup")');
    expect(js).toContain('lazy("plan")');
    expect(js).toContain('lazy("repeat")');
    expect(js).toContain('lazy("project")');
    expect(js).toContain('lazy("desk")');
    expect(js).toContain('lazy("library")');
    expect(js).toContain('lazy("find")');
    expect(js).toContain('lazy("draw")');
    // The model picker and a file's upload, by the box they're for: never imported at its top
    // either.
    const co = readFileSync(join(ROOT, dir, "compose.js"), "utf8");
    expect(co).toContain('import("./pick.js")');
    expect(co).toContain('import("./attach.js")');
    expect(co).not.toMatch(/^import[^;]*(?:pick|attach)/m);
    // A part with its own stylesheet asks for it as it loads, and is ready once it's in.
    for (const k of ["workspace", "plan", "project", "desk", "setup", "repeat", "pick"]) {
      expect(files(dir), k).toContain(`${dir}/${k}.css`);
      expect(readFileSync(join(ROOT, dir, `${k}.js`), "utf8"), k).toContain(
        `rel: "stylesheet", href: "${k}.css", onload: r, onerror: r`,
      );
    }
    expect(co).toContain("p.init().then(() => p.picker(");
    // Each takes what the page lends it, and nothing else of the page's.
    for (const k of Object.keys(LAZY)) {
      const part = readFileSync(join(ROOT, dir, `${k}.js`), "utf8");
      expect(part, k).toMatch(/export (?:function|const) init\b/);
      const from = [...part.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]);
      expect(from, k).toEqual(["./compose.js"]);
    }
    // What app.js asks of the workspace, it has.
    const ws = readFileSync(join(ROOT, dir, "workspace.js"), "utf8");
    for (const f of ["redraw", "project", "files", "doc", "quick"])
      expect(ws, f).toMatch(new RegExp(`export (?:async )?function ${f}\\(`));
    // And of ADR 0069's: a project's page, the Desk, the Library, Repeats, Export, Find in this
    // chat, diagrams, a file's upload, notifications on or off.
    const has = {
      project: ["card", "move", "newProject"],
      desk: ["desk", "redraw"],
      library: ["library"],
      find: ["find"],
      draw: ["draw"],
      attach: ["upload", "shrink"],
      setup: ["notify"],
    };
    for (const [k, l] of Object.entries({ ...has, repeat: ["repeats", "repeatForm"] }))
      for (const f of l)
        expect(readFileSync(join(ROOT, dir, `${k}.js`), "utf8"), `${k} ${f}`).toMatch(
          new RegExp(`export (?:async )?function ${f}\\(`),
        );
    expect(readFileSync(join(ROOT, dir, "export.js"), "utf8")).toMatch(
      /export async function offer\(/,
    );
  });

  // ADR 0069: no tab row, no Alt+1…9; the project's name in a thread's header opens its page, and
  // Ctrl+K with nothing typed lists the open chats seen last, newest first. Saved tabs are deleted.
  it.skipIf(!have)(
    "has no project tab row: the header's link and Ctrl+K's recent chats instead",
    () => {
      const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
      const ws = readFileSync(join(ROOT, dir, "workspace.js"), "utf8");
      const css = readFileSync(join(ROOT, dir, "workspace.css"), "utf8");
      expect(js).not.toMatch(/altKey|\.strip\(|\.pick\(|tabs: \{\}/);
      expect(js).toContain("delete S.tabs;");
      expect(js).toMatch(/href: `#\/p\/\$\{encodeURIComponent\(k\)\}`/);
      expect(ws).not.toMatch(/\btabs?Of\b|\.wtabs|S\.tabs|MOST/);
      expect(css).not.toContain(".wt");
      expect(ws).toMatch(/if \(!w\) \{[\s\S]{0,200}A\.S\.seen[\s\S]{0,200}\.reverse\(\)/);
      expect(ws).toContain('t.state !== "closed"');
    },
  );

  // A split task's Plan card (ADR 0066), drawn in a small fake DOM (the page's own h() makes it):
  // its buttons send your words, as a reply's do, and only where they make sense.
  it.skipIf(!have)(
    "the Plan card: Start on a ready part, Start all ready, Stop; no tabs (ADR 0069)",
    async () => {
      const make = (tag: string) => new El(tag);
      vi.stubGlobal("document", {
        createElement: make,
        createElementNS: (_: string, t: string) => make(t),
        head: make("head"),
      });
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      vi.stubGlobal("confirm", () => true);
      try {
        const { h } = await import(join(ROOT, dir, "compose.js"));
        const m = await import(join(ROOT, dir, "plan.js"));
        const said: [number, string][] = [];
        const init = m.init({
          say: (n: number, w: string) => said.push([n, w]),
          projOf: (t: { title: string }) => /^(\w+):/.exec(t.title)?.[1] ?? "",
          bare: (s: string) => s.replace(/^\w+:\s*/, ""),
          named: (s: string) => s,
          to: (n: number, t: string) => h("a", { href: `#/t/${n}` }, t),
          ext: (u: string, t: string, c = "") => h(`a${c}`, { href: u }, t),
          meta: (...a: unknown[]) => h("small", a.filter(Boolean).join(" · ")),
          btn: (l: unknown, f: unknown, c = "") => h(`button${c}`, { onclick: f }, l),
        });
        (document.head as unknown as El).children.at(-1)?.on.load?.({});
        await init;
        const url = "https://github.com/o/shipify/issues/1";
        const plan = [
          { n: 2, title: "shipify: the kernel", state: "closed" },
          { n: 3, title: "links: use it", state: "waiting", after: [4] },
          {
            n: 4,
            title: "shipify: the chat",
            state: "open",
            ready: true,
            pr: { n: 40, url: "https://github.com/o/shipify/pull/40" },
          },
          { n: 5, title: "notes: try it", state: "closed", dropped: true },
        ];
        const thread = (more = {}) => ({
          writable: true,
          task: { n: 1, title: "shipify: sub-tasks", url, open: true, plan, ...more },
        });
        const head = make("header");
        const box = make("section");
        box.append(head);
        const v = { box, head };
        m.plan(v, thread());
        const card = box.children[1] as El;
        expect(card.className).toBe("plan");
        expect(card.open).toBe(true);
        const buttons = () => (box.children[1] as El).all().filter((e) => e.tag === "button");
        // Not started: Start on the ready part, Start all ready; no Stop, no tabs (ADR 0069).
        expect(buttons().map((b) => b.textContent)).toEqual(["Start all ready", "Start"]);
        const text = card.textContent;
        expect(text).toContain("2/4 closed");
        expect(text).toContain("#3 · links · Waiting · waits for #4");
        expect(text).toContain("#5 · notes · Dropped");
        expect(text).toContain("PR #40");
        buttons()[1]?.click();
        buttons()[0]?.click();
        expect(said).toEqual([
          [1, "go #4"],
          [1, "go"],
        ]);
        // The same plan again draws nothing new; after `go`, Stop is there.
        m.plan(v, thread());
        expect(box.children[1]).toBe(card);
        m.plan(v, thread({ started: true }));
        expect(box.children).toHaveLength(2);
        const stop = buttons().find((b) => b.textContent === "Stop");
        stop?.click();
        expect(said.at(-1)).toEqual([1, "stop"]);
        // A closed task, or one that takes no words here: no button sends anything.
        m.plan(v, thread({ open: false, started: true }));
        expect(buttons()).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  // ↻ (ADR 0049): left of New chat, and in a thread's and a page's header; a tap reads what's on
  // screen again as coming back to the page does (wake). Dragging down stays the browser's reload.
  it.skipIf(!have)("has ↻ in each header, which reads again as coming back does", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain('$("#new").before(refreshBtn())');
    expect(js).toContain('h("header.head", back(), h("h2.title", title), refreshBtn())');
    expect(js).toMatch(/set\(v\.head, back\(\), [^\n]*refreshBtn\(\)/);
    expect(js).toMatch(/async function refresh\(\) \{[\s\S]*?await wake\(\);/);
  });

  // The sweep of ADR 0069, section 9: a word still being composed (Safari's 229) never sends; the
  // working clock is hidden from a screen reader and the working dot keeps still when asked; the
  // copy is kept a thread a key, written when the page is idle, never whole on each change.
  it.skipIf(!have)("never sends a word being composed, and keeps its copy a thread a key", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    const co = readFileSync(join(ROOT, dir, "compose.js"), "utf8");
    const css = readFileSync(join(ROOT, dir, "app.css"), "utf8");
    expect(co).toContain("e.isComposing || e.keyCode === 229");
    expect(js).toContain('"aria-hidden": "true", "data-since"');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.mark\.working/);
    expect(js).not.toContain("JSON.stringify(S)");
    expect(js).toContain("requestIdleCallback");
  });

  // A view with no Progress (New chat, the Desk, a thread not read yet) keeps no fold: kept as
  // `false`, the next draw called `false.remove()`, and every page said something went wrong.
  it.skipIf(!have)("keeps no Progress fold as nothing, never false: a redraw can't throw", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain('const g = (real && T.progress) || "";');
    expect(js).toContain("v.pg = d ? Object.assign(d, { k: g }) : undefined;");
    expect(js).not.toMatch(/v\.pg = d &&/);
  });

  // A repo's page stayed grey placeholders for good while its read (Files) failed; a part of the
  // page that didn't load once (offline) never loaded again before a reload.
  it.skipIf(!have)("says why a page didn't read, with Retry; a part not loaded loads again", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain("  await load(R.page);\n}");
    expect(js).toContain('set(v.body, h("p.quiet", why(e)), btn("Retry", retry));');
    expect(js).toMatch(/delete M\[k\];\s*throw Object\.assign\(e, \{ lost: true \}\);/);
  });

  // An upload sent whole whose answer never comes fails in 2 minutes, and one with nothing sent for
  // a minute fails too, each with Retry: never "Uploading…" for good.
  it.skipIf(!have)("fails an upload that gets no answer, or that stalls", async () => {
    class Xhr {
      upload: { onload?: () => void; onprogress?: (e: object) => void } = {};
      aborted = false;
      onabort?: () => void;
      onloadend?: () => void;
      open() {}
      setRequestHeader() {}
      send() {
        sent.push(this);
      }
      abort() {
        this.aborted = true;
        this.onabort?.();
        this.onloadend?.();
      }
    }
    const sent: Xhr[] = [];
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", Xhr);
    try {
      await inFakeDom(async () => {
        const { upload } = await import(join(ROOT, dir, "attach.js"));
        const u = upload({ name: "a.png", type: "image/png" }, 0, () => {});
        const x = sent[0] as Xhr;
        x.upload.onload?.();
        vi.advanceTimersByTime(119_000);
        expect(x.aborted).toBe(false);
        vi.advanceTimersByTime(1_000);
        expect(x.aborted).toBe(true);
        await expect(u.p).rejects.toMatchObject({
          message: "The edge didn't answer in 2 minutes",
          fix: "Retry; words still go.",
        });
        // Each step sent gives it another minute; a minute with nothing sent ends it.
        const s = upload({ name: "b.png", type: "image/png" }, 0, () => {});
        const y = sent[1] as Xhr;
        vi.advanceTimersByTime(59_000);
        y.upload.onprogress?.({ loaded: 1, total: 2 });
        vi.advanceTimersByTime(59_000);
        expect(y.aborted).toBe(false);
        vi.advanceTimersByTime(1_000);
        expect(y.aborted).toBe(true);
        await expect(s.p).rejects.toMatchObject({ message: "Nothing was sent for a minute" });
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  // Find in this chat (find.js, loaded the first time it opens): a row under the head, the hits
  // newest first (a button's word isn't one), Enter the next, Escape closes it.
  it.skipIf(!have)("finds in a chat with find.js, loaded when it opens", async () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain(
      'ib("search", () => lazy("find")((m) => m.find(v)), "Find in this chat", ".fb")',
    );
    // A phone's header keeps ↻ and the menu: Find, and Close or Reopen, move into the menu.
    const css = readFileSync(join(ROOT, dir, "app.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 799px\) \{[^@]*\.fb,\s*\.flip \{\s*display: none;/);
    expect(js).toContain('phone && [i("search", "Find in this chat"), () => R.v.fb.click()]');
    expect(js).toMatch(/phone &&\s*task &&\s*!T\.repeats && \[i\(T\.open \? "check"/);
    await inFakeDom(async (make) => {
      const { h } = await import(join(ROOT, dir, "compose.js"));
      const m = await import(join(ROOT, dir, "find.js"));
      const messages = [
        { id: 1, md: "Godot runs offline" },
        { id: 2, md: "which engine?" },
        { id: 3, md: "godot it is" },
        { id: 4, md: "godot", tap: true },
      ];
      const head = make("header");
      const box = make("section");
      const done = new Map(messages.map((x) => [x.id, make("article")]));
      box.append(head, ...done.values());
      const v: Record<string, unknown> = { n: 7, head, box, done };
      let drawn = 0;
      m.init({
        R: { v },
        S: { threads: { 7: { messages } } },
        btn: (l: unknown, f: unknown, c = "") => h(`button${c}`, { onclick: f }, l),
        redraw: () => drawn++,
      });
      m.find(v);
      const row = box.children[1] as El & { hidden?: boolean };
      expect(row.className).toBe("find");
      const q = v.q as El & { value: string; oninput: () => void };
      const hit = v.hit as El;
      q.value = "GODOT";
      q.oninput();
      expect(hit.textContent).toBe("1/2");
      expect(done.get(3)?.className).toBe("hit");
      q.on.keydown?.({ key: "Enter", shiftKey: false, preventDefault() {} });
      expect(hit.textContent).toBe("2/2");
      expect([done.get(1)?.className, done.get(3)?.className]).toEqual(["hit", ""]);
      q.on.keydown?.({ key: "Escape" });
      expect(row.hidden).toBe(true);
      expect(hit.textContent).toBe("");
      expect(done.get(1)?.className).toBe("");
      // Opened again: the same row, shown; nothing drawn again, all were on screen.
      m.find(v);
      expect(box.children.filter((x) => x.className === "find")).toHaveLength(1);
      expect(row.hidden).toBe(false);
      expect(drawn).toBe(0);
    });
  });

  // ADR 0069 §2: nothing closes for quiet. A task with no new word for 7 days folds into Quiet at
  // the list's foot, and opening it reads the next page, as Older tasks does. Close, Reopen, Stop
  // and Stop repeating are buttons: their word goes marked and isn't drawn; a close shows from the
  // task's own state.
  it.skipIf(!have)("folds quiet tasks into Quiet, and draws no button's word", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain('h("b", "Quiet")');
    expect(js).toContain("Date.now() - Date.parse(t.updated) > 6048e5");
    expect(6048e5).toBe(7 * 24 * 3600_000);
    expect(js).toContain("(!wide && L.more && !R.old ? olderTasks : drawList)()");
    expect(js).toMatch(/groups\(\s*rows\.filter\(\(t\) => !late\(t\) && !hush\(t\)\)/);
    const tap = /const TAP = (\/.*\/);/.exec(js)?.[1] ?? "";
    const TAP = new Function(`return ${tap}`)() as RegExp;
    for (const w of ["close", "reopen", "stop", "stop repeating"])
      expect(TAP.test(w), w).toBe(true);
    for (const w of ["again", "continue", "resume", "stop it now"])
      expect(TAP.test(w), w).toBe(false);
    expect(js).toContain("button: TAP.test(words) || undefined");
    expect(js).toContain("(x.tap ? [] : one(x, i + cut))");
    expect(js).toMatch(/turned\("close", T\.closed \? [^\n]*ago\(T\.closed\)[^\n]*, !!T\.closed\)/);
    for (const f of files(dir))
      expect(readFileSync(f, "utf8"), f).not.toMatch(/closes? by itself|a quiet day/i);
  });

  // ADR 0069, sections 1 and 16: drop anywhere (a drop never sends), a long paste as a file, a file
  // taken off the box deleted, an old draft dropped with its files, and Files by chat with Delete.
  it.skipIf(!have)("takes a drop anywhere into the box, and deletes what's taken off it", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    const co = readFileSync(join(ROOT, dir, "compose.js"), "utf8");
    const ws = readFileSync(join(ROOT, dir, "workspace.js"), "utf8");
    const css = readFileSync(join(ROOT, dir, "app.css"), "utf8");
    // One pair on the page, with its cue; none on the box itself.
    expect(js).toContain('addEventListener("dragover", dz)');
    expect(js).toContain('addEventListener("drop", dz)');
    expect(js).toContain('"Drop to attach" : "Files aren\'t set up"');
    expect(css).toContain("content: attr(data-dz)");
    expect(co).not.toMatch(/ondrop|ondragover/);
    // A drop goes into the box (here, or a new chat's): never into send.
    expect(js).toMatch(
      /const dz = [\s\S]*?into\(\(co\) => \(f \? co\.attach\(JSON\.parse\(f\)\) : co\.add\(l\)\)\)/,
    );
    expect(js.match(/const dz = [\s\S]*?\n};/)?.[0]).not.toMatch(/send|submit/);
    // Over the limit, the words go as a file; the open chat's number goes with an upload
    // (attach.js); a file taken off the box before it's loaded isn't sent up.
    const at = readFileSync(join(ROOT, dir, "attach.js"), "utf8");
    expect(co).toContain('"Attach as a file"');
    expect(co).toContain("`message-${now14()}.txt`");
    expect(at).toContain('x.setRequestHeader("x-file-task", task)');
    expect(co).toMatch(
      /const \{ upload \} = await import\("\.\/attach\.js"\);\s*if \(!files\.includes\(it\)\) return;/,
    );
    // Taken off the box, or with a draft untouched for 30 days: only what was sent up from it.
    expect(co).toContain("if (it.u && it.ref) unfile(it.ref)");
    expect(co).toMatch(/2592e6[\s\S]{0,120}if \(f\.u\) unfile\(f\.ref\)/);
    expect(co).toContain('method: "DELETE"');
    // Files: rows to drag, a Delete, No chat, the total; Share beside Ask about this.
    expect(ws).toContain('"text/x-shipify-file"');
    expect(ws).toContain('A.btn("Delete", () => del(f), ".danger")');
    expect(ws).toContain('"No chat"');
    expect(ws).toContain("size(d.bytes)} in all");
    expect(ws).toContain('asked("share this as a drop")');
    expect(ws).not.toMatch(/until|7 days/);
  });

  // ADR 0069, parts 4 to 8: projects first in the list, each folded with its chats (its thread read
  // once for chats past the list's page); New chat here and a project's own box send `under`, Add
  // sends `add <name>: …`; Move to project on a chat's menu; no Plan card for a project.
  it.skipIf(!have)(
    "lists projects first, opens a chat in one, adds to its Inbox, moves one in",
    () => {
      const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
      const pj = readFileSync(join(ROOT, dir, "project.js"), "utf8");
      const co = readFileSync(join(ROOT, dir, "compose.js"), "utf8");
      // The list: projects first, shut till opened, General last; a project never folds into Quiet.
      expect(js).toContain("for (const t of pj) by.set(`@${t.n}`, []);");
      expect(js).toContain('if (by.delete("")) by.set("", gen);');
      expect(js).toContain("const shut = !q && S.fold.includes(p) === !P;");
      expect(js).toMatch(
        /if \(P && !shut && !R\.pj\[P\.n\] && g\.length < c\) \{\s*R\.pj\[P\.n\] = \[\];\s*get\(`task\/\$\{P\.n\}`, 0, 1, ""\)/,
      );
      expect(js).toContain('P && h("span", `${c} chat${c === 1 ? "" : "s"}`)');
      expect(js).toContain("href: P ? `#/t/${P.n}`");
      expect(js).toMatch(/const hush = \(t\) =>[^;]*!t\.project &&/);
      // New chat here: the new chat's box sends `under`; a project's own box replies to none.
      expect(js).toContain("task: (W < 2 && n) || undefined");
      expect(co).toContain("`shipify-draft-${o.dk || o.task || 0}`");
      expect(pj).toContain('A.start("", "#/new", u)');
      // A project's box sends as every box does, made with it, so no redraw loses it: Send with
      // `under`, opening the new chat; Add (project.js's button, `v.add`) as `add <name>: …` with
      // none. Shown in the project's page while it goes; not sent, back in the box, with its files.
      expect(js).toContain(
        "send: W > 1 ? inProject(v, T.project) : (b, p) => send(v.u ? { ...b, under: v.u.n } : b, p)",
      );
      expect(js).toMatch(
        /const inProject = \(v, P\) => \(b, p\) =>\s*send\(v\.add \? \{ \.\.\.b, words: `add \$\{P\.name\}: \$\{b\.words\}` \} : \{ \.\.\.b, under: v\.n \}, p, "", \{/,
      );
      expect(js).toMatch(
        /v\.co\.fill\(b\.words\);\s*for \(const f of b\.files\) v\.co\.attach\(f\);/,
      );
      expect(js).toMatch(/const at = box\?\.n \|\| b\.task \|\| 0;\s*const L = queue\(at\);/);
      expect(js).toMatch(
        /if \(p\.box\) \{[^}]*queue\(p\.at\)\.filter\(\(x\) => x !== p\)[^}]*p\.box\.back\(\)/,
      );
      expect(js).toMatch(
        /if \(k !== n\) \{\s*p\.base = 0;\s*queue\(k\)\.push\(p\);\s*go\(`#\/t\/\$\{k\}`\);/,
      );
      expect(pj).not.toMatch(/co\.send\b|A\.get\("send"|function sent\(/);
      expect(pj).toMatch(/v\.add = 1;\s*f\.requestSubmit\(\);\s*v\.add = 0;/);
      expect(pj).toContain('A.say(T.n, "collate the inbox")');
      // Its card under the header is shut till you open it, then stays as you left it.
      expect(pj).toContain("{ open: v.pj?.open },");
      // Move to project, on a chat's menu (not a project's, not a part's): the edge's api/move.
      expect(js).toContain('task && !T.project && !T.parent && [i("app", "Move to project")');
      expect(pj).toContain('A.get("move", { task: n, project: p.n })');
      // A project's own card, never a Plan card (the edge sends it none).
      expect(js).toContain(
        'if (real && T.project) lazy("project")((m) => R.v === v && m.card(v, t));',
      );
    },
  );

  // Export (ADR 0069, section 6): built in the browser, its size said first, then Download or (an
  // upload's limit at most: the menu's, else 95 MB) Share as a drop, the zip put in a box with the
  // words that ask for one.
  it.skipIf(!have)("exports a project, or every file, saying its size first", () => {
    const pj = readFileSync(join(ROOT, dir, "project.js"), "utf8");
    const ws = readFileSync(join(ROOT, dir, "workspace.js"), "utf8");
    const ex = readFileSync(join(ROOT, dir, "export.js"), "utf8");
    expect(pj).toContain("x.offer(at, x.exportProject(n, whole), share)");
    expect(ws).toContain('[icon("save"), "Export everything"]');
    expect(ws).toContain("x.offer(at, x.exportFiles(), share)");
    for (const s of [pj, ws]) expect(s).toContain('fill("share this as a drop")');
    expect(ex).toMatch(/pop\(at, \[\s*`\$\{z\.name\} · \$\{size\(z\.blob\.size\)\}`/);
    expect(ex).toContain("z.blob.size <= (A?.S.menu?.files?.bytes || 95e6) && [");
    expect(95e6).toBe(95_000_000);
    for (const f of files(dir))
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/100 MB|1e8/);
  });

  // The Desk (ADR 0069, section 7): the first screen (a phone's too), from the list and what this
  // device opened alone (no call of its own), with Jot and New project; the foot's tabs Desk,
  // Projects, Files, Library, Setup; the Library grouped by project, the Journal first.
  it.skipIf(!have)("the Desk: what needs you, works, your projects and pages; Jot", async () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    const dk = readFileSync(join(ROOT, dir, "desk.js"), "utf8");
    expect(js).toContain('R.home = !p || p === "desk";');
    expect(js).toContain(
      'if (!location.hash.slice(2) && !WIDE.matches) history.replaceState(null, "", "#/desk");',
    );
    expect(js).toMatch(
      /\["spark", "Desk"\],\s*\["app", "Projects", ""\],\s*\["folder", "Files"\],\s*\["book", "Library", "notebook"\],\s*\["pulse", "Setup", "setup"\],/,
    );
    expect(dk).not.toMatch(/A\.get\(|\bapi\(|fetch\(/);
    // Each tab is a hash route, the list's (Projects) too: a tab from another page takes its place
    // in the app's own history, never Back (which left the app when it was opened from elsewhere,
    // or went to the Desk from a page it opened).
    const tabs = /\$\("#pages"\)\.onclick = \(e\) => \{[\s\S]*?\n\};/.exec(js)?.[0] ?? "";
    expect(tabs).toContain("location.replace(a.href)");
    expect(tabs).not.toMatch(/history\.(back|go)\(/);
    expect(js).toMatch(/h\(`a\$\{p \? "" : "\.home"\}`, \{ href: `#\/\$\{p\}`/);
    // A phone shows the Desk, not the list: the list is read while the Desk is on screen, when it
    // opens and on each of the page's checks, as on a wide screen.
    const listed = /async function tick\(\) \{[\s\S]*?const listed =([^;]*);/.exec(js)?.[1] ?? "";
    expect(listed).toContain("WIDE.matches");
    expect(listed).toMatch(/\bR\.home\b/);
    expect(js).toMatch(/function route\(\) \{[\s\S]*?R\.home = [\s\S]*?tick\(\);/);
    await inFakeDom(async (make) => {
      const { h } = await import(join(ROOT, dir, "compose.js"));
      const m = await import(join(ROOT, dir, "desk.js"));
      const said: string[] = [];
      let shown: { title: string; draw: (d: unknown) => unknown } | undefined;
      const updated = "2026-11-02T09:00:00Z";
      const url = "https://github.com/o/shipify/issues/1";
      const S = {
        list: {
          tasks: [
            {
              n: 1,
              title: "Project: games",
              state: "open",
              updated,
              project: { name: "games", chats: 3 },
            },
            { n: 2, title: "which engine?", state: "needs-you", parent: 1, updated },
            { n: 3, title: "shipify: the desk", state: "open", updated },
            { n: 4, title: "an old one", state: "closed", parent: 1, updated },
          ],
        },
        seen: [5, 3],
        threads: {
          5: { task: { n: 5, title: "Notebook: games" } },
          3: { task: { n: 3, title: "x" } },
        },
      };
      const asked: string[] = [];
      const lent = {
        S,
        // A part asked for by name: here, project.js's New project form.
        lazy: (k: string) => (f: (p: unknown) => void) =>
          asked.push(k) && f({ newProject: () => h("form.np") }),
        runs: () => new Set([3]),
        to: (n: number, t: string) => h("a", { href: `#/t/${n}` }, t),
        ext: (u: string, t: string) => h("a", { href: u }, t),
        what: (n: unknown, ...a: unknown[]) => h("div", n, a),
        meta: (...a: unknown[]) => h("small", a.filter(Boolean).join(" · ")),
        list: (a: unknown[], f: (x: unknown) => unknown, none = "") =>
          a.length
            ? h(
                "ul",
                a.map((x) => h("li", f(x))),
              )
            : h("p", none),
        bare: (s: string) => s.replace(/^\w+:\s*/, ""),
        ago: () => "5m",
        out: () => h("p"),
        btn: (l: unknown, f: unknown, c = "") => h(`button${c}`, { onclick: f }, l),
        quick: async (_: unknown, w: string) => said.push(w) && { text: "Jotted. No run started." },
        page: (title: string, _: string, draw: (d: unknown) => unknown) => {
          shown = { title, draw };
        },
      };
      const ready = m.init(lent);
      (document.head as unknown as El).children.at(-1)?.on.load?.({});
      await ready;
      const e = make("div");
      e.className = "desk";
      m.desk(e);
      const heads = e
        .all()
        .filter((x) => x.tag === "h3")
        .map((x) => x.textContent);
      expect(heads.slice(1)).toEqual(["Needs you1", "Working1", "Projects1", "Opened last"]);
      // A project with its open chats; the closed one isn't there. The page opened last, by topic.
      const chips = e
        .all()
        .filter((x) => x.className === "chip")
        .map((x) => x.textContent);
      expect(chips).toEqual(["which engine?"]);
      expect(e.textContent).toContain("games3 chats · #1");
      expect(e.all().find((x) => x.attrs.href === "#/t/5")?.textContent).toBe("games");
      // Jot: `jot: …`, with no run; the door's answer said under it.
      const jot = e.all().find((x) => x.className === "jot") as El & Record<string, unknown>;
      const input = jot.all().find((x) => x.tag === "input") as El & { value: string };
      input.value = "try a pico-8 port";
      await (jot.onsubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
      expect(said).toEqual(["jot: try a pico-8 port"]);
      expect(input.value).toBe("");
      // New project: its form is project.js's, asked for when the button is tapped.
      const np = e.all().find((x) => x.textContent === "New project") as El;
      expect(asked).toEqual([]);
      np.click();
      expect(asked).toEqual(["project"]);
      expect(np.parent?.children.some((x) => x.className === "np")).toBe(true);
      // The Library (library.js): the always pages, then the Journal first among those with no
      // project, then each project's.
      const lib = await import(join(ROOT, dir, "library.js"));
      lib.init(lent);
      lib.library();
      expect(shown?.title).toBe("Library");
      const page = (n: number, topic: string, project?: string) => ({
        n,
        topic,
        first: "x",
        lines: 1,
        url,
        ...(project ? { project } : {}),
      });
      const body = h(
        "div",
        shown?.draw({
          pages: [{ topic: "Preferences", first: "short", lines: 2, url }],
          library: [
            page(13, "games-inbox", "games"),
            page(10, "games", "games"),
            page(11, "ideas"),
            page(12, "Journal 2026-11"),
            page(14, "hacker-inbox", "hacker"),
          ],
        }),
      ) as unknown as El;
      const h3 = body
        .all()
        .filter((x) => x.tag === "h3")
        .map((x) => x.textContent);
      expect(h3).toEqual([
        "Always · every run reads these",
        "Journal and more · read when a run asks",
        "games · its runs read these",
        "hacker · its runs read these",
      ]);
      // A project's main page first, then its Inbox, each named for what it is; a project with no
      // main page yet says how one comes.
      const topics = body
        .all()
        .filter((x) => x.attrs.href?.startsWith("#/t/1"))
        .map((x) => x.textContent);
      expect(topics).toEqual(["Journal 2026-11", "ideas", "games", "Main page", "Inbox", "Inbox"]);
      const quiet = body.all().filter((x) => x.className === "quiet");
      expect(quiet.map((x) => x.textContent)).toEqual([
        "No main page yet: a run writes it when you ask for a summary, or to collate.",
      ]);
      expect(body.textContent).toContain("Its items wait for “collate the inbox”");
    });
  });

  // Chrome installs it as an app (Android's "Install app") only when it can read the manifest:
  // behind Access that's with the sign-in cookie, which a manifest's fetch leaves out unless asked.
  it.skipIf(!have)("installs as an app: its manifest read signed in, an icon for Android", () => {
    const html = readFileSync(join(ROOT, dir, "index.html"), "utf8");
    expect(html).toContain(
      '<link rel="manifest" href="manifest.json" crossorigin="use-credentials">',
    );
    const m = JSON.parse(readFileSync(join(ROOT, dir, "manifest.json"), "utf8"));
    const home = `${BASE}/`;
    expect(m).toMatchObject({ id: home, start_url: home, scope: home });
    expect(m.display).toBe("standalone");
    expect(m.prefer_related_applications).toBeUndefined();
    for (const purpose of ["any", "maskable"]) {
      const icon = m.icons.find((i: { purpose: string }) => i.purpose === purpose);
      expect(icon, purpose).toMatchObject({ sizes: "any", type: "image/svg+xml" });
      expect(existsSync(join(ROOT, dir, icon.src)), icon.src).toBe(true);
    }
  });

  // Under your message and on the chip alike, a pick reads by its agent's name, its gateway's too.
  it.skipIf(!have)("says a pick under a message as the chip does, naming the gateway", async () => {
    const { said } = await import(join(ROOT, dir, "compose.js"));
    const { models } = await import("../../../edge/src/web/setup.ts");
    const m = models();
    expect(said(m, "pi-vercel zai/glm-5.3 high")).toBe("Pi · Vercel · glm-5.3 · High");
    expect(said(m, "opencode-vercel")).toBe("OpenCode · Vercel · Auto");
    expect(said(m, "pi z-ai/glm-5.3")).toBe("Pi · glm-5.3");
    // Each agent's tab word is its gateway's name, as the row under the tab says it.
    const via = Object.fromEntries(
      m.agents.map((a: { id: string; via?: string }) => [a.id, a.via]),
    );
    expect(via).toMatchObject({ claude: undefined, pi: "OpenRouter", "pi-vercel": "Vercel" });
  });

  // A run that stays (ADR 0057) has run since the stay began: "Working · 40m" for a 10 s answer, in
  // the row and in the header till the turn's status was read, then 0 there. Only the turn is timed.
  it.skipIf(!have)("times a turn, never a stay's whole job, in a row and a header", async () => {
    const { timed } = await import(join(ROOT, dir, "compose.js"));
    const url = "https://github.com/o/s/actions/runs/9";
    const job = { n: 7, since: "2026-10-17T00:10:00Z", url };
    const turn = { ...job, since: "2026-10-17T00:49:50Z" };
    // A stay: its turn once its status says `working`; till then none (Starting…, or Staying).
    expect(timed(true, turn, job)).toBe(turn);
    expect(timed(true, undefined, job)).toBeUndefined();
    // Any other run: its turn, else the job the list knows first.
    expect(timed(false, turn, job)).toBe(turn);
    expect(timed(false, undefined, job)).toBe(job);
    expect(timed(false, undefined, undefined)).toBeUndefined();
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js.match(/timed\(/g)?.length, "the row and the header both time by it").toBe(2);
  });

  // Back from away after Access's session ended, a followed redirect fails as if offline and the
  // page stays stale under "Offline"; a redirect not followed is the sign-in, said as such.
  it.skipIf(!have)("tells a sign-in that ended from being offline", async () => {
    const { api } = await import(join(ROOT, dir, "compose.js"));
    const seen: RequestInit[] = [];
    const answers: Partial<Response>[] = [
      { type: "opaqueredirect", status: 0, ok: false },
      {
        type: "basic",
        status: 200,
        ok: true,
        json: async () => ({ v: 1 }),
        headers: new Headers(),
      },
    ];
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      seen.push(init);
      return answers.shift();
    });
    try {
      await expect(api("list")).rejects.toMatchObject({ signin: true, off: false });
      await expect(api("list")).resolves.toEqual({ v: 1 });
      expect(seen.map((i) => i.redirect)).toEqual(["manual", "manual"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // A message with a photo the edge took over 20 s to answer said "Offline" while the network was
  // up: a late answer says so, and is sent again; only a network that's gone is "Offline".
  it.skipIf(!have)("tells an edge slow to answer from being offline", async () => {
    const { api } = await import(join(ROOT, dir, "compose.js"));
    const why = [new DOMException("timed out", "TimeoutError"), new TypeError("Failed to fetch")];
    vi.stubGlobal("fetch", async () => Promise.reject(why.shift()));
    try {
      await expect(api("send", { id: "x" })).rejects.toMatchObject({
        message: "The edge didn't answer in 20 s",
        late: true,
        off: false,
      });
      await expect(api("list")).rejects.toMatchObject({ message: "Offline", off: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // A 304 means "what you have": only for the read that has it. A project's fold reads its thread
  // once, kept apart from the thread's own copy, so neither takes the other's ETag (a 304 there
  // left the project's page a placeholder, or the fold without its chats).
  it.skipIf(!have)(
    "keeps a read's ETag to itself: the fold's read of a project has none",
    async () => {
      const { api } = await import(join(ROOT, dir, "compose.js"));
      const asked: string[] = [];
      vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
        const tag = (init.headers as Record<string, string>)["if-none-match"] ?? "none sent";
        asked.push(tag);
        const same = tag === '"a"';
        return {
          type: "basic",
          status: same ? 304 : 200,
          ok: !same,
          json: async () => ({ v: 1 }),
          headers: new Headers({ etag: '"a"' }),
        };
      });
      try {
        // The fold's read first: no ETag sent, none kept; the thread's own read then gets the body.
        await expect(api("task/40", undefined, "")).resolves.toEqual({ v: 1 });
        await expect(api("task/40")).resolves.toEqual({ v: 1 });
        // The thread's ETag kept: its next read is a 304; the fold's still gets the body.
        await expect(api("task/40")).resolves.toBeNull();
        await expect(api("task/40", undefined, "")).resolves.toEqual({ v: 1 });
        expect(asked).toEqual(["", "", '"a"', ""]);
      } finally {
        vi.unstubAllGlobals();
      }
      const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
      expect(js).toMatch(/async function get\(p, b, quiet = false, k = p\) \{[^}]*api\(p, b, k\)/);
      expect(js).toMatch(/get\(`task\/\$\{P\.n\}`, 0, 1, ""\)/);
    },
  );

  // GitHub not read for a moment: a poll stays quiet and slows down, a calm line comes after a
  // minute or on the edge's last good copy, and a message not sent goes again by itself, same id.
  it.skipIf(!have)("rides out a moment GitHub isn't read, and sends again by itself", async () => {
    const { api } = await import(join(ROOT, dir, "compose.js"));
    vi.stubGlobal("fetch", async () => ({
      type: "basic",
      status: 503,
      ok: false,
      json: async () => ({
        error: "Couldn't read GitHub just now.",
        fix: "Try again in a minute.",
      }),
      headers: new Headers(),
    }));
    try {
      await expect(api("list")).rejects.toMatchObject({ status: 503, off: false });
    } finally {
      vi.unstubAllGlobals();
    }
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain(`const DOWN = "Can't reach GitHub · retrying";`);
    expect(js).toMatch(
      /else if \(quiet\) \{\s*R\.down \|\|= Date\.now\(\);\s*if \(Date\.now\(\) - R\.down > 6e4\)/,
    );
    expect(js).toContain("if (R.down) next = Math.min(6e4, 5e3 * 2 ** R.miss++);");
    expect(js).toMatch(
      /const late = e\.off \|\| e\.late \|\| e\.status === 503;[\s\S]{0,80}if \(late && p\.again <= 3\) setTimeout\(\(\) => p\.st === "fail" && sendIt\(p\)/,
    );
    expect(js).toMatch(/addEventListener\("online", \(\) => \{\s*again\(\);/);
  });

  describe.skipIf(!have)("its service worker (ADR 0050)", () => {
    const SCOPE = "https://shipify.example.com/admin/chat/";
    /** sw.js in a worker of its own: its events fired by hand, what it did kept. */
    function worker(
      open = false,
      net: (r: Request | string) => Promise<Response> = async () => new Response(""),
    ) {
      const on: Record<string, (e: unknown) => void> = {};
      // Its cache: by address, a query aside (as `ignoreSearch` matches).
      const kept = new Map<string, Response>();
      const at = (r: Request | string) => (typeof r === "string" ? r : r.url).split("?")[0] ?? "";
      const caches = {
        open: async () => ({
          put: async (r: Request | string, res: Response) => kept.set(at(r), res),
        }),
        match: async (r: Request) => kept.get(at(r))?.clone(),
      };
      const shown: [string, Record<string, unknown>][] = [];
      const opened: string[] = [];
      const told: unknown[] = [];
      const page = {
        url: `${SCOPE}#/`,
        postMessage: (m: unknown) => told.push(m),
        focus: async () => page,
      };
      const self = {
        registration: {
          scope: SCOPE,
          showNotification: async (t: string, o: Record<string, unknown>) => shown.push([t, o]),
        },
        clients: {
          matchAll: async () => (open ? [page] : []),
          openWindow: async (u: string) => opened.push(u),
          claim: async () => {},
        },
        skipWaiting: () => {},
        addEventListener: (t: string, f: (e: unknown) => void) => {
          on[t] = f;
        },
      };
      runInNewContext(readFileSync(join(ROOT, dir, "sw.js"), "utf8"), {
        self,
        URL,
        Response,
        setTimeout,
        caches,
        fetch: net,
      });
      /** An event: what it answered, and what it waits on. */
      const fire = (type: string, e: Record<string, unknown>) => {
        const waits: Promise<unknown>[] = [];
        let answer: Response | Promise<Response> | undefined;
        on[type]?.({
          ...e,
          waitUntil: (p: Promise<unknown>) => waits.push(p),
          respondWith: (r: Response | Promise<Response>) => {
            answer = r;
          },
        });
        return { answer, done: () => Promise.all(waits) };
      };
      return { shown, opened, told, fire, kept };
    }
    const note = {
      web_push: 8030,
      notification: {
        title: "Done · #321",
        body: "Get me homepi box health",
        navigate: `${SCOPE}#/t/321`,
        tag: "t321",
        renotify: true,
        lang: "en",
      },
    };

    it("shows every push, tells an open chat to read now, and keeps a tap inside the chat", async () => {
      const w = worker(true);
      await w.fire("push", { data: { json: () => note } }).done();
      expect(w.shown).toEqual([
        [
          "Done · #321",
          {
            body: note.notification.body,
            icon: "/note/icon.png",
            badge: "/note/badge.png",
            tag: "t321",
            renotify: true,
            lang: "en",
            data: `${SCOPE}#/t/321`,
          },
        ],
      ]);
      expect(w.told).toEqual(["read"]);
      // A push it can't read still shows one, and one pointing elsewhere opens the chat.
      const away = { ...note.notification, navigate: "https://evil.example/" };
      await w.fire("push", { data: { json: () => ({ notification: away }) } }).done();
      await w.fire("push", { data: { json: () => JSON.parse("not json") } }).done();
      expect(w.shown.map(([t, o]) => [t, o.data])).toEqual([
        ["Done · #321", `${SCOPE}#/t/321`],
        ["Done · #321", SCOPE],
        ["Shipify", SCOPE],
      ]);
      // A tap: the open chat goes to the thread.
      const close = () => {};
      await w
        .fire("notificationclick", { notification: { data: `${SCOPE}#/t/321`, close } })
        .done();
      expect(w.told.at(-1)).toEqual({ open: "#/t/321" });
      // None open: the chat opens, never an address outside it.
      const shut = worker(false);
      await shut
        .fire("notificationclick", { notification: { data: "https://evil.example/", close } })
        .done();
      await shut
        .fire("notificationclick", { notification: { data: `${SCOPE}#/t/9`, close } })
        .done();
      expect(shut.opened).toEqual([SCOPE, `${SCOPE}#/t/9`]);
    });

    it("answers a share with New chat, and hands it what was shared when it asks; nothing else", async () => {
      const w = worker(true);
      const form = new FormData();
      form.set("title", "A doc");
      form.set("url", "https://example.com/a");
      form.append("files", new File(["pdf"], "a.pdf", { type: "application/pdf" }));
      const request = new Request(`${SCOPE}share`, { method: "POST", body: form });
      const share = w.fire("fetch", { request });
      const went = await share.answer;
      expect(went?.status).toBe(303);
      expect(went?.headers.get("location")).toBe(`${SCOPE}#/new?shared`);
      const got: { shared?: { text: string; files: File[] } }[] = [];
      await w
        .fire("message", { data: "shared?", source: { postMessage: (m: never) => got.push(m) } })
        .done();
      await share.done();
      expect(got[0]?.shared?.text).toBe("A doc\nhttps://example.com/a");
      expect(got[0]?.shared?.files.map((f) => f.name)).toEqual(["a.pdf"]);
      // Taken once; and every other request is the network's.
      await w
        .fire("message", { data: "shared?", source: { postMessage: (m: never) => got.push(m) } })
        .done();
      expect(got).toHaveLength(1);
      expect(w.fire("fetch", { request: new Request(`${SCOPE}api/list`) }).answer).toBeUndefined();
      const post = new Request(`${SCOPE}api/send`, { method: "POST", body: "{}" });
      expect(w.fire("fetch", { request: post }).answer).toBeUndefined();
    });

    // ADR 0069: the page opens offline. Its own files from the network first, kept; the last kept
    // when the network fails. Never what the page reads, the worker itself, or anything outside.
    it("keeps the page's own files, the network's first, and opens offline", async () => {
      let up = true;
      const w = worker(true, async (r) => {
        const u = typeof r === "string" ? r : r.url;
        if (!up) throw new TypeError("Failed to fetch");
        return new Response(`v1 ${u}`, { status: u.endsWith("setup.js") ? 404 : 200 });
      });
      // Installed: the page's files kept at once (the page that installed it came before it).
      await w.fire("install", {}).done();
      const files = ["app.css", "app.js", "compose.js", "icon.svg", "manifest.json"];
      expect([...w.kept.keys()].sort()).toEqual([SCOPE, ...files.map((f) => SCOPE + f)]);
      // Online: the network's answer, and a copy kept; an error isn't kept.
      const js = w.fire("fetch", { request: new Request(`${SCOPE}workspace.js`) });
      expect(await (await js.answer)?.text()).toBe(`v1 ${SCOPE}workspace.js`);
      await js.done();
      expect(w.kept.has(`${SCOPE}workspace.js`)).toBe(true);
      const bad = w.fire("fetch", { request: new Request(`${SCOPE}setup.js`) });
      expect((await bad.answer)?.status).toBe(404);
      await bad.done();
      expect(w.kept.has(`${SCOPE}setup.js`)).toBe(false);
      // Offline: the last kept, the page by its address alone; nothing kept is an error.
      up = false;
      const page = w.fire("fetch", { request: new Request(`${SCOPE}?from=home`) });
      expect(await (await page.answer)?.text()).toBe(`v1 ${SCOPE}`);
      const none = w.fire("fetch", { request: new Request(`${SCOPE}setup.js`) });
      expect((await none.answer)?.type).toBe("error");
      // What the page reads, the worker, and other addresses: the network's alone.
      for (const u of [
        `${SCOPE}api/list`,
        `${SCOPE}api/file/abc`,
        `${SCOPE}sw.js`,
        "https://shipify.example.com/note/icon.png",
        "https://avatars.githubusercontent.com/u/1",
      ])
        expect(w.fire("fetch", { request: new Request(u) }).answer, u).toBeUndefined();
    });
  });

  it.skipIf(!have)("draws diagrams only in its frame, with Mermaid pinned to a hash", () => {
    const frame = readFileSync(join(ROOT, "edge/public/draw/index.html"), "utf8");
    const outside = [...frame.matchAll(/<script\s+src="(https:[^"]+)"([^>]*)>/g)];
    expect(outside.map((m) => m[1])).toEqual([MERMAID]);
    expect(outside[0]?.[2]).toMatch(/integrity="sha256-[\w+/]{43}=" crossorigin="anonymous"/);
    expect(frame).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    // draw.js, loaded the first time a message has a diagram, makes the frame.
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    const dj = readFileSync(join(ROOT, dir, "draw.js"), "utf8");
    expect(js).toContain('if (x.md.includes("```mermaid")) lazy("draw")((m) => m.draw(md, x.md));');
    expect(dj).toContain('sandbox: "allow-scripts"');
    for (const s of [js, dj]) {
      expect(s).not.toContain("allow-same-origin");
      expect(s).not.toMatch(/mermaid\.(?:render|initialize)/);
    }
  });

  it.skipIf(!have)(
    "has no inline script or style, no outside script, and checks its own JS",
    () => {
      const html = readFileSync(join(ROOT, dir, "index.html"), "utf8");
      expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).not.toMatch(/\sstyle=/i);
      expect(html).not.toMatch(/src=["']https?:/i);
      for (const f of files(dir).filter((x) => x.endsWith(".js"))) {
        const js = readFileSync(join(ROOT, f), "utf8");
        expect(js.startsWith("// @ts-check"), f).toBe(true);
        expect(js, f).not.toMatch(/\beval\(|new Function\(|document\.write/);
        expect(js, f).not.toMatch(/import\s[^;]*from\s+["']https?:/);
      }
    },
  );
});
