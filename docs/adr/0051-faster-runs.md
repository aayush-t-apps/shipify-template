---
status: accepted (merged #337) and built; see [As built](#as-built-2026-10-13)
date: 2026-10-11
amends: 0031 (the read-only copy of Shipify is made before the task step, on every run, and holds the built CLI that every step and the agent start)
---

# 0051: Faster runs: one built CLI, one read, measured

## The owner's asks (task #335, 2026-10-11)

- "what does plan stage do as of now in runs why does it take 10s or such can you breakdown any
  flow runs and tell me bottleneck which needs for faster runs"
- "i am waiting on answer for what takes time to run the flow in the box what all steps are
  bottleneck or time breakdown why plan takes so much time"
- "Can it be made clean and efficient well designed and optimized"
- To the plan (task #335's `shipify-plan.md`, part B): "Yes create the proper clean thought out
  plan detailed explained why how and when all of it"

## Context

A run's median is 164 s, and about 70 s of it is fixed: everything around the agent's thinking.
Only the thinking is the model's, and `use` already steers it. The fixed part is the same on every
run, a one-line answer included, so it's what you wait for most often.

Two things make it up, and both were measured on homepi (a Raspberry Pi with 4 cores):

- **Starting Shipify's CLI costs about 2.65 s, and a run starts it six times.** `pnpm ship` starts
  pnpm, then tsx, which transpiles the TypeScript at every start. The agent pays it again for each
  of its own `ship` commands.
- **Each GitHub call costs about 1 s, and they run one after another.** Plan reads the issue a
  second time only to write its status, and apply reads the issue and every comment a third time.

## What was found (checked 2026-10-11, `main` at `af1e188`)

| Fact | How it was checked |
|---|---|
| A run's median is 164 s: set-up, checkout, node, pnpm and install 15 s; task 6 s; token mints 5 s; **plan 12 s**; the agent's CLI check 5 s; think 88 s (16 s to 39 min); decide 4 s; **apply 17 s**; post steps 5 s | The step times of the last 20 task runs (`gh run view --json jobs`) |
| In the last run: pnpm 1 s, install 1 s, task 8 s, plan 12 s, the agent's CLI 3 s, decide 3 s, apply 28 s (it uploaded a file) | Run 38136845538's step times |
| Every step starts the CLI as `pnpm ship run <step>`: task, plan, agent, think, decide and apply, and `failed` when a run breaks. The push event's `task plans` does too | `.github/workflows/task.yml` (10 `pnpm ship` lines) |
| `pnpm ship --help`: **2.65 s**. `node cli/ship.mjs --help` (tsx, no pnpm): **1.85 s** warm, 4.1 s cold. A bare `node -e ""`: 0.08 s | Timed on homepi, Node 22.23.3, three runs each |
| The CLI built with esbuild as one file, its packages left outside: **0.93 s**. With its packages inside (1.9 MB): **0.66 s**. esbuild builds it in **0.19 s** | Timed on homepi. An earlier "0.3 s" in the thread was a bundle that had crashed on a missing package before it did anything |
| Of the 0.66 s, most is Node loading modules and zod building its schemas. Node's compile cache (`NODE_COMPILE_CACHE`) takes it to 0.59 s | `--cpu-prof` on the bundle; timed with and without the cache |
| Node's own type stripping can't run the CLI: it stops at `cli/lib/output.ts:57` (a parameter property) | `node --experimental-strip-types cli/cli.ts --help` |
| esbuild is already installed on every box: tsx depends on it, and tsx is one of Shipify's own `dependencies` | `node_modules/tsx/package.json` (`"esbuild": "~0.28.0"`); `package.json` |
| The CLI imports its modules statically (two `await import`s, both of its own files), and nothing reads `node_modules` at run time, so one file holds all of it | `grep` over `cli/` |
| Four places find a file next to their own source with `import.meta.url`: `PLATFORM_ROOT` (`cli/lib/config.ts:6`), the gitleaks config (`cli/lib/secret-scan.ts:24`), pi's gate (`cli/lib/agents/pi.ts:120`) and OpenCode's gate (`cli/lib/agents/opencode.ts:154`). In a bundle the last three point at the bundle's folder | Read; and in a bundle built from `main` |
| `PLATFORM_ROOT` is `../..` from its file. A bundle at `cli/dist/ship.mjs` sits two folders down too, so it still finds the root | Read; and in the bundle |
| The read-only copy of Shipify is made once per commit in the box's shared tools (a clone, then `pnpm install --prod`), only when a run thinks, after plan. The agent's `<ship>` is `node <copy>/cli/ship.mjs` | `task.yml` ("A read-only copy of Shipify"); `cli/kernel/think.ts` (`shipifyCopy`) |
| Every GitHub call is `gh` run by `spawnSync` through one wrapper, `run()` in `cli/lib/exec.ts`, which `cli/lib/github.ts` calls | Read |
| A `gh` call takes 0.8–1.1 s from the box. The task read makes 3 (2.9 s). Plan's snapshot makes 2 more (the repo list and the manifests, 2.2 s) | Timed on homepi in the previous run on this task |
| Plan writes its "Working on it." status from `rec().issue(n)`, a second read of an issue its snapshot already holds | `cli/kernel/run.ts:248` |
| Plan's other writes (`stuck` off, 👀 on each new comment and on new task words) are made one after another, then the status | `cli/kernel/run.ts:235-251` |
| Apply reads the issue and every comment again, for the status comment's id and the keys of replies already written | `cli/kernel/apply.ts:72-78` |
| The record can already read only the comments since a time (`comments(n, since)`) | `cli/lib/github.ts:238` |
| Apply's log says nothing between its start and the door's answer: 26 s with no line | Run 38136845538's log |
| The task tests run each step against a stand-in `gh` that keeps one issue | `tests/fixtures/fake-gh.mjs`; `tests/kernel-flow.test.ts` |
| Every change to `task.yml` so far has been made by the owner. An agent never edits `.github/workflows/` | `git log -- .github/workflows/task.yml`; the playbook's Never list |

## Options

**How the CLI starts on a box:**
- **A. tsx, as now** (+ nothing to build / − about 2 s of every start, six times a run)
- **B. Node's own type stripping** (+ no build / − it can't run Shipify's code today, and would
  bend the code to fit it)
- **C. One file built with esbuild, once per commit, its packages inside** (+ 0.66 s a start, with
  the build already on the box / − a build step, and four paths to fix)
- **D. C, plus Node's compile cache** (+ 0.07 s more / − a writable cache shared by every slot's
  user, for almost nothing)

**Where it's built:**
- **A. In the job's checkout, every run** (+ simple / − a build every run, and the agent's copy
  needs its own)
- **B. In the read-only copy, once per commit** (+ one build that every step and the agent share /
  − the copy step moves first and runs on every run)

**The GitHub calls:**
- **A. A cache across runs** (+ fewer reads / − a box that keeps state, which it never does)
- **B. Fewer reads in a run, and the independent writes at once** (+ no state / − a little
  concurrency in plan and apply)

## Decision

Chosen **C** built **B** (in the copy, once per commit), and calls **B**. Four parts, built in one
PR in this order, each measured by the first.

### B0. A timing line per step, and a call budget

- **The line.** `run()` in `cli/lib/exec.ts` counts each `gh` call and its time. At its end, each
  `ship run <step>` writes one line to the job's summary (`$GITHUB_STEP_SUMMARY`): `plan 3.9 s ·
  4 gh calls, 3.1 s (issue 0.9, react 0.8, …)`. Nothing else is counted anywhere else.
- **The budget.** A test runs each step on a recorded task against the stand-in `gh` (a talk run,
  answered from a comment) and fails when a step makes more calls than its budget. A count is
  exact where seconds aren't, so a change that adds a call fails its own PR's checks. The budgets
  are the counts after B2, written in the test. A change that needs one more raises it in its own
  diff, where a review sees it.
- **Why first:** every number after it is read, not guessed. Apply's 26 s with no log line is the
  first thing it explains.

### B1. One built CLI, once per commit: about 12 s

- **The build.** `pnpm build:cli` runs esbuild on `cli/cli.ts`: one ESM file, `cli/dist/ship.mjs`,
  its packages inside, Node's own modules outside, and a banner that gives bundled CommonJS its
  `require`. `esbuild` joins `dependencies`, pinned to the version tsx already installs, so nothing
  new is downloaded. `cli/dist/` is ignored by git.
- **Where.** The step "A read-only copy of Shipify" moves to just after checkout and Node, and runs
  on every run. When this commit's copy is built (its `.built` file), it only names it: no pnpm, no
  install, no build. When it isn't, it sets up pnpm, installs, clones the copy, builds the bundle
  from the checkout into the copy's `cli/dist/`, and marks it built. The copy itself gets no `pnpm install`
  any more: nothing in it needs `node_modules`.
- **Every step on a box** starts `node "$SHIPIFY_COPY/cli/dist/ship.mjs" run <step>`, and `task
  plans` the same. The job's own "pnpm" and install steps go. Measured: 2.65 s → 0.66 s a start, six
  starts, about 12 s. The ready copy saves pnpm and install too, about 2 s.
- **The agent's `<ship>`** is `node <copy>/cli/dist/ship.mjs` (`shipifyCopy()` in `think.ts`): each
  of its own `ship` commands starts about 1.2 s sooner.
- **The four paths.** The gitleaks config, pi's gate and OpenCode's gate are found from
  `PLATFORM_ROOT` (`join(PLATFORM_ROOT, "cli/lib/…")`). `PLATFORM_ROOT` stays the one place the CLI
  finds itself, and its `../..` holds from both `cli/lib/` and `cli/dist/`.
- **Off a box nothing changes.** Your PC, CI, the tests, the `github` job on GitHub's machines and
  the watch keep `pnpm ship` through tsx: edits work with no build. The watch's due run and
  clean-up run at most daily and nobody waits on them. On a box, every step of a task run switches
  in one go, and no step there starts the source.

### B2. One read of the task per run: about 2 s, more on a long task

- **Plan** writes its status from its snapshot's issue, not from a second read.
- **Apply** reads only the comments since the task step's read (`comments(n, since)`, one call),
  not the issue and every comment again. The task step's saved read keeps the reply keys it saw,
  and plan saves the status comment's id when it writes the first one, so apply has everything on
  the task: the status comment and every reply already written.
- **Safe to repeat, as before.** A reply this run already wrote, in an attempt before this one or
  earlier in this one, is found by its key, in the saved read or in the new comments. `since` is
  GitHub's updated time to the second, so it reads a little too much rather than too little.

### B3. Independent writes at once: about 2–4 s

- `cli/lib/exec.ts` gains an async `run` (`spawn`, the same counting and masking), and the record a
  way to make independent writes together.
- **Plan:** `stuck` off and the 👀 reactions go together with the "Working on it." status.
- **Apply:** labels and reactions go together, and with telling the door.
- **The order that matters stays:** each reply before the door is told about it, and the status
  last, after everything else has settled.

**Expected:** the fixed part goes from about 70 s to about 52–55 s. Plan from 12 s to about 4–5 s,
apply from 17 s to about 11 s, and the job's set-up 2 s shorter. B0's lines on the first runs after
the merge show what it really is.

## Narrowed out (measured)

- **One step for task and plan.** ADR 0045 needs the task's account known before plan's token is
  minted. With a 0.66 s start, merging them saves well under a second.
- **Fewer token mints.** About 1.5 s each, and each is there for a reason: a key scoped to its step,
  and a fresh hour after a long think. Not worth weakening for 3–4 s.
- **A repo list kept across runs.** It's read once a run already (2 calls). Keeping it would make a
  box keep state, which it never does.
- **Checkout and the runner's own set-up (about 13 s).** Mostly GitHub's action start-up. A
  container image for boxes is its own roadmap item.
- **Node's compile cache:** 0.07 s a start, for a cache every slot's user must share.
- **Shortening think.** It's the model's time, and `use` already picks the model.

## Edge cases

- **The first run after a merge** builds the copy: pnpm, install, a clone and a 0.2 s build, about
  the cost of today's set-up plus a few seconds, once per commit per box.
- **Two slots start on a new commit at once:** each builds into its own `.part` folder and the first
  `mv` wins, as today. The other's copy is removed and it uses the winner's.
- **The build fails** (a full disk, a broken commit): the step fails, and so does the run, before
  plan. `failed` can't say so on the task with no CLI, so the step's own message names the cause on
  the run's page, as when `pnpm install` fails today. A commit can't reach `main` with a bundle that
  doesn't build: CI builds it (Confirmation).
- **A copy made before this change** (a clone with `node_modules` and no `cli/dist/`) has no
  `.built`: it's removed and made again, once.
- **A step needs a file next to its source** that the build doesn't know of: the bundle test runs
  each step, so it fails in CI, not on a box.
- **A run on another account** (ADR 0045): the copy is Shipify's own, the same for every account.
  Nothing about tokens changes.
- **Calls in parallel and GitHub's secondary rate limit:** at most a handful of writes at once, the
  same writes as today, far under the limit.

## Setup

Nothing to set up. The first run on each box after the merge builds the copy by itself.

## How it's built

1. **After this ADR is merged and you say `go`,** a run on shipify builds B0–B3, the bundle script,
   the paths, `think.ts`, the tests and the docs, as one PR.
2. **The `task.yml` lines are yours to make.** An agent never edits `.github/workflows/`, so the run
   attaches them as a patch (`task.yml.patch`) and says how to apply it to the PR's branch from your
   PC. `tests/workflows.test.ts` checks the new layout, so the PR's checks pass only once the patch
   is in, and the change lands in one merge, with nothing half switched.
3. **After the merge,** the job summary of the next few runs shows each step's time and calls. If a
   step didn't get faster, its line says which call is to blame.

## Docs and clean-up

- `docs/design.md`: the steps table (each starts the built CLI on a box), the copy made first, the
  timing line.
- `docs/tour.md`: how a run starts (the copy first, then the steps).
- `docs/agents.md` and `cli/kernel/think.ts`'s comment: the agent's `<ship>` is the built CLI.
- `docs/troubleshooting.md`: reading a run's timing lines; a copy that didn't build.
- `docs/security.md`: the copy holds no `node_modules` any more.
- `AGENTS.md` ("Commands"): `pnpm build:cli`, and that a box runs the built CLI while a PC runs the
  source.
- `CHANGELOG.md`: one line.
- Removed: the run job's own "pnpm" and install steps (they run only inside the copy step, when
  it builds), the copy's own `pnpm install`, and its `.ready` mark.

## Consequences

- Every run waits about 15–18 s less, a one-line answer included, and the agent's own `ship`
  commands start faster.
- Each step's time and calls are on the run's page, and a new call shows in its PR.
- A box runs a built file, so a change to the CLI reaches a box only through a commit's copy: never
  a hand edit there. That's already how the copy works.
- One more thing to keep working: the build. CI builds and runs it on every PR.

## Confirmation

- **The bundle test:** CI builds `cli/dist/ship.mjs`, checks from esbuild's metafile that it
  imports nothing but Node's own modules, and runs every step from it against the stand-in `gh`.
- **The whole flow, from the built file:** the end-to-end tests in `tests/kernel-flow.test.ts` (a
  question answered; a change from the agent's commit to the PR on the task's branch; a run that
  stops early and its `continue`; a job re-run after it died, which posts nothing twice) run against
  the built CLI as well as the source. B2's narrower read must keep the re-run tests green
  unchanged: never weakened to pass.
- **The call budget:** each step's calls counted on a recorded task, against its budget.
- **`tests/workflows.test.ts`:** every box step starts the built CLI, the copy step comes right
  after checkout, and no step in the run job starts `pnpm ship`.
- **On the box:** each run's summary has a line per step with its time and its calls.

## As built (2026-10-13)

Built as written, from task #335's first build (#339, closed) with what a review against a real box
found, in one PR that changes `task.yml` too. The differences:

- **The workspace.** `workspace()` is the parent of the platform root, and the CLI runs from the
  copy, whose parent is the box's shared tools. `task.yml` sets `SHIPIFY_PROJECTS_DIR` to
  `<workspace>/../projects`, so a task's files and project clones stay in the slot's own workspace.
- **A plug-in finds its files through the contract.** pi's and OpenCode's gates are found with
  `agentFile` (`cli/lib/plugins/agent.ts`), from the platform root; the gitleaks rules use
  `PLATFORM_ROOT` directly.
- **A tool's server runs on Node where its launcher isn't installed.** The copy holds no packages,
  so `tools.json`'s `node_modules/.bin/tsx …` would not start; Node runs the TypeScript server itself
  (it strips the types), as it already did in an agent's sandbox. A server that can't start at all
  is a ✗ answer for each call, never a crash of apply.
- **A push's plans are read from the job's own checkout** (its full history): the copy may have been
  cloned first from a shallow one, which lacks the push's first commit.
- **The copy step:** runs starting together on a new commit each build in their own folder and the
  first moves it in (`mv -T`; the others drop theirs), which a test runs five at once; a failed build
  leaves nothing; a run marks its copy in use (its time), so the clean-up never takes a copy a run in
  flight is on.
- **Apply's read starts a minute early.** The task step saves the time it started reading, minus a
  minute; apply reads the comments from there and merges them with the saved read by id, the newer
  copy winning.
- **The think step still reads the issue and its comments** to fetch your attachments (their links
  last minutes). B2's one read is plan's and apply's.
- **The door is still told of each reply in turn,** not together: a chat shows them in their order.
- **The call budget is counted in the flow test**, per step, on a talk run against the stand-in
  `gh`, which takes one call at a time since writes started together would otherwise race on its
  state file.
- **From the built file:** two whole runs of the flow test (a change to its PR, and a job re-run that
  writes nothing twice) run every step from it, and `tests/bundle.test.ts` runs it from a copy made
  as a box makes it (this commit's files, no packages): its plug-ins found, each tool's server
  started. Every flow test isn't run twice: the source and the build are the same code, and what
  differs (loading and paths) these cover.
