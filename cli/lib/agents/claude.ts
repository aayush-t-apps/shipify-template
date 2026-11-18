// Claude Code's adapter (ADR 0017, docs/agents.md): its flags for a model, an effort and the run's
// tools (ADR 0015: an MCP config naming the run's look server, its token as ${VAR}, ADR 0077, and
// the allow and deny lists; look calls only, ADR 0031), the commands it must never run (ADR 0043), and a reader for its output, `--output-format stream-json --verbose`: one JSON event
// a line. Checked against Claude Code 2.1.284 (tests/fixtures/claude-stream.jsonl).
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Adapter,
  type AgentReport,
  type AgentRun,
  type Commands,
  type CommandSeen,
  fetchesOutside,
  LOGIN_FD,
  loadTools,
  type Mode,
  type OutputReader,
  offered,
  oneLine,
  runTools,
  secretFor,
  skillRead,
  skillsSeen,
  type Tokens,
  type Tools,
} from "../plugins/agent.ts";

/** Its ways to read outside the run: the web tools, and a command that fetches (the contract's). */
const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);
const fetches = (name: string, input?: Record<string, unknown>) =>
  WEB_TOOLS.has(name) ||
  (name === "Bash" && typeof input?.command === "string" && fetchesOutside(input.command));

/** The skill a call loads: its Skill tool's, or a Read of a skill's SKILL.md. */
const skillOf = (name: string, input?: Record<string, unknown>) =>
  name === "Skill" && typeof input?.skill === "string"
    ? input.skill
    : name === "Read" && typeof input?.file_path === "string"
      ? skillRead(input.file_path)
      : undefined;

/** A tool's call as Claude Code names it: tools.json's notion.search is mcp__notion__search. */
const callName = (tool: string, call: string) => `mcp__${tool}__${call}`;

/**
 * Claude Code's settings for a run's tools (`offered`: each a remote one, at the run's look server,
 * ADR 0077): its MCP config, and the allow and deny lists.
 */
export function claudeTools(tools: Tools, mode: Mode, env: NodeJS.ProcessEnv = process.env) {
  const { ready, missing } = runTools(tools, mode, env);
  const servers: Record<string, unknown> = {};
  const allow: string[] = [];
  const deny: string[] = [];
  for (const name of Object.keys(ready)) {
    const t = tools[name] as Tools[string];
    if (!t.url) continue;
    const vars = Object.fromEntries(
      Object.entries(t.keys).map(([v, k]) => [v, `\${${secretFor(k, mode)}}`]),
    );
    servers[name] = {
      type: "http",
      url: t.url,
      headers: Object.fromEntries(
        Object.entries(t.headers ?? {}).map(([h, v]) => [
          h,
          v.replace(
            /\$\{(\w+)\}/g,
            (_, x: string) => (vars[x] as string | undefined) ?? `\${${x}}`,
          ),
        ]),
      ),
    };
    allow.push(...(ready[name] as string[]).map((c) => callName(name, c)));
    if (mode === "look") deny.push(...t.act.map((c) => callName(name, c)));
  }
  return { config: { mcpServers: servers }, allow, deny, ready, missing };
}

/** Its tools that run commands and look at files, allowed whole (ADR 0043). */
export const WHOLE_TOOLS = ["Bash", "Read", "Glob", "Grep"];

/**
 * The read profile's tools (ADR 0044): `--restricted` takes away every tool that runs a command or
 * code and WebFetch, keeps the file tools inside its working folders (`--add-dir` included), and
 * ignores settings files; `--tools` leaves these. Its answer still comes back in the result's
 * shape (its StructuredOutput tool, for `--json-schema`). Checked live on Claude Code 2.1.284.
 */
export const READ_TOOLS = ["Read", "Grep", "Glob"];

/**
 * Its tools that would keep a run going after its answer: since 2.1.292 a one-shot `-p` run waits
 * for a wakeup it scheduled (up to an hour), then asks itself again (checked against a stand-in
 * API on 2.1.327; 2.1.284 dropped it). A run ends with its answer, and Shipify's repeats bring a
 * task back (ADR 0054).
 */
export const LATER_TOOLS = ["ScheduleWakeup"];

/**
 * What every agent must never run (executors.json's `commands`, ADR 0043), as Claude Code's rules:
 * its command and look tools allowed whole, the web as its own tools, and each refused command as
 * a deny rule, after git's own options too (`git -C x push`). In Claude Code 2.1.284 a deny rule is
 * checked on every part of a command (`make && git push`, `$(git stash)`, a `for` body) before any
 * allow, and a whole-tool allow lets through every other prompt but its safety checks, so a pipe,
 * a loop or a read outside the run's folders runs. Edits stay where acceptEdits lets them: its
 * clone and the folders it may write.
 */
function withCommands(cmd: string[], c: Commands): string[] {
  const out = [...cmd];
  if (c.run === false) return [...out, "--restricted", "--tools", READ_TOOLS.join(",")];
  const after = (flag: string, items: string[]) => {
    const i = out.indexOf(flag);
    if (i < 0) out.push(flag, ...items);
    else out.splice(i + 1, 0, ...items);
  };
  const deny = c.deny.flatMap((p) => {
    const git = /^git (\S+)$/.exec(p)?.[1];
    return git ? [`Bash(${p}:*)`, `Bash(git * ${git})`, `Bash(git * ${git} *)`] : [`Bash(${p}:*)`];
  });
  after("--disallowedTools", [...deny, ...LATER_TOOLS]);
  after("--allowedTools", [...WHOLE_TOOLS, ...(c.web ? ["WebFetch", "WebSearch"] : [])]);
  return out;
}

/** Flags for the run's tools; none when tools.json has none ready for it. */
function withTools(cmd: string[], tools: NonNullable<AgentRun["tools"]>): string[] {
  const all = offered(loadTools(), tools.served);
  const t = claudeTools(all, tools.mode);
  if (!Object.keys(t.ready).length) return cmd;
  mkdirSync(tools.dir, { recursive: true, mode: 0o700 });
  const mcp = join(tools.dir, "mcp.json");
  writeFileSync(mcp, `${JSON.stringify(t.config, null, 2)}\n`);
  const out = [...cmd];
  const after = (flag: string, items: string[]) => {
    const i = out.indexOf(flag);
    if (i < 0) out.push(flag, ...items);
    else out.splice(i + 1, 0, ...items);
  };
  after("--allowedTools", t.allow);
  // The run's settings are for the agent to obey, never to read or change
  // ("//" starts an absolute path in Claude Code's rules; Edit covers Write too).
  const fence = `/${tools.dir}/**`;
  after("--disallowedTools", [...t.deny, `Edit(${fence})`, `Read(${fence})`]);
  out.push("--mcp-config", mcp);
  if (!out.includes("--strict-mcp-config")) out.push("--strict-mcp-config");
  return out;
}

/** A tool's name as Shipify says it: tools.json's calls as tool.call, built-in tools as they are. */
const toolName = (name: string) => {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  return m ? `${m[1]}.${m[2]}` : name;
};

/** What a tool call was about, in a few words, for the live log. */
function brief(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const pick = ["command", "file_path", "path", "pattern", "url", "query", "description"]
    .map((k) => input[k])
    .find((v) => typeof v === "string" && v);
  return oneLine(pick ?? JSON.stringify(input));
}

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  thinkingTokens?: number;
}

const tokensOf = (u: Usage): Tokens => ({
  input: u.inputTokens ?? 0,
  cacheRead: u.cacheReadInputTokens ?? 0,
  cacheWrite: u.cacheCreationInputTokens ?? 0,
  output: u.outputTokens ?? 0,
  thinking: u.thinkingTokens || undefined,
});

const add = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
  thinking: (a.thinking ?? 0) + (b.thinking ?? 0) || undefined,
});

type Event = Record<string, unknown> & { type?: string; subtype?: string };

/** Its tools that start a helper of its own (named `Task` in 2.1.284). */
const HELPER_TOOLS = ["Task", "Agent"];

/** A list of names from its output, or none when it isn't one. */
const names = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

function reader(): OutputReader {
  const report: AgentReport = {};
  const tools: Record<string, number> = {};
  const skills: string[] = [];
  // Each command, by its call's id: a permission denial in its result event names that id.
  const commands: (CommandSeen & { id?: string })[] = [];
  let keySource: string | undefined;
  return {
    line(text) {
      let e: Event;
      try {
        e = JSON.parse(text) as Event;
      } catch {
        return text;
      }
      if (!e || typeof e !== "object") return text;
      if (e.type === "system" && e.subtype === "init") {
        report.version = e.claude_code_version as string | undefined;
        report.model = e.model as string | undefined;
        report.session = e.session_id as string | undefined;
        keySource = e.apiKeySource as string | undefined;
        // What it was offered: its tools, its helpers (when it has their tool) and its skills.
        const offered = names(e.tools);
        if (offered)
          report.offered = {
            tools: offered,
            ...(offered.some((t) => HELPER_TOOLS.includes(t)) && names(e.agents)
              ? { helpers: names(e.agents) }
              : {}),
            ...(names(e.skills) ? { skills: names(e.skills) } : {}),
          };
        const failed = ((e.mcp_servers as { name: string; status: string }[] | undefined) ?? [])
          .filter((s) => s.status !== "connected")
          .map((s) => `${s.name} (${s.status})`);
        if (failed.length)
          report.notes = [
            ...(report.notes ?? []),
            `Tool servers that didn't start: ${failed.join(", ")}.`,
          ];
        return `  · Claude Code ${report.version ?? "?"} · ${report.model ?? "?"}`;
      }
      if (e.type === "system" && e.subtype === "api_retry")
        return `  · retrying the model (${String(e.error_status ?? e.error ?? "an error")})`;
      if (e.type === "assistant") {
        const content = ((e.message as { content?: unknown[] })?.content ?? []) as {
          type: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
          text?: string;
        }[];
        const out: string[] = [];
        for (const c of content) {
          if (c.type === "tool_use" && c.name) {
            const name = toolName(c.name);
            tools[name] = (tools[name] ?? 0) + 1;
            if (c.name === "Bash" && typeof c.input?.command === "string")
              commands.push({ command: c.input.command, refused: false, id: c.id });
            if (fetches(c.name, c.input)) report.readOutside = true;
            const skill = skillOf(c.name, c.input);
            if (skill) skills.push(skill);
            out.push(`  → ${name}${c.input ? `: ${brief(c.input)}` : ""}`);
          } else if (c.type === "text" && c.text?.trim()) out.push(c.text.trim());
        }
        return out.length ? out.join("\n") : undefined;
      }
      if (e.type === "user") {
        const content = ((e.message as { content?: unknown })?.content ?? []) as {
          type?: string;
          is_error?: boolean;
          content?: unknown;
        }[];
        const failed = Array.isArray(content)
          ? content.filter((c) => c?.type === "tool_result" && c.is_error)
          : [];
        if (!failed.length) return undefined;
        return failed
          .map((c) => {
            const body = Array.isArray(c.content)
              ? (c.content as { text?: string }[]).map((x) => x.text ?? "").join(" ")
              : String(c.content ?? "");
            return `  ✗ ${oneLine(body, 200)}`;
          })
          .join("\n");
      }
      if (e.type === "rate_limit_event") {
        const info = (e.rate_limit_info ?? {}) as {
          status?: string;
          rateLimitType?: string;
          resetsAt?: number;
          utilization?: number;
          unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
        };
        const at = (s?: number) => (s ? new Date(s * 1000).toISOString() : undefined);
        const windows = Object.entries(info.unifiedWindows ?? {});
        report.limits = windows.length
          ? windows.map(([window, w]) => ({
              window,
              used: w.utilization ?? 0,
              resets: at(w.resetsAt),
              rejected: info.status === "rejected" && window === info.rateLimitType,
            }))
          : info.rateLimitType
            ? [
                {
                  window: info.rateLimitType,
                  used: info.utilization ?? 0,
                  resets: at(info.resetsAt),
                  rejected: info.status === "rejected",
                },
              ]
            : report.limits;
        return undefined;
      }
      if (e.type === "result") {
        report.turns = e.num_turns as number | undefined;
        if (e.structured_output !== undefined && e.structured_output !== null)
          report.result = e.structured_output;
        const usage = (e.modelUsage ?? {}) as Record<string, Usage>;
        const models = Object.fromEntries(
          Object.entries(usage).map(([id, u]) => [id, tokensOf(u)]),
        );
        if (Object.keys(models).length) {
          // Counted from the session's start: a resumed ask's are its earlier asks' too.
          report.sessionTotals = true;
          report.models = models;
          report.tokens = Object.values(models).reduce(add);
          // Without an init event, the model that wrote the most did the work.
          report.model ??= Object.entries(models).sort((a, b) => b[1].output - a[1].output)[0]?.[0];
        }
        if (typeof e.total_cost_usd === "number")
          report.cost = {
            usd: e.total_cost_usd,
            plan: !/api.?key/i.test(keySource ?? ""),
          };
        const denials = (e.permission_denials ?? []) as {
          tool_name?: string;
          tool_use_id?: string;
          tool_input?: Record<string, unknown>;
        }[];
        if (denials.length)
          report.denied = denials.map(
            (d) =>
              `${toolName(d.tool_name ?? "?")}${d.tool_input ? `: ${brief(d.tool_input)}` : ""}`,
          );
        // A refused command: its call's id, else its words.
        for (const d of denials) {
          if (d.tool_name !== "Bash") continue;
          const seen = commands.find((c) =>
            d.tool_use_id ? c.id === d.tool_use_id : c.command === d.tool_input?.command,
          );
          if (seen) seen.refused = true;
        }
        // A run can end with more than one result (background work starts another turn, 2.1.292
        // on): the last one says how it ended. Its last words, when it answered in words and not
        // in the result's schema.
        report.said =
          !e.is_error && e.structured_output == null && typeof e.result === "string"
            ? e.result.trim() || undefined
            : undefined;
        // Its own words for the error ("Prompt is too long") say the most, then the API's status.
        report.error = e.is_error
          ? oneLine(
              (typeof e.result === "string" && e.result.trim() ? e.result : undefined) ??
                (e.api_error_status as string | undefined) ??
                (e.subtype === "success" ? "the agent reported an error" : e.subtype),
              200,
            )
          : undefined;
        return `  · finished: ${e.subtype ?? "?"}${report.turns ? `, ${report.turns} turns` : ""}`;
      }
      return undefined;
    },
    report() {
      if (Object.keys(tools).length) report.tools = tools;
      report.skills = skillsSeen(skills);
      if (commands.length)
        report.commands = commands.map(({ command, refused }) => ({ command, refused }));
      return report;
    },
  };
}

/** "Sonnet 5.5" for claude-sonnet-5-5, "Haiku 4.5" for claude-haiku-4-5-20251001. */
function modelName(id: string): string | undefined {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
  return m
    ? `${(m[1] as string).charAt(0).toUpperCase()}${(m[1] as string).slice(1)} ${m[2]}.${m[3]}`
    : undefined;
}

/**
 * Claude Code reads CLAUDE.md, which points it at AGENTS.md, and finds skills in .claude/skills;
 * other agents read AGENTS.md and its links.
 */
function workspace(root: string, platform: string, guide: string) {
  if (!existsSync(join(root, "CLAUDE.md")))
    writeFileSync(join(root, "CLAUDE.md"), `${guide}\n@${platform}/AGENTS.md\n`);
  const skills = join(root, ".claude", "skills");
  if (existsSync(join(root, platform, "skills")) && !existsSync(skills)) {
    mkdirSync(dirname(skills), { recursive: true });
    symlinkSync(join("..", platform, "skills"), skills);
  }
}

export const claude: Adapter = {
  name: "Claude Code",
  tools: true,
  callName,
  modelName,
  workspace,
  // The pinned version stays the version: no update in the middle of a task. Its settings and
  // sessions live in the run's own folder. Its own bundled skills and workflows (loop, schedule,
  // claude-api, init…) are off, so its list is Shipify's skills, a user's skills folder, which the
  // switch leaves (its setting's own words in 2.1.284), and two of its own it leaves too (doctor,
  // and plugin-authoring since 2.1.326). Its helpers think at medium effort when their call names
  // none, not at the run's, and a model that takes no effort gets none (2.1.316 on; checked
  // against a stand-in API on 2.1.327, with Haiku 4.5 too).
  env: (p) => ({
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CONFIG_DIR: p.config,
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_SUBAGENT_EFFORT: "medium",
  }),
  // Its subscription login from the pipe: its own setting, not in its public docs; checked live
  // on 2.1.284, it reads the pipe once and keeps the login in memory, never in a file.
  loginFromPipe: (name) =>
    name === "CLAUDE_CODE_OAUTH_TOKEN"
      ? { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(LOGIN_FD) }
      : undefined,
  // Shipify's skills as its own user's (it has no flag for a folder of them): its settings folder's
  // skills/, which `--setting-sources user` still reads. Checked live on 2.1.284: all of them listed.
  skillsLink: (p) => join(p.config, "skills"),
  // Its own user's settings (hooks, env, permissions, an API key helper), which `--setting-sources
  // user` reads from its settings folder, where a command can write too: gone at every ask.
  cleared: (p) => [join(p.config, "settings.json")],
  argv(run) {
    // Its output is a stream of JSON events, whatever executors.json says.
    let out = [...run.command];
    const at = out.indexOf("--output-format");
    if (at >= 0) out.splice(at, 2);
    out.push("--output-format", "stream-json", "--verbose");
    if (run.model) out.push("--model", run.model);
    if (run.effort) out.push("--effort", run.effort);
    if (run.resume) out.push("--resume", run.resume);
    // Its final answer held to the result's schema: it comes back in the result event.
    if (run.resultSchema) out.push("--json-schema", run.resultSchema);
    if (run.commands) out = withCommands(out, run.commands);
    // The read profile has no tool's calls: it holds none of their keys (ADR 0044).
    const reading = run.commands?.run === false;
    if (run.tools && !reading) out = withTools(out, run.tools);
    // Only its own user's settings and the run's tools: a project's files can't widen what it may do.
    if (run.commands || run.tools)
      for (const flag of [["--setting-sources", "user"], ["--strict-mcp-config"]])
        if (!out.includes(flag[0] as string)) out.push(...flag);
    // The folders outside its working one it may use: your files and its copy of Shipify to read,
    // the run's out/ to write ("//" starts an absolute path in Claude Code's rules).
    const rules = [
      ...(run.folders?.read ?? []).map((d) => `Read(/${d}/**)`),
      ...(run.folders?.write ?? []).map((d) => `Edit(/${d}/**)`),
    ];
    if (rules.length) {
      const i = out.indexOf("--allowedTools");
      if (i < 0) out.push("--allowedTools", ...rules);
      else out.splice(i + 1, 0, ...rules);
    }
    // The folders it writes are working folders too: without that, a command may write a log into
    // out/ but not list it or read it back (`ls out`, `grep … out/verify.log` were refused). In
    // the read profile its read folders are too, since `--restricted` keeps its reads inside them.
    const write = run.folders?.write ?? [];
    for (const d of [...(reading ? (run.folders?.read ?? []) : []), ...write])
      out.push("--add-dir", d);
    // The repo it works in, whose instructions it follows: `--setting-sources user` leaves out the
    // project's own CLAUDE.md, so its folder is added and Claude Code told to read an added folder's
    // (a Shipify project's says `@AGENTS.md`), but never one in a folder it writes, which a command
    // could fill. None in the read profile: no repo's. Checked live on 2.1.284 and 2.1.327 (a
    // stand-in API).
    if (run.work && !reading)
      out.push(
        "--add-dir",
        run.work,
        "--settings",
        JSON.stringify({
          env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" },
          ...(write.length ? { claudeMdExcludes: write.map((d) => `${d}/**`) } : {}),
        }),
      );
    return out;
  },
  reader,
};
