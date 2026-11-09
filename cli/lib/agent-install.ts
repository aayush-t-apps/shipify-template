// An agent on a box (ADR 0038): installed the first time a run picks it, by its executors.json
// entry's `install` (its own command, run once into the box's shared tools: <dir>/<version>), where
// every slot's agent user can read and run it. A version moves only in a PR that says so; the weekly
// clean-up keeps the pinned version of each agent and removes the rest. Never on a PC or in CI.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fetchAgain } from "./net.ts";
import { ShipError } from "./output.ts";
import type { Executor, Executors, Install } from "./plugins/agent.ts";
import { newer } from "./versions.ts";

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
 * once its program starts. Before the mark, its folders are opened to the agents' users (a folder
 * made before under the service's umask is only the runner's), so a marked install needs nothing
 * more.  $1 the prefix  $2 the program  $3 the mark  then the install's words
 */
const INSTALL = [
  "umask 022",
  'prefix="$1"; p="$2"; done="$3"; shift 3',
  '[ -f "$done" ] && exit 0',
  'mark() { chmod a+rx "$(dirname "$prefix")"; chmod -R a+rX "$prefix"; : > "$done"; }',
  'if [ -x "$p" ] && "$p" --version >/dev/null 2>&1; then mark; exit; fi',
  'rm -rf -- "$prefix"',
  '"$@" || exit',
  '"$p" --version >/dev/null || exit',
  "mark",
].join("\n");

/**
 * The agent installed (once: a run that finds its mark only puts it on the PATH), opened to the
 * agents' users, and checked by running it. Returns the folder its program is in, for the run's
 * PATH.
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
  // Marked: installed, opened and started before, so no lock, no walk of its files and no start
  // (pi's --version alone takes 3-4 s on a Pi).
  if (!existsSync(at.done)) {
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
  }
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
  const prune = (dir: string, keep: string[]) => {
    if (!existsSync(dir)) return;
    for (const v of readdirSync(dir)) {
      if (v.startsWith(".") || keep.includes(v)) continue;
      rmSync(join(dir, v), { recursive: true, force: true });
      removed.push(`${basename(dir)} ${v}`);
    }
  };
  for (const [id, entry] of Object.entries(all)) {
    const at = installedAt(id, entry, tools);
    if (at && entry.install) prune(at.dir, [entry.install.version]);
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
    prune(node, keep);
  }
  return removed;
}

/** An agent's pin beside its newest version, and the advisories against the pin. */
export interface AgentNews {
  id: string;
  pinned: string;
  /** Its newest, when it's newer than the pin. */
  newer?: string;
  advisories: { title: string; severity: string; url: string }[];
}

/** One of GitHub's advisories, as its list gives it. */
type Advisory = {
  summary?: string;
  severity?: string;
  html_url?: string;
  withdrawn_at?: string | null;
};

/** One answer as JSON, or why not. */
const answer = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.url} answered ${r.status}`);
  return (await r.json()) as T;
};

/**
 * For the weekly digest (task #673): each agent whose install says where to look (`newest`,
 * `advisories`, executors.json), with its newest version and the advisories against its pin, read
 * with no key, all at once. Nothing is installed: a version moves only in a PR. Undefined when an
 * answer didn't come.
 */
export async function agentNews(
  all: Executors,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentNews[] | undefined> {
  // An agent through another gateway (`extends`) is the same program and pin.
  const looked = Object.entries(all).flatMap(([id, e]) =>
    e.install && !e.extends && (e.install.newest || e.install.advisories)
      ? [{ id, install: e.install as Install }]
      : [],
  );
  const read = <T>(url: string) =>
    fetchAgain(url, { headers: { accept: "application/json" } }, { fetchImpl }).then((r) =>
      answer<T>(r),
    );
  try {
    return await Promise.all(
      looked.map(async ({ id, install: i }) => {
        const [newest, advised] = await Promise.all([
          i.newest ? read<{ version?: string }>(i.newest) : undefined,
          i.advisories
            ? read<Advisory[]>(i.advisories.replace("{version}", encodeURIComponent(i.version)))
            : undefined,
        ]);
        const v = newest?.version;
        return {
          id,
          pinned: i.version,
          ...(v && newer(v, i.version) ? { newer: v } : {}),
          // A withdrawn advisory was a mistake: it's not said.
          advisories: (advised ?? [])
            .filter((a) => !a.withdrawn_at)
            .map((a) => ({
              title: a.summary ?? "an advisory",
              severity: a.severity ?? "unknown",
              url: a.html_url ?? "",
            })),
        };
      }),
    );
  } catch {
    return undefined;
  }
}
