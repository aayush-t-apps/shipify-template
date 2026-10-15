---
status: accepted (merged #421) and built; see [As built](#as-built-2026-10-15)
date: 2026-10-15
amends: 0037 (its option 2, kept small: after a run answers, it keeps reading its task for a few minutes and answers your next words in the same session), 0031 (a run may answer more than once; every answer is still decided and applied as one), 0051 (the run job names no `checkout` or `setup-node`: the box's Node, and Shipify's files fetched only when the box has no copy of the commit)
---

# 0057: Runs that stay, and a faster start

## The plan in short

- **A faster start.** The run job stops downloading `actions/checkout` and `actions/setup-node` on
  every job and uses the box's own Node. It fetches Shipify's files with `git` only when the box has
  no copy of the commit. Apply tells the door as each reply is written, not after every other write.
  That's about 12–25 s off every run (58 s fixed today).
- **A run that stays.** After a run answers you, it stays up to 5 idle minutes and reads its task
  every 2 s. Your plain words go to the same agent session, so the next answer starts in seconds,
  not in a new run. Anything that's not plain words, or needs a key the stay doesn't hold, goes to a
  normal run, as today. A stay gives way when another run needs its slot.
- **Nothing new to run or keep.** No new service, store, key, permission, workflow or slot type.
  Every message still lives on a task. One new label (`staying`), one setting (`SHIPIFY_STAY`), and
  one line in `security.md`.
- **The direct layer (chats off GitHub, a hub on the edge) is parked,** written up below so it can
  be picked up later as a second mailbox for the same loop.

## The owner's asks (task #420, 2026-10-15)

- From any device, signed in through Cloudflare, chat with an agent on your box, fast: "efficiently
  reach from secured web app UI to multiple independent disposable box agents and their flexible
  models".
- Any agent and model. Secrets stay on GitHub. The box stays clean. The rules and core stay intact,
  and changes still go through your `yes`. Long conversations, with no database.
- Blocks and layers that fit together, nothing replaced: GitHub as one way through, a Durable
  Object as another. Cheap, simple, few moving parts; every step thought through.
- Build design A now, cleanly and modularly; park design B in the pipeline.
- Validate before planning ("if we think we are gonna break it or it's not gonna work, confirm
  before writing a plan").
- Repos on your account, on your other accounts and outside them all keep working. Parallel slots
  and boxes aren't compromised. Nothing leaks or pollutes a box. Docker and every box setup still
  work and are tested. The status task and everything working today keep working. No backward
  compatibility is needed.
- Context and tokens used well, with no rework. Each agent follows its own ways and runs isolated.
- Several questions in a row are collated into one reply, for every agent, as today (ADR 0037,
  #224).
- Caches kept, synced and cleaned. Only the clean, recommended handling for each edge case.

## What was found (checked 2026-10-15, `main` at `113a910`)

Measured from task #419's run (`38751523353`, homepi) and seven other `task.yml` runs that day,
from their job logs. Checked on this PC where it could be. Nothing was started on a box.

| Assumption | Found | How it was checked |
|---|---|---|
| Where the 58 s goes | Comment to reply took 58 s plus 41 s of thinking. GitHub's queue took 3–5 s. "Set up job" took 7–17 s. Then checkout 4.3–7.7 s, setup-node ~1.2 s, the task read and plan 10 s, two tokens and the agent check 6 s, decide 3 s, and apply 8 s until the door was told | the run's step times and log timestamps |
| The action downloads are steady | Over 8 runs: `checkout` 1.1–10.7 s, `setup-node` 1.5–3.1 s, the token action 2.4–3.3 s, every job | "Download action repository" lines in 8 job logs |
| An `if:` doesn't save the download | The runner prepares every action a job names at "Set up job", before any step's `if:` is read | each log's "Set up job" lists all three before the first step runs. So the decision drops both actions outright rather than skipping them |
| Every box has Node 22 and git without `setup-node` | `box/setup.sh` installs git (line 70) and Node 22 to `/opt/node`, linked in `/usr/local/bin` (83–97). `ship box add`, `here.sh` (through `box add`) and the Docker image (Dockerfile line 9) all run it. The agent already uses that Node (`place.ts` PATH) | read; and `setup-node` itself only ever "Found in cache" 22.23.3 |
| The checkout is needed only to build the copy and for a push's plans | `PLATFORM_ROOT` is the copy in the built CLI; `.tasks/<n>/` is outside the checkout; `plans.ts` diffs in the workspace on a push | read (`config.ts`, `run.ts`, `plans.ts`) |
| A depth-1 fetch of one commit is small and quick | 2.1 MB, 3.5 s from this PC. One built copy of Shipify is 11 MB, and three are kept, about 33 MB | timed here; `du` of a copy built with `scripts/build-cli.mjs` |
| Apply tells the door late | After every write in the run (`apply.ts:400-406`); 7.9 s into apply in #419 | read; the `door.out.sent` log line |
| A 304 doesn't cost rate limit | Three conditional reads answered 304 left `X-Ratelimit-Used` at 12; the next plain read made it 13 | a live test with `gh api` (a public issue, since this PC's token can't read shipify's issues) |
| Sessions stay in the run's folder | Claude Code `CLAUDE_CONFIG_DIR=config/` (`claude.ts:365`), OpenCode `XDG_DATA_HOME` in `config/` with no `auth.json` (`opencode.ts:370-378`), pi `--session-dir config/pi-sessions` (`pi.ts:147`). No login is kept | read |
| A later step can't reopen the run's folder today | `placeFor` calls `prepareRun`, which removes the slot's runs once per job (`sandbox.ts:519-527`). The session id lives only in `think()` (`think.ts:612`) | read |
| A dispatched run answers unread words | A dispatch with fresh words takes the words path (`decide.ts:336, 689`); a talk run already hands work on this way (`decide.ts:2113`) | read |
| Concurrency is per workflow, so a stay's comments wait | `task.yml:45-47` is workflow-level, so a comment during a stay makes a run that waits in `task-<n>` and reads its `if:` only when it starts. A newer waiting run replaces an older one | read; GitHub's concurrency rules |
| The watch never takes a label off a task | Stopped adds `stuck` and alerts (`watch.ts:466-468`). A `staying` label left by a dead box would make `task.yml` skip even your `continue` | read |
| `selftest chat` would time out | It waits up to 6 minutes for a completed run (`edge/setup/chat.ts:61-82`) | read |
| The job's limit is tested | `timeout-minutes` ≥ 192 + 30 + 15, and the copy's prune age ≥ that limit (`tests/workflows.test.ts:278-282`) | read |
| Today's suites pass | 139 tests in `workflows`, `kernel-flow` and the agent conformance test | `vitest run`, 125 s |

## Options

1. **A second engine with a hub** (task #420's runs 5–10): a Durable Object keeps chats, a warm job
   dials in. That's sub-second, but it adds a store, a protocol and two rule changes, and it breaks
   "no database".
2. **A run that stays, and a faster start:** the same record, the same run, kept open a few
   minutes. Next messages take seconds. Nothing new to keep.
3. **Only the faster start:** every message still pays a whole run.

## Decision

**2**, with option 1 parked as the direct layer (below). The owner agreed every recommendation on
2026-10-15.

### 1. A faster start

- **The run job names no `actions/checkout` and no `actions/setup-node`.** One shell step, "Shipify
  at this commit, only if this box has no copy of it", does the fetching:
  - It empties the workspace, so no earlier checkout is ever read.
  - When the copy for `$GITHUB_SHA` is missing, it fetches that one commit at depth 1. A push also
    fetches its `before` commit, which the plans' diff needs.
  - The token goes in git's environment (`GIT_CONFIG_*`), never on a command line and never saved.
  - The copy step then builds as today, from that fetch, and the rest of the run uses the copy as
    today.
- **Node is the box's own,** `/usr/local/bin/node` from box setup, the same one the agent already
  uses. A box now has one Node for runs and agents. A 22.x fix arrives the way the agent's already
  does: a new image, or `box add` again. The token action stays: it's the known way to mint, pinned
  to a SHA (about 2.5 s a job).
- **The door is told as each reply is written,** still before the status is saved. Labels,
  reactions and notes no longer delay your reply.
- `watch.yml` keeps its checkout: it runs Shipify from source by ADR 0051's choice, a few times a
  day.

### 2. A run that stays

**When.** A run stays only when all of these hold. `decide` says so in a new output, `stay`, from a
fixed list as every output is:
- your words started it (your comment, the door's for you, or a task you opened or edited), not a
  dispatch, repeat, errand, due run or push;
- it thought in the talk or read profile (not work or check);
- its answer is a plain answer, and it needs no token: no push, no act call, no files, no dispatch;
- its agent returned a session;
- the task is open, and `SHIPIFY_STAY` isn't 0.

**The label.** Apply puts `staying` on the task right after the answer and before it tells the door,
so a reply to it from any chat meets the label. `task.yml`'s `if:` gains one line that skips an event whose task
carries `staying`. The status comment says "staying until 14:32" (everything shows on GitHub).

**The step.** After apply, a mint step makes the stay's own read-only token. It covers every
project, as a talk run's agent token does, so it serves both the task's read and the agent. The
repos App mints its own for a run on another of your accounts. Then `ship run stay <n>` runs:

```
reopen the run's folder (no second prepareRun), load the agent's session id from meta.json
loop
  read the task's new comments (ETag; 2 s apart); every ~15 s, read whether a box job is queued
  leave if 5 idle minutes, 45 minutes since its token, the task closed, `stop`, or a box job queued
  nothing new, or only a setting                → keep staying
  plan(snapshot) isn't "think, with the same profile, account, repos, agent, model and effort"
                                                 → hand over, then leave
  👀 and `working` on the status together
  the turn: think's own ask, the session resumed, catch-up rounds, settings given fresh
  afterThink: needs a token (a push, a call, files) → hand over, then leave
  apply the writes: the reply first, the door told, the status (cursor, run details) last
  a write that dispatches (a work run follows a talk answer, as today) → label off, dispatch, leave
leave: `staying` off, one last read (words before the label came off: answered or handed over),
       the agent's processes killed
```

- **Hand over** is today's follow-up dispatch: label off first, then `dispatch run`. The dispatched
  run waits for this job (the task's group), then reads from the cursor and answers what's unread.
- **The gate is plan itself.** `plan()` is pure, a snapshot in and a plan out. If plan wouldn't make
  the same choice the run already made (profile, account, repos, agent, model, effort), the words go
  to a normal run. That keeps every account and repo rule exactly as it is: one task, one account,
  and a run holding only what its repo's account may see. Fixed words (`yes`, `go`, `use`,
  `continue`, `close`, `start over`, `remember:`) hand over, and so do an edit, a `look at` another
  repo, and another agent picked.
- **One integrated reply.** A stay's turn is think's own ask (lifted out of `think()` into one
  function both call), so its catch-up rounds are today's. Two messages that arrive before a turn
  starts are one turn with every ask numbered. Words that arrive while it thinks are taken in before
  it answers. Every agent works this way, as #224 made it.
- **It gives way.** A queued job for a box label (from the queued runs and their jobs, read with
  ETags) means some task waits for a slot, and the stay leaves after its turn. No slot is reserved,
  and parallel tasks lose nothing.
- **It cleans up.** A final step with `if: always()` takes `staying` off however the job ends.
  The watch's Stopped takes it off too, for a box that died, so your `continue` is never skipped.
  The run's folder is removed as today: by the slot's next run, or the weekly clean-up.
- **`working` while a turn runs** (the status comment), so the web chat polls at 5 s and the watch
  finds a turn a dead box left (Stopped, as for any run). A push still wakes the page at once.
- **The job's limit** adds the stay's 45 minutes to ADR 0035's sum (240 → 285), and the copy's
  prune age follows it (14400 → 18000 s). A run never outgrows its own job.

### 3. The mailbox, as a seam to grow

The stay reads and hands over through a small interface in one file, `cli/kernel/mailbox.ts`, with
one provider, the task (`next(after)`, `handover()`, `leave()`). It gets a contract, a conformance
test and a registry only when a second provider exists (the direct layer). That follows the rule
that a seam earns its place with its second provider. Think's ask, lifted into
`cli/kernel/turn.ts`, is the other shared block.

### 4. The rules

All eleven of `design.md`'s rules hold. One line is added to `security.md`: "the stay step holds the
record's token (`GITHUB_TOKEN`), a read-only token and the agent's login while its agent runs, behind
the same user wall as think". Today think holds no record token, and apply holds no login. The
agent still never holds any of them.

## Context, tokens and caches

- **Context flows once.** The first run builds the prompt (the task, the notebook, the skills) as
  today. A stay sends only the new words, numbered, into the same session. The agent doesn't re-read
  the task or re-clone a repo, and each agent keeps and compacts its own context its own way.
- **Tokens.** A turn within 5 minutes resumes a session whose prompt the model has cached (Claude's
  default cache lasts 5 minutes; a gateway's model caches its own way). That's why the stay's idle
  bound is 5. Run details show each turn's tokens, so this is measured, not assumed.
- **Caches, and what keeps them right:**

  | Cached | Where | Kept right by |
  |---|---|---|
  | Shipify, built, per commit | the box's shared tools | built once per commit; the three newest kept (about 33 MB) |
  | Node | the box (`/opt/node`) | box setup and the image; one Node for runs and agents |
  | Agents' CLIs | the box's shared tools | pinned in `executors.json`; the weekly clean-up keeps only those |
  | Packages, browsers | each slot's cache | removed after 30 days unused (`sandbox.ts:457`) |
  | A run's clones and session | the run's folder | the run, its stay included; removed by the slot's next run or the weekly clean-up |
  | What's answered | the cursor in the status comment | written by every answer; the one truth every run reads |
  | Task reads | the stay (ETag), the edge (5 s), the page (ETag, push) | conditional reads; a push wakes the page |

## Repos and accounts

| A task on | Its run today | Its stay |
|---|---|---|
| a project or repo on Shipify's own account | talk: every project readable; the bot's tokens | the same scope from its own mint |
| a repo on another of your accounts | that account's repos only, from the repos App; no notebook or tools | the repos App's token for the same repos; the same limits |
| a repo outside your accounts | the read profile: read before the agent, no command, web or key | the same read folder and profile; a new `look at` hands over |
| a change anywhere | a work run | never stays; a talk answer that finds work hands it on as today |

## What stays as it works today

The status task and page, due runs, repeats and errands, recipes and checks, the notebook, Telegram,
the web chat, approvals (`yes` and merges), deploys and Live, previews, the weekly digest and
clean-up, every account and repo rule, Docker and every box setup, and parallel slots. A stay
touches none of their paths. It starts only after an answer to your words, and it gives way to them
all.

## Narrowed out

- **The hub (a Durable Object), sockets, a lease workflow:** parked as the direct layer (below).
- **A slot reserved for chats:** a stay gives way instead.
- **One long-lived agent process per chat:** your rules are given fresh before every ask.
- **`watch.yml` without its checkout:** it runs from source by ADR 0051's choice.
- **Profiling the task read and plan (10 s):** ADR 0051 measured them, and nothing new was found to
  cut without measuring again. The run's timing lines keep showing them.
- **The door clearing a stale `staying`:** the watch's Stopped already does it.
- **Files in a stay's reply:** they need the files token, which only a normal run mints, so that
  turn hands over (rare).

## Edge cases

- **Two messages close together:** one read, one turn, each ask numbered, one reply.
- **Words while a turn thinks:** catch-up rounds take them in before it answers.
- **Words between the answer and the label:** from a chat, none: the door hears of the answer only
  after the label is on. A comment typed on GitHub in that second waits as its own run, which reads
  the cursor after the stay and finds nothing new.
- **A fixed word, an edit, `use`, `look at` another repo, another account:** hand over.
- **A setting alone** (`use` from a chat): no turn. Your next words hand over, since plan now picks
  another agent or model.
- **You ask for a change:** the talk answer says a work run follows, and the stay leaves first.
- **A result needs a token** (files, a call): hand over. That run answers it afresh.
- **Another task needs the slot:** the stay leaves after its turn.
- **5 idle minutes, or 45 in all:** it leaves. A late word is caught by the last read, or starts its
  own run, which waits for this job and reads the cursor.
- **A close:** from a chat, the door takes `staying` off with the state labels. On GitHub, the
  stay sees the task closed on its next read. Either way the stay leaves and the label goes.
- **`stop`:** the turn stops as today, and the stay leaves.
- **The stay step crashes:** the `always()` step takes the label off, and `run failed` says so.
- **The box dies:** GitHub fails the job, and the watch marks Stopped and takes `staying` off. Your
  `continue` answers everything unread.
- **An edge deploy:** nothing, since a stay holds no connection.
- **The door is closed:** no new words come, and the stay idles out.
- **Someone else comments:** ignored, as today.
- **No session from the agent:** no stay.
- **A fresh box, or a new commit:** the fetch step gets the commit and the copy is built, as today.
- **A push of merged plans:** both of its commits are fetched for the plans' diff.

## Setup

Nothing to set up. The stay is on at 5 minutes. `SHIPIFY_STAY` (a variable: minutes, `0` for off)
joins the one settings list and `docs/settings.md`. Every kind of box already has what the faster
start uses. The check is `pnpm ship selftest chat`, which now also sends a second message, checks
the stay answered it, and sends `close`.

## How it's built

Two PRs after this one. Each ends with its tests, clean-up and docs, and is checked live before the
next. Every step is clean (no leftovers, glossary words), well tested (unit, conformance, flow
against the fakes, live), properly handled (every failure a problem with its fix) and configured
(one setting, checked by selftest).

1. **The faster start:** the fetch step, the box's Node, the door told per reply. Tests: the
   workflow test (no `checkout` or `setup-node` in the run job; the fetch step's env-only token; a
   push's two commits) and apply's order. Live: five runs timed before and after, in the PR.
2. **The stay:**
   - **Code:** think's ask lifted into `turn.ts`; the session id in `meta.json`; `placeFor` able to
     reopen; `mailbox.ts`; decide's `stay`; `ship run stay`; the label (in `labels.ts`, and taken off
     by the door's close with the state labels), the `if:` line, the mint and `always()` steps, the
     job's limit and prune age; the watch's line; the web chat's staying state; `SHIPIFY_STAY`.
   - **Tests:**
     - decide: when a run stays; the gate against fixtures for each account kind, fixed word,
       setting, edit and agent switch;
     - kernel flow with the fakes: stays, answers in the session, collates two asks, hands over,
       gives way, leaves on idle, the last read, the crash path;
     - place: a reopen keeps the session; workflows; watch; edge.
   - **Live on homepi:** `selftest chat`, each agent's selftest (Claude Code, pi, OpenCode), and
     three tasks at once across its slots, one of them staying when another arrives.
3. **Release:** a Shipify version from `CHANGELOG.md`, published to the template (`ship template`).
   Every copy takes it as one update PR, and the box image is rebuilt by the release.

## Docs and clean-up

- This ADR, and the README's row; 0037, 0031 and 0051 marked amended.
- `design.md`: a run, its steps and keys, the parts, the mailbox in "Inside the code".
- `glossary.md`: **stay** (like HTTP keep-alive), `staying`.
- `tasks.md`: what a quick reply does, the label, the setting.
- `security.md`: the one line; what a box keeps.
- `watch.md`: Stopped takes `staying` off.
- `channels.md`: the web chat's staying state.
- `box-setup.md`: runs use the box's Node.
- `settings.md`: from the list.
- `tour.md`: the flow.
- `roadmap.md`: the direct layer under Later.
- `CHANGELOG.md`.
- Removed: the run job's `checkout` and `setup-node` steps and their fetch-depth test, and the
  stale workspace checkout on each box (the fetch step empties it).

## Consequences

- A conversation feels like one: follow-ups in seconds, in one session, with one reply per burst.
- Every run starts 12–25 s sooner. Runs and agents share one Node.
- A slot can be held up to 5 idle minutes after an answer, but only while nothing else waits.
- The stay step holds the record's token while its agent runs (the one rule line).
- The task's run list shows a run per comment during a stay, skipped. That's GitHub's cost of the
  label skip, and it costs no box time.

## Confirmation

`tests/workflows.test.ts` (the run job's steps, the stay's env and limit), the decide and flow tests
above, `pnpm ship selftest chat` and each agent's selftest, and the run details of every answer,
which say when a stay gave it and how long it took.

## Left for later: the direct layer

Chats whose words live off GitHub: a hub (one Durable Object on the edge) as a second mailbox for
this same loop. Its runs are started by a ring (a label on one issue, as the watch rings), and each
asks the hub for words with a request held open and proven with OIDC, so no socket is held. It's
read-only: "make it a task" changes things. It needs its own ADR, since it amends 0031 ("every
message lives on a task") and 0019 ("the edge keeps nothing"), and it breaks "no database". Pick it
up when a stay has been used a while and a need shows: text as it's written, sub-second replies, or
chats you'd rather not keep on GitHub. The design and its edge cases are in task #420's notes.

## As built (2026-10-15)

- **The faster start** (#422): as decided. Live, on homepi, the first run after it: "Set up job" took
  4 s (7–17 s before), the only download left being the token action. A new commit's first run
  fetched and built its copy in 7 s, and runs after it skip both.
- **The door told per reply:** built, but no faster for a plain answer. Apply still took about 9 s
  before the door confirmed it, since a plain answer has few writes after its reply. The time is
  apply's own read, the reply's write and the door's send. It's left as built, which keeps the
  order right for answers with more writes.
- **No `mailbox.ts` and no `turn.ts`:**
  - The stay's reads are its loop's interface (`StayIo` in `cli/kernel/stay.ts`: `news`, `task`,
    `waiting`, `turn`, `leave`, `handover`). They're served by two conditional reads on the record
    contract (`commentsIfChanged`, `issueIfChanged`) and one on the queue's (`waitingFor`), held to
    its conformance test.
  - Each turn calls the run's own plan, think, decide and apply cores in-process (`runStay` in
    `run.ts`). Think gained `resume` (reopen the run's folder as it is, skip the clone and reads,
    send only the new words) and `minutes`. So a turn is a run's turn, and lifting the ask out
    wasn't needed.
- **The clocks:** a turn never runs past 55 minutes from the stay's start (`STAY_LAST_MINUTES`),
  so the job's limit is 300 (192 + 30 + 15 + 55) and the copy's prune age 18000 s.
- **A setting the door wrote** (a `use` or `close` from a chat) is never new words to a stay.
- **A read that fails** ends the stay, said in its log, rather than failing the run.
- **`selftest chat`** follows the run until its Stay step is under way, sends a second message and,
  20 s later, `close`. Then it checks the log: the stay answered at least once, and the door sent
  two replies.
- **Live, on homepi** (`selftest chat`, tasks #425 and #427):
  - A first answer took 59 s from your words to your chat, on a new commit (about 41 s steady,
    against 58 s before), with 13 s of it thinking.
  - The stay's answer to the next words took about 30 s, in the same session (`--resume`, 2 turns).
    That's twice as fast, but not the few seconds estimated, because each `gh` call costs about
    1 s on a Pi (a process and a TLS handshake) and a turn makes about 20 of them.
  - Each turn now logs where its time went (`stay turn: plan … · think … · apply …`).
  - A turn hands its plan's read to think, which saves two of those calls.
  - One HTTP connection for the record's calls is on the roadmap, to make every run and every stay
    faster.
- **Four agents at once on homepi's three slots** (`selftest claude`, `pi`, `opencode` and
  `pi-vercel`, tasks #429–#432):
  - Every agent answered, and pi-vercel's stay answered its next question in the same session.
  - The other three gave way to the fourth task's run, as they should, but all three at once, when
    one slot was enough. Each saw the job still waiting in the ~10 s the first slot took to free up
    and take it.
  - So stays now give way one at a time: a stay on slot k leaves once a job has waited (k − 1) ×
    20 s (`GIVE_WAY_MS`).
  - Words already waiting are answered first, then the stay looks at the queue at once.
  - Rerun: all four passed, and two stayed and answered in the same session. But a job queued before
    the stays began counted as long waiting, so slots 1 and 3 both gave way. The wait now counts
    from whichever is later: the job's queuing, or the stay's start.
