---
name: repeats
description: "Setting when a Shipify task runs again: a repeat, a check back once, or an errand (ADR 0054). Use when the owner says every day or week, in 15 minutes, remind me, tell me when a PR's checks finish, merges or is deployed, or asks what repeats are live."
---

# Repeats, check backs and errands

Each is a `repeat` in your result; the box runs it at its time. The playbook
(`playbooks/task.md`) still holds every rule; this is the how.

| The owner says | It is |
|---|---|
| "every Monday at 9", "every weekday" | a task that repeats |
| "in 15 minutes", "remind me in 5 hours", "at 17:30", "tomorrow at 9" | a check back once |
| "tell me when #12's checks finish", "when #405 merges", "when it's deployed" | an errand |

## A task that repeats

Set `repeat`: `{"when": "every Monday at 9", "kind": "reminder" | "job" | "check", "text": "…"}`.
- **A reminder** is only a message (no agent each time).
- **A job** needs judgement each time (at most every hour).
- **A check** runs a script from `checks/` and says only what changed. A new check is a change to
  shipify: write `checks/<name>.mjs`, which prints the value to watch.

On a scheduled run with nothing to say, finish with `"quiet": true`. A PR on a task that repeats
is `kind: part-of`: a `closes` PR's merge closes the task, and that pauses its repeat.

- **Change one** ("make it 8am"): the prompt shows its current one: send the whole `repeat`
  back, changed.
- **"What repeats are live?":** list them: `gh issue list -R <owner>/shipify --label repeats
  --state open`, and read each one's status line ("Repeats every Sunday at 14:00 (a reminder) ·
  next …").

## Check back once

"check PR #12's CI in 15 minutes and tell me", "remind me in 5 hours to …", "at 17:30 look at the
deploy": set `repeat` with those words as its `when` ("in 15 minutes", "in 5 hours", "at 17:30",
"tomorrow at 9"), and say in `text` exactly what to look at and report: the PR, the run, the
command (`gh pr checks <pr>`). A `job` when it needs looking at, a `reminder` when it's only
words; never a `check`.

It runs once, within about 5 minutes of its time, even while the task's PR waits, then ends. That
run always says what it found: never `quiet`, and no new `repeat` unless the owner asked for one.

## An errand

"tell me when links#12's checks finish", "when #405 merges, check the login page", "when it's
deployed, …", "tell me when shipify's main checks finish". Set `repeat` with the thing as its
`when`, in these words:
- "when <PR>'s checks finish"
- "when <PR> merges"
- "when <PR> is deployed"
- "when <repo>'s <branch> checks finish"

<PR> is its link, `<repo>#<n>`, `#<n>` (the task's own repo) or "the PR" (the task's newest). Add
"for 3 days" or "within 2 hours" when it should wait other than a day (7 days at most). `text`
says what to do then.

- **A `reminder`** when being told is all; **a `job`** when it needs looking at or doing, and "fix
  it" only when the owner said so.
- **Never one that merges:** say GitHub's own **Enable auto-merge** is the owner's button.
- The box looks with no agent and fires it once; only on the owner's own account.
- **List them** with `gh issue list -R <owner>/shipify --label waiting --state all`.

When an errand's job runs, the prompt says what happened: do what `text` asks, say what you found
(never `quiet`), and set no new `repeat` unless asked.
