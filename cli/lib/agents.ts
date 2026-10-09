// Agents (ADR 0017, docs/agents.md): the program that thinks for a task, such as Claude Code, Codex
// or OpenCode. executors.json says how to start each one. The core asks every agent for the same
// things and reads back the same report:
//   in:  the prompt (on stdin, or as {promptText}), a model and an effort, and the run's tools
//   out: the result file (playbooks/task.md), and a report: the model used, tokens, tools, limits
// An adapter (agents/<name>.ts) turns that into one agent's own flags, and reads its output. An
// agent without an adapter still runs from its command (with its `flags` for a model and an
// effort), no tools, and a report of its time alone. Which models and efforts each agent takes is
// data in executors.json, so a new model or agent never needs code. The core names no agent.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "./agents/index.ts";
import { PLATFORM_ROOT } from "./config.ts";
import {
  type Adapter,
  type AgentReport,
  Commands,
  EXECUTORS_VERSION,
  type Executor,
  ExecutorEntry,
  type Executors,
  Gateway,
  RESERVED_DIRS,
  SHARED_KEYS,
  type Tokens,
} from "./plugins/agent.ts";
import { loadPluginFile } from "./plugins/tool.ts";
import {
  useLabel as labelOf,
  parseUse as readUse,
  type Use,
  useChoices,
  useCommand,
  useLine,
} from "../contracts/use.ts";

export type {
  Adapter,
  AgentReport,
  AgentRun,
  Commands,
  Executor,
  Executors,
  Gateway,
  OutputReader,
  Tokens,
} from "./plugins/agent.ts";
export { ADAPTERS };

/** executors.json: the agents, and what they share (the commands they must never run, the gateways). */
export interface Harness {
  executors: Executors;
  commands?: Commands;
  gateways: Record<string, Gateway>;
  /** A plain line for each part that isn't right; that part is left out. */
  problems: string[];
}

/** executors.json, entry by entry: the agents that are right, and a plain line for each that isn't. */
export function readExecutors(
  file = process.env.SHIPIFY_EXECUTORS_FILE ?? join(PLATFORM_ROOT, "executors.json"),
): Harness {
  const none = (problem: string): Harness => ({ executors: {}, gateways: {}, problems: [problem] });
  if (!existsSync(file)) return none("executors.json is missing");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return none(`executors.json: not JSON (${(e as Error).message})`);
  }
  const all = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const shared = all as Record<string, unknown>;
  const agents = Object.fromEntries(
    Object.entries(shared).filter(([k]) => k === "version" || !SHARED_KEYS.includes(k as never)),
  );
  // An agent's id is a lowercase word, as `use <id>` names it (and a run's step says it).
  const r = loadPluginFile("executors.json", agents, ExecutorEntry, EXECUTORS_VERSION, {
    rule: /^[a-z][a-z0-9_-]{0,40}$/,
    says: "a lowercase word: letters, digits, - and _",
  });
  const plain = (what: string, issues: { path: PropertyKey[]; message: string }[]) =>
    issues.map((i) => `executors.json: ${[what, ...i.path].join(".")}: ${i.message}`);
  let commands: Commands | undefined;
  if (shared.commands !== undefined) {
    const c = Commands.safeParse(shared.commands);
    if (c.success) commands = c.data;
    else r.problems.push(...plain("commands", c.error.issues));
    // ADR 0043: no allow list. One left over would read as if it still limited something.
    if ((shared.commands as { allow?: unknown } | null)?.allow !== undefined)
      r.problems.push(
        "executors.json: commands.allow: isn't read any more (ADR 0043): agents run any command but the refused ones (`deny`); remove it",
      );
  }
  const gateways: Record<string, Gateway> = {};
  for (const [id, g] of Object.entries((shared.gateways ?? {}) as Record<string, unknown>)) {
    const p = Gateway.safeParse(g);
    if (p.success) gateways[id] = p.data;
    else r.problems.push(...plain(`gateways.${id}`, p.error.issues));
  }
  // Each install in a folder of its own: two in one would remove each other's version.
  const dirs = new Map<string, string>();
  for (const [id, e] of Object.entries(r.entries)) {
    if (!e.install) continue;
    const dir = e.install.dir ?? id;
    if (RESERVED_DIRS.includes(dir) || dirs.has(dir)) {
      r.problems.push(
        `executors.json: ${id}: its install's folder "${dir}" is ${dirs.has(dir) ? `${dirs.get(dir)}'s too` : "one of the box's own"}`,
      );
      delete r.entries[id];
    } else dirs.set(dir, id);
  }
  for (const [id, e] of Object.entries(r.entries))
    if (e.adapter && !ADAPTERS[e.adapter]) {
      r.problems.push(`executors.json: ${id}: its adapter "${e.adapter}" doesn't exist`);
      delete r.entries[id];
    } else if (e.gateway && !gateways[e.gateway]) {
      r.problems.push(`executors.json: ${id}: its gateway "${e.gateway}" isn't in "gateways"`);
      delete r.entries[id];
    }
  return { executors: r.entries, commands, gateways, problems: r.problems };
}

/** The secret an agent logs in with, and how to make it: its own login, or its gateway's key. */
export function loginOf(
  entry: Executor | undefined,
  gateways: Record<string, Gateway> = readExecutors().gateways,
): { secret: string; how: string } | undefined {
  if (entry?.login) return entry.login;
  const g = entry?.gateway ? gateways[entry.gateway] : undefined;
  return g ? { secret: g.key, how: g.how } : undefined;
}

/** The agents that are right: a broken entry is left out (ship doctor and pnpm verify say why). */
export const loadExecutors = (file?: string): Executors => readExecutors(file).executors;

/**
 * The agent a task runs when nothing chooses one: the repo variable SHIPIFY_AGENT (the job's
 * SHIPIFY_EXECUTOR), else the entry executors.json marks `default`, else the first with an adapter.
 */
export function defaultAgent(all: Executors, chosen = process.env.SHIPIFY_EXECUTOR): string {
  if (chosen?.trim()) return chosen.trim().toLowerCase();
  const ids = Object.keys(all).filter((id) => !all[id]?.manual);
  return (
    ids.find((id) => all[id]?.default) ?? ids.find((id) => all[id]?.adapter) ?? ids[0] ?? "none"
  );
}

/**
 * An agent that takes tools, for a run that must use them through the guard (ADR 0015): this one
 * when it can, else the first that can.
 */
export function toolAgent(all: Executors, preferred: string): string {
  if (adapterOf(all[preferred])?.tools) return preferred;
  return Object.keys(all).find((id) => adapterOf(all[id])?.tools) ?? preferred;
}

/** How an agent names a tool's call (its adapter's say), or tool.call. */
export const callNameFor = (entry: Executor | undefined, tool: string, call: string) =>
  adapterOf(entry)?.callName?.(tool, call) ?? `${tool}.${call}`;

/** A model's name for people, as its agent's adapter says it ("Sonnet 5.5"); the id otherwise. */
export function modelLabel(id: string): string {
  for (const a of Object.values(ADAPTERS)) {
    const name = a.modelName?.(id);
    if (name) return name;
  }
  return id;
}

/** An executor's adapter, or none: it then runs as a plain program. */
export function adapterOf(entry: Executor | undefined): Adapter | undefined {
  if (!entry?.adapter) return undefined;
  const a = ADAPTERS[entry.adapter];
  if (!a) throw new Error(`executors.json names an adapter "${entry.adapter}" that doesn't exist`);
  return a;
}

/**
 * An agent without an adapter, with its `flags` from executors.json: the model and the effort as
 * that program takes them ({model}, {effort}), before its prompt ("-" for stdin, or
 * {promptText}), or at the end when it has neither.
 */
export function withFlags(command: string[], entry: Executor, model?: string, effort?: string) {
  const fill = (args: string[] | undefined, key: string, value: string | undefined) =>
    value && args ? args.map((a) => a.replaceAll(`{${key}}`, () => value)) : [];
  const flags = [
    ...fill(entry.flags?.model, "model", model),
    ...fill(entry.flags?.effort, "effort", effort),
  ];
  const at = command.findLastIndex((a) => a === "-" || a.includes("{promptText}"));
  return at < 1
    ? [...command, ...flags]
    : [...command.slice(0, at), ...flags, ...command.slice(at)];
}

/** A model and an effort for a run: from a `use` line, or the agent's `auto`. */
export interface Choice {
  /** As the agent takes them: "sonnet", "claude-opus-5-5", "medium". */
  model?: string;
  effort?: string;
  /** Which came from the agent's `auto`, because nothing chose them. */
  auto: { model: boolean; effort: boolean };
  /** What was asked for that this agent can't do, said in the run's details. */
  notes: string[];
}

const asked = (v: string | undefined) => {
  const x = v?.trim().toLowerCase();
  return x && x !== "auto" ? x : undefined;
};

/**
 * Whether this agent takes the model: one of its `models`, or an id its `modelPattern` matches.
 * An agent that lists neither takes no model by name ("use next.js" stays words).
 */
export function takesModel(entry: Executor | undefined, model: string): boolean {
  if (!entry) return false;
  if (entry.models?.includes(model)) return true;
  return entry.modelPattern ? new RegExp(entry.modelPattern, "i").test(model) : false;
}

export const takesEffort = (entry: Executor | undefined, effort: string) =>
  Boolean(entry?.efforts?.includes(effort));

/** An agent can be told its model and effort: by its adapter, or by `flags`. */
const tellable = (entry: Executor | undefined) => ({
  model: Boolean(adapterOf(entry) || entry?.flags?.model),
  effort: Boolean(adapterOf(entry) || entry?.flags?.effort),
});

/**
 * The model and effort for a run. A `use` line wins; without one, the agent's `auto` in
 * executors.json, and without that the agent's own default. All of it is executors.json's data:
 * adding a model or an agent is an edit there, never code. A choice the agent doesn't take falls
 * back the same way and says so.
 */
export function choose(
  agent: string,
  entry: Executor | undefined,
  want: { model?: string; effort?: string },
): Choice {
  const notes: string[] = [];
  let model = asked(want.model);
  let effort = asked(want.effort);
  const can = tellable(entry);
  if (model && !can.model) {
    notes.push(`${agent} takes no model setting (executors.json "flags"), so it ran its own.`);
    model = undefined;
  } else if (model && !takesModel(entry, model)) {
    notes.push(`${agent} has no model “${want.model}” in executors.json, so it ran Auto's.`);
    model = undefined;
  }
  if (effort && !can.effort) {
    notes.push(`${agent} takes no effort setting (executors.json "flags"), so it ran its own.`);
    effort = undefined;
  } else if (effort && !takesEffort(entry, effort)) {
    notes.push(`${agent} has no effort “${want.effort}” in executors.json, so it ran Auto's.`);
    effort = undefined;
  }
  const auto = { model: !model, effort: !effort };
  if (can.model) model ??= asked(entry?.auto?.model);
  if (can.effort) effort ??= asked(entry?.auto?.effort);
  if (model && effort && entry?.noEffort?.includes(model)) {
    if (!auto.effort) notes.push(`${title(model)} has no effort setting.`);
    effort = undefined;
  }
  return { model, effort, auto, notes };
}

/** A task's agent, model and effort (ADR 0025), kept in its record: the one grammar's
 * (contracts/use.ts), with each model's name for people as its agent's adapter says it. */
export type { Use };
export { useChoices, useCommand, useLine };

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Opus 5.5 · High", "Pi · glm-5.3", "Auto": the choice as the status comment shows it. */
export const useLabel = (u: Omit<Use, "label">, fallback: string) =>
  labelOf(u, fallback, modelLabel);

/** The choice that words name (contracts/use.ts), from the task's `current` one. */
export const parseUse = (
  text: string,
  all: Record<string, Executor>,
  current: Pick<Use, "agent" | "model" | "effort">,
  fallback: string,
): Use | undefined => readUse(text, all, current, fallback, modelLabel);

const sum = (a?: Tokens, b?: Tokens): Tokens | undefined =>
  a && b
    ? {
        input: a.input + b.input,
        cacheRead: a.cacheRead + b.cacheRead,
        cacheWrite: a.cacheWrite + b.cacheWrite,
        output: a.output + b.output,
        thinking: (a.thinking ?? 0) + (b.thinking ?? 0) || undefined,
      }
    : (a ?? b);

/**
 * Two runs' reports as one (an agent run and its retry). Counts add
 * up; the version, the model and the limits are the latest.
 */
export function mergeReports(a: AgentReport, b: AgentReport): AgentReport {
  const models = { ...a.models };
  for (const [id, t] of Object.entries(b.models ?? {})) models[id] = sum(models[id], t) as Tokens;
  const tools = { ...a.tools };
  for (const [name, c] of Object.entries(b.tools ?? {})) tools[name] = (tools[name] ?? 0) + c;
  const out: AgentReport = {
    version: b.version ?? a.version,
    model: b.model ?? a.model,
    models: Object.keys(models).length ? models : undefined,
    tokens: sum(a.tokens, b.tokens),
    turns:
      a.turns !== undefined || b.turns !== undefined ? (a.turns ?? 0) + (b.turns ?? 0) : undefined,
    tools: Object.keys(tools).length ? tools : undefined,
    denied: [...(a.denied ?? []), ...(b.denied ?? [])],
    readOutside: a.readOutside || b.readOutside || undefined,
    cost:
      a.cost || b.cost
        ? { usd: (a.cost?.usd ?? 0) + (b.cost?.usd ?? 0), plan: (b.cost ?? a.cost)?.plan ?? true }
        : undefined,
    limits: b.limits ?? a.limits,
    error: b.error,
    // A note each ask says again (a tool its agent didn't get) is said once.
    notes: [...new Set([...(a.notes ?? []), ...(b.notes ?? [])])],
    session: b.session ?? a.session,
  };
  if (!out.denied?.length) out.denied = undefined;
  if (!out.notes?.length) out.notes = undefined;
  return out;
}
