---
status: accepted
date: 2026-09-27
---

# 0006: Security baseline for every project, update and package

## Decision
- **Credentials:**
  - The PC's GitHub token is fine-grained and reaches only the org `aayush-t-apps` (no account
    access).
  - Host tokens stay on the PC or in repository secrets. For the Cloudflare stacks: `tapp-read`
    (read-only: the Shipify page) and `tapp-deploy` (only as a repo
    secret, copied from the local file via stdin, never printed).
  - Secret values never go in files, plans, manifests or logs.
- **CI:**
  - Default `permissions: contents: read`. Write only where needed: tags and releases, commit
    statuses, PR comments.
  - Actions pinned to commit SHAs, and gitleaks pinned by version plus SHA-256.
  - No `pull_request_target`. Forks and Dependabot get no secrets and no previews.
  - Every run does a **secret scan** (gitleaks), a **dependency audit** (`make audit`; the
    TypeScript stacks run `pnpm audit --prod`, high
    and above) and `make verify`.
- **Supply chain:** exact dependency pins at least 2 days old (pnpm's 24-hour minimum release age),
  a frozen lockfile, and Dependabot monthly.
- **Runtime:** logs redact sensitive keys, errors return a request id and not a stack, and
  `/health` and `/.well-known/shipify.json` expose only non-secret facts.
- **Operations:**
  - External writes need `--yes`, and the platform has no delete path.
  - The production branch is guarded by a pre-push hook and CI checks.
  - Paths and names are validated against traversal.

## Consequences
One leaked PC token can't touch personal repos. A compromised dependency has to survive a day of
public scrutiny first.

## Confirmation
- The pipeline steps above.
- `ship validate` (secret-looking values, `.gitignore`).
- `tests/safety.test.ts`.
