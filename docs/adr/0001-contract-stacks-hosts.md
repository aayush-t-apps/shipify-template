---
status: accepted
date: 2026-09-27
---

# 0001: One contract; interchangeable kinds, stacks and hosts

## Context
Projects will differ in language, framework, host and size, and may become monorepos. What makes
them manageable is what they have in common, not a single architecture.

## Options
- **A:** one opinionated template per use case (+ quick / − overfits; every new need is a new template).
- **B:** a fixed contract plus pluggable **kind** (app, package), **stack** (language and toolchain) and
  **host** (deploy adapter) (+ new languages or hosts are additive / − the contract must stay small).

## Decision
Chosen **B**. The contract (`shipify.json`, the `make` verbs, docs, versioning, the pipeline shape,
the security baseline) is the same for every project; see docs/design.md. The stacks today are
`ts-worker`, `ts-static` and `ts-package`, and the host today is `cloudflare`. A monorepo later means
several projects, each with its own `shipify.json` and path; the contract applies per project.

## Consequences
Python, Go, C++ or AWS arrive as a new stack without changing anything else. Stacks must
implement every verb, even trivially. ADR 0010 makes this concrete: a host is not a separate plugin
but part of a stack's `make` targets.

## Confirmation
`ship validate` checks the contract, and the golden tests run every stack.
