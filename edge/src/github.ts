// The door App's way into GitHub (ADR 0031, "Keys"): a JWT signed with its private key (RS256,
// WebCrypto, the PKCS#8 key from the Worker's secret) buys an installation token for shipify, kept
// per isolate until shortly before it expires. The App may do exactly what its install allows:
// Issues read and write, Actions, Administration and Variables read, on shipify only. Every call
// goes through a fetch the caller hands in, so a tick can count its subrequests and stop in time.
import { cached, recall, remember } from "./cache.ts";
import type { Deps, Env } from "./env.ts";
import { BudgetSpent, obj, utf8 } from "./env.ts";

const API = "https://api.github.com";
const TIMEOUT_MS = 5_000;

/** The tick's subrequests are spent: what's left waits for the next one. */
export { BudgetSpent };

/** GitHub said no, or didn't answer (status 0). */
export class GitHubError extends Error {
  constructor(
    public status: number,
    public what: string,
  ) {
    super(`GitHub answered ${status || "nothing"} to ${what}`);
  }
}

/** GitHub refused the door App's key (or its install is gone): nothing can be written. */
export class DoorKeyRefused extends Error {
  constructor(public status: number) {
    super(`GitHub refused the door App's key (${status})`);
  }
}

/** Down, slow or busy: worth trying again later (5xx, 429, a timeout, a secondary limit). */
export const passing = (e: unknown) =>
  e instanceof GitHubError && (e.status === 0 || e.status >= 500 || e.status === 429);

/**
 * A fetch that stops at `max` subrequests: each call past it throws BudgetSpent. `reserve` of them
 * are kept for the last step (`final()`), so a tick that runs out still says what it found.
 */
export function budgeted(fetcher: Deps["fetch"], max: number, reserve = 0) {
  let spent = 0;
  let last = false;
  return {
    fetch: async (input: string, init?: RequestInit) => {
      if (spent >= (last ? max : max - reserve)) throw new BudgetSpent();
      spent++;
      return fetcher(input, init);
    },
    final: () => {
      last = true;
    },
    spent: () => spent,
  };
}

// ---------------------------------------------------------------- the App's JWT

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** A PEM's head and foot lines, written so no key scanner takes this code for a key. */
const PEM_LINE = /-{5}(BEGIN|END) PRIVATE KEY-{5}/g;

/** A PEM's bytes. Only PKCS#8 ("BEGIN PRIVATE KEY") is taken: door setup converts GitHub's. */
export function pkcs8Der(pem: string): Uint8Array<ArrayBuffer> {
  if (!/-{5}BEGIN PRIVATE KEY-{5}/.test(pem))
    throw new Error("the door App's key isn't PKCS#8: run pnpm ship door setup --new --yes");
  const body = pem.replace(PEM_LINE, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** The App's JWT: RS256, issued a minute back (clock drift), good for nine minutes. */
export async function appJwt(appId: string, pem: string, nowMs: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(nowMs / 1000);
  const part = (o: unknown) => b64url(utf8(JSON.stringify(o)));
  const signing = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(signing));
  return `${signing}.${b64url(new Uint8Array(sig))}`;
}

const headers = (auth: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${auth}`,
  "content-type": "application/json",
  "user-agent": "shipify-edge",
  "x-github-api-version": "2022-11-28",
});

async function send(deps: Pick<Deps, "fetch">, url: string, init: RequestInit) {
  try {
    return await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof BudgetSpent) throw e;
    return new Response(null, { status: 599 });
  }
}

/**
 * The installation token, from the App's JWT: remembered until five minutes before it expires. A
 * 401 or 404 means the key or the install is gone (DoorKeyRefused); anything else, try later.
 */
export async function installationToken(env: Env, deps: Pick<Deps, "fetch" | "now">) {
  const key = `gh:token:${env.SHIPIFY_DOOR_APP_ID}:${env.SHIPIFY_DOOR_INSTALLATION}`;
  const hit = recall<string>(key, deps.now());
  if (hit) return hit;
  const jwt = await appJwt(
    env.SHIPIFY_DOOR_APP_ID ?? "",
    env.SHIPIFY_DOOR_APP_KEY ?? "",
    deps.now(),
  ).catch(() => {
    throw new DoorKeyRefused(0);
  });
  const res = await send(
    deps,
    `${API}/app/installations/${encodeURIComponent(env.SHIPIFY_DOOR_INSTALLATION ?? "")}/access_tokens`,
    { method: "POST", headers: headers(jwt) },
  );
  if (res.status === 401 || res.status === 404) throw new DoorKeyRefused(res.status);
  if (!res.ok) throw new GitHubError(res.status >= 599 ? 0 : res.status, "the door App's token");
  const said = obj(await res.json().catch(() => null));
  const token = typeof said?.token === "string" ? said.token : "";
  const until = Date.parse(String(said?.expires_at ?? "")) - 5 * 60_000;
  if (!token) throw new GitHubError(0, "the door App's token");
  remember(key, token, Math.max(60_000, until - deps.now()), deps.now());
  return token;
}

/** The door App's own login (`<slug>[bot]`), from GitHub's record of its id, for its reactions. */
export const appLogin = (env: Env, deps: Pick<Deps, "fetch" | "now">) =>
  cached(
    `gh:app:${env.SHIPIFY_DOOR_APP_ID}`,
    24 * 3_600_000,
    async () => {
      const jwt = await appJwt(
        env.SHIPIFY_DOOR_APP_ID ?? "",
        env.SHIPIFY_DOOR_APP_KEY ?? "",
        deps.now(),
      );
      const res = await send(deps, `${API}/app`, { headers: headers(jwt) });
      if (res.status === 401) throw new DoorKeyRefused(401);
      const slug = obj(await res.json().catch(() => null))?.slug;
      if (!res.ok || typeof slug !== "string") throw new GitHubError(res.status, "the door App");
      return `${slug}[bot]`;
    },
    deps.now(),
  );

// ---------------------------------------------------------------- the client

export interface GitHub {
  /** `owner/shipify`. */
  repo: string;
  /** The door App's id, as a number: how its own writes are known. */
  appId: number;
  /** Its bot user's login, `<slug>[bot]`: GitHub reserves `[bot]` names for Apps. */
  bot?: string;
  /** A call: its status, its JSON (null when none) and its Link header. Never throws for a status. */
  call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown; link?: string }>;
  /** A call that must work: its JSON, or GitHubError. */
  json<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** A GraphQL query's data, or GitHubError. */
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

/** The door App's client for shipify, its token fetched on its first call. */
export function github(env: Env, deps: Pick<Deps, "fetch" | "now">): GitHub {
  const call = async (method: string, path: string, body?: unknown) => {
    const token = await installationToken(env, deps);
    const res = await send(deps, path.startsWith("https://") ? path : `${API}/${path}`, {
      method,
      headers: headers(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const status = res.status >= 599 ? 0 : res.status;
    const text = status ? await res.text().catch(() => "") : "";
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    const link = res.headers.get("link") ?? undefined;
    // A secondary rate limit comes as a 403 that says so: try later, like a 429.
    if (status === 403 && /rate limit/i.test(String(obj(data)?.message ?? "")))
      return { status: 429, data, link };
    return { status, data, link };
  };
  return {
    repo: env.GITHUB_REPO ?? "",
    appId: Number(env.SHIPIFY_DOOR_APP_ID),
    ...(env.SHIPIFY_DOOR_SLUG ? { bot: `${env.SHIPIFY_DOOR_SLUG}[bot]` } : {}),
    call,
    async json<T>(method: string, path: string, body?: unknown) {
      const r = await call(method, path, body);
      if (r.status < 200 || r.status > 299) throw new GitHubError(r.status, `${method} ${path}`);
      return r.data as T;
    },
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      const r = await call("POST", "graphql", { query, variables });
      const o = obj(r.data);
      if (r.status !== 200 || !o?.data || o.errors) throw new GitHubError(r.status, "graphql");
      return o.data as T;
    },
  };
}

/**
 * Written by the door App: the App that made it (comments carry it), or its own bot user (an issue
 * it opens with its token carries no App, only its author, `<slug>[bot]`, which no person can be).
 */
export const byDoor = (
  gh: GitHub,
  item: {
    performed_via_github_app?: { id?: number } | null;
    user?: { login?: string; type?: string } | null;
  },
) =>
  item.performed_via_github_app?.id === gh.appId ||
  (gh.bot !== undefined && item.user?.login === gh.bot && item.user?.type === "Bot");

/** The workflow token's own login: replies and status comments count only from it. */
export const RUN_WRITER = "github-actions[bot]";
/** github-actions[bot]'s fixed user id, so a look-alike name can't stand in for it. */
export const RUN_WRITER_ID = 41898282;
export const byRun = (item: { user?: { login?: string; id?: number } | null }) =>
  item.user?.login === RUN_WRITER && item.user?.id === RUN_WRITER_ID;

/** An issue's number from a comment's `issue_url`. */
export const issueOf = (issueUrl: string | undefined) =>
  Number(/\/issues\/(\d+)$/.exec(issueUrl ?? "")?.[1] ?? 0);
