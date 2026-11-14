# Roadmap (add when it's needed, not before)

The core stays small: the flow, the `make` contract and the pipeline (ADR 0010). New capability
comes as a prompt or a skill first, then a repeat or a pre-approved call, then a tool, then an
intent; the core last. What's live: the status task, and each ADR's "As built" ([adr/](adr/README.md)).

## Now: 0.1

**Shipify 0.1 is the current release line** (ADR 0031; the newest version is in `CHANGELOG.md`). Every message lives on a task, a run is one
job (plan, think, apply), and the agent only thinks, as its own Linux user, while the box makes
every change. The door and the watch live in this repo as the edge. Each project carries its own
pipeline (ADR 0048).

## Next, in order

1. **1.0.0:** once 0.1 has run live for a while with every use case checked (U1 to U11, from GitHub
   and from Telegram).
2. **A staging app's release, followed to Live:** "Live" follows a merge into `main`; a release PR
   merged into `production` isn't followed yet (the "On staging" reply links the release).
3. **Left for later in 0.1:**
   - **Token minting off the box:** the run's mint steps hold the bot App's key on the box while
     they run (never in the agent's step). Minting on GitHub's machines and handing the box only
     the narrow tokens closes that.
   - **`ship task <n>` on the PC:** a task's status and its last runs, with links to their logs.
   - **The copy of the web chat's files from KV to R2 goes** (ADR 0069), a week after the edge
     with it deploys: KV kept a file 7 days, so nothing is left to copy. In `edge/src/store.ts`
     the section "the switch from KV, once" (`MOVED`, `COPY_STEP`, `moveFromKv`, `copyStep`),
     and its line in `edge/src/index.ts`'s cron; `Kv.list` in `edge/src/env.ts` and
     `tests/edge/kv.ts`; the two routes tests that copy KV's files. Keep
     `FILE_REF`'s `up-…` and `run-…` forms: the copied files keep those keys.
   - **Knowledge, only if it's needed** (ADR 0070's "Not in it"): a search store of Shipify's own
     (Cloudflare Vectorize) only if GitHub's search by meaning proves not enough, or goes; a
     Zotero tool (its free Web API, as a plug-in) if you work from papers.
4. **Chat channels beyond Telegram** (Discord, email), each one channel in `edge/` with its
   conformance test. (Notifications without Telegram are the web chat's own now: ADR 0050.)
5. **The rest of ADR 0038** (its builds made pi, then OpenCode, agents through one setup), each
   built when you ask for it:
   - **Notion as your outward side:** `share` and `share thread` put a reply or a conversation on a
     Notion page others can read; a recipe's `share: replace` keeps one current.
   - **A read token right before the agent:** a `ready` step for the clone and `make setup`, so the
     agent's own GitHub reads get their whole hour (`stop` already works to the end: ADR 0059).
   - **Channels in step:** `pause` for repeats (the
     web chat's Pause ends one today), Operate from a chat as a pre-filled form, a run's progress
     in the web chat.
   - **Each agent's numbers side by side:** tokens, cost and time per agent from the runs' details.
6. **After ADR 0044 (any GitHub repo, built):**
   - **Partial clones for change runs on very large repos,** once a run's key can outlive its hour.
   - **pi's grep and find in a read run:** they need `rg` and `fd`, and a box has only `fd`
     (from setup 7).
7. **After ADR 0045 (any account, built),** in the order of [the road](product.md#the-road):
   - **Verified commits:** apply makes the run's commit through GitHub's API, so it's signed, for
     repos whose `main` requires signed commits.
   - **Not wanted:** following a PR's checks in the background, on any account, or reopening a
     merged task by itself (ADR 0046, the owner, 2026-10-09: nothing starts by itself). Asked why a
     PR's checks failed, or to fix them, a run does it, in the same PR, or a new one once merged.
   - **Contributing to anyone's public repo:** a fork in your account, then a PR upstream.
   - **Your notebook on another account,** an opt-in per account (`tools.only` is the seam).
   - **A task across two accounts,** and **Shipify's own account on the repos App,** leaving the
     bot only the projects extension's powers.
   - **The projects' pipeline's secret scan:** each project's `ship.yml` takes Shipify's gitleaks
     config too (a stack change: each project's upgrade).
   - **Open source, a team on one Shipify, a hosted Shipify:** your decisions, weighed in
     [product.md](product.md#if-you-go-further-open-source-a-team-or-hosted).

## The web chat, in layers (ADR 0036)

**Done:** the web chat at `<the edge>/admin/chat/`
([channels.md](channels.md#the-web-chat)), with diagrams drawn, pictures full size and earlier
messages loaded in place; a run reads a task's newest 5 chat files, not its first 5; and
notifications with the page closed, with Android's share menu (ADR 0050, once layer 5 here:
[channels.md](channels.md#notifications)). Next, each a layer of its own, through the same three
ways (words through the door, a PR you merge, your PC or GitHub):

1. **Agents, models and tools after any merge:** `ci.yml` redeploys the edge for `edge/`,
   `cli/contracts/` and `intents.json`, so a change to `executors.json` or `tools.json` alone (a new
   model, a gateway) shows in the chat after the next edge deploy. Adding them to the trigger is a
   workflow change.
2. **Settings forms that make a PR with no agent:** turn a recipe on or off, change the default
   model, add a pre-approved call or a known MCP server's entry. A new form, and a no-agent step in
   the box that makes the one edit. Its own ADR.
3. **Checks over time:** each check's values on Repeats, and templates for **New check…**.
4. **Tools and MCP servers from a form:** it ends in the PR (layer 2), then shows
   `pnpm ship add <tool> --yes` for the keys, never typed into the page.

## For new setups

Found walking [getting-started.md](getting-started.md) from nothing. Each is small.

1. **Doctor covers the whole setup:** the org's settings, `SHIPIFY_OWNER`, and the bot installed on
   every repo with its Variables permission.
2. **The playground as part of setup,** so `playground: …` works on day one without a build.
3. **Test ports from the slot:** the stacks' test port comes from the checkout's path (8800–9799),
   so 3 slots clash about 0.3% of the time (it fails safe). A port per slot, through a stack change
   and `ship upgrade`, makes it never.

## Boxes that say how they wear (from a box audit, 2026-10-06)

1. **Sizes in the weekly clean-up's summary:** the runner's work folder, its pnpm store, the shared
   tools and each slot's caches, so growth shows on the status task week by week.
2. **The drive's writes as a health fact:** read from `/sys/block/<dev>/stat`. A USB thumb drive
   takes about 12 GB of writes a day here; [box-setup.md](box-setup.md) already asks for an SSD.

## After the lab (ADR 0064, containers on every box)

Each only if you ask, and each its own design:
1. **A `lab` repo** for experiments that keep running for days (one Compose folder each), run by
   you on the box; today nothing an agent starts outlives its turn.
2. **A shared, read-only image store,** filled by the runner, if each slot's own copy fills the disk.
3. **A registry login or a mirror,** if Docker Hub's limit (100 pulls in 6 hours per address) is
   reached.
4. **A stronger wall for a run:** gVisor as Podman's runtime, or a VM per run (where KVM is).
5. **docker-compose v2 over Podman's socket,** if real compose files need more than podman-compose.
6. **A tool that reaches homelab** (its status, a photo), read-only, over Tailscale. Its calls run
   outside the agent's user: since setup 9 no agent reaches the tailnet.

## From the #662 audit (2026-11-05)

What the audit of projects, the R2 clean-up and guests found that PR #671 left for later, each
small, and each only after your go:
1. **One "whose is it" check.** Today it's decided three ways: the door's from-line (`guestsOwn`),
   labels (the list, Find, a project's close) and the name prefix (`add`, a guest's project, page
   writes). One `whose(issue)` in `cli/contracts/guests.ts`, used by the edge and the box.
2. **One refusal table.** What a guest may not say lives in five lists: the routes' `WHOSE`, the
   page's `YOURS`, `GUEST_COMMANDS`, the door's and the box's (these two now share
   `NOT_A_GUESTS`). One table in contracts, each list made from it.
3. **Run files of repeats, recipes and open projects' chats** grow without end (the clean-up
   keeps them). Delete their files older than 30 days.
4. **A guest's removal** closes only their first 100 open items, and never tries again: page
   through them all. (Their files with no chat go with the clean-up's 60-day rule.)
5. **The `shipify-files` backup** is never pruned (git history can't shrink): a doctor check that
   warns at 1 GB.
6. **The guest list can lose a removal** when the hourly "last in" write races it: an
   etag-checked write with one retry, or "last in" under its own key.
7. **A guest's `/help`** shows yours, and **Download the thread** writes the repo's GitHub link.
8. **A test-speed pass.** Done in part (2026-11-05): no test starts the real gitleaks but its own
   (34 s a start on a Pi), and the tests start the CLI built once per run (0.7 s a start on a Pi,
   not tsx's 2.2 s). Left: the flow tests' real processes (git, the stand-in `gh` at 0.15 s a
   call) and telegram's setup steps through tsx (2 s each). Share fixtures and repos between
   tests, with no coverage lost.
9. **The page's first load** is a few bytes under its 43 KB budget: every change to `app.js`
   needs room made. Move a part of it (the list's projects, or the thread's header menu) into a
   lazy module, or agree a new budget.

## Faster and cheaper runs

1. **The record over one connection (measured, not planned):** a `gh` call costs 0.66–0.69 s on
   a Pi idle, 0.9–1.8 s in a run (a process and a TLS handshake); a call on a kept-open connection,
   0.05–0.09 s. A stay's turn would gain about 10 s of its 30–50 s (the agent's thinking is the
   rest), and it needs a second way of talking to GitHub that copies `gh`'s, on boxes only: not
   worth it for now (the owner, 2026-10-16; the plan and numbers are in the closed PR #469).
2. **One browser in the stacks' `make setup`:** `playwright install --only-shell`, since tests run
   headless: about 190 MB less on a box's first setup of a project.
3. **The secret scan's start on a Pi (measured 2026-11-05):** apply scans each change before it
   sends it, and gitleaks takes about 34 s to start on a Raspberry Pi 4 (its go-re2 engine is
   compiled through wazero at each start; the scan itself takes 41 ms). No faster way is known yet:
   gitleaks has no setting for it. Worth a look, after your go. Measured again (2026-11-05, on
   homepi): the start grows with the rules: `gitleaks version` 1.5 s, one rule 1.5 s, its 222
   rules 34 s, and no rule alone stands out (the ten slowest are 17.5 s of it). Fewer rules would
   catch less, so not that. The way to look at first: start the scan on the run's change while the
   box's `make verify` runs (minutes on a Pi), and read its answer before the push, so its 34 s
   hide under verify's. A box on an SSD or Ubuntu 26.04 changes none of it: it waits on the CPU.

From the web chat to a reply (task #673, measured on homepi over 54 runs, 2026-11-05): a new chat
answers in its thinking time plus 37–56 s, a staying run in its thinking time plus 4–11 s. Done
then: a reply shows within 5 s of landing (the edge keeps a read 4 s, not 8), a stay's marks go on
as its agent starts, and a box checks the labels once a day. What's left:

4. **Fewer token steps (only you can change `task.yml`):** each `create-github-app-token` step
   takes about 2 s, and a talk run mints four before its reply, then revokes each as the job ends
   (about 1 s each). Three have the same inputs: plan's read token, decide and apply's, and the
   stay's apply's; on a talk run the agent's and the stay's are the same too. A token lasts an
   hour, so the second read token is needed only when think ran long: think says so in an output,
   the step mints only then, and decide and apply take the first otherwise. About 2–4 s less
   before a first reply, and 3–5 s less of a slot's time.
5. **The runner's own cache of actions (a box setup 13):** "Set up job" downloads
   `create-github-app-token` again in every job, 3.4–4.1 s of its 6 s (`curl` gets the same
   tarball in 0.65 s). The runner reads `ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE`
   (`<dir>/<owner>_<repo>/<sha>.tar.gz`, or an unpacked copy with
   `ACTIONS_RUNNER_SYMLINK_CACHED_ACTIONS`), which `slot_env` can write in each slot's `.env`.
   It needs a folder that only the runner's user can write (what's in it runs with the bot's key),
   filled for `task.yml`'s pins with the old ones removed, and a live test on a box. About 3 s
   less on every job.
6. **A reply's push before its files:** the box tells the door of a reply in one upload with its
   files (up to 50 MB), and the door rings your phone only after it read them all. Telling first,
   then sending the files, rings it at once.
7. **A first answer in seconds needs the direct layer (Later, 8):** of a new chat's 37–56 s
   besides thinking, about 18 s is GitHub's (its queue, a runner taking the job and starting it,
   "Set up job"). A job for each message can't go under that, and a staying run's 4–11 s is the
   floor of this design.

## Kept current and safe (task #673, 2026-11-05)

What's automatic: Ubuntu's security updates on a box (daily, a restart at 04:30 when one needs
it), the runner's own updates, Dependabot's security alerts and its quarterly PRs, and since #673
the weekly digest's line on the agents behind their newest, with any advisory against a pin first.
What's left:

1. **An agent's new version checked on a box:** today its PR is made on your PC, as its live checks
   (its login on fd 3, its skills, Claude Code's recorded permissions) need the agent signed in. A
   step that runs those checks on a box, with the agent's own login as the think step has it,
   would make `shipify: update claude to <version>` one task.
2. **Shipify's own audit each week:** `pnpm audit` runs in `ci.yml` only on a merge. A schedule
   in a small workflow of its own (only you can add one) finds a new advisory within the week.
3. **The box's own Node:** a box takes the newest 22.x only when `box add` runs again or a new
   image comes. A doctor check that compares it with nodejs.org's newest 22.x names the fix.
   Node 22's support ends 2027-04-30: the move to 24 is a planned PR before then.
4. **Ubuntu 26.04 in CI:** `box/Dockerfile` built from `ubuntu:26.04` as well (an `ARG`, and a job
   in `ci.yml`, which only you can change), so each release proves the install half on both LTSs.

## Later

1. **Sign-in and offline on the default stacks:** Cloudflare Access and a PWA, as stack options the
   way storage is (ADR 0022).
2. **More stacks, from real projects:** a `custom-app` or `custom-package` project first (Go,
   Python, another host), then a stack when it repeats.
3. **Several services in one repo,** each with its own version and deploy.
4. **Packages in a registry** (npm, GitHub Packages, PyPI), when a private consumer needs it.
5. **Iterating on a project's PR** by commenting there.
6. **Other people on your Shipify,** and **running your own from one command**: each its own ADR.
7. **A second record** (Forgejo) and **box kinds** (capability labels).
8. **The direct layer** (ADR 0057, "Left for later"): chats whose words live off GitHub, in a hub on
   the edge, as a second mailbox for the same loop a stay runs; its own ADR when a need shows.
9. **Small, for when each is next touched:** two of Claude Code's names live outside its adapter
   (its plan's limit windows in `cli/lib/runs.ts`, and `box/peek.mjs` reading its session files).

## Not planned

A Shipify server or database, plug-ins loaded from outside this repo, automatic production
changes, the edge writing settings itself (variables, secrets, files).
