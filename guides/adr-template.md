---
status: proposed   # proposed | accepted | superseded by NNNN
date: YYYY-MM-DD
---

# NNNN: <decision as a short phrase>

Write an ADR only for a decision that's hard to reverse. The platform's live in `shipify/docs/adr/`;
a project's live in its `docs/adr/`, each linked from the change doc that makes the decision.

## Context
The problem and the forces at play, in 2–5 lines.

## Assumptions, checked
Every fact the decision rests on, with how it was checked: a source, or better, a test with the
real tool. Cost, plan limits and "it works headless" are the ones that fail. Anything not yet
checked says which step checks it first.

| Assumption | How it was checked |
|---|---|
| … | … |

## Options
- **A:** … (+ … / − …)
- **B:** … (+ … / − …)

## Decision
Chosen **A**, because …

## Edge cases
What happens when things go wrong or arrive in an odd order: missing setup, a service down, two at
once, a retry, a stale or changed request, someone else. One line each, decided now rather than
found later.

## Setup
What someone does to set it up, as a less technical person would follow it: the guided command,
each step in plain words, and the check that says it worked. "Nothing to set up" when that's true.

## Docs and clean-up
Every doc, skill, guide and playbook the build updates (README, `docs/`, the glossary, `skills/`,
`guides/`, `playbooks/`, AGENTS.md), and what it removes or replaces. The build isn't done until
they match.

## Consequences
What gets easier, what gets harder.

## Confirmation
How anyone can check this still holds (a test, a `ship` check, a CI step).
