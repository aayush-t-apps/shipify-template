---
status: accepted (merged #199; its Commands row amended by 0043, a short refused list); its first build (the harness and pi) is below in [As built](#as-built-2026-10-06). Proposed from the owner's requests of 2026-10-06: adopt what fits from Hermes Agent's ideas; support other agents and open models cleanly; channels that work as one; long sessions handled cleanly. On review: don't rebuild what agents do themselves; Shipify is the harness around the agent, its core and processes generic behind well-kept interfaces; skills and improvement; keep the doc simple. Then: pi and OpenCode as quick choices, with any gateway (an OpenCode subscription, Vercel's); tools and connectors that work with every agent through one clean setup; Notion as the outward side: docs it reads, pages it keeps up to date, replies shared with others. Merging its PR accepts the design and its build plan)
date: 2026-10-06
amends: 0015 and 0031 (the agent's setup, rendered by each adapter), 0032 (out-only channels become a tool's share), 0035 (a read token per phase), 0036 (next words, progress)
---

# 0038: A clean harness for any agent, Notion as your outward side, and channels in step

## Read this first

Shipify is the **harness** around the agent: it gives the agent a task, a sandbox, tools, models
and clocks, runs the checks, and turns what the agent proposes into changes you approve. The agent
does the thinking, and with it what agents already do well (compacting their context, planning,
their own subagents). Shipify doesn't build those again.

This ADR adds what the harness and the channels are missing:

| Idea | Here? | Why |
|---|---|---|
| One setup for every agent: commands, tools, models, folders | **Yes** | Each agent configures itself its own way; the harness says it once and each adapter writes it |
| Gateways, defined once | **Yes** | Any model, through any gateway (NVIDIA, OpenCode Go or Zen, Vercel, OpenRouter), for any agent |
| pi and OpenCode as agents | **Yes** | Quick choices beside Claude Code: `use pi`, `use opencode` |
| A read token made right before the agent | **Yes** | It's made before the clone and `make setup` today, so a long ask outlives it and `stop` stops working |
| Notion as your outward side: read, share, keep a page current | **Yes** | GitHub is private: Notion is where others read what Shipify made |
| Skills for every agent; lessons as skill PRs | **Yes, as words** | The agent reads skills itself; Shipify keeps where they live, and that a change is a PR |
| Next words as buttons; `pause`; Operate from a chat; progress in the web chat | **Yes** | Small gaps in the channels, one of them a bug (the web chat's Pause ends a repeat) |
| A conversation budget; compaction; handoff headings | No | The agent compacts its own context; today's threads are far from a model's window, and "Prompt is too long" is named since #198 |
| New state words, a GitHub form per starter, Telegram topics or reactions, a Mini App, Web Push | Not now | More surface than today's need |

Research of 2026-10-06 ([Sources](#sources)).

## 1. One setup, written by each agent's adapter

The harness says each part of an agent's setup **once**. Each agent's adapter writes it in that
agent's own format, into the run's own folder, never the agent's user settings or the project's
files. A project can't widen what an agent may do.

| Said once | In | Claude Code | pi | OpenCode |
|---|---|---|---|---|
| **Commands** it may run (`allow`, `deny`, `web`); replaced by [ADR 0043](0043-agents-run-what-they-need.md): only `deny` and `web`, any other command runs | `executors.json` | `--allowedTools`, `--disallowedTools` | Shipify's gate extension (`-e`): it blocks a call before it runs | `permission.bash` |
| **Tools:** MCP servers, look calls only | `tools.json` | `--mcp-config`, `mcp__<tool>__<call>` allowed | `mcp.json` in its agent folder; `--tools` names the same `mcp__<tool>__<call>` | `mcp`, with act calls denied |
| **Models,** through a gateway | `executors.json` (`gateways`) | its login | its built-in provider, or `models.json` | its built-in provider, or `provider` |
| **Folders** it may read and write | the run | `Read`/`Edit` rules | the gate extension | `permission.external_directory` |
| **Instructions and skills** | AGENTS.md, `skills/` | AGENTS.md (through CLAUDE.md), `.claude/skills` | AGENTS.md, `.agents/skills` | AGENTS.md, `.agents/skills` |
| **The project's own config** | | ignored (`--setting-sources user --strict-mcp-config`) | ignored (`--no-approve`, `--no-extensions`) | the adapter's config wins; tested against a hostile project file |

**One test for all of it.** The agent conformance test gives every adapter the same setup and
checks what it writes:
- it allows the same commands and refuses `git push` (since ADR 0043: it refuses the same
  commands in any form, and runs anything else);
- it gives the same look calls and refuses the act calls;
- it allows the same folders;
- it ignores a project file that tries to widen any of these.

**What moves out of the core,** so the core and `task.yml` name no agent:

| Today | After |
|---|---|
| `think.ts` passes `CLAUDE_CODE_OAUTH_TOKEN` | the chosen agent's login, or its gateway's key, from its entry |
| `think.ts` adds `--setting-sources user --strict-mcp-config` | Claude Code's adapter |
| `DISABLE_AUTOUPDATER`, `CLAUDE_CONFIG_DIR` | each adapter's `env(paths)` (pi: `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, `PI_TELEMETRY=0`) |
| `runs.ts` knows `five_hour`, `seven_day_opus` | each adapter names its limit windows |
| `task.yml` installs Claude Code at `CLAUDE_CODE_VERSION` | each entry's `install` (`npm`, `version`, `bin`), pinned; a version moves only in a PR that says so |
| `box/peek.mjs` reads Claude's session files | the run's own log |

## 2. Gateways, defined once

A **gateway** is where models are served. `executors.json` lists each one once:

```json
"gateways": {
  "nvidia":      { "url": "https://integrate.api.nvidia.com/v1", "protocol": "openai-chat", "key": "SHIPIFY_NVIDIA_KEY" },
  "opencode-go": { "url": "https://opencode.ai/zen/go/v1", "protocol": "openai-chat", "key": "SHIPIFY_OPENCODE_KEY" },
  "vercel":      { "url": "https://ai-gateway.vercel.sh/v1", "protocol": "openai-chat", "key": "SHIPIFY_VERCEL_KEY" }
}
```

- **Three protocols cover them all:** `openai-chat`, `openai-responses` and `anthropic-messages`.
  An adapter maps each to its agent's own setting: pi's `api`, OpenCode's provider package.
- **Built in first:** pi and OpenCode both have NVIDIA, OpenCode Zen and Go, Vercel and OpenRouter
  built in. For those, an adapter names the built-in provider and passes the key; it writes a
  config only for a gateway that isn't built in.
- **An agent's models name their gateway:** `"glm": "nvidia/z-ai/glm-5.3"`,
  `"kimi": "opencode-go/kimi-k2.7-code"`. So `use pi kimi` picks the agent, the model and the
  gateway in one go.
- **Adding one:** `pnpm ship add gateway <name>` shows the plan, asks for the key (hidden), sets
  it on shipify, and checks it by listing the gateway's models. `ship doctor` checks it again.
- **Its key reaches the agent,** because the agent calls the model, the way Claude Code's login
  does today. A run gets only the key of the gateway it uses, and the box keeps none. Set a spend
  limit on the gateway where it offers one.

**Which gateway** (light use: a few tasks a day, 30 to 100 requests each):

| Gateway | Cost | Good for | Catch |
|---|---|---|---|
| **NVIDIA** | free, no card | trying pi today (GLM-5.3, Kimi, DeepSeek) | trial terms ("testing and evaluation"); about 40 requests a minute |
| **OpenCode Zen**, free models | free | trying | "for a limited time"; some may train on prompts |
| **OpenCode Go** | $10 a month | daily use (Kimi K2.7 Code, DeepSeek, MiniMax) | a paid plan. pi is a client it supports |
| **Vercel AI Gateway** | a monthly credit (about $5) | Kimi, MiniMax, Qwen Coder, GPT-5.1 Codex mini | needs a card on file; no Claude on the free credit |
| **OpenRouter**, free models | free | a task a day | 50 requests a day |

**Your Claude plan stays on Claude Code,** which stays the default (Anthropic's terms).

## 3. The agents: pi first, then OpenCode

**pi** (`@earendil-works/pi-coding-agent`, 1.0.4) is a small agent core built to be extended; it
needs Node 22.19, and the box has 22.23. Its adapter runs it as:

`pi --mode json --session-dir <run>/sessions -na -ne -e <gate> --provider <p> --model <m> --thinking <effort> --tools <list>`

- **The gate extension** is Shipify's: it enforces the one allow list and the folders, and blocks
  anything else before it runs (pi has no command list of its own, by design).
- **Its report** comes from its events: tokens, tools, calls the gate refused, compaction, retries.
- **Its session** lives in the run's folder, so the catch-up and the fix round resume it.
- **Its answer** is written to `out/result.json`, as the playbook says.

**OpenCode** (`opencode-ai`, 1.18.34) follows, the same way: `opencode run --format json`, its
config in `OPENCODE_CONFIG_CONTENT`, and its model list kept as shipped
(`OPENCODE_DISABLE_MODELS_FETCH=1`).

**Choosing:** `use pi`, `use pi kimi`, `use opencode`, `use claude opus high`, in words or in the
web chat's chips (an agent chip shows when there's more than one). The default is
`SHIPIFY_AGENT`, else the entry marked `default`.

**A read token right before the agent.** Think's first part (the clone, a new repo's layout,
`make setup`) becomes its own step, **ready**, and the agent's token is made after it. The ask and
its catch-ups then have the token's whole hour, as ADR 0035 meant each phase to.

## 4. Notion: your outward side

GitHub is private, so Notion is where Shipify's work meets other people. One tool, three uses:

- **Read:** the agent reads Notion pages you name, or link in a message, with its look calls, as
  it does today.
- **Share:** `share` is a fixed word from any channel. With no agent, the box puts the task's
  newest reply on its own Notion page, and the reply gives you the link. `share thread` shares the
  whole conversation.
- **Keep a page current:** a recipe can say `share: replace`, so each run's reply replaces its own
  page: a weekly status page others read, say. Merging the recipe approves it.

**How it works:**
- **Setup:** `pnpm ship add notion` makes a "Shipify shares" page, with a "Shares" table in it,
  under a page you've connected to Shipify's integration. You then either publish that page once,
  so anyone with a link can read a share, or share it with the people who may read. Notion's API
  can't do either step itself.
- **One share call:** the tool gains one act call, `share_page` (a key, a title, the Markdown and
  the files), and its `tools.json` entry gains `share`, naming the table. Merging that change
  approves sharing, as a pre-approved call is approved today.
- **Each share:** the box looks the key up in the table (`<task>` or `<task>/<reply>`). It
  replaces that page's content, or creates the page, from Markdown (Notion's API takes Markdown
  since 2026-02-26). It uploads the reply's files (GitHub's links are private), then reads the
  page's link back.
- **Generic:** any tool can say how it shares. Notion is the first; Google Docs or an Obsidian
  vault would be one more tool. The core names none. This replaces the "out-only channels"
  sketched in 0032: an outward copy goes through a tool, so its write key never sits on the edge,
  and every share is on the task's record.

**The cases:**

| Case | What happens |
|---|---|
| `share` twice on the same reply | the same page, its content replaced; the same link |
| `share` from Telegram or the web chat | the door writes the word; a run with no agent shares; the reply with the link pings you |
| A reply with photos or files | uploaded to Notion with the page; one over 5 MB (Notion's free limit) is named and left out |
| Notion is down or busy | ✗ with Notion's answer and "say `share` again"; the key lookup stops a duplicate |
| The parent page isn't published or shared | the page is made; the reply says it's private until you publish or share "Shipify shares" |
| The agent proposes a share ("send this to my team") | the agent's own call. It's pre-approved only when the run read nothing from outside; otherwise it's listed for your `yes` |
| A recipe that shares | its runs share by themselves; you approved that by merging the recipe |
| Nothing to share yet | "Nothing to share on #12 yet" |
| A free Notion workspace with members | Notion caps integrations at 1,000 blocks; `ship add notion` checks and says so |
| Privacy | a published page shows its editors' names, and its readers can reach the other shares under it. Share it with people instead to keep it private. `ship add notion` asks which |

## 5. Skills and improvement

- **One home:** `skills/`, linked as `.claude/skills` and `.agents/skills`, so every agent finds
  them. AGENTS.md stays whole in itself.
- **Lessons become skill PRs, never notes.** When you corrected the agent, or it found a better
  way after dead ends, its reply says so in one line: the skill and the lesson. Saying
  `shipify: add that lesson to <skill>` makes the change as a PR you merge. Hermes's rules go in
  the playbook: patch an existing skill before making one, a lesson not a log, never "tool X is
  broken".
- **A skill check** in `pnpm verify`: each skill has its name and when to use it, and no task
  numbers or dates.
- **Past tasks first:** the playbook searches past tasks (`gh issue list --search … --state
  all`) before asking you again.

## 6. Channels in step

- **Next words:** decide knows what a reply leaves open, so the reply carries `next`: the fixed
  words that fit (`continue`, `close`, `again`, `pause`, `resume`, `stop`, `reopen`, and `share`
  once a tool shares), with the GitHub-only ones (`yes`, `go`, `publish`, `preview`, `start over`)
  marked. GitHub shows them as a line under the reply. The web chat shows them as buttons, no
  longer guessed from backticks. Telegram shows them as buttons too: a tap (`w:<task>:<word>`) goes
  through the door like a typed word, and the buttons come off. A GitHub-only word is a link to
  where you say it.
- **`pause`,** a fixed word from anywhere: the repeat is kept and not run. `resume` carries on,
  and `stop repeating` ends it. The web chat's Pause, Resume and Stop send exactly these.
- **Operate from a chat:** "release links" is answered at once with the Operate form's link, its
  fields filled in. No task is opened only to be closed.
- **Progress in the web chat:** it reads the run's steps from GitHub (ready, thinking, checks,
  replying), and nothing is written for it.

## Every block, one interface

| Kind | What changes | Its conformance test |
|---|---|---|
| **agent** | the entry adds `install`, `allow`/`deny`/`web` and model gateways; the adapter writes the one setup and names its limit windows; pi and OpenCode join | `tests/plugins/agent.test.ts`: the one setup, written by each adapter, the same allowed and refused |
| **gateway** (new, data) | `executors.json` `gateways`; `ship add gateway` | its entry reads; its key checks |
| **tool** | an optional `share`; Notion's `share_page` | `tests/plugins/tool.test.ts`: a tool that shares returns a link, and the same key gives the same page |
| **channel** | `parse` reads a button tap as a Message with its word | `tests/edge/channels.test.ts` |
| **the shapes** | a Reply's `next` | `tests/architecture.test.ts` |
| stack, record, check, recipe, box | unchanged (a recipe may say `share`) | |

Every flow keeps its shape. `tests/kernel-flow.test.ts` adds a run with pi's and OpenCode's
recorded output, `share` and `share: replace`, `pause` and `resume`, and next words.

## Build plan

Three PRs, each from a fresh `main`; release 0.3.0 after the third.

| PR | Builds | Docs |
|---|---|---|
| **1. The harness, and pi** | the one setup and what leaves the core; gateways and `ship add gateway`; the ready step and its token; pi's adapter, gate, install and selftest; skills for every agent, lessons, the skill check, past tasks | agents.md, plug-ins.md, configuration.md, setup.md, security.md, playbooks/task.md, skills/README, glossary (gateway, harness) |
| **2. OpenCode, and Notion's share** | OpenCode's adapter; `share_page`, `share`, `share thread`, a recipe's `share`; `ship add notion` for the shares page | tools.md, notebook.md, recipes.md, channels.md (out-only channels go) |
| **3. Channels in step** | `next` and its buttons; `pause`; Operate from a chat; progress in the web chat | channels.md, tasks.md, door.md |

**Each step is done only when it's:**
- **clean:** no leftovers or dead code, its words in the glossary;
- **well tested:** unit, conformance, end to end against the fakes, then live with `ship selftest`;
- **properly handled:** every failure is a problem that names its fix;
- **configured:** any setup is one guided command with a check;
- **written down:** docs updated, and what it makes obsolete removed (the out-only channels
  sketch, the web chat's word guessing, "Release or take down").

## Your guide: what you do

1. Merge this to approve the build.
2. **For pi:** make a free NVIDIA key (build.nvidia.com) and paste it into `pnpm ship add gateway
   nvidia`. If you take OpenCode Go later, it's one more `ship add gateway opencode-go`.
3. **For Notion:** `pnpm ship add notion`, then publish or share "Shipify shares" as it asks.
4. Try it: `use pi` on a question, then `share` on its reply.

## Decisions for you

| Decision | Default | Other choices |
|---|---|---|
| Agents beside Claude Code | pi first, then OpenCode | one of them only |
| The first gateway | NVIDIA (free) | OpenCode Go ($10 a month); Vercel (monthly credit, card on file); OpenRouter |
| Shares are read by | anyone with a link (published) | only people you share the page with |
| Telegram buttons for next words | yes | words only |

## Sources

Fetched 2026-10-06:
- **pi:** pi.dev/docs/latest (cli, models, providers, mcp, extensions, json, security); npm
  `@earendil-works/pi-coding-agent` 1.0.4.
- **OpenCode:** opencode.ai/docs (zen, go, providers, cli), `anomalyco/opencode` v1.18.34.
- **Vercel:** vercel.com/docs/ai-gateway (pricing, coding agents).
- **NVIDIA:** NVIDIA's API trial terms.
- **OpenRouter:** openrouter.ai/docs (limits).
- **Notion:** developers.notion.com (Markdown pages, file uploads, limits, changelog); Notion's
  help on publishing.
- **Hermes Agent and OpenClaw:** their docs.
- **Telegram:** the Bot API changelog.

**Not verified, so checked in the build:**
- NVIDIA's limits;
- pi and OpenCode on the Pi;
- whether OpenCode's own config wins over a project's;
- whether a new Notion page's public link is there at once.

## As built (2026-10-06)

The first build, on the owner's direction ("pi and OpenRouter first, simply; don't overfit on any
agent; let each do what it does best"): sections 1 to 3 for pi, and the agents' part of the box's
clean-up. The rest waits ([roadmap.md](../roadmap.md)). Where it differs from the text above:

- **Gateways:** `pnpm ship add openrouter`, not `ship add gateway openrouter`: a gateway is set up
  the way a tool is. OpenRouter is the first gateway (the owner has its credits), not NVIDIA.
- **Install:** an entry's `install` is its own command (`run`, with `{prefix}`), its `version`, its
  program (`bin`) and its folder (`dir`), not `npm`/`version`/`bin`, so the core names no package
  manager (`tests/core.test.ts`). Claude Code's `dir` is `claude-code`, its folder today, so
  nothing downloads again. pi is pinned at 1.0.2 (packages at least two days old) with its own
  packages as they were on 2026-10-05 (`--before`).
- **pi's models:** each gateway is a provider of Shipify's own in pi's settings
  (`shipify-<gateway>`), not pi's built-in one, so any model id at the gateway runs with pi's model
  list left alone (`PI_OFFLINE`).
- **pi's tools:** pi keeps its own four tools and built-ins as they are (no `--tools` list); the gate
  refuses what it doesn't know. Its `mcp.json` hides each server's calls but the look calls, which
  go to the model as themselves (`toolExposure`), with pi's codemode off, so the gate sees each one.
  pi's grep and find tools need `rg` and `fd`, which a box doesn't have and pi doesn't fetch
  offline: it searches with `grep` and `ls` through bash.
- **Hardening from the review:** the agent's settings are given again before every ask, so a run
  can't change the rules a resumed ask starts with; an install's folder is its own (never two
  agents', never the box's `node` or `shipify-app`); agent ids are lowercase words, as `use` reads
  them; the weekly tidy waits when it can't tell whether another slot is busy.
- **Not in this build:** the ready step and its token, OpenCode, Notion's share, the skills work,
  and the channels' next words, `pause`, Operate from a chat and progress. Claude Code's limit
  windows stay named in `cli/lib/runs.ts`, and `box/peek.mjs` still reads its session files.
- **From a box audit the same day:** the weekly clean-up removes agent versions that aren't pinned
  and Node versions but the two newest, and clears npm's cache, while no other slot runs.
- **Finding and picking any model (the owner's ask after pi went live):** pi has six paid short
  names beside the four free ones (GLM, Kimi, DeepSeek, Qwen, MiniMax, Gemini), and `/models` is
  a chat command on every channel: each agent's models, and `/models <word>` searching a gateway's
  own list through its `search` path (OpenRouter's public list, no key), each id shown as a `use`
  line takes it. The web chat's chip has **More models…**. A pick reads one way everywhere
  (`PICK` in `cli/contracts/answers.ts`): the edge's three older readers took only two words and no
  `/`, so a three-word pick from the chip was refused and a gateway's id wasn't read.
- **Then, any model picked in one tap, by its id (the owner: "keep it simple, less to maintain"):**
  the short names went (`ids`): an agent through a gateway lists a few models by the ids there, and
  the web chat's chip searches the gateway for any other (`…/api/models`, the same reader as
  `/models <word>`), in place of More models…. A new model at the gateway needs no change anywhere;
  agents.md's "When something new comes" says what each new thing takes.
- **Skills for every agent (built 2026-10-10, section 5):** no `.claude/skills` or `.agents/skills`
  links in the repo. Every run but a read one hands its agent the skills in its read-only copy of
  Shipify (`AgentRun.skills`), each agent its own way: pi's `--skill`, and for Claude Code, which
  has no flag for a folder of skills, a link in its settings folder (`skillsLink`), made as the
  agent; `--setting-sources user` reads it, and still keeps a project's settings out. Checked live
  against a stand-in model: Claude Code 2.1.284 lists all nine and loads one headless under its
  rules, and pi 1.0.2 lists all nine with their paths (it had skipped Notion's, whose header wasn't
  plain YAML). Lessons and past tasks first are the playbook's words; the skill check is
  `tests/skills.test.ts`. The conformance test holds every adapter to handing them over.
- **OpenCode (built 2026-10-10, section 3):** on OpenRouter, the same key, list and Auto as pi
  (pinned at 1.18.34, no package scripts, its program from its package for the box's `{arch}`).
  Shipify's gate is its plugin, with pi's checks: its own rules miss `env git push` and
  `/usr/bin/git push`. The gate also holds its key (read from fd 3, put on each call to the
  gateway's provider alone), as pi's does: OpenCode's `{file:}` can't open fd 3 when it's a socket.
  Its own config folder is read-only (a new, optional `readOnly` in the agent contract), or it
  installs its plugin package from npm on every start: 130 s a run on a Pi, 20 s without. A fixed
  session title, so no paid model names it. A model two agents list stays on the task's agent;
  `/models <word>`'s buttons say `use <id>` and pick on the task's agent; labels take an entry's
  `name`. Checked live on a Pi through the core and the box's own command, against a stand-in
  model: the key on every call and nowhere else, helpers under the gate, hidden pushes refused.
  `Each agent's numbers side by side` and OpenCode Go stay for later.
- **OpenCode's config is a file,** the run's `in/tools/opencode.json` named by `OPENCODE_CONFIG`,
  given again before every ask like pi's settings, not `OPENCODE_CONFIG_CONTENT` as the text says.
