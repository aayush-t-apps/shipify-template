# Scenarios: recipes

## Loads it
- "turn on the daily brief recipe"
- "every weekday at 8, read my Tasks and write today's plan under Daily"
- "make a recipe that checks my site every hour"

## Not this one
- "remind me every Monday at 9 to water the plants" (a repeat on the task: the `repeats` skill)
- "add Linear as a tool" (a plug-in: the `plug-ins` skill)
- the run of a recipe itself (its body in the prompt is the job)

## Cases

### 1. A routine that writes with too wide a form
- **Ask:** "every weekday at 8, read my Tasks and write today's plan under Daily".
- **Without it:** not yet seen. The risks: a recipe given permissions of its own, or a `pre` form
  with an open target and no `max`, so the routine may write anywhere.
- **Done well:** the ids looked up first, `recipes/<name>.md` naming them, the narrowest `pre`
  form (target fixed, text capped, `max: 1`, `after`), and a PR that says what it may change.

### 2. An example turned on in place
- **Ask:** "turn on the weekly lessons recipe".
- **Without it:** not yet seen. The risk: `recipes/examples/weekly-lessons.md` edited, or the copy
  made outside a work run on shipify, so no PR holds it.
- **Done well:** a copy to `recipes/weekly-lessons.md` in a work run on shipify, and its PR.
