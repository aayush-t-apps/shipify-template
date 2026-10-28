---
status: accepted (merged #370) and built, simpler than written; see [As built](#as-built-2026-10-13); §1 amended by 0066 (a sub-task's close starts a run with no agent, to start the next part or tell its parent)
date: 2026-10-13
amends: 0040 (§2: a close from GitHub is a change of state too, unless something waits on the task; §1: a waiting run whose words were already answered is cancelled, not run), 0019 and 0031 (the due run also tells you what's coming due, and a weekly digest)
---

# 0053: Told on time, quiet otherwise

## The plan in short

**What:** the box runs only when there's something to do, and you hear from Shipify on a schedule
you set, never only when something breaks:

1. **A close starts a run only when something waits on the task:** a PR to merge, a question, a
   list for your `yes`, or a run under way. Any other close, and every reopen, is a change of state,
   as a close from your chat already is. The "Merged" and "Live" messages after your merge stay.
2. **A run that would find nothing new never takes a slot:** the run that answered your words
   cancels the run those same words queued.
3. **What's coming due is told once, when it changes:** an app behind its stack, a pinned library
   or agent version behind, a key due within 30 days, a PR waiting on you for more than two days.
   Nothing upgrades, opens a PR or merges by itself: the message names the words to send.
4. **A weekly digest,** every Monday at 9:00 your time by default, to your default chats, even when
   all is clear, so silence never looks like breakage.

**Why now:** the owner, on 2026-10-13: "why do we run pi task or something on closing the issue …
i want robustness and core strong"; "reminders and everything clean to core, not automatic merges,
clean simple timely ones as i set up"; and "shipify status … has not reported anything to me in 2
days on my web chat". Part A of task #335's plan (tracking upgrades and keys) is the rest.

## The owner's asks (2026-10-13, and task #335)

- "something weird why do we run pi task or something on closing the issue … i want robustness and
  core strong and intact"
- "as i asked reminders and everything clean to core not automatic merges cleaan simple timely ones
  as i setup work and properly answers as needed or need to be handled"
- "for some reason shipify status or something has not reported anything to me in 2 days on my web
  chat anything issue confirm"
- Task #335's plan, part A: Shipify tells you when an app, a stack's library or an agent CLI falls
  behind, and when a key needs renewing; you upgrade or renew when you choose.

## What was found (checked 2026-10-13, `main` at `ce45f8f`)

| Fact | How it was checked |
|---|---|
| Of the last 200 task runs (Oct 9–11), 164 took the box; 35 of them (21%) had nothing to do: 19 closes from GitHub's Close button (about 70 s each, in bursts that filled all 3 slots) and 16 "nothing new" (about 35 s each) | `gh run list --workflow task.yml --limit 200`, each run's `run.plan.decided` line |
| A close from GitHub runs `closedPlan` on the box: the state labels off, the phase done, a repeat paused, and only for a merge a "Merged" or "Live" reply, or for "not planned" the github job closing the task's PRs | `cli/kernel/decide.ts` (`closedPlan`); run 38157047244's log |
| `task.yml` can't tell a merge's close from the button's: both come as `issues.closed` from the owner, `state_reason: completed`; only the issue's timeline names the PR | GitHub's `issues` webhook payload; `cli/commands/task/deploys.ts` (`closingPr`) |
| Nothing reads a closed task's labels or phase: the due run and the watch list open tasks only, the web chat shows "closed" before any label, "Coming up" is rebuilt every due run | `cli/lib/github.ts` (`issues`, open only); `edge/src/web/reads.ts`; `cli/commands/task/due.ts` |
| A reopen from GitHub runs too, and plan finds "nothing new" (about 33 s) | `decide.ts` (`plan`, a reopen with no words) |
| A task with an open PR carries `needs you` (since the sweep after this ADR's facts: a follow-up answer on it no longer makes it `answered`) | `decide.ts` (`afterThink`'s `waiting`) |
| "Nothing new" runs come from words written while a run works: that run reads them before it answers (ADR 0037), and the run they queued then finds them answered | the 16 runs' tasks (#315, #317, #321, #328, #335) |
| The run's token has `actions: write`, so a run can cancel a queued run of its own task | `task.yml` (`permissions`) |
| The watch ran every 5 minutes for the two quiet days (12 an hour, 0 errors) and the due run daily ("nothing due"), and nothing was sent: Shipify speaks only when something is wrong or due | Cloudflare's analytics for the Worker; watch run 38218578108's log |
| The apps are one stack version behind (links on ts-worker 1.0.2, playground and spotter on ts-static 1.0.2; both stacks are at 1.0.3), and nothing said so | each app's `shipify.json`; `stacks/*/stack.json` |
| The due run already reads every repo's `shipify.json` in one query, and drops its `stack` | `cli/lib/projects-on-github.ts` (`listed`) |
| Key dates are shown on Setup and the status page, and the watch reminds 30 and 7 days before; the Cloudflare deploy token's date isn't recorded | `edge/src/web/setup.ts`, `edge/src/page.ts`, the watch's key-date guard; `docs/setup.md` |
| npm's registry answers a package's newest version with no key (`registry.npmjs.org/<name>/latest`) | a request from this PC |
| The repeat grammar ("every monday at 9:00", the copy's time zone) and `watch.next` already schedule a due run at a time | `cli/lib/repeat.ts`; the watch's due duty |

## Options

**Closes:**
- **A. As now:** a run for every close (+ nothing to build / − a slot for bookkeeping, bursts block real work)
- **B. Gate by label:** a close starts a run only when the task carried `needs you` or `working`;
  a reopen never does (+ one line in `task.yml`, the merge's message kept / − a PR Shipify doesn't
  know of closes its task quietly)
- **C. The close's bookkeeping on GitHub's machines** (+ no box / − a billed minute per close, still a run)

**"Nothing new" runs:**
- **A. As now** (+ nothing / − 10% of box runs)
- **B. The answering run cancels the run its words queued** (+ no slot taken / − a few lines in apply,
  one or two calls only when it took in words written while it worked)

**Telling what's due:**
- **A. A check you set up (a `checks/` file and a repeat)** (+ outside the core / − every copy sets it
  up by hand; the owner asked for it in the core)
- **B. The due run says it, once per change, and a weekly digest** (+ in the core, on your schedule,
  no new part / − a few npm reads a day from the box)

## Decision

Chosen **B**, **B** and **B**.

### 1. A close is a run only when something waits

- **`task.yml`'s `run.if`:** an `issues.closed` event starts a run only when the issue carried
  `needs you` or `working`; an `issues.reopened` event never starts one, from anyone.
- **What `needs you` covers:** a PR to merge (a run's or one opened from your PC with `ship pr
  --task`, which the build makes sure labels it), a question, a list for your `yes`. A close of
  such a task still says "Merged" or "Live", or, as not planned, closes its PRs.
- **What `working` covers:** a run under way: the close's run waits behind it and catches up.
- **Every other close** is a change of state: the next run that reads the task catches it up
  (`closeWord`, as for the door's close), and until then nothing reads it.

### 2. A waiting run that would find nothing new is cancelled

- **When:** apply, at the end of a run that took in words written while it worked (the catch-up,
  ADR 0037), and only then.
- **How, with no race:** it finds the task's queued run (one call), then reads the comments since its
  own read (one call): when there's none of yours or the door's, it cancels that run by its id. A word
  written in between queues a newer run, which replaces the one cancelled, so nothing you said is
  ever dropped.
- **Never cancelled:** a run started by a dispatch (a repeat, a deploy, an operation) or by a close;
  only one your words started.

### 3. What's coming due, told once per change

The due run, once a day, reads what it already reads plus npm's registry, and says what changed
since it last said it (the status task's `alerted` keys), in an alert reply your default chats get:

- **An app behind its stack:** its `shipify.json`'s stack version against this commit's
  `stacks/<id>/stack.json`, from the read it already makes. "links: ts-worker 1.0.2 → 1.0.3. Send
  `links: upgrade` when you want it."
- **A pin behind:** each library pinned in a stack and each agent's pinned install
  (`executors.json`), against npm's newest (one request each, at once, 20 s at most); a major is
  marked "read its notes first". Pre-releases are left out.
- **A key due within 30 days:** as the watch does today, plus the Cloudflare deploy token's expiry,
  which `ship doctor --yes` now records from Cloudflare's own token check on your PC (no date when
  the token has none).
- **A PR waiting on you more than two days:** each task labelled `needs you` with an open PR, by
  age.
- **Nothing acts:** no PR, no upgrade, no merge, no run is started by any of it.

### 4. A weekly digest, at your time

- **When:** `SHIPIFY_DIGEST`, a repo variable in the repeat grammar, `every monday at 9:00` by
  default (your copy's time zone), or `off`. The due run puts its next time into `watch.next`, so
  the watch rings the due run then.
- **What:** one short message to your default chats: each box (online, its slots), each app (live,
  failing, behind), what waits on you (tasks, PRs, lists), what's coming up (repeats), what's due
  (pins, keys), and the week's runs. When all is well it says so in one line.
- **Where it's set:** `ship setup` shows it with the other settings; a chat changes nothing.

## Narrowed out

- **Auto-PRs for upgrades, or Dependabot:** the owner wants nothing that acts by itself, and
  Dependabot opens one PR per app for one stack bump, which the version check refuses.
- **Reading GitHub's secret list for expiries:** the bot can't (403), and a box never holds keys.
- **A daily "all is well":** a weekly digest answers "is it alive" without noise; anything wrong is
  told at once, as now.

## Edge cases

- **A close while a run works** (`working`): its run waits for the one under way, then catches up.
- **A task closed with an open PR that GitHub's merge closed** (`needs you`): runs, as today.
- **A PR you wrote yourself closes a task Shipify didn't know of:** no run; the task closes quietly.
- **The cancel finds no queued run, or GitHub refuses it:** nothing happens; the run, if any, finds
  nothing new as today. Said in the run's log only.
- **npm's registry is down or slow:** that day's pins line is left out and said once ("couldn't read
  npm's registry"); the rest of the message goes.
- **A box offline at digest time:** the digest comes with the next due run once a box is back; the
  watch has told you the box is offline meanwhile.
- **`SHIPIFY_DIGEST` doesn't read:** said once on the status task, and the default is used.

## Setup

Nothing to set up. The digest comes every Monday at 9:00 your time; set `SHIPIFY_DIGEST` to change
the time or turn it off (`ship setup` shows it). `ship doctor --yes` on your PC records the
Cloudflare token's date once.

## How it's built

After this ADR is merged and you say `go`, one PR:
1. `task.yml`'s `run.if` (closes and reopens), and `ship pr --task` labelling its task `needs you`.
2. Apply's cancel of a waiting run.
3. The due run's coming-due lines and the digest; `SHIPIFY_DIGEST` in the settings list;
   `ship doctor --yes` recording the Cloudflare token's expiry.
4. Tests only where one fails before and passes after: the `run.if` cases in
   `tests/workflows.test.ts`; the cancel's race order and its "never a dispatch" rule in the flow
   test; the coming-due lines and the digest against recorded answers.
5. Docs (below), then a live check: a close with nothing waiting starts no run; a close of a task
   with a PR says "Merged"; a burst of words during a run leaves no "nothing new" run; the digest
   arrives at its time.

## Docs and clean-up

- `docs/tasks.md` (close, reopen, one run and one waiting), `docs/watch.md` (the due run's lines,
  the digest), `docs/channels.md` (what your default chats get), `docs/settings.md` (generated:
  `SHIPIFY_DIGEST`), `docs/design.md` (runs only when there's work), `docs/glossary.md` (**digest**,
  **coming due**), `docs/setup.md` (the Cloudflare token's date), ADR 0040's As built (amended here).
- Removed: whatever no run reaches any more (a reopen's own plan).

## Consequences

- About one box run in five goes away; bursts of closes no longer block real work.
- You hear from Shipify every week, and at once when something needs you or falls due; you never
  have to wonder whether it's alive.
- Upgrades stay yours: Shipify says what's behind and the words to send.
- The due run reads npm's registry once a day: a few public requests.

## Confirmation

- `tests/workflows.test.ts`: a close starts a run only with `needs you` or `working`; a reopen never.
- The flow test: a run that took in words cancels the queued run those words started, never a
  dispatch's, and a word written during the check queues a run that isn't cancelled.
- The due run's tests: an app behind its stack, a pin behind, a key due and a waiting PR each said
  once; the digest on its day, and "all clear" when nothing is due.
- Live: the runs above, and the next Monday's digest in your chat.

## As built (2026-10-13)

The owner, at the build: "keep it simple, daily or such reminders don't spam, keep it clean; if not
needed we can skip". So two of the four parts were built, and what's coming due is in the digest
rather than told as it changes:

- **§1, closes, as written:** `task.yml` starts a run for a close only when the task still says
  `needs you` or `working`, and never for a reopen. The door's close needs no rule of its own: it
  takes those labels off as it closes. A PR opened from the PC with `ship pr --task` closes a task
  quietly unless it says `needs you` (the PC's token can't label a task).
- **§3 and §4 as one weekly digest:** the due run keeps the digest's next time in the record
  (`watch.digest`), and the watch's next ring is never later than it. At its time it says boxes,
  apps (live, failing, behind their stack, with the words to send), what waits on you (tasks that
  say `needs you`), keys due within 30 days, and what's coming up; "all clear" when nothing needs
  you. The first one comes with the first due run after the build, so you see it works. Nothing in
  it acts, and nothing else is sent: the watch's alerts are as before.
- **Left out for now:** cancelling a waiting run that would find nothing new (§2), npm pins in the
  digest (the core names no project tool: a stack would have to say where its pins are checked),
  and the Cloudflare token's date in `ship doctor --yes`.

