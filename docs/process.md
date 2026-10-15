# How it works

**You decide, the agent does.** Every approval is a **merge** on GitHub. Ask from the bot or an
issue on shipify; a box runs it ([tasks.md](tasks.md)).

## A new project (once)

1. **Ask:** `new: a POC for X`. Say public or private, and whether an app needs staging (default:
   no).
2. **Plan PR:** the agent writes `plans/<id>.plan.md` ([template](../guides/plan-template.md)):
   the stack, repo, URLs, staging, secrets, cost, architecture and stories. → **You merge it.**
3. **Prepare:** GitHub's machines make the repo, its settings and keys (no agent).
4. **Build:** the agent implements the plan until `make verify` passes, and apply pushes the first
   commit. The first pipeline run ships **v1.0.0**: an app goes live (or to staging) and you hear
   "**Live**"; a package gets a GitHub Release.

From a terminal: `ship plan submit`, `ship build <id>`, `ship publish`.

## Every change after that

Write `<app>: what you want`. Changes come in three lanes (ADR 0003):

| Lane | For | You get | You do |
|---|---|---|---|
| Tweak or fix | a margin, a wording, a bug | one PR | look, **merge** |
| Feature | new behaviour that's easy to undo | one PR with its change doc and the code | read, look, **merge** |
| Big | data, sign-in, a new service or host | a docs-only PR first (a change doc, an ADR) | **merge** it, then say `go` on GitHub; then merge the build PR |

The agent updates `docs/spec.md`, runs `ship version` (not for apps with staging) and `make verify`
in its own clone, and asks for the PR; apply pushes and opens it (from a terminal: `ship pr`).

| | App without staging, or a package | App with staging |
|---|---|---|
| You | look → **merge** | look → **merge**: CI deploys staging and runs e2e. Later, the Operate form's "Release to production" → **merge "Release vX.Y.Z"** |
| CI | checks once, deploys (apps), smoke-tests (rolls back on failure), tags `vX.Y.Z` | deploys exactly the commit that passed staging, smoke-tests, tags |
| You hear | "**Live:** <app> at <link>" on the task and in your chat, once the health check passed (or that it failed, with its run) | "On staging", with the link to release |

Comment `preview` on the task (GitHub only) for a preview link before you merge.

**Throwaway experiments** go to the playground: `playground: …` gives a PR with no versions. Merge to keep it, close to drop it.

## Platform improvements

Each project carries its own pipeline (ADR 0048). A new stack version, its pipeline included, comes
through `ship upgrade <id>` (or `<app>: upgrade`) as a normal change: the stack's owned files are
replaced, the project's own are never touched, and a migration note says what needs a hand.
