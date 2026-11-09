// What every part of a task's run shares (ADR 0012, docs/tasks.md): the issue's shape, where this
// run is, the record and the queue it talks to (lib/plugins/record.ts), the workspace's paths, and
// small helpers.
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { timeZoneNow, useTimeZone } from "../../contracts/zone.ts";
import { copyTimeZone, loadConfig, projectsDir } from "../../lib/config.ts";
import { run } from "../../lib/exec.ts";
import { type Form, loadForms } from "../../lib/form-reader.ts";
import { FORMS_DIR } from "../../lib/forms.ts";
import { githubQueue, githubRecord, platformRepo } from "../../lib/github.ts";
import { ShipError } from "../../lib/output.ts";
import type { Queue, RecordIssue, TaskRecord } from "../../lib/plugins/record.ts";

export type Issue = RecordIssue;

/** Where tasks live, and the queue that runs them: GitHub today (plugins/record.ts). A read that
 * mustn't wait long gives its own `timeoutMs`. */
export const rec = (opts?: { timeoutMs?: number }): TaskRecord => githubRecord(opts);
export const queue = (): Queue => githubQueue();

/**
 * Where a box keeps what its next runs' steps reuse (plan's repo lists, the labels' check): the
 * runner's own cache, which no agent's user can read. None off a box.
 */
export const boxCache = (): string | undefined =>
  process.env.SHIPIFY_BOX
    ? join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "shipify")
    : undefined;
/**
 * Where this run is, for replies and run details: the box, and its slot when it has several
 * (ADR 0020: "mybox (slot 2)"); this machine's name outside a job.
 */
export function whereThisRuns(
  slot = process.env.RUNNER_NAME,
  box = process.env.SHIPIFY_BOX,
): string {
  if (slot && box && slot.startsWith(`${box}-`))
    return `${box} (slot ${slot.slice(box.length + 1)})`;
  return slot || box || hostname();
}
/** An extra that mustn't fail a round: its value, or `fallback` when it throws. */
export const tryOr = <T>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};
export const now = () => new Date().toISOString();
export const runUrl = () =>
  process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${platformRepo()}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
/** This run, attempt and all (a re-run of the job keeps its run's id): what ties a step's saved
 * files to the steps of the same attempt. None off GitHub Actions. */
export const thisRun = () =>
  process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT ?? ""}`
    : undefined;
export const owner = () => process.env.SHIPIFY_OWNER || undefined;

// ---------------------------------------------------------------- the workspace

export const config = () => loadConfig();
/** Your copy's time zone (ADR 0047), handed to the zone helpers as it's read, so they agree. */
export const timeZone = () => {
  useTimeZone(copyTimeZone());
  return timeZoneNow();
};
export const workspace = () => dirname(projectsDir(config()));
/** The task forms, as this checkout's templates say (they're read once per run). */
let formsCache: Form[] | undefined;
export const forms = () => {
  formsCache ??= loadForms(FORMS_DIR);
  return formsCache;
};
const taskDir = (n: number) => join(workspace(), ".tasks", String(n));
export const filesDir = (n: number) => join(taskDir(n), "files");
export const git = (dir: string, ...args: string[]) => {
  const r = run("git", args, { cwd: dir });
  if (r.code !== 0) throw new ShipError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

// ---------------------------------------------------------------- times

export const DAY = 24 * 60 * 60 * 1000;
