// OpenCode's adapter (ADR 0038): OpenCode (`opencode-ai`, MIT), run headless with `opencode run
// --format json`: one JSON event a line, the prompt on stdin. Checked against OpenCode 1.18.34
// (tests/fixtures/opencode-stream.jsonl, a real run against a stand-in model). What it gets, all in
// the run's own folders:
// - its config (OPENCODE_CONFIG: the run's in/tools/opencode.json) and nothing else's: no project's
//   opencode.json, .opencode or plugins, no Claude Code files, no repo's skills, no logins of its
//   own, nothing fetched in the background (models list, updates, LSP servers, default plugins,
//   sharing, its plugin package: its own config folder is read-only), and no git snapshot of its
//   folder; its own config folder, its cache and its home's .opencode, which a run could write,
//   made fresh before every ask, and the config it runs with checked by the gate;
// - the gateway as a provider of its own, so any of its models runs, with each effort as OpenRouter's
//   `reasoning`; its key read once from the pipe by Shipify's gate, which puts it on each call to
//   that provider: a command it runs gets no fd 3, and the key is in neither its config nor its
//   environment;
// - the look tools' MCP servers, local or remote, their act calls hidden;
// - Shipify's gate (gate.mjs, an OpenCode plugin, with pi's gate beside it and the run's rules,
//   gate.json), which checks every tool call before it runs, as pi's gate does, its helpers' too,
//   and says each in its output; its own permissions all allow, but the refused commands (one left
//   as "ask" ends a run with no one to answer);
// - Shipify's skills (`skills.paths`), its sessions in the run's own folder (XDG_DATA_HOME), so the
//   catch-up and the fix round carry on in them, and a title, so no model is asked for one.
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
  LOGIN_FD,
  loadTools,
  type OutputReader,
  offered,
  runTools,
  secretFor,
  type Tokens,
} from "../plugins/agent.ts";

/** A tool's call as OpenCode names it: tools.json's notion.search is notion_search. */
const callName = (tool: string, call: string) => `${tool}_${call}`.replace(/[^A-Za-z0-9_-]/g, "_");

/** The read profile's tools (ADR 0044): OpenCode's own that read files, every other one denied. */
export const READ_TOOLS = ["read", "list", "glob", "grep"];

/** The title every session gets: without one, OpenCode asks a model to name it. */
export const TITLE = "Shipify run";

/** The run's config for OpenCode, written where its adapter may (the run's tools folder). */
function settings(run: AgentRun): { provider?: string } {
  const dir = run.tools?.dir;
  if (!dir) return {};
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (name: string, v: unknown) =>
    writeFileSync(join(dir, name), `${JSON.stringify(v, null, 2)}\n`);
  const reading = run.commands?.run === false;
  // The gateway as a provider of its own, so any of its models runs, listed or not; with no key: the
  // gate puts it on each call. A provider of its own speaks OpenAI's chat (`openai-chat`,
  // OpenRouter's), the only protocol this adapter serves: a gateway that speaks another gets none,
  // and the run says the model isn't found.
  let provider: string | undefined;
  const providers: Record<string, unknown> = {};
  if (run.gateway?.protocol === "openai-chat" && run.model) {
    provider = `shipify-${run.gateway.id}`;
    const efforts = run.effort ? [run.effort] : [];
    providers[provider] = {
      name: run.gateway.id,
      options: { baseURL: run.gateway.url },
      models: {
        [run.model]: {
          name: run.model,
          tool_call: true,
          reasoning: Boolean(run.effort),
          // The effort as the gateway's own `reasoning` (`off` is "none"), picked with --variant.
          variants: Object.fromEntries(
            efforts.map((e) => [e, { reasoning: { effort: e === "off" ? "none" : e } }]),
          ),
        },
      },
    };
  }
  // The look tools' servers, local (`run`) or remote (`url`): their keys named as {env:VAR}, never
  // their values, and every act call hidden. The read profile has none: it holds none of their keys.
  const mode = run.tools?.mode ?? "look";
  const all = offered(loadTools(), run.tools?.only);
  const ready: Record<string, string[]> = reading ? {} : runTools(all, mode, process.env).ready;
  const mcp: Record<string, unknown> = {};
  const hidden: Record<string, "deny"> = {};
  // Each look call by OpenCode's name, with Shipify's (tool.call), which the gate's lines say: a
  // tool's id may hold a `_`, so OpenCode's name alone doesn't say where the tool's ends.
  const look: Record<string, string> = {};
  for (const [name, calls] of Object.entries(ready)) {
    const t = all[name];
    if (!t) continue;
    const vars = Object.fromEntries(
      Object.entries(t.keys).map(([v, k]) => [v, `{env:${secretFor(k, mode)}}`]),
    );
    if (t.url)
      mcp[name] = {
        type: "remote",
        url: t.url,
        headers: Object.fromEntries(
          Object.entries(t.headers ?? {}).map(([h, v]) => [
            h,
            v.replace(/\$\{(\w+)\}/g, (_, x: string) => vars[x] ?? `{env:${x}}`),
          ]),
        ),
      };
    else {
      const c = command(t.run as string[], run.tools?.root);
      mcp[name] = { type: "local", command: [c.command, ...c.args], environment: vars };
    }
    for (const c of t.act) hidden[callName(name, c)] = "deny";
    for (const c of calls) look[callName(name, c)] = `${name}.${c}`;
  }
  // Its own permissions all allow, but the refused commands, after git's options too: the gate
  // checks every call again, in every form (an "ask" would end the run, with no one to answer).
  const deny = (run.commands?.deny ?? []).flatMap((p) => {
    const git = /^git (\S+)$/.exec(p)?.[1];
    return git ? [`${p}*`, `git * ${git}`, `git * ${git} *`] : [`${p}*`];
  });
  write("opencode.json", {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    snapshot: false,
    ...(provider ? { provider: providers, model: `${provider}/${run.model}` } : {}),
    ...(Object.keys(mcp).length ? { mcp } : {}),
    // A tool it denies is out of the model's list: the act calls, the web when the run may not read
    // it, and in the read profile every tool but its reading ones (files outside its working folder
    // still read: the gate keeps them inside its folders).
    permission: reading
      ? {
          "*": "deny",
          ...Object.fromEntries(READ_TOOLS.map((t) => [t, "allow"])),
          external_directory: "allow",
        }
      : {
          "*": "allow",
          ...hidden,
          ...(run.commands?.web === false ? { webfetch: "deny", websearch: "deny" } : {}),
          ...(deny.length
            ? { bash: { "*": "allow", ...Object.fromEntries(deny.map((d) => [d, "deny"])) } }
            : {}),
        },
    // Shipify's gate, beside this file; a relative path, so the agent's copy finds its own.
    plugin: ["./gate.mjs"],
    // Shipify's skills, listed for the model; never in the read profile.
    ...(run.skills && !reading ? { skills: { paths: [run.skills] } } : {}),
  });
  // The gate and its rules: pi's gate's checks, with OpenCode's names for its tools. Found through
  // the contract's `agentFile` (ADR 0051 B1), never next to this file: the built CLI is one file in
  // `cli/dist/`, not beside its own sources.
  for (const [to, from] of [
    ["gate.mjs", "opencode-gate.mjs"],
    ["pi-gate.mjs", "pi-gate.mjs"],
  ] as const)
    writeFileSync(join(dir, to), readFileSync(agentFile(from)));
  write("gate.json", {
    deny: run.commands?.deny ?? [],
    web: run.commands?.web ?? false,
    write: run.folders?.write ?? [],
    look,
    ...(reading ? { run: false, read: run.folders?.read ?? [] } : {}),
    ...(provider ? { provider } : {}),
  });
  return provider ? { provider } : {};
}

function argv(run: AgentRun): string[] {
  const out = [...run.command, "--format", "json", "--title", TITLE];
  const s = settings(run);
  if (s.provider && run.model) out.push("--model", `${s.provider}/${run.model}`);
  else if (run.model) out.push("--model", run.model);
  if (run.effort) out.push("--variant", run.effort);
  if (run.resume) out.push("--session", run.resume);
  return out;
}

/**
 * A tool's name for the live log, as Shipify says it: tools.json's calls as tool.call
 * (notion_search), its own as they are (apply_patch is its only one with a `_`). The report's names
 * are the gate's, which knows them.
 */
const toolName = (name: string) =>
  name === "apply_patch" ? name : name.replace(/^([a-z0-9-]+)_(.+)$/, "$1.$2");

const oneLine = (v: unknown, max = 140) => {
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** What a tool call was about, in a few words, for the live log. */
function brief(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const pick = ["command", "filePath", "path", "pattern", "url", "query", "description"]
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

/**
 * A line of Shipify's gate, ending a line: one object of strings alone. A quote inside a string of
 * OpenCode's own JSON is escaped, so only the gate's line ends this way.
 */
const GATE_LINE = /\{"type":"shipify"(?:,"\w+":"(?:[^"\\]|\\.)*")*\}$/;

type Part = {
  type?: string;
  text?: string;
  tool?: string;
  reason?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    error?: string;
  };
};

function reader(): OutputReader {
  const report: AgentReport = {};
  const tools: Record<string, number> = {};
  const models: Record<string, Tokens> = {};
  let model: string | undefined;
  let usd = 0;
  let last = "";
  // Why the gate gave it no key, when it didn't: the run's error, whatever the model said after.
  let keyless: string | undefined;
  // Shipify's gate names the model each ask goes to, and each call it checked: its own and its
  // helpers' (OpenCode's events carry only its own), so the tools, what it read and what was
  // refused come from these alone.
  const gate = (e: Record<string, unknown>) => {
    if (typeof e.error === "string") {
      keyless = oneLine(e.error, 240);
      return `  ✗ ${keyless}`;
    }
    if (typeof e.call === "string") {
      const name = e.call;
      tools[name] = (tools[name] ?? 0) + 1;
      if (e.call === "webfetch" || e.call === "websearch") report.readOutside = true;
      if (e.call === "bash" && typeof e.command === "string" && fetchesOutside(e.command))
        report.readOutside = true;
      if (typeof e.refused === "string")
        report.denied = [...(report.denied ?? []), `${name}: ${oneLine(e.refused, 160)}`];
      return undefined;
    }
    if (typeof e.model === "string" && e.model !== model) {
      model = e.model;
      report.model = model;
      return `  · OpenCode · ${model}`;
    }
    return undefined;
  };
  return {
    line(text) {
      // A gate's line that landed at the end of a piece of OpenCode's: it writes a long event in
      // pieces, and the gate's own goes out meanwhile (checked live on 1.18.34). The piece is lost.
      const landed = GATE_LINE.exec(text);
      if (landed && landed.index > 0) return gate(JSON.parse(landed[0]) as Record<string, unknown>);
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return text;
      }
      if (!e || typeof e !== "object") return text;
      if (typeof e.sessionID === "string") report.session = e.sessionID;
      if (e.type === "shipify") return gate(e);
      const p = (e.part ?? {}) as Part;
      if (e.type === "text") {
        const said = p.text?.trim();
        if (said) last = said;
        return said || undefined;
      }
      // Its own calls, for the live log.
      if (e.type === "tool_use") {
        const name = toolName(String(p.tool ?? "?"));
        const input = p.state?.input ?? {};
        const shown = `  → ${name}${Object.keys(input).length ? `: ${brief(input)}` : ""}`;
        if (p.state?.status !== "error") return shown;
        return `${shown}\n  ✗ ${oneLine(p.state?.error ?? "", 200)}`;
      }
      if (e.type === "step_finish") {
        report.turns = (report.turns ?? 0) + 1;
        const u = p.tokens ?? {};
        const id = model ?? "?";
        const was = models[id] ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        models[id] = {
          input: was.input + (u.input ?? 0),
          cacheRead: was.cacheRead + (u.cache?.read ?? 0),
          cacheWrite: was.cacheWrite + (u.cache?.write ?? 0),
          output: was.output + (u.output ?? 0),
          thinking: (was.thinking ?? 0) + (u.reasoning ?? 0) || undefined,
        };
        usd += p.cost ?? 0;
        return p.reason === "stop" ? "  · finished" : undefined;
      }
      if (e.type === "error") {
        const err = (e.error ?? {}) as { name?: string; data?: { message?: unknown } };
        report.error = oneLine(
          err.data?.message ?? err.name ?? "the model answered with an error",
          200,
        );
        return `  ✗ ${report.error}`;
      }
      return undefined;
    },
    report() {
      if (keyless) report.error = keyless;
      if (Object.keys(tools).length) report.tools = tools;
      if (Object.keys(models).length) {
        report.models = models;
        report.tokens = Object.values(models).reduce((a, b) => ({
          input: a.input + b.input,
          cacheRead: a.cacheRead + b.cacheRead,
          cacheWrite: a.cacheWrite + b.cacheWrite,
          output: a.output + b.output,
          thinking: (a.thinking ?? 0) + (b.thinking ?? 0) || undefined,
        }));
        // A gateway's model has no price in OpenCode's own list: a cost only when it knew one.
        if (usd > 0) report.cost = { usd, plan: false };
      }
      const result = asResult(last);
      if (result !== undefined) report.result = result;
      else if (last.trim()) report.said = last.trim();
      return report;
    },
  };
}

/** Where it finds its own config folder (`opencode` in it), in the run's folders. */
const xdgConfig = (p: { config: string }) => join(p.config, "opencode", "config");

/** A gateway's model for people: its name without its maker ("laguna-s-2.1:free"), as pi's. */
const modelName = (id: string) => /^[a-z0-9-]+\/([^/\s]+)$/.exec(id)?.[1];

export const opencode: Adapter = {
  name: "OpenCode",
  tools: true,
  callName,
  modelName,
  // Its config, its sessions and its own files in the run's folders; nothing else's, nothing in
  // the background. Its own XDG folders are for it alone: the gate gives a command it runs the
  // run's own back. No skills of a repo's or of its home's (.agents, .claude): Shipify's are its
  // config's. No logins of its own (auth.json, whose entries can fetch a config from anywhere):
  // none but the gateway's key, which the gate holds. Checked in 1.18.34's source.
  env: (p) => ({
    OPENCODE_CONFIG: join(p.tools, "opencode.json"),
    XDG_CONFIG_HOME: xdgConfig(p),
    XDG_DATA_HOME: join(p.config, "opencode", "data"),
    XDG_CACHE_HOME: join(p.config, "opencode", "cache"),
    XDG_STATE_HOME: join(p.config, "opencode", "state"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    OPENCODE_DISABLE_SHARE: "1",
    OPENCODE_AUTH_CONTENT: "{}",
  }),
  // Its gateway's key, whatever its name: on the pipe this names, which Shipify's gate reads.
  loginFromPipe: () => ({ SHIPIFY_LOGIN_FD: String(LOGIN_FD) }),
  // Its own config folder, read-only and empty at every ask: where it can write, it downloads and
  // installs its plugin package there on every start (about two minutes on a Pi; checked live on
  // 1.18.34), and a config or a plugin there would load before Shipify's gate.
  readOnly: (p) => [join(xdgConfig(p), "opencode")],
  // Gone at every ask: its home's .opencode, whose config, plugins and agents it loads after its
  // own, and its cache, whose models list (read before its own) can name another package for its
  // provider, and whose packages it loads as they are. Nothing there is needed between asks.
  cleared: (p) => [join(p.home, ".opencode"), join(p.config, "opencode", "cache")],
  argv,
  reader,
};
