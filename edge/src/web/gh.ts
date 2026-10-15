// The chat's reads of GitHub (ADR 0036, "Loading and updates"), as the door App, read-only. A read
// that shows bodies asks for `full+json`, so a body comes with its raw text (hidden lines and all)
// and GitHub's own rendering (`body_html`); a listing asks for the raw text alone, a lighter answer.
// Each carries the ETag of its last answer: unchanged is a 304, which costs none of the App's 5,000
// calls an hour. The answers are kept per isolate.
import type { Deps, Env } from "../env.ts";
import { GitHubError, installationToken } from "../github.ts";

const API = "https://api.github.com";
/** Answers kept for their ETags, at most this many (the oldest go first). */
const MOST = 200;
const seen = new Map<string, { etag: string; data: unknown }>();

export const clearSeen = () => seen.clear();

/**
 * One read: its JSON, from GitHub or, when GitHub says it's unchanged, from the last answer.
 * `html: false` for a listing that shows no bodies.
 */
export async function read<T>(
  env: Env,
  deps: Pick<Deps, "fetch" | "now">,
  path: string,
  { html = true } = {},
) {
  const token = await installationToken(env, deps);
  const key = `${env.GITHUB_REPO}:${html ? "" : "raw:"}${path}`;
  const last = seen.get(key);
  let res: Response;
  try {
    res = await deps.fetch(`${API}/${path}`, {
      headers: {
        accept: html ? "application/vnd.github.full+json" : "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "shipify-edge",
        "x-github-api-version": "2022-11-28",
        ...(last ? { "if-none-match": last.etag } : {}),
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new GitHubError(0, `GET ${path}`);
  }
  if (res.status === 304 && last) return last.data as T;
  if (!res.ok) throw new GitHubError(res.status, `GET ${path}`);
  const data = (await res.json()) as T;
  const etag = res.headers.get("etag");
  if (etag) {
    seen.delete(key);
    seen.set(key, { etag, data });
    if (seen.size > MOST) seen.delete(seen.keys().next().value as string);
  }
  return data;
}

/** The same, or null when it isn't there (404, 410). */
export async function readOr<T>(
  env: Env,
  deps: Pick<Deps, "fetch" | "now">,
  path: string,
  opts: { html?: boolean } = {},
) {
  try {
    return await read<T>(env, deps, path, opts);
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}
