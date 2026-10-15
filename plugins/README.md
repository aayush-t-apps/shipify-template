# Plug-ins: where to start

Shipify's core runs the flow and names no plug-in. Tools, channels, stacks, checks and recipes plug
in through a contract, and agents stay pluggable the same way. Each kind's contract, where its plug-ins live and
the test every one passes: [docs/plug-ins.md](../docs/plug-ins.md). `pnpm ship plugins` lists them
with what's there now.

## Adding one

| You're adding | Start from | It's done when |
|---|---|---|
| a tool tasks use (Linear, Gmail, a calendar) | [`_template/tool/`](_template/tool/) → `tools/<name>/` | `pnpm ship tools check` and `pnpm verify` pass, `pnpm ship add <name>` sets it up, and `pnpm ship selftest <name>` checks its keys |
| a chat channel (Telegram is the first), or an out-only one (Notion, Obsidian) | [`_template/channel/`](_template/channel/) → `edge/src/channels/<id>.ts`, one line in `channels/index.ts`, its fixtures, its `tools.json` entry | `tests/edge/channels.test.ts` passes for it, `pnpm ship add <id>` sets it up, and `pnpm ship selftest chat` reaches you through it |
| a check (a value to watch) | `checks/example.mjs` → `checks/<name>.mjs` | `tests/checks.test.ts` passes, and a repeat or recipe with `check <name>` replies when it changes |
| a recipe (a repeat kept as a file) | `recipes/examples/` → `recipes/<name>.md` | `tests/recipes.test.ts` passes, and after the merge its task says when it runs next |
| an agent | [`_template/agent/`](_template/agent/) → `cli/lib/agents/<name>.ts`, and its `executors.json` entry | the agent test passes with a recorded run of it |
| a stack (Go, Python) | `stacks/` and [docs/design.md](../docs/design.md), from a second real project | `pnpm test:golden` passes |

Each starting folder's README is its checklist: the files, the keys, the docs and the setup, in
order. Nothing in the core changes when a plug-in is added.
