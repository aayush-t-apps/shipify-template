---
status: accepted (merged #251) and built (one PR, the owner's `go` on 2026-10-09); the owner's decisions are recorded below; see [As built](#as-built-2026-10-09)
date: 2026-10-09
amends: 0031 (the talk profile no longer clones every project)
supersedes: task #248's designs v1 and v2 (`shipify-files`, task-248/), whose checked faults are listed below
---

# 0044: Any GitHub repo: read what you name, change a repo its own way

Proposed from the owner's requests on task #248 (2026-10-08): Shipify should work with any GitHub
repo, efficient and robust for large ones ("simple shallow clone, whatever makes it efficient and
robust for large repos"). The core stays separate from the projects it serves, with strong rules
and a clean process end to end. Today's flows work and must not regress. The ask was research
first, then a design tested end to end. Merging this PR accepts the design, and `go` starts the
build.

## The plan in short

Five rules. Each one replaces a special case:

1. **A read is a snapshot; a change has history.** A repo read to answer a question is a depth-1
   clone. A repo a run changes keeps today's full clone. Apply's own clone fetches history without
   file contents and checks out only the files it checks. Each clone's shape follows from what the
   run does, never from a setting.
2. **Your words name what's read.** `look at <repo>` reads any repo. A plain question clones
   nothing up front: the agent clones one of your projects only when the question needs its code.
3. **Trust follows the repo's owner, not a command list.** ADR 0043 drops the list, which was never
   a wall. A run that reads a repo outside your account runs in a third profile, **read**: the agent
   reads files and hands back its answer as today. It gets no command, no web, no key, and no file
   outside the repos it was given. That removes both the way to your data and the way out (the
   "lethal trifecta"). Its notes and calls wait for your yes, as after the web.
4. **Any repo in your account, changed its own way.** `<repo>: …` works on any repo in your
   account, as `<project>: …` does on a project. Its rules come first: its own docs, commands and
   CI. Shipify's process rules come on top: its own branch, a PR, you merge. Shipify adds none of
   its own files to the repo unless you ask. No new kind, word, stack or file.
5. **One way to run git.** One module builds every clone's arguments and environment: the key in
   the environment, never on a command line, plus the safe settings. Think, apply and the jobs all
   use it. It's tested against a real git server that serves partial clones and checks what arrives.

## What it never does

- **It breaks no flow that works today.** A change run, a carry-on run, `ship refresh`, kept work,
  `continue`, version checks, PRs, previews, deploys, a new project's first push, and `ship pr` /
  `ship sync` on the PC all keep their behaviour. The change run's clone is today's clone. Only its
  URL and the way its key travels change.
- **It adds no key, secret, service, store, setting or intent.** The six intents stay six. Many
  owners, and a firewall for the agents, stay on the roadmap.
- **It never runs code on the box's own side for a repo you don't own:** no setup and no checks for
  a look.
- **It puts no token on a command line,** and it fixes the one that's there today.
- **It adds nothing of Shipify's to a repo that isn't a project:** no `shipify.json`, workflow,
  Makefile, hook or agent file, unless you ask for one.

## What was found (checked 2026-10-08, against `main` at `bf47409`)

Experiments ran on git 2.43, the same as homepi (Ubuntu 24.04). They used the private spotter repo,
a local `git daemon` with `uploadpack.allowFilter`, and a local HTTP server that logs the headers
it receives.

| Found | Evidence |
|---|---|
| Every talk, recipe and repeat run clones up to 30 projects at depth 50, needed or not (37 MB on task #248's run) | `think.ts:690`, `:708-711` |
| Today's clone puts the read key in git's command line. homepi's `/proc` has no `hidepid`, so another slot's user can read it with `ps` while the clone runs | `think.ts:689`, against `sandbox.ts:16` ("Nothing secret goes on a command line") |
| Apply clones the whole repo, then checks out the whole tree to scan a few files | `apply.ts:565-573`, `:646`. Measured on spotter: 23 MB, or 384 KB with only the changed files checked out |
| **v2's blobless change clone breaks on private repos** (all four repos are private). The key reaches only the clone itself, so every later fetch of a file's contents fails with "could not fetch … from promisor remote": `git log -p`, `blame`, content diffs, `diff --stat main...work`, `show <old>:file`, and the box's own `ship refresh` (`git show <merge-base>:shipify.json`, the merge) | tested on spotter, with the key withheld after the clone; `workspace.ts:543`, `:570` |
| Even with the key everywhere, a blobless clone fails late: the agent's key lasts one hour, and a change run's clocks add up to 192 minutes | `task.yml:204-218`, `THINK_MINUTES` |
| **v2's `--single-branch -b main` breaks three paths.** A carry-on run: a plain `fetch origin <branch>` leaves no `origin/<branch>`. Apply's `onBranch`. A new project's first build: `clone -b main` of an empty repo fails | tested; `think.ts:704`, `apply.ts:687-697` |
| v2's read-only command list for looks contradicts ADR 0043 and isn't a wall. The login and keys are in every child's environment (`cat /proc/self/environ`, `node -e`), and the web stays on | `sandbox.ts:222-227`, `think.ts:86-92`, `claude.ts:93`, `security.md:86` |
| **A repo can run code through git itself.** A bare repo committed inside a repo, with `diff.external` in its config, runs that command when the agent types `git diff` in its folder, with no file needed. A symlink in a checkout reads a file outside it (`cat notes.txt` printed this PC's `/etc/hostname`) | tested. `safe.bareRepository=explicit` stops the first and `core.symlinks=false` the second |
| v2's `-c http.extraheader=` doesn't cancel a key scoped to a URL: the test server still received `Authorization` | tested. Only an environment built from nothing sends no key |
| Repo names are cut short in places. The repo output a run hands its write-key step must match `[a-z][a-z0-9_-]{0,40}`. `repoOf(url)` stops at a dot. More one-owner sites exist than v2's 8 | `run.ts:59`, `github.ts:97-100`; the full list is in build step 1 |
| GitHub's `size` is the compressed history, not what a read fetches. git/git says 321 MB: depth 1 fetched 14 MB, blobless 129 MB, a full clone 312 MB | measured |
| Claude Code 2.1.284 (pinned) has a reading-only mode: `--restricted` removes Bash, the other code-running tools and WebFetch unless `--tools` names them, and keeps the file tools inside the working directories. pi 1.0.2 has `--tools` and `--no-context-files` | run live on the pinned Claude Code (§2); pi's `--help` |
| GitHub has throttled anonymous HTTPS clones since 2025-05-08, with no published numbers | GitHub's changelog |
| `GIT_LFS_SKIP_SMUDGE` and `core.hooksPath` add nothing to a clone: the Pi has no git-lfs, and a clone never carries hooks | checked on homepi; git's docs |

## Options for the clone, measured

On this PC, single branch, no tags (homepi's numbers come from the build's live check):

| Shape | git/git (321 MB on GitHub) | spotter | What it breaks |
|---|---|---|---|
| depth 1 | 12.7 s · 14 MB of history + 62 MB of files | ~ the same as full | history: `log` shows one commit; no merge base |
| treeless (`tree:0`) | 14.3 s · 50 MB | | every `log -- <path>` and old diff fetches trees: not for work |
| blobless (`blob:none`) | 21.5 s · 129 MB | 17 MB | each read of an old file needs a live key: none without it, none after its hour |
| full (today) | 44 s · 312 MB | 17 MB | nothing |

**Chosen, by use:**
- **a read is depth 1:** the smallest, and it never fetches again, so no key is needed after the
  clone;
- **a change is full, as today:** your repos are small (spotter's full clone is the same 17 MB as
  blobless), and full is the one shape with no late failure;
- **apply's clone is blobless, with no checkout:** its key is minted just before it, every git
  command it runs already carries the key in its environment (`apply.ts:510-517`), and it lasts
  seconds.

## Decision

### 1. Reads: the talk profile

- **`look at <repo>[, <repo>…]`** anywhere in a message, the way `use` is read. A `<repo>` is a
  project id, an `owner/name` or a `github.com` link.
  - The box clones each one before the agent starts: depth 1, single branch, no tags, into
    `read/<owner>/<name>`. `read/` is a run folder of its own beside `work/`, so a read never lands
    inside a change run's clone, where `make verify`'s lint and tests would see it.
  - Your repos are cloned with the run's read key in the environment. Anyone else's public repo is
    cloned anonymously.
  - A later message on the same task can name more.
- **A plain question clones nothing.** The prompt lists your projects and the one line that reads
  one: `gh repo clone <owner/name> read/<id> -- --depth 1 --no-tags`. gh signs git in from the run's
  read key itself, checked here with no git config at all. The agent clones a project when the
  question needs its code, so nothing a talk run answers today is lost, and nothing is fetched
  otherwise. (Decision for you 1.)
- Shipify's own code stays readable as today (its copy per commit).
- **Gone:** the clone of every project at depth 50, and "every project read-only" in the profile.

### 2. A repo outside your account: the read profile

A repo you don't own is data. A prompt injection needs three things: your private data, the
untrusted text, and a way out. The read profile leaves only the text. A command list can't do that
(ADR 0043: `cat /proc/self/environ` and `node -e` reach the login, and the web stays on). What the
agent can *use* can.

- **The read profile:** the agent reads files, and nothing else. It's a third profile beside talk
  and work. The core asks for it the way it asks for the web: the agent contract's `Commands` gains
  `run: false` beside `web: false`, and each adapter writes that as its agent's rules:
  - **Claude Code** (2.1.284, run live here): `--restricted --tools Read,Grep,Glob`. The run had
    exactly Glob, Grep, Read and StructuredOutput, so its answer still came back in the result's
    shape (`--json-schema`). Reads of `/etc/hostname` and `../../` were refused as outside its
    working directory. A README telling it to run a command and fetch a URL had no tool to do
    either. Its other rules are flags already (`--allowedTools`, `--add-dir`), so nothing moves;
  - **pi** (1.0.2, its `--help` checked): `--tools read,grep,find,ls --no-context-files`, so a
    repo's `AGENTS.md` or `CLAUDE.md` is never loaded as instructions. Its gate keeps reads inside
    the run's folders, with symlinks resolved. Its answer comes back as its final message in the
    result's shape, as today;
  - **its folders:** `read/` and Shipify's copy, to read. It writes nothing.
- **No key at all.** The agent's environment gets no `GH_TOKEN` and no tool look keys, and the read
  tools can't reach the login it starts with. The box keeps reading the task with its own key, for
  `stop` and catch-ups (`run.ts:272`).
- **The box makes the clone from nothing,** as the slot's own user, into `read/`: an environment
  with no key and no credential helper, `GIT_TERMINAL_PROMPT=0`, anonymous, depth 1,
  `-c core.symlinks=false`, no submodules. A link in the repo is checked out as a plain file,
  whatever the agent's tools do.
- **`readOutside` is set.** Notes and pre-approved calls from the run wait for your yes, as after
  the web (`decide.ts:1645-1672`).
- **Its reply carries nothing out.**
  - The secret mask runs as today.
  - Images in a reply from any run that read outside content become plain links: GitHub's image
    proxy would fetch them when the task is viewed, and a URL can carry data.
  - Telegram's link previews are already off (`telegram.ts`, on every send).
- **Nothing runs on the box's side for it:** no `make setup` and no checks. Its folder goes with the
  slot's next run, as every run folder does.
- **What it can't do:** run the repo's code. Running code is for repos in your account: your
  projects and your other repos.

### 3. The size check (in plan, before any clone)

- **The size:** for your repos, from the project list each run already reads (no call). For anyone
  else's, one anonymous `GET repos/{o}/{r}`. A 404 says "not found, or private: Shipify reads
  another account's private repos only once it's installed there (left for later)".
- **The one limit is the disk, measured, not guessed.** Doctor's 5 GB floor (`doctor.ts:52`) is
  the line, checked twice with real numbers:
  - **before any clone**, in plan: GitHub's `size` must leave the floor free. It's the packed
    history, so it's the most any clone downloads (a depth-1 read downloads less);
  - **before a read writes its files:** the read clones with `--no-checkout`, sums its files' sizes
    (`git ls-tree -r -l HEAD`), and checks them out only if they leave the floor free. A change
    clone stays today's single clone.

  Either refusal is told once, with the numbers: "acme/big's files are 9.2 GB, and this box has
  12 GB free, 5 of which it keeps".
- **No other threshold, and no `anyway` word.** The clone clock (5 minutes) is the bound. A clone it
  stops is told with its size, and its folder goes.

### 4. Changes

- **The change run's clone is today's clone,** with two differences: its URL comes from the
  project's repo, and its key travels in the clone's environment, not its arguments.
- **Apply's clone:**
  - `--filter=blob:none --no-checkout --no-tags --single-branch`, of `main`;
  - then the task's branch, fetched by refspec (`+refs/heads/<b>:refs/remotes/origin/<b>`), so
    `onBranch` and the bundle's base are there;
  - then a sparse checkout of the changed files, `shipify.json` and `.github/workflows/`, so the
    secret scan and the workflow check read what they read today;
  - a new project's first push (an empty repo, no `-b`) checks out everything, since all of it is
    in the bundle.

  Measured on spotter: 23 MB becomes 384 KB, with one small fetch. The push itself fetches nothing.

### 5. Any repo in your account: its rules first, then ours

- **The words are today's:** `<repo>: …`, as `<project>: …`. A name that's a project is a project,
  as today. A name that's another repo in your account (in the App's installation, not archived)
  starts a change run on it. Today such a title is read as a plain question
  (`decide.ts:789-791`). Any other name is still read that way, and `shipify: …` stays Shipify's
  own, as today.
- **The run is a change run, as for a project:** today's full clone, the task's own branch, kept
  work and `continue`, all as today.
- **Its rules first.** The playbook tells the agent to read and follow the repo's own rules before
  anything else: its `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, README, its commands (package.json,
  pyproject, go.mod, Cargo.toml, a Makefile) and what its CI runs. It sets up and tests the repo the
  way those say, and the PR says what it ran.
- **Then Shipify's rules,** the ones every change keeps:
  - a PR on the task's own branch. The box never pushes to `main` (`apply.ts:560`), and you merge;
  - the secret scan before the push;
  - no workflow file changed: the box refuses a PR that touches `.github/workflows/`, since a
    repo's CI runs with its secrets. You change it yourself; a project's changes only through `ship
    upgrade`, as today;
  - nothing of Shipify's added (the line in "What it never does").
- **Its checks are its own.** It has no Shipify contract, so the box runs no `make verify` and no
  `ship pr --check` (those are a project's), and the repo's own CI checks the PR. A repo with no CI
  is said so in the PR, with what the agent ran.
- **Nothing else changes.** It isn't deployed, released, listed on the status page or synced to the
  PC. Due, the watch and Operate take only projects, as today.
- **The core adds one lookup and one branch,** both on the contract's own line. The snapshot keeps
  the repos the project list already fetches (`projects-on-github.ts` drops those with no
  `shipify.json` today). The gate runs a project's checks only for a project.

### 6. Names: a project carries its repo

- `Snapshot.projects` carries `{ id, repo, sizeKB }`, and `Snapshot.repos` the other repos in your
  account (`{ name, repo, sizeKB }`), from the one list it already reads, with no new call.
- **One function, `repoFor(name)`,** gives a project's or a repo's `owner/name`. It replaces every
  hand-built URL and every bare id passed as a repo. The name `repoOf` already means a URL's
  `owner/name`. Build step 1 lists every site.
- A repo name is checked as `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, without `.`, `..` or a
  `.git` ending. It's passed to git as an argument, never pasted into a script. The run's repo
  output and `repoOf(url)` take the same pattern.
- **A name stays a plain word** (`[a-z0-9][a-z0-9-]*`, any case), because `<repo>: …` needs one,
  as `<project>: …` does today. A repo whose name has a dot can't be named that way yet (left for
  later).
- One owner stays, as `task.yml`'s `repository_owner`. Many owners is left for later, and
  `repoFor` is its seam.

### 7. One way to run git

- **`cli/lib/clones.ts`:**
  - `cloneArgs(shape, repo, dir, branch?)`, where the shape is `read`, `change` or `apply`;
  - `gitEnv(key?)`: an environment built from nothing (`PATH`, `HOME`, `GIT_TERMINAL_PROMPT=0`,
    the key as `GIT_CONFIG_*` when there is one), plus the safe settings apply already uses
    (`core.hooksPath=/dev/null`, `core.fsmonitor=`, `protocol.file.allow=never`);
  - the read shape outside your account adds `core.symlinks=false`.
- `safe.bareRepository=explicit` isn't needed: the hostile bare repo needs a git command, and the
  read profile has none. Your own repos are trusted already.
- **Its users:** think's clone (as the agent's user, through `place.run`, with the env and not
  argv), apply's `git()`, and the GitHub jobs' environment (`github-job.ts:173-188`).
- **No new idea:** the module is apply's pattern, made the only one.

### 8. Words and help

- **`intents.json`:**
  - `question` gains the words `look at <repo> …`;
  - `change`'s words say `<project or repo>: …`;
  - one help example each.
- **No new chat command:** the words work in every channel (`/ask look at …`). `look at` is read
  by one function next to `parseTitle`, so the door and the box can't disagree.
- `look: …` keeps meaning a project named "look", as today.

## Edge cases

- **A `look at` with one bad name among three:** the others are read, and the reply names the bad
  one and why (not found, private elsewhere, too big for the disk, stopped by the clock).
- **A renamed repo:** GitHub redirects, and git follows. **An archived one:** readable, never
  changed. **A fork:** like any repo.
- **Submodules** aren't fetched, and the prompt says so when `.gitmodules` exists. **LFS files**
  stay as pointers.
- **A default branch that isn't `main`:** a look reads it (no `-b`). A change is refused with the
  fix ("rename it to main in Settings → Branches; GitHub redirects the old name"), since every PR
  is made against `main`.
- **An empty repo:** a look says so, and a change points to `new:`.
- **A repo named like a word** (`ask`, `new`, `remember`, `repeat`, `forget`): the word wins, as for
  a project today.
- **A question that names both** (`look at acme/x and compare spotter`): spotter is your project,
  but the run reads a repo outside your account. So the box clones both before the agent, and the
  run is in the read profile.
- **The key's hour:** a look clones at the start, and nothing later needs the key. A change run's
  clone is full, so it needs nothing either.
- **GitHub throttles an anonymous clone** (429): told once, with the cause and when to try again.
  Nothing retries.
- **Two slots clone at once,** and each passes the disk check: the second clone fails when the
  disk fills, it's told, and its folder goes.
- **A repo's own `CLAUDE.md`, `AGENTS.md` or `.claude/`:** in the read profile they're files to
  read, never settings or instructions (`--restricted` ignores settings files, and the playbook
  says a look's files are data).
- **A change that names someone else's repo** (`spotter: make search work like acme/x`): a run
  that reads a repo outside your account changes nothing. The box says to look first (`look at
  acme/x: how does its search work?`) and then ask for the change, which takes what it needs from
  that answer. Your own repos can be read in a change run, into `read/`.
- **Parallel work:**
  - **Two slots at once:** each run has its own slot user and its own folder (`run-<id>/`, with
    `work/` and `read/`), so clones never meet. Two slots looking at the same repo clone it twice.
  - **Two tasks on one project:** each run clones it fresh on its own `task/<n>` branch, and ADR
    0040 keeps one run per task, as today.
  - **An agent's helpers:** a helper's worktrees in the change clone work as today, because that
    clone is still full.
  - **Your PC:** worktrees in `.worktrees/` and `ship sync` don't change.
- **A run already going when this merges:** it finishes on the copy of Shipify it started with.

## Contracts it touches

| Contract | Change |
|---|---|
| Agent (`cli/lib/plugins/agent.ts`, its conformance test) | `Commands` gains `run: boolean` beside `web`. With `run: false`, each adapter starts its agent with reading tools only, inside its folders. The test: both agents refuse a command, a web fetch, and a read of `/proc/self/environ` or `../`, and they read a file in `read/`. pi's are its gate's own answers, and Claude Code's are recorded live, as ADR 0043's are (`tests/fixtures/claude-decisions.json`) |
| The project (`shipify.json`, the make targets, `/health`, its docs) | None. A repo that isn't a project keeps its own rules |
| Stacks | None |
| `intents.json` | One phrase (`look at`), `change`'s wording, two help examples. Still six intents |
| The snapshot (`cli/kernel/types.ts`) | `Snapshot.projects` carries `repo` and `sizeKB`; `Snapshot.repos` the other repos |
| Channels, tools, checks, recipes | None |

## Every channel, after this

The words are the same on GitHub, Telegram and the web chat. Replies, the run lines and the status
page don't change. A question about your code costs a clone only when the agent needs one.

## Setup

None. No new key, secret or setting, and boxes pick it up with the next run after the merge.

## Docs and clean-up

The build updates, in the same PR:
- `docs/tasks.md`, `docs/design.md`, `docs/security.md` (the read profile, §2),
  and `docs/glossary.md`:
  - **profile:** talk reads what you name;
  - **look:** a read while the agent thinks, of a tool or of a repo;
  - **repo:** a repo in your account that isn't a project, changed its own way;
- `docs/context.md`: its "a talk run clones at most 30 projects" line goes;
- `docs/agents.md`, `docs/plug-ins.md` and `plugins/_template/agent/` (the read profile);
- `playbooks/task.md`: how a talk run reads a project, and a repo's change (its rules first, then
  ours);
- `intents.json`'s help, and `README.md`'s "what you can ask";
- `CHANGELOG.md`, `docs/roadmap.md` (many owners; the firewall, for talk and work runs), and the
  ADR index.

Code it removes: the 30-project clone loop, `--depth 50`, the key in git's arguments, and every
hand-built repo URL.

## Build plan (one PR; each step test-first, ending with its tests, clean-up and docs)

1. **Names.**
   - `Snapshot.projects` carries `repo` and `sizeKB`, `Snapshot.repos` the other repos, and
     `repoFor(name)` goes in at every site:
     - `think.ts:685-687`;
     - `apply.ts:384/561/730`;
     - `commands/task/deploys.ts:32/109/187`;
     - `github-job.ts:177`;
     - `snapshot.ts:251`;
     - `decide.ts:575/1610/1623/1760/1765`;
     - `run.ts:59/94-97`;
     - `review.ts:22`;
     - `edge/src/page.ts:208`;
     - `github.ts:97-100`.
   - Tests: a repo that isn't a project, and names with dots and capitals in `owner/name`.
2. **`clones.ts`.** Think's clone, apply's `git()` and the jobs move onto it; the key leaves argv.
   - Tests: the git-daemon suite (`tests/kernel-flow.test.ts`) with `uploadpack.allowFilter` on,
     asserting missing objects with `rev-list --missing=print`;
   - an HTTP server that records headers, showing that a key goes only where it's meant to;
   - a clone's arguments never hold the key.
3. **Reads.** `look at` is parsed, plan's size check runs, each run gets a `read/` folder
   (`sandbox.ts:496`), the box clones into it, and the talk profile and prompt change. The
   30-project loop goes.
4. **Outside your account: the read profile.** Both adapters, the agent conformance test, no key in
   the agent's environment, `readOutside`, the clone made from nothing, and images as links in
   replies that read outside content.
   - Fixture repos: a symlink out, a submodule, an embedded bare repo, and a README telling the
     agent to print its environment and fetch a URL.
5. **Apply's small clone:** blobless, the task's branch by refspec, a sparse checkout, and the empty
   repo case.
6. **A repo's change:** `Snapshot.repos`, decide's change run on a repo, the gate's project checks
   only for a project, apply's rules (no workflow files, the secret scan), and the playbook section.
7. **Docs** as listed above, plus a full docs pass.

**Done means** (each step):
- **clean:** no leftovers, and the words match the glossary;
- **well tested:** unit, conformance, end to end against the fakes, then live;
- **properly handled:** every failure is told once, names its fix, and is never silent;
- **configured:** nothing to set up, which `ship doctor` confirms.

## Confirmation: the live checks on homepi before the PR

- **A plain question:** no clone in its log.
- **A question about spotter's code:** the agent clones spotter itself.
- **`look at aayush-t-apps/spotter`,** then **`look at git/git`:** timed and sized on the Pi, the
  second run holding no key.
- **`look at`** a repo bigger than the disk check allows: told, with nothing cloned.
- **`look at`** a public test repo whose README asks the agent to print its environment and fetch a
  URL: the run answers and leaks nothing, and the log shows the refused tools.
- **`<a test repo>: <a small change>`** on a repo with no `shipify.json`: the agent follows the
  repo's own docs and tests, the PR is on its own branch, its CI runs, and nothing of Shipify's is
  added.
- **Parallel:** two looks in two slots at once, and a change run on spotter while another task
  changes spotter too.
- **The regression set, as today:**
  - a change on spotter;
  - a carry-on run that refreshes;
  - `continue` after a stop;
  - a preview;
  - a new project's first build (`publish`);
  - a release.

## Left for later

- **Making a repo a full Shipify project** (`shipify.json`, the pipeline, deploys): when you ask
  for it, as its own design.
- **Many owners** (v2's ADR 0045 sketch): an owners list, the App on *Any account*, and one key per
  owner. `repoFor` is the seam. Proposed when you have a second owner.
- **Partial clones for change runs on very large repos:** once a run's key can outlive its hour (the
  roadmap's "a read token right before the agent" and "token minting off the box").
- **The agents' firewall** (roadmap), for the other profiles. They still have the web and their
  login in reach, as today.
- **Claude Code's `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`** for talk and work runs: it hides the login
  from the commands the agent runs. It needs a live check first: it runs Bash in its own PID
  namespace, and Ubuntu 24.04 restricts unprivileged namespaces.
- **`ship sync` blobless on the PC, sparse checkouts for monorepos, the project list over
  GraphQL:** none pays at today's sizes.

## Decisions (the owner's, 2026-10-08)

1. **A plain question about your code:** the agent clones the project when it needs it. Not chosen:
   only when your words name it.
2. **Another repo in your account:** Shipify changes it its own way, and adds none of its own files
   unless you ask ("adopt their code rules first, then our rules"). Not chosen: an adopt PR adding
   `shipify.json`, Makefile targets and the pipeline (the first draft of this ADR).
3. **Many owners:** a roadmap line now, and a design only when there's a second owner. Not chosen:
   v2's ADR 0045 as a proposed doc now.

## As built (2026-10-09)

One PR, as planned. Where it differs from the text above, and why:

- **The snapshot:** `Snapshot.projects` stays the projects' ids, as every caller reads it.
  `Snapshot.repos` lists every repo a task can name, the projects too, with GitHub's size and its
  default branch. All of it comes from the one list each run already read, with no new call.
- **Plan looks each outside repo up once,** in its snapshot: one GET per `owner/name` the task's
  words look at that isn't yours, with plan's read key (any App reads a public repo). So a word
  that's a file's path (`look at src/App.tsx`) is only a word and changes nothing about the run,
  and anyone else's repo is read under GitHub's own name, its size known. The disk is checked in
  the read step, on the box, right before each clone, so decide stays data in and decisions out.
- **A repo whose default branch isn't `main`** is refused wherever a run would start on it: from
  your words, its run tells you to rename it and changes nothing; work a talk run found, or a fix,
  is refused with the same words and no run. This needed each repo's default branch from the
  list.
- **Git's safe settings** (no hooks, no fsmonitor, no file://) go with apply's git, which runs
  inside a clone of its own. A fresh clone (a change's, a read's) and the GitHub jobs' release
  clone get only their key (and the jobs the bot's name), as before; those settings add nothing
  to a fresh clone. `safe.bareRepository` isn't needed, as above.
- **The status page's repo link** (`edge/src/page.ts:208`) stays `owner/id`: it lists apps only,
  and the edge gets each app's id and address from the due run, never its repo. Naming it through
  `repoFor` would change that contract for a repo prefix nobody uses (it's empty).
- **The read profile writes nothing:** its answer comes back in the result's shape (Claude Code's
  StructuredOutput tool, pi's final message), so neither agent gets a write tool.
- **pi in a read run** reads and lists files: its grep and find need `rg` and `fd`, which a box
  doesn't have, and a read run has no bash to search with (roadmap).
- **Reads come from all of the task's words** (its title, its description, your messages). Every
  run of the task reads them again, since its conversation carries what they said: a scheduled
  run of a task that reads someone else's repo is a read run too, and a read run sets no repeat
  (your own `repeat: …` does).
- **What a name stands for is decided in one place** (`named` in decide), wherever a run starts on
  it: your words, work a talk run found, a fix for a PR's failed checks. A merged plan's new project
  stays a project though its empty repo has no `shipify.json` yet; another of your repos keeps its
  own rules (no project checks, no preview) and must have `main` as its default branch; any case
  matches, and the repo list's own name is used.
- **Images are made inert where the reply is posted,** in every field (its text, its question, its
  answers, the outcomes): a markdown image's `!` is escaped and an HTML tag that fetches is shown as
  text, for every run that read outside content. A read run's folders are `read/` and your files
  (when you sent some), never Shipify's copy.
- **Two independent reviews** found eleven issues in the first build and twelve in its fixes. All
  are fixed here, with tests. Among them:
  - the publish run above;
  - a path after `look at`;
  - repeats out of the read profile, and images: made inert everywhere, as a guess at code fences
    let some through;
  - the other ways a run starts on a repo, with own rules kept on the task (`ownRules`);
  - a lookup GitHub couldn't answer: the run only reads;
  - a change run reading your repos;
  - case, previews and the read step's causes;
  - files sent to a read run while it works;
  - a read prompt with only what it can do, and none of your notebook.
- **Tests:**
  - unit: names, `look at`, the clone shapes, the key only in the environment, the disk;
  - the read step against local repos (yours, someone else's with a link and submodules, missing,
    too big);
  - a recording `git` showing the clone's key never in its arguments;
  - the read profile through the real adapter;
  - a repo change with no project checks;
  - apply's sparse checkout with literal names;
  - the end-to-end flows against a git server that serves partial clones.

  The agent conformance test holds both adapters to the read profile's decisions; Claude Code's
  are recorded live (`tests/fixtures/claude-decisions.json`'s `read`).
- **The end-to-end tests that failed now and then,** already on `main`, had one cause:
  - a run's seconds came from the wall clock, which stepped back hours on this PC under load;
  - so the reply's line failed its check ("Something went wrong: [");
  - a box's clock can step too (an NTP fix);
  - a run is now timed on the monotonic clock, and a test steps the wall clock back.
- **The live checks** (Confirmation) run on homepi after this merges: a task's event runs
  `main`'s code on the box. Claude Code's read profile was run live on this PC, on the pinned
  version.
- **Left for later:**
  - a recipe's own `look at`: its body isn't among the task's words;
  - images in a PR's body from a work run that read the web: only replies are made inert.

## Sources

- **Measurements and tests:** this ADR's "What was found" and "Options". The scripts ran against
  spotter, a local `git daemon` and a header-logging HTTP server.
- **Partial and shallow clones:**
  - [GitHub: partial clone and shallow clone](https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/):
    blobless for developers, treeless and shallow for builds thrown away;
  - [git's partial-clone docs](https://git-scm.com/docs/partial-clone): every missing object is
    fetched on demand from the promisor remote, with its credentials;
  - [GitHub's repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits);
  - [anonymous rate limits, 2025-05-08](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/).
- **Git's own attack surface:**
  - [git-config](https://git-scm.com/docs/git-config) (`safe.bareRepository`, `core.symlinks`,
    `credential.helper`);
  - [the Git security releases (CVE-2025-48384 and others)](https://github.blog/open-source/git/git-security-vulnerabilities-announced-6/):
    they need `--recurse-submodules`, which no clone here uses.
- **Prompt injection:**
  - [the lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/): remove one of
    the three legs, don't filter;
  - [GitHub MCP toxic flow](https://invariantlabs.ai/blog/mcp-github-vulnerability);
  - [CamoLeak](https://legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code):
    data out through GitHub's image proxy;
  - [link-preview exfiltration](https://www.promptarmor.com/resources/llm-data-exfiltration-via-url-previews-%28with-openclaw-example-and-test%29).
- **How others fence their agents:**
  - [Claude Code's CLI reference (`--restricted`)](https://code.claude.com/docs/en/cli-reference)
    and its [sandboxing](https://code.claude.com/docs/en/sandboxing): environment variables are
    inherited, and WebFetch isn't covered;
  - [Codex: internet off by default for the agent, and secrets removed before it](https://learn.chatgpt.com/docs/cloud/internet-access);
  - [Copilot's agent firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall);
  - [pi's security notes](https://pi.dev/docs/latest/security).
- **Working in someone's repo its own way:**
  - [AGENTS.md](https://agents.md/);
  - [Copilot's setup steps](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment);
  - [Devin's repo setup](https://docs.devin.ai/onboard-devin/repo-setup).

  Each agent reads the repo's own instructions first. "Ask about any repo" exists elsewhere
  ([DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki-mcp), Copilot Chat). What's ours: the
  answer comes in your chat, covers your private repos, and hands off to a change.
