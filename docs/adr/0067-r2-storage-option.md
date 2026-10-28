---
status: accepted (task #586, part of #584; the owner merged it and said `go`)
date: 2026-10-28
amends: 0022 (the `_cloudflare` layer offers a third option, `r2`)
---

# 0067: An `r2` storage option for Cloudflare apps: a bucket named and made by the deploy

## Context
Apps can keep small data (KV, D1; ADR 0022) but not files. #584 wants a small file store on
Cloudflare, and its next part (#587, a Drop tool that shares files and folders by link) needs
object storage with expiry. R2 is Cloudflare's object store, and it fits ADR 0022's shape:

- a binding in `wrangler.jsonc`, a name the deploy finds or makes, local storage for tests;
- no core change: the core names no host (ADR 0010), and options are stack data.

## Assumptions, checked
Each row is checked again during the build, against the fake API and Cloudflare's docs.

| Assumption | How it was checked |
|---|---|
| A bucket has a name, not an id, so `r2_buckets: [{ binding, bucket_name }]` needs no filling in at deploy | Wrangler's config docs |
| The API lists buckets (`GET /accounts/{id}/r2/buckets`), makes one (`POST`, body `{ name }`) and sets lifecycle rules (`PUT /accounts/{id}/r2/buckets/{name}/lifecycle`, body `{ rules }`, each rule `{ id, enabled, conditions: { prefix }, deleteObjectsTransition: { condition: { type: "Age", maxAge } } }`). `maxAge` is in seconds | Cloudflare's R2 API and lifecycle docs (web search, 2026-10-28); the build checks the unit |
| `getPlatformProxy({ persist: false })` gives a local R2 bucket from `r2_buckets`, as it does KV and D1, so `tests/unit/support/bindings.ts` needs no change | ADR 0022 used it for KV and D1; the build runs it |
| Free plan: 10 GB stored, 1 million writes and 10 million reads a month, no egress fee | Cloudflare's R2 pricing page (2026) |
| The deploy token needs **Workers R2 Storage: Edit**; the "Edit Cloudflare Workers" template lacks it | Cloudflare's permissions reference |
| **R2 asks for a payment method on the account the first time it is turned on**, even inside the free limits | Cloudflare's R2 setup docs and guides (web search; not yet seen on this account) |

The last row touches the rule "Free only". Nothing is charged inside the free limits, and an app
can't go over by itself without the owner's account allowing it, but the owner must add a card to
Cloudflare once. See Consequences.

## Options
- **A: wrangler's own provisioning** (`bucket_name` made on deploy). (+ no code / − no lifecycle
  rules, and ADR 0022 found its naming and CI behaviour unreliable)
- **B: the deploy script finds or makes the bucket and sets its rules**, as it does for KV and D1.
  (+ the same result from any checkout, rules kept in the repo / − about 40 lines more in the
  stack's script)
- **C: a bucket made by hand, name committed.** (+ plain / − a manual step per app and environment)

## Decision
Chosen **B**, as a third option of the `_cloudflare` layer: ts-worker and ts-static both get it.

- **The option.** A plan says `options: [r2]` (or `[kv, d1, r2]`). The binding is `R2`
  (`R2Bucket` in `interface Env`). `wrangler.jsonc` gets `"r2_buckets": [{ "binding": "R2",
  "bucket_name": "<worker>-r2" }]`, and staging's `<worker>-staging-r2` (the same `OPTION_R2` and
  `OPTION_R2_STAGING` conditionals as KV and D1). `layer.json` lists `r2`, `storage.md` gains
  its row and steps.
- **The rules.** The app's lifecycle rules are one app-owned file, `r2-lifecycle.json`, a map of
  prefix to days: `{ "tmp/": 7, "exports/": 30 }`. A new app gets `{}`. The file is the whole
  set: each deploy replaces the bucket's rules with it (one rule per prefix, id `expire-<prefix>`),
  so a removed line removes the rule. An absent file leaves the bucket's rules alone. A prefix may
  not be empty (that would expire everything), and days are whole numbers from 1.
- **`cloudflare.mjs`.**
  - **deploy:** lists the account's buckets, makes `<worker>-r2` when it is missing, then sets the
    rules from `r2-lifecycle.json`, then deploys. No id is needed, so the filled-in config copy is
    unchanged for R2.
  - **preview:** an app with R2 counts as keeping data (like KV and D1): no preview without
    staging, and staging's bucket otherwise. The message says "(KV, D1 or R2)".
  - **local:** nothing to apply; `wrangler dev` and the tests use a local bucket in `.wrangler/state`.
  - **rollback, pause, resume:** code and URLs only; the objects stay.
- **Tests.** `tests/storage.test.ts` gains: bucket made, then found; rules set from the file;
  an invalid file stops the deploy before anything changes; staging's own bucket; no preview
  without staging. The new app's unit test writes and reads an object through `env.R2`.
- **Docs.** `docs/setup.md` names the token permission **Workers R2 Storage: Edit** (with KV and D1)
  and says R2 needs a card on the account once. `storage.md`, `docs/troubleshooting.md` (the
  token error) and `docs/plug-ins.md` (the option list, if it names them) are updated; the stack
  version and `CHANGELOG.md` move; a migration note says an upgrade changes nothing for an app
  that took no option.

## Edge cases
- **The token lacks the permission:** the deploy stops before anything changes and names
  "Workers R2 Storage: Edit".
- **R2 isn't turned on for the account:** Cloudflare refuses (the card step); the deploy says to
  turn R2 on once in the dashboard, then re-run.
- **The bucket name is taken or invalid:** names are `<worker>-r2`, lower case, 3 to 63 characters;
  a longer worker name stops the deploy with that message. A name is unique only per account.
- **A bad `r2-lifecycle.json`:** invalid JSON, an empty prefix, or days that aren't whole numbers
  of 1 or more stops the deploy before any change.
- **An object is older than a new rule's days:** Cloudflare removes it on its next lifecycle pass
  (up to a day later). Lifecycle is a clean-up, not a promise of the exact time; an app that must
  hide an object at a time checks its own timestamp.
- **A rollback:** code only; objects and rules stay.
- **An app that took no option:** nothing changes for it.

## Consequences
- **Easier:** a file store is one plan line; the bucket, its name and its expiry come with the
  deploy; tests use a real local bucket. #587 can build on it.
- **Harder:** the deploy token needs one more permission, and the owner adds a card to Cloudflare
  once (no charge inside the free limits). The bucket is never deleted by Shipify: taking an app
  down leaves its data, as KV and D1 do.
- **Open for the owner:** is the card on file acceptable under "Free only"? If not, this option
  must wait. The ADR assumes yes, since the owner asked for R2 by name in #584.

## Confirmation
- `tests/storage.test.ts` (the cases above) against the fake Cloudflare API and fake wrangler.
- `pnpm test:golden`: an app without options is unchanged.
- A generated ts-worker app with `options: [r2]` passes `make verify`, and its deploy against the
  fake API makes its bucket (the task's "done when").
