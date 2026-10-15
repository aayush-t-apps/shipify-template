// The registry (ADR 0032): every chat channel the edge has, one line each. The door, its way out and
// the watch find adapters only here. Adding one: its file beside this, its line here, and its
// fixtures passing tests/edge/channels.test.ts.
import type { Channel } from "./channel.ts";
import { telegram } from "./telegram.ts";
import { web } from "./web.ts";

export const CHANNELS: Record<string, Channel> = { telegram, web };

/** A channel by its id, when the edge has it. */
export const channelOf = (id: string): Channel | undefined =>
  Object.hasOwn(CHANNELS, id) ? CHANNELS[id] : undefined;
