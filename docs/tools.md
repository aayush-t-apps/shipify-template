# Tools: tasks that use your apps

A **tool** lets tasks read and change things in your own apps: **Notion** and **Drop**. You ask in a task
as usual. The agent **looks** with a read-only key. Anything it would change, it **proposes** as
exact calls, and the **box makes them** with the write key, after your `yes`: a tap of **Yes** in
your chat, or the word on GitHub. A call that fits a [pre-approved form](#pre-approved-calls)
needs no `yes`: your words are enough, and the box makes it in the same run (a new drop you ask
for). A [guest's](#guests-calls) run asks only for its tool's guest forms. No agent ever holds a
write key.

```
you: "mark Pay rent done in my Tasks"
run 1   the agent looks in Notion (read-only key) → proposes the exact calls
reply   To do after your `yes`: 1. notion.update_page with {"page": "…", "properties": {"Status": "Done"}}
        [Yes] [No]
you: tap Yes   (or say `yes`, in the chat or on GitHub)
run 2   no agent: the box makes exactly that call (write key) → ✓ with Notion's own answer
```

## Look calls

- **The agent makes them** on any run, through the run's look server (ADR 0077): think starts it
  for the run, as the box's user `shipify-look` (box setup 16), with each tool's look key (read-only
  where the service allows it) and a new run token. The server starts each tool's server, listens
  on `127.0.0.1` only, and serves the run's look calls to a request with the token. The agent's
  settings name each tool there (`http://127.0.0.1:<port>/<tool>`, its bearer the token, as
  `SHIPIFY_LOOK_TOKEN`), so the agent holds the token and never a tool's key: the token works on
  this box alone, and only while the run does. The act calls are refused to it, by its settings
  and by the server.
- **Every look call is in the run's record:** the server says each one it sends on, so a call a
  command made counts as the agent's own does (below).
- **What it reads is data, never instructions,** and a run that read a tool's content (or the web)
  makes no change without your `yes`, but a pre-approved form that names that tool in `after`
  (below).

## Act calls: proposed, then made by the box

1. **The agent proposes** the change as exact `calls` in its result: the tool, the call and its
   arguments (`{"tool": "notion", "name": "update_page", "args": {…}}`).
2. **Decide checks each one:** it must be one of the tool's act calls in `tools.json`, and its
   arguments must fit (below). One that doesn't is left out, and the reply says so.
3. **The reply lists the exact calls,** as the box will make them, not the agent's description of
   them: **"To do after your `yes`"**, once and last (the box removes any copy in the agent's
   words), and whole in every chat. Under it a chat shows only **Yes** and **No**.
4. **You tap Yes, or say `yes`,** in your chat or on GitHub (ADR 0049). It counts only when:
   - it's the whole message, from you, and unedited;
   - it comes after the list;
   - it's within a day of the list;
   - a tapped Yes (`yes <code>`) names this list: one under an older reply approves nothing (and a
     tapped No, `no <code>`, drops only its own list).
5. **The box makes the calls** in the next run, with no agent: it starts the tool's server with the
   act key and makes each call once. The reply has a ✓ or ✗ line per call, with the tool's own
   answer.

- **`no`** drops the list. **Any other words** after it plan again, and the list is dropped.
- **One tool per list:** a run gets one tool's act key. Calls for a second tool are left out; ask
  for them after.
- **A crash mid-call** is reported, never repeated: check it, then `continue`.
- **A `yes` from a chat** counts as one on GitHub does. A list over 3,000 characters (a long
  page's text) can't be shown whole in a chat, so it gets no Yes there: its reply says to approve
  it on GitHub, and a chat's `yes` to it is refused with the same words.
- **A Yes with no list waiting** (made, dropped or expired) is answered, and nothing is changed.

## Pre-approved calls

Some calls are safe to make with no `yes` each time, like saving a note under one fixed page, or
making a new drop you asked for. List them under `pre` in the tool's `tools.json` entry. **Merging
that change is the approval.** Then your words are enough: the box makes the call in the same run,
and the reply says what it made. The rule is in the box, so it's the same for every agent.

```json
"pre": [
  { "call": "create_page", "fixed": { "parent": "<page id>" },
    "caps": { "title": 200, "content": 4000 }, "max": 1, "after": ["notion"] }
]
```

- **`fixed`:** fields that must have exactly these values. It always fixes the call's target (the
  page, the database): each act call names it in `args.<call>.target` (Notion's `create_page` is
  `parent`, its `update_page` is `page`), and a form that doesn't fix it is refused. A call that
  changes nothing there is, and only makes something new, says `"new": true` in its `args`
  instead, and its form fixes no target (Drop's `publish`).
- **`caps`:** text fields allowed, each up to this many characters.
- **`any`:** fields allowed with any value the call takes (its own checks still apply). Any field
  not fixed, capped or here makes it a normal call.
- **`max`:** the most of this call one run may make.
- **`after`** (ADR 0049): the tools whose look calls it still counts after, so a routine can read
  your Notion and write to it. With none, it counts only in a run that read nothing from outside.
  It never counts after the web, a check, a repo outside your account, another account's run, or
  the agent saying it read outside: then even a pre-approved call is listed for your `yes`.

## Guests' calls

A [guest](channels.md#guests)'s run holds no key or tool (ADR 0071), and a guest's words approve
nothing. It may still ask for a few calls, listed under `guest` in the tool's `tools.json` entry
(ADR 0073). **Merging that change is the approval.** The box makes a guest's call at once when it
fits one of these forms, for that guest alone; any other call of theirs is left out, and the
reply says so.

```json
"guest": [
  { "call": "publish", "fixed": { "share": "me" }, "caps": { "title": 120 },
    "any": ["files", "expiry"], "max": 5 }
]
```

- **The same shape as `pre`** (`fixed`, `caps`, `any`, `max`), with no `after` and no fixed
  target. No rule on reads: a guest's form changes only what is the guest's, so a web page that
  tricks their run can open nothing to anyone.
- **Whose the target is,** the tool checks: the box asks the door for the guest's email and name
  (`GET /door/guest/<id>`, task.yml's token only) and starts the tool's server with them as
  `SHIPIFY_GUEST` (`{"email", "name"}`). The server's guest mode acts for that guest alone, and its
  answers never name their email (replies are kept on GitHub). Its own tests prove it.
- **A guest you removed** makes no call: the door doesn't know them.
- **Their files** come from the run's own folder, or from the door by ref: a guest's files are
  never on `shipify-files`. A file a guest's call took stays in their chat too.

**A routine that writes** ("every weekday at 8, read my Tasks and write today's plan under
Daily") is one PR: the recipe, naming the exact ids its calls use, and the narrowest form for them
(above). The PR says in plain words what it may change by itself ("one page a day under Daily: a
title of up to 200 characters and up to 4,000 of text"); your merge approves both. Anything beyond
the form waits for your Yes ([recipes.md](recipes.md#a-recipe-that-writes)).

## Argument checks

Each act call can have a schema under `args` in its `tools.json` entry:

```json
"args": {
  "update_page": { "required": ["page", "properties"], "properties": { "page": {}, "properties": {} } }
}
```

- **`required`:** fields the call must have.
- **`properties`:** the only fields it may have.
- **`target`:** the field that says what the call changes (a page, a parent), which a
  pre-approved form must fix. Notion's: `create_page` → `parent`, `update_page` → `page`.
- **`new`:** `true` for a call that changes nothing there is and only makes something new: its
  pre-approved form has no target to fix. Drop's `publish`.
- **`warn`:** what a field does that its value doesn't show, in a few words the list line says
  whenever the call has that field. Notion's `update_page` with `content`: "replaces the page's
  whole body".
- **`files`:** the field that names files the task shared (a list of names, as its replies list
  them). Decide takes the call only when each one is a file the task shared before, or shares in
  the same answer: the box shares an answer's files before it makes the answer's pre-approved
  calls. When the box makes the call, it reads those files from `shipify-files` with the run's
  read key into a folder of their own, gives the tool's server that folder as `SHIPIFY_FILES`, and
  removes it after. Drop's `publish` and `update`: `files`. When the call works, the reply leaves
  its files out (its **Files:** and the chat's store), as the call's answer stands for them (Drop's
  link); they stay on `shipify-files`. When it fails or waits for your Yes, they show as files, so
  nothing is lost (ADR 0072).
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
   **⋯ → Connections** → add both integrations. Nothing else is visible to them. Simplest: connect
   both to one parent page, so every page under it can be read and written.
5. **Check it:** `pnpm ship selftest notion`, then ask "what's open in my Tasks?".

**Upkeep:** none: Notion's keys don't expire. To replace one: refresh its secret on the
integration's page, then `pnpm ship add notion --new --yes`. To take Notion away:
`pnpm ship remove notion`.

**What you can ask:**

| You ask | What happens |
|---|---|
| "what's open in my Tasks?" | an answer from Notion; nothing changes |
| "mark Pay rent done", "save these notes as a page under Notes" | it looks, lists the exact calls, and the box makes them after your Yes |
| `repeat: every weekday at 8, my open tasks` | an answer each morning; reading needs no `yes` |

## Drop: setting it up (once, about 10 minutes)

[Drop](../plans/drop.plan.md) is your own file sharing by link. With its tool, a task shares files it
made as a drop, and you get the link: "make a PDF of this and share it, anyone can view, 7 days".
The tool calls Drop's `/api` behind Cloudflare Access, with an Access **service token**: a read
token for looking, and a write token for changes, as Notion has two keys.

1. **Drop is live** (0.3.0 or later; 0.6.0 for guests' pages), with its Access app on `/admin` and `/api` (the plan's
   setup).
2. **Two service tokens.** In Cloudflare: **Zero Trust → Access → Service credentials → Create
   Service Token**. Name one **Shipify Drop read** and one **Shipify Drop write**. Copy each
   one's **Client ID** and **Client Secret**: the secret shows only once. A token with a duration
   stops on its date; **Non-expiring** needs no upkeep.
3. **Let them into `/api`.** **Zero Trust → Access → Applications** → Drop's app (`/admin` and
   `/api`) → **Policies → Add a policy**: action **Service Auth**, include **Service Token**: both
   tokens. Your own email policy stays. Drop takes a service token on `/api` only, never on
   `/admin`. **Check each token** (paste at the prompts, so the secret stays out of your shell's
   history):

   ```sh
   read -r CF_ID; read -rs CF_SECRET
   curl -s -w ' %{http_code}\n' https://<drop's address>/api/drops \
     -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET"
   unset CF_ID CF_SECRET
   ```

   `{"drops":[…]} 200`: it works. `302`: Access stopped it (a wrong ID or secret, or the token
   isn't in the policy). `403`: Access let it in, and Drop refused it: its Access values or its
   locks don't take the token (a task on Drop finds why).
4. **Keep the read token read-only.** Drop refuses a change from it when its variable
   `ACCESS_READ_ID` holds the read token's Client ID (it ends in `.access`, and isn't secret): it
   then answers a `GET` from it and nothing else. Ask for it in a task on Drop: `drop: set
   ACCESS_READ_ID to <the read token's Client ID>`. Until then, the read token can change drops too:
   a looking run's agent still can't make an act call (they're denied to it), but the token itself
   could.
5. **Add it:** on your PC, in shipify, `pnpm ship add drop` shows the plan; `pnpm ship add drop
   --yes` asks for Drop's address (`https://…`, with no path) and each token's Client ID and
   Client Secret at a hidden prompt, sets them on shipify (`SHIPIFY_DROP_URL`,
   `SHIPIFY_DROP_READ_ID`, `SHIPIFY_DROP_READ_SECRET`, `SHIPIFY_DROP_WRITE_ID`,
   `SHIPIFY_DROP_WRITE_SECRET`), and checks each token (`GET /api/drops`). With no PC, add the
   same five on GitHub's website: shipify → **Settings → Secrets and variables → Actions →
   New repository secret**, each one a secret (never a variable, which a run reads as empty);
   step 3's check is then the only check of the tokens. `SHIPIFY_DROP_URL` is Drop's address
   alone, like `https://drop.example.com`: `https://` first, no quotes, no path.
6. **Check it:** `pnpm ship selftest drop`, then ask "what drops do I have?". A first share proves
   the write token: "share this file, only me, 1 day", then Yes, then revoke it.

**Upkeep:** none with non-expiring tokens. To replace one: make a new token, add it to the
policy, `pnpm ship add drop --new --yes`, then delete the old one. To take Drop away from tasks:
`pnpm ship remove drop`, and delete both tokens in Cloudflare.

**Its calls:**

| Call | Kind | Arguments |
|---|---|---|
| `drop.list` | look | `query`: words in a title. Its drops (title, id, who may open it and its link, PIN, people, expiry, requests to answer), the space they use of Drop's cap, and Drop's people. A `query` that finds one drop shows its files (with their sizes), limits and who asks to open it |
| `drop.publish` | act | `title` (up to 120 characters), `files` (names the task shared), `share`: `me` (the default: only you), `view`, `add`, `collect` or `people` (with `people`: `{"Mom": "view"}`, a name in Drop's People or an email), `expiry`: `1d`, `7d` (the default), `30d` or `keep`, `pin`: true for a PIN. Answers with its link, the PIN and its page in Drop's admin. Pre-approved (one a run): made with no `yes` when the run read nothing from outside, Drop's own `list` too. A guest's form: `share` always `me`, `title`, `files`, `expiry` (5 a run) |
| `drop.update` | act | `drop` (its id or link), and any of: `title`, `expiry` (counted from now), `limits` (`{"mb": 1 to 2000, "files": 1 to 5000}`, either or both, as Drop's Details form takes them), `files` (names the task shared, added), `delete_files` (names in the drop), `share` (its link stays the same; `me`: only you can open it), `people`, `remove` (people), `requests` (who asked to open it, by email: `view`, `add` or `deny`, as Drop's Requests page answers them), `pin` (true: a new one; false: none), `new_link` (true: a new link, and the old one stops). A guest's form: `drop`, `title`, `files`, `delete_files` (5 a run) |
| `drop.revoke` | act | `drop`: the drop and its files are deleted, and its links stop |

**Only you, unless you say who (ADR 0073):** a `publish` with no `share` makes a drop only you can
open, and its answer says how to share it (its page in Drop, or ask for anyone with the link, or
names).

**A guest's drop (ADR 0073):** with `SHIPIFY_GUEST` set ([Guests' calls](#guests-calls)), the tool
acts for that guest alone. `publish` makes a drop only they can open, `by` them (Drop 0.6.0 or
later), for 30 days at most (`30d` by default); no other `share`, `people` or `pin`. Its answer is
the drop's link, which opens to them signed in (`/d/<address>`), and "Manage it in Drop", their
**My drops** (`/mine/d/<address>`), where they share it. `update` first reads the drop's `by`: it
changes only the title and files of a drop made for them, and refuses any other drop (yours,
another guest's, or one from a Drop with no `by`). `list` and `revoke` refuse. Its answers say
"you", never the email. Your `list` shows a guest's drop as "only Ana" (or "for Ana" once she
shared it).

**A run's files:** `files` names files the task shared in a reply (under **Files:**), in this
answer or before: a Yes comes in a later run, after the agent's folder is gone, and the box
shares an answer's files before it makes its pre-approved calls. The box fetches them for the call
([`files`](#argument-checks)): up to 20, each up to 25 MB, as a task shares them. Every file goes
in, or no drop: if Drop refuses one, the tool deletes the new drop and says so. `update` adds
files to a drop one by one, and if Drop refuses one, its answer says which went in.

**What you can ask:**

| You ask | What happens |
|---|---|
| "what drops do I have?" | an answer from Drop; nothing changes |
| "make a PDF of this and share it, anyone can view, 7 days" | the run makes the file and proposes `drop.publish`; the box makes the drop in the same run, with no `yes` (its pre-approved form), and the reply has its link |
| "share the Diwali photos with Mom and Dad, keep them" | the same, with `share: "people"` and `expiry: "keep"`. A name Drop doesn't have is refused when the box makes it, and the reply says so |
| "make a page of my trip plan" (and, if you want, "share it with Mom and Dad for 7 days") | a [page](glossary.md): the run makes one `.html` file and proposes `drop.publish` (`share: "me"` unless you said who); the box makes the drop in the same run, and the reply is only its link. Drop opens the page, with **Share** at the top. "Add Tuesday's dinner" makes it again and lists one `drop.update` (the old file deleted, the new one added), so the link stays the same, after your Yes (ADR 0072) |
| a guest: "make a page of our trip plan", then "add Tuesday's dinner" | the same page, given to Drop at once by their guest form: a drop only they can open, its link and "Manage it in Drop". The change is one `drop.update` on that drop, made at once, so the link stays. Sharing is theirs, in Drop's My drops (ADR 0073) |
| "the link to the Ladakh drop" | an answer from Drop, with its link; nothing changes |
| "add this PDF to the Ladakh drop and keep it 30 more days", "delete old.txt from it" | it looks, lists `drop.update` (with `files`, `expiry`, `delete_files`), and the box makes it after your Yes |
| "let my aunt into the Diwali drop", "who asked for it?" | it looks (a `query` that finds one drop names who asked), lists `drop.update` with `requests`, and the box makes it after your Yes |
| "a new link for the Ladakh drop", "revoke it" | it looks, lists `drop.update` or `drop.revoke`, and the box makes it after your Yes |

**The API it uses:** Drop's own `/api` (0.3.0), the one its admin page calls, so the tool sends what
that page sends (JSON, `no-store`). Each request carries `CF-Access-Client-Id` and
`CF-Access-Client-Secret`; Access checks them and gives Drop its JWT. An error answers
`{"error": "<code>", "message": "<plain words>"}`. Checked on 2026-10-29 against the admin page
live Drop serves, and its answers to the read token. The tool uses each request below as that page does. It leaves out what only a
person does there: Drop's People (add someone, their home link, Easy or Sign-in), removing a link
with no new one, and photo thumbnails, which the page makes in the browser (a drop the tool makes
shows each photo whole).

| Request | Body | Answer |
|---|---|---|
| `GET /api/drops` | | `{"drops": [Drop], "usage": {"bytes", "capBytes"}}`: the space all drops use, of Drop's cap (`STORAGE_GB`) |
| `GET /api/drops/:address` | | `{"drop": Drop}`, with `files` (`[{"name", "size", …}]`), `people` and `requests` (`[{"id", "email"}]`) |
| `GET /api/people` | | `{"people": [{"id", "name", "email", "mode"}]}` |
| `POST /api/drops` | `{"title", "gate", "expiry", "pin"?: "<6 digits>", "by"?: {"email", "name"}}` | `{"drop": Drop, "link"?}`; `by` (a guest's drop, Drop 0.6.0) only with `gate` `me`, 30 days at most, no PIN |
| `PUT /api/drops/:address/files/:name` | the file's bytes | 201 `{"name"}`: a name already there gets a number |
| `DELETE /api/drops/:address/files/:name` | | the file is gone |
| `PATCH /api/drops/:address` | one of `{"gate"}`, `{"pin": "<6 digits>" or null}`, `{"people": {"<person id or email>": role or null}}`, `{"title", "limits": {"mb", "files"}, "expiry"?}` | `{"drop": Drop, "link"?}`; `null` takes a person off; `expiry` counts from now |
| `POST /api/drops/:address/links` | `{"role"}` | `{"link"}`; the old link stops |
| `POST /api/requests/:address.:id/allow` · `/deny` | allow: `{"role"}` | the one who asked is on the drop with that role, or turned down |
| `DELETE /api/drops/:address` | | the drop and its files are gone |

- **`Drop`:** `{"address", "title", "gate", "pin": bool, "expires": ISO time or null, "expired":
  bool, "peopleCount", "requestCount", "limits": {"mb", "files"}, "link": {"role", "path"} or
  null, "by"?: {"email", "name"}}` (`by`: the guest it's for, set only when it's made; a `PATCH`
  never changes it). A drop has one link at most,
  and Drop keeps it: `path` is `/d/<address>.<secret>`. A link made before 0.3.0 has no `path`
  (Drop kept only its hash): a new link gives one, and the old one stops.
- **Words:** `gate` is `me`, `view`, `add`, `collect` or `people`, the tool's `share` as it is;
  `expiry` is `1d`, `7d`, `30d` or `keep`. A link's role follows its gate: `view`, `add`, or `send`
  for `collect`. The people on a drop open `/d/<address>` and sign in, or find it on their home
  page. A change of gate keeps the link, so from `view` to `add` a link already sent can add
  files too: a new link stops it.
- **`pin: true`:** the tool makes a random 6-digit PIN, sends it, and its answer gives it once;
  a new one stops the old.
- **What the tool says to each error:** Access's redirect to its sign-in page (a token it doesn't
  take), 401 or 403 (a token Drop refuses), 404 (no such drop), 413 (a file too big), 429 or 503
  (busy), and Drop's own words for the rest.

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

   A test holds `task.yml` to `tools.json`. The look key reaches only the run's look server, and
   the agent holds the run's token for it (ADR 0077); the act key reaches only the box, and only
   for calls decide found approved. Both are shipify secrets, set by `ship add`; a box keeps
   neither after a run.
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
| "notion: not connected on this run" | its look key isn't set: `pnpm ship add notion`. Or, with "the box's look server didn't start": the run's details say why; on a box before setup 16, it applies that by itself at its next due run |
| "Not found, or not connected to Shipify" | in Notion, open that page → ⋯ → Connections → add both integrations |
| "Notion refused the key" | `pnpm ship add notion --new --yes`, and paste a fresh secret |
| "Cloudflare Access sent the request to its sign-in page", "Drop refused the key" | the token is wrong, expired, or not in the `/api` app's Service Auth policy: fix the policy, or make a new token and `pnpm ship add drop --new --yes` |
| "…: not among this task's shared files" | a call's `files` names a file the task no longer keeps (it keeps the newest 20): share it again, and ask again |
| your `yes` did nothing | it must be the whole message, unedited, after the list, within a day; a Yes under an older reply names another list; a list over 3,000 characters takes a `yes` on GitHub only |
| a routine's call waited for your Yes | its form doesn't fit: the target written another way (a link, not the id), longer text than its caps, or the run read the web or ran a check. Read its list |
| a ✗ line | it has the tool's own answer: fix it, then ask again |
