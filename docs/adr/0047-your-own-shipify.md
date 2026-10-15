---
status: accepted (merged #285) and built (#286–#292, #295, #299, #300; the owner's go on 2026-10-09); see [As built](#as-built-2026-10-09)
date: 2026-10-09
amends: 0012 (a copy on a user account too), 0024 (the edge's address: workers.dev by default, your domain optional), 0044 and 0045 (repos and projects as one list with two kinds; a repo's own notes on any account), product.md (road step 2, designed here)
---

# 0047: Your own Shipify, for anyone

Shipify as a product anyone can start from clean: one guided setup with four core steps, add-ons
you choose later, and nothing of anyone else's in it. Every repo is one kind of extension, and
updates reach your copy as a PR you merge.

## The owner's asks (2026-10-09)

- "shipify as product so it should have clean start setup no unnecessary fixated steps covered well
  proper end to end setup guides clean and simple"
- "if we hardcode anything in the PR isnt that bad for clean setup … apps or repos or anything in
  code added isnt this unnecessary leakage"
- "there are 2 i am assuming shipify designed app and non one … so they are extensions treated same
  and such core remains clean strong"
- "we can start clean from 0.1.0 also then later upgrades can be clean … make sure nothing stale or
  dependent remains"
- "strong core interfaces and everything end to end properly handled"

## What Shipify is, next to an agent on its own

| | An agent on your PC | An agent in a repo's workflows | Shipify |
|---|---|---|---|
| **You ask from** | that terminal | an issue on that repo | any chat, about any of your repos |
| **It runs on** | your PC, while the session is open | GitHub's runners, per repo | your own box, while you're away, free |
| **The agent holds** | all your login can do | a write token and a key in that repo | one repo's read-only key for an hour; the box pushes |
| **The rules** | the agent's own prompts | the workflow's settings | outside the agent: PRs only, no workflow edits, a secret scan, approvals on GitHub |
| **Per repo** | a clone | a workflow file and secrets in each | nothing on your account; the App's install elsewhere |
| **Carries across** | one session | one repo | one record: notes, repeats, recipes, tools, one status page |

Their strengths are real: the PC is the fastest loop, and a repo bot needs no box. Shipify's job is
to be your own layer over every repo, reachable from your phone. That makes it a product only if
its setup is as light as theirs. This ADR is about that setup.

## What was found (checked 2026-10-09, against `main` at `72cdf24`)

Two read-only sweeps covered what a new user meets today, and what of one owner is baked in.

**The guided setup misleads at its last step.** `ship setup`'s box step says
`ship box up --service` and "within a minute or two it answers" (`cli/commands/setup.ts:368-369`),
and its check counts any online box (`:355-360`). But task runs go only to slots labelled `sandbox`
(`.github/workflows/task.yml:170`), and only `ship box add` gives that label (`cli/commands/box.ts:6,
757`). On a PC-only setup, every step is ✓ and no task ever runs.

**Steps that block a first answer without being needed for it:**
- **Cloudflare's keys** (`setup.ts:252-299`) are required before the bot, the agent and the box.
  They're only needed for chat, repeats and apps.
- **`claude` on the PC**, and every stack's checks, which include browser libraries that need sudo
  (`setup.ts:161, 204-230`; `stacks/ts-static/stack.json:54`). The box installs its own agent.
- **A domain** for the edge: its address can only be `shipify.<APPS_DOMAIN>`
  (`edge/setup/worker.ts:24-36`, `edge/wrangler.jsonc:9`). That goes against "free only, no domain
  to buy" (AGENTS.md).
- **A GitHub organization:** the checks, both App manifests and the fix links assume one
  (`setup.ts:238`, `bot.ts:290`, `door.ts:116`). A user account half-works (`setup.ts:185`,
  `bot.ts:419-424`).
- **A fresh copy's first CI run is red:** the edge job fails while no domain or Cloudflare key is
  set (`ci.yml:201-204`).

**Typed or pasted, though the code could find it:**
- **The owner:** it's the repo's owner.
- **The time zone:** the PC knows it.
- **The Cloudflare account id:** `GET /accounts`.
- **Your workers.dev name:** Cloudflare's API.
- **Your Telegram id:** the edge sees your `/start`.

The key dates are already recorded by `doctor` and `door setup`, though the guide still says to add
them by hand. One of them is made up: an App's key never expires (`door.ts:429-431`).

**Checked by no one:** the org's Actions settings and the bot's install
(`setup.ts:231-251, 325-328`).

**One owner baked into the product:**
- **Code reads it at build time:** `shipify.config.json` (the org `aayush-t-apps`, the
  `aayush69work` subdomain, Asia/Kolkata), imported by `cli/contracts/zone.ts:4`.
- **Strings a user sees:** "ask: what does spotter do?" (`edge/src/chat.ts:40`), "`spotter: …`" in
  `ship help`, a token named `tapp-pc` (`setup.ts:249`, `doctor.ts:179`), "spotter" in the Repeat
  form and in `playbooks/task.md:125`.
- **Code for one owner's past:** closing 1.x tasks (`cli/commands/task/lifecycle.ts:4,59-80`,
  `watch.ts:158,170`), and "a 1.x state" branches (`edge/src/watch.ts:355`,
  `cli/lib/task.ts:420`, `cli/contracts/watch.ts:21`). Also the cut-over text in
  `tools/telegram/setup.ts:197`.
- **Instance files among the product's:** `plans/*.plan.md` (four of one owner's apps),
  `docs/context.md` (one copy's live state, its box and ids), the Operate form's app list.
- **The guides:** one-time sections ("Moving to 0.1, once", "Re-adding a box for 0.1, once"), real
  dates and token names, `~/work/t-apps`, `homepi`, and disclaimers that read "today's setup (the
  org `aayush-t-apps` …), read it as yours" (`docs/glossary.md:6`, `docs/configuration.md:234`).

**Already clean:** `stacks/`, `presets/`, `plugins/`, `checks/`, `edge/public/`, `edge/setup/`,
and the `ci`, `task` and `watch` workflows.

## Research: how other tools do it

- **Which repos:** Renovate, Devin, Copilot and Jules all take the GitHub App's selected repos as
  their list, and add no second register
  ([Renovate](https://docs.renovatebot.com/getting-started/installing-onboarding),
  [Devin](https://docs.devin.ai/onboard-devin/repo-setup)).
- **Per-repo instructions:** these live in the repo as `AGENTS.md`, the open standard (Linux
  Foundation, 60,000+ projects) that Codex, Copilot, Jules, Cursor and Devin read
  ([InfoQ](https://infoq.com/news/2025/08/agents-md/)). Where a tool keeps its own notes per repo,
  only that repo's runs see them ([Devin](https://docs.devin.ai/onboard-devin/repo-setup)).
- **Safety:** Copilot pushes only to its own branches, and branch protections still apply. A human
  merges ([GitHub](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)).
  Shipify already does the same.
- **A copy that stays current:** a template, plus a workflow in each copy that opens a PR with the
  template's changes
  ([actions-template-sync](https://github.com/AndreasAugustin/actions-template-sync)).
- **No domain needed:** every Cloudflare account has a free `workers.dev` address
  ([Cloudflare](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)).

## The plan in short

1. **The product starts clean at 0.1.0:** a fresh template repo holding only Shipify's own files.
   This copy becomes its first user, and its canary.
2. **One line between the product and your copy:** your settings live on GitHub (variables and
   secrets), and your files live in your folders. The product holds nothing of anyone's.
3. **Four core steps,** each checked against the real world:
   1. GitHub: your copy, on a user account or an org.
   2. The bot.
   3. The agent's login.
   4. A box.

   Then the first answer. Everything else is an add-on that blocks nothing.
4. **Setup finds what it can and asks only the rest.** It checks what it relies on, and invents no
   reminder.
5. **Every repo is an extension of one kind, found the same way.** Projects and repos differ only in
   what their own file says. One `/repos` list covers both, and each can have notes.
6. **One list of settings**, from which setup, `doctor`, the guides' table and the workflows' tests
   all read.
7. **Updates arrive as a PR** with the release's notes. Your files are never in it.

## Decision

### 1. The product and your copy

| | The product (Shipify's) | Your copy (yours) |
|---|---|---|
| **What** | code, stacks, presets, plug-ins, workflows, guides, ADRs, examples, its CHANGELOG | your settings, plans, recipes, checks, tasks and notebook |
| **Where** | the template repo, then every copy's product paths | GitHub variables and secrets, the Worker's secrets, and your folders: `plans/`, `recipes/` (not `examples/`), `checks/` (not `example.mjs`); tasks are issues |
| **Changes by** | a release, arriving as an update PR | you, through tasks and PRs |

- **`shipify.config.json` goes.**
  - **Derived, never typed:** the owner (the repo's own owner) and Shipify's name.
  - **Settings that vary per copy** become variables: `SHIPIFY_TIME_ZONE`, and `SHIPIFY_WORKERS`
    (your workers.dev name).
  - **This PC's own paths** (where projects are cloned) go in a gitignored `.shipify.local.json`,
    with defaults that need none.
  - **The edge reads its time zone** as a variable at deploy time, never from a tracked file.
- **Generated lists ship empty:** the Operate form's apps, with its marker. Your copy's `ship forms`
  fills them.
- **`docs/context.md` splits:**
  - its gotchas and conventions are product knowledge, so they move to `troubleshooting.md` and
    `design.md`;
  - one copy's live state isn't a document: the status task holds it.
- **One owner's past goes:**
  - from the code: the 1.x closing, the 1.x state branches and the cut-over texts;
  - from the guides: every "once, for 0.1" section. A version's migration lives in its own release
    notes, in its update PR.
- **Examples are neutral:**
  - an example app is `acme-site`, a repo `acme/api`, a box `mybox`;
  - user-facing texts take placeholders (`<app>: …`, "ask: …");
  - no guide says "today's setup, read it as yours".

**The product's own names stay, since they're product concepts:** `shipify` itself, the
`playground` project, the agent called `pi`, the `shipify` user on a box. The playground becomes
optional: if it doesn't exist, `playground: …` says how to make it. It no longer points at a repo
that isn't there.

### 2. A clean start at 0.1.0

- **A fresh repo:** `shipify`, a GitHub template. Its first commit is the product at 0.1.0, with no
  history and no issues from any copy. "Use this template" gives each copy a single starting commit.
- **This copy follows it:** `aayush-t-apps/shipify` takes the template as its upstream, so it's the
  first copy to get each release, and the canary of each release. Its own history, tasks and
  CHANGELOG past stay here.
- **The template's CHANGELOG starts at 0.1.0.** Releases are batched, tagged, then offered to copies
  as update PRs. `v1`, the projects' pipeline tag, keeps its rule.
- **Who can see it is your call** (decision 2): private, so it's for you and those you invite; or
  public, as open source with a licence. The design is the same for both.

### 3. Day 0: four core steps

`pnpm ship setup` walks them, checks each against the real world, and names the next. It stores
nothing and can be run again at any point.

```
1. GitHub     your copy ("Use this template", on your user account or an org), gh signed in
              ✓ the copy exists, Actions on, its settings as Shipify needs (checked, with the fix)
2. The bot    pnpm ship bot --yes → Create → Install (All repositories)
              ✓ installed, with the permissions it asks for (read back from GitHub)
3. The agent  Claude: claude setup-token, pasted at a hidden prompt; or a gateway's key (OpenRouter has
              free models); setup sets the secret itself
              ✓ the secret is there, and a tiny run answers
4. A box      pnpm ship box add <user@host> --yes: a Pi, a VPS, or this PC on Ubuntu LTS
              ✓ a slot online with the sandbox, which is what task runs need

→ first answer: open an issue in your copy ("what can you do?"), on GitHub or its phone app
```

- **The box step is one command.** `box add` is the way. Setup never suggests `box up` for task runs:
  the check counts sandboxed slots only, and a box without the sandbox says why.
- **The PC needs no more than Node, pnpm, git and `gh`.** No `claude` and no stack libraries until a
  project of that stack is on this PC.
- **A first CI run is green:** the edge job skips, with a line saying why, until the door is set up.

**Add-ons**, each one command, each checked, none blocking the core:

| Add-on | Needs | One command |
|---|---|---|
| **chat and repeats** (the door, the watch, Telegram, the web chat) | a free Cloudflare account; the address is `shipify.<you>.workers.dev`, or your own domain if you have one | `pnpm ship door setup --yes`, then `ship add telegram` or `ship add webchat` |
| **apps Shipify builds** (projects) | the same Cloudflare account; apps live on workers.dev, or your domain | the first `new: …` names what's missing |
| **another account** | the repos App | `pnpm ship bot repos --yes` once, then `pnpm ship bot repos <account> --yes` |
| **a tool** (Notion) | its keys | `pnpm ship add notion --yes` |
| **another agent** (pi) | a gateway key | `pnpm ship add openrouter --yes` |

### 4. Setup finds what it can, checks what it relies on, invents nothing

| Value | Today | After |
|---|---|---|
| the owner | typed | the repo's owner |
| the time zone | typed | the PC's, shown for a yes |
| the Cloudflare account id | pasted | read with the token |
| your workers.dev name | typed | read with the token |
| your Telegram id | pasted after Start | taken from your `/start`, then confirmed |
| the agent's login | `gh secret set` by hand | pasted at setup's hidden prompt; setup sets the secret |
| key dates | partly by hand | only real ones, found by the code: the PC token's (GitHub's header) and the agent login's (a year after it was set). An App's key never expires, so it gets no reminder |
| the org's Actions settings | never checked | checked, with the fix link |
| the bot's install | never checked | read back from GitHub |

### 5. Every repo, one kind of extension

A repo is what a GitHub App's install reaches. Its own file decides its kind:

| | **Project** (Shipify built it) | **Repo** (anyone's) |
|---|---|---|
| **Found** | GitHub's install + its `shipify.json` | GitHub's install |
| **Named** | `acme-site: …` | `notes-api: …`, `acme/api: …` |
| **Its rules** | its stack's | its own: `AGENTS.md`, README, CI |
| **The check before a PR** | `make verify` | its own CI, on the PR |
| **After the merge** | deploy, Live, releases | its own pipeline |
| **Always applies** | its notes | its notes |

- **One list, found the same way:** `/repos` (in a chat, on GitHub, and the web chat's
  **Change a repo**) lists your account's repos with their kind. The due run reads them for the apps
  already, so it costs nothing more.
  - **Another account's repos** are named as `owner/name`, and the first task checks Shipify can
    reach the one you name.
  - **No second register:** GitHub's install says which repos, your account list says whose.
- **A repo's notes:**
  - **Saving one:** `remember acme/api: run npm test before a PR` is saved at once, as that repo's
    notebook page.
  - **Who reads it:** every run on that repo, and only those, on any account. On another account,
    that page is the only part of the notebook a run gets.
  - **Its repo's own rules come first:** its `AGENTS.md` where its team keeps one.
- **The repo contract** joins the plug-in kinds in `docs/plug-ins.md`:
  - a repo is reachable through an install;
  - its kind is its file;
  - a project keeps its stack's contract;
  - a repo keeps its own rules;
  - and Shipify adds nothing to a repo it didn't build.

### 6. One list of settings

`cli/contracts/settings.ts` holds every setting a copy has:
- its name;
- where it lives (variable, secret, the Worker's secret, or this PC);
- the step or add-on that sets it;
- what reads it;
- whether the core needs it.

Everything about settings reads from that one list:
- `ship setup`'s checks;
- `ship doctor`;
- the guides' settings table (generated);
- the workflows' tests: every `vars.X` and `secrets.X` in a workflow is on the list, or the test
  fails.

A setting can't be added in one place and forgotten in another.

### 7. Updates as a PR

- **The workflow:** each copy has `update.yml`. On a schedule, or when you run it, it takes the
  template's newest release. It opens one PR: "Shipify 0.x.y", with the release notes and what each
  needs from you.
- **What it touches:** product paths only. Your paths aren't in the template, so they're never in
  the PR.
- **Nothing happens until you merge.** Then CI runs and deploys the edge, as today, and the next run
  on a box uses the new version.
- **Its key:** the bot's, as the workflow's token (a PR that changes workflow files needs the bot's
  workflows permission). It opens the PR and never merges it.

## Security

- **The template holds no key and no one's data.** A copy's keys stay with that copy: GitHub's
  secrets, its boxes and its Worker.
- **Every rule that keeps a run safe is unchanged:**
  - one repo's read-only key for an hour;
  - the box pushes, after the secret scan;
  - no workflow edits;
  - approvals and merges on GitHub only;
  - the read profile for anyone else's repo.
- **The trust stays as it is:** GitHub's install says which repos, and your account list says
  whose. Adding an account is a trust change, so it stays a command on your PC, never a chat
  message.
- **A repo's notes are its own:** on another account, a run gets that repo's page, never the rest of
  your notebook.
- **The update PR shows every line it changes,** and you merge it.

## What it doesn't do (overkill, left out)

- A second register of repos beside GitHub's install.
- Settings per repo that Shipify enforces (a check command, paths to keep off). A repo's own CI and
  `AGENTS.md` do that, and its notes guide the agent.
- Adopting a repo as a project (ADR 0044, 0045).
- Syncing with GitHub's installs by itself.
- Hosting Shipify for others (product.md: a business of its own).

## Docs and clean-up

- **Rewritten for anyone:**
  - `getting-started.md`: Day 0 in four steps, add-ons, every day, upkeep;
  - `setup.md`: each step in detail, the settings table generated from the list;
  - `box-setup.md`;
  - `README.md`'s start.
- **Made neutral:**
  - `tour.md`, `tasks.md`, `channels.md`, `product.md`, `security.md`, `design.md`, `glossary.md`,
    `configuration.md`, `agents.md`, `roadmap.md`;
  - `playbooks/task.md`.
- **Gone:**
  - the "once, for 0.1" sections;
  - `docs/context.md`, split as in decision 1;
  - `plans/*.plan.md` from the template;
  - the disclaimers;
  - stale steps (key dates by hand, `box up` for task runs).
- **Updated:** `AGENTS.md` (where state lives), `docs/plug-ins.md` (the repo contract),
  `docs/notebook.md` (a repo's notes), `docs/tasks.md` (`/repos`, "Which repos"), the CHANGELOG, and
  this index.

## Build plan (in steps, each a PR; the last a full docs pass)

1. **The line between product and copy:**
   - settings to variables and a local file, and `shipify.config.json` removed;
   - one owner's past removed from the code;
   - neutral texts;
   - generated lists empty;
   - `context.md` split.
2. **Setup:**
   - the four core steps;
   - checks that prove (the box's sandbox, the bot's install, the org's settings);
   - values found, not typed;
   - add-ons that never block;
   - the edge on workers.dev by default;
   - a green first CI.
3. **The settings list:** the list, its tests against the workflows, and `doctor` and setup reading
   it.
4. **Repos, one list:** `/repos`, the web chat's Change a repo, the repo contract in plug-ins.md, and
   a repo's notes on any account.
5. **Updates:**
   - `update.yml`;
   - the template made from this repo's product paths, by `pnpm ship template`. Its plan is shown
     first, and creating the repo is your go-ahead;
   - this copy switched to following it.
6. **A full docs pass**, as listed above.

## Confirmation (live, before calling it done)

On a fresh test account (a user account, so the org assumption is gone):
1. "Use this template", then `pnpm ship setup` following only the guide. That runs the four steps
   to a first answer, and its time is recorded.
2. Add the door and Telegram, ask from the phone, and set a repeat.
3. Add a second account with the repos App, then make a change there and merge it.
4. Release 0.1.1 of the template, then check the update PR in both copies (the test one and this
   one), merge it, and confirm both still answer.
5. Run `ship doctor` and `ship selftest` on both copies: everything ✓.

## Decisions for you (the recommended option first)

1. **The product's home:** a fresh template repo made from this one's product files, with this copy
   as its first user. *Not chosen:* turning this repo into the template, which carries its history
   and issues.
2. **Who can see it:** private for now, with public as open source later, your call then. *Not
   chosen:* public at 0.1.0.
3. **Where a copy lives:** a user account or an org, both supported. *Not chosen:* orgs only.
4. **The edge's address:** `workers.dev` by default, your domain optional. *Not chosen:* a domain
   required.
5. **Boxes:** one command, `box add`, for a Pi, a VPS or this PC on Ubuntu LTS. `box up` goes once
   `box add` covers this PC; checked in step 2. *Not chosen:* keeping two ways to make a box.
6. **Settings:** on GitHub (variables and secrets), plus a local file for this PC's paths. *Not
   chosen:* a tracked config file per copy.
7. **A repo's notes on another account:** that repo's page only. *Not chosen:* no notes there, as
   now.

## As built (2026-10-09)

Built in #286–#292, #295, #296 (with ADR 0048), #297 and #298; released as 0.1.0 and 0.1.1.

**Recorded after this PR merged:** the owner agreed the design and every recommended decision the
same day ("looks clean end to end corrrect fresh start nothing from back … only necessary keep"),
and the template holds nothing from before: no migration code, no "once, for an old version" step,
no setting kept for an old copy.

**What changed from the plan, and why:**
- **Shipify is built in this copy and published out** (decision 1's flow, the owner's choice once
  the trade-off was shown): the template is a clean mirror of this copy's product files, one
  commit per version, written only by a release (`shipify: release` on GitHub, or
  `pnpm ship template --yes`). This copy doesn't take the template as its upstream: it is the
  source, and its update check finds nothing new. Other copies take each version as a PR.
  Switching to building in the template stays possible later (open source with contributors):
  this copy already has `update.yml` and `SHIPIFY_TEMPLATE`.
- **A release is one ask, with no version PR:** it checks the exact files to publish
  (`pnpm verify` in a folder of their own, with the template's remote), sets the version from
  CHANGELOG's Unreleased, records it on main and publishes.
- **0.1.0 on top of this copy's old tags:** this copy already had v0.1.0–v0.2.0, so a release is
  "the push that sets a new version" (ci.yml), whatever older tags of that name exist. Nothing was
  deleted.
- **Your files** are `plans/`, `recipes/` but its README and examples, `checks/` but its README and
  example, the forms' app lists, and Dependabot's config, which stays where Shipify is built.
- **No `.shipify.local.json`:** the defaults and environment variables covered this PC's paths.
- **The Telegram id stays a one-time paste:** the bot tells it to you; finding it would need a new
  part between the edge and the PC.
- **`box add` covers this PC,** and `box up` went (decision 5), in #291.
- **The settings list** takes each plug-in's settings from its own file, and `door setup` sets the
  edge's deploy key too (a copy with the door but no apps couldn't deploy its edge before).
- **Found by the first release, and fixed:** tests that assumed this copy's name, plans or history
  (#295, #296). The release refused to publish until they passed, as designed.

**Confirmation, live:**
- The first release made `aayush-t-apps/shipify-template` (private, a template) and published
  0.1.0; its own CI passed and released v0.1.0. 0.1.1 followed the same way, one commit on top.
- A copy made with **Use this template** (`aayush-t-apps/shipify-check`): one clean commit, its
  first CI green, GitHub naming its template. Its update offered "Shipify 0.1.1" as one PR with
  that version's notes, its own files kept; merged, its CI released v0.1.1 there, and it then said
  "up to date".
- **Not checked live:** a fresh user account (one can't be made for you), and the door, Telegram
  and a box on a second copy. Two copies can't share one Cloudflare account's edge: the Worker is
  named `shipify` in both.
