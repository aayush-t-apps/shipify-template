// Where a think runs (ADR 0031): on a box, in the slot's sandbox (lib/sandbox.ts: its own Linux user,
// a fresh folder, keys on stdin, the login on fd 3); off a box (this PC, tests), in a plain folder as
// this user, the login on fd 3 too. Think works only through this, so both behave the same: give it
// files, run commands, stop everything, then take back what it left in out/.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { stream } from "../lib/exec.ts";
import { ShipError } from "../lib/output.ts";
import {
  type AgentRun,
  asAgent,
  checkAgentNames,
  type Given,
  give,
  killAll,
  linkTarget,
  listOut,
  OUT_MAX_BYTES,
  onBox,
  prepareRun,
  readOut,
  reopenRun,
} from "../lib/sandbox.ts";

export interface RunOpts {
  cwd: string;
  stdin?: string;
  minutes: number;
  onLine?: (line: string) => void;
  /** Exported before the command starts, never on a command line. */
  secrets?: Record<string, string>;
  /** The agent's login, on fd 3 (LOGIN_FD): a pipe it reads once, never in its environment. */
  login?: string;
  /** Names besides the place's own (HOME, TMPDIR, PATH). */
  env?: Record<string, string>;
  /** Folders put before the system's on PATH (the agent's own command's, from the box's tools). */
  path?: string[];
  /** Stops it, and everything it started, when aborted (your `stop`). */
  signal?: AbortSignal;
}

export interface Place {
  /**
   * The run's folder, and inside it: work/ (its clone), read/ (the repos it reads), in/ (what it
   * reads of yours), out/ (what it leaves), config/ (the agent's own settings and sessions) and
   * home/ (its HOME).
   */
  dir: string;
  home: string;
  work: string;
  read: string;
  in: string;
  out: string;
  config: string;
  run(argv: string[], opts: RunOpts): Promise<{ code: number; timedOut: boolean }>;
  /**
   * Files for it to read, by paths relative to the run's folder ("in/files/a.png"), or a link there
   * to a folder it may read (`{ link }`).
   */
  give(files: Record<string, Given>): void;
  /** Every process it left, stopped: true when none is left. Before anything is taken back. */
  stop(): boolean;
  /** The plain files it left in out/. */
  list(): string[];
  take(name: string, maxBytes?: number): Buffer | undefined;
}

/**
 * The place for this run: the slot's sandbox on a box, else a folder under `local`. Made fresh, or
 * with `reopen`, the one an earlier step of this job made, as it left it (ADR 0057: a stay carries
 * on in the agent's session there).
 */
export function placeFor(runId: string, local: string, reopen = false): Place {
  const box = onBox();
  if (box) return boxPlace(reopen ? reopenRun(box.slot, runId) : prepareRun(box.slot, runId));
  return localPlace(local, reopen);
}

/** The folder a command is in, on this process's PATH: for the agent's own command (think). */
export function binDir(cmd: string): string | undefined {
  if (isAbsolute(cmd)) return dirname(cmd);
  for (const d of (process.env.PATH ?? "").split(":")) if (d && existsSync(join(d, cmd))) return d;
  return undefined;
}

function boxPlace(r: AgentRun): Place {
  return {
    dir: r.dir,
    home: r.home,
    work: r.work,
    read: r.read,
    in: r.in,
    out: r.out,
    config: r.config,
    run(argv, o) {
      // The system's PATH (its Node and pnpm), plus only the folders asked for: never the runner's.
      const path = [...(o.path ?? []), "/usr/local/bin", "/usr/bin", "/bin"].join(":");
      o.signal?.addEventListener("abort", () => killAll(r.slot), { once: true });
      return asAgent(r.slot, argv, {
        cwd: o.cwd,
        ...(o.stdin !== undefined ? { stdin: o.stdin } : {}),
        env: { ...r.env, PATH: path, ...(o.env ?? {}) },
        secrets: o.secrets ?? {},
        ...(o.login !== undefined ? { login: o.login } : {}),
        timeoutMs: o.minutes * 60_000,
        ...(o.onLine ? { onLine: o.onLine } : {}),
      });
    },
    give: (files) => give(r, files),
    stop: () => killAll(r.slot),
    list: () => listOut(r),
    take: (name, max = OUT_MAX_BYTES) => readOut(r, name, max),
  };
}

function localPlace(dir: string, reopen = false): Place {
  if (reopen && !existsSync(join(dir, "config")))
    throw new ShipError("this run's folder isn't there to carry on in.");
  if (!reopen) rmSync(dir, { recursive: true, force: true });
  const at = (d: string) => join(dir, d);
  for (const d of ["home", "config", "tmp", "work", "read", "in", "out"])
    mkdirSync(at(d), { recursive: true, mode: 0o700 });
  const env = { HOME: at("home"), TMPDIR: at("tmp") };
  return {
    dir,
    home: at("home"),
    work: at("work"),
    read: at("read"),
    in: at("in"),
    out: at("out"),
    config: at("config"),
    async run(argv, o) {
      const [cmd, ...rest] = argv as [string, ...string[]];
      checkAgentNames(o.env ?? {}, o.secrets ?? {}, o.login);
      let timedOut = false;
      const code = await stream(cmd, rest, {
        cwd: o.cwd,
        env: { ...env, ...(o.env ?? {}), ...(o.secrets ?? {}) },
        ...(o.stdin !== undefined ? { input: o.stdin } : {}),
        ...(o.login !== undefined ? { fd3: o.login } : {}),
        timeoutMs: o.minutes * 60_000,
        onLine: o.onLine ?? (() => {}),
        ...(o.signal ? { signal: o.signal } : {}),
      }).catch(() => 1);
      if (code === 124) timedOut = true;
      return { code, timedOut };
    },
    give(files) {
      for (const [rel, body] of Object.entries(files)) {
        const n = normalize(rel);
        if (isAbsolute(n) || n.split("/").includes(".."))
          throw new ShipError(`"${rel}" isn't a path inside the run's folder.`, "blocked");
        mkdirSync(dirname(join(dir, n)), { recursive: true });
        if (typeof body === "object" && !Buffer.isBuffer(body)) {
          rmSync(join(dir, n), { recursive: true, force: true });
          symlinkSync(linkTarget(body), join(dir, n));
        } else writeFileSync(join(dir, n), body);
      }
    },
    stop: () => true,
    list: () =>
      existsSync(at("out"))
        ? readdirSync(at("out")).filter((f) => lstatSync(join(at("out"), f)).isFile())
        : [],
    take(name, max = OUT_MAX_BYTES) {
      const f = join(at("out"), name);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || !existsSync(f)) return undefined;
      const st = lstatSync(f);
      return st.isFile() && st.size <= max ? readFileSync(f) : undefined;
    },
  };
}
