import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

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
  return {
    code: r.status ?? (r.error ? 127 : 1),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? (r.error ? String(r.error.message) : ""),
  };
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
      stdio: ["pipe", "pipe", "inherit"],
      detached: true,
    });
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
    const lines = createInterface({ input: child.stdout });
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
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
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
