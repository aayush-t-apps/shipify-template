---
status: accepted and built (one PR, the owner's go on 2026-10-11); hardened after review (2026-10-13)
date: 2026-10-11
amends: 0038 (an agent and its gateway are two things the file says apart; the models, Auto and efforts are the gateway's)
---

# 0052: Agents and gateways, two axes that make every pair

## The owner's asks (2026-10-11)

- "Add Vercel's AI Gateway for the agents; I can switch the default from a GitHub variable."
- "Keep it modular, consistent and clean; no maintenance when I add a model, an agent or a provider."
- "Per gateway, per model, what they take (auto, effort) is stored and picked flexibly; we give
  no philosophy to a model or a gateway."
- "Core strong, nothing broken, no compatibility cruft: fresh, simple, working."

## What was found

Vercel's gateway went live as two hand-written copies of pi and OpenCode (`pi-vercel`,
`opencode-vercel`), each with its own list of models, Auto and efforts. It worked, and each
step showed the cost of that shape:

- **Copies:** pi and OpenCode already carried the same list for OpenRouter; a second gateway made
  four, to keep in step by hand.
- **What a model takes is per gateway and per model.** Vercel refused `reasoning_effort: high` on an
  on/off model, and refused a model with no zero-data-retention provider on an account that
  requires it (tasks #343 and #344, read from the gateway's own words). A list of efforts for the
  agent could not say it; `noEffort` could say only "none".
- **The word problem:** `zai/glm-5.3` beside `z-ai/glm-5.3` made the bare word `glm-5.3` ambiguous.

## The design

1. **Two axes in `executors.json`.** An *agent* is a program: its install, its adapter, the names of
   its efforts, its default `modelPattern`, and the `gateways` it may use. A *gateway* is where models
   are served: its key, its `models` (listed first), its `auto`, its `efforts`, its names, and how
   to read its list. What a gateway says wins; the agent's fields are the defaults.
2. **One pure adapter, `expandAgents` (`cli/contracts/gateways.ts`)**, makes the entry a run works on
   for each pair: `pi` is pi through its first gateway (so every id, task and `SHIPIFY_AGENT` keeps
   its meaning), `pi-vercel` through the second, named by the gateway's `word`. They are one
   program: one install folder, and none but the file's `default` is the default. The CLI's loader
   and the menus (edge, chat) both read the file through it, so nothing downstream changed: the
   picker, the `use` grammar, the runs and `ship doctor` see entries as before.
3. **Efforts are data per gateway and per model.** A gateway's `efforts` is a list for every model, or
   `{"*": […], "<model>": […]}` (none: `[]`); the agent takes those of its own that these have. A
   model's own list is `modelEfforts` (replacing `noEffort`, which was its `[]` case), and one
   function, `effortsFor`, answers "what does this agent take with this model" for the grammar, a
   run, the menus and Telegram. A gateway's `list.efforts` reads what the catalog says of any model
   found by search (a path into a list: `reasoning_options.values`).
4. **Fallbacks, so a new thing needs the least:** a gateway with no `auto` gives its first model,
   with no effort; one with no `efforts` takes the agent's; one with no `modelPattern` takes the
   agent's; any id the pattern matches runs even if unlisted.
5. **A bare word names one model.** The models a gateway names its own way are reached through its
   agent (`use pi-vercel glm-5.3`, or a bare word on a task already on it), so a second gateway never
   makes a word ambiguous.
6. **The default is one variable, for runs and the chat alike.** `SHIPIFY_AGENT` also orders the
   edge's menus (`useDefaultAgent`, as `useTimeZone` is set), so the chip says what runs.
7. **No compatibility layer:** hand-written variants (`extends`) and `noEffort` are gone; the file
   is migrated, and the ids that were in use stay the same.

**What is held by tests:** each listed Vercel model's efforts equal the catalog's, recorded
(`tests/fixtures/vercel-reasoning.json`), none of them lacks a zero-data-retention provider, and
Auto's effort is one its model takes; the adapter's precedence, fallbacks and install sharing
(`tests/gateways.test.ts`); the grammar's refusals per model; the menu's per-model efforts.

## Docs this touches (updated in the same PR)

`docs/agents.md` (the file, Gateways, Agents and gateways), `configuration.md`, `plug-ins.md`,
`setup.md`, `security.md`, `troubleshooting.md`, `getting-started.md`, `tasks.md`, `channels.md`,
`glossary.md`, `settings.md` (from the settings list), the agent template's README and the plug-ins
skill; the CHANGELOG.

## Left for later

Reading a gateway's per-model limits (efforts, retention) at run time rather than from the file,
and hiding what an account's policy refuses: they depend on settings Shipify cannot see, and the
refusal is already told in the gateway's own words (troubleshooting).

## Hardened after review (2026-10-13)

Two independent reviews of the build, and the first live runs after it, found what the design
didn't say yet. The rules, now in the code and its tests:

- **What can't be made is left out, said once:** an agent whose first gateway isn't there or isn't
  right is left out (its id means that gateway; it never shifts to another); another missing
  gateway, one listed twice, or a made id that's taken is skipped; `extends` and `gateway` aren't
  written by hand. `expandAgents` returns these problems, and `readExecutors` expands with only the
  gateways that are right.
- **Precedence:** Auto is the gateway's, else the agent's, else the gateway's first model; per-model
  efforts through a gateway are the gateway's alone.
- **Words and buttons:** an id only another gateway lists finds its agent there from any task, and a
  `/models` button through another gateway names its agent. An effort with no model named is held
  to Auto's model, as a run is. A catalog's `none` reads as the agents' `off`, and the picker keeps
  and offers only what the model takes.
- **One default everywhere:** the CLI sets `SHIPIFY_AGENT`'s agent first too (GitHub's `/models`),
  and a run's details name the gateway it went through.
- **Reads:** the edge's cache shares a read already going; a list body is parsed once per answer.
- **The copy of Shipify per commit** is built in a folder of each run's own and moved in by the
  first (`mv -T`), as five runs at once on a new commit broke each other's (#352-#356).

## Read as needed (2026-10-13)

The hardened build still kept two things by hand: each listed Vercel model's efforts in
`executors.json` (with a recorded catalog to test them against) and the Repeat form's model list,
in two copies. Both were copies of something that already says it, so both are gone:

- **A gateway's `efforts` is removed.** What a model takes is its gateway's catalog, read when it's
  needed through one reader (`modelLookup`: a gateway's `list.model`, one model's own answer, else
  its search for the id; `modelFacts`). A run reads it before the agent starts and holds the effort
  to it (`heldTo`: Auto's when the model takes that, else none, said in its details); the picker
  reads the same. A `use` line takes any of the agent's efforts. The recorded catalog and its test
  are removed: the live answers matched them exactly.
- **The Repeat form's Model** is each agent as the file makes them on the page (`repeatModels`),
  and the words a `use` line says on GitHub's form, so a new agent or gateway needs nothing there.
- Left: `modelEfforts` for an agent's own models (Claude Code's Haiku takes none), which no gateway
  reports.


## After a second review (2026-10-13)

- **`off` where the catalog says thinking is optional:** OpenRouter says it with
  `reasoning.mandatory: false`, not among a model's levels, so `heldTo` turned `off` into Auto's
  `high` for Nemotron and DeepSeek V4.1 Flash. A gateway's list may name that path (`list.off`),
  and the reader adds `off` there.
- **Search finds only models with a zero-data-retention provider** on Vercel (`list.only` takes one
  of several words: `["zdr", ["all", "some"]]`), as the listed ones are.
- **The Repeat form's Model** takes `use` words with or without `use`, and a pick it can't read is
  said, never run as Auto.
- **The edge shares no read still going between requests;** finished answers are kept as before.
- "What is held by tests" above names a fixture "Read as needed" removed: the catalog is read live,
  and the reader's paths are held by `tests/edge/telegram.test.ts` (`modelsFound`) and
  `tests/gateways.test.ts` (`heldTo`).
