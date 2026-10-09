# Playbook: build an approved plan

You're in the project's own directory. The approved plan is below this playbook. Build exactly
that. Scope changes go back into a new plan revision.

1. Read `AGENTS.md`: it names this stack's layout, commands and rules. Then `DESIGN.md` if the
   project has a UI.
2. **Default stacks:** the project already passes `make verify` with placeholder content. **UI
   apps:** fill in `DESIGN.md` first (subject, screens, tone, palette, type, the one memorable
   element, states) and set the design tokens it points to. Avoid the generic defaults it lists.
3. **Custom stacks (`custom-app`, `custom-package`):** implement the `make` targets first, as the
   plan's `## Hosting` section says: `setup`, `check`, `test`, `build`, `verify`, and for apps
   `deploy` (plus any optional ones the plan needs). Add `.github/actions/setup/action.yml` if CI
   needs tools a stock runner lacks. Fill in `shipify.json` `urls` and `health`, and the
   `secrets` names. `make verify` must pass before step 4.
4. Work through the plan's tasks in order. For each task:
   - write the test for its criterion first (unit tests, or end-to-end tests for behaviour);
   - implement until it passes, with logic where it can be unit tested;
   - run `make verify` and tick the task off.
5. Replace preset placeholder code that the plan doesn't need.
6. Keep the health endpoint, the logger, the workflows, the stack-owned files (`AGENTS.md` lists
   them) and the ids in `shipify.json` as they are. Pin new dependencies to exact versions.
7. Never commit secrets, never push, and never touch `production`.
8. Finish when `make verify` passes. Then report each task with the criteria it proves.
