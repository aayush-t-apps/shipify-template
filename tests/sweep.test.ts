// The weekly clean-up's own steps (ADR 0069, cli/commands/task/sweep.ts): closed chats' files, the
// 30-day close and a closed project's pages left open (task #744), once a week in all, however many
// boxes. And each box's own task folders (cli/commands/task/lifecycle.ts), which grow now that an
// answered task stays open.
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanUpTasks } from "../cli/commands/task/lifecycle.ts";
import {
  cleanable,
  filesToForget,
  pagesToClose,
  QUIET_CLOSED,
  quietToClose,
  type SweepIo,
  sweep,
  sweepDue,
  sweepOnce,
} from "../cli/commands/task/sweep.ts";
import type { SweepRead, SweptIssue } from "../cli/lib/plugins/record.ts";
import { StatusIssueState, setSwept } from "../cli/lib/status-issue.ts";

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
const none: SweepRead = { closed: [], projects: [], pages: [], quiet: [] };
/** The door's answer when it deleted nothing. */
const gone = { deleted: 0, bytes: 0, unclaimed: 0, unclaimedBytes: 0 };
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
        return { ...gone, deleted: 9, bytes: 12_400_000 };
      },
      close: async () => true,
      closePage: async () => true,
    };
    expect(await sweep(AT, io)).toEqual({
      said: "deleted 9 files (12 MB) of 4 closed chats",
      deleted: 9,
      bytes: 12_400_000,
      unclaimed: 0,
    });
    expect(asked).toEqual([
      {
        closedFrom: "2026-09-03",
        closedTo: "2026-10-03",
        // 30 quiet days (the owner's pick, 2026-11-02: "30 days or less also works"), not 90.
        quietBefore: "2026-10-03",
        // What the 30-day close leaves open, left out of its search so they can't fill its 100. A
        // chat moved into a project (`in-project`) isn't: its project may be closed.
        quietWithout: [
          "project",
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
    io.forget = async () => gone;
    expect((await sweep(AT, io)).said).toBe("no files to delete for 4 closed chats");
    io.forget = async () => ({ ...gone, deleted: 1, bytes: 2_400 });
    expect((await sweep(AT, io)).said).toBe("deleted 1 file (3 KB) of 4 closed chats");
    // A door that doesn't answer: said, and the same chats come up next week (60-day window).
    io.forget = async () => ({ ...gone, failed: true });
    expect(await sweep(AT, io)).toEqual({
      said: "the door didn't take the files of 4 closed chats: next week",
      deleted: 0,
      bytes: 0,
      unclaimed: 0,
      failed: "the door didn't take the files",
    });
  });

  it("asks the door every week, with no closed chats too, and says the files no chat used it deleted", async () => {
    const sent: number[][] = [];
    const io: SweepIo = {
      record: { sweep: () => none, projectItems: () => ({ chats: [], pages: [] }) },
      forget: async (chats) => {
        sent.push(chats);
        return { ...gone, unclaimed: 2, unclaimedBytes: 1_200_000 };
      },
      close: async () => true,
      closePage: async () => true,
    };
    expect(await sweep(AT, io)).toEqual({
      said: "deleted 2 files no chat used (1 MB), 60 days old",
      deleted: 2,
      bytes: 1_200_000,
      unclaimed: 2,
    });
    expect(sent).toEqual([[]]);
    io.record.sweep = () => ({ ...none, closed: [issue(10), issue(11)] });
    io.forget = async () => ({
      deleted: 3,
      bytes: 2_000_000,
      unclaimed: 2,
      unclaimedBytes: 1_000_000,
    });
    expect(await sweep(AT, io)).toEqual({
      said: "deleted 3 files (2 MB) of 2 closed chats; 2 files no chat used (1 MB), 60 days old",
      deleted: 5,
      bytes: 3_000_000,
      unclaimed: 2,
    });
  });

  it("reads from 30 days before the last clean-up's start, so one missed for weeks catches up; 60 days at least", async () => {
    const asked: string[] = [];
    const io: SweepIo = {
      record: {
        sweep: (q) => {
          asked.push(`${q.closedFrom}..${q.closedTo}`);
          return none;
        },
        projectItems: () => ({ chats: [], pages: [] }),
      },
      forget: async () => gone,
      close: async () => true,
      closePage: async () => true,
    };
    await sweep(AT, io, "2026-08-01T03:00:00.000Z");
    // A week ago: 60 days still, so a week the door didn't take is tried again.
    await sweep(AT, io, "2026-10-26T03:00:00.000Z");
    expect(asked).toEqual(["2026-07-02..2026-10-03", "2026-09-03..2026-10-03"]);
  });
});

describe("the 30-day close (ADR 0069)", () => {
  const quiet = [
    issue(20),
    issue(21, inProject(50)),
    issue(22, { labels: ["in-project"], ...inProject(50) }),
    // Left open under a closed project: a chat like any other.
    issue(36, inProject(60, "closed")),
    issue(37, { labels: ["in-project"], ...inProject(60, "closed") }),
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

  it("closes only a chat in no open project, with no open PR, repeat, errand or open part, of no special kind, and not waiting on you", () => {
    expect(quietToClose({ ...none, quiet }).map((i) => i.number)).toEqual([20, 36, 37, 32]);
  });

  it("closes each one and says so in the clean-up's summary; one it couldn't is said too", async () => {
    const closed: [number, string][] = [];
    const io: SweepIo = {
      record: { sweep: () => ({ ...none, quiet }), projectItems: () => ({ chats: [], pages: [] }) },
      forget: async () => gone,
      close: async (i, at) => {
        closed.push([i.number, at]);
        return i.number !== 32;
      },
      closePage: async () => true,
    };
    expect((await sweep(AT, io)).said).toBe(
      "closed 3 chats quiet for 30 days (#20, #36, #37); couldn't close 1 quiet chat (#32): next week",
    );
    expect(closed.map(([n]) => n)).toEqual([20, 36, 37, 32]);
    expect(closed[0]).toEqual([20, AT.toISOString()]);
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
      { n: 36, title: "task 36", labels: [] },
      { n: 37, title: "task 37", labels: ["in-project"] },
      { n: 32, title: "task 32", labels: ["answered", "bug"] },
      { n: 35, title: "task 35", labels: [], updatedAt: "2026-11-01T00:00:00Z" },
    ]);
    // Every open chat, up to tomorrow, with none of the labels the 30-day close leaves open.
    expect(asked?.quietBefore).toBe("2026-11-03");
    expect(asked?.quietWithout).toContain("needs you");
  });
});

describe("a closed project's pages left open (task #744)", () => {
  const page = (number: number, name?: string) =>
    issue(number, {
      title: `Notebook: ${name ?? `journal ${number}`}`,
      labels: ["library", ...(name ? [`project:${name}`] : [])],
    });
  const pages = [page(40, "shop"), page(41, "trip"), page(42), page(43, "trip"), page(44, "gone")];

  it("closes the open pages of every project that isn't open; an open project's and a page of none stay", () => {
    const read = { ...none, projects: [project(50, "shop")], pages };
    expect(pagesToClose(read).map((i) => i.number)).toEqual([41, 43, 44]);
  });

  it("closes none when the open projects fill the read: one past its 100 may be open", () => {
    const full = Array.from({ length: 100 }, (_, i) => project(100 + i, `p${i}`));
    expect(pagesToClose({ ...none, projects: full, pages })).toEqual([]);
  });

  it("closes each one and says so in the clean-up's summary; one it couldn't is said too", async () => {
    const shut: number[] = [];
    const io: SweepIo = {
      record: {
        sweep: () => ({ ...none, projects: [project(50, "shop")], pages }),
        projectItems: () => ({ chats: [], pages: [] }),
      },
      forget: async () => gone,
      close: async () => true,
      closePage: async (n) => {
        shut.push(n);
        return n !== 44;
      },
    };
    expect((await sweep(AT, io)).said).toBe(
      "closed 2 pages of closed projects (#41, #43); couldn't close 1 page of closed projects (#44): next week",
    );
    expect(shut).toEqual([41, 43, 44]);
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
    const lasts: (string | undefined)[] = [];
    const steps = async (last?: string) => {
      lasts.push(last);
      return `ran ${++ran}`;
    };
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
    // Each takes the last one's start, as it was before it wrote its own.
    expect(lasts).toEqual([undefined, AT.toISOString()]);
  });

  it("the record keeps the last one's files and how many failed in a row; the second in a row alerts you, once, with the fix", () => {
    const s = StatusIssueState.parse({ v: 2 });
    const failed = { deleted: 0, bytes: 0, unclaimed: 0, failed: "the door didn't take the files" };
    expect(setSwept(s, failed)).toBeUndefined();
    expect(setSwept(s, failed)).toBe(
      "The weekly clean-up failed twice: the door didn't take the files. Check the door: `pnpm ship door check`.",
    );
    expect(s.watch.swept).toEqual({ ...failed, failures: 2 });
    expect(setSwept(s, failed)).toBeUndefined();
    expect(setSwept(s, { deleted: 5, bytes: 3_000_000, unclaimed: 2 })).toBeUndefined();
    expect(s.watch.swept).toEqual({ deleted: 5, bytes: 3_000_000, unclaimed: 2, failures: 0 });
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
