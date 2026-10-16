// The watch (edge/src/watch.ts): each duty against a fake GitHub, and the budget that stops a tick
// before Cloudflare's 50 subrequests, leaving the rest for the next one.
import { beforeAll, describe, expect, it } from "vitest";
import { chatMenu, fromLine, pinText, readFindings, replyLine } from "../../cli/contracts/index.ts";
import { clearCaches } from "../../edge/src/cache.ts";
import { BUDGET, tick } from "../../edge/src/watch.ts";
import { APP_ID, CHAT, DOOR, envFor, type Keys, keys, RUN, world } from "./fake.ts";

let k: Keys;
beforeAll(async () => {
  k = await keys();
});

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The status task, with a record. */
function status(f: ReturnType<typeof world>, record: Record<string, unknown> = {}) {
  return f.issue({
    title: "Shipify status",
    user: RUN,
    labels: ["shipify-status"],
    body: `<!-- shipify-status ${JSON.stringify({
      v: 2,
      watch: { last: new Date(f.w.at - HOUR).toISOString() },
      boxes: { pi: {} },
      ...record,
    })} -->\n# Shipify status`,
  });
}

const statusLine = (seen: Record<string, unknown>) =>
  `<!-- shipify-task ${JSON.stringify({ v: 2, ...seen })} -->`;

const line = (to = [`telegram:${CHAT}`]) =>
  replyLine({
    v: 1,
    kind: "answer",
    state: "Done",
    title: "a task",
    links: [],
    to,
    key: "k",
  } as never);

const run = (f: ReturnType<typeof world>) => tick(envFor(k), f.deps);

describe("due", () => {
  it("rings watch:due when a repeat's time has come, removing the label first", async () => {
    const f = world(k);
    const s = status(f, {
      watch: {
        last: new Date(f.w.at - HOUR).toISOString(),
        next: new Date(f.w.at - MIN).toISOString(),
      },
    });
    await run(f);
    expect(s.labels).toContain("watch:due");
    const calls = f.gh().filter((c) => c.includes(`issues/${s.number}/labels`));
    expect(calls).toEqual([
      `DELETE repos/o/shipify/issues/${s.number}/labels/watch%3Adue`,
      `POST repos/o/shipify/issues/${s.number}/labels`,
    ]);
  });

  it("rings nothing when nothing is due, the bell is rung already, or a due run is under way", async () => {
    const quiet = world(k);
    const s = status(quiet);
    await run(quiet);
    expect(s.labels).toEqual(["shipify-status"]);
    const rung = world(k);
    const s2 = status(rung, { watch: {} });
    s2.labels.push("watch:due");
    rung.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "queued",
        conclusion: null,
        display_title: "due",
        created_at: new Date(rung.w.at - MIN).toISOString(),
      },
    ];
    await run(rung);
    expect(rung.gh().some((c) => c.startsWith("DELETE"))).toBe(false);
    const busy = world(k);
    const s3 = status(busy, { watch: {} });
    busy.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "in_progress",
        conclusion: null,
        display_title: "due",
        created_at: new Date(busy.w.at).toISOString(),
      },
    ];
    await run(busy);
    expect(s3.labels).not.toContain("watch:due");
  });

  it("follows a deploying task even once its merge closed it", async () => {
    const f = world(k);
    const s = status(f);
    f.issue({ labels: ["deploying"], state: "closed" });
    f.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "completed",
        conclusion: "success",
        display_title: "due",
        created_at: new Date(f.w.at - 11 * MIN).toISOString(),
      },
    ];
    await run(f);
    expect(s.labels).toContain("watch:due");
  });

  it("follows a deploying task with a due run every 10 minutes", async () => {
    const f = world(k);
    const s = status(f);
    f.issue({ labels: ["deploying"] });
    f.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "completed",
        conclusion: "success",
        display_title: "due",
        created_at: new Date(f.w.at - 4 * MIN).toISOString(),
      },
    ];
    await run(f);
    expect(s.labels).not.toContain("watch:due");
    f.later(7 * MIN);
    await run(f);
    expect(s.labels).toContain("watch:due");
  });

  it("rings again when watch:due was left on with no run behind it", async () => {
    const f = world(k);
    const s = status(f, { watch: {} });
    s.labels.push("watch:due");
    f.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "completed",
        conclusion: "success",
        display_title: "due",
        created_at: new Date(f.w.at - 11 * MIN).toISOString(),
      },
    ];
    await run(f);
    const calls = f.gh().filter((c) => c.includes(`issues/${s.number}/labels`));
    // Taken off as lost, then rung: the ring takes it off first too.
    expect(calls).toEqual([
      `DELETE repos/o/shipify/issues/${s.number}/labels/watch%3Adue`,
      `DELETE repos/o/shipify/issues/${s.number}/labels/watch%3Adue`,
      `POST repos/o/shipify/issues/${s.number}/labels`,
    ]);
    expect(s.labels).toContain("watch:due");
  });

  it("opens the status task when there's none yet, and rings its first due run", async () => {
    const f = world(k);
    await run(f);
    const s = f.w.issues.find((i) => i.labels.includes("shipify-status"));
    expect(s?.title).toBe("Shipify status");
    expect(s?.labels).toContain("watch:due");
  });
});

describe("pin", () => {
  it("edits the pinned status in place, silently, only when what it says changed; never another message", async () => {
    clearCaches();
    const f = world(k);
    status(f);
    const asked = (method: string) => f.w.sent.filter((s) => s.method === method);
    // Pinned earlier with `/ping pin`, and still true: left as it is.
    f.w.pinned = {
      message_id: 7,
      text: pinText([{ name: "pi", online: true, slots: 1, busy: 0 }], []),
      from: { is_bot: true },
    };
    await run(f);
    expect(asked("getChat")).toHaveLength(1);
    expect(asked("editMessageText")).toEqual([]);
    // A run takes the slot: the same message, edited, with no sound.
    (f.w.runners[0] as { busy: boolean }).busy = true;
    const t = f.issue({ title: "make it blue", labels: ["working"] });
    f.later(5 * MIN);
    await run(f);
    expect(asked("editMessageText").map((s) => s.body.message_id)).toEqual([7]);
    expect(asked("sendMessage")).toEqual([]);
    expect(f.w.pinned?.text.split("\n")[0]).toBe(`1 of 1 slot busy · #${t.number}`);
    // Nothing changed since: Telegram isn't even asked.
    f.later(5 * MIN);
    await run(f);
    expect(asked("getChat")).toHaveLength(2);
    // Unpinned, or another of the bot's messages pinned: never written over.
    f.w.pinned = { message_id: 9, text: "Done · #3 · a reply", from: { is_bot: true } };
    (f.w.runners[0] as { busy: boolean }).busy = false;
    f.later(5 * MIN);
    await run(f);
    expect(asked("getChat")).toHaveLength(3);
    expect(asked("editMessageText")).toHaveLength(1);
    expect(f.w.pinned.text).toBe("Done · #3 · a reply");
  });
});

describe("stopped", () => {
  it("a task whose run ended before it finished says Stopped, once: nothing starts it but your `continue` (ADR 0040)", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    f.w.runs["task.yml"] = [
      {
        id: 77,
        status: "completed",
        conclusion: "failure",
        display_title: `task #${t.number}`,
        created_at: new Date(f.w.at - 20 * MIN).toISOString(),
        updated_at: new Date(f.w.at - 15 * MIN).toISOString(),
      },
    ];
    f.comment(
      t.number,
      `${statusLine({ working: 77, cursor: { id: 0, at: new Date(f.w.at - HOUR).toISOString() } })}\nworking · 77`,
      RUN,
    );
    const s = f.w.issues.find((i) => i.labels.includes("shipify-status"));
    await run(f);
    expect(t.labels).toContain("stuck");
    expect(f.w.events[t.number]?.map((e) => (e.label as { name: string }).name)).toEqual(["stuck"]);
    const notes = f.w.comments
      .filter((c) => c.issue === s?.number)
      .map((c) => readFindings(c.body));
    expect(notes.flatMap((n) => n?.notes ?? []).map((n) => n.problem.code)).toEqual(["stopped"]);
    // Left alone after: no start, no second note.
    f.later(11 * MIN);
    await run(f);
    expect(f.w.events[t.number]).toHaveLength(1);
  });

  it("leaves a long run alone while it's still going", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    f.w.runs["task.yml"] = [
      {
        id: 78,
        status: "in_progress",
        conclusion: null,
        display_title: `task #${t.number}`,
        created_at: new Date(f.w.at - 50 * MIN).toISOString(),
      },
    ];
    f.comment(t.number, `${statusLine({ working: 78 })}\nworking · 78`, RUN);
    await run(f);
    expect(t.labels).toEqual([]);
  });

  it("takes a dead stay's label off as it says Stopped, so your `continue` starts a run (ADR 0057)", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
    t.labels.push("staying");
    f.comment(
      t.number,
      statusLine({ cursor: { id: 1, at: new Date(f.w.at - HOUR).toISOString() } }),
      RUN,
    );
    f.comment(t.number, "and the swap?", { login: "owner" });
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual(["stuck"]);
  });

  it("takes a stay's label off when no run is going for it, and leaves a live stay's (ADR 0057)", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
    t.labels.push("staying");
    f.comment(
      t.number,
      statusLine({ cursor: { id: 1, at: new Date(f.w.at - HOUR).toISOString() } }),
      RUN,
    );
    const job = (status: string, conclusion: string | null) => ({
      id: 79,
      status,
      conclusion,
      display_title: `task #${t.number}`,
      created_at: new Date(f.w.at - 5 * MIN).toISOString(),
    });
    f.w.runs["task.yml"] = [job("in_progress", null)];
    await run(f);
    expect(t.labels).toEqual(["staying"]);
    // Its box died: GitHub ended the job, and its label-off step never ran. Nothing waits: no
    // Stopped, only the label off, so your next words start a run at once.
    f.w.runs["task.yml"] = [job("completed", "failure")];
    f.later(5 * MIN);
    await run(f);
    expect(t.labels).toEqual([]);
  });

  it("says Stopped, once, when your words wait 10 minutes with no run: it never starts one (ADR 0042)", async () => {
    const f = world(k);
    const s = status(f);
    const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
    f.comment(
      t.number,
      statusLine({ cursor: { id: 1, at: new Date(f.w.at - HOUR).toISOString() } }),
      RUN,
    );
    f.comment(t.number, "and make it blue", { login: "owner" });
    await run(f);
    expect(t.labels).toEqual([]);
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual(["stuck"]);
    const said = () =>
      f.w.comments
        .filter((c) => c.issue === s.number)
        .flatMap((c) => readFindings(c.body)?.notes ?? []);
    expect(said().map((n) => [n.problem.code, n.problem.what])).toEqual([
      [
        "words-unanswered",
        `#${t.number} wasn't answered: no run replied to your words (none started, or one broke before it could say so).`,
      ],
    ]);
    expect(said()[0]?.problem.fix).toBe("Reply `continue`.");
    // Told once, and nothing started: no label rung, then or later.
    f.later(11 * MIN);
    await run(f);
    expect(said()).toHaveLength(1);
    expect(f.w.events[t.number]?.map((e) => (e.label as { name: string }).name)).toEqual(["stuck"]);
    // Someone else's words wait on nothing.
    const g = world(k);
    status(g);
    const u = g.issue();
    g.comment(
      u.number,
      statusLine({ cursor: { id: 1, at: new Date(g.w.at - HOUR).toISOString() } }),
      RUN,
    );
    g.comment(u.number, "spam", { login: "stranger" });
    g.later(11 * MIN);
    await run(g);
    expect(u.labels).toEqual([]);
  });

  it("words a run already answered, even with a failure, aren't told again (2026-10-07: a key GitHub wouldn't mint)", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
    // The status still has the cursor from before your words: a run that broke before its agent
    // read them never moves it, and its Failed reply is their outcome.
    f.comment(
      t.number,
      statusLine({ cursor: { id: 1, at: new Date(f.w.at - HOUR).toISOString() } }),
      RUN,
    );
    f.comment(t.number, "what repeats are live?", { login: "owner" });
    f.comment(t.number, `${line()}\n**The run's “A read-only token for plan” step failed**`, RUN);
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual([]);
  });

  it("a task whose next run waits in the queue (for a box) isn't Stopped: that run reads it", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    f.w.runs["task.yml"] = [
      {
        id: 79,
        status: "queued",
        conclusion: null,
        display_title: `task #${t.number}`,
        created_at: new Date(f.w.at - 5 * MIN).toISOString(),
      },
      {
        id: 77,
        status: "completed",
        conclusion: "failure",
        display_title: `task #${t.number}`,
        created_at: new Date(f.w.at - 20 * MIN).toISOString(),
        updated_at: new Date(f.w.at - 15 * MIN).toISOString(),
      },
    ];
    f.comment(t.number, `${statusLine({ working: 77 })}\nworking · 77`, RUN);
    await run(f);
    expect(t.labels).toEqual([]);
  });

  it("waits on nothing for a setting (a `use …` alone from a chat): it waits for your words", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
    f.comment(
      t.number,
      statusLine({ cursor: { id: 1, at: new Date(f.w.at - HOUR).toISOString() } }),
      RUN,
    );
    const from = { v: 1, person: "owner", channel: "telegram", chat: "42", id: "9" } as const;
    f.comment(
      t.number,
      `${fromLine({ ...from, setting: true })}\nuse opus`,
      { login: DOOR, type: "Bot" },
      { id: APP_ID },
    );
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual([]);
    // Your words after it, with no run for them: Stopped.
    f.comment(
      t.number,
      `${fromLine({ ...from, id: "10" })}\nand blue`,
      { login: DOOR },
      { id: APP_ID },
    );
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual(["stuck"]);
  });

  it("leaves a task whose status is of another version alone: not this core's to read", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
    f.comment(t.number, statusLine({ v: 1, phase: "answered", seen: 1 }), RUN);
    f.comment(t.number, "and make it blue", { login: "owner" });
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual([]);
  });

  it("says Stopped for a new task no run has answered, written by the door", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({
      user: { login: DOOR, type: "Bot" },
      performed_via_github_app: { id: APP_ID },
    });
    f.later(11 * MIN);
    await run(f);
    expect(t.labels).toEqual(["stuck"]);
  });

  it("leaves a new task a run answered alone, its status comment older than the 100 read", async () => {
    const f = world(k);
    status(f);
    const t = f.issue({
      user: { login: DOOR, type: "Bot" },
      performed_via_github_app: { id: APP_ID },
      created_at: new Date(f.w.at - 2 * HOUR).toISOString(),
    });
    f.comment(t.number, statusLine({ cursor: { id: 0, at: new Date(f.w.at).toISOString() } }), RUN);
    f.later(18 * HOUR);
    // A busy day: 100 newer comments elsewhere, so the read leaves its status out.
    const other = f.issue({ user: { login: "stranger" } });
    for (let i = 0; i < 100; i++) f.comment(other.number, `busy ${i}`, { login: "stranger" });
    await run(f);
    expect(t.labels).toEqual([]);
  });

  it("never starts the status task, a notebook page or a pull request", async () => {
    const f = world(k);
    status(f);
    const page = f.issue({
      labels: ["notebook"],
      user: { login: DOOR },
      performed_via_github_app: { id: APP_ID },
    });
    const pr = f.issue({ pull_request: {}, user: { login: "owner" } });
    f.later(11 * MIN);
    await run(f);
    expect(page.labels).toEqual(["notebook"]);
    expect(pr.labels).toEqual([]);
  });
});

describe("notice", () => {
  const sendMessages = (f: ReturnType<typeof world>) =>
    f.w.sent.filter((x) => x.method === "sendMessage");

  it("tells each chat once that a reply with no mark of the door's after 2 minutes may be missed, then 😕", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    const c = f.reply(t.number, line());
    await run(f);
    expect(sendMessages(f)).toEqual([]);
    f.later(3 * MIN);
    await run(f);
    // A short notice with the reply's link: never the reply again.
    expect(sendMessages(f).map((x) => [x.body.chat_id, x.body.text])).toEqual([
      [
        CHAT,
        `Alert · #${t.number}\n\n#${t.number} has a reply you may have missed here. Open it on GitHub.`,
      ],
    ]);
    expect(JSON.stringify(sendMessages(f)[0]?.body.reply_markup)).toContain(`issuecomment-${c.id}`);
    expect(c.reactions.map((r) => r.content)).toEqual(["confused"]);
    f.later(5 * MIN);
    await run(f);
    expect(sendMessages(f)).toHaveLength(1);
  });

  it("marks the reply before it tells you, so a notice is never sent twice: no mark, no notice", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    const c = f.reply(t.number, line());
    f.w.reactionsFail = true;
    f.later(3 * MIN);
    await run(f);
    expect(sendMessages(f)).toEqual([]);
    f.w.reactionsFail = false;
    f.later(5 * MIN);
    await run(f);
    expect(sendMessages(f)).toHaveLength(1);
    expect(c.reactions.map((r) => r.content)).toEqual(["confused"]);
  });

  it("looks only at the door's own marks, and only at chats that are pushed to", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([
      { name: "owner", on: { github: "owner", telegram: String(CHAT), web: "me" } },
    ]);
    status(f);
    const t = f.issue();
    const marked = f.reply(t.number, line());
    marked.reactions.push({ content: "rocket", user: { login: DOOR, type: "Bot" } });
    const theirs = f.reply(t.number, line());
    theirs.reactions.push({ content: "rocket", user: { login: "owner", type: "User" } });
    f.reply(t.number, line(["telegram:999"]));
    f.reply(t.number, line(["web:me"]));
    f.later(3 * MIN);
    await run(f);
    // Someone else's 🚀 hides nothing; no one's chat, or one read in place, needs no notice.
    expect(sendMessages(f)).toHaveLength(1);
    expect(theirs.reactions.map((r) => r.content)).toEqual(["rocket", "confused"]);
  });

  it("leaves a reply older than 70 minutes alone", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    f.reply(t.number, line());
    f.later(71 * MIN);
    await run(f);
    expect(sendMessages(f)).toEqual([]);
  });

  it("stops at Telegram's 429 and leaves the rest for the next tick", async () => {
    const f = world(k);
    status(f);
    const t = f.issue();
    f.reply(t.number, line());
    f.reply(t.number, line());
    f.w.telegramFails.sendMessage = {
      status: 429,
      body: { ok: false, parameters: { retry_after: 5 } },
      times: 1,
    };
    f.later(3 * MIN);
    await run(f);
    expect(sendMessages(f)).toHaveLength(1);
  });

  it("when the notice can't be sent either: 😕 on the reply, and one alert on the status task", async () => {
    const f = world(k);
    const s = status(f);
    const t = f.issue();
    const c = f.reply(t.number, line());
    f.w.telegramFails.sendMessage = { status: 502, body: { ok: false } };
    f.later(3 * MIN);
    await run(f);
    expect(sendMessages(f)).toHaveLength(1);
    expect(c.reactions.map((r) => r.content)).toEqual(["confused"]);
    const note = f.w.comments.find((x) => x.issue === s.number);
    expect(readFindings(note?.body)?.notes.map((n) => [n.key, n.problem.code])).toEqual([
      [`unsent:${c.id}`, "reply-unsent"],
    ]);
    f.later(5 * MIN);
    await run(f);
    expect(sendMessages(f)).toHaveLength(1);
    expect(f.w.comments.filter((x) => x.issue === s.number)).toHaveLength(1);
  });
});

describe("guard", () => {
  it("says a box offline once it still is a little later, and back again", async () => {
    const f = world(k);
    const s = status(f, { boxes: { pi: {} } });
    f.w.runners[0] = { ...f.w.runners[0], status: "offline" } as never;
    const r = await run(f);
    expect(r.findings?.boxes).toEqual({ pi: "offline" });
    expect(s.labels).toContain("watch:alert-github");
    const back = world(k);
    status(back, { boxes: { pi: { offline: new Date(back.w.at - HOUR).toISOString() } } });
    expect((await run(back)).findings?.boxes).toEqual({ pi: "online" });
  });

  it("says a box back even when an old alert's label was left on with no run", async () => {
    const f = world(k);
    const s = status(f, {
      boxes: { pi: { offline: new Date(f.w.at - 4 * 24 * HOUR).toISOString() } },
    });
    s.labels.push("watch:alert-github");
    f.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "completed",
        conclusion: "success",
        display_title: "alert",
        created_at: new Date(f.w.at - 4 * 24 * HOUR).toISOString(),
      },
    ];
    const r = await run(f);
    expect(r.findings?.boxes).toEqual({ pi: "online" });
    expect(s.labels).toContain("watch:alert");
    // The lost one is taken off, though a box is online and the other bell rang.
    expect(s.labels).not.toContain("watch:alert-github");
  });

  it("leaves an alert's label alone while its run is under way", async () => {
    const f = world(k);
    const s = status(f, { boxes: { pi: { offline: new Date(f.w.at - HOUR).toISOString() } } });
    s.labels.push("watch:alert");
    f.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "in_progress",
        conclusion: null,
        display_title: "alert",
        created_at: new Date(f.w.at - 2 * MIN).toISOString(),
      },
    ];
    const r = await run(f);
    expect(r.findings).toBeUndefined();
    expect(f.gh().some((c) => c.startsWith("DELETE"))).toBe(false);
  });

  it("looks at each app's /health from the record, skips a paused one, and says failing once", async () => {
    const f = world(k);
    status(f, {
      apps: [
        { id: "spotter", url: "https://spotter.example.com" },
        { id: "links", url: "https://links.example.com", paused: true },
        {
          id: "play",
          url: "https://play.example.com",
          failing: new Date(f.w.at - HOUR).toISOString(),
        },
      ],
    });
    f.w.apps["https://spotter.example.com/health"] = { status: 503, body: { status: "failing" } };
    f.w.apps["https://play.example.com/health"] = { body: { status: "ok" } };
    const r = await run(f);
    expect(r.findings?.apps).toEqual({ spotter: "failing", play: "fine" });
    expect(f.w.calls.some((c) => c.includes("links.example.com"))).toBe(false);
  });

  it("looks at apps in turn, 8 a tick, so a ninth is looked at too (ADR 0035)", async () => {
    const f = world(k);
    const urls = Array.from({ length: 9 }, (_, i) => `https://app${i}.example.com`);
    status(f, { apps: urls.map((url, i) => ({ id: `app${i}`, url })) });
    for (const u of urls) f.w.apps[`${u}/health`] = { body: { status: "ok" } };
    const looked = () => urls.filter((u) => f.w.calls.some((c) => c.includes(new URL(u).host)));
    await run(f);
    expect(looked()).toHaveLength(8);
    f.later(5 * MIN);
    await run(f);
    expect(looked()).toEqual(urls);
  });

  it("says Telegram's webhook is failing, and reminds of key dates 30 and 7 days before, once each", async () => {
    const f = world(k);
    status(f, { alerted: ["key:tapp-pc:30"] });
    f.w.webhookInfo = {
      url: "https://shipify.example.com/door/telegram",
      last_error_date: Math.floor(f.w.at / 1000) - 60,
      last_error_message: "Wrong response from the webhook: 503",
      pending_update_count: 3,
    };
    f.w.variables.SHIPIFY_KEY_DATES = JSON.stringify({
      "the door App's key": "2026-10-09",
      "tapp-pc": "2026-10-30",
      later: "2027-09-30",
    });
    const r = await run(f);
    expect(r.findings?.channels).toEqual({
      telegram: { state: "failing", error: "Wrong response from the webhook: 503" },
    });
    expect(r.findings?.notes.map((n) => n.key)).toEqual(["key:the door App's key:7"]);
  });

  it("keeps Telegram's menu in step with intents.json: set where it differs, then left alone", async () => {
    clearCaches();
    const f = world(k);
    status(f);
    f.w.botMenu.commands = [{ command: "ping", description: "an old menu" }];
    await run(f);
    const sets = () => f.w.sent.filter((s) => s.method.startsWith("setMy")).map((s) => s.method);
    expect(sets()).toEqual(["setMyCommands", "setMyDescription", "setMyShortDescription"]);
    expect(f.w.botMenu.commands).toEqual(chatMenu().commands);
    // The next check (30 minutes on) finds it in step: nothing set again.
    f.later(31 * MIN);
    await run(f);
    expect(sets()).toHaveLength(3);
  });

  it("leaves the menu alone while the webhook is failing", async () => {
    clearCaches();
    const f = world(k);
    status(f);
    f.w.webhookInfo = {
      url: "https://shipify.example.com/door/telegram",
      last_error_date: Math.floor(f.w.at / 1000) - 60,
      last_error_message: "Wrong response from the webhook: 503",
      pending_update_count: 3,
    };
    const r = await run(f);
    expect(r.findings?.channels.telegram?.state).toBe("failing");
    expect(f.w.sent.some((s) => s.method.startsWith("setMy") || s.method.startsWith("getMy"))).toBe(
      false,
    );
  });

  it("warns of a runner within 5 days of GitHub's 30-day limit", async () => {
    const f = world(k);
    status(f, { boxes: { pi: { runner: "2.329.0" }, vps: { runner: "2.330.0" } } });
    f.w.runners.push({
      name: "vps-1",
      status: "online",
      busy: false,
      labels: [{ name: "shipify-box" }, { name: "box-vps" }],
    });
    const r = await run(f);
    expect(r.findings?.notes.map((n) => [n.key, n.problem.code])).toEqual([
      ["runner:pi:2.330.0", "runner-old"],
    ]);
  });

  it("writes changes only when no alert run is rung already; notes said once go out anyway", async () => {
    const f = world(k);
    const s = status(f, { boxes: { pi: {} } });
    s.labels.push("watch:alert");
    f.w.runs["watch.yml"] = [
      {
        id: 1,
        status: "queued",
        conclusion: null,
        display_title: "alert",
        created_at: new Date(f.w.at - MIN).toISOString(),
      },
    ];
    f.w.runners[0] = { ...f.w.runners[0], status: "offline" } as never;
    await run(f);
    expect(f.w.comments.filter((c) => c.issue === s.number)).toEqual([]);
  });
});

describe("the budget", () => {
  it("stops before 45 subrequests, leaves the rest for the next tick, and still says what it found", async () => {
    const f = world(k);
    const s = status(f, { boxes: { pi: {} } });
    f.w.runners[0] = { ...f.w.runners[0], status: "offline" } as never;
    // Many tasks whose runs died: each costs a run's look, its events and a ring.
    for (let i = 0; i < 30; i++) {
      const t = f.issue({ created_at: new Date(f.w.at - 2 * HOUR).toISOString() });
      f.comment(t.number, statusLine({ working: 500 + i }), RUN);
      f.w.runs["task.yml"] = [...(f.w.runs["task.yml"] ?? [])];
      f.w.runs["task.yml"].push({
        id: 500 + i,
        status: "completed",
        conclusion: "cancelled",
        display_title: `task #${t.number}`,
        created_at: new Date(f.w.at - HOUR).toISOString(),
      });
    }
    for (let i = 0; i < 20; i++) f.reply(s.number + 1 + i, line());
    f.later(3 * MIN);
    const before = f.w.calls.length;
    const r = await run(f);
    expect(r.spent).toBeLessThanOrEqual(BUDGET);
    expect(f.w.calls.length - before).toBeLessThan(45);
    expect(r.done).toContain("stopped");
    // Marked Stopped three at most this tick (none started); the rest wait.
    expect(f.w.issues.filter((i) => i.labels.includes("stuck"))).toHaveLength(3);
    expect(r.left.length + r.done.length).toBe(5);
  });

  it("keeps a few calls for the alert when the duties spend the rest", async () => {
    const f = world(k);
    const s = status(f);
    // Forty long runs still going: each costs a look, and none is started again.
    for (let i = 0; i < 40; i++) {
      const t = f.issue();
      f.comment(t.number, statusLine({ working: 700 + i }), RUN);
      f.w.runs["task.yml"] = [...(f.w.runs["task.yml"] ?? [])];
      f.w.runs["task.yml"].push({
        id: 700 + i,
        status: "in_progress",
        conclusion: null,
        display_title: `task #${t.number}`,
        created_at: new Date(f.w.at - HOUR).toISOString(),
      });
    }
    // And one whose words wait with no run, looked at first: Stopped, said before the budget runs out.
    const stuck = f.issue({ created_at: new Date(f.w.at - 3 * HOUR).toISOString() });
    f.comment(
      stuck.number,
      statusLine({ cursor: { id: 1, at: new Date(f.w.at - 2 * HOUR).toISOString() } }),
      RUN,
    );
    f.comment(stuck.number, "please", { login: "owner" });
    f.later(11 * MIN);
    const r = await run(f);
    expect(r.spent).toBeLessThanOrEqual(BUDGET);
    expect(r.left).toEqual(["stopped", "notice", "guard", "pin"]);
    expect(stuck.labels).toContain("stuck");
    const said = f.w.comments.filter((c) => c.issue === s.number).map((c) => readFindings(c.body));
    expect(said.flatMap((x) => x?.notes ?? []).map((n) => n.problem.code)).toEqual([
      "words-unanswered",
    ]);
    expect(s.labels).toContain("watch:alert");
  });
});

describe("the door App's key refused", () => {
  const told = (f: ReturnType<typeof world>) =>
    f.w.sent.filter((s) => String(s.body.text).includes("door App's key"));
  const refuse = async (f: ReturnType<typeof world>) => {
    f.w.tokenStatus = 401;
    const { forget } = await import("../../edge/src/cache.ts");
    forget(`gh:token:${APP_ID}:555`);
    forget("settings:o/shipify");
  };

  it("says so straight to your chat once, from the last who's-who it read, until GitHub takes it again", async () => {
    const f = world(k);
    status(f);
    await run(f); // reads who's who while GitHub still takes the key
    await refuse(f);
    f.later(HOUR);
    await run(f);
    f.later(7 * HOUR);
    await run(f);
    expect(told(f)).toHaveLength(1);
    // Taken again, then refused again: said again.
    f.w.tokenStatus = 201;
    f.later(HOUR);
    await run(f);
    await refuse(f);
    await run(f);
    expect(told(f)).toHaveLength(2);
  });

  it("says nothing with no who's-who read: it never guesses who you are", async () => {
    const f = world(k);
    status(f);
    await run(f);
    f.w.tokenStatus = 401;
    clearCaches();
    f.later(HOUR);
    await run(f);
    expect(told(f)).toEqual([]);
  });
});
