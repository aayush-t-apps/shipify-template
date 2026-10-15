# Shipify

**Ask from anywhere. A box does the work. You merge on GitHub, and tap Yes in your chat.**

Shipify is your own AI engineer on GitHub, which you run yourself. You write to it on Telegram,
its own web chat, or GitHub. A machine of yours (a **box**) picks it up, the agent thinks, and you
get a reply: an answer, a PR, a plan, or changes to approve. It reads any repo you point it at, on
any of your accounts (your company's org too), works in that repo's own way, and opens a PR a
person merges. Projects, the apps it builds and deploys for you, are one add-on. Nothing reaches
production, and nothing changes in your tools, until you say so. It runs on GitHub, your machines,
your Claude subscription and Cloudflare's free plan: nothing is paid. The product in one page:
[docs/product.md](docs/product.md).

## Three ideas, one promise

1. **Every message lives on a task.** A task is one GitHub issue on this repo. Your words reach it
   from GitHub, or from Telegram or the web chat through **the door**, which writes them onto the
   task. Every answer is a **reply** on the task: the door copies it to Telegram, and the web chat
   reads it there and notifies your phone. The chat is a view of your tasks.
2. **One run shape.** A run is one job on a box: **plan** (read the task, decide what's next),
   **think** (the agent, only if needed), **apply** (make every change, each safe to repeat).
3. **The agent only thinks.** It reads, edits and commits in its own clone, as its own Linux user,
   and says what it wants in `result.json`. The box makes every change: replies, PRs, notes,
   repeats, and the tool calls you approved.

**Nothing is silent:** one shape in and out, run details on every reply (agent, model, time,
tokens, tools), and every run ends in a reply or in a failure that names its fix.

## How a message flows

```
You, on GitHub ───────────────────┐
You, on Telegram → the door ──────┤
You, in the web chat → the door ──┴→ a comment on the task
   → task.yml's run job, on a box: task → plan → think → decide → apply
   → a reply on the task → the door copies it to Telegram; the web chat reads it on the task,
     and notifies your devices
```

| Part | Does |
|---|---|
| **The record** (GitHub) | keeps everything: tasks, replies, PRs, plans, the notebook, the status task |
| **The queue** (GitHub Actions) | hands each run to a free slot on a box |
| **The edge** (a Cloudflare Worker) | **the door** (your words in, replies out) and **the watch** (every 5 minutes: what's due, stuck tasks, replies to resend, alerts) |
| **Boxes** (a Pi, a VPS, this PC) | run what the queue hands them, and keep nothing between runs |
| **The core** (`ship`) | a run's steps, through its plug-ins: tools, channels, stacks, agents |

The parts and their rules: [docs/design.md](docs/design.md). The same flows through the code:
[docs/tour.md](docs/tour.md).

## What you can do

| You want | You do | You get |
|---|---|---|
| **an answer** | write to the bot, or open an issue: just words (or `/ask …`) | "Got it · #12" (linked), then a reply, in about a minute |
| **to carry on** | reply to any of the task's messages, start with `#12`, or comment on the task | the next run reads it |
| **to go back to a task** | `/tasks` (or `#12` alone) in a chat | your open tasks as buttons; a tap opens the reply box on it |
| **another model** | `/use` in a chat: your model, which new tasks start with (buttons, each agent's Auto, Claude's effort); as a reply, that task only; or `use opus` anywhere | from your next message, starting no run |
| **a note it keeps in mind** | `remember: …`, or `remember <topic>: …` | saved at once, with no agent |
| **a reminder, a regular job or a check** | `repeat: every Monday at 9, …`, or the Repeat form | "Set: …", then a reply at each time |
| **a check-back, once** | on the task: "check PR #12's CI in 15 minutes and tell me", "remind me at 17:30 to …" | "Set: once, at …", then one reply, and it ends |
| **a change in a tool** (Notion) | ask; read the exact calls under the reply; tap Yes, or say `yes` | the box makes exactly those calls |
| **a change to an app** | `<app>: what to change` (`shipify: …` for Shipify itself) | a PR → you merge → "Live" |
| **a change to another of your repos** | `<repo>: what to change` | a PR made its own way (its rules, its CI), nothing of Shipify's added → you merge |
| **a change on another of your accounts** | `<account>/<repo>: what to change` (`acme/api: …`), once the account is added | the same PR, against its default branch, in the repos App's name → you or its team merge |
| **to read any repo** | `look at owner/name …` (or a github.com link) in your words | an answer from its code; someone else's repo is only read, never run |
| **a new app** | `new: the idea` | a plan PR → you merge → built → "Live" |
| **release, take down, bring back, roll back** | the Operate form on GitHub | the operation, run once |
| **to see what's going on** | `/ping`, `/apps` and `/tasks` on Telegram; the web chat's list and Setup; the status task on GitHub | an answer at once |
| **to send or get files** | paste a screenshot, send a photo or a document | the agent sees it; files it makes come back |

- **Fixed words** do one thing each: `yes`, `no`, `continue`, `start over`, `preview`, `publish`,
  `go`, `stop`, `stop repeating`, `resume`, `close`, `reopen`, `use <model>`. The four that act on
  code, `start over`, `preview`, `publish` and `go`, work only on GitHub
  ([docs/tasks.md](docs/tasks.md)). In a chat, the ones a reply asks for are buttons, and a list
  has Yes and No under it.
- **Files:** up to 5 a message, 10 MB each. A voice note, a video or a file attached on GitHub
  can't be read, and the reply says what to do instead.
- **A failure:** its reply says what really broke and the one thing to do (**Continue**, **Another
  model**); nothing is tried again behind your back.

### Task, repeat, recipe or check?

| | Task | Repeat | Errand | Recipe | Check |
|---|---|---|---|---|---|
| **For** | one job, now | the same job on a schedule | one job when a PR's or a branch's checks end, it merges, or it's deployed | a repeat you keep as a reviewed file | watching one value (a price, a page, a version) |
| **Start it** | words, or an issue title | `repeat: …`, or the Repeat form | on the task it's about: "when #12's checks finish, tell me" ([tasks.md](docs/tasks.md#repeats)) | `recipes/<name>.md` in a PR you merge ([recipes.md](docs/recipes.md)) | `checks/<name>.mjs` in a PR you merge, then `repeat: every hour, check <name>` (or a recipe's `check:`) |
| **Agent** | yes (not for `remember:`, `forget:`, a chat command or an operation) | a reminder: no; a job: yes | no while it waits; then a reminder: no, a job: once | yes, its body is the job; after its check, only when that changed | no: a script, run with no keys |
| **Replies** | always | a job stays quiet with nothing to say | once, always | as a repeat | only when the value changes |
| **Stop it** | it closes when done | `stop repeating`, or close the task | it ends when it fires, or after a day (up to 7); `stop repeating` | remove the file (closing its task pauses it) | as a repeat |

Errands, checks and recipes are kinds of repeat. Three failures in a row pause any repeat; `resume`
starts it again, and `again` runs it now.

## Get started

You need a GitHub account (your own, or an organization), a Claude subscription (or a free
gateway key), and a machine to be a box: a Raspberry Pi, a VPS or this PC, on Ubuntu LTS. On the
PC: Linux, or Windows with WSL, with Node 22, pnpm, git and `gh`. Cloudflare (free) comes with the
add-ons that need it: chat, repeats and apps.

Make your copy on GitHub from the Shipify template (**Use this template**, a private repo named
`shipify`), sign this PC in (`gh auth login`, then `gh auth setup-git`), clone it, then:

```sh
pnpm install
pnpm ship setup      # each step checked, and the next one named
pnpm ship selftest   # every part, end to end
```

Among the steps: `pnpm ship box add` (this PC as a box, or a Pi or VPS with `<user@host>`; on any
other Ubuntu machine, one command from the template's release: `curl -fsSL
https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash`),
`pnpm ship door setup` (the door App: press Create, then Install) and `pnpm ship add telegram`
(your phone). Optionally, after the status page, `pnpm ship add webchat`: a chat window of
Shipify's own at the edge's `/admin/chat/` ([docs/channels.md](docs/channels.md#the-web-chat)).
New versions arrive as a PR ([docs/releases.md](docs/releases.md)). Each shows
its plan first; `--yes` does it. By hand: [docs/getting-started.md](docs/getting-started.md). Already set
up? `pnpm ship doctor` checks this machine.

**On another account** (your company's org, your own user, another org of yours):
1. `pnpm ship bot repos --yes` once: a small public App that reads code and opens PRs, and nothing
   more.
2. `pnpm ship bot repos acme --yes` for each account: it opens the page that installs it there,
   where an owner, or a repo's admin for their own repos, clicks Install.
3. Then `acme/api: …` from any chat ([docs/setup.md](docs/setup.md#another-account-the-repos-app)).

## Projects

Each project is its own repo, checked out at `../projects/<id>`, with tests, a living spec, a
changelog and semantic versions. A new one starts as a one-page plan PR; merging it approves the
build.

- **Stacks** are where a project starts: `ts-worker` (an app with a UI or an API), `ts-static` (a
  site), `ts-package` (a library), `custom-app` and `custom-package` (anything else). **Presets**
  (`blank`, `tool`, `site`) are optional starting content. Stack updates arrive as a PR, through
  `ship upgrade`.
- **The contract:** `shipify.json`, the `make` targets (`make verify` runs what CI runs), and
  `/health` for apps.
- **The pipeline:** each project carries its own, its stack's `ship.yml` (ADR 0048). Your merge
  checks once, deploys, checks `/health`, and rolls back on failure.

More: [docs/process.md](docs/process.md) and [docs/design.md](docs/design.md#projects).

## Costs

| What | GitHub minutes |
|---|---|
| Tasks, repeats, clean-ups, alerts | none: they run on your boxes |
| A PR | none: `make verify` ran on the box first (a preview uses a few) |
| An app change, after your merge | about 2 |
| A new project's setup, an operation | about 1 each, on GitHub's machines, where the keys are |
| The edge | none: Cloudflare's free plan |

Private repos get 2,000 free minutes a month.

## Security

- **You approve:** your merge, on GitHub; or your whole, unedited `yes` to a list, from GitHub or
  your chat (its Yes button). Protect your chat account as you protect GitHub.
- **Only you start work:** your comments, the door's comments for you, and the watch's labels.
- **The agent holds no write key.** It runs as its own Linux user, with read-only keys. Write
  tokens are minted after it finishes, for the one repo the run changes, and apply pushes from the
  agent's git bundle after a secret scan.
- **A box holds no secret between runs,** and secrets are never printed.

Every key, its scope and how to rotate it: [docs/security.md](docs/security.md).

## Read next

- **How it works:** [tour.md](docs/tour.md) (end to end, with a code map), then
  [design.md](docs/design.md) (the parts, rules and keys).
- **What you can ask:** [tasks.md](docs/tasks.md). **The words:** [glossary.md](docs/glossary.md).
- **Every doc:** [docs/README.md](docs/README.md). **What's next:** [roadmap.md](docs/roadmap.md) ·
  [CHANGELOG.md](CHANGELOG.md).

## Contributing

Changes to Shipify are PRs the owner merges, and a big one is planned first as an ADR.
[CONTRIBUTING.md](CONTRIBUTING.md) has the steps, and [AGENTS.md](AGENTS.md) the rules for agents.
