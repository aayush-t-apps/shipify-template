---
status: proposed (the owner's requests of 2026-10-04: a researched, brutal rethink of the core for a clean first release, with a full breaking release allowed; reviewed three ways against the code (security, completeness, simplicity) and rewritten on their findings; the owner agreed every recommendation and decision on 2026-10-04; merging its PR accepts the design and its build plan)
date: 2026-10-04
amends: 0019 (boundary 3), 0027 (the envelope, the file run, send, recipes, the console), 0029 (all of it), 0030 (§5's tell and outbox, the send key, previews of the admin Worker)
---

# 0031: Shipify 0.1: every message lives on a task, one run shape, the agent only thinks

## Read this first

Shipify is eight days old and its only user is you, so this is a clean cut: one release, no
migration, nothing kept for compatibility. **The version restarts at 0.1.0.** The 1.x tags stay in
history as the prototype. In semver, 0.y means "initial development, anything may change", and
1.0.0 will mean the design has run live with every use case checked.

**Your apps don't change.**
- **spotter, playground and links** keep their workflows, stacks and settings exactly as they
  are. They still follow `pipeline.yml@v1`: from now on `v1` names the pipeline's contract, not
  Shipify's release number.
- **The pipeline** changes in one line (a preview never gets an app's runtime keys). They pick it
  up through `@v1`, and it changes nothing for them, since none of them has runtime keys.
- **shipify-admin's job** moves into this repo as the edge, and its repo is archived.

Three ideas carry the design:

1. **Every message lives on a task.** A task is one GitHub issue: a conversation and everything it
   leads to.
   - Your words reach it from GitHub, or from Telegram through the door, which writes them onto the
     task within a second.
   - Every answer is a **reply** on the task, and the door copies it to the chat you asked from.
   - The chat is a view of your tasks, nothing more.
2. **One run shape.** A run is one job on a box: **plan** (read the task, decide what's next),
   **think** (the agent, only if needed), **apply** (make every change, each safe to repeat).
3. **The agent only thinks.** It reads and suggests. The box makes every change: replies, PRs,
   notes, repeats, and the tool changes you approved. The agent runs as a Linux user of its own,
   so it can't touch the keys or the code that makes those changes.

And one promise across all three: **nothing is silent.**
- **One shape everywhere:** for what you send, what comes back, files either way, tool calls and
  errors, the same on GitHub and on Telegram.
- **What the run did travels with the reply:** the agent, model, time, tokens and tools.
- **Every run ends in a reply,** or in a failure that says what to do.
- **Every step logs the same way.**

What you notice:

| | Today | 0.1 |
|---|---|---|
| A question from Telegram | **3 min 16 s**, measured: 2 jobs, about 30 s of agent | about **1–1.5 min**: 1 job |
| `remember …` | 2 jobs | 1 job, no agent, about 30 s |
| Your words on GitHub | after a filing job, about 40 s | within a second |
| Answers in your chat | only from code paths that call `tell` | every reply, copied by the door, and resent if a send fails |
| An approved Notion change | an agent run holding the write key, held back by a hook | the box makes exactly the calls you saw; no agent runs |
| No box online | filed on GitHub's machines (a billed minute) | written by the door; the run waits; the watch starts it again |
| What there is to keep right | ~26k lines in `cli/`, two repos, 30 ADRs, ~79k words of docs | about 16k lines in one repo, and about half the words (estimates, measured in the build) |

**What goes, and why**, in short: recipes and hooks (no real user: `recipes/` holds only the
selftest's), the console (Telegram's `/ping` and `/apps` and the status task cover it), the
envelope and the filing job, the send step and its key, the act agent and its guard, the `lost`
job, four of the ten intents, six of the eight forms, Codex and OpenCode (they have no adapter),
and the shipify-admin repo. The door and the watch move into this repo.

**What stays exactly as it is:**
- You approve only on GitHub: your `yes` on a task, or your merge.
- A box holds no secret between runs.
- Your apps, the stacks and the pipeline (but for that one line), staging included.
- The notebook, Telegram, Notion, `ship add` and `ship selftest`.

**Nothing new to sign up for or pay:**
- It uses GitHub, Cloudflare's free plan and your boxes, as today.
- It adds one GitHub App for the door, made the way the bot was. That App replaces four keys.

**Not in this ADR:** new providers, approvals from a chat, other people on your Shipify.

The two security holes the review found in today's system are fixed in the first build step (see
the build plan).

## Why: where today's core works at the wrong layer

Measured in the code and in Actions on 2026-10-04:

| What's wrong | Evidence | What it costs you |
|---|---|---|
| **Chat goes through CI twice per message** | A `/ask` (runs 37215302160, then 37215362883) took 3 min 16 s end to end. The `file` job held a slot for 39 s to post one comment; the task job then waited 55 s for a slot | slow answers; a burst of messages fills both slots with filing |
| **A whole engine with no real user** | `recipes/` and `recipes/hooks.json` hold only the selftest's. The case engine is 4,238 lines (`lib/recipes.ts`, `task/recipes.ts`, `task/blocks.ts`, `lib/cases.ts`), plus `connect.ts` (1,543) and `sources/` (28 files) | upkeep, docs and security review for features nobody runs |
| **Two ways out** | 49 call sites post a reply; 14 call `tell`. The `use` reply, a comment on an operation, repeat stop and resume, errands, plans and forms answer on GitHub only | silent chats |
| **A typed system on untyped comments** | 11 kinds of hidden marker; `taskRun` has 29 exits before the agent starts; a phase machine with salvage logic | every new path is another special case |
| **Access guessed from words** | #123 made the token follow the recorded project, but a task's first run and every open ask still guess (`*`, every repo) | runs that fail for reasons you can't see |
| **The agent sits next to keys and code it shouldn't reach** | an approved change runs an agent holding the write key, held back by a hook in its own job (`errands.ts:134-272`). The agent runs as the runner's own user, so it can read the round's token from `/proc` ([security.md](../security.md#recipes-and-connections)) and rewrite code that later steps run | the guard is a check, not a boundary |
| **Three ways to reach GitHub** | `lib/providers.ts` (11 importers), `plugins/record.ts` (6), direct calls through `lib/github.ts` (39) | the record isn't one seam |
| **One contract, written in two repos** | the envelope's seal, GitHub's trim and the chat's words are implemented in both shipify and shipify-admin; every chat change is two PRs | drift between the door and the box |
| **Features faster than use** | first commit 2026-09-27: 30 ADRs, about 34k lines added to `cli/`, 19k to tests, 16k to docs in 8 days | everything costs more to change |

## Options

- **A. Keep today's design, with the fixes already decided** (one `answer()`, runs named `task #n`,
  the chat fixes). + Least work. − Every cause above stays.
- **B. One job per message:** filing moves into the run's job. + Half the slot time, no new key.
  − The envelope, the seal, the door key on boxes and the send step all stay.
- **C. Every message lives on a task** (this ADR): the door writes your words onto the task with an
  App of its own and copies replies out; one run shape; an agent that only thinks; recipes, hooks
  and the console removed. + Removes the most mechanisms, and silent chats become impossible
  rather than a rule to remember. − A GitHub App in the Worker (replacing `GH_ADMIN_TOKEN`), and
  a rewrite of the run.
- **D. Off GitHub:** a daemon on each box pulls work from a Cloudflare Durable Object holding the
  state. + Answers in seconds. − Secrets on boxes, a second record, and you'd look things up
  outside GitHub. It breaks two of your rules.
- **E. Stateless asks** (the design notes' option B): questions skip issues. − Two entry points and
  two histories, to save a second or two (the job's setup is the floor either way).
- **F. One repo:** the door and the watch move into shipify as `edge/`, deployed by shipify's own
  CI. + The chat's words, the reply line and the door share code with the core instead of
  copying it; one PR per change; no previews of a Worker holding platform keys. − shipify
  deploys a Worker.

| | A | B | **C + F** | D | E |
|---|---|---|---|---|---|
| Jobs per chat message | 2 | 1 | **1** | 0 | 1 |
| A question, end to end | ~2–3 min | ~1.5 min | **~1–1.5 min** | ~40 s | ~1–1.5 min |
| Your words on GitHub | ~40 s | ~30 s | **~1 s** | never | never |
| A silent chat possible | yes | yes | **no** | yes | yes |
| Keys between boxes and the door | send key, door key | the same | **none** (GitHub's run identity) | — | the same |
| Secrets on boxes between runs | none | none | **none** | yes | none |
| Repos to change for a chat fix | 2 | 2 | **1** | 2 | 2 |
| `cli/` afterwards (rough) | ~26k | ~25.5k | **~16k** | — | ~26k |

## Decision

Chosen **C with F**. Once compatibility doesn't matter, it removes the most, and it gives the
behaviour you notice: one job, your words on GitHub at once, every reply in your chat. It keeps
your rules: GitHub is the record and the only place you approve; a box holds nothing between runs.

### Before and after, side by side

**A message's path:**

```
Before:  chat → door → envelope (a workflow input) → file job → issue → task job → round
              → reply on GitHub  +  tell() → outbox → send step (send key) → door → chat

0.1:     chat → door → comment on the task ──(GitHub's event)──→ run: plan → think → apply
              → reply on the task → door (checks the run's identity) → chat
```

**The parts:**

| Part | Before | 0.1 |
|---|---|---|
| The record | GitHub: tasks, status comments, the status issue, PRs | the same, and **the only path**: every message in and out is a comment first |
| Ways in | GitHub events, plus door dispatches carrying sealed envelopes | **GitHub events only** (issue, comment, label, and dispatches carrying only a task number) |
| Ways out | `reply()` on GitHub, `tell()` to channels, the outbox, the send step | **one: a reply on the task**, which the door copies to chats |
| The door | the admin Worker (its own repo): proves, seals, presses a file run; passes messages out | `edge/` in this repo: proves, writes your words onto the task; copies replies out; answers `/ping` and `/apps` |
| The watch | presses `due` and `alert` with a write token | the same 5-minute check, plus follow deploys, start stuck tasks again, resend replies; it starts runs by adding a label, never with Actions write |
| A box's job | file job, task job (round), act run, `lost` job | **one run job** (plan, think, apply); `github` job for prepare and operate |
| The agent | runs as the runner's user, next to the run's keys | runs as **its own Linux user**, with read-only access, and writes only its worktree |
| Approved changes | an agent with the write key, held back by a hook | **the box** makes the exact calls you saw |
| Your own jobs | Repeats (from the phone) and recipes (files, their own engine) | **repeats**, which can run a reviewed check script and use calls you pre-approved |
| Plug-ins | 10 kinds, most with one member | **tools, channels, stacks**: the kinds with more than one member, or room for one |

**The words** (one meaning each; the glossary follows this table):

| 0.1 | Means | Replaces |
|---|---|---|
| **task** | one GitHub issue on shipify: a conversation and everything it leads to (a PR, a repeat, a deploy). The **status task** is the platform's own | task (kept), the status issue |
| **reply** | the one way out: a comment by a run on a task, which the door copies to the chats it names | reply + tell, notify, the Live message, an alert's comment |
| **run** | one job on one task: plan, think, apply | round, task run, file run, act run, a recipe's round |
| **intent** | what you asked for: change, new, question, remember, repeat, operate (`intents.json`) | intents (10 → 6) |
| **fixed words** | whole comments the box reads with no agent: `yes`, `no`, `use <model>`, `continue`, `start over`, `preview`, `publish`, `go`, `stop repeating`, `resume`. Each says where it's accepted (GitHub only, or anywhere) | `says()` commands, spread over the round |
| **yes** | your whole-comment approval of exact proposed calls, unedited, on GitHub; the only approval besides a merge | errand's yes; `yes <n>` |
| **repeat** | a task with a time: a reminder (no agent), a job (the agent), or a **check** (a reviewed script; it replies only when its output changes) | Repeat, recipe, value watch, case |
| **pre-approved call** | a tool call `tools.json` allows with no `yes`: its id fields fixed, its text fields capped. Merging that file approves it | a recipe's standing approval |
| **the door** | the edge's way in (it writes your words onto tasks) and way out (it copies replies to chats) | the door, the send route, the file run |
| **the watch** | the edge's check every 5 minutes: due, follow, start again, resend, guard; it starts `watch.yml`'s due, alert and clean-up runs | the watch (wider) |
| **profile** | what the agent may touch in a run: **talk** (read every repo, look at tools, the web) or **work** (one project's checkout, read-only token) | task, case and signal profiles; access from words |
| **plug-in** | a tool, a channel or a stack: a manifest, a conformance test, a process speaking its contract | plug-in (kept) |

Gone, with nothing replacing them: envelope, seal, file run, send key, send route, outbox, `tell`,
round, errand, recipe, recipe log, case, card, `yes <n>`, case's task, signal, hook, source,
connection, template, signal profile, `where`, phase, the console.

Inside the code only (in `docs/design.md`, not the glossary): **decide** (plain code: what comes
next, from a task's snapshot), **writes** (the changes a run makes, as data), **apply** (the one
place that makes them), **journal** (a line saved before each outside change), **cursor** (the last
comment a run has read).

**The rules** (design.md's twelve, rewritten):

| Before | 0.1 |
|---|---|
| 1. One record | 1. **One record:** GitHub. The door keeps nothing; anything elsewhere is a cache. |
| 2. One path: everything is a run; 9. One way in, one way out | 2. **Every message lives on a task.** In: a comment (yours, or the door's for you). Out: a reply, which the door copies. |
| 5. Safe to repeat | 3. **Runs reconcile:** read the task, decide, apply. Nothing new does nothing; every change carries a key or a journal line, so a repeat is harmless. |
| 12. The agent never holds a channel's key or the door key | 4. **The agent only thinks,** as its own Linux user. It reads and suggests; the box makes every change. No agent holds a write key, the record's token, a channel key, or anything the apply step runs. |
| 4. One key per boundary | 5. **The least each part needs:** two profiles for the agent; write tokens minted after it, for exactly one repo; an act key only for a call you approved. |
| 7. Approvals are yours; 10. Acts need a yes | 6. **Approvals are yours, on GitHub:** your whole, unedited `yes`, or your merge. A comment the door wrote can't approve. |
| 11. Outside text asks, never approves | 7. **Only you start work:** your comments, and the door's on your behalf. A dispatch carries only a task number and starts nothing the task's status doesn't already have pending. |
| 8. The core names nothing at the edges | 8. **The core names nothing at the edges:** tools, channels and stacks plug in with a manifest and a conformance test. |
| 6. Grow by adding | 9. **Grow by the ladder:** a prompt or a skill first, then a repeat or a pre-approved call, then a tool, then a new intent; the core last. |
| 3. The control plane decides; the data plane does | 10. **Supervised:** the watch starts a stuck task again, resends an undelivered reply, and alerts once. |

**The keys:**

| Key | Before | 0.1 |
|---|---|---|
| GitHub, in the Worker | `GH_ADMIN_TOKEN`: a fine-grained token, renewed yearly; Actions write | **the door App's key**: Issues read and write, Actions read, Administration read (runners), Variables read, Metadata, on shipify only. No Contents, Pull requests, Workflows or Actions write. It doesn't expire; the watch reminds you yearly to rotate it |
| The door key | in the Worker and in filing steps on boxes | **gone** (it served hooks, the ping and the send key) |
| The send key | in five steps of `task.yml` | **gone:** a run proves itself to the door with GitHub's own OIDC token |
| `CF_READ_TOKEN` | the Worker reads Cloudflare to find apps | **gone:** the edge is deployed with the registry built in, and checks each app's public `/health` |
| Telegram's token and secret | in the Worker | in the edge Worker, as today |
| The bot App's key, the agent's login, tool keys | shipify secrets, handed to jobs | the same; write tokens minted only after the think step |
| The edge's own keys (the door App's key, Telegram's token and secret) | shipify-admin's secrets | shipify secrets, read only by the edge's deploy job on GitHub's machines. No box job names them, and `prepare` never copies them into a new project, as it already skips the bot's key today |

### How it works

#### A task

- **One issue on shipify.** You open one on GitHub, or the door opens it from a chat. The status
  task is the platform's.
- **Comments and who wrote them:**
  - **you on GitHub;**
  - **the door App on your behalf,** each comment with a hidden `from` line: channel, chat id,
    Telegram's `update_id`;
  - **runs (`github-actions[bot]`),** each reply with a hidden `reply` line: its kind, the chats to
    copy it to, and its key.
- **The status comment:**
  - **What it holds:** the intent, the project, the model, the cursor, the body's hash (an edit
    counts as new), and what's pending (proposed calls and their fingerprint, a PR, a repeat, a
    deploy, preview checks, a second run, an operation), plus the journal and the runs table.
  - **When it counts:** only when its writer and last editor are a run, so an edit by anyone else is
    ignored and said.
  - **Labels:** derived from it, never read.
- **Closing:**
  - **Answered and quiet:** a task that's answered and quiet for a day closes; your next comment
    reopens it.
  - **Your merge:** closes the task through the PR's `Closes` line.
  - **"Not planned":** closes its PRs and branches.
  - **A repeat:** closing it stops it.
  - **`close` or `reopen` from a chat (#188):** the door closes or reopens the task as it writes the
    word, so it changes at once; the run after it does what the word does to the task's status,
    quietly (the chat has already said so). If GitHub won't change it then, the run does it.
  - **Notebook pages** (issues labelled `notebook`) start nothing, as today.

#### A run: plan, think, apply

**`task.yml` has two jobs:**
- **`run`, on a box,** named `task #<n>` (a push of plans stays `plans merged`);
- **`github`, on GitHub's machines,** for prepare and operate.

The `file` job, the `lost` job, the filing steps, the send steps and the `envelope`, `title`,
`group` and `where` inputs are gone.

**Triggers:**
- **Issues** (opened, edited, closed, reopened, labelled) and new comments, from you or from the
  door App, which is matched by its App id. Issue events always run `main`'s workflow.
- **The watch's `run` label.**
- **A dispatch from a run or the due run:** `main` only, carrying only a task number.

**Grouping:** each task is its own group (`task-<n>`, `queue: max`).

```
plan    as the runner · GITHUB_TOKEN, a read-only token, a files token for shipify-files
        read the task once: the issue, comments after the cursor, the status comment, its PRs
        👀 on what it read; fetch files from the door (with the run's OIDC token) and publish images
        decide: fixed words first (each checked for where it's accepted), then the intent
        outputs, from fixed lists only: profile (none|talk|work), project, web, act, workflows
think   as the agent's own user · the agent's login, a read-only token, the tools' look keys
        only when the profile isn't none; the agent writes result.json; for work it also runs
        make verify, and the step runs it again as the same user; the commits leave as a git bundle
mint    only now: a write token for exactly one repo (an empty list fails), and an act key only
        when decide found your yes to exactly these calls
apply   as the runner · decide again with the agent's proposals → writes → each journalled or keyed
        → the status comment last → the door is told of each new reply (the run's OIDC token)
```

- **Level-based:**
  - **Nothing new:** with nothing new since the cursor (no comment, no edit, nothing due), a run
    ends at once.
  - **Two events:** they make two queued runs, and the second finds nothing new, or the newer words.
- **New words while a task waits** (for a merge, a deploy or your `yes`): the work starts again at
  its first thinking step, keeping the branch and the PR. If you wrote anything but `yes`, the
  proposed calls are dropped.
- **A second run:** when a talk run decides the work belongs to a project (you wrote "fix spotter's
  button" with no prefix), apply records "work on spotter" as pending and dispatches a work run.
  The plan step can't know the project before the agent has read your words.
- **Nothing the agent wrote runs with a key:**
  - **Pushing:** apply fetches the bundle into its own clone, scans it for secrets there, and
    pushes from there with hooks off. Nothing in the agent's worktree runs as the runner.
  - **Workflow files:** a push that changes `.github/workflows` must match the project's stack
    template exactly (an upgrade); otherwise it gets no workflows permission and is refused.
- **Crash-safe:**
  - **Before each outside change** (a tool call, a push, a dispatch), apply saves a journal line.
  - **A change started and not finished** is reported, not retried.
  - **A reply's key** is the task, the cursor and the step. The plan step checks for it before
    thinking again.
- **The agent's sandbox** (set up once by `box add`):
  - **Its own user, one per slot:** slot k's agent runs as `<box>-agent-k`, through one sudoers rule
    that starts the agent and nothing else. Two tasks running at once can't touch each other's
    worktree or bundle.
  - **Clean-up:** the weekly clean-up removes an agent's old worktrees through that same rule.
  - **Locked-down runner:** the runner's folders are 0700, its service runs with `UMask=0077`, and the
    toolchain is the runner's own and only readable by the agent.
  - **The agent's own space:** it has its own home and worktree, no secret on any command line, and
    Claude Code is started with only the user's settings and only the run's MCP config (the
    pinned version's flags, checked in step 1).
  - **Without this,** splitting steps protects nothing: the agent could rewrite the code, the
    `node_modules` or the tools the apply step runs next, or the runner's own credentials.
  - **If step 1's test of it fails on the Pi,** the fallback is the think step as a job of its own,
    whose job carries no write secrets at all. That costs about 25 s more on each agent run, and it
    is decided at step 1, before anything else is built on it.

#### What decide reads

| Intent | You write | The run |
|---|---|---|
| **question** (and anything with no prefix, `ask:`, `do:`) | words | talk → the agent answers, or proposes calls, a note, a repeat, or work on a project (each becomes its own step: calls → shown for your `yes`, or done at once when pre-approved and the run read no web) |
| **change** | `<project>: …`, `playground: …` | work → PR (`Closes` this task) → reply "needs you" → wait for your merge → follow the deploy → Live. A big change: a doc PR first (no `Closes`), your merge, then `go` |
| **new** | `new: …` | work on `plans/` → plan PR → your merge → prepare (GitHub's machines) → work (build) → publish (the first push of the new repo) → Live |
| **remember** | `remember …` | no agent: a note, then a reply |
| **repeat** | `repeat: …`, "every …", the Repeat form | talk reads the schedule (or the form gives it) → the repeat is set → "Set: …"; at each time: a reminder (no agent), a job (talk), or a check (the script, then a reply only if its output changed) |
| **operate** | the Operate form only | prepare the operation as pending → the `github` job runs it once and marks it done → reply |

`/ping` and `/apps` are answered by the door at once, with no run. Chat commands (`/new`, `/ask`,
`/change`, `/remember`, `/repeat`, and any you add, like `/save` as a question with a pre-approved
Notion call) are a map in `intents.json`. The door and the core read it from the same file.

#### Writes and replies

| Write | Kept safe to repeat by |
|---|---|
| **reply** `{kind, text, links, files, to}` | its key in the `reply` line |
| **label** | labels are idempotent |
| **push and PR** `{repo, kind: closes / part-of / publish, preview}` | a journal line, and the PR body's hidden key |
| **note** | the line itself: no duplicate lines |
| **repeat** `{when \| stop}` | the status comment, and "Coming up" on the status task |
| **call** `{tool, name, args}` | a journal line before the call; a call started and not finished is reported, never repeated |
| **dispatch** `{task}` | a journal line; the job it starts runs only what's pending |
| **close, reopen** | idempotent |
| **status** | always last |

A reply's **kind** is answer, needs-you, live, alert or failed. Its **to** is worked out in one
function:
- the chats of the comments this run answers;
- the chat the task came from, on its first answer and when no new words started the run;
- your default channels (`SHIPIFY_SEND`) for an alert, a repeat's reply and a task Shipify opened.

As built (task #188, 6 Oct 2026): a reply went to the chat the task came from on every run, and
needs-you, live and failed went to your default channels too. A task started on GitHub or in the
web chat pinged Telegram on every "Merge it?", which read as if it lived there. A reply now goes
back where you wrote.

The door copies a reply only to ids it knows are yours (`SHIPIFY_PEOPLE`).

#### Nothing silent: one shape in, one shape out, one way to fail

Every boundary speaks one of five shapes. Each is a schema in `cli/contracts/`, checked where data
crosses (a comment read, a tool's answer, the agent's result, a chat update); anything that
doesn't match becomes a problem with a plain message, never a crash or a silence. The edge
imports the same files.

**1. What you send: `Incoming`**

```
{ v, person, channel: github | telegram, task: n | null, text, files: [{ name, type, size, ref }], at, id }
```

A comment on GitHub and a message on Telegram both read into this shape, so `decide` never knows
which one it was. What a file becomes:

| You send | The agent gets | When it can't |
|---|---|---|
| words, markdown, code, tables | all of it, as written | — |
| an image (a pasted screenshot, a Telegram photo) | the image, to look at | over 10 MB: named, left out |
| a document from Telegram (PDF, `.md`, CSV, text, code) | the file, in the task's folder | over 10 MB, or more than 5 files: the rest named, left out |
| a link to a file in your repos, a gist or a page | the file or page, fetched before or by the agent | a page it can't reach: said |
| a file attached on GitHub | nothing: GitHub serves private attachments only to a signed-in browser | said once, with what to do: paste the text or link the file |
| a voice note or a video | nothing: the agent reads words and pictures | said once: type it, or send a screenshot |

**2. What comes back: `Reply`**

```
{ v, kind: answer | needs-you | live | alert | failed, task, title, state, text, question?,
  links: [[label, url]], files: [{ name, type, url }], shots?: [{ page, phone, desktop }],
  details: RunDetails, to: [chat ids] }
```

One reply, rendered by each channel as well as it can:

| | GitHub (the record) | Telegram |
|---|---|---|
| first line | the state, as a heading | **Done · #12 · make it faster** |
| text | all of it, in markdown; past a comment's limit, the rest in `reply.md` | all of it up to ~3,500 characters, else its first part and "the rest is on GitHub"; shown as plain text, never as markup |
| a question | quoted, at the end | the same, last |
| links | a list | buttons |
| files the run made | on `shipify-files`: images inline, others as links | each sent as a photo or a document |
| screenshots (a change for review) | phone and desktop, inline | the first two, as photos |
| run details | folded at the end | one line: "Sonnet · 48 s · 3 tool calls", and a link |

**3. What the run did: `RunDetails`**, on every reply and in the status comment's runs table:

```
{ run: url, box, slot, profile, why,
  steps: { setup, plan, think, apply }  (seconds),
  agent: { name, model, effort, turns, tokens: { in, out, cache }, limits: { fiveHour, weekly } },
  tools: [{ call, verb: look | act, ok, ms }], files: { read, made }, notebook: [pages],
  warnings: [...] }
```

- **Where it comes from:** the agent's own stream. Claude Code's stream-json gives the model,
  each tool use, the 5-hour and weekly use, turns, tokens and time. This extends today's run
  details (`lib/runs.ts`) rather than replacing them.
- **On the PC:** `ship task <n>` prints a task's status and its last runs, with links to their
  logs.

**4. A tool call: `ToolCall`**, the same for every tool, look or act:

```
{ tool, name, args }  →  { ok, text, link? }
```

- **What you see:** an act's ✓ or ✗ line in its reply is that result, with the tool's own answer.
- **What's checked:** args against the act's schema in `tools.json` before the call; the answer
  trimmed and masked after it.

**5. Something went wrong: `Problem`**, one shape for every error you see, in a reply, in the
CLI, in the door's chat answers and in the watch's alerts:

```
{ code, what, why?, fix, where? }      e.g. { code: "key-refused", what: "Notion refused the read key",
                                              fix: "pnpm ship add notion --new --yes", where: <run> }
```

- **One catalogue:** `cli/contracts/problems.ts` holds each code with its words and its fix. That
  includes:
  - a box offline;
  - a key missing or refused;
  - a tool refusing a call;
  - `make verify` failing;
  - the secret scan finding a key;
  - GitHub or Telegram not answering;
  - the hourly calls spent;
  - the queue's 24 hours passing;
  - a stuck task;
  - a form answer that's wrong.

  An error with no code is still shown, as "unexpected" with its first line and the run's link.
- **How every run ends:** in a reply, or in a `failed` reply carrying a problem. If apply itself
  can't write, the watch finds the task still "working" with no run, starts it again, and alerts
  once if it stays stuck.

**Logs** are one shape too: a JSON line per event, `{ at, task, run, step, level, event, …data }`.

- **Masking:** every line is masked for anything that looks like a key.
- **Where they go:** to the job's log (Actions keeps them 90 days) and, for the edge, to Workers'
  logs.
- **Event names** come from one list, the same in the box and the edge: `door.in.written`,
  `door.out.sent`, `run.plan.decided`, `run.apply.wrote`, `watch.restart`, and so on.
- **In the reply:** warnings from a run's log show in its run details, so you never have to open
  the log to learn something went sideways.

#### Repeats, instead of recipes

A repeat is a task with a time, set from the phone ("every weekday at 8, my open Notion tasks") or
the Repeat form. At each time the due run starts it. There are three kinds:
- **a reminder:** its words, no agent;
- **a job:** the agent (talk), which may reply quietly ("nothing today");
- **a check:** a script from `checks/` that you merged by PR. It runs as the agent's user with no
  keys. Its output is compared with last time's (kept in the status comment), and a change becomes
  a reply, or the agent thinks about it if the repeat asks. This covers value watches, upgrade
  offers and monitors.

**What carries over:**
- Three failures in a row pause a repeat, said once; `resume` restarts it, and `stop repeating`
  ends it.
- What recipes' standing approvals did, **pre-approved calls** in `tools.json` now do: id, parent
  and URL fields fixed or `one_of`, text fields capped.
- A run that read the web needs your `yes` even for a pre-approved call.

#### The door: in and out

**In** (Telegram today):
1. **It checks the sender:** the bot's secret, and that you're in `SHIPIFY_PEOPLE`.
2. **It answers what needs no run, at once, writing nothing:** `/start`, `/help`, `/ping`, `/apps`, a
   bare command, a lone "thanks", a wordless photo.
3. **It writes everything else as the door App:**
   - **To an existing task:** a reply to one of its messages, or words starting `#12`, become a
     comment on #12. If #12 doesn't exist, it says so at once and writes nothing.
   - **As a new task:** anything else becomes a new task titled from your words.
   - **Photos:** an album becomes one comment.
4. **It answers at once:** "Got it · #12", adding "no box online: it runs when one is back" when
   that's so.

**It keeps no state.** The record is its memory:
- **One update at a time:** Telegram's webhook is set to deliver one update at a time
  (`max_connections: 1`).
- **No duplicates:** before writing, the door lists its own writes from the last few minutes (two
  calls: the newest issues and comments) and looks for the update's `update_id` in their `from`
  lines.
- **Albums:** an album's later photos find the task its first photo opened, by the album's
  `media_group_id` in the same lines.
- **The result:** a retry never opens a second task, and an album lands on one task, with nothing
  but GitHub to keep.

**Out:**
1. **Apply tells the door.** After writing a reply, apply calls `POST /door/replied` with the
   comment's number and the run's GitHub OIDC token. The door checks that token against GitHub's
   published keys: shipify's repository, `main`, the `task.yml` workflow, and not expired.
2. **The door checks the reply.** It reads the comment and checks it was written by a run and has a
   `reply` line.
3. **It sends, then marks it.** It sends to each chat in `to` (skipping a reply that already
   carries its own 🚀), then adds 🚀 to the comment as the door App. That 🚀 means "it reached your
   chat", and you can see it on GitHub. Only the door App's own 🚀 counts.
4. **The watch catches what was missed.** Every 5 minutes it lists replies from the last hour,
   using the repo-wide comment listing, and sends any that are older than 2 minutes and have no
   🚀 from the door.
5. **It gives up loudly.** After an hour it stops and alerts once. That alert goes straight to your
   chat, and to the status task if the chat is what's down.

**Files, both ways, with no key shared between boxes and the door:**
- **From a chat:** files stay references. The plan step fetches each one through
  `/door/file/<ref>` with the run's OIDC token.
- **To a chat:** files the run made sit on a private branch, which Telegram can't fetch. So
  `/door/replied` carries them (up to 10, 10 MB each), and the door passes them straight to
  Telegram, keeping nothing.
- **On a resend:** the watch sends the text and the files' GitHub links.
- **The door App stays narrow:** it needs no access to the repo's contents.

#### The watch

Every 5 minutes, in the edge:

- **due:** repeats whose time has come.
- **follow:** while a task is deploying, or a preview's checks are pending, it starts the due run
  every few minutes.
  - **The due run reads the app's repo** with the bot's token, as today (the door App sees shipify
    alone).
  - **For a deploy,** it replies Live, failed, or never showed up after 30 minutes.
  - **For a preview,** a failed check starts a run on the task, at most twice.
- **start again:** a task with comments after its cursor, and no run queued or under way for 10
  minutes, gets the `run` label. A run writes its own run id into the status comment as it starts,
  and the watch asks GitHub about that id, never matching runs by their names. So a long `work`
  run is never mistaken for a stuck one. At most 3 times for the same cursor; then the task is labelled
  `stuck` and you're alerted once. This covers a box that died mid-run (the `lost` job's work), the
  24-hour queue limit, and a missed event. The watch reads only the 100 comments changed last, so a
  status comment missing from them isn't taken as none: a task counts as unanswered only when it
  has no comment at all. A `run` with nothing new thinks only when the status still says working.
- **resend:** replies with no 🚀 from the door.
- **guard:**
  - boxes offline and back;
  - apps failing (each app's public `/health`);
  - Telegram's webhook failing;
  - a runner within 5 days of its 30-day update limit;
  - the door App's key refused, said straight to your chat.

It starts `watch.yml`'s due, alert and clean-up runs by adding a label on the status task, so it
never needs Actions write.

#### Tools

- **Look:** MCP over stdio, as today. The servers are our own, pinned with the repo.
- **Act:** no agent.
  - **Proposals:** the agent proposes calls as data (`{tool, name, args}`). Each act in `tools.json`
    has an argument schema, and a proposal that doesn't match is dropped and said.
  - **What you approve:** the list shows the exact calls and arguments the fingerprint covers, not
    the agent's description of them.
  - **The box makes the calls:** after your `yes`, apply calls the tool's server itself (`tools/mcp.ts`
    gains a small client), once each.
  - **What goes:** the guard and the labeller.
- **A plug-in manifest** (tools, channels, stacks) has the same header everywhere: `name`, `kind`,
  `version`, `shipify` (the versions it works with), its keys, `setup`, `check`.
- **Skills** stay in `skills/` (the Agent Skills format), read on demand. New skills and checks
  arrive only by PRs you merge.
- **Not now:** "code mode" (agents writing code against tools). It pays off with dozens of tools,
  and there are two.

#### Agents

- **Claude Code only,** with its adapter. Codex, OpenCode and `manual` leave `executors.json` until
  one has an adapter that passes the agent conformance test. The agent's contract gets simpler
  either way: it only has to write `result.json`, with no hooks or guard.
- **A small context each run:** the notebook's index and the pages that matter, not 16 KB of
  everything.
- **The model:** the Repeat form's Model field, a blank issue's first line (`use opus`), or `use …`
  as a comment, kept in the status comment.

#### Security, side by side

| Risk | Before | 0.1 |
|---|---|---|
| A prompt-injected agent reaches a write key | an approved run holds one, behind a hook | no agent ever holds one; write tokens are minted after it, as another user |
| The agent rewrites code, tools or credentials the run uses next | possible: the same Linux user | it has its own user; the runner's folders are 0700 |
| A dispatch runs a branch's code with secrets | the `task` job has no `main` check | every job requires `main`; a dispatch carries only a task number |
| A leaked Worker key replays operations or deletes logs | `GH_ADMIN_TOKEN` has Actions write | the door App has no Actions write; the `github` job runs only a pending operation, once |
| A preview runs the agent's code with an app's keys | shipify-admin's previews get its runtime secrets | a preview never gets runtime keys (one line in the pipeline); the edge lives in shipify, which has no previews; `preview` is accepted only on GitHub |
| A chat or a forged comment approves | a check in the round | a `yes` counts only from your account, unedited, after the exact calls; with no `SHIPIFY_OWNER`, nothing runs |
| Silent failure in a chat | any path that forgets `tell` | impossible: every reply is copied, marked 🚀 when it's sent, and resent by the watch until it is |
| Approving one thing, getting another | the list shows the agent's description | the list shows the exact calls and arguments the fingerprint covers |
| The trifecta (your repos, the web, a way out) | always on | the agent can read and fetch but write nothing; pre-approved calls need your `yes` in a run that read the web |
| Supply chain | own servers; skills by PR | the same; checks by PR; nothing installed at run time |

#### Limits, honestly

- **Spread across boxes:** any box takes any run, no box is special, and state lives on GitHub.
  Another box means more tasks at once; each task runs one at a time, with up to 100 queued.
- **The ceilings, nearest first:**
  1. your Claude subscription's usage (the agent is called only to think);
  2. `GITHUB_TOKEN`'s 1,000 calls an hour per repo: about 100 runs an hour;
  3. 500 created comments an hour;
  4. 100k Worker requests a day.

  Nothing here costs money.
- **"Infinite" isn't on offer from free tiers.** What you get is a constant cost per message, and a
  box for more at once.

## Core flows: who carries each one

Every project flow keeps working. What changes is who does the step that writes to GitHub: today
the agent runs it, and in 0.1 apply runs it, from what the agent asked for in `result.json`. The
`ship` commands you (or an agent in your terminal) run on the PC don't change; apply calls the
same code.

| Flow | Today, inside a run | In 0.1 |
|---|---|---|
| **A change: verify, version, PR** | the agent runs `ship version`, then `ship pr` (verify, version check, secret scan, push, PR) | the agent runs `ship version` and `make verify` in its worktree and asks for a PR in `result.json`; apply checks the version, scans for secrets and pushes from the bundle |
| **Main moved under a branch** | the round runs `ship refresh` before the agent | the plan step runs it before think; conflicts are noted for the agent |
| **A big change: doc PR, then `go`** | `ship change submit` by the agent; after "go", `ship refresh`, then build | the agent asks for a part-of PR; apply opens it; after your merge, `go` (GitHub only) starts the build, refreshed first |
| **A new project: plan, build, publish** | `ship plan submit` and `ship publish` by the agent; prepare on GitHub's machines | the agent writes the plan and asks for its PR; after your merge, prepare runs as today; the build's run ends with apply's publish push, a token for that one new repo |
| **A stack upgrade** | the agent runs `ship upgrade`; its token gets workflows write | the agent runs `ship upgrade` in its worktree; apply pushes with workflows write only if the workflow files match the stack's template exactly |
| **Release, down, up, rollback** | the Operate form; the box hands it to the `github` job | the same; the `github` job runs only a pending operation, once |
| **Deploy and Live** | the close of the task marks `deploying`; the due run follows it | the same: the watch starts the due run while a task is deploying |
| **A new Shipify release** | boxes run `main`; projects follow `@v1` | the same; `v1` moves only when the pipeline changes |
| **A box's own update** | box setup version 4 | version 5 (the agent's user), applied once by re-running `ship box add` |
| **Claude Code, Node, pnpm, actions** | pinned; changed only in a PR that says so | the same |

`playbooks/task.md` changes with this. The agent never pushes and never opens PRs: it asks for them
in `result.json`, and runs only local commands (`make`, `ship version`, `ship upgrade`, `git
commit`).

## Your apps

What each app depends on, and what 0.1 does to it:

| App | Today | In 0.1 |
|---|---|---|
| **spotter** (ts-static) | `pipeline.yml@v1`, no runtime keys, no staging | **no change** |
| **playground** (ts-static) | the same | **no change**. It's the canary: step 4 proves a change goes live on it |
| **links** (ts-worker, KV) | the same | **no change** |
| **shipify-admin** (ts-worker) | the console, the watch and the door, holding five runtime keys | **its job moves to `edge/`** in this repo, under the same Worker name and address, so Telegram's webhook still points at it. Its repo is archived once the edge is live (archiving is yours) |

What the core needs from any app, all of which it already has:
- **Its contract:** `shipify.json`, the `make` targets, `/health`.
- **Its address,** in the registry, which the edge is built with.
- **The pipeline's `shipify/main` commit status,** which the due run reads to say Live.

The one pipeline change, a preview never getting runtime keys, reaches the apps through `@v1`. It
changes nothing for apps that have no runtime keys.

## Use cases and their edge cases

| Use case | Before | 0.1 |
|---|---|---|
| U1 Ask | 2 jobs, 3 min 16 s | 1 job, ~1–1.5 min |
| U2 Carry on | 1 job (the follow-up path) | 1 job |
| U3 Remember | 2 jobs, no agent | 1 job, no agent, ~30 s |
| U4 Repeat | the due run → a round | the due run → a run (a reminder or a check: no agent) |
| U5 Change something in a tool | a look round, your `yes`, an act **agent** run | a talk run, your `yes`, an apply with **no agent** |
| U6 Change an app | a round; the agent pushes; CI waited inside the job | work → apply pushes; the due run, started by the watch, follows checks and the deploy |
| U7 New app | plan → merge → prepare → build → publish | the same steps, the push made by apply |
| U8 Operate | the form → a box → the `github` job | the form → pending → the `github` job, once |
| U9 Health | `/ping`, `/apps`; the `ping` form | `/ping`, `/apps`; ask a question about a box |
| U10 Hear what matters | where `tell` is called | every reply of kind needs-you, live, alert, failed |
| U11 Send and get files | images from GitHub; Telegram files republished by the file job; made files on `shipify-files` | one `Incoming` and one `Reply` shape on both channels; files fetched in plan, made files published in apply |

Each edge case below is decided here, and is a `decide` test in the build:

- **U1 Ask:**
  - **A title word that names no project:** read as plain words.
  - **Needing every project:** the plan step syncs them read-only.
  - **A private-repo attachment:** "couldn't open", said once.
  - **The web:** allowed.
  - **Answered:** the task closes after a quiet day.
  - **A Telegram retry:** the same task (the door checks its recent writes first).
  - **Work found for a project:** a second run.
  - **Calls proposed:** shown for your `yes`, or done if pre-approved and no web was read.
- **U2 Carry on:**
  - **Replying:** every message the door sends starts "… · #12 ·", so replying continues #12.
  - **#99999:** answered at once, nothing written.
  - **A closed task:** reopened.
  - **A message during a run:** the next run in the group reads it.
  - **A reply to `/ping`, `/help` or an alert:** a new task quoting it.
  - **A reply that only says thanks:** answered at once.
  - **An album:** one comment.
  - **An edit of the task's body:** counts as new (its hash).
  - **New words while waiting:** start the work again on the same branch.
- **U3 Remember:**
  - **A note that looks like a key:** refused.
  - **A full page:** refused, with "split it".
  - **A page someone else edited:** left alone.
  - **Only your words** become notes.
- **U4 Repeat:**
  - **Three failures:** pause, said once.
  - **The words:** `stop repeating`, `resume`.
  - **Closing and reopening:** stop and resume it.
  - **Due while a run is under way:** queued.
  - **The watch stopped:** every reply says so.
  - **A quiet job:** no reply.
  - **A check script that fails:** counts as a failure.
  - **The same output:** silent.
  - **Time zone:** `timeZone` in `shipify.config.json`.
- **U5 Change something in a tool:**
  - **What you see:** the exact calls.
  - **What counts as approval:** `yes` must be whole, unedited, from your account, after the list,
    within a day, with no edit to the task since.
  - **Other words after the list:** plan again.
  - **A `yes` from a chat:** not an approval; the reply links GitHub.
  - **A refused call:** its ✗ line has the tool's own answer.
  - **A list too big:** refused.
  - **A missing key:** said, with the `ship add` line.
  - **A crash mid-call:** the call is reported, not repeated.
- **U6 Change an app:**
  - **A sibling merged first:** the branch is refreshed, and conflicts are noted for the agent.
  - **`start over`:** a new branch.
  - **`make verify` fails:** one more agent pass with the log; if it still fails, no PR, it says
    why, and `continue` tries again.
  - **A preview** (GitHub only) **whose checks fail:** up to two more runs.
  - **Your merge:** closes the task; the due run follows the deploy.
  - **The secret scan finds a key:** no push.
  - **A big change:** a doc PR, your merge, then `go`.
  - **Workflow files:** must match the stack's template.
- **U7 New app:**
  - **A missing key or permission:** prepare stops and names it; `publish` (GitHub only) starts it
    again.
  - **A repo that already exists:** named.
  - **A first deploy that never comes:** said after 30 minutes.
- **U8 Operate:**
  - **From a chat:** refused, with the form's link.
  - **A rollback version that doesn't exist:** the form says so.
  - **A replayed or repeated dispatch:** finds nothing pending.
- **U9 Health:**
  - **GitHub not answering the door:** said at once.
  - **"How's the Pi?":** a question, using the read-only system commands the agent already has.
- **U10 Hear what matters:**
  - **Telegram down:** resent for an hour, then one note on the status task.
  - **A long reply:** its first part and a link.
  - **Who it reaches:** only people's ids.
  - **Every reply** carries its run details.
  - **A failure** carries its problem's fix.
- **U11 Send and get files:**
  - **Limits:** 5 files a message, 10 MB each; the rest are named.
  - **What it can't open** (a voice note, a video, a private GitHub attachment): said once, with
    what to do.
  - **An album:** one task.
  - **Files the run made:** up to 10, on `shipify-files`, shown on GitHub and sent on Telegram.
  - **A reply too long for a comment:** goes up as `reply.md`.
  - **Anything that looks like a key:** masked before it's posted or sent.

**Across everything:**

| Case | What happens |
|---|---|
| A box dies mid-run | the watch starts the task again after 10 minutes, on any box |
| A job waits 24 h for a box and is cancelled | the watch starts it again when a box is back |
| GitHub is down when you write from a chat | the door answers 5xx; Telegram retries; the door's check of its recent writes keeps it to one task |
| The edge is down | Telegram retries; unsent replies go out when it's back |
| Apply breaks halfway | the journal says what started; keyed writes aren't repeated; a started call is reported |
| The status comment was edited by someone else | ignored, said, and rebuilt from the task |
| The door App's key is refused | the door tells your chat directly; the watch alerts there too |
| `GITHUB_TOKEN`'s hourly calls run out | apply stops cleanly; the watch starts the task again later |
| A message no run gets past | 3 tries for the same cursor, then `stuck` and one alert |
| No `SHIPIFY_OWNER` | nothing runs (fails closed) |
| A runner too old to get jobs | the watch says so 5 days before |

## What we remove

Sizes measured today; the total is net of the new code, as an estimate measured in the build.

| Removed | Size today | Replaced by |
|---|---|---|
| Recipes: the case engine, `ship recipe`, the templates and catalogue, `recipes/`, `docs/recipes.md`, `skills/recipes`, `guides/recipe-template.md`, the Recipe form | 4,238 + 355 lines, 11 templates | repeats with checks; pre-approved calls |
| Hooks and connections: `ship connect`, `ship hook`, `lib/webhooks.ts`, `plugins/source.ts`, `sources/`, `docs/connections.md`, the door's hook routes | 1,543 + 190 + 229 lines, 28 files | — (back from history when wanted, as a comment the door writes) |
| The filing path: `task/file.ts`, the envelope and seal on boxes, the `file` job and filing steps | 447 + ~250 lines; ~128 lines of `task.yml` | the door writes the comment |
| The way out: `send.ts`, `lib/channels.ts`, `tools/door-send.ts`, two Send steps, the send key in five steps | 226 + 119 + 44 lines | the reply and the door's out path |
| The act agent run and the guard; the labeller | ~140 + 116 + 84 lines | apply's calls; `label` |
| The `lost` job | ~25 lines of `task.yml` | the watch's start-again |
| The round's paths: `round.ts`, most of `task.ts`, `lifecycle.ts`, `errands.ts`, `repeats.ts` | ~2,800 lines | `cli/kernel/` (~1,200) |
| Two GitHub seams: `lib/providers.ts`, `plugins/record.ts` | 365 + 151 lines | one GitHub module |
| Intents `try`, `ping`, `recipe`, `do` (an alias now); forms 1, 2, 3, 5, 6, 8; `form-reader` for them | 6 forms | words; Operate and Repeat forms stay |
| `ship people`, and people beyond your own ids | 53 lines and its lib | your ids in `SHIPIFY_PEOPLE`, set by `ship add telegram` |
| Codex, OpenCode, `manual`; the no-adapter paths; the mode without the bot App | — | — |
| shipify-admin: the console (`console.ts`, `connections.ts`, `keys.ts`, the web app), Cloudflare Access for it, the envelope press, the send route; the repo | ~1.1k Worker + ~2.3k web lines | `edge/` here: the door and the watch (~1.5–2k lines) |
| Keys: `GH_ADMIN_TOKEN`, the door key, the send key, `CF_READ_TOKEN` | 4 secrets | the door App's key |
| **Net, rough** | | **`cli/` ~26k → ~16k lines; two repos → one; tests about a third fewer; docs about half the words** |

**Not in 0.1: the projects layer.**
- **What stays:** staging, `ship release`, `pause` and `resume`, and the `custom-*` and
  `ts-package` stacks.
- **Why:** they're unused today, but they work and they aren't part of the core's problems.
  Removing staging would change the pipeline every app deploys through, for no gain today.
- **Later:** they can go in a release of their own, if you want them gone.

## Build plan

One release, built end to end in four PRs, each tested live on the Pi before the next.
- **Merged together:** steps 2 and 3, so Telegram's answers never stop. Step 2 removes the old way
  out, and step 3 brings the new one.
- **Every step ends with three things,** done before it counts as finished: its tests (`pnpm
  verify`, the new tests below, and the live check), its clean-up (what it replaced, deleted), and
  its docs (what it changed, rewritten).
- **The last step** is the full docs pass and the release.

| Step | Builds | Tests | Clean-up | Docs | Proven live by |
|---|---|---|---|---|---|
| **1. Foundations and security** | the two live holes closed: every job requires `main`, a dispatch carries only a task number, and a preview never gets runtime keys (one line in `pipeline.yml`, moving `v1`; no app but shipify-admin has runtime keys); the five contracts and the problem catalogue; the log helper; one GitHub module; the agent's own user and the runner's 0700 folders (box setup 5) | `workflows` (`main`, inputs, outputs); `contracts`; `ship selftest sandbox` | `providers.ts` and `plugins/record.ts` merged into one module; the mode without the bot App | `security.md`, `box-setup.md`, `setup.md` | `homepi` re-added; `ship selftest` |
| **2. The run** | plan, think, apply; decide (six intents, the fixed words); writes and the journal; replies with run details; act by the box; repeats with checks; pre-approved calls; the status comment's new shape | a `decide` test for every intent, fixed word and edge case; one golden list of writes per use case (U1–U11); act with no agent process; the think step's environment | `round.ts` and its paths; the act agent, the guard, the labeller; recipes, hooks, connections, `sources/`, templates; the `file` and `lost` jobs; four intents and six forms; Codex, OpenCode, `manual`; `ship people` | `tasks.md`, `tools.md`, `agents.md`, `notebook.md`, the glossary's words, `design.md`'s inside words | U1–U11 from GitHub, on the Pi |
| **3. The edge** (merged with 2) | `edge/` in this repo: the door's in and out for Telegram, OIDC, the record dedupe, the watch's duties, deployed by `ci.yml` after its checks; the door App; the status task | `edge/` tests: each chat case, OIDC, once-only sends, the watch's duties | `send.ts`, channels on boxes, `door-send.ts`, the door and send keys, `GH_ADMIN_TOKEN`, `CF_READ_TOKEN`, the console; shipify-admin archived once the edge is live | `door.md`, `channels.md`, the watch (folded in), `setup.md`, `getting-started.md` | `ship selftest chat`; a burst of messages, an album, a resend, a start-again, all from Telegram |
| **4. Docs and release** | the version restarts at 0.1.0, tagged `v0.1.0`; `v1` stays as the pipeline's contract tag; no app changes | golden stacks (unchanged); `pnpm verify`; `ship selftest all` | everything a sweep finds: old words, dead code, unused files, stale links | the full pass: `README.md`, every doc, `AGENTS.md`, playbooks, skills, `context.md`, `roadmap.md`, the ADR index, at half today's words | a change on playground goes live; every use case once more, from Telegram and GitHub |

**The cut-over at the release** (part of step 4):
- **Open 1.x tasks** are answered once ("closed for the 0.1 release; reopen or write again to carry
  on") and closed.
- **What carries over as it is:** notebook pages, PRs, the apps and their history.
- **The status task's record** is rebuilt by the first due run.
- **Telegram's webhook** is set again with `max_connections: 1` (`ship add telegram --yes`). It
  keeps the same address.
- **Cleanup in Cloudflare, optional:** the Access app that guarded the console can be deleted in
  Cloudflare's dashboard. The edge's routes don't need it, and each proves its own caller.

1.0.0 comes later: once this has run live for a while with every use case checked.

**Building it efficiently: reuse what works.** About half of today's task code moves into the new
steps as it is:
- run details (`lib/runs.ts`) and masking (`lib/safety.ts`);
- the notebook (`lib/notebook.ts`, `task/notebook.ts`);
- schedule reading (`lib/repeat.ts`);
- checkouts, PR lookups and pushes (`task/checkout.ts`);
- previews and checks (`task/ci.ts`) and deploys and Live (`task/deploys.ts`), now called by the
  due run;
- attachments, screenshots and published files (`task/files.ts`);
- operations and publishing (`task/ops.ts`, `task/plans.ts`);
- `ship refresh` and `sync` (`commands/workspace.ts`);
- the Notion server and `tools/mcp.ts`;
- the status task (`lib/status-issue.ts`);
- from shipify-admin: Telegram's parsing and rendering and the watch's checks.

What's written new is only:
- the routing (`decide`, replacing `round.ts`);
- the apply step;
- the contracts;
- the door's write-in and copy-out;
- the agent's sandbox.

The existing tests' cases (653 today) carry over as the `decide` and use-case tests wherever their
behaviour stays.

## Your guide: what you do

### During the build (once)

| When | You do | About |
|---|---|---|
| Now | merge #124 (this ADR) | a click |
| Step 1's PR | merge it, then re-add the Pi once: `pnpm ship box add shipify-pi --manage` (it shows the plan; `--yes` does it, asking for your sudo once, as `box add` always has). Then `pnpm ship selftest sandbox` | 10 min |
| Steps 2 and 3's PRs | merge both, back to back. Then `pnpm ship door setup --yes`: a GitHub page opens; press **Create**, then **Install** on shipify only. Then `pnpm ship add telegram --yes`, which keeps your bot and points it at the edge. Then `pnpm ship selftest chat` | 10 min |
| Step 4's PR | merge it. Then: archive shipify-admin (its repo → Settings → Archive); delete the old `shipify-admin` fine-grained token (GitHub → Settings → Developer settings); optionally, delete the console's Access app in Cloudflare | 5 min |

Each command shows what it will do before it does it, checks each step, and names the fix if one
fails, as `ship setup` does today.

### Every day

| You want | You do |
|---|---|
| an answer | write to the bot, or open an issue: just words |
| to carry on | reply to the bot's message, or comment on the task |
| a change to an app | `<app>: what to change` → its PR → merge → "Live" |
| a new app | `new: the idea` → a plan PR → merge → built → "Live" |
| a change in Notion | ask; read the exact calls on GitHub; comment `yes` |
| a note it keeps in mind | `remember: …` |
| a reminder or a regular job | `repeat: every Monday at 9, …`, or the Repeat form |
| to watch a value | `shipify: a check that tells me when <x> changes` → its PR (`checks/<name>.mjs`) → merge → `repeat: every hour, check <name>` |
| release, take down, bring back, roll back | the Operate form on GitHub |
| to see what's going on | `/ping` and `/apps` on Telegram; the status task on GitHub |
| to fix something that failed | its reply names the one thing to do |

### Changing Shipify later

| To | Do | The rule |
|---|---|---|
| fix or improve something | `shipify: …` from the bot, or `pnpm ship pr` from a terminal | a PR you merge |
| make a big change | an ADR first, merged, then the build | as today |
| let a tool act without asking | a pre-approved call in `tools.json` (fixed ids, capped text), in a PR | merging approves it |
| add a tool | start from `plugins/_template/tool/`, add its `tools.json` entry, run `pnpm ship tools check`, open a PR; after the merge, `pnpm ship add <tool>` | the ladder: a skill or a check first |
| add a chat channel | start from `edge/channels/` (the template and its conformance test), open a PR; after the merge, `pnpm ship add <channel>` | one channel in the edge |
| add a box or a slot | `pnpm ship box add <user@host> [--slots 2] --manage` | any box takes any run |
| upgrade an app's stack | `<app>: upgrade`, or `pnpm ship upgrade <app>` | its workflows must match the stack |

### Upkeep

| When | What | Reminded by |
|---|---|---|
| yearly, about 2027-09-30 | the agent's login: `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R <org>/shipify` | the watch |
| yearly | the door App's key: regenerate it on the App's page, then `pnpm ship door setup --new --yes` | the watch |
| 2027-09-28 | this PC's `tapp-pc` token | `ship doctor` |
| when it says so | a box offline, a runner near its update limit, an app failing | the alert, with its fix |

All of this goes into `docs/getting-started.md` and `docs/setup.md` in step 4, as the one guide.

## Setup

- **`pnpm ship door setup`** makes the door App. It shows the plan, then with `--yes`:
  1. **The App:** a manifest page opens in this PC's browser, the way `ship bot` does. You press
     Create, then Install on shipify only.
  2. **Its key:** set as a shipify secret for the edge's deploy.
  3. **The cleanup:** `GH_ADMIN_TOKEN` and `CF_READ_TOKEN` are removed, and you delete the old
     fine-grained token.
  4. **The check:** the door writes a test comment on the status task, a run replies, and the reply
     reaches your chat. After this, `ship door check` means: the edge answers `/health` with its
     version, and the door App is installed on shipify with exactly its permissions.
- **`pnpm ship add telegram`:** as today, minus the send key; it points the bot at the edge.
- **`pnpm ship box add`:**
  - **What it adds:** the agent's user, the sudoers rule, the runner's 0700 folders and its
    `UMask` (setup version 5, made once with the sudo you give `box add` today).
  - **The check:** `ship doctor` confirms the agent can't read the runner's folders.
  - **Existing boxes:** re-added once.
- **`pnpm ship selftest`** gains three checks:
  - `chat`: a message through the door becomes a comment, gets a reply, and the reply comes back
    once;
  - `act`: an approved call is made with no agent process started;
  - `sandbox`: an agent's user can't read the runner's folders, `/proc`, or the other slot's work.

## Docs and clean-up

The build updates each of these and removes what's listed; the target is half today's words.

- **Rewritten:** `README.md` (how it works, the three ideas, the use cases); `docs/design.md`
  (the parts, rules and keys above, and the inside words); `docs/tour.md`; `docs/glossary.md`
  (the words table); `docs/tasks.md` (repeats included); `docs/door.md` (the edge: in, out,
  the watch); `docs/channels.md`; `docs/tools.md` (act with no agent, pre-approved calls);
  `docs/plug-ins.md` (three kinds, one manifest header); `docs/security.md` (the table above);
  `docs/box-setup.md` (the agent's user).
- **Updated:** `docs/README.md`, `docs/agents.md`, `docs/watch.md` (folded into `door.md` or kept
  short), `docs/notebook.md`, `docs/setup.md`, `docs/getting-started.md`,
  `docs/configuration.md`, `docs/cli.md`, `docs/troubleshooting.md`, `docs/operations.md`,
  `docs/process.md`, `docs/context.md`, `docs/roadmap.md`.
- **Also updated:**
  - **The vocabulary files:** `intents.json` (six intents, the chat map, `help`, the fixed words),
    `tools.json` (argument schemas, pre-approved calls, Telegram's keys, no labeller),
    `executors.json`;
  - **Agent guidance:** `AGENTS.md` (its table and the "Changing Shipify itself" rules this
    amends); `playbooks/task.md`, `plan-app.md`, `build-app.md`; `skills/plug-ins`,
    `skills/notion`; `plugins/_template/` (tool, channel);
  - **GitHub:** the Operate and Repeat forms.
- **Removed:**
  - **Docs:** `docs/connections.md`, `docs/recipes.md`, `skills/recipes`,
    `guides/recipe-template.md`;
  - **Recipes and hooks:** `recipes/`, `sources/`;
  - **Forms:** the six forms;
  - **The repo:** shipify-admin, which you archive after the edge is live (archiving is yours);
  - **Old words:** every mention of envelope, file run, send key, round, errand, recipe, case,
    card, hook and `yes <n>`, found by a sweep.
- **The ADR index:** 0019, 0027, 0029 and 0030 are marked "amended by 0031"; 0029 "superseded by
  0031".

## Consequences

**Easier:**
- **One path:** every message is on a task, and every reply reaches your chat.
- **One run shape:** decide is plain code, tested as `snapshot → writes` with no GitHub.
- **One repo:** a chat change is one PR.
- **Smaller:** about 10k fewer lines and half the words.
- **Swappable parts:**
  - **another forge** is one GitHub module;
  - **another agent** only has to write `result.json`;
  - **another chat** is one channel in `edge/`.

**Harder:**
- **The edge writes to GitHub:** a narrow App, but more than reading and pressing.
- **Box setup goes to version 5:** a user and a sudoers rule. That amends your rule "no sudo after
  `box add`": you never type sudo again, but the runner uses that one rule.
- **A rewrite:** the round's 29 exits have to be re-expressed as intents and fixed words. The
  `decide` tests hold them.
- **Features gone until wanted:** recipes, hooks, the console, Codex and OpenCode.
- **Answers still take about a minute:** the job's setup (about 25 s) is the floor. Only a daemon
  on the box would beat it, and that would put secrets there.

## Confirmation

- **`tests/kernel/decide.test.ts`:** every intent, every fixed word (and where it's accepted), and
  every edge case above, as `snapshot → writes`, with no GitHub.
- **`tests/use-cases.test.ts`:** one golden list of writes per use case (U1–U11).
- **`tests/workflows.test.ts`:**
  - two jobs, every job requiring `main`;
  - the think step's environment has no write token, record token, act key or channel key;
  - write tokens are minted after think, for exactly one repo;
  - plan outputs come from fixed lists only.
- **`tests/plugins/*.test.ts`:** tools, channels and stacks against the manifest header and their
  contracts.
- **`edge/` tests:**
  - the door writes the right task or comment for each chat case;
  - a retry and an album each land on one task, with Telegram delivering one update at a time;
  - `/door/replied` takes only a valid OIDC token for shipify's `main` and sends each reply once;
  - the watch resends and gives up as above.
- **`pnpm ship selftest`:** `chat`, `act`, `sandbox`, `notebook`, plus today's, live on the Pi after
  each build PR.

## Decisions you made (2026-10-04)

You agreed each one; they're part of this design, not open questions:

1. **The version restarts at 0.1.0.** 1.x stays in history as the prototype. The apps stay on `@v1`,
   now the pipeline's contract tag, so none of them changes.
2. **The console is removed.** `/ping`, `/apps` and the status task cover it. Its Access setup and
   two keys go with it.
3. **The agent runs as its own Linux user,** with one sudoers rule (box setup version 5). The
   design's security rests on it.
4. **Recipes fold into repeats, and hooks are removed.** Neither has a real user, and you want no
   repo webhooks or issue use cases for now.
5. **The projects layer stays as it is** (staging, release, pause and resume, the unused stacks),
   so no app changes. It can go in a release of its own later.
6. **"Task" and "reply" stay the words;** "thread" and "say" from the first draft are dropped.
7. **The security fixes are built in step 1** of this plan, not as a separate PR.
8. **Every build step ends with its tests, its clean-up and its docs.**

## Your requests, mapped

| You asked (2026-10-04) | Where it's answered |
|---|---|
| Alter the core: modular, blocks, convenient, flexible; keep it intact | The parts; a run; writes (the building blocks); the ladder |
| Clean use cases, and stop running into simple issues | Use cases and their edge cases |
| Free, scalable, secure, the most robust | Limits; security, side by side; runs reconcile; the watch |
| Clear words | The words, side by side |
| No new providers | Read this first |
| A clean interface for plugging things in, OS and boxes style | The parts; plug-ins; one manifest header |
| Research designs and agent approaches; brutal: what works, what to abandon | Appendix A; What we remove; Appendix C |
| Use cases that fit your setup: cheap, self-managing, decentralised | Use cases; the watch; limits |
| The tools: input, output, interfaces | Tools |
| A unified layer for endless ideas | Every message lives on a task; the ladder |
| Am I solving at the wrong layer? | Why |
| Pick the most convenient direction; behaviour over storage | Read this first; Options |
| Edge cases, priority, side-by-side comparisons, radical ideas | Use cases; Build plan; Before and after; Options D–F |
| Reduce and simplify; clean up features and jobs | What we remove |
| A clean first cut, from the start | 0.1.0; no compatibility kept |
| Can the core be swapped for another system later? | Consequences: swappable parts |
| Nothing silent; well-formatted output; one interface for input, output and files across tools and channels | Nothing silent: one shape in, one shape out; U11 |
| What the agent did: its calls, model, time, tokens | Nothing silent: `RunDetails` |
| Common setup, proper logging and error messages, all handled | Setup; Nothing silent: `Problem` and logs |
| The security fixes in the plan, end to end at once | Build plan, step 1 |
| Nothing new needed: work with what we have, simply | Read this first; the door keeps no state |
| Tests, clean-up and docs in every step, after it's built | Build plan |
| Every requirement and use case covered | this table; use cases U1–U11 |
| Apps: only the changes they need; nothing broken | Your apps: no app changes; one pipeline line that changes nothing for them |
| Core flows (new app, change, upgrade, release) handled; build efficiently, with the future in mind | Core flows: who carries each one; Build plan: reuse what works; the ladder (rule 9) |

## Release

The build plan's step 4 is the release: 0.1.0, tagged `v0.1.0`. Your apps stay on `@v1`, the
pipeline's contract tag, and shipify-admin is archived. Merging this ADR approves the design and
that plan.

---

## Appendix A: what other systems taught us

From two research passes: agent platforms, durable engines, OS designs, MCP security and GitHub's
limits; then Home Assistant, VS Code, Kubernetes, n8n, Node-RED, Zapier, hexagonal architecture and
Backstage.

| System | We take | We refuse |
|---|---|---|
| **Kubernetes** | level-based reconcile: "Edge-triggered behavior must be just an optimization" ([principles](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/principles.md)); facts, not a phase enum ([api-conventions](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md)) | operators and CRDs |
| **Functional core, imperative shell; Elm** | decide returns writes as data; one place applies them ([Elm](https://guide.elm-lang.org/effects/)) | a framework for it |
| **Home Assistant** | one meeting point for output ([notify entity](https://developers.home-assistant.io/docs/core/entity/notify)): our reply; the core owns retry and repairs: our watch; guided setup that tests as it goes | everything in one process with full trust |
| **VS Code** | declarative manifests with a version range ([manifest](https://code.visualstudio.com/api/references/extension-manifest)) | process isolation sold as security |
| **Fuchsia** | no ambient authority ([capabilities](https://fuchsia.dev/fuchsia-src/concepts/components/v2/capabilities)): our two profiles and late-minted tokens | the routing machinery |
| **Erlang/OTP** | a supervisor with a bounded restart budget ([supervisor](https://www.erlang.org/doc/system/sup_princ.html)): start again 3 times, then `stuck` | — |
| **Stripe** | a key on every write ([idempotency](https://docs.stripe.com/api/idempotent_requests)); our journal for calls that can't be keyed | — |
| **Temporal, Inngest, Cloudflare Workflows** | named steps and a journal | the engines: leaky (determinism, versioning, waits that miss events) and a second record; Workflows' free plan caps at 3,000 steps a day ([pricing](https://developers.cloudflare.com/workflows/reference/pricing/)) |
| **Plan-then-execute, CaMeL** | the agent proposes typed calls; code with no model makes the approved ones ([patterns](https://arxiv.org/abs/2506.08837), [CaMeL](https://arxiv.org/abs/2503.18813)) | taint tracking: our calls are short and exact |
| **Rule of Two, the lethal trifecta** | an agent that reads and fetches writes nothing; a run that read the web needs your `yes` ([Meta](https://ai.meta.com/blog/practical-ai-agent-security/), [Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)) | detection as defence ([arXiv 2510.09023](https://arxiv.org/abs/2510.09023)) |
| **NanoClaw** | one writer per conversation; a script before waking the model ([scheduled tasks](https://github.com/nanocoai/nanoclaw/blob/main/docs/scheduled-tasks.md)): our checks; a small memory index | safety hooks inside the box the agent controls ([#865](https://github.com/nanocoai/nanoclaw/issues/865)); growing from 500 lines to ~44k |
| **OpenClaw** | runs serialized per session ([queue](https://docs.openclaw.ai/concepts/queue)) | in-process plug-ins with full trust (722 advisories); an open skill market ([341+ malicious](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)); heartbeat turns ([~100K tokens](https://docs.openclaw.ai/gateway/heartbeat)) |
| **Hermes Agent** | the footprint ladder ([AGENTS.md](https://github.com/NousResearch/hermes-agent/blob/main/AGENTS.md)): our rule 9; a small frozen memory | skills and memory the agent writes unreviewed; an LLM judging approvals; in-process checks as a boundary ([SECURITY.md](https://github.com/NousResearch/hermes-agent/blob/main/SECURITY.md)) |
| **Backstage** | plug-ins never import each other ([architecture](https://backstage.io/docs/backend-system/architecture/index)) | — |
| **Event sourcing, CQRS** | — | "For most systems CQRS adds risky complexity" ([Fowler](https://martinfowler.com/bliki/CQRS.html)) |

## Appendix B: assumptions, checked

| Assumption | How it was checked |
|---|---|
| Events made with a GitHub App's token start workflows; `GITHUB_TOKEN`'s don't, except dispatches | [GitHub docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) |
| Issue and comment events run the default branch's workflow | [events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) |
| `queue: max` keeps up to 100 pending runs per group ("ordering is not guaranteed") | [changelog 2026-05-07](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues); in use in `task.yml` |
| A queued job waits at most 24 h for a runner; a runner must update within 30 days | [Actions limits](https://docs.github.com/en/actions/reference/limits), [self-hosted runners](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) |
| `GITHUB_TOKEN`: 1,000 calls an hour per repo; an App: 5,000+; 80 created items a minute, 500 an hour | [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| GitHub doesn't redeliver failed webhooks, so nothing here relies on one | [redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks) |
| Telegram retries a call that doesn't answer 2xx; each update has an `update_id` | [Bot API, setWebhook](https://core.telegram.org/bots/api#setwebhook) |
| Telegram's `max_connections: 1` delivers one update at a time, so the door's look at its recent writes can't race | [Bot API, setWebhook](https://core.telegram.org/bots/api#setwebhook) (1 to 100 connections); **step 3 confirms it** with a burst and an album |
| A job can get an OIDC token for an audience it names, carrying its repository, ref and workflow | [GitHub OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) |
| A Worker can sign an App JWT and verify GitHub's OIDC tokens (RS256, WebCrypto) within its CPU budget | **step 1 measures it** on the real Worker before anything is built on it |
| A secret can be passed to a step on an earlier step's output | the pattern exists on inputs today; **step 2 checks** it on outputs |
| The agent's own user works with one sudoers rule, on the Pi, with the runner's folders at 0700 | **step 1 tries it** on the Pi before anything else rests on it |
| The pinned Claude Code's flags for "only user settings, only this MCP config" | **step 1 checks** them on 2.1.284 |
| A chat question's time: ~25 s of job setup, 30–60 s of agent, a few seconds to apply and send | the measured runs, step by step |

## Appendix C: the reviews, and what changed

Three independent reviews of the first draft, against the code:

- **Security:**
  - the agent's own user became required;
  - the door App lost Actions write (the watch starts runs with a label);
  - every job requires `main`, and a dispatch carries only a task number;
  - a `yes` must be unedited and from your account, and approvals show exact calls;
  - OIDC replaced the open nudge and the file key;
  - only the door App's own 🚀 counts as sent;
  - previews of the edge are impossible;
  - the journal covers calls that can't be keyed;
  - the watch alerts directly when GitHub or the chat is what's down;
  - it found **two live holes**, fixed in step 1 of the build plan.
- **Completeness:**
  - a default for words with no prefix;
  - a second run when work belongs to a project;
  - new words while waiting;
  - merges, previews and deploys followed by the watch;
  - edits count as new;
  - files fetched with OIDC;
  - chat commands from one map;
  - the agent's other writes (plan PR, doc PR, publish push, upgrades) made by apply;
  - screenshots, run details, 👀, the model field, quiet repeats, notebook pages and the
    channel guard kept;
  - its corrected numbers are used above.
- **Simplicity:**
  - recipes folded into repeats, and hooks removed;
  - plain code instead of a flow language and a block registry;
  - two profiles instead of a capability system;
  - the console removed;
  - one repo (option F);
  - the `lost` job removed;
  - six intents and two forms;
  - "task" and "reply" kept as words;
  - the doc cut by a third.

Then, on your word to use only what's already there, the D1 table was dropped. The door dedupes
by looking at its own recent writes on GitHub, with Telegram delivering one update at a time.
