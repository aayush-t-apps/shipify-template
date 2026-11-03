// #if OPTION_DO
// Stack-owned (Shipify; replaced by `ship upgrade`): the app's whole Worker in unit tests, as
// `wrangler dev` runs it from wrangler.jsonc (AGENTS.md, "Storage"): its routes and its Durable
// Objects, with SQLite and WebSockets, in memory so every run starts empty. The code runs in
// workerd, not Node, so the coverage count leaves src/worker/objects/ out.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_startWorker } from "wrangler";

export async function localWorker(): Promise<{
  /** A request to the Worker: a path ("/api/counter"), and what fetch takes. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Its local address, for a WebSocket (`ws:` + url.host). */
  url: URL;
  dispose: () => Promise<void>;
}> {
  // No static files: these tests are of the Worker, and the unit tests run before the build.
  const assets = mkdtempSync(join(tmpdir(), "assets-"));
  const worker = await unstable_startWorker({
    config: "wrangler.jsonc",
    assets,
    dev: { persist: false, remote: false, inspector: false, watch: false, logLevel: "warn" },
  });
  // Ready means built and serving: a request before then waits on the first build.
  await worker.ready;
  const url = await worker.url;
  return {
    fetch: (path, init) => fetch(new URL(path, url), init),
    url,
    dispose: async () => {
      await worker.dispose();
      rmSync(assets, { recursive: true, force: true });
    },
  };
}
// #endif
