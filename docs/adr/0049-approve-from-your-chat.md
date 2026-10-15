---
status: accepted (merged #319) and built (task #317; the owner's go on 2026-10-10); see [As built](#as-built-2026-10-10)
date: 2026-10-10
amends: 0030 (a `yes` from a channel approves a list; merges and the words that act on code stay on GitHub), 0031 (rule 6: a `yes` the door wrote approves a list; a pre-approved call counts after the tools its form names), 0036 (the web chat's `yes` is a button), 0042 (approving from a chat, its one deliberate difference, narrowed to merges and the words that act on code)
---

# 0049: Approve a list from your chat, and routines that use your tools

## The owner's asks (task #317, 2026-10-10)

- "This is not a good follow procedure if i am saying yes now it doesnt count"
- "make this clean setup if I say yes from chat or anywhere there is no PR needed for this right …
  if I set recepie or routine or something if we set cleanly it should allow all these tools
  cleanly"
- Offered a passkey, the chat, or GitHub: "Keep it simple clean yes from the chat very little
  changes clean workflow properly … if I am setting any routine or recepie then automatically clean
  way of setting up simply makes proper plan on what agents generally do and how our rules cleanly
  fit in"
- "Also check and add for webchat in plan small refresh button on top … drag down also works …
  keep it simple clean"

## Context

What happened on #317:
1. Asked for a test quote in Notion, the reply listed one `notion.create_page` for a `yes`.
2. The owner said `yes` in the chat. It was refused: a `yes` counts only on GitHub.
3. The next reply offered a button, "Yes, I'll comment it on GitHub". A tap sends those words, and
   any words besides `yes` and `no` drop a waiting list. So the list was gone.
4. That reply showed the list twice: the agent copied it into its words, and the box added it.

Routines can't use a tool by themselves either. A `pre` form in `tools.json` never counts in a run
that read a tool's content, and every look call counts as that. So "read my Tasks, write today's
plan under Daily" always waits for a `yes`, though [recipes.md](../recipes.md) says a recipe may
make pre-approved calls.

`yes` stayed on GitHub because of ADR 0030's reasoning, which was about merges: approving a merge
from a channel needed a second App, a key, a pipeline change and a commit binding, because a merge
deploys code. A `yes` approves something smaller. It covers calls the box makes with a tool's act
key, listed exactly, and never code or a deploy.

## What other agents do

| Pattern | Who does it | Shipify |
|---|---|---|
| Reads are free; writes are gated, per tool | OpenAI's Agents SDK (`require_approval`); Claude Code's allow, ask and deny rules | ✓ a read key to look; the act key only the box holds |
| Approve the exact call in the chat you're using | n8n's human review (the tool and its arguments sent to Slack, Telegram or its chat); OpenAI's approval events | ✗ GitHub only. **This ADR: ✓** |
| A routine is granted what it needs once, when it's set up, then runs with no prompts | Claude Code's routines (repos and connectors picked once) | half: `pre` forms exist, but no routine can use one after reading a tool. **This ADR: ✓** |
| Anything beyond the grant stops and asks | all of them | ✓ the list waits for your `yes` |
| Untrusted content tightens the rules: private data, untrusted content and a way out add up to a leak | Simon Willison's "lethal trifecta" | ✓ but too wide: reading your own Notion blocks every form. **This ADR: the web, a check and other accounts still do** |

Shipify's grant is narrower than a Claude Code routine's: a form fixes its target, caps the text
and limits how many calls a run makes. A routine there gets a whole connector.

Sources: [Claude Code routines](https://code.claude.com/docs/en/web-scheduled-tasks) ·
[n8n: human review for AI tool calls](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools) ·
[OpenAI's Agents SDK and `require_approval`](https://www.speakeasy.com/docs/mcp/build/integrate/agents/using-openai-agents-sdk-with-gram-mcp-servers) ·
[the lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)

## What was found (checked 2026-10-10, `main` at `3974a6b`)

| Fact | How it was checked |
|---|---|
| A `yes` from a chat is refused, and the reply links GitHub | `cli/contracts/words.ts:20-24` (`where: "github"`); `cli/kernel/decide.ts:1388-1399` (`yesOrNo`) |
| Any words besides `yes` and `no` drop a waiting list and its notes | `decide.ts:476-487` |
| The agent's quick answers are buttons that send their words; on #317 one of them dropped the list | `words.ts` (`replyButtons`); `decide.ts:2041`; the reply of 08:38 |
| The agent's copy of the list and the box's both show | `decide.ts:1969` (`text += callList(calls)`); the reply of 08:38 |
| Telegram cuts a long reply from its end, and the list is always last, so the list is what it cuts | `edge/src/channels/telegram.ts:237` (`shorten`, `MAX_SENT` 3,500); Telegram takes 4,096 characters a message |
| A Telegram button carries at most 64 bytes of words (`callback_data`); `yes 1a2b3c4d` is 12 | `telegram.ts:66` (`MAX_WORDS`) |
| Each tap is an update of its own, written once by its id, so a second tap of the same button is a second message | `edge/src/channels/telegram.ts:174-190` (`tapOf`); `edge/src/door-in.ts:536-555` |
| Any look call (`notion.search`) counts as outside content, as the web does. Then a `pre` form never counts, the run's notes wait for a `yes`, and its reply's images are made inert | `cli/kernel/think.ts:700-704`; `decide.ts:1733, 1952, 1976` |
| A `pre` form is `call`, `fixed`, `caps` and `max`. An argument neither fixed nor capped fails it, but nothing makes a form fix its target. `tools.json` sets no `pre`, and Notion has no `args` | `cli/lib/plugins/tool.ts:85-93`; `decide.ts:2107` (`preApproved`); `tools.json` |
| Notion's act calls only create a page or set properties. A page's text becomes text blocks (headings, lists, paragraphs), with no image, embed or link that fetches, and nothing deletes | `tools/notion/server.ts:170-252`; `tools/notion/notion.ts:280` (`toBlocks`) |
| A door comment edited after it was written stops being the door's, so it's ignored | `cli/kernel/snapshot.ts:58-77` (`unedited`, `authorOf`) |
| Only your ids write through the door: Telegram's secret header and a private chat whose id is in `SHIPIFY_PEOPLE`; the web chat behind Access, its posts proved by an HMAC only the Worker makes. Everyone in `SHIPIFY_PEOPLE` already speaks as you | [door.md](../door.md); [security.md](../security.md) ("The web chat"); `decide.ts:111` (`isYou`) |
| A fresh `yes` or `no` with no task is answered by the door, and nothing is written | `edge/src/door-in.ts:376` (`ONLY_ACK`) |
| A list's fingerprint is 16 hex characters of its calls' SHA-256 | `cli/kernel/keys.ts:20` |
| The web chat refreshes by itself (every 5 s while a run works, 10 s while your words wait for one, 30 s otherwise, never while hidden) and when you come back to it (`wake`). It has no button for it; dragging down is the browser's reload of the whole page | `edge/public/admin/chat/app.js:1191-1224` |

## Options

**How a `yes` from your chat proves it's you:**
- **A. A passkey per approval:** Approve opens a page behind Access that signs the exact list with
  your phone's passkey, checked against a public key kept in the repo. (+ a stolen chat or
  Cloudflare account can't approve / − much more code, a key to set up, and a passkey in Telegram's
  own browser unproven)
- **B. Trust the chat:** a `yes` from your chat counts as one on GitHub does. (+ a few lines, one tap
  / − whoever holds your Telegram or your Access sign-in can approve changes through your tools)
- **C. Keep GitHub:** fix only the buttons and the double list. (+ nothing new to trust / − every
  approval is still a trip to GitHub, which is what the owner asked to end)

**How a routine gets to use a tool:**
- **A. A form names the tools it still counts after reading (`after`).** (+ said in the file you
  merge; the web, a check and other accounts still block it / − one more field)
- **B. A form's own tool never blocks it.** (+ no field / − a Notion form would count after Notion
  reads with nothing in the file saying so)
- **C. Permissions per recipe.** (− two places that grant; `tools.json` stays the one, ADR 0031)
- **D. `for: "recipes"`: only a recipe's runs may use a form.** (− with a chat `yes` trusted, it
  guards nothing a chat can't already do)

## Decision

Chosen **B** for the chat (the owner's choice) and **A** for routines: the fewest changes that make
both work.

### 1. A `yes` counts from your chat

- **`yes` is taken anywhere,** like `no` (`words.ts`), and decide drops its chat refusal.
- **The rules stay:** the whole message, unedited, after the list, within a day, with no edit to the
  task since. One tool per list. It approves exactly the list: its calls, and the notes a run that
  read outside content left waiting.
- **What stays on GitHub:** merges, `go`, `publish`, `preview`, `start over` and the Operate form.
  Those act on code or deploy it. A `yes` only makes calls through a tool's act key, and writes
  notes to your notebook.

### 2. Under a list, only Yes and No

- **A reply with a list carries its code** on its reply line (`list`: the first 8 characters of the
  fingerprint of all it lists, its calls and its notes, kept with the list as it waits).
- **Every chat shows two buttons under it:** **Yes**, which sends `yes <code>`, and **No**. The
  agent's quick answers and the words its reply names are hidden while the list waits.
- **Yes and No come only from a list,** never from a reply's words: a `yes` in backticks is no
  button.
- **`yes <code>` counts only for the list with that code,** so a Yes under an older reply can't
  approve a newer list. A typed `yes` approves the list that waits, as on GitHub. GitHub takes both.
- **`yes <code>` with no list waiting** (done, dropped, expired or replaced) is answered by the box,
  with no agent: that list isn't waiting any more, and nothing was changed. A plain `yes` with
  nothing listed stays words for the agent, as now.
- **Other words still drop the list,** and the next run lists again whatever still stands.

### 3. You see what you approve

- **The list shows once.** Decide removes any copy the agent wrote, from the list's heading on, and
  the playbook says the box adds it.
- **The list is last and whole in every chat.** A chat may shorten the words above it (Telegram's
  3,500 characters), never the list. The adapter splits the reply at the list's heading
  (`LIST_HEAD`, in `cli/contracts/`).
- **One limit for every chat:** a list over 3,000 characters (`LIST_MAX`, in `cli/contracts/`; a long
  page's text) gets no Yes or No in a chat. Its reply says to approve it on GitHub, with the link,
  and a `yes` to it from a chat is refused with the same words. Telegram then has 500 characters
  left for the words above. The core names no channel: the rule is GitHub or not.
- **The heading says where:** "**To do after your `yes`** (tap Yes, or say `yes`, within a day)".

### 4. A routine that writes through a tool is one PR

1. **You ask in words:** "every weekday at 8, read my Tasks and write today's plan under Daily".
2. **The run looks first** (the read key) to find the pages, then asks for a work run on shipify.
3. **That run writes one PR:**
   - `recipes/<name>.md`: when, and the job, naming the exact ids its calls use;
   - the narrowest `pre` form in `tools.json`: the target fixed, the text capped, `max: 1`, and
     `after` naming the tools the job reads.

   ```json
   "pre": [
     { "call": "create_page", "fixed": { "parent": "<Daily's id>" },
       "caps": { "title": 200, "content": 4000 }, "max": 1, "after": ["notion"] }
   ]
   ```
4. **The PR says in plain words what the routine may change by itself:** "one page a day under
   Daily: a title of up to 200 characters and up to 4,000 of text". Your merge approves both.
5. **A recipe still holds no permission of its own:** `tools.json` stays the one place.
6. **Anything beyond the form** (a second page, longer text, another target) is listed for your
   `yes`, which is now one tap in the chat.
7. **A routine that only reads and tells you** needs no form: a repeat in words, as now.

### 5. Reading your own tools no longer blocks a form

- **Think records two things** beside `readOutside`:
  - `looked`: the tools whose look calls the run made (`["notion"]`, from the calls' names);
  - `elsewhere`: whether it read anything else from outside: the web or a command that fetches (as
    each agent's adapter says), a check, or a read profile.

  `readOutside` stays their sum, with the same meaning.
- **A form with `"after": ["notion"]`** counts in a run whose `looked` are all in its `after`. It
  never counts after `elsewhere`, on another account, or when the agent says `read_outside`. The
  playbook now asks for `read_outside` only after a web page, since the box counts tool reads itself.
- **A form with no `after`** counts only in a run that read nothing from outside, as now.
- **Notes and images stay as strict as now:** a run that read any tool's content still lists its
  notes for a `yes`, and its reply's images are inert (both read `readOutside`).
- **Each name in `after` is a tool** in `tools.json` with look calls (the tools test).

### 6. A form fixes its target

- **A tool names each act call's target** in its `args`: Notion's `create_page` is `parent` and its
  `update_page` is `page`.
- **The tool contract refuses a form** whose call names no target, or which doesn't fix it. So no
  form can write wherever a capped string points.
- **Notion's entry gets its two targets now.** No form is set until your first routine adds one.

### 7. A refresh button in the web chat

- **A small ↻ in the header:** left of **New chat** on the list, and in a thread's and a page's
  header.
- **A tap does what coming back to the page does** (`wake`): what's on screen is read at once, and a
  newer version of the page loads if nothing is typed. It spins until the read ends. What you've
  typed stays.
- **Dragging down stays** the browser's own reload.

## What you accept

- **Whoever holds your Telegram account, your Access sign-in or your Cloudflare account** (the edge
  holds the door's key) can approve a list. A list is calls to your tools only. Today that's Notion:
  creating pages and setting properties on the pages connected to the write integration. It can't
  delete anything, and Notion keeps page history. They could already start runs and PRs as you, and
  they still can't merge, deploy or run an operation.
- **So:** turn on Telegram's password (Settings → Privacy and Security → Two-Step Verification), and
  keep the Access sign-in to your own email.
- **Each routine's form:** a page someone else wrote that the routine reads (a shared page, a web
  clip) could steer what it writes, but only within the form: its one target, its caps, its
  `max`. Keep the target private. What it writes is text blocks only, so the form isn't a way out.
- **Unchanged:** the agent's open web is still the way out for anything it reads (the firewall is on
  the [roadmap](../roadmap.md)). This ADR doesn't widen it.

## Edge cases

- **Telegram sends a tap again:** the door writes an update once, by its id.
- **Yes tapped twice:** two messages. The first makes the calls, and the second finds nothing
  waiting and is answered. Nothing is made twice.
- **Yes and No both tapped:** the newer decides, as now.
- **A Yes under an older reply, with a newer list waiting:** refused. The list that waits is the
  newest reply's.
- **A Yes after a day:** `approval-expired`, as now.
- **A Yes after other words:** those words dropped the list, so the Yes finds nothing waiting and
  says so.
- **A fresh `yes` with no task in Telegram:** the door answers it and writes nothing, as now. Tap
  Yes, reply to the list, or send `#12 yes`.
- **An edited message:** not read, as now. A door comment edited later isn't the door's.
- **A list of notes only** (a run that read outside content proposed notes): the same Yes and No.
- **Someone else in `SHIPIFY_PEOPLE`:** everyone there already speaks as you, and their Yes approves
  too. It's for your own ids.
- **A routine's call with the id written another way** (a link instead of the id): it doesn't fit
  the form, so it's listed for your `yes`. The recipe names the exact id the form fixes.
- **A routine's call that fails** (Notion down, the page moved or not shared with the write
  integration): a ✗ line with Notion's answer, as now. The next run tries at its time.
- **A routine run that read the web or ran a check:** its calls wait for your `yes`, as now.
- **A list too long for a chat:** no buttons, and its reply links GitHub.
- **↻ while offline:** the "Offline" bar, as now. It reads again once the page is online.

## Setup

Nothing new to set up.
- **For a routine,** ask in words, then merge its PR.
- **Notion:** connect both integrations (read, and read and write) to one parent page, so every page
  under it can be read and written.
- **Telegram:** turn on its password (Two-Step Verification).

## Docs and clean-up

The build updates each of these in the same PR:

- `README.md`: "You approve on GitHub" and the table's tool row (read the calls, tap Yes).
- `AGENTS.md`: the channels row ("approvals stay on GitHub") and the tools row (a routine that
  writes is a recipe and its form in one PR).
- `docs/design.md`: rule 6 becomes "**Approvals are yours:** your merge, on GitHub; or your whole,
  unedited `yes` to a list, from GitHub or your chat. `go`, `publish`, `preview` and `start over`
  stay on GitHub."
- `docs/security.md`: "In short", "Write keys come after the agent" (`after`, `looked`,
  `elsewhere`), "Approvals only on GitHub" (renamed "Approvals"), the web chat's "Approvals stay on
  GitHub", and "What you accept" from above.
- `docs/channels.md`: the Approvals rows of both tables, the Telegram table's `yes` row, "Approvals
  stay on GitHub", the web chat's buttons and its refresh line.
- `docs/tools.md`: the example at the top, the steps (a `yes` from anywhere, Yes and No), "A `yes`
  from a chat", "Pre-approved calls" (`after`, a fixed target), and the troubleshooting row.
- `docs/recipes.md`: the "May change" row, a new "A recipe that writes" section, and "Safe by
  design". `recipes/README.md`: "What it may change".
- `docs/tasks.md`: the fixed words' table and "Your `yes`".
- `docs/glossary.md`: **fixed words**, **yes**, **pre-approved call** and **channel**.
- `playbooks/task.md`: what only the owner does, "Tools" (the box adds the list and its buttons:
  don't copy it or ask about it), "Recipes" (one PR, recipe and form), and `read_outside` (a web
  page).
- `skills/notion/SKILL.md`: looking up ids for a routine, and writing its narrowest form.
- `tools.json`: Notion's targets, and Telegram's description ("where you approve").
- `cli/contracts/answers.ts`: the comment on a lone `yes` or `no`.
- `CHANGELOG.md`.

Nothing becomes obsolete: the `not-allowed-here` problem stays for `go`, `publish`, `preview` and
`start over`.

## Build plan

One PR, about 120 lines of code besides the tests and docs:

| Part | Where |
|---|---|
| `yes` anywhere, with an optional code; Yes and No only under a list | `cli/contracts/words.ts` (`WORDS.yes`, `replyButtons`, `asked`) |
| The reply line's `list`; `LIST_HEAD` and `LIST_MAX` | `cli/contracts/lines.ts` |
| The chat refusal goes; the code matches; nothing waiting is said; a long list stays on GitHub; the agent's copy goes; the heading; `after` | `cli/kernel/decide.ts` (`yesOrNo`, the calls, `callList`, `preApproved`) |
| Two problems: the list isn't waiting, and the list is too long for a chat | `cli/contracts/problems.ts` |
| `looked` and `elsewhere` | `cli/kernel/think.ts`, `cli/kernel/types.ts` (`ThinkMeta`) |
| `after`; each act call's `target`, which a form must fix | `cli/lib/plugins/tool.ts`, `cli/kernel/snapshot.ts` (`toolActs`), `tools.json` |
| The list last and whole; the words above shortened | `edge/src/chat.ts` (`outgoingOf`), `edge/src/channels/channel.ts` (`Outgoing`), `edge/src/channels/telegram.ts` |
| ↻ | `edge/public/admin/chat/app.js`, `app.css` |

## Tests

- `tests/words.test.ts`: `yes` is a chat word; Yes and No only under a list; a `yes` in backticks
  is no button; the agent's quick answers are hidden while a list waits.
- `tests/kernel-decide.test.ts`:
  - a chat `yes` makes the calls;
  - `yes <code>` for another list is refused;
  - `yes <code>` with nothing waiting is answered with no agent;
  - a chat `yes` to a list over `LIST_MAX` is refused, while a GitHub `yes` makes it;
  - the agent's copy of the list is removed, and the reply line carries `list`;
  - an edited door comment approves nothing;
  - `go`, `publish`, `preview` and `start over` from a chat are still refused;
  - a form with `after: ["notion"]` counts after Notion reads, but never after the web, a check,
    another account or the agent's `read_outside`, and a form with no `after` keeps today's rule;
  - notes after a Notion read still wait.
- `tests/tools.test.ts` (and the tool conformance test): a form that doesn't fix its call's target
  is refused, and `after` names a tool with look calls.
- `tests/telegram.test.ts` and `tests/edge/telegram.test.ts`: a 3,000-character list with long words
  above fits Telegram's 4,096 whole and last, and the Yes and No keys fit 64 bytes.
- `tests/edge/web/`: the web chat shows the same buttons, and the page has ↻.
- `tests/kernel-flow.test.ts`: its test "makes a tool's change only on your yes on GitHub: never a
  chat's …" turns round. A Yes through the door (`yes <code>`, from Telegram) makes the fake `jot`
  call once and replies ✓, and a second Yes makes nothing.

## Consequences

- **Easier:** one tap approves, in the chat you're in. A routine that reads and writes your Notion
  runs by itself, approved once by a merge. Each list shows once, whole, with only the buttons that
  fit it. The web chat refreshes with a tap.
- **Harder:** your chat account now approves calls through your tools: protect it as you protect
  GitHub. A tool's contract grows two fields (`after`, `target`), and think records two more facts.

## Confirmation

- The tests above, in `pnpm verify`.
- `pnpm ship selftest chat` still passes.
- Live, once it's built: ask for the test quote in Telegram, tap Yes, and the reply shows ✓ with
  Notion's link. Then set up one small routine and merge its PR. It writes its page at its next time
  with no tap.

## As built (2026-10-10)

Built in one PR on task #317, as planned, with these details settled:

- **The reply line's `list`** is the code (8 hex characters), or `github` for a list over
  `LIST_MAX`: no buttons, and a chat shows the list's heading alone, which says to approve it on
  GitHub.
- **The list is one block:** its heading, then a numbered line per call and per note ("Note in
  Preferences: …"), with no blank line, so a chat finds its end (`splitList`). It covers all that
  waits, which is what a `yes` approves, and decide puts it last in the reply's words. Its code is
  worked out from what waits, so nothing more is kept.
- **A Yes for another list among your words** counts for nothing, and the newest of the rest
  decides (a No, then an old Yes: the No drops the list).
- **A "Yes" or "No" among the agent's quick answers** is never a button, with or without a list:
  tapped later, it would answer whichever list waits then.
- **↻** spins with a class on the page (`spin`), so a header drawn again while it reads keeps
  turning; its rule sits last in the stylesheet.
- **The agent's `read_outside`** is now for a web page only (the playbook, the prompt and the
  Notion skill say so): the box counts tool reads itself, and the agent's own `read_outside` still
  stops every form.
- **Later (#330, 2026-10-11, corrected 2026-10-13):** `update_page` took `content`, which replaces a
  page's whole body, so "can't delete anything" in [What you accept](#what-you-accept) no longer
  holds: an approved list can delete a page's text blocks. It never deletes a page (subpages and
  sub-databases are kept, and a page with a block holding others is refused before anything
  changes), Notion keeps page history, and the call's list line says "replaces the page's whole
  body" (the tool's `args.<call>.warn` in `tools.json`). `docs/security.md` says so.
