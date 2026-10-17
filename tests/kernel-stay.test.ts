// A run that stays (ADR 0057): when a run stays, the gate that keeps every other choice a normal
// run's, and the loop: its turns, its clocks, giving way, and leaving with nothing unanswered.
import { describe, expect, it } from "vitest";
import {
  boxAnswer,
  GIVE_WAY_MS,
  givesWay,
  LOOK_MS,
  PICK_UP_MS,
  POLL_MS,
  STAY_LAST_MINUTES,
  STAY_MINUTES,
  type StayIo,
  sameTurn,
  stay,
  stayMinutes,
  staysAfter,
  type Turn,
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

  it("leaves it to the run that carries on: a work run its answer started, or a close", () => {
    const more = (w: Decided["writes"][number]) => ({ ...answer, writes: [...answer.writes, w] });
    expect(staysAfter(snap(), plan(), more({ w: "dispatch", job: "run" }), meta, 5)).toBe(false);
    expect(staysAfter(snap(), plan(), more({ w: "close" }), meta, 5)).toBe(false);
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

  it("reads SHIPIFY_STAY as whole minutes, 20 by default, 0 for off, at most STAY_MINUTES", () => {
    expect(stayMinutes(undefined)).toBe(20);
    expect(stayMinutes("")).toBe(20);
    expect(stayMinutes("0")).toBe(0);
    expect(stayMinutes("10")).toBe(10);
    expect(stayMinutes("600")).toBe(STAY_MINUTES);
    expect(stayMinutes("soon")).toBe(20);
  });
});

describe("the gate: plan asked again makes the same choice", () => {
  it("lets a stay answer when plan would think the same way", () => {
    expect(sameTurn(plan(), plan({ fresh: [9] }))).toBe(true);
  });

  it("takes a `use` that comes to the agent, model and effort already running as no change (ADR 0059)", () => {
    // Auto runs Claude Code's Sonnet at medium (executors.json): naming it is the same session.
    const sonnet = { agent: "claude", label: "Claude Code", model: "sonnet" };
    expect(sameTurn(plan(), plan({}, sonnet))).toBe(true);
    expect(sameTurn(plan({}, sonnet), plan({}, { ...sonnet, effort: "medium" }))).toBe(true);
    // Another model or effort is a new session.
    expect(sameTurn(plan({}, sonnet), plan({}, { ...sonnet, effort: "high" }))).toBe(false);
    expect(sameTurn(plan(), plan({}, { ...sonnet, model: "opus" }))).toBe(false);
  });

  it("hands everything else to a normal run: another profile, account, repo, agent or model", () => {
    expect(sameTurn(plan(), plan({ profile: "work", project: "spotter" }))).toBe(false);
    expect(sameTurn(plan({ account: "acme" }), plan())).toBe(false);
    const read = { name: "o/r", repo: "o/r" } as unknown as NonNullable<Think["reads"]>[number];
    expect(sameTurn(plan(), plan({ reads: [read] }))).toBe(false);
    expect(sameTurn(plan(), plan({}, { agent: "pi", label: "pi" }))).toBe(false);
    const claude = { agent: "claude", label: "Claude Code" };
    expect(sameTurn(plan({}, claude), plan({}, { ...claude, model: "opus" }))).toBe(false);
    const box: Plan = { do: "box", writes: [], state: newState(), why: "yes" };
    expect(sameTurn(plan(), box)).toBe(false);
    const noted: Plan = { ...(plan() as Extract<Plan, { do: "think" }>), writes: [] };
    if (noted.do === "think") noted.writes = [{ w: "note", topic: "t", line: "l" }];
    expect(sameTurn(plan(), noted)).toBe(false);
  });
});

describe("the box's own answers in a stay (ADR 0059)", () => {
  const claude = { agent: "claude", label: "Claude Code", model: "opus", effort: "high" };
  const said = (use: typeof claude | undefined, ...writes: Write[]): Plan => ({
    do: "box",
    writes,
    state: { ...newState(), ...(use ? { use } : {}) },
    why: "a command",
  });
  const reply = (over: Partial<Extract<Write, { w: "reply" }>> = {}) =>
    ({
      w: "reply",
      kind: "answer",
      state: "Done",
      text: "On Opus · high.",
      key: "use-9",
      ...over,
    }) as Write;

  it("posts one itself when the pick is as it was: a `use` you're already on, a thanks", () => {
    expect(boxAnswer(plan({}, claude), said(claude, reply()))).toBe(true);
    expect(
      boxAnswer(plan({}, claude), said(claude, { w: "react", comment: 9, content: "+1" })),
    ).toBe(true);
  });

  it("posts a `use` that comes to what's already running, Auto's model named (ADR 0059)", () => {
    const named = { agent: "claude", label: "Claude Code", model: "sonnet", effort: "medium" };
    expect(boxAnswer(plan(), said(named as typeof claude, reply()))).toBe(true);
  });

  it("hands a new pick, a reply with files or a list, or a write a stay never makes to a normal run", () => {
    expect(boxAnswer(plan({}, claude), said({ ...claude, effort: "medium" }, reply()))).toBe(false);
    expect(boxAnswer(plan(), said(claude, reply()))).toBe(false);
    expect(boxAnswer(plan({}, claude), said(claude, reply({ files: ["a.png"] })))).toBe(false);
    expect(boxAnswer(plan({}, claude), said(claude, reply({ list: "k3" })))).toBe(false);
    expect(boxAnswer(plan({}, claude), said(claude, { w: "close" } as Write))).toBe(false);
    expect(boxAnswer(plan({}, claude), said(claude))).toBe(false);
    expect(boxAnswer(plan({}, claude), plan({}, claude))).toBe(false);
  });
});

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
    const done = await stay(f.io, 5);
    expect(done.answered).toBe(2);
    expect(done.why).toBe("5 quiet minutes");
    expect(f.calls.filter((c) => c.startsWith("turn"))).toHaveLength(2);
    expect(f.calls.at(-1)).toBe("leave");
    // Its quiet minutes count from its last answer.
    expect(f.at()).toBeGreaterThanOrEqual(5 * 60_000 + 2 * 30_000);
  });

  it("gives each turn only what's left of its token's hour", async () => {
    const f = fakeStay({ news: [true] });
    await stay(f.io, 5);
    expect(f.calls[0]).toBe(`turn ${STAY_LAST_MINUTES}`);
  });

  it("starts no turn after STAY_MINUTES, however busy", async () => {
    const f = fakeStay({ news: Array(200).fill(true) });
    const done = await stay(f.io, 5);
    // Words still coming as it leaves go to a normal run.
    expect(done.why).toBe(`${STAY_MINUTES} minutes; words that came as it left went to a run`);
    expect(f.at()).toBeLessThan((STAY_MINUTES + 1) * 60_000);
  });

  it("gives way when another run waits for a slot, and leaves when the task closes", async () => {
    const busy = fakeStay({ waiting: () => true });
    expect((await stay(busy.io, 5)).why).toBe("another run waits for a slot");
    const closed = fakeStay({ task: () => "closed" });
    expect((await stay(closed.io, 5)).why).toBe("the task closed");
    expect(closed.calls).toEqual(["leave"]);
  });

  it("looks at the task and the queue every LOOK_MS, between its reads", async () => {
    let looks = 0;
    const f = fakeStay({
      task: () => {
        looks++;
        return "open";
      },
    });
    await stay(f.io, 1);
    expect(looks).toBe(Math.ceil(60_000 / LOOK_MS));
    expect(POLL_MS).toBeLessThan(LOOK_MS);
  });

  it("answers words already waiting before it gives its slot away, then looks again at once", async () => {
    const f = fakeStay({ news: [true], waiting: () => true });
    const done = await stay(f.io, 5);
    expect(done.answered).toBe(1);
    expect(done.why).toBe("another run waits for a slot");
    expect(f.calls).toEqual([`turn ${STAY_LAST_MINUTES}`, "leave"]);
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
    expect((await stay(f.io, 5)).why).toBe("words for a normal run");
    expect(f.calls).toEqual([`turn ${STAY_LAST_MINUTES}`, "handover"]);
    const edited = fakeStay({ task: () => "edited" });
    await stay(edited.io, 5);
    expect(edited.calls).toEqual(["handover"]);
  });

  it("leaves after an answer that started more work", async () => {
    const more = fakeStay({ news: [true], turns: ["left"] });
    const done = await stay(more.io, 5);
    expect(done.answered).toBe(1);
    expect(more.calls.at(-1)).toBe("leave");
  });

  it("leaves nothing unanswered: words that came as it left go to a normal run", async () => {
    // Quiet, then words between its last read and its label coming off.
    const f = fakeStay({ news: [...Array(150).fill(false), true] });
    const done = await stay(f.io, 5);
    expect(f.calls.slice(-2)).toEqual(["leave", "handover"]);
    expect(done.why).toContain("words that came as it left went to a run");
  });

  it("takes nothing from a setting: its quiet minutes go on", async () => {
    const f = fakeStay({ news: [true], turns: ["nothing"] });
    const done = await stay(f.io, 5);
    expect(done.answered).toBe(0);
    expect(done.why).toBe("5 quiet minutes");
  });
});
