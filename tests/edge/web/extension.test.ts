// The web chat stays an extension (ADR 0036, "The extension and the core"): only app.ts mounts it,
// its form keeps step with GitHub's Repeat form, and its page stays light: plain files, no
// libraries, no inline script, under 40 KB as sent; Mermaid draws diagrams only in the sandboxed
// frame.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  REPEAT_KINDS,
  REPEAT_MODELS,
  REPEAT_WHEN,
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
    body: { id: string; attributes: { label: string; options?: string[]; description?: string } }[];
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
    expect(field("model")?.options).toEqual([...REPEAT_MODELS]);
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
  // Cloudflare sends it): 40 KB, the page about 36 KB then (106 KB as written, comments kept). A
  // library or a picture slipped in still fails it.
  it.skipIf(!have)("is plain files of its own, under 40 KB as sent", () => {
    const list = files(dir);
    for (const want of ["index.html", "app.js", "compose.js", "app.css", "manifest.json"])
      expect(list).toContain(`${dir}/${want}`);
    const sent = list.reduce((n, f) => n + gzipSync(readFileSync(join(ROOT, f))).length, 0);
    expect(sent).toBeLessThan(40 * 1024);
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
