// What the edge remembers a while (edge/src/cache.ts): a read kept for its time, a failure never.
import { afterEach, describe, expect, it } from "vitest";
import { cached, clearCaches, recall, remember, stale } from "../../edge/src/cache.ts";

afterEach(clearCaches);

describe("cached", () => {
  it("keeps a read for its time, and never a failure", async () => {
    let reads = 0;
    const read = async () => ++reads;
    expect(await cached("k", 1000, read, 0)).toBe(1);
    expect(await cached("k", 1000, read, 500)).toBe(1);
    // Past its time, read again.
    expect(await cached("k", 1000, read, 2000)).toBe(2);
    await expect(cached("bad", 1000, () => Promise.reject(new Error("x")), 0)).rejects.toThrow();
    await expect(cached("bad", 1000, async () => 7, 0)).resolves.toBe(7);
  });

  it("keeps 200 at most: the oldest go first, the last good copies too", async () => {
    let reads = 0;
    const read = async () => ++reads;
    await cached("first", 60_000, read, 0);
    for (let i = 0; i < 200; i++) await cached(`k${i}`, 60_000, read, 0);
    expect(reads).toBe(201);
    expect(stale("first")).toBeUndefined();
    expect(stale("k0")).toBe(2);
    // Gone, so read again; the newest are still kept.
    expect(await cached("first", 60_000, read, 1)).toBe(202);
    expect(await cached("k199", 60_000, read, 1)).toBe(201);
  });

  it("drops what's past its time as it's read, and before anything fresh", () => {
    const full = () => {
      clearCaches();
      remember("old", 1, 60_000, 0);
      remember("brief", 2, 10, 0);
      for (let i = 0; i < 198; i++) remember(`k${i}`, i, 60_000, 0);
    };
    // Read past its time: dropped, so the next one in doesn't push the oldest fresh one out.
    full();
    expect(recall("brief", 100)).toBeUndefined();
    remember("new", 3, 60_000, 100);
    expect(recall("old", 100)).toBe(1);
    // Not read: still, what's past its time goes before anything fresh.
    full();
    remember("new", 3, 60_000, 100);
    expect(recall("old", 100)).toBe(1);
    expect(recall("new", 100)).toBe(3);
  });
});
