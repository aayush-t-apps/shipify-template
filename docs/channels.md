# Channels

A channel is a way you and Shipify talk. **GitHub** is always one: it's the record, and merges
happen there. Two chats go through the edge's door ([door.md](door.md)): **Telegram**, and **the
web chat**, a page of Shipify's own ([below](#the-web-chat)). The edge is at
`shipify.<your workers.dev name>.workers.dev`, or `shipify.<APPS_DOMAIN>` with your domain.

| | GitHub | Telegram | Web chat |
|---|---|---|---|
| **You write** | issues and comments | messages to your bot | messages at `<the edge>/admin/chat/` |
| **You get** | everything | replies to what you sent there; and, as a default channel, alerts, repeats, recipes and the weekly digest. A task you carry on elsewhere is answered there | every task and its replies, read on the task. A notification on your devices when a reply to what you sent there comes (and, as a default channel, alerts, repeats, recipes and the weekly digest), with the page closed too |
| **Approvals** | your merge, your `yes` | a list's **Yes**, or `yes` | a list's **Yes**, or `yes` |
| **Set up** | `pnpm ship setup` | `pnpm ship add telegram --yes` | `pnpm ship add webchat --yes` |

**Every channel can do the same things** (ADR 0032, ADR 0042): the same words, the same commands
and the same answers, each defined once (`cli/contracts/`: `words.ts` for the fixed words, `use.ts`
for picking a model, `answers.ts` for the commands). **One flow, one rule:** every word, task and
release works the same from any of them. Only two things are GitHub's, where your GitHub sign-in
says it's you: a PR's merge, the approval for code and production, and the operations that change
the live app at once with no merge (taking an app down, bringing it back, rolling it back)
(ADR 0049). **Where you
type decides the task**, everywhere, with no mode to remember: a GitHub issue, the web chat's open
thread, or the Telegram message you reply to.

| You can | GitHub | Telegram | Web chat |
|---|---|---|---|
| Start a task | a new issue | a fresh message, or `/ask …` | New |
| Carry one on | comment on it | reply to any of its messages, or start with `#12` | its open thread |
| Go back to one | the issue list | `/tasks`, or `#12` alone | the list |
| Pick the model | `use …` | `/use` (buttons), or `use …` | the chip, or `use …` |
| Claude's effort | `use … high` | a row in `/use` | the chip |
| Answer a question | its words | its buttons, or the reply box | its buttons |
| `continue`, `stop repeating`, and the other fixed words | typed | buttons, or typed | buttons, or typed |
| Send a photo or a file | ✓ attach it | ✓ | ✓ |
| `/ping`, `/apps`, `/repos`, `/help`, `/notebook`, `/recipes`, `/models`, `/tasks` | as a comment: a run answers with no agent, in about 30 s | answered at once by the door | answered at once |
| Every reply | ✓ on the task | ✓ copied by the door, shortened, with its task's number linked | ✓ read on the task, whole |
| Approve a list (`yes`) | ✓ | ✓ its **Yes**, or typed (ADR 0049); a list too long to show whole: on GitHub | ✓ its **Yes**, or typed |
| A release (`spotter: release`) | ✓ the title, or the Operate form | ✓ typed | ✓ typed |
| Take an app down, bring it back, roll back production (they change the live app at once) | ✓ the title, or the Operate form | ✗ by design: a link to the form | ✗ (a link to the form) |
| Merge a PR (the one approval only GitHub gives) | ✓ | ✗ by design: a link to the PR | ✗ (a link to the PR) |

The answers' words live in `cli/contracts/answers.ts`, used by both the door and a run. On GitHub,
`/ping` and `/apps` say what the watch last saw (a box can't list runners); in a chat, `/apps`
checks each app live. `/repos` says the repos Shipify can work on, by account, as the status task
keeps them ([tasks.md](tasks.md#which-repos)): everywhere the same list, read from no repo live.

## Using Telegram

You don't need to know any word: type what you want, and tap the rest (ADR 0042).

**The first time,** the bot says what it does, with three buttons: **Model**, **My tasks**,
**Help**.

| You send | Shipify |
|---|---|
| a fresh message: plain words, `acme-site: …`, `new: …`, `repeat: …` | a new task, read as an issue's title is ([tasks.md](tasks.md#writing-a-task)), answered "Got it · **#12**" (the number links to the task) |
| a reply to any of its messages | a comment on that task. The next run reads it, even on a task you opened on GitHub |
| words starting `#12` | a comment on #12, once |
| `#12` alone | nothing written: #12's head ("#12 · make it faster · Answered · Sonnet") with the reply box open on it, so you just type |
| `/ask …`, `/new …`, `/change …`, `/repeat …` | always a new task, even sent as a reply: a command never carries one on |
| `remember: …`, `forget: …` | the notebook, at once, as on GitHub |
| a photo or a file, with a caption | on the task, for the agent. An album lands on one task |
| a reply that's a fixed word: `yes`, `no`, `continue`, `start over`, `preview`, `go`, `publish`, `stop`, `stop repeating`, `resume`, `close`, `reopen`, `use <model>`; or a lone `ok` to a question waiting on you | the same as on GitHub ([tasks.md](tasks.md#fixed-words)). **Yes** under a list sends yes and the list's code: it approves only that list |
| `/tasks` | your open tasks as buttons, grouped: **Working**, **Needs you**, **Repeating** (with each one's next time), **Answered**. A tap is `#12` alone. Up to 100 open issues are read; past that it says the rest are on GitHub |
| `/use` | your model, or that task's as a reply or after its number (`#12 /use`): the model picker ([below](#picking-a-model-your-model)) |
| `/ping`, `/apps`, `/repos`, `/notebook`, `/recipes`, `/models`, `/help` | answered at once, with no task |
| `spotter: release` | a release, as the Operate form runs it. It opens a PR: your merge on GitHub deploys it |
| `spotter: take it down`, `spotter: bring it back`, `spotter: roll back production` | nothing runs: they change the live app at once, so they start only on GitHub. The reply links the Operate form |

- **Answered at once, nothing written:** a command alone (`/ask`), a lone thanks, a voice note or
  video with no words, a photo with no caption and no task. The full list:
  [door.md](door.md#in-your-messages).
- **A quick question while you're building:** send it fresh, or with `/ask`, even from inside a
  reply. It becomes its own task; the build's task is untouched. A stray message can only ever
  start a new task, never land inside another.
- **Edits** aren't read: send a new message.

**What comes back:**
- **A head line:** "Done · **#12** · make it faster", the number a link to the task. Reply to it
  (or to any of the task's messages) to carry on. A new task's "Got it · **#12** · Opus" names the
  model it starts with.
- **The words,** up to about 3,500 characters, then "The rest is on GitHub".
- **A list for your `yes`** (ADR 0049) comes after the words, whole: only the words above it are
  shortened. A list over 3,000 characters shows its heading alone, which says to approve it on
  GitHub.
- **The run's one line:** "Sonnet · 48 s · 3 tool calls".
- **Buttons that send words** (ADR 0042): a question's short answers; the fixed words a reply asks
  for (Continue, Close…); **Another model** under a failure; **Stop repeating** under a reminder.
  Under a list, only **Yes** and **No**: none of the others, so a tap can't drop the list by
  mistake.
  A tap is the same as typing those words as a reply: the same checks, and a setting starts no run.
  The tapped message's buttons go once spent, so a tap can't be sent twice by mistake. A tap on a
  message Telegram no longer shows whole (so its task can't be read) is told, and nothing is
  written. Then link buttons: On GitHub, the PR, the preview or the app.
- **The reply box opens by itself** ("Reply to #12…") only when Shipify asks you something with no
  buttons to tap, when you go back to a task (`/tasks`, `#12`), and for a new task's pick. Never on
  an answer, a "Got it", a reminder or an alert.
- **Files the run made,** after the words: a picture as a photo, anything else as a file. One that
  didn't send is named.

Words are plain text plus Telegram's own formatting, never markup.

### Picking a model: your model

**You have a model, as in a chat app's model menu: your new tasks start with it, and a task keeps
its own unless you change it there** (ADR 0042, amended).

`/use` (or the **Model** button) shows it, then each agent in its own rows, its Auto first, then
the models `executors.json` lists, plain names, "free" on free ones, ✓ on the current one:

> Your model: **Auto** (Sonnet · Medium)
> **[Claude · Auto ✓]** **[Haiku]** **[Sonnet]** **[Opus]** **[Fable]**
> **[Pi · Auto]** **[glm-5.3-flash]** **[deepseek-v4.1-flash]** **[glm-5.3]** **[kimi-k2.7-code]** **[kimi-k2.6]**
> **[OpenCode · Auto]** and the same models, in its own row
> **[Pi · Vercel · Auto]** **[glm-5.3-flash]** **[deepseek-v4.1-flash]** **[glm-5.3]** **[kimi-k2.7-code]** **[kimi-k2.6]**, and **[OpenCode · Vercel · Auto]** the same
> Effort: **[Auto ✓]** **[Low]** **[Medium]** **[High]** **[Extra high]** **[Max]**

- **A tap keeps it:** the picker is drawn again with the ✓ moved, and a short note says "Your
  model: Opus". Nothing to answer, and no run starts. Every new task from then on starts with it,
  and its "Got it · **#241** · Opus" says which. A `use` line in your own words wins for that task.
- **One task only:** reply `/use` to any of its messages, or send `#12 /use`. The picker is that
  task's ("#12 uses Sonnet"), and a tap changes it from your next message there. The task shows the pick at once
  (`/use`, `#12`), before any run reads it, and picks build on each other: Sonnet, then High, is
  Sonnet at High.
- **Each agent's Auto** is its own: **Claude · Auto** (Sonnet at medium today) is the default, the
  way back from any pick, **Pi · Auto** is pi's and **OpenCode · Auto** OpenCode's. A model two
  agents list sends its agent with it (`use opencode glm-5.3`), so a tap picks it in its own row.
- **Effort** has a row for an agent that takes one and has no gateway (Claude Code). Each button
  names the whole pick (`use sonnet high`), so an old button means exactly what it says. pi's and
  OpenCode's models stay on their Auto effort here; typing `use pi z-ai/glm-5.3 high` still works.
- **Typing works too:** `use opus` (or `/use opus`) sent fresh is your model; as a reply, or as
  `#12 use opus`, that task's. With your words on the lines below it, the pick and the words go
  together: `#12 use glm-5.3-flash`, then your question, switches task 12 and asks. `/help` shows
  these as examples (intents.json's `help.examples`, each held to the grammar by a test). `/models <word>` searches a gateway's whole list, each model it finds a button that
  picks it (`use <its id>`: on the task's agent when it's one on that gateway, else pi). A pick that can't be used is told at once, with a **Model** button, and nothing is
  written.
- **Where it's kept:** one small record per chat in the edge's store (`model:<channel>:<chat>`,
  beside the web chat's files). If the store doesn't answer, the task starts on Auto and "Got it"
  says "your model couldn't be read, so Auto"; one it can't keep is said, and nothing changes.
- **The web chat** does the same through the same door: `use opus` sent with no task is your
  model there too, and its chip still picks for one message or thread.

**The bot's menu** has four: `/ask`, `/tasks`, `/use`, `/help` (`chatMenu`,
`cli/contracts/answers.ts`). Everything else works typed and is listed by `/help`. Its start screen
and `/help` show `intents.json`'s `help`. After a change to them is merged and the edge deployed,
the watch finds the menu differs and sets it again (checked once an edge instance, while the
webhook is fine). The deployed edge's `intents.json` wins.

**Approve a list with a tap.** A list's **Yes** approves exactly what it shows, and **No** drops
it. Merges stay on GitHub: a message that needs one links to the PR (the GitHub app works on your
phone). Turn on Telegram's password (Settings → Privacy and Security → Two-Step Verification):
your chat now approves calls through your tools ([security.md](security.md#approvals)).

## Setting it up

About ten minutes, on this PC. **First:**
- the door App, with the edge deployed (`pnpm ship door setup --yes`,
  [door.md](door.md#setting-it-up));
- a bot: in Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and a
  username ending in `bot`, and keep the token it gives you.

```sh
pnpm ship add telegram        # the plan
pnpm ship add telegram --yes  # does it, one checked step at a time
```

1. **The token:** paste it at the hidden prompt. It goes on the edge's Worker as `TELEGRAM_TOKEN`,
   and in your credentials file. Telegram checks it and names your bot.
2. **Telegram's secret:** a random one, made here, put on the Worker as `TELEGRAM_SECRET` and kept
   in your credentials file.
3. **The webhook:** the bot points at the edge's `/door/telegram`, new messages and button taps
   only, one at a time. It waits until the edge holds the new secret. If `/health` doesn't say
   `shipify-edge` yet, it stops and says so: run it again once the edge is deployed.
4. **The menu,** the four commands, and the bot's description, from `intents.json`.
5. **Its photo:** Shipify's sailboat (`docs/assets/logo.jpg`), set once; a bot that has a photo
   keeps it.
6. **You:** open the link it shows on your phone and press Start (or send the bot the `/start …`
   line it prints), then paste the id the bot sends back. The link works once, within an hour. Your
   id goes into `SHIPIFY_PEOPLE`, and `telegram` into `SHIPIFY_SEND`, your default channels.
7. **A test message** reaches your phone.

Each step checks itself first: stop any time, run it again, and it carries on.

- **Check it:** `pnpm ship selftest telegram` (the bot points at the edge, one update at a time,
  taps included, no error in 30 minutes), and `pnpm ship selftest chat` (a message through the door becomes a task, a
  run answers it, and the reply reaches your chat once).
- **A new token** (after @BotFather → `/revoke`): `pnpm ship add telegram --new --yes`. It asks
  for the token again and makes a new secret.
- **Undo it:** `pnpm ship remove telegram --yes`. The bot points nowhere, you're unlinked,
  `telegram` leaves `SHIPIFY_SEND`, and its keys go from the Worker and your credentials file.

**When something's off:** [troubleshooting.md](troubleshooting.md#telegram-and-the-door).

## The web chat

A chat window of Shipify's own at `<the edge>/admin/chat/`, made for your phone first
(ADR 0036). The edge's address alone opens it too. It sits behind the same Cloudflare
Access sign-in as the status page (`/admin/status`): no users, no accounts. Whoever gets past that
sign-in writes as you.

**One screen** (ADR 0039): on a PC, your tasks and the open thread side by side, and a doc you open
beside them (ADR 0065); on a phone one at a time, with **Tasks, Repeats, Notebook, Files and Setup**
as tabs at the foot (not in a thread). On a PC the same pages sit under the list.

**Projects as workspaces** (ADR 0065): a task's project is the repo its title names (`shipify: …`,
`links: …`, as **Change a repo** writes it); a task with none is **General**.
- **The list by project:** under Open and Needs you, tasks sit in a group per project, each with
  its name, what needs you (amber) and what's working (teal), folded open or shut with a tap (kept
  in your browser; open while you search). One group alone is a plain list. ▦ beside a group opens
  its page.
- **Tabs:** a project's tasks you open sit as tabs over the thread, as in an editor: each with its
  state's dot and title, **✕** to close it (the open one goes to its neighbour), and **+** for a new
  chat in the project (it writes `links: `). The first tab is the project's page. Your open tabs
  are kept per project in your browser (12 at most), nowhere else. On a phone they scroll sideways.
- **A project's page** (`#/p/<repo>`): **New chat here**; its open tasks, its numbers (open, needs
  you, working) and its app (up, failing or paused, from the watch's record); its docs: **In**
  (what you sent on its tasks) and **Out** (what its runs made), the last 7 days', as Files keeps
  them; and **Repo docs**, links to its spec, decisions (ADRs), changelog and README on GitHub
  (Shipify's own: its tour, design, decisions, plans, roadmap and changelog). Those open on
  GitHub: the door App can't read a repo's files.
- **The doc pane:** a file you open (from a thread, a project's page or Files) shows beside the
  thread on a PC, its width yours to drag (or the arrows on its edge), and the whole screen on a
  phone. Markdown is rendered (by GitHub, then cleaned, as a message is), a CSV is a table, other
  text is text, a picture is a picture (tap for full size), and a PDF shows in the browser's own
  viewer; a browser with none (Chrome on a phone) offers **open it**, which the phone's viewer
  takes. Only the first 200 KB shows; Download has all of it. **Ask about this** puts the file in
  your next message, here or in a new chat, as if you had attached it (a run's file too). ✕ or
  Back closes it; going to another task leaves it open.
- **Ctrl+K** (⌘K) finds a project, a task or a doc by its name: the arrows move, Enter opens.
  **Alt+1…9** picks a project's tab (1 is its page).
- It reads nothing new: the list, the menu and Files' read (the project's page). The page you open
  every day carries none of it: `workspace.js` loads the first time one is needed, as **Status &
  setup**'s `setup.js` does.
- **The list:** **Open** by default: the boxes (tap the line for Status & setup), then **For
  review** (shipify's open PRs, each with the task it's for), then what needs you, then what's
  running (its own row says "Working · 2m", "Queued", or "Waiting for a box" with none online; a
  run that stays after its answer says **Staying**, waiting for you, in its row and its thread,
  ADR 0057, and "Working" with a clock only while it answers: timed from that answer's start, never
  the stay's), then
  the 50 open tasks updated last. Open repeats and recipes (they stay open between runs) come last,
  under a **Repeats** heading that opens Repeats, unless one needs you or is running. A row shows
  its state as a dot (amber: needs you; teal and beating: working or starting; green: staying,
  ADR 0057; teal: **New**, its title bold, when a task you've opened changed since you last looked;
  red: stopped, its thread offers **Continue**; grey: open), its word on hover; then its title and
  age, its kind (Ask, New app, Shipify, a project's name, Repeat, Recipe; the title loses its
  `ask:` prefix) and its number. Its thread's header says the same state in words. It doesn't name
  the chat a task started in: a task goes on in any of them. **Open · Needs you · Closed** is one
  control with counts: Needs you shows only what waits on you; **Closed** shows the closed ones,
  newest first, to look back through (read when you open it, never polled); Open and Needs you read
  the list when you open them too. Your own Close, Reopen, Pause or Resume moves the task at once,
  in every view, and it stays moved till GitHub's lists show it (they can lag a minute; five
  minutes at most). Under it, **filters**
  with counts (a kind, Repeats, your GitHub labels) keep one of them; a project is its group. **Older tasks**
  reads 50 more. The list is put in again only when something in it changed (a run's clock ticking
  doesn't count), so a tap lands on the row it meant.
- **A thread per task:** replies shown whole, a run line with its details one tap away, the reply's
  buttons and question, files and pictures, photos you sent on Telegram too. Tap a picture to see
  it full size. Once your words are in, the header and the bottom say "Starting…" (or "Waiting for
  a box" with none online) until the run shows; a fixed word like `close` starts none, and the
  run GitHub lists for one isn't shown as working. A run under
  way shows as "Queued" or "Working · 1m" in the header and at the
  bottom from when it starts (the list sees it first; a phone asks the list too while your words
  wait for one). A run the list shows stops counting once a reply comes after it began (GitHub
  lists a run for its last steps, and words it took in still queue one that finds nothing new),
  unless you write again or your newest message has no 👀 yet (sent as the reply was written, so
  that run reads it); one that writes its status shows till it ends, timed from that status, in
  its row as in its header. Under each of your messages,
  as in any chat: the model you picked for it, its time, and a tick once a run read it (GitHub's
  👀 count, sent with each comment). The thin bar at the top
  moves only while you wait for something not on screen yet, never for the timed polls. While a
  run works, the reply box says "read before it answers": what you write then is taken in by that
  run before it replies, as on GitHub ([tasks.md](tasks.md#words-while-a-run-works)). With the box
  empty, its send button is a ■ that stops the run (it asks first; Enter never stops). Something new below where you're reading shows a small ↓ in the corner. A `mermaid` code
  block is drawn as a diagram (its source shows until then, and stays if it doesn't draw). A long
  thread draws its newest 40 messages; **Earlier messages** shows 40 more, then reads the 100 before
  from GitHub. What you were writing waits in its task (or the new chat) while you look at another,
  till you send it; it's kept in the page, not saved. A task written on GitHub with only a title
  starts with that title. Copy or Download a reply, or Download the thread. The header shows the task's state,
  number, kind, its runs added up from their replies' lines ("2 runs · $0.05 · 2m 32s · 38k
  tokens"; cost when the agent knew it) and its PRs; each reply's run line has its own (model,
  time, tools, cost), one tap from its details. There is no side pane: everything is in the thread. **Close** or **Reopen** sits in
  the header (not on a repeat): it sends `close` or `reopen`, the door closes or reopens the task as
  it writes the word, and the thread and list show it at once. In the thread it's a quiet line
  ("Closed · 2m"), not a message, wherever it was said. Neither starts a run (ADR 0040): the door
  does it, a close takes the task's state labels off, and the next run that reads the task notes
  it. **⋯**: On GitHub, Stop (`stop`,
  while a run works), Run again (`again`), Stop repeating or Resume. A button that sends a word
  says so while it does, and a failed send keeps a Retry.
- **A PR to review:** one of shipify's PRs (from For review, or a PR chip on its task) opens as a
  thread too: its description and comments, rendered, and the task it's for. It takes no words; **⋯
  The changes** and the merge are on GitHub, which shows the diff (the door App can't read files).
- **A question's answers are buttons:** when the run gave short answers to its question, each is a
  button that sends it as your words ("Yes, match it").
- **The box:** words; 📎 files and photos, or paste; one model chip ("Auto · Sonnet", "Pi ·
  glm-5.3-flash · High"), from `executors.json`, which sends a `use` line so you never type one.
  On a task it shows what its runs use (a `use` in its first message too) until you pick again;
  Auto is a choice too, and the chip names what it runs when that's a short name ("Auto ·
  Sonnet"; a gateway's Auto, "Pi · Auto", says it in the picker), so a task that never picked says
  so.
- **The model picker** (**Who thinks**, from the chip), in the order you decide:
  - **The agent:** tabs with a word each (default, its gateway), and, under a tab whose agent has more
    than one gateway, a row of them (OpenRouter, Vercel). A tab shows its models; a pick names its
    agent (`use pi z-ai/glm-5.3`, `use pi-vercel zai/glm-5.3`, `use claude opus`), so it holds from
    either. The default is the agent `SHIPIFY_AGENT` names.
  - **The model:** Auto first (with what it runs), then your listed models, each by its name, with
    its maker, context and what it can do (tools, reasoning, images), and its price per million
    tokens or "free". For an agent with a gateway, a search finds any other it has (`kimi`,
    `coder`), and filters keep only the **Free**, **Tools**, **Reasoning** or **Images** ones. The
    gateway's facts for your list are read when the picker first opens (kept a day at the edge;
    about seven small reads a day at most), a search's with it. Claude Code's models carry a line
    each (`about` in `executors.json`). What's ticked is what runs; a tap picks and closes.
  - **The effort:** one control at the foot (Default, then the efforts the model takes, as the
    gateway says), and **Done**.
  - On a phone it's a sheet from the foot; a long name shortens (…) on the chip. The arrows move
    through it, Enter picks, Escape closes.
- On a task, a pick goes with your next message (the chip is outlined until then): it never starts
  a run on its own. A `use` line in your own message wins over the chip, and a command (`/models
  kimi`) is answered at once whatever the chip says; the pick stays for your next message. `/` for
  the commands.
- **A new chat starts with starters,** and it's what a PC opens on when no task is picked: Ask
  anything, About a file (it opens the file picker and writes "Summarize this: "), Change a repo
  (pick it from your repos, as `/repos` lists them: it writes "acme-site: "), New app, Remember and
  Repeat. Each only fills the box: what you send is the same words
  as anywhere else.
- **Any question, not just code:** plain words are a question, so "what's in this PDF?", a photo
  to read, a document to sum up, or an idea to think through all work. The run gets the files, reads
  them (pictures and PDFs), and answers in the thread. Auto picks Sonnet · medium, which is light on
  your plan; the chip picks another.
- **The words a reply asks for are buttons,** the same ones Telegram shows, from one list
  (`replyButtons`, `cli/contracts/answers.ts`): the fixed words the newest reply names (`continue`,
  `close`, `reopen`, `again`, `resume`, `no`, `stop`, `stop repeating`), **Another model** under a
  failure (it opens the chip), and **Stop repeating** under a reminder. Under a list, only **Yes**
  and **No** (ADR 0049). `go`, `start over`, `preview` and `publish` are buttons too, as every
  word works from a chat. So a run
  stopped by your plan's limit is one tap to carry on once it resets. The door's own answers
  (`/use`, `/tasks`) stand here as text: the chip and the list do the same.
- **Repeats:** what runs (your repeats, then recipes), each with Run now, Pause, Change and Stop,
  then a folded **Paused** group with Resume (Pause closes the task; resuming opens it). **Stop**
  ends one for good: it leaves the page. A recipe whose task you closed shows paused at once, with
  **Remove**: a recipe is a file, so it starts the change that deletes it, which you send and
  merge. Times are in your zone and say it ("every Sunday at 14:00 IST"). Pause and Resume show at
  once; the page reads again after each.
- **New repeat:** What, then **When**, picked rather than typed: Daily, Weekdays, Weekly, Monthly,
  Every few hours, or Your words; then only what that needs (a day, a date, the hours, an optional
  window) and the time. It says back what will run ("Runs every Monday at 09:00 IST"), in the
  words the box reads.
- **Notebook:** your notes. Add sends `remember …`, Remove sends `forget …`; the page reads again
  after each (a note a run writes, with no notebook page yet, shows once it's written).
- **Files:** what was sent or made in the last 7 days, by project. A file opens here, never in a
  new tab: in the doc pane (above). A thread's files open the same way.
- **Back** has one rule: Tasks is under every page. A tab from Tasks is a step; from another page it
  takes that page's place. A thread, New chat and an open file each add one step, so Back closes
  them first.
- **Status & setup,** read-only, one page:
  - **Now,** on top: "All good", or what needs a look (the door closed, a box offline, an app
    failing, what a box's health flags, like a full disk), with a tile each for the box, the door,
    the chats and the next key to renew. Links out: the status page (`/admin/status`, which
    links back here), the tasks and the runs on GitHub, and each box's console (Cockpit, from
    `SHIPIFY_CONSOLES`, which `box add --manage` writes; it opens only on your own devices).
    **Check now** sends `/ping`.
  - **Agents and models:** a row each (the default first): its login (its gateway's key, "openrouter
    key, set 2026-10-06" from `SHIPIFY_GATEWAYS`, which `pnpm ship add openrouter --yes` writes,
    or "no key" with that command to copy; or its own login, with the days to renew it), its Auto
    and efforts, and its models.
  - **Cards,** side by side on a PC: keys and dates (each with a bar of the days left), tools (the
    chats are under Chats), the boxes (which task each busy slot is on, when its health was last
    read, its console), projects, chats and the door, each saying how to change it. **Check its health** starts a task, with Haiku, that looks at the box
    (disk, memory, temperature, load, updates waiting, the runner's service) and says what needs
    doing. A run can only look: what needs `sudo` is still Cockpit's or the box's own (`pnpm ship
    box health`).
  - **Started by the watch,** the last card: the 5 newest runs the box's watch started by itself,
    each with its task's title and why in words ("its repeat's time came", "its PR's checks
    finished"), when it last looked for due work, and when the next repeat is due.
  - It costs no more calls than before: the watch's view is the status task's record and the
    consoles are a variable, both read anyway.

**It has no write API of its own.** Everything it changes goes one of three ways:
1. **Words through the door,** as the `web` channel: the same words you'd type, as Telegram's are. A
   **New repeat** is words too: a task titled `repeat: <what>` with the Repeat form's own headings
   (`### What`, `When`, `Kind`, `Check`, `Model`), so the core sets it up with no agent, as it does
   for GitHub's form.
2. **A `shipify: …` chat** that ends in a PR you merge (the default model or agent, a tool, a
   recipe).
3. **Your PC or GitHub:** keys, boxes, `go`, merges. The page shows the command or the link.

**How it differs from Telegram:**
- **Replies are read in place,** on the task: their words are never pushed, so a closed page loses
  nothing. A notification tells you one came ([below](#notifications)).
- **It refreshes** every 5 seconds while the open thread has a run going, every 10 seconds while
  your words wait for a run to start, every 30 seconds otherwise, and never while the page is
  hidden; and at once when you come back to it. On a phone it asks only for what's on screen:
  the list, or the thread. The list reads tasks without GitHub's rendering of each, a lighter answer.
- **↻** in each header (left of **New chat**, and in a thread's or a page's) does what coming back
  does: what's on screen is read at once, and a newer version of the page loads if nothing is
  typed. It turns until the read ends, and what you've typed stays. Dragging down is the
  browser's own reload of the whole page.
- **Limits, said before you send:** up to 5 files a message, 10 MB each, kept 7 days; several land
  on one task as an album. Photos are shrunk to 2,048 px in your browser, which drops their
  location and camera details. A message holds 16,000 characters: past that the box says how many
  over and doesn't send (attach it as a file instead). A run takes a task's newest 5 chat files
  and names the older ones ([tasks.md](tasks.md)).
- **Never type a key into it:** your words land on a GitHub task. The page warns before sending
  anything that looks like a key.

**What it keeps, and what it costs:** no database, no server of its own, no accounts. It's the
edge's one Worker on Cloudflare's free plan, and GitHub is the record:
- **GitHub:** every task, message and reply, read through the door App (its 5,000 calls an hour).
  A read of the list is at most three calls (the tasks, the runs going, the boxes) and a thread's
  is two (the task, its newest 100 messages), three past 100 (its first page too, for the run's
  Working line). Each carries an `ETag`, so an unchanged answer is a
  304 that costs none of them. A Markdown file opened in the doc pane is one more, once a file
  (GitHub renders it; the Worker keeps that a day).
- **The Worker's memory:** each read for 5 seconds (the boxes for 30), so a burst asks once; and
  each message as the page shows it (its HTML cleaned), built once and again only when its
  comment is edited or a run reads it, so an open thread's refreshes stay well under the free
  plan's 10 ms of CPU. It's gone when the Worker restarts, and that loses nothing.
- **Workers KV (`FILES`):** the files you attach here and those a run sends back to this chat,
  each deleted by Cloudflare after 7 days; and the devices that get notifications, one small list
  of 5 at most. Photos sent on Telegram aren't copied: Telegram keeps
  them, and the edge fetches one when you look.
- **Your browser:** the list, the menu (models, projects) and the last 30 threads you opened, so
  the page opens at once, offline too; and each project's open tabs, the groups you folded and the
  doc pane's width.

**Coming back to it** (another app, the phone asleep, the tab again): away, it asks for nothing.
Back, it reads what's on screen at once (the list, the thread, or the page you're on, redrawn
only if it changed) and draws its times again. A newer page (the edge deployed) loads by itself
then, unless you've written something that a reload would lose: then it says "Updated: tap to
reload". When Access's session has ended, it says so instead of "Offline", and loads again
through the sign-in on the same terms.

**When GitHub isn't read for a moment:** the edge tries a read once more. If it still fails, the
list and a thread come from the last good copy the edge has. The page's timed polls stay quiet and
try again, slower each time (5 s, 10 s, 20 s, 40 s, then each minute). After about a minute, or on
that last good copy, a calm line says "Can't reach GitHub · retrying", and it goes away by itself
at the next good read. A read you waited for (a tap, ↻, opening a thread) still says what failed,
in red, and the next good read takes that away too. A message that didn't go (offline, or GitHub
not reached: nothing was saved) is sent again by itself, with its own id, so never twice: after
10 s, 20 s and 40 s, and when the browser is online again. **Retry** stays on it.

### Notifications

The web chat tells your phone or PC when a reply comes, with the page closed too (ADR 0050).
Telegram is then optional: the web chat can stand alone.

- **Turn them on:** `pnpm ship add webchat --yes` once (its **Turn on notifications** step), then on
  each device, in the chat: **Setup → Notifications on this device**, and allow it. Setup lists the
  devices that get them, this one marked. On an **iPhone or iPad**, add the chat to the Home Screen
  first (Safari's **Share → Add to Home Screen**, iOS 16.4 or later), and turn them on in the app
  you open from there.
- **What gets one:** whatever reaches the web chat, through the same way out as every chat's words:
  a reply to what you wrote there, a list for your **Yes**, and, once `web` is among your default
  channels (`SHIPIFY_SEND`), alerts, repeats' replies and recipes. The setup step puts `web` there
  when you have none; with Telegram there, they stay Telegram's. A task you carry on in Telegram
  notifies Telegram, so nothing comes twice. A repeat answers your default channels, not also the
  chat it began in; `again` typed in a chat is answered there, as anything you write is.
- **What one says:** the state and the task ("Needs you · #321"), and the task's title. Never the
  reply's words, a file's name or a list: a lock screen shows it. A tap opens that thread. A newer
  one for the same task replaces the older; a phone that's off gets only the newest when it's back,
  within a day. When you open the thread, its notification leaves the tray.
- **An open chat** reads at once when one comes, instead of at its next turn.
- **Safe:** each is encrypted end to end (Google, Apple, Mozilla and Microsoft carry it but can't
  read it), signed with the edge's own key (`WEB_PUSH_KEY`, made on your PC), and sent only to a
  device on one of their push services. A device that's gone is dropped by itself; one turned on
  meanwhile stays. Its icon and badge come from `/note/`, outside the sign-in, so a phone shows
  them after the chat's sign-in has ended too.
- **One that didn't come:** the edge's log has one line per reply (`door.out.sent`, or
  `door.out.failed`) with each device's push service and its answer ("Google 201", "Apple 403":
  a 403 refuses the edge's signature, and the device is kept), and anything the store refused.
- **What it costs:** nothing new. It rides on the call a run already makes to the door with each
  reply: one read of the store, and one request a device. The page's service worker (`sw.js`) lives
  on your device, caches nothing, and sleeps until a notification or a share.
- **Android's share menu:** with the chat installed from Chrome, **Shipify** is in Android's share
  menu. Share a photo, a PDF or a link: New chat opens with it attached, as 📎 does (5 files,
  10 MB each), and nothing is sent until you add words and tap **Send**. A file waits for the
  chat's menu to load; with the file store off, it says "Files aren't set up" instead. Not on an
  iPhone, or in Chrome on a PC.
- **A new key** (`pnpm ship add webchat --new --yes`): each device turns them on again by itself
  the next time it opens the chat.

### Setting up the web chat

About two minutes, after the status page (`pnpm ship door page --yes`,
[door.md](door.md#the-status-page)). The tool is `webchat` in `tools.json`; the channel's id is
`web`.

```sh
pnpm ship add webchat        # the plan
pnpm ship add webchat --yes  # does it, one checked step at a time
```

1. **page:** the status page is set up (`SHIPIFY_ACCESS`). If not, run `pnpm ship door page --yes`
   first.
2. **signin:** a stranger at `/admin/chat/` is sent to Access's sign-in. If the edge answers 403
   itself, Access doesn't cover `/admin` yet: change the "shipify status" application's path to
   `admin/*`, then run it again.
3. **you:** adds `"web": "me"` to your entry in `SHIPIFY_PEOPLE`.
4. **files:** reads the deployed Worker's bindings from Cloudflare, with your deploy token. `FILES`
   bound: files are on. Not bound: it says so, and words still work. The deploy creates the store;
   the token needs **Workers KV Storage: Edit** ([setup.md](setup.md#tokens-and-secrets)).
5. **notify:** makes the notifications' key on your PC and puts it on the Worker (`WEB_PUSH_KEY`),
   unless it's there already (`--new` makes a new one). With no default channels yet, `web` becomes
   yours (`SHIPIFY_SEND`), so alerts, repeats and recipes notify you here too.
6. **open:** prints the address and opens it. Send `/ping`. On an Android phone, open it in Chrome,
   sign in, then **⋮ → Install app** (on an iPhone, Safari's **Share → Add to Home Screen**): it
   opens from its own icon, full screen, like an app. It needs the network, as the page does, and
   asks you to sign in again when Access's session ends. Chrome reads the manifest with your
   sign-in (`crossorigin="use-credentials"` in `index.html`): without it, Access turns the manifest
   away and Chrome offers only a bookmark.

Each step checks itself first: run it again any time.

- **Check it:** `node_modules/.bin/tsx tools/web/setup.ts --check` (the status page, the sign-in
  over the chat, the file store, the notifications' key). `pnpm ship selftest webchat` only says
  there's no key of it to check: it runs a tool's check only when the tool has keys.
- **Undo it:** `pnpm ship remove webchat --yes`. Your `web` id leaves `SHIPIFY_PEOPLE`, so nothing
  more comes in from the chat; `web` leaves `SHIPIFY_SEND`, and the notifications' key leaves the
  edge. Its files expire by themselves after 7 days.
- **A change to `executors.json` or `tools.json`** shows in the chat after the edge's next deploy
  ([troubleshooting.md](troubleshooting.md#the-web-chat)).

## Adding another channel

A chat channel is one **adapter** in the edge: a file that answers four questions for its platform,
behind one interface, `edge/src/channels/channel.ts`. Nothing else in Shipify names the platform.

| The adapter's part | It answers | Telegram's |
|---|---|---|
| `verify` | is this webhook really from the platform? | its secret header |
| `parse` | what did the person say? One **Message**: who, which chat, the words, a reply's task (or a new task's pick, read from the replied message's head), a file; a button tap is a Message too, its words the button's | an update: a message, or a callback query |
| `answer` | answer at once on the webhook's response: the words, and what to show with them (`Shown`: the task's link, buttons, the reply box). Always a 200, so the platform never sends it again | a sendMessage in the response |
| `send` | send this **Outgoing** reply's words, rendered the platform's way, with its buttons and links: ok, wait, can't reach the chat, refused as made (Shipify's bug), or not confirmed. Never twice | sendMessage |
| `sendFiles` (optional) | the reply's files, after the words and the 🚀: how many didn't go | sendPhoto for a picture, sendDocument for the rest |
| `tapped` (optional) | a tap's acknowledgement: a short note, the tapped message drawn again, or its spent buttons taken off | answerCallbackQuery, editMessageText |
| `file` (optional) | fetch a file the person sent | getFile, then download |
| `health` (optional) | is the channel itself fine? | getWebhookInfo, taps included |
| `menu` (optional) | does it show Shipify's menu as `intents.json` says? Set only what differs | getMyCommands, then setMyCommands |

`limits` says how much one message carries, and how many bytes a button's words may be (Telegram:
64); a button whose words don't fit is left out, and its words stay in the text to type (a
question whose buttons all fall out opens the reply box instead). `replyBox: true` says it can open
a reply box on a message and read a reply to it (Telegram): a new task's pick asks for its words
there. A chat without one (the web chat) answers a pick with no task "Opus goes with your words",
since a pick there travels with them.

Everything Shipify-shaped stays in the door, written once for every channel: who you are
(`SHIPIFY_PEOPLE`), the commands, `#12`, the buttons a reply offers (`replyButtons`), the "thanks"
and "yes" nudges, writing onto tasks, dedupe, notices and alerts.

To add one:
1. **The adapter:** `edge/src/channels/<id>.ts`, importing only `channel.ts`, `../env.ts`,
   `../push.ts` and `cli/contracts/` (`tests/architecture.test.ts` checks it).
2. **One line** in `edge/src/channels/index.ts`. Its route is `POST /door/<id>`.
3. **Its fixtures:** `tests/edge/channels/<id>.ts` (webhooks as the platform sends them, and a
   stand-in for its API), listed in `tests/edge/channels/index.ts`. The conformance suite,
   `tests/edge/channels.test.ts`, runs the same checks on every adapter; it refuses one without
   fixtures.
4. **Its keys** as Worker secrets, named in its `needs`, never on a box.
5. **Its setup** in its `tools.json` entry (`in.door`, `setup`, `check`), so `pnpm ship add <id>`
   runs it, and your id on it goes in `SHIPIFY_PEOPLE`, under `on`.

**A channel read in place:** a chat whose replies are read on the task, as the web chat's are
(`inPlace: true`). Its `send` pushes no words: it may tell you a reply came (a notification),
never with its words. The door calls it beside the others and ignores its answer, so it never
counts toward the 🚀, a refusal or the watch's notice; its `sendFiles` keeps the run's files in
its store. The suite checks exactly that: the notification, read as the device reads it, holds
none of the reply's words. Web Push itself is `edge/src/push.ts`, which knows the standards and
nothing of Shipify, so a later chat read in place imports it as it imports `channel.ts`. The web
chat's adapter (`edge/src/channels/web.ts`) is also called from inside the edge rather than by a
webhook ([door.md](door.md#the-web-chat)).

Notes for later chats: **Slack** expects an answer within 3 seconds, so its adapter acknowledges
first. **Discord's** ordinary messages come over a long-lived connection a Worker can't hold, so it
would use slash commands. **Email** arrives through the Worker's separate `email()` handler.

### Out-only channels

A channel that only receives replies is an adapter with `send` alone (no `verify` or `parse`), for
example **Notion** (each reply appended to a page) or **Obsidian** (each reply a note in your
vault's git repo). A reply names its chats in `to:`, so one can go to Telegram and Notion at once
with no change to the core. None is built yet: each is one adapter when you want it.

More: [plug-ins.md](plug-ins.md#channels).
