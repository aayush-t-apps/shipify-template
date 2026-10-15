# Architecture defaults

These are suggestions: the optimized setup to pick when the owner hasn't said otherwise. Anything
the owner asks for wins (ADR 0011). Plans only describe how they **differ** from these defaults, and
say why.

## Picking a stack

| The owner asks for | Stack |
|---|---|
| nothing specific, an app with a UI or an API | `ts-worker` (TypeScript, React + Hono, Cloudflare Workers) |
| nothing specific, a content site, or porting an existing one | `ts-static` (Cloudflare, `--source <dir>` to import) |
| nothing specific, a library | `ts-package` |
| a language, framework or host no stack covers | `custom-app` / `custom-package`: the plan's `## Hosting` section says how `make` builds and deploys it |

`pnpm ship stacks` lists them. A new stack is extracted from a `custom-*` project once a second
project wants the same setup.

## The defaults on the default stacks

| Question | Default | Choose otherwise when |
|---|---|---|
| Where logic runs | the browser; the Worker only for `/health` and `/api/*` | the app needs secrets, other origins, or shared data |
| Data | none, or browser `localStorage` | several devices or users must see the same data (then also staging) |
| Staging | off: PR → merge → production | the app has data worth protecting, or you want a release gate |
| Repo | private | it's fine to show the code (then CI is free) |
| Auth | none; public URL | client-confidential: an access layer in front (e.g. Cloudflare Access) |
| Secrets | none | an upstream API needs a key: list names in the plan's `secrets:` |
| Offline / installable | no | people use it on the move |
| Dependencies | none beyond the stack | a story needs one: pin an exact version **at least 2 days old** (pnpm refuses releases under 24 h), and prefer small libraries |
| Cost | free tier | the owner accepts a paid plan or host: the plan names it and what it costs |

Free-plan limits on Cloudflare: 100 Workers per account, 100k Worker requests/day, 10 ms CPU and 50
subrequests per request. Static asset requests are free and unlimited. Going past them is a plan
decision, not a blocker.

Record a decision as an ADR (template `guides/adr-template.md`) only when it's hard to reverse: a
project's in its `docs/adr/`, linked from the change doc that makes it; one that affects the
platform or several projects in `shipify/docs/adr/`. Every other choice is a line under the change
doc's "Alternatives considered".
