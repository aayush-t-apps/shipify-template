---
name: new-project
description: "Planning and building a new Shipify project, from its plan's PR to its first deploy. Use when a task starts with new, asks for a new app, site or project, or a run builds a merged plan in a new, empty repo."
---

# A new project

A `new: …` task is two kinds of run: the first plans it, and a later run builds it once the
owner merges the plan. The playbook (`playbooks/task.md`) still holds every rule; this is the
how.

## The plan

In your clone of shipify, follow `playbooks/plan-app.md`, running Shipify from that clone so the
plan lands there: `pnpm ship plan new …`, fill it in, `pnpm ship plan check …` (`make setup`
installed it). Commit `plans/<id>.plan.md` (its `task:` line links it to the task), and ask for
its PR (`kind: part-of`). Your reply asks the owner to merge it, and says the merge starts the
build (no `go` needed).

## The build

When the plan is merged, a later run builds it in a clone of the new, empty repo: the box has
already laid the stack's files out there (`<ship> build <id> --into <clone>`), so follow
`playbooks/build-app.md`, and ask for `kind: publish`. The box pushes it, and tells the owner
"**Live:**" once it's deployed.

## As a part of a split

A `new:` part of a split task is `part-of` first, as above (its plan), then its build. It closes
once its app is live.
