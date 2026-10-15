---
status: accepted (merged #294) and built (#296–#298; the owner's go on 2026-10-09); see [As built](#as-built-2026-10-09)
date: 2026-10-09
supersedes: 0004 (one reusable pipeline every project calls at `@v1`)
amends: 0005 (stack versions and migrations restart), 0031 (`v1` goes), 0047 (the clean start reaches projects)
---

# 0048: Each project carries its own pipeline, and nothing from before stays

## The owner's asks (2026-10-09)

- "do we need to update or add any dependency in projects or we can clean them … best way to
  decouple end to end … make them robust independent"
- "no need to think backward compatibility … they are test apps and all can start from 0.1.0 …
  simple ci flow and everything run less and cheap way"
- "staging preview and all guided and followed rules all apply the same and clean"
- "check all this … not needed outdated code we can remove … keep the core intact … simplified
  overall code … check anything if we have missed … from old flows"

## Context

Every project's `.github/workflows/ship.yml` calls Shipify's own pipeline,
`<owner>/shipify/.github/workflows/pipeline.yml@v1`, with `secrets: inherit` (ADR 0004). Now that
copies come from a template (ADR 0047), that link is the weakest part left:

- **A new pipeline reaches every app at once, untried.** Merging a Shipify update moves the copy's
  `v1` (ci.yml's release job), and every app runs the new code with all its secrets on its next run.
  Nothing is canaried, and no app's repo shows a change.
- **An app depends on its copy's repo:** its name (`shipify` is typed into `ship.yml:42`), its
  account, its access setting and its `v1` tag. Rename, move or delete the copy, and every app's CI
  fails.
- **Upgrades need a copy's history:** `ship upgrade` merges an app's files against the stack as it
  was, found in the copy's git history. A copy made from the template has one commit, so it has none.
- **Workarounds cost minutes:** the `merged` job polls up to 5 minutes after every merge in every
  app, for one missed push run seen once; `make -n` guards keep Makefiles older than their targets
  working.

And a sweep of the code found about 40 things kept only for the past.

## What was found (checked 2026-10-09, `main` at `e798be0`)

| Fact | How it was checked |
|---|---|
| All three projects call `aayush-t-apps/shipify/...pipeline.yml@v1` (`ship.yml:35`), are on stack 1.5.0 (the stacks are at 1.5.1), and have `"staging": false` | their `ship.yml` and `shipify.json` in `../projects/` |
| `v1` moves whenever a release finds `pipeline.yml` changed (`ci.yml:166-172`); every app then runs it, inheriting every secret | ci.yml; `stacks/_base/files/.github/workflows/ship.yml:42-49` |
| Billed minutes per app: a merge 2 (main + `merged`), a preview push 3, a README-only merge 2 | `gh run view` on spotter, playground and links runs |
| Shipify's own runs, last 300 (2.2 days): about 112 GitHub-hosted minutes (88 of them `ci` verify, 3.5 a merge, because those PRs didn't carry `ship pr`'s checked mark), about 580 on boxes (free) | `gh run list` and each run's jobs |
| `ship upgrade` merges against a baseline from the copy's git history (`upgrade.ts:96-106,141-152`); none in a one-commit copy | the code; ADR 0047 (a copy starts with one commit) |
| The workflow rule (a pushed workflow must equal the stack's render, `cli/kernel/workflows.ts:26-37`) works for a pipeline that's an owned file; `.github/actions/` isn't checked, though its setup action runs in jobs with keys | the code |
| The render can't nest `#if` and must hold no machine-specific placeholder, or a box and the PC render differently (`render.ts:22,37`, `generate.ts:71-76,97`) | the code |

## Options

- **A. Keep the reusable pipeline, pinned by commit:** `uses: …@<sha>`, moved by `ship upgrade`.
  (+ reviewed per app / − apps still need the copy's repo, its name and its access; secrets still
  cross repos)
- **B. Each project carries its own pipeline:** `ship.yml` holds its jobs, rendered by its stack,
  owned (replaced by `ship upgrade`), checked by the workflow rule. (+ an app needs nothing from the
  copy; no secret crosses repos; a pipeline change is a PR in each app, like every update / − a
  longer file in each app; a pipeline fix is an upgrade PR per app)
- **C. Projects as any repo, with CI of their own:** Shipify reads a status contract. (+ fully
  independent / − previews, health checks and rollbacks stop being the same everywhere; the most
  work)

## Decision

**B**, and the clean start reaches projects: nothing kept for an older app, stack or box.

### 1. Each project's pipeline is its own

`.github/workflows/ship.yml` in each project holds every job it runs, with no `uses:` of Shipify's
and no `secrets: inherit` across repos. Two renders cover every kind (a later layer's file replaces
an earlier one's, as the Makefiles do):

| Render | For | Jobs |
|---|---|---|
| `_cloudflare` | ts-worker, ts-static | **preview** · **unpreview** · **main** · **production** (staging apps) · **ops** |
| `_base` | custom-app, custom-package, ts-package | apps: **main** · **ops**; packages: **main** only (no PR runs at all) |

- **preview,** only when asked (the PR's `preview` label; a task's `preview` word adds it): the PR's
  code bundled with no keys and a read-only token, deployed from a fresh runner (ADR 0030 §0). The
  box ran the checks and the tests before the PR, so it doesn't run them again.
- **unpreview:** a PR closed unmerged with the label. A merge's deploy takes previews down itself.
- **main:** a push to `main`, or Actions → ship → **deploy** by hand: the mark `shipify/main`
  (what the watch follows), a bot's push refused (the first publish aside), the secret scan, setup,
  audit and the check, then (unless the app is down) the deploy to production, or to staging for a
  staging app; its health check; a release tag when the version is new; a rollback when the health
  check fails.
- **production** (staging apps): the commit that passed staging, deployed, checked, tagged.
- **ops:** rollback (to a tag), and the down and up that `ship down` and `ship up` start.
- **Docs-only changes run nothing:** `docs/**` and `*.md` are ignored.
- **The same on every machine:** the render holds no machine's setting, so the workflow rule's
  check gives the same answer on a box and on the PC.

### 2. Staging and preview stay, each one way

- **Staging is a switch per app:** `pnpm ship staging <app> on|off` (the plan first, then `--yes`,
  then its PR). On, a merge deploys to staging and `<app>: release` opens the release PR against
  `production`, which you merge.
- **A release asks once, and never waits:** if staging hasn't passed `main`'s newest commit yet, it
  says so, and you release again once it has. Today it polls for up to 25 minutes on GitHub's
  machine.
- **A preview is only on request,** as now, and goes when its PR closes.
- **Both are guided and checked like every other step:** their plans, their docs, their tests.

### 3. Upgrades replace, never merge

- `ship upgrade <app>` renders the current stack: each owned file is replaced; a file the stack
  owned and no longer renders goes; the project's own files are never touched.
- **Gone:** the baseline from the copy's history, the three-way merge and the old variable names
  (`legacyVars`).
- A migration note stays only for a step a person must do by hand.

### 4. A fresh start for stacks and projects

- **Stacks restart at 1.0.0,** and all 33 migration notes (1.0.1 to 1.5.0) go.
- **A new project starts at 0.1.0** (`INITIAL_VERSION`).
- **The three test apps** (links, playground, spotter) get one PR each: the new owned files, version
  0.1.0, a fresh CHANGELOG; their own code stays. You merge each; its CI deploys it.

### 5. What goes from Shipify

- **The pipeline and `v1`:** `.github/workflows/pipeline.yml`; ci.yml's `v1` move and the pipeline's
  actionlint (each kind's rendered `ship.yml` is linted in the golden tests instead).
- **What only `v1` needed:** `validateProject`'s pipeline check (`project.ts:107-111`); setup's
  "let your projects' repos use its workflows" (`actions/permissions/access`) and its `v1` check.
- **Workarounds:** the `merged` and `redeploy` jobs (a missed push run, rare, is said by the watch
  for a merge a task follows, with the fix: **deploy** from Actions); every `make -n` guard for an
  older Makefile; "predates" notes.
- **`pause` and `resume` as commands:** `down` and `up` already do it (the Operate form offers only
  them). The pipeline keeps them as the steps `down` and `up` run.

### 6. What the sweep removes from the core

Kept only for the past, each with no one who needs it now:

| Area | Goes |
|---|---|
| Boxes | `box/setup.sh`: removals of old file and folder names (52shipify-reboot, `/opt/shipify/ms-playwright`, the pre-ADR 0041 `.env` lines, `_work/_tool`), the unused container mode (`SHIPIFY_BOX_NO_SERVICE`); "setup 5" in the guides (the number stays, as a counter) |
| CLI | `OLD_SHARED` and its freed-space count (`sandbox.ts`, `watch.ts`); `stopsLabel` and `resume` re-adding the repeats label (repeats from 0.1.8); the due run's "deploying label left from before ADR 0046"; `TaskState.executor`; `stuck: 0` in the lifecycle; screenshots (`shots` in schemas, stacks and `shots.mjs`); presets' unread `recommendedFeatures` and `layout` |
| Edge | the redirects for the old `/status` and `/status/chat` addresses; "an older one says status" in page setup; old wording in `worker.ts` |
| Workflows | task.yml's `send` verb (1.x); watch.yml's removal of the runner's pre-ADR 0041 browser cache |
| Stacks | "screenshots on its task" in their AGENTS.md |
| Tests | the tests of each removed piece (about 15), and the upgrade test that needs this repo's 1.0.0 history |
| Docs | every "set up before …", "older …", "setup 5" and "status path" line; the shots setting |

Kept on purpose: the record's and state's format versions (`v: 2`) and `TOOLS_VERSION`, which
refuse a newer file than the code knows; the box setup's version counter, which brings boxes up to
date.

### 7. Shipify's own CI runs less

- **Every PR made with `ship pr`** carries its checked mark, so the merge's run is the fast check
  (about a minute, not 3.5). The agent's and these builds' PRs use it.
- No pipeline to lint or `v1` to move; the golden tests keep their five combinations (staging
  stays), and render and lint each kind's `ship.yml`.

## Edge cases

- **A push GitHub starts no run for:** nothing deploys; for a merge a task follows, the watch says
  so after 30 minutes, with **Actions → ship → deploy**. Rare (seen once), and costs nothing until
  then.
- **A hand edit to a project's `ship.yml`:** refused at push by the workflow rule unless it's the
  stack's render, as now; `.github/actions/` is checked the same way from now on.
- **A pipeline security fix:** a stack patch, then `<app>: upgrade` for each app: one PR each, which
  you merge. Shipify can open them all at your ask.
- **The copy renamed, moved or gone:** the apps keep building and deploying; only the tasks that
  change them stop.
- **A staging app's release before staging passed:** "staging hasn't passed `main`'s newest commit:
  release again once it has", and nothing waits.
- **A project on another account:** unchanged: Shipify builds projects on its own account only.

## Setup

Nothing new. Setup's apps step gets shorter: no workflow access to grant, no `v1` to wait for. An
app's repo needs nothing from the copy beyond what `ship publish` already sets (its deploy key and
values).

## Docs and clean-up

- **Updated:** AGENTS.md (the platform no longer holds the pipeline; `v1`'s rule), README,
  design.md (the pipeline section), process.md, operations.md, troubleshooting.md, tour.md,
  end-to-end.md, glossary.md, configuration.md, releases.md (no `v1`), setup.md, cli.md (upgrade,
  staging, release, no pause/resume), security.md ("Every project's pipeline"), roadmap.md; the
  stacks' AGENTS.md and README templates; `guides/plan-template.md`; `playbooks/` (plan-app,
  build-app, task, fix-ci, parallel-work).
- **Gone:** `.github/workflows/pipeline.yml`, the 33 migration notes, `stacks/_cloudflare/shots.mjs`,
  every line the sweep lists.
- **ADR index:** 0004 superseded by this one.

## Build plan

1. **One PR in Shipify:** the two `ship.yml` renders and their tests (golden renders linted), the
   upgrade simplified, stacks at 1.0.0, the pipeline and `v1` gone, staging's release asking once,
   the sweep's removals, the workflow rule over `.github/actions/`, and every doc. `pnpm verify` and
   `pnpm test:golden` before it.
2. **One PR per test app,** opened by `ship upgrade`: the new `ship.yml` and owned files, 0.1.0, a
   fresh CHANGELOG. You merge each; its CI deploys it, which is the live check.

## Consequences

- **Easier:** an app is whole on its own; no secret crosses repos; Shipify's CI has no tag to move;
  upgrades are a plain replace; about half an app's minutes per merge; less code everywhere.
- **Harder:** a pipeline fix reaches apps by an upgrade PR each, not by itself; each app's
  `ship.yml` is longer.

## Confirmation

- The golden tests render every stack's `ship.yml`, lint it, and fail on any `uses:` of Shipify's.
- The workflow rule's tests cover `.github/actions/`.
- Each test app's merged fresh-start PR deploys it, and `/apps` says live.
- A search for the removed names (`pipeline.yml@v1`, `legacyVars`, `OLD_SHARED`, `shots`,
  `stopsLabel`) finds nothing outside the ADRs.

## As built (2026-10-09)

Built in #296, with #297 (an unused YAML anchor actionlint found, now caught by a test).

- **One pipeline file for every kind,** not two renders: `stacks/_base/files/.github/workflows/ship.yml`
  reads the kind, staging and the rest from `shipify.json` when it runs, so it's the same file in
  every project, with no placeholder or condition to render, and actionlint checks it directly.
- **An upgrade touches only the stack's owned files** (replaced, or gone when the stack no longer
  renders one): it adds no new default to the project's own files either, since without history
  it can't tell a new default from a file the project deleted. A migration note says what to add by
  hand. The staging switch still merges, from two renders of the same stack.
- **Stack `package.json` templates** start at 0.1.0 too, matching `INITIAL_VERSION`.
- **Task runs fetch Shipify shallow:** nothing reads its history now (checked: a local clone from a
  shallow checkout works).
- **Live:** links, playground and spotter each took one fresh-start PR (stack 1.0.0, version 0.1.0,
  their own `ship.yml`); each merge's own pipeline deployed it, passed `/health` on the merged
  commit, and tagged v0.1.0 (playground cuts no releases).
