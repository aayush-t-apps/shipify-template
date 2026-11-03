# Storage for a Cloudflare app: KV, D1, R2 and Durable Objects (ADR 0022, 0067, 0068)

Stack-side, read from shipify (not copied into projects). The ts-worker and ts-static stacks offer
four options, on Cloudflare's free plan (R2 asks for a card on the account once; nothing is charged
inside its limits):

| Option | Binding | For | Free plan |
|---|---|---|---|
| `kv` | `env.KV` (`KVNamespace`) | key-value data with quick reads: settings, a cache, small records | 100,000 reads and 1,000 writes a day, 1 GB |
| `d1` | `env.DB` (`D1Database`) | SQL tables: records you query, sort or join | 10 databases per account (production and staging count apart), 500 MB each, 5 million rows read and 100,000 written a day |
| `r2` | `env.R2` (`R2Bucket`) | files and other objects, with expiry by prefix | 10 GB, 1 million writes and 10 million reads a month |
| `do` | `env.COUNTER` (`DurableObjectNamespace`), a starter to rename | live state and WebSockets: one object per room, chat or counter, each with its own SQLite | 100,000 requests and 13,000 GB-s a day, 5 GB stored; SQLite only; no PR previews |

Over a daily limit, calls fail until 00:00 UTC. Pick the smaller one that does the job; an app can
have all four.

## A new app

The plan's front matter says `options: [kv]`, `[d1]`, `[r2]`, `[do]` or a mix, and its `### Data`
section says what's kept and why. `ship build` (or `ship new --options kv,d1,r2,do`) then adds the
bindings to `wrangler.jsonc` (and staging's), their types to `src/worker/app.ts`, a first migration
for D1, a starter class `Counter` for Durable Objects, and tests that use them.

## Adding it to an app that has none

It's data, so it's the big lane (`playbooks/task.md`): a change doc first, merged by the owner, then
the build. The build, in the app's checkout:

1. `shipify.json`: `"options": ["kv"]` (or `"d1"`, or both). It records the choice; upgrades read it.
2. `wrangler.jsonc`, at the top level, and the same inside `env.staging` when the app has staging:
   - KV: `"kv_namespaces": [{ "binding": "KV" }],`
   - D1: `"d1_databases": [{ "binding": "DB", "database_name": "<worker>-db" }],` (staging's is
     `<worker>-staging-db`).
   - R2: `"r2_buckets": [{ "binding": "R2", "bucket_name": "<worker>-r2" }],` (staging's is
     `<worker>-staging-r2`), and `r2-lifecycle.json`, `{}` at first.
   No ids: a deploy finds each by its name, or makes it.
3. `src/worker/app.ts`: `KV: KVNamespace;`, `DB: D1Database;` and `R2: R2Bucket;` in `interface Env`.
4. D1: `migrations/0001_init.sql`, the first tables.
5. Tests: `tests/unit/support/bindings.ts` (stack-owned) gives real local storage, empty on each run:
   ```ts
   const local = await localBindings<Env>();
   const env: Env = { ...local.env, APP_ID: "x", APP_ENV: "test", GIT_SHA: "abc1234" };
   beforeAll(() => local.ready); // D1's migrations
   afterAll(() => local.dispose());
   ```
6. The owner's Cloudflare deploy token (`CF_DEPLOY_TOKEN`) needs **Workers KV Storage: Edit**,
   **D1: Edit** and **Workers R2 Storage: Edit**, once for every app (docs/setup.md). Without them
   the deploy stops and says so. Durable Objects need nothing more than **Workers Scripts: Edit**.

Durable Objects (`do`) are code in the app's Worker, so they add files of their own:

1. `shipify.json`: `"do"` in `"options"`.
2. `wrangler.jsonc`, top level: `"durable_objects": { "bindings": [{ "name": "COUNTER",
   "class_name": "Counter" }] },` and `"exports": { "Counter": { "type": "durable-object",
   "storage": "sqlite" } },`. Inside `env.staging`, the bindings again (they aren't inherited);
   staging inherits `exports`.
3. `src/worker/objects/counter.ts` (`class Counter extends DurableObject<Env>`, from
   `cloudflare:workers`) and `src/worker/objects/index.ts` (`export { Counter } from "./counter";`).
4. `src/worker/index.ts` (stack-owned): `export * from "./objects";` at the end. `ship upgrade`
   writes it once `shipify.json` has the option.
5. `src/worker/app.ts`: `COUNTER: DurableObjectNamespace<Counter>;` in `interface Env`, and a route.
6. Tests: `tests/unit/support/worker.ts` (stack-owned, `localWorker()`), a test like
   `tests/unit/objects.test.ts`, and `"src/worker/objects/**"` in `vitest.config.ts`'s coverage
   `exclude`.
7. The PR that adds it says the app gets no PR previews from then on.

## Lifecycle rules (R2)

`r2-lifecycle.json` is app-owned: a map of prefix to whole days, like `{"tmp/": 7, "exports/": 30}`.
It is the whole set. Each deploy replaces the bucket's rules with it (one rule per prefix), so a
removed line removes the rule. An absent file leaves the rules alone. An empty prefix or days below
1 stop the deploy before anything changes. Cloudflare removes old objects on its next pass, up to a
day late: lifecycle is a clean-up, not an exact time. If R2 isn't turned on for the account, the
deploy says so: turn it on once in the dashboard (it asks for a card), then re-run.

## Durable Objects

- **Declared in `exports`** (wrangler 4.107 or later), never in the legacy `migrations`: the two
  can't be mixed, and a Worker that moved to `exports` can't go back. `wrangler deploy` compares
  `exports` with what is deployed and makes each new class's namespace; nothing to set up.
  Cloudflare itself refuses a deploy where the code and `exports` disagree, or a class has gone
  from both without a tombstone.
- **Classes only add.** A deploy stops before any change on an entry whose `state` is `deleted`,
  `renamed` or `transferred`, on `storage` other than `"sqlite"`, and on a `migrations` array.
  Deleting a class deletes its data, and a rollback can't cross the change. A class the app no
  longer uses stays exported: an object nobody calls costs nothing. Rename or delete one only as a
  change of its own, by hand, if ever.
- **WebSockets close on each deploy** (and rollback): every object restarts. Clients reconnect by
  themselves, with backoff, and the object keeps what it needs in its storage, not only in memory.
  Use the hibernation API (`ctx.acceptWebSocket`), so a quiet room sleeps and bills no duration.
- **No PR previews.** Cloudflare makes no version URLs for a Worker that has Durable Objects, and
  `wrangler versions upload` refuses `exports`. The preview step says so and stops; review with
  `make dev`, then on staging after the merge.
- **Rollbacks:** Cloudflare refuses one across a change to the classes, and the step shows its
  message. Roll forward instead: a fix, as a new PR.
- **Tests:** `localWorker()` starts the whole Worker with wrangler's `unstable_startWorker`, in
  memory. That code runs in workerd, so Node's coverage leaves `src/worker/objects/` out: logic that
  needs branch tests goes in plain modules beside it.

## Migrations (D1)

- One file per change, `migrations/NNNN_<what>.sql`, numbered in order. Never edit one that has
  shipped: add the next.
- **They only add:** a table, a column that may be empty or has a default, an index. A rollback
  runs the old code on the new tables, so it must still work there. Drop or rename only in a later
  release, once no version that could be rolled back to reads the old shape.
- Where they run: before each deploy (production, or staging's own database), locally before
  `make dev` and the browser tests (`cloudflare.mjs local`), and in the unit tests. Wrangler keeps
  the list of what ran (`d1_migrations`), so each runs once.
- A PR's preview runs on staging's data without the PR's new migrations: they run when it merges.
- D1 keeps 7 days of history (Time Travel) on the free plan: a bad change can be undone there.

## What deploys do

`scripts/shipify/cloudflare.mjs`:
- **deploy:** finds the Worker's KV namespace (named `<worker>-kv`, wrangler's own name for it)
  and D1 database (its `database_name`), makes any that's missing, applies the migrations, then
  deploys with the ids filled in (a copy of `wrangler.jsonc`, deleted after). An R2 bucket has a
  name, no id: the deploy makes it when missing and sets its lifecycle rules. The same on every
  deploy, from any checkout. Durable Object classes are checked first (they only add), then
  `wrangler deploy` applies `exports`.
- **preview:** with staging, a version of the staging Worker on staging's storage. Without staging,
  an app that keeps data (KV, D1 or R2) gets no preview, since it would use production's data. Turn staging on
  for previews: `pnpm ship staging <id> on`. An app with Durable Objects gets none, with staging or
  without.
- **rollback:** code only; the data stays (hence migrations that only add). Not across a new
  Durable Object class.
- **pause / resume:** the URLs only; the data stays.

Locally, `wrangler dev` and the tests use local copies in `.wrangler/state` (git ignores it), never
Cloudflare's.
