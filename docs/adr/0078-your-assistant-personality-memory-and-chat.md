---
status: accepted (merged #742; the owner's `go` on 2026-11-14) and built in one PR (task #741); see [As built](#as-built-2026-11-14)
date: 2026-11-14
amends: 0032 (memory from past chats: read when a run needs it; a run may replace a line your newer words contradict), 0041 (a plain answer keeps no handoff), 0071 (a guest has a memory page of their own, and says `remember:`, `forget:` and `personality:` for it)
---

# 0078: Your assistant: a personality you set, memory across chats, and chats that read like chat

## The plan in short

**Your asks (task #741, 2026-11-14):**
- Make Shipify a strong personal assistant with a personality and memory, as ChatGPT has. Keep it
  simple, efficient and low cost.
- Strong features (agents and such) are opt-in and dynamic, and never get in an agent's way.
- A clean web chat refresh and upload.
- A chat must not feel like a whole flow: is it optimized for conversation?
- A sweep for config ideas. Is ChatGPT's Codex ready, and can you start with it?
- Then: it suggests things smartly and uses its agents' full abilities; it manages memory by
  itself when you want it to; and guests get the same, kept apart, as needed.
- Then: memory of past chats doesn't grow the context window; the personality is set naturally,
  not by a typed command; setup is flexible, with no cognitive load, and manages itself; keep it
  clean: only the goals worth it, done strong and properly.

**The goals, and only these:**
1. **It talks like a person, in your voice:** the answer first, plain words, the personality you
   chose by just saying so.
2. **It remembers without bloat:** what you say is noted and kept current by itself, and past
   chats are fetched only when an ask needs one.
3. **It helps, and never pushes:** a clear next step as a tap; the agent's full abilities when an
   ask gains from them; nothing starts by itself.
4. **Nothing to set up or look after:** no new setting, service or key. Every default works, and
   it learns from how you talk.
5. **Cheap and quick:** a fixed cap on each part; a plain chat takes one turn less than today.
6. **Guests get the same, kept apart.**
7. **What's broken is fixed:** web chat upload and refresh; Codex says at once when it isn't
   signed in.

**The answer:**
- **Memory is mostly there already.** The notebook is ChatGPT's "saved memories": `remember:`,
  `forget:`, `/notebook`, and notes the agent takes from your own words. Missing: a
  **personality** you set, **memory across chats** (a new chat knows nothing of your other chats),
  a memory that **keeps itself tidy**, and anything at all for **guests**.
- **Chats cost more than they need to, in feel more than in money.** Replies read like reports
  (headings, tables, "What I checked"). Every reply also writes a handoff, which takes one more
  agent turn and shows a Progress block at the top of a plain chat. A reply never suggests a next
  step you can tap, unless it asks a question.
- **Speed:** a new chat answers in its thinking time plus 37 to 56 s, and your next words within 20
  quiet minutes in thinking time plus 4 to 11 s (task #673). Most of the 37 to 56 s is GitHub
  starting a job. Only the parked direct layer goes under that, and it isn't worth its weight yet.
- **The plan is seven small parts, built after your `go`.** No new service, store, key, setting,
  recipe or workflow change.
- **It all works by itself, and the context window stays about the same** (section 13): 200 tokens
  more at most with no Personality set, about 700 at most with one, of about 40,000 a turn. Past
  chats are fetched only when an ask needs one, never added by themselves (section 4). Each part
  has a fixed cap, so nothing grows as your chats do. A plain chat costs less than today: it skips
  a whole turn.

| # | Part (section) | What you get | Cost |
|:--|:--|:--|:--|
| 1 | Personality (3) | One page, **Personality**. Set it by saying so in a chat ("be more casual"), or from a menu in Setup; **Change it back** undoes it. Every reply speaks that way | none with no page; a preset about 40 tokens; your own words 500 tokens at most |
| 2 | Memory (4, 5) | What you say is noted, and a line your newer words contradict is replaced, at once. A past chat is found by meaning and read as its summary only when you refer to it (`<ship> recall`) | nothing until a run needs it |
| 3 | Guests, kept apart (6) | Each guest gets a memory and a personality of their own, which never meet yours | nothing until a guest uses it |
| 4 | Next steps, and the agent's full use (7) | A reply may end with up to 3 next steps as buttons. The agent uses its own helpers, web and tools when an ask gains from them | none |
| 5 | Replies that read like chat (8) | The answer first, in plain words, with no report shape for a plain question. No handoff and no Progress block for a plain answer | one agent turn less per plain reply |
| 6 | Web chat refresh and upload (10) | Five fixes: Send waits for a photo, sign-in vs Offline, uploads try again, the Desk offline, pull down to refresh | none |
| 7 | Codex (11) | A run on an agent with no sign-in stops at once and says what to do | none |

Section 9 holds what keeps it free of setup and upkeep; section 12, what waits and what's cut.

**Codex today:** built and merged (#695, #702), and never run live: no task shows a `codex sign
in`. It's ready for your sign-in now. The steps are in section 11. They don't wait for this ADR.

## 1. What was checked (main at 962166ab, 2026-11-14)

| Assumption | How it was checked |
|---|---|
| The prompt's only identity text is fixed, and no page or setting holds a personality | `cli/kernel/prompt.ts` (the lines after "You are Shipify"). A search for personality, persona, tone, voice and style in `cli/`, `edge/`, `playbooks/`, `docs/` and `skills/` finds nothing else |
| Every reply follows ASD-STE100, a rule for technical writing | `playbooks/task.md`, "How you write": "in every reply, PR body, doc and skill" (added 2026-10-17) |
| A run outside a project sees nothing of your other chats; a run in a project sees its newest 30 chats' titles and states | `cli/kernel/projects.ts` (`MOST_CHATS = 30`, `projectLines`); `cli/kernel/think.ts` builds no such list outside a project |
| ADR 0032 left out "memory drawn from chat history" on purpose | ADR 0032, section 3, "What we borrow" |
| GitHub searches issues by meaning (hybrid), 10 searches a minute, and the edge already uses it for Find | `edge/src/web/reads.ts` (`search`, `search_type=hybrid`, falls back to words on 403, 422 or 429) |
| Notes from a run are written at once, unless the run read outside content or worked on another account | `cli/kernel/decide.ts`, "Notes: your own words, written now" |
| A run can propose notes but never a removal: only your `forget:` removes a line | `cli/kernel/result.ts` (`notes`; no field to remove one); `cli/commands/task/notebook.ts` (`forget`) |
| A guest's run gets no notebook, and the door refuses a guest's `remember:`, `forget:` and `jot:` | `think.ts` (no notebook for the `guest` profile); `edge/src/door-in.ts` (`ONLY_YOU`) |
| Your lists, Find and Library leave out what carries the `guest` label; a guest's list reads by `guest:<id>` | `cli/contracts/guests.ts`; `edge/src/web/reads.ts` (`search`) |
| A reply's `choices` show as buttons only with a `question` | `decide.ts` (`r.question && r.choices?.length`) |
| A list's Yes and No are the only buttons for `yes` and `no` | `cli/contracts/words.ts` (`LIST_WORDS`) |
| A talk run's prompt is 17.8 KB with an empty notebook; the notebook adds up to 16 KB; the playbook is 13 KB of it | `buildPrompt` called with the real playbook (this task); `PROMPT_BUDGET` in `cli/lib/notebook.ts` |
| Claude Code's own system prompt and tools are about 31,000 to 34,000 input tokens a turn, mostly cached | The recorded run in `tests/fixtures/claude-stream.jsonl`. An estimate: the build measures a live turn |
| Every reply writes a handoff first: one more agent turn, shown as Progress at the top of the chat | `prompt.ts`, "## Finish"; `edge/public/admin/chat/app.js` ("Its Progress (ADR 0069)"); a talk run's details on #462: `Write ×1 · StructuredOutput ×1` |
| A new chat answers in its thinking time plus 37 to 56 s; a staying run in its thinking time plus 4 to 11 s; a stay waits 20 quiet minutes | `docs/roadmap.md` (task #673, 54 runs on homepi); `STAY_IDLE_MINUTES` in `cli/kernel/stay.ts` |
| Send works while a photo is still made smaller, and the message goes without it | `compose.js` (`add` awaits `attach.js` and `shrink` before `files.push`, so `state()` sees no upload) |
| An upload after Access's sign-in ended shows "Offline" | `attach.js` uses XHR, which follows the redirect to Access's sign-in and fails as a network error; `api()` in `compose.js` uses `redirect: "manual"` and says "Your sign-in ended" |
| A failed upload doesn't try again when the network is back | `app.js`: the `online` handler sends failed messages again (`again`), not uploads |
| The Desk (the first screen) isn't in the service worker's cache | `sw.js`, the precache list: no `desk.js` or `desk.css` |
| The page turns off the browser's pull-to-refresh, and an installed app has none, but the docs say "dragging down is the browser's own reload" | `app.css` (`overscroll-behavior: none` on `body`); `docs/channels.md`, "↻ in each header" |
| `use codex` with no `CODEX_AUTH` starts the run, installs Codex (about 400 MB, once a box) and fails with Codex's own error | `handOver` in `think.ts` writes no login file when the value is empty, and nothing stops the run; `codex.ts` adds the hint only when the error's words match. ADR 0074 said such a run is refused before it starts |
| Codex ships linux-arm64, so it runs on a Raspberry Pi | npm `@openai/codex` 0.169.0 lists `@openai/codex-linux-arm64`; 0.167.0, the pin, was installed and started on homepi (ADR 0074) |
| Codex's sign-in from a chat needs "device code authorization" on in ChatGPT's security settings | OpenAI's Codex authentication page; a 2026 guide names the switch (Sources) |
| ChatGPT has personality presets, four characteristics, custom instructions, saved memories and "reference chat history" | OpenAI's help pages and 2026 reports (Sources) |

## 2. How ChatGPT does it, and what we take

| ChatGPT | We take | We leave out |
|:--|:--|:--|
| **Personality presets** (Default, Professional, Friendly, Candid, Quirky, Efficient, Cynical) and characteristics (warm, enthusiastic, headers and lists, emojis) | five presets as starting words for one page you edit; characteristics are lines on it | a slider per characteristic: one page of your words does it all |
| **Custom instructions** ("about you", "how to respond") | the Personality page (how to respond) and the notebook's Preferences and People (about you), as today | a second page for "about you" |
| **Saved memories** | the notebook, as today | — |
| **Reference chat history**: details picked from past chats by itself, with a memory summary you can steer | past chats found by meaning, and read as their summary, when an ask needs one; a line your newer words contradict, replaced as you say them | past chats in every prompt; a memory summary written from chats by itself, or a note from anything but your own words (memory is an attack surface: ADR 0032, OWASP ASI06) |
| **Follow-up suggestions** under a reply | up to 3 next steps as buttons, when one is clear | suggestions under every reply |

## 3. Personality

**Decision:**
- **One page, `Notebook: Personality`, read by every run of yours, first.** Its text goes in the
  prompt's opening lines, after "You are Shipify": "How you speak, in the owner's words (their
  Personality page)". At most 2,000 characters; a longer page is cut, and the prompt says so. The
  notebook section leaves the page out, so it's never there twice. With no page, the Default
  preset's words take the place of today's "Be brief and direct", so a run costs nothing more.
  "Say what you're unsure of" and "state a limit plainly" stay, whatever the personality.
- **You set it as feels natural, with no command to learn** (your ask, 2026-11-14: a typed
  `personality: friendly` "feels worse"):
  1. **Say it, in any chat:** "be more casual with me", "drop the emojis", "be blunt when I'm
     wrong". The run changes the page through a new result field, `personality`: the page's new
     words, whole, 2,000 characters at most, kept close to what you said. The reply says
     "Personality updated" and shows a **Change it back** button. It's written at once from your
     own words, as a note is, and after an outside read it waits for your Yes, as a note does.
  2. **A menu, in Setup → Personality:** a dropdown of Default, Friendly, Candid, Efficient,
     Quirky and Custom. A preset is set as soon as you pick it. Custom opens a text box with the
     page's words, and **Save**. The menu writes the page at once, as the door does for
     `remember:`: no chat message and no run. The card shows the page's link.

  Under both is one fixed word the door answers with no run: `personality: <preset or your
  words>`, `personality: default` (the page closes) and `personality: undo`. The menu and the
  button send it; it works on GitHub too. You never need to type it. (A `/personality` command
  was cut: saying it and the menu cover every channel.)
- **Change it back:** each write keeps the page's last words, folded under "Before" and left out
  of the prompt. The button sends `personality: undo`, which puts them back. `remember
  Personality: …` adds a line, as on any page, and `forget:` takes one off.
- **Five presets,** each two or three lines in one list in `cli/contracts/`, which the menu, the
  buttons and the word read:

  | Preset | Its words |
  |:--|:--|
  | Default (no page) | Warm, plain and direct, like a capable friend. The answer first. Short unless asked |
  | Friendly | Warm and encouraging, a little humour, conversational. My name now and then |
  | Candid | Blunt and honest. Push back when I'm wrong, risks first, no flattery |
  | Efficient | Bare answers: the result first, bullets, no small talk, no recap |
  | Quirky | Playful and curious, light jokes and the odd emoji; the facts stay exact |

- **The writing rule moves to what's written:** ASD-STE100 stays the guide for docs, PR bodies,
  plans and skills. A reply in a chat follows your Personality page first, in plain words, and
  keeps STE's clarity (short sentences, one term per idea).
- **What doesn't change:** your words in a task still win over the page; a page never approves
  anything. A guest's personality is their own (section 6).

## 4. Memory across chats: fetched when needed, never added by itself

**Your ask (2026-11-14):** memory of past chats must not grow the context window. Use projects,
clever ways to compress a chat, or an opt-in.

**What Shipify already does, unchanged:**
- **A long chat compresses itself** (ADR 0069 section 8). Past 40 KB, a run gets the chat's
  Progress, its newest 8 messages whole, and each older one as one line, read whole on demand
  (`<ship> task read <id>`). The prompt stays small as the chat grows.
- **The Progress is the chat's summary.** The run writes it anyway, as its handoff: no extra run,
  and no detail lost, as every word stays on GitHub.
- **A project shares memory between its chats:** its pages (facts and decisions, kept with **Keep
  on page**) and its chats' titles. Only that project's chats get them.
- **The notebook has a 16 KB cap,** and the Library's pages are read only when a run asks.

**Decision: pull, never push.**
- **No list of past chats goes in a prompt.** A run outside a project gets nothing more for
  memory across chats. (An earlier draft of this ADR put your 15 newest chats in each new chat:
  left out, as most asks don't need it.)
- **`<ship> recall "<words>"`** searches your chats and pages as Find does (GitHub's search by
  meaning; by words when GitHub refuses it), guests' left out, and prints up to 10 lines: number,
  title, state and day. It shares GitHub's 10 searches a minute with Find.
- **`<ship> recall <n>`** prints one chat, compressed: its Progress first, then its newest 2
  messages whole, and each older one as one line with its id (`<ship> task read <id> --task <n>`
  prints one whole). A chat with no Progress is a plain one, and short.
- **The playbook says when:** only when the ask builds on an earlier talk ("like last time", a name
  or an idea the notebook doesn't hold). Recall first, then answer. An old chat is data: only your
  words there count, and your newest words win.
- **What doesn't change:** only your words become notes; the agent never edits the notebook; the
  pages stay issues on GitHub, with no second store.

**What to use when** (the playbook and `docs/notebook.md` say it so):

| You want | Use | What it adds to a prompt |
|:--|:--|:--|
| A fact or a preference kept for good | `remember: …`, or say it in a chat | one line in the notebook (16 KB cap) |
| A topic that goes on over many chats (Shipify's plans, a trip, a course) | a project: `project: <name>`, then **Move to project** on its chats | its pages and chats' titles, in its own chats only |
| One long chat | nothing: it compresses itself past 40 KB | stays small as it grows |
| "Like last time", now and then | say it: the run recalls that chat | only on that run, only what it reads |
| A notebook that stays current | nothing: a line your newer words contradict is replaced as you say them (section 5) | nothing |

**Not chosen:**
- **Your newest chats in every new chat:** tokens on each new chat for a list most asks don't use.
- **A summary run after each chat** (as ChatGPT keeps a memory summary): a run for every chat,
  and a summary can drop a detail. The Progress is already the summary.
- **Embeddings in a store of our own:** a new service. GitHub's search by meaning does it.
- **The whole history in the prompt:** it grows with no end.

## 5. Memory that keeps itself current, with nothing to run or approve

**Decision:**
- **In a chat, as today:** when you state a fact or a preference ("Priya is my designer"), the run
  notes it, and the reply says "Noted". Only your words; never a guess.
- **Kept current as you go:** when your new words contradict a line already there ("I've moved to
  Berlin", over "Lives in London"), the run replaces it: the new note, and the old line in a new
  result field, `forget` (up to 5, each by its words, as `forget:` takes them). The same rule as
  a note: at once from your words, and the reply says "Updated: <old> → <new>"; after an outside
  read, both wait for your Yes. The box removes each as `forget:` does: one matching line, or
  none when several match, and the reply says so.
- **No repeats:** the run doesn't note what the notebook already says (the playbook).
- **Only your words in this chat:** a recalled chat (section 4) is data, never a source of notes.
- **When it fills:** the notebook keeps its 16 KB budget. Past it, a page shows by its title and
  first line, and a run reads it when needed, as today. Nothing for you to do.
- **Cut: a weekly memory-review recipe** (an earlier draft): a run a week and a list to approve,
  for what replacing as you go does with no run. Worth a look again only if the notebook nears its
  budget.

## 6. Guests, kept apart

**Decision:**
- **One page each, made when first needed:** `Notebook: <their prefix> memory`, labelled
  `library`, `guest` and `guest:<id>`, never `notebook`. So no run of yours reads it, and your
  lists, Find and Library leave it out, as they leave out every guest's thing today.
- **Their words, in their space:** `remember: …`, `forget: …` and `personality: …` write their
  page alone. The door lets these three through for a guest now, and the box writes nothing else
  for them. `jot:` and the words in `NOT_A_GUESTS` stay yours. They set their personality by
  saying it in a chat, as you do; Setup's menu is yours.
- **Their runs:** the page goes in their prompt, its Personality line first (2,000 characters at
  most), then their notes, 8 KB in all. Their page is their memory across chats. No `recall`:
  their run holds no key.
- **Their notes from a run:** written to their page when the run read nothing from outside, and a
  line their newer words contradict is replaced, as yours is (section 5). After a web read, a note
  is left out, and the reply says "say `remember: …` to keep it" (a guest approves no list).
- **What stays apart:** their page never reaches your runs, and your notebook, Personality, chats
  and pages never reach theirs. Removing a guest closes their page with their chats.
- **As needed:** nothing exists until a guest uses it, and there's no setting.

## 7. Suggestions, and the agent's full use

**Decision:**
- **Next steps as buttons:** a reply may end with up to 3 short next steps (`choices` with no
  `question`), when one is clear and useful: "Make it a task", "Remind me Monday at 9", "Keep
  this on the project's page". The web chat shows them as buttons, and Telegram too; a tap sends those
  words in the same chat. A guest's run may suggest too.
- **A suggestion starts nothing until you tap it** (nothing starts by itself, your rule), and it's
  never `yes` or `no`: a list keeps its own Yes and No.
- **The agent's full use, when the ask gains from it** (the playbook): its own helpers in parallel
  for wide reading, its web search, Shipify's skills and tools, containers and a browser for a
  real check. A plain chat needs none of them. The agent decides for each ask; Shipify adds no
  forced step.

## 8. Replies that read like chat

**Decision:**
- **How a reply reads** (the playbook): lead with the answer, as a person would say it. A plain
  question gets a plain answer, in a few sentences or bullets. Headings, tables, "What I checked"
  and "In order" are for work that has parts: a PR, a plan, steps for you. The first paragraph
  still stands alone, as a chat shows it.
- **A plain answer keeps no handoff.** The prompt asks for `handoff.md` only when the work goes on
  past this reply: a PR, a plan in steps, research in parts, a question before work. So a plain
  chat shows no Progress block, and its run takes one turn less. The box keeps a handoff however a
  run ends, as ADR 0041 says, when there is one.
- **The run details stay,** folded under the run's line in the web chat, as now.
- **Not chosen:**
  - **A greeting answered with no agent** ("hii"): you use one to check the setup, and a fixed
    line has no personality.
  - **A cheaper Auto for chats** (Haiku, or a lower effort): the model is your pick. `/use sonnet
    low` or `/use haiku` makes quick chats faster, when you want that.
  - **A shorter playbook for chats:** about 3,000 tokens of about 35,000 a turn, mostly cached. Not
    worth a second playbook to keep.
  - **The direct layer** (replies in about a second, words off GitHub): parked, as in ADR 0057. It
    needs a hub on the edge, breaks "every message on a task" (ADR 0031) and "the edge keeps
    nothing" (ADR 0019), and adds a part to keep. Within a stay, replies already take 4 to 11 s
    plus thinking.

## 9. No setup, no upkeep, and never in the agent's way

Your ask (2026-11-14): flexible, with no cognitive load; it manages itself, cleanly and simply.

**What manages itself, with nothing for you to set or look after:**
- **Personality:** the Default works with no page; you change it by saying so.
- **Memory:** noted as you talk, replaced when your words change, read on demand past its budget.
- **Past chats:** found when you refer to one; a long chat compresses itself; a project's chats
  share its pages.
- **Guests:** their memory starts when they first use it, and closes when they're removed.
- **Agents:** a run with no sign-in stops before it starts and names the one word that fixes it.
- **The box, as today:** it applies each box setup by itself at its next due run, and a new drive
  is one command (`docs/box-setup.md`).

**Decision:**
- **No new setting, variable, recipe or service.** Your words and Setup's Personality menu are the
  only switches.
- **Opt-in stays opt-in:** who thinks (Claude Code, Codex, pi, OpenCode, a gateway's models), `use`
  for one chat, recipes, repeats and `split`. The agent's own helpers, containers and browser are
  its call.
- **Shipify adds no step to an agent's own way of working.** This ADR changes what the prompt says
  about who you are and what you said before, and nothing about how the agent works.
- **Not added, as each is load and not less:** a setting for the notebook's size, for how many
  chats a recall shows, or for suggestions on or off; a slider for each personality trait. The
  defaults and your words do these.

## 10. The web chat: refresh and upload

**Decision, each with a test that runs the code (as the upload-timeout test does):**
1. **Send waits for a photo.** From the moment you add a file, Send shows "Uploading…" and waits,
   also while a photo is made smaller.
2. **Sign-in, not Offline.** When an upload fails with the network up, the page asks the edge once
   as `api()` does. If Access's sign-in ended, it says "Your sign-in ended: tap to sign in again",
   as a message does.
3. **Uploads try again.** A failed upload is sent again once, by itself, when the network comes
   back, as a failed message is.
4. **The Desk offline.** `desk.js` and `desk.css` go in the service worker's cache, so the first
   screen opens with no network after a first visit.
5. **Pull down to refresh, on a phone.** At the top of the list or a thread, a pull reads what's
   on screen again, as ↻ does (and a newer page loads if nothing is typed). The browser's own pull
   stays off, so a pull never reloads the page and loses what you typed. The docs' line on
   "dragging down" changes to say this.

The first screen's budget (43 KB) holds: what's new goes in `compose.js` or a part loaded when
needed, or room is made in `app.js`. The next-step buttons (section 7) use the question's buttons
as they are.

## 11. Codex

**Today:** the code is merged and released (0.1.20), and the box installs Codex the first time a
run picks it. It has never run live. **Your steps, any time, now too:**
1. In ChatGPT, **Settings → Security**: turn on **device code authorization** for Codex. OpenAI
   lists Codex's CLI for Plus and Pro, not for Go or Free: on those, the sign-in warns.
2. In any chat, say `codex sign in`. A reply gives a link and a code. Open the link, sign in, and
   type the code (15 minutes, works once). The next reply says ✓ and names your plan.
3. Say `use codex` on a small question. That's the live check. The first run on a box installs
   Codex once (about 400 MB). After it, the box keeps your sign-in current.

If no code comes in step 2, the switch in step 1 is still off.

**Decision (the fix):** a run on an agent whose login isn't set stops before the agent starts, as
ADR 0074 meant. Its reply says what to do: "Codex isn't signed in: say `codex sign in`", or for an
agent with no sign-in word, its step in `pnpm ship setup`. Pinned Codex stays 0.167.0 (0.169.0 is
out): a version moves only in a PR that says so, after the first live run.

## 12. The sweep: what's in, what waits, and what's cut

**In this build:** sections 3 to 11, the seven parts in the plan's table.

**Later, each after your `go`** (from `docs/roadmap.md`, "Faster and cheaper runs"):
1. **Fewer token steps in `task.yml`:** 2 to 4 s less before each first reply. A workflow change,
   so a list for your Yes (ADR 0075).
2. **The runner's own cache of actions** (box setup 17): about 3 s less on every job.
3. **A reply's push before its files:** your phone rings sooner when a reply has files.

**Cut, as not worth what it costs** (your ask: only what's worth it):

| Cut | Why |
|:--|:--|
| Your newest chats in every new chat | tokens on each new chat; `recall` finds one when it's needed (section 4) |
| A weekly memory-review recipe | a run a week and a list to approve; replacing as you go does it with no run (section 5) |
| A `/personality` command | a third way to do one thing; saying it and Setup's menu cover every channel (section 3) |
| A summary run after each chat, or an embeddings store | a run per chat, or a new service; the Progress and GitHub's search do it (section 4) |
| The direct layer, a greeting with no agent, a second playbook for chats, a cheaper Auto | section 8 |
| A setting or slider for any of it | load, not less (section 9) |

**The build:** one PR after your `go`. If it grows past one run, the web chat and Codex fixes
(sections 10 and 11) go in a second PR, as they touch other files.

## 13. The context window

A turn today reads about 40,000 tokens: Claude Code's own 31,000 to 34,000, Shipify's prompt
(17.8 KB, about 4,500 tokens) and the notebook (16 KB at most, about 4,000). Most of it comes
from the cache, at about a tenth of the price.

**Decision: each part has a fixed cap, and full chat history never goes in by itself.**

| Part | Adds to a turn, at most | When |
|:--|:--|:--|
| Personality, none set | nothing: the Default words take the place of today's line | every run |
| Personality, a preset | about 40 tokens | every run |
| Personality, your own words | 500 tokens (2,000 characters) | every run |
| Past chats | nothing | — |
| A past chat (`recall`) | its hit list (about 300 tokens), then that chat's Progress and newest 2 messages | only when the ask builds on an old chat |
| The playbook's new lines | 200 tokens; the build cuts old lines to pay for them where it can | every run |
| A guest's page | 2,000 tokens (8 KB) | their runs only; none of yours |

- **Worst case for you:** about 700 tokens more, with a long Personality page. That's under 2% of
  a turn. With no page set: 200 tokens at most.
- **A plain chat costs less than today:** it writes no handoff, so it skips a whole turn (about
  40,000 tokens read again from the cache).
- **Nothing grows over time:** the caps don't depend on how many chats or notes you have. The
  notebook keeps its 16 KB cap, and a line your newer words contradict is replaced, not kept.
- **The build measures it:** its PR says a talk run's prompt size before and after, and a test
  holds the caps.

## Edge cases

- **No Personality page:** the Default words, in the prompt's code.
- **A page someone else edited last:** left out, as any notebook page is today, and the prompt
  says so.
- **`personality: <a preset's name>` with more words** ("friendly, and call me Aayush"): taken as
  your words, whole.
- **A Personality page over 2,000 characters:** cut there, and the prompt says the page is longer.
- **An ask about one reply only** ("explain this one simply"): not a Personality change. The run
  changes the page only when you speak of how it talks to you from now on.
- **`personality: undo` with no "Before":** nothing changes, and the reply says so. A second undo
  puts the newer words back.
- **The menu, when someone else edited the page last:** it shows that, and a save writes your
  words as a new version, as Edit in the window does.
- **`recall` refused by GitHub (10 a minute):** it searches by words, and says so.
- **`recall` finds nothing:** it says so, and the reply says it found no earlier chat on it.
- **A replacement whose old line matches several lines, or none:** the new note is kept, nothing
  is removed, and the reply says which.
- **A note that contradicts a line you said in the same breath** ("short answers, but explain the
  maths"): both kept; a replacement is only for a line your newer words undo.
- **A guest's `remember:` before their page exists:** the box makes it, with their labels.
- **A guest's page edited by someone else on GitHub:** left out of their prompt, as yours would
  be, and their reply says so.
- **A guest removed while their run works:** the run ends as today; their page closes with their
  chats.
- **A suggestion that is `yes` or `no`, or longer than 60 characters:** left out.
- **A suggestion tapped in an old chat:** it goes to that chat, as a reply there does.
- **Send waits on a photo that never finishes being made smaller:** the shrink ends at once on an
  error and sends the photo as it is (today's rule); the wait ends with it.
- **The sign-in check after an upload fails while really offline:** "Offline", as today.
- **A pull while a read is going:** ignored, as a second ↻ is.
- **`use codex` on a read run or a guest's run:** Claude Code thinks, as today; the new stop
  doesn't apply.

## Setup

Nothing to set up. After the merge:
- **Personality:** say how you want it to talk in any chat, or pick it in Setup → **Personality**.
  Or do nothing: the Default stays.
- **Memory:** nothing. Talk as you do.
- **Guests:** nothing. A guest's memory starts the first time they use it.
- **Codex:** section 11.

## Docs and clean-up

The build updates, in the same PR:
- `docs/notebook.md`: the Personality page and word; memory across chats, with section 4's "What
  to use when"; `recall`; a line replaced as you go (`forget` in a result).
- `docs/channels.md`: Setup's Personality menu and **Change it back**; next steps as buttons; a
  guest's memory; pull
  down to refresh (the old "dragging down" line goes); uploads (Send waits, sign-in, a try again).
- `docs/security.md`: a guest's page, and what keeps it apart.
- `docs/tasks.md` and `intents.json`: the word `personality:` (and `personality: undo`) with the
  notebook's words; `personality`, `forget` and `choices` alone in a result.
- `docs/agents.md`: a run with no login stops at once.
- `docs/knowledge.md`: memory across chats beside the Library.
- `playbooks/task.md` and `playbooks/guest.md`: "How a reply reads", the writing rule's new reach,
  "Memory" (`recall` and when; replace a line your newer words undo; no repeats), a Personality
  change only from how you want it to talk from now on, next steps, the agent's full use, the
  handoff only for work that goes on.
- `docs/cli.md`: `ship recall`.
- `docs/glossary.md`: Personality, recall.
- `docs/roadmap.md`: the sweep's three later items stay; "a reply's next words as buttons" goes
  from "Channels in step".
- `docs/adr/README.md`: this ADR's row, then its As built.
- `CHANGELOG.md`.

## Consequences

- **Easier:** Shipify speaks your way in every chat, picks up where other chats left off, keeps its
  memory current by itself, offers the next step as a tap, and answers a plain question plainly,
  with nothing to set up. Guests get the same, in their own space. A file you add always goes with your message.
- **Harder:** one more page in every prompt (2,000 characters at most; section 13 has every
  cap); a past chat is found only when the run thinks to look (the playbook says when);
  `recall` shares GitHub's 10 searches a minute with Find; one more kind of page to keep apart (a
  guest's), held by the same labels as their chats.
- **Unchanged:** every message on a task, one run shape, only your words as instructions, no new
  key, store, service, setting, recipe or workflow change.

## Confirmation

- Tests: the prompt holds the Personality page first and never twice, and with no page it's no
  longer than today; the word, the menu and a run's `personality` write the page whole and keep
  the last words as "Before", and `personality: undo` puts them back; no prompt outside a project
  lists past chats; `recall` leaves guests' things out, and `recall <n>` prints the Progress, the
  newest 2 messages whole and each older one as one line; a run's `notes`, `forget` and
  `personality` are written at once, and after an outside read wait for your Yes; a `forget` that
  matches several lines removes none; a guest's words write their page alone, their run
  reads only it, and yours never does; `choices` alone show as buttons, never `yes` or `no`; a
  plain answer's prompt asks for no handoff; the five web chat fixes, each run as code; a run with
  no login stops before the agent.
- Live, after the merge: "be more casual with me" in a chat, then a new chat that follows it, and
  **Change it back**; a preset picked in Setup's menu; a new fact that replaces an old note; a new
  chat that names an older one; a guest's `remember:`, then their next chat; `codex sign in`, then
  `use codex`.

## Open questions

Both closed by the merge and `go` (2026-11-14): the five presets as they are, and chats in your
Personality's voice with STE kept for docs, PR bodies, plans and skills.

## As built (2026-11-14)

One PR, all seven parts, as section 12 says.

- **Personality** (section 3): `cli/contracts/personality.ts` holds the five presets, the word
  (`personalityWord`) and the page's Before (`withVoice`, `undoneVoice`), read by the box, the
  prompt and Setup. The word is the box's, with no agent, as `remember:` is (`decide.ts`, on a
  comment or as a new chat's words, lines too); a run's `personality` writes the same way, and its
  reply carries `undo` on its line, which every chat shows as **Change it back**.
  `personality: default` closes the page and keeps its words under Before, so `undo` opens it
  again with them. With no page, the prompt's line is the Default's words and "Say what you're
  unsure of, and state a limit plainly…": 164 characters, where the line it took the place of was
  172.
- **Setup's menu** sends the word through the door as a new chat, as the Library's Remember sends
  `remember:`: the box writes the page with no agent, answers, and closes that chat. So a pick is
  no run, but it is a short closed chat, not none: writing the page from the edge would need a
  second writer of the notebook for one menu. Setup reads the page with one listing of the
  notebook (`personalitySeen` in `edge/src/web/setup.ts`); a guest's page is never read as yours.
  The card took Setup's lazy part from 5.9 KB to 6.2, so its budget is 7.
- **Memory** (sections 4, 5): `ship recall` is `cli/commands/recall.ts`. Besides guests' things,
  it leaves out the run's own task and the status task, and `recall <n>` refuses a guest's chat
  and sends a page to `ship notebook read`. A run's `forget` is taken off before its notes; after
  an outside read, notes, lines to forget and a Personality are one list for your Yes (`pending.notes`
  with a `kind`).
- **Guests** (section 6): their page is `## Personality` (with its Before), then `## Notes`; their
  prompt gets "Their memory" (2,000 characters of Personality, then notes, 8 KB in all). A page
  someone else last edited is left out and said, and nothing is written over it.
- **Replies** (section 8): a talk run's prompt with no Personality went from 17,394 characters to
  18,241 (about 212 tokens): the playbook's new rules (how a reply reads, the writing rule's
  reach, recall, the agent's full use) and the prompt's fields. The guest playbook line in
  `playbooks/task.md` became a comment, which no run reads, to pay for part of it.
- **Web chat** (section 10): pull down to refresh is `pull.js`, loaded on the first touch, as the
  first screen had no room (44,023 of its 44,032 bytes); a file's work after it's in the box
  went to `attach.js`. A second ↻ while a read goes is now ignored, as the edge case says.
- **Codex** (section 11): the stop is `loginMissing` in `think.ts`, before the clone and the
  agent, with two problems, `agent-not-signed-in` (`codex sign in`) and `agent-login-missing`
  (`pnpm ship setup agent <id>`). Off a box, only an agent whose login is a file stops: another
  may use its own sign-in on that computer. **Not as planned:** the box installs the agent in an
  earlier step that holds no login (`ship run agent`), so a first `use codex` on a box still
  installs Codex once before it stops. Stopping before the install needs the login in that step,
  a workflow change, which this ADR rules out; it waits for your `go` if you want it.

## Sources

- OpenAI, [Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) and
  [How memory uses past conversations](https://help.openai.com/en/articles/10303002-how-does-memory-use-pastconversations)
- [ChatGPT can now reference all your past chats](https://www.iclarified.com/96981/chatgpt-can-now-reference-all-your-past-chats)
  (2026-08-06)
- [OpenAI adds granular personality and tone controls to ChatGPT](https://www.iclarified.com/99450/openai-adds-granular-personality-and-tone-controls-to-chatgpt)
  (2026-02-04)
- [OpenAI Academy: personalization](https://openai.com/academy/personalization)
- OpenAI, [Codex authentication](https://developers.openai.com/codex/auth)
- [Codex device code auth and ChatGPT security](https://lucaberton.com/blog/codex-device-code-auth-chatgpt-security-2026/)
- npm, [`@openai/codex`](https://registry.npmjs.org/@openai%2Fcodex/latest) (0.169.0, read 2026-11-14)
- OWASP, [Memory is a feature, it is also an attack surface](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/)
