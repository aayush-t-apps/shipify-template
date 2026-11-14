# The notebook

The notebook is what Shipify remembers about you: your preferences, the people you mention, how you
like answers. It lives on GitHub: issues on shipify labelled `notebook`, **one page per topic**
("Notebook: Preferences", "Notebook: People"). Read and edit any page in the GitHub app at any time;
GitHub keeps every edit's history.

## Adding, removing and seeing notes

The same from GitHub or any chat (ADR 0032), each with no agent:

| You say | It does |
|---|---|
| `remember: short answers, in bullets` | adds the line to **Preferences**, dated: `- short answers, in bullets (2026-10-05)`. The reply says "Noted under Preferences: … Every task from now on follows it" with the page's link |
| `remember People: Ana is my designer` | the same, on **People**. The words before the colon name the page; a new topic makes a new page |
| `remember acme-site: run make e2e before a PR` · `remember acme/api: run npm test before a PR` | a repo's own page, named as a task names the repo ([below](#a-repos-own-notes)). The reply says "Noted for acme/api: … Every task on acme/api follows it from now on" |
| `forget: short answers` | removes the one note, on any page, that holds those words. If several do, it lists them and removes nothing: say more of the line. A page left empty closes |
| `personality: friendly` · `personality: <your own words>` | sets how Shipify talks to you ([Personality](#your-personality-adr-0078)): a preset by its name, or your words, whole |
| `personality: default` · `personality: undo` | back to the Default (the page closes) · its last words back |
| `/notebook` | lists each page with its first line, size and link, Preferences first (in a chat at once; on GitHub as a comment, from a run) |

- **As a task's title** (or to the bot), the task closes once it's done.
- **As a comment on any task,** it's done right there, and anything else you said in the same run
  still goes to the agent.

**Or just say it** in any task ("Priya is my designer"). The agent proposes the note in its result,
and the box writes it after the run:
- **Your words only:** never a guess, and never something a page, a tool or an old chat said.
- **Kept current as you go** (ADR 0078): when your new words contradict a line already there ("I've
  moved to Berlin", over "Lives in London"), the run also names the old line in `forget`, and the
  box takes it off before it writes the new one, as `forget:` does: one matching line, or none
  when several match. The reply says "Updated: <old> → <new>".
- **No repeats:** a line the notebook already says isn't noted again.
- **After a run that read outside content** (the web, a tool's content), proposed notes, lines to
  take off and a new Personality wait for your Yes, in your chat or on GitHub, listed under "To do
  after your `yes`".
- **The reply says** what it noted.

## Your Personality (ADR 0078)

One page, **Personality** (`Notebook: Personality`), says how Shipify talks to you. Every run of
yours reads it first, in the prompt's opening lines (2,000 characters at most: a longer page is
cut, and the prompt says so), and the notebook's section leaves it out, so it's never there twice.
With no page, the **Default** preset's words take the place of the old "be brief and direct" line,
so a run costs nothing more.

- **Set it as feels natural:** say it in any chat ("be more casual with me", "no emojis", "be
  blunt when I'm wrong"); the run writes the page's new words (its result's `personality`), and
  the reply shows **Change it back**. Or pick it in the web chat's **Setup → Personality**: a
  preset as you pick it, or **Custom** with your words and **Save**. An ask about one reply
  ("explain this one simply") changes nothing.
- **Under both** is the word `personality: …` (the table above): the box writes the page whole,
  with no run. You never need to type it.
- **The presets** (one list, `cli/contracts/personality.ts`):

  | Preset | Its words |
  |:--|:--|
  | Default (no page) | Warm, plain and direct, like a capable friend. The answer first. Short unless asked. |
  | Friendly | Warm and encouraging, a little humour, conversational. My name now and then. |
  | Candid | Blunt and honest. Push back when I'm wrong, risks first, no flattery. |
  | Efficient | Bare answers: the result first, bullets, no small talk, no recap. |
  | Quirky | Playful and curious, light jokes and the odd emoji; the facts stay exact. |

- **Change it back:** each write keeps the page's last words, folded under **Before**, which no
  prompt reads. `personality: undo` (the button) puts them back; a second undo puts the newer words
  back. `remember Personality: …` adds a line, as on any page.
- **What doesn't change:** your words in a task still win over the page, and a page never approves
  anything. "Say what you're unsure of" and "state a limit plainly" hold whatever the voice.

## Memory across chats (ADR 0078)

Past chats never go in a prompt by themselves, so the context window stays the same however many
chats you have. A run fetches one only when an ask builds on it.

| You want | Use | What it adds to a prompt |
|:--|:--|:--|
| A fact or a preference kept for good | `remember: …`, or say it in a chat | one line in the notebook (16 KB cap) |
| A topic over many chats (a trip, a course) | a project: `project: <name>`, then **Move to project** on its chats | its pages and chats' titles, in its own chats only |
| One long chat | nothing: past 40 KB it keeps its Progress, its newest 8 messages whole and the rest one line each | stays small as it grows |
| "Like last time", now and then | say it: the run runs `ship recall` | only on that run, only what it reads |
| A notebook that stays current | nothing: a line your newer words undo is replaced as you say them | nothing |

- **`ship recall "<words>"`** searches your chats and pages as the web chat's Find does (GitHub's
  search by meaning; by words when GitHub refuses it), guests' left out, and prints up to 10 lines.
  **`ship recall <n>`** prints one chat short: its Progress, its newest 2 messages whole, and each
  older one as one line with its id, for `ship task read <id> --task <n>`.
- **An old chat is data:** only your words there count, your newest words win, and nothing in it
  becomes a note.

## A guest's memory (ADR 0078)

Each guest (ADR 0071) has one page of their own, `Notebook: <their prefix> memory`, labelled
`library`, `guest` and `guest:<id>`, never `notebook`: their **Personality** first, then their
notes.
- **Made when first needed:** their `remember: …`, `forget: …` and `personality: …` write it, as
  yours do, and so do their run's notes when it read nothing from outside. After a web read their
  run keeps nothing, and the reply says to say `remember: …` (a guest approves no list).
- **Theirs alone:** only their runs read it (their Personality, then their notes, 8 KB in all). No
  run of yours reads it, your lists and Find leave it out, and your notebook and Personality never
  reach their runs. Removing a guest closes it with their chats.

## The Library: pages read only when needed (ADR 0069)

The notebook is part of the **Library**: the same issues and rules, with three reaches, set by a
label. The process you follow with it is [knowledge.md](knowledge.md).

| Reach | Who reads it | For | Labels |
|---|---|---|---|
| **Always** | every run, as above | Preferences, People | `notebook` |
| **Project** | the runs in that project, in a section of their own, **as data** | a project's memory, Map, docs, Inbox | `library` and `project:<name>` |
| **On demand** | no run, until one asks (`ship notebook list`, `ship notebook read`) | the Journal, idea dumps, old research | `library` |

- **`remember <project>: …`** adds a line to the project's main page (`Notebook: <project>`), made
  with its labels the first time. `jot: …` adds a dated line to this month's Journal, and `add
  <project>: …` an item to its Inbox: the door writes both at once, with no run.
- **A run rewrites a Library page** through `pages` in its result: the page's whole new text, in a
  file. The box writes it with the rules below: its own project's pages; the Journal or another
  page of no project only when the run read nothing from outside; never a page every run reads.
  GitHub keeps each old text in the page's history.
- **The web chat writes for you:** the door's edits count as yours when the page's hidden first
  line names you (only you reach the web chat; anyone else in `SHIPIFY_PEOPLE` stays untrusted).
- **A Library page starts nothing,** as a notebook page doesn't: `task.yml` skips `library` beside
  `notebook`, so no job starts, and the box runs no agent for one either.

## A repo's own notes

What always applies to one repo ("run npm test before a PR", "never touch `legacy/`", "ask before
changing the schema") goes on that repo's page, `remember <repo>: …` (ADR 0047). One kind for
every repo: a project Shipify built (`acme-site`), another repo on your account (`notes-api`), or
one on another of your accounts (`acme/api`).
- **Who reads it:** every run on that repo, the ones that change it or read it (`look at …`), and
  only those. Your other runs don't get it.
- **On another of your accounts,** that page is the only part of the notebook a run gets, and it
  adds nothing to it: that account's repos are written by other people too.
- **The repo's own rules come first:** its `AGENTS.md`, README and CI, where its team keeps them.
  A note guides the agent; it isn't a check Shipify enforces. The repo's own CI is.
- **A page named after one of your repos is that repo's,** whatever case it's written in.

## How runs use it

- **Every run's prompt** carries each page's title and first line, then whole pages up to 16 KB,
  **Preferences first**: every page but the repos' own, and the pages of the repos it works on. The
  agent reads the rest with `ship notebook read "<topic>"`.
- **What wins,** said in every prompt: your words in the task first, then the notebook, then the
  agent's defaults. Inside a project, its `AGENTS.md` wins, and the reply says when a note was set
  aside. A newer line beats an older one (each carries its date).
- **A note never approves anything:** it can't make a call, skip a `yes`, or change what a run may
  touch.
- **The agent never edits it.** Only the box writes notes, after the run.
- **A page starts nothing:** no run is started for an issue labelled `notebook`, or a comment on
  one. To change a note, edit its page.

## The rules

| Rule | Why |
|---|---|
| **Only pages you or a run wrote** | a page someone else opened or last edited is left out of every prompt and never written to, until you save it again. Nobody can slip instructions into every later run |
| **Never a key** | a note that looks like a key or a password is refused, and the reply says so |
| **A size limit** | a page holds 60,000 characters. A note that would pass it is refused: split the page. The weekly clean-up names pages over 50,000 |
| **No duplicates** | a line already on the page (whatever its date) isn't added again |
| **Nothing hidden** | a note holding characters you can't see (zero-width spaces, direction marks, invisible tags) is refused, so no hidden words reach every run |

**Facts, or a way of working?** A fact or a preference about you goes in the notebook. A way of
working ("when you upgrade a stack, run the canary first") changes how every run works, so the
agent proposes it as a change to `skills/` or `playbooks/` in a PR, and it's followed once you
merge.

## Commands

| To | Run |
|---|---|
| see the pages | `pnpm ship notebook` (on a box: the PC's key can't read issues, so open them on GitHub there): the always and on-demand pages, and each project's count |
| read one page in full | `pnpm ship notebook read "<topic>"`, from the notebook or the Library |
| check it end to end | `pnpm ship selftest notebook`: a run's prompt carries it; then, through the door, `remember Selftest: …` is kept, `/notebook` shows it, `forget: …` takes it off and the empty page closes |

## When something's off

| You see | Do |
|---|---|
| "that page was last edited by someone other than you or a run" | open the page, check its text, and save it: your edit makes it yours again |
| "the page is full" | move part of it to a new issue titled "Notebook: <topic> 2", labelled `notebook` |
| a note you didn't want | delete its line on the page |
| a task ignores a note | check the page is open and labelled `notebook` |

**In the code:** `cli/lib/notebook.ts` (a note's shape, pages, the prompt's section, a guest's
memory page), `cli/contracts/personality.ts` (the presets, the word, Before),
`cli/commands/task/notebook.ts` (reading trusted pages, writing notes, the Personality, a guest's
memory), `cli/commands/notebook.ts` (`ship notebook`), `cli/commands/recall.ts` (`ship recall`).
