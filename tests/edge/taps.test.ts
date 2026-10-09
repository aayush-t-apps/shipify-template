// Buttons are words (ADR 0042 §2), in Telegram's adapter (edge/src/channels/telegram.ts): a tap
// reads as the same words typed, replying to the message the button sat on; word buttons render
// as inline buttons (a button whose words don't fit Telegram's 64 bytes is left out); the reply box
// opens where the door asks; a task's number links to it; and a tap is acknowledged once.
import { describe, expect, it } from "vitest";
import { readHead } from "../../edge/src/channels/channel.ts";
import { parse, render, telegram } from "../../edge/src/channels/telegram.ts";
import type { Deps, Env } from "../../edge/src/env.ts";

const CHAT = 5;
const reply = (text: string, keys: unknown[][] = []) => ({
  message_id: 77,
  from: { id: 1, is_bot: true },
  chat: { id: CHAT, type: "private" },
  text,
  ...(keys.length ? { reply_markup: { inline_keyboard: keys } } : {}),
});
const tap = (data: string, on = reply("Needs you · #240 · Which colours?"), over = {}) =>
  JSON.stringify({
    update_id: 31,
    callback_query: { id: "cb-1", from: { id: CHAT }, message: on, data, ...over },
  });
const typed = (text: string, replied?: unknown) =>
  JSON.stringify({
    update_id: 30,
    message: {
      message_id: 9,
      chat: { id: CHAT, type: "private" },
      from: { id: CHAT },
      text,
      ...(replied ? { reply_to_message: replied } : {}),
    },
  });

describe("a tap reads as the words typed", () => {
  it("is a Message with the button's words, replying to the message it sat on", () => {
    const m = parse(tap("Teal"));
    expect(m).toMatchObject({
      id: "31",
      messageId: "77",
      chat: String(CHAT),
      user: String(CHAT),
      words: "Teal",
      forwarded: false,
      repliesTo: 240,
      tap: "cb-1",
    });
    // The same words typed as a reply to that message read the same, but for the tap.
    const { id: _a, messageId: _b, tap: _c, ...asTyped } = m ?? {};
    const {
      id: _d,
      messageId: _e,
      ...asTap
    } = parse(typed("Teal", reply("Needs you · #240 · Which colours?"))) ?? {};
    expect(asTyped).toEqual(asTap);
  });

  it("ignores a tap in a group, one with no words, and one on no message", () => {
    const group = { ...reply("Done · #3"), chat: { id: -9, type: "group" } };
    expect(parse(tap("Teal", group))).toBeNull();
    expect(parse(tap("Teal", reply("Done · #3"), { data: undefined }))).toBeNull();
    expect(parse(tap("Teal", reply("Done · #3"), { message: undefined }))).toBeNull();
  });

  it("finds a task in the head of the message it replies to, and nothing in one that names none", () => {
    expect(readHead("Got it · #240")).toEqual({ task: 240 });
    expect(readHead("Got it · #240 · Opus")).toEqual({ task: 240 });
    expect(readHead("#240 uses Sonnet · High")).toEqual({ task: 240 });
    expect(readHead("#231 · what repeats are live · Answered · Sonnet")).toEqual({ task: 231 });
    expect(readHead("Your model: Opus")).toEqual({});
    expect(readHead("Send me anything")).toEqual({});
    const m = parse(typed("a habit tracker", reply("Your model: Opus")));
    expect(m?.repliesTo).toBeUndefined();
  });
});

describe("word buttons, the reply box and the task's link", () => {
  const out = {
    state: "Needs you",
    task: 240,
    taskUrl: "https://github.com/o/shipify/issues/240",
    title: "colours",
    text: "Which colours?",
    links: [["On GitHub", "https://github.com/o/shipify/issues/240#c1"]] as [string, string][],
  };

  it("renders word buttons first, each sending its words; one past 64 bytes is left out", () => {
    const long = "ü".repeat(40);
    const r = render({
      ...out,
      buttons: [
        [
          { label: "Teal", words: "Teal" },
          { label: long, words: long },
        ],
      ],
    });
    expect(r.keyboard[0]).toEqual([{ text: "Teal", callback_data: "Teal" }]);
    expect(r.keyboard[1]).toEqual([{ text: "On GitHub", url: out.links[0]?.[1] }]);
    expect(r.forceReply).toBeUndefined();
  });

  it("opens the reply box when asked and it has no word buttons, its links kept in its words", () => {
    const r = render({ ...out, asks: "Reply to #240…" });
    expect(r.forceReply).toBe("Reply to #240…");
    expect(r.keyboard).toEqual([]);
    expect(r.text.endsWith("On GitHub")).toBe(true);
    expect(r.entities.at(-1)).toMatchObject({ type: "text_link", url: out.links[0]?.[1] });
    // With word buttons, a tap already replies: no reply box.
    expect(
      render({ ...out, asks: "x", buttons: [[{ label: "a", words: "a" }]] }).forceReply,
    ).toBeUndefined();
  });

  it("answers at once with the task's number linked, its buttons or the reply box", async () => {
    const m = parse(typed("hi"));
    if (!m || !telegram.answer) throw new Error("no answer");
    const body = async (r: Response) => (await r.json()) as Record<string, unknown>;
    const got = await body(
      telegram.answer(m, "Got it · #240", undefined, {
        task: 240,
        taskUrl: "https://github.com/o/shipify/issues/240",
      }),
    );
    expect(got.entities).toEqual([
      { type: "text_link", offset: 9, length: 4, url: "https://github.com/o/shipify/issues/240" },
    ]);
    expect(got.reply_markup).toBeUndefined();
    const asks = await body(telegram.answer(m, "#240 · x", undefined, { asks: "Reply to #240…" }));
    expect(asks.reply_markup).toEqual({
      force_reply: true,
      input_field_placeholder: "Reply to #240…",
    });
    const keys = await body(
      telegram.answer(m, "Welcome", undefined, { buttons: [[{ label: "Model", words: "/use" }]] }),
    );
    expect(keys.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Model", callback_data: "/use" }]],
    });
  });
});

describe("a tap, acknowledged once", () => {
  const world = (fail?: Record<string, { status: number; description: string }>) => {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const deps: Deps = {
      now: () => 0,
      sleep: async () => {},
      write: () => {},
      fetch: async (input, init) => {
        const method = new URL(input).pathname.split("/").at(-1) ?? "";
        calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
        const f = fail?.[method];
        return new Response(
          JSON.stringify(
            f ? { ok: false, description: f.description } : { ok: true, result: true },
          ),
          { status: f?.status ?? 200 },
        );
      },
    };
    return { calls, deps, env: { TELEGRAM_TOKEN: "t" } as Env };
  };
  const keys = [
    [{ text: "Teal", callback_data: "Teal" }],
    [{ text: "On GitHub", url: "https://github.com/o/shipify/issues/240" }],
  ];

  it("shows its toast, and takes spent buttons off, keeping the message's links", async () => {
    const w = world();
    const m = parse(tap("Teal", reply("Needs you · #240 · Which colours?", keys)));
    if (!m || !telegram.tapped) throw new Error("no tap");
    expect(await telegram.tapped(w.env, w.deps, m, { toast: "Got it · #240", spent: true })).toBe(
      true,
    );
    expect(w.calls).toEqual([
      { method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text: "Got it · #240" } },
      {
        method: "editMessageReplyMarkup",
        body: { chat_id: CHAT, message_id: 77, reply_markup: { inline_keyboard: [keys[1]] } },
      },
    ]);
  });

  it("draws a picker again after a pick, and a message Telegram calls not modified is fine", async () => {
    const w = world({
      editMessageText: { status: 400, description: "Bad Request: message is not modified" },
    });
    const m = parse(tap("use sonnet", reply("#240 uses Auto")));
    if (!m || !telegram.tapped) throw new Error("no tap");
    const done = await telegram.tapped(w.env, w.deps, m, {
      toast: "#240: from your next message, Sonnet",
      redraw: { text: "#240 uses Sonnet", buttons: [[{ label: "✓ Sonnet", words: "use sonnet" }]] },
    });
    expect(done).toBe(true);
    expect(w.calls[1]).toMatchObject({
      method: "editMessageText",
      body: {
        chat_id: CHAT,
        message_id: 77,
        text: "#240 uses Sonnet",
        reply_markup: { inline_keyboard: [[{ text: "✓ Sonnet", callback_data: "use sonnet" }]] },
      },
    });
    // Telegram down: said as not taken, never thrown, never tried again.
    const down = world({ answerCallbackQuery: { status: 502, description: "Bad Gateway" } });
    expect(await telegram.tapped(down.env, down.deps, m, {})).toBe(false);
    expect(down.calls).toHaveLength(1);
  });
});
