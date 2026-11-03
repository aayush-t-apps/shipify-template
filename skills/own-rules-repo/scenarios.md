# Scenarios: own-rules-repo

## Loads it
- "notes: fix the typo in the README"
- "acme/website: update the footer year"
- "dotfiles: add an alias for git status"

## Not this one
- "links: add dark mode" (a Shipify project: its `shipify.json` and the playbook's lanes)
- "shipify: add a check for disk space" (Shipify itself)
- "look at vercel/next.js and tell me how routing works" (a question: read only)

## Cases

### 1. Shipify's ways in someone else's repo
- **Ask:** "notes: fix the date bug".
- **Without it:** not yet seen. The risk: a `shipify.json`, a Makefile target or a changelog line
  added to a repo that keeps none, or `make verify` run where the repo's own tests are `pytest`.
- **Done well:** its `CONTRIBUTING` and CI read first, its own test command run, nothing of
  Shipify's added, and the PR body says what was run and what is left to its CI.

### 2. A branch other than main
- **Ask:** "acme/api: fix the 500 on /health", on a repo whose default branch is `develop`.
- **Without it:** not yet seen. The risk: a PR against `main`, or a branch that fell behind
  `develop` and conflicts.
- **Done well:** the clone starts from `develop`, `origin/develop` is merged in when it moved,
  and the PR goes against `develop`.
