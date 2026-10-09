// Telegram's fixtures for the channel conformance suite: updates as Telegram sends them, and a Bot
// API stand-in.
import type { Deps } from "../../../edge/src/env.ts";
import type { ChannelFixture, Mode } from "./fixture.ts";

const SECRET = "tg-secret";
const CHAT = 4242;
const msg = (m: Record<string, unknown>, id = 1) =>
  JSON.stringify({
    update_id: id,
    message: { message_id: 7, chat: { id: CHAT, type: "private" }, from: { id: CHAT }, ...m },
  });

const call = (body: string, secret?: string) =>
  new Request("https://shipify.example.com/door/telegram", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret },
    body,
  });

export const telegram: ChannelFixture = {
  env: { TELEGRAM_TOKEN: "bot-token", TELEGRAM_SECRET: SECRET },
  proven: (body) => call(body, SECRET),
  unproven: (body) => [call(body), call(body, "wrong")],
  messages: {
    text: {
      body: msg({ text: "hello there" }, 11),
      want: { id: "11", chat: String(CHAT), user: String(CHAT), words: "hello there" },
    },
    file: {
      body: msg({ caption: "look", photo: [{ file_id: "small" }, { file_id: "AgACbig" }] }),
      want: { ref: "AgACbig", kind: "a photo" },
    },
    reply: {
      body: msg({
        text: "and bigger",
        reply_to_message: { from: { is_bot: true }, text: "Done · #12 · make it faster" },
      }),
      task: 12,
    },
    forwarded: { body: msg({ text: "/apps", forward_date: 1 }) },
    tap: {
      body: JSON.stringify({
        update_id: 12,
        callback_query: {
          id: "cb-1",
          from: { id: CHAT },
          data: "continue",
          message: {
            message_id: 8,
            from: { id: 1, is_bot: true },
            chat: { id: CHAT, type: "private" },
            text: "Failed · #12 · make it faster\n\nIt broke.",
          },
        },
      }),
      words: "continue",
      task: 12,
    },
    ignored: [
      "not json",
      JSON.stringify({ update_id: 1, edited_message: { message_id: 1 } }),
      msg({ text: "hi", chat: { id: -5, type: "group" } }),
    ],
  },
  chat: String(CHAT),
  file: { ref: "BQACfile", bytes: "%PDF-1.4 fake" },
  platform() {
    let mode: Mode = "ok";
    let healthy = true;
    const texts: string[] = [];
    const files: string[] = [];
    let buttons: string[] = [];
    // The bot's menu and start screen, as Telegram keeps them: empty until set.
    const shown = { commands: [] as unknown[], description: "", short: "" };
    const sets: string[] = [];
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const deps: Deps = {
      now: () => Date.parse("2026-10-05T12:00:00Z"),
      sleep: async () => {},
      write: () => {},
      fetch: async (input, init) => {
        const url = new URL(input);
        if (url.pathname.startsWith("/file/bot")) return new Response("%PDF-1.4 fake");
        const method = url.pathname.split("/").at(-1) ?? "";
        if (mode === "down") throw new Error("no answer");
        if (mode === "wait")
          return answer(429, {
            ok: false,
            parameters: { retry_after: 3 },
            description: "Too Many",
          });
        if (mode === "refused")
          return answer(403, { ok: false, description: "Forbidden: bot was blocked by the user" });
        if (mode === "wrong")
          return answer(400, { ok: false, description: "Bad Request: can't parse entities" });
        if (method === "sendMessage") {
          const b = JSON.parse(String(init?.body));
          texts.push(String(b.text));
          const keys = (b.reply_markup?.inline_keyboard ?? []) as { callback_data?: string }[][];
          buttons = keys.flat().flatMap((k) => k.callback_data ?? []);
          return answer(200, { ok: true, result: { message_id: 1 } });
        }
        if (method === "answerCallbackQuery" || method.startsWith("editMessage"))
          return answer(200, { ok: true, result: true });
        if (method === "sendPhoto" || method === "sendDocument") {
          const form = init?.body as FormData;
          const f = form.get("photo") ?? form.get("document");
          files.push(f instanceof File ? f.name : "?");
          return answer(200, { ok: true, result: {} });
        }
        if (method === "getFile") {
          const id = JSON.parse(String(init?.body)).file_id;
          return id === "BQACfile"
            ? answer(200, { ok: true, result: { file_path: "documents/f.pdf", file_size: 13 } })
            : answer(400, { ok: false, description: "Bad Request: invalid file_id" });
        }
        if (method === "getWebhookInfo")
          return answer(200, {
            ok: true,
            result: healthy
              ? { pending_update_count: 0 }
              : {
                  pending_update_count: 3,
                  last_error_date: Math.floor(deps.now() / 1000) - 60,
                  last_error_message: "Wrong response from the webhook: 500",
                },
          });
        if (method === "getMyCommands") return answer(200, { ok: true, result: shown.commands });
        if (method === "getMyDescription")
          return answer(200, { ok: true, result: { description: shown.description } });
        if (method === "getMyShortDescription")
          return answer(200, { ok: true, result: { short_description: shown.short } });
        if (method.startsWith("setMy")) {
          const b = JSON.parse(String(init?.body));
          sets.push(method);
          if (method === "setMyCommands") shown.commands = b.commands;
          if (method === "setMyDescription") shown.description = b.description;
          if (method === "setMyShortDescription") shown.short = b.short_description;
          return answer(200, { ok: true, result: true });
        }
        return answer(404, { ok: false });
      },
    };
    return {
      deps,
      sets: () => sets,
      buttons: () => buttons,
      mode: (m) => {
        mode = m;
      },
      texts: () => texts,
      files: () => files,
      healthy: (ok) => {
        healthy = ok;
      },
    };
  },
};
