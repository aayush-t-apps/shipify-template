// A browser that takes notifications, for the edge's tests (ADR 0050): its subscription on a push
// service, as the page sends it, and what it reads from a push, decrypted as RFC 8291 says. And a
// key like the one `ship add webchat` makes (WEB_PUSH_KEY).
import { generateKeyPairSync } from "node:crypto";

const b64u = (b: ArrayBuffer | Uint8Array) =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
const text = (s: string) => new TextEncoder().encode(s);

/** A WEB_PUSH_KEY: a P-256 private key as a JWK, as `ship add webchat` makes it. */
export const pushKey = () =>
  JSON.stringify(
    generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
  );

type Bytes = Uint8Array<ArrayBuffer>;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

/** A browser subscribed at `endpoint`: its subscription's JSON, and a push's words, read. */
export async function browser(endpoint = "https://fcm.googleapis.com/fcm/send/abc123") {
  const p256 = { name: "ECDH", namedCurve: "P-256" };
  const keys = (await crypto.subtle.generateKey(p256, true, ["deriveBits"])) as CryptoKeyPair;
  const ua = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    subscription: { endpoint, expirationTime: null, keys: { p256dh: b64u(ua), auth: b64u(auth) } },
    /** A push's body, decrypted: its words. */
    async read(sent: Uint8Array): Promise<string> {
      const body: Bytes = new Uint8Array(sent);
      const salt = body.slice(0, 16);
      const idlen = body[20] ?? 0;
      const as = body.slice(21, 21 + idlen);
      const them = await crypto.subtle.importKey("raw", as, p256, false, []);
      const secret = new Uint8Array(
        await crypto.subtle.deriveBits({ name: "ECDH", public: them }, keys.privateKey, 256),
      );
      const ikm = await hkdf(
        auth,
        secret,
        new Uint8Array([...text("WebPush: info\0"), ...ua, ...as]),
        32,
      );
      const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
      const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body.slice(21 + idlen)),
      );
      // The last record ends with its delimiter (2), after any padding.
      const end = plain.lastIndexOf(2);
      return new TextDecoder().decode(plain.slice(0, end));
    },
  };
}

/** A push service in a test: each request, and the status it answers. */
export function pushService(status = 201) {
  const got: { url: string; headers: Headers; body: Uint8Array }[] = [];
  const s = {
    status,
    got,
    /** Answers a push at a push service's address, or undefined for any other. */
    async take(input: string, init: RequestInit = {}): Promise<Response | undefined> {
      if (
        !/^https:\/\/(?:fcm\.googleapis\.com|[\w.-]*push\.apple\.com|updates\.push\.services\.mozilla\.com|[\w.-]*notify\.windows\.com)\//.test(
          input,
        )
      )
        return undefined;
      got.push({
        url: input,
        headers: new Headers(init.headers),
        body: new Uint8Array(init.body as Uint8Array),
      });
      return new Response(null, { status: s.status });
    },
  };
  return s;
}
