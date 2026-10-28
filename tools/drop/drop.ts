// Drop's /api, for our Drop tool (docs/tools.md, Drop): the requests it makes, behind Cloudflare
// Access with a service token (CF-Access-Client-Id and -Secret). Answers stay short, and errors
// say what to do: a key Access refuses, a drop that's gone, an address that isn't Drop's.

const TIMEOUT_MS = 30_000;
/** A file's upload: up to 25 MB (a shared file's most) on a slow line. */
const UPLOAD_TIMEOUT_MS = 120_000;

export interface Drop {
  /** A JSON request to Drop's /api: `path` starts with /api/. */
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** A file's bytes, as the body of a PUT; Drop's JSON answer. */
  put<T>(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<T>;
  /** A path Drop answers with (a link: /d/…), as a full address. */
  url(path: string): string;
}

type Json = Record<string, unknown>;

/** Drop's address from its secret: https, or http only on this machine (a test's fake). */
export function baseOf(url: string | undefined): string {
  if (!url)
    throw new Error(
      "Drop isn't connected on this run: its address isn't set (docs/tools.md, Drop).",
    );
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(
      "Drop's address isn't a link: set SHIPIFY_DROP_URL again to Drop's address alone, like https://drop.example.com (no quotes, no path), with pnpm ship add drop --new --yes or on GitHub's website (docs/tools.md, Drop).",
    );
  }
  const local = ["127.0.0.1", "localhost"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
    throw new Error("Drop's address must start with https://, so its key is never sent in clear.");
  return u.origin;
}

/** A Drop client with one service token. `fetch` is for tests. */
export function drop(
  keys: { url?: string; id?: string; secret?: string },
  opts: { fetch?: typeof fetch } = {},
): Drop {
  const doFetch = opts.fetch ?? fetch;
  const send = async (method: string, path: string, body?: string | Uint8Array<ArrayBuffer>) => {
    const base = baseOf(keys.url);
    if (!keys.id || !keys.secret)
      throw new Error(
        "Drop isn't connected on this run: its service token isn't set (docs/tools.md, Drop).",
      );
    const file = body instanceof Uint8Array;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          "CF-Access-Client-Id": keys.id,
          "CF-Access-Client-Secret": keys.secret,
          ...(body === undefined
            ? {}
            : { "Content-Type": file ? "application/octet-stream" : "application/json" }),
        },
        body,
        // Access sends a refused request to its sign-in page: that's an answer, never followed.
        redirect: "manual",
        signal: AbortSignal.timeout(file ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`Drop didn't answer (${(e as Error).message}). Try again later.`);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Json;
      throw new Error(explain(res.status, data));
    }
    return res;
  };
  const json = async <T>(res: Response): Promise<T> => {
    if (res.status === 204) return {} as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(
        "Drop answered something that isn't JSON: is SHIPIFY_DROP_URL Drop's own address?",
      );
    }
  };
  return {
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      return json<T>(
        await send(method, path, body === undefined ? undefined : JSON.stringify(body)),
      );
    },
    async put<T>(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<T> {
      return json<T>(await send("PUT", path, bytes));
    },
    url: (path) => (/^https?:\/\//.test(path) ? path : `${baseOf(keys.url)}${path}`),
  };
}

/** What a Drop error means, and what to do about it. Drop says it as { error: code, message }. */
export function explain(status: number, data: Json): string {
  const words = typeof data.message === "string" ? data.message : data.error;
  const said = typeof words === "string" ? words.slice(0, 200).replace(/\.$/, "") : "";
  if (status >= 300 && status < 400)
    return "Cloudflare Access sent the request to its sign-in page: the service token is wrong, or it isn't in the /api app's Service Auth policy (docs/tools.md, Drop).";
  if (status === 401 || status === 403)
    return `Drop refused the key${said ? ` (${said})` : ""}: the service token is wrong or expired, it isn't in the /api app's Service Auth policy, or it may only look (changes use the write token, in an approved run). A new token: pnpm ship add drop --new --yes`;
  if (status === 404) return "No such drop: it was revoked, or it expired.";
  if (status === 413) return `Drop refused the file as too big${said ? `: ${said}` : ""}.`;
  if (status === 429 || status === 503) return "Drop is busy. Try again in a minute.";
  if (status === 400 || status === 409 || status === 422)
    return `Drop didn't accept that${said ? `: ${said}` : ""}.`;
  return `Drop answered ${status}${said ? `: ${said}` : ""}.`;
}
