---
status: accepted
date: 2026-09-29
---

# 0012: Tasks: you ask on GitHub, a box does the work, merges still approve

## Context
The agent runs on the PC, in a conversation, so the PC has to be on and every ask, however small,
goes through a terminal. Shipify already keeps all state in git, GitHub and the host (ADR 0002),
and every approval is a merge (ADR 0003). Only two things are tied to the PC: where the agent runs,
and where you talk to it.

## Options
- **A: an always-on machine you drive by SSH or Remote Control** (+ nothing to build / − still one
  conversation at a time, by hand, with nothing queued or recorded).
- **B: a Shipify server with its own queue, database and site** (+ full control / − a service to
  build, secure and run, against ADR 0002).
- **C: a vendor's cloud agent** (Claude Code on the web, Codex cloud) (+ no machine / − one repo
  per session in the vendor's sandbox, tied to one vendor, and the Shipify workspace doesn't fit).
- **D: GitHub is the queue.** A task is an issue in shipify. A workflow sends it to a GitHub runner
  on a small box you own (a Pi, a VPS, a container), which runs any agent. The work arrives as PRs
  with previews, and you merge (+ no new service or account, the GitHub app is enough, every step
  is recorded, the box is replaceable / − tasks wait while the box is offline, and a small box runs
  one at a time).

## Decision
Chosen **D**. The design, its diagrams and failure cases: [docs/tasks.md](../tasks.md).
- **Tasks:** an issue you open in shipify is a task, and its title says what it's about
  (`spotter: …`, `new: …`, `try: …`). Your comments on it continue it, and closing it stops it.
  Every task is in one state: waiting, working, needs you, failed, done (merged) or dropped
  (closed as not planned). The state is kept on GitHub only, as a label and the bot's status
  comment. Merging a plan starts its build.
- **The box:** any Linux machine where `ship doctor` passes, with a GitHub runner registered to the
  shipify repo only. `ship box up` makes this machine one, and `ship box add <host>` sets up
  another over SSH, once. Nothing on it matters: each job gets fresh tokens, a fresh checkout and its
  own worktree. CI and deploys stay on GitHub's machines.
- **The bot:** a GitHub App, `shipify-bot`. It opens every PR, with a token that lasts one hour.
- **Lanes, by size:** a tweak or fix is one PR, and a feature is one PR that includes its change
  doc. A new project, or anything hard to reverse, gets a doc first (amends ADR 0003).
- **Always a PR:** every change is a PR the owner merges, for staging apps too. The pipeline never
  deploys production from a bot's push; only the first push that publishes a project, and a
  staging app's `main` (staging), may come from the bot.
- **Throwaway:** a `playground` project whose PRs are previews. Merge an experiment to keep it, or
  close it to discard it.

## Consequences
The PC can be off, and the GitHub app is enough to ask, review and approve. Small changes get
cheaper (one PR, one merge), while big ones keep their doc-first review. New pieces:
- one workflow (`task.yml`) and one GitHub App (`ship bot`);
- a setup script for boxes (`box/setup.sh`);
- the `ship` commands `box`, `task`, `sync`, `pr` and `refresh`;
- a pipeline check, and `"releases": false` for the playground.

Tasks queue while the box is offline, and GitHub cancels them after 24 hours. They share the
agent subscription's limits.

## Confirmation
- `task.yml` runs only on the shipify repo's runner, and only for the owner's events.
- The pipeline rejects a bot's push that would deploy production (the step "Only the owner's merges go live").
- `ship doctor` passes on the box, including each stack's local-runtime check.
