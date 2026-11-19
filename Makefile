# Shipify keeps the project contract too (docs/design.md): a run that changes Shipify itself (a
# recipe, a check, a skill, its code) is checked on the box before its PR, by the same targets as
# any project's. `check` is the quick part: the format, lint and types (the box's finish runs only
# these when main moved under a branch in files it didn't change). `verify` checks what the change
# reaches: `check`, the contract tests every plug-in, recipe and check passes, and the tests its
# changed files reach. The whole suite is `pnpm verify` on your PC, and ci.yml's after the merge.
.PHONY: setup check verify

setup:
	pnpm install --frozen-lockfile

check:
	pnpm format:check && pnpm lint && pnpm typecheck

CONTRACT_TESTS = tests/architecture.test.ts tests/core.test.ts tests/recipes.test.ts tests/checks.test.ts tests/plugins

# The tests a change reaches leave out the contract tests, which ran just before: none runs twice.
verify: check
	pnpm exec vitest run $(CONTRACT_TESTS)
	pnpm exec vitest run --changed origin/main --passWithNoTests $(foreach t,$(CONTRACT_TESTS),--exclude '$(t)$(if $(filter %.ts,$(t)),,/**)')
