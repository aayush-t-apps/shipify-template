---
status: accepted (the owner asked for it, 2026-10-02; merging its PR accepts it)
date: 2026-10-02
---

# 0024: One address: an app lives where its record says, and with your own domain workers.dev is off

## Context
ADR 0023 put apps on the owner's own domain and kept workers.dev on beside it, as the address
Shipify itself reads. The owner wants one address per app:
- no second public copy of each app;
- the watch checking what people use (on workers.dev, a broken name on the domain went unseen);
- one host for an app's public Access paths;
- no stale addresses in Shipify's records.

The domain stays out of Shipify's code and docs, and setups without a domain stay as they are.

## Decision
- **An app lives where its `shipify.json` `urls` say.** That record is the one truth for:
  - the deploy;
  - its health check;
  - staging's browser tests;
  - the watch, the page and `ship status`;
  - a task's reply.

  It's the app's own data, as its workers.dev URL is today. Shipify's project index stays local.
- **URL templates can be lists:** the first whose variables are all set wins. The stacks list
  `https://{{SERVICE_NAME}}.{{APPS_DOMAIN}}`, then the workers.dev one.
  - `APPS_DOMAIN` comes from a stack's `deploy.optionalVars`: `shipify.config.json` `vars`, then the
    credentials file or the environment. So it's the owner's `credentials.env` on the PC, and the
    shipify repo's variable in a task.
  - New apps get it. `ship upgrade` never changes an app's URLs.
- **The deploy script reads the host from the URL** (stacks 1.4.0):
  - **An own name:** it's attached, as in 0023, and workers.dev is off in the config the deploy
    uses.
  - **A workers.dev URL:** no custom domain, and workers.dev on.
  - **Pause and resume** take everything off, then bring back the same state.
- **Previews stay on workers.dev,** only while a PR asks for one (a Cloudflare limit).
- **The admin Worker** (its own PR) reads each Worker at its own name when it has one. A Worker
  counts as on when its workers.dev URL is on or it has a custom domain.
- **Dropped from 0023:**
  - the `APPS_DOMAIN` repo variable on each app, since the deploy no longer reads it;
  - `ship publish` setting it.

  The shipify repo keeps its variable, for apps a task makes.
- **An app's README** shows its URLs from the record (`{{URL_PRODUCTION}}`, `{{URL_STAGING}}`).
- **Access:** the sign-in on a Worker covers every address it has. The Bypass app lists
  `/health` and `/.well-known/shipify.json` on the app's host.

## The migration
Each step changes one thing, and the owner merges each PR.

1. **This PR:** the stacks 1.4.0, URL lists, docs and tests. It changes no live app.
2. **The admin page's Bypass app** gets the new host's two paths beside the workers.dev ones (four
   rows): the page in use today still reads workers.dev.
3. **shipify-admin:** reads each Worker at its own name; its own URL moves to its name; then the
   upgrade to 1.4.0. After its deploy, the two workers.dev Bypass rows go.
4. **playground, then spotter:** each URL moves to its name, then the upgrade to 1.4.0. Each
   deploy turns workers.dev off.
5. **The apps' `APPS_DOMAIN` variables are deleted,** and `docs/context.md` is updated.

## Edge cases
- **The domain lapses or its DNS breaks:** the apps on it are down, and the watch alerts. To come
  back without it, move the URLs back to workers.dev.
- **A task makes an app on a box without the shipify repo's variable:** the app gets a workers.dev
  URL. Move it like any other.
- **`ship staging on` without `APPS_DOMAIN` set** gives a workers.dev staging URL; set it first.
- **An app upgraded to 1.4.0 with a workers.dev URL but a name attached by 1.3.0:** its next deploy
  takes the name off, as the record says. Move the URL before upgrading.
- **The admin's own reads** go through its Access Bypass paths on its name, as the deploy's health
  check does.
- **The guard, the HTTPS wait and a rollback** work as in 0023.

## Consequences
- **Easier:**
  - one address per app, in one place, shown everywhere;
  - the watch sees what people see;
  - Access has one host per app.
- **Harder:**
  - a domain that lapses takes its apps down, until it's renewed or their URLs move back;
  - previews still use workers.dev.

## Confirmation
- `tests/domain.test.ts`, run against a fake API:
  - attach with workers.dev off;
  - a workers.dev URL leaves no custom domain and workers.dev on;
  - pause and resume;
  - the guard, and the order.
- `tests/cli.test.ts`:
  - `ship new` with `APPS_DOMAIN` gives the own-domain URLs, staging included;
  - without it, workers.dev;
  - the README shows the record's URL.
- `pnpm test:golden`: fresh apps without a domain render as before.
- **Live, step by step:** each app answers only at its name, and its workers.dev URL gives 404. The
  watch stays quiet, and the page shows every app live.
