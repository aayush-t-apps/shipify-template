# Configuration: every file and setting

Every setting Shipify reads, by name, and where it lives. Secret values appear by name only:
[security.md](security.md) says what each key may do, [setup.md](setup.md) how to make and replace
it.

| Where | What | Read by |
|---|---|---|
| [`executors.json`](#executorsjson) | the agents and how each starts, the commands every agent must never run, the gateways | `ship build`, runs, `ship add` (a gateway) |
| [`tools.json`](#toolsjson) | the tools runs use (Notion, Drop) and the channels you talk through (Telegram) | runs, `ship tools`, `ship add`, `ship doctor` |
| [`intents.json`](#intentsjson) | what you can ask: the six intents, the chat commands, the fixed words | decide, the edge, the forms |
| `checks/<name>.mjs` | a repeat's check scripts ([tasks.md](tasks.md)) | the think step, as the agent's user |
| [a project's `shipify.json`](#a-projects-shipifyjson) | one project's facts | `ship`, the pipeline |
| [`stack.json`](#stackjson), `layer.json`, `preset.json` | what a stack, layer or preset gives a project | `ship new`, `build`, `upgrade`, `doctor` |
| [your settings](#your-settings): [settings.md](settings.md) | every variable and secret your copy has, the edge's secrets, and this PC's copies: one list | the workflows, the edge, `ship setup`, `ship doctor` |
| [an app's repo](#an-apps-repo) | an app's own variable and keys | the pipeline, the app |
| [`credentials.env`](#the-credentials-file) | the PC's own copies of keys | `ship publish`, `ship add`, `ship door`, `ship doctor` |
| [environment variables](#environment-variables) | per-run values | `ship`, the stacks' `make` targets |

## Your settings

No tracked file holds anything of yours (ADR 0047). Your copy is its repo: its owner (a user
account or an org) owns every project's repo, and each project carries its own pipeline, calling
nothing of your copy's (ADR 0048). A run knows your copy from GitHub, and this PC from the
checkout's GitHub remote.

Your own values are variables on that repo. Every run gets all of them (`SHIPIFY_VARS`), the edge
gets the time zone at deploy, and this PC keeps a copy of each in its credentials file. `ship setup`
asks for each and sets both.

Every setting, where it lives, what sets it and what reads it is in [settings.md](settings.md),
made from one list (`cli/lib/settings.ts`): the core's, the edge's, and each plug-in's from its own
file. `ship setup` checks each step's, `ship doctor` names what your copy holds that's on no list,
and a workflow that reads one not on it fails `pnpm verify`.

Shipify's own defaults are in `cli/lib/config.ts`: projects are checked out in `../projects`
(`SHIPIFY_PROJECTS_DIR` overrides it), new projects keep 80% unit-test coverage, and `ship build`
runs the `manual` agent without `--executor`. A key is never a variable: it's a secret.

## `executors.json`

The agents, by id: `claude` (Claude Code, the default), `pi` and `opencode`, each through each of its
gateways (`pi-vercel`, `opencode-vercel`: [agents.md](agents.md#agents-and-gateways)). Besides them,
two blocks every agent shares (`version`, `commands` and `gateways` are never an agent's id):
- `commands`: what every agent must never run, said once (ADR 0043): `deny` (plain prefixes: `git
  push` and `git stash`; any other command runs) and `web`. Each agent's adapter writes them as its
  own rules. An `allow` list isn't read: `ship doctor` names one left in the file;
- `gateways`: where models are served, each with its `url`, `protocol` (`openai-chat`,
  `openai-responses` or `anthropic-messages`), `key` (the secret, also the variable the agent
  reads), `how` to make a key, `check` (a path that answers 200 for a good key) and, optionally,
  `search` (a path to its own list of models with `{word}` in it, read with no key by `/models
  <word>` and the web chat's picker, which also reads each listed model by its id, kept a day),
  or `list.path` (its whole list, searched here), with `list`'s paths to each fact of a model
  (`list.model`: one model's own answer, with `{id}` in it; `list.only`: what a model must hold
  to be shown, a word or one of several; `list.off`: where `false` says thinking can be turned
  off); and
  what an agent through it has: `models`, `auto`, `modelPattern`, `about`, and its `name` and
  `word`; what each model takes is its catalog's, read as needed ([agents.md](agents.md#read-as-needed)).
  Today: `openrouter` and `vercel-ai-gateway`.

A broken entry or block is left out, and `ship doctor` says why. An agent's fields:
- `adapter`: its code in `cli/lib/agents/<name>.ts` (flags for a model, an effort, the commands and
  tools; how to read what it did). Adding an agent: an adapter and an entry ([agents.md](agents.md));
- `default`, `auto` (the model and effort when a task picks none: Sonnet, medium for Claude Code);
- its login: `login` (`secret` and `how`), or `gateways` (the gateways its models come through, by
  their ids there: the first is its own id's, each other one `<id>-<word>`; its login is the
  gateway's key);
- `models`, `modelPattern`, `efforts`, `modelEfforts` (the efforts a model takes where they differ, none: `[]`): what a `use …` line may pick; `about`: a line
  for each listed model, shown in the web chat's picker ("Most work: changes, questions");
- `command` (how `ship build` starts it in a terminal) and `task` (how a run starts it);
- `install`: how a box installs it, pinned: `version`, `run` (its command's words, with
  `{prefix}`), `bin` (its program) and `dir` (its folder in the box's shared tools; the id when not
  said).

The repo variable `SHIPIFY_AGENT` picks the default agent, for runs and the chats' menus alike.

## `tools.json`

The tools runs use and the channels you talk through, by name ([tools.md](tools.md),
[channels.md](channels.md)). Each entry is checked on its own; `ship doctor` and `ship tools list`
say what's wrong.

| Field | Means |
|---|---|
| `description` | what it reaches |
| `run` | the command that starts its MCP server (a path in this repo). Or `url` and `headers`, for a remote one |
| `keys` | each variable its server reads, and the secret it comes from per verb: `look` (read-only: the think step) and `act` (write: the apply step, only for approved calls) |
| `oneKey` | `true` when the provider has no read-only key: both verbs name one secret |
| `look` · `act` | its calls, sorted: reads the agent makes, and changes the box makes after your `yes`. A call in neither is never offered |
| `args` | per act call, its argument schema (`required`, `properties`): a proposal that doesn't fit is dropped and said |
| `pre` | pre-approved forms: `{ call, fixed, caps, max }`. A call whose `fixed` fields match, whose other text fields fit their `caps`, at most `max` a run, needs no `yes`, unless the run read outside content. Merging the file approves them |
| `in` | a chat channel: `{"door": "<route>"}`, the edge's `/door/<route>` |
| `check` | a command that checks its keys once, for `ship doctor`, `ship add` and `ship selftest <name>` |
| `setup` | how `ship add <name>` sets it up: `needs` (what you need first), `keys` (each one you paste: `ask`, and `to`: `shipify`, or `edge` for a channel's keys the edge holds), `steps` (each `say` and `run`), `remove` |

**A tool's keys in runs:** its look secret goes in `task.yml`'s think step env; its act secret in the
apply step env, gated on `steps.decide.outputs.act == '<tool>'` (as Notion's are).

## `intents.json`

What you can ask, written once. Each of the six intents (question, change, new, remember, repeat,
operate) has `says` (one line), `words` (the titles that mean it), `chat` (its chat command), an
optional `form` (Repeat, Operate) and `starts`. `help` is the bot's `/help`; `replies` lists the
fixed words (`yes`, `no`, `continue`, `start over`, …; where each works is in
`cli/kernel/words.ts`). The edge bundles this file, and `tests/intents.test.ts` holds the forms and
[tasks.md](tasks.md) to it.

## A project's `shipify.json`

At the root of every project; names only, never a secret value (`cli/lib/schemas.ts`): `id`,
`name`, `description`, `kind` (`app` or `package`), `version` (the source of truth for tags and
`/health`), `stack` and `preset`, `staging`, `service` (the deployed name, when it differs),
`repository`, `urls`, `health` (the path that reports the deployed `commit`), `secrets` (names:
`deploy` for the `make` targets, `runtime` for the running app; an app with runtime keys gets no
preview), `vars`, `releases` (`false`: merges deploy, no versions: the playground),
`platformVersion`, `createdAt`.

## `stack.json`

In `stacks/<id>/`, beside `files/`, an optional `review.md` (its rows in plan PRs) and
`migrations/` (ADR 0005). Every field is in `cli/lib/schemas.ts` (`StackDef`); the ones you meet
most:
- `id`, `version` (bumped with every change), `kind`, `layers` (`_base`, `_ts`, `_cloudflare`);
- `owned`: the files the stack owns in projects. `ship upgrade` replaces them, and a task may change
  a workflow file only to exactly what the stack renders;
- `requires` and `doctor`: what it needs, checked by `ship doctor` (and fixed on a box by `box add`);
- `presetRequired`: its files need a preset's (ts-worker's main screen), so a plan or `ship new`
  with none is refused, naming the presets it takes;
- `deploy.*`: an app's secrets, variables and URL templates (`CLOUDFLARE_API_TOKEN` ←
  `CF_DEPLOY_TOKEN`; `https://{{SERVICE_NAME}}.{{APPS_DOMAIN}}`, the first whose variables are set);

A **layer** is `files/` plus a `layer.json` (its `owned` globs); a **preset** is `files/` plus a
`preset.json`. Files render `{{NAME}}` from your settings, the stack's, then the project's own.

## An app's repo

Each app's repo has its own, set by `ship publish` and the commands below (names only:
`gh variable list` and `gh secret list -R <owner>/<repo>`).

| Name | Kind | Set by | Read by |
|---|---|---|---|
| its stack's deploy values (`deploy.vars` in `stack.json`) | variables | `ship publish`, from your settings | its `make` targets |
| its stack's deploy keys (`deploy.secrets`: `CLOUDFLARE_API_TOKEN` on the default stacks) | secrets | `ship publish`, from this PC's keys | the pipeline's deploy targets: never a job where the PR's own code runs |
| its runtime secrets | secrets | `ship publish` (named in its `shipify.json`) | the running app |
| `SHIPIFY_DOWN` | a variable | `ship down` / `ship up` | the pipeline: every check, no deploy or preview |

The pipeline hands a project's `make` targets the secrets its `shipify.json` names, as JSON in
`$SHIPIFY_SECRETS_FILE`, after the checks pass.

## The credentials file

`~/.config/shipify/credentials.env` on the PC (`SHIPIFY_CREDENTIALS` points elsewhere): `NAME=value`
lines, `chmod 600`, never printed. It holds the settings [settings.md](settings.md) says live on
"this PC": your values and the keys `ship setup` and `ship add` take, with a channel's own (its
bot's name, your id on it).

`ship publish` copies from it into a new repo, and `ship door setup` and `ship add telegram` use
its deploy token to reach the edge. The door App's key is never kept here.

## Environment variables

**For `ship` itself:**

| Variable | Means |
|---|---|
| `SHIPIFY_PROJECTS_DIR` | where projects are checked out, instead of `../projects` |
| `SHIPIFY_CREDENTIALS` | the credentials file elsewhere |
| `SHIPIFY_REGISTRY_FILE`, `SHIPIFY_EXECUTORS_FILE`, `SHIPIFY_TOOLS_FILE` | other copies of those files (the tests use them) |
| `SHIPIFY_PROVIDER=mock` | tests only: a fake GitHub |

**In a run's job:** `SHIPIFY_VARS`, all of your copy's variables as JSON (`task.yml` and
`watch.yml` hand them over, so a run reads your settings by name, ADR 0047; the agent's own step
never has them); the variables above (`SHIPIFY_OWNER`, `SHIPIFY_PEOPLE`, `SHIPIFY_SEND`, …), the
tokens by step (`SHIPIFY_ISSUES_TOKEN`, `SHIPIFY_READ_TOKEN`, `SHIPIFY_AGENT_READ_TOKEN`,
`SHIPIFY_WRITE_TOKEN`, `SHIPIFY_FILES_TOKEN`: [security.md](security.md#who-holds-which-key)), the
think step's `SHIPIFY_AGENT_LOGIN` (the run's agent's login: the one secret plan names), and from
each slot's `.env` the box's own (`SHIPIFY_BOX`, `SHIPIFY_BOX_DIR`, `RUNNER_TOOL_CACHE`).

**What the agent gets:** its run's folders (`HOME`, `TMPDIR`), `PATH`, `SHIPIFY_TASK`, and its
adapter's own variables (Claude Code: `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER=1`,
`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3`; pi: `PI_CODING_AGENT_DIR`, `PI_OFFLINE=1`,
`PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `SHIPIFY_LOGIN_FD=3`; OpenCode: `OPENCODE_CONFIG`,
its `XDG_*` folders, the `OPENCODE_DISABLE_*` switches, `SHIPIFY_LOGIN_FD=3`); on stdin, a read-only
`GH_TOKEN` and the tools' look keys; on fd 3, a pipe it reads once, its login (its own, or its
gateway's key), never in its environment ([agents.md](agents.md)).

**For a project's `make` targets:** the pipeline's `SHIPIFY_ENV`, `SHIPIFY_SHA`, `SHIPIFY_VERSION`,
`SHIPIFY_PR`, `SHIPIFY_BASE_URL`, `SHIPIFY_TO`, `SHIPIFY_SECRETS_FILE`, and for a preview
`SHIPIFY_BUNDLE` and `SHIPIFY_BUILT` ([design.md](design.md)). On the default stacks also
`SHIPIFY_NO_BROWSER=1` (no browser; set on GitHub's machines: to check as a merge does,
`SHIPIFY_NO_BROWSER=1 make setup && SHIPIFY_NO_BROWSER=1 make verify`), `E2E_PORT` (this
checkout's test port) and `E2E_BASE_URL` (tests against a deployed URL).

**For `box/setup.sh`:** `SHIPIFY_MANAGE=1` (`box add --manage`) adds Tailscale, Cockpit and the
firewall, and on the machine itself (`SHIPIFY_HERE=1`) keeps it awake as any box.

## Make it yours

Your own Shipify starts from the template: **Use this template**, then `pnpm ship setup`
([getting-started.md](getting-started.md)). Each new version arrives as a PR
([releases.md](releases.md)).
- **Yours, never in a release or an update:** your settings (`ship setup`, or `gh variable set
  <name>` on your copy), your keys in `credentials.env`, your folders (`plans/`, `recipes/` but its
  examples, `checks/` but `example.mjs`), and the apps your forms list (`ship forms`). `box add`
  sets `SHIPIFY_OWNER`; `ship bot` and `ship door setup` make your own Apps.
- **Shipify's, the same in every copy:** the repo name `shipify`, the project id `playground`, the
  workflows (`task.yml`, `watch.yml`, `ci.yml`, `update.yml`, and each project's `ship.yml`), the
  edge Worker `shipify`, the labels (`shipify-box`, `box-<name>`,
  `sandbox`, `shipify-status`, `notebook`, `repeats`, `recipe`, `stuck`, `working`, `needs you`,
  `failed`, `answered`, `deploying`, `watch:*`, and `preview` on a project's PR), and on a box the users `shipify` and
  `shipify-agent-<k>`, the services `shipify-box-<name>[-<k>]`, `/opt/shipify` and
  `/srv/shipify-agent-<k>`.
