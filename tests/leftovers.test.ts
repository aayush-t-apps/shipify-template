// What a closed task leaves in your repos (task #779, cli/commands/task/leftovers.ts): its open PRs
// closed and its branches deleted, 7 days after it closed, in every repo of Shipify's own account,
// by the weekly clean-up on GitHub's machines. An open task's, one closed since, and a branch named
// so by hand are kept.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ConsolesIo,
  clearLeftovers,
  closedWhy,
  dropGoneConsoles,
  goneLinked,
  type LeftoversIo,
  leftovers,
  taskOf,
} from "../cli/commands/task/leftovers.ts";
import { consolesOf, goneConsoles, keepConsoles, readConsoles } from "../cli/lib/consoles.ts";
import { branchesOf, type TaskBranch } from "../cli/lib/github.ts";

const AT = new Date("2026-11-23T03:00:00.000Z");
const ago = (days: number) => new Date(AT.getTime() - days * 24 * 3600_000).toISOString();
const url = (repo: string, n: number) => `https://github.com/o/${repo}/pull/${n}`;
const branch = (repo: string, name: string, over: Partial<TaskBranch> = {}): TaskBranch => ({
  repo: `o/${repo}`,
  name,
  ours: true,
  prs: [],
  ...over,
});

// As GitHub had them on 18 Nov: a closed task's open PR (#759's #760), branches of merged and
// closed PRs, branches with no PR, in Shipify's repo, projects and repos that keep their own rules.
const BRANCHES = [
  branch("shipify", "task/759-hide-app-names", {
    prs: [{ number: 760, url: url("shipify", 760) }],
  }),
  branch("shipify", "task/506-old-idea"),
  branch("drop", "task/642-share-folders"),
  branch("homelab", "task/538-backups"),
  branch("vault", "task/706-rotate-keys"),
  branch("vault", "task/706-rotate-keys-r2"),
  // An open task's branch and PR, and a task closed 3 days ago: kept.
  branch("shipify", "task/779-close-what-closed-tasks-leave", {
    prs: [{ number: 781, url: url("shipify", 781) }],
  }),
  branch("drop", "task/770-a-fresh-one"),
  // A branch someone named so by hand: its newest commit isn't Shipify's.
  branch("homelab", "task/12-mine", { ours: false }),
];
const CLOSED = new Map([
  [759, ago(4 * 7)],
  [506, ago(30)],
  [642, ago(20)],
  [538, ago(25)],
  [706, ago(7)],
  [770, ago(3)],
  [12, ago(400)],
]);

describe("what a closed task leaves behind (task #779)", () => {
  it("reads a branch's task from its name", () => {
    expect(taskOf("task/759-hide-app-names")).toBe(759);
    expect(taskOf("task/706-rotate-keys-r2")).toBe(706);
    expect(taskOf("task/12")).toBe(12);
    expect(taskOf("task/12x")).toBeUndefined();
    expect(taskOf("task/-1")).toBeUndefined();
    expect(taskOf("feature/12-x")).toBeUndefined();
  });

  it("picks Shipify's branches of tasks closed 7 days ago or more, with their open PRs, in every repo", () => {
    expect(leftovers(BRANCHES, CLOSED, AT).map((b) => `${b.repo}:${b.name}`)).toEqual([
      "o/shipify:task/759-hide-app-names",
      "o/shipify:task/506-old-idea",
      "o/drop:task/642-share-folders",
      "o/homelab:task/538-backups",
      "o/vault:task/706-rotate-keys",
      "o/vault:task/706-rotate-keys-r2",
    ]);
  });

  it("closes each open PR with a comment that says why, then deletes its branch; the record's line says what it did", () => {
    const calls: string[] = [];
    const asked: number[][] = [];
    const io: LeftoversIo = {
      record: {
        closedAt: (ns) => {
          asked.push(ns);
          return CLOSED;
        },
      },
      branches: () => BRANCHES,
      closePr: (u, comment) => {
        calls.push(`close ${u}`);
        expect(comment).toBe(closedWhy("o/shipify#759"));
      },
      deleteBranch: (repo, name) => {
        calls.push(`delete ${repo}:${name}`);
      },
    };
    const done = clearLeftovers(AT, io, "o/shipify");
    // One read of the tasks' states, for Shipify's branches only.
    expect(asked).toEqual([[759, 506, 642, 538, 706, 779, 770]]);
    expect(calls).toEqual([
      `close ${url("shipify", 760)}`,
      "delete o/shipify:task/759-hide-app-names",
      "delete o/shipify:task/506-old-idea",
      "delete o/drop:task/642-share-folders",
      "delete o/homelab:task/538-backups",
      "delete o/vault:task/706-rotate-keys",
      "delete o/vault:task/706-rotate-keys-r2",
    ]);
    expect(done.said).toBe(
      "closed 1 PR (shipify#760) and deleted 6 branches of tasks closed 7 days ago or more",
    );
    expect(closedWhy("o/shipify#759")).toContain("**Restore branch**");
  });

  it("keeps a branch whose PR didn't close, and says what it couldn't clear, for next week", () => {
    const deleted: string[] = [];
    const io: LeftoversIo = {
      record: { closedAt: () => CLOSED },
      branches: () => BRANCHES.slice(0, 3),
      closePr: () => {
        throw new Error("HTTP 403");
      },
      deleteBranch: (_repo, name) => {
        if (name.startsWith("task/642")) throw new Error("HTTP 422");
        deleted.push(name);
      },
    };
    const done = clearLeftovers(AT, io, "o/shipify");
    expect(deleted).toEqual(["task/506-old-idea"]);
    expect(done.said).toBe(
      "deleted 1 branch of tasks closed 7 days ago or more; couldn't clear shipify#760, drop:task/642-share-folders: next week",
    );
    expect(done.failed).toBe(2);
  });

  it("says when nothing is left, and reads no task when no branch is Shipify's", () => {
    const io: LeftoversIo = {
      record: {
        closedAt: () => {
          throw new Error("not read");
        },
      },
      branches: () => [branch("homelab", "task/12-mine", { ours: false })],
      closePr: () => {},
      deleteBranch: () => {},
    };
    expect(clearLeftovers(AT, io, "o/shipify").said).toBe("nothing left by closed tasks");
  });

  it("reads each repo's task branches from GitHub's answer: Shipify's by its commits or its PR's author", () => {
    const ref = (
      name: string,
      email: string,
      prs: { number: number; url: string; author: { __typename: string } }[] = [],
    ) => ({
      name,
      target: { author: { email } },
      associatedPullRequests: { nodes: prs },
    });
    const got = branchesOf(["o/shipify", "o/gone", "o/homelab"], {
      r0: {
        refs: {
          nodes: [
            ref("task/759-hide-app-names", "1+shipify-pi[bot]@users.noreply.github.com", [
              { number: 760, url: url("shipify", 760), author: { __typename: "Bot" } },
            ]),
            // You pressed Update branch on its PR: still Shipify's, by the PR's author.
            ref("task/761-x", "you@example.com", [
              { number: 762, url: url("shipify", 762), author: { __typename: "Bot" } },
            ]),
            ref("task/506-old-idea", "shipify@users.noreply.github.com"),
            // The `task/` filter matches anywhere in a name: only a task's branch as Shipify names
            // one is read.
            ref("old-task/12-x", "1+shipify-pi[bot]@users.noreply.github.com"),
            ref("task/notes", "1+shipify-pi[bot]@users.noreply.github.com"),
            null,
          ],
        },
      },
      // A repo GitHub couldn't read has none.
      r1: null,
      r2: { refs: { nodes: [ref("task/12-mine", "you@example.com")] } },
    });
    expect(got).toEqual([
      branch("shipify", "task/759-hide-app-names", {
        prs: [{ number: 760, url: url("shipify", 760) }],
      }),
      branch("shipify", "task/761-x", { prs: [{ number: 762, url: url("shipify", 762) }] }),
      branch("shipify", "task/506-old-idea"),
      branch("homelab", "task/12-mine", { ours: false }),
    ]);
  });
});

// A box GitHub dropped (14 days off, or removed there with no `box remove`) left its console link
// in SHIPIFY_CONSOLES: homepi's stayed after the watch saw it gone on 14 Nov (task #803).
describe("what a gone box leaves behind (task #803)", () => {
  const LINKS = { homepi: "https://homepi.tail1.ts.net", workpi: "https://workpi.tail1.ts.net" };
  /** The job's reads and writes, counted. */
  const io = (kept: Record<string, string>, boxes: string[]) => {
    const seen = { boxes: 0, dropped: [] as string[][] };
    const it: ConsolesIo = {
      kept: () => kept,
      boxes: () => {
        seen.boxes++;
        return new Set(boxes);
      },
      takeOut: (gone) => {
        seen.dropped.push(gone);
      },
    };
    return { it, seen };
  };

  it("takes out each console whose box has no runner on GitHub; an offline box keeps its own", () => {
    // workpi's runners are on GitHub, online or not: only homepi's link goes.
    const t = io(LINKS, ["workpi"]);
    expect(dropGoneConsoles(t.it)).toBe(
      "took out homepi's console link: the box has no runner on GitHub",
    );
    expect(t.seen.dropped).toEqual([["homepi"]]);
    const two = io(LINKS, []);
    expect(dropGoneConsoles(two.it)).toBe(
      "took out the console links of homepi and workpi: those boxes have no runner on GitHub",
    );
    expect(two.seen.dropped).toEqual([["homepi", "workpi"]]);
  });

  it("writes nothing when every box is there, and reads nothing when no link is kept", () => {
    const all = io(LINKS, ["homepi", "workpi"]);
    expect(dropGoneConsoles(all.it)).toBe("");
    expect(all.seen.dropped).toEqual([]);
    const none = io({}, []);
    expect(dropGoneConsoles(none.it)).toBe("");
    expect(none.seen).toEqual({ boxes: 0, dropped: [] });
  });

  it("starts the job from the alert only for a gone box that has a link", () => {
    expect(goneLinked({ homepi: "gone", workpi: "offline" }, LINKS)).toEqual(["homepi"]);
    expect(goneLinked({ pi3: "gone" }, LINKS)).toEqual([]);
    expect(goneLinked({ workpi: "online" }, LINKS)).toEqual([]);
  });

  it("reads a missing variable as no link, never writes over one it couldn't read, and deletes it when none is left", () => {
    // gh as it answers: a 404 is "was not found"; another refusal, its HTTP status.
    const bin = mkdtempSync(join(tmpdir(), "consoles-gh-"));
    const log = join(bin, "calls");
    const gh = (answer: string) =>
      writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${log}"\n${answer}\n`, {
        mode: 0o755,
      });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      gh('echo "variable SHIPIFY_CONSOLES was not found" >&2; exit 1');
      expect(readConsoles("o/shipify")).toEqual({});
      gh('echo "failed to get variable SHIPIFY_CONSOLES: HTTP 403: Forbidden" >&2; exit 1');
      expect(() => readConsoles("o/shipify")).toThrow("HTTP 403");
      gh(`echo '${JSON.stringify(LINKS)}'`);
      expect(readConsoles("o/shipify", "bot-full")).toEqual(LINKS);
      keepConsoles("o/shipify", {}, "bot-full");
      expect(readFileSync(log, "utf8").trim().split("\n").at(-1)).toBe(
        "variable delete SHIPIFY_CONSOLES -R o/shipify",
      );
    } finally {
      process.env.PATH = path;
    }
  });

  it("reads the links as kept: a box's https address each; anything else is none", () => {
    expect(consolesOf(JSON.stringify(LINKS))).toEqual(LINKS);
    expect(consolesOf(undefined)).toEqual({});
    expect(consolesOf("")).toEqual({});
    expect(consolesOf("not json")).toEqual({});
    expect(consolesOf("[1]")).toEqual({});
    expect(consolesOf('{"homepi":"https://h","odd":3}')).toEqual({ homepi: "https://h" });
    expect(goneConsoles(LINKS, new Set(["workpi"]))).toEqual(["homepi"]);
  });
});
