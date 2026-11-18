// An example agent's adapter (copy to cli/lib/agents/<name>.ts, ADR 0017): its flags for a model,
// an effort and a resume, and a reader for its output. List it in cli/lib/agents/index.ts.
import {
  type Adapter,
  type AgentReport,
  type CommandSeen,
  LOGIN_FD,
  type OutputReader,
} from "../plugins/agent.ts";

function reader(): OutputReader {
  const report: AgentReport = {};
  // Each command it ran or was refused, as written (AgentReport.commands): the box's check of a new
  // version reads them, against the one list every agent is held to (DECISIONS, ADR 0079).
  const commands: CommandSeen[] = [];
  return {
    line(text) {
      // One line of the agent's output: what the live log shows for it, and what it adds to the
      // report. A line it can't read is shown as it is, never thrown on.
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return text;
      }
      if (e.type === "start") {
        report.version = e.version as string | undefined;
        report.model = e.model as string | undefined;
        // What it was offered, when its output says it (AgentReport.offered).
        if (Array.isArray(e.tools)) report.offered = { tools: e.tools.map(String) };
      }
      if (e.type === "command" && typeof e.command === "string")
        commands.push({ command: e.command, refused: e.refused === true });
      // It read a web page, or ran a command that fetched one: notes and calls then wait for
      // your `yes` (AgentReport.readOutside).
      if (e.type === "fetch") report.readOutside = true;
      // This ask's own counts. An agent that reports its session's from the start (Claude Code on a
      // resumed session) sets AgentReport.sessionTotals, and the core counts only what's new.
      if (e.type === "usage")
        report.tokens = {
          input: Number(e.input ?? 0),
          cacheRead: 0,
          cacheWrite: 0,
          output: Number(e.output ?? 0),
        };
      return typeof e.text === "string" ? e.text : undefined;
    },
    report: () => ({ ...report, ...(commands.length ? { commands } : {}) }),
  };
}

export const example: Adapter = {
  name: "Example Agent",
  tools: false,
  // Its settings and sessions in the run's own folder, nothing in the background.
  env: (p) => ({ EXAMPLE_HOME: p.config }),
  // Where it reads its login: fd 3 (LOGIN_FD), a pipe, never its environment. Its own setting for
  // that, or, for an agent without one, a loader that reads it there (pi's gate does).
  loginFromPipe: () => ({ EXAMPLE_LOGIN_FD: String(LOGIN_FD) }),
  // A folder it would write in when it can, made again, empty and read-only, before every ask
  // (OpenCode's own config, where it installs a package from npm on every start). Most need none.
  // readOnly: (p) => [join(p.config, "example")],
  // What it reads its rules or code from that a command could write, besides its settings folder
  // (`tools`, emptied anyway): removed before every ask (Claude Code's settings.json).
  // cleared: (p) => [join(p.home, ".example")],
  argv(run) {
    const out = [...run.command, "--json"];
    // Shipify's skills (a folder of SKILL.md folders), for it to list and load when one fits. An
    // agent that reads skills only from its own settings says where instead (`skillsLink`).
    if (run.skills) out.push("--skills", run.skills);
    // The commands every agent must never run (executors.json's `commands`, ADR 0043), as this
    // agent's own rules, for every part of a command and after git's own options (`git -C x push`).
    // An agent with no rules of its own loads pi's gate instead (cli/lib/agents/pi-gate.mjs).
    // tests/plugins/agent.test.ts's "one setup" test holds it to the same as every adapter.
    if (run.commands) out.push("--deny", run.commands.deny.join(","));
    // The read profile (ADR 0044): reading tools only, inside its folders, nothing run or written,
    // and no repo's instructions.
    if (run.commands?.run === false) out.push("--read-only", ...(run.folders?.read ?? []));
    // The repo it works in (a work run's clone), whose AGENTS.md it follows: only for an agent that
    // doesn't read its working folder's by itself.
    else if (run.work) out.push("--instructions", `${run.work}/AGENTS.md`);
    if (run.model) out.push("--model", run.model);
    if (run.effort) out.push("--effort", run.effort);
    if (run.resume) out.push("--resume", run.resume);
    return out;
  },
  reader,
};
