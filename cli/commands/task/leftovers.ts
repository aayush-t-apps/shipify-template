// What a closed task leaves in your repos, cleared with no agent (task #779): its open PRs and its
// `task/…` branches, 7 days after the task closed, in every repo of Shipify's own account. `close`
// keeps a task's PRs, and a merge or a close can leave a branch: before this, each stayed for good.
// The weekly clean-up starts it once a week in all (sweep.ts): task.yml's `github` job on the status
// task, on GitHub's machines with the bot's key, which a box never holds; no new workflow, no new
// key. Its reads: your repos (one), their task branches with their open PRs (one query per 50
// repos), and those tasks' states (one, from the record); then a write for each PR and each branch.
// The status task's Recent says what it did.
import { LEFT_DAYS } from "../../contracts/index.ts";
import {
  closePr,
  deleteBranch,
  platformRepo,
  type TaskBranch,
  taskBranches,
} from "../../lib/github.ts";
import { fail, ok, type Result } from "../../lib/output.ts";
import type { TaskRecord } from "../../lib/plugins/record.ts";
import { liveRepos } from "../../lib/projects-on-github.ts";
import { addEvent, statusIssueNumber, updateStatusIssue } from "../../lib/status-issue.ts";
import { queue, rec, timeZone } from "./context.ts";

const DAY = 24 * 3600_000;

/** The task a branch is for: `task/12-a-few-words` is #12's. */
export function taskOf(branch: string): number | undefined {
  const n = Number(/^task\/(\d+)(?:-|$)/.exec(branch)?.[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * The branches to clear: Shipify's (one named so by hand is left), of a task closed 7 days ago or
 * more. An open task's, one closed since, and one whose task isn't an issue are kept.
 */
export function leftovers(
  branches: TaskBranch[],
  closed: Map<number, string>,
  at: Date,
): TaskBranch[] {
  return branches.filter((b) => {
    const n = taskOf(b.name);
    const when = Date.parse((n && closed.get(n)) || "");
    return b.ours && at.getTime() - when >= LEFT_DAYS * DAY;
  });
}

/** What the clean-up reads and writes. */
export interface LeftoversIo {
  record: Pick<TaskRecord, "closedAt">;
  /** Every task branch in your repos, with its open PRs. */
  branches(): TaskBranch[];
  closePr(url: string, comment: string): void;
  deleteBranch(repo: string, branch: string): void;
}

/** A PR's closing comment: why, and how to carry the work on. */
export const closedWhy = (task: string) =>
  `Its task, ${task}, closed ${LEFT_DAYS} days ago or more, so Shipify's weekly clean-up closes this PR and deletes its branch. To carry it on: **Restore branch** below, then write on the task.`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** `drop#3`, a PR as its link says it. */
const prName = (url: string) =>
  /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)$/.exec(url)?.slice(1).join("#") ?? url;

/**
 * The clean-up: each leftover's open PRs closed with a comment, then its branch deleted. A PR that
 * didn't close keeps its branch, for next week. Its summary says what it did: "closed 1 PR
 * (shipify#760) and deleted 7 branches of tasks closed 7 days ago or more", "nothing left by
 * closed tasks", and what it couldn't, to try next week.
 */
export function clearLeftovers(
  at: Date,
  io: LeftoversIo,
  platform = platformRepo(),
): { said: string; closed: string[]; deleted: number; failed: number } {
  const branches = io.branches();
  const ns = [...new Set(branches.filter((b) => b.ours).flatMap((b) => taskOf(b.name) ?? []))];
  const picked = leftovers(branches, ns.length ? io.record.closedAt(ns) : new Map(), at);
  const closed: string[] = [];
  const failed: string[] = [];
  let deleted = 0;
  for (const b of picked) {
    let shut = true;
    for (const pr of b.prs)
      try {
        io.closePr(pr.url, closedWhy(`${platform}#${taskOf(b.name)}`));
        closed.push(pr.url);
      } catch {
        shut = false;
        failed.push(prName(pr.url));
      }
    if (!shut) continue;
    try {
      io.deleteBranch(b.repo, b.name);
      deleted++;
    } catch {
      failed.push(`${b.repo.split("/")[1]}:${b.name}`);
    }
  }
  const did = [
    closed.length ? `closed ${plural(closed.length, "PR")} (${closed.map(prName).join(", ")})` : "",
    deleted ? `deleted ${plural(deleted, "branch", "branches")}` : "",
  ].filter(Boolean);
  const said = [
    did.length
      ? `${did.join(" and ")} of tasks closed ${LEFT_DAYS} days ago or more`
      : failed.length
        ? ""
        : "nothing left by closed tasks",
    failed.length ? `couldn't clear ${failed.join(", ")}: next week` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return { said, closed, deleted, failed: failed.length };
}

/** The clean-up's reads and writes on GitHub, with the bot's key (the `github` job's). */
export const liveLeftovers = (record: LeftoversIo["record"], token: string): LeftoversIo => ({
  record,
  branches: () => taskBranches(liveRepos(token), token),
  closePr: (url, comment) => closePr(url, comment, token),
  deleteBranch: (repo, branch) => deleteBranch(repo, branch, token),
});

/**
 * The weekly clean-up's start (sweep.ts), on a box: task.yml's `github` job on the status task, which
 * runs `leftoversJob` on GitHub's machines. Whether it started.
 */
export function startLeftovers(): boolean {
  const n = statusIssueNumber();
  return n ? queue().dispatch("task.yml", { issue: String(n), job: "github" }).ok : false;
}

/**
 * The `github` job on the status task (run.ts): the clean-up, with the job's bot key (GH_TOKEN).
 * The status task's Recent says what it did, or why it stopped; the next week tries again.
 */
export function leftoversJob(token = process.env.GH_TOKEN): Result {
  const at = new Date();
  let said: string;
  let failed = false;
  try {
    if (!token) throw new Error("no bot key");
    said = clearLeftovers(at, liveLeftovers(rec(), token)).said;
  } catch (e) {
    failed = true;
    said = `stopped: ${(e as Error).message.slice(0, 160)}: next week`;
  }
  updateStatusIssue(
    (s) => {
      addEvent(s, `Closed tasks' PRs and branches: ${said}`, at.toISOString());
      return undefined;
    },
    { timeZone: timeZone() },
  );
  return (failed ? fail : ok)("run github", said);
}
