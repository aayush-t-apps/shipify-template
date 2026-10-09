# Shipify: agent guide

This repo is the platform: the `ship` CLI (`cli/`), the edge (`edge/`: the door, the watch and the
status page), stacks (each project's pipeline among their files, ADR 0048), presets, guides,
recipes and plans. Core runs the flow and never names a project tool; stacks own those (ADR 0010).
Projects live in `../projects/<id>`, each its own repo with its own `AGENTS.md`. Start with
`docs/tour.md`, then `docs/design.md`; what's decided is in `docs/adr/`, what's next in
`docs/roadmap.md`, and gotchas in `docs/troubleshooting.md`.

## Commands

- Every action goes through `pnpm ship <command>` (`pnpm ship help`). External writes need
  `--yes`: show the plan of action first.
- Before committing here, run `pnpm verify`, and `pnpm test:golden` if you touched `stacks/`,
  `presets/` or the workflows. That's the check before the PR: CI runs only after the merge
  (ADR 0018).

## What the owner asks → what you do

| Ask | Do |
|---|---|
| a new project | `playbooks/plan-app.md` → plan PR → **stop until it's merged** |
| "build <id>" | `pnpm ship build <id>` → `playbooks/build-app.md` → `make verify` → `pnpm ship publish ../projects/<id>` (show it, then `--yes`) |
| a feature or design change | by its lane (`playbooks/task.md`): a feature is one PR with its change doc (`ship change new` → `change check`); a big change gets its doc PR first (`change submit --yes`) → **stop until it's merged** |
| implement an approved change, or a fix | in `../projects/<id>` or a worktree (its `AGENTS.md`, `docs/spec.md`): update the spec, `pnpm ship version <p> [bump]` (not for staging apps, nor `"releases": false`), `pnpm ship pr <p> --yes` (it runs `make verify` and the version check). The merge deploys |
| "release <id>" | `pnpm ship release <id> --yes`, then give the owner the PR link |
| "release Shipify", or a new Shipify version | `docs/releases.md` · on GitHub, a task `shipify: release` (from a chat, the reply links there) · or `pnpm ship template` (show it, then `--yes`; `--bump minor\|major`) · each other copy: `update.yml` opens "Shipify 0.x.y", `pnpm ship update` |
| "upgrade <id>" | `pnpm ship upgrade <id>` → `--yes` → migration notes → `make verify` → ship as a change |
| status | `pnpm ship status <id>` · `list` |
| take an app down, or bring it back | `pnpm ship down <id>` / `pnpm ship up <id>` (show it, then `--yes`) |
| staging off or on for an app | `pnpm ship staging <id> off\|on` (show it, then `--yes`) → `make verify` → `ship version` (off) → `pnpm ship pr <p> --yes` |
| CI failing | `playbooks/fix-ci.md` |
| several things at once | `playbooks/parallel-work.md` |
| a task (an issue in shipify, run on a box) | `playbooks/task.md`: unattended; you only think. Commit in your clone, ask for the rest in `result.json`, never push or merge, stop at every approval |
| a box, the bot, or tasks not running | `docs/box-setup.md` · `pnpm ship box add [<user@host>]` (no target: this PC; show it, then `--yes`) · `pnpm ship box list` · `pnpm ship box status` · `pnpm ship doctor` · `pnpm ship bot` |
| which repos Shipify works on, or a repo on another account (a company's org, your user): the repos App | `/repos` · `docs/tasks.md` ("Which repos") · `docs/setup.md` ("Another account: the repos App") · `pnpm ship bot repos` · `pnpm ship bot repos <account>` (show it, then `--yes`; `--remove`) · ADR 0045 |
| setup, tokens, secrets | `pnpm ship setup` (each step checked, the next one named) · `docs/setup.md` (never print or ask for a value) · every setting: `docs/settings.md`, made from one list (`cli/lib/settings.ts`; a new one goes on the core's, the edge's or its plug-in's file, then `pnpm vitest run tests/settings.test.ts -u`) |
| a tool (Notion, …), or adding one | `docs/tools.md` · `pnpm ship tools list\|check` · `pnpm ship add <name>` (show it, then `--yes`; `--new` for a new key) · `pnpm ship remove <name>` · a call with no `yes`: a `pre` form in `tools.json` |
| a plug-in (a tool, a channel, a stack, an agent, a check, a recipe) | `docs/plug-ins.md` · `plugins/README.md` · `pnpm ship plugins` · `pnpm ship selftest` · each kind's conformance test, and `tests/architecture.test.ts` (a plug-in imports only its contract) |
| an agent: its model, effort, run details, or adding one | `docs/agents.md` · `executors.json` · `cli/lib/agents/` |
| the watch, the status task, a box offline, an app failing | `docs/watch.md` · `edge/` · `.github/workflows/watch.yml` · `cli/commands/watch.ts` |
| task, repeat, recipe or check: which one, or writing one | the table in `README.md` ("Task, repeat, recipe or check?") · `docs/tasks.md` · a check: `checks/<name>.mjs`, from `checks/example.mjs`, in a PR (`checks/README.md`) · a recipe: `recipes/<name>.md`, from `recipes/examples/`, in a PR (`docs/recipes.md`) |
| the status page | `docs/door.md` ("The status page") · `pnpm ship door page` (show it, then `--yes`) · `edge/src/page.ts` |
| Telegram, the web chat, or another channel | `docs/channels.md` · `pnpm ship add telegram` / `pnpm ship add webchat` (show it, then `--yes`) · `pnpm ship selftest chat` · the web chat's code: `edge/src/web/`, `edge/public/admin/chat/` (its diagram frame: `edge/public/draw/`), `edge/src/channels/web.ts` · approvals stay on GitHub · a new chat: an adapter in `edge/src/channels/` (`plugins/_template/channel/`) |
| what anyone can ask | `intents.json` (six intents, chat commands, fixed words) · `cli/kernel/words.ts` · `docs/tasks.md` |
| the notebook | `docs/notebook.md` · `pnpm ship notebook` (on a box) · `remember: …` and `forget: …` (no agent, from any channel), or notes in a run's `result.json` · a repo's own notes: `remember <repo>: …`, read only by runs on that repo · `/notebook` · a way of working is a skill PR, not a note |
| the door, or a chat with no answer | `docs/door.md` · `pnpm ship door check` · `pnpm ship door setup` (show it, then `--yes`; `--new` for a new key) |
| main moved under a branch | `pnpm ship refresh <p>` (merges main, redoes the version bump) |

## Skills

`skills/` holds how to do the work well, for any agent (also in `.claude/skills`). Read the ones
that fit before you start:

| Skill | When |
|---|---|
| `frontend-design` | any screen or UI change |
| `test-driven-development` | any behaviour change or fix |
| `systematic-debugging` | a failing test, CI run or bug |
| `verification-before-completion` | before saying something is done |
| `codebase-design` | shaping modules, plans and change docs |
| `api-and-interface-design` | an API, a package's exports, data shapes |
| `security-and-hardening` | input, auth, secrets, anything exposed |
| `notion` | a task that reads or changes the owner's Notion (`tools/notion`) |
| `plug-ins` | adding or changing any plug-in, through its contract and conformance test |

## Changing Shipify itself

The owner's rules, for every change here:
- **Keep the core small and simple.** It runs the flow and names no stack, agent, tool or channel:
  those plug in through their contracts (`cli/lib/plugins/`, `docs/plug-ins.md`), each held to its
  conformance test. Add the smallest change that does the job; don't rebuild what works.
- **Free only.** No paid service, no domain to buy. Keys live with their boundary: GitHub's
  secrets, each box's runner registration, and the edge's Worker secrets on Cloudflare.
- **No upgrades on the side.** Versions (each agent's install in `executors.json`, Node 22, pnpm,
  actions) change only in a PR that says so. OS security updates, the runner's own updates and
  Node 22.x fixes are the exceptions.
- **Nothing to sign in to on a box,** and no sudo after `box add`. The runner uses one sudoers rule,
  made by `box add`, to start the agent's own user (ADR 0031).
- **Everything shows on GitHub:** a run's details on its reply, the watch on the status task, each
  PR linked to its task.
- **Two planes, and a box knows nothing** (ADR 0019, ADR 0031): GitHub keeps the record and the
  queue; the edge's door writes your words onto tasks and copies replies out; the watch only reads
  and rings labels; a box runs what the queue hands it; the agent only thinks, as its own user. A
  new duty for the watch is one more line in its check, never a new part.
- **A big change is planned first:** an ADR in a PR the owner merges, then the build.
- **Start from a fresh `main`.** Pull it (`git pull --ff-only`) before a new branch, worktree or
  task; a branch catches up with `pnpm ship refresh <p>`.
- **Docs and setup are part of done.** Every design (ADR, plan, change doc) lists the docs, skills,
  guides and playbooks it touches or makes obsolete; its build updates or removes them in the same
  PR, and a build in steps ends with a full docs pass. Every new setup is tested end to end and
  guided for a less technical person: one command, one step at a time, a check that names the fix.

Add a `CHANGELOG.md` entry under Unreleased. A stack change also bumps `stacks/<id>/stack.json`,
and one that needs action in projects gets `stacks/<id>/migrations/<version>.md` (ADR 0005).
Releases are batched, and published to the template (`docs/releases.md`). Each project carries its
own pipeline, its stack's `ship.yml`: a change to it reaches a project by `ship upgrade`, as a PR.

## Never

- Build before the plan PR is merged, or edit an approved plan or change doc in place.
- Push to a project's `main` or `production` yourself: every change is a PR the owner merges
  (ADR 0012). Only `ship release` commits a staging app's version bump to `main`.
- Merge a PR that deploys production; that's the owner's approval. Force-push or delete anything.
- Read, print or ask for token values, or write secrets to any file.
- Create repos, set secrets or publish without the owner's go-ahead: in this conversation, or for
  a task, a merged plan (`playbooks/task.md`).
