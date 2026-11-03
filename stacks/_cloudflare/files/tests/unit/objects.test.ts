// #if OPTION_DO
// App-owned: tests for this app's Durable Objects (src/worker/objects/), through its whole Worker
// as `wrangler dev` runs it, empty on each run.
import { afterAll, describe, expect, it } from "vitest";
import { localWorker } from "./support/worker";

const worker = await localWorker();
afterAll(() => worker.dispose());

describe("Durable Objects: Counter", () => {
  it("counts in its own storage", async () => {
    const next = async () => (await worker.fetch("/api/counter", { method: "POST" })).json();
    expect(await next()).toEqual({ count: 1 });
    expect(await next()).toEqual({ count: 2 });
  });
});
// #endif
