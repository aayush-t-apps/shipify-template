// App-owned: add this app's routes here. Platform behaviour (/health, logging, request ids,
// /.well-known/shipify.json, asset fallback) comes from src/shared/platform.ts.
import { createApp, type PlatformEnv } from "../shared/platform";
// #if OPTION_DO
import type { Counter } from "./objects";
// #endif

// #if !OPTIONS
export interface Env extends PlatformEnv {}
// #endif
// #if OPTIONS
export interface Env extends PlatformEnv {
  // #endif
  // #if OPTION_KV
  /** Key-value data (AGENTS.md, "Storage"). */
  KV: KVNamespace;
  // #endif
  // #if OPTION_D1
  /** The app's database; its tables come from migrations/ (AGENTS.md, "Storage"). */
  DB: D1Database;
  // #endif
  // #if OPTION_R2
  /** Files and objects; expiry rules are in r2-lifecycle.json (AGENTS.md, "Storage"). */
  R2: R2Bucket;
  // #endif
  // #if OPTION_DO
  /** Durable Objects of the class Counter, one per name (src/worker/objects/). */
  COUNTER: DurableObjectNamespace<Counter>;
  // #endif
  // #if OPTIONS
}
// #endif

export const app = createApp<Env>((a) => {
  a.get("/api/info", (c) => c.json({ app: c.env.APP_ID, env: c.env.APP_ENV }));
  // #if OPTION_DO
  a.post("/api/counter", async (c) =>
    c.json({ count: await c.env.COUNTER.getByName("main").increment() }),
  );
  // #endif
});
