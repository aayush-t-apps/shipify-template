# The CLI: `pnpm ship`

`ship` is the one interface to Shipify, for you, agents and the workflows. Run it from `shipify/`.
`pnpm ship help` prints the short list; this page has every command and what it changes, grouped as
the help is. The code: `cli/cli.ts`, then each command's module.

## How every command behaves

- **Output:** one line, `✓ command: summary [status]`, then its checks (`✓`, `✗`, or `·` for one
  that doesn't block, each with its fix), the planned actions and the next steps. `--json` prints
  the same as one JSON object.
- **`--yes`:** anything that writes outside this checkout (GitHub, Cloudflare, another machine)
  needs it. Without it, you get the plan of action, `requires-approval` in `--json`, and exit code 0
  (a plan shown isn't a failure).
- **`<p>`** is a project id, or the path of any checkout of it. **`<id>`** is a project id only.
  Both must be in this machine's index (`ship sync` builds it).
- **Secrets** are never printed. A command takes a key from your credentials file or a hidden
  prompt, or names the `gh secret set` line to run.
- **`-h`, `--help`** after any command prints the short list.

| Exit code | Status | Means |
|---|---|---|
| 0 | `succeeded`, `skipped` | done, or nothing to do |
| 1 | `failed` | it ran, and something went wrong |
| 2 | `blocked` | it can't start: a missing argument, a failing check, a dirty checkout |
| 3 | `requires-approval` | the plan of action: run it again with `--yes` |
| 4 | `unsupported` | not for this project or machine, or an unknown command |

## Set up and check

| Command | Does | Changes |
|---|---|---|
| `setup [<step>] [--new]` | Shipify from nothing, a step at a time ([getting-started.md](getting-started.md)); `<step>`: that one alone, an add-on's too (`apps`, `updates`) | a key you paste: your credentials file, and shipify's secrets; your values, shipify's variables |
| `doctor [--yes]` | checks this machine | `--yes`: records this PC's token date in `SHIPIFY_KEY_DATES` |
| `stacks` · `presets` | what you can build with | – |
| `plugins` | every kind of plug-in: its contract, its test, what's there now | – |
| `selftest [<part>\|<plug-in>\|<agent>]` | each part's live check, end to end (a gateway by name: its key, taken by it) | `chat`: a task on shipify, answered and closed; `<agent>`: a question it answers, asked through your Telegram (the one way this PC asks as you), so its answer comes there; the task closes itself after a quiet day |

**`setup`** checks each step against the real world, so it stores nothing: stop any time and run
it again. The core first, four steps to a first answer: GitHub (this PC's tools, your copy on your
own account or an org, this PC's login, your time zone), the bot, the agent's login (pasted at its
hidden prompt; setup sets the secret), and a box with the sandbox. Then the add-ons, none of which
blocks: chat and repeats (the door, the watch), the plug-ins, other accounts, and apps (your host's
keys and values), updates (a private template's key). In a terminal it takes each key at a hidden
prompt and checks again when you press Enter. Elsewhere (or `--json`) it reports and stops.
**`setup <step>`** does that step's part in a terminal (an add-on's too: `setup apps` takes your
host's key, finds your account and workers.dev name with it, and sets your values; `setup updates`
takes the template's key), then checks it. **`--new`** asks for its key again, to replace one:
`setup agent --new` renews the agent's login (or its gateway's key, when `SHIPIFY_AGENT` names an
agent through one).

**`doctor`** checks:
- Node 22, `pnpm`, `git`, `gh`, `make`, and what each stack needs;
- the host: CPUs, memory, 5 GB free disk, a 48-bit kernel on arm64;
- the plug-in files (`tools.json`, `executors.json`) and the default agent;
- on a box: its setup version and the agent's sandbox;
- the watch: its last due run that worked (over a day means it stopped);
- each tool's keys, where the run has them;
- the GitHub login (a fine-grained token that reaches the org, not expiring within 30 days, git
  over HTTPS through `gh`), or in a job, that its token reaches shipify;
- the credentials file: there, `chmod 600`, holding what each stack's deploys need;
- your copy holds only Shipify's settings: a variable on no list, or a value kept as a secret, is
  named with the command that deletes it ([settings.md](settings.md); it deletes nothing).

It exits 2 when a blocking check fails. `--yes` writes one thing: this PC's token date, as "this
PC's token" in the variable `SHIPIFY_KEY_DATES`, so the watch reminds you before it expires.

**`selftest`** parts, run in this order (`all`, the default, runs every part that's set up, then
each plug-in set up on this PC):

| Part | Checks |
|---|---|
| `core` | the plug-in files, the queue answers, the watch's last due run is recent, the default agent is here |
| `door` | `door check` (below) |
| `chat` | a message through the door becomes a task, sent again it's written once, a run answers it, and the reply reaches your chat once |
| `sandbox` | each slot's agent can't read the runner's folders, its environment or another slot's runs: on a box, right there; from the PC, each box's last clean-up |
| `act` | each tool's server offers every act call `tools.json` lists |
| `notebook` | a run's prompt carries the notebook |
| `<plug-in>` (`notion`, `telegram`) | its entry's `check`, with the keys `ship add` kept on this PC |
| `<agent>` (`pi`, `opencode`, `claude`) | a question through the door with `use <agent>`, its run followed: the box has the agent as `executors.json` pins it, it answered, and the reply reached your chat. One model call; never in `all` |

`door` and `chat` run in `all` once `door setup` has. `chat` and `<agent>` need `ship add telegram`
done on this PC.

## The door, plug-ins and the notebook

| Command | Does | Changes |
|---|---|---|
| `door setup [--new [--key file.pem]] [--yes]` · `door setup --code <code> --yes` | makes the edge's door App, puts its key on the edge (`--code`: finishes one GitHub made when the page couldn't, the code in its address, as `bot --code` does) | an App on GitHub, a Worker secret, shipify's variables, a run of `ci.yml` |
| `door check` | the edge, the door App, each chat's route, and the status page once set up | – |
| `door page [--yes]` | the status page and the web chat: the Access application's steps (path `admin/*`), its two public values saved, the sign-in checked at `/admin/status` | shipify's `SHIPIFY_ACCESS` |
| `add <name> [--new] [--yes]` | sets up a plug-in from its `tools.json` entry's `setup`, or a gateway's key (`executors.json`'s `gateways`: `add openrouter`) | its keys (a shipify secret, or a Worker secret for a channel), and its steps; for a gateway, its secret and `SHIPIFY_GATEWAYS` |
| `remove <name> [--yes]` | undoes it | its own undo, then its keys; for a gateway, its secret, its credentials line and its `SHIPIFY_GATEWAYS` record |
| `notebook [list]` · `notebook read "<topic>"` | the notebook's pages, or one in full ([notebook.md](notebook.md)) | – |

**`door setup`** ([door.md](door.md#setting-it-up)): needs the deploy token and account id in your
credentials file, and `APPS_DOMAIN`. With `--yes`: a page on this PC sends GitHub the App's
manifest; you press **Create**, then install it on shipify only, then set **Variables: Read-only**.
Its key goes straight to the edge's Worker (`SHIPIFY_DOOR_APP_KEY`, never printed or saved). It
sets `SHIPIFY_DOOR_APP_ID`, `SHIPIFY_DOOR_SLUG`, `SHIPIFY_DOOR_INSTALLATION`, `SHIPIFY_DOOR_URL`,
`SHIPIFY_REPO_ID`, `SHIPIFY_OWNER_ID` and `APPS_DOMAIN`, then starts `ci.yml` on main to deploy the
edge. Set up already: skipped. **`--new`:** a new key for the same App, made on its page. It reads
the newest one GitHub downloaded (or `--key <file>`), checks it's that App's, and puts it in place.

**`door check`:** shipify's variables for the edge are set; `/health` says `shipify-edge` with its
version and commit; the door App reaches shipify alone with exactly its permissions;
each chat's route someone's on answers 401 without its proof (one no one's on: not added, nothing
fails); each failing check names its fix.

**`add`:** without `--yes`, the plan: what you need first, each key and where it goes, its steps,
its check. With it: each key at a hidden prompt (or from your credentials file), kept there too;
then each step, checked; then the plug-in's check. A failure stops with the fix; running it again
carries on. **`--new`** asks for every key again: the one way to replace a key. **`remove`** stops,
keeping the keys, if its own undo fails. **A gateway** (`add openrouter`): its key at a hidden
prompt, kept in your credentials file and set as the shipify secret its entry names, checked with
the gateway (its `check` address answers 200), then recorded in `SHIPIFY_GATEWAYS` with the date.

**`notebook`** reads issues, so it runs on a box (or in a run).

## Create

The steps: [process.md](process.md) and [playbooks/plan-app.md](../playbooks/plan-app.md). All
local, except `plan submit` and `publish`.

| Command | Does |
|---|---|
| `plan new <id> --stack <id> [--preset <id>] [--visibility public\|private] [--title ..] [--summary ..]` | writes `plans/<id>.plan.md` from `guides/plan-template.md`. Refuses a bad id (3 to 32 lowercase letters, digits and dashes, starting with a letter, not reserved) or one with a plan |
| `plan check <id>` | the plan's rules: id, stack and preset, required sections, valid Mermaid, testable criteria each verified by a task, no open questions, no secrets |
| `plan submit <id> [--yes]` | checks it, then opens the plan PR in shipify through a temporary worktree. Merging it approves the build |
| `build <id> [--executor <id>] [--resume] [--source <dir>] [--into <dir>]` | builds an approved plan into `../projects/<id>` (below), or lays its stack's files out in `<dir>` (`--into`: a merged plan's run on a box, before its agent builds on them) |
| `new <id> --stack <id> [flags]` | renders a project straight from a stack, with no plan: for trying a stack and the golden tests |
| `validate <path>` · `verify <path>` | the contract ([design.md](design.md#projects)) · its `make verify` |
| `publish <path> [--yes]` | creates the repo and pushes (below) |

**`build`:**
1. checks the plan is the one merged on `origin/main`, and still passes;
2. renders its stack and preset (`--source` copies an existing site in);
3. writes the build prompt and runs the agent (`--executor`, or `defaultExecutor`). The `manual`
   executor stops with exit 3 and the prompt's path;
4. `--resume`, after implementing: `make verify`, then a commit.

**`new`'s flags:** `--preset`, `--staging`, `--secrets A,B`, `--options a,b` (such as `kv,d1`),
`--service <name>`, `--source <dir>`, `--visibility`, `--description`, `--output <dir>`,
`--dry-run`, `--skip-install`, `--skip-verify`.

**`publish`:** creates `<you>/<id>` (private unless the plan says public), its merge settings,
variables and secrets (from the credentials file, never printed), records the repo, pushes `main`,
and opens the PR that adds it to the forms. A secret it can't find stops it with the line to run.
In a merged plan's build on a box (`SHIPIFY_PUBLISH=prepared`), GitHub's machines already made the
repo and its keys, so it only records and pushes.

## Evolve

| Command | Does | Changes |
|---|---|---|
| `change new <p> <slug> [--title ..] [--bump patch\|minor\|major]` | the next change doc, `docs/changes/NNNN-<slug>.md` (default bump: minor) | – |
| `change check <p> <n>` | its front matter, sections, Mermaid, linked ADRs, testable criteria, a free number, no open questions or secrets | – |
| `change submit <p> <n> [--yes]` | checks it, then opens a docs-only PR: a big change's doc | a PR |
| `version <p> [patch\|minor\|major]` | bumps `shipify.json` and `CHANGELOG.md`, stamps pending change docs, runs `make version`. No bump given: the change docs decide. Refused for `"releases": false`; staging apps bump through `release` | – |
| `release <id> [--yes]` | staging apps only: bumps if needed, waits up to 25 minutes for staging, opens "Release vX.Y.Z" against `production` | pushes `main`, a PR |
| `upgrade <p> [--yes]` | the current stack version, on a branch `upgrade/<stack>-<version>`: the stack's owned files replaced (its pipeline, `ship.yml`, among them), the project's own never touched, the migration notes shown, then `make setup` and `make format` | local files |
| `staging <p> on\|off [--yes]` | staging on (a release PR goes live) or off (a merge goes live) | the repo's merge settings, `production` |
| `pr <p> [--task <n>] [--title ..] [--summary ..] [--part-of] [--preview] [--no-verify] [--yes]` | the one way a change becomes a PR (below) | a push, a PR |
| `pr <p> --check` | what its PR needs besides tests (step 1's quick part), no checkout recorded in its commits (a helper's worktree, say), and no merge's conflict left in a changed file (`ship staging`'s, say); the box runs it before `make verify` | nothing |
| `refresh <p> [--no-fetch]` | brings a branch up to date with `main` (`--no-fetch`: against the `main` already fetched, as a box's fresh clone does) | local commits |

**`pr`:**
1. on this machine, the quick checks first: every change doc readable, and (apps without staging,
   packages) a version bump with its changelog section; then `make verify` and a scan for keys. The
   PR opens only when all pass. A task's box runs the same (`pr --check`, then `make verify`);
2. commits what's there (`--title`, or the last commit's subject) and pushes the branch;
3. opens the PR, or adds this change to the open one.

`--task <n>` names the task; `--part-of` links it instead of closing it; `--preview` labels the PR
so CI makes a link; `--no-verify` skips step 1, for emergencies only. It refuses `main` and
`production`.

**`refresh`:** undoes the branch's version bump, merges `main` (never a rebase), renumbers a change
doc whose number `main` took, keeps both sides of changelog conflicts, then redoes the bump. Other
conflicts stop it: fix them, then run it again.

## Tasks and boxes

| Command | Does | Changes |
|---|---|---|
| `sync [<id>]` | clones the org's projects that aren't here, fast-forwards clean ones, rebuilds the index, links `.claude/skills` | – |
| `forms [--yes]` | the forms' project lists, from the index | a PR in shipify |
| `tools list` · `tools check` | each tool in `tools.json`: its calls, keys and setup · whether each server's calls are all sorted into look or act ([tools.md](tools.md)) | – |
| `bot [--yes]` · `bot --code <code> --yes` | registers the GitHub App that opens task PRs (below) | an App, a secret, variables |
| `bot repos [--yes]` · `bot repos --code <code> --yes` | registers the repos App, for your other accounts (below, ADR 0045) | an App, a secret, variables |
| `bot repos <account> [--remove] [--yes]` | adds one of your accounts (`SHIPIFY_ACCOUNTS`) and opens the page that installs the repos App there, the account chosen; `--remove` takes it off | the variable; the page |

**Boxes** ([box-setup.md](box-setup.md)):

| Command | Does | `--yes` |
|---|---|---|
| `box add [<user@host>] [--name ..] [--slots N] [--manage] [--replace]` | makes a box, asking for sudo once: a Pi or VPS over SSH, or this PC with no target (its SSH settings and network left as they are; no `--manage`), with the same script: the runner user, one runner per slot (labels `shipify-box`, `box-<name>`), each slot's agent user (the sandbox), and `SHIPIFY_OWNER`. Once its check passes, each slot gets the `sandbox` label run jobs need. It takes Ubuntu Server 24.04 LTS or a newer LTS only, and refuses any other OS before anything happens. `--slots` 1 to 4 (a new box keeps 1 GB of its memory for the system and has a slot per 2 GB of the rest); `--manage` adds Tailscale and Cockpit; `--replace` takes over a registration with the same name. Run again to update it, while no task runs | needed |
| `box list` | every box: online, busy, its slots, "no sandbox", its Cockpit link; and whether the bot, the agent's login and publishing from a task are ready | – |
| `box remove <name>` | removes every slot's runner from GitHub, and stops this machine's services when it's its box (with sudo) | needed |
| `box status` · `start` · `stop` · `restart` `[<name>]` | this machine's box (its `shipify-box-*` services), slot by slot · on, at boot too · off until started · both; start, stop and restart with sudo. Stop asks first while a task runs | stop, restart while a run is under way |
| `box logs [<name>] [-f]` · `box peek [-f]` | every slot's log · what the agent is doing now (`-f`: keep reading) | – |
| `box health [<user@host>]` | disk, memory and swap, temperature, a pending restart, updates, services, each slot's memory: here, or over SSH | – |

**`bot`:** a page on this machine sends GitHub the bot's manifest; you press **Create GitHub
App** and install it on the org (All repositories). It sets the secret `SHIPIFY_BOT_KEY` and the
variables `SHIPIFY_BOT_CLIENT_ID` and `SHIPIFY_BOT_SLUG`. Then tick **Variables: Read and write** by
hand ([setup.md](setup.md#tasks-the-bot-and-the-agents-login)). If finishing fails, `--code` (from
the page's address, valid about an hour) finishes it.

**`bot repos`:** the same, for the repos App: public, with contents and pull requests write and
issues, actions, checks and statuses read, and no webhook. It sets `SHIPIFY_REPOS_KEY`,
`SHIPIFY_REPOS_CLIENT_ID` and `SHIPIFY_REPOS_SLUG`. Then `bot repos <account>` for each of your
other accounts: GitHub must know the account, and the App must be set up first
([setup.md](setup.md#another-account-the-repos-app)).

**What the workflows run** (you'd run one by hand only to debug it):

| Command | Run by | Does |
|---|---|---|
| `run task <n>` | `task.yml`'s run and `github` jobs, first | reads the task once (its issue, comments and status) and saves it for plan; outputs `account`, the other account of yours it works on, if any (ADR 0045) |
| `run plan <n>` | `task.yml`'s run job | carries on from the task's read, puts 👀 on what it read, fetches your files, writes `working`, and decides: outputs `do` and `profile`, the agent's `repos`, `account` and `account_repos`, and the run's `agent` and the name of its `login` secret |
| `run agent <n>` | the same, when plan named an agent | installs that agent in the box's shared tools the first time (its `install` in `executors.json`), checks it starts, and puts it on the run's `PATH` |
| `run think <n>` | the same, when needed | the agent (or a check's script) as the slot's own user, writing `result.json` |
| `run decide <n>` | the same | the result into writes; outputs what to mint: `repo` and its `account`, `act`, `workflows`, `files` |
| `run apply <n>` | the same | makes the writes, saves the status comment last, tells the door of each new reply |
| `run github <n>` | `task.yml`'s `github` job, on GitHub's machines | what's pending, once: a merged plan's repo and keys, an operation (release, down, up, rollback), or closing a dropped or started-over task's PRs (on another account, with the repos App's token there) |
| `run failed <n>` | `task.yml`, when a step broke before a reply | says so on the task, with its fix |
| `task plans <before> <after>` | `task.yml`, on a push of merged plans to `main` | starts each merged plan's task |
| `watch due` | `watch.yml`'s due run | starts each due task's run, each box's weekly clean-up; writes this box's health, "Coming up", the apps list and the schedule ([watch.md](watch.md)) |
| `watch cleanup [<box>]` | `watch.yml`'s cleanup run, on that box | closed tasks' folders and agents' old run folders removed (the job then prunes the package store and npm's cache, while no other slot runs); the box's shared tools kept to each agent's pinned version and the two newest Node versions (while no other slot runs); doctor; on the status task |
| `watch alert ['<findings>']` | `watch.yml`'s alert run | the watch's findings (the argument, or the door App's newest comment) into the record, and an alert reply |

## Operate

| Command | Does |
|---|---|
| `list` | every project in the index: kind, stack, visibility, URL |
| `status <id>` | one project: stack, repo, each URL's `/health`, last release, whether it's down, its last 5 runs, a waiting release PR |
| `reconcile` · `register <path>` · `unregister <id>` | the index on this machine: rebuilt from disk · one checkout added · one entry removed (nothing else touched) |

Apps only, each with `--yes`, through the app's pipeline (`ship.yml`):

| Command | Does |
|---|---|
| `rollback <id> [--to vX.Y.Z]` | production back to the previous version, or to a release tag |
| `down <id>` · `up <id>` | `SHIPIFY_DOWN=true` and paused: CI checks every merge but deploys nothing, until `up` · `SHIPIFY_DOWN=false` and resumed |

## Releases and updates

Shipify's own versions ([releases.md](releases.md)): built in one copy, published to the
template, offered to every other copy as a PR.

| Command | Does | `--yes` |
|---|---|---|
| `template [<owner/repo>] [--bump minor\|major]` | a release, from main as GitHub has it: the version (main's while the template lacks it, else the next one; patch by default), its notes from CHANGELOG's Unreleased, Shipify's own files (never your plans, recipes or checks; the forms' app lists empty), checked with `pnpm install` and `pnpm verify` in a folder of their own, then recorded on main (one commit) and published as one commit on the template. The first one makes the template (private, marked a template) and sets `SHIPIFY_TEMPLATE`. On GitHub: a task `shipify: release` (or `release minor`, `release major`) | needed |
| `update` | this copy: the template's newest release, as one PR "Shipify 0.x.y" with every version's notes since this copy's; yours kept (plans, recipes, checks, the forms' apps), and only what the template took out since this copy's version taken out. Up to date, its PR open, or one you closed: nothing. `update.yml` runs it weekly | needed |

## Environment

A few variables change where `ship` looks (`SHIPIFY_PROJECTS_DIR`, `SHIPIFY_CREDENTIALS`, …):
[configuration.md](configuration.md#environment-variables).
