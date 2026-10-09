---
status: accepted
date: 2026-09-28
---

# 0010: Core runs the flow; stacks own build and hosting

## Context
ADR 0001 made stacks and hosts pluggable in principle, but core still named the tools: the CLI ran
`pnpm install`, parsed `vitest.config.ts` and `wrangler.jsonc`, read the version from
`package.json` and called the Cloudflare API, and the pipeline deployed with wrangler. A new
language or host would have meant editing core.

## Options
- **A:** a plugin model with typed hosts, runtimes, features and profiles (+ very general / − a
  platform to design and maintain before anything needs it).
- **B:** core knows only the flow and a small `make` contract; each stack implements the targets,
  including deploy, in files the project owns (+ small, any language or host works today / − a fix
  to one stack's deploy script reaches projects through `ship upgrade`, not automatically).

## Decision
Chosen **B**.
- Core (the CLI and `pipeline.yml`) runs plans, change docs, versions, git, GitHub and `make`
  targets, and never names a language, package manager or host.
- `make` targets are the contract: `setup check test build verify`, `deploy` for apps, optional
  `audit format e2e preview rollback pause resume version`. The pipeline passes `SHIPIFY_*`
  variables and a JSON file of the secrets `shipify.json` names.
- `stack.json` declares what core needs: deploy secrets and variables, URL and health templates,
  what a plan must decide, and doctor checks.
- The version lives in `shipify.json`. Stacks copy it into native files with `make version`.
- `custom-app` and `custom-package` give any language or host the contract with stub targets.

## Consequences
A Go service, a Python job or an AWS host is a project with its own Makefile, and later a stack if
it repeats. The Cloudflare logic lives in `stacks/_cloudflare` (`scripts/shipify/cloudflare.mjs`).
Usage reporting moved to the Shipify page, which is a Cloudflare app itself.

## Confirmation
`tests/core.test.ts` fails if `cli/` names a project tool. `ship validate` checks the targets, and
the golden tests build every stack and check that a fresh project needs no upgrade.
