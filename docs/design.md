# Shipify: system design

Shipify on one page: the parts, the rules, the keys, a run's steps, and the projects layer
underneath. The decision behind it: [ADR 0031](adr/0031-every-message-on-a-task.md). The same
flows through the code: [tour.md](tour.md). Shipify as a product, for anyone who runs their own:
[product.md](product.md).

**In one line:** every message lives on a task; a run on a box reads the task, lets the agent
think if needed, and applies the changes; the edge carries your words in and the replies out.

## The parts

| Part | Is | Decides | Can change |
|---|---|---|---|
| **You** | the owner | what gets done, and every approval | anything |
| **The record** | GitHub: tasks, comments, the status task, PRs, plans, the notebook | nothing: it keeps | nothing by itself |
| **The queue** | GitHub Actions: runs waiting for a slot | which slot takes a run | nothing |
| **The door** | the edge's way in and out ([door.md](door.md)) | only whether a sender is you | writes your words onto tasks as the door App; copies replies to your chats; answers the chat commands (`/ping`, `/apps`, `/notebook`, `/recipes`, `/models`, `/help`) at once; closes or reopens a task on your `close` or `reopen`, with no run (ADR 0040) |
| **The watch** | the edge's check every 5 minutes ([watch.md](watch.md)) | only when to ring | adds a label: `run` on a task whose words waited with no box, `stuck` (Stopped) on one whose run ended early, `watch:due` or `watch:alert` on the status task |
| **A box** | a machine with one slot or more (as many as its memory and cores suggest, ADR 0061), one runner each | nothing | runs what the queue hands it, and keeps nothing between runs |
| **The core** | `ship`, inside a run | what the run does next, from the task | replies, labels, notes, repeats, pushes to the task's branch, PRs, the calls you approved. Never a merge |
| **The agent** | Claude Code, as the slot's own Linux user | nothing: it proposes | only its own clone and `result.json` |
| **Plug-ins** | agents, tools, chat channels (adapters in the edge), stacks, checks, recipes: each behind its kind's contract, held to its conformance test, found through a registry ([plug-ins.md](plug-ins.md)) | nothing | what their contract allows |
| **The Apps** | GitHub Apps: the bot, on Shipify's own account; the repos App, on your other accounts (ADR 0045) | nothing | mint a run's one-hour tokens for their own account's repos. A repo attaches to Shipify by an App's install there |

**The edge** is one Cloudflare Worker, `shipify` at `shipify.<your workers.dev name>.workers.dev`
(or `shipify.<APPS_DOMAIN>` with your domain): the door, the watch, and the status page and the web
chat under `/admin`, behind Access. It's built from `edge/` and deployed by `ci.yml` after its
checks (rolled back when `/health` doesn't show its commit). It keeps no state: the record is its
memory.

## The eleven rules

1. **One record:** GitHub. The door keeps nothing; anything elsewhere is a cache.
2. **Every message lives on a task.** In: a comment (yours, or the door's for you). Out: a reply,
   which the door copies.
3. **Runs reconcile:** read the task, decide, apply. Nothing new does nothing. Every change carries
   a key or a journal line, so a repeat is harmless.
4. **The agent only thinks,** as its own Linux user. It reads and suggests; the box makes every
   change. No agent holds a write key, the record's token, a channel key, or anything the apply
   step runs.
5. **The least each part needs:** two profiles for the agent; write tokens minted after it, for
   exactly one repo; an act key only for a call you approved.
6. **Approvals are yours:** your merge, on GitHub; or your whole, unedited `yes` to a list, from
   GitHub or your chat (ADR 0049). One flow, one rule: every word, task and release works the
   same from any channel; only a PR's merge, and what changes the live app at once (down, up,
   rollback), are GitHub's.
7. **Only you start work:** your comments, and the door's on your behalf. The watch starts no run
   (ADR 0042): a stuck task is marked Stopped and waits for your `continue`. A dispatch carries
   only a task number, and starts nothing the task's status doesn't already have pending.
8. **The core names nothing at the edges:** tools, channels and stacks plug in with a manifest and
   a conformance test.
9. **Grow by the ladder:** a prompt or a skill first, then a repeat or a pre-approved call, then a
   tool, then a new intent; the core last.
10. **Supervised:** the watch marks a task Stopped when its run ended early or its words waited
    with no run (your `continue` carries it on), resends an undelivered reply, and alerts once. A run starts only for what you asked or set (ADR 0040).
11. **Trust is yours to give** (ADR 0044, ADR 0045): an App's install gives access, and only your
    list of accounts gives trust. One task works on one account, and its run holds only what that
    account may see; any other repo is only read, with no key and no command.

## The keys

Each key is as narrow as it can be. Scopes, expiry and how to replace each:
[security.md](security.md), [setup.md](setup.md).

| Key | Lives | Reaches | Can |
|---|---|---|---|
| **Your GitHub login** (`shipify-pc`) | this PC | `ship` on the PC | what you can |
| **`GITHUB_TOKEN`** | GitHub, per job | the task step, plan, decide, apply, the `github` job, `watch.yml` | write the record. Never in think |
| **The bot App's key** (`SHIPIFY_BOT_KEY`) | a shipify secret | the token steps | mint one-hour tokens: read-only ones; a write one for one repo, after think |
| **The repos App's key** (`SHIPIFY_REPOS_KEY`) | a shipify secret | its token steps, for a task on another of your accounts | the same, on that account: code and PRs, never workflows (ADR 0045) |
| **The agent's login** (`CLAUDE_CODE_OAUTH_TOKEN`) | a shipify secret | think, on a pipe the agent reads once (fd 3), never in its environment | your Claude subscription |
| **A tool's look key** (`SHIPIFY_NOTION_READ`) | a shipify secret | think | read the tool |
| **A tool's act key** (`SHIPIFY_NOTION_WRITE`) | a shipify secret | apply, only when decide found approved calls | change the tool |
| **The run's OIDC token** | GitHub, per job | plan, apply | prove to the door it's shipify's `main` |
| **The door App's key** | an edge Worker secret, set by `ship door setup` | the edge | Issues read and write; Actions, Administration, Variables and Metadata read; shipify only |
| **Telegram's token and secret** | edge Worker secrets, set by `ship add telegram` | the edge | the bot |
| **Cloudflare's deploy token** (`CF_DEPLOY_TOKEN`; each app's `CLOUDFLARE_API_TOKEN`) | GitHub secrets | the edge's deploy job, `prepare`, each app's pipeline | deploy Workers |
| **A box's runner registration** | the box | its runners | take shipify's jobs |

No key is shared between boxes and the door, and a box holds no secret between runs.

## A run

`task.yml` has two jobs. Each task is its own group (`task-<n>`), so its runs go one at a time, in
order.

**The `run` job, on a box** (named `task #<n>`):

| Step | Command | As | Holds | Does |
|---|---|---|---|---|
| **task** | `ship run task <n>` | the runner | `GITHUB_TOKEN` | reads the task once (its issue, comments and status) and saves it for plan. Outputs `account`: the other account of yours its repo is on, if any, so plan's token is minted for it (ADR 0045) |
| **plan** | `ship run plan <n>` | the runner | `GITHUB_TOKEN`, a read-only token (the bot's), and the repos App's for the task's other account | carries on from the task's read, puts 👀 on what it read, fetches your files, and decides: fixed words first, then the intent. Each repo is read with its own account's token. Outputs `do` (nothing, box, think), `profile` (none, talk, work, check), `repos` (what a work run's agent may read), and `account` and `account_repos` (another account's repos it reads) |
| **think** | `ship run think <n>` | the slot's agent user | the agent's login, its own read-only token (a work run's project and Shipify; every project for a talk run; on another account, that account's repos alone), the tools' look keys (on Shipify's own account only) | only when needed. The agent writes `result.json`; in a work run it commits in its clone and runs `make verify`. A check runs its script instead. Whatever stops the agent, its commits are bundled for apply |
| **decide** | `ship run decide <n>` | the runner | `GITHUB_TOKEN`, a fresh read-only token, shared with apply | turns the result into writes. Outputs what to mint: `repo`, its `account`, `act`, `workflows`, `files` |
| **mint** | workflow steps | | the bot App's key, or the repos App's | a write token for exactly the one repo decide named, from the App on its account; a token for shipify's files branch; an act key only for approved calls |
| **apply** | `ship run apply <n>` | the runner | the minted tokens | makes the writes, tells the door of each reply as it's written, and saves the status comment last |
| **stay** | `ship run stay <n>` | the runner; the agent as the slot's own user | `GITHUB_TOKEN`, its own read-only token (every project, as a talk run's; the repos App's on another account), the agent's login, the tools' look keys; no write key | after every answer to your words, unless it started another run or closed the task (decide's `stay`, ADR 0060). For `SHIPIFY_STAY` quiet minutes (20) it reads the task every 2 s (a read that finds nothing costs nothing) and does with your words what a normal run would (ADR 0063): each turn is plan, think in the same session (a new model or effort too), decide and apply, as a run's are. Only what needs another agent, account or repo, a fresh clone (`start over`, `go`) or an edit goes to a normal run; an answer that needs a token (files, a call, a push) ends the stay, and the job's steps after it mint those keys and apply it (ADR 0062); on a project it pushes nothing, and a change it's asked for starts a work run; it gives way when a box job waits. `staying` is on the task meanwhile, and taken off however it ends (ADR 0057) |

If a step breaks before a reply, `ship run failed <n>` says so on the task. Outputs come from fixed
lists only, never free text.

**How a box starts a step** (ADR 0051, ADR 0057). The job names no `checkout` or `setup-node`,
which the runner would download on every job: it uses the box's own Node, and its first step fetches
Shipify's commit with `git` only when the box has no copy of it (or a push's plans need both ends).
The next makes a read-only copy of Shipify per commit, in the box's shared tools, with the CLI built as one file in it (`pnpm build:cli`,
`scripts/build-cli.mjs`: esbuild, packages inside). Every step above, and the agent's own `ship`
commands, start `node "$SHIPIFY_COPY/cli/dist/ship.mjs"`: 0.66 s a start, against `pnpm ship`'s
2.65 s through tsx. A copy already built is only named. Your PC, CI, the tests and the `github` job
keep the source through `pnpm ship`, so an edit needs no build. Each step writes one line to the
job's summary: its time, and each `gh` call it made with its time (`cli/lib/exec.ts` counts them),
so a slow step names its slow call. The run reads its task once: plan writes its status from the
task step's read, and apply reads only the comments written since (`comments(n, since)`), with the
reply keys from the saved read. Writes that don't depend on each other (👀, labels, the status,
telling the door) start together through the record's `together`; the status comes last.

Each phase mints its read-only token right before it, since an App's token lasts one hour, so a
long think never leaves decide reading with an expired one. The job's limit is the sum of its
clocks (think's steps, plan's follow of a deploy, setup and apply), so a run never outgrows its own
job (ADR 0035).

**The `github` job, on GitHub's machines,** runs `ship run github <n>` with the bot's full token and
no agent, after the task step. It does only what the task's status has pending, once: **prepare**
(a merged plan's repo and keys), **operate** (release, down, up, rollback), or closing the PRs of a
task closed as not planned or started over. On another of your accounts, it closes them with the
repos App's token there. A push of merged plans runs `ship task plans`, which starts each plan's task.

**The profiles,** what the agent may touch:
- **talk:** the web, the tools' look calls, and a project's or repo's code, cloned read-only by the
  agent itself only when a question needs it.
- **work:** one project's or repo's clone on its own branch, where it commits. A repo that isn't a
  project keeps its own rules: no project checks on the box, its own CI on the PR (ADR 0044), and
  its PR against its own default branch (ADR 0045).
- **read:** only the repos the task reads, files only (no command, no web, no key): a task that
  reads a repo outside your account (ADR 0044).

**Clones, by use (ADR 0044):** a read is depth 1, into the run's `read/` folder, before the agent;
a change keeps its whole history; apply's is history without file contents, with only the files
its checks read checked out. One module (`cli/lib/clones.ts`) makes every clone, the key in git's
environment, never on a command line.

**What the agent can't do:** push, open a PR, call an act tool, or read the runner's folders,
`/proc` or another slot's runs. It asks for a PR, calls, notes or a repeat in `result.json`. Apply
fetches its git bundle into apply's own clone (hooks and fsmonitor off), scans for secrets, and
pushes only to the task's branch (`task/<n>-…`), or to a new project's empty repo. A change to
workflow files must match what the stack renders, exactly. Every PR reads the same way: the repo's
own template or Shipify's sections, then the core's footer (the task, and what made it), its commits
in the App's name (ADR 0045).

## Inside the code

These words are for the code and this page, not the everyday docs.

| Word | Means | Where |
|---|---|---|
| **snapshot** | a task, read once: the issue, its comments with who really wrote each, the status comment, and what decide needs (a deploy's state, the tools' act calls) | `cli/kernel/snapshot.ts` |
| **decide** | plain code, `snapshot → writes`, with no GitHub. `plan()` before think, `afterThink()` with the agent's result | `cli/kernel/decide.ts` |
| **writes** | the changes a run makes, as data | `cli/kernel/types.ts` |
| **apply** | the one place that makes them, in order, each safe to repeat | `cli/kernel/apply.ts` |
| **journal** | a line in the status comment saved before each outside change (a tool call, a push, a dispatch). One started and not finished is reported, never redone | `cli/kernel/apply.ts` |
| **cursor** | the newest comment a run has read; what came after is still to answer | the status comment |
| **place** | where a think runs: the slot's sandbox on a box, or a plain folder off a box (this PC, tests); made fresh once per job, and reopened as it is for a stay's turns | `cli/kernel/place.ts`, `cli/lib/sandbox.ts` |
| **stay** | the loop a run that stays runs, its rules (`staysAfter`, `takes`, `needsMint`) and its reads (`news`, `task`, `waiting`: the mailbox it reads, the task today) | `cli/kernel/stay.ts` |

**The writes,** and what keeps each safe to repeat:

| Write | Kept safe by |
|---|---|
| **reply** (kind, text, links, files) | its key in the hidden `reply` line: the task, the cursor, the body's hash, the step, the occasion |
| **labels**, **close**, **reopen**, **react** | they're idempotent |
| **push** (and its PR: closes, part-of or publish) | a journal line, and the PR body's hidden key |
| **note** | the line itself: no duplicate lines |
| **calls** | a journal line before each call |
| **dispatch** | a journal line; the job it starts runs only what's pending |
| **coming-up** | the status task's "Coming up": one line per repeat, replaced |
| **status** | always last |

**The status comment** is a task's state: the intent, project, model, cursor, the body's hash (an
edit counts as new), what's pending, the journal and the runs table. It counts only when a run
wrote it and no one else edited it. Labels are derived from it, never read.

**The shapes** every boundary speaks live in `cli/contracts/`, shared with the edge: `Incoming`
(what you send), `Reply`, `FileRef`, `ToolCall` and `ToolResult`, and `Problem` (one catalogue of
errors and their fixes, `problems.ts`). Logs are one JSON line per event, masked.

## Projects

The projects layer sits under the core, unchanged by it. **The core runs the flow; stacks own the
tools.** `cli/` and the pipeline never name a language, package manager or host, and
`tests/core.test.ts` fails if they do (ADR 0010).

**The contract,** every project, any stack:

| Part | What |
|---|---|
| `shipify.json` | id, kind, **version** (the source of truth), stack, staging, URLs, health path, secret names ([configuration.md](configuration.md)) |
| docs | `AGENTS.md`, `docs/spec.md`, `docs/changes/`, `CHANGELOG.md`, `README.md` |
| `make` targets | `setup check test build verify`, and `deploy` for apps. A missing optional one means "not supported" |
| health (apps) | `GET <url><health>` returns JSON whose `commit` is the deployed SHA |

**Stacks:** `ts-worker` (an app with a UI or an API) and `ts-static` (a site), on Cloudflare
Workers' free plan; `ts-package` (a library, released as git tags); `custom-app` and
`custom-package` (anything else). A stack is a folder: `stack.json`, `files/` (rendered once into
the project), and `migrations/`. When a plan doesn't say, planning picks the free default, and
anything you ask for wins (ADR 0011).

**The pipeline:** each project carries its own, `.github/workflows/ship.yml`, the same file in every
project, owned by its stack (ADR 0048). It calls no other repo and hands no secret out:

```
before the PR → the same checks wherever it's made: `ship pr --check` (change docs, version,
          changelog), then make verify; on the box as the agent's user, with one round
          for the agent to fix them; in a terminal, `ship pr` runs both
PR    → nothing on GitHub, unless it asks for a preview
main  → every commit, docs too (each gets its mark): one check (secret scan, setup, audit,
          verify), then:
          no staging: deploy → /health (rollback on failure) → tag
          staging:    deploy staging → e2e → `ship release` → merge → deploy production → tag
          package:    tag vX.Y.Z and a GitHub Release
docs-only PR → nothing
manual → deploy (main again), rollback, pause, resume (down and up run these)
```

It reads the project's kind and settings from `shipify.json` when it runs, so one file covers every
kind, staging or not. A project keeps building and deploying with no Shipify around.

**How changes reach projects:**

| What changed | Reaches projects | Your part |
|---|---|---|
| the CLI, guides, playbooks | the next plan, change or build | none |
| a stack, its pipeline included | `ship upgrade <id>` (or `<app>: upgrade`): the stack's owned files replaced; the project's own never touched | merge each upgrade PR, one canary project first |
| something a project must do by hand | `stacks/<stack>/migrations/<version>.md`, which the upgrade shows | do it in that upgrade's PR |

Project-owned files are never replaced. Every platform change passes `pnpm verify` and the golden
tests (every stack, preset and staging choice).

**The lifecycle:** create (plan PR → build → publish), change (a PR; a big change gets its doc PR
first), ship (your merge), operate (status, release, rollback, down, up). Step by step:
[process.md](process.md).

## Conventions

- Plain names: repo `<id>`, Worker `<id>` (`<id>-staging`).
- One approval per change, right before production (ADR 0003). The agent never merges it.
- Plans and change docs use EARS criteria and tasks linked to them (guides/).
