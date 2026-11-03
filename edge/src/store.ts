// The web chat's files in R2 (ADR 0069, section 16): one bucket, bound as BUCKET, each file under
// its ref with its own metadata (its name, type, size, who made it, when, and its chat's number once
// known). A file lives as long as its chat: the weekly clean-up deletes a closed chat's files through
// the door's forget route (files.ts). R2 can't change an object's metadata alone, so a file that
// gets its chat later is written again under the same key, and one a second chat uses is copied for
// it. Plain web code: R2 is reached through the small shape in env.ts, so tests stand in for it.
import type { Bucket, Deps, Env, Kv } from "./env.ts";
import { bucketOf, FILE_REF, kvOf, logOf } from "./env.ts";

/** What each file says about itself. */
export interface FileMeta {
  name: string;
  type: string;
  size: number;
  by: "you" | "run";
  /** When it was made (ms). */
  at: number;
  /** Its chat's number, once known. */
  task?: number;
}

/** A new file's ref: its time counted down, so R2's list (by key) gives the newest first. */
export const newRef = (now: number) =>
  `f-${String(Math.max(0, 1e13 - Math.floor(now))).padStart(13, "0")}-${crypto.randomUUID().replace(/-/g, "")}`;

/** As R2 keeps metadata: strings. */
const metaOut = (m: FileMeta): Record<string, string> => ({
  name: m.name,
  type: m.type,
  size: String(m.size),
  by: m.by,
  at: String(m.at),
  ...(m.task ? { task: String(m.task) } : {}),
});

/** A file's metadata read back, its size R2's own; undefined for anything that isn't a file. */
function metaOf(o: { size: number; customMetadata?: Record<string, string> }) {
  const c = o.customMetadata;
  if (!c?.name) return undefined;
  const task = Number(c.task);
  const meta: FileMeta = {
    name: c.name,
    type: c.type || "application/octet-stream",
    size: o.size,
    by: c.by === "run" ? "run" : "you",
    at: Number(c.at) || 0,
    ...(Number.isSafeInteger(task) && task > 0 ? { task } : {}),
  };
  return meta;
}

/** A stream R2 takes: of a known length (Workers' FixedLengthStream; as it is elsewhere). */
function sized(body: ReadableStream, size: number) {
  const Fixed = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream })
    .FixedLengthStream;
  return Fixed ? body.pipeThrough(new Fixed(size)) : body;
}

/** Keeps one file under its ref, streamed when it's a stream; the caller has checked its size. */
export async function put(
  bucket: Bucket,
  ref: string,
  body: ReadableStream | Blob | ArrayBuffer,
  meta: FileMeta,
) {
  const value = body instanceof ReadableStream ? sized(body, meta.size) : body;
  await bucket.put(ref, value, { customMetadata: metaOut(meta) });
}

/** A kept file's metadata, with no body: undefined when it's gone, or no ref of the store's. */
export async function head(bucket: Bucket, ref: string) {
  if (!FILE_REF.test(ref)) return undefined;
  const o = await bucket.head(ref);
  return o ? metaOf(o) : undefined;
}

/** A kept file as a stream, with its metadata; null when it's gone. */
export async function open(bucket: Bucket, ref: string) {
  if (!FILE_REF.test(ref)) return null;
  const o = await bucket.get(ref);
  const meta = o && metaOf(o);
  if (!o || !meta) {
    await o?.body.cancel().catch(() => {});
    return null;
  }
  return { body: o.body, meta };
}

/** Each file in the bucket, its key and metadata: one list call per 1,000. */
async function each(bucket: Bucket, f: (ref: string, meta: FileMeta) => void) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      limit: 1000,
      include: ["customMetadata"],
      ...(cursor ? { cursor } : {}),
    });
    for (const o of page.objects) {
      const meta = FILE_REF.test(o.key) ? metaOf(o) : undefined;
      if (meta) f(o.key, meta);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/**
 * The files kept, newest first (the most shown), with the count and bytes of all: R2 has no call
 * for a bucket's total, so it's counted as it lists.
 */
export async function listed(bucket: Bucket, most = 500) {
  const files: { ref: string; meta: FileMeta }[] = [];
  let bytes = 0;
  await each(bucket, (ref, meta) => {
    files.push({ ref, meta });
    bytes += meta.size;
  });
  files.sort((a, b) => b.meta.at - a.meta.at);
  return { files: files.slice(0, most), count: files.length, bytes };
}

/**
 * A file with no chat gets this one: written again under its key with the number (a streamed get
 * and put). Whether it's this chat's now; a file of another chat's is left as it is.
 */
export async function stamp(bucket: Bucket, ref: string, task: number) {
  const f = await open(bucket, ref);
  if (!f) return false;
  if (f.meta.task) {
    await f.body.cancel().catch(() => {});
    return f.meta.task === task;
  }
  await put(bucket, ref, f.body, { ...f.meta, task });
  return true;
}

/** A copy of a file for another chat (or none yet), under a new ref: that ref, or undefined. */
export async function copyFor(bucket: Bucket, ref: string, now: number, task?: number) {
  const f = await open(bucket, ref);
  if (!f) return undefined;
  const to = newRef(now);
  const { task: _was, ...meta } = f.meta;
  await put(bucket, to, f.body, { ...meta, at: now, ...(task ? { task } : {}) });
  return to;
}

/** Deletes these files: 1,000 keys a call. */
export async function remove(bucket: Bucket, refs: string[]) {
  for (let i = 0; i < refs.length; i += 1000) await bucket.delete(refs.slice(i, i + 1000));
}

/**
 * The weekly clean-up's step (ADR 0069, section 15): every file of these chats deleted, from one
 * listing. A file with no chat is kept. How many went, and their bytes.
 */
export async function forget(bucket: Bucket, chats: number[]) {
  const doomed = new Set(chats);
  const refs: string[] = [];
  let bytes = 0;
  await each(bucket, (ref, meta) => {
    if (meta.task && doomed.has(meta.task)) {
      refs.push(ref);
      bytes += meta.size;
    }
  });
  await remove(bucket, refs);
  return { deleted: refs.length, bytes };
}

// ---------------------------------------------------------------- the switch from KV, once
// KV kept a file 7 days, so a week after this deploys there's nothing left to copy: then this part
// goes (MOVED, COPY_STEP, moveFromKv, copyStep) with its line in index.ts.

/** The copy's mark in the bucket: the last file copied (`after`), or none once all are. */
export const MOVED = "_moved-from-kv";
/**
 * What one step copies at most: its files (three calls each, well inside an invocation's 1,000 to
 * Cloudflare's stores), and its bytes, past which it stops (KV took 10 MB a file).
 */
export const COPY_STEP = { files: 200, bytes: 25_000_000 };

/**
 * The files still in Workers KV, copied to R2 under their old keys (ADR 0069: the switch in one
 * go), so a ref in an old message opens once it's copied. A run's carries its chat in its key; yours
 * has none, so the clean-up keeps it. One step a cron tick (index.ts, after the watch's), never in a
 * request: a request that waited for a step (each file a read of KV and two writes) took longer
 * than the page's 20 s, and one cut off left its step unfinished for the requests after it. Each
 * file is marked in the bucket as it's copied, so the next tick carries on from the mark, never
 * from the start. Once all are copied the mark says so: one look at it is all a tick costs.
 */
export async function moveFromKv(env: Env, deps: Deps) {
  const kv = kvOf(env);
  const bucket = bucketOf(env);
  if (!kv || !bucket) return;
  await copyStep(kv, bucket).catch((e) =>
    logOf(deps, "store").warn("watch.guard", {
      why: "KV's files not copied to R2 this tick",
      message: String((e as Error)?.message ?? e).slice(0, 200),
    }),
  );
}

/** One step of the copy, from its mark on: COPY_STEP at most. Whether it's done. */
async function copyStep(kv: Kv, bucket: Bucket): Promise<boolean> {
  const mark = await bucket.head(MOVED);
  const after = mark?.customMetadata?.after;
  if (mark && !after) return true;
  let files = 0;
  let size = 0;
  let cursor: string | undefined;
  do {
    const page = await kv.list<FileMeta>({ limit: 1000, ...(cursor ? { cursor } : {}) });
    // KV lists by key, so the files up to the mark are the ones copied.
    for (const k of page.keys) {
      if ((after && k.name <= after) || !k.metadata?.name || !FILE_REF.test(k.name)) continue;
      if (files === COPY_STEP.files || size >= COPY_STEP.bytes) return false;
      const v = await kv.get(k.name, "stream");
      if (v) {
        const bytes = await new Response(v).arrayBuffer();
        const task = k.metadata.task || Number(/^run-(\d+)-/.exec(k.name)?.[1]) || undefined;
        await put(bucket, k.name, bytes, {
          ...k.metadata,
          size: bytes.byteLength,
          ...(task ? { task } : {}),
        });
        size += bytes.byteLength;
      }
      await bucket.put(MOVED, "", { customMetadata: { after: k.name } });
      files++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await bucket.put(MOVED, "");
  return true;
}
