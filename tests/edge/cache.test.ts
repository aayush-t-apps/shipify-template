// What the edge remembers a while (edge/src/cache.ts): a read kept for its time, a failure never.
import { afterEach, describe, expect, it } from "vitest";
import { cached, clearCaches } from "../../edge/src/cache.ts";

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
});
