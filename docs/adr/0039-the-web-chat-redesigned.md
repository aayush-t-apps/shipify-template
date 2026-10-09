---
status: accepted and built (one PR, with #207's fixes; see "As built"). From the owner's review of the web chat on 2026-10-07, after #206 went live: "this is so bad … the UI is broken … I need a better, cleaner, robust redesign with proper elements; simple things should stand out; config should work cleanly; don't make AI runs for unnecessary changes"; then "show cost and such, calculated, within our limits; be creative, don't complicate it, a helpful view; go big". The breakages themselves are fixed first, in #207. Merging this PR accepts the design and its build plan.
date: 2026-10-07
amends: 0036 (the web chat's layout, the model menu and Setup), 0038 (how a model is picked in the web chat)
---

# 0039: The web chat, redesigned

## The plan in short

**What:** the same web chat at `/admin/chat` and the same data, laid out so that each job has one
place and what needs you stands out:

- **On a PC, three panes:** your tasks; the thread; and the task's **info**, which you can hide.
- **On a phone:** tabs at the foot (Tasks, Repeats, Notebook, Setup), a thread with a one-line
  header, and sheets that rise from the bottom for the info and the model.
- **One model picker** for every agent: the agents as tabs, then a search, then the models, each
  with its maker, price, context and what it can do, then the effort.
- **Facts from data we already have:** a task's runs, time, tokens and cost, added up from its
  replies.
- **Status & setup as a page you can read in seconds:** a summary across the top, agents and
  models as a table, keys with the days left.

**The mockup:** [Shipify chat redesign](https://claude.ai/artifact/4VWUDbK31PZ7HG2eoBr2YX), six
screens: a PC, the picker, three phone screens, and Status & setup. It's private to the owner.

**What stays:** the edge, the door, GitHub as the record, the polling with ETags, plain HTML and
JS with no framework, the Harbour colours (deep slate, one sea-teal accent, amber for "needs you"),
and every route the page calls today. Nothing in the core changes but two optional fields (below).

## Why: what the review found

In the owner's screenshots and a sweep of every view on a PC and a phone:

1. **Picking a model started a run.** A pick on a task posted `use …`, which ran the box only to
   say "From the next run". (Fixed in #207: a pick goes with your next message.)
2. **The model menu did three jobs in one list:** agent, model and search, with the effort below.
   It showed ids, not names, and nothing to choose by but a maker.
3. **What needs you didn't stand out.** "Needs you", "Working" and "Answered" were all small grey
   words in the list; a question waited in a box like any other.
4. **Facts were hidden.** A task's runs, time and cost were in folded run lines, one per reply;
   nothing added them up.
5. **Status & setup was a stack of cards,** each with its own layout and "To change it" line;
   model ids ran on as a paragraph; Telegram and the web chat showed twice.
6. **The list could lose a click** while a run worked (fixed in #207), and on a phone the menus
   were small targets.
7. **pi on a smaller model failed a question** answered in plain words, and a paid model showed
   "free" (both fixed in #207).

## The design

### Principles

- **One job, one place.** The list chooses a task; the thread is the conversation; the info pane
  holds settings and facts; Setup holds the platform.
- **What needs you stands out:** amber for "needs you", teal and a live timer for "working", grey
  for the rest. The state is a word and a shape, never only a colour.
- **No run without your words.** Changing the model, the effort or the agent goes with your next
  message.
- **Facts we already have,** shown plainly; nothing new is fetched to make a screen look busy.
- **Big targets on a phone** (44 px), the keyboard on a PC (arrows, Enter, Escape, `/`).

### On a PC

```
┌──────────────┬─────────────────────────────────────┬──────────────┐
│ Shipify  New │ make the header blue · Needs you    │ Thinks with  │
│ [search    ] │ #208 · spotter · 3 runs · $0.05  ⓘ  │ Pi · Kimi…   │
│ homepi · 1/2 │                                     │ This task    │
│ Open|Needs|… │  you: make the header blue…         │ 3 · 2m54 ·   │
│ ● #208 Needs │  Shipify: done · [Review PR #31]    │ 41k · $0.05  │
│ ◉ #201 Work… │     kimi · 1m 12s · 11 tools · $0.03│ Runs         │
│ ○ #178 …     │  Shipify: Should the footer match?  │  …           │
│ Repeats      │     [Yes, match it] [No, leave it]  │ Linked       │
│ Repeats Notes│  [Reply…           ] (Pi · Kimi ▾) ⬆│  PR #31 ✓    │
└──────────────┴─────────────────────────────────────┴──────────────┘
```

- **The list:** search, the box's line (it opens Setup), and **Open · Needs you · Closed** as one
  control with counts. Rows show a state mark, the title, then the state's word, kind and number.
  "Needs you" rows are tinted; a working row shows its timer. Repeats are a group at the end.
- **The thread:** a header with the title, the state, the task's totals, its PR, Close, and Info.
  Your messages on the right; Shipify's as cards with the run line folded under them. A question is
  a card of its own, with its answers as buttons when the run gave them (see "Quick answers").
- **The info pane:** **Thinks with** (the agent and model, with Change), **This task** (runs,
  time, tokens, cost), **Runs** (each with its model, time, tools, tokens and cost), **Linked** (PR
  and its checks, the app, GitHub), and **Files**.

### On a phone

- **Tabs at the foot:** Tasks, Repeats, Notebook, Setup; **New chat** is the one floating button.
- **A thread:** back, the title on one line, the state and totals under it, and ⓘ for the info,
  which opens as a sheet. The composer's model pill opens the picker as a sheet.

### The model picker

One panel on a PC and a sheet on a phone, the same for every agent:

1. **The agent:** two tabs with a subtitle each ("your plan · default", "OpenRouter · key since 6
   Oct"). A tab shows its models; nothing changes until you pick.
2. **Search and filters:** typing narrows your list at once, and for an agent with a gateway it
   searches the gateway too. Filters: **Free**, **Tools**, **Reasoning**, **Images**, **Under $1 /
   M**.
3. **The models,** each a two-line row: its **name** ("GLM 5.3 Flash"), its maker, its price per
   million tokens in · out (or **free**), its context, and what it does (tools, reasoning, images).
   **Auto** comes first and says what it runs. Your list, then **More on OpenRouter**.
4. **The effort** at the foot, as one control with **that model's** efforts when the gateway says
   them ("GLM 5.3 Flash takes low, high, max"), else the agent's.
5. **Done.** The pick goes with your next message, and the composer's pill shows it, outlined until
   then.

Claude Code's models say "your plan" in place of a price; their names and one line each ("most
work", "hard changes") come from `executors.json`.

### Status & setup

- **A summary across the top:** All good (or what isn't), the box, the door, the chats, and the
  next key to renew.
- **Agents and models,** a table: agent (and default), its login or key, its Auto, its listed
  models by name. Changing the list stays a PR to `executors.json`.
- **Keys and dates** with the days left as a bar; **Tools** with what each reads and what it
  changes after your yes; **Started by the watch**.
- Each section says once how to change it, as a command with Copy.

## The data, within our limits

No new polling, no new GitHub reads, nothing new on a box. What's new:

| Shown | From | Cost |
|---|---|---|
| A task's runs, time, tokens, cost | each reply's line, which the thread already reads, gains `run: {secs, tokens, usd?}` (optional, written by apply from the run details it already has) | none |
| A model's name, maker, price, context, max output, inputs, tools, reasoning and its efforts | the gateway's list (OpenRouter's `GET /models`, public): read **only when the picker opens**, for your listed models, at most **once a day**, kept at the edge; searches as today, kept 10 minutes | about 7 small reads a day at the edge, none when the picker isn't opened |
| Quick answers to a question | the agent's result gains `choices` (optional, up to 3 short answers); a tap sends that answer as your words | none |
| Claude's models' one line each | `executors.json`: `about` per listed model (optional) | none |
| A run's cost | the agent's report, when the agent knows it; pi asks OpenRouter to include its cost in the answer (`usage.include`) | none |

The page stays plain HTML and JS. Its budget goes from 88 KB to **104 KB** (about 33 KB as sent),
with the old menu code removed. It loads no new file and no font.

## Build plan

Two PRs, each tested end to end in a real browser on a PC and a phone, light and dark, with
`pnpm verify`:

1. **The shell, the list, the thread and the info pane:** the three panes and the phone's tabs
   and sheets; the reply line's `run` and the task totals; quick answers (`choices`).
2. **The model picker and Status & setup:** the picker with the gateway's facts (once a day, at
   the edge), `about` for listed models, Setup as a summary and tables; pi's real cost.

Then a full docs pass.

**Docs, skills and guides this touches:**
- `docs/channels.md` ("The web chat", rewritten for the panes, the picker and Setup);
- `docs/agents.md` (the picker, a model's facts, `about`, the cost);
- `docs/glossary.md` (task info, quick answers);
- `docs/tasks.md` (quick answers, `use` from the picker);
- `docs/context.md` and `CHANGELOG.md`;
- ADR 0036's and 0038's "As built" (what 0039 replaces);
- the agent template (`choices` in the result).

`skills/frontend-design` stays as it is.

## Decisions for you

1. **Model facts read from the gateway, at most once a day, only when the picker opens** (about 7
   small reads a day at the edge), so your list shows prices and what each model does. Or: prices
   only in search results, as today, and nothing new fetched.
2. **Quick answers:** the agent may give up to three short answers to its question, shown as
   buttons. Or: you always type your answer.
3. **On a phone, tabs at the foot** (Tasks, Repeats, Notebook, Setup), with New chat as a floating
   button. Or: the ☰ menu, as today.

## As built (2026-10-07)

One PR, as the owner asked ("don't need 2 PRs"), with #207's fixes, the owner having seen the mockup
("I like the design we presented"). The three decisions as recommended: model facts at most once
a day when the picker opens, quick answers as buttons, tabs at the foot on a phone. Where it
differs from the text above:

- **Settings across every channel** (the owner: "changing the model and not sending a chat
  message, across templates and patterns"): a `use …` alone from a chat is answered at once by the
  door and marked (`setting` in its from line); `task.yml` skips it, the watch doesn't wait on it,
  and the next run thinks with it and says nothing of it. On GitHub a `use` comment alone is still
  answered by its run (a real message starting "use" mustn't be skipped).
- **Quick answers are written under the question** for GitHub and Telegram ("Answers: …"), from the
  reply line's `choices`, so every channel shows them; the web chat shows them as buttons and leaves
  the quoted question out of the words.
- **Your pick's line is left out of your message's words** in the web chat: its tag shows it.
- **The page:** under 104 KB (about 33 KB as sent), not 100; the picker lives in `compose.js`, and
  menus are placed through CSS variables, so a sheet on a phone needs no `!important`.
- **Not built:** pi's cost for a gateway's model (pi has no price for it, so no cost is shown rather
  than a guess); the agent's install version on Setup (not in its data).

### After it went live (2026-10-07)

The owner's review of the live page: "there is no need of this right section … show on top only
what's necessary, and cost, since each message carries all data". So, in the fix that followed:

- **No info pane, and no sheet:** the thread holds it all. The header shows the task's state, its
  runs added up (cost first) and its PRs; each reply's run line has its own; the model is the
  composer's chip; On GitHub is in **⋯**.
- **Your messages read as in any chat:** your words only, and under them the model you picked, the
  time and a tick once a run read them.
- **The list's filters are back** (a kind, a project, Repeats, your labels), under Open · Needs you
  · Closed, and each row has a mark for its state.
- The page froze while a run worked (a bug from earlier that day, in the list's check of which
  runs to show); fixed, and a part that fails to draw now says so while the rest goes on.
- The page's budget is measured as a phone gets it, compressed: under 40 KB (about 36 KB), not
  104 KB as written; the comments stay.
