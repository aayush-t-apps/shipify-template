---
status: accepted (amended 2026-10-01, the owner's choice: on GitHub's machines the merge run checks without a browser, SHIPIFY_NO_BROWSER; the browser tests run on the box before the PR, and make e2e for a preview or staging)
date: 2026-10-01
---

# 0018: Check once, where it's free: on the box before the PR, on GitHub after the merge

## Context
Every change was checked twice on GitHub's machines, in minutes the owner pays for after the free
2,000 a month:
- **on the PR,** again for every push to it;
- **after the merge,** on the same code, before deploying.

The box already runs the same `make verify` for free before it opens the PR. The owner asked for
the cheapest setup that stays robust: no checks that add nothing.

## Assumptions, checked (2026-10-01)

| Assumption | How it was checked |
|---|---|
| The merge run checks before it deploys | `pipeline.yml`'s `main` job: setup, audit, `make verify`, then deploy, health check, rollback |
| A job skipped by its `if` uses no runner minutes | GitHub bills a job's runner time; a skipped job gets no runner |
| Skipped runs don't hold a task up | `waitForChecks` accepts `skipped` as passed |
| Moving `v1` publishes only this change to the pipeline | `git diff v1.5.2 main -- .github/workflows/pipeline.yml` is empty |
| `ship plan submit` checks a plan before opening its PR | `planSubmit` returns the check's failure first |

## Decision
1. **`ship pr` checks first, on the machine it runs on:** `make verify`, then (for apps that release
   without staging, and packages) that the version was bumped with a changelog section. The PR
   opens only when both pass, so a task's agent fixes a failure on the box before you see the PR.
   `--no-verify` skips them, for an emergency.
2. **Apps' PRs run nothing on GitHub,** unless they ask for a preview (the label `preview`).
3. **The merge run is the one check on GitHub:** setup, audit, verify, then deploy, health check,
   rollback on failure, tag. Unchanged.
4. **Shipify's CI runs after a merge to `main`,** not on PRs:
   - `pnpm verify` always;
   - the golden tests when the stacks, presets, the pipeline or the rendering code changed;
   - the release when the version is new.

   Before a PR, `pnpm verify` runs here (AGENTS.md).

## Edge cases
- **A PR made by hand without `ship pr`:** nothing checks it before the merge. The merge run still
  checks before deploying, and a failure deploys nothing: production stays as it was.
- **A failed merge run:** GitHub emails you, the app keeps its last good version, and a task (or
  you) fixes it in a new PR.
- **Shipify's `main` with a bad merge:** the Pi runs `main` at once, so a broken task or clock shows
  within minutes. CI on `main` shows red too. Revert, or fix in a PR. This is why `pnpm verify` runs
  before every commit here.
- **A preview asked on a PR:** that PR's run does the full check and the preview, as before.
- **Dependabot security PRs:** checked by the merge run, like any other.

## Consequences
- **Easier:** about half the GitHub minutes per app change, and none per push to a PR. One place to
  look when checks fail: the box's reply, or the merge run.
- **Harder:** a change merged without `ship pr` is checked only after the merge. A broken one
  deploys nothing, but `main` holds it until the fix.

## Confirmation
- `tests/task.test.ts`: `ship pr` refuses to open a PR when `make verify` fails.
- After the release, a push to a project's PR shows a skipped run.
