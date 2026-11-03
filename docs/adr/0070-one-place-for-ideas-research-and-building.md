---
status: accepted (merged #656, task #655, 2026-11-03, every open question at its proposed answer) and built in one PR after the owner's `go` of 2026-11-03; see [As built](#as-built-2026-11-03-five-parts-in-one-pr-on-task-655).
date: 2026-11-03
amends: 0065 (the words: a repo Shipify builds is an app or a package, by its kind; a group of chats with pages is a project), 0069 (a project's main page gets a Now block and a Log; a Sources page; Keep on page and Check the project; a page write checks that the page didn't change since the run read it; search by meaning; one next step on a project's page; a projects line in the weekly digest; a clean start)
---

# 0070: One place for ideas, research and building

## The plan in short

Shipify already keeps a project's chats, pages, Inbox and files (ADR 0069). This ADR makes it the
one place where you think a project through, from a first thought to a merged PR, with no second
tool. It adds no service, store, key or setting: each upgrade is a page, a word, a button or a
view on what is there. Four upgrades cost a run, and only when you ask. The rest cost none.

1. **A pitch that says what Shipify is:** "Your own assistant for ideas, research and building",
   not only "your own AI engineer on GitHub".
2. **One loop that says what it does:** Capture → Keep → Think → Ship → Share.
3. **Ten upgrades** (section 5): Keep on page, a Now block, a Log, a Sources page, Check the
   project, one next step, search by meaning, a projects line in the weekly digest, two words for
   "project", and the pitch.
4. **Search in three layers,** cheapest first: structure, words, then meaning through GitHub's own
   hybrid issue search. It works on your private repo (tested, below).
5. **Stages a project grows through,** with one next step on its page, worked out from counts.
6. **A clean start:** after an Export and your `yes`, the old chats outside projects close. Nothing
   is deleted at once.
7. **The build:** one PR in five parts, after your `go`.

It comes in the same PR as task #655's context fixes, which it builds on: a run's prompt lists the
newest 30 chats, says what it is missing, and says each thing once.


## The owner's asks

In your words, oldest first. Each is answered in the section named after it.

**#568 (2026-10-24):**
- "For shipify web and runs i want more better UI projects and such management for eg claude
  projects manage input output docs categorize well" (built: ADR 0065)
- "Projects with multiple tasks inside organized like tabs and such cleanly in projects properly
  handled managed UI categorization" (built: ADR 0065, then 0069)

**#631 (2026-11-01):**
- "i can create a project like a product idea research project i create a project group or
  something from web i can put and share project memory" (built: ADR 0069)
- "we dont even need notion we can manage and track our notes per task or project" (built: pages)
- "we sometimes struggle with managing all info like found info notes screenshots … if we want to
  collate look at all to get answered from agent … looking for cheap no extra resource solution"
  (built: the Inbox and collate; section 5, Keep on page)
- "it will get too big for me to manage or search or anything long conversations written down not
  summarized" (partly built: Progress and the cut; sections 3 and 5)
- "project can share efficiently knows all is organized where to tell and reference and what we
  stored cited looked into" (partly built: the Map; section 5, Sources and Check)
- "Should not use something which will block us at critical junctures" (section 3: search falls
  back to words)
- "how are we thinking of reducing cognitive load for managing the setup simply automatically"
  (sections 4 and 6)

**#655 (2026-11-03):**
- "Check for efficiency and simplification of the setup strong robust any ideas what can be best
  for good understanding follow ups no cognitive loads" (the context fixes in this PR)
- "Any analogy or setup idea how to think and approach project from web chat approach how and when
  to come here to do research work store jot and well manage … check real world setups" (sections
  1 and 2)
- "This is idea discussion if we want to do adr for strong discussion and good level upgrades we
  can consider" (this ADR)
- "Make sure we are strong from flow to boxes to web chat all handled well" (section 2, by layer)
- "its not just for repos its bigger entity something with project management well handled and
  designed" (section 1)
- "Check all previous requirements we had building this new feature" (this section, and What was
  found)
- "How does it become search base user should know how to manage and grow their projects well"
  (sections 3 and 4)
- "Something common not multiple or inefficient tools to manage something clean and cheap simple
  architecturally but powerful" (section 2's rule)
- "Curious for collating thesis or research project what tools the researchers use" (What others
  do; section 5, Sources)
- "Also we can start clean fresh no chats anymore for new arch we can clean R2 keep it well
  maintained infra" (section 7)
- "can you capture plan concept adr in the same PR properly" (this ADR, in PR #656)


## What was found (checked 2026-11-03, `main` at `61e1ca5`)

| What | Where | What it means here |
|---|---|---|
| The pitch says "Your own AI engineer on GitHub" | `README.md:3`, `docs/product.md:3` | it leaves out research, learning and ideas: #632 (a clinic start-up) and #633 (a curriculum) are projects with no code |
| A page is written whole, through `pages` | `cli/kernel/types.ts` (`w: "pages"`), `cli/commands/task/notebook.ts` | nothing checks that the page didn't change since the run read it: two writes close together, and the later one drops the first one's lines. Keep on page makes this more likely, so part 1 fixes it |
| The Map is the first block of a project's main page | `skills/knowledge/SKILL.md` ("The Map first") | there is no place for what's going on now, and no record of what changed when |
| "collate the inbox" reads the items after `Collated up to item <id>` | `cli/kernel/projects.ts` | the only way a find reaches a page; a good answer in a chat reaches one only when you ask in words |
| Ctrl+K finds names; other words go to GitHub's search page | `edge/public/admin/chat/workspace.js` (`Search on GitHub`) | the edge has no search route; a run has `gh search issues` and `ship notebook list` |
| The weekly digest says the week to your default chats | `docs/watch.md` (the `due` row, `SHIPIFY_DIGEST`) | it says what waits on you, but nothing per project. A projects line fits there, with no new repeat (AGENTS.md: "a new duty for the watch is one more line in its check") |
| The weekly clean-up closes a chat outside a project after 30 quiet days, and deletes a closed chat's files 30 to 60 days after it closes | `docs/watch.md` (the `cleanup` row) | a clean start needs no new delete path |
| Files lists every file with **Delete** | ADR 0069 part 1 | a file you want gone now goes from there |
| "project" means two things | `docs/glossary.md` (a repo with `shipify.json`, of kind `app` or `package`; and one you make, ADR 0069) | the web chat's list shows both; the kind already names the first |

The draft this ADR comes from (`projects-direction-draft.md`, on task #655) proposed the weekly look
as a repeat of its own. Checking the code found the weekly digest, which already reads what waits
on you: the look is one more line there instead.


## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| GitHub's issue search finds by meaning on a private repo, with an App's token | Tested 2026-11-03 on `aayush-t-apps/shipify` (private) with the box's App token: `GET /search/issues` with `search_type=semantic` and `search_type=hybrid` answered `200`, `"search_type":"hybrid"` |
| The query must say `is:issue` | Without it, GitHub searched by words only and said `"lexical_fallback_reason":["non_issue_target"]` |
| Hybrid finds what words miss | "research for a clinic start-up": hybrid's first hit was #632 (the clinic research). Words found only #647, not #632. Meaning alone found one issue (#648). So hybrid, not meaning alone |
| The limit is 10 searches a minute for each App installation | The answer's headers: `X-RateLimit-Limit: 10`, `X-RateLimit-Resource: semantic_search`. The 11th search in the minute was refused |
| It has been generally available since 2026-04-02 | [GitHub's changelog](https://github.blog/changelog/2026-04-02-improved-search-for-github-issues-is-now-generally-available/) |
| It costs nothing | it is part of GitHub's REST API, with no plan of its own |
| The door's App gets the same search | Not checked in the build: a run holds the box's token, not the door's. The edge's search falls back to words on any refusal (403, 422, 429) and says so, so a door it refuses still finds by words |
| It finds an Inbox item, which is a comment | Checked 2026-11-03 in the build: no. "healthcare travel destination in western India" found nothing, though an Inbox item says "Gujarat can become hub of medical tourism". Hybrid search reads issues' titles and bodies, not comments, so an Inbox item is found by words (**Search on GitHub**, `in:comments`) |
| At about 100 sources, an index the model reads is enough, with no search engine | Karpathy's "LLM Wiki" gist (2026-04-04), read for the draft; not tested here |


## What others do, and what to copy

| Setup | The idea worth copying | In Shipify |
|---|---|---|
| Claude and ChatGPT Projects | instructions, files and chats in one boundary; memory kept inside the project | the brief, the pages, the chats (built) |
| Karpathy's "LLM Wiki" | raw sources never change; the model keeps a wiki with an index and a log; good answers are filed back; a "lint" finds contradictions and orphans | the Inbox, the pages, the Map (built). New: the Log, Check the project, Keep on page |
| NotebookLM | every claim links to its source; a good answer becomes a note in one tap | a source on each fact (built). New: Keep on page |
| PARA and CODE (Tiago Forte) | projects, areas, resources, archives; capture, organize, distill, express | projects, the Library, closed projects; the process in `docs/knowledge.md`. A project that never closes is an area |
| GTD's weekly review | empty every in-tray once a week | "collate the inbox". New: the digest's projects line says when |
| Shape Up's hill chart; Linear's project updates | a mark when work stops moving; one status line per project | each chat's Progress. New: the Now block |
| Researchers: Zotero and Better BibTeX keys; Obsidian or Zettlr; Overleaf or Quarto; Elicit, Semantic Scholar, ResearchRabbit; Rayyan | one library of sources, each with a stable key; a note per source; a **synthesis matrix** (a row per source, a column per question) | facts cite their source (built). New: a Sources page with a key per source, and the matrix built from it when you ask |
| A lab notebook | dated entries, never erased | the Journal; GitHub keeps every page's history |


## Options

**The whole:**
- **A: Grow what is there** (pages, words, buttons and views on GitHub issues and R2). (+ one
  store, nothing new to run, pay or keep in step / − GitHub's search and editor are what they are)
- **B: A knowledge store of Shipify's own** (a database or a vector index on the edge). (+ fast
  search, its own links / − a second copy to keep in step, a new service, against "no extra
  resource")
- **C: Hand knowledge to other tools** (Notion, Obsidian, Zotero) and link to them. (+ mature
  editors / − several tools, which you asked not to have; ADR 0069 made Notion optional)

**Search by meaning:**
- **A: GitHub's hybrid issue search.** (+ no index, free, tested / − 10 a minute, and GitHub owns it)
- **B: Cloudflare Vectorize.** (+ ours to tune / − an index to fill and keep in step with every
  edit)
- **C: Words only.** (+ nothing to build / − misses what #631 asked for)

**The weekly look:**
- **A: A projects line in the weekly digest.** (+ no new repeat or script; it goes where you
  already look / − only as often as the digest)
- **B: A `check` repeat with `checks/projects.mjs`** (the draft's). (+ its own schedule / − one more
  thing to turn on and keep)


## Decision

Chosen **A** in each: grow what is there; GitHub's hybrid search; the digest's line. Each keeps one
store and starts no work by itself, which your notebook asks for ("fewer calls and less resource
use", "don't start work automatically").

### 1. The pitch and the loop

> **Your own assistant for ideas, research and building. It keeps what you find, thinks with you,
> and ships what you decide: one place, free, and yours.**

```
 Capture ──► Keep ──► Think ──► Ship ──► Share
 jot, add,   pages,   chats,    PRs,     export,
 files       the Map  research  deploys  drops
```

| Step | What you get | You say or tap |
|---|---|---|
| **Capture** | a thought, a link or a screenshot saved in a second, with no run | `jot: …`, `add games: …`, **Add** |
| **Keep** | a project's pages: its Now, its Map, its facts with their sources, its Log | `project: games`, "collate the inbox", **Keep on page** (new) |
| **Think** | answers, research and plans in chats that read the project first | **New chat here**, "check the project" (new), "split it" |
| **Ship** | a PR, a new app, a deploy, a repeat, a change in Notion | `shop-web: add login`, `new: …`, `yes` |
| **Share** | a zip of a project, or a link to its files | **Export**, "share this as a drop" |

**For** one person who builds, researches or learns: a solo developer, a founder, a student, a
researcher. **Not** a team's tracker (no assignees, sprints or boards), a paid service, or a
second store.

**How to think of it: a desk.**

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

**When to do what:**
1. A thought: `jot:` it.
2. It keeps coming back: make a project, with a 3-line brief (the goal, done when, not doing).
3. A find: `add <project>: …`.
4. A question: a new chat in the project, one question per chat.
5. A good answer: **Keep on page**.
6. Every week, when the digest says so: "collate the inbox".
7. Back after a break: read the Now block, then the Map, then the chats' Progress.
8. Before a decision: "check the project".
9. Finished: **Close** the project. Its pages stay.

Rule of thumb: if you'll want it next week, it goes in a project.

### 2. The design, layer by layer

**The rule: one store.** Words live in issues on your shipify repo, and files in R2. Everything
new is a page, a word, a button or a view on what is there: no new service, key, database or
second copy. Each run reads only what its ask needs.

| Layer | What changes |
|---|---|
| **The record (GitHub)** | A project's main page has three blocks, in this order: **Now** (Now, Next, Open questions), **Map**, and at its foot the **Log** (a dated line for each page write, the newest 20). A project can have a **Sources** page (`<name>-sources`): each source once, with a short key that facts cite (`[who-2024]`). A new project's brief starts from three lines: the goal, done when, not doing |
| **The box (runs)** | **Keep on page:** a run files a reply's key facts on the project's pages, with the reply's link, and updates Now. **Check the project:** a run lists contradictions, stale facts, facts with no source, keys with no line on Sources, and chat findings that never reached a page; "fix them" applies the list. A chat's run updates the Now block in the page write it already makes. The box writes the Log line itself, with no run, and writes a page only when it didn't change since the run read it |
| **The edge and the web chat** | **Keep on page** on a reply in a project. A project's page shows Now first, then the Map, then the chats by state, and one next step (section 4). Ctrl+K finds chats and pages by meaning, through GitHub's hybrid search, when you pick **Find by meaning** |
| **The watch** | The weekly digest gets a line per live project: its Inbox items since the last collate, its chats waiting on you, and its chats quiet for 7 days. No line when there's nothing to say, or when the digest is `off` |
| **The docs** | `README.md` and `docs/product.md`: the pitch and the loop. `docs/knowledge.md`: the desk, "when to do what", and "Grow a project". `skills/knowledge`: Now, Log, Sources, Keep, Check |

### 3. Search, in three layers

1. **Structure.** You rarely need to search when each project has a Now, a Map and a Sources page,
   and each fact is in one place. Karpathy reports the same at about 100 sources.
2. **Words.** Ctrl+K finds names (projects, chats, docs) as today. A run has `gh search issues` and
   `ship notebook list`.
3. **Meaning.** GitHub's hybrid issue search: `GET /search/issues` with `search_type=hybrid` and
   `q=repo:<owner>/shipify is:issue <words>`. Every chat, page and Inbox page is an issue, so this
   needs no index, service or key of Shipify's own.
   - **Ctrl+K:** names as you type, as today. Its list ends with **Find by meaning**, where
     **Search on GitHub** is today; picking it asks the edge, which searches with the door's token
     (its own 10 a minute) and shows chats and pages, a page by its title. Nothing searches as you
     type.
   - **A run:** `skills/knowledge` gives the same call for "find what we know about …", and
     `gh search issues` stays the fallback.
   - **Busy or gone:** when GitHub refuses (the limit) or drops the feature, both fall back to
     words and say so. Nothing else depends on it, so there's no index to move.

Vectorize is the fallback design only if GitHub's search proves not enough. It is not built.

### 4. Growing a project: stages and one next step

A project's page shows one next step, worked out from counts (its chats by state, its Inbox's
items, its Map's lines), with no run. The page loads its chats and pages today
(`edge/public/admin/chat/project.js`); part 2 checks that the Inbox's item count comes in the same
read, with no new call:

| Stage | You have | The next step it shows |
|---|---|---|
| Seed | `jot` lines in the Journal | "organize my journal" proposes a project |
| Project | a brief, an empty Map | add finds; ask a first question in a chat |
| Research | chats and Inbox items | "collate the inbox" when 10 items wait; **Keep on page** on good answers |
| Decide | facts and open questions in Now | write the decision on the main page; "check the project" |
| Build | repos named in the brief | a chat per change, a PR each |
| Done | — | **Close**: its pages stay in the Library |

The 10 items is the one number here, fixed in the code, not a setting.

### 5. The ten upgrades, by value for the cost

| # | Upgrade | Where | Cost |
|---|---|---|---|
| 1 | **Keep on page:** a reply's key facts filed on the project's pages, linked back, Now updated | a button on a reply in a project, and the word "keep this on the page" | one run, when you tap (in a staying run's session when one is up) |
| 2 | **Now** on the main page: Now, Next, Open questions | the main page; kept by the runs that write it | no extra run |
| 3 | **Log:** a dated line for each page write (`2026-11-03 · games-pricing · from #657`), the newest 20 | the main page's foot; the box writes it | none, or one page edit when the run's write leaves the main page out |
| 4 | **Sources:** each source once, with a key; facts cite the key. A research project's synthesis matrix (a source per row, a question per column) built from it on ask | `<name>-sources`, and `<name>-matrix` on ask | none (the runs' own writes); one run for the matrix |
| 5 | **Check the project** | the word "check the project" | one run, when you ask |
| 6 | **One next step** on the project's page | the web chat | none: counts |
| 7 | **Search by meaning** in Ctrl+K and runs | the edge, `skills/knowledge` | one GitHub search each time you pick it, no run |
| 8 | **The digest's projects line** | the watch's weekly digest | none: the digest's own read |
| 9 | **Two words for "project"** | docs, the web chat, replies | words only (section 6) |
| 10 | **The pitch and the loop** | `README.md`, `docs/product.md` | docs only |

Why the Log keeps 20 lines: the main page must stay small enough to reach a run whole, inside the
pages' 16 KB. Older lines stay in GitHub's history of the page.

### 6. The words: app and project

Today "project" means a repo Shipify builds (`docs/glossary.md`: a repo with a `shipify.json`, of
kind `app` or `package`) and also a group of chats with pages (ADR 0069). The kind already names
the first, so no new word is needed:
- **In what you read** (docs, the web chat, replies), a repo Shipify builds is an **app** (or a
  **package**), and a **project** is always one you make.
- **In the code** nothing is renamed: `work.project`, `shipify.json`, `projects/<id>` and the CLI
  keep their names, so nothing breaks and no old word needs a move. The glossary says so once.

### 7. A clean start

You said the new design can start fresh. It carries no old shapes, so it needs no migration. The
build ends with one step that you start, `clean start`, from any chat:

1. **Export** what you want to keep (a zip).
2. Its run lists the open chats outside projects, leaving out the ones the 30-day close leaves
   open (an open PR or part, a repeat, `waiting` and the rest). It asks your `yes`.
3. On `yes`, the box reads the list again and closes them as completed, with the 30-day close's
   own code. A chat with new words since the list stays open.
4. Their files go by the weekly clean-up's rule, 30 days after the close, so you have 30 days to
   change your mind. A file you want gone at once goes from Files, with **Delete**.
5. Your projects and their pages stay (#632 and #633 are projects now), unless you say otherwise.

Nothing is deleted before that step and your `yes`.


## Edge cases

- **Two writes to one page at once** (Keep on page while a chat's run writes the same page): the
  box compares the page's last edit time with the one the run read. If it changed, the box doesn't
  write; the reply says so, and "keep it again" redoes it from the new page.
- **Keep on page outside a project:** the button shows only in a project. The word, outside one,
  says to move the chat into a project first.
- **Keep on page on a reply with nothing to keep:** the run says so, and writes no page.
- **A long or old reply:** the run reads it whole with `ship task read <id>`.
- **The Now block goes stale** (no run wrote the main page for weeks): the next step comes from
  counts, not from Now. Check the project names a stale Now.
- **A fact cites a key that isn't on Sources,** or one source has two keys: Check lists it.
- **A source is a web page that later changes:** the Sources line keeps the date it was read.
- **The search limit** (10 a minute): Ctrl+K says "words only for a minute" and searches words.
- **GitHub changes or drops search by meaning:** Ctrl+K and runs search words; nothing else breaks.
- **The main page grows past the pages' budget:** it reaches a run by title only, as any page does
  today. The Log's 20 lines and Check's "this page is long" keep it from happening.
- **The digest with no live project,** or a project with nothing waiting: no line.
- **The clean start's `yes` comes days later:** the list is read again; see section 7.
- **An old word:** `project:` and every word typed today keep working; only new docs and labels
  change.


## Security

- No new key, permission or service. The edge searches with the door's App token, which reads
  issues today, and only in your shipify repo (the query names it). Results show only to you,
  signed in, as Ctrl+K's do today.
- Keep on page and Check write only the project's own pages, under the notebook's rules (ADR 0069):
  never a page every run reads, and never a page someone else last edited.
- A kept fact from a web page is data with its source, never an instruction.
- The clean start closes only on your `yes`, and deletes nothing at once.


## Cost and limits

- **Runs:** Keep on page (one a tap), Check (one an ask), the matrix (one an ask), the clean start
  (one). Nothing else starts a run.
- **GitHub calls:** the Log needs none when the run's write has the main page, else one edit. A
  search is one call when you pick **Find by meaning**. The digest's line comes from its own weekly read, and
  part 2 checks that it adds no call.
- **A run's prompt:** Now is about half a kilobyte; the Log at most about 1.2 KB. The Sources page
  shares the pages' 16 KB, by title when it doesn't fit.
- **Money:** $0. GitHub's search is part of its API, and nothing new goes to R2.


## The build, in parts, after your `go`

One PR, its parts committed in order (as ADR 0069 was built), each with its tests and docs:

1. **Keep it:** the page write's check (no write over a changed page); Now and the Log; the Sources
   page and keys; Keep on page (the word and the button); `skills/knowledge`.
2. **See it:** one next step on a project's page; the digest's projects line; "check the project";
   the matrix on ask.
3. **Find it:** first check the door's search and Inbox comments (Assumptions, above); then hybrid
   search in Ctrl+K and in `skills/knowledge`, with the fall back to words.
4. **Say it:** the pitch and the loop; "app" and "project" in the docs and the web chat; the
   glossary.
5. **Start clean:** `clean start`, its list and its `yes`.

Then a full docs pass, and ADR 0065's and 0069's "amended by" lines.


## Open questions, each with a proposed answer

Answer any of them on task #655. One you leave keeps its proposed answer when you merge.

1. **The pitch:** the line in section 1, or your own words? *Proposed: the line in section 1.*
2. **The first build:** all ten upgrades, or 1 to 4 first? *Proposed: all ten in one PR, in the
   five parts above, so the switch happens in one go.*
3. **Search by meaning:** GitHub's hybrid search in Ctrl+K and runs, or words only for now?
   *Proposed: hybrid, when you pick **Find by meaning**, with words when it's busy.*
4. **The clean start:** the old chats' files deleted at once, or by the weekly clean-up?
   *Proposed: by the weekly clean-up, 30 days after the close, with Files' Delete for any file you
   want gone now.*
5. **The words:** "app" and "project", or others? *Proposed: "app" (or "package") and "project",
   in what you read only; the code keeps its names.*


## Not in it

- A search store of Shipify's own (Vectorize, D1): only if GitHub's search proves not enough.
- A board view, assignees or sprints: Shipify is not a team's tracker.
- Areas as a new kind: a project that never closes is one.
- A Zotero tool: later, as a plug-in through Zotero's free Web API, if you work from papers.
- A Notion-like editor (as ADR 0069 decided).
- New names in the code for "project".


## Docs and clean-up

`README.md`, `docs/product.md`, `docs/knowledge.md`, `docs/glossary.md`, `docs/roadmap.md`,
`docs/channels.md` (Keep on page, the project's page, Ctrl+K), `docs/watch.md` (the digest's line),
`docs/tasks.md`, `skills/knowledge` (and its scenarios), `playbooks/task.md`, `intents.json` (Keep,
Check, clean start), ADR 0065's and 0069's "amended by" lines, this index's line, and
`CHANGELOG.md`. Nothing is removed: the draft on task #655 stays as its history.


## Consequences

- **Easier:** one place from a thought to a PR; a good answer kept in one tap; finding a chat by
  what it meant; coming back after a break (Now, then the Map); research that keeps its sources.
- **Harder:** the main page has three blocks to keep tidy (`skills/knowledge` says how). Search by
  meaning is GitHub's, so it can change; it falls back to words.


## Confirmation

- Tests: a page that changed since the run read it isn't written; the Log line and its 20; the next
  step from counts (a pure function); Ctrl+K's fall back to words on a refused search; the digest's
  line; the clean start's list leaves out what the 30-day close leaves out.
- `scripts/stress-0069.ts`, run again with Now, Map and Log: the main page reaches a run whole at
  the planned sizes.
- `tests/skills.test.ts` for `skills/knowledge`, and `ship pr --check`.


## As built (2026-11-03, five parts in one PR on task #655)

Built as decided, with these changes found in the code:

- **The page write's check** compares each page's last text edit (GitHub's `lastEditedAt`, or when
  it was made) with the time the box read the pages for the run's turn (`pagesAt`). A comment (an
  Inbox item) changes nothing. A run that stays (ADR 0057) is told to read a page again before it
  writes it whole, as its session read the pages turns ago. Pages are written before notes, so a
  note on the same page lands on the new text.
- **The Log** has one line for each run's writes, naming every page it wrote, not a line a page: 20
  lines then reach further back.
- **Keep on page** is a reply button made where every chat's buttons are (`replyButtons`), from a
  mark the box sets on an answer in a project's chat that kept nothing yet (the reply line's
  `keep`): every channel gets it, under the newest answer, and the web chat's first screen, 12
  bytes from its 42 KB, carries no new code. "keep this on the page" with a reply's link names an
  older one.
- **"keep this on the page" and "check the project"** reach the run as notes from the box, as
  "collate the inbox" does; nothing is written by a check.
- **The next step** is worked out on the edge (`nextStep`, beside the project's read), not in
  `project.js`, whose 3 KB had 8 bytes to spare. Its counts come from the Library's one read: an
  Inbox's comment count less the count its last collate wrote (`Collated up to item <id> (<n>
  items).`), the main page's Now and its Map's lines.
- **The digest's projects line** costs one GraphQL read a week (two searches: the open projects
  with their chats, and the open Inbox pages), made only when the digest is said. No read the due
  run makes holds projects.
- **Search by meaning** is the edge's `api/search`, picked from Ctrl+K and kept a minute per query.
  Ctrl+K names a repo "Repo" and keeps "Project" for one you make.
- **The clean start** is a fixed word the box answers with no run: its list comes from the weekly
  clean-up's own read with every open chat counted as quiet (the oldest 100), its yes reads them
  again, and each closes with the 30-day close's code.
- **Words:** "app" or "package" for a repo in the glossary, the README, `docs/product.md` and
  `docs/channels.md`; older docs keep "project" where the code's name is meant.
- **The size check:** `scripts/stress-0069.ts` became unit tests in ADR 0069's build, so the check
  is one there (`tests/notebook.test.ts`): a main page with Now, a 30-line Map and the Log's 20
  lines stays under 6,000 characters and reaches a run whole beside Preferences.
