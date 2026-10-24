// A run that stays (ADR 0057, ADR 0063): when a run stays, the gate that hands a normal run only
// what a stay can't do, and the loop: its turns, its clocks, giving way, and leaving with nothing
// unanswered.
import { describe, expect, it } from "vitest";
import { readResult } from "../cli/kernel/result.ts";
import {
  ends,
  GIVE_WAY_MS,
  givesWay,
  LOOK_MS,
  PICK_UP_MS,
  JOB_MINUTES,
  needsMint,
  POLL_MS,
  type StayIo,
  stay,
  stayMinutes,
  staysAfter,
  stayUntil,
  type Turn,
  takes,
} from "../cli/kernel/stay.ts";
import type { Decided, Plan, Snapshot, Think, ThinkMeta, Write } from "../cli/kernel/types.ts";
import { newState } from "../cli/lib/task.ts";

const think = (t: Partial<Think> = {}): Think => ({
  profile: "talk",
  why: "comment",
  notes: [],
  fresh: [7],
  web: true,
  ...t,
});
const plan = (t: Partial<Think> = {}, use?: ReturnType<typeof newState>["use"]): Plan => ({
  do: "think",
  think: think(t),
  state: { ...newState(), ...(use ? { use } : {}) },
  why: "a question",
});
const snap = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    n: 12,
    trigger: { kind: "comment" },
    issue: { title: "disk", body: "", state: "open", labels: [], author: "owner" },
    ...over,
  }) as unknown as Snapshot;
const answer: Decided = {
  writes: [{ w: "reply", kind: "answer", state: "Done", text: "12 GB free.", step: "think-new" }],
  state: newState(),
  needs: {},
};
const meta: ThinkMeta = { readOutside: false, touchesWorkflows: false, session: "s1" };

describe("when a run stays", () => {
  it("stays after an answer to your words, in every profile (ADR 0060)", () => {
    expect(staysAfter(snap(), plan(), answer, meta, 5)).toBe(true);
    expect(staysAfter(snap(), plan({ profile: "read" }), answer, meta, 5)).toBe(true);
    expect(staysAfter(snap(), plan({ profile: "work" }), answer, meta, 5)).toBe(true);
    expect(staysAfter(snap({ trigger: { kind: "opened" } }), plan(), answer, meta, 5)).toBe(true);
  });

  it("never stays for a check, a repeat, a closed task, no session, or when it's off", () => {
    expect(staysAfter(snap(), plan({ check: "disk" }), answer, meta, 5)).toBe(false);
    const due = snap({ trigger: { kind: "dispatch", job: "run" } });
    expect(staysAfter(due, plan({ why: "scheduled" }), answer, meta, 5)).toBe(false);
    // A stay's handover is a dispatch that answers your words: it stays in turn.
    expect(staysAfter(due, plan(), answer, meta, 5)).toBe(true);
    const closed = snap({ issue: { ...snap().issue, state: "closed" } } as Partial<Snapshot>);
    expect(staysAfter(closed, plan(), answer, meta, 5)).toBe(false);
    expect(staysAfter(snap(), plan(), answer, { ...meta, session: undefined }, 5)).toBe(false);
    expect(staysAfter(snap(), plan(), answer, meta, 0)).toBe(false);
  });

  it("stays after your `stop`: the session goes on, so your next words are answered in it", () => {
    const stopped = (why: "asked" | "crash") =>
      ({ ...meta, stopped: why === "asked" ? { why, comment: 9 } : { why, code: 1 } }) as ThinkMeta;
    expect(staysAfter(snap(), plan(), answer, stopped("asked"), 5)).toBe(true);
    // An agent that stopped by itself (a crash, its clock, your plan's limit) leaves no session to trust.
    expect(staysAfter(snap(), plan(), answer, stopped("crash"), 5)).toBe(false);
  });

  it("leaves it to the run that carries on: a work run its answer started, or a close", () => {
    const more = (w: Decided["writes"][number]) => ({ ...answer, writes: [...answer.writes, w] });
    expect(staysAfter(snap(), plan(), more({ w: "dispatch", job: "run" }), meta, 5)).toBe(false);
    expect(staysAfter(snap(), plan(), more({ w: "close" }), meta, 5)).toBe(false);
    expect(ends(more({ w: "dispatch", job: "github" }))).toBe(true);
    expect(ends(answer)).toBe(false);
  });

  it("stays after whatever it applied before the stay: a PR, a question, a list, files", () => {
    // Pushed and opened with keys minted before the stay; the stay's own turns need none.
    const pushed = {
      ...answer,
      needs: { repo: "spotter" },
      writes: [...answer.writes, { w: "push", branch: "task-12" }] as Decided["writes"],
    };
    expect(staysAfter(snap(), plan({ profile: "work" }), pushed, meta, 5)).toBe(true);
    const reply = (over: Record<string, unknown>) =>
      ({ ...answer, writes: [{ ...answer.writes[0], ...over }] }) as Decided;
    const pr = "https://github.com/o/spotter/pull/3";
    const asked = reply({ kind: "needs-you", question: "90 or 120 minutes?" });
    asked.state = { ...newState(), phase: "needs-you", prs: [pr] };
    expect(staysAfter(snap(), plan({ profile: "work" }), asked, meta, 5)).toBe(true);
    expect(staysAfter(snap(), plan(), reply({ kind: "needs-you", list: "k3" }), meta, 5)).toBe(
      true,
    );
    expect(staysAfter(snap(), plan(), reply({ files: ["chart.png"] }), meta, 5)).toBe(true);
  });

  it("knows a turn's result that needs a token minted after the agent: a push, a call, workflows, files (ADR 0062)", () => {
    expect(needsMint(answer)).toBe(false);
    expect(needsMint({ ...answer, needs: { repo: "spotter" } })).toBe(true);
    expect(needsMint({ ...answer, needs: { act: "notion" } })).toBe(true);
    expect(needsMint({ ...answer, needs: { workflows: true } })).toBe(true);
    const files = [{ ...answer.writes[0], files: ["plan.md"] }] as Decided["writes"];
    expect(needsMint({ ...answer, writes: files })).toBe(true);
    const none = [{ ...answer.writes[0], files: [] }] as Decided["writes"];
    expect(needsMint({ ...answer, writes: none })).toBe(false);
  });

  it("never shares the box's own files: an answer that names its handoff needs no key (#532, ADR 0063)", () => {
    const named = (files: string[]) =>
      readResult(JSON.stringify({ v: 2, state: "needs-you", text: "Which one?", files }));
    // The handoff changes every turn: shared, it needed the files key, and the stay ended.
    expect(named(["handoff.md"])).not.toHaveProperty("files");
    expect(named(["out/handoff.md", "result.json", "meta.json", "work.bundle"])).not.toHaveProperty(
      "files",
    );
    expect(named(["handoff.md", "plan.md"])).toMatchObject({ files: ["plan.md"] });
  });

  it("reads SHIPIFY_STAY as whole minutes, 20 by default, 0 for off, with no cap of its own", () => {
    expect(stayMinutes(undefined)).toBe(20);
    expect(stayMinutes("")).toBe(20);
    expect(stayMinutes("0")).toBe(0);
    expect(stayMinutes("10")).toBe(10);
    // Its job's time bounds it, not a cap (ADR 0057, 2026-10-18).
    expect(stayMinutes("90")).toBe(90);
    expect(stayMinutes("soon")).toBe(20);
  });
});

describe("the gate: what a normal run would do, done in the stay (ADR 0063)", () => {
  const claude = { agent: "claude", label: "Claude Code", model: "opus", effort: "high" };

  it("thinks in the same session when plan would think the same way", () => {
    expect(takes(plan(), plan({ fresh: [9] }))).toBe(true);
    // `continue` carries on in it; words with a note or a `use` reply first too.
    expect(takes(plan(), plan({ why: "continue" }))).toBe(true);
    const noted: Plan = { ...(plan() as Extract<Plan, { do: "think" }>), writes: [] };
    if (noted.do === "think") noted.writes = [{ w: "note", topic: "t", line: "l" }];
    expect(takes(plan(), noted)).toBe(true);
  });

  it("keeps the session through a new model or effort: the agent's next ask takes it", () => {
    const sonnet = { agent: "claude", label: "Claude Code", model: "sonnet" };
    expect(takes(plan(), plan({}, sonnet))).toBe(true);
    expect(takes(plan({}, sonnet), plan({}, { ...sonnet, effort: "high" }))).toBe(true);
    expect(takes(plan(), plan({}, claude))).toBe(true);
  });

  it("posts every box answer itself: a `use`, `no`, `yes` to a list, `stop repeating`, `close`, a thanks", () => {
    const box = (...writes: Write[]): Plan => ({
      do: "box",
      writes,
      state: { ...newState(), use: claude },
      why: "a command",
    });
    const reply = { w: "reply", kind: "answer", state: "Done", text: "On Opus.", key: "use-9" };
    expect(takes(plan(), box(reply as Write))).toBe(true);
    // One that needs a key (a list's calls) is decided here and applied by the job (needsMint).
    expect(takes(plan(), box({ w: "calls", calls: [], fingerprint: "k3" }))).toBe(true);
    expect(takes(plan(), box({ w: "close" }))).toBe(true);
  });

  it("hands a normal run only what a stay can't have: another agent, a fresh clone (an edit: the loop's)", () => {
    expect(takes(plan(), plan({}, { agent: "pi", label: "pi" }))).toBe(false);
    for (const why of ["start-over", "go"] as const)
      expect(takes(plan(), plan({ why }))).toBe(false);
    expect(takes(plan(), plan({ check: "disk" }))).toBe(false);
    // Another profile, account or repo: that run's own rules and keys.
    expect(takes(plan(), plan({ profile: "work", project: "spotter" }))).toBe(false);
    expect(takes(plan({ account: "acme" }), plan())).toBe(false);
    const read = { name: "o/r", repo: "o/r" } as unknown as NonNullable<Think["reads"]>[number];
    expect(takes(plan(), plan({ reads: [read] }))).toBe(false);
  });
});

/** When a fake stay's turns must be done by: two hours of its job left, its clock starting at 0. */
const UNTIL = 120 * 60_000;

/** A stay against a clock it controls: each read and turn as a test says, every call recorded. */
function fakeStay({
  news = [],
  turns = [],
  ...over
}: Partial<Omit<StayIo, "news">> & { turns?: Turn[]; news?: boolean[] } = {}) {
  let t = 0;
  const calls: string[] = [];
  const io: StayIo = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    news: () => news.shift() ?? false,
    task: () => "open",
    waiting: () => false,
    turn: async (minutes) => {
      calls.push(`turn ${minutes}`);
      t += 30_000;
      return turns.shift() ?? "answered";
    },
    leave: () => void calls.push("leave"),
    handover: () => void calls.push("handover"),
    ...over,
  };
  return { io, calls, at: () => t };
}

describe("the stay", () => {
  it("answers each time your words come, and leaves after its quiet minutes", async () => {
    const f = fakeStay({ news: [false, true, false, true] });
    const done = await stay(f.io, 5, UNTIL);
    expect(done.answered).toBe(2);
    expect(done.why).toBe("5 quiet minutes");
    expect(f.calls.filter((c) => c.startsWith("turn"))).toHaveLength(2);
    expect(f.calls.at(-1)).toBe("leave");
    // Its quiet minutes count from its last answer.
    expect(f.at()).toBeGreaterThanOrEqual(5 * 60_000 + 2 * 30_000);
  });

  it("gives each turn what's left of its job", async () => {
    const f = fakeStay({ news: [true] });
    await stay(f.io, 5, UNTIL);
    expect(f.calls[0]).toBe("turn 120");
  });

  it("stays past an hour while your words keep coming: no cap but its job's (ADR 0057, 2026-10-18)", async () => {
    // A turn every 30 s for four hours, the job's time still left after it.
    const f = fakeStay({ news: Array(480).fill(true) });
    const done = await stay(f.io, 5, 300 * 60_000);
    expect(done.answered).toBe(480);
    expect(f.at()).toBeGreaterThanOrEqual(240 * 60_000);
  });

  it("starts no turn its job's time would cut short, however busy", async () => {
    const f = fakeStay({ news: Array(400).fill(true) });
    const done = await stay(f.io, 5, UNTIL);
    // Words still coming as it leaves go to a normal run.
    expect(done.why).toBe("its job's time; words that came as it left went to a run");
    expect(f.at()).toBeLessThanOrEqual(UNTIL);
    expect(f.calls.filter((c) => c.startsWith("turn")).at(-1)).toBe("turn 5");
  });

  it("ends its turns within its job's limit, counted from when plan read the task", () => {
    const planned = Date.parse("2026-10-18T06:00:00Z");
    expect(stayUntil(planned)).toBeLessThan(planned + JOB_MINUTES * 60_000);
    expect(stayUntil(planned)).toBeGreaterThan(planned + (JOB_MINUTES - 30) * 60_000);
  });

  it("gives way when another run waits for a slot, and leaves when the task closes", async () => {
    const busy = fakeStay({ waiting: () => true });
    expect((await stay(busy.io, 5, UNTIL)).why).toBe("another run waits for a slot");
    const closed = fakeStay({ task: () => "closed" });
    expect((await stay(closed.io, 5, UNTIL)).why).toBe("the task closed");
    expect(closed.calls).toEqual(["leave"]);
  });

  it("leaves when its label is taken off: a merged plan's build waits for this job (#528)", async () => {
    const f = fakeStay({ task: () => "unlabelled" });
    expect((await stay(f.io, 5, UNTIL)).why).toBe("its label was taken off");
    expect(f.calls).toEqual(["leave"]);
  });

  it("looks at the task and the queue every LOOK_MS, between its reads", async () => {
    let looks = 0;
    const f = fakeStay({
      task: () => {
        looks++;
        return "open";
      },
    });
    await stay(f.io, 1, UNTIL);
    expect(looks).toBe(Math.ceil(60_000 / LOOK_MS));
    expect(POLL_MS).toBeLessThan(LOOK_MS);
  });

  it("answers words already waiting before it gives its slot away, then looks again at once", async () => {
    const f = fakeStay({ news: [true], waiting: () => true });
    const done = await stay(f.io, 5, UNTIL);
    expect(done.answered).toBe(1);
    expect(done.why).toBe("another run waits for a slot");
    expect(f.calls).toEqual(["turn 120", "leave"]);
  });

  it("gives way one slot at a time: slot k after a job has waited (k - 1) steps, never at once", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(givesWay(undefined, now, 1)).toBe(false);
    // A job just queued is a free slot's to pick up: no stay leaves for it yet.
    expect(givesWay(ago(0), now, 1)).toBe(false);
    expect(givesWay(ago(PICK_UP_MS), now, 1)).toBe(true);
    expect(givesWay(ago(GIVE_WAY_MS - 1), now, 2)).toBe(false);
    expect(givesWay(ago(GIVE_WAY_MS), now, 2)).toBe(true);
    expect(givesWay(ago(GIVE_WAY_MS), now, 3)).toBe(false);
    // Stays that began together after a job queued long ago still go one at a time.
    const long = ago(10 * GIVE_WAY_MS);
    expect(givesWay(long, now + PICK_UP_MS, 1, now)).toBe(true);
    expect(givesWay(long, now + PICK_UP_MS, 2, now)).toBe(false);
    expect(givesWay(long, now + GIVE_WAY_MS, 2, now)).toBe(true);
  });

  it("hands words a normal run must take to one, and a task's edited text too", async () => {
    const f = fakeStay({ news: [true], turns: ["handover"] });
    expect((await stay(f.io, 5, UNTIL)).why).toBe("words for a normal run");
    expect(f.calls).toEqual(["turn 120", "handover"]);
    const edited = fakeStay({ task: () => "edited" });
    await stay(edited.io, 5, UNTIL);
    expect(edited.calls).toEqual(["handover"]);
  });

  it("leaves after an answer that started more work", async () => {
    const more = fakeStay({ news: [true], turns: ["left"] });
    const done = await stay(more.io, 5, UNTIL);
    expect(done.answered).toBe(1);
    expect(more.calls.at(-1)).toBe("leave");
  });

  it("ends with an answer that needs a token, for its job to apply: no new run (ADR 0062)", async () => {
    const f = fakeStay({ news: [true], turns: ["apply"] });
    const done = await stay(f.io, 5, UNTIL);
    expect(done.answered).toBe(1);
    expect(done.why).toBe("its answer needs a token");
    // Its label off, and no run started: the job's own steps post the answer.
    expect(f.calls).toEqual(["turn 120", "leave"]);
    // Words that came during the turn still go to a run, which waits for this job.
    const more = fakeStay({ news: [true, true], turns: ["apply"] });
    expect((await stay(more.io, 5, UNTIL)).why).toBe(
      "its answer needs a token; words that came as it left went to a run",
    );
    expect(more.calls.slice(-2)).toEqual(["leave", "handover"]);
  });

  it("leaves nothing unanswered: words that came as it left go to a normal run", async () => {
    // Quiet, then words between its last read and its label coming off.
    const f = fakeStay({ news: [...Array(150).fill(false), true] });
    const done = await stay(f.io, 5, UNTIL);
    expect(f.calls.slice(-2)).toEqual(["leave", "handover"]);
    expect(done.why).toContain("words that came as it left went to a run");
  });

  it("takes nothing from a setting: its quiet minutes go on", async () => {
    const f = fakeStay({ news: [true], turns: ["nothing"] });
    const done = await stay(f.io, 5, UNTIL);
    expect(done.answered).toBe(0);
    expect(done.why).toBe("5 quiet minutes");
  });
});
