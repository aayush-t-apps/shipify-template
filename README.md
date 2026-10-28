# Shipify

**Your own AI engineer on GitHub. Ask from anywhere; a machine of yours does the work; you merge.**

You write to Shipify on Telegram, its web chat, or GitHub. A machine of yours (a **box**) picks it
up, the agent works, and you get a reply: an answer, a pull request, a plan, or changes to approve.
It works on any repo you point it at, on any of your accounts, in that repo's own way. Nothing is
merged, deployed or changed in your tools until you say yes.

It runs on GitHub, your own machines, your Claude subscription (or a free model gateway) and
Cloudflare's free plan. Nothing is paid. MIT licensed.

## How it works

```
You: GitHub, Telegram or the web chat
  → a task (one GitHub issue)            the door writes your chat words there
  → a run on a box: plan → think → apply the agent only thinks; the box makes every change
  → a reply on the task                  the door copies it to your chat
```

| Part | What it is |
|---|---|
| **The record** | GitHub: tasks, replies, PRs, plans, notes |
| **The queue** | GitHub Actions: hands each run to a free slot on a box |
| **The edge** | one free Cloudflare Worker: **the door** (your chats in and out) and **the watch** (what's due, what's stuck, alerts) |
| **A box** | any Linux machine of yours: a Raspberry Pi, a VPS, your PC, or a Docker container. It keeps nothing between runs |

Three rules hold it together:
- **Every message lives on a task.**
- **The agent only thinks.** It works in its own clone, as its own Linux user, with read-only keys.
- **Nothing is silent.** Every run ends in a reply, or in a failure that names its fix.

More: [docs/tour.md](docs/tour.md) (end to end) and [docs/design.md](docs/design.md) (the parts
and rules).

## What you can ask

| You want | You say | You get |
|---|---|---|
| an answer | just words, or `/ask …` | "Got it · #12", then a reply in about a minute |
| to carry on | a reply to any of the task's messages | the next run reads it |
| a change to a repo | `<repo>: what to change` (`acme/api: …` on another account) | a PR, made that repo's way; you merge |
| to read any repo | `look at owner/name …` | an answer from its code |
| a change in a tool (Notion, Drop) | ask, then tap Yes on the exact calls | the box makes exactly those calls |
| a note it keeps in mind | `remember: …` | saved at once |
| a reminder or a regular job | `repeat: every Monday at 9, …` | a reply each time |
| a check-back, once | "check PR #12's CI in 15 minutes and tell me" | one reply, then it ends |
| something when a PR lands | "when #12 merges, tell me" | one reply when it happens |
| a new app | `new: the idea` | a plan PR; you merge; it's built and live |
| to see what's going on | `/ping`, `/tasks`, `/apps` | an answer at once |

Paste screenshots or files, up to 5 a message. A few **fixed words** do one thing each: `yes`,
`no`, `continue`, `stop`, `close`, `reopen`, `use <model>` and more
([docs/tasks.md](docs/tasks.md)).

### Task, repeat, recipe or check?

| | For | Start it | Stop it |
|---|---|---|---|
| **Task** | one job, now | words, or an issue | it closes when done |
| **Sub-tasks** | one job of a few PRs, in order (across repos, an ADR's build) | "split it" on the task, your `yes`, then `go` ([tasks.md](docs/tasks.md#sub-tasks-one-task-a-few-prs)) | `stop`; it closes when every part is closed |
| **Repeat** | a job on a schedule, or once later | `repeat: …`, or a time in your words | `stop repeating`, or close the task |
| **Errand** | one job when a PR's checks end, it merges, or it's live | "when #12 …" on the task | it ends when it fires |
| **Recipe** | a repeat kept as a reviewed file | `recipes/<name>.md` in a PR ([recipes.md](docs/recipes.md)) | remove the file |
| **Check** | watching one value (a price, a page), with no agent | `checks/<name>.mjs` in a PR | as a repeat |

## Get started

You need a GitHub account, a Claude subscription (or a free gateway key), and a computer with
Linux, or Windows with WSL, plus Node 22, pnpm, git and `gh`.

1. On GitHub, **Use this template** to make your own private copy named `shipify`.
2. Clone it, then:
   ```sh
   pnpm install
   pnpm ship setup      # each step checked, and the next one named
   pnpm ship selftest   # every part, end to end
   ```
3. Give it a box: any of the three below.

`pnpm ship doctor` checks this machine any time. New versions arrive as a PR you merge
([docs/releases.md](docs/releases.md)). Step by step: [docs/getting-started.md](docs/getting-started.md).

## A box

A box runs what the queue hands it. Each slot runs one task at a time, and each slot's agent is
walled off as its own user. Any free slot on any box takes the next task.

| Where | How |
|---|---|
| **A Pi, a VPS, or this PC** | `pnpm ship box add [<user@host>]` |
| **Any Ubuntu 24.04 machine** | `curl -fsSL https://github.com/aayush-t-apps/shipify-template/releases/latest/download/here.sh \| bash` |
| **Anything that runs Docker** | `docker compose run --rm box register` once, then `docker compose up -d` ([compose.yml](compose.yml)) |

The last two ask you to approve a GitHub code on your phone, then keep no login. Details, and
which machine to pick: [docs/box-setup.md](docs/box-setup.md).

## Costs

| What | Cost |
|---|---|
| Tasks, repeats, clean-ups | none: they run on your boxes |
| A PR | none: it's checked on the box first |
| An app change after your merge | about 2 GitHub minutes (private repos get 2,000 free a month) |
| The edge | none: Cloudflare's free plan |

## Security

- **You approve:** your merge on GitHub, or your `yes` to an exact list of changes.
- **Only you start work:** your words, from your accounts.
- **The agent holds no write key.** Write tokens are made after it finishes, for the one repo the
  run changes, after a secret scan.
- **A box keeps no secret between runs,** and secrets are never printed.

Every key, its scope and how to replace it: [docs/security.md](docs/security.md).

## Read next

[tasks.md](docs/tasks.md) (what you can ask) · [glossary.md](docs/glossary.md) (the words) ·
[docs/README.md](docs/README.md) (every doc) · [roadmap.md](docs/roadmap.md) ·
[CHANGELOG.md](CHANGELOG.md)

Changes to Shipify are pull requests the owner merges ([CONTRIBUTING.md](CONTRIBUTING.md); the
rules for agents: [AGENTS.md](AGENTS.md)). Licensed under [MIT](LICENSE).
