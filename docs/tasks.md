# Tasks

A **task** is one issue on the shipify repo: a conversation and everything it leads to (a PR, a
repeat, a deploy). You write on GitHub, or to the bot on Telegram, which the door writes onto the
task for you. Every answer is a **reply** on the task, and the door copies it to your chat
([door.md](door.md), [channels.md](channels.md)). The agent's side of a run:
[playbooks/task.md](../playbooks/task.md).

## Writing a task

**Open an issue on shipify** (a blank one is fine from the GitHub app), **or write to the bot**:
anything that isn't a reply to one of its messages becomes a new task, titled from your words.

**The title's first word says what you want.** There are six intents, written once in
`intents.json` (its words, its form, its chat command):

| You write | Intent | What you get |
|---|---|---|
| plain words, `ask: …`, `question: …`, `do: …` | question | an answer; or a change it found, shown first (tool calls for your `yes`, a note, a repeat, work on a project) |
| `<project or repo>: …` (`acme-site: bigger margins`, `shipify: …`, `notes-api: fix the typo`) | change | a PR that closes the task; merging it ships it. Another of your repos is changed its own way ([Any repo](#any-repo)) |
| `<account>/<repo>: …` (`acme/api: rate-limit /login`) | change | the same, on a repo on another of your accounts ([Any account](#any-account)) |
| `new: …` | new | a plan PR; merging it builds and publishes the app |
| `remember: …`, `remember <topic>: …` | remember | a note in the [notebook](notebook.md), written with no agent; the task closes |
| `repeat: …`, or the Repeat form | repeat | a reminder, a job or a check on a schedule ([Repeats](#repeats)) |
| the Operate form, or its title from any channel (`<app>: release`, `take it down`, `bring it back`, `roll back production`) | operate | a release, take-down, bring-back or rollback, run once on GitHub's machines with no agent |
| `shipify: release`, `shipify: release minor` or `major` | operate | a release of Shipify itself: checked, versioned (patch by default) and published to the template, which offers it to every copy as a PR ([releases.md](releases.md)) |

- **The body is optional:** details, links, screenshots.
- **A first word that names no project or repo of yours** ("Bug: the login is blank") is read as
  plain words: a question. If the answer is a change to a project, a work run on it follows.
- **`look at <repo>`,** anywhere in your words, reads that repo first: one of yours, on any of
  your accounts, or anyone's public one ([Any repo](#any-repo)).
- **In a chat,** `/ask`, `/change`, `/new`, `/remember` and `/repeat` map to the same intents, and
  each always starts a new task (even sent as a reply). A fresh message is a new task; a reply
  carries one on; `/tasks` lists them and `/use` picks the model, answered at once with no task
  ([channels.md](channels.md#using-telegram)).

**The two forms** (on GitHub's "New issue" page):

| Form | You fill in | What happens |
|---|---|---|
| **Repeat something** | What, When, Kind (reminder, job, check), Check (a check's script name), Model | the repeat is set with no agent, and the reply says when it runs next |
| **Release or take down** (Operate) | Project, Action (release, take down, bring back, roll back), Version (rollbacks only) | it runs once on GitHub's machines. A release opens its PR for you to merge |

- **Checked first:** a missing answer, a schedule it can't read, or a version that isn't like
  `v1.0.3` gets a "needs you" reply and runs nothing. Edit the issue (**⋯ → Edit**) to fix it: that
  starts it.
- **Editing a Repeat form later** changes the repeat, with no agent.
- **An operation:** the form on GitHub, or its words as a task's title (`spotter: release`,
  `spotter: take it down`, `spotter: bring it back`, `spotter: roll back production`). A release
  works from any chat too: it opens a PR, and your merge deploys it. The other three change the
  live app at once, with no merge, so they start (and run again with `continue`) only on GitHub;
  from a chat, nothing runs and the reply links the form (ADR 0049).

## What happens: one run, one reply

Each time there's something new on a task (your comment, an edit, a repeat's time), one **run**
picks it up on a box. A run has five steps:

| Step | Runs as | Does |
|---|---|---|
| **task** | the box | reads the task once (its issue, comments and status), and names the account it works on, so plan's keys are for it ([Any account](#any-account)) |
| **plan** | the box | carries on from that read: puts 👀 on your new words, reads fixed words and the intent, and decides whether the agent is needed |
| **think** | the agent's own Linux user | only when needed: the agent reads and suggests, and writes its result. On a project it changes files and commits in its own clone |
| **decide** | the box | keeps what the task allows from the result, and names the one repo to write and the one tool to act with |
| **apply** | the box | makes every change: the reply, the push and PR, notes, the repeat, approved tool calls. Then it tells the door |

- **One reply per run.** Its kind is answer, needs you, live, alert or failed.
- **Who hears it:** where you wrote. The chats of the messages it answered (none for words on
  GitHub); the chat the task came from on its first answer, and when no new words started the run
  (a PR's checks, a deploy, a cut-off run). A task you carry on in GitHub or the web chat stays
  there, even when it needs you. Your default channels get an alert, a repeat's reply (a reminder,
  a job, a check that changed) and every reply on a task Shipify opened itself. Every step that
  replies (a run, a crashed run's report, an operation, a release) sends the same way.
- **The agent only thinks.** It never pushes, opens a PR, calls a tool that changes something, or
  writes a note. The box does all of that, after the agent has stopped ([agents.md](agents.md)).
- **What the agent may touch** (its profile):
  - **talk:** the web, the tools' look calls, and your projects' and repos' code, which it clones
    itself, read-only, only when a question needs it. Questions use this.
  - **work:** one project's or repo's clone, on the task's branch. Changes and new apps use this.
  - **read:** only the repos the task reads, files only: no command, no web, no key. A task that
    reads a repo outside your account uses this ([Any repo](#any-repo)).
- **A second run, only when you asked for a change:** words that ask for one with no project
  prefix ("fix acme-site's button") get a work run on that project, which follows by itself. Its
  reply always ends "A work run on <project> starts now, from this reply: say `stop` to stop it." A
  question or a check ("can you look at…") gets an answer, saying what it would change; your "go
  ahead" starts that run.
- **Nothing new, nothing done:** a run that finds no new words, edit or due time ends at once.
- **Words while it works:** see [below](#words-while-a-run-works): this run takes them in before
  it answers, or you `stop` it.

### Words while a run works

A run reads its task when it starts, and the agent can't take a message mid-step. So:

- **Read again as the agent starts:** getting ready (the clone, the project's setup) can take a
  while, so the run reads the task once more just before the agent starts. Plain words you wrote
  since are marked NEW in its prompt, as if the run had begun with them.
- **Taken in before it answers:** when the agent has its answer, and before anything is posted, the
  run reads the task again. Plain words you wrote since go to the same agent session, which takes
  them in (changing the work if they ask). Then it reads again, in case you wrote more meanwhile,
  until a read finds nothing new (no round count, ADR 0060). You get one reply that covers it all:
  the agent's first ask, and each catch-up,
  lists every one of your asks so far, numbered (the task's own words, then each message), so none
  is left out. 👀 goes on each message it took in when the
  reply is posted (the run's agent step has no key that can write on GitHub). The next run finds
  nothing new. The run details say so.
  - **Files too:** a screenshot or a file with your words (pasted on GitHub, or sent through a
    chat) is fetched first, beside the run's own, the same way a run's start fetches them. That
    costs a read only when there's a file.
  - **What waits for the next run instead:** a fixed word, a `use`, a command, a note, a lone
    thanks, an edited comment, and anything after one of those. As before, the next run reads
    them, and the run details say how many wait.
  - **Only with time left:** with less than 5 minutes left on the agent's 200, the next run reads
    them.
- **`stop`:** while the agent works, the run reads the task about once a minute for a `stop`. It
  stops the agent and everything it started; what it committed (and edits it hadn't) is kept on
  the task's branch, as when a run stops by itself ([ADR 0035](adr/0035-runs-keep-their-work.md)).
  The reply says "Stopped": say what's next, or `continue`. The run then stays, as after any
  answer: your next words carry on in the same session. A `stop` once the agent has answered (its
  checks running, the reply going out) finds nothing to stop, and says so.
- **Sent as the reply was written** (while the box's checks ran, after its last read): the run reads
  the task once more as it replies. The reply says how many of your messages are next, so its
  "needs you" never hides them. The run their comments queued reads them now.
- **In the web chat:** each message of yours a run read shows a tick, as in any chat (GitHub's 👀
  count comes with the comments the page already reads). A run queued before the last reply still
  shows as Queued or Working while your newest message has no 👀.
- **A merge before a run read your words:** the PR's merge closes the task, and its **Merged** (or
  **Live**) reply says that a message of yours came in before the merge and no run read it. Words
  you write after that reopen the task, and the run reads those older words as new too.
- **What it costs:** one small read of the comments written since the run started as the agent
  starts, about once a minute while it works, and one before it answers (one more after each round
  that took words in). A run that's stopped saves the rest of its time.

### A run that stays

After a run answers your words, it stays (ADR 0057): for `SHIPIFY_STAY` quiet minutes (20 unless
you set it; `0` turns it off) it reads the task every 2 seconds. **One rule** (ADR 0063): it does
with your next words what a normal run would do, in the same job and agent session, so they're
answered in seconds rather than in a new run. It hands over only what needs something a stay
can't have.

- **When:** after every answer to your words (ADR 0060), whatever the run did: an answer, a
  question, a PR it opened or updated, a list for your `yes`. Not when its answer started another
  run (a work run, the GitHub job) or closed the task, nor after a repeat, a due run or a check.
- **On a project:** the stay carries on in the run's clone, and pushes nothing. Asked for a change,
  it says what it will change and starts a work run on the task's branch, which does it with the
  whole thread.
- **The same answer as a run's:** each turn is plan, think, decide and apply, with 👀, the run
  details ("The run stayed…") and one reply for everything you sent meanwhile, each ask numbered.
- **A new model or effort keeps the session** (ADR 0063): `use opus high`, alone or with your
  words, is answered in the stay, and your next words go to the same session with the new model.
  Only another agent (`use pi`) needs a new session: a normal run.
- **The fixed words are the stay's too:** `continue` carries on in the session; `no`, `resume`,
  `stop repeating`, `reopen`, a thanks and `/ping` are answered in the stay, which keeps staying;
  `close` closes the task, and `publish` starts the build, then the stay ends.
- **Your `stop`:** a turn that's working stops (as a run does, within a minute) and says
  "Stopped"; with no turn working, the stay says there was nothing to stop; one that came as a turn
  answered is said in that answer. Either way it keeps staying, in the same session.
- **What goes to a normal run instead:** only what a stay can't have: another agent, repo or
  account; a fresh clone (`start over`, `go`); or the task's text read again (an edit).
- **The box's own files are never shared:** a reply never uploads the agent's handoff or result,
  which the box keeps itself. A file shared before, unchanged, is linked ("… (unchanged)"), not
  uploaded. Neither needs a key, so the stay goes on.
- **An answer that needs a write key** (a new or changed file, your `yes` to a list, a push; ADR
  0062): the stay ends with it decided, and its own job mints just those keys and posts it. No new
  run, nothing thought twice. Words you send after it go to a normal run, which reads every word
  the stay hasn't answered. A stay on a project sends only its own turn's commits: what the run
  pushed before it never needs a key again.
- **It ends** after its quiet minutes, when its job's time is nearly up (no cap of its own: past an
  hour, only the agent's own GitHub reads fail, as in a long work run), on a close, when its label
  is taken off (your merge of its plan does that, so the build runs next), or when another
  task's run, or its box's weekly clean-up, waits for its slot. It answers words already waiting
  first. Stays on different slots give way one at a time, so one slot frees per run that waits. Words that came as it left go
  to a run of their own: never unanswered.
- **On the task:** the label `staying` while it does. No run starts for your comments meanwhile
  (each shows as a skipped run in Actions); a close or an edit on GitHub runs after the stay. The web chat says **Staying**, in the list and the thread.
  A stay whose box died leaves its label: the watch takes it off within 5 minutes of GitHub ending
  its job, so your next words start a run.

**Same session, or a new run:** one rule, which plan applies to your next words: the stay does
what a normal run would do with them, else a new run does.

| Your next words | Who answers | The agent's session | Its cache |
|---|---|---|---|
| plain words, `continue`, `stop`, a `use` of the same agent (any model or effort) | the stay | the same, resumed (`--resume`) | warm: only the new words are new |
| `no`, `resume`, `stop repeating`, `reopen`, a thanks, `/ping` | the stay, with no agent | kept for your next words | warm |
| `yes` to a list, an answer with a new file or a push | the stay decides; its job mints the key and posts it | ends with that job | — |
| `close`, `publish`, a change (a PR) | the stay; then the task closes, the build or a work run starts | new, with the thread and the handoff | cold, once |
| another agent, repo or account; `start over`, `go`; an edit | a normal run | new | cold, once |

A change goes to a work run because a PR needs what no stay holds: the project's clone set up, and a
write key, which the job mints in its own step after the agent and never hands it (ADR 0031, ADR
0059). The stay says so in its reply ("A work run on … starts now"), then leaves. Why a stay can't
come back after its job posts an answer: GitHub runs a job's steps once, in order, and the keys are
made after the agent's step. Only a new job can stay again, and that's a normal run.

**Where you see it:**
- **👀** on your comment, and on the task itself for its own words: a run has read it (the web
  chat shows ✓✓).
- **The label:** `working`, then `needs you`, `answered` or `failed`. `deploying` while a merged
  PR goes live; `stuck` (shown as Stopped) when a run ended before it finished, or no run started
  for your words: say `continue`.
- **The status comment** at the top: the state, the model, the PRs, what's waiting, and the last
  runs. Only a run edits it; if anyone else does, it's ignored and rebuilt from the task.

## Any repo

ADR 0044. Shipify reads any GitHub repo, and changes any repo in your account through a PR.

- **`look at <repo>[, <repo>…]`** in your words (`look at acme/tool and tell me what it does`): a
  `<repo>` is a project's name, one of your repos, an `owner/name` or a github.com link. Before the
  agent starts, the box clones each one into the run's `read/` folder, newest commit only. Every run
  of that task reads them again, since its conversation carries what they said.
  - **A name that's no repo** (`look at src/App.tsx`, a repo GitHub doesn't have) is only words:
    plan asks GitHub once about each `owner/name`, and nothing about the run changes.
  - **Yours** are read with the run's read-only key. **Anyone else's** (public) is read with no key,
    and the task's runs, on a schedule too, are in the **read** profile: the agent reads files and nothing else (no
    command, no web, no key, nothing outside the repos it was given), notes and calls from it wait
    for your `yes`, it sets no repeat, and images in its reply are inert (shown as links). Nothing in
    such a repo is ever run. To
    change something because of it, ask in a new task, saying what to take from the answer.
  - **The disk is the one limit:** GitHub's size before the clone, then the files' own size before
    they're written, each leaving doctor's 5 GB free. A repo that doesn't fit, isn't there (or is
    private to another account), or GitHub won't serve now, is said in the reply; the others are
    read anyway. The clone's clock is 5 minutes.
- **A plain question clones nothing up front.** When it needs a project's or a repo's code, the
  agent clones that one itself, read-only.
- **`<repo>: …` on another of your repos** (one in your account with no `shipify.json`): a change
  run on it, its own way. The agent follows the repo's own rules first (its `AGENTS.md`,
  `CONTRIBUTING`, README, its commands and CI), then Shipify's: its own branch, a PR you merge, the
  secret scan, and no change to its workflow files. The box runs no project checks on it: its CI
  checks the PR. Shipify adds none of its own files to it. Its PR goes against its default
  branch, `main` or not (ADR 0045). It isn't deployed, released or listed as an app.

## Any account

ADR 0045. Shipify works on repos on your other accounts too: your company's org, your own user
account, another org of yours. You add each one, and its admins install Shipify's small **repos
App** there ([setup.md](setup.md#another-account-the-repos-app)).

- **Your accounts:** Shipify's own, and each one you add (`pnpm ship bot repos acme`). An account
  you haven't added is anyone's: its repos are only read, as in [Any repo](#any-repo), even where
  someone installed the App. A change asked there gets the box's own reply, saying how to add it.
- **`<account>/<repo>: …`** (`acme/api: rate-limit /login`): a change on it, its own way, as for
  your own repos. Its PR goes against its default branch, opened by the repos App (`<name>[bot]`),
  its commits in the App's name.
- **`look at acme/api`** reads it, private repos too.
- **One task, one account.** A task works on the account its repo is on: from its title, or, for a
  question, the first of your accounts its `look at` names. A repo on another account is said in
  the reply, and not read: ask for it in a task of its own.
- **What a run there holds:** that repo's key, Shipify's rules, and that repo's own notebook page
  ([notebook.md](notebook.md#a-repos-own-notes)). Never the rest of your notebook, your tools' keys
  or your other repos: that account's repos are written by other people too. Its notes wait for
  your `yes`.
- **The repos App missing,** not set up, or not given that repo: the box replies itself, with no
  agent, saying which, in GitHub's own words where it gave some (an IP allow list, say), with the
  link that fixes it. Nothing changes, and your later words on that task go to the agent as usual.
- **A title like `CI/CD: …`** is a repo only when it's on one of your accounts, or GitHub has it:
  otherwise it's plain words, a question.
- **Its PR, from open to merged:**
  - its checks run in the repo's own CI, and nothing follows them in the background: you look.
    Ask "why did the checks fail?" and a run reads them and says; ask it to fix them, and it does,
    on the same PR while it's open, or in a new PR once it's merged;
  - merged, the task closes with it (GitHub does that across accounts), and its next run says the
    PR was merged; `close` closes it;
  - `start over` closes it with that account's key, as on your own.
- **Not here:** previews, deploys, releases and the watch's following are a project's, on
  Shipify's own account.

### Which repos

Every repo is one kind of extension (ADR 0047): what the App's install reaches, its own file
deciding its kind. `/repos` (on GitHub, Telegram or the web chat) lists them as a task names them,
and the web chat's **Change a repo** offers the same list (a tap writes "acme-site: " for you).

| | **Project** (Shipify built it) | **Repo** (anyone's) |
|---|---|---|
| **Its kind** | its `shipify.json` | no `shipify.json` |
| **Named** | `acme-site: …` | `notes-api: …`; on another account `acme/api: …` |
| **Its rules** | its stack's | its own: `AGENTS.md`, README, CI |
| **The check before a PR** | `make verify` | its own CI, on the PR |
| **After the merge** | deploy, Live, releases | its own pipeline |
| **Always applies** | its notes (`remember acme-site: …`) | its notes (`remember acme/api: …`) |

- **Shipify's own account:** the daily check lists its repos, projects first, from the read it
  already makes for the apps. Nothing more is read for `/repos`: the door reads the status task.
- **Another of your accounts:** `/repos` names it from your accounts list (`SHIPIFY_ACCOUNTS`), and
  you name its repos as `owner/name`. The first task on one checks Shipify can reach it, and says
  what's missing if not.
- **A repo made since** works by its name at once: every run asks GitHub. The list only catches up.
- **Not listed:** an archived repo, or one the App wasn't given (on GitHub: the account's Settings →
  Applications → the App → Configure).
- **No second list:** GitHub's install says which repos, your accounts list says whose.

## Fixed words

A **fixed word** is a whole comment the box reads itself, with no agent. **One flow, one rule:**
each works the same from GitHub or any chat. Only GitHub gives a PR's merge, and starts what
changes the live app at once (taking an app down, bringing it back, a rollback) (ADR 0049).

| Word | What it does | When it counts |
|---|---|---|
| `yes` | makes exactly the listed tool calls (and notes), once each. A list's **Yes** in a chat sends `yes <its code>` | your whole, unedited message, after the list, within a day. A list over 3,000 characters can't be shown whole in a chat, so it's approved on GitHub, where you see it all |
| `no` | drops the listed calls: nothing changes. A list's **No** in a chat sends `no <its code>` | a list waits |
| `continue` (or `again`) | tries again after a failure; on an operation, runs it again. `again` on a repeat or a recipe runs its job now | always; taking an app down, bringing it back or a rollback runs again only from GitHub |
| `start over` | closes the open PR and begins again from the repo's default branch | a PR is open, or not |
| `preview` | a live preview of the open PR, with its checks run against it | a PR is open |
| `publish` | a merged plan's repo, keys and build, or again after they stopped | the plan is merged |
| `go` | builds a big change once its doc PR is merged; on a new project's task, the same as `publish` | the doc (or plan) is merged |
| `stop repeating` | ends a repeat and closes the task | it repeats |
| `resume` | starts a paused repeat again | it's paused |
| `close` | closes the task: its PRs stay, a repeat pauses (`resume` carries it on); write again to reopen it. From a chat, the door closes it at once with its state labels, the chat answers "Closed · #12", and no run starts: the next run that reads the task notes it (ADR 0040). On GitHub, a run closes it and says so | always |
| `reopen` | reopens a closed task with no agent, and it waits for what you'd like next. From a chat, the door reopens it at once ("Reopened · #12") and no run starts: your next words do. On GitHub, a run reopens it, a minute or more after it closed, and says so | it's closed |
| `stop` | stops the run that's going, within a minute: what it committed stays on the task's branch, and the run stays ([above](#a-run-that-stays)), so your next words carry on in the same session ([below](#words-while-a-run-works)) | always |
| `remember: …` · `forget: …` | keeps or removes a note in the notebook, with no agent ([notebook.md](notebook.md)) | always |
| `/ping` · `/apps` · `/repos` · `/help` · `/notebook` · `/recipes` · `/models` | the same answer a chat gets, with no agent | anywhere |
| `use <model>` | the model (or effort, or agent) for the task's runs: alone, from your next message (from a chat it starts no run; on GitHub a run says so); as a line in a message, from that message's run | anywhere |

Anything else is plain words: the next run reads them, and the agent answers.

**Your `yes`** is the only approval besides a merge ([tools.md](tools.md), ADR 0049):
- **Whole and unedited:** the message is just `yes` (or a list's Yes, `yes <code>`), from you on
  GitHub or through your chat, never changed after you wrote it.
- **After the list,** and **within a day** of it.
- **A list's Yes names its list:** under an older reply it approves nothing, and one with no list
  waiting is answered with no agent: nothing was changed.
- **A list over 3,000 characters** can't be shown whole in a chat: it gets no Yes there, and is
  approved on GitHub only.
- **Other words after the list** plan again, and the list is dropped: the next run lists again
  whatever still stands.
- **With nothing listed,** `yes` and `no` are plain words: the agent reads them (an answer to its
  own question).

**`use <model>`** picks what the task's runs think with:
- `use opus`, `use opus high`, `use sonnet low`, `use claude-opus-5-5`, `use auto`.
- **A model names its agent** (ADR 0042): a listed model picks its own agent from any task, so
  `use sonnet` on a pi task moves it to Claude Code, and `use glm-5.3-flash` on a Claude task moves
  it to pi. A gateway's model goes by its name after the maker (`glm-5.3-flash` for
  `z-ai/glm-5.3-flash`) when no other listed model shares it. A model two agents take (pi and
  OpenCode share OpenRouter's) stays on the task's agent when it's one of them, else goes to pi. The
  models of an agent through another gateway (`pi-vercel`) are named through it: `use pi-vercel
  glm-5.3`, or a bare word on a task already on it.
- **Another agent by name:** `use pi` (pi on its Auto), `use pi z-ai/glm-5.3 high` (any model id at
  its gateway: `/models <word>` finds them), `use opencode` the same, `use pi-vercel` pi through
  Vercel's AI Gateway; `use claude` goes back.
- **One grammar:** the door and the box read `use` with the same code (`cli/contracts/use.ts`), so
  a chat never takes a pick the box would refuse.
- **Alone** (a chat message, or a comment, that is only `use …`): a setting, from your next
  message on. From a chat (Telegram, the web chat) it starts no run: the door answers at once
  ("From your next message: Opus · #12"), or refuses one that names no model, and marks it so
  `task.yml` and the watch leave it for your next words. On GitHub, a comment of it alone is
  answered by a run ("From the next run: Opus").
- **Your model** (a chat): `use …` or `/use` sent with no task sets the model your new tasks start
  with, kept per chat at the edge; each new task gets it as a `use` line before your words, and
  its "Got it" names it. A reply on a task changes that task only
  ([channels.md](channels.md#picking-a-model-your-model)).
- **As a line of its own in a message** ("how sure are we?" then `use opus` below it), on GitHub or in
  a chat, or in a new task's text: that message's run already thinks with it, and the run details
  name the model. Words that name no agent or model (`use tailwind`) stay words for the agent.
- **Picks build on each other** in the order you said them: `use sonnet`, then `use high`, is
  Sonnet at high, whatever the task was on. `/use` alone answers the task's pick and what a `use`
  takes; your other words in the same run still run.
- **A pick that can't be used is told, never dropped:** one that names an agent or a model but
  can't be taken (`use haiku max`, two agents, a model no agent lists) is answered with the choices,
  and nothing runs with a model you didn't choose: from a chat the door answers at once and writes
  nothing; on GitHub the run says so, runs no agent, and counts your words as read, so you send
  them again with a pick it can use.
- **The choices** come from `executors.json`. Claude Code's: the models (haiku, sonnet, opus,
  fable), any Claude model id, and the efforts (low, medium, high, xhigh, max); **Auto** is Sonnet
  at medium effort. pi's and OpenCode's: any id their gateway has (a few listed first, `/models`), and the
  efforts (off, low, medium, high, max) as far as each model takes them; **Auto** is Nemotron, free,
  at high, through OpenRouter (`pi`, `opencode`), GLM 5.3 Flash at high through Vercel (`pi-vercel`,
  `opencode-vercel`). The default agent is Claude Code, unless
  the variable `SHIPIFY_AGENT` names another ([agents.md](agents.md)).
- **The Repeat form's Model** sets a job's model when you open it: on the web chat's page, a choice
  of each agent as `executors.json` makes them (Claude Code's models, Pi, OpenCode, Pi · Vercel, …);
  on GitHub, the words a `use` line says (`opus`, `pi-vercel zai/glm-5.3`), empty for Auto.
- The task keeps its choice in its status comment. More: [agents.md](agents.md).

## Repeats

A **repeat** is a task with a time. One you want to keep and review as a file is a **recipe**
([recipes.md](recipes.md)).

**Set one up:**
- **In words:** `repeat: every Monday at 9, acme-site's dependency updates`. The agent reads the
  schedule, and the reply confirms it: "Set: every Monday at 09:00. Next: …".
- **With the Repeat form:** no agent at all.

**Three kinds:**

| Kind | At each time | At most | Replies |
|---|---|---|---|
| **reminder** | posts its text; no agent | every 15 minutes | every time |
| **job** | the agent does the job (talk) | every hour | only when it has something to say |
| **check** | runs a script from `checks/` as the agent's user, with no keys, for a minute at most | every 15 minutes | only when its output changes |

- **Schedules:** "every day at 09:00", "every weekday at 8:30", "every Monday at 9", "on the 1st of
  every month at 09:00", "every hour", "every 6 hours", "every 2 hours from 9am to 9pm". Times are
  in your time zone (your copy's `SHIPIFY_TIME_ZONE`), and every chat says
  it beside a time of day ("every Sunday at 14:00 IST", "Next: Sun 11 Oct, 14:00 IST"). A schedule
  may name that zone ("every Sunday at 2 pm IST"); another zone's is refused, never converted.
- **Once, then it ends** (a check-back): "in 15 minutes", "in 5 hours", "in 2 hours and 30
  minutes", "at 17:30" (its next), "today at 5pm", "tomorrow at 9". Ask on the task it's about:
  "check PR #12's CI in 15 minutes and tell me" (a job: the agent looks once, with the whole
  thread, and always says what it found), or "remind me in an hour to call Sam" (a reminder).
  - The soonest is in 5 minutes, the furthest 30 days ahead.
  - It isn't skipped while the task's PR waits: looking at that PR is often the point.
  - After it fires, its `repeats` label comes off and the task is answered, so it closes after a
    quiet day.
  - One per task: asking again moves it. A task that repeats takes none; a check is never once.
  - The status line says "**Once** at Thu 15 Oct, 17:30 IST (a job for the agent)". Closing the
    task drops it, and `stop repeating` cancels it.
- **Errands: when something happens, once** (ADR 0054): a time once that waits for a PR or a
  branch instead of a clock. Ask on the task it's about, in words, the Repeat form or `/repeat`:
  - **Its checks end:** "when links#12's checks finish", "when the PR's checks end" (the task's
    newest PR), "when shipify's main checks finish" (a branch's newest commit, a pipeline after a
    merge). A push while it waits makes the new commit's checks the ones it waits for.
  - **Merged:** "when #405 merges" (or is closed without merging).
  - **Deployed:** "when #405 is live", "when it's deployed": merged, then every check on its merge
    commit ended. For an app that's its deploy, Live or failed; elsewhere its CI on `main`.
  - **Which PR:** its link, `<repo>#<n>`, or `#<n>` on the task's own repo (its project's, else
    shipify's). Only your own account's repos: the due run holds no key elsewhere.
  - **How long:** a day, or as you say, at least 10 minutes and at most 7 days: "… for 3 days",
    "… within 2 hours".
  - **How it waits:** the task is labelled `waiting` (`gh issue list --label waiting` lists every
    errand), and its status line says "**Waiting** for links#12's checks to finish, then a reminder
    · until Fri 16 Oct, 09:00 IST". The due run looks with one GitHub read and no agent, every 10
    minutes in its first hour and every 30 after, and lists it in "Coming up" at its next look.
  - **When it happens:** the task's run reads it again, then fires once. A **reminder** says what
    happened ("links#12: 5 passed, 1 failed (e2e)", each failed check linked) and your text, with
    no agent. A **job** runs the agent once with the whole thread and what happened; it changes
    something only when your words said "fix it", and merging stays yours (GitHub's own
    **Enable auto-merge** is your button where a repo allows it).
  - **When it doesn't:** at its end, or after three reads in a row that fail, it says so with no
    agent ("Stopped waiting at …: #405 is still open"), even for a job.
  - **The task's own PR:** for "merges" or "is deployed", your merge already starts the task's
    close run, which fires it after **Merged** (or an app's Live or failed), with no looks before;
    the task stays closed. Where no app deploys (Shipify itself), it's looked at from the merge on.
  - **Shipify's and projects' PRs run no checks before the merge** (ADR 0018): "when #12's checks
    finish" there says so at its first look, and "when it's deployed" is the one to ask.
  - One per task, as a time once: asking again replaces it, and a task that repeats takes none. It
    isn't skipped while the task's PR waits. `stop repeating` cancels it; a close by hand drops it,
    but a merge doesn't.
- **When it runs:** the watch looks every 5 minutes, so a run starts within 5 minutes of its time.
  The status task's "Coming up" lists every live repeat's next time, built in one place by each
  due run, so none drops off (one whose run is going, or one just started, included).
- **Due while its task is busy** (a run of your words going): it runs once the task is free.
  "Coming up" lists it at the time it's looked at again, 10 minutes on.
- **A reminder always fires,** even while words on its task wait unread: they wait for your
  `continue`, and the reminder isn't held up. A reminder also puts a task that failed back to
  repeating.
- **Changing one:** say it on the task ("make it 8am", "make it daily"). The agent is shown the
  task's repeat (when, kind and text) and sends the whole repeat back; the reply confirms it.
- **A check** is a reviewed script, `checks/<name>.mjs`, merged by PR: it prints the value to watch
  ([checks/README.md](../checks/README.md)). To watch something new:
  `shipify: a check that tells me when <x> changes` → its PR → merge →
  `repeat: every hour, check <name>`.
- **A PR waiting for you:** a repeat that comes due while its PR is open skips that time.

**Pausing and stopping:**
- **A repeating task stays open:** it's labelled `repeats`, which is how the due run finds it,
  and it never closes as quiet.
- **Three failures in a row** pause it, and the reply says so once. `resume` starts it again.
  A failure is a check whose script fails (it exits non-zero, runs for more than a minute, or isn't
  there), said as **Failed** with its cause, never as a change; or a job that fails, or whose result
  doesn't read. One that runs starts the count over.
- **`stop repeating`** ends it, closes the task and takes its `repeats` label off, so it leaves
  every list (closing alone only pauses it).
- **Closing the task** stops it too. Comment `resume` on it later, and it reopens and carries on.

## Carrying on and closing

- **To carry on:** comment on the task, or reply to the bot's message about it (or start a chat
  message with `#12`).
- **A question's answers:** a run that asks may give up to three short answers (`choices`). They're
  written under its question ("Answers: “Yes, match it” · “No, leave it”") for GitHub and Telegram,
  and the web chat shows them as buttons; any answer is just your words.
- **A lone thanks** (`ok`, `thanks`, 👍) answers a question waiting on you. After a PR to merge,
  a list for your `yes`, or an answer, it's a thanks: a 👍, and the agent isn't run.
- **Answered and quiet for a day:** the task closes by itself (never a repeat's): the due run
  closes it, with no run of its own (ADR 0040).
- **One run at a time, and one waiting:** words sent while a run works are read by it before it
  answers, or by the one run waiting after it; a newer run takes the waiting one's place (ADR 0040).
  A waiting run whose words the run before it already answered finds nothing new, and ends.
- **Your merge** of its PR closes it (the PR says `Closes shipify#12`), and its run says Live (or
  Merged): a task with a PR open says `needs you`, and a close of one starts its run. A PR you
  opened from the PC with `ship pr --task 12` counts the same when the task says `needs you`;
  otherwise the merge closes it quietly. It stays closed: nothing reopens it, and nothing follows
  its checks (ADR 0046). What happens next is yours to ask ([After your merge](#after-your-merge)).
- **GitHub's Close and Reopen buttons** start no run (ADR 0053), unless the task still says
  `needs you` (a PR, a question, a list) or `working` (a run under way): the next run reads the
  rest.
- **A new project or a release** closes once its deploy is Live in production (on staging it
  stays open for its release); an operation once it ran.
- **To drop it:** close it as **not planned** (or as a **duplicate**). Its open PRs are closed and their branches deleted.
- **A closed task comes back** when you write on it, from any chat (a minute or more after it
  closed): the run it starts reopens it first, so it's open and working while the agent reads your
  words, and the web chat says "Starting…" until then. A lone thanks leaves it closed, with a 👍.
  `reopen` alone opens it with no agent, ready for your next words.
- **An edit of the task's text** counts as new words.
- **Notebook pages and the status task** start nothing.

## Lanes: how much process a change gets

The agent picks the lane. When in doubt it takes the bigger one, and you can always say "treat this
as a feature".

| Lane | For example | You get | You do |
|---|---|---|---|
| **tweak** | a margin, a colour, a wording, a bug | one PR: the code, a patch bump | look, merge |
| **feature** | dark mode, a new filter | one PR: the change doc, the code, the spec, a minor bump | read the doc, look, merge |
| **big** | a database, sign-in, a new service | a doc PR first (a change doc, and an ADR when it's hard to undo) | merge it, then say `go`: the build comes as a second PR |

- **Why a feature is one PR:** the agent's time is cheap and your review isn't. One PR is one
  review.
- **A new app** is always big: its plan is the doc.
- **A doc PR's merge may close the task** (its PR said "Closes"). Its "Merged" reply says so:
  `go` on the closed task opens it again, and the build starts from `main`.
- **Apps with staging** get no version bump in PRs. Merging deploys staging; the Operate form's
  "Release to production" (or `<app>: release`) opens the release PR.

## PRs and Live

**A change:**
1. **The agent works in its own clone,** on the task's branch. When `main` has moved past it (a
   sibling task's PR merged first), the box brings it up to date with `ship refresh` first, as on
   the PC: main merged, both changelogs kept, a clashing change doc renumbered and the version
   bumped again on top of main's. A real conflict is left for the agent, with the files named. It
   commits and runs `make verify`.
2. **The box checks again,** as the agent's user, with the same checks `ship pr` makes in a
   terminal: first what the PR needs besides tests (`ship pr <clone> --check`: every change doc
   readable, the version bumped with its changelog section when merging ships one; for Shipify, a
   changelog line and stack versions), then `make verify`. When they fail, the agent gets one round,
   in the same session (up to 20 minutes), to fix what they found. If they still fail, no PR opens
   and the reply shows the end of their output. The agent's commits are kept on the task's branch, so `continue`
   carries on from them. Shipify itself keeps the same targets: on it, `make verify` checks what
   the change reaches, quickly (its `Makefile` says how).
   **Up to date when it finishes** (ADR 0059): after the agent, with a key minted then, the box
   fetches `main` again. When it moved while the agent worked, the box refreshes the branch as
   above and runs the checks again, so the PR opens up to date; the run's details say so. Where the
   refresh stops on a conflict, or the checks fail on the merged branch, the PR opens as the agent
   left it, and the details say your `continue` brings it up to date first.
   **Kept work, whatever stops a run** (ADR 0035): an agent that stops before its answer keeps its
   commits the same way, with any edits it hadn't committed as one `Work in progress` commit. That
   covers its 200-minute clock, your plan's limit, a crash, or an answer that doesn't read. The reply
   names the stop: "The agent stopped before it finished: it ran for 200 minutes", or "Your plan's
   5-hour limit is used up" with when it resets. Reply `continue` to carry on. Two exceptions,
   each said in the reply: never into an open PR (you might merge it), and never a new project's
   first push (it goes to `main`, which deploys).
   **A question mid-change keeps its work too** (ADR 0041): when the agent stops to ask you
   something, its commits wait on the task's branch the same way, and your answer's run carries on
   from them. Its reply reads as any question does; the same two exceptions apply, silently, and
   a push that fails (a workflow file among its edits, a key the scan finds, no write token) is in
   the run's log only, the question posted as before.
   **Its handoff:** the agent keeps a short note for the next run as it works (Goal, Done, Next,
   Decisions, Open), and the box keeps it in the status comment however the run ends, even when
   it's stopped. The next run reads it, then checks the branch and the tests before trusting it.
   A run after a stay ends starts a fresh agent session: it reads the whole thread, this handoff,
   the branch and the notebook, not the old session's working notes. Only a stay keeps the same
   session, in the run's folder.
   **Helpers:** an agent may work with helpers of its own (Claude Code does, in parallel). Every
   rule binds them, since the rules sit outside the agent: its own user, read-only keys, the box
   making every change. A checkout inside the clone (a helper's worktree) is never committed.
3. **Apply pushes and opens the PR** from the agent's commits, on `task/<n>-<words>`, after a scan
   for keys. Workflow files go only as `ship upgrade` renders them for the stack. Every PR reads the
   same way (ADR 0045): the repo's own PR template filled in, or Shipify's sections (what and why,
   Changes, Checked, Notes), then, below a line, the task it's for and what made it ("Made by
   Claude Code (Opus 5.5) with Shipify", with the run's link on Shipify's own account). Its commits
   carry the App's name (`<name>[bot]`), so GitHub shows them as Shipify's.
4. **You review and merge.** Comment to change it: the next run updates the same PR.
5. **Live:** the run your merge starts follows the deploy itself and replies as soon as the
   pipeline marks it, usually within a minute or two: "**Live:** acme-site at <link>" ("On staging"
   for an app with staging), or that it failed, or that it never showed up after 30 minutes (the
   deploy job stops itself at 25). Merges close together are covered: a commit whose own run GitHub
   dropped is live with the later deploy that holds it. A merge with nothing to deploy (Shipify
   itself, a package, a recipe) says "**Merged**". A staging release and a new project's first
   deploy have no event of their own: they're labelled `deploying` and followed by the watch's due
   runs.

**A preview** (`preview`) deploys a live copy of the PR and runs its checks. Nothing
follows them: look at the PR, and ask why they failed or to fix them (ADR 0046). A preview's link
is public. The box adds the
`preview` label after the PR is open (making it when the repo has none), then pushes an empty commit
so the pipeline's next run carries it; a label never stops a PR from opening.

**When a step fails, `continue` picks up:** a push that went through but whose PR didn't open gets
its PR on the next run, with no new commits needed; an approved call that failed can run again.
`start over` starts the new branch from `main`, never the old PR's commits.

**A new app:** `new: …` → a plan PR → your merge → its repo and keys are made on GitHub's machines
→ a box builds it → the first push → Live, and the task closes. Your merge starts it: a run that
stays on the task leaves for it, and if a newer run took its place in the queue, that run starts it
(once). If a key or permission was missing, the reply names it; fix it, then say `publish` (or
`go`), from GitHub or a chat. If its first build fails its checks, `continue`
builds it again in the new repo (the failed attempt isn't kept: a first push goes to `main`).

**Shipify itself:** `shipify: …` works the same way, as a PR to this repo checked by `pnpm verify`.

### After your merge

The task closes with the merge, and its one run says Live (or Merged, or that the deploy failed,
with its run). Then nothing happens by itself (ADR 0046): no run, no reopening, no checks followed,
unless you asked for an errand ([Repeats](#repeats)): "when it's deployed, check the login page" is
fired by that same run, or looked at from the merge on where no app deploys, and the task stays
closed.
The task keeps its whole thread, so anything you ask later starts from all of it. Ask on GitHub, in
Telegram or the web chat, the same way: reply to its message, or start with `#12`.

| After the merge | You | What happens |
|---|---|---|
| all good | nothing | it stays closed |
| a thanks | `thanks` or 👍 | a 👍; it stays closed |
| something's off, or needs changing | say what, on the task | it reopens as its run starts, and the agent carries on with the whole thread: a new PR on a new branch from the repo's default branch, never the merged one's commits again |
| undo it | "revert it" | the same: a new PR that reverts the change, for you to merge. An app's deploy can also go back at once with the Operate form's roll back |
| the deploy failed, or CI fails on the default branch | "why did it fail? fix it" | a run reads the run's log itself, says what failed and why, and fixes it in a new PR |
| be told when CI on `main` ends | "tell me when shipify's main checks finish" | an errand: told once, with no agent, when they've all ended |
| you want it open, to come back to | `reopen` | open again with no agent, waiting for your words; `close` closes it again |
| you wrote before the merge, and no run read it | nothing | the merge's reply says so; write again and the task carries on with it |

A PR that doesn't close the task (`Part of #12`) leaves it open; the task's next work also starts a
new branch, since a merge ends its branch.

## Files in and out

| You send | The agent gets | When it can't |
|---|---|---|
| words, markdown, code, tables | all of it, as written | — |
| an image pasted on GitHub, a Telegram photo | the image, to look at (the newest 10, 10 MB each) | larger ones are named and left out |
| a document from Telegram (PDF, `.md`, CSV, text, code) | the file | over 10 MB, or more than 5 a message: the rest are named |
| a photo or file from the web chat (any type: PDF, documents, a screenshot) | the file (photos shrunk to 2,048 px in your browser) | over 10 MB, or more than 5 a message: refused before it's sent |
| more chat files on one task than a run takes | the newest 5 | the older ones are named: ask for one again |
| a link to a file in your repos | the file, fetched before the agent starts (10 at most, 25 MB each) | — |
| a link to a page or a gist | the page, read from the web | a page it can't reach: said |
| a file attached on GitHub | nothing: GitHub serves private attachments only to a signed-in browser | said once: paste the text, or link the file |
| a voice note or a video | nothing: the agent reads words and pictures | said once: type it, or send a screenshot |

**What comes back:**
- **The reply** is GitHub markdown; its first paragraph stands alone. Telegram shows up to about
  3,500 characters, then "the rest is on GitHub".
- **Files the run made** (up to 10) go on shipify's private `shipify-files` branch: images show in
  the reply, other files are links. Telegram gets each as a photo or a document.
- **Anything that looks like a key** is masked before it's posted or sent.

## Run details

Every reply ends with a folded **Run details** block:
- the run's link, the box and the step times;
- the agent, its model and effort (marked Auto when they were);
- tokens, turns, the tools it called and any calls it was refused; the cost when the agent knows it;
- your plan's 5-hour and weekly use (Claude Code).

On Telegram it's one line: "Sonnet · 48 s · 3 tool calls". The status comment keeps a table of the
last 20 runs, quiet ones included. The run's Actions log shows each step as it happens.

## When something fails

**Every run ends in a reply, and nothing is tried again behind your back** (ADR 0042). A failure is
a `failed` reply that says what happened, with its real cause, and the one thing to do:
- **The agent's own words when it ends with an error:** "glm-5.3-flash at openrouter.ai answered:
  Upstream error from Nvidia: Service temporarily overloaded". An agent may try its model again on
  its own first (pi does); that's the agent's.
- **An answer that didn't fit the result's shape** names what was wrong, with the agent's words
  below it, where a chat shows them. The run stays (ADR 0061): your next words go to the same
  session, which can send it again. When the agent fixed its answer itself before it ended, the
  fixed one is taken, never the file it wrote first.
- **A run that broke before it could answer:** the job says so on the task with the task as it is
  now, naming the step that broke: one of Shipify's, with its error ("The run's plan step failed:
  …"), or one of the workflow's own ("The run's “A read-only token for plan…” step failed").
- **If it can't even do that** (GitHub down, the box restarted mid-run), the watch finds the task
  still working, or your words with no run, and marks it **Stopped** (the label `stuck`), alerting
  you once; nothing starts it again but your `continue`, which carries it on from where it got to
  (ADR 0040).

**The problems** (`cli/contracts/problems.ts`, one catalogue for replies, the CLI, the door and the
watch):

| Code | You see | You do |
|---|---|---|
| `box-offline` | no box is online | start it (`pnpm ship box start <box>`), or `pnpm ship box status` |
| `key-missing` | a tool's key isn't set | `pnpm ship add <tool>` |
| `key-refused` | a tool refused its key | `pnpm ship add <tool> --new --yes` |
| `tool-refused` | a tool refused a call, with its own words | change the request and say it again, or fix it in the tool |
| `verify-failed` | the box's checks (`ship pr --check`, `make verify`) failed, so no PR | `continue`, or say what to change |
| `agent-stopped` | the agent stopped before it finished (its clock, a crash, an answer that didn't read); its work is kept | `continue` |
| `agent-error` | the agent ended with its model's error, in its words ("… at openrouter.ai answered: …") | `continue`, or another model (`/use`) |
| `result-wrong` | the agent's answer didn't fit the result's shape, named, with its words below | `continue`, or another model (`/use`) |
| `plan-used-up` | your plan's limit is used up, and when it resets; the work is kept | `continue` after that time |
| `step-failed` | one of the run's steps broke, named with its error | `continue`; if it fails the same way, it's Shipify's: the run's log has the rest |
| `secret-in-change` | the change has something like a key, so it wasn't pushed | say how to remove it, then `continue` |
| `github-down` | a chat's message couldn't reach GitHub: nothing was saved | send it again in a minute |
| `github-unread` | GitHub couldn't be read just now (an instant answer, a thanks) | try again in a minute |
| `github-refused` | GitHub refused the door's write: nothing was saved | send it again, or write it on GitHub |
| `door-closed` | the door is closed (`SHIPIFY_DOOR`): nothing was saved | delete the variable, then send it again |
| `door-failed` | the door itself broke: nothing was saved | send it again; if it happens again, the edge's logs have the rest |
| `turn-failed` | a `close` or `reopen` GitHub didn't take: nothing was saved | send it again |
| `chat-refused` | the chat can't be reached (the bot blocked, the chat gone) | unblock or start the bot again, then `pnpm ship selftest chat` |
| `chat-rendering` | the chat refused a reply as Shipify made it: Shipify's bug, in the chat's own words | read the reply on GitHub |
| `files-unsent` | some of a reply's files didn't send to the chat | open them on the reply on GitHub |
| `stopped` | the task's run stopped before it finished | `continue` (it carries on from where it got to), or close it |
| `words-unanswered` | no run replied to your words (none started, or one broke before it could say so) | `continue` |
| `form-wrong` | a form has a wrong answer | edit the issue |
| `no-such-task` | a chat message names a task that doesn't exist | reply to one of the bot's messages, or use the right number |
| `no-such-project` | the work names no project | name one of the projects it lists |
| `approval-expired` | the `yes` came after the list stopped being good | ask again for a fresh list |
| `list-gone` | a list's Yes for a list that isn't waiting (made, dropped, expired, or an older one) | tap Yes under the newest list, or ask again |
| `list-too-long` | a chat's `yes` to a list too long to show whole there | comment `yes` on the task on GitHub |
| `too-big` | something is too big to keep | ask for less at a time |
| `door-key-refused` | GitHub refused the door App's key | a new key on the App's page, then `pnpm ship door setup --new --yes` |
| `key-expiring` | a key expires soon | what the alert says |
| `runner-old` | a box's runner is too old for GitHub | `pnpm ship box add <box> --manage --yes` |
| `reply-unsent` | a reply didn't reach the chat: the watch's one notice, with its link | open it on GitHub; `pnpm ship selftest chat` if it keeps happening |
| `unexpected` | anything else, with its first line | `continue`; the run's log has the rest |
