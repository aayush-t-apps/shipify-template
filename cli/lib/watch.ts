// The watch's GitHub side (ADR 0019, docs/watch.md). The watch is whatever presses watch.yml's
// buttons: it reads the record and starts a run (the edge's watch, every 5 minutes).
// This is what Shipify needs from those runs: pressing one (a due run starts each box's clean-up),
// finding the ones under way, and telling when the watch has stopped.
import { githubQueue, platformRepo } from "./github.ts";
import type { QueueRun } from "./plugins/record.ts";

export const WATCH_WORKFLOW = "watch.yml";
const HOUR = 60 * 60_000;
/** The watch starts a due run at least once a day; this much later, it has stopped. */
const STOPPED_AFTER = 26 * HOUR;

export type Run = QueueRun;

/** watch.yml's recent runs, newest first. */
export const watchRuns = (repo = platformRepo(), n = 30) =>
  githubQueue({ repo }).runs(WATCH_WORKFLOW, n);

/** Press one of the watch's buttons: `run` is due, cleanup or alert. */
export function pressWatch(
  inputs: { run: "due" | "cleanup" | "alert"; box?: string; findings?: string; where?: string },
  repo = platformRepo(),
) {
  const fields = Object.fromEntries(
    Object.entries(inputs).filter((e): e is [string, string] => Boolean(e[1])),
  );
  return githubQueue({ repo }).dispatch(WATCH_WORKFLOW, fields);
}

/** The boxes whose clean-up is queued or running: one at a time each. */
export const cleanupsUnderWay = (runs: Run[]) =>
  new Set(
    runs
      .filter((r) => r.status !== "completed" && r.display_title.startsWith("cleanup "))
      .map((r) => r.display_title.slice("cleanup ".length)),
  );

/** When the newest due run that worked started, if one ever has. */
export function lastDueRun(runs: Run[]): string | undefined {
  return runs.find(
    (r) => r.display_title === "due" && r.status === "completed" && r.conclusion === "success",
  )?.created_at;
}

/** For `ship doctor`: when the watch last started a due run that worked. */
export function watchState(now = Date.now()): { ok: boolean; detail: string } {
  const last = lastDueRun(watchRuns());
  if (!last)
    return {
      ok: false,
      detail:
        "no due run yet: the watch isn't set up, so repeats and clean-ups wait (docs/watch.md)",
    };
  const hours = Math.round((now - Date.parse(last)) / HOUR);
  return now - Date.parse(last) < STOPPED_AFTER
    ? { ok: true, detail: `last due run ${hours < 1 ? "within the hour" : `${hours} h ago`}` }
    : { ok: false, detail: `last due run ${hours} h ago: the watch has stopped (docs/watch.md)` };
}
