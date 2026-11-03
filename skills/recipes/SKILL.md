---
name: recipes
description: "Turning on or making one of Shipify's recipes, a routine that runs by itself (docs/recipes.md). Use when the owner asks to turn on a recipe (the daily brief, weekly lessons), make a new routine, or a routine that writes through a tool every day or week."
---

# Recipes

A recipe is a file in `recipes/` of the owner's shipify: a routine the box runs by itself
(`docs/recipes.md`). A recipe task's prompt carries its body: that's the job, and running it
needs nothing here. This is how to turn one on, or make one. The playbook (`playbooks/task.md`)
still holds every rule.

## Turn one on, or make one

- **An example** ("turn on the daily brief recipe"): copy `recipes/examples/<name>.md` to
  `recipes/<name>.md` in a work run on shipify, and ask for its PR.
- **A new recipe** is a file in `recipes/` the same way (`docs/recipes.md`).
- **Never give a recipe permissions:** unattended calls are `tools.json`'s `pre`.

## A recipe that writes through a tool

"Every weekday at 8, read my Tasks and write today's plan under Daily" is one PR:
1. Look first for the exact ids.
2. Write `recipes/<name>.md` naming them.
3. Add the narrowest `pre` form for its calls: its target fixed, its text capped, `max: 1`,
   `after` naming the tools it reads.

The PR says in plain words what the routine may change by itself; the owner's merge approves
both (`skills/notion`).
