// An agent on a box (ADR 0038): installed the first time a run picks it, by its executors.json
// entry's `install` (its own command, run once into the box's shared tools: <dir>/<version>), where
// every slot's agent user can read and run it. A version moves only in a PR that says so; the weekly
// clean-up keeps the pinned version of each agent and removes the rest. Never on a PC or in CI.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ShipError } from "./output.ts";
import type { Executor, Executors } from "./plugins/agent.ts";

/** Where an agent's install lives in the box's shared tools, and its program there. */
export function installedAt(id: string, entry: Executor, tools: string) {
  const i = entry.install;
  if (!i) return undefined;
  const dir = join(tools, i.dir ?? id);
  const prefix = join(dir, i.version);
  return {
    dir,
    prefix,
    program: join(prefix, i.bin.replaceAll("{arch}", process.arch)),
    // Made once the install finished and its program started: without it, the install is redone.
    done: join(prefix, ".installed"),
  };
}

/**
 * Inside the lock: an install with its mark is kept, and so is one made before the mark whose
 * program starts (marked now, so a slot running it is never pulled from under); any other (a
 * download cut short leaves a program that doesn't start) is removed and done again, and marked
 * once its program starts.  $1 the prefix  $2 the program  $3 the mark  then the install's words
 */
const INSTALL = [
  "umask 022",
  'prefix="$1"; p="$2"; done="$3"; shift 3',
  '[ -f "$done" ] && exit 0',
  'if [ -x "$p" ] && "$p" --version >/dev/null 2>&1; then : > "$done"; exit 0; fi',
  'rm -rf -- "$prefix"',
  '"$@" || exit',
  '"$p" --version >/dev/null || exit',
  ': > "$done"',
].join("\n");

/**
 * The agent installed (once; a run that finds it there does nothing), opened to the agents' users,
 * and checked by running it. Returns the folder its program is in, for the run's PATH.
 */
export function installAgent(
  id: string,
  entry: Executor,
  tools = process.env.RUNNER_TOOL_CACHE,
  run = spawnSync,
): string {
  if (!tools)
    throw new ShipError("No box tools folder (RUNNER_TOOL_CACHE): not on a box.", "blocked");
  const at = installedAt(id, entry, tools);
  const i = entry.install;
  if (!at || !i) throw new ShipError(`${id} has no install in executors.json.`, "blocked");
  // The agents run it as their own users (box setup 5): theirs to read and run, though the
  // runner's service makes its own files for itself alone (UMask=0077).
  process.umask(0o022);
  mkdirSync(at.dir, { recursive: true, mode: 0o755 });
  // One install at a time for every slot (flock). Each word is executors.json's, passed as an
  // argument, never into the script's text.
  const words = i.run.map((w) => w.replaceAll("{prefix}", at.prefix));
  const r = run(
    "flock",
    [
      join(at.dir, ".lock"),
      "sh",
      "-c",
      INSTALL,
      "install",
      at.prefix,
      at.program,
      at.done,
      ...words,
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (r.status !== 0)
    throw new ShipError(
      `${id} ${i.version} didn't install: ${String(r.stderr || r.error || "")
        .trim()
        .slice(-300)}`,
      "blocked",
    );
  // A folder made before under the service's umask is only the runner's: open it to them.
  run("chmod", ["a+rx", at.dir], { stdio: "ignore" });
  run("chmod", ["-R", "a+rX", at.prefix], { stdio: "ignore" });
  const v = run(at.program, ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (v.status !== 0)
    throw new ShipError(
      `${id} ${i.version} is installed but doesn't start: ${String(v.stderr || "")
        .trim()
        .slice(-300)}`,
      "blocked",
    );
  const bin = dirname(at.program);
  if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${bin}\n`);
  return bin;
}

/**
 * The box's shared tools kept to what's used: each agent's pinned version (any other version of
 * it removed) and the two newest of each Node major. For the weekly clean-up, while no other slot
 * runs.
 */
export function tidyTools(all: Executors, tools = process.env.RUNNER_TOOL_CACHE): string[] {
  if (!tools || !existsSync(tools)) return [];
  const removed: string[] = [];
  const drop = (dir: string, keep: string[]) => {
    if (!existsSync(dir)) return;
    for (const v of readdirSync(dir)) {
      if (v.startsWith(".") || keep.includes(v)) continue;
      rmSync(join(dir, v), { recursive: true, force: true });
      removed.push(`${basename(dir)} ${v}`);
    }
  };
  for (const [id, entry] of Object.entries(all)) {
    const at = installedAt(id, entry, tools);
    if (at && entry.install) drop(at.dir, [entry.install.version]);
  }
  // Node: the two newest (setup-node's check-latest adds one now and then).
  const node = join(tools, "node");
  if (existsSync(node)) {
    const parts = (v: string) => v.split(".").map(Number);
    const newer = (a: string, b: string) => {
      const [x, y] = [parts(a), parts(b)];
      for (let k = 0; k < 3; k++) if ((y[k] ?? 0) !== (x[k] ?? 0)) return (y[k] ?? 0) - (x[k] ?? 0);
      return 0;
    };
    // Two of each major, so a new major never takes the one runs use.
    const all = readdirSync(node)
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      .sort(newer);
    const keep = all.filter(
      (v, i) => all.slice(0, i).filter((w) => parts(w)[0] === parts(v)[0]).length < 2,
    );
    drop(node, keep);
  }
  return removed;
}
