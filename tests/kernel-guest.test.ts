// A guest's run (ADR 0071): its prompt holds nothing of the owner's (no notebook, tool, clone, key,
// Shipify CLI or earlier shared files), its own playbook, and asks only for words, files, its own
// project's pages and its tools' guest calls (ADR 0073).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLibrary, readProjectPages } from "../cli/commands/task/notebook.ts";
import { fromLine } from "../cli/contracts/index.ts";
import { guestCalls } from "../cli/kernel/agent.ts";
import { buildPrompt, type PromptInput } from "../cli/kernel/prompt.ts";
import { newState, parseTitle, type TaskState } from "../cli/lib/task.ts";
import { fakeGh } from "./fixtures/fakes.ts";

const ROOT = join(import.meta.dirname, "..");
const GUEST = "guest-ana-3f9a2c";
const read = (f: string) => readFileSync(join(ROOT, "playbooks", f), "utf8");

const input = (over: Partial<PromptInput> = {}): PromptInput => {
  const title = "what is a VO2 max, and a PDF of how to raise it";
  return {
    repo: "o/shipify",
    n: 701,
    title,
    body: "",
    parsed: parseTitle(title),
    why: "new",
    profile: "guest",
    state: {
      ...newState(),
      shared: {
        "old.pdf": {
          hash: "0a1b2c3d4e5f6a7b",
          url: "https://github.com/o/shipify/blob/shipify-files/task-9/old.pdf",
        },
      },
    } as TaskState,
    conversation: [],
    paths: {
      work: "/w",
      files: "/in/files",
      out: "/out",
      result: "/out/result.json",
      shipify: "/s",
      ship: "node /s/cli/dist/ship.mjs",
      read: "/r",
    },
    notes: [],
    playbook: read("guest.md"),
    ...over,
  };
};

describe("a guest's prompt (ADR 0071)", () => {
  it("says whose task it is, and holds nothing of the owner's", () => {
    const p = buildPrompt(input());
    expect(p).toContain("## A guest's task");
    expect(p).toContain("# Playbook: a guest's run");
    expect(p).not.toContain("the owner's personal assistant");
    // No clone, no key, no CLI to read the record with, no files shared on shipify-files.
    for (const none of ["gh repo clone", "Shipify's CLI", "<ship>", "shipify-files", "old.pdf"])
      expect(p, none).not.toContain(none);
    // No notebook or tools were handed to it (think hands none): none shows.
    expect(p).not.toContain("## The notebook");
    expect(p).not.toContain("## Tools");
    // Your playbook isn't its: no lanes, PRs or splits.
    expect(p).not.toContain("## 1. Pick the lane");
  });

  it("asks for words, files, its own memory and its own project's pages: no PR, work, call, split or repeat", () => {
    const p = buildPrompt(input({ projectPages: "### g3f9a2c-health\n\n# health" }));
    for (const field of [
      "`files`",
      "`pages`",
      "`question`",
      "`notes`",
      "`forget`",
      "`personality`",
    ])
      expect(p, field).toContain(field);
    for (const field of ["`pr`", "`work`", "`calls`", "`split`", "`repeat`", "`quiet`"])
      expect(p, field).not.toContain(`- ${field}:`);
    // Without its own project, no pages either.
    expect(buildPrompt(input())).not.toContain("- `pages`:");
  });

  it("asks for a connected tool's guest forms alone, as the box takes them (ADR 0073)", () => {
    const saved = { ...process.env };
    try {
      for (const k of ["SHIPIFY_DROP_URL", "SHIPIFY_DROP_READ_ID", "SHIPIFY_DROP_READ_SECRET"])
        delete process.env[k];
      // Drop not connected: no calls to ask for.
      expect(guestCalls()).toBeUndefined();
      Object.assign(process.env, {
        SHIPIFY_DROP_URL: "https://drop.example.com",
        SHIPIFY_DROP_READ_ID: "id",
        SHIPIFY_DROP_READ_SECRET: "secret",
      });
      const calls = guestCalls() ?? "";
      expect(calls.split("\n")).toEqual([
        '- `drop.publish`: `share` always "me", `title` (120 characters at most), `files`, `expiry` and nothing else; 5 a run at most.',
        "- `drop.update`: `title` (120 characters at most), `drop`, `files`, `delete_files` and nothing else; 5 a run at most.",
      ]);
      const p = buildPrompt(input({ guestCalls: calls }));
      expect(p).toContain("and the few calls below that the box makes for the guest.");
      expect(p).toContain("- `calls`: ");
      expect(p).toContain("\n  - `drop.update`: ");
      // Still none of your tools, nor the owner's list of calls.
      expect(p).not.toContain("## Tools");
      expect(p).not.toContain("the owner says yes");
    } finally {
      process.env = saved;
    }
  });

  it("your runs never read a guest's pages; their run reads only its own project's", () => {
    const saved = { ...process.env };
    try {
      const label = (name: string) => ({ name });
      const page = (
        number: number,
        title: string,
        labels: string[],
        body: string,
        login: string,
      ) => ({
        issue: { number, title, body, state: "open", labels: labels.map(label), user: { login } },
        comments: [],
      });
      const theirs = fromLine({
        v: 1,
        person: "Aayush",
        channel: "web",
        chat: GUEST,
        id: "1",
        guest: GUEST,
      });
      const g = fakeGh({
        others: {
          40: page(
            40,
            "Notebook: g3f9a2c-health",
            ["library", "project:g3f9a2c-health", "guest", `guest:${GUEST}`],
            `${theirs}\n# health\n\nAna's notes`,
            "shipify-door[bot]",
          ),
          41: page(
            41,
            "Notebook: games",
            ["library", "project:games"],
            "# games\n\nyours",
            "github-actions[bot]",
          ),
        },
      });
      Object.assign(process.env, g.env, {
        GITHUB_REPOSITORY: "o/shipify",
        SHIPIFY_DOOR_SLUG: "shipify-door",
        SHIPIFY_PEOPLE: JSON.stringify([{ name: "Aayush", on: { web: "me" } }]),
      });
      delete process.env.SHIPIFY_ISSUES_TOKEN;
      const topics = (nb: { pages: { topic: string }[] }) => nb.pages.map((p) => p.topic);
      // Your Library, every project's: the guest's page isn't there, though its line says
      // "Aayush" (a guest may share your name: their mark decides).
      expect(topics(readLibrary("*"))).toEqual(["games"]);
      expect(topics(readProjectPages("g3f9a2c-health"))).toEqual([]);
      // Their run: their own project's page alone.
      expect(topics(readProjectPages("g3f9a2c-health", GUEST))).toEqual(["g3f9a2c-health"]);
      expect(topics(readProjectPages("games", GUEST))).toEqual([]);
    } finally {
      process.env = saved;
    }
  });

  it("a guest's playbook keeps their walls, and yours names it", () => {
    const g = read("guest.md");
    for (const wall of ["no GitHub key", "notebook", "only words", "out folder", "own project"])
      expect(g, wall).toContain(wall);
    expect(read("task.md")).toContain("playbooks/guest.md");
  });
});
