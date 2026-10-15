---
status: accepted (merged #405) and built, with two corrections: the template keeps Actions on (its CI makes each release; its workflows never run on a pull request and do nothing without a copy's variables), and a public copy is refused by `box add` and `ship doctor` rather than a new line in the watch
date: 2026-10-15
amends: 0047 (the template may be public, published with your private words replaced), 0031 (a box can also be made from the machine itself with one public command)
---

# 0055: A public template, and a box from one command anywhere

## The plan in short

**What:**
- The template, `<owner>/shipify-template`, becomes public. It's published with a fresh history,
  and with words you keep private (an employer's name, your home address) replaced.
- It carries one command that makes any Ubuntu machine a box: a cloud VM, a spare PC, a friend's
  laptop. You approve a GitHub code on your phone, answer two questions, and the box is live.
  Nothing else is needed: no PC, no keys copied, no login left behind.

**Why:** the owner, 2026-10-15: "cant i keep some cli script public in my repo for quick setup …
it can just ask for my setup or code i can approve", "no other repo", "if we make public i can just
start the flow from template", "think about all security and all edge cases make it robust clean
generic".

## What was found (checked 2026-10-15, `main` at `f8d7746`)

| Fact | How it was checked |
|---|---|
| The template is private, with 6 commits: one per release (0.1.0 to 0.1.5), Shipify's own files only (no plans, no tasks) | `gh repo view`, a clone, `docs/releases.md` |
| Copies take the template's newest release as files, not its history: a fresh history breaks no copy | `update.yml`'s header, `cli/commands/template.ts` |
| No real key in any of the 6 commits: every key-shaped string is a test's fake or a comment | a scan of every commit for GitHub, OpenRouter and PEM key shapes |
| Personal words are in them: an employer's name as the example account (ADR 0045), the home Pi's address and SSH alias, account names (ADRs 0002 to 0048, a few tests, `package.json`'s `template`) | a scan of every commit |
| `box add` already works on the machine it runs on, with sudo asking once, and needs only a `gh` login that can manage the copy's runners, plus Node and pnpm | `cli/commands/box.ts` (`ensureOwner`, `checkAdmin`, the "here" path) |
| A task run's machine is fixed before it starts (`runs-on: [self-hosted, shipify-box, sandbox]`): the run can't read a per-task choice first without another job on GitHub's machines, a billed minute per run on a private repo | `.github/workflows/task.yml` |
| The template's workflows do nothing without a copy's variables (`vars.SHIPIFY_OWNER != ''`) | each workflow's `if` |

## Decisions

### 1. The template is public, with a fresh history and your private words replaced

- **Your words stay yours.** The list of words to replace lives in a variable,
  `SHIPIFY_PRIVATE_WORDS`, on your copy (JSON, word → stand-in, e.g. your employer's name →
  `acme`). It's never in a file, because the list is itself private. `ship template` replaces them
  in the published files only. Your copy, and its approved ADRs, are never edited.
- **Checked every release:** `ship template` refuses to publish when a listed word, a key shape
  (the same check as the secret scan) or a private address (`192.168.`, `10.`, `*.ts.net`) is
  still anywhere in what it would publish. It names the file and line.
- **A fresh history, once:** the next release (0.1.6) is the template's first commit on a new
  history, and the old six commits and their tags go. You do this step yourself, once
  (below). Copies don't notice, because they take files.
- **What stays private:** your own copy, `<owner>/shipify`, its plans, tasks, notebook, secrets,
  variables, boxes and apps. Only the template is public.

### 2. The public template is inert and closed to others

| Setting | Why |
|---|---|
| **Actions off** on the template | its workflows already do nothing there, and this makes it certain. A copy made from it has Actions on as usual |
| **Never a runner** on a public repo | on a public repo, anyone's pull request could run code on your box. `box add` and `ship doctor` refuse a repo that's public, and the watch alerts if your copy turns public |
| **Issues off; pull requests from collaborators only** | nothing to triage from strangers |
| **Secret scanning and push protection on** | GitHub's own second check, free on public repos |
| **A licence** | your choice: without one, people may read and use the template but not reuse its code. MIT keeps it simplest |

### 3. One command makes any machine a box: `box/here.sh`

**Run on the machine: one line, as Claude Code's installer is:**

```sh
curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash
```

- **Where it comes from:** each release attaches `here.sh` to the template's GitHub release, with
  its SHA-256 in the release notes. `latest` is always the newest release.
- **Options go after `bash -s --`:** for example `curl -fsSL … | bash -s -- --remove`.
- **To pin or read it first:** use the release's own URL (`…/releases/download/v0.1.6/here.sh`),
  save it with `-o here.sh`, check `sha256sum here.sh` against the notes, then run `bash here.sh`.
- **Like Claude Code's installer:** one line, the platform checked first with a clear stop, its
  downloads checked (Node's checksum), and safe to run again. **Unlike it:**
  - it asks questions, reading them from the terminal, which works under a pipe;
  - it needs sudo once, for the box's own users and services;
  - it leaves only the box behind.

**What it does, in order, stopping with the fix at the first problem:**
1. **Looks first, changes nothing:**
   - **The OS:** Ubuntu 24.04 LTS or newer, on x64 or arm64.
   - **The user:** a normal user who can sudo. As root, it says to log in as the default user
     (`ubuntu`) instead.
   - **The machine:** memory (4 GB for one slot) and disk (25 GB).
   - **The network:** it can reach GitHub.
2. **Installs what's missing** into a folder it removes at the end: `gh`, Node 22 (nodejs.org's
   build, its checksum checked) and pnpm.
3. **Your approval, on your phone:** `gh auth login --web` prints a code. You enter it at
   github.com/login/device and approve "GitHub CLI". It reads every answer from the terminal
   (`/dev/tty`), so it works when piped too.
4. **Which copy:** it asks, defaulting to `<your login>/shipify`. It checks the copy before going
   on:
   - you can manage its runners;
   - it's private;
   - it's a Shipify copy (`SHIPIFY_OWNER` is you).
5. **That copy's own `box add`:** it clones your copy into the temporary folder and runs its
   `pnpm ship box add`, so the box always matches your version.
   - It shows the plan first.
   - It asks the box's name (the hostname by default) and its slots (what the memory fits).
   - Then it sets the box up as on a Pi.
6. **Always, even on a failure or Ctrl-C:**
   - it logs `gh` out and deletes the clone and the temporary tools;
   - it prints the link to revoke the approval, github.com/settings/applications. That's needed
     on a machine that isn't yours, since a logout only forgets the login on the machine.
7. **Says it's live:** the box's name and slots, `/ping` to see it, and how to remove it.

**Other ways in:**
- `bash here.sh --token`: paste a fine-grained token instead of the code. Tighter: one repo,
  Administration and Variables write, Contents read, a day long.
- `bash here.sh --remove`: unregisters the box's slots and stops its services, with the same
  approval.
- Running it again on a box updates it in place, as `box add` does.

**After setup the box holds no key**, as every box (ADR 0031): each job brings one-hour tokens, and
the agent's login comes on a pipe.

### 4. Which box runs a task: any free slot

- **Kept as it is:** every slot labelled `sandbox` takes the next run, on any box.
- **Not built:** choosing a box per task. A run's machine is fixed before the run can read the
  task. Choosing would need an extra job on GitHub's machines for every run (a billed minute each),
  or the door starting every run itself. Both cost more than they give.
- **To try a new box:**
  - `pnpm ship box health <name>`;
  - or its clean-up run (Actions → watch → `cleanup`, box `<name>`), which runs doctor and the
    sandbox check on that box;
  - or `pnpm ship box stop` on the others for a while.
- **A standby box:** `box stop` keeps it out of the queue until `box start`.

## Edge cases

| Case | What happens |
|---|---|
| Not Ubuntu LTS, 32-bit, or a 39-bit kernel | stops before installing anything, naming what to use (as `box add` does) |
| Root login (common on cloud VMs) | stops: "log in as `ubuntu` (or `adduser you && usermod -aG sudo you`), then run it again" |
| Under 4 GB of memory | stops; one slot needs about 2 GB plus 1 GB for the system |
| No `sudo` password set (cloud default users) | works: sudo doesn't ask |
| The code expires (15 minutes) or you decline | stops, logged out; run it again |
| The approved login can't manage the copy, or the copy is public | stops with the reason, logged out |
| A box of that name exists elsewhere | asks: another name, or replace it (`--replace`) |
| Interrupted mid-setup | cleans up; running it again finishes, since `box add` is safe to repeat |
| `curl … \| bash` with no terminal (a cloud's start-up script) | stops: it needs your approval, never a stored key |
| Behind a proxy | uses `HTTPS_PROXY` as `gh`, npm and the runner do |
| Off for 14 days | GitHub drops its runners; run the command again |
| An employer's machine | your call and theirs: a box runs your agent and your code there |
| The template changes while you run it | `latest` resolves once, at download; a pinned release URL never changes, and its SHA-256 is in the notes |
| Piped (`curl … \| bash`), so stdin is the script | every answer is read from `/dev/tty`; the whole script is read before anything runs (one function called on its last line), so a cut-off download runs nothing |

## What this touches

- **New:**
  - `box/here.sh`, attached to each template release with its SHA-256 by `ship template`;
  - `ship template`'s replacing and its check (`SHIPIFY_PRIVATE_WORDS`, on the settings list);
  - a public-repo refusal in `box add` and `ship doctor`;
  - a public-copy line in the watch's guard;
  - tests:
    - `here.sh`: shellcheck, no answer read from stdin, the cleanup on every exit;
    - the replacing and its check;
    - the refusal.
- **Docs:**
  - `docs/box-setup.md`: "Anywhere, with one command" first, then the Pi, VPS and PC as now;
  - `docs/releases.md`: public template, private words, the fresh history;
  - `docs/security.md`: a public template, approvals and revoking;
  - `docs/setup.md` and `docs/settings.md`: the new variable;
  - `docs/troubleshooting.md`: one row per edge case above;
  - `README.md` and `AGENTS.md`: the command;
  - `CHANGELOG.md`.
- **Removed:** `SHIPIFY_TEMPLATE_TOKEN` is no longer needed for a public template. It's kept for
  a private one.

## What you do

1. Merge this ADR.
2. Merge the build PR when it's ready. It ships as Shipify 0.1.6.
3. Set your private words, as a variable you can change any time:
   `gh variable set SHIPIFY_PRIVATE_WORDS -R <owner>/shipify --body '{"<word>":"<stand-in>"}'`.
4. Release: `pnpm ship template` (it shows the plan and runs the check), then `--yes`.
5. Once, the fresh history and the switch, from the steps the release prints:
   - replace the template's history with the 0.1.6 commit;
   - delete its old tags;
   - Settings: public, Actions off, Issues off, pull requests from collaborators only, secret
     scanning and push protection on;
   - add a licence.
6. The live test: on a fresh VM, run
   `curl -fsSL https://github.com/<owner>/shipify-template/releases/latest/download/here.sh | bash`
   and approve the code on your phone. Check:
   - the box is online (`/ping`);
   - a task runs on it;
   - `--remove` takes it away.
