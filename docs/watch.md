# The watch

The edge's check every 5 minutes, in the same Worker as the door ([door.md](door.md)). It reads
shipify as the door App, does its duties, and keeps nothing between ticks. It never does the work
itself: it **rings** the status task's runs by adding a label, so it needs no Actions write. It
never starts a task's run: only your words do (ADR 0042). What it finds wrong, it tells you once.

## Every 5 minutes

Five duties, in order, each from what GitHub says now:

| Duty | Looks for | Does |
|---|---|---|
| **due** | a repeat's time (the record's `watch.next`), a day since the last due run, or a task labelled `deploying`: a deploy or a staging app's release PR to follow (its merge, then its production deploy, marked `shipify/production`), on an open or closed task (a merge closes its task) | rings `watch:due` on the status task; while it follows one, every 10 minutes at most. Not while a due run is under way, nor within an hour of a failed one |
| **stopped** | an open task whose run ended before it finished (its status comment still says `working`: the box restarted, the run broke off), or whose words have waited 10 minutes with no run at all (GitHub never started one) | never starts a run (ADR 0040, ADR 0042): labels it `stuck`, shown as **Stopped** in every list, and alerts once ("reply `continue`"). Your `continue` carries it on from where it got to. A few a tick; never the status task, notebook pages or PRs |
| **notice** | a run's reply 2 to 70 minutes old with no 🚀 or 😕 of the door App's (its words never reached a chat it was for) | sends each of those chats one short notice: "#n has a reply you didn't get here", with its link. Then 😕 on the reply, so it's never noticed twice. If the notice can't be sent either, a note on the status task. A reply is never sent twice |
| **guard** | boxes, apps, Telegram, key dates, runners | notes what changed (below) |
| **pin** | the status pinned in your Telegram chat (`/ping pin`): each box's busy slots and the tasks working, from the runners and open tasks this tick read already | edits it in place, with no sound, only when what it says changed; Telegram is asked only then (or half an hour on). Unpinned, or another message pinned since, it's left alone |

**What the guard watches:**

| Guard | Says so when |
|---|---|
| **boxes** (runners labelled `shipify-box`, by `box-<name>`) | every slot offline now and 4 minutes later; back; gone |
| **apps** (each app's public `/health`, 8 a tick in turn, so every app within ⌈apps ÷ 8⌉ ticks) | failing now and a minute later; fine again. A taken-down app never alerts |
| **Telegram** (its webhook, every 30 minutes) | its token refused, or a recent error with messages waiting; fine again. While it's fine, its menu is set again where it differs from `intents.json` (checked once an edge instance) |
| **key dates** (the variable `SHIPIFY_KEY_DATES`) | 30 days before a date, and 7 |
| **runners** (each box's, from its health) | a newer one has been out 25 days: GitHub stops sending jobs to the old one at 30 |
| **the door App's key** | GitHub refuses it: said straight to your chat once, until GitHub takes the key again (GitHub can't be written to meanwhile, so the edge remembers it told you) |

**Then it says what it found:** a comment on the status task, as the door App: a hidden
`<!-- shipify-findings {…} -->` line, then the same in words. Then it rings `watch:alert`, or
`watch:alert-github` when no box is online (once: a later finding gets its comment, unrung).

**Its budget:** Cloudflare allows 50 outside calls a tick. The watch stops at 44, keeps 4 for its
alert, and leaves the rest for the next tick. On a new Shipify, its first tick opens the status
task.

## The runs it rings

`watch.yml` takes a label only on the status task, and only from you or the door App. Each run
takes its own label off; when it can't, its log has a warning. A label still on with no run of its
kind queued, going or started in the last 10 minutes (GitHub dropped the event, or the run couldn't
take it off) is taken off by the watch and rung again when needed, so it never keeps the watch
quiet. You can start any
of them by hand: Actions → watch → Run workflow.

| Run | Started by | Runs on | Does |
|---|---|---|---|
| **due** | `watch:due`, or your merge that touched `recipes/` | any box | starts each due task's own run: a repeat, a release, a deploy that's up, failed or 30 minutes late; closes a task quiet for a day itself, with no run (ADR 0040). Once a week, at `SHIPIFY_DIGEST` (every Monday at 9:00 by default, or `off`), says the week to your default chats: boxes, apps (live, failing, behind their stack), what waits on you, keys due within 30 days, what's coming up; "all clear" when nothing is (ADR 0053). It follows a PR's checks only when you asked, with an errand: each task labelled `waiting` (open or closed) whose look has come gets one GitHub read with the bot's read-only key, and its run is started once the thing has happened, its time is up or it can't be read; otherwise it's listed at its next look, 10 minutes on in its first hour, then 30 (ADR 0054). Keeps recipes and their tasks in step: a new file's task opened, a changed or removed one's run started, a file that doesn't read said once ([recipes.md](recipes.md)). Starts each box's weekly clean-up once its last is a week old. Writes this box's health, "Coming up", the apps list, Shipify's own repos and an entry for each account you added (`/repos`, ADR 0047), the recipes, `watch.next` and `watch.last` |
| **cleanup** `<box>` | the due run | that box | removes closed tasks' folders and agents' old run folders; runs doctor (the sandbox check included); checks the door answers; takes the newest Node 22.x; prunes the package store when no other slot is busy |
| **alert** | `watch:alert`, `watch:alert-github` | a box, or GitHub's machines when none is online | reads the door App's newest findings, writes them in the record, and posts an `alert` reply, which the door copies to your default channels as it does any reply |

- **The due run reads the apps' repos** (deploys, previews) with the bot's one-hour read-only
  token: the door App sees shipify alone.
- **Behind them:** `ship watch due`, `ship watch cleanup [<box>]`, `ship watch alert ['<findings>']`.

## The status task and its record

The issue labelled `shipify-status` (open or closed): pin it and subscribe. Its body starts with
the record, `<!-- shipify-status {…} -->` (`"v": 2`), then shows the same to you: the last due run
and the next time, each box's health and clean-up, failing apps or channels, "Coming up", recent
events. The runs write it; the watch only reads it. The shapes, in `cli/contracts/watch.ts`:

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
  `watch.notice`, `watch.guard`).
- **Stopped:** no due run for a day. `/ping`, `pnpm ship doctor` and `pnpm ship selftest core` say
  so. Check `pnpm ship door check` and the edge's logs: often it's the door App's key
  ([door.md](door.md#a-new-key)). Meanwhile, Actions → watch → Run workflow (`due`).
- **A task labelled `stuck` (Stopped):** read what its alert says, then reply `continue`, or close
  it. Your next words take the label off; the watch skips the task meanwhile.
- **More:** [troubleshooting.md](troubleshooting.md#repeats-and-the-watch).

## Adding a duty

One more line in the same check, never a new part: the decision in `edge/src/watch.ts` (a pure
function, tested in `tests/edge/watch.test.ts`, reading only what the door App can); a new finding
in `cli/contracts/watch.ts` and the alert run (`cli/commands/watch.ts`) when there's new work; and
this page. A duty that needs a wider key gets its own ADR first.
