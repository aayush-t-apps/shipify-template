# Scenarios: test-driven-development

## Loads it
- "fix the bug where a box's slot never registers again"
- "add a --purge option to box remove"
- "make the release say which test failed"

## Not this one
- "why did main's CI fail?" (systematic-debugging)
- "is the PR ready to merge?" (verification-before-completion)
- "make the status page look better" (frontend-design)

## Cases

### 1. A test read the owner's own plan, so the release failed
- **Ask:** a fix that needed a test of what publishing a plan's project needs.
- **Without it:** the test called the code with the owner's plan (`plans/links.plan.md`). It
  passed on the PR and on `main`'s CI, where that plan is. A release takes the owner's plans out
  and checks the rest: the test failed there, twice, and nothing was published.
- **Done well:** the test writes its own plan in a temporary folder and passes that folder to the
  code, so it passes with or without the owner's files.

### 2. The suite ran twice on a small box
- **Ask:** a fix on shipify, in a task on homepi (a Pi 4).
- **Without it:** the agent ran the full `make verify` (17.5 minutes), then the box ran the same
  check before the PR (16 minutes): half an hour of checks for one PR, and the second found
  nothing new.
- **Done well:** the agent runs the test files its change touches, and the quick checks, then
  leaves `make verify` to the box, which runs it right after and gives a round to fix a failure.
