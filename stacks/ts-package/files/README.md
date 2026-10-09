# {{APP_NAME}}

{{APP_DESCRIPTION}}

A Shipify **package**: it ships as code. Each release is a git tag `vX.Y.Z` plus a GitHub Release
with its changelog. There's no registry.

## Use it

Pin a release tag from another project:

```sh
pnpm add github:{{GH_OWNER}}/{{REPO_NAME}}#v0.1.0
```

Private repos need git access, which you already have locally through `gh`.

## Develop

```sh
make setup
make verify     # format, lint, types, tests (80% coverage), build
```

History: `docs/spec.md` (what it is), `docs/changes/` (why), `CHANGELOG.md` (what shipped when).
