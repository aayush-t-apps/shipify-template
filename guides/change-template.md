---
change: {{N}}
app: {{APP}}
title: "{{TITLE}}"
bump: {{BUMP}}
released: null
---

# {{NNNN}}: {{TITLE}}

<!-- A change doc is a short RFC: what changes in the spec and why. About half a page. It's approved
     by merging its docs-only PR and never edited after that; a follow-up gets a new doc. Keep
     stable ids: new stories and criteria take the next free numbers in docs/spec.md. -->

## Why

[NEEDS CLARIFICATION: the problem or opportunity, in 2–3 lines]

## Spec changes

### Added

- **US?(P?): …**. As a …, I want …, so that …
  - AC?.1 WHEN … THE APP SHALL …

### Changed

- None.

### Removed

- None.

## Alternatives considered

<!-- What else could answer the "why", and why this change instead: one line each. A choice that's
     hard to reverse (a database, sign-in, a host, a public API shape) also gets an ADR in this PR:
     docs/adr/NNNN-<slug>.md from shipify's guides/adr-template.md, linked here. -->

- [NEEDS CLARIFICATION: an alternative, and why not]

## UI

<!-- (if screens change) What changes on which screen, and the states. -->

## Design

<!-- (if code design changes) Data, API, failure modes, limits. Only the delta. When the
     architecture or a flow changes, show it in Mermaid (a sequenceDiagram for a flow) and update
     the diagram in docs/spec.md to match. -->

## Rollout and rollback

<!-- How it reaches users, and how to undo it. With stored data or config: forward-only
     migrations, and what a rollback keeps. When nothing is stored, "ships with the release; a
     rollback restores the previous version" is enough. -->

- [NEEDS CLARIFICATION: how it rolls out, and what a rollback does]

## Docs and clean-up

<!-- Every doc this change updates (spec, README, AGENTS.md, guides, skills), and what it makes
     obsolete and removes. Any setup it needs, in plain steps a less technical person can follow.
     "None" when that's true. -->

## Tasks

- [ ] T1 [US?] <outcome> — files: `…` — verifies: AC?.1

## Verification

- `make verify` passes. `docs/spec.md` is updated to match this change.
