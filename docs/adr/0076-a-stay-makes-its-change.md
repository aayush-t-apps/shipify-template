---
status: accepted (the owner's words on #708; their merge of its PR) and built in the same PR
date: 2026-11-08
amends: 0060 (a stay's turn on a project makes a change itself; decision 3 is gone), 0063 (one more thing a stay does as a normal run would)
---

# 0076: A stay makes its change itself

## The plan in short

**A run on a project's clone makes a change you ask for itself, a stay's turn too.** It commits,
the box checks it, and the stay's own job pushes it and opens or updates the PR (ADR 0062). No new
run starts, and nothing is thought again. `work` is only for a project the run has no clone of: a
talk run's first change, or another repo.

## Context

On #708 (8 Nov) a work run opened its PR and stayed. The owner then asked for more work on the same
project. The stay's turn answered "A work run on shipify starts now" and set `work`, so the stay
ended and a new run started: a new job, a fresh clone, the project's setup, and an agent that read
the whole thread again. The owner asked: "why don't we stay … this disturbs the existing flow …
starts from think again"; "make it consistent, simple, easier to follow".

The cause was one line left from ADR 0060. Then, a stay could not push, so its turn was told to
change no files and hand a change to a work run (`STAY_WORK_NOTE`). ADR 0062 then let a stay's
answer that needs a key be applied by its own job, and ADR 0063 made a stay's turn send only its
own commits. A stay could already push a change. Only the note, and decide's acceptance of `work`
from a stay, still sent it away.

## Decision

1. **The stay's note** (`think.ts`, `STAY_WORK_NOTE`): make a change here, commit, run its tests,
   and ask for the PR; never `work` for this project.
2. **One rule for `work` in decide:** it starts a run only on a project or repo this run has no
   clone of. A work run's `work` for its own project starts nothing. The reply says so in its
   "not made" list, with `continue` to have it done. A work run's `work` for another repo starts a
   run on that repo, as a talk run's does.
3. **The prompt and the playbook** say it where `work` is described.
4. **The box's line "A work run on … starts now"** is said once, even when the agent wrote it too.

What still starts a new run, unchanged: another agent (a session can't move between agents), a
fresh clone (`start over`, `go`), an edit of the task, another repo or account, a talk run's first
change, and your words after a stay's push (a job's steps run once, ADR 0062). A new model or
effort keeps the session (ADR 0063).

## Security: unchanged

No write key exists while an agent runs. The stay's push is minted and applied by its job's own
steps after the agent, as for a file or a call (ADR 0062). The box's checks (`ship pr --check`,
`make verify`) run on a stay's PR as on any run's.

## What it touches

`cli/kernel/think.ts` (`STAY_WORK_NOTE`), `cli/kernel/decide.ts` (`work`), `cli/kernel/prompt.ts`
(the `work` field), `playbooks/task.md`. Docs: `docs/tasks.md` (the stay section and its table),
`docs/design.md`, `docs/glossary.md`, this ADR and the index, `CHANGELOG.md`. Tests:
`kernel-flow`, `kernel-decide`.

## Three gaps, closed after it (8 Nov, #708)

The owner asked for a sweep after the merge. Task #709's runs that day showed three gaps:

1. **A run on a task your words reopened never stayed.** Plan reopens the issue as it starts, but
   kept the read that said closed, and `staysAfter` asks for an open task. Its first answer after a
   merge or a deploy always ended the job. Now plan's read says open once it reopened the task.
2. **A turn with nothing new ended the stay.** It named its open PR again (its prompt says "as
   before"). git refuses an empty bundle, so the turn before's bundle was left in its folder and
   taken for this one's: the box ran its checks, minted a key, sent the old commits again and ended
   the stay. Now an old bundle is removed first, and a turn that committed nothing leaves an open
   PR as it is, with no checks and no key.
3. **A fix after a refused push couldn't be sent.** The secret scan refused the run's push, so its
   commit never reached GitHub, and the stay's bundle started at that commit: apply's fetch had no
   base. Now whether a turn committed is still measured from its start (ADR 0063), but its bundle
   starts at the branch as its clone found it, and the box tells the turn what went wrong after its
   last answer (`STAY_FAILED_NOTE`), which its session never saw.
