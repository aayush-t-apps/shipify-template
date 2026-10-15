// The Worker's entry (wrangler.jsonc's `main`): requests go to app.ts's routes, and the cron (every
// 5 minutes) runs the watch. The only file that names Workers' own types: everything else is plain
// web code, so tests run it in Node as it is.
import { handle } from "./app.ts";
import { defaultDeps, type Env } from "./env.ts";
import { tick } from "./watch.ts";

export default {
  fetch: (req, env) => handle(req, env, defaultDeps()),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(tick(env, defaultDeps()).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
