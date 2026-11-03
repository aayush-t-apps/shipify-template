// A box's weekly clean-up of what tasks left behind (ADR 0020, ADR 0031): their task folders on
// every slot of this box, a closed or deleted task's, and any task's unchanged for a week (ADR
// 0069: an answered task stays open, so its folder would stay too), and the agents' old run
// folders. A task with a run queued or under way is left alone.
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { ghRun, platformRepo } from "../../lib/github.ts";
import { DAY, workspace } from "./context.ts";
import { activeTasks } from "./due.ts";

/**
 * A task folder unchanged this long goes, open task or not: it only carries files between one
 * job's steps (kernel/run.ts), and a run starts with none of the last run's.
 */
const IDLE_FOLDER_DAYS = 7;

/** A task that's closed, or gone: what it left on a box can go. */
function taskGone(n: string): boolean {
  const r = ghRun(["api", `repos/${platformRepo()}/issues/${n}`, "--jq", ".state"]);
  if (r.code) return /HTTP 404|HTTP 410/.test(r.stderr);
  return r.stdout.trim() === "closed";
}

/**
 * Every slot's workspace on this box (ADR 0020): the box's folder (SHIPIFY_BOX_DIR, from each
 * slot's `.env`) holds slot 1's runner and a `slot-<k>` folder for each other; each runner's
 * `_work/<repo>` is that slot's workspace. Elsewhere (this PC in a terminal), just this one.
 */
export function slotWorkspaces(here = workspace(), boxDir = process.env.SHIPIFY_BOX_DIR): string[] {
  if (!boxDir || !existsSync(boxDir)) return [here];
  const slots = [
    boxDir,
    ...readdirSync(boxDir)
      .filter((d) => /^slot-\d+$/.test(d))
      .map((d) => join(boxDir, d)),
  ];
  const all = slots.map((d) => join(d, "_work", basename(here))).filter((w) => existsSync(w));
  return [...new Set([here, ...all])];
}

/** When a folder or anything in it last changed; `now` when it can't tell, so it's kept. */
function lastChange(dir: string, now: number): number {
  try {
    let newest = lstatSync(dir).mtimeMs;
    for (const f of readdirSync(dir, { recursive: true, encoding: "utf8" }))
      newest = Math.max(newest, lstatSync(join(dir, f)).mtimeMs);
    return newest;
  } catch {
    return now;
  }
}

/** What the clean-up of task folders reads: each slot's workspace, the queue, a task's state. */
export interface FoldersIo {
  workspaces(): string[];
  /** The tasks with a run queued or under way. */
  active(): Set<number>;
  /** Whether a task is closed, or deleted: one GitHub call. */
  gone(n: string): boolean;
}

const liveFolders: FoldersIo = {
  workspaces: () => slotWorkspaces(),
  active: activeTasks,
  gone: taskGone,
};

/**
 * The task folders that can go, in one pass over every slot: never a task's with a run queued or
 * under way; one unchanged for a week with no GitHub call; a newer one when its task is closed or
 * deleted (one call a task, however many slots have its folder).
 */
export function cleanUpTasks(at = Date.now(), io: FoldersIo = liveFolders): { folders: number } {
  const active = io.active();
  const gone = new Map<string, boolean>();
  const isGone = (n: string) => {
    if (!gone.has(n)) gone.set(n, io.gone(n));
    return gone.get(n) as boolean;
  };
  let folders = 0;
  for (const ws of io.workspaces()) {
    const tasks = join(ws, ".tasks");
    if (!existsSync(tasks)) continue;
    for (const d of readdirSync(tasks)) {
      const dir = join(tasks, d);
      if (!/^\d+$/.test(d) || active.has(Number(d))) continue;
      if (at - lastChange(dir, at) >= IDLE_FOLDER_DAYS * DAY || isGone(d)) {
        rmSync(dir, { recursive: true, force: true });
        folders++;
      }
    }
  }
  return { folders };
}
