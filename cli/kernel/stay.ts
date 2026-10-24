// A run that stays (ADR 0057, one rule since ADR 0063): after a run answers your words, it keeps
// reading its task for a few quiet minutes and does with your next words what a normal run would
// do, in the same job and agent session, so the next answer starts in seconds. It hands over only
// what needs what a stay can't have: another agent, a fresh clone, or the task's text read again.
// An answer that needs a write key ends it, for its job to apply (ADR 0062). Plain code: the rules
// are pure functions, and the loop gets its clock and its reads from the step that runs it.
import { taskAgent } from "./agent.ts";
import type { Decided, Plan, Snapshot, ThinkMeta, ThinkWhy } from "./types.ts";

/**
 * How long a stay waits with nothing to answer, unless SHIPIFY_STAY says (minutes; 0: never): 20
 * covers a pause to read a reply and think (on #462 the longest was 6.5 minutes), as the owner
 * asked (ADR 0059).
 */
export const STAY_IDLE_MINUTES = 20;
/**
 * task.yml's job limit (`timeout-minutes`; tests/workflows.test.ts holds them equal). A stay has no
 * cap of its own: it takes what its job has left (ADR 0057, 2026-10-18). Its record reads and
 * writes use the job's token, which lasts the job; past an hour, only the agent's own reads fail,
 * as in a long work run.
 */
export const JOB_MINUTES = 460;
/** Of the job, kept from a stay: the setup before plan read the task, the last turn's decide and
 * apply, and the label off. */
const JOB_MARGIN_MINUTES = 15;
/** A stay starts no turn with less than this left of its job. */
const TURN_MINUTES = 5;
/** When a stay's turns must be done by, for a run whose plan read the task at `planned`. */
export const stayUntil = (planned: number) => planned + (JOB_MINUTES - JOB_MARGIN_MINUTES) * 60_000;
/** How often the task is read for new words (a read that finds nothing new costs nothing). */
export const POLL_MS = 2_000;
/** How often it looks whether the task closed or another run waits for a slot. */
export const LOOK_MS = 15_000;
/**
 * Stays give way one at a time: a stay on slot k waits until a job has waited (k - 1) times this,
 * so the slot freed first takes it (its job's end and a runner's pick-up take about 10 s) and the
 * other stays go on.
 */
export const GIVE_WAY_MS = 20_000;
/** Nor before this, on any slot: a free slot picks a new job up in a few seconds. */
export const PICK_UP_MS = 10_000;

/**
 * Whether a job waiting since `since` is this slot's to take: slot k gives way after (k - 1) steps,
 * counted from when it could first see the job (it waited, or this stay began, whichever is later),
 * so stays that begin together after a job queued still give way one at a time.
 */
export const givesWay = (since: string | undefined, now: number, slot: number, began = 0) =>
  since !== undefined &&
  now - Math.max(Date.parse(since), began) >= Math.max(PICK_UP_MS, (slot - 1) * GIVE_WAY_MS);

/** The quiet minutes a run stays, from SHIPIFY_STAY: a whole number of minutes, 0 to turn it off. */
export function stayMinutes(setting: string | undefined): number {
  const v = (setting ?? "").trim();
  if (!v) return STAY_IDLE_MINUTES;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : STAY_IDLE_MINUTES;
}

/** Whether an answer starts another run (a work run, a build) or closes the task: no stay follows. */
export const ends = (d: Pick<Decided, "writes">): boolean =>
  d.writes.some((w) => w.w === "dispatch" || w.w === "close");

/**
 * Whether a run stays after this answer (ADR 0060): it answered your words, in any profile, its
 * agent gave a session to carry on in, and the task stays open with no other run carrying on from
 * it (a work run its answer started, the GitHub job). What it pushed, opened or listed was applied
 * before the stay, with keys minted then: a stay's own turns need none (run.ts hands those over).
 */
export function staysAfter(
  s: Snapshot,
  p: Plan,
  d: Decided,
  meta: ThinkMeta | undefined,
  minutes: number,
): boolean {
  if (minutes <= 0 || p.do !== "think" || p.think.check) return false;
  // Your words, however its job started: a stay's handover is a dispatch too. A repeat's isn't.
  if (p.think.why === "scheduled") return false;
  if (s.issue.state !== "open" || !meta?.session) return false;
  // Your `stop` ends the agent's work, not its session: your next words carry on in it. An agent
  // that stopped by itself (a crash, its clock, your plan's limit) leaves no session to trust.
  if (meta.stopped && meta.stopped.why !== "asked") return false;
  return !ends(d);
}

/** Why plan's think needs a fresh clone: never a stay's turn. (An edit of the task's text is the
 * loop's: `task()` reads it, and it hands over.) */
const FRESH: ThinkWhy[] = ["start-over", "go"];

/**
 * Whether a stay takes plan's choice for new words itself (ADR 0063): what a normal run would do,
 * in the same job. The box's own answer, always: a `use`, `no`, `yes` to a list, `stop repeating`,
 * `close`, a thanks (one that needs a key ends the stay, for its job to apply). A think in the same
 * session: the same profile, account, project, repos, web and agent, the model and effort as plan
 * picks them now (the session takes a new one), on the clone it has (not `start over` or `go`).
 * Anything else is a normal run's, so every account's and repo's rules hold as they are.
 */
export function takes(first: Plan, next: Plan): boolean {
  if (next.do === "box") return true;
  if (first.do !== "think" || next.do !== "think") return false;
  if (next.think.check || FRESH.includes(next.think.why)) return false;
  const a = first.think;
  const b = next.think;
  const reads = (t: typeof a) =>
    (t.reads ?? [])
      .map((r) => r.name)
      .sort()
      .join(",");
  return (
    a.profile === b.profile &&
    a.account === b.account &&
    a.project === b.project &&
    a.base === b.base &&
    a.ownRules === b.ownRules &&
    a.web === b.web &&
    // A session stays with its agent; a new model or effort is its next ask's (ADR 0063).
    reads(a) === reads(b) &&
    taskAgent(first.state) === taskAgent(next.state)
  );
}

/**
 * Whether a decided result needs a token minted after the agent (a repo's write key, a tool's,
 * shipify's files branch): a stay's turn with one ends, and its job's steps apply it (ADR 0062).
 */
export const needsMint = (d: Pick<Decided, "needs" | "writes">): boolean =>
  !!(d.needs.repo || d.needs.act || d.needs.workflows) ||
  d.writes.some((w) => w.w === "reply" && !!w.files?.length);

/** What one turn came to. */
export type Turn =
  /** Your words, answered in the session. */
  | "answered"
  /** Nothing to answer (a setting, someone else's words). */
  | "nothing"
  /** Words a normal run must take: another agent, account or repo, a fresh clone, a closed task. */
  | "handover"
  /** Answered, with a result that needs a token minted after the agent: its job applies it. */
  | "apply"
  /** Answered, with a write a stay never follows (a run started, a close): it leaves. */
  | "left";

export interface StayIo {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Whether your words wait: a read that finds nothing new costs nothing. */
  news(): boolean;
  /**
   * The task's state: open, closed, its text edited since the run read it, or its `staying` label
   * taken off (a merged plan's build waits for this job, or the watch found no run going).
   */
  task(): "open" | "closed" | "edited" | "unlabelled";
  /** Whether another run waits for this slot: long enough that no other stay's slot took it. */
  waiting(): boolean;
  /** One turn: plan, think, decide and apply, as a run does, in this process. */
  turn(minutes: number): Promise<Turn>;
  /** `staying` off. */
  leave(): void;
  /** `staying` off, then a normal run started for the task. */
  handover(): void;
}

/** Whether words wait, or an error when the read failed. */
function safeNews(io: StayIo): boolean | Error {
  try {
    return io.news();
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** How a stay ended: how many answers it gave, and why it left. */
export interface Stayed {
  answered: number;
  why: string;
}

/**
 * The stay: it reads the task every POLL_MS and takes each turn your words bring, until `idle`
 * quiet minutes pass, its job's time (`until`) is nearly up, the task closes, another run needs the
 * slot, or words need a normal run. As it leaves, its label comes off first, then one last read:
 * words that came meanwhile go to a normal run, never unanswered.
 */
export async function stay(io: StayIo, idle: number, until: number): Promise<Stayed> {
  let last = io.now();
  let looked = Number.NEGATIVE_INFINITY;
  let answered = 0;
  const end = (why: string): Stayed => {
    io.leave();
    // Unreadable as it leaves: a run of their own takes any words, as the label is off.
    if (safeNews(io) !== true) return { answered, why };
    io.handover();
    return { answered, why: `${why}; words that came as it left went to a run` };
  };
  // A read that fails ends the stay (said in its log): your next words start a run of their own.
  const safe = <T>(read: () => T): T | Error => {
    try {
      return read();
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  };
  for (;;) {
    const t = io.now();
    // Each turn gets what's left of its job: none starts that the job's limit would cut short.
    const left = Math.floor((until - t) / 60_000);
    if (left < TURN_MINUTES) return end("its job's time");
    if (t - last >= idle * 60_000) return end(`${idle} quiet minutes`);
    // Your words first: a turn waiting is answered before the stay gives its slot away.
    const news = safe(io.news);
    if (news instanceof Error) return end(`a read failed: ${news.message}`);
    if (!news && t - looked >= LOOK_MS) {
      looked = t;
      const task = safe(io.task);
      if (task instanceof Error) return end(`a read failed: ${task.message}`);
      if (task === "closed") return end("the task closed");
      if (task === "unlabelled") return end("its label was taken off");
      if (task === "edited") {
        io.handover();
        return { answered, why: "its text was edited" };
      }
      const busy = safe(io.waiting);
      if (busy === true) return end("another run waits for a slot");
    }
    if (!news) {
      await io.sleep(POLL_MS);
      continue;
    }
    const r = await io.turn(left);
    if (r === "handover") {
      io.handover();
      return { answered, why: "words for a normal run" };
    }
    if (r === "left") return end(`${++answered === 1 ? "its" : "an"} answer started more work`);
    // Its job's next steps mint the tokens and post it (ADR 0062): words after it go to a run.
    if (r === "apply") return end(`${++answered === 1 ? "its" : "an"} answer needs a token`);
    if (r === "answered") {
      answered++;
      last = io.now();
    }
    // Then a look at once: a run that waited through the turn gets the slot now.
    looked = Number.NEGATIVE_INFINITY;
  }
}
