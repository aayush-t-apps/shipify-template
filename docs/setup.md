# Setup: what's where, and what expires

Every account, machine, key and setting Shipify uses: where it lives, when it expires, and how to
replace it. Setting up from nothing: `pnpm ship setup` walks it ([getting-started.md](getting-started.md)).

- **Check:** `pnpm ship doctor` (this machine), `pnpm ship box list` (the boxes, the bot, the
  agent's login), `pnpm ship door check` (the edge).
- **Never** print, paste into a chat, or ask for a key's value. Keys go in at hidden prompts.
- **Every setting by name:** [configuration.md](configuration.md). **Why each key is scoped as it
  is:** [security.md](security.md).

## The pieces

| Piece | For | Set up with |
|---|---|---|
| **This PC** (Linux, or WSL) | `pnpm ship`, the agent in a terminal | [This PC](#this-pc) |
| **A GitHub account** (yours, or an org's) and **your copy**, `shipify` | the record, the queue, every project's repo | [GitHub](#github) |
| **The template** your copy was made from | each new Shipify version, as a PR | [releases.md](releases.md) |
| **Cloudflare** (a domain is optional) | apps and the edge, as Workers | [Cloudflare](#cloudflare) |
| **The bot** (a GitHub App) and **the agent's login** | runs' tokens, PRs, the agent | `pnpm ship bot --yes` ([below](#tasks-the-bot-and-the-agents-login)) |
| **Boxes** (a Pi, a VPS, this PC) | running tasks | `pnpm ship box add [<user@host>] --yes` ([box-setup.md](box-setup.md)) |
| **The edge** and **the door App** | your chats, replies out, the watch | `pnpm ship door setup --yes` ([below](#the-edge)) |
| **Plug-ins** (Notion, Drop, Telegram, the web chat) | your tools, your phone | `pnpm ship add <name> --yes` ([below](#plug-ins)) |
| **A gateway** (OpenRouter, Vercel's AI Gateway), if you want pi or OpenCode | other agents' models | `pnpm ship add openrouter --yes` or `pnpm ship add vercel-ai-gateway --yes` ([below](#plug-ins)) |
| **The repos App**, for your other accounts | reads and PRs on another account (ADR 0045) | `pnpm ship bot repos --yes` ([below](#another-account-the-repos-app)) |

## This PC

1. **WSL with systemd on** (Windows only): `/etc/wsl.conf` has `[boot]` `systemd=true`, then
   `wsl --shutdown` from Windows.
2. **Tools:** Node 22, pnpm through corepack (`corepack enable --install-directory ~/.local/bin`,
   with `~/.local/bin` on your `PATH`), `gh` and git 2.26 or newer: that's all the core needs (a
   box installs its own agent). To build apps on this PC too, each stack adds its own, which
   `pnpm ship doctor` lists: `make`, and for the TypeScript stacks
   `sudo npx -y playwright@1.64.0 install-deps chromium` once.
3. **The GitHub login:** the token `shipify-pc` ([Tokens and secrets](#tokens-and-secrets)). Run
   `gh auth login` and paste it, then `gh config set git_protocol https -h github.com` and
   `gh auth setup-git`.
4. **The credentials file,** `~/.config/shipify/credentials.env`, `chmod 600`, `NAME=value` lines.
   Make it with `mkdir -p ~/.config/shipify && install -m 600 /dev/null
   ~/.config/shipify/credentials.env`. It holds this PC's copies of your settings and keys (the
   ones [settings.md](settings.md) says live on "this PC"): `ship setup`, `ship door setup` and
   `ship add` put them there. The door App's key is never kept here.
5. **The code:** a folder of your choice holding `shipify/` (your copy: `git clone
   https://github.com/<you>/shipify.git`, then `pnpm install`) and `projects/`, which
   `pnpm ship sync` fills with every project.
6. **Your settings,** as variables on your copy's repo (ADR 0047): your time zone
   (`SHIPIFY_TIME_ZONE`), which `ship setup` asks for, and each value a stack deploys with
   (`CLOUDFLARE_ACCOUNT_ID`, `CF_WORKERS_SUBDOMAIN`), which `pnpm ship setup apps` finds with your
   deploy token and sets; the owner and the repo's name are your copy's own, never typed. Every
   setting there is: [settings.md](settings.md).
7. **Your phone:** the GitHub app for approvals; Telegram or the web chat once it's added.

## GitHub

- **Your own account, or an organization** (the free plan is enough). An organization, with:
  - fine-grained tokens allowed and classic ones restricted (approve your own `shipify-pc` if asked);
  - OAuth apps restricted;
  - Actions → General → Workflow permissions: **Read repository contents**, and "Allow GitHub
    Actions to create and approve pull requests" **off**.
- **Your copy,** `<you>/shipify`, private: on the Shipify template, **Use this template** →
  **Create a new repository**. It starts clean at the template's newest version, with no history,
  and takes each new one as a PR ([releases.md](releases.md)). Clone it on this PC. Each project it
  builds carries its own pipeline, so nothing else is needed on GitHub (ADR 0048).
- **Each project's repo** gets its settings from `ship publish`.
- **Actions minutes:** private repos get 2,000 a month. What uses them: [the README](../README.md#costs).

## Cloudflare

- **Your workers.dev subdomain:** pick it once in Workers & Pages, a domain or not: the edge is
  always at its workers.dev address too, and `door setup` stops until there is one. Your **account ID**
  (`CLOUDFLARE_ACCOUNT_ID`) and this name are found with the deploy token when this PC lacks them
  (`door setup` and `pnpm ship setup apps` both do).
- **A domain on Cloudflare** (optional), and a name under it for your apps: `APPS_DOMAIN` (say
  `apps.example.com`). The edge is then at `shipify.<APPS_DOMAIN>` besides workers.dev, and each app at
  `<id>.<APPS_DOMAIN>`. Put it in your credentials file; `door setup` sets the shipify variable.
  On the zone: SSL/TLS → **Always Use HTTPS** on, **Minimum TLS Version** 1.2; DNS → **DNSSEC** on.
- **The deploy token,** `shipify-deploy`, for your account only. Its access is in
  [Tokens and secrets](#tokens-and-secrets). It's shown once: paste it at `pnpm ship setup apps`
  (hidden), which keeps it in your credentials file as `CF_DEPLOY_TOKEN`, sets it on shipify, and
  finds your account and workers.dev name with it.
- **The free plan:** 100 Workers and 100,000 requests a day. Static files don't count.
- **An app behind a sign-in:** the Worker → Access → **Protect this Worker behind Access**, allowing
  your email; then Zero Trust → Access → Applications → **Self-hosted** for `<app's host>/health`
  and `<app's host>/.well-known/shipify.json`, with a **Bypass, Everyone** policy. Without the
  second, every deploy's health check fails and rolls back. Never put the edge behind a sign-in:
  each of its routes proves its caller.

## Tasks: the bot and the agent's login

Once, on this PC, about 10 minutes. `ship setup` walks the same.

1. **The bot:** `pnpm ship bot --yes`. In the browser, press **Create GitHub App**, install it on
   the org with **All repositories**, then in its permissions set **Variables** to **Read and
   write**, save, and accept the change on the install. Its key goes straight into shipify's
   secret `SHIPIFY_BOT_KEY`.
2. **The agent's login:** `claude setup-token` (it lasts a year), then paste it at `ship setup`'s
   hidden prompt: it's set as the secret `CLAUDE_CODE_OAUTH_TOKEN`. A new one, a year on:
   `pnpm ship setup agent --new`. When `SHIPIFY_AGENT` names an agent through a gateway, this step
   is that gateway's key instead, checked with it.
3. **Publishing new projects from a task:** a merged plan's repo and keys are made on GitHub's
   machines, with shipify's secret `CF_DEPLOY_TOKEN` and your settings (`CLOUDFLARE_ACCOUNT_ID`,
   `CF_WORKERS_SUBDOMAIN`, variables on shipify). `pnpm ship setup apps` sets each. Without them (or the bot's Variables permission), the
   task's reply names what's missing; add it, then comment `publish`.
4. **Check:** `pnpm ship box list` shows all three ready. Also check the bot's page: installed on
   **All repositories**, with **Variables: Read and write**.
5. **Its logo** (optional, a minute): on the bot's page → **Display information** → **Upload a
   logo**, choose `docs/assets/logo.jpg` (Shipify's sailboat). GitHub has no way to set it from a
   command, and nothing checks it.

Only your account starts runs: the variable `SHIPIFY_OWNER`, set by `box add`.

## Another account: the repos App

ADR 0045. Optional: only to work on repos on another of your accounts, such as your company's org,
your own user account, or another org of yours. Once, on this PC, a few minutes; then a minute for
each account.

1. **The App, once:** `pnpm ship bot repos`, read its plan, then `pnpm ship bot repos --yes`. In
   the browser, press **Create GitHub App**. Its key goes straight into shipify's secret
   `SHIPIFY_REPOS_KEY`. It's public, so anyone can install it, and that gives them nothing of yours.
   It also gives you nothing of theirs until you add their account (step 2).
2. **Each account:** `pnpm ship bot repos acme`, read its plan, then add `--yes`. It adds `acme` to
   your accounts (the variable `SHIPIFY_ACCOUNTS`, by its login and GitHub's id for it, so a login
   someone else takes later is never yours) and opens the page that installs the App there, with
   `acme` chosen. On GitHub, pick the repos and click **Install**. Who can install it:
   - **an owner of the org:** on any of its repos;
   - **a repo's admin:** on the repos they admin, with no owner needed, since the App asks for
     repository permissions only;
   - **anyone else:** they click **Request**, and an owner approves.
3. **Check:** `pnpm ship box list` shows the repos App and your accounts. The first task there
   (`acme/api: …`, or `look at acme/api …`) confirms it works, or says what's missing, with the
   link that fixes it. From then on, `/repos` lists the account's repos
   ([tasks.md](tasks.md#which-repos)).
4. **Its logo** (optional): on its page → **Display information** → **Upload a logo**, as for the
   bot.

**What it may do, and why each:**

| Permission | Why |
|---|---|
| contents: write | clone the repo, and push the task's own branch |
| pull requests: write | open the PR, read its reviews, close it on `start over` |
| issues: read | read the issue an ask names (`acme/api: fix #45`) |
| actions, checks, statuses: read | read the repo's CI, for `fix the checks` |
| metadata: read | GitHub's own, with any App |

It has no administration, secrets, workflows, organization permission or webhook. GitHub refuses
its push of a workflow file, and the box refuses one first.

**Taking an account off:** `pnpm ship bot repos acme --remove --yes`. Then uninstall the App on
GitHub (the account's Settings → GitHub Apps). From then on, its repos are only read, as anyone's.

**Before your company's org:** check that it's fine with an AI agent on your own subscription
working on its code. An IP allow list (GitHub Enterprise Cloud) blocks your box until its address
is added, or until the org turns on "allow GitHub Apps' IP lists". Where `main` requires signed
commits, Shipify's PRs can't be merged yet: its commits are pushed by git, unsigned.

## The edge

One Worker, `shipify`, at its free `shipify.<your workers.dev name>.workers.dev`, and at
`shipify.<APPS_DOMAIN>` too when you have a domain: the door, the watch and the status page
([door.md](door.md), [watch.md](watch.md)). Its first setup needs only your deploy token in the
credentials file (`pnpm ship setup apps` takes it, hidden): `door setup` finds your account and its
workers.dev name with it.

1. **The door App:** `pnpm ship door setup --yes`. Press **Create**, then install it on **shipify
   only**; set **Variables: Read-only** when it says. It puts the App's key on the Worker, sets the
   edge's variables, and deploys it. Its logo, if you like: the App's page → **Display
   information** → **Upload a logo** → `docs/assets/logo.jpg`, as for the bot.
2. **Check:** `pnpm ship door check`, once `ci`'s edge job is done. A chat no one's on yet (not
   added) isn't checked, and each failing check names its fix.
3. **Telegram,** if you want it: `pnpm ship add telegram --yes` ([channels.md](channels.md)).
4. **The status page,** if you want it: `pnpm ship door page --yes`. It walks you through one
   Cloudflare Access application, "shipify status", for the edge's address with the path
   `admin/*` (your `allow-me` policy, that path only), asks for its two public values (your team's
   address and the AUD tag), and checks that `/admin/status` sends a stranger to Access's sign-in
   ([door.md](door.md#the-status-page)). Run it again any time: Enter keeps the saved values.
5. **The web chat,** if you want it, after the status page: `pnpm ship add webchat --yes`. A chat
   window at the edge's `/admin/chat/`, behind the same sign-in
   ([channels.md](channels.md#the-web-chat)). Its **Turn on notifications** step makes the key
   they're signed with; then on each phone or PC, in the chat, **Setup → Notifications on this
   device** (on an iPhone, from the Home Screen app: [channels.md](channels.md#notifications)).

- **Its secrets** live only on the Worker, put there from this PC with your deploy token: the door
  App's key, and each channel's ([settings.md](settings.md)).
- **Its deploy** is `ci.yml`'s edge job, with shipify's `CF_DEPLOY_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` (`door setup` sets both, from your credentials file). A deploy never
  sends or deletes the Worker's secrets.

## Boxes

| Box | Set it up with | Runs |
|---|---|---|
| a Pi or a VPS | `pnpm ship box add <user>@<host> --manage --yes` (asks for sudo once) | everything; each slot's agent as its own Linux user |
| this PC | `pnpm ship box add --yes` (asks for sudo once; its SSH and network stay as they are) | the same: everything, each slot's agent as its own Linux user |

The steps, what keeps a box running, and when it's lost: [box-setup.md](box-setup.md).

## Plug-ins

Each in one command that shows its plan first:

```sh
pnpm ship add <name>           # what you need, the keys you'll paste and where each goes
pnpm ship add <name> --yes     # does it, one checked step at a time; run it again to carry on
pnpm ship add <name> --new --yes   # a new key: asks for each again
pnpm ship selftest <name>      # checks it
pnpm ship remove <name> --yes  # undoes it
```

- **Notion** (`notion`): [tools.md](tools.md). Its keys are shipify secrets.
- **Drop** (`drop`): [tools.md](tools.md#drop-setting-it-up-once-about-10-minutes). Drop's address
  and two Access service tokens, as shipify secrets. It needs Drop live first.
- **Telegram** (`telegram`): [channels.md](channels.md). Its keys are Worker secrets. It needs the
  door App first.
- **The web chat** (`webchat`): [channels.md](channels.md#the-web-chat). No keys of its own to
  paste: its notifications' key (`WEB_PUSH_KEY`) is made on this PC and put on the Worker. It needs
  the status page first.
- **OpenRouter** (`openrouter`, a gateway): pi's and OpenCode's models
  ([agents.md](agents.md#gateways)). Make a key at openrouter.ai/settings/keys → Create key, give
  it a credit limit there, and paste it when asked. Its key is a shipify secret, checked with
  OpenRouter, and the variable `SHIPIFY_GATEWAYS` records it. `pnpm ship selftest pi` (or
  `opencode`) asks that agent a question through the door, as you on Telegram, so the answer comes
  to your Telegram.
- **Vercel's AI Gateway** (`vercel-ai-gateway`, a gateway): the same agents through Vercel
  (`pi-vercel`, `opencode-vercel`). Make a key in the Vercel dashboard, AI Gateway → API Keys, and
  paste it when asked; it's checked with the gateway and recorded in `SHIPIFY_GATEWAYS`. To make it
  the default, set the repo variable `SHIPIFY_AGENT` to `pi-vercel`; clear it to go back
  ([agents.md](agents.md#agents-and-gateways)). If your Vercel account requires zero data retention, a model
  none of its providers offers it for is refused ([troubleshooting.md](troubleshooting.md#keys-and-setup)).

## Tokens and secrets

`gh secret list -R <you>/shipify` shows the names set on shipify; values never show anywhere.
Replace a GitHub secret with `gh secret set <NAME> -R <you>/<repo>`, pasting at the hidden prompt.

| Key | For | Lives | Expires | To replace it |
|---|---|---|---|---|
| `shipify-pc` (GitHub, fine-grained) | `gh` and `ship` on this PC | this PC's `gh` login | the date you give it (`ship doctor` reads it and warns 30 days before) | a new one with the same access (below), `gh auth login`, then `pnpm ship doctor --yes` |
| `CLAUDE_CODE_OAUTH_TOKEN` | the agent's login | shipify secret | a year after you make it | `claude setup-token`, then `pnpm ship setup agent --new` |
| `SHIPIFY_BOT_KEY` | the bot's one-hour tokens | shipify secret | doesn't | the bot's page → Private keys → Generate; `gh secret set SHIPIFY_BOT_KEY -R <you>/shipify`; delete the old key |
| `SHIPIFY_REPOS_KEY` | the repos App's one-hour tokens, on your other accounts | shipify secret | doesn't | the repos App's page → Private keys → Generate; `gh secret set SHIPIFY_REPOS_KEY -R <you>/shipify`; delete the old key |
| `SHIPIFY_DOOR_APP_KEY` | the door App | the edge's Worker | doesn't | the App's page → Private keys → Generate, then `pnpm ship door setup --new --yes`; delete the old key |
| `TELEGRAM_TOKEN` | the bot on Telegram | the edge's Worker; the credentials file | until revoked | @BotFather → `/revoke`, then `pnpm ship add telegram --new --yes` |
| `TELEGRAM_SECRET` | proving a call came from Telegram | the edge's Worker; the credentials file | never | `pnpm ship add telegram --new --yes` makes a new one |
| `WEB_PUSH_KEY` | signing the web chat's notifications | the edge's Worker | never | `pnpm ship add webchat --new --yes` makes a new one |
| `shipify-deploy` (Cloudflare) | deploys | the credentials file (`CF_DEPLOY_TOKEN`); shipify secret `CF_DEPLOY_TOKEN` (the edge's deploy, a merged plan's keys); each app's `CLOUDFLARE_API_TOKEN` | see Cloudflare → API Tokens | `pnpm ship setup apps --new` (the credentials file and shipify), then `gh secret set` it as each app's `CLOUDFLARE_API_TOKEN` |
| `SHIPIFY_NOTION_READ`, `SHIPIFY_NOTION_WRITE` | Notion: read; the changes you approved | shipify secrets; the credentials file | no date | refresh it on the integration's page, then `pnpm ship add notion --new --yes` |
| `SHIPIFY_DROP_READ_ID`, `SHIPIFY_DROP_READ_SECRET`, `SHIPIFY_DROP_WRITE_ID`, `SHIPIFY_DROP_WRITE_SECRET` (and `SHIPIFY_DROP_URL`) | Drop: read; the changes you approved (Access service tokens) | shipify secrets; the credentials file | the duration you gave it (none: non-expiring) | a new service token, in the `/api` app's Service Auth policy, then `pnpm ship add drop --new --yes`; delete the old token |
| `OPENROUTER_API_KEY` | pi's and OpenCode's models, through OpenRouter | shipify secret; the credentials file | until you delete it on OpenRouter | a new key at openrouter.ai/settings/keys, then `pnpm ship add openrouter --new --yes` |
| `AI_GATEWAY_API_KEY` | pi's and OpenCode's models, through Vercel's AI Gateway | shipify secret; the credentials file | until you delete it in Vercel | a new key in Vercel's AI Gateway, then `pnpm ship add vercel-ai-gateway --new --yes` |
| `SHIPIFY_TEMPLATE_TOKEN` | a private template on another account, read by the weekly update check | shipify secret; the credentials file | the date you give it (`ship setup` checks it reads the template) | a new fine-grained token (that repo only, Contents read-only), then `pnpm ship setup updates --new` |
| runner registration tokens | adding a box | nowhere: used at once | an hour | nothing to do |

**Access:**
- **`shipify-pc`:** your account (or org), all repositories. Read and write: Actions, Administration, Contents,
  Pull requests, Secrets, Variables, Workflows. Read: Commit statuses.
- **`shipify-deploy`:** Workers Scripts Edit, Account Settings Read, User Details Read, Memberships
  Read; Workers KV Storage Edit (the web chat's files, and apps that keep data), D1 Edit and Workers R2
  Storage Edit for apps that keep data (R2 asks for a card on the Cloudflare account once; nothing is
  charged inside its free limits); Zone → Workers Routes Edit on your domain's zone.
- **`CLOUDFLARE_ACCOUNT_ID`** isn't secret: it's one of your settings, a variable on shipify (ADR 0047).

### Variables on shipify

Not secret, and each set for you: every one, with what sets and reads it, is in
[settings.md](settings.md). `pnpm ship doctor` names any on your copy that nothing reads, with the
command that deletes it.

### Key dates

The watch reminds you 30 and 7 days before each date in `SHIPIFY_KEY_DATES`, a JSON object of
names and dates:

```json
{"this PC's token": "2027-01-31", "the agent's login": "2027-02-15"}
```

- **Recorded for you:** `pnpm ship doctor --yes` records this PC's token and each agent's login (a
  year after its secret was last set: set a new one with `pnpm ship setup agent --new`, run doctor,
  and the date follows). An App's key never expires, so none is recorded for it.
- **Anything else:** add it yourself: GitHub → shipify → Settings → Secrets and variables →
  Actions → Variables → `SHIPIFY_KEY_DATES`.

## Things to check now and then

- **Key dates:** the watch's reminders, and `pnpm ship doctor`.
- **Your domain's renewal,** with your registrar. If it lapses, the edge and the apps on it are down.
- **A box off for 14 days** is removed by GitHub: `box add` again (with no target on this PC).
- **Ubuntu on the Pi:** 24.04's updates end in 2029 (2034 with free Ubuntu Pro)
  ([box-setup.md](box-setup.md#about-the-os)).
- **Each agent's version** is pinned in `executors.json` (its `install`). Raise it in a PR now and
  then.
- **Shipify's releases:** fixes land on `main`, and runs use `main` at once; `shipify: release`
  shares them ([releases.md](releases.md)). A project gets a stack's change, its pipeline's too, by
  its own upgrade PR.
