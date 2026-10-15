// Web Push (ADR 0050): one notification to one device, by the standards alone. The message is
// RFC 8030's, encrypted end to end as RFC 8291 says (aes128gcm), and signed as the sender by
// VAPID (RFC 8292), all on WebCrypto, with no dependency. It knows nothing of Shipify: a chat read
// in place (channels/web.ts) says what a notification says, and keeps the devices. Its key is a
// P-256 private key as a JWK, its public half inside (`WEB_PUSH_KEY`, made by `ship add webchat`).
// Plain web code: no Workers types, and no import.

/** A device that takes notifications: a browser's subscription, checked (deviceOf). */
export interface Device {
  endpoint: string;
  /** Its public key (P-256, uncompressed), base64url. */
  p256dh: string;
  /** Its authentication secret (16 bytes), base64url. */
  auth: string;
}

/**
 * What a notification says: the Push API's declarative message, which a browser that knows it
 * shows itself, and a service worker shows elsewhere.
 */
export interface Note {
  web_push: 8030;
  notification: {
    title: string;
    body?: string;
    /** Where a tap goes: an https address. */
    navigate: string;
    /** One per tag: a newer one replaces the older (and, said once more, the push service's Topic). */
    tag: string;
    renotify?: boolean;
    lang?: string;
  };
}

/** The outside world it needs: the edge's Deps fits it. */
export interface Net {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
}

/**
 * How one notification went: taken, the device is gone (drop it), or not taken; and why, for the
 * log: the push service's status ("201", "403"), or what stopped it without one.
 */
export interface Rung {
  rung: "ok" | "gone" | "failed";
  why: string;
}

/** The push services a device may be on, by their hosts: an address anywhere else is refused. */
const SERVICES: [string, RegExp][] = [
  ["Google", /^fcm\.googleapis\.com$/],
  ["Apple", /^(?:[a-z0-9-]+\.)*push\.apple\.com$/],
  ["Mozilla", /^updates\.push\.services\.mozilla\.com$/],
  ["Microsoft", /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/],
];
const MOST_ADDRESS = 2_000;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
/** A push service takes a body of 4,096 bytes; the record's head and tag take 86 and 17. */
const MOST_PLAIN = 4_096 - 86 - 17;
/** A message waits a day for a device that's off; a signature is good for 12 hours. */
const TTL_S = 86_400;
const SIGNED_S = 12 * 3_600;

const text = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s));
const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function unb64u(s: string): Uint8Array<ArrayBuffer> | undefined {
  if (!B64URL.test(s)) return undefined;
  try {
    return Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Which company's push service an address is on, or undefined for anywhere else. */
export function serviceOf(endpoint: string): string | undefined {
  if (endpoint.length > MOST_ADDRESS) return undefined;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return undefined;
    return SERVICES.find(([, host]) => host.test(u.hostname))?.[0];
  } catch {
    return undefined;
  }
}

/**
 * What the page sends (a PushSubscription's JSON), when it's an https address on a known push
 * service with keys of the right size; else undefined.
 */
export function deviceOf(v: unknown): Device | undefined {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  const keys =
    o?.keys && typeof o.keys === "object" ? (o.keys as Record<string, unknown>) : undefined;
  const { endpoint } = o ?? {};
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string")
    return undefined;
  const point = unb64u(p256dh);
  if (!serviceOf(endpoint) || point?.length !== 65 || point[0] !== 4) return undefined;
  if (unb64u(auth)?.length !== 16) return undefined;
  return { endpoint, p256dh, auth };
}

type Jwk = { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };

function jwkOf(key: string): Jwk | undefined {
  try {
    const k = JSON.parse(key) as Record<string, unknown>;
    const ok = (v: unknown, bytes: number) => typeof v === "string" && unb64u(v)?.length === bytes;
    if (k.kty !== "EC" || k.crv !== "P-256" || !ok(k.x, 32) || !ok(k.y, 32) || !ok(k.d, 32))
      return undefined;
    return { kty: "EC", crv: "P-256", x: k.x as string, y: k.y as string, d: k.d as string };
  } catch {
    return undefined;
  }
}

/** The key's public half, base64url (65 bytes, uncompressed): the page subscribes with it. */
export function publicKey(key: string): string | undefined {
  const k = jwkOf(key);
  const x = k && unb64u(k.x);
  const y = k && unb64u(k.y);
  return x && y ? b64u(join(Uint8Array.of(4), x, y)) : undefined;
}

// Each signature, kept in the Worker's memory while it's good for an hour more: by key, push
// service and subject.
const signed = new Map<string, { jwt: string; until: number }>();

/** VAPID's JWT for one push service (`aud`, its origin), signed with ES256. */
async function vapid(k: Jwk, subject: string, aud: string, now: number): Promise<string> {
  const id = `${k.x}|${aud}|${subject}`;
  const hit = signed.get(id);
  if (hit && hit.until > now) return hit.jwt;
  const key = await crypto.subtle.importKey(
    "jwk",
    k,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const part = (o: unknown) => b64u(text(JSON.stringify(o)));
  const exp = Math.floor(now / 1000) + SIGNED_S;
  const signing = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud, exp, sub: subject })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text(signing));
  const jwt = `${signing}.${b64u(new Uint8Array(sig))}`;
  signed.set(id, { jwt, until: now + (SIGNED_S - 3_600) * 1000 });
  return jwt;
}

/** HKDF-SHA-256 (RFC 5869): `bytes` from `ikm`, with its salt and info. */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  // As `{ name }`: WebCrypto's types for its parameters differ between Node and Workers.
  const params = { name: "HKDF", hash: "SHA-256", salt, info } as { name: string };
  return new Uint8Array(await crypto.subtle.deriveBits(params, key, bytes * 8));
}

/**
 * RFC 8291: `plain` for one device, as one aes128gcm record (RFC 8188), with a one-time key pair
 * and salt (a test gives its own, to check the RFC's example). Undefined for keys that don't read.
 */
export async function encrypt(
  device: Device,
  plain: Uint8Array,
  once?: { salt: Uint8Array<ArrayBuffer>; keys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const ua = unb64u(device.p256dh);
  const auth = unb64u(device.auth);
  if (!ua || !auth) return undefined;
  const p256 = { name: "ECDH", namedCurve: "P-256" };
  const keys =
    once?.keys ?? ((await crypto.subtle.generateKey(p256, true, ["deriveBits"])) as CryptoKeyPair);
  const salt = once?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const as = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
  const them = await crypto.subtle.importKey("raw", ua, p256, false, []);
  const ecdh = { name: "ECDH", public: them } as { name: string };
  const secret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, keys.privateKey, 256));
  const ikm = await hkdf(auth, secret, join(text("WebPush: info\0"), ua, as), 32);
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // The last record's delimiter (2), and no padding.
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aes,
    join(plain, Uint8Array.of(2)),
  );
  // The head: the salt, the record's size (4096), and the one-time public key.
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = as.length;
  return join(head, as, new Uint8Array(sealed));
}

/**
 * One notification to one device: `ok`, `gone` (404 or 410: drop it) or `failed` (anything else, a
 * device or key that doesn't read, or no answer in 5 s), with why. It never throws and never tries
 * again. `subject` is who sends it, for the push service: an https address or a mailto.
 */
export async function ring(
  net: Net,
  key: string,
  subject: string,
  device: Device,
  note: Note,
): Promise<Rung> {
  const failed = (why: string): Rung => ({ rung: "failed", why });
  try {
    const k = jwkOf(key);
    const plain = text(JSON.stringify(note));
    if (!k) return failed("the key doesn't read");
    if (!serviceOf(device.endpoint)) return failed("not a known push service");
    if (plain.length > MOST_PLAIN) return failed("the note is too long");
    const [jwt, body] = await Promise.all([
      vapid(k, subject, new URL(device.endpoint).origin, net.now()),
      encrypt(device, plain),
    ]);
    if (!body) return failed("the device's keys don't read");
    const tag = note.notification.tag;
    const res = await net.fetch(device.endpoint, {
      method: "POST",
      headers: {
        authorization: `vapid t=${jwt}, k=${publicKey(key)}`,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_S),
        // Each is a reply you asked for: a dozing phone holds a normal one back.
        urgency: "high",
        // A newer one for the same tag replaces one not yet delivered.
        ...(/^[A-Za-z0-9_-]{1,32}$/.test(tag) ? { topic: tag } : {}),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    await res.body?.cancel().catch(() => {});
    const why = String(res.status);
    if (res.ok) return { rung: "ok", why };
    return { rung: res.status === 404 || res.status === 410 ? "gone" : "failed", why };
  } catch (e) {
    const err = e as Error;
    return failed(
      err?.name === "TimeoutError"
        ? "no answer in 5 s"
        : String(err?.message ?? e).slice(0, 100) || "fetch failed",
    );
  }
}
