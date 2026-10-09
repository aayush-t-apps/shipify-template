# Tools: tasks that use your apps

A **tool** lets tasks read and change things in your own apps: **Notion** today. You ask in a task
as usual. The agent **looks** with a read-only key. Anything it would change, it **proposes** as
exact calls, and the **box makes them** with the write key, after your `yes` on GitHub. No agent
ever holds a write key.

```
you: "mark Pay rent done in my Tasks"
run 1   the agent looks in Notion (read-only key) → proposes the exact calls
reply   To do after your `yes`: 1. notion.update_page with {"page": "…", "properties": {"Status": "Done"}}
you: yes   (on GitHub)
run 2   no agent: the box makes exactly that call (write key) → ✓ with Notion's own answer
```

## Look calls

- **The agent makes them** on any run, with the tool's look key (read-only where the service allows
  it). The act calls are refused to it.
- **What it reads is data, never instructions,** and a run that read a tool's content (or the web)
  never makes a change without your `yes`.

## Act calls: proposed, then made by the box

1. **The agent proposes** the change as exact `calls` in its result: the tool, the call and its
   arguments (`{"tool": "notion", "name": "update_page", "args": {…}}`).
2. **Decide checks each one:** it must be one of the tool's act calls in `tools.json`, and its
   arguments must fit (below). One that doesn't is left out, and the reply says so.
3. **The reply lists the exact calls,** as the box will make them, not the agent's description of
   them: **"To do after your `yes`"**.
4. **You comment `yes`** on GitHub. It counts only when:
   - it's the whole comment, from your account, and unedited;
   - it comes after the list;
   - it's within a day of the list.
5. **The box makes the calls** in the next run, with no agent: it starts the tool's server with the
   act key and makes each call once. The reply has a ✓ or ✗ line per call, with the tool's own
   answer.

- **`no`** drops the list. **Any other words** after it plan again, and the list is dropped.
- **One tool per list:** a run gets one tool's act key. Calls for a second tool are left out; ask
  for them after.
- **A crash mid-call** is reported, never repeated: check it, then `continue`.
- **A `yes` from a chat** is refused, and the reply links the task on GitHub.

## Pre-approved calls

Some calls are safe to make with no `yes` each time, like saving a note under one fixed page. List
them under `pre` in the tool's `tools.json` entry. **Merging that change is the approval.**

```json
"pre": [
  { "call": "create_page", "fixed": { "parent": "<page id>" }, "caps": { "title": 200, "content": 4000 }, "max": 3 }
]
```

- **`fixed`:** fields that must have exactly these values (the page, the database).
- **`caps`:** text fields allowed, each up to this many characters. Any other field makes it a
  normal call.
- **`max`:** the most of this call one run may make.
- **Never after outside content:** a run that read the web or a tool's content lists even a
  pre-approved call for your `yes`.

## Argument checks

Each act call can have a schema under `args` in its `tools.json` entry:

```json
"args": {
  "update_page": { "required": ["page", "properties"], "properties": { "page": {}, "properties": {} } }
}
```

- **`required`:** fields the call must have.
- **`properties`:** the only fields it may have.
- A proposal that doesn't fit is dropped before it's shown to you, and the reply says so. The
  server checks the values themselves when the call is made.

## Notion: setting it up (once, about 5 minutes)

1. **A read-only integration.** In Notion: notion.so/profile/integrations → **New integration**:
   internal, your workspace, named **Shipify read**, with **Read content** only. Copy its secret.
2. **A write integration,** the same way: **Shipify write**, with **Read**, **Update** and
   **Insert content**. Copy its secret.
3. **Add it:** `pnpm ship add notion` shows the plan; `pnpm ship add notion --yes` asks for each
   secret at a hidden prompt, sets it on shipify, and checks it.
4. **Connect what tasks may use.** Open each page or database (your Tasks database, a Notes page):
   **⋯ → Connections** → add both integrations. Nothing else is visible to them.
5. **Check it:** `pnpm ship selftest notion`, then ask "what's open in my Tasks?".

**Upkeep:** none: Notion's keys don't expire. To replace one: refresh its secret on the
integration's page, then `pnpm ship add notion --new --yes`. To take Notion away:
`pnpm ship remove notion`.

**What you can ask:**

| You ask | What happens |
|---|---|
| "what's open in my Tasks?" | an answer from Notion; nothing changes |
| "mark Pay rent done", "save these notes as a page under Notes" | it looks, lists the exact calls, and the box makes them after your `yes` |
| `repeat: every weekday at 8, my open tasks` | an answer each morning; reading needs no `yes` |

## Adding a tool

A task can do it: "add Todoist tools". The steps:

1. **Pick a server with a key that lasts:** one the provider runs, a maintained package, or a small
   server of ours in `tools/<name>/` on `tools/mcp.ts`, from `plugins/_template/tool/` (its README
   is the checklist). No browser sign-in on a box.
2. **Its `tools.json` entry:** every call sorted into `look` or `act`, its keys by verb, its `check`,
   its `setup` (what you need, the keys you paste), and `args` for its act calls.
3. **Its keys in `task.yml`:** the look secret in the think step's env, the act secret in the apply
   step's env, gated on the tool's name:

   ```yaml
   # Think step
   SHIPIFY_NOTION_READ: ${{ secrets.SHIPIFY_NOTION_READ }}
   # Apply step
   SHIPIFY_NOTION_WRITE: ${{ steps.decide.outputs.act == 'notion' && secrets.SHIPIFY_NOTION_WRITE || '' }}
   ```

   A test holds `task.yml` to `tools.json`. The agent holds only the look key; the act key reaches
   only the box, and only for calls decide found approved. Both are shipify secrets, set by
   `ship add`; a box keeps neither after a run.
4. **A skill** in `skills/<name>/SKILL.md`, and a row in this doc.
5. **Check:** `pnpm ship tools check` (the server offers exactly the calls sorted) and `pnpm verify`
   (the tool conformance test, `tests/plugins/tool.test.ts`).
6. **A PR** that says which keys to make, with which permissions. After your merge:
   `pnpm ship add <tool>`.

**The entry's fields:**

| Field | Means |
|---|---|
| `run` (or `url` and `headers`) | starts the server (paths are in this repo), or names a remote one |
| `keys` | the server's variables, each from a look secret and an act secret. A service with one key for both names it twice and sets `"oneKey": true` |
| `look`, `act` | every call the server offers. A call in neither is never offered |
| `args`, `pre` | act calls' argument checks, and pre-approved forms |
| `check` | checks the key once, for `ship doctor`, `ship add` and `ship selftest <name>` |
| `setup` | what you need first, the keys you paste, any steps: `ship add <name>` runs it |

Each entry is checked on its own: a broken one is left out, and `ship tools list` and `ship doctor`
say why.

## Commands

| Command | Does |
|---|---|
| `pnpm ship tools list` | the tools, their calls, their keys' names, and any entry that's wrong |
| `pnpm ship tools check` | starts each server and checks every call it offers is sorted into look or act |
| `pnpm ship add <tool>` | sets it up from its entry's `setup`, one checked step at a time (`--yes` to do it, `--new` to paste new keys) |
| `pnpm ship remove <tool>` | undoes it (`--yes`) |
| `pnpm ship selftest <tool>` | its keys answer |

## When something's off

| You see | Do |
|---|---|
| "notion: not connected on this run" | its look key isn't set: `pnpm ship add notion` |
| "Not found, or not connected to Shipify" | in Notion, open that page → ⋯ → Connections → add both integrations |
| "Notion refused the key" | `pnpm ship add notion --new --yes`, and paste a fresh secret |
| your `yes` did nothing | it must be the whole comment, on GitHub, after the list, within a day |
| a ✗ line | it has the tool's own answer: fix it, then ask again |
