---
status: proposed (the owner's requests of 2026-10-05: a clean admin page with links, health and status behind Access; recipes back; chat channels as clean plug-ins; "remember" from any channel, followed by every run; one vocabulary, OS-style; every block behind one interface, developed on its own and able to scale; the same things from every channel; clean, secure, efficient; each part researched first, built as small blocks, the core unchanged; merging its PR accepts the design and its build plan)
date: 2026-10-05
amends: 0031 (recipes return, as files that run as repeats; the door's chat code moves behind an adapter; the notebook gains `forget:` and `/notebook`; "recipe" leaves the glossary's gone list)
---

# 0032: Shipify 0.2: a status page, chat adapters, a notebook runs follow, and recipes as files

## Read this first

0.1 works end to end. This release adds four things you asked for, and changes nothing in how a
run works: **plan → think → apply** stays, GitHub stays the record, the agent still only thinks,
and your apps don't change.

1. **A status page:** one clean page at `shipify.app.a69x.in/status`, behind Cloudflare Access. It
   shows your apps with links and health, your boxes, what needs you, what's coming up, recent
   alerts, key dates, and links to everything. It's read-only, built from what the watch already
   records, and needs no new keys or stores.
2. **Chat adapters:** Telegram's code moves behind one small interface in the edge. A second chat
   becomes one file plus one line, held to one conformance test. Telegram behaves exactly as now.
3. **A notebook every run follows:** `remember: …` and the new `forget: …` work the same from
   GitHub or any chat, and `/notebook` shows what's kept. Your Preferences page goes into every
   run whole. One line in the prompt says what wins when instructions disagree.
4. **Recipes, as files:** a recipe is a repeat written as a file in `recipes/`. Merging the file
   approves it, and the due run keeps it running. There's no second engine: a recipe runs exactly
   like a repeat. A few examples ship to copy.

Four threads run through all four parts:
- **One vocabulary:** every part has one name, used the same way in the code, docs, CLI, chat and
  the page, each next to the OS idea it matches ([The vocabulary](#the-vocabulary)).
- **Every block, one interface:** each kind of block has one contract, one conformance test and
  one line on how to add another, whether it's an agent, tool, channel, stack, box, check or
  recipe ([Every block, one interface](#every-block-one-interface)).
- **Each block developed on its own:** four rules, checked by a test, keep blocks independent. The
  system scales out by adding boxes, within free-plan limits stated plainly
  ([Built to grow](#built-to-grow-independent-blocks-and-scale)).
- **The same things from every channel:** what you do on Telegram works on a GitHub issue too,
  with the same words and answers. Only approvals stay GitHub-only
  ([Every channel can do the same things](#every-channel-can-do-the-same-things)).

What you notice:

| | 0.1 | 0.2 |
|---|---|---|
| Seeing everything at once | the status task on GitHub, `/ping`, `/apps` | also one page at `/status`, from any browser you're signed in on |
| A second chat (Slack, WhatsApp…) | edits across six edge files | one adapter file and one line, held to the channel test |
| "Remember that…" | `remember:` writes a line | also `forget:`, `/notebook`, a link in every "Noted" reply, Preferences in every run whole |
| An automation you want kept | a repeat set in words: unreviewed, and it stops when its task closes | a recipe: a reviewed file, versioned, restarted by the due run, shown on the page |
| `/ping`, `/apps`, `/help` on a GitHub issue | read as plain words, so an agent runs | the same answer as in a chat, with no agent |
| Adding a block | each kind has its own way, and channels had no contract | every kind: one contract, one suite, one registry line; a test fails the build if a block reaches past its contract |
| A repeat set in words | ran at most once (fixed in 0.1.9, [#149](https://github.com/aayush-t-apps/shipify/pull/149)) | keeps running |

**What stays the same:** the run's shape, the record, the approvals (your `yes` or your merge), the
agent's sandbox, the door's routes, Telegram's webhook, the keys, and every app.

## The vocabulary

One name per part, everywhere. The **Like** column is the closest idea from an operating system or
a well-known system. It's there to make each part easy to place, not as a promise that it behaves
the same in every detail. Words new in 0.2 are marked **new**.

| Shipify word | Like | What it is |
|---|---|---|
| **the record** | the filesystem and its journal | everything Shipify knows, on GitHub |
| **task** | a session: one conversation | one issue: your words, its replies, and everything they lead to |
| **run** | a process | one job on one task: plan, think, apply |
| **the core** (`cli/kernel`) | the kernel | decides what a run does, and makes its changes: replies, PRs, notes, approved calls |
| **the agent** | an unprivileged user program | Claude Code, as its own Linux user: it reads and suggests |
| **box** · **slot** | a machine · a CPU core | where runs happen · one run at a time |
| **sandbox** | a user account with least privilege | the agent's own user and a fresh folder per run |
| **the queue** | the scheduler's run queue | GitHub Actions' runs waiting for a slot |
| **the edge** | the front door of a network | one Cloudflare Worker: the door, the watch and the status page |
| **the door** | a gateway | the edge's way in (your words onto tasks) and out (replies to chats) |
| **the watch** | cron plus a supervisor | the edge's check every 5 minutes: what's due, what's stuck, what failed |
| **channel** | a terminal: where you type | a way you and Shipify talk: GitHub (always), Telegram |
| **adapter** | a device driver | the one file that plugs a channel or an agent in, behind one interface |
| **out-only channel** **new** | a printer: output only | a channel that only receives replies (a Notion page, an Obsidian vault): an adapter with `send` alone |
| **registry** **new** | the driver table | the one list where the core finds each kind's blocks (`channels/index.ts`, `agents/index.ts`, `tools.json`) |
| **message** **new** | an input event | what a channel hands the door, in one shape for every channel |
| **reply** | a program's output | the one way out: a run's comment, copied by the door to your chats |
| **plug-in** | a driver or a package | a tool, channel, stack or agent, each held to its conformance test |
| **conformance test** | a driver certification suite | the one test every plug-in of a kind must pass |
| **tool** · **look** · **act** | a device · read · write | one of your apps a run can use · calls that read · calls that change, made by the box |
| **yes** | `sudo` for one command | your approval of the exact calls listed |
| **pre-approved call** | a `sudoers` rule | a call `tools.json` allows with no `yes`; merging that file approves it |
| **repeat** | a `crontab` entry | a task with a time, set in words or by the Repeat form |
| **recipe** **new** | a unit file in `/etc/cron.d`, under version control | a repeat written as a file in `recipes/`, approved by merging |
| **example** **new** | a sample config to copy | a recipe in `recipes/examples/`: not live until copied into `recipes/` |
| **check** | a health probe | a reviewed script, `checks/<name>.mjs`, that prints one value to watch |
| **notebook** | your dotfiles | what Shipify remembers about you: pages on GitHub, read by every run |
| **skill** · **playbook** | a man page · a runbook | how to do a kind of work well · the steps for one job |
| **status task** | `/proc` and the system log | the record the watch keeps: boxes, apps, coming up, recent events |
| **status page** **new** | a dashboard such as `htop` | a read-only view of the status task and its links, behind Access |
| **problem** | an error number with its message | an error in one shape: what happened, and the one thing to do |
| **selftest** | the power-on self-test | `ship selftest`: each part's live check, end to end |

**Words that change:**
- **"recipe"** comes off the glossary's gone list, with the one meaning above.
- **"template"** stays gone: a recipe to copy is an **example**.
- **"channel" in the CLI** (`cli/lib/plugins/channel.ts`, a 1.x leftover) is removed. The word
  means only the chat-and-GitHub sense above.

The build updates `docs/glossary.md` with this **Like** column, and checks the code, CLI help,
chat replies and the page use these words.

## Every block, one interface

Shipify is built from blocks: the core in the middle, and around it every way in, every way out,
and every provider. Each kind has:
- one contract, written in code;
- one conformance test that every block of that kind passes;
- one line on how to add another.

The core names no block; it works only through these contracts. `ship plugins` prints this table
from `cli/lib/plugins/index.ts`, and `ship selftest` checks each part live. 0.2 brings the one
kind that was only documented (channels) up to that standard, and adds the two file-based kinds
(checks and recipes) to the list.

| Kind | In | Out | Contract | Test | Add one |
|---|---|---|---|---|---|
| **record** (provider: GitHub) | a task's reads and writes | tasks, comments, labels, runs | `cli/lib/plugins/record.ts` | `tests/plugins/record.test.ts` | a file like `github.ts` |
| **agent** (Claude Code) | a prompt, a model, look tools | a result in its schema, a report, usage | `cli/lib/plugins/agent.ts` | `tests/plugins/agent.test.ts` | an adapter in `cli/lib/agents/` and an `executors.json` entry |
| **tool** (Notion) | look and act calls | MCP results | `cli/lib/plugins/tool.ts` | `tests/plugins/tool.test.ts` | `tools/<name>/` and a `tools.json` entry |
| **channel** (Telegram) **contract new** | a webhook, as a `Message` | an `Outgoing` reply, rendered and sent | `edge/src/channels/channel.ts` | `tests/edge/channels.test.ts`: one suite for every adapter | an adapter in `edge/src/channels/` and one registry line |
| **stack** (Cloudflare Workers) | a project's code | `make` targets, a deploy, `/health` | `docs/design.md` | `tests/golden.test.ts` | a folder in `stacks/` |
| **box** (the Pi) | runs, by label | replies through the run | `docs/box-setup.md` | `ship doctor` | `ship box add` |
| **check** **listed new** | nothing: no keys, no input | one value on stdout | `checks/README.md` | a test that runs every check in the sandbox and reads one value | `checks/<name>.mjs` in a PR |
| **recipe** **new** | its file: `when`, `check`, `model`, a body | a repeat on its task | `cli/lib/recipes.ts` (its schema) | a test that every file in `recipes/` and `recipes/examples/` reads | `recipes/<name>.md` in a PR |

**The shapes between blocks** live in `cli/contracts/`, tested by `tests/contracts.test.ts`, one
each:
- **in:** the from-line, who said it and from where;
- **out:** the reply line, its kind and the chats it goes to;
- **files:** one shape either way;
- **errors:** a problem, what happened and the one thing to do;
- **logs:** one line shape.

A channel's `Message` turns into a from-line and a comment, and a reply line turns into an
adapter's `Outgoing`. So every way in and every way out meets the core in the same two shapes,
whatever the provider.

## Built to grow: independent blocks, and scale

### Each block developed on its own

| From | We take | We leave out |
|---|---|---|
| **Ports and adapters** ([Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)) | the core talks only to ports (our contracts); every outside thing is an adapter behind one | layers of abstraction for parts that have one implementation |
| **Backstage** ([architecture](https://backstage.io/docs/backend-system/architecture/index)) | plug-ins never import each other | its service registry and dependency injection |
| **Fitness functions** (*Building Evolutionary Architectures*; [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)) | the rules are a test that fails the build, not a hope | a new dependency: a short test reads the imports |

**Four rules,** checked by a new `tests/architecture.test.ts` on every `pnpm verify`:
1. **A plug-in imports only its kind's contract and `cli/contracts/`:** never the core and never
   another plug-in.
2. **The core never names a plug-in.** It finds them through a registry (`agents/index.ts`,
   `channels/index.ts`, `tools.json`, `executors.json`, the stacks folder).
3. **Contracts carry a version** (`v` on every line shape, as today). A breaking change bumps it and
   updates the kind's conformance test in the same PR.
4. **A plug-in is tested alone,** from fixtures, by its kind's suite, with no live system. `ship
   selftest` then checks it live.

So adding or changing a block touches its own folder, plus one registry line for a new one, and
the suite tells you whether it fits. Nothing else changes, and nothing else needs to be understood.
Plug-ins stay folders in this repo, not separate packages: one person, one repo, one `pnpm verify`.
Splitting one out later is possible, since it imports only contracts, but nothing needs it yet.

### Scale, honestly

No system scales without limit. This one scales **out**: every part except the record keeps no
state, so growth means more of the same part, not a redesign. The limits are GitHub's and
Cloudflare's free-plan numbers, far above one person's use:

| Part | Grows by | Its limit | Near the limit |
|---|---|---|---|
| **Runs** | more slots on a box, more boxes (`ship box add`): each takes runs by its labels | your machines; a task's runs go one at a time by design | add a box; runs queue meanwhile |
| **The edge** | Cloudflare runs as many copies as needed; it keeps no state | free plan: 100,000 requests a day (today about 300 a day: the watch's ticks and your messages) and 50 subrequests per request (the watch already budgets them: `budgeted()`) | the watch splits its duties across ticks |
| **The record** | GitHub | the door App: 5,000 API calls an hour; a run's token: 1,000 an hour per repo | the page's 60-second cache and the watch's budget keep well under it |
| **Channels, tools, agents, stacks, recipes** | one more adapter, entry, folder or file each | none of their own: each one adds only its own calls | — |

## 1. The status page

### What we borrow

| From | We take | We leave out |
|---|---|---|
| **Atlassian Statuspage** ([components](https://support.atlassian.com/statuspage/docs/what-is-a-component/)) | a banner on top, one row per app with its state as a symbol and a word, incidents newest first, an "as of" time | subscriptions, incident write-ups, history graphs |
| **Cloudflare Access on one path** ([app paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)) | an Access application on `shipify.app.a69x.in/status` only; the door's routes, which other services call, stay reachable | Access on the whole Worker, which would block Telegram's webhook |
| **Cloudflare's "validate the JWT"** ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)) | the Worker checks the `Cf-Access-Jwt-Assertion` token itself: signature against your team's keys, this application's audience, the issuer and the time. A missing or wrong Access rule then fails closed | trusting the path rule alone |
| **shipify-admin's `access.ts`** (1.x, in production for weeks) | that same check, about 90 lines on Web Crypto with key rotation handled. It's moved over, not rewritten, and needs no new dependency | the React app, its JSON API and its build step |
| **OWASP headers** ([cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)) | a strict CSP (no scripts), `nosniff`, `no-referrer`, `frame-ancestors 'none'`, `Cache-Control: private, no-store` to the browser | — |

### Decision

**One route, `GET /status`,** in the edge. It serves one server-rendered HTML page with no
JavaScript:
- **Access** protects that path (one application, using your existing `allow-me` policy).
- **The Worker checks Access's token** on every request. With no token, a bad one, or the page not
  set up, it answers 403 and shows nothing.
- **Anything that isn't a GET** gets 405. The page reads; it never writes.
- **`/`** redirects to `/status`, so the bare address opens the page.

**What it shows**, top to bottom. It's the old admin page's useful part, minus runs over seven days
and deploy history, which GitHub's Actions page already shows and the page links to:

| Section | From | Shows |
|---|---|---|
| **Banner** | all below | "All good", or what's wrong in one line ("spotter is failing · homepi is offline") |
| **Needs you** | open tasks labelled `needs you` | each task with its title, linked |
| **Apps** | the status record's apps, as the watch last checked them | name, link, ✓ up / ✗ failing / ⏸ paused, and when it was checked |
| **Boxes** | the status record's boxes | name, online or offline, last seen, slots |
| **Coming up** | the status record's upcoming list | repeats and recipes, each with its next time, linked to its task |
| **Recent** | the status record's events | the last 10 alerts and what the watch did, newest first |
| **Upkeep** | `SHIPIFY_KEY_DATES` | each key and the days left, amber under 30 days |
| **Notebook** · **Recipes** | the notebook's pages · the recipes | titles, linked |
| **Links** | settings | GitHub tasks, the status task, Actions, each app's repo, docs |
| **Footer** | the edge | Shipify's version and commit, "as of" time |

**How it reads, cheaply:**
- **About three GitHub reads per view:** the status task, the open tasks that need you, and the
  notebook's pages, all with the door App's read access.
- **Kept in the Cloudflare cache for 60 seconds**, the same `share()` the door uses to dedupe, and
  looked up only after the token check passes.
- **No health checks per view:** app health is the watch's last check, with its time.
  `/apps` in a chat still checks live.

**Setup**, guided by one command: `pnpm ship door page`.
- It walks you through the Access application in the dashboard, step by step, then asks for two
  values that aren't secret: your team's address and the application's audience tag.
- It saves them as one repo variable, `SHIPIFY_ACCESS`, which the edge reads at runtime like its
  other settings, so no redeploy is needed.
- It checks that `/status` with no sign-in sends you to Access's login, and says what to fix if
  not.

### Security

- **Two locks:** Access's sign-in, and the Worker's own token check, which fails closed.
- **Nothing to steal:** the page holds no key and has no forms or scripts, and every GitHub string
  is HTML-escaped.
- **Free:** Cloudflare Zero Trust's free plan, which you already use for the links admin.

## 2. Chat adapters

### What we borrow

| From | We take | We leave out |
|---|---|---|
| **Vercel's Chat SDK** ([building an adapter](https://chat-sdk.dev/docs/contributing/building), [testing](https://chat-sdk.dev/docs/contributing/testing)) | an adapter verifies the webhook first, then parses it into one normalized message; one neutral format (Markdown) that each adapter renders; recorded webhooks as test fixtures | its state adapters, thread locks, cards, modals, streaming, reactions |
| **Errbot backends** ([base](https://raw.githubusercontent.com/errbotio/errbot/master/errbot/backends/base.py)) | Markdown in, rendered per backend; a test backend for core tests | presence, rooms |
| **Rasa connectors** ([custom](https://rasa.com/docs/rasa/connectors/custom-connectors/)) | only text sending is required; files are optional | NLU |
| **Bot Framework's Activity** ([schema](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference)) | one message shape with the channel's id, the sender, reply-to and files | the full schema and `channelData` |
| **Matrix** ([spec](https://spec.matrix.org/v1.11/client-server-api/)) | a plain-text fallback for every formatted message | — |

### Decision

**The interface**, in `edge/src/channels/channel.ts`:

```ts
interface Channel {
  id: string; // "telegram": the word in from-lines, reply targets and /door/<id>
  ready(env: Env): boolean; // its secrets are set
  verify?(req: Request, env: Env): Promise<boolean>; // the webhook really came from it
  parse?(body: string): Message | null; // null: not a message; acknowledge and ignore
  send(env: Env, chat: string, out: Outgoing): Promise<Sent>; // render and deliver one reply
  file?(env: Env, ref: string): Promise<File>; // fetch a file the person sent
  health?(env: Env): Promise<string[]>; // what the watch should know ("the webhook points elsewhere")
  limits: { text: number; files: boolean };
}

interface Message {
  id: string; // the channel's event id: the dedupe key, with the channel's id
  chat: string;
  user: { id: string; name: string };
  text: string;
  replyTo?: string; // the message this one answers, if any
  files: { ref: string; name: string; type: string }[];
  command?: { name: string; rest: string }; // "/ping", "/notebook Preferences"
}

interface Outgoing {
  text: string; // the reply's Markdown subset: bold, code, links, bullets
  replyTo?: string;
  files?: { name: string; type: string; url: string }[];
}
```

**What stays in the core**, written once for every channel:
- **The door's route,** `POST /door/<id>`: look up the adapter, verify, parse, and dedupe by
  channel and id.
- **Who you are:** `SHIPIFY_PEOPLE`, matched by channel and user id. An adapter only reports the
  user's stable id.
- **The commands** (`/ping`, `/apps`, `/help`, `/notebook`, `/recipes`): answered once, sent
  through the adapter.
- **Writing onto tasks,** `#12` follow-ups, the "thanks" and "yes/no" nudges.
- **Copying replies out:** `to: ["telegram:42"]` picks the adapter, which renders and sends.
- **The watch's resend and guard duties,** each calling the adapter's `send` or `health`.

**What moves:**

| Today | Becomes |
|---|---|
| `telegram.ts`: parsing, the Bot API, rendering, *and* help, ping, apps, `#n` and title text | `channels/telegram.ts` (the adapter only) and `chat.ts` (the shared text and words) |
| `app.ts`: `POST /door/telegram` hard-wired | `POST /door/<id>` from the registry. Telegram's URL doesn't change |
| `door-out.ts`, `files.ts`, `watch.ts`, `settings.ts`: Telegram calls and `telegram:` parsing | calls through the registry; `<channel>:<id>` parsed once |
| `cli/lib/plugins/channel.ts` (1.x leftover) and its test | removed. `githubChannel` keeps its two callers as plain functions in `cli/lib/github.ts` |
| `tools.json`'s unused `telegram.in.door` and `tool.ts`'s unused `send` field | removed |

**The registry**, `edge/src/channels/index.ts`, is one line per adapter:
`export const CHANNELS = { telegram };`

**The conformance test**, `tests/edge/channels.test.ts`, runs the same suite against every adapter
in the registry, from recorded fixtures:
- verify: a good secret passes, a missing or wrong one fails;
- parse: plain text, a file, a reply-to and a command come out right, and an update that isn't a
  message gives `null`;
- send: the Markdown subset renders, a long reply splits at `limits.text`, and files go out when
  `limits.files` allows;
- file, if the adapter has it: a reference fetches the right bytes.

The core's own tests use a **fake channel** that records what it was sent. Telegram's existing tests
stay and must pass unchanged.

### Every channel can do the same things

**The rule:** what you can do from one channel, you can do from every channel, with the same words
and the same answers. Each word, command and answer is defined once:
- the words and commands in `intents.json` and `cli/kernel/words.ts` (0.1);
- the answers' text in one new shared module, `cli/contracts/answers.ts`, which both the door and
  the core use. Today the edge holds that text in `telegram.ts`.

Each channel only renders the answer its own way.

| You can | GitHub | Telegram (and any chat) |
|---|---|---|
| Start a task with words, a title prefix or a form | ✓ | ✓ (forms as `/ask`, `/change` …) |
| Carry on a task | comment on it | reply to its message, or start with `#12` |
| Send a photo or file | ✓ attach it | ✓ |
| `remember:`, `forget:`, `stop repeating`, `resume`, `again`, `close`, `no`, `use <model>` | ✓ | ✓ |
| `/ping`, `/apps`, `/help`, `/notebook`, `/recipes` | ✓ **new:** as a comment or an issue title, answered by a run with no agent in about 30 s, same text | ✓ answered by the door at once |
| Get every reply | ✓ on the task | ✓ copied by the door, shortened, with a link to the task |
| Approve: `yes`, `publish`, `go`, `preview`, `start over`, a merge | ✓ | ✗ by design: approvals stay on GitHub, where your sign-in protects them (ADR 0030) |

**The one deliberate difference is approvals.** A chat account is easier to lose or share than your
GitHub sign-in. So a chat can ask, read and steer, and every approval links you to GitHub.

**The same output, elsewhere.** A channel that only receives replies is an **out-only channel**:
an adapter with `send` and no `verify` or `parse`. Two examples, so the interface is proven to fit
them, but not part of this build:
- **Notion:** each reply appended to a page or a database row, with Notion's key held by the edge.
- **Obsidian:** each reply written as a Markdown note into your vault's git repo, which the
  Obsidian Git plug-in syncs.

A reply names its chats in `to:`, as it does today, so sending one to Notion as well as Telegram
needs no change to the core.

**Adding a channel later** is one file in `edge/src/channels/`, one line in the registry, its
fixtures passing the suite, and `ship add <name>` for its keys and webhook. Two notes for later
chats, from the research:
- **Slack** expects an answer within 3 seconds, so the door acknowledges first and writes in
  `waitUntil`. The interface already allows it.
- **Discord's** ordinary messages only arrive over a long-lived connection, which a Worker can't
  hold, so it would need its slash commands. **Email** arrives through the Worker's separate
  `email()` handler.

These are notes, not part of this build.

## 3. The notebook, followed

### What we borrow

| From | We take | We leave out |
|---|---|---|
| **Claude Code's memory** ([docs](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills)) | a small index always loaded and details on demand; one fact per line; how-to steps belong in skills, not memory | — |
| **ChatGPT and Gemini** ([memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq), [saved info](https://support.google.com/gemini/answer/16413516)) | "remember…" and "forget…" in plain words; a notice with a link each time something is saved; one place to see it all | memory drawn from chat history |
| **Hermes Agent** ([memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)) | `forget` matches one line by its words; several matches remove nothing and list them; exact duplicates refused; checks on each line for hidden characters | its tiny size caps |
| **LangMem** ([concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)) | facts about you are written directly; a change to *how work is done* changes every run, so it gets a reviewed diff | an LLM consolidating on every write |
| **OWASP ASI06, SpAIware** ([OWASP](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/), [SpAIware](https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/)) | memory is an attack surface: only your words go in, and anything a run read elsewhere waits for your `yes` (0.1 already does both) | — |

0.1's notebook already follows most of this:
- pages on GitHub;
- `remember:` with no agent;
- only pages you or a run last edited are trusted;
- keys refused;
- a size limit;
- proposed notes after outside reading wait for `yes`.

What's missing is the rest of the loop, and a live test.

### Decision

**The words**, the same from GitHub or any chat:

| You say | It does | Agent |
|---|---|---|
| `remember: short answers` | adds the line to **Preferences**, dated, and replies "Noted under Preferences: … From your next task." with the page's link | no |
| `remember People: Ana is my designer` | the same, on the **People** page | no |
| `forget: short answers` | removes the one line on any page that contains those words; if several do, lists them and removes nothing | no |
| `/notebook` | lists each page's title, first line and link | no: answered by the door at once |
| plain words in any task ("Priya is my designer") | the agent proposes the note in its result, and the box writes it (0.1, unchanged) | yes |

**How runs follow it:**
- **Preferences first, whole, in every run.** Then the other pages' titles and first lines, then as
  many whole pages as fit in 16 KB. The agent reads the rest on demand (0.1).
- **One line on what wins**, in every prompt: your words in this task come first, then the
  notebook, then defaults. In a project, its `AGENTS.md` wins inside that repo, and the reply says
  when a note was set aside.
- **A note never grants anything:** it can't approve a call, skip a `yes`, or change what a run may
  touch.
- **Newer wins:** each line carries its date, and the prompt says a newer line beats an older one.
- **Hidden characters refused:** a note with invisible or direction-changing Unicode is refused,
  and the reply says why.

**Facts or how-to:**
- **Facts and preferences** about you go in the notebook, written directly.
- **A way of working** ("when you upgrade a stack, always run the canary first") changes how every
  run works. The agent proposes it as a PR to `skills/` or a playbook, and it's live once you merge.
- `playbooks/task.md` and the prompt say this once.

**A live test** ends the step:
- `remember:` from Telegram and from GitHub;
- a question whose answer shows the note followed;
- `forget:`, then `/notebook`.

`ship selftest notebook` gains a live part that writes a dated line to a **Selftest** page and
reads it back through a run's prompt.

## 4. Recipes, as files

### Why they went, and why they can come back

ADR 0031 removed 1.x's recipes because:
- they were a second engine: cases, cards and blocks, about 4,200 lines;
- nothing used them but their own selftests;
- their main source of events was repo webhooks, which you'd ruled out.

None of that applies to recipes as files:
- 0.1's repeats already do the running;
- checks already gate the agent;
- `tools.json`'s pre-approved calls already cover unattended changes.

A recipe adds only what a repeat set in words lacks: **a reviewed file you keep.**

### What we borrow

| From | We take | We leave out |
|---|---|---|
| **GitHub Agentic Workflows** ([frontmatter](https://github.github.com/gh-aw/reference/frontmatter/), [safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/), [security](https://github.blog/2026/03/09/under-the-hood-security-architecture-of-github-agentic-workflows/)) | one Markdown file per automation: settings in the frontmatter, the instructions as the body; the agent read-only, a separate step makes the changes; only files on `main` count | the compile step, the threat-detection job, a firewall: they guard shared repos with strangers' issues |
| **Home Assistant** ([basics](https://www.home-assistant.io/docs/automation/basics/), [blueprints](https://www.home-assistant.io/docs/blueprint/schema/)) | one sentence: *when* X, *if* Y, *do* Z; a condition is a gate, never a branch; ready-made examples to copy | run modes, branching, the visual editor |
| **GitHub Actions schedules** ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)) | the schedule comes from the default branch's latest commit | — |
| **1.x's own recipes** (`git show 27b91c3^:recipes/`) | one task per recipe as its log; `again` runs it now; examples to copy | cases, cards, blocks, hooks, the case engine |
| **Claude Code routines** ([docs](https://code.claude.com/docs/en/routines)) | a saved prompt is never approval for anything during its run | routines living in an account instead of files |

### Decision

**A recipe is a repeat written as a file.** `recipes/daily-brief.md`:

```markdown
---
when: every weekday at 08:30   # a repeat's schedule, in the same words
check: site-down               # optional: checks/site-down.mjs gates it: the agent runs only when its output changes
model: sonnet                  # optional: as a task's model
---
Good morning brief, in five lines at most: what failed overnight, what needs me today, and my
three most urgent Notion tasks. Say nothing if there's nothing new.
```

- **Three settings, all from 0.1:** `when` (required), and `check` and `model` (optional).
- **The body is the job:** what the agent is asked each time. It's read from `main` on the box at
  each run, so it's always the text you merged.
- **One sentence, Home Assistant's shape:** *when* `when`, *if* `check` changed, *do* the body.
  The reply is the notify: every run ends in one, copied to your chats, and a job with nothing to
  say stays quiet (0.1).
- **What it may change:** what any repeat may. That's replies, notes and **pre-approved calls**
  from `tools.json`. Anything else is listed for your `yes` on GitHub. A run that read the web still
  needs your `yes` even for a pre-approved call (0.1). A recipe never carries permissions of its
  own: unattended calls are approved in one place, `tools.json`.

**How it runs**, all on paths that exist:
1. **Merging the file approves it.** It lives on `main`, reviewed like any change.
2. **The watch notices a change:** each tick it reads `recipes/`'s id on `main` (one call) and
   compares it with the one the status record keeps. When they differ, it rings the due run, as it
   does for anything due. This is one more line in its check, and costs no GitHub minutes.
3. **The due run keeps recipes and their tasks in step** (one more duty in its existing check):
   - a new file gets its task, "Recipe: daily-brief", labelled `recipe` and `repeats`, and the
     task's first run sets the repeat from the file;
   - a changed file starts its task's run, which updates the repeat and says so;
   - a removed file ends its repeat and closes its task;
   - a file that doesn't read gets a reply on the status task naming the file and the fix. Nothing
     fails silently.
4. **At each time it runs like any repeat:** the job, or the check and then the job if the output
   changed. Three failures pause it; `resume` restarts it.
5. **`again` on any repeat, a recipe's included, runs it now** (1.x had this for recipes). From a
   chat: `#45 again`.
6. **Pausing and ending:** the file is the truth.
   - `stop repeating` (or closing the task) **pauses** a recipe: its task closes and stays closed
     while the file is there. The reply says "Paused: `resume` starts it again; removing
     `recipes/daily-brief.md` ends it."
   - `resume` reopens the task and carries on.
   - Removing the file, by a PR you merge, **ends** it.

**A recipe, start to finish: the daily brief.**

| When | What happens | Who |
|---|---|---|
| You say "turn on the daily brief recipe" | a work run on shipify copies `recipes/examples/daily-brief.md` to `recipes/` and opens a PR | the agent proposes, the box opens the PR |
| You merge the PR | the file is on `main`: approved | you |
| Within 5 minutes | the watch sees `recipes/` changed and rings the due run | the edge |
| Then | the due run opens "Recipe: daily-brief" and starts its first run, which sets the repeat and replies "Set: every weekday at 08:30. Next: Tuesday 08:30", copied to your Telegram | a box, no agent |
| Each weekday, 08:30 to 08:35 | the watch rings the due run, which starts the recipe's run. The agent reads the body and answers with read-only look calls (your apps' state, Notion's tasks if the tool is added). The box posts the reply on the task, and the door copies it to Telegram | the edge, a box, the agent (it only thinks) |
| A quiet morning | nothing new to say: no reply | — |
| You want it shorter | edit the body in a PR (or ask, and a work run proposes the PR), then merge. The next tick updates it, and the task says "Updated" | you |
| `#45 again` | runs it now | you, from any channel |
| `#45 stop repeating` | paused until `resume` | you |
| Remove the file (a PR) | it ends, and its task closes | you |

Every step above already exists in 0.1 except two lines: the watch noticing `recipes/` changed,
and the due run keeping recipe tasks in step. The plan → think → apply run is untouched.

**Where you see them:**
- **`/recipes`** in a chat lists each recipe, its next time and its task number.
- **The status page** lists them under Coming up and Recipes.
- **The recipe's task** is its log, with every run's reply.

**Examples to copy**, in `recipes/examples/` (not live):
- `daily-brief.md`
- `weekly-dependencies.md`: what's outdated across your projects, as a list, with no changes made
- `site-watch.md`: with `checks/example.mjs`

To turn one on, say "turn on the daily brief recipe": a work run on shipify copies it into
`recipes/` as a PR, and your merge makes it live.

**What we leave out, and why:**
- **Step lists, branches, loops:** the 1.x engine. Two small recipes read better than one graph, and
  each fits one sentence.
- **Permissions per recipe:** a second place approvals live. `tools.json` stays the one place.
- **A chat command per recipe:** `#45 again` and `/recipes` cover it with no new mechanism.
- **Arguments from a chat:** they'd be untrusted text inside reviewed instructions.
- **Webhooks and other triggers:** you've ruled them out. A recipe is time-driven.

## Core flows: what changes

| Flow | 0.2 |
|---|---|
| A question, a change, a new app, an upgrade, a release, down/up | unchanged |
| A message from a chat | unchanged in behaviour; it goes through the adapter registry |
| A reply to a chat | unchanged in behaviour; it goes through the adapter's `send` |
| A repeat | unchanged, plus `again` runs it now |
| `remember:` | dated, linked, Preferences first; `forget:` is new |
| The watch | unchanged; the due run gains one duty (keeping recipes and their tasks in step) |

## Build plan

Each step starts from a fresh `main`, and is done only when it is all four of these:

| Done means | Checked by |
|---|---|
| **Clean:** no leftovers, no dead code, the old path removed in the same step, and words that match the glossary | review; `tests/architecture.test.ts`; a search for retired words |
| **Well tested:** unit tests for the logic; the kind's conformance suite for each block; end to end against the fakes (fake gh, fake edge, fake channel); then live | `pnpm verify` (and `test:golden` where it applies); `ship selftest` live |
| **Properly handled:** every failure is a problem that says the one thing to do, reaches you as a reply or an alert, and is logged in one shape. Nothing is silent | a test for each failure path named in the step |
| **Configured:** any setup is one guided command with a check that names the fix, and `ship doctor` or `ship selftest` covers it afterwards | that command's own test, and a live run |

Plus the docs: each step updates the docs it touches (the table below), and the last step does a
full pass.

0. **The repeat fix, 0.1.9** ([#149](https://github.com/aayush-t-apps/shipify/pull/149)): its own
   PR, ready to merge now.
1. **Chat adapters and the vocabulary.**
   - The interface, the registry, and Telegram moved behind it.
   - The answers' text in `cli/contracts/answers.ts`, and the chat commands answered on GitHub too,
     by a run with no agent.
   - The conformance suite and the fake channel.
   - The 1.x channel leftovers removed.
   - The glossary's **Like** column, and the words checked across code, help and replies.
   - `tests/architecture.test.ts`: the four rules, failing the build when one is broken.
   - Behaviour unchanged: Telegram's tests pass as they are, and `ship selftest chat` passes live.
2. **The notebook.**
   - `forget:`, `/notebook`, dated lines with links, Preferences first, the precedence line, and the
     hidden-character check.
   - "A way of working → a skill PR" in the prompt and `playbooks/task.md`.
   - The live notebook selftest, then your live test from Telegram and GitHub.
3. **The status page.**
   - `/status` and the moved Access check.
   - `ship door page` with its checks.
   - Tests: no token, a bad token, the wrong audience, an expired token, not set up, the cache, and
     escaping.
   - Live: you add the Access application, the setup checks it, and you open the page.
4. **Recipes.**
   - The file's schema.
   - The due run's new duty.
   - Recipe tasks.
   - `again` on a repeat.
   - `/recipes` and the examples.
   - An end-to-end test against the fake gh: a recipe file merged, its task made, its time,
     changed, removed.
   - Live: one example turned on through a PR you merge, a morning reply, then removed.
5. **The docs pass and the release: 0.2.0.**
   - Every doc below updated.
   - `ship selftest` passes in full.
   - Tagged `v0.2.0`. `v1` doesn't move: `pipeline.yml` is unchanged.

Steps 1 to 4 can each ship as its own patch release, or together as 0.2.0. The default is one
build branch and one release PR (you prefer fewer PRs), with each step live-tested before the next.

## Your guide: what you do

| When | You |
|---|---|
| Now | merge #149 (the repeat fix), then say `resume` on your 9 am task if it's still open |
| Now | read this ADR; merging its PR approves the design and the build |
| Step 2 | try `remember:`, a question, `forget:` and `/notebook` from Telegram |
| Step 3 | in Cloudflare's dashboard, add one Access application for `shipify.app.a69x.in/status` with your `allow-me` policy (`ship door page` walks you through it), then open the page |
| Step 4 | merge the PR that turns on an example recipe, and see it reply |
| Step 5 | merge the release PR |

## Setup

| Part | Command | Checked by |
|---|---|---|
| Status page | `pnpm ship door page`: the Access steps one at a time, then the two values | `/status` without sign-in goes to Access's login; `ship door check` reports the page |
| A new chat, later | `pnpm ship add <name>` (unchanged) | `ship selftest chat` |
| Recipes | none: a file in a PR | the due run replies on the status task if a file doesn't read |
| Notebook | none | `ship selftest notebook` (now live) |

## Docs and clean-up

| Doc | Change |
|---|---|
| `docs/glossary.md` | the **Like** column; recipe, example, message, status page added; "recipe" off the gone list |
| `README.md` | "Task, repeat, recipe or check?" table; the status page in the tour |
| `docs/design.md` · `docs/tour.md` | the edge's third duty (the page); the adapter seam; recipes in the parts |
| `docs/channels.md` · `docs/plug-ins.md` · `plugins/README.md` · `skills/plug-ins` · `cli/lib/plugins/index.ts` | the adapter interface, how to add a channel, the conformance suite; the 1.x channel contract removed; check and recipe added to the kinds |
| `docs/door.md` | `/door/<channel>`, the registry, `/notebook`, `/recipes`, `/status` |
| `docs/channels.md` (also) | the parity table; out-only channels, with Notion and Obsidian as worked examples |
| `docs/notebook.md` | `forget:`, `/notebook`, dated lines, precedence, facts or how-to, the live selftest |
| `docs/tasks.md` | `again` runs a repeat now; recipes; `forget:` |
| `docs/recipes.md` (new) · `recipes/README.md` · `recipes/examples/` | the file, how it runs, examples, what's left out |
| `docs/watch.md` | the due run's recipe duty; the page reads the status task |
| `docs/setup.md` · `docs/getting-started.md` · `docs/security.md` | `ship door page`, the Access step, the two locks |
| `intents.json` | `forget:` under remember; `/notebook` and `/recipes` in the chat menu and help |
| `playbooks/task.md` | a way of working becomes a skill PR |
| `docs/context.md` · `CHANGELOG.md` · `docs/adr/README.md` | the state after each step; this ADR's row |
| `AGENTS.md` | rows for the status page and recipes |
| Removed | `cli/lib/plugins/channel.ts` and its test; `tool.ts`'s `send`; `tools.json`'s `telegram.in.door` |

## Consequences

- **Smaller where it counts:**
  - Telegram's code shrinks to its adapter.
  - Recipes reuse repeats, so there's no engine.
  - The page reuses the watch's record and the door's cache.
  - About 1,000 to 1,500 new lines in all, tests included. That's an estimate, measured in the
    build.
- **Limits, honestly:**
  - The page shows the watch's last view, up to 5 minutes old, with its time.
  - A recipe runs no more often than its kind of repeat allows: a job hourly, a check every 15
    minutes.
  - Cloudflare's free Zero Trust plan may ask for a payment method at sign-up (you're already
    past that).
- **Swappable:** an adapter can be replaced without touching the core. A recipe is plain Markdown
  that any agent could read.

## Decisions for you

Each has a recommended default. Merging this PR takes the defaults, unless you say otherwise on
the PR.

1. **One release, 0.2.0,** built on one branch with each step live-tested, rather than four patch
   releases. *Default: one release (fewer PRs).*
2. **Notion and Obsidian as out-only channels:** designed for, not built. *Default: not built
   until you ask; each is one adapter.*
3. **A chat command per recipe** (`/brief`): left out, since `#45 again` and `/recipes` cover it.
   *Default: left out.*
4. **The page's address:** `/status`, with `/` redirecting to it. *Default: as written.*
5. **Examples that ship:** daily brief, weekly dependencies, site watch. *Default: these three.*

## Your requests, mapped

| You asked (2026-10-05) | Where it's answered |
|---|---|
| A single clean admin page: links, health, status, behind Access; the cleanest, simplest redesign | 1. The status page |
| The 9 am daily message that never came | 0.1.9 ([#149](https://github.com/aayush-t-apps/shipify/pull/149)): a repeat set in words keeps running |
| Recipes back: "simple recipes was a good feature" | 4. Recipes, as files |
| Chat channels on a common interface, easy to extend | 2. Chat adapters |
| What I can do on Telegram, I can do on a GitHub issue; the same output on Notion or Obsidian; synergy | 2: Every channel can do the same things |
| `remember` from GitHub or any channel, followed cleanly | 3. The notebook, followed |
| Owner preferences and skill updates, as they work for you here | 3: facts in the notebook, ways of working as skill PRs |
| Research proven patterns; an efficient approach; modular blocks; the core unchanged; nothing unneeded | each part's "What we borrow" and "What we leave out"; Core flows |
| One vocabulary, OS-style, easy to refer to and build on | The vocabulary |
| Interfaces and blocks for everything: core, input, output, providers, plug-ins | Every block, one interface |
| Core, modules and plug-ins developed independently; scalable | Built to grow: four rules checked by a test; scale, honestly |
| Clean, secure, efficient | the page's two locks and cache; adapters' one suite; no new store, key or engine |
| Tests, clean-up and docs in every step | Build plan; Docs and clean-up |
