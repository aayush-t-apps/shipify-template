---
status: accepted (merged #680, task #679, 2026-11-05) and built in two parts after the owner's `go`: Drop's (task #682, Drop 0.5.0) and Shipify's (task #683); see [As built](#as-built-2026-11-06-shipifys-part-on-task-683). Amended by 0073 (a guest's page goes to Drop too, only theirs until they share it in My drops, and stays in their chat; every new drop is Only me unless the words say who; Drop's people sign in with Google)
date: 2026-11-05
amends: Drop's plan (`plans/drop.plan.md`: AC5.2, a page opens inside Drop's viewer; a drop of one page opens straight to it; its admin page shows the page under a Share panel at the top), and the box's reply (a file that a tool's call took shows as that call's answer, not as a file)
---

# 0072: Pages, like Claude's artifacts: asked for in the chat, a link from Drop

## The plan in short

**Your asks (task #679):**
- The playground runs on Cloudflare. Could it, or many like it, run on GitHub Pages?
- Something like Claude's artifacts: make simple pages from information, and open and share them by
  a simple link, as Claude and doc tools do.
- Two tools, each strong on its own: **Drop** a self-sufficient tool with its own UI and API, and
  **Shipify** a user of that tool.
- Nothing to show in the chat: no custom handling, no button, no file. Ask in the chat, and get
  Drop's link. Show or share on Drop's page, with Share at the top.
- What a page can do with HTML and JS (buttons, a simple store), and how it works.
- Simple, secure and free of issues: few builds, no new service, Worker, database or setting, and
  no calls that aren't needed.

**The answer:**

| Tool | Its job | What it gains |
|---|---|---|
| **Drop** | Shows and shares files, with its own UI and API | A page opens in its viewer. The link of a one-page drop opens the page. Its admin page for a drop shows the page under a **Share** panel at the top |
| **Shipify** | Makes the page when you ask, and gives it to Drop through its Drop tool, as today | Skill lines, and one small box change: the reply shows only Drop's link, not the file |

- **You ask in the chat:** "make a page of my trip plan" (and, if you want, "share it with Mom and
  Dad for 7 days"). The reply is a link. Open it: Drop shows the page, with **Share** at the top.
- **The page runs in the browser of whoever opens it,** sandboxed. Nothing runs on a server.
- **The only line between the two tools is Drop's API,** which Shipify's Drop tool already uses.
- **A press** is you pressing a button: a tap on a phone, a click on a PC.
- **The build is 2 PRs:** Drop, then Shipify (section 12).
- **The playground stays on Cloudflare** (section 2).

## 1. What we have today

| Part | Today | What's missing |
|---|---|---|
| Shipify's Drop tool (`tools/drop`, `skills/drop`) | `list`, `publish`, `update`, `revoke` on Drop's `/api`, from the box, with a service token. A new drop the owner's words ask for is made at once (pre-approved). Its answer gives the link and "Manage it in Drop" (`/admin/d/<address>`) | Nothing |
| The box's reply (`cli/kernel/apply.ts`) | A call can take only files the reply shared (`cli/kernel/mcp-client.ts`), and each shared file shows in the chat as a file, with a copy in the chat's store | A page given to Drop shows twice: as a file and as the link |
| Drop (`plans/drop.plan.md`) | Files by a link or for named people, with an expiry, a PIN, a new link and a daily clean-up, in its admin UI and its API | An `.html` file downloads (AC5.2). A page has no Share panel of its own at the top |

### How Drop works, from its code

Read by this task's talk run (`aayush-t-apps/drop` at `ddf804a`, 2026-11-05, with task #681's
account of it). The work runs' key reaches only the shipify repo, so these facts are that run's.

```
You ─────── /admin, /api ─→ Cloudflare Access ─┐
Shipify ─── /api (service token) ─→ Access ────┤
Anyone ──── /d/<address>.<secret> ─────────────┼─→ Drop Worker ─→ one private R2 bucket
Person ──── /h/<id>.<secret>, /in (email code) ┘   (checks first)   drop.json + files
Daily job ──→ revokes every drop past its expiry
```

- **One Worker in front of one private R2 bucket.** No D1, no KV, no Durable Object. Its checks run
  before anything is sent.
- **A drop is a folder,** `<exp>/<dropId>/`: `drop.json` (title, expiry, gate, PIN hash, link
  hashes and roles, people, limits) and its files. Revoke and the daily job delete the folder.
- **Two facts the build needs:** `securityHeaders` (`src/worker/headers.ts`) puts Drop's page CSP
  (`frame-ancestors 'none'`) on **every** HTML answer, and `serveFile` sends `.html` as a download.

Drop's access stays as it is: JSON in a private bucket, checked by one Worker on every request, is
simple, cheap and strong for one owner. No database is needed.

## 2. GitHub Pages: not for this

| | Cloudflare (today) | GitHub Pages |
|---|---|---|
| Cost | Free; static files are served free, with no request limit | Free **only for a public repo**; a private one needs a paid plan (rule: "Free only") |
| Who can open it | You choose: Access, a Drop link, or public | Always public on the free plan, and the source too |
| Many sites | One Worker each, or folders in one site, as the playground does | One site for each repo |
| PR preview links | Yes | No |

GitHub Pages would add a host and lose the previews and the privacy, for no gain. From GitHub's and
Cloudflare's docs as known, not read again in this run.

## 3. The flow

1. **Ask.** In a chat: "make a page of my trip plan", or attach a CSV, a PDF or a photo and say
   "make a page from this". Add "share it with Mom and Dad for 7 days" when you want that too.
2. **The run makes it.** One `.html` page, with everything inside it. The same run gives it to
   Drop: only you can open it, unless you said who. Asking for a page asks for its drop, so it is
   made at once (the pre-approved `publish`).
3. **The reply is a link.** No file and no view in the chat: only Drop's link. Open it, and Drop
   shows the page, on a phone too.
4. **Share at the top, like a doc.** On your view of the page, Drop's **Share** panel: who can open
   it (only me, anyone with the link, named people), for how long, a PIN, **Copy link**, **New
   link**, **Stop sharing**. Or say it in the chat ("share the trip page with Sam"), and the run
   proposes the change for your Yes.
5. **Someone opens your link.** Drop checks it and shows the page, under a thin bar (the title,
   Download).
6. **A change.** Ask for one in the chat. The run makes the page again and proposes one `update`
   (delete the old file, add the new one: the tool deletes first, in `tools/drop/server.ts`), so
   the link stays the same. It waits for your Yes, as every change does.

**Guests** (ADR 0071) can ask for a page in their own chat. Their runs have no tool, so their page
comes as a file in their chat, which **Download** opens in their browser. To share a guest's page,
you share it from your own chat.

## 4. What a page can do

A page is one `.html` file: HTML for its parts, CSS for its look, and JS for what it does. It runs
in the browser of whoever opens it, in a sandbox.

| Works | How |
|---|---|
| Buttons, tabs, filters, search, sort, toggles | JS in the page |
| Calculators, checklists, quizzes, timers, simple games | JS in the page; what you press lives until you close it |
| Tables and charts | HTML tables, inline SVG or a canvas |
| Pictures | inside the file (`data:`), small ones |
| Links to other sites | they open in a new tab |
| **Print** | a button that calls `print()` |
| **Save to your device** | a button that downloads what the page holds (CSV, JSON) |
| **Open a saved file** | a file picker; the page reads it in the browser |

| Doesn't work, on purpose | Why, and what to do instead |
|---|---|
| Remember things in the browser between visits (`localStorage`, cookies) | The sandbox gives the page no storage, so it can't read Drop's either. Use Save and Open, or keep the data in the page |
| Send anything out (a form, a vote, analytics) | No `connect-src` and `form-action 'none'`, so a page can't leak what it holds |
| Load scripts, fonts or pictures from the internet | Nothing from outside: everything is inside the file |
| A **shared store**: what one person presses, all see (votes, a shared list, sign-ups) | It needs Drop to keep data and the page to reach Drop. That is a task of its own (later; a design is in commit `e8e2d6a`) |

**The simple store, with nothing to build:**
- **The data lives in the page.** Ask in the chat ("add Tuesday's dinner"), and the run updates the
  page; the link stays the same. The run is the editor.
- **A visitor's own copy.** **Save** downloads their data as a file, and **Open** reads it back.

## 5. Each tool on its own

- **Drop is complete without Shipify.** Its UI shows and shares a page for you, and its API does the
  same for any client. A page is just a file to it. Nothing in Drop names Shipify.
- **Shipify uses Drop only through its tool,** as today. `tools/drop` is the one part of Shipify
  that knows Drop; the core names no provider (`tests/core.test.ts`). The box change of section 7
  is for any tool's call, not for Drop.
- **The chat doesn't change.** No new button, view or route, and it never talks to Drop.
- **Each can change on its own** while Drop's API stays the same.

## 6. Drop's change

One PR in Drop's repo. Its API and Shipify's Drop tool don't change.

1. **A page opens in its viewer** (AC5.2): with `?view=1` and `Sec-Fetch-Dest: iframe`, an `.html`
   file goes inline with the header below; else it is a download, as today. The frame has the same
   `sandbox` flags. `securityHeaders` sets Drop's page CSP only on an answer that has none, so a
   page keeps its sandbox. SVG stays a download.
2. **The link of a one-page drop opens the page,** full size, under a thin bar (the title,
   Download), on a phone too.
3. **Its admin page for a drop that holds a page** (`/admin/d/<address>`) shows the page full size,
   with a **Share** panel at the top. The panel holds the share controls the admin page has today
   (who can open it, for how long, a PIN, Copy link, New link, Stop sharing), so nothing new is
   kept.
4. **Tests and its spec:** AC5.2, the header and the frame rule, a one-page drop, the admin view,
   and Drop's own pages keep their CSP.

The page header:

```
content-security-policy: sandbox allow-scripts allow-popups
    allow-popups-to-escape-sandbox allow-downloads allow-modals;
  default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none';
  form-action 'none'; frame-ancestors 'self'
```

- `sandbox` without `allow-same-origin` gives the page an opaque origin: it can't read Drop, its
  cookies or its storage. No `allow-top-navigation`: it can't move Drop's page.
- `connect-src` falls to `'none'`, so the page's script sends nothing out.
- `allow-popups` and `allow-popups-to-escape-sandbox` let links open in a new tab. `allow-downloads`
  lets **Save** work, and `allow-modals` lets **Print** work.

## 7. Shipify's change

One PR in Shipify's repo:

1. **The reply shows the link, not the file** (`cli/kernel/apply.ts`). A file that one of the run's
   calls took, and that call worked, is left out of the reply's files and of the chat's store: the
   call's answer (Drop's link) is in the reply. The box still keeps it on `shipify-files`, as the
   call needs it. When the call fails, or waits for a Yes, the file shows as today, so nothing is
   lost. It names no tool. A test covers both cases.
2. **`skills/frontend-design`** gets **A one-file page**: what section 4 says works and doesn't;
   CSS, scripts and data inside it; charts as inline SVG; no storage (Save and Open instead); mobile
   first (360 px), light and dark, under 1 MB.
3. **`skills/drop`** gets **A page**: asking for a page asks for its drop, so name it in `files`
   and `publish` it in the same run (`share: "me"` unless the owner said who); the reply is its
   link; a change is one `update` that deletes the old file and adds the new one.
4. **`playbooks/task.md`** gets one line that points to both. **`playbooks/guest.md`** gets one
   line: a guest's page is a file in their chat.
5. **Docs:** `docs/tools.md` (a page is a Drop link), `docs/glossary.md` (**page**).

## 8. Options not taken

| Option | Why not |
|---|---|
| Pages in the chat's pane, sandboxed (commit `030eb0b`) | Custom handling in the chat, when Drop's page shows it already |
| The chat's own Share panel and Shared list, through a service binding to a `Share` entrypoint in Drop (commit `c4b01b6`) | It joins the two tools, and it copies Drop's UI into the chat |
| The chat calls Drop's API with a key of its own | A Drop key on the part that faces the internet |
| The chat makes its own links | A second sharing system beside Drop |
| Browser storage for pages, on an address of their own | A second host to set up, and pages there could read each other's data |

## 9. Security

| Risk | Wall |
|---|---|
| A page's script reads Drop, its cookies or storage | `sandbox` without `allow-same-origin`, in the header and on the frame: an opaque origin |
| A page's script sends data out by itself | no `connect-src`, nothing from outside, `form-action 'none'`; the frame can't go to another site (Drop's `default-src 'self'`) |
| A link in a page carries what a visitor typed to another site | only when the visitor presses that link; pages come from your own runs; Drop's thin bar shows whose page it is |
| A page poses as Drop | inline only into a frame (`Sec-Fetch-Dest: iframe`), never alone in a tab; a new tab on its own address gets a download |
| A page goes out without you | it is only yours (`me`) unless your words said who; every change waits for your Yes |
| Shipify gets more power over Drop | no: the same tool, API and service token as today, on the box only |
| A link leaks | Drop's own: New link, Stop sharing, the expiry, a PIN |
| Drop's own pages lose their CSP | `securityHeaders` still sets it on every answer without one; a test checks Drop's pages |

Nothing new faces the internet, and there is no new key.

## 10. Edge cases

- **A run that read the web** (a page from a search): its `publish` waits for your Yes, as for any
  run that read from outside. Until then the page shows as a file.
- **No Drop set up, or Drop doesn't answer:** the page shows as a file in the chat, and the reply
  says why.
- **A page with a script error:** the frame shows what it shows; Download still works.
- **A browser that sends no `Sec-Fetch-Dest`** (an old one): the page downloads.
- **Expiry:** only-me pages end after 7 days unless you said "keep it"; the daily job cleans them
  up. The file stays on `shipify-files`, as every shared file does.
- **Named people** open a drop with an email code at Drop's `/in`. Each one takes one of Access's 50
  free seats, shared with your guests.

## 11. Consequences

- **Easier:** you ask in the chat, and you get a link that shows the page, as with Claude's
  artifacts. Drop shows and shares it fully on its own, with Share at the top, as a doc does. The
  chat shows nothing new.
- **Harder:** a change to a page takes your Yes. A page keeps nothing in the browser between visits.
  Guests' pages are files only.

**Confirmation:** Drop's tests (section 6); Shipify's reply test and skill check (section 7); and by
hand, a page asked for in the chat comes back as only a link, which opens it on a phone with Share
at the top, and its links, Save and Print work.

## 12. The build, after `go`

Two parts, one PR each. The `go` run proposes them as a split:

| # | Part | Starts | Done when |
|---|---|---|---|
| 1 | **drop:** section 6, with its tests and spec | at once | a one-page drop's link opens the page, on a phone too; your admin view shows it with Share at the top; asked for alone, the file downloads |
| 2 | **shipify:** section 7 | after 1 merges and is live | asked for in a chat, a page comes back as only a link that opens it |

Part 2 waits for part 1 so the skills describe what Drop already does. There is nothing to set up.

## 13. Docs it touches

- **Shipify:** section 7.
- **Drop:** `docs/spec.md` (AC5.2, the admin view), and a change doc.

## 14. Not checked

- Drop's code facts come from `ddf804a`: this run's key can't read the `drop` repo.
- What Drop's admin page for a drop shows today, and where its share controls sit. Part 1 reads it
  first and moves them into the top panel.
- That the box change is as small as it looks. From the code: a pre-approved call is a write before
  the reply (`cli/kernel/decide.ts`), and its outcome goes into the reply's words
  (`cli/kernel/apply.ts`), so the reply can know which files a working call took. Part 2 confirms
  it with a test first.

## 15. Later, only if you ask

Each is a task of its own: a shared store in a drop (votes, a shared list; commit `e8e2d6a`); a
change to a page without a Yes; guests sharing their own pages; pages shown inside the chat (commit
`030eb0b`); one-press Share in the chat (commit `c4b01b6`); the playground keeping a page for good
with no PR.

## As built (2026-11-06, Shipify's part on task #683)

Built as section 7 says, with these facts found in the code and in Drop's part:

- **The box knows which files a call took from `tools.json` alone:** each call's `args.<call>.files`
  (`callFiles`, `cli/kernel/mcp-client.ts`, which `makeCalls` uses too). Apply keeps the names of
  the files that the calls that worked took, and the reply leaves them out of three places: its
  line's `files` (the chat's store), its **Files:** block, and the files sent to the door. Section
  14's open point holds: a pre-approved call is a write before the reply, so the reply knows.
- **`publishMade` gives a line per file** (`cli/commands/task/files.ts`), so the **Files:** block
  holds only the files shown.
- **A later run still finds the page:** it stays in the task's shared files on `shipify-files`, which
  the prompt lists under "Files earlier runs made", with the command to read one. The next run in
  the chat doesn't get it as a chat file, as it isn't in the store, so `skills/drop` says to read it
  from there for a change.
- **From Drop's part:** a link inside a page opens only in a new tab (`target="_blank"`, in
  `skills/frontend-design`); a one-page drop's link opens the page, and a page beside other files
  gets an **Open** button, so `skills/drop` puts a page alone in its drop; Safari before 16.4
  downloads the page.
- **Left as it is:** a file shared before and unchanged is linked as "(unchanged)" in the reply
  (`sharedBefore`, ADR 0062), not shown as a file, so a call that takes it again leaves that link.
- **Checked:** `tests/kernel-flow.test.ts` (a call that worked, one that failed, one that waits for
  a Yes) and the skill check. By hand, after the merge: a page asked for in a chat comes back as
  only Drop's link, which opens it on a phone with Share at the top.
