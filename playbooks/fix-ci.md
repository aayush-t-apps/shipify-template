# Playbook: fix a failing CI run

From a terminal: it pushes a branch and opens a PR. In a task, follow
[task.md](task.md)'s "Checks failed" instead: you fix and commit, and the box pushes.

1. `gh run list -R <owner>/<repo> -L 5` and `gh run view <id> -R <owner>/<repo> --log-failed`.
2. Reproduce locally: `make setup && make verify`. A merge run checks without a browser; for
   exactly that, `SHIPIFY_NO_BROWSER=1 make setup && SHIPIFY_NO_BROWSER=1 make verify`.
3. Fix on a branch `fix/<short-name>`, run `make verify` until it passes, commit, push the branch
   and open a PR (`pnpm ship pr <p> --yes`). Add `--preview` if a live link helps.
4. Never re-run a production deploy by pushing to `production`. Merge the release PR instead.
5. If production is broken right now: `pnpm ship rollback <id> --yes` (or GitHub → Actions → ship → Run workflow), then fix forward.
