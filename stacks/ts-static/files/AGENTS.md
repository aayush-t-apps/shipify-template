# {{APP_NAME}}: agent guide

{{APP_DESCRIPTION}}

A Shipify **app** (stack `ts-static` {{STACK_VERSION}}, on Cloudflare Workers). It installs, runs,
tests and deploys on its own through `make`.

## Commands

`make setup` · `make dev` (http://localhost:8787, same as production) · `make verify`
(everything CI checks; it must pass before every push). `make verify` serves its end-to-end
tests on a port of this checkout's own (`E2E_PORT` to choose one), so checkouts can verify in
parallel; two `make dev` at once need different ports. They open the home page; one behind a
sign-in names a public page instead (`export E2E_HOME := /a-public-page` in `project.mk`).

## Layout

- `site/`: the website, served byte for byte (no build step). `site/_headers` sets response
  headers. Formatting tools ignore `site/` and `tools/`.
- `src/shared/`: platform-owned Worker core (`/health`, `/.well-known/shipify.json`, logs,
  request ids). Don't edit it; `ship upgrade` replaces it.
- `tests/unit/` (Vitest, at least 80% coverage) and `tests/e2e/` (Playwright plus axe, and the
  quality bar).
- `Makefile` and `scripts/shipify/`: the Shipify contract for this stack. CI runs only `make`
  targets; `cloudflare.mjs` deploys, previews, rolls back and pauses. Stack-owned: `ship upgrade`
  replaces them. Add project-specific targets in `project.mk`.
- `shipify.json`: project settings (version, kind, stack, staging, URLs, secret names). `ship`
  writes it; don't hand-edit ids. The version lives here, and `make version` copies it into
  `package.json`.

## Storage

<!-- #if OPTIONS -->
This app keeps data on Cloudflare: its stack options, in `shipify.json`. Shipify's
`stacks/_cloudflare/storage.md` has the details.
<!-- #endif -->
<!-- #if OPTION_KV -->
- **KV** (`env.KV`): key-value data. Free: 100,000 reads and 1,000 writes a day.
<!-- #endif -->
<!-- #if OPTION_D1 -->
- **D1** (`env.DB`): SQL. Tables come only from `migrations/NNNN_<what>.sql`, applied before each
  deploy, before `make dev` and in the unit tests. A migration only adds (a table, a column that may
  be empty or has a default, an index), since a rollback runs the old code on the new tables; never
  edit one that has shipped.
<!-- #endif -->
<!-- #if OPTION_R2 -->
- **R2** (`env.R2`): files and objects. `r2-lifecycle.json` (yours) maps a prefix to days, like
  `{"tmp/": 7}`: each deploy makes the bucket if it is missing and replaces its expiry rules with
  this file. Free: 10 GB, 1 million writes and 10 million reads a month.
<!-- #endif -->
<!-- #if OPTIONS -->
- Unit tests get real local storage, empty on each run: `localBindings()` in `tests/unit/support/`.
- `wrangler.jsonc` names the bindings without ids: each deploy finds or makes them.
<!-- #endif -->
<!-- #if !OPTIONS -->
None. To keep data, add a stack option (KV for key-value, D1 for SQL, R2 for files) as a change: Shipify's
`stacks/_cloudflare/storage.md` says how.
<!-- #endif -->

## Rules

1. Every behaviour change comes with a test. Put logic where it can be unit tested.
2. Never commit secrets or `.dev.vars`. Never log headers, cookies, tokens or request bodies (use
   `src/shared/logger.ts`).
3. Never force-push, push to `production`, or edit `.github/workflows/`: the pipeline is this
   app's own, its stack's (it runs this app's `make` targets), and changes only by `ship upgrade`.
4. Pin new dependencies to exact versions at least 2 days old.
5. Keep `/health` backward compatible. CI checks its `commit` after each deploy.

## History and how to change this app

Read, in this order: `docs/spec.md` (what it is now), `docs/changes/` (why; never edited after
approval), `CHANGELOG.md` and the `vX.Y.Z` tags (what shipped when). Tooling is in shipify; run it
from there.

- **A new or changed story:** a change doc, `pnpm ship change new {{APP_ID}} <slug>` → fill it in →
  `pnpm ship change check {{APP_ID}} <n>`. It goes in the same PR as the code. For something hard to
  undo (data, sign-in, a new service), submit the doc alone first
  (`pnpm ship change submit {{APP_ID}} <n> --yes`) and **wait for the owner to merge it**.
<!-- #if !NO_RELEASES -->
- **A fix or a small tweak:** no change doc. Make it with a test, and add a line under
  `## [Unreleased]`.
<!-- #endif -->
<!-- #if NO_RELEASES -->
- **A fix or a small tweak:** no change doc. Make it with a test.
<!-- #endif -->
- **Ship it:** every change is a PR the owner merges (a preview link when asked); work in a
  worktree for parallel changes.
<!-- #if STAGING -->
  `pnpm ship pr <checkout> --yes` (no version bump: merging deploys staging). The owner says
  "release", and `pnpm ship release {{APP_ID}} --yes` opens "Release vX.Y.Z". The owner merges it.
<!-- #endif -->
<!-- #if BUMPS -->
  `pnpm ship version <checkout> <patch|minor|major>`, then `pnpm ship pr <checkout> --yes`. The
  owner merges it, and it goes live and is tagged. If main moved meanwhile,
  `pnpm ship refresh <checkout>` first.
<!-- #endif -->
<!-- #if NO_RELEASES -->
  `pnpm ship pr <checkout> --yes`: no version, changelog or tag (`shipify.json` says
  `"releases": false`, and `ship version` refuses). The owner merges it, and it goes live. If main
  moved meanwhile, `pnpm ship refresh <checkout>` first.
<!-- #endif -->
