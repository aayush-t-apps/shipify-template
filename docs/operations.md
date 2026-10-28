# Operations

Day-to-day commands. Every command and its flags: [cli.md](cli.md). When something's off:
[troubleshooting.md](troubleshooting.md).

| To | Do |
|---|---|
| check everything | `pnpm ship doctor`; `pnpm ship selftest` for every part end to end |
| see what's going on, from the phone | `/ping` and `/apps` to the bot; the status task on GitHub (label `shipify-status`) |
| see all projects, or one | `pnpm ship list` · `pnpm ship status <id>` (health, version, last release, runs, PRs) |
| release a staging app | the Operate form, or `pnpm ship release <id> --yes`; then merge "Release vX.Y.Z" |
| roll back production | the Operate form, or `pnpm ship rollback <id> [--to vX.Y.Z] --yes` |
| take an app down / bring it back | the Operate form, or `pnpm ship down <id> --yes` / `pnpm ship up <id> --yes`. Down: CI still checks merges but deploys and previews nothing, and its URLs are off; the repo, releases and secrets stay |
| staging off or on | `pnpm ship staging <id> off\|on --yes`, then ship the branch as a PR |
| a new stack version | `pnpm ship upgrade <id>` → `--yes` → migration notes → ship it (or `<app>: upgrade` as a task) |
| a preview link for a PR | comment `preview` on its task, or `pnpm ship pr <p> --preview --yes` |
| a branch behind main | `pnpm ship refresh <p>` |
| tasks waiting for you | the shipify issues labelled `needs you` |
| a task that failed | its reply names the fix; usually comment `continue` |
| boxes | `pnpm ship box list`; this machine's: `pnpm ship box status` · `stop` · `start` · `logs -f` ([box-setup.md](box-setup.md)) |
| a plug-in (Notion, Drop, Telegram) | `pnpm ship add <name>` → `--yes`; `--new` pastes its keys again; `pnpm ship selftest <name>`; `pnpm ship remove <name> --yes` |
| a key or token to replace | [setup.md](setup.md), "Tokens and secrets" |
| the projects on a new machine | `pnpm ship sync` (clones what's missing), or `pnpm ship reconcile` |
| new projects in the task forms | automatic after publishing (a small PR), or `pnpm ship forms --yes` |
| a merge that didn't deploy (GitHub started no run, rarely) | the project's Actions → **ship** → Run workflow → **deploy**: `main` again. For a merge a task follows, the watch says so after 30 minutes, with this fix |
| an app behind a sign-in (Cloudflare Access) | protect the Worker, then add a **Bypass** rule for `/health` and `/.well-known/shipify.json`, or every deploy's health check fails and rolls back |

## Releasing Shipify

A task `shipify: release` on GitHub (or `pnpm ship template --yes`): it checks the files, sets the
version from CHANGELOG's Unreleased, records it here and publishes it to the template, which offers
it to every copy as a PR ([releases.md](releases.md)). A stack change reaches each project by its
own upgrade PR: `<app>: upgrade`, on one canary project first. Then `pnpm ship selftest` on the PC
checks every part end to end.

## Limits of the default stacks (all free)

| Limit | Use |
|---|---|
| GitHub Actions, private repos | 2,000 min/month. Runs on a box use none. A PR uses none unless it asks for a preview; an app merge about 2, one of docs alone too; a Shipify change about 2 (plus 1 for golden tests, and the edge's deploy when it changed); a merged plan's `prepare` and each operation about 1 |
| Cloudflare Workers | 100 per account (1 per app, 2 with staging, 1 for the edge) |
| Worker requests | 100,000 a day (static files don't count) |
| GitHub's calls | `GITHUB_TOKEN`: 1,000 an hour per repo, about 100 runs an hour |

## Retiring a project

`pnpm ship down <id> --yes` is usually enough, and `up` undoes it. For good, by hand on purpose:
`down` first, then archive the repo, delete its Workers in Cloudflare, and `pnpm ship unregister
<id>`.
