// Approved calls made by the box (ADR 0031): the same MCP server the agent looks with, started
// here with the tool's act key, one call at a time. No agent and no guard: the calls are exactly the
// ones you approved (or a tool's pre-approved or guest forms), checked before they get here.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { readBlob } from "../commands/task/files.ts";
import { maskSecrets, type ToolCall, type ToolResult } from "../contracts/index.ts";
import type { TaskState } from "../lib/task.ts";
import { command, loadTools } from "../lib/tools.ts";
import { doorFile, type GuestWho } from "./door.ts";

const TIMEOUT_MS = 60_000;

/**
 * Makes these calls on their tool, in order; each answers ✓ or ✗ with the tool's own words. Files a
 * call names (its tool's `args.<call>.files`) come from the task's `shared` files, read with the
 * run's read key; or from this run's out folder (`local`, by name: a guest's, which are never on
 * the branch, ADR 0073); or are ones sent through a chat on this task, named by their ref (its
 * from-lines' in `sent`, `<channel>:<id>`) and fetched from the door (ADR 0069): nothing goes to
 * the branch. Each lands in a folder of their own for the server (SHIPIFY_FILES), removed after; a
 * ref is named in the call by its file's name there. A guest's calls (`guest`, from the door) start
 * the server with SHIPIFY_GUEST, so its guest mode acts for them alone.
 */
export async function makeCalls(
  calls: ToolCall[],
  env: NodeJS.ProcessEnv = process.env,
  shared: NonNullable<TaskState["shared"]> = {},
  get: typeof fetch = fetch,
  sent: Record<string, string> = {},
  fromDoor: (ref: string) => Promise<Buffer | undefined> = doorFile,
  more: { local?: Record<string, string>; guest?: GuestWho } = {},
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
  const none = (text: string) => calls.map(() => ({ ok: false, text }));
  const names = callFiles(calls, entry);
  const local = more.local ?? {};
  const isShared = (n: string) => Object.hasOwn(shared, n);
  const isLocal = (n: string) => !isShared(n) && Object.hasOwn(local, n);
  const isSent = (n: string) => !isShared(n) && !isLocal(n) && Object.hasOwn(sent, n);
  const unshared = names.filter((n) => !isShared(n) && !isLocal(n) && !isSent(n));
  if (unshared.length)
    return none(`${unshared.join(", ")}: not among this task's shared files, so nothing was made`);
  let files: string | undefined;
  // A ref's file, by the name it was written under.
  const named = new Map<string, string>();
  if (names.length) {
    files = mkdtempSync(join(tmpdir(), "shipify-call-files-"));
    try {
      for (const n of names.filter(isShared))
        writeFileSync(
          join(files, n),
          await readBlob((shared[n] as { url: string }).url, env.GH_TOKEN ?? "", get),
        );
      for (const n of names.filter(isLocal)) copyFileSync(local[n] as string, join(files, n));
      for (const n of names.filter(isSent)) {
        const body = await fromDoor(n);
        if (!body) throw new Error(`${sent[n]} couldn't be fetched from the door`);
        const name = freeName(files, sent[n] ?? "file");
        writeFileSync(join(files, name), body);
        named.set(n, name);
      }
    } catch (e) {
      rmSync(files, { recursive: true, force: true });
      return none(
        `the task's shared files couldn't be read (${(e as Error).message}), so nothing was made`,
      );
    }
  }
  try {
    return await callTool(
      named.size ? byName(calls, entry, named) : calls,
      entry,
      env,
      files,
      more.guest,
    );
  } finally {
    if (files) rmSync(files, { recursive: true, force: true });
  }
}

/** The files these calls name (their tool's `args.<call>.files`), each once, by name: one tool's. */
export function callFiles(calls: ToolCall[], entry = loadTools()[calls[0]?.tool ?? ""]): string[] {
  return [
    ...new Set(
      calls.flatMap((c) => {
        const arg = entry?.args?.[c.name]?.files;
        const v = arg ? c.args[arg] : undefined;
        return Array.isArray(v) ? v.map((f) => basename(String(f))) : [];
      }),
    ),
  ];
}

/** A file's name made safe, and free in this folder: a second `photo.jpg` is `2-photo.jpg`. */
function freeName(dir: string, raw: string) {
  const base = raw.replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "") || "file";
  let name = base;
  for (let i = 2; existsSync(join(dir, name)); i++) name = `${i}-${base}`;
  return name;
}

/** The calls with each ref in their files named as its file was written. */
function byName(
  calls: ToolCall[],
  entry: NonNullable<ReturnType<typeof loadTools>[string]>,
  named: Map<string, string>,
): ToolCall[] {
  return calls.map((c) => {
    const arg = entry.args?.[c.name]?.files;
    const v = arg ? c.args[arg] : undefined;
    if (!arg || !Array.isArray(v)) return c;
    return { ...c, args: { ...c.args, [arg]: v.map((f) => named.get(String(f)) ?? f) } };
  });
}

async function callTool(
  calls: ToolCall[],
  entry: NonNullable<ReturnType<typeof loadTools>[string]>,
  env: NodeJS.ProcessEnv,
  files: string | undefined,
  guest: GuestWho | undefined,
): Promise<ToolResult[]> {
  const tool = calls[0]?.tool as string;
  // Only this tool's act keys, by the variable names its server reads.
  const keys = Object.fromEntries(
    Object.entries(entry.keys ?? {}).flatMap(([v, k]) =>
      k.act && env[k.act] ? [[v, env[k.act] as string]] : [],
    ),
  );
  const { command: bin, args } = command(entry.run as string[]);
  const child = spawn(bin, args, {
    env: {
      PATH: env.PATH ?? "",
      HOME: env.HOME ?? "",
      ...keys,
      ...(files ? { SHIPIFY_FILES: files } : {}),
      ...(guest ? { SHIPIFY_GUEST: JSON.stringify(guest) } : {}),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map<
    number,
    (m: { result?: unknown; error?: { message?: string } }) => void
  >();
  // A server that can't start (its launcher missing, a wrong path) is an answer, never a crash.
  let broke: string | undefined;
  child.on("error", (e) => {
    broke = `it couldn't start: ${e.message}`;
    for (const done of waiting.values()) done({ error: { message: broke } });
  });
  child.stdin.on("error", () => {});
  lines.on("line", (line) => {
    try {
      const m = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof m.id === "number") waiting.get(m.id)?.(m);
    } catch {}
  });
  let next = 1;
  const ask = (method: string, params: unknown) =>
    new Promise<{ result?: unknown; error?: { message?: string } }>((resolve) => {
      if (broke) return resolve({ error: { message: broke } });
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
