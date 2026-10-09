// The web chat (ADR 0036): an adapter on the same contract as Telegram's, for the page at
// /admin/chat. It differs in one place: its messages don't come from a platform's webhook but from
// the edge's own chat routes (edge/src/web/), which call the door directly with a proof made from
// the door App's key, so `POST /door/web` from outside gets the door's 401. Its replies are read in
// place, on the task, so `send` has nothing to push; `sendFiles` keeps a run's files in the chat's
// store (Workers KV, bound as FILES) for 7 days, where the page shows them. `file` hands a run what
// you sent from the page. No log line holds the words, a file's name or a key.
import type { Deps, Env } from "../env.ts";
import { FILE_REF, KEEP_S, kvOf, OWN_PROOF_HEADER, obj, ownProof, same } from "../env.ts";
import { type Channel, type FileKind, MAX_FILE_BYTES, type Message, type Sent } from "./channel.ts";

const kindOf = (type: string): FileKind =>
  type.startsWith("image/")
    ? "a photo"
    : type.startsWith("video/")
      ? "a video"
      : type.startsWith("audio/")
        ? "an audio file"
        : "a file";

const str = (v: unknown, most: number) =>
  typeof v === "string" && v.length <= most ? v : undefined;

/** The Message the chat's routes hand the door, checked: anything off is not a message. */
function parse(body: string): Message | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const o = obj(raw);
  const id = str(o?.id, 120);
  const chat = str(o?.chat, 31);
  const user = str(o?.user, 31);
  const words = str(o?.words, 16_000);
  if (!o || !id || !chat || !user || words === undefined || !web.chatId.test(chat)) return null;
  const f = obj(o.file);
  const ref = str(f?.ref, 80);
  const name = str(f?.name, 200);
  const type = str(f?.type, 120) ?? "application/octet-stream";
  const size = typeof f?.size === "number" && f.size >= 0 ? f.size : undefined;
  if (f && (!ref || !FILE_REF.test(ref) || !name)) return null;
  const repliesTo = typeof o.repliesTo === "number" && o.repliesTo > 0 ? o.repliesTo : undefined;
  const album = str(o.album, 120);
  return {
    id,
    chat,
    user,
    words,
    forwarded: o.forwarded === true,
    ...(repliesTo ? { repliesTo } : {}),
    ...(album ? { album } : {}),
    ...(f && ref && name
      ? {
          file: {
            name,
            ref,
            kind: kindOf(type),
            type,
            ...(size !== undefined ? { size } : {}),
          },
        }
      : {}),
  };
}

export const web: Channel = {
  id: "web",
  name: "the web chat",
  needs: ["SHIPIFY_DOOR_APP_KEY"],
  chatId: /^[a-z][a-z0-9-]{0,30}$/,
  limits: { text: 16_000 },
  inPlace: true,

  async verify(req: Request, env: Env) {
    return same(req.headers.get(OWN_PROOF_HEADER) ?? "", await ownProof(env, "web"));
  },

  parse,

  /**
   * The door's words, straight back to the chat's route, which shows them in the page; trouble as
   * the failure it is, so the page keeps your message to send again.
   */
  answer(_m: Message, text: string, trouble) {
    return new Response(JSON.stringify({ text, ...(trouble ? { trouble } : {}) }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  },

  /** Read in place: the reply is on the task already, so there's nothing to push. */
  send: async (): Promise<Sent> => ({ ok: true }),

  /** A run's files, kept for the page: how many the store didn't take. */
  async sendFiles(env: Env, deps: Deps, _chat: string, task: number, files: File[]) {
    const kv = kvOf(env);
    const keep = async (f: File) => {
      if (!kv || f.size > MAX_FILE_BYTES) return false;
      try {
        await kv.put(
          `run-${task}-${crypto.randomUUID().replace(/-/g, "")}`,
          await f.arrayBuffer(),
          {
            expirationTtl: KEEP_S,
            metadata: {
              name: f.name.slice(0, 200),
              type: f.type || "application/octet-stream",
              size: f.size,
              by: "run",
              at: deps.now(),
              task,
            },
          },
        );
        return true;
      } catch {
        return false;
      }
    };
    let unsent = 0;
    for (const f of files) if (!(await keep(f))) unsent++;
    return unsent;
  },

  /** A file you sent from the page, for the run: its bytes, from the store. */
  async file(env: Env, _deps: Deps, ref: string) {
    const kv = kvOf(env);
    const notFound = () =>
      new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    if (!kv || !FILE_REF.test(ref)) return notFound();
    const { value, metadata } = await kv.getWithMetadata<{ type?: string; size?: number }>(
      ref,
      "stream",
    );
    if (!value) return notFound();
    return new Response(value, {
      headers: {
        "content-type": "application/octet-stream",
        ...(typeof metadata?.size === "number" ? { "content-length": String(metadata.size) } : {}),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
