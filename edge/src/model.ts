// Your model (ADR 0042, amended): the pick a chat's new tasks start with, as a chat app's model menu
// works. One small record per chat in the edge's store (FILES, the web chat's), set by `/use` with
// no task, read once per new task. A task keeps its own: a `use` on it, or a `use` line in your
// words, wins. Nothing else about you is stored.
import { type Kv, kvOf } from "./env.ts";
import type { Env } from "./env.ts";

/** What your model is now: its `use` words (none: Auto), or why it can't be said. */
export type Yours = { words?: string } | { unread: true } | { noStore: true };

const keyOf = (channel: string, chat: string) => `model:${channel}:${chat}`;
/** The most a record holds: a pick's words are three at most, a model id among them. */
const MOST = 200;

async function read(kv: Kv, key: string): Promise<string | undefined> {
  const s = await kv.get(key, "stream");
  if (!s) return undefined;
  const text = (await new Response(s).text()).trim();
  return text && text.length <= MOST ? text : undefined;
}

/** Your model on this chat. A store that won't answer is said, never taken as Auto. */
export async function yourModel(env: Env, channel: string, chat: string): Promise<Yours> {
  const kv = kvOf(env);
  if (!kv) return { noStore: true };
  try {
    const words = await read(kv, keyOf(channel, chat));
    return words ? { words } : {};
  } catch {
    return { unread: true };
  }
}

/** Keeps `words` (a pick's, as `use` takes them) as your model: whether it was kept. */
export async function keepModel(
  env: Env,
  channel: string,
  chat: string,
  words: string,
): Promise<boolean> {
  const kv = kvOf(env);
  if (!kv) return false;
  try {
    await kv.put(keyOf(channel, chat), words.slice(0, MOST));
    return true;
  } catch {
    return false;
  }
}
