---
status: accepted (merged #582; the owner's `go` on 2026-10-28 took the three decisions as recommended) and built in one PR (task #581); see [As built](#as-built-2026-10-28). From the owner's words of 2026-10-27 and 2026-10-28.
date: 2026-10-28
amends: 0040 and 0046 (a sub-task's merge may start the next sub-task, only after your `go`), 0053 (§1: the close of a sub-task starts a run with no agent), 0060 (a sub-task's run that the box started does not stay), 0039 and 0065 (the web chat: a Waiting state, sub-tasks under their parent, a Plan card)
---

# 0066: Sub-tasks: one task, a few PRs, in order, when you say

## The plan in short

**What:** a task can split into **sub-tasks**. Each sub-task is a normal task with its own run,
its own PR and its own thread. The record is GitHub's own **sub-issues** and **blocked by** links,
so nothing new is stored.

1. **Split.** You ask for it ("split it"), or a run sees that the job is more than one PR and
   suggests it. The reply lists 2 to 8 parts, each with a title, a brief and what it waits for,
   with **Yes** and **No**.
2. **Open.** On your `yes`, the box opens the parts as sub-issues of the task, with their
   blocked-by links. **Nothing starts.**
3. **Start.** `go` on the task starts every part that is ready. `go #n` starts one part. `stop`
   starts no new parts; the ones that run finish.
4. **Next.** After your `go`, when a part's PR merges, the box starts each part that was waiting
   only for it, in the close run that the merge starts already. No agent and no polling.
5. **End.** When all parts are closed, the task says so and closes.

**Why:** Paperclip (task #581, `doc/execution-semantics.md` §6) splits work the same way. Its
rules are good and small: two kinds of link (structure and order), a blocked part waits, a
dropped part is not done, and done is a fact, not a sentence.

## The owner's asks (task #581)

- "does it have attaching of multiple types of agents … something we can borrow or add for
  ourselves it can work cleanly efficiently work and best scale" (2026-10-27)
- "make this a bit more robust in plan like multiple sub tasks or something to break down and
  start if required" (2026-10-27)
- "What type of tasks can it work well for will it work cleanly properly … also we need to
  update cleanly show and manage in web chat as well" (2026-10-27)
- "write the adr one PR well handled designed plan overall plan properly check properly with edge
  cases" (2026-10-28)

## What was found (checked 2026-10-28, `main` at `ea86c16`)

| Fact | How it was checked |
|---|---|
| GitHub has sub-issues and blocked-by links. GraphQL `Issue` has `parent`, `subIssues`, `subIssuesSummary`, `blockedBy`, `blocking`, `issueDependenciesSummary`; mutations `addSubIssue`, `removeSubIssue`, `addBlockedBy`, `removeBlockedBy` | introspection with the owner's token; a query on #581 answered (`parent: null`, `subIssuesSummary {0, 0}`) |
| The REST list the web chat reads already returns, for each issue, `sub_issues_summary` (`total`, `completed`) and `issue_dependencies_summary` (`blocked_by`, open blockers) | `GET /repos/aayush-t-apps/shipify/issues?per_page=1` |
| Nothing in Shipify uses sub-issues or dependencies today. The prompt reads no linked task | grep of `cli/`, `edge/`, `docs/` |
| An issue that the box opens starts no run: the record writes with the workflow's `GITHUB_TOKEN`, and GitHub starts no workflow for its events. The box dispatches `task.yml` itself when it wants a run (recipe tasks) | `due.ts` `keepRecipes` (`createIssue`, then `start(n)`); `status-issue.ts` |
| The due run sees a box-opened issue only when it has the `recipe` label | `due.ts` `mine()` |
| A merge of a task's own PR always starts its close run: a task with an open PR is `needs you`, and `run.if` starts a close run only for `needs you`, `working` or `waiting`. That run has no agent (`closedPlan`) | `task.yml` `run.if`; `decide.ts` `closedPlan` |
| A merged `closes` PR closes its task through GitHub's keyword (`state_reason: completed`). A `part-of` PR leaves it open | `links.ts` `taskLine`; ADR 0053 |
| Fixed words are whole comments: `go`, `stop`, `yes`, `no` and the rest. `go` builds a big change after its doc PR merged; `stop` stops the run that works, or says "Nothing was working" | `cli/contracts/words.ts`; `decide.ts` |
| A list waits for `yes <code>` (fingerprint, 24 h, an edit voids it). The web chat shows Yes and No as buttons, unless the list is too long | `decide.ts` `yesOrNo`; `words.ts` `replyButtons` |
| Apply writes a journal line before each outside change: a change that started and did not end is told, not done again | `apply.ts` `journal` |
| A run stays after it answers your words, unless it started another run or closed the task. A scheduled run does not stay | `stay.ts` `staysAfter` |
| Slots: one GitHub runner per slot; a run waits in GitHub's queue for a free one. One run and one waiting per task (`task-<n>`); no limit across tasks | `task.yml` `concurrency`; `docs/box-setup.md` |
| **Same-repo PRs:** on shipify, a PR adds a `CHANGELOG.md` line and bumps no version; changelog conflicts resolve by themselves (`resolveChangelogConflicts`). On a project, each PR bumps `shipify.json`; `ship refresh` makes the bump again on the next run. A code conflict after a PR opened waits for your `continue` | `workspace.ts` `prRules`, `projectRules`; `docs.ts`; `think.ts` |
| The web chat's page is at 40.1 of its 42 KB; `workspace.js` at 7.6 of its 9 KB | `tests/edge/web/extension.test.ts` |

## Where sub-tasks fit

Split only when each part is **its own PR that is worth a review by itself**, and one of these
is true: the parts are in different repos, they can run at the same time, or one must merge
before the next can start.

| Good fit | Example |
|---|---|
| One change across repos (a run has one clone) | `shipify:` a new field → `shipify-template:` uses it → `links:` turns it on |
| The build after a big change's doc | an ADR's build plan, each step a short PR |
| The same job on many projects | "upgrade every app": a part per app, in parallel |
| Find out, then build | a spike's doc PR, then the build |
| A job too big for one run | a migration in 3 safe steps |

| Poor fit | Do instead |
|---|---|
| A tweak or a bug fix | one task, one PR: a split adds runs and reviews for nothing |
| Parts in one repo that do not build alone | one PR: the halves would merge a broken `main` |
| A question, research, a check | one answer: nothing merges |
| Unclear work | ask first, or make "find out" the first part |
| Repeats, errands, reminders | as today: they have their own clock (ADR 0054) |

The playbook gets this table as its "when to split" rule.

## Options

**The record:**
- **A. GitHub sub-issues and blocked-by** (chosen). + GitHub shows the tree, a progress bar and
  "blocked" badges in the app and on the phone; the list call returns the counts already; a link
  you make by hand on GitHub counts. − Newer APIs (both answer today).
- **B. A checklist in the task's status comment.** + No new API. − A copy to keep right, parsed
  text, and nothing on GitHub's own pages.
- **C. A store of Shipify's own.** − A database, against ADR 0012.

**How a part starts after its blocker merges:**
- **A. In the blocker's close run** (chosen). It runs anyway, with no agent; one read more.
- **B. The due run looks every 10 minutes.** − A slot each time and up to 10 minutes late.
- **C. Only by hand (`go #n` each time).** + Simplest. − You do what the links already say.

**How many start at once after `go`:**
- **A. Every ready part; GitHub's queue holds what has no free slot** (chosen). + No new rule.
  − A chat's new run waits behind them; `stop` and the box's slots are the control.
- **B. At most the free slots; the rest wait for a merge.** − A cap and a count of runners, for a
  queue that GitHub keeps already.

**The words:**
- **A. No new fixed word** (chosen). `go` on a task with sub-tasks starts them (that is "build
  it" for a split task); `go #n` starts one; `stop` stops starting. "Split" is plain words to the
  agent.
- **B. New words `start`, `start #n`, `split`.** − `start` is too close to `start over`, and more
  words to learn.

## Decision

### 1. Split: a list you approve

- The result gains `split`: 2 to 8 entries `{title, brief, after}`. `title` names the project as
  any task's does (`links: …`). `brief` is at most 600 characters; a longer plan goes in a doc the
  brief names. `after` lists the entries (or the task's existing sub-tasks, `#n`) it waits for.
- **The same-repo rule:** two parts on the same repo get `after` in order, unless the run writes
  why they touch different files. Then each part starts from a `main` that has the part before it:
  no conflict to fix, and it builds on what merged.
- The reply lists the parts under "**To open after your `yes`**", with a `list` code, as calls do
  (ADR 0049). The list shows each title and brief in full: your `yes` approves those words as each
  part's description, which its run then follows as your words. An edit voids the `yes`.
- A `split` comes alone: not with `calls`, `pr` or `work` in the same result. The box drops what
  else came, and the reply says so.
- **One level:** a sub-task's result with `split` is not listed. The reply says: "A sub-task
  can't split. Say it as a task of its own."
- A run may suggest a split that you did not ask for. It is only a list: nothing opens without
  your `yes`.

### 2. Open: on your `yes`, nothing starts

- Apply, in two GraphQL calls: one creates the issues (label `sub-task`, body = the brief, a
  first line `Part of #<task>`, and a last line `use <pick>` with the task's model and effort when
  it has one and the brief names none, so each part thinks as its parent does), one adds them as sub-issues and adds the blocked-by links. Both
  go through the journal: a crash between them is told, and the next `yes` makes only what is
  missing (it reads the task's sub-issues first).
- The reply: "Opened #A, #B, #C. Say `go` to start #A (ready); #B waits for #A."
- No run starts: `GITHUB_TOKEN`'s issues start no workflow, as for recipes.
- `due.ts`'s `mine()` accepts a box-opened issue with the `sub-task` label, as it does `recipe`.

### 3. Start: `go`, `go #n`, `stop`

- **`go` on a task with open sub-tasks:** the box puts the label `started` on the task and
  dispatches every **ready** part. Ready means: open, never run (no state label), and every
  blocker closed as completed.
- **`go #n`:** starts that part now, even if it waits for a blocker. Your word wins; the reply
  names what it skipped ("#D started; it waited for #C, which is open").
- **`stop` on the task:** takes `started` off, and stops the task's own run if one works. Parts
  that run finish. Nothing new starts. `go` again picks up from there.
- **`go` on a task with no sub-tasks** is as today: the build after the doc merged.
- **`go` on a part no run has started** starts it now, as `go #n` on the task does, and its run
  says what it skipped. A part's own `go` after it ran (a big part's build after its doc) is that
  part's word, on its own thread, as on any task.
- **Your other words on a part that waits** start nothing: the box answers that it waits, and its
  run reads them when it starts (edge cases below).

### 4. Next: a merge starts what waited for it

In a sub-task's close run (no agent), the box makes one GraphQL read: the parent's state and
labels, and each sibling's state, `stateReason`, labels and blockers. Then:

- **Merged or closed as completed:** if the parent is open and has `started`, the box dispatches
  each sibling that is now ready.
- **Closed as not planned (dropped):** a dropped part is not done. What waits for it does not
  start. One reply on the parent: "#C was dropped. #D waits for it: `go #D` starts it anyway."
- **All parts closed:** one reply on the parent ("All 4 sub-tasks closed: #A PR #12, #B PR #14,
  #C dropped, #D PR #15"), and the box closes the parent as completed.

`run.if` starts a close run for the label `sub-task` too, so a dropped part that never ran (no
`needs you`) still tells its parent. That run has no agent; it takes a slot for about a minute.

### 5. A part's run

- **Parent context:** a sub-task's prompt gains `## Part of #<parent>`: the parent's title, its
  description (its first 2,000 characters), and one line for each sibling ("#A merged in PR #12",
  "#C waits for #A"). One GraphQL read, only for a task with the `sub-task` label.
- A part's start (`why: "sub-task"`: the box's run, or your `go` on it) **does not stay**: like a
  scheduled run, it frees its slot for the next part. Your words on a part later stay as usual.
- A part's start is the box's run on a part with no state label and no run on its status, even
  when the box answered words on it before (that it waits, or a setting): those give it a status,
  never a state label.
- A part's PR is `closes` (its merge closes the part). A parent's own PR, once it has
  sub-tasks, is always `part-of`, so the parent closes only with its parts.

### 6. ADRs 0040, 0046, 0053 and 0060, amended

- 0040 and 0046: a merge may start a run: the next sub-task's, only on a task where you said
  `go`, and only in the close run that the merge starts already.
- 0053 §1: a close of a task with the label `sub-task` starts a run with no agent.
- 0060: a sub-task's run that the box started does not stay.

## Edge cases

| Case | What happens |
|---|---|
| Two parts merge at the same time | Each close run reads and dispatches. A part that both find ready gets two dispatches; the part's concurrency group runs them one after the other, and the second sees that the part has run already (its state label) and ends with no agent |
| Your words on a part that waits (it never ran, and a blocker isn't done) | No run starts for them. The box answers once, with no agent: "#D waits for #C, so it hasn't started. It starts when #C merges, and its run reads your words. Say `go` here to start it now." (Before the task's `go`: "Once #C merges, `go` on the task starts it".) The part keeps no state label, so it still starts as planned, and its run is told to read your words. An edit of its words is the same. `go` there starts it now; `stop`, `close` and settings are as on any task |
| Your words on a part that is ready, or that ran | As on any task: your words start or carry on its run |
| The last two parts close at the same time | Both may see "all closed". The "all closed" reply has a fixed key and the close checks that the parent is open, so at most a second short reply, never a lost one |
| A part fails or asks you a question | It is `needs you` on its own thread. What waits for it waits. You answer there |
| A part is a big change | Its run makes a doc PR (`part-of`). You merge it and say `go` on the part. The part is done when its build PR merges |
| You close a part as completed by hand, with no PR | It counts as done: what waits for it may start |
| You reopen a merged part | Nothing starts or stops (a reopen starts no run). Parts that already started go on |
| You close the parent | No new part starts (the close runs see it closed). Open parts stay open, for you to close or keep |
| You reopen the parent | Nothing starts. Say `go` |
| You add or remove sub-issues or blocked-by links on GitHub | They count: the box reads the links each time and keeps no copy. A sub-issue you add by hand has no `sub-task` label: it gets no parent context and does not tell the parent when dropped, until you add the label |
| A cycle in the blocked-by links | `go` starts nothing in the cycle and says which parts wait for each other |
| A second split on the same task | It adds parts; `after` may name the existing ones (`#n`) |
| The plan is wrong after a part merges | Say it on the parent. Its run proposes a new split for what is missing; close the parts that are not needed (as not planned) |
| A blocker is on another task, not a sibling | It counts the same: GitHub's link is the rule |
| More parts ready than free slots | GitHub's queue holds them. A new chat's run waits behind them; `stop` stops new starts |
| A part names a repo on another account (`acct/repo: …`) | Its run follows that account's rules (ADR 0045). The parent and its links stay on shipify, as every task does |
| The parent has an open `closes` PR when you split | The split is not listed. The reply says: "Merge or close PR #x first", so the parent cannot close before its parts |
| A `yes` after 24 hours, or after the list was edited | Refused, as any list (ADR 0049) |
| GitHub's sub-issue API fails or changes | The open is told and not redone. The parts are plain issues: their work, threads and PRs are not lost |

## The web chat

**The list.** No new read: the list call has the counts already.
- A parent row shows a thin bar and "2/4" (`sub_issues_summary`).
- A part sits folded under its parent, in order, found from its body's first line
  `Part of #<n>` (the list call returns the body). It shows once more as a plain row in its own
  project's group (ADR 0065), so each project shows all its work.
- A new state, **Waiting**: open, not running, not `needs you`, and `blocked_by` above 0. Grey,
  with its own mark. It is not the `waiting` label (that one means an errand).

**The parent's thread.** A **Plan card** under the header: one row per part with its state mark,
title, project, PR and checks, and "waits for #C". Buttons: **Start** on a ready row (sends
`go #n`), **Start all ready** (`go`), **Stop** (`stop`), as quick answers send words today. One
GraphQL read when the thread opens, for a task with sub-tasks only, kept 60 s at the edge.
**Open all as tabs** puts the parts in the project's tabs (ADR 0065).

**A part's thread.** Under the title: "Part of #581", a link, and "Waiting" when it is.

**The split list** is the list reply that the chat shows today, with Yes and No. Nothing new.

**A phone:** the Plan card at full width, rows 44 px. **Notifications:** none new. A part notifies
as any task does (a PR to review, a question); the parent tells only a drop and "all closed".

**Other channels:** GitHub shows the tree itself. Telegram gets the replies and types `go #n`.

**The page's size:** the bar, the fold and the state go in `app.js` (about 1.9 KB of room). The
Plan card goes in `workspace.js` (about 1.4 KB of room). If it does not fit, it goes into a new
part, `plan.js`, that loads only for a task with sub-tasks, with its own budget.

## The calls, within our limits

| When | Calls |
|---|---|
| A split's `yes` | 2 GraphQL calls for the whole list |
| `go` | 1 read, 1 label, 1 dispatch per ready part |
| A part merges | its close run exists already; + 1 read and the dispatches |
| A part is dropped | 1 close run with no agent; 1 read; at most 1 reply |
| A part's run | + 1 read for its parent context |
| The web chat | 0 on the list; 1 read when a parent's thread opens (kept 60 s) |

No new setting, service, store, polling or key.

## Security

- No new permission. The workflow's `GITHUB_TOKEN` writes the issues, the links and the labels
  (`issues: write`), and dispatches (`actions: write`), as today. The build's first test checks
  that `addSubIssue` and `addBlockedBy` take that token.
- The agent never writes an issue. Its `split` is only a list, until your `yes`.
- A part's description is the agent's brief, which your `yes` approved word for word. The list's
  fingerprint makes sure that the words you approved are the words that open. A sibling's title
  and PR, in a part's prompt, are data.
- A part's title names its repo, so it chooses which repo that part's run may change. The list
  shows each title, so you see each repo before your `yes`.

## Not in it

- Parts that open more parts (deep trees), and agents that make tasks for each other by
  themselves.
- Assignees, budgets and a cap on how many run at once.
- A part's run that changes its siblings' plan by itself. A new plan is a talk on the parent.
- A revert that undoes what came after it.

## Build plan

One PR after your `go`, test-first (`skills/test-driven-development`):

1. **Kernel:** `split` in the result's schema; the list and its `yes` (`decide.ts`, `apply.ts`,
   journaled); `go`, `go #n` and `stop` on a parent; the close run's next, drop and all-closed
   steps; `why: "sub-task"` and no stay; `run.if` and `mine()` for `sub-task`.
2. **The prompt:** `## Part of #n` (`prompt.ts`); the playbook's "when to split" rule and the
   same-repo rule (`playbooks/task.md`).
3. **The web chat:** the bar, the fold, Waiting, the Plan card, Open all as tabs; within the
   page's budgets.
4. **Tests:** the fixed words; the list's `yes`, edit and 24 h; each edge case above as a case in
   `decide`'s tests; a call budget for the close run; the web chat's states and budgets.

## Docs this touches

`docs/tasks.md` (sub-tasks: split, `go`, `go #n`, `stop`, the edge cases), `docs/channels.md`
(the web chat's bar, Waiting and Plan card), `docs/glossary.md` (sub-task, parent, ready,
Waiting), `docs/security.md` (a split's `yes` approves its words), `playbooks/task.md`,
`CHANGELOG.md`, ADR 0040's, 0046's, 0053's and 0060's "Amended by" lines, and this ADR's index
line.

## Decisions for you

1. **No new fixed word** (`go`, `go #n`, `stop` on the parent). Or: `start` / `start #n`.
2. **After `go`, every ready part starts at once**, and GitHub queues what has no slot. Or: at
   most the free slots.
3. **The build as one PR** (as you chose for the web chat's redesign). Or: in parts, the kernel
   first.

## Confirmation

The build is done when, on the owner's shipify repo: a split's `yes` opens the parts with their
links and starts nothing; `go` starts only the ready ones; a merge starts the next, with no
agent; a dropped part tells the parent once; the last close closes the parent; and the web chat
shows the bar, Waiting and the Plan card on a PC and a phone.

## As built (2026-10-28)

One PR, the three decisions as recommended: no new word, every ready part at once, one PR.

- **Where:** `cli/kernel/parts.ts` (plain functions: ready, `go`, `stop`, a part's close, the
  prompt's section, the list's lines); `decide.ts` and `apply.ts` (three writes: `split`, `start`,
  `tell`); the record's contract gains `family(n)` and `openParts` (`lib/plugins/record.ts`,
  GitHub's in `lib/github.ts`, held to the record's conformance test). Plan's snapshot reads the
  family once, only for a task with the `sub-task` label or GitHub's `sub_issues_summary.total`
  above 0: every other run reads nothing more.
- **A split's open is 3 GraphQL calls, not 2:** one read of the ids (the repo's, the label's, the
  parent's and its parts already there), one that makes every part as a sub-issue as it's made
  (`createIssue`'s `parentIssueId`), and one that adds every blocked-by link; the label is made the
  first time. One journal line covers them. Asked again after a crash, a part whose title is a
  sub-issue already isn't opened twice, and links are added only for the parts made then.
- **A split with a PR in the same answer:** the PR isn't opened, and its commits are kept on the
  task's branch (as a question's are, ADR 0041), so nothing is lost.
- **A started parent** is Answered with no quiet-day close, not a new phase: an answered task with
  open parts never closes for quiet. `stop` puts it to Needs you, as it waits for your `go`.
- **`run.if` is the owner's to change:** a run can't change `.github/workflows/` (the box refuses
  it), so task.yml's start of a close run for the `sub-task` label (§4) is one line the owner adds
  to the run job's `closed` condition: `|| contains(github.event.issue.labels.*.name, 'sub-task')`.
  Without it, a part that closes with no state label (one that never ran, or one a chat's `close`
  closed, as the door takes its labels off) starts no run: what waited for it starts with your
  next `go` on the parent, and the parent isn't told. A part merged from its PR (`needs you`)
  works either way.
- **The web chat:** the Plan card went into a part of its own, `plan.js` (3 KB budget), loaded
  only for a split task, as it took `workspace.js` to 8.9 of its 9 KB. Its rows show each part's
  PR but not its checks (that needs a bigger read). The page went from 40.1 to 40.7 of its 42 KB.
