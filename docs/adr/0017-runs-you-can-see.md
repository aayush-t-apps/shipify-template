---
status: accepted (the status issue's clock parts: superseded by 0019, which keeps the issue as the record's page)
date: 2026-10-01
---

# 0017: Runs you can see and steer: details, a model per task, links, and boxes that look after themselves

## Context
A task's issue says what was done, but not how:
- not which model ran, at what effort, for how long, with which tools or how many tokens;
- not what the clock or the weekly clean-up did.

Every run uses Opus, the heaviest model on the plan's limits, and nothing lets a task choose.

PRs reach their task only when the agent remembers `--task`. Plan, change-doc and release PRs never
do, and the task's own list of PRs is wiped by the next status update.

Runs spend about 45 seconds before the agent starts. The docs have drifted: about 20 stale
statements, and no single name or glossary for the whole setup.

The owner asked for all of this to be visible on GitHub issues, with one simple core that any agent
plugs into, boxes that keep themselves current, and nothing rebuilt or upgraded.

## What exists, and what's missing

| Ask | Today | Missing |
|---|---|---|
| Run details on the issue | box name and the run link, in the status comment only | agent, model, effort, tokens, tools, time per phase; a history of runs |
| Model and effort per task | none: Claude Code's default (Opus 5.5, medium effort) | a choice on each form, and a lighter Auto |
| Issues as the reference | task replies and status comments | the clock's and the weekly clean-up's activity (now only in Actions logs) |
| One core, any agent | `executors.json` per agent. Claude-specific flags (tools, guard, text output) live in `task.ts` | one place per agent for its flags and its output |
| PRs linked to their task | `Closes` on `ship pr` only with `--task`; spotter #6 and #7 have it, other PRs don't | plan, change-doc and release PRs; a list on the task that survives updates |
| Fast start | about 23s of workflow steps, then 19–24s inside `ship task run` before the agent (runs 36872543732, 36867279120, 36841704259) | repeated label, sync and fetch calls trimmed |
| Always current | each job runs its commit; the clock hands over to new code within 5 minutes; projects are fetched before use | Claude Code's self-updater isn't switched off |
| Plug-and-play boxes, more machines | `box add`; any free box takes the next job; one clock runs at a time on any box | nothing notices a box set up by older steps; `box remove` leaves its services restarting |
| README end to end | a product pitch; the boxes, clock, bot and tools are missing | the name, how it works, glossary, decisions, policies |

## Assumptions, checked (2026-10-01)

| Assumption | How it was checked |
|---|---|
| Claude Code 2.1.284 takes `--model` (aliases `haiku`, `sonnet`, `opus`, `fable`) and `--effort low\|medium\|high\|xhigh\|max` | `claude --help` from the pinned version; a live call with each alias reported `claude-haiku-4-5-20251001`, `claude-sonnet-5-5`, `claude-opus-5-5` and `claude-fable-5-1` |
| With no `--model`, the subscription's default is Opus 5.5 | Live: the run's init event reported `claude-opus-5-5` |
| Default effort is medium on Sonnet 5.5 and Opus 5.5; Haiku has none and ignores the flag | code.claude.com/docs/en/model-config; live: `--model haiku --effort low` succeeded |
| `--output-format stream-json --verbose` reports everything the details need | Live: `init` (model, version, tools, MCP servers), `assistant` (each tool call), `rate_limit_event` (5-hour and weekly use, reset times), `result` (per-model tokens incl. cache and thinking, turns, duration, refused calls, web searches) |
| The cost it reports isn't billed on a subscription | code.claude.com/docs/en/costs: a client-side estimate at API prices |
| Anthropic recommends Sonnet for most work, Opus for hard design | code.claude.com/docs/en/costs |
| A dropdown can preselect an option | GitHub's form schema: `default`, an index into `options` |
| `Closes owner/repo#n` works across repos, closing only on a merge into the default branch | GitHub's docs, "Linking a pull request to an issue" |
| An issue the workflow's own token creates starts no workflow | GitHub's docs: events from `GITHUB_TOKEN` start none, except dispatches |
| The workflow's token can pin an issue | **Not known:** step 6 tries it once; otherwise the owner pins it (two clicks) |
| The Pi's 04:30 restart is local time, and updates cover `gh` | On homepi: time zone Asia/Kolkata; the apt origin is `gh` |
| The pinned Claude Code hasn't drifted | Run logs on homepi: 2.1.284 |

## Options
Only where there was a real choice:
- **Reading what the agent did:**
  - **A:** its own stream (`stream-json`), through an adapter per agent (+ exact, live / − one reader per agent).
  - **B:** ask the agent to write its tokens into the result (− it can't know them).
  - **C:** read Claude's session files on disk (− undocumented, Claude only).
- **Where a task's model lives:**
  - **A:** two dropdowns on the forms (+ visible, editable, checked like any answer).
  - **B:** a comment command such as "use opus" (− one more word to learn, and hidden in the thread).
  - **C:** labels (− a label per model and effort).
- **The clock's activity:**
  - **A:** one "Shipify status" issue it keeps up to date (+ on GitHub, notifies on problems / − one more issue).
  - **B:** the admin page only (− not on GitHub, nothing notifies).
  - **C:** each task's own history only (− the clock's health and the clean-up have nowhere to go).

## Decision
Chosen **A** in all three, as eight small parts. The core stays one generic loop:
- it asks an agent for a run (prompt, model, effort, tools) and gets back the result file and a
  report;
- everything agent-specific lives in that agent's adapter.

### 1. Agents plug in through an adapter
- **The interface:** `cli/lib/agents.ts` holds the interface, the model choice and a plain reader.
  - An adapter, such as `cli/lib/agents/claude.ts` (about 150 lines), knows the agent's flags for the
    model, the effort and the tools (moved out of `task.ts`, with the act-run guard).
  - It also reads the agent's output, line by line, into a report.
- **`executors.json` names the adapter.** In the `claude` entry, `"adapter": "claude"` replaces
  `"tools": "claude"`, and `"auto": {"model": "sonnet", "effort": "medium"}` sets Auto. Its
  `--output-format text` goes, because the adapter sets the output.
- **Agents with no adapter** (Codex, OpenCode) run as today: their output goes to the log as it is,
  and their details are the agent, the time and the exit code.
- **Act runs** need an adapter that takes tools, not the agent named `claude`.
- **`runAgent` is the only core change:**
  - it starts the agent in its own process group;
  - it reads its output as it comes, with no 64 MB buffer to overflow;
  - it prints a readable line per step to the Actions log (`→ Bash: make verify`, `→ notion.search`);
  - it keeps the raw output of the latest run at `.tasks/<n>/agent.log` on the box, never posted;
  - at 50 minutes it stops the agent and everything it started.
- **The result file still decides the outcome.** The report only adds details, and a report that
  can't be read never fails a run.
- **Two fixes come with it:**
  - `DISABLE_AUTOUPDATER=1`, so the pinned Claude Code never updates itself;
  - the prompt goes into `{promptText}` literally (`$&` in a prompt no longer expands).
- **Adding an agent:** an `executors.json` entry, then an adapter for its model, tools and report
  (`docs/agents.md`).

### 2. A model and an effort per task
- **Every form with an agent gets two dropdowns.** Those forms are change, new project, experiment,
  question, repeat, get something done and something else.
  - **Model:** Auto, Haiku, Sonnet, Opus, Fable.
  - **Effort:** Auto, Low, Medium, High, Extra high, Max.

  Both are preselected to Auto. Release and Check a box run no agent, so they get none.
- **Auto is Sonnet at medium effort,** from `executors.json`: one line to change, by PR.
- **The choice is read from the issue on every run:**
  - edit the task to change it, and the next run uses the new one;
  - older issues and blank ones run on Auto;
  - CI fixes and approved (act) runs use the same choice.
- **Forms are recognised without the shared fields.** Model and Effort don't count towards which
  form an issue came from, so older issues still match their form. A body holding only those
  headings isn't taken for a form.
- **A choice that can't apply** runs on Auto, and the run's details say why. That covers an answer
  that's no longer an option, a model the agent doesn't have (another agent, or one picked by
  `result.executor`), and effort on Haiku.
- **A test keeps the forms in step** with the Claude adapter's names and with Auto's description.

### 3. Run details on every reply, and a history on the task
- **Each reply ends with one folded block:**

  ```
  ▸ Run details: Sonnet 5.5 · medium · 1m 32s · 186k in, 6.1k out
    Started   your comment · 1 Oct, 14:20 · on homepi · the run ↗
    Agent     Claude Code 2.1.284 · claude-sonnet-5-5 (Auto) · effort medium (Auto)
    Time      box setup 22s · getting ready 9s · the agent 55s · CI — · reporting 6s
    Tokens    186k in (1.2k new, 175k from cache, 9.5k to cache) · 6.1k out (2.3k thinking) · 14 turns
    Tools     Bash ×12 · Read ×8 · Edit ×3 · notion.search ×2 · web: 1 search, 2 pages
    Refused   Bash: git push
    Your plan 24% of the 5-hour limit (resets 18:30) · 39% of the week (resets Tue 10:00)
    At API prices  $0.43, which your subscription covers
  ```
- **The status comment keeps:**
  - the last run's block, which also covers quiet scheduled runs that post no reply;
  - a folded table of the last 20 runs: when, why, box, model and effort, time, tokens, result.
- **Rows:**
  - **Recorded:** agent rounds (quiet and failed ones too), approved (act) runs, Check a box,
    operations and reminders.
  - **Not recorded:** yes or no, stop repeating or resume, form fixes and edits. Their replies
    already say what happened.
  - Runs with no agent get one line: "on homepi · 4s · no agent".
- **Time per phase:**
  - "Box setup" comes from a first workflow step that records when the job started.
  - A round's agent and CI time add up across its fix attempts.
- **What it reads and how it's kept:**
  - Box name: `RUNNER_NAME`. Version and model: the agent's own report.
  - Effort: what was passed.
  - Plan limits: the last rate-limit event. A used-up limit fails the run with "your 5-hour limit is
    used up; it resets at 18:30".
- **The hidden state stays version 1,** and only optional fields are added.

### 4. Every PR names its task, and the task lists every PR
- **`ship pr` reads the task from the run** (`SHIPIFY_TASK`) when `--task` isn't given. A task's PR
  always says `Closes` (or `Part of`, for a repeat).
- **Plan, change-doc and release PRs** say `Part of aayush-t-apps/shipify#n`. Each such PR shows up
  in the task's own GitHub timeline.
- **Every PR it opens gets a "Made by" line:** "Made by Claude Code (Sonnet 5.5, medium) in run ↗".
- **Plans and change docs record their task:** the optional `task:` in their front matter, written
  by `ship plan new` and `ship change new`.
  - A merged plan finds its task from that line first, then by searching as today.
  - A plan merged after its task was closed builds nothing, as today, and the plan PR says so.
- **A release PR lists what it ships:** the PRs merged since the last release, each with its task.
  - Each task's timeline then shows "mentioned in Release v1.3.0".
  - The clock checks open release tasks hourly. When the release PR has merged, it replies "Live:
    v1.3.0" and closes the task. Until now nothing closed it.
- **The status comment lists every PR the task opened** with its kind and state: "Plan PR (merged)",
  "PR (open) · Preview · Checks passed", "Release PR (open)".
  - States are saved in the task's state.
  - Every later update shows the list, which fixes the wipe.
- **A failed or lost run still records its PR:** the branch's PR is looked up even when the agent's
  result is missing.

### 5. The "Shipify status" issue
One issue, labelled `shipify-status`, opened and kept up to date by the clock:

```
The clock is running on homepi-clock since 1 Oct, 19:15 · its run ↗ · code ce39daf
Checked in 19:42. It checks in every hour: an older time means it stopped (pnpm ship doctor --yes).

Coming up      #16 Pi health check · Fri 2 Oct, 09:00 · every day at 09:00
Recent         2 Oct 09:00 started #16 · 1 Oct 19:15 the clock started on homepi-clock (ce39daf) · …
Weekly clean-up  28 Sep 04:17 · run ↗ · 0 stale tasks, 2 old worktrees removed · doctor: all good
               ▸ doctor's checks, on homepi
```

- **Who writes it:**
  - the clock: when it starts, every hour, when it starts a repeat or posts a reminder, when it hands
    over, and when it starts the clean-up;
  - a task run that had to restart the clock;
  - the weekly clean-up, with its result and doctor's checks.
- **Notifications:** edits notify nobody. A comment notifies, and is posted only for a problem:
  - doctor's failing checks, once per new set;
  - the clock couldn't queue its next run.
- **The issue never becomes a task:**
  - `task.yml` and `ship task` skip issues with its label;
  - your comments there start nothing;
  - the workflow's own token opens it, so no workflow runs then.
- **Its life:** closed, it's still kept; deleted, it's opened again; recent events are capped at 30.
  - Pinning is tried once; if it fails, pin it by hand.
- **The clock gets sturdier:**
  - each of its GitHub calls has a 60-second limit, so one hung call can't freeze it for hours;
  - the clean-up's due check reads the last 8 days of runs, not the last 50.
- **The clean-up's doctor step fails visibly:** `pipefail`, so GitHub emails on a failure, and its
  summary is a table.

### 6. Fast and current
- **Labels:** one read per run, creating only the missing ones, instead of three `label create`
  calls. About 2–3s faster.
- **Projects** (questions, new projects, open asks):
  - no API check for projects already on the box;
  - fetches in parallel;
  - no second fetch of the same project in one run.

  About 5–9s faster.
- **`setup-node` checks for a newer Node 22.x** only on the weekly clean-up and when the clock starts,
  not on every task job. About 2–3s faster, and Node fixes still arrive weekly.
- **A worktree that can't fast-forward** is said in the agent's notes, instead of the run silently
  working on an old copy.
- **Expected:** 10–15s faster to the agent. The details' time per phase shows it on every run.

### 7. Boxes that look after themselves
- **The setup version:** `box/setup.sh` carries `SETUP_VERSION` and writes it on the box.
  - `ship doctor` compares it with the repo's: "homepi was set up with version 2; the repo has 3: run
    `pnpm ship box add homepi` from your PC (asks for sudo once)".
  - The weekly clean-up puts that on the status issue.
  - Nothing ever runs sudo by itself.
- **The weekly clean-up prunes old Claude Code and Node versions** from its box's tool cache,
  keeping the ones in use.
- **`box remove` for a remote box** also stops and disables its two services over SSH (one sudo
  prompt), so neither restarts in a loop.
- **`box add` refuses a name** another machine already uses, unless `--replace`.
- **The clean-up's stale check** matches `task #1` exactly; `#12` running no longer hides a stuck
  `#1`.
- **More machines stays as it is:**
  - any free box takes the next job, and one clock runs at a time on any box's clock runner;
  - a task carries on from any box, from its branch and its notes;
  - each box cleans its own worktrees when it runs a clean-up or a close.
  - `docs/box-setup.md` says what doesn't move between boxes: unpushed work and caches.

### 8. Docs: one name, one glossary, nothing stale
- **The name:** **Shipify** for the whole system.
  - Its parts: **tasks** (issues), **boxes** (machines), **the clock**, **agents**, **tools**,
    **the pipeline** and **the Shipify page**.
  - The method: you ask on an issue, a box works, you approve by merging.
- **`README.md`, rewritten:**
  1. what it is;
  2. the system in one diagram;
  3. how work flows;
  4. glossary;
  5. decisions (the ADR table);
  6. policies;
  7. what exists now;
  8. set up and keep running, with renewals: tapp-pc on 2027-09-28, the Claude token around
     2027-09-30, Ubuntu 24.04 until 2029;
  9. everyday use and the exact words;
  10. where to look.
- **Policies, written down in one place:**
  - merges approve;
  - only the owner's events start work;
  - secrets are never printed;
  - versions change only by PR (OS security updates, the runner's self-update and Node 22.x fixes
    are the named exceptions);
  - free services only;
  - no browser sign-in or sudo on a box after setup;
  - nothing on a box matters, because GitHub holds the state.
- **One meaning per term:**

  | Use | For |
  |---|---|
  | **agent** | the program that thinks: its entry is in `executors.json` |
  | **repeat** | not "automation" |
  | **lane** | not "size" |
  | **errand** | what "Get something done" makes |
  | **weekly clean-up** | not sweep, weekly check or weekly run |
  | **runner** | only GitHub's runners |
  | **the Shipify page** | the admin app |

- **New `docs/agents.md`:** the adapter interface; what an agent gets (prompt, model, effort, tools,
  guard); and what it gives back (result file, report).
- **Updated:**
  - `docs/tasks.md`: model and effort, run details, PR links, the status issue. Its copy of box setup
    is replaced by a link.
  - `docs/box-setup.md`: more machines, speed, the setup version, removal.
  - `docs/tour.md`'s code map, `AGENTS.md`, the CHANGELOG.
  - `docs/context.md`: rewritten to today only.
- **Fixed:** about 20 stale statements, including:
  - `homepc` as a live box;
  - the 15-minute clock;
  - ADR 0014's portal and `--tasks N` (its status line will say which parts were never built);
  - three names for the bot;
  - `box remove shipify-pi` (the box is `homepi`).

## Edge cases
**The agent's output**
- Garbled lines, a killed agent, or no final event: the report is empty and the details say so. The
  result file still decides the outcome.
- A model the plan doesn't include: Claude Code's error is the run's error. Edit the task's Model.
- A used-up 5-hour limit fails the run with its reset time. For a repeat it counts as a failed run,
  and three in a row pause it.
- The raw log may hold page text from tools. It stays on the box, the latest run only.

**Model and effort**
- Older issues, blank issues, an option removed later, another agent: Auto, with a note.
- An edit while a run is going applies to the next run.

**History**
- The status comment is kept under GitHub's 65,536 characters: 20 rows, capped text fields, and the
  oldest rows dropped first.
- `-->` in any text is escaped, so the hidden state can't be cut short.
- Two writers at once (a merged plan's build and a task's own run) means the later save wins. A
  lost row is acceptable, and the Actions log still has the run.
- During a hand-over, older code drops fields it doesn't know, for minutes at most.

**Links**
- PRs made by hand have no task line, as before.
- `Closes` fires only on a merge into `main`: release PRs use `Part of`, and the clock closes the
  release task.
- After "start over", the old PR shows as closed and the `-r2` PR as open.

**The status issue**
- Not pinned: pin it by hand.
- The clock stops: the issue keeps its last check-in time and says what an old time means. Task runs
  and `ship doctor --yes` restart the clock and note it there.
- The clock and the clean-up write at once: each reads the issue again just before writing.

**Boxes**
- Older setup: said weekly. You re-run `box add`, which restarts the box's services and cancels a
  running task. Do it when nothing's running.
- With two boxes, the clock may move between them at each hand-over. That's fine.
- A box lost mid-task: the `lost` job marks the task failed, as today.

## Build order and checks
Each step comes with tests, and `pnpm verify` and `pnpm test:golden` pass before its PR.

| Step | Parts | Tests | Live check on homepi |
|---|---|---|---|
| 1 | 1, 2, 3, 6 (one PR) | the adapter against a recorded real stream; `choose`; form matching with and without the new fields; fake agent writing stream-json; history caps and escaping | before merging: run #16 from the branch (a quiet run): its status comment shows the run row and the time per phase. After merging: you open a question set to Haiku, and its reply shows Haiku's details |
| 2 | 4, 5, 7 (one PR) | PR bodies and the env fallback; the PR list across saves; the status issue's render, guard and caps; the setup version check | after merging: the status issue appears within 5 minutes; a clean-up run by hand writes its section; a playground change's PR names its task |
| 3 | 8 (docs PR) | the docs checks; a test that the glossary terms and form choices match the code | — |

## Not doing
- Adapters for Codex or OpenCode now: they run as today, and one is a file away.
- An Auto that picks per kind of task: one Auto, easy to change.
- Any version upgrade: Claude Code 2.1.284, Node 22 and pnpm 12.6.0 stay.
- Several task runners per box. While a task waits for CI (up to 25 minutes a try), its runner is
  held and a question waits behind it. A second machine helps today; `--runners 2` can come later if
  the wait bothers you.
- A webhook from project repos to shipify: it would need another long-lived token.
- Changes to the Shipify page.

## Built (2026-10-01): what changed from the plan

The owner approved the plan, asked for one PR, and then for fewer automations: keep it simple, no
extra jobs nobody checks. So:
- **The clean-up stays weekly** and does what it did, plus doctor's result on the status issue
  (a new problem, or all fine again, comes as a comment). No GitHub email on a failed doctor: the
  comment is the one notice.
- **Release tasks aren't closed by the clock.** The clock's own token can't read the private
  project repos' PRs (checked: all projects are private), and a new job for it was cut. The
  release PR names its task and lists what it ships, so the task's timeline shows the merge; you
  close the task. For the same reason the clock now leaves a repeat's state alone when it can't
  read its PRs; it used to guess they were closed.
- **Old tool versions aren't pruned,** and `box remove` prints the command that stops the
  machine's services instead of running it over SSH.
- **Measured on homepi** (run 36883557030, #16's scheduled run from this branch):
  - Auto ran `claude-sonnet-5-5`;
  - 14s from the start of `ship task run` to the agent (24s before);
  - `setup-node` 1s (4s before);
  - the job's steps took about 55s in all (74s before).

## Consequences
- **Easier:**
  - seeing what each run cost and did;
  - lighter runs by default;
  - following a change from task to production;
  - adding an agent;
  - noticing a stuck clock or an outdated box.
- **Harder:**
  - one more issue in the list;
  - a reader per agent to keep up when an agent changes its output. The recorded stream in the tests
    catches that when Claude Code's pin moves.

## Confirmation
- `tests/agents.test.ts` reads a recorded Claude Code 2.1.284 stream.
- A test fails when the forms' choices and the Claude adapter's names drift apart.
- `ship doctor` reports the box's setup version and the clock.
- The status issue's check-in time is never more than an hour old while the clock runs.
