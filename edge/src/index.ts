// The Worker's entry (wrangler.jsonc's `main`): requests go to app.ts's routes, and the cron (every
// 5 minutes) runs the watch, then a step of the copy of KV's files (store.ts). The only file that
// names Workers' own types: everything else is plain web code, so tests run it in Node as it is.
import { handle } from "./app.ts";
import { defaultDeps, type Env } from "./env.ts";
import { moveFromKv } from "./store.ts";
import { tick } from "./watch.ts";

export default {
  fetch: (req, env, ctx) =>
    handle(req, env, { ...defaultDeps(), waitUntil: (work) => ctx.waitUntil(work) }),
  scheduled: (_controller, env, ctx) => {
    const deps = defaultDeps();
    ctx.waitUntil(tick(env, deps).finally(() => moveFromKv(env, deps)));
  },
} satisfies ExportedHandler<Env>;
