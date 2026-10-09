# Stack-owned (Shipify; replaced by `ship upgrade`): the Shipify contract for a TypeScript package.
# CI runs these targets and nothing else. Project-specific targets go in project.mk.
.PHONY: setup check test build verify audit format version
FROZEN := $(if $(and $(CI),$(wildcard pnpm-lock.yaml)),--frozen-lockfile,)

setup:
	pnpm install $(FROZEN)

check:
	pnpm format:check && pnpm lint && pnpm typecheck

test:
	pnpm test

build:
	pnpm build

verify:
	pnpm verify

audit:
	pnpm audit --prod --audit-level high

format:
	pnpm format

version:
	node scripts/shipify/version.mjs

-include project.mk
