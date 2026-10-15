---
status: accepted
date: 2026-09-27
---

# 0008: Projects explain themselves: agent-neutral docs, short guides, enforced checks

## Decision
- Every repo's `AGENTS.md` is the entry point for any agent: commands, layout, rules, and "history
  and how to change". `CLAUDE.md` is `@AGENTS.md`.
- A project's truth is `docs/spec.md` (now), `docs/changes/` (why) and `CHANGELOG.md` plus tags
  (when). Change docs are never edited after approval.
- Platform guides stay short and are enforced where possible:
  - plan and change templates, with EARS criteria (`WHEN … THE APP SHALL …`) and tasks linked to
    criteria;
  - architecture defaults;
  - a design brief with an avoid-list;
  - the quality bar (360px, tap targets, JS budget, accessibility).
- Decisions live in `docs/adr/`, and current state and gotchas in `docs/context.md`. Agent-private
  memory is never the only copy.

## Consequences
Any agent (Claude, Codex, OpenCode) or person can pick up a project safely. Short docs keep the
overhead low.

## Confirmation
- `ship plan check` and `ship change check` enforce the formats.
- The shared tests enforce the quality bar.
