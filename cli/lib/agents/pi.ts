// pi's adapter (ADR 0038): a small agent core (`@earendil-works/pi-coding-agent`), run headless with
// `--mode json`: one JSON event a line, the prompt on stdin. Checked against pi 1.0.2
// (tests/fixtures/pi-stream.jsonl, a real run against a stand-in model). What it gets, all in the
// run's own folders:
// - its settings folder (PI_CODING_AGENT_DIR: the run's in/tools): the gateway as a provider of
//   its own (models.json), the look tools' MCP servers, local or remote (mcp.json), and Shipify's
//   gate (gate.mjs and its rules, gate.json), which holds it to the rules every agent gets: the
//   commands it must never run, the folders it may write, look calls only (ADR 0043);
// - its gateway's key on a pipe (LOGIN_FD), which the gate reads and hands to that provider: never
//   in pi's environment, which every command it runs inherits;
// - nothing of the project's own (`--no-approve`); pi's own tools and built-ins as they are, each
//   call held to Shipify's rules by the gate (Shipify keeps the rules; pi does the work its way);
// - its sessions in the run's own folder, so the catch-up and the fix round carry on in them, and
//   nothing in the background (PI_OFFLINE, no version check or telemetry).
// Its answer: the result file, or its final message in the result's shape.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Adapter,
  type AgentReport,
  type AgentRun,
  agentFile,
  command,
  fetchesOutside,
  type Gateway,
  LOGIN_FD,
  loadTools,
  type OutputReader,
  offered,
  runTools,
  secretFor,
  skillRead,
  skillsSeen,
  type Tokens,
} from "../plugins/agent.ts";

/** How pi speaks each of the gateways' protocols (its models.json `api`). */
const API: Record<Gateway["protocol"], string> = {
  "openai-chat": "openai-completions",
  "openai-responses": "openai-responses",
  "anthropic-messages": "anthropic-messages",
};

/** A tool's call as pi names it: tools.json's notion.search is mcp__notion__search. */
const callName = (tool: string, call: string) =>
  `mcp__${tool}__${call}`.replace(/[^A-Za-z0-9_]/g, "_");

/** The run's settings for pi, written where its adapter may (the run's tools folder). */
function settings(run: AgentRun): { provider?: string } {
  const dir = run.tools?.dir;
  const look: string[] = [];
  if (!dir) return {};
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (name: string, v: unknown) =>
    writeFileSync(join(dir, name), `${JSON.stringify(v, null, 2)}\n`);
  // The gateway as a provider of its own, so any of its models runs, listed or not. An Anthropic
  // address takes no /v1: pi adds the path. Its key comes from the gate, off the pipe.
  let provider: string | undefined;
  if (run.gateway && run.model) {
    provider = `shipify-${run.gateway.id}`;
    const anthropic = run.gateway.protocol === "anthropic-messages";
    write("models.json", {
      providers: {
        [provider]: {
          baseUrl: anthropic ? run.gateway.url.replace(/\/v1\/?$/, "") : run.gateway.url,
          api: API[run.gateway.protocol],
          // A reasoning model whenever an effort is said, so `off` goes out as effort "none" (left
          // out, it's the model's own default); `max` mapped, or pi sends high for it.
          models: [
            { id: run.model, reasoning: Boolean(run.effort), thinkingLevelMap: { max: "max" } },
          ],
        },
      },
    });
  }
  // The look tools' servers, local (`run`) or remote (`url`): look calls only (the act calls are
  // left out, and the gate refuses them), their keys named as ${VAR}, never their values.
  const mode = run.tools?.mode ?? "look";
  // The read profile has no tool's calls: it holds none of their keys (ADR 0044).
  const reading = run.commands?.run === false;
  const all = offered(loadTools(), run.tools?.only);
  const ready: Record<string, string[]> = reading ? {} : runTools(all, mode, process.env).ready;
  const servers: Record<string, unknown> = {};
  // Tools left out, and why: the gate names them at the end, never silently.
  const left: string[] = [];
  for (const [name, calls] of Object.entries(ready)) {
    const t = all[name];
    if (!t) continue;
    const vars = Object.fromEntries(
      Object.entries(t.keys).map(([v, k]) => [v, `\${${secretFor(k, mode)}}`]),
    );
    // pi runs a header value that starts with `!` as a command: never one of tools.json's.
    const bad = Object.entries(t.headers ?? {}).find(([, v]) => v.trimStart().startsWith("!"));
    if (t.url && bad) {
      left.push(`${name} (its ${bad[0]} header starts with !, which pi would run as a command)`);
      continue;
    }
    const where = t.url
      ? {
          url: t.url,
          headers: Object.fromEntries(
            Object.entries(t.headers ?? {}).map(([h, v]) => [
              h,
              v.replace(/\$\{(\w+)\}/g, (_, x: string) => vars[x] ?? `\${${x}}`),
            ]),
          ),
        }
      : { ...command(t.run as string[], run.tools?.root), env: vars };
    // Its look calls offered to the model as they are, every other call hidden.
    servers[name] = {
      ...where,
      exposure: "hidden",
      toolExposure: Object.fromEntries(calls.map((c) => [c, "direct"])),
    };
    look.push(...calls.map((c) => callName(name, c)));
  }
  // pi's built-in MCP reads this from its settings folder by itself; no codemode, so a call goes
  // to the model as itself and through the gate.
  if (Object.keys(servers).length)
    write("mcp.json", { autoEnableCodemode: false, mcpServers: servers });
  // The gate and its rules: the commands every agent must never run, the folders it may write,
  // the look calls, the tools left out, for it to name, and the provider it hands the key to.
  // The gate is found through the contract's `agentFile` (ADR 0051 B1), never next to this file: the
  // built CLI is one file in `cli/dist/`, not beside its own sources.
  writeFileSync(join(dir, "gate.mjs"), readFileSync(agentFile("pi-gate.mjs")));
  write("gate.json", {
    deny: run.commands?.deny ?? [],
    write: run.folders?.write ?? [],
    look,
    left,
    ...(provider ? { provider } : {}),
    // The read profile (ADR 0044): no command, and reads only inside these and its working folder.
    ...(reading ? { run: false, read: run.folders?.read ?? [] } : {}),
  });
  return provider ? { provider } : {};
}

/** The read profile's tools (ADR 0044): pi's own that read files, and no repo's AGENTS.md or
 * CLAUDE.md loaded as instructions (`--no-context-files`). Checked against pi 1.0.2's --help. */
export const READ_TOOLS = ["read", "grep", "find", "ls"];

function argv(run: AgentRun): string[] {
  const out = [...run.command, "--mode", "json", "--no-approve"];
  if (run.commands?.run === false) out.push("--tools", READ_TOOLS.join(","), "--no-context-files");
  const s = settings(run);
  if (run.tools?.dir) out.push("-e", join(run.tools.dir, "gate.mjs"));
  if (run.config) out.push("--session-dir", join(run.config, "pi-sessions"));
  if (s.provider) out.push("--provider", s.provider);
  if (run.model) out.push("--model", run.model);
  if (run.effort) out.push("--thinking", run.effort);
  if (run.resume) out.push("--session", run.resume);
  // Shipify's skills, listed for the model with their paths; it reads one when it fits. Never in
  // the read profile, which reads nothing of Shipify's.
  if (run.skills && run.commands?.run !== false) out.push("--skill", run.skills);
  return out;
}

/** A tool's name as Shipify says it: tools.json's calls as tool.call, pi's own as they are. */
const toolName = (name: string) => {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  return m ? `${m[1]}.${m[2]}` : name;
};

const oneLine = (v: unknown, max = 140) => {
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * A model's error in its own words: a gateway's JSON after its status ("503: {"message": …}") read
 * for its message, else the line as it is.
 */
function errorWords(raw: unknown): string {
  const json = /^\d{3}:\s*(\{[\s\S]*\})\s*$/.exec(String(raw))?.[1];
  try {
    const j = json
      ? (JSON.parse(json) as { message?: unknown; error?: { message?: unknown } })
      : {};
    const said = j.message ?? j.error?.message;
    if (typeof said === "string" && said.trim()) return oneLine(said, 200);
  } catch {}
  return oneLine(raw, 200);
}

/** What a tool call was about, in a few words, for the live log. */
function brief(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const pick = ["command", "path", "file_path", "query"]
    .map((k) => input[k])
    .find((v) => typeof v === "string" && v);
  return oneLine(pick ?? JSON.stringify(input));
}

/** Its final message as the result, when that's the result's JSON (in a fence or bare). */
function asResult(text: string): unknown {
  const body = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text)?.[1] ?? text.trim();
  if (!body.startsWith("{")) return undefined;
  try {
    const r = JSON.parse(body) as { v?: unknown };
    return r && r.v === 2 ? r : undefined;
  } catch {
    return undefined;
  }
}

type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  cost?: { total?: number };
};
type Msg = {
  role?: string;
  model?: string;
  provider?: string;
  usage?: Usage;
  content?: { type?: string; text?: string }[];
  stopReason?: string;
  errorMessage?: string;
};

function reader(): OutputReader {
  const report: AgentReport = {};
  const tools: Record<string, number> = {};
  // The skills it read: pi lists them with their paths, and its model reads one's SKILL.md.
  const skills: string[] = [];
  const models: Record<string, Tokens> = {};
  let usd = 0;
  let last = "";
  // The newest answer's error: a later answer (pi retries by itself) clears it.
  let failed: string | undefined;
  return {
    line(text) {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return text;
      }
      if (!e || typeof e !== "object") return text;
      if (e.type === "session") {
        report.session = e.id as string | undefined;
        return undefined;
      }
      // The tools pi didn't get, named by Shipify's gate at the end: those its adapter left out,
      // and the look calls whose server didn't connect.
      if (e.type === "entry_appended") {
        const x = (e.entry ?? {}) as { customType?: string; data?: Record<string, unknown> };
        if (x.customType !== "shipify-gate") return undefined;
        const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
        const missing = list(x.data?.missing).map(toolName);
        const said = [
          ...list(x.data?.left),
          ...(missing.length ? [`${missing.join(", ")} (not connected)`] : []),
        ];
        if (said.length)
          report.notes = [...(report.notes ?? []), `Tools pi didn't get: ${said.join("; ")}.`];
        return undefined;
      }
      if (e.type === "message_end") {
        const m = (e.message ?? {}) as Msg;
        if (m.role !== "assistant") return undefined;
        if (m.stopReason === "error" || m.errorMessage) {
          failed = errorWords(m.errorMessage ?? "the model answered with an error");
          return undefined;
        }
        failed = undefined;
        report.turns = (report.turns ?? 0) + 1;
        if (m.model) {
          report.model = m.model;
          const u = m.usage ?? {};
          const was = models[m.model] ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
          models[m.model] = {
            input: was.input + (u.input ?? 0),
            cacheRead: was.cacheRead + (u.cacheRead ?? 0),
            cacheWrite: was.cacheWrite + (u.cacheWrite ?? 0),
            output: was.output + (u.output ?? 0),
            thinking: (was.thinking ?? 0) + (u.reasoning ?? 0) || undefined,
          };
          usd += u.cost?.total ?? 0;
        }
        const said = (m.content ?? [])
          .filter((c) => c.type === "text" && c.text?.trim())
          .map((c) => (c.text as string).trim())
          .join("\n");
        if (said) last = said;
        return said || undefined;
      }
      if (e.type === "tool_execution_start") {
        const name = String(e.toolName ?? "?");
        const args = (e.args ?? {}) as Record<string, unknown>;
        tools[toolName(name)] = (tools[toolName(name)] ?? 0) + 1;
        if (name === "bash" && typeof args.command === "string" && fetchesOutside(args.command))
          report.readOutside = true;
        const skill = name === "read" && typeof args.path === "string" && skillRead(args.path);
        if (skill) skills.push(skill);
        return `  → ${toolName(name)}${Object.keys(args).length ? `: ${brief(args)}` : ""}`;
      }
      if (e.type === "tool_execution_end" && e.isError) {
        const r = (e.result ?? {}) as { content?: { text?: string }[] };
        const said = (r.content ?? []).map((c) => c.text ?? "").join(" ");
        if (said.startsWith("Refused by Shipify's rules"))
          report.denied = [
            ...(report.denied ?? []),
            `${toolName(String(e.toolName))}: ${oneLine(said, 160)}`,
          ];
        return `  ✗ ${oneLine(said, 200)}`;
      }
      if (e.type === "auto_retry_start")
        return `  · retrying the model (${oneLine(e.errorMessage ?? "an error", 120)})`;
      if (e.type === "auto_retry_end" && e.success === false)
        report.error = errorWords(e.finalError ?? "the model kept failing");
      if (e.type === "compaction_end" && !e.aborted)
        report.notes = [...(report.notes ?? []), "It compacted its context to carry on."];
      // An end pi retries after isn't the end.
      if (e.type === "agent_end") return e.willRetry ? undefined : "  · finished";
      return undefined;
    },
    report() {
      if (failed && !report.error) report.error = failed;
      if (Object.keys(tools).length) report.tools = tools;
      report.skills = skillsSeen(skills);
      if (Object.keys(models).length) {
        report.models = models;
        report.tokens = Object.values(models).reduce((a, b) => ({
          input: a.input + b.input,
          cacheRead: a.cacheRead + b.cacheRead,
          cacheWrite: a.cacheWrite + b.cacheWrite,
          output: a.output + b.output,
          thinking: (a.thinking ?? 0) + (b.thinking ?? 0) || undefined,
        }));
        // A gateway's model has no price in pi's own list: a cost only when the gateway gave one.
        if (usd > 0) report.cost = { usd, plan: false };
      }
      const result = asResult(last);
      if (result !== undefined) report.result = result;
      else if (last.trim()) report.said = last.trim();
      return report;
    },
  };
}

/** A gateway's model for people: its name without its maker ("laguna-s-2.1:free"). */
const modelName = (id: string) => /^[a-z0-9-]+\/([^/\s]+)$/.exec(id)?.[1];

export const pi: Adapter = {
  name: "pi",
  tools: true,
  callName,
  modelName,
  // Its settings folder is the run's tools folder; nothing in the background.
  env: (p) => ({
    PI_CODING_AGENT_DIR: p.tools,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  }),
  // Its gateway's key, whatever its name: the gate reads the pipe this names.
  loginFromPipe: () => ({ SHIPIFY_LOGIN_FD: String(LOGIN_FD) }),
  argv,
  reader,
};
