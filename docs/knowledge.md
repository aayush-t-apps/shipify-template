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
9. Finished: **Close** the project. Its pages stay.

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
  empty Now and Map (a page a closed project of that name left is kept, not made twice).
- **Its other pages** hold the rest (`games-pricing`), and **Sources** (`games-sources`) lists
  each source once with a short key (`[who-2024]`) that its facts cite. Ask for "the matrix" and a
  run builds `games-matrix` from it: a row per source, a column per question.
- **Changing a page:** `remember games: …` adds a line to the main page; a run rewrites a page
  through its result (`pages`), and GitHub keeps every old version. The box never writes over a
  page that changed after the run read it (your edit, another chat's run): that write is left out,
  the reply says so, and asking again writes it from the new page.
- **Its Inbox** (`Notebook: games-inbox`) takes `add games: …` and the web chat's **Add**, with no
  run. "collate the inbox" folds the new items into the project's page.
- **Its page in the web chat** shows Now, then one next step worked out from counts with no run: a
  chat waiting on you, then 10 finds or more in the Inbox ("Collate the inbox"), a first question,
  a first answer kept, a check while questions are open, and Close when every chat is done.
- **It stays.** A project and its chats never close by themselves. **Close** puts it away; its
  files go 30 days after.

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
| Done | — | **Close**: its pages stay in the Library |

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
| **The ask** | the chat's title and words, and its thread: whole, or past 40 KB its newest 8 messages and every new one whole, each older one a line | about 10k tokens |
| **Progress** | where the chat's work stands, from its last run | 16,000 characters |
| **The project** | its brief and repos, and its chats by title and state: the newest 30 and every one at work, waiting on you or failed; the rest are counted | 4,000 characters of brief, about 3 KB of chats |
| **The pages** | Preferences, then the project's main page (Now and the Map first), its other pages, then People and the other always pages: each whole while the budget lasts, the rest by title and first line | 16 KB |
| **Notes from the box** | what's missing, if anything: a read that failed, or a page left out as someone else last edited it; and what a word asks ("collate the inbox", Keep on page, "check the project") | a line each |

A run reads the rest only when the ask needs it: a chat that bears on it, a page not shown whole,
an older message, your other projects' pages and the on-demand Library (`ship notebook list`,
then `ship notebook read`). So a run starts small, reads more on demand, and says what it couldn't
see.

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
