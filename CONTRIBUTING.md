# Contributing to Shipify

Shipify has one owner, who approves every change by merging its PR. Agents and people work the same
way, and [AGENTS.md](AGENTS.md) has the full rules. This page is the short version for a change to
Shipify itself (the CLI, stacks, presets, workflows, docs).

## The rules

- **Keep the core small.** It runs the flow and names no stack, agent, tool or host: those plug in
  (ADR 0010). Add the smallest change that does the job; don't rebuild what works.
- **Free only:** no paid service, no domain to buy.
- **Versions change only in a PR that says so:** Claude Code, Node 22, pnpm, the actions.
- **A big change is planned first:** an ADR (`guides/adr-template.md`) in a PR the owner merges,
  then the build. Stop until it's merged.
- **Never** commit a secret's value, push to a `main` branch yourself (every change is a PR),
  force-push or delete anything ([security.md](docs/security.md#the-rules-and-why)).

## Making a change

1. **A branch of its own,** or a worktree
   ([playbooks/parallel-work.md](playbooks/parallel-work.md)).
2. **Tests first** for any change in behaviour (`skills/test-driven-development`).
3. **Check it:** `pnpm verify` (format, lint, types, tests). If you touched `stacks/`, `presets/`
   or the workflows, also `pnpm test:golden`. That's the only check before the PR: Shipify's CI runs
   after the merge (ADR 0018). The tests use half the cores (`vitest.config.ts`), so a small box
   stays usable while they run.
4. **Say what changed:** a line in `CHANGELOG.md` under `## [Unreleased]`.
5. **A stack change** also bumps `stacks/<id>/stack.json`, and one that needs action in projects
   gets `stacks/<id>/migrations/<version>.md` (ADR 0005). Stack templates are stored exactly as the
   project formatter writes them.
6. **Docs:** update the doc that owns the fact (the [docs index](docs/README.md) says which), using
   the words in [the glossary](docs/glossary.md). Plain words, short sentences. Every doc, skill,
   guide and playbook the change touches is updated in the same PR, and what it made obsolete is
   removed: docs are part of done.
7. **Open the PR** and link its task, if it has one. The owner merges it.

## Releases

Changes collect under "Unreleased" and ship in batches: move them to a version, bump `package.json`
(and any changed `stack.json`), test on a canary project, and merge. CI tags `vX.Y.Z`, publishes the
release, then `shipify: release` publishes it to the template. The steps:
[operations.md, "Releasing Shipify"](docs/operations.md#releasing-shipify).
