// Who Cloudflare Access signed in, for the status page and the chat (ADR 0001, ADR 0032, ADR 0036),
// and for the guests' door (ADR 0071). Two Access applications: yours guards `/admin`, and the
// guests' guards `/guest`, each with its own audience, so a token for one never opens the other.
// The door's routes stay open to the services that call them. Access sends a signed token in the Cf-Access-Jwt-Assertion header, and
// the page shows nothing unless that token checks out: Cloudflare's signature (the team's public
// keys), this application's audience, the team as issuer, and the time. A missing or wrong Access
// rule fails closed.
import type { Deps } from "./env.ts";

/** The Access application the page trusts: shipify's SHIPIFY_ACCESS variable. Neither is secret. */
export interface AccessApp {
  /** The team's domain: "<team>.cloudflareaccess.com". */
  team: string;
  /** The application's audience (AUD) tag. */
  aud: string;
  /** The guests' application's audience tag (`/guest`, ADR 0071): unset, guests are off. */
  guests?: string;
}

type Certs = { keys: (JsonWebKey & { kid?: string })[] };

/** The team's public keys, kept an hour; fetched again when a token names a key we don't have. */
let cache: { team: string; at: number; certs: Certs } | undefined;
const CERTS_TTL_MS = 60 * 60 * 1000;
/** A token naming a key we don't have refetches at most this often: unsigned tokens can't force more. */
const REFETCH_MS = 60 * 1000;
export const clearCertsCache = () => {
  cache = undefined;
};

const bytes = (b64url: string) =>
  Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (b64url: string) =>
  JSON.parse(new TextDecoder().decode(bytes(b64url))) as Record<string, unknown>;

/** Whether this Access token is genuine, for this application, and current. */
export const accessTokenOk = async (
  token: string | null | undefined,
  app: AccessApp | undefined,
  deps: Pick<Deps, "fetch" | "now">,
) => (await accessClaims(token, app, deps)) !== null;

/**
 * This Access token's claims (its `email` among them, ADR 0071) when it's genuine, for this
 * application, and current; else null.
 */
export async function accessClaims(
  token: string | null | undefined,
  app: AccessApp | undefined,
  deps: Pick<Deps, "fetch" | "now">,
): Promise<Record<string, unknown> | null> {
  if (!token || !app?.team || !app.aud) return null;
  const { team, aud } = app;
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = json(h);
    const claims = json(p);
    if (header.alg !== "RS256") return null;
    const now = deps.now() / 1000;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return null;
    if (claims.iss !== `https://${team}`) return null;
    if (typeof claims.exp !== "number" || claims.exp < now) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;
    const load = async (fresh: boolean) => {
      const age = cache && cache.team === team ? deps.now() - cache.at : Number.POSITIVE_INFINITY;
      if (age > CERTS_TTL_MS || (fresh && age > REFETCH_MS)) {
        const res = await deps.fetch(`https://${team}/cdn-cgi/access/certs`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`Access certs: ${res.status}`);
        cache = { team, at: deps.now(), certs: (await res.json()) as Certs };
      }
      return (cache as NonNullable<typeof cache>).certs;
    };
    // Access rotates its keys: a key we don't have yet means fetching them again, once.
    const jwk =
      (await load(false)).keys.find((k) => k.kid === header.kid) ??
      (await load(true)).keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      bytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    return ok ? claims : null;
  } catch {
    return null;
  }
}

/** An Access application's audience tag. */
const AUD = /^[a-f0-9]{32,128}$/;

/**
 * SHIPIFY_ACCESS's value: `{"team": "<team>.cloudflareaccess.com", "aud": "<tag>"}`, and the
 * guests' tag when you let guests in (`"guests": "<tag>"`), checked. A guests' tag that doesn't
 * read is left out: guests off, your sign-in as before.
 */
export function parseAccess(value: string | undefined): AccessApp | undefined {
  try {
    const o = JSON.parse(value ?? "") as { team?: unknown; aud?: unknown; guests?: unknown };
    const team = typeof o.team === "string" ? o.team.trim().replace(/^https:\/\//, "") : "";
    const aud = typeof o.aud === "string" ? o.aud.trim() : "";
    const guests = typeof o.guests === "string" ? o.guests.trim().toLowerCase() : "";
    return /^[a-z0-9-]{1,63}\.cloudflareaccess\.com$/.test(team) && AUD.test(aud)
      ? { team, aud, ...(AUD.test(guests) && guests !== aud ? { guests } : {}) }
      : undefined;
  } catch {
    return undefined;
  }
}
