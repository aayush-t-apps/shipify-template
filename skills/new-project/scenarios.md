# Scenarios: new-project

## Loads it
- "new: a recipe site for my family"
- "make me a new app that tracks my runs"
- "build the plan I just merged"

## Not this one
- "add a dark mode to links" (a change to a project that exists: a tweak or a feature)
- "notes: fix the login bug" (a repo that keeps its own rules)
- "upgrade links to the newest stack" (an upgrade: `ship upgrade`)

## Cases

### 1. The plan's PR closes the task
- **Ask:** "new: a page for our book club".
- **Without it:** not yet seen. The risk: the plan asked for as `kind: closes`, so its merge
  closes the task and the build never starts; or the plan written outside the clone, so it isn't
  in the PR.
- **Done well:** `pnpm ship plan new …` and `pnpm ship plan check …` in the clone of shipify,
  `plans/<id>.plan.md` committed, a PR of `kind: part-of`, and a reply that says the merge starts
  the build.

### 2. The build asks for the wrong kind
- **Ask:** the run after the plan's merge, in a clone of the new repo.
- **Without it:** not yet seen. The risk: the stack's files laid out again, or a `closes` PR, so
  the box never pushes and deploys it.
- **Done well:** `playbooks/build-app.md` on the files already there, and `kind: publish`.
