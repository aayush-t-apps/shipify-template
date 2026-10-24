---
status: accepted (the owner's words on #500) and built; see [As built](#as-built-2026-10-16); amended by 0061 (a slip in an answer's shape keeps its stay) and 0062 (a stay's answer that needs a token is applied in its job), 0063 (a stay's turn sends only its own commits)
date: 2026-10-16
amends: 0057 (every answer stays, unless it started another run or closed the task), 0037 (no round count: the catch-up goes on while you write and the agent's clock has time)
---

# 0060: Every answer stays, and the catch-up takes all you write

## The plan in short

- **Every answer stays.** Whatever the run did (an answer, a question, a PR, a list for your
  `yes`), it stays, unless its answer started another run or closed the task. Today only a talk or
  read run's plain answer stays, so once a task has worked on a project, no answer on it ever
  stays again.
- **A stay on a project answers, and hands a change to a work run.** A stay holds no write key
  and nothing pushes after it, so a turn that's asked for a change changes no files: it says what
  it will change and sets `work`, and a work run on the task's branch does it, with the whole
  thread. Nothing new in `task.yml`, and no new key.
- **The catch-up has no round count.** A run takes in what you write while it works, round after
  round, until a read finds nothing new or the agent's clock has under 5 minutes left. Then it
  posts one reply.

## The owner's asks (task #500, 2026-10-16)

1. "Every new run without model or anything changes starting new: is the flow broken?" None of
   the answers after the first work run stayed.
2. What happens when a stay is working and you change the model and send: "I hope we are not
   losing any answers."
3. The catch-up's 3 rounds: "it should be as many as possible"; "there is no need of rounds
   limit".
4. "A robust flow": check end to end, fix what needs it.

## What was found (checked 2026-10-16, `main` at `6f46ebe`, and #500's runs)

| Run on #500 | What it was | Stayed | Why |
|---|---|---|---|
| 38954452805 | the first, talk (Sonnet) | yes: five answers in 11.5 minutes | left at the owner's `use claude opus`, and handed it over |
| 38955967398 | talk (Opus), after the `use` | no | its answer started a work run (`work`): a stay and a work run would both answer |
| 38956626783 | work: the docs, PR #501 | no | it pushed |
| 38957187279 | work: an answer and a question, nothing pushed | no | **its profile was work**, and its question waited with #501 open |
| 38957481595 | after `use claude opus high` | (this one) | a new effort is a new session: right |

- **The cause:** once a task has a project (`st.project`), plan makes every later run on it a work
  run (`decide.ts:1092`), and `staysAfter` takes only talk and read (`stay.ts:66`). A question
  stays only when no PR is open (`questionWaits`, `decide.ts:858`), which on a project task is
  almost never. So after the first work run, every answer on the task starts the next one cold:
  a new job, a clone, the project's setup and the finish, about 50 s before the agent, then a
  fresh session.
- **A `use` mid-stay loses nothing** (`run.ts:585-695`, `stay.ts:183-240`):
  - Alone, from a chat, it's a setting: the stay has nothing to answer. Your next words are
    planned with the new pick, which `sameTurn` doesn't match (`runsWith`), so they go to a
    normal run on the new model.
  - With words, while a turn works: its catch-up leaves a `use` for the next run (and the reply
    says one waits). After the turn, the stay reads it, takes `staying` off and starts a normal
    run (`handover`). On #500: the `use` at 19:34:45, handed over at 19:34:55, answered at 19:40.
  - As the stay leaves: `staying` comes off first, then one last read; words found go to a run.
  - The comment runs that `staying` skips, and the queued runs a newer one cancels (ADR 0053),
    dropped nothing: every message on #500 was answered.
- **The catch-up stops at 3 rounds** (`CATCH_UP_ROUNDS`, `think.ts:55`, the owner's pick on
  #188). A message after the third waits for the next run: #500's 19:39:36 did, and was answered
  there.

## Options

| | For | Against |
|---|---|---|
| **A. A project stay answers, and hands a change to a work run** | no new step, key or workflow change; a question on a project answered in seconds, in the warm session with its clone | a change asked in a stay costs one short turn before the work run starts |
| B. A stay's change pushed by new steps after the stay (a write key minted once the agent is stopped, the finish, apply) | no hop for a change | new steps and a key path in `task.yml`, which an agent's run can't change; more to secure and test |
| C. Plan a project task's words as talk unless they ask for a change | | the box can't tell from words; every change would take two runs |
| D. As today | nothing to build | every follow-up on a project task is a cold work run |

**A.** It keeps the rule that a stay never pushes, and fits the step order as it is.

## Decision

1. **Every answer stays.** `staysAfter` asks only whether another run carries on from this answer
   (a `dispatch`: a work run it started, the GitHub job) or it closed the task. What a run pushed,
   opened, listed or attached was applied before the stay, with keys minted then; the stay's own
   turns already hand anything that needs a key to a normal run. Its stay resumes the same session
   in the same clone: a turn clones, refreshes and sets up nothing again.
2. **So a question stays with a PR open, and a list too.** A merge closes the task, and the stay
   sees it within 15 s (`LOOK_MS`) and leaves; a `yes` is a fixed word, handed to a normal run.
3. **A stay's turn on a project changes no files.** The turn's prompt says so: read and answer as
   before; asked for a change, say what you'll change and set `work` with the brief. Decide takes
   `work` from a stay's turn on the task's own project as it takes it from a talk run: the reply
   says a work run starts, the work run is dispatched, and the stay leaves (`left`, as today). A
   turn that commits anyway goes to a normal run as today (`handover`, nothing posted), which does
   it again from your words: only that turn's time is lost.
4. **The catch-up has no round count.** `CATCH_UP_ROUNDS` goes. After each answer the run reads
   the task again and takes in your new plain words while the agent's clock has 5 minutes left
   (`CATCH_UP_MINUTES`); a read that finds nothing new, or a failed read, ends it and the reply
   posts. Fixed words still wait for the next run.

## Consequences

- A follow-up on a project task is answered by the stay, in about 20 s, with the clone and the
  session's context, instead of in about 50 s plus a fresh session.
- A change asked during a project stay: one short turn, then a work run, as a talk run's `work`
  does today.
- Rule 3 relies on the agent following its prompt; when it doesn't, the handover keeps the
  answer correct, and it costs only time.
- **Accepted:** if you keep writing faster than the agent answers, the reply waits for you, up to
  the agent's clock (200 minutes). Each message is taken in as it comes.
- A stay's slot is held while it waits on a project task too: the 20 quiet minutes
  (`SHIPIFY_STAY`), and it gives way to a queued job, as now.

## As built (2026-10-16)

Built in the same PR as this record, on the owner's words ("don't add unnecessary limits", "keep
it clean", "quick fast agent sessions end to end"). Simpler than first written: the rule became
one line, every answer stays unless another run carries on or the task closed, rather than "a work
run that pushes nothing".

- `cli/kernel/stay.ts`: `staysAfter` is that line; nothing in it reads profiles, keys or replies.
- `cli/kernel/think.ts`: no project setup on a stay's turn; a stay's turn on a project gets the
  note (`STAY_WORK_NOTE`); `CATCH_UP_ROUNDS` removed; `ThinkMeta.stayed` marks a stay's turn.
- `cli/kernel/decide.ts`: `work` from a stay's turn starts a work run, as from a talk run.
- Tests: `tests/kernel-stay.test.ts` (every profile stays; a PR, a question with a PR open, a list,
  files; a dispatch or a close leaves); `tests/kernel-gate.test.ts` (five messages in five rounds,
  one reply); `tests/kernel-flow.test.ts` (a project's run stays after its PR opens, and "make it
  green" in its stay starts a work run).
- Docs: `docs/tasks.md`, `docs/glossary.md`, `docs/design.md`, `playbooks/task.md`, the changelog.
- **Confirmation on the box**, to see on the next tasks: a question on a task with an open PR is
  answered by its stay; a change asked there starts a work run; messages sent during one run get
  one reply however many.
