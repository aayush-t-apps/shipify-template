// The hidden lines on GitHub that the core and the edge read (ADR 0031):
//   <!-- shipify-from {…} -->   first line of a comment or issue the door App wrote for you
//   <!-- shipify-reply {…} -->  first line of a reply a run wrote, which the door copies to chats
// A line counts only when its author is the right one (the door App, or a run); the caller checks
// the author, never the text. Canonical JSON, so both sides read and write the same bytes.
import { z } from "zod";
import { canonicalJson } from "./json.ts";
import { REPLY_KINDS } from "./labels.ts";
import { FileRef, Link, MAX_FILES_IN } from "./shapes.ts";

/** What the door records about a message it wrote onto a task for you. */
export const From = z.object({
  v: z.literal(1),
  person: z.string().min(1).max(40),
  channel: z.string().regex(/^[a-z][a-z0-9-]*$/),
  chat: z.string().max(80),
  /** The channel's id for the update (Telegram's update_id): a retry is written once. */
  id: z.string().max(120),
  /** An album's id (Telegram's media_group_id): its photos land on one task. */
  album: z.string().max(120).optional(),
  /** Files that came with it, by reference (`telegram:<file_id>`): plan fetches each one. */
  files: z.array(FileRef).max(MAX_FILES_IN).optional(),
  /**
   * A setting, not words (a `use …` alone, or a `reopen` the door did): kept on the task for its
   * next run, which starts no run of its own (task.yml skips it, the watch doesn't wait on it).
   */
  setting: z.literal(true).optional(),
});
export type From = z.infer<typeof From>;

/**
 * What a run records on a reply, for the door to copy it out. The words are the comment itself, its
 * files too (apply.ts).
 */
export const ReplyLine = z.object({
  v: z.literal(1),
  kind: z.enum(REPLY_KINDS),
  state: z.string().max(40),
  title: z.string().max(256),
  links: z.array(Link).max(10).default([]),
  brief: z.string().max(120).optional(),
  /**
   * The run in numbers, for a chat to add up a task's: its time, tokens and model, and its cost
   * when the agent knows it (`plan`: a subscription covered it).
   */
  run: z
    .object({
      secs: z.number().nonnegative(),
      tokens: z.number().int().nonnegative().optional(),
      usd: z.number().nonnegative().optional(),
      plan: z.boolean().optional(),
      model: z.string().max(100).optional(),
    })
    .optional(),
  question: z.string().max(2_000).optional(),
  /** Short answers to the question, which a chat may show as buttons. */
  choices: z.array(z.string().min(1).max(60)).max(3).optional(),
  /**
   * A list waits on this reply for your `yes` (ADR 0049): its code (the first 8 characters of the
   * fingerprint of all it lists), which its Yes sends as `yes <code>`; or `github` for one longer
   * than LIST_MAX, approved only there.
   */
  list: z.union([z.string().regex(/^[0-9a-f]{8}$/), z.literal("github")]).optional(),
  to: z.array(z.string().max(120)).max(10).default([]),
  key: z.string().min(1).max(200),
});
export type ReplyLine = z.infer<typeof ReplyLine>;

/** A reply's list starts with this heading: the box writes it once, and a chat shows it last, whole. */
export const LIST_HEAD = "**To do after your `yes`**";
/** A list longer than this (its lines, a long page's text) is approved only on GitHub. */
export const LIST_MAX = 3_000;

/**
 * A reply's words split at its list: the words around it, and the list itself (its heading and its
 * lines, up to the first blank line), for a chat to show last and whole. No list: all words.
 */
export function splitList(md: string): { words: string; list?: string } {
  // The box's list is always the last (afterThink).
  const at = md.lastIndexOf(LIST_HEAD);
  if (at < 0) return { words: md };
  const end = md.indexOf("\n\n", at);
  const list = (end < 0 ? md.slice(at) : md.slice(at, end)).trim();
  const words = `${md.slice(0, at).trimEnd()}\n\n${end < 0 ? "" : md.slice(end).trim()}`.trim();
  return { words, list };
}

const FROM = /^<!-- shipify-from (\{[^\n]*\}) -->/;
const REPLY = /^<!-- shipify-reply (\{[^\n]*\}) -->/;

export const fromLine = (f: From) => `<!-- shipify-from ${canonicalJson(From.parse(f))} -->`;
export const replyLine = (r: ReplyLine) =>
  `<!-- shipify-reply ${canonicalJson(ReplyLine.parse(r))} -->`;

function read<T>(re: RegExp, schema: z.ZodType<T>, body: string | null | undefined): T | undefined {
  const m = re.exec(body ?? "");
  if (!m?.[1]) return undefined;
  try {
    const r = schema.safeParse(JSON.parse(m[1]));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** The `from` line of a body the door wrote, when it has a good one. */
export const readFrom = (body: string | null | undefined) => read(FROM, From, body);
/** The `reply` line of a body a run wrote, when it has a good one. */
export const readReply = (body: string | null | undefined) => read(REPLY, ReplyLine, body);

/** The body without its hidden first line: the words people read. */
export const withoutLine = (body: string | null | undefined) =>
  (body ?? "").replace(FROM, "").replace(REPLY, "").replace(/^\n+/, "");
