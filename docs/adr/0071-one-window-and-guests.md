---
status: accepted (merged #663, task #662, 2026-11-04, every question settled by the owner's words) and built in one PR after the owner's `go` of 2026-11-04; see [As built](#as-built-2026-11-04-six-parts-in-one-pr-on-task-662). Amended by 0073 (a guest's run may ask for a tool's guest forms, which the box makes at once for that guest, as their words still approve nothing; guests sign in with Google, not the One-time PIN)
date: 2026-11-04
amends: 0036 and 0039 (the web chat: every chat, doc and file opens in it; a second door, `/guest/`), 0069 (a reply's files open from R2; every run file gets an R2 copy; Files by project; docs read and edited in the web chat; the Library holds what is no project's), 0070 (a project's screen: Overview, Chats, Docs, Files; one new doc a run), 0031 (a fourth run profile, `guest`), 0049 (a guest's words approve nothing), 0057 (a guest's run stays too, and its stay hands the agent no token), and the design's rule 7 (`docs/design.md`: the guests you add start work on their own chats)
---

# 0071: One window: your projects, docs and files in the web chat, and guests in it

## The plan in short

**The problem, in your words:** "its very confusing … no way to look at and navigate well files
and data in project in webchat window where can user look to see all files", and "its pointless if
people have to change platform go to github". Today a project's docs are in the Library, its files
are in one long list, and a reply's files and every `#664` open GitHub, which needs a GitHub
sign-in. A guest can't open any of them.

**The fix: one window.** Everything you or a guest need opens inside the web chat, on a phone too.
GitHub stays the record behind it: you never need it to read, find or edit. You look in three
places only:

1. **The list:** what needs you and what's going on: your projects, then your chats, then your
   apps.
2. **A project's screen:** everything about one project, in four tabs: **Overview · Chats · Docs ·
   Files**.
3. **The pane:** a doc or a file opens beside the chat. A doc has **Edit**.

Every link to a chat, a project, a doc or a run's file opens in the window.

**Six principles,** the same for you and for guests:

1. **One window.** Everything opens in the web chat. GitHub is the record behind it.
2. **One home for each thing.** A file belongs to its chat. A chat and a doc belong to their
   project. So a project's screen shows all of it, and you never file anything by hand.
3. **One job for each store** (section 2). GitHub issues hold every word. R2 is the working copy of
   every file, while its work is open and 30 days after. `shipify-files` is the backup of what your
   runs make, written the moment a run makes it.
4. **Each part does what it does best** (section 7). The agent thinks and writes. The box stores,
   backs up, labels and cleans up, by fixed rules. The edge shows and checks. GitHub keeps the
   record.
5. **Nothing to manage.** Backup, clean-up, links and marks happen by themselves. Your part is to
   ask, read, edit and approve.
6. **Everyone sees only their own:** you, or one guest. The edge checks it on every read and
   write, from the record.

**Guests are an extension of yours** (sections 4 to 6). You set up Cloudflare once, from your
phone. Then you add or remove a guest in **Setup → Guests**. A guest signs in with a code that
Access emails them, and gets the same window with only their own chats, projects, docs and files.
Their runs use your agents, models and login, with no limits of their own. Four walls keep your
things yours: their runs hold no GitHub key, notebook or tool of yours; their runs get caches of
their own; their words approve nothing; their files stay in R2, never on `shipify-files`.

**What changes for you:**

| Today | With this |
|---|---|
| A reply's file opens GitHub | it opens in the chat's pane, from R2 |
| `#664` in a reply opens GitHub | it opens in the window |
| A project's docs are in the Library, its files in one list of all files | the project's screen: **Overview · Chats · Docs · Files** |
| A doc opens as a read-only thread; to change it, GitHub's Edit | it opens in the pane, with **Edit** |
| Find needs Ctrl+K, so a phone has none | a **Find** button, on a phone too |
| A run makes a new doc when it likes | one new doc a run at most, named in its reply |
| A run gets only the files you sent | it also gets the files the last runs in its chat made |
| Only you can use Shipify | **guests** you add in Setup, each in a space of their own |

**Cost:** no new service, store or key. The build is one PR in six parts, after your `go`.

## The owner's asks (task #662)

Your words, oldest first, and where each is answered.

- "can we have a mode in shipify … if i give an access to trusted person like a guest mode … they
  can run queries the models and all the features … not able to see other chats … they wont open
  any github issue … output pdfs and all for research … enter using cloudflare access … simple
  convinient strong" (sections 4 to 6)
- "i dont have access to my pc always … can i add one guest policy which gives access to app
  simply?" (Setup: all from your phone)
- "i can invite more guests … they have their own profile only their own chats, my as owner chats
  keep clean" (section 4)
- "keep proper limits … stress test the design no cognitive load" (sections 6 and 8)
- "add and remove guests simply from shipify admin … setup like a secure page … they can create or
  work on their project based chats" (section 5)
- "cloudflare setup access one time and then can invite guests … admin and guest roles only"
  (Setup; two roles)
- "we dont output generated files … in R2 but in shipify files they cant access … what is the best
  approach … i dont want to fill up R2" (section 2)
- "clean cheap strong input output flow … should we store in R2 or something … like github
  shipify files" (section 2)
- "it will rarely be used mostly by 2-3 users … strong simple solution"; "its only for shipify web
  chat" (section 6; guests use the web chat only)
- "check the project-health and healthcare in the list of issues its very confusing random docs …
  where can user look to see all files … no proper managed place … better design and processes for
  project management" (What was found; sections 1 and 3)
- "i also dont want them to read or access shipify-files … should we make output default R2 but
  we are wasting shipify-files free potential … not limit guests too much 20 runs per day" (sections
  2 and 6)
- "write a proper well written adr for design of new simple best efficient optimized system which
  can scale or work well" (this ADR; sections 7 and 8)
- "navigation is bad if we fix the core properly projects and such we can give well designed access
  to guests" (section 1 first, guests on top of it)
- "should all be issues all project research files … can it be shipify files … be a critique for
  the best design possible" (section 2, "Why this split")
- "personal use but occasional use by close family members … research work on project … one system
  know where to look" (sections 1 and 5: guests get projects)
- "its pointless if people have to change platform go to github … classify well what goes on
  github and what on R2 … seamless cheap efficient" (the plan in short; section 2)
- "no cognitive load single view and managed well" (the plan in short: three places)
- "guests use OpenRouter with a key of their own, this is not needed for now its a common
  subcription … box and such limits also doesnt matter no limit on 1 gb per guest … its extension
  of ours … is duplicating in R2 better what is better seapration … how do we efficiently optimize
  and utilize our resources" (sections 2 and 6; Options)
- "shipify-files is kind of like a backup … they work well in one webapp navigations files and
  edits … with their backup periodiclly to shipify files … then get deleted or write time … clear
  strong design principles … synergy between issues files tasks … keep the agents … guided let
  them do what they do best" (the six principles; section 2, "A file's life"; section 7)
- "clear strong strategy and edge case answers for each … no management is needed or cognitive
  load" (section 7, "Nothing to manage"; Edge cases, by area)
- "keeping consistent setup with extensions strong rules and everything as per designed processes"
  (section 7, "The rules there are")
- "one PR is fine but hoping we use issues and such well for chats usage it loads from issues or
  files shipify directly well and simple as needed" (The build; Settled; section 7, "What loads,
  and when")
- "can you confirm what more resources or something we will strain or can explode later KV,
  worker or something in apps besides this" (section 8, "The limits you share, your apps too")

## What was found (checked 2026-11-04, `main` at `07b515c`)

| What | Where | What it means |
|---|---|---|
| A project opens as its thread with a card folded shut: counts, Now, a next step, its chats, its pages. No Map, Log or files | `edge/public/admin/chat/project.js` (`card`, 31–77) | a project's files and docs aren't in the project |
| A doc opens as a read-only thread; its foot says "open it on GitHub" | `app.js:930`, `edge/src/web/reads.ts:136-138` | to change a doc you leave the window |
| Every link in a message opens in a new tab, `#664` too | `edge/src/web/clean.ts:98-108` | a doc a reply names opens GitHub |
| A run's files: the reply links `github.com/…/blob/shipify-files/…`; the edge keeps an R2 copy only when the web chat is in the reply's `to`, and shows it only in Files | `cli/commands/task/files.ts:407-434`, `edge/src/channels/web.ts:211-234`, `reads.ts:443-460` | the screenshot of #660: `health-research-guide.pdf` opens GitHub |
| The box backs up a run's files as it posts the reply: a files key minted after the agent commits them to `shipify-files`, each run's in a folder of its own (`task-<n>/<time>/`), 25 MB a file at most, text files with anything like a key masked first | `cli/kernel/apply.ts:159-181`, `cli/commands/task/files.ts:341-434` | the backup already happens when a file is made; a new version never overwrites an old one |
| Files has **Delete**: "It goes from every message that has it" | `workspace.js:81-107` | a file can go from R2 at once; its backup stays |
| Files is one list of every file, grouped by chat; the newest 500 | `workspace.js:212-231`, `edge/src/store.ts:110` | no files per project or per chat |
| The Library lists the project's pages again, under the project's name | `library.js:23-42` | one doc, two places |
| Ctrl+K is the only way to Find | `app.js:1441-1446` | a phone can't find |
| A run names a page freely; a new topic in a project becomes a new page; no limit but 5 writes a run | `cli/kernel/result.ts:49-56`, `cli/commands/task/notebook.ts:263-352` | "random docs" |
| A new page's link is GitHub's API address | `notebook.ts:48` (`pageUrl` takes the API's `url`) | the link in #660 that didn't open |
| health-project: the project #644, its pages #648 (10.8 KB), #649 (Inbox), #661 (8.5 KB), #664 (20 KB) | GitHub, read 2026-11-04 | 5 issues; ~40 KB of docs, past the 16 KB a run gets, so #664 reaches a run by its title |
| A run's caches are the slot's: `~/.cache` and `~/.local/share` link to folders every run on that slot shares | `cli/lib/sandbox.ts:657-680`, `docs/security.md` | what one run leaves there, a later run uses: a guest's run must not share them |
| The agent's login reaches it on a pipe it reads once, never in an environment or a file; its commands can't read its memory | `docs/security.md` ("Its login on a pipe"), proven by the sandbox check | a guest's run uses your login, and no command it runs can copy it |
| A stay mints a read-only token for every project, for the task's reads and for its agent. The record's token stays in the runner, as another user, out of the agent's reach | ADR 0057 §2, `docs/security.md` ("The record's token beside a running agent") | a guest's stay reads the task, and hands its agent no token |
| When your plan's limit is used up, a run stops and keeps its work; its reply says when the limit resets, and `continue` carries on | `docs/tasks.md` (`plan-used-up`) | the same for a guest's run |
| The design's rule 7: "Only you start work: your comments, and the door's on your behalf" | `docs/design.md` | a guest's words start their own runs, so the rule gains the guests you add (section 7) |

## 1. The window

The core first: the window for you. Guests then get the same window, smaller (section 5).

```
 The list                      A project's screen
┌──────────────────────────┐ ┌─────────────────────────────────────────────┐
│ [+ New chat]    [Find]   │ │ health-project                          ⋯   │
│ Open · Needs you · Closed│ │ Overview   Chats 4   Docs 4   Files 1       │
│ Projects                 │ ├─────────────────────────────────────────────┤
│   health-project   1     │ │ Now · Next · Open questions                 │
│   hacker-project         │ │ Next step: Collate the inbox (12 finds)     │
│ Chats                    │ │ [New chat here] [Add] [Check] [Export]      │
│   …                      │ │ ── the project's own thread ──              │
│ Apps (folded)            │ │                                             │
├──────────────────────────┤ │                                             │
│ Desk Files Library Setup │ │                                             │
└──────────────────────────┘ └─────────────────────────────────────────────┘
```

- **The list** keeps its tabs. Two changes: a **Find** button beside New chat (the Ctrl+K dialog,
  on any device), and its groups in one order: **Projects** (a row opens the project's screen),
  then **Chats** outside a project, then **Apps** (your repos), folded. The foot row stays.
- **A project's screen** (`#/t/<n>`, as today) replaces the folded card:

  | Tab | Shows | Reads |
  |---|---|---|
  | **Overview** | the brief, Now, the next step, its buttons (New chat here, Add, Collate, Check the project, Export), then the project's own thread | what the card reads today |
  | **Chats** | its chats by state: needs you, working, open, quiet, closed | the same read |
  | **Docs** | Overview, Sources, Inbox (with its count of new finds), then its topic docs: each by its short name, with its size and when it changed | its docs by label, as today |
  | **Files** | every file of its chats and docs, newest first: what you sent and what runs made, each with its chat | the Files list from R2 (cached a minute), kept to the project's chats |

- **A doc** opens in the pane (where files open), rendered, with **Edit** and, for you, **History**
  (GitHub's). Edit is plain Markdown. Save writes it through the door, under a from-line that names
  you (the notebook already counts that as yours, `notebook.ts:57-68`). Save is refused when the
  doc changed after you opened it: "It changed. Copy your words, then reload." An edit starts no
  run, as today. The Inbox shows its finds with their files. The Library's Always pages get the
  same Edit, so "open it on GitHub" goes.
- **A file** opens in the pane from R2: a picture, a PDF, Markdown, CSV or text in place, anything
  else as a download (as Files does today).
- **A chat's files:** a **Files** chip in its header lists them. A reply's files show as chips under
  it, as yours do today.
- **Links stay inside.** In a message, a doc or a Progress, a link to an issue on your shipify repo
  (a chat, a project, a doc) opens it in the window. A link to a file on `shipify-files` opens its
  R2 copy. Every other link opens a new tab, as today.
- **Files** (the foot row) groups by project, then by chat. Files with no chat are last.
- **The Library** keeps what is no project's: the Always pages, the Journal, loose pages. Each
  project is one line in it that opens the project's Docs tab. So a project's docs have one place.

**health-project with this:** its screen shows Overview (Now, "Next step: …"), Chats 4, Docs 4
(Overview, Sources, Research, Inbox) and Files 1 (`health-research-guide.pdf`). Each opens in the
window, on a phone too.

## 2. Where each thing lives: one job for each store

The split is by job, not by kind of file. Guests use the same stores, and their things carry their
mark (section 4).

| Store | Its job | What it holds | Kept |
|---|---|---|---|
| GitHub issues | **the record** | every word: chats (#660); docs (Overview, Sources, Research, the Journal: issues labelled `library`, and `project:<name>` in a project); Inbox finds and jots (comments on their doc) | for good, each doc's versions in its history |
| R2 | **the working copy** | every file the window shows: what you and guests send, and what runs make; the guest list (one object) | while its chat or project is open, and 30 days after; the guest list until changed |
| `shipify-files` | **the backup** | every file your runs make (`health-research-guide.pdf`), written when the run makes it; never a guest's | for good |
| KV | **small settings** | model picks, devices | until changed |
| Drop's bucket | **sharing outside** | a copy you share | until it expires |

### A file's life

| | A file you send | A file your run makes | A guest's file, sent or made |
|---|---|---|---|
| **Made** | the edge puts it in R2 as it comes | the agent leaves it in `out/`. After the agent, the box puts it in R2 **and** commits it to `shipify-files`, in the step that posts the reply | R2 only |
| **Used** | it opens in the pane; the run that answers gets it in its files folder | a chip under its reply; it opens in the pane | the same, in the guest's window |
| **Found** | in its chat's Files chip, and its project's Files tab | the same | the same, in the guest's window |
| **Changed** | you send a new one | a run makes a new version beside the old one; the backup keeps both, each in its run's folder | the same, in R2 only |
| **Kept** | while its chat or project is open, and 30 days after | the same in R2; the backup for good | while its chat or project is open, and 30 days after |
| **Gone** | the weekly clean-up deletes it, or your **Delete** at once | from R2 the same way; its chip then says **Archived** and, for you, links the backup | from R2; nothing stays |

The window doesn't edit files. Words you change are docs, with Edit and their history (section 3).
To change a file, ask a run: it makes a new version.

**Backed up when a file is made, not on a schedule.** You asked whether files should be backed up
to `shipify-files` from time to time and then deleted, or when they are written. When they are
written:
- **Safe from the first moment.** A file your run makes is never only in R2. So a delete in R2
  never loses one, and the clean-up checks nothing before it deletes.
- **It works this way already.** The box commits a run's files to `shipify-files` in the step that
  posts the reply, with a files key minted after the agent. A schedule would add a second job that
  reads R2 and writes git, with keys for both.
- **One step, two copies.** The same step hands the files to the door for R2 (below), so both
  copies come from one place at one time.

**What is backed up, and why only that:**
- **What your runs make: yes.** It is new, and it is nowhere else.
- **What you send: no.** You have the original, and the run that read it put what it needed into
  words. A picture in git stays in its history for good, and GitHub asks a repo to stay under 1–5
  GB. To keep one, ask a run to file it: it puts a copy in `out/`, so the box backs it up. Or keep
  the chat in a project, where files live while the project is open.
- **A guest's files: no.** They leave with the guest: once removed, their files go 30 days later,
  and nothing of theirs stays in your repo. The backup holds only yours. A guest keeps a file by
  downloading it.

**One change to the flow:** the edge keeps an R2 copy of every file a run makes, whatever chat the
task came from (today only when the web chat is in the reply's `to`). The box picks each copy's
ref and names it on the reply's hidden line, so the window shows the reply's files as chips. When
a copy has gone (30 days after its chat closed), its chip says **Archived**, and for you it links
the file on GitHub.

**Is the R2 copy a waste? No.** A file your run makes is in R2 and in the backup for a while:
- **It is the only way the window, and a guest, can open a run's file without GitHub.** To read
  `shipify-files` instead, the door App would need Contents access to your shipify repo. A leaked
  door key would then read your code, from the Worker that also serves guests. ADR 0036 left that
  access out for this reason.
- **It doesn't last:** it lives while its chat or project is open, and 30 days after.
  `shipify-files` keeps the copy for good, for free.
- **It happens already** for every task you start in the web chat (`edge/src/channels/web.ts`). The
  change makes it happen for every run, and makes the window open it.
- **It costs** a few MB a chat, inside R2's free 10 GB.

**Why this split** (the critique you asked for):

- **Should docs be files on `shipify-files`, not issues? No.**
  1. The window would have to read the branch, so the door App would need Contents access to your
     shipify repo, as above.
  2. GitHub's search by meaning reads issues only (ADR 0070). Docs in git lose it.
  3. The Inbox is comments. A file has none, so each find would be a commit.
  4. What you'd gain is a tidier issue list on GitHub. With one window, you don't read that list.
  A repo of its own for docs fixes only point 1, and adds a repo, a permission and a move of every
  page.
- **Should a run's files go to R2 only? No.** The backup keeps everything your runs make, for good
  and for free. So R2 holds only live work, and stays small. That is the branch's free space used
  well.
- **Should words go to R2 too? No:** no history, no search, and no record you can read without
  Shipify.

**So:** words on GitHub, every file in R2 while its work is open, and your runs' files also in the
backup from the moment they're made. A guest's file never reaches `shipify-files`, and a guest
can't read it.

**R2 doesn't fill up:** a file goes 30 days after its chat or project closes (the weekly clean-up,
ADR 0069), and a chat outside a project closes after 30 quiet days. A guest's files go the same
way.

**Using what you have well:**
- **Your plan is the real cost.** A run starts only when someone asks, or when a repeat you set is
  due. A run on a long chat reads its Progress and the newest 8 messages whole, and older ones only
  when it needs them (ADR 0069). Guests share your plan (section 6).
- **GitHub is free.** A screen needs one or two reads, and the edge caches them.
- **R2 holds only open work,** and the weekly clean-up deletes the rest. It is free to 10 GB, then
  $0.015 a GB a month.
- **`shipify-files` is free,** so it keeps the copies for good.
- **Nothing new:** no new service, store or key.

## 3. Docs: few, named, made on purpose

health-project's docs aren't random. The Overview, Sources and Inbox are each project's standard
docs, and #664 came when you asked for a doc. They look random because the window doesn't show
them in their project, and a run may make a new one whenever it likes. So:

- **A project's standard docs:** **Overview** (its main page: Now, the Map, key facts, the Log),
  **Sources** and **Inbox**. Each is made when first needed, as today.
- **A topic doc** (Research, Pricing) only when you ask for one, or when a topic outgrows the
  Overview. `skills/knowledge` says so.
- **One new doc a run at most.** The box writes no second one, and the reply says so. A reply names
  a new doc plainly ("New doc: Research"), linked in the window.
- **Short names in the window** ("Research", not "Notebook: health-project-research"). GitHub keeps
  the title, so nothing moves.
- **Progress in a project's chat** stays short and points to the Overview's Now. On #660, runs 2 to
  8 left run 1's Progress in place.

**Why the project and its Overview stay two issues:** the project's body is your words, which runs
follow as instructions. A doc is data that a run writes from what it read, the web included. One
issue for both would let a web page's words become your instructions (ADR 0069 §4). The window
shows them as one screen.

## 4. Whose it is: yours or one guest's

Everything is yours, or one guest's. A guest's things carry their mark. Yours carry none, so nothing
of yours changes.

| Thing | A guest's mark | Written by |
|---|---|---|
| A chat or a project | labels `guest` and `guest:<id>`; `"guest": "<id>"` in its opening from-line | the door |
| A doc of a guest's project | the same labels, and the guest in its hidden line | the door (Edit, Add), the box (from the guest's run) |
| A file | its R2 key starts with the guest's prefix (`g3f9a2c-…`); its `by` is the guest's id | the edge |
| A project's name | `g<6 hex>-<name>` on GitHub (label `project:g3f9a2c-health`); the window shows `health` | the door |

- **The id** comes from the email Access signed in: `guest-<the email's name part, 16 characters at
  most>-<6 hex of its SHA-256>`, for example `guest-ana-3f9a2c`. It is the same for an email every
  time, and different between emails.
- **The truth is the record:** the from-line the door wrote, and the R2 key's prefix. Labels are
  for the lists. The edge checks every route against the truth, never against what the page sends.
- **Your window,** Desk, Needs you, the digest and your runs' reads leave out everything marked
  `guest`. A guest's window shows only what carries their id.
- **A route with no "whose" rule fails the route test.** That one test keeps every new route behind
  the wall.

## 5. Guests: the same window, their own space

**Two roles:** you (admin) and guests. Guests use the web chat only: no Telegram, no GitHub.

**Add and remove (Setup → Guests, only you see it):**
- **Add:** an email and a name. Setup shows the link to send: `<your edge>/guest/`.
- **Remove:** one tap. The edge refuses that guest within 10 seconds. The door closes their open
  chats and projects, so their files go 30 days later. Their chats stay on GitHub. Added again, the
  same email gets the same id and finds their closed chats.
- Setup lists each guest with their chats, their files' size and when they were last in.

**What a guest sees:** the same window with their own Desk (a **Guest** tag, their chats and
projects, New project, Files), with no line about you on top (2026-11-04, the owner's ask). They get New chat, Find, their Projects (the four tabs), their Chats and
their Files. No Jot, Library, Apps, Repeats, Setup or status page: none shows, and the edge
refuses each. A guest's window leaves out each reply's run details (your box, your
plan's use, the run's link).

**What a guest can say:** anything a chat takes; `project: <name>`; `add <name>: …`; **Keep on
page**; "collate the inbox"; "check the project"; `use <model>` (any agent, model or effort of
yours). Refused with one line: `remember`, `forget`, `jot`, `/repos`, `/tasks`, `yes`, `go`,
`publish`, `preview`, `start over`. A repo's name in a guest's title is words only: no clone, no
PR.

**Their projects:** the same features as yours: an Overview, Sources, an Inbox, topic docs, Keep on
page, collate, check, Export. Each guest's projects are their own. A guest can't join your
projects (Not in it).

**The door:** `/guest/` hands the door the guest's id with the web channel's own proof, which only
this Worker can make. The door takes their words onto their own chats and projects, or a new one,
and writes the marks of section 4. `#12` that isn't theirs gets "not your chat", with no hint
whether #12 exists.

**The box: a fourth run profile, `guest`.** A task whose opening from-line names a guest runs in it,
whoever writes on it later. A guest's words are never yours (`authorOf` → `guest`), so a `yes` or
`go` in them counts for nothing.

| | talk (yours) | **guest** |
|---|---|---|
| GitHub key | read, every project | **none** |
| Your notebook, Library, other projects, tools | yes | **none** |
| Its project's docs | its project's | **only its own project's** |
| Its caches | the slot's, shared by its runs | **its own, in its run folder, gone with it** |
| Its answer | everything | **words, a question, choices, files, its own project's docs** |
| Its files | R2 and `shipify-files` | **R2 only** |

**The same as yours:** your agents, models and login (your pick, or the guest's `use`); the web,
commands and containers, in its own run folder; the run's clock; and the stay after an answer
(ADR 0057). A guest's stay reads the task with the record's token, which stays in the runner, and
hands its agent no token.

The prompt's guest section replaces the playbook's GitHub and project parts: who it helps, what it
can't do, that files go in `out/`, and that a doc is written only in its own project. The box
writes a guest run's docs only onto docs that carry that guest's mark.

## 6. No limits: guests are an extension of yours

Guests use what you use, with no cap of their own: runs a day, models, effort, how long a run
takes, the stay, projects, chats, files and the number of guests. A file they send can be up to 95
MB, and a file their run makes up to 25 MB, as yours.

**What to watch:** their runs use your plan's 5-hour and weekly limits, as yours do. The **Your
plan** line in your runs' details shows how much is used, theirs included. When a limit is used
up, runs stop until it resets, yours too. To stop a guest at once, remove them in Setup.

**The walls stay.** They aren't limits: they keep your things yours, and cost a guest nothing.
- Their runs hold no GitHub key, notebook or tool of yours. Your login reaches their agent on a
  pipe, as for your runs, so no command finds it.
- Their runs get caches of their own (section 8 found why).
- Their words approve nothing.
- Their files stay in R2, never on `shipify-files`.
- Each person sees only their own things (section 4).

**Dropped from the last drafts:** the guests' OpenRouter key and its credit limit, 30 minutes a
run, no stay, 1 GB of files a guest and 5 guests at most; before them, 20 runs a day, one guest run
at a time, 100 MB of files and 25 MB an upload. Each comes back only if a real need shows, as a
change to the guest profile or Setup alone.

## 7. How the parts work together

### Who does what

Each part does the one thing it does best, so nothing waits on you in between.

| Who | Does | Never |
|---|---|---|
| **You** | ask, read, edit docs, approve (`yes`, `go`, a merge), add and remove guests | file, label, link, back up or clean up by hand |
| **A guest** | asks, reads, and edits their own docs, in their own chats and projects | approves anything, or sees what isn't theirs |
| **The agent** | thinks: reads what its run gives it, says what more it needs, answers in words, leaves files in `out/`, writes a doc when it should (one new at most) | chooses where a thing is stored, or holds a write key |
| **The box** | after the agent: posts the reply, writes docs, puts each file in R2 and (yours) the backup, sets labels and marks; each week, closes quiet chats and deletes R2 files 30 days after their work closed | changes what the agent said, or deletes from the record or the backup |
| **The edge** | shows the window, checks whose each thing is, keeps what you send in R2, keeps links inside | reads your code or the backup |
| **GitHub** | keeps the record: every word, every version | |

### How chats, projects, docs and files fit

- **A chat** is an issue. Its home is its project, or none.
- **A project** is an issue that holds your brief for it. It is the home of its chats and docs.
- **A doc** is an issue, at home in a project, or in the Library when it is no project's.
- **A file** is at home in the chat it came from, so in that chat's project too.
- **A run** moves a chat on: it reads the chat and its project, and the box writes back its reply,
  docs and files, each to its home. So a project's screen is only a view of what has that home:
  nothing is copied, and nothing is filed by hand.

**What a run gets, and what it asks for.** It starts with enough, and asks for the rest, so it
reads little and misses nothing:

| A run starts with | It asks for the rest |
|---|---|
| its chat's Progress and the newest 8 messages | older messages, on demand (ADR 0069) |
| its project's docs, 16 KB of them whole | the others, by title |
| 5 of the chat's files, from R2: the newest you sent, then the newest runs made in the places left | an older one: its notes name it; one you sent, its reply asks for it (as today); a run's, it reads it from "Files earlier runs made" |
| `skills/knowledge`: when a doc is due, how to keep Progress short | |

**New:** a run's file now has an R2 ref on its reply's line, so the next run in the chat gets it as
it gets yours. "Make the PDF shorter" then works on the PDF the last run made, for a guest too.

### What loads, and when

Words load straight from their issues, and files from R2. Nothing loads before you open it. These
are the edge's reads today (`edge/src/web/reads.ts`), which the window keeps:

| You open | It reads | Kept |
|---|---|---|
| **The list** | 3 GitHub reads: the 50 newest open chats and PRs (no bodies), the runs, the runners | each read keeps its last answer: unchanged, GitHub answers 304, which costs none of the 5,000 reads an hour |
| **A chat or a doc** | 2 GitHub reads: the issue, and its first 100 comments. Past 100, its newest page too. While it's open, only what's new | the same |
| **A project's screen** | what its card reads today, and 1 R2 list of its files | the R2 list a minute |
| **A file** | R2, when you open it | a day, in your browser |
| **A run** (on the box) | its chat's Progress, the newest 8 messages, 16 KB of its project's docs, and 5 of the chat's files (yours first) | the rest, when it asks |

**Why the edge never reads `shipify-files`:** it would need Contents access to your shipify repo, on
the Worker that guests use (section 2). R2 is the fast copy, and `shipify-files` the backup behind
it. When a file's R2 copy has gone, its chip says **Archived**, and for you it opens on GitHub,
where you're signed in.

### Nothing to manage

| What | Who does it, and when |
|---|---|
| The backup of a run's files | the box, as it posts the reply |
| The working copy in R2 | the edge (what you send) and the box (what runs make), at once |
| Deleting old files from R2 | the box's weekly clean-up: 30 days after their chat or project closes |
| Closing a quiet chat | the same clean-up, after 30 quiet days outside a project |
| Links inside the window | the window, as it shows a message |
| Labels, marks and whose each thing is | the door and the box, as they write |
| Few docs | `skills/knowledge` guides the agent; the box writes one new doc a run at most |
| Guests in and out | you, one tap in Setup; Access was set up once |

### The rules there are

The window and guests are extensions of the parts Shipify has. They add no new kind of part, and
each of the eleven rules (`docs/design.md`) holds:

1. **One record: GitHub.** Every word is an issue. R2 is the working copy; the backup is git.
2. **Every message lives on a task,** a guest's too.
3. **Runs reconcile.** A guest's run is a run: read, decide, apply.
4. **The agent only thinks.** The box makes every write: replies, docs, files, the backup.
5. **The least each part needs.** The guest profile holds less than the read profile: no GitHub
   key, no tool. No new key.
6. **Approvals are yours.** A guest's words approve nothing.
7. **Only you start work** becomes **only you and the guests you add start work.** A guest's words
   start runs only on their own chats and projects, and only in the guest profile. This is the one
   rule this ADR changes.
8. **The core names nothing at the edges.** Guests come only through the web channel. A new
   channel, tool or agent needs nothing for guests: a guest's run gets no tool, and uses the
   agents you set up through their own plug-ins.
9. **Grow by the ladder.** A skill guides the agent first (`skills/knowledge`); the box's one new
   doc a run is the guardrail.
10. **Supervised.** The watch marks a guest's stopped run as it does yours.
11. **Trust is yours to give.** You add each guest; Access only signs them in.

## 8. Stress test

### At the sizes planned

You: 10 projects, each with 30 chats, 6 docs and 50 files. Guests: 3, each with 3 projects, 20
chats and 30 files.

| Case | What it costs | Holds? |
|---|---|---|
| A project's screen | the reads its card makes today (2 GitHub reads, ~1 s), and the Files list (1 R2 list, cached a minute) | yes |
| The Files list | 1,000 files a call, newest first. Today it stops at the newest 500 (`store.ts:110`), so a project's older files would be missing. The build lists on, 1,000 a call, until the project's are all found | yes, with the build's fix |
| R2 in all | yours: ~2 GB of live work at heavy use; guests: ~0.2 GB (90 files of a few MB); Drop: 9 GB at most. Free to 10 GB, then $0.015 a GB a month: ~11 GB is ~$0.02 a month, and each 10 GB more is $0.15 | yes: cents at worst, never a refused file |
| A guest's list | the list's own read, kept to their label (`issues?labels=guest:<id>`): an issue list, not a search, so search's 30 a minute never applies, and an unchanged answer is free | yes |
| Your list | guests' open chats share the repo's open issues, so your list reads 100 a page (GitHub's most, still one read) and leaves theirs out; **Older** reads the next page | yes |
| Find by meaning | 10 a minute for the door: you and guests together; past it, words (ADR 0070) | yes |
| 3 guests send at once | they take free slots, as your runs do. A run of yours waits only when every slot is busy, and a stay gives way to it (ADR 0057) | yes: rare, for 2 or 3 people who write rarely |
| A guest's long research | your plan's 5-hour and weekly use, as a run of yours; the **Your plan** line shows it | yes: your choice to share; Remove stops it |
| A project's docs | health-project: ~40 KB; a run gets 16 KB whole and the rest by title, as today | yes |
| The backup (`shipify-files`) | your runs' files: ~0.5 GB at these sizes (500 files of ~1 MB). GitHub asks a repo to stay under 1–5 GB and refuses a file over 100 MB; a run's file is 25 MB at most. Runs clone one branch only (`cli/lib/clones.ts`), and the box writes the backup through GitHub's API with no clone (`publishToBranch`), so its size never slows a run | yes, for years at this use |

### The limits you share, your apps too

Cloudflare's free limits are for your whole account: the edge and every app's Worker share them.
Read 2026-11-04 from Cloudflare's limits pages; the box from `df` and `free`.

| Limit | What uses it | Holds? |
|---|---|---|
| **Worker requests:** 100,000 a day | the edge: a chat tab on screen asks twice every 30 s, every 5 s while a run works; a hidden tab or a phone asleep asks nothing. You and 3 guests: ~5,000 to 10,000 a day. The watch: 288. An app: only `/health` and `/api/*` run its Worker (its files are free), and the watch's `/health` check is 288 a day an app | yes, ~10%. **The one that can blow:** an app whose `/api/*` gets real traffic or bots (below) |
| **CPU:** 10 ms a request | the edge mostly waits on reads, which isn't counted; the build adds only list filtering | yes |
| **Subrequests:** 50 a request | the watch stops at 45 already; a screen makes 1 to 5; the Files list, a few calls of 1,000 | yes |
| **KV:** 1,000 writes and 100,000 reads a day | the edge writes only when a model pick or a device changes, a guest's `use` too: a few a day. An app with the `kv` option shares the 1,000 | yes |
| **R2:** 10 GB; 1 million writes and lists, 10 million reads a month | a write a file; a list a minute at most, for an open project's Files; the guest list, read at most every 10 s | yes, under 5% of each |
| **GitHub, the door App:** 5,000 reads an hour | an unchanged answer (304) costs none; the watch, 540 an hour at most | yes |
| **GitHub search:** 30 a minute, 10 by meaning | Find only: no list uses search | yes |
| **Access:** 50 seats | you and 2 or 3 guests; a stranger who tries the guests' sign-in takes a seat until Access frees it (Setup, step 3) | yes |
| **The box:** its slots; 36 of 56 GB disk and 6.5 of 7.6 GB memory free | a guest's run downloads what it needs again into its own caches (a browser is ~150 MB), gone with the slot's next run | yes |
| **Your Claude plan:** 5-hour and weekly limits | every run, a guest's too | the real limit (section 6) |

**What could blow up later, and the fix:** past 100,000 requests a day, every Worker on the account
answers with an error until 00:00 UTC, the chat, Telegram and the watch included. Only an app with
public traffic on its `/api/*` can get there. If it ever happens, Workers Paid ($5 a month, 10
million requests) is one switch in Cloudflare's dashboard, with no change to Shipify. This design
adds nothing that needs it.

### When something fails

| What fails | What happens |
|---|---|
| R2 can't give the guest list | guests are refused ("Try again soon"); you are not touched |
| The guests' AUD (`SHIPIFY_ACCESS`'s `guests`) is wrong or missing | `/guest/` says "Guests are off"; your chat works as before |
| Your plan's limit is used up, by you or a guest | the run stops and keeps its work; its reply says when the limit resets, and `continue` carries on (as today) |
| A file's R2 copy has gone | **Archived** (yours, with its GitHub link), or **Gone** (a guest's) |
| R2 can't take a run's file | yours: the backup has it, and its chip says **Archived**; a guest's: the reply says the file wasn't kept, and asking again makes it again |
| A doc changed while you edit it | the save is refused, and your words stay in the box |
| Two runs write one doc | the later one is left out, and its reply says so (ADR 0070) |
| GitHub is down | the window can't read words; nothing is lost; R2's files still open |

### What a guest might try, and what stops it

| A guest tries | What stops it |
|---|---|
| to open `/admin/` | Access: their token is for the guests' application, and yours lets in only you |
| to open #12, yours or another guest's | the edge: 404 unless its from-line names them |
| to guess a file's ref | the edge: their refs start with their prefix; any other is 404 before a read |
| to send `yes` or `go` | a guest's words are never yours |
| to make their run read your notebook, chats, repos or tools | the run holds no GitHub key, notebook or tool |
| to copy your login out of their run | it reaches the agent on a pipe it reads once: no command finds it in an environment, a file or the agent's memory (`docs/security.md`, proven by the sandbox check) |
| to take the stay's token | it stays in the runner, which is another user; the agent's commands can't read the runner's environment or memory |
| to leave something in a slot's cache that your next run uses (a package, a browser, a container image) | a guest's run gets caches of its own, gone with it. **Found by this test:** today every run on a slot shares them |
| to read an earlier run's folder | a run's folder goes when the slot's next run starts; other slots' folders are closed to it (`docs/security.md`) |
| to put words where your runs read them | the box writes a guest run's docs only onto that guest's; your runs never read a doc marked `guest` |
| to name a project as yours is named | theirs are `g<hex>-<name>` on GitHub, and the door refuses that prefix for yours |
| to fill R2 | nothing caps it, by your choice: Setup shows each guest's files' size, files go 30 days after their chat closes, and 10 GB more costs $0.15 a month. Remove stops it |
| to use up your plan | nothing caps it, by your choice (section 6): the **Your plan** line shows it. Remove stops it |
| to read `shipify-files` | no key, and their links open R2 |
| to reach your home network | the box's walls, as for every run |

## Options

**The whole:**
- **A: One window over the stores there are (chosen).** (+ nothing new to run or pay; GitHub stays
  the record you can read without Shipify / − the window has more to show)
- **B: Docs as Markdown in git** (`shipify-files`, or a repo of their own). (+ a folder tree, a tidy
  issue list / − Contents access for the edge, no search by meaning, a commit per find, a move of
  every page)
- **C: Everything in R2, words too.** (− no history, search or record)
- **D: A database of Shipify's own (D1).** (− a second store to keep in step)

**The guest list:**
- **A: In Setup (one R2 object); Access lets anyone sign in with an emailed code, and the edge
  refuses who isn't listed (chosen).** (+ add and remove in your chat, as you asked / − a stranger
  can sign in to Access and see nothing, but takes a seat until Access frees it)
- **B: Only in Access's policy** (the second draft). (− you add and remove in Cloudflare's
  dashboard, not in Setup)
- **C: Setup changes Access through Cloudflare's API.** (− a key on the edge that could open
  `/admin` to anyone. Refused)

**Guests' models:**
- **A: Your agents, models and login, as your runs use them (chosen, by your words of 2026-11-04:
  "its a common subcription for now").** (+ nothing to set up; every model, and Claude Code's web
  search / − the risk is to your account: Claude's consumer terms, §2, effective 2025-10-08, read
  2026-11-04, say "You may not share your Account login information … with anyone else. You also
  may not make your Account available to anyone else." Guests' runs also count toward your plan's
  limits)
- **B: OpenRouter, on a key for guests with its own credit limit** (the last draft). (+ allowed for
  others' use; a money limit with no code / − a key and a limit to set up; no Claude Code web
  search). To take it later changes only the guest profile's login, and adds one secret.

**A guest's run on the box:**
- **A: Any free slot, with caches of its own (chosen).**
- **B: A slot with a Linux user only for guests.** (+ a stronger wall / − `box add` with sudo on
  the box, from your PC)
- **C: GitHub's own machines.** (+ off your box / − the job's token sits beside the agent, and a
  workflow you change by hand)

## Edge cases, by area

Each has one answer, and none needs you to manage anything.

**Files**
- **A run makes a file over 25 MB:** it isn't shared, and the reply says so (as today). Ask for a
  smaller one, or for it in parts.
- **A run makes a file with the same name again:** a new file beside the old one. The reply's chip
  shows the new one, the chat's Files shows both, newest first, and the backup keeps both.
- **You delete a file in the pane:** it goes from R2 and from every message at once. A run's file
  stays in the backup, and its chip says **Archived**.
- **A file you sent has gone, 30 days after its chat closed:** you have the original. To keep one
  longer, keep its chat in a project, or ask a run to file it.
- **You open a chat again after its files went:** your runs' files show as **Archived**, linked to
  the backup for you. To work on one again, send it again. A guest downloads a file to keep it.
- **A file with a key in it:** a text file has anything like a key masked before the backup, as
  today. The backup is for good, so never ask a run to put a secret in a file.
- **The backup grows:** ~0.5 GB at the planned sizes (section 8). If it nears GitHub's 1 GB advice,
  a later change starts a new branch for it.
- **An old reply's file link** (before this): it opens the R2 copy when there is one, else GitHub.

**Docs**
- **You and a run change one doc:** your save is refused when the doc changed after you opened it,
  and a run's write leaves a doc you changed after it read it (ADR 0070). Nothing of either is
  lost.
- **A run wants a second new doc:** the box writes none, and the reply says so. Its words stay in
  the reply.
- **A doc past 60,000 characters:** Edit refuses the save and says so, as a run's write does.

**Chats and projects**
- **A chat outside a project goes quiet:** it folds into Quiet, closes after 30 quiet days, and its
  files go 30 days later. Write on it to open it again.
- **A project** never closes by itself, so its chats' files stay while it's open. Close it when its
  work is done: its files go 30 days later, and the backup keeps your runs' files.
- **An old chat or project:** it has no `guest` mark, so it is yours, as today.

**Runs and agents**
- **An agent leaves a file outside `out/`:** it isn't shared, and the reply says so (as today).
- **A run needs an older message, doc or file:** it reads what its notes name, or its reply asks
  for it. The short start loses nothing.
- **A run stops early** (its clock, your plan, a crash): its work is kept, and `continue` carries it
  on (as today), for a guest too.

**Guests**
- **Guests not set up** (no `guests` in `SHIPIFY_ACCESS`): `/guest/` says "Guests are off". Nothing else changes.
- **A guest removed while signed in:** refused within 10 seconds. A run at work finishes; its reply
  stays on their chat. The door closes their chats, and a stay leaves when its task closes.
- **A guest's email changes:** a new email is a new id. Their old chats stay on GitHub.
- **Your own email on the guest list:** at `/guest/` you're a guest like any other. Your chat is at
  `/admin/chat`.
- **You write on a guest's chat on GitHub:** your words are instructions, and the run stays in the
  guest profile, so nothing of yours reaches it.
- **A guest's runs use up your plan:** runs stop until it resets, yours too. Remove the guest to
  stop them at once.

## Setup

**Once, in Cloudflare's dashboard (a phone works):**
1. Zero Trust → Access → Applications → Add → Self-hosted. Name: "shipify guests". Domain: your
   edge's host, path `guest/*`. Session: 24 hours.
2. Its policy "guests": Allow; Include → **Everyone**; login method **One-time PIN** only.
3. In Zero Trust's settings, turn on removing inactive users from seats. The build checks the
   exact place in today's dashboard.
4. Copy the application's AUD tag (its Overview) into shipify's `SHIPIFY_ACCESS` variable as
   `"guests"`, beside your own (GitHub → Settings → Secrets and variables → Actions →
   Variables; a phone works). It's on within a minute, with no deploy.

Your `/admin` application doesn't change: only your email gets in there. To keep strangers out of
Access too, also list each guest's email in step 2 instead of Everyone. Shipify works the same.

**Then, each time:** Setup → Guests → Add (an email and a name), and send them the link.

**Check:** sign in at `<your edge>/guest/` with a second email of yours. You see a Desk with the Guest
tag and an empty list, and `<your edge>/admin/chat` asks you to sign in again.

## The build: one PR, in six parts, after your `go`

Built as ADRs 0069 and 0070 were: each part committed in order, with its tests and docs.

1. **Links and files in the window:** a shipify issue link opens in the window; every run file gets
   an R2 copy, named on the reply's line, shown as chips; Archived; a file R2 didn't take named in
   the reply; the chat's newest 5 files, a run's too, reach the next run; `pageUrl` gives the
   issue's page.
2. **A project's screen and docs:** the four tabs; docs in the pane, with Edit and its check;
   Files by project, by chat, and the list past 500; the Library's project lines; the Find button;
   one new doc a run; `skills/knowledge` (topic docs, Progress in a project).
3. **Whose it is:** the `guest` marks; every route's "whose" rule and the route test; your reads
   leave guests out (your list 100 a page); a guest's list read by their label, never a search.
4. **The guests' door:** `/guest/` and its AUD; Setup → Guests (the list in R2, add, remove,
   counts); the window in guest mode, with no run details; guests' projects and their names.
5. **Guests' runs:** the `guest` profile (no GitHub key, notebook or tool of yours, caches of its
   own, its answers, its own docs; its stay hands the agent no token); `authorOf` → `guest`.
6. **Docs pass,** and one end-to-end test: you and two guests, where no one sees another's chats,
   docs or files.

## Docs and clean-up

- `docs/channels.md`: the web chat's window (a project's screen, docs, files, links, Find); a new
  "Guests" section (set up, add, remove, what they see).
- `docs/knowledge.md`: a project's screen; standard and topic docs; one new doc a run; where each
  thing lives and a file's life (section 2's tables); who does what (section 7).
- `docs/design.md`: rule 7 gains the guests you add.
- `docs/security.md`: the guest profile in the keys table and the sandbox; a guest run's own
  caches; a guest's stay; the walls.
- `docs/tasks.md`: the fourth profile and its answers. `docs/door.md`: the door takes a guest's
  words on the edge's proof.
- `docs/glossary.md`: **guest**, **the window**. `AGENTS.md`: a row for guests.
- `skills/knowledge` (and its scenarios), `playbooks/task.md` (one line: a guest's run follows its
  prompt's guest section).
- Header comments that say "no users" or "Access guards /admin alone": `edge/src/app.ts`,
  `edge/src/web/routes.ts`, `edge/src/access.ts`.
- The "amended by" lines of the ADRs this amends; this index's line; `CHANGELOG.md`.
- Removed: the folded project card, the Library's copies of project pages, and "open it on GitHub"
  on docs. Nothing old is kept beside the new.

## Consequences

- **Easier:** three places to look, on any device; a project you can see whole; nothing that needs
  a GitHub sign-in; family can research in projects of their own, with nothing of yours in reach.
- **Harder:** every new route needs a "whose" rule (the test fails without one). The window has more
  to show, so the page's parts grow; they load only when opened, as today.
- **Cost:** $0 more at the planned sizes. Guests' runs use your plan's limits, as yours do.

## Confirmation

- `tests/edge/web/routes.test.ts`: every `api/*` route, as a guest, against another's chat, doc or
  file, answers 403 or 404; a route with no "whose" rule fails; a guest's token at `/admin/` and
  yours at `/guest/` are refused; with no AUD, `/guest/` is off; a removed guest is refused; a
  guest's list is one read by their label, and yours leaves guests out.
- `tests/edge/door-in.test.ts`: a guest's marks on a new chat and project; their words refused on
  another's task; the words only you say refused.
- `tests/kernel-decide.test.ts`: a guest's task runs in the guest profile, on your agent with no
  GitHub key; its `yes` approves nothing; its refused answers are named; its prompt holds nothing
  of yours; its docs are written only on its own; its files never reach `shipify-files`.
- `tests/kernel-flow.test.ts`: a run's file reaches the next run in its chat.
- `tests/kernel-stay.test.ts`: a guest's run stays, and its turn hands the agent no token.
- The sandbox's test: a guest run's `~/.cache` and `~/.local/share` are in its run folder.
- The web chat's tests: a shipify issue link opens in the window; a reply's files are chips; a doc
  saves, and a changed one doesn't; a guest's window shows no run details.
- One end-to-end run on the box: you and two guests (section 8's tables).

## Settled by your words of 2026-11-04

No question is left open. Your merge accepts these:

1. **The build:** one PR in six parts ("one PR is fine"), so the switch happens in one go (The
   build).
2. **Guests' models:** your agents, models and login (Options).
3. **No limits of their own** for guests (section 6).
4. **Guests' chats** show only on GitHub, not in your window (section 4).

## Not in it

- **A guest in your projects:** your projects' docs reach your runs, which hold your keys, so a
  guest's words there would reach them. A guest has projects of their own. To share what you found,
  **Export** a project and share it as a drop.
- A guest's Journal, Library or repeats; guests on Telegram; a guest's repos or PRs.
- A rich editor for docs: Edit is plain Markdown.
- Docs moved into git, a search store, or a database (section 2).
- A limit on guests (runs, time, files, how many) or a guest key: only if a real need shows
  (section 6).
- A backup on a schedule, a backup of what you send, or pruning the backup (section 2, "A file's
  life").
- Editing a file in the window: words you change are docs; a run makes a file's new version.

## As built (2026-11-04, six parts in one PR on task #662)

Built as decided, with these changes found in the code:

- **The marks are one contract** (`cli/contracts/guests.ts`), so the box and the edge read them the
  same way: a guest's id from their email, their prefix (`g<6 hex>`), their labels, the store's
  file refs (`WEB_FILE_REF`, yours `f-…`, a guest's `g3f9a2c-…`), and a project's shown name.
  `From.guest` names a guest on the door's lines; `ReplyLine.files` names a run's files by their
  R2 refs.
- **Whose each route is** is one table, `WHOSE` in `edge/src/web/routes.ts`, checked before any
  route runs: a route with no rule answers 404 to everyone, so a new route works for no one until
  it says whose it is, and a route of yours answers a guest 404 before anything is read.
- **The truth for a doc the box wrote** is its author (the box's) and the guest's label, as the
  door didn't write its first line; for everything the door writes, its from-line.
- **A plain "yes" from a guest is words**, not refused: a guest's run may ask them a question with
  Yes and No buttons. It approves nothing, as the box never reads a guest's words as yours. The
  door refuses `yes <code>` (a list's approval) with the other words only you say.
- **A guest's upload names no chat:** the page can't give it one; the door's write gives it the
  guest's chat's number, as for a new chat's files.
- **Your Edit on a guest's doc is refused** ("a guest's doc"): a save puts your from-line on it,
  which would move it to your side of the wall. You read it in their chat on GitHub.
- **A guest's page keeps its copy apart** in the browser (`shipify-g`, `shipify-gt<n>`), so your
  own browser at `/guest/` (the setup's check) never shows your chats from its copy.
- **Your list, the status page's Needs you, `/tasks`, Find, the Library and the digest** each leave
  out what carries the `guest` label.
- **A guest's notification** opens their own door, `/guest/#/t/<n>`.
- **A file's `by`** stays `you` or `run`: whose it is is its ref's prefix.
- **A run's files in R2:** the door keeps each under the ref the reply's line names, paired by
  name, once, whatever chat is in `to` (the web channel's own copy went). A guest's file R2 didn't
  take is said in their chat (`files-unkept`); yours has its backup, so its chip says Archived.
- **A guest's run has its own playbook,** `playbooks/guest.md`, in place of the task playbook, not
  a section of it: its prompt then names no Shipify CLI, clone command, notebook, tool or earlier
  file of yours, and lists only the answer fields it may use.
- **Its own caches include its containers' store:** `XDG_DATA_HOME` names its run folder too, so
  an image a guest's run pulls or builds never reaches a run of yours. Tried on this box: rootless
  Podman works with a store of the run's own beside the slot's.
- **The agent's read key** is still minted for a guest's run (task.yml mints one for every think),
  for Shipify's repo alone, and the box never hands it to the agent (`holdFor`).
- **A door page is yours** only when its line names no guest; a guest's run trusts only its own
  guest's. So a guest who gives your name gets nothing of yours, and a new doc a guest's run makes
  gets their labels.
- **The guests' AUD is set on GitHub, with yours** (the owner's words, 2026-11-04, after the
  build: "aud setup for one time can be stored and managed on github"). It is `SHIPIFY_ACCESS`'s
  `guests` key, read as the edge reads yours (at most a minute old, no deploy), and must differ
  from your `aud`. Setup → Guests only adds and removes guests; the R2 object holds the list
  alone, and an `aud` an older object kept opens nothing. So no page can change which Access
  application a guest's token must be for. `ship door page` keeps the key when it saves yours.
- **Not run here:** the end-to-end check with two real guests needs Cloudflare Access; it is the
  setup's own check ([Setup](#setup)), and the route tests cover you and two guests in the fake
  world.
