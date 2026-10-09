---
status: accepted (merged #172; built in #173, see docs/context.md for where the build differs). Proposed from the owner's request of 2026-10-05: an absolutely clean setup of what's critically needed, that works well; clean, simple, flexible, up to date, with every flow kept whole and nothing broken; and the limits of how far it scales, free and paid; merging its PR accepts the design and its build plan)
date: 2026-10-05
amends: none (it extends #167's kept work to every stop)
---

# 0035: Runs that never lose work

## Read this first

Shipify's flows are proven live. Four things still break under long or heavy work, and this ADR
fixes only those. Nothing else changes: no new part, store, dependency, secret or version, and every
flow keeps its shape.

1. **A stopped run keeps its work.** Today only a failed check keeps the agent's commits. A run that
   hits its 50-minute clock, uses up your plan, or crashes throws them away. After this, every
   failed or stopped work run keeps them on the task's branch, and the reply says why it stopped.
   `continue` carries on.
2. **Tokens last the run.** One read token (one hour, GitHub's fixed lifetime) serves the whole run
   today. A long run reaches decide after the hour, its reads fail, and the work is lost. After
   this, each phase mints its own right before it starts, and the job's time limit is the sum of
   its clocks.
3. **A work run's agent reads one project.** Its token covers every repo today. After this, it
   covers the task's project and Shipify, as the **work** profile already says. A **talk** run
   still reads every project.
4. **The watch looks at every app.** It checks 8 apps a tick, but always the same first 8. After
   this, it takes them in turn.

Then [how far it scales](#how-far-it-scales), free and paid.

## 1. A stopped run keeps its work

**When.** A work run (a task on a project's clone: an app, Shipify itself or the playground) that
ends without a PR to push:
- the agent's clock ran out (50 minutes);
- your plan's window was used up;
- it crashed, or its answer didn't read;
- it answered `failed` without asking for a PR.

**What the box does.** After every agent process has stopped, as today, the box checks the clone
for anything beyond its base (the task's branch, else `main`). Edits not yet committed go into one
commit, `Work in progress: <why it stopped>`, made in the clone as the agent's user. Then the box
makes the bundle exactly as for a PR (`bundle()`). It records in `meta.json` (the box's own facts
about the run) that the agent stopped, why, and that the work is kept.

**What decide does.** If no push was asked and `meta.json` says work is kept, decide makes a push
with `open: false` to the task's branch. That's #167's path, unchanged: apply pushes, the key scan
runs on the change, and no PR opens. Its two guards stay:
- never into an open PR, which you might merge;
- never a new project's first push, which goes to `main` and deploys.

In those two cases the reply says the commits weren't kept, and why. A push with `open: false`
needs no title or body, and its type says so.

**What the reply says.** One problem from the catalogue, so its fix is always there:

| Code | What | Fix |
|---|---|---|
| `agent-stopped` | The agent stopped before it finished: it ran for 50 minutes, it crashed (exit N), or its answer didn't read | Reply `continue`: the next run starts from what's kept on `<branch>` |
| `plan-used-up` | Your plan's 5-hour (or weekly) window is used up; it resets at `<time>` | Reply `continue` after `<time>` |

A talk run that stops has nothing to keep, and gets the same problem without the branch.
`unexpected` stays for anything else. The reset time comes from the agent's own rate-limit report,
which the run's details already show.

**The playbook** gains one line: commit after each step that works, so a stop keeps more.

## 2. Tokens that last the run

Today the run mints one read-only token before plan, and plan, think, decide and apply all use it.
GitHub's App tokens last one hour, fixed [1]. A run that thinks long reaches decide after that: the
agent takes up to 50 minutes and the checks 25, then a fix round of 50 and 25 more. Its reads fail,
the run breaks, and the work in the run's folder is lost.

After this, there's one read token per phase. Each is minted right before its phase, with the same
action and key as today, on the box, and never in the agent's step:

| Phase | Its read token | Change |
|---|---|---|
| plan | minted before plan | none |
| think | minted before think, for the agent (part 3) | a new step |
| decide and apply | minted before decide | a new step |
| apply's writes | minted after decide, for one repo | none |

The box's checks never fetch (`ship pr --check` doesn't), so a fix round past the hour still
checks. Only the agent's own reads past the hour would fail, and its clone already holds what it
needs.

**The job's limit is the sum of its parts.** Think's clocks are 50 + 25, twice with the fix round:
150 minutes. Setup, decide and apply take about 10 more, so the limit becomes 160, up from 120.
Today a run with a fix round can outgrow its own job, and GitHub cancels it mid-way. A test reads
`task.yml` and the clocks in `think.ts`, and fails if the job's limit is less than their sum, so a
changed clock can't silently outgrow it.

## 3. A work run's agent reads one project

plan already knows the run's profile and project. It now also outputs `repos`, the repos the
agent may read:

| Run | `repos` | The agent reads |
|---|---|---|
| work, on a project already on GitHub | `<project's repo>,shipify` | that project and Shipify |
| work, on Shipify itself | `shipify` | Shipify |
| work, on a new project before its repo exists | empty | every repo, as today |
| talk (a question, a repeat, a recipe) | empty | every repo, as the talk profile says |

The think step's mint takes `repositories: ${{ steps.plan.outputs.repos }}`. Given an owner and no
repos, the action covers every repo the App is installed on [1], so empty means today's behaviour.
The permissions are today's: contents, metadata, pull requests, issues, statuses and actions, all
read.

If a web page or a tool's output ever tricks the agent, it can read one project, not all of them.
To look across projects, ask without naming one: that's a talk run.

## 4. The watch looks at every app

A tick has 50 calls on Cloudflare's free plan [2]. The watch keeps 44 and looks at 8 apps a tick.
Today that's `apps.slice(0, 8)`: always the first 8, so a ninth app is never checked. After this,
it takes 8 a tick in turn, starting from the tick's number × 8 and wrapping round. Every app is
looked at within ⌈apps ÷ 8⌉ ticks of 5 minutes. With 8 apps or fewer, nothing changes.

## Every flow, after this

| Flow | If the agent stops early |
|---|---|
| A change on a project (a new task, `continue`) | Kept on the task's branch; `continue` carries on |
| Several tasks on one project at once | Each keeps its own branch, as now |
| A task whose PR is open | Not pushed into the PR (#167's guard); the reply says so |
| A new project's first build | Not kept (its first push goes to `main`); the reply names the stop |
| Shipify itself, the playground | As any project |
| A question, a repeat, a recipe (talk) | Nothing to keep; the reply names the stop; a repeat still pauses after 3 failures |
| Operations, releases, a merge's deploy | No agent: unchanged |
| A box that dies mid-run | The watch starts it again, as now, from what the branch holds |

## How far it scales

The binding limit for you is thinking: one Max plan, shared by every slot. Boxes come next, then
GitHub's calls on Shipify's repo, which every run's record uses.

| What bounds it | Now (free) | With paid plans | Beyond that |
|---|---|---|---|
| Thinking | One Max plan's 5-hour and weekly windows, shared by every slot [3] | A higher Max tier | The Claude API, paid per token, with tier limits [4]; personal plans can't be pooled. The company track (ADR 0034) |
| Tasks at once | One per slot. The Pi runs 2 (about 4 GB a slot); at 3 slots, test ports clash about 0.3% of the time | Bigger or more boxes | 10,000 runners per group [5] |
| Calls on the record (Shipify's repo, through the workflow's token) | 1,000 an hour per repo, shared by every run and due run [6]. At a few dozen calls a run, roughly 30 runs an hour (an estimate) | 15,000 an hour on Enterprise Cloud [6] | More record repos (a company concern) |
| Replies and comments created | 80 a minute, 500 an hour per identity [7] | The same on every plan | Spread across identities |
| The bot's calls (reads, pushes, PRs) | 5,000 an hour per installation, rising with repos to 12,500 [6] | 15,000 an hour on Enterprise Cloud [6] | |
| Runs waiting on one task | 100 [8] | The same | |
| One run | 160 minutes (this ADR). A self-hosted job may run 5 days and wait 24 hours [5] | The same | Long work continues across runs from the task's branch (part 1) |
| The watch | 50 calls and 10 ms of CPU a tick; 8 apps a tick [2] | Workers Paid: 10,000 calls and 30 s of CPU [2] | |
| The edge's requests | 100,000 a day [2] | No daily limit [2] | |
| Projects, tasks, repos | No limit Shipify sets | | |

So on one Max plan, you can run as many tasks at once as your boxes have slots. How long they can
all keep thinking is up to the plan. GitHub's own limits come into play only well past that.

## What's left out, and why

- **A spend or turn cap per run.** The plan's windows and the run's clock are the real limits; you
  asked for no others.
- **A live end-to-end suite.** Real tasks prove the flows. A suite is more code to keep up, taps
  from you, and runs on your plan.
- **Retrying a stopped run by itself.** `continue` is one word, and a run that stopped for the plan
  would only stop again.
- **Keeping work beside an open PR** on a second branch. An open PR's branch gets only work that
  passed the checks.
- **Minting off the box, and a firewall for the agents' users.** Both stay in
  `docs/security.md`'s list, as now.
- **The smaller gaps** in `docs/context.md`: "ok" as an answer, tasks closing after Live,
  `continue` after a failed first build, "Merged" for a PR from the PC, a words table, and a
  stale-sibling notice. Each waits until it bites.

## Build plan

One PR, from a fresh `main`:

1. **Part 1:** `cli/kernel/think.ts` (keep the work, and record the stop), `cli/kernel/decide.ts`
   (the kept push), `cli/kernel/types.ts` (`open: false` needs no title or body),
   `cli/contracts/problems.ts` (two codes), `playbooks/task.md` (one line).
2. **Part 2:** `.github/workflows/task.yml` (two mint steps; the job's limit).
3. **Part 3:** `cli/kernel/run.ts` (plan outputs `repos`), and the think step's mint in `task.yml`.
4. **Part 4:** `edge/src/watch.ts` (apps in turn).
5. **Tests:**
   - think, with the fake agent: it commits, then runs out of time, exits non-zero, writes no
     answer, or reports the plan used up. Each time, the bundle is made and the stop is recorded;
   - decide: kept work makes a push with `open: false`; an open PR or a first build makes none, and
     the reply says so;
   - the workflow: each step's token, `repos` from plan, and the job's limit at least the sum of
     the clocks;
   - the watch: a ninth app is looked at.
6. **Docs** (below), then `pnpm verify`, the golden tests, and the PR.
7. **After the merge, live on the Pi:** an ordinary links task, from the chat to its PR. That proves
   the tokens per phase and the narrower read on the real box. The stops are proven by the flow
   tests, which run think's own code against a local remote.

**Done means:**
- **clean:** no leftovers, and the words match the glossary;
- **tested:** unit, the flow tests with the fake agent, and live on the Pi;
- **handled:** every stop is a catalogue problem with its fix;
- **configured:** nothing new to set up (no new secret, variable or box step);
- **documented:** every doc below.

## Docs it touches

- `docs/tasks.md`: a stopped run, kept work, and the two problems.
- `docs/security.md`: the agent's token for each profile, and one token per phase.
- `docs/design.md` and `docs/end-to-end.md`: the run's tokens.
- `docs/watch.md`: apps in turn.
- `docs/troubleshooting.md`: "the agent stopped" and "your plan is used up".
- `docs/glossary.md`: **kept work** (like a checkpoint): a failed or stopped work run's commits, on
  the task's branch with no PR, where `continue` starts.
- `playbooks/task.md`: commit after each step that works.
- `docs/context.md`: the current state, and the gaps left for later.
- `CHANGELOG.md`.

None becomes obsolete.

## Sources

1. actions/create-github-app-token, [README and source](https://github.com/actions/create-github-app-token):
   an installation token expires after one hour; with an owner and no `repositories`, it covers all
   the owner's repos.
2. Cloudflare, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
3. Anthropic, [Claude Code costs](https://code.claude.com/docs/en/costs)
4. Anthropic, [Claude API rate limits](https://platform.claude.com/docs/en/api/rate-limits)
5. GitHub, [Actions limits](https://docs.github.com/en/actions/reference/limits)
6. GitHub, [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
7. GitHub, [Secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)
8. GitHub changelog, [Concurrency groups now allow larger queues](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues)
   (2026-05-07)
