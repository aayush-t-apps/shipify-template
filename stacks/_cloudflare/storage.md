# Storage for a Cloudflare app: KV, D1 and R2 (ADR 0022, 0067)

Stack-side, read from shipify (not copied into projects). The ts-worker and ts-static stacks offer
three options, on Cloudflare's free plan (R2 asks for a card on the account once; nothing is charged
inside its limits):

| Option | Binding | For | Free plan |
|---|---|---|---|
| `kv` | `env.KV` (`KVNamespace`) | key-value data with quick reads: settings, a cache, small records | 100,000 reads and 1,000 writes a day, 1 GB |
| `d1` | `env.DB` (`D1Database`) | SQL tables: records you query, sort or join | 10 databases per account (production and staging count apart), 500 MB each, 5 million rows read and 100,000 written a day |
| `r2` | `env.R2` (`R2Bucket`) | files and other objects, with expiry by prefix | 10 GB, 1 million writes and 10 million reads a month |

Over a daily limit, calls fail until 00:00 UTC. Pick the smaller one that does the job; an app can
have all three.

## A new app

The plan's front matter says `options: [kv]`, `[d1]`, `[r2]` or a mix, and its `### Data` section says
what's kept and why. `ship build` (or `ship new --options kv,d1,r2`) then adds the bindings to
`wrangler.jsonc` (and staging's), their types to `src/worker/app.ts`, a first migration for D1, and
tests that use them.

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
   the deploy stops and says so.

## Lifecycle rules (R2)

`r2-lifecycle.json` is app-owned: a map of prefix to whole days, like `{"tmp/": 7, "exports/": 30}`.
It is the whole set. Each deploy replaces the bucket's rules with it (one rule per prefix), so a
removed line removes the rule. An absent file leaves the rules alone. An empty prefix or days below
1 stop the deploy before anything changes. Cloudflare removes old objects on its next pass, up to a
day late: lifecycle is a clean-up, not an exact time. If R2 isn't turned on for the account, the
deploy says so: turn it on once in the dashboard (it asks for a card), then re-run.

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
  deploy, from any checkout.
- **preview:** with staging, a version of the staging Worker on staging's storage. Without staging,
  an app that keeps data (KV, D1 or R2) gets no preview, since it would use production's data. Turn staging on
  for previews: `pnpm ship staging <id> on`.
- **rollback:** code only; the data stays (hence migrations that only add).
- **pause / resume:** the URLs only; the data stays.

Locally, `wrangler dev` and the tests use local copies in `.wrangler/state` (git ignores it), never
Cloudflare's.
