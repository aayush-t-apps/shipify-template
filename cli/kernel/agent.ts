// The agent a run thinks with (ADR 0017, ADR 0025, ADR 0031): which one and with what model, what
// the prompt says about tools, and the run's times and report for its details.

import { runUrl, whereThisRuns } from "../commands/task/context.ts";
import {
  type AgentReport,
  adapterOf,
  type Choice,
  callNameFor,
  choose,
  defaultAgent as defaultAgentOf,
  type Executor,
  loadExecutors,
  mergeReports,
  ownReport,
  readExecutors,
  type SessionUsed,
  type Use,
} from "../lib/agents.ts";
import type { RunDetails } from "../lib/runs.ts";
import type { TaskState } from "../lib/task.ts";
import { readTools, runTools } from "../lib/tools.ts";

/**
 * An agent's name in its run details: its adapter's ("pi"), and the gateway's when it's through
 * another than its first ("pi · Vercel"), so a run says where its model was served.
 */
function nameOf(id: string, ex: Executor | undefined): string {
  const own = adapterOf(ex)?.name ?? id;
  const via = ex?.extends && ex.gateway ? readExecutors().gateways[ex.gateway]?.name : undefined;
  return via ? `${own} · ${via}` : own;
}

/** executors.json's agents (plugins/agent.ts): a broken entry is left out, and doctor says why. */
export const executors = () => loadExecutors();

/** The agent a task runs when nothing says otherwise (agents.ts: SHIPIFY_AGENT, then the default). */
export const defaultAgent = () => defaultAgentOf(executors());

/** The agent, model and effort a task's runs think with (ADR 0025): its record's, else Auto. */
export const taskChoice = (state: TaskState): Pick<Use, "agent" | "model" | "effort"> =>
  state.use ?? { agent: defaultAgent() };

/**
 * The agent a task's runs think with: its pick's, else the default. One executors.json doesn't have
 * (SHIPIFY_AGENT mistyped) is the default's, and think says what's wrong, as it always has.
 */
export function taskAgent(state: TaskState): string {
  const all = executors();
  const named = taskChoice(state).agent ?? defaultAgent();
  return all[named] ? named : defaultAgentOf(all, "");
}

/**
 * The agent a run thinks with (ADR 0074): the task's, but never one whose login is a file its
 * commands can read (its entry's `login.file`) for a read run (ADR 0044) or a guest's (ADR 0071):
 * those go to the entry marked `default`. None when that one keeps its login in a file too.
 */
export function agentForRun(agent: string, profile: string, all = executors()): string | undefined {
  if ((profile !== "read" && profile !== "guest") || !all[agent]?.login?.file) return agent;
  const fallback = defaultAgentOf(all, "");
  return all[fallback]?.login?.file ? undefined : fallback;
}

/** The model and effort for this agent, from the task's `use` lines, or the agent's Auto. */
export const choiceFor = (executorId: string, use: { model?: string; effort?: string }): Choice =>
  choose(executorId, executors()[executorId], use);

/**
 * The prompt's Tools section (ADR 0031: the agent only looks): each tool the run's look server
 * serves (`served`, ADR 0077) and its look calls, and each one left out and why: its key not set,
 * or its server, or the look server, not started. None when tools.json lists none.
 */
export function promptTools(
  executorId: string,
  served: { tools: string[]; missing: { tool: string; why: string }[] } = {
    tools: [],
    missing: [],
  },
): string | undefined {
  const { tools: all, broken } = readTools();
  if (!Object.keys(all).length && !broken.length) return undefined;
  const entry = executors()[executorId];
  if (!adapterOf(entry)?.tools)
    return "This agent can't use Shipify's tools here: answer from what you can read, and say a tool would help.";
  const { missing } = runTools(all, "look");
  missing.push(
    ...served.missing,
    ...broken.map((tool) => ({ tool, why: "its tools.json entry is wrong: ship doctor says why" })),
  );
  const name = (tool: string, call: string) => callNameFor(entry, tool, call);
  const lines = [
    ...served.tools.flatMap((tool) => {
      const calls = all[tool]?.look ?? [];
      return calls.length
        ? [`- ${tool}: ${calls.map((c) => `\`${name(tool, c)}\``).join(", ")}`]
        : [];
    }),
    ...missing.map((m) => `- ${m.tool}: not connected on this run (${m.why})`),
  ];
  const acts = Object.entries(all).flatMap(([tool, t]) => t.act.map((c) => `${tool}.${c}`));
  return [
    "You may look with these (read-only calls):",
    ...lines,
    ...(acts.length
      ? [
          "",
          `To change something, propose \`calls\` in your result (${acts.join(", ")}), each with its exact arguments: the owner says yes, and the box makes them.`,
        ]
      : []),
  ].join("\n");
}

/**
 * The calls a guest's run may ask for (ADR 0073): each connected tool's guest forms, one line each,
 * as decide takes them. None when no connected tool has one.
 */
export function guestCalls(): string | undefined {
  const { tools } = readTools();
  const { ready } = runTools(tools, "look");
  const said = (v: unknown) => JSON.stringify(v);
  const lines = Object.entries(tools)
    .filter(([tool]) => tool in ready)
    .flatMap(([tool, t]) =>
      (t.guest ?? []).map((g) =>
        [
          `- \`${tool}.${g.call}\`:`,
          [
            ...Object.entries(g.fixed).map(([k, v]) => `\`${k}\` always ${said(v)}`),
            ...Object.entries(g.caps).map(([k, n]) => `\`${k}\` (${n} characters at most)`),
            ...g.any.map((k) => `\`${k}\``),
          ].join(", "),
          `and nothing else; ${g.max} a run at most.`,
        ].join(" "),
      ),
    );
  return lines.length ? lines.join("\n") : undefined;
}

/**
 * A run's times, as it goes: when the job and the task started, the agent's and CI's seconds. What
 * this process times is on the monotonic clock (`performance.now()`), which never steps: a wall
 * clock that an NTP fix or a VM moves back would make a run's seconds negative, and its reply's
 * line would then fail to post. The job's own start, from another process, is wall-clock, so
 * that part can only be counted as zero or more.
 */
export class Stopwatch {
  readonly at = new Date().toISOString();
  private readonly start = performance.now();
  private readonly startWall = Date.now();
  private readonly job = Number(process.env.SHIPIFY_JOB_STARTED) * 1000 || undefined;
  private firstAgent: number | undefined;
  agent = 0;
  ci = 0;
  report: AgentReport = {};
  executor: string | undefined;
  choice: Choice | undefined;
  /** `used`: what its session had counted before (a stay's turn, ADR 0057). */
  constructor(private used?: SessionUsed) {}
  /** What its session has counted so far, from an agent that counts from the session's start. */
  get sessionUsed() {
    return this.used;
  }
  /** An agent run finished: its time and report add up, each ask's own counts once. */
  ran(executorId: string, choice: Choice, o: { report: AgentReport; secs: number }) {
    this.firstAgent ??= performance.now() - o.secs * 1000;
    this.agent += o.secs;
    const own = ownReport(o.report, this.used);
    if (o.report.sessionTotals && o.report.models)
      this.used = { models: o.report.models, usd: o.report.cost?.usd };
    this.report = mergeReports(this.report, own);
    this.executor = executorId;
    this.choice = choice;
  }
  details(why: string, result: string, notes: string[] = []): RunDetails {
    // The box's setup before this process started, from the job's own (wall-clock) start.
    const box = this.job ? Math.max(0, (this.startWall - this.job) / 1000) : undefined;
    const ex = this.executor ? executors()[this.executor] : undefined;
    const r = this.report;
    const c = this.choice;
    const all = [
      ...(c?.notes ?? []),
      ...(r.notes ?? []),
      ...(r.error ? [`The agent said: ${r.error}.`] : []),
      ...notes,
    ];
    return {
      at: this.at,
      why,
      box: whereThisRuns(),
      run: runUrl(),
      agent: this.executor,
      name: this.executor ? nameOf(this.executor, ex) : undefined,
      version: r.version,
      model: r.model ?? c?.model,
      effort: c?.effort,
      auto: c ? { model: c.auto.model, effort: c.auto.effort } : undefined,
      secs: {
        box,
        ready: this.firstAgent ? Math.max(0, (this.firstAgent - this.start) / 1000) : undefined,
        agent: this.executor ? this.agent : undefined,
        ci: this.ci || undefined,
        total: (box ?? 0) + (performance.now() - this.start) / 1000,
      },
      tokens: r.tokens,
      models: r.models,
      turns: r.turns,
      tools: r.tools,
      skills: r.skills,
      denied: r.denied,
      cost: r.cost,
      limits: r.limits,
      notes: all.length ? all : undefined,
      result,
    };
  }
}
