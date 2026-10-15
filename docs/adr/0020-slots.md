---
status: accepted (merged 2026-10-02 in shipify #38 with its build, the owner's choice of one PR; shipify-admin #20). Live the same day: homepi with 2 slots ran 3 pings (2 at once, the third waited) and 2 tasks at once, each with its PR after make verify. Amends ADR 0019's "one runner per box". Amended 2026-10-08 (shipify #245): a new Pi or VPS keeps 1 GB of its memory for the system and gets a slot per 2 GB of the rest (an 8 GB Pi 3, from the 1.7 GB a task peaks at, measured below), not 2. homepi runs 3 from the same day
date: 2026-10-02
---

# 0020: Slots: a box runs several tasks at once

## Context
A box runs one job at a time. GitHub's runner program takes one job at a time, and each box has
one runner (ADR 0019). So a reminder, a question or an alert waits behind a long task, sometimes
for an hour. The work itself is already safe side by side: each task has its own worktree, branch
and test ports, and a task never runs twice at once. What's missing is room for a second job. The
owner asked for 2–3 tasks at once per box, handled cleanly end to end, before adding machines.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| A runner process runs one job at a time; more at once means more runners | GitHub's runner design: each one asks the queue for one job at a time (ADR 0019's "one run, one machine") |
| GitHub hands each queued job to one idle runner whose labels match, so N runners with the same labels share the work | ADR 0019's boxes already share `shipify-box` this way |
| The runner hands its folder's `.env` to every job | The runner's own documentation for `.env`, and its `RUNNER_TOOL_CACHE`; checked live in step 3 |
| Two jobs as one user don't collide | Read 2026-10-02: git config is per job (`GIT_CONFIG_GLOBAL`), pnpm's shims are per job, and corepack, pnpm's store, Claude Code (it locks `~/.claude.json`), Playwright (`__dirlock`) and wrangler (a log per process) all cope with two at once. Every temp file is unique |
| Test servers don't meet | Ports come from each checkout's path (8800–9799, inspector +1000), and a clash fails safe (an error, never another server's page) |
| The Pi has room for 2, and 3 at a push | Measured 2026-10-02: a task peaks at about 1.7 GB (Claude Code 0.4 GB, `make verify`'s browser tests 1.0–1.2 GB with the Pi's 2 browser workers). 3 at once is about 5 GB of the Pi's 7.6 (7.1 free). 4 cores: each is slower when all 3 verify at once |

## Options
- **A: slots.** A box runs N runners, its slots, all labelled `shipify-box` and `box-<name>`.
  The box is its label. (+ one box, one health, one clean-up, one alert per outage; the queue does
  the scheduling / − box setup, the box commands, the clean-up and the guard learn about slots.)
- **B: a label per slot,** so each slot is a box. (+ no change to the guard / − one machine shows
  as N boxes: N healths, N clean-ups, N alerts for one outage.)
- **C: one runner that starts tasks in the background.** (− the job ends before the work does, so
  its tokens, log and status are gone: it breaks "every run is a run".)

## Decision
Chosen **A**, because GitHub already does the scheduling and the record stays keyed by box.

- **Names:** slot 1 is the runner named after the box, in the box's folder, as today; nothing about
  it changes. Slot k is `<box>-<k>`, in `<folder>/slot-<k>`. A box refuses a slot name that
  another box's runner already has.
- **Count:** `box add` and `box up --service` take `--slots N` (1–4). Without it, a box keeps what
  it has, and a new box gets 2. Fewer slots removes the extra ones: their services, folders and
  registrations. The commands refuse while any slot runs a task, since setup restarts a slot whose
  service or settings changed.
- **Each slot's `.env`:** `SHIPIFY_BOX` (its box), `SHIPIFY_BOX_DIR` (the box's folder) and
  `RUNNER_TOOL_CACHE` (one per machine). With these, a run records its box, never its slot, and
  Node and Claude Code are fetched once per machine. The install takes a lock (`flock`), so two
  slots never install at once.
- **The record is unchanged.** It's keyed by box. The admin Worker groups runners by label
  (shipify-admin 1.6.0, change doc 0007): a box is offline only when every slot is, so one outage
  gives one alert. The page shows "2 of 3 slots busy" and each running task.
- **The weekly clean-up** runs once per box, on any slot. It covers every slot's workspace,
  leaving alone any task with a run queued or under way. It prunes pnpm's shared store only while
  no other slot runs a job.
- **Workflows:** no change to where runs go.

**What two slots at once needed fixed** (each was safe with one runner per box):

| Hazard | Fix |
|---|---|
| A merged plan's build ran inside the push job ("plans merged"), outside its task's turn, so a comment could start a second round of the same task beside it. The clean-up also thought the task was stuck | The push job starts each build as that task's own run (reason `plan-merged`), in its turn. The run checks that the plan is on main, and only then gets the bot's full access |
| The bot's access for operations and upgrades came from the event's issue, which a dispatch ("run again") doesn't carry | One step reads the issue and decides the access, for every kind of start |
| A due run writing the whole schedule could erase a repeat a task run had just changed | The task run also presses `due`. Due runs take turns and rebuild the schedule from the repeats |
| A round's commits stayed on the slot that made them, so the next round elsewhere started without them | A round that ends with commits and no PR pushes its branch. It never pushes onto an open PR: only `ship pr` updates one, after `make verify`. A closed task's leftover branch is deleted |
| Two rounds' screenshots moving the same branch at once, which made a finished round say "The run broke" | Up to 3 tries on a branch that moved. A failed upload, or a failed preview lookup, is a note, never a broken run |
| One failed GitHub call while waiting for checks failed the round | Up to 5 failed looks in a row before giving up |

## Edge cases

| Situation | What happens |
|---|---|
| Every slot busy | Runs wait in the queue (up to 24 hours), as when one runner was busy |
| The same task: a comment while its round runs | It waits its turn (`task-<n>`), as before; merged plans now do too |
| One slot's service stops | The others carry on. The box's health (doctor's check of its services) says so on the next due run; no alert |
| The whole box goes off | One offline alert, and one "back" alert |
| A box set up before slots | It stays one slot until `box add --slots N` (setup version 3). Its runner keeps its name and folder |
| Growing or shrinking a box while a task runs | Refused: run it again when no slot is busy |
| A due run and a task round on the same repeat at the same second | A due run skips a repeat whose task is mid-round. The leftover window is a second or two; at worst, one reminder twice |
| Two writers of the status issue at once | As ADR 0019: the later write wins, and the next due run or alert writes it again from the record |
| A round's push is refused (the branch moved, or it changes workflows) | Noted in the run's log; never forced. The next round starts from GitHub |
| Two slots' test servers on the same port | About 0.3% for 3 at once. It fails safe: `ship pr` refuses, and a retry gets another path |
| The Pi short of memory | 2 slots leave about 4 GB free; 3 leave about 2 GB. If doctor's memory check complains, fewer slots (`box add --slots N`) |
| Your Claude plan's limits | N tasks use it N times as fast; the run details show the 5-hour and weekly use |

## Consequences
- **Easier:** a question or a reminder no longer waits behind a long task, and capacity grows two
  ways: more slots per box, or more boxes.
- **Harder:** a box has N runner registrations and services to keep, though the box commands
  handle them all at once.
- **Unchanged:**
  - tasks and their state;
  - the queue, labels and the watch's buttons;
  - the record's shape;
  - CI and deploys, which never run on boxes.
- ADR 0019's "one runner per box" becomes "one box, its slots, one label".

## Build, in steps

| Step | What | Who |
|---|---|---|
| 1 | **The admin Worker** (shipify-admin #20, 1.6.0): runners grouped by box, the guard per box. It must be live before any box gets a second slot | you merge |
| 2 | **Shipify** (#38): slots in box setup and the box commands, the fixes above, tests, docs | you merge |
| 3 | **This PC, as a check** (no sudo): `pnpm ship box up --service --slots 2 --yes`, then `box list` and `box status`. Then press `due` and `cleanup` and see both run at once, the box recorded once, and the shared tool cache used. Then `pnpm ship box remove <name> --yes` | me |
| 4 | **The Pi:** `pnpm ship box add shipify-pi --slots 2 --yes` while no task runs (it asks for the Pi's password). 2 slots for now, the owner's choice; 3 once 2 have run well | you |
| 5 | **Your end-to-end test** (below) | you, and I watch the runs |
| 6 | **What it showed,** in `docs/context.md`; keep 3 slots, or go to 2 | me |

**Your end-to-end test:**
1. `pnpm ship box list`: homepi, "2 slot(s)", online.
2. Open two tasks within a minute: a change to spotter and a `try:`. Both start at once, and
   `box list` shows "2 busy".
3. While they run, a `ping`: it waits, then runs as soon as a slot frees.
4. Each change's PR passes `make verify` on the box, with screenshots, and nothing runs on GitHub.
5. Comment on one task while it runs: the comment waits, then runs the next round on any slot,
   with the earlier round's work.
6. On the Pi, `sudo systemctl stop shipify-box-homepi shipify-box-homepi-2` for 10 minutes: one
   offline comment; `start` them: one "back". (`ship box stop` works on this machine's box only.)

## Confirmation
- **Tests in shipify:**
  - slot names, folders and `.env`;
  - grouping by label in `box list`, and every slot in `box status`, `stop` and `start`;
  - `--slots` from 1 to 4, service only;
  - every slot's workspace found for the clean-up;
  - a merged plan's build only for a plan on main;
  - setup version 3.
- **Tests in shipify-admin:** grouping, a box's state, and a guard that alerts per box.
- **Live:** steps 3 to 5, then `ship doctor` on each slot says setup version 3.
