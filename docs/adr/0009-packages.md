---
status: accepted
date: 2026-09-27
---

# 0009: Packages are repos released as code; no registry for now

## Decision
- `kind: package` projects (stack `ts-package`) follow the same contract.
- "Ship" means CI tags `vX.Y.Z` and publishes a GitHub Release with the changelog section, when a
  new version lands on `main`.
- Consumers pin a tag (for example `pnpm add github:aayush-t-apps/<id>#v1.2.0`). Private packages
  need git access, which the PC has through `gh`.
- A registry (npm, GitHub Packages, PyPI) can be added later as a publish step in
  `pipeline.yml` without changing packages.

## Consequences
No tokens and no registry accounts. Installing a private package from another project's CI would
need a read token, which we'll decide when the first consumer exists.

## Confirmation
The golden tests run `ts-package`, and the package pipeline tags on merge.
