# Shipify keeps the project contract too (docs/design.md): a run that changes Shipify itself (a
# recipe, a check, a skill, its code) is checked on the box before its PR, by the same targets as
# any project's. `verify` checks what the change reaches, quickly: the format, lint and types, the
# contract tests every plug-in, recipe and check passes, and the tests its changed files reach. The
# whole suite is `pnpm verify` on your PC, and ci.yml's after the merge.
.PHONY: setup verify

setup:
	pnpm install --frozen-lockfile

verify:
	pnpm format:check && pnpm lint && pnpm typecheck
	pnpm exec vitest run tests/architecture.test.ts tests/core.test.ts tests/recipes.test.ts tests/checks.test.ts tests/plugins
	pnpm exec vitest run --changed origin/main --passWithNoTests
