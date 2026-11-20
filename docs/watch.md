# The watch

The edge's check every 5 minutes, in the same Worker as the door ([door.md](door.md)). It reads
shipify as the door App, does its duties, and keeps nothing between ticks. It never does the work
itself: it **rings** the status task's runs by adding a label, so it needs no Actions write. It
starts a task's run only for your words no run answered, once (task #786): your ask, late. A run
that ended early waits for your `continue` (ADR 0042). What it finds wrong, it tells you once.

## Every 5 minutes

Five duties, in order, each from what GitHub says now:

| Duty | Looks for | Does |
|---|---|---|
| **due** | a repeat's time (the record's `watch.next`), a day since the last due run, or a task labelled `deploying`: a deploy or a staging app's release PR to follow (its merge, then its production deploy, marked `shipify/production`), on an open or closed task (a merge closes its task) | rings `watch:due` on the status task; while it follows one, every 10 minutes at most. Not while a due run is under way, nor within an hour of a failed one |
| **stopped** | an open task whose run ended before it finished (its status comment still says `working`: the box restarted, the run broke off), or whose words have waited 10 minutes with no reply and no run going (GitHub never started one, or it broke before it could say so) | a run that ended early: labels it `stuck`, shown as **Stopped** in every list, and alerts once ("reply `continue`"), never starting it (ADR 0040, ADR 0042). Words no run answered are your ask, late: it starts their run once more by itself (task #786), with one comment of the door App's on the task ("No run answered your words here for 10 minutes, so Shipify started one for them again."), whose event starts `task.yml` as a chat's words do (the web chat shows it as Shipify's note). The comment's first line is `<!-- shipify-again -->` and it has no `from` line, so it's never your words: it approves nothing, and the run reads only yours. Only when that run doesn't answer in 10 minutes either is the task Stopped, and the alert asks for `continue`. A stay's `staying` label (ADR 0057) comes off first, so the run isn't skipped, and on any tick once no run goes for its task (its box died), so your next words start one. Your `continue` carries it on from where it got to. A few a tick, starts and marks together; never the status task, notebook pages or PRs |
| **notice** | a run's reply 2 to 70 minutes old with no 🚀 or 😕 of the door App's (its words never reached a chat it was for): one GraphQL read a tick for the marks of all of them | sends each of those chats one short notice: "#n has a reply you didn't get here", with its link. Then 😕 on the reply, so it's never noticed twice. If the notice can't be sent either, a note on the status task. A reply is never sent twice |
| **guard** | boxes, apps, Telegram, key dates, runners | notes what changed (below) |
| **pin** | the status pinned in your Telegram chat (`/ping pin`): each box's busy slots and the tasks working, from the runners and open tasks this tick read already | edits it in place, with no sound, only when what it says changed; Telegram is asked only then (or half an hour on). Unpinned, or another message pinned since, it's left alone |

**What the guard watches:**

| Guard | Says so when |
|---|---|
| **boxes** (runners labelled `shipify-box`, by `box-<name>`) | every slot offline now and 4 minutes later; back; gone |
| **apps** (each app's public `/health`, 8 a tick in turn, so every app within ⌈apps ÷ 8⌉ ticks) | failing now and a minute later; fine again. A taken-down app never alerts |
| **Telegram** (its webhook, every 30 minutes: on the hour and the half hour, UTC) | its token refused, or a recent error with messages waiting; fine again. While it's fine, its menu is set again where it differs from `intents.json` (checked with the webhook, once an edge instance) |
| **key dates** (the variable `SHIPIFY_KEY_DATES`) | 30 days before a date, and 7 |
| **runners** (each box's, from its health, against GitHub's newest, read every 6 hours) | a newer one has been out 25 days: GitHub stops sending jobs to the old one at 30 |
| **the door App's key** | GitHub refuses it: said straight to your chat once, until GitHub takes the key again (GitHub can't be written to meanwhile, so the edge remembers it told you) |

**Then it says what it found:** a comment on the status task, as the door App: a hidden
`<!-- shipify-findings {…} -->` line, then the same in words. Then it rings `watch:alert`, or
`watch:alert-github` when no box is online (once: a later finding gets its comment, unrung).

**Its budget:** Cloudflare allows 50 outside calls a tick. The watch stops at 44, keeps 4 for its
alert, and leaves the rest for the next tick. On a new Shipify, its first tick opens the status
task. A check done every 30 minutes or 6 hours goes by the tick's number (its time over 5
minutes), as the apps' turn does: a tick on a new edge instance, which remembers nothing, doesn't
do it again. A working task's run is looked up in the one read of the task runs a tick, and read
alone only when it's older than the newest 30.

## The runs it rings

`watch.yml` takes a label only on the status task, and only from you or the door App. Each run
takes its own label off; when it can't, its log has a warning. A label still on with no run of its
kind queued, going or started in the last 10 minutes (GitHub dropped the event, or the run couldn't
take it off) is taken off by the watch and rung again when needed, so it never keeps the watch
quiet. You can start any
of them by hand: Actions → watch → Run workflow.

| Run | Started by | Runs on | Does |
|---|---|---|---|
| **due** | `watch:due`, or your merge that touched `recipes/` | any box | starts each due task's own run: a repeat, a release, a deploy that's up, failed or 30 minutes late, and a repeating task that needs you for its PRs once each has merged or closed (one read per PR, with the bot's read-only key: that run takes `needs you` off, [tasks.md](tasks.md#repeats)); closes a split's part a day after it's answered, with no run (ADR 0040; no other task closes for a quiet day since ADR 0069). Once a week, at `SHIPIFY_DIGEST` (every Monday at 9:00 by default, or `off`), says the week to your default chats: boxes, apps (live, failing, behind their stack), what waits on you, and right under it each list that lapsed unanswered since the last digest (task #786: one that went with no `yes` or `no` of yours, because its day passed or a merge or your `close` closed its task), named once with its task and what it held ("#779 separate work: …"), so a fix a run found is never lost (write on its task to have it listed again; the close keeps it in the task's state as `lapsed`, and the record's said keys, `lapsed:<task>:<when>`, keep it from being named twice), keys due within 30 days, what's coming up; "all clear" when nothing is (ADR 0053); the agents behind their newest, and first any advisory GitHub lists against a pinned version, which isn't all clear (the two reads each install names in `executors.json`, with no key; it installs nothing, [agents.md](agents.md)); the Node the box runs, from 90 days before its support ends (Node 26's: 2029-04-30; each LTS major's end in `cli/lib/node-support.ts`, beside the major Shipify runs on), which isn't all clear (task #786); the skills the week's runs loaded, from the run rows of the tasks updated that week (the same read as the lapsed lists, eight days back), with the ones none loaded; and a **Projects** line (ADR 0070), each open project with something to say: its Inbox's finds since the last collate, its chats waiting on you, and its chats quiet a week, from one GraphQL read of the open projects and their Inboxes, made only when the digest is said (no line when nothing waits). It follows a PR's checks only when you asked, with an errand: each task labelled `waiting` (open or closed) whose look has come gets one GitHub read with the bot's read-only key, and its run is started once the thing has happened, its time is up or it can't be read; otherwise it's listed at its next look, 10 minutes on in its first hour, then 30 (ADR 0054). Keeps recipes and their tasks in step: a new file's task opened, a changed or removed one's run started, a file that doesn't read said once ([recipes.md](recipes.md)). Starts each box's weekly clean-up once its last is a week old. Fills this box's runner's cache of actions (setup 19, [box-setup.md](box-setup.md#fast-and-current)) with each action the box's workflows pin that it lacks, and says so in Recent ("workpi: 1 action(s) cached for "Set up job""). Applies main's newer box setup to this box, when it's behind and no other slot runs a job (setup 14, [box-setup.md](box-setup.md#its-own-updates)), and says how it went, once. Writes this box's health, "Coming up", the apps list, Shipify's own repos and an entry for each account you added (`/repos`, ADR 0047), the recipes, `watch.next` and `watch.last` |
| **cleanup** `<box>` | the due run | that box | first applies main's newer box setup, as the due run does; removes closed tasks' folders, any task's folder unchanged for 7 days with no run queued or under way (ADR 0069: an answered task stays open), and agents' old run folders; runs doctor (the sandbox check included); checks the door answers; takes the newest Node 26.x, and keeps the two newest (another major goes); prunes the package store when no other slot is busy; keeps the runner's cache of actions to the pins of the box's workflows (setup 19): fills what's missing and removes the rest ("1 action(s) cached for "Set up job", 1 old one(s) removed"). Once a week in all, however many boxes (the status record keeps the start of the clean-up that last ran them; due a week less an hour later), four steps with no agent (ADR 0069): **files**, the web chat's files of chats closed 30 to 60 days ago (or, after a clean-up missed for weeks, since 30 days before the last one; past the first 100, a page a read, up to 1,000), unless they're in an open project, and of a project closed that long ago, its closed chats' and its pages' (an open chat keeps its own), deleted through the door's `forget` route in calls of 500 chats, with every file no chat used made 60 days ago or more (an upload never sent, an old draft's), and the runs' files made 30 days ago or more of what never closes (task #784): an open repeat or recipe, an open project and its open chats, found by the same one read (yours keep their backup on `shipify-files`); and **the 30-day close**, a chat in no open project (one left open under a closed project is a chat like any other) with no word for 30 days, no open PR or open part, and none of the labels it leaves open (a project, a page, `sub-task`, `repeats`, `waiting`, the status task, `recipe`, `deploying`, `staying`, `working`, `needs you`), closed as completed, its status line saying "Closed after 30 quiet days: write on it to open it again". Its one read leaves those labels out and takes the oldest first; and **pages left open**, each open Library page whose `project:<name>` names no open project (a project closed with GitHub's own button, or before its pages closed with it; task #744), closed as completed, none when the open projects fill the read's 100; and **closed tasks' leftovers**, the `github` job started on the status task, on GitHub's machines (below; "closed tasks' PRs and branches: started on GitHub"). Its summary says what each really did ("deleted 12 files (8 MB) of 4 closed chats", "2 files no chat used (1 MB), 60 days old", "3 run files (2 MB) of repeats, recipes and open projects, 30 days old", "no files to delete for 3 closed chats", "closed 2 chats quiet for 30 days (#20, #31)", "closed 3 pages of closed projects (#40, #41, #42)"). The record keeps what the files step did; two clean-ups in a row whose steps failed post an alert ("The weekly clean-up failed twice: … Check the door: `pnpm ship door check`."), and the digest's **Files** line says the last one's numbers, or why it failed |
| **alert** | `watch:alert`, `watch:alert-github` | a box, or GitHub's machines when none is online | reads the door App's newest findings, writes them in the record, and posts an `alert` reply, which the door copies to your default channels as it does any reply. A box gone with a console link in `SHIPIFY_CONSOLES` starts the status task's `github` job, which takes the link out (below) |

- **The due run reads the apps' repos** (deploys, previews) with the bot's one-hour read-only
  token: the door App sees shipify alone.
- **Closed tasks' leftovers** (task #779): the weekly clean-up starts `task.yml`'s `github` job on
  the status task, as that job already holds the bot's key, which writes every repo and which a
  box never holds. With no agent, it lists the repos the bot reaches (none archived), their
  `task/…` branches with their open PRs (one GraphQL query per 50 repos, 100 branches a repo) and
  those tasks' states (one read). For each Shipify branch (its newest commit a run's, or a PR of
  Shipify's open from it) of a task closed 7 days ago or more, it closes the branch's open PRs,
  each with a comment that says why and how to carry it on (**Restore branch**, then words on the
  task), then deletes the branch. An open task's branch, one closed since, and one named so by
  hand stay; a PR that didn't close keeps its branch. The status task's Recent says what it did
  ("closed 1 PR (shipify#760) and deleted 7 branches of tasks closed 7 days ago or more",
  "nothing left by closed tasks"), or why it stopped; the next week tries again.
- **A gone box's console link** (task #803): the same job takes out each box's link in
  `SHIPIFY_CONSOLES` whose box has no runner on GitHub (GitHub dropped it after 14 days off, or
  it was removed there with no `box remove`), so `box list` and the web chat link only boxes there
  are. An offline box keeps its own. Only the bot's key writes a variable (an installation token
  has no narrower permission for it), so it runs there, not on a box. The weekly clean-up starts
  it, and so does the alert for a gone box that had a link. One read of the runners when any link
  is kept, one write when a box is gone; Recent says it ("Box consoles: took out homepi's console
  link: the box has no runner on GitHub").
- **Behind them:** `ship watch due`, `ship watch cleanup [<box>]`, `ship watch alert ['<findings>']`.

## The status task and its record

The issue labelled `shipify-status` (open or closed): pin it and subscribe. Its body starts with
the record, `<!-- shipify-status {…} -->` (`"v": 2`), then shows the same to you: the last due run
and the next time, each box's health and clean-up, failing apps or channels, "Coming up", recent
events. The runs write it; the watch only reads it.

**Which one it is:** the door and the runs find it by one rule (`pickStatusIssue`): of the issues
with the label, an open one first (the one that holds the record, then the oldest); with none
open, the newest closed one that holds the record. They list the open ones, and all of them only
when no open one holds the record. A list can leave an issue out for a while with no error, so
neither opens a new one until a second look finds none too. Any other open one (a list that missed
the real one) is closed and unpinned by the next run that writes the record, and said under Recent.
Closing a status issue starts no run.

**A new one:** open an issue with the `shipify-status` label (any title and text) and pin it. The
door rings a due run on it within a few minutes, and that run moves the record there from the
newest closed one ("The record moved here from #n" under Recent). The door opens one itself only
when there's none at all.

The shapes, in `cli/contracts/watch.ts`:

| Shape | Lives in | Holds |
|---|---|---|
| `RecordSeen` | the status task's record | `watch.next` (the soonest repeat), `watch.last` (the last due run), `boxes` (offline since, health, runner version), `apps` (id, address, paused, failing since), `channels` (failing since), `alerted` (notes already said), `upcoming` and `events` (for the status page), `recipes` (each recipe and its task) |
| `TaskSeen` | each task's status comment (`<!-- shipify-task {…} -->`) | `working` (the run under way, by id), `cursor` (the newest comment read) |
| `Findings` | the door App's comment on the status task | boxes (`offline`, `online`, `gone`), apps (`failing`, `fine`, `paused`, `gone`), channels (`failing` with its error, `fine`), and up to 20 notes, each a key and a problem from the catalogue |

Each is read leniently: a field that doesn't fit is left out, never the whole thing.

## Seeing it, and when it stops

- **Where:** the status task; `/ping` (each box, and the last due run); Actions (a due run a day,
  plus one per due repeat or deploy, a clean-up a week per box, an alert only on a change); the
  edge's logs (Cloudflare → Workers → `shipify` → Logs: `watch.due`, `watch.stopped`,
  `watch.again`, `watch.notice`, `watch.guard`).
- **Stopped:** no due run for a day. `/ping`, `pnpm ship doctor` and `pnpm ship selftest core` say
  so. Check `pnpm ship door check` and the edge's logs: often it's the door App's key
  ([door.md](door.md#a-new-key)). Meanwhile, Actions → watch → Run workflow (`due`).
- **A task labelled `stuck` (Stopped):** its run ended early, or no run answered your words even
  after the watch started one for them once more. Read what its alert says, then reply `continue`,
  or close it. Your next words take the label off; the watch skips the task meanwhile.
- **More:** [troubleshooting.md](troubleshooting.md#repeats-and-the-watch).

## Adding a duty

One more line in the same check, never a new part: the decision in `edge/src/watch.ts` (a pure
function, tested in `tests/edge/watch.test.ts`, reading only what the door App can); a new finding
in `cli/contracts/watch.ts` and the alert run (`cli/commands/watch.ts`) when there's new work; and
this page. A duty that needs a wider key gets its own ADR first.
