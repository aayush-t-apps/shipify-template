// Projects you make and the Library (ADR 0069): the words that save with no run, and the names.
import { describe, expect, it } from "vitest";
import {
  captureOf,
  inboxTopic,
  journalTopic,
  projectLabel,
  projectNameOf,
  projectOfLabels,
  reposOf,
} from "../cli/contracts/index.ts";
import { pageWordNotes, projectLines } from "../cli/kernel/projects.ts";

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
