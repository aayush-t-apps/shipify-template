# Playbook: plan a new project

Output: one plan PR. Nothing is built until the owner merges it. In a task, `pnpm ship` is the
`<ship>` the prompt names, and the box opens the PR ([task.md](task.md)).

1. Read `guides/architecture.md`. Use the owner's choices where they gave them, and the defaults
   for everything else. The plan states only what differs, and why.
2. `pnpm ship plan new <id> --stack <id> [--preset <id>] --visibility <public|private> --title "<Name>: <one line>" --summary "<one sentence>"`
   (`pnpm ship stacks` lists them; `custom-app` / `custom-package` when none fits)
3. Fill in `plans/<id>.plan.md`, about one page, deleting "(if …)" sections that don't apply:
   - stories: 1–4, P1 first, each testable on its own, each criterion written as
     `ACn.m WHEN … THE APP SHALL …`;
   - tasks: `- [ ] Tn [USn] outcome — files: … — verifies: ACn.m`, covering every criterion;
   - apps with screens: main screen, states, mobile and offline (`guides/design-brief.md`);
   - apps with an API: data, API, failure modes, limits;
   - custom stacks: `## Hosting` (language, tools, where it runs, how `make deploy` works, URLs,
     health, secrets, cost);
   - staging: `true` only if the app has data worth protecting; `secrets:` lists runtime secret
     names only;
   - anything you'd have to guess becomes `[NEEDS CLARIFICATION: question]`. Ask the owner: in a
     task, finish `needs-you` with the question ([task.md](task.md)).
   - No code, no restated conventions, no speculative phases.
4. `pnpm ship plan check <id>` must pass.
5. From a terminal: `pnpm ship plan submit <id> --yes`, give the owner the PR link, and stop. In a
   task: commit `plans/<id>.plan.md` and ask for its PR in the result file.
