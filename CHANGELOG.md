# Changelog

All notable changes to Shipify. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions: [Semantic Versioning](https://semver.org/). Each release goes to the template
(`shipify: release`, [docs/releases.md](docs/releases.md)), and every copy takes it as one PR.
Projects pick up their stack's changes, their pipeline's included, through `pnpm ship upgrade` (ADR 0048).

## [Unreleased]

## [0.1.22] - 2026-11-14

### Added

- **Your assistant: a Personality you set, memory across chats, and chats that read like chat
  (ADR 0078, task #741).**
  - **Personality:** one page, `Notebook: Personality`, read first in every run of yours (2,000
    characters at most). Say how you want it to talk in any chat ("be more casual with me"), or
    pick it in **Setup → Personality** (Default, Friendly, Candid, Efficient, Quirky, or your own
    words); **Change it back** undoes it. Under both is the word `personality: <preset or your
    words>` (`default`, `undo`), which the box writes with no agent. With no page, the Default's
    words take the place of the old "be brief and direct" line, in fewer characters.
  - **Memory:** past chats never go in a prompt by themselves. When an ask builds on an earlier
    talk, a run finds it by meaning with `ship recall "<words>"` and reads it short with
    `ship recall <n>` (its Progress, its newest 2 messages, the rest one line each). A line your
    newer words contradict is taken off as you say them (a run's new `forget`), under the same
    rule as a note: at once from your words, and after an outside read, on the list for your Yes.
  - **Guests:** each has a memory page of their own (their Personality, then their notes), which
    only their runs read: their `remember:`, `forget:` and `personality:` now write it, and so do
    their runs when they read nothing from outside.
  - **Chats that read like chat:** the answer first, in plain words, with no report shape for a
    plain question; a plain answer writes no handoff, so no Progress block and one agent turn
    less. A reply may end with up to 3 next steps as buttons, in every chat (`choices` with no
    question). The agent uses its own helpers, web, skills and tools when an ask gains from them.
    The writing rule (ASD-STE100) stays for docs, PR bodies, plans and skills. A talk run's
    prompt grows by about 212 tokens with no Personality set.
  - **Web chat:** Send waits for a photo, also while it's made smaller; an upload after your
    sign-in ended says so, not "Offline"; a failed upload tries again once you're back online;
    the Desk opens offline; on a phone, pull down to refresh.
  - **Codex:** a run on an agent whose login isn't set stops before the clone and the agent, and
    says what to do (`codex sign in`, or `pnpm ship setup agent <agent>`). A first `use codex`
    on a box still installs Codex once, as that step holds no login.
  - No new service, store, key, setting, recipe or workflow change.
    [notebook.md](docs/notebook.md#your-personality-adr-0078),
    [channels.md](docs/channels.md#the-web-chat).
- **The tools' look keys out of the agent's reach (ADR 0077, task #737; box setup 16).** No NAT
  gateway and no list of allowed hosts: nothing comes in to a box, every connection is TLS or
  WireGuard, and a list would stop only naive leaks. Instead, for each run that offers tools, the
  runner starts the run's look server (`ship run look`) as a user of its own, `shipify-look`. It
  holds the Notion and Drop look keys, starts their servers, and serves the run's look calls on
  `127.0.0.1` only, to a request with the run's token: an act call, or one the run doesn't offer,
  is refused. The agent holds that token (`SHIPIFY_LOOK_TOKEN`) in place of the keys, so a command
  it runs, or a package a project's tests load, finds no look key: the token works only on the box
  and only while the run lasts. All four agents name each tool as a remote one at the server
  (checked live with each first). The server records each call it sends on, so a look call a
  command made counts as a read from outside too. **Setup 16:** the look server's user, in the
  sudo rule and the agents' network rules, with its walls checked; each box applies it by itself
  at its next due run, and until then its runs go without tools and say why (never the keys
  instead). The roadmap's list of allowed hosts goes, with the reason.
  [security.md](docs/security.md#the-agents-sandbox), [tools.md](docs/tools.md#look-calls).

### Changed

- **A project's pages close and open with it (task #744).** You close nothing by hand. **Close**
  closes the project's open chats and its pages (its `Notebook: <name>…` issues), as completed;
  **Reopen** opens its pages again. Writing on a closed project's own thread opens it and its
  pages too. Its pages stay readable, as before: its screen's Docs, the Library's **Closed
  projects**, a run in one of its chats, and `ship notebook read`. A closed project's doc has no
  **Edit** in the pane, and a save is refused. The weekly clean-up gets a third step: it closes
  each open page whose project isn't open (one closed with GitHub's own button, or before this
  change), and says so ("closed 3 pages of closed projects (#40, #41, #42)"). A page a run, `add`
  or `jot:` writes opens again, so a topic never gets a second page. The door now writes a
  project's reopen as words, as its close, so a run with no agent sees to it. No new service,
  store, key, setting or workflow change.
  [knowledge.md](docs/knowledge.md#open-or-closed), [watch.md](docs/watch.md).

### Fixed

- **A box with no look server user says so plainly (task #744).** A box set up before setup 14 has
  no updater, so it never applies setup 16 by itself. Each run that offered tools still tried
  `sudo -u shipify-look`: its log showed "unknown user" and "error initializing audit plugin", and
  the run said the box would fix itself. Now the run checks the user first, with no sudo. It says
  what's true for the box: it updates itself, or it must be set up once more, after which it updates
  itself. [box-setup.md](docs/box-setup.md#its-own-updates).
- **The box's check before a Shipify PR runs each test once (task #744).** `make verify` ran the
  contract tests, then ran them again among the tests the change reaches (`architecture` and
  `recipes` ran twice in a measured run). It now leaves them out of the second pass: about 20 s
  less on each Shipify work run.

## [0.1.21] - 2026-11-11

### Added

- **A box applies main's newer setup by itself (box setup 14, task #732).** You never run a box's
  setup again for a new version. When the box's setup is older than main's and no other slot runs
  a job, the due run (at least once a day) or the weekly clean-up starts the box's own update,
  the one command the runner may run as root. Root downloads `box/setup.sh` from your copy's
  default branch itself, with the job's read token on stdin, and applies it with the settings
  `box add` gave it (no keys): no slot registers, no sign-in is waited for, the slots with no job
  stop until it ends. Your chat says what the box got, or why it couldn't (tried again a day
  later). A setup whose sandbox check fails now leaves a mark, and no agent starts on the box until
  a setup passes it. Root also runs the runner's dependency installer from its own copy, never the
  runner's folder. [box-setup.md](docs/box-setup.md#its-own-updates). **Action needed once:** on
  each box set up by 13 or older, its `here.sh` command once more, while no task runs; that
  installs its own update, and doctor names each box until then.

### Changed

- **Take an app down from your chat, after your Yes; never a guest (task #729, ADR 0049).**
  `<app>: take it down`, `bring it back` and `roll back production` from a chat now list what
  they do, and your Yes (within a day) runs them once on GitHub's machines. On GitHub they still
  run at once. A chat's `continue` on one lists it again. A guest can't ask for one.

### Fixed

- **`main`'s checks pass again after box setup 14, and a box checks shell scripts as CI does (box
  setup 15, task #732).** GitHub's machines (Ubuntu 26.04) check with shellcheck 0.11, which
  names a function only a `trap` runs as never run (SC2329). Box setup 14's `box/update.sh` named
  only 0.9's code for it (SC2317), so CI failed on `main` after the merge. It now names both. The
  box's checks before the PR passed, as a box had Ubuntu 24.04's shellcheck 0.9. From setup 15,
  every box installs 0.11.0, CI's, from shellcheck's own release, checked against its checksum.
  A box on setup 14 takes it by itself.
- **What a box or the bot needs from you is checked, not only written (task #732).** Three gaps,
  each now held by a check that names the fix:
  - `ship pr` (and a task's box before its PR) refuses a change to what `box/setup.sh` runs that
    keeps its `SETUP_VERSION`, so `ship doctor` and the weekly clean-up name each box set up
    before it. #714 changed the firewall step and kept 13.
  - It refuses a change to the bot's or the repos App's permissions with no "Action needed" line
    in this changelog, which the update PR carries: GitHub gives an App made before a new
    permission only after you accept it (#729).
  - A `--manage` box whose Tailscale key expires (Tailscale's default: 180 days, then the box
    drops off your tailnet) is named at the end of `box add`, and by doctor on the box every
    week, with where to turn expiry off, until you do.
- **A take-down, bring-back or rollback from a task works (task #729).** GitHub refused to start
  the app's pipeline (HTTP 403): the bot had Actions: Read only. The bot now asks for Actions:
  Read and write; only the `github` job's token has it, never an agent's. The pipeline now starts
  before `SHIPIFY_DOWN` changes, so a refusal changes nothing, and it names the fix. **Action
  needed once:** on the bot's permissions page, set Actions to Read and write, save, and accept
  the change on its install ([setup.md](docs/setup.md#tasks-the-bot-and-the-agents-login)).
- **The Operate form lists every app you register or remove, not only the ones you publish (task #724).**
  `ship register` and `ship unregister` now open the same small forms PR that `ship publish`
  does, so an app added by hand (like `games`) shows up in the form, and a removed one leaves it.
- **A file you send is never pushed out of a run's files by the files runs made (task #717).** A
  run takes 5 of the chat's files: before, the 5 newest, so a file you sent while a run worked was
  left out once that run's reply posted 5 screenshots, and the next run asked you to send it
  again. Now your newest files come first, and runs' files fill the places left, in the chat's
  order. A run's file left out is named apart: the run reads it from "Files earlier runs made".

## [0.1.20] - 2026-11-09

### Added

- **Twenty-one weekly lessons in their skills (task #576).** `test-driven-development`: one value
  per input. `systematic-debugging`: where to look for a generic error, an empty list, a stale
  client, a CI-only failure, an OS error, and a stale output file; every caller of a shared step;
  every check on a fix's path. `plug-ins`: tool names stay out of `cli/`. `codebase-design`: four
  principles for designing on a service. `writing-skills`: run rules go in a playbook or skill.
  `drop`: `maskSecrets` on a page. `security-and-hardening`: service worker scope (and its first
  `scenarios.md`). `verification-before-completion`: hand over a file and check an earlier one.
  Each has a case in its `scenarios.md`. Skill text only: no version change.
- **Nothing by hand: workflow changes you approve in the chat, and a fix on main as its own task
  (ADR 0075, task #692).** A run never asks you to edit a file, apply a patch or copy words into a
  new chat (the playbook's rule). A run's own change to `.github/workflows/` or
  `.github/actions/` is held: apply sends the rest of its work with one commit, "Hold the workflow
  change for your yes", and the reply lists the change's exact lines with the box's facts (when it
  runs, the secrets and actions its new lines use). Your Yes pushes exactly those lines to the
  task's branch (workflows write, checked again, once), and opens the PR when the change was all
  the run made; `no` drops it. Only a change that runs after your merge is listed (Shipify's four
  workflows do); one that would run before it (a repo's PR checks, a project's `ship.yml`) is
  refused by `ship pr --check` in the agent's own session, or held and said. On another account
  the push is refused whole, as before. `first`: when `main`'s code blocks a task, the run lists
  one task to do first; your Yes opens it as a sub-task, links this task as blocked by it and
  starts it; its merge tells this task, and `continue` carries on. It never makes this task's PR
  `part-of`. One helper (`cli/kernel/workflows.ts`) finds the run's workflow change for all three
  checks. No new key, permission, setting or workflow change.
- **Codex on your ChatGPT plan, as a plug-in agent (ADR 0074, task #692).** `use codex`, or
  **Codex** in Who thinks: GPT-6.1 Sol (Auto, medium), GPT-6 Astra, GPT-6.1 Terra and GPT-6 Luna,
  low to ultra effort, and any new OpenAI model by its id, in the dropdown, `/models` and the
  Repeat form with no UI code (Codex 0.167.0, installed on a box the first time a run picks it,
  about 393 MB on a Pi). Sign in once with no PC: say `codex sign in` in a chat, and the reply
  shows a link and a one-time code for your phone (Codex's own sign-in, run by the github job on
  GitHub's machine; Plus or Pro, Go warns). Or on a PC: `pnpm ship setup agent codex` (your
  browser; `--device` for the code). The secret `CODEX_AUTH` holds the session, and after a run
  that refreshed it, `ship run renew` writes the newer session back (same account only), with
  the token step you added to `task.yml`. Shipify's gate is Codex's PreToolUse hook, so it
  refuses the same commands as every agent; Codex's own config, rules and bundled skills aren't
  read. Its commands can read its login, so a read run and a guest's go to the default agent, and
  a guest's picker leaves it out.
- **Guests share their own pages through Drop, private until they share them (ADR 0073, task
  #679).** Built in two parts after your `go`: Drop 0.6.0 (task #689: a drop's `by`, My drops,
  every new drop Only me), and this is Shipify's part (task #690). The chat makes pages and Drop
  manages them. A guest asks for a page in a chat and gets a drop only they can open, for 30
  days: the reply is its link and "Manage it in Drop" (their **My drops**, your drop list and drop
  page, reused, with only the guest options: a link, people by email, a new link, up to 30 days,
  delete). "Change it" puts a new page on the same drop, so the link stays. The page stays in
  their chat too. Every new drop, yours too, is Only me until its owner adds people or makes it
  open to anyone with the link. Sign-in is Google only, through Cloudflare Access, for both apps
  (your one-time step in `docs/channels.md`, Guests; until you switch, the email code works).
  - **A tool's guest forms:** `tools.json` gains `guest`, `pre`'s shape with no fixed target
    (`cli/lib/plugins/tool.ts`). Drop's: `publish` with `share` fixed to `me`, and `update` of a
    drop's title and files; 5 of each a run. Your merge approves them; a guest's words still
    approve nothing.
  - **The box:** decide keeps a guest's calls that fit a form and makes them at once, after the
    web too, as they share nothing; the reply names the rest. A guest's prompt lists the
    connected tools' guest forms. Apply asks the door who the guest is (`GET /door/guest/<id>`,
    task.yml's OIDC token only; a removed guest makes no call), takes their files from the run's
    folder, and starts the tool with `SHIPIFY_GUEST`.
  - **The Drop tool:** `publish`'s `share` is optional, and Only me when left out, with how to
    share it in its answer. Its guest mode makes a drop `by` the guest, only theirs, 30 days at
    most; changes only the title and files of a drop `by` them; and never names their email. Your
    `list` shows "only Ana" or "for Ana" on a guest's drop.
  - **Docs:** `docs/tools.md` (Guests' calls; Only me first), `docs/channels.md` (Google sign-in,
    seats, a guest's pages), `docs/door.md`, `docs/security.md`, `docs/tasks.md`,
    `docs/troubleshooting.md`, `docs/plug-ins.md`, `docs/glossary.md`, `playbooks/guest.md`,
    `skills/drop` (no who said is `me`; a guest's page), the setup page's guests line, and ADR
    0073 accepted and built, with As built; ADR 0071 and 0072 amended.
- **ADR 0075, proposed (task #692): nothing by hand.** A run never asks you to edit a file, apply
  a patch or copy words into a new chat. A workflow change a task needs is committed as any
  change: the box holds it back, pushes the rest of the work, and lists the exact lines under its
  reply with what they can reach. Your Yes pushes exactly those lines to the task's branch, and
  your merge still decides what reaches `main`. It's listed only when nothing it changes runs
  before your merge, which Shipify's own workflows meet. When `main`'s code blocks a task, the run
  proposes the fix as one task first (`first`): your Yes opens and starts it, and `continue`
  carries on once it merges. No new key, permission or workflow change. Nothing in it is built
  until your `go`.
- **ADR 0074, proposed (task #692): Codex on your ChatGPT plan, as a plug-in agent.** An entry, an
  adapter and a recorded run, with no core change. The model dropdown, `/models` and `use codex`
  show it with no UI code. Your personal plan only, for now: you sign in with ChatGPT once, and
  the box writes the session Codex refreshes back to the secret `CODEX_AUTH` after a run. A
  Business or Enterprise access token is left for later. OpenAI's plans page lists Codex on Go
  for the desktop app only, so setup warns on Go. Codex reads its login from a file its commands can read, so it
  never thinks for a guest's run or a read run. Nothing in it is built until your `go`.
- **Pages, like Claude's artifacts: ask in the chat, get Drop's link (ADR 0072, task #679).**
  Built in two parts after your `go`, with no new service, key or setting: Drop 0.5.0 shows pages
  (task #682), and this is Shipify's part (task #683). Ask "make a page of my trip plan" (and, if
  you want, "share it with Mom and Dad for 7 days"). The run makes one self-contained `.html` page
  and gives it to Drop in the same run (the pre-approved `publish`, only you unless you said who).
  The reply is only Drop's link, which opens the page, sandboxed, with **Share** at the top. A
  change ("add Tuesday's dinner") is one `update` for your Yes, so the link stays the same.
  - **The box:** a file that a call took, when the call worked, is left out of the reply's files,
    its **Files:** block and the web chat's store: the call's answer (Drop's link) stands for it.
    It stays on `shipify-files`, where a later run reads it. When the call fails or waits for your
    Yes, the file shows as before. This is for any tool's call: the core names no tool
    (`cli/kernel/apply.ts`, `callFiles` in `cli/kernel/mcp-client.ts`).
  - **Skills and playbooks:** `skills/frontend-design` has "A one-file page" (everything inside
    the file, what works and what doesn't in Drop's sandbox, links in a new tab, small screens
    first, light and dark, under 1 MB) and a `scenarios.md`; `skills/drop` has "A page" (its drop
    in the same answer, alone, the reply its link, a change by one `update`).
    `playbooks/task.md` points to both; `playbooks/guest.md` says a guest's page is a file in
    their chat.
  - **Docs:** `docs/tools.md`, `docs/tasks.md`, `docs/glossary.md` (**page**), and ADR 0072
    accepted and built, its findings in As built. The playground stays on Cloudflare: the ADR
    compares GitHub Pages and says why not.

### Changed

- **A stay makes the change you ask for itself, with no new run (ADR 0076, task #708).** A run on
  a project's clone that stays after its answer used to hand a change you asked for to a new work
  run, which cloned, set up and read the whole thread again. Now the stay's turn commits in the
  same session, the box checks it, and the stay's own job pushes it and opens or updates the PR.
  `work` starts a run only on a project or repo the run has no clone of (a talk run's first
  change, another repo); a work run's `work` for its own project starts nothing, and the reply
  says so. A push in a stay is no longer taken for the run's earlier push in the same job (apply's
  journal key names the words it answers), and the box's "A work run … starts now" line is said
  once. A new model or effort already kept the session (ADR 0063). A new run still comes for
  another agent, `start over`, `go`, an edit of the task, and your words after a stay's push.
- **`--manage` boxes take connections only through Tailscale (setup 13, task #708).** The
  firewall no longer lets SSH in from the box's own network, nor Tailscale's port (41641/udp):
  Tailscale connects from its own outgoing traffic, or else through its relays. Running the setup
  again takes those rules out by their comment; your own ufw rules stay. A session from the home
  network that runs it goes on, and the setup says the next one must come through Tailscale.
  Avahi (mDNS), which a Pi's image has and ufw lets in by default, is masked, so nothing on the
  home network gets an answer.
  `box add` asks a box's Cockpit address before the setup and removes the setup's folder in the
  same session, so it needs no new SSH connection after it, and says to set the alias's
  `HostName` to the box's Tailscale name. With Tailscale down, the way in is a keyboard on the box
  (a VPS's web console). `ship doctor` names the boxes to set up again.
  Every path ends locked down or says it isn't: the firewall comes right after Tailscale's
  sign-in, before Cockpit (a Cockpit that didn't serve left it off), and fails when Tailscale
  isn't up. The setup is recorded as done only once `--manage` finishes; else it ends "Done,
  except --manage" with exit 4, `box add` says the firewall may not be on, and `ship doctor` names
  the box until a run finishes it. `here.sh --manage` turns SSH passwords off too, once your
  account has a key. `box add` over SSH without `--manage` says it gets no firewall, and an SSH
  that times out names the box's Tailscale name.
- **Sign-in, written as one setup for Shipify and Drop (task #679).** `docs/channels.md`
  (Guests) now has one table and six steps in place of two partial lists: Google is the one
  login, for you too; three policies are made once and reused (`owner`, `anyone with Google`,
  `shipify service`), each requiring Google, so an email code can't let anyone in; four
  applications each say which policies they use; then you test and delete the One-time PIN. The
  rule throughout is that Access says who someone is and each app says what they get, so a guest
  is added in one place only. Docs only: no code or setting changes.
- **Leaner and cleaner, from an efficiency audit (task #697).**
  - **Docs: one home for each fact.** `docs/setup.md` lists every key once ("Tokens and
    secrets"), now with each run's own tokens. `docs/security.md` keeps what each key may do, now
    with Drop's two tokens and OpenCode on OpenRouter. `docs/design.md` and `docs/product.md` link
    to them instead of their own tables. The road in `docs/product.md` is current: ADR 0047 is
    live, the template is public under the MIT licence, the box's image is built, and setup's core
    is four steps. ADRs 0027 to 0032 say accepted and built (0029: superseded by 0031).
    `docs/README.md` lists `knowledge.md` and the glossary once. `docs/design.md` and
    `docs/tour.md` name every command the door answers at once, and every agent.
  - **Runs on a box: fewer processes and calls.** A stay reads the task every 2 s through Node's
    `fetch` on one kept connection (GitHub Actions' `GITHUB_API_URL`), not a new `gh` process a
    read: a 20-minute quiet stay started ~760 of them, ~3.5 CPU-minutes the other slots needed. An
    agent's install that's marked done is only put on the `PATH`: no `chmod -R` of its files and
    no `--version` start (4–6 s off each pi run). A run's `stop` check every minute is an ETag
    read, free when nothing changed; decide reads the comments since the task step's read once,
    and apply takes them (one read less a run); decide's step reads nothing else of GitHub (1–5
    calls less with a deploy, a release or an errand pending). A work run's clone finds the task's
    branch in what it cloned (no `ls-remote` and second fetch), and apply's clone (its push, and
    a held workflow change's read and push) makes one fetch, not two calls (~3–5 s a work run).
  - **The edge: fewer calls a watch tick and a web chat tab.** The notice duty reads the door's
    marks on every reply it might notice in one GraphQL call, not one a reply each tick (about 14
    a reply over its window), and knows the door's bot by `SHIPIFY_DOOR_SLUG` (no `GET /app`, at
    the door's `/door/replied` too). Telegram's webhook and menu (every 30 minutes) and the
    runners' newest release (every 6 hours) go by the tick's number, so a tick on a new edge
    instance doesn't read them again (about 4 calls a quiet tick). The stopped duty finds a
    working task's run in the task runs' list it read already, and reads a run alone only when
    it's older than the list's 30. Notebook's reads carry their ETags and the Library's pages are
    kept a minute. A wide-screen tab reads the list every 30 s while a run works, not every 5 s
    (the thread shows the run): ~10 reads a minute less.
  - **The prompt: each run gets only what applies to it.** `playbooks/task.md` marks its work-only
    parts (lanes, checks, the PR's shape) and its "Later runs": a talk run gets neither work part,
    and a task's first run no "Later runs". Each rule is said once (the prompt's header, Finish and
    result fields, the notebook's section, a skill), and the repeats, own-rules and lesson rules
    live in their skills. A talk run's prompt is ~8.7k characters shorter (about 2k tokens, a
    third less), a work run's 3.0k–4.4k (11–17%).
  - **Code: smaller, one copy of each thing.** Gone: names nothing used (`madeFiles`, `getComments`,
    `markedGuest`, `deployRun` and others), and what removed features left (the fake door's send
    route, `SHIPIFY_TASK_FIXES`'s `fixesLine`, `ship connect`'s `contents`, `Kv.getWithMetadata`).
    One copy each, in `cli/contracts` where the box and the edge share it: the images guard
    `inertImages` (a security check, so it can't drift), `timeUntil`, the run writer's login,
    `boxOf` and the box and status labels; the agents' `oneLine`, `asResult` and gateway model
    name; GitHub's `gh` and `withToken`; the `preview` label (one colour). `decide.ts`'s 28 answers
    with no agent go through two small helpers (`answered`, `told`), not the same lines each time.
  - **Checks: nothing left on the disk.** Each test run has one temp folder, removed after it: a
    run left ~700 folders (~240 MB) on the disk before.

### Fixed

- **Runs stay where they should, and a stay can put a refused push right (ADR 0076, task #708).**
  A run on a task your words reopened (after its PR merged, or its app went live) now stays after
  its answer: plan reopened the task but kept a read that said closed, so it never stayed. A stay's
  turn that commits nothing needs no key: it named its open PR again, git refused an empty bundle,
  and the turn before's bundle was taken for its own, so the box ran its checks, sent the old
  commits again and ended the stay. A stay's fix on top of a push the secret scan refused is now
  sent with the refused commits (its bundle had no base GitHub knew), and the turn is told what
  went wrong after its last answer.
- **Box setup: no token left behind, and nothing said "only" that isn't (task #708).** `box add`
  removes its folder (the one-hour registration tokens) as you, after sudo, in the same session:
  a wrong sudo password left it on the machine. With `--manage`, a ufw rule of your own that lets
  something in (a VPS guide's `ufw allow OpenSSH`) is listed, with how to take it out, instead of
  "in through Tailscale only"; ufw's IPv6 goes on where it was off; the setup's record is written
  as the `shipify` user (a link can't send root's write elsewhere); exit 4 says to run it again
  over Tailscale when SSH from your network no longer answers. Doctor's fix names the command the
  box was set up with, not always `--manage`.
- **`plan check` refuses a summary over 350 characters (task #709).** Publish makes a plan's
  `summary` the GitHub repo's description, and GitHub refuses one over 350 characters, so a
  418-character summary passed `plan check` and then stopped publish. The plan's schema now caps
  it with a message that says why; nothing is cut short by itself. The plan template notes the
  limit.
- **The bare address works for everyone, guests too (task #679).** `<the edge>/` always sent
  people to your `/admin/chat/`, so a guest got Access's "no access" page unless they typed
  `/guest/`. Now Access's sign-in cookie, checked as its token is (the signature, the audience,
  the team, the time), sends you to your chat and a guest to theirs; with no cookie, or one that
  doesn't check out, a small page shows two ways in: **Sign in as a guest** and **Owner**. It
  only sends people on, and needs no GitHub read without a cookie (`edge/src/web/home.ts`). At
  `/guest/`, a signed-in email that isn't on the list gets a page that says so, with the way to
  your chat, in place of raw JSON (the page's own calls stay JSON). `/admin` still goes to the
  chat. Main's checks are green again: one comment's indent in `cli/commands/workspace.ts`.
  `docs/channels.md` (Guests) and `docs/door.md` say how.
- **The web chat: a project's count of chats is what it shows.** A project's group in the list
  said GitHub's total, closed chats too, so under Open it said "3 chats" over the 2 open ones. It
  now counts the chats it shows: its open ones under Open, its closed ones under Closed. The
  Desk's line for a project counts the open chats it shows too. A project's screen keeps the
  total, as its Chats tab lists them all.
- **A workflow change you make on a task's branch no longer blocks its later runs (task #692).**
  A run never pushes a workflow file, but the box's check and its push also refused a branch that
  held one you added yourself on GitHub, so every later run on that task stopped. Both now let
  through a workflow file that is exactly as you left it on the branch on GitHub (your two edits
  on main), and still refuse any change a run makes to one. Tests hold both, and the format of the
  first edit's comment is fixed.

## [0.1.19] - 2026-11-05

### Added

- **One window, and guests in it (ADR 0071, task #662).** Built as one PR after your `go`, with no
  new service, store or key:
  - **Guests.** Make a second Cloudflare Access application once (path `guest/*`, One-time PIN)
    and add its AUD tag to shipify's `SHIPIFY_ACCESS` variable as `"guests"`, beside yours, on
    GitHub (on within a minute; `ship door page` keeps it; no page can set it); then, in
    **Setup → Guests**, **Add** a guest (an email and a name) and send
    them `<the edge>/guest/`, or **Remove** one (refused within 10 s, their open chats close). The
    list lives in one R2 object. A guest gets the same window with only their own chats, projects,
    docs and files: every route says whose it is (`WHOSE`; a route with none answers 404), a
    guest's list reads by their label, a thread opens only when the door's line names them, a file
    only by their prefix. Their marks: labels `guest` and `guest:<id>`, `"guest"` on the door's
    from-line, `g<6 hex>-` on file refs and project names. The door refuses, writing nothing, what
    only you say (`remember`, `forget`, `jot`, `/tasks`, `/apps`, `yes <code>`, `go`, `publish`,
    `preview`, `start over`). Your list (now 100 a page, one read), Find, Library, `/tasks` and
    digest leave guests' things out.
  - **Guests' runs** use your agents, models and login, in a fourth profile, `guest`: no GitHub
    key, notebook, tool or repo of yours, caches of their own, words that approve nothing, files in
    R2 only (never `shipify-files`), docs only in their own project; a guest's stay hands its agent
    no token.
  - **The window:** a project's screen (Overview · Chats · Docs · Files); docs open in the pane
    with **Edit**, refused when the doc changed since you opened it; a shipify issue link opens in
    the window; the list's head keeps **New chat** on one line (Find is an icon beside Refresh),
    and a project's long chat titles on the Desk end in "…"; the list keeps each open project's
    chats under it whatever the tab, Needs you opens each group and shows a project that needs you
    as its own row, and Open counts chats, not projects; a link to a project's doc opens it once,
    in the pane over its project's Docs, with **Download** (Markdown); a reply's files are chips from R2 (**Archived** once gone, linked to the backup);
    Files by project and chat, past 500; the Library keeps what is no project's; a **Find** button
    on any device.
  - **Files and docs:** every run file gets an R2 copy, named on the reply's line, whatever chat
    the task came from; the next run in the chat gets the chat's newest 5 files, a run's too; one
    new doc a run at most, named in its reply; a new doc's link is its issue's page.
  - **A PDF opens in the chat on a phone too.** A browser with no PDF viewer of its own (Chrome
    on Android) showed only an **open it** link; now pdf.js 6.5.438 draws its pages in the pane,
    in `/pdf/`, a sandboxed frame like the diagrams' (pinned with SRI hashes, handed the file's
    bytes alone). A PDF it can't read says so, with Download.
- **The `pdf` skill: real PDFs from runs, yours and guests'.** The box has no PDF library, so a
  run wrote a PDF's bytes by hand. Now a run writes the page as HTML and prints it with
  `skills/pdf/pdf.mjs` (headless Chromium, Playwright's, installed once a slot when missing; a
  guest's run, with caches of its own, installs it each time, about 30 s), then reads the PDF to
  check it. The task and guest playbooks point to it.

### Changed

- **Faster from the web chat to a reply, for you and your guests (task #673).** Measured on
  homepi over 54 runs: a new chat answers in its thinking time plus 37–56 s, and a staying run's
  answer in its thinking time plus 4–11 s. This change takes out the waits that are Shipify's own:
  - **A reply shows within 5 s of landing.** The edge kept a read 8 s, longer than the page's
    5-second poll while a run works, so a thread was read again only every 10 s, and the read a
    push asked for could be the kept one. A read is now kept 4 s: each poll reads GitHub (an
    unchanged answer is a free 304). Your words on a task also drop that thread's kept reads, so
    the read after **Send** shows them and the page keeps its pace for the run (a kept read from
    before them made it wait 30 s).
  - **A staying run's next answer starts 2–3 s sooner.** Its 👀 and `working` are written while
    the agent starts, not before it.
  - **A box checks the state labels once a day,** not in every step that saves a status: plan,
    apply and a stay's first turn each read the label list (~0.8 s from a Pi). The mark is in
    the runner's own cache; a label deleted since comes back, grey, with the write that sets it.
  - What's left, and what only you can change (the token steps in `task.yml`, the runner's own
    cache of actions), is in `docs/roadmap.md` under "Faster and cheaper runs".
- **The weekly digest says when an agent is behind, and an advisory against one first (task
  #673).** The pins in `executors.json` had not moved for a month (Claude Code 2.1.284, and
  2.1.318 is out), and nothing said so. Once a week, two reads an agent with no key, at the URLs
  its install now names in `executors.json` (`newest`: npm's latest; `advisories`: GitHub's
  advisories for its package at the pin): `Agents behind: claude 2.1.284 → 2.1.318, …`, and an
  `Advisory:` line, which isn't all clear, for any advisory against a pinned version. The core
  names no installer: the URLs are the plug-in's data. Nothing is installed: a version still
  moves in one PR checked live, and `docs/agents.md` ("A new version") lists its steps.

### Fixed

- **A new box's setup goes on when a stack's tool doesn't install (setup 12, task #673).** The
  stacks' browser libraries (`playwright install-deps`) ran under `set -e`, so on an Ubuntu their
  installer didn't know yet, the whole setup stopped before the box's users and runners existed,
  with no hint. Now it says "skipped", and `pnpm ship doctor` says it again with its fix. `box
  add` and `ship doctor` name 26.04 beside 24.04, and `here.sh`'s test lets 26.04 through.
- **A note with two dates is one note (task #673).** Lines written before 2026-11-02 can end
  "(2026-10-09) (2026-10-09)", and a new `remember:` of the same words was added again beside
  them. Both dates are read as the line's date now.
- **The weekly lessons read every page of comments (task #673).** The recipe's read had no
  `--paginate`, so GitHub's first 30 comments were all it saw of a busy fortnight.
- **An open chat now sees every deploy, not only a release.** The list's and the menu's `version`
  was Shipify's release number alone, which stays the same between releases. So a chat kept open
  on a phone never offered **Updated: tap to reload**, and ran the page from before a fix (a
  project that needs you, with no row of its own under Needs you). The version now carries the
  commit deployed (`0.1.18+5ee9816`): an open chat reloads by itself when it wakes, or offers it.
  An open group in the list points down (v), not up, beside a shut one's >.
- **A chat's Progress kept current.** Every run's Finish now says to bring `handoff.md` up to
  date before the result: it is the chat's Progress, and runs often left the last one unchanged.
- **Closing a project closes its chats.** **Close** closed the project alone, and its chats stayed
  open for good (the 30-day close skips a project's chats). The door now writes a project's `close`
  as words, as a part's, and its run closes the project's open chats as done, as a clean start
  does: but one a run is on, or a repeat or an errand keeps open, which the reply names.
- **A project that needs you shows where to answer.** **Collate** and **Check the project** wrote
  on the project's own thread, so their question waited under the Overview, and the box there
  could only start a new chat. Each now starts a chat in the project, as any ask does. When the
  project's own thread still asks you something, its next step says so and the box answers it; the
  chats waiting on you show as links under the next step.
- **A project's group never shows empty.** Its fold read its chats past the list's page with a
  body of `0` on a GET, which the browser refuses before it's sent: so those chats never came. The
  page's reads send no body unless there is one. Under **Closed**, a closed project is now its own
  row, with its closed chats; a group with nothing to show says "No open chats." The list puts
  projects as cards under a **Projects** heading, their chats indented, and the rest under
  **Chats**.
- **A repo's page counts only what's open.** Its Open, Needs you and Working counted the chats this
  device kept from when you last opened them, in the state they had then: a chat closed since still
  counted, said Needs you or Staying, and "0d ago". It now counts and lists what the list has open
  (all of yours, 100 a page), your close or reopen at once; so do Ctrl+K's recent chats, and a kept
  chat found by name shows no state. On a phone its three figures sit in one row, a chat's title
  takes two lines at most, and Docs with no files says so in one line.
- **A project's group in the list shows only open chats.** It read its chats once, when first
  opened, and kept that copy: a chat closed later stayed under it as open till a reload, and under
  **Closed** a closed chat showed twice. Its open chats are now the list's alone, with no read;
  under **Closed** it reads its closed ones each time Closed opens, each shown once. **Older
  tasks** shows again when your open list has more than a page: a read's "last good copy" mark had
  taken its place.
- **Boxes on Ubuntu 26.04 LTS (setup 12).** Checked in an Ubuntu 26.04.1 container: every package
  setup installs is there, sudo-rs takes the agents' rule and the runner's `sudo -n -u` and
  `--preserve-env=`, the slot and run folders keep their setgid bits under uutils, and the GitHub
  runner's own dependency check passes. One thing broke: 26.04's Podman 5 takes pasta for a
  container's network, and setup installs only the exact list, without passt, so no agent's
  container with a network started. The agents' Podman now uses slirp4netns on every Ubuntu, as
  24.04's does by itself. The guide writes 26.04 for a new box (and the new-disk steps' image),
  and says to move a box to it fresh, not with `do-release-upgrade`. Run a box's setup again
  after an upgrade in place; `ship doctor` names a box on setup 11.
- **Tests pass on Ubuntu 26.04.** GitHub's `ubuntu-latest` now starts main's ci on Ubuntu 26.04,
  whose coreutils (uutils) `mkdir -m 2750` sets no setgid bit. A sandbox check leaned on it and
  failed there only (750, not 2750). Its slot folder is now made as the box's setup makes it
  (2711), so out/ takes the bit from the folder above, as on a box. A box on 26.04 runs as before:
  a run's folders take the bit from the slot folder (checked in a 26.04 container). The failing
  `stop` read's test waits 2.5 s, not 20.
- **Tests never start the real gitleaks.** Apply's push scan had no stand-in in the tests, so every
  flow test that pushed started the real one, fetched from GitHub first on a fresh CI runner. On a
  Raspberry Pi 4 it takes about 34 s a start (the scan itself, 41 ms), so such a test took about
  40 s. Every test now has a stand-in (`tests/fixtures/fake-gitleaks.mjs`), one test runs the
  pinned gitleaks with Shipify's rules, and a new flow test proves a change with what looks like a
  key is never pushed, its reply naming the file and line.
- **Tests start the built CLI.** Their about 150 `ship` commands a run started the source through
  tsx, 2.2 s each on a Raspberry Pi. Each test run now builds the CLI once (`tests/built.ts`, about
  1 s) and starts that, as a box does: 0.7 s each. An edit still needs no build of yours.
- **A guest's run holds nothing of yours (the #662 audit).** Its commands' environment had your
  login, your people list (names and chat ids), the door's slug, your repo and your copy's
  values (Cloudflare account, domains): `env` showed them. It now starts with `LANG` and
  `SHIPIFY_TASK` alone. "collate the inbox" in a guest's project reads the items the door wrote
  for that guest (it read none); a project's close closes only the chats on its own side; the
  door refuses every fixed word a guest never says from the box's own list (`clean start`,
  `no <code>` and `go.` were missed), and a plain `yes` or `no` still answers their run.
- **A project is open or closed, and every screen shows which (the #662 audit).** A closed project
  was still offered New chat, Add, Collate and Check; `add <name>: …` made a new chat and a run;
  `remember <name>: …` made a notebook page every run reads; `project: <name>` made a second
  project; the Library listed it as open, and a doc or a file of it lost its project. Now:
  - one index of every project, open and closed (one read, kept a minute), for the Library
    (open projects, then **Closed projects · docs kept**), a doc's way to its project, Find and
    Files, which mark it "closed";
  - closed, its screen says when it closed, what stays and when its files go, and shows
    **Reopen** and **Export** only, with no box; a run in it keeps no page and is told why;
  - `add`, `remember` and `project:` with its name write nothing: "<name> is closed · #n: Reopen
    it first";
  - **Close** asks first ("Close games and its 2 open chats? Its docs stay in the Library,
    read-only. Its files go from 5 Dec, unless you reopen it before."), and its reply says the
    same, every time; **Reopen** says its chats stay closed, and how to open one;
  - a chat left open under a closed project closes after 30 quiet days, as any chat does.
- **The weekly clean-up clears everything by itself, and says when it can't (the #662 audit).**
  Files no chat used (an upload never sent, an old draft's, a message answered at once) stayed in
  R2 for good: they go 60 days after they came. A clean-up missed for over 30 days never caught
  up, and read 100 closed chats at most: it now reads from 30 days before the last clean-up, past
  100. More than 500 chats in one forget were refused every week: the box sends them 500 a call.
  A failed clean-up was only a line on the status task: the record keeps what it did, two failed
  in a row post an alert, and the weekly digest has a **Files** line (deleted, MB, with no chat,
  failed).

## [0.1.18] - 2026-11-03

### Added

- **One place for ideas, research and building (ADR 0070, task #655).** The pitch is "your own
  assistant for ideas, research and building", with one loop: Capture, Keep, Think, Ship, Share
  (`README.md`, `docs/product.md`, `docs/knowledge.md`: the desk, when to do what, growing a
  project). Built in five parts, with no new service, key or store:
  - **Keep it.** A run's page write leaves a page whose text changed after the run read it (your
    edit, another chat's run), and says so: nothing of either is lost. A project's main page has
    **Now** (where it stands, what's next, open questions), the **Map**, and at its foot a **Log**
    the box keeps: a dated line for each run's page writes, the newest 20. A new project's main
    page starts with an empty Now and Map. **Sources** (`<name>-sources`) keeps a key per source
    that facts cite, and a synthesis matrix on ask (`skills/knowledge`). **Keep on page** sits
    under an answer in a project's chat, on every channel; it and "keep this on the page" file the
    reply's key facts on the pages, linked back, with Now updated.
  - **See it.** A project's page in the web chat shows its Now and one next step, worked out on the
    edge from counts its Library read has: a chat waiting on you, 10 finds in the Inbox (its
    collate line now counts the items it took), a first question, a first answer kept, a check
    while questions are open, Close. "check the project" lists contradictions, facts with no
    source, stale facts and findings that never reached a page, and writes nothing until "fix
    them". The weekly digest has a **Projects** line: finds to collate, chats waiting on you or
    quiet a week, from one GraphQL read made only when it's said.
  - **Find it.** Ctrl+K ends with **Find by meaning**: the edge's `api/search` asks GitHub's hybrid
    issue search for your chats, projects and pages, kept a minute a query; past its 10 a minute
    it searches by words and says so. It reads no comments, so an Inbox item is found by words.
  - **Say it.** A repo Shipify builds is an **app** or a **package** in what you read, and
    "project" means one you make (`docs/glossary.md`; Ctrl+K says Repo). The code keeps its names.
  - **Start clean.** `clean start`, a fixed word, lists with no run the open chats outside your
    projects that nothing keeps open; on `yes` the box reads them again and closes each as done, as
    the 30-day close does. Nothing is deleted at once.
- **Projects you make (ADR 0069, task #631).** `project: games` from any chat (or **New project**
  in the web chat) opens an issue `Project: games`, labelled `project`, its brief its body, with no
  run; `project: shop repos: shop-api, shop-web` names the repos it owns. Its chats are its
  sub-issues (**New chat here**, or **Move to project** with the `in-project` label), 100 at most.
  A chat's run gets the project's brief, its other chats and their states, and its pages; the
  family read takes both levels and 100 sub-issues. A project never closes with its chats and is
  never a split parent; a chat in it splits as any task does. With one repo, a change asked in a
  chat goes to that repo.
- **A project's pages, as data (ADR 0069).** Notebook pages labelled `library` and
  `project:<name>` (`Notebook: games`, its Map first) reach that project's runs in a section of
  their own, read as data, sharing the notebook's 16 KB after Preferences. `remember games: …`
  adds a line to the main page. A run rewrites a page through `pages` in its result (the page's
  whole text, in a file), and the box writes it with the notebook's checks: its own project's
  pages; a Library page of no project only when the run read nothing from outside; never a page
  every run reads.
- **The Library and the Journal (ADR 0069).** A `library` page with no project reaches no prompt
  until a run asks (`ship notebook list`, `ship notebook read`, which now read the Library too).
  `jot: …` adds a dated line to this month's `Journal YYYY-MM` page, and `add <project>: …` an item
  to the project's Inbox page: the door writes both at once, with no run. "collate the inbox" hands
  the run the Inbox's items after its last `Collated up to item <id>` line, yours alone, and their
  files. `docs/knowledge.md` is the process; `skills/knowledge` is how runs keep the pages.
- **The web chat's files in R2, kept as long as their work (ADR 0069 part 1).** Every file you
  send goes to one private R2 bucket, `shipify-web-files` (bound as `BUCKET`; the edge's deploy
  makes it), streamed, up to 100 MB, with its chat's number; a new chat's files get theirs when
  the door opens it. A file dragged into another chat is copied once for it; a file taken off the
  box is deleted; Files lists every file newest first, by chat (and **No chat**), with its size,
  **Delete** and the total. The weekly clean-up deletes a closed chat's files 30 days after it
  closes (an open project keeps its own), through the door's `POST /door/files/forget`, which
  takes only watch.yml's OIDC token. A run's files reach the edge up to 50 MB a reply. A file you
  sent shares as a drop by its ref (`web:f-…`), with no copy on the `shipify-files` branch. The
  files in KV are copied to R2 once, under their old keys, so old refs still open; KV keeps only
  your model and your devices. The deploy token needs **Workers R2 Storage: Edit** (it had it).
- **Drag and drop anywhere (ADR 0069 part 1).** A drop anywhere on the page attaches, with a
  "Drop to attach" cue; on the list or a project's page it opens a new chat with it. A file in
  Files or the doc pane drags into the box, **Share** sends it as a drop, and a paste over the
  limit offers **Attach as a file**. A drop never sends.
- **Progress and a lighter prompt for long threads (ADR 0069 part 3).** A run's handoff is seeded
  with the last one (`out/handoff.md`), so a short run can't wipe it, and kept to 16,000
  characters; the web chat shows it as **Progress**, folded above the thread. Past 40 KB of
  conversation a run gets the newest 8 messages and every new one whole, and each older one as a
  line; `ship task read <id>` prints one whole. A 200-message thread's prompt goes from 500 KB to
  about 85 KB. The prompt lists the files earlier runs made. A run's start-up reads are one
  GraphQL read (2 calls before the agent starts, from 5–6), and the playbook's rare how-tos moved
  into skills (`new-project`, `own-rules-repo`, `repeats`, `recipes`): 3.7 KB less on every turn.
- **Export (ADR 0069 part 7).** `export.js`, loaded on first use, builds a project's zip in the
  browser with no library (README, `ALL.md`, pages, inbox, chats, files, `project.json`), and
  **Export everything** of Files; no run. It says the size, then downloads, or puts the zip in a
  new message to share as a drop.
- **The Desk and projects in the web chat (ADR 0069 parts 4 to 8).** The first screen is the Desk
  (`desk.js`): Needs you, Working, Projects with their open chats, the Library pages opened last,
  Jot and New project; a phone's tabs are Desk, Projects, Files, Library, Setup. Projects come
  first in the list, folded with their chats. A project's page (`project.js`) lists its chats and
  pages, with **New chat here** (`under` on the send), **Add** to its Inbox, **Export** and
  **Collate the inbox**; **Move to project** is on every chat's menu (`POST …/api/move`). The
  Notebook view is the Library, grouped by project. The Repeats page and the Notebook view moved
  out of the page into lazy parts, so the page stays at 40.8 of its 42 KB.
- **A `do` option for Cloudflare apps: Durable Objects (ADR 0068, task #615).** `options: [do]`
  in a plan gives a ts-worker or ts-static app live state and WebSockets in its own Worker: a
  starter class `Counter` (binding `COUNTER`) in `src/worker/objects/`, declared in
  `wrangler.jsonc`'s `exports` with SQLite storage (staging inherits it and gets its own bindings),
  exported through one line of the entry, and a test. `localWorker()` (`tests/unit/support/`)
  starts the whole Worker with wrangler's `unstable_startWorker`, with no new dependency; coverage
  leaves `src/worker/objects/` out. Classes only add: the deploy stops before any change on a
  deleted, renamed or moved class, non-SQLite storage, or `migrations`. Such an app gets no PR
  previews (Cloudflare makes none), and the deploy token needs no new permission. ts-worker and
  ts-static 1.2.0; nothing changes for an app without it.
- **The Drop tool for Drop 0.3.0 (task #607).** `drop.list` shows each drop's link (Drop now
  keeps it), or its people link; a `query` that finds one drop (by title or id) shows its files and
  limits too. `drop.update` also takes `title`, `expiry` (from now), `limits` (`{"mb", "files"}`),
  `files` to add (ones the task shared) and `delete_files`. A change of `share` keeps the link.
  The `drop` skill gives the link from `list` instead of a new link, which stopped the old one.
  Drop must be 0.3.0 or later.
- **A new drop you ask for needs no second `yes` (task #607).** `drop.publish` is pre-approved in
  `tools.json` (one a run, in a run that read nothing from outside): "make a sample doc and share
  it" makes the drop in the same run, and the reply has its link. A pre-approved form takes `any`
  (fields allowed with any value), and a call that only makes something new (`"new": true` in its
  `args`) needs no target to fix. The box shares an answer's files before it makes the answer's
  pre-approved calls, so such a call may name a file the same answer made. Changes and deletes
  (`drop.update`, `drop.revoke`) still wait for your Yes.
- **Answer who asks to open a drop (task #607).** `drop.list` with a query that finds one drop
  shows who asks to open it, and `drop.update` takes `requests` (`{"<email>": "view", "add" or
  "deny"}`), as Drop's Requests page answers them. The tool's requests were checked against the
  admin page live Drop serves.
- **`drop.list` shows the space your drops use (task #607)**, of Drop's cap ("Used 1.5 MB of 9 GB
  in Drop."), each file's size when a query finds one drop, and an expired drop as expired. All
  of it comes in the answers `list` already asks for.

### Changed

- **A run's context, simpler and said once (task #655).** A chat's prompt lists its project's
  newest 30 chats and every one at work, waiting on you or failed; the rest are counted, with the
  command that lists them. A page shown whole has no index line as well, and the rest are listed
  by title and first line under how to read one. A project's run is pointed to your other
  projects' pages (`ship notebook list`), with no new read. The task playbook points to the
  prompt's notebook, pages and Finish sections instead of saying them again, and the glossary
  names Progress and the handoff as one thing. `docs/knowledge.md` has a short "What a run gets".
  ADR 0070, proposed, plans what comes next: Shipify as one place for ideas, research and building,
  with ten upgrades on the same store (Keep on page, Now, Log, Sources, Check, search by meaning
  through GitHub's own issue search, and more). Nothing in it is built until your `go`.
- **Less waiting around a run (task #645).** Plan reads a task's open PRs and your repo lists at
  the same time, and a box keeps the repo lists 10 minutes in the runner's own cache, so a run
  soon after another skips two calls (about 2 s measured); a task that names a repo the kept list
  hasn't got reads it again. Each step's timing line, with its `gh` calls, is in the job's log now
  too, where GitHub's API reads it. The door reads a reply's comment, its 🚀 and its settings at
  once.
- **A run knows where its browser is (task #645).** The task playbook says a UI check or an e2e
  test uses Playwright's headless Chromium in the slot's cache (`playwright install --only-shell
  chromium`, once a slot, no `--with-deps`), beside its Containers rule.
- **No task closes after a quiet day (ADR 0069 part 2, task #631).** An answered task stays open;
  with no new word for 7 days it folds into **Quiet** at the foot of the web chat's list (opening
  it reads the next page), and comes back up when anyone writes. Only a split's part still closes
  a day after its answer; due lists only answered parts. The weekly clean-up closes, as completed,
  a chat outside a project quiet for 30 days with no open PR, repeat, errand or open part, and not
  waiting on you (`needs you`), its status line saying so; writing on it opens it again. Its two
  new steps run once a week in all, however many boxes (the status record keeps their time).
  "Closes by itself" is gone. A task's folder on a box goes after 7 unchanged days too, open or
  not.
- **Buttons that say nothing in the thread (ADR 0069 part 2).** Close, Reopen, Stop and Stop
  repeating from the web chat send their word marked as a button's (`button` in its hidden line):
  the thread doesn't show it, a close shows as a faint "Closed · 13:40", and Stop's answer goes to
  the status comment's **Last action** line instead of a reply. Typed words get a reply, as before.
- **The box skips Library pages and a project's opening (ADR 0069).** `task.yml` starts no job for
  a page labelled `library`, or for a `project` opened or edited; the box runs no agent for one
  either, and the watch marks neither Stopped.

### Fixed

- **Guests: answered while a run stays, a Desk of their own, no line about you (task #662).** A run
  that stays after its answer (ADR 0057) heard only your words, so a guest's next message went
  unanswered, and was dropped when the stay ended: it hears theirs now (`newWords`). A guest's
  window opens on their own Desk (the Guest tag, their chats and projects, New project, Files),
  with Desk, Projects and Files as its pages; the line "<you> can read your chats" is gone, and
  their menu no longer carries your name. New project has no repos field for a guest. A new chat
  shows in the list at once (the list kept from before it is dropped), not "Nothing open" for 8 s.
  A guest's chat said "Waiting for a box" while a box was online, as their list had no boxes: it
  now says whether one is online (no name, slot or load), so it says "Starting…". Their marks
  (`guest`, `guest:<id>`) are no longer filters in their list.
- **Guests: three holes closed (task #662's security sweep).** A guest's `/change jot: …` (or
  `/change remember: …`, `/change go`) passed the door's check, which read the words before the
  command came off: a jot went into your Journal, where your runs read it as yours. The check now
  reads both, and a guest's jot is refused where captures are saved. A guest's thread no longer
  carries each reply's run details (your box, the run's link, your plan) in its Markdown, which
  Copy and Download use. A guest's file sent on a chat that isn't theirs keeps no number of it.

- **A run is told what its prompt is missing (task #655).** When the box couldn't read the
  notebook, a project's pages or a chat's project, or left a page out because someone other than
  you or a run last edited it, the run's notes say so in a line, and the playbook tells it to say
  so in its reply. Before, the gap was silent.
- **The web chat's phone header and a project's page, cleaner (task #652).** On a phone a
  thread's header held five round buttons, and its tags ran under them: now it keeps Back, the
  title, ↻ and ⋯, with **Find in this chat** and **Close** or **Reopen** in ⋯, and the tags stop at
  the title's edge. A project's card is shut till you open it. A chat's run in a project got only
  the other chats' titles, and guessed what a word meant there: its prompt now tells it to read the
  chats that bear on the ask, and the project's pages, before it answers, and to ask rather than
  guess. In the Library, a project's pages say what they are: its **Main page** first, or a line
  that none is written yet and how one comes, then its **Inbox**, whose items wait for "collate
  the inbox". Making a project now makes its main page too (`Notebook: <name>`, your brief and an
  empty Map), so every project starts the same; a page a closed project of that name left is
  kept, not made twice.
- **A new project said "Starting…" and nothing ran (task #645).** A project's own words, and any on
  a Library page, start no run, but the page showed "Starting…" under them for 10 minutes and read
  the list every 10 seconds. The thread now marks such words `norun`, and the page waits for no run
  there. A task's **Progress**, open, keeps its line in sight at the top to fold it, scrolls in
  itself without moving the thread, takes at most 40% of the screen, and reads in smaller text.
- **A chat moved into a project stayed under General (task #645).** It has no `Part of` line, so
  the list knew its project only once the project's fold read it, and that read was kept a minute
  and never again. The list and the chat's thread now name its project from GitHub's link (one
  GraphQL call for all the moved chats, each kept a day), and the page's own guess from the fold
  is gone; a move forgets the project's kept chats. A project's page says in a line what to do
  there: Send starts a chat, a chat below carries on, Add keeps a find.
- **The web chat after ADR 0069's release (task #638).** No more "Something went wrong on this
  page" on New chat, the Desk, the Library and every thread: a view with no Progress kept `false`
  as its fold, and the next draw called `false.remove()`. An upload goes straight into R2, never
  waiting for the one-time copy of KV's old files, and one whose answer doesn't come in 2 minutes
  after it's sent fails with Retry, never "Uploading…" for good.
- **A message with a photo failed as "Offline", every try (task #638).** It waited for a step of
  the one-time copy of KV's files to R2 (each file a read of KV and two writes), past the page's
  20 s, and a request cut off left its step unfinished for the requests after it. No request waits
  for the copy now: it runs one step a cron tick, after the watch, and every read and send uses R2
  alone. An answer late from the edge says "The edge didn't answer in 20 s" and is sent again by
  itself (same id, so never twice); "Offline" is only a network that's gone. An upload with
  nothing sent for a minute fails with Retry too.
- **A repo's page that never opened (task #638).** The Shipify repo's page read Files, which waited
  for the same copy, and a page whose read failed stayed grey placeholders for good. A page that
  can't be read now says why, with Retry. A part of the page that didn't load once (offline) loads
  again on the next tap, not only after a reload. A repo's group links its page with `</>` and
  "<Name> · repo", apart from a project you made (▦). A note that ends with a date keeps it: never
  "(2026-10-09) (2026-10-09)".
- **ADR 0069's build, reviewed before its merge (task #631).** Project memory works:
  - A run's page writes reach the box: it took out only the files named in `files`, so a page's
    new text was never there to write. A page file that is one of the box's own is set aside.
  - A rewrite keeps the door's hidden first line, which names you: a collated Inbox (or a Journal
    after `remember` or `forget`) stays yours, and is read again.
  - The agent's own `ship notebook` trusts what the door wrote for you: a run gets your login, your
    people and the door App's slug (its public name; the sandbox lets that one through), never a
    read run or one on another account.
  - A split in a project's own thread is refused (its parts could never start), and a read run
    writes no page. A read run gets a long thread whole: it has no command to read an older one.
  - A full Progress keeps its goal and its newest end; the middle goes. `remember Preferences: …`
    no longer reads the list of projects.
  - The edge: `add <name>: …` with no open project of that name opens a task, as any words do
    ("Add tests: …"). **Move to project** moves a chat once, and says why it can't (in a project
    already, a split's part, an issue with a parent), saying "full" only for a 100-chat project. A
    file is 95 MB at most, inside Cloudflare's 100 MB a request. A copy of a file no chat takes is
    deleted. The copy from KV goes a step at a time from its mark, so it never starts over, and is
    removed a week after it deploys (the roadmap). `ship door check` and `ship door setup` check the
    R2 bucket, and name the fix when R2 is off or the token can't reach it.
  - The weekly clean-up: a closed project takes only its closed chats' files and its pages'; an
    open chat keeps its own. The quiet close is at 30 days, not 90 (your pick). It leaves a task
    that needs you open, and its search leaves out what it never closes and reads the oldest
    first, so projects and pages can't fill its 100. Its steps are timed from the clean-up's start, so they run every week, not every
    second one. A task's folder on a box goes after 7 unchanged days. Its summary says what really
    happened ("deleted 12 files (8 MB) of 4 closed chats").
  - The web chat: the phone's Desk reads the list again while it shows (it never refreshed). A
    project's fold keeps no ETag of the project page's own read, which showed a stale page. A
    project's box sends with `under` from the page itself, so its Send never opens a chat outside
    the project, or two. The tabs keep the app's history, so Back stays in it. Export reads every
    message of a long chat, asks first past 50 MB of files, stores files where the browser can't
    compress, and names each one safely. The page's budget counts the Desk, its first screen: with
    it the page was 44.5 KB, over 42; the Library, Find in this chat, diagrams, a file's upload,
    New project's form and three parts' styles now load when first used (41.5 KB).
- **A split's part could never close a day after its answer:** the run's copy of its labels kept
  only the state label, so decide never saw `sub-task`. It keeps them all now.
- **The web chat, swept (ADR 0069's part 0, task #631).** A thread past 100 messages opened
  almost empty (101 showed 1) and could skip a message landing at the 100 mark: it opens with its
  newest 40 or more, and a poll past page 1 reads what's new by time. A project's tab row, which
  kept closed chats, is gone: the project's name in the thread's header links to its page, and
  Ctrl+K with nothing typed lists the chats opened last. The page opens offline (its worker keeps
  its own files, network first, never `api/`). Drafts and attached files survive the app being
  closed; times tick; ↓ shows whenever you're scrolled up; a thread has a search box, and code
  blocks a Copy button; the timer is quiet for screen readers; a close no longer looks undone;
  Safari's IME Enter doesn't send; the working dot honours reduced motion; touch targets are
  44 px. Faster and lighter: the page's files answer 304; the edge keeps a read 8 s (past the
  5-second poll), reads a thread's issue and comments at once, a PR's state for a minute, the
  runners and status task with ETags, and caps its memory; the page writes each thread on its own
  when idle, redraws a thread only when its task changed, keeps diagrams drawn, waits on search
  keys, and frees its menus' listeners and object URLs. New repeat and the model picker load when
  first used (`repeat.js`, `pick.js`), taking the page from 40.8 KB to 39.4.
- **A part's `close` from a chat starts what waited for it (task #621).** The door closed the
  part, then wrote the word as a setting. GitHub keeps one waiting run per task and the newest
  takes its place, so while a run was under way the setting's run (which skips) replaced the
  close's: no run saw to it, and #616 never started. A part's close is now written as words.
- **A deploy GitHub holds for approval is told, with its run (task #621).** A new project's
  first push by the bot was held ("this workflow file may be malicious"), and the task would
  only have said, 30 minutes on, that the deploy never showed up. It now says so at once, with
  the run's link, and follows the deploy on, so "Live" still comes after you approve it.
- **A PR asked for again gets the run's title and description (task #621).** An open PR kept
  its first description, so a `closes` PR asked again as `part-of` still said `Closes` and its
  merge would close the task. A part's prompt and the playbook also say a `new:` plan, or a big
  change's doc, is `part-of`.
- **A merged plan always finds its task (task #614).** The plan file is the link: a `new:` run's
  commits that write `plans/<id>.plan.md` set the task's plan, and its PR is the plan's (the
  result's `plan` field is gone, so nothing is left to forget). `ship task plans` starts the task
  the plan's `task:` line names, and `publish` and `go` find a merged plan the same way. Before,
  a result with no `plan` recorded the plan's PR as a change doc: the merge started nothing, and
  `go` took the big-change path.
- **`drop.update` takes `limits.mb` up to 2000**, as Drop's Details form does: it allowed 10000,
  more than Drop holds in one drop.
- **The web chat's Setup shows a tool's pre-approved calls** ("Without asking"), by their call:
  it showed blanks.
- **A sub-task the box closes starts what waited for it (ADR 0066, task #605).** A new project's
  part closed by its first deploy, or an answered part closed after a quiet day, started no close
  run, so the parts after it never started and the parent never closed. The deploy's run now does
  the part's close step itself, and the due run starts a part's run (no agent) after its quiet-day
  close. A reply's `go #n` is a button in every chat.

## [0.1.17] - 2026-10-28

### Added

- **A Drop tool: a task's files shared as a link (task #588).** `drop.list` looks; `drop.publish`
  (a drop from files the task shared, with its link and any PIN), `drop.update` and `drop.revoke`
  are made after your Yes. It calls Drop's `/api` behind Cloudflare Access with two service
  tokens, a read one and a write one: `pnpm ship add drop`, or its five secrets on GitHub's
  website (docs/tools.md, Drop). It sends what Drop's own admin page sends (Drop 0.2.0), and
  docs/tools.md gives each request. The tool contract gains `args.<call>.files`: the argument that
  names files the task shared. Decide takes such a call only when each was shared (one shared in
  the same answer waits for your Yes), and the box reads them from `shipify-files` for the call. A
  skill, `drop`. The core's own words "drop it" and "drop them" now say "end it" and "cancel
  them", as the core may not say a tool's name.
- **An `r2` storage option for Cloudflare apps (ADR 0067, task #586).** `options: [r2]` gives the
  binding `R2` and the bucket `<worker>-r2` (staging's own `<worker>-staging-r2`). Each deploy finds
  or makes the bucket and replaces its lifecycle rules with the app's `r2-lifecycle.json` (prefix to
  days). An app with R2 gets no preview without staging. Tests use a local bucket. The deploy token
  needs **Workers R2 Storage: Edit**. ts-worker and ts-static 1.1.0.
- **Sub-tasks: one task, a few PRs, in order, when you say (ADR 0066, task #581).** A run may
  `split` a task into 2 to 8 parts, listed for your `yes` like calls; your `yes` opens them as
  GitHub sub-issues with blocked-by links, and nothing starts. `go` on the task starts every ready
  part, `go #n` one now, `stop` no more. After your `go`, a part's merge starts what waited only for
  it, in its close run with no agent; a dropped part tells the task once; the last close closes it.
  A part's run gets its parent's goal and its siblings in one read, and doesn't stay when the box
  started it. The web chat shows a bar and "2/4" on a split task, its parts folded under it, a grey
  **Waiting** state, and a **Plan card** (`plan.js`, loaded only for a split task) with Start,
  Start all ready, Stop and Open all as tabs. No new store, key or setting. `task.yml` starts a
  close run for a part too (the `sub-task` label), so one that closes with no state label still
  starts what waited for it, or tells its parent.

### Changed

- **Weekly lessons kept in their skills:** `systematic-debugging` checks the box's uptime and reset
  cause when a run loses communication. `verification-before-completion` has six new checks for
  work that repeats the product, and both skills have a `scenarios.md`.
- **More weekly lessons kept in their skills:** `systematic-debugging` checks the value a tool's
  process received before it blames a key's setting. `codebase-design` checks the stack's preview
  flow before it proposes a Cloudflare binding. `verification-before-completion` reads a PR's
  description before it says the PR's kind changed.

### Fixed

- **A run's Drop tool gets its look keys (task #600).** The agent held only look keys whose names
  end in `_READ`, so Drop's (`SHIPIFY_DROP_URL`, `SHIPIFY_DROP_READ_ID`,
  `SHIPIFY_DROP_READ_SECRET`) never reached its server, and every `drop.list` stopped with "Drop's
  address isn't a link". The agent now holds each tool's look keys as `tools.json` names them. An
  address that isn't a link says what to set, and where.
- **A sub-task thinks with its parent's model (task #592).** A part opened with no `use` line, so
  its run took Auto, not the model and effort its parent picked. Each part's body now ends with the
  parent's `use` pick, unless its brief names its own.
- **R2's docs, tidied (task #592).** The plan template names `r2` among the Cloudflare options, and
  `stacks/_cloudflare/storage.md` reads right on the token's permissions and the deploy's steps.
- **A sub-task that waits starts by the box or your `go`, not your other words (task #594).** Your
  comment on a part that never ran, and whose blocker wasn't done, started a full run. Now the box
  answers once with no agent ("#14 waits for #13, so it hasn't started…"), the part keeps no state
  label, and its run reads your words when it starts. `go` on the part starts it now and says what
  it skipped (it said "Merge the change doc's PR first"). A part the box had answered on before (a
  `use`, a thanks) no longer ends its start with "nothing new": a part's start is now read from its
  labels, not from it having no status yet.
- **A merged plan's build starts when its run gave the plan's path (task #587).** A run that wrote
  `plans/<id>.plan.md` as its plan, not `<id>`, left a task whose merge found no task to build, and
  whose `publish` said "Merge the plan's PR first". A run's plan and a task's stored plan now read
  as the id; anything else in a result is a slip in its shape.

## [0.1.16] - 2026-10-25

### Fixed

- **Sub-tasks in the web chat, tidied (task #581).** A split task's fold says "4 parts", not "4
  open parts" (on the Closed tab they're closed). A Plan card whose read later fails, or whose parts
  were unlinked, goes, and doesn't stay with old rows and live Start buttons. Two dead bits cut.

- **Box setup 11: the last container and IPv6 gaps (task #565).**
  - **A container broke its slot's next run:** Podman gave the slot folder the x bits it lacked,
    as the agent, so Linux dropped its setgid (2710 became 0711), and the runner couldn't read the
    next run's `out/`. Slot folders are 2711 now, and a run's start refuses, with the fix, if one
    lost its setgid.
  - **Agents reached the home network over IPv6:** its addresses are public, so the rule's
    private ranges missed them. Agents now reach no IPv6 address but `::1`, and the setup proves
    it. A refused TCP connection gets a reset, so programs go on to IPv4 at once.
  - **The rule hit the box's own packets** (a ping's reply, IPv6's neighbour discovery, the ICMP
    error that ends a refused connection): only the agents' own packets go through it now.
  Run the box's `here.sh` command again to bring a box to setup 11.

### Added

- **The weekly lessons recipe** (`recipes/examples/weekly-lessons.md`): every Monday, a run
  gathers the "Lesson for `<skill>`" lines of the last 14 days' replies that no skill holds yet,
  and asks for one PR that puts them into their skills. You only merge it; with none, it stays
  quiet. With it on, a reply's lesson line no longer asks you to start a task.

### Changed

- **One full check per work run, not two:** the agent runs the tests its change touches, and
  leaves `make verify` to the box, which runs it right after, with a round to fix what fails. On a
  Pi this saves up to about 16 minutes a run.
- **A new disk (an SSD), or a fresh OS:** six steps in `docs/box-setup.md`, with only a phone.

## [0.1.15] - 2026-10-25

### Fixed

- **Containers on a box, the rest of the way (box setup 10, task #565).** Setup 10 ended "Done,
  except containers" on a box whose containers start: its check removed the folder its Podman had
  as HOME, and Podman stops without one. Two faults a run would hit, fixed:
  - **The box's own Podman commands never ran** (a run's start, the clean-up of earlier runs, the
    weekly prune): they had `HOME=/nonexistent`. A run's containers stayed for the next, and a run
    folder with a file a container wrote as its own user blocked the slot's next run. They now get
    the slot's folder.
  - **A database's image couldn't chown a bind mount in a run** (`Operation not permitted`): a
    run's folders had the runner's group, which has no ID in the container. Only `out/` has it now.
  - **The setup's check** uses the box's HOME and a run's folder layout, gives its folder to a
    user of its own as a database's image does, and shows Podman's error when it fails.
  After the release, run the box's `here.sh` command again: it ends "Done".

## [0.1.14] - 2026-10-25

### Fixed

- **Box setup 10: containers start on every box, and a setup never says done when they don't
  (task #565).** On a box set up by 8 or 9, every `docker run` failed ("failed to mount overlay
  for metacopy check … permission denied"): each slot's `data` folder, where Podman keeps its
  store, took the slot folder's group (`shipify`) by its setgid, and that group has no ID in the
  agent's user namespace. Setup now makes each slot's `cache` and `data` the agent's own, its group
  too, with no setgid, and mends what 8 and 9 left in place (the caches and images stay); a run's
  start that makes a missing one again clears the setgid too. Run the
  box's `here.sh` command again (or `box add`) to bring a box to setup 10.
  - **Loud, and true:** each slot's store is checked (`podman info`, as its runs open it); a
    failure shows Podman's own `Error:` line, never a warning after it, and a fix that is one. The
    setup ends "Done, except containers" with exit 3: the slots still get their label and take
    tasks, and `box add` (so `here.sh`) says what's left and the fix, never "Live".
  - **`ship doctor`** (the weekly clean-up, "how is this box doing?") checks each slot's containers,
    and that the service holding the agents' network rule loaded it.
  - **A new wall:** no agent reaches the box's own SSH or Cockpit on `127.0.0.1` and `::1` (ports
    22 and 9090), where it could keep guessing your password. Proved at setup. What a container
    publishes on `127.0.0.1` stays reachable.
  - **Starting over, in one command:** `here.sh --fresh` takes Shipify off the machine (as
    `--remove --purge`), then sets the box up again with the same name and slots, after one yes.
    `box remove --purge` refuses while a slot runs a task, and on a machine that is no box now, it
    clears what a purge that stopped left.
  - **Nothing outlives its slot:** a slot that goes, and a purge, kill as the agent first, which
    reaches its containers too.
  - **Quieter:** Cockpit comes from backports only where the box's apt sources have them, never
    with apt's "the value is invalid" error.

### Added

- **Projects as workspaces in the web chat (ADR 0065, task #568).** A task's project is the repo
  its title names (`shipify: …`, `links: …`); one with none is General.
  - **The list by project:** a group each, folded open or shut, with what needs you and what's
    working counted.
  - **Tabs:** a project's tasks you open sit as tabs over the thread, with their state, ✕, and +
    for a new chat in the project; kept per project in your browser.
  - **A project's page:** its chats, its numbers and its app; its docs as In (what you sent) and
    Out (what runs made); its repo's docs as links to GitHub.
  - **A doc beside the chat:** a file opens in a pane next to the thread (the whole screen on a
    phone), its width yours to drag. Markdown is rendered (by GitHub, then cleaned), a CSV is a
    table, a PDF shows in the browser's own viewer (a phone's Chrome offers to open it). **Ask
    about this** puts the file, a run's too, in your next message.
  - **Ctrl+K** finds a project, a task or a doc; **Alt+1…9** picks a tab.
  - Nothing new is stored or polled, and no new permission: the edge gains a read for the pane
    (`…/api/doc/<ref>`, one GitHub call a Markdown file) and serves a PDF inline with `?view=1`.
    Files groups by project.

### Changed

- **The web chat's page is lighter:** Status & setup (`setup.js`) and the new workspace parts
  (`workspace.js`) load the first time they're needed, each with a budget of its own; the page
  you open every day went from 41.8 KB to 40.1 KB as sent.

## [0.1.13] - 2026-10-24

### Added

- **The lab: containers on every box (box setup 8, ADR 0064, task #555).** An agent can run
  `docker run …` and `docker compose up` in a task: a test that needs a database, a repo tried
  with its own services, a theory tested with real ones. It's rootless Podman as each slot's own
  agent user, with a range of 65,536 IDs of its own: no Docker Engine, no root daemon, no `docker`
  group and no socket (setup turns off the root one Ubuntu's package starts). A container stops
  with the box's kill at each turn's end, and the kill's check now covers the agent's range; its
  records, volumes and networks go at the slot's next run, which empties Podman's state as a
  restart would. Images stay per slot for at most a week: the weekly clean-up prunes them while no
  other slot is busy, and its 30-day trim leaves the store alone. A box without Ubuntu's normal
  updates gets them (Podman's fix for stopping containers is only there). Setup never removes a
  package, keeps a machine's own Docker, and never fails over the lab: without it the box works as
  before. A new wall, at setup and in `ship doctor`: no agent can write to a root container socket.
  Setup also runs a container as one agent the whole way and proves the kill leaves nothing. A box
  in Docker skips the lab. Run `box add` again to bring a box to setup 8.
- **Box setup 9: the agents reach no private network, and a setup that holds up (task #565).**
  - **A new wall:** an agent and its containers reach the internet as the work needs, and no
    private address: not your home network (the router, a camera, another box), not the tailnet,
    nor a cloud's metadata address. A table of its own in nftables, for each agent's user and its
    containers' range of IDs, loaded at every start; DNS stays open, and your own rules, ufw's and
    Tailscale's stay as they are. The sandbox check proves it before the slots get their label.
  - **Right after a first boot:** every apt waits up to 20 minutes for Ubuntu's own updates, in
    what setup runs too (a stack's fix, the runner's dependencies, Tailscale's installer), and
    apt's lists are tried again. A run cut off mid-install is finished first, so it's always safe
    to run again. Downloads are tried again and stop when they stall.
  - **The progress line of the updates can't stop the setup any more.** On a fresh install its
    log has no such line yet, and the whole setup stopped there with no message.
  - **The updates waiting now come after the slots register,** so a long first update never
    outlasts the registration tokens' hour; `--manage` comes last, once the sandbox checks out,
    and Tailscale's sign-in waits 15 minutes at most.
  - **A slot GitHub deleted** (after `box remove`, or 14 days off) registers again, instead of
    looking live and taking no job.
  - **`box add` is done only when it is:** it fails, saying why, when a slot lacks the sandbox
    label or none is online after a minute; with some online, it says how many.
  - **Cockpit** listens on the machine alone from its first start, restarts only when its
    settings change (so the setup runs from its own terminal), comes without NetworkManager (which
    would take a laptop's Wi-Fi from Ubuntu Server's settings), and takes its updates from
    backports.
  - **A box you keep** swaps the installer's swap file (`/swap.img`) for swap in memory by itself.
  - **`box remove --purge`, and `here.sh --remove --purge`:** Shipify off the machine in one
    command (`box/remove.sh`), which checks nothing is left; the machine's own Tailscale, Cockpit,
    firewall and updates stay.
  - **`here.sh`:** `--replace` (a reinstalled machine), `--purge`, a "Yes" in any case, an option
    with no value named instead of a silent stop, a plan that can't go ahead stops before it asks,
    and the default copy is the private `shipify` repo you manage, an organization's too.
  - **No PC needed:** the box guide has one path for a laptop with only your phone, and every fix
    names the box's own command as well as the PC's.
  Run `box add` (or the box's `here.sh` command) again to bring a box to setup 9.

### Changed

- **A box you keep, from one command (task #555).** `curl … here.sh | bash -s -- --manage` sets a
  laptop or a spare PC up on the machine itself as a box set up over SSH is: it never sleeps, and
  gets Tailscale, Cockpit and the firewall. Only its SSH settings stay as they are, since you're at
  the machine. `pnpm ship box add --manage` with no target does the same (it was refused); without
  `--manage`, this PC keeps its own power settings, as before. Not on WSL, nor in Docker.
  `docs/box-setup.md` has the way with no PC, and another box over Tailscale as the PC.
- **One rule for a stay (ADR 0063, task #533).** A stay does with your words what a normal run
  would do, in the same job and session. A new model or effort (`use opus high`) keeps the session.
  `continue` carries on in it; `no`, `resume`, `stop repeating`, `reopen`, `close` and `publish`
  are answered by the stay; your `yes` to a list is decided there and made by its own job, with no
  new run. Only another agent, repo or account, `start over`, `go` or an edit goes to a normal run.
  Security is unchanged: no write key while an agent runs, and a stay never pushes.
- **A stay has one setting (ADR 0057).** `SHIPIFY_STAY` (quiet minutes, 20, `0` for off) is all
  there is: the 45-minute total and the 55-minute turn clock are gone. A stay keeps answering while
  your words come, until its job's own limit, and gives each turn what's left of it. Its reads and
  replies use the job's token, which lasts the job; past an hour only the agent's own GitHub reads
  fail, as in a long work run.
- **Shipify says who it is.** Every run's prompt opens with a few lines that every agent shares:
  the owner's personal assistant, not only a coder, brief and direct, saying what's uncertain and
  stating its limits. Your notebook's notes on tone win over it.

### Fixed

- **`shipify: release` passes its check again (task #565, #564).** One test read your own plan
  (`plans/links.plan.md`), which a release takes out before it checks the files it publishes: the
  release failed the same way every time, and nothing was published. The test makes its own plan
  in a temporary folder, and the test-driven-development skill says a test never reads your own
  files. A failed release now names each failing test and its first error in its reply, where
  "(above)" pointed at a log the chat doesn't show, and never says `continue`, which would only
  fail the same way: fix it in a PR, then release again.
- **Box setup 7: one setup and one slot rule for every box (task #555).** A Pi, a laptop, a spare
  PC and a VPS are set up the same way. A box never sleeps: the lid does nothing and the sleep
  states are masked (no laptop check; on a Pi or a VPS nothing changes; this PC keeps its own). An
  automatic update never restarts a slot mid-task (a needrestart rule for `shipify-box-*`). Every
  box gets `shellcheck`, `fd` and `sqlite3`, in a step of their own: when they can't install (no
  Ubuntu universe) or sleep can't be masked, the setup goes on and says so. A new box gets a slot
  per core, no more than its memory fits, 1 to 9 (it stopped at 4, from memory only): a Pi 4 stays
  at 3, a 32 GB laptop with 8 threads gets 8. `--slots` above 9, which setup refused after
  registering, is refused before anything happens, by `box add` and by `here.sh` (before its
  login). `docs/box-setup.md` is one guide for any machine, with moving a box in one go and taking
  Shipify off a machine you keep (its users, folders and tools; `box remove` points there).
  Run `box add` again to bring a box to setup 7; `ship doctor` names one that's older.
- **`main`'s checks pass again (task #555).** Setup 8's container check had a loop counter it
  never used, which shellcheck flags (SC2034), so `main`'s CI failed after the lab merged and no
  release could go out. The script is unchanged in what it does.
- **CI on main after box setup 7 (task #555).** A test of `ship doctor`'s setup check still
  expected setup 6, so CI failed on main after the merge. The test now reads the version from
  `box/setup.sh`, so a new setup version needs no change there.
- **zod 4.6.7 (GHSA-mrhx-c7xc-m3w5, #556).** GitHub raised this advisory to high on 23 Oct, and
  the dependency audit stopped CI on main at zod 4.6.5: validating a very large collection with
  limits could use up all memory. 4.6.7 has the fix.
- **One "Shipify status" issue, not 15 (#556).** For about an hour GitHub's list left the status
  issue out on and off, with no error, and the door and the runs each opened a new one. Both now
  find it by one rule (an open one, the one that holds the record, then the oldest; with none
  open, the newest closed one that holds the record), open a new one only when a second look finds
  none too, and the next run that writes the record closes and unpins any other open one, said
  under Recent. A status issue you open takes the record over from the newest closed one.
- **A reply never shares the box's own files (ADR 0063, #532).** An agent that named its
  `handoff.md` in `files` uploaded it with every answer, and the key that needs ended the stay. The
  box now drops `handoff.md`, `result.json` and its other own files from `files`.
- **A stay's question on a project needs no push (ADR 0063).** Its turn sent the run's earlier
  commits again, as its clone didn't know they were pushed, so it needed the repo's key and the
  stay ended. A turn now sends only its own commits.
- **`stop` keeps the session (ADR 0057, task #527).** A stay gave every `stop` to a new run, which
  only said "nothing to stop", and your next words then started cold. Now the stay answers `stop`
  itself: a turn that's working stops and says "Stopped"; with none working, it says there was
  nothing to stop; one that came as a turn answered is said in that answer. A run you stop stays
  too. Either way your next words carry on in the same session. `continue`, `start over` and the
  other fixed words still go to a run.
- **A file shared before isn't uploaded again (ADR 0062).** An answer that listed the same file
  again, unchanged, uploaded it again, and the key that needs ended the stay. Now the task's status
  keeps each shared file's hash and link (the newest 20), and the reply links the copy already
  there, as "… (unchanged)". A new or changed file is uploaded as before.
- **A merged plan's build starts, and `go` works from your chat (ADR 0049, ADR 0057, #528).** You
  merged a plan while the run that made it still stayed on the task. Its build waited behind the
  stay, and your next message replaced it in the queue, so nothing was built. In the chat `go` was
  refused ("only works on GitHub"), and on GitHub it asked for a change doc a plan doesn't have.
  Now:
  - The merge takes the stay's label off, and the stay leaves within seconds.
  - A run that finds a merged plan whose build never started starts it, once.
  - `go` on a new project's task is its `publish`.
- **One flow, one rule (ADR 0049).** Every word, task and release works the same from GitHub or
  any chat. Only a PR's merge, and what changes the live app at once, are GitHub's. `go`,
  `publish`, `preview` and `start over` work from a chat (and are buttons there), and an operation
  is a task's title in the Operate form's words (`spotter: release`, `spotter: take it down`,
  `spotter: bring it back`, `spotter: roll back production`). Taking an app down, bringing it back
  and a rollback start (and run again) only on GitHub: from a chat nothing runs, and the reply
  links the Operate form. A list too long for a chat to show whole is still approved on GitHub.
- **Publishing a merged plan no longer says the bot lacks Variables when it has it.** The check
  asked with the workflow's own token, which can never read variables, so every `publish` stopped
  with "Variables: Read and write for the task bot". It now asks with the bot's token, the one
  that sets them.
- **Box health says how a Raspberry Pi last started.** `started` reads the firmware's reset status:
  "from power-on" when the power was off, cut or dropped (a brownout), else "by a restart". A run
  that "lost communication" with a box that started from power-on points to its power supply, not
  to Shipify (`troubleshooting.md`).
- **The web chat rides out a moment GitHub isn't read (#527).** One failed read showed a red
  "Couldn't read GitHub just now" until a later one worked, and a message that didn't go waited
  for your Retry. Now the edge tries a read once more, then serves the list or the thread from its
  last good copy. The page's timed polls stay quiet and slow down; after about a minute a calm
  "Can't reach GitHub · retrying" shows, and goes by itself. A message not sent goes again by
  itself (same id, so never twice), up to three times and when you're back online. The
  troubleshooting page says how to make Access's sign-in last longer.
- **A stay's reply counts its own turn (ADR 0057).** Each turn's plan cleared the last think's
  file, and with it what the session had counted, so a stay's run details showed the whole
  session's tokens and cost ("58M in" for a 20-second answer). The stay now keeps that count, as
  it keeps the session.
- **Docs say the one flow everywhere.** The `not-allowed-here` problem's row, the "only works on
  GitHub" row and "the Operate form on GitHub" are gone from tasks, troubleshooting and getting
  started; operations are named by their titles from any channel.
- **A stay's answer that needs a key is posted, not lost (ADR 0062).** When a stay's answer had
  files, an approved tool call, a push or a workflow file, the stay started a new run, which had
  none of its work and thought again from the start. Now the stay ends with the answer decided, and
  the same job mints exactly those keys and posts it. No new run, nothing thought twice, and still
  no write key while an agent runs.
- **The docs say simply how slots share a box (ADR 0061).** `box-setup.md` explains the cores'
  turns, memory given when asked, swap and zram, and each slot's count; the glossary has zram, and
  a slot is "a worker in a pool", not a core; the troubleshooting page says what to do when a slot
  had a task killed for memory, or tests time out only when several run at once.

## [0.1.12] - 2026-10-17

### Changed

- **Steady runs (ADR 0061).** When the agent fixes an answer its schema refused, the fixed one is
  taken, never the file it wrote first (#506). A slip in an answer's shape no longer ends the stay:
  the reply says what didn't fit, and your next words go to the same session. The prompt says that
  content too long for a field goes into a file, and the playbook that a big change starts as a
  proposed ADR.
- **Roomy boxes (ADR 0061).** `box add` turns on swap in memory (zram, half the memory,
  compressed) on a box with no swap of its own, so tasks that overlap slow down instead of having a
  test killed; WSL, a VPS with a swap file, a container and a box without systemd keep theirs, each
  with a line saying so. `--slots` has no cap of 4 any more (`box add` and `here.sh`): past what memory or
  cores suggest, it warns. `box health` and the status task show the swap, the most each slot has used, and a task
  killed for memory. Box setup is version 6: `ship doctor` names a box set up before it, and
  `pnpm ship box add <box> --yes` again brings it up to date. `box/load-test.sh` measures N tasks'
  checks at once on a box.
- **One writing rule for people and agents.** `playbooks/task.md` now has "How you write": use
  ASD-STE100 as a guide, with short sentences, active voice and one term per idea. Keep precision
  and say what is uncertain. `CONTRIBUTING.md` points to it.
- **Every answer stays (ADR 0060).** A run stays after any answer to your words, a work run's and
  one that opened a PR or asked you something included, unless it started another run or closed
  the task. On a project the stay pushes nothing: a change you ask of it starts a work run. What
  you write while a run works is taken in with no round count (3 before), until nothing new comes.
- **Long sessions (ADR 0059).** A run's agent works up to 200 minutes in one session (50 before),
  its fix round 20, and the job's limit is 460 minutes. Your `stop` and your words while it works
  are read with the workflow's own token, which lasts the job, so both work to the end; a read that
  fails says so in the run's details. A stay waits 20 minutes by default (10 before).
- **A PR opens up to date with `main` (ADR 0059).** After a work run's agent, a new step, the
  finish, fetches `main` with a key minted then; when it moved while the agent worked, the box
  refreshes the branch and checks it again before the PR. Where that stops, the PR opens as the
  agent left it and the details say `continue` brings it up to date.
- **A stay's turn reads your words twice (ADR 0057).** It read them five times (plan, think
  twice, decide, apply), about a second each on a box: now its plan's read, which apply takes, and
  one as the agent answers, which decide takes. Words after that are the next turn's.
- **Claude Code lists Shipify's skills alone.** Its own bundled skills and workflows (loop,
  schedule, claude-api, init and others) are off (`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`), so a
  run's agent isn't offered skills that never fit a task, and each prompt is a little shorter.

### Fixed

- **The web chat times a stay's answer, not the stay.** A task's row said "Working · 40m" for a
  10-second answer, and its header the same till the turn's status was read, then dropped to 0.
  Both now time the answer from its `working` status, and say "Starting…" or Staying till then.
- **The tasks doc says in one table when a stay answers and when a new run does.** For each kind
  of next words, it shows who answers, whether the agent's session carries on, and whether its cache
  starts warm. It also says why a change goes to a work run: the clone and the write key a PR needs.
- **The docs match long sessions (ADR 0059).** The glossary's stay is 20 quiet minutes (it said
  10), the catch-up needs 5 minutes left of the agent's 200 (it said 50), and old run folders are
  swept after 8 hours (it said 6). The security doc says the agent's own GitHub read lasts its
  token's first hour, and the tasks doc says what a cold run reads after a stay ends.
- **ADR 0059 says what a long run proved.** One work run on homepi kept its agent in one session
  for about an hour, then the box's checks, about 75 minutes in one step, with nothing failing.
  The live check is closed for now, and the ADR names what it didn't try.
- **Naming the model you're already on keeps the session (#497).** A stay compared the pick as
  written, so `use claude sonnet` while Auto ran Sonnet at medium, or `use claude sonnet medium`
  after `use claude sonnet`, started a fresh run. It compares the agent, model and effort the pick
  runs, Auto worked out as the run does; another model or effort is still a new session. The
  playbook tells the agent a `use` line is already applied, so it doesn't answer it.
- **A release's box images build every time.** Building them asked GitHub's API for the newest
  runner with no token, from GitHub's shared machines, and was refused when those had used the
  hour's 60 calls (0.1.11's first build). The build now passes its own token, as a build secret
  never kept in the image. A box set up with `here.sh` needs none, as before.
- **A run stays after it asks you a question (#487).** It stayed only after a plain answer, so
  your answer to its question started a new run, cold. A question that waits on nothing else (no
  list for your `yes`, no PR open) now keeps it staying, and your answer comes in the same session.
- **On a phone, the web chat lets you copy part of a reply (#487).** A long press opened the
  chat's own menu, which copies the whole reply, and hid the phone's Copy for a selection. It's
  the phone's own again; **⋯** on each reply still gives Copy and Download.
- **A `use` you're already on keeps a stay (#487).** A message that was only `use <the pick in
  place>` (or a thanks) got the box's own reply and ended the stay, so your next words started
  cold. The stay answers it and stays; a new pick still starts a new session.
- **A long run's folder is never swept as left over.** Old run folders went at 6 hours, under the
  job's new limit; now 8, tested against it.

## [0.1.11] - 2026-10-16

### Fixed

- **After you switch model in a stay, the new model's run stays too (#462).** The stay handed your
  words to a new run, as it should, but that run answered and ended, so your next words started
  cold again.
- **A run that stays answers each of your messages with its own answer (#462).** Once an agent had
  written its answer as a file, a stay's later turns posted that first answer again, whatever the
  agent said. Each turn now takes only what it wrote this time. `ship selftest chat` checks it.
- **A stay's run details count that turn's tokens, not the whole session's,** for Claude Code (and
  a run's catch-up rounds count each once).

### Changed

- **A run stays 10 quiet minutes after answering you, not 5,** so a pause to read and think doesn't
  end the session. `SHIPIFY_STAY` still sets it (`0` turns it off). `ship selftest` checks two
  answers in a stay, each new. Nothing to do.
- **pi and OpenCode think with GLM 5.3 Flash by default through OpenRouter too** (was a free model,
  whose endpoint was down for hours on 2026-10-16): fractions of a cent an answer, from your
  OpenRouter credits. A free model is still yours with a `use` line. Nothing to do.
- **A stay, robust end to end (ADR 0057).** A stay whose box died no longer holds its `staying`
  label until your words have waited 10 minutes: the watch takes it off once no run goes for the
  task, so your next words start a run. A stay gives way to its box's weekly clean-up too, not only
  to a task's run, and never to a job a free slot picks up in seconds. Your comments skipped while
  a run stays no longer take a waiting run's place, and a close or an edit on GitHub still runs
  after the stay. Every fixed word (`stop`, `continue`, `start over`…) goes to a normal run, as
  without a stay. The web chat says **Staying** in the list and the thread, not a bare tag.
  Nothing to do.
- **The web chat's list shows each task's state as a dot:** amber needs you, teal and beating
  working, green staying, teal new, red stopped; the word on hover and in the thread's header.

## [0.1.10] - 2026-10-15

### Added

- **A run stays after it answers you (ADR 0057).** After a plain answer to your words, the run
  stays for 5 quiet minutes (`SHIPIFY_STAY`; `0` turns it off), reading the task every 2 seconds,
  and answers your next plain words itself, in the same agent session: seconds, not a new run.
  Several messages still get one reply, each ask numbered, for every agent. A fixed word, an edit,
  another repo, account, agent or model, a change, or an answer that needs a file goes to a normal
  run. A stay gives way when another run needs its slot, and leaves on `stop` or a close. The label
  `staying` is on the task meanwhile, and comes off however the run ends. `ship selftest chat`
  checks it. Nothing to do.
- **See which skills runs use, and make new ones well.** Each run's details list the skills its
  agent loaded (**Skills**): Claude Code's and OpenCode's skill tool, or pi reading a skill's
  `SKILL.md`. The weekly digest adds one line: the week's loads, and the skills no run loaded.
  Nothing is removed by itself. A new skill, `writing-skills`, says how to make or change one: no
  line without a failure seen without it. Each of Shipify's own skills carries a `scenarios.md`
  (asks that should load it, near misses, and the cases it fixes), and a lesson adds a case. The
  skill check also holds descriptions to 300 characters and skills to 500 lines;
  `security-and-hardening`'s description is one short line. Nothing to do.

### Changed

- **Runs start sooner (ADR 0057).** A task's run no longer downloads `actions/checkout` and
  `actions/setup-node` on every job: it uses the box's own Node (the one its agent already used) and
  fetches Shipify's commit only when the box has no copy of it. The door is told of each reply as
  it's written, before the run's other writes. Nothing to do.

## [0.1.9] - 2026-10-15

### Fixed

- **The box's image builds:** its step made pnpm's folder before using it, as watch.yml does; the
  0.1.8 build stopped there.

## [0.1.8] - 2026-10-15

### Fixed

- **The box's image is built after every release:** its job was skipped when the golden tests
  were (no stack changed), as GitHub skips what follows a skipped job. A run by hand on the
  template now builds it again too.

## [0.1.7] - 2026-10-15

### Added

- **A box in Docker** (ADR 0056): any machine that runs Docker becomes a box. Run
  `docker compose run --rm box register` once (a code you approve on your phone), then
  `docker compose up -d`. Each release publishes `ghcr.io/<owner>/shipify-box` for x64 and arm64,
  built from `setup.sh`, so a container is the same box as a Pi, with the same sandbox checked
  inside it. It's never privileged and never has the Docker socket. Updates come by
  `docker compose pull`, and the registration stays in the volume.
- **A shorter README** that reads in a few minutes: what Shipify is, how it works, what you can
  ask, how to start, and the three ways to get a box.
- **An MIT licence** (`LICENSE`): anyone may use, change and share Shipify, keeping the notice;
  it comes as is, with no warranty, and its authors aren't liable for what others do with it.

## [0.1.6] - 2026-10-15

### Added

- **A box anywhere, from one command** (ADR 0055): on any Ubuntu 24.04 LTS machine,
  `curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash`.
  It checks the machine first, shows a code you approve on your phone, and runs your copy's own
  `box add`. It always cleans up: no login, clone or tools left behind. `--remove` takes the box
  away. Each release attaches `here.sh` with its SHA-256.
- **A public template that carries nothing of yours** (ADR 0055): `SHIPIFY_PRIVATE_WORDS` lists
  words replaced by stand-ins in what a release publishes. Every release is then checked for
  them, tailnet names and keys, and publishes nothing if any is found. `box add` and `ship doctor`
  refuse a public copy. docs/releases.md says how to make the template public, and the settings
  that keep strangers out.
- **Check back once:** a repeat can be one time, then it ends. Say it on the task it's about:
  "check PR #12's CI in 15 minutes and tell me", "remind me in 5 hours to …", "at 17:30 look at
  the deploy", "tomorrow at 9 …"; the Repeat form and `/repeat` take the same words. A job looks
  once with the whole thread and always says what it found; a reminder posts its text. It fires
  within about 5 minutes of its time (5 minutes to 30 days ahead), isn't skipped while the task's
  PR waits, and leaves the task answered. One per task, never on a task that repeats; closing
  drops it, `stop repeating` cancels it. Recipes and the digest still take only schedules.
- **Errands** (ADR 0054): a time once that waits for something on GitHub instead of a clock. On
  the task it's about: "tell me when links#12's checks finish", "when #405 merges, check the login
  page", "when it's deployed, …", "tell me when shipify's main checks finish" (the Repeat form and
  `/repeat` too). The task is labelled `waiting`, and its status line says what it waits for and
  until when. The due run looks with one GitHub read and no agent (every 10 minutes for an hour,
  then 30) and starts the task's run once the thing has happened: a reminder says what happened
  ("links#12: 5 passed, 1 failed (e2e)", failed checks linked) with no agent, a job runs the agent
  once with it. A day by default, at most 7; at its end, or after three failed reads, it says so
  with no agent. Your merge of the task's own PR fires one waiting for it in the close's run, with
  no looks, and the task stays closed. Your own account only; Shipify never merges. The web chat's
  Repeats page lists errands under "Waiting".

### Changed

- **A work run a reply starts is said in that reply:** "A work run on <project> starts now, from
  this reply: say `stop` to stop it.", whatever the agent wrote, so a second run is never a surprise.
- **A change doc's merge names `go`:** its "Merged" reply adds "Say `go` here to build it: the task
  opens again for it.", so a task its doc's merge closed doesn't read as finished.

### Fixed

- **A lost watch label is taken off.** One left on with no run behind it (`watch:alert-github`
  from 11 Oct, after a box-online alert rang `watch:alert`) no longer stays on the status task;
  the watch takes it off once, so no later tick reads the runs for it.
- **The watch never goes quiet on a stuck label.** An alert's label left on the status task with
  no run behind it (on 11 Oct its run couldn't take it off) kept every later finding unsaid: a
  box back, a box offline again. A watch label with no run of its kind queued, going or started
  in the last 10 minutes is now rung again, `watch:due` too, and a run that can't take its label
  off says so in its log.
- **Closing a task drops its errand.** A task closed by hand or from a chat while an errand
  waited on it (`waiting`) started no run, so the due run still fired the errand on the closed
  task. Its close now starts the close run, which drops it, as a close with a PR waiting does.

## [0.1.5] - 2026-10-13

### Added

- **A weekly digest** (ADR 0053): once a week, every Monday at 9:00 your time by default
  (`SHIPIFY_DIGEST`, or `off`), one short message to your default chats: boxes, apps (live,
  failing, behind their stack, with the words to send), what waits on you, keys due within 30
  days, what's coming up; "all clear" when nothing needs you. The first comes with the next due
  run. Nothing in it acts, and nothing else is sent: alerts are as before.

### Changed

- **The web chat on a phone** (task #335, part C): a file opens inside the app, never in a new tab
  (a picture full size, a short text file as plain text, anything else with a Download button);
  Back has one rule (Tasks under every page; a thread, New chat and an open file are one step
  each); long file names and link buttons fit a phone screen. The page stays under its 41 KB.
- **GitHub's Close and Reopen buttons start no run** (ADR 0053) unless the task still says
  `needs you` (a PR, a question, a list) or `working` (a run under way): about one box run in five
  was a close's bookkeeping. The "Merged" and "Live" messages after your merge stay.

## [0.1.4] - 2026-10-13

### Added

- **Vercel's AI Gateway for pi and OpenCode, and agents and gateways as two axes** (ADR 0052).
  `pnpm ship add vercel-ai-gateway --yes` sets its key (`AI_GATEWAY_API_KEY`); `pi-vercel` and
  `opencode-vercel` are the same agents through it. `executors.json` now says the two apart: an
  agent is a program and lists its `gateways`; a gateway holds its `models`, `auto`, names and how
  to read its list. One pure function makes the entry for each pair (`pi` through the first
  gateway, `pi-vercel` through the second: one program, one install, ids and `SHIPIFY_AGENT`
  unchanged), so a model, a gateway or an agent is a few lines of data, with fallbacks (Auto is the
  gateway's, else the agent's, else the gateway's first model; efforts and id pattern are the
  agent's) and nothing to copy. What can't be made (a first gateway that isn't there or isn't
  right, one listed twice, an id that's taken, a hand-written `extends` or `gateway`) is left out
  and said once by `ship doctor`; an agent never shifts to another gateway under its id.
- **What a model takes is read as needed, never kept.** A run reads its model's answer from its
  gateway's public catalog (about 1 KB on Vercel, `list.model`), and runs an effort the model
  doesn't take at Auto's, or at none, saying so in its details; the web chat's picker reads the
  same and offers only what each model takes. One function (`effortsFor`) holds a `use` line to an
  agent's own per-model list (`modelEfforts`, which replaces `noEffort`: Claude Code's Haiku).
- **One reader for every gateway's list.** A gateway's `list` says where its list has each fact of
  a model, so OpenRouter's and Vercel's both give names, prices, context, abilities and efforts to
  the picker, `/models` and Telegram; Vercel's list, which can't be searched by itself, is read
  once, whole, and searched here.
- **The web chat's picker and default.** An agent's gateways are a row under its tab, by their names
  (OpenRouter, Vercel; the page's budget is now 41 KB gzipped), and the default agent, in the picker,
  on GitHub's `/models` and in a run, is the one the repo variable `SHIPIFY_AGENT` names. A run's
  details name the gateway it went through ("pi · Vercel"). The Repeat form's Model is each agent
  as the file makes them on the page, and words on GitHub's form: no list kept by hand.
- **`ship setup <step> [--new]`:** does one step's part here, add-ons too (`apps`, `updates`);
  `--new` asks its key again (`ship setup agent --new` renews the agent's login). `ship setup apps`
  finds your Cloudflare account and workers.dev name with the deploy token and sets them;
  `ship setup` checks the template's key still reads the template, shows the login of the agent
  `SHIPIFY_AGENT` names (a gateway's key included), notices the edge lacking the door App's key,
  and lists the web chat as added once you're on it. `ship selftest <gateway>` checks its key,
  `ship selftest webchat` runs its own check, and the watch's key-date reminder names the command.

### Changed

- **The stacks' libraries, refreshed** (ts-static and ts-worker 1.0.4, ts-package 1.0.3): patch and
  minor versions only, each at least two days old: wrangler 4.149.0, Playwright 1.64.0, Vite 8.3.4,
  Vitest 5.0.3, Hono 4.13.13, Biome 2.5.15, and the types. A project takes them with
  `pnpm ship upgrade <id>` and its stack's migration note (`stacks/<id>/migrations/<version>.md`:
  `package.json` is the project's own, so the bumps are listed there), one PR each.
- **A ts-worker project names its preset** (`blank` or `tool`): a plan or `ship new` with none is
  refused at once (`presetRequired` in `stack.json`), where it used to fail only at the build's
  `make verify` ("Cannot find module './App'").
- **Faster runs: about 15–18 s off the ~70 s every run spends around the agent** (ADR 0051, task
  #335). Each step writes one line to the run's summary, its time and every `gh` call it made, and
  a test holds each step to a call budget; a box builds the CLI once per commit into one file
  (esbuild) in its read-only copy of Shipify, made first on every run, and every step and the
  agent's own `ship` commands start it (0.66 s, where `pnpm ship` takes 2.65 s, six times a run);
  plan writes its status from the task step's read and apply reads only the comments since; the
  writes that don't depend on each other start together, the status last. Your PC, CI and the
  `github` job keep the source through `pnpm ship`.

### Fixed

- **The edge is deployed when what it runs differs from main,** read from its `/health`: a push
  whose checks failed before its deploy no longer leaves the next push skipping it.
- **Security: an agent run can't change the rules a later ask starts with.** Before every ask (the
  first, a catch-up, the fix round), its settings folder, Claude Code's `settings.json`, and
  OpenCode's `~/.opencode`, cache and config folder are made fresh (an adapter names them:
  `cleared`); OpenCode reads no login of its own, and its gate withholds the key when the config it
  runs with was changed.
- **Security: pi's and OpenCode's gate refuses `git push` and `git stash` inside another command**
  (`sh -c`, `eval`, `find -exec`) and past a wrapper (`/usr/bin/env`, `sudo -u`).
- **Commands OpenCode runs use the slot's kept caches,** so pnpm's store and Playwright's browsers
  aren't downloaded every run and `test:e2e` passes; OpenCode loads no repo's own skills beside
  Shipify's.
- **An agent install cut short is redone** (its program doesn't start); one that starts is marked
  and kept.
- **`off` turns thinking off again on OpenRouter models that allow it** (Nemotron, pi's Auto, and
  DeepSeek V4.1 Flash): their catalog says it with `reasoning.mandatory`, not in their levels, and a
  run held `off` to Auto's `high` (a gateway's list may name that path: `list.off`).
- **A typo in the Repeat form's Model is said,** never run as Auto (the field takes `use` words,
  with or without `use`).
- **The web chat's picker asks again after a failed read** of the models' facts, and the edge no
  longer shares a read still going between requests (Workers may cancel it with the first).
- **Security: a list in your chat is always the box's.** A heading for a list in the agent's words
  (or in a page it read) no longer shows as a list in your chat while Yes approves another; a
  list's No now names its list too (`no <code>`), so one under an older reply drops nothing newer.
- **A list of notes alone expires after a day**, as a list of calls does, and a yes counts only
  after the reply that showed it.
- **A task with an open PR stays "needs you":** an answer to a follow-up question no longer makes it
  "answered", so the due run never closes it for quiet with the PR open (your merge then said
  nothing).
- **A `null` in a tool call's arguments is kept:** it clears a Notion property, as asked, where it
  used to be dropped silently.
- **`again` typed in a chat is answered there,** not only in your default channels.
- **Vercel's search finds only models with a zero-data-retention provider,** as its listed ones are
  (a list's `only` takes one of several words).
- **Notion:** replacing a page's body is refused, before anything changes, when a block holds others
  (a toggle, columns, a nested list), so nothing inside one, a subpage included, is deleted unseen;
  text over 100 lines or with a line over 2,000 characters is refused instead of cut (`create_page`
  too); a list says when a call replaces a page's whole body (a tool's `args.<call>.warn`), and
  `docs/security.md` no longer says a list can't delete anything.
- **Notifications keep Shipify's icon after the chat's sign-in ends** (served from `/note/`); the
  edge's log names each device's push-service answer and any store error; a device turned on while
  a notification goes out is kept; a file shared to the web chat waits for its menu, or says
  "Files aren't set up", never disappears.
- **`ship door check` skips a chat no one's on,** and every failing check names its fix.
- **A close as a duplicate drops the task** as "not planned" does (its open PRs closed).
- **A bare model word stays one model's with a second gateway:** the models a gateway names its own
  way are reached through its agent (`use pi-vercel glm-5.3`, or a bare word on a task already on
  it), so `use glm-5.3` and `use pi glm-5.3` are as before.
- **The `/models` help's example** is a model that takes an effort.
- **Runs that start at once on a new commit** no longer break each other's copy of Shipify (tasks
  #352-#356 failed with git's exit 128): each builds its own and the first moves it in.
- **A model found on Vercel ran on OpenRouter** from a `/models` button or `use <its id>`: a button
  through another gateway names its agent (`use pi-vercel <id>`), and an id only that gateway lists
  finds its agent from any task.
- **Efforts follow the model everywhere:** an effort with no model named is held to Auto's model
  (`use pi-vercel max`); the web chat's picker keeps an effort only on a model that takes it and
  offers Off only where the gateway's catalog does (its `none`, or `list.off`); `/models` says every
  effort an agent takes.
- **The web chat writes a pick under your message as the chip does** ("Pi · Vercel · glm-5.3"), not
  "Pi-vercel".
- **Lighter reads of a gateway's list:** a list read once serves a chat's answer and its buttons,
  and a list read whole is kept as long as a search (10 minutes).
- **Troubleshooting** names a Vercel account's zero-data-retention refusal ("No ZDR providers …")
  and its remedies; Vercel's models listed are ones with such a provider.

### Removed

- **Dead code and stale words:** an agent without an adapter (its `flags`; no entry could run
  without one), four functions only tests called, a second quiet-day close no run reached, the
  duplicate label writes of a close, and stale lines in the roadmap, troubleshooting, the watch's
  and box setup's docs (the watch never starts a run), the glossary and the ADR index.

## [0.1.3] - 2026-10-11

### Added

- **Replace a Notion page's body.** `update_page` takes an optional `content`, which swaps the
  page's whole body for that text (the same `#`, `- `, `- [ ] `, `1. ` lines `create_page` takes),
  so a placeholder like "[Add a quote here]" can be replaced through an approved call. The new text
  goes in first and the old blocks are deleted after, so a failure part-way never loses the page;
  subpages and sub-databases are never deleted, and the answer names them. `properties` and
  `content` can go in one call; a blank `content`, or one over 100 lines, is refused. It is still
  an act call: it waits for your `yes`. No append, archive or comments yet.
- **Notifications from the web chat, and Android's share menu** (ADR 0050, task #321). Turn on
  **Setup → Notifications on this device**, and a reply that reaches the web chat tells your phone
  or PC, with the chat closed: its state, its task and the task's title, never the reply's words; a
  tap opens the thread, and a newer one for the task replaces the older. Alerts, repeats and
  recipes notify you too once `web` is among your default channels, which `pnpm ship add webchat
  --yes` sets when you have none, so Telegram is optional. It's Web Push, encrypted end to end and
  signed with a key made on your PC (`WEB_PUSH_KEY`, the step **Turn on notifications**), in one
  file of the edge's on WebCrypto, with no dependency or new service: it rides on the call a run
  already makes to the door. Polling is unchanged. On Android, with the chat installed, **Shipify**
  is in the share menu: a photo, a PDF or a link opens New chat with it attached, and nothing is
  sent until you tap Send. On an iPhone, notifications come to the Home Screen app.
  Run `pnpm ship add webchat --yes` again to turn them on.
- **Approve a list from your chat, with one tap** (ADR 0049, task #317). A `yes` counts from
  Telegram and the web chat as it does on GitHub: the whole message, unedited, after the list,
  within a day. Under a list a chat shows only **Yes** and **No**: Yes sends `yes <the list's
  code>`, so it approves that list alone, and the agent's own quick answers are hidden while it
  waits (on #317, tapping one dropped the list). The list shows once (the box removes the agent's
  copy), last and whole in every chat; Telegram shortens only the words above it. A list over
  3,000 characters is approved on GitHub only. Merges, `go`, `publish`, `preview` and
  `start over` stay on GitHub. Turn on Telegram's password: your chat now approves calls through
  your tools.
- **Routines that write through your tools, set up in one PR.** A `pre` form in `tools.json` can
  name the tools it still counts after reading (`"after": ["notion"]`), so "every weekday at 8,
  read my Tasks and write today's plan under Daily" runs with no tap: its recipe and its form in
  one PR, approved by your merge. It never counts after the web, a check or another account. Each
  act call now names its target (`args.<call>.target`: Notion's `parent` and `page`), and a form
  must fix it. Think records which tools a run read (`looked`) apart from anything else
  (`elsewhere`); notes after any read still wait for your Yes.
- **↻ in the web chat:** in each header, left of **New chat** too. A tap reads what's on screen
  again, as coming back to the page does, and keeps what you've typed.
- **Every agent loads Shipify's skills on a task, and lessons become skill PRs** (ADR 0038). A run
  only named the folder of skills, so agents rarely read one. Now each run hands its agent the
  skills in its read-only copy of Shipify, and the agent lists all nine itself, each with when it
  applies, and loads one when it fits: pi with `--skill`, Claude Code from a link in its settings
  folder, made as the agent. A read run gets none. Each agent's adapter says how (`skills` and
  `skillsLink`), and the agent conformance test checks it. When you correct an agent, or it finds
  the way after dead ends, its reply ends with the skill, the lesson, and the words that keep it
  (`shipify: add to the <skill> skill: …`), a PR you merge: never a lesson an agent writes alone.
  Before asking you something, a run searches your past tasks for the answer. A skill check in
  `pnpm verify` (`tests/skills.test.ts`): each header is plain YAML, named for its folder, says
  when to use it, and is listed in `skills/README.md` and `AGENTS.md`. It found the Notion skill's
  header wasn't plain YAML, so pi had skipped it; it's fixed. Nothing to do.
- **OpenCode, a third agent** (ADR 0038), on the same OpenRouter key, models and Auto as pi:
  `use opencode`, `use opencode z-ai/glm-5.3 high`, the Repeat form's **OpenCode**, its own rows in
  Telegram's picker, a tab in the web chat's Who thinks, and `pnpm ship selftest opencode`. A box
  installs it the first time a run picks it (1.18.34, no package scripts, about 177 MB). It's held
  to the same rules as every agent: Shipify's gate is its plugin, since its own rules miss `env git
  push` and `/usr/bin/git push`, and checks its helpers' calls too, naming each in OpenCode's
  output, so a helper's read of the web or a tool counts as the run's (OpenCode's own events carry
  only its own calls). The gate holds its key: read once from fd 3 and put on each call to
  OpenRouter alone, so it's in neither OpenCode's config nor its environment. Its own config folder
  is made read-only before it starts (a new, optional
  `readOnly` in the agent contract): where it can write it, OpenCode installs a package from npm
  on every start, about two minutes on a Pi. A fixed session title, so no paid model is asked to
  name it. Checked live on a Pi against a stand-in model. To use it, nothing new: it needs the
  OpenRouter key pi uses (`pnpm ship add openrouter --yes`). Give that key a credit limit at
  openrouter.ai → Keys.

### Changed

- **A model two agents take stays on the task's agent** (pi and OpenCode share OpenRouter's). A
  listed model or any gateway id, named with no agent, stays on the task's agent when it takes it,
  else goes to the first that does (pi): `use glm-5.3` and `use moonshotai/kimi-k3` on an OpenCode
  task stay there, and on Claude they move to pi (an unlisted id used to be refused there).
  `/models <word>` names a line for each agent (`use pi <id> or use opencode <id>`), and its
  Telegram buttons send `use <id>`, so a tap picks on the task's agent. `/models` says an agent
  with the same models as another in one line. Labels use an entry's `name` ("OpenCode", not
  "Opencode"), and Settings shows a gateway's key once, naming every agent on it.
- **Security: the agent's login is on a pipe, never in its environment.** Claude Code's login
  (it lasts a year) and pi's gateway key (it spends your credits) were in the agent's environment,
  where any command it ran could read them: pi passes its whole environment to its commands, and
  Claude Code's own environment was readable in `/proc`. A page that tricked the agent into running
  one could send the key out. Now the box hands the login over on file descriptor 3, a pipe the
  agent reads once: Claude Code with its own setting (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`,
  checked live on 2.1.284), pi through Shipify's gate, which gives the key to pi's provider and
  closes the pipe. Nothing to do: it works the same on every box and on this PC. Each agent's
  adapter says how its agent reads the pipe (`loginFromPipe`), and the agent conformance test
  checks it. The sandbox check (`box add`, and `ship doctor` in each weekly clean-up) proves it
  with a dummy login, and checks that no command can read the agent's memory either
  (`kernel.yama.ptrace_scope` 1, Ubuntu's own). The read-only GitHub token and the tools' look
  keys stay in the environment, since `gh` and the tools' servers read them there.
- **A box's run lists your repos in two calls, not one per repo:** a run's plan reads your repos
  (ADR 0044), and each repo's `shipify.json` was a call of its own, about 0.7 s each on a Pi. They
  are now read in one GraphQL query (50 repos a query): about 4 to 5 s off every run with six
  repos, more with more. Still read on each run, so a repo made a minute ago works by its name.

### Fixed

- **A repeat made in Telegram no longer comes twice.** Its reply goes to your default channels
  (`SHIPIFY_SEND`) instead of also going to the chat it began in; with none that reaches you, it
  still answers where it began. (#230 came on Telegram and the web chat.)
- **Web chat on a phone.** Opened on a thread from a notification, Back now lands on the list, not
  out of the app. A tap on a notification reads the thread again at once, even when that thread is
  open, and the thin bar moves while it does. A notification shows Shipify's sail, not the default
  bell: a colour icon and a one-colour badge, both made from `icon.svg`. A file downloads where it
  is, without a second window. The keyboard resizes the page (`interactive-widget=resizes-content`),
  and pulling down no longer reloads it.
- **Shipify's own tests no longer saturate a small box** (task #328). `vitest.config.ts` caps the
  test workers at half the cores (never under two), so `make verify` and `pnpm verify`, which the
  box runs before every PR to Shipify, leave room for the runner and the agent. Projects' own test
  configs are unchanged.
- **Projects' tests carry the same half-cores cap** (task #332). The two platform-owned vitest
  templates (`stacks/ts-package`, `stacks/_cloudflare`) set `maxWorkers` exactly as Shipify's own
  config does, so a project's suite on a small box leaves room for the runner and the agent too.
  New projects get it at generation, existing ones at their next `ship upgrade` (ts-package 1.0.2,
  ts-static 1.0.3, ts-worker 1.0.3).
- **A result with unused fields written as `null` no longer fails the run** (task #328). A smaller
  model wrote `question`, `choices` and `files` as `null`, and a 30-minute run was marked Failed
  for it. The box now reads a `null` field as left out, and the agent is told to leave unused
  fields out. The task playbook also says to run one covering test file while working, read the
  full `make verify` once from a file, and never build a change in the read folder. No retry, no
  new step: the result is still checked once.
- **Shipify's own checks pass inside a task again:** a task's agent gets your copy's deploy values
  (`CLOUDFLARE_ACCOUNT_ID`, `CF_WORKERS_SUBDOMAIN`) for its own `ship build`, and five tests read
  them as this PC's, so the box's `make verify` failed every change to Shipify made by a task. The
  tests now start without Cloudflare's settings, as they do without GitHub's and Shipify's.
- **Security: this PC's box on WSL walls Windows off too.** WSL lets every Linux user open your
  Windows drives and start Windows programs, which run as you in Windows, so an agent could get
  out of the sandbox there, and `box add` labelled its slots `sandbox` all the same. Now the
  sandbox check (in `box add`, and `ship doctor` in every weekly clean-up) also checks no agent
  can open a Windows drive and that Windows programs don't run from WSL. Until then it gives no
  label and prints the fix: `[interop] enabled=false`, `appendWindowsPath=false` and
  `[automount] options="metadata,umask=077"` in `/etc/wsl.conf`, then `wsl --shutdown`. It changes
  nothing of WSL's itself. That means no Windows programs from WSL, so a Pi or a spare Linux machine
  may suit you better as the box ([box-setup.md](docs/box-setup.md#this-pc)). A PC already set up
  on WSL: `ship doctor` now names the open walls; make the fix, then `box add` again.
- **Tasks run on a box again:** since settings moved to GitHub, a run handed its agent your Shipify
  repo's name as `GITHUB_REPOSITORY`, which the box's sandbox refuses, so every task's think step
  failed. The sandbox now lets that one name through (nothing else of GitHub's), and a run off a
  box checks the same names, so a test sees what a box would refuse.
- **A staging app's release deploys staging again:** the pipeline refused `ship release`'s push
  to `main` as "more than a version bump", because it also holds `package.json`'s version and the
  change docs it stamps released. Those pass now, `package.json` only when nothing but its version
  changed; a file moved out of its place still counts as changed. Stacks 1.0.1 (`ship upgrade`).
- **Every commit on a project's `main` gets its run and its mark, docs too:** a merge of docs alone
  started no run, so its task said "the deploy never showed up" after 30 minutes, and a staging
  app's `ship release` waited on a mark that never came. A PR of docs alone still runs nothing.
- **The edge shows your new time zone without a deploy:** `/recipes`, the web chat's repeats and
  the repeat form read `SHIPIFY_TIME_ZONE` with your copy's other variables (a minute at most), as
  runs do; the zone it was deployed with is only the fallback.
- **A copy named other than `shipify` gets its door:** `ship door setup` and `ship door check` want
  the door App on your copy by its own name, and its manifest links there.
- **`ship door setup` wants a workers.dev name with a domain too:** the edge is always deployed at
  workers.dev as well, which Cloudflare refuses on an account with none, so setup stops first and
  says to open Workers once on the dashboard.
- **`shipify: release minor` and `shipify: release major` from a task:** each was taken for a
  change to Shipify, not a release; now it releases the next minor or major version, as
  `pnpm ship template --bump minor` does (whose plan now names that flag right too).
- **An update keeps what a copy added:** `ship update` took out every file of Shipify's the new
  release lacks, a tool, channel or agent the copy added among them. It now takes out only what
  the template itself removed since the copy's version (read from that release), and nothing when
  the template has no release of it, as its PR says.
- **A copy finds its template:** a release now writes the template's name into `package.json`
  (`"shipify": { "template": … }`), and an update reads it after `SHIPIFY_TEMPLATE`, before what
  GitHub says, which a bot's key scoped to the copy may not see on a private template. Setup's
  updates step reads it too, and asks for `SHIPIFY_TEMPLATE_TOKEN` when the template can't be read
  from this PC.
- **Getting started signs this PC in before cloning your private copy.**
- **`ship update` never offers an older version:** where Shipify is built, a release is recorded
  before the template's CI releases it, and for those minutes the copy is up to date, not behind.
- **A box's agent lays out projects with your copy's settings:** a merged plan's publish run and an
  `<app>: upgrade` task ran `ship build` or `ship upgrade` inside the sandbox, which has none of the
  run's variables, so the Cloudflare stacks stopped on `CF_WORKERS_SUBDOMAIN`. The agent is now
  handed every stack's deploy values that are set, and your time zone, by name (never a key).
- **A merged plan starts its build:** the run's checkout became shallow, so a push couldn't compare
  its two ends and the plans step failed silently. A push fetches main's history again.
- **`shipify: release` from a task passes its own check:** the release's full check runs inside the
  task's job, and a test read that job's `SHIPIFY_SEND`. Every test file now starts outside any job.
- **`ship pr` refuses a file still holding a merge's conflict:** `ship staging` merges into a
  project's own guides, and a conflict there passed every check.
- **`pnpm verify` skips a helper's worktree:** one inside the checkout (`.claude/worktrees/`, which
  git already ignores) stopped Biome with "nested root configuration".
- **An app whose home page is behind a sign-in passes its own browser tests:** the stack's tests
  (ts-static, ts-worker 1.0.2) open the home page, which for links is the admin page behind
  Cloudflare Access, so its `make verify` failed. A project names a public page instead:
  `export E2E_HOME := /a-public-page` in its `project.mk` (its own file, which upgrades keep).
- **`ship upgrade`'s next step for an app with no releases** no longer says `ship version`, which
  refuses there.

## [0.1.2] - 2026-10-09

### Fixed

- **`ship update` and `ship template` on a PC read the template's name:** a release keeps it on
  this PC too, and both read the copy's variable when it isn't there.

## [0.1.1] - 2026-10-09

### Fixed

- **Dependabot stays where Shipify is built:** its config is no longer published, so the template
  and every copy get no Dependabot PRs of their own; a copy takes dependency updates with each
  version's update PR.

## [0.1.0] - 2026-10-09

The first release of Shipify as a product: your own, started from "Use this template".

### Added

- **Your own AI engineer on GitHub:** ask from GitHub, Telegram or the web chat. A box of yours
  runs it, the agent only thinks (as its own Linux user, in a sandbox), and you approve on GitHub.
  Every message lives on a task, an issue on your copy.
- **Setup in four core steps** (`pnpm ship setup`), each checked for real: GitHub (your copy, on
  your account or an org), the bot, the agent's login, and a box. Everything else is an add-on
  that never blocks: chat and repeats (the door, the watch), plug-ins, other accounts, apps, and
  updates.
- **One way to make a box,** for a Pi, a VPS or this PC: `pnpm ship box add [<user@host>]`.
- **Apps and packages it builds stand on their own:** each carries its own pipeline (its stack's
  `ship.yml`, the same in every project), calling nothing of your copy's and handing no secret
  out. Previews when you ask, staging as a switch per app, releases that ask once. `ship upgrade`
  replaces the stack's own files and never touches the project's. Stacks start at 1.0.0, projects
  at 0.1.0.
- **Every repo, one kind of extension:** projects Shipify builds and deploys, and any other repo
  on your accounts, in its own way, by a PR a person merges. `/repos` lists them, and
  `remember <repo>: …` keeps what always applies to one.
- **The edge** (one Cloudflare Worker, free): the door for your chats, the watch every 5 minutes
  (repeats, reminders, alerts), and the status page, at its workers.dev address or your domain.
- **One list of settings** (docs/settings.md): what each is, where it lives, what sets and reads
  it, checked by setup, doctor and the tests.
- **Releases and updates:** `shipify: release` publishes a version to the template, and each copy
  is offered it as one PR (`update.yml`), keeping your plans, recipes, checks and app lists.
