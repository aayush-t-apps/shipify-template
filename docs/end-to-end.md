# End to end: how it all fits, and how to check it

One page for the whole running system: what's set up where, the path a message takes, the one
command that checks each part, and what to do when one fails. Setting it up from nothing is
[getting-started.md](getting-started.md); the code behind each hop is [tour.md](tour.md).

## What's set up, and where

| Part | Where | Holds | Checked by |
|---|---|---|---|
| **The record and the queue** | GitHub: the `shipify` repo's issues and Actions | tasks, replies, PRs, plans, the notebook, the status task | `pnpm ship selftest core` |
| **The edge** | Cloudflare: the Worker `shipify` at `shipify.<your workers.dev name>.workers.dev` (or `shipify.<APPS_DOMAIN>` with your domain), deployed by `ci.yml` | its own keys only: the door App's key, Telegram's token and secret | `pnpm ship door check` |
| **The door App** | GitHub App `shipify-door`, installed on shipify alone | Issues write; Actions, Administration, Variables, Metadata read | `pnpm ship door check` |
| **The bot App** | GitHub App (`ship bot`) | mints one-hour tokens for runs: read-only for the agent, one repo to write after it | `pnpm ship doctor` |
| **The repos App** (optional) | GitHub App (`ship bot repos`), public, installed on your other accounts | the same tokens, on another account: code and PRs, never workflows (ADR 0045) | `pnpm ship box list` |
| **A box** | a Pi, a VPS or this PC: runners labelled `shipify-box`, `box-<name>` and `sandbox` | nothing secret between runs; one agent user per slot | `pnpm ship selftest sandbox` |
| **Telegram** | your bot, pointed at the edge, one update at a time | nothing: the edge holds its keys | `pnpm ship selftest chat` |
| **The status page** | `<the edge>/admin/status`, behind one Cloudflare Access application on `admin/*` (the web chat's too) | nothing: it reads the record | `pnpm ship door check` |
| **Recipes** | `recipes/*.md` on main, each with its task "Recipe: <name>" | nothing secret: the file is the approval | the status task, `/recipes` |
| **Your apps** | their own repos, each with its own pipeline (`ship.yml`) | their deploy keys | each app's CI, and the watch's health check |

Keys, what expires and how to renew each: [setup.md](setup.md). The watch reminds you 30 and 7
days before each date in the variable `SHIPIFY_KEY_DATES`.

## A message, hop by hop

| # | Hop | What happens | See it |
|---|---|---|---|
| 1 | **You → Telegram → the door** | `POST /door/telegram`: Telegram's adapter checks its secret and reads the update; the door checks it's you, answers `/ping`, `/apps`, `/repos`, `/notebook`, `/recipes`, `/models`, `/help` itself, and otherwise writes your words onto a task (a new one, or `#12` / a reply carries one on), once | the "Got it · #12" answer; the comment on GitHub, by `shipify-door[bot]` |
| 2 | **GitHub → a box** | the comment starts `task.yml`'s `run` job on a free slot with the `sandbox` label | Actions → task → `task #12` |
| 3 | **task, then plan** | the task step reads the task once and names its account; plan carries on from it, decides (fixed words first, then the intent), says "Working" | the run's "The task" and "Plan" steps |
| 4 | **think** | Claude Code as the slot's own user, in a fresh folder, with its login, its own read-only token (a work run's project and Shipify) and the tools' look keys; it writes `result.json`, and whatever stops it, its commits are kept | the run's "Think" step: one line per agent step |
| 5 | **decide, mint, apply** | the result becomes writes; a write token for exactly one repo is minted; apply pushes, opens PRs, makes approved calls, writes the reply and the status | the run's "Decide" and "Apply" steps: `1 replies (answer)` |
| 6 | **the door → you** | apply tells the door (`POST /door/replied`, the run's OIDC token); the door copies the reply to your chat and marks it 🚀 | `door.out.sent` in the Apply step; the 🚀 on the comment |
| 7 | **the watch** | every 5 minutes: a notice for a reply that didn't go out (never sent twice), marks a stuck task Stopped (`stuck`: your `continue` starts it again; the watch starts no run), rings due runs (repeats, deploys it follows with `deploying`), alerts | the status task; Actions → watch |

A change to an app adds: the agent commits in its clone → apply pushes from its bundle and opens
the PR → you merge → the watch follows the deploy → "Live". A tool change adds: the exact calls in
the reply → your Yes, in your chat or on GitHub → the box makes them, with no agent.

## The checks

Before any of these, `pnpm verify` runs whole tasks the way a box does, task → plan → think →
decide → apply with each step's outputs handed on as `task.yml` hands them, against a real git server on
this machine and stand-ins only for GitHub's API and the agent
(`tests/kernel-flow.test.ts`). A change to its PR, a run that stops and `continue`, a merge to
Live, a PR from the PC: a break between two steps fails there, before a PR.

| Command | Proves |
|---|---|
| `pnpm ship selftest` | every part below, then each plug-in's own check |
| `pnpm ship selftest core` | the plug-in files, the queue, the watch's due runs, an agent here |
| `pnpm ship selftest door` | the edge's variables, its `/health` at its commit, the door App's install and permissions, Telegram's route refusing a stranger |
| `pnpm ship selftest chat` | a message through the door becomes a task, a repeat is written once, a box **answers** it (not a failure), and the reply reaches your phone once |
| `pnpm ship selftest sandbox` | each box's clean-up, run now: each slot's agent can't read the runner's folders, its environment or another slot's runs |
| `pnpm ship selftest act` | each tool's server offers the calls the box makes after your `yes` |
| `pnpm ship selftest notebook` | a run's prompt carries the notebook; through the door, `remember Selftest: …` is kept, `/notebook` shows it, `forget: …` takes it off and the empty page closes |
| `pnpm ship door check` | also: each chat's route refuses a stranger, and the status page sends a stranger to Access's sign-in |
| `pnpm ship doctor` | this PC (or, in a box's clean-up, that box): tools, the login, the sandbox, the agent |
| `curl https://<the edge>/health` | the edge's version and commit, and the door App's install |

## When something fails

Every failure reply names its fix. When it points at the setup rather than your task:

| You see | It means | Do |
|---|---|---|
| "The agent couldn't start on this box" | the agent's command isn't there, or isn't its user's to run | `pnpm ship doctor` on the box; the next run reinstalls it with the right permissions |
| "the agent stopped without writing its result" | the agent ran and gave up, or ran out of time | reply `continue`; the run's Think step says what it did |
| no answer at all from the bot | the door isn't set up, or Telegram points elsewhere | `pnpm ship door check`, then `pnpm ship add telegram --yes` |
| "Got it", then nothing for minutes | no box online, or none with the `sandbox` label | `pnpm ship box list`; re-add the box: `pnpm ship box add <ssh> --manage --yes` |
| an alert from a box's clean-up | doctor found a problem there | its line names the check and the fix |
| a task marked `stuck` | the watch started it three times for the same words | its runs' logs; your next comment takes `stuck` off and runs it |

More: [troubleshooting.md](troubleshooting.md).
