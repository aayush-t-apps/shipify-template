# Security

Who holds which key, what the agent can and can't reach, and what to do if something leaks. The
design is ADR 0031's; the baseline every project gets is ADR 0006's.

**In short:**
- **You are the only approver.** Your merge on GitHub, or your `yes` to a list, from GitHub or your
  chat (ADR 0049). Nothing else approves, and nothing merges or deploys from a chat.
- **The agent only thinks.** It runs as a Linux user of its own, with read-only keys, and writes
  only its own folder. The box makes every change.
- **Write keys come after it.** They're minted once the agent has stopped, for the one repo the
  run changes, and an act key only for calls you approved.
- **A box keeps no secret between runs.** What needs more keys runs on GitHub's machines.

## Who holds which key

Names only: no value appears in any doc, file or log. How to make and replace each:
[setup.md](setup.md), "Tokens and secrets".

| Key | What it may do | Where it lives | Lasts |
|---|---|---|---|
| your GitHub login | everything: asks, approvals, merges | you, with two-factor sign-in on | always |
| `shipify-pc` | `gh` and `ship` on the PC: fine-grained, the org only | the PC's `gh` login | the date you give it (`ship doctor` warns) |
| `SHIPIFY_BOT_KEY` | mint the bot's one-hour tokens | shipify secret; a run's mint steps and the `github` job, never the agent's step | doesn't expire |
| `SHIPIFY_REPOS_KEY` | mint the repos App's one-hour tokens, on the accounts that installed it (ADR 0045) | shipify secret; its mint steps in a run and the `github` job, never the agent's step; the one step that reads every secret (a new project's keys) skips it by name, as the bot's | doesn't expire |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code's login | shipify secret; the think step (and a stay's, ADR 0057) only when the run's agent is Claude Code, handed to the agent on a pipe it reads once, never in its environment | a year |
| `AI_GATEWAY_API_KEY` | pi's and OpenCode's models, through Vercel's AI Gateway (a gateway; the `-vercel` agents): it can spend your Vercel credits | shipify secret; the think step only when the run's agent is one of those, handed to the agent on a pipe it reads once, never in its environment; the PC's credentials file | until you delete it in Vercel. Set a spend limit there |
| `OPENROUTER_API_KEY` | pi's models, through OpenRouter (a gateway): it can spend your credits there | shipify secret; the think step only when the run's agent is pi, handed to the agent on a pipe it reads once, never in its environment; the PC's credentials file | until you delete it on OpenRouter. Set a spend limit there |
| `SHIPIFY_NOTION_READ` | read the Notion pages you connect | shipify secret; the think step (a look key) | no expiry |
| `SHIPIFY_NOTION_WRITE` | change those pages | shipify secret; the apply step only, and only for calls decide found approved | no expiry |
| `SHIPIFY_DOOR_APP_KEY` | the door App (below): write your words onto tasks, read runs, runners and variables, on shipify only | the edge Worker only, put there from the PC by `ship door setup` | doesn't expire; rotate yearly (the watch reminds you) |
| `TELEGRAM_TOKEN` | the bot speaks and reads its own chats | the edge Worker; the PC's credentials file. Never on a box | until you revoke it in @BotFather |
| `TELEGRAM_SECRET` | proves a call to `/door/telegram` came from Telegram | the edge Worker; the PC's credentials file | until `ship add telegram --new` |
| `CF_DEPLOY_TOKEN` (`shipify-deploy`) | deploy Workers | each app's `CLOUDFLARE_API_TOKEN`; shipify secret (the edge's deploy, a merged plan's `prepare`); the PC's credentials file | see Cloudflare |
| a box's runner registration | take shipify's jobs, by its labels; no GitHub API access | on the box | until removed (GitHub drops a runner offline 14 days) |
| a project's deploy and runtime keys | deploy and run that app | that project's secrets | each its own |

**The tokens a run gets,** only while it runs:

| Token | Which steps | What it can do |
|---|---|---|
| the bot's read-only tokens (one hour each, minted right before each phase) | plan's; the finish's, decide's and apply's (ADR 0059: the finish fetches main with it, with no agent) | read every project: code, PRs, issues, statuses, runs |
| the agent's read-only token (one hour, minted right before think, and not renewed: an agent working longer reads GitHub only in its first hour, ADR 0059) | think (the agent's copy) | read the same, but in a work run only its project or repo and Shipify; a talk run reads every project, as its profile says. A read run's agent gets none: the box keeps it, for the task and your repos it reads (ADR 0044) |
| `GITHUB_TOKEN` (the workflow's own) | the task step, plan, decide, apply; the runner of think and of a stay, never their agent (below) | write shipify's issues and comments, start runs |
| the write token | apply, minted after decide | contents and PRs on the one repo decide named; workflows write only for files that match the stack (below) |
| the files token | apply, when the run made files | write shipify's `shipify-files` branch |
| an act key (a tool's write key) | apply, when decide found the calls approved | the approved calls, made by the box |
| the run's OIDC token | apply, and the plan step's file fetch | prove the run to the door; nothing else |
| the bot's full token | the `github` job, on GitHub's machines, no agent | a merged plan's repo, settings and keys; release, down, up, rollback |
| the bot's status token | the due run | read commits, statuses and runs, to follow deploys and previews |
| the repos App's tokens (ADR 0045), on a task on another of your accounts | plan's (read); the agent's (read, its repos there only); apply's write token (contents and PRs, one repo, never workflows); the `github` job's (its PRs there) | the same as the bot's, on that account alone |

## The agent's sandbox

On a Pi or VPS ([box-setup.md](box-setup.md#the-agents-own-user)), slot k's agent
runs as `shipify-agent-<k>`, a system user with no password and no login shell.

- **Started through one sudo rule:** `shipify ALL=(shipify-agent-1,…) NOPASSWD: ALL`, in
  `/etc/sudoers.d/shipify-agents`, installed only once `visudo` accepts it. The runner can become
  an agent; an agent can't become the runner or anyone else.
- **Kept per slot, never per task's work:** the slot's `cache` and `data` (its `~/.cache` and
  `~/.local/share` link there), so packages, pnpm and a test browser download once per slot. Only
  that slot's agent can reach them; pnpm checks its store's files before it uses them; the weekly
  clean-up trims what no run has read in 30 days. A task's work, home and files never outlive it.
  Its containers' images are kept in `data/containers` for at most a week
  ([What a box keeps between runs](#what-a-box-keeps-between-runs)).
- **A fresh folder per run:** `/srv/shipify-agent-<k>/run-<id>/`:

  | Folder | Holds |
  |---|---|
  | `home`, `config`, `tmp` | its HOME, the agent's settings and sessions (Claude Code's with a link to the skills in its read-only copy of Shipify, made as the agent), its temp files |
  | `work` | its own clone of the project or repo it changes, never the runner's checkout |
  | `read` | the repos the task reads (`look at`, ADR 0044), and what a talk run clones itself: newest commit only |
  | `in` | what it reads: the prompt (the playbook in it), your files, its tools' settings (`in/tools`, pi's settings folder and OpenCode's config), written as the agent |
  | `out` | what the runner takes back: `result.json`, files, its commits as a git bundle |

- **An empty environment:** every command starts with `env -i` and only the names it needs.
  Secrets come on stdin, never on a command line.
- **What it holds:** its login (only the run's agent's: its own, or its gateway's key, which
  reaches it because it calls the model), a read-only GitHub token, the tools' look keys. A read
  run's agent holds its login alone (below).
- **Its login on a pipe, never in its environment:** the wrapper puts it on fd 3, a pipe the agent
  reads once at its start. Claude Code reads it with its own setting, and pi and OpenCode through
  Shipify's gate, which hands it to the gateway's provider alone (OpenCode's config holds no key, so
  an OpenCode without the gate can't call the model). So a command the agent runs, or a page that tricks it into
  running one, finds it nowhere: not in its own environment, not in the agent's
  (`/proc/<pid>/environ`), not in a file, and the pipe is empty by then. Nor in the agent's memory:
  the kernel lets a process read only its own children's (`kernel.yama.ptrace_scope` 1, Ubuntu's
  own). The sandbox check proves both with a dummy login. The read-only GitHub token and the look
  keys stay in its environment, since `gh` and the tools' servers read them there.
- **Its clone's key** reaches git through the clone's own environment, on stdin (`GIT_CONFIG_*`,
  `cli/lib/clones.ts`), never on its command line, where `ps` would show it to the box's other
  users. The agent's own git is given no key: its clone has every object it needs (the same read
  token reaches the agent as `GH_TOKEN` in a talk or a work run, for `gh`).
- **What it never holds:** a write token, `GITHUB_TOKEN`, an act key, a channel's key, the door's
  keys, a deploy key, the run's OIDC request. The sandbox refuses those names outright
  (`cli/lib/sandbox.ts`).
- **Its own settings only:** Claude Code starts with `--setting-sources user --strict-mcp-config`,
  pi with `--no-approve` (nothing of a project's `.pi`), and OpenCode with no project config,
  plugins, Claude Code files, repo's skills or logins of its own, and its own config folder
  read-only, so nothing in a project's files adds hooks or tools, and nothing is installed when it
  starts.
- **The same rules at every ask:** before each one (the first, a catch-up, the fix round), what its
  agent reads its rules or code from that a command could write is made fresh, as the agent: its
  settings folder (`in/tools`, pi's whole settings folder) emptied and given again, Claude Code's
  `settings.json`, OpenCode's `~/.opencode`, its cache and its own config folder. So a run, or a
  dependency's install script it ran, can't change the rules a later ask starts with: a hook, a
  plugin, an extension, an address for the model's calls. OpenCode's sessions' database stays
  between asks (its sessions are there), and holds a login whose config OpenCode fetches, so its
  gate also checks the config OpenCode runs with: a plugin besides the gate, or the gateway's
  calls sent anywhere else, and the key is never handed, and the run says why.
- **pi's gate is Shipify's rules, not pi's:** pi has no permission system of its own, so Shipify's
  gate (`cli/lib/agents/pi-gate.mjs`) checks each of its tool calls before it runs: the commands
  every agent must never run, the folders it may write, the look calls
  ([agents.md](agents.md#pis-adapter)). OpenCode loads the same checks as its plugin
  (`opencode-gate.mjs`), since its own rules miss `env git push` and `/usr/bin/git push`; its
  helpers run in its process, under the same gate, which names each call it checks, so a helper's
  read of the web counts as the run's ([agents.md](agents.md#opencodes-adapter)). The Linux user,
  the read-only tokens and no write key remain the real boundary.
- **An agent's own rules are a layer, not a wall** (ADR 0041, ADR 0043): so there's no list of what
  it may run. It runs any command but `git push` and `git stash` (refused in every part of a
  command, and after git's options), reads anywhere its Linux user can, and writes in its clone and
  `out/`. Those rules keep it from the box's jobs and bind the helpers it starts in its own
  process. pi's and OpenCode's gate also looks inside another command (`sh -c '…'`, `eval`, find's
  `-exec`) and past a wrapper or a path (`/usr/bin/env`, `sudo -u who`); Claude Code's rules
  don't, and a program a script runs isn't matched by any. Those fail all the same on the walls
  below, which hold for it, its helpers and anything it starts.
- **The walls it can't cross:**
  - the runner's home, `/home/shipify` (0700): its runners, jobs' folders, logins and caches;
  - anything the runner writes (its services run with `UMask=0077`);
  - a runner process's environment (`/proc/<pid>/environ`), where the job's tokens are;
  - another slot's runs (each slot's folder is 2711, its own: another user can pass through it,
    never list it or enter a folder in it);
  - on WSL, Windows: its drives and its programs, which `/etc/wsl.conf` closes
    ([box-setup.md](box-setup.md#this-pc));
  - any private network (box setup 9): your home network (the router, a camera, a NAS, another
    box), the tailnet and a cloud's metadata address; and every IPv6 address but `::1` (box setup
    11), since a home network's IPv6 addresses are public. A table of its own in nftables refuses
    what the agent's user, or an ID of its containers' range, sends there; DNS alone stays open.
    The setup proves it, over IPv4 and IPv6, before the slots get their label
    ([box-setup.md](box-setup.md#the-agents-own-user));
  - the box's own SSH and Cockpit on `127.0.0.1` and `::1` (ports 22 and 9090, box setup 10), where
    an agent could keep guessing your password. Another service of yours on the box's `127.0.0.1`
    is open to it: keep a password on it;
  - a root container socket (`/run/docker.sock`, `/run/podman/podman.sock`) or the docker group:
    either would give it the box, so it can write to neither;
  - the machine's tools in `/opt/shipify`: it reads and runs them, and changes none.
- **Containers, its own** (box setup 8, ADR 0064): `docker run` and `docker compose` are rootless
  Podman as the agent's own user, in a user namespace it owns, with a range of 65,536 IDs of its
  own (`/etc/subuid`). No Docker Engine, no root daemon, no socket. A container reaches only what
  its agent reaches (the network, its slot's folder), and gets no key the agent doesn't pass it.
  **The one limit set aside:** inside that namespace the agent is root, so it reaches more of the
  kernel's code (mounts, network namespaces, firewall rules there); a kernel bug there could give
  it the box. It could already do this before, through `aa-exec` and one of Ubuntu's own AppArmor
  profiles, so this isn't a new reach, and Ubuntu's limit on user namespaces was never a wall here.
  What defends it is the kernel's security updates, installed each day with a restart at 04:30
  when one needs it. A stronger wall (gVisor, a VM per run) is for later, if a run ever needs it.
- **Nothing outlives its run:** after it thinks, and at its time limit, every process of its user
  is killed, and checked gone (its range's too: its containers' processes) before any step with a
  write key starts. It can't use cron or at. Its containers' records, volumes and networks go when
  the slot's next run starts.
- **A check** (`checks/<name>.mjs`, a repeat's script) runs the same way: as the agent's user, with
  no keys, for a minute at most.
- **Proven, then labelled:** `box add` checks every wall before it gives the slots the `sandbox`
  label, which run jobs need. With Podman, that includes a container run as one agent the whole
  way: the box's kill must leave no process of the agent or its range. `ship doctor` checks again
  in each box's weekly clean-up (the socket wall too), and `pnpm ship selftest sandbox` reads that
  from the status task.
- **Every box is set up this way,** this PC's too (`box add` with no target): one script, one
  sandbox, and the same check before the label (ADR 0047). On this PC, its SSH settings and network
  are left as they are.

## A repo you don't own

ADR 0044. A repo outside your account (`look at acme/tool`) is data. A prompt injection needs three
things: your private data, the untrusted text, and a way out. The **read** profile leaves only the
text, and a command list never could (`cat /proc/self/environ` and the web reach past one).

- **Reading tools only:** Claude Code runs with `--restricted --tools Read,Grep,Glob` (no command or
  code tool, no WebFetch, file tools kept inside its folders; recorded live in
  `tests/fixtures/claude-decisions.json`), pi with `--tools read,grep,find,ls
  --no-context-files` and OpenCode with every tool but `read`, `list`, `glob` and `grep` denied,
  their gate keeping reads inside its folders, links resolved. Its folders are
  `read/`, your files and Shipify's copy; it writes nothing.
- **No key:** its agent gets its login and nothing else: no GitHub token, no tool's look key. Its
  login stays out of its reach too: it runs no command, its login is on a pipe and not in its
  environment, and no file tool reaches outside its folders.
- **A clone made from nothing:** the box clones it as the agent's user with no key and no
  credential helper, depth 1, links checked out as plain files (`core.symlinks=false`), no
  submodules. Nothing in it is ever run: no setup and no checks.
- **Outside content:** its notes and pre-approved calls wait for your `yes`, as after the web; it
  sets no repeat (a repeat is a future run); and every image in its reply, in any field, is made
  inert where the reply is posted (GitHub's image proxy would fetch it, and a URL can carry data),
  as for every run that read outside content. Telegram's link previews are off on every send.
- **It stays a read:** every later run of that task (one on a schedule too) is a read run, since its
  conversation carries what the repo said. Its folders are `read/` and your files, never
  Shipify's copy, and its prompt has none of your notebook: nothing private is in its reach.
- **It changes nothing:** a change because of it is asked for in a new task.

## Your other accounts

ADR 0045. Shipify works on another account of yours through a second GitHub App, the repos App.
Three rules keep that as safe as your own account:

- **An install gives access; your list gives trust.** The App is public, so anyone can install it.
  Only the accounts in `SHIPIFY_ACCOUNTS` (`ship bot repos <account>`) are yours, each by GitHub's
  id for it: a login given up and registered again by someone else is another id, and the task says
  so instead of working there. A repo anywhere
  else is outside, read as above, wherever the App is installed. So a stranger who installs the App
  on a repo planted with instructions gains nothing: that run holds no key and runs no command.
- **One task, one account, holding only that account.** Its run gets the repo's own key (the
  repos App's, for the repos it reads there) and Shipify's rules. It doesn't get your notebook,
  your tools' keys or your other repos, since that account's repos are written by other people
  too. Its notes wait for your `yes`, and its replies' images are inert, as after the web. A repo
  on any other account, named in its words, is told and not read. Its PR's title and description
  are masked for keys, as every reply is, since other people read them.
- **Each token comes from the App on its repo's account,** minted right before its step: the bot
  for Shipify's own, the repos App for another. The task step reads the task first and names its
  account, so plan's token is for it. The repos App can't write workflows or touch settings or
  secrets, and has no webhook.

What's left: its agent still has the web in reach, as every talk and work run does, to send out
what it read (it reaches no private network since box setup 9; a list of allowed internet hosts is
on the [roadmap](roadmap.md)). Its login isn't: it's on a pipe, out of its commands' reach.

## Write keys come after the agent

A run's steps, in order: **task → plan → think → decide → mint → apply**.

- **Decide's outputs** come from fixed lists only (plain words): the repo, the tool to act on,
  whether workflows change, whether there are files. A step refuses any other output.
- **The write token** is minted for exactly the one repo decide named. No repo, no token.
- **An act key** reaches apply only when decide found:
  - your `yes` to exactly these calls; or
  - calls that fit a pre-approved form in `tools.json` (its target fixed, its text capped), in a
    run that read nothing from outside, or only the look calls of the tools its form names in
    `after` (ADR 0049). Never after the web, a check, a repo outside your account, a run on another
    account, or the agent saying it read outside.
- **"Read from outside"** counts every ask of the run (the first, each catch-up, the fix round).
  Think records two things: the tools whose look calls it made (`looked`), and whether it read
  anything else (`elsewhere`): each agent's adapter says when it used its web tools or ran a
  command that fetches (a URL in it, or `curl` or `wget`; for pi and OpenCode, a bash command), a
  check ran, or it read repos outside your account. `readOutside` is their sum. After any of it, a
  tool's reads too, the notes the run proposes wait for your `yes` and its reply's images are
  inert.
  Its network is otherwise the internet's, with no private network (box setup 9), until a list of
  allowed hosts ([roadmap.md](roadmap.md)).
- **A form fixes its target:** each act call names the argument that says what it changes
  (`args.<call>.target`: Notion's `parent` and `page`), and the tool contract refuses a form that
  doesn't fix it, so no form writes wherever a capped string points.
- **The record's token beside a running agent, in the runner alone** (ADR 0057, ADR 0059): think's
  runner reads your `stop` and your words with `GITHUB_TOKEN`, which lasts the job, and a stay's
  posts its answers with it. Its agent never holds it: the sandbox refuses the name, and the agent
  is its own user, with `env -i`, that can't read the runner's environment or memory (the walls
  above). So the rule is one: the record's token may be in a runner's process while its agent
  runs, and never in the agent's; a write token, an act key, a files token or a channel's key never
  in either, minted only after the agent.
- **A stay's answer that needs a key** (ADR 0062): the stay's step ends with it decided, and its
  outputs come from the same fixed lists as decide's. Only then do the steps after it mint those
  keys, the same mints as decide's, and apply it: **stay → mint → apply**, its agent done.
- **`tests/workflows.test.ts`** holds `task.yml` to this: in think and a stay, the record's token
  only as `SHIPIFY_ISSUES_TOKEN`, no write token, act key or channel key, and write tokens only
  after the agent.

## Apply never runs the agent's code

- **The bundle, not the folder:** apply fetches the agent's git bundle into a clone of its own,
  with git's hooks and file monitor off (`core.hooksPath=/dev/null`, `core.fsmonitor=`). Nothing in
  the agent's folder runs as the runner. That clone holds history without file contents, and only
  the files its checks read (the change's, `shipify.json`, the workflows) are checked out
  (ADR 0044).
- **A secret scan** (gitleaks, pinned) on what it would push. A find stops the push and says which
  file. Its config (`cli/lib/gitleaks.toml`) keeps gitleaks' own rules and adds GitHub's stateless
  installation tokens (`ghs_<app id>_<JWT>`, from 2026-04-27), which those miss. Every reply, log
  and chat message is masked for the same shapes (`cli/contracts/mask.ts`, the box's and the
  edge's).
- **Workflow files** are refused unless each one is exactly what the project's stack renders (what
  `ship upgrade` writes). Only then does the write token get workflows write. A repo that isn't a
  project has no stack: a change to its workflow files is always refused (you make those).
- **Only the task's own branch:** `task/<n>-…` or `plan/<n>-…`, or a new project's first push into
  an empty repo's `main`. Never `production`, an existing `main`, or a repo's default branch.
- **No project code:** apply never runs `make`. `make verify` runs in think, as the agent: once by
  the agent, then again by the step.
- **The commands every agent must never run** (`executors.json`'s `commands`) are `git push` and
  `git stash`, written as each agent's own rules (Claude Code's flags, pi's and OpenCode's gate); the sandbox and
  the read-only token are the boundary.

## Only you start work

`task.yml`'s run job starts only for:
- **your events,** from the account in the variable `SHIPIFY_OWNER`;
- **the door App's comments** for you, each with a hidden `from` line (who, which chat);
- **a dispatch from `main`** carrying only a task number (and which job). It does only what the
  task's status already has pending;
- **a push of merged plans** to `main`.

And never:
- for a PR, the status task or a notebook page;
- for anyone else's comment;
- at all, when `SHIPIFY_OWNER` isn't set.

The watch starts runs by adding a label as the door App, never with Actions write. `watch.yml`
takes a label only on the status task, and only from you or the door App.

**Only your words are instructions:** the task's title and body and your comments. Files, web
pages, a tool's answers and anyone else's text are data, never a command
([playbooks/task.md](../playbooks/task.md)).

## Approvals

- **Two approvals:** your merge, on GitHub; or your `yes` to a list (ADR 0049).
- **A `yes` counts** only as your whole message, unedited, from you: on GitHub, or through your
  chat (the door writes it for an id in `SHIPIFY_PEOPLE`); after the list it approves, within a
  day, with no edit to the task since. A door comment edited later isn't the door's, so it's
  ignored.
- **A list's Yes** sends `yes <code>`, and its No `no <code>`: the first 8 characters of the
  fingerprint of all it lists. Each counts only for the list with that code, so a Yes or No under an
  older reply can't approve or drop a newer list; one with no list waiting is answered, and changes
  nothing.
- **The list shows the exact calls** and arguments the approval covers, never the agent's
  description of them: once (the box removes any copy in the agent's words), last and whole in
  every chat. A list over 3,000 characters is approved only on GitHub, since a chat can't show it
  whole.
- **From a chat: one flow, one rule** (ADR 0049, 2026-10-18). Every word, task and release works
  the same from a chat as on GitHub. Two things happen only on GitHub, where your GitHub sign-in
  (and its two-factor) says it's you: a PR's merge (code reaches `main`, and production, only
  through it), and the operations that change the live app at once with no merge: taking an app
  down, bringing it back and a rollback. From a chat those three run nothing; the reply links the
  Operate form, and a chat's `continue` on one doesn't run it again. What a chat can start, and
  why that's enough:
  - `go` and `publish` start only what you merged (a change doc, a plan): the merge approved it.
  - `preview` deploys an open PR to its own preview, with no runtime keys; `start over` closes a
    PR (its commits stay on GitHub) and starts a new branch. Neither reaches `main`.
  - A release opens a PR that only your merge deploys.
- **What you accept:** whoever holds your Telegram account, your Access sign-in or your Cloudflare
  account (the edge holds the door's key) can approve a list. A list is calls to your tools only:
  today Notion, on the pages connected to the write integration: creating pages, setting
  properties, and replacing a page's whole body (`update_page` with `content`, whose list line
  says so), which deletes its old text blocks. It never deletes a page: subpages and
  sub-databases are kept, and a page with a block holding others is refused. Notion keeps page
  history, so a replaced body can be brought back there. They can start runs and a release as you
  (above), and still can't merge a PR or take an app down, bring it back or roll it back. So turn on Telegram's password (Settings →
  Privacy and Security → Two-Step Verification), and keep the Access sign-in to your own email.
- **A routine's form:** a page someone else wrote that a routine reads (a shared page, a web clip)
  could steer what it writes, but only within its form: its one target, its caps, its `max`. Keep
  the target private. What it writes is text blocks only, so the form isn't a way out.
- **A bot's push never deploys production:** the pipeline's step "Only the owner's merges go live"
  refuses it. A bot may push only a new project's first commit and a release's version bump to a
  staging app's `main`: the version in `shipify.json` and `package.json` and nothing else in them,
  `CHANGELOG.md`, and the change docs it stamps released.
- **The status comment** counts only when a run wrote it and last edited it. An edit by anyone else
  is ignored and said.
- **The notebook** keeps only your words: a note that looks like a key is refused, and a page
  someone else edited is left out of prompts ([notebook.md](notebook.md)).

## Releases and updates

[releases.md](releases.md). One direction: the copy where Shipify is built, then the template,
then each copy.

- **The template holds no key and no one's data:** Shipify's own files, never a copy's plans,
  recipes, checks, app lists, settings or secrets. A release checks every file it publishes
  (`pnpm verify`) before anything leaves.
- **A release starts from a task** (`shipify: release`), on GitHub or from a chat, as every
  operation does; the first one, which makes the template's repo, only from your PC.
- **An update is a PR,** on its copy, by its bot, showing every line it changes. Nothing merges by
  itself, and a closed one stays closed.
- **Its keys:** the bot's, one hour, for that copy's branch and PR (its workflow files too); a
  private template on another account takes a read-only key, Contents only, on that repo alone
  (`SHIPIFY_TEMPLATE_TOKEN`).
- **A public template** (ADR 0055) carries nothing of yours:
  - your words (`SHIPIFY_PRIVATE_WORDS`) are replaced in what's published;
  - every release is checked for them, tailnets and keys before anything leaves;
  - its workflows never run on a pull request, and do nothing without a copy's variables;
  - Issues are off, and interactions are limited to collaborators.
- **Your copy stays private:** `box add` and `ship doctor` refuse a public one. On a public repo
  anyone's issue could reach a box.
- **A box in Docker** (ADR 0056): the image holds no key and no one's data, built from
  `setup.sh` by the template's release. It never runs privileged, nor with the Docker socket, and
  its sandbox is checked inside it at `register`. The volume keeps only the runners'
  registration, as a box's `/home/shipify` does.
- **The one command** (`here.sh`, box-setup.md) installs nothing it hasn't checked: gh's and
  Node's downloads against their checksums. Your approval is a GitHub code you enter on your
  phone. The login lives in a folder it deletes on every exit, and it prints where to revoke it.
  A start-up script can't run it: it needs your terminal. With `--manage` it adds the firewall
  and Tailscale as `box add --manage` does, and leaves the machine's SSH settings as they are,
  since you set it up there and not over SSH: SSH by key only comes from a `box add` over SSH.

## The edge: the door and the watch

One Worker on Cloudflare (`shipify`, at `shipify.<your workers.dev name>.workers.dev`, or
`shipify.<APPS_DOMAIN>` with your domain), deployed by shipify's `ci.yml` after its checks. No
previews. Details: [door.md](door.md).

- **Its routes,** each proving its caller before it reads anything else:

  | Route | Proof |
  |---|---|
  | `POST /door/<channel>` | its adapter's proof (Telegram's secret header), a private chat, a sender in `SHIPIFY_PEOPLE` |
  | `GET /admin/status` | Cloudflare Access's sign-in, then its token checked by the edge (below) |
  | `/admin/chat/`, `/admin/chat/api/*` | the same as `/admin/status`, on every route; a `POST` also needs the edge's own `Origin` and `x-shipify-chat: 1` ([below](#the-web-chat)) |
  | `POST /door/replied` | the run's GitHub OIDC token |
  | `GET /door/file/<ref>` | the run's GitHub OIDC token |
  | `GET /health` | none: its version and commit only |
  | `GET /draw/` | none: the chat's diagram frame, a static page with no data ([below](#the-web-chat)) |
  | `GET /note/icon.png`, `/note/badge.png` | none: a notification's two pictures, which a phone fetches with no sign-in |
  | `GET /`, `/admin` | none: a redirect to the chat, nothing shown |

- **OIDC, from runs to the door:** a run asks GitHub for a token with the edge's address as its
  audience. The door checks it against GitHub's published keys: RS256 only, the issuer, the
  audience, shipify's repository and owner (by numeric id), `refs/heads/main`, the workflow
  (`task.yml` or `watch.yml`), and the times (±60 s). No key is shared between boxes and the door.
- **Out:** the door reads the comment, checks a run wrote it with a reply line, sends it only to ids
  in `SHIPIFY_PEOPLE`, then marks it 🚀 as the door App.
- **The door App's permissions,** on shipify only:

  | Permission | Why |
  |---|---|
  | Issues: read and write | write your words onto tasks; the 🚀; the watch's labels |
  | Actions: read | see whether a task's run is queued or under way |
  | Administration: read | see the boxes' runners |
  | Variables: read | `SHIPIFY_PEOPLE`, `SHIPIFY_DOOR`, key dates |
  | Metadata: read | GitHub requires it |

  No Contents, Pull requests, Workflows, Secrets or Actions write. `ship door check` confirms it's
  installed on shipify alone with exactly these.
- **Its keys** (the door App's, Telegram's two) are put on the Worker from the PC with `wrangler
  secret put`. They're never printed, never shipify secrets, never on a box. The edge's deploy holds
  only the deploy token and never sends them.
- **It keeps nothing:** the record on GitHub is its memory.
- **Kill switch:** the variable `SHIPIFY_DOOR=closed`. The door writes and sends nothing, and says
  so to a chat. A run's file fetch is refused too, also when the door's settings can't be read.
- **The status page has two locks** (ADR 0032):
  - **Access's sign-in** on `/admin` alone (one application, "shipify status", path `admin/*`,
    your `allow-me` policy; it covers the web chat too), so the door's routes, `/health`,
    `/draw/` and `/note/` stay open to what calls them;
  - **the edge checks Access's token itself:** RS256 against your team's published keys, this
    application's audience, the team as issuer, and the time. No token, a forged one, or the page
    not set up: 403 and nothing shown. A missing Access rule fails closed: an application whose
    path still says `status` leaves `/admin` refused until it's changed.

  The page only reads (anything but GET is 405). It has no script and no form, escapes everything
  GitHub says, and is sent `private, no-store` with a strict CSP. It holds no key.

## The web chat

The chat at `/admin/chat/` (ADR 0036) is the edge's first page with scripts, so it has more locks:

- **The same sign-in as the status page:** every chat route, the page's own files included (static
  assets with `run_worker_first`), checks Access's token as `/admin/status` does (`accessTokenOk`).
  No token: 403. If Access doesn't cover `/admin`, the edge answers 403 itself: it fails closed.
- **Only the page may write:** a `POST` needs the edge's own `Origin` and the header
  `x-shipify-chat: 1`, so another site can't post for you.
- **Into the door, not around it:** a send goes through the door's own code as the `web` channel,
  with its person check and closed door. The web adapter proves those calls with an HMAC of the
  door App's key, which only the Worker has, so `POST /door/web` from outside gets 401. No new key.
- **No write API of its own:** it changes things only with words through the door, a `shipify: …`
  chat that ends in a PR, or your PC and GitHub. A list's Yes is such words (`yes <code>`);
  merges stay on GitHub.
- **Two locks on formatting:** GitHub renders the Markdown, then the edge cleans the HTML again
  (`edge/src/web/clean.ts`, a short allowlist: no scripts, styles, iframes, forms or event
  attributes; links and pictures https only). Then the CSP: `script-src 'self'`, `style-src
  'self'`, pictures only from the edge and GitHub's user-content hosts, `frame-ancestors 'none'`.
  Hidden lines (from-lines, reply lines, status comments) never reach the page.
- **Diagrams drawn apart:** Mermaid never runs in the chat. A `mermaid` block is drawn in `/draw/`,
  a static page with no data, in an iframe sandboxed to `allow-scripts` with no same-origin, so it
  can't reach the chat, its cookies or the door. It loads Mermaid 11.17.2 from jsDelivr, pinned
  with an SRI sha256 hash, and hands back the SVG, which the chat shows as a picture (an `<img>`
  runs no script). The chat's CSP allows frames from the edge alone (`frame-src 'self'`).
- **Files served safely:** only PNG, JPEG, GIF and WebP show inline. Anything else, HTML and SVG
  included, downloads as `application/octet-stream` with `nosniff` and a sandbox CSP, so no file
  runs on the edge's address. At most 5 a message, 10 MB each, kept 7 days. A file you sent on
  Telegram is served the same way, fetched through the bot (10 MB at most) and kept nowhere; only
  behind the sign-in, and never with the door closed.
- **The doc pane** (ADR 0065) adds two ways to see a file, and no new way in:
  - **Markdown, a CSV, text:** the edge reads the file's first 200 KB and sends words, never the
    file. Markdown is rendered by GitHub (`POST /markdown`, as the door App, which needs no
    permission for it) and cleaned by `clean.ts`, the same two locks as a message. A CSV comes as
    rows and text as text, which the page puts in as text, never as HTML.
  - **A PDF** (`?view=1` only, and only a file whose type or name says PDF): served as
    `application/pdf` with `nosniff`, so a browser reads it as a PDF and nothing else, and
    `frame-ancestors 'self'`, so only the chat frames it. It has no sandbox CSP, because browsers'
    PDF viewers refuse to run in one; a PDF's own scripts run in the viewer, apart from the page.
    Every other file, and a PDF without `?view=1`, downloads as before.
  - **Ask about this** sends a kept file's ref with your words (`up-…` or `run-<task>-…`, the
    store's own shapes, checked as before): it must still be in the store.
- **No secrets in the chat:** your words land on a GitHub task. The page warns before sending
  anything that looks like a key: use `pnpm ship add <tool>` on your PC instead.
- **Notifications** (ADR 0050):
  - **What one carries:** the state, the task's number and its title, and where a tap goes. Never
    a reply's words, a file's name or a list, since a lock screen shows it.
  - **Encrypted end to end** (RFC 8291) for each device's own keys: the push service carries it
    and can't read it. Each is signed (VAPID) with `WEB_PUSH_KEY`, a P-256 key made on your PC,
    put on the Worker from stdin and never printed or kept anywhere else.
  - **Devices only on known push services:** an https address on Google's, Apple's, Mozilla's or
    Microsoft's, so nobody can point the Worker at another address. Turning one on is a chat
    `POST`, with the same locks. The edge shows a device as a short id, never its address.
  - **The service worker** (`sw.js`) is the page's own file (`worker-src 'self'`), caches
    nothing, and opens only addresses inside the chat.
  - **A share stays on the phone** until you tap Send: what Android shares is held in the
    worker's memory for New chat, then uploaded as 📎 does. A forged share can only make a draft.
  - **No button on a notification:** a Yes stays behind your sign-in.
  - **Anyone holding your Cloudflare account** could notify your devices; they can already read
    what the edge reads.

## What a box keeps between runs

Nothing secret:

| Kept | What's in it |
|---|---|
| its runners' registrations | the right to take shipify's jobs, nothing else |
| `/opt/shipify/tool` | Node, and each agent a run has picked, at the version `executors.json` pins |
| `/opt/shipify/tool/shipify-app/<commit>` | read-only copies of Shipify, each with its CLI built as one file and no packages installed: what every step and the agent start (the three newest, and any a run is on) |
| the pnpm store, checkouts | code and packages |
| each slot's last run folder | the agent's clone and sessions, until that slot's next run (or 8 hours, by the weekly clean-up). Its token went in as a header and is kept nowhere |
| each slot's containers' images | `data/containers`: the images its runs pulled, for at most a week (the weekly clean-up removes them all). A run's containers, volumes and networks go at the slot's next run |

- **A job's tokens** live in its processes' memory and expire within the hour.
- **On GitHub's machines instead:** CI and deploys, a merged plan's repo, settings and keys
  (`prepare`), and operations. They run from `main`, with no agent.
- **The box itself:** SSH by key only, a firewall with `--manage`, no private network for the
  agents and their containers (setup 9), automatic security updates, and a runner user
  (`shipify`) with no sudo but the one rule ([box-setup.md](box-setup.md)).

**Left for later, by choice:**
- the run's mint steps hold the bot App's key on the box while they run (never in the agent's
  step); minting off the box would close that;
- the agents reach the whole internet (npm, the agent's API or gateway, GitHub, and the rest),
  though no private network (setup 9); a list of allowed hosts is for later, and would cover their
  containers too;
- an agent is root inside a user namespace of its own (its containers, ADR 0064): the kernel's
  updates defend it; gVisor as Podman's runtime, or a VM per run, would be a stronger wall;
- shipify's own `main` isn't protected (free private repos can't be).

## Every project's pipeline

ADR 0006, for every stack, in each project's own `ship.yml` (ADR 0048):
- **Its own:** it calls no other repo's workflow and hands no secret to one. Only its stack's
  render may change it, or `.github/actions/`: a run pushing anything else there is refused.
- **CI:** read-only permissions by default; actions pinned to commit SHAs; gitleaks by version and
  SHA-256; no `pull_request_target`; forks and Dependabot get no secrets and no previews.
- **Every merge** runs a secret scan, `make audit` and `make verify`.
- **A preview never gets runtime keys:** an app with runtime keys gets no preview. For the rest:
  the PR's code bundles itself with no keys (`make bundle`); on a fresh runner, `main`'s `make
  preview-from` uploads that bundle with the deploy key. The box ran the tests before the PR.
- **Deploy keys only for the deploy:** a merge's run reads the keys `shipify.json` names only after
  the checks pass, for `make deploy` and what follows.
- **Supply chain:** exact dependency pins at least 2 days old, a frozen lockfile.
- **Runtime:** logs redact keys, errors return a request id and not a stack, and `/health` shows
  nothing secret.
- **Operations:** external writes need `--yes`, and there's no delete path.

## The rules, and why

From [AGENTS.md](../AGENTS.md), for every person and agent:

| Rule | Why |
|---|---|
| Never read, print or ask for a token's value, or write a secret to a file | a value seen once lives on in a log or a transcript |
| Every change is a PR you merge; never merge what deploys production; never force-push or delete | the merge is the approval and its record |
| Create repos, set secrets or publish only with your go-ahead | each widens who holds a key |
| Nothing to sign in to on a box, and no sudo after `box add` (the runner's one rule starts its agents) | a box with no logins has nothing to leak |
| Versions change only in a PR (each agent's install in `executors.json`, Node 22, pnpm, actions); OS security updates, the runner's own and Node 22.x fixes excepted | nothing changes a run unseen |
| Free only; keys live with their boundary | a leaked key stays inside its boundary |
| An account is yours only when you add it; a run holds only what its repo's account may see | an install can't widen trust, and one account's text can't reach another's data |

## If something leaks, or a box is lost

**Stop switches, fastest first:** close the task; set `SHIPIFY_DOOR` to `closed`; disable
`task.yml` or `watch.yml` in Actions; `pnpm ship box stop` (or `box remove`); uninstall the bot or
the door App.

| What | Do |
|---|---|
| a key leaked | replace it as [setup.md](setup.md) says, then revoke the old one where it was made |
| the door App's key | regenerate it on the App's page, `pnpm ship door setup --new --yes`, then delete the old key there |
| Telegram's token | @BotFather → `/revoke`, then `pnpm ship add telegram --new --yes` |
| a gateway's key (`OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`) | delete it on the gateway's page, make a new one, then `pnpm ship add <gateway> --new --yes` |
| a box lost or stolen | `pnpm ship box remove <name> --yes`; a new agent login (`claude setup-token`, then set the secret); a new bot key (the App's settings → Private keys) and delete the old; remove the machine from Tailscale |
| a run did something it shouldn't | its run details and log show what it called, and the task's history who started it. Close the task, and fix the rule in a PR |

**Reporting a problem:** Shipify is private, with one owner. Tell the owner directly, and name a
key rather than pasting it.

Writing code that handles input, sign-in or secrets:
[skills/security-and-hardening](../skills/security-and-hardening/SKILL.md).
