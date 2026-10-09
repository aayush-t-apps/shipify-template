---
status: accepted and built (one PR, #219, with #218's fix folded in; the owner's go on 2026-10-07, all three choices as recommended: "lets cleanly build properly … same PR"); §4 amended by 0042 (the watch never starts a run: words with no run are told too, Stopped, and wait for your `continue`); §3 and §5 by 0046 (a PR's checks start nothing; the due run also takes a stale `deploying` label off)
date: 2026-10-07
amends: 0019 (the due run writes nothing on a task: now it may close one), 0021 (every event kept in order), 0031 (a close's run)
---

# 0040: A run only when you ask, and once

## The plan in short

**What:** the box runs only for what you asked: your words to the agent, `continue`, `yes` or
`no`, a button that acts (Run now, Run again, Stop), a schedule you set (a repeat, a reminder, a
check, a recipe), and the follow-up of something you did whose end can't be known at once (a
merged PR's deploy, a PR's checks). Nothing else takes a slot: no run for bookkeeping, no run that
finds nothing to do, no run started again behind your back.

**Why now:** the owner, on 2026-10-07, after seeing the box "2 of 2 busy" with nothing open: "nothing
should auto start unless asked: said, continue, yes, no, actions … only live, active ones get the
privilege; background stuff kills here." A sweep of the last 200 task runs (Oct 5 to 7) shows what
took the box:

| Runs | Started by | What they were | Kept? |
|---|---|---|---|
| ~80 | your words (chat or GitHub) | answers and PRs: the work | yes |
| 31 | your words, queued behind a run | "nothing new": the run before them had read your words already | no: §1 |
| 7 | your `close` | the close's bookkeeping on the box | no: §2 |
| 6 | the door's own close | "closed already" (gone since #214) | already gone |
| 4 | a reopen | a reply saying "Reopened" (gone since #216, #218) | already gone |
| 3 | the due run | an answered task closed after a quiet day | no: §3 |
| 2 | the watch | a run started again after one ended early | no: §4 |
| 7 | the due run | a repeat's time (2), a deploy (2), a PR's checks (2), a new recipe (1) | yes: you set or did it |
| 2 | a question's run | a PR started from a question (fixed by #214: only when you ask) | already gone |
| 26 | GitHub | events `task.yml` skips at once (no box) | yes, free |

About 40 runs in 3 days, a fifth of the box's work, had no reason to run. The due run itself took
the box 22 times (about 8 a day: the daily pass, a repeat's time, every 10 minutes while a deploy is
followed), and stays: it's the schedule you set.

## The decision

### 1. One run per task at a time, and one waiting

`task.yml` keeps the run going and only the newest one waiting for each task (GitHub's default
concurrency: a newer run replaces the one waiting), not every event in order (`queue: max`, ADR
0021). Every run reads all your unread words, so the newest waiting one covers what the replaced ones
were for.

What a replaced run carried is never lost, because nothing lives only in an event:
- **Your words** are unread on the task until a reply covers them (the status's cursor).
- **Due work** (a repeat's time, a deploy to follow, a PR's checks) is in the task's status and
  the status task's "Coming up": the next due run asks again (within its 10 minutes).
- **A merge that closed the task** is read from the task (closed, with its merged PR), by whichever
  run comes.
- **An approved list of tool calls** is in the status and runs first, whatever run comes for it.

The build proves each of these with a test before the queue changes; any one it can't prove keeps
`queue: max` and this section waits.

### 2. A close is a change of state, not a run

From a chat, the door closes the task, takes Shipify's state labels off in the same write
(`working`, `answered`, `needs you`, `failed`), says "Closed · #12", and writes the word as a setting
(like a `use …` alone, or a reopen since #216): no run. The task's status catches up the next time a
run reads it, since your `close` is among the words it reads (`closeWord`). Until then nothing reads
a closed task's status: the due run and the watch list open tasks only, and a `yes` after a reopen
can't approve calls listed before the close (the catch-up drops them first).

A `close` typed on GitHub keeps its run: nobody answered it at once.

### 3. A quiet day's close is the due run's, not a run of its own

An answered task closes a quiet day after its reply. Today the due run starts that task's run, which
closes it. It closes it itself instead, as the door does (state and labels, no comment), and the
status catches up as in §2. The due run then writes on a task for this one thing; its comments and
status stay its own run's (amends 0019).

### 4. A run that stopped early waits for your `continue`

When a run ends before it finished (the box restarted, it crashed, a job was cancelled), the watch
no longer starts it again by itself. It marks the task **Stopped** (the label `stuck`, shown as
"Stopped: say continue" in every chat's list and the status page), and your `continue` carries it
on, as now. Words that waited because no box was online still start once one is back: those are your
ask, late, not a restart.

### 5. What still starts by itself says why

A repeat's time, a deploy after your merge, a PR's checks, a merged recipe's first run: each reply
already says what started it, and Status & setup lists them under "Started by the watch".

## What it costs and saves

- **Box:** about 40 fewer runs in 3 days at today's pace; no slot taken by a close, a reopen or a
  run with nothing to do.
- **GitHub:** the door's close is one write (state and labels) instead of a comment plus a run's
  writes; nothing new is read.
- **Cloudflare:** nothing new.
- **You:** a close or reopen is instant everywhere and costs nothing; "Working" in a list means
  the agent is on your words; "Stopped" means say `continue`.

## Build plan (one PR, after this one is merged)

1. Tests first: each reason in §1 survives a replaced run; then `task.yml` without `queue: max`.
2. The door's close as a setting, with the labels; the plan's catch-up on a closed task (§2).
3. The due run's quiet close (§3).
4. The watch marks Stopped instead of starting again; "Stopped" in the list, the header and the
   status page (§4).
5. Docs: `docs/tasks.md` (close, reopen, continue, Stopped), `docs/watch.md`, `docs/design.md`
   (who writes what), `docs/channels.md`, `docs/glossary.md` (setting, Stopped), `docs/door.md`,
   `docs/context.md`, ADR 0019/0021/0031's "As built", the ADR index, `CHANGELOG.md`.
6. Checked end to end on the box: a close, a reopen, three messages while a run works, a box
   restart mid-run, a repeat's time, a merge followed to Live; each counted in the Actions list.

## Decisions for you

1. **The queue (§1):** one waiting run per task, as above (recommended). Or keep every event, and
   accept the "nothing new" runs.
2. **A quiet day (§3):** the due run closes it (recommended). Or answered tasks stay open till you
   close them.
3. **A stopped run (§4):** Stopped, say `continue` (recommended). Or the watch starts it again once,
   as now.

## As built (2026-10-07)

The three decisions as recommended: one run waiting per task, the due run closing a quiet task,
Stopped waiting for `continue`. Where the build goes past the text above:

- **Nothing lost, proven first.** Two things lived only in the event that started a run, and now
  don't: a merge's close (the merging PR is read by whichever run comes first, and handled before
  your later words carry the task on) and work you asked for (`pending.work`: the next run does
  it, with your newer words). A repeat's time, a deploy, a PR's checks and a release are kept on
  the task, and the next due run asks again. Tests for each, failing on the code before.
- **A close pauses a repeat.** A close used to end a repeat outright, so Repeats' Pause, then
  Resume, had nothing to resume. It pauses it now, as `docs/tasks.md` always said.
- **A close the door did is caught up** by the next run that reads the task, as its own run would
  have (a list waiting for your yes dropped, a repeat paused, read up to the word), and not more:
  an `ok` that answers a question still waiting still carries the task on.
- **The state labels:** one list for the box and the edge (`STATE_LABELS`). The door takes them
  off in the same write as the close; the due run takes them off one by one (the record's
  `updateIssue` takes no labels).
- **Stopped** is the `stuck` label, shown as "Stopped" in every list and header, with a **Continue**
  button in the web chat (gone once you've said it, and "Starting…" only then). A mark counts
  toward the watch's three a tick; one alert per stopped run.
- **#218** (a close, then a reopen: the run queued for the close said "Reopened") is folded in.

