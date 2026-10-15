# Stack-owned (Shipify; replaced by `ship upgrade`): the Shipify contract for a TypeScript app on
# Cloudflare Workers. CI runs these targets and nothing else. The Cloudflare side of deploy, preview,
# rollback, pause and resume is scripts/shipify/cloudflare.mjs. Project-specific targets go in
# project.mk.
.PHONY: setup dev check test build verify audit format e2e deploy preview bundle preview-from unpreview rollback pause resume version
export WRANGLER_SEND_METRICS := false
FROZEN := $(if $(and $(CI),$(wildcard pnpm-lock.yaml)),--frozen-lockfile,)
# The browser for the end-to-end tests, and on CI the system packages it needs.
BROWSER := pnpm exec playwright install $(if $(CI),--with-deps,) chromium
# On GitHub's machines the pipeline sets SHIPIFY_NO_BROWSER=1 (ADR 0018): the box ran the browser
# tests before the PR (`ship pr` runs make verify), so a merge checks without a browser and never
# downloads one. make e2e gets its own browser when it runs (a preview, staging).

setup:
	pnpm install $(FROZEN)
	$(if $(SHIPIFY_NO_BROWSER),@echo "No browser here (SHIPIFY_NO_BROWSER): the box ran the browser tests before the PR.",$(BROWSER))

# A D1 app's local database gets its migrations first (scripts/shipify/cloudflare.mjs local).
dev:
	node scripts/shipify/cloudflare.mjs local
	pnpm dev

check:
	pnpm format:check && pnpm lint && pnpm typecheck

test:
	pnpm test

build:
	pnpm build

verify:
	pnpm $(if $(SHIPIFY_NO_BROWSER),verify:unit,verify)

audit:
	pnpm audit --prod --audit-level high

format:
	pnpm format

e2e:
	$(BROWSER)
	E2E_BASE_URL="$(SHIPIFY_BASE_URL)" pnpm test:e2e

# deploy and preview build first: they upload exactly this commit's assets and Worker.
deploy preview: build
	node scripts/shipify/cloudflare.mjs $@

unpreview rollback pause resume:
	node scripts/shipify/cloudflare.mjs $@

# A PR's preview, in two jobs (ADR 0030 §0): the PR's code bundles itself into $(SHIPIFY_BUNDLE)
# with no keys (make bundle); then, on a fresh runner, main's checkout uploads that bundle from
# $(SHIPIFY_BUILT) with this reviewed script and its tools (make preview-from). Nothing of the PR's
# runs where the deploy key is.
bundle: build
	node scripts/shipify/cloudflare.mjs bundle

preview-from:
	node scripts/shipify/cloudflare.mjs preview

version:
	node scripts/shipify/version.mjs

-include project.mk
