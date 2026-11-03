---
status: accepted (merged #634 on 2026-11-01, with build part 0, the web chat's fixes, built in it; task #631) and built (parts 1 to 8 in one PR after the owner's `go` of 2026-11-01, with the clean-up design of the second doc PR in it); see [As built](#as-built-2026-11-02-parts-1-to-8-in-one-pr-on-task-631). From the owner's words of 2026-11-01 and 2026-11-02. Amended by 0070 (a project's main page has Now, the Map and the box's Log; a Sources page; Keep on page and "check the project"; a page isn't written over when it changed since the run read it; search by meaning; one next step on a project's page; a projects line in the weekly digest; `clean start`; the process is Capture, Keep, Think, Ship, Share).
date: 2026-11-01
amends: 0036 (the web chat's files go to R2, kept while their chat or project is open and 30 days after, not to KV for 7 days), 0040 (no task closes after a quiet day but a split's part: a quiet one folds in the list, and a chat outside a project closes after 30 quiet days; close, reopen, stop and stop repeating from a button show no message), 0041 (the handoff shown as Progress, longer), 0047 (the notebook's three reaches: always, a project's, on demand), 0065 (a project is one you make, or a repo as today), 0066 (a project is a parent that never closes with its chats, and its `go` starts only split parts)
---

# 0069: Projects that keep and share, files in R2, and an easier web chat

## The plan in short

Twelve things, built on what Shipify has: GitHub issues, the notebook's rules, sub-issues, the R2
storage the account has for Drop, and the Drop tool. No new service or key.

1. **The web chat's drag and drop, finished.** It works today on an open chat's box only, with no
   cue. A drop anywhere on the page attaches, with a "Drop to attach" cue; on the list or a
   project's page it starts a chat there. A file from Files drags into the box; a long paste
   becomes a text file.
2. **No close after a quiet day, and simple actions are buttons.** A task you leave folds into
   **Quiet** in the list, and comes back when anyone writes. A project and its chats never close
   by themselves; a chat outside a project closes after 30 quiet days, and writing on it opens it
   again. Close, reopen, stop, stop repeating and the model are buttons that show no message in
   the thread.
3. **Projects you make.** A project is an issue `Project: <name>` with a brief. Its chats are
   its sub-issues; "split it" in its thread makes ordered parts, as ADR 0066 does. It needs no
   repo: a product idea or research works the same way. It can also own repos, so one memory
   covers a product's code and everything around it (section 15).
4. **A project's pages: its memory and docs, so Notion is optional.** A project's pages are
   notebook pages labelled `library` and `project:<name>`, not sub-issues (`Notebook: <name>` and
   more). Every
   run in the project gets them, under the notebook's rules; no other run does. You edit them in
   the web chat or on GitHub.
5. **An inbox for what you find.** A project's Inbox page takes words, links and screenshots as
   comments, with no run. "Collate the inbox" folds them into the project's page, each fact with
   its source.
6. **Exports.** A project (or everything) downloads as a zip the browser makes, with no run:
   Markdown, files, `ALL.md` for another agent, `project.json` for a script. To share it, the
   zip goes into a message, "share this as a drop".
7. **A desk on any device.** The first screen shows what needs you, what works, and your
   projects, from GitHub: a new phone or PC shows the same at once.
8. **Long threads stay easy.** A run's handoff, written anyway, shows as the task's **Progress**;
   a long thread's run gets it and the newest messages whole, the rest on demand.
9. **The web chat's fixes** from a sweep of its code, first of all: a long thread can skip a
   message; a project's tab row goes; the page and the edge get faster.
10. **The Library and a Journal.** The notebook gets three reaches: always (Preferences), a
    project's, and on demand (a Journal, idea dumps, old research), so a page costs a run nothing
    until it's needed. `jot: …` adds a thought with no run; "organize my journal" sorts it when you
    ask. A project's page starts with a **Map** of what's where, and each fact cites its source.
11. **A process to follow:** capture, organize, work, leave it, look, take out: one page for you,
    one skill for the runs.
12. **Files in R2, kept as long as their work.** Every file you send goes to an R2 bucket: 10 GB
    free, no daily write limit to hit, no fee to download. A file stays while its chat is open, or
    its project; the box's weekly clean-up deletes it 30 days after that closes, so storage stays
    small with nothing to manage. What runs make stays on GitHub's `shipify-files` branch, as now.
    A drop is a copy to share, in Drop's own bucket, with its own expiry. KV keeps only small
    settings.

**The whole flow**, next, puts it together in one picture. Section 12 lists Shipify's gaps
against these asks. Section 13 says where each thing lives and how a run reads it: **a project is
issues on shipify, never a repo**. Section 14 is a stress test at the planned sizes, with
Shipify's real code; four limits failed, and the design is changed for them. Section 15 covers
how big it gets, what it costs, lock-in, reliability, and a project that owns repos. Section 16 is
files in R2, and which of the three file stores holds what. The **Critique** says what's
realistic; the **Review** checks each part against the code (four times: 14 problems, then 13,
then 9 about files and the watch, then 8 about what grows, each handled) and gives the order to
build.

## The whole flow

```
 You: phone, PC, Telegram
   │  chat · jot · add · buttons (close, reopen, stop, stop repeating, model)
   ▼
 Web chat + door (Cloudflare Worker, free) ──files──► R2 bucket: your files, while their chat is open
   │  a button shows no message in the thread;       KV: small settings only (model, devices)
   │  jot and add save with no run                   Drop (its own bucket): a copy you share, with its expiry
   ▼
 GitHub: your shipify repo (the truth: free, readable, yours); its shipify-files branch: what runs make
   ├─ Notebook: Preferences, People          ← every run reads these (small)
   ├─ Journal 2026-11, idea dumps (library)  ← no run reads them until asked
   ├─ Project: shop  (Repos: shop-api, shop-web)
   │    ├─ Notebook: shop        (label project:shop) its Map, then facts, each cited ← every run in shop
   │    ├─ Notebook: shop-inbox  (label project:shop) finds waiting to be collated
   │    ├─ chat (sub-issue): research payment providers → an answer, its Progress
   │    ├─ chat (sub-issue): shop-web: add login        → a PR on shop-web
   │    └─ chat (sub-issue): checkout rework → "split it" → parts → a PR each
   └─ chats outside a project (General), as today
   ▲
   │ a run reads 2–4 issues and the files it needs, then writes its reply, pages or PR
 Your Pi: one run per message you send in a chat; no other agent runs
   └─ its weekly clean-up (as today, no agent): a closed chat's files go 30 days after it closes;
      a chat outside a project closes after 30 quiet days
```

| Step | You | What happens | Runs |
|---|---|---|---|
| **Capture** | `jot: …`; `add shop: …`, a drop, a paste, a screenshot | a dated line in the Journal; an Inbox item; the file in R2 | none |
| **Organize** | "organize my journal"; "collate the inbox" | ideas grouped, projects suggested; the project's page gets the facts, each with its source | one, when you ask |
| **Work** | a chat in the project; "split it" for a big job | an answer or a PR; the chat's Progress grows; a long thread's prompt stays small | one per message |
| **Leave it** | nothing | a quiet chat folds into **Quiet**. A project and its chats stay open, with their files. A chat outside a project closes after 30 quiet days (write on it to open it), and a closed chat's files go 30 days after it closes | none: the weekly clean-up, as today |
| **Look** | the Desk; a project's page and its Map; Ctrl+K; GitHub's search | — | none |
| **Take out** | **Export**; "share this as a drop" | a zip in the browser; a Drop link | none; one for a drop |

How it grows: day 1, chat as today. As finds pile up, `jot` and `add` take them, free. When a topic
keeps coming back, `project: <name>` (or "organize my journal" suggests one), and **Move to
project** brings its chats in. When it becomes code, its brief names its repos. In a year: a few
projects, tens of chats each, a Journal page a month. R2 holds the files of open work, and of
chats closed in the last month or two: it grows with what's open, not with time. What a run reads
stays about the same size throughout (section 14). No agent runs unless you ask; the weekly
clean-up, which runs today, does the rest with no agent.

## The owner's asks (task #631, 2026-11-01)

- "can we support drag and drop and some more convenient and user friendly practices on shipify
  web chat" (the title); "Drag and drop is already present i think"
- "i can make the issue as keep it active somehow simply from web ui it should stay alive not auto
  close for long term"
- "like sub tasks i want sub tasks or something to share memory of something i can create a
  project like a product idea research project i create a project group or something from web i
  can put and share project memory start and such divide well"; "right now projects dont make much
  sense"
- "we dont even need notion we can manage and track our notes per task or project manage all md
  and notion task info management well here … strong role rules and architecture do some research
  and ideas we can look into"
- "we sometimes struggle with managing all info like found info notes screenshots … collate look
  at all to get answered from agent … grow as we need update the knowledge … cheap no extra
  resource"
- "export in zip or all info as we collected to other agents or systems … 2 types of exports we can
  download or for sharing drop files"
- "working from phone or single pc any pc starts become easy and well to handle navigate or work
  with like a workdesk"
- "Do review all the asks check properly and feasible solution which I can consider"
- "check tasks 632 and 633 … they will be long open i will add more info docs and some new research
  … it will get too big for me to manage or search"; "resource efficient best ideas existing
  setup"; "a project library progress doc or something which can continue or worked on for long
  efficiently no costing extra tokens"; "Check with critique and tell realistically what's
  possible"; "do sweep on some web issues or something for better if we missed anything"
- "journal notebook based some idea dumps thinking thoughts and idea organizing journals … so
  notion isn't even needed anymore"; "We have to design a process in the new setup which we can
  then follow"; "project can share efficiently knows all is organized where to tell and reference
  and what we stored cited looked into … are we capable here to build something like this"; "Check
  for existing gaps in shipify with our given requirements here what can be evolved into something
  better"
- Later the same day: "any research i am calling project or collating will become a repo to read
  or how … add that in PR with proper stress test"; "is it scalable … how big and limits"; "storage
  and such on cloudflare costs … covered all costs angles"; "should not use something which will
  block us at critical junctures"; "it can be attached to some repo … under one project memory";
  "think of reliability"; "remove tabs … closed issues tabs and such occupy"; "sweep of making
  things performant"; "i am not comfortable saving in kv these files … it can get full … using R2
  … best cheapest simple resources"; "for simple things repeated we dont need message in web chat
  or something like keep or stop it should just happen simply cleanly"; "do the proper sweep of
  the well designed things and i want to see the overall flow"; "cover all well handled fixes even
  the smaller ones in the same … complete today"; "shipify files … has nice organization and maybe
  some good free storage … do whats best and recommended"
- The next day (2026-11-02): "How does drop and this share and use storage properly
  differentiated"; "Would the default of R2 holding files from webchat … not using kv will work";
  "it should be seamless like a flow"; "Not complicate it"; "cost optimization and all run
  efficiency so not everything goes out of control quickly … no cognitive load cleanup and such
  handling in closed tasks"; "With kv we used to cleanup … will this keep growing endlessly … how
  are we thinking of reducing cognitive load for managing the setup simply automatically"

## What was found (checked 2026-11-01, `main` at `6522121`)

| Fact | Where |
|---|---|
| A drop attaches only on an open chat's or New chat's box (`o.root`), with no cue | `compose.js` 385–386 |
| Every answered task closes after a quiet day; a parent with open sub-issues and a repeat are spared. The due run closes on `st.closes` alone, with the issue's labels at hand | `decide.ts` 2558 (and 1740, 1830, 2045); `due.ts` 169–178 |
| `close` and `reopen` are done by the door at once (it PATCHes state and labels); it has no sub-issue call and no body edit | `door-in.ts` 603–630 |
| GitHub's own "pinned issues" are used for the status task, so "pin" is taken | `github.ts` 285, 596; `status-issue.ts` |
| A title `idea-x: …` or `project: …` that names no repo reads as a change to a repo of that name | `task.ts` `parseTitle` |
| The family (parent, siblings) is read only for a task labelled `sub-task` or with sub-issues; at most 50 sub-issues; the parent's body is cut to 2,000 characters; it has no editor field | `snapshot.ts` 308; `github.ts` 602; `parts.ts` 257 |
| A part's close closes its parent when every sub-issue is closed; `go` starts every open sub-issue that never ran | `parts.ts` 128, 202–214 |
| The web list folds a child under its parent only with the `sub-task` label and `Part of #n` as the body's first line; the door's hidden from-line must also be first | `reads.ts` 155–157; `lines.ts` 88 |
| Notebook pages start no run (`task.yml` skips the label), are trusted only when you or a run last wrote them, hold 60,000 characters, and reach a prompt whole up to 16 KB, then by title | `task.yml` 176; `notebook.ts` 42–56; `docs/notebook.md` |
| A repo's own page reaches only runs on that repo | `notebook.ts` `pagesFor` |
| `remember <topic>: …` is written by a box run with no agent; its topic has no spaces | `decide.ts` 306, 556 |
| A run gets the files of its own task's new comments, at most 5; it shares at most 10 | `run.ts` 442; `shapes.ts` 21, 24 |
| Web chat files live in KV, 10 MB each, for 7 days; dropping the expiry keeps one. KV's free plan: 1 GB and 1,000 writes a day, shared with uploads, model picks and devices; past a limit, the call fails | `files.ts` 22, 45; ADR 0036; Cloudflare's KV pricing |
| Telegram's files aren't in KV | `door-in.ts` 645 |
| R2 is on the account already: Drop keeps its files in a private bucket, and the deploy token has **Workers R2 Storage: Edit** | `plans/drop.plan.md`; `docs/setup.md` 260 |
| The web chat's Stop, Close and Stop repeating buttons send the word as your message (a comment), and a run or the door answers in the thread ("Stopped, as you asked.") | `app.js` 250, 606–615; `decide.ts` 2246; `door-in.ts` 603–640 |
| A Drop `publish` is pre-approved when the run read nothing from outside | `skills/drop`; `tools.json` |
| The page is at 40.8 of its 42 KB as sent; `workspace.js` 7.7 of 9 KB; a part loaded when needed gets its own budget, as `plan.js` did | `tests/edge/web/extension.test.ts` |
| A browser zips with no library: `CompressionStream("deflate-raw")` | MDN |
| GitHub allows 100 sub-issues per parent and 8 levels | GitHub's docs, "Adding sub-issues" |
| The notebook read takes the oldest 100 open pages with the `notebook` label, every body whole, in one call | `github.ts` 442–452 |
| The Files view lists KV once (up to 1,000 keys, in key order) and keeps the newest 200 of those | `files.ts` 89–104 |

## 1. Drag and drop, finished

| What | How | Where |
|---|---|---|
| **Drop anywhere** | One `dragenter`/`drop` pair on the page; a full-page cue "Drop to attach" (or "Files aren't set up"). On a chat: attached, as now. On the list: a new chat. On a project's page: a new chat in it | page, ~0.4 KB |
| **Drag a file in from Files** | Rows in Files and the doc pane are `draggable` with their ref; a drop on the box attaches as **Ask about this** does | `workspace.js` |
| **A long paste becomes a file** | Over the limit, the hint offers **Attach as a file** (`message-<time>.txt`) | page, ~0.2 KB |
| **Share on a file** | In Files and on a message's file, beside **Ask about this**: attaches it and fills the box with "share this as a drop"; Send makes the drop (one short run, section 16) | `workspace.js` |

One rule, so it flows: **a drop never sends.** The file is saved in R2 at once and waits in the
box you dropped it on; nothing runs until you press Send. On a project's page that box has **Add**
(to its Inbox, no run, section 5) and **Send** (a new chat in it). You never choose a store:
Shipify picks it by who made the file (section 16).

## 2. No close after a quiet day, and simple actions are buttons

The asks: "keep it active … it should stay alive not auto close"; then "for simple things repeated
we dont need message in web chat or something like keep or stop it should just happen simply
cleanly"; then "will this keep growing endlessly … reducing cognitive load for managing the setup
simply automatically". So no `keep` word or label: the close after a quiet day goes, what you
keep for long lives in a project, a chat outside one closes after 30 quiet days, and the everyday
actions write nothing in the thread.

- **No close after a quiet day.** An answered task stays open. One with no new word for 7 days
  folds into **Quiet** at the foot of the list, and comes back up when anyone writes on it. You
  close it when you're done with it. A merged `closes` PR and **not planned** still close it, as now. The list
  reads the 50 open tasks updated last (`reads.ts` 260), so with nothing closing, quiet ones soon
  fall past that page: **Quiet** shows those on it, and opening it reads the next pages (50 a
  call), as **Earlier** does. The due run's quiet close goes for every task but a split's part:
  an answered `sub-task` still closes a day later, since its close starts the parts that wait for
  it and its parent closes with its parts (`due.ts` 169–175). Due lists only answered `sub-task`
  tasks (`due.ts` 71–77 lists every answered one today, and reads its comments), so its reads
  don't grow as Quiet does. The status line "Closes by itself …" (`task.ts` 633) and due's
  "closes if quiet" entry go with it.
- **A chat outside a project closes after 30 quiet days.** The box's weekly clean-up (it runs
  today, `watch.ts` 247) closes, as **completed**, an open chat with no word or change for 30
  days (your pick of 2026-11-02, "30 days or less also works"; 90 was proposed first), when
  it's in no project, has no open PR, no repeat or errand (`repeats`, `waiting`) and no open parts, and isn't a project, a page, a split's part or a task that waits on you (`needs
  you`: a question, or a `new:` task's plan PR, which doesn't close it). Never as **not planned**: that
  closes the task's PRs (`decide.ts` 1285, 1405). Its status line says why ("Closed after 30 quiet
  days: write on it to open it again"), and writing on it opens it again, as any closed task
  (`decide.ts` 458). It starts no job: the close isn't yours or the door's, and nothing waits on
  the task (`task.yml` 165–176). A project and its chats never close this way: what you keep for
  long goes in a project (#632 and #633 should). Its files go 30 days after the close (section
  16). One GraphQL read finds them (open issues not updated for 30 days, less the labels it never
  closes, oldest first, with their labels, parent, open parts and open PRs), once a week however
  many boxes (section 15).
- **Buttons that say nothing in the thread.** Close, Reopen, Stop the run, Stop repeating and the
  model pick work as now underneath: the door acts at once (close, reopen) and writes the word,
  and the box reads it (a run checks for `stop` each minute, `think.ts` 519–536; a repeat's end
  is in the status comment). What changes is what you see: the word is written with a `button`
  mark in its hidden from-line, and the web chat doesn't show a marked word. Close and reopen are
  written as settings, which start no run (`door-in.ts` 637, `task.yml` 168), so no run answers
  them: the web chat shows them from the issue's own state, a faint "Closed · 13:40" from
  `closed_at`. Stop and Stop repeating are answered by a run today with a reply (`decide.ts`
  2242: what was kept on the branch); that answer moves to a new **Last action** line in the
  status comment (`task.ts` 619–645), not a new reply. No new read or permission.
- **Typed words still work** from Telegram or a typed chat (`close`, `stop`), and are shown, as
  today.

| Decide | Recommended | Instead |
|---|---|---|
| Quiet tasks | Folded into **Quiet** after 7 days. A project and its chats never close by themselves. A chat outside a project quiet 30 days (your pick, 2026-11-02; 90 was proposed first), with no open PR, repeat or open part, is closed as completed by the weekly clean-up; its status line says why, and writing opens it again. Its files go 30 days after the close. A split's part still closes a day after it's answered | Never closed for quiet: open chats keep their files, ~1 GB a year at 10 screenshots a day, and the list's Quiet only grows. Or a `keep` word and label per task, with the close after a quiet day kept: one more thing to remember |
| Close, stop, reopen from the web chat | A button; its word marked and hidden; the answer in the status line | As now: your word and a reply in the thread; or a `stop` label, which a working run doesn't read today (a new read each minute) |

## 3. Projects you make

| | A. A parent issue, chats as sub-issues (recommended) | B. A name in each title | C. GitHub Projects (boards) |
|---|---|---|---|
| Chats | Sub-issues: GitHub shows the tree | Every title starts with the name: easy to forget; reads as a repo today | Board items |
| Divide the work | "split it" in its thread: ADR 0066's parts | A separate parent | None |
| New | A reserved title word, the door's sub-issue call, the family read for its chats | Title parsing for names that aren't repos | A new permission and API |

How it works (A):

- **Make one:** **New project** in the web chat (a name, a line on what it's for), or `project:
  <name>` from any chat. `project` becomes a reserved word like `ask` and `new` (a repo named
  `project` is named `owner/project`). The door opens `Project: <name>`, labelled `project`, its
  body the brief (with `Repos: …` when it owns repos, section 15); no run. A name is lowercase letters, digits and dashes, as a repo's,
  so `remember <name>: …` works with it. `task.yml` starts a job on every opened or edited issue
  (lines 19, 165–176), so "no run" takes two guards, as for `library` (section 10): the box ends
  an opened or edited `project` with no agent, and a second `task.yml` line you add skips it, so
  no job starts. A comment in the project's thread still starts a run (a collate, a question).
- **Its chats:** **New chat here** opens the issue with the hidden from-line, then `Part of #<n>`,
  and links it as a sub-issue (one more call). The two "first line" rules become "the first line
  after the from-line". A chat already open moves in with **Move to project**: the door links it
  and adds an `in-project` label, with no body edit, since an edit would start a run and end a
  stay (`task.yml` runs on `edited`; a label starts nothing). Only chats are sub-issues (never
  pages), so a project holds 100: at 100, **New chat here** says it's full and offers a second
  project. Nothing is unlinked.
- **A chat's run gets the family** when its body has `Part of #n` or it has `in-project` (not
  only with the `sub-task`
  label): the project's brief, its other chats and their states, and the project's pages (section
  4). Its PR is `closes`: chats don't wait for each other.
- **Split in a project:** its parts are labelled `sub-task`, and `go` starts only those, never a
  chat or a page. The family read starts at the issue's parent (`github.ts` 501, `parent ?? i`),
  so for a chat in a project it would return the project and never the chat's own parts: `go` in
  the chat would start nothing (`parts.ts` 44–47), and the chat would count as a part, so "split
  it" would be refused (`decide.ts` 2755). So the family read returns both levels, the parent
  above and the issue's own sub-issues below, and an issue is a part only with the `sub-task`
  label.
- **A project isn't a split parent.** Today any issue with sub-issues is one: a run in its thread
  is told "your PR here is part-of" and its `closes` is changed to `part-of` (`parts.ts` 231–240,
  `decide.ts` 2398), and the web chat gives it a Plan card whose **Start all ready** sends `go`,
  with every reopened chat counted as ready (`reads.ts` 162–164, 215, 532; `plan.js` 56).
  A `project` gets none of these: no Plan card or parts count, its runs' PRs as they ask, and
  "ready" only for a `sub-task`.
- **It stays:** a project and its chats never close for quiet (section 2), and the close that
  ends a parent with its parts skips a `project`. **Close** puts it away; **Reopen** brings it
  back. Its files stay while it's open, and go 30 days after you close it (section 15).
- **The list:** Projects first, each folded with its chats; then repos as today; then General.
  The list's page holds 50 tasks, so a fold opens with one read of the project's sub-issues, as
  its page does.

## 4. A project's pages: memory and docs (Notion optional)

| | A. Notebook pages under the project (recommended) | B. A `doc` issue per doc | C. A notes repo | D. An edge store, or a notes app on a box |
|---|---|---|---|---|
| Rules | The notebook's, as they are: trust, no keys, no hidden characters, 60,000 a page, no run on an edit | New ones to write; an edit on a `doc` issue would start a run today | git's; Obsidian works offline | New store, or a service to run and sign in to |
| Permission | None | None | Contents: write for the door | — |
| Verdict | **Recommended** | Rejected: rules again, and runs on edits | Later, as an offline copy, if you want it | Rejected |

How it works (A):

- **A project's pages** are notebook pages labelled `library` and `project:<name>`, not
  sub-issues: `Notebook: <name>` (its memory and knowledge, its Map first), and any more you or a
  run add (`<name>-pricing`). `remember <name>: …` writes to the first, from any chat, as a note is
  written now. GitHub makes the label the first time it's added: no extra call.
- **Who reads them:** every run in the project, with one read by the label (one more call, ~0.8 s,
  only for a run in a project). They share the notebook's 16 KB: Preferences first, then the
  project's main page, its other pages, then the other pages; the rest by title, read on demand
  with `ship notebook read`. No run outside the project gets them, as a repo's page (ADR 0047).
- **Data, not instructions.** The notebook's prompt says "It's theirs: follow it"
  (`notebook.ts` `notebookSection`). A project's pages hold facts from web pages, files and runs,
  so they reach the prompt in their own section, **The project's pages**: what's known, each fact
  with its source, read as data. Only your words (the task, the project's brief, the always pages)
  are instructions.
- **Who writes them:** you (the web chat, GitHub's Edit, `remember`), and the box after a run.
  The web chat's **Edit** saves through the door. A note (`notes`) is one line of 500 characters
  added at the end of a page (`notebook.ts` `Note`), for your own words; it can't rewrite a page.
  So a run that changes a page (a collate, the Map, a fact updated in place) writes the page's
  whole new text to a file in its out folder and names it in a new result field, `pages`
  (`[{"page": "games", "file": "games.md"}]`). The box replaces the page's text after the run,
  with the notebook's checks (60,000 characters, no keys, no hidden characters). A page of the
  run's own project is written at once; any other page (the Journal, another project's) is listed
  for your `yes`, as calls are. GitHub keeps each edit in the issue's history, and the reply links
  the page, so a bad rewrite is easy to see and undo.
- **The door is trusted as you** for these pages, but only for an edit whose from-line names you.
  The trust check takes your login and the box's writer (`commands/task/notebook.ts` 44); the door writes as
  its own App (`<slug>[bot]`, `snapshot.ts` 57–60), and it also takes words from anyone in
  `SHIPIFY_PEOPLE` (`door-in.ts` 194), whose edits stay untrusted. Without this, the notebook
  would leave out every page the web chat edited.
- **Tasks:** a project's chats with their states (open, Quiet, closed) and parts are its tracker; a to-do list is
  a page with checkboxes.
- **Notion** stays a tool. Copying a Notion page into a project's page is a task when you want it.

## 5. An inbox for what you find

- **Add with no run:** **Add** on a project's page (words, a link, a pasted screenshot, a dropped
  file), or `add <name>: …` from any chat. The door writes it as a comment on the project's Inbox
  page (`Notebook: <name>-inbox`): a notebook page, so no run starts. Files dropped together go in
  one comment, as GitHub allows 80 new comments a minute (section 14).
- **Files kept:** an Inbox file goes to R2, as every file does, and stays while the project is
  open (section 16). From Telegram, words and links only at first: its files aren't stored by
  the edge.
- **Collate when you ask:** "collate the inbox" in the project's thread. The box hands the run the
  new items and their files (new: today a run gets only its own task's files, 5 at most, so a
  collate takes them in batches of 5). The run writes the project page's new text in `pages`
  (section 4), each fact with its source; the box writes it and marks the items folded. A repeat can do it
  weekly, if you set one.
- **Ask and look:** any chat in the project answers from its pages; Ctrl+K and GitHub's search
  find words.

| Decide | Recommended | Instead |
|---|---|---|
| Items | Comments on the Inbox page, by you or the door | Comments on the project's thread: each would start a run |
| Its files | R2, kept while the project is open (section 16): 10 GB free, about 50,000 screenshots of 200 KB | KV: 1 GB and 1,000 writes a day, failing when full; GitHub's issue images (no API) |
| Collating | When you ask, or a repeat you set | After each item: a run per screenshot |

## 6. Exports

One folder, two ways out:

```
<project>/
  README.md     what's here, when, the brief
  ALL.md        everything in one Markdown file, for another agent
  pages/        the project's pages, <topic>.md
  inbox.md      the Inbox's items, dated, files named
  chats/        each chat as Markdown (when ticked)
  files/        the Inbox's files and the chats' files
  project.json  the same as a list, for a script
```

- **Download:** **Export** on a project's page, **Export everything** on Files. The browser builds
  the zip (`export.js`, loaded on first use, its own 2 KB budget). No run. It says the size first.
- **Share:** the zip attached to a message, "share this as a drop": one short run proposes Drop's
  pre-approved `publish`, naming the zip by its ref, and the box gives Drop the zip from R2, with
  no copy on GitHub (section 16). Only you can open it, for 7 days, unless you say otherwise. A
  zip over 100 MB (one upload's limit, section 16) is downloaded instead.

## 7. A desk on any device

- What's there: an installable app (PWA) on phone and PC; shares from other apps; sign-in by
  Cloudflare Access's email code; tabs at a phone's foot (Tasks, Repeats, Notebook, Files, Setup).
  Folds, the pane's width and drafts are kept per device. A project's row of chat tabs goes
  (section 9).
- **The Desk** is the first screen: **Needs you**, **Working**, your **Projects** with
  their open chats, and the pages opened last; the box to write in at its foot. Drawn from the
  list and menu the page reads already: no new call (a project's Inbox shows on its own page).
  Every device shows the same.
- **On a phone,** the foot's tabs become Desk, Projects, Files, Library, Setup (Repeats moves into
  the Desk).
- Drafts stay per device (kept on the edge would be a write every few seconds).

## 8. Long threads: a progress page and a lighter prompt

The ask (2026-11-01): tasks #632 and #633 are research threads that will stay open for long, get
more docs and research, and "will get too big for me to manage or search"; "a project library
progress doc or something which can continue or worked on for long efficiently no costing extra
tokens".

What #632 and #633 show today (read 2026-11-01):

| Seen | Means |
|---|---|
| Both are **answered**, so each closes by itself after a quiet day | the close after a quiet day goes; in a project, they never close by themselves (section 2) |
| Each started from a file sent in the web chat (a 50 KB report, a 59 KB curriculum), kept in KV for **7 days** | after about 8 November a later run can't read its own source: files go to R2, kept while the task is open (section 16) |
| Four turns each; the runs used 129k–261k tokens each (the reply's run details) | every run gets **the whole thread** again (`think.ts` 383, no cut), and reads the source file again |
| Every run already writes a handoff (Goal, Done, Next, Decisions, Open), kept in the task's status, cut to 2,000 characters, and given to the next run | the progress doc exists already, hidden in a comment, and too short for research |

So, with no new run and no extra tokens:

- **A task's Progress page.** The handoff a run writes anyway is shown in the web chat as the
  task's **Progress** (above the thread, folded), and its cap goes from 2,000 to 16,000
  characters (a short task's run writes a short one). It's the "library progress doc" that grows
  with the work. Today each run's `handoff.md` starts empty and replaces the last one
  (`prompt.ts` 184, `decide.ts` 2216), so one short handoff would wipe a long Progress: the box
  puts the last one in `out/handoff.md` before the agent starts, and the run edits it in place. In a project, each chat keeps its own Progress; facts worth keeping go to the
  project's page through `pages` (section 4).
- **A lighter prompt for a long thread.** Over 40 KB of conversation, a run gets the Progress, the
  newest 8 messages whole, and each older one as its date, its first line and its id; `ship task
  read <id>` gives one whole. Less than now, every run, as the thread grows: at 200 messages, 91 KB
  instead of 500 KB (section 14). Nothing is lost, since every word stays on GitHub.
- **Files stay while the task does.** Every file goes to R2 and stays while its task is open, or
  its project (section 16), so a long research thread's source stays readable as long as the
  thread is open.
- **Find in a long thread:** the thread's own search box (words and dates), and **Jump to latest**.

| Decide | Recommended | Instead |
|---|---|---|
| The progress doc | The run's handoff, shown and longer: no new step, no new tokens | A summary run every few turns: tokens for each summary |
| Long threads in the prompt | Progress plus the newest 8 whole, older ones on demand | A summary by an agent: costs a run and can drop a detail; or the whole thread, as now |
| Where the threshold sits | 40 KB of conversation (about 10k tokens) | Lower: more reads on demand; higher: the cost stays |

## 9. A sweep of the web chat: fixes

The ask: "do sweep on some web issues or something for better if we missed anything". A read of
the web chat's code (2026-11-01) found these; they're fixes, so they need no decision, only a PR:

| Issue | Where | Fix |
|---|---|---|
| **A thread past 100 messages opens almost empty** (101 shows 1), and a message landing at the 100 mark between two polls is never fetched | `reads.ts` 495–503; `app.js` 557–560 | Read the page before too when the newest has under 40; refetch when the page moves on |
| **"Opens at once, offline too"** isn't true: the worker caches nothing | `sw.js`; `routes.ts` 93; `docs/channels.md` | Cache the page's four files, network first |
| **Drafts and attached files** are kept only in memory: iOS closing the app loses them | `app.js` 1166–1168; `compose.js` 194 | Keep words and file refs per task in `localStorage`, cleared on send (iOS clears `sessionStorage` with the app) |
| **Message times** stay as drawn ("now" for hours) | `app.js` 685–690 | Update them in the 1-second timer |
| **No way back to the latest** after scrolling up yourself | `app.js` 533–536 | Show ↓ whenever not near the bottom |
| **Finding old things:** no search in a thread; the list's search sees only loaded titles; no Copy on code | `app.js` 386; `workspace.js` 37–43 | A thread search box (section 8); "Search on GitHub" when nothing's found; Copy on each code block |
| **Screen readers** hear the working timer every second; focus is lost after opening a thread | `app.js` 526, 134, 1162 | Timer `aria-hidden`; focus the view's heading |
| **A close looks undone** for up to 5 s in the thread | `app.js` 235–239 | Apply the list's own guard (`R.turned`) to the thread |
| **Phone:** pictures push text as they load; some buttons are 28–36 px, under the 44 px ADR 0039 promised; iOS's keyboard handling needs a check on an iPhone | `app.js` 868; `app.css` 911 | Fixed picture boxes; 44 px on touch |
| **A project's tab row fills with old chats** (your screenshot, 2026-11-01): up to 12 tabs a project, saved in the browser, a closed task's tab kept until its ✕ | `workspace.js` 11, 62–145; `app.js` 1282 | Remove the tab row (see below) |
| **Small:** Safari's IME Enter can send; the working dot ignores reduced motion; a failed copy says nothing | `compose.js` 356; `app.css` 733; `app.js` 268 | `keyCode 229`; add it to the list; say it |

**The tab row goes.** The ask (2026-11-01, with a screenshot): "remove tabs and remember they are
not needed … closed issues tabs and such occupy … make things lenient". What the tabs gave, and
what gives it instead:

| The tabs gave | Instead |
|---|---|
| Back to the project's page | The project's name in the thread's header line links to its page |
| A recent chat again | **Ctrl+K** with nothing typed: the chats you opened last, open ones only, newest first (from the list of threads seen the page keeps already). The browser's Back |
| A project's chats | Its page and the list, as now; a closed chat only under **Closed** |
| Alt+1…9 | Goes with them |

The saved tabs are deleted from the browser once, on the first load after the change: no old
state stays. A split task's Plan card stops adding tabs. A phone keeps its foot's tabs (they're
the page's parts, not chats). It frees page budget for drops and the Desk.

| Decide | Recommended | Instead |
|---|---|---|
| A project's chat tabs | None: the header's link, Ctrl+K's recent list and the list | 5 tabs, open chats only, not kept after the page closes: still a row to look after |

**Performance** (the ask, 2026-11-01: "coverage of sweep of making things performant"). Measured
on the box, 2026-11-01; each fix is measured again before and after in its build part:

| Seen | Evidence | Fix |
|---|---|---|
| A GitHub call from the Pi takes ~0.7 s, and a run makes 3–5 in a row before its agent starts (the issue, its comments, the status comment's writers, the notebook, the family for a part), part of the 10–12 s "getting ready" | timed with `gh api`; `snapshot.ts` 100–104, 311; `think.ts` 372 | One GraphQL read for all of them (aliases): ~2–3 s less per run. Log each step's time first |
| Every run's prompt carries the whole 23 KB playbook (~6k tokens), read again on each of the agent's turns | `playbooks/task.md`; section 14's base of 31.4 KB | Move the rare how-tos (a new project, an upgrade, a repo with its own rules, recipes) into skills read when needed: ~3–4 KB less on every turn |
| A long thread's whole conversation in every prompt | section 14: 500 KB at 200 messages | The cut (section 8) |
| The page's JS and CSS (~40 KB gzipped) download whole on every load: the edge asks its assets with no `If-None-Match` and always answers 200 | `routes.ts` 93, 174–186 | Pass the request's headers, and answer 304 when the assets do |
| The page's whole copy (up to 30 threads, each message's Markdown and HTML) is written to `localStorage` on each change, every 5 s while a run works: a phone can stall | `app.js` 28–37, 563, 1191 | A key per thread, written only when it changed, when the page is idle; keep one of Markdown or HTML |
| The edge keeps a read 5 s, and a working run's poll comes every 5 s after the last one ends, so the cache nearly always misses: 4–9 GitHub calls a poll | `routes.ts` 71; `app.js` 1222; `reads.ts` 274–287, 493–566 | Keep a read ~8 s |
| A thread's reads wait for each other, and its PRs' states are read again every poll | `reads.ts` 493–508, 555–566 | Read the issue and comments together; cache a PR's state 60 s |
| The runners and the status task are read with no ETag, and the status task with no cache | `settings.ts` 284–329; `setup.ts` 101–104 | Read them through `web/gh.ts` (304s), the status task cached 60 s |
| The edge's memory cache never drops an entry; a thread's key holds its `since`, so each new message adds one | `cache.ts` 6–21; `routes.ts` 300 | Cap it, as `gh.ts` does |
| A list change redraws the whole open thread, and every diagram loads Mermaid again | `app.js` 1193, 665, 714, 899–909 | Redraw the thread only when its own task changed; remember each diagram's picture |
| Smaller: search redraws the list on each key; the 1-second timer runs while hidden; a menu's click listener and object URLs are never released | `app.js` 1275, 134–137, 267; `compose.js` 148–173, 293 | Wait 100 ms on search; stop the timer when hidden or idle; release them |

What's right already: polling stops while the page is hidden, backs off when GitHub can't be
read, and uses ETags to the edge and from it to GitHub, so an unchanged poll draws nothing.
These rows come from a read of the code, not a browser: each is measured before and after its
fix.

## 10. The Library: one store, three reaches, and a journal

The ask (2026-11-01): "journal notebook based some idea dumps thinking thoughts and idea organizing
journals … the goal is to organize info very efficiently to be easily looked at well and managed
so notion isn't even needed anymore"; "project can share efficiently knows all is organized where
to tell and reference and what we stored cited looked into".

What's there: every notebook page but a repo's own goes into **every** run's prompt, whole until
16 KB, then by title (`notebook.ts` 153–163). That suits Preferences; a journal or a research page
there would cost every run tokens for nothing, and push other pages out.

So the notebook becomes the **Library**: the same issues and rules, with three reaches, said by a
label:

| Reach | Who gets it | For | How a page gets it |
|---|---|---|---|
| **Always** | every run, as now | Preferences, People | the `notebook` label, as today |
| **Project** | runs in that project (section 4) | its memory, docs, Inbox, Knowledge | the `library` and `project:<name>` labels |
| **On demand** | no run, until one asks (`ship notebook list`, `ship notebook read`); the prompt says only how many there are | the **Journal**, idea dumps, a reading list, old research | the `library` label, with no `project:` label (`ship notebook list` leaves other projects' pages out) |

A `library` page has no `notebook` label, so the read every run makes (the oldest 100 `notebook`
pages, bodies whole) stays small, however much the Library grows (section 14). An edit or a comment
on a `library` page starts no run, at two levels. The box skips `library` as it skips `notebook`
(`snapshot.ts` `isTask`), so no agent ever starts on a page. And `task.yml` skips it too, so no job
starts at all. The same trust check reads both labels. That `task.yml` line is a workflow file,
which a run can't push: build part 4's PR names the line, and you add it on GitHub. Until you do,
an edit or an Inbox item starts a job that ends in seconds, with no agent.

- **The Journal:** `jot: <words>` from any chat, with no run, adds a dated line to this month's
  page (`Journal 2026-11`, on demand), with any `#tag` kept. In the web chat, **Jot** on the Desk.
  A screenshot jotted goes as an Inbox item does, kept while its Journal page is open.
- **Organize, when you ask:** "organize my journal" (or a weekly repeat you set): one run reads the
  month, and proposes in its `pages` (section 4): ideas grouped by tag, an idea that's grown into a
  project (`project: <name>` with its brief), a line moved to a project's page. The Journal isn't
  a project's page, so each change is listed: you say `yes`; the box writes. Nothing moves by
  itself.
- **A project's Map:** the top of a project's page is a short **Map**: what's where (its pages,
  Inbox, chats, files kept, drops), each a link, kept up to date by the runs that add things. A run
  reads the Map first (small), then only what it needs.
- **Cited:** a fact on a project's page carries its source: a chat message's link, an Inbox item,
  a file's name, a web page. The runs' skill says so (section 11); a fact with no source is marked
  as the agent's own reading.

## 11. The process: how you work in it

The ask: "We have to design a process in the new setup which we can then follow". One page,
`docs/knowledge.md`, for you; one skill, `skills/knowledge`, for the runs:

| Step | You | Where it lands | Cost |
|---|---|---|---|
| **Capture** | `jot: …` for a thought; `add <project>: …` (or Add, a drop, a paste) for a find | the Journal; a project's Inbox | no run |
| **Organize** | "organize my journal"; "collate the inbox" | ideas grouped, projects made, a project's page with sources | one run, when you ask |
| **Work** | a chat in the project: ask, research, build; "split it" for a big job | the chat, its Progress; a part per PR | a run per message, a lighter prompt on long threads |
| **Leave it** | nothing: come back when you want | a quiet task folds into **Quiet**; a project and its chats stay open, with their files; a chat outside one closes after 30 quiet days (write on it to open it), its files 30 days later | none |
| **Look** | the Desk; a project's page and Map; Ctrl+K; "Search on GitHub" | — | none |
| **Take out** | Export, or "share this as a drop" | a zip; a drop link | none; one run for a drop |

The runs' skill (`skills/knowledge`): read the Map first; write a fact where the Map says, never in
two places; cite its source; update in place, newest wins; keep Progress current; propose, never
move, the owner's notes.

## 12. Gaps in Shipify today, against these asks

| Gap | Today | Evolves into |
|---|---|---|
| Tasks close by themselves | answered + a quiet day = closed | quiet ones fold; a project and its chats stay open; a chat outside one closes after 30 quiet days (2) |
| Simple actions clutter the thread | Stop, Close and the rest are your message plus a reply | buttons that show nothing in the thread (2) |
| Files expire, in a store that fails when full | 7 days in KV, 1,000 writes a day, even a research thread's source | R2, kept while their work is open, 10 GB free; deleted by the weekly clean-up after (16) |
| A long thread costs more each turn | the whole thread in every prompt | Progress plus the newest 8 (8) |
| Progress is hidden and short | the handoff in a hidden comment, 2,000 characters | the Progress page (8) |
| One reach for the notebook | every page in every prompt, to 16 KB | the Library's three reaches (10) |
| A project means a repo | titles only; research and ideas are General | projects you make (3) |
| Context across tasks | a run sees only its own task; a split's parts see their parent | a project's chats see its pages, Map and each other (3, 4, 10) |
| Finding old things | titles of loaded tasks; no thread search | Ctrl+K over pages, thread search, GitHub search (7, 9) |
| Threads past 100 messages | open near-empty, can skip one | the sweep's fix (9) |
| Capturing costs a run | every message starts one (but `remember`) | `jot` and `add` with no run (5, 10) |
| No way out but copying | — | Export and a drop (6) |

**Are we capable of it?** Yes, as designed here: each row reuses issues, labels, sub-issues, the
notebook's rules, the R2 the account has, the Drop tool and the web chat, with no new service. Two limits stay real: a
run's summary and citations are an agent's work, so they can miss a point (the sources stay, so
it's checkable); and search is by words, not meaning.

## 13. Architecture: where each thing lives, and how a run reads it

The ask (2026-11-01): "any research i am calling project or collating will become a repo to read
or how and such all this architecture will work". **No: a project is never a repo.** It is issues
on your shipify repo, and files in the web chat's R2 bucket. A run reads it through GitHub's API, as it
reads its task today, and clones nothing for it.

| Part | Where it lives | Written by | How a run reads it | Calls |
|---|---|---|---|---|
| The project: `Project: <name>`, its brief | one issue on shipify, labelled `project` | the door (`project: <name>`, **New project**) | the family read a part makes today | 1 (with its chats) |
| Its chats | issues on shipify, sub-issues of the project (100 at most), each with `Part of #n` | the door (**New chat here**) | the same family read: titles and states; a whole chat with `ship task read <n>` | 0 more |
| Its pages: memory, Map, docs, Inbox | issues on shipify, labelled `library` and `project:<name>` | you (web chat, GitHub, `remember`), the box from a run's `pages` (section 4) | one read by the label: bodies whole to the 16 KB, then by title | 1 |
| Inbox items | comments on the Inbox page | you, the door (`add`, **Add**) | a collate reads the comments after its last mark | 1, on a collate |
| Files: screenshots, PDFs | the web chat's R2 bucket, kept while their chat or project is open (section 16); what a run makes is on the `shipify-files` branch, with a copy in R2 when it answers in the web chat | the page (upload), a run's reply to the web chat (the copy) | fetched into the run's `in/files`, as a chat's files are today (the box asks the edge, `door.ts` 97–107, and R2 sits behind it). A run's own files are named on no from-line, so a later run can't ask for them today (`run.ts` 331, 411): the status lists their refs | 1 R2 read each |
| The always pages (Preferences, People) | issues labelled `notebook`, as today | as today | the notebook read every run makes | 1, as today |
| The Journal, idea dumps, old research | issues labelled `library` | `jot`, a run's `pages`, after your `yes` | none, until a run asks: `ship notebook list`, `ship notebook read` (GitHub's search, by title) | 0, or 1 on demand |
| A Progress | the task's status comment, as the handoff is today | the run, as today | the status read every run makes | 0 more |
| Code, only when the project builds something | a real repo, as today; the project names its repos (section 15) | a run's PR | a chat titled `<repo>: …`, or any change in a project with one repo, clones it (shallow), as now | as today |

So a run in a project makes **two more GitHub reads** than a run in General (the family and its
pages, ~0.8 s each, 7 of the 5,000 points an hour), and clones nothing unless its chat names a
repo. A run outside the project gets none of it.

**One project, from capture to export** (`games`, from #632's research):

1. **Make it.** `project: games` in any chat, or **New project**. The door opens `Project: games`
   (label `project`); no run. 1 GitHub write.
2. **Capture.** On the phone, a screenshot and `add games: offline-first engines list` → the page
   puts the file in R2 (1 write, kept while the project is open), the door adds a comment on `Notebook: games-inbox`
   (1 GitHub write, and the page and its two labels the first time). No run. `jot: #games try
   a pico-8 port?` adds a line to `Journal 2026-11` (1 write), no run.
3. **Collate.** "collate the inbox" in the project's thread starts one run. It reads: its task and
   status (as today), the family (1), the pages by `project:games` (1), the Inbox's new comments
   (1), and their files from R2 into `in/files`. It writes the new text of `Notebook: games` to a
   file and names it in `pages`, the Map first, each fact with its source (the comment's link, the
   file's name). The box writes the page after the run, and marks the items folded.
4. **Work.** **New chat here**: `games: which engine runs offline on a phone?`. The door opens it
   with `Part of #<games>` and links it (2 writes). Its run reads the family (the brief, the other
   chats and their states) and the pages (the Map, the facts), so it starts from what the project
   knows. It clones nothing: the title names no repo. A later chat `playground: add a snake game`
   names a repo, so that run clones `playground`, shallow, and asks for its PR, as today.
5. **Keep going.** The chat's Progress grows with each run; past 40 KB of thread, its runs read
   the Progress and the newest 8 messages, and older ones on demand. Left for a week, it folds
   into **Quiet**; in a project, it never closes by itself, and its files stay while the project
   is open.
6. **Take out.** **Export** on the project's page: the browser reads the pages, the Inbox and
   (when ticked) the chats through the page's existing reads, the files from R2, and builds the
   zip. No run, no write. "share this as a drop" with the zip makes one Drop.

## 14. Stress test: does it hold at the sizes planned?

The ask: "with proper stress test this to confirm will it work". `scripts/stress-0069.ts` runs
Shipify's real code (`buildPrompt`, `notebookSection`, `familyLines`, the web chat's `listed`) on
made-up data at the planned sizes, with no GitHub or KV call; it takes ~4 s on the Pi (`pnpm exec
tsx scripts/stress-0069.ts`). Message sizes come from #632 and #633 (the owner's ~400 characters,
a reply's ~4,400). The planned 40 KB cut is modelled in the script, since it isn't built yet. Real
reads were timed on GitHub (read-only, 2026-11-01), and the free plans' limits read from
GitHub's and Cloudflare's docs. Tokens are characters / 4: a guide, not a count.

**What the prompt costs** (the base is 31.4 KB, ~8k tokens: the playbook and a short thread):

| Case | Measured | Result |
|---|---|---|
| Notebook, 1 / 30 / 100 pages of ~2 KB, all `notebook` | 2.2 / 19.2 / 28.4 KB | **Fails past ~30 pages:** the 16 KB budget holds the whole pages, but every page's title and first line is listed too, so 100 pages cost 28 KB on every run. → The Journal, idea dumps and a project's pages carry `library`, not `notebook` (section 10): the every-run read holds only the few always pages |
| Notebook with one 60,000-character page | 2.5 KB | Holds: the big page goes by title, read on demand |
| Always pages + a project's 3 pages, one 16 KB budget | 14.8 KB, 4 of 5 whole | Holds, with the project's pages ordered right after Preferences (section 4). Its own budget (19.0 KB, 5 of 5) isn't worth a second setting |
| Thread of 20 messages: today / planned | 73.9 / 62.9 KB | Holds: 15% less |
| Thread of 100 messages: today / planned | 263 / 75.6 KB (~67k / ~19k tokens) | Holds: 71% less |
| Thread of 200 messages: today / planned | 500 / 91.4 KB (~128k / ~23k tokens) | Holds: 82% less. It still grows, by ~0.16 KB a message instead of ~2.4 KB |

A run's agent reads its prompt again on each of its turns (from the cache), so a long research
thread's saving is the difference above times the run's turns: at 100 messages, ~48k tokens a
turn.

**What GitHub, KV and R2 allow:**

| Limit | Planned use | Measured | Result |
|---|---|---|---|
| GitHub: 100 sub-issues a parent | a project's chats **and** pages as sub-issues | — | **Fails:** pages would take a chat's place. → Pages found by a label instead (section 4); only chats are sub-issues |
| The family read takes 50 sub-issues (`github.ts` 603; the web list, `reads.ts` 181) | a project with 100 chats | `familyLines`: 50 chats unseen; 5.8 KB | **Fails.** → Take 100: measured on #613, 0.82–0.92 s and 6 points (3 today) of 5,000 an hour; the prompt's list is 9.6 KB, all seen. At 100, **New chat here** says the project is full (section 3) |
| One read of a project's pages by label | every run in a project | 0.78 s, 1 point | Holds |
| The notebook read: oldest 100 open pages | Journal pages, a page per project | 0.75–0.86 s, 1 point, with 1 page today | Holds once `library` pages are out of it (above); without that, page 101 would drop silently |
| GitHub: 5,000 requests an hour for the App; 80 new comments a minute, 500 an hour | `add` and `jot` at your pace; a run in a project adds 2 reads (3 on a collate) | — | Holds. A drop of many files is one comment (section 5) |
| KV free: 1,000 writes a day, 1 GB, and a call **fails** past either | kept files: a heavy day of 100 screenshots, 20 uploads, 20 model picks | 140 writes; 5,000 screenshots fill 1 GB | Holds on numbers, but a full store refuses your files at the worst moment (the owner's worry). → **Files go to R2** (section 16); KV keeps only model picks and devices, a few writes a day |
| R2 free a month: 10 GB, 1 million writes and lists, 10 million reads, downloads free | the same heavy day every day: ~4,200 writes a month; Files views and runs' reads | 0.4% of the writes; 10 GB is ~50,000 screenshots | Holds. Past the free amounts R2 bills (it doesn't fail): $0.015 per GB a month, so a year of heavy use is cents |
| The Files view lists KV once (1,000 keys, by name) | 3,000 kept files | `listed`: **~75 of the newest 200 shown** (keys are random: 75–76 a run) | **Fails** once files stop expiring. → In R2, keys start with the time counted down (section 16), so one list gives the newest 1,000 in order |

**So:** with the four changes (pages by label, `library` pages out of the read every run makes,
the family read at 100, files in R2 with keys newest first), each limit holds at the planned sizes. What the test can't show: a model's own context
window (a 200-message thread today, 500 KB, needs ~128k tokens before the agent does anything;
with the cut, ~23k), and how well an agent's collate or Progress keeps a point (that's checked by
use, against the sources).

## 15. Scale, cost, lock-in, reliability, and a project with its repos

The asks (2026-11-01): "is it scalable … how big and limits it can be for projects"; "storage and
such on cloudflare costs github is free … covered all costs angles"; "should not use something
which will block us at critical junctures … flexible modular"; "it can be attached to some repo …
work longer with multiple features … under one project memory … no cognitive load later"; "for
single person project it doesnt need much so we can think of reliability".

### How big it gets

For one person. "At the limit" says what happens there; nothing stops working silently.

| Thing | Limit, and from where | At the limit | Planned use |
|---|---|---|---|
| Projects | none (they're issues) | — | a few to tens |
| Chats in a project | 100 (GitHub's sub-issues) | **New chat here** says it's full and offers a second project | 20–50 a year |
| Pages in a project | none; the read by label takes 100 | past ~30 pages, their titles cost ~5 KB on each of the project's runs; the Map and a few long pages are better than many short ones | 3–10 |
| One page | 60,000 characters (GitHub's body: 65,536) | a note past it is refused and the reply says so; the weekly clean-up warns at 50,000 | split into a second page |
| A thread | none | the cut keeps a run's prompt ~91 KB at 200 messages (section 14) | 10–200 messages |
| Always pages | 100 read; 16 KB whole in the prompt | the rest by title | 2–5 |
| Files | 100 MB each (a Worker's request); R2 free: 10 GB | nothing fails: past 10 GB (shared with Drop) R2 bills $0.015 per GB a month; Cloudflare's billing alert says so | open work's files and closed chats' for 30–60 days (the weekly clean-up); ~4,200 writes a month on heavy days |
| GitHub API | 5,000 points an hour; 80 new comments a minute | a run makes 5–7 reads; typing can't reach 80 a minute | far under |

### What it costs

| Service | What it holds | Today | When it would cost |
|---|---|---|---|
| GitHub | issues, labels, sub-issues, search, the API | free on any plan, private repos too | — |
| GitHub Actions | runs on your box (self-hosted); small jobs on GitHub's runners, as today | free (GitHub's runners within the free minutes, as today) | GitHub announced $0.002 a minute for self-hosted runners in private repos from 1 March 2026, then postponed it with no new date. If it comes: a 10-minute run is $0.02. This design adds no job |
| Cloudflare Workers and KV | the web chat, the door; KV only the model picks and devices | free plan: past a limit the call fails, and **nothing is billed** | not with this design: KV's use is a few writes a day |
| Cloudflare R2 | Drop's files, and now the web chat's (section 16) | 10 GB, 1 million writes and 10 million reads a month free; downloads free. The card it asks for is on the account already, for Drop | past 10 GB: $0.015 per GB a month (20 GB is $0.15 a month); past 1 million writes: $4.50 a million |
| Cloudflare Access | sign-in to the web chat | free to 50 users | — |
| Model tokens | — | your subscription | this design lowers each run's prompt (section 14) |

**So:** $0 at the planned sizes. The one cost you could meet is R2's, past 10 GB of files: cents a
month, never a refused file. A Cloudflare billing alert (in the dashboard, once) tells you if it
ever starts.

### Run efficiency and clean-up: nothing grows out of control

The asks (2026-11-02): "cost optimization and all run efficiency so not everything goes out of
control quickly … no cognitive load cleanup and such handling in closed tasks"; "will this keep
growing endlessly … reducing cognitive load for managing the setup simply automatically". The
real cost is your plan's 5-hour and weekly limits, so the rule is: what a run reads stays about
the same size, and nothing starts a run but you. Storage has one rule too: **a thing lives as
long as the work it belongs to.**

| What could grow | What keeps it small |
|---|---|
| How many runs | Only your words or a repeat you set start one. Saving starts none: `jot`, `add`, a page's edit and a new project are skipped by the box (sections 3, 10). Words sent while a run works go into that run |
| One run's prompt | The cut at 40 KB of thread (section 8); on-demand pages out of every prompt (10); a project's pages within the 16 KB (4); the playbook's rare parts moved into skills, ~3–4 KB less on each turn (9) |
| A run's length | The job's clock (ADR 0059); a stay leaves after 5 idle minutes or 45 in all (ADR 0057). The model and effort are yours (`use`) |
| Organize and collate | Each reads only what's new: the month, or the Inbox items after its last mark; files 5 at a time (sections 5, 10) |
| Repeats | A reminder and a check run no agent; a job at most once an hour |
| GitHub reads as tasks pile up | The watch reads the 100 open tasks updated last, the list 50, whatever the count; **Quiet** and **Earlier** read more only when opened |
| Files | The weekly clean-up (below): R2 holds open work's files, and closed chats' for 30 to 60 days. 10 GB free, then cents (above). The box's run folders go at 8 hours (ADR 0059) |
| Open chats | **Quiet** folds them; a chat outside a project closes after 30 quiet days (section 2), so the list and the watch's reads stay short |

**Each store, and what keeps it small:**

| Store | Holds | What bounds it |
|---|---|---|
| GitHub issues | every word, Progress, pages, projects | nothing needed: text, free, and the record you keep |
| `shipify-files` branch | what runs make | small text, kept with the work: 99 files, 5.2 MB so far (2026-11-01); 25 MB a file |
| R2 `shipify-web-files` | your files; a copy of a run's for the web chat | the weekly clean-up: open chats' and open projects' files, and a closed one's for 30 days |
| Drop's bucket | shared copies | each drop's expiry (1, 7 or 30 days, unless kept); **Revoke**; Drop's own 9 GB cap |
| KV | model picks, devices | a few keys |
| The box | each run's clone and folders | run folders at 8 hours; each week, closed tasks' folders and any task's unchanged for 7 days (ADR 0059, 0020) |

**Clean-up by itself, with no agent and nothing to remember.** The box's weekly clean-up runs
today (`watch.ts` 247: closed tasks' folders, old run folders, doctor). It gets two more steps:
it deletes closed chats' files, and it closes chats quiet for 30 days. Each box runs its own
clean-up (`watch.ts` 79–90), so the status record keeps when these steps last ran, as it keeps the
digest's time: they run once a week in all, however many boxes.

- **One GitHub read** (GraphQL, three searches): the issues closed 30 to 60 days ago, with their
  labels and parent; your open projects; the open chats not updated for 30 days, with their open
  parts and open PRs (section 2), less the labels it never closes, oldest first. One more read for
  each project closed in that window: its chats, each with its state, and its pages. Each chat the
  30-day step closes is two writes: the close and its status line.
- **Whose files go:** a chat's or a page's, 30 days after it closes, unless it's in an open
  project (its parent, or its `project:<name>` label). A project closed for 30 days takes its
  closed chats' and its pages' files with it; an open chat keeps its own. The window's far end, 60
  days, lets a missed week catch up, and a second pass over the same chat deletes nothing more.
- **How:** the box sends those chats' numbers to the door (`POST /door/files/forget`), proven by
  watch.yml's own OIDC token, as the door's other routes are (ADR 0031). That route takes no other
  workflow, so no agent's run can delete a file. The edge lists the bucket (1,000 files a call,
  each with its chat in its metadata, section 16) and deletes those chats' files (1,000 keys a
  call).
- **The 30-day close** of section 2, as completed, with its status line.
- **What it says:** a line in the clean-up's summary on the status issue ("deleted 12 files
  (8 MB) of 4 closed chats"). No message to you.

Why it's safe:

- The clean-up deletes only the files of a chat it read as closed. A file whose chat it can't
  tell (a draft's, or one copied from KV, section 16) is kept: **Files** shows it under **No
  chat**, with **Delete**.
- Writing on a closed chat opens it again, so a chat you come back to within 30 days of its close
  keeps its files. **Export** keeps a copy of anything, anywhere.
- **What a closed task leaves:** its words and Progress on GitHub (free), its run files on the
  branch (small), its files in R2 for 30 days, no branch (deleted on merge or **not planned**, as
  now), nothing on the box after the week.

| Decide | Recommended | Instead |
|---|---|---|
| Clean-up | By itself, in the weekly clean-up: a closed chat's files go 30 days after it closes; an open project keeps its own; no button | One tap in **Quiet** and **Files**: one more thing to remember. Or keep every file until you delete it: R2 grows about 1 GB a year at 10 screenshots a day, and never shrinks. Or an R2 lifecycle rule by age: a source still in use could go |

### Never blocked at a critical point: the rules

1. **GitHub holds the truth; everything else is a view or a cache.** Memory, chats, Inbox text and
   Progress are Markdown on GitHub. You can read them with no Shipify, take them out with `gh` or
   the export, and move them to another tool.
2. **Each link is written in plain words first.** A chat's project is its `Part of #n` line (a moved
   chat's, its `in-project` label and link); the sub-issue link is a view. A page's project is its title (`Notebook: <name>…`) and its
   label. If GitHub changes sub-issues, nothing is lost.
3. **Files go through one small interface** (put, get, list, delete), R2 behind it. Another store
   later is a change in one module, not a new design, and R2 speaks S3's API, which most tools
   read.
4. **It fails soft.** R2 doesn't refuse a file for space. The web chat down: write on the GitHub
   issue, with the same result. A run
   failed: its handoff and commits are kept (ADR 0059). An agent's summary wrong: each fact links
   its source. The clean-up can't tell a file's chat: the file is kept.
5. **Nothing new runs by itself.** No agent runs but for what you ask, or a repeat you set. The
   automatic steps are today's watch and weekly clean-up, with no agent: the close after a quiet
   day goes, and the clean-up gains two steps (a closed chat's files, a chat quiet for 30 days).
6. **No agent is special.** The prompt and the skill are text: any agent Shipify runs reads them.

### A project with its repos

A project you make can own repos, so one project memory covers a product's code and everything
around it, for years of features:

- **Make it:** `project: shop repos: shop-api, shop-web`, or **Repos** in **New project**. The
  brief's first line is `Repos: shop-api, shop-web`. A repo belongs to one project at most. A repo
  you have today joins the same way (`project: shop repos: shop`); nothing in it moves.
- **Its chats:** with one repo, a change goes to it with no name in the title; with more, the title
  names one (`shop-web: add a login`), as today. A question needs no repo.
- **One memory:** the project's pages, plus each of its repos' own pages (ADR 0047), reach every
  run in the project, not only a run on that repo.
- **Where a fact goes, one rule:** what the code needs to be right (its spec, its ADRs,
  `AGENTS.md`) lives in the repo, versioned with the code and reviewed in PRs. Everything else
  (research, product choices, ideas, links, screenshots) lives in the project's pages. The Map
  links both. You never have to choose twice.
- **Features:** each feature is a chat and its PR; a big one is "split it" in its chat. A merged
  `closes` PR closes the chat, so the project's list shows what's done and what's open.

### Reliability for one person

The design adds no service and no background job: it runs on what runs today (GitHub, the box,
the edge, the R2 the account has). GitHub keeps every word, so it is the backup. Files in R2 are
the one thing outside GitHub: **Export everything** downloads them, and a monthly reminder (a repeat with no agent) can
prompt it, if you want one.

### Verdict

**Recommended, for one person, at these sizes.** Most limits are 10 times or more above the
planned use. Watch two things: the space files use in R2 (Cloudflare's billing alert), and a project's
page count (few, long pages with a Map). It isn't meant for a team, for tens of
thousands of files, or for search by meaning.

## 16. Files in R2, kept as long as their work

The ask (2026-11-01): "i am not comfortable saving in kv these files … varied limits and it can get
full if i give screenshots … using R2 … best cheapest simple resources". KV was the web chat's
file store (ADR 0036) because it needed no card. The account has R2 now: Drop keeps its files in
a private bucket (1 MB of its 9 GB used, read 2026-11-01), and the deploy token can make buckets.

| | KV today | R2 (recommended) |
|---|---|---|
| Free | 1 GB; 1,000 writes, 1,000 lists a day | 10 GB; 1 million writes and lists, 10 million reads a month; downloads free |
| Past it | the call **fails**: a file is refused | it **bills**: $0.015 per GB a month |
| One file | 25 MiB (KV), 10 MB (the page's cap) | 100 MB (a Worker's request on the free plan) |
| Listing | by key name: the newest aren't first | by key name too, so keys start with the time counted down: newest first |
| Expiry | per key: 7 days, whatever the file is for | none of its own: the weekly clean-up deletes a closed chat's files (below) |

How it works:

- **One bucket**, `shipify-web-files`, bound to the edge as `BUCKET`. The deploy makes it, as it
  makes the KV namespace now: wrangler (4.142) creates a bound bucket that isn't there, and finds it
  again by its binding's name and type. Not `shipify-files`: that's the branch's name. KV stays for
  small settings only (model picks, devices), a few writes a day, and keeps its binding's name,
  `FILES`: a new name would make the deploy create an empty namespace, and your devices and model
  picks would go. A comment in `wrangler.jsonc` says what it holds now.
- **Streamed, not held:** an upload's body goes straight into R2 (`put` with the request's body,
  its length known), as Drop's does, and a file goes out of R2 as a stream. Today the edge reads an
  upload whole into memory (`routes.ts` 451), and a Worker has 128 MB.
- **A file lives as long as its chat:** no 7 days, and no "keep" for files. It stays while its
  chat (or page) is open, or its project, and the weekly clean-up deletes it 30 days after that
  closes (section 15). A file's key is `f-<time counted down>-<id>`, its name, type, size, chat
  and who made it in the object's own metadata, as KV's are now. The key is also the file's ref: a
  run asks for a file by the ref on its from-line (`web:<ref>`), and the edge takes only refs that
  match `FILE_REF` and reads that exact key (`env.ts` 161, `channels/web.ts` 233–243). So
  `FILE_REF` takes `f-…` too, and the KV files are copied under their old keys (`up-…`, `run-…`),
  so the refs in old messages still work; they list after the new ones.
- **Each file knows its chat.** Today an upload carries no task (`routes.ts` 459–465). The page
  sends the open chat's number with an upload, and the edge keeps it in the file's metadata. A
  file dropped where there's no chat yet (the list, **New chat**, a project's first **Add**, the
  month's first jot) gets its number when the door opens the chat or page: R2 can't change an
  object's metadata alone, so the edge writes the file again under the same key with it (a
  streamed get and put, after the reply: one more write a file). If that write fails, the file has
  no chat, and the clean-up keeps it.
- **Each chat owns its files.** A file from **Files** (dragged in, **Ask about this**, **Share**)
  that belongs to another chat is copied once for this one: a streamed get and put, under a new
  ref with this chat's number. So one chat's clean-up never breaks another chat's message, and the
  ref a drop takes is always on this chat's own from-line.
- **Removed means deleted:** a file you remove from the box before Send is deleted at once (the
  same call as Files' **Delete**). The page drops a draft untouched for 30 days on that device,
  with its files.
- **Files** lists the newest first (1,000 a call), grouped by project and chat from each file's
  metadata, each with its size and a **Delete**, and the total at the top. R2 has no call for a
  bucket's total, so Files counts every file as it lists: one more call per 1,000 files, a few at
  most, since the clean-up keeps the bucket small. A file with no chat shows under **No chat**.
- **One file up to 100 MB:** the page's cap goes from 10 MB to 100 MB (`files.ts` 23,
  `MOST_BYTES`), a Worker's request limit on the free plan, and so does the box's when it fetches
  a file for a run (`door.ts` `doorFile`, 10 MB today).
- **Shared free space:** the account's 10 GB is shared with Drop (capped at 9 GB by itself). Past
  10 GB together, R2 bills cents, never refuses. A billing alert in Cloudflare's dashboard (set
  once, by you) says if it starts.
- **Switch over in one go:** the build copies the files in KV (at most 7 days' worth) to R2 once
  at its deploy, then deletes KV's file code. Nothing reads files from KV after that. A `run-` file
  carries its chat in its key; an `up-` one has none, so the clean-up keeps it (at most a week's
  uploads), under **No chat**.
- **Drop** keeps its own bucket: sharing a file is still "share this as a drop".

**Two stores, one view.** The ask (2026-11-01, with a screenshot of GitHub's file tree): "shipify
files … has nice organization and maybe some good free storage … do whats best". Files a run
makes already go to shipify's private `shipify-files` branch, as `task-<n>/<time>/<name>` (ADR
0021; 99 files, 5.2 MB, read 2026-11-01): free, kept, browsable on GitHub, linked from replies,
and the source the box gives Drop. That stays, and each store keeps what it's good at:

| | `shipify-files` (GitHub branch) | R2 bucket |
|---|---|---|
| Holds | what runs make: reports, plans, docs, charts | what you send: photos, screenshots, PDFs, Inbox files; a copy of what a run sends to the web chat |
| Written by | the box after a run, with its files token (as now) | the edge, at once, from the page; from a run's reply to the web chat (as KV is now) |
| Why there | text, small, versioned, linked from GitHub replies | binary, larger, from a phone, fast; no repo growth |

- **One view:** the web chat's **Files** shows one tree, by project, then task, then time, as
  GitHub's does, from one R2 list: R2 lists each file's own metadata (name, size, task, who made
  it) with its key. It doesn't read the branch: the door App has no Contents permission (ADR
  0036), and giving it one would let a leaked door key read shipify's code. So a run's files show
  in Files when it answered in the web chat, as now (the copy above, a few MB in all); each one is
  on the branch too, linked from its reply on GitHub.
- **A run's files to the edge, within its limits:** the box sends them with the reply in one form
  (`tellDoor`), 10 at most and today no size cap; each can be 25 MB, so five would pass the 100 MB
  Cloudflare takes in one request, and the refused request would lose the reply's delivery to your
  chats too. The box sends up to 50 MB in all; the rest are on the branch, linked from the reply.
- **By project:** a run in a project puts its files under `<project>/task-<n>/<time>/` on the
  branch; files already there stay where they are, so no link breaks.
- **"File it":** an upload you want beside a run's documents on GitHub goes there when you ask a
  run to file it (a run already writes its out files there).
- **Why not every file on GitHub:** the edge would need write access to shipify's contents (a
  leaked door key could then write code, not only issues); a picture stays in git's history
  forever, and GitHub asks a repo to stay under 1–5 GB (it can't shrink without rewriting
  history); each upload is a commit (~1 s, 80 a minute).
- **Why not every file in R2:** run files are small, linked from GitHub replies, and the box
  shares them from the branch; moving them gains nothing.

**Three places, one job each.** The ask (2026-11-02): "How does drop and this share and use
storage properly differentiated and shared as required".

| | R2 `shipify-web-files` | `shipify-files` branch | Drop (its own app and bucket) |
|---|---|---|---|
| Its job | your files: keep them while you work with them | what runs make: keep it with the work | share a copy with someone |
| Who can open it | you (the page, behind sign-in) and the box | you on GitHub, the box and runs | whoever the drop says: you (`me`), anyone with the link, or people you name; a PIN if you want one |
| How long | while its chat or project is open, and 30 days after it closes (the weekly clean-up); or until you delete it | for good (git's history) | 1, 7 or 30 days, or `keep`: its link stops on time, and R2's lifecycle deletes it within a day; **Revoke** deletes it at once |
| Limit | 100 MB a file; 10 GB free, shared with Drop | 25 MB a file (`cli/commands/task/files.ts` 341) | 100 MB a file; 9 GB (Drop's own cap) |
| Made by | the page (no run); a run's reply to the web chat (a copy) | the box after a run | a run's `drop.publish` (pre-approved), made by the box |

How a file moves between them:

- **You send it** (drop, paste, attach, **Add**): into R2, once, with its chat's number. No run.
- **A chat uses it:** its ref on the message's from-line (`web:<ref>`). The box fetches it into
  the run's `in/files`. Dragged from **Files** into another chat (section 1), it's copied once for
  that chat, so each chat owns its files.
- **A run makes a file:** onto the branch, linked from its reply, and a copy in R2 when it answers
  in the web chat.
- **You share it:** "share this as a drop". The run proposes `drop.publish` with the file: a file
  the task shared (from the branch, as now), or, new, a file you sent, by its ref. The box fetches
  that one from the edge, as it fetches `in/files`, and gives it to Drop. Today a run has to copy
  your file to its out folder first, so it lands on the branch too: for good, and only up to
  25 MB. With the ref, Drop holds the only copy that leaves your stores. A ref counts only when
  it's on this task's own from-lines or in its status, so a run can share only what its thread
  has.
- **The drop ends** (its expiry or **Revoke**): Drop deletes its copy. Your file in R2 stays as
  long as its chat does; the run's on the branch stays.
- **Its chat closes:** 30 days later the weekly clean-up deletes the chat's files from R2, unless the
  chat is in an open project (section 15). The run's files on the branch stay, linked from the
  replies.
- **Take everything out:** **Export** (section 6) builds the zip in your browser from R2 and
  GitHub. Nothing is stored unless you attach the zip somewhere.

A drop with no run (a **Share** button that makes it at once) would need the box to make a tool
call with no agent, or the edge to hold Drop's write key: one short run is worth less than either.
Files people send you through a `collect` drop stay in Drop: its tool lists them but can't fetch
one for a run (Not in it).

| Decide | Recommended | Instead |
|---|---|---|
| Where files go | What you send to R2, kept as long as its chat; what runs make stays on `shipify-files`; one Files view from R2 | Everything on `shipify-files`: a new write permission for the door and a growing repo; everything in R2: links in old replies to move. KV as now: a limit that fails. Files reading the branch too: Contents read for the door App |
| How long | As long as its chat or project is open, and 30 days after; then the weekly clean-up deletes it | Kept until you delete one: R2 only grows. A lifecycle rule by age: a source still in use can go. KV's 7 days: a research source lost in a week |
| A file used in a second chat | Copied once for that chat | The same ref in both: one chat's clean-up would break the other's message, or the clean-up would have to read every chat's refs first |
| A drop of a file you sent | The box gives Drop the file from R2, by its ref | Through the run's out folder, as now: a copy on the branch for good, 25 MB at most |

## Critique: what's realistic

- **Realistic, small and worth it now:** files in R2, kept as long as their work; no close after a
  quiet day, and silent buttons; the
  Progress page and the lighter prompt (they reuse what runs do already); drag and drop. These fix
  what #632 and #633 hit, for little code.
- **Realistic, medium, worth it next:** projects with their pages (section 3 and 4). They give long
  work a home and a memory, on the notebook's rules.
- **Realistic, but judge after using the above:** the Inbox and its collate (section 5), export
  (6) and the Desk (7). Each is useful; none is needed to work well with #632 and #633.
- **Not realistic here, and why:**
  - **Search by meaning (embeddings, a vector store):** a new service or paid API, and a store to
    keep in step. GitHub's search, Ctrl+K and a thread's search box find words; an agent run reads
    on demand.
  - **A Notion-like editor (blocks, databases, views):** a big app in a page with a 42 KB budget.
    Markdown pages and GitHub's own editor cover notes; Notion stays a tool for databases.
  - **A summary that is never wrong:** a run's Progress is written by an agent and can miss a
    point. The thread stays whole on GitHub, and a run reads any message on demand.
  - **"No tokens at all":** reading costs tokens. What's realistic is that a long thread costs
    about the same each turn, not more and more.
- **Today, with nothing built:**
  - Write on #632 and #633 before a quiet day passes, or reopen them later: a closed task comes back
    when you write on it. (Once built, a project's chats never close for quiet, and a chat
    outside a project closes only after 30 quiet days.)
  - Keep your source files: ask in the task "share the report as a drop, keep it". The Drop tool
    keeps it with no expiry, and the link goes in the thread.
  - Ask a run to "write a progress summary of this thread into the reply": the next runs read it
    in the conversation.

## Review: feasible, and what to build first

A check of the first draft against the code (2026-11-01) found these, now handled above:

| First draft | Found | Now |
|---|---|---|
| A hand-added chat gets the parent's description | The family is read only for `sub-task` or a parent | Read it when the body has `Part of #n` |
| Memory in the project's body | The family cuts a body to 2,000 characters and can't check its editor | Memory is a notebook page |
| `Doc:` issues | An edit on one would start a run | Docs are notebook pages: no run |
| Door writes trusted | The notebook trusts only you and the record's writer | The door is trusted as you, for these pages |
| `project:` and `pin` as words | `project:` reads as a repo; "pin" is GitHub's | `project` reserved; no word needed to keep a task (section 2) |
| A project's `go` | Would start every chat and page | `go` starts only `sub-task` parts |
| A collate gets the Inbox's files | A run gets only its own task's, 5 at most | New, in batches of 5 |
| Share as a Drop through a run | A run shares 10 files at most | The zip is the one file |
| A project's pages as its sub-issues | The stress test: they take chats' places in GitHub's 100 | Pages by the `project:<name>` label |
| The family read as it is | It takes 50 sub-issues | 100, at 6 points a read |
| On-demand pages listed in every prompt | 100 pages' titles cost 28 KB on every run | `library` pages aren't in the every-run read; the prompt gives their count |
| Kept files in the Files view as it is | It lists 1,000 keys by name: ~75 of the newest 200 at 3,000 files | R2 keys newest first (section 16) |
| Kept files in KV | KV fails when full or past 1,000 writes a day; the owner doesn't want it | R2, kept (section 16) |
| A `keep` word and label | One more thing to say, and a message in the thread each time | No quiet close; buttons that show nothing in the thread (section 2) |

A second check of the whole flow against the code (2026-11-01, evening; the ask: "Is the plan
solid validated"), again handled above:

| The design said | Found | Now |
|---|---|---|
| A collate writes the page through `notes` | A note is one line of 500 characters, added at the end (`notebook.ts` `Note`): no way to rewrite a page or keep a Map | A result field `pages`: a file with the page's whole text, written by the box (section 4) |
| A project's pages in the notebook | Its prompt says "It's theirs: follow it"; a collate puts web facts there | Their own section, as data (section 4, Security) |
| `task.yml` skips `library` | Until you add the line, the box treats a page as a task: an Inbox item would start an agent | The box skips `library` itself; the line saves the job start (section 10) |
| "split it" in a project's chat | The family read starts at the parent, so a chat never sees its own parts, and every chat counts as a part | Both levels read; a part only with `sub-task` (section 3) |
| A project opens with no run | `task.yml` runs on every opened or edited issue | The box skips an opened or edited `project`, and a second `task.yml` line you add (section 3) |
| A project's thread is a thread | Any issue with sub-issues is a split parent: `part-of` PRs, a Plan card whose **Start all ready** sends `go` | No split parent behaviour for a `project` (section 3) |
| No quiet close | Due lists every answered task and reads its comments, so its reads would grow forever | Due lists answered `sub-task` tasks only (section 2) |
| Quiet "with no new call" | The list reads the 50 open tasks updated last | **Quiet** and a project's fold read more when opened (sections 2, 3) |
| Close and reopen answered in the status line | They're settings: no run, so no answer; Stop's answer has no place in the status | Close and reopen shown from the issue's state; a **Last action** line for Stop (section 2) |
| Progress grows with the work | Each run's handoff starts empty and replaces the last | The box puts the last one in `out/handoff.md` first (section 8) |
| The door is trusted as you | The door is its own App, and also takes words from `SHIPIFY_PEOPLE` | Trusted only when its from-line names you (section 4) |
| R2 keys `f/<time>-<id>` | Runs ask by ref, and the edge takes only `up-…` and `run-…` refs, by exact key | The key is the ref (`f-…`); old files keep their keys (section 16) |
| A run's files fetched as today | No from-line names them, so a later run can't ask for them | The status lists their refs (section 13) |

A third check, of the file stores and of what could grow (2026-11-02; the asks: "How does drop
and this share and use storage properly differentiated"; "Would the default of R2 holding files
from webchat … not using kv will work"; "cost optimization and all run efficiency"), again
handled above:

| The design said | Found | Now |
|---|---|---|
| Files lists the branch's tree and R2 | The door App has no Contents permission (ADR 0036): it can't read the branch | Files lists R2 only; a run's files reach it as a copy when it answers in the web chat, as now (section 16) |
| A zip shared as a drop "by the existing path" | Drop's tool takes only a task's shared files: the run copies the zip to the branch (25 MB at most, kept in git's history for good), and the box reads it back | The box gives Drop a file you sent by its ref, from R2, up to 100 MB; nothing goes to the branch (section 16) |
| A 100 MB file uploads | The box fetches a file for a run up to 10 MB (`door.ts`) | Its cap goes to 100 MB too (section 16) |
| The R2 bucket `shipify-files` | The branch has that name | `shipify-web-files` |
| "Every file you send or a run makes goes to R2" | Section 16 keeps a run's files on the branch | Said one way everywhere: three places, one job each (section 16) |
| R2 bound as `FILES` | KV is bound as `FILES` already, and wrangler finds a store again by its binding's name and type: renaming KV's would make an empty one, and your devices and model picks would go | R2 as `BUCKET`; KV keeps `FILES` (section 16) |
| 100 MB uploads | The edge reads an upload whole into memory (`routes.ts` 451); a Worker has 128 MB | The upload streams into R2 (section 16) |
| A run's files copied to R2 with its reply | The box sends up to 10 files of 25 MB each in one request; past Cloudflare's 100 MB the request is refused, and the reply's delivery with it | Up to 50 MB in all; the rest linked from the branch (section 16) |
| Saving starts no run (`add`, `jot`, a new project) | The watch marks an open task **Stopped** and tells you when your words wait 10 minutes with no run (`watch.ts` 388–477); it skips only status, notebook and stuck issues. An Inbox item, a Journal line or a new project would each be marked, with a notice | The watch skips `library` pages, and a `project`'s own opening doesn't count as words waiting; words in its thread still do |

A fourth check, of what grows (2026-11-02; the ask: "will this keep growing endlessly … simply
automatically"), against the box's clean-up and the edge's files:

| The design said | Found | Now |
|---|---|---|
| Every file kept until you delete it | R2 would only grow: KV's 7 days was what kept it small, and nothing would delete a closed chat's files | A file lives as long as its chat or project, then 30 days; the weekly clean-up deletes it (sections 15, 16) |
| **Close the old ones** and **Files → Clean up** | Two more things to remember and tap | Gone: the weekly clean-up does both by itself (section 15) |
| Quiet chats never close | Their files would stay too, and **Quiet** would only grow | A chat outside a project closes after 30 quiet days, as completed; a project and its chats never do (section 2) |
| The weekly clean-up deletes the files | Each box runs its own (`watch.ts` 79–90): with two boxes, it would run twice | The status record keeps when it last did: once a week in all (section 15) |
| Files grouped by project and task | An upload carries no task (`routes.ts` 459–465), and a file dropped in a new chat has none to give yet: the tree, and a clean-up by chat, couldn't place it | The page sends the open chat's number; a new chat's files get theirs when the door opens it; a file with no chat is kept (section 16) |
| A file dragged into another chat keeps its ref | One chat's clean-up would break the other chat's message | Copied once for the new chat (section 16) |
| A file attached, then removed or never sent | It names no chat, so nothing would delete it | Removed: deleted at once. A draft untouched for 30 days: the page drops it, with its files (section 16) |
| A close by the box | **Not planned** closes the task's PRs and deletes its branch (`decide.ts` 1285, 1405); and a run's own OIDC token reaches the door too | Closed as completed, only with no open PR; the delete route takes only watch.yml's token, so no agent's run can delete a file (section 15) |

None of these changes the design's shape: each is a guard, a read or a field in a build part
that touches that code already.

| Part | Size | Value |
|---|---|---|
| 16. Files in R2 | small to medium (one module, a one-time copy, a step in the weekly clean-up) | high: sources stop expiring, nothing fills up, nothing to manage |
| 2. No close after a quiet day, silent buttons | small (a deletion, the door's actions, the 30-day close) | high: #632 and #633 need it now |
| 8. Progress page, lighter prompt | small to medium | high: every long thread, every turn |
| 1. Drag and drop | small | medium |
| 3. Projects | medium | high: the base for 4–6 |
| 4. Pages | small after 3 (it's the notebook) | high |
| 5. Inbox | medium (the files for a collate) | medium to high |
| 6. Export | small to medium | medium |
| 7. Desk | medium (page room) | medium |
| 9. Web chat fixes | small to medium | high: a lost message is a bug |
| 10, 11. Library, Journal, process | small (a label and a word) to medium (the organize run) | high: the place for thoughts, no cost per run |

**Recommended order:** the sweep's fixes (section 9); files in R2 with drag and drop; no close
after a quiet day, and silent buttons; the Progress page; projects with their pages; the Library, the Journal
and the process; then the Inbox, export and the Desk, each when you want it.

## Security

- A project's pages reach only its runs, under the notebook's locks. The door is trusted as you
  for them because only you reach it; `docs/security.md` says so, and that a door key leaked would
  now also write to pages.
- An Inbox item is data to a run, never an instruction; only items by you or the door are read.
- A project's pages are data too: a collate puts facts from web pages and files in them, so they
  reach a run in their own section, never under the notebook's "follow it" (section 4). A run's
  rewrite of a page (`pages`) is kept in the issue's edit history, and any page outside its own
  project waits for your `yes`.
- No new permission: the buttons, `project:`, `add`, a page's edit, a `stop` label and a
  sub-issue link are writes on shipify's own issues. The deploy token has R2 already. The R2
  bucket is private: only the edge reaches it, behind the same sign-in as the page, as KV's files
  are now. Files reads no branch, so the door App gets no Contents permission.
- Deleting files: you can, in the page (**Delete**, or removing a file from the box), behind the
  sign-in. Besides you, only the weekly clean-up can, through the door's `forget` route, which
  takes only watch.yml's OIDC token (no key is added) and only chat numbers; a run's token, from
  task.yml, is refused there.
- A drop's file by ref: only a ref on the task's own from-lines or in its status counts, so a run
  shares only what its thread has; Drop's `publish` stays pre-approved only when the run read
  nothing from outside.
- A zip holds only what the page may read already, and stays on your device; a Drop opens to you
  alone unless you say who else.

## The build: parts, after your `go`

All on shipify, in this order (each its own PR). Part 0 is fixes, built in this design's own PR,
as the owner asked ("cover all well handled fixes even the smaller ones in the same … complete
today"); the two run-side rows of the performance table (start-up reads, the playbook in every
prompt) touch every run and go with part 3. Parts 1 to 8 are the split after your `go`.

0. **shipify: web chat fixes from the sweep** (section 9). Done when a thread of 101 messages
   opens with its newest 40, the tab row is gone, Ctrl+K opens on the recent open chats, and each
   performance row is measured before and after its fix.
1. **shipify: files in R2, and drag and drop anywhere** (sections 16, 15 and 1). Done when a file
   sent in the web chat is in R2 with its chat's number (a new chat's too), Files lists the newest
   first by chat with each size, a Delete and the total, a 100 MB file streams in and reaches a
   run, the KV files were copied and KV's file code is gone while your devices and model picks
   stay, a ref in an old message still opens its file, a run asks for a file by its new ref, a
   run's files over 50 MB in all don't stop its reply, a file you sent shares as a drop with no
   copy on the branch (also from **Share**), a file dropped on the list waits in a new chat's box
   until Send, a file removed from the box is deleted, a file dragged into another chat is copied
   for it, and the budget test passes. The weekly clean-up deletes the files of a chat closed 30
   days and keeps an open chat's and a file with no chat, once a week with two boxes; the door's
   `forget` route refuses a task.yml token.
2. **shipify: no close after a quiet day, and buttons that show nothing in the thread** (section
   2). Done when an answered task is still open a week later, folded under **Quiet**, while an
   answered part still closes a day later; due lists only answered parts; **Quiet** reads past the
   list's first 50; the weekly clean-up closes as completed, with its status line, a chat quiet 30
   days with no open PR, repeat, errand or open part, and leaves every other task open; writing on
   it opens it again; and Close, Reopen, Stop and Stop repeating from the web chat show no message
   in the thread, Close and Reopen by the issue's state, Stop's answer in the status's **Last
   action**.
3. **shipify: a long thread's Progress and a lighter prompt** (section 8). Done when a task's
   Progress shows in the web chat, a run starts with the last handoff in `out/handoff.md` and a
   short run doesn't wipe it, a run's own files are listed in the status for the next run, and a
   run on a thread over 40 KB gets the newest 8 messages whole and reads an older one with `ship
   task read`. Each check in `scripts/stress-0069.ts` becomes a
   unit test in the part that builds it (here the cut); the script goes after part 5.
4. **shipify: projects you make, their pages, and their repos** (sections 3, 4, 13 and 15). Done
   when a project made in the web chat has two chats, a run in the second names a note the first
   added, a moved chat gets the family, the family read takes 100 sub-issues, a project with one
   repo sends a change chat to it, and its repos' pages reach its runs. A run's `pages` rewrites a
   page of its project, and the pages reach the prompt in their own section, as data. A chat in a
   project splits, and its `go` starts its own parts; the project shows no Plan card, and a run in
   its thread keeps its `closes` PR. A door edit counts as yours only when its from-line names you.
   The trust check reads `library` pages, and the box skips `library` pages and an opened or
   edited `project` with no agent (`snapshot.ts`); the watch marks neither as **Stopped**. The
   weekly clean-up keeps the files of a closed chat while its project is open, deletes a closed
   project's chats' and pages' files 30 days after it closes, and never closes a project or its
   chats for quiet. Its PR names two `task.yml` lines for you to
   add (skip `library` as `notebook`; skip `project` on opened and edited), so these start no job.
5. **shipify: the Library's reaches, the Journal, the process** (sections 10, 11). Done when a
   `library` page with no project reaches no prompt unless a run reads it, `jot: …` adds a dated
   line with no run, and `docs/knowledge.md` and `skills/knowledge` are in.
6. **shipify: a project's Inbox, and collate** (section 5). Done when a screenshot and a note added
   with no run are in the project's page after "collate the inbox", each with its source.
7. **shipify: export a project** (section 6). Done when a project's zip opens with its README,
   `ALL.md` and files, and the same zip sent as a drop opens from its link.
8. **shipify: the Desk** (section 7). Done when a new browser shows the same Needs you, Working
   and Projects as the PC.

## As built (2026-11-02, parts 1 to 8 in one PR on task #631)

The owner's `go` (2026-11-01: "carry on everything with the work in new PR … test and properly
update docs remove stale … robust") built parts 1 to 8 in one PR, with the clean-up design of the
second doc PR in it. Where the build differs from the design above:

- **Files (part 1):** the store is `edge/src/store.ts` (put, open, head, list, remove, stamp, copy,
  forget), R2 behind it. A key is `f-<1e13 − now, 13 digits>-<id>`. A new chat's files are stamped
  after the door's answer (`waitUntil`). KV's files are copied to R2 a step at a time (200 files or
  25 MB a read of the store), each marked in a `_moved-from-kv` object as it's copied, so a step
  that fails carries on from the mark; that copy goes a week after the deploy (`docs/roadmap.md`).
  A file is 95 MB at most, not 100: Cloudflare refuses a request over 100 MB before the Worker, its
  form included. A copy made for a second chat that no chat takes (the door refused the message,
  or it named no chat) is deleted at once, so no copy is left with no chat. `ship door check` and
  `ship door setup` check the bucket, and name the fix when R2 is off. A file attached with
  **Ask about this** is never deleted when it's taken off the box (only one sent up from it is).
  A drop by ref counts only refs on the task's own from-lines; refs listed in the status don't yet.
- **Quiet and buttons (part 2):** the clean-up's steps are `cli/commands/task/sweep.ts`, their time
  `watch.sweep` in the status record: a box writes it in the same status update that reads it, so
  two boxes at the same moment could both run the steps, which deletes and closes nothing twice.
  The read takes 100 of each search, the oldest first, the quiet one less the labels the close
  never takes (so projects and pages can't fill it); the rest come up the next week. The steps are
  due a week less an hour after the start of the clean-up that last ran them. The quiet close is
  at 30 days, not the 90 first proposed (your pick: "30 days or less also works"), so a chat's
  files go 60 days after its last word at most, unless you write on it. It also leaves a task that
  needs you open (a question, or a `new:` task's plan PR). A closed
  project takes only its closed chats' files and its pages'. Since answered tasks stay open, a
  box's task folder goes after 7 unchanged days too. Building it found and fixed a bug: a run's
  copy of a task's labels kept only its state label, so a split's part never closed a day after
  its answer.
- **Progress (part 3):** the start-up reads are one GraphQL read in the task step, reused by think:
  2 calls before the agent starts, from 5 or 6. The notebook read stays its own (folding it in
  would read 100 pages on runs that end doing nothing). A run's earlier files are listed in the
  prompt with their branch paths, not fetched. A 200-message thread's prompt is 84 KB, with a
  16,000-character Progress. The playbook went from 23.0 KB to 19.4 KB.
- **Projects and pages (part 4):** a chat's project is read in the same family read (both levels,
  100 sub-issues, and the parent's parent), as `s.project`; a chat's own parts stay `s.family`, so
  `go` and "split it" work in a chat. With one repo, a chat's run is told a change goes to it
  (`work` with that project), rather than every chat cloning it. The door's **New chat here**
  writes `Part of #n` first and links the sub-issue; unlinked (a full project) it says so.
  **Move to project** links and labels, once: a chat in a project already, or a split's part, is
  told so. The web chat's page edits go through GitHub's Edit (the door has no page-edit route
  yet): its words, and `jot`, `add` and `project:`, are the door's. `add <name>: …` with no open
  project of that name is words, and opens a task ("Add tests: …"). A project's own thread doesn't
  split: its parts could never start, so a split goes in one of its chats.
- **The Library (part 5):** `ship notebook list` shows the always and on-demand pages and counts
  each project's; `read` takes any by its topic. The prompt names the on-demand Library, not a
  count of its pages (a count is one more read on every run). A run writes a page through `pages`
  at once: its project's, and a page of no project only when it read nothing from outside.
  "organize my journal" asks before it writes (the skill), rather than the box listing pages for
  a `yes` (a page's whole text doesn't fit the status comment that holds a list). The box takes a
  page's file out of the run itself (it needn't be in `files`), and every write keeps the door's
  hidden first line, which names you, so a page the door made stays yours. The agent's own `ship
  notebook` gets your login, your people and the door App's slug, so it trusts those pages too
  (the sandbox lets the slug through, nothing else of the door's); a read run gets none of them,
  and writes no page.
- **Inbox (part 6):** "collate the inbox" in a project's chat or thread reads the Inbox page's
  comments after its `Collated up to item <id>.` line, yours only (your login, or the door's line
  naming you), 30 a run, their files 5 a run; the run writes that line back through `pages`.
- **Export (part 7):** `export.js`, 4 KB of its own; a zip stored or deflated by the browser's
  `CompressionStream` (stored where there's none), read back by a real unzip in its test. It reads
  every page of each chat, asks first past 50 MB of files, and names each file in it safely, once.
- **The Desk and the project page (parts 4 to 8):** the Desk is the first screen, so `desk.js`
  and `desk.css` count in the page's 42 KB: with them it was 44.5 KB, over. To fit (41.5 now),
  what the first screen doesn't use loads when first needed: the Library (`library.js`), Find in
  this chat (`find.js`), diagrams (`draw.js`), a file's shrink and upload (`attach.js`), New
  project's form (in `project.js`), and the picker's, setup's and New repeat's styles; `repeat.js`
  holds the Repeats page. The phone's Desk reads the list on each check while it shows; a
  project's fold keeps no ETag of its own page's read; the project's box sends with `under` from
  `app.js`, so a chat it opens is always in the project; the tabs replace the page's route, so Back
  stays in the app. **New project** is on the Desk only. **Add** takes
  one file a time (the door files a group's first file under a save). An Inbox item's file is
  filed under the Inbox page, so it goes with its project. The Desk shows a moved chat under its
  project only once the project's thread was read. Ctrl+K also finds your projects. The screens
  were checked by the page's source tests and a fake DOM, not yet in a real browser or on a phone.
- **The stress test** became unit tests (`tests/kernel-thread.test.ts`, `tests/projects.test.ts`,
  the notebook's and the routes' tests), and `scripts/stress-0069.ts` is gone.
- **Two lines in `task.yml`, added by you on main** (a run can't push a workflow file): skip
  `library` as `notebook` is skipped, and skip an issue labelled `project` on `opened` and
  `edited`. The box skips both itself as well.
- **Progress (part 3), after the review:** a full one keeps its goal and its newest end, and the
  middle goes. A read run gets a long thread whole, as it has no command to read an older message.
- **A review before the merge** (2026-11-02, the owner's "are we sure … no existing rules and
  setup will break") found the bugs above that this section names as fixed, each with a test.
- **A run's context, after task #655** (2026-11-03, the owner's "well guided end to end, swept and
  updated"): a chat's prompt lists the project's newest 30 chats and every one at work, waiting
  on you or failed, and counts the rest with the command that lists them (100 chats were about
  7 KB on every run; now about 3 KB). A failed read of the notebook, the project's pages or the
  family, and a page left out as someone else last edited it, are each a line in the run's notes,
  not a silent gap. A page shown whole has no index line as well; the rest are listed by title
  and first line. A project's run is pointed to your other projects through `ship notebook list`,
  with no new read. The playbook points to the prompt's notebook, pages and Finish sections
  instead of saying them again. What a run gets: `docs/knowledge.md`.

## Not in it

- **A project's own file folders** beyond its Inbox and chats: ADR 0065's part 3, its own design
  (R2 makes it small later).
- **A notes repo** for offline editing: later, if you want it.
- **Telegram's files in the Inbox:** words and links first.
- **A run reading a drop's files** (what people sent you through a `collect` drop): Drop's tool
  lists them and fetches none. A look call that fetches one into `in/files` is small, later, if
  you want it.
- **A run's file over 25 MB** (a video, a big data set): not kept today ("Not shared: over 25 MB").
  It could go to R2 only, through the edge, up to 100 MB, if you need it.
- **Moving what's in Notion:** a task when you want it, not a migration.

## Docs this touches

`docs/channels.md` (the web chat: drops, the buttons, Quiet, projects, Inbox, export, Desk,
Progress, Jot, files in R2 and how long they stay), `docs/tasks.md` (no close after a quiet day,
the 30-day close, a project and its chats, long threads), `docs/watch.md` (the weekly clean-up's
two new steps), `docs/notebook.md` (becomes the Library: its reaches, a project's pages, the Journal, the
door's edits), a new `docs/knowledge.md` (the process, section 11), a new `skills/knowledge`,
`docs/door.md` (the buttons' actions, the new words, the `forget` route), `playbooks/task.md` (the result's `pages`),
`docs/setup.md` (the R2 bucket, a billing alert), `edge/wrangler.jsonc` (`BUCKET`; what KV's
`FILES` holds now), `docs/tools.md` and `skills/drop` (a drop takes a file you sent by its ref),
`docs/security.md`, `docs/glossary.md` (project, Quiet, Inbox, Library, Journal, Map, Progress), `intents.json` (`project:`, `add`, `jot`), ADR 0036's, 0040's, 0041's, 0047's, 0065's and
0066's "amended by" lines, the ADR index, and `CHANGELOG.md`.
