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
  it.skipIf(!have)("is plain files of its own, under 42 KB as sent, its worker under 2 KB", () => {
    const list = files(dir);
    for (const want of ["index.html", "app.js", "compose.js", "app.css", "manifest.json", "sw.js"])
      expect(list).toContain(`${dir}/${want}`);
    const gz = (f: string) => gzipSync(readFileSync(join(ROOT, f))).length;
    const worker = `${dir}/sw.js`;
    const sent = list.filter((f) => f !== worker).reduce((n, f) => n + gz(f), 0);
    expect(sent).toBeLessThan(42 * 1024);
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

  // ↻ (ADR 0049): left of New chat, and in a thread's and a page's header; a tap reads what's on
  // screen again as coming back to the page does (wake). Dragging down stays the browser's reload.
  it.skipIf(!have)("has ↻ in each header, which reads again as coming back does", () => {
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain('$("#new").before(refreshBtn())');
    expect(js).toContain('h("header.head", back(), h("h2.title", title), refreshBtn())');
    expect(js).toMatch(/set\(v\.head, back\(\), [^\n]*refreshBtn\(\)/);
    expect(js).toMatch(/async function refresh\(\) \{[\s\S]*?await wake\(\);/);
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
      /const late = e\.off \|\| e\.status === 503;[\s\S]{0,80}if \(late && p\.again <= 3\) setTimeout\(\(\) => p\.st === "fail" && sendIt\(p\)/,
    );
    expect(js).toMatch(/addEventListener\("online", \(\) => \{\s*again\(\);/);
  });

  describe.skipIf(!have)("its service worker (ADR 0050)", () => {
    const SCOPE = "https://shipify.example.com/admin/chat/";
    /** sw.js in a worker of its own: its events fired by hand, what it did kept. */
    function worker(open = false) {
      const on: Record<string, (e: unknown) => void> = {};
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
      });
      /** An event: what it answered, and what it waits on. */
      const fire = (type: string, e: Record<string, unknown>) => {
        const waits: Promise<unknown>[] = [];
        let answer: Response | undefined;
        on[type]?.({
          ...e,
          waitUntil: (p: Promise<unknown>) => waits.push(p),
          respondWith: (r: Response) => {
            answer = r;
          },
        });
        return { answer, done: () => Promise.all(waits) };
      };
      return { shown, opened, told, fire };
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
      expect(share.answer?.status).toBe(303);
      expect(share.answer?.headers.get("location")).toBe(`${SCOPE}#/new?shared`);
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
      // No cache, and no request of its own.
      expect(readFileSync(join(ROOT, dir, "sw.js"), "utf8")).not.toMatch(/\bcaches\.|\bfetch\(/);
    });
  });

  it.skipIf(!have)("draws diagrams only in its frame, with Mermaid pinned to a hash", () => {
    const frame = readFileSync(join(ROOT, "edge/public/draw/index.html"), "utf8");
    const outside = [...frame.matchAll(/<script\s+src="(https:[^"]+)"([^>]*)>/g)];
    expect(outside.map((m) => m[1])).toEqual([MERMAID]);
    expect(outside[0]?.[2]).toMatch(/integrity="sha256-[\w+/]{43}=" crossorigin="anonymous"/);
    expect(frame).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    const js = readFileSync(join(ROOT, dir, "app.js"), "utf8");
    expect(js).toContain('sandbox: "allow-scripts"');
    expect(js).not.toContain("allow-same-origin");
    expect(js).not.toMatch(/mermaid\.(?:render|initialize)/);
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
