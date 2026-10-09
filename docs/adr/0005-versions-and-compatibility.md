---
status: accepted
date: 2026-09-27
---

# 0005: Semantic versions, changelogs and a compatibility promise

## Decision
- **Projects** start at `1.0.0`. `shipify.json` holds the version (stacks copy it into native files
  such as `package.json` with `make version`), and `CHANGELOG.md` (Keep a
  Changelog) the history. CI tags `vX.Y.Z` and publishes a GitHub Release the first time a
  version ships (apps: after a successful production smoke test; packages: when merged).
  `/health` reports `version` and `commit`.
- **Bump rules:** major for breaking (users or consumers must adapt), minor for new behaviour, patch
  for fixes. `ship version` bumps, and its default comes from pending change docs.
- **Shipify** uses semantic versions too (`package.json`, `CHANGELOG.md`, tags). Stack versions
  (`stacks/<id>/stack.json`) change only in a platform release. Changes collect under
  "Unreleased" and are released in batches.
- **Compatibility:** within a major, `shipify.json`, the `make` verbs and `ship.yml` keep working.
  Majors ship with `stacks/<id>/migrations/<version>.md`, and projects adopt them with
  `ship upgrade` when convenient. The previous major keeps working.
- **Release order:** `pnpm verify`, then the golden tests, then one canary project deployed for real,
  then tag and move `v1`.

## Confirmation
- The PR version check and the release step run in the pipelines.
- `tests/cli.test.ts` covers `version` and `upgrade`.
