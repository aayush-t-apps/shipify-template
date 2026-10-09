# Recipes

A recipe is a repeat written as a file here, `recipes/<name>.md`, approved by merging it
([docs/recipes.md](../docs/recipes.md)). Three settings, then the job:

```markdown
---
when: every weekday at 08:30   # a repeat's schedule
check: example                 # optional: checks/example.mjs gates it; the agent runs when it changes
model: sonnet                  # optional: as a task's `use` line
---
What the agent does each time, in plain words. Finish quiet when there's nothing new.
```

- **Live:** each `*.md` here (not this README). Its task, "Recipe: <name>", opens within minutes
  of the merge and says when it runs next.
- **Examples** in [`examples/`](examples/) aren't live: copy one here in a PR, or say "turn on the
  daily brief recipe".
- **Now:** `#<task> again`. **Pause:** close its task (`resume` reopens it). **End:** remove the file.
- **What it may change:** what any repeat may: replies, notes, and `tools.json`'s pre-approved
  calls. Anything else waits for your `yes` on GitHub.
