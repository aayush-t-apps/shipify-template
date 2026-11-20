// The runner's own cache of actions (box setup 19, docs/box-setup.md): GitHub's archive of each
// action the box's workflows pin, which the runner copies in "Set up job" instead of downloading it
// again in every job (3.4–4.1 s of its 6 s on a Pi). The runner looks in the folder each slot's
// .env names (ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE) for `<owner>_<repo>/<sha>.tar.gz`, and downloads
// one that isn't there, as before. What's in it runs with the bot's key, so only the runner writes
// it (in its own home, 0700), and an archive goes in only once it unpacks to one folder, as the
// runner needs it: one it couldn't unpack would fail every job's set-up on the box. The due run
// fills it on its box; the weekly clean-up fills it and removes what no workflow pins any more.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PLATFORM_ROOT } from "./config.ts";

/** An action a workflow pins to a commit: its repo (owner/name) and that commit. */
export interface Pin {
  repo: string;
  sha: string;
}

/** A `uses:` line with a full commit: `owner/repo@sha`, or an action in a folder of it. */
const USES = /^\s*-?\s*uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[^@\s]+)?@([0-9a-f]{40})\b/gm;

/**
 * The actions the workflows that run on a box pin (those that name `self-hosted`: task.yml and
 * watch.yml), each once. One on a tag isn't a pin: the runner resolves it every time.
 */
export function boxPins(dir = join(PLATFORM_ROOT, ".github", "workflows")): Pin[] {
  if (!existsSync(dir)) return [];
  const pins = new Map<string, Pin>();
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(join(dir, f), "utf8");
    if (!text.includes("self-hosted")) continue;
    for (const [, repo = "", sha = ""] of text.matchAll(USES))
      pins.set(`${repo}@${sha}`, { repo, sha });
  }
  return [...pins.keys()].sort().map((k) => pins.get(k) as Pin);
}

/** Where the runner looks for a pin's archive. */
export const archiveOf = (dir: string, p: Pin) =>
  join(dir, p.repo.replace("/", "_"), `${p.sha}.tar.gz`);

/** Whether an archive unpacks to one folder and nothing beside it, as the runner needs it. */
export function unpacksToOneFolder(file: string): boolean {
  const r = spawnSync("tar", ["-tzf", file], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) return false;
  const entries = r.stdout
    .split("\n")
    .map((e) => e.replace(/^\.\//, ""))
    .filter(Boolean);
  const tops = new Set(entries.map((e) => e.split("/")[0]));
  return tops.size === 1 && entries.some((e) => /^[^/]+\/./.test(e));
}

/** What the cache needs from outside: a download, and the check of what came. */
export interface ActionCacheIo {
  /** GitHub's archive of the repo at that commit (its tarball). */
  download(p: Pin): Promise<Uint8Array>;
  unpacks(file: string): boolean;
}

/** GitHub's tarball, as the runner downloads it: the job's token, if it has one, in a header. */
export const liveActionIo = (token = process.env.GH_TOKEN): ActionCacheIo => ({
  async download(p) {
    const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
    const r = await fetch(`${api}/repos/${p.repo}/tarball/${p.sha}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "shipify",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  unpacks: unpacksToOneFolder,
});

/** What it did, each as `owner/repo@abc1234`. */
export interface ActionsKept {
  added: string[];
  removed: string[];
  failed: string[];
}

const nameOf = (p: Pin) => `${p.repo}@${p.sha.slice(0, 7)}`;

/**
 * The cache kept to these pins: each missing archive downloaded, checked and moved in whole; with
 * `prune`, every other file removed. Nothing when the box has no cache (before setup 19, or a PC):
 * the runner then downloads as before. One that fails is left for the next run.
 */
export async function keepActions(
  pins: Pin[],
  dir: string | undefined,
  opts: { prune: boolean; io?: ActionCacheIo },
): Promise<ActionsKept | undefined> {
  if (!dir || !existsSync(dir)) return undefined;
  const io = opts.io ?? liveActionIo();
  const kept: ActionsKept = { added: [], removed: [], failed: [] };
  for (const p of pins) {
    const file = archiveOf(dir, p);
    if (existsSync(file)) continue;
    // Its own name till it's checked: the runner never sees a part, nor another run's.
    const part = `${file}.part-${process.pid}`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(part, await io.download(p), { mode: 0o600 });
      if (!io.unpacks(part)) throw new Error("it doesn't unpack to one folder");
      renameSync(part, file);
      kept.added.push(nameOf(p));
    } catch {
      rmSync(part, { force: true });
      kept.failed.push(nameOf(p));
    }
  }
  // No pins read is no reason to empty it.
  if (!opts.prune || !pins.length) return kept;
  const want = new Set(pins.map((p) => archiveOf(dir, p)));
  for (const repo of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, repo.name);
    const files = repo.isDirectory() ? readdirSync(at) : [];
    for (const f of files.filter((n) => !want.has(join(at, n)))) {
      rmSync(join(at, f), { recursive: true, force: true });
      const sha = /^([0-9a-f]{7})[0-9a-f]{33}\.tar\.gz$/.exec(f)?.[1];
      if (sha) kept.removed.push(`${repo.name.replace("_", "/")}@${sha}`);
    }
    if (!repo.isDirectory() || files.every((n) => !want.has(join(at, n))))
      rmSync(at, { recursive: true, force: true });
  }
  return kept;
}

/** A line for the clean-up's summary, or "" when it did nothing. */
export function actionsSaid(k: ActionsKept | undefined): string {
  if (!k) return "";
  const did = [
    k.added.length ? `${k.added.length} action(s) cached for "Set up job"` : "",
    k.removed.length ? `${k.removed.length} old one(s) removed` : "",
  ].filter(Boolean);
  const failed = k.failed.length && `couldn't cache ${k.failed.join(", ")} (the next run tries)`;
  return [did.join(", "), failed].filter(Boolean).join("; ");
}
