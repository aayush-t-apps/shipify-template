---
status: accepted (merged #234) and built (one PR, the owner's go on 2026-10-07: "ok lets go i merged lets build cover everything"). Built as written, with three small differences found while building: a no-op `close` or `reopen` writes nothing (the doc said a setting), the logo is a JPG (Telegram takes only JPG for a bot's photo), and a picker's gateway models show their ids (`glm-5.3-flash`, "· free"), not prettier names. An independent review of each half found bugs, all fixed in the build (nothing told twice, a refused pick never runs, no busy-repeat loop; Auto goes back to the default, picks build in order, a tap out of reach is told). Proposed from (the owner's asks of 2026-10-07, after GitHub's outage left two Telegram questions with no answer and no word: "make the flows robust, we can't have this breaking"; Telegram "very robust", with model picking "as easy as the web chat"; "think simply from my angle: I don't know what's there, I just want to use a model, build something or ask a question"; "a clickable link to the task"; "pin ongoing tasks"; "list tasks and continue in the same or a new one, configure at the start or in the middle"; then "if we keep it pinned, switching can become a nightmare: can I still ask in another thread with #n or /ask?"; "no retries or band-aids: if it fails, just tell me and I'll continue"; "the agent's own retries are fine; our harness causing issues and not reporting them is the bigger deal"; effort in the picker; a sweep of every channel and flow; one logo. Merging its PR accepts the design and its build plan)
date: 2026-10-07
amends: 0040 (words that wait are told, never started by the watch), 0030 and 0032 (Telegram: buttons, the reply box, a smaller menu), 0025 (one `use` grammar, where a model names its agent), 0027 (the channel contract: buttons that send words)
---

# 0042: A chat that guides you, and a harness that tells you

## The plan in short

You open Telegram knowing nothing about Shipify, models or formats, and you just type. Everything
else is a tap, and whatever goes wrong is said, once, where you are.

1. **Where you type decides the task, with no mode to remember.**
   - A fresh message is a new task. A reply continues the task you replied to (both as today).
   - When Shipify asks you something, or you ask to go to a task, Telegram's reply box opens on it
     for you, so you just type.
   - `/tasks` lists your tasks; one tap brings one back.
   - `/ask` always starts a new one, wherever you are.
2. **Buttons are words you could type, sent for you.** They cover the model picker, an agent's
   quick answers, **Continue** and **Another model** after a failure, and **Stop repeating** under a
   reminder. A tap goes through the same door as typing, so it can do nothing your words can't.
3. **Picking a model is two taps, with plain names, and Claude's effort one more.**
   - `/use` shows them, with ✓ on the current pick.
   - One `use` grammar is shared by the door and the box.
   - A model names its agent, so `use sonnet` works from any task (#233 ignored it without a word).
4. **The harness tells you every failure, once, with its real cause, and retries nothing.**
   - GitHub down: "Couldn't reach GitHub: nothing saved. Send it again."
   - A run breaks: one Failed reply with **Continue**.
   - A reply that didn't reach you: one notice with its link.
   - The watch never starts a run by itself again.
   - An agent's own retries (pi's) stay: that's the agent's business. What it ends with is told
     in its own words.
5. **Delivery that's honest:**
   - 🚀 only once the words reached every chat they were for;
   - files keep their type, and a file that didn't send is named;
   - a reply is never lost to formatting.
6. **Repeats that keep their time:** the "Coming up" list is built from every repeat in one place,
   a reminder always fires, and the agent sees a repeat's settings when you ask to change it.
7. **Small things:**
   - "Got it · **#240**" links to the task, as every message's task number does;
   - one menu of four: `/ask`, `/tasks`, `/use`, `/help`;
   - the sailboat logo on the bot and the Apps;
   - the clean-up the sweep found.

**Nothing new:**
- **No new parts:** no store, no service, no key, no pinned state.
- **No unasked runs:** nothing runs unless your words ask.
- **GitHub stays the record**, and approvals stay on GitHub.

One PR builds all of it after this one merges.

## Everything you asked, and where it's answered

| You asked | Answer | Here |
|---|---|---|
| Why did Telegram and GitHub go quiet? Did GitHub break? | Yes. GitHub's incident ran 15:06–16:25 UTC; a minute of 500s followed at 16:52. Our harness then failed to tell you | What happened |
| Did we hit limits? How are the Worker and the rest doing? | No limit was near: the Worker was at 4% with 0 errors. The nearest is Actions minutes, at 32% of the month | Limits and cost |
| Idle costs nothing? | Nothing: only the edge's free 5-minute check runs | Limits and cost |
| Was #232 the model gateway? | No. The model answered in 20 s; our check of its result file marked it Failed and dropped its words | §4 |
| Can a repeat answer, or change itself? | Answer, yes. Change, yes, through the agent, which isn't shown the repeat's current settings today. Stop, yes, with fixed words | §6 |
| Robust flows, with no band-aids or retries | Failures told once, with their cause; nothing retried by our code; the watch starts nothing | §4 |
| The agent's own retries? | They stay. What the agent ends with is reported in its own words | §4 |
| Telegram very robust; model picking like the web chat | Buttons that send words; the `/use` picker; one grammar | §2, §3 |
| Effort in the picker | Claude's, in its own row. pi stays on Auto | §3 |
| Research how other agents do it | ChatGPT, Claude, OpenClaw, Hermes, Claude Code, Cursor, Devin, Copilot, father-bot | Patterns borrowed |
| A clickable link in "Got it" | Every message's task number is a link | §1 |
| Pin ongoing tasks? Switching could become a nightmare | No pin: a pinned "current task" is a mode, and a mode sends words to the wrong task. `/tasks` lists them, and the reply box shows where you're typing | §1, Why not a pin |
| Ask in another thread with `#n` or `/ask` | `#240 …` goes to #240 once; `/ask …` is always a new task; a fresh message is always a new task | §1 |
| List tasks, continue in the same or a new one, configure at the start or midway | `/tasks`, a reply, a fresh message, `/use` | §1, §3 |
| Idiot-proof, from my angle | The walkthrough, and edge cases for every step | §1, Edge cases |
| A sweep of channels and flows | 16 findings, all addressed | §4, §5, §8 |
| Clean up leftovers | Done where allowed; the rest is in Clean-up | §8 |
| A logo | The web chat's sailboat, everywhere | §7 |
| #233: `use sonnet` ignored, then failed | Two root causes, both fixed | §3, §4 |

## What happened on 2026-10-07

| UTC | What | Why you heard nothing |
|---|---|---|
| 15:06–16:25 | GitHub's incident: "Git Operations, Pull Requests and Actions". Webhooks and Actions were down, and no run started | — |
| 16:52–16:54 | #230's and #231's runs got HTTP 500 four times from GitHub's token service (`create-github-app-token`) | The failure note goes through GitHub too, which still answered 500: no reply, no Telegram message. For #231 it also read the *previous* run's saved plan (`run.ts:425`), and a failed write threw before the task's status was saved (`apply.ts:326`), so `working` stayed |
| 17:05 | The watch's tick: #231's words had waited 10 minutes, so it started a run itself (answered 17:07). #230 had started, so it was marked Stopped, and you were told | Two different outcomes for the same thing: words no agent ever read |
| 17:04 | #232 answered by pi on glm-5.3-flash in 20 s, posted as **Failed** | The answer was dropped: an all-or-nothing check of `result.json` (`result.ts:62`), or the model marking itself failed. Either way its words should have been kept |
| 17:15–17:32 | #233: `use sonnet`, in a message on a pi task, was ignored without a word (`agents.ts:297`, `decide.ts:328`). Free nemotron answered "Upstream error from Nvidia: Service temporarily overloaded" for minutes | The reply said only "its answer didn't read": the harness had the real cause in pi's log and didn't pass it on |

None of this was a limit. GitHub broke; our harness then failed **without telling you**, and that
is the part to fix.

## The rules this follows

1. **Every message you send gets one outcome where you sent it: an answer, or a failure saying what
   broke and what to tap.** Never silence, never a guess.
2. **Our code retries nothing.** A failure is told once. You decide to continue, try again or pick
   another model. What isn't ours stays as it is: GitHub's token action tries 4 times in about
   17 s, and an agent retries its own model calls.
3. **Nothing runs unless your words ask.** A tap is your words. A pick is a setting and never
   starts a run. The watch tells you things; it never starts a run.
4. **One definition of each word.** The door and the box read `use`, the fixed words and the
   commands from the same file. A button sends exactly those words.
5. **Where you type decides the task: no mode, no new state.** The same holds in every channel: a
   GitHub issue, the web chat's open thread, a Telegram reply. A stray message can only ever start
   a harmless new task. It can never land inside a build by mistake.

## 1. Using it from Telegram: the guided flow

You never need to know a word. These are the screens, in order.

**First open.** Telegram sends `/start` itself. The bot answers:

> Send me anything: a question, an app idea, a change to an app. Each message starts a task, and
> I answer it here. To carry one on, reply to any of its messages.
> **[Model]** **[My tasks]** **[Help]**

**You type** "make me a tip calculator". It's a new task:

> Got it · **#240** ← a link to the task on GitHub

**The answer** comes back as a reply to your message, headed `Done · #240 · …`. It ends with the
model that answered.

**You carry on.** Swipe to reply on any #240 message: "make it blue". That goes to #240. A
message that isn't a reply starts a new task, so a quick question never lands inside your build.

**When Shipify asks you something**, the reply box opens on the question for you. The question's
quick answers are buttons, so you tap one or just type:

> Needs you · **#240** · Which colours: the app's teal or your own?
> **[Teal]** **[My own]**
> ✏️ *Reply to #240…* ← the reply box, already on it

**Back to an older task:** **[My tasks]** (or `/tasks`) lists your open tasks as buttons, grouped as
**Working**, **Needs you**, **Repeating** (with its next time) and **Answered**. Tap #231, and the
bot posts its header with the reply box open on it, so you just type:

> **#231** · what other repeats are live · Answered · Sonnet
> ✏️ *Reply to #231…*

**A quick question while you're building:** type it fresh, or `/ask …` (which is always new, even
inside the reply box). It becomes #241. #240 is untouched.

**A failure:**

> **Failed** · **#240** · nemotron is busy at OpenRouter ("Service temporarily overloaded").
> **[Continue]** **[Another model]**

**A reminder** never opens the reply box:

> Reminder · **#230** · take vitamin D
> **[Stop repeating]**

**A PR to approve:** a link button, **[Open the PR]**. You merge on GitHub, as always.

### Where a message goes

| You send | It goes to |
|---|---|
| A fresh message | A new task |
| A reply to any bot message (or the reply box Shipify opened) | That message's task |
| `#240 more words` | #240, once |
| `#240` alone | Nothing written: the bot posts #240's header with the reply box on it |
| `/ask …`, `/new …`, `/change …`, `/repeat …` | Always a new task, even as a reply: a command never continues one |
| `remember: …` | The notebook, at once, as today. No task |
| `/tasks`, `/use`, `/help`, `/models`, `/apps`, `/ping`, `/notebook`, `/recipes` | Answered at once, nothing written. `/use` as a reply is about that reply's task |

The reply box opens by itself (Telegram's `force_reply`, with "Reply to #240…" in the box) only in
three cases:
- the agent asked you a question;
- you asked to go to a task (`/tasks`, or `#240` alone);
- you picked a model for a new task (§3).

It never opens for an answer, a "Got it", a reminder or an alert. A message with buttons doesn't
need it, because a tap already replies.

### Why not a pin

A pinned "current task" sends every plain message to one task until you switch. That's a mode, and
a mode fails the moment you forget it: a quick question lands inside a build, and its agent changes
code for it. Each switch would also post a "pinned" line, and each message would cost one more
Telegram call to read the pin.

With replies, nothing is hidden. Telegram shows "Replying to #240" above your keyboard, exactly
where you type, and a fresh message is always new. The web chat (its open thread) and GitHub (the
issue page) already work this way.

**Telegram's topics** (a thread per task in a bot chat, since 2025) would be the neatest look, but
they're young:
- a Bot API update on 2026-05-08 broke every bot's replies into private-chat topics
  ([telegram-bot-api #847](https://github.com/tdlib/telegram-bot-api/issues/847));
- they need a BotFather setting and current apps.

They're left for later, as an option that changes nothing else (a task is a topic).

## 2. Buttons are words

A button is a label plus the exact words it sends. The door reads a tap as those words, written as
a reply to the message the button sits on. That's how a reply already finds its task, so
everything that holds for typed words holds for a tap:
- the person check;
- one write per update (`update_id`);
- a `use` is a setting and starts no run;
- `yes` is refused outside GitHub.

| Button | Sends | Where |
|---|---|---|
| Model | `/use` | `/start` |
| My tasks | `/tasks` | `/start` |
| Help | `/help` | `/start` |
| A task in `/tasks` | `#231` | `/tasks` |
| A model in the picker | `use sonnet`, `use glm-5.3-flash`, `use auto` | `/use` |
| An effort in the picker (Claude) | `use sonnet high`, `use claude max` | `/use` |
| An agent's quick answer | Its words (at most 60 characters, the result's own limit) | A reply with a question |
| Continue | `continue` | A Failed or Stopped reply |
| Another model | `/use` | A Failed reply |
| Stop repeating | `stop repeating` | A reminder |

After a tap, Telegram shows a short toast ("#240: from your next message, Sonnet"). The message's
buttons are edited to show ✓, or removed if they're spent, so the same button can't be tapped twice
by mistake.

Every channel shows the same buttons from the same list:
- **Telegram:** inline buttons.
- **The web chat:** its own buttons. Today it keeps its own copy of the words (`web/words.ts`);
  after this it reads the shared list.
- **GitHub:** keeps the words as text ("Answers: “a” · “b”"), because it has no buttons.

## 3. Picking a model

**`/use` with nothing after it** shows the pick of the task you're replying to (or "New task" if
you aren't), then a button for every model in `executors.json`'s short list:

> **#240** uses **Auto** (Claude · Sonnet · medium)
> **[Auto ✓]** **[Opus]** **[Sonnet]** **[Haiku]** **[Fable]**
> **[GLM 5.3 Flash]** **[Kimi K2.7 Code]** **[Nemotron · free]** **[Laguna · free]** …
> Effort: **[Auto ✓]** **[Low]** **[Medium]** **[High]** **[Extra high]** **[Max]**

- Plain names, with "free" on free ones. One screen; the list is short by design, so it needs no
  pages.
- **In a task (midway):** reply `/use` to any of its messages, or tap **[Another model]** on a
  failure. A tap sets that task's pick from your next message and starts no run. The picker's
  header updates: "#240 · Sonnet · High".
- **Before a task (at the start):** `/use` as a fresh message, then a tap. The bot asks "New task
  with Opus: what should it do?" with the reply box open. Your reply starts the task with that
  pick, as the web chat's chip does today. The pick lives in that message, so nothing is stored.
- **A fresh message with no pick** uses Auto: the default in `executors.json`, which changes only
  by a PR. A `use …` line in the message still picks for it, as today.
- **Effort, for Claude.** While the pick is on Claude, the picker's last row is its effort. Auto is
  Claude's own (`medium` today, from `executors.json`).
  - A tap sends the whole pick, such as `use sonnet high` (or `use claude high` on Auto), so an old
    button always means exactly what it says.
- **pi's models stay on Auto effort in the picker** (`low`): many gateway models ignore an effort,
  the free ones most of all.
  - Typing `use pi z-ai/glm-5.3 high` still works.
  - The web chat keeps offering an effort wherever the gateway says the model takes one, as it does
    today (`compose.js:582`).
- **`/use <words>`** is the same as typing `use <words>`.
- **`/models <word>`** stays the search over the gateway's whole catalogue (`/models kimi`), and its
  results get the same buttons.

**One grammar** (`cli/contracts/`, read by the door and the box alike):
- `use <agent> <model> <effort>`, each part optional.
- **A model names its agent:** `sonnet` is Claude's, `glm-5.3-flash` is pi's (the part after the
  gateway's `z-ai/`).
- A test holds every listed model name unique across agents, and every picker button within
  Telegram's 64 bytes.
- `auto` resets.

**A pick that can't be used is told, never dropped:**
- **In a chat:** the door answers at once ("“use xyz” names no model: [Model]") and writes nothing.
- **On GitHub** (no door): the run's reply says so and runs no agent. Nothing runs with a model you
  didn't choose.

Today the door and the box disagree (`answers.ts` `pickSaid` against `agents.ts` `parseUse`). That
is why #233's `use sonnet` passed the door and was dropped by the box.

## 4. The harness tells you, and retries nothing

| Where it breaks | Today | After |
|---|---|---|
| Your message, with GitHub down or the door's key refused | 503: Telegram resends it silently and holds every later message behind it | The door answers at once, in plain words with the fix ("Couldn't reach GitHub: nothing saved. Send it again."), and writes nothing. The web chat says the same words |
| A run can't get its key, or breaks before it answers | The failure note: it reads the *last* run's plan; a failed write skips saving the status | The note reads the task fresh and always saves the status (labels right, `working` cleared). Told in your chat with **[Continue]** |
| The note itself can't reach GitHub | The watch, at its next tick after GitHub is back: Stopped if a run had started, or **it starts a run** if not | The watch, the same tick, in both cases: Stopped, and one notice in your chat ("#231 wasn't answered: GitHub failed. [Continue]"). It never starts a run (amends ADR 0040 §4) |
| The agent's result file has a slip (a 61-character quick answer, a wrong field) | Failed: "its result has the wrong shape", and the agent's words are lost | Failed, naming the field, with the agent's words kept below it. You tap **[Continue]** or **[Another model]** |
| The agent ends with an error (a model overloaded, a quota) | "its answer didn't read" | Its own last error, in its words: "nemotron is busy at OpenRouter (Service temporarily overloaded)". pi's own retries before that are untouched |
| Telegram didn't take a reply (down, busy, 8 s with no answer) | The watch resends it every tick for an hour, so you get duplicates, or silence after the hour | The watch, next tick: one short notice ("#231 has a reply you didn't get here · [open]"). If that fails too: 😕 on the reply and an alert on the status task. Nothing sent twice |
| Telegram refuses a format (a 400) | Lost forever, with 😕 and "Unblock the bot" | Never made: a heading carries no formatting inside it (`telegram.ts:239`). If Telegram still refuses, the notice says it's our bug, in Telegram's own words |
| A file that didn't send | Nothing said | "2 files didn't send · on GitHub" |
| A close that failed; a read that failed on your "ok" | "Got it"; 👍 | "Couldn't close #231: GitHub failed. Send it again." |
| The door's key is refused | An alert every 6 hours from each Worker copy | One alert, marked on the status task |
| A stranger writes while settings can't be read | Told about the door key | Told nothing until the sender is known (a security fix) |

That leaves two automatic things in the whole system, both outside our code: GitHub's token action
tries 4 times in about 17 s, and an agent retries its own model calls. Everything else that
happens by itself is a schedule you set (a repeat, a due run, the weekly clean-up) and says so
(ADR 0040).

## 5. Delivery that's honest

- **🚀 means "it reached every chat it was for".**
  - The web chat reads replies in place, so its "sent" no longer counts; today it earns the 🚀 even
    when Telegram missed a reminder (`door-out.ts:123`).
  - The 🚀 is set right after the words go, before any files. Today it comes after uploads of up to
    30 s each, which the run's 30 s call can outlast, so a sent reply looks unsent and is sent
    again.
- **Files keep their type** (`cli/kernel/door.ts:61` sends untyped), so a picture shows as a
  picture in Telegram and in the web chat.
- **A reply's file list is either written or gone.** `ReplyLine.files` is always empty today
  (`apply.ts:267`), so the paths that read it are dead and are removed.
- **Only "blocked" or "chat gone" means a chat can't be reached.** Any other 400 is our bug, and is
  said as one.

## 6. Repeats

- **"Coming up" is built in one place from every repeat's own next time.** That means every repeat,
  including one whose run is going and one the due run just started. Today several writers replace
  the whole list and only some add their row back (`due.ts:117,126`, `commands/watch.ts:85`). A job
  repeat can drop off, so an hourly job may run daily.
- **A reminder always fires**, needing no agent, even when words wait unread. They wait for your
  **[Continue]**. Today unread words take the reminder's place (`decide.ts:530`).
- **A reminder clears a `failed` label**, and its task goes back to Repeating.
- **The agent is shown the task's repeat** (when, kind, text) when you ask to change it, and told to
  send the whole `repeat` back. A test covers changing one.
- **Clear wording:**
  - a check is called a check (`repeat.ts:252`);
  - times name their zone: "Sunday 14:00 IST".
- **`/tasks` shows every repeat**, with its next time, so "what repeats are live?" is one tap.

## 7. One logo

The web chat's sailboat (`edge/public/admin/chat/icon.svg`) becomes Shipify's one mark. A
512-pixel PNG of it is kept beside the SVG.
- **Telegram:** `pnpm ship add telegram --yes` sets the bot's photo (`setMyProfilePhoto`, Bot API
  since February 2026) with its menu and description.
- **The door App and the bot App:** GitHub has no API for an App's logo, so `docs/setup.md` gives
  the one upload step, done once.

## 8. Clean-up (from the sweep)

- **The fixed words** are defined in five places (`kernel/words.ts`, `web/words.ts`, `chat.ts`,
  intents.json's `replies`, the help text). After this they live in one file in `cli/contracts/`,
  and the others are made from it.
- **Copied helpers become shared ones in `edge/src/env.ts`:**
  - `same` (twice);
  - the web chat's sign-in proof (three times);
  - the store helpers (twice);
  - "Couldn't read GitHub" (in the edge and the kernel).
- **Dead code goes:**
  - the web key check that can't fire (`door-out.ts:218`);
  - the unused answer path (`door-in.ts:120`);
  - a misplaced comment.
- **Wrong words:**
  - the web chat says "GitHub didn't answer" when the door's key is refused;
  - its fix names a selftest that checks nothing.
- **`ship selftest chat` checks every channel**, not only Telegram (`edge/setup/chat.ts:29`).
- **Docs that are wrong today:**
  - door.md's page sizes ("66 KB"; it's 108 KB, 35 KB gzipped);
  - door.md says files go "as photos" and "as GitHub links";
  - the glossary says every channel can do the same, which isn't true yet.
- **`close` on a closed task, or `reopen` on an open one,** answers "Already closed" and writes a
  setting. Today it starts a run.
- **`#12 ok` is read as a reply's `ok`.**
- **Done already today:** the empty `t-apps/.worktrees` folder was removed.
- **Left for the owner:**
  - four merged or replaced remote branches (`adr/0039-chat-redesign`, `fix/chat-breakages`,
    `fix/no-background-runs`, `task/212-…`): the permission check stops an agent deleting them;
  - `t-apps/shipify-design-notes-2026-10-04.md`.

## Edge cases

| Case | What happens |
|---|---|
| You send a question in two quick messages (no reply) | Two tasks, as today: each fresh message is new. Each "Got it" says its number, so it shows. Writing it as one message, or replying the second to the first's "Got it", keeps it one |
| You meant to continue #240 but sent a fresh message | It becomes #241, a harmless new task, never words inside #240's build. Say `#240 …` or reply, and close #241 if you like |
| You're in the reply box Shipify opened but want something new | `/ask …` (always new), or tap ✕ on the reply bar and type |
| Two tasks answer at once | Each answer is a reply to its own message, headed with its number. The reply box opens only on a question, never on an answer |
| An old task's question arrives while you're typing for another | The reply box moves to that question. Telegram shows which task it's on above your keyboard, so you see it before you send |
| A reply to a closed task | It reopens, as today. A fresh message never reopens anything |
| A reply to a message whose task is gone (deleted, moved, a PR, the status task) | Told why, nothing written |
| You write while a task's run is working | Taken in by that run or the one waiting (ADR 0037, 0040), as today |
| A tap on an old message, days later | Its words still work. A model that's gone from `executors.json` is told: "no longer offered · [Model]" |
| An effort button tapped after the task moved to pi | Its words name the Claude pick in full (`use sonnet high`), so the task goes back to exactly that, as the button says |
| An effort a model doesn't take (`use haiku max`, if Haiku stops taking it) | The one grammar refuses it, and you're told with **[Model]**. Nothing runs with something you didn't choose |
| The same button tapped twice | After the first tap its buttons are edited (✓ or removed). A second tap that got through is a second ask, read with the first by one run (ADR 0040) |
| A quick answer longer than 64 bytes (non-Latin text) | No button; it stays as text to type. The result's 60-character limit keeps most within it |
| "New task with Opus" asked, and you send a fresh message instead | A new task on Auto: only a reply carries the pick. The question stays there to reply to |
| GitHub is down when you write | Told at once, nothing saved; you send it again when it's back |
| GitHub is down when a run ends | The note waits for GitHub; the watch tells you when GitHub's back |
| Telegram is down when a reply comes | One notice next tick. If that fails, 😕 and the status task. The reply is on GitHub and in the web chat |
| A free model is overloaded | The agent tries again its own way, then fails with its words, told with **[Another model]** |
| An album of photos | One task, as today: its updates share a group id |
| The web chat and Telegram at once | Each keeps its own place: the open thread in the web chat, replies in Telegram. Tasks are shared |
| You're on GitHub | The issue is the task. `/tasks` and `/use` work as typed words, answered by a run. A new task there is a new issue |
| A `use` on GitHub naming no model | The run says so and runs no agent |
| The bot's menu after intents.json changes | Kept in step by the watch's daily menu check, as today |

## What it never does

- Starts a run you didn't ask for: not the watch, not a tap on a setting, not a pick.
- Retries anything in our code, or hides a failure.
- Stores anything new. Tasks, picks and settings live on GitHub; a pick for a new task lives in the
  message that asks for it.
- Sends a message to a task you didn't reply to or name.
- Approves from a chat. Approvals stay on GitHub, the one deliberate difference.
- Touches your apps, the boxes' setup, the pipeline or any key.

## Every channel, after this

| | GitHub | Telegram | Web chat |
|---|---|---|---|
| Continue a task | comment on its issue | reply to any of its messages | its open thread |
| New task | a new issue | a fresh message, or `/ask` | New |
| List and go back | the issue list | `/tasks` | the list |
| Model | `use …` | `/use`, buttons | the chip, buttons |
| Effort | `use … high` | Claude's row; typing for pi | the chip, wherever the model takes one |
| Quick answers | typed | buttons | buttons |
| Continue, Stop repeating | typed | buttons | buttons |
| Repeats | the `repeats` label | `/tasks` (Repeating) | the Repeats page |
| A failure | the Failed reply | the same, with buttons | the same, with buttons |
| Approvals | yes | no (by design) | no (by design) |

## Limits and cost

| | Today (peak day, last 7 days) | Free limit | After this |
|---|---|---|---|
| Worker requests | about 3,100 a day | 100,000 | One per tap. A tap is a message you'd have typed |
| Telegram calls | 1 per answer | about 1 a second per chat | **The same per message:** the reply box rides on a message already sent. **A tap:** +2 (toast, edit) |
| Subrequests per Worker call | 9–13 at the busiest | 50 | Unchanged |
| KV reads and writes | 169 and 16 a day | 100,000 and 1,000 | Unchanged: nothing new is stored |
| GitHub reads | as today | 5,000 an hour (the App) | `/tasks` is one search, the one the web chat's list already makes |
| Box runs | as you ask, plus the watch's 10-minute starts | — | Fewer: the watch starts none |
| Actions minutes | about 640 of 2,000 this month (CI on merges) | 2,000 a month | Unchanged |
| Idle | the edge's 5-minute check, free | — | Unchanged |

## Patterns borrowed, and what's left out

**Borrowed:**
- **A reply is the thread:** Slack's and Discord's threads, and Telegram's own replies. Where you
  type decides where it goes, as in a GitHub issue and the web chat's open thread.
- **The reply box for a bot's question:** Telegram's `force_reply`, made for a bot that asks
  something, with a placeholder naming where you're typing.
- **A list to go back to:** ChatGPT and Claude's history, Claude Code's `/resume`.
- **One command for the model:** with no words it shows the current pick and a picker; with a name
  it sets it (Claude Code, OpenClaw, Hermes).
- **Effort as its own small choice beside the model:** Claude Code's `/effort`, Codex choosing model
  and effort together, Hermes's `/reasoning`, OpenClaw's `/think`.
- **A short list first, the whole catalogue only by search** (pi's scoped models, opencode's
  favourites, Copilot's short list with Auto).
- **✓ on the current choice, and the message edited after a tap** (father-bot/chatgpt_telegram_bot).
- **Buttons as typed words** (OpenClaw passes button values on as text).
- **Inline buttons for settings, `/start` and `/help`** (Telegram's own guidance).

**Left out, and why:**
- **A pinned current task:** a mode (see "Why not a pin").
- **Telegram topics:** young, and broken for every bot in May 2026. Later, as an option.
- **A Telegram Mini App:** Google's sign-in is blocked inside Telegram's view, and it would be a
  second way in.
- **Inline mode** (`@bot …`): Telegram puts the bot's name before the text.
- **A typing indicator:** it lasts 5 s, and runs take minutes.
- **A stored "last pick" per person:** it would be the only new state. A pick goes on the task, or
  in the message that starts one.
- **Pages of models:** the short list fits one screen.
- **Retries in our code:** rule 2.

## The parts it touches

| Kind | Contract | What changes | Its test |
|---|---|---|---|
| channel | `edge/src/channels/channel.ts` | An outgoing message carries `buttons` (a label plus the words it sends) and `asks` (open the reply box on it, where the channel has one). A tap arrives as a message with those words, replying to the button's message. The core names no channel | Channel conformance: a tap reads as the same words typed, every button fits its channel, and each adapter is tested alone |
| words | `cli/contracts/` | The fixed words, `use` and the commands, in one file the door and the box both read | A contract test: every listed model unique, every pick and effort button within 64 bytes, every effort button one the agent takes, the help made from the list |
| agent | `cli/lib/plugins/agent.ts` | None. Its last error reaches the reply (`AgentReport.error`, which the adapters already report) | Agent conformance, unchanged |
| record, tool, stack, check, recipe | — | None | — |

## Docs it touches

- `docs/channels.md`: replies as the thread, the reply box, buttons, the menu, the guided flow.
- `docs/door.md`: what the door answers when GitHub is down, the 🚀's meaning, sizes and files
  corrected.
- `docs/watch.md`: notices instead of starts.
- `docs/tasks.md` and `playbooks/task.md`: one `use` grammar, repeats, and what a failure says.
- `docs/agents.md`: model names, effort, and the agent's own retries.
- `docs/glossary.md`: **button** (words you could type, sent for you); the parity line made true.
- `docs/setup.md`: the Telegram step again, and the App logo upload.
- `intents.json`'s help text, made from the one list.
- `README.md`'s chat section.
- ADR 0040: amended (§4).
- The ADR index, and `CHANGELOG.md`.

## Setup

- **One command, once:** `pnpm ship add telegram --yes`. It shows its plan first, then sets the
  bot's updates (messages and taps), its menu of four, its description and its photo.
- **The check:** `pnpm ship selftest chat` checks each of those and names the fix for any one that's
  off.
- **The two GitHub Apps' logo:** one upload each, from the steps in `docs/setup.md`. No check can
  see it, and the doc says so.

## Build plan

**One PR, all of it.** Its commits go in this order, so each one can be read and tested alone.

**First, the core (§4, §5, §6, §8).** No new part.
- The failure note and its fresh read.
- The status always saved.
- Results kept with their words.
- The agent's last error in the reply.
- The door answering at once.
- The watch's notices (its `run` label removed).
- The 🚀, files, 400s.
- One grammar file.
- Repeats.
- The clean-up.

**Then, Telegram (§1, §2, §3, §7).**
- Buttons and taps, and the reply box on questions and go-backs.
- `/ask` always new; `#240` alone to go back.
- `/tasks`, `/use` with Claude's effort, the menu of four.
- Linked task numbers, the logo.
- The web chat reading the shared buttons.

**Each step's definition of done:**
- **Clean:** no leftovers or dead code, and the words match the glossary.
- **Well tested:**
  - unit tests, plus every case above that code can hold;
  - the channel and agent conformance tests, then the flow tests against the fakes, including
    GitHub answering 500 to the failure note, a stale plan file, and a tap;
  - live tests with the selftest.
- **Properly handled:** every failure is a problem that names its fix, and nothing is silent.
- **Configured:** setup is one guided command, with a check in selftest and doctor.
- **Finished:** `pnpm verify` and `pnpm test:golden` pass before the PR; the docs above are updated
  in the same PR; the CHANGELOG has an entry.

## Live checks (after merge, with your go)

From Telegram:
- `/start`: the welcome and buttons.
- A question: "Got it · #n" linked, then the answer.
- A reply to carry it on.
- A fresh message: a new task.
- `/ask` from inside an open reply box: a new task.
- `/tasks`, then tap back: the reply box opens on it.
- `/use`, then tap Sonnet, then High: no run, and the header says "Sonnet · High".
- `/use` fresh, then Opus: "New task with Opus", and the reply starts it.
- A quick answer tapped.
- A reminder's **[Stop repeating]**.

From the web chat: the same buttons.

On GitHub:
- `use sonnet` on a pi task.
- `use xyz`: told, no agent.

GitHub being down can't be made on purpose. It's held by the flow tests: a fake GitHub that
answers 500 and an empty body, as on 2026-10-07.

## Left for later

- Telegram topics, a thread per task, once they're settled: an option for the Telegram adapter
  alone.
- A model list you curate from the chat.
- Steps for big work, and `from #n` (ADR 0041's left-for-later).

## Amended (2026-10-07, after it went live): your model

The owner, using it: picking a model for a new task ("New task with Opus: what should it do?",
then a reply) "doesn't feel connected to a task". The owner chose **your model**, as a chat app's
model menu works, and an agent's own Auto beside Claude's:

- **Your model** is the pick your new tasks start with: `/use` sent fresh (or the Model button), a
  tap, and it's kept, with nothing to answer. Each new task gets it as a `use` line before your
  words (as the web chat's chip puts one), and "Got it · #241 · Opus" names it. A task keeps its
  own: `/use` as a reply changes that task only; a `use` line in your words wins for that task.
- **One small record per chat** at the edge (`model:<channel>:<chat>`, in the store the web chat's
  files use): the one exception to "no stored pick" above. A store that doesn't answer is said
  ("your model couldn't be read, so Auto"); one it can't keep is said, and nothing changes.
- **Gone:** the "New task with X" step, the pick read from a replied message's head, and the
  channel contract's `replyBox`.
- **The picker** shows each agent in its own rows with its Auto first (Claude · Auto, then
  Pi · Auto), then Claude's effort.
- **The texts** (the bot's About line, its description, /start, /help) rewritten plain for the
  menu of four.
- **Repeats, from the same review:** "When" is picked in the web chat (Daily, Weekdays, Weekly,
  Monthly, Every few hours, or your own words); every repeat runs in the owner's zone and every
  chat says it ("14:00 IST"); `stop repeating` takes the `repeats` label off, so a stopped repeat
  leaves every list; paused repeats and recipes fold under the running ones.

