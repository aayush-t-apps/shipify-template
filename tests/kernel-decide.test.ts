import { describe, expect, it } from "vitest";
import { afterThink, type Context, laterWords, plan, stillWaiting } from "../cli/kernel/decide.ts";
import { buildPrompt, type PromptInput } from "../cli/kernel/prompt.ts";
import { type Result, readResult } from "../cli/kernel/result.ts";
import type { Plan, Said, Snapshot, Think, Write } from "../cli/kernel/types.ts";
import { repeatLine } from "../cli/lib/repeat.ts";
import { newState, type TaskState } from "../cli/lib/task.ts";

// decide, as plain data (ADR 0031): every intent, every fixed word and where it's accepted, and the
// edge cases the ADR and its reviews decided, with no GitHub.

const NOW = "2026-10-05T10:00:00.000Z";

function snap(
  over: Omit<Partial<Snapshot>, "state"> & { state?: Partial<TaskState> } = {},
): Snapshot {
  const { state, ...rest } = over;
  return {
    n: 12,
    issue: {
      title: "ask: what is spotter?",
      body: "",
      state: "open",
      labels: [],
      author: "owner",
      isPr: false,
    },
    said: [],
    state: { ...newState(), ...state } as TaskState,
    trigger: { kind: "opened" },
    now: NOW,
    run: { id: "777", url: "https://github.com/o/shipify/actions/runs/777" },
    parsed: { kind: "question", ask: "what is spotter?" },
    bodyHash: "aaaa",
    projects: ["spotter", "links", "playground"],
    repos: [
      ...["spotter", "links", "playground"].map((id) => ({
        name: id,
        repo: `o/${id}`,
        sizeKB: 100,
        project: true,
        branch: "main",
      })),
      // One of your repos whose default branch isn't main: its PRs go against `master` (ADR 0045).
      { name: "old-tool", repo: "o/old-tool", sizeKB: 50, project: false, branch: "master" },
      // One of your repos that isn't a project (ADR 0044).
      { name: "notes-app", repo: "o/notes-app", sizeKB: 50, project: false, branch: "main" },
    ],
    isTask: true,
    ...rest,
  };
}

const ctx = (over: Partial<Context> = {}): Context => ({
  tools: {
    notion: {
      calls: { update_page: () => true, create_page: (a) => typeof a.title === "string" },
      pre: [{ call: "create_page", fixed: { parent: "inbox" }, caps: { title: 200 }, max: 3 }],
    },
  },
  use: (text) =>
    /^\/use$/.test(text)
      ? { reply: "This task uses Auto. A `use` takes …", asked: true }
      : /^use opus$/.test(text)
        ? {
            use: { agent: "claude", model: "opus", label: "Opus" },
            reply: "From the next run: Opus.",
          }
        : /^use pi opus$/.test(text)
          ? { reply: "“use pi opus” names no model pi has.", tried: true }
          : /^use /.test(text)
            ? { reply: "“use banana” names no model I know." }
            : undefined,
  planMerged: (id) => id === "tipcalc",
  timeZone: "UTC",
  taskUrl: "https://github.com/o/shipify/issues/12",
  operateForm: "https://github.com/o/shipify/issues/new?template=7-operate.yml",
  instant: (name, rest) => `answer to /${name}${rest ? ` ${rest}` : ""}`,
  ...over,
});

const said = (id: number, text: string, over: Partial<Said> = {}): Said => ({
  id,
  author: "owner",
  text,
  at: NOW,
  edited: false,
  channel: "github",
  ...over,
});
const viaChat = (id: number, text: string): Said =>
  said(id, text, {
    author: "door",
    channel: "telegram",
    from: { v: 1, person: "owner", channel: "telegram", chat: "42", id: `u${id}` },
  });

const writes = (p: Plan) => (p.do === "box" ? p.writes : []);
const replies = (ws: Write[]) =>
  ws.filter((w): w is Extract<Write, { w: "reply" }> => w.w === "reply");
const kinds = (ws: Write[]) => ws.map((w) => w.w);
// A task that already ran once: it has a status and a body as last read.
const ran = (over: Partial<TaskState> = {}): Partial<TaskState> => ({
  bodyHash: "aaaa",
  seen: 100,
  ...over,
});

describe("plan: what runs at all", () => {
  it("runs nothing for a PR, someone else's issue, or something that isn't a task", () => {
    expect(plan(snap({ isTask: false }), ctx()).do).toBe("nothing");
    expect(plan(snap({ issue: { ...snap().issue, isPr: true } }), ctx()).do).toBe("nothing");
    expect(plan(snap({ issue: { ...snap().issue, author: "other" } }), ctx()).do).toBe("nothing");
  });

  it("does nothing when nothing is new: a second job for one event", () => {
    const p = plan(snap({ trigger: { kind: "comment" }, state: ran(), statusId: 5 }), ctx());
    expect(p.do).toBe("nothing");
  });

  it("asks for words when a first run has none, with no agent", () => {
    const p = plan(
      snap({ issue: { ...snap().issue, title: "ask:" }, parsed: { kind: "question", ask: "" } }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(replies(writes(p))[0]?.text).toContain("nothing to do yet");
  });
});

describe("plan: intents", () => {
  it("a question thinks with no clone up front, and says working first", () => {
    const p = plan(snap(), ctx());
    expect(p.do).toBe("think");
    if (p.do !== "think") return;
    expect(p.think.profile).toBe("talk");
    expect(p.state.working).toBe(777);
  });

  it("a change to a known project thinks on its checkout; an unknown one reads as plain words", () => {
    const p = plan(
      snap({
        issue: { ...snap().issue, title: "spotter: bigger font" },
        parsed: { kind: "app", project: "spotter", ask: "bigger font" },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({ profile: "work", project: "spotter" });
    const q = plan(
      snap({
        issue: { ...snap().issue, title: "Bug: it's blank" },
        parsed: { kind: "app", project: "bug", ask: "it's blank" },
      }),
      ctx(),
    );
    expect(q.do === "think" && q.think.profile).toBe("talk");
    expect(q.do === "think" && q.think.notes[0]).toContain("no project or repo here");
  });

  it("a change to another of your repos works on it its own way; Shipify itself stays Shipify's", () => {
    const p = plan(
      snap({
        issue: { ...snap().issue, title: "notes-app: fix the typo" },
        parsed: { kind: "app", project: "notes-app", ask: "fix the typo" },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "work",
      project: "notes-app",
      ownRules: true,
    });
    const own = plan(
      snap({
        issue: { ...snap().issue, title: "shipify: a typo" },
        parsed: { kind: "app", project: "shipify", ask: "a typo" },
        repos: [
          ...snap().repos,
          { name: "shipify", repo: "o/shipify", sizeKB: 1, project: false, branch: "main" },
        ],
      }),
      ctx(),
    );
    expect(own.do === "think" && own.think.ownRules).toBeUndefined();
    const project = plan(
      snap({
        issue: { ...snap().issue, title: "spotter: bigger font" },
        parsed: { kind: "app", project: "spotter", ask: "bigger font" },
      }),
      ctx(),
    );
    expect(project.do === "think" && project.think.ownRules).toBeUndefined();
  });

  it("a change to a repo of yours whose default branch isn't main works on that branch (ADR 0045)", () => {
    const p = plan(
      snap({
        issue: { ...snap().issue, title: "old-tool: fix it" },
        parsed: { kind: "app", project: "old-tool", ask: "fix it" },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "work",
      project: "old-tool",
      ownRules: true,
      base: "master",
    });
    // A repo on main, and a project, name no base: main is the one they have.
    const q = plan(
      snap({
        issue: { ...snap().issue, title: "notes-app: fix it" },
        parsed: { kind: "app", project: "notes-app", ask: "fix it" },
      }),
      ctx(),
    );
    expect(q.do === "think" && q.think.base).toBeUndefined();
  });

  it("a new project thinks on shipify, for its plan", () => {
    const p = plan(snap({ parsed: { kind: "new", ask: "a tip calculator" } }), ctx());
    expect(p.do === "think" && p.think).toMatchObject({ profile: "work", project: "shipify" });
  });

  it("once its plan is built, a new project's runs work on its repo: the build brief until it's published", () => {
    const built = (projects: string[]) =>
      plan(
        snap({
          parsed: { kind: "new", ask: "a tip calculator" },
          said: [said(101, "continue")],
          projects,
          state: ran({ project: "tipcalc", built: "tipcalc", plan: "tipcalc", phase: "failed" }),
        }),
        ctx(),
      );
    // A failed first build, then `continue`: its repo isn't listed yet (no shipify.json on main).
    const again = built(["spotter"]);
    expect(again.do === "think" && again.think).toMatchObject({
      profile: "work",
      project: "tipcalc",
    });
    expect(again.do === "think" && again.think.notes.join(" ")).toContain(
      "ask for a PR of kind publish",
    );
    // Published: an ordinary change, with no build brief.
    const later = built(["spotter", "tipcalc"]);
    expect(later.do === "think" && later.think).toMatchObject({
      profile: "work",
      project: "tipcalc",
    });
    expect(later.do === "think" && later.think.notes.join(" ")).not.toContain("kind publish");
  });

  it("remember writes the note with no agent and closes; an empty one asks", () => {
    const p = plan(
      snap({ parsed: { kind: "remember", ask: "short answers", topic: "Preferences" } }),
      ctx(),
    );
    expect(kinds(writes(p))).toEqual(["note", "reply", "close"]);
    const q = plan(snap({ parsed: { kind: "remember", ask: "" } }), ctx());
    expect(replies(writes(q))[0]?.text).toContain("What should I remember?");
  });

  it("an operation runs once on GitHub's machines, and never from a chat", () => {
    const op = { kind: "op" as const, project: "spotter", ask: "release", op: "down" as const };
    const p = plan(snap({ parsed: op }), ctx());
    expect(p.do).toBe("box");
    expect(kinds(writes(p))).toContain("dispatch");
    expect(p.do === "box" && p.state.pending.operate?.op).toBe("down");
    const chat = plan(snap({ parsed: op, issue: { ...snap().issue, author: "door" } }), ctx());
    expect(replies(writes(chat))[0]?.text).toContain("start only from GitHub");
    expect(kinds(writes(chat))).toContain("close");
  });
});

describe("plan: forms", () => {
  const form = {
    form: { id: "repeat", fields: [] } as never,
    answers: {},
    problems: ["“When” says “someday”"],
  };
  it("runs nothing on a wrong answer, says so once, and starts when an edit fixes it", () => {
    const p = plan(snap({ form }), ctx());
    expect(replies(writes(p))[0]?.problem?.code).toBe("form-wrong");
    expect(p.do === "box" && p.state.form).toContain("someday");
    const fixed = plan(
      snap({
        form: { ...form, problems: [] },
        bodyHash: "bbbb",
        trigger: { kind: "edited" },
        statusId: 5,
        state: ran({ form: "x" }),
      }),
      ctx(),
    );
    expect(fixed.do).toBe("think");
  });

  it("the Repeat form sets its repeat with no agent", () => {
    const p = plan(
      snap({ repeatForm: { what: "Stretch", when: "every day at 09:00", kind: "reminder" } }),
      ctx(),
    );
    expect(p.do === "box" && p.state.repeat).toMatchObject({
      kind: "reminder",
      every: "every day at 09:00",
    });
    expect(kinds(writes(p))).toEqual(["labels", "coming-up", "reply"]);
  });
});

describe("plan: a lone thanks", () => {
  const okOn = (state: Partial<TaskState>) =>
    plan(snap({ said: [viaChat(101, "ok")], statusId: 5, state: ran(state) }), ctx());

  it("answers a question waiting on you: the agent reads it", () => {
    expect(okOn({ phase: "needs-you" }).do).toBe("think");
  });

  it("after a PR to merge, a list for your yes, or an answer, it's a thanks: a 👍, no agent", () => {
    const pr = okOn({ phase: "needs-you", prs: ["https://github.com/o/spotter/pull/3"] });
    expect(pr.do).toBe("box");
    expect(writes(pr)).toContainEqual({ w: "react", comment: 101, content: "+1" });
    expect(replies(writes(pr))).toEqual([]);
    expect(pr.do === "box" && pr.state.seen).toBe(101);
    const list = okOn({
      phase: "needs-you",
      pending: {
        calls: { calls: [], fingerprint: "f", post: 0, at: NOW },
      },
    });
    expect(list.do).toBe("box");
    // Your list still waits for your yes.
    expect(list.do === "box" && list.state.pending.calls).toBeTruthy();
    expect(okOn({ phase: "answered" }).do).toBe("box");
  });

  it("an ok on a closed task whose question still waited answers it: the task carries on", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue: { ...snap().issue, state: "closed", closedAt: "2026-10-05T09:00:00.000Z" },
        state: ran({ phase: "needs-you" }),
        said: [said(101, "ok")],
      }),
      ctx(),
    );
    expect(p.do).toBe("think");
  });

  it("a thanks on a task the run closed itself (a note) leaves it closed too", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue: { ...snap().issue, state: "closed", closedAt: "2026-10-05T09:00:00.000Z" },
        state: ran({ phase: "answered" }),
        said: [said(101, "thanks")],
      }),
      ctx(),
    );
    expect(kinds(writes(p))).not.toContain("reopen");
    expect(kinds(writes(p))).toContain("react");
    expect(p.do === "box" && p.state.phase).toBe("done");
  });

  it("a thanks well after a close leaves the task closed: a 👍, no reopen", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue: { ...snap().issue, state: "closed", closedAt: "2026-10-05T09:00:00.000Z" },
        state: ran({ phase: "done" }),
        said: [said(101, "thanks!")],
      }),
      ctx(),
    );
    expect(kinds(writes(p))).toEqual(["react"]);
  });

  it("a thanks with an edit of the task's text: the edit is read", () => {
    const p = plan(
      snap({
        said: [viaChat(101, "ok")],
        statusId: 5,
        bodyHash: "bbbb",
        state: ran({ phase: "answered" }),
      }),
      ctx(),
    );
    expect(p.do).toBe("think");
  });
});

describe("plan: fixed words, and where each is accepted", () => {
  const base = (texts: Said[], st: Partial<TaskState> = {}) =>
    snap({ trigger: { kind: "comment" }, statusId: 5, state: ran(st), said: texts });

  it("`use opus` alone changes the model and runs nothing else; an unknown one says so", () => {
    const p = plan(base([said(101, "use opus")]), ctx());
    expect(p.do === "box" && p.state.use?.model).toBe("opus");
    expect(replies(writes(p))[0]?.text).toBe("From the next run: Opus.");
    const q = plan(base([said(101, "use banana")]), ctx());
    expect(replies(writes(q))[0]?.text).toContain("names no model");
    // A setting from a chat, then your words: this run thinks with it, and says nothing of it.
    const r = plan(base([said(101, "use opus"), said(102, "and make it blue")]), ctx());
    expect(r.do).toBe("think");
    expect(r.state?.use?.model).toBe("opus");
    expect(replies(writes(r)).some((w) => /next run/.test(w.text))).toBe(false);
  });

  it("a `use` line in a longer message picks this run's model, from GitHub or a chat (task #168)", () => {
    const p = plan(base([said(101, "how confident are we on the changes?\nuse opus")]), ctx());
    expect(p.do).toBe("think");
    expect(p.state?.use?.model).toBe("opus");
    // No reply of its own: the run's details name the model it thought with.
    expect(p.do === "think" && (p.writes ?? []).some((w) => w.w === "reply")).toBe(false);
    // Words that name no model stay words for the agent, and change nothing.
    const q = plan(base([said(101, "which css to use?\nuse tailwind")]), ctx());
    expect(q.do).toBe("think");
    expect(q.state?.use?.model).toBeUndefined();
  });

  it("a `use` line naming a pick it can't take is told, and nothing runs with the old one (#233)", () => {
    const p = plan(base([viaChat(101, "make the header blue\nuse pi opus")]), ctx());
    expect(p.do).toBe("box");
    // Read: you send it again with a pick it takes.
    expect(p.state?.seen).toBe(101);
    expect(p.state?.use).toBeUndefined();
    const [r] = replies(writes(p));
    expect(r).toMatchObject({ kind: "needs-you", state: "Needs you" });
    expect(r?.text).toContain("“use pi opus” names no model pi has.");
    expect(r?.text).toContain("Nothing ran");
    // A new task's own `use` line, the same.
    const first = plan(snap({ firstUse: "pi opus" }), ctx());
    expect(first.do).toBe("box");
    expect(replies(writes(first))[0]?.text).toContain("“use pi opus” names no model pi has.");
    expect(plan(snap({ firstUse: "opus" }), ctx()).state?.use?.model).toBe("opus");
  });

  it("`/use` alone on GitHub is answered with the task's pick, and your other words still run", () => {
    const p = plan(base([said(101, "/use"), said(102, "make it blue")]), ctx());
    expect(p.do).toBe("think");
    expect(replies(p.do === "think" ? (p.writes ?? []) : [])[0]?.text).toContain(
      "This task uses Auto",
    );
  });

  it("a `use` alone that it can't take, read with your other words, runs nothing either", () => {
    const p = plan(base([viaChat(101, "use pi opus"), viaChat(102, "fix the bug")]), ctx());
    expect(p.do).toBe("box");
    expect(p.state?.seen).toBe(102);
    expect(p.state?.use).toBeUndefined();
    const texts = replies(writes(p)).map((r) => r.text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("“use pi opus” names no model pi has.");
    expect(texts[0]).toContain("Nothing ran");
  });

  it("`stop` with no run going says there was nothing to stop, from a chat too; on a repeat, how to end it", () => {
    const p = plan(base([viaChat(101, "stop")]), ctx());
    expect(p.do).toBe("box");
    expect(p.state?.seen).toBe(101);
    expect(replies(writes(p))[0]?.text).toBe(
      "Nothing was working by then, so there was nothing to stop.",
    );
    const every = {
      kind: "reminder" as const,
      every: "every Monday at 09:00",
      next: NOW,
      fails: 0,
    };
    const q = plan(base([said(101, "Stop.")], { repeat: every }), ctx());
    expect(replies(writes(q))[0]?.text).toContain("say `stop repeating`");
    // With words after it, the words run.
    expect(plan(base([said(101, "stop"), said(102, "make it red")]), ctx()).do).toBe("think");
  });

  it("the words a run takes in before it answers: plain ones, up to the first the next run must read", () => {
    const later = [
      said(99, "already read"),
      said(102, "also blue"),
      viaChat(103, "and bigger"),
      said(104, "use opus"),
      said(105, "after the use"),
    ];
    const w = laterWords(later, 101);
    expect(w.plain.map((c) => c.id)).toEqual([102, 103]);
    expect(w.stop).toBeUndefined();
    const stops = (x: Said) => laterWords([said(102, "more"), x, said(104, "stop")], 101);
    for (const x of [
      said(103, "close"),
      said(103, "/apps"),
      said(103, "remember: tabs"),
      said(103, "thanks!"),
      said(103, "edited", { edited: true }),
      said(103, "a line\nuse opus high"),
      said(103, "see ![x](https://github.com/user-attachments/assets/1)"),
      viaChat(103, "photo"),
    ]) {
      if (x.from) x.from.files = [{ ref: "telegram:1", name: "photo.jpg" }];
      const got = stops(x);
      expect(
        got.plain.map((c) => c.id),
        x.text,
      ).toEqual([102]);
      expect(got.stop?.id).toBe(104);
    }
    // A run that can fetch files takes in words with one (#188: a screenshot with every ask); what
    // the next run must read still stops the list, and says how many wait.
    const shot = said(103, "see ![x](https://github.com/user-attachments/assets/1)");
    const photo = viaChat(104, "photo");
    if (photo.from) photo.from.files = [{ ref: "telegram:1", name: "photo.jpg" }];
    expect(
      laterWords(
        [said(102, "more"), shot, photo, said(105, "use opus"), said(106, "x")],
        101,
        true,
      ),
    ).toEqual({ plain: [said(102, "more"), shot, photo], waiting: 2 });
    expect(laterWords([said(102, "more"), shot, said(104, "x")], 101)).toEqual({
      plain: [said(102, "more")],
      waiting: 2,
    });
    // Only yours: a run's own reply and someone else's words count for nothing.
    expect(
      laterWords([said(102, "x", { author: "run" }), said(103, "y", { author: "other" })], 101),
    ).toEqual({ plain: [] });
  });

  const pending = {
    pending: {
      calls: {
        calls: [{ tool: "notion", name: "update_page", args: { id: "p1" } }],
        fingerprint: "f",
        post: 100,
        at: NOW,
      },
    },
  };

  it("a whole, unedited `yes` on GitHub after the list makes exactly the listed calls", () => {
    const p = plan(base([said(101, "yes")], pending), ctx());
    expect(writes(p).find((w) => w.w === "calls")).toMatchObject({ fingerprint: "f" });
    expect(p.do === "box" && p.state.pending.calls).toBeUndefined();
  });

  it("refuses a yes from a chat, an edited yes, and a yes after a day", () => {
    expect(
      replies(writes(plan(base([viaChat(101, "yes")], pending), ctx())))[0]?.problem?.code,
    ).toBe("not-allowed-here");
    expect(
      replies(writes(plan(base([said(101, "yes", { edited: true })], pending), ctx())))[0]?.text,
    ).toContain("edited");
    const late = {
      pending: { calls: { ...pending.pending.calls, at: "2026-10-03T10:00:00.000Z" } },
    };
    expect(replies(writes(plan(base([said(101, "yes")], late), ctx())))[0]?.problem?.code).toBe(
      "approval-expired",
    );
  });

  it("`no` drops the list; other words after it plan again", () => {
    const p = plan(base([said(101, "no")], pending), ctx());
    expect(replies(writes(p))[0]?.text).toContain("Dropped");
    const q = plan(base([said(101, "make it two pages instead")], pending), ctx());
    expect(q.do).toBe("think");
    expect(q.state?.pending.calls).toBeUndefined();
  });

  it("with nothing listed, `yes` and `no` are plain words for the agent, from anywhere", () => {
    for (const c of [said(101, "yes"), viaChat(101, "yes"), said(101, "no")]) {
      const p = plan(base([c]), ctx());
      expect(p.do).toBe("think");
      expect(replies(writes(p))).toEqual([]);
    }
  });

  it("`stop repeating` and `resume` need no agent, from anywhere", () => {
    const rep = {
      repeat: { kind: "reminder" as const, every: "every day at 09:00", next: NOW, fails: 0 },
    };
    const p = plan(base([viaChat(101, "stop repeating")], rep), ctx());
    expect(p.do === "box" && p.state.repeat).toBeUndefined();
    expect(kinds(writes(p))).toContain("close");
    // Its label goes too, so a stopped repeat leaves every list of repeats (a paused one keeps it).
    expect(writes(p)).toContainEqual({ w: "labels", remove: ["repeats"] });
    const q = plan(base([said(101, "resume")], { repeat: { ...rep.repeat, paused: true } }), ctx());
    expect(q.do === "box" && q.state.repeat?.paused).toBe(false);
  });

  it("`publish` needs a merged plan, and starts the github job", () => {
    expect(replies(writes(plan(base([said(101, "publish")]), ctx())))[0]?.text).toContain(
      "no merged plan",
    );
    const p = plan(base([said(101, "publish")], { plan: "tipcalc" }), ctx());
    expect(p.do === "box" && p.state.pending.prepare?.plan).toBe("tipcalc");
    expect(kinds(writes(p))).toContain("dispatch");
  });

  it("`preview` needs an open PR; `go` needs the doc merged; both only on GitHub", () => {
    expect(replies(writes(plan(base([said(101, "preview")]), ctx())))[0]?.text).toContain(
      "no PR yet",
    );
    const pr = "https://github.com/o/spotter/pull/3";
    const p = plan(base([said(101, "preview")], { project: "spotter", prs: [pr] }), ctx());
    expect(writes(p).find((w) => w.w === "preview")).toMatchObject({ repo: "spotter", pr });
    // A repo that keeps its own rules has no preview, and gets nothing of Shipify's (ADR 0044).
    const repo = "https://github.com/o/notes-app/pull/3";
    const own = plan(
      base([said(101, "preview")], { project: "notes-app", ownRules: true, prs: [repo] }),
      ctx(),
    );
    expect(writes(own).some((w) => w.w === "preview")).toBe(false);
    expect(replies(writes(own))[0]?.text).toContain("A preview is an app's");
    expect(
      replies(
        writes(plan(base([viaChat(101, "preview")], { project: "spotter", prs: [pr] }), ctx())),
      )[0]?.problem?.code,
    ).toBe("not-allowed-here");
    expect(replies(writes(plan(base([said(101, "go")]), ctx())))[0]?.text).toContain(
      "Merge the change doc",
    );
    const go = plan(
      base([said(101, "go")], {
        project: "spotter",
        prInfo: { [pr]: { kind: "change", state: "merged" } },
        prs: [pr],
      }),
      ctx(),
    );
    expect(go.do === "think" && go.think.why).toBe("go");
  });

  it("`continue` tries again after a failure and clears it", () => {
    const p = plan(
      base([said(101, "continue")], {
        failed: { at: NOW, problem: { code: "unexpected", what: "x", fix: "y" } },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think.why).toBe("continue");
    expect(p.state?.failed).toBeUndefined();
  });
});

describe("plan: closes", () => {
  it("closed as not planned: its open PRs close on GitHub's machines", () => {
    const pr = "https://github.com/o/spotter/pull/3";
    const p = plan(
      snap({
        trigger: { kind: "closed" },
        statusId: 5,
        issue: { ...snap().issue, state: "closed", stateReason: "not_planned", closedAt: NOW },
        state: ran({ prs: [pr] }),
      }),
      ctx(),
    );
    expect(p.do === "box" && p.state.pending.closePrs).toEqual([pr]);
    expect(kinds(writes(p))).toContain("dispatch");
  });

  it("a message well after a close reopens it and carries on", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue: { ...snap().issue, state: "closed", closedAt: "2026-10-05T09:00:00.000Z" },
        state: ran({ phase: "done" }),
        said: [said(101, "one more thing")],
      }),
      ctx(),
    );
    expect(p.do).toBe("think");
  });

  it("carrying on, it also reads what you wrote before the close that no run read (a merge came first), not what you said as it closed", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue: { ...snap().issue, state: "closed", closedAt: "2026-10-05T09:00:00.000Z" },
        state: ran({ phase: "done" }),
        said: [
          said(101, "also make the header smaller", { at: "2026-10-05T08:50:00.000Z" }),
          said(102, "merging it now", { at: "2026-10-05T08:59:50.000Z" }),
          said(103, "one more thing"),
        ],
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think.fresh).toEqual([101, 103]);
  });

  it("`reopen` reopens it with no agent, and waits for your words", () => {
    const closed = {
      ...snap().issue,
      state: "closed" as const,
      closedAt: "2026-10-05T09:00:00.000Z",
    };
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue: closed,
        state: ran({ phase: "done" }),
        said: [said(101, "Reopen.")],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(kinds(writes(p))).toEqual(["reopen", "reply"]);
    expect(replies(writes(p))[0]).toMatchObject({
      kind: "needs-you",
      text: expect.stringContaining("Reopened"),
    });
    expect(p.do === "box" && p.state.seen).toBe(101);
    // On an open task it changes nothing, and says so.
    const open = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran(),
        said: [said(102, "reopen")],
      }),
      ctx(),
    );
    expect(open.do).toBe("box");
    expect(kinds(writes(open))).toEqual(["reply"]);
  });

  it("closed by the door as it wrote your `close`: what the word does, quietly, read once", () => {
    const closedAt = "2026-10-05T09:00:00.000Z";
    const issue = { ...snap().issue, state: "closed" as const, closedAt };
    const close = said(101, "close", { at: "2026-10-05T08:59:59.000Z" });
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        issue,
        state: ran({ phase: "answered", closes: "2026-10-06T09:00:00.000Z" }),
        said: [close],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(kinds(writes(p))).toEqual(["coming-up", "labels"]);
    expect(p.do === "box" && p.state).toMatchObject({ seen: 101, phase: "done" });
    expect(p.do === "box" && p.state.closes).toBeUndefined();
    // The run for its `closed` event after it: nothing left.
    const again = plan(
      snap({
        trigger: { kind: "closed" },
        statusId: 5,
        issue,
        state: ran({ phase: "done", seen: 101 }),
      }),
      ctx(),
    );
    expect(again.do).toBe("nothing");
  });

  it("a `reopen` typed on GitHub (a `close` before it unread, too): Reopened, no agent", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ phase: "done" }),
        said: [said(101, "close"), said(102, "reopen")],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(kinds(writes(p))).toEqual(["reply"]);
    expect(replies(writes(p))[0]).toMatchObject({
      kind: "needs-you",
      text: expect.stringContaining("Reopened"),
    });
    expect(p.do === "box" && p.state.seen).toBe(102);
  });

  it("reopened by the door (a setting: it said so in the chat), found by the run queued for a `close` before it: noted, nothing said", () => {
    const door = { v: 1, person: "owner", channel: "web", chat: "me", id: "r1" } as const;
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ phase: "done" }),
        said: [
          said(101, "close", { author: "door", channel: "web", from: { ...door, id: "c1" } }),
          said(102, "reopen", { author: "door", channel: "web", from: { ...door, setting: true } }),
        ],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(replies(writes(p))).toEqual([]);
    expect(p.do === "box" && p.state.seen).toBe(102);
  });
});

describe("plan: one run waiting per task, nothing lost (ADR 0040)", () => {
  const closedAt = "2026-10-05T09:00:00.000Z";
  const closed = { ...snap().issue, state: "closed" as const, stateReason: "completed", closedAt };
  const thinkWrites = (p: Plan) => (p.do === "think" ? (p.writes ?? []) : writes(p));
  const door = { v: 1, person: "owner", channel: "web", chat: "me" } as const;

  it("a merge's own run replaced by your words: Merged is said first, then your words carry it on", () => {
    const pr = { url: "https://github.com/o/shipify/pull/9", title: "Turn on the daily brief" };
    const p = plan(
      snap({
        issue: closed,
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ phase: "needs-you" }),
        said: [said(101, "and the footer too")],
      }),
      ctx({ mergedPr: pr }),
    );
    expect(p.do).toBe("think");
    const ws = thinkWrites(p);
    expect(replies(ws)[0]).toMatchObject({ kind: "live", state: "Merged", occasion: pr.url });
    expect(kinds(ws)).toContain("reopen");
    expect(p.do === "think" && p.think.fresh).toEqual([101]);
  });

  it("your close from a chat (a setting, no run of its own), then words: the close's work first", () => {
    const p = plan(
      snap({
        issue: closed,
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({
          phase: "answered",
          pending: { calls: [{ tool: "notion", name: "update_page", args: {} }] } as never,
          repeat: { kind: "reminder", every: "every day at 09:00", next: NOW, fails: 0 },
        }),
        said: [
          said(101, "close", {
            at: "2026-10-05T08:59:59.000Z",
            author: "door",
            channel: "web",
            from: { ...door, id: "c1", setting: true },
          }),
          said(102, "one more thing, please"),
        ],
      }),
      ctx(),
    );
    expect(p.do).toBe("think");
    // As its run would have: a list waiting for your yes is dropped, the repeat paused.
    expect(p.do === "think" && p.state.pending.calls).toBeUndefined();
    expect(p.do === "think" && p.state.repeat?.paused).toBe(true);
    expect(kinds(thinkWrites(p))).toEqual(["coming-up", "reopen"]);
    expect(p.do === "think" && p.think.fresh).toEqual([102]);
  });

  it("work you asked for, its own run replaced by your newer words: the work run takes them", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ pending: { work: { project: "spotter", brief: "fix the button", at: NOW } } }),
        said: [said(101, "and keep the logo white")],
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "work",
      project: "spotter",
      fresh: [101],
    });
    expect(p.do === "think" && p.state.pending.work).toBeUndefined();
  });

  it("Pause then Resume (a close, then `resume`): the repeat carries on where it was", () => {
    const p = plan(
      snap({
        issue: closed,
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({
          phase: "done",
          repeat: {
            kind: "reminder",
            every: "every day at 09:00",
            next: NOW,
            fails: 0,
            paused: true,
          },
        }),
        said: [said(101, "resume")],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(kinds(writes(p))).toContain("reopen");
    expect(replies(writes(p))[0]?.text).toContain("Resumed");
    expect(p.do === "box" && p.state.repeat?.paused).toBe(false);
  });
});

describe("plan: the chat commands, on GitHub too", () => {
  it("answers `/apps` (or any of them) as a comment with no agent, the same words a chat gets", () => {
    const p = plan(
      snap({ trigger: { kind: "comment" }, statusId: 5, state: ran(), said: [said(101, "/apps")] }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(replies(writes(p))[0]?.text).toBe("answer to /apps");
    expect(p.do === "box" && p.state.seen).toBe(101);
    // Beside other words, the words still go to the agent.
    const q = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran(),
        said: [said(101, "/ping"), said(102, "and make it faster")],
      }),
      ctx(),
    );
    expect(q.do).toBe("think");
  });

  it("answers a new task titled `/notebook` and closes it", () => {
    const p = plan(
      snap({
        issue: { ...snap().issue, title: "/notebook Preferences" },
        parsed: { kind: "question", ask: "/notebook Preferences" },
      }),
      ctx(),
    );
    expect(replies(writes(p))[0]?.text).toBe("answer to /notebook Preferences");
    expect(kinds(writes(p))).toContain("close");
  });
});

describe("plan: the notebook from any task (ADR 0032)", () => {
  it("`forget: …` as a task takes the note off with no agent, then closes; with no words it asks", () => {
    const p = plan(
      snap({
        issue: { ...snap().issue, title: "forget: short answers" },
        parsed: { kind: "forget", ask: "short answers" },
      }),
      ctx(),
    );
    expect(writes(p)).toContainEqual({ w: "forget", words: "short answers" });
    expect(kinds(writes(p))).toContain("close");
    const empty = plan(
      snap({ issue: { ...snap().issue, title: "forget:" }, parsed: { kind: "forget", ask: "" } }),
      ctx(),
    );
    expect(replies(writes(empty))[0]?.text).toContain("What should I forget?");
  });

  it("a longer sentence that starts with remember is words for the agent, not a note", () => {
    for (const text of [
      "Remember the old design: blue header, bring it back",
      "remember: x\nand also make it faster",
      "forget People: Ana",
    ]) {
      const p = plan(
        snap({ trigger: { kind: "comment" }, statusId: 5, state: ran(), said: [said(101, text)] }),
        ctx(),
      );
      expect(p.do, text).toBe("think");
    }
  });

  it("`remember …:` and `forget:` as comments write with no agent; other words still think", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran(),
        said: [said(101, "remember People: Ana designs"), viaChat(102, "forget: dark mode")],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(writes(p)).toContainEqual({ w: "note", topic: "People", line: "Ana designs" });
    // A repo's own page, by its name (ADR 0047).
    const repo = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran(),
        said: [said(101, "remember acme/api: run npm test before a PR")],
      }),
      ctx(),
    );
    expect(writes(repo)).toContainEqual({
      w: "note",
      topic: "acme/api",
      line: "run npm test before a PR",
    });
    expect(writes(p)).toContainEqual({ w: "forget", words: "dark mode" });
    expect(replies(writes(p))).toHaveLength(1);
    const q = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran(),
        said: [said(101, "remember: short answers"), said(102, "now make it faster")],
      }),
      ctx(),
    );
    expect(q.do).toBe("think");
    expect(q.do === "think" && q.writes).toContainEqual({
      w: "note",
      topic: "Preferences",
      line: "short answers",
    });
  });
});

describe("plan: recipes (ADR 0032)", () => {
  const recipe = (over: Partial<import("../cli/lib/recipes.ts").Recipe> = {}) => ({
    name: "brief",
    when: "every weekday at 08:30",
    body: "Brief me.",
    hash: "h1",
    ...over,
  });
  const task = (
    st: Partial<TaskState>,
    read: NonNullable<Context["recipe"]>["read"],
    said: Said[] = [],
  ) =>
    plan(
      snap({
        issue: {
          ...snap().issue,
          title: "Recipe: brief",
          labels: ["recipe", "repeats"],
          author: "run",
        },
        parsed: { kind: "none", ask: "Recipe: brief" },
        trigger: { kind: "dispatch", job: "run" },
        statusId: 5,
        state: ran(st),
        said,
      }),
      ctx({ recipe: { name: "brief", read } }),
    );

  it("a new recipe sets its repeat from the file, labelled, with no agent", () => {
    const p = task({}, { recipe: recipe() });
    expect(p.do).toBe("box");
    expect(p.do === "box" && p.state.repeat).toMatchObject({
      kind: "agent",
      every: "every weekday at 08:30",
    });
    expect(p.do === "box" && p.state.recipe).toEqual({ name: "brief", hash: "h1" });
    expect(writes(p)).toContainEqual({ w: "labels", add: ["repeats", "recipe"] });
    expect(replies(writes(p))[0]?.text).toContain("Set from `recipes/brief.md`");
  });

  it("a recipe with a check repeats the check, and the agent thinks when it changes", () => {
    const p = task({}, { recipe: recipe({ check: "price", when: "every hour" }) });
    expect(p.do === "box" && p.state.repeat).toMatchObject({
      kind: "check",
      check: "price",
      onChange: "think",
    });
  });

  it("in step, nothing; changed, updated; at its time, its body is the job", () => {
    const rep = {
      kind: "agent" as const,
      every: "every weekday at 08:30",
      next: "2026-10-06T08:30:00.000Z",
      fails: 0,
    };
    expect(
      task({ recipe: { name: "brief", hash: "h1" }, repeat: rep }, { recipe: recipe() }).do,
    ).toBe("nothing");
    const changed = task(
      { recipe: { name: "brief", hash: "h1" }, repeat: rep },
      { recipe: recipe({ hash: "h2" }) },
    );
    expect(replies(writes(changed))[0]?.text).toContain("Updated from `recipes/brief.md`");
    const due = task(
      {
        recipe: { name: "brief", hash: "h1" },
        repeat: { ...rep, next: "2026-10-05T09:00:00.000Z" },
      },
      { recipe: recipe() },
    );
    expect(due.do === "think" && due.think).toMatchObject({
      why: "scheduled",
      recipe: { name: "brief", body: "Brief me." },
    });
  });

  it("a file that doesn't read pauses it and says why, once; a removed file ends it", () => {
    const rep = { kind: "agent" as const, every: "every weekday at 08:30", next: NOW, fails: 0 };
    const broken = task(
      { recipe: { name: "brief", hash: "h1" }, repeat: rep },
      { problem: "its body is empty" },
    );
    expect(broken.do === "box" && broken.state.repeat?.paused).toBe(true);
    expect(replies(writes(broken))[0]?.text).toContain("doesn't read: its body is empty");
    expect(
      task(
        { recipe: { name: "brief", hash: "broken" }, repeat: { ...rep, paused: true } },
        { problem: "x" },
      ).do,
    ).toBe("nothing");
    const gone = task({ recipe: { name: "brief", hash: "h1" }, repeat: rep }, { gone: true });
    expect(gone.do === "box" && gone.state.repeat).toBeUndefined();
    expect(kinds(writes(gone))).toContain("close");
    expect(writes(gone)).toContainEqual({ w: "labels", remove: ["repeats"] });
  });

  it("a changed recipe still answers a comment, and still runs a time that had come", () => {
    const rep = {
      kind: "agent" as const,
      every: "every weekday at 08:30",
      next: "2026-10-05T09:00:00.000Z",
      fails: 0,
    };
    const withComment = task(
      {
        recipe: { name: "brief", hash: "h1" },
        repeat: { ...rep, next: "2026-10-06T08:30:00.000Z" },
      },
      { recipe: recipe({ hash: "h2" }) },
      [said(101, "make it shorter from now on")],
    );
    expect(withComment.do).toBe("think");
    expect(withComment.do === "think" && withComment.writes?.some((w) => w.w === "reply")).toBe(
      true,
    );
    const due = task(
      { recipe: { name: "brief", hash: "h1" }, repeat: rep },
      { recipe: recipe({ hash: "h2" }) },
    );
    expect(due.do === "think" && due.think).toMatchObject({
      why: "scheduled",
      recipe: { body: "Brief me." },
    });
  });

  it("a check-gated recipe needs the agent on the box: its profile isn't a bare check", async () => {
    const { profileOf } = await import("../cli/kernel/run.ts");
    const rep = {
      kind: "check" as const,
      check: "price",
      onChange: "think" as const,
      every: "every hour",
      next: "2026-10-05T09:00:00.000Z",
      fails: 0,
    };
    const p = task(
      { recipe: { name: "brief", hash: "h1" }, repeat: rep },
      { recipe: recipe({ check: "price", when: "every hour" }) },
    );
    expect(p.do === "think" && p.think.thenAsk).toBeTruthy();
    expect(profileOf(p)).toBe("talk");
  });

  it("`again` on a recipe that doesn't read says so and runs nothing; `continue` still retries", () => {
    const rep = {
      kind: "agent" as const,
      every: "every weekday at 08:30",
      next: "2026-10-06T08:30:00.000Z",
      fails: 0,
      paused: true,
    };
    const p = task({ recipe: { name: "brief", hash: "broken" }, repeat: rep }, { problem: "x" }, [
      said(101, "again"),
    ]);
    expect(p.do).toBe("box");
    expect(replies(writes(p))[0]?.text).toContain("doesn't read, so it can't run");
    const retry = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ phase: "failed", repeat: { ...rep, paused: false } }),
        said: [said(101, "continue")],
      }),
      ctx(),
    );
    expect(retry.do === "think" && retry.think.why).toBe("continue");
  });

  it("`again` runs a repeat now: a reminder's words, or a job's think", () => {
    const rem = {
      kind: "reminder" as const,
      every: "every day at 09:00",
      text: "Stretch",
      next: "2026-10-06T09:00:00.000Z",
      fails: 0,
    };
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ phase: "repeating", repeat: rem }),
        said: [viaChat(101, "again")],
      }),
      ctx(),
    );
    expect(replies(writes(p))[0]?.text).toBe("Stretch");
    expect(p.do === "box" && p.state.repeat?.next).toBe(rem.next);
    const job = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ phase: "repeating", repeat: { ...rem, kind: "agent" } }),
        said: [said(101, "again")],
      }),
      ctx(),
    );
    expect(job.do === "think" && job.think.why).toBe("scheduled");
  });
});

describe("plan: robust follow-ups (task #163's sweep)", () => {
  it("`continue` clears what an earlier run left unfinished, so it may run again", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({
          phase: "failed",
          journal: [
            { key: "calls:abc", what: "the 1 approved call(s)", at: NOW },
            { key: "push:links:task/9:1", what: "pushing", at: NOW, done: true },
          ],
        }),
        said: [said(101, "continue")],
      }),
      ctx(),
    );
    expect(p.do === "think" && p.state.journal).toEqual([
      { key: "push:links:task/9:1", what: "pushing", at: NOW, done: true },
    ]);
  });
});

describe("plan: what a dispatch brings", () => {
  const d = (st: Partial<TaskState>, c: Partial<Context> = {}) =>
    plan(snap({ trigger: { kind: "dispatch", job: "run" }, statusId: 5, state: ran(st) }), ctx(c));

  it("work a talk run found: a work run on that project (no own rules for a project)", () => {
    const p = d({ pending: { work: { project: "spotter", brief: "fix the button", at: NOW } } });
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "work",
      project: "spotter",
      why: "work",
    });
  });

  it("a reminder's time: its words, its next time saved first, keyed by the time", () => {
    const p = d({
      repeat: {
        kind: "reminder",
        every: "every day at 09:00",
        text: "Stretch",
        next: "2026-10-05T09:00:00.000Z",
        fails: 0,
      },
    });
    expect(replies(writes(p))[0]).toMatchObject({
      text: "Stretch",
      occasion: "2026-10-05T09:00:00.000Z",
    });
    expect(p.do === "box" && Date.parse(p.state.repeat?.next ?? "") > Date.parse(NOW)).toBe(true);
  });

  it("a reminder's time always fires, even with your words waiting, and clears a failure (ADR 0042)", () => {
    const due = (kind: "reminder" | "agent") =>
      plan(
        snap({
          trigger: { kind: "dispatch", job: "run" },
          statusId: 5,
          said: [said(101, "and the Pi?")],
          state: ran({
            phase: "failed",
            failed: { at: NOW, problem: { code: "unexpected", what: "x", fix: "y" } },
            repeat: {
              kind,
              every: "every day at 09:00",
              text: "Stretch",
              next: "2026-10-05T09:00:00.000Z",
              fails: 0,
            },
          }),
        }),
        ctx(),
      );
    const p = due("reminder");
    expect(p.do).toBe("box");
    expect(replies(writes(p))[0]?.text).toBe("Stretch");
    // Your words wait, unread, for your `continue`; the task is back to repeating.
    expect(p.state?.seen).toBe(100);
    expect(p.state).toMatchObject({ phase: "repeating", failed: undefined });
    // A job's time with your words waiting: your words, as before.
    const job = due("agent");
    expect(job.do === "think" && job.think).toMatchObject({ why: "comment", fresh: [101] });
  });

  it("a repeat's time comes before a quiet-day close: a repeat is never closed as quiet", () => {
    const p = d({
      phase: "answered",
      closes: "2026-10-05T08:00:00.000Z",
      repeat: {
        kind: "reminder",
        every: "every day at 09:00",
        text: "Stretch",
        next: "2026-10-05T09:00:00.000Z",
        fails: 0,
      },
    });
    expect(kinds(writes(p))).not.toContain("close");
    expect(replies(writes(p))[0]?.text).toBe("Stretch");
  });

  it("a job's time thinks; a check's time runs its script; a paused one waits", () => {
    const job = d({
      repeat: {
        kind: "agent",
        every: "every day at 09:00",
        next: "2026-10-05T09:00:00.000Z",
        fails: 0,
      },
    });
    expect(job.do === "think" && job.think.why).toBe("scheduled");
    const check = d({
      repeat: {
        kind: "check",
        check: "price",
        every: "every hour",
        next: "2026-10-05T09:00:00.000Z",
        fails: 0,
      },
    });
    expect(check.do === "think" && check.think.check).toBe("price");
    expect(
      d({
        repeat: {
          kind: "agent",
          every: "every day at 09:00",
          next: "2026-10-05T09:00:00.000Z",
          fails: 0,
          paused: true,
        },
      }).do,
    ).toBe("nothing");
  });

  it("a deploy that's up says Live once, keyed by its commit", () => {
    const p = d(
      { project: "spotter", deploy: { repo: "o/spotter", sha: "abc", since: NOW } },
      { deploy: { state: "live", url: "https://spotter.app" } },
    );
    expect(replies(writes(p))[0]).toMatchObject({ kind: "live", occasion: "abc" });
    expect(p.do === "box" && p.state.deploy).toBeUndefined();
  });

  it("a merge with nothing to deploy (Shipify, a package, a recipe) says Merged, once (task #168)", () => {
    const closed = {
      ...snap().issue,
      state: "closed" as const,
      stateReason: "completed",
      closedAt: NOW,
    };
    const pr = { url: "https://github.com/o/shipify/pull/9", title: "Turn on the daily brief" };
    const closing = (phase: TaskState["phase"]) =>
      plan(
        snap({ issue: closed, trigger: { kind: "closed" }, statusId: 5, state: ran({ phase }) }),
        ctx({ mergedPr: pr }),
      );
    const p = closing("needs-you");
    expect(replies(writes(p))[0]).toMatchObject({
      kind: "live",
      state: "Merged",
      occasion: pr.url,
    });
    expect(replies(writes(p))[0]?.text).toContain("Turn on the daily brief");
    expect(replies(writes(p))[0]?.text).not.toContain("no run read");
    expect(closing("done").do).toBe("nothing");
  });

  it("a merge with words of yours no run read says so, so none is left unseen (#188)", () => {
    const closed = { ...snap().issue, state: "closed" as const, closedAt: NOW };
    const pr = { url: "https://github.com/o/shipify/pull/9", title: "The chat" };
    const p = plan(
      snap({
        issue: closed,
        trigger: { kind: "closed" },
        statusId: 5,
        state: ran({ phase: "needs-you" }),
        said: [
          said(101, "also make the header smaller", { at: "2026-10-05T09:50:00.000Z" }),
          said(102, "thanks", { at: "2026-10-05T09:51:00.000Z" }),
          // Said as it closed: a parting word, not one to carry on.
          said(103, "merging", { at: "2026-10-05T09:59:50.000Z" }),
        ],
      }),
      ctx({ mergedPr: pr }),
    );
    expect(replies(writes(p))[0]?.text).toContain(
      "A message of yours came in before the merge, and no run read it. Write here again and the task carries on with it.",
    );
  });

  it("a merge that closes the task says Live from its own run, once its deploy is up", () => {
    const deploy = { repo: "o/spotter", sha: "abc", since: NOW };
    const closed = {
      ...snap().issue,
      state: "closed" as const,
      stateReason: "completed",
      closedAt: NOW,
    };
    const closing = (end?: Context["deploy"]) =>
      plan(
        snap({
          issue: closed,
          trigger: { kind: "closed" },
          statusId: 5,
          state: ran({ project: "spotter", phase: "needs-you" }),
        }),
        ctx({ merged: deploy, ...(end ? { deploy: end } : {}) }),
      );
    // The run followed it (runPlan): told now, with nothing left for the watch.
    const merged = closing({ state: "live", url: "https://spotter.app" });
    expect(merged.do === "box" && merged.state.deploy).toBeUndefined();
    expect(replies(writes(merged))[0]).toMatchObject({ kind: "live", occasion: "abc" });
    expect(writes(merged).some((w) => w.w === "labels" && w.add?.includes("deploying"))).toBe(
      false,
    );
    expect(replies(writes(closing({ state: "failed" })))[0]?.kind).toBe("failed");
    // Nothing it could read: said so, never silence.
    expect(replies(writes(closing()))[0]?.text).toContain("never showed up");
    // A deploy the watch follows (a release, a new project's first push) is told the same way.
    const live = plan(
      snap({
        issue: closed,
        trigger: { kind: "dispatch", job: "run" },
        statusId: 5,
        state: ran({ project: "spotter", phase: "done", deploy }),
      }),
      ctx({ deploy: { state: "live", url: "https://spotter.app" } }),
    );
    expect(replies(writes(live))[0]).toMatchObject({ kind: "live", occasion: "abc" });
    expect(writes(live)).toContainEqual(
      expect.objectContaining({ w: "labels", remove: ["deploying"] }),
    );
  });

  it("an answered task quiet for a day closes", () => {
    const p = d({ phase: "answered", closes: "2026-10-05T09:00:00.000Z" });
    expect(kinds(writes(p))).toContain("close");
  });
});

describe("plan: the github job runs only what's pending", () => {
  const g = (st: Partial<TaskState>) =>
    plan(
      snap({ trigger: { kind: "dispatch", job: "github" }, statusId: 5, state: ran(st) }),
      ctx(),
    );
  it("a merged plan not built yet, once; an operation; PRs to close; else nothing", () => {
    expect(g({ plan: "tipcalc" })).toMatchObject({ do: "github", job: "prepare" });
    expect(g({ plan: "tipcalc", built: "tipcalc" }).do).toBe("nothing");
    expect(g({ pending: { operate: { op: "up", at: NOW } } })).toMatchObject({
      do: "github",
      job: "operate",
    });
    expect(g({ pending: { closePrs: ["u"] } })).toMatchObject({ do: "github", job: "close-prs" });
    expect(g({}).do).toBe("nothing");
  });
});

describe("plan: the repos a task reads (ADR 0044)", () => {
  // What plan looked up on GitHub (ADR 0044): acme/tool and acme/x are public repos; the rest none.
  const looked = {
    "acme/tool": { repo: "acme/tool", sizeKB: 5 },
    "acme/x": { repo: "acme/x", sizeKB: 5 },
    "src/app.tsx": { status: 404 },
  };
  // A new task with these words, or one that ran, answering your comments.
  const asking = (title: string, ...comments: string[]) =>
    plan(
      snap({
        looked,
        issue: { ...snap().issue, title },
        parsed: { kind: "question", ask: title },
        ...(comments.length
          ? {
              said: comments.map((c, i) => said(101 + i, c)),
              state: ran(),
              statusId: 5,
              trigger: { kind: "comment" as const },
            }
          : {}),
      }),
      ctx(),
    );

  it("reads your repos by name or owner/name, with the run's key: a talk run", () => {
    const p = asking("ask: look at spotter and o/notes-app, what do they share?");
    expect(p.do === "think" && p.think.profile).toBe("talk");
    expect(p.do === "think" && p.think.reads).toEqual([
      { name: "spotter", repo: "o/spotter", mine: true, sizeKB: 100 },
      { name: "notes-app", repo: "o/notes-app", mine: true, sizeKB: 50 },
    ]);
  });

  it("reads anyone else's repo anonymously, in the read profile, with no web", () => {
    const p = asking("ask: what is this?", "look at https://github.com/acme/tool please");
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "read",
      web: false,
      reads: [{ name: "acme/tool", repo: "acme/tool", mine: false, sizeKB: 5 }],
    });
  });

  it("keeps reading it on every later run of the task, since its conversation carries it", () => {
    const p = asking("ask: look at acme/tool", "and what about its tests?");
    expect(p.do === "think" && p.think.profile).toBe("read");
  });

  it("a word after `look at` that names no repo of yours is only a word", () => {
    const p = asking("ask: look at it again and tell me");
    expect(p.do === "think" && p.think).toMatchObject({ profile: "talk" });
    expect(p.do === "think" && p.think.reads).toBeUndefined();
  });

  it("a change that names someone else's repo only reads, and says to ask for the change apart", () => {
    const p = plan(
      snap({
        looked,
        issue: { ...snap().issue, title: "spotter: make search like look at acme/x" },
        parsed: { kind: "app", project: "spotter", ask: "make search like look at acme/x" },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think.profile).toBe("read");
    expect(p.do === "think" && p.think.project).toBeUndefined();
    expect(p.do === "think" && p.think.notes.join(" ")).toContain("changes nothing");
  });

  it("a path after `look at` is only words: the change stays a change, and nothing is read", () => {
    const p = plan(
      snap({
        looked,
        issue: { ...snap().issue, title: "spotter: the button is broken, look at src/App.tsx" },
        parsed: {
          kind: "app",
          project: "spotter",
          ask: "the button is broken, look at src/App.tsx",
        },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({ profile: "work", project: "spotter" });
    expect(p.do === "think" && p.think.reads).toBeUndefined();
    expect(p.do === "think" && p.think.notes.join(" ")).toContain("read it as plain words");
  });

  it("a lookup GitHub couldn't answer (not a 404) only reads: it may be someone else's repo", () => {
    const p = plan(
      snap({
        looked: { "acme/x": { status: 502 } },
        issue: { ...snap().issue, title: "spotter: make search like look at acme/x" },
        parsed: { kind: "app", project: "spotter", ask: "make search like look at acme/x" },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({ profile: "read", web: false });
    expect(p.do === "think" && p.think.reads).toBeUndefined();
    expect(p.do === "think" && p.think.notes.join(" ")).toContain("HTTP 502");
  });

  it("a repeat on a task that reads someone else's repo runs in the read profile too", () => {
    const p = plan(
      snap({
        looked,
        trigger: { kind: "dispatch", job: "run" },
        statusId: 5,
        issue: { ...snap().issue, title: "ask: look at acme/tool and sum up what changed" },
        parsed: { kind: "question", ask: "look at acme/tool and sum up what changed" },
        state: ran({
          phase: "repeating",
          repeat: {
            kind: "agent",
            every: "every hour",
            next: "2026-10-05T09:00:00.000Z",
            fails: 0,
          },
        }),
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({
      why: "scheduled",
      profile: "read",
      web: false,
    });
  });
});

describe("plan: what a name stands for, wherever a run starts on it (ADR 0044)", () => {
  it("a merged plan's new project, and Shipify, are never a repo's own rules, in any case", () => {
    const p = plan(
      snap({
        trigger: { kind: "dispatch", job: "run" },
        statusId: 5,
        repos: [
          ...snap().repos,
          { name: "tipcalc", repo: "o/tipcalc", sizeKB: 0, project: false, branch: "main" },
        ],
        parsed: { kind: "new", ask: "a tip calculator" },
        state: ran({
          plan: "tipcalc",
          built: "tipcalc",
          project: "tipcalc",
          pending: { work: { project: "tipcalc", brief: "build it", at: NOW } },
        }),
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({ profile: "work", project: "tipcalc" });
    expect(p.do === "think" && p.think.ownRules).toBeUndefined();
    const again = plan(
      snap({
        repos: [
          ...snap().repos,
          { name: "tipcalc", repo: "o/tipcalc", sizeKB: 0, project: false, branch: "main" },
        ],
        parsed: { kind: "new", ask: "a tip calculator" },
        said: [said(101, "continue")],
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({ plan: "tipcalc", built: "tipcalc", project: "tipcalc" }),
      }),
      ctx(),
    );
    expect(again.do === "think" && again.think.ownRules).toBeUndefined();
    expect(again.do === "think" && again.think.notes.join(" ")).toContain("kind publish");
    // Named in another case by a talk run's work: still the project, and Shipify still Shipify.
    for (const [said, is] of [
      ["TipCalc", "tipcalc"],
      ["Shipify", "shipify"],
    ] as const) {
      const p = plan(
        snap({
          trigger: { kind: "dispatch", job: "run" },
          statusId: 5,
          repos: [
            ...snap().repos,
            { name: "shipify", repo: "o/shipify", sizeKB: 1, project: false, branch: "main" },
            { name: "tipcalc", repo: "o/tipcalc", sizeKB: 0, project: false, branch: "main" },
          ],
          state: ran({
            built: "tipcalc",
            pending: { work: { project: said, brief: "x", at: NOW } },
          }),
        }),
        ctx(),
      );
      expect(p.do === "think" && p.think.project, said).toBe(is);
      expect(p.do === "think" && p.think.ownRules, said).toBeUndefined();
    }
  });

  it("a repo's name in any case is the repo, named as GitHub has it", () => {
    const p = plan(
      snap({
        repos: [
          ...snap().repos,
          { name: "MyTool", repo: "o/MyTool", sizeKB: 1, project: false, branch: "main" },
        ],
        issue: { ...snap().issue, title: "mytool: fix the typo" },
        parsed: { kind: "app", project: "mytool", ask: "fix the typo" },
      }),
      ctx(),
    );
    expect(p.do === "think" && p.think).toMatchObject({ project: "MyTool", ownRules: true });
  });

  const d = (st: Partial<TaskState>, c: Partial<Context> = {}) =>
    plan(snap({ trigger: { kind: "dispatch", job: "run" }, statusId: 5, state: ran(st) }), ctx(c));

  it("work a talk run found on another of your repos keeps its own rules, on its default branch", () => {
    const p = d({ pending: { work: { project: "notes-app", brief: "fix it", at: NOW } } });
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "work",
      project: "notes-app",
      ownRules: true,
    });
    const q = d({ pending: { work: { project: "old-tool", brief: "fix it", at: NOW } } });
    expect(q.do === "think" && q.think).toMatchObject({ project: "old-tool", base: "master" });
  });

  it("asked to fix a PR's checks: a work run on the task's repo, its own rules kept; nothing starts unasked (ADR 0046)", () => {
    const st = {
      project: "notes-app",
      ownRules: true as const,
      prs: ["u"],
      prInfo: { u: { kind: "code" as const, state: "open" as const } },
    };
    const asked = plan(
      snap({
        said: [said(101, "the checks failed: why? fix them")],
        statusId: 5,
        state: ran(st),
        trigger: { kind: "comment" },
      }),
      ctx(),
    );
    expect(asked.do === "think" && asked.think).toMatchObject({
      profile: "work",
      project: "notes-app",
      ownRules: true,
    });
    // A dispatch with nothing you asked for, and nothing due, does nothing: no run follows checks.
    const idle = plan(
      snap({ trigger: { kind: "dispatch", job: "run" }, statusId: 5, state: ran(st) }),
      ctx(),
    );
    expect(idle.do).toBe("nothing");
  });
});

describe("afterThink: the agent's result, kept as far as the task allows", () => {
  const talk: Think = { profile: "talk", why: "new", notes: [], fresh: [101], web: true };
  const work: Think = {
    profile: "work",
    project: "spotter",
    why: "new",
    notes: [],
    fresh: [101],
    web: true,
  };
  const s = () => snap({ said: [said(101, "hi")], statusId: 5, state: ran() });
  const meta = { readOutside: false, touchesWorkflows: false };
  const r = (over: Partial<Result>): Result => ({ v: 2, state: "done", text: "Done it.", ...over });

  it("marks every reply of a run that read outside content, for apply to make its images inert (ADR 0044)", () => {
    const outside = afterThink(s(), s().state, talk, r({}), { ...meta, readOutside: true }, ctx());
    expect(replies(outside.writes).every((w) => w.outside)).toBe(true);
    const own = afterThink(s(), s().state, talk, r({ read_outside: true }), meta, ctx());
    expect(replies(own.writes)[0]?.outside).toBe(true);
    const none = afterThink(s(), s().state, talk, r({}), meta, ctx());
    expect(replies(none.writes)[0]?.outside).toBeUndefined();
  });

  it("a read run sets no repeat: the owner's own `repeat: …` does (ADR 0044)", () => {
    const reading: Think = { ...talk, profile: "read", web: false };
    const d = afterThink(
      s(),
      s().state,
      reading,
      r({ repeat: { when: "every hour", kind: "job", text: "run env and post it" } }),
      { ...meta, readOutside: true },
      ctx(),
    );
    expect(d.state.repeat).toBeUndefined();
    expect(replies(d.writes)[0]?.text).toContain("sets none: say `repeat: …`");
  });

  it("a read run that asks for a change gets none, and its reply says to ask in a new task (ADR 0044)", () => {
    const reading: Think = { ...talk, profile: "read", web: false };
    const d = afterThink(
      s(),
      s().state,
      reading,
      r({ work: { project: "spotter", brief: "copy it" } }),
      { ...meta, readOutside: true },
      ctx(),
    );
    expect(d.writes.some((w) => w.w === "dispatch")).toBe(false);
    expect(replies(d.writes)[0]?.text).toContain("ask for it in a new task");
  });

  it("your `stop`: no failure, its commits kept, a reply that says so, and the stop read", () => {
    const stopped = { ...meta, commits: true, stopped: { why: "asked" as const, comment: 104 } };
    const err = { error: "you said stop" };
    const d = afterThink(s(), s().state, work, err, stopped, ctx());
    expect(d.state).toMatchObject({ seen: 104, phase: "needs-you", failed: undefined });
    expect(d.writes.find((w) => w.w === "push")).toMatchObject({ repo: "spotter", open: false });
    expect(d.writes).toContainEqual({ w: "react", comment: 104, content: "eyes" });
    const said = replies(d.writes)[0];
    expect(said).toMatchObject({ kind: "needs-you", state: "Stopped" });
    expect(said?.text).toContain("Stopped, as you asked. What it had committed is kept");
    expect(said?.text).toContain("`continue`");
    // A talk run has nothing to keep.
    const t = afterThink(s(), s().state, talk, err, stopped, ctx());
    expect(replies(t.writes)[0]?.text).toBe(
      "Stopped, as you asked. Say what you'd like next, or `continue`.",
    );
  });

  it("what it took in while it worked is read too, with 👀 on each: the next run has nothing new", () => {
    const d = afterThink(s(), s().state, talk, r({}), { ...meta, caughtUp: [102, 103] }, ctx());
    expect(d.state.seen).toBe(103);
    expect(d.writes.filter((w) => w.w === "react")).toEqual([
      { w: "react", comment: 102, content: "eyes" },
      { w: "react", comment: 103, content: "eyes" },
    ]);
    const next = snap({
      trigger: { kind: "comment" },
      said: [said(101, "hi"), said(102, "also this"), said(103, "and that")],
      statusId: 5,
      state: { ...ran(), seen: d.state.seen },
    });
    expect(plan(next, ctx()).do).toBe("nothing");
    // Nothing is lost: what came after them (a word it left, or one sent while it took them in)
    // is still new, so the run its comment queued reads it.
    const after = { ...next, said: [...next.said, said(104, "and one more")] };
    expect(plan(after, ctx()).do).toBe("think");
  });

  it("words sent as its reply was written are said in the reply, so its needs you never hides them (#188)", () => {
    const d = afterThink(s(), s().state, talk, r({ question: "Merge it?" }), meta, ctx());
    const text = () => replies(d.writes)[0]?.text ?? "";
    // Read before: nothing after the cursor, nothing said.
    stillWaiting(d, [said(101, "hi")]);
    expect(text()).not.toContain("is next");
    stillWaiting(d, [said(101, "hi"), said(104, "and the Pi?"), said(105, "and the chat")]);
    expect(text()).toContain(
      "2 messages you sent after this run last read the task are next: the run they started reads them now.",
    );
  });

  it("what it read as it started counts as read when it fails too: 👀 on each, as on the words it began with", () => {
    const err = { error: "it crashed" };
    const d = afterThink(s(), s().state, talk, err, { ...meta, caughtUp: [102] }, ctx());
    expect(d.state.seen).toBe(102);
    expect(d.writes.filter((w) => w.w === "react")).toEqual([
      { w: "react", comment: 102, content: "eyes" },
    ]);
  });

  it("a broken run is a failed reply with what to do, and its words are read", () => {
    const d = afterThink(s(), s().state, talk, { error: "the agent stopped" }, meta, ctx());
    expect(replies(d.writes)[0]).toMatchObject({ kind: "failed" });
    expect(d.state.failed?.problem.code).toBe("unexpected");
    expect(d.state.seen).toBe(101);
  });

  it("a result with a slip in its shape: Failed, naming the field, the agent's words kept in sight (#232)", () => {
    const slip = readResult(
      JSON.stringify({
        v: 2,
        state: "needs-you",
        text: "Two ways to do it.",
        question: "Which one?",
        choices: ["a".repeat(61), "b"],
      }),
    );
    const d = afterThink(
      s(),
      s().state,
      talk,
      slip,
      { ...meta, stopped: { why: "no-answer" } },
      ctx(),
    );
    const said = replies(d.writes)[0];
    expect(said).toMatchObject({ kind: "failed", state: "Failed" });
    expect(said?.problem?.code).toBe("result-wrong");
    expect(said?.text).toContain("choices.0");
    // Its words below the problem, never folded: a chat drops what's inside <details>.
    expect(said?.text).toContain("Two ways to do it.");
    expect(said?.text).not.toContain("<details>");
    expect(d.state.seen).toBe(101);
  });

  it("an answer is answered; a PR from a work run is pushed by apply, and needs its repo", () => {
    expect(afterThink(s(), s().state, talk, r({}), meta, ctx()).state.phase).toBe("answered");
    const d = afterThink(
      s(),
      s().state,
      work,
      r({ pr: { kind: "closes", title: "Bigger font", body: "Why" } }),
      meta,
      ctx(),
    );
    expect(d.writes.find((w) => w.w === "push")).toMatchObject({ repo: "spotter", kind: "closes" });
    expect(d.needs.repo).toBe("spotter");
    expect(d.state.phase).toBe("needs-you");
  });

  it("a failed run's commits are kept on the task's branch with no PR; never a first push or into an open PR, and the reply says why", () => {
    const pr = { kind: "closes" as const, title: "Bigger font", body: "Why" };
    const kept = { ...meta, commits: true };
    const d = afterThink(s(), s().state, work, r({ state: "failed", pr }), kept, ctx());
    const push = d.writes.find((w) => w.w === "push");
    expect(push).toEqual({ w: "push", repo: "spotter", branch: d.state.branch, open: false });
    expect(d.state.branch).toBeTruthy();
    expect(d.state.phase).toBe("failed");
    expect(replies(d.writes)[0]?.kind).toBe("failed");
    // No commits in its bundle: nothing to keep.
    const none = afterThink(s(), s().state, work, r({ state: "failed", pr }), meta, ctx());
    expect(none.writes.some((w) => w.w === "push")).toBe(false);
    // A new project's first push goes to main, which deploys.
    const first = afterThink(
      s(),
      s().state,
      work,
      r({ state: "failed" }),
      { ...kept, firstPush: true },
      ctx(),
    );
    expect(first.writes.some((w) => w.w === "push")).toBe(false);
    expect(replies(first.writes)[0]?.text).toContain("a new project's first push goes to `main`");
    // Nor into the task's open PR: you might merge it.
    const st = { ...s().state, prs: ["https://github.com/o/spotter/pull/3"] };
    const intoOpen = afterThink(s(), st, work, r({ state: "failed", pr }), kept, ctx());
    expect(intoOpen.writes.some((w) => w.w === "push")).toBe(false);
    expect(replies(intoOpen.writes)[0]?.text).toContain("its PR is open");
  });

  it("a run that stops to ask you keeps its commits, and its reply reads as before, guards and all (ADR 0041)", () => {
    const ask = r({
      state: "needs-you",
      text: "Which colour?",
      question: "Blue or green?",
      choices: ["Blue", "Green"],
    });
    const kept = { ...meta, commits: true };
    const d = afterThink(s(), s().state, work, ask, kept, ctx());
    const before = afterThink(s(), s().state, work, ask, meta, ctx());
    // Quiet: apply adds nothing to the reply for it, and its failure never changes the reply.
    expect(d.writes.find((w) => w.w === "push")).toEqual({
      w: "push",
      repo: "spotter",
      branch: d.state.branch,
      open: false,
      quiet: true,
    });
    expect(d.needs.repo).toBe("spotter");
    expect(d.state.phase).toBe("needs-you");
    expect(replies(d.writes)).toEqual(replies(before.writes));
    // What the status shows stays as it was: only the branch the next run starts from is new.
    expect({ ...d.state, branch: undefined }).toEqual({ ...before.state, branch: undefined });
    // Its guards keep the commits out, and say nothing new: the reply is as before.
    const st = { ...s().state, prs: ["https://github.com/o/spotter/pull/3"] };
    const intoOpen = afterThink(s(), st, work, ask, kept, ctx());
    expect(intoOpen.writes.some((w) => w.w === "push")).toBe(false);
    expect(replies(intoOpen.writes)).toEqual(
      replies(afterThink(s(), st, work, ask, meta, ctx()).writes),
    );
    const first = afterThink(s(), s().state, work, ask, { ...kept, firstPush: true }, ctx());
    expect(first.writes.some((w) => w.w === "push")).toBe(false);
    expect(replies(first.writes)).toEqual(replies(before.writes));
    // A run that ends done is as before: nothing kept.
    const done = afterThink(s(), s().state, work, r({}), kept, ctx());
    expect(done.writes.some((w) => w.w === "push")).toBe(false);
  });

  it("the handoff is the run's own file, however it ends; a run with none leaves the last one (ADR 0041)", () => {
    const was = { ...s().state, notes: "Older notes" };
    const handoff = "Goal: blue buttons\nNext: the docs";
    const h = { ...meta, handoff };
    expect(afterThink(s(), was, work, r({}), h, ctx()).state.notes).toBe(handoff);
    const clock = { ...h, commits: true, stopped: { why: "clock" as const, minutes: 50 } };
    const none = { error: "the agent stopped without writing its result" };
    expect(afterThink(s(), was, work, none, clock, ctx()).state.notes).toBe(handoff);
    const stop = { ...h, stopped: { why: "asked" as const, comment: 104 } };
    expect(afterThink(s(), was, work, { error: "you said stop" }, stop, ctx()).state.notes).toBe(
      handoff,
    );
    expect(afterThink(s(), was, work, r({}), meta, ctx()).state.notes).toBe("Older notes");
  });

  it("a stopped agent's commits are kept too, and the reply names the stop (ADR 0035)", () => {
    const none = { error: "the agent stopped without writing its result" };
    const clock = afterThink(
      s(),
      s().state,
      work,
      none,
      { ...meta, commits: true, stopped: { why: "clock", minutes: 50 } },
      ctx(),
    );
    expect(kinds(clock.writes)).toEqual(["push", "reply"]);
    expect(clock.writes[0]).toMatchObject({ w: "push", repo: "spotter", open: false });
    expect(clock.state.failed?.problem).toMatchObject({
      code: "agent-stopped",
      what: "The agent stopped before it finished: it ran for 50 minutes.",
      fix: "Reply `continue` to carry on.",
    });
    const plan = afterThink(
      s(),
      s().state,
      work,
      none,
      {
        ...meta,
        stopped: { why: "plan", window: "five_hour", resets: "2026-10-05T15:00:00.000Z" },
      },
      ctx(),
    );
    expect(plan.writes.some((w) => w.w === "push")).toBe(false);
    expect(plan.state.failed?.problem.what).toBe(
      "Your plan's 5-hour limit is used up, so the agent stopped.",
    );
    expect(plan.state.failed?.problem.fix).toMatch(
      /^Reply `continue` after \w{3} 5 Oct, \d\d:\d\d\.$/,
    );
    // A talk run has nothing to keep; its reply still names the stop.
    const crash = afterThink(
      s(),
      s().state,
      talk,
      none,
      { ...meta, stopped: { why: "crash", code: 1 } },
      ctx(),
    );
    expect(kinds(crash.writes)).toEqual(["reply"]);
    expect(replies(crash.writes)[0]?.text).toContain("it crashed (exit 1)");
  });

  it("a PR from a talk run is left out, and said", () => {
    const d = afterThink(
      s(),
      s().state,
      talk,
      r({ pr: { kind: "closes", title: "x", body: "y" } }),
      meta,
      ctx(),
    );
    expect(d.writes.some((w) => w.w === "push")).toBe(false);
    expect(replies(d.writes)[0]?.text).toContain("Left out");
  });

  it("pre-approved calls run now, unless the run read outside content; others wait for yes, listed exactly", () => {
    const call = {
      tool: "notion",
      name: "create_page",
      args: { parent: "inbox", title: "Read later" },
    };
    const now = afterThink(s(), s().state, talk, r({ calls: [call] }), meta, ctx());
    expect(now.needs.act).toBe("notion");
    const read = afterThink(
      s(),
      s().state,
      talk,
      r({ calls: [call] }),
      { ...meta, readOutside: true },
      ctx(),
    );
    expect(read.state.pending.calls?.calls).toEqual([call]);
    expect(replies(read.writes)[0]?.text).toContain(
      '`notion.create_page` with `{"parent":"inbox","title":"Read later"}`',
    );
    const other = afterThink(
      s(),
      s().state,
      talk,
      r({ calls: [{ tool: "notion", name: "update_page", args: { id: "p" } }] }),
      meta,
      ctx(),
    );
    expect(other.state.pending.calls).toBeDefined();
    const bad = afterThink(
      s(),
      s().state,
      talk,
      r({ calls: [{ tool: "notion", name: "delete_all", args: {} }] }),
      meta,
      ctx(),
    );
    expect(bad.state.pending.calls).toBeUndefined();
    expect(replies(bad.writes)[0]?.text).toContain("notion.delete_all");
  });

  it("notes: written now from your words; from a run that read outside content, after your yes", () => {
    const notes = [{ topic: "Preferences", line: "Dark mode" }];
    expect(
      afterThink(s(), s().state, talk, r({ notes }), meta, ctx()).writes.some(
        (w) => w.w === "note",
      ),
    ).toBe(true);
    const out = afterThink(
      s(),
      s().state,
      talk,
      r({ notes }),
      { ...meta, readOutside: true },
      ctx(),
    );
    expect(out.state.pending.notes).toEqual(notes);
  });

  it("work for a project: a work run follows; an unknown project is said, not dispatched", () => {
    const d = afterThink(
      s(),
      s().state,
      talk,
      r({ work: { project: "spotter", brief: "fix it" } }),
      meta,
      ctx(),
    );
    expect(d.state.pending.work?.project).toBe("spotter");
    expect(d.writes.some((w) => w.w === "dispatch")).toBe(true);
    const u = afterThink(
      s(),
      s().state,
      talk,
      r({ work: { project: "nope", brief: "x" } }),
      meta,
      ctx(),
    );
    expect(u.writes.some((w) => w.w === "dispatch")).toBe(false);
    expect(replies(u.writes)[0]?.text).toContain("There's no project nope");
  });

  it("a repeat set in words keeps repeating: labelled for the due run, never closed as a quiet day", () => {
    const d = afterThink(
      s(),
      s().state,
      talk,
      r({ repeat: { when: "every day at 09:00", kind: "reminder", text: "Drink water" } }),
      meta,
      ctx(),
    );
    expect(d.state.phase).toBe("repeating");
    expect(d.state.closes).toBeUndefined();
    expect(d.writes).toContainEqual({ w: "labels", add: ["repeats"] });
    // A follow-up answered on a repeating task leaves it repeating.
    const rep = ran({
      phase: "repeating",
      repeat: { kind: "reminder", every: "every day at 09:00", next: NOW, fails: 0 },
    });
    const later = afterThink(
      snap({ ...s(), state: rep }),
      snap({ state: rep }).state,
      talk,
      r({}),
      meta,
      ctx(),
    );
    expect(later.state.phase).toBe("repeating");
    expect(later.state.closes).toBeUndefined();
  });

  it("says a repeat's times in your zone, and calls a check a check (ADR 0042)", () => {
    const d = afterThink(
      s(),
      s().state,
      talk,
      r({ repeat: { when: "every day at 09:00", kind: "reminder", text: "Drink water" } }),
      meta,
      ctx({ timeZone: "Asia/Kolkata" }),
    );
    expect(replies(d.writes)[0]?.text).toContain(
      "Set: every day at 09:00. Next: Tue 6 Oct, 09:00 IST.",
    );
    const check = { kind: "check" as const, every: "every hour", next: NOW, fails: 0 };
    expect(repeatLine(check, "UTC")).toBe(
      "**Repeats** every hour (a check) · next Mon 5 Oct, 10:00 UTC",
    );
  });

  it("a check that thinks on a change: unchanged, quiet; changed, the agent's answer is the reply", () => {
    const chk: Think = {
      ...talk,
      why: "scheduled",
      fresh: [],
      check: "price",
      thenAsk: { was: "h1" },
    };
    const st = ran({
      phase: "repeating",
      repeat: {
        kind: "check",
        check: "price",
        onChange: "think",
        every: "every hour",
        next: NOW,
        fails: 0,
        value: "h1",
      },
    });
    const quiet = afterThink(
      snap({ state: st }),
      snap({ state: st }).state,
      chk,
      r({}),
      { ...meta, checkHash: "h1" },
      ctx(),
    );
    expect(replies(quiet.writes)).toHaveLength(0);
    const moved = afterThink(
      snap({ state: st }),
      snap({ state: st }).state,
      chk,
      r({ text: "Node 22.20 is out: nothing of yours needs it." }),
      { ...meta, readOutside: true, checkHash: "h2", checkOutput: "Node v22.20.0" },
      ctx(),
    );
    expect(replies(moved.writes)[0]?.text).toContain("Node 22.20 is out");
    expect(moved.state.repeat?.value).toBe("h2");
    expect(moved.state.phase).toBe("repeating");
  });

  it("a quiet scheduled job posts nothing; a check speaks only when its output changes", () => {
    const sched: Think = { ...talk, why: "scheduled", fresh: [] };
    const rep = {
      repeat: { kind: "agent" as const, every: "every day at 09:00", next: NOW, fails: 0 },
    };
    const q = afterThink(
      snap({ state: ran(rep) }),
      snap({ state: ran(rep) }).state,
      sched,
      r({ quiet: true }),
      meta,
      ctx(),
    );
    expect(replies(q.writes)).toHaveLength(0);
    const chk: Think = { ...sched, check: "price" };
    const st = ran({
      repeat: {
        kind: "check",
        check: "price",
        every: "every hour",
        next: NOW,
        fails: 0,
        value: "h1",
      },
    });
    expect(
      replies(
        afterThink(
          snap({ state: st }),
          snap({ state: st }).state,
          chk,
          r({}),
          { ...meta, checkHash: "h1", checkOutput: "12" },
          ctx(),
        ).writes,
      ),
    ).toHaveLength(0);
    expect(
      replies(
        afterThink(
          snap({ state: st }),
          snap({ state: st }).state,
          chk,
          r({}),
          { ...meta, checkHash: "h2", checkOutput: "10" },
          ctx(),
        ).writes,
      )[0]?.text,
    ).toBe("10");
  });

  it("a check that fails is a failure: said with its cause, counted, and the third in a row pauses it, said once", () => {
    const chk: Think = { ...talk, why: "scheduled", fresh: [], check: "price" };
    const failing = r({
      state: "failed",
      text: "The check price failed (it ran for more than a minute).",
    });
    const at = (fails: number) => {
      const st = ran({
        phase: "repeating",
        repeat: {
          kind: "check",
          check: "price",
          every: "every hour",
          next: NOW,
          fails,
          value: "h1",
        },
      });
      return afterThink(
        snap({ state: st }),
        snap({ state: st }).state,
        chk,
        failing,
        { ...meta, readOutside: true },
        ctx(),
      );
    };
    const first = at(0);
    expect(replies(first.writes)).toMatchObject([{ kind: "failed", state: "Failed" }]);
    expect(replies(first.writes)[0]?.text).toContain("The check price failed");
    expect(replies(first.writes)[0]?.text).not.toContain("Paused");
    expect(first.state).toMatchObject({ phase: "failed", repeat: { fails: 1, value: "h1" } });
    expect(first.state.repeat?.paused).toBeFalsy();
    const third = at(2);
    expect(third.state.repeat).toMatchObject({ fails: 3, paused: true });
    expect(replies(third.writes)[0]?.text).toContain(
      "Paused after three failures in a row: `resume` starts it again.",
    );
    expect(third.writes.some((w) => w.w === "coming-up")).toBe(true);
    // One that runs again starts the count over, and the task is repeating, not failed.
    const st = ran({
      phase: "failed",
      repeat: {
        kind: "check",
        check: "price",
        every: "every hour",
        next: NOW,
        fails: 2,
        value: "h1",
      },
    });
    const ok = afterThink(
      snap({ state: st }),
      snap({ state: st }).state,
      chk,
      r({}),
      { ...meta, checkHash: "h1", checkOutput: "12" },
      ctx(),
    );
    expect(ok.state).toMatchObject({ phase: "repeating", failed: undefined, repeat: { fails: 0 } });
    expect(replies(ok.writes)).toHaveLength(0);
  });

  it("a scheduled job counts each failure in a row, its own `failed` and a result that doesn't read alike; the third pauses it, said once", () => {
    const sched: Think = { ...talk, why: "scheduled", fresh: [] };
    const at = (fails: number, result: Result | { error: string }) => {
      const st = ran({
        phase: "repeating",
        repeat: { kind: "agent", every: "every hour", next: NOW, fails },
      });
      return afterThink(snap({ state: st }), snap({ state: st }).state, sched, result, meta, ctx());
    };
    const said = at(1, r({ state: "failed", text: "Notion didn't answer." }));
    expect(said.state.repeat).toMatchObject({ fails: 2 });
    expect(said.state.repeat?.paused).toBeFalsy();
    const third = at(2, r({ state: "failed", text: "Notion didn't answer." }));
    expect(third.state.repeat).toMatchObject({ fails: 3, paused: true });
    expect(replies(third.writes)[0]?.text).toContain("Paused after three failures in a row");
    expect(third.writes.some((w) => w.w === "coming-up")).toBe(true);
    const unread = at(2, { error: "the agent stopped without writing its result" });
    expect(unread.state.repeat).toMatchObject({ fails: 3, paused: true });
    expect(replies(unread.writes)[0]?.text).toContain("Paused after three failures in a row");
    expect(at(2, r({})).state.repeat).toMatchObject({ fails: 0 });
    // A failure is always said, even from a job that asks to finish quiet.
    const hushed = at(2, r({ state: "failed", text: "Notion didn't answer.", quiet: true }));
    expect(replies(hushed.writes)[0]?.text).toContain("Paused after three failures in a row");
  });
});

describe("plan: close", () => {
  it("closes the task with no agent, from anywhere, and stops a repeat", () => {
    const p = plan(
      snap({
        trigger: { kind: "comment" },
        statusId: 5,
        state: ran({
          phase: "answered",
          repeat: {
            kind: "reminder",
            every: "every day at 09:00",
            next: "2026-10-05T03:30:00.000Z",
            fails: 0,
          },
        }),
        said: [
          { id: 200, author: "door", text: "close", at: NOW, edited: false, channel: "telegram" },
        ],
      }),
      ctx(),
    );
    expect(p.do).toBe("box");
    expect(writes(p)).toContainEqual({ w: "close", reason: "completed" });
    // Its repeat is paused, not ended: `resume` carries it on (Pause and Resume on Repeats).
    expect(p.do === "box" && p.state.repeat?.paused).toBe(true);
    expect(replies(writes(p))[0]?.text).toContain("Closed");
    // The chat offers `reopen` as a button under it (cli/contracts/words.ts reads the backticks).
    expect(replies(writes(p))[0]?.text).toContain("`reopen`");
  });
});

describe("plan: a staging app's release, followed to Live", () => {
  const rel = { repo: "o/spotter", pr: "https://github.com/o/spotter/pull/9", at: NOW };
  const d = (c: Partial<Context>) =>
    plan(
      snap({
        trigger: { kind: "dispatch", job: "run" },
        statusId: 5,
        state: ran({ project: "spotter", phase: "needs-you", pending: { release: rel } }),
      }),
      ctx(c),
    );

  it("once merged, follows the production deploy (shipify/production), and says nothing yet", () => {
    const p = d({ release: { state: "merged", sha: "abc", url: "https://spotter.example.com" } });
    expect(p.do === "box" && p.state.deploy).toMatchObject({
      repo: "o/spotter",
      sha: "abc",
      production: true,
      staging: false,
      url: "https://spotter.example.com",
    });
    expect(p.do === "box" && p.state.pending.release).toBeUndefined();
    expect(replies(writes(p))).toEqual([]);
  });

  it("closed unmerged: said once, and no longer followed", () => {
    const p = d({ release: { state: "closed" } });
    expect(replies(writes(p))[0]?.text).toContain("closed without merging");
    expect(writes(p)).toContainEqual(
      expect.objectContaining({ w: "labels", remove: ["deploying"] }),
    );
  });

  it("still open: waits", () => {
    const p = d({ release: { state: "open" } });
    expect(p.do === "box" && p.state.pending.release).toBeFalsy();
  });

  it("its production deploy Live: the task is done and closes; a failed one stays open", () => {
    const followed = (state: "live" | "failed") =>
      plan(
        snap({
          trigger: { kind: "dispatch", job: "run" },
          statusId: 5,
          state: ran({
            project: "spotter",
            phase: "needs-you",
            deploy: { repo: "o/spotter", sha: "abc", production: true, staging: false, since: NOW },
          }),
        }),
        ctx({ deploy: { state, url: "https://spotter.example.com" } }),
      );
    const live = followed("live");
    expect(kinds(writes(live))).toEqual(["labels", "reply", "close"]);
    expect(live.do === "box" && live.state.phase).toBe("done");
    const failed = followed("failed");
    expect(kinds(writes(failed))).not.toContain("close");
  });

  it("a new project's first deploy On staging leaves its task open, for its release", () => {
    const p = plan(
      snap({
        trigger: { kind: "dispatch", job: "run" },
        statusId: 5,
        state: ran({
          project: "spotter",
          phase: "needs-you",
          deploy: { repo: "o/spotter", sha: "abc", staging: true, since: NOW },
        }),
      }),
      ctx({ deploy: { state: "live", staging: true, url: "https://spotter-staging.example.com" } }),
    );
    expect(replies(writes(p))[0]?.text).toContain("On staging");
    expect(kinds(writes(p))).not.toContain("close");
    expect(p.do === "box" && p.state.phase).not.toBe("done");
  });
});

describe("the prompt for a new project's runs", () => {
  const input = (project: string): PromptInput => ({
    repo: "o/shipify",
    n: 12,
    title: "new: a tip calculator",
    body: "",
    parsed: { kind: "new", ask: "a tip calculator" },
    why: "comment",
    profile: "work",
    project,
    state: newState() as TaskState,
    conversation: [],
    paths: {
      work: "/w",
      files: "/f",
      out: "/o",
      result: "/o/result.json",
      shipify: "/s",
      ship: "ship",
      read: "/r",
    },
    notes: [],
    playbook: "",
  });

  it("says each profile's folders (ADR 0044): a read run only reads; a talk run clones on demand", () => {
    const read = buildPrompt({ ...input("tipcalc"), profile: "read" });
    expect(read).toContain("This run only reads files: it has no command and no web");
    const talk = buildPrompt({
      ...input("tipcalc"),
      profile: "talk",
      repos: [{ name: "spotter", repo: "o/spotter" }],
    });
    expect(talk).toContain("gh repo clone <owner/name> /r/<name> -- --depth 1 --no-tags");
    expect(talk).toContain("`o/spotter`");
    expect(talk).not.toContain("Every project, read-only");
  });

  it("a repo that keeps its own rules: its rules first, nothing of Shipify's, its own CI", () => {
    const own = buildPrompt({
      ...input("notes-app"),
      parsed: { kind: "app", project: "notes-app", ask: "x" },
      ownRules: true,
    });
    expect(own).toContain("## Its own rules first");
    expect(own).toContain("Add nothing of Shipify's to it");
    expect(own).toContain("its CI checks the PR");
    expect(own).not.toContain("make verify`; if they fail");
  });

  it("plans in Shipify, then works on its own repo once its plan is built", () => {
    expect(buildPrompt(input("shipify"))).toContain("plan a new project");
    expect(buildPrompt(input("tipcalc"))).not.toContain("plan a new project");
    expect(buildPrompt(input("tipcalc"))).toContain("a change to `tipcalc`");
  });

  it("lists every ask the run covers, its own words and each NEW message: none left out (task #222)", () => {
    const asked = buildPrompt({
      ...input("shipify"),
      profile: "talk",
      project: undefined,
      why: "new",
      title: "Hii what is shipify?",
      body: "use pi auto\nHii what is shipify?",
      parsed: { kind: "none", ask: "Hii what is shipify?" } as never,
      conversation: [
        { who: "the owner", at: NOW, text: "What boxes do we have live as of now?", isNew: true },
      ],
    });
    expect(asked).toContain("## Cover each of these");
    expect(asked).toContain("1. Hii what is shipify?");
    expect(asked).toContain("2. What boxes do we have live as of now?");
    expect(asked).not.toContain("1. use pi auto");
  });

  it("reads a result from before the handoff file: its handoff and pages set aside (ADR 0041)", () => {
    const old = readResult(
      JSON.stringify({ v: 2, state: "done", text: "Done.", handoff: "Did it.", pages: ["/"] }),
    );
    expect(old).toEqual({ v: 2, state: "done", text: "Done." });
  });

  it("asks for a handoff file the box keeps however the run ends, and promises no screenshots (ADR 0041)", () => {
    const p = buildPrompt(input("tipcalc"));
    expect(p).toContain("`/o/handoff.md`");
    expect(p).toContain("Goal");
    expect(p).not.toContain("- `handoff`:");
    expect(p).not.toContain("- `pages`:");
    expect(p).not.toContain("screenshot");
  });

  it("shows a repeating task's repeat, and asks for all of it back to change it (ADR 0042)", () => {
    const st = {
      ...newState(),
      repeat: {
        kind: "reminder",
        every: "every day at 09:00",
        text: "Drink water",
        next: NOW,
        fails: 0,
      },
    } as TaskState;
    const p = buildPrompt({ ...input("shipify"), profile: "talk", project: undefined, state: st });
    expect(p).toContain("- **Repeats:** every day at 09:00, a reminder: “Drink water”.");
    expect(p).toContain("send the whole `repeat`");
    expect(buildPrompt(input("tipcalc"))).not.toContain("**Repeats:**");
  });

  it("starts a change only when the owner's words ask for one: a question gets an answer", () => {
    const talk = buildPrompt({ ...input("shipify"), profile: "talk", project: undefined });
    expect(talk).toContain("only when the owner's words ask for a change");
    expect(talk).toContain("A question or a check");
  });
});

describe("a run's chat files", () => {
  it("are the task's newest five, so what you sent last is never skipped; the older are named", async () => {
    const { newestFiles } = await import("../cli/kernel/run.ts");
    const at = (i: number) => ({ ref: `telegram:f${i}`, name: `f${i}.jpg` });
    const first = { files: [at(1), at(2), at(3), at(4)] };
    const later = { files: [at(5), at(6), { ref: "https://example.com/x", name: "x" }] };
    const last = { files: [at(7)] };
    const got = newestFiles([first, undefined, later, {}, last]);
    expect(got.refs.map((f) => f.name)).toEqual(["f3.jpg", "f4.jpg", "f5.jpg", "f6.jpg", "f7.jpg"]);
    expect(got.older).toEqual(["f1.jpg", "f2.jpg"]);
    expect(newestFiles([first])).toEqual({ refs: first.files, older: [] });
  });
});

describe("plan: another of your accounts (ADR 0045)", () => {
  const accounts = { own: "o", listed: ["acme", "beta"], app: "o-shipify-repos" };
  const acmeApi = {
    name: "Acme/api",
    repo: "Acme/api",
    sizeKB: 80,
    project: false,
    branch: "develop",
  };
  /** A task whose title names `title`, on `account` when it's another of yours. */
  const on = (
    title: string,
    over: Omit<Partial<Snapshot>, "state"> & { state?: Partial<TaskState> } = {},
  ) => {
    const project = /^([^:\s]+):/.exec(title)?.[1]?.toLowerCase();
    return plan(
      snap({
        accounts,
        repos: [...snap().repos, acmeApi],
        issue: { ...snap().issue, title },
        parsed: project ? { kind: "app", project, ask: title } : { kind: "question", ask: title },
        ...over,
      }),
      ctx(),
    );
  };
  const reached = { account: { login: "acme", reached: true } };

  it("changes its repo its own way, on its default branch, holding only that account", () => {
    const p = on("acme/api: rate-limit /login", reached);
    expect(p.do === "think" && p.think).toMatchObject({
      profile: "work",
      project: "Acme/api",
      ownRules: true,
      account: "acme",
      base: "develop",
    });
  });

  it("names the fix when the repos App isn't there, isn't set up, or doesn't reach the repo", () => {
    const note = (p: Plan) =>
      p.do === "think" ? p.think.notes.join(" ") : (replies(writes(p))[0]?.text ?? "");
    // The box answers itself, with the cause and the fix: no agent runs to say it.
    const missing = on("acme/api: x", {
      account: { login: "acme", reached: false, why: "no-token" },
    });
    expect(missing.do).toBe("box");
    expect(note(missing)).toContain("https://github.com/apps/o-shipify-repos/installations/new");
    expect(note(missing)).toContain("an IP allow list");
    // GitHub's own words, when it refused the token it gave.
    const refused = on("acme/api: x", {
      account: { login: "acme", reached: false, why: "HTTP 403: IP not allowed" },
    });
    expect(note(refused)).toContain("(HTTP 403: IP not allowed)");
    const unset = plan(
      snap({
        accounts: { own: "o", listed: ["acme"] },
        account: { login: "acme", reached: false },
        issue: { ...snap().issue, title: "acme/api: x" },
        parsed: { kind: "app", project: "acme/api", ask: "x" },
      }),
      ctx(),
    );
    expect(note(unset)).toContain("pnpm ship bot repos acme");
    const unpicked = on("acme/web: x", reached);
    expect(note(unpicked)).toContain("doesn't reach `acme/web` on `acme`");
  });

  it("only reads an account you haven't added, and says how to add it", () => {
    // A repo GitHub has there: on the task's first run, the box says how to add the account,
    // with no agent run only to say it.
    const looked = { "stranger/x": { repo: "stranger/x", sizeKB: 1 } };
    const p = on("stranger/x: fix it", { looked });
    expect(p.do).toBe("box");
    expect(replies(writes(p))[0]?.text).toContain("pnpm ship bot repos stranger");
    // Later words on that task carry on with the agent, so you can still ask about it.
    const later = on("stranger/x: fix it", {
      looked,
      said: [said(101, "ok, what does it do then?")],
      statusId: 5,
      state: ran(),
      trigger: { kind: "comment" },
    });
    expect(later.do === "think" && later.think.profile).toBe("talk");
    expect(later.do === "think" && later.think.notes.join(" ")).toContain(
      "pnpm ship bot repos stranger",
    );
    // One GitHub hasn't is only words, as before: `CI/CD: …` is a question, not a refused change.
    const q = on("CI/CD: speed up the pipeline", { looked: { "ci/cd": { status: 404 } } });
    expect(q.do === "think" && q.think.profile).toBe("talk");
    expect(q.do === "think" && q.think.notes.join(" ")).not.toContain("pnpm ship bot repos");
  });

  it("names Shipify's own repos by their full name as by their own: Shipify itself keeps its checks", () => {
    const p = on("o/shipify: a typo", {
      repos: [
        ...snap().repos,
        { name: "shipify", repo: "o/shipify", sizeKB: 1, project: false, branch: "main" },
      ],
    });
    expect(p.do === "think" && p.think).toMatchObject({ profile: "work", project: "shipify" });
    expect(p.do === "think" && p.think.ownRules).toBeUndefined();
    const q = on("o/notes-app: a typo");
    expect(q.do === "think" && q.think).toMatchObject({ project: "notes-app", ownRules: true });
  });

  it("works on one account: a repo on another is told, never read with this one's key", () => {
    const p = on("acme/api: compare", {
      ...reached,
      said: [said(101, "look at spotter, o/notes-app, beta/web and acme/api")],
      statusId: 5,
      state: ran({ project: "Acme/api", ownRules: true }),
      trigger: { kind: "comment" },
    });
    const t = p.do === "think" ? p.think : undefined;
    expect(t?.reads).toEqual([{ name: "Acme/api", repo: "Acme/api", mine: true, sizeKB: 80 }]);
    const notes = t?.notes.join("\n") ?? "";
    for (const name of ["spotter", "o/notes-app", "beta/web"])
      expect(notes).toContain(`\`${name}\` is on`);
    // And a task on Shipify's own account reads no other account's repo.
    const own = on("spotter: make it like acme/api", {
      said: [said(101, "look at acme/api")],
      statusId: 5,
      state: ran({ project: "spotter" }),
      trigger: { kind: "comment" },
    });
    expect(own.do === "think" && own.think.reads).toBeUndefined();
    expect(own.do === "think" && own.think.account).toBeUndefined();
    expect(own.do === "think" && own.think.notes.join(" ")).toContain("`acme/api` is on `acme`");
  });

  it("a bare name is Shipify's own account's, even when another account has one like it", () => {
    const p = on("api: x", {
      repos: [...snap().repos, acmeApi, { ...acmeApi, name: "api", repo: "o/api", branch: "main" }],
    });
    expect(p.do === "think" && p.think).toMatchObject({ project: "api", ownRules: true });
    expect(p.do === "think" && p.think.account).toBeUndefined();
  });

  it("asks you first for the notes and calls of a run there, whose repos others write too", () => {
    const work: Think = {
      profile: "work",
      project: "Acme/api",
      ownRules: true,
      account: "acme",
      base: "develop",
      why: "new",
      notes: [],
      fresh: [101],
      web: true,
    };
    const result = readResult(
      JSON.stringify({
        v: 2,
        state: "needs-you",
        text: "Done: the limit is in.",
        pr: { kind: "closes", title: "Rate-limit /login", body: "  " },
        notes: [{ topic: "acme", line: "uses develop" }],
      }),
    );
    const d = afterThink(
      snap({ accounts, ...reached, said: [said(101, "hi")], statusId: 5, state: ran() }),
      { ...newState(), ...ran() } as TaskState,
      work,
      result,
      { readOutside: false, touchesWorkflows: false, commits: true },
      ctx(),
    );
    const push = d.writes.find((w) => w.w === "push");
    // Its reply's images are made inert: that account's repos are written by others too.
    expect(d.writes.find((w) => w.w === "reply")).toMatchObject({ outside: true });
    // Its PR goes against the repo's default branch, and says what it is.
    expect(push).toMatchObject({
      repo: "Acme/api",
      base: "develop",
      body: "Done: the limit is in.",
    });
    expect(d.writes.some((w) => w.w === "note")).toBe(false);
    expect(d.state.pending.notes).toEqual([{ topic: "acme", line: "uses develop" }]);
  });

  it("takes no publish and no plan from a run on a repo that keeps its own rules", () => {
    const work: Think = {
      profile: "work",
      project: "Acme/api",
      ownRules: true,
      account: "acme",
      why: "new",
      notes: [],
      fresh: [101],
      web: true,
    };
    const result = readResult(
      JSON.stringify({
        v: 2,
        state: "needs-you",
        text: "Published.",
        plan: "takeover",
        pr: { kind: "publish", title: "First push", body: "All of it" },
      }),
    );
    const d = afterThink(
      snap({ accounts, ...reached, said: [said(101, "hi")], statusId: 5, state: ran() }),
      { ...newState(), ...ran() } as TaskState,
      work,
      result,
      { readOutside: false, touchesWorkflows: false, commits: true, firstPush: true },
      ctx(),
    );
    expect(d.writes.some((w) => w.w === "push" && w.open !== false)).toBe(false);
    expect(d.state.plan).toBeUndefined();
    expect(replies(d.writes)[0]?.text).toContain(
      "a publish (only a merged plan's new project publishes)",
    );
  });
});
