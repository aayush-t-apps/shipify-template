---
status: accepted and built (one PR, task #400)
date: 2026-10-15
amends: 0046 (§1: a PR's checks are read in the background when you ask, once, with an errand; §2: a merge an errand waits for fires it in the close's own run), 0013 (a repeat may wait for something instead of a time)
---

# 0054: Errands: wait for a PR, then tell you or act, once

## The plan in short

**What:** you can ask Shipify to wait for something on GitHub, then do one thing:
- "tell me when links#12's checks finish"
- "when #405 merges, check the login page"
- "tell me when shipify's main checks finish"

**How it works:**
- It's a time once (built in task #400) that waits for a PR or a branch instead of a clock.
- The due run looks with one GitHub read and no agent. When the thing has happened, it starts
  the task's run once.
- That run tells you what happened with no agent (a reminder), or runs the agent once with the
  whole thread (a job).
- The task is labelled `waiting` until then. The errand ends when it fires, or after a day.

**Why:** the owner, on task #400 (2026-10-14).

## The owner's asks (task #400)

- "if I ask to remind something in 5 10 15 mins or 5 hrs … let's say PR ci has some checks running
  some merge pipeline is running or do something and such I ask just wake up or simply check back
  and report to me … only one time asks"
- "I merged the PR the task automatically closes so I can ask after raising a PR create a task to
  monitor that PR and merge for deploy this is very simple fluid actions as needed … how can we get
  errand or child tasks controls they can be labeled cleanly as asked and do what's needed"
- On the plan for this ADR: "Yes, write the errands ADR".

## What was found (checked 2026-10-15, `work` of task #400 on `main` at `659d9a2`)

| Fact | How it was checked |
|---|---|
| A time once is built: `every: "once"` on the task's `repeat`, a reminder or a job, one per task, fired by the due run, ending as it fires, never skipped for an open PR | PR #401 (`cli/lib/repeat.ts`, `decide.ts`'s `runRepeat`, `due.ts`) |
| The due run lists every task labelled `repeats`, `answered` or `needs you` (open), and `deploying` (open or closed). It puts each repeat into "Coming up" at its next time, and the soonest is the watch's next ring (`watch.next`). The watch needs no change to ring at a new time | `cli/commands/task/due.ts`; `docs/watch.md` |
| A due run takes about a minute of a box slot | the last 8 `watch.yml` runs (`gh run list --workflow watch.yml`) |
| One GraphQL read gives a PR's state, its merge time, its head's checks and its merge commit's checks (check runs and statuses, each with its conclusion) | a query on #398 from a box, with the bot's read token: head `statusCheckRollup: null`; merge commit `verify`, `edge` passed and `golden`, `release` skipped, 4.5 minutes after the merge |
| The bot's read token may read checks, statuses and actions on every repo of the owner's account; another account's repo has its own token (ADR 0045), which the due run doesn't hold | `cli/commands/bot.ts` (`checks: "read"`); `docs/setup.md`; ADR 0045 |
| **Shipify's own PRs and its projects' run no checks before the merge.** A project's `ship.yml` runs on a PR only for a preview; everything runs on `main` after the merge (ADR 0018) | `gh pr checks 401` ("no checks reported"); `stacks/_base/files/.github/workflows/ship.yml` |
| A merge already tells you how it went: the close's run says Merged, or follows an app's deploy to Live or failed (ADR 0046). Shipify's own CI on `main` after a merge isn't followed | `decide.ts` (`closedPlan`, `ctx.merged`, `ctx.mergedPr`); `deploys.ts` |
| A close starts a run only when the task says `needs you` or `working`, and a task with an open PR says `needs you`: the merge of a task's own PR always starts its close run | ADR 0053 §1; `task.yml`'s `run.if` |
| Closing a task drops its time once | PR #401 (`closeRepeat`) |
| A job's run is a talk run. A talk run that sets `work` starts a work run, and its reply says so | `decide.ts` (`runRepeat`, `decideAfter`); PR #401 |

**So:** waiting for checks pays off on repos that keep their own rules and their own CI (ADR 0044),
on a preview, and on a branch's CI after a merge (Shipify's own `main`). Waiting for a merge pays
off for "then do X", and for a PR that isn't the task's own.

## Options

**How the waiting is done:**
- **A. A job that repeats** ("every 15 minutes, until …"): the agent looks each time. (+ nothing new
  / − a slot and tokens for every look; a job runs at most hourly; it never ends by itself)
- **B. A check** (`checks/<name>.mjs`) watching a PR. (+ outside the core / − a check runs with no
  key, so it can't read a private repo; it says "changed", never "ended"; it repeats until stopped)
- **C. The due run looks:** one GitHub read per errand, no agent. The watch rings it at the errand's
  next look, as for any repeat, and the task's own run fires once. (+ no new part, no agent until it
  fires, reuses the time once / − about a minute of a box slot every 10 to 30 minutes while one
  waits)
- **D. GitHub's events through the door:** `check_suite` or `pull_request` webhooks. (+ at once, no
  looking / − the door App sees shipify alone and the repos App has no webhook (ADR 0045); widening
  either adds a permission on every repo)
- **E. The watch looks itself.** (+ no box run / − the door App reads only shipify's PRs, so projects
  would need a second path)

**Where an errand lives:**
- **A. On the task where you ask it,** which has the thread. From a chat with no task, your fresh
  message is a task already (ADR 0042). (+ one place to look, nothing copied / − none)
- **B. A child task per errand,** opened by Shipify. (+ a list of its own / − a copy of the thread,
  two places to read, an issue per ask; a label lists errands as well)

**Merging when it's green:**
- **A. Yours, as ever** (ADR 0003, ADR 0012, ADR 0049). An errand can tell you, or look. Where a repo
  allows it, GitHub's own **Enable auto-merge** on the PR is your button. (+ approvals stay merges /
  − one tap)
- **B. An errand that merges** "when checks pass". (+ no tap / − Shipify would merge, and a merge
  approves production; ADR 0049 kept merges on GitHub, from you alone)

## Decision

Chosen **C**, **A** and **A**.

### 1. What you ask, in plain words

An errand is a time once whose `when` names a thing instead of a time. One reader takes the words,
`readWhen` in `cli/lib/repeat.ts`, and every way in uses it: your words to a run, the Repeat form,
`/repeat` and the web chat's New repeat.

| You say | It waits for |
|---|---|
| "when links#12's checks finish", "when the PR's checks end" | **checks:** every check on the PR's newest commit has ended. It reads the newest commit each time it looks, so a push starts the wait again |
| "when shipify's main checks finish" | **checks** on a branch's newest commit (a pipeline after a merge) |
| "when #405 merges", "when the PR is merged or closed" | **merged:** merged, or closed without merging |
| "when #405 is live", "when it's deployed" | **deployed:** merged, then every check on its merge commit has ended. For an app, that's its deploy: Live or failed. Elsewhere it's its CI on `main` |

- **Which PR:** a PR's URL, `<repo>#<n>`, or `#<n>` on the task's own repo (its project, else
  shipify). "The PR" is the task's newest PR.
- **How long:** a day by default, or as you say, at most 7 days: "… for 3 days", "… within 2 hours".
- **On your own account only.** Another account's repo is refused, with the reason. The due run
  holds no key there.

### 2. What it does

- **A reminder:** your text, plus what happened, with no agent. For example "links#12: 6 checks
  passed", or "#405: 5 passed, 1 failed (e2e)", with each failed check's link.
- **A job:** the agent runs once with the whole thread and what happened. It always says what it
  found (as a job once does), and sets nothing new unless asked.
  - "Fix it" works only when your errand said so. Then the run sets `work`, and its reply says a
    work run starts, as any run's does. Merging stays yours (Merging, A).
- **If the time runs out first:** "Stopped waiting after a day: #405 is still open, 2 checks
  running", with no agent, even for a job. You asked for its job only once the thing happened.
- **It ends as it fires,** like a time once: off the task and its label, so nothing rings it again.

### 3. How it waits

- **The task:** `repeat` with `every: "once"` and `on: { what, pr | branch, until }`. `next` is when
  the due run next looks. The task is labelled `waiting` (not `repeats`), so
  `gh issue list --label waiting` lists every errand. Its status line says it:
  "**Waiting** for links#12's checks to finish, then a reminder · until Fri 16 Oct, 09:00 IST".
- **The due run** lists `waiting` tasks, open or closed, as it does `deploying`. For each errand
  whose look is due, it makes one GitHub read (the query above, the bot's read token). Then:
  - **The thing happened, or its time ran out:** it starts the task's run (`its errand`).
  - **Not yet:** it lists the errand in "Coming up" at its next look. That is 10 minutes on during
    the errand's first hour, then 30, never past its `until`. So a day's errand costs at most
    about 52 due runs, and one due run looks at every errand at once.
- **The task's run** reads the PR once more (its snapshot), so it tells what's true now, then
  fires (§2). If it finds nothing happened yet (a check started again), it lists the errand
  again. Nothing is told.
- **The task's own PR costs no looks:** for **merged** or **deployed** on the task's own PR, your
  merge starts the close's run anyway (ADR 0053 §1). That run fires the errand: after Merged for
  **merged**, after Live or failed for an app's **deployed**. The due run lists such an errand only
  at its `until`, except a **deployed** on a repo with no app (Shipify itself). That one is looked
  at as any other, from the merge on.

### 4. Its limits, as a time once

- **One per task.** Asking again replaces it, and a task that repeats refuses it.
- **`stop repeating` cancels it.** A close by hand or by your `close` drops it. Your merge of the
  PR it waits for is its event, not a drop.
- **It's never skipped while the task's PR is open:** that PR is often what it's for.

### 5. ADR 0046, amended

Its rule stands: nothing follows a PR **unless you ask**. An errand is you asking, once, for one PR
or branch, for at most 7 days. Then it ends. What it adds to ADR 0046:
- **§1:** while you've asked, the due run reads that PR's checks, the task is labelled `waiting`,
  and its run starts once when they end.
- **§2:** the merge's close run also fires an errand waiting for that merge. The task stays closed:
  its reply comes on the closed task, and nothing reopens it.

The `deploying` follow stays as it is: it's what Shipify follows by itself, the end of something
you did. An errand is what you asked to wait for. Both use the same readers (`deploys.ts`).

## Narrowed out

- **A merge by Shipify,** even when asked (Merging, B). The errand tells you, and GitHub's own
  auto-merge is your button where the repo has it.
- **Child tasks** (Where, B). A label lists errands, and the thread stays where it is.
- **Waiting on something that isn't on GitHub** (a page, an app's health). A check does that
  (`checks/`), or a job once at a time.
- **Several steps** ("when checks pass, then when it merges, then …"). Each errand fires once, and
  its job may set the next when your words ask.

## Edge cases

- **No checks ran on the PR** (Shipify's and projects' PRs check after the merge): the first look
  fires it, "#401 ran no checks: its checks run after the merge". The reply names
  "when it's deployed" for that.
- **The PR closes unmerged** while it waits for checks, a merge or a deploy: fired, "#405 was closed
  without merging", with no agent.
- **The PR can't be read** (deleted, its repo gone or private to the bot): three looks in a row,
  then it ends and says so.
- **A push while it waits for checks:** the newest commit counts, so it waits for that one's checks.
- **The task is busy** when the thing happens: the due run starts no run, and looks again next time
  (the thing is still done).
- **The PR is already done when you ask:** the first look fires it, about 10 minutes later.
- **A box offline, or a due run failed:** the watch tells you as now. The errand fires once a due
  run goes, and its reply says when the thing happened (each check's `completedAt`, the merge's
  time).
- **You write on the task meanwhile:** it runs as ever, and the errand stays.
- **A merge of the task's own PR while the task is busy:** the close's run waits behind the one under
  way (ADR 0053 §1), then fires the errand.
- **Words that read as neither a time nor a thing:** said at once, with the forms that work.

## Setup

Nothing to set up: the bot's read token reads checks already, and the watch rings the due run as for
any repeat.

## How it's built

After this ADR is merged and you say `go`, one PR:
1. **`cli/lib/repeat.ts`:** the errand's words in `readWhen` and `whenProblem`, `on` in
   `RepeatState`, its status line, and the `waiting` label.
2. **One reader,** in `cli/commands/task/deploys.ts`: an errand's state from the query above. The due
   run and the task's snapshot both use it.
3. **`due.ts`:** list `waiting` tasks, look, start, or list at the next look.
4. **`decide.ts`:** set, fire, end and time out; the close's run fires an errand waiting for its
   merge.
5. **Tests** where one fails before and passes after: the words (`task.test.ts`); the due run's look,
   start and next look; each edge case above in `kernel-decide`; in `kernel-flow`, the task's own
   PR merge firing the errand in the close's run, with no due run.
6. **Docs** (below). Then a live check: an errand on Shipify's `main` checks after a merge, and one
   on a project PR's merge.

## Docs and clean-up

- `docs/tasks.md`: "Errands" beside "Check back once", and "After your merge".
- `docs/watch.md`: the due run's row (it reads an errand's PR when you've asked).
- `docs/glossary.md`: **errand**, **waiting**.
- `README.md`: the "Task, repeat, recipe or check?" table, an errand row.
- `playbooks/task.md`: "A task that repeats" names the errand's words for `repeat.when`.
- `.github/ISSUE_TEMPLATE/4-repeat.yml`: the When field's help names an errand.
- The web chat's Repeats list shows errands under "Waiting".
- `cli/kernel/prompt.ts`: what a run is told when an errand fires.
- ADR 0046 marked amended in the index, and 0013. `CHANGELOG.md`.
- Removed: nothing. No old path does this.

## Consequences

- You can hand Shipify a wait ("tell me when it's done") and move on. It ends by itself, always
  says what happened, and acts only as you said.
- Errands are listed by one label, and each says on its status line what it waits for and until
  when.
- While one waits, a due run takes about a minute of a box slot every 10 to 30 minutes. One that
  waits on its own task's merge takes none.
- ADR 0046's "nothing in the background" now reads "nothing in the background unless you asked, and
  only until it's done".

## Confirmation

- `tests/task.test.ts`: each form of the words, and every refusal (another account, past 7 days, on
  a repeating task).
- The due run's tests: an errand looked at, started once when done, listed at its next look
  otherwise; started at its `until` with nothing done.
- `kernel-decide` and `kernel-flow`: the reminder's words and the job's note; a close by hand drops
  it; the task's own merge fires it in the close's run, and the task stays closed.
- Live: the two errands above, each told once in your chat.
