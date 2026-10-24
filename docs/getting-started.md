# Getting started

Your one guide: set Shipify up once, use it every day, change it later, and look after it. Each
piece in detail, and how to redo it: [setup.md](setup.md). How the running system fits together,
how to check each part and what to do when one fails: [end-to-end.md](end-to-end.md).

## From nothing

**You need:** a GitHub account (your own, or an organization; free), a Claude subscription (or a
gateway key: OpenRouter has free models), and a machine to be a box: a Raspberry Pi, a small VPS,
or this PC, on Ubuntu 24.04 LTS or newer. On the PC: Linux, or Windows with WSL and systemd on,
with Node 22, pnpm, git and `gh`. Cloudflare (free) comes only with the add-ons that need it.

**First, your copy:** on GitHub, open the Shipify template (the one you were given, or
`<owner>/shipify-template`) and press **Use this template** → **Create a new repository**: name it
`shipify`, private, on your account or an organization of yours. It starts clean, at the
template's newest version, and takes each new one as a PR ([releases.md](releases.md)).

**Then, on this PC,** one line at a time. Sign it in to GitHub first: your copy is private, so
taking it needs that.

```sh
gh auth login        # GitHub.com, HTTPS, then log in with the browser
gh auth setup-git    # git signs in the same way
git clone https://github.com/<you>/shipify && cd shipify && pnpm install
pnpm ship setup
```

`ship setup` checks each step against the real world and names the next one. It stores nothing:
stop any time, run it again, and it carries on. Keys go in at a hidden prompt, never printed. Each
command below shows its plan first; `--yes` does it.

**The core: four steps to a first answer.**

| Step | You do | ✓ when |
|---|---|---|
| **1. GitHub** | your copy, and this PC signed in (`gh auth login`, above); your time zone, offered from this PC | this login administers your copy, and the zone is its variable |
| **2. The bot** | `pnpm ship bot --yes`: press **Create**, install it on **All repositories**, then set **Variables: Read and write** | the bot's key and id are on your copy |
| **3. The agent's login** | `claude setup-token`, then paste it at setup's hidden prompt: setup sets the secret (a new one later: `pnpm ship setup agent --new`) | the secret is on your copy |
| **4. A box** | this PC: `pnpm ship box add --yes`; a Pi or VPS: `pnpm ship box add <user@host> --manage --yes` (sudo once; [box-setup.md](box-setup.md)) | a slot online with the sandbox, the only kind that takes a task |

**This PC on WSL:** the sandbox also needs Windows walled off from the agents (your Windows drives,
and Windows programs started from WSL). `box add` checks it and, until then, stops with the fix
for `/etc/wsl.conf`. That fix means no Windows programs from WSL (a link no longer opens in your
browser by itself), so a Pi or a spare Linux machine may suit you better as the box
([box-setup.md](box-setup.md#this-pc)).

Then ask: open an issue in your copy, "what can you do?", on GitHub or its phone app. A box answers
within a minute or two.

**Add-ons, whenever you want them** (setup shows each with ○, and none blocks):

| Add-on | You do |
|---|---|
| **Chat and repeats:** the door, the watch, your phone | `pnpm ship door setup --yes` (press **Create**, then **Install** on shipify only; **Variables: Read-only**), then `pnpm ship add telegram --yes`. The status task appears within minutes: pin it and subscribe |
| **Apps Shipify builds and deploys** | your host's deploy key, at `pnpm ship setup apps`: it finds your account and workers.dev name with it ([setup.md](setup.md#tokens-and-secrets)) |
| **Updates:** each new Shipify version as a PR | nothing, on the template's own account or with a public template; a private one on another account: its read-only key, at `pnpm ship setup updates` ([releases.md](releases.md)) |
| **Everything checked** | `pnpm ship selftest`, then `pnpm ship doctor --yes` (it records the key dates it can find) |

**Notion,** for tasks that read and change your pages: `pnpm ship add notion --yes`
([tools.md](tools.md)).

**Another account** (your company's org, your own user, another org of yours), if you want
Shipify there: `pnpm ship bot repos --yes` once (press **Create**), then `pnpm ship bot repos
<account> --yes` for each account, and install the App there on the repos you pick. Then
`<account>/<repo>: …` from any chat ([setup.md](setup.md#another-account-the-repos-app)).

**pi and OpenCode,** two more agents on OpenRouter's free models, if you want them: make a key at
openrouter.ai/settings/keys, then `pnpm ship add openrouter --yes` and paste it. Say `use pi` or
`use opencode` on a task; `pnpm ship selftest pi` (or `opencode`) checks it end to end
([agents.md](agents.md)). Vercel's AI Gateway works the same, as `pi-vercel` and `opencode-vercel`.

**The status page and the web chat,** if you want them: `pnpm ship door page --yes`, then
`pnpm ship add webchat --yes`. The chat is a window of Shipify's own at the edge's address
(`shipify.<your workers.dev name>.workers.dev`, or `shipify.<APPS_DOMAIN>` with your domain),
under `/admin/chat/`, behind the same sign-in: every task, files, repeats and the
notebook, from your phone or PC ([channels.md](channels.md#the-web-chat)). Turn on
**Setup → Notifications on this device** in it, and a reply tells your phone when it comes, with
the chat closed ([channels.md](channels.md#notifications)).

**First things to try,** from your phone or a new issue:

| Send | You get |
|---|---|
| `/ping` | each box and the watch, at once |
| `what can you do?` | an answer, and nothing changed |
| `remember: short answers, in bullets` | saved at once, with no AI; every later run reads it |
| `repeat: every day at 09:00, remind me to drink water` | "Set: …", with the next time |
| `new: a tip calculator` | a plan PR to read and merge |

## Every day

| You want | You do |
|---|---|
| an answer | write to the bot or in the web chat, or open an issue: just words |
| to carry on | reply to the bot's message, write in the task's thread in the web chat, or comment on the task |
| a change to an app | `<app>: what to change` → its PR → merge → "Live" |
| a new app | `new: the idea` → a plan PR → merge → built → "Live" |
| a change in Notion | ask; read the exact calls under the reply; tap Yes, or say `yes` |
| a note it keeps in mind | `remember: …` |
| a reminder or a regular job | `repeat: every Monday at 9, …`, or the Repeat form |
| to watch a value | `shipify: a check that tells me when <x> changes` → its PR (`checks/<name>.mjs`) → merge → `repeat: every hour, check <name>` |
| release, take down, bring back, roll back | `<app>: release` from any channel; `<app>: take it down` (or `bring it back`, `roll back production`) only on GitHub, as a task's title or the Operate form, since they change the live app at once |
| to see what's going on | the status page (the edge's `/admin/status`, after `pnpm ship door page --yes`); the web chat's list and Status & setup; `/ping` and `/apps` from any channel; the status task on GitHub |
| an automation to keep | a recipe: say "turn on the daily brief recipe", or a file in `recipes/` in a PR ([recipes.md](recipes.md)) |
| to fix something that failed | its reply names the one thing to do |

Every word a task understands: [tasks.md](tasks.md).

## Changing Shipify later

| To | Do | The rule |
|---|---|---|
| fix or improve something | `shipify: …` from the bot, or `pnpm ship pr` from a terminal | a PR you merge |
| share what's piled up with every copy | `shipify: release` on GitHub, or `pnpm ship template --yes`: checked, versioned, published to the template; each copy gets one PR ([releases.md](releases.md)) | only from the copy where Shipify is built |
| take a new Shipify version | merge its "Shipify 0.x.y" PR, which arrives by itself weekly; a tool, channel or agent you added stays | a PR you merge |
| make a big change | an ADR first, merged, then the build | planned first |
| let a tool act without asking | a pre-approved call in `tools.json` (fixed ids, capped text), in a PR | merging approves it |
| add a tool | start from `plugins/_template/tool/`, add its `tools.json` entry, run `pnpm ship tools check`, open a PR; after the merge, `pnpm ship add <tool>` ([tools.md](tools.md#adding-a-tool)) | a skill or a check first, if one would do |
| add a chat channel | an adapter in `edge/src/channels/`, from `plugins/_template/channel/`, in a PR; after the merge, `pnpm ship add <channel>` ([channels.md](channels.md#adding-another-channel)) | one channel, in the edge |
| add an agent | an adapter in `cli/lib/agents/` and an `executors.json` entry (its install, its login or gateway), in a PR; after the merge, `pnpm ship selftest <agent>` ([agents.md](agents.md)) | it passes the agent conformance test |
| add a check | `checks/<name>.mjs` in a PR | it runs with no keys |
| add a box or a slot | `pnpm ship box add [<user@host>] [--slots 2] --yes` (`--manage` for a Pi or VPS) | any box takes any run |
| upgrade an app's stack | `<app>: upgrade`, or `pnpm ship upgrade <app>` | its workflows must match the stack |

## Upkeep

| When | What | Reminded by |
|---|---|---|
| yearly | the agent's login: `claude setup-token`, then `pnpm ship setup agent --new` | the watch, once its date is in `SHIPIFY_KEY_DATES` |
| when it expires | this PC's `shipify-pc` token: a new one, `gh auth login`, `pnpm ship doctor --yes` | `ship doctor`, and the watch |
| when it says so | a box offline, a runner near its update limit, an app failing | the alert, with its fix |

The rest: [setup.md](setup.md#things-to-check-now-and-then). Something's off:
[troubleshooting.md](troubleshooting.md).
