// The edge, from your PC (ADR 0031): where it is, and its secrets on Cloudflare. It lives with the
// edge, not in cli/: the core names no host (tests/core.test.ts), and the edge runs on Cloudflare.
// Its secrets (the door App's key, and each chat channel's: edge/setup/settings.ts) live only in
// the Worker: they're put there with `wrangler secret put`, read from stdin, using the deploy token
// in your credentials file, and never printed or written anywhere else. Its plain values are
// shipify's variables, which ci.yml's deploy hands to the Worker.
import { createPrivateKey, createSign } from "node:crypto";
import { join } from "node:path";
import { maskSecrets } from "../../cli/contracts/index.ts";
import { PLATFORM_ROOT } from "../../cli/lib/config.ts";
import { credential, loadCredentials, setCredential } from "../../cli/lib/credentials.ts";
import { type RunResult, run } from "../../cli/lib/exec.ts";

export const EDGE_CONFIG = join(PLATFORM_ROOT, "edge", "wrangler.jsonc");
/** What /health says the edge is, so a setup never points at another Worker by mistake. */
export const EDGE_APP = "shipify-edge";

/**
 * The edge's origin: shipify's variable SHIPIFY_DOOR_URL when it's set, else
 * `https://shipify.<APPS_DOMAIN>` when you have a domain, else its free address,
 * `https://shipify.<your workers.dev name>.workers.dev` (ADR 0047: no domain needed).
 */
export function edgeOrigin(vars: Record<string, string | undefined> = {}): string | undefined {
  const set = vars.SHIPIFY_DOOR_URL?.trim();
  if (set) {
    try {
      const u = new URL(set);
      // https, or a test's own server on this machine.
      if (u.protocol === "https:" || /^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return u.origin;
    } catch {}
  }
  const values = loadCredentials().values;
  const domain = credential(values, "APPS_DOMAIN") ?? vars.APPS_DOMAIN?.trim() ?? "";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return `https://shipify.${domain}`;
  const workers = vars.CF_WORKERS_SUBDOMAIN?.trim() || credential(values, "CF_WORKERS_SUBDOMAIN");
  return workers && /^[a-z0-9][a-z0-9-]{0,62}$/.test(workers)
    ? `https://shipify.${workers}.workers.dev`
    : undefined;
}

/**
 * What Cloudflare says with this PC's deploy token, for what isn't on this PC yet (ADR 0047: found,
 * not typed): your account, when the token reaches one, and its workers.dev name. Each kept in the
 * credentials file. Nothing when there's no token, or Cloudflare doesn't answer.
 */
export async function cloudflareFound(fetchFn: typeof fetch): Promise<string[]> {
  const values = loadCredentials().values;
  const token = credential(values, "CF_DEPLOY_TOKEN");
  if (!token) return [];
  const get = async (path: string): Promise<unknown> => {
    try {
      const r = await fetchFn(`https://api.cloudflare.com/client/v4/${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok ? ((await r.json()) as { result?: unknown }).result : undefined;
    } catch {
      return undefined;
    }
  };
  const said: string[] = [];
  let account = credential(values, "CLOUDFLARE_ACCOUNT_ID");
  if (!account) {
    const all = (await get("accounts")) as { id?: string }[] | undefined;
    const only = Array.isArray(all) && all.length === 1 ? all[0]?.id : undefined;
    if (only && /^[a-f0-9]{32}$/.test(only)) {
      setCredential("CLOUDFLARE_ACCOUNT_ID", only);
      account = only;
      said.push("your Cloudflare account, found with the deploy token");
    }
  }
  if (account && !credential(values, "CF_WORKERS_SUBDOMAIN")) {
    const sub = ((await get(`accounts/${account}/workers/subdomain`)) as { subdomain?: string })
      ?.subdomain;
    if (sub && /^[a-z0-9][a-z0-9-]{0,62}$/.test(sub)) {
      setCredential("CF_WORKERS_SUBDOMAIN", sub);
      said.push(`your workers.dev name, ${sub}`);
    }
  }
  return said;
}

/** What this PC lacks to reach Cloudflare, as a fix; nothing when it has it. */
export function cloudflareMissing(): string | undefined {
  const values = loadCredentials().values;
  const gone = ["CF_DEPLOY_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((n) => !credential(values, n));
  return gone.length
    ? `${gone.join(" and ")} aren't in ${loadCredentials().file}: put them there (docs/setup.md, Tokens and secrets), then run this again`
    : undefined;
}

/** wrangler for the edge's Worker, with the deploy token (SHIPIFY_WRANGLER: a test's own). */
export function wrangler(args: string[], input?: string): RunResult {
  const values = loadCredentials().values;
  const bin =
    process.env.SHIPIFY_WRANGLER ?? join(PLATFORM_ROOT, "node_modules", ".bin", "wrangler");
  return run(bin, [...args, "--config", EDGE_CONFIG], {
    cwd: PLATFORM_ROOT,
    input,
    env: {
      CLOUDFLARE_API_TOKEN: credential(values, "CF_DEPLOY_TOKEN") ?? "",
      CLOUDFLARE_ACCOUNT_ID: credential(values, "CLOUDFLARE_ACCOUNT_ID") ?? "",
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
    },
    timeoutMs: 120_000,
  });
}

/** A terminal's colour codes, which wrangler writes around its words. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The first line wrangler said that explains a failure, with nothing that looks like a key. */
const why = (r: RunResult) =>
  maskSecrets(
    (r.stderr || r.stdout)
      .split("\n")
      .map((l) => l.replace(COLOUR, "").trim())
      .find((l) => /error|✘|not|failed|denied|authentication/i.test(l))
      ?.slice(0, 200) ?? `wrangler exited with ${r.code}`,
  );

/** The names of the secrets the Worker holds, or why they couldn't be read. */
export function edgeSecretNames(): { ok: true; names: string[] } | { ok: false; why: string } {
  const r = wrangler(["secret", "list", "--format", "json"]);
  if (r.code !== 0) return { ok: false, why: why(r) };
  try {
    const list = JSON.parse(r.stdout.slice(r.stdout.indexOf("["))) as { name?: string }[];
    return { ok: true, names: list.flatMap((s) => (s.name ? [s.name] : [])) };
  } catch {
    return { ok: false, why: "wrangler's answer wasn't a list" };
  }
}

/** A secret on the Worker, from stdin: never on the command line, never printed. */
export function putEdgeSecret(name: string, value: string): { ok: boolean; why?: string } {
  const r = wrangler(["secret", "put", name], value);
  return r.code === 0 ? { ok: true } : { ok: false, why: why(r) };
}

export function deleteEdgeSecret(name: string): { ok: boolean; why?: string } {
  const r = wrangler(["secret", "delete", name]);
  return r.code === 0 || /not found/i.test(r.stderr) ? { ok: true } : { ok: false, why: why(r) };
}

/** GitHub's App key (PKCS#1, "BEGIN RSA PRIVATE KEY") as the PKCS#8 WebCrypto reads. */
export function toPkcs8(pem: string): string {
  return createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString();
}

/** A GitHub App's JWT (RS256), from its id and key: for the App's own calls during setup. */
export function appJwt(appId: number | string, pem: string, now = Date.now()): string {
  const s = Math.floor(now / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signing = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: s - 60, exp: s + 540, iss: String(appId) })}`;
  return `${signing}.${createSign("RSA-SHA256").update(signing).sign(pem, "base64url")}`;
}
