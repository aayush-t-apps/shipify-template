// Platform-owned Worker entry. Keep this file to a default export only: the Workers runtime treats
// every named export of the entry module as an entrypoint. App code lives in ./app.ts: its `app`
// answers requests, and its `scheduled`, when it exports one, runs on the cron triggers in
// wrangler.jsonc.
import * as entry from "./app";

type Scheduled = ExportedHandlerScheduledHandler<entry.Env>;
const { scheduled } = entry as unknown as { scheduled?: Scheduled };

export default {
  fetch: entry.app.fetch,
  ...(scheduled ? { scheduled } : {}),
} satisfies ExportedHandler<entry.Env>;
