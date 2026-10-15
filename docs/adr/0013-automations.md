---
status: accepted (what starts repeats: the watch, ADR 0019; before it, the clock of ADR 0016). Step 2, check scripts, is built as ADR 0027's recipes (`do: check`, in `recipes/`, not `automations/`). Amended 2026-10-03, the owner's ask (task #74): with the watch looking every 5 minutes, schedules go down to every hour for agent runs and every 15 minutes for reminders ("every 2 hours from 9am to 9pm"), instead of at most daily. Amended by 0054: a repeat once may wait for something on GitHub instead of a time (an errand)
date: 2026-10-01
---

# 0013: Automations: tasks that repeat

## Context
Some asks repeat:
- "remind me to look at the servers at 9 every day";
- "tell me if this product's price changes";
- "PR spotter's dependency updates every week".

Today a task does one ask each time you comment. What's wanted:
- ask once, in plain words, or fill in a short form;
- it keeps itself going on any box, and survives a new one;
- it speaks up only when there's something to act on;
- it uses the agent only where judgement is needed;
- it costs nothing extra and needs no watching.

The roadmap lists "scheduled tasks (weekly upgrades and audits as PRs)".

## Options
- **A: cron on a box** (+ nothing to build / − tied to one machine and lost on a rebuild,
  unreviewed, silent, and it would need GitHub tokens kept on the box).
- **B: a workflow per automation, on GitHub's machines** (+ plain GitHub / − every automation
  edits a workflow, and minutes run out: every 15 minutes uses more than the 2,000 free a month).
- **C: GitHub's own tools and outside services** (Dependabot, an uptime monitor, a price tracker)
  (+ nothing to run / − one kind of job each, and Dependabot's PRs skip the version bump, changelog
  and screenshots).
- **D: checks first:** a framework of check scripts with a notification state machine before any
  automation needs one (+ cheap frequent checks / − the most code, for jobs that are mostly daily
  or weekly).
- **E: a task that repeats.** An issue says what and when; a clock on a box does what's due, and
  the agent runs only for the kinds that need it (+ every task feature for free, the agent can set
  it up and change it, reminders cost nothing / − agent runs suit daily, weekly or monthly jobs).

## Decision
Chosen **E**. D's check scripts come as step 2. C sits alongside where it's better:
- an outside monitor for sites, since one on the Pi goes quiet in the same power cut as the Pi;
- Keepa for Amazon prices, since Amazon blocks automated reads;
- Dependabot alerts for known vulnerabilities.

**An automation is an issue.** It lives in shipify, with the `repeats` label: open is on, closed is
off. Only the owner's issues and comments count. The bot posts for the owner, and boxes run it.

**Kinds:**

| Kind | For | Each run | Agent | Step |
|---|---|---|---|---|
| reminder | "remind me to …" | the clock posts the text as a comment | never | 1 |
| agent run | jobs that need judgement: dependency PRs, summaries, reading a page | a task round: quiet, an answer, or a PR | each run, at most daily | 1 |
| check | a yes-or-no or a value: a price, a page, a port, disk space | a script in `automations/` that tells you only when its answer changes | never, unless the check hands over | 2 |

Until step 2, a check runs as a daily agent run. A job that belongs inside an app, such as a nightly
job in spotter, is a change to that app, not an automation.

**Setting one up:**
- **In plain words**, in a new issue or any task: "every day at 9, remind me to look at the
  servers". One agent round reads it, picks the kind and records it. It replies with what it
  understood: "Set: a reminder, every day at 09:00 (your time). Next: tomorrow 09:00. Close this
  issue to stop it."
- **Or the Repeat form:** what to do, when, and the kind. Nothing to interpret, so no agent at all.
- **Changing or stopping:** comment ("make it 8am", "stop repeating"), or close the issue.

**The clock:**
- `automations.yml` runs every 15 minutes, at minutes 7, 22, 37 and 52 (away from the top of the
  hour, when GitHub's scheduler is busiest).
- It runs on a box, on that box's own small **clock runner** (label `shipify-clock`). `box add` and
  `box up` register the clock runner next to the box's task runner, so the clock never waits behind
  a long task.
- One clock run at a time across all boxes (a concurrency group). With no box online it waits; a
  newer tick replaces a waiting one.

**One tick** (`ship task due`, seconds when nothing is due):
1. One GitHub call lists the open `repeats` issues, and their status comments say what's due.
2. Due reminders are posted, one after another.
3. Due agent runs are started as task jobs (`workflow_dispatch`, as "run again" does). They queue
   for boxes like any task: one at a time per box.
4. The status comment of each one done gets its last and next run.

**It looks after itself:**
- A run missed while every box is off happens once when one is back, then it keeps its times:
  09:00 stays 09:00.
- A failed run is retried at the next time. After three in a row it pauses and tells you once;
  "resume" restarts it.
- The weekly clean-up and `ship doctor` say if the clock hasn't run in a day.
- Merging a PR from a repeating task doesn't close the task; the next run starts from `main`.
- Between runs, the agent keeps a short memory in the task's notes, as tasks already do: for
  example, the last price, or versions you declined by closing a PR.

**Where things live** (no database, and nothing on a box that matters):

| What | Where |
|---|---|
| The ask and the conversation | the issue and its comments |
| Kind, schedule, text, last and next run, failures in a row, paused | the hidden JSON line of the bot's status comment, like every task |
| What the agent learned between runs | the task's notes, in the same line |
| The list of automations | issues with the `repeats` label |
| The clock | `.github/workflows/automations.yml` in this repo |
| Check scripts (step 2) | `automations/` in this repo, by PRs you merge |
| Each run's log | GitHub Actions, for 90 days |

**Edge cases:**

| Situation | What happens |
|---|---|
| No box online | the tick waits; each overdue run happens once when a box is back |
| A long task is running at 09:00 | reminders still go out: the clock has its own runner. A due agent run waits for the box |
| GitHub's clock is late | a run lands within its 15 minutes, plus GitHub's delay when it's busy |
| The last run is still working | skipped; the next time is used |
| Two boxes online | one tick at a time across boxes, and one run per task at a time |
| A run fails | retried at the next time; three in a row pause it and tell you once |
| You merge its PR | the task stays open, and the next run starts from `main` |
| You close its PR without merging | the agent notes those versions as declined and doesn't retry them |
| Someone else asks for a repeat | ignored: only the owner's issues and comments count |
| You ask for an agent run more than daily | the agent explains, and offers a check (step 2) |

## Consequences
- **Free:**
  - Self-hosted runners use no GitHub minutes, at any frequency. Each tick is about 20 seconds of
    the Pi's time, 96 times a day.
  - A tick makes a few API calls, against the 1,000 an hour a job's token may make.
  - Reminders cost nothing else. Agent runs are within the subscription's limits, at most daily
    per automation.
- **Step 1 builds:**
  - the Repeat form and the `repeats` label;
  - the reminder and agent-run kinds;
  - `automations.yml`, and the clock runner in `box add` and `box up`;
  - `ship task due`, with the schedule's parser in your time zone;
  - `repeat` and `quiet` in the agent's result;
  - counting failures and pausing;
  - repeating tasks surviving merges;
  - a playbook section, docs and tests.
- **Step 2:** check scripts in `automations/`, telling you only when a check's answer changes. (Built
  by ADR 0027 as recipes with `do: check`, in `recipes/`.)
- **Step 3:** pinning an automation to one box (a check of the Pi's home network); automations in
  the admin panel.

## Confirmation
- Tests for the schedule parser, what's due, quiet runs and pausing.
- A real reminder ("every day at 09:00, look at the servers") arrives between 09:00 and 09:15,
  including while a task is running.
- A weekly dependency run opens one PR, or stays quiet when nothing is outdated.
