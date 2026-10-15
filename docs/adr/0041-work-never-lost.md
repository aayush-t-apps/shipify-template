---
status: accepted (merged #225) and built (one PR, the owner's go on 2026-10-07: "done merged go ahead keep docs updated"); proposed from (the owner's request of 2026-10-07: research how agents like Claude Code and pi do big tasks, whether they keep our rules, and how work carries on when something breaks; check the parallel and worktree flows; "models get better so the harness stays minimal"; then "only what's needed, clean and simple". Merging its PR accepts the design and its build plan)
date: 2026-10-07
amends: 0031 (the agent's handoff), 0035 (kept work, now on every end)
---

# 0041: Work that's never lost, and a clean box

## The plan in short

The agents already work well on their own. In task #182, Claude Code started its own helpers, two
in parallel, and finished a big build in 38 of its 50 minutes. Shipify adds no agent machinery. It
closes the few places where work can be lost between runs, and cleans the box once:

1. **A run that stops to ask you keeps its commits,** as a failed or stopped one does today. Today
   it loses them.
2. **The handoff survives a stop.** Today a run cut off by its clock or a crash leaves none.
3. **A checkout inside the clone is never committed,** for every agent. Today a stopped run could
   push a helper's worktree as a broken entry.
4. **A one-time clean-up:**
   - the box's unused shared browser folder goes;
   - the runner's old browsers (about 662 MB) are freed;
   - dead code goes.

Nothing else changes: no new run, word, key, store or service, and no app is touched. The parallel
and worktree flows stay as they are; both were checked and work.

## What it never does

- **It starts no run.** Runs still start only from your words, a button, or a schedule you set
  (ADR 0040).
- **It does nothing in the background.** Kept commits are pushed to the task's own branch at the
  end of the run you started. Every workflow, in every repo, starts only on `main` or a PR's
  events, so that push starts nothing. The browsers are tidied by the weekly clean-up that already
  runs.
- **A box never picks up work by itself.** A run carries on from a task's branch only when you write
  on that task, as today. A stopped run waits for your `continue` (ADR 0040). `start over` begins
  from `main`.
- **Every rule stays:**
  - the agent only thinks;
  - the box makes every change after it stops;
  - approvals stay on GitHub;
  - the checks are the same on the PC and the box.

## Every channel, after this

| Where | What you see |
|---|---|
| Web chat | The same lists, threads, replies, quick answers, run lines and Status & setup. The edge's code doesn't change, and it reads nothing this touches (a task's handoff or branch) |
| Telegram, a GitHub task, the status page | The same |
| `ship` on the PC | The same, except `ship pr --check` refuses a commit that records a checkout inside the repo. No repo has one today |
| The box | After you answer a question mid-change, the next run carries on from the kept commits instead of redoing them. Each slot downloads its test browser once more (about a minute) |
| Your apps | Untouched |

## What was found

| Found | Where |
|---|---|
| A work run that stops to ask you something (`needs-you`, no PR asked) loses its commits: only a PR, a failure or a stop keeps them | `think.ts:531`, `decide.ts:1547` |
| A run stopped by its clock, your plan's limit or a crash leaves no handoff: it only comes in `result.json` | `result.ts`, `decide.ts:1608` |
| A worktree inside the clone (Claude Code puts its helpers' at `.claude/worktrees/<name>`) goes into the box's "Work in progress" commit (`git add -A`) as a broken submodule entry, without its files | reproduced with git 2.43 |
| The machine's shared browser folder (`/opt/shipify/ms-playwright`) is empty on the Pi: each slot downloads its browser once into its own cache. The runner's copy from before setup 5 is used by nothing | the Pi, `box/setup.sh`, `cli/lib/sandbox.ts` |
| The box's old task-worktree code has no callers since ADR 0031; the clean-up's sweep of it found "0 old worktrees". Adapters' `projectSettings` is used nowhere | `cli/commands/task/checkout.ts`, `cli/lib/plugins/agent.ts` |
| The edge reads no task's handoff or branch (its `notes` are the watch's own findings); no repo has a submodule (`git ls-files -s`, mode 160000) | `edge/src`, every repo |
| Nothing has taken PR screenshots since the 0.1 core (27b91c3 removed `screenshots()`'s caller), yet the prompt still asks the agent for `pages` "screenshotted for review", and `docs/process.md` promises "screenshots on the task" | `prompt.ts`, `result.ts`, `cli/commands/task/files.ts` |
| Intact, nothing to change: the PC's parallel flow (two worktrees, a sibling merged first, `ship refresh`, `pr --check`, `make verify` in both at once) and the box's (180 tests) | a sandbox copy of spotter; the tests |

## 1. A run that stops to ask you keeps its commits

A work run that ends `needs-you` without asking for a PR (a question mid-change) keeps its commits
on the task's branch, as a failed or stopped run does today (ADR 0035). Edits not yet committed go
in first, as one "Work in progress" commit. ADR 0035's two guards stay: never into an open PR, never
a new project's first push. The reply is unchanged: a question reads as it does today, and nothing
new is said when a guard applies. When you answer, the next run starts from the branch. A run that
ends `done` is unchanged.

## 2. The handoff survives a stop

The agent keeps `out/handoff.md` current as it works: what's done, what's next, what it decided.
The box takes it however the run ends, and the next run gets it as today ("Your notes from the last
run"). It replaces `result.json`'s `handoff` field, so there's one way to hand off; the result stays
`v: 2`. A run that writes none leaves the last one; `start over` clears it. The playbook adds one
line: check the branch's `git log` and the tests before trusting the notes.

## 3. A checkout inside the clone is never committed

One rule for every agent, naming none:
- **The box's commit:** before its "Work in progress" commit, the box marks every checkout git lists
  inside the clone (`git worktree list`) as ignored, in that clone only (`.git/info/exclude`).
- **The PR:** `ship pr --check` refuses commits that record a checkout (a gitlink with no
  `.gitmodules` entry), with the fix. The same check runs on the PC and on a box, before any PR.
- **The playbook:** one line: a helper's work counts once it's merged into `work`.

## 4. Clean-up, once

- **The box's browsers:**
  - **What goes:** the shared folder and what links it into runs: `SHIPIFY_AGENT_SHARED`,
    `sharedFolders`, a run's `shared/` links, and setup's `/opt/shipify/ms-playwright` with its two
    `.env` lines.
  - **Where a run's browser lives instead:** with its other downloads, in the slot's own `cache/`.
    Each slot downloads it once more (about a minute).
  - **The weekly clean-up** (it runs as the runner) removes the runner's old `~/.cache/ms-playwright`
    and each slot's old `shared/`, and says what it freed.
  - **Nothing to run on the Pi:** the empty folder and the two lines go the next time box setup
    runs. No setup version change, no sudo.
- **Dead code:**
  - in `cli/commands/task/checkout.ts`: `checkout`, `pushWork`, `prsFor`, `projectRepo` and
    `staleWorktree`;
  - the clean-up's sweep of `.worktrees/<project>/task-<n>`;
  - `projectSettings`, from the agent contract, both adapters and the template;
  - the screenshot promise: the prompt's and result's `pages`, `screenshots()`, and the docs'
    lines. Screenshots for review can come back later as a change of their own.
- **Docs:**
  - `docs/agents.md` says what the agent decides for itself (helpers, plans, its context), and that
    the walls (its own user, read-only keys, the box making every change) bind its helpers too;
  - `docs/security.md` says an agent's own allow list is a layer, not a wall;
  - the next Claude Code version PR checks that runs still load CLAUDE.md and skills, since its docs
    say `--bare` will become the default for headless runs;
  - the playbook's line naming Claude Code's own worktrees becomes the common rule (§3).

## Left for later

| Idea | Why later |
|---|---|
| A big build in steps, several PRs in order | Builds fit one run today (#182: 38 of 50 minutes); kept work and the handoff already let `continue` carry a longer one on |
| `from #n`: a new task carrying on an old one | Reopen and `continue` covers it |
| `ship refresh` after a squash merge, with nothing to release | It stops; but every repo deletes a merged branch, so a run starts from main and never meets it |
| Resuming the agent's own session across runs; agent teams, swarms | The record is where a run resumes; teams don't run headless and cost many times the tokens |

## Build plan (one PR, after this one merges)

1. **Tests first,** each failing on today's code:
   - a `needs-you` run with commits keeps them; a `done` one is unchanged;
   - the two guards still hold;
   - a clock stop and a crash keep `out/handoff.md`;
   - the box's commit leaves out a checkout inside the clone, under any name;
   - `ship pr --check` refuses a recorded checkout and passes a real submodule;
   - a run is prepared with no shared links;
   - the clean-up removes the old browsers and says how much;
   - every channel unchanged: the edge's tests, and the web chat in a browser against the fake
     world, with the same lists, threads, replies and quick answers before and after.
2. **§1 and §2:** `think.ts`, `decide.ts`, `result.ts`, `prompt.ts`, the playbook.
3. **§3:** the box's exclude, `pr --check`'s refusal, the playbook line.
4. **§4:** the browsers, the dead code, the docs.
5. **Live, on the Pi,** each started by you or with your go:
   - a run that asks a question mid-change, asked from the web chat, keeps its commits, and its
     reply looks as today;
   - a `stop` mid-run keeps its handoff;
   - the runner restarted mid-run shows Stopped (ADR 0040's last unchecked case), its work kept,
     and `continue` carries on;
   - the weekly clean-up's summary shows what it freed.

Done means:
- **clean:** no leftovers, words as in the glossary;
- **tested:** unit, end to end against the fakes, then live;
- **handled:** every failure names its fix;
- **set up:** nothing new to set up.

**Docs it touches:**
- `playbooks/task.md`, `playbooks/parallel-work.md`;
- `docs/tasks.md`, `docs/process.md`, `docs/agents.md`, `docs/security.md`, `docs/box-setup.md`, `docs/watch.md`,
  `docs/cli.md`, `docs/glossary.md` (**handoff**, **helper**), `docs/context.md`;
- the ADR index, `CHANGELOG.md`.

## As built (2026-10-07)

All four parts as written, tests first (each failed on the code before). Where the build differs
from the text above:

- **The runner's old browsers go in the clean-up job's own prune step** (`watch.yml`, beside the
  package store's prune), not in `ship watch cleanup`: the core names no project tool (ADR 0010,
  `tests/core.test.ts`). The job runs only on its box, and its log says how much it freed. The
  status task's summary says what the slots' old folders freed.
- **Worse than found:** a repo of its own with no commit inside the clone stopped the box's "Work in
  progress" commit outright (`git add -A` fails at it), so every edit not yet committed was lost.
- **One add for the box and the PC** (`cli/lib/checkouts.ts`), not an exclude file: every
  untracked checkout git lists (`<path>/`, NUL-separated so no name is quoted), each left out as a
  literal pathspec so none is a pattern. The box's "Work in progress" commit and `ship pr`'s use
  it, so no name, accent or `[1]` slips through, and it names no folder and no tool. The PR's
  check looks at the index and the commits both, so a `git rm --cached` left uncommitted doesn't
  pass, and it's the first rule of every PR's checks: `ship pr --check` on the box and `ship pr`
  on your PC refuse alike. The add needs only git (2.26 or newer, which `ship doctor` checks),
  `xargs -0` and `sh`.
- **A question's kept push is quiet** (an independent review found the first build's wasn't):
  apply adds nothing to its reply when it works, and when it fails (a workflow file among the
  edits, a key the scan finds, a write token GitHub couldn't mint: `task.yml`'s step may fail only
  for such a push) the question stands as it was, with the failure in the run's log. A job re-run
  after it died inside that push says nothing of it either.
  The task's project and plan in its status stay as they were; only the branch is new. Tested end
  to end, through apply (`tests/kernel-flow.test.ts`).
- **The stacks' `shots` command stays** (`stacks/_cloudflare/shots.mjs`): removing it is a stack
  change every app would see. Screenshots, if they come back, start from it, and
  `docs/configuration.md` says nothing takes them today.
- **`checkout.ts` is gone:** `slotWorkspaces`, its one function still used, moved to
  `lifecycle.ts`.
- **`pr --check`'s fix names `git -C <clone> rm --cached`:** that's the form an agent may run.
- **Every channel unchanged:** nothing under `edge/` changed (the door, the web chat's page, the
  channels), so the web chat, Telegram and the status page run the same code. The replies they show
  are held as before by tests: decide's with and without kept commits, its guards included, and
  the posted reply end to end through apply.
- **Left for later:** a task that ends with no PR leaves its branch on the project's repo, as a
  failed or stopped run's does today; questions make that a little more common.
- **Live checks,** each started by you or with your go after the merge: a question mid-change from
  the web chat, a `stop`, a runner restart mid-run (ADR 0040's Stopped), and the next weekly
  clean-up's summary.

## Sources

Read on 2026-10-07.
- Claude Code: [subagents](https://code.claude.com/docs/en/sub-agents),
  [agent teams](https://code.claude.com/docs/en/agent-teams),
  [headless](https://code.claude.com/docs/en/headless),
  [worktrees](https://code.claude.com/docs/en/worktrees).
- Anthropic, [harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  and [harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps).
- pi, [a minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/).
- Cognition, [what's actually working](https://cognition.com/blog/multi-agents-working).
