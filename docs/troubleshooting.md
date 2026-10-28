# Troubleshooting

Find what you see, check the middle column, then fix it. Three things cover most of it:
- **A failed reply** names its problem and the one thing to do (`cli/contracts/problems.ts`).
- **`pnpm ship doctor`:** this machine, the GitHub login, the credentials, the watch, and on a box
  its setup and sandbox. Every failing check prints its fix.
- **The status task** (label `shipify-status`): the watch's last due run, each box's health and
  clean-up, offline boxes, failing apps, unsent replies.

## Tasks

| You see | Check | Fix |
|---|---|---|
| no 👀 on a task for minutes | `pnpm ship box list`: a box online, with no "no sandbox"? | turn one on, or set one up with `pnpm ship box add` ([box-setup.md](box-setup.md#adding-a-box-or-a-slot)): the task's run starts when one is online |
| nothing reacts to any task | `gh variable get SHIPIFY_OWNER -R <owner>/shipify` is your login; `task.yml` is enabled in Actions | `gh variable set SHIPIFY_OWNER -R <owner>/shipify --body <login>`; enable the workflow |
| a `failed` reply | its problem's fix | do what it says; usually comment `continue` |
| "The run's <step> step failed: …" | the run's log, at that step (the reply links the run) | `continue` once; if it fails the same way, it's Shipify's, not your task: the error and log say what |
| a sibling task's PR merged first, and this one's is behind | nothing: its next run (`continue`, or any comment) refreshes the branch with `ship refresh` | if the reply says a file conflicts, the agent fixes it and refreshes again; say what to keep if it asks |
| "ok" did nothing | was a question waiting (not a PR to merge, or a list for `yes`)? | a lone `ok` answers a question; after a PR or a list it's a thanks (a 👍). Say more words to carry on, or tap Yes (or say `yes`) for a list |
| a task labelled `stuck` (Stopped in the chats) | its last run's log | its run ended before it finished (the box restarted, the run broke off), or your words waited with no run. Fix what the log shows, if anything, then `continue`, or close it |
| a run "lost communication with the server" | `pnpm ship box health <user@host>`: `up` and, on a Pi, `started` | `up` shorter than the time since the run broke: the box restarted. `started from power-on` means the power was off, cut or dropped (a brownout): check the supply (on a Pi 4, the official 5.1 V / 3 A one), power a USB disk from a powered hub, or add a UPS. Then `continue` |
| your `yes` did nothing | it must be the whole message, unedited, after the list, within a day, with no edit to the task since; a list over 3,000 characters takes its `yes` on GitHub | say `yes` again on its own; any other words plan again |
| a form answer is wrong | the reply names it | edit the issue (**⋯ → Edit**): that starts it again |
| the agent's login expired | the reply | `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R <owner>/shipify` |
| a run with pi or OpenCode fails on its key (no key, or a 401) | the reply's error; Status & setup's Agents and models: "no <gateway> key"? | `pnpm ship add <its gateway> --yes` (`openrouter`, or `vercel-ai-gateway` for the `-vercel` agents; `--new` for a new key) |
| a run with pi or OpenCode fails on too many requests (a 429) | OpenRouter's free models allow 50 requests a day, 1,000 once you've bought $10 of credits | try again tomorrow, another free model (`/models free`), or `use claude` |
| "Your plan's … limit is used up" | the reply says when it resets | `continue` after that time: the next run starts from the kept commits |
| "The agent stopped before it finished" (its clock, a crash, an answer that didn't read) | the reply names which; the run's log has the rest | `continue` carries on from the kept commits; a task too big for one run is fine, each run carries on from the last |
| `use <model>` did nothing | the reply to it, and the model in the run details | `use …` must be a line of its own (a whole comment, or a line in a message), with a model the task's agent takes in `executors.json`: on pi, `use claude opus` goes back to Claude Code ([agents.md](agents.md)) |
| the box's checks failed, no PR | the reply has the end of their output (the agent already had one round to fix them) | `continue` carries on from the kept commits; or say what to change |
| `ship version` refuses: a change doc has no `released:` line | the message names the file | add `released: vX.Y.Z` (the version that shipped it) or `released: null` |
| "looks like a key", nothing pushed | the file it names | say how to remove it, then `continue` |
| an attached file wasn't read | the reply says "couldn't open" | GitHub serves private attachments only to a browser: paste the text, or link the file in a repo or gist |
| a merged plan's task stopped before its build | the `github` job's reply names what's missing | the shipify secret `CF_DEPLOY_TOKEN` and your settings `CLOUDFLARE_ACCOUNT_ID` and `CF_WORKERS_SUBDOMAIN` (`pnpm ship setup apps`), or the bot's **Variables** permission; then comment `publish` on the task |
| a run was slow, or used a lot of your plan | its run details | a smaller model (`use sonnet`) |

## Repeats and the watch

| You see | Check | Fix |
|---|---|---|
| "the watch hasn't started a due run since …" | `pnpm ship door check`; the edge's logs (Cloudflare → Workers → `shipify`) | what they name ([door.md](door.md)). Meanwhile, Actions → watch → Run workflow (`due`) |
| a repeat didn't arrive | its status comment's next time, and "Coming up" on the status task | press `due` (Actions → watch) to run it now ([watch.md](watch.md)) |
| a repeat paused itself | it failed three times in a row, and said so once | fix the cause, then comment `resume` |
| an app "failing" on the status task | `pnpm ship status <id>`, and its `/health` | fix and deploy; the watch notes it when it's back. An app that's down never alerts |
| a recipe's task didn't appear after the merge | the status task's recent events and alerts (a file that doesn't read is named there) | fix the file in a PR ([recipes.md](recipes.md)); or press `due` (Actions → watch) |
| a recipe says it's paused | its task: "doesn't read: …", or the task is closed | fix the file in a PR (it runs again once merged), or `resume` |

## Telegram and the door

`pnpm ship door check` checks the edge end to end; `pnpm ship selftest chat` sends a message
through it and back ([door.md](door.md), [channels.md](channels.md)).

| You see | Check | Fix |
|---|---|---|
| the bot doesn't answer at all, not even `/ping` | `pnpm ship door check`; your Telegram id in `SHIPIFY_PEOPLE` (the door ignores anyone else); a private chat; `SHIPIFY_DOOR` not `closed` | what it names; `pnpm ship add telegram --yes` links you and points the bot at the edge again; delete `SHIPIFY_DOOR` to open the door |
| "Couldn't reach GitHub: nothing was saved" or "GitHub refused it" | [GitHub's status](https://www.githubstatus.com) | send it again in a minute, or write it on GitHub. Nothing was written, and nothing is tried again behind your back |
| "Got it · #12", then nothing | the task on GitHub: a run, a reply? | as for any task (above). With no box online, it says so and runs when one is back |
| a reply is on GitHub but not in your chat | the reply has no 🚀 | within a few minutes the watch sends one short notice with its link (never the reply twice). `pnpm ship selftest chat`; unblock or restart the bot in the chat |
| "Failed" with "The run's “…” step failed" | the run's log on Actions (its link is in the reply) | a step GitHub runs (a token it wouldn't mint) failed: reply `continue`. If it fails the same way, it's Shipify, not your task |
| "There's no task #n" | the number | reply to one of the bot's messages, or start with the right number |
| "GitHub refused the door App's key" | the door App's page | make a new key there, then `pnpm ship door setup --new --yes` |
| the status page says "isn't set up" | `SHIPIFY_ACCESS` on shipify | `pnpm ship door page --yes` |
| the status page says "Sign in through Cloudflare Access" though you did | `pnpm ship door check` (the page line); the Access application's AUD tag | `pnpm ship door page --yes` again with the tag Cloudflare shows |
| the bot stopped answering after an Access change | `pnpm ship door check`: "a sign-in is in front of the door" | Access belongs on `/admin` alone (path `admin/*`): remove any application covering the whole address |
| a 403 at `/admin/status` or `/admin/chat/`, though you're signed in, after an update | the "shipify status" application's path still says `status`, so Access doesn't cover `/admin`, and the edge refuses it itself | change its path to `admin/*` (Zero Trust → Access → Applications → "shipify status" → Edit), then `pnpm ship door page --yes` (Enter keeps the saved values) |

## The web chat

`node_modules/.bin/tsx tools/web/setup.ts --check` checks the status page, the sign-in over the
chat, the file store and the notifications' key ([channels.md](channels.md#the-web-chat)).

| You see | Check | Fix |
|---|---|---|
| a 403 at `/admin/chat/`, though you're signed in | Access's application path isn't `admin/*`, so it doesn't cover the chat, and the edge refuses it itself | change the "shipify status" application's path to `admin/*` (Zero Trust → Access → Applications), then `pnpm ship add webchat --yes` again |
| a diagram shows as its source | it didn't draw: the source has a mistake, or jsDelivr didn't answer | fix the source, or reload the page later |
| "The web chat is off" | your entry in `SHIPIFY_PEOPLE` has no `"web"` | `pnpm ship add webchat --yes` |
| 📎 is off: "Files aren't set up" | the deployed Worker has no `FILES` binding (step 4 of `ship add webchat` says so) | the deploy token needs **Workers KV Storage: Edit**; then deploy the edge again (Actions → ci → Run workflow). Words still go meanwhile |
| A deploy stops: "can't list R2 buckets" or "make R2 bucket" (HTTP 403) | the deploy log | the deploy token needs **Workers R2 Storage: Edit**; if R2 was never turned on for the account, turn it on once in the dashboard (it asks for a card), then re-run |
| the model picker or Status & setup shows an old `executors.json` or `tools.json` | both are built into the edge when it deploys, and a change to them alone doesn't deploy it | run the edge job by hand (Actions → ci → Run workflow), or wait for the next edge change |
| "The door is closed" | the variable `SHIPIFY_DOOR` | delete it to open the door ([door.md](door.md#the-kill-switch)) |
| Setup says "Notifications aren't set up" | the edge has no `WEB_PUSH_KEY` | `pnpm ship add webchat --yes` |
| no notification came | Setup → Chats lists this device? The reply was for the web chat (a task carried on in Telegram notifies Telegram)? | turn **Notifications on this device** on again; alerts, repeats and recipes need `web` in `SHIPIFY_SEND` ([channels.md](channels.md#notifications)) |
| the switch says "Blocked" | you said no when the browser asked | allow notifications for the chat in the browser's site settings, or the phone's settings for Shipify, then turn it on again |
| no switch on an iPhone | Safari shows notifications only to a Home Screen app | Safari's **Share → Add to Home Screen**, open Shipify from there, then turn it on |
| none since a new key (`--new`) | each device subscribes again when it next opens the chat | open the chat on each device once |
| a tap on one opens the sign-in, then the list | Access's session had ended, and its sign-in drops the thread's address | open the thread from the list; a longer session on the "shipify status" application helps |
| "Can't reach GitHub · retrying" | nothing: the edge serves its last good copy and the page tries again by itself ([channels.md](channels.md#the-web-chat)). Long or often? [githubstatus.com](https://www.githubstatus.com), and the edge's logs (`page.refused`, or `page.served` "last good copy", each with GitHub's status) | it goes away by itself. A message that didn't go is sent again by itself; **Retry** sends it now |
| "Your sign-in ended" often | Access's session for the chat (24 hours unless you set it) | Zero Trust → Access → Applications → "shipify status" → **Session Duration**, for example 1 month |

## Boxes

| You see | Check | Fix |
|---|---|---|
| a box reported offline | a restart is back within 4 minutes, so it's real: `pnpm ship box list` | Cockpit, or `ssh` in and `sudo systemctl status shipify-box-<name>` ([box-setup.md](box-setup.md#looking-after-it)) |
| "no sandbox" in `box list` | the box's setup | while no task runs, set it up again: on the box, its `here.sh` command again; from a PC, `pnpm ship box add <user@host> --manage --yes` |
| "had a task killed for memory" (the status task, `box health`) | `pnpm ship box health <user@host>`, or Cockpit's overview: its swap, and the most each slot used | swap: none → set it up again (its `here.sh` command, or `box add`), which turns zram on; with swap, fewer slots (`--slots N`) ([box-setup.md](box-setup.md#adding-a-box-or-a-slot)) |
| `box add` (or `here.sh`) says none of its slots is online | on the box: `sudo systemctl status shipify-box-<name>` | what it says; then the same command again. A slot GitHub deleted (`box remove`, or 14 days off) registers again by itself (setup 9) |
| "the agents can reach your network and the tailnet: their rules aren't loaded" | on the box: `sudo systemctl status shipify-agents-net` | the same command again; the box takes no task runs until the wall holds ([box-setup.md](box-setup.md#the-agents-own-user)) |
| an agent's task needs a service on your network (a NAS, homepi), or a host with only IPv6 | by design, no agent reaches a private address (setup 9), nor an IPv6 address but `::1` (setup 11) | reach it through something public over IPv4 (GitHub, a deploy), or a tool the box runs outside the agent ([security.md](security.md#the-agents-sandbox)) |
| a run stops at its start: "… folder lost its setgid, so the box couldn't read this run's answer" | the slot folder's mode: `ls -ld /srv/shipify-agent-<k>` (a container on a box set up by 10 or older turned 2710 into 0711) | the box's setup again (its `here.sh` command), or once `sudo chmod 2711 /srv/shipify-agent-<k>`; then `continue` on the task ([box-setup.md](box-setup.md#the-agents-own-user)) |
| tests time out only when several tasks run at once | the box's cores (`box health`'s load) against its slots | fewer slots, or another box; `bash box/load-test.sh <app folder> 1 3 4` shows where it holds ([box-setup.md](box-setup.md#adding-a-box-or-a-slot)) |
| `here.sh` says "Stopped: …" | the line after it names the cause: the OS, root, memory, disk, GitHub out of reach, no terminal, the code declined or expired | do what it says, then run it again: it changed nothing, or carries on ([box-setup.md](box-setup.md#anywhere-with-one-command)) |
| `here.sh`'s link gives 404 | the template is private, or has no release with `here.sh` yet | make it public and release ([releases.md](releases.md#a-release)); meanwhile, from a PC, `pnpm ship box add <user@host>` |
| `here.sh` says "unknown option --manage" (or `--replace`, `--purge`) | the release it came from is older than the option | release Shipify (`shipify: release`), then the same command again: `latest` takes the new one |
| a release says "The check failed on the files to publish" | the failing tests it names, and the first error | fix it in a PR (a task on shipify), then `shipify: release` again; `continue` would fail the same way. A test that reads your own plans, recipes or checks fails only here: it makes its own instead ([releases.md](releases.md#a-release)) |
| "… is public: a box serves only a private copy" | your copy's visibility | make it private (Settings → General → Danger Zone): only the template is public |
| a Docker box says "This box isn't registered yet" | it waits for `register` | `docker compose run --rm box register` (or `docker run -it … register`), then start it again ([box-setup.md](box-setup.md#with-docker)) |
| `register` says the sandbox isn't right, in Docker Desktop | Docker's own kernel (`ptrace_scope`) | use a Linux host (a VM, a NAS, a Pi): the box takes no tasks without the sandbox |
| "Another container runs this box" | two containers on one volume | stop the other one; one volume is one box |
| a release says "Not published: …" | the file and what's in it: one of your words, a tailnet's name, or a key | add the word to `SHIPIFY_PRIVATE_WORDS`, or fix the file in a PR, then release again |
| doctor says the sandbox isn't right | the wall it names | `box add` again; it sets up and checks the sandbox |
| "… can write /run/docker.sock, a root container socket" | the agent is in the `docker` group, or Docker's or Podman's root socket is open to it | `sudo gpasswd -d shipify-agent-<k> docker`, or `sudo systemctl disable --now podman.socket`; then `box add` again ([box-setup.md](box-setup.md#containers-the-lab)) |
| **Containers don't start:** setup ends "Done, except containers", `box add` says "containers don't work for its agents", doctor's containers check fails, or an agent's `docker` won't start one | the `Error:` line it names; or on the box, as that slot's agent with a run's names: `cd /srv/shipify-agent-<k> && sudo -u shipify-agent-<k> env -i PATH=/usr/bin:/bin HOME=/tmp XDG_DATA_HOME=$PWD/data XDG_RUNTIME_DIR=$PWD/runtime CONTAINERS_CONF_OVERRIDE=/etc/containers/shipify-agents.conf podman info` | first, the same command again (its `here.sh` command, or `box add`), while no task runs: it mends what an older setup left. By the error: "failed to mount overlay for metacopy check … permission denied": the slot's `data` folder had the runner's group (setup 8 and 9), which setup 10 mends. "no subuid ranges" or "open …shipify-agents.conf": the setup again. "short-name did not resolve": the registries file is missing, the setup again. "the box can't remove what a container wrote (cannot resolve …: no such file or directory)" at setup, or "chown: … Operation not permitted" when a task's database container starts on a bind mount: Shipify 0.1.14's faults, fixed in the version after it; on that, the same command again. Still the same: [start over](box-setup.md#starting-over) (`--fresh`) ([box-setup.md](box-setup.md#containers-the-lab)) |
| setup says "containers: not run the whole way, the image didn't pull" | the box reaches Docker Hub (`curl -sI https://registry-1.docker.io/v2/`); "toomanyrequests" is Docker Hub's limit (100 pulls in 6 hours per address) | nothing breaks: each store opened, the box keeps its label, and the next setup tries again |
| setup says "containers: they didn't install" | the line above it: no Ubuntu universe, or a package that would remove another | `sudo add-apt-repository universe`, then the setup again; a machine with Docker of its own keeps it, and agents use `podman` |
| apt says "The value '…-backports' is invalid" | the box's apt sources have no backports (a Pi's image may not) | nothing: setup 10 installs Cockpit from the release itself there |
| "runner too old" | GitHub stops sending jobs 30 days after a newer runner | set the box up again: on it, its `here.sh` command; from a PC, `pnpm ship box add <box> --manage --yes` |
| this PC's box goes offline when you close WSL | WSL stops when idle | the `.wslconfig` idle timeouts ([box-setup.md](box-setup.md#this-pc)) |
| `box add` can't connect, or the name is taken | it says why and prints the fix | `ssh-keygen -R <address>`, `ssh-copy-id`, `ssh-add`; `--replace` after a reinstall (`here.sh` takes it too) |
| `ship doctor` says the kernel is 39-bit | the Pi's OS | Ubuntu Server 24.04 LTS, not Raspberry Pi OS |
| a full disk | `pnpm ship box health <user@host>` | run its clean-up: Actions → watch → `cleanup`, with the box's name |
| "The run's agent step failed: … didn't install" | the box reaches npm; its disk (`pnpm ship box health`) | `continue`: the next run that picks the agent installs it again ([agents.md](agents.md#on-a-box)) |
| a run is slow, and you want to know where | the run's page on GitHub: each step's summary has a line `plan 3.9 s · 4 gh calls, 3.1 s (issues 0.9, …)` (ADR 0051) | a step whose calls are many or slow names itself; the call budget in `tests/kernel-flow.test.ts` keeps each step's calls from growing unseen |
| the first step of a run fails before plan, on "Shipify's CLI, built" | its log: `pnpm install` or `node scripts/build-cli.mjs` (a full disk, npm unreachable); `pnpm ship box health` | free the disk, then `continue`: the commit's copy is made again (a copy is complete only with its `.built` file). A step can't say so on the task, since the CLI isn't there to say it |

## CI and deploys

| You see | Check | Fix |
|---|---|---|
| `ship pr` refuses | a change doc it can't read, a version not bumped, or `make verify` failed | fix it; `pnpm ship version <p> patch`; `ship pr` again (`ship pr <p> --check` checks the quick part alone) |
| `ship pr`'s push failed | the branch or `main` moved | `pnpm ship refresh <p>`, then `ship pr` again |
| a merge's CI run failed | `gh run view <id> -R <repo> --log-failed` | [playbooks/fix-ci.md](../playbooks/fix-ci.md). Nothing deployed: production keeps its last good version |
| a deploy was rolled back | the health check step; `pnpm ship status <id>` | an app behind Cloudflare Access needs a Bypass for `/health` and `/.well-known/shipify.json` |
| a merge that didn't deploy | its run under Actions → ship (every commit on `main` gets one, docs too) | re-run it, or Actions → ship → **deploy** (`main` again) |
| "pushed more than a version bump to main" (a staging app) | what the bot's push changed | a bot may push only a release's files (the versions in `shipify.json` and `package.json`, `CHANGELOG.md`, `docs/changes/`); anything else goes in a PR. Older apps: `pnpm ship upgrade <id>` |
| no "**Live**" after your merge | the merge's run on the task (it follows the deploy) | it replies once the pipeline marks the commit; after 30 minutes with no deploy, it says so. A staging release or a new project's first deploy is followed by the watch's due runs (the `deploying` label) |
| no preview link | the PR's `preview` label, and the preview run's note | none for an app that's down, or has runtime keys |
| pnpm refuses a package | it's less than 24 hours old | pin a version at least 2 days old |

## Keys and setup

| You see | Check | Fix |
|---|---|---|
| a key due soon (the watch's reminder, `ship doctor`) | its date | replace it as [setup.md](setup.md) says |
| deploys fail on Cloudflare's side | the app's `CLOUDFLARE_API_TOKEN` | update `credentials.env`, then `gh secret set CLOUDFLARE_API_TOKEN -R <owner>/<app>` |
| a plug-in's key stopped working | `pnpm ship selftest <name>` | a new key, then `pnpm ship add <name> --new --yes` |
| the bot can't set variables | the bot App's permissions | **Variables: Read and write**, then accept the change on the install |
| a tool misbehaves | `pnpm ship tools check`, and the reply's ✗ line | [tools.md](tools.md) |
| a Vercel run answers "No ZDR (Zero Data Retention) providers … available for model …" | your Vercel account (or team) requires zero data retention, and no provider serving that model offers it (its catalog `zdr` is `none`) | pick another model (the listed ones and those `/models <word>` finds have such a provider; a `use` naming one by id may not), or turn the requirement off in Vercel's AI Gateway settings |
| a run's details say "<model> takes no “<effort>” effort (…)" | its gateway's catalog lists other levels, or none: the run took Auto's, or none ([agents.md](agents.md#read-as-needed)) | nothing to do; `use <agent> <model> <effort>` with one it lists to pick it |
| a Vercel run is refused an effort | its catalog couldn't be read before the run (the effort went as asked) | `continue`; or `use <agent> <model>` with no effort, or one it takes |

## Gotchas, as they were found

- pnpm 12 refuses packages published less than 24 hours ago. Pin versions at least 2 days old.
- The Worker entry (`src/worker/index.ts`) may only have a default export. The routes are in `app.ts`.
- `make -n <target>` succeeds for a name that is only in `.PHONY`. `ship` treats "Nothing to be done"
  as missing; keep `.PHONY` to targets that have rules.
- Stack templates are stored exactly as the project formatter writes them. Otherwise every upgrade
  sees "edited" files. The golden tests check that a fresh project needs no upgrade.
- On a box, `pnpm/action-setup` fails when corepack already manages pnpm: `task.yml` uses
  corepack instead. There's no `jq` on the PC, so the workflows that run on boxes use node.
- The PC's fine-grained token has no Issues permission, so task comments and labels use the
  workflow's own token; project work uses the bot, or the box's own gh login.
- A GitHub App manifest can't request the Variables permission (it has no key in the API
  description): after `ship bot`, it's ticked by hand.
- `wrangler dev` also binds a debugger port (9229 by default). Parallel servers need their own
  `--inspector-port`, or the second fails with "Address already in use".
- git won't overwrite an untracked file on `pull`, even an identical one. That's why `plan submit`
  and `change submit` move the file onto its branch instead of leaving a copy.
- `wrangler versions list --json` shows only the last 10 versions, and previews count. Rollback by
  tag uses the Cloudflare versions API instead (the last 100).
- Never read `BASE_URL` in configs (Vite sets it). Playwright uses `E2E_BASE_URL`.
- Cloudflare previews need an already deployed Worker. The pipeline skips previews before the first
  deploy.
- Preview URLs on workers.dev get Cloudflare's own `x-robots-tag: noindex`.
- Cloudflare analytics can report requests as `__unknown__` for new Workers.
- `ship upgrade` finds the old stack version in platform git history, so CI needs `fetch-depth: 0`.
- A brand-new repo's first push can arrive as branch "create" events only, with no workflow run
  (seen once). If `ship publish` shows no run, the next commit starts it.
- GitHub can also drop a merge's push event: no run at all on the merge commit, with the PR's
  closed run there (seen once). The merged PR's run deploys instead. An empty commit starts
  nothing: a workflow with a path filter needs a changed file.
- Project Dependabot can't read the private shipify repo, so it covers npm only. The pinned
  pipeline actions are updated by shipify's own Dependabot.
- A project's Dependabot PR (only a security one now) fails "Version bumped with a changelog
  entry", since merging ships it and Dependabot doesn't bump. Add the bump on its branch: a
  changelog line, `pnpm ship version <its worktree> patch`, `make verify`, then push to the same
  branch.
- On GitHub's machines, a browser's system packages come from Ubuntu's mirror, which can crawl (seen:
  32 MB at 113 kB/s, almost 5 minutes). Merges skip the browser (`SHIPIFY_NO_BROWSER`); only
  `make e2e` for a preview or staging still downloads one.
- Static assets skip the Worker, so headers for them go in `_headers` (`public/_headers` for
  ts-worker, `site/_headers` for ts-static).
- In a CSS grid, give columns `minmax(0, 1fr)` or long `nowrap` content widens the page at 360px.
- GitHub's scheduler can simply never fire for a repo (seen, and in community reports), while `workflow_dispatch` works. The watch doesn't depend on it (ADR 0019).
- In CI every process has `GITHUB_ACTIONS=true`: the test sandbox clears it (and `GITHUB_SHA`,
  `GITHUB_REF_NAME`), or `ship` acts as a job inside tests.
- In `-p` runs Claude Code refuses a read outside its working folders (`/sys`, `/etc`, the run's
  own `config/`) even for an allowed prefix (`Bash(cat:*)`): its path check comes before prefix
  rules. Allowing `Bash` and `Read` whole passes it (checked in 2.1.284's permission code, and
  live), which is what ADR 0043 does. Its safety checks (writes to `.git` or `.claude`) still
  refuse.
- A nested `claude -p` started from inside a run can't sign in: Claude Code doesn't pass its login
  to the commands it runs. Check an adapter's rules from a PC that's signed in: the pinned version
  in a scratch folder, run with the adapter's argv (how: `tests/fixtures/claude-decisions.json`).
- pi says a tool server that didn't connect (a 401, a timeout) only on its own screen, and its
  JSON output has nothing of it: Shipify's gate names such a look call at the end (ADR 0043).
- gitleaks' generic-api-key rule flags long public ids (an Access AUD tag) in config: allow that
  one line with a `gitleaks:allow` comment that says why.
- The watch's runs use the workflow's own token, which can read shipify's issues but not the
  private project repos. A due run that follows a deploy gets the bot's
  one-hour read-only token for that alone; anything else a due run does must need only shipify.
  The workflow's token also can't list runners (no Administration), so a due run learns the boxes
  from the status task, which the watch's alerts keep.
- Claude Code's `--effort` is ignored by Haiku (no effort setting), and its `total_cost_usd` is an
  estimate at API prices that a subscription doesn't pay. Its `stream-json` `init` event names the
  model but not the effort, so a run records the effort it passed.
- The PC's gh login can read Actions logs and job timings but not issues: to see what a task run
  did from here, read its log (`gh run view <id> --log`).
- A new Cloudflare cron trigger can take up to 15 minutes to reach the network: the watch's first
  two ticks after its first deploy didn't run. Check with `wrangler tail shipify --format json`
  (its output is pretty-printed JSON, an object over many lines).
- `wrangler deploy --secrets-file` adds and updates a Worker's secrets but never removes one: a
  renamed secret stays on the Worker until `wrangler secret delete <name> --name <worker>`.
- `src/worker/index.ts` is stack-owned and replaced by `ship upgrade`: an app's timer goes in
  `app.ts` as `export const scheduled`, never in `index.ts`.
- A status task that's missing (deleted, or its label removed) is simply opened again by the next
  writer (or the watch), with an empty record. Nothing depends on its number.
- GitHub's list of issues by label can leave an issue out for a while, with no error: for about
  an hour it left the status task out on and off, and 15 new ones were opened. So a new status
  task opens only when a second look finds none too, and the next run that writes the record closes
  any other open one ([watch.md](watch.md#the-status-task-and-its-record)).
- A runner hands its folder's `.env` to every job: that's how a slot tells a run its box
  (`SHIPIFY_BOX`), the box's folder and the machine's one tool cache (ADR 0020). The runner reads
  it when it starts, so a changed `.env` needs a restart (box setup does it).
- A dispatched run carries no issue, so anything a workflow decides from `github.event.issue` sees
  nothing for "run again", a repeat or a merged plan's build: `task.yml` reads the issue in a step.
- Stacked PRs merge with "Create a merge commit": a squash makes the next PR conflict.
- A PC on WSL can find its clock jumped by hours, which fails tests that compare times across
  processes; a re-run passes. `wsl --shutdown`, or `sudo hwclock -s`, fixes it.
