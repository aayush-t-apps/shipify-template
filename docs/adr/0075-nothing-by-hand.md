---
status: accepted (merged #699; the owner's `go` on 2026-11-06) and built in one PR (task #692); see [As built](#as-built-2026-11-06)
date: 2026-11-06
amends: 0031 and 0044 (a workflow change the owner approves in a chat may be pushed to a task's branch), 0049 (a list may hold a workflow change, or a task to do first), 0066 (a task to do first: one part, started on your Yes, that never closes its parent)
---

# 0075: Nothing by hand: workflow changes you approve in the chat, and a fix on main as its own task

## The plan in short

**Your asks (task #692, 2026-11-06):**
- "i want to fix it to make changes from here for next time not github help me wirh proper rules
  cleanly", after you made three edits on GitHub by hand to get Codex in (ADR 0074).
- "Why is it in preferences we can raise a strong robust guided setup PR then tell me completely
  properly whaf is pending and fixes overall".
- "build the rules PR complete it thoroughly", for the two rules the reply of 14:04 proposed: no
  hand edits, and workflow changes approved in the chat with Yes and No.

**The answer:**
- **Rule 1, nothing by hand.** A run never asks you to edit a file (in GitHub's editor or on a
  PC), apply a patch, or copy words into a new chat. Every change comes as a PR you merge, a list
  you approve with Yes, or a word you say. The playbook says so, and the two cases that forced
  hand edits get a way from the chat (rule 2 and `first`).
- **Rule 2, a workflow change you approve.** A run commits a workflow change as any other change.
  The box holds that change back, pushes the rest of the work, and lists the change under the
  reply: the exact lines, and what the box checked. On your Yes, the box pushes exactly those lines
  to the task's branch, and nothing else. Your merge on GitHub still decides what reaches `main`.
- **The wall that makes a chat Yes safe:** the box lists a change only when nothing it changes can
  run before your merge. Shipify's four workflows run only from `main`, so a change to them on a
  task's branch runs nothing until you merge it. A change that would run on the branch (a
  project's pipeline, a repo's PR checks) is never listed. That is the one case left for your
  hands, on purpose.
- **A fix on main first, as its own task (`first`).** The box runs `main`'s code. When that code
  blocks a task, the run proposes the fix as one task, listed for your Yes. Your Yes opens it and
  starts it. When it merges, this task says so, and `continue` carries on.
- **No new key, permission or workflow change.** The bot App has workflows write already. The
  build changes no workflow file, so it needs no hand edit either.
- **The build is one PR,** after you merge this and say `go`. Merging accepts sections 4 to 7.

## 1. What happened, and why

On task #692, the run needed one step in `.github/workflows/task.yml`: the token step that lets
the box write Codex's refreshed sign-in back (ADR 0074). Then:

1. A run can't push a workflow file (ADR 0031). So the run gave you a patch, and you pasted the
   step on #695's branch in GitHub's editor.
2. The box's two checks (`ship pr --check` and the push in apply) compare the branch with `main`.
   They saw your step as the run's own change and refused every later run on #695.
3. The fix to those checks had to be on `main` first, because the box runs `main`'s code. A fix
   on the branch can't unblock the branch. So you made two more edits by hand, on `main`
   (commits 2803c620 and 9137c9ef).
4. While the push was refused, the run's other work couldn't reach the branch either: it came to
   you as a second patch.

**The causes:**
- No way to approve a workflow change from a chat.
- No way to start a fix on `main` as its own task: the reply asked you to paste words into a new
  chat, then to edit two files.
- A refused workflow change refused the whole push, so the run's other work was kept only as a
  patch.

Your two edits on `main` stay: a workflow file on the task's branch on GitHub, which the run left
as it is there, isn't the run's. After this ADR, a change you approved is on the branch the same
way, so later runs on it go through.

## 2. What was checked (main at 5bab8129, 2026-11-06)

| Assumption | How it was checked |
|---|---|
| The bot App has workflows write. The repos App has none, and GitHub refuses its push of a workflow file | `BOT_PERMISSIONS` and `REPOS_PERMISSIONS` (`cli/commands/bot.ts`); `task.yml`'s comment on the repos App's mint |
| The write token asks for workflows write when decide says the run's commits touch a workflow file | `task.yml` (`permission-workflows`), `needs.workflows` (`cli/kernel/decide.ts`), `touchesWorkflows` (`cli/kernel/think.ts`) |
| A `yes` with no agent can mint a write token: decide runs for the box's own plans, and the write step needs only decide's `repo` | `task.yml` (the steps Decide and "A write token for the one repo this run changes"), `needsOf` (`cli/kernel/run.ts`). So rule 2 needs no change to `task.yml` |
| Today a workflow change refuses the whole push, and `ship pr --check` refuses it in a task | `pushed()` (`cli/kernel/apply.ts`), `platformRules` (`cli/commands/workspace.ts`) |
| Nothing in an agent's sandbox stops it from writing under `.github/`. The rule is the playbook's words, `ship pr --check` (Shipify only) and apply's check | the four agents' gates and settings (`cli/lib/agents/`, `executors.json`) |
| For `issues`, `issue_comment`, `schedule`, `repository_dispatch`, `workflow_run` and `pull_request_target`, GitHub runs the workflow as it is on the default branch. For `push`, as it is in the pushed commit. For `pull_request`, as it is in the PR's merge commit. `workflow_dispatch` runs on the default branch unless someone with Actions write names another branch | GitHub's "Events that trigger workflows" ([Sources](#sources)) |
| The box starts a workflow only on the default branch: `gh workflow run` with no `--ref` | `githubQueue().dispatch` (`cli/lib/github.ts`) |
| Shipify's four workflows run only from `main`: `ci.yml` (a push to `main`, a start by hand), `task.yml` (issues, comments, a push to `main`, a start), `watch.yml` (issue labels, a push to `main`, a start), `update.yml` (a schedule, a start). So a change to them on a task's branch runs nothing until it's merged | their `on:` blocks |
| A project's pipeline (`ship.yml`) runs on its PRs (`pull_request`), with its actions (`.github/actions/`) | `stacks/_base/files/.github/workflows/ship.yml`; `stacks/_ts/layer.json` |
| One list, one code, one Yes, within a day, from you only. A guest's `yes` is words. Each kind on a list is added to its code only when it's there, so older codes stay valid | `listCode` (`cli/kernel/keys.ts`), `yesOrNo` (`cli/kernel/decide.ts`), the door's guest rule (`edge/src/door-in.ts`) |
| A split's Yes opens sub-tasks and their blocked-by links; `go #n` starts one; a part's close run tells its parent and starts what waited for it | `cli/kernel/parts.ts` (`partsOf`, `partClosed`), ADR 0066 |
| `yaml` 2.9.1 is already a dependency, so reading a workflow's `on:` needs no new package | `package.json`; `cli/lib/form-reader.ts` and others use it |
| **Not checked live:** whether GitHub asks for workflows write when a push's commits change a workflow file and a later commit in the same push changes it back | The build keeps asking for workflows write whenever the run's commits touch one, as today, so it works either way |

**Found on the way, fixed in the build:**
- `docs/security.md` and `docs/tour.md` say the write token gets workflows write only for files
  that match the stack. In the code, decide asks for it whenever the commits touch a workflow
  file, and apply checks the files after the mint. The docs will say what the code does.
- The three checks find "the run's workflow change" in three ways (two dots against the branch,
  three dots against `main`, and that plus edits not committed), and only apply looks at
  `.github/actions/`. The build gives them one helper.
- `ship pr --check`'s refusal points to "playbooks/task.md, Shipify itself" for how to take a
  workflow change out, and that section doesn't say. The new words replace it.

## 3. Options

**For workflow changes:**
- **A: The run commits it, the box holds it back and lists it, and your Yes pushes it** (chosen).
  (+ The run's tests see its change, and the rest of its work is pushed at once. + You see the
  workflow lines alone, with what they can reach. − One hold commit on the branch.)
- **B: No Yes.** Let through any workflow change that runs only after the merge, as your merge
  approves it. (+ One tap fewer. − A workflow line in a big PR is easy to miss at the merge, and a
  workflow holds the keys. The Yes shows it alone.)
- **C: The run puts the change in its result, never in its commits.** (+ No hold commit. − Its
  tests that need the change fail in the box's checks, and the run can't check its own change.)
- **D: Also list a change that runs before the merge** (a project's pipeline, a repo's PR checks).
  (− It runs with that repo's keys on the push, before any merge. A chat sign-in would then be
  enough to run code with your keys.)
- **E: As today:** the run gives you a patch. (− This is what you asked to end.)

**For a fix on `main` first:**
- **A: `first`, one task the box opens and starts on your Yes; this task waits, and `continue`
  carries on** (chosen).
- **B: A split of two parts,** the fix and then the rest. (− A split isn't listed while the task
  has an open PR, and that is when the block happens. The rest would lose the PR's work.)
- **C: The fix on this task's branch.** (− The box runs `main`'s code, so it can't unblock the
  branch.)
- **D: Words to send as a new chat.** (− A hand step: what happened on #692.)
- **E: This task starts again by itself after the fix merges.** (− Your preference: no work starts
  unless you ask. `continue` is one word.)

## 4. Decision: rule 1, nothing by hand

The playbook's Rules gain one line, and its Never line changes:

- **Nothing by hand:** never ask the owner to edit a file (in GitHub's editor or on a PC), apply
  or paste a patch, run a command on a PC that a chat word does, or copy words into a new chat.
  Every change is a PR they merge, a list they approve with Yes (calls, a workflow change, a task
  first), or a word. A workflow change: commit it as any change, and say in plain words what it
  does and why: the box holds it for their Yes (rule 2). When `main` must change before this task
  can go on: propose `first`.
- **Never** (was: "anything under `.github/workflows/` except what `ship upgrade` writes"): a
  workflow change the task doesn't need.

**What stays yours, by design:** a merge; GitHub-only operations (an app down, back up, a
rollback, ADR 0049); a setting or a sign-in on another service (for example ChatGPT's switch for
sign-in with a code); a workflow change that would run before your merge (section 5.4); and
workflow files on another account, which the repos App can't push (ADR 0045). A run that meets one
says it is yours and why, in one line, and gives the link.

## 5. Decision: rule 2, a workflow change you approve

### 5.1 The run commits it

The agent changes the workflow file in its clone and commits it, as any change, with its tests.
`ship pr --check` lets it through, and refuses only a change that would run before the merge
(5.4), so the agent learns that in its own session. Its reply says, in plain words, what the
change does and why. That text is the agent's. The list below it is the box's.

### 5.2 The box holds it back and pushes the rest

**The run's workflow change** is every file under `.github/workflows/` or `.github/actions/`
that differs between the task's branch on GitHub (else `main`) and the run's commits, but for a
project's stack's own render (as today). One helper finds it, for `ship pr --check`, decide and
apply.

- **Decide,** only when the run's commits touch `.github/workflows/` or `.github/actions/`, reads
  the run's bundle into a clone of its own, as apply does (hooks off, only `.github/` checked out),
  and makes the change's patch, its checks (5.4) and its facts (5.3).
- **Apply** adds one commit on top of the run's commits, made by the bot: "Hold the workflow
  change for your yes". It puts each held file back as it is on the branch on GitHub (else as it
  was where the branch left `main`), or removes it when it isn't there. Decide's patch starts from
  the same version. Then apply's check of today runs, unchanged, and must pass: after the hold,
  the push changes no workflow file of the run's. Then the push.
- **When the held change is the run's only change,** nothing is pushed yet. Your Yes pushes it and
  opens the PR the run asked for.
- The run's own lines stay in the branch's history, but never run. GitHub runs a branch's
  workflow from its newest commit only, and on Shipify only from `main`.

### 5.3 The list: what you see

The change goes on the reply's one list (ADR 0049), with one code and one Yes, beside any calls:

```
**To do after your `yes`** (tap Yes, or say `yes`, within a day)
1. Change `.github/workflows/task.yml` on PR #695's branch (+14 −0). It runs only from `main`,
   after your merge: on a task or comment, a push to `main`, or a start. Its new lines use the
   secret `CODEX_AUTH` and the action `actions/create-github-app-token@<sha>`.
   ```diff
   (the exact lines)
   ```
```

- **The facts are the box's, never the agent's:** the file, the lines added and removed, when the
  file runs (from its `on:`, in plain words), and each secret (`secrets.X`) and action (`uses:`)
  its new lines name.
- **After a read from outside** (a web page, a repo outside your account): one more line, "This
  run read from outside: read each line before your Yes", as for calls.
- **The patch is in the list whole.** The code covers it. A patch over 12,000 characters isn't
  listed ("too big for one Yes: ask for it in steps"). A list over 3,000 characters is approved on
  GitHub only, as any list.
- **Kept with the list** in the task's status: the repo, the branch, the patch and its SHA-256;
  and, when nothing else was pushed, the PR the run asked for (its kind, title and body).

### 5.4 The rule the box checks: nothing it changes runs before your merge

A file the change touches is listed only when, after the change:

- **A workflow file** runs only on events that GitHub runs from the default branch: `issues`,
  `issue_comment`, `schedule`, `workflow_dispatch`, `repository_dispatch` and `workflow_run`; and
  `push` only with `branches` that name the default branch alone (no pattern, `tags` or
  `branches-ignore`). `pull_request`, `pull_request_target` (refused by ADR 0006 too),
  `workflow_call` (it runs inside whichever workflow calls it) and any other event make it "runs
  before the merge".
- **An action** (`.github/actions/`) is used by workflows: so it's listed only when every workflow
  on the branch passes the rule above.
- **A deleted file** runs nothing: it passes.
- **A file that isn't YAML** fails ("can't read its `on:`").

Not listed, the change stays held. The reply says which file, which event, and why. The rest of
the work is pushed as usual.

`workflow_dispatch` counts as after the merge: the box starts a workflow only on `main`, and only
someone with Actions write (you) can start one on a branch, on purpose.

### 5.5 Your Yes: the box pushes exactly that

The Yes is a box run with no agent (as for calls). Decide asks for the repo's write token with
workflows write. Apply, in a fresh clone of the task's branch:

1. Checks that the patch's SHA-256 is the one on the list, and that it touches only the listed
   files, all under `.github/`.
2. Checks that the branch's PR is still open, when the branch has one.
3. Applies the patch (`git apply`). It refuses when the branch changed under it.
4. Checks the rule (5.4) again on the result, and scans the change for keys (gitleaks).
5. Commits as the bot, "ci: the workflow change you approved (list `<code>`)", and pushes it to
   the task's branch (`task/<n>-…` only), once (a journal entry, as calls have). When the branch
   had no PR (the held change was the run's only change), it opens the PR the run asked for.

The reply: "✓ Pushed the workflow change you approved to PR #695: `.github/workflows/task.yml`
(commit `abc1234`)", or ✗ and why, with what to say next.

**No**, or other words: the list is dropped, as any list. The change isn't on the branch. A later
run reads it in the thread and makes it again when it is still needed.

### 5.6 Which repos

| Repo | A workflow change |
|---|---|
| Shipify itself | held, and listed when it passes 5.4 (all four of its workflows do today) |
| A repo that keeps its own rules, on your account | held, and listed when it passes 5.4. A change to its PR checks (`pull_request`) isn't: the reply says it's yours |
| A project's pipeline (`ship.yml`, its stack's actions) | as today: only as its stack renders it (`ship upgrade`). It runs on PRs, so any other change is held and not listed: the reply says to change the stack (a `shipify:` task) |
| A project's other workflow files | held, and listed when it passes 5.4 |
| A repo on another account | held, never listed: the repos App can't push workflow files. The reply shows the lines as text, for you to make there if you want |
| A guest's run, a read run | never: they push nothing |

## 6. Decision: a fix on main first, as its own task (`first`)

- **The result's `first`:** `{"title": "<repo>: …", "brief": "…"}`, one task (its brief 600
  characters at most, as a split's). For when `main` must change before this task can go on,
  because the box runs `main`'s code. It comes alone (no `pr`, `work`, `calls` or `split`). Not
  from a read run or a guest's run, and not on a project's own thread (as a split).
- **The list:** "Open and start `<title>` first; this task waits for it: <brief>". Your Yes
  approves those words as its description, which its run follows as yours (as a split's part).
- **On your Yes:** the box opens it as a sub-task with the labels `sub-task` and `first` (of this
  task, or of this task's parent when this task is a part: one level), marks this task as blocked
  by it (GitHub's link), and starts it at once, as `go #n` does. The reply: "Opened #N and started
  it. When it merges, I'll say so here, and `continue` carries on."
- **When it merges:** its close run (ADR 0066's, no agent) tells each task it blocks that has run:
  "#N merged, so this task can go on: say `continue`." Nothing starts by itself. **Closed without
  a merge:** "#N was closed without a merge, and this task still needs its fix."
- **It never changes this task's own PR:** a `first` part doesn't turn this task's PR into
  `part-of`. A parent whose own open PR closes it (`closes`) doesn't close when its parts do: that
  PR's merge closes it, as on a task without parts. A split's parent is as before (its PR is
  `part-of`, and it closes with its parts).

## 7. Security: what changes, and what you accept

- **What a chat Yes can do now:** put workflow lines, exactly as listed, on a task's branch. It
  can't put them on `main`, `production` or any default branch: only your merge on GitHub does.
- **Why that is safe:** by 5.4, nothing on the branch runs the lines before your merge. So whoever
  holds your chat (Telegram, your Access sign-in, your Cloudflare account) can place lines on a
  branch, and can't run them. The merge stays the approval, with your GitHub sign-in and its
  two-factor (ADR 0049's "one flow, one rule").
- **Why a Yes at all:** the lines show alone, with the secrets and actions they name, before they
  sit in a PR among other changes. A run that read from outside says so on the list.
- **The walls that stay:** the box, not the agent, finds the change, makes the patch and the facts,
  and pushes. The patch's SHA-256 is checked against the list. The push goes only to the task's
  branch, once. The rule and the key scan run again on the Yes. A guest's `yes` stays words, and a
  guest's run pushes nothing. The repos App still has no workflows write.
- **`first`:** your Yes approves a task's words as your own, as a split's does (ADR 0066), and
  starts its run. It opens one issue on shipify. No key.
- **No new key, permission or secret.** The write token's workflows write is minted as today
  (whenever the run's commits touch a workflow file) and, after your Yes, for the push of the
  approved lines.

## 8. Edge cases

| Case | What happens |
|---|---|
| You merge the PR before your Yes | The Yes is refused: "PR #x merged without the workflow change. Say `continue`, and a run makes it again in a new PR." |
| The branch changed after the list (another run) | The patch still applies when its lines are untouched. Else ✗: "The branch changed since the list. Say `continue`, and the run makes it again." |
| The run merged `main`, and `main` had changed the same workflow file | The patch shows `main`'s lines too, and the reply says so: "Approve it before you merge: until then the PR takes `main`'s newer lines out of that file." |
| Two workflow files, or a workflow change and calls | One list, one code, one Yes for all |
| A Yes after a day, or a Yes under an older list | Refused, as any list |
| The agent didn't commit the workflow change, only edited it | `ship pr --check` counts edits not committed, as today. The box's bundle has only commits: an edit not committed isn't pushed or listed |
| A run that asks a question, with a held change | The list waits beside the question. A list shows only Yes and No, so the question's answers aren't buttons, as with calls today |
| A failed run, with a held change | Its work is kept on the branch with the hold (ADR 0041), and the change isn't listed: the next run makes it again |
| The agent changes a file you approved earlier | That is a new change: held, and listed again |
| A later run leaves an approved file as it is | It goes through: it's on the branch on GitHub (your two edits on `main`) |
| A key in the workflow change | Not listed: the reply says which file, as today's push does |
| Your Yes while the run stays (ADR 0057) | As a Yes to calls then: it needs a key, so the stay ends and its job's steps mint and apply it (ADR 0062) |
| `first` from a part | The new task is a sibling under the same parent, and the part is blocked by it |
| `first` when this task has no PR | The same: this task waits, and `continue` goes on from its branch |
| Your words on this task while `first` runs | As on any task: they start a run here. The reply says that #N still runs and this task still waits for it |
| A second `first` while one is open | Listed as usual. Each one tells this task when it merges |

## 9. Build plan (one PR, after your `go`)

The PR changes no workflow file, so it needs no hand edit. Test-first:

1. **One helper** (`cli/kernel/workflows.ts`): the run's workflow change (5.2), the rule (5.4), the
   facts (5.3). Unit tests on Shipify's own four workflows (all pass) and on cases that fail
   (`pull_request`, `on: push` with no branches, a branch pattern, `tags`, an action change in a
   repo with PR checks, a file that isn't YAML).
2. **`ship pr --check`** (`cli/commands/workspace.ts`): the helper; a change that passes 5.4 goes
   through, one that doesn't is refused with why; `.github/actions/` included.
3. **Decide** (`cli/kernel/decide.ts`, `cli/kernel/keys.ts`, `cli/lib/task.ts`): the held change
   read from the bundle, the list line and its facts, the code, `dropList`, the Yes, the status
   help line; `first` (`cli/kernel/result.ts`, `cli/kernel/prompt.ts`), listed and opened.
4. **Apply** (`cli/kernel/apply.ts`): the hold commit before today's check; the approved push
   (5.5), with its journal entry; `needsOf` asks for the repo and workflows write.
5. **Parts** (`cli/kernel/parts.ts`): `first` opened, linked and started; its merge and its close
   told; a parent with its own open PR doesn't close with its parts.
6. **End to end** (`tests/kernel-flow.test.ts`): a run changes `task.yml` and a CLI file; the push
   carries the CLI file and the hold; the list shows the lines and facts; `yes <code>` pushes them,
   and a later run that leaves them goes through; `no` drops them; a guest's `yes` is words; a
   project's `ship.yml` change is held and not listed; another account's is held and not listed.
   `first`: listed, opened and started on Yes, its merge tells this task, the parent stays open.
7. **Docs** (below), and the build's own check: `ship pr --check` and the box's full checks.

## Setup

Nothing to set up. The bot App has workflows write already, and no setting, key or workflow
changes.

## Docs and clean-up

- `playbooks/task.md`: rule 1 (Rules), the Never line, the Upgrade and own-rules lines, `first` in
  "Do the work" and in Finish's fields.
- `skills/own-rules-repo/SKILL.md`: "leave its workflow files alone" becomes "change one only when
  the owner asks; the box holds it for their Yes when it runs only after the merge".
- `docs/security.md`: the write token's row (workflows write, as the code does it); "Workflow
  files" in "Apply never runs the agent's code"; "Approvals" (a list may hold a workflow change
  and a task first; what you accept); "Every project's pipeline" (unchanged rule, said once).
- `docs/tasks.md`: apply's step 3 (the hold), the list's kinds, `first` beside splits.
- `docs/tour.md`, `docs/design.md`, `docs/configuration.md`, `docs/setup.md` (the repos App's
  line): "only as the stack renders" gains "or as you approved".
- `docs/glossary.md`: "a task first", "held" (a workflow change).
- ADR 0031, 0044, 0049 and 0066: amended by this one (their rows in `docs/adr/README.md`).
- `cli/commands/workspace.ts`'s refusal: the pointer to a playbook section that doesn't say how
  goes.
- `CHANGELOG.md`.

## Consequences

- **Easier:** a task that needs a workflow change goes from the chat: one Yes, then your merge. The
  run's other work is never lost to a refused workflow file. A block in the box's own code is one
  Yes and one `continue`, with no words to copy.
- **Harder:** one more kind on the list, a hold commit in some PRs' history, and a rule about
  workflow events to keep current when GitHub adds events (an unknown event fails safe: not
  listed).

## Confirmation

- The helper's unit tests: Shipify's four workflows pass the rule, and each failing case fails.
- `tests/kernel-flow.test.ts`: the hold, the list, the Yes, the No, a guest, a project's pipeline,
  another account, and `first` end to end.
- `tests/workflows.test.ts`: `task.yml` is unchanged in what each step mints.
- On this box after the merge: the next task that needs a workflow change shows the list, and a
  Yes puts the lines on its PR's branch.

## Decisions for you

None open. Merging this accepts sections 4 to 7. These are the choices made, so you can comment
before you merge:
- **A Yes for every workflow change,** even one that runs only after your merge (option B is
  without it).
- **`first` starts on your Yes,** and this task goes on only on your `continue`.
- **A change that would run before your merge** (a repo's PR checks) is never listed: it stays
  yours, on GitHub.

## As built (2026-11-06)

One PR, as section 9 says, with no workflow file changed.

- **Where:** `cli/kernel/workflows.ts` (the one helper: the run's workflow change, the rule of
  5.4, the facts, the hold); `ship pr --check` (`workflowRule` in `cli/commands/workspace.ts`, for
  Shipify and projects alike); decide's read of the held change (`withHeld` in `cli/kernel/run.ts`,
  `heldChange` in `apply.ts`), its list lines and code (`decide.ts`, `keys.ts`); apply's hold in
  `pushed()` and the approved push (`pushApproved`, a `workflow` write); `first` (the result's
  field, `parts.ts`'s `firstPart` and close, a `first` write, the record's `NewPart.blocks` link).
- **Another account:** GitHub refuses a push whose commits change a workflow file without
  workflows write, even when a later commit puts it back, and the repos App has none. So a hold
  can't help there: as before, the push is refused whole, and the reply says to take the change
  out, or make it there. The playbook and `own-rules-repo` say a run makes none there. Section
  5.6's row for another account is this.
- **A key in the workflow change:** apply scans the run's whole change, its workflow lines too,
  before the hold, so a key refuses the push as before (section 8's row), not only the listing.
- **The list's line** names the branch, and the PR when one is open: "Change
  `.github/workflows/x.yml` on `task/12-…` (PR #3) (+1 −0). It runs only from `main`, after your
  merge: on a start."
- **After the Yes,** the task waits as `needs you` while its PR does. A Yes the box refuses
  (section 8: the PR merged, the branch changed) replies "✗ The workflow change you approved
  wasn't pushed: …", with what to say next.
- **A rename** of a workflow file is held as both its files: the old one put back, the new one
  removed.
- **On Shipify and a project,** `ship pr --check` refuses a change that would run before the merge
  in the agent's own session, so such a change rarely reaches the hold. It's held and said for a
  question's kept work and in a repo that keeps its own rules.
- **`first`:** a run that proposes one keeps its commits on the task's branch, whatever its state.
  Its close says "merged" only when a merge closed it ("was closed as done" when closed so by
  hand).

## Sources

- GitHub, "Events that trigger workflows" (which events run from the default branch, and which
  commit's workflow each runs):
  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Task #692's thread, 2026-11-06: the replies of 10:40 to 14:14 and your messages.
