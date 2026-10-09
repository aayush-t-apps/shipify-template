---
status: accepted (merged #247); built 2026-10-09, see [As built](#as-built-2026-10-09)
date: 2026-10-09
amends: 0038 (its Commands row)
---

# 0043: Agents run what they need: a short refused list, not an allow list

Proposed from the owner's requests on task #245 (2026-10-08): check whether our command and tool
rules hold agents back, need constant upkeep, or need changing for each new agent; then "design the
recommended clean plan, simple and robust, within the rules", and check which skills and guides need
fine-tuning. Merging this PR accepts the design; `go` starts the build (one PR). It amends ADR
0038's "One setup" for commands only: tools, models, folders and instructions stay as they are.

## Context

`executors.json`'s `commands` lists 54 command starts every agent may run (`make`, `git status`,
`ls`, `cat`, `gh pr view`, …) and refuses two (`git push`, `git stash`). Each adapter turns that into
its agent's rules: Claude Code's `Bash(<prefix>:*)` flags, pi's gate (`pi-gate.mjs`). It costs more
than it gives:

- **It holds agents back.** 5 of task #245's first 9 runs had calls refused: a `grep … | xargs`
  pipe, a `for` loop, `cat /proc/device-tree/model`, `ls -la /srv`, `hostnamectl`, `swapon --show`,
  reading `/etc/os-release`. The run after them had `sed -n` and `ls /opt/shipify/tools` refused.
  Each refusal costs a turn, and sometimes the question goes unchecked (the swap check was answered
  from `free`). `find`, `sort`, `jq`, `diff`, `awk`, `xargs`, `env`, `which` aren't allowed at all.
- **It needs upkeep.** `tests/agent-tools.test.ts` fails when a playbook or recipe names a command
  that isn't listed, so every new instruction edits the list. The playbook carries rules that exist
  only for it ("run each command on its own… anything else is refused and costs a turn"), and
  `docs/context.md` keeps gotchas about it.
- **It buys no safety.** `node` and `python3` are on it, so anything runs through them. Our docs
  already say it "is a layer, not a wall" (security.md, agents.md, ADR 0041). The walls are outside
  the agent: its own Linux user, read-only keys, every process killed at the end, the box's push
  ignoring the clone's hooks.
- **It's the hard part of a new agent.** An adapter must turn 54 prefixes into its agent's rule
  language and get pipes, `$(…)` and `git -C x push` right.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| Claude Code's refused rules hold in compound commands: each part, inside `$(…)`, subshells and `for` bodies | Claude Code's permissions docs ("Compound commands": deny rules apply when any subcommand matches, including a command nested inside a subshell, a command substitution or a control-flow body) |
| Claude Code's refused rules hold in every permission mode, `bypassPermissions` included; allow rules have no effect there | its permission-modes docs ("Deny rules block in every mode, including `bypassPermissions`") |
| `bypassPermissions` runs as a non-root user only | its docs (it refuses root or sudo); the agent's user isn't root |
| Claude Code in `-p` refuses reads outside its folders even for an allowed command | seen: `docs/context.md` ("`cat` on `/sys`… even with `Bash(cat:*)` allowed"), and this task's own refusals. **Build step 1's live check** finds whether allowing `Bash` and `Read` as whole tools lifts it. Its own out/ is already a working folder (`--add-dir`, 2026-10-09): a command could write a log there but not list it or read it back |
| pi 1.0.2's MCP takes remote servers: `url`, and `headers` with `${NAME}` | pi's MCP docs (v0.99 on: stdio and streamable HTTP; "env and headers accept `${NAME}`; a whole value can be `!command`"). **Step 1** checks it with a recorded run |
| A refused rule isn't a wall: a program by another path, or `sh -c`, isn't matched | Claude Code's docs say so ("isn't a security boundary around the program"); it's why the walls below stay the boundary |
| The agent can't push anyway: its token is read-only, and the box pushes from a clone with hooks off | `docs/security.md`, `tests/workflows.test.ts` |

## Options

- **A: keep the allow list, add what's missing.** (+ no design change / − the same upkeep forever,
  refusals keep costing turns, and every new agent still translates 54 prefixes)
- **B: one shared checker for every agent** (a Claude Code `PreToolUse` hook calling pi's gate).
  (+ one decision for both / − a Node start on every tool call on the Pi, and it keeps the list)
- **C: a short refused list.** Agents run any command except `git push` and `git stash`; the walls
  stay the boundary. (+ nothing to keep up, no refused turns, a new agent refuses two commands /
  − an agent's mistakes aren't caught by the list, which never really caught them)
- **D: ACP** (the dropped ADR 0043 draft, commits `fcbbbf2` and `9f97aab`). (+ one client for any
  agent / − about 4 PRs and a dependency, for two agents that already work)

## Decision

Chosen **C**, in one feature-sized PR, because it removes the upkeep and the refusals without
losing a wall, and leaves almost nothing for a new agent to translate.

**1. `executors.json`:** `commands` keeps `deny` and `web`, and drops `allow`:

```json
"commands": { "deny": ["git push", "git stash"], "web": true }
```

The contract (`Commands` in `cli/lib/plugins/agent.ts`) drops `allow`; an entry that still has one
is refused with a plain line, so nothing silently means two things.

**2. Claude Code's adapter** (`withCommands` in `claude.ts`):
- allows `Bash`, `Read`, `Glob` and `Grep` as whole tools, plus `WebFetch` and `WebSearch` when
  `web` is on;
- refuses each `deny` entry as today: `Bash(git push:*)`, `Bash(git * push)`, `Bash(git * push *)`
  (and the same for `stash`);
- keeps the rest: `acceptEdits`, edits only in its clone and `out/`, the fence round its own
  settings, look calls allowed and act calls refused, `--setting-sources user
  --strict-mcp-config`.

If step 1's live check finds reads outside its folders still refused with `Bash` and `Read`
allowed, the adapter starts it with `--permission-mode bypassPermissions` instead, keeping the
same refused rules (they hold in that mode). Allow rules don't count there, so in that mode a
tool's call that is neither look nor act would run; its look key, which can't write, stays the
wall. The PR says which of the two shipped, and why.

**3. pi's gate** (`pi-gate.mjs`), the same rules:
- a command: every part (split as today, inside `$(…)` and backticks too) is checked against
  `deny` only, also after git's options. The prefix list and the `cd` check go;
- a file: read anywhere but its own settings folder; written only in its clone and the folders it
  may write (as today);
- a tool: only the look calls it was given; a tool Shipify doesn't know is refused (as today).

**4. pi gets remote tools.** `pi.ts` stops skipping a `url` tool: it writes `url` and `headers`
into pi's `mcp.json` the way Claude Code's adapter does, keys named as `${VAR}`, never their
values. A header value starting with `!` (pi would run it as a command) is refused by the adapter.
If pi can't reach a remote tool, its run details say which, never silently.

**5. Tests that check decisions, not flags:**
- the agent conformance test (`tests/plugins/agent.test.ts`): both agents refuse `git push`,
  `git -C x push`, `make && git push`, `echo "$(git stash)"` and a `for` loop that pushes; both
  allow `find . -name x | xargs grep y`, `jq`, a `for` loop, and a read of `/etc/os-release`. pi's
  are its gate's real answers; Claude Code's are its flags plus the recorded live run;
- `tests/agent-tools.test.ts` flips: no instruction (playbook, prompt, notebook section, recipes)
  names a refused command unless it says never, so a new playbook step never needs a list change;
- `tests/agent-pi.test.ts`: prefix and `cd` cases become allowed, the refused cases stay;
- a pi remote-tool case, and the `!` header refused.

**What stays exactly as it is** (the walls): the agent's own Linux user and fresh run folder,
read-only GitHub and tool keys, no write or act key in the think step, every process killed at the
end, the box's push from its own clone with hooks off, the secret scan, workflow files refused,
look calls only and act calls after your `yes`, your files and the run's settings fenced.

## Edge cases

- **`git push` by another path** (`/usr/bin/git push`, `sh -c "git push"`): not matched by the list,
  and fails anyway: the token is read-only and the box pushes. Same as today with `node` allowed.
- **`gh pr create`, `gh issue close`, `gh api -X POST`:** run, and fail on the read-only token. Not
  listed, to keep the list to what the agent's own key could do.
- **A command that fetches** (`curl`, `wget`, a URL): still counts as reading outside, so notes and
  calls wait for your `yes`. A script that fetches without a URL in its command wasn't caught before
  either (`node` and `python3` were allowed); the agents' firewall (roadmap) closes that.
- **A long or stuck command** (`tail -f`, `sleep`): the run's clock and the kill at the end, as
  today.
- **Writes outside the clone by a command** (`> file` in `home/` or `tmp/`): the run's own folders,
  gone with the run. The Linux user can't write anywhere else.
- **A project's own config** trying to widen the rules: still ignored (`--setting-sources user`,
  `--no-approve`), and the conformance test keeps its hostile project file.
- **A run already going when this merges:** it keeps the copy of Shipify it started with.
- **Claude Code changes its rule syntax in a later version:** a version moves only in a PR that
  says so; the conformance test and the recorded run catch it there.
- **A third agent:** its adapter refuses two commands and keeps writes in its folders. With no rule
  system of its own, it loads pi's gate.

## Setup

Nothing to set up. Boxes pick it up with the next run after the merge.

## Docs and clean-up

The build updates, in the same PR:
- `executors.json` (`commands`, its description), `cli/lib/plugins/agent.ts`, `claude.ts`,
  `pi.ts`, `pi-gate.mjs`, `plugins/_template/agent/adapter.ts` (writes only the refused list);
- `playbooks/task.md`, **Rules**: "Local commands only" becomes "Any local command" (the never list
  stays); "How" keeps "change files with Edit and Write, never `sed -i`" (diffs stay reviewable),
  says scratch files go in `$TMPDIR` (the run's own), prefers `git -C`/`make -C` to `cd … &&` as
  advice, and drops "anything else is refused and costs a turn";
- `docs/agents.md` (`commands`, both adapters, adding an agent), `docs/security.md` (the sandbox's
  "layer, not a wall" and apply's "commands" lines), `docs/configuration.md`, `docs/plug-ins.md`,
  `docs/context.md` (the two `-p` gotchas about the allowed list, kept only if the live check still
  shows them), `skills/plug-ins/SKILL.md` ("what it may run" becomes "what it must never run");
- ADR 0038: a note that its Commands row is replaced by this ADR; `docs/adr/README.md`;
  `CHANGELOG.md`;
- **a tune-up of skills and guides** (found checking them for this ADR), so an unattended agent can
  follow every step. Each vendored skill's change goes in `skills/README.md`'s "Changes from the
  originals":
  - `test-driven-development`, `systematic-debugging` (with `root-cause-tracing.md`,
    `find-polluter.sh`): `npm test` becomes `make test` in a project, or `pnpm exec vitest run
    <file>` for one file;
  - the same two and `writing-good-tests.md`: "ask your human partner" means, in a task, finishing
    `needs-you` with one question when it changes what gets built (`playbooks/task.md`), and after
    three failed fixes stopping with `failed`;
  - `frontend-design`: "confirm with the client" becomes "propose it in `DESIGN.md` and carry on";
  - `codebase-design/DESIGN-IT-TWICE.md`: helpers optional (the README says no required
    subagents), and its `GLOSSARY.md` is `docs/glossary.md`;
  - `api-and-interface-design` names a `deprecation-and-migration` skill, and
    `security-and-hardening` a `references/security-checklist.md`, neither vendored here: the
    names come out, as before for that skill;
  - `playbooks/task.md`: "`make -C <clone> test`" becomes "`make test` in a project, `make verify`
    in shipify" (shipify's Makefile has no `test`);
  - `playbooks/fix-ci.md`: marked "from a terminal" (it pushes and opens a PR), with a task pointed
    at `playbooks/task.md`'s "Checks failed";
  - `playbooks/plan-app.md`: "Ask the owner" says, in a task, finish `needs-you` with the question.

## Consequences

- **Easier:** no list to keep, no refused turns, box questions answered from the box itself, a new
  agent refuses two commands, one test proves both agents agree.
- **Harder:** nothing new, but the list no longer catches an agent's honest mistake (a wrong `rm`
  in its clone). Its commits and the box's checks still stand between it and anything you see.
- **Unchanged:** what an agent can reach, every key, every approval.

## Confirmation

- `tests/plugins/agent.test.ts`: both adapters refuse and allow the same commands.
- `tests/agent-tools.test.ts`: no instruction names a refused command.
- A recorded run on homepi (step 1, kept as a fixture): a read outside its folders works and
  `git -C x push` is refused.
- `ship selftest sandbox` and `ship doctor`: the walls, unchanged.

## Build plan

One PR after `go`:

1. **Live check first** on homepi, as the agent's user: Claude Code with `Bash` and `Read` allowed
   as whole tools; does `cat /etc/os-release`, `ls /opt/shipify/tool` and a pipe run, and are
   `git -C x push` and `echo "$(git stash)"` refused? Then pi with a remote tool. This picks the
   Claude Code mode (point 2).
2. Points 1 to 5, test first.
3. The docs and skills above, then `make verify` and `ship pr --check`.

Undoing it is reverting that PR: nothing is stored, and boxes take the old rules with the next run.

## Decisions for you

| Decision | Default | Other choices |
|---|---|---|
| The refused list | `git push`, `git stash` | also `gh`'s write verbs (they fail on the read-only token anyway, so listing them only saves a turn) |
| Claude Code's mode | whole-tool allows in `acceptEdits`; `bypassPermissions` only if the live check needs it | `bypassPermissions` from the start |

The owner merged with the defaults and said build it (task #245, 2026-10-09).

## As built (2026-10-09)

One PR, as planned; both defaults kept.

**Step 1, the live check, was done on Claude Code's own code, not a live run.** A `claude -p`
started from inside a run on homepi (as `shipify-agent-3`) couldn't sign in: Claude Code doesn't
pass its login to the commands it runs, by design, and the run doesn't go looking for it. So the
check read the permission code inside the pinned binary (2.1.284), on homepi:
- the Bash tool's own check returns a deny for a matching deny rule, on each part of a command,
  before any allow is looked at; the general check then returns that deny first, in every mode;
- a read outside the working folders comes back as an ask that a prefix rule can't pass
  (`bashAllowRuleOverridable` is set only inside them), which is why `Bash(cat:*)` never helped;
- after the tool's check, the general check returns an ask as it is only for a safety check (a
  write to `.git` or `.claude`, say), a sandbox override, plan mode or an ask rule; otherwise a
  whole-tool allow (`Bash`, `Read`) allows it, and Bash doesn't opt out of that
  (`ignoresWholeToolAllowRule`).

So whole-tool allows in `acceptEdits` do what was needed, and `bypassPermissions` isn't used.
Claude Code's docs say the same ("to run all Bash commands without prompts except for a few you
want blocked, add `Bash` to your allow list"). pi's remote tools were checked against pi 1.0.2's
own `docs/mcp.md` (`url`, `headers` with `${NAME}`, a whole value `!command` run).

**Then live, in review, from the owner's PC** (signed in there), in a scratch run folder laid out
as a box's:
- **Claude Code 2.1.284** (the pinned version, in a scratch folder) with the adapter's exact argv
  ran 33 commands as written: every refused form was refused (a pipe, `$(…)`, a subshell, a group,
  a loop's or a branch's body, git's options, `A=1`, `timeout -s KILL 9`, `nice -n 5`, `env -i`,
  `xargs`), and everything else ran: reads outside its folders (`/etc`, `/proc`, `/usr/share`, its
  Read, Glob and Grep tools there too), pipes, loops, a scratch file in `$TMPDIR`, a log in `out/`.
  Its Write tool outside its clone and `out/` was refused. The remote saw no push, and nothing was
  stashed. Its answers are `tests/fixtures/claude-decisions.json`, which the conformance test now
  holds Claude Code to, for exactly the rules its adapter writes and its pinned version.
- **pi 1.0.2** with its gate, against a stand-in model and a stand-in MCP server: the same
  refusals, reads anywhere but its settings, writes only in its folders; a remote tool's header
  filled in from its own environment (`${VAR}`), its look call answered and its act call hidden;
  a `!` header's tool left out and named. Three gaps found and fixed: the gate didn't see past a
  wrapper's options (`nice -n 5 git push` ran); it split a command at a brace inside a word
  (`git -C ${CLONE} push` ran); and a remote server that refused (401) was dropped without a
  word, in pi's output or anywhere but its screen. The gate now names the tools pi didn't get at
  the end, in one entry in pi's output: those its adapter left out (in `gate.json`) and each look
  call pi never got (not connected); the run details say both.

**Also, beyond the plan:**
- pi's gate finds git's verb after git's own options (`-C dir`, `-c k=v`, `--git-dir=…`), so a
  commit message or `git log --grep` with the word `push` runs; it also sees through a loop's or a
  branch's body (`do git push`), a wrapper and its options (`timeout -s KILL 9`, `nice -n 5`,
  `env -i`, `xargs`, `A=1`) and `/usr/bin/git`. Claude Code's deny rules match the words as
  written, so there a commit message with the word `push` is refused (the playbook says to commit
  with `-F <file>`), and `/usr/bin/git push` isn't (the token is the wall).
- A run's notes are said once when several asks repeat them (`mergeReports`).
- `writing-good-tests.md` was left as it is: its "your human partner" lines are quoted examples,
  not asks; the skill's note covers them.
