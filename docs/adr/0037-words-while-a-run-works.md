---
status: accepted (the owner's choice on #188, 2026-10-06: "1 now, with 3 as an add-on"; built in the same PR, task #188)
date: 2026-10-06
amends: 0021 (its edge case "the owner comments while a run works")
---

# 0037: Words while a run works: taken in before it answers, and `stop`

## Context

A run reads its task once, when it starts, and the agent gets the whole conversation then. What you
wrote while it worked waited for the whole run to end (0021's edge case), then a second run started
from scratch: it got ready again, read everything again, and sent a second reply. Agents in a
terminal take a message mid-turn; here there was no way to add to a run, or to stop one going the
wrong way.

## Options

1. **Catch up before answering.** When the agent has its answer, the run reads the task once more;
   plain words written since go to the same session (as the fix round already does), and one reply
   covers it all. One small read a run; any agent that can resume a session.
2. **Live steering.** Read the task every 30 seconds and pass new words into the running session.
   Closest to a terminal, but Claude Code only, a pipe into the agent's sandbox, and headless
   mid-turn input still to be proven.
3. **A `stop` word.** Stop the run that's going; its work is kept (0035) and your next words start
   the next run.

## Decision

1 and 3. 2 waits until 1 has been used a while.

- **Taken in before it answers** (`laterWords`, `cli/kernel/decide.ts`; `think`): after the agent's
  first answer, before the box's checks and before anything is posted, one read of the comments
  written since the run's plan read the task (`since`, `cli/kernel/snapshot.ts`). The plain words,
  oldest first, go to the same session with what's left of the agent's 50 minutes (5 at least).
  Words the next run must read itself stop the list there: a fixed word, a `use`, a command, a note,
  a lone thanks, an edit. They get 👀 and the cursor moves past them (`caughtUp` in the
  run's meta), so the run queued by their comments finds nothing new. An answer that doesn't read
  keeps the first one, and the words wait for the next run as before; the run's details say how
  many wait.
- **Their files** (amended on #188, where every ask came with a screenshot, so a file stopped them
  all): fetched before the catch-up, as a run's start does (`laterAttachments`,
  `cli/commands/task/files.ts`; chat files from the door), and given beside the run's own. Pasted
  images take one read of the comments since the run began, rendered, only when one has an upload.
  The notes name each file where the agent reads it (its `in/files`), not the runner's folder.
- **Read as it starts, and until nothing's new** (amended on #188, where a message sent seconds
  after the plan read the task waited for the catch-up, and two sent during the catch-up waited for
  a second run): the same read just before the agent starts, its plain words marked NEW in the
  prompt and counted in `caughtUp`; and after each round that took words in, another read, up to 3
  rounds while 5 minutes are left. 👀 still comes with the reply: the think step's keys are
  read-only, so nothing marks a message earlier. A failed run's reply puts 👀 on what it took in
  too, since its cursor moves past it.
- **Said as it replies** (amended on #188, where two messages waited with "needs you" on the task):
  `runDecide` reads the comments since once more, and the reply names how many of yours came after
  the cursor (`stillWaiting`); the run they queued reads them. The web chat shows 👀 on your words
  from the reaction count GitHub sends with each comment, and keeps a run queued before the last
  reply shown while your newest message has no 👀.
- **A merge that came first** (amended on #188): words written before a PR's merge closed the task,
  and that no run read, are named in its Merged/Live reply. Words after the close carry the task on
  as before, and now count those older ones as new too (not those within a minute of the close,
  said as it closed).
- **`stop`**, a fixed word from anywhere: while the agent works (the first ask, the catch-up, the
  fix round) the run reads the same comments about once a minute. A `stop` aborts the ask, which
  stops every process of the agent's (`killAll` on a box). Then, as for any stop (0035): no answer,
  no PR, its commits and edits kept on the task's branch, and the reply "Stopped, as you asked".
  The cursor moves to the `stop`; words after it start the next run. A `stop` with no agent working
  says there was nothing to stop.
- **Why the run reads, not the door:** the door can't cancel a run without the Actions write
  permission, and a cancelled job loses the work it hadn't bundled. The run stopping its own agent
  keeps everything, with the read token it already has.

## Consequences

- One reply instead of two, usually minutes sooner, with no second run getting ready.
- About one read a minute while an agent works, and one before it answers: comments `since` the
  run started, usually an empty list. A failed read (its token's hour gone) is skipped.
- `THINK_MINUTES` is unchanged: the catch-up shares the first ask's 50 minutes.
- The web chat: ⋯ **Stop the run** while one works (or the send button, a ■ while the box is
  empty), "Stopping…" once it's sent, and the reply box
  says "read before it answers".

## Docs it touches

`docs/tasks.md` (Words while a run works, the `stop` row), `docs/channels.md`, `docs/context.md`,
`intents.json` (the help line and the reply words), `CHANGELOG.md`.
