# Releases and updates

Shipify is built in one copy and shared through a template (ADR 0047). Each copy is its owner's,
and takes each new version as one PR its owner merges.

| Repo | What it holds | Who changes it |
|---|---|---|
| **The copy where Shipify is built** | Shipify, and its owner's own files (plans, recipes, checks, tasks) | its owner, by PRs, as always |
| **The template** (`<owner>/shipify-template`, private or public) | Shipify's own files only: no plans, no history, no tasks | only a release: one commit per version |
| **Every other copy** (made with **Use this template**) | Shipify, and that owner's own files | its owner, by PRs; a new version arrives as one |

```
 change   →  a PR in the copy where Shipify is built  →  merged: live there at once
 release  →  shipify: release  →  checked, versioned, published to the template
 update   →  each other copy: a PR "Shipify 0.x.y"  →  its owner merges it
```

One direction only: nothing flows back from the template or the copies.

## A change

As always: ask (`shipify: …` on GitHub, Telegram or the web chat), a box opens a PR, you merge it,
and it's live on your copy. Its line goes under **Unreleased** in `CHANGELOG.md`, as every change's
does. The template doesn't change.

## A release

When you want others to have what's piled up, a week's changes or six months':

- **On GitHub:** a task titled `shipify: release` (`shipify: release minor` or
  `shipify: release major` for a bigger step), on GitHub or as a new task from any chat, like every
  operation.
- **Or from this PC:** `pnpm ship template` shows the plan, `pnpm ship template --yes` does it
  (`--bump minor` or `--bump major` for a bigger step; patch by default).

It works from main as GitHub has it, in folders of its own, and:

1. **Shows the plan:** the version, its notes (every line under Unreleased), and the files: Shipify's
   own, never your plans, recipes or checks, and the forms' app lists empty.
2. **Makes them safe to publish** (ADR 0055):
   - **Your private words replaced:** the variable `SHIPIFY_PRIVATE_WORDS`
     (`{"<word>": "<stand-in>"}`) lists words never published, such as an employer's name. Each
     is replaced by its stand-in, in the found word's case, in what's published only. Your copy
     keeps them.
   - **Then checked:** every file is checked for one of your words, a tailnet's name
     (`*.tail<id>.ts.net`), and anything the secret scan (gitleaks, pinned) calls a key. Anything
     found stops it, named by file, and nothing is published. It needs the scan: a machine where
     it can't run publishes nothing.
3. **Checks them** as the template's CI will: `pnpm install`, then `pnpm verify`, on exactly the
   files to publish, without your plans, recipes and checks. If that fails, nothing is published
   or recorded, and the reply names each failing test and its first error (the run's log has the
   rest): fix it in a PR, then release again. `continue` would only fail the same way. So a test
   never reads your own files: it makes what it needs in a temporary folder
   (`skills/test-driven-development`).
4. **Records the version** on your main: `package.json` (its version, and the template's name:
   below) and `CHANGELOG.md`, one commit, "Shipify 0.x.y" (Unreleased becomes that version). Your
   CI tags it.
5. **Publishes** one commit, "Shipify 0.x.y", on the template's main. The template's CI releases
   `v0.x.y` with those notes.

**Safe to run again:** a release with nothing new says so; one stopped after step 4 carries on.

**The first release** makes the template, so it runs from this PC once, with your go:
`pnpm ship template <owner>/shipify-template`, then `--yes`. It's private, and marked as a
template. Your copy's variable `SHIPIFY_TEMPLATE` then names it.

**Making it public** (ADR 0055), once, after a release with your words set:
1. **A fresh history,** if older releases carried words you now replace: the template's main
   becomes its newest release alone, and its older tags and releases go. Copies take files, not
   history, so none notices.
2. **Its settings on GitHub:**
   - **General:** public; Issues, Discussions, Wiki and Projects off.
   - **Moderation → Interaction limits:** collaborators only. It lasts 6 months at most; set it
     again when it ends.
   - **Actions → General:** "Require approval for all external contributors". Its workflows never
     run on a pull request, and do nothing without a copy's variables, so this is a second guard.
   - **Security:** secret scanning and push protection on.
3. **A licence** of your choice: without one, people may read it but not reuse it.

**The box's image** (ADR 0056): after each release on a public template, its CI builds
`ghcr.io/<owner>/shipify-box` on GitHub's x64 and arm64 machines, and tags `:<version>` and
`:latest`. A private copy's CI never builds it. The first time, check that the package is public:
the template → Packages → `shipify-box` → Package settings → Visibility.

Then anyone, you included, makes a box with one command from the release (box-setup.md), and a
copy updates with no key (`SHIPIFY_TEMPLATE_TOKEN` is only for a private template).

## An update

Each copy's `update.yml` checks the template weekly (or Actions → update → Run workflow, or
`pnpm ship update` on its PC). When the template has a newer version than the copy:

- **One PR on that copy,** "Shipify 0.x.y", with the notes of every version since the copy's. A copy
  that skipped versions goes straight to the newest.
- **Shipify's own files** as the release has them. Only what the template itself took out since
  the copy's version goes: a file the copy added (a tool, a channel, an agent) stays. When the
  template has no release of the copy's version, nothing goes, and the PR says so.
- **Kept as they were:** that owner's plans, recipes and checks, and the apps their forms list.
  Dependabot's config stays where Shipify is built: a copy gets its dependency updates with each
  version.
- **Nothing merges by itself.** Merged, its CI releases the version there and deploys its edge.
  Then `pnpm ship setup` and `pnpm ship doctor` name anything the new version asks of it: a new
  setting is on [the settings list](settings.md), so nothing is missed.
- **A PR its owner closed stays closed:** that version is skipped, and the next one is offered.
- **The copy where Shipify is built** is up to date by its nature: nothing is opened there.

**Which template:** a copy made with **Use this template** follows it at once. Each release writes
the template's name into its `package.json`:

```json
"shipify": { "template": "<owner>/shipify-template" }
```

and every copy has it from there, whoever can read what. In order, a copy follows the variable
`SHIPIFY_TEMPLATE` (any copy can name one: it overrides), then that field on its main, then the
template GitHub says it was made from.

**A private template on another account:** the bot reaches only its own account, so its weekly
check needs a read-only key: a fine-grained token with access to the template alone, Contents
read-only. `pnpm ship setup updates` asks for it when the template is private or can't be read
from this PC, sets it as the secret `SHIPIFY_TEMPLATE_TOKEN`, and keeps a copy here, so `ship setup`
checks it still reads the template. Expired or wrong: `pnpm ship setup updates --new`. On the
template's own account, or once it's public, none is needed.

## Versions

- **One number,** `package.json`'s, set by a release: patch for fixes, minor for new things, major
  for what asks something of copies. The template's tags (`v0.x.y`) are the product's releases.
- **A release is the push that sets a new version:** each copy's CI tags it. Projects take nothing
  from it: each carries its own pipeline (ADR 0048). A tag of the same name from a copy's own past
  stays as it is.
- **What a change asks of a copy** (a new setting or key) goes in its CHANGELOG line, so the update
  PR says it.

## In the code

| File | What |
|---|---|
| `cli/commands/template.ts` | `ship template` (a release) and `ship update` |
| `cli/lib/template.ts` | what's yours and what's Shipify's: the one list |
| `.github/workflows/update.yml` | each copy's weekly check |
| `.github/workflows/ci.yml` (`release`) | tags a version |
| `cli/kernel/github-job.ts` | `shipify: release` from a task |
