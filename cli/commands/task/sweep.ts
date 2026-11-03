// The weekly clean-up's own two steps (ADR 0069 §2, §15), with no agent: the files of chats closed
// 30 to 60 days ago go from the edge's store, and a chat quiet for 30 days closes. Each box runs
// its own clean-up (watch.ts), so these run once a week in all, however many boxes: the status
// record keeps when they last ran, as it keeps the digest's time. One read finds it all (the
// record's `sweep`), and one more for each project closed in the window.
import {
  DEPLOYING_LABEL,
  IN_PROJECT_LABEL,
  LIBRARY_LABEL,
  PROJECT_LABEL,
  projectLabel,
  projectNameOf,
  STAYING_LABEL,
  SUB_TASK_LABEL,
} from "../../contracts/index.ts";
import { forgetFiles } from "../../kernel/door.ts";
import { NOTEBOOK_LABEL } from "../../lib/notebook.ts";
import type { ProjectItems, SweepRead, SweptIssue, TaskRecord } from "../../lib/plugins/record.ts";
import { RECIPE_LABEL } from "../../lib/recipes.ts";
import { REPEATS_LABEL, WAITING_LABEL } from "../../lib/repeat.ts";
import { STATUS_LABEL, type StatusIssueState } from "../../lib/status-issue.ts";
import { findStatus, TASK_LABELS } from "../../lib/task.ts";
import { rec } from "./context.ts";
import { Status } from "./issue.ts";

const DAY = 24 * 3600_000;
/** The steps run once in this long, in all. */
const SWEEP_EVERY_MS = 7 * DAY;
/** A closed chat's files go this many days after it closes… */
const FILES_AFTER_DAYS = 30;
/** …read up to this many, so a missed week catches up, and a second pass deletes nothing more. */
const FILES_UNTIL_DAYS = 60;
/**
 * A chat outside a project with no word or change for this long closes (your pick, 2026-11-02: 30,
 * not 90); its files go 30 days after that. A word on it opens it again.
 */
const QUIET_DAYS = 30;
/** Its status line says why, and how to carry it on. */
export const QUIET_CLOSED = `Closed after ${QUIET_DAYS} quiet days: write on it to open it again`;

const PROJECT = PROJECT_LABEL;
const IN_PROJECT = IN_PROJECT_LABEL;
const LIBRARY = LIBRARY_LABEL;

/**
 * What the 30-day close leaves open, by label: a project, a chat in one, a page, a split's part, a
 * repeat or an errand, the status task, a recipe, a task a run is on or follows, and a task that
 * waits on you (a question, or a `new:` task's plan PR, which doesn't close it).
 */
const KEPT = new Set([
  PROJECT,
  IN_PROJECT,
  NOTEBOOK_LABEL.name,
  LIBRARY,
  SUB_TASK_LABEL,
  REPEATS_LABEL.name,
  WAITING_LABEL.name,
  STATUS_LABEL.name,
  RECIPE_LABEL.name,
  DEPLOYING_LABEL,
  STAYING_LABEL,
  TASK_LABELS.working.name,
  TASK_LABELS["needs-you"].name,
]);

/** A week less this is a week: a clean-up started a little early, or a box's clock, skips none. */
const SWEEP_SLACK_MS = 3600_000;

/**
 * Whether the steps are due: never run, or a week ago (less an hour). `last` and `at` are clean-ups'
 * start times, as the due run starts each a week after the last one's start.
 */
export const sweepDue = (last: string | undefined, at: Date) =>
  !last || at.getTime() - Date.parse(last) >= SWEEP_EVERY_MS - SWEEP_SLACK_MS;

/** A chat in a project: its parent is one (its sub-issue, or moved in with `in-project`). */
const parentProject = (i: SweptIssue) => Boolean(i.parent?.labels.includes(PROJECT));

/**
 * The chats whose files go (ADR 0069 §15): each one closed in the window that isn't in an open
 * project (its parent an open `project`, or, for a page, its `project:<name>` label naming one),
 * and the closed chats and every page of a project closed in the window (`items`, by the project's
 * number). An open chat of a closed project keeps its files: it's still yours.
 */
export function filesToForget(read: SweepRead, items: Map<number, ProjectItems>): number[] {
  const names = new Set(read.projects.map((p) => projectNameOf(p.title)).filter(Boolean));
  const kept = (i: SweptIssue) =>
    (parentProject(i) && i.parent?.state === "open") ||
    i.labels.some((l) => l.startsWith(`${PROJECT}:`) && names.has(l.slice(PROJECT.length + 1)));
  const out = new Set(read.closed.filter((i) => !kept(i)).map((i) => i.number));
  for (const { chats, pages } of items.values()) {
    for (const c of chats) if (c.state === "closed") out.add(c.number);
    for (const n of pages) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The open chats the 30-day close takes (ADR 0069 §2): quiet that long, in no project, with no open
 * PR or open part, and none of the kinds it leaves open (KEPT). The search leaves KEPT out already;
 * the check stays here, as a search can't leave out a parent or a `project:<name>` label.
 */
export const quietToClose = (read: SweepRead): SweptIssue[] =>
  read.quiet.filter(
    (i) =>
      !parentProject(i) &&
      !i.labels.some((l) => KEPT.has(l) || l.startsWith(`${PROJECT}:`)) &&
      !i.openParts &&
      !i.openPrs,
  );

/** A clean start's chat (ADR 0070): its number, title and labels, and its last change. */
export interface Cleanable {
  n: number;
  title: string;
  labels: string[];
  updatedAt?: string;
}

/**
 * A clean start's list (ADR 0070 §7): the open chats the 30-day close would take, whatever their
 * age (its own rules: no project, nothing it leaves open), but the one asking; the oldest 100, in
 * the clean-up's one read.
 */
export function cleanable(record: Pick<TaskRecord, "sweep">, n: number, at: string): Cleanable[] {
  const tomorrow = new Date(Date.parse(at) + DAY).toISOString().slice(0, 10);
  const read = record.sweep({
    closedFrom: tomorrow,
    closedTo: tomorrow,
    quietBefore: tomorrow,
    quietWithout: [...KEPT],
  });
  return quietToClose(read)
    .filter((i) => i.number !== n)
    .map((i) => ({
      n: i.number,
      title: i.title,
      labels: i.labels,
      ...(i.updatedAt ? { updatedAt: i.updatedAt } : {}),
    }));
}

/** What the steps read and write. */
export interface SweepIo {
  record: Pick<TaskRecord, "sweep" | "projectItems">;
  /** The edge's word: these chats' files deleted (forgetFiles); undefined when it didn't answer. */
  forget(chats: number[]): Promise<{ deleted: number; bytes: number } | undefined>;
  /** Closed as completed, with its status line; whether it was. */
  close(i: SweptIssue, at: string): Promise<boolean>;
}

const day = (at: Date, daysAgo: number) =>
  new Date(at.getTime() - daysAgo * DAY).toISOString().slice(0, 10);
const megabytes = (bytes: number) =>
  bytes < 1e6 ? `${Math.ceil(bytes / 1e3)} KB` : `${Math.round(bytes / 1e6)} MB`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const numbers = (ns: number[]) => ns.map((n) => `#${n}`).join(", ");

/**
 * The two steps, as the clean-up's summary says what each really did: "deleted 12 files (8 MB) of
 * 4 closed chats", "no files to delete for 3 closed chats" (none had any, or a pass before took
 * them), "closed 2 chats quiet for 30 days (#20, #31)", and what didn't happen, to try next week.
 */
export async function sweep(at: Date, io: SweepIo = liveIo()): Promise<string> {
  const read = io.record.sweep({
    closedFrom: day(at, FILES_UNTIL_DAYS),
    closedTo: day(at, FILES_AFTER_DAYS),
    quietBefore: day(at, QUIET_DAYS),
    // What stays open for ever can't fill the search's 100, so the real quiet chats are reached.
    quietWithout: [...KEPT],
  });
  // A project closed in the window takes its closed chats' and its pages' files with it.
  const items = new Map<number, ProjectItems>();
  for (const p of read.closed.filter((i) => i.labels.includes(PROJECT))) {
    const name = projectNameOf(p.title);
    if (name) items.set(p.number, io.record.projectItems(p.number, projectLabel(name)));
  }
  const said: string[] = [];
  const chats = filesToForget(read, items);
  if (chats.length) {
    const gone = await io.forget(chats);
    const of = plural(chats.length, "closed chat");
    said.push(
      !gone
        ? `the door didn't take the files of ${of}: next week`
        : gone.deleted
          ? `deleted ${plural(gone.deleted, "file")} (${megabytes(gone.bytes)}) of ${of}`
          : `no files to delete for ${of}`,
    );
  }
  const quiet = quietToClose(read);
  const closed: number[] = [];
  const left: number[] = [];
  for (const i of quiet) ((await io.close(i, at.toISOString())) ? closed : left).push(i.number);
  if (closed.length)
    said.push(
      `closed ${plural(closed.length, "chat")} quiet for ${QUIET_DAYS} days (${numbers(closed)})`,
    );
  if (left.length)
    said.push(`couldn't close ${plural(left.length, "quiet chat")} (${numbers(left)}): next week`);
  return said.join("; ") || "nothing to clear";
}

/**
 * The steps on this box's clean-up, once a week in all: taken when the record says they're a week
 * old, and the time written at once, in the same read and write, so a second box's clean-up that
 * reads it next skips them. Undefined when it's another box's week.
 */
export async function sweepOnce(
  at: Date,
  record: {
    read: () => StatusIssueState;
    update: (change: (s: StatusIssueState) => string | undefined) => unknown;
  },
  steps: () => Promise<string>,
): Promise<string | undefined> {
  if (!sweepDue(record.read().watch.sweep, at)) return undefined;
  let mine = false;
  record.update((s) => {
    mine = sweepDue(s.watch.sweep, at);
    if (mine) s.watch.sweep = at.toISOString();
    return undefined;
  });
  return mine ? steps() : undefined;
}

/** A clean start's close says so on its status line (ADR 0070). */
export const CLEAN_CLOSED = "Closed by your clean start: write on it to open it again";

/**
 * The 30-day close (ADR 0069 §2), and a clean start's (ADR 0070): closed as completed, never not
 * planned (that closes its PRs), and its status says why on its Last action line (`why`). Its state
 * labels go with the status's `done`. It starts no job: the close is the workflow's own.
 */
export async function closeQuiet(
  i: Pick<SweptIssue, "number" | "labels">,
  at: string,
  why = QUIET_CLOSED,
): Promise<boolean> {
  try {
    rec().updateIssue(i.number, { state: "closed", state_reason: "completed" });
  } catch {
    return false;
  }
  try {
    const { comment, state } = findStatus(rec().comments(i.number));
    state.action = { text: why, at };
    state.closes = undefined;
    const issue = { number: i.number, labels: i.labels.map((name) => ({ name })) };
    await new Status(issue, comment?.id, state).save("done", {}, { keepRun: true });
  } catch {
    // Closed all the same: its status catches up when a run next reads it.
  }
  return true;
}

const liveIo = (): SweepIo => ({ record: rec(), forget: forgetFiles, close: closeQuiet });
