# Shipify's docs

Every doc, by what you want to do. New here? Read the [tour](tour.md), then
[getting-started.md](getting-started.md).

## Start here

| Doc | Answers |
|---|---|
| [product.md](product.md) | What is Shipify as a product: who it's for, how it looks, what it holds, where it's going? |
| [tour.md](tour.md) | How does it work end to end, and where is each piece in the code? |
| [getting-started.md](getting-started.md) | How do I set it up from nothing, step by step? |
| [end-to-end.md](end-to-end.md) | How does the running system fit together, how do I check each part, and what do I do when one fails? |
| [setup.md](setup.md) | How do I set up or redo each piece? Where does each key live, and when does it expire? |
| [box-setup.md](box-setup.md) | How do I make a Pi, a VPS or this PC a box, or add slots? |

## Use it

| Doc | Answers |
|---|---|
| [tasks.md](tasks.md) | What can I ask, in which words? Fixed words, repeats, checks, run details |
| [channels.md](channels.md) | How do I use Shipify from Telegram or the web chat, and add another channel? |
| [tools.md](tools.md) | How do runs read and change my apps (Notion), and how is a tool added? |
| [notebook.md](notebook.md) | What does Shipify remember about me, and how do I add, forget or see a note? |
| [recipes.md](recipes.md) | How do I keep an automation as a reviewed file, and turn on an example? |
| [operations.md](operations.md) | Which command for status, release, roll back, down, up? |
| [process.md](process.md) | How is a project made, changed and shipped, and what do I approve? |
| [agents.md](agents.md) | Which agent thinks, with which model, and how does another plug in? |

## How it's built

| Doc | Answers |
|---|---|
| [design.md](design.md) | The parts, the eleven rules, the keys, a run's steps, the projects layer |
| [door.md](door.md) | The edge's door: my words onto tasks, replies back to my chat; the status page |
| [watch.md](watch.md) | The edge's watch: what's due, stuck tasks, resends, alerts |
| [plug-ins.md](plug-ins.md) | Every kind of block (agent, tool, channel, stack, check, recipe): its contract, test and registry, and adding one |
| [glossary.md](glossary.md) | Every word, with one meaning, next to the OS idea it matches |
| [security.md](security.md) | Who can do what, every key, the agent's sandbox, a leaked key |
| [adr/](adr/README.md) | Why is it this way? One page per decision |

## Reference

| Doc | Answers |
|---|---|
| [cli.md](cli.md) | What does each `pnpm ship` command do and change? |
| [configuration.md](configuration.md) | What can I set, in which file, variable or secret? |
| [releases.md](releases.md) | How is Shipify released, and how does each copy take a new version? |
| [settings.md](settings.md) | Every setting your copy has: where it lives, what sets and reads it (made from the one list) |
| [troubleshooting.md](troubleshooting.md) | Something's off: what's the fix? |
| [glossary.md](glossary.md) | What does each word mean? |
| [roadmap.md](roadmap.md) | What's next, and what's not planned? |
| [CHANGELOG.md](../CHANGELOG.md) | What changed in each release? |

## For agents

[AGENTS.md](../AGENTS.md) maps each ask to its steps.

| Folder | Holds |
|---|---|
| [playbooks/](../playbooks) | the steps for one job: [task](../playbooks/task.md) (the agent's, in a run), plan-app, build-app, parallel-work, fix-ci |
| [guides/](../guides) | the plan, change doc and ADR templates; architecture defaults, the design brief, the quality bar |
| [skills/](../skills/README.md) | how to do a kind of work well |
| [plans/](../plans) | one approved plan per project |

Each project has its own `AGENTS.md`, `docs/spec.md` and `docs/changes/`.

## Where a fact lives

One home per fact; the other docs link to it.

| Fact | Its home |
|---|---|
| what you can ask, and the chat commands | `intents.json` ([tasks.md](tasks.md)) |
| the fixed words | `cli/kernel/words.ts` ([tasks.md](tasks.md)) |
| a tool's calls, keys and pre-approved forms | `tools.json` ([tools.md](tools.md)) |
| an error's words and its fix | `cli/contracts/problems.ts` |
| a key's scope and expiry | [setup.md](setup.md) |
| a setting, a command's flags | [settings.md](settings.md), [configuration.md](configuration.md), [cli.md](cli.md) |
| what it costs | [the README](../README.md#costs) |
