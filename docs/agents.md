# Agents

The **agent** is the program that thinks for a task: **Claude Code** by default, **pi** or
**OpenCode**. It
**only thinks**: it reads, changes files and commits in its own clone, and writes one result file.
The box makes every change after it has stopped: the reply, the push and PR, notes, the repeat, and
tool calls you approved ([tasks.md](tasks.md)).

Shipify is the **harness** around it: the task, the sandbox, the tools, the models and the clocks.
What every agent must never run, and where models are served, are said once in `executors.json`;
each agent's adapter writes them its own way (ADR 0038, ADR 0043).

## Where it runs, and what it holds

- **Its own Linux user,** one per slot: `shipify-agent-<k>`, started through one sudoers rule set
  up by `ship box add`, from an empty environment, with its keys on stdin.
- **Its login on a pipe:** file descriptor 3, which it reads once, so the login is never in its
  environment, where every command it runs could read it. Its adapter says how it reads it there
  (`loginFromPipe`).
- **Shipify's skills** (`skills/`), which the agent lists itself, each with when it applies, and
  loads when one fits: pi takes the folder (`--skill`), OpenCode its config's `skills.paths`, and
  Claude Code finds it linked in its settings folder (`config/skills`, made as the agent). A read
  run gets none.
- **A fresh folder each run:** `/srv/shipify-agent-<k>/run-<id>/` (its home, config, temp, work,
  the repos it reads, files in, files out). The slot's next run, and the weekly clean-up, remove
  the old ones.
- **It can't read** the runner's folders, the runner's processes, or another slot's runs.

| It holds | It never holds |
|---|---|
| its login, on its pipe: Claude Code's `CLAUDE_CODE_OAUTH_TOKEN`, or its gateway's key (pi and OpenCode: `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY` through Vercel) | a write token for any repo |
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
splits (in task #182 it ran two in parallel and messaged them as the shapes changed); OpenCode
starts them with its `task` tool, in its own process, so Shipify's gate checks their calls too
(checked live); pi has none, by design, and keeps its plan in files. All are fine.

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
| **pi** (`pi`, `pi-vercel`) | any model its gateway has, by its id there (`z-ai/glm-5.3`, `zai/glm-5.3`); a few listed first | the gateway's key ([Gateways](#gateways)) |
| **OpenCode** (`opencode`, `opencode-vercel`) | the same as pi's | the same keys |

pi and OpenCode go through each gateway `executors.json` lists for them: `pi` is pi through the first
(OpenRouter), `pi-vercel` is pi through the second (Vercel's AI Gateway), and so on
([Agents and gateways](#agents-and-gateways)).

- **A task picks one** with a `use` line: `use pi`, `use pi z-ai/glm-5.3`, `use opencode
  z-ai/glm-5.3 high`, `use claude` (back to Claude Code). Naming another agent alone starts it on its own Auto;
  `use claude auto` (or `use auto`) puts the agent you're on back on its Auto.
- **The default** is the agent the repo variable `SHIPIFY_AGENT` names, else the entry marked
  `default` (Claude Code), in the web chat's picker as in a run.
- **In the web chat,** the model chip opens **Who thinks**: the
  agents as tabs; your listed models by name with their maker, price, context and what they can
  do (from the gateway, read when it opens, kept a day; a line each from `about` for Claude Code's);
  a search and filters (Free, Tools, Reasoning, Images) for any other; the effort the model takes
  ([channels.md](channels.md#the-web-chat)). Status & setup's **Agents and models** shows each
  agent, its login or gateway key, its Auto and its models.
- **`/models`** (any channel, at once) lists each agent's models, its Auto and efforts; `/models
  <word>` searches a gateway's own list ([Finding a model](#finding-a-model)).
- **Your Claude plan stays on Claude Code** (Anthropic's terms). pi and OpenCode run on their
  gateway's key.
- **pi or OpenCode?** The same models, so the model does most of the work; the difference is the
  tools around it. OpenCode has more of its own (helpers, web fetch, to-dos) and is heavier on a
  Pi (about 600 MB at its peak and 20 s for a short run; pi about 120 MB and 2 s).

## The model and the effort

Each agent has its own models and efforts. Claude Code's:

| Model | For |
|---|---|
| Haiku | quick, simple answers; no effort setting |
| Sonnet (Auto) | most work: changes, questions, daily jobs |
| Opus | hard changes and design |
| Fable | the most capable, and the heaviest on your plan's limits |

pi's and OpenCode's are any model their gateway has, by its id there (`pi` and `opencode` through
OpenRouter, `pi-vercel` and `opencode-vercel` through Vercel's AI Gateway), with the efforts off, low,
medium, high and max, as far as each model takes them: its gateway's catalog says which, read when a
run needs it ([Read as needed](#read-as-needed)). An effort a model doesn't take runs at Auto's when
it takes that, else at none, and the run's details say so. On OpenRouter, GLM 5.3 takes max, high
and low (it always thinks, so `off` isn't one); Nemotron and DeepSeek V4.1 Flash take theirs and
`off` (their catalog says thinking is theirs to skip); the Kimis and Laguna none.
Each gateway lists a few first: OpenRouter, free ones then cheap ones good for building: Nemotron
(free, Auto) and Laguna (free), then GLM 5.3 Flash, DeepSeek V4.1 Flash, GLM 5.3, Kimi K2.7 Code and
Kimi K2.6, paid from your OpenRouter credits (a free one's id ends `:free`); Vercel, the same ones
that have a zero-data-retention provider, GLM 5.3 Flash first (Auto), each with the efforts its
catalog says it takes (Kimi K2.6 none). `/models <word>` and the
web chat's search find the rest, with today's prices. A run's cost shows on its reply's line
("· $0.03") and in its run details when the agent knows it; pi and OpenCode don't know a gateway
model's price, so their runs show none rather than a guess.

- **Auto** is the agent's `auto` in `executors.json`, or its gateway's: Sonnet at medium effort for
  Claude Code, GLM 5.3 Flash at high for pi and OpenCode, through OpenRouter (`z-ai/glm-5.3-flash`)
  or Vercel (`zai/glm-5.3-flash`): a paid model that costs fractions of a cent an answer, since a
  free one's endpoint can be down for hours (2026-10-16). A model of
  theirs picked with no effort thinks at high too, never at the model's own default (GLM's is
  max, its slowest).
- **A task picks another** with a `use` line: `use opus`, `use opus high`, `use claude-opus-5-5`,
  `use pi moonshotai/kimi-k2.7-code`, `use auto`. Alone, it applies from the next run ("From the next run: Opus"). As a
  line of its own in a longer message, that message's run already uses it. The task keeps it in its
  status comment.
- **A model names its agent** (ADR 0042): a listed model picks its own agent from any task, so on
  pi `use opus` goes back to Claude Code with Opus, and on Claude `use glm-5.3-flash` moves to pi.
  A gateway's listed model goes by its name after the maker when no other listed model shares it.
  A model two agents take (pi and OpenCode share OpenRouter's) stays on the task's agent when it's
  one of them, else goes to the first (pi): on an OpenCode task, `use glm-5.3` and `use
  moonshotai/kimi-k3` stay on OpenCode; on Claude they move to pi; `use opencode …` names it from
  anywhere. A pick that can't be taken is told, and nothing runs with a model you didn't choose
  ([tasks.md](tasks.md#fixed-words)).
- **The agent is told** what its run thinks with, and that only you change it: it never claims to
  pick or switch a model.
- **A repeat's job** picks it with the Repeat form's **Model** field.
- **Every word must be something the agent takes:** an agent's id, one of its `models`, a model id
  its `modelPattern` matches (a new Claude model works the day it's out), one of its `efforts`, or
  `auto`. A `use` that names nothing is refused, with the choices.
- **A choice the agent can't use** (effort on Haiku, say) runs on Auto, and the run details say why.

`executors.json`, in short: what every agent shares, the gateways, then each agent.

```json
"commands": { "deny": ["git push", "git stash"], "web": true },
"gateways": {
  "openrouter": {
    "name": "OpenRouter", "word": "openrouter",
    "url": "https://openrouter.ai/api/v1", "protocol": "openai-chat", "key": "OPENROUTER_API_KEY",
    "how": "openrouter.ai/settings/keys → Create key", "check": "/key",
    "search": "/models?supported_parameters=tools&limit=20&q={word}",
    "auto": { "model": "z-ai/glm-5.3-flash", "effort": "high" },
    "models": ["z-ai/glm-5.3-flash", "deepseek/deepseek-v4.1-flash", "…"],
    "list": { "name": "name", "price": ["pricing.prompt", "pricing.completion"], "…": "where each fact is" }
  },
  "vercel-ai-gateway": {
    "name": "Vercel", "word": "vercel",
    "url": "https://ai-gateway.vercel.sh/v1", "protocol": "openai-chat", "key": "AI_GATEWAY_API_KEY",
    "check": "/credits",
    "auto": { "model": "zai/glm-5.3-flash", "effort": "high" },
    "models": ["zai/glm-5.3-flash", "deepseek/deepseek-v4.1-flash", "zai/glm-5.3", "…"],
    "list": { "path": "/models", "model": "/models/{id}", "only": [["type", "language"], ["tags", "tool-use"]], "efforts": "reasoning_options.values", "…": "where each fact is" }
  }
},
"claude": {
  "adapter": "claude",
  "default": true,
  "login": { "secret": "CLAUDE_CODE_OAUTH_TOKEN", "how": "claude setup-token" },
  "auto": { "model": "sonnet", "effort": "medium" },
  "models": ["haiku", "sonnet", "opus", "fable"],
  "modelPattern": "^claude-[a-z0-9.-]+(\\[1m\\])?$",
  "efforts": ["low", "medium", "high", "xhigh", "max"],
  "modelEfforts": { "haiku": [] },
  "task": ["claude", "-p", "--permission-mode", "acceptEdits"],
  "install": { "version": "2.1.284", "dir": "claude-code", "bin": "bin/claude", "run": ["npm", "install", "-g", "…", "--prefix", "{prefix}", "@anthropic-ai/claude-code@2.1.284"] }
},
"pi": {
  "adapter": "pi",
  "gateways": ["openrouter", "vercel-ai-gateway"],
  "modelPattern": "^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*(:[a-z0-9]+)?$",
  "efforts": ["off", "low", "medium", "high", "max"],
  "task": ["pi"],
  "install": { "version": "1.0.2", "bin": "bin/pi", "run": ["npm", "install", "-g", "…", "--ignore-scripts", "--before=2026-10-05", "--prefix", "{prefix}", "@earendil-works/pi-coding-agent@1.0.2"] }
},
"opencode": {
  "name": "OpenCode",
  "adapter": "opencode",
  "gateways": ["openrouter", "vercel-ai-gateway"],
  "…": "pi's modelPattern and efforts",
  "task": ["opencode", "run"],
  "install": { "version": "1.18.34", "bin": "lib/node_modules/opencode-ai/node_modules/opencode-linux-{arch}/bin/opencode", "run": ["npm", "install", "-g", "…", "--ignore-scripts", "--before=2026-10-01", "--prefix", "{prefix}", "opencode-ai@1.18.34"] }
}
```

- **`commands`:** what every agent must never run, said once as plain prefixes (ADR 0043): `git
  push` and `git stash`, because the box pushes. Any other command runs, pipes, loops and reads
  outside its folders included: the walls are outside the agent (its own Linux user, read-only
  keys, every process killed at the end), so a list of what it may run only cost turns. `deny`
  covers every part of a command (`make && git push`, `$(git stash)`, a loop's body) and the
  command after git's own options (`git -C x push`). `web`: it may read the web with its own tools.
  Each adapter writes them as its agent's own rules ([Claude Code's](#claude-codes-adapter),
  [pi's](#pis-adapter), [OpenCode's](#opencodes-adapter)). It writes only in its working folder and `out/` (the adapter's `folders`).
  `tests/plugins/agent.test.ts` holds every adapter to the same decisions (the refused commands in
  any form, and a pipe, a loop or a read outside refused by none), and `tests/agent-tools.test.ts`
  checks that the agent's instructions name a refused command only where they say never: a new
  playbook step never needs a list changed. An `allow` list left in the file is named as a problem
  and never read.
- **`gateways`:** where models are served ([Gateways](#gateways)).
- **`task`:** the command for a run; the prompt goes on stdin. Its adapter adds the rest: the
  model, the effort, the commands, the look tools and its output.
- **`default`:** the agent tasks use, unless the repo variable `SHIPIFY_AGENT` names another.
- **`name`:** its name on labels (the chip, the picker, Run details) when its id capitalised isn't
  (`OpenCode`; `pi` shows as Pi).
- **`login`:** its secret, and how to make it (yearly: `claude setup-token`, then
  `pnpm ship setup agent --new`). An agent through a gateway has no login of its own: its
  login is the gateway's key (`loginOf` in `cli/lib/agents.ts`).
- **`gateways`:** the gateways it goes through, the first its own id's and each other one
  `<id>-<word>` ([Agents and gateways](#agents-and-gateways)). Its `models`, `auto` and `efforts`
  then come from the gateway; any id its `modelPattern` matches runs too. `tests/plugins/agent.test.ts`
  holds each listed id (and Auto's) to the pattern, so a mistyped one fails `pnpm verify`, not a run.
- **`efforts`, `modelEfforts`:** the efforts it takes, as the agent names them, and, by model id,
  those a model takes where they differ (none: `[]`, Haiku). Everything that asks what a model takes
  asks `effortsFor` (`cli/contracts/use.ts`): a `use` line asking for another is refused, a run's
  Auto or kept effort is dropped, and the picker offers only what the model takes.
- **`install`:** how a box installs it: its command's words, with `{prefix}` where it goes, its
  program (`bin`, with `{arch}` for the box's, `arm64` or `x64`, when the program comes in a
  package named for it), its `version`, and its folder (`dir`, the agent's id when not said). A version
  moves only in a PR that says so ([On a box](#on-a-box)).

## Gateways

A **gateway** is where models are served: one key, many models. `executors.json`'s `gateways` lists
each once, and it is the one place that says everything about its models:

- **To reach it:** its `url`, its `protocol` (`openai-chat`, `openai-responses` or
  `anthropic-messages`), its `key` (the secret, and the variable the agent reads it from), `how` to
  make a key, and a `check` path that answers 200 for a good key.
- **Its models:** `models` (the few listed first), `auto` (the model and effort a run gets when
  nothing picks; without it, the first listed model, with no effort), `modelPattern` (the ids it
  takes besides them; the agent's own is the default), and `about` (a line each).
- **What each model takes** isn't written here: it's the gateway's own catalog, read when it's
  needed ([Read as needed](#read-as-needed)).
- **Its names:** `name` for labels ("Vercel") and `word` for ids (`pi-vercel`).
- **Its list, read with no key:** `search` (a path with `{word}` in it, for a gateway that searches
  by itself) or `list.path` (its whole list, searched here), `list.model` (one model's own answer,
  with `{id}` in it: Vercel's `/models/{id}`; else its search for the id), and `list`'s paths to what it says of
  each model. Today: `openrouter` and `vercel-ai-gateway`.

- **`list`** says where its list has each fact, as paths into a model (`pricing.prompt`; into a
  list, each one's: `reasoning_options.values`): `name`, `maker`, `price` (in and out, per token),
  `context`, `output`, `efforts` (what the catalog says the model takes, as a list: none, when it
  lists none), and `can` (`tools`, `reasoning`, `images`: a path and the word that says it,
  `["tags", "tool-use"]`). `only` keeps the models whose path is that word, or a list that has it
  (`["type", "language"]`: no image or embedding models). One reader (`modelPool`,
  `cli/contracts/answers.ts`) serves every gateway: a new one is a `list` here, never code. Without
  `list`, a model is its id. The picker narrows each model's efforts to what its list says.

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
- **Vercel's AI Gateway:** `pnpm ship add vercel-ai-gateway --yes`; make a key in the Vercel
  dashboard, AI Gateway → API Keys. Models are paid from your Vercel credits. Its ids are its own
  (`zai/glm-5.3`, not OpenRouter's `z-ai/glm-5.3`), which is why its agents list their own models:
  pi's, less the free ones, which Vercel has no counterpart for. Its catalog also says, per model,
  whether it takes an effort and how much **data retention** it has (`zdr`: `all`, `some` or
  `none` of the providers serving it keep no data). An account can require zero data retention
  (a Vercel setting): a model with `none` is then refused with "No ZDR providers … available for
  model …", so none is listed, and search finds only models with `all` or `some` (its list's
  `only`). A model found by search runs with no effort unless you name one: what each takes differs,
  and Vercel refuses one it doesn't take.

## Agents and gateways

The file says the two apart: an agent is a program (its install, its adapter, its efforts' names,
the `gateways` it may use) and a gateway is where models are served. A run is the two together, and
`cli/contracts/gateways.ts` (`expandAgents`, pure, read by the CLI and the menus alike) makes one
entry for each pair:

- **`pi`** is pi through its first gateway; **`pi-vercel`** is pi through the second, named by the
  gateway's `word` (`opencode`, `opencode-vercel`). The first keeps the agent's own id, so a task, a
  repeat or `SHIPIFY_AGENT` that says `pi` means what it always did.
- **What a gateway says wins;** the agent's fields are the defaults. So the agent holds what is true
  of the program (`modelPattern` for ids written `maker/model`, its `efforts`), the gateway what is
  true of its models.
- **One program:** the others share the first's install (`ship doctor` still refuses two different
  installs in one folder), and none is the default.
- **What can't be made is left out, and said** (`ship doctor`, `pnpm verify`): an agent whose first
  gateway isn't there, or isn't right, is left out, since its id means that gateway; another one
  that isn't, one listed twice, or a made id that's taken (two gateways with one `word`) is skipped.
  `extends` and `gateway` aren't written by hand: they're what `gateways` makes.
- **Auto** is the gateway's, else the agent's own, else the gateway's first listed model with no
  effort. **Per-model efforts** through a gateway are the gateway's alone.

**Adding a model** is nothing: any id the gateway has runs (`use pi-vercel <id>`) and the search finds
it; to list it first, one line in the gateway's `models`, and the tests hold it to the pattern. **A
gateway** is one entry (with its `list`) and a line in each agent's `gateways` that should use it;
`pnpm ship add <gateway>` keeps its key. **An agent** is its adapter and an entry with `gateways`.

It works as any agent does: `use pi-vercel zai/glm-5.3`, a chip in the picker, a line in `/models`.
In the web chat's picker an agent's gateways are a row under its tab.

- **A bare word names one model** (`use glm-5.3` is pi's `z-ai/glm-5.3`), so the models a gateway
  names its own way are reached through its agent: `use pi-vercel glm-5.3`, or a bare word on a
  task already on it. An id only that gateway lists finds it from anywhere (`use zai/glm-5.3`), and
  Telegram's buttons name it. A second gateway therefore never makes a word ambiguous.
### Read as needed

What a model takes is the gateway's to say, so nothing about it is kept here: a gateway takes only
the efforts a model's catalog lists (OpenRouter's `reasoning.supported_efforts`, Vercel's
`reasoning_options`), an on/off model takes none, and they change as the gateways do. So it's read
when it's needed, with no key, through one reader (`modelLookup` and `modelFacts`,
`cli/contracts/answers.ts`), a gateway's `none` read as the agents' `off`:

- **A run** reads its model's answer before the agent starts (about 1 KB on Vercel). An effort the
  model doesn't take runs at Auto's when it takes that, else at none, and the run's details say so;
  Auto's own is changed quietly. An answer that doesn't come changes nothing: the gateway tells.
- **The web chat's picker** reads each listed model's answer when it opens (kept a day) and each
  search's (kept 10 minutes), and offers and keeps only the efforts a model takes.
- **A `use` line** takes any of the agent's efforts: the run holds it to the model.

A model you add to a gateway's `models` needs nothing else, and one you don't list runs the same.

**The default** is the agent the repo variable `SHIPIFY_AGENT` names, for runs and for the web
chat's picker alike: set it to `pi-vercel` and tasks think there; clear it to go back. Nothing else
changes, and a task or a repeat can still say `use`.

### Finding a model

The listed models are a few of hundreds. The rest are found by a word, on any channel:

- **In the web chat,** type in the picker's search (`kimi`, `coder`), or filter (Free, Tools,
  Reasoning, Images): a tap on a model picks it as a listed one is (`…/api/models`, kept 10
  minutes; your listed models' facts, a day).
- **Anywhere,** `/models kimi` lists them, with the lines that pick one, `use pi
  moonshotai/kimi-k3 or use opencode moonshotai/kimi-k3`: in a new task's words, as a comment on a
  task, or as a line of a web chat message (it wins over the chip). On Telegram each is a button
  that sends `use <its id>` (the task's agent takes it when it lists it or is on that gateway, else
  pi), or, through another gateway than its agents' first, `use pi-vercel <its id>`, so a tap runs it
  where it was found.
- **Both read the gateway's public list** with no key: its `search` (OpenRouter's, only models that
  take tools, 20 at most), or its whole list read once and searched here (Vercel's: every word in
  a model's id or name, only models with a zero-data-retention provider; kept 10 minutes), the edge
  in a chat, the run on GitHub. They show each id its agent's
  `modelPattern` matches, as it is, with its price per million tokens (in / out, or free) and its
  context; aliases and anything else are left out. One reader for both, `modelsFound` in
  `cli/contracts/answers.ts`.

### When something new comes

| What comes | What you do | Then |
|---|---|---|
| A new model at OpenRouter | nothing | the search and `/models` find it; `use pi <its id>` (or `opencode`) works everywhere, recipes too |
| One you want listed first | its id in its gateway's `models`, in a PR | it's in the chip and `/models`; `pnpm verify` checks it against the pattern |
| A listed model retired | its line removed | until then, a run that picks it fails with the gateway's words |
| A new Claude model | nothing | `use claude-opus-6` works by the pattern; `opus` follows Claude Code's own alias (a newer Claude Code is a version PR) |
| A new gateway | an entry in `gateways` (with its `models`, `auto` and `list`), `pnpm ship add <name> --yes`, and its id in the `gateways` of each agent that should go through it | its key in Setup; searched too when it has a `search` or a `list.path` |
| A new agent | its adapter, a line in `cli/lib/agents/index.ts`, its entry, and a recorded run ([Adding another agent](#adding-another-agent)) | installed on first use, the same rules, in the chip, `/models` and `use`. The Repeat form's Model offers it on its own (the page's choices are the agents as the file makes them; GitHub's form takes words) |

## On a box

- **Installed once, the first time a run picks it:** plan names the run's agent, and the step "The
  agent's CLI" (`ship run agent`, `cli/lib/agent-install.ts`) runs its entry's `install.run` into
  the box's shared tools, `<tools>/<dir>/<version>` (`claude-code/2.1.284`, `pi/1.0.2`,
  `opencode/1.18.34`), one slot
  at a time (`flock`). Once the program starts (`--version`) it marks the install done
  (`.installed` in its folder), opens the folder to the agents' users and puts it on the run's
  `PATH`. A run that finds the mark does nothing; one that finds an install without it (stopped
  halfway, its program there but cut short) removes it and installs again.
- **The agent's own `ship` commands start the built CLI** (ADR 0051): `node <copy>/cli/dist/ship.mjs`
  in the read-only copy of Shipify the job makes first, one file that starts in 0.66 s. An adapter
  finds its own files (pi's and OpenCode's gates) with the contract's `agentFile`, from the
  platform root, never next to its source, because the built CLI is one file in `cli/dist/`.
- **pi's and OpenCode's own packages don't drift:** their installs run no package scripts
  (`--ignore-scripts`) and take only what was published before their pin (`--before=…`).
  OpenCode's program is the one its package for the box's architecture holds, started directly.
  Claude Code's runs its install script, as before.
- **Sizes on a Raspberry Pi:** Claude Code about 233 MB, pi about 166 MB, OpenCode about 177 MB
  (its install takes about 30 s).
- **A new Claude Code version:** its docs say `--bare` will become the default for headless runs,
  which skips CLAUDE.md, skills and helpers. The version's PR checks, with a recorded run, that a
  run still loads them.
- **Never installed on a PC or in CI.**
- **Its login:** plan names its secret (from `executors.json` only), and the think step gets that
  one as `SHIPIFY_AGENT_LOGIN`. The agent gets it on fd 3, a pipe: the sandbox's wrapper reads it
  from stdin after the other keys, and makes it a pipe (a here-document, which the box's `/bin/sh`,
  dash, makes a pipe) that the agent reads once. Off a box, it's a fourth pipe of the agent's
  process. An agent whose adapter has no `loginFromPipe` gets it in its environment, under the
  secret's own name. `task.yml` names no agent.
- **The weekly clean-up** keeps each agent's pinned version (its other versions are removed) and
  the two newest Node versions in the box's shared tools, while no other slot runs. Its summary on
  the status task names what it removed.

## Run details

Every reply ends with a folded **Run details** block, read from the agent's own output:
- the run's link, the box, and the time of each step;
- the agent, with the gateway it went through when that isn't its first ("pi · Vercel"), its
  version (pi and OpenCode don't print one: the version `executors.json` pins), the model and
  effort (marked Auto when they were);
- tokens (new, from cache, written to cache, output, thinking) and turns, and the cost when the
  agent reports one;
- the tools it called, its helpers' too, and any calls it was refused (OpenCode's tokens leave out
  its helpers': its output doesn't carry them);
- the skills it loaded (**Skills**): Claude Code's and OpenCode's skill tool, or any
  agent's read of a skill's `SKILL.md` (pi's way); the weekly digest counts them;
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
  itself mid-task (`DISABLE_AUTOUPDATER=1`): both from the adapter's `env`. Its user's
  `settings.json` there, which a command could write (hooks, `env`, a key helper), is removed before
  every ask (the adapter's `cleared`), and the skills link made again.
- **Its login:** from fd 3 (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3`), its own setting, which
  isn't in its public docs. Checked live on 2.1.284: it reads the pipe once and keeps the login in
  memory, never in a file (it would write one only in its remote mode, which Shipify doesn't use).
  A new version's PR checks it again: `tests/plugins/agent.test.ts` holds it to the pinned version.

## pi's adapter

`cli/lib/agents/pi.ts`, checked against the pinned version (1.0.2) with a recorded run against a
stand-in model (`tests/fixtures/pi-stream.jsonl`). pi (`@earendil-works/pi-coding-agent`, MIT) is a
small agent core that does the work its own way:
- **How it starts:** `pi --mode json --no-approve -e <gate.mjs> --session-dir
  <config>/pi-sessions --provider shipify-<gateway> --model <id> --thinking <effort>`, with
  `--session <id>` to carry on in a session (a catch-up, the fix round), the prompt on stdin.
- **Its settings folder** is the run's own `in/tools` (`PI_CODING_AGENT_DIR`): `models.json` (the
  gateway as a provider of its own, so any model id there runs, with no key), `mcp.json` (the look tools'
  servers, local or remote (`url` and `headers`), which pi's built-in MCP reads: each server's look
  calls offered to the model as themselves, every other call hidden, pi's codemode off, keys named
  as `${VAR}`; a header value starting with `!`, which pi would run as a command, leaves that tool
  out), and the gate: `gate.mjs` and its rules, `gate.json`. The folder is emptied and they're
  given again before every ask, so a run can't change the rules a resumed ask starts with, nor add
  what pi would load from there (an extension, a `settings.json`). At the end the gate names the tools
  pi didn't get, in one entry in pi's output that the run details show: those left out
  (`gate.json`'s `left`) and each look call whose server didn't connect, which pi says only on its
  own screen.
- **Nothing of the project's own** loads (`--no-approve`: no `.pi`), and nothing runs in the
  background (`PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`).
- **Its gateway's key:** pi passes its whole environment to every command it runs, so the key never
  goes there. The gate reads it once from the pipe `SHIPIFY_LOGIN_FD` names (fd 3), closes the
  pipe, and hands it to the gateway's provider (`pi.registerProvider`, the provider `gate.json`
  names), as a literal: pi would read a `$NAME` in it as a variable and a leading `!` as a command.
- **Shipify's gate** (`cli/lib/agents/pi-gate.mjs`, a pi extension in plain JavaScript): pi has no
  permission system of its own, by design, so the gate checks every tool call before it runs:
  - **a command:** runs unless a part of it (split at `;`, `&&`, `||`, `|`, `&` and new lines, and
    inside `$(…)` and backticks, quotes kept whole, a group's braces as words of their own and
    `${VAR}` as part of one; a loop's or a branch's body, after a wrapper
    and its options such as `timeout -s KILL 9`, `xargs -n1` or `sudo -u who`, by its path such as
    `/usr/bin/env`, or a variable) is a refused one, or runs one inside it (a shell's `-c` string,
    `eval`'s words, find's `-exec`): `git push` is git's verb `push` after its own options (`git -C
    x push`, `/usr/bin/git push`), so a message or a search with the word `push` in it runs (ADR
    0043);
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

## OpenCode's adapter

`cli/lib/agents/opencode.ts`, checked against the pinned version (1.18.34) with a recorded run
against a stand-in model (`tests/fixtures/opencode-stream.jsonl`), and live on a Pi the way a box
runs it (the prompt on stdin, the key on fd 3, its output read through a pipe). OpenCode
(`opencode-ai`, MIT) is an open agent with tools of its own (files, commands, web fetch, to-dos,
helpers):
- **How it starts:** `opencode run --format json --title "Shipify run" --model
  shipify-<gateway>/<id> --variant <effort>`, with `--session <id>` to carry on in a session, the
  prompt on stdin. The fixed title means no model is asked to name the session (by default, a
  paid one).
- **Its config** is the run's `in/tools/opencode.json` (`OPENCODE_CONFIG`), given again before
  every ask: the gateway as a provider of its own (any model id there runs; each effort as the
  gateway's `reasoning`, `off` as none), with no key; the look tools' MCP servers, local or remote,
  keys named as `{env:VAR}`; its own permissions all `allow` but the refused commands (an `ask`
  would end a run with no one to answer), the act calls `deny` (so the model never sees them);
  Shipify's skills (`skills.paths`); and the gate as its plugin.
- **Nothing of the project's own** loads (no `opencode.json`, `.opencode` or plugins, no Claude Code
  files, no `.agents` or `.claude` skills of a repo's or its home's, which could shadow Shipify's),
  no logins of its own (`OPENCODE_AUTH_CONTENT={}`: an `auth.json` entry can fetch a config from
  anywhere), nothing runs in the background (updates, the models list, LSP downloads, sharing, git
  snapshots), and its sessions live in the run's `config/`: all from the adapter's `env`. Before
  every ask its own config folder is made again, empty and read-only (the adapter's `readOnly`:
  where it can write it, OpenCode installs its plugin package there from npm on every start, about
  two minutes on a Pi, and a config there would load before the gate), and its home's `.opencode`
  and its cache removed (`cleared`): a models list there can name another package for its
  provider, and a package there is loaded as it is. Nothing in its cache is needed between asks.
- **A command it runs** gets the run's own XDG folders back (the gate's `shell.env`: those under
  its HOME, as the box sets them), not OpenCode's own in `config/`, so pnpm's store and a test
  browser are the slot's kept ones, downloaded once.
- **Its gateway's key:** OpenCode passes its environment to every command it runs, so the key never
  goes there or in its config. The gate reads it once from the pipe `SHIPIFY_LOGIN_FD` names, closes
  it, and puts it on each call to the gateway's provider alone (OpenCode's `chat.headers`). An
  OpenCode that didn't load the gate has no key. Once OpenCode has read all its config, the gate
  checks it is its adapter's (OpenCode's `config` hook): no plugin but the gate, and the
  provider's package, address and models' own as `opencode.json` says. Its sessions' database
  stays between asks and holds a login whose config OpenCode fetches; a config changed that way
  gets no key, and the run's error says why.
- **Shipify's gate** (`cli/lib/agents/opencode-gate.mjs`, an OpenCode plugin, with pi's gate beside
  it): OpenCode's own rules refuse `git push` in most forms, but not after a wrapper (`env git
  push`) or by its path (`/usr/bin/git push`), so the gate checks every tool call as pi's does: its
  file and command tools as pi's, a patch's files as writes, the look calls it was given, the web
  when the run may read it, its own to-dos, skills and helpers; anything else is refused. In the
  read profile only `read`, `list`, `glob` and `grep` are offered, inside its folders. Its own
  rules match the words, as Claude Code's do: a commit message or a search with the word `push` in
  it is refused (checked live on 1.18.34; commit with `-F <file>`).
- **Its answer and report:** the result file, or its final message in the result's shape; the
  model, the tools it called, what it read from outside and refused calls, all from the gate's
  lines in OpenCode's output: the gate names each call it checks, its helpers' too, which
  OpenCode's own events don't carry, so a helper that reads the web counts as the run reading it.
  Tokens are OpenCode's own events', so a helper's aren't in them.

## Adding another agent

Agents stay a plug-in kind: another one is data and an adapter, never a change to the core.

1. **An entry in `executors.json`** with its `task` command, its `models` (or `modelPattern`), its
   `efforts`, `auto`, its login (`login`, or `gateways`: the models and `auto` then come from each gateway, by their ids there, and what each model takes from its catalog), and its `install`, pinned.
2. **An adapter** in `cli/lib/agents/<name>.ts`, listed in `cli/lib/agents/index.ts`, from
   `plugins/_template/agent/`. It turns the core's one ask (prompt, model, effort, tools, the
   shared `commands`, the gateway, the run's folders) into the agent's flags and settings (`argv`,
   `env`), offering only the tools the run names when it names them (`tools.only`, through the
   contract's `offered`; none for a run on another account, ADR 0045), writing `commands` as its
   agent's own rules (only the refused ones; an agent with no
   rules of its own loads pi's gate; with `run: false`, reading tools only, inside its folders), and
   reads its output into a report
   (`reader`), saying `readOutside` when the agent read the web or ran a command that fetches, and
   `said` (its last words) when it answered in words rather than the result's shape. It says how
   its agent reads its login from fd 3 (`loginFromPipe`: its own setting for that, or a loader
   that reads it there, as pi's gate does). It hands its agent Shipify's skills (`run.skills`: the
   agent's flag for a folder of them, or `skillsLink`, where the run links them in its settings).
   A folder its agent would write in when it can (OpenCode's own config) it names in `readOnly`,
   and the run makes it again, empty and read-only, before every ask. What its agent reads its rules
   or code from that a command could write, besides its settings folder (emptied anyway), it names
   in `cleared` (Claude Code's `settings.json`, OpenCode's `~/.opencode`), removed before every ask.
   A run needs one: an entry without an adapter can't run unattended on a box.
3. **A recorded run** of it in `tests/fixtures/` (against a stand-in model will do, as pi's and
   OpenCode's are),
   named in `RECORDED` in `tests/plugins/agent.test.ts`, the agent conformance test every adapter
   passes. Its "one setup" test gives each adapter the same commands and folders, and checks each
   writes them; its decisions test needs the agent's own answers in `DECIDES` (pi's gate, or a recording
   such as `claude-decisions.json`), and
   checks it refuses and runs the same commands as every agent (ADR 0043); its read-profile test
   needs how it decides there in `READS`, and checks it runs nothing, fetches nothing and reads only
   inside its folders (ADR 0044); its login test needs how its agent reads the pipe in `PIPED`.
   Then check it live the way a box
   runs it: the prompt on stdin, the login on fd 3 and its output read through a pipe (sending its
   output to a file can hide a break).
4. **Its install and login on boxes** come from its entry: a box installs it the first time a run
   picks it, and the think step gets its login. `task.yml` doesn't change. A new gateway is one
   more entry in `gateways`, set up with `pnpm ship add <gateway>`.
5. **To use it:** `use <name>` on a task, or make it the default (`"default": true`, or
   `SHIPIFY_AGENT`). `pnpm ship selftest <name>` checks it live: one question, asked through your
   Telegram (the one way your PC asks as you), so its answer comes there. A recipe's `model` and the
   Repeat form's Model take an agent too (`pi z-ai/glm-5.3`; on the page, each agent is a choice).
