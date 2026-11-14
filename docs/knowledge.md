# Your knowledge in Shipify: projects, the Library and the Journal

Shipify is one place for ideas, research and building (ADR 0069, ADR 0070): it keeps what you find
and think next to the work, with no other app. Everything is issues on your shipify repo (free,
readable on GitHub, yours) and files in the web chat's R2 bucket: no second store. Saving starts no
run, so it costs nothing; a run starts only when you ask.

## The loop

| Step | You | Where it lands | Cost |
|---|---|---|---|
| **Capture** | `jot: …` for a thought; `add <project>: …` (or **Add**) for a find: a link, words, a screenshot | a dated line in this month's Journal; an item in the project's Inbox | no run |
| **Keep** | "collate the inbox"; **Keep on page** under a good answer; "organize my journal" | the project's pages: each fact once, with its source; Now updated; a Log line | one run, when you ask |
| **Think** | a chat in the project: ask, research, decide; "check the project" before a decision; "split it" for a big job | the chat and its **Progress**; a list of what's wrong in the pages | a run per message; a long thread's prompt stays small |
| **Ship** | a change asked in a chat (`shop-web: add booking`) | a PR per change | a run |
| **Share** | **Export** (a zip), or "share this as a drop" | your device; a Drop link | none; one run for a drop |

Between them: a quiet chat folds into **Quiet**; a project and its chats stay open with their
files; a chat outside a project closes after 30 quiet days (write on it to open it), its files 30
days later. The weekly digest says, per project, what waits: finds to collate, chats waiting on
you, chats quiet a week.

## How to think of it: a desk

| On a real desk | In Shipify | You say |
|---|---|---|
| A pocket notebook | the Journal | `jot: …` |
| An in-tray | the project's Inbox | `add games: …` or **Add** |
| A binder, its cover sheet, its contents page | the project, its brief, its main page (Now, then the Map) | `project: games` |
| A meeting on one question, and its minutes | a chat, and its Progress | **New chat here** |
| Sorting the in-tray into the binder | collate | "collate the inbox" |
| A card index of sources | the Sources page | (a run keeps it) |
| A bookshelf | the Library | read only when needed |
| A workshop | repos and PRs | a change asked in a chat |

Chats are for thinking, pages for keeping, PRs for shipping. Rule of thumb: if you'll want it next
week, it goes on a project's page.

**When to do what:**
1. A thought: `jot:` it.
2. It keeps coming back: make a project, with a 3-line brief (the goal, done when, not doing).
3. A find: `add <project>: …`.
4. A question: a new chat in the project, one question per chat.
5. A good answer: **Keep on page**.
6. When the digest or the project's page says so: "collate the inbox".
7. Back after a break: read Now, then the Map, then the chats' Progress.
8. Before a decision: "check the project".
9. Finished: **Close** the project. Its open chats and its pages close with it; its pages stay
   in the Library, read-only. You close nothing by hand.

## A project

- **Make one:** `project: games` from any chat, or **New project** in the web chat. A line after
  the name, or lines below it, are its brief: the goal, done when, not doing. It needs no repo; one
  that builds code names them: `project: shop repos: shop-api, shop-web`.
- **Its chats** are its sub-issues: **New chat here** on its page, or **Move to project** on a chat
  you have. Each chat's run gets the project's brief, its chats by title and state, and its pages
  ([What a run gets](#what-a-run-gets)), and reads the chats that bear on the ask before it
  answers. A change in a project with one repo goes to that repo; with more, the chat's title
  names one (`shop-web: …`).
- **Its main page,** `Notebook: games`, has three blocks: **Now** (where it stands, what's next,
  open questions), the **Map** (what's where, each a link), then the facts, and at its foot the
  **Log**: a dated line for each run's page writes (`2026-11-03 · games-pricing · from #657`), the
  newest 20, kept by the box. Making a project makes its main page too, with your brief and an
  empty Now and Map. A closed project keeps its name: `project: games` with it makes nothing, and
  says to reopen it or pick another name.
- **Its other pages** hold the rest (`games-pricing`), and **Sources** (`games-sources`) lists
  each source once with a short key (`[who-2024]`) that its facts cite. Ask for "the matrix" and a
  run builds `games-matrix` from it: a row per source, a column per question.
- **Changing a page:** `remember games: …` adds a line to the main page; a run rewrites a page
  through its result (`pages`), and GitHub keeps every old version. The box never writes over a
  page that changed after the run read it (your edit, another chat's run): that write is left out,
  the reply says so, and asking again writes it from the new page.
- **Its Inbox** (`Notebook: games-inbox`) takes `add games: …` and the web chat's **Add**, with no
  run. "collate the inbox" folds the new items into the project's page.
- **Its screen in the web chat** (ADR 0071) has four tabs: **Overview** (the brief, Now, one next
  step and its buttons, then the project's own thread), **Chats** (by state), **Docs** (Overview,
  Sources, the Inbox with its count of new finds, then its topic docs by short name) and **Files**
  (every file of its chats and docs, newest first). The next step is worked out from counts with
  no run: a chat waiting on you, then 10 finds or more in the Inbox ("Collate the inbox"), a first
  question, a first answer kept, a check while questions are open, and Close when every chat is
  done. The chats waiting on you show under it, each a link. **Collate** and **Check the project**
  each start a chat in the project, so their questions wait in a chat like any other.
- **Its docs:** the standard three (the main page, which the window calls **Overview**; Sources;
  the Inbox), each made when first needed, and a **topic doc** (Research, Pricing) only when you
  ask for one, or when a topic outgrows the Overview. A run makes one new doc at most, named in its
  reply ("New doc: Research"). A doc opens in the pane, with **Edit** (plain Markdown): a save is
  refused when the doc changed after you opened it, and starts no run.
- **It stays.** A project and its chats never close by themselves. **Close** puts it away, and
  closes its open chats as done: but one a run is on, or a repeat or an errand keeps open, which
  its reply names. Its pages close with it. Writing on a chat opens it again. Their files go 30
  days after.

## Open or closed

A project is open or closed, and every screen shows which. Closed means put away: nothing new
goes into it, and its docs stay. Its pages follow it on GitHub too: open while it's open, closed
while it's closed, so no page of a closed project waits for you to close it.
- **Close** asks first, in the web chat: "Close games and its 2 open chats? Its docs close with it
  and stay in the Library, read-only. Its files go from 5 Dec, unless you reopen it before." Its
  reply says the same, every time, and names the chats it closed and the ones it left open. A run
  with no agent sees to it: it closes the open chats, then the project's pages (the issues
  labelled `project:games`), as completed.
- **Closed, it's read-only.** Its screen says when it closed, what stays and when its files go,
  and shows **Reopen** and **Export** only: no box, New chat here, Add, Collate or Check. Its docs
  are under **Closed projects** in the Library, and Find and Files mark it "closed". A doc of it
  opens in the pane with no **Edit**. A run in one of its chats still reads its pages, closed as
  they are, and `ship notebook read` finds one by its topic.
- **Words that would add to it** write nothing, and say how to go on: `add games: …` and
  `remember games: …` answer "games is closed · #n: Reopen it first. Nothing was written." A run
  in one of its chats is told the project is closed: it keeps no page, and Keep on page and
  "collate the inbox" say it's read-only.
- **Reopen** opens the project and its pages: its chats stay closed. Write on one (its Chats tab)
  to open it, or start a new chat in it. Writing on the closed project's own thread opens it, and
  its pages, the same way.
- **Its files** (its chats' and its docs') go at the weekly clean-up 30 days after it closed. A
  chat left open under it closes after 30 quiet days, as one outside a project does.
- **Nothing left open:** the weekly clean-up closes any page of a closed project that is still
  open: one closed with GitHub's own Close button (which starts no run), one GitHub refused to
  close, or one of a project closed before its pages followed it. A page a run or `add` writes
  opens again, so a project reopened on GitHub's own button never gets a second page.

## Keep on page, and check the project

- **Keep on page** sits under an answer in a project's chat, on every channel; "keep this on the
  page" says the same. Its run files the reply's key facts where the Map says, each linked back to
  the reply, puts their sources on Sources, updates Now, and says in a few lines what went where.
  A reply with nothing to keep writes no page.
- **"check the project"** reads every page and the chats' Progress, and lists contradictions,
  facts with no source, keys missing from Sources, stale facts (and a stale Now), findings that
  never reached a page, and pages too long to reach a run whole. It writes nothing: "fix them"
  applies the list in the next run.

## Finding what's known

Three layers, cheapest first:
1. **Structure:** Now, the Map and Sources. Each fact in one place means you rarely search.
2. **Words:** Ctrl+K finds a project, a chat or a doc by its name as you type.
3. **Meaning:** Ctrl+K's **Find by meaning**, picked when names aren't enough, asks GitHub's hybrid
   issue search for your chats, projects and pages, with no index of Shipify's own. It allows 10
   searches a minute: past that it searches by words, and says so. An Inbox item is a comment,
   which it doesn't search: **Search on GitHub**, under its results, finds one by its words.

## Growing a project

| Stage | You have | The next step its page shows |
|---|---|---|
| Seed | `jot` lines in the Journal | "organize my journal" proposes a project |
| Project | a brief, an empty Map | ask a first question in a chat, or Add a find |
| Research | chats and Inbox items | "collate the inbox" when 10 finds wait; **Keep on page** on good answers |
| Decide | facts and open questions in Now | "check the project", then write the decision on the main page |
| Build | repos named in the brief | a chat per change, a PR each |
| Done | — | **Close**: its chats and pages close with it; its pages stay in the Library, read-only, under Closed projects |

A project that never closes is an area (your health, your home): it works the same.

## A clean start

`clean start`, said on any chat, lists the open chats outside your projects that nothing keeps
open (no repeat, errand, open PR or part, none at work or waiting on you), with no run, and asks
your `yes`. Export first what you want to keep. On `yes`, the box reads them again and closes each
as done, as the 30-day close does; a chat with new words since the list stays open, and writing
on one opens it again. Their files go 30 days later, by the weekly clean-up (**Delete** in Files
takes one now). Your projects and their pages stay. Nothing is deleted before that.

## The Library: three reaches

| Reach | Who reads it | For | Labels |
|---|---|---|---|
| **Always** | every run | Preferences, People | `notebook` |
| **Project** | the runs in that project | its memory, Map, Sources, docs, Inbox | `library` and `project:<name>` |
| **On demand** | no run, until one asks (`ship notebook list`, `ship notebook read`) | the Journal, idea dumps, old research | `library` |

A page costs a run nothing until it's needed, so keep the Journal and research in the Library, and
only what every run must follow in the always pages. Editing a page starts no run.

## What a run gets

Each message you send starts one run. Its prompt holds these, in this order, and nothing more:

| Part | What | At most |
|---|---|---|
| **Your Personality** | how Shipify talks to you, first, in the prompt's opening lines; with none, the Default's words ([notebook.md](notebook.md#your-personality-adr-0078), ADR 0078) | 2,000 characters |
| **The ask** | the chat's title and words, and its thread: whole, or past 40 KB its newest 8 messages and every new one whole, each older one a line | about 10k tokens |
| **Progress** | where the chat's work stands, from its last run | 16,000 characters |
| **The project** | its brief and repos, and its chats by title and state: the newest 30 and every one at work, waiting on you or failed; the rest are counted | 4,000 characters of brief, about 3 KB of chats |
| **The pages** | Preferences, then the project's main page (Now and the Map first), its other pages, then People and the other always pages: each whole while the budget lasts, the rest by title and first line | 16 KB |
| **Files** | 5 of the chat's files in its `in/files`: the newest you sent, then the newest its runs made in the places left (ADR 0071); an older one by its notes | 5 files |
| **Notes from the box** | what's missing, if anything: a read that failed, or a page left out as someone else last edited it; and what a word asks ("collate the inbox", Keep on page, "check the project") | a line each |

A run reads the rest only when the ask needs it: a chat that bears on it, a page not shown whole,
an older message, your other projects' pages and the on-demand Library (`ship notebook list`,
then `ship notebook read`). So a run starts small, reads more on demand, and says what it couldn't
see.

**Memory across chats** (ADR 0078) works the same way, beside the Library: no list of your other
chats goes in a prompt. When an ask builds on an earlier talk ("like last time"), the run finds
it with `ship recall "<words>"` (Find by meaning, above) and reads it short with `ship recall
<n>`: its Progress, its newest 2 messages, the rest one line each. A topic you come back to over
many chats is a project; a fact for good is a note ([notebook.md](notebook.md#memory-across-chats-adr-0078)).

## Where each thing lives

One job for each store (ADR 0071), the same for you and for guests:

| Store | Its job | What it holds | Kept |
|---|---|---|---|
| GitHub issues | **the record** | every word: chats, projects, docs, Inbox finds | for good, each doc's versions in its history |
| R2 | **the working copy** | every file the window shows: what you and guests send, and what runs make; the guest list | while its chat or project is open, and 30 days after |
| `shipify-files` | **the backup** | every file your runs make, written as the run's reply is posted; never a guest's | for good |
| KV | **small settings** | model picks, devices | until changed |

**A file's life:** a file you send goes to R2 as it comes, and the run that answers gets it. A file
your run makes goes to R2 **and** the backup, in the step that posts the reply; a chip under the
reply opens it in the pane, and the next run in the chat gets 5 of the chat's files, a run's too
("make the PDF shorter" works on the last PDF): yours first, then runs' in the places left. A file is never edited: a run makes a new
version beside the old one. It leaves R2 30 days after its chat or project closes (or at once,
with **Delete**); a run's file then shows as **Archived**, linked to the backup. A file no chat
used (an upload never sent, an old draft's) leaves 60 days after it came. A guest's files live in
R2 only, and go the same way. A clean-up missed for weeks catches up the next time; two failed in
a row say so, and the weekly digest's **Files** line says what the last one deleted.

**Who does what:** you ask, read, edit docs and approve; the agent thinks, writes and leaves files
in `out/`; the box posts the reply, writes docs, puts each file in R2 and the backup, sets labels,
and cleans up each week; the edge shows the window and checks whose each thing is; GitHub keeps
the record. Nothing waits on you to file, label, back up or clean up.

## The Journal

`jot: <words>` adds a dated line to this month's page (`Journal 2026-11`), with any `#tag` kept.
"organize my journal" reads the month and proposes groups, a project to make, and lines to move:
nothing moves until you say `yes`.

## Rules the runs follow

`skills/knowledge`: read Now and the Map first; one place for each fact; cite each fact's source,
with a key on Sources; update in place, newest wins; keep Now and Progress current; leave the Log
to the box; propose, never move, your notes.

## Limits, said plainly

- An agent's collate, Keep on page or Progress can miss a point: each fact links its source, so
  you can check; "check the project" finds what's out of step.
- Search by meaning is GitHub's: 10 a minute, chats and pages but not their comments. When it's
  busy or gone, search is by words.
- A project holds 100 chats (GitHub's sub-issues); a page 60,000 characters.
- A big main page can take the 16 KB, and then the project's other pages show by title only: a
  run reads one when the ask needs it. Keep the main page to Now, the Map and the key facts; the
  Log keeps 20 lines.
