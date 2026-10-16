// A run that stays (ADR 0057): after a run answers your words, it keeps reading its task for a few
// quiet minutes and answers your next plain words itself, in the same agent session, so the next
// answer starts in seconds, not in a new run. Anything else goes to a normal run. Plain code: the
// rules are pure functions, and the loop gets its clock and its reads from the step that runs it.
import type { Decided, Plan, Snapshot, ThinkMeta, Write } from "./types.ts";

/**
 * How long a stay waits with nothing to answer, unless SHIPIFY_STAY says (minutes; 0: never): 10
 * covers a pause to read a reply and think (on #462 the longest was 6.5 minutes).
 */
export const STAY_IDLE_MINUTES = 10;
/** A stay starts no turn after this long: its read token lasts GitHub's hour. */
export const STAY_MINUTES = 45;
/** Nor does a turn run past this, from when the stay began: the token's hour, with margin. */
export const STAY_LAST_MINUTES = 55;
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
  return Number.isInteger(n) && n >= 0 ? Math.min(n, STAY_MINUTES) : STAY_IDLE_MINUTES;
}

/** The writes a stay can make itself: none needs a token minted after the agent. */
const QUIET: Write["w"][] = ["reply", "labels", "react", "note"];

/**
 * Whether a run stays after this answer: it answered your words, it thought in the talk or read
 * profile, its agent gave a session to carry on in, the task is open, and what it does needs no
 * token minted after the agent (no push, call, files, dispatch or close), only a plain answer.
 */
export function staysAfter(
  s: Snapshot,
  p: Plan,
  d: Decided,
  meta: ThinkMeta | undefined,
  minutes: number,
): boolean {
  if (minutes <= 0 || p.do !== "think" || p.think.check) return false;
  if (p.think.profile !== "talk" && p.think.profile !== "read") return false;
  // Your words, however its job started: a stay's handover is a dispatch too. A repeat's isn't.
  if (p.think.why === "scheduled") return false;
  if (s.issue.state !== "open" || !meta?.session || meta.stopped) return false;
  if (d.needs.repo || d.needs.act || d.needs.workflows) return false;
  return d.writes.every(
    (w) =>
      QUIET.includes(w.w) &&
      (w.w !== "reply" || (w.kind === "answer" && !w.files?.length && !w.list)),
  );
}

/**
 * Whether a stay may answer new words itself: plan, asked again, makes the choice the run made: to
 * think, with the same profile, account, project, repos, web and agent, model and effort, and
 * nothing for the box to do first. Any other choice is a normal run's, so every account's and
 * repo's rules hold as they are.
 */
export function sameTurn(first: Plan, next: Plan): boolean {
  if (first.do !== "think" || next.do !== "think") return false;
  if (next.writes?.length || next.think.check) return false;
  const a = first.think;
  const b = next.think;
  const reads = (t: typeof a) =>
    (t.reads ?? [])
      .map((r) => r.name)
      .sort()
      .join(",");
  const use = (p: typeof first) => JSON.stringify(p.state.use ?? null);
  return (
    a.profile === b.profile &&
    a.account === b.account &&
    a.project === b.project &&
    a.base === b.base &&
    a.ownRules === b.ownRules &&
    a.web === b.web &&
    reads(a) === reads(b) &&
    use(first) === use(next)
  );
}

/** What one turn came to. */
export type Turn =
  /** Your words, answered in the session. */
  | "answered"
  /** Nothing to answer (a setting, someone else's words). */
  | "nothing"
  /** Words a normal run must take: a fixed word, another account, a result that needs a token. */
  | "handover"
  /** Answered, with a write a stay never follows (a run started for work, a close): it leaves. */
  | "left";

export interface StayIo {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Whether your words wait: a read that finds nothing new costs nothing. */
  news(): boolean;
  /** The task's state: open, closed, or its text edited since the run read it. */
  task(): "open" | "closed" | "edited";
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
 * quiet minutes pass, STAY_MINUTES are up, the task closes, another run needs the slot, or words
 * need a normal run. As it leaves, its label comes off first, then one last read: words that came
 * meanwhile go to a normal run, never unanswered.
 */
export async function stay(io: StayIo, idle: number): Promise<Stayed> {
  const start = io.now();
  let last = start;
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
    if (t - start >= STAY_MINUTES * 60_000) return end(`${STAY_MINUTES} minutes`);
    if (t - last >= idle * 60_000) return end(`${idle} quiet minutes`);
    // Your words first: a turn waiting is answered before the stay gives its slot away.
    const news = safe(io.news);
    if (news instanceof Error) return end(`a read failed: ${news.message}`);
    if (!news && t - looked >= LOOK_MS) {
      looked = t;
      const task = safe(io.task);
      if (task instanceof Error) return end(`a read failed: ${task.message}`);
      if (task === "closed") return end("the task closed");
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
    const left = STAY_LAST_MINUTES - Math.floor((t - start) / 60_000);
    const r = await io.turn(left);
    if (r === "handover") {
      io.handover();
      return { answered, why: "words for a normal run" };
    }
    if (r === "left") return end(`${++answered === 1 ? "its" : "an"} answer started more work`);
    if (r === "answered") {
      answered++;
      last = io.now();
    }
    // Then a look at once: a run that waited through the turn gets the slot now.
    looked = Number.NEGATIVE_INFINITY;
  }
}
