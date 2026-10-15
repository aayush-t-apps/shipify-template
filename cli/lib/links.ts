// How the work a task makes points back to it (ADR 0017): every PR a task opens names the task, so
// the task's GitHub timeline shows each one, and says what made it. The task comes from the run
// (SHIPIFY_TASK, set by the box for the agent) when a command isn't told it, so it can't be
// forgotten.
import { platformRepo } from "./github.ts";

/** The task this work is for: the one given, or the task run's own. */
export function taskOf(given?: number): number | undefined {
  if (given) return given;
  const n = Number(process.env.SHIPIFY_TASK);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * "Closes owner/shipify#12" (merging the PR into main closes the task), or "Part of …" for PRs
 * that don't finish it: plans, change docs, releases, a repeating task's PRs.
 */
export function taskLine(given: number | undefined, partOf: boolean): string | undefined {
  const n = taskOf(given);
  if (!n) return undefined;
  const repeats = process.env.SHIPIFY_TASK_REPEATS === "1";
  return `${partOf || repeats ? "Part of" : "Closes"} ${platformRepo()}#${n}`;
}

/**
 * "Fixes acme/api#42" for a case's task (ADR 0029 §3): its PR closes the issue its case
 * came from when it merges, so nothing is left open. Only on the issue's own repo, where GitHub
 * closes it; the box names it for the run (SHIPIFY_TASK_FIXES), never the agent.
 */
export function fixesLine(prRepo: string): string | undefined {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(process.env.SHIPIFY_TASK_FIXES ?? "");
  if (!m || m[1]?.toLowerCase() !== prRepo.toLowerCase()) return undefined;
  return `Fixes ${m[1]}#${m[2]}`;
}

/**
 * A PR's last line (ADR 0045): "Made by Claude Code (Opus 5.5) with Shipify in [this run](…).", the
 * run's link only where the PR's readers can open it (Shipify's own account).
 */
export function madeWith(by: string | undefined, run?: string): string | undefined {
  if (!by) return undefined;
  return `Made by ${by} with Shipify${run ? ` in [this run](${run})` : ""}.`;
}

/** The same line for a PR an agent opens from the PC (SHIPIFY_MADE_BY, SHIPIFY_RUN_URL). */
export function madeByLine(): string | undefined {
  return madeWith(process.env.SHIPIFY_MADE_BY, process.env.SHIPIFY_RUN_URL);
}

/** A plan's or change doc's front matter, with the task it's for added (`task: owner/shipify#12`). */
export function withTask(text: string, given?: number): string {
  const n = taskOf(given);
  if (!n || !text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end < 0 || /^task:/m.test(text.slice(0, end))) return text;
  return `${text.slice(0, end)}\ntask: ${platformRepo()}#${n}${text.slice(end)}`;
}

/** The task number in a `task:` line, when it names a task in this platform repo. */
export function taskNumber(ref: string | undefined): number | undefined {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref ?? "");
  return m && m[1] === platformRepo() ? Number(m[2]) : undefined;
}
