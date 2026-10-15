# Playbook: work on several things at once

Parallel work is safe when **each piece of work has its own checkout**. Commands below run from
`shipify/`.

## Several projects at once

One agent per project folder (`../projects/<id>`). Projects are separate repos, so nothing
collides. `ship` only writes `registry/projects.json` in shipify (atomically; `pnpm ship reconcile`
rebuilds it), and `plan submit` never switches shipify's branch.

## Several features in one project

1. **One worktree per feature**, outside `projects/`:

   ```sh
   git -C ../projects/<id> fetch origin
   git -C ../projects/<id> worktree add ../../.worktrees/<id>/<slug> -b change/<slug> origin/main
   make -C ../.worktrees/<id>/<slug> setup     # each checkout installs its own dependencies
   ```

2. **Pass the worktree's path wherever a command takes a project:**
   `pnpm ship change new ../.worktrees/<id>/<slug> <slug>`, `pnpm ship change check <path> <n>`,
   `pnpm ship version <path> <bump>`. With the id instead, `ship` acts on the main checkout.
3. **Change docs:** `change submit` commits the doc (and any ADR it links) through a temporary
   worktree from `origin/main`, so your checkout stays on its branch; the doc moves to its PR. After
   the owner merges it, `git rebase origin/main` in the worktree brings it back, and you implement.
   Numbers are claimed when a doc merges: if main took yours, `pnpm ship refresh <path>` renumbers
   it.
4. **Verify in parallel:** each checkout's `make verify` serves its tests on its own port, so runs
   never test each other. Two `make dev` servers need different ports.
5. **Versions and PRs:** each feature is its own PR, `pnpm ship pr <path> --yes`.
   - **Apps with staging:** PRs don't bump the version; `ship release` bumps once for everything
     merged. This is the easy mode for many features in flight.
   - **Apps without staging:** every PR bumps the version (`pnpm ship version <path>`). When a
     sibling PR merges first, `pnpm ship refresh <path>` merges main into the branch and redoes
     the bump on top of main's version, renumbers a clashing change doc and keeps both changelogs.
     It stops on real conflicts: fix those files, then run it again (after a plain `git commit`
     too: it redoes the bump once). On a box, a task's run does
     this itself when main has moved past its branch, so `continue` on the sibling is enough.
6. **Clean up** when the PR is merged: `git -C ../projects/<id> worktree remove ../../.worktrees/<id>/<slug>`.

## Tasks on boxes

Tasks (docs/tasks.md) do all of this by themselves: each run gets a fresh clone in its slot's
sandbox, on the task's own branch (`task/<n>-…`), with `main` merged in first (a conflict is noted
for the agent). Each box runs one task per slot at once; more slots or more boxes run more.

## One agent running helpers in parallel

Any agent's helpers (its own subagents) follow the same rule: each piece of work has its own
checkout. Give each helper one feature and its own worktree, with the rules above; helpers never
merge, and the owner merges each PR. If two features touch the same files, run them one after the
other instead.

In a task's run on a box, the run is one task's work, so it ends in that task's PR: a helper's work
counts once it's merged into the run's `work` branch. A checkout inside the clone, whoever made it
and whatever its name, is never committed: the box's "Work in progress" commit and `ship pr` leave
it out, and the PR's checks (`ship pr --check` on the box, `ship pr` here) refuse one recorded in
the commits, with the fix (ADR 0041).
