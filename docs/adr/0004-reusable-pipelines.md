---
status: accepted
date: 2026-09-27
---

# 0004: Pipelines are reusable workflows versioned with Shipify

## Context
Copying workflows into every project made every pipeline fix a version bump plus an upgrade in
each project.

## Decision
- The pipeline lives in `shipify/.github/workflows/pipeline.yml` (`workflow_call`), one file for
  apps and packages. It runs the project's `make` targets and nothing else (ADR 0010).
- Projects carry one short caller that uses `@v1` and passes their repository variables. The
  reusable workflow reads `shipify.json` for everything else.
- `v1` is a moving major tag that the platform release moves. Full releases are immutable `vX.Y.Z`
  tags.
- The shipify repo allows access from repositories in the org.

## Consequences
Fixes inside `v1` reach every project at once, so they must stay compatible (ADR 0005). Pipeline
changes are tested on a canary project before `v1` moves.

## Confirmation
- `actionlint` runs on both workflows in platform CI.
- The golden tests check that callers reference `@v1`.
