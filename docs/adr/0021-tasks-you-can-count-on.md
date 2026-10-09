---
status: accepted (merging its PR accepts it, the owner's choice of one PR for the plan and the build); its `use` lines replaced by 0025
date: 2026-10-02
---

# 0021: Tasks you can count on: every event once, answers that stay a day, Shipify as a project, any model, files in and out

## Context
Using tasks for a day showed gaps:
- **Questions closed when answered.** A follow-up meant reopening with a comment. GitHub sends that
  as two events, so it made two runs (#47 had four such pairs).
- **Too many forms**, each with Model and Effort lists fixed in the forms and in code. The model
  list only changed with a code change, and no other agent could be told a model at all.
- **Shipify itself couldn't be a task.** `shipify: add D1` (#48) had no checkout and no PR: `ship
  pr` refused a repo with no `shipify.json`, and the agent committed to the copy running the task.
- **Replies were capped and repeated.** The playbook asked for 1–3 sentences, so tables and longer
  answers were cut. Every round said the same thing in the status comment and the reply, and a
  "Working on it" note was posted and deleted (a second notification).
- **Attached files were dropped silently.**

A review of the runner found more:
- a job with nothing new ran the agent again;
- a setup failure went unreported;
- a reply over GitHub's size limit turned a finished round into "broke";
- comments were marked read before the agent read them;
- "Bug: …" became a project called `bug`;
- an approved act run could be replaced by a comment's job and silently lost.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| "Close with comment" closes first and comments up to ~30 s later; order isn't guaranteed | GitHub's docs ("deliveries can be out of order"); Zed's PR #49896, which skips comments within 30 s of a close |
| `concurrency.queue: max` keeps up to 100 pending runs in order, instead of one that replaces the last | GitHub's workflow-syntax docs; actionlint 1.7.12 doesn't know it yet, so `.github/actionlint.yaml` ignores that one message for task.yml |
| No token can download an issue's attached files in a private repo; pasted images get signed links | GitHub Support (Aug 2025), cli discussion #11832 (Aug 2026); the box's image download works today |
| No API uploads an attachment to a comment (gh 2.99's `--attach` takes images, with a user's token only) | GitHub's changelog of 2026-09-01; gh refuses `ghs_` tokens |
| The GitHub app can't fill in issue forms | community discussion #4793 (still open, March 2026) |
| Events made with the workflow's own token start no workflow, but a dispatch does | GitHub's GITHUB_TOKEN docs |
| A comment is at most 65,536 characters | the API's own error; replies are cut at 65,000 |
| Claude Code takes an alias or a full model name with `--model`, and low to max with `--effort` | its `--help` (2.1.284, run on 2026-10-02); a wrong one fails the run, and the details say so |

## Options
- **A:** patch each gap where it shows. (+ small / − the same gaps come back by another path)
- **B:** one rule per gap, in the core:
  - a round works from what's on GitHub and does nothing without something new;
  - done means answered, and the watch closes it after a quiet day;
  - Shipify is a project like any other;
  - models are data;
  - replies are markdown with files.
  (+ each rule covers every path / − one larger change)

## Decision
Chosen **B**.

1. **Every event once.** `task.yml` keeps every pending run in order (`queue: max`) and passes the
   event as a reason (`reopened`, and `dispatch` for "Run workflow").
   - A round with no unread comment from the owner, and no reason given by name, does nothing.
   - A round marks comments read only once its reply is posted. A failed round leaves them unread,
     so "continue" brings them all back.
   - An approved act run goes first, whichever job comes for it. After it, an unread comment
     dispatches a run.
   - A close that no job handled (another event's job took its place) is handled by the next one.
2. **Answered.** A round that's done, with nothing waiting for the owner, is `answered` (label
   `answered`) and stays open.
   - Its close time (a day after the reply) goes on the status issue's "Coming up", so the watch
     presses `due` then, and the due run closes it if nothing new came. That's a line in the watch's
     check, not a new part (ADR 0019).
   - A comment more than a minute after any close opens the task again and carries on.
   - Operations and pings still close at once.
3. **Fewer forms, a blank issue for the rest.**
   - The forms: Change (an app, `shipify`, or `playground` for an experiment), New project, Ask a
     question, Repeat, Release or take down, and Check a box.
   - Experiment, Get something done and Something else are folded in. The blank issue stays for
     the app and for anything else.
   - No form asks for a model.
   - A title's first word that names no project is read as plain words.
4. **Shipify as a project** (`shipify: …`, or the Change form). The checkout is a worktree of the
   platform repo; the copy running the task never changes.
   - `ship pr` on it runs `pnpm verify`, the golden tests when what decides a new project's files
     changed, and checks for a changelog entry and each changed stack's new version. It opens the PR
     in Shipify's repo.
   - `ship refresh` merges main with changelog conflicts resolved.
   - A big change is an ADR PR "part of" the task, then "go".
   - No task pushes workflow files, Shipify's least of all. A workflow pushed on a branch can run on
     that push with the repo's keys (the bot's private key among them) before anyone reviews it.
     The token can't, and `ship pr` refuses; the PR carries the change as a diff for the owner.
5. **Any agent, any model, as data.**
   - `executors.json` gives each agent its `models`, a `modelPattern` for ids not listed yet, its
     `efforts`, `noEffort`, and for an agent without an adapter the `flags` that pass them.
   - A `use` line (`use opus`, `use codex gpt-5.1-codex high`, `use auto`) on a line of its own in
     the task or a comment picks them, read by the box. Every word must be known, so "use the new
     colours" stays words.
   - The adapter keeps only what's code: its flags, its output reader, and its tools.
6. **One reply per round, in markdown, with files.**
   - The reply holds everything: the answer (any length, a first paragraph that stands alone),
     screenshots, files and the run's details.
   - The status comment is the task at a glance: the state, the reply's first paragraph with a link,
     the PRs, and the runs under one line for the last.
   - The "Working on it" note is gone (👀 and the status say it).
   - Before posting: anything like a key is hidden, an open fold, code block or HTML comment is
     closed, and the body is cut to fit.
   - Files the run made, from its own folder only, go on the shipify repo's side branch
     `shipify-files`, as private as the repo. Pictures show; other files are linked. A reply too long
     for a comment becomes `reply.md` there.
   - Files in: pasted images as before. Files linked from the org's own repos are downloaded with the
     bot's key. The reply names attached files it couldn't open and what to do instead.
7. **The rest of the review.**
   - A job that breaks before its run reports says so when something waited on it.
   - The `lost` job runs only when the box went silent, not on every "blocked".
   - The clean-up re-reads before marking a task stuck.
   - The due run skips tasks with a run on its way, and saves a reminder's next time before posting.
   - Fix rounds start only with an hour of the job left.
   - A status comment this version can't fully read keeps what it can.
   - A list of changes over 30,000 characters isn't kept for a yes.
   - A comment on an operation gets one reply; `again` runs it again.
   - A form with the preview box ticked runs its first round (it used to stop at "no PR to preview").

## Edge cases
- **Two jobs for one event:** the second finds nothing new and does nothing (about half a minute on
  a box, at no cost).
- **The owner comments while a run works:** the comment waits its turn. The run marks read only what
  it read, so the next job answers it. (Changed by [0037](0037-words-while-a-run-works.md): the
  run takes plain words in before it answers, and `stop` stops it.)
- **An answered task gets a comment on its last day:** it runs, and its close moves to a day after
  the new reply. If the comment's run hasn't started when the due run comes (no free box), the due
  run sees the unread comment and leaves the task open.
- **"Close with comment" on an answered task:** the close is the owner's. The comment came within a
  minute, so it doesn't reopen.
- **The watch is down:** answered tasks stay open until it's back. That does no harm, and the reply
  already warns when the watch has stopped.
- **A `use` line names an agent that isn't installed:** the run fails saying so. `use auto` goes
  back.
- **A Shipify task touches the files that run tasks:** boxes run `main`, so the change only works
  after the merge, which is the review. A workflow change comes as a diff in the PR, applied by the
  owner.
- **A file the agent names from outside its folder** (a key, `/etc`): refused, and the reply says
  "Not shared".
- **Old issues with Model and Effort headings** still read as their form. The settings are ignored;
  a `use` line replaces them.

## Consequences
- **Easier:**
  - asking from the phone: a blank issue, and a follow-up is just a comment;
  - changing Shipify from an issue;
  - trying a model the day it's out;
  - reading answers with tables and files.
- **Harder:** nothing is picked from a form any more, so a non-default model is a line of text.
  "Run workflow" is the way to force a round when nothing is new.
- `docs/tasks.md`, `docs/agents.md` and `playbooks/task.md` say all of this. ADR 0017's "a model
  per task from the form" is replaced by `use` lines.

## Confirmation
- `tests/task-run.test.ts` ("answers, files, and events with nothing new") runs each rule end to end
  with a fake GitHub and agent:
  - the quiet-day close, and the close-with-comment window;
  - markdown and files, masking, a long reply as a file;
  - nothing new, and a reopen without a word;
  - a title that names no project, unread comments after a failure;
  - a broken job, and an operation's comment.
- `tests/agents.test.ts` covers `use` lines and flags.
- `tests/task.test.ts` covers the forms.
- `ship pr` on a Shipify checkout shows its checks without `--yes`.
