// Tools (ADR 0015, ADR 0027, docs/tools.md): tools.json lists them, each entry checked against the
// tool contract (plugins/tool.ts). The agent gets the look tools; the box makes act calls you approved
// too. Keys come from GitHub secrets through the run's environment, and the agent's config names
// them as ${VAR}, never their values. The core names no tool: an agent's adapter turns this into its
// own settings (agents/<name>.ts).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PLATFORM_ROOT } from "./config.ts";
import { run } from "./exec.ts";
import type { Check } from "./output.ts";
import { loadPluginFile, TOOLS_VERSION, ToolEntry, type Tools } from "./plugins/tool.ts";

export { isChannel, type ToolEntry, type Tools, verbsOf } from "./plugins/tool.ts";

export type Mode = "look" | "act";

/** tools.json, entry by entry: the good tools, and a plain line for each that's wrong. */
export function readTools(
  file = process.env.SHIPIFY_TOOLS_FILE ?? join(PLATFORM_ROOT, "tools.json"),
): { tools: Tools; problems: string[]; broken: string[] } {
  if (!existsSync(file)) return { tools: {}, problems: [], broken: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { tools: {}, problems: [`tools.json: not JSON (${(e as Error).message})`], broken: [] };
  }
  const r = loadPluginFile("tools.json", raw, ToolEntry, TOOLS_VERSION);
  return { tools: r.entries, problems: r.problems, broken: r.broken };
}

/** The tools that are right: a broken entry is left out (ship doctor and pnpm verify say why). */
export const loadTools = (file?: string): Tools => readTools(file).tools;

/** A server's command, with relative paths (tools/<tool>/…) made paths in this repo. */
export function command(argv: string[], root = PLATFORM_ROOT): { command: string; args: string[] } {
  // From a read-only copy of Shipify (an agent's sandbox, ADR 0031), or a checkout without its
  // packages (a box's copy holds none: ADR 0051), a TypeScript server runs on Node itself, which
  // strips the types: the launcher inside the repo is used only where it's installed.
  const launcher = argv[0] ?? "";
  const plain = root !== PLATFORM_ROOT || !existsSync(join(root, launcher));
  const parts =
    plain && !isAbsolute(launcher) && launcher.includes("/") ? ["node", ...argv.slice(1)] : argv;
  const [first, ...rest] = parts.map((p) =>
    !isAbsolute(p) && !p.startsWith("-") && p.includes("/") ? join(root, p) : p,
  ) as [string, ...string[]];
  return { command: first, args: rest };
}

/**
 * A plug-in's check, once with each verb's keys, where they're known: `ship doctor` reads them from
 * the run's environment, `ship add` and `ship selftest <name>` from the credentials file. A verb
 * whose keys aren't all there is left out, never failed.
 */
export function toolChecks(
  name: string,
  t: ToolEntry,
  secretOf: (secret: string) => string | undefined,
): Check[] {
  if (!t.check) return [];
  const checks: Check[] = [];
  // A chat channel's keys are its setup's, held by the edge (no look or act secret): its check
  // runs once with them, as `ship add` put them in the credentials file.
  const own = Object.keys(t.keys).length
    ? []
    : Object.keys(t.setup?.keys ?? {}).map((v) => [v, v] as const);
  const modes = [
    ...(["look", "act"] as const).map((mode) => ({
      label: `${mode} key`,
      vars: Object.entries(t.keys).flatMap(([v, k]) =>
        k[mode] ? [[v, k[mode] as string] as const] : [],
      ),
    })),
    { label: "key", vars: own },
  ];
  for (const { label, vars } of modes) {
    if (!vars.length || vars.some(([, secret]) => !secretOf(secret))) continue;
    const { command: cmd, args } = command(t.check);
    const env = Object.fromEntries(vars.map(([v, secret]) => [v, secretOf(secret) as string]));
    const r = run(cmd, args, { env });
    const detail = (r.stdout || r.stderr).trim().split("\n")[0] ?? "";
    checks.push({
      name: `${name}'s ${label} works`,
      ok: r.code === 0,
      detail,
      blocking: false,
      // Nothing answered: the network, not the key. A check that names its fix keeps its words.
      fix: /didn't answer/.test(detail)
        ? "nothing answered (this machine's network, or the service): run the check again in a minute"
        : /pnpm ship /.test(detail)
          ? detail.slice(detail.indexOf("pnpm ship "))
          : `make a new key, then set it again: pnpm ship add ${name} --new --yes`,
    });
  }
  return checks;
}

/**
 * Whether a plug-in is set up here: a chat channel someone's on (`on`: SHIPIFY_PEOPLE, as the door
 * reads it; a channel with no keys, the web chat's, counts only so), or every key its setup asks
 * for is known (`ship add` put it in the credentials file). One with no keys to ask for counts
 * where its verbs' keys are, as its check does.
 */
export function isSetUp(
  t: ToolEntry,
  secretOf: (secret: string) => string | undefined,
  on: (door: string) => boolean = () => false,
): boolean {
  if (t.in && on(t.in.door)) return true;
  const asks = Object.keys(t.setup?.keys ?? {});
  return asks.length
    ? asks.every((k) => Boolean(secretOf(k)))
    : Object.values(t.keys).some((k) => [k.look, k.act].some((s) => s && secretOf(s)));
}

/** The secret a tool's variable comes from in this mode. */
export const secretFor = (k: { look?: string; act?: string }, mode: Mode) =>
  (mode === "act" ? (k.act ?? k.look) : k.look) ?? "";

export interface RunTools {
  /** Tools a run has: name → its look calls (and, for the box's own act calls, act). */
  ready: Record<string, string[]>;
  /** Tools left out, and why. */
  missing: { tool: string; why: string }[];
}

/**
 * Which tools a run gets: those with calls for the agent (look, act) whose keys for this mode are
 * set. A channel with no calls is the core's to use, never the agent's.
 */
export function runTools(tools: Tools, mode: Mode, env: NodeJS.ProcessEnv = process.env): RunTools {
  const ready: RunTools["ready"] = {};
  const missing: RunTools["missing"] = [];
  for (const [name, t] of Object.entries(tools)) {
    if (!t.look.length && !t.act.length) continue;
    const unset = Object.values(t.keys)
      .map((k) => secretFor(k, mode))
      .filter((s) => !env[s]);
    if (unset.length) missing.push({ tool: name, why: `${unset.join(", ")} isn't set` });
    else ready[name] = mode === "act" ? [...t.look, ...t.act] : [...t.look];
  }
  return { ready, missing };
}

/**
 * The tools a server offers, from the server itself (MCP's tools/list over stdio). For
 * `ship tools check`: every tool must be sorted into look or act. It waits `timeoutMs` for the
 * answer (a test's busy machine waits longer).
 */
export function listServerTools(
  argv: string[],
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 20_000,
): Promise<string[]> {
  const { command: cmd, args } = command(argv);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the server didn't answer within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      for (const line of buf.split("\n").slice(0, -1)) {
        const m = JSON.parse(line) as { id?: number; result?: { tools?: { name: string }[] } };
        if (m.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve((m.result?.tools ?? []).map((t) => t.name));
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "ship", version: "1" },
      },
    });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list" });
  });
}

/** What's wrong with a tool's look and act lists against what its server really offers. */
export function sortProblems(name: string, t: ToolEntry, offered: string[]): string[] {
  const sorted = new Set([...t.look, ...t.act]);
  const both = t.look.filter((c) => t.act.includes(c));
  return [
    ...offered.filter((c) => !sorted.has(c)).map((c) => `${name}: "${c}" is neither look nor act`),
    ...[...sorted]
      .filter((c) => !offered.includes(c))
      .map((c) => `${name}: "${c}" isn't offered by its server`),
    ...both.map((c) => `${name}: "${c}" is both look and act`),
  ];
}
