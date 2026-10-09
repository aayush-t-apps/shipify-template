---
status: accepted
date: 2026-09-28
---

# 0011: Defaults are suggestions; the owner's choice wins

## Context
The defaults (TypeScript on Cloudflare's free tier) are a good starting point, but checks like "at
most 100 Workers" treated them as rules. Projects will vary in language, host and scale.

## Decision
- Planning picks the optimized default for anything the owner didn't specify
  (`guides/architecture.md`).
- Anything the owner specifies wins: another language, host, paid plan or scale. The plan states
  it, with what it costs, and uses a matching stack or `custom-*`.
- Core never blocks on a host's limits or cost. Checks block only what is actually broken: an
  incompatible stack and preset, missing sections, secrets in a plan.

## Consequences
The free tier stays the default without being a constraint. Cost is visible in the plan PR, which is
where the owner approves it.

## Confirmation
`ship plan check` has no budget checks; the plan PR body shows the stack's cost row.
