---
status: accepted, built (see "As built" for where the build differs). Proposed from the owner's request of 2026-10-06, task #182: a nice, simple chat window, hosted privately on Shipify's own site, where you talk, attach files and get work done, with the core and every flow unchanged; and whether to host a separate chat app instead. Then: pick the model, manage your chats, see each run's details, nothing extra to run. Then: keep it an extension that leaves the core and its setup alone; every task wherever it started, what's running, repeats, recipes and the notebook; good on a phone; the edge cases thought through. Then: the interfacing, the formatting, attachments and a clean setup. Then: no sign-in to plan, the same rule as the status page and no users; a simpler, cleaner chat that isn't bloated, loads well and shows updates as they come, with Markdown and photos; and whether reading it all from GitHub makes that hard. Then: whether it goes through the door, the same interfaces, channels and adapters, rather than webhooks, so the flow keeps working; a thread is a task that loads and is worked on; and one place to see and set what's hard to see on GitHub and Telegram: the setup, the boxes, the files, downloading replies. Then: setting up repeats and configs with no direct APIs, the most basic plan summarized and made ready, and how far the window should go beyond chat (time-based and deterministic flows, models, tools and MCP servers), some layers later. Merging its PR accepts the design; `go` builds it. Then, before its build merged: everything private under `/admin`, the status page too; diagrams and pictures shown well in the chat; what was left, finished. Then: general chat and questions, not just code (a PDF or a picture to analyze or sum up), friendly and robust so it doesn't easily run out or get blocked, and the code left cleaner)
date: 2026-10-06
amends: 0032 (one more chat adapter; a channel may be read in place; the status page moves to `/admin/status`)
---

# 0036: A web chat at `/admin/chat`, an extension of the edge

## The plan in short

**What:** a chat window at `shipify.<APPS_DOMAIN>/admin/chat`, made for your phone first. It sits
beside the status page (now `/admin/status`) under `/admin`, so **one sign-in covers both**. There
are no users, emails or accounts: whoever gets past that sign-in writes as you. (The plan below
says `/status/chat`, the status page's own address; see [As built](#as-built-2026-10-06).)

**One screen:**
- **The list:** what's running now, then what needs you, then every other task, wherever it
  started.
- **A thread for each task:** replies shown whole, a run line under each, and their buttons.
- **The box you write in:** words, photos and files, and a model chip.
- **☰** opens four plain pages: **Repeats**, **Notebook**, **Files** and **Setup**.

**The one rule: the window has no write API of its own.** It reads GitHub, through the edge.
Everything it changes goes one of the three ways Shipify already changes things:

| Way | What it covers | Needs an agent? |
|---|---|---|
| **1. Words through the door** (as Telegram's, no webhook) | a message, a new task, files, `use opus high`, `close`, `again`, `resume`, `stop repeating`, `remember`, `forget`, `/ping`. A **new repeat from a form** is words too: the form writes the Repeat form's own headings, which the core already sets up with no agent | only when the words need thinking |
| **2. A change by PR** (a chat that starts `shipify: …`, which ends in a PR you merge) | the default model, a new tool or MCP server, a new check, a recipe, a pre-approved call | yes, to write the change. Your merge is the approval |
| **3. Your PC or GitHub** | keys and secrets, boxes, `yes`, `go`, `publish`, merges, releases | no. The page shows the command to copy, or the link |

So every button and form is a quicker way to say the exact words. Where the core is already
deterministic (fixed words, the Repeat form), the window is too. There's nothing new to trust.

**Why it's simple, though everything lives on GitHub:**
- **Into the door:** the chat calls the door's own function directly (`doorIn`, through a `web`
  adapter), from inside the edge. Telegram needs a webhook only because its servers sit outside.
- **Replies:** the run writes each one on its task, as it always does, and the page reads it there.
  Nothing waits on a delivery, so a closed page or a Telegram outage loses nothing.
- **Cost:** one edge call per view, and none when nothing has changed.
- **Formatting:** GitHub turns the Markdown into HTML, so the page needs no Markdown code of its own.
- **Opening:** the page opens from the copy it last saw, then updates.

**This build (one PR after `go`):**
1. The adapter and the routes.
2. The list, the threads and the box (files, photos, the model chip, commands).
3. ☰ Repeats, with **New repeat**, **Run now**, **Pause**, **Resume** and **Stop**.
4. ☰ Notebook, ☰ Files and a read-only ☰ Setup.
5. Copy or download any reply or thread.
6. `ship add web`.

It's an **extension**: its own folders in the edge and four core lines, off until `pnpm ship add
web`. The core, the runs, the boxes, `ship setup` and Telegram don't change. It needs no new host,
server, database, key or cost.

**Not in this build:** forms that make a PR with no agent, a check's values over time, tools and MCP
servers added from a form, and pings. Each is a layer of its own, after this one
([Later, in layers](#later-in-layers)).

## As built (2026-10-06)

Built as decided below, with these differences, each found while building:

| Planned | Built | Why |
|---|---|---|
| `pnpm ship add web` | `pnpm ship add webchat` (`selftest`, `remove` too). The channel's id is still `web`: from-lines say `web`, `SHIPIFY_PEOPLE` gets `"web": "me"` | A tool's name may not appear in the core's code (`tests/core.test.ts`), and "web" is an ordinary word there. The edge finds the tool's name in `tools.json` by its door |
| The adapter's proof: a value made when the Worker starts | An HMAC of a fixed phrase, keyed by the door App's key (`SHIPIFY_DOOR_APP_KEY`, the adapter's `needs`) | The same in every isolate, and still something only the Worker can make. The architecture test keeps the extension and the adapter from importing each other, so each makes it |
| The conformance suite unchanged | Fixtures may say `readInPlace`: `send` pushes no words, keeps files, fails only when its store is down | The suite assumed every channel pushes words |
| Four core lines | The mount in `app.ts`, the adapter in the registry, a note in `env.ts` (the two bindings are read through a cast: `Env` holds strings), `assets` and `kv_namespaces` in `wrangler.jsonc`. Its log lines use the status page's events (`page.refused`, `page.served`, with the step `web`), so `cli/contracts/` doesn't change | |
| ☰ Repeats' **Check** picked from the names in `checks/` | A name you type, checked for its shape; the core says if there's no such script | The edge has no listing of `checks/` at build without a build step |
| `executors.json` and `tools.json` current after any merge | Current after the next **edge** deploy | `ci.yml` redeploys the edge when `edge/`, `cli/contracts/` or `intents.json` change, not for those two files alone. Changing that trigger is a workflow change for its own PR |
| `selftest web` checks the sign-in and the store | `pnpm ship selftest webchat` says it has no key to check, as Telegram's does; `tsx tools/web/setup.ts --check` runs the check | `ship selftest` runs a tool's check only when it has keys. A small `cli/` change of its own |
| The chat at `/status/chat`, under the status page's path | **Everything private under `/admin`:** the chat at `/admin/chat/`, the status page at `/admin/status`; `/` and `/admin` open the chat; `/status` and `/status/chat…` redirect (GET only). The Access application keeps its name and AUD tag (`SHIPIFY_ACCESS` doesn't change); its path becomes `admin/*`, one edit in Cloudflare that `ship door page` and `ship add webchat` check and walk you through (Enter keeps the saved values). The door, `/health` and `/draw/` stay outside it | The owner's call before the build merged: one prefix for what's private, room for later pages, and no open question about whether a path of `status` covers what's under it (Cloudflare says a wildcard path covers what's below it). Until the edit, the edge's own token check refuses `/admin`, so nothing opens by mistake |
| No Markdown or diagram code in the page; Mermaid blocks shown as their source | **Diagrams drawn:** a ` ```mermaid ` block is drawn by `/draw/`, a static page with no data outside the sign-in, in a sandboxed frame (`allow-scripts`, no same-origin) that loads Mermaid 11.17.2 from jsDelivr pinned to its SHA-256, and hands back the SVG. The chat shows it as a picture (an `<img>` runs no script), its source until then, and keeps the source if it doesn't draw. Mermaid never runs in the chat's page | The owner asked for plans, diagrams and pictures to read well in the chat, not on GitHub. GitHub draws diagrams with its own script, which the API doesn't send. A frame with no origin can't reach the chat, its cookies or the door, and the picture it returns can't run anything. It's outside the sign-in because a frame with no origin may not carry the sign-in's cookie |
| Pictures open full size from the files under a message | **Any picture opens full size in the chat,** a diagram or one in a reply's text too, not on GitHub | The same ask |
| Earlier messages: a link to GitHub | **Earlier messages** loads the previous 100 in place (`?page=`), where you were reading | It was left as a follow-up; the owner asked for what was left to be finished |
| A new chat opens on an empty box ("What should Shipify do?") | **Starters:** Ask anything, About a file (the file picker, and "Summarize this: "), Change a project (picked from a list), New app, Remember, Repeat. Each only fills the box. The box says "Ask anything, or attach a file" | The owner asked for general questions too, not just code: a PDF or a picture to analyze or sum up. The core already answers those (plain words are a question; a run gets the chat's files and reads pictures and PDFs), so this is only the way in. `playbooks/task.md` now says a question needn't be about code, and how to read a file |
| Fixed words typed in the box | **The words the newest reply asks for are buttons** (`continue`, `close`, `again`, `resume`, `no`, `stop repeating`); one that counts only on GitHub (`yes`, `go`, `start over`, `preview`, `publish`) is a link to the task there. The edge reads them from the reply's backticks (`edge/src/web/words.ts`), and a test holds its two lists to the core's (`cli/kernel/words.ts`) | So a run that stopped (your plan's limit, its clock, a failure) is one tap to carry on, and a button never sends a word the door won't take from a chat |
| The page under 40 KB | About 43.5 KB, with a 44 KB budget in its test (64 KB since the designed look, below) | Diagrams, pictures full size, earlier messages, the starters and the word buttons. Still no library in the page; Mermaid (3.5 MB) loads only in the frame, and only when a message has a diagram |
| One accent colour, the system font, no animations beyond a fade (What it looks like) | **A designed look** after the owner saw the first one live ("simple elements are broken"): light and dark tokens with one sea-teal accent, a strong and a quiet button, line icons drawn by the page (`icon()` in `compose.js`, one SVG path each, no icon font), states as a dot and a word, the reading column at most 50 rem wide, the box you write in as one rounded field. Motion only for what's live (a working dot, the loading bar, placeholders) and off with reduced motion. The budget is 64 KB (about 21 KB compressed, as it's sent) | The first look used the browser's own buttons and links, which read as broken. Still no library, font or outside file: the icons are paths in the page's own script |
| GitHub's HTML cleaned; anything left out says "Open on GitHub" | The same, but GitHub's own icons (a heading's link icon, a diagram's spinner) are dropped without saying so | Markdown can't hold an `<svg>`, so one is always GitHub's; before, every heading added "Open on GitHub to see all of it" |
| Running now at the top; the 100 tasks updated last; a "New reply ↓" pill; Telegram photos named only; one model chip ([What it looks like](#what-it-looks-like), [Loading and updates](#loading-and-updates-why-github-doesnt-make-it-slow)) | **After the owner used it (#188):** a running task says "Working · 2m" or "Queued" on its own row, not a second card; **Open** (the default) and **Closed** tabs, 50 tasks a page with **Older tasks**, and filter chips worked out from what's loaded; **For review** (shipify's open PRs) from the same read; a thread draws its newest 40; a small round ↓ in the corner; Telegram photos fetched from Telegram when you look (`api/sent`), never copied; a model chip and an effort chip; **Reopen**; each request gives up after 20 seconds; **Stop the run** in ⋯ ([0037](0037-words-while-a-run-works.md)), and buttons that wait while they send and keep a Retry. The budget is 76 KB | Fewer calls and less loaded at once (the list no longer asks for `body_html`), and the owner's screenshots: the list scrolled sideways, a run showed twice and could disagree, the pill never hid, Auto showed for a task that uses another model |
| ☰ Setup and a ☰ link to the status page, apart; a PC opens on "Pick a task"; every row says its state; filters from any word before a colon | **Then (#188):** one **☰ Status & setup** page: a **Now** card (what needs a look, the watch's last look and newest 5 events, links to the status page, GitHub and each box's console from `SHIPIFY_CONSOLES`), then the setup's cards side by side; the boxes' line in the list opens it. A PC opens on the new chat, with its starters. A row says whose turn only when it's not just open ("Your turn", "Stuck"), and a title's kind is a label of its own; the filters are All, whose turn, the kinds Shipify takes (one **Repeats** for repeats and recipes) and your labels; open repeats and recipes come last, under a **Repeats** heading. A message over 16,000 characters is stopped in the box, and the edge names the limit | The owner's screenshots: status and setup felt disconnected, an empty page on a PC, "open" on every row said nothing. No new call: the record and the variables are read anyway. The page stays under its 76 KB budget |
| Stop only in **⋯**; a run the list shows counts as working until it leaves the list | **Then (#188):** with the box empty while a run works, the send button is a ■ that stops it (it asks first; Enter never stops). A run the list shows counts only until a reply comes after it began, unless you write again; one that writes its status counts till it ends. The chip says what Auto runs ("Auto · Sonnet"). The watch's events leave **Now** for a last card, **Started by the watch**: each with its task's title and why in words. The budget is 80 KB | The owner's screenshots: "Working · 1m 40s" under the reply that had just come, in the thread and its row (the run's last steps, then the run its taken-in words queued, which finds nothing new); a bare "Auto" on a task Sonnet answered; "started #160 (its job)" at the top of Status & setup said nothing. No new call |
| Close and Reopen in **⋯**, sent as words a run acts on | **Then (#188):** **Close** or **Reopen** in the thread's header. It's still the word through the door (way 1), but the door closes or reopens the task as it writes it, so the thread and the list change at once, and the run after it tidies quietly. A run GitHub lists for a word that starts no agent isn't shown as Working | The owner's screenshot: `close` on #196, then "Working · 0m 23s" under it while a box got ready just to close the task. One more call, only for these two words. The page still has no write API of its own |
| Found on the way: a run reads a task's first 5 chat files | Fixed here: a run takes the **newest** 5 and its prompt names the older ones it left out (`newestFiles` in `cli/kernel/run.ts`) | The owner asked for what was left to be finished; it's a few lines with a test |

**Not checked live** (nothing on the box can reach Cloudflare's dashboard or open a browser): the Access path `admin/*` in front of `/admin/chat/` and `/admin/status` (setup's step 2 and `ship door page` check it; until then the edge refuses both itself), whether the first deploy creates the KV store (Wrangler 4.142 provisions a binding with no id; setup's step 4 reads the Worker's bindings and says if it's missing, and words work without it), a diagram drawn in a real browser (the frame, the pinned script and its hash are tested; Mermaid's drawing isn't), and an iPhone's photo picker.

## Context

Telegram is the only chat today. It's someone else's app, it cuts long replies at 3,500
characters, and some things are awkward there or on GitHub: seeing what's running, repeats, the
notebook. Over five messages, the owner asked for a chat window of Shipify's own that is private,
takes attachments, lets you pick the model, shows each run's details, manages chats, and is good on a
phone. It should be an extension that leaves the core alone, read cleanly, and set up cleanly.
Last, they asked for **no sign-in to plan** (the status page's rule, with no users), a **simpler,
lighter** window that updates as things come, shows Markdown and photos, and doesn't struggle
because its data is on GitHub. Then they asked that it use the door and the same interfaces rather
than webhooks, and that it be the place to see and set what's hard to manage on GitHub and Telegram:
the setup, the boxes, files, and downloading replies. Last, they asked how repeats and settings are
set up when there's no direct API, for the most basic plan made ready, and how far the window should
grow beyond chat (time-based and deterministic flows, models, tools and MCP servers), in layers.

The edge already has everything a chat needs except the window: the door (commands, `#12`, dedupe,
files for runs), the status page's sign-in, and the record on GitHub, where every reply is written.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| The status page's check is only "a genuine Access token for this application", with no person or email | `edge/src/access.ts` (`accessTokenOk`), `edge/src/page.ts` |
| `ship door page` sets up Access for host `shipify.<domain>`, path `status` | `edge/setup/page.ts` |
| Whether a path of `status` also covers `/status/chat` isn't stated. Cloudflare says a wildcard path (`status/*`) covers what's under it but not the path itself | Cloudflare's "Application paths" page (2026-10). Build step 1 checks it live. If it doesn't cover it, the fix is one edit to the same application: the path `status*`. Either way the edge checks the token on every chat route, so a gap fails closed (403), never open |
| The door lets a message in only from a person in `SHIPIFY_PEOPLE` with an id on that channel, and writes their name | `edge/src/door-in.ts` (`personOf`), `edge/src/settings.ts` |
| The door's dedupe, albums, commands, closed door and answers work the same for any channel: a new adapter gets them by passing the conformance test | `edge/src/door-in.ts`, `tests/edge/channels.test.ts` |
| A door message carries one file. Several files are an album: one message each, landing on one task | `edge/src/channels/channel.ts` (`Message.file`, `album`), `edge/src/door-in.ts` |
| A run fetches at most 5 chat files, 10 MB each, through the adapter named in the file's ref (`GET /door/file/web:<id>`) | `cli/contracts/shapes.ts`, `cli/kernel/run.ts`, `edge/src/files.ts` |
| A run takes the **first** 5 chat files on a task, so newer ones are left out (Telegram's too) | `cli/kernel/run.ts` (`.slice(0, MAX_FILES_IN)`). A fix of its own, below |
| On a reply's first send, the door hands every chat's adapter the files the run made, when its `limits.files` is true | `edge/src/door-out.ts` (`deliver`), `edge/src/chat.ts` (`outgoingOf`) |
| Asked with `application/vnd.github.full+json`, GitHub returns each body's raw text (with its hidden lines) and its `body_html` (rendered and cleaned by GitHub) | GitHub's REST docs ("media types"). `cli/lib/github.ts` already reads `body_html` this way |
| A task's comments can be asked for `since` a time, so a working thread fetches only what's new | GitHub's REST docs. `cli/lib/github.ts` already uses `since` |
| A conditional request answered 304 doesn't count against the door App's 5,000 calls an hour | GitHub's REST docs ("conditional requests") |
| Workers KV on the free plan: 1 GB, 1,000 writes a day, keys that expire by themselves. The pinned Wrangler creates a KV binding that has no id on deploy | Cloudflare's KV limits page (2026-10); ADR 0022. Build step 1 checks this on the first deploy |
| A Worker's static assets are free. With `run_worker_first`, every request reaches the Worker first, so the page's files sit behind the same check | Cloudflare's static assets page (2026-10). Build step 1 checks this with the pinned Wrangler |
| A task's body is read as a form by its `### <label>` headings, not by who wrote it or its labels. A body the door wrote is read the same way, after its from-line. So a new task whose words are the Repeat form's headings (What, When, Kind, Check, Model) sets its repeat with no agent, adds the `repeats` label and says when it runs next. A wrong answer gets the form's own "needs you" | `cli/lib/form-reader.ts` (`readForm`), `cli/kernel/snapshot.ts` (`withoutLine`, `repeatForm`), `cli/kernel/decide.ts` (`repeatFromForm`, checked before the intent). The build adds a test that goes through the door |
| `use …`, `close`, `again`, `stop repeating`, `resume`, `remember …: …`, `forget: …` are taken from any chat | `docs/tasks.md` ("Fixed words"), `docs/notebook.md`, `docs/recipes.md` |
| `doorIn(req, env, deps, channel)` asks the adapter to `verify` and `parse`, then does the rest itself; with `answer`, the door's words come back as the response, so a caller inside the edge gets "Got it · #12", or `/ping`'s and `/apps`' answers, at once | `edge/src/door-in.ts`, `edge/src/channels/channel.ts` |
| A reply goes out once, through `/door/replied`, to each chat in its `to`; the record is the comment on the task, whether or not any chat took it | `edge/src/door-out.ts` (`replied`, `deliver`), `cli/contracts/shapes.ts` (`Reply.to`) |
| The door App reads only issues, Actions runs, runners and variables: **no Contents**. So the edge can't read `executors.json` or `tools.json` from the repo, nor a run's files on the `shipify-files` branch | `docs/door.md` ("The door App") |
| The edge already builds files from the repo into itself (`package.json`, `cli/contracts`), and `ci.yml` redeploys it on any change to main that isn't only docs. So `executors.json` and `tools.json` can be built in the same way, and stay current | `edge/src/app.ts`, `.github/workflows/ci.yml` |
| A runner says its name, `online`, `busy` and labels; a running job says its runner's name. That's enough to show each box, its slots and which task each slot is on | `edge/src/settings.ts` (`toBoxes`), GitHub's REST docs ("workflow jobs") |
| The door App can only read variables, so nothing in the edge can change `SHIPIFY_PEOPLE`, `SHIPIFY_DOOR` or `SHIPIFY_KEY_DATES` | `docs/door.md` |

## Options

- **A: Host an open-source chat app** (Open WebUI, LibreChat, Chatwoot …). (+ polished on day one.
  − It needs a server and database running all the time, and keeps its own users and history next to
  GitHub. It's built for a model that answers in seconds, its model picker skips the runs and the
  approvals, and the bridge to Shipify needs a new key that can write.)
- **B: A new app in its own repo.** (− It needs a second door and a second key that can write
  tasks.)
- **C: A separate Worker** calling the edge. (− The edge would need an internal API: a change to the
  core.)
- **D: An extension in the edge,** at `/status/chat`, behind the status page's sign-in. It writes
  through the door and reads GitHub. (+ It uses the same door, words and record, needs no new sign-in,
  host or key, costs nothing, and can be removed. − Replies arrive because the page asks for them,
  not because they're pushed.)
- **E: D with a chat widget** (Deep Chat). (− The edge gains a dependency. The widget is built for
  one conversation with a bot; this is a list and threads.)

## Decision

We chose **D**. The window is plain HTML, CSS and two small scripts of Shipify's own, with no
framework, no libraries and no build step. All of it together should stay under 40 KB, and a
test checks that.

### The extension and the core

- **Where it lives:** `edge/src/web/` (routes, reads, shapes, cleaning, files),
  `edge/public/status/chat/` (the page) and `edge/src/channels/web.ts` (its adapter). Nothing else
  imports them, apart from one line in `app.ts` and one in the channel registry. A test enforces
  this.
- **Core lines touched: four.** The mount in `app.ts`, the adapter in `channels/index.ts`, an
  optional `FILES` binding in `env.ts`, and the KV store and assets in `wrangler.jsonc`. Nothing
  changes in the channel contract, the door, its way out, the watch, `cli/`, the box, `task.yml` or
  `ship setup`.
- **No sign-in of its own:** every chat route checks the Access token exactly as `/status` does
  (`accessTokenOk`), and nothing more.
- **Who writes:** you. The door lets in only a person in `SHIPIFY_PEOPLE`, so `ship add web` gives
  your entry `"web": "me"`, and every message from the chat is sent as `me`. Anyone who gets past
  the sign-in writes as you. That's the same trust as the status page, which shows them everything
  already.
- **Off until it's turned on:** until someone has `on.web`, `/status/chat` says how to turn it on.

### The door, end to end: the same interfaces, no webhooks

The chat is one more adapter on the channel contract (ADR 0032), like Telegram's. It differs in one
place: how a message reaches the door.

```
Telegram:  your phone → Telegram's servers → webhook POST /door/telegram → adapter → doorIn → GitHub
Web chat:  the page → POST /status/chat/api/send → extension → adapter → doorIn → GitHub
                                                   (same Worker, a direct call: no webhook)

Back, for both:  a run → its reply on the task (the record) → POST /door/replied → each chat in `to`
                 Telegram's adapter sends it to Telegram · the web adapter keeps its files
                 the page reads the task, where the reply already is
```

- **Into the door:** the extension builds the door's own `Message` (the `web` channel, the user `me`)
  and calls `doorIn` with the web adapter. Everything after the adapter is the door's own code, not
  a copy: the person check, the closed door, commands, `#12`, dedupe, albums, the from-line with its
  file refs, and the answer. The adapter's `answer` turns the door's words into the response, so the
  page gets "Got it · #190" (or `/ping`'s answer) at once.
- **Why `POST /door/web` from outside gets nothing:** the adapter's `verify` checks a value the
  extension makes when the Worker starts and never sends anywhere. An outside request can't know it,
  so it gets the door's 401, as a forged Telegram webhook does.
- **Out of the door:** unchanged. The run writes the reply on its task, then calls `/door/replied`
  as it always does. The web adapter's `send` keeps the run's files in KV and answers `ok`; it has
  nothing to push, because the page reads the task.
- **Why the flow keeps working:** nothing waits on a delivery. The task is the record, so a closed
  page, a dropped connection, a phone asleep or a Telegram outage loses nothing: the page shows the
  reply the next time it reads. Telegram and the chat don't depend on each other.
- **A thread is a task:** opening one reads the issue and its comments; every button in it sends
  the words you'd type. The chat keeps nothing of its own about a task except the copy in your
  browser, which is only for speed.

### What it looks like

One screen. On a phone, the list and a thread take turns; on a PC, they sit side by side. It follows
your system's light or dark mode, uses the system font, and has one accent colour. No avatars, no
animations beyond a fade.

**The list**

- **Running now** at the top: each task with a run going, "Working · 2m 10s" counting up, and
  **Watch it** (the live log). The line under it shows the boxes: "homepi online · 1 of 2 busy", or
  "No box online: tasks wait".
- **Then each task,** one row: `#12`, its title, a dot for its state (needs you · working · done ·
  failed · closed), where it started as a small word (Telegram, GitHub, repeat, recipe), and how long
  ago. What needs you comes first.
- **Search** across titles; `#12` opens task 12. **+** starts a new chat.

**A thread**

- **The head:** its title, its model ("Opus · high", or "Auto"), its PRs with open or merged, and a
  **⋯** menu with On GitHub, Files (this task's), Download the thread, Run again, Close, and Stop
  repeating or Resume.
- **The messages:** yours on the right, Shipify's on the left, anyone else's with their name. Each is
  shown whole, as GitHub renders it.
- **Under each reply:** one run line ("Opus 5.5 · high · 5m 44s · 2.3M in, 29k out"). Tap it for the
  full table and the run. Then the reply's buttons (the PR, **Approve on GitHub** …) and its question.
  A long press (or **⋯** on a PC) gives Copy and Download (`#12-reply-3.md`).
- **Calls waiting for your `yes`:** shown as a card with each call exactly as the run proposed it,
  and **Say yes on GitHub**.
- **While a run is going:** a quiet "Working · 1m 05s" bubble at the bottom. It becomes the reply
  when that lands.

**The box you write in:** it grows as you type, up to a few lines. **📎** picks files or takes a
photo, and on a PC you can drop or paste a screenshot. A small model chip (Auto ▾) opens the menu:
Auto, Haiku, Sonnet, Opus, Fable, then the effort. The choices come from `executors.json`, built
into the edge when it deploys (the door App can't read the repo's files). Enter
sends on a PC; on a phone, the send button does. A **/** at the start lists the commands.

**+ (new chat):** an empty thread with the box ready. Four chips above it fill in the words Shipify
already reads, so you don't have to remember them: *Ask*, *Change a project* (pick it from a list),
*New app*, *Repeat* (the form below).

**☰ Repeats: set up and run without an API.**

- **The list:** every repeat and recipe, with its kind, when it runs next and its last reply.
- **New repeat** is the GitHub Repeat form's fields, in the page:
  - **What**;
  - **When**, with its examples to tap;
  - **Kind** (reminder, job or check);
  - **Check**, picked from the names of the `checks/` scripts (built into the edge, like
    `executors.json`), and shown only for a check;
  - **Model**, shown only for a job.

  The page checks the answers first, as the form's reader will. **Create** sends one new task
  through the door, with the title `repeat: <what>` and the answers under the form's own headings:

  ```
  repeat: Look at the servers
  ### What
  Look at the servers
  ### When
  every day at 09:00
  ### Kind
  A reminder (posts the text; no agent)
  ```

  The core reads that as the Repeat form, so it sets the repeat **with no agent** and replies
  "Repeating · every day at 09:00 · next: …". A wrong answer gets the form's own "needs you", and
  the thread says what to fix.
- **On each repeat:** **Run now**, **Pause**, **Resume** and **Stop** send `again`, `close`,
  `resume` and `stop repeating`.
- **Change** opens its thread with "Change it to: " ready to finish ("every weekday at 8"). A run
  sets it, as it does for those words on Telegram. Only GitHub's Edit can change the form itself,
  and the door can't edit.
- **Recipes:** **Turn on** an example sends `shipify: turn on the <name> recipe`, which ends in a PR
  (way 2).

**☰ Notebook:** every note, plus **Add** and **Remove**, which send `remember …` and `forget …`.
Every button on these pages sends the words you'd type, so the door handles them as it handles
Telegram's.

**☰ Files:** every file sent from the chat or made by a run in the last 7 days, newest first, each
with its task, its size and how long it has left. Pictures show as small previews. A tap opens or
downloads it under its own name. One KV listing, kept a minute.

**☰ Setup:** what's hard to see on GitHub or Telegram, on one page, read-only. Each part says how to
change it, the way it changes today:

| Part | Shows | To change it |
|---|---|---|
| **The door** | open or closed, the edge's version and commit, the door App's reach (what `/health` says) | the variable `SHIPIFY_DOOR` (`closed`), a link to GitHub's variables page; `pnpm ship door check` on your PC (shown, with a copy button) |
| **Boxes** | each box, online or not, its slots, and the task each busy slot is on (a tap opens it) | `pnpm ship box status` / `box add` / `box remove` on the box (shown, with a copy button) |
| **Chats** | each channel, whether it's set up and healthy, and who is on it (ids shortened) | `pnpm ship add telegram` / `add web` |
| **Models** | the menu, the default and each one's efforts, from `executors.json` | per task: the model chip. The default: **Change…** starts a chat "shipify: make … the default", which ends in a PR |
| **Projects** | each project, its live address and health (what `/apps` says) | **Change…** starts a chat on that project |
| **Tools** | each tool in `tools.json` (MCP servers included), what it may look at, what it may change after your `yes`, and what it may do without asking (`pre`) | **Change…** or **Add a tool…** starts a chat on shipify, which ends in a PR. Its keys: `pnpm ship add <tool> --yes` on your PC (shown, with a copy button), never typed into the chat |
| **Checks** | each script in `checks/` and the repeats that use it | **New check…** starts `shipify: a check that tells me when …`, which ends in a PR |
| **Key dates** | each date and how long until it | `SHIPIFY_KEY_DATES`, a link to GitHub's variables page |
| **Check now** | sends `/ping` and shows the boxes' answer | |

Setup never writes anything itself. The door App can only read variables, and changing Shipify's
own files goes through a PR, so the page says where the change is made rather than making it: one
place to look, the same safe ways to change.

What only GitHub can do (`yes`, `go`, `publish`, a merge) is a button that opens GitHub, as in
Telegram.

### Loading and updates: why GitHub doesn't make it slow

| Concern | How it's handled |
|---|---|
| **Opening the page** | It shows the list and the threads from the copy it last saw (kept in the browser, at most the last 30 threads), then fetches what changed. No blank screen, no spinner over content: only a thin bar at the top while it fetches |
| **The first time, or a thread not seen before** | Three grey placeholder rows or bubbles, then the content. A thread is one edge call, and the edge makes two GitHub calls (the issue and its newest 100 comments) |
| **Staying fresh** | The page asks every 5 seconds while the thread on screen has a run going, every 30 seconds otherwise, at once when you come back to it, and never while it's hidden. A working thread asks only for comments `since` the last one it has |
| **Cost** | Every read carries an `ETag`. Nothing changed: a 304, which costs no GitHub quota, and the edge also holds each read for 5 seconds. A day with the page open stays far inside the door App's 5,000 calls an hour |
| **Something new arrives** | It's added in place, without the list jumping. In a thread you're reading higher up, a "New reply ↓" pill appears instead of the page scrolling you away |
| **Sending** | Your message shows at once, marked *Sending…*, then *Sent · #190* when the door answers. A new chat opens as its task straight away. If it fails, it stays there with **Retry**; nothing you typed is lost |
| **Offline** | It shows what it last had, with a thin "Offline" bar, and sends once you're back |
| **A new version deployed** | The page notices the new version and shows "Updated: tap to reload" |

No push and no server holding connections open: polling with `ETag`s is cheap here, and it's simple.
A closed page doesn't notify you, so keep Telegram for pings if you want them.

### Markdown and photos

- **Markdown:** GitHub renders it. The edge asks for `body_html`, so tables, code, task lists, links,
  quotes and folded details look as they do on GitHub. The page has no Markdown library. Before
  sending HTML to the page, the edge keeps only a short list of safe tags (`web/clean.ts`). The
  page's CSP allows only its own scripts. That's two locks.
- **Reply bits:** each reply's hidden reply line gives its state, run line, buttons and question.
  The reply's own "Run details" fold moves under the run line, so it's one tap. Hidden lines never
  reach the page.
- **Your own words:** the `📎 name` lines the door adds become the files themselves, and a
  `use opus high` line becomes a small "Opus · high" tag.
- **Photos you send:** they show in your message at once, from your phone. They upload as soon as
  you pick them, each with a thin progress ring. A photo is shrunk to 2,048 px, the right way up,
  without its location or camera details. A pasted screenshot is named `screenshot-<time>.png`.
  Limits: 5 a message, 10 MB each, which is what a run reads.
- **Photos in the thread:** each sits in a fixed-size box from its width and height, so nothing jumps
  while it loads. They load lazily. A tap opens one full screen, where you can pinch to zoom.
  - **Yours** come from the edge's KV store (7 days).
  - **A run's**, on a task you've written in from the chat, come from KV too: the web adapter keeps
    them when the reply goes out to `web:me`. (Elsewhere they sit on the `shipify-files` branch,
    which the door App can't read.)
  - **Ones pasted on GitHub** come through GitHub's signed links.
  - **Older or other files** are a chip that opens on GitHub.
- **Other files:** a chip with an icon, the name and the size; a tap downloads it. Only PNG, JPEG,
  GIF and WebP are ever shown inline. Anything else, HTML and SVG included, downloads with `nosniff`,
  so a file can't run on the edge's address.
- **On a phone:** text is at least 16 px, so the screen doesn't zoom when you type. Code and tables
  scroll sideways in their own box, and long links wrap. The box stays above the keyboard and clear
  of the notch.

### How the parts talk

```
the page  ──JSON /status/chat/api/*──▶  the extension (edge/src/web/)
                                          ├ writes: doorIn(…, web)  → GitHub, as the door App
                                          ├ reads:  GitHub, read-only (full+json, ETag, since)
                                          └ files:  KV (FILES), 7 days
a run  ──GET /door/file/web:<id>──▶  the web adapter  ──▶ KV
```

| Route | Gives |
|---|---|
| `GET /status/chat` and its files | the page |
| `GET …/api/list` | Running now, the boxes, and the 100 tasks updated last |
| `GET …/api/task/<n>?since=` | a thread: its head and its messages (only the newer ones with `since`) |
| `GET …/api/repeats`, `…/api/notebook` | the two ☰ pages |
| `GET …/api/menu` | the model menu (`executors.json`, built in), the projects, the limits, and whether files are on (asked once) |
| `GET …/api/files` | ☰ Files: what's in KV, from each file's own metadata (task, name, type, size, made) |
| `GET …/api/setup` | ☰ Setup: the door, the boxes and their running jobs, the chats, the models, the projects, the tools (`tools.json`, built in), the key dates |
| `POST …/api/file` | one file into KV; back comes its id |
| `GET …/api/file/<ref>` | a file to look at, served safely |
| `POST …/api/send` | `{ id, task?, words, use?, files }` → the door's answer, and the task's number |

- **Downloads need no route:** a thread's read already carries each message's raw Markdown (hidden
  lines removed), so Copy, Download and Download the thread happen in the page.
- **Every answer has one shape** (`web/shapes.ts`, checked as it leaves the edge). Errors all look the
  same: what happened and what to do. The page never shows a status code.
- **Into the door:** a send becomes the door's own messages for the `web` channel, with the user
  `me`: `use …` as its own first line, then your words and the first file, then one message per
  further file, together as an album. The door's dedupe means a double tap, a retry or a second tab
  is written once, because the page makes the message's `id` once. The adapter's `verify` takes only
  what the extension hands it (above), so `POST /door/web` from outside is refused.
- **Another site can't post for you:** the two `POST`s need the edge's own `Origin` and the header
  `x-shipify-chat: 1`.
- **Replies are read where they are:** on the task. The adapter's `send` only keeps a run's files and
  answers `ok`, so the door's way out and the watch don't change. A reply that also goes to Telegram
  still does.

### What changes in the code

| Where | What |
|---|---|
| `edge/src/web/` (new) | `routes.ts` (the routes, the token check, the `Origin` check), `reads.ts` (list, thread, repeats, notebook), `setup.ts` (☰ Setup, from what the edge already reads, plus `executors.json`, `tools.json` and the names in `checks/`, imported at build), `forms.ts` (a new repeat's answers checked and written under the Repeat form's headings; a test keeps its labels and choices in step with `4-repeat.yml`), `shapes.ts`, `clean.ts` (the safe-HTML list), `files.ts` (KV in and out, each file with its metadata, and the listing for ☰ Files) |
| `edge/public/status/chat/` (new) | `index.html`, `app.js` (list, thread, the four ☰ pages, downloads, polling, the copy kept in the browser), `compose.js` (the box, the model menu, files, shrinking photos), `app.css`, `manifest.json` and an icon (so **Add to home screen** looks like an app), each `// @ts-check` |
| `edge/src/channels/web.ts` (new) | the adapter: `verify`, `parse`, `answer`, `send` (keeps a run's files), `file` (from KV), `chatId` = `me`, `limits: { text: 16000, files: true }` |
| `edge/src/channels/index.ts`, `edge/src/app.ts`, `edge/src/env.ts`, `edge/wrangler.jsonc` | one line each: the adapter, the mount, `FILES?`, then the KV store with no id and `assets` with `run_worker_first` |
| `tools.json`, `tools/web/setup.ts` (new) | `ship add web`, `selftest web`, `remove web`, as Telegram's are |
| `tests/edge/web/` (new), `tests/architecture.test.ts` | below |

### The build, in order (one PR after `go`)

1. **Check the live facts first:**
   - whether the Access path `status` covers `/status/chat`, or needs `status*`;
   - whether the deploy creates the KV store and keeps reusing it;
   - whether static assets sit behind the Worker;
   - whether `CF_DEPLOY_TOKEN` can create the KV store;
   - whether an iPhone's photo picker hands over JPEG.
2. **The adapter and the shapes,** test-first, with the conformance fixtures and the architecture
   rule.
3. **The routes:** the token check, the `Origin` check, files, sends into the door, and a new
   repeat from the form, tested through the core's own form reader.
4. **The reads and the cleaning,** tested against real replies from this repo.
5. **The page,** following the `frontend-design` skill. Check it at a phone's width and a PC's, in
   light and dark, with the keyboard up, and with large text.
6. **`ship add web`, `selftest web` and `remove web`.**
7. **The docs,** the version (a minor) and the changelog.

## Later, in layers

These are not part of this build. Each one is small, uses the three ways above, and gets its own task
(and an ADR where it touches the core). The window stays a cockpit over the one core: the core is the
one place where work happens, and the window is the easiest way to see it and say exactly what you
want.

| Layer | What it adds | What it needs |
|---|---|---|
| **1. This build** | see everything; chat; the exact words from buttons; forms where the core is already deterministic (the Repeat form) | nothing in the core |
| **2. Settings forms that make a PR with no agent** | today a settings change is a `shipify: …` chat, and an agent writes the PR. When the change has a fixed shape, a form could hand the box the exact edit, and the box would open the PR itself, as it sets a repeat from a form: turn a recipe on or off, change the default model in `executors.json`, add a pre-approved call, add a known MCP server's `tools.json` entry. Your merge is still the approval | a core change: a new form in `.github/ISSUE_TEMPLATE/`, and a no-agent step in the box that makes that one edit. Its own ADR |
| **3. Watching, shown well** | checks are already deterministic: a merged script, at most every 15 minutes, which says only what changed. The Repeats page could show each check's values over time, and **New check…** could offer templates (a web page changed, a price, a version, a site down) | the values kept where the edge can read them, such as the task's status comment |
| **4. Tools and MCP servers from a form** | **Add a tool** asks for the server (a package, an address, or one of ours) and what it may look at or change. It ends in the PR (the `tools.json` entry and the `task.yml` lines), then shows `pnpm ship add <tool> --yes` for the keys | layer 2 for the PR. Keys never pass through the page or a task: words in the chat land on GitHub |
| **5. Pings** | a notification when something needs you, with the page closed (Web Push) | a stored subscription and a sender in the edge. Worth it only if you drop Telegram |

**Not planned:** the edge writing settings itself (variables, secrets, files) or keeping its own
settings store. That needs a key on the edge that can write, splits the record away from GitHub and
skips review. If a later layer seems to need it, it gets its own ADR first.

## Edge cases

- **A key or token pasted into the box:** words land on a GitHub task, so the page warns before
  sending anything that looks like a key ("This looks like a secret: use `pnpm ship add <tool>` on
  your PC instead"), and you have to tap again to send it anyway.
- **A new repeat with an answer the core won't take** (a schedule it can't read, a check that isn't
  in `checks/`): the page says so before sending. If the core still refuses it, the thread shows the
  form's "needs you" with what to fix, and **Change** sends the fix in words.
- **Access doesn't cover `/status/chat`:** the edge sees no token and answers 403 itself. `ship add
  web` says to change the path to `status*`.
- **No one on `on.web`:** the page says "run `pnpm ship add web`"; nothing is written.
- **A double tap, two tabs, a phone and a PC, a retry:** written once.
- **Offline, GitHub down or the door closed:** nothing is sent. Your words and files stay in the box
  with the reason, and reading shows what it last had.
- **A task that won't take your words** (locked, the status task, a notebook page): the door's
  refusal shows at once.
- **A model picked while a run is going:** it applies from the next run, as on Telegram.
- **Files:**
  - A sixth file, or one over 10 MB, is refused in the page and at the edge.
  - Files with no words on a new chat: send stays off until you say what they're for.
  - An upload that's cut off shows **Retry**.
  - An id that isn't in KV is refused.
  - KV's 1,000 writes a day used up: the file is refused with that reason, and words still go.
  - A file past 7 days shows its name greyed out, "Gone after 7 days".
  - Sound and video are taken, with "a run can't listen to or watch this".
  - HTML and SVG only ever download.
- **No KV store yet:** 📎 is off ("files aren't set up"); words still go.
- **A long thread:** the newest 100 messages, then **Earlier**. Download the thread fetches the
  rest first, so the file is whole.
- **A box that's gone quiet mid-run:** Setup and the line under Running now show it offline, and
  the task's "Working" bubble shows the run as GitHub sees it (queued, or still under way).
- **`executors.json` or `tools.json` changed:** the menu and Setup show the new one once the edge
  redeploys, which `ci.yml` does on the merge.
- **The edge can't reach GitHub:** Setup shows what it last had, with when.
- **`POST /door/web` from outside:** 401, as a forged Telegram webhook gets.
- **Something the cleaning removed** (an embed, a style): a small "Open on GitHub to see all of it".
- **A task from Telegram, answered here:** your words land on it, and its replies still go to
  Telegram as well.
- **Pause and Stop on a repeat:** Pause closes the task and keeps the repeat, so **Resume** brings it
  back. Stop ends it, after "Sure?".
- **Closed by mistake:** writing in it reopens it. Delete and rename aren't offered, because the task
  on GitHub is the record.
- **Taking it out:** `ship remove web --yes` drops `on.web`, so nothing more is written. Deleting its
  folders and its four lines removes it. Its files expire by themselves.

## Setup

About two minutes, after the status page, and only if you want it:

```sh
pnpm ship add web        # the plan
pnpm ship add web --yes  # does it, one checked step at a time, safe to run again
```

| Step | What it does | It's done when |
|---|---|---|
| 1. **The status page** | reads `SHIPIFY_ACCESS`. If it isn't set: "run `pnpm ship door page --yes` first" | it's set |
| 2. **The same sign-in** | asks `/status/chat` as a stranger. If the edge answers 403 itself, it shows the one edit: path `status*` in the "shipify status" application | a stranger is sent to Access's sign-in |
| 3. **You** | adds `"web": "me"` to your entry in `SHIPIFY_PEOPLE` | it's there |
| 4. **Files** | checks the deployed edge has `FILES` bound, and names the token permission if the deploy can't create it ("Workers KV Storage: Edit") | it's bound, or the one thing left is named |
| 5. **Open it** | opens `https://shipify.<APPS_DOMAIN>/status/chat`, and shows the address for your phone | you send `/ping` and see the boxes' answer |

`selftest web` repeats steps 1, 2 and 4. `ship setup` doesn't change.

## Found on the way

A run takes the **first** 5 chat files on a task (`cli/kernel/run.ts`, `.slice(0, MAX_FILES_IN)`).
On a task that has already had five, a new file (from Telegram today, or from here later) is
silently left out. The fix belongs in the core, so it's not part of this extension: it's a small fix
of its own, taking the newest 5 and naming what was left out.

## Docs

`docs/channels.md` (the web chat next to Telegram; "read in place"), `docs/door.md` (the routes,
files in KV), `docs/setup.md` and `docs/getting-started.md` (`ship add web` after the status page),
`docs/security.md` (the token check, the `Origin` check, the cleaning, files served safely),
`docs/troubleshooting.md`, `docs/glossary.md`, `docs/roadmap.md`, `README.md`, `AGENTS.md` (the
channel row) and `CHANGELOG.md`.

## Consequences

- **Easier:** one light page on your phone for every task, with what's running, long replies shown
  whole and formatted, photos both ways, the model a tap away, repeats set up from a form with no
  agent, and notes without remembering their words. The setup, the boxes and the files are in one place, and any reply
  downloads. Telegram becomes optional.
- **Harder:** the edge serves its first scripts, so the cleaning, the CSP and how files are served
  need care, and tests. Replies arrive when the page asks, so a closed page doesn't ping you.
- **Unchanged:** the core, the runs, the boxes, the record, approvals on GitHub, `ship setup`, the
  status page and every other channel.

## Confirmation

- **The adapter** passes `tests/edge/channels.test.ts`. The architecture test allows only `app.ts`
  and the registry to import the extension.
- **The routes:** with no token, or the wrong one, every route answers 403. A `POST` with a foreign
  `Origin` is refused. `POST /door/web` is refused. Every error has one shape. An unchanged read
  answers 304.
- **Into the door:** a test sends `use opus high`, `close`, `again`, `remember Test: …` and `forget:
  …` from the chat and checks the door writes them as it does Telegram's. Three files land as one
  album, and the same `id` twice is written once. The page's send and a Telegram webhook with the
  same words write the same comment, apart from the from-line's channel.
- **A new repeat:** each kind (a reminder, a job with a model, a check) sent from the page's form
  through the door is read by the core as the Repeat form: no agent, the `repeats` label, its next
  time. A wrong answer gets the form's "needs you". The page's fields match `4-repeat.yml`.
- **Setup and Files:** `setup.ts` is tested against recorded runners, jobs, variables and the
  status record; it holds no secret and no full chat id. ☰ Files lists only what's in KV and drops
  what has expired.
- **Files:** sizes and counts are refused at the edge. Only pictures are shown inline. A file past
  its time is a 410. A run's `GET /door/file/web:<id>` gets the bytes.
- **Formatting:** `clean.ts` is tested against real replies (tables, code, details, task lists,
  pictures) and a list of known script tricks. Hidden lines never reach the page.
- **Setup:** `pnpm ship selftest web` confirms a stranger is sent to Access and the store is bound.
