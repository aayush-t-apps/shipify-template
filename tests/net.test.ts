// A passing network blip doesn't fail a call (cli/lib/net.ts): one more try when no answer came
// back, never when one did, and for a send only when nothing went out.
import { describe, expect, it } from "vitest";
import { fetchAgain } from "../cli/lib/net.ts";

const blip = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
/** A fetch that throws or answers in turn, and counts its calls. */
const fake = (...steps: (Error | number)[]) => {
  let calls = 0;
  const f = (async () => {
    const step = steps[calls++];
    if (step instanceof Error) throw step;
    return new Response("x", { status: step ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls: () => calls };
};

describe("fetchAgain", () => {
  it("tries once more when no answer came back, a moment later", async () => {
    const t = fake(blip("ECONNRESET"), 200);
    const r = await fetchAgain("https://x", {}, { fetchImpl: t.f, waitMs: 1 });
    expect(r.status).toBe(200);
    expect(t.calls()).toBe(2);
  });

  it("never tries an answer again, even an error: it's what was said", async () => {
    const t = fake(500, 200);
    expect((await fetchAgain("https://x", {}, { fetchImpl: t.f, waitMs: 1 })).status).toBe(500);
    expect(t.calls()).toBe(1);
  });

  it("a send is tried again only when nothing went out (the connection itself failed)", async () => {
    const refused = fake(blip("ECONNREFUSED"), 200);
    const opts = { once: true, waitMs: 1 };
    expect((await fetchAgain("https://x", {}, { ...opts, fetchImpl: refused.f })).status).toBe(200);
    expect(refused.calls()).toBe(2);
    // Every address refused (IPv6, then IPv4): still nothing sent.
    const all = Object.assign(new TypeError("fetch failed"), {
      cause: { errors: [{ code: "ENETUNREACH" }, { code: "ECONNREFUSED" }] },
    });
    const both = fake(all, 200);
    expect((await fetchAgain("https://x", {}, { ...opts, fetchImpl: both.f })).status).toBe(200);
    // Reset mid-way: it may have gone out, so not twice.
    const reset = fake(blip("ECONNRESET"), 200);
    await expect(fetchAgain("https://x", {}, { ...opts, fetchImpl: reset.f })).rejects.toThrow();
    expect(reset.calls()).toBe(1);
  });

  it("fails when the second try fails too", async () => {
    const t = fake(blip("ECONNRESET"), blip("ECONNRESET"));
    await expect(fetchAgain("https://x", {}, { fetchImpl: t.f, waitMs: 1 })).rejects.toThrow();
    expect(t.calls()).toBe(2);
  });
});
