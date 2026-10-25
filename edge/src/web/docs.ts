// The doc pane (ADR 0065): a file the chat keeps, made readable beside the thread. Markdown is
// rendered by GitHub (`POST /markdown`, as the door App: it needs no permission) and cleaned as
// every message is (clean.ts); a CSV comes as rows, other text as text. A PDF or a picture shows
// from the file itself (files.ts `serve`), anything else as its name and a Download. A file never
// changes, so its rendering is kept a day in this Worker: one call to GitHub a file, at most.
import { cached } from "../cache.ts";
import type { Deps, Env, Kv } from "../env.ts";
import { FILE_REF } from "../env.ts";
import { GitHubError, installationToken } from "../github.ts";
import { clean } from "./clean.ts";
import { type FileMeta, PICTURE, safeType } from "./files.ts";
import type { Doc } from "./shapes.ts";

/** The most of a file read to show it: past it, the pane says it's cut and offers the rest. */
export const MOST_SHOWN = 200_000;
/** The most rows of a CSV shown, and columns a row. */
export const MOST_ROWS = 500;
const MOST_COLS = 40;
const DAY_MS = 86_400_000;

export const DOC_KINDS = ["md", "csv", "text", "pdf", "picture", "file"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const TEXT =
  /\.(?:txt|log|json|jsonl|ya?ml|toml|ini|env\.example|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|sh|sql|diff|patch)$/i;

/** How a file shows in the pane, from its type and its name. */
export function docKind(name: string, type: string): DocKind {
  const t = safeType(type);
  if (PICTURE.test(t)) return "picture";
  if (t === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (t === "text/markdown" || /\.(?:md|markdown)$/i.test(name)) return "md";
  if (t === "text/csv" || /\.csv$/i.test(name)) return "csv";
  if (/^text\//.test(t) || t === "application/json" || TEXT.test(name)) return "text";
  return "file";
}

/** A stream's first `most` bytes as text; `cut` when there was more. */
async function readSome(s: ReadableStream, most: number) {
  const r = s.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  let cut = false;
  for (;;) {
    const { value, done } = await r.read();
    if (done) break;
    parts.push(value);
    n += value.byteLength;
    if (n > most) {
      cut = true;
      await r.cancel().catch(() => {});
      break;
    }
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  const text = new TextDecoder().decode(all.subarray(0, most));
  // Cut at a line's end, so a half line isn't shown.
  return { text: cut ? text.slice(0, text.lastIndexOf("\n") + 1 || undefined) : text, cut };
}

/** A CSV's rows (RFC 4180: quotes, "" inside them, newlines in a quoted cell), at most `most`. */
export function csvRows(text: string, most = MOST_ROWS) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // A comma, else what the first line uses (a semicolon in Europe's spreadsheets, a tab).
  const head = text.split("\n", 1)[0] ?? "";
  const sep = [",", ";", "\t"].find((s) => head.includes(s)) ?? ",";
  const end = () => {
    row.push(cell.slice(0, 500));
    cell = "";
  };
  for (let i = 0; i < text.length && rows.length < most; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) end();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      end();
      rows.push(row.slice(0, MOST_COLS));
      row = [];
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < most) {
    end();
    rows.push(row.slice(0, MOST_COLS));
  }
  return rows;
}

/** GitHub's rendering of Markdown, as a README's (no #12 links), cleaned for the page. */
async function render(env: Env, deps: Pick<Deps, "fetch" | "now">, text: string) {
  const token = await installationToken(env, deps);
  const res = await deps.fetch("https://api.github.com/markdown", {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "shipify-edge",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ text, mode: "markdown" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GitHubError(res.status, "POST markdown");
  return clean(await res.text()).html;
}

/**
 * A kept file, for the pane: what it is, and its words to show (Markdown as cleaned HTML, a CSV as
 * rows, other text as text). Undefined when it's gone. Markdown GitHub can't render just now shows
 * as text, and isn't kept, so the next look renders it.
 */
export async function docOf(
  env: Env,
  deps: Pick<Deps, "fetch" | "now">,
  kv: Kv,
  ref: string,
): Promise<Doc | undefined> {
  if (!FILE_REF.test(ref)) return undefined;
  const key = `web:doc:${ref}`;
  let plain: Doc | undefined;
  const read = async (): Promise<Doc | null> => {
    const { value, metadata } = await kv.getWithMetadata<FileMeta>(ref, "stream");
    if (!value || !metadata) return null;
    const kind = docKind(metadata.name, metadata.type);
    const base = {
      v: 1 as const,
      ref,
      name: metadata.name,
      type: safeType(metadata.type),
      size: metadata.size,
      kind,
    };
    if (kind !== "md" && kind !== "csv" && kind !== "text") {
      await value.cancel().catch(() => {});
      return base;
    }
    const { text, cut } = await readSome(value, MOST_SHOWN);
    const more = cut ? { cut: true as const } : {};
    if (kind === "csv") {
      const rows = csvRows(text);
      return { ...base, rows, ...(cut || rows.length >= MOST_ROWS ? { cut: true as const } : {}) };
    }
    if (kind === "text") return { ...base, text, ...more };
    try {
      return { ...base, html: await render(env, deps, text), ...more };
    } catch {
      plain = { ...base, kind: "text", text, ...more };
      throw new Error("not rendered");
    }
  };
  try {
    return (await cached(key, DAY_MS, read, deps.now())) ?? undefined;
  } catch (e) {
    if (plain) return plain;
    throw e;
  }
}
