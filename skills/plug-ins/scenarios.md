# Scenarios: plug-ins

## Loads it
- "add Discord as a chat channel"
- "add Linear as a tool"
- "support a new agent, like Codex"
- "a stack for Python apps"

## Not this one
- "fix the typo in the web chat's send button"
- "change the watch's check to every 10 minutes"
- "add a recipe that sends me a daily brief"

## Cases

### 1. A provider's name in the core
- **Ask:** "add a new agent".
- **Without it:** not yet seen. The risk: an `if (agent === "x")` in the kernel, which
  `tests/core.test.ts` refuses only after the work is done.
- **Done well:** the change stays in its adapter and `executors.json`, through the agent contract,
  and the conformance test gains the agent's recorded run.

### 2. A key that can do too much
- **Ask:** "add a tool that reads and updates Linear issues".
- **Without it:** not yet seen. The risk: one write key used for reading too, so the agent's think
  step holds a key that can change things.
- **Done well:** a read-only key for `look`, a write key for `act` used only in the apply step,
  and `args` checks on each act call.

### 3. A test that needs the real service
- **Ask:** "add Telegram-like support for another chat".
- **Without it:** not yet seen. The risk: a conformance test that calls the provider, so CI fails
  offline.
- **Done well:** recorded answers or a stand-in in `tests/`, so the test runs offline.
