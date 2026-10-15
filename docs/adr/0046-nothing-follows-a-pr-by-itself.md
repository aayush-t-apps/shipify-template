---
status: accepted and built (one PR; the owner's asks on 2026-10-09). Amended by 0054 (errands): a PR's checks are read in the background only when you ask, once; a merge an errand waits for fires it in the close's own run
date: 2026-10-09
amends: 0019 (one more write of the due run's on a task, beside 0040's close), 0031 (the watch's follow and U6: a preview's failed checks start no run), 0040 (§3: the due run's one more write, a stale label; §5: a PR's checks no longer start anything), 0045 (what its live checks decided for other accounts, now for every account)
---

# 0046: Nothing follows a PR by itself

## Context

The owner's words, 2026-10-09:
- "nothing should start automatically i can look check and handle PRs nothing in background only
  as i asked … when i asked why it failed and fix it should be able to in the same or new PR if
  already merged"
- "ok yeah lets make it consistent simple and clean": the same everywhere, Shipify's own account
  too.
- On keeping a merged task open for a day, in case something needs changing: "no if github closes
  the task i dont want to handle it or reopening nothing should happen automatically keep it simple
  clean".

Until now, two rules covered the same thing:
- **On Shipify's own account,** apply followed a PR's checks after every push and every `preview`
  (`pending.checks`, the `deploying` label). The watch rang due runs until they ended. Then the
  task's run said they passed, or a failure started a fix run, at most twice (`ci-failed`).
- **On another account,** nothing followed them: you asked (ADR 0045, its live checks, #282).

## Decision

1. **A PR's checks are yours to look at, on every account.** Nothing reads them in the background,
   labels a task for them, or starts a run when they end.
   - **When you ask** "why did the checks fail?" or "fix them", a run reads them itself
     (`gh pr checks`, `gh run view --log-failed`; every agent's token reads checks and actions).
     It says what failed and why, or fixes the cause.
   - **Where the fix goes:** on the same PR while it's open, in a new PR once it's merged.
   - **A preview** still deploys its link. Its checks are the PR's.
2. **Your merge closes the task, and it stays closed.**
   - **Its one run says how it went:** Live, Merged, or that the deploy failed (with its run).
   - **Nothing reopens it.** A day's wait before the close was weighed and refused (the owner).
   - **The task keeps its whole thread,** so whatever you ask later starts from all of it.
3. **A closed task comes back only when you ask, the same way from GitHub, Telegram or the web
   chat.** This is unchanged (ADR 0031, ADR 0040):
   - **Your words on it** reopen it as their run starts, and the agent carries on with the thread.
   - **`reopen`** opens it with no agent.
   - **A thanks** leaves it closed, with a 👍.
4. **A merge ends its branch.**
   - **The rule:** the first read that sees a task's PR merged, with none of its others still open,
     moves the task to its next branch (`nextBranch`, as `start over` does). Its next work starts
     from the repo's default branch, so a fix or a revert after the merge is a new PR that holds
     only its own commits.
   - **How it was found:** checking the scenarios below. On a repo that keeps merged branches, the
     next run started on the old branch. After a squash merge, its new PR carried the merged
     commits again.
5. **A `deploying` label with nothing to follow is taken off by the due run,** with no run, as a
   quiet day's close takes its labels off (ADR 0040 §3). A task mid-follow when this ships keeps
   one, which would ring the watch every 10 minutes for nothing. So would a label added by hand.
   The quiet close also skips a task that's already closed: a closed task is listed only for its
   deploy.

**What still follows by itself** is the end of something you did, and no agent runs for it:
- your merge's deploy, followed by its own run to Live;
- a staging release PR, to its merge and its production deploy;
- a merged plan's first deploy, through the `deploying` label and the watch's due runs.

Each says how it went, once.

## The scenarios, each covered by a test

| After the merge | You | What happens | Test |
|---|---|---|---|
| all good | nothing | it stays closed; its run said Live or Merged | `kernel-flow`: "the merge: its own run follows the deploy and says Live"; `kernel-decide`: "a merge with nothing to deploy … says Merged, once" |
| a thanks | `thanks`, 👍 | a 👍, still closed | `kernel-decide`: "a thanks well after a close leaves the task closed" |
| something's off | say what, anywhere | reopened as its run starts; the agent carries on with the thread; a new PR on a new branch | `kernel-flow`: "opens a closed task your words carry on as its run starts"; `kernel-decide`: "a message well after a close reopens it and carries on" |
| undo it | "revert it" | the same, a new PR that reverts it (or the Operate form's roll back, for an app's deploy) | as above |
| deploy failed, or CI fails on the default branch | "why did it fail? fix it" | a run reads the logs, says why, and fixes it in a new PR with only its own commits | `deploys`: "says failed with its run …"; `kernel-flow`: "asked why its checks failed and to fix them: the same PR while it's open, a new one once merged" |
| open it to come back to | `reopen` | open, no agent, waiting for your words | `kernel-decide`: "`reopen` reopens it with no agent …"; `door-in`: "closes or reopens a task at once on `close` or `reopen` …" |
| words before the merge no run read | nothing | the merge's reply says so; your next words carry them | `kernel-decide`: "carrying on, it also reads what you wrote before the close that no run read …" |
| a PR that doesn't close the task (`Part of`) | nothing | the task stays open; its next work starts a new branch | `kernel-flow`: the checks test above (its PR merges with the task open) |
| a label left over | nothing | the due run takes it off, with no run | `kernel-flow`: "the due run's own writes, no run for them …" |

## What it removes

- **In apply,** the checks follow after a push and after `preview`.
- **In the snapshot and the due run,** the checks read.
- **In `deploys.ts`,** `checksState` and `NO_CHECKS_MS`.
- **In the task's state,** `pending.checks` and `ciFixes`. An old state's fields are dropped as it's
  read.
- **The `ci-failed` run:** its reason, its prompt section with the log, and `MAX_CI_FIXES`.
- **In the playbook,** "Checks failed: the prompt has the log".

Nothing is added beyond the branch rule and the label rule: no setting and no new part.

## Docs touched

- `docs/tasks.md`: closing, a new "After your merge" section, previews, when a step fails.
- `docs/watch.md`, `docs/design.md`, `docs/context.md`, `docs/roadmap.md`.
- `docs/tour.md`: also the watch no longer starts a stuck task's run, stale since ADR 0042.
- `playbooks/task.md`: after a merge, a revert.
- `CHANGELOG.md`.
- The ADR index, with 0031 and 0040 marked as amended.

## As built (2026-10-09)

- `pnpm verify` and `pnpm test:golden` pass.
- **The tests:** the checks-following tests were replaced by one that asks. The flow test fakes its
  merge as GitHub returns one, with a merge commit, and checks the new branch. The due run's test
  covers the label.
