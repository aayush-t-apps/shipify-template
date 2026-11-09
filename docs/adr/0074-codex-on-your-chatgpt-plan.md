---
status: accepted (merged #693, task #692, 2026-11-06, the owner's answer "Keep it personal for now") and built in one PR after the owner's `go` of 2026-11-06; see [As built](#as-built-2026-11-06-one-pr-on-task-692)
date: 2026-11-06
amends: 0038 (an agent may read its login from a file, and the box keeps the login it renews), 0044 and 0071 (a read run and a guest's run never use such an agent)
---

# 0074: Codex on your ChatGPT plan, as a plug-in agent

## The plan in short

**Your asks (task #692):**
- Research how Codex fits our core and setup, and add Codex on your ChatGPT plan, if possible.
- Keep it simple and clean: current models, the model dropdown extended with no special code,
  light, robust, and only what is needed.
- Your answers on the plan (2026-11-06): first "Go plus and such or business also if possible",
  then "Keep it personal for now then". So the build makes the personal plan's sign-in only.

**The answer:**
- **It is possible, with one catch.** Codex is a plug-in agent, as OpenCode is: an entry in
  `executors.json`, an adapter and a recorded run. The core doesn't change. The web chat's
  **Who thinks** dropdown, `/models`, `use codex`, the Repeat form and Setup read
  `executors.json`, so they need no new code.
- **The catch is the sign-in.** Claude Code's login is a token that lasts a year, and no command
  can read it. On a personal plan, Codex's login is a session file (`auth.json`). Codex refreshes
  it, and each refresh replaces the refresh token. OpenAI's rule for automation: one file for each
  runner, keep the refreshed file, and never start again from the first copy.
- **So the design:** you sign in with ChatGPT in your browser, once, on your PC. The session is a
  secret (`CODEX_AUTH`), as Claude Code's login is. Codex refreshes it in a run, and after the run
  the box writes the refreshed session back to the secret.
- **Business or Enterprise, later:** those plans have a Codex access token instead (1 to 90 days,
  no refresh). The secret holds Codex's own `auth.json`, and a token's `auth.json` is one more
  shape of the same file, so adding it later is only a second path in setup
  ([section 2](#2-the-options-for-the-sign-in)).
- **Go:** OpenAI's plans page lists Codex's CLI and `codex exec` for Plus, Pro, Business and
  Enterprise. For Go (and Free) it lists only GPT-6 Luna in the desktop app. So Shipify can't
  promise Go. Setup says so if your session is on Go, and a run that OpenAI refuses fails with
  OpenAI's words ([section 1](#1-what-was-checked)).
- **Codex reads its login from a file its commands can also read.** So Codex never thinks for a
  guest's run or a read run. Those runs use the default agent.
- **The build is one PR,** after you merge this and say `go`. Merging accepts
  [section 5](#5-where-codex-doesnt-think).

## 1. What was checked

Research of 2026-11-06 against Codex 0.167.0: the npm registry, the program's own `--help`,
its source at `rust-v0.167.0`, and its docs (`developers.openai.com/codex` now goes to
`learn.chatgpt.com/docs`). Links are in [Sources](#sources).

| Assumption | How it was checked |
|---|---|
| The newest Codex is 0.167.0 (2026-11-06) | npm registry |
| npm installs a small launcher and one package for the box's architecture. Neither has install scripts, so `--ignore-scripts` is safe. The launcher starts the program in its own process (`execve`) | the packages' `package.json` and `bin/codex.js` |
| It is large: 411 MB unpacked on arm64 (Claude Code 233 MB, pi 166 MB). It is installed only the first time a run picks it | the package, unpacked |
| A ChatGPT sign-in is `codex login` (a browser), `codex login --device-auth` (beta; a personal account turns device codes on first), or a copied `auth.json` | auth docs |
| Codex's CLI and `codex exec` are listed for Plus, Pro, Business and Enterprise/Edu (and an API key). Go's and Free's cards list only "GPT-6 Luna at Standard speed in the desktop app, subject to rollout". Codex's own code doesn't refuse a Go sign-in: whether OpenAI's servers do is not known | the plans page, 2026-11-06; `protocol/src/auth.rs` |
| Plus and Pro have **no long-lived token**. Codex access tokens (1 to 90 days) are "currently supported for ChatGPT Business and Enterprise workspaces" | the plans page's table, the access-token docs |
| `codex login --with-access-token` reads a token on stdin, checks it with OpenAI and writes `auth.json` as `{"personal_access_token": "at-…"}`, a file Codex never changes. A token in `CODEX_ACCESS_TOKEN` also works, but Codex gives its whole environment to the commands it runs by default | `login/src/auth/manager.rs`, `access_token.rs`, `config/src/shell_environment_policy.rs` |
| A session's `id_token` names its plan (`chatgpt_plan_type`) and account (`chatgpt_account_id`) | `login/src/token_data.rs` |
| Codex refreshes when its access token has less than 5 minutes left, or on a 401. It writes the new tokens back to its store | `login/src/auth/manager.rs` |
| Each refresh gives a new refresh token. The old one is accepted for "on the order of an hour", then refused (`refresh_token_reused`). This is a maintainer's comment, not a promise | openai/codex issue #10332 |
| How long the tokens last is not documented: it is in each token | not found; the build reads it from your session |
| OpenAI's guidance: an API key first for automation. A ChatGPT sign-in is for "trusted private automation": one `auth.json` for each runner, never shared by parallel jobs or machines, the refreshed file kept, treated like a password | CI/CD auth docs |
| The CLI takes a ChatGPT session only from its store (`file`, `keyring`, `auto`, `ephemeral`), never from a pipe or a variable. So the login is a file in `CODEX_HOME` | config source and docs |
| `codex exec --json` writes one event a line: `thread.started`, `item.*` (messages, commands, file changes, MCP calls, web searches), `turn.completed` with tokens, `turn.failed`, `error`. It names no model, cost or plan limit | `exec/src/exec_events.rs`, docs |
| `codex exec` takes the prompt on stdin, `--output-schema`, `-m`, `-c model_reasoning_effort=…`, `-s`, `--skip-git-repo-check`, and `exec resume <id>` | `codex exec --help` |
| With approvals off, an MCP call is refused unless the server says `default_tools_approval_mode = "approve"` | `core/src/mcp_tool_call.rs` |
| A `forbidden` rule (`rules/*.rules`) blocks a command whatever the approval setting. A compound command is split only when it is plain words joined by `&&`, `\|\|`, `;` or `\|` | `core/src/exec_policy.rs` and its test |
| Codex's own sandbox (bubblewrap) fails on a Pi set up as a box (AppArmor limits user namespaces). Shipify's walls don't need it | tried on this Pi |
| A repo's `.codex/` folder loads only for a project marked trusted. A repo's `AGENTS.md` loads, as for every agent | `config/src/loader/mod.rs` |
| Skills load from `$HOME/.agents/skills`, a repo's `.agents/skills` and `/etc/codex/skills` | skills docs |
| Today's models: `gpt-6.1-sol` (Codex's default), `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` and three `gpt-5.6-*`. Efforts: low, medium, high, xhigh, max, ultra (no ultra on Luna) | the catalog in 0.167.0 (`models-manager/models.json`) |
| OpenAI's terms: "You may not share your account credentials or make your account available to anyone else" | Terms of Use, 2026-01-01 |

## 2. The options for the sign-in

| Option | How | For | Against |
|---|---|---|---|
| **A: the session as a secret, renewed by the box** | `CODEX_AUTH` holds `auth.json`. A run refreshes it when needed, and the box writes it back after the run | your plan's limits, no cost per token; OpenAI's documented pattern; keys stay in GitHub's secrets | a session file its commands can read; two runs that refresh at once may end the session (rare; section 4) |
| B: a session kept by each box | each box signs in once and keeps its own file | no write-back | a box then knows a login, and you sign in on each box; against "a box knows nothing" |
| C: a Codex access token | Business or Enterprise only: Codex's `auth.json` for the token as the secret, renewed by hand every 1 to 90 days | no refresh, no write-back | not on Plus or Pro; still a file its commands can read |
| D: an OpenAI API key | `CODEX_API_KEY`, through Codex's own proxy so no command sees it | OpenAI's default for automation; robust | billed per token, not your plan |
| E: not now | | | no Codex |

**Decided with you (2026-11-06): A, for your personal plan.** You asked to keep it personal for
now. C is left for later: setup would make the token's `auth.json` with `codex login
--with-access-token` and store it in the same secret, and the launcher, the entry and the
write-back stay as they are (a token's file never changes, so it is never written back). D isn't
built: you asked for your plan, not a key billed per token.

## 3. Codex as an agent

```json
"codex": {
  "name": "Codex",
  "adapter": "codex",
  "login": { "secret": "CODEX_AUTH", "how": "pnpm ship setup agent codex (signs in with ChatGPT)", "file": true, "renews": true },
  "auto": { "model": "gpt-6.1-sol", "effort": "medium" },
  "models": ["gpt-6.1-sol", "…"],
  "about": { "gpt-6.1-sol": "…" },
  "modelPattern": "^gpt-[0-9][a-z0-9.-]*$",
  "efforts": ["low", "medium", "high", "xhigh", "max", "ultra"],
  "modelEfforts": { "gpt-6-luna": ["low", "medium", "high", "xhigh", "max"] },
  "task": ["codex", "exec"],
  "install": { "version": "0.167.0", "bin": "bin/codex", "run": ["npm", "install", "-g", "…", "--ignore-scripts", "--before=…", "--prefix", "{prefix}", "@openai/codex@0.167.0"] }
}
```

The build lists a few current models first, each with a line from Codex's own catalog. Any
other id the pattern takes runs too.

- **How it starts:** `codex exec --json -s danger-full-access --skip-git-repo-check -m <model> -c
  model_reasoning_effort=<effort> --output-schema <schema> -`, the prompt on stdin. A catch-up and
  the fix round use `codex exec resume <thread>`. Codex's own sandbox is off, as the walls are
  outside the agent (ADR 0043), and it fails on a Pi anyway.
- **Its home:** `CODEX_HOME` is a folder in the run's `config/`, which stays for the whole run
  (its sessions and its refreshed login). Before every ask the adapter writes its `config.toml`
  and rules there again, and removes what a command could have written there (hooks, an
  `AGENTS.md`, other rules) through `cleared`.
- **Its config:** no update checks, analytics, feedback or history. The web on or off as
  `commands.web` says. The look tools as `[mcp_servers]`, only their look calls enabled, approved
  (`approve`), their keys named, never their values. Its bundled skills off.
- **Its rules:** `executors.json`'s refused commands as `forbidden` rules, in each form Codex
  matches. The build records Codex's own answers with `codex execpolicy check` in
  `tests/fixtures/codex-decisions.json`, as Claude Code's are. Its rules are a layer, as Claude
  Code's are: they don't look inside `$(…)`. The read-only token and the box's own push stay the
  wall.
- **Shipify's skills:** linked at `$HOME/.agents/skills` (the adapter's `skillsLink`).
- **Its login:** a small launcher, `codex-login.mjs`, beside pi's gate. It reads the login once
  from fd 3 and closes the pipe. When the run has no `auth.json` yet, it writes the login there as
  is (mode 600), in `CODEX_HOME`, then starts Codex. The secret is Codex's own `auth.json`, so the
  launcher doesn't read or change what is in it.
- **Its report,** from the events: the session (`thread_id`), tokens and thinking, each tool
  (`bash`, file changes, `tool.call` for the look calls, web search), refused commands, what it
  read from outside (a web search, or a command that fetches), and its final message in the
  result's shape. The model is the one the run chose: the stream doesn't name it. No cost: your
  plan covers it. Plan limits aren't in the stream: they are left for later.

## 4. The login's life

1. **Setup, once:** `pnpm ship setup agent codex`. It runs `codex login` through `npx` at the
   pinned version, in a temporary folder, so you don't install Codex on your PC. Your browser
   opens ChatGPT's own sign-in. This makes a new session for Shipify alone, so Codex on your PC
   keeps its own session, and neither one ends the other. Setup checks that the file is a ChatGPT
   session and shows its plan and how long its access token lasts. On Go or Free it also says that
   OpenAI lists Codex's CLI only from Plus, and asks if you want to go on. Then it sets the
   folder's `auth.json` as the secret `CODEX_AUTH`, deletes the folder and shows ✓. It never
   prints the file.
2. **A run** gets the session on fd 3, as every agent gets its login. Codex refreshes it when its
   access token nears its end, and writes it in the run's folder.
3. **After the run,** with the bot's key (it has Secrets: write already): when the run's
   `auth.json` holds a session, changed, has a newer `last_refresh` and names the same account,
   the box sets `CODEX_AUTH` to it. A file that doesn't parse, or names another account, isn't
   kept, and the run's details say so. Generic, so the core names no agent: the adapter says where
   its renewed login is, and the entry says the login renews.
4. **Two runs at once** each start from the secret. A refresh is rare, and OpenAI accepts the old
   refresh token for about an hour, so a second refresh in that hour should still work. The last
   write wins. **Not yet proven:** that the session given to the first run still works after the
   second refresh. The build checks it live first. If it fails, the build lets one Codex run
   refresh at a time.
5. **When OpenAI refuses the session** (signed out, reused, a new password), the run fails with
   Codex's words and the fix: `pnpm ship setup agent codex --new`, and sign in again.

## 5. Where Codex doesn't think

Codex reads its login from a file, and its commands can read that file too. That is not true
for the other agents: their login is on a pipe that no command can reach ([security.md](../security.md)).
A page that tricks the agent could send the session out. So:

- **Never for a guest's run** (ADR 0071). A guest's commands could read your session, and
  OpenAI's terms forbid making your account available to anyone else. A guest's picker doesn't
  show Codex, and a guest's `use codex` is refused, with words.
- **Never for a read run** (ADR 0044). A read run runs no command, and Codex has no switch that
  turns off its commands (its read-only sandbox still runs them).
- **These runs use the entry marked `default`** (Claude Code), and the run's details say why. If
  that entry also keeps its login in a file, the run is refused, with words.
- **Your own runs** hold it as they hold your read-only GitHub token today. If it leaks, someone
  can use Codex on your plan until you sign out all sessions in ChatGPT's security settings.

## 6. Models and the dropdown

- **No UI code.** The entry's models, an `about` line each, its Auto and its efforts give a
  **Codex** tab in **Who thinks**, lines in `/models`, `use codex`, `use codex gpt-6.1-terra high`,
  `use gpt-6.1-sol` (a listed model names its agent, ADR 0042), and a choice in the Repeat form.
  Setup's **Agents and models** shows its login, as Claude Code's.
- **A new OpenAI model:** nothing, as the pattern takes it. To list it first: one line.
- **A model retired for ChatGPT sign-in:** a run that picks it fails with OpenAI's words; its line
  is removed.
- Claude Code's list (Haiku, Sonnet, Opus, Fable) and the gateways' lists stay as they are.

## 7. Edge cases

- **No `CODEX_AUTH`:** the run is refused before it starts, with the setup command, as for any
  missing login.
- **The write-back fails** (GitHub down): the next run starts from the old session. Within the
  hour that still works; after it, you sign in again. The run's details say the write failed.
- **Your plan's limit is used up:** the run fails with Codex's words.
- **Go or Free:** setup lets you go on after its warning. If OpenAI refuses Codex's CLI on that
  plan, or offers only Luna, the run fails with OpenAI's words. Nothing in Shipify checks the plan
  after setup.
- **A stay** (ADR 0057): each turn writes back a changed session, as a run does.
- **A small box:** the install takes 411 MB, the first time a run picks Codex.

## 8. Your answer, and what the merge accepts

- **The plan (answered 2026-11-06):** "Keep it personal for now then". So the build makes A only
  (section 2), for Plus or Pro. C (Business or Enterprise) is left for later. Go: OpenAI doesn't
  list Codex's CLI for it (section 1), so Shipify allows it after a warning and promises nothing.
- **What the merge accepts:** section 5. Codex reads its login from a file its commands can read,
  in your own runs only, and never in a guest's run or a read run.

## 9. Build plan (one PR, after your `go`)

1. Setup's step `agent codex`, through Codex's own login. Tests with a stand-in `codex` (the Go
   warning, nothing printed). Then, from your session, how long its access token lasts.
2. The entry, the adapter, the launcher and the reader, test-first. A recorded run against a
   stand-in model (Codex's own custom provider, pointed at a local stub). Codex's recorded rule
   decisions. The agent conformance test (`DECIDES`, `PIPED`, `SKILLS_HANDED`; `READS` says it
   takes no read run).
3. The entry's `login.file`: read and guest runs go to the `default` entry; the guests' picker
   leaves Codex out.
4. The write-back after a run (the entry's `login.renews`): a session that is newer and for the
   same account is kept; a broken file or another account's is not.
5. Live on a box, on your plan: a run, a catch-up, a refresh and its write-back, two runs at once,
   then `pnpm ship selftest codex`.

## Setup

1. On your PC: `pnpm ship setup agent codex`. Your browser opens ChatGPT's sign-in. Sign in. The
   step sets `CODEX_AUTH` and says ✓. To sign in again: `pnpm ship setup agent codex --new`.
2. On a task: `use codex`, or pick **Codex** in **Who thinks**. To make it the default: the repo
   variable `SHIPIFY_AGENT=codex`.
3. Check: `pnpm ship selftest codex`.

## Docs and clean-up

- `docs/agents.md`: Codex in the agents table, its adapter's section, the `executors.json` sketch,
  `login.file` and `login.renews`.
- `docs/setup.md`: Codex's login. `docs/security.md`: its row in the keys table (until OpenAI
  ends the session), and section 5.
- `docs/channels.md` (guests) and `docs/tasks.md` (read runs): no Codex there.
- `plugins/_template/agent/README.md`: `login.file` and the renewed login.
- `docs/glossary.md`: "the Codex entry" leaves the Gone list.
- `docs/settings.md`, made from the settings list: `CODEX_AUTH`.
- `CHANGELOG.md`.

## Consequences

- **Easier:** OpenAI's models on your plan, beside Claude Code's, from the same dropdown and `use`
  words.
- **Harder:** one more agent to keep current (a version PR, as for the others). A login a run can
  read and the box renews: a new kind of secret write, and a rule that keeps Codex from guests and
  read runs.

## Confirmation

- `tests/plugins/agent.test.ts` holds the adapter to every agent's decisions, with Codex's
  recorded run and rule answers.
- A test that a read run and a guest's run never start an agent whose login is a file.
- A test that the write-back keeps only a valid, newer session for the same account.
- Setup's tests, with a stand-in `codex`.
- `pnpm ship selftest codex` on a box.

## As built (2026-11-06, one PR on task #692)

Built as sections 3 to 7 say, with these changes, each found while checking Codex 0.167.0 live
against a local stand-in of OpenAI's Responses API:

- **Shipify's gate, not Codex's rules.** Codex 0.167.0 has Claude-Code-style hooks: a
  `PreToolUse` hook gets every call (a command as `Bash`, a tool's as `mcp__<tool>__<call>`) and
  can refuse it. So its gate (`codex-gate.mjs`, with pi's gate's checks) decides, as pi's and
  OpenCode's do, and refuses every form the conformance test holds every agent to. Codex's own
  rules aren't read at all (`--ignore-rules`), and `codex-decisions.json` isn't needed. Input
  typed into a command already running (`write_stdin`) comes through no hook: the wall stays the
  read-only key and the box's own push, as section 3 said of the rules.
- **No launcher.** The core writes the login file itself, as the agent (mode 600), in the run's
  `CODEX_HOME` before the first ask (the contract's `loginFile`); it goes neither on fd 3 nor in
  the environment. A stay's turn carries on with the session Codex refreshed there.
- **No config file.** Every setting is a `-c` on its command line, and Codex's own `config.toml`
  is ignored (`--ignore-user-config`): so no project is trusted, and a repo's `.codex/` doesn't
  load (checked live). Hooks run without Codex's own approval (`--dangerously-bypass-hook-trust`):
  the gate is the only one.
- **The model's name** isn't in Codex's output: its reader takes the run's (the contract's
  `reader(run)`). Its tokens are its session's totals, as Claude Code's.
- **Refused calls** show in the job's log, not in the run details: Codex's output doesn't carry
  them.
- **Setup** is the adapter's `signIn` (`pnpm ship setup agent <agent>` names the agent), so the core
  names no agent. It warns on any plan OpenAI lists no CLI for (Go, Free).
- **The write-back** is a step of its own, `ship run renew`, after the agent and any stay: it
  reads the file as the agent, and its adapter's `renewed` keeps only a ChatGPT session for the
  same account (and the same sign-in, when both say it), refreshed later. **It needs a token
  with Secrets: write, minted in `task.yml` after the agent, which a run can't add** (a run never
  changes workflow files): the owner added that step on the PR's branch (2026-11-06), and
  `tests/workflows.test.ts` holds it to this repo's secrets alone, after the agent and its stay.
- **Sign-in from a chat** (the owner has no PC, 2026-11-06): `codex sign in`, a fixed word only
  the owner says (`sign in`, which names its agent: `<id> sign in`, `sign in to <id>`, or alone
  when one agent signs in; a guest's is refused at the door and words to the box). The box's run
  starts no agent: it sets a pending sign-in, and the github job (ADR 0030) runs the adapter's
  `signIn` with a `code`, on GitHub's machine, whose bot key sets secrets: so no box signs in, and
  `task.yml` needn't change. The adapter runs `codex login --device-auth` (Codex's own sign-in
  with a code, checked in its source at 0.167.0: the link and the code printed on stdout, the
  code good for 15 minutes) and reads them from its output; the job replies with them at once
  (applied then, the door told), waits (stopped at 17 minutes, inside the job's 20), sets
  `CODEX_AUTH`, and replies ✓ with the plan, on the task as read again then. On a plan OpenAI
  lists no CLI for, the reply warns, as there's no one to ask. On a PC, `--device` does the same.
  The core still names no agent: the word finds its agent in `executors.json`, by its adapter's
  `signIn`.
- **Not checked live yet** (they need the owner's sign-in): `codex sign in` on GitHub's machine
  (only with a stand-in `npx` in the tests), a run on the owner's plan, a refresh and its
  write-back, two runs at once, then `pnpm ship selftest codex`.
- **Not kept out:** a repo's own `.agents/skills`, which Codex lists beside Shipify's.

## Sources

- npm: https://registry.npmjs.org/@openai%2Fcodex
- Source at `rust-v0.167.0`: https://github.com/openai/codex/tree/rust-v0.167.0 (`login/src/auth/manager.rs`,
  `login/src/auth/storage.rs`, `login/src/auth/access_token.rs`,
  `login/src/auth/personal_access_token.rs`, `login/src/token_data.rs`,
  `login/src/device_code_auth.rs`, `cli/src/login.rs`,
  `config/src/shell_environment_policy.rs`, `protocol/src/auth.rs`, `exec/src/exec_events.rs`,
  `core/src/mcp_tool_call.rs`, `core/src/exec_policy.rs`, `config/src/loader/mod.rs`,
  `models-manager/models.json`)
- Sign-in: https://learn.chatgpt.com/docs/auth
- Automation with a ChatGPT sign-in: https://learn.chatgpt.com/docs/auth/ci-cd-auth
- Access tokens (Business, Enterprise): https://learn.chatgpt.com/docs/enterprise/access-tokens
- Plans (which plans list Codex's CLI, Go's card, the access-token row; read 2026-11-06):
  https://learn.chatgpt.com/docs/pricing
- Non-interactive runs: https://learn.chatgpt.com/docs/non-interactive-mode
- Config: https://learn.chatgpt.com/docs/config-file/config-reference
- Rules: https://learn.chatgpt.com/docs/agent-configuration/rules
- Sandbox: https://learn.chatgpt.com/docs/sandboxing
- Skills: https://learn.chatgpt.com/docs/build-skills
- Refresh-token reuse: https://github.com/openai/codex/issues/10332#issuecomment-3831635259
- Terms of Use: https://openai.com/policies/terms-of-use/
