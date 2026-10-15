// The web chat's setup, the parts that only read (ADR 0036, "Setup"): what a stranger's visit to
// /admin/chat says about the sign-in, whether the deployed edge has its file store bound, your
// entry in SHIPIFY_PEOPLE with and without its id on the chat, your default channels with and
// without it, and the notifications' key (ADR 0050). No network and no files here, so tests read
// them as they are; tools/web/setup.ts does the asking.
import { generateKeyPairSync } from "node:crypto";
import { type Person, withId } from "../../cli/lib/people.ts";

/** The chat's address on the edge. */
export const chatUrl = (origin: string) => `${origin}/admin/chat/`;

/** The one edit that puts the chat (and the status page) behind the sign-in: path admin/*. */
export const ACCESS_EDIT = [
  "In Cloudflare's dashboard, open Zero Trust → Access → Applications → “shipify status” → Edit.",
  "Change its path to admin/* (from status, if it says that: the status page and the chat are both under /admin now). Save.",
  "Then run it again: pnpm ship add webchat --yes",
];

/**
 * What a browser that isn't signed in gets at /admin/chat/: Access's sign-in in front (a redirect
 * to <team>.cloudflareaccess.com) passes; the edge's own 403 means Access doesn't cover the chat.
 */
export function signinVerdict(
  url: string,
  status: number,
  location: string | null,
): { ok: boolean; line: string; edit?: string[] } {
  const to = location ?? "";
  if (status >= 300 && status < 400 && /\.cloudflareaccess\.com\//.test(to))
    return { ok: true, line: `${url} sends a stranger to Cloudflare Access's sign-in` };
  if (status === 403)
    return {
      ok: false,
      line: `${url}: the edge answered itself (403), so the sign-in doesn't cover /admin: change the "shipify status" application's path to admin/*, then run it again`,
      edit: ACCESS_EDIT,
    };
  return {
    ok: false,
    line: `${url} answered ${status}${to ? ` (to ${to})` : ""}, not Access's sign-in: pnpm ship door page --yes checks the status page first`,
  };
}

/** What Cloudflare said about the shipify Worker's settings, for the file store. */
export type FilesVerdict =
  | { kind: "bound"; line: string }
  | { kind: "unbound"; line: string }
  | { kind: "refused"; line: string }
  | { kind: "other"; line: string };

/** The note when files are off: words still work. */
export const FILES_OFF =
  "files stay off until the next deploy creates the store (FILES, in edge/wrangler.jsonc): the deploy token needs “Workers KV Storage: Edit” (docs/setup.md, Tokens and secrets). Words work now";

/**
 * Cloudflare's answer to GET /accounts/<id>/workers/scripts/shipify/settings: whether a Workers KV
 * namespace is bound as FILES, or why it couldn't tell.
 */
export function filesVerdict(status: number, body: unknown): FilesVerdict {
  const said = (body ?? {}) as {
    success?: boolean;
    errors?: { code?: number; message?: string }[];
    result?: { bindings?: { type?: string; name?: string }[] };
  };
  const why = said.errors?.[0]?.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403 || said.errors?.some((e) => e.code === 10000))
    return {
      kind: "refused",
      line: `Cloudflare refused the deploy token (${why}): check CF_DEPLOY_TOKEN in your credentials file and its permissions (docs/setup.md, Tokens and secrets)`,
    };
  if (status === 404)
    return {
      kind: "other",
      line: "Cloudflare has no Worker called shipify yet: the edge is deployed with the release (pnpm ship door check says more)",
    };
  const bindings = said.result?.bindings;
  if (status !== 200 || said.success === false || !Array.isArray(bindings))
    return { kind: "other", line: `Cloudflare said: ${why}` };
  return bindings.some((b) => b?.type === "kv_namespace" && b?.name === "FILES")
    ? { kind: "bound", line: "the edge keeps the chat's files (FILES is bound)" }
    : { kind: "unbound", line: FILES_OFF };
}

/** People with your id on the chat ("me": every message from it is yours); nothing when it's there. */
export function withWeb(people: Person[]): Person[] | undefined {
  return people[0]?.on.web ? undefined : withId(people, "web", "me");
}

/** People with no id on the chat; nothing when no one had one. */
export function withoutWeb(people: Person[]): Person[] | undefined {
  if (!people.some((p) => p.on.web)) return undefined;
  return people.map((p) => {
    const { web: _, ...on } = p.on;
    return { ...p, on };
  });
}

/**
 * Your default channels (SHIPIFY_SEND) with the web chat when there are none, so alerts, repeats
 * and recipes notify you there too (ADR 0050); nothing when some are set: those stay yours.
 */
export const sendWithWeb = (send: string[]): string[] | undefined =>
  send.length ? undefined : ["web"];

/** Your default channels without the web chat; nothing when it isn't there. */
export const sendWithoutWeb = (send: string[]): string[] | undefined =>
  send.includes("web") ? send.filter((c) => c !== "web") : undefined;

/** The Worker's secret the web chat's notifications are signed with. */
export const PUSH_KEY = "WEB_PUSH_KEY";

/** A new key for it: P-256, as a JWK holding its public half too (edge/src/push.ts reads it). */
export const newPushKey = () =>
  JSON.stringify(
    generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
  );
