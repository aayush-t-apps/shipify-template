// Web Push (edge/src/push.ts, ADR 0050): RFC 8291's own example, byte for byte; the sender's
// signature (VAPID, RFC 8292) checks out with the public key the page subscribes with; only
// devices on the known push services; and what each answer means.
import { describe, expect, it } from "vitest";
import {
  type Device,
  deviceOf,
  encrypt,
  type Net,
  type Note,
  publicKey,
  ring,
  serviceOf,
} from "../../edge/src/push.ts";
import { browser, pushKey, pushService } from "./browser.ts";

const bytes = (s: string) => new Uint8Array(Buffer.from(s.replace(/\s+/g, ""), "base64url"));
const NOW = Date.parse("2026-10-10T12:00:00Z");
const SUBJECT = "https://shipify.example.com";

const note: Note = {
  web_push: 8030,
  notification: {
    title: "Done · #321",
    body: "Get me homepi box health",
    navigate: "https://shipify.example.com/admin/chat/#/t/321",
    tag: "t321",
    renotify: true,
    lang: "en",
  },
};

describe("encrypt (RFC 8291)", () => {
  it("makes Appendix A's message byte for byte, given its salt and one-time key", async () => {
    // RFC 8291, section 5 and Appendix A.
    const asPublic = bytes(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    );
    const p256 = { name: "ECDH", namedCurve: "P-256" };
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
        x: Buffer.from(asPublic.slice(1, 33)).toString("base64url"),
        y: Buffer.from(asPublic.slice(33)).toString("base64url"),
      },
      p256,
      false,
      ["deriveBits"],
    );
    const publicKey = await crypto.subtle.importKey("raw", asPublic, p256, true, []);
    const device: Device = {
      endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
      p256dh:
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg", // gitleaks:allow: RFC 8291's published example
    };
    const body = await encrypt(
      device,
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        salt: bytes("DGv6ra1nlYgDCS1FRnbzlw"),
        keys: { privateKey, publicKey },
      },
    );
    expect(Buffer.from(body ?? []).toString("base64url")).toBe(
      `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
       mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
       pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`.replace(/\s+/g, ""),
    );
  });

  it("uses a new key and salt each time, and the device reads it", async () => {
    const b = await browser();
    const d = deviceOf(b.subscription) as Device;
    const plain = new TextEncoder().encode("hello");
    const [one, two] = await Promise.all([encrypt(d, plain), encrypt(d, plain)]);
    expect(Buffer.from(one ?? []).equals(Buffer.from(two ?? []))).toBe(false);
    expect(await b.read(one as Uint8Array)).toBe("hello");
  });
});

describe("deviceOf", () => {
  it("takes a subscription on each known push service", async () => {
    for (const [endpoint, service] of [
      ["https://fcm.googleapis.com/fcm/send/abc", "Google"],
      ["https://web.push.apple.com/QGx", "Apple"],
      ["https://updates.push.services.mozilla.com/wpush/v2/gAAA", "Mozilla"],
      ["https://wns2-par02p.notify.windows.com/w/?token=BQYA", "Microsoft"],
    ] as const) {
      const b = await browser(endpoint);
      expect(deviceOf(b.subscription), endpoint).toEqual({
        endpoint,
        p256dh: b.subscription.keys.p256dh,
        auth: b.subscription.keys.auth,
      });
      expect(serviceOf(endpoint)).toBe(service);
    }
  });

  it("refuses http, another host, keys of the wrong size, a long address and what isn't one", async () => {
    const b = await browser();
    const sub = (over: Record<string, unknown> = {}, keys: Record<string, unknown> = {}) => ({
      ...b.subscription,
      ...over,
      keys: { ...b.subscription.keys, ...keys },
    });
    for (const bad of [
      sub({ endpoint: "http://fcm.googleapis.com/fcm/send/abc" }),
      sub({ endpoint: "https://evil.example.com/fcm/send/abc" }),
      sub({ endpoint: "https://fcm.googleapis.com.evil.example.com/x" }),
      sub({ endpoint: "https://fcm.googleapis.com:8443/fcm/send/abc" }),
      sub({ endpoint: "https://user:pw@fcm.googleapis.com/fcm/send/abc" }),
      sub({ endpoint: `https://fcm.googleapis.com/fcm/send/${"a".repeat(2_000)}` }),
      sub({}, { p256dh: b.subscription.keys.p256dh.slice(0, 40) }),
      sub({}, { auth: "AAAA" }),
      sub({}, { auth: "not base64 at all!" }),
      sub({}, { p256dh: 5 }),
      { endpoint: b.subscription.endpoint },
      "https://fcm.googleapis.com/fcm/send/abc",
      null,
    ])
      expect(deviceOf(bad), JSON.stringify(bad)?.slice(0, 80)).toBeUndefined();
  });
});

describe("publicKey", () => {
  it("is the key's public half, 65 bytes; a key that doesn't read has none", () => {
    const key = pushKey();
    const pub = bytes(publicKey(key) ?? "");
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(4);
    for (const bad of ["", "{}", "not json", JSON.stringify({ kty: "RSA" })])
      expect(publicKey(bad)).toBeUndefined();
  });
});

describe("ring", () => {
  const setUp = async (status = 201) => {
    const service = pushService(status);
    const b = await browser();
    const net: Net = {
      now: () => NOW,
      fetch: async (input, init) =>
        (await service.take(input, init)) ?? new Response(null, { status: 599 }),
    };
    return { service, b, net, device: deviceOf(b.subscription) as Device };
  };

  it("sends the note encrypted, signed with the key, with its TTL, urgency and topic", async () => {
    const t = await setUp();
    const key = pushKey();
    expect(await ring(t.net, key, SUBJECT, t.device, note)).toEqual({ rung: "ok", why: "201" });
    const [got] = t.service.got;
    expect(got?.url).toBe(t.device.endpoint);
    expect(got?.headers.get("ttl")).toBe("86400");
    expect(got?.headers.get("urgency")).toBe("high");
    expect(got?.headers.get("topic")).toBe("t321");
    expect(got?.headers.get("content-encoding")).toBe("aes128gcm");
    expect(JSON.parse(await t.b.read(got?.body as Uint8Array))).toEqual(note);
    // VAPID: the JWT checks out with the public key, for this push service, within a day.
    const [, jwt, k] =
      /^vapid t=([^,]+), k=(.+)$/.exec(got?.headers.get("authorization") ?? "") ?? [];
    expect(k).toBe(publicKey(key));
    const [head, claims, sig] = (jwt ?? "").split(".");
    expect(JSON.parse(Buffer.from(head ?? "", "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const c = JSON.parse(Buffer.from(claims ?? "", "base64url").toString());
    expect(c.aud).toBe("https://fcm.googleapis.com");
    expect(c.sub).toBe(SUBJECT);
    expect(c.exp * 1000).toBeGreaterThan(NOW);
    expect(c.exp * 1000).toBeLessThanOrEqual(NOW + 86_400_000);
    const signer = await crypto.subtle.importKey(
      "raw",
      bytes(k ?? ""),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        signer,
        bytes(sig ?? ""),
        new TextEncoder().encode(`${head}.${claims}`),
      ),
    ).toBe(true);
    // The signature is kept: the next one to this push service carries the same.
    await ring(t.net, key, SUBJECT, t.device, note);
    expect(t.service.got[1]?.headers.get("authorization")).toBe(got?.headers.get("authorization"));
  });

  it("says what the push service's answer means, with its status: gone for 404 and 410, failed for the rest", async () => {
    const key = pushKey();
    for (const [status, rung] of [
      [201, "ok"],
      [404, "gone"],
      [410, "gone"],
      [403, "failed"],
      [413, "failed"],
      [429, "failed"],
      [500, "failed"],
    ] as const) {
      const t = await setUp(status);
      expect(await ring(t.net, key, SUBJECT, t.device, note), String(status)).toEqual({
        rung,
        why: String(status),
      });
    }
  });

  it("never throws: no answer, a key or device that doesn't read, or a note too long are failed, each saying why", async () => {
    const t = await setUp();
    const key = pushKey();
    const silent: Net = {
      now: () => NOW,
      fetch: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    };
    const failed = (why: string) => ({ rung: "failed", why });
    expect(await ring(silent, key, SUBJECT, t.device, note)).toEqual(failed("no answer in 5 s"));
    expect(await ring(t.net, "not a key", SUBJECT, t.device, note)).toEqual(
      failed("the key doesn't read"),
    );
    expect(
      await ring(
        t.net,
        key,
        SUBJECT,
        { ...t.device, endpoint: "https://evil.example.com/x" },
        note,
      ),
    ).toEqual(failed("not a known push service"));
    // WebCrypto's own words for a key it can't take.
    expect(await ring(t.net, key, SUBJECT, { ...t.device, p256dh: "AAAA" }, note)).toEqual(
      failed("Invalid keyData"),
    );
    const long = { ...note, notification: { ...note.notification, body: "x".repeat(5_000) } };
    expect(await ring(t.net, key, SUBJECT, t.device, long)).toEqual(failed("the note is too long"));
    expect(t.service.got).toEqual([]);
  });
});
