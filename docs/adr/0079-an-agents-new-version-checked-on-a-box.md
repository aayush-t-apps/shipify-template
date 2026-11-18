---
status: accepted (merged #768; the owner's `go` on 2026-11-17) and built in one PR (task #766); see [As built](#as-built-2026-11-17)
date: 2026-11-17
amends: 0038 (a version moves in a PR that a box checked live, not one made on your PC), 0043 (Claude Code's decisions are recorded by the box, in its agent's record), 0044 (its read-profile decisions, the same)
---

# 0079: An agent's new version checked on a box, so an update is one task

## The plan in short

**Your ask (task #766, a part of #763, 2026-11-17):** "An agent's version moves only in a PR made on
the owner's PC, because its live checks need the agent signed in … So Claude Code is 42 versions
behind. Let a run on a box redo those checks (the pinned-version checks, Claude's recorded
decisions, the selftest) with the agent's own login, as think holds it, never in reach of a
project's code, so 'shipify: update <agent> to <version>' is one task ending in a PR."

**The answer:**
- **Why a PC today:** the live checks need the agent signed in. A run's agent can't do them: its
  login is on a pipe that only its own process reads, so a `claude -p` that it starts has no login.
  That wall is right, and this change keeps it.
- **The change: a check step in the box's own code.** In a work run on Shipify itself, after the
  agent's session and before the box's checks (`ship pr --check`, `make verify`), the box looks at
  the branch. When the branch moves the pin of the agent that the run thinks with, the box installs
  that version and asks it a few fixed questions, with the login as think holds it. Then the box
  writes what it found as the agent's **record** and commits it on the branch.
- **Nothing of the branch runs while the login is out.** The check is main's code, from the job's
  read-only copy of Shipify. From the branch it takes one value, the version, checked as a plain
  version. The branch's code (its tests, its adapter) runs only in `make verify`, after, with no
  login, as today.
- **Installed as the agent's own user, in the run's folder:** never as the runner, whose think step
  holds the record's token, and never in the box's shared tools. The merge and the next run put
  the new version there, as today.
- **The tests hold each agent's record to its pin.** The version numbers written in the tests
  ("check live that …") and `tests/fixtures/claude-decisions.json` go. A pin moved with no record
  fails `pnpm verify` and names the task that makes one.
- **What stays on your PC:** a version whose install changes more than its version, a version that
  needs its adapter changed, and Codex (its session renews during a run). The reply says which one,
  and why.
- **The weekly digest names the task to start:** "claude 2.1.284 → 2.1.326
  (`shipify: update claude to 2.1.326`)".
- **The same idea as lend** (the post that #763 names): the login stays with the one program that
  needs it, and the code around that program can't choose what runs with it.
- **No new key, setting, workflow change or box setup.** The build is one PR, after you merge this
  and say `go`. Merging accepts sections 3 to 5.

## 1. What was checked (main at 323ebb29, 2026-11-17)

| Assumption | How it was checked |
|---|---|
| Claude Code is far behind its pin | npm's `@anthropic-ai/claude-code`, read today: newest 2.1.326; 38 releases after the pin, 2.1.284 |
| The live checks are the version numbers written in the tests, and Claude's recorded decisions | `tests/plugins/agent.test.ts`: `PIPED` (Claude Code 2.1.284 and OpenCode 1.18.34 read their login from fd 3), `SKILLS_HANDED` (each of the four lists Shipify's skills, at its pin), and `claude-decisions.json`, whose `version` the test holds to the pin |
| A run's agent can't start a signed-in copy of itself | `docs/troubleshooting.md`: "A nested `claude -p` started from inside a run can't sign in". The login is on fd 3, a pipe that the agent reads once (`handOver`, `cli/kernel/think.ts`; the sandbox's login probe in `cli/lib/sandbox.ts`) |
| The think step holds the login of the run's agent, and no other | `task.yml`: `SHIPIFY_AGENT_LOGIN: ${{ secrets[steps.plan.outputs.login] }}`; plan writes one `login` (`cli/kernel/run.ts`). A stay's step holds the same |
| The think step's environment also holds keys that a program under check must never see | `task.yml`, Think: `SHIPIFY_ISSUES_TOKEN` (the record's token, for the job), the agent's read token and the tools' look keys |
| The box's checks run the branch's code as the agent's user, with no login | `gate` in `cli/kernel/think.ts`: `place.run` with no `login`, after the agent's asks |
| The box installs an agent as the runner, and Claude Code's install runs its own script | `installAgent` (`cli/lib/agent-install.ts`, `flock sh -c` as the runner); `docs/agents.md` ("Claude Code's runs its install script") |
| Claude Code's first output line says its version, its tools, its helpers and its skills | `tests/fixtures/claude-stream.jsonl`, the `init` event: `claude_code_version`, `tools`, `agents`, `skills` |
| A report says the calls that the agent's rules refused, but not each command as written | `AgentReport.denied` (`cli/lib/plugins/agent.ts`); Claude's reader reads `permission_denials` (`cli/lib/agents/claude.ts`) |
| The box's checks run only when the agent asks for a PR, after its catch-ups, and the fix round comes after them | `think` (`cli/kernel/think.ts`): `gate` under `result.pr`, then one `fixPrompt` round, then `gate` again |
| The job's limit covers think as it is, and a check on the session's own clock needs no new limit | `tests/workflows.test.ts`: the job is at least `THINK_MINUTES` + 30 + 15; `THINK_MINUTES` counts the session's 200 minutes once, catch-ups included |

## 2. Options

- **A: keep it as it is** (the PR made on your PC). (+ nothing to build / − it needs your PC and an
  agent signed in there, so it waits: Claude Code is 38 releases behind; ADR 0075 says nothing by
  hand.)
- **B: the agent checks the version itself, in its run.** (− the agent would need its login in
  reach of its own commands: every command and package of its run could read it. That is the wall
  ADR 0031 built.)
- **C: the live checks in the test suite, with the login in `make verify`'s environment.** (− `make
  verify` runs the branch's code, which the agent wrote: an agent misled by a web page could make
  a test send the login out.)
- **D: a stand-in model, and no login at all.** The new version runs against a local stand-in of
  its API, which makes each call. (+ no login, no use of your plan, the same answer every time / −
  a stand-in of each API to keep up as it changes; it can't show that the real service still takes
  the login, or that a real model loads the skills; your words ask for the agent's own login. pi's,
  OpenCode's and Codex's recorded runs stay stand-in runs, for their readers.)
- **E: a separate job or a fixed word** ("check claude 2.1.326") that checks a version and replies.
  (− a workflow change only you can add, or a second run, and its answer must still reach the
  task's branch.)
- **F: a step of think, in main's code, after the agent and before the box's checks.** (+ one
  task, one run, no workflow change; the login stays where think has it; the branch gives one
  value / − a version that needs its adapter changed still needs your PC.)

## 3. Decision

Chosen **F**. It makes an update one task, and it keeps the wall: no code that the agent wrote runs
while the login is out.

### 3.1 An update, as one task

1. **You start it:** `shipify: update claude to 2.1.326`, or the digest's line. The run thinks with
   the agent it updates: Claude Code is the default; an update of pi or OpenCode says `use pi` or
   `use opencode`, because think holds only its own agent's login.
2. **The agent moves the pin** in `executors.json` (its `version`, the `@x.y.z` in `run`, and for pi
   and OpenCode `--before=` its release day), adds a changelog line, and changes what the new
   version needs in the docs. It commits. It never writes the record: the playbook and the test's
   words say the box writes it.
3. **The box checks it** (3.2 to 3.4), writes the record and commits it.
4. **The box's checks** (`ship pr --check`, `make verify`) hold the record to the pin. A check that
   failed fails them: the fix round tells the agent, and its reply says what failed. No PR opens
   then, and the branch keeps the work for your `continue`.
5. **The PR opens** with the box's commit in it. Your merge moves the pin. The next run installs
   the version into the box's shared tools, as today.

### 3.2 When the box checks

- **A work run on Shipify's own repo that asks for a PR,** right before the box's checks, in a
  stay's turn too. Once a run: when the fix round moves the pin again, the record no longer matches
  and the tests say so; `continue` checks again.
- **The branch's last commit pins another version of the run's agent** than main's
  `executors.json` (the copy's). The box reads the branch's file as data, at most 64 KB, and takes
  only that agent's `install`.
- **The install changed only in its version:** the branch's `run` equals main's with the version
  in `@x.y.z` and the date in `--before=` changed, and the rest of `install` (`bin`, `dir`) the
  same. The version is a plain version (`^\d+\.\d+\.\d+$`), the same in `version` and in `run`,
  and the date a plain date. Else the box doesn't check, and says why.
- **No advisory is listed against the version:** the box reads the install's `advisories` URL for
  it, as the digest reads one for the pin. One listed: not checked, and the reply names it.
- **On the session's clock** (ADR 0059): at most 10 minutes of what's left of the session's 200,
  as a catch-up takes its time. A session that used it all leaves the check to `continue`.
  `THINK_MINUTES` and the job's limit stay as they are.

### 3.3 Where it runs, and what it holds

- **Main's code only:** the adapter, the prompt, the commands and the reader, all from the job's
  read-only copy of Shipify, as every step is.
- **As the agent's own user, in a folder of the run's own** (`check/`): its working folder, its own
  settings folders (so the run's are untouched for the fix round), and a scratch git repo with a
  bare repo in the same folder as its remote (a push that ran reaches nothing), a `Makefile` whose
  `verify` only prints, a `README.md`, a `.ts` file, and an `AGENTS.md` (with a `CLAUDE.md` that
  points to it, as in Shipify's repos) that holds a word made for this check.
- **Installed there** by main's install words with the branch's version, as the agent's user, so
  its install script runs with no key in reach. The folder goes with the run.
- **The login as think holds it:** on fd 3, as think hands it to the agent. The program under
  check gets nothing else: no GitHub key, no look token, no tool.
- **The model:** the agent's first listed model, with no effort (Haiku for Claude Code, as its
  decisions were recorded; GLM 5.3 Flash for pi and OpenCode on OpenRouter).
- **Its output is read by main's reader,** and goes to the run's log as an ask's does, masked.

### 3.4 What it checks

Two asks: the first in the scratch repo, and the second in the read profile, only for an agent that
takes read runs. Each line becomes a field of the record:

1. **It starts and answers:** main's reader reads its output into a report with a model and
   tokens, and the report's `version` is the version under check (the selftest's question, asked
   in the run).
2. **Its login:** it answered with the login on fd 3, and after the asks the login's value is in no
   file in `check/`, nor in the environment that one of its commands wrote to a file.
3. **Its skills:** it lists each skill in Shipify's `skills/`, as its output says (Claude Code's
   `init` event). An agent whose output doesn't list them loads one named skill when it's asked to,
   and its report's `skills` shows it.
4. **The repo's own instructions:** its answer says the word from the scratch repo's `AGENTS.md`.
   This is the check that Claude Code's docs asked for, as `--bare` may become the default for
   headless runs.
5. **Its helpers** (an agent that has them): its output offers them (Claude Code's `Task` tool and
   `agents`).
6. **Its decisions:** its answer to each command of the one list that every agent is held to (the
   test's `SAME`, and the four where the agents differ: `/usr/bin/git push`, `sh -c "git push"`
   and two with the word push in them), run as written with the rules its adapter writes: refused
   or ran. One it didn't try is asked again once, in the same session.
7. **The read profile** (an agent that takes read runs): the tools it's offered, a read in its read
   folder that works, and reads of `/etc/hostname` and of its own `config/` refused.

To say 6 for every agent, each adapter's reader reports each command its agent ran or was refused,
as written (`commands`), and what its agent was offered (`offered`: tools, helpers, skills), when
its output says them.

### 3.5 The record, and the tests

- **One record a program:** `tests/fixtures/checked/<agent>.json` (`claude`, `pi`, `opencode`,
  `codex`; `pi-vercel` and `opencode-vercel` share theirs). It holds the version, the day, the box,
  the run's link, each check's outcome with a short reason when it failed, the decisions and the
  read profile. It holds fixed fields only: never the login, a key, an account's email or an id
  from the output. The box's secret scan checks the commit, as every commit.
- **The box writes it and commits it** as the run's committer: "check: Claude Code 2.1.326, checked
  live (task #n, <run>)". A record that the agent wrote is replaced. After the fix round, the box
  puts its record back if the agent changed it, before the checks run again.
- **The tests:** `tests/plugins/agent.test.ts` holds each agent's record to its pin, each of its
  checks to passed, and its decisions to the one list (as `claude-decisions.json` is held now),
  every adapter the same way. The version numbers written in the test go. A pin with no record of
  it fails with: "checked live on a box: start `shipify: update <agent> to <version>`".
- **The first records** come with the build, from what is checked today: `claude-decisions.json`
  becomes `checked/claude.json`, and the other three state what the test's words state now, each
  marked as checked on a PC, with its date. The next update of each makes a box's record.

### 3.6 What stays on your PC

- **An install that changes more than its version** (a new package, a new `bin`): main's words
  can't install it, and the branch's must not run with the login near.
- **A version that needs its adapter changed:** the box checks with main's adapter. A record made
  with the branch's adapter would let code that the agent wrote choose what runs with the login
  (an address to send it to, say). The reply says that the version needs its adapter changed
  first; that PR is made on your PC, as now (`docs/agents.md`).
- **Codex:** it renews its ChatGPT session during a run (ADR 0074), and a second program that
  refreshes the same session in one run isn't checked live. Its record stays a PC one until a
  later change checks that.
- **The end-to-end selftest** (`pnpm ship selftest <agent>`) stays as it is, for the door and the
  boxes. A version's PR no longer needs it: 3.4's first check asks the question in the run.

## 4. Edge cases

- **The branch moves the pin of an agent that the run doesn't think with:** not checked. The
  agent is told before the box's checks, the tests fail on the missing record, and the reply says
  `use <agent>`, then `continue`.
- **Two pins moved:** the run's agent's is checked; the other as above.
- **A version that isn't plain** (`latest`, a range, a URL): not checked, and the reply says why.
  **A downgrade** (a way back from a broken release) is checked as any other version.
- **The install fails** (no such version, npm down): the record says "didn't install" with npm's
  last line, the tests fail, and the reply says so.
- **Your plan's limit is reached during the check:** the record says the agent's words; `continue`
  later checks again.
- **It doesn't answer in its time:** the record says so.
- **The model skips a command,** also when it's asked again: the record names it as not tried, and
  the test fails on it.
- **A box with no room for the install** (about 233 MB for Claude Code): the install fails, as
  above. The folder goes with the run.
- **Main moves while the agent works:** the finish brings the branch up to date (ADR 0059). The
  record is one file of the agent's own, so it merges unless main's record of the same agent
  changed too; then refresh stops, as for any conflict.
- **A run on another account, a read run, or a guest's run:** never a work run on Shipify, so
  never checked.

## 5. Build plan (one PR, after your `go`)

1. **The agent contract:** the one list of commands moves from the test into the contract
   (`cli/lib/plugins/agent.ts`). The readers report `commands` and `offered` (3.4). The conformance
   test checks each adapter's reader with its recorded run, and an agent's output with them.
2. **The check** (`cli/kernel/agent-check.ts`): the pin read from the branch's file; the install
   compared with main's and its words made; the advisory read; the scratch repo; the two asks; the
   record built from the reports. Its pure parts get unit tests; `think` gets a test with a
   stand-in agent: a moved pin is checked with the login on fd 3, as the agent's user, before the
   box's checks; nothing is checked when no pin moved, when the install changed, or when another
   agent's pin moved; the box's record is put back after the fix round.
3. **The records:** `tests/fixtures/checked/`, the first four (3.5); `claude-decisions.json` and the
   version numbers in `agent.test.ts` removed.
4. **The digest's line** names the task to start, and the playbook says the box writes the record.
5. **Docs** (below), then `make verify`.

## Setup

Nothing to set up. No secret, variable, workflow or box setup changes. To check it after the build:
`shipify: update claude to 2.1.326` (task #767, which waits for this one) runs it end to end, and its
PR holds the box's commit with Claude Code's record.

## Docs and clean-up

- `docs/agents.md`: "On a box", "A new version" (one task: the check, its record, what stays on
  your PC) and "A new Claude Code version"; each adapter's section names "the version its record
  names" in place of a number, so a version moves with no doc edit; "Adding another agent" (its
  reader reports `commands` and `offered`; its first record).
- `docs/roadmap.md`: "Kept current and safe", item 1 goes, and the list is numbered again.
- `docs/security.md`: the login reaches a version under check, in think, as the agent's user,
  before your review; the record holds no secret.
- `docs/troubleshooting.md`: "A nested `claude -p` … can't sign in" points to the box's check.
- `docs/plug-ins.md`: the agent contract's `commands` and `offered`, and the record.
- `docs/tasks.md`: an agent's update, as one task.
- `docs/box-setup.md`: "Time limits" (the check on the session's clock).
- `playbooks/task.md`: on an update, the agent moves the pin and the box writes the record.
- `docs/adr/README.md`: this ADR's row; 0038's, 0043's and 0044's ("amended by 0079").
- `CHANGELOG.md`.
- **Removed:** `tests/fixtures/claude-decisions.json`, its `how` (recorded on a PC), and the
  version numbers that `agent.test.ts` writes.

## Consequences

- **Easier:** an update is one task and one PR that you merge. Each agent's record says where and
  when its version was checked, in the PR's diff.
- **The same:** the login's wall in think, the box's checks, the shared tools and their install,
  and the end-to-end selftest.
- **Harder:** a run that moves a pin takes a few minutes more (the install, two short asks) and a
  little of your plan. The readers report two more things.
- **New, said plainly:** a version gets the login during the check, before your review of its PR.
  Before, it got the login after your merge. The package and its install words are main's, the
  version has no advisory, and the walls are think's (its own user, no other key, the network as
  think's), so a bad release reaches what it would reach after the merge, only sooner.

## Confirmation

- The conformance test: each reader's `commands` and `offered` from its recorded run, and each
  record held to its pin.
- `think`'s test with a stand-in agent: the cases in step 2 of the build plan.
- Task #767, on a box: Claude Code's record, made by the box, in its PR, and `make verify` green on
  it.

## Decisions for you

None open. Merging accepts sections 3 to 5, and `go` starts the build.

## As built (2026-11-17)

One PR, as section 5 says. What the build settled:

- **Where it is:** `cli/kernel/agent-check.ts` (`checkPins`), called by `think` right before
  `gate`, under `result.pr`, in a work run on Shipify's own repo (never another account's). The
  fix round's prompt starts with what it found (`fixPrompt`'s `told`), and `again()` writes the
  box's records back after that round.
- **The one list:** `DECISIONS` in `cli/lib/plugins/agent.ts`: 18 refused, 13 run, and the 4 where
  the agents differ. In the core, it names no project file: `jq .version shipify.json` stands
  where the test had `jq .version package.json` (`tests/core.test.ts`), and Claude Code's first
  record says so; the same rules decide both. Each reader reports `commands` and `offered`. Claude Code's also reports
  `said` (its last words, when it answered in words): the check reads the word from them.
- **The branch's file:** `git cat-file blob work:executors.json`, as the agent with no key and
  `GIT_NO_REPLACE_OBJECTS=1`, read up to 64 KB as data (`pinsMoved`). The new install's words are
  main's with `@x.y.z` and `--before=` changed, and must equal the branch's word for word.
- **Only the box writes a record, wider than 3.5 said:** when the branch moves a pin, that agent's
  record is the box's own when it checked it, else main's (the job's copy's) put back, so a record
  the agent wrote can't make the tests pass for a version no box checked.
- **The folder:** `check/` in the run's folder, made fresh as the agent: `home/` (its HOME, npm's
  cache and XDG folders), `tmp/`, `config/`, `tools/` (the adapter's settings, from a runner
  folder of its own, `check-tools/`), `agent/` (the install's prefix), the scratch `repo/` with
  `remote.git/` beside it, and the read profile's `read/`, `files/` and `elsewhere/`. Its rules
  files (`cleared`) and the skills link are removed before each ask; the read ask has no skills.
- **The read profile's refusals, seen in its answer:** a file of the check's own outside its
  folders (`elsewhere/note.txt`) stands in for `/etc/hostname`, beside one in its own `config/`.
  Each read file holds a word made for the check: the two inside its folders must be in its
  answer, and the two outside must not.
- **The login's search:** `cat <&3 | grep -rlF -f -`, so the login comes on fd 3 as the agent got
  it (off a box fd 3 is a socket, which `/dev/fd/3` can't open), and leaves out what its install
  made before it held the login: `agent/`, where the install also has a HOME of its own, so its
  installer's cache is there. Off a box the test's own environment
  reaches the agent; on a box `env -i` starts it with none.
- **Skills:** each of `skills/` in its output's list (Claude Code's `init`), or, for an agent whose
  output lists none, `verification-before-completion` loaded when it's asked to (the open question
  of the handoff: pi's and OpenCode's lists aren't read). Helpers: only when its output says them.
- **The record's file:** written as the repo's formatter writes JSON (`formatted`: a list on one
  line when it fits in 100 columns), so it passes `pnpm format:check`; a test holds it to biome's
  own output. Its `argv` (the adapter's words, the folders as `<check>` and `<skills>`) replaces
  `claude-decisions.json`'s `rules`: the conformance test reads Claude Code's command rules and
  read flags from it.
- **The first records:** `claude.json` from `claude-decisions.json` (with the login and skills
  checks of 2026-10-10), and `pi.json`, `opencode.json` and `codex.json` with what the test's words
  said was checked live, each `"on": "pc"`.
- **The check's tokens** aren't added to the run's own counts (a second session would muddle a
  stay's), and its line in the run's details says them.
- **Once a turn:** the box keeps no mark of an earlier check that the agent couldn't forge, so a
  stay's turn that commits again and asks for the PR checks the version again. A turn that commits
  nothing asks for no PR, so it checks nothing.
- **pi and OpenCode** get their gateway as think gives it, and their key through Shipify's gate on
  fd 3. Their path is built but not yet run live: the first `use pi` update is its first check.
- **Not yet live:** the tests use a stand-in for the new version (`tests/fixtures/fake-checked.mjs`:
  its install, Claude Code's stream, the gate's decisions). Task #767 is the first live check.

## Sources

- The run of this task: `tests/plugins/agent.test.ts`, `cli/kernel/think.ts`,
  `cli/lib/agent-install.ts`, `.github/workflows/task.yml`, `docs/agents.md` (section 1).
- npm's registry, `@anthropic-ai/claude-code` (read 2026-11-17):
  <https://registry.npmjs.org/@anthropic-ai/claude-code/latest>
- "Running agents with lend" (the post that #763 names):
  <https://blog.antonio.cx/running-agents-with-lend>
- ADR 0031 (the agent's own user), ADR 0043 and 0044 (the recorded decisions), ADR 0059 (the
  session's clock), ADR 0074 (Codex's session), ADR 0075 (nothing by hand).
