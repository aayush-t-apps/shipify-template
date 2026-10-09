// Approved calls made by the box (ADR 0031): the same MCP server the agent looks with, started
// here with the tool's act key, one call at a time. No agent and no guard: the calls are exactly the
// ones you approved (or a tool's pre-approved forms), checked before they get here.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { maskSecrets, type ToolCall, type ToolResult } from "../contracts/index.ts";
import { command, loadTools } from "../lib/tools.ts";

const TIMEOUT_MS = 60_000;

/** Makes these calls on their tool, in order; each answers ✓ or ✗ with the tool's own words. */
export async function makeCalls(
  calls: ToolCall[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolResult[]> {
  const tool = calls[0]?.tool;
  if (!tool) return [];
  const entry = loadTools()[tool];
  if (!entry?.run) return calls.map(() => ({ ok: false, text: `${tool} isn't set up here` }));
  // Decide checked them; this is the last line: only this tool's act calls.
  if (calls.some((c) => c.tool !== tool || !entry.act.includes(c.name)))
    return calls.map(() => ({
      ok: false,
      text: "not a list of this tool's act calls: nothing was made",
    }));
  // Only this tool's act keys, by the variable names its server reads.
  const keys = Object.fromEntries(
    Object.entries(entry.keys ?? {}).flatMap(([v, k]) =>
      k.act && env[k.act] ? [[v, env[k.act] as string]] : [],
    ),
  );
  const { command: bin, args } = command(entry.run);
  const child = spawn(bin, args, {
    env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", ...keys },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map<
    number,
    (m: { result?: unknown; error?: { message?: string } }) => void
  >();
  lines.on("line", (line) => {
    try {
      const m = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof m.id === "number") waiting.get(m.id)?.(m);
    } catch {}
  });
  let next = 1;
  const ask = (method: string, params: unknown) =>
    new Promise<{ result?: unknown; error?: { message?: string } }>((resolve) => {
      const id = next++;
      const timer = setTimeout(
        () => resolve({ error: { message: "it didn't answer in time" } }),
        TIMEOUT_MS,
      );
      waiting.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const out: ToolResult[] = [];
  try {
    const init = await ask("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "shipify-apply", version: "0.1" },
    });
    if (init.error)
      return calls.map(() => ({
        ok: false,
        text: `${tool} didn't start: ${init.error?.message ?? "no answer"}`,
      }));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    for (const c of calls) {
      const r = await ask("tools/call", { name: c.name, arguments: c.args });
      const res = r.result as
        | { content?: { type: string; text?: string }[]; isError?: boolean }
        | undefined;
      const text = maskSecrets(
        r.error?.message ?? (res?.content ?? []).map((x) => x.text ?? "").join("\n") ?? "",
      ).slice(0, 2_000);
      out.push({ ok: !r.error && !res?.isError, text: text || (r.error ? "it failed" : "done") });
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
  return out;
}
