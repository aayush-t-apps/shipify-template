# Shipify, the product

**Your own assistant for ideas, research and building. It keeps what you find, thinks with you,
and ships what you decide: one place, free, and yours** (ADR 0070). You run it yourself, for
free. You ask in plain words, from GitHub, Telegram or its web chat. It keeps your projects'
finds and facts on pages, reads any repo you point it at and works in that repo's own way. When
there's a change to make, it opens a PR, and a person merges it.

One loop says what it does:

| Step | What you get | You say or tap |
|---|---|---|
| **Capture** | a thought, a link or a screenshot saved in a second, with no run | `jot: …`, `add games: …`, **Add** |
| **Keep** | a project's pages: its Now, its Map, its facts with their sources, its Log | `project: games`, "collate the inbox", **Keep on page** |
| **Think** | answers, research and plans in chats that read the project first | **New chat here**, "check the project", "split it" |
| **Ship** | a PR, a new app, a deploy, a repeat, a change in Notion | `shop-web: add login`, `new: …`, `yes` |
| **Share** | a zip of a project, or a link to its files | **Export**, "share this as a drop" |

This page is the picture: what Shipify looks like as a product anyone can set up, and the road
there. Each step on that road is an ADR. [The road](#the-road) says which parts are live today.

## Who it's for

One person who builds, researches or learns. Not a team's tracker (no assignees, sprints or
boards), a paid service, or a second store.

| You are | You use it for |
|---|---|
| **A developer, on your own repos** | questions about your code, fixes and features as PRs, chores on a schedule, all from your phone |
| **A developer at work** | the same on your company's repos. An admin installs Shipify's small App on them, or you request it. PRs follow the team's rules and format |
| **A founder, a researcher or a student** | a project per idea or question: its finds in an Inbox, its facts and sources on pages, a chat per question, a check before you decide ([knowledge.md](knowledge.md)) |
| **A builder of apps** | the apps add-on: an idea becomes a plan, then a repo, a deploy and a live app, each step approved by you |
| **Anyone who wants their own** | a copy of Shipify and one guided setup. Your Shipify is yours: your repo, your machine, your agent's login, your data |

## Where it lives: one home

You install Shipify once, at home. Elsewhere it needs only the small App, and only on the repos
where you want PRs. Tasks are issues in your Shipify repo, never in anyone else's.

| Place | What's there | Its tasks (issues) | What you install | What Shipify leaves there |
|---|---|---|---|---|
| **Your Shipify repo** | the record, the queue, the rules, the keys | all of them | your copy of Shipify, and the bot | replies, each run's details, the status task |
| **Your box** | the runner and the agents | none | `pnpm ship box add`, once | a folder per run, cleared after it |
| **Cloudflare** (optional) | the door, the watch, the status page, the web chat | none | `pnpm ship door setup` | nothing of your code |
| **Your other repos, same account** | your code | none | nothing more | a branch `task/<n>-…` and a PR |
| **A company's org** | its code, its CI, its reviewers | none | the repos App, on the repos chosen | a branch and a PR. No issue, workflow, file or webhook |
| **Anyone's public repo** | their code | none | nothing | nothing: it's only read |

## What you can ask

Six kinds of ask, the same words on every channel:

| Ask | You say | What happens | You get |
|---|---|---|---|
| **a question** | `what changed in acme-site this week?` · `look at acme/api: how does sign-in work?` | the agent reads the code it needs, and changes nothing. `look at` reads any repo first: one on your accounts, or anyone's public one, read only | an answer |
| **a change** | `acme/api: rate-limit /login` | it works in the repo's own way, runs its tests, and commits on its own branch | a PR to review and merge |
| **a repeat** | `repeat: every Monday 9:00, list stale PRs in acme/api` | a job on a schedule | a reply each time |
| **a note** | `remember: small PRs, in bullets` | saved at once, with no AI; every later run reads it | "Saved" |
| **a new app** | `new: a tip calculator` | the apps add-on: a plan to approve, then a build and a deploy | a plan PR, then a live app |
| **an operation** | `tips: release` | the apps add-on: release, take down, bring back or roll back an app | the release PR, or the app's new state |

`acme` can be your own account, another org of yours, or your company's, once you've added it.

## How it looks

### Day 0: your own Shipify

```sh
# 1. Your copy: GitHub's "Use this template" makes it, private, on your account or org
gh auth login && gh auth setup-git   # this PC signed in first: the copy is private
git clone https://github.com/<you>/shipify && cd shipify && pnpm install
# 2. One guided setup: each step is checked, and the next one named
pnpm ship setup
```

Step by step: [getting-started.md](getting-started.md).

What setup walks you through, one step at a time:

1. **GitHub:** your login, and your Shipify repo's settings.
2. **The bot:** two clicks to create it, then **Install**.
3. **The agent's login:** your Claude subscription, or a gateway's key for other models
   (OpenRouter, some of them free, or Vercel's AI Gateway).
4. **A box:** the machine that runs the work. A Raspberry Pi, a small VPS, or your PC, on Ubuntu
   LTS. `pnpm ship box add <user@host>` sets it up.

That's the core. Each of these is a choice you can add later:
- **Codex:** on your ChatGPT plan (Plus or Pro), one sign-in.
- **Chat:** Telegram or the web chat, through the door, on Cloudflare's free plan.
- **Tools:** Notion and Drop today; the next one is a plug-in.
- **Other accounts:** the repos App (below).
- **Apps:** the ones Shipify builds and deploys, which need a Cloudflare account (a domain is
  optional).

**The check:** `pnpm ship doctor` and `pnpm ship selftest`. Each says ✓, or names the fix.

### Day 1: point it at your repos

- **Repos on your Shipify's own account** work at once.
- **Another account, such as your company's org:**
  1. Once, `pnpm ship bot repos --yes`: two clicks create the small App. Then, for each account,
     `pnpm ship bot repos acme --yes`: it adds `acme` to your accounts and opens the install page.
  2. On GitHub, whoever has the rights picks the repos and clicks **Install**: an org owner for the
     whole org, or a repo's admin for their own repos. A member clicks **Request**, and an owner
     approves.
- **Anyone's public repo** needs nothing. Shipify reads it, read only, and never runs anything in it.

### At a company

- **Your Shipify stays yours,** on your personal account, with your box at home or on a VPS.
- **The company installs only the repos App,** on the repos you work on.
- **Your colleagues see:**
  - PRs from `<name>[bot]`, in the repo's own PR template or Shipify's format;
  - its CI running on them, and commits named as the App.
- **They never see** your tasks, your chat or your notebook.
- **Check first:**
  - that your company is fine with an AI agent on your own subscription working on its code;
  - its GitHub rules. An IP allow list blocks your box until the box is added to it, and required
    signed commits block the merge for now.

The App asks for what it needs to read code and open PRs, and nothing more:
- **Write:** code and PRs.
- **Read:** issues, CI and checks.
- **Never:** no admin, no secrets, no workflows, and no webhook.

### Every day: one ask, from your phone to a merged PR

```
You       acme/api: rate-limit /login, 5 tries a minute
Shipify   👀  #312 · working
          …the box clones acme/api, the agent reads its AGENTS.md, CONTRIBUTING
          and README, writes the change and a test, and runs npm test and lint…
Shipify   PR ready: acme/api#88 "feat(auth): rate-limit /login to 5 tries a minute"
          Checked: npm test, lint. Left to CI: e2e (needs the staging database).
          Merge it on GitHub.
          Claude Opus 5.5 · 6 min · mybox
          (you review and merge on GitHub)
Shipify   Merged: acme/api#88. #312 is done.
```

On another account, Shipify sees the merge when the task closes with it, or on the task's next
run ([ADR 0045 §5](adr/0045-any-account.md#5-a-pr-on-another-account-from-open-to-merged)).

The PR, in Shipify's format. A repo with its own PR template gets that template, filled in:

```
feat(auth): rate-limit /login to 5 tries a minute

Adds a limit per IP to /login: 5 tries a minute, then 429 with Retry-After.
Stops password guessing without slowing normal sign-in.

## Changes
- src/middleware/rate-limit.ts: a small in-memory limiter (the README says no Redis)
- src/routes/login.ts: uses it
- test/login.test.ts: the 6th try in a minute gets 429

## Checked
- `npm test`: passed (142 tests)
- `npm run lint`: passed
- Left to CI: the e2e suite, which needs the staging database

## Notes
- The limit is per process. With more than one instance, it needs a shared store.

---
Closes <you>/shipify#312
Made by Claude Code (Opus 5.5) with Shipify.
```

Its commits show as Shipify's App. Its title follows the repo's style.

### Where you see everything

- **Your Shipify repo on GitHub** is the record:
  - every task is an issue, with its replies and each run's details (agent, model, time, tokens);
  - a status task shows what's coming up and anything failing.
- **Each repo's PRs** are where the work lands. A person merges them, never Shipify.
- **Your chat** (Telegram or the web chat) holds the same task as a conversation, with buttons for
  the next words.
- **The status page** shows, at a glance, what needs you, your apps and your boxes.

## How it's built

```
   You: GitHub · Telegram · web chat
            │ your words                          ▲ replies
            ▼                                     │
   ┌──────── your Shipify repo, on GitHub ────────────────┐
   │ tasks are issues · the queue is Actions               │
   │ the rules: playbooks, skills, AGENTS.md               │
   │ plug-ins: agents, tools, channels, stacks, recipes    │
   │ keys: GitHub's secrets, never on a box                │
   └───────────────────────────────────────────────────────┘
            │ a run, with one-hour tokens        ▲ a reply, a PR
            ▼                                     │
   ┌──────── your box: a Pi, a VPS, a PC ──────────────────┐
   │ task → plan → think → decide → apply                  │
   │ the agent thinks as its own Linux user, with read keys│
   │ the box writes only after the agent has finished      │
   └───────────────────────────────────────────────────────┘
            │ clones and PRs
            ▼
   repos: your account (the bot) · your other accounts (the repos App)
          · anyone's public repo (read only)

   The edge (optional, Cloudflare's free plan): the door for chats, the watch, the status page
```

**What attaches,** each through one contract and its conformance test, so adding one never
touches the core:

| Attach | How | Where |
|---|---|---|
| a repo, on any account | install an App on it | the bot · the repos App |
| an agent and its models | an entry, plus an adapter for its flags | `executors.json`, `cli/lib/agents/` |
| a tool (Notion, …) | an entry with its look and act calls | `tools.json`, `tools/` |
| a channel (Telegram, the web chat, …) | an adapter in the edge | `edge/src/channels/` |
| a stack, for projects | its files and its `make` targets | `stacks/` |
| a recipe or a check | a file, in a PR | `recipes/`, `checks/` |

## The rules it keeps, on every repo

1. **You ask; it answers or opens a PR; a person merges.** It never merges. It never pushes to a
   default branch, `main` or `production`, and it deploys only your projects.
2. **The repo's rules first:** its `AGENTS.md`, CONTRIBUTING, README, commands, CI, PR template
   and commit style.
3. **Then Shipify's rules:**
   - its own branch;
   - a secret scan before every push, and every reply and log masked for keys;
   - no workflow change without your `yes`, and only one that runs after your merge (none on
     another account);
   - nothing of Shipify's added, unless you ask.
4. **The least key, for the least time:**
   - one repo, for one hour, minted right before the step that needs it;
   - write access only after the agent has finished.
5. **Trust is yours to give.** A repo you haven't made yours is read only, with no key and no
   command.
6. **A run holds only what its repo's account may see.** Your notebook and tools stay out of
   another account's work.
7. **Everything shows on GitHub.** Every failure is told once, with its fix, and nothing is
   retried behind your back.

## Who holds what

Every key: [setup.md](setup.md#tokens-and-secrets). Who holds which, and what each may do:
[security.md](security.md#who-holds-which-key).

## What it costs

| Piece | Cost |
|---|---|
| GitHub: your repos, issues, Actions | free. Tasks run on your box. Only projects' pipelines, the watch and a few small jobs use GitHub's free minutes |
| Cloudflare, for chat, the status page and apps | free plan |
| A box | a machine you have: a Pi or an old PC. A VPS works too |
| The agent | your Claude subscription, your ChatGPT plan (Codex), or a gateway's models, some of them free |

## What it achieves

- **One place for all your repos' work:** your own, your company's, and anyone's public code, from
  your phone.
- **Autonomy with walls:** it works unattended, but holds only short, narrow keys, writes only
  through PRs, and a person always merges.
- **It fits each team's way:** their docs, commands, CI, PR template and commit style come first,
  so its PRs read like a careful colleague's.
- **Yours, and free:** your data stays in your accounts, and nothing is paid.
- **It grows without changing its core:** a new agent, model, tool or channel is a plug-in file.

## What it isn't

- **It isn't a hosted service.** Each person runs their own copy, and no one else holds your keys
  or your code.
- **It isn't CI.** Each repo's own CI checks its PRs.
- **It isn't auto-merge.** A person merges every change.

## The road

| Step | What | Where it stands |
|---|---|---|
| **Built** | tasks, boxes and runs, with runs that stay (ADR 0057) and sub-tasks (ADR 0066); a box from one command, or in Docker (ADR 0055, ADR 0056); Claude Code, pi, OpenCode and Codex (on your ChatGPT plan, ADR 0074); GitHub, Telegram and the web chat, with guests (ADR 0071); Notion, and Drop with pages as drops (ADR 0072, ADR 0073); the notebook; projects with their pages and Inbox, and the Journal (ADR 0069, ADR 0070); repeats, errands (ADR 0054) and recipes; apps (plan, build, deploy, release); any repo on your account, its own way, and a read-only look at anyone's (ADR 0044) | live |
| **1. Any account** | the repos App, your accounts as the trust, one PR format, a repo's default branch, masking for today's tokens ([ADR 0045](adr/0045-any-account.md)) | live (2026-10-09) |
| **2. Your own Shipify, for anyone** | a copy anyone can make (a template), a core setup in four steps on a user account or an org, your files kept apart from Shipify's, and Shipify's updates arriving as a PR you merge ([ADR 0047](adr/0047-your-own-shipify.md)) | live (2026-10-09) |
| **3. Polish** | verified (signed) commits, a PR from a fork for anyone's public repo | later |

## If you go further: open source, a team, or hosted

Three ways Shipify could grow past one person's own copy. Open source is built in part: the
template is public, under the MIT licence. Each step past that is your decision. All three keep
the same core and rules.

| | Your own copy (today) | Open source | A team on one Shipify | Hosted |
|---|---|---|---|---|
| **What it is** | you run your own | you publish the framework; everyone runs their own private copy | one Shipify for several people, at home in the company's org | someone runs Shipify for others, behind a sign-up |
| **Who runs it** | you | each person | the company | the host |
| **Whose keys** | yours | each person's own | the company's | the host holds everyone's |
| **Cost** | free | free | free, plus the company's agent accounts | paid |
| **Needs first** | | for contributions: a security policy, and CI on contributors' PRs | a design for people and approvals | a business |
| **Status** | live | in part: the public template; contributions are your call | a design of its own | not planned |

**Open source.**
- **Built:** step 2 of the road; the template, public with a fresh history and your private words
  replaced (ADR 0055, [releases.md](releases.md)); the MIT licence.
- **What contributions need first:** a security policy, and CI on contributors' PRs (today CI runs
  after the merge, ADR 0018). Until then the template takes no issues or PRs from others.
- **What you get:** others run it and add agents, tools, channels and stacks as plug-ins. You keep
  yours private, and take updates by merging a PR.
- **Never public:**
  - your tasks and notebook, which are issues in your repo;
  - your plans, your settings and your keys.

Nothing is published without your go-ahead.

**A team on one Shipify.**
- **The setup:** home in the company's org, a company machine as the box, and the company's agent
  accounts or API keys.
- **What it needs first:**
  - a people list, with what each person may approve;
  - a notebook and approvals for each person;
  - the repos App as the home's App too, so the big bot isn't needed.
- **What you get:** everyone asks from their phone, and the team's reviewers merge. There's one
  queue, one status page, and one set of rules for the company.
- **What doesn't change:** one task, one account; the least key; a person merges.

**Hosted Shipify.**
- **What it would take:**
  - holding other people's keys and code;
  - paid machines and paid model keys, since a personal subscription is for its owner's own use;
  - accounts, billing, isolation between customers, terms, support and uptime.
- **Why not now:** it breaks two of the core's rules (free only, and keys stay with their owner),
  and it's a business decision of its own, not a build step.
- **The middle ground:** open source gives most of the reach, with each person's keys staying
  theirs.
