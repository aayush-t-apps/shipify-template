// Where a message goes, and a chat that guides you (ADR 0042 §1–§3), at the door against a fake
// GitHub and Telegram: /start, /tasks, `#240` alone, the /use picker and its taps, `/ask` as a reply,
// a new task's pick carried by the message that asked for it, and every pick judged as the box
// judges it. What needs no run writes nothing; a tap goes through the same door as typed words.
import { beforeAll, describe, expect, it } from "vitest";
import {
  agentsSeen,
  pickOf,
  readFrom,
  STATUS_MARK,
  useCommand,
  effortsFor,
} from "../../cli/contracts/index.ts";
import { handle } from "../../edge/src/app.ts";
import { clearCaches } from "../../edge/src/cache.ts";
import type { Env } from "../../edge/src/env.ts";
import { picker } from "../../edge/src/guide.ts";
import { CHAT, DOOR, envFor, type Keys, keys, RUN, type World, world } from "./fake.ts";
import { memoryKv } from "./kv.ts";

let k: Keys;
beforeAll(async () => {
  k = await keys();
});

let next = 700_000;
const typed = (text: string, replied?: string, id = next++) => ({
  update_id: id,
  message: {
    message_id: 3,
    chat: { id: CHAT, type: "private" },
    from: { id: CHAT },
    text,
    ...(replied ? { reply_to_message: { from: { is_bot: true }, text: replied } } : {}),
  },
});
/** A tap on a button of the bot's message `on` (its text), sending `data`. */
const tap = (
  data: string,
  on: string,
  more: { keys?: unknown[][]; from?: number; id?: number } = {},
) => {
  const id = more.id ?? next++;
  return {
    update_id: id,
    callback_query: {
      id: `cb${id}`,
      from: { id: more.from ?? CHAT },
      data,
      message: {
        message_id: 50,
        from: { id: 1, is_bot: true },
        chat: { id: more.from ?? CHAT, type: "private" },
        text: on,
        ...(more.keys ? { reply_markup: { inline_keyboard: more.keys } } : {}),
      },
    },
  };
};
/** The edge's store (FILES), for your model: one each test that wants it. */
let kept: ReturnType<typeof memoryKv> | undefined;
const post = (f: World, body: unknown) =>
  handle(
    new Request("https://shipify.example.com/door/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "tg-secret" },
      body: JSON.stringify(body),
    }),
    envFor(k, kept ? ({ FILES: kept.kv } as unknown as Partial<Env>) : {}),
    f.deps,
  );
type Answer = {
  text: string;
  entities?: unknown[];
  reply_markup?: {
    inline_keyboard?: { text: string; callback_data?: string }[][];
    force_reply?: boolean;
    input_field_placeholder?: string;
  };
};
/** The door's answer (Telegram's call in the webhook's response), or null for none. */
const answer = async (res: Response): Promise<Answer | null> => {
  const t = await res.text();
  return t ? (JSON.parse(t) as Answer) : null;
};
const words = (a: Answer | null) =>
  (a?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
const calls = (f: World, method: string) => f.w.sent.filter((s) => s.method === method);
/** A task's status comment, by a run, keeping its pick. */
const pick = (f: World, n: number, use: Record<string, string>) =>
  f.comment(n, `<!-- shipify-task ${JSON.stringify({ v: 2, use })} -->\nWorking on it`, RUN);
/** What the door wrote: its tasks and its comments. */
const written = (f: World) =>
  f.w.issues.filter((i) => i.user.login === DOOR).length +
  f.w.comments.filter((c) => readFrom(c.body)).length;

describe("going to a task, with no mode", () => {
  it("welcomes you on /start with buttons that send words, and writes nothing", async () => {
    const f = world(k);
    const a = await answer(await post(f, typed("/start")));
    expect(a?.text).toContain("Send me anything");
    expect(a?.text).toContain("reply to any of its messages");
    expect(words(a)).toEqual(["/use", "/tasks", "/help"]);
    expect(written(f)).toBe(0);
  });

  it("lists your open tasks on /tasks by what they wait on, each a tap away; a tap shows its head with the reply box", async () => {
    const f = world(k);
    const t = f.issue({ title: "what repeats are live", labels: ["answered"] });
    const r = f.issue({ title: "take vitamin D", labels: ["repeats"] });
    f.issue({ title: "a tip calculator", labels: ["working"] });
    const record = {
      v: 2,
      upcoming: [{ n: r.number, title: r.title, next: new Date(f.w.at + 3_600_000).toISOString() }],
    };
    f.issue({
      title: "Shipify status",
      body: `${STATUS_MARK}${JSON.stringify(record)} -->`,
      labels: ["shipify-status"],
    });
    pick(f, t.number, { model: "sonnet" });
    const list = await answer(await post(f, typed("/tasks")));
    expect(list?.text).toBe(
      `Working\n#3 · a tip calculator\n\nRepeating\n#2 · take vitamin D · next in 1h\n\nAnswered\n#1 · what repeats are live`,
    );
    expect(words(list)).toEqual(["#3", "#2", "#1"]);
    // Each task's number in the list opens it on GitHub.
    const at = (n: number) => list?.text.indexOf(`\n#${n} ·`) ?? -1;
    expect(list?.entities).toEqual(
      [3, 2, 1].map((n) => ({
        type: "text_link",
        offset: at(n) + 1,
        length: 2,
        url: `https://github.com/o/shipify/issues/${n}`,
      })),
    );
    // A tap on #1 is `#1` alone: its head, the reply box open on it, and nothing written.
    const head = await answer(await post(f, tap("#1", "Your open tasks")));
    expect(head?.text).toBe("#1 · what repeats are live · Answered · Sonnet");
    expect(head?.reply_markup).toEqual({
      force_reply: true,
      input_field_placeholder: "Reply to #1…",
    });
    expect(head?.entities).toEqual([
      { type: "text_link", offset: 0, length: 2, url: "https://github.com/o/shipify/issues/1" },
    ]);
    expect(calls(f, "answerCallbackQuery")).toHaveLength(1);
    expect(written(f)).toBe(0);
  });

  it("says why `#n` alone can't be gone to (a PR, the status task, someone else's), writing nothing", async () => {
    const f = world(k);
    f.issue({ title: "a PR", pull_request: {} });
    f.issue({ title: "status", labels: ["shipify-status"] });
    f.issue({ title: "theirs", user: { login: "stranger" } });
    expect((await answer(await post(f, typed("#1"))))?.text).toContain("pull request");
    expect((await answer(await post(f, typed("#2"))))?.text).toContain("status page");
    expect((await answer(await post(f, typed("#3"))))?.text).toContain("isn't one of your tasks");
    expect(written(f)).toBe(0);
  });

  it("starts a new task on `/ask …` even as a reply: a command never continues one", async () => {
    const f = world(k);
    f.issue({ title: "a tip calculator" });
    const a = await answer(
      await post(f, typed("/ask what is 2+2?", "Done · #1 · a tip calculator")),
    );
    expect(a?.text).toBe("Got it · #2 · Auto (Sonnet · Medium)");
    expect(f.w.issues.at(-1)?.title).toBe("ask: what is 2+2?");
    expect(f.w.comments).toEqual([]);
  });
});

describe("picking a model: two taps, nothing stored, no run", () => {
  it("shows a task's pick with ✓ and Claude's effort row; a tap sets it from your next message, said in a toast", async () => {
    const f = world(k);
    f.issue({ title: "a tip calculator" });
    pick(f, 1, { agent: "claude", model: "sonnet" });
    const picker = await answer(await post(f, typed("/use", "Done · #1 · a tip calculator")));
    expect(picker?.text.split("\n")[0]).toBe("#1 uses Sonnet");
    const keys = picker?.reply_markup?.inline_keyboard?.flat() ?? [];
    expect(keys).toContainEqual({ text: "Sonnet ✓", callback_data: "use sonnet" });
    expect(keys).toContainEqual({ text: "Extra high", callback_data: "use sonnet xhigh" });
    expect(keys).toContainEqual({ text: "Auto ✓", callback_data: "use sonnet auto" });
    // A tap on High: a setting on #1 (no run starts for it), the picker drawn again, no message.
    const res = await post(f, tap("use sonnet high", picker?.text ?? ""));
    expect(await answer(res)).toBeNull();
    expect(readFrom(f.w.comments.at(-1)?.body)).toMatchObject({ setting: true });
    expect(f.w.comments.at(-1)?.body).toContain("use sonnet high");
    expect(calls(f, "answerCallbackQuery").at(-1)?.body.text).toBe(
      "#1: from your next message, Sonnet · High",
    );
    const drawn = calls(f, "editMessageText").at(-1)?.body;
    expect(String(drawn?.text).split("\n")[0]).toBe("#1 uses Sonnet · High");
    expect(JSON.stringify(drawn?.reply_markup)).toContain('"High ✓"');
    // Before any run reads it, the task shows the pick you just made, and the next builds on it.
    f.later(60_000);
    const again = await answer(await post(f, typed("/use", "Done · #1 · a tip calculator")));
    expect(again?.text.split("\n")[0]).toBe("#1 uses Sonnet · High");
    const head = await answer(await post(f, typed("#1")));
    expect(head?.text).toContain("Sonnet · High");
    await post(f, tap("use glm-5.3-flash", again?.text ?? ""));
    f.later(60_000);
    const third = await answer(await post(f, typed("/use", "Done · #1 · a tip calculator")));
    expect(third?.text.split("\n")[0]).toMatch(/^#1 uses Pi · glm-5\.3-flash/);
  });

  it("`#1 /use` sent fresh is task 1's picker, as a reply's /use is; `#1 use opus` sets it", async () => {
    const f = world(k);
    f.issue({ title: "a tip calculator" });
    pick(f, 1, { agent: "claude", model: "sonnet" });
    const before = f.w.comments.length;
    const picker = await answer(await post(f, typed("#1 /use")));
    expect(picker?.text.split("\n")[0]).toBe("#1 uses Sonnet");
    // Nothing written: no run for it.
    expect(f.w.comments.length).toBe(before);
    await post(f, typed("#1 use opus high"));
    expect(readFrom(f.w.comments.at(-1)?.body)).toMatchObject({ setting: true });
    expect(f.w.comments.at(-1)?.body).toContain("use opus high");
  });

  it("a fresh /use is your model: a tap keeps it, nothing to answer, and every new task starts with it", async () => {
    kept = memoryKv();
    try {
      const f = world(k);
      const picker = await answer(await post(f, typed("/use")));
      expect(picker?.text.split("\n")[0]).toBe("Your model: Auto (Sonnet · Medium)");
      // Each agent's own Auto: the way back to it from any pick.
      expect(words(picker)).toEqual(expect.arrayContaining(["use claude auto", "use pi auto"]));
      // A tap keeps it and draws the picker again: no question, no message, nothing written.
      const res = await post(f, tap("use opus", picker?.text ?? ""));
      expect(await answer(res)).toBeNull();
      expect(calls(f, "answerCallbackQuery").at(-1)?.body.text).toBe("Your model: Opus");
      expect(String(calls(f, "editMessageText").at(-1)?.body.text).split("\n")[0]).toBe(
        "Your model: Opus",
      );
      expect(written(f)).toBe(0);
      // Every new task starts with it, and says so; a reply on a task stays that task's.
      const got = await answer(await post(f, typed("plan a habit tracker")));
      expect(got?.text).toBe("Got it · #1 · Opus");
      expect(f.w.issues[0]?.title).toBe("plan a habit tracker");
      expect(f.w.issues[0]?.body).toContain("use claude opus\nplan a habit tracker");
      // Your own `use` line wins for that task.
      const own = await answer(await post(f, typed("use haiku\nand a timer")));
      expect(own?.text).toBe("Got it · #2 · Haiku");
      expect(f.w.issues[1]?.body).not.toContain("use claude opus");
      // Typed, the same: `use pi auto` is your model now; `use high` builds on it.
      expect((await answer(await post(f, typed("use pi auto"))))?.text).toContain("Your model: Pi");
      await post(f, typed("a third"));
      expect(f.w.issues[2]?.body).toContain("use pi auto\na third");
      // Back to Auto: no `use` line at all.
      await post(f, typed("use claude auto"));
      await post(f, typed("a fourth"));
      expect(f.w.issues[3]?.body).not.toContain("use ");
    } finally {
      kept = undefined;
    }
  });

  it("your model couldn't be read: the task starts on Auto, and says so", async () => {
    kept = memoryKv();
    try {
      const f = world(k);
      kept.state.down = true;
      expect((await answer(await post(f, typed("plan it"))))?.text).toBe(
        "Got it · #1 · your model couldn't be read, so Auto",
      );
      expect((await answer(await post(f, typed("use opus"))))?.text).toContain("couldn't be kept");
    } finally {
      kept = undefined;
    }
  });

  it("judges a pick against the task's own, as the box does, and tells one it can't take with a Model button", async () => {
    const f = world(k);
    f.issue({ title: "on pi" });
    pick(f, 1, { agent: "pi" });
    const before = f.w.comments.length;
    // pi's `off` is its own effort; `xhigh` is Claude's, which pi doesn't take.
    expect((await answer(await post(f, typed("#1 use off"))))?.text).toBe(
      "From your next message: Pi · Off · #1",
    );
    const no = await answer(await post(f, typed("#1 use xhigh")));
    // Its head names #1, so its Model button picks for #1.
    expect(no?.text).toMatch(/^#1 · “use xhigh” names no model I can use/);
    expect(no?.text).toContain("an effort (off, low, medium, high, max)");
    expect(words(no)).toEqual(["/use"]);
    expect(f.w.comments.length).toBe(before + 1);
    // A `use` line in a longer message, or a new task's, that can't be taken: told, nothing written.
    const line = await answer(
      await post(f, typed("use haiku high\nand make it blue", "Done · #1 · on pi")),
    );
    expect(line?.text).toContain("“use haiku high” names no model I can use");
    expect((await answer(await post(f, typed("use haiku high\nplan it"))))?.text).toContain(
      "“use haiku high” names no model I can use",
    );
    expect(f.w.comments.length).toBe(before + 1);
    expect(f.w.issues).toHaveLength(1);
  });

  it("a /models find tapped on a task picks it on the task's agent when that one takes it, else pi", async () => {
    const f = world(k);
    f.issue({ title: "on opencode" });
    pick(f, 1, { agent: "opencode" });
    f.issue({ title: "on claude" });
    const found = (n: number) => `#${n} · openrouter, “kimi”\nmoonshotai/kimi-k3`;
    // Written as said, and read by the box as the door reads it here.
    const told = async (n: number) => {
      const a = await answer(await post(f, tap("use moonshotai/kimi-k3", found(n))));
      expect(f.w.comments.at(-1)?.body).toContain("use moonshotai/kimi-k3");
      return a?.text ?? calls(f, "answerCallbackQuery").at(-1)?.body.text;
    };
    expect(await told(1)).toMatch(/^#1: from your next message, OpenCode · \S*kimi-k3$/);
    expect(await told(2)).toMatch(/^#2: from your next message, Pi · \S*kimi-k3$/);
  });

  it("an old effort button tapped after the task moved agents means exactly what it says", async () => {
    const f = world(k);
    f.issue({ title: "now on pi" });
    pick(f, 1, { agent: "pi", model: "z-ai/glm-5.3" });
    await post(f, tap("use sonnet high", "#1 uses Sonnet"));
    expect(f.w.comments.at(-1)?.body).toContain("use sonnet high");
    expect(calls(f, "answerCallbackQuery").at(-1)?.body.text).toBe(
      "#1: from your next message, Sonnet · High",
    );
  });
});

describe("the picker", () => {
  it("offers only picks the one grammar takes, each naming the whole pick, effort only where its agent has no gateway", () => {
    for (const [agent, e] of agentsSeen())
      for (const model of [undefined, ...(e.models ?? [])]) {
        const p = picker(7, { agent, ...(model ? { model } : {}) });
        for (const b of p.buttons.flat())
          expect(pickOf(useCommand(b.words) ?? "", { agent, model }), b.words).toBeDefined();
        const effortRow = p.text.includes("effort");
        expect(effortRow, `${agent} ${model}`).toBe(!e.gateway && effortsFor(e, model).length > 0);
      }
  });

  it("each agent has its own Auto, and the default's is the way back from any pick", () => {
    const seen = agentsSeen() as [string, { models?: string[] }][];
    const ids = seen.map(([id]) => id);
    const [[first], [other, o]] = seen as [[string], [string, { models?: string[] }]];
    const model = o.models?.[0] as string;
    const autos = (p: ReturnType<typeof picker>) =>
      p.buttons.flat().filter((b) => / · Auto( ✓)?$/.test(b.label));
    const p = picker(7, { agent: other, model });
    expect(autos(p).map((b) => b.words)).toEqual(ids.map((a) => `use ${a} auto`));
    expect(pickOf(useCommand(`use ${first} auto`) ?? "", { agent: other, model })?.agent).toBe(
      first,
    );
    // ✓ only on the Auto of the agent the pick is on, with no model or effort of its own.
    // Each by its name ("OpenCode"), else its id capitalised ("Pi").
    const named = (a: string) =>
      (Object.fromEntries(seen)[a] as { name?: string })?.name ??
      `${a[0]?.toUpperCase()}${a.slice(1)}`;
    expect(autos(picker(7, {})).map((b) => b.label)).toEqual(
      ids.map((a) => `${named(a)} · Auto${a === first ? " ✓" : ""}`),
    );
    expect(autos(picker(7, {})).map((b) => b.label)).toContain("OpenCode · Auto");
    expect(autos(picker(7, { agent: other })).map((b) => b.label.endsWith("✓"))).toEqual(
      ids.map((a) => a === other),
    );
  });

  it("names the agent on a model button when another agent lists that model too, so a tap picks it in its own row", () => {
    const seen = agentsSeen();
    for (const [a, e] of seen)
      for (const m of e.models ?? []) {
        const button = picker(7, {})
          .buttons.flat()
          .find((b) => b.words.endsWith(` ${m.split("/").pop()}`) && b.words.includes(`use ${a} `));
        const shared = seen.some(([b, x]) => b !== a && x.models?.includes(m));
        if (!shared) continue;
        expect(button, `${a} ${m}`).toBeDefined();
        expect(
          pickOf(useCommand(button?.words ?? "") ?? "", { agent: "claude" }),
          `${a} ${m}`,
        ).toMatchObject({ agent: a, model: m });
      }
  });
});

describe("a tap is your words", () => {
  const keysOn = [
    [{ text: "Teal", callback_data: "Teal" }],
    [{ text: "On GitHub", url: "https://github.com/o/shipify/issues/1#c" }],
  ];

  it("writes a quick answer on its task once, and takes the spent buttons off", async () => {
    const f = world(k);
    f.issue({ title: "colours", labels: ["needs you"] });
    const first = tap("Teal", "Needs you · #1 · colours", { keys: keysOn });
    expect((await answer(await post(f, first)))?.text).toBe("Got it · #1");
    expect(f.w.comments.at(-1)?.body).toContain("\nTeal");
    expect(calls(f, "editMessageReplyMarkup").at(-1)?.body.reply_markup).toEqual({
      inline_keyboard: [keysOn[1]],
    });
    // The same update sent again is written once; a second tap is a second ask, as typed twice.
    await post(f, first);
    expect(f.w.comments).toHaveLength(1);
    await post(f, tap("Teal", "Needs you · #1 · colours", { keys: keysOn }));
    expect(f.w.comments).toHaveLength(2);
  });

  it("a tap on a message whose task it can't read (gone from view) is told, never a new task", async () => {
    const f = world(k);
    f.issue({ title: "colours" });
    const a = await answer(await post(f, tap("continue", "")));
    expect(a?.text).toContain("can't tell which task");
    expect(f.w.issues).toHaveLength(1);
    expect(f.w.comments).toEqual([]);
    expect(calls(f, "answerCallbackQuery")).toHaveLength(1);
  });

  it("ignores a tap from someone who isn't a person: no answer, nothing written", async () => {
    const f = world(k);
    f.issue({ title: "colours" });
    const res = await post(f, tap("Teal", "Needs you · #1 · colours", { from: 77 }));
    expect(await res.text()).toBe("");
    expect(calls(f, "answerCallbackQuery")).toEqual([]);
    expect(f.w.comments).toEqual([]);
  });
});

describe("what broke, told truly", () => {
  it("tells someone it can't yet know only that GitHub can't be reached, whatever broke", async () => {
    const f = world(k);
    f.w.variablesFail = 403;
    const a = await answer(await post(f, typed("hello")));
    expect(a?.text).toBe("Couldn't reach GitHub: nothing was saved. Send it again in a minute.");
    clearCaches();
  });

  it("says a close GitHub took is done, even when its note on the task couldn't be written", async () => {
    const f = world(k);
    f.issue({ title: "done with" });
    f.w.commentsFail = 500;
    const a = await answer(await post(f, typed("close", "Done · #1 · done with")));
    expect(a?.text).toMatch(/^Closed · #1\. /);
    expect(a?.text).not.toContain("nothing was saved");
    expect(f.w.issues[0]?.state).toBe("closed");
    expect(f.w.issues[0]?.user).not.toEqual({ login: DOOR });
  });
});
