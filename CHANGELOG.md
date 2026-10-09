# Changelog

All notable changes to Shipify. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions: [Semantic Versioning](https://semver.org/). Each release goes to the template
(`shipify: release`, [docs/releases.md](docs/releases.md)), and every copy takes it as one PR.
Projects pick up pipeline fixes through `@v1`, and stack majors through `pnpm ship upgrade`.

## [Unreleased]

## [0.1.0] - 2026-10-09

The first release of Shipify as a product: your own, started from "Use this template".

### Added

- **Your own AI engineer on GitHub:** ask from GitHub, Telegram or the web chat. A box of yours
  runs it, the agent only thinks (as its own Linux user, in a sandbox), and you approve on GitHub.
  Every message lives on a task, an issue on your copy.
- **Setup in four core steps** (`pnpm ship setup`), each checked for real: GitHub (your copy, on
  your account or an org), the bot, the agent's login, and a box. Everything else is an add-on
  that never blocks: chat and repeats (the door, the watch), plug-ins, other accounts, apps, and
  updates.
- **One way to make a box,** for a Pi, a VPS or this PC: `pnpm ship box add [<user@host>]`.
- **Apps and packages it builds stand on their own:** each carries its own pipeline (its stack's
  `ship.yml`, the same in every project), calling nothing of your copy's and handing no secret
  out. Previews when you ask, staging as a switch per app, releases that ask once. `ship upgrade`
  replaces the stack's own files and never touches the project's. Stacks start at 1.0.0, projects
  at 0.1.0.
- **Every repo, one kind of extension:** projects Shipify builds and deploys, and any other repo
  on your accounts, in its own way, by a PR a person merges. `/repos` lists them, and
  `remember <repo>: …` keeps what always applies to one.
- **The edge** (one Cloudflare Worker, free): the door for your chats, the watch every 5 minutes
  (repeats, reminders, alerts), and the status page, at its workers.dev address or your domain.
- **One list of settings** (docs/settings.md): what each is, where it lives, what sets and reads
  it, checked by setup, doctor and the tests.
- **Releases and updates:** `shipify: release` publishes a version to the template, and each copy
  is offered it as one PR (`update.yml`), keeping your plans, recipes, checks and app lists.
