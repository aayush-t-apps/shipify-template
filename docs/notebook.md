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
| `/notebook` | lists each page with its first line, size and link, Preferences first (in a chat at once; on GitHub as a comment, from a run) |

- **As a task's title** (or to the bot), the task closes once it's done.
- **As a comment on any task,** it's done right there, and anything else you said in the same run
  still goes to the agent.

**Or just say it** in any task ("Priya is my designer"). The agent proposes the note in its result,
and the box writes it after the run:
- **Your words only:** never a guess, and never something a page or a tool said.
- **After a run that read outside content** (the web, a tool's content), proposed notes wait for
  your `yes` on GitHub, listed under "To note after your `yes`".
- **The reply says** what it noted.

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
| see the pages | `pnpm ship notebook` (on a box: the PC's key can't read issues, so open them on GitHub there) |
| read one page in full | `pnpm ship notebook read "<topic>"` |
| check it end to end | `pnpm ship selftest notebook`: a run's prompt carries it; then, through the door, `remember Selftest: …` is kept, `/notebook` shows it, `forget: …` takes it off and the empty page closes |

## When something's off

| You see | Do |
|---|---|
| "that page was last edited by someone other than you or a run" | open the page, check its text, and save it: your edit makes it yours again |
| "the page is full" | move part of it to a new issue titled "Notebook: <topic> 2", labelled `notebook` |
| a note you didn't want | delete its line on the page |
| a task ignores a note | check the page is open and labelled `notebook` |

**In the code:** `cli/lib/notebook.ts` (a note's shape, pages, the prompt's section),
`cli/commands/task/notebook.ts` (reading trusted pages, writing notes), `cli/commands/notebook.ts`
(`ship notebook`).
