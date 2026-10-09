# {{APP_NAME}}

{{APP_DESCRIPTION}}

| Environment | URL | Deployed when |
|---|---|---|
<!-- #if STAGING -->
| Preview | `https://pr-<n>-{{SERVICE_NAME_STAGING}}.{{CF_WORKERS_SUBDOMAIN}}.workers.dev` | a PR gets the label `preview` (a task's `preview` comment adds it) |
| Staging | `{{URL_STAGING}}` | a commit lands on `main` |
| Production | `{{URL_PRODUCTION}}` | the "Release vX.Y.Z" PR is merged (`pnpm ship release`) |
<!-- #endif -->
<!-- #if !STAGING -->
| Preview | `https://pr-<n>-{{SERVICE_NAME}}.{{CF_WORKERS_SUBDOMAIN}}.workers.dev` | a PR gets the label `preview` (a task's `preview` comment adds it) |
| Production | `{{URL_PRODUCTION}}` | a PR is merged into `main` (one check, the deploy, then `/health`) |
<!-- #endif -->

## What it is, and its history

- `docs/spec.md`: what the app does now.
- `docs/changes/`: why, one change doc per feature.
<!-- #if !NO_RELEASES -->
- `CHANGELOG.md` plus the `vX.Y.Z` tags and GitHub Releases: what shipped when.
<!-- #endif -->

`/health` reports the running `version` and `commit`.

## Develop

```sh
make setup
make dev        # http://localhost:8787
make verify     # everything CI runs
```

## How it ships

`make verify` runs in full, browser tests too, before a PR opens (`pnpm ship pr`, on the box or the
PC). The Shipify pipeline then runs this app's `make` targets on GitHub only when needed: nothing
for a PR unless it has the label `preview` (then `preview` and `e2e`, and `unpreview` when it
closes); on `main`, one check (`setup`, `audit`, `verify` without a browser), then `deploy` (to
staging and `e2e` when staging is on), then `/health`, with a rollback if it fails. The Cloudflare
side is `scripts/shipify/cloudflare.mjs`.

| Name | Kind | Where |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | GitHub → Settings → Secrets and variables → Actions |
| `CLOUDFLARE_ACCOUNT_ID` | variable | the same place, under the Variables tab |
| `CF_WORKERS_SUBDOMAIN` | variable | the same place (the subdomain in the workers.dev URLs) |

`pnpm ship publish` sets all three.

## Roll back, pause, resume

From shipify: `pnpm ship rollback|pause|resume {{APP_ID}} --yes`. Or GitHub → Actions → ship → Run
workflow:

- **rollback:** production goes back one version, or to the release tag you enter (`v1.2.0`).
- **pause:** takes the URLs offline. Nothing is deleted. Use it between client demos.
- **resume:** brings the URLs back.

Deploying also turns a URL back on.
