# A new agent: the checklist

An agent is the program that thinks for a task. It only thinks: it reads, commits in its own clone,
and writes `result.json`; the box makes every change. Its contract:
[cli/lib/plugins/agent.ts](../../../cli/lib/plugins/agent.ts). The whole story:
[docs/agents.md](../../../docs/agents.md).

1. **An entry in `executors.json`** (`entry.json` here is the shape): its command for a run
   (`task`, the prompt on stdin), its models (`models`, `modelPattern`), its efforts, `auto`, its
   login (`login`: the secret, and how to make one; or `gateways`, ids from `executors.json`'s
   `gateways`, whose key is its login, and whose models and Auto it takes, each model's efforts read from its catalog), and its `install`:
   its command's words into `{prefix}` (`run`), its program there (`bin`) and its `version`, pinned
   (no upgrades on the side: a PR that says so).
2. **An adapter:** copy `adapter.ts` here to `cli/lib/agents/<name>.ts`, list it in
   `cli/lib/agents/index.ts`, and set the entry's `"adapter": "<name>"`. It turns the core's one ask
   (prompt, model, effort, look tools, folders) into the agent's flags, and reads its output into a
   report. It writes `executors.json`'s `commands` (what every agent must never run, ADR 0043) as
   its agent's own rules, as Claude Code's flags and pi's gate do (an agent with no rules of its own
   loads pi's gate); `tests/plugins/agent.test.ts` holds it to the same decisions as every agent
   (add how it decides a command to `DECIDES`). With `commands.run` false (the read profile, ADR
   0044) it starts the agent with reading tools only: no command, no web, no tool's calls, files
   read only in its working folder and `folders.read`, nothing written (add how it decides there to
   `READS`). Its `env` gets the run's
   folders, for its settings and sessions. Its `loginFromPipe` names the variables that tell its
   agent to read its login from fd 3, a pipe, so the login is never in its environment, where every
   command it runs could read it (add how it reads there to `PIPED`). It hands its agent Shipify's
   skills (`run.skills`, a folder): its flag for a folder of skills, or, when it reads them only
   from its own settings, `skillsLink`, where the run links them (add how to `SKILLS_HANDED`). A
   folder its agent would write in when it can (OpenCode installs a package from npm into its own
   config folder) goes in `readOnly`: the run makes it again, empty and read-only, before every ask.
   What its agent reads its rules or code from that a command could write, besides its settings
   folder (which the run empties anyway), goes in `cleared`: removed before every ask.
   The report says `readOutside` whenever the agent read
   the web, or ran a command that fetches: that's what makes its notes and calls wait for your
   `yes`. When the agent answers in words, not the result's shape, the report's `said` carries
   them, and a question takes them as its reply. A run on a box needs one.
3. **A recorded run** of the agent (its real output, with its version) in
   `tests/fixtures/<name>-stream.jsonl`, named in `RECORDED` in `tests/plugins/agent.test.ts`. It
   can be made against a stand-in model, as pi's and OpenCode's were. Then check it live the way a
   box runs it: the prompt on stdin, the login on fd 3 and its output read through a pipe (sending
   its output to a file can hide a break).
4. **Its install and login on a box** come from its entry: a box installs it the first time a run
   picks it, and the think step gets its login. Nothing in `task.yml` names it.
5. **Docs:** its row in `docs/agents.md`, and its login (or its gateway's key) in `docs/setup.md`.
6. **Check:** `pnpm verify`, then `pnpm ship selftest <name>` (or a task with `use <name>`).
