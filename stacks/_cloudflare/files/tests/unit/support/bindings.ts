// Stack-owned (Shipify; replaced by `ship upgrade`): the app's storage in unit tests (AGENTS.md,
// "Storage"). The same local KV and D1 that `wrangler dev` runs, from wrangler.jsonc's bindings,
// in memory so every run starts empty, with each migrations/*.sql applied in order to DB.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

export async function localBindings<B extends object>(): Promise<{
  env: B;
  ready: Promise<void>;
  dispose: () => Promise<void>;
}> {
  const proxy = await getPlatformProxy<B>({ persist: false, remoteBindings: false });
  const db = (proxy.env as { DB?: D1Database }).DB;
  const migrate = async () => {
    if (!db || !existsSync("migrations")) return;
    for (const file of readdirSync("migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = unstable_splitSqlQuery(readFileSync(join("migrations", file), "utf8"));
      if (sql.length) await db.batch(sql.map((s) => db.prepare(s)));
    }
  };
  return { env: proxy.env, ready: migrate(), dispose: proxy.dispose };
}
