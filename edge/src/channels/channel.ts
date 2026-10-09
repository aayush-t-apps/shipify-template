// The chat channel's contract (ADR 0032, "Chat adapters"): what one adapter file gives the door, so
// the door, its way out and the watch name no channel. An adapter knows its platform: proving a
// webhook, reading an update, rendering and sending, fetching a file, its own health. The core
// knows Shipify: who you are, commands, tasks, dedupe and alerts. Every adapter in
// channels/index.ts passes tests/edge/channels.test.ts. Plain web code: no Workers types.
// Buttons are words (ADR 0042 §2): a button sends exactly words you could type, and a tap arrives
// as those words, replying to the message the button sat on, through the same door.
import type { Button, Problem } from "../../../cli/contracts/index.ts";
import type { Deps, Env } from "../env.ts";

export type { Button };

/** What a file is, for the run that reads it: words and pictures are read, sound and video not. */
export type FileKind = "a photo" | "a file" | "a video" | "an audio file" | "a voice note";

/** A file someone sent: a reference the adapter fetches later (never the bytes). */
export interface InFile {
  name: string;
  /** The channel's own id for it; the door writes `<channel>:<ref>` in the task's from-line. */
  ref: string;
  kind: FileKind;
  type?: string;
  size?: number;
}

/** What a channel hands the door: one message, in one shape for every channel. */
export interface Message {
  /** The channel's id for this event: the door writes each one once. */
  id: string;
  /** The channel's id for the message itself, when it differs: an answer replies to it. */
  messageId?: string;
  /** Where an answer goes. */
  chat: string;
  /** Who sent it: their stable id, matched against SHIPIFY_PEOPLE's `on.<channel>`. */
  user: string;
  /** What they typed, or a file's caption. */
  words: string;
  /** Someone else's words, passed on: never read as a command or a task's number. */
  forwarded: boolean;
  /** The task named by the message of Shipify's that this one replies to (readHead). */
  repliesTo?: number;
  /**
   * A tap on one of Shipify's buttons: the channel's id for it, which the door acknowledges
   * (`tapped`). Its words are the button's, and it replies to the message the button sat on.
   */
  tap?: string;
  /** Files sent together share it, and land on one task. */
  album?: string;
  file?: InFile;
}

/** What a message shows beside its words: its task's link, buttons that send words, the reply box. */
export interface Shown {
  task?: number;
  /** The task on GitHub: its number in the message's head links there. */
  taskUrl?: string;
  /** A list of tasks (/tasks): each line's leading `#n` links to this, then n. */
  tasksAt?: string;
  /** Buttons, a row each: a tap sends a button's words, as a reply to this message. */
  buttons?: Button[][];
  /**
   * Open the reply box on it, where the channel has one, with this short placeholder ("Reply to
   * #240…"): for a question, or a task you asked to go to. A message with buttons needs none.
   */
  asks?: string;
}

/** A reply or an alert going out: the same for every channel, each rendering it its own way. */
export interface Outgoing extends Shown {
  /** "Done", "Needs you", "Alert". */
  state: string;
  title?: string;
  /** Markdown: bold, code, code blocks, https links, bullets. */
  text: string;
  /** The run's one line. */
  brief?: string;
  /** [label, url], GitHub's first. */
  links: [string, string][];
}

/** What the door says back to a tap, beside any answer. */
export interface Tapped {
  /** A short line the chat shows a moment: "#240: from your next message, Sonnet". */
  toast?: string;
  /** The tapped message drawn again with its new state (the picker after a pick). */
  redraw?: { text: string } & Shown;
  /** Its buttons are spent (their words were written): taken off, its links kept. */
  spent?: true;
}

/** What one send came to. An adapter never throws for an answer: it says. Nothing is sent twice. */
export type Sent =
  | { ok: true }
  /** The channel said wait this many seconds: busy, so not confirmed. */
  | { ok: false; wait: number }
  /** The chat can't be reached (blocked, gone): its words, for the alert. */
  | { ok: false; refused: string }
  /** The chat refused the message as it was made: the core's bug, in the channel's own words. */
  | { ok: false; rendering: string }
  /** No answer, or not in time: not confirmed (it may have arrived). */
  | { ok: false; transient: true };

/** A channel's own health, for the watch: failing, and why. */
export interface Health {
  failing: boolean;
  error?: string;
}

export interface Channel {
  /** Its word everywhere: from-lines, a reply's `to`, `/door/<id>`, SHIPIFY_PEOPLE's `on.<id>`. */
  id: string;
  /** For people: "Telegram". */
  name: string;
  /** Its secrets in the Worker: while any is missing, its route answers 503. */
  needs: string[];
  /** A chat it sends to: a person's own chat, never a group's or a channel's name. */
  chatId: RegExp;
  /**
   * The most words one message carries, and the most bytes (UTF-8) a button's words take: a button
   * past it isn't shown, and its words stay in the message to type.
   */
  limits: { text: number; button?: number };
  /**
   * It reads replies in place, on the task (the web chat): nothing is pushed, so its send says
   * nothing about whether you have a reply, and never counts toward the 🚀.
   */
  inPlace?: true;
  /** Whether the webhook really came from it (an out-only channel has none). */
  verify?(req: Request, env: Env): boolean | Promise<boolean>;
  /** The message in a webhook's body; null when it isn't one (acknowledged and ignored). */
  parse?(body: string): Message | null;
  /**
   * An answer at once, as the webhook's own response: a 200, so the platform never sends it again.
   * Every channel that takes messages has one. `trouble` when nothing was saved (GitHub down, the
   * door closed): the words say it all, and a channel that shows a failure its own way can (the web
   * chat keeps your message to send again). `shown`: its task's link, buttons and the reply box,
   * where the channel has them; its words stand alone without them.
   */
  answer?(m: Message, text: string, trouble?: Problem, shown?: Shown): Response;
  /**
   * A tap, acknowledged: its toast, and the tapped message drawn again or its spent buttons taken
   * off. Every tap gets one. Whether the chat took it; it never throws, and nothing is tried again.
   */
  tapped?(env: Env, deps: Deps, m: Message, ack: Tapped): Promise<boolean>;
  /** Renders and sends one reply's words to one chat. */
  send(env: Env, deps: Deps, chat: string, out: Outgoing): Promise<Sent>;
  /**
   * A reply's files, after its words: each once, as the chat shows its type, never a second way.
   * How many didn't go (a busy chat leaves the rest, counted). Without it, the channel takes none.
   */
  sendFiles?(env: Env, deps: Deps, chat: string, task: number, files: File[]): Promise<number>;
  /** A file a person sent, by its ref: its bytes, or a JSON error with its status. */
  file?(env: Env, deps: Deps, ref: string): Promise<Response>;
  /** Its own health (a webhook pointed elsewhere, a key refused), or null when it can't say. */
  health?(env: Env, deps: Deps): Promise<Health | null>;
  /**
   * What the chat shows of Shipify (a command menu, a description), kept in step with intents.json
   * (chatMenu): read, and set again only what differs. The watch calls it with its health check.
   */
  menu?(env: Env, deps: Deps): Promise<void>;
  /**
   * A status kept on top of the chat (`/ping pin`), with no sound and no new message: `start` sends
   * and pins it; else it's changed in place, only while the chat's pinned message is still that
   * status (its last line, PIN_MARK) and its words differ. Unpinning it stops it. True: the chat
   * shows these words on top now; false: no status of Shipify's is pinned there; undefined: the
   * chat didn't say (down, busy). It never throws.
   */
  pin?(
    env: Env,
    deps: Deps,
    chat: string,
    text: string,
    shown: Shown,
    start?: boolean,
  ): Promise<boolean | undefined>;
  /** Linking a person (`/start <code>` from `ship add <channel>`): the secret that keys the codes. */
  linkSecret?(env: Env): string | undefined;
}

// ---------------------------------------------------------------- shared by adapters

/** The task in the head of one of Shipify's messages: "Done · #12 · …", "Got it · #12", "#12 uses Opus". */
const HEAD_TASK = /(?:^|· )#(\d{1,9})(?=[\s·]|$)/;
/**
 * What the head (first line) of one of Shipify's messages names: its task. A reply to it, or a tap
 * on its buttons, carries that task on.
 */
export function readHead(head: string): { task?: number } {
  const n = Number(HEAD_TASK.exec(head)?.[1]);
  return n > 0 ? { task: n } : {};
}

/** A file a run reads at most, either way. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A stream that fails past max bytes, for a file whose size its channel didn't say. */
export function capped(body: ReadableStream<Uint8Array>, max: number) {
  let n = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        n += chunk.byteLength;
        if (n > max) out.error(new Error("over the size limit"));
        else out.enqueue(chunk);
      },
    }),
  );
}

/** An https address: the only kind a chat's button opens. */
export function webUrl(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}
