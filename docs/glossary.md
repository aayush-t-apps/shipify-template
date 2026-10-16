# Glossary

Every doc, command, chat reply and page uses these words, each with one meaning. **Like** is the
closest idea from an operating system or a well-known system (ADR 0032, "The vocabulary"). It's there
to place each part quickly, not as a promise that it behaves the same in every detail.

## Tasks

| Word | Like | Means |
|---|---|---|
| **task** | a session: one conversation | one issue on shipify: a conversation and everything it leads to (a PR, a repeat, a deploy) |
| **run** | a process | one job on one task, on a box: task (its one read, and its account), plan, think (only if needed), decide, apply |
| **stay** · **staying** | HTTP keep-alive | after a run answers your words, it stays up to `SHIPIFY_STAY` quiet minutes (10) and answers your next plain words itself, in the same agent session, so they're answered in seconds (ADR 0057). The label `staying` is on the task meanwhile, and no other run starts for your comments. Anything else (a fixed word, another repo or agent, a change) goes to a normal run, and it gives way when another run needs its slot |
| **reply** | a program's output | the one way out: a comment by a run on a task, which the door copies to the chats it names. Its kind is answer, needs-you, live, alert or failed |
| **status comment** | a process's status line | a run's one comment on a task, kept up to date: its state, the last run, the runs table |
| **run details** | `time` and a resource summary | what a run did, at the end of its reply: agent, model, time, tokens, tools |
| **intent** | a command's verb | what you asked for, one of six: question, change, new, remember, repeat, operate (`intents.json`) |
| **fixed words** | shell built-ins | whole comments the box reads with no agent: `yes`, `no`, `continue` (or `again`), `start over`, `preview`, `publish`, `go`, `stop`, `stop repeating`, `resume`, `close`, `reopen`, `use <model>`. Each is accepted anywhere, or on GitHub only (`start over`, `preview`, `publish`, `go`: they act on code). Defined once, in `cli/contracts/words.ts`; `use` in `cli/contracts/use.ts`, where a model names its agent |
| **chat commands** | instant shell commands | `/ping`, `/apps`, `/repos`, `/help`, `/notebook`, `/recipes`, `/models`, `/tasks`, `/use`: the same answer everywhere, with no agent (at once in a chat; from a run on GitHub). Telegram's menu shows four: `/ask`, `/tasks`, `/use`, `/help` |
| **your model** | a user's default shell, set once | the pick a chat's new tasks start with (`/use` with no task), kept per chat at the edge and named in each new task's "Got it"; a task keeps its own (`/use` as a reply) |
| **button** | a key on a keyboard: it types for you | words you could type, sent for you by a tap: a question's answers, the fixed words a reply asks for, a model in the picker. A tap goes through the door as those words, as a reply to the button's message, so it can do nothing your words can't (ADR 0042) |
| **setting** | a config change, not a command | a `use …` alone from a chat (or a pick in the web chat), or a `close` or `reopen` the door did: kept on the task for your next message, starting no run of its own |
| **yes** | `sudo` for one command | your approval of the exact calls listed: your whole, unedited message, on GitHub or in your chat (a list's Yes button sends `yes <its code>`), after the list, within a day. The only approval besides a merge (ADR 0049) |
| **repeat** | a `crontab` entry | a task with a time: a **reminder** (its words, no agent, at most every 15 minutes), a **job** (the agent, at most hourly, quiet with nothing to say) or a **check**. It's labelled `repeats`; three failures in a row pause it, `again` runs it now. **Once** ("in 15 minutes", "at 17:30", "tomorrow at 9"), a reminder or a job runs one time, then ends: a check-back |
| **errand** | `gh pr checks --watch`, then a hook | a time once that waits for something instead of a clock: a PR's or a branch's checks to end, a PR to merge, or to be deployed ("when #12's checks finish, tell me"). The due run looks with one GitHub read and no agent, then the task's run fires once, as a reminder or a job. It ends then, or after a day (at most 7); only on your own account (ADR 0054) |
| **waiting** | a pending job's state | the label on a task with an errand, which is how the due run finds it, open or closed; its status line says what it waits for and until when |
| **recipe** | a unit file in `/etc/cron.d`, under version control | a repeat written as a file, `recipes/<name>.md`: `when`, an optional `check` and `model`, the job as its body. Merging it approves it; its task, "Recipe: <name>", is its log ([recipes.md](recipes.md)) |
| **example** | a sample config to copy | a recipe in `recipes/examples/`: not live until copied into `recipes/` |
| **check** | a health probe | a reviewed script, `checks/<name>.mjs`, that prints one value to watch. A repeat or recipe runs it as the agent's user, with no keys, for a minute at most, and replies only when its output changes |
| **pre-approved call** | a `sudoers` rule | a tool call `tools.json` allows with no `yes` (its `pre` forms, each fixing its call's target). Merging that file approves it. Never made after the web or a check; after a tool's reads only when its form names that tool in `after`, as a recipe that writes does |
| **profile** | a permission set | what the agent may touch in a run: **talk** (the web, the tools' look calls, and a project's or repo's code it clones itself when a question needs it), **work** (one project's or repo's clone, on its own branch, where it commits) or **read** (only the repos the task reads, files only: no command, no web, no key; a task that reads a repo outside your account, ADR 0044) |
| **notebook** | your dotfiles | what Shipify remembers about you: issues labelled `notebook`, a page per topic, read by every run. `remember: …` adds a line, `forget: …` removes one, `/notebook` lists the pages |
| **kept work** | a checkpoint | a failed or stopped work run's commits, pushed to the task's branch with no PR: where `continue` starts. Never into an open PR, never a new project's first push |
| **stuck** (shown as **Stopped**) | a stopped process, waiting for `fg` | a task whose run ended before it finished (the box restarted), or whose words got no run at all: nothing starts it but your `continue`, and it alerts once |
| **problem** | an error number with its message | an error, in one shape: what happened, and the one thing to do (`cli/contracts/problems.ts`) |

## The system

| Word | Like | Means |
|---|---|---|
| **the record** | the filesystem and its journal | everything Shipify knows, on GitHub |
| **the core** | the kernel | `ship`'s own code (`cli/kernel/` runs the flow): it decides what a run does and makes its changes. It names no plug-in |
| **the queue** | the scheduler's run queue | GitHub Actions' runs waiting for a slot. A task's runs go one at a time, up to 100 queued |
| **box** | a machine | a computer that runs Shipify's runs (a Pi, a VPS, this PC), keeping nothing between them |
| **slot** | a CPU core | one of a box's runners: one run at a time. Slot k's agent runs as the Linux user `shipify-agent-<k>` |
| **sandbox** | a user account with least privilege | the agent's own user, and a fresh folder per run, set up by `box add` |
| **GitHub's machines** | a separate trusted host | GitHub-hosted runners, for what needs keys a box must never hold |
| **prepare** · **operate** | an install script · `systemctl` | what `task.yml`'s `github` job does, once, with no agent: a merged plan's repo and keys · release, down, up or rollback (the Operate form) |
| **the edge** | the front door of a network | the Cloudflare Worker built from `edge/`, at `shipify.<your workers.dev name>.workers.dev` (or `shipify.<APPS_DOMAIN>` with your domain): the door, the watch, the status page and the web chat |
| **the door** | a mail relay | the edge's way in (it writes your words onto tasks) and out (it copies replies to chats, after checking the run's OIDC token at `POST /door/replied`). It answers the chat commands at once |
| **door App** | a service account | the GitHub App the door writes as, installed on shipify only (`ship door setup`) |
| **the watch** | cron plus a supervisor | the edge's check every 5 minutes: what's due, deploys, stopped tasks, notices of replies that didn't reach you, its guard (boxes, apps, channels, key dates), alerts. It rings the status task's runs by adding labels, and never starts a task's run (ADR 0042) |
| **due run** · **clean-up** · **alert** | a cron job · a weekly tidy · a syslog alert | `watch.yml`'s runs: what's due now (and recipes kept in step) · one box's weekly tidy · what changed, as a reply on the status task |
| **digest** | a weekly report | the due run's one message a week to your default chats (`SHIPIFY_DIGEST`, every Monday at 9:00 by default): boxes, apps, what waits on you, what's behind or due, the skills runs loaded; "all clear" when nothing is (ADR 0053) |
| **status task** | `/proc` and the system log | the platform's own task, labelled `shipify-status`: its record of boxes, apps, coming up, recipes and recent events |
| **status page** | a dashboard such as `htop` | `<the edge>/admin/status`: a read-only view of the status task and its links, behind Cloudflare Access |
| **channel** | a terminal: where you type | a way you and Shipify talk: GitHub (always), Telegram and the web chat. What you can do is the same on every channel, and where you type decides the task (a comment, a reply, the open thread); only merges and the words that act on code stay on GitHub |
| **web chat** | a web terminal over the same shell | `<the edge>/admin/chat/`: a chat window of Shipify's own, behind the status page's sign-in, as the channel `web`. Every task, threads (diagrams drawn, pictures full size), files, repeats, the notebook and a read-only setup page. It writes only through the door, reads replies in place on the task, and sends a notification to your devices when one comes (`pnpm ship add webchat`) |
| **notification** | a push notification | what the web chat sends your phone or PC when a reply reaches it, with the page closed too: its state, its task and the task's title, never the reply's words; a tap opens the thread (Web Push, ADR 0050). Not `/ping`, which is the boxes' check |
| **out-only channel** | a printer | a channel that only receives replies (a Notion page, an Obsidian vault): an adapter with `send` alone |
| **message** · **outgoing** | an input event · an output event | what a chat's adapter hands the door, in one shape for every channel · a reply or alert going to a chat, in one shape the adapter renders |
| **contract** | an interface or ABI | what one part promises another, written down and held by a test: each plug-in kind's (`cli/lib/plugins/`, `edge/src/channels/channel.ts`), the shapes between blocks (`cli/contracts/`), and what a project keeps (`shipify.json`, the `make` targets, `/health`, its docs) |
| **plug-in** | a driver or a package | a block of one kind (agent, tool, channel, stack, check, recipe), keeping its kind's contract and passing its conformance test |
| **adapter** | a device driver | the one file that plugs an agent (`cli/lib/agents/<name>.ts`) or a chat channel (`edge/src/channels/<id>.ts`) in, behind its kind's contract |
| **registry** | the driver table | the one list where the core finds a kind's plug-ins: `agents/index.ts`, `channels/index.ts`, `tools.json`, `executors.json`, `stacks/` |
| **conformance test** | a certification suite | the one test every plug-in of a kind passes (`tests/plugins/`, `tests/edge/channels.test.ts`, `tests/checks.test.ts`, `tests/recipes.test.ts`) |
| **selftest** | the power-on self-test | `ship selftest`: each part's live check, end to end |
| **app** | an installed program | what Shipify ships and hosts, keeping the project contract |

Words used only inside the code (decide, writes, apply, journal, cursor, snapshot, place):
[design.md](design.md#inside-the-code).

## Agents and tools

| Word | Like | Means |
|---|---|---|
| **agent** | an unprivileged user program | the program that thinks: Claude Code by default, pi (`use pi`) or OpenCode (`use opencode`). Its entry is in `executors.json`; it reads and suggests, and the box makes every change |
| **harness** | a container runtime | what Shipify is around the agent: the task, the sandbox, the tools, the models, the clocks and the checks. What every agent must never run is said once (`executors.json`'s `commands`), and each adapter writes it its own way |
| **model** · **effort** | the CPU · its clock speed | what the agent thinks with (Claude Code's Haiku, Sonnet, Opus, Fable; pi's and OpenCode's through their gateway) · how hard (Claude Code's low to max, pi's and OpenCode's off to max). **Auto** is the agent's own: Sonnet, medium for Claude Code |
| **gateway** | an upstream provider | where an agent's models are served, one key for many models (OpenRouter, Vercel's AI Gateway): `executors.json`'s `gateways`. Its key is that agent's login (`pnpm ship add openrouter`); its own list is searched by `/models <word>`. An agent goes through each gateway it lists: `pi` through its first, `pi-vercel` through the second |
| **`result.json`** | a process's exit report | the only thing the agent hands the box: its reply, and what it asks for (a PR, calls, notes, a repeat) |
| **handoff** | a shift handover note | the agent's note for the next run (`handoff.md` in its out folder: Goal, Done, Next, Decisions, Open), kept up to date as it works; the box keeps it in the status comment however the run ends |
| **helper** | a child process | an agent's own subagent, started inside its run (Claude Code's). It works for the agent, under the same rules; its work counts once merged into the run's branch |
| **tool** · **look** · **act** | a device · read · write | one of your apps a run can use (Notion): an MCP server in `tools.json`. **Look** calls read, while the agent thinks; **act** calls change, made by the box. `look at <repo>` is a look too: that repo read, depth 1, before the agent (ADR 0044) |
| **bot** | a service account | the GitHub App that mints a run's one-hour tokens and opens its PRs on Shipify's own account (`ship bot`) |
| **repos App** | a guest service account | the second, small, public GitHub App another account installs, so Shipify reads its repos and opens PRs there, and nothing more (`ship bot repos`, ADR 0045) |
| **account** · **your accounts** | a user or group · trusted domains | a GitHub org or user. Yours are Shipify's own and the ones you add (`SHIPIFY_ACCOUNTS`, `ship bot repos <account>`); any other account's repos are only read. A task works on one account, its repo's (ADR 0045) |
| **skill** · **playbook** | a man page · a runbook | how to do a kind of work well (`skills/`) · the steps for one job (`playbooks/`). A way of working you teach Shipify becomes a skill by PR, not a note |
| **scenarios** | a skill's tests | a skill's `scenarios.md`: asks that should load it, near misses that shouldn't, and cases (what went wrong without it, what it does instead). Each lesson adds a case (`skills/writing-skills`) |

## Projects

| Word | Like | Means |
|---|---|---|
| **project** | a package | one thing Shipify manages: a repo, a folder `projects/<id>`, a `shipify.json`. Its **kind** is `app` or `package` |
| **repo** | an outside package | a repo on any of your accounts with no `shipify.json` (named `<account>/<repo>` on another one): a change works on it its own way, its rules first, then Shipify's (a PR you merge, against its default branch), and adds nothing of Shipify's (ADR 0044, ADR 0045) |
| **stack** | a base image | a project's starting point: language, framework, host, and its `make` targets. **Presets** are starting content |
| **plan** | a proposal | a new project's one-page request (`plans/<id>.plan.md`). Merging its PR approves the build |
| **spec** | a manual | what a project is now (`docs/spec.md`) |
| **change doc** | a design note | the why and how of one feature (`docs/changes/`), approved by merging |
| **ADR** | an RFC | a decision that's hard to reverse (`docs/adr/`) |
| **lane** | a change's size class | how big a change is: **tweak** (a PR), **feature** (a change doc and the code in one PR), **big** (a doc PR first, then `go`) |
| **pipeline** | a build system | each project's own CI workflow, `.github/workflows/ship.yml`: the same file in every project, owned by its stack (ADR 0048) |
| **staging** · **preview** | a test environment · a review build | an app's optional rehearsal environment · a PR's link to click through, on request |
| **release** | a version | a version `vX.Y.Z`: a tag, a GitHub Release, a changelog section |
| **Live** | a deploy notice | the reply once a merged change is deployed: "**Live:** <app> at <link>" |

## Gone

Gone, never to be used: envelope, seal, file run, send key, send route, outbox, tell, round,
errand, recipe log, case, card, `yes <n>`, signal, hook, source, connection, template (a recipe to
copy is an **example**), the console, `ship people`, `ship recipe`, `ship connect`, `ship hook`, the
act agent and its guard, the labeller, a tool's `send` verb, and the Codex entry.
"Recipe" came back (ADR 0032) with the one meaning above.
