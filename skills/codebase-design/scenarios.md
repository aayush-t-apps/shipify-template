# Scenarios: codebase-design

## Loads it
- "design the interface for the new store module"
- "is there a simpler, cleaner way to do this change?"
- "which approach should we take for long runs: A, B or C?"
- "where should this seam go so it's testable?"

## Not this one
- "fix the failing test in the stay"
- "rename this variable"
- "write the release notes"

## Cases

### 1. An option ruled out by a rule's wording
- **Ask:** "we want 200-minute sessions; how, simply and cleanly?"
- **Without it:** the run read "no record token in the think step" and ruled out the workflow's
  own token for reading `stop`, though the stay step already holds it the same way, behind the same
  wall (the agent is its own user). It offered two heavier options instead, one of which started
  runs nobody asked for, against a standing rule.
- **Done well:** it reads why the rule exists, finds the stay doing the same, offers the simple
  option with that reason, and checks every option against the owner's standing rules first.

### 2. A binding that cost the previews
- **Ask:** "which Cloudflare binding should this app use for shared state?"
- **Without it:** the run proposed a Durable Object. A Worker that implements one gets no version (preview) URLs, so the app lost its PR previews.
- **Done well:** check that the stack's deploy and preview flow supports the binding before you propose it.

### 3. A design that guessed about a service
- **Ask:** "how should the app keep its data on this service?"
- **Without it:** the run added a new store, said the feature needed no code without a trace of the real path, and put every service path in one change.
- **Done well:** use the service's own store first, trace the real path, read the service's code for the smallest correct step, and build one path now with the rest named "later".
