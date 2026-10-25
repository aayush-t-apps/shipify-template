// The agent's sandbox (ADR 0031, box setup 5, docs/box-setup.md): on a box, each slot's agent runs
// as a Linux user of its own, `shipify-agent-<k>`, which can't read the runner's folders, its
// environment or another slot's runs. The runner (the user "shipify") starts it through one sudo
// rule (/etc/sudoers.d/shipify-agents), as that user and no one else.
//
// Each run gets a fresh folder of the agent's own, /srv/shipify-agent-<k>/run-<id>/:
//   home/    HOME          config/  the agent's settings and sessions (its adapter's env)     tmp/  TMPDIR
//   work/    the agent's own clone (never a worktree of the runner's)
//   in/      what the agent reads: the prompt, files, the playbook and skills (give())
//   out/     what the runner takes back: the result, files, the bundle (readOut(), after killAll)
// Beside the runs, the slot's caches (KEPT): what a run downloads (packages, a test browser) is
// there for the slot's next run. The lab (box setup 8, ADR 0064): the agent's containers are its
// own rootless Podman's, its store in data/containers and its state while it runs in runtime/, both
// by paths that never change, as Podman records them at its first use; runtime/ is emptied at each
// run's start, so to Podman each run starts as after a restart.
// The slot's folder is the agent's, with group shipify and setgid (2710): the runner can pass
// through to a run's out/ (2750), and no other user, another slot's agent included, can enter it.
// Below a run's folder only out/ keeps that group: the rest is the agent's alone (prepareRun).
//
// Nothing secret goes on a command line or into the agent's environment by accident: every command
// starts from an empty environment (`env -i`) with only the names given, and secrets (a read-only
// token, the tools' look keys) reach it on stdin, ahead of its own input. The agent's login comes
// that way too, and goes on fd 3, a pipe it reads once: never in its environment, where every
// command it runs could read it. Write tokens, the run's OIDC request, the workflow's token and any
// channel or door key are refused outright.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { stream } from "./exec.ts";
import { ShipError } from "./output.ts";
import { LOGIN_FD } from "./plugins/agent.ts";

/** The runner label setup 5 adds once the sandbox checks out: run jobs go only to such a slot. */
export const SANDBOX_LABEL = "sandbox";
/** Where the slots' folders are. */
export const AGENT_ROOT = "/srv";
/**
 * The slot's folders kept across its runs, beside them in its folder: tools' caches and data
 * (through the agent's ~/.cache and ~/.local/share), a test browser among them. Never a run's work
 * or files; the weekly clean-up trims what hasn't been used in a while.
 */
export const KEPT = ["cache", "data"];
/** Podman's settings for the agents' users alone (box setup 8, ADR 0064), named in each command. */
export const CONTAINERS_CONF = "/etc/containers/shipify-agents.conf";
/** A run's folder older than this is left over: longer than any job (task.yml's limit, tested). */
export const STALE_RUN_MS = 8 * 60 * 60_000;
/** The biggest file readOut takes back. */
export const OUT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SLOT = 9;

/** What each agent command starts with, besides the names its caller gives. */
const AGENT_PATH = "/usr/local/bin:/usr/bin:/bin";
/** The environment `sudo` itself starts with: nothing of this process's (sudo resets it anyway). */
export const SPAWN_ENV: Readonly<Record<string, string>> = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LANG: "C.UTF-8",
};

/** Slot k's agent user. */
export function agentUser(slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOT)
    throw new ShipError(`A slot is a number from 1 to ${MAX_SLOT}, not ${slot}.`, "blocked");
  return `shipify-agent-${slot}`;
}

/** Slot k's folder: its runs, each in run-<id>. */
export const slotRoot = (slot: number, root = AGENT_ROOT) => join(root, agentUser(slot));

/**
 * The names Podman needs as slot k's agent (ADR 0064), the same at every run: its store under the
 * slot's data/ (by its real path, the folder a run's ~/.local/share links to), its state while it
 * runs in the slot's runtime/, and the agents' own settings. And a HOME that is there: Podman stops
 * at once without one ("cannot resolve /nonexistent"), so the box's own Podman commands (a run's
 * start, cleanRuns, the weekly prune, doctor) get the slot's folder, the agent's home in
 * /etc/passwd; Podman writes nothing in it. A run's own home takes its place in a run (runPaths).
 */
export function containerEnv(slot: number, root = AGENT_ROOT): Record<string, string> {
  return {
    HOME: slotRoot(slot, root),
    XDG_DATA_HOME: join(slotRoot(slot, root), "data"),
    XDG_RUNTIME_DIR: join(slotRoot(slot, root), "runtime"),
    CONTAINERS_CONF_OVERRIDE: CONTAINERS_CONF,
  };
}

/**
 * Which slot of a box a runner is (ADR 0020): 1 for the runner named after the box, k for
 * `<box>-<k>`, else 0. In a job, the runner's name and its box come from the runner (RUNNER_NAME)
 * and the slot's `.env` (SHIPIFY_BOX).
 */
export function slotOf(
  runner: string | undefined = process.env.RUNNER_NAME,
  box: string | undefined = process.env.SHIPIFY_BOX,
): number {
  if (!runner || !box) return 0;
  if (runner === box) return 1;
  if (!runner.startsWith(`${box}-`)) return 0;
  const rest = runner.slice(box.length + 1);
  const k = /^\d+$/.test(rest) ? Number(rest) : 0;
  return k >= 2 && k <= MAX_SLOT ? k : 0;
}

/** The slots with a sandbox on this machine: their folders in /srv. None on a PC or in tests. */
export function sandboxSlots(root = AGENT_ROOT): number[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((d) => Number(/^shipify-agent-(\d)$/.exec(d)?.[1] ?? 0))
    .filter((k) => k >= 1)
    .sort((a, b) => a - b);
}

/**
 * Where this run's agent runs: `{ slot }` on a box with setup 5, undefined elsewhere (this PC, and
 * tests), where the core may run its agent as the current user. A job on a box without a sandbox
 * for its slot never falls back to that: it stops here, saying how to set the box up.
 */
export function onBox(
  env: NodeJS.ProcessEnv = process.env,
  root = AGENT_ROOT,
): { slot: number } | undefined {
  const inJob = env.GITHUB_ACTIONS === "true";
  const box = env.SHIPIFY_BOX;
  const selfHosted = env.RUNNER_ENVIRONMENT === "self-hosted" || Boolean(box);
  if (!inJob || !selfHosted) return undefined;
  const slot = slotOf(env.RUNNER_NAME, box);
  if (slot > 0 && existsSync(slotRoot(slot, root))) return { slot };
  throw new ShipError(
    `This box has no sandbox for its runner "${env.RUNNER_NAME ?? "?"}" (box setup 5), so no agent runs here. When no task runs: on the box, its here.sh command again; or from a PC, pnpm ship box add <its SSH address> --manage (it asks for sudo once).`,
    "blocked",
  );
}

// ---------------------------------------------------------------- running a command as the agent

export interface SandboxIo {
  /** A short command, waited for. */
  run(
    cmd: string,
    args: string[],
    opts: {
      cwd: string;
      env: Readonly<Record<string, string>>;
      input?: string;
      timeoutMs?: number;
    },
  ): { code: number; stdout: string; stderr: string; timedOut?: boolean };
  /** A long one: each line of its output handed over as it comes; its stderr goes to ours. */
  stream(
    cmd: string,
    args: string[],
    opts: {
      cwd: string;
      env: Readonly<Record<string, string>>;
      input?: string;
      onLine: (line: string) => void;
    },
  ): Promise<number>;
  sleep(ms: number): void;
  /** Where the slots' folders are (/srv). */
  root: string;
}

/** The machine itself: sudo, with nothing of this process's environment. */
export const REAL_IO: SandboxIo = {
  run(cmd, args, opts) {
    const r = spawnSync(cmd, args, {
      cwd: opts.cwd,
      env: { ...opts.env },
      input: opts.input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: opts.timeoutMs,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    return {
      code: r.status ?? (r.error ? 127 : 1),
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? (r.error ? String(r.error.message) : ""),
      timedOut,
    };
  },
  stream: (cmd, args, opts) =>
    stream(cmd, args, {
      cwd: opts.cwd,
      env: { ...opts.env },
      plain: true,
      input: opts.input,
      onLine: opts.onLine,
    }),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  root: AGENT_ROOT,
};

/**
 * Never in an agent's environment, whatever a caller passes: the run's OIDC request and runtime
 * tokens, the workflow's own token and the runner's command files, the runner's folders, a tool's
 * write key, the door's, send and bot keys, the issues token, a deploy key, and the loader's
 * settings.
 */
const NEVER: RegExp[] = [
  /^ACTIONS_/,
  // GitHub's own, but for your Shipify repo's name: the agent's `ship` calls read it (ADR 0047).
  /^GITHUB_(?!REPOSITORY$)/,
  /^RUNNER_/,
  /_WRITE$/,
  /^SHIPIFY_(SEND|DOOR|BOT)_/,
  /SEND_KEY|DOOR_KEY/,
  /^SHIPIFY_ISSUES_TOKEN$/,
  /DEPLOY/,
  /^SSH_AUTH_SOCK$/,
  /^LD_/,
];
/** A secret goes on stdin (`secrets`), never as an environment name a command line shows. */
const SECRETISH = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|^GH_/i;
/** Where to read a secret, not one: a file descriptor's number (CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3). */
const WHERE = /_FILE_DESCRIPTOR$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * What an agent may be handed, wherever it runs: a box's sandbox and a folder off a box (tests, this
 * PC) check the same names, so a test sees what a box would refuse.
 */
export function checkAgentNames(
  env: Record<string, string>,
  secrets: Record<string, string>,
  login?: string,
) {
  checkNames("env", env);
  checkNames("secrets", { ...secrets, ...(login !== undefined ? { LOGIN: login } : {}) });
}

function checkNames(kind: "env" | "secrets", vars: Record<string, string>) {
  for (const [name, value] of Object.entries(vars)) {
    if (!NAME.test(name)) throw new ShipError(`"${name}" isn't a variable name.`, "blocked");
    if (NEVER.some((re) => re.test(name)))
      throw new ShipError(`${name} never reaches an agent (the sandbox refuses it).`, "blocked");
    if (kind === "env" && SECRETISH.test(name) && !(WHERE.test(name) && /^\d$/.test(value)))
      throw new ShipError(
        `${name} looks like a secret: pass it in secrets, which never show on a command line.`,
        "blocked",
      );
    if (value.includes("\0") || (kind === "secrets" && /[\r\n]/.test(value)))
      throw new ShipError(`${name}'s value can't be passed to an agent as it is.`, "blocked");
  }
}

/**
 * What runs as the agent, after `env -i` and the names given: it sets a umask that lets the runner
 * (group shipify) read what goes into out/, enters its folder, exports the secrets read from the
 * first lines of stdin (never a command line), puts the login from the next line on fd 3 (dash
 * makes a here-document a pipe: the command reads it once, and it's in no environment), and hands
 * the rest of stdin to the command.
 *   $1 the folder   $2 how many secret lines   $3 1 when a login line follows   then the command
 */
const WRAP = [
  "umask 027",
  'cd -- "$1" || exit 126',
  'n=$2; l=$3; shift 3; while [ "$n" -gt 0 ]; do IFS= read -r kv || exit 125; export "$kv"; n=$((n - 1)); done',
  `if [ "$l" = 1 ]; then IFS= read -r v || exit 125; exec ${LOGIN_FD}<<EOF`,
  "$v",
  "EOF",
  "fi",
  'exec "$@"',
].join("\n");

/**
 * sudo's arguments for one command as slot k's agent, and what goes first on stdin: the secret
 * lines, then the login's.
 */
export function sudoArgs(
  slot: number,
  argv: string[],
  opts: {
    cwd: string;
    env?: Record<string, string>;
    secrets?: Record<string, string>;
    login?: string;
  },
): { args: string[]; head: string } {
  if (!argv.length || !argv[0]) throw new ShipError("Nothing to run as the agent.", "blocked");
  if (!opts.cwd.startsWith("/"))
    throw new ShipError(`The agent's folder must be absolute: ${opts.cwd}`, "blocked");
  const user = agentUser(slot);
  const env = opts.env ?? {};
  const secrets = opts.secrets ?? {};
  checkAgentNames(env, secrets, opts.login);
  const base: Record<string, string> = {
    PATH: AGENT_PATH,
    HOME: "/nonexistent",
    USER: user,
    LOGNAME: user,
    LANG: "C.UTF-8",
    ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
  };
  const all = { ...base, ...env };
  const names = Object.keys(secrets);
  return {
    args: [
      "-n",
      "-u",
      user,
      "--",
      "/usr/bin/env",
      "-i",
      ...Object.entries(all).map(([k, v]) => `${k}=${v}`),
      "/bin/sh",
      "-c",
      WRAP,
      "shipify-agent",
      opts.cwd,
      String(names.length),
      opts.login !== undefined ? "1" : "0",
      ...argv,
    ],
    head: [
      ...names.map((k) => `${k}=${secrets[k]}\n`),
      ...(opts.login !== undefined ? [`${opts.login}\n`] : []),
    ].join(""),
  };
}

export interface AgentOpts {
  /** Where it runs: a folder of the agent's (a run's work/, usually). */
  cwd: string;
  stdin?: string;
  /** The names it gets besides PATH, HOME, USER, LANG and TZ: a run's `env` (prepareRun), and more. */
  env?: Record<string, string>;
  /** On stdin, ahead of `stdin`, exported before the command starts: never on a command line. */
  secrets?: Record<string, string>;
  /** The agent's login: on stdin after the secrets, then on fd 3 (LOGIN_FD), never exported. */
  login?: string;
  /** At the limit, every process of the agent's is killed (killAll) and it ends with 124. */
  timeoutMs: number;
  /** Each line of its output as it comes; without it, the output goes nowhere. */
  onLine?: (line: string) => void;
}

/** One command as slot k's agent (`sudo -n -u shipify-agent-<k> --`), from an empty environment. */
export async function asAgent(
  slot: number,
  argv: string[],
  opts: AgentOpts,
  io: SandboxIo = REAL_IO,
): Promise<{ code: number; timedOut: boolean }> {
  const { args, head } = sudoArgs(slot, argv, opts);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killAll(slot, io);
  }, opts.timeoutMs);
  try {
    const code = await io.stream("sudo", args, {
      cwd: "/",
      env: SPAWN_ENV,
      input: `${head}${opts.stdin ?? ""}`,
      onLine: opts.onLine ?? (() => {}),
    });
    return { code: timedOut ? 124 : code, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/** A short command as the agent, waited for (the sandbox's own: kill, clean, check). */
export function asAgentNow(
  slot: number,
  argv: string[],
  opts: {
    cwd: string;
    input?: string;
    login?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  },
  io: SandboxIo = REAL_IO,
): { code: number; stdout: string; stderr: string } {
  const { args, head } = sudoArgs(slot, argv, {
    cwd: opts.cwd,
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.login !== undefined ? { login: opts.login } : {}),
  });
  const r = io.run("sudo", args, {
    cwd: "/",
    env: SPAWN_ENV,
    input: head ? `${head}${opts.input ?? ""}` : opts.input,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });
  if (r.timedOut) killAll(slot, io);
  return { code: r.timedOut ? 124 : r.code, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Exits 0 while a process of the agent ($1) runs, or of an ID in its range (/etc/subuid: its
 * containers' users, ADR 0064), 1 when none does, 2 when it can't tell: one read of the process
 * list, as the runner.
 */
const LEFT = String.raw`u=$(id -u -- "$1") || exit 2
r=$(awk -F: -v n="$1" -v u="$u" '$1 == n || $1 == u { print $2, $3; exit }' /etc/subuid 2>/dev/null)
uids=$(ps -A -o uid=) || exit 2
printf '%s\n' "$uids" | awk -v u="$u" -v r="$r" 'BEGIN { split(r, a, " ") }
  $1 == u || (a[2] > 0 && $1 >= a[1] && $1 < a[1] + a[2]) { f = 1 } END { exit f ? 0 : 1 }'`;

/**
 * Every process of slot k's agent, killed (`kill -KILL -1` as the agent), and checked gone: after a
 * think, at a time limit, and before a run starts. The kill reaches its containers too: the agent
 * owns their user namespace. True when none is left, of the agent or its range; false when sudo
 * refused or one survived, and then nothing that holds a key may start.
 */
export function killAll(slot: number, io: SandboxIo = REAL_IO): boolean {
  const user = agentUser(slot);
  for (let tries = 0; tries < 5; tries++) {
    const k = io.run("sudo", ["-n", "-u", user, "--", "kill", "-KILL", "-1"], {
      cwd: "/",
      env: SPAWN_ENV,
      timeoutMs: 30_000,
    });
    // "No such process" is the usual answer: there was nothing to kill.
    if (k.code !== 0 && /^sudo:/m.test(k.stderr)) return false;
    const left = io.run("/bin/sh", ["-c", LEFT, "left", user], {
      cwd: "/",
      env: SPAWN_ENV,
      timeoutMs: 30_000,
    });
    if (left.code === 1) return true;
    if (left.code !== 0) return false;
    io.sleep(200);
  }
  return false;
}

/**
 * Removes each run folder (and all in it) the agent may have made read-only, as the agent. What a
 * container wrote under its own IDs (a bind mount) plain rm can't remove: `podman unshare` can,
 * where the agent is root over its range (ADR 0064). A folder still there fails it.
 */
const RM = `s=0
for d do
  chmod -R u+rwX -- "$d" 2>/dev/null
  rm -rf -- "$d" 2>/dev/null || podman unshare rm -rf -- "$d" 2>/dev/null || rm -rf -- "$d"
  if [ -e "$d" ]; then s=1; else echo gone; fi
done
exit $s`;

/**
 * Slot k's run folders older than `olderThanMs` (0: all of them), removed as the agent, who owns
 * everything in them. Before a run (a slot runs one job at a time, so its earlier runs are over),
 * when a task closes and in each box's weekly clean-up (older than STALE_RUN_MS).
 */
export function cleanRuns(
  slot: number,
  olderThanMs: number,
  io: SandboxIo = REAL_IO,
): { ok: boolean; removed: number; error?: string } {
  const dir = slotRoot(slot, io.root);
  if (!existsSync(dir)) return { ok: true, removed: 0 };
  const age = olderThanMs > 0 ? ["-mmin", `+${Math.floor(olderThanMs / 60_000)}`] : [];
  const r = asAgentNow(
    slot,
    [
      "find",
      ".",
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-name",
      "run-*",
      ...age,
      "-exec",
      "/bin/sh",
      "-c",
      RM,
      "sh",
      "{}",
      "+",
    ],
    { cwd: dir, timeoutMs: 10 * 60_000, env: containerEnv(slot, io.root) },
    io,
  );
  const removed = r.stdout.split("\n").filter((l) => l === "gone").length;
  return r.code === 0
    ? { ok: true, removed }
    : { ok: false, removed, error: r.stderr.trim().split("\n")[0] || `exit ${r.code}` };
}

/** Every slot's leftover runs on this machine (nothing where there's no sandbox): how many went. */
export function cleanStaleRuns(
  olderThanMs = STALE_RUN_MS,
  io: SandboxIo = REAL_IO,
): { removed: number; failed: string[] } {
  let removed = 0;
  const failed: string[] = [];
  for (const slot of sandboxSlots(io.root)) {
    const r = cleanRuns(slot, olderThanMs, io);
    removed += r.removed;
    if (!r.ok) failed.push(`${agentUser(slot)}: ${r.error}`);
    // The kept caches, trimmed: what no run has read in 30 days goes (a tool fetches it again).
    // Never inside the containers' store, where a deleted file breaks an image: Podman prunes it
    // (pruneContainers).
    const inStore = '! -path "data/containers/*"';
    asAgentNow(
      slot,
      [
        "/bin/sh",
        "-c",
        `for d in ${KEPT.join(" ")}; do [ -d "$d" ] && find "$d" -type f -atime +30 ${inStore} -delete 2>/dev/null; [ -d "$d" ] && find "$d" -mindepth 1 -type d -empty ! -path "data/containers" ${inStore} -delete 2>/dev/null; done; true`,
      ],
      { cwd: slotRoot(slot, io.root), timeoutMs: 10 * 60_000 },
      io,
    );
  }
  return { removed, failed };
}

/**
 * Shell functions for Podman's state in a slot (ADR 0064), run as its agent in its folder with
 * containerEnv. `wipe` empties runtime/, Podman's state while it runs (it wants it wiped at each
 * restart); what plain rm can't remove goes through `podman unshare`, whose pause process is then
 * stopped. `fresh`, at a run's start: wipe, and when Podman left state there, one prune of the
 * earlier runs' containers, pods, volumes and networks (the images stay), the pause process that
 * starts stopped, and runtime/ wiped again: a run starts with nothing of the agent's running and
 * runtime/ empty, so a run that uses no container leaves nothing to do. Each says "podman" when it
 * ran Podman. `kill -KILL -1` spares only the shell itself: nothing else of the agent's runs then.
 */
const PODMAN_STATE = String.raw`wipe() {
  chmod -R u+rwX runtime 2>/dev/null; rm -rf runtime 2>/dev/null
  if [ -e runtime ] && command -v podman >/dev/null; then
    echo podman; podman unshare rm -rf -- "$PWD/runtime" >/dev/null 2>&1; kill -KILL -1 2>/dev/null
  fi
  mkdir -p -m 700 runtime
}
fresh() {
  mkdir -p -m 700 runtime
  [ -n "$(ls -A runtime)" ] || return 0
  used=; [ -d runtime/libpod ] && command -v podman >/dev/null && used=1
  wipe
  [ -n "$used" ] || return 0
  echo podman
  podman system prune --force --volumes >/dev/null 2>&1
  kill -KILL -1 2>/dev/null
  wipe
}`;

/**
 * Each slot's containers' store, pruned as its agent (ADR 0064), in the weekly clean-up while no
 * other slot runs: every image (no container outlives a run), then what an unclean stop (a power
 * cut) left in the store, so a slot holds at most a week of images. Only where a slot has a store.
 */
export function pruneContainers(io: SandboxIo = REAL_IO): { pruned: number; failed: string[] } {
  let pruned = 0;
  const failed: string[] = [];
  const script = [
    PODMAN_STATE,
    "[ -d data/containers ] && command -v podman >/dev/null || exit 0",
    "wipe >/dev/null",
    "podman system prune --all --force --volumes >/dev/null || exit 1",
    "podman system prune --external --force >/dev/null || exit 1",
    "kill -KILL -1 2>/dev/null",
    "wipe >/dev/null",
    "echo pruned",
  ].join("\n");
  for (const slot of sandboxSlots(io.root)) {
    const r = asAgentNow(
      slot,
      ["/bin/sh", "-c", script, "prune"],
      { cwd: slotRoot(slot, io.root), timeoutMs: 10 * 60_000, env: containerEnv(slot, io.root) },
      io,
    );
    if (r.code !== 0)
      failed.push(`${agentUser(slot)}: ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}`);
    else if (r.stdout.split("\n").includes("pruned")) pruned++;
  }
  return { pruned, failed };
}

// ---------------------------------------------------------------- a run's folder

export interface AgentRun {
  slot: number;
  user: string;
  id: string;
  dir: string;
  home: string;
  config: string;
  tmp: string;
  work: string;
  /** The repos it reads (ADR 0044), beside work/ so a read never lands in a change's clone. */
  read: string;
  in: string;
  out: string;
  /** HOME, TMPDIR, the XDG folders and Podman's settings (containerEnv): give it to asAgent. */
  env: Record<string, string>;
}

/** A run's folders, without making them. */
export function runPaths(slot: number, runId: string, root = AGENT_ROOT): AgentRun {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId))
    throw new ShipError(`"${runId}" isn't a run id.`, "blocked");
  const dir = join(slotRoot(slot, root), `run-${runId}`);
  const at = (d: string) => join(dir, d);
  const home = at("home");
  return {
    slot,
    user: agentUser(slot),
    id: runId,
    dir,
    home,
    config: at("config"),
    tmp: at("tmp"),
    work: at("work"),
    read: at("read"),
    in: at("in"),
    out: at("out"),
    env: {
      ...containerEnv(slot, root),
      HOME: home,
      TMPDIR: at("tmp"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
    },
  };
}

/**
 * Makes the run's folder (0710, group shipify), as the agent: home, config, tmp, work, read and in
 * only its own (0700, its group too), and out/ the runner's to read (2750, group shipify, the only
 * folder that passes that group on). Any process left of the slot's agent is killed
 * first, its earlier runs removed, and what they left of Podman's (ADR 0064) too. Once per job.
 */
export function prepareRun(slot: number, runId: string, io: SandboxIo = REAL_IO): AgentRun {
  const run = runPaths(slot, runId, io.root);
  const stopped = () => {
    if (!killAll(slot, io))
      throw new ShipError(
        `Couldn't stop what ${run.user} left running (sudo -n refused, or a process survived): ship doctor's sandbox check says which.`,
      );
  };
  stopped();
  const cleaned = cleanRuns(slot, 0, io);
  if (!cleaned.ok)
    throw new ShipError(`Couldn't remove ${run.user}'s earlier runs: ${cleaned.error}`);
  // To Podman, a run starts as after a restart (fresh, never a reason to stop the run); then a
  // fresh run folder each time, but the slot's caches kept across its runs (KEPT): the agent's
  // ~/.cache and ~/.local/share are links to them, so packages, a project's toolchain and a test
  // browser download once per slot, not once per run. Only this slot's agent can reach them.
  const script = [
    PODMAN_STATE,
    "fresh",
    "set -e",
    `mkdir -p -m 700 -- ${KEPT.join(" ")}`,
    // Not the slot folder's setgid, which mkdir passes on: its group (shipify) has no ID in the
    // agent's user namespace, so Podman's store in data/ couldn't mount (setups 8 and 9).
    `chmod g-s -- ${KEPT.join(" ")}`,
    'mkdir -m 2710 -- "$1"',
    'cd -- "$1"',
    "mkdir -m 2750 out",
    // Then nothing else takes the runner's group, which has no ID in the agent's user namespace:
    // with it, a container couldn't chown a bind mount (a database's image does at its start), nor
    // `podman unshare` remove what one wrote.
    "chmod g-s .",
    "mkdir -m 700 home config tmp work read in",
    "mkdir -m 700 home/.local",
    "ln -s ../../cache home/.cache",
    "ln -s ../../../data home/.local/share",
  ].join("\n");
  const r = asAgentNow(
    slot,
    ["/bin/sh", "-c", script, "prepare", run.dir],
    { cwd: slotRoot(slot, io.root), env: containerEnv(slot, io.root) },
    io,
  );
  if (r.code !== 0)
    throw new ShipError(
      `Couldn't make ${run.user}'s run folder: ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}`,
    );
  // Podman ran: its pause process was stopped in there; checked here, as before any run.
  if (r.stdout.split("\n").includes("podman")) stopped();
  return run;
}

/**
 * The run's folder as an earlier step of this job made it (ADR 0057: a run that stays resumes its
 * agent's session there): nothing removed, nothing made. Its folder must be there.
 */
export function reopenRun(slot: number, runId: string, io: SandboxIo = REAL_IO): AgentRun {
  const run = runPaths(slot, runId, io.root);
  const r = asAgentNow(
    slot,
    ["/bin/sh", "-c", 'test -d "$1/config"', "reopen", run.dir],
    {
      cwd: slotRoot(slot, io.root),
    },
    io,
  );
  if (r.code !== 0)
    throw new ShipError(`${run.user}'s run folder for this run isn't there to carry on in.`);
  return run;
}

/** A path inside a run's folder, from a relative one: never absolute, never `..`. */
function inside(run: AgentRun, rel: string): string {
  const n = normalize(rel);
  if (!rel || n.startsWith("/") || n === "." || n.split("/").includes(".."))
    throw new ShipError(`"${rel}" isn't a path inside the run's folder.`, "blocked");
  return join(run.dir, n);
}

/** What the agent is given at a path: a file's content, or a link to a folder it may read. */
export type Given = string | Buffer | { link: string };

/** A link's target: an absolute path, as the core names one (Shipify's skills in its copy). */
export function linkTarget(given: { link: string }): string {
  if (!isAbsolute(given.link) || normalize(given.link) !== given.link)
    throw new ShipError(`"${given.link}" isn't a folder to link to.`, "blocked");
  return given.link;
}

/**
 * Files for the agent to read, written as the agent (so the runner never writes into a folder the
 * agent controls): `{ "in/prompt.md": text, "in/skills/x/SKILL.md": bytes }`, paths relative to
 * the run's folder. A `{ link }` makes a link there to a folder it may read, in place of whatever
 * was at that path (Shipify's skills, where an agent reads its own). One sudo call, the content on
 * stdin.
 */
export function give(run: AgentRun, files: Record<string, Given>, io: SandboxIo = REAL_IO): void {
  const list = Object.entries(files).map(([rel, body]) => {
    const at = inside(run, rel).slice(run.dir.length + 1);
    return typeof body === "object" && !Buffer.isBuffer(body)
      ? [at, "", linkTarget(body)]
      : [at, Buffer.from(body).toString("base64")];
  });
  if (!list.length) return;
  // Runs as the agent, in the run's folder: every path was checked above, and is checked again.
  const script = [
    'const fs = require("fs"), path = require("path");',
    'const files = JSON.parse(fs.readFileSync(0, "utf8"));',
    "for (const [rel, b64, link] of files) {",
    '  if (path.isAbsolute(rel) || rel.split("/").includes("..")) process.exit(3);',
    "  fs.mkdirSync(path.dirname(rel), { recursive: true, mode: 0o700 });",
    "  if (link) {",
    "    fs.rmSync(rel, { recursive: true, force: true });",
    "    fs.symlinkSync(link, rel);",
    '  } else fs.writeFileSync(rel, Buffer.from(b64, "base64"), { mode: 0o600 });',
    "}",
  ].join("\n");
  const r = asAgentNow(
    run.slot,
    ["/usr/local/bin/node", "-e", script],
    { cwd: run.dir, input: JSON.stringify(list) },
    io,
  );
  if (r.code !== 0)
    throw new ShipError(
      `Couldn't give ${run.user} its files: ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}`,
    );
}

/** The regular files the agent left in out/ (no links, folders or pipes). */
export function listOut(run: AgentRun): string[] {
  if (!sameDir(run.out)) return [];
  return readdirSync(run.out, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

/** True when a folder is where it says, with no link on the way (the agent can't redirect it). */
function sameDir(dir: string): boolean {
  try {
    return realpathSync(dir) === dir;
  } catch {
    return false;
  }
}

/**
 * One file the agent left in out/, by its plain name, or undefined: never through a link (out/
 * itself included), never a pipe or a folder, and never more than `maxBytes`. Call it after
 * killAll, so nothing of the agent's can swap the file meanwhile.
 */
export function readOut(run: AgentRun, name: string, maxBytes = OUT_MAX_BYTES): Buffer | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return undefined;
  if (!sameDir(run.out)) return undefined;
  let fd: number;
  try {
    fd = openSync(
      join(run.out, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return undefined;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return undefined;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------- the check (ship doctor)

/** Exits 0 only when the agent could read the path: a folder's list, or a file's first byte. */
const PROBE = 'if [ -d "$1" ]; then ls -A -- "$1"; else head -c 1 -- "$1"; fi >/dev/null 2>&1';
/**
 * On WSL, what of Windows the agent can reach, a line each (nothing elsewhere): Windows programs
 * (interop: one runs as you in Windows, outside every Linux wall), and each Windows drive it can
 * open, wherever it's mounted. box/setup.sh checks the same; /etc/wsl.conf closes both.
 */
const WINDOWS_PROBE = String.raw`for f in /proc/sys/fs/binfmt_misc/WSLInterop*; do
  if [ "$(head -n 1 "$f" 2>/dev/null)" = enabled ]; then echo "Windows programs (interop)"; break; fi
done
for d in $(awk '$1 ~ /^[A-Za-z]:(\\134)?$/ {print $2}' /proc/mounts); do
  (cd -- "$d" || ls -A -- "$d") >/dev/null 2>&1 && echo "$d"
done
true`;

/**
 * Each root container socket the agent could write to, a line each (ADR 0064): Docker's, and Podman's
 * root one (box setup turns it off). Either, or the docker group, would give an agent the box.
 */
const SOCKETS_PROBE =
  'for s in /run/docker.sock /run/podman/podman.sock; do [ -w "$s" ] && echo "$s"; done; true';

/**
 * What a command of the agent's finds of a dummy login handed over as a run's is (on fd 3), with the
 * same dummy on its stdin to compare, a word for each wall that holds: fd 3 is a pipe, it holds the
 * login, a second read gets nothing, and it's in no environment. Then whether the kernel keeps a
 * command from reading the agent's memory, where its login is: Yama's ptrace_scope (1, Ubuntu's own,
 * lets a process read only its children's).
 */
const LOGIN_PROBE = String.raw`IFS= read -r want
[ -p /dev/fd/${LOGIN_FD} ] && echo pipe
[ "$(cat <&${LOGIN_FD})" = "$want" ] && echo read
[ -z "$(cat <&${LOGIN_FD})" ] && echo once
env | grep -qF -- "$want" || echo unseen
echo "ptrace $(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null)"`;

/** Each word the login probe says when its wall holds, and what's wrong when it doesn't. */
const LOGIN_WALLS: [string, string][] = [
  ["pipe", "isn't on a pipe"],
  ["read", "doesn't reach it on fd 3"],
  ["once", "can be read twice"],
  ["unseen", "is in its environment"],
];

/**
 * What's wrong with the sandbox of these slots, as the runner sees it (empty when nothing):
 * each agent user exists, sudo starts it without a password, and it can't read the runner's
 * home, its jobs' folder, another slot's runs, or a runner process's environment; on WSL, nor
 * reach Windows (its drives, its programs); nor write to a root container socket. A dummy login,
 * handed over as a run's is, reaches it on a pipe it reads once and in no environment, and its
 * commands can't read its memory.
 */
export function sandboxProblems(
  slots: number[],
  walls: { home: string; work: string; pid: number },
  io: SandboxIo = REAL_IO,
): string[] {
  const problems: string[] = [];
  for (const k of slots) {
    const user = agentUser(k);
    if (io.run("id", ["-u", user], { cwd: "/", env: SPAWN_ENV }).code !== 0) {
      problems.push(`no user ${user}`);
      continue;
    }
    const cwd = slotRoot(k, io.root);
    const sudo = asAgentNow(k, ["true"], { cwd, timeoutMs: 30_000 }, io);
    if (sudo.code !== 0) {
      problems.push(
        `sudo -n doesn't start ${user} (${sudo.stderr.trim().split("\n")[0] || `exit ${sudo.code}`})`,
      );
      continue;
    }
    const others = slots.filter((j) => j !== k).map((j) => slotRoot(j, io.root));
    const paths = [walls.home, walls.work, ...others, `/proc/${walls.pid}/environ`];
    for (const p of paths)
      if (
        asAgentNow(k, ["/bin/sh", "-c", PROBE, "probe", p], { cwd, timeoutMs: 30_000 }, io).code ===
        0
      )
        problems.push(`${user} can read ${p}`);
    const windows = asAgentNow(
      k,
      ["/bin/sh", "-c", WINDOWS_PROBE, "windows"],
      { cwd, timeoutMs: 30_000 },
      io,
    );
    const reached = windows.stdout.split("\n").filter((l) => l.trim());
    if (reached.length)
      problems.push(
        `${user} can reach Windows: ${reached.join(", ")} (WSL: close it in /etc/wsl.conf, docs/box-setup.md#this-pc)`,
      );
    const sockets = asAgentNow(
      k,
      ["/bin/sh", "-c", SOCKETS_PROBE, "sockets"],
      { cwd, timeoutMs: 30_000 },
      io,
    );
    for (const s of sockets.stdout.split("\n").filter((l) => l.trim()))
      problems.push(
        `${user} can write ${s}, a root container socket (the docker group, or Docker's or Podman's root socket, gives the box: docs/security.md#the-agents-sandbox)`,
      );
    const dummy = `shipify-check-${randomBytes(8).toString("hex")}`;
    const login = asAgentNow(
      k,
      ["/bin/sh", "-c", LOGIN_PROBE, "login"],
      { cwd, login: dummy, input: `${dummy}\n`, timeoutMs: 30_000 },
      io,
    );
    const said = login.stdout.split("\n");
    const open = LOGIN_WALLS.filter(([word]) => !said.includes(word)).map(([, what]) => what);
    if (open.length) problems.push(`${user}'s login: ${open.join(", ")}`);
    const scope = /^ptrace (\d*)$/m.exec(login.stdout)?.[1] || "missing";
    if (!(Number(scope) >= 1))
      problems.push(
        `${user}'s commands can read its memory, its login there: kernel.yama.ptrace_scope is ${scope}, not 1 (Ubuntu's: put kernel.yama.ptrace_scope = 1 in /etc/sysctl.d/10-ptrace.conf, then sudo sysctl --system)`,
      );
  }
  return problems;
}

/** The service that loads the agents' network rule at every start (box setup 9). */
export const AGENTS_NET_UNIT = "shipify-agents-net.service";

/**
 * The agents' network rule (box setup 9): on, when its service is there. The runner can't read
 * nftables (that needs root): the service that loads the rule says whether it did. A box without
 * the service (a setup before 9, a box in Docker) has nothing to say here.
 */
export function agentsNetProblems(io: SandboxIo = REAL_IO): string[] {
  const r = io.run("systemctl", ["show", "-p", "LoadState", "-p", "ActiveState", AGENTS_NET_UNIT], {
    cwd: "/",
    env: SPAWN_ENV,
    timeoutMs: 30_000,
  });
  const value = (name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(r.stdout)?.[1];
  if (r.code !== 0 || value("LoadState") !== "loaded" || value("ActiveState") === "active")
    return [];
  return [
    `the agents' network rule isn't on (${AGENTS_NET_UNIT} is ${value("ActiveState") || "unknown"}), so they can reach your network and the tailnet (sudo systemctl status ${AGENTS_NET_UNIT} says why)`,
  ];
}

/**
 * Whether the agent opens its container store as its runs do (box setup 10): `podman info`, with
 * no image. Nothing when it does, or when there's no Podman (a box in Docker); else Podman's own
 * "Error:" line.
 */
const CONTAINERS_PROBE = String.raw`command -v podman >/dev/null || exit 0
[ -d "$XDG_RUNTIME_DIR" ] || mkdir -m 700 "$XDG_RUNTIME_DIR" 2>/dev/null
err=$(podman info 2>&1 >/dev/null) && exit 0
line=$(printf '%s\n' "$err" | grep -m 1 '^Error:' || printf '%s\n' "$err" | tail -n 1)
[ -n "$line" ] || line="podman info failed"
echo "$line"`;

/** Each slot whose agent's containers don't start, with Podman's reason (ADR 0064). */
export function containersProblems(slots: number[], io: SandboxIo = REAL_IO): string[] {
  const problems: string[] = [];
  for (const k of slots) {
    const said = asAgentNow(
      k,
      ["/bin/sh", "-c", CONTAINERS_PROBE, "containers"],
      { cwd: slotRoot(k, io.root), env: containerEnv(k, io.root), timeoutMs: 60_000 },
      io,
    );
    const why = said.stdout.trim().split("\n")[0] || (said.code ? `exit ${said.code}` : "");
    if (why) problems.push(`${agentUser(k)}: ${why}`);
  }
  return problems;
}
