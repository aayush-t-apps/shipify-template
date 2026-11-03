// Export (ADR 0069, edge/public/admin/chat/export.js): the zip your browser builds, with no
// library, read back by a real unzip; and a project's folder from the chat's own reads.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page's own plain JavaScript, as the browser loads it (no types of its own).
const page = "../../../edge/public/admin/chat/export.js";
const { exportFiles, exportProject, zip } = (await import(page)) as {
  zip: (files: [string, Uint8Array][]) => Promise<Blob>;
  exportProject: (n: number) => Promise<{ blob: Blob; name: string }>;
  exportFiles: () => Promise<{ blob: Blob; name: string }>;
};

const unzip = async (blob: Blob) => {
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const file = join(dir, "a.zip");
  writeFileSync(file, new Uint8Array(await blob.arrayBuffer()));
  const py = `import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({n: z.read(n).decode('utf8','replace') for n in z.namelist()}))`;
  return JSON.parse(execFileSync("python3", ["-c", py, file], { encoding: "utf8" })) as Record<
    string,
    string
  >;
};

afterEach(() => vi.unstubAllGlobals());

describe("export (ADR 0069)", () => {
  it("makes a zip a real unzip reads, deflated or stored, names in UTF-8", async () => {
    const text = new TextEncoder().encode("hello ".repeat(200));
    const blob = await zip([
      ["games/README.md", text],
      ["games/tiny.txt", new TextEncoder().encode("x")],
      ["games/pages/café.md", new TextEncoder().encode("# Map")],
    ]);
    expect(blob.size).toBeLessThan(text.length);
    expect(await unzip(blob)).toEqual({
      "games/README.md": "hello ".repeat(200),
      "games/tiny.txt": "x",
      "games/pages/café.md": "# Map",
    });
  });

  it("builds a project's folder from the chat's reads: README, ALL.md, pages, inbox, chats, files, project.json", async () => {
    const answers: Record<string, unknown> = {
      "task/40": {
        task: {
          n: 40,
          title: "Project: games",
          project: {
            name: "games",
            chats: [{ n: 12, title: "which engine?" }],
            pages: [
              { n: 41, topic: "games", first: "Map", url: "u41" },
              { n: 43, topic: "games-inbox", first: "Inbox", url: "u43" },
            ],
          },
        },
        messages: [{ who: "you", at: "t", md: "Offline games." }],
      },
      "task/41": {
        task: { n: 41, title: "Notebook: games" },
        messages: [{ md: "## Map\n\n- Godot" }],
      },
      "task/43": {
        task: { n: 43, title: "Notebook: games-inbox" },
        messages: [{ md: "Inbox" }, { who: "you", at: "2026-11-02", md: "Defold runs offline" }],
      },
      "task/12": {
        task: { n: 12, title: "which engine?" },
        messages: [
          { who: "you", at: "t1", md: "which engine?" },
          { who: "shipify", at: "t2", md: "Godot." },
        ],
      },
      files: {
        files: [
          { ref: "f-1", name: "shot.png", size: 3, task: 43 },
          { ref: "f-2", name: "x", task: 99 },
        ],
      },
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const p = url.replace(/^api\//, "");
      if (p === "file/f-1?download=1") return new Response("PNG");
      const a = answers[p];
      return a ? Response.json(a) : new Response("no", { status: 404 });
    });
    const { blob, name } = await exportProject(40);
    expect(name).toBe("games.zip");
    const z = await unzip(blob);
    expect(Object.keys(z).sort()).toEqual([
      "games/ALL.md",
      "games/README.md",
      "games/chats/12-which-engine.md",
      "games/files/43-shot.png",
      "games/inbox.md",
      "games/pages/games.md",
      "games/project.json",
    ]);
    expect(z["games/pages/games.md"]).toBe("## Map\n\n- Godot");
    expect(z["games/inbox.md"]).toContain("Defold runs offline");
    expect(z["games/ALL.md"]).toContain("Godot.");
    expect(JSON.parse(z["games/project.json"] ?? "{}")).toMatchObject({ name: "games", n: 40 });
  });

  // A thread is read a page (100) at a time, newest first, as its view's Earlier messages reads.
  it("reads every page of a long chat and page, so the chat's file and ALL.md are whole", async () => {
    const said = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        who: "you",
        at: `t${from + i}`,
        md: `m${from + i}`,
      }));
    const answers: Record<string, unknown> = {
      "task/40": {
        task: {
          n: 40,
          title: "Project: games",
          project: {
            name: "games",
            chats: [{ n: 12, title: "a long one" }],
            pages: [{ n: 43, topic: "games-inbox", first: "Inbox", url: "u43" }],
          },
        },
        messages: [{ md: "Offline games." }],
        page: 1,
      },
      // The newest view: pages 2 and 3 (the newest short); then 1, the task's own words first.
      "task/12": {
        task: { n: 12, title: "a long one" },
        messages: said(100, 250),
        earlier: true,
        page: 2,
      },
      "task/12?page=1": {
        task: { n: 12, title: "a long one" },
        messages: said(0, 99),
        earlier: false,
        page: 1,
      },
      "task/43": {
        task: { n: 43, title: "Notebook: games-inbox" },
        messages: said(100, 120),
        earlier: true,
        page: 2,
      },
      "task/43?page=1": {
        task: { n: 43, title: "Notebook: games-inbox" },
        messages: [{ md: "Inbox" }, ...said(1, 99)],
        earlier: false,
        page: 1,
      },
      files: { files: [] },
    };
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const p = url.replace(/^api\//, "");
      asked.push(p);
      const a = answers[p];
      return a ? Response.json(a) : new Response("no", { status: 404 });
    });
    const z = await unzip((await exportProject(40)).blob);
    const chat = z["games/chats/12-a-long-one.md"] ?? "";
    expect(chat.match(/^## you, /gm)).toHaveLength(251);
    expect(chat.indexOf("\nm0\n")).toBeLessThan(chat.indexOf("\nm99\n"));
    expect(chat.indexOf("\nm99\n")).toBeLessThan(chat.indexOf("\nm100\n"));
    expect(chat).toContain("\nm250\n");
    expect(z["games/ALL.md"]?.match(/^## you, /gm)).toHaveLength(251);
    // The Inbox page's own words are its first message, on page 1; then each item, all 120.
    expect(z["games/inbox.md"]?.match(/^- t\d+: m\d+$/gm)).toHaveLength(120);
    expect(asked.filter((p) => p.startsWith("task/12"))).toEqual(["task/12", "task/12?page=1"]);
  });

  // The zip is built in this device's memory: a big one's size is said before it's built.
  it("says a big export's size before reading its files, and stops when you say so", async () => {
    const answers: Record<string, unknown> = {
      "task/40": {
        task: { n: 40, title: "Project: games", project: { name: "games", chats: [], pages: [] } },
        messages: [{ md: "Offline games." }],
      },
      files: {
        files: [
          { ref: "f-1", name: "a.mp4", size: 4e7, task: 40 },
          { ref: "f-2", name: "b.mp4", size: 3e7, task: 40 },
        ],
      },
    };
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const p = url.replace(/^api\//, "");
      asked.push(p);
      if (p.startsWith("file/")) return new Response("x");
      return Response.json(answers[p]);
    });
    const shown: string[] = [];
    let yes = false;
    vi.stubGlobal("confirm", (t: string) => shown.push(t) && yes);
    await expect(exportProject(40)).rejects.toThrow(/^$/);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("70.0 MB");
    expect(asked.some((p) => p.startsWith("file/"))).toBe(false);
    yes = true;
    const z = await unzip((await exportProject(40)).blob);
    expect(Object.keys(z)).toContain("games/files/40-a.mp4");
    // Export everything asks the same; a small one is built with no question.
    shown.length = 0;
    expect(await exportFiles()).toMatchObject({ name: "shipify-files.zip" });
    expect(shown).toHaveLength(1);
    answers.files = { files: [{ ref: "f-1", name: "a.png", size: 3e6, task: 40 }] };
    await exportFiles();
    expect(shown).toHaveLength(1);
  });

  it("stores what it can't deflate (no CompressionStream: an older browser)", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const text = new TextEncoder().encode("hello ".repeat(200));
    const blob = await zip([["games/README.md", text]]);
    expect(blob.size).toBeGreaterThan(text.length);
    expect(await unzip(blob)).toEqual({ "games/README.md": "hello ".repeat(200) });
  });

  it("names each file safely, once: no slash, backslash, `..` or control character", async () => {
    const x = new TextEncoder().encode("x");
    const z = await unzip(
      await zip([
        ["games/../../evil.sh", x],
        ["games/a.png", x],
        ["games/A.png", x],
        ["games/a.png", x],
        ["games/README", x],
        ["games/README", x],
      ]),
    );
    expect(Object.keys(z)).toEqual([
      "games/_/_/evil.sh",
      "games/a.png",
      "games/A (2).png",
      "games/a (3).png",
      "games/README",
      "games/README (2)",
    ]);
    // A file's own name is one part, however it reads.
    vi.stubGlobal("fetch", async (url: string) => {
      const p = url.replace(/^api\//, "");
      if (p.startsWith("file/")) return new Response("x");
      return Response.json({
        files: [
          { ref: "f-1", name: "../../etc/passwd", task: 7 },
          { ref: "f-2", name: "a\\b\u0001c.txt", task: 7 },
          { ref: "f-3", name: "..", task: 7 },
          { ref: "f-4", name: "shot.png" },
          { ref: "f-5", name: "shot.png" },
        ],
      });
    });
    const all = Object.keys(await unzip((await exportFiles()).blob));
    expect(all).toEqual([
      "files/7/.._.._etc_passwd",
      "files/7/a_b_c.txt",
      "files/7/_",
      "files/no-chat/shot.png",
      "files/no-chat/shot (2).png",
    ]);
  });
});
