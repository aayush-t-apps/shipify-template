# Recipes

A **recipe** is a repeat written as a file, `recipes/<name>.md`, that you approve by merging it
(ADR 0032). Use one for an automation you want to keep, review and change in a PR. For a quick one,
a repeat set in words is enough ([tasks.md](tasks.md#repeats)).

| | Repeat (in words or the form) | Recipe |
|---|---|---|
| **Lives** | on its task | a file on `main`, reviewed like any change |
| **Set up** | `repeat: every Monday at 9, …` | a PR adding `recipes/<name>.md` (or "turn on the <name> recipe") |
| **Runs** | the same way: a job, or a check and then the job when its output changed | |
| **May change** | replies, notes, `tools.json`'s pre-approved calls; anything else waits for your `yes` | the same |
| **Ends** | `stop repeating`, or closing its task | removing the file (closing its task pauses it) |

## The file

```markdown
---
when: every weekday at 08:30
check: site-down
model: sonnet
---
Good morning brief, in five lines at most: what failed overnight, what needs me today, and my three
most urgent Notion tasks. Finish quiet if there's nothing new.
```

| Setting | Means |
|---|---|
| `when` (required) | a repeat's schedule, in the same words: "every day at 09:00", "every weekday at 8:30", "every Monday at 9", "every hour". A job runs at most hourly, a check every 15 minutes |
| `check` (optional) | `checks/<name>.mjs` runs first, with no keys; the agent runs only when its output changed ([checks/README.md](../checks/README.md)) |
| `model` (optional) | what the agent thinks with, as a `use` line says it (`sonnet`, `opus high`, `pi`, `pi z-ai/glm-5.3`) |
| the body (required) | what the agent is asked each time, read from `main` at each run: always the text you merged |

One sentence each: **when** `when`, **if** `check` changed, **do** the body. No steps, branches or
loops: two small recipes read better than one big one.

## How it runs

1. **You merge the file.** That's the approval.
2. **Your merge starts the due run** (`watch.yml` on a push to `main` that touched `recipes/`).
3. **The due run opens its task,** "Recipe: <name>", labelled `recipe` and `repeats`. The task's
   first run reads the file, sets the repeat, and replies "Set from `recipes/<name>.md`: every
   weekday at 08:30. Next: …", which reaches your chat.
4. **At each time,** the run reads the body from `main` and the agent does it (read-only, as every
   run). Its reply comes to the task and to your default channels (`SHIPIFY_SEND`: your Telegram);
   with nothing to say, it stays quiet.
5. **A changed file** updates the repeat ("Updated from …"). **A file that doesn't read** pauses it,
   says why on its task and on the status task, and it runs again once a fixed file is merged.
   **A removed file** ends it and closes its task.

| You say (on its task, or `#<n> …` in a chat) | It does |
|---|---|
| `again` | runs it now |
| `stop repeating`, or close the task | pauses it, while the file stays |
| `resume` | starts it again |
| `/recipes` (anywhere) | lists each recipe, its next time and its task |

The status page lists them too ([door.md](door.md#the-status-page)).

## Examples

In [`recipes/examples/`](../recipes/examples/), not live until copied into `recipes/`:

| Example | Does |
|---|---|
| `daily-brief.md` | weekday mornings: what failed, what needs you, what's coming up; quiet when nothing's new |
| `weekly-dependencies.md` | Mondays: what's outdated across your projects, as a list, with no changes made |
| `site-watch.md` | hourly: `checks/example.mjs` first; the agent says what changed only when it did |

To turn one on, say "turn on the daily brief recipe": a run copies it into `recipes/` as a PR, and
your merge makes it live.

## Safe by design

- **Merging approves what the file says, and nothing more.** A recipe carries no permissions of its
  own: unattended changes are `tools.json`'s pre-approved calls, the one place they're approved. A
  run that read the web or ran a check still needs your `yes` for any call.
- **Only `main` counts,** and the body is read from it at each run: a branch or an edit elsewhere
  changes nothing.
- **No input from a chat:** `again` runs it as written; no words from outside go into its job.
- **Left out on purpose:** step lists, branches and loops (an engine of their own), permissions per recipe, a
  chat command per recipe, and webhook triggers.

**In the code:** `cli/lib/recipes.ts` (the file and its checks), `cli/commands/task/due.ts`
(`keepRecipes`: tasks kept in step), `cli/kernel/decide.ts` (`recipeInStep`, `runRepeat`),
`.github/workflows/watch.yml` (your merge that touches `recipes/` starts the due run). Every file
passes `tests/recipes.test.ts`.
