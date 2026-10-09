# {{APP_NAME}}: agent guide

{{APP_DESCRIPTION}}

A Shipify **{{KIND}}** with its own setup (stack `{{STACK_ID}}` {{STACK_VERSION}}). Shipify provides
the docs, versioning, git flow and the pipeline (`.github/workflows/ship.yml`, in this repo). This
project provides everything else (language, build, tests and, for apps, hosting) through `make`.

## The contract to implement

CI runs only these `make` targets. Stubs are in the `Makefile`; replace them.

| Target | Does | CI passes |
|---|---|---|
| `setup` | installs tools and dependencies on a fresh machine or CI runner | |
| `check` · `test` · `build` | lint and types · tests · build | |
| `verify` | everything that must pass before a push (usually check, test and build) | |
<!-- #if IS_APP -->
| `deploy` | deploys this commit to `$SHIPIFY_ENV` (`production` or `staging`) | `SHIPIFY_ENV` `SHIPIFY_SHA` `SHIPIFY_VERSION` `SHIPIFY_SECRETS_FILE` |
| `preview` (optional) | deploys a PR preview and prints `url=<address>` | `SHIPIFY_PR` `SHIPIFY_SHA` `SHIPIFY_VERSION` `SHIPIFY_SECRETS_FILE` |
| `e2e` (optional) | end-to-end tests against a deployed URL | `SHIPIFY_BASE_URL` |
| `rollback` (optional) | goes back to release `$SHIPIFY_TO`, or the previous version | `SHIPIFY_TO` `SHIPIFY_SECRETS_FILE` |
| `pause` · `resume` (optional) | takes the app offline and back | `SHIPIFY_SECRETS_FILE` |
<!-- #endif -->
| `audit` · `format` · `version` (optional) | dependency audit · format files · copy `shipify.json` `version` into native files | `SHIPIFY_VERSION` (version) |

Also:

- **Toolchain in CI:** if `make` needs more than a stock Ubuntu runner, add a composite action at
  `.github/actions/setup/action.yml`. The pipeline runs it before `make setup`.
<!-- #if IS_APP -->
- **URLs and health:** put the deployed URLs in `shipify.json` `urls`, and `health` (e.g.
  `"/health"`) to a path that returns JSON with `"commit"` set to the deployed SHA. CI checks it
  after every deploy and rolls back if it fails. Without a `rollback` target, CI redeploys the
  previous release tag.
<!-- #endif -->
- **Secrets:** list their names in `shipify.json` `secrets` (`deploy` for CI only, `runtime` for the
  running app). CI writes the values as JSON to `$SHIPIFY_SECRETS_FILE`. Repository variables are
  plain environment variables.

## Rules

1. Every behaviour change comes with a test.
2. Never commit secrets. Never log tokens, cookies or request bodies.
3. Never force-push, push to `production`, or edit `.github/workflows/`: the pipeline is this
   project's own, its stack's, and changes only by `ship upgrade`.
4. Pin new dependencies to exact versions at least 2 days old.

## History and how to change this {{KIND}}

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
- **Ship it:** every change is a PR the owner merges; work in a worktree for parallel changes.
<!-- #if STAGING -->
  `pnpm ship pr <checkout> --yes` (no version bump: merging deploys staging). The owner says
  "release", and `pnpm ship release {{APP_ID}} --yes` opens "Release vX.Y.Z". The owner merges it.
<!-- #endif -->
<!-- #if BUMPS -->
  `pnpm ship version <checkout> <patch|minor|major>`, then `pnpm ship pr <checkout> --yes`. The
  owner merges it, and CI ships it, tags it and publishes the GitHub Release. If main moved
  meanwhile, `pnpm ship refresh <checkout>` first.
<!-- #endif -->
<!-- #if NO_RELEASES -->
  `pnpm ship pr <checkout> --yes`: no version, changelog or tag (`shipify.json` says
  `"releases": false`, and `ship version` refuses). The owner merges it, and it goes live. If main
  moved meanwhile, `pnpm ship refresh <checkout>` first.
<!-- #endif -->
