import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** One `gh` call this process made (ADR 0051 B0): its name, and how long it took. */
export interface GhCall {
  name: string;
  ms: number;
}

const ghCalls: GhCall[] = [];

/** Every `gh` call this process has made, in order: each step's timing line (ADR 0051 B0). */
export const callsSoFar = (): GhCall[] => [...ghCalls];

/** A gh call's short name, for the timing line: what it asked GitHub for (ADR 0051 B0). */
export function ghName(args: string[]): string {
  if (args[0] !== "api")
    return (
      args
        .filter((a) => !a.startsWith("-"))
        .slice(0, 2)
        .join(" ") || "gh"
    );
  if (args[1] === "graphql") return "graphql";
  // A path, not a flag's value: `api [-X POST] repos/…`, never `-H`'s or `-f`'s.
  const skip = new Set(["-X", "-H", "-f", "-F", "--input", "--jq"]);
  const path =
    args.find(
      (a, i) => i > 0 && !skip.has(args[i - 1] ?? "") && !a.startsWith("-") && a.includes("/"),
    ) ?? "";
  const segs = (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  const what = /^\d+$/.test(segs.at(-1) ?? "") ? (segs.at(-2) ?? "") : (segs.at(-1) ?? "");
  const method = args[1] === "-X" ? `${(args[2] ?? "get").toLowerCase()} ` : "";
  return `${method}${what || "api"}`;
}

const counted = (cmd: string, args: string[], started: number) => {
  if (cmd === "gh") ghCalls.push({ name: ghName(args), ms: Date.now() - started });
};

/**
 * What a plug-in's command starts with instead of this process's environment: enough to run and
 * tell the time, and none of the run's keys (the door key, the bot's token, the issues token).
 */
export const PLAIN_ENV = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  LANG: process.env.LANG ?? "C.UTF-8",
  ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
});

/** Run a command without a shell. Arguments are never interpolated into a shell string. */
export function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    /** Share the terminal (stdin too). */
    inherit?: boolean;
    /** Show the output as it runs, with stdin still piped from `input`. */
    show?: boolean;
    env?: NodeJS.ProcessEnv;
    /** Start from PLAIN_ENV, not this process's environment: a plug-in's command. */
    plain?: boolean;
    input?: string;
    timeoutMs?: number;
  } = {},
): RunResult {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...(opts.plain ? PLAIN_ENV() : process.env), ...opts.env },
    encoding: "utf8",
    input: opts.input,
    // A child's output is for people, so it goes to stderr: this process's stdout is its result
    // (`--json`), which a make under another make ("Entering directory") would otherwise break.
    stdio: opts.inherit
      ? ["inherit", 2, "inherit"]
      : opts.show
        ? ["pipe", 2, "inherit"]
        : ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs,
  });
  counted(cmd, args, started);
  return {
    code: r.status ?? (r.error ? 127 : 1),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? (r.error ? String(r.error.message) : ""),
  };
}

/**
 * `run` without waiting for it (ADR 0051 B3): `spawn`, the same counting and the same rules for
 * its output, so independent writes can start together and each finish as itself. Resolves with
 * what `run` would have returned (124 at its timeout).
 */
export function runAsync(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs?: number;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      counted(cmd, args, started);
      resolve({
        code,
        stdout,
        stderr: stderr || (timedOut ? "timed out" : ""),
      });
    };
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(timedOut ? 124 : (code ?? 1)));
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.input ?? "");
  });
}

/**
 * Run a long command and hand each line of its output to `onLine` as it comes, so nothing is
 * buffered (an agent's run can write megabytes). Its stderr goes to ours. It runs in a process
 * group of its own: at the timeout, it and everything it started are stopped. Resolves with the
 * exit code (127 when it couldn't start, 124 at the timeout).
 */
export function stream(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** Start from PLAIN_ENV, not this process's environment (the sandbox's sudo, lib/sandbox.ts). */
    plain?: boolean;
    input?: string;
    /** On fd 3, a pipe it reads once (an agent's login off a box, kernel/place.ts). */
    fd3?: string;
    timeoutMs?: number;
    onLine: (line: string) => void;
    /** Stops it and its whole process group when aborted. */
    signal?: AbortSignal;
  },
): Promise<number> {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...(opts.plain ? PLAIN_ENV() : process.env), ...opts.env },
      stdio:
        opts.fd3 === undefined ? ["pipe", "pipe", "inherit"] : ["pipe", "pipe", "inherit", "pipe"],
      detached: true,
    });
    const stdin = child.stdin as Writable;
    const stdout = child.stdout as Readable;
    const fd3 = child.stdio[3] as Writable | undefined;
    const group = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {}
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          group("SIGTERM");
          setTimeout(() => group("SIGKILL"), 10_000).unref();
        }, opts.timeoutMs)
      : undefined;
    opts.signal?.addEventListener("abort", () => group("SIGKILL"), { once: true });
    const lines = createInterface({ input: stdout });
    lines.on("line", opts.onLine);
    let code: number | undefined;
    let closed = false;
    const done = () => {
      if (code === undefined || !closed) return;
      if (timer) clearTimeout(timer);
      resolve(timedOut ? 124 : code);
    };
    lines.on("close", () => {
      closed = true;
      done();
    });
    child.on("error", () => {
      code = 127;
      closed = true;
      done();
    });
    child.on("close", (c) => {
      code ??= c ?? 1;
      done();
    });
    stdin.on("error", () => {});
    stdin.end(opts.input ?? "");
    fd3?.on("error", () => {});
    fd3?.end(`${opts.fd3}\n`);
  });
}

export function has(cmd: string): boolean {
  return run("sh", ["-c", 'command -v "$0" >/dev/null 2>&1', cmd]).code === 0;
}

/**
 * Whether a project's Makefile has a rule for a target: a dry run that executes nothing. A name only
 * listed in .PHONY dry-runs as "Nothing to be done", which counts as missing.
 */
export function hasMakeTarget(dir: string, target: string): boolean {
  const r = run("make", ["-n", target], { cwd: dir, env: { LC_ALL: "C" } });
  return r.code === 0 && !`${r.stdout}${r.stderr}`.includes(`Nothing to be done for '${target}'`);
}
