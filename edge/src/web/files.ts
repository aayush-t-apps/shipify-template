// The web chat's files (ADR 0036, "Files"): Workers KV, bound as FILES, each file kept 7 days with
// its own metadata (name, type, size, task, who made it, when). Yours come from the page
// (`up-<id>`); a run's, from its reply to a chat you wrote from (`run-<task>-<id>`), for the Files
// page, which lists them when it opens. Only pictures are ever shown inline; anything else
// downloads.
// Plain web code: KV is reached through the small shape in env.ts, so tests stand in for it.

import { FILE_REF, KEEP_S, type Kv } from "../env.ts";
import { json } from "../env.ts";

/** What each file says about itself. */
export interface FileMeta {
  name: string;
  type: string;
  size: number;
  by: "you" | "run";
  /** When it was made (ms). */
  at: number;
  task?: number;
}

export const MOST_FILES = 5;
export const MOST_BYTES = 10 * 1024 * 1024;
/** The only types shown inline; everything else downloads. */
export const PICTURE = /^image\/(?:png|jpeg|gif|webp)$/;

export const newId = () => crypto.randomUUID().replace(/-/g, "");

/** A file's name, made safe for a header and a download. */
export const safeName = (name: string) =>
  [...name]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '\\/"'.includes(c) ? "_" : c))
    .join("")
    .trim()
    .slice(0, 200) || "file";

/** A type, as one plain MIME word; anything odd is a plain download. */
export const safeType = (type: string) =>
  /^[a-z]+\/[a-z0-9.+-]{1,80}$/i.test(type.trim())
    ? type.trim().toLowerCase()
    : "application/octet-stream";

/** Keeps one file; the caller has checked its size. */
export async function keep(kv: Kv, key: string, body: ArrayBuffer, meta: FileMeta) {
  await kv.put(key, body, { expirationTtl: KEEP_S, metadata: meta });
}

/** Whether the store has this file. */
export async function has(kv: Kv, ref: string) {
  if (!FILE_REF.test(ref)) return false;
  const v = await kv.get(ref, "stream");
  await v?.cancel().catch(() => {});
  return Boolean(v);
}

/** A kept file, served safely: pictures inline, everything else as a download, never sniffed. */
export async function serve(kv: Kv, ref: string, download = false): Promise<Response> {
  if (!FILE_REF.test(ref)) return json({ error: "not_found" }, 404);
  const { value, metadata } = await kv.getWithMetadata<FileMeta>(ref, "stream");
  if (!value || !metadata)
    return json(
      { error: "That file is gone (files are kept 7 days).", fix: "Send it again." },
      410,
    );
  const type = safeType(metadata.type);
  const inline = PICTURE.test(type) && !download;
  return new Response(value, {
    headers: {
      "content-type": inline ? type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName(metadata.name))}`,
      "content-length": String(metadata.size),
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

/** The files kept, newest first, from their metadata: one listing. */
export async function listed(kv: Kv, most = 200) {
  const out: { ref: string; meta: FileMeta; until?: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list<FileMeta>({ limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const k of page.keys)
      if (k.metadata && FILE_REF.test(k.name))
        out.push({
          ref: k.name,
          meta: k.metadata,
          ...(k.expiration ? { until: k.expiration * 1000 } : {}),
        });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < most);
  return out.sort((a, b) => b.meta.at - a.meta.at).slice(0, most);
}
