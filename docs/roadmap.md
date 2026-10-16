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
   - **A firewall for the agents' users** (talk and work runs; a read run has no command or web to
     reach out with, ADR 0044): their network is open today (npm, the agent's API,
     GitHub).
   - **`ship task <n>` on the PC:** a task's status and its last runs, with links to their logs.
   - **A container image for boxes.**
4. **Chat channels beyond Telegram** (Discord, email), each one channel in `edge/` with its
   conformance test. (Notifications without Telegram are the web chat's own now: ADR 0050.)
5. **The rest of ADR 0038** (its builds made pi, then OpenCode, agents through one setup), each
   built when you ask for it:
   - **Notion as your outward side:** `share` and `share thread` put a reply or a conversation on a
     Notion page others can read; a recipe's `share: replace` keeps one current.
   - **A read token right before the agent:** a `ready` step for the clone and `make setup`, so a
     long ask keeps its token's hour and `stop` works to the end.
   - **Channels in step:** a reply's next words as buttons (Telegram too), `pause` for repeats (the
     web chat's Pause ends one today), Operate from a chat as a pre-filled form, a run's progress
     in the web chat.
   - **Each agent's numbers side by side:** tokens, cost and time per agent from the runs' details.
6. **After ADR 0044 (any GitHub repo, built):**
   - **Partial clones for change runs on very large repos,** once a run's key can outlive its hour.
   - **pi's grep and find in a read run:** they need `rg` and `fd`, which a box doesn't have.
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

## Faster and cheaper runs

1. **The record over one connection (measured, not planned):** a `gh` call costs 0.66–0.69 s on
   a Pi idle, 0.9–1.8 s in a run (a process and a TLS handshake); a call on a kept-open connection,
   0.05–0.09 s. A stay's turn would gain about 10 s of its 30–50 s (the agent's thinking is the
   rest), and it needs a second way of talking to GitHub that copies `gh`'s, on boxes only: not
   worth it for now (the owner, 2026-10-16; the plan and numbers are in the closed PR #469).
2. **One browser in the stacks' `make setup`:** `playwright install --only-shell`, since tests run
   headless: about 190 MB less on a box's first setup of a project.

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
9. **Small, for when each is next touched:** `ship unregister` doesn't refresh the Operate form's
   list (`ship forms` does); two of Claude Code's names live outside its adapter (its plan's limit
   windows in `cli/lib/runs.ts`, and `box/peek.mjs` reading its session files).

## Not planned

A Shipify server or database, plug-ins loaded from outside this repo, automatic production
changes, the edge writing settings itself (variables, secrets, files).
