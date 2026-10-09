---
status: accepted (the owner asked for the flow to be made right end to end, 2026-10-02; merging its PR accepts it)
date: 2026-10-02
---

# 0026: Publishing a new project from a task: checked before the build, retried with `publish`, confirmed live

## Context
The first new project built by a task (links, #66) took three build rounds to go live:
1. **A build round of about 15 minutes, then a stop:** the shipify repo had no `CF_DEPLOY_TOKEN` or
   `CLOUDFLARE_ACCOUNT_ID` for `ship publish`.
2. **After those were added, a restarted round created the repo, then stopped:** the task bot (the
   GitHub App) lacked **Variables: Read and write**, a step in `docs/setup.md` that hadn't been
   done.
3. **The third round published.**

Along the way the agent told the owner to "comment publish". That couldn't work: only a merged
plan's build round (reason `plan-merged`) gets the publishing keys. A comment round never has
them, so each retry had to be started by hand. It also couldn't confirm the deploy before
replying.

## Decision
- **Check before building.** A `plan-merged` round first works out what publishing the plan's
  stack needs:
  - each `deploy.vars` and `deploy.secrets` source, from `shipify.config.json` `vars` or the run's
    credentials;
  - a token that may list the shipify repo's variables, which takes the same permission as
    setting a new repo's.

  If one is missing, the round stops before the agent runs. It replies with the list and how to
  fix each one, and asks for **publish** once they're fixed.
- **`publish` is a box command,** like `yes` or `again`.
  - On a task with a merged plan, the box starts that plan's build round again (it dispatches
    `task.yml` with reason `plan-merged`) and 👍s the comment. No agent runs for the comment.
  - Without a merged plan, it says there's nothing to publish.
  - The status comment's help names it.
- **Confirmed live.** The playbook has the agent wait for the first deploy with
  `pnpm ship status <id>`, which is already allowed, until production is `ok`. Only then does it
  give the live URL. Its advice after a stop is "comment **publish**".

## Options
- **Give comment rounds the publishing keys** (− every comment round on any task would hold the
  deploy key; 0021 keeps them to the run your merge started).
- **Publish from the PC after a stop** (− the build lives on the box's disk, and the PC can't reach
  it; it also breaks "tasks from the phone").
- **Check only in `ship doctor`** (+ seen at setup / − missed when a key changes later; the round's
  own check is the one that's always current).

## Edge cases
- **A retry on another slot:** the build sits in the slot that made it, so the round on another
  slot builds again from the plan (about 15 minutes). The check makes this rare: missing keys
  stop a round before it builds.
- **`publish` on a project already live:** the round finds it published and says so.
- **The check's API call fails for another reason** (GitHub down): the round stops and names the
  bot's permission. Commenting **publish** later tries again.
- **A package** (no deploy): only the bot's permission is checked.

## Confirmation
- `tests/task-run.test.ts`, run against the fake GitHub:
  - `publish` without a plan, and with one: the dispatch, no agent run, the state `working`;
  - the check naming the missing keys, then the missing permission, then going ahead when
    everything is there.
- `tests/task.test.ts`: the help and `docs/tasks.md` name `publish`.
- **Live:** links (#66) was published by its third round, at `https://lnk.app.a69x.in`, on
  2026-10-02.
