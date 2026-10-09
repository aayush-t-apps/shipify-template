# {{APP_NAME}}

{{APP_DESCRIPTION}}

A Shipify {{KIND}}. `AGENTS.md` describes how it is built, tested and shipped.

## What it is, and its history

- `docs/spec.md`: what it does now.
- `docs/changes/`: why, one change doc per feature.
- `CHANGELOG.md` plus the `vX.Y.Z` tags and GitHub Releases: what shipped when.

## Develop

```sh
make setup
make verify     # everything CI runs
```
