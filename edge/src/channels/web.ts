// The web chat (ADR 0036): an adapter on the same contract as Telegram's, for the page at
// /admin/chat. It differs in one place: its messages don't come from a platform's webhook but from
// the edge's own chat routes (edge/src/web/), which call the door directly with a proof made from
// the door App's key, so `POST /door/web` from outside gets the door's 401. Its replies are read in
// place, on the task, so `send` only tells your devices one came (ADR 0050: Web Push, push.ts),
// never with its words. It takes no files: the door keeps every run's files in the chat's store
// (R2, bound as BUCKET, store.ts) itself, whatever chat a reply is for (door-out.ts, ADR 0071).
// `file` hands a run what you sent from the page. No log line holds the words, a file's name or a
// key.
import { isGuestId } from "../../../cli/contracts/index.ts";
import type { Deps, Env, Kept } from "../env.ts";
import {
  bucketOf,
  devicesOf,
  FILE_REF,
  keepDevices,
  kvOf,
  logOf,
  OWN_PROOF_HEADER,
  obj,
  ownProof,
  same,
} from "../env.ts";
import { type Note, type Rung, ring, serviceOf } from "../push.ts";
import { open } from "../store.ts";
import type { Channel, FileKind, Message, Outgoing, Sent } from "./channel.ts";

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
  const under =
    typeof o.under === "number" && Number.isSafeInteger(o.under) && o.under > 0
      ? o.under
      : undefined;
  // A guest (ADR 0071): their id is the message's user and chat, or it's no message.
  const g = obj(o.guest);
  const guest =
    g && typeof g.id === "string" && isGuestId(g.id) && str(g.name, 40)?.trim()
      ? { id: g.id, name: String(g.name).trim() }
      : undefined;
  if (g && (!guest || guest.id !== user || guest.id !== chat)) return null;
  return {
    id,
    chat,
    user,
    words,
    forwarded: o.forwarded === true,
    ...(repliesTo ? { repliesTo } : {}),
    ...(album ? { album } : {}),
    // A new chat in a project (ADR 0069: **New chat here**).
    ...(under ? { under } : {}),
    // A button's word (ADR 0069): the web chat shows no message for it.
    ...(o.button === true ? { button: true as const } : {}),
    ...(guest ? { guest } : {}),
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

/** The most characters a notification's line under its title takes. */
const MOST_BODY = 120;
const short = (s: string) => (s.length > MOST_BODY ? `${s.slice(0, MOST_BODY - 1)}…` : s);

/**
 * What a notification says of a message (ADR 0050): its state and task, the task's title, and that
 * thread for a tap. An alert with no task says its first sentence, Shipify's own words. Never a
 * reply's words, a file's name or a list: a lock screen shows it.
 */
function noteOf(out: Outgoing, origin: string, chat = ""): Note {
  // A guest's device opens their own door (ADR 0071).
  const base = isGuestId(chat) ? "/guest" : "/admin/chat";
  const first = out.text
    .replace(/[*`]/g, "")
    .split(/(?<=[.!?])\s|\n/)[0]
    ?.trim();
  const body = out.task ? out.title?.trim() : first;
  return {
    web_push: 8030,
    notification: {
      title: out.task ? `${out.state} · #${out.task}` : out.state,
      ...(body ? { body: short(body) } : {}),
      navigate: `${origin}${base}/${out.task ? `#/t/${out.task}` : ""}`,
      tag: out.task ? `t${out.task}` : "alert",
      renotify: true,
      lang: "en",
    },
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

  /**
   * Read in place: the reply is on the task already, so this only tells your devices one came, all
   * at once, and drops a device its push service calls gone. With no key, store or device, nothing.
   * Always ok: a notification counts for nothing. One log line says how each device's push service
   * answered (a 403 refuses the signature, and the device is kept), and any trouble with the store.
   */
  async send(env: Env, deps: Deps, chat: string, out: Outgoing): Promise<Sent> {
    const key = env.WEB_PUSH_KEY;
    const kv = kvOf(env);
    const origin = env.SHIPIFY_DOOR_URL ? new URL(env.SHIPIFY_DOOR_URL).origin : "";
    if (!key || !kv || !origin) return { ok: true };
    const log = logOf(deps, "door.out");
    const why = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);
    let devices: Kept[];
    try {
      devices = await devicesOf(kv, "web", chat);
    } catch (e) {
      log.warn("door.out.failed", {
        why: "notification not sent: the store didn't read",
        kv: why(e),
      });
      return { ok: true };
    }
    if (!devices.length) return { ok: true };
    const note = noteOf(out, origin, chat);
    const rung = await Promise.all(devices.map((d) => ring(deps, key, origin, d, note)));
    // Only what came back gone is dropped, from the list as it is now: a device turned on while
    // these rang stays.
    const gone = new Set(devices.filter((_, i) => rung[i]?.rung === "gone").map((d) => d.endpoint));
    let store: string | undefined;
    if (gone.size)
      try {
        const now = await devicesOf(kv, "web", chat);
        if (now.some((d) => gone.has(d.endpoint)))
          await keepDevices(
            kv,
            "web",
            chat,
            now.filter((d) => !gone.has(d.endpoint)),
          );
      } catch (e) {
        store = why(e);
      }
    const count = (r: Rung["rung"]) => rung.filter((x) => x.rung === r).length;
    const said = {
      notified: count("ok"),
      gone: count("gone"),
      failed: count("failed"),
      statuses: devices.map((d, i) => `${serviceOf(d.endpoint)} ${rung[i]?.why}`),
      ...(store ? { kv: store } : {}),
    };
    if (said.failed || store)
      log.warn("door.out.failed", {
        why: store ? "a gone device wasn't dropped: the store refused" : "notification not taken",
        ...said,
      });
    else log.info("door.out.sent", said);
    return { ok: true };
  },

  /** A file you sent from the page, for the run: its bytes, streamed from the store. */
  async file(env: Env, _deps: Deps, ref: string) {
    const bucket = FILE_REF.test(ref) ? bucketOf(env) : undefined;
    const f = bucket ? await open(bucket, ref) : null;
    if (!f)
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    return new Response(f.body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(f.meta.size),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
