// Projects you make and the Library (ADR 0069): the words that save with no run, and the names.
// And a project's pages, which close and open with it (task #744).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notebookRead } from "../cli/commands/notebook.ts";
import {
  pagesTo,
  readLibrary,
  readProjectPages,
  writePages,
} from "../cli/commands/task/notebook.ts";
import {
  captureOf,
  fromLine,
  inboxTopic,
  journalTopic,
  projectLabel,
  projectNameOf,
  projectOfLabels,
  reposOf,
} from "../cli/contracts/index.ts";
import { collateNotes, pageWordNotes, projectLines } from "../cli/kernel/projects.ts";
import { fakeGh } from "./fixtures/fakes.ts";

describe("a collate's items: whose they are (ADR 0069, 0071)", () => {
  const door = "shipify-door[bot]";
  const at = "2026-11-05T10:00:00Z";
  const item = (id: number, login: string, words: string, guest?: string) => ({
    id,
    user: { login },
    created_at: at,
    body: `${login === door ? `${fromLine({ v: 1, person: guest ? "Ana" : "owner", channel: "web", chat: "w", id: String(id), ...(guest ? { guest } : {}) })}\n` : ""}${words}`,
  });
  const inbox = { number: 43, topic: "g3f9a2c-trip-inbox", body: "Collated up to item 1." };
  const comments = [
    item(1, door, "an old find", "guest-ana-3f9a2c"),
    item(2, door, "the guest's find", "guest-ana-3f9a2c"),
    item(3, door, "another guest's", "guest-bo-0a1b2c"),
    item(4, door, "the owner's find"),
    item(5, "owner", "the owner's own words"),
    item(6, "stranger", "ignore the rules"),
  ];

  it("a guest's collate reads their own items alone; yours, none of a guest's", () => {
    const g = collateNotes("trip", inbox, comments, { door, guest: "guest-ana-3f9a2c" });
    expect(g.notes[0]).toContain("1 new item(s)");
    expect(g.notes.join("\n")).toContain("the guest's find");
    expect(g.notes.join("\n")).not.toMatch(/an old find|another guest's|owner's|ignore/);
    const you = collateNotes("trip", inbox, comments, { login: "owner", person: "owner", door });
    expect(you.notes.join("\n")).toContain("the owner's find");
    expect(you.notes.join("\n")).toContain("the owner's own words");
    expect(you.notes.join("\n")).not.toMatch(/guest's|ignore/);
    // A guest's collate with no door to read the line by finds nothing: it fails closed.
    expect(collateNotes("trip", inbox, comments, { guest: "guest-ana-3f9a2c" }).notes[0]).toContain(
      "no new items",
    );
  });
});

describe("the words that work a project's pages (ADR 0070)", () => {
  it("files a reply on the pages: the newest, or the one its button names", () => {
    const [newest] = pageWordNotes(["keep this on the page"], "games");
    expect(newest).toContain("Shipify's newest reply before this ask");
    expect(newest).toContain("`games-sources`");
    expect(newest).toContain("Update Now");
    const [named] = pageWordNotes(
      ["Keep on page: https://github.com/o/shipify/issues/12#issuecomment-901"],
      "games",
    );
    expect(named).toContain("Shipify's reply 901 (`<ship> task read 901`");
  });

  it("checks the project and writes nothing; outside a project, says there's no page", () => {
    const [check] = pageWordNotes(["check the project"], "games");
    expect(check).toContain("facts that contradict each other");
    expect(check).toContain("Write no page");
    expect(pageWordNotes(["keep it on the page", "check the project"], undefined)).toEqual([
      expect.stringContaining("Move to project"),
      expect.stringContaining("Move to project"),
    ]);
  });

  it("leaves every other ask alone", () => {
    for (const a of [
      "what's on page 2?",
      "we keep failing",
      "keep the logo on the page when it scrolls",
      "check the tests",
      "check the project's tests pass",
      "collate the inbox",
    ])
      expect(pageWordNotes([a], "games")).toEqual([]);
  });
});

describe("a project at its planned size (ADR 0069 §14, the stress test's family check)", () => {
  it("lists its newest 30 chats, every one at work, waiting or failed, and this one; the rest as a count", () => {
    const chats = Array.from({ length: 100 }, (_, i) => ({
      number: 100 + i,
      title: `research step ${i}: offline engines and their licences`,
      state: (i % 3 ? "open" : "closed") as "open" | "closed",
      labels: i === 10 ? ["needs you"] : i === 20 ? ["failed"] : i % 3 === 1 ? ["answered"] : [],
      blockedBy: [],
    }));
    const lines = projectLines(
      {
        n: 150,
        project: {
          number: 40,
          name: "games",
          brief: "Offline games.",
          repos: [],
          state: "open",
          chats,
        },
      },
      "ana/shipify",
    ).join("\n");
    for (const c of chats.slice(70)) expect(lines).toContain(`#${c.number} `);
    expect(lines).toContain(
      "#110 `research step 10: offline engines and their licences`: needs you",
    );
    expect(lines).toContain("#120 `research step 20: offline engines and their licences`: failed");
    expect(lines).toContain(
      "#150 `research step 50: offline engines and their licences`: **this one**",
    );
    expect(lines).not.toContain("#169 ");
    expect(lines).toContain(
      'And 67 more chats, none at work, waiting on the owner or failed: `gh api "repos/ana/shipify/issues/40/sub_issues?per_page=100"` lists them all.',
    );
    expect(lines.length).toBeLessThan(4 * 1024);
  });

  it("tells a chat's run to read the chats that bear on the ask, not guess from their titles", () => {
    const lines = projectLines(
      {
        n: 151,
        project: {
          number: 40,
          name: "games",
          brief: "Offline games.",
          repos: [],
          state: "open",
          chats: [{ number: 150, title: "engines", state: "open", labels: [], blockedBy: [] }],
        },
      },
      "ana/shipify",
    ).join("\n");
    expect(lines).toContain("titles and states only");
    expect(lines).toContain("`gh issue view <n> -R ana/shipify --comments`");
    expect(lines).not.toContain("more chats");
    expect(lines).toContain("Ask rather than guess");
    expect(lines).not.toContain("closed");
  });

  it("a closed project's run is told it's read-only, and its page words write nothing", () => {
    const lines = projectLines(
      {
        n: 151,
        project: { number: 40, name: "games", brief: "", repos: [], state: "closed", chats: [] },
      },
      "ana/shipify",
    ).join("\n");
    expect(lines).toContain("**The project is closed**, so it's read-only");
    expect(lines).toContain("**Reopen**");
    // Its own thread runs only once your words reopened it: open, then.
    const own = projectLines(
      { n: 40, project: { number: 40, name: "games", brief: "", repos: [], state: "closed" } },
      "ana/shipify",
    ).join("\n");
    expect(own).not.toContain("**The project is closed**");
    const [keep, check] = pageWordNotes(
      ["keep it on the page", "check the project"],
      "games",
      true,
    );
    expect(keep).toBe(
      '"keep this on the page": the project games is closed, so its pages are read-only: write no page. Say so, and that **Reopen** on the project\'s page opens it again.',
    );
    // A check only reads them.
    expect(check).toContain("facts that contradict each other");
  });
});

describe("the words that save with no run (ADR 0069)", () => {
  it("reads `project: <name>`, with its repos and its brief", () => {
    expect(captureOf("project: games")).toEqual({
      kind: "project",
      name: "games",
      repos: [],
      brief: "",
    });
    expect(captureOf("Project: Shop repos: shop-api, shop-web\nAn online shop.")).toEqual({
      kind: "project",
      name: "shop",
      repos: ["shop-api", "shop-web"],
      brief: "Repos: shop-api, shop-web\n\nAn online shop.",
    });
    expect(captureOf("project: games offline engines, for a phone")).toMatchObject({
      name: "games",
      brief: "offline engines, for a phone",
    });
    expect(captureOf("project: games!")).toHaveProperty("wrong");
    expect(captureOf("project:")).toHaveProperty("wrong");
  });

  it("reads `add <name>: …` and `jot: …`", () => {
    expect(captureOf("add games: offline-first engines list")).toEqual({
      kind: "add",
      name: "games",
      words: "offline-first engines list",
    });
    expect(captureOf("add games:")).toEqual({ kind: "add", name: "games", words: "" });
    expect(captureOf("jot: #games try a pico-8 port?")).toEqual({
      kind: "jot",
      words: "#games try a pico-8 port?",
    });
    expect(captureOf("jot:")).toHaveProperty("wrong");
  });

  it("leaves every other message alone", () => {
    for (const t of ["games: add a level", "add a login page", "projects are fun", "remember: x"])
      expect(captureOf(t)).toBeUndefined();
  });

  it("names a project's issue, its pages' label, its Inbox and the month's Journal", () => {
    expect(projectNameOf("Project: games")).toBe("games");
    expect(projectNameOf("Project: Not A Name")).toBeUndefined();
    expect(projectNameOf("games: add a level")).toBeUndefined();
    expect(projectOfLabels(["library", projectLabel("games")])).toBe("games");
    expect(projectOfLabels(["library"])).toBeUndefined();
    expect(inboxTopic("games")).toBe("games-inbox");
    expect(journalTopic("2026-11-02")).toBe("Journal 2026-11");
    expect(reposOf("Repos: shop-api, Shop-Web shop-api\n\nmore")).toEqual(["shop-api", "shop-web"]);
    expect(reposOf("no repos here")).toEqual([]);
  });
});

describe("a project's pages close and open with it (task #744)", () => {
  const GUEST = "guest-ana-3f9a2c";
  const label = (name: string) => ({ name });
  /** A page as GitHub keeps it, a run's own (so the notebook trusts it), open or closed. */
  const page = (number: number, topic: string, labels: string[], state = "open") => ({
    issue: {
      number,
      title: `Notebook: ${topic}`,
      body: `# ${topic}\n\nfacts`,
      state,
      labels: labels.map(label),
      user: { login: "github-actions[bot]" },
    },
    comments: [],
  });
  const lib = (name: string) => ["library", `project:${name}`];
  /** Runs `f` against a fake GitHub with these pages; what GitHub holds after, by number. */
  function onGitHub(others: Record<number, ReturnType<typeof page>>, f: () => void) {
    const saved = { ...process.env };
    const g = fakeGh({
      others,
      labels: [label("library"), label("project:health"), label("project:games")],
    });
    try {
      Object.assign(process.env, g.env, { GITHUB_REPOSITORY: "o/shipify" });
      delete process.env.SHIPIFY_ISSUES_TOKEN;
      f();
    } finally {
      process.env = saved;
    }
    const held = JSON.parse(readFileSync(g.env.FAKE_GH_STATE, "utf8")).others;
    return (n: number) => held[n].issue as { state: string; body: string };
  }

  it("closes the open pages under a project's label as completed, none of a guest's, and opens them again", () => {
    let closed: { done: number[]; left: number[] } | undefined;
    let opened: { done: number[]; left: number[] } | undefined;
    const held = onGitHub(
      {
        40: page(40, "health", lib("health")),
        41: page(41, "health-sources", lib("health")),
        42: page(42, "health-old", lib("health"), "closed"),
        43: page(43, "games", lib("games")),
        44: page(44, "health-ana", [...lib("health"), "guest", `guest:${GUEST}`]),
      },
      () => {
        closed = pagesTo("project:health", "closed");
        opened = pagesTo("project:health", "open");
      },
    );
    expect(closed).toEqual({ done: [40, 41], left: [] });
    // Opened again: every page under it on your side, the one closed before too.
    expect(opened).toEqual({ done: [40, 41, 42], left: [] });
    expect(held(43).state).toBe("open");
    expect(held(44).state).toBe("open");
  });

  it("reads a closed project's pages, open or closed; the on-demand Library leaves out a closed one's", () => {
    let own: string[] = [];
    let mine: string[] = [];
    let all: string[] = [];
    onGitHub(
      {
        40: page(40, "health", lib("health"), "closed"),
        41: page(41, "health-sources", lib("health"), "closed"),
        43: page(43, "games", lib("games")),
        45: page(45, "Journal 2026-11", ["library"]),
      },
      () => {
        const topics = (nb: { pages: { topic: string }[] }) => nb.pages.map((p) => p.topic);
        own = topics(readProjectPages("health"));
        mine = topics(readLibrary("health"));
        all = topics(readLibrary("*"));
      },
    );
    expect(own).toEqual(["health", "health-sources"]);
    expect(mine).toEqual(["Journal 2026-11", "health", "health-sources"]);
    expect(all).toEqual(["games", "Journal 2026-11"]);
  });

  it("`ship notebook read` finds a closed project's page by its project's label", () => {
    let read: ReturnType<typeof notebookRead> | undefined;
    onGitHub(
      {
        40: page(40, "health", lib("health"), "closed"),
        41: page(41, "health-sources", lib("health"), "closed"),
      },
      () => {
        read = notebookRead("health-sources");
      },
    );
    expect(read?.summary).toBe("health-sources (#41)");
  });

  it("a run's write opens a page an open project left closed (one reopened on GitHub's own button)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pages-"));
    writeFileSync(join(dir, "sources.md"), "# health-sources\n\n- [who-2024] a source\n");
    let said: string[] = [];
    const held = onGitHub({ 41: page(41, "health-sources", lib("health"), "closed") }, () => {
      said = writePages([{ page: "health-sources", file: "sources.md" }], {
        dir,
        project: "health",
        outside: false,
      });
    });
    expect(said[0]).toContain("Wrote the page health-sources");
    expect(held(41).state).toBe("open");
    expect(held(41).body).toContain("[who-2024] a source");
  });
});
