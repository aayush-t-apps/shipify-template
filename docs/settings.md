# Settings

<!-- Made from the one list (cli/lib/settings.ts) by tests/settings.test.ts: change the list, then
run `pnpm vitest run tests/settings.test.ts -u`. -->

Every setting your copy has, from one list: the core's (`cli/contracts/settings.ts`), the edge's
(`edge/setup/settings.ts`), and each plug-in's from its own file (a stack's deploy values and keys,
a tool's keys, an agent's login, a gateway's key). `ship setup` checks each step's, `ship doctor`
names what's on your copy but on no list, and a workflow can't read one that isn't here.

- **A variable** is on your copy (`gh variable list -R <you>/shipify`), not secret; every run gets
  them all. **A secret** is on your copy too, by name only. **The edge's Worker** holds its own
  secrets, put there from this PC. **This PC** keeps copies in its credentials file
  (`~/.config/shipify/credentials.env`, [configuration.md](configuration.md#the-credentials-file)).
- **Needed:** by the core (no task runs without it), by its add-on (once you set that up), or no
  (unset, its default applies).
- How to make and replace each key: [setup.md](setup.md#tokens-and-secrets).

| Setting | Lives | Holds | Set by | Read by | Needed |
|---|---|---|---|---|---|
| `SHIPIFY_TIME_ZONE` | a variable, this PC | your time zone, like Europe/London | `ship setup` | runs (repeats' times, times in replies), and the edge, read live | by the core |
| `SHIPIFY_OWNER` | a variable | your login: only your events start runs | `box add` | `task.yml`, `watch.yml`: nothing runs without it | by the core |
| `SHIPIFY_BOT_CLIENT_ID` | a variable | the bot's client id | `ship bot` | the mint steps of `task.yml` and `watch.yml`: the bot's one-hour tokens | by the core |
| `SHIPIFY_BOT_SLUG` | a variable | the bot's name | `ship bot` | `task.yml`, `watch.yml`: its commits' name, and its events start runs | by the core |
| `SHIPIFY_AGENT` | a variable | which agent runs when nothing picks one, and the menus' default (unset: `executors.json`'s default) | you | `task.yml` (a run, and what it says in a chat), and the edge's menus | no: unset, its default |
| `SHIPIFY_REPOS_CLIENT_ID` | a variable | the repos App's client id, for your other accounts (ADR 0045) | `ship bot repos` | the repos App's mint steps in `task.yml` | by its add-on |
| `SHIPIFY_REPOS_SLUG` | a variable | the repos App's name | `ship bot repos` | `task.yml`: its commits' name, and its install link in a reply | by its add-on |
| `SHIPIFY_ACCOUNTS` | a variable | your other accounts, each `login:id` (GitHub's id pins it) | `ship bot repos <account>` | `task.yml`, every step: only these and your copy's are yours; any other is only read | no: unset, its default |
| `SHIPIFY_PEOPLE` | a variable | your id on each channel, as JSON `[{"name":"…","on":{"<channel>":"<id>"}}]` | `ship add <channel>` | the edge and runs: chat messages come only from these ids, and go only to them | by its add-on |
| `SHIPIFY_SEND` | a variable | your default channels, comma-separated (unset: GitHub only) | `ship add <channel>` | runs: alerts, repeats' replies and recipes' tasks | no: unset, its default |
| `SHIPIFY_DIGEST` | a variable | when the weekly digest comes to your default chats, as a repeat says it (`every monday at 9:00`, the default, in your time zone), or `off` | you | the due run (ADR 0053) | no: unset, its default |
| `SHIPIFY_GATEWAYS` | a variable | each gateway with a key set, and since when: `{"<gateway>": "YYYY-MM-DD"}` | `ship add <gateway>`, `ship remove <gateway>` | the web chat's Setup | no: unset, its default |
| `SHIPIFY_KEY_DATES` | a variable | when your keys expire: `{"<key>": "YYYY-MM-DD"}` | `ship doctor --yes` (this PC's token, each agent's login), and you | the watch, 30 and 7 days before each; the status page | no: unset, its default |
| `SHIPIFY_TEMPLATE` | a variable, this PC | the template this copy follows, `owner/name` (unset: the one its version file names, else the one GitHub says it was made from) | `ship template` (where releases are made), or you | `update.yml` (`ship update`), and `ship template` | no: unset, its default |
| `SHIPIFY_PRIVATE_WORDS` | a variable | words never published to the template, each with its stand-in: `{"<word>": "<stand-in>"}` (any case; ADR 0055) | you | `ship template`: replaced in what it publishes, then checked for | no: unset, its default |
| `SHIPIFY_CONSOLES` | a variable | each box's Cockpit link, as JSON | `box add --manage` | `ship box list` | no: unset, its default |
| `SHIPIFY_DOOR_APP_ID` | a variable | the door App's id | `ship door setup` | the edge, deployed with it (`ci.yml`): its App, matched by id | by its add-on |
| `SHIPIFY_DOOR_SLUG` | a variable | the door App's name | `ship door setup` | `task.yml`, `watch.yml`: the door App's events start runs; the edge | by its add-on |
| `SHIPIFY_DOOR_INSTALLATION` | a variable | the door App's install on your copy | `ship door setup` | the edge, deployed with it (`ci.yml`) | by its add-on |
| `SHIPIFY_DOOR_URL` | a variable | the edge's address | `ship door setup` | the edge, deployed with it (`ci.yml`); runs, to reach the door; `ci.yml`'s edge job runs once it's set | by its add-on |
| `SHIPIFY_REPO_ID` | a variable | your copy's id on GitHub | `ship door setup` | the edge, deployed with it (`ci.yml`): what a run's OIDC token must carry | by its add-on |
| `SHIPIFY_OWNER_ID` | a variable | your copy's owner's id on GitHub | `ship door setup` | the edge, deployed with it (`ci.yml`): what a run's OIDC token must carry | by its add-on |
| `CLOUDFLARE_ACCOUNT_ID` | a variable, this PC | your Cloudflare account (found with the deploy token) | `ship door setup`; `ship setup apps` | `ci.yml`'s edge deploy; ts-static, ts-worker apps' deploys: `ship publish`, a merged plan's new repo | by its add-on |
| `CF_WORKERS_SUBDOMAIN` | a variable, this PC | your workers.dev name | `ship door setup` (found with the deploy token); `ship setup apps` | `ship door`: the edge's free address, `shipify.<name>.workers.dev`; ts-static, ts-worker apps' deploys: `ship publish`, a merged plan's new repo | by its add-on |
| `APPS_DOMAIN` | a variable, this PC | your domain on Cloudflare, for the edge and apps (unset: workers.dev) | you, in your credentials file; `ship door setup` sets the variable | the edge's address, `shipify.<APPS_DOMAIN>`; ts-static, ts-worker apps' deploys: `ship publish`, a merged plan's new repo | no: unset, its default |
| `SHIPIFY_ACCESS` | a variable | the status page's Access application: `{"team": "…", "aud": "…"}`, both public | `ship door page` | the status page and the web chat: the sign-in the edge checks | by its add-on |
| `SHIPIFY_DOOR` | a variable | `closed` shuts the door (unset: open) | you | the edge: closed, it writes and sends nothing | no: unset, its default |
| `SHIPIFY_BOT_KEY` | a secret | the bot's private key | `ship bot` | the mint steps of `task.yml` and `watch.yml`, alone | by the core |
| `SHIPIFY_REPOS_KEY` | a secret | the repos App's private key | `ship bot repos` | the repos App's mint steps in `task.yml`, alone | by its add-on |
| `SHIPIFY_TEMPLATE_TOKEN` | a secret, this PC | a read-only key for a private template on another account (Contents: read, that repo only) | `ship setup updates` (`--new` for a new one) | `update.yml`, alone | no: unset, its default |
| `CF_DEPLOY_TOKEN` | a secret, this PC | Cloudflare's deploy token (`shipify-deploy`) | `ship door setup`, from your credentials file; `ship setup apps` | `ci.yml`'s edge deploy; on this PC, `ship door` and `ship add <channel>`; ts-static, ts-worker apps' deploys: `ship publish`, a merged plan's new repo | by its add-on |
| `SHIPIFY_NOTION_READ` | a secret, this PC | notion's read-only key | `ship add notion` | `task.yml`'s think step: notion's look calls | by its add-on |
| `SHIPIFY_NOTION_WRITE` | a secret, this PC | notion's key for the changes you approved | `ship add notion` | `task.yml`'s apply step, only for notion's calls you approved | by its add-on |
| `CLAUDE_CODE_OAUTH_TOKEN` | a secret | claude's login | `ship setup agent` (claude setup-token; `--new` for a new one) | `task.yml`'s think step, when claude runs | by the core |
| `OPENROUTER_API_KEY` | a secret, this PC | openrouter's key: pi's and opencode's models | `ship add openrouter` | `task.yml`'s think step, when pi or opencode runs | by its add-on |
| `AI_GATEWAY_API_KEY` | a secret, this PC | vercel-ai-gateway's key: pi-vercel's and opencode-vercel's models | `ship add vercel-ai-gateway` | `task.yml`'s think step, when pi-vercel or opencode-vercel runs | by its add-on |
| `SHIPIFY_DOOR_APP_KEY` | the edge's Worker | the door App's private key (PKCS#8) | `ship door setup` (`--new` for a new key) | the edge, alone | by its add-on |
| `WEB_PUSH_KEY` | the edge's Worker | what the web chat's notifications are signed with (a P-256 key, made on your PC) | `ship add webchat` (`--new` for a new one) | the edge, alone: unset, the web chat works and notifies no one | no: unset, its default |
| `TELEGRAM_TOKEN` | the edge's Worker, this PC | telegram's key | `ship add telegram` (`--new` for a new one) | the edge: telegram's messages | by its add-on |
| `TELEGRAM_SECRET` | the edge's Worker, this PC | telegram's key | `ship add telegram` (`--new` for a new one) | the edge: telegram's messages | by its add-on |
