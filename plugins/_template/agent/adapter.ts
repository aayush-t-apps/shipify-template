// An example agent's adapter (copy to cli/lib/agents/<name>.ts, ADR 0017): its flags for a model,
// an effort and a resume, and a reader for its output. List it in cli/lib/agents/index.ts.
import type { Adapter, AgentReport, OutputReader } from "../plugins/agent.ts";

function reader(): OutputReader {
  const report: AgentReport = {};
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
      }
      // It read a web page, or ran a command that fetched one: notes and calls then wait for
      // your `yes` (AgentReport.readOutside).
      if (e.type === "fetch") report.readOutside = true;
      if (e.type === "usage")
        report.tokens = {
          input: Number(e.input ?? 0),
          cacheRead: 0,
          cacheWrite: 0,
          output: Number(e.output ?? 0),
        };
      return typeof e.text === "string" ? e.text : undefined;
    },
    report: () => report,
  };
}

export const example: Adapter = {
  name: "Example Agent",
  tools: false,
  // Its settings and sessions in the run's own folder, nothing in the background.
  env: (p) => ({ EXAMPLE_HOME: p.config }),
  argv(run) {
    const out = [...run.command, "--json"];
    // The commands every agent must never run (executors.json's `commands`, ADR 0043), as this
    // agent's own rules, for every part of a command and after git's own options (`git -C x push`).
    // An agent with no rules of its own loads pi's gate instead (cli/lib/agents/pi-gate.mjs).
    // tests/plugins/agent.test.ts's "one setup" test holds it to the same as every adapter.
    if (run.commands) out.push("--deny", run.commands.deny.join(","));
    // The read profile (ADR 0044): reading tools only, inside its folders, nothing run or written.
    if (run.commands?.run === false) out.push("--read-only", ...(run.folders?.read ?? []));
    if (run.model) out.push("--model", run.model);
    if (run.effort) out.push("--effort", run.effort);
    if (run.resume) out.push("--resume", run.resume);
    return out;
  },
  reader,
};
