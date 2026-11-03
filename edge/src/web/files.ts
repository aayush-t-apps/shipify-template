// The web chat's files (ADR 0036, "Files"; ADR 0069, section 16): in R2, bound as BUCKET, each with
// its own metadata (name, type, size, its chat, who made it, when), kept as long as its chat
// (store.ts). Yours come from the page, streamed in (`f-…`); a run's, from its reply to a chat you
// wrote from, for the Files page, which lists them when it opens. Only pictures are shown inline,
// and a PDF in the doc pane; anything else downloads.

import type { Bucket } from "../env.ts";
import { FILE_REF, json } from "../env.ts";
import { type FileMeta, open } from "../store.ts";

export type { FileMeta };

export const MOST_FILES = 5;
/**
 * One file at most, its request's whole body: 95 MB, as the page counts them (1 MB is 1,000,000
 * bytes). Cloudflare refuses a request over 100 MB (free plan) before the Worker runs, with its own
 * error, not ours: this leaves room.
 */
export const MOST_BYTES = 95_000_000;
/** The only types shown inline; everything else downloads. */
export const PICTURE = /^image\/(?:png|jpeg|gif|webp)$/;

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

/** What the page is told of a file that isn't there. */
export const GONE = { error: "That file is gone.", fix: "Send it again." };

/** A PDF, by its type or its name: the doc pane shows it in the browser's own viewer. */
const isPdf = (m: FileMeta) => safeType(m.type) === "application/pdf" || /\.pdf$/i.test(m.name);

/**
 * A kept file, streamed out safely: pictures inline, everything else as a download, never sniffed.
 * With `view`, a PDF shows inline for the doc pane (ADR 0065): as a PDF only (nosniff), framed only
 * by the chat. It has no sandbox, which browsers' PDF viewers refuse to run in; a PDF's own scripts
 * run in the viewer, never on the edge's page.
 */
export async function serve(bucket: Bucket, ref: string, download = false, view = false) {
  if (!FILE_REF.test(ref)) return json({ error: "not_found" }, 404);
  const f = await open(bucket, ref);
  if (!f) return json(GONE, 410);
  const { meta } = f;
  const type = safeType(meta.type);
  const pdf = view && !download && isPdf(meta);
  const inline = (PICTURE.test(type) && !download) || pdf;
  return new Response(f.body, {
    headers: {
      "content-type": pdf ? "application/pdf" : inline ? type : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeName(meta.name))}`,
      "content-length": String(meta.size),
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": pdf ? "frame-ancestors 'self'" : "default-src 'none'; sandbox",
    },
  });
}
