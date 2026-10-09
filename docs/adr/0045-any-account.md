---
status: accepted (merged #267) and built (one PR, the owner's go on 2026-10-09); see [As built](#as-built-2026-10-09)
date: 2026-10-09
amends: 0044 (one owner becomes your accounts; a repo's PR goes against its default branch), 0012 (a second, small App beside the bot)
---

# 0045: Shipify on any account: install it, ask in words, get a PR

Proposed from the owner's asks on 2026-10-09. The ask is to treat Shipify as an independent
product: a framework with its own rules, where you attach repos, tools, agents and models.
- **How it's used:** someone installs it on a repo or an org, as they would a personal Claude
  account's GitHub app. It reads code, and it opens PRs in its own clean format.
- **What it must be:** permissions small and well respected, an easy install, the core's rules
  intact.

ADR 0044 made any repo in your account work its own way. It left "many owners" for later, with
`repoFor` as the seam. This ADR is that next step: any account, through one small App.

**The product it's a step toward** is pictured in [docs/product.md](../product.md), added with
this ADR. That page covers who it's for, how setup and every day look, the parts, who holds which
key, and the road from here.

## The plan in short

1. **Shipify is the product, and everything attaches to it.** The core runs the flow and keeps the
   rules. Repos, agents and models, tools, channels and stacks each attach through one contract.
   Projects, the apps Shipify builds and deploys, are one extension, not the base.
2. **One small App opens any account.** It's a second GitHub App, the **repos App**, and it's
   public.
   - **What it can do:** read code and open PRs. It has no admin, no secrets, no workflows and no
     webhook.
   - **Who installs it:** whoever has admin rights, on an org, a user account or just a few repos.
   - **The bot** stays as it is, on Shipify's own account.
3. **An install gives access; your list gives trust.** Anyone can install a public App. So an
   account counts as yours only once you add it (`pnpm ship bot repos <account>`). Any other repo
   stays outside, read only, as in 0044.
4. **One task, one account, and a run holds only what that account may see.** A task on another
   account gets that repo's key and Shipify's rules. It doesn't get your notebook, your tools'
   keys or your other repos.
5. **The same rules on every repo, and one PR format.** The repo's own rules come first, then
   Shipify's. Every PR Shipify opens reads the same way, unless the repo has its own template.
6. **Masking that knows today's tokens.** GitHub's new installation tokens slip past our masking and
   our secret scan. That was found on the way, and it's built first.

## What it gives

The owner's question: only a look, or a permanent adopt and PRs? On an account you've added:

- **`look at sprinto/api …`** reads it and answers. Private repos are included.
- **`sprinto/api: …`** changes it the repo's own way. It opens a PR, which you or the repo's team
  merge.
- **Nothing more:** it doesn't adopt the repo as a project. There are no deploys or releases, no
  Shipify files in the repo, and no merges. To detach, uninstall the App or take the account off
  your list. There's nothing to clean up in the repo.

So: a look and a PR, never a permanent adopt. This is 0044's decision 2, carried to any account.

## The rules, on every repo

One list. `docs/design.md` takes it over.

1. **You ask; Shipify answers or opens a PR; a person merges.**
   - It never merges.
   - It never pushes to a default branch, `main` or `production`.
   - It deploys projects only.
2. **The repo's rules first:** its `AGENTS.md`, `CLAUDE.md`, CONTRIBUTING and README, its commands
   and CI, its PR template and its commit style.
3. **Then Shipify's:**
   - its own branch;
   - the secret scan before a push;
   - no workflow files;
   - nothing of Shipify's added, unless you ask.
4. **The least key, for the least time:**
   - one repo, for one hour, minted right before the step that needs it;
   - write access only after the agent has finished.
5. **Trust is yours to give.** A repo you haven't made yours is outside: read only, with no key and
   no command (0044's read profile).
6. **A run holds only what its repo's account may see.**
7. **Everything shows on GitHub.** Every failure is told once, with its fix. Nothing is retried.

## Installing it (the opt-in)

**Once, for you:** `pnpm ship bot repos --yes`. It takes two clicks in the browser: GitHub shows
the App and its permissions, and you click **Create GitHub App**. Its key goes straight into
Shipify's secrets and is never printed.

**For each account:** `pnpm ship bot repos sprinto --yes`. It adds `sprinto` to your accounts and
opens the App's install page. On GitHub, depending on who you are there:
- **An org owner,** or you on your own user account: pick **All** or **some** repositories, then
  click **Install**.
- **A repo admin:** install it on the repos you admin, with no org owner needed. That works
  because the App asks for repository permissions only.
- **A member:** click **Request**, and an org owner approves it.

**Check:** `pnpm ship doctor` lists your accounts and the App. The first task on an account
confirms that it works, or names the fix ("the repos App isn't on sprinto/api; add it here:
<link>").

**Detach:**
1. Uninstall the App on GitHub (the org's Settings → GitHub Apps).
2. Run `pnpm ship bot repos sprinto --remove --yes`.

## What was found (checked 2026-10-09, against `main` at `c16107d`)

From GitHub's docs (see Sources) and the code:

| Found | What it means here |
|---|---|
| A private App "can only be installed on the account that owns the app". Today's bot is private (`bot.ts:32`) and holds administration, secrets and workflows write | The bot can't go to another account, and shouldn't. A second, small App does |
| A public App can be installed by "any user on GitHub", and GitHub offers no list of who may | Our own list of accounts is the trust. An install alone is only access |
| Repo admins can install an App that asks for no organization permission and not "Repository administration", on the repos they admin | With repository permissions only, a repo's admin can opt in alone |
| An install grants every permission the App asks for. A permission added later waits for each account's approval | Choose the set once, and keep it small |
| `create-github-app-token` (v3.2.0, pinned) mints for any `owner`, but its `repositories` must all be that owner's. The step fails when the App isn't installed there | One mint per account. A failed mint is caught and told |
| GitHub refuses a push that changes `.github/workflows/` unless the App has the `workflows` permission | The no-workflow-files rule holds even if the box's own check missed |
| PRs opened with an App's token run the repo's `pull_request` workflows without approval | The repo's CI checks Shipify's PR, as on your own repos |
| An org's IP allow list (Enterprise Cloud) covers installation tokens | Told, with the fix |
| `Closes owner/repo#n` works across repositories. Whose access lets it close across accounts isn't documented | The task reads its PR itself, and the live check settles the close |
| Where `main` requires signed commits, unsigned pushed commits block even a squash merge. Commits an App makes through the API are signed | Told for now. Verified commits are left for later |
| Plan reads the task's PRs and checks before any later token exists (`snapshot.ts:104-111`, `:315-327`), and every mint says `owner: github.repository_owner` (`task.yml`) | The task's account must be known before plan's token is minted |
| The watch's due run reads checks with one token (`due.ts:46`), and a job can't loop its steps over accounts | The watch follows nothing on another account |
| The github job closes a task's PRs with the bot (`github-job.ts:146`) | It needs the account's token for that account's PRs |
| Installation tokens became `ghs_<app id>_<JWT>` in a rollout from 2026-04-27, about 520 characters long. Masking and the secret scan look for `ghs_` plus 30 letters or digits (`mask.ts:11`, `safety.ts:87`), and a made-up token in the new shape passes both | Fixed in this plan, first ([§9](#9-masking-that-knows-todays-tokens)) |

## Decision

### 1. Two Apps, each with one job

| | The bot (today) | The repos App (new) |
|---|---|---|
| On | Shipify's own account | each account you add |
| Visibility | private | public: anyone can install it, and only your list makes an account yours |
| Permissions | contents, pull requests and issues write; administration, secrets and workflows write; actions, statuses and checks read | contents and pull requests write; issues, actions, checks and statuses read; metadata |
| For | tasks there, and the projects extension (new repos, their secrets, the pipeline) | reads and PRs on your other accounts |
| Set up by | `ship bot` | `ship bot repos` |

- **Nothing else:** no webhook, no events, no sign-in on install, and no organization permission.
- **Its key and names:** the key goes in the secret `SHIPIFY_REPOS_KEY`, and its id and name in
  `SHIPIFY_REPOS_CLIENT_ID` and `SHIPIFY_REPOS_SLUG`.
- **Its setup** is the bot's manifest flow (`bot.ts`), with `public: true` and its own permissions.
- **Its name** is `<account>-shipify-repos` by default, and GitHub's form lets you change it before
  you create it. Its PRs show as `<name>[bot]`.
- **It stays public:** once another account has installed it, GitHub won't make it private again.
  If that's ever needed, a fresh App replaces it.
- **Issues read** lets an ask like `sprinto/api: fix #45` read the issue it fixes. **Pull requests
  write** also reads review comments, for `address the review on #46`.

### 2. Your accounts

- **`SHIPIFY_ACCOUNTS`,** a variable on Shipify's repo, holds the logins of the orgs and user
  accounts that count as yours, besides Shipify's own. Your own user account is one you can add.
- **A repo is yours** when it's on Shipify's own account (as today), or on a listed account where
  the repos App reaches it.
- **Listed, but the App can't reach the repo:** the run says which is missing (the App on that
  account, or that repo among its choices) and links the fix.
- **Installed by someone, but not listed:** the repo is outside, exactly as in 0044. A public repo is
  read in the read profile; a private one isn't found.
- **Names:**
  - `<account>/<repo>` everywhere: in a title (`sprinto/api: …`) and after `look at`;
  - a bare name stays a repo on Shipify's own account, as today;
  - in the `owner/name` form a repo name may have dots (`sprinto/web.app: …`), which 0044 left
    for later. That works on Shipify's own account too.

### 3. One task, one account

- **A task's account** is its repo's. It comes from:
  1. its state, once it has one;
  2. else its title's `<account>/<repo>:`;
  3. else the first listed account its `look at` names.

  With none of these, it's Shipify's own account, as today.
- **A run works on its task's account,** plus any public repo it reads outside your accounts (0044's
  read profile). Two cases get the same reply, "ask in a task of its own":
  - a `look at` of a repo on a second account of yours;
  - a repo on Shipify's own account, looked at from another account's task.
- **What a run on another account holds:**
  - the key to its one repo: read while it thinks, write after;
  - Shipify's copy (its rules, playbooks and skills), as every run has;
  - the agent's login.
- **What it doesn't hold:** your notebook, your tools' keys or your other repos.
  - **Why:** that account's repos are written by other people too, such as colleagues and their
    dependencies. Leaving these out keeps your private data out of their reach (the "lethal
    trifecta" again), and your notes out of their work.
  - **How:** the run reuses the switch that keeps them out of a read run (`think.ts:165-166`,
    `:329-332`).
  - **Its notes** wait for your yes, as after the web.
- **Its profile** is talk or work, as on your own repos: commands, the web, its tests. Only what it
  holds differs.

### 4. Tokens: the App on that account

**The rule:** a run's token for a repo comes from the App on that repo's account. It's minted right
before the step that needs it. Shipify's own account uses the bot, as today; any other account uses
the repos App.

`task.yml`'s run job after this (new or changed steps in bold):

1. **The task** (`ship run task`): the run's one read of its task (the issue, its comments, its
   status) moves out of plan into a step of its own. It still uses the run's own GitHub token. It's
   saved for plan, and its output is the task's `account`.
2. **Plan's read token:** one step, as today, with the App and the owner chosen by `account`.
3. Plan: as today. Its reads of the task's repos, PRs and checks are on the task's account.
4. **The agent's tokens:**
   - on Shipify's own account, one token, as today;
   - on another account, two. Shipify's (`repositories: shipify`) reads the task. The repo's (the
     repos App, `repositories: <repo>`) is the agent's `GH_TOKEN` and its clone's key.
5. Decide and apply's read token: as today.
6. **The write token:** one step, as today, with the App and the owner chosen by decide's
   `account`. It's still for one repo, and `workflows` is never asked of the repos App.
7. **The github job** starts with the task step too, and its token comes from the App on the task's
   account. On another account it only closes the task's PRs (after `start over`, or a close as not
   planned), with pull requests and contents write.

- **A failed mint** for another account is caught (`continue-on-error`), and plan tells it once,
  with its fix.
- **With no account listed,** every step does what it does today. The task step is plan's own read,
  moved.
- **The key stays where it is:** in GitHub's secrets, handed only to the pinned mint action.

### 5. A PR on another account, from open to merged

- **It opens:** the task waits for you (needs you), as today.
- **Its checks** run in the repo's own CI.
  - The watch can't read another account (one token per account per job), so Shipify doesn't
    follow them. You see them on the PR, and GitHub notifies you.
  - `fix the checks` starts a run. Its agent reads the checks (actions read) and fixes them.
- **Merged:**
  - the PR's `Closes <shipify>#n` closes the task, if GitHub allows that across accounts. The live
    check settles it;
  - either way, the task's next run reads the PR's real state with that account's token, and says
    whether it was merged or closed;
  - `close` closes the task, as always.
- **After `start over`, or a close as not planned,** the github job closes the task's open PRs with
  that account's token.
- **No preview, no deploy, no "Live":** those belong to the projects extension.

### 6. A repo's PR goes against its default branch

- **On a repo that isn't a project,** on any account:
  - think clones the repo's default branch;
  - the task's branch is cut from it;
  - apply clones it, and the PR targets it;
  - `refresh` merges it.

  0044 refused any default that isn't `main`. That suited one owner's repos, but not a company's
  `master` or `develop`.
- **Never pushed to:** a repo's default branch joins `main` and `production` on the list Shipify
  never pushes to. Apply still pushes only to `task/<n>…`.
- **A project keeps `main`,** since the pipeline is built on it.
- **The default branch** comes from the repos list, which already reads it (`RepoRef.branch`).

### 7. One PR format

- **The repo's own PR template comes first,** filled in. It's looked for in
  `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`, `docs/` and the repo's root.
- **Otherwise, Shipify's format:**

  ```
  <what changed and why: a few lines a reviewer reads first>

  ## Changes
  - <area>: <what>

  ## Checked
  - `<command>`: passed
  - Left to CI: <what this box couldn't run, and why>

  ## Notes
  <risks and follow-ups, only when there are some>
  ```

- **The title** follows the repo's style (Conventional Commits when its history uses them), in
  under 72 characters.
- **The footer** is the core's, on every PR: `Closes` or `Part of <shipify>#n`, then `Made by
  <agent> with Shipify`. Only on Shipify's own account does it also link the run, since the run's
  page is private to you.
- **Commits** carry the name of the App that pushes them (`<slug>[bot]`, with GitHub's noreply
  address), so GitHub shows them as Shipify's. Today's box commits say "Shipify task"
  (`think.ts:739`), and nothing reads that name.
- **Who does what:** the playbook (`playbooks/task.md`) says the format once, and the agent writes
  it. The core adds the footer and refuses an empty body. Projects' PRs use the format too.

### 8. Setup, checks and words

- **`ship bot repos`** creates the App, `ship bot repos <account>` adds an account, and `--remove`
  takes one off. Each shows its plan first, then runs with `--yes`.
- **`ship setup`** names it as an optional step after the bot.
- **`ship doctor` and `ship box list`** show the repos App and your accounts.
  - Doctor shows an account's install state where your own GitHub login can read it (as an org's
    admin can).
  - Otherwise, it says that the first task there will tell.
- **`intents.json`:** `change`'s words become `<project or repo>: …`, where a repo can be
  `<account>/<repo>`, with one more help example. The intents stay six.

### 9. Masking that knows today's tokens

Since a rollout from 2026-04-27, GitHub's installation tokens are `ghs_<app id>_<JWT>`: about 520
characters, with `_` and two dots. Every token a run mints, the agent's own `GH_TOKEN` included,
has that shape. Neither check catches it today: masking (`mask.ts:11`) and the secret scan
(`safety.ts:87`) both expect `ghs_` followed by 30 letters or digits.
- **Where a token could show today:**
  - a reply or a chat message: the agent's words, git's errors, a run's log lines;
  - a push: a token committed by mistake.

  GitHub's own log masking hides only the exact values its action minted, and only in the Actions
  log.
- **The fix:** both patterns take `gh[pousr]_` followed by letters, digits, `_`, `.` and `-`, at the
  same 30-character minimum, so the old shape is still caught.
- **One pattern, two users:** the masking is `cli/contracts/`, shared by the box and the edge, which
  redeploys itself after a merge that touches it (`ci.yml`).
- **Why first:** it guards today's runs, whatever else this ADR changes.

## Edge cases

- **Someone you don't know installs the App:** that gives you access to their repos, and nothing of
  yours to them. Their account isn't yours until you list it, so a `look at` there is outside:
  read only, with no key.
- **A listed account, but the App isn't on the repo:** told, with the install link, or with the link
  to the install's repo choices.
- **An org whose owner must approve:** the request waits on GitHub, and the first task says it's
  still pending (the mint finds no installation).
- **An org with an IP allow list:** GitHub refuses the box's calls with a 403. Told, with the fix:
  the org adds the box's address, or turns on "allow GitHub Apps' IP lists".
- **An org with SSO (SAML):** GitHub's docs ask for SSO authorization only for people's own keys.
  The person installing may need an SSO session.
- **`main` requires signed commits:** git pushes Shipify's commits unsigned, so GitHub blocks the
  merge, a squash merge too. The PR's reply says so, read from the branch's rules. Verified commits
  are left for later.
- **A ruleset limits who creates branches** (`task/*`): the push is refused. Told, with the fix:
  put the App on the ruleset's bypass list, or allow `task/*`.
- **Required reviews and code owners:** the PR waits for them. That's GitHub's job; Shipify only
  opens the PR.
- **A CLA or DCO check:** a bot can't sign a CLA or certify a DCO. The PR's reply says so, and the
  person merging signs.
- **The same repo name on two accounts** (`api` on Shipify's own and on sprinto): the bare name is
  always Shipify's own account's. Sprinto's is `sprinto/api`.
- **A renamed or moved repo:** GitHub redirects git and the API. A repo moved to an account you
  haven't added can't be reached: told.
- **The App is uninstalled while a task waits:** the next run's mint fails, and it's told.
- **A token's hour:** as on your own account. Think's clone happens at the start, the write token
  comes after the agent, and nothing long-lived holds a key.
- **Rate limits:** each installation has its own, from 5,000 calls an hour. A task uses a few
  dozen.
- **Two tasks on two accounts at once:** each run mints its own tokens in its own job, and slots
  never share them.
- **Your own user account:** works like an org, once it's added and the App is installed there.
- **A colleague merges the PR:** whether the task closes depends on GitHub's close across accounts
  (the live check). If it doesn't close, the task says the PR was merged on its next run, and
  `close` closes it.
- **The PR's footer names your Shipify repo** (`<you>/shipify#12`). People without access see a link
  they can't open, and nothing more.
- **The agent's login on company code:** the agent is yours, on your subscription. Whether your
  company allows it on its code is up to your company and you, not Shipify. The docs say so.

## What it never does

- **It never merges a PR, pushes to a default branch, or deploys outside a project.**
- **It never asks another account for administration, secrets or workflows,** and it has no
  webhook.
- **It never puts Shipify's files in a repo** unless you ask, and it never changes a workflow file.
- **It never carries your notebook, tools or other repos** into another account's run.
- **It never puts a token on a command line or prints a key,** and it adds no service.
- **It changes nothing on Shipify's own account.** With no account listed, every flow is today's:
  the bot, its tokens, previews, deploys and the watch.

## Contracts it touches

| Contract | Change |
|---|---|
| The snapshot (`kernel/types.ts`) | `RepoRef` carries its `account`; `Think` carries an `account` when the task isn't on Shipify's own |
| The task's state (`lib/task.ts`) | `project` may be `<account>/<repo>` |
| `task.yml` | the task step; each mint's App and owner chosen by the account; the agent's second token; the github job's |
| The agent contract | none: what a run holds is the core's switch |
| Masking (`cli/contracts/mask.ts`, the box's and the edge's) and the secret scan (`lib/safety.ts`) | GitHub's new token shape |
| `intents.json` | `change`'s wording and one help example; still six intents |
| Projects, stacks, channels, tools, checks, recipes | none |

## Setup

- **New, and optional:** the repos App (`pnpm ship bot repos --yes`), then each account you add.
- **Nothing changes** for anyone who adds none.
- **`ship doctor`** checks the App's variables and key, and names any missing step.

## Docs and clean-up

The build updates, in the same PR:
- **`README.md`:** first, what Shipify is.
  - It's a framework you run: you ask in words, and it reads any repo and opens PRs its own way.
  - Projects, tools, agents and channels attach to it.
  - "Install it on another account" takes three lines.
- **`docs/tour.md` and `docs/design.md`:** the core and what attaches to it, the seven rules, and
  the two Apps.
- **`docs/setup.md`:** "Another account: the repos App", step by step, with each permission and
  why.
- **`docs/security.md`:** the trust list, what a run on another account holds, and the token rule.
- **`docs/tasks.md`:** `<account>/<repo>: …`, its PR from open to merged, and the default branch.
- **`docs/glossary.md`:**
  - **account:** a GitHub org or user. Yours are Shipify's own and the ones you add;
  - **repos App:** the small public App another account installs;
  - **repo:** may now be on any account of yours, not only Shipify's own.
- **`playbooks/task.md`:** the PR format, the repo's template first, and the default branch.
- **`docs/product.md`,** added with this ADR: the build keeps it true and marks step 1 of its road
  as built. `README.md` and `docs/tour.md` link it first.
- **The rest:** `intents.json`'s help, `docs/context.md`, `docs/roadmap.md` ("many owners" becomes
  this ADR, and the left-for-later list below moves there), `CHANGELOG.md` and the ADR index.

Code it removes: 0044's refusal of a default branch that isn't `main` (`decide.ts:814-817`), and
the box's "Shipify task" commit name.

## Build plan (one PR; each step test-first, ending with its tests, clean-up and docs)

1. **Masking for today's tokens.**
   - `mask.ts` and `safety.ts`, as in §9.
   - Tests: a made-up token in the new shape is masked and found, and the old shape still is.
2. **The repos App and your accounts.**
   - `ship bot repos [<account>] [--remove]`, with one manifest flow for both Apps, and
     `SHIPIFY_ACCOUNTS`.
   - Doctor, box list and setup show both Apps.
   - Tests: the manifest's permissions and `public`, adding and removing an account, and the plan
     shown without `--yes`.
3. **Names and trust.**
   - `<account>/<repo>` in titles and `look at`, with dotted names.
   - `RepoRef.account`, and the repos list from the task's account's installation.
   - `named()`, `readsOf()` and `repoFor()` by owner.
   - A listed account is yours; an unlisted one is outside.
   - Tests: listed, unlisted, not installed, and the same name on two accounts.
4. **The task step.**
   - `ship run task` saves the read that plan's snapshot makes today, and plan loads it.
   - Its `account` output.
   - Tests: the kernel-flow suite, and the snapshot unchanged by the split.
5. **Tokens.**
   - `task.yml`'s mints chosen by account, the agent's second token, and the github job's.
   - Think's token for the task and the agent's key kept apart.
   - Tests: `tests/workflows.test.ts` (each mint's App, owner, repositories and permissions, and
     today's steps when no account is listed), and a failed mint told.
6. **A run on another account:** no notebook, no tools' keys and no other repos. Its notes wait for
   your yes.
   - Tests: that run's prompt and the agent's environment.
7. **The default branch.**
   - Think's clone, apply's clone, the PR's base, and `refresh`.
   - The list of branches never pushed to.
   - A project keeps `main`.
   - Tests: the git-daemon suite, with a `master` repo.
8. **The PR format.**
   - The playbook's section.
   - The footer by account, the commits' name, and the refusal of an empty body.
   - Tests: apply's PR body on each account, and the commit author.
9. **Docs,** as listed above, then a full docs pass.

**Done means,** for each step:
- clean, and well tested;
- every failure told once, with its fix;
- configured, as `ship doctor` confirms.

## Confirmation: the live checks on homepi, in parallel

**Your go-ahead first:** these checks need a test account with the repos App on it. Your own user
account works, with one new private test repo whose default branch is `master`.

Posted at once, across the three slots:
- **`look at <you>/<test> …`:** it reads the private repo and answers.
- **`<you>/<test>: <a small change>`:**
  - it follows the repo's own rules;
  - it opens a PR against `master` in Shipify's format;
  - its commits show as the App;
  - the repo's CI runs.
- **A listed account without the App:** told, with the link.

Then, in order:
- **`start over` on that PR:** the PR is closed with the account's token.
- **You merge the new PR:** does the task close (`Closes` across accounts), and what does its next
  run say?
- **An unlisted account's private repo:** not found, and nothing read.

**The regression set on Shipify's own account, as today:** a change on spotter, a look, a plain
question, and a preview.

## Left for later

- **Verified commits:** apply makes the run's commit through GitHub's API, so it's signed, for repos
  whose `main` requires signed commits.
- **Following another account's checks and merges:** either the repos App's webhook to the door, or
  token minting off the box (on the roadmap). Either way, the watch could see other accounts.
- **Contributing to anyone's public repo:** a fork in your account, then a PR upstream.
- **Your notebook on another account,** if you want it there: an opt-in per account.
- **A task across two accounts.**
- **Moving Shipify's own account onto the repos App,** leaving the bot only the projects
  extension's powers.
- **Your own Shipify, for anyone:** step 2 of [the road](../product.md#the-road):
  - a copy anyone can make;
  - a core setup in four steps, on a user account or an org;
  - your files kept apart from Shipify's;
  - Shipify's updates arriving as a PR you merge.

  It gets its own ADR. Today someone else can already set up their own copy with `pnpm ship
  setup`.
- **Open source, a team on one Shipify, or a hosted Shipify:** each is your decision, weighed in
  [If you go further](../product.md#if-you-go-further-open-source-a-team-or-hosted).
  - Open source comes after step 2.
  - A team needs a design of its own.
  - Hosted isn't planned (free only, and keys stay with their owner).

## Decisions (the owner's; the recommended option first)

1. **What it gives:** a look and a PR, no adopt. *Not chosen:* making another account's repo a
   project.
2. **Your notebook and tools on another account:** left out. *Not chosen:* carried in.
3. **A repo's PR goes against its default branch:** yes, for repos that aren't projects. *Not
   chosen:* `main` only.
4. **Signed commits:** told now, verified commits later. *Not chosen:* built now, since that changes
   apply's push, the most-used path.
5. **One PR format on every PR,** projects' too, with commits in the App's name. *Not chosen:* the
   format on other accounts only.

## As built (2026-10-09)

One PR, as planned. Where it differs from the text above, and why:

- **Plan holds two read tokens on another account's task:** the bot's, as today, and the repos
  App's for that account. Each repo is read with its own account's key (`readTokenFor`). So a bare
  name of one of your own repos in that task's words is told ("on Shipify's own account: ask in a
  task of its own") instead of passing as a plain word.
- **The task step** is `readRecord` and `recordAccount` (`cli/kernel/snapshot.ts`), saved with the
  run's id. Plan and the github job carry on from it only when it's their own run's.
- **The agent contract gains `tools.only`** (the text said it changes nothing). pi keeps its
  gateway's settings in the run's tools folder, so a run can't drop `tools` and still reach its
  model. A run names the tools it offers instead, none on another account. Both adapters filter
  with the contract's `offered`, and the conformance test holds them to it.
- **The write token is two steps,** the bot's and the repos App's, one per App, run by decide's
  `account` and never both. Apply takes whichever ran. That reads more plainly than one step
  choosing its App by expression.
- **The agent's token on another account** is minted only when its run has repos there
  (`account_repos`). A failed mint stops the job, and the reply names the workflow's step, as for
  any. Plan's token for the account is the one caught: plan names the fix.
- **An empty PR description isn't refused:** it becomes the run's reply, so no run is wasted.
- **Where the repos App shows:** `ship box list` and `ship setup`, where the bot shows, not `ship
  doctor` (that one checks this machine).
- **The pre-push scan:** gitleaks gets Shipify's config (`cli/lib/gitleaks.toml`), its own rules
  plus the stateless token's. It was checked with the real gitleaks 8.30.1: the old shape found by
  its rule, the new one by ours, and neither before. The projects' pipeline keeps gitleaks'
  defaults, since changing it moves `v1`; it waits for that release ([roadmap](../roadmap.md)).
- **`ship pr` on the PC** says the same made-by line ("Made by … with Shipify in this run").
- **The commits' name** is the pushing App's on Shipify's own account too (the bot's), as one
  format said. With no App named (off a box), it's "Shipify".
- **A talk run on another account** lists only that account's repos to clone itself, and its key
  reaches every repo the App reaches there, as a talk run on Shipify's own reads every project.
  The agent's token there asks for checks read too, for `gh pr checks`.
- **The github job's token on another account** is for the repos of the PRs it closes
  (`pr_repos`). A close it can't make, the App gone from there say, is told once, naming the PRs
  to close by hand. Before, a close that failed was dropped silently.
- **Told by GitHub, not read first:** a signed-commits rule is read from the base branch's
  rulesets and said in the reply. A classic protection rule needs more than the App's permissions,
  so GitHub says it on the PR itself. A ruleset that limits who creates branches, a CLA or DCO check,
  and an IP allow list are GitHub's own refusals, which reach the reply through the push's and the
  calls' failure paths. `docs/setup.md` lists each, with its fix.
- **`docs/design.md` keeps its system rules** and adds the eleventh ("trust is yours to give").
  The seven rules a person reads are `docs/product.md`'s.

From the second review (correctness and security):
- **An account is pinned by GitHub's id** (`SHIPIFY_ACCOUNTS` holds `login:id`, as `ship bot repos`
  writes it). A login given up and registered again by someone else is another id: the task says so
  and works nowhere there.
- **The repos App can't reach the account:** the box answers itself, with no agent run, naming the
  cause in GitHub's words where it gave some, and the fix.
- **A title's `owner/name`** is a repo only on one of your accounts, or when GitHub has it on
  someone else's (then it's told how to add the account). Otherwise it's plain words, as before:
  `CI/CD: …` stays a question.
- **A repo on Shipify's own account, named by its full name** (`o/shipify: …`), is the same as by
  its own name: Shipify itself keeps its checks.
- **A new project's task stays on Shipify's own account,** whatever its words look at.
- **A run that keeps a repo's own rules asks for no publish and sets no plan;** both are Shipify's.
- **A run on another account's replies have their images made inert,** and its PR's title and body
  are masked, since other people read them.
- **The repos list reads every page** (an org can have more than 100 repos), and each call returns
  a copy, so one run's list never reaches another's.
- **A default branch the box can't take** (a name with `+`, `@` or a letter outside ASCII) is told
  with its fix: rename it.
- **What's still in reach** of a run on another account: commands, the web, the agent's login and
  Shipify's copy, as for every talk and work run (the agents' firewall is on the roadmap).

**Checked:**
- `pnpm verify` passes.
- New tests:
  - `tests/accounts.test.ts`;
  - decide on another account (named repos, the fixes, one account per task, what a run there
    holds);
  - three end-to-end runs (`tests/kernel-flow.test.ts`): a change on a `master` repo there, from
    the task step to the PR, its commits in the App's name and its footer without the run; the
    App missing; `start over` closing its PR with that account's token;
  - the workflow's mints (each App, owner, repositories and guard);
  - the conformance test's `tools.only` for both agents;
  - the token shape, masked and found, and the gitleaks config;
  - titles in `owner/name` form, the repos App's manifest, and setup.

**Live checks (homepi, 2026-10-09):** every check passed, posted in parallel through the door.

On Shipify's own account, with no other account added (#269 to #273):
- a question, through the task step;
- a playground change: its PR in Shipify's format, the footer with the run's link, its commit
  as `shipify-pi[bot]`;
- a look at someone else's repo, in the read profile;
- `CI/CD: …` as a question;
- `look at aayush-t-apps/spotter` as your own.

None of the repos App's steps ran.

On the owner's user account, with the repos App on `aayush69work/shipify-test` only (default
branch `master`, with a PR workflow), #278 to #281:
- **a look:** the private repo read with the repos App's key, for that repo alone;
- **a change:** a PR against `master`, the write key the repos App's for that repo alone (code and
  PRs, no workflows), the bot's write step skipped;
- **a repo the App doesn't reach** (`aayush69work/nope`): told with the fix;
- **an account not added** (`torvalds/linux`): told it's only read, and how to add it;
- **`start over`** (on GitHub, the one place the word is taken): a new PR, and the github job
  closing the old one with the repos App's key for that repo;
- **the merge across accounts:** the PR's `Closes aayush-t-apps/shipify#279` closed the task by
  itself, and its run read the PR with that account's key and said Merged. That settles what the
  docs couldn't.

homepi ended each round with no agent process left and its disk steady.

**Found live, and fixed with these notes (#282):**
- **A change on a name the box refuses** (an account you haven't added, a repo the App doesn't
  reach, a repo on another account) cost one short agent run, there only to say it. Now, on a
  task's first run, the box answers it itself, with the fix, as it does for an account the App
  can't reach. Later words on that task still go to the agent, so you can ask about it.
- **Commands that only show their plan** exited with 3, which pnpm prints as "failed". A plan shown
  now exits 0, and `--json` still says `requires-approval`.

**Decided after the live checks (the owner, 2026-10-09):**
- **Nothing new follows another account's checks in the background.** "Left for later"'s
  "following another account's checks and merges" isn't wanted: nothing starts by itself, and you
  look at the PR and handle it.
- **When you ask why its checks failed, or to fix them,** a run reads them (`gh pr checks`, the
  failed runs' logs) and says why, or fixes the cause. The fix goes on the same PR while it's open,
  or in a new PR, from the default branch, once it's merged. The playbook says so, and every
  agent's token reads checks for it.
- **The existing flows stay as they are,** on Shipify's own account too.

## Sources

- **GitHub Apps:**
  - [making an App public or private](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/making-a-github-app-public-or-private);
  - [installing a third party's App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
    (repo admins; requests);
  - [requesting an App from your org's owner](https://docs.github.com/en/apps/using-github-apps/requesting-a-github-app-from-your-organization-owner);
  - [limiting App requests and installs](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/limiting-oauth-app-and-github-app-access-requests-and-installations);
  - [choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
    and [approving new ones](https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app);
  - [registering from a manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
    (`public`, an org's or a user's);
  - [modifying a registration](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)
    (public stays public while installed elsewhere).
- **Tokens:**
  - [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
    (`owner`, `repositories`, `permission-*`);
  - [creating an installation token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app);
  - [the new token format](https://github.blog/changelog/2026-04-24-notice-about-upcoming-new-format-for-github-app-installation-tokens/);
  - [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- **Workflows and CI:**
  - [permissions an App needs](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
    (workflows);
  - [triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
    (an App's PRs run CI);
  - [approving runs from forks](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks).
- **An org's policies:**
  - [IP allow lists](https://docs.github.com/en/enterprise-cloud@latest/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/managing-allowed-ip-addresses-for-your-organization)
    and [an App's own](https://docs.github.com/en/apps/maintaining-github-apps/managing-allowed-ip-addresses-for-a-github-app);
  - [SAML and GitHub Apps](https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/saml-and-github-apps).
- **Branches and commits:**
  - [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
    (signed commits and squash merges);
  - [commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
    (an App's API commits are verified);
  - [rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets);
  - [linking a PR to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
