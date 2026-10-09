---
status: accepted
date: 2026-09-27
---

# 0002: One repo per project; state lives only in git, GitHub and the host

## Decision
- `shipify` (private) holds the CLI, stacks, presets, reusable workflows, guides, plans and registry.
- Every project is its own repo in the org `aayush-t-apps` with a plain name (`spotter`,
  `shipify-admin`) and is independent: it installs, verifies and ships without the platform
  checkout (its pipeline is fetched from `shipify@v1` by GitHub).
- There's no Shipify server or database. `registry/projects.json` is an index that
  `ship reconcile` rebuilds from manifests.
- Locally: `t-apps/shipify` and `t-apps/projects/<id>`.

## Consequences
Nothing to host or back up. Deleting the platform checkout never breaks a running project.

## Confirmation
`ship reconcile` rebuilds the index, and the project CI runs from the project repo alone.
