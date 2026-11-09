---
name: own-rules-repo
description: "Changing a repo that keeps its own rules (ADR 0044): one of the owner's repos that isn't a Shipify project, or one on another of their accounts. Use when a task names a repo with no shipify.json, or an account/repo, or the prompt says its own rules first."
---

# A repo that keeps its own rules

The task is `<repo>: …` (one of the owner's repos that isn't a Shipify project) or
`<account>/<repo>: …` (one on another of the owner's accounts). Its own rules first, then
Shipify's. This skill holds its rules and the how; the playbook (`playbooks/task.md`) points here,
and still holds every other rule.

## Learn its way

Read its `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING` and README, its commands (`package.json`,
`pyproject.toml`, `go.mod`, `Cargo.toml`, a `Makefile`) and what its CI runs, and follow them:
its style, its setup and its tests.

## Make the change

- **With a test** where it has tests; a version or a changelog line only if it keeps them.
- **Add nothing of Shipify's to it** (no `shipify.json`, workflow, Makefile target, hook or agent
  file) unless the owner asks. Change one of its workflow files only when the owner asks: the box
  holds it out of the push and lists its lines for their Yes when it runs only after their merge
  (ADR 0075). A change to its PR checks (`pull_request`) runs before the merge: never listed, it's
  theirs to make. On another account, make no workflow change: the box can't push one there.
- **Commit, run its tests, and ask for the PR** (`kind: closes`), saying in its body what you ran:
  its own CI checks the PR, not the box.
- **A service a test needs** (a database) can run in a container (the playbook's Containers rule).
- **A test this box can't run** (it needs a browser, more memory, privileges a container lacks,
  or hardware the box lacks) isn't forced: run what fits, and say in the PR which didn't and why,
  for its CI to run.

## Its branch

Its default branch (the prompt names it when it isn't `main`) is where your clone starts and its
PR goes. Moved past your branch? Merge `origin/<that branch>` into your clone, keeping both
changes.

## Another of the owner's accounts

The repo is all you hold: no notebook, no tools, no other repo, and its people may read every
word of the PR.
