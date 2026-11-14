---
status: accepted (merged #738; the owner's `go` on 2026-11-12) and built in one PR (task #737); see [As built](#as-built-2026-11-12)
date: 2026-11-12
amends: 0015 (the agent no longer holds the tools' look keys: it reaches their servers through the run's look server), 0031 (the runner starts a second user of its own, the look server's), 0049 (a look call counts by the look server's record too)
---

# 0077: The tools' look keys out of the agent's reach: a look server on the box, and no gateway or list of allowed hosts

## The plan in short

**Your asks (task #737, 2026-11-12):**
- "should we build a secure nat gateway type layer also to secure no leakages of tokens or
  something in path what do you suggest what we have is best ?"
- "is it worth safely cleanly doing properly", then "Yes, write the ADR".

**The answer:**
- **No NAT gateway.** Nothing comes in to a box: its runner only dials out, and ufw lets in
  Tailscale alone. Every connection is TLS or WireGuard, so no token is readable on the path. A
  gateway that could read tokens would have to break TLS, and then it would be the one place where
  every token is readable.
- **No list of allowed hosts.** GitHub, npm and DNS must stay open, and each can carry data out.
  The list would stop only naive leaks, break the runs that read the web, and need a change for
  each project, registry and site. The roadmap's item for it goes, with this reason.
- **The real gap is the keys the agent holds.** Today the agent's environment holds the tools'
  look keys: `SHIPIFY_NOTION_READ` (no expiry) and Drop's read token. Every command the agent runs
  can read them, and so can every package that a project's tests or build load. The npm worms of
  2025 (Shai-Hulud) did exactly that, unattended: they sent out each token they found.
- **The change: a look server, as a user of its own.** For each run that offers tools, the runner
  starts a small server as the user `shipify-look`. It holds the look keys and nothing else. It
  serves the tools' look calls on `127.0.0.1` only. The agent holds a random token for that run
  in place of the keys. Off the box, the token reaches nothing, because nothing comes in. When the
  run ends, the server ends and the token is dead.
- **The agent works as today.** All four agents already take a tool as a URL and a token, so
  `tools.json`, the tool contract, the act calls and the agents' behaviour stay the same.
- **Box setup 16** adds the user. Each box applies it by itself (setup 14): nothing for you to do.
- **What it won't stop, said plainly:** during a run, an agent that is tricked, or a bad package,
  can still use the token to read what the look calls read, and send that text out. That is the
  run's reads, for the run's time, and the box records them. It is not a key that keeps working.
- **The build is one PR,** after you merge this and say `go`. Merging accepts sections 3 to 6.

## 1. What was checked (main at 9f218b98, 2026-11-12)

| Assumption | How it was checked |
|---|---|
| The agent's environment holds the tools' look keys, so every command it runs can read them | `agentSecrets` in `cli/kernel/think.ts`. On homepi, as the agent (task #737's two runs, names only): `GH_TOKEN`, `SHIPIFY_NOTION_READ`, `SHIPIFY_DROP_READ_ID`, `SHIPIFY_DROP_READ_SECRET`, `SHIPIFY_DROP_URL` |
| Malware in npm packages takes tokens from the environment, with no one targeting you | CISA's alert of 2025-09-23 on Shai-Hulud: a worm in more than 500 packages ran TruffleHog to take npm, GitHub and cloud credentials from environment variables and CI secrets. A second wave followed in November 2025 (public reports) |
| `SHIPIFY_NOTION_READ` has no expiry | [security.md](../security.md) and ADR 0015 ("not stated by Notion"); [setup.md](../setup.md#tokens-and-secrets) lists "no date" |
| The agent can't read the environment or memory of another user's processes | On homepi, as the agent (this run): the `/proc/<pid>/environ` of the runner's `node` and `Runner.Worker` processes is refused (the output was discarded). Memory takes the same check and more (a process of another user, without `CAP_SYS_PTRACE`). Command lines are readable to all, so a token never goes on one. `ptrace_scope` is 1 |
| An agent reaches `127.0.0.1` on every port but SSH (22) and Cockpit (9090) | The agents' table in `box/setup.sh` (`agents_net`). In this run, the agent's request to a test server on `127.0.0.1` was answered |
| Claude Code takes a tool as an HTTP MCP server on `http://127.0.0.1`, with `Authorization: Bearer ${VAR}`, and takes JSON answers, `405` to a `GET` and `202` to a notification | Claude Code 2.1.284 on homepi (this run), with a 30-line test server: `claude mcp list` said "✔ Connected". The config kept `${LOOK_TEST_TOKEN}` as written, and each request carried the real token. A request with no token got `401` |
| Codex, pi and OpenCode take a remote tool with a bearer header | Their adapters write one today: `codex.ts` (`bearer_token_env_var`), `pi.ts` (`url`, `headers`), `opencode.ts` (`type: "remote"`). **Not run live here** (only Claude Code is on this box): the build's step 1 runs each against the look server first |
| An MCP server may answer a `POST` with one JSON body, and needs no session | The MCP specification, Streamable HTTP: a server answers a request with `application/json` or an event stream; `Mcp-Session-Id` is optional; a server may answer `GET` with `405` |
| The runner can start a process as another user only through its sudo rules, which box setup writes | `box/setup.sh`, "The sudo rules": `shipify ALL=(<the agents>) NOPASSWD: ALL`. A new user is a new setup version, which each box applies by itself (setup 14) |
| Shipify's tools' servers answer calls at once and keep no state between them | `tools/mcp.ts` (`serve`: each call its own promise; `initialize` answered with no state) |
| Every tool today is a local server (`run`), and none is remote (`url`) | `tools.json`: Notion and Drop name `run`; Telegram and the web chat are channels, with no calls |

## 2. Options

- **A: keep it as it is** (ADR 0015's D: read-only keys in the agent's environment). (+ nothing to
  build / − a key with no expiry is in reach of every command and package the run loads; a leak
  makes no noise and lasts until you replace the key.)
- **B: a NAT gateway, or a proxy that reads TLS, in front of the box.** (− nothing comes in now, and
  every connection is TLS or WireGuard, so a gateway sees no token; one that did would break TLS
  and hold every token in one place; a second machine to keep.)
- **C: a list of allowed hosts for the agents' users** (the roadmap's). (− GitHub, npm and DNS stay
  open, and each carries data out: an issue on someone's repo, a DNS name; it breaks web reads and
  needs a change for each project, registry and site, forever.)
- **D: keys off the box, through a look gateway on the edge** (ADR 0015's C), with a run token. (+
  no look key on a box / − a leaked run token works from anywhere until the run ends; a proxy and
  token checks on the Worker; each look call crosses the internet twice.)
- **E: a look server on the box, as the runner's user.** (+ no new user / − the tools' servers then
  take the agent's input as the runner, which holds its registration and every job's steps: a bug
  in one would step up past the agent's walls.)
- **F: a look server on the box, as a user of its own, on `127.0.0.1` with a run token.** (+ the
  agent holds no look key; a leaked token works only on this box and only during this run; the
  server's user holds the look keys and nothing else / − setup 16: one user and one sudo name.)
- **G: F on a Unix socket, the caller's user checked.** (− the four agents speak HTTP to a URL, not
  to a socket: each would need a shim that runs as the agent and reaches the socket all the same.)

## 3. Decision

Chosen **F**. It closes the one gap that matters (a key with no expiry in the agent's reach), with
no new machine, service or upkeep. E is simpler, but it would let a tool's bug reach the runner.
B and C are dropped for the reasons above, and the roadmap says so.

### 3.1 A run, on a box

1. **think starts the look server** before the agent's first ask, when the run offers tools (not a
   read run, a guest's run or a run on another account: they hold no tool today). It starts it as
   `shipify-look`, as it starts the agent (`sudo -n -u`), from an empty environment. The look keys
   of the run's ready tools and a new token (32 random bytes) go on its stdin, never on a command
   line.
2. **The server starts each tool's server** as `tools.json`'s `run` says, with that tool's keys,
   and initializes each once. A remote tool (`url`; none today) is served the same way: the server
   sends each call to its URL with its headers and keys, and reads a JSON or event-stream answer,
   so no tool's key reaches the agent either way. The server listens on `127.0.0.1`, on a port the
   system picks, and tells think the port.
3. **The agent's config names each tool as a remote one:** `http://127.0.0.1:<port>/<tool>`, with
   `Authorization: Bearer ${SHIPIFY_LOOK_TOKEN}`. The four adapters already write remote tools; the
   one function they share (`offered`, `cli/lib/plugins/agent.ts`) gives them the served tools, so
   each adapter changes one line, and its branch for a local tool goes.
4. **The agent holds `SHIPIFY_LOOK_TOKEN`** in place of the look keys (`agentSecrets`).
5. **The server is a gate too.** It answers `initialize` from what it read, `ping` itself, and
   `tools/list` with the run's look calls only. It sends a `tools/call` on only for a look call of
   the run's, and refuses the rest. It answers in JSON only: a `GET` gets `405`, a notification
   `202`, a request without the token `401`, a body over 1 MB `413`. A call that takes more than 2
   minutes gets an error answer.
6. **It records each call's tool.** think adds them to `looked`, so a look call that a command
   made, not the agent's own tool, still makes the run "read from outside": its notes wait for
   your `yes`, and a form's `after` rule counts it.
7. **It ends when think closes its stdin** (the run's end, after every ask), or when the runner
   dies, which closes its stdin too. Its tools' servers end with it.
8. **A stay's turn starts its own,** with a new token and port. The agent's settings are made
   fresh before each ask, so they name the new one.

### 3.2 What stays as it is

- `tools.json`, the tool contract and `ship tools check`.
- The act calls: the box makes them in the apply step, with the act keys, through the tools'
  servers on stdio (`cli/kernel/mcp-client.ts`).
- `GH_TOKEN`: read-only, an hour, and `git` and `gh` need it in the run.
- The agent's login, on a pipe it reads once.
- The agents' network: no private network (setup 9), the internet open.

### 3.3 Off a box

On the PC, the agent runs as you. The same server runs as a child of `ship`, as you, with no
sudo, so there is one path everywhere and no old one left.

## 4. Box setup 16: the look server's user

- **A system user `shipify-look`:** no home, no shell, no ID range, not in the runner's group, in
  `cron.deny` and `at.deny`, as the agents' users are.
- **The sudo rule names it:** `shipify ALL=(shipify-agent-1,…,shipify-look) NOPASSWD: ALL`. No
  agent gets a sudo rule.
- **The agents' network table names its ID too:** no private network, and not this machine's SSH
  or Cockpit.
- **One user for every slot.** Each slot's server holds the same look keys, so one server's user
  can learn nothing from another's.
- **A check at the end of setup:** the runner starts a command as `shipify-look`, or the check
  names the fix.

## 5. Edge cases

- **A box before setup 16** (until its due run, at least once a day, applies it while no other
  slot runs a job): the look user isn't there, so the server doesn't start. The run goes on without tools, and its prompt and details
  say why, as for a missing key. Never the old way: no look key goes back into the agent's
  environment.
- **The server doesn't give its port within 10 seconds, or ends early:** as above.
- **A tool's server doesn't start:** that tool is left out and named, as today ("notion: not
  connected on this run").
- **A tool's server ends mid-run:** its calls get an error answer, and the rest go on.
- **Two slots at once:** two servers, two ports, two tokens. A slot's agent holds only its own.
- **Another user on the box without the token** (another slot's agent, a guest's run, a
  container): `401`. The token is compared in constant time.
- **The token leaks off the box:** nothing comes in, so it reaches nothing. After the run, the
  server is gone.
- **An act call, or a call the run doesn't offer, sent straight to the server:** refused, never
  sent on. The server holds no act key.
- **The agent initializes again** (a resumed session, a helper of its own): answered from the
  server's own `initialize`, never sent on.
- **The runner is killed mid-run:** the server's stdin closes, and it ends with its tools' servers.
- **A future agent:** the agent contract says it takes a remote tool with a bearer header, and its
  conformance test checks that.

## 6. Build plan (one PR, after your `go`)

1. **Check Codex, pi and OpenCode live** against a look server, as this ADR checked Claude Code,
   and keep a recorded run of each for their adapter tests. If one can't, the build stops and says
   so before anything else changes.
2. **The look server** (`cli/kernel/look.ts`, started as `ship run look`): the gate, the bridge to
   each tool's server (local, or remote with a test server), the token, the record of calls, its
   end on stdin's close. Its tests cover each line of section 3.1's step 5 and section 5.
3. **think:** start it and end it, the token in `agentSecrets` in place of the look keys, the
   record into `looked`; `offered` gives the adapters the served tools.
4. **Box setup 16** (section 4), with its "Setup 16:" line.
5. **Docs** (below), then `make verify`.

## Setup

Nothing to set up. Each box applies setup 16 by itself (setup 14), at its next due run or weekly
clean-up, and your chat says what the box got. No secret changes: the look keys stay shipify
secrets, and only the think step gets them, as today. To check it: in a run, the agent's
environment shows `SHIPIFY_LOOK_TOKEN` and no `SHIPIFY_NOTION_READ`, and a Notion look call works.

## Docs and clean-up

- `docs/security.md`: the look keys' row in the key table (the look server's user holds them,
  never the agent), "The tokens a run gets", the network sentence in "read from outside", the
  box's walls (the look user), and "Left for later" (the list of allowed hosts goes, with this
  ADR's reason).
- `docs/tools.md`: "Look calls" (made through the run's look server) and the keys passage ("the
  agent holds only the look key" becomes the run token).
- `docs/box-setup.md`: "The agent's own user" (its keys), a short part on the look server's user,
  and setup 16.
- `docs/roadmap.md`: both items for the list of allowed hosts go (0.1's "Left for later", and
  "After the lab" item 2), the list renumbered.
- `docs/agents.md`, `docs/configuration.md`, `docs/design.md`, `docs/end-to-end.md`: what the
  agent holds (a run token, not the look keys).
- `docs/plug-ins.md`: the agent contract takes a remote tool with a bearer header; `look` calls go
  through the look server.
- `AGENTS.md`: the runner's sudo rules (its agents, the look server's user, the box's update).
- `docs/adr/README.md`: this ADR's row, and 0015's status ("amended by 0077").
- `box/setup.sh`: its "Setup 16:" line. `CHANGELOG.md`.
- **Removed:** the look keys in `agentSecrets`, and each adapter's branch for a local tool (every
  tool reaches the agent as a remote one; the box's own act calls keep stdio).

## Consequences

- **Easier:** the agent holds no key that works off the box or after its run, but the hour-long,
  read-only `GH_TOKEN`. A look call made any way is in the box's own record, not only in the
  agent's report.
- **The same:** the calls, `tools.json`, the agents' behaviour and the act path.
- **Harder:** one small Node process more for each run that offers tools (the tools' servers move
  to it, so their count stays). One more user and sudo name on each box. A box before setup 16
  has no tools until it applies it.
- **Not closed:** during a run, what its look calls can read can still be sent out by a tricked
  agent or a bad package. Only a strict list of allowed hosts would stop that, at the cost in
  option C.

## Confirmation

- A test holds `agentSecrets` to no look key, and the run token when the run offers tools.
- The look server's tests: the token refused and accepted, an act call refused, `initialize` sent
  on once, `413`, `405`, `202`, and its end when stdin closes.
- The agent conformance test: each adapter writes a served tool as remote, with the bearer header.
- Setup 16's check: the runner can start a command as `shipify-look`.
- On a box, in a run: `env` shows `SHIPIFY_LOOK_TOKEN` and no look key, and a Notion look call
  works.

## Decisions for you

None open. Merging accepts sections 3 to 6, and `go` starts the build.

## Sources

- CISA, "Widespread Supply Chain Compromise Impacting npm Ecosystem", 2025-09-23:
  <https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem>
- The MCP specification, transports (Streamable HTTP):
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- ADR 0015 (tools on the box: option C, keys off the box, kept for later), ADR 0031 (the agent's
  own user), box setup 9 and 14 ([box-setup.md](../box-setup.md)).

## As built (2026-11-12)

One PR, as section 6 says.

- **Step 1, the agents live** (homepi, against a test server on `127.0.0.1` with a bearer token
  in an environment variable): OpenCode 1.18.34 (`opencode mcp list`, its config as the adapter
  writes it) sent one request with no token first (`401`), then `initialize`, a notification
  (`202`), a `GET` (`405`) and `tools/list` with the token: connected. pi 1.0.2 (`pi mcp list`):
  connected, its tool listed. Codex 0.167.0 (installed in the run's own temp folder from
  `executors.json`'s pin, started with `bearer_token_env_var` and a stand-in model address):
  `initialize`, the notification and `tools/list`, each with the token. A call itself needs a
  model, so the look server's own tests cover `tools/call`: the same `POST`. No recorded run was
  added: each agent's output names a tool's call as before (`mcp__notion__search`), so its
  recorded run still covers its reader.
- **Where:** `cli/kernel/look.ts` (the server, `serveLook` and `gate`; the bridges to a local and
  a remote tool's server; `lookTools`, what think hands it; `startLook`), started as `ship run
  look`; `LOOK_USER`, `lookArgs` and `stopLook` in `cli/lib/sandbox.ts`, which keeps every sudo;
  `LOOK_TOKEN`, `Served` and `offered(all, served)` in the agent contract; `promptTools(executor,
  served)`; `agentSecrets(login, { github, look })`. Tests: `tests/look.test.ts`, the run's
  look server in `tests/kernel-gate.test.ts`, each adapter in the agent conformance test.
- **30 seconds for its port, not 10:** its own start and each tool's server's (20 seconds each, at
  once) take more than 10 off a box, where both start through tsx, on a busy Pi.
- **Its end:** its stdin closed, then 5 seconds; a server still there is stopped by its own
  process ID, as its user (`sudo -n -u shipify-look kill`), never `kill -1`, as one user serves
  every slot.
- **Gone with the local branch:** pi's guard for a header that starts with `!`, and its gate's
  `left` (the tools its adapter left out): every header is now `offered`'s. Codex's adapter takes
  a header's variable by its own name when the tool names no key for it, as the other three do.
- **Setup 16's check:** the walls (the runner's home and jobs' folder, a runner process's
  environment, a slot's runs) close the box to tasks when one is open, as an agent's do. A runner
  that can't start `shipify-look` gets a ✗ line, and the box takes tasks: its runs go without
  tools and say why, which opens nothing. `ship doctor`'s weekly check doesn't try the look
  user: a run that can't start it says so.
