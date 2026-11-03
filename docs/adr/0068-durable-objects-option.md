---
status: accepted (task #615, part of #613; the owner merged it and said `go`)
date: 2026-10-30
amends: 0022 (the `_cloudflare` layer offers a fourth option, `do`)
---

# 0068: A `do` option for Cloudflare apps: Durable Objects declared in `exports`, add-only, no PR previews

## Context
Apps can keep data in KV, D1 and R2 (ADR 0022, 0067), but they can't hold live state or
WebSockets. #613 wants online game rooms: devices connect to one room by WebSocket, the room
relays moves and keeps a snapshot, and one hub keeps scores (the games plan, section 8, in task
#613's files). On Cloudflare that is a Durable Object (DO): one small object per room, with its
own SQLite storage, that sleeps between messages (hibernation) and costs nothing while it sleeps.

A DO is code in the app's own Worker, not a resource beside it. That makes it different from KV,
D1 and R2 in four ways, which this ADR decides:

1. **How the classes are declared.** Cloudflare needs to know each class and its storage before
   it runs it. Until June 2026 that was the `migrations` array (`new_sqlite_classes`, with tags).
   Wrangler 4.107 added a declarative `exports` map, and Cloudflare now calls `migrations`
   "legacy".
2. **PR previews.** Cloudflare makes no version URLs for a Worker that implements a DO, so the
   stack's preview (a version of the Worker, `--preview-alias pr-<n>`) can't work.
3. **Rollbacks.** Cloudflare refuses a rollback across a change to the DO classes.
4. **Local tests.** `getPlatformProxy`, which gives the unit tests KV, D1 and R2, can't run a DO
   that the same Worker defines.

## Assumptions, checked
Each row is checked again during the build, against the fake API and Cloudflare's docs.

| Assumption | How it was checked |
|---|---|
| `exports: { "<Class>": { "type": "durable-object", "storage": "sqlite" } }` declares a class; Cloudflare compares it with what is deployed and makes, renames or deletes what changed. `exports` and `migrations` can't be in one Worker, and a Worker that moved to `exports` can't go back | Cloudflare's DO migrations docs and changelog (2026-06-30); web, 2026-10-30 |
| `exports` needs wrangler 4.107 or later; the stacks pin 4.149.0 | wrangler's release notes; Shipify's own copy (4.142.0) has `exports` in its config schema |
| `wrangler dev` and `unstable_startWorker` read `exports`, and run the DO locally with SQLite storage and WebSockets | **Run on this box** (arm64, wrangler 4.142.0): a Worker with one class in `exports`, started by `unstable_startWorker({ dev: { persist: false } })`, kept SQLite rows between two requests and echoed over a hibernating WebSocket |
| `getPlatformProxy` runs a DO only from another Worker (`script_name`), never one the same Worker defines | Wrangler's API docs |
| `@cloudflare/vitest-pool-workers` (0.23.0) needs Vitest 4; the stacks use Vitest 5 | npm, 2026-10-30 |
| No version URLs for a Worker that implements a DO, so no previews | Cloudflare's preview URLs docs |
| `wrangler versions upload` doesn't apply class changes, and gradual deployments don't work with `exports`: only `wrangler deploy` does | Cloudflare's DO migrations docs |
| A rollback can't cross a change to the classes | Cloudflare's rollbacks docs |
| A deploy restarts every DO of the Worker and closes their WebSockets; clients reconnect | Cloudflare's DO docs on WebSockets |
| Free plan: only SQLite-backed DOs; 100,000 requests and 13,000 GB-s a day, 5 million rows read and 100,000 written a day, 5 GB stored. A sleeping DO bills no duration. No card is needed | Cloudflare's DO pricing page (2026-10-30) |
| DOs have no permission of their own: they take the Worker's, so the deploy token's **Workers Scripts: Edit** covers them | Cloudflare's Workers permissions docs; first seen live at the first DO app's deploy |

The last row answers the plan's question about the token: no new permission, no new setup step.

## Options

**How the classes are declared**
- **A: `exports`** (+ declarative, the whole set in one place, like `r2-lifecycle.json`; Cloudflare
  names what changed at each deploy; the way Cloudflare now documents / − newer, June 2026)
- **B: `migrations` with `new_sqlite_classes`** (+ older, in every example and guide / − an
  ordered list of tags that only grows; Cloudflare calls it legacy, so a later move to `exports`
  would be a second change, and the owner wants one switch-over)

**PR previews**
- **A: none for an app with `do`.** The preview step says so; review is with `make dev`
  locally, then on staging after the merge. (+ nothing new / − no link on the PR)
- **B: a companion Worker per PR** (`<worker>-pr-<n>`, deployed with `wrangler deploy` and its
  own DOs, deleted when the PR closes). (+ a link on the PR / − a Worker made and deleted per PR,
  more calls and clean-up, a deploy key that can create and delete Workers, and a second path
  through `cloudflare.mjs` for one kind of app)

**Local tests**
- **A: the whole Worker, started by wrangler's own `unstable_startWorker`**, in a stack-owned
  helper. (+ no new dependency; the real code path, with routes, DOs, SQLite and WebSockets / −
  the code runs in workerd, so Node's coverage can't count it; about a second to start, once per
  test file)
- **B: `@cloudflare/vitest-pool-workers`** (+ the tests run inside workerd / − needs Vitest 4, a
  downgrade; a second test setup beside the stack's)
- **C: fake `ctx` objects in Node** (+ fast / − not the runtime: no real SQLite, hibernation or
  WebSockets; `cloudflare:workers` doesn't load in Node)

## Decision
Chosen: **`exports`**, **no previews** for an app with `do`, and **the whole Worker** for local
tests. The option is on the `_cloudflare` layer, so ts-worker and ts-static both get it. No core
change: an option is stack data (`layer.json` and `OPTION_DO` in the templates).

- **The option.** A plan says `options: [do]` (or with others, `[do, d1]`). `layer.json` lists
  `do`: "Durable Objects: live state and WebSockets in your own Worker, one object per room, chat
  or counter, each with its own SQLite storage. Free: 100,000 requests and 13,000 GB-s a day,
  SQLite only."
- **A new app** gets one starter class, `Counter` (binding `COUNTER`), with a test, to rename or
  replace before its first deploy:
  - `wrangler.jsonc`: `"durable_objects": { "bindings": [{ "name": "COUNTER", "class_name":
    "Counter" }] }` and `"exports": { "Counter": { "type": "durable-object", "storage": "sqlite"
    } }`, the same in `env.staging` with staging (`OPTION_DO`, `OPTION_DO_STAGING`). Bindings
    aren't inherited by an environment; the build checks whether `exports` is, and writes it once
    if it is.
  - `src/worker/objects/index.ts` (app-owned): exports every DO class, and only those.
    `src/worker/objects/counter.ts`: `Counter extends DurableObject`.
  - `src/worker/index.ts` (stack-owned) gains `export * from "./objects";` under `OPTION_DO`.
    The runtime treats each named export of the entry as an entrypoint, which is what a DO class
    must be, so the classes come only through that one line, and `app.ts` stays as it is.
  - `src/worker/app.ts`: `COUNTER: DurableObjectNamespace<Counter>;` in `interface Env`, and a
    route that uses it.
- **Classes are add-only**, as D1's migrations are. A deploy may add a class; it never renames or
  deletes one. `cloudflare.mjs deploy` reads `exports` (top level and staging's) before it changes
  anything, and stops when:
  - an entry has `"state": "deleted"` or `"state": "renamed"` ("Classes only add (ADR 0068):
    deleting a class deletes its data, and a rollback can't cross it");
  - an entry's `storage` isn't `"sqlite"` (the free plan has SQLite only);
  - the file has `migrations` (one way, `exports`).

  A class the app no longer uses stays exported: a DO that nobody calls costs nothing. Renaming
  or deleting one is a change of its own, by hand, if ever needed.
- **`cloudflare.mjs`.**
  - **deploy:** the checks above, then `wrangler deploy` as now. Wrangler applies `exports`; no
    API call of Shipify's own, no id to fill in.
  - **preview:** an app with DOs gets none, with staging or without: "No preview: this app has
    Durable Objects, and Cloudflare makes no preview URLs for them. Try it with `make dev`, or on
    staging after the merge." It returns before any upload. The PR shows that line, as it does
    now for an app that keeps data and has no staging.
  - **bundle:** unchanged (no preview reads it).
  - **rollback:** unchanged. Across an added class Cloudflare refuses; the step passes on its
    message, and `storage.md` says why: roll forward instead (a fix as a new PR).
  - **pause, resume:** URLs only; the DOs and their data stay.
  - **local:** nothing to do; `wrangler dev` reads `exports`.
- **WebSockets and deploys.** A deploy (and a rollback) closes every socket. The stack's
  `AGENTS.md` says an app with `do` must reconnect by itself (with backoff) and keep what it needs
  in the DO's storage, not only in memory. Shipify adds no drain step.
- **Tests.** `tests/unit/support/worker.ts` (stack-owned) gives `localWorker()`: the app's Worker
  from `wrangler.jsonc`, started by `unstable_startWorker` with `persist: false`, so every run
  starts empty, with `fetch`, `url` (for a WebSocket) and `dispose`. `localBindings()` keeps KV,
  D1 and R2, and leaves DO bindings out (the build checks that it doesn't fail on them). The new
  app's test calls the counter's route twice and gets 1, then 2. `vitest.config.ts` leaves
  `src/worker/objects/**` out of the coverage count, since that code runs in workerd: logic that
  needs branch tests goes in plain modules beside it, which Node counts.
- **Shipify's own tests.** `tests/storage.test.ts` gains: a `do` app deploys with `exports`; a
  `deleted` or `renamed` entry, a non-SQLite class or a `migrations` array stops the deploy before
  any change; no preview with staging or without; staging's own `exports`. `pnpm test:golden`
  keeps an app without options unchanged.
- **Docs.** `storage.md` (its title, the table, the steps to add `do` to an existing app, a
  "Durable Objects" section: add-only, sockets close on deploy, no previews, rollbacks),
  both stacks' `AGENTS.md` (an `OPTION_DO` part under Storage), `guides/plan-template.md` (the
  option list), `docs/troubleshooting.md` (the add-only stop, and a rollback refused after a
  new class), `docs/setup.md` (DOs need no other permission), `CHANGELOG.md`, both
  `stack.json` versions, and a migration note per stack (nothing changes for an app without
  `do`). This ADR's row in `docs/adr/README.md` moves to accepted.

## Edge cases
- **An app adds `do` later:** the steps in `storage.md`; from then on its PRs have no preview,
  and the PR that adds it says so.
- **The first deploy with a new class:** Cloudflare makes its namespace; nothing to set up.
- **A rollback after a new class:** refused by Cloudflare; roll forward.
- **A class in code but not in `exports`, or the other way:** not checked yet. The build tries it
  against wrangler and adds a check of its own if wrangler doesn't stop the deploy.
- **A deploy mid-game:** the sockets close; clients reconnect and read the room's stored state.
- **Over a free limit:** calls fail until 00:00 UTC; nothing is billed.
- **An app that took no option:** nothing changes for it.

## Consequences
- **Easier:** live state and WebSockets are one plan line, at no cost and with no card; the deploy
  needs no new code path or permission; tests run the real Worker. #616 can build on it.
- **Harder:** apps with `do` lose PR previews, and their DO code runs outside Node's coverage
  count. Classes only grow. Each deploy closes live sockets.
- **Open for the owner:**
  1. **No previews** for DO apps (review with `make dev`, then staging): fine, or is a companion
     Worker per PR worth its cost?
  2. **`exports` over `migrations`:** the task's words named `new_sqlite_classes` migrations;
     this ADR picks Cloudflare's newer `exports`, for the reasons above.

## Confirmation
- `tests/storage.test.ts` (the cases above) against the fake Cloudflare API and fake wrangler.
- `pnpm test:golden`: an app without options is unchanged.
- A generated ts-static app with `options: [do]` passes `make verify` on a box, its counter test
  included (the task's "done when" for the build).
