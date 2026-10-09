// Telegram, Shipify's first chat channel (ADR 0031, ADR 0032): the adapter. It proves a webhook by
// Telegram's secret header, reads an update (a message, or a tap on a button) into one Message,
// renders a reply as text plus Telegram's entities (never parse_mode markup) with its buttons or
// the reply box, sends it with the Bot API, acknowledges a tap, fetches a file a person sent, keeps
// a status pinned, and reads its own webhook's health. Everything Shipify-shaped (who you are, commands, tasks) is the
// door's. No log line holds the words, a user or chat id, a file's reference or a key.
import { chatMenu, cut, line, PIN_MARK } from "../../../cli/contracts/index.ts";
import type { Deps, Env } from "../env.ts";
import { BudgetSpent, int, json, obj, same } from "../env.ts";
import {
  type Button,
  type Channel,
  capped,
  type FileKind,
  type InFile,
  MAX_FILE_BYTES,
  type Message,
  type Outgoing,
  readHead,
  type Sent,
  type Shown,
  webUrl,
} from "./channel.ts";

/** A file Telegram keeps for the bot: its id, and what a message says about it. */
type TgFile = { file_id?: unknown; file_name?: unknown; mime_type?: unknown; file_size?: unknown };

/** A message, as much of it as the adapter reads. */
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number };
  text?: string;
  caption?: string;
  /** One photo in its sizes, smallest first. */
  photo?: TgFile[];
  document?: TgFile;
  video?: TgFile;
  video_note?: TgFile;
  animation?: TgFile;
  audio?: TgFile;
  voice?: TgFile;
  /** An album's id: each of its photos comes as a message of its own. */
  media_group_id?: string;
  reply_to_message?: { from?: { is_bot?: unknown }; text?: unknown; caption?: unknown };
  /** A message of the bot's: its buttons, as a tap shows them. */
  reply_markup?: unknown;
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_date?: unknown;
}

export interface TgUpdate {
  update_id: number;
  message: TgMessage;
}

/** Telegram holds 4,096 characters a message: every message stays under this. */
const MAX_MESSAGE = 4_000;
/** A reply's words at most, as sent; a longer one is cut, and says where the rest is. */
export const MAX_SENT = 3_500;
/** Link buttons under a message at most, and a button's label. */
const MAX_BUTTONS = 8;
const MAX_LABEL = 64;
/** A word button's words at most, as Telegram takes them (its callback_data): bytes, in UTF-8. */
const MAX_WORDS = 64;
/** Buttons in a row at most, and in a message. */
const MAX_ROW = 8;
const MAX_KEYS = 90;
/** Telegram's file ids: base64url. */
export const FILE_REF = /^[\w-]{1,500}$/;
/** Where Telegram's file server keeps a file ("photos/file_3.jpg"). */
const FILE_PATH = /^[\w-]+(?:[./][\w-]+)*$/;
/** A webhook that failed this recently, with updates waiting, is failing. */
const WEBHOOK_WINDOW_MS = 30 * 60_000;
const PHOTO = /^image\/(jpeg|png|webp)$/;

// ---------------------------------------------------------------- reading an update

const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** The update in a body, when it's a message with an id, a chat and its own id; else null. */
export const readUpdate = (body: string) => messageUpdate(obj(parsed(body)));

function messageUpdate(u: Record<string, unknown> | null | undefined): TgUpdate | null {
  const m = obj(u?.message);
  const chat = obj(m?.chat);
  if (!u || !m || !chat || !int(u.update_id) || u.update_id < 0) return null;
  if (!int(m.message_id) || !int(chat.id) || typeof chat.type !== "string") return null;
  return { update_id: u.update_id, message: m as unknown as TgMessage };
}

/** Who wrote it, in a private chat with the bot: their id. A group or a channel: null. */
export function senderOf(m: TgMessage): number | null {
  const from = obj(m.from);
  return m.chat.type === "private" && from && int(from.id) ? from.id : null;
}

const forwarded = (m: TgMessage) =>
  m.forward_origin !== undefined || m.forward_from !== undefined || m.forward_date !== undefined;

/** Their words: the text, else a photo's or a file's caption. */
export const wordsOf = (m: TgMessage) =>
  typeof m.text === "string" ? m.text : typeof m.caption === "string" ? m.caption : "";

/** A message's first line: its head, when it's one of Shipify's. */
const headOf = (m: Record<string, unknown>) => {
  const t = typeof m.text === "string" ? m.text : m.caption;
  return typeof t === "string" ? (t.split("\n")[0] ?? "") : "";
};

/** The task the head of the bot's message this one replies to names. */
function replied(m: TgMessage): Pick<Message, "repliesTo"> {
  const r = obj(m.reply_to_message);
  if (!r || obj(r.from)?.is_bot !== true) return {};
  return named(readHead(headOf(r)));
}
const named = (h: ReturnType<typeof readHead>): Pick<Message, "repliesTo"> => ({
  ...(h.task ? { repliesTo: h.task } : {}),
});

/** A message's one file, as a reference (never the bytes), with its name, type and size. */
export function mediaOf(m: TgMessage): InFile | undefined {
  const photo = Array.isArray(m.photo) ? m.photo.at(-1) : undefined;
  const ref = (f: unknown) => {
    const id = obj(f)?.file_id;
    return typeof id === "string" && FILE_REF.test(id) ? id : undefined;
  };
  const named = (f: unknown, fallback: string) => {
    const n = obj(f)?.file_name;
    return typeof n === "string" && n.trim() ? cut(n.trim(), 200) : fallback;
  };
  const found: [unknown, string, FileKind, string | undefined][] = [
    [photo, "photo.jpg", "a photo", "image/jpeg"],
    [m.video, "video.mp4", "a video", "video/mp4"],
    [m.video_note, "video.mp4", "a video", "video/mp4"],
    [m.animation, "animation.mp4", "a video", "video/mp4"],
    [m.audio, named(m.audio, "audio"), "an audio file", undefined],
    [m.voice, "voice.ogg", "a voice note", "audio/ogg"],
    [m.document, named(m.document, "file"), "a file", undefined],
  ];
  for (const [f, name, kind, type] of found) {
    const r = ref(f);
    if (!r) continue;
    const mime = obj(f)?.mime_type;
    const size = obj(f)?.file_size;
    return {
      name,
      ref: r,
      kind,
      ...(typeof mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(mime)
        ? { type: mime }
        : type
          ? { type }
          : {}),
      ...(int(size) && size >= 0 ? { size } : {}),
    };
  }
  return undefined;
}

/** A tapped message's link buttons, as the tap showed them: kept when its word buttons are spent. */
const shownLinks = new WeakMap<Message, { text: string; url: string }[][]>();

/**
 * A tap on one of the bot's buttons, in a private chat: the button's words, written as a reply to
 * the message it sat on (so its task is found as a reply's is), with the tap's id to acknowledge.
 */
function tapOf(u: Record<string, unknown>): Message | null {
  const q = obj(u.callback_query);
  const on = obj(q?.message);
  const chat = obj(on?.chat);
  const from = obj(q?.from);
  if (!q || !on || !chat || !from || !int(u.update_id) || !int(on.message_id)) return null;
  if (chat.type !== "private" || !int(chat.id) || !int(from.id)) return null;
  if (typeof q.id !== "string" || typeof q.data !== "string" || !q.data.trim()) return null;
  const m: Message = {
    id: String(u.update_id),
    messageId: String(on.message_id),
    chat: String(chat.id),
    user: String(from.id),
    words: q.data,
    forwarded: false,
    ...named(readHead(headOf(on))),
    tap: q.id.slice(0, 200),
  };
  const keys = obj(on.reply_markup)?.inline_keyboard;
  const links = (Array.isArray(keys) ? keys : [])
    .map((row) =>
      (Array.isArray(row) ? row : []).flatMap((k) => {
        const b = obj(k);
        return typeof b?.text === "string" && typeof b.url === "string" && webUrl(b.url)
          ? [{ text: b.text, url: b.url }]
          : [];
      }),
    )
    .filter((row) => row.length);
  shownLinks.set(m, links);
  return m;
}

/** An update as the door reads it: one Message, or null for anything but a private one. */
export function parse(body: string): Message | null {
  const raw = obj(parsed(body));
  if (raw?.callback_query !== undefined) return tapOf(raw);
  const u = messageUpdate(raw);
  if (!u) return null;
  const m = u.message;
  const sender = senderOf(m);
  if (sender === null) return null;
  const file = mediaOf(m);
  return {
    id: String(u.update_id),
    messageId: String(m.message_id),
    chat: String(m.chat.id),
    user: String(sender),
    words: wordsOf(m),
    forwarded: forwarded(m),
    ...replied(m),
    ...(typeof m.media_group_id === "string" ? { album: m.media_group_id.slice(0, 120) } : {}),
    ...(file ? { file } : {}),
  };
}

// ---------------------------------------------------------------- how a reply looks

const clip = (text: string) =>
  text.length > MAX_MESSAGE ? `${cut(text, MAX_MESSAGE - 1)}…` : text;

/** The text when it fits, else its first part and where the rest is. */
export function shorten(text: string): string {
  if (text.length <= MAX_SENT) return text;
  const room = MAX_SENT - 40;
  const head = cut(text, room);
  const at = head.lastIndexOf("\n\n");
  const part = (at > room / 2 ? head.slice(0, at) : head).trimEnd();
  return `${part}…\n\nThe rest is on GitHub.`;
}

/** One of Telegram's text entities: a span of the text shown bold, as code, or as a link. */
export interface Entity {
  type: "bold" | "code" | "pre" | "text_link";
  offset: number;
  length: number;
  url?: string;
}

/**
 * Markdown as the chat shows it: plain text plus Telegram's entities (bold, code, code blocks,
 * links), never parse_mode markup, so no character in it can make Telegram refuse the message.
 * `**x**` and `__x__` are bold, `# x` headings bold, `` `x` `` code, fenced blocks pre,
 * `[x](https://…)` a link on x. Entities never nest: Telegram refuses code or a link inside bold,
 * so a heading is plain words in one bold. Offsets are UTF-16 units, as Telegram counts them.
 */
export function chatFormat(md: string): { text: string; entities: Entity[] } {
  const entities: Entity[] = [];
  let text = "";
  const lines = md.split("\n");
  let fence: string[] | undefined;
  /** A line's words with their markup taken off; marked as entities unless `plain`. */
  const inline = (src: string, plain = false) => {
    const re =
      /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/g;
    let at = 0;
    let out = "";
    for (let m = re.exec(src); m; m = re.exec(src)) {
      out += src.slice(at, m.index);
      const [bold, code, label, url] = [m[1] ?? m[2], m[3], m[4], m[5]];
      const word = bold ?? code ?? label ?? "";
      const span = { offset: text.length + out.length, length: word.length };
      if (!plain)
        entities.push(
          bold !== undefined
            ? { type: "bold", ...span }
            : code !== undefined
              ? { type: "code", ...span }
              : { type: "text_link", ...span, url },
        );
      out += word;
      at = m.index + m[0].length;
    }
    return out + src.slice(at);
  };
  lines.forEach((raw, i) => {
    const nl = i < lines.length - 1 ? "\n" : "";
    if (/^```/.test(raw)) {
      if (fence) {
        const block = fence.join("\n");
        if (block) entities.push({ type: "pre", offset: text.length, length: block.length });
        text += block + nl;
        fence = undefined;
      } else fence = [];
      return;
    }
    if (fence) {
      fence.push(raw);
      return;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(raw);
    if (heading) {
      const words = inline(heading[1] ?? "", true);
      if (words) entities.push({ type: "bold", offset: text.length, length: words.length });
      text += words + nl;
      return;
    }
    // A list item keeps its marker as a bullet.
    text += inline(raw.replace(/^(\s*)[-*]\s+/, "$1• ")) + nl;
  });
  if (fence) text += fence.join("\n");
  return { text, entities };
}

/** The entities that fit in text cut to `n`, each ending where the text does. */
const within = (entities: Entity[], n: number) =>
  entities
    .filter((e) => e.offset < n && e.length > 0)
    .map((e) => (e.offset + e.length > n ? { ...e, length: n - e.offset } : e));

/** A button under a message: one that sends words (callback_data), or a link. */
type Key = { text: string; callback_data?: string; url?: string };

/** Word buttons as Telegram's: each sends its words; one whose words don't fit is left out. */
export function wordKeys(rows: Button[][] = []): Key[][] {
  const fits = (b: Button) =>
    b.words.trim() !== "" && new TextEncoder().encode(b.words).length <= MAX_WORDS;
  const out: Key[][] = [];
  let n = 0;
  for (const row of rows) {
    const keys = row
      .filter(fits)
      .map((b) => ({ text: cut(b.label.trim(), MAX_LABEL) || b.words, callback_data: b.words }));
    for (let i = 0; i < keys.length && n < MAX_KEYS; i += MAX_ROW) {
      const part = keys.slice(i, i + MAX_ROW).slice(0, MAX_KEYS - n);
      out.push(part);
      n += part.length;
    }
  }
  return out;
}

/** The reply box Telegram opens on a message (force_reply), when it has no word buttons. */
const replyBox = (asks: string | undefined, keys: Key[][]) =>
  asks && !keys.length ? cut(line(asks, 64), 64) : undefined;

const taskLink = (s: Shown): string | undefined =>
  s.task && s.taskUrl && webUrl(s.taskUrl) ? s.taskUrl : undefined;

/**
 * How one message looks in the chat: a head "State · #12 · title" (bold, its task's number a link
 * to the task; replying to it carries the task on), its words up to 3,500 characters, the run's one
 * line, its word buttons, then its links as buttons (https only, 8 at most). With the reply box
 * open (a question with no quick answers), the links are its last line instead: Telegram shows one
 * or the other.
 */
export function render(out: Outgoing) {
  const state = line(out.state || "Reply", 40);
  const num = out.task ? `#${out.task}` : "";
  const title = out.title ? line(out.title, 200) : "";
  const head = [state, num, title].filter(Boolean).join(" · ");
  const url = taskLink(out);
  const formatted = chatFormat(shorten(out.text));
  const tail = out.brief ? `\n\n${line(out.brief, 120)}` : "";
  const words = wordKeys(out.buttons);
  const links = out.links
    .filter(([, u]) => webUrl(u))
    .slice(0, MAX_BUTTONS)
    .map(([label, u]) => ({ text: cut(label.trim(), MAX_LABEL) || "Open", url: u }));
  const forceReply = replyBox(out.asks, words);
  const body = `${head}\n\n${formatted.text}${tail}`.trimEnd();
  const linked: Entity[] = [];
  let last = "";
  if (forceReply)
    for (const l of links) {
      if (last) last += " · ";
      linked.push({
        type: "text_link",
        offset: body.length + 2 + last.length,
        length: l.text.length,
        url: l.url,
      });
      last += l.text;
    }
  const text = clip(last ? `${body}\n\n${last}` : body);
  // No entity inside another: Telegram refuses some, so the link sits between two bolds.
  const heading: Entity[] = url
    ? [
        { type: "bold", offset: 0, length: state.length },
        { type: "text_link", offset: state.length + 3, length: num.length, url },
        ...(title
          ? [{ type: "bold" as const, offset: state.length + num.length + 6, length: title.length }]
          : []),
      ]
    : [{ type: "bold", offset: 0, length: head.length }];
  const entities = within(
    [
      ...heading,
      ...formatted.entities.map((e) => ({ ...e, offset: e.offset + head.length + 2 })),
      ...linked,
    ],
    text.length,
  );
  const keyboard: Key[][] = [...words, ...(forceReply ? [] : links.map((l) => [l]))];
  return { text, entities, keyboard, ...(forceReply ? { forceReply } : {}) };
}

/** Telegram's markup for a message: its buttons, or the reply box, or none. */
const markupOf = (keyboard: Key[][], forceReply?: string) =>
  keyboard.length
    ? { reply_markup: { inline_keyboard: keyboard } }
    : forceReply
      ? { reply_markup: { force_reply: true, input_field_placeholder: forceReply } }
      : {};

/** In a list of tasks, each line's leading `#n` as a link to `at` then n. */
function listedTasks(t: string, at: string): Entity[] {
  return [...t.matchAll(/^#(\d+)(?!\d)/gm)].map((m) => ({
    type: "text_link" as const,
    offset: m.index ?? 0,
    length: m[0].length,
    url: `${at}${m[1]}`,
  }));
}

/**
 * The door's own words (an answer, a picker drawn again): plain, its task's number a link, or in a
 * list of tasks, each one's.
 */
function plain(text: string, shown: Shown = {}) {
  const t = clip(text);
  const url = taskLink(shown);
  const at = url ? (t.split("\n")[0] ?? "").search(new RegExp(`#${shown.task}(?!\\d)`)) : -1;
  const entities: Entity[] =
    url && at >= 0
      ? [{ type: "text_link", offset: at, length: `#${shown.task}`.length, url }]
      : shown.tasksAt && webUrl(shown.tasksAt)
        ? within(listedTasks(t, shown.tasksAt), t.length)
        : [];
  const keys = wordKeys(shown.buttons);
  return { text: t, entities, keys, forceReply: replyBox(shown.asks, keys) };
}

/** A file's caption in the chat: it names its task, so replying to it carries the task on. */
export const captionOf = (task: number | undefined, name: string) =>
  `· ${task ? `#${task} · ` : ""}${line(name, 200)}`;

// ---------------------------------------------------------------- the Bot API

export interface TgAnswer {
  ok: boolean;
  status: number;
  result?: unknown;
  description?: string;
  /** A 429's wait, in seconds. */
  retryAfter?: number;
}

/** Telegram's words for a chat that can't be reached, whatever is sent. */
const UNREACHABLE = /chat not found|bot was blocked|user is deactivated|bot was kicked/i;

/**
 * What a failed call means: wait (429), a chat that can't be reached (403, or a 400 that says so),
 * the message as made refused (any other 400: a bug of ours), or not confirmed (no answer in time,
 * a 5xx: it may have arrived).
 */
export function failureOf(a: TgAnswer): "ok" | "wait" | "permanent" | "rendering" | "transient" {
  if (a.ok) return "ok";
  if (a.status === 429) return "wait";
  if (a.status === 403 || (a.status === 400 && UNREACHABLE.test(a.description ?? "")))
    return "permanent";
  if (a.status === 400) return "rendering";
  return "transient";
}

export interface Bot {
  call(method: string, body?: Record<string, unknown>): Promise<TgAnswer>;
  /** A call with a file in it (sendPhoto, sendDocument): multipart. */
  upload(method: string, form: FormData): Promise<TgAnswer>;
  download(path: string): Promise<Response>;
}

const API = "https://api.telegram.org";

/** The Bot API with the bot's token. A call never throws for an answer: none is status 0. */
export function botClient(
  token: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
): Bot {
  const answer = async (res: Response): Promise<TgAnswer> => {
    const said = obj(await res.json().catch(() => null));
    const retry = obj(said?.parameters)?.retry_after;
    return {
      ok: res.ok && said?.ok === true,
      status: res.status,
      result: said?.result,
      ...(typeof said?.description === "string"
        ? { description: line(said.description, 200) }
        : {}),
      ...(int(retry) ? { retryAfter: retry } : {}),
    };
  };
  const post = async (method: string, init: RequestInit, ms: number) => {
    try {
      return await answer(
        await fetcher(`${API}/bot${token}/${method}`, {
          method: "POST",
          ...init,
          signal: AbortSignal.timeout(ms),
        }),
      );
    } catch (e) {
      if (e instanceof BudgetSpent) throw e;
      return { ok: false, status: 0 };
    }
  };
  return {
    call: (method, body = {}) =>
      post(
        method,
        { headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        8_000,
      ),
    upload: (method, form) => post(method, { body: form }, 30_000),
    download: (path) =>
      fetcher(`${API}/file/bot${token}/${path}`, { signal: AbortSignal.timeout(20_000) }),
  };
}

const sentOf = (a: TgAnswer): Sent => {
  const f = failureOf(a);
  if (f === "ok") return { ok: true };
  if (f === "wait") return { ok: false, wait: a.retryAfter ?? 30 };
  if (f === "permanent") return { ok: false, refused: a.description ?? `HTTP ${a.status}` };
  if (f === "rendering") return { ok: false, rendering: a.description ?? `HTTP ${a.status}` };
  return { ok: false, transient: true };
};

// ---------------------------------------------------------------- the adapter

const bot = (env: Env, deps: Deps) => botClient(env.TELEGRAM_TOKEN ?? "", deps.fetch);

export const telegram: Channel = {
  id: "telegram",
  name: "Telegram",
  needs: ["TELEGRAM_TOKEN", "TELEGRAM_SECRET"],
  chatId: /^\d{1,15}$/,
  limits: { text: MAX_MESSAGE, button: MAX_WORDS },

  verify: (req, env) =>
    same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TELEGRAM_SECRET ?? ""),

  parse,

  /** Telegram makes the call for the bot: the answer is the webhook's own response. */
  answer(m, text, _trouble, shown) {
    const r = plain(text, shown);
    return json({
      method: "sendMessage",
      chat_id: Number(m.chat),
      ...(m.messageId
        ? {
            reply_parameters: {
              message_id: Number(m.messageId),
              allow_sending_without_reply: true,
            },
          }
        : {}),
      link_preview_options: { is_disabled: true },
      text: r.text,
      ...(r.entities.length ? { entities: r.entities } : {}),
      ...markupOf(r.keys, r.forceReply),
    });
  },

  /**
   * A tap: its toast (Telegram's spinner stops), then the tapped message drawn again, or its spent
   * buttons taken off with its links kept. "Not modified" means it shows that already: done.
   */
  async tapped(env, deps, m, ack) {
    if (!m.tap) return false;
    const b = bot(env, deps);
    const toast = await b.call("answerCallbackQuery", {
      callback_query_id: m.tap,
      ...(ack.toast ? { text: cut(ack.toast, 200) } : {}),
    });
    const at = { chat_id: Number(m.chat), message_id: Number(m.messageId) };
    let edit: TgAnswer | undefined;
    if (ack.redraw) {
      const r = plain(ack.redraw.text, ack.redraw);
      edit = await b.call("editMessageText", {
        ...at,
        text: r.text,
        ...(r.entities.length ? { entities: r.entities } : {}),
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: r.keys },
      });
    } else if (ack.spent)
      edit = await b.call("editMessageReplyMarkup", {
        ...at,
        reply_markup: { inline_keyboard: shownLinks.get(m) ?? [] },
      });
    const edited = !edit || edit.ok || /message is not modified/i.test(edit.description ?? "");
    return toast.ok && edited;
  },

  async send(env, deps, chat, out) {
    const r = render(out);
    return sentOf(
      await bot(env, deps).call("sendMessage", {
        chat_id: Number(chat),
        text: r.text,
        ...(r.entities.length ? { entities: r.entities } : {}),
        link_preview_options: { is_disabled: true },
        ...markupOf(r.keyboard, r.forceReply),
      }),
    );
  },

  /** Each file as Telegram shows its type: a picture as a photo, the rest as documents. */
  async sendFiles(env, deps, chat, task, files) {
    const b = bot(env, deps);
    let unsent = 0;
    for (const [i, file] of files.entries()) {
      const photo = PHOTO.test(file.type);
      const form = new FormData();
      form.set("chat_id", chat);
      form.set("caption", captionOf(task, file.name));
      form.set(photo ? "photo" : "document", file, file.name);
      const up = failureOf(await b.upload(photo ? "sendPhoto" : "sendDocument", form));
      // Busy: the rest aren't tried, and count with this one.
      if (up === "wait") return unsent + files.length - i;
      if (up !== "ok") unsent++;
    }
    return unsent;
  },

  async file(env, deps, ref) {
    if (!FILE_REF.test(ref)) return json({ error: "not_found" }, 404);
    const b = bot(env, deps);
    const got = await b.call("getFile", { file_id: ref });
    if (!got.ok && got.status === 400) return json({ error: "not_found" }, 404);
    if (!got.ok) return json({ error: `Telegram answered ${got.status || "nothing"}` }, 502);
    const file = obj(got.result) ?? {};
    if (int(file.file_size) && file.file_size > MAX_FILE_BYTES)
      return json({ error: "too_big" }, 413);
    const path = file.file_path;
    if (typeof path !== "string" || !FILE_PATH.test(path)) return json({ error: "not_found" }, 404);
    const res = await b.download(path).catch(() => null);
    if (!res?.ok || !res.body) return json({ error: `Telegram answered ${res?.status ?? 0}` }, 502);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_BYTES) return json({ error: "too_big" }, 413);
    return new Response(capped(res.body, MAX_FILE_BYTES), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": res.headers.get("content-type") || "application/octet-stream",
        ...(length ? { "content-length": String(length) } : {}),
      },
    });
  },

  /** Its webhook: failing when the token is refused, or it failed lately with updates waiting. */
  async health(env, deps) {
    const r = await bot(env, deps).call("getWebhookInfo");
    if (r.status === 401) return { failing: true, error: "Telegram refused the bot's token" };
    if (!r.ok) return null;
    const info = (obj(r.result) ?? {}) as {
      last_error_date?: number;
      last_error_message?: string;
      pending_update_count?: number;
    };
    const at = info.last_error_date;
    const recent = at !== undefined && deps.now() - at * 1000 < WEBHOOK_WINDOW_MS;
    if (!recent || (info.pending_update_count ?? 0) <= 0) return { failing: false };
    const said = (info.last_error_message ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    return { failing: true, error: said || "no reason given" };
  },

  /** Its menu and start screen: set again only where they differ from intents.json's. */
  async menu(env, deps) {
    const b = bot(env, deps);
    const want = chatMenu();
    const [has, about, short] = await Promise.all([
      b.call("getMyCommands"),
      b.call("getMyDescription"),
      b.call("getMyShortDescription"),
    ]);
    if (has.ok && JSON.stringify(has.result) !== JSON.stringify(want.commands))
      await b.call("setMyCommands", { commands: want.commands });
    if (about.ok && obj(about.result)?.description !== want.description)
      await b.call("setMyDescription", { description: want.description });
    if (short.ok && obj(short.result)?.short_description !== want.short)
      await b.call("setMyShortDescription", { short_description: want.short });
  },

  /**
   * The pinned status: sent and pinned with disable_notification, then edited in place (an edit
   * never notifies). The chat's pinned message is read each time, so an unpinned one, or another
   * message pinned since, is left alone.
   */
  async pin(env, deps, chat, text, shown, start) {
    const b = bot(env, deps);
    const r = plain(text, shown);
    const words = {
      chat_id: Number(chat),
      text: r.text,
      ...(r.entities.length ? { entities: r.entities } : {}),
      link_preview_options: { is_disabled: true },
    };
    if (start) {
      const sent = await b.call("sendMessage", { ...words, disable_notification: true });
      const id = obj(sent.result)?.message_id;
      if (!sent.ok || !int(id)) return undefined;
      const pinned = await b.call("pinChatMessage", {
        chat_id: Number(chat),
        message_id: id,
        disable_notification: true,
      });
      return pinned.ok || undefined;
    }
    const got = await b.call("getChat", { chat_id: Number(chat) });
    if (!got.ok) return undefined;
    const p = obj(obj(got.result)?.pinned_message);
    const now = typeof p?.text === "string" ? p.text : "";
    if (!p || obj(p.from)?.is_bot !== true || !int(p.message_id) || !now.endsWith(PIN_MARK))
      return false;
    if (now === r.text) return true;
    const edit = await b.call("editMessageText", { ...words, message_id: p.message_id });
    return edit.ok || /message is not modified/i.test(edit.description ?? "") || undefined;
  },

  linkSecret: (env) => env.TELEGRAM_SECRET,
};
