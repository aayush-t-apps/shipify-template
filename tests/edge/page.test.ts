// The status page (edge/src/page.ts, ADR 0032): GET /admin/status, behind Cloudflare Access, whose token
// the edge checks itself. It shows nothing without a good token or before it's set up, reads only,
// escapes what GitHub says, and sends the headers that keep a browser from doing anything else.
import { beforeAll, describe, expect, it } from "vitest";
import { STATUS_MARK } from "../../cli/contracts/index.ts";
import { clearCertsCache } from "../../edge/src/access.ts";
import { handle } from "../../edge/src/app.ts";
import { envFor, type Keys, keys, world } from "./fake.ts";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "a".repeat(64);

let k: Keys;
let access: CryptoKeyPair;
let jwk: JsonWebKey;
beforeAll(async () => {
  k = await keys();
  access = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey("jwk", access.publicKey)), kid: "ak1" } as JsonWebKey;
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An Access token, as Cloudflare signs it, unless `claims` or `key` say otherwise. */
async function token(now: number, claims: Record<string, unknown> = {}, key = access.privateKey) {
  const head = b64({ alg: "RS256", kid: "ak1" });
  const body = b64({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: Math.floor(now / 1000) + 600,
    nbf: Math.floor(now / 1000) - 10,
    email: "owner@example.com",
    ...claims,
  });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

/** A world with the page set up, a status record, an app, a box, a task that needs you. */
function setUp() {
  clearCertsCache();
  const f = world(k);
  f.w.variables.SHIPIFY_ACCESS = JSON.stringify({ team: TEAM, aud: AUD });
  f.w.variables.SHIPIFY_KEY_DATES = JSON.stringify({ "the door App's key": "2026-10-20" });
  f.w.apps[`https://${TEAM}/cdn-cgi/access/certs`] = { body: { keys: [jwk] } };
  const record = {
    v: 2,
    watch: { last: new Date(f.w.at - 3_600_000).toISOString() },
    apps: [
      { id: "spotter", url: "https://spotter.example.com" },
      { id: "links", url: "https://links.example.com", failing: new Date(f.w.at).toISOString() },
    ],
    upcoming: [
      {
        n: 45,
        title: "Recipe: daily-brief",
        next: new Date(f.w.at + 7_200_000).toISOString(),
        every: "every weekday at 08:30",
      },
    ],
    events: [{ at: new Date(f.w.at - 60_000).toISOString(), text: "links is failing" }],
    recipes: [{ name: "daily-brief", task: 45, next: new Date(f.w.at + 7_200_000).toISOString() }],
  };
  f.issue({
    title: "Shipify status",
    body: `${STATUS_MARK}${JSON.stringify(record)} -->\nthe view`,
    labels: ["shipify-status"],
  });
  f.issue({ title: 'make it <script>alert("x")</script> faster', labels: ["needs you"] });
  return f;
}

const get = async (
  f: ReturnType<typeof world>,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) =>
  handle(new Request(`https://shipify.example.com${path}`, { method, headers }), envFor(k), f.deps);

describe("the status page", () => {
  it("shows everything to a signed-in you: what needs you first, apps, boxes, recipes, key dates", async () => {
    const f = setUp();
    const res = await get(f, "/admin/status", { "cf-access-jwt-assertion": await token(f.w.at) });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1 thing needs you");
    expect(html).toContain("links is failing");
    for (const id of [
      "needs-you",
      "apps",
      "boxes",
      "coming-up",
      "recipes",
      "recent",
      "upkeep",
      "notebook",
    ])
      expect(html).toContain(`id="${id}"`);
    expect(html).toContain("https://spotter.example.com");
    expect(html).toContain("daily-brief");
    expect(html).toContain("16 days left");
    // GitHub's words are shown as text, never as markup.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // Nothing a browser could run, frame or send; never kept by the browser or a proxy.
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("shows nothing without Access's token, or with one that's forged, for another app, or old", async () => {
    const f = setUp();
    const now = f.w.at;
    const other = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    for (const t of [
      undefined,
      "not.a.token",
      await token(now, {}, other.privateKey),
      await token(now, { aud: ["b".repeat(64)] }),
      await token(now, { iss: "https://evil.cloudflareaccess.com" }),
      await token(now, { exp: Math.floor(now / 1000) - 5 }),
    ]) {
      const res = await get(f, "/admin/status", t ? { "cf-access-jwt-assertion": t } : {});
      expect(res.status, String(t).slice(0, 20)).toBe(403);
      const html = await res.text();
      expect(html).toContain("Sign in through Cloudflare Access");
      expect(html).not.toContain("spotter");
    }
  });

  it("fetches Access's keys again for an unknown key at most once a minute", async () => {
    const f = setUp();
    const now = f.w.at;
    await get(f, "/admin/status", { "cf-access-jwt-assertion": await token(now) });
    const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "nope" })).toString("base64url");
    const [, body, sig] = (await token(now)).split(".");
    for (let i = 0; i < 3; i++)
      await get(f, "/admin/status", { "cf-access-jwt-assertion": `${head}.${body}.${sig}` });
    const certs = f.w.calls.filter((c) => c.includes("/cdn-cgi/access/certs"));
    expect(certs).toHaveLength(1);
  });

  it("isn't served before `ship door page` sets it up: it says how, and reads nothing else", async () => {
    const f = setUp();
    delete f.w.variables.SHIPIFY_ACCESS;
    const res = await get(f, "/admin/status", { "cf-access-jwt-assertion": await token(f.w.at) });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("pnpm ship door page");
    expect(f.gh().some((c) => c.includes("issues?labels=shipify-status"))).toBe(false);
  });

  it("only reads: anything but GET or HEAD gets 405", async () => {
    const f = setUp();
    const res = await get(
      f,
      "/admin/status",
      { "cf-access-jwt-assertion": await token(f.w.at) },
      "POST",
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("opens from the bare address, and leaves the door's routes as they were", async () => {
    const f = setUp();
    const root = await get(f, "/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/admin/chat/");
    const door = await get(f, "/door/telegram", {}, "POST");
    expect(door.status).toBe(401);
  });

  it("logs that it was served or refused, never who or what", async () => {
    const f = setUp();
    await get(f, "/admin/status");
    await get(f, "/admin/status", { "cf-access-jwt-assertion": await token(f.w.at) });
    const logs = f.w.logs.join("\n");
    expect(logs).toContain('"event":"page.refused"');
    expect(logs).toContain('"event":"page.served"');
    expect(logs).not.toContain("owner@example.com");
  });
});
