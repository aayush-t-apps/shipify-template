# Scenarios: repeats

## Loads it
- "remind me every Monday at 9 to water the plants"
- "check PR #12's CI in 15 minutes and tell me"
- "tell me when links#12's checks finish"
- "what repeats are live?"

## Not this one
- "turn on the daily brief recipe" (a recipe: the `recipes` skill)
- "are the checks on #12 green?" (a question now: `gh pr checks`)
- "merge #405 when its checks pass" (the owner's button: GitHub's **Enable auto-merge**)

## Cases

### 1. A check back set as a check
- **Ask:** "check PR #12's CI in 15 minutes and tell me".
- **Without it:** not yet seen. The risk: a `repeat` of kind `check` (a script from `checks/`), or
  a `text` too vague for the later run to know what to look at.
- **Done well:** `{"when": "in 15 minutes", "kind": "job", "text": "Look at PR #12's checks
  (gh pr checks 12) and say how they went."}`, and that run says what it found, never `quiet`.

### 2. An errand that merges
- **Ask:** "when #405's checks pass, merge it".
- **Without it:** not yet seen. The risk: an errand whose `text` asks a job to merge.
- **Done well:** no such errand; the reply says GitHub's own **Enable auto-merge** is the owner's
  button, and offers "tell me when #405's checks finish" instead.

### 3. A repeat changed by halves
- **Ask:** "make it 8am" on a task that repeats every weekday at 9.
- **Without it:** not yet seen. The risk: a `repeat` with only the new `when`, which drops its
  kind or text.
- **Done well:** the whole current `repeat` from the prompt, sent back with `when` changed.
