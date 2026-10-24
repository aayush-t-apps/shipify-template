---
status: accepted (merged #488) and built; see [As built](#as-built-2026-10-16); amended by 0063 (a new model or effort keeps the stay's session)
date: 2026-10-16
amends: 0035 (the agent's clock, the job's limit; the checks after the agent move to a step of their own), 0037 (the catch-up shares the session's clock, as now, only a longer one), 0057 (think holds the record's token as a stay does; a stay of 20 minutes by default)
---

# 0059: Long sessions, finished fresh

## The plan in short

- **One session of up to 200 minutes.** The agent keeps its context and warm cache the whole way.
  Your words sent while it works go into the same session, as now.
- **`stop` and your words work to the end.** The runner reads the task with the workflow's own
  token, which lasts the job, exactly as a stay already does. The agent never holds it.
- **The end of a run gets fresh keys.** After the agent, one new step, with its own read token
  minted then, brings the branch up to date with `main` (the same `ship refresh` a run does at its
  start), runs the box's checks, and gives the agent its one fix round in the same session. So a
  PR opens up to date with `main` as it was minutes before, however long the agent worked, and
  only after its checks passed. Pushing and the reply already use keys minted after the agent.
- **Nothing new to run or keep.** No new service, App, key, permission or setting, and no
  dependence on the edge: a run still needs only GitHub and the box. One step and its two token
  steps (your account, another account, as think has) added to `task.yml`; the code mostly moved.
- **A stay of 20 minutes by default.** `SHIPIFY_STAY` still changes it (0 to 45).
- **A run stays after a question too; a `use` naming the pick already in place keeps it
  staying;** and **a phone copies part of a reply** (#487's fixes,
  [below](#also-from-487-three-fixes)).
- **Told, never quiet:** a `stop` or catch-up read that fails says so in the run's details.
- **One limit kept, and said:** the agent's own GitHub reads (`gh`) work for its key's first hour.
  Its work is in its clone and needs no key; the box does every fetch, check and push after it with
  fresh keys. The playbook tells the agent.
- **One risk accepted:** a box that dies mid-run (a power cut, a 04:30 update restart) loses that
  run's work, now up to 200 minutes. Legs that save every ~50 minutes were weighed and declined
  for their pauses and steps ([Catches](#catches-kept-on-purpose)).

## The owner's asks (task #487, 2026-10-16)

1. What limits Shipify has compared with asking Claude Code directly.
2. Whether GitHub is what limits long runs, and the simplest workaround.
3. Prompt cache and one long context against a fresh start each run.
4. Whether the GitHub App token is the only limit if you want just Claude's 5-hour window.
5. Confirm the limit, check nothing breaks if it's raised, and suggest a good number.
6. "200 minutes session total with 20 mins of stay active for a box."
7. Why a change of effort starts fresh instead of staying.
8. Does the token refresh midway; the catches. "Simplicity, clean, robust."
9. A question answered with the same model and effort still started a fresh run.
10. Whether that fix is clean; and on the phone, a selection can't be copied.
11. Code going stale during a long run, the PR behind `main`: "a better architecture".
12. "Long, reliable, clean, simpler sessions with no complexity, our rules kept, no extra
    resources."
13. Who holds which keys, boxes kept disposable, each layer kept apart: checked, not assumed.

Asks 1–5 and 7 were answered on the task. This ADR is the rest: 6, 8 and 11–13, and the two
fixes for 9 and 10, all built in one PR.

## What was found (checked 2026-10-16, `main` at `7663acf`)

Read on this PC; nothing was started on a box.

| Assumption | Found | Where |
|---|---|---|
| GitHub caps a run near 50 minutes | No. A self-hosted job may run 5 days [1] | GitHub's limits |
| What stops the agent | `AGENT_MINUTES = 50`, per ask; the fix round gets a fresh 50, so think's budget is 192 | `think.ts:44`, `:534`, `:59-66`, `:699` |
| The job's limit follows the clocks | `timeout-minutes: 300` ≥ think + 30 + 15 + 55, and the copy's prune (18000 s) ≥ the job, both tested | `task.yml:186`, `:258`; `workflows.test.ts:384-392` |
| What breaks after the hour | Think's `SHIPIFY_ISSUES_TOKEN` is the agent's one-hour read token; `stop` (read every minute) and the catch-up read with it, and their errors are swallowed (`tryOr`) | `task.yml:376`; `think.ts:546`, `:642`; `run.ts:411` |
| A key can't be renewed inside a step | Minting needs the App's key, which never reaches the agent's step; the agent's environment is fixed when it starts | `security.md:24`; `think.ts:102-112` |
| The workflow's token can sit beside a running agent | The stay's step holds it while its agent runs; the sandbox strips the name, and the agent, its own user with `env -i`, can't read the runner's environment or memory | `task.yml:513`; `sandbox.ts:195`; `security.md:126-130`, `:224-229` |
| The workflow's token lasts the job | "Expires when the job finishes"; self-hosted, "refreshed for up to 24 hours" [2]. It died at an hour in 2019 [3]; that changed | GitHub's docs |
| Seen past an hour here | Run `38045491401` (2026-10-10): apply wrote the task with it at +62–63 minutes, past an App token's 60 | the run's step times |
| Not seen yet | One value, read at a step's start, still working past an hour in that step | proven first in the build, on the box ([Confirmation](#confirmation)) |
| `main` moving during a run | A branch behind `main` is refreshed only at a run's start (`ship refresh`: main merged, changelogs kept, the version bump redone; a conflict goes to the agent). Apply pushes to the task's branch with a fresh write key and never runs project code | `think.ts:277-330`; `apply.ts:553-600` |
| A later step can carry on a run | The stay reopens the run's folder and resumes its session (`placeFor(…, reopen)`, `runThinkStep({ resume })`) | `place.ts:82-86`; `run.ts:548-630` |
| A run needs the edge | No: apply tells the door of a reply, and a failure is logged, not fatal | `apply.ts:97-104` |
| Old run folders are swept at 6 hours | `STALE_RUN_MS` (its comment says the job's limit is 2 hours) | `sandbox.ts:49-50` |
| The stay's limits | `SHIPIFY_STAY` 10 by default, at most 45; its own token | `stay.ts:11-13`, `:39-44` |
| Docs that name old numbers | `box-setup.md:339-340` (50 minutes; the job "4 hours"), `tasks.md:132`, `:497-498`, `settings.md:32`, `task.yml:472` (a stay's "(5)") | read |
| The rule, as written | `security.md:44` says `GITHUB_TOKEN` is "never think" and doesn't name the stay; `:224` says the stay holds it | read |
| A throwaway copy with the numbers | Types check; 1,220 of 1,230 tests pass, the 4 failures pin old values (50, 192, `+360`, think's token name) and pass once updated | `tsc`, `vitest` |

## How others do it

| Who | Its run | Its keys |
|---|---|---|
| Copilot's coding agent | about an hour, then it times out [4] | GitHub's own |
| GitHub Agentic Workflows | the agent's step 20 minutes, its job 60, by default [5] | the agent's job read-only; writes in a later job ("safe outputs"), as think and apply here |
| `claude-code-action` | the job's `timeout-minutes` | the job's OIDC token traded once for an App token; no refresh [6] |
| octo-sts, sts-cat | | a service that trades a job's OIDC token for fresh App tokens [7] |
| An OpenShift CI agent | died at 1 h 17 m on a 401 | a token file that `gh` and git re-read on each call, rewritten by a script holding the App's key (closed) [8] |

Shipify's split is the common one, and a session past an hour is rare. None of these renews the
agent's own key mid-run without either a key service or the App's key beside the agent.

## Options

| | How | Against |
|---|---|---|
| A. Chained runs | the box starts the next run itself | a run you didn't ask for (ADR 0046); a fresh session each time |
| B. Legs | the agent cut off every ~50 minutes, its commits pushed, a new read token, the session resumed | the most reliable (a crash loses one leg, fresh keys always), but the agent stopped mid-work at each boundary, and about 15–18 more steps (mint, leg, mint a write key, push, each time) |
| C. Keys from the door | the run shows its OIDC token, the door mints a read token, a file the agent's `gh` re-reads | runs would depend on the edge for keys (today they need only GitHub); a new App, or the App's key on Cloudflare (then the edge's deploy token reaches your code); a second way of minting; other accounts left out; new setup |
| D. The App's key in think's runner | re-mint every 45 minutes | the key that mints everything, for hours, beside the agent (`security.md`) |
| **E. One session, the job's token for the runner's reads, a fresh step to finish** | below | the agent's own `gh` past its first hour (kept) |
| F. As today | `continue` from the branch | 50 minutes, then a fresh session; a long PR may open behind `main` |

## Decision

**E**, the owner's choice of one unbroken session over legs (2026-10-16). It uses only what's already there: the workflow's token as the stay uses it, the run's start
refresh, the box's checks, and a later step resuming the session as the stay does. Nothing depends
on the edge, and no new key or service exists.

### The session

- `AGENT_MINUTES` becomes 200, the session's: the first ask and the catch-up share it, as now.
- Think's `SHIPIFY_ISSUES_TOKEN` becomes `${{ github.token }}`, as the stay's: `stop` and the
  catch-up read with it to the end. The agent's `GH_TOKEN` stays its one-hour read token; it holds
  no write key.
- Think ends after the agent: its work-in-progress commit and bundle as now, so nothing is lost if
  the job ends there.

### The finish (a new step, `ship run finish`)

- After think, a read token is minted for it (and its other-account twin, as think's are). The
  step is think again, carrying on (as a stay's turn does: `placeFor(…, reopen)`, the saved
  session), with no first ask:
  1. **Up to date:** the clone fetches `main` with that token, the way `clone` fetches
     (`think.ts:897-937`); behind it, the start's refresh block (`think.ts:288-330`, made one
     function for both). A conflict goes to the agent, in the same session.
  2. **Checks:** the box's checks (`gate`: `ship pr --check`, `make verify`), as now.
  3. **One fix round** when they fail: the agent, same session, up to `FIX_MINUTES` (20).
  4. **The bundle** again, for apply.
- Think, when a finish follows, skips the checks and still makes its work-in-progress commit and
  bundle, so the work is kept if the job ends between them.
- **No PR without the finish's checks:** decide opens or updates a PR only when the finish says its
  checks passed; otherwise the commits are kept on the task's branch, as when checks fail today.
- It runs for a work run that asks for a PR, as the checks do today; a repo that keeps its own
  rules gets only the up-to-date step (`git merge`, as its start does), its own CI checking it.

### Numbers

- Think: 5 + 5 + 15 + 5 + 2 + 200 + 3 × 2 = **238** minutes at most.
- Finish: 5 (fetch, refresh) + 2 + 25 + 20 + 2 + 25 + 2 × 2 = **83**.
- The job: ≥ 238 + 83 + 30 + 15 + 55 = 421, so `timeout-minutes: 430`; the copy's prune ≥ 25800 s.
- `STALE_RUN_MS` 8 hours, tested against the job's limit; its comment fixed.

### The stay

- `STAY_IDLE_MINUTES` 10 → 20. Its token, its 45-minute cap and its giving way are unchanged.

### Told, and the rule written once

- A failed `stop` or catch-up read is told once in the run's details, with its cause.
- `security.md`: the workflow's token may be in the runner process of think and stay, never the
  agent's (the sandbox strips it; the agent is its own user). The table's "never think" and the
  stay's paragraph become that one rule, with its reason. `workflows.test.ts` checks it.
- `playbooks/task.md`: your GitHub key lasts an hour from the start, so read what you need from
  GitHub early; the box refreshes your branch, checks and pushes after you, with fresh keys.

## Keys, layers and boxes

Who holds what, after this ADR (from `security.md`, `task.yml`, `sandbox.ts`):

| Layer | Holds | For how long | What this ADR changes |
|---|---|---|---|
| GitHub (the record, the queue, the secrets) | every long-lived key: the Apps' keys, the agents' logins, the tools' keys, the deploy token | always, as secrets | nothing |
| A step's runner on the box (user `shipify`) | that step's keys, in its memory: fresh one-hour tokens, the workflow's token | the step | think's runner holds the workflow's token, as the stay's does; the finish gets its own read token and the agent's login, as a stay does |
| The agent (its own user per slot) | its one-hour read-only GitHub key, the tools' look keys, its login on a pipe read once | think, the finish, a stay | nothing: never a write key, never the workflow's token |
| The box's disk | its runner registration (no API access), the tools, Shipify's copies, the slots' caches; a run's folder, removed at the slot's next run | no key | old run folders swept at 8 hours |
| The edge (Cloudflare) | the door App's key (shipify only), Telegram's keys | always | nothing; a run still never needs it (`apply.ts:97-104`) |

So the layers stay apart: GitHub keeps every key and the queue, a box gets a step's keys only for
that step and keeps none, the agent gets only read keys, and the edge is never on a run's path.
A box stays disposable: wiped and set up again (`box add`, `here.sh`, Docker), it has lost nothing.

## Catches, kept on purpose

| Catch | Why |
|---|---|
| **A box that dies mid-run loses that run's work** (a power cut; the 04:30 restart when an update needs one, `setup.sh:107-112`): the agent's commits leave the box only at apply, and `continue` starts from the branch | today up to 50 minutes, now up to 200. The owner's choice (2026-10-16), over legs that push every ~50 minutes: those pause the agent each time and add about 15–18 steps to `task.yml`. Rare: the restart waits for an update that needs one |
| The agent's own `gh` fails after its key's hour | its work needs no key; every fetch, check and push after it has fresh ones. Renewing it needs C or D |
| One slot held up to about 7 hours | other slots keep working; `stop` frees it |
| The plan's 5-hour window may end first on Opus at high | as today: `plan-used-up`, work kept, `continue` after the reset |
| Claude Code compacts a long context itself | the agent's own way; `handoff.md` still written |
| `stop` reads every minute on the workflow token's 1,000 an hour per repo [9] | about 60 an hour per long run |

## What stays as it works today

GitHub's limits; plan's, decide's, apply's and the stay's own one-hour tokens; the agent's
read-only keys; the stay's gate; `continue` from the branch; work kept at every stop (ADR 0035,
0041); no run by itself (ADR 0046); a run needs only GitHub and the box.

## Also from #487: three fixes

Written by the box's work run in PR #489 (closed, so everything ships in this ADR's one build
PR, from its commits):

- **A run stays after a question.** `staysAfter` took only `answer`; it now also takes a
  `needs-you` reply whose question waits on nothing else, by decide's own `questionWaits`.
- **A `use` that changes nothing keeps the session.** A message that is only `use <the agent,
  model and effort already in place>` gets the box's own reply, a write, so `sameTurn` fails and
  the stay hands over (`run.ts:612`; `decide.ts:460-466`); your next words then start cold. The
  stay posts a reply of the box's own (no agent, no token past the record's) when the task's pick
  is unchanged, and stays. A different pick still hands over, by design: a new model or effort is
  a new session. (`use` inside a longer message already stays: it says nothing and thinks with
  it, `decide.ts:426-433`.)
- **`continue` stays a normal run:** a session lives in the run's folder, which ends with its job,
  so `continue` carries on from the branch and `handoff.md`, as now.
- **A phone copies part of a reply.** The long press is the phone's again; ⋯ still gives Copy and
  Download.

## Why the runs on #487 missed this, and the fix

The box's run ruled out the workflow's token in think by its wording and offered A and B:

- `security.md:44` says "never think" with no reason; the stay's exception and its reason are 180
  lines later, and a test pins the name. A careful reader stops at the rule.
- None of #487's seven runs read a skill: `codebase-design` is listed for modules, not for weighing
  options.
- A breaks ADR 0046, which it didn't check.

The fix: the rule written once with its reason (above), and one lesson in `skills/codebase-design`
by `skills/writing-skills`, with #487 as its scenario: before ruling an option out because a rule
forbids it, read the rule's reason and look for where the code already does the same; check each
option against the owner's standing rules (ADRs, the roadmap's "Not wanted", the notebook). Its
description also names weighing options for a change or a plan.

## Docs and clean-up

In the build's PR: `docs/security.md`, `docs/box-setup.md` (200 minutes, the finish, the job about
7 hours), `docs/tasks.md` (`:132` the stay's 20, `:483-490` the finish's refresh and checks,
`:497-498` the clock), `docs/settings.md:32`, `playbooks/task.md`, `.github/workflows/task.yml`
(the finish and its token steps, the numbers, think's token, "(5)" → 20), `cli/kernel/think.ts`,
`cli/kernel/run.ts` (`run finish`), `cli/kernel/stay.ts` (and `decide.ts`'s `questionWaits`,
`edge/public/admin/chat/app.js`, ADR 0036's and 0057's lines, from #489), `cli/lib/sandbox.ts`,
`skills/codebase-design/`, `docs/roadmap.md` (item 5's "A read token right before the agent": done
by this; "Partial clones … once a run's key can outlive its hour" stays), this ADR's "As built",
`CHANGELOG.md`.

## Confirmation

- Tests first: the job's limit, the prune and `STALE_RUN_MS` against think and finish; think's
  token; the finish step after its token and before decide; a branch behind `main` refreshed in
  the finish; a failed check given one fix round there; a failed `stop` read told.
- `pnpm verify`, `pnpm ship selftest`, `selftest claude`, `selftest pi`.
- **Live on homepi (no GitHub minutes), with your go:** a work task told to work past an hour; a
  message at minute 65 taken in; `stop` at minute 70 stopping it. A second task, with a PR merged
  into `main` while it works, opens its PR up to date. A third slot answers meanwhile. A job
  cancelled between think and the finish keeps its commits on the branch and opens no PR. If the
  workflow's token fails past the hour, the details say so, and the build stops there for B.
  Closed for now, after one long run: see [As built](#as-built-2026-10-16).

### Nothing that works today breaks

What each change touches, and what proves it still works:

| Today's flow | Touched by | Proved by |
|---|---|---|
| Pushing the agent's commits, opening, updating and closing PRs (`start over`), the PR on another account | nothing: apply, its write keys minted after decide, unchanged | `kernel-flow.test.ts` (projects end to end, ADR 0035; another account, ADR 0045), unchanged and green |
| A PR only after the box's checks; a failed check's one fix round; a new project's first push to `main` only after checks pass | the checks move to the finish | the same tests, now through the finish; a new test that a job ending before the finish opens no PR |
| The project's own CI on the PR, a merge followed to Live | nothing: the push and PR events as now | `kernel-flow.test.ts` ("Live"), the live check |
| Replies and comments, the door told, chats | nothing in apply; think's runner reads with the workflow's token, which plan, decide and apply already read with | `kernel-flow.test.ts`, `selftest chat` |
| `stop`, your words while it works | the token they read with | a test that think's runner reads with it; the live check at minute 65 and 70 |
| Talk, read and repeat runs; `close`, `reopen`, `continue`; due runs | nothing (no finish for them) | `kernel-flow.test.ts`, `selftest` |
| A stay | its default, a question, a `use` that changes nothing | `kernel-stay.test.ts`, the flow's stay tests, `selftest claude` and `selftest pi` (two answers in one stay) |
| The sandbox, a box's slots | the run folder kept for the finish, as for a stay | `sandbox.test.ts`, `selftest sandbox` |
| The apps | nothing in their pipelines | each app's `make verify` |

## Setup

None.

## Sources

1. GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
2. `GITHUB_TOKEN`: https://docs.github.com/en/actions/concepts/security/github_token
3. "GitHub token lifetime" (2019–2020): https://github.com/orgs/community/discussions/25699
4. Copilot coding agent: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/troubleshoot-coding-agent · https://github.com/orgs/community/discussions/159068
5. gh-aw: https://github.github.com/gh-aw/reference/rate-limiting-controls/
6. `claude-code-action`'s token: https://github.com/anthropics/claude-code-action/blob/main/src/github/token.ts
7. octo-sts: https://edu.chainguard.dev/open-source/octo-sts/overview/ · sts-cat: https://docs.rs/crate/sts-cat/0.3.0
8. openshift/release #82494: https://github.com/openshift/release/pull/82494
9. REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

## As built (2026-10-16)

One PR, with #489's two fixes. As planned, with one simplification, found while building:

- **The finish runs no agent.** The box's checks and the fix round stay in think, as before: they
  need no GitHub key, so the agent's hour doesn't touch them, and today's PR path is unchanged. The
  finish only fetches `main` (with the decide and apply read token, minted right after think: no
  new token step), and when it moved, refreshes the branch, checks it again and bundles it again.
  Where the refresh conflicts or the checks fail on the merged branch, the branch goes back to what
  the agent left, the PR opens from that, and the details say `continue` brings it up to date (the
  next run's start refreshes it, with the agent there for a conflict). So "no PR without the
  finish's checks" isn't needed: think's checks passed before it. It runs for a work run on a
  project of your own account that asks for a PR (`profile == 'work'` in `task.yml`); another
  account's or a repo with its own rules carries on as before.
- **Numbers:** `THINK_MINUTES` 353 (the agent 200, its fix round 20, the finish's 41 within it),
  the job's limit 460, the copy's prune 27600 s, `STALE_RUN_MS` 8 hours (tested ≥ the job's limit).
- **No new stored field or output:** the finish updates the run's own bundle and details; its step
  reads plan's `profile`.
- **A `use` that changes nothing:** `boxAnswer` (`stay.ts`), the box's own answer with the pick
  unchanged and only a stay's writes, posted in the stay.
- **Proven:** `pnpm verify` (1,233 tests), `pnpm test:golden`; the finish end to end with a real
  merge and a real conflict; the stay test fails without its fix. Live on homepi (task #502,
  2026-10-17): a work run's agent worked in one session from 01:03:48 to 02:02:06 UTC (129 turns),
  then a 2-minute resume to 02:04:02; the box's checks followed in the same think step, which ended
  at 02:18:29 (about 75 minutes); the finish found `main` unmoved, apply posted at 02:19, and a
  stay followed with a fresh read key: about 1h 26m in all, nothing failed.
- **The live check is closed for now.** Untried: your words at minute 65, `stop` at minute 70,
  `main` moving while the agent works, and the agent's own reads past its one-hour key.

