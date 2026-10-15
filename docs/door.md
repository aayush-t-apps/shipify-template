# The door

The edge's way in and out. The edge is one Cloudflare Worker, `shipify`, at its free address
`shipify.<your workers.dev name>.workers.dev`, and at `shipify.<APPS_DOMAIN>` too when you have a
domain (ADR 0047: no domain needed). Below, its address is written `<the edge>`. It's built from
`edge/`. Its door writes your chat messages onto tasks, copies replies back to your chats, and
hands runs the files you sent. It keeps nothing: GitHub is its memory. The watch lives in the same
Worker ([watch.md](watch.md)).

| Route | For | Proof |
|---|---|---|
| `POST /door/<channel>` | your messages from a chat: `/door/telegram`, one route per channel adapter (`edge/src/channels/`). The web chat's adapter is called from inside the edge, so `POST /door/web` from outside gets 401 | the adapter's proof (Telegram's secret header), a private chat, a sender in `SHIPIFY_PEOPLE` on that channel |
| `POST /door/replied` | a run's new reply, to copy to your chats | the run's GitHub OIDC token |
| `GET /door/file/<ref>` | a file you sent, for a run | the run's GitHub OIDC token |
| `GET /admin/status` | the status page, for you ([below](#the-status-page)) | Cloudflare Access's sign-in (one application, path `admin/*`), and its token checked by the edge |
| `/admin/chat/`, `/admin/chat/api/*` | the web chat: its page, reads, files and sends ([below](#the-web-chat)) | the same as `/admin/status`. A `POST` also needs the edge's own `Origin` and `x-shipify-chat: 1` |
| `GET /`, `/admin` | send you to `/admin/chat/` (a `GET` only) | none: a redirect, nothing shown |
| `GET /draw/` | the web chat's diagram frame: a static page with no data ([below](#the-web-chat)) | none: outside the sign-in |
| `GET /note/icon.png`, `/note/badge.png` | a notification's icon and badge, which the phone fetches by itself (ADR 0050) | none: outside the sign-in, so they show after its session ends |
| `GET /health` | `ci.yml` and `ship door check` | none. It shows the version, the commit, and the door App's reach and permissions, nothing secret |

- **Anything else** gets 404.
- **A route missing a key** answers 503 `unconfigured` and logs the key's name, never its value.
- **Errors** never show the code's insides.
- **Logs:** one masked JSON line per event (`door.in.*`, `door.out.*`, `door.file.served`, and the
  web chat's, under the status page's `page.refused` and `page.served`, with the step `web`). No line holds your words, a chat id, a file's
  reference or a key.

## In: your messages

Each chat's adapter proves its webhook and reads it into one Message
([channels.md](channels.md#adding-another-channel)); everything below is the door's, the same for
every channel.

**1. It checks the sender** before reading anything else:
- The adapter's proof (Telegram's secret header). Wrong: 401.
- A private chat, and your id on that channel in `SHIPIFY_PEOPLE`.
- Anyone else, a group, or an update over 256 KB gets nothing at all (a 200, so Telegram doesn't
  retry).

**2. It answers what needs no run, at once, writing nothing:**

| You send | It answers |
|---|---|
| `/start` | what it does, with three buttons: Model, My tasks, Help |
| `/help` | how to use it, and every command (`intents.json`'s `help` and chat commands) |
| `/tasks` | your open tasks as buttons, grouped Working, Needs you, Repeating (each one's next time), Answered: one search of open issues, and the status task it reads for `/recipes` |
| `#12` alone | #12's head ("#12 · title · state · pick"), its number linked, with the reply box open on it |
| `/use` | the model picker: as a reply, the task's pick (its status comment, and any pick set since); sent fresh, your model, the one your new tasks start with. Each agent in its rows, its Auto first, and Claude's effort row ([channels.md](channels.md#picking-a-model-your-model)) |
| `use opus` sent fresh, or a tap in your model's picker | your model, kept, and said back ("Your model: Opus"); nothing written on GitHub |
| a pick it can't use (`use xyz`, alone or as a line of your words) | what a `use` takes, with a Model button. Judged against the task's own pick, read from its status comment, as the box judges it |
| `/ping` | "All good", or what isn't; each box (online, slots, busy) and the watch's last due run |
| `/ping pin` | in Telegram: the status sent and pinned with no sound, and no answer beside it. Its first line, all the top bar shows, says it all ("1 of 3 slots busy · #245"); then a line per box and per task working, each number a link. The watch keeps it up to date ([watch.md](watch.md)); unpin it to stop |
| `/apps` | each app with its link and health (10 at most; a taken-down app says so) |
| `/repos` | the repos Shipify can work on, by account, Shipify's own first, as the status task keeps them, each with when it was read ([tasks.md](tasks.md#which-repos)) |
| `/notebook` | each notebook page with its first line and link, Preferences first |
| `/recipes` | each recipe, when it runs next, and its task |
| `/models`, `/models <word>` | each agent's models, its Auto and efforts; with a word, what a gateway's own list has for it, with prices, each as a `use` line takes it ([agents.md](agents.md#finding-a-model)) |
| a menu command alone (`/ask`) | send it again with your words after it |
| a lone thanks (`ok`, `thanks`, 👍) | 👍; on a task that needs you, it's written, and its run takes it as your answer if a question waits (else a 👍, with no agent) |
| a lone `yes` or `no` that isn't a reply | how to answer a task |
| a voice note or a video, no words | type it, or send a screenshot |
| a photo or file, no words, no task | add a caption, or reply to a task's message |
| a sticker, or nothing it can read | it wasn't written down |

The same commands work on GitHub, answered by a run with no agent
([channels.md](channels.md)). `/start <code>` is `ship add <channel>`'s one-time link: a good code tells you your id, and a bad
one gets no answer.

**3. It writes everything else as the door App.** Each write starts with a hidden
`<!-- shipify-from {…} -->` line: who, the channel, the chat, the update's id, any file.
- **On a task:** a reply to one of the bot's messages (its first line names the task: "Done · #12
  · …"), or words starting `#12`, become a comment on #12.
- **A new task:** anything else, titled from your first line. It starts with your model, as a `use`
  line before your words (unless your words have one), and "Got it · #12 · Opus" says which.
- **A menu command with words** reads as its intent: `/ask what…` is `ask: what…`, and is always a
  new task, even sent as a reply.
- **A button tap** is its words, written as a reply to the button's message, with every check
  typed words get: a pick is a setting (no run), and `yes` isn't taken from a chat. The door then
  acknowledges it in the chat: a short note, the message drawn again (the picker's ✓), or its spent
  buttons taken off. A tap whose message's task can't be read (gone from the chat's view) is told,
  and nothing is written; only a command, `#12` or a pick needs no task.
- **Forwarded words** start with "(Forwarded)". They're never read as a command or a task number.
- **A file** goes in as a reference (`<channel>:<id>`, `telegram:<file_id>`), with "📎 <name>" in
  the comment. The run
  fetches it ([below](#files-for-runs)).
- **An album:** its first photo opens the task, or goes on the one it names. The rest land on that
  task quietly.

**4. It answers "Got it · #12",** the number a link to the task, adding "No box is online: it runs
when one is back" when that's so.

**Refused at once, nothing written:** #n doesn't exist; #n is a pull request, the status task, a
notebook page or locked; #n isn't yours (opened by someone other than you, the door or a run).

**Written once, with no state of its own** but one small record per chat, your model
(`model:<channel>:<chat>` in the web chat's store, edge/src/model.ts):
- **One at a time:** Telegram sends one update at a time (`max_connections: 1`, set by
  `ship add telegram`).
- **No duplicates:** before writing, the door lists its own writes of the last 15 minutes (the
  newest issues and comments: two calls) and looks for the update's id in their `from` lines. A
  retry is answered "Got it · #12" again and never opens a second task.
- **Albums:** a later photo finds its task the same way, by the album's id.

**When GitHub won't, it says so at once and writes nothing** (ADR 0042). Every answer is a 200, so
Telegram never sends your message again behind your back, and never holds later ones behind it:
- **GitHub is down:** "Couldn't reach GitHub: nothing was saved. Send it again in a minute."
- **GitHub refused the write:** said, with why; nothing was written.
- **The door App's key is refused:** said, with the fix, to a person in `SHIPIFY_PEOPLE` only. When
  the door can't read who you are, it says only that GitHub is down.
- **The door is closed** (the kill switch, below), or **the door itself broke:** said, in words.
- **A close or reopen GitHub didn't take:** "Couldn't close #12", and nothing written. On a task
  that's already closed (or open): "Already closed · #12", and nothing written.

**Edits** aren't read (the bot takes new messages only): send a new one.

## Out: replies to your chat

After a run writes a reply, its apply step calls `POST /door/replied` with the task, the comment's
number and up to 10 files it made (10 MB each).

1. **The token:** the run's GitHub OIDC token, checked against GitHub's published keys: RS256, the
   issuer, the edge's own address as the audience, shipify's repository and owner (by numeric id),
   `refs/heads/main`, `task.yml` or `watch.yml`, and its times (±60 s). No key is shared between
   boxes and the door.
2. **The comment:** the door reads it from GitHub itself. It must be on that task, written by a run
   (`github-actions[bot]`), carry a hidden `reply` line, and never have been edited by anyone but a
   run. Otherwise: 409, nothing sent.
3. **Where:** each chat in the reply's `to` (`<channel>:<id>`) that belongs to a person in
   `SHIPIFY_PEOPLE`, on a channel whose keys are set. Any other id is dropped.
4. **The words, the mark, then the files:** each chat's adapter renders the reply its own way.
   Telegram's: the words (a head "State · #12 · title", its number a link, up to about 3,500
   characters, then "The rest is on GitHub"), buttons that send words (`replyButtons`), and link
   buttons (https only). A question with no buttons to tap opens the reply box on itself. Then 🚀 on the comment, as the door App: "it
   reached every chat it was for", visible on GitHub. Then the files, each once, with its type:
   a picture as a photo, anything else as a file; any that didn't go are named in one short message
   ("2 files didn't send · On GitHub"). The web chat reads the task in place, so it sends no words:
   its `send` notifies your devices that a reply came ([channels.md](channels.md#notifications)),
   started before the other chats' and awaited after them, and its answer never counts toward the
   🚀; it keeps the run's files in its store for 7 days. A reply that has the door's 🚀 already
   isn't sent again, so it doesn't notify again either.

Nothing is ever sent twice (ADR 0042). When a reply doesn't reach you, you're told once:

| When it doesn't reach you | Then |
|---|---|
| the chat is busy (Telegram's 429), didn't answer, or the run couldn't reach the door | no 🚀: after 2 minutes the watch sends that chat one short notice, "#12 has a reply you didn't get here", with its link, and marks the reply 😕. If the notice can't go either, a note on the status task |
| the chat can't be reached (bot blocked, chat gone) | 😕 on the reply and one alert on the status task |
| the chat refused the message as it was made (a 400 that isn't about the chat) | Shipify's own bug: said at once in Telegram's words, 😕 on the reply |

## Files for runs

`GET /door/file/<ref>`: the plan step fetches each file you sent, by its `telegram:<id>`
reference, with the run's OIDC token (checked as above). The door gets it from Telegram with the
bot's token and hands back the bytes, 10 MB at most, keeping nothing. The bot's token never leaves
the edge. A file from the web chat (`web:<ref>`) comes from the chat's own store
([below](#the-web-chat)).

## The status page

`<the edge>/admin/status`: one page, read-only, for your phone or your PC. Top to bottom:

| Section | Shows | From |
|---|---|---|
| **The headline** | "All good", or the first thing that isn't ("1 thing needs you", "acme-site is failing") | all below |
| **Needs you** | each task waiting for you, linked | open tasks labelled `needs you` |
| **Apps** | each app's link, up / failing / taken down, its repo | the status task's record, as the watch last saw it |
| **Boxes** | each box online or not, its slots and how many are busy | shipify's runners |
| **Coming up** | each repeat's and recipe's next time, linked to its task | the record |
| **Recipes** | each recipe, its next time, its file and task | the record |
| **Recent** | the last 10 things the watch saw | the record |
| **Key dates** | each key and the days left (amber under 30, red under 8) | `SHIPIFY_KEY_DATES` |
| **Notebook** | each page, linked | issues labelled `notebook` |

Links at the top go to the chat, the tasks, the status task, Actions, recipes and the docs; the
bottom of the header says Shipify's version and commit, and when the last due run was.

- **Set it up once:** `pnpm ship door page --yes` ([setup.md](setup.md#the-edge)). `ship door check`
  then reports it.
- **Who sees it:** you, through Cloudflare Access (your `allow-me` policy) on `/admin` alone: one
  application, "shipify status", with the path `admin/*`. The edge checks Access's token too, so
  nothing shows without it ([security.md](security.md)).
- **What it costs:** about four GitHub reads, kept a minute in Cloudflare's cache. App health is the
  watch's last check; `/apps` in a chat checks live.
- **The web chat** sits beside it, at `/admin/chat/`, behind the same sign-in
  ([below](#the-web-chat)).

## The web chat

`<the edge>/admin/chat/`: a chat window of Shipify's own, part of the edge (ADR 0036).
What it does and how to set it up: [channels.md](channels.md#the-web-chat).

- **Who gets in:** the same Access application as the status page, and its token checked by the
  edge on every chat route (`accessTokenOk`), as for `/admin/status`. No token: 403. If the
  application's path doesn't cover `/admin`, the edge answers 403 itself, so it fails closed:
  change the path to `admin/*`.
- **The page:** `edge/public/admin/chat/` (plain HTML, CSS and JS, `// @ts-check`, no libraries, no
  build step, about 120 KB, just under its 41 KB budget compressed, its service worker apart),
  served as the Worker's static assets with `run_worker_first`, so every file is behind the same
  token check.
- **Diagrams:** a `mermaid` code block is drawn in `/draw/` (`edge/public/draw/`), a static page
  with no data, outside the sign-in, shown in a sandboxed frame (`allow-scripts`, no same-origin).
  It loads Mermaid 11.17.2 from jsDelivr, pinned with its SRI hash, and hands back the SVG, which
  the chat shows as a picture (an `<img>` runs no script). Mermaid never runs in the chat itself.
- **Its routes,** under `/admin/chat/api/`: `list`, `task/<n>`, `menu`, `repeats`, `notebook`,
  `files`, `setup` and `file/<ref>` to read; `POST` `file`, `send`, `repeat` and `push` to write. A
  `POST` must carry the edge's own `Origin` and `x-shipify-chat: 1`.
- **Notifications** (ADR 0050): `POST …/api/push` with `{"on": <the browser's subscription>}` keeps
  a device (5 at most, a sixth replacing the oldest), `{"off": "<its address>"}` drops one; back
  come the devices kept, each a short id, its push service and since when. A device is kept only
  on a known push service (Google's, Apple's, Mozilla's, Microsoft's), in one KV key,
  `push:web:<chat>`. The menu carries the public key the page subscribes with; Setup lists the
  devices. `edge/src/push.ts` sends each one: encrypted (RFC 8291) and signed (VAPID, RFC 8292)
  with `WEB_PUSH_KEY`, on WebCrypto alone. The page's service worker is `sw.js`, one of its files
  (the CSP allows `worker-src 'self'`); Android's share posts to `/admin/chat/share`, which it
  answers on the phone (a share that reaches the edge before it's installed opens New chat).
- **Reads** are GitHub's record, read-only, as the door App. A thread asks for
  `application/vnd.github.full+json` (GitHub renders the Markdown to `body_html`, which the edge
  cleans again); a listing (the list, repeats, a PR's state) asks for the plain JSON, which has no
  rendering. Each carries an ETag (an unchanged read is a 304, with no quota) and is kept 5
  seconds in the edge; a message is cleaned once, and again only when its comment's edit time or
  👀 count changes. Hidden lines never reach the page. The list is 50 open tasks and PRs,
  with shipify's open PRs as **For review**; `list?closed=1` the closed ones, and `&page=` an older
  50 of either. A task's model is its status comment's choice, or a `use` you said since. A thread is its newest 100
  comments; `task/<n>?page=` reads an earlier page, for **Earlier messages**. A PR reads as a
  thread too, to review (the issues API has its description and comments; the door App has no
  Pull requests or Contents permission, so the diff is on GitHub).
- **Writes** go through the door's own code (`doorIn`) as the `web` channel, called directly inside
  the Worker, with no webhook: the person check, the closed door, commands, `#12`, dedupe and albums
  are the door's. The web adapter (`edge/src/channels/web.ts`) proves those calls with an HMAC of
  the door App's key, which only the Worker has, so `POST /door/web` from outside gets 401.
- **Files** live in Workers KV, bound as `FILES` (the deploy creates it; `edge/wrangler.jsonc` has
  no id), for 7 days. A run fetches one through `GET /door/file/web:<ref>`. Only PNG, JPEG, GIF and
  WebP show inline; anything else, HTML and SVG too, downloads
  ([security.md](security.md#the-web-chat)). A file you sent on Telegram shows through
  `…/api/sent/telegram:<id>`: the edge asks Telegram for it, as for a run, and keeps nothing; a
  picture shows inline only when its `from` line says it's one; with the door closed, none.
- **The model picker and Status & setup** read `executors.json` and `tools.json`, built into the edge when it
  deploys (the door App can't read the repo's files).

## The kill switch

Set shipify's variable `SHIPIFY_DOOR` to `closed` (GitHub → shipify → Settings → Secrets and
variables → Actions → Variables). Within a minute the door writes nothing and sends nothing: a
message from a chat is answered "The door is closed" and isn't kept (send it again once it's
open); a run's reply and its files aren't copied out; the watch sends no notices. Delete the
variable to open it.

## The door App

The GitHub App the edge acts as: private, installed on shipify only.

| Permission | Why |
|---|---|
| Issues: read and write | your words onto tasks, closing (its state labels off) or reopening one on your `close` or `reopen`, with no run (ADR 0040), the 🚀, the watch's labels and findings |
| Actions: read | whether a task's run is queued or under way |
| Administration: read | the boxes' runners |
| Variables: read | `SHIPIFY_PEOPLE`, `SHIPIFY_OWNER`, `SHIPIFY_DOOR`, `SHIPIFY_KEY_DATES` |
| Metadata: read | GitHub requires it |

Nothing else: no Contents, Pull requests, Workflows, Secrets or Actions write.

### Setting it up

```sh
pnpm ship door setup        # the plan
pnpm ship door setup --yes  # does it
pnpm ship door check        # once ci's edge job is done
```

**First:** `CF_DEPLOY_TOKEN` in your credentials file: with it, setup finds your Cloudflare account
and its workers.dev name. With a domain, `APPS_DOMAIN` there too ([setup.md](setup.md#cloudflare)).
The workers.dev name is needed either way (the edge is always there too): with none, setup says to
open Workers once on Cloudflare's dashboard, which makes one.

**With `--yes`:**
1. **The App:** a page opens in this PC's browser and sends GitHub the App's manifest. Press
   **Create GitHub App**, then **install** it: Only select repositories → shipify (your copy, by
   whatever name you gave it).
2. **Variables: Read-only**, by hand, when the page says: the App's permissions, save, then accept
   the change on the install. A manifest can't ask for it. It waits up to 10 minutes.
3. **Its key** goes from GitHub straight to the edge's Worker, as PKCS#8 (`wrangler secret put`).
   It's never printed or saved.
4. **Its settings** on shipify ([settings.md](settings.md), "set by `ship door setup`"): the
   variables the edge is deployed with (the door App's ids, the edge's address, shipify's ids, your
   Cloudflare account, and `APPS_DOMAIN` with a domain), and the secret `CF_DEPLOY_TOKEN` from your
   credentials file, which the deploy runs with.
5. **A deploy:** it starts `ci.yml` on main, which deploys the edge with them.

Run again once it's set up, it says so and changes nothing, but for a deploy key shipify lacks. Next: `pnpm ship add telegram --yes`
([channels.md](channels.md)).

**`pnpm ship door check`** says each plainly:
- shipify's variables for the edge are set;
- `/health` answers `shipify-edge` with its version, and says whether its commit is main's;
- the door App reaches shipify alone, with exactly its permissions;
- each chat's route someone's on (`SHIPIFY_PEOPLE`) answers 401 without its proof
  (`/door/telegram` without Telegram's secret). A redirect means a sign-in sits in front: remove
  the Cloudflare Access application for that address. A chat no one's on isn't added yet: it says
  so, and fails nothing.

Each failing check names its fix.

`pnpm ship selftest door` runs the same. `pnpm ship selftest chat` sends a message through the door
and back.

### A new key

Yearly, or when GitHub refuses it (the bot and the watch say so in your chat):
1. The App's page → Private keys → **Generate a private key**. GitHub downloads it.
2. `pnpm ship door setup --new --yes`. It finds the newest `…shipify-door….private-key.pem` in your
   Downloads from the last day (on WSL, Windows' too), or takes `--key <file.pem>`. It checks the
   key is this App's, then puts it on the Worker.
3. Delete the old key on the App's page, and the downloaded file.

## Secrets, deploy and rollback

- **The Worker's secrets:** the door App's key (`ship door setup`, `--new` for a new one) and each
  channel's (`ship add <channel>`), set from the PC with `wrangler secret put` and your credentials
  file's deploy token. Never printed, never a GitHub secret, never on a box. Each by name:
  [settings.md](settings.md).
- **Plain values** come from shipify's variables, handed over by the deploy. Your time zone is read
  live too, with the other variables it reads (a minute at most): a change shows with no deploy.
- **The deploy:** `ci.yml`'s `edge` job, after its checks, when `edge/`, `cli/contracts/` or
  `intents.json` changed, or on a run by hand (`door setup` starts one). A change to
  `executors.json` or `tools.json` alone doesn't start it, so the web chat shows it after the next
  edge deploy (run the edge job by hand from Actions, or wait). It runs `wrangler deploy` (with
  `--domain shipify.<APPS_DOMAIN>` when you have a domain) with shipify's secret `CF_DEPLOY_TOKEN`,
  its variable `CLOUDFLARE_ACCOUNT_ID`, and your time zone. A deploy never sends or deletes the
  Worker's secrets.
- **Rollback:** if `/health` doesn't show the new commit within 2 minutes, the job runs `wrangler
  rollback`.
- **Its addresses:** workers.dev, and your domain when you have one; no previews. Nothing runs a
  PR's code.

## In the code

| Where | What |
|---|---|
| `edge/src/app.ts` | the routes and `/health` |
| `edge/src/door-in.ts`, `door-out.ts`, `files.ts` | in, out, files for runs |
| `edge/src/oidc.ts` | the run's token check |
| `edge/src/page.ts`, `access.ts` | the status page, and Access's token check |
| `edge/setup/page.ts` | `ship door page` |
| `edge/src/channels/` | the chat channels: the contract (`channel.ts`), the registry (`index.ts`), Telegram's adapter (`telegram.ts`), the web chat's (`web.ts`) |
| `edge/src/push.ts` | Web Push, for a chat read in place: a notification to one device, encrypted and signed (ADR 0050) |
| `edge/src/web/`, `edge/public/admin/chat/` | the web chat: its routes, reads, cleaning (`clean.ts`), files and forms; the page, and its service worker (`sw.js`) |
| `edge/public/draw/` | the chat's diagram frame (`/draw/`) |
| `edge/public/note/` | a notification's icon and badge (`/note/`) |
| `tools/web/setup.ts` | `ship add webchat`, its check and `remove` |
| `edge/src/chat.ts` | what a message means to Shipify, whatever its channel: commands, `#12`, titles, the door's own words |
| `cli/contracts/answers.ts` | `/help`, `/ping`, `/apps`, `/repos`, `/notebook`, `/recipes`, `/models`: the words every channel shares |
| `edge/src/settings.ts` | shipify's variables, runners and status task, as the edge reads them |
| `edge/setup/` | `ship door setup` and `check`, the Worker's secrets, `ship selftest chat` |
| `cli/kernel/door.ts` | a run telling the door, and fetching a file |
| `tests/edge/` | the tests; `channels.test.ts` is the conformance suite every adapter passes |
