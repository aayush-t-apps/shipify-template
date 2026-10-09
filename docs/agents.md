# Agents

The **agent** is the program that thinks for a task: **Claude Code** by default, or **pi**. It
**only thinks**: it reads, changes files and commits in its own clone, and writes one result file.
The box makes every change after it has stopped: the reply, the push and PR, notes, the repeat, and
tool calls you approved ([tasks.md](tasks.md)).

Shipify is the **harness** around it: the task, the sandbox, the tools, the models and the clocks.
What every agent must never run, and where models are served, are said once in `executors.json`;
each agent's adapter writes them its own way (ADR 0038, ADR 0043).

## Where it runs, and what it holds

- **Its own Linux user,** one per slot: `shipify-agent-<k>`, started through one sudoers rule set
  up by `ship box add`, from an empty environment, with its secrets on stdin.
- **A fresh folder each run:** `/srv/shipify-agent-<k>/run-<id>/` (its home, config, temp, work,
  the repos it reads, files in, files out). The slot's next run, and the weekly clean-up, remove
  the old ones.
- **It can't read** the runner's folders, the runner's processes, or another slot's runs.

| It holds | It never holds |
|---|---|
| its login: Claude Code's `CLAUDE_CODE_OAUTH_TOKEN`, or its gateway's key (pi: `OPENROUTER_API_KEY`) | a write token for any repo |
| a read-only GitHub token | the record's token (the one that writes comments) |
| each tool's look key | a tool's act key |
| | a channel's key, or the door's keys, or another agent's login |

Write tokens are made after it stops, for exactly the one repo the run changes. A run that reads a
repo outside your account holds its login alone (the read profile, below). A run on another of your
accounts (ADR 0045) holds its login and that account's read-only key alone: no tool's key, and no
notebook in its prompt. Details: [security.md](security.md).

**What it does on a run** (the prompt and `playbooks/task.md` say how):
- **A question:** reads the web and the tools' look calls, and clones a project's or repo's code
  itself, read-only, when the question needs it; answers. The repos a task names with `look at`
  are cloned for it first, into `read/`.
- **A change:** works in its clone of the project, runs `make verify`, commits, and asks for a PR
  in its result. Another of your repos (no `shipify.json`) it changes its own way, as the repo's
  docs say, and the repo's CI checks the PR (ADR 0044).
- **A read run** (the read profile, ADR 0044: a task that reads a repo outside your account): it
  reads files in `read/`, your files and Shipify's copy, and nothing else: no command, no web, no
  tool's calls, no key but its login. The core asks for it with `commands.run: false`.
- **Anything it wants changed** (a PR, tool calls, a note, a repeat, work on a project) goes in
  `result.json`. Decide keeps what the task allows; apply makes it.

## What the agent does itself

The agent decides how to work (ADR 0041): its helpers and parallel work, its plan, its to-dos, its
own context. Shipify builds none of those again. Claude Code starts helpers of its own when the work
splits (in task #182 it ran two in parallel and messaged them as the shapes changed); pi has none,
by design, and keeps its plan in files. Both are fine.

- **Every rule binds its helpers too,** because the rules sit outside the agent: its own Linux user
  and folders, read-only keys, and the box making every change after it stops. So it may run any
  command but a short refused list (ADR 0043); the agent's own rules (Claude Code's, pi's gate)
  keep it from the box's jobs, and aren't the wall ([security.md](security.md)).
- **What carries from one run to the next** is the record, since each run is a fresh folder on any
  box: the task's branch (its commits, kept when a run stops early, fails, or stops to ask you
  something), its handoff (`handoff.md` in its out folder, kept in the status comment however the
  run ends) and the conversation ([tasks.md](tasks.md)).
- **A checkout inside the clone,** a helper's worktree or a repo of its own, is never committed:
  the box's commit and `ship pr` leave it out, and the PR's checks refuse one recorded in the
  commits, on the box and on your PC alike.
- **Not turned on:** Claude Code's agent teams (they don't run headless), its workflows (a
  permission rule, and many times the tokens on the one plan every slot shares), and pi's helper
  extension (a pi it starts wouldn't carry the gate).

## The agents

| Agent | Its models | Its login |
|---|---|---|
| **Claude Code** (`claude`, the default) | Haiku, Sonnet, Opus, Fable | your Claude plan: `CLAUDE_CODE_OAUTH_TOKEN` |
| **pi** (`pi`) | any model OpenRouter has, by its id there (`z-ai/glm-5.3`); a few listed first | OpenRouter's key: `OPENROUTER_API_KEY` ([Gateways](#gateways)) |

- **A task picks one** with a `use` line: `use pi`, `use pi z-ai/glm-5.3`, `use pi z-ai/glm-5.3
  high`, `use claude` (back to Claude Code). Naming another agent alone starts it on its own Auto;
  `use claude auto` (or `use auto`) puts the agent you're on back on its Auto.
- **The default** is the agent the repo variable `SHIPIFY_AGENT` names, else the entry marked
  `default` (Claude Code).
- **In the web chat,** the model chip opens **Who thinks**: the
  agents as tabs; your listed models by name with their maker, price, context and what they can
  do (from the gateway, read when it opens, kept a day; a line each from `about` for Claude Code's);
  a search and filters (Free, Tools, Reasoning, Images) for any other; the effort the model takes
  ([channels.md](channels.md#the-web-chat)). Status & setup's **Agents and models** shows each
  agent, its login or gateway key, its Auto and its models.
- **`/models`** (any channel, at once) lists each agent's models, its Auto and efforts; `/models
  <word>` searches a gateway's own list ([Finding a model](#finding-a-model)).
- **Your Claude plan stays on Claude Code** (Anthropic's terms). pi runs on its gateway's key.

## The model and the effort

Each agent has its own models and efforts. Claude Code's:

| Model | For |
|---|---|
| Haiku | quick, simple answers; no effort setting |
| Sonnet (Auto) | most work: changes, questions, daily jobs |
| Opus | hard changes and design |
| Fable | the most capable, and the heaviest on your plan's limits |

pi's are any model OpenRouter has, by its id there, with the efforts off, low, medium, high and
max. Each model takes its own levels, and OpenRouter sends the nearest one it has: GLM 5.3 takes
max, high and low (and always thinks, so `off` is refused for it, said on the run); Nemotron high
and medium; the Kimis and Laguna none (they think, and the level changes nothing). `off` turns
thinking off where a model allows it.
`executors.json` lists a few first, free ones then cheap ones good for building: Nemotron (free,
Auto) and Laguna (free), then GLM 5.3 Flash, DeepSeek V4.1 Flash, GLM 5.3, Kimi K2.7 Code and Kimi
K2.6, paid from your OpenRouter credits (a free one's id ends `:free`). `/models <word>` and the
web chat's search find the rest, with today's prices. A run's cost shows on its reply's line
("· $0.03") and in its run details when the agent knows it; pi doesn't know a gateway model's
price, so its runs show none rather than a guess.

- **Auto** is the agent's `auto` in `executors.json`: Sonnet at medium effort for Claude Code,
  Nemotron (`nvidia/nemotron-3-ultra-550b-a55b:free`) at high for pi. A pi model picked with no
  effort thinks at high too, never at the model's own default (GLM's is max, its slowest).
- **A task picks another** with a `use` line: `use opus`, `use opus high`, `use claude-opus-5-5`,
  `use pi moonshotai/kimi-k2.7-code`, `use auto`. Alone, it applies from the next run ("From the next run: Opus"). As a
  line of its own in a longer message, that message's run already uses it. The task keeps it in its
  status comment.
- **A model names its agent** (ADR 0042): a listed model picks its own agent from any task, so on
  pi `use opus` goes back to Claude Code with Opus, and on Claude `use glm-5.3-flash` moves to pi.
  A gateway's listed model goes by its name after the maker when no other listed model shares it;
  any other gateway id needs its agent named (`use pi moonshotai/kimi-k2.7-code`). A pick that
  can't be taken is told, and nothing runs with a model you didn't choose
  ([tasks.md](tasks.md#fixed-words)).
- **The agent is told** what its run thinks with, and that only you change it: it never claims to
  pick or switch a model.
- **A repeat's job** picks it with the Repeat form's **Model** field.
- **Every word must be something the agent takes:** an agent's id, one of its `models`, a model id
  its `modelPattern` matches (a new Claude model works the day it's out), one of its `efforts`, or
  `auto`. A `use` that names nothing is refused, with the choices.
- **A choice the agent can't use** (effort on Haiku, say) runs on Auto, and the run details say why.

`executors.json`, in short: what every agent shares, then each agent.

```json
"commands": { "deny": ["git push", "git stash"], "web": true },
"gateways": {
  "openrouter": { "url": "https://openrouter.ai/api/v1", "protocol": "openai-chat", "key": "OPENROUTER_API_KEY", "how": "openrouter.ai/settings/keys → Create key", "check": "/key", "search": "/models?supported_parameters=tools&limit=20&q={word}" }
},
"claude": {
  "adapter": "claude",
  "default": true,
  "login": { "secret": "CLAUDE_CODE_OAUTH_TOKEN", "how": "claude setup-token" },
  "auto": { "model": "sonnet", "effort": "medium" },
  "models": ["haiku", "sonnet", "opus", "fable"],
  "modelPattern": "^claude-[a-z0-9.-]+(\\[1m\\])?$",
  "efforts": ["low", "medium", "high", "xhigh", "max"],
  "noEffort": ["haiku"],
  "task": ["claude", "-p", "--permission-mode", "acceptEdits"],
  "install": { "version": "2.1.284", "dir": "claude-code", "bin": "bin/claude", "run": ["npm", "install", "-g", "…", "--prefix", "{prefix}", "@anthropic-ai/claude-code@2.1.284"] }
},
"pi": {
  "adapter": "pi",
  "gateway": "openrouter",
  "auto": { "model": "nvidia/nemotron-3-ultra-550b-a55b:free", "effort": "high" },
  "models": ["nvidia/nemotron-3-ultra-550b-a55b:free", "poolside/laguna-s-2.1:free", "z-ai/glm-5.3-flash", "…"],
  "efforts": ["off", "low", "medium", "high", "max"],
  "task": ["pi"],
  "install": { "version": "1.0.2", "bin": "bin/pi", "run": ["npm", "install", "-g", "…", "--ignore-scripts", "--before=2026-10-05", "--prefix", "{prefix}", "@earendil-works/pi-coding-agent@1.0.2"] }
}
```

- **`commands`:** what every agent must never run, said once as plain prefixes (ADR 0043): `git
  push` and `git stash`, because the box pushes. Any other command runs, pipes, loops and reads
  outside its folders included: the walls are outside the agent (its own Linux user, read-only
  keys, every process killed at the end), so a list of what it may run only cost turns. `deny`
  covers every part of a command (`make && git push`, `$(git stash)`, a loop's body) and the
  command after git's own options (`git -C x push`). `web`: it may read the web with its own tools.
  Each adapter writes them as its agent's own rules ([Claude Code's](#claude-codes-adapter),
  [pi's](#pis-adapter)). It writes only in its working folder and `out/` (the adapter's `folders`).
  `tests/plugins/agent.test.ts` holds every adapter to the same decisions (the refused commands in
  any form, and a pipe, a loop or a read outside refused by none), and `tests/agent-tools.test.ts`
  checks that the agent's instructions name a refused command only where they say never: a new
  playbook step never needs a list changed. An `allow` list left in the file is named as a problem
  and never read.
- **`gateways`:** where models are served ([Gateways](#gateways)).
- **`task`:** the command for a run; the prompt goes on stdin. Its adapter adds the rest: the
  model, the effort, the commands, the look tools and its output.
- **`default`:** the agent tasks use, unless the repo variable `SHIPIFY_AGENT` names another.
- **`login`:** its secret, and how to make it (yearly: `claude setup-token`, then set
  `CLAUDE_CODE_OAUTH_TOKEN` on shipify). An agent with a `gateway` has no login of its own: its
  login is the gateway's key (`loginOf` in `cli/lib/agents.ts`).
- **`gateway`:** the gateway its models come through; its `models` are then ids there, the few
  listed first, and any other id its `modelPattern` matches runs too. `tests/plugins/agent.test.ts`
  holds each listed id (and Auto's) to the pattern, so a mistyped one fails `pnpm verify`, not a run.
- **`install`:** how a box installs it: its command's words, with `{prefix}` where it goes, its
  program (`bin`), its `version`, and its folder (`dir`, the agent's id when not said). A version
  moves only in a PR that says so ([On a box](#on-a-box)).

## Gateways

A **gateway** is where models are served: one key, many models. `executors.json`'s `gateways` lists
each once: its `url`, its `protocol` (`openai-chat`, `openai-responses` or `anthropic-messages`),
its `key` (the secret, and the variable the agent reads it from), `how` to make a key, a `check`
path that answers 200 for a good key, and, optionally, `search`: a path to its own list of models
with `{word}` in it, read with no key. An agent's entry names the one it uses. Today: `openrouter`.

- **Set one up:** `pnpm ship add openrouter` shows the plan; with `--yes` you paste the key at a
  hidden prompt. It's kept in your credentials file and set as the shipify secret
  `OPENROUTER_API_KEY`, never printed, then checked with the gateway, and the variable
  `SHIPIFY_GATEWAYS` records it (`{"openrouter": "YYYY-MM-DD"}`, which the web chat's Setup shows).
  `--new` pastes it again; `pnpm ship remove openrouter --yes` deletes the secret, its line in your
  credentials file and the record.
- **Its key reaches the agent,** because the agent calls the model, as Claude Code's login does.
  A run gets it only when its agent uses that gateway. Set a spend limit on the gateway where it
  offers one ([security.md](security.md)).
- **OpenRouter:** make a key at openrouter.ai/settings/keys → Create key. Its free models (ids
  ending `:free`) allow 50 requests a day, 1,000 a day once you've bought $10 of credits.

### Finding a model

The listed models are a few of hundreds. The rest are found by a word, on any channel:

- **In the web chat,** type in the picker's search (`kimi`, `coder`), or filter (Free, Tools,
  Reasoning, Images): a tap on a model picks it as a listed one is (`…/api/models`, kept 10
  minutes; your listed models' facts, a day).
- **Anywhere,** `/models kimi` lists them, each with the line that picks it, `use pi
  moonshotai/kimi-k3`: in a new task's words, as a comment on a task, or as a line of a web chat
  message (it wins over the chip).
- **Both read the gateway's `search`** (OpenRouter's public list, only models that take tools, 20 at
  most), with no key: the edge in a chat, the run on GitHub. They show each id its agent's
  `modelPattern` matches, as it is, with its price per million tokens (in / out, or free) and its
  context; aliases and anything else are left out. One reader for both, `modelsFound` in
  `cli/contracts/answers.ts`.

### When something new comes

| What comes | What you do | Then |
|---|---|---|
| A new model at OpenRouter | nothing | the search and `/models` find it; `use pi <its id>` works everywhere, recipes too |
| One you want listed first | its id in the agent's `models`, in a PR | it's in the chip and `/models`; `pnpm verify` checks it against the pattern |
| A listed model retired | its line removed | until then, a run that picks it fails with the gateway's words |
| A new Claude model | nothing | `use claude-opus-6` works by the pattern; `opus` follows Claude Code's own alias (a newer Claude Code is a version PR) |
| A new gateway | an entry in `gateways`, `pnpm ship add <name> --yes`, and an agent's `gateway` naming it | its key in Setup; searched too when it has a `search` |
| A new agent | its adapter, a line in `cli/lib/agents/index.ts`, its entry, and a recorded run ([Adding another agent](#adding-another-agent)) | installed on first use, the same rules, in the chip, `/models` and `use`. The Repeat form's Model gets it by hand, in both copies (a test keeps them equal) |

## On a box

- **Installed once, the first time a run picks it:** plan names the run's agent, and the step "The
  agent's CLI" (`ship run agent`, `cli/lib/agent-install.ts`) runs its entry's `install.run` into
  the box's shared tools, `<tools>/<dir>/<version>` (`claude-code/2.1.284`, `pi/1.0.2`), one slot
  at a time (`flock`). It opens the folder to the agents' users, checks the program starts
  (`--version`), and puts it on the run's `PATH`. A run that finds it there does nothing.
- **pi's own packages don't drift:** its install runs no package scripts (`--ignore-scripts`) and
  takes only what was published before its pin (`--before=2026-10-05`). Claude Code's runs its
  install script, as before.
- **Sizes on a Raspberry Pi:** Claude Code about 233 MB, pi about 166 MB.
- **A new Claude Code version:** its docs say `--bare` will become the default for headless runs,
  which skips CLAUDE.md, skills and helpers. The version's PR checks, with a recorded run, that a
  run still loads them.
- **Never installed on a PC or in CI.**
- **Its login:** plan names its secret (from `executors.json` only), and the think step gets that
  one as `SHIPIFY_AGENT_LOGIN`; the agent gets it on stdin, under the secret's own name.
  `task.yml` names no agent.
- **The weekly clean-up** keeps each agent's pinned version (its other versions are removed) and
  the two newest Node versions in the box's shared tools, while no other slot runs. Its summary on
  the status task names what it removed.

## Run details

Every reply ends with a folded **Run details** block, read from the agent's own output:
- the run's link, the box, and the time of each step;
- the agent, its version (pi doesn't print one: the version `executors.json` pins), the model and
  effort (marked Auto when they were);
- tokens (new, from cache, written to cache, output, thinking) and turns, and the cost when the
  agent reports one (pi);
- the tools it called, and any calls it was refused;
- your plan's 5-hour and weekly use (Claude Code).

On Telegram it's one line ("Sonnet · 48 s · 3 tool calls"; a gateway's model by its name without
its maker, "laguna-s-2.1:free"). The status comment keeps the last 20
runs. A run that ends without a usable `result.json` fails, and the reply says why.

## Claude Code's adapter

`cli/lib/agents/claude.ts`, checked against the pinned version (2.1.284) with a recorded real run
(`tests/fixtures/claude-stream.jsonl`):
- **Model and effort:** `--model` and `--effort`.
- **Output:** `--output-format stream-json --verbose`: the model and version, each tool call, the
  plan's limits, tokens and turns.
- **Commands:** `executors.json`'s `commands` as its own rules (ADR 0043): `Bash`, `Read`, `Glob`
  and `Grep` allowed as whole tools in `--allowedTools`, `WebFetch` and `WebSearch` when `web` is
  on, and each refused `git X` as `Bash(git X:*)`, `Bash(git * X)` and `Bash(git * X *)` in
  `--disallowedTools`. It stays in `acceptEdits`, so edits stay in its clone and `out/` (also a
  working folder, `--add-dir`). Checked in 2.1.284's own permission code, and live: its own
  answers to each command, for the rules the adapter writes, are
  `tests/fixtures/claude-decisions.json` (record them again when its version or the rules change).
  A deny rule is checked on every part of a command (`&&`, pipes, `$(…)`, a loop's body, after a
  wrapper such as `timeout -s KILL 9` or `xargs`) before any allow, and a whole-tool allow lets
  through every other prompt but Claude Code's safety checks (writes to `.git` or `.claude`, say),
  so pipes, loops and reads outside its folders run. Its deny rules match the words as written:
  `/usr/bin/git push` isn't matched, and a commit message or a search with the word `push` in it
  is (write the message to a file and commit with `-F <file>`); the read-only token and the box's
  own push are the wall.
- **The read profile** (`commands.run: false`, ADR 0044): `--restricted --tools Read,Grep,Glob`,
  its read folders as `--add-dir`, and no MCP config. `--restricted` takes away every tool that
  runs a command or code and WebFetch, keeps the file tools inside its working folders, and
  ignores settings files; its answer still comes back in the result's shape (its StructuredOutput
  tool). Recorded live on 2.1.284 in `tests/fixtures/claude-decisions.json`'s `read`: the tools it
  was offered, and reads outside its folders refused.
- **Tools:** an MCP config with only the look calls allowed and the act calls refused, keys named as
  `${VAR}`, never their values. `notion.search` is its `mcp__notion__search`.
- **Settings:** only its own user's settings and the run's MCP config (`--setting-sources user
  --strict-mcp-config`, which the adapter adds), so a project's files can't widen what it may do.
  Its settings and sessions live in the run's `config/` (`CLAUDE_CONFIG_DIR`), and it never updates
  itself mid-task (`DISABLE_AUTOUPDATER=1`): both from the adapter's `env`.

## pi's adapter

`cli/lib/agents/pi.ts`, checked against the pinned version (1.0.2) with a recorded run against a
stand-in model (`tests/fixtures/pi-stream.jsonl`). pi (`@earendil-works/pi-coding-agent`, MIT) is a
small agent core that does the work its own way:
- **How it starts:** `pi --mode json --no-approve -e <gate.mjs> --session-dir
  <config>/pi-sessions --provider shipify-<gateway> --model <id> --thinking <effort>`, with
  `--session <id>` to carry on in a session (a catch-up, the fix round), the prompt on stdin.
- **Its settings folder** is the run's own `in/tools` (`PI_CODING_AGENT_DIR`): `models.json` (the
  gateway as a provider of its own, so any model id there runs), `mcp.json` (the look tools'
  servers, local or remote (`url` and `headers`), which pi's built-in MCP reads: each server's look
  calls offered to the model as themselves, every other call hidden, pi's codemode off, keys named
  as `${VAR}`; a header value starting with `!`, which pi would run as a command, leaves that tool
  out), and the gate: `gate.mjs` and its rules, `gate.json`. They're given again before every ask,
  so a run can't change the rules a resumed ask starts with. At the end the gate names the tools
  pi didn't get, in one entry in pi's output that the run details show: those left out
  (`gate.json`'s `left`) and each look call whose server didn't connect, which pi says only on its
  own screen.
- **Nothing of the project's own** loads (`--no-approve`: no `.pi`), and nothing runs in the
  background (`PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`).
- **Shipify's gate** (`cli/lib/agents/pi-gate.mjs`, a pi extension in plain JavaScript): pi has no
  permission system of its own, by design, so the gate checks every tool call before it runs:
  - **a command:** runs unless a part of it (split at `;`, `&&`, `||`, `|`, `&` and new lines, and
    inside `$(…)` and backticks, quotes kept whole, a group's braces as words of their own and
    `${VAR}` as part of one; a loop's or a branch's body, after a wrapper
    and its options such as `timeout -s KILL 9` or `xargs -n1`, or a variable) is a refused one:
    `git push` is git's verb `push` after its own options (`git -C x push`, `/usr/bin/git push`),
    so a message or a search with the word `push` in it runs (ADR 0043);
  - **a file:** read anywhere but its own settings folder, written inside its working folder or the
    folders it may write;
  - **a tool:** only the look calls it was given; a tool Shipify doesn't know is refused;
  - **in the read profile** (`commands.run: false`, ADR 0044, with `--tools read,grep,find,ls
    --no-context-files`, so no repo's `AGENTS.md` or `CLAUDE.md` loads): no command and no tool's
    call, a file read only inside its working folder and its read folders (links resolved first),
    and nothing written. With no bash there, it reads and lists files; its grep and find need
    `rg` and `fd`, which a box doesn't have.

  A refused call shows in the run details. pi keeps its own four tools (read, bash, edit, write);
  its grep and find need `rg` and `fd`, which a box doesn't have, so it searches with `grep` and
  `ls` through bash.
- **Its answer:** the result file, or its final message when that's the result's JSON. A question
  answered in plain words (a smaller model may) takes those words as the reply, and the run
  details say so; a change still needs the result, with what it asks for.
- **Its report,** from its events: the model, tokens, cost, the tools it called, refused calls, and
  a note when it compacted its context. A bash command that fetches counts as reading outside
  (`readOutside`). When the model is busy, pi retries by itself (its own setting, left as it is):
  an attempt it retried and then answered isn't the run's error, and "finished" shows once, at the
  real end. When it ends on an error, its report carries the gateway's own words (pulled out of a
  JSON error body), and the reply says them with the model: "glm-5.3-flash at openrouter.ai
  answered: …" (`agent-error`).

## Adding another agent

Agents stay a plug-in kind: another one is data and an adapter, never a change to the core.

1. **An entry in `executors.json`** with its `task` command, its `models` (or `modelPattern`), its
   `efforts`, `auto`, its login (`login`, or a `gateway`, its `models` then ids there), and its `install`, pinned.
   Without an adapter, `flags` pass it a model and an effort (`{"model": ["-m", "{model}"]}`).
2. **An adapter** in `cli/lib/agents/<name>.ts`, listed in `cli/lib/agents/index.ts`, from
   `plugins/_template/agent/`. It turns the core's one ask (prompt, model, effort, tools, the
   shared `commands`, the gateway, the run's folders) into the agent's flags and settings (`argv`,
   `env`), offering only the tools the run names when it names them (`tools.only`, through the
   contract's `offered`; none for a run on another account, ADR 0045), writing `commands` as its
   agent's own rules (only the refused ones; an agent with no
   rules of its own loads pi's gate; with `run: false`, reading tools only, inside its folders), and
   reads its output into a report
   (`reader`), saying `readOutside` when the agent read the web or ran a command that fetches, and
   `said` (its last words) when it answered in words rather than the result's shape. A run needs
   one: an entry without an adapter can't run unattended on a box.
3. **A recorded run** of it in `tests/fixtures/` (against a stand-in model will do, as pi's is),
   named in `RECORDED` in `tests/plugins/agent.test.ts`, the agent conformance test every adapter
   passes. Its "one setup" test gives each adapter the same commands and folders, and checks each
   writes them; its decisions test needs the agent's own answers in `DECIDES` (pi's gate, or a recording
   such as `claude-decisions.json`), and
   checks it refuses and runs the same commands as every agent (ADR 0043); its read-profile test
   needs how it decides there in `READS`, and checks it runs nothing, fetches nothing and reads only
   inside its folders (ADR 0044). `tests/agents.test.ts` already runs Codex- and
   OpenCode-style entries (`tests/fixtures/executors-plus.json`) through their flags.
4. **Its install and login on boxes** come from its entry: a box installs it the first time a run
   picks it, and the think step gets its login. `task.yml` doesn't change. A new gateway is one
   more entry in `gateways`, set up with `pnpm ship add <gateway>`.
5. **To use it:** `use <name>` on a task, or make it the default (`"default": true`, or
   `SHIPIFY_AGENT`). `pnpm ship selftest <name>` checks it live: one question, asked through your
   Telegram (the one way your PC asks as you), so its answer comes there. A recipe's `model` and the
   Repeat form's Model take an agent too (`pi z-ai/glm-5.3`; the form's **Pi**).
