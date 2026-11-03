// The weekly clean-up's own two steps (ADR 0069, cli/commands/task/sweep.ts): closed chats' files
// and the 30-day close, once a week in all, however many boxes. And each box's own task folders
// (cli/commands/task/lifecycle.ts), which grow now that an answered task stays open.
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanUpTasks } from "../cli/commands/task/lifecycle.ts";
import {
  cleanable,
  filesToForget,
  QUIET_CLOSED,
  quietToClose,
  type SweepIo,
  sweep,
  sweepDue,
  sweepOnce,
} from "../cli/commands/task/sweep.ts";
import type { SweepRead, SweptIssue } from "../cli/lib/plugins/record.ts";
import { StatusIssueState } from "../cli/lib/status-issue.ts";

const AT = new Date("2026-11-02T03:00:00.000Z");
const issue = (number: number, over: Partial<SweptIssue> = {}): SweptIssue => ({
  number,
  title: `task ${number}`,
  labels: [],
  openParts: 0,
  openPrs: 0,
  ...over,
});
const project = (number: number, name: string, state: "open" | "closed" = "open") =>
  issue(number, {
    title: `Project: ${name}`,
    labels: ["project"],
    ...(state === "closed" ? { closedAt: "x" } : {}),
  });
const inProject = (n: number, state: "open" | "closed" = "open") => ({
  parent: { number: n, state, labels: ["project"] },
});
const none: SweepRead = { closed: [], projects: [], quiet: [] };
const chat = (number: number, state: "open" | "closed" = "closed") => ({ number, state });

describe("the weekly clean-up's files (ADR 0069)", () => {
  it("a closed chat's files go 30 days after; an open project's chats and pages keep theirs", () => {
    const read: SweepRead = {
      ...none,
      // #50 an open project; #60 closed long ago (its chat closed in the window goes).
      projects: [project(50, "shop")],
      closed: [
        issue(10),
        issue(11, inProject(50)),
        issue(12, { labels: ["library", "project:shop"] }),
        issue(13, inProject(60, "closed")),
        issue(14, { labels: ["notebook", "project:gone"] }),
        // A part of a split task outside any project: a chat like any other.
        issue(15, { labels: ["sub-task"], parent: { number: 9, state: "open", labels: [] } }),
      ],
    };
    expect(filesToForget(read, new Map())).toEqual([10, 13, 14, 15]);
  });

  it("a project closed 30 days ago takes its closed chats' and its pages' files; an open chat keeps its own", () => {
    const read: SweepRead = { ...none, closed: [project(70, "trip", "closed")] };
    const items = new Map([[70, { chats: [chat(71), chat(72), chat(73, "open")], pages: [80] }]]);
    expect(filesToForget(read, items)).toEqual([70, 71, 72, 80]);
  });

  it("sends the chats' numbers to the door, reads each closed project's items, and says what went", async () => {
    const asked: Record<string, unknown>[] = [];
    const sent: number[][] = [];
    const io: SweepIo = {
      record: {
        sweep: (q) => {
          asked.push(q);
          return {
            ...none,
            projects: [project(50, "shop")],
            closed: [issue(10), issue(11, inProject(50)), project(70, "trip", "closed")],
          };
        },
        projectItems: (n, label) => {
          asked.push({ n, label });
          return { chats: [chat(71), chat(72, "open")], pages: [80] };
        },
      },
      forget: async (chats) => {
        sent.push(chats);
        return { deleted: 9, bytes: 12_400_000 };
      },
      close: async () => true,
    };
    expect(await sweep(AT, io)).toBe("deleted 9 files (12 MB) of 4 closed chats");
    expect(asked).toEqual([
      {
        closedFrom: "2026-09-03",
        closedTo: "2026-10-03",
        // 30 quiet days (the owner's pick, 2026-11-02: "30 days or less also works"), not 90.
        quietBefore: "2026-10-03",
        // What the 30-day close leaves open, left out of its search so they can't fill its 100.
        quietWithout: [
          "project",
          "in-project",
          "notebook",
          "library",
          "sub-task",
          "repeats",
          "waiting",
          "shipify-status",
          "recipe",
          "deploying",
          "staying",
          "working",
          "needs you",
        ],
      },
      { n: 70, label: "project:trip" },
    ]);
    expect(sent).toEqual([[10, 70, 71, 80]]);
    // Chats with no files, or a second pass over the same ones: nothing deleted, and said so.
    io.forget = async () => ({ deleted: 0, bytes: 0 });
    expect(await sweep(AT, io)).toBe("no files to delete for 4 closed chats");
    io.forget = async () => ({ deleted: 1, bytes: 2_400 });
    expect(await sweep(AT, io)).toBe("deleted 1 file (3 KB) of 4 closed chats");
    // A door that doesn't answer: said, and the same chats come up next week (60-day window).
    io.forget = async () => undefined;
    expect(await sweep(AT, io)).toBe("the door didn't take the files of 4 closed chats: next week");
  });
});

describe("the 30-day close (ADR 0069)", () => {
  const quiet = [
    issue(20),
    issue(21, inProject(50)),
    issue(22, { labels: ["in-project"] }),
    issue(23, { openPrs: 1 }),
    issue(24, { labels: ["repeats"] }),
    issue(25, { labels: ["waiting"] }),
    issue(26, { openParts: 2 }),
    project(27, "shop"),
    issue(28, { labels: ["notebook"] }),
    issue(29, { labels: ["library", "project:shop"] }),
    issue(30, { labels: ["sub-task"], parent: { number: 9, state: "open", labels: [] } }),
    issue(31, { labels: ["shipify-status"] }),
    issue(32, { labels: ["answered", "bug"] }),
    issue(33, { labels: ["deploying"] }),
    // Waits on you: a `new:` task's plan PR (a `part-of` PR, not one that closes it), a question.
    issue(34, { labels: ["needs you"] }),
  ];

  it("closes only a chat in no project, with no open PR, repeat, errand or open part, of no special kind, and not waiting on you", () => {
    expect(quietToClose({ ...none, quiet }).map((i) => i.number)).toEqual([20, 32]);
  });

  it("closes each one and says so in the clean-up's summary; one it couldn't is said too", async () => {
    const closed: [number, string][] = [];
    const io: SweepIo = {
      record: { sweep: () => ({ ...none, quiet }), projectItems: () => ({ chats: [], pages: [] }) },
      forget: async () => undefined,
      close: async (i, at) => {
        closed.push([i.number, at]);
        return i.number !== 32;
      },
    };
    expect(await sweep(AT, io)).toBe(
      "closed 1 chat quiet for 30 days (#20); couldn't close 1 quiet chat (#32): next week",
    );
    expect(closed).toEqual([
      [20, AT.toISOString()],
      [32, AT.toISOString()],
    ]);
    expect(QUIET_CLOSED).toBe("Closed after 30 quiet days: write on it to open it again");
  });

  it("a clean start lists what it would close, whatever their age, but the chat asking (ADR 0070)", () => {
    let asked: Parameters<SweepIo["record"]["sweep"]>[0] | undefined;
    const record = {
      sweep: (q: Parameters<SweepIo["record"]["sweep"]>[0]) => {
        asked = q;
        return { ...none, quiet: [...quiet, issue(35, { updatedAt: "2026-11-01T00:00:00Z" })] };
      },
    };
    expect(cleanable(record, 20, AT.toISOString())).toEqual([
      { n: 32, title: "task 32", labels: ["answered", "bug"] },
      { n: 35, title: "task 35", labels: [], updatedAt: "2026-11-01T00:00:00Z" },
    ]);
    // Every open chat, up to tomorrow, with none of the labels the 30-day close leaves open.
    expect(asked?.quietBefore).toBe("2026-11-03");
    expect(asked?.quietWithout).toContain("needs you");
  });
});

describe("once a week in all, however many boxes (ADR 0069)", () => {
  it("the first box's clean-up takes the steps and writes when; a second box's that week skips them", async () => {
    // One status record, shared by two boxes' clean-ups, as the status issue is.
    let record = StatusIssueState.parse({ v: 2 });
    const store = {
      read: () => structuredClone(record),
      update: (change: (s: StatusIssueState) => string | undefined) => {
        const s = structuredClone(record);
        change(s);
        record = s;
      },
    };
    let ran = 0;
    const steps = async () => `ran ${++ran}`;
    expect(await sweepOnce(AT, store, steps)).toBe("ran 1");
    expect(record.watch.sweep).toBe(AT.toISOString());
    const later = new Date(AT.getTime() + 3600_000);
    expect(await sweepOnce(later, store, steps)).toBeUndefined();
    // Another box read the record before the first wrote it: its own write finds it taken.
    let stale = true;
    const racing = {
      read: () => (stale ? StatusIssueState.parse({ v: 2 }) : record),
      update: store.update,
    };
    expect(await sweepOnce(later, racing, steps)).toBeUndefined();
    stale = false;
    expect(ran).toBe(1);
    // A week on, the next box's clean-up takes them again.
    const week = new Date(AT.getTime() + 7 * 24 * 3600_000);
    expect(sweepDue(record.watch.sweep, week)).toBe(true);
    expect(await sweepOnce(week, store, steps)).toBe("ran 2");
  });

  it("a clean-up started a little short of a week after the last steps takes them: a schedule's jitter skips no week", () => {
    const last = AT.toISOString();
    const at = (ms: number) => new Date(AT.getTime() + 7 * 24 * 3600_000 - ms);
    // Its due run started it some minutes early in the week, or another box's clock is behind.
    expect(sweepDue(last, at(20 * 60_000))).toBe(true);
    expect(sweepDue(last, at(3600_000))).toBe(true);
    expect(sweepDue(last, at(3600_000 + 1))).toBe(false);
    expect(sweepDue(undefined, AT)).toBe(true);
  });
});

describe("a box's task folders (ADR 0069)", () => {
  const DAY = 24 * 3600_000;
  const now = AT.getTime();
  /** A task folder whose step file changed `file` days ago, the folder itself `days` ago. */
  const folder = (ws: string, n: string, days: number, file = days) => {
    const dir = join(ws, ".tasks", n);
    mkdirSync(join(dir, "files"), { recursive: true });
    writeFileSync(join(dir, "plan.json"), "{}");
    const t = (d: number) => new Date(now - d * DAY);
    utimesSync(join(dir, "plan.json"), t(file), t(file));
    utimesSync(join(dir, "files"), t(days), t(days));
    utimesSync(dir, t(days), t(days));
  };

  it("removes a folder unchanged for 7 days with no GitHub call, open task or not; a newer one when its task closed; never a running task's", () => {
    const [one, two] = [mkdtempSync(join(tmpdir(), "slot-")), mkdtempSync(join(tmpdir(), "slot-"))];
    folder(one, "10", 8); // open, idle a week: goes, no call
    folder(one, "11", 8, 2); // a step file changed 2 days ago: asked, open, kept
    folder(one, "12", 1); // closed: asked, goes
    folder(one, "13", 30); // a run queued or under way: kept, never asked
    folder(one, "14", 2); // open, new: asked, kept
    mkdirSync(join(one, ".tasks", "notes"));
    folder(two, "12", 1); // the same task on another slot: asked once
    const asked: string[] = [];
    const io = {
      workspaces: () => [one, two],
      active: () => new Set([13]),
      gone: (n: string) => {
        asked.push(n);
        return n === "12";
      },
    };
    expect(cleanUpTasks(now, io)).toEqual({ folders: 3 });
    expect(asked.sort()).toEqual(["11", "12", "14"]);
    expect(readdirSync(join(one, ".tasks")).sort()).toEqual(["11", "13", "14", "notes"]);
    expect(readdirSync(join(two, ".tasks"))).toEqual([]);
  });
});
