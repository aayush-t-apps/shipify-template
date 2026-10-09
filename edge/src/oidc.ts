// A run proving itself to the door (ADR 0031, "Files, both ways"): shipify's own task.yml or
// watch.yml, on main, asks GitHub for an OIDC token with the edge's origin as its audience, and the
// door checks it against GitHub's published keys. No key is shared between boxes and the door:
// GitHub vouches for the run. Checked: RS256 only, the issuer, the audience, shipify's repository
// and owner by their numeric ids, main, one of the two workflows, and the token's times (±60 s).
// The keys are kept per isolate, and fetched again for a key id they don't have (once a minute).
import { cached, forget, recall, remember } from "./cache.ts";
import type { Deps, Env } from "./env.ts";
import { obj, utf8 } from "./env.ts";

export const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const SKEW_S = 60;

export type Claims = Record<string, unknown>;
export type Verdict = { ok: true; claims: Claims } | { ok: false; why: string };

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const decode = (s: string): Record<string, unknown> | null => {
  try {
    return obj(JSON.parse(new TextDecoder().decode(fromB64url(s))));
  } catch {
    return null;
  }
};

type Jwk = JsonWebKey & { kid?: string };

async function keys(deps: Pick<Deps, "fetch" | "now">): Promise<Jwk[]> {
  return cached(
    "oidc:jwks",
    6 * 3_600_000,
    async () => {
      const res = await deps.fetch(JWKS_URL, { signal: AbortSignal.timeout(5_000) });
      const list = obj(await res.json().catch(() => null))?.keys;
      if (!res.ok || !Array.isArray(list)) throw new Error(`GitHub's keys answered ${res.status}`);
      return list as Jwk[];
    },
    deps.now(),
  );
}

/** The key for this id: from the kept keys, or once a minute from GitHub again. */
async function keyFor(kid: string, deps: Pick<Deps, "fetch" | "now">) {
  let found = (await keys(deps)).find((k) => k.kid === kid);
  if (!found && !recall("oidc:refetched", deps.now())) {
    remember("oidc:refetched", true, 60_000, deps.now());
    forget("oidc:jwks");
    found = (await keys(deps)).find((k) => k.kid === kid);
  }
  return found;
}

/** The workflows a run may call the door from: shipify's own, on main. */
export const workflowRefs = (repo: string) => [
  `${repo}/.github/workflows/task.yml@refs/heads/main`,
  `${repo}/.github/workflows/watch.yml@refs/heads/main`,
];

/** Why these claims aren't a run of shipify's on main, or undefined when they are. */
export function claimsProblem(c: Claims, env: Env, nowMs: number): string | undefined {
  const now = Math.floor(nowMs / 1000);
  const num = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== ISSUER) return "issuer";
  if (!env.SHIPIFY_DOOR_URL || !aud.includes(env.SHIPIFY_DOOR_URL)) return "audience";
  if (String(c.repository_id ?? "") !== env.SHIPIFY_REPO_ID) return "repository";
  if (String(c.repository_owner_id ?? "") !== env.SHIPIFY_OWNER_ID) return "owner";
  if (c.ref !== "refs/heads/main") return "ref";
  if (!workflowRefs(env.GITHUB_REPO ?? "").includes(String(c.workflow_ref ?? "")))
    return "workflow";
  const exp = num(c.exp);
  const nbf = c.nbf === undefined ? num(c.iat) : num(c.nbf);
  const iat = num(c.iat);
  if (!(exp + SKEW_S >= now)) return "expired";
  if (!(nbf - SKEW_S <= now) || !(iat - SKEW_S <= now)) return "not yet valid";
  return undefined;
}

/** A bearer token from a run, checked in full. */
export async function verifyRun(
  token: string,
  env: Env,
  deps: Pick<Deps, "fetch" | "now">,
): Promise<Verdict> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, why: "malformed" };
  const [h = "", p = "", s = ""] = parts;
  const head = decode(h);
  const claims = decode(p);
  if (!head || !claims) return { ok: false, why: "malformed" };
  if (head.alg !== "RS256" || typeof head.kid !== "string") return { ok: false, why: "algorithm" };
  let jwk: Jwk | undefined;
  try {
    jwk = await keyFor(head.kid, deps);
  } catch {
    return { ok: false, why: "keys unreadable" };
  }
  if (jwk?.kty !== "RSA") return { ok: false, why: "unknown key" };
  let good = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), utf8(`${h}.${p}`));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, why: "signature" };
  const why = claimsProblem(claims, env, deps.now());
  return why ? { ok: false, why } : { ok: true, claims };
}

/** The bearer token on a request, if it has one. */
export const bearer = (req: Request) =>
  /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
