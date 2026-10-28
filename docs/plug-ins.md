# Plug-ins

Shipify's core runs the flow and names nothing at its edges. **Tools, channels, stacks, checks and
recipes** plug in through a contract the core speaks, and **agents** stay pluggable the same way. A
new one is a plug-in, not a change to the core:
- `tests/core.test.ts` fails if the core's code names one (or a gateway);
- `tests/architecture.test.ts` fails if a plug-in imports anything but its contract,
  `cli/contracts/` and Node, if the core imports a plug-in instead of its registry, or if a shape
  between blocks loses its version (ADR 0032, "Built to grow").

- **What's there now:** `pnpm ship plugins` lists every kind, its contract, its test, and what's
  plugged in.
- **Is it all working:** `pnpm ship selftest` checks each part live, end to end.
- **Starting folders:** [plugins/](../plugins/README.md).

## The kinds

| Kind | Its contract | Written down in | Today | Add one | Every one passes |
|---|---|---|---|---|---|
| **tool** | an MCP server whose calls are each look or act, a key per verb | `cli/lib/plugins/tool.ts` | Notion, Drop | `plugins/_template/tool/` → `tools/<name>/`, and its `tools.json` entry | `tests/plugins/tool.test.ts` |
| **channel** | an adapter in the edge: prove a webhook, read it (a message or a button tap) into one Message, answer at once, send an Outgoing reply with its buttons; its files, a tap's acknowledgement, a file, its health and its menu if it can | `edge/src/channels/channel.ts` | Telegram, the web chat (`web`) | `edge/src/channels/<id>.ts`, one line in `channels/index.ts`, its fixtures in `tests/edge/channels/`, its `tools.json` entry | `tests/edge/channels.test.ts` |
| **stack** | the `make` targets, `shipify.json`, `/health`, the docs every project has | [design.md](design.md) | ts-worker, ts-static, ts-package, custom-* | a folder in `stacks/`, from a second real project | `tests/golden.test.ts` (`pnpm test:golden`) |
| **agent** | a prompt, a model and an effort in, with the commands every agent must never run (or none at all: the read profile); `result.json` and a report out | `cli/lib/plugins/agent.ts` | Claude Code, pi, OpenCode | an `executors.json` entry (its install, its login or the `gateways` it goes through) and an adapter in `cli/lib/agents/` | `tests/plugins/agent.test.ts` |
| **record** | read and write tasks, comments and labels, and make independent writes together (`together`, ADR 0051); start runs | `cli/lib/plugins/record.ts` | GitHub (`cli/lib/github.ts`) | a module like `github.ts` | `tests/plugins/record.test.ts` |
| **check** | a script with no input and no keys that prints one value to watch | [checks/README.md](../checks/README.md) | `example` | `checks/<name>.mjs` in a PR | `tests/checks.test.ts` |
| **recipe** | a Markdown file: `when`, an optional `check` and `model`, the job as its body | `cli/lib/recipes.ts` | the examples in `recipes/examples/` | `recipes/<name>.md` in a PR ([recipes.md](recipes.md)) | `tests/recipes.test.ts` |
| **box** | takes runs by its labels, passes `ship doctor`, keeps nothing between runs | [box-setup.md](box-setup.md) | your boxes | `pnpm ship box add <user@host> --manage` | `ship doctor` (each box's weekly clean-up) |
| **repo** | reachable through an App's install (the bot's on your account, the repos App's on another); its kind is its file: with a `shipify.json` a project, which keeps its stack's contract, else a repo, which keeps its own rules (`AGENTS.md`, README, CI). Shipify adds nothing to a repo it didn't build; its notes guide the agent | [tasks.md](tasks.md#which-repos), ADR 0047 | `/repos` lists yours | install the App on it (another account: `pnpm ship bot repos <account>`) | `tests/kernel-flow.test.ts` (a repo on your account and on another, end to end) |

## Tools

A `tools.json` entry, checked on its own (a broken one is left out, and `ship tools list` and
`ship doctor` say why):
- **`look`:** calls the agent makes on any run, with the look key.
- **`act`:** calls that change something, proposed by the agent and made by the box after your
  `yes` (or pre-approved under `pre`), with the act key.
- **`keys`, `args`, `pre`, `check`, `setup`:** its keys by verb, its act calls' argument checks and
  pre-approved forms, a key check, and how `ship add` sets it up.

Everything about tools, and adding one: [tools.md](tools.md).

## Channels

A **channel** is a way you and Shipify talk. GitHub is always one: it's the record. A chat channel
is one **adapter** in the edge (`edge/src/channels/<id>.ts`), behind one interface
(`channels/channel.ts`):
- **In:** the adapter proves the webhook and reads it into one Message (a button tap is one too:
  the button's words, as a reply to its message); the door checks the sender and writes your words
  onto a task as a comment, or answers at once.
- **Out:** after a run writes a reply, the door turns it into one Outgoing (its words, its task's
  link, its buttons, whether to open the reply box) and each chat's adapter renders and sends it,
  then its files. A button is words a person could type (ADR 0042), defined once for every
  channel.
- **Its own keys** live on the edge's Worker, never on a box.
- **Its setup** is its `tools.json` entry's `setup`: `pnpm ship add <channel>` runs it.

Adding one, the same things from every channel, and out-only channels (Notion, Obsidian):
[channels.md](channels.md#adding-another-channel). The door: [door.md](door.md).

## Stacks

A stack is how a kind of project is built and deployed: its files, its `make` targets, its deploy
and its `/health`. Stacks live in `stacks/<id>/`, each with a version in `stack.json`; a change that
needs action in projects gets `stacks/<id>/migrations/<version>.md`. A new stack comes from a
second real project that wants the same setup. The contract: [design.md](design.md).

## Agents

`executors.json` lists them, each entry checked on its own. An agent needs an adapter in
`cli/lib/agents/<name>.ts` (listed in `cli/lib/agents/index.ts`) to run on a box: it turns the
core's one ask into the agent's flags and settings and reads its output into a report. The core
imports the list, never an adapter.
- **Said once, for every agent:** what it must never run (`executors.json`'s `commands`, ADR 0043)
  and where models are served (`gateways`: their models and Auto too, and what each model takes read from their catalogs, so an agent through
  each is made, never copied: [agents.md](agents.md#agents-and-gateways)). Each adapter writes them as its agent's own rules:
  Claude Code's flags, pi's gate (which an agent with no rules of its own can load too: OpenCode's
  plugin does). The
  conformance test holds every adapter to the same decisions: the refused commands in any form,
  and anything else runs. In the read profile (`commands.run: false`, ADR 0044), nothing runs, no
  page is fetched, and files are read only inside its folders.
- **The tools a run offers:** every tool whose look key the run holds, or only those it names
  (`tools.only`; none for a run on another of your accounts, ADR 0045). An adapter that takes
  tools filters them with the contract's `offered`, and the conformance test checks it.
- **On a box:** installed from its entry's `install` the first time a run picks it; its login is
  its own `login`, or its gateway's key, handed over on fd 3, a pipe it reads once, never in its
  environment. Its adapter says how it reads it there (`loginFromPipe`), and the conformance test
  checks it.
- **Shipify's skills:** every run but a read one hands its agent the copy's `skills/`
  (`AgentRun.skills`), and the agent lists them itself, each with when it applies. Its adapter adds
  the flag that loads a folder of skills (pi's `--skill`), or, for an agent that reads skills only
  from its own settings, says where the run links them, as the agent (`skillsLink`: Claude Code's
  `config/skills`). The conformance test checks it, and that its report names the skills its agent
  loaded (`AgentReport.skills`): its own skill tool's, or a read of a `SKILL.md` (the contract's
  `skillRead`).
- **Its counts:** each ask's own tokens and cost. An agent whose counts are its session's from the
  start, as Claude Code's are when it carries on in a session (a catch-up round, a stay's turn),
  says so (`AgentReport.sessionTotals`), and the core counts only what each ask adds.
- **Folders it mustn't write:** an agent that writes in its own settings when it can names them
  (`readOnly`: OpenCode's config folder, where it would install a package from npm on every
  start), and the run makes them again, empty and read-only, as the agent, before every ask.
- **The same rules at every ask:** the run empties its settings folder and gives it again before
  every ask, and removes what else its agent reads its rules or code from that a command could
  write (`cleared`: Claude Code's `settings.json`, OpenCode's `~/.opencode` and cache), so a run
  can't change the rules a later ask starts with. The conformance test checks they're the run's
  own.

Models, efforts, gateways and adding one: [agents.md](agents.md).

## What every kind has

| | What | Where |
|---|---|---|
| **a contract as code** | a schema or an interface the core works through | `cli/lib/plugins/<kind>.ts`, `edge/src/channels/channel.ts` |
| **a conformance test** | the same tests for every plug-in of the kind | `tests/plugins/<kind>.test.ts`, `tests/edge/channels.test.ts` |
| **a registry** | the one list where the core finds the kind's plug-ins | `agents/index.ts`, `channels/index.ts`, `tools.json`, `executors.json`, `stacks/` |
| **a version** | `tools.json` and `executors.json` have `"version": 1`; a newer one is refused with a plain line | each file |
| **failures kept apart** | a broken entry is left out, never the file; a tool server that doesn't start is named in the run details | `loadPluginFile` |
| **a check** | `ship doctor`, and each tool's or channel's `check` | `pnpm ship doctor` |
| **one way to set up** | its entry's `setup`: what you need, the keys you paste (hidden), its steps, each checked. `ship add <name>` shows the plan, then does it (`--new` pastes keys again); `ship remove <name>` undoes it. A gateway's key the same way: `ship add openrouter`, `ship add vercel-ai-gateway` | `tools.json`, `executors.json`'s `gateways` |
| **its settings on the one list** | the keys and values it names in its own file (a stack's deploy keys and values, a tool's keys, a channel's `needs`, an agent's login, a gateway's key) join the settings list as they are: nothing to add elsewhere | `cli/lib/settings.ts`, [settings.md](settings.md) |
| **a starting folder** | a checklist, a skeleton and an example entry | `plugins/_template/<kind>/` |

## Selftest

`pnpm ship selftest [<part>|<plug-in>|<agent>|all]` runs each part's live check, end to end, and
cleans up anything it made.

| Part | Checks |
|---|---|
| `core` | the plug-in files are right, the queue answers, the watch starts due runs, the default agent is here |
| `door` | the edge answers `/health` with its version, and the door App is installed on shipify alone with exactly its permissions (`ship door check`) |
| `chat` | a message through the door becomes a task, a run answers it, and the reply reaches your chat once |
| `sandbox` | each slot's agent can't read the runner's folders, its environment or another slot's runs (on a box; from the PC, each box's last clean-up) |
| `act` | each tool's server offers every act call `tools.json` lists, so the box can make them |
| `notebook` | a run's prompt carries the notebook |
| `<plug-in>` (`notion`, `drop`, `telegram`) | its entry's `check`, with the keys `ship add` stored on this PC |
| `<agent>` (`pi`, `opencode`, `claude`, and each through another gateway: `pi-vercel`) | a question through the door with `use <agent>`, its run followed: the box has the agent as `executors.json` pins it (`run agent` in its log), it answered, and the reply reached your chat. One model call |

`all` (the default) runs every part, `door` and `chat` once `ship door setup` has run, then the
check of each plug-in set up here. An agent's check runs only when you name it, never in `all`.
