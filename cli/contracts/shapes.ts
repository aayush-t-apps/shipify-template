// The shapes every boundary speaks (ADR 0031, "Nothing silent"): what you send, what comes back,
// a tool call, and a problem. Checked with zod wherever data crosses; anything that doesn't match
// becomes a Problem, never a crash or a silence. Pure: the edge imports this file too.
import { z } from "zod";
import { REPLY_KINDS } from "./labels.ts";

export const CONTRACT_VERSION = 1;

/** A file, by reference: a chat's own file id, or a URL on GitHub. Never the bytes. */
export const FileRef = z.object({
  name: z.string().min(1).max(200),
  /** Its media type, when known: "image/jpeg", "application/pdf". */
  type: z.string().max(100).optional(),
  size: z.number().int().nonnegative().optional(),
  /** Where to fetch it: `telegram:<file_id>`, or an https URL. */
  ref: z.string().min(1).max(500),
});
export type FileRef = z.infer<typeof FileRef>;

/** Limits on what you send: more is named, and left out. */
export const MAX_FILES_IN = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Files a run makes for you, at most. */
export const MAX_FILES_OUT = 10;

/** What you send, from any channel, read into one shape so decide never knows which. */
export const Incoming = z.object({
  v: z.literal(CONTRACT_VERSION),
  /** The person, by their name in SHIPIFY_PEOPLE ("owner" for you). */
  person: z.string().min(1).max(40),
  channel: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** The chat it came from on that channel, for the replies to go back to. */
  chat: z.string().max(80).optional(),
  /** The task it continues, or null for a new one. */
  task: z.number().int().positive().nullable(),
  text: z.string().max(16_000),
  files: z.array(FileRef).max(MAX_FILES_IN).default([]),
  at: z.string(),
  /** The channel's own id for it (Telegram's update_id): written once. */
  id: z.string().max(120),
});
export type Incoming = z.infer<typeof Incoming>;

/** A link to open, as [label, url]. */
export const Link = z.tuple([z.string().min(1).max(80), z.string().url()]);
export type Link = z.infer<typeof Link>;

/** What comes back: one reply, rendered by each channel as well as it can. */
export const Reply = z.object({
  v: z.literal(CONTRACT_VERSION),
  kind: z.enum(REPLY_KINDS),
  task: z.number().int().positive(),
  title: z.string().max(256),
  /** Its state in a word or two: "Done", "Needs you", "Failed", "Live". */
  state: z.string().max(40),
  /** Markdown, with anything like a key already masked. */
  text: z.string(),
  question: z.string().optional(),
  links: z.array(Link).default([]),
  /** Files the run made, as links on GitHub. */
  files: z
    .array(z.object({ name: z.string(), type: z.string().optional(), url: z.string().url() }))
    .max(MAX_FILES_OUT)
    .default([]),
  /** The run's details in one line, for a chat: "Sonnet · 48 s · 3 tool calls". */
  brief: z.string().max(120).optional(),
  /** Where the door copies it: `<channel>:<chat>`, only ids in SHIPIFY_PEOPLE. */
  to: z.array(z.string().max(120)).default([]),
  /** The reply's key: written once, sent once. */
  key: z.string().min(1).max(200),
});
export type Reply = z.infer<typeof Reply>;

/** A tool call the agent proposes, the same for every tool. */
export const ToolCall = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCall>;

/** What a tool answered: shown as a ✓ or ✗ line, with the tool's own words. */
export const ToolResult = z.object({
  ok: z.boolean(),
  text: z.string().max(2_000),
  link: z.string().url().optional(),
});
export type ToolResult = z.infer<typeof ToolResult>;
