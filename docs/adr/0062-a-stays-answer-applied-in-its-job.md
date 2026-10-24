---
status: accepted (the owner's merge of #525) and built; amended by 0063 (plan decides a fixed word: point 4's handover is only for another agent, a fresh clone or an edit)
date: 2026-10-18
amends: 0057 (a result that needs a token no longer goes to a normal run), 0060 (the job after a stay)
---

# 0062: A stay's answer that needs a token is applied in its own job

## The plan in short

1. **A stay's turn whose answer needs a write key ends the stay, with the answer decided.** The
   key can be a repo's (a push or a PR), a tool's (an approved call), `workflows`, or shipify's
   files branch (a reply with files).
2. **The same job then mints exactly those keys and applies the answer**, as decide and apply do.
   No new run starts, and nothing is thought twice.
3. **Write keys still exist only after the agent has finished** (`security.md`). The stay's own
   step holds no write key, as before.
4. **Everything else hands over as today:** a fixed word, a closed task, an edit, and words plan
   would choose differently go to a normal run before any thinking, so nothing is lost there.

## Context

On #523 (18 Oct) a stay answered two messages. It ran tests, wrote a plan and an architecture
doc, and finished its answer at 07:38 with a file attached. A stay can't post files: only the
steps between decide and apply mint the files token. So the turn returned `handover`
(`cli/kernel/run.ts`, the turn in `runStay`), and the stay dispatched a new `job: run`.

The decided answer lives in `.tasks/<n>/decided.json`, and the agent's files in the run's out
folder, both in the job's workspace. A new job doesn't have them. The new run planned and thought
again, for 15 minutes, and the owner saw nothing for about 20. The first answer was lost.

The same happens to every stay turn that needs a key: a reply with files, a tool call you said
`yes` to, a workflow file, and a question's kept commits.

## The options

| | What | For | Against |
|---|---|---|---|
| **A** | Carry the decided answer and its files to the new run | Small kernel change | The new run can start on another box: the answer needs storage every box can reach (a branch, an artifact), and the new run needs a "post only" path. More parts, more calls |
| **B** | **Finish in the same job** (chosen) | No new run, no storage, no second think. One code path for the outputs. The fastest answer | `task.yml` gets a second set of mint steps and an apply step after the stay |
| **C** | Give the stay write keys | No new steps | Breaks the rule that no write key exists while an agent runs (`security.md`). Rejected |

B is the simplest that is also secure. It fits "fewer calls and less resource use": one job, no
dispatch, no second session.

## The flow

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Task as Task (GitHub issue)
    participant Stay as Stay step (read keys only)
    participant Agent as Agent (same session)
    participant Mint as Mint steps (task.yml)
    participant Apply as Apply step

    You->>Task: your words
    Stay->>Task: reads every 2 s, finds them
    Stay->>Stay: plan (same profile, account, agent?)
    alt a fixed word, closed, edited, or another choice
        Stay->>Task: staying off, dispatch a normal run
    else the same turn
        Stay->>Agent: think (resume the session)
        Agent-->>Stay: result.json (+ files in out/)
        Stay->>Stay: decide → .tasks/n/decided.json
        alt needs no key
            Stay->>Task: apply: the reply, then wait for more words
        else needs a key (files, a call, a push, workflows)
            Stay->>Stay: outputs: apply=yes, repo, account, act, workflows, files, keep
            Stay->>Task: staying off (words after this start a run, which waits for this job)
            Note over Stay: the stay step ends, its agent done
            Mint->>Mint: a fresh read key; only the write keys the outputs name
            Apply->>Task: post the reply, files, PR or calls from decided.json
        end
    end
```

How information moves:

- **In:** your words come from the task. The stay reads them with read keys and gives them to the
  agent's session.
- **Kept:** the agent writes `result.json` and its files in the run's out folder. Decide turns them
  into writes in `.tasks/<n>/decided.json`. Both stay in the job's workspace until the job ends.
- **Out:** the stay's step outputs name only what to mint, as plain words (`output()` in
  `run.ts`, never free text). The apply step reads `decided.json` and the out folder, and posts.

## What changes

- `cli/kernel/stay.ts`: a new turn result, `apply`, and `needsMint(d)` (moved from the turn's two
  checks). On `apply`, the stay leaves as on any end: `staying` off, then one last read. Words that
  came meanwhile dispatch a run, which waits in the task's concurrency group until this job ends.
- `cli/kernel/run.ts`: `mints(s, d)` writes the step outputs for both `runDecide` and a stay's
  `apply` turn, so the rule is in one place. The turn writes `apply=yes` and returns `apply`.
- `task.yml`, after the Stay step: a read token, the three write tokens (`stay_write`,
  `stay_write_account`, `stay_files`) and "Apply the stay's answer", each only when
  `steps.stay.outputs.apply == 'yes'`. Each mint is decide's own, reading the stay's outputs.
  `tests/workflows.test.ts` holds them equal, so the two sets can't drift.
- The job's clock is unchanged: `JOB_MARGIN_MINUTES` (15) already keeps time for the last turn's
  decide and apply.

## Setup

None. No new secret, variable or service.

## How it's built

`cli/kernel/stay.ts` (`needsMint`, the `apply` turn) and `cli/kernel/run.ts` (`mints`, shared by
decide and a stay's turn), with `task.yml`'s five steps after Stay: a read-only token, `stay_write`,
`stay_write_account`, `stay_files`, and "Apply the stay's answer". `tests/workflows.test.ts` holds
those steps equal to decide's, reading the stay's outputs, so the two sets can't drift apart.

The kernel change and the workflow change must merge together. Without the new steps, a stay's
answer that needs a key would end the stay and nothing would post it.

## Risks

- **The stay step fails after it wrote `apply=yes`:** the apply step also needs
  `steps.stay.outcome == 'success'`, so it doesn't run. The job's failure step tells you, as for
  any failed step.
- **A write key that fails to mint:** as in a normal run. A question's kept commits continue
  (`keep`), and anything else fails the job with its reason.

## Open questions

None known. Your review can change this on the same branch before you merge.

## Addendum: a file shared before isn't uploaded again (2026-10-18, task #527)

On #526 a stay's turn listed the same file it had shared one answer before. Its upload needed the
files key, so the stay ended for an answer that changed nothing. Now apply keeps each file it
shares in the task's status (`shared`: its name, a hash of its content and its link; the newest 20),
and decide links a file listed again with the same hash ("… (unchanged)") rather than upload it
(`sharedBefore`). An answer whose files are all unchanged needs no files key, so the stay goes on.
A new or changed file is uploaded as before. A file is no longer sent to the chats again either:
the chat has it from its first reply.
