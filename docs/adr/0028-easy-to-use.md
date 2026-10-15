---
status: proposed (the owner's asks of 2026-10-03, after ADR 0027 went live; merging its PR accepts it)
date: 2026-10-03
---

# 0028: Easy to use: a way in for everything, one answer to "which one?", a console that tells the story

## Context
ADR 0027 is built and live: recipes, the notebook, the door, the console, `ship setup` and
`ship selftest` all work, and `ship selftest` passes 14 of 14. Using them is the problem. The owner,
the same day:
- thought recipes had replaced tasks ("tasks is basically replaced by recipes?");
- found nothing new on GitHub's New issue page ("why isn't form and flows updated, why are they
  still missing on issues");
- found the console no help in understanding what's going on ("console and shipify admin isn't
  very much useful as of now");
- asked for ways to create things, not only the CLI and PRs ("we have less UI to set or create new
  things");
- asked for the obvious conveniences, like the model choice they asked for before ("notebook and
  console can be a lot improved in usage and convenience and differentiation");
- asked for an actual sweep with coverage, intuitive, simpler, robust, and "don't break anything".

Four read-only audits on 2026-10-03 (the GitHub ways in, the docs as a newcomer reads them, the
admin page and console, and test coverage) found why:
- **ADR 0027's docs list never named the forms or the bot's replies,** so no GitHub surface
  changed. No form, title or reply mentions recipes, the notebook or the console.
- **No doc answers "task, Repeat or recipe?"** in one place, and two disagree. `skills/recipes`
  turns a reminder into a forward; ADR 0027 says reminders stay Repeats. Price-watching is a Repeat
  in `tasks.md` and a check recipe in `recipes.md`.
- **One difference is written nowhere:** an agent recipe has no project checkout, so it can't open
  a PR. A Repeat's job can.
- **The model list went stale:** the forms offer Auto, Opus, Opus high and Sonnet;
  `executors.json` also has Fable and Haiku.
- **The console counts, it doesn't tell.** It shows how many runs, not which; the two selftest
  recipes as "active"; nothing about tasks that need you.
- **Bugs:**
  - A notebook page the owner opens (as `notebook.md` tells them to when one is full) starts an
    agent run, gets answered, and closes itself a day later, dropping out of the notebook.
  - The console marks the owner's own notebook pages as "left out", because it isn't given the
    owner's login.
  - The Question and New forms are recognised by their title, so editing the title turns a
    question into a change.
  - The Check a box form has no input field, and GitHub may not list a form without one.

## In one line
Nothing new to trust and nothing rebuilt: each thing gets a form and a phone title, every reply
points the way, one table answers "which one?" everywhere, and the console says in plain words what
ran, what's running, what's next and what needs you.

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| Renumbering form files changes nothing for open issues | `cli/lib/form-reader.ts:20`: a form's id is its file name without the number ("repeat" for 7-repeat.yml) |
| A box can write a note with no agent | `remember()` in `cli/commands/task/notebook.ts:58` takes notes and writes them; the agent only suggests them today |
| A title route with no agent fits the round | `ping` and the operations already do it (`cli/commands/task/round.ts:196-210`) |
| `task.yml` can skip notebook pages the way it skips the status issue | its `if` already excludes the `shipify-status` label (`task.yml:85`) |
| GitHub's New issue page can link out | `config.yml`'s `contact_links` (GitHub's issue template config) |
| The console can link to GitHub's form chooser without knowing file names | `https://github.com/<repo>/issues/new/choose` |
| Fable and Haiku run on the box | `executors.json` lists both since #49. **Checked first in the build:** a question with each on the box, its details naming the model |
| The console's new lists need no new GitHub reads | the admin audit: runs (up to 100 each, 7 days), each app's last 10 deploys and open tasks are read already (`console.ts:312-326`, `admin.ts:347`, `boxes.ts:244`). "Coming up" may need the status issue in `/api/console`: at most one more read, cached for 60 s |
| A GitHub form can't be filled in the GitHub app | `config.yml`'s note: the app opens blank issues, hence the titles |

## Options
- **A. Make what exists easy to find and use** (forms, titles, replies, the console's lists, the
  docs). Pros: small, nothing new to trust or key, easy to undo. Cons: Repeats and recipes stay two
  things, told apart by one table.
- **B. Merge Repeats into recipes.** Pros: one repeating thing. Cons: every repeat from the phone
  becomes a PR to merge. It reverses ADR 0013 and 0027's "Repeats stay the quick way from the
  phone", and it's a big rebuild.
- **C. A console that creates things,** writing through the door. Pros: one place. Cons: the console
  becomes a writer, which means a new trust path and keys; it's big. Its "New…" button, which opens
  GitHub's forms, gives most of it with none of that.

## Decision
Chosen **A**.

### 1. Which one? One table, everywhere
It goes in the README's Everyday use, `docs/tasks.md`, `docs/recipes.md`, the glossary and the
forms' descriptions, worded the same everywhere:

| | Task | Repeat | Recipe |
|---|---|---|---|
| For | one job, now | the same job on a schedule, set up from the phone | a reviewed job: on a schedule, or when something happens |
| Start it | a form or a title | the Repeat form, or "every Monday at 9, …" | the Recipe form or `recipe: …`; you merge its PR |
| AI used | yes (not release or ping) | a reminder: no; a job: every time | forward and check: no; agent: yes |
| Reacts to webhooks | no | no | yes |
| Opens PRs | yes | a job: yes | no |
| Changes in your tools | after your `yes` | after your `yes` | its file's list, without asking |
| Stop it | it closes when done | "stop repeating" | close its log, or remove the file |

The contradictions are settled:
- **Reminders stay Repeats** (ADR 0027 §7). `skills/recipes` and the playbook stop turning a
  reminder into a forward.
- **Watching a value** (a price, a page, a version) is a **check recipe**: it uses no AI. Use a
  Repeat job only when the answer is a PR.
- **Dependency updates** are a Repeat job, since they open a PR.
- **"Make this a recipe" on a Repeat** replies with the Recipe form's link, filled in from the
  Repeat (GitHub's forms take their fields from the link). The playbook stops expecting Shipify's
  checkout in a Repeat, since it doesn't have one.

### 2. A way in for everything: forms and titles
The New issue page, in order (form ids unchanged):

| # | Form | New | Phone title |
|---|---|---|---|
| 1 | Change an app or Shipify | | `<project>: …` |
| 2 | New project | | `new: …` |
| 3 | Ask a question | | `question: …` / `ask: …` |
| 4 | Repeat something | its description points to recipes | `repeat: …` |
| 5 | **Make a recipe** | **yes** | **`recipe: …`** |
| 6 | **Remember something** | **yes** | **`remember: …`** or **`remember <topic>: …`** |
| 7 | Release or take down | renumbered | `<app>: release` |
| 8 | Check a box | renumbered, one optional field | `ping` |

- **Make a recipe:** a task on Shipify itself.
  - **Fields:**
    - "What should happen", in plain words with when;
    - "How", which is one of: "Let Shipify choose", "Just tell me (no AI)", "Only when it changes
      (no AI)" or "Needs thinking (AI)";
    - the Model.
  - **The agent** writes the file (`ship recipe new`, then `recipe check`), puts the dry run's
    output in its reply, and opens the PR. Merging it turns the recipe on.
  - **A recipe with a webhook:** the reply names the one PC step (`ship hook new <name>`), since a
    hook's key never goes on GitHub.
  - **Something a recipe can't do,** such as opening PRs: the reply says so and offers a Repeat.
- **Remember something:** the box writes the note **with no agent**, in seconds, and replies with
  what it did, like "Noted under Preferences: short answers, in bullets". Then it closes the issue.
  - **Fields:** the note, and a topic, which is Preferences when left empty.
  - **From the phone:** `remember: …` goes under Preferences; `remember People: Ana is my
    designer` goes under People.
  - **What's refused:** the same as today (something that looks like a key, a full page, the same
    note twice), in the reply.
- **The Model field:** every form that runs the agent offers Auto, Fable, Opus, Opus high, Sonnet
  and Haiku. ADR 0025's test gains the reverse check: a model in `executors.json` that a form doesn't
  offer fails `pnpm verify`, naming the forms.
- **The page's links** (`config.yml`'s `contact_links`): "Your notebook" (the open issues labelled
  `notebook`), and "Task, Repeat or recipe?" (the table). `config.yml`'s comment lists every title,
  `try:`, `ask:` and `<app>: release` included.
- **Recognised by their form:** the Question and New forms are known by their form, not their
  title, so an edited title can't turn a question into a change.
- **Reserved names:** `recipe` and `remember` can't be project names, like `new` and `try`
  (`cli/lib/safety.ts`).

### 3. Replies that point the way
- **The status comment's help** mentions "remember …" and the Recipe form. It offers `publish`
  only when the task has a plan.
- **A Repeat's "Set:" reply** gets one line: "For a check that uses no AI, a webhook, or changes
  without asking, make it a recipe," with the link.
- **A recipe log's help** says `again` runs it, closing pauses it, and the Recipe form changes it.
- **Plain words:** "round", "act run" and "stops counting" go from what the bot says, and so do
  the internal names it shows (variable names, raw times).

### 4. The notebook, easier
- **Adding a note:** the Remember form and the `remember:` title (§2), besides "remember …" in any
  task.
- **Seeing your notes:**
  - the console lists each page's notes, folded, not just its first line;
  - the New issue page links to all pages.
- **A page you open yourself starts nothing:** `task.yml` skips issues labelled `notebook`, as it
  does the status issue. A comment on a page starts nothing either. To change a note, edit the
  page; the docs say so plainly.

### 5. The console tells the story (shipify-admin, its change doc)
Everything comes from what the Worker already reads (see Assumptions):
- **Needs attention** (the overview) also lists tasks waiting on you, failed tasks and offline
  boxes. The top sentence counts everything listed there, not only the apps.
- **Lately:** the last 10 runs in plain words ("#31 spotter: bigger margins · done · 2 h ago").
  Each links to its issue, not the Actions log.
- **Running now:** each task by its title, linking to its issue.
- **Coming up:** Repeats and recipes in one list, soonest first.
- **Latest deploys:** 5 rows across the apps.
- **A "New…" button** opens GitHub's form chooser, so the console stays read-only.
- **What each screen is for:** one line under each title. The overview answers "is everything
  OK?"; the console, "what Shipify runs for you". The back links use the same words on both
  screens.
- **Plain words:**
  - real plurals, not "(s)";
  - relative times;
  - "messages go to GitHub" instead of variable names;
  - the selftest recipes folded under "Tests";
  - a box's "Console" link renamed to "Cockpit".
- **The fix:** the console is given the owner's login, so their own notebook pages count.

### 6. Docs a newcomer can follow
- **The README:**
  - the table in §1;
  - a phone cheat sheet of the titles (the GitHub app shows the README);
  - the setup table with the door, and "walks the steps" made true;
  - the status lines brought up to date.
- **`docs/getting-started.md`:** "First things to try": `ping`, `question:`, a Repeat reminder,
  `remember:`, `recipe:`, `ship recipe run <name> --dry`.
- **"The page" becomes "the console"** in the 7 places left, `ship help` and `ship doctor`
  included.
- **The glossary:** round, trust and log are explained. "Record" means GitHub only; a task's own
  state is "its status comment". Scheduled recipes are added to the timer and due-run entries,
  and to `docs/watch.md`.
- **Stale text trimmed:**
  - `tasks.md`'s "one task at a time per box", the future work that now exists, and its console
    line;
  - `door.md`'s done step 1;
  - `design.md`'s rule 2, which gains the door;
  - `tour.md`'s skill and doc lists;
  - `context.md`'s contradictions;
  - `task.ts`'s "errand form";
  - `tasks.md:78` ("No form asks for a model").
- **The ADR index:** 0027 accepted, 0028 added.
- **`ship help`:** grouped (tasks, recipes and the door, setup), with one line saying tasks are
  issues, Repeats come from the Repeat form and recipes are files.

### 7. Coverage
New tests for everything above:
- each form and title's route, including `remember` with and without a topic, and its refusals;
- `recipe:`;
- an edited Question title;
- `task.yml` skipping notebook pages (`tests/workflows.test.ts`);
- the forms against `executors.json`, both ways;
- every form being valid for GitHub (at least one input field, unique ids, labels);
- the reply texts.

The admin's new lists get unit tests, and the console's end-to-end tests add these states:
- loading, error and Retry;
- empty;
- a failing recipe;
- the door open;
- the owner's own notebook page.

**The gaps the test-coverage audit found** in ADR 0027's code come next. It measured the lines the
tests reach: about 80% in the box's code (`task/recipes.ts` 82%, `file.ts` 76%, `notebook.ts`
96%), but 7–28% in the PC's commands (`setup`, `door`, `recipe run`, `selftest`).

**Fixed first, in their own PR** (a fix, so no plan needed). These are security holes. None of them
can be reached today, since no recipe has a standing approval and the Notion keys aren't set:
- **The agent can rewrite its own approval.** The approval files (`approved.json`, `acted.jsonl`)
  and the tool settings sit in `workspace/.tasks/<n>/`, inside the folder the agent can edit. They
  move outside it, and the agent is refused edits there.
- **The guard lets a call through when it fails.** A missing or broken file exits 1, and Claude
  Code blocks only on 2. Every failure now blocks.
- **A standing approval entry with no fixed field** (`input: {}`, or `null` at run time) allows
  every call. Only `recipe check` refused it; the run refuses it too.
- **A signal's trust is read from its text:** any channel other than `hook` counts as yours. It
  is taken from the sealed envelope instead.
- **An issue GraphQL can't read** (`issue: null`) comes back with no editor, and a door task is
  trusted. It's refused.

**Tests in this build,** highest risk first:
- notebook pages opened by the agent's own bot, and with `SHIPIFY_OWNER` unset;
- a signal while no box is online (`--where github`): the round starts when a box returns, and
  the waiting label stays when a start fails;
- nothing starts twice: a task delivered again after it started, and `due` twice;
- the pause, quiet and handover paths: three failures pause a recipe, plus a quiet answer, a check's
  handover, a closed log, `again`, a reopen, and a deleted recipe's log closing;
- a message's files: the caps, the fetch's environment, and cleaned file names;
- a named task refused: a stranger's issue, a PR, the status issue, a GitHub error;
- the PC's commands:
  - `door rotate` never prints the key;
  - `recipe run` without `--yes` makes no call;
  - `door check` against a stubbed door;
- `ship setup`: each step's check, and that the hidden prompt never echoes a key;
- `selftest`: an unknown part is refused, and `recipes` without a door key skips without failing;
- the record's contract covers `pages()` and `writers()`;
- the fake GitHub sets `updated_at` and the editor when something is edited, so edited cases
  are tested for real.

**Clock-bound tests** are fixed:
- "a changed schedule" fails for an hour every day (07:00–08:00 IST, when the next hourly time
  and the next 08:00 coincide);
- two tests dated 2026-01-01 fail on a box whose clock is behind;
- a tool's 20 s start time trips under load.

## Edge cases
- **A note that looks like a key:** it's refused and the reply says why. Nothing is written, and the
  issue closes.
- **The same note twice:** "Already noted under Preferences".
- **A full page:** the reply says to split it, as today.
- **`remember:` with nothing after it:** the reply asks for the note, and nothing is written.
- **A topic that's long or odd:** the topic follows the notebook's rule for topics (a few plain
  words); otherwise it goes under Preferences, and the reply says so.
- **`recipe:` asking for something recipes can't do:** the reply says so and offers a Repeat or a
  task, with no PR.
- **A recipe that would need a tool's keys that aren't set:** `recipe check` names the missing tool.
  The PR still opens, and its summary says what to set (`ship setup`).
- **Open issues from the renumbered forms:** nothing changes, since a form's id has no number.
- **A notebook page opened or commented on:** nothing runs. To change a note, edit the page; the
  docs and the console's link say so.
- **The console with nothing yet:** "Nothing ran in the last 7 days" and "Nothing coming up",
  each with the one thing to try.
- **A model the box's agent can't use:** it runs on Auto and says why (ADR 0025).
- **A door-filed task that says `remember:`** (a chat, later): it's the owner's, so it's written. A
  signal never writes the notebook (as today).

## Setup
Nothing to set up. After the merge, the New issue page shows the 8 forms. The build checks the page
lists all of them; the owner's one look confirms it.

## Docs and clean-up
- **Updated:**
  - `README.md`;
  - `docs/getting-started.md`, `tasks.md`, `recipes.md`, `notebook.md`, `glossary.md`,
    `watch.md`, `design.md`, `tour.md`, `context.md`, `door.md`;
  - `docs/adr/README.md`;
  - `playbooks/task.md` (recipes from a Repeat, the remember route, the Recipe form's task);
  - `skills/recipes/SKILL.md`;
  - `guides/recipe-template.md` (the "How" words);
  - `AGENTS.md` (the asks table: "remember", the Recipe form);
  - `.github/ISSUE_TEMPLATE/*`;
  - `cli/cli.ts` (`ship help`);
  - `CHANGELOG.md`.
- **shipify-admin:** `docs/spec.md`, its change doc, `CHANGELOG.md`.
- **Removed:** the reminder-to-forward advice, the claim that a Repeat has Shipify's checkout, the
  stale lines in §6, and the duplicate setup steps in `getting-started.md` (it links to `setup.md`
  instead).

## Build
Two PRs, after this one is merged:
1. **Shipify:**
   - the forms and titles, the remember route, the replies, `task.yml`'s skip and the docs;
   - the tests in §7, with the coverage gaps;
   - `pnpm verify` and `pnpm test:golden`.

   After the merge, checked live:
   - the New issue page shows 8 forms;
   - `remember: test note` is noted, then removed by editing the page;
   - a `recipe:` opens a PR;
   - a question each on Fable and Haiku;
   - `ship selftest` passes.
2. **shipify-admin (1.11.0):**
   - its change doc and §5;
   - the unit and end-to-end tests;
   - `make verify`.

   After the deploy, checked on the console: Lately, Coming up, Needs attention with a task
   waiting on you, and the New… button.

## Consequences
- **Easier:**
  - every feature has a form, a phone title and a line in the replies;
  - one table answers "which one?";
  - the console says what happened;
  - notes take seconds and no AI.
- **Harder:** two more forms to keep. `recipe` and `remember` are reserved as project names.
- **Unchanged:** the trust rules, keys, the watch, the door and every existing route.

## Every ask, covered

| The owner's ask | Where |
|---|---|
| "tasks is basically replaced by recipes?" | §1: the table, everywhere |
| "why isn't form and flows updated, missing on issues" | §2, §3 |
| "less UI to set or create new things" | §2: the forms and titles; §5: New… |
| "notebook … improved in usage and convenience" | §4 |
| "console … isn't very much useful … to understand what's going on" | §5 |
| "differentiation" | §1, §5 (what each screen is for) |
| "model selection … obvious ones" | §2: every model, checked both ways |
| "simple comparison tables" | §1 |
| "actual sweep … coverage" | the four audits (Context), §7 |
| "intuitive, simpler, robust, don't break anything" | Option A; §3; Edge cases; ids unchanged; no new reads, keys or trust |

## Confirmation
- `pnpm verify` holds each form to GitHub's rules and to `executors.json`, and each title to its
  route.
- `tests/workflows.test.ts` checks `task.yml` skips notebook pages.
- The admin's unit and end-to-end tests cover each console state.
- `ship selftest` still passes 14 of 14.
