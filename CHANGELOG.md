# Changelog

All notable changes to Shipify. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions: [Semantic Versioning](https://semver.org/). Each release goes to the template
(`shipify: release`, [docs/releases.md](docs/releases.md)), and every copy takes it as one PR.
Projects pick up their stack's changes, their pipeline's included, through `pnpm ship upgrade` (ADR 0048).

## [Unreleased]

## [0.1.12] - 2026-10-17

### Changed

- **Steady runs (ADR 0061).** When the agent fixes an answer its schema refused, the fixed one is
  taken, never the file it wrote first (#506). A slip in an answer's shape no longer ends the stay:
  the reply says what didn't fit, and your next words go to the same session. The prompt says that
  content too long for a field goes into a file, and the playbook that a big change starts as a
  proposed ADR.
- **Roomy boxes (ADR 0061).** `box add` turns on swap in memory (zram, half the memory,
  compressed) on a box with no swap of its own, so tasks that overlap slow down instead of having a
  test killed; WSL, a VPS with a swap file, a container and a box without systemd keep theirs, each
  with a line saying so. `--slots` has no cap of 4 any more (`box add` and `here.sh`): past what memory or
  cores suggest, it warns. `box health` and the status task show the swap, the most each slot has used, and a task
  killed for memory. Box setup is version 6: `ship doctor` names a box set up before it, and
  `pnpm ship box add <box> --yes` again brings it up to date. `box/load-test.sh` measures N tasks'
  checks at once on a box.
- **One writing rule for people and agents.** `playbooks/task.md` now has "How you write": use
  ASD-STE100 as a guide, with short sentences, active voice and one term per idea. Keep precision
  and say what is uncertain. `CONTRIBUTING.md` points to it.
- **Every answer stays (ADR 0060).** A run stays after any answer to your words, a work run's and
  one that opened a PR or asked you something included, unless it started another run or closed
  the task. On a project the stay pushes nothing: a change you ask of it starts a work run. What
  you write while a run works is taken in with no round count (3 before), until nothing new comes.
- **Long sessions (ADR 0059).** A run's agent works up to 200 minutes in one session (50 before),
  its fix round 20, and the job's limit is 460 minutes. Your `stop` and your words while it works
  are read with the workflow's own token, which lasts the job, so both work to the end; a read that
  fails says so in the run's details. A stay waits 20 minutes by default (10 before).
- **A PR opens up to date with `main` (ADR 0059).** After a work run's agent, a new step, the
  finish, fetches `main` with a key minted then; when it moved while the agent worked, the box
  refreshes the branch and checks it again before the PR. Where that stops, the PR opens as the
  agent left it and the details say `continue` brings it up to date.
- **A stay's turn reads your words twice (ADR 0057).** It read them five times (plan, think
  twice, decide, apply), about a second each on a box: now its plan's read, which apply takes, and
  one as the agent answers, which decide takes. Words after that are the next turn's.
- **Claude Code lists Shipify's skills alone.** Its own bundled skills and workflows (loop,
  schedule, claude-api, init and others) are off (`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`), so a
  run's agent isn't offered skills that never fit a task, and each prompt is a little shorter.

### Fixed

- **The web chat times a stay's answer, not the stay.** A task's row said "Working · 40m" for a
  10-second answer, and its header the same till the turn's status was read, then dropped to 0.
  Both now time the answer from its `working` status, and say "Starting…" or Staying till then.
- **The tasks doc says in one table when a stay answers and when a new run does.** For each kind
  of next words, it shows who answers, whether the agent's session carries on, and whether its cache
  starts warm. It also says why a change goes to a work run: the clone and the write key a PR needs.
- **The docs match long sessions (ADR 0059).** The glossary's stay is 20 quiet minutes (it said
  10), the catch-up needs 5 minutes left of the agent's 200 (it said 50), and old run folders are
  swept after 8 hours (it said 6). The security doc says the agent's own GitHub read lasts its
  token's first hour, and the tasks doc says what a cold run reads after a stay ends.
- **ADR 0059 says what a long run proved.** One work run on homepi kept its agent in one session
  for about an hour, then the box's checks, about 75 minutes in one step, with nothing failing.
  The live check is closed for now, and the ADR names what it didn't try.
- **Naming the model you're already on keeps the session (#497).** A stay compared the pick as
  written, so `use claude sonnet` while Auto ran Sonnet at medium, or `use claude sonnet medium`
  after `use claude sonnet`, started a fresh run. It compares the agent, model and effort the pick
  runs, Auto worked out as the run does; another model or effort is still a new session. The
  playbook tells the agent a `use` line is already applied, so it doesn't answer it.
- **A release's box images build every time.** Building them asked GitHub's API for the newest
  runner with no token, from GitHub's shared machines, and was refused when those had used the
  hour's 60 calls (0.1.11's first build). The build now passes its own token, as a build secret
  never kept in the image. A box set up with `here.sh` needs none, as before.
- **A run stays after it asks you a question (#487).** It stayed only after a plain answer, so
  your answer to its question started a new run, cold. A question that waits on nothing else (no
  list for your `yes`, no PR open) now keeps it staying, and your answer comes in the same session.
- **On a phone, the web chat lets you copy part of a reply (#487).** A long press opened the
  chat's own menu, which copies the whole reply, and hid the phone's Copy for a selection. It's
  the phone's own again; **⋯** on each reply still gives Copy and Download.
- **A `use` you're already on keeps a stay (#487).** A message that was only `use <the pick in
  place>` (or a thanks) got the box's own reply and ended the stay, so your next words started
  cold. The stay answers it and stays; a new pick still starts a new session.
- **A long run's folder is never swept as left over.** Old run folders went at 6 hours, under the
  job's new limit; now 8, tested against it.

## [0.1.11] - 2026-10-16

### Fixed

- **After you switch model in a stay, the new model's run stays too (#462).** The stay handed your
  words to a new run, as it should, but that run answered and ended, so your next words started
  cold again.
- **A run that stays answers each of your messages with its own answer (#462).** Once an agent had
  written its answer as a file, a stay's later turns posted that first answer again, whatever the
  agent said. Each turn now takes only what it wrote this time. `ship selftest chat` checks it.
- **A stay's run details count that turn's tokens, not the whole session's,** for Claude Code (and
  a run's catch-up rounds count each once).

### Changed

- **A run stays 10 quiet minutes after answering you, not 5,** so a pause to read and think doesn't
  end the session. `SHIPIFY_STAY` still sets it (`0` turns it off). `ship selftest` checks two
  answers in a stay, each new. Nothing to do.
- **pi and OpenCode think with GLM 5.3 Flash by default through OpenRouter too** (was a free model,
  whose endpoint was down for hours on 2026-10-16): fractions of a cent an answer, from your
  OpenRouter credits. A free model is still yours with a `use` line. Nothing to do.
- **A stay, robust end to end (ADR 0057).** A stay whose box died no longer holds its `staying`
  label until your words have waited 10 minutes: the watch takes it off once no run goes for the
  task, so your next words start a run. A stay gives way to its box's weekly clean-up too, not only
  to a task's run, and never to a job a free slot picks up in seconds. Your comments skipped while
  a run stays no longer take a waiting run's place, and a close or an edit on GitHub still runs
  after the stay. Every fixed word (`stop`, `continue`, `start over`…) goes to a normal run, as
  without a stay. The web chat says **Staying** in the list and the thread, not a bare tag.
  Nothing to do.
- **The web chat's list shows each task's state as a dot:** amber needs you, teal and beating
  working, green staying, teal new, red stopped; the word on hover and in the thread's header.

## [0.1.10] - 2026-10-15

### Added

- **A run stays after it answers you (ADR 0057).** After a plain answer to your words, the run
  stays for 5 quiet minutes (`SHIPIFY_STAY`; `0` turns it off), reading the task every 2 seconds,
  and answers your next plain words itself, in the same agent session: seconds, not a new run.
  Several messages still get one reply, each ask numbered, for every agent. A fixed word, an edit,
  another repo, account, agent or model, a change, or an answer that needs a file goes to a normal
  run. A stay gives way when another run needs its slot, and leaves on `stop` or a close. The label
  `staying` is on the task meanwhile, and comes off however the run ends. `ship selftest chat`
  checks it. Nothing to do.
- **See which skills runs use, and make new ones well.** Each run's details list the skills its
  agent loaded (**Skills**): Claude Code's and OpenCode's skill tool, or pi reading a skill's
  `SKILL.md`. The weekly digest adds one line: the week's loads, and the skills no run loaded.
  Nothing is removed by itself. A new skill, `writing-skills`, says how to make or change one: no
  line without a failure seen without it. Each of Shipify's own skills carries a `scenarios.md`
  (asks that should load it, near misses, and the cases it fixes), and a lesson adds a case. The
  skill check also holds descriptions to 300 characters and skills to 500 lines;
  `security-and-hardening`'s description is one short line. Nothing to do.

### Changed

- **Runs start sooner (ADR 0057).** A task's run no longer downloads `actions/checkout` and
  `actions/setup-node` on every job: it uses the box's own Node (the one its agent already used) and
  fetches Shipify's commit only when the box has no copy of it. The door is told of each reply as
  it's written, before the run's other writes. Nothing to do.

## [0.1.9] - 2026-10-15

### Fixed

- **The box's image builds:** its step made pnpm's folder before using it, as watch.yml does; the
  0.1.8 build stopped there.

## [0.1.8] - 2026-10-15

### Fixed

- **The box's image is built after every release:** its job was skipped when the golden tests
  were (no stack changed), as GitHub skips what follows a skipped job. A run by hand on the
  template now builds it again too.

## [0.1.7] - 2026-10-15

### Added

- **A box in Docker** (ADR 0056): any machine that runs Docker becomes a box. Run
  `docker compose run --rm box register` once (a code you approve on your phone), then
  `docker compose up -d`. Each release publishes `ghcr.io/<owner>/shipify-box` for x64 and arm64,
  built from `setup.sh`, so a container is the same box as a Pi, with the same sandbox checked
  inside it. It's never privileged and never has the Docker socket. Updates come by
  `docker compose pull`, and the registration stays in the volume.
- **A shorter README** that reads in a few minutes: what Shipify is, how it works, what you can
  ask, how to start, and the three ways to get a box.
- **An MIT licence** (`LICENSE`): anyone may use, change and share Shipify, keeping the notice;
  it comes as is, with no warranty, and its authors aren't liable for what others do with it.

## [0.1.6] - 2026-10-15

### Added

- **A box anywhere, from one command** (ADR 0055): on any Ubuntu 24.04 LTS machine,
  `curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash`.
  It checks the machine first, shows a code you approve on your phone, and runs your copy's own
  `box add`. It always cleans up: no login, clone or tools left behind. `--remove` takes the box
  away. Each release attaches `here.sh` with its SHA-256.
- **A public template that carries nothing of yours** (ADR 0055): `SHIPIFY_PRIVATE_WORDS` lists
  words replaced by stand-ins in what a release publishes. Every release is then checked for
  them, tailnet names and keys, and publishes nothing if any is found. `box add` and `ship doctor`
  refuse a public copy. docs/releases.md says how to make the template public, and the settings
  that keep strangers out.
- **Check back once:** a repeat can be one time, then it ends. Say it on the task it's about:
  "check PR #12's CI in 15 minutes and tell me", "remind me in 5 hours to …", "at 17:30 look at
  the deploy", "tomorrow at 9 …"; the Repeat form and `/repeat` take the same words. A job looks
  once with the whole thread and always says what it found; a reminder posts its text. It fires
  within about 5 minutes of its time (5 minutes to 30 days ahead), isn't skipped while the task's
  PR waits, and leaves the task answered. One per task, never on a task that repeats; closing
  drops it, `stop repeating` cancels it. Recipes and the digest still take only schedules.
- **Errands** (ADR 0054): a time once that waits for something on GitHub instead of a clock. On
  the task it's about: "tell me when links#12's checks finish", "when #405 merges, check the login
  page", "when it's deployed, …", "tell me when shipify's main checks finish" (the Repeat form and
  `/repeat` too). The task is labelled `waiting`, and its status line says what it waits for and
  until when. The due run looks with one GitHub read and no agent (every 10 minutes for an hour,
  then 30) and starts the task's run once the thing has happened: a reminder says what happened
  ("links#12: 5 passed, 1 failed (e2e)", failed checks linked) with no agent, a job runs the agent
  once with it. A day by default, at most 7; at its end, or after three failed reads, it says so
  with no agent. Your merge of the task's own PR fires one waiting for it in the close's run, with
  no looks, and the task stays closed. Your own account only; Shipify never merges. The web chat's
  Repeats page lists errands under "Waiting".

### Changed

- **A work run a reply starts is said in that reply:** "A work run on <project> starts now, from
  this reply: say `stop` to stop it.", whatever the agent wrote, so a second run is never a surprise.
- **A change doc's merge names `go`:** its "Merged" reply adds "Say `go` here to build it: the task
  opens again for it.", so a task its doc's merge closed doesn't read as finished.

### Fixed

- **A lost watch label is taken off.** One left on with no run behind it (`watch:alert-github`
  from 11 Oct, after a box-online alert rang `watch:alert`) no longer stays on the status task;
  the watch takes it off once, so no later tick reads the runs for it.
- **The watch never goes quiet on a stuck label.** An alert's label left on the status task with
  no run behind it (on 11 Oct its run couldn't take it off) kept every later finding unsaid: a
  box back, a box offline again. A watch label with no run of its kind queued, going or started
  in the last 10 minutes is now rung again, `watch:due` too, and a run that can't take its label
  off says so in its log.
- **Closing a task drops its errand.** A task closed by hand or from a chat while an errand
  waited on it (`waiting`) started no run, so the due run still fired the errand on the closed
  task. Its close now starts the close run, which drops it, as a close with a PR waiting does.

## [0.1.5] - 2026-10-13

### Added

- **A weekly digest** (ADR 0053): once a week, every Monday at 9:00 your time by default
  (`SHIPIFY_DIGEST`, or `off`), one short message to your default chats: boxes, apps (live,
  failing, behind their stack, with the words to send), what waits on you, keys due within 30
  days, what's coming up; "all clear" when nothing needs you. The first comes with the next due
  run. Nothing in it acts, and nothing else is sent: alerts are as before.

### Changed

- **The web chat on a phone** (task #335, part C): a file opens inside the app, never in a new tab
  (a picture full size, a short text file as plain text, anything else with a Download button);
  Back has one rule (Tasks under every page; a thread, New chat and an open file are one step
  each); long file names and link buttons fit a phone screen. The page stays under its 41 KB.
- **GitHub's Close and Reopen buttons start no run** (ADR 0053) unless the task still says
  `needs you` (a PR, a question, a list) or `working` (a run under way): about one box run in five
  was a close's bookkeeping. The "Merged" and "Live" messages after your merge stay.

## [0.1.4] - 2026-10-13

### Added

- **Vercel's AI Gateway for pi and OpenCode, and agents and gateways as two axes** (ADR 0052).
  `pnpm ship add vercel-ai-gateway --yes` sets its key (`AI_GATEWAY_API_KEY`); `pi-vercel` and
  `opencode-vercel` are the same agents through it. `executors.json` now says the two apart: an
  agent is a program and lists its `gateways`; a gateway holds its `models`, `auto`, names and how
  to read its list. One pure function makes the entry for each pair (`pi` through the first
  gateway, `pi-vercel` through the second: one program, one install, ids and `SHIPIFY_AGENT`
  unchanged), so a model, a gateway or an agent is a few lines of data, with fallbacks (Auto is the
  gateway's, else the agent's, else the gateway's first model; efforts and id pattern are the
  agent's) and nothing to copy. What can't be made (a first gateway that isn't there or isn't
  right, one listed twice, an id that's taken, a hand-written `extends` or `gateway`) is left out
  and said once by `ship doctor`; an agent never shifts to another gateway under its id.
- **What a model takes is read as needed, never kept.** A run reads its model's answer from its
  gateway's public catalog (about 1 KB on Vercel, `list.model`), and runs an effort the model
  doesn't take at Auto's, or at none, saying so in its details; the web chat's picker reads the
  same and offers only what each model takes. One function (`effortsFor`) holds a `use` line to an
  agent's own per-model list (`modelEfforts`, which replaces `noEffort`: Claude Code's Haiku).
- **One reader for every gateway's list.** A gateway's `list` says where its list has each fact of
  a model, so OpenRouter's and Vercel's both give names, prices, context, abilities and efforts to
  the picker, `/models` and Telegram; Vercel's list, which can't be searched by itself, is read
  once, whole, and searched here.
- **The web chat's picker and default.** An agent's gateways are a row under its tab, by their names
  (OpenRouter, Vercel; the page's budget is now 41 KB gzipped), and the default agent, in the picker,
  on GitHub's `/models` and in a run, is the one the repo variable `SHIPIFY_AGENT` names. A run's
  details name the gateway it went through ("pi · Vercel"). The Repeat form's Model is each agent
  as the file makes them on the page, and words on GitHub's form: no list kept by hand.
- **`ship setup <step> [--new]`:** does one step's part here, add-ons too (`apps`, `updates`);
  `--new` asks its key again (`ship setup agent --new` renews the agent's login). `ship setup apps`
  finds your Cloudflare account and workers.dev name with the deploy token and sets them;
  `ship setup` checks the template's key still reads the template, shows the login of the agent
  `SHIPIFY_AGENT` names (a gateway's key included), notices the edge lacking the door App's key,
  and lists the web chat as added once you're on it. `ship selftest <gateway>` checks its key,
  `ship selftest webchat` runs its own check, and the watch's key-date reminder names the command.

### Changed

- **The stacks' libraries, refreshed** (ts-static and ts-worker 1.0.4, ts-package 1.0.3): patch and
  minor versions only, each at least two days old: wrangler 4.149.0, Playwright 1.64.0, Vite 8.3.4,
  Vitest 5.0.3, Hono 4.13.13, Biome 2.5.15, and the types. A project takes them with
  `pnpm ship upgrade <id>` and its stack's migration note (`stacks/<id>/migrations/<version>.md`:
  `package.json` is the project's own, so the bumps are listed there), one PR each.
- **A ts-worker project names its preset** (`blank` or `tool`): a plan or `ship new` with none is
  refused at once (`presetRequired` in `stack.json`), where it used to fail only at the build's
  `make verify` ("Cannot find module './App'").
- **Faster runs: about 15–18 s off the ~70 s every run spends around the agent** (ADR 0051, task
  #335). Each step writes one line to the run's summary, its time and every `gh` call it made, and
  a test holds each step to a call budget; a box builds the CLI once per commit into one file
  (esbuild) in its read-only copy of Shipify, made first on every run, and every step and the
  agent's own `ship` commands start it (0.66 s, where `pnpm ship` takes 2.65 s, six times a run);
  plan writes its status from the task step's read and apply reads only the comments since; the
  writes that don't depend on each other start together, the status last. Your PC, CI and the
  `github` job keep the source through `pnpm ship`.

### Fixed

- **The edge is deployed when what it runs differs from main,** read from its `/health`: a push
  whose checks failed before its deploy no longer leaves the next push skipping it.
- **Security: an agent run can't change the rules a later ask starts with.** Before every ask (the
  first, a catch-up, the fix round), its settings folder, Claude Code's `settings.json`, and
  OpenCode's `~/.opencode`, cache and config folder are made fresh (an adapter names them:
  `cleared`); OpenCode reads no login of its own, and its gate withholds the key when the config it
  runs with was changed.
- **Security: pi's and OpenCode's gate refuses `git push` and `git stash` inside another command**
  (`sh -c`, `eval`, `find -exec`) and past a wrapper (`/usr/bin/env`, `sudo -u`).
- **Commands OpenCode runs use the slot's kept caches,** so pnpm's store and Playwright's browsers
  aren't downloaded every run and `test:e2e` passes; OpenCode loads no repo's own skills beside
  Shipify's.
- **An agent install cut short is redone** (its program doesn't start); one that starts is marked
  and kept.
- **`off` turns thinking off again on OpenRouter models that allow it** (Nemotron, pi's Auto, and
  DeepSeek V4.1 Flash): their catalog says it with `reasoning.mandatory`, not in their levels, and a
  run held `off` to Auto's `high` (a gateway's list may name that path: `list.off`).
- **A typo in the Repeat form's Model is said,** never run as Auto (the field takes `use` words,
  with or without `use`).
- **The web chat's picker asks again after a failed read** of the models' facts, and the edge no
  longer shares a read still going between requests (Workers may cancel it with the first).
- **Security: a list in your chat is always the box's.** A heading for a list in the agent's words
  (or in a page it read) no longer shows as a list in your chat while Yes approves another; a
  list's No now names its list too (`no <code>`), so one under an older reply drops nothing newer.
- **A list of notes alone expires after a day**, as a list of calls does, and a yes counts only
  after the reply that showed it.
- **A task with an open PR stays "needs you":** an answer to a follow-up question no longer makes it
  "answered", so the due run never closes it for quiet with the PR open (your merge then said
  nothing).
- **A `null` in a tool call's arguments is kept:** it clears a Notion property, as asked, where it
  used to be dropped silently.
- **`again` typed in a chat is answered there,** not only in your default channels.
- **Vercel's search finds only models with a zero-data-retention provider,** as its listed ones are
  (a list's `only` takes one of several words).
- **Notion:** replacing a page's body is refused, before anything changes, when a block holds others
  (a toggle, columns, a nested list), so nothing inside one, a subpage included, is deleted unseen;
  text over 100 lines or with a line over 2,000 characters is refused instead of cut (`create_page`
  too); a list says when a call replaces a page's whole body (a tool's `args.<call>.warn`), and
  `docs/security.md` no longer says a list can't delete anything.
- **Notifications keep Shipify's icon after the chat's sign-in ends** (served from `/note/`); the
  edge's log names each device's push-service answer and any store error; a device turned on while
  a notification goes out is kept; a file shared to the web chat waits for its menu, or says
  "Files aren't set up", never disappears.
- **`ship door check` skips a chat no one's on,** and every failing check names its fix.
- **A close as a duplicate drops the task** as "not planned" does (its open PRs closed).
- **A bare model word stays one model's with a second gateway:** the models a gateway names its own
  way are reached through its agent (`use pi-vercel glm-5.3`, or a bare word on a task already on
  it), so `use glm-5.3` and `use pi glm-5.3` are as before.
- **The `/models` help's example** is a model that takes an effort.
- **Runs that start at once on a new commit** no longer break each other's copy of Shipify (tasks
  #352-#356 failed with git's exit 128): each builds its own and the first moves it in.
- **A model found on Vercel ran on OpenRouter** from a `/models` button or `use <its id>`: a button
  through another gateway names its agent (`use pi-vercel <id>`), and an id only that gateway lists
  finds its agent from any task.
- **Efforts follow the model everywhere:** an effort with no model named is held to Auto's model
  (`use pi-vercel max`); the web chat's picker keeps an effort only on a model that takes it and
  offers Off only where the gateway's catalog does (its `none`, or `list.off`); `/models` says every
  effort an agent takes.
- **The web chat writes a pick under your message as the chip does** ("Pi · Vercel · glm-5.3"), not
  "Pi-vercel".
- **Lighter reads of a gateway's list:** a list read once serves a chat's answer and its buttons,
  and a list read whole is kept as long as a search (10 minutes).
- **Troubleshooting** names a Vercel account's zero-data-retention refusal ("No ZDR providers …")
  and its remedies; Vercel's models listed are ones with such a provider.

### Removed

- **Dead code and stale words:** an agent without an adapter (its `flags`; no entry could run
  without one), four functions only tests called, a second quiet-day close no run reached, the
  duplicate label writes of a close, and stale lines in the roadmap, troubleshooting, the watch's
  and box setup's docs (the watch never starts a run), the glossary and the ADR index.

## [0.1.3] - 2026-10-11

### Added

- **Replace a Notion page's body.** `update_page` takes an optional `content`, which swaps the
  page's whole body for that text (the same `#`, `- `, `- [ ] `, `1. ` lines `create_page` takes),
  so a placeholder like "[Add a quote here]" can be replaced through an approved call. The new text
  goes in first and the old blocks are deleted after, so a failure part-way never loses the page;
  subpages and sub-databases are never deleted, and the answer names them. `properties` and
  `content` can go in one call; a blank `content`, or one over 100 lines, is refused. It is still
  an act call: it waits for your `yes`. No append, archive or comments yet.
- **Notifications from the web chat, and Android's share menu** (ADR 0050, task #321). Turn on
  **Setup → Notifications on this device**, and a reply that reaches the web chat tells your phone
  or PC, with the chat closed: its state, its task and the task's title, never the reply's words; a
  tap opens the thread, and a newer one for the task replaces the older. Alerts, repeats and
  recipes notify you too once `web` is among your default channels, which `pnpm ship add webchat
  --yes` sets when you have none, so Telegram is optional. It's Web Push, encrypted end to end and
  signed with a key made on your PC (`WEB_PUSH_KEY`, the step **Turn on notifications**), in one
  file of the edge's on WebCrypto, with no dependency or new service: it rides on the call a run
  already makes to the door. Polling is unchanged. On Android, with the chat installed, **Shipify**
  is in the share menu: a photo, a PDF or a link opens New chat with it attached, and nothing is
  sent until you tap Send. On an iPhone, notifications come to the Home Screen app.
  Run `pnpm ship add webchat --yes` again to turn them on.
- **Approve a list from your chat, with one tap** (ADR 0049, task #317). A `yes` counts from
  Telegram and the web chat as it does on GitHub: the whole message, unedited, after the list,
  within a day. Under a list a chat shows only **Yes** and **No**: Yes sends `yes <the list's
  code>`, so it approves that list alone, and the agent's own quick answers are hidden while it
  waits (on #317, tapping one dropped the list). The list shows once (the box removes the agent's
  copy), last and whole in every chat; Telegram shortens only the words above it. A list over
  3,000 characters is approved on GitHub only. Merges, `go`, `publish`, `preview` and
  `start over` stay on GitHub. Turn on Telegram's password: your chat now approves calls through
  your tools.
- **Routines that write through your tools, set up in one PR.** A `pre` form in `tools.json` can
  name the tools it still counts after reading (`"after": ["notion"]`), so "every weekday at 8,
  read my Tasks and write today's plan under Daily" runs with no tap: its recipe and its form in
  one PR, approved by your merge. It never counts after the web, a check or another account. Each
  act call now names its target (`args.<call>.target`: Notion's `parent` and `page`), and a form
  must fix it. Think records which tools a run read (`looked`) apart from anything else
  (`elsewhere`); notes after any read still wait for your Yes.
- **↻ in the web chat:** in each header, left of **New chat** too. A tap reads what's on screen
  again, as coming back to the page does, and keeps what you've typed.
- **Every agent loads Shipify's skills on a task, and lessons become skill PRs** (ADR 0038). A run
  only named the folder of skills, so agents rarely read one. Now each run hands its agent the
  skills in its read-only copy of Shipify, and the agent lists all nine itself, each with when it
  applies, and loads one when it fits: pi with `--skill`, Claude Code from a link in its settings
  folder, made as the agent. A read run gets none. Each agent's adapter says how (`skills` and
  `skillsLink`), and the agent conformance test checks it. When you correct an agent, or it finds
  the way after dead ends, its reply ends with the skill, the lesson, and the words that keep it
  (`shipify: add to the <skill> skill: …`), a PR you merge: never a lesson an agent writes alone.
  Before asking you something, a run searches your past tasks for the answer. A skill check in
  `pnpm verify` (`tests/skills.test.ts`): each header is plain YAML, named for its folder, says
  when to use it, and is listed in `skills/README.md` and `AGENTS.md`. It found the Notion skill's
  header wasn't plain YAML, so pi had skipped it; it's fixed. Nothing to do.
- **OpenCode, a third agent** (ADR 0038), on the same OpenRouter key, models and Auto as pi:
  `use opencode`, `use opencode z-ai/glm-5.3 high`, the Repeat form's **OpenCode**, its own rows in
  Telegram's picker, a tab in the web chat's Who thinks, and `pnpm ship selftest opencode`. A box
  installs it the first time a run picks it (1.18.34, no package scripts, about 177 MB). It's held
  to the same rules as every agent: Shipify's gate is its plugin, since its own rules miss `env git
  push` and `/usr/bin/git push`, and checks its helpers' calls too, naming each in OpenCode's
  output, so a helper's read of the web or a tool counts as the run's (OpenCode's own events carry
  only its own calls). The gate holds its key: read once from fd 3 and put on each call to
  OpenRouter alone, so it's in neither OpenCode's config nor its environment. Its own config folder
  is made read-only before it starts (a new, optional
  `readOnly` in the agent contract): where it can write it, OpenCode installs a package from npm
  on every start, about two minutes on a Pi. A fixed session title, so no paid model is asked to
  name it. Checked live on a Pi against a stand-in model. To use it, nothing new: it needs the
  OpenRouter key pi uses (`pnpm ship add openrouter --yes`). Give that key a credit limit at
  openrouter.ai → Keys.

### Changed

- **A model two agents take stays on the task's agent** (pi and OpenCode share OpenRouter's). A
  listed model or any gateway id, named with no agent, stays on the task's agent when it takes it,
  else goes to the first that does (pi): `use glm-5.3` and `use moonshotai/kimi-k3` on an OpenCode
  task stay there, and on Claude they move to pi (an unlisted id used to be refused there).
  `/models <word>` names a line for each agent (`use pi <id> or use opencode <id>`), and its
  Telegram buttons send `use <id>`, so a tap picks on the task's agent. `/models` says an agent
  with the same models as another in one line. Labels use an entry's `name` ("OpenCode", not
  "Opencode"), and Settings shows a gateway's key once, naming every agent on it.
- **Security: the agent's login is on a pipe, never in its environment.** Claude Code's login
  (it lasts a year) and pi's gateway key (it spends your credits) were in the agent's environment,
  where any command it ran could read them: pi passes its whole environment to its commands, and
  Claude Code's own environment was readable in `/proc`. A page that tricked the agent into running
  one could send the key out. Now the box hands the login over on file descriptor 3, a pipe the
  agent reads once: Claude Code with its own setting (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`,
  checked live on 2.1.284), pi through Shipify's gate, which gives the key to pi's provider and
  closes the pipe. Nothing to do: it works the same on every box and on this PC. Each agent's
  adapter says how its agent reads the pipe (`loginFromPipe`), and the agent conformance test
  checks it. The sandbox check (`box add`, and `ship doctor` in each weekly clean-up) proves it
  with a dummy login, and checks that no command can read the agent's memory either
  (`kernel.yama.ptrace_scope` 1, Ubuntu's own). The read-only GitHub token and the tools' look
  keys stay in the environment, since `gh` and the tools' servers read them there.
- **A box's run lists your repos in two calls, not one per repo:** a run's plan reads your repos
  (ADR 0044), and each repo's `shipify.json` was a call of its own, about 0.7 s each on a Pi. They
  are now read in one GraphQL query (50 repos a query): about 4 to 5 s off every run with six
  repos, more with more. Still read on each run, so a repo made a minute ago works by its name.

### Fixed

- **A repeat made in Telegram no longer comes twice.** Its reply goes to your default channels
  (`SHIPIFY_SEND`) instead of also going to the chat it began in; with none that reaches you, it
  still answers where it began. (#230 came on Telegram and the web chat.)
- **Web chat on a phone.** Opened on a thread from a notification, Back now lands on the list, not
  out of the app. A tap on a notification reads the thread again at once, even when that thread is
  open, and the thin bar moves while it does. A notification shows Shipify's sail, not the default
  bell: a colour icon and a one-colour badge, both made from `icon.svg`. A file downloads where it
  is, without a second window. The keyboard resizes the page (`interactive-widget=resizes-content`),
  and pulling down no longer reloads it.
- **Shipify's own tests no longer saturate a small box** (task #328). `vitest.config.ts` caps the
  test workers at half the cores (never under two), so `make verify` and `pnpm verify`, which the
  box runs before every PR to Shipify, leave room for the runner and the agent. Projects' own test
  configs are unchanged.
- **Projects' tests carry the same half-cores cap** (task #332). The two platform-owned vitest
  templates (`stacks/ts-package`, `stacks/_cloudflare`) set `maxWorkers` exactly as Shipify's own
  config does, so a project's suite on a small box leaves room for the runner and the agent too.
  New projects get it at generation, existing ones at their next `ship upgrade` (ts-package 1.0.2,
  ts-static 1.0.3, ts-worker 1.0.3).
- **A result with unused fields written as `null` no longer fails the run** (task #328). A smaller
  model wrote `question`, `choices` and `files` as `null`, and a 30-minute run was marked Failed
  for it. The box now reads a `null` field as left out, and the agent is told to leave unused
  fields out. The task playbook also says to run one covering test file while working, read the
  full `make verify` once from a file, and never build a change in the read folder. No retry, no
  new step: the result is still checked once.
- **Shipify's own checks pass inside a task again:** a task's agent gets your copy's deploy values
  (`CLOUDFLARE_ACCOUNT_ID`, `CF_WORKERS_SUBDOMAIN`) for its own `ship build`, and five tests read
  them as this PC's, so the box's `make verify` failed every change to Shipify made by a task. The
  tests now start without Cloudflare's settings, as they do without GitHub's and Shipify's.
- **Security: this PC's box on WSL walls Windows off too.** WSL lets every Linux user open your
  Windows drives and start Windows programs, which run as you in Windows, so an agent could get
  out of the sandbox there, and `box add` labelled its slots `sandbox` all the same. Now the
  sandbox check (in `box add`, and `ship doctor` in every weekly clean-up) also checks no agent
  can open a Windows drive and that Windows programs don't run from WSL. Until then it gives no
  label and prints the fix: `[interop] enabled=false`, `appendWindowsPath=false` and
  `[automount] options="metadata,umask=077"` in `/etc/wsl.conf`, then `wsl --shutdown`. It changes
  nothing of WSL's itself. That means no Windows programs from WSL, so a Pi or a spare Linux machine
  may suit you better as the box ([box-setup.md](docs/box-setup.md#this-pc)). A PC already set up
  on WSL: `ship doctor` now names the open walls; make the fix, then `box add` again.
- **Tasks run on a box again:** since settings moved to GitHub, a run handed its agent your Shipify
  repo's name as `GITHUB_REPOSITORY`, which the box's sandbox refuses, so every task's think step
  failed. The sandbox now lets that one name through (nothing else of GitHub's), and a run off a
  box checks the same names, so a test sees what a box would refuse.
- **A staging app's release deploys staging again:** the pipeline refused `ship release`'s push
  to `main` as "more than a version bump", because it also holds `package.json`'s version and the
  change docs it stamps released. Those pass now, `package.json` only when nothing but its version
  changed; a file moved out of its place still counts as changed. Stacks 1.0.1 (`ship upgrade`).
- **Every commit on a project's `main` gets its run and its mark, docs too:** a merge of docs alone
  started no run, so its task said "the deploy never showed up" after 30 minutes, and a staging
  app's `ship release` waited on a mark that never came. A PR of docs alone still runs nothing.
- **The edge shows your new time zone without a deploy:** `/recipes`, the web chat's repeats and
  the repeat form read `SHIPIFY_TIME_ZONE` with your copy's other variables (a minute at most), as
  runs do; the zone it was deployed with is only the fallback.
- **A copy named other than `shipify` gets its door:** `ship door setup` and `ship door check` want
  the door App on your copy by its own name, and its manifest links there.
- **`ship door setup` wants a workers.dev name with a domain too:** the edge is always deployed at
  workers.dev as well, which Cloudflare refuses on an account with none, so setup stops first and
  says to open Workers once on the dashboard.
- **`shipify: release minor` and `shipify: release major` from a task:** each was taken for a
  change to Shipify, not a release; now it releases the next minor or major version, as
  `pnpm ship template --bump minor` does (whose plan now names that flag right too).
- **An update keeps what a copy added:** `ship update` took out every file of Shipify's the new
  release lacks, a tool, channel or agent the copy added among them. It now takes out only what
  the template itself removed since the copy's version (read from that release), and nothing when
  the template has no release of it, as its PR says.
- **A copy finds its template:** a release now writes the template's name into `package.json`
  (`"shipify": { "template": … }`), and an update reads it after `SHIPIFY_TEMPLATE`, before what
  GitHub says, which a bot's key scoped to the copy may not see on a private template. Setup's
  updates step reads it too, and asks for `SHIPIFY_TEMPLATE_TOKEN` when the template can't be read
  from this PC.
- **Getting started signs this PC in before cloning your private copy.**
- **`ship update` never offers an older version:** where Shipify is built, a release is recorded
  before the template's CI releases it, and for those minutes the copy is up to date, not behind.
- **A box's agent lays out projects with your copy's settings:** a merged plan's publish run and an
  `<app>: upgrade` task ran `ship build` or `ship upgrade` inside the sandbox, which has none of the
  run's variables, so the Cloudflare stacks stopped on `CF_WORKERS_SUBDOMAIN`. The agent is now
  handed every stack's deploy values that are set, and your time zone, by name (never a key).
- **A merged plan starts its build:** the run's checkout became shallow, so a push couldn't compare
  its two ends and the plans step failed silently. A push fetches main's history again.
- **`shipify: release` from a task passes its own check:** the release's full check runs inside the
  task's job, and a test read that job's `SHIPIFY_SEND`. Every test file now starts outside any job.
- **`ship pr` refuses a file still holding a merge's conflict:** `ship staging` merges into a
  project's own guides, and a conflict there passed every check.
- **`pnpm verify` skips a helper's worktree:** one inside the checkout (`.claude/worktrees/`, which
  git already ignores) stopped Biome with "nested root configuration".
- **An app whose home page is behind a sign-in passes its own browser tests:** the stack's tests
  (ts-static, ts-worker 1.0.2) open the home page, which for links is the admin page behind
  Cloudflare Access, so its `make verify` failed. A project names a public page instead:
  `export E2E_HOME := /a-public-page` in its `project.mk` (its own file, which upgrades keep).
- **`ship upgrade`'s next step for an app with no releases** no longer says `ship version`, which
  refuses there.

## [0.1.2] - 2026-10-09

### Fixed

- **`ship update` and `ship template` on a PC read the template's name:** a release keeps it on
  this PC too, and both read the copy's variable when it isn't there.

## [0.1.1] - 2026-10-09

### Fixed

- **Dependabot stays where Shipify is built:** its config is no longer published, so the template
  and every copy get no Dependabot PRs of their own; a copy takes dependency updates with each
  version's update PR.

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
