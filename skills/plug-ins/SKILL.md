---
name: plug-ins
description: Adding a Shipify plug-in well (a tool, a chat channel, a stack, an agent, a check, a recipe) through its contract and conformance test, without touching the core. Use it when adding or changing any plug-in, or when a change seems to need the core to name a provider.
---

# Adding a plug-in well

Shipify's core names no agent, gateway, tool, channel or host (`tests/core.test.ts` refuses it). Every edge
plugs in through a contract (`cli/lib/plugins/`, or `edge/src/channels/channel.ts` for a chat
channel) and passes its kind's conformance test (`tests/plugins/`, `tests/edge/channels.test.ts`,
`tests/checks.test.ts`, `tests/recipes.test.ts`). `tests/architecture.test.ts` holds the rules: a
plug-in imports only its contract, `cli/contracts/` and Node; the core finds plug-ins through a
registry, never by name. `docs/plug-ins.md` has every kind; `plugins/` the starting folders.

## The order that works

1. **Read the contract** for its kind and its test. If what you need isn't in the contract, change
   the contract (and every plug-in of the kind) in a PR of its own, rather than reaching around it.
2. **Start from its folder** (`plugins/_template/<kind>/`; a chat channel's is
   `plugins/_template/channel/`): the README is the checklist.
3. **Add it to its conformance test,** with a fake of the provider (a recorded answer, a stand-in
   script, a chat's fixtures in `tests/edge/channels/`), so the test runs offline and in CI. One
   line in its registry, nothing else in the core.
4. **Write its entry** (`tools.json`, `executors.json`): keys by verb, each the narrowest the
   provider allows: a read-only key for `look`, a write key only for `act`. Never a value in a
   file: secret names only. An agent's entry has its `install` (pinned) and its login (`login`,
   or `gateways`); what it must never run is `executors.json`'s `commands`, said once for every
   agent, which its adapter writes as its agent's own rules (Claude Code's flags, pi's gate).
5. **Keep the agent thinking only:** the agent looks with read-only keys and proposes changes as
   exact `calls`; the box makes them after the owner's `yes`, with the act key in the apply step
   alone. A tool's act calls get an argument check (`args`); `pre` forms only for calls safe with
   no `yes`, and merging them is the approval.
6. **Make it fail alone:** a broken entry, a missing key or a timeout leaves it out with a plain
   reason (`ship doctor`, `ship plugins`), never breaks a run or another plug-in.
7. **Add its check** (`ship selftest <name>` runs it live) and its `setup` in its entry when someone
   has to sign up for anything or paste a key: what they need, the keys, and any steps, each
   checking itself first. `pnpm ship add <name>` runs it, one step at a time; never a command of
   its own.
8. **Docs in the same PR:** `docs/plug-ins.md` (what's there now), its own guide if it needs setup
   (`docs/tools.md`, `docs/channels.md`, `docs/agents.md`), `docs/setup.md` for its keys, and the
   CHANGELOG.

## Smells

- The core gains a provider's name, a special case or a new `if` for it: move that into the
  plug-in or its contract.
- A key that can do more than the verb needs.
- A write key, an act key or a channel's key anywhere the agent runs (the think step).
- A test that needs the network or a real account.
