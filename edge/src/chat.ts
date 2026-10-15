// What a chat message means to Shipify, whatever its channel (ADR 0032): the commands, the task it
// carries on, a lone thanks, a new task's title, a reply as a chat shows it, and the door's own words.
// Adapters (channels/) read and render their platform; this reads Shipify. Pure.
import {
  agentsSeen,
  type Button,
  CHATS,
  cut,
  PICKER,
  pickIn,
  problem,
  type ReplyLine,
  replyButtons,
  splitList,
  useChoices,
  useCommand,
  wordOf,
} from "../../cli/contracts/index.ts";
import type { FileKind, Message, Outgoing } from "./channels/channel.ts";
import { hmacHex, same } from "./env.ts";

/** The most of your words a task keeps (the Incoming contract's limit). */
export const MAX_TEXT = 16_000;
/** A task's title at most (GitHub's limit). */
export const MAX_TITLE = 256;
/** `#12` leading your own words. */
const LEADING_TASK = /^\s*#(\d{1,9})\b/;
/** A link code: its expiry in unix seconds, a dot, and its MAC's first 16 hex characters. */
const LINK_CODE = /^([1-9]\d{0,11})\.([0-9a-f]{16})$/;
const FORWARDED = "(Forwarded)";

// ---------------------------------------------------------------- what the door says

export const UNTAKEN = "Shipify takes words, photos and files: this wasn't written down.";
export const UNREADABLE =
  "I read words and pictures, not voice notes or videos: type it, or send a screenshot.";
export const NO_BOX = "No box is online: it runs when one is back.";
export const PIN_UNTAKEN =
  "The chat didn't take the pinned status just now: send /ping pin again in a minute.";
export const ONLY_ACK =
  "To answer a task, reply to its message, or start with #<n>. For something new, just say what you want, or start with ask: …";
export const THANKS = "👍";
export const NEEDS_CAPTION =
  "Add a caption saying what to do with it, or reply to a task's message to add it there.";
/** A problem as the door says it in a chat: what happened, then the fix. */
export const told = (p: { what: string; fix: string }) => `${p.what} ${p.fix}`;
export const UNREAD_GITHUB = told(problem("github-unread"));
export const LINKED = (name: string, channel: string, id: string) =>
  `Your ${name} id is ${id}. Paste it where \`pnpm ship add ${channel}\` asks for it.`;
export const LINK_EXPIRED = (channel: string) =>
  `That link has expired: run \`pnpm ship add ${channel} --yes\` again for a new one.`;
export const NEEDS_WORDS = (command: string) =>
  `Send /${command} with your words after it, in one message: /${command} <your words>`;
export const GOT_IT = (task: number) => `Got it · #${task}`;
/** The reply box's placeholder, open on a task's message: where your words go. */
export const REPLY_TO = (task: number) => `Reply to #${task}…`;
/** A `use …` alone: a setting kept for the task's next run (no run starts), or for words to come. */
export const SET_FOR_NEXT = (pick: string, task: number) =>
  `From your next message: ${pick} · #${task}`;
export const TURNED = (task: number, open: boolean) => `${open ? "Reopened" : "Closed"} · #${task}`;
/** A close or reopen GitHub took, whose note on the task it then didn't: done, and said truly. */
export const TURNED_UNNOTED = (task: number, open: boolean) =>
  `${TURNED(task, open)}. Its note on the task couldn't be written (GitHub failed), so a run won't mention it: nothing else to do.`;
/** The first words a chat shows (Telegram's /start), with buttons that send words. */
export const WELCOME =
  "Send me anything: a question, an app idea, a change to an app. Each message starts a task, answered here. To carry one on, reply to any of its messages, or start with its number (#12 …). Model picks your model; My tasks shows them; Help has examples.";
export const WELCOME_BUTTONS: Button[][] = [
  [
    { label: "Model", words: PICKER },
    { label: "My tasks", words: "/tasks" },
    { label: "Help", words: "/help" },
  ],
];
/** Your model, kept: the one your new tasks start with (model.ts). */
export const YOUR_MODEL = (label: string) =>
  `Your model: ${label}. Your new tasks start with it; to change one task only, reply /use to it.`;
/** Your model couldn't be kept: the store didn't take it, or this edge has none. */
export const MODEL_UNKEPT =
  "Your model couldn't be kept just now, so nothing changed: send it again in a minute, or put a use line in your message (use opus).";
/** Your model couldn't be read for a new task: it started on Auto, and says so. */
export const MODEL_UNREAD = "your model couldn't be read, so Auto";
/** A tap on a message the chat no longer shows whole: its task can't be read, so nothing is written. */
export const TAP_LOST =
  "That button's message is out of reach, so I can't tell which task it's for: nothing was written. Reply to one of the task's messages instead.";

/** Words a tap may send with no task: a command, `#12` alone, or a pick (each answered at once). */
export const tapAlone = (words: string) =>
  /^\/[a-z]/i.test(words.trim()) ||
  /^#\d{1,9}$/.test(words.trim()) ||
  useCommand(words) !== undefined;
/** The Model button, under a pick that can't be used. */
export const PICK_BUTTONS: Button[][] = [[{ label: "Model", words: PICKER }]];
/**
 * A pick the one grammar can't take: said at once with what a `use` takes, nothing written. On a
 * task, its head names it, so the Model button under it picks for that task.
 */
export const NO_PICK = (words: string, o: { agent?: string; tapped?: boolean; task?: number }) =>
  `${o.task ? `#${o.task} · ` : ""}${
    o.tapped
      ? `“use ${words}” is no longer offered: nothing was written. Tap Model to pick another.`
      : `“use ${words}” names no model I can use: nothing was written. A \`use\` takes ${useChoices(
          Object.fromEntries(agentsSeen()),
          o.agent ?? agentsSeen()[0]?.[0] ?? "",
        )}.`
  }`;
/** `close` on a closed task, `reopen` on an open one: nothing to do, and nothing is written. */
export const ALREADY = (task: number, open: boolean) =>
  `Already ${open ? "open" : "closed"} · #${task}`;
/** The task the door wrote your words onto (GOT_IT, TURNED); none when it answered at once. */
export const writtenTo = (text: string) =>
  Number(/^(?:Got it|Reopened|Closed) · #(\d+)/.exec(text)?.[1]) || undefined;
export const NO_SUCH_TASK = (task: number) =>
  `There's no task #${task} to carry on: nothing was written. Reply to one of my messages, or start with the right number.`;
/** Why #n can't take your words: said at once, and nothing is written. */
export const REFUSED = {
  pr: (n: number) => `#${n} is a pull request, not a task: comment on it on GitHub.`,
  status: (n: number) => `#${n} is Shipify's status page, not a task: nothing was written.`,
  notebook: (n: number) =>
    `#${n} is a notebook page: edit it on GitHub, or say remember: … for a new note.`,
  theirs: (n: number) => `#${n} isn't one of your tasks: nothing was written.`,
  locked: (n: number) => `#${n} is locked: nothing was written.`,
} as const;

// ---------------------------------------------------------------- what a message says

/** `/start`, and what follows it: linking you (`/start <code>`), or help. Never a forwarded one. */
export function startOf(m: Message): { rest: string } | null {
  if (m.forwarded) return null;
  const hit = /^\/start(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(m.words.trim());
  return hit ? { rest: (hit[1] ?? "").trim() } : null;
}

/** A menu command alone (`/ask`, `/new@bot`), with no words and no file: it needs your words. */
export function bareCommand(m: Message): string | null {
  if (m.forwarded || m.file) return null;
  const hit = /^\/([a-z][a-z0-9_]{0,31})(?:@\w+)?$/i.exec(m.words.trim());
  const name = hit?.[1]?.toLowerCase();
  return name && CHATS.some((c) => c.chat === name) ? name : null;
}

/**
 * Your words as a task reads them: a chat command becomes its title's word (`/ask what…` →
 * `ask: what…`, `/remember x` → `remember: x`); one whose words have no fixed start (`/change`)
 * just drops it. Anything else stays as written.
 */
export function fromCommand(words: string): string {
  const hit = /^\/([a-z][a-z0-9_]{0,31})(?:@\w+)?(?:[ \t]+|\n|$)([\s\S]*)$/i.exec(
    words.trimStart(),
  );
  const c = hit?.[1] ? CHATS.find((x) => x.chat === hit[1]?.toLowerCase()) : undefined;
  if (!c || !hit) return words;
  const rest = (hit[2] ?? "").trim();
  return c.prefix ? `${c.prefix}: ${rest}` : rest;
}

/** A chat command that starts a task (`/ask …`, `/new …`): it never carries one on. */
export function startsTask(m: Message): boolean {
  if (m.forwarded) return false;
  const name = /^\s*\/([a-z][a-z0-9_]{0,31})(?:@\w+)?(?:\s|$)/i.exec(m.words)?.[1]?.toLowerCase();
  return CHATS.some((c) => c.chat === name && c.starts !== "remember");
}

/**
 * The task a message carries on: the one it replies to, or your own words starting `#12`. A
 * command that starts a task carries none on, even as a reply.
 */
export function taskOf(m: Message): number | null {
  if (startsTask(m)) return null;
  if (m.repliesTo) return m.repliesTo;
  if (m.forwarded) return null;
  const n = Number(LEADING_TASK.exec(m.words)?.[1]);
  return n > 0 ? n : null;
}

/** `#240` alone: going to that task (its head, the reply box on it), writing nothing. */
export function goesTo(m: Message): number | null {
  if (m.forwarded || m.file) return null;
  const n = Number(/^\s*#(\d{1,9})\s*$/.exec(m.words)?.[1]);
  return n > 0 ? n : null;
}

/** Words that start by naming #n (`#12 close`): the words alone, as the box reads them. */
export const withoutTask = (text: string, n: number | null) =>
  n === null ? text : text.replace(new RegExp(`^\\s*#${n}(?!\\d)[\\s:,.-]*`), "");

/**
 * A `use …` alone (on #n too, or `/use …`): a setting, not words, kept for the task's next run
 * (door-in.ts). The pick's words, as the one grammar reads them, or none.
 */
export const useAlone = (text: string, n: number | null) => useCommand(withoutTask(text, n));

/**
 * `close` or `reopen` alone on #n, as the box reads them (the fixed words, cli/contracts/words.ts):
 * the door changes the task as it writes them, so it's closed or open at once, with no run first.
 */
export function turnOf(text: string, n: number): "close" | "reopen" | undefined {
  const w = wordOf(withoutTask(text, n));
  return w === "close" || w === "reopen" ? w : undefined;
}

/** Sound or video: the agent reads words and pictures only. */
export const unreadable = (kind: FileKind | undefined) =>
  kind === "a voice note" || kind === "a video" || kind === "an audio file";

/** Someone else's words, forwarded, start with "(Forwarded)", so nothing reads them as a command. */
export function textOf(m: Message): string {
  const text = m.forwarded ? `${FORWARDED} ${m.words}`.trimEnd() : fromCommand(m.words);
  return cut(text, MAX_TEXT);
}

/**
 * A new task's title: the first line of its words, a leading `use <model>` line left out (it stays
 * in the body), at most 256 characters; with no words, what was sent ("a photo").
 */
export function titleOf(text: string, file?: { kind: string }): string {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const rest = lines.filter(Boolean);
  const words = pickIn(rest[0] ?? "") && rest.length > 1 ? rest.slice(1) : rest;
  const first = words[0] ?? file?.kind ?? "a message";
  return cut(first, MAX_TITLE).trimEnd();
}

// ---------------------------------------------------------------- linking you: /start <code>

/**
 * A link code from `ship add <channel>`: "linked" when its MAC is good and it hasn't expired,
 * "expired" when good but old, null otherwise. The code is `<exp>.<mac>`: HMAC-SHA256 of
 * `<channel>|<exp>` with HMAC-SHA256(<the channel's secret>, "shipify:link"), its first 16 hex
 * characters.
 */
export async function linkCode(code: string, secret: string, now: number, channel: string) {
  const parts = LINK_CODE.exec(code);
  if (!parts?.[1] || !parts[2] || !secret) return null;
  const mac = await hmacHex(await hmacHex(secret, "shipify:link"), `${channel}|${parts[1]}`);
  if (!same(mac.slice(0, 16), parts[2])) return null;
  return now / 1000 <= Number(parts[1]) ? ("linked" as const) : ("expired" as const);
}

// ---------------------------------------------------------------- a reply, for a chat

/** What GitHub shows that a chat doesn't need: folded details, hidden comments. */
export const forChat = (md: string) =>
  md
    .replace(/<details>[\s\S]*?<\/details>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * A run's reply as it goes to a chat: its state, task (linked) and title, its words with the
 * question last, its list for your yes after them (ADR 0049), the run's one line, its buttons
 * (every chat's, from the one list) or the reply box on a question with no quick answers, and its
 * links, the comment on GitHub first.
 */
export function outgoingOf(r: ReplyLine, task: number, words: string, on: string): Outgoing {
  const split = r.list ? splitList(forChat(words)) : { words: forChat(words) };
  const body = split.words;
  // A list only GitHub takes shows its heading alone, which says so; the rest is there.
  const list = r.list === "github" ? split.list?.split("\n")[0] : split.list;
  const question = r.question && !body.includes(r.question.trim()) ? r.question.trim() : "";
  const { rows, asks } = replyButtons(r, body);
  return {
    state: r.state || "Reply",
    task,
    taskUrl: on.replace(/#.*$/, ""),
    title: r.title,
    text: [body, question].filter(Boolean).join("\n\n"),
    ...(list ? { list } : {}),
    ...(r.brief ? { brief: r.brief } : {}),
    links: [["On GitHub", on], ...(r.links as [string, string][])],
    ...(rows.length ? { buttons: rows } : {}),
    ...(asks ? { asks: REPLY_TO(task) } : {}),
  };
}

/** An alert straight to a chat: what happened, the fix, and where to look. */
export const alertOf = (what: string, fix: string, task?: number, where?: string): Outgoing => ({
  state: "Alert",
  ...(task ? { task } : {}),
  text: `${what} ${fix}`.trim(),
  links: where ? [["On GitHub", where]] : [],
});
