// What each chat channel's adapter brings to the conformance suite (tests/edge/channels.test.ts):
// its secrets, webhooks as the platform sends them, and a stand-in for the platform's API that can
// be made to answer ok, busy, refused or down. One file per adapter, named in index.ts.
import type { Message } from "../../../edge/src/channels/channel.ts";
import type { Deps, Env } from "../../../edge/src/env.ts";

/** ok, busy (wait), the chat can't be reached (refused), our message refused (wrong), no answer. */
export type Mode = "ok" | "wait" | "refused" | "wrong" | "down";

/** The platform's API, faked: what it was sent, and how it answers. */
export interface Platform {
  deps: Deps;
  /** How the next calls are answered. */
  mode(m: Mode): void;
  /** The words of every message sent, as the person sees them (no markup). */
  texts(): string[];
  /** Files sent after the words, by name. */
  files(): string[];
  /** Its own health, as the adapter will read it. */
  healthy(ok: boolean): void;
  /** The calls that set what it shows of Shipify (its menu), for an adapter with `menu`. */
  sets?(): string[];
  /** The words of the word buttons on the last message sent, for an adapter that shows them. */
  buttons?(): string[];
  /**
   * A chat read in place that tells you a reply came (ADR 0050): a device it keeps from now, and
   * what each push to it said, read as the device reads it. `refused` mode: the device is gone.
   */
  device?(): Promise<() => Promise<string[]>>;
}

export interface ChannelFixture {
  /** Its secrets, set. */
  env: Partial<Env>;
  /** A webhook call carrying the platform's proof, with this body. */
  proven(body: string): Request;
  /** The same call without its proof, and with a wrong one. */
  unproven(body: string): Request[];
  /** Webhook bodies, each with what the Message must say. */
  messages: {
    text: { body: string; want: Pick<Message, "id" | "chat" | "user" | "words"> };
    file: { body: string; want: { ref: string; kind: string } };
    reply: { body: string; task: number };
    forwarded: { body: string };
    /** A tap on one of Shipify's buttons (a channel that has them): its words, on task #`task`'s message. */
    tap?: { body: string; words: string; task: number };
    /** What isn't a message for the door: each gives null. */
    ignored: string[];
  };
  /** A chat the platform takes, and a file reference it knows (with its bytes). */
  chat: string;
  file?: { ref: string; bytes: string };
  platform(): Platform;
}
