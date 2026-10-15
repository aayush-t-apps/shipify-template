// Who Cloudflare Access signed in, for the status page and the chat (ADR 0001, ADR 0032, ADR 0036).
// Access guards `/admin` alone, so the door's routes stay open to the services that call them. Access sends a signed token in the Cf-Access-Jwt-Assertion header, and
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
export async function accessTokenOk(
  token: string | null | undefined,
  app: AccessApp | undefined,
  deps: Pick<Deps, "fetch" | "now">,
): Promise<boolean> {
  if (!token || !app?.team || !app.aud) return false;
  const { team, aud } = app;
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return false;
    const header = json(h);
    const claims = json(p);
    if (header.alg !== "RS256") return false;
    const now = deps.now() / 1000;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return false;
    if (claims.iss !== `https://${team}`) return false;
    if (typeof claims.exp !== "number" || claims.exp < now) return false;
    if (typeof claims.nbf === "number" && claims.nbf > now + 60) return false;
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
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      bytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    return false;
  }
}

/** SHIPIFY_ACCESS's value: `{"team": "<team>.cloudflareaccess.com", "aud": "<tag>"}`, checked. */
export function parseAccess(value: string | undefined): AccessApp | undefined {
  try {
    const o = JSON.parse(value ?? "") as { team?: unknown; aud?: unknown };
    const team = typeof o.team === "string" ? o.team.trim().replace(/^https:\/\//, "") : "";
    const aud = typeof o.aud === "string" ? o.aud.trim() : "";
    return /^[a-z0-9-]{1,63}\.cloudflareaccess\.com$/.test(team) && /^[a-f0-9]{32,128}$/.test(aud)
      ? { team, aud }
      : undefined;
  } catch {
    return undefined;
  }
}
