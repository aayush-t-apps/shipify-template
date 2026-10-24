---
status: accepted (the owner's words on #533; their merge of its PR) and built in the same PR
date: 2026-10-19
amends: 0057 (what a stay answers), 0059 (a new model or effort is no longer a new session), 0060 (a stay's commits on a project), 0062 (a fixed word no longer hands over by itself)
---

# 0063: One rule for a stay

## The plan in short

**A stay does with your words what a normal run would do, in the same job and agent session.** It
hands over to a normal run only what needs something a stay can't have:

- **another agent** (a session can't move to another agent), repo or account (that run's own rules
  and keys);
- **a fresh clone** (`start over`, `go`);
- **the task's text read again** (an edit).

An answer that needs a write key is decided in the stay and posted by its own job (ADR 0062), and
then the stay ends. Nothing about security changes.

## Context

The owner asked for a stay that's simple and consistent (#533): "pick better solutions, not band
aids", and no limits without a clear need. On #532, a "Needs you" answer ended its stay because the
agent named its own `handoff.md` in `files`. The handoff changes every turn, so every answer had a
new file to upload, which needs the files key, which a stay never holds.

The logs of 64 stays from 16 to 19 Oct, by why they ended:

| Why it ended | Stays | Right? |
|---|---|---|
| the task closed | 22 | yes |
| handed to a normal run | 20 | about 10 a `use` of another model or effort, about 5 `go`, `publish` or `continue`, about 5 before ADR 0062 |
| its answer started a work run | 11 | yes |
| 20 quiet minutes | 5 | yes |
| its answer needed a write key | 4 | 2 real new files; 2 `handoff.md` (a bug) |
| the old cap | 2 | gone since 18 Oct |

So most stays that ended early ended on a rule, not on a need: a fixed-word list, a model check,
and two bugs.

## What changes

1. **A new model or effort keeps the session.** The gate compares the agent only. The turn's plan
   carries the new pick, and think passes it with the session: Claude Code `--model`/`--effort`
   with `--resume`, opencode `--model`/`--variant` with `--session`, pi `--model`/`--thinking`
   with `--session` (each agent's own help says the model is the session's from then on). A `use`
   of another agent is still a new session.
2. **Plan decides, not a fixed-word list.** `forARun` and `boxAnswer` are gone, and one gate,
   `takes`, replaces them and `sameTurn`. Every box answer is the stay's: a `use`, `no`, `resume`,
   `stop repeating`, `reopen`, `stop`, a thanks. One that starts another run or closes the task
   (`close`, `publish`) is posted, and then the stay ends. One that needs a key (`yes` to a list, a
   `preview`) goes through ADR 0062's path. `continue` thinks in the same session.
3. **The box's own files are never shared.** `readResult` drops `result.json`, `handoff.md`,
   `meta.json` and `work.bundle` from `files` (`BOX_FILES`), so neither think nor decide sees them.
   The playbook says so too.
4. **A stay's turn sends only its own commits.** On a project, a stay's question used to bundle
   against the clone's `origin/<branch>`, which never saw the run's own push, so it sent the run's
   commits again, needed the repo's key and ended the stay. Its bundle now starts at the turn's
   own `HEAD`.
5. **One turn path.** A turn is plan, then (for a think) think in the session, then decide, then
   apply, or ADR 0062's mints. The same path as a run's, for a box answer and a think. The agent a
   task runs is worked out in one place (`taskAgent`, `agent.ts`), which the job's plan step and
   the stay's gate both read: no second copy of that rule.

## Security: unchanged

No write key exists while an agent runs, and a stay never pushes. A stay holds no key and asks for
none; ADR 0062's steps mint one after the stay ends. A stay that ended doesn't come back: GitHub
runs a job's steps once, in order, and the keys are made after the agent's step. Staying again
would need a key during an agent's step, or a job that loops, and the security rule forbids both.
Only a new job can stay again, and that's a normal run.

## The limits, swept

`SHIPIFY_STAY` stays the one setting. No limit was removed: each one left has a need.

| Limit | Why |
|---|---|
| `STAY_IDLE_MINUTES` (20) | `SHIPIFY_STAY`'s default: a pause to read a reply and think (ADR 0059) |
| `JOB_MINUTES`, `JOB_MARGIN_MINUTES` | the job's own limit, and the time its last turn's apply and the label's step need after the stay |
| `TURN_MINUTES` (5) | no turn starts that its job's limit would cut short |
| `POLL_MS`, `LOOK_MS` | how fast your words are seen (a read with nothing new costs nothing), and how often the task and the queue are looked at |
| `PICK_UP_MS`, `GIVE_WAY_MS` | the box's slots: a job that waits gets one slot, from one stay at a time |
| `CATCH_UP_MINUTES` (think) | words taken in only with time left to answer them |

## Not done

- A text file inside the reply (a plan doc shown in the chat, not uploaded), so a new doc doesn't
  end a stay. It needs work on the web chat: a next task.
- A live switch of model inside one paid session on each agent: checked against each agent's own
  help and in the tests' fake agent, not with a paid run. If an agent refuses it, its turn fails as
  any failed turn does, and your next words start a normal run.

## What it touches

`cli/kernel/stay.ts` (`takes`, `ends`), `cli/kernel/run.ts` (the turn), `cli/kernel/agent.ts`
(`taskAgent`), `cli/kernel/result.ts`
(`BOX_FILES`), `cli/kernel/think.ts` (a turn's bundle). Tests: `kernel-stay`, `kernel-flow`,
`kernel-decide`. Docs: `docs/tasks.md` (the stay section and its table), `docs/glossary.md`,
`docs/design.md`, `playbooks/task.md` (`files`), this ADR and the index, `CHANGELOG.md`.
