// What the edge is given (ADR 0031, "Keys"), and what it needs from outside. Its secrets live only in
// the Worker, set from your PC with `wrangler secret put` (`ship door setup`, `ship add <channel>`);
// the rest are plain values ci.yml's deploy passes from shipify's variables. A route
// that's missing what it needs answers 503 and logs the names, never a value.
import { type Logger, logger } from "../../cli/contracts/index.ts";
import { type Device, deviceOf } from "./push.ts";

export interface Env {
  /** The commit deployed (ci.yml), shown by /health. */
  GIT_SHA?: string;
  /** shipify's repo, `owner/shipify` (ci.yml: github.repository). */
  GITHUB_REPO?: string;
  /** Your time zone (ADR 0047): your copy's variable, as ci.yml deploys it. UTC when it's unset. */
  SHIPIFY_TIME_ZONE?: string;
  /**
   * The edge's own origin (`https://shipify.<your workers.dev name>.workers.dev`, or
   * `https://shipify.<APPS_DOMAIN>` with your domain): the audience of a run's OIDC token.
   */
  SHIPIFY_DOOR_URL?: string;
  /** The door App: its id (matched by it, never by its name), and its installation on shipify. */
  SHIPIFY_DOOR_APP_ID?: string;
  SHIPIFY_DOOR_INSTALLATION?: string;
  /** Its slug: its writes made with its own token carry its bot user, `<slug>[bot]`. */
  SHIPIFY_DOOR_SLUG?: string;
  /** shipify's numeric ids, for the OIDC check: the repository's, and its owner's (the org's). */
  SHIPIFY_REPO_ID?: string;
  SHIPIFY_OWNER_ID?: string;
  /** Secret: the door App's private key, PKCS#8 PEM (door setup converts GitHub's PKCS#1). */
  SHIPIFY_DOOR_APP_KEY?: string;
  /**
   * Secret, optional: what the web chat's notifications are signed with (ADR 0050), a P-256 key as
   * a JWK (`ship add webchat`). Without it, the chat works and notifies no one.
   */
  WEB_PUSH_KEY?: string;
  // Two bindings beside these strings, read only by the web chat (ADR 0036): FILES, its Workers KV
  // store (kvOf, below), and ASSETS, its page's files (web/routes.ts). Both optional.
  /** Each chat channel's secrets, by the names its adapter `needs` (`ship add <channel>` sets them). */
  [secret: string]: string | undefined;
}

/** What every part of the edge is handed: the outside world, so tests can stand in for it. */
export interface Deps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Where log lines go: Workers' logs (console.log). */
  write: (line: string) => void;
}

export const defaultDeps = (): Deps => ({
  fetch: (input, init) => fetch(input, init),
  now: Date.now,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  write: (line) => console.log(line),
});

/** A log for one route or tick: one masked JSON line per event (cli/contracts/log.ts). */
export const logOf = (deps: Deps, step: string): Logger =>
  logger({ step }, deps.write, () => new Date(deps.now()));

/** Which of these aren't set. */
export const missing = (env: Env, names: string[]) => names.filter((n) => !env[n]?.trim());

/** What the door App needs to reach GitHub. */
export const GITHUB_NEEDS: string[] = [
  "GITHUB_REPO",
  "SHIPIFY_DOOR_APP_ID",
  "SHIPIFY_DOOR_INSTALLATION",
  "SHIPIFY_DOOR_APP_KEY",
];
/** What a run's OIDC token is checked against. */
export const OIDC_NEEDS: string[] = [
  "GITHUB_REPO",
  "SHIPIFY_DOOR_URL",
  "SHIPIFY_REPO_ID",
  "SHIPIFY_OWNER_ID",
];

/** The edge's own answers: plain JSON, never cached. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

/** 503 for a route missing what it needs, logging which (their names only). */
export function unconfigured(log: Logger, names: string[]) {
  log.warn("door.in.refused", { why: "unconfigured", missing: names });
  return json({ door: "unconfigured" }, 503);
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Two strings equal, in the same time whatever they hold. */
export function same(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 of `text`, keyed by `key`, in hex. */
export async function hmacHex(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    utf8(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", k, utf8(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The header a route of this Worker's own proves itself with to a channel it calls directly. */
export const OWN_PROOF_HEADER = "x-shipify-web-proof";

/**
 * The proof only this Worker can make, for a channel whose messages come from its own routes, not
 * a webhook (the web chat, ADR 0036): an HMAC of the channel's id, keyed by the door App's key,
 * which only the Worker holds. None without the key.
 */
export const ownProof = async (env: Env, channel: string) => {
  const key = env.SHIPIFY_DOOR_APP_KEY ?? "";
  return key ? hmacHex(key, `shipify ${channel} chat v1`) : "";
};

// ---------------------------------------------------------------- the web chat's file store

/**
 * As much of Workers KV as the edge uses, bound as FILES (ADR 0036): the web chat's files, your
 * model (model.ts) and the devices a chat notifies (below).
 */
export interface Kv {
  get(key: string, type: "stream"): Promise<ReadableStream | null>;
  getWithMetadata<M>(
    key: string,
    type: "stream",
  ): Promise<{ value: ReadableStream | null; metadata: M | null }>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  list<M>(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number; metadata?: M }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** The store, when the Worker has it (an optional binding: Env holds strings). */
export const kvOf = (env: Env): Kv | undefined => {
  const kv = (env as unknown as { FILES?: Kv }).FILES;
  return kv && typeof kv.get === "function" ? kv : undefined;
};

/** How long the store keeps a file: 7 days. */
export const KEEP_S = 7 * 86_400;
/** A kept file's key: yours (`up-…`), or a run's on a task (`run-<task>-…`). Nothing else is read. */
export const FILE_REF = /^(?:up-[a-z0-9]{16,40}|run-\d{1,9}-[a-z0-9]{16,40})$/;

/** An object's fields, or null for anything else (a list, null, a string). */
export const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const int = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

// ---------------------------------------------------------------- the devices a chat notifies

/** A device kept for a chat's notifications (ADR 0050), and since when (ms). */
export interface Kept extends Device {
  at: number;
}
/** The most devices a chat keeps: a sixth replaces the oldest. */
export const MOST_DEVICES = 5;
const devicesKey = (channel: string, chat: string) => `push:${channel}:${chat}`;

/** A chat's devices, oldest first: one read, never a listing. A list that doesn't read is none. */
export async function devicesOf(kv: Kv, channel: string, chat: string): Promise<Kept[]> {
  const s = await kv.get(devicesKey(channel, chat), "stream");
  if (!s) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(await new Response(s).text());
  } catch {
    return [];
  }
  return (Array.isArray(raw) ? raw : [])
    .flatMap((x) => {
      const o = obj(x);
      const d = deviceOf({ endpoint: o?.endpoint, keys: { p256dh: o?.p256dh, auth: o?.auth } });
      return d && int(o?.at) ? [{ ...d, at: o.at }] : [];
    })
    .slice(-MOST_DEVICES);
}

/**
 * Keeps a chat's devices, the newest MOST_DEVICES. KV takes one write a second to a key: another
 * in that second throws, as any write the store refuses does.
 */
export async function keepDevices(kv: Kv, channel: string, chat: string, devices: Kept[]) {
  const list = devices.slice(-MOST_DEVICES).map(({ endpoint, p256dh, auth, at }) => ({
    endpoint,
    p256dh,
    auth,
    at,
  }));
  await kv.put(devicesKey(channel, chat), JSON.stringify(list));
}

/** A tick spent its subrequests (github.ts: budgeted): every caller lets it through. */
export class BudgetSpent extends Error {
  constructor() {
    super("this tick's subrequests are spent");
  }
}
