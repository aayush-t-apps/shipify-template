---
status: accepted (the owner asked for it to be built in the same sweep as 0021; merging its PR accepts it)
date: 2026-10-02
---

# 0022: Storage as a stack option: KV and D1 for Cloudflare apps, named and made by the deploy

## Context
Apps had nowhere to keep data. The ask (#48): an app's plan says it needs KV and/or D1, and the
stack does the rest:
- the bindings and their types;
- the resources, made on the first deploy;
- staging's own copy;
- local storage for `make dev`;
- migrations on deploy.

It must stay free. The core must name no host (ADR 0010), so "KV" and "D1" can't be core words.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| Wrangler 4.141 (pinned) provisions bindings without ids on deploy, naming them `<script>-<binding>` and reusing what the deployed Worker has bound | read in wrangler 4.141.0's `wrangler-dist/cli.js` (the provisioning handlers; `bindings_inherit=strict`) |
| It writes no ids back in CI; a KV namespace has no name field, so a preview that adds one makes `<worker>-kv`, and the next deploy's create can collide | the same source: `isNonInteractiveOrCI`, KV's `get name()` |
| `versions upload` (previews) uses the Worker's real bindings: without staging, production's data | the same source; Cloudflare's docs on versions |
| `d1 migrations apply --remote` finds a database by `database_name`; it fails before the database exists | the same source, run against a fake token |
| `--local` migrations and `wrangler dev` need no ids; `getPlatformProxy({ persist: false })` gives real local KV and D1 in Node, and `unstable_splitSqlQuery` splits a migration as wrangler does | run in a scratch app; then a generated ts-worker app with both options passed its full `make verify` (unit tests on local KV and D1, 14 browser tests) |
| workerd runs on the Pi (aarch64, glibc 2.39) | its `linux-arm64` package needs glibc ≥ 2.35; shipify-pi has 2.39 (not yet run there) |
| Free limits: KV 100,000 reads and 1,000 writes a day, 1 GB; D1 10 databases per account, 500 MB each, 5 M rows read and 100 k written a day | Cloudflare's KV and D1 pricing and limits pages (2026) |
| The deploy token needs "Workers KV Storage: Edit" and "D1: Edit"; the "Edit Cloudflare Workers" template has KV but not D1 | Cloudflare's permissions reference and token templates |
| A rollback restores code only; data and schema stay | Cloudflare's rollback docs |

## Options
- **A: wrangler's own provisioning.** (+ no code / − it names by guesswork, and a preview that adds
  a binding can break the next deploy; migrations still need the database first)
- **B: Shipify's deploy script names and finds each resource**, makes what's missing, migrates,
  then deploys with the ids filled in. (+ the same result from any checkout; migrations before code
  / − about 100 lines of the stack's script)
- **C: ids committed to `wrangler.jsonc`** after a first manual create. (+ plain / − a manual step
  per app and per environment)

## Decision
Chosen **B**, as a **stack option**, which keeps the core generic.
- **Options are data.**
  - A stack, or a layer it's built from, lists `options` in its `stack.json` / `layer.json`, each a
    name and a line saying what it adds.
  - A plan picks some (`options: [kv, d1]`, checked against the stack), as does `ship new --options`.
  - The manifest records them. Templates see `OPTION_<NAME>`, `OPTION_<NAME>_STAGING` and `OPTIONS`.
  - A template that renders to nothing isn't written. Conditionals also read SQL's `--`.
- **The `_cloudflare` layer offers `kv` and `d1`**, so ts-worker and ts-static both have them (1.2.0):
  - `wrangler.jsonc` gets the bindings (`KV`; `DB` with a `database_name`), with no ids, and the
    same in `env.staging` with its own names;
  - `src/worker/app.ts` gets their types;
  - D1 gets `migrations/0001_init.sql`;
  - the unit tests get real local storage (`tests/unit/support/bindings.ts`, stack-owned, in
    memory, migrations applied).
- **`cloudflare.mjs`:**
  - **deploy** finds the KV namespace `<worker>-<binding>` and the database by its name, makes
    what's missing, applies the migrations, then deploys from a copy of the config with the ids,
    deleted after;
  - **preview** refuses an app that keeps data and has no staging, and uses staging's storage
    otherwise, without the PR's new migrations;
  - **local** applies migrations to the local database before `make dev` and the browser tests.
- **Migrations only add**, since a rollback runs old code on the new tables.
  `stacks/_cloudflare/storage.md` is the guide, for new apps and for adding storage to one.

## Edge cases
- **The token lacks the permissions:** the deploy stops before anything changes, naming the two
  permissions.
- **The 11th D1 database:** Cloudflare refuses, and the deploy says the free plan allows 10.
- **A PR adds a binding and asks for a preview, with staging:** the preview makes staging's resource
  by its name, and the merge's deploy finds it.
- **A PR's migration isn't on its preview:** it runs when the PR merges. Staging's data is shared,
  and a migration from a PR that's then closed would stay there.
- **A failed migration:** wrangler rolls that one back; the deploy stops before the new code goes
  out.
- **A rollback:** code only. A migration that only added still fits the old code.
- **Two deploys at once:** an app deploys one at a time per branch (`ship.yml`'s concurrency), and production and staging have their own resources.
- **An app that took no option:** nothing changes for it. Its deploy, preview and `make dev` run as
  before.

## Consequences
- **Easier:** an app that keeps data is a plan line; tests use the same storage the app does;
  nothing to set up per app.
- **Harder:** the deploy token needs two more permissions (once, by hand). Apps with storage and no
  staging get no preview link, though screenshots still come. D1's 10 databases are shared across
  the account.

## Confirmation
- `tests/storage.test.ts` runs the deploy script against a fake Cloudflare API and a fake wrangler:
  - make, then find again;
  - migrations before the deploy;
  - staging's own resources;
  - no preview without staging;
  - local migrations.
- `pnpm test:golden` shows a fresh app without options is unchanged.
- A generated app with both options passes `make verify`.
