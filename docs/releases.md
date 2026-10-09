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

- **On GitHub:** a task titled `shipify: release` (or `shipify: release` with "minor" or "major"
  in its words). Like every operation it starts on GitHub only; from a chat, the reply links there.
- **Or from this PC:** `pnpm ship template` shows the plan, `pnpm ship template --yes` does it
  (`--bump minor` or `--bump major` for a bigger step; patch by default).

It works from main as GitHub has it, in folders of its own, and:

1. **Shows the plan:** the version, its notes (every line under Unreleased), and the files: Shipify's
   own, never your plans, recipes or checks, and the forms' app lists empty.
2. **Checks them** as the template's CI will: `pnpm install`, then `pnpm verify`, on exactly the
   files to publish. If that fails, nothing is published or recorded: fix it in a PR, then release
   again.
3. **Records the version** on your main: `package.json` and `CHANGELOG.md`, one commit,
   "Shipify 0.x.y" (Unreleased becomes that version). Your CI tags it.
4. **Publishes** one commit, "Shipify 0.x.y", on the template's main. The template's CI releases
   `v0.x.y` with those notes.

**Safe to run again:** a release with nothing new says so; one stopped after step 3 carries on.

**The first release** makes the template, so it runs from this PC once, with your go:
`pnpm ship template <owner>/shipify-template`, then `--yes`. It's private, and marked as a
template; making it public later (open source) changes nothing here. Your copy's variable
`SHIPIFY_TEMPLATE` then names it.

## An update

Each copy's `update.yml` checks the template weekly (or Actions → update → Run workflow, or
`pnpm ship update` on its PC). When the template has a newer version than the copy:

- **One PR on that copy,** "Shipify 0.x.y", with the notes of every version since the copy's. A copy
  that skipped versions goes straight to the newest.
- **Shipify's own files** as the release has them; files the release no longer has go.
- **Kept as they were:** that owner's plans, recipes and checks, and the apps their forms list.
- **Nothing merges by itself.** Merged, its CI releases the version there and deploys its edge.
  Then `pnpm ship setup` and `pnpm ship doctor` name anything the new version asks of it: a new
  setting is on [the settings list](settings.md), so nothing is missed.
- **A PR its owner closed stays closed:** that version is skipped, and the next one is offered.
- **The copy where Shipify is built** is up to date by its nature: nothing is opened there.

**Which template:** a copy made with **Use this template** follows it at once (GitHub records it).
Any copy can name one with the variable `SHIPIFY_TEMPLATE`.

**A private template on another account:** the bot reaches only its own account, so its weekly
check needs a read-only key: a fine-grained token with access to the template alone, Contents
read-only. `pnpm ship setup` asks for it (the "updates" step) and sets it as the secret
`SHIPIFY_TEMPLATE_TOKEN`. On the template's own account, or once it's public, none is needed.

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
