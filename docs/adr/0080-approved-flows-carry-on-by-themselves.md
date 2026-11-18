---
status: accepted (merged #773, its two choices as recommended) and built in one PR (task #772, the owner's words of 2026-11-18 after the merge); see [As built](#as-built-2026-11-18)
date: 2026-11-18
amends: 0040 (a run also starts as the next step of a flow you approved), 0046 (a merge carries its flow on: a task first's merge carries on the task that waits for it, and a doc's merge opens its task again to build it), 0049 (a list stays until your `yes` or `no`, a newer list, a close or a day), 0066 (a split's Yes starts its ready parts: no `go`), 0075 (a task first's merge needs no `continue`; `first` may be separate work that nothing waits for)
---

# 0080: Approved flows carry on by themselves

## The plan in short

**Your asks** (task #772, a part of #763; your words on #767, and the last two again on #772,
2026-11-18):
- "can this starting tracking working of flows based on task closing and such actions like
  subtasks and issues can be easier good flow automatic and well written without needing to say
  continue or yes or go unnecessarily … complete report all work".
- "keep strong efficient policies which work seamlessly for the user no hurdles we anyways have
  strong rules".
- "stay tasks and answering batching all the asks and efficiently handling follow ups in
  scenarios to avoid rework clean efficient work for any agent".
- "any big tasks or anything separate can smartly independently go reach end state for approval
  well to close without me thinking or looking at it again and again".
- "keep it simple lightweight properly where things belong".
- "cant these be independent tasks why wait they can run there can be nice categorization and
  well handling".
- "also add follow up messages to the same tasks as asked and such to carry on or continue as
  needed well and proper".

**The rule:** a run starts when you ask, at a time you set, or as the next step of a flow you
approved: your Yes on its list, or your merge of its PR. Each start says why. Merges, tool calls,
workflow changes and operations on live apps stay yours.

**Five small changes, each in the place that does that step today:**
1. **A merge carries its flow on,** in the close run that the merge starts already:
   - a task first's merge carries on the task that waits for it: no `continue`;
   - a big change's doc merge starts its build: no `go`;
   - the flow's last merge says once what merged and what's left.
2. **What your Yes opens starts.** A split's Yes starts its ready parts: no `go`. A task first
   starts on its Yes already. `no` drops a list, and `stop` pauses a split, as today.
3. **A list stays** until your `yes` or `no`, a newer list, a close or a day. Words in between
   don't drop it, and the run doesn't list it again.
4. **Separate work opens as its own task** that nothing waits for: `first` with
   `"separate": true`, on the same list as the rest, beside the run's PR. It's filed where its
   work belongs: in the project that the task it came from is in, else as a chat of its own,
   which you can move into a project. It's never a part of a split: no parent waits for it, and
   its runs read no other task's goal.
5. **Your follow-ups reach the task they're about.** The run names the related task that your
   words are about (in its family, or one it opened, or the one that opened it), and the box
   copies your exact words there and starts its run. `continue` on a task that only waits is
   answered with no agent.

**What it adds:** no key, permission, setting, label, workflow change or box setup. Three optional
fields in a run's result (`first.separate`, `drop_list`, `pass`) and two in a task's status
(`waits`, `separate`). It takes fewer runs than today (section 6).

**The build:** one PR. This doc is a big change's doc as today: merge it, then say `go`. It's the
last doc that needs that word.

## 1. What happened on #767 (2026-11-18)

One Claude Code update, with today's rules:

1. The run at 10:48 listed a task first, #771 (list `3ec5d28d`). Your `yes` opened and started it.
2. Your next words started the runs of 11:16 and 11:20. Each listed the same task first again:
   words drop a list before the run, and those runs treated your Yes as still to come. Your
   second `yes` found #771 open, and dispatched it a second time.
3. The reply of 11:20 said "open a new chat with `shipify: approved flows …`": a hand step that
   ADR 0075 forbids, but a run can open a task only as a task first. So you asked again: "cant we
   start the new task approved flows one as we asked".
4. Your `continue` at 11:27 took a run with the agent (58 s, 2.2M tokens in) to say that #767
   still waits for #771.
5. The run of 11:31 listed this task as a task first, so #767 is "blocked by" #772, though #767
   doesn't need it. You asked: "cant these be independent tasks why wait".
6. A task first opens under the parent of the task that waits, so #772 is a part of #763. Its
   runs read #763's goal, which isn't theirs. #763 closes only after #772 does. And #772 can't be
   moved into a project, because a part can't. You asked for "nice categorization", and sent both
   asks again on #772.
7. Still to come: #771 merged, and #767 waits for your `continue`. After this doc merges, this
   task waits for your `go`. When #772 merges, #767 is told "say `continue`", though it never
   waited for #772.

## 2. What was checked (main at 2487de96, 2026-11-18)

| Fact | Where |
|---|---|
| After your `go`, a part's merge starts each part that waited only for it, in its close run (no agent). Before `go`, nothing starts | `partClosed` (`cli/kernel/parts.ts`); `kernel-decide`: "starts each part that waited only for it, after your `go`" |
| A split's Yes opens the parts and starts nothing ("Say `go` to start …") | `openedText` (`parts.ts`); apply's `split` write |
| A task first's Yes opens it and starts it at once | apply's `first` write (`cli/kernel/apply.ts`) |
| A task first's merge writes one comment on the task that waits ("… so this task can go on: say `continue`"). A `tell` writes a comment and starts nothing | `partClosed`; apply's `tell` |
| A dispatch carries only the task's number and the job. A dispatched run with no new words ends with "nothing new", with no agent | `task.yml` (`workflow_dispatch`'s inputs); apply's `start`; `decide.ts` (`dispatched`) |
| A big change's doc PR says "Part of #n", so its merge closes nothing. `task.yml` has no PR trigger: no run starts, and nothing is said. The next run sees the PR merged | `taskLine` (`cli/lib/links.ts`), `prBody` (`apply.ts`); `task.yml`'s `on:`; `snapshot.ts` |
| A doc PR that closes its task gets "**Merged:** … Say `go` here to build it: the task opens again for it." `go` on the closed task opens it again and builds | `closing` (`decide.ts`); `kernel-decide`: "a change doc's merge closes the task and names `go`" |
| A close run starts for a task that says `needs you`, `working` or `waiting`, or has the label `sub-task`. A task with an open PR says `needs you` | `task.yml` (`run.if`) |
| A new project's plan builds when it merges already: a push of `plans/*.plan.md` runs `ship task plans`, which starts the task's github job, then its build | `task.yml`; `taskPlans` (`cli/commands/task/plans.ts`) |
| Words after a list drop it before the run, and nothing says so. A list of notes only stays. A newer list overwrites the old one field by field | `planned` (`decide.ts`); `kernel-decide`: "`no` drops the list; other words after it plan again" |
| A Yes names its list by a code over the list's content, and counts within a day. Every chat puts Yes and No under the reply that carries the list | `listCode` (`cli/kernel/keys.ts`), `yesOrNo` (`decide.ts`); `replyButtons` (`cli/contracts/words.ts`) |
| A part's run that the box started doesn't stay | `staysAfter` (`cli/kernel/stay.ts`) |
| Only the kernel reads the label `first`. The web chat folds a part under its parent by its first line, `Part of #n` | `parts.ts`, `apply.ts`; `edge/src/web/reads.ts` |
| A task first opens as a sub-issue of the task that waits, or of that task's parent when it's a part. A split's parent closes only when every sub-issue has closed, tasks first too | `firstPart`, `partClosed` (`parts.ts`) |
| A project's chat is its sub-issue, with the line `Part of #<project>`. The family read also gives the project above a split's part. "Move to project" refuses a part | `cli/contracts/projects.ts`; `family` (`cli/lib/github.ts`); `moveToProject` (`edge/src/capture.ts`) |
| An issue the box opens counts as the box's own (`run`). The due run follows such an issue only when it has the label `sub-task` or `recipe` | `authorOf` (`snapshot.ts`); `mine` (`cli/commands/task/due.ts`) |
| Words count as yours when you wrote them on GitHub, or the door did for your chat. A comment the box writes with the workflow's token starts no run | `freshOf` (`decide.ts`); ADR 0066's checks |
| A chat's `close` closes a task as completed: no chat closes one as not planned | `edge/src` sets no `not_planned`; `closedPlan` (`decide.ts`) reads `stateReason` |

## 3. Options

**How a merged doc starts its build:**
- **A: The doc's PR closes its task, and its close run opens the task again and builds**
  (chosen). (+ The one event that every repo gives: a project's PR closes a Shipify task today.
  + Where the step lives: that close run says "say `go`" today. − The task shows as closed until
  its run starts: about a minute, longer when every slot is busy.)
- **B: A push to `main` that adds a doc starts its task's build,** as a merged plan does. (− Only
  Shipify's own docs: a project's change doc merges in its own repo. − A workflow change.)
- **C: The due run looks for merged docs every 10 minutes.** (− Polling: a slot each time, and up
  to 10 minutes late. ADR 0066 refused it for parts.)
- **D: Keep `go`.** (− The word you asked to drop.)

**What opens a task first or separate work:**
- **A: Your Yes on the list, as today, and what it opens starts** (chosen). (+ Your note counts a
  Yes as a flow's approval. + An agent's words become your words for another run only after you
  read them, as ADR 0066 and 0075 decided. + Nothing new to drop one.)
- **B: Opened and started with no Yes, when the run read nothing from outside,** as notes and
  pre-approved calls are. (+ One tap fewer. − Agents that open tasks for each other with no look:
  ADR 0066 left this out. − Dropping one would need a new word: no chat closes a task as not
  planned, and a close as done would carry its waiting task on.)

**How a list lives:**
- **A: It stays. The run sees it and doesn't list it again. A run whose words drop it says so**
  (chosen).
- **B: As today:** words drop it, and the next run lists again what still stands. (− #767: one
  list three times, a second Yes, and a task started twice.)
- **C: It stays, and every reply shows it again.** (− ADR 0049 shows a list once. − The same list
  under every reply.)

**Where separate work goes:**
- **A: `first` with `"separate": true`, opened as a chat of its own: in the project that the task
  it came from is in, else on its own** (chosen). (+ One field, the same list. + Filed where its
  work belongs: a project groups it, or you move it into one later. + No parent waits for it, and
  its runs read no other task's goal. − The due run must know the label `first` too: one line.)
- **B: Opened where a task first opens, under the task's parent, with no link that holds
  anything** (this doc's first draft). (+ No new place to open in. − Under a split, it's one more
  part: the parent closes only after it, and its runs read the parent's goal, as #772 does under
  #763. − A part can't be moved into a project.)
- **C: A new result field for it.** (− Two fields for one thing.)

**How your follow-ups reach the task they're about:**
- **A: The run names the task, and the box copies your exact words there** (chosen). (+ Your
  words, never the agent's. + Only to a related task: its family, a task it opened, or the task
  that opened it.)
- **B: That task's run reads the other thread itself.** (− The agent can't tell your words from
  anyone else's on GitHub. − Nothing starts that run.)
- **C: The reply asks you to say it there.** (− A hand step: ADR 0075.)

## 4. Decision

### 4.1 The rule (amends ADR 0040)

A run starts for your words (and the fixed words), for a time you set (a repeat, a reminder, a
check, a recipe), for what follows something you did (a merge's deploy, an errand), and now for
**the next step of a flow you approved:**
- your Yes on a list starts what it opens: a split's ready parts, a task first, separate work;
- your merge of a PR starts what waited for it: the next part, the task that waited for its task
  first, a doc's build.

Each such start says why, in its reply's run details ("#771 merged, so this task carried on").
Nothing else starts. A run that still fails after its one round to fix the box's checks stops and
says so, as today, so a flow never loops. A run that the box started doesn't stay (as a part's,
ADR 0066): its slot is free for the next step.

### 4.2 A merge carries its flow on (amends ADR 0046, 0066 and 0075)

**A task first's merge:**
- When your Yes opens a task first, the task that waits for it keeps its number in its status
  (`waits`).
- The first's close run (no agent) dispatches the waiting task's run when the first closed as done
  (merged, or closed as done by hand) and the waiting task is open. Its "say `continue`" comment
  goes. Closed as not planned, the waiting task is told, as today ("… still needs its fix"). A
  closed waiting task is told nothing.
- Before the dispatch, the box takes the label `staying` off the waiting task, so a stay there
  leaves at once, as `ship task plans` does for a merged plan.
- The waiting task's run, with no new words, reads its family and takes each closed task out of
  `waits`. When none is left and one merged, it carries on as `continue` does, with the reason
  `carry-on`. Its prompt says: "#771 merged (PR #775): carry on from where the last run stopped."
  While one still works, it ends with no agent.
- `waits` empties when a run on the task asks for a PR (your words carried it on without them),
  or when the task closes.

**A big change's doc merge:**
- A doc's PR (kind `part-of`: a change doc or an ADR; not a new project's plan, and not a split
  parent's PR) says "Closes #n". The box ends its body with: "Merging this accepts it and starts
  its build."
- The merge closes the task. Its close run sees that the merged PR is the doc and that no build
  PR came after it. It opens the task again and builds in the same run, as `go` does today (the
  reason `go`, a fresh clone). It posts no "Merged" reply: the build's reply comes next.
- **Your merge accepts the doc as it is,** with its decisions as recommended, unless you said
  otherwise on the task before the merge. That's ADR 0061's rule for a proposed ADR; only the
  `go` after it goes.
- `go` stays for a doc merged before this change, a build you stopped, and a doc PR you closed by
  hand.
- A new project's plan: as today. Its merge starts its build already (`ship task plans`).

**One report at the end:**
- The task where the flow started says it once, when it closes: each PR the flow merged (the doc,
  the build, each task first, each part), what's left (a part dropped), and the separate work it
  opened, each with its state (from its status's `separate`).
- A split's parent says it in its "All N sub-tasks are closed" comment, now with each part's
  title and PR. A task with no split says it in its own merge's reply (Merged or Live), with one
  line for each other PR of its flow.
- In between, a step that carries on says nothing to you. You hear from a flow when it needs you
  (a PR to merge, a question, a failure), and at its end.

### 4.3 What your Yes opens starts (amends ADR 0066)

- **A split's Yes:** the box opens the parts, puts `started` on the task, and starts each ready
  part, as `go` does. The reply: "Opened #13 and #14, and started #13. #14 starts when #13 merges.
  `stop` pauses."
- **`stop`, `go` and `go #n`** on the task work as today: `stop` pauses, and `go` carries on after
  it.
- **A task first, and separate work:** your Yes opens and starts them, as a task first's does
  today.
- **`no`** drops the list, as today.

### 4.4 A list stays (amends ADR 0049)

- A list goes on `yes` or `no`, a newer list (which replaces the old one whole), `close` (a
  merge's close too), `start over`, or a day (a Yes after a day is refused, as today). Other words
  keep it: yours, a guest's, `continue`, `go`, `stop`. This holds for every list (calls, notes, a
  split, a workflow change, a task first, a clean start, an operation).
- A run that answers while a list waits gets it in its prompt (its lines and its code), and
  doesn't list it again. When your words change it, the run lists the new one, which replaces it.
  When your words drop it ("don't make that page"), the run's result says `"drop_list": true`, and
  the box drops it.
- The list shows once (ADR 0049), with its Yes and No under it. A later reply that lists nothing
  ends with one line of the box's: "Your list of 11:20 still waits for your Yes."
- A task first that's open already (an open task in the family has its title) isn't listed again:
  the reply names it ("#771 is open and working").

### 4.5 Separate work (amends ADR 0075)

- The result's `first` takes `"separate": true` for work the run found that this task doesn't
  need, such as a change to Shipify that a project's task ran into, or a new task you asked for in
  this thread. Its brief is 600 characters at most, as a task first's.
- It doesn't come alone: it may come with `pr`, `calls` and `notes`, because it holds nothing up.
  It never comes with `split`, which comes alone.
- The list says: "Open and start `<title>` as a task of its own; this task doesn't wait for it:
  <brief>".
- **Where it's filed,** on your Yes, by one rule: where its work belongs, never as a split's part.
  - In the project (ADR 0069) that this task is in, or that this task's split is in: a chat of
    that project, as "New chat here" opens one (the line `Part of #<project>`, and the project's
    sub-issue link).
  - Else as a chat of its own in your list. "Move to project" files it later, as it does any
    chat.
- **Its body:** after a project's `Part of` line, the line "From #767: opened there; that task
  doesn't wait for this one", the brief you approved, and this task's `use` line, as a part's
  body has. No blocked-by link.
- **Its label:** `first` alone, never `sub-task`: it's no split's part, so no parent waits for it to
  close, and its runs read no other task's goal. The due run follows an issue the box opened with
  `first` too (one line in `mine`).
- It starts at once. This task's status keeps its number (`separate`), so the reply here names it,
  your follow-ups can reach it (4.6), and this task's report counts it (4.2).
- Its close tells no one, because nothing waits for it.
- The label `first` now means "a task that a run opened on your Yes, not a split's part": with
  `sub-task`, a task first that a task waits for; alone, separate work. Its description says so.

### 4.6 Your follow-ups reach the task they're about

- **`continue` on a task that waits** for an open task first is answered with no agent: "#767
  waits for #771, which is working. It carries on by itself when #771 merges." Your other words
  start a run, as today, and its prompt says what the task waits for.
- **Words about another task:** when your newest words are about a related task, the run's result
  names it: `"pass": [772]`. A related task is one in this task's family (its parent, a part, a
  sibling), one this task opened (a task first, separate work: its `waits` and `separate`), or
  the one that opened it (the "First for" or "From" line in a body the box wrote). The box copies
  your words exactly onto that task, in one comment (each with its time, "From #767"), and starts
  its run, as your words there would: it carries on with them. The reply here ends: "Passed to
  #772." Words about this task stay here, and words about two tasks go to both.
- That task's run reads them as your words on its own thread, but never as a fixed word: a passed
  `yes`, `go` or `close` is plain words there.
- The box's comment counts only when the box wrote it and nobody edited it since, as a status
  comment does (ADR 0031). Only your words are passed: never a guest's or the agent's.

### 4.7 Security

- **Each start has your approval at its root:** your words, your Yes on a list whose words you
  read, or your merge. A step that carries on runs with the same profile, clone and keys as any
  run of its task.
- **What stays yours:** every merge, tool calls, workflow changes, operations on live apps (ADR
  0049, 0075), a new project's keys (`publish`), and all that a list holds.
- **A merged doc builds:** the merge was always the approval (ADR 0003, 0061), and the build is a
  PR you merge.
- **A list that stays** is approved only by your Yes, whole, by its code, within a day, as today.
  A run can drop a list, and never approve one. A guest's words no longer drop your list.
- **Passed words** are yours, copied by the box, never written by the agent. The agent only names
  a related task, and the box checks that it is one. A passed fixed word does nothing.
- **Separate work** holds the brief you approved, as a task first does. The box opens it, so it
  counts as the box's own; it never waits on, or for, another task.
- **No new key, permission or workflow change.** The workflow's token dispatches runs and writes
  comments today.

## 5. Edge cases

| Case | What happens |
|---|---|
| Two tasks first for one task | It carries on when the second merges. The first's merge starts a run that ends with no agent |
| A task first closed as done by hand, with no PR | It counts as done, and the task carries on |
| A task first closed as not planned | The task is told, as today, and doesn't carry on: your words decide |
| The waiting task is closed when its first merges | Nothing is told, and nothing starts |
| Your words carried the waiting task on already | Its run finds nothing in `waits` and ends with no agent |
| The waiting task works or stays when its first merges | The stay leaves. The carry-on run starts after the run that works, in the task's queue |
| A task first opened before this change | Its merge tells the task, as before: "say `continue`" |
| A doc PR closed without a merge | Nothing starts: the task waits on you, as today |
| You merge a doc and want no build yet | `stop` on the task: the build stops within a minute, its commits stay on the branch, and `continue` carries on |
| A part is a big change | Its doc's merge closes the part, and its close run builds it. That isn't a part's close: nothing that waits for it starts. A part counts as done only once its own close run has seen to it, so a sibling's close in that minute starts nothing early |
| A doc on another account's repo | Its merge closes the task as a `closes` PR does there. Where GitHub doesn't close it, `go` builds, as today |
| A doc merged before this change (its PR said "Part of") | `go`, as today |
| A split's Yes, with more ready parts than free slots | GitHub's queue holds them, as after `go` |
| A split's Yes, then `stop` | Parts already started run. No new one starts; `go` carries on |
| A list waits, then a run fails | The list still waits |
| A list waits, then a newer list | The newer one replaces it whole. A Yes with the old code is refused: "isn't waiting any more" |
| A list waits, and your words drop it | The run's `drop_list` drops it, and its reply says so |
| A run lists a task first that's open | Not listed. The reply names the open one |
| `separate` with a `pr` | The PR opens at once. The separate task waits for your Yes on the list |
| Separate work from a task in a project, or from a part of a split in one | It opens as a chat of that project |
| Separate work from a part of a split in no project | It opens as a chat of its own. The split's parent doesn't wait for it, and its runs don't read the parent's goal |
| Separate work, then you move it into a project | It moves, as any chat does: it's no part |
| The project is full (100 chats) or closed | It opens as a chat of its own, and the reply says why |
| `separate` or `pass` from a guest's run, a read run or a project's own thread | Not listed or passed, as a task first isn't |
| `pass` names a task that isn't related | Not passed. The reply says so |
| `pass` to a closed task | It opens again, as your words would open it |
| `pass` to a task at work | As your words there: the run at work, or the next one, reads them |

## 6. Calls

| Step | Today | With this |
|---|---|---|
| A task first merges | its close run (no agent) and 1 comment; then your `continue` starts a run | its close run (no agent) and 1 dispatch, for the run your `continue` started |
| A doc merges | nothing; then your `go` starts a run | its close run is the build's run |
| A split's Yes | 3 GraphQL calls; then your `go`: 1 read, 1 label, 1 dispatch per ready part | 3 GraphQL calls, 1 label, 1 dispatch per ready part |
| Words while a list waits | a run that lists it again | a run that doesn't |
| `continue` on a task that waits | a run with the agent (#767: 58 s, 2.2M tokens in) | an answer with no agent |
| A follow-up about another task | you say it again there | 1 comment and 1 dispatch |
| Separate work opens | as a task first: 1 read, the issue, a blocked-by link, 1 label, 1 dispatch | the issue with its label (and its project's link), 1 dispatch |
| The report | the parent's "all closed" comment | the same comment, with more lines |

No new read, polling, store or service.

## 7. Build plan (one PR, after your merge and `go`)

Test-first (`skills/test-driven-development`), with #767's flow replayed end to end in
`tests/kernel-flow.test.ts`:

1. **Result and status** (`cli/kernel/result.ts`, `cli/lib/task.ts`): `first.separate`,
   `drop_list` and `pass`; the status's `waits` and `separate`; the reason `carry-on`.
2. **Decide** (`cli/kernel/decide.ts`): the list stays (`planned`), `drop_list`, the "still waits"
   line, a task first that's open already; the carry-on run; `continue` while a task waits; a
   doc's merge builds (`closing`); passed words count (`freshOf`), never as fixed words; the
   report's lines.
3. **Parts** (`cli/kernel/parts.ts`): a first's close dispatches; separate work's place (its
   project from the family read, else none) and body; a split's Yes starts the ready parts; a part
   is done once its own close run saw to it; the report.
4. **Apply** (`cli/kernel/apply.ts`): the doc PR's footer and line; `staying` off before a
   carry-on; separate work opened and started, with the record's calls of today (`openParts`
   under its project, `createIssue` on its own: no new record call); the `pass` write. The due
   run's `mine` (`cli/commands/task/due.ts`) takes `first`.
5. **The prompt** (`cli/kernel/prompt.ts`): the list that waits, `carry-on`, what a task waits
   for, passed words.
6. **The playbook and the docs** (below).

No workflow change: `run.if` starts the close runs that these need already.

## Setup

Nothing to set up.

## Docs and clean-up

- `playbooks/task.md`: the big lane ("your merge starts the build": the `go` line goes), A task
  first (it carries its task on by itself; `separate`), Finish's fields (`first.separate`,
  `drop_list`, `pass`), and the list rule.
- `docs/tasks.md`: Fixed words (`yes`, `no`, `continue`, `go`), "Your `yes`" (words keep the
  list), Lanes (big), Sub-tasks (Open, Start, Next, End; a task first; separate work), Carrying on
  and closing (passed words), After your merge.
- `docs/tools.md`: "other words drop the list".
- `docs/channels.md`: the Plan card's Start all ready (after `stop`).
- `docs/knowledge.md`: a project's chats include separate work that a run in it opened.
- `docs/glossary.md`: carry on, separate work, passed words, and "a task first".
- `docs/security.md`: Approvals (a Yes starts what it opens; a merged doc builds; passed words).
- `cli/contracts/labels.ts`: the label `first`'s description. `cli/contracts/words.ts` and
  `intents.json`: the help for `go`.
- ADR 0040, 0046, 0049, 0066 and 0075: "amended by 0080", in their status lines and in
  `docs/adr/README.md`.
- `CHANGELOG.md`.

## Consequences

- **Easier:** an approved flow needs no more words. #767's flow would be your Yes, the merge of
  #771 and the merge of #767. Big work needs one merge per PR. Separate work opens beside the
  run's PR, filed in its project or on its own, and holds no split open. Your follow-ups need no
  copying.
- **Harder:** a doc's task shows as closed for a minute before its build. Three more result fields
  for agents to use well. A flow's runs start while you're away: each shows in the chat's list,
  and `stop` pauses it.

## Confirmation

- `tests/kernel-flow.test.ts`: #767's flow end to end: a task first listed once, words that keep
  the list, one Yes, the first's merge, the task carried on with no word, its PR's merge, one
  report. A doc's merge builds. A split's Yes starts its ready parts. Separate work beside a PR,
  from a part in a project and from one in none, and its split's parent closing without it.
  Passed words, both ways between a task and the separate work it opened.
- `tests/kernel-decide.test.ts`: each edge case above.
- On the box after the merge: the next task first carries its task on by itself.

## Decisions for you

Merging this accepts section 4. These are the two choices it makes, so you can comment before you
merge:
1. **A Yes still opens a task first or separate work** (option A), and all that follows needs no
   word. Or option B: they open with no Yes after a run that read nothing from outside.
2. **A doc's merge starts its build** (option A), with its decisions as recommended. Or keep `go`.

## Sources

- Task #767's thread, 2026-11-18: your messages after the reply of 10:48, and the replies of 10:48
  to 11:34. The approved brief of 11:34 (list `bd5b2091`): "A run opens separate work as an
  independent task, filed in its project".
- Task #772's thread, 2026-11-18: your message of 12:06, the last two asks again.

## As built (2026-11-18)

Built in one PR on task #772, after you merged #773 and wrote "the PR for doc merged so we can
cleanly handle". The same PR has the fix you asked for in that message: a PR's link in the web
chat opens on GitHub (the door App can't read a PR). What differs from section 4, or wasn't said
there:

- **A part's doc keeps `go`.** Its PR still says "Part of", so its merge closes nothing. Section
  5's rule ("a part counts as done only once its own close run has seen to it", read from its
  state labels) fails when two parts close at once: each close run can read the other's labels
  before they come off, and then neither starts the part that waits for both. A split's own PR,
  and a doc merged before this change, say "Part of" too.
- **The doc's PR** ends "Closes <owner>/shipify#n", then "Merging this accepts it and starts its
  build." It's recorded as a doc (`change`) as before. The close run builds when the merged PR is
  a doc, the task isn't a part and has no split: the reason `go`, a fresh clone, and a note that
  your merge started it. After a project's deploy, its Live reply comes first, then the build.
- **Separate work's place:** the project the task is in (its parent labelled `project`), or the
  one above its split, when it's open; else a chat of its own (label `first`, made when missing).
  When the project can't take it (full, or GitHub refuses), it opens on its own, and the reply says
  why.
- **A task first's line** says "that task carries on by itself when this one merges". A first
  whose body has the old line ("that task waits for this one") still tells its task to say
  `continue`. A waiting task that's closed is told nothing.
- **The carry-on:** a task whose status `waits` reads its family on every run, so it sees its
  firsts close. It carries on once each has closed and one merged; the run's notes name what
  merged and its PR. `continue` meanwhile gets "#12 waits for #30, which is still open. It carries
  on by itself when it merges: you needn't say `continue`.", with no agent.
- **The list:** decide takes a waiting list off before it reads a run's result, puts it back when
  the run lists nothing new (the reply ends "Your list of <day, time> still waits for your
  `yes`."), and drops it on `drop_list` ("Dropped your list of …, as you said"). A run that fails
  or is stopped leaves it as it was. The prompt shows it under "A list waits for the owner's Yes".
- **Passed words:** a comment of the workflow's token whose first line is `<!-- shipify-pass
  {"from":12,"v":1} -->`, then "Your words on #12, passed here by the box:" and each message
  quoted with its time. The snapshot names its author `passed` only while it's unedited. The box
  starts that task's run; a stay there answers it first.
- **The report:** a task's merge reply ends "The rest of this flow:", a line for each other PR,
  each task first (from the family) and each separate work (from `separate`). A split's last reply
  names each part with its title and PR.
