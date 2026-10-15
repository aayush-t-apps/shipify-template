// A box's weekly clean-up of what closed and deleted tasks left behind (ADR 0020, ADR 0031): their
// task folders on every slot of this box, and the agents' old run folders. A task with a run queued
// or under way is left alone.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { ghRun, platformRepo } from "../../lib/github.ts";
import { workspace } from "./context.ts";
import { activeTasks } from "./due.ts";

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

export function cleanUpTasks(): { folders: number } {
  const active = activeTasks();
  const gone = new Map<string, boolean>();
  const isGone = (n: string) => {
    if (!gone.has(n)) gone.set(n, !active.has(Number(n)) && taskGone(n));
    return gone.get(n) as boolean;
  };
  let folders = 0;
  for (const ws of slotWorkspaces()) {
    const tasks = join(ws, ".tasks");
    if (existsSync(tasks))
      for (const d of readdirSync(tasks))
        if (/^\d+$/.test(d) && isGone(d)) {
          rmSync(join(tasks, d), { recursive: true, force: true });
          folders++;
        }
  }
  return { folders };
}
