# {{APP_NAME}}: agent guide

{{APP_DESCRIPTION}}

A Shipify **package** (stack `ts-package` {{STACK_VERSION}}). It ships as code: tag plus GitHub
Release, with no registry and no deploy.

## Commands

`make setup` · `make test` · `make verify` (everything CI checks; it must pass before every push).

## Layout

- `src/index.ts`: the public API. Everything exported is a promise to consumers.
- `tests/unit/`: Vitest, with at least 80% coverage.
- `Makefile` and `scripts/shipify/`: the Shipify contract for this stack (CI runs only `make`
  targets). Stack-owned: `ship upgrade` replaces them. Add project-specific targets in `project.mk`.
- `shipify.json`: project settings, including the version (`make version` copies it into
  `package.json`). `docs/`, `CHANGELOG.md`: its history.

## Rules

1. Semantic versions: a breaking export change → major, a new export → minor, a fix → patch.
2. Never commit secrets. Never force-push or edit `.github/workflows/`: the pipeline is this
   project's own, its stack's, and changes only by `ship upgrade`.
3. Pin new dependencies to exact versions at least 2 days old.

## History and how to change this package

Read `docs/spec.md`, then `docs/changes/`, then `CHANGELOG.md`. Tooling is in shipify; run it from
there.

- **A new API or behaviour:** a change doc, `pnpm ship change new {{APP_ID}} <slug>` → fill it in
  → `pnpm ship change check {{APP_ID}} <n>`. It goes in the same PR as the code. For a breaking
  change, submit the doc alone first (`pnpm ship change submit {{APP_ID}} <n> --yes`) and wait for
  the owner to merge it.
- **A fix:** no change doc. Make the fix with a test.
- **Ship it:** `pnpm ship version <checkout> <patch|minor|major>`, then `pnpm ship pr <checkout> --yes`.
  When the owner merges it, CI tags `vX.Y.Z` and publishes the release. If main moved meanwhile,
  `pnpm ship refresh <checkout>` first.
