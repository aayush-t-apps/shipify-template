---
status: accepted (its plan PR #55 merged 2026-10-02); amended by 0024 (one address)
date: 2026-10-02
---

# 0023: Apps on your own domain: one optional setting, kept out of the code

## Context
Apps live at `<worker>.<subdomain>.workers.dev` (ADR 0007). An owner with a domain on Cloudflare
wants the apps there too, under one name of their choosing (say `apps.example.com`):
- nothing moved, renamed or removed;
- **no domain in the code, the configs or the docs**: the code stays generic, and the domain is a
  setting in the environment;
- nothing else on the domain is touched;
- new apps get a name there by default;
- without the setting, everything stays as it is today.

What reads an app's address today:
- **from `shipify.json` `urls`:** the deploy's health check, staging's browser tests, `ship status`
  and `list`, the registry, and a task's summary;
- **built from the workers.dev subdomain:** the admin page's links and its reads, and the watch;
- **workers.dev only:** previews (version URLs), and `make pause`/`resume`, which switch the
  workers.dev address off and on.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| A Worker Custom Domain makes its own DNS record and certificate, for free, deeper names (`spotter.apps.example.com`) included; 100 per zone | Cloudflare's Custom Domains and Workers limits pages |
| Universal SSL covers the apex and one level only, so a deeper name waits for its own certificate the first time (most within 5 minutes) | Cloudflare's Universal SSL limitations and validation pages |
| Version URLs (our PR previews) run only on workers.dev | Cloudflare's version URLs page |
| A Worker keeps its workers.dev address beside custom domains when `workers_dev` is `true`, as in every app's `wrangler.jsonc` | Cloudflare's wrangler configuration page; the apps' configs |
| Without a terminal (CI), `wrangler deploy` with `custom_domain` routes **replaces** a DNS record that's in the way and **takes** a name from another Worker, without asking. Staging inherits the top-level routes | wrangler 4.143 source (`publishCustomDomains`); workers-sdk `publish-routes.ts` |
| With no custom domains in its config, `wrangler deploy` leaves a Worker's domains alone | the same source |
| Cloudflare's public API attaches a domain from `hostname`, `service` and the zone, and detaches by id | Cloudflare's API reference (Workers → Domains) |
| Attaching or detaching needs "Workers Scripts: Edit" (the API reference) **or** "Zone → Workers Routes: Edit" on the zone (the Workers authorization page) | the two pages disagree, so the deploy token gets both |
| The deploy and read tokens can list the account's zones; the read token can list its Worker domains | read-only calls (2026-10-02) |
| Every pipeline job that deploys, pauses or resumes already exports the repo's variables as environment variables (`main`, `production`, `redeploy`, `ops`) | `pipeline.yml`'s `&vars` step |
| GitHub Free shares organization variables with public repos only, so a private app repo needs its own | GitHub's Actions docs ("organization-level secrets and variables are not accessible by private repositories for GitHub Free") |
| Access set on a Worker covers every domain of that Worker (since 2026-08-14). One Access app holds up to 50 hostnames under one AUD | Cloudflare's Workers Access and Zero Trust limits pages |
| workers.dev sends `X-Robots-Tag: noindex`; a custom domain sends nothing. A `_headers` file adds headers to static files | `curl -I` on a live app; Cloudflare's static assets headers page |
| "Always Use HTTPS" is free and covers every host on the zone | Cloudflare's SSL/TLS page |

## Options

**Where the domain lives**
- **D1, in `shipify.config.json` `vars` and each app's `shipify.json` `urls`.** (+ shown
  everywhere / − the domain is written into the platform repo and every app's repo)
- **D2, an environment setting, `APPS_DOMAIN`, a variable on each app's repo** (the deploy's
  environment), set by `ship publish`. (+ no domain in any file, and unset means today / − Shipify's
  records keep the workers.dev address, which always works; the page and each deploy's summary show
  the domain)

**How a name gets attached**
- **M1, by hand in the dashboard.** (+ no code / − `ship down` leaves it up, and nothing is written
  down)
- **M2, wrangler's `routes` with `custom_domain`.** (+ no code / − in CI it replaces records and
  takes names without asking)
- **M3, the stack's deploy script, through Cloudflare's API, after looking the name up.** (+ never
  replaces anything; one function for deploy, pause and resume / − about 80 lines of the stack's
  script)

**Names under the domain:** `<worker>.<APPS_DOMAIN>`, the Worker's own name, with no exceptions.
The admin page is `shipify.<APPS_DOMAIN>`, like any app.

## Decision
Chosen **D2** and **M3**. The code knows no domain.

- **One optional setting, `APPS_DOMAIN`**, e.g. `apps.example.com`.
  - It's a variable on each app's repo, which is the deploy's environment.
  - Not set: everything stays as today.
  - Set: the app also answers at `<worker>.<APPS_DOMAIN>`, staging at
    `<worker>-staging.<APPS_DOMAIN>`.
- **`ship publish` sets it** on a new app's repo when it has a value, from the credentials file on
  the PC or from the environment. When there's no value, it skips it.
  - The stack lists it under `deploy.optionalVars`, a name only, beside `deploy.vars`.
  - The core gains "optional variables" and no domain.
  - A task that publishes on a box gets the value from a variable on the Shipify repo: `task.yml`
    passes the repo's variables to `ship publish`.
- **The deploy script** (`scripts/shipify/cloudflare.mjs`, stack-owned, so `ship upgrade` brings it):
  - **deploy:** the Worker's custom domains follow `APPS_DOMAIN`.
    - Set: the Worker has exactly `<worker>.<APPS_DOMAIN>`, and other names are detached.
    - Unset: it has none.
    - The zone is the longest zone name in the account that ends the host.
    - For a Worker that exists, the name comes before the new code, so a failed attach changes
      nothing. A brand-new Worker gets its name right after its first upload.
  - **the guard:** before attaching a name that isn't on this Worker yet, the script looks it up in
    public DNS and in the account's Worker domains. If something already answers there (a record of
    yours, or another Worker), the deploy stops and names it. It never replaces anything.
  - **HTTPS:** after attaching, it waits for the name to answer `/health` over HTTPS (up to 10
    minutes), then writes "Live at https://…" to the run's summary.
  - **pause / resume** (`ship down` / `ship up`): the workers.dev address and the custom domain go
    off together, and come back together.
  - **preview and rollback** don't change.
- **workers.dev stays on as the inside address.** Previews, the watch, the deploy's health check and
  Shipify's records keep using it, so they don't depend on the domain.
- **Search engines skip apps, as today:** the stacks' assets folder gets a `_headers` file with
  `X-Robots-Tag: noindex`. Delete it to let an app be indexed.
- **The admin page** (its own PR, change doc 0008): its links show a Worker's custom domain when it
  has one, from one cached read of the account's Worker domains. Its reads and the watch stay on
  workers.dev.
- **Docs** name no domain: `setup.md` gets "Your own domain (optional)", covering:
  - the setting;
  - the token's permission;
  - Always Use HTTPS;
  - Access for the page's name;
  - the domain's renewal under "what expires".

  Also updated: `configuration.md`, `getting-started.md`, and ADR 0007's status ("amended by 0023").
- **Versions:** stacks `ts-worker` and `ts-static` 1.3.0, with `migrations/1.3.0.md`, and Shipify's
  CHANGELOG.

## The migration
Each step leaves everything working, and the workers.dev addresses answer the whole way through.

1. **You merge this plan.**
2. **Shipify PR:** the stacks 1.3.0, optional variables, `task.yml`, docs and tests. Merging it
   changes no live app.
3. **You, once (about 5 minutes):**
   1. Cloudflare → the deploy token → add **Zone → Workers Routes → Edit** for your zone.
   2. Your zone → SSL/TLS → Edge Certificates → **Always Use HTTPS**: on.
   3. Zero Trust → Access:
      - add `shipify.<APPS_DOMAIN>` to the page's sign-in app, unless it protects the Worker itself;
      - add its `/health` and `/.well-known/shipify.json` to the public (Bypass) app.
   4. Put `APPS_DOMAIN=<your name>` in `~/.config/shipify/credentials.env`, and set it as a variable on
      the Shipify repo (for boxes).
4. **The variable on today's apps:** `gh variable set APPS_DOMAIN` on playground, spotter and
   shipify-admin. I run it once you say yes. Nothing changes until each app's next deploy.
5. **playground first (the canary):** `ship upgrade`, a PR, you merge. It answers at
   `playground.<APPS_DOMAIN>`. Then your test: `ship down playground` takes both addresses off, and
   `ship up` brings both back.
6. **spotter:** the same.
7. **The admin page:** `ship upgrade` and the links change, a PR, you merge. Sign in at
   `shipify.<APPS_DOMAIN>`; the watch's next check still sees every app live.
8. **A short `docs/context.md` update.** New apps, the shortener first, get their name by default.

## Edge cases
- **A name that's taken** (a record of yours, or another Worker): the deploy stops before attaching
  and names it. Nothing is replaced. Give the app another `service` name.
- **A name added by hand to a Shipify Worker:** the next deploy detaches it, because the Worker's
  names follow `APPS_DOMAIN`.
- **The setting removed from a repo:** the next deploy detaches the name. The app goes on at
  workers.dev.
- **The setting changed** (another name): the next deploy attaches the new name and detaches the
  old one.
- **The token lacks the zone permission:** the attach fails before the new code goes out, and the
  deploy names the missing permission. The app keeps its version and its addresses.
- **The certificate takes long:** the deploy waits up to 10 minutes, then stops with "not answering
  yet; re-run". The name stays attached, and the re-run finds it.
- **`ship down`:** both addresses go off, and a merge while down deploys nothing (as today).
  **`ship up`:** both come back, waiting for HTTPS in the same way.
- **A rollback:** code only; the name stays.
- **Staging:** its own Worker gets `<worker>-staging.<APPS_DOMAIN>`; `ship release` doesn't change.
- **Previews stay on workers.dev.** Cloudflare's previews on custom domains need a wildcard name
  one level deeper, which may need a paid certificate.
- **The page before Access covers its new name:** the Worker checks the Access token itself, so the
  page shows nothing (it fails closed). Step 3.3 comes first.
- **`http://` requests:** Always Use HTTPS redirects them.
- **The domain lapses:** the apps, the page and the watch carry on at workers.dev.
- **The rest of the domain** (the bare domain, `www`, the `APPS_DOMAIN` name itself): Shipify never
  uses it.
- **A box that publishes without the Shipify repo's variable:** the new app stays on workers.dev
  until its repo gets the variable.
- **A Worker that isn't a Shipify app:** untouched.

## Consequences
- **Easier:**
  - one setting, outside the code, turns the domain on for every app, new ones by default;
  - removing it turns the domain off;
  - a deploy never replaces anything on the domain.
- **Harder:**
  - one more permission on the deploy token;
  - about 80 more lines in the stack's script;
  - Shipify's records show the workers.dev address, while the page and each deploy's summary show
    the domain.

## Confirmation
- Tests run the deploy script against a fake Cloudflare API and fake DNS. They cover:
  - attaching, and leaving an attached name alone;
  - a taken name stops the deploy;
  - other names detached;
  - unset attaches nothing and detaches the old name;
  - pause and resume;
  - the zone found by the longest match;
  - for an existing Worker the name comes before the code, and for a new one after.
- Publish tests: an optional variable set when it has a value, skipped when not.
- `pnpm test:golden`: a fresh app renders exactly as today.
- **The canary:** playground answers at its new name and still at workers.dev, and `ship down` and
  `ship up` work on both.
- **The page:** it signs in at its new name, its `/health` is public, and the status issue stays
  quiet.
