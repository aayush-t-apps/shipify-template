---
status: accepted; amended by 0023 (your own domain, optional)
date: 2026-09-27
---

# 0007: Hosting defaults: Cloudflare Workers with static assets, on workers.dev

The default stacks (`ts-worker`, `ts-static`) host this way. Since ADR 0010 it is their choice, in
`stacks/_cloudflare`, not the platform's; other stacks host elsewhere.

## Decision
- Apps are Workers with static assets on `<id>.<subdomain>.workers.dev`. Static requests are free
  and unlimited; code runs only for `/health`, `/.well-known/shipify.json` and `/api/*`.
- Staging is optional (default off). With staging, the `-staging` Worker has its own data, and
  PR previews run on it.
- Pause and resume switch the workers.dev URL off and on. Rollback by tag finds the version whose
  deploy message is `release vX.Y.Z <sha>`.
- Worker runtime secrets travel with each version (`--secrets-file`).
- All of it is `scripts/shipify/cloudflare.mjs`, behind `make deploy | preview | rollback | pause |
  resume`. Other hosts are other stacks (ADR 0010).

## Consequences
$0 hosting, 100 Workers per account (1 per app, 2 with staging), and 100,000 code requests a day
(the Shipify page shows usage).

## Confirmation
The smoke test after every deploy checks `/health` `commit`.
