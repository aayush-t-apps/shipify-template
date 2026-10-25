---
status: accepted and built in the same PR (task #568). From the owner's words of 2026-10-24: "more better UI projects and such management, for eg Claude projects: manage input, output docs, categorize well, can open doc and chat side by side, a much better cleaner work box environment", then "projects with multiple tasks inside organized like tabs, cleanly, with more ease of access". Merging its PR accepts it. Docs pinned to a project and given to every run (part 3 of the plan) are not in it.
date: 2026-10-25
amends: 0036 (a file opens in a pane, not a pop-up; a PDF shows inline there), 0039 (the list by project; parts of the page load when needed)
---

# 0065: Projects as workspaces in the web chat

## The plan in short

**What:** the web chat gets projects as places to work, with what it already reads. Nothing new is
stored, no new service, no new permission:

- **The list by project.** A task's project is the repo its title names (`shipify: …`, `links:
  …`); a task with none is **General**. Each group folds open and shut and counts what needs you
  and what's working.
- **Tabs.** A project's tasks you open sit as tabs over the thread; the first tab is the
  project's page; **+** starts a chat in it. Open tabs are kept per project in the browser.
- **A project's page** (`#/p/<repo>`): its chats, its numbers, its app, its docs as **In** (what
  you sent) and **Out** (what runs made), and **Repo docs** as links to GitHub.
- **The doc pane.** A file opens beside the thread (the whole screen on a phone): Markdown
  rendered, a CSV as a table, text, a picture, a PDF in the browser's own viewer. **Ask about
  this** puts it in your next message.
- **Ctrl+K** finds a project, a task or a doc; **Alt+1…9** picks a tab.

## Why this shape

| Choice | Why | Instead |
|---|---|---|
| A project is the repo a title names | Titles already say it (Change a repo writes `links: `), so every task, from any channel, sorts with no new field | A label per project, or a project store: a write path and a migration for what's there already |
| Tabs are an index of threads; the route stays `#/t/<n>` | Notifications, Back, polling and every link keep working; a tab is only a way back | A route per tab: two addresses for one thread |
| Tabs in the browser (`localStorage`, 12 a project) | They're a view, like a folded group or the pane's width: per device, lost with nothing | Kept on GitHub: a write for each click |
| Repo docs are links to GitHub | The door App has no Contents permission and is installed on shipify only (ADR 0036). Reading a project's files would need a new permission on more repos | Contents: read on every repo: a bigger key for a list of links |
| Markdown rendered by GitHub (`POST /markdown`, as the door App) and cleaned by `clean.ts` | The same two locks as every message; no renderer in the page | A Markdown library in the page: bytes and a new way in |
| A PDF from `…/api/file/<ref>?view=1`, inline, with no sandbox CSP | Browsers' PDF viewers refuse to run sandboxed; `nosniff` and `application/pdf` keep it a PDF, `frame-ancestors 'self'` keeps it in the chat | PDF.js in the page: about 1 MB |
| A browser with no PDF viewer (Chrome on a phone) gets **open it** | `navigator.pdfViewerEnabled` says so; the phone's viewer opens it | A blank frame |
| Ask about this sends the kept file's ref (`up-…` or a run's `run-<task>-…`) | The store's own shapes, checked as before (it must still be there); no copy, no upload | Download and upload again |
| `workspace.js` and `setup.js` load when needed | The page was at 41.8 of its 42 KB; with Setup and Files moved out it's 40.1, and each part has its own budget (9 KB, 5 KB) | A bigger budget for every load |

## The data, within our limits

No new polling. A project's page reads Files' list (kept 60 s at the edge), which the Files page
read already, and the list and the menu it has; the menu gains the record's `projects` and `apps`
(read already for the repos). A Markdown file opened in the pane is one call to GitHub, once a
file: a file never changes, so the Worker keeps its rendering a day. A phone on a project's page
reads the list, since the page shows it.

## Security

What changed is in `docs/security.md` ("The web chat", the doc pane): the PDF's headers, the
Markdown's two locks, and Ask about this's refs. Nothing else is served inline.

## Not in it

- **Docs pinned to a project and given to every run** (part 3): it changes what a run is given
  and where files are kept, so it needs its own design and the owner's `go`.
- **Reading a repo's own docs in the pane:** a Contents permission first (above).
- **A live view of a run's steps:** the roadmap's.

## Docs this touches

`docs/channels.md` ("The web chat": projects as workspaces, Files, what the browser keeps),
`docs/door.md` (the page's parts, the `doc` route), `docs/security.md` (the doc pane),
`CHANGELOG.md`, and this ADR's index line.
