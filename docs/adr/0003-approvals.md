---
status: accepted
date: 2026-09-27
---

# 0003: Approvals are merges: plan, change doc, and one merge before production

Amended on 2026-09-29 by ADR 0012: changes come in lanes by size, and every change is a PR.

## Decision
- **New project:** a plan PR in shipify (`plans/<id>.plan.md`). Merging it approves the build, and
  for a task (ADR 0012) the publish too: the plan shows the repo, secrets, URLs and cost.
- **Changes, by size** (amended by ADR 0012):
  - **tweak or fix:** one PR with the code; no change doc;
  - **feature:** one PR with its change doc (`docs/changes/NNNN-*.md`) and the code, reviewed
    together with the preview;
  - **big** (hard to reverse: data, sign-in, a new service or host): a docs-only change doc PR
    first, with its ADR. Merging it approves the change; then the build PR.
- **Going live:** exactly one merge by the owner, right before production. Every change is a PR,
  for staging apps too (`ship pr`):
  - no staging: the change PR, with its version bump;
  - staging: merging the PR deploys staging; `ship release` bumps the version on `main`, opens
    "Release vX.Y.Z" once staging passed that commit, and the owner merges it.
- CI never opens PRs, so the org keeps Actions unable to create PRs. The agent never merges, and a
  bot's push never deploys production.

## Consequences
The GitHub app on a phone is enough to approve everything, and history is the audit log. Free
private repos have no branch protection; the pre-push hook and CI checks cover that.

## Confirmation
- The production job rejects anything but a release merge of a commit marked `shipify/staging`.
- PR CI rejects production-bound PRs without a version bump.
- The pipeline's "Only the owner's merges go live" step rejects a bot's push to production.
- `ship build` refuses unmerged plans.
