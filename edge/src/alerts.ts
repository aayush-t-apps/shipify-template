// How the edge rings shipify's runs and says what it found (ADR 0031, "The watch"). It has no
// Actions write: it adds a label on the status task, and watch.yml's run for that label starts.
// Each ring removes the label first, so adding it always fires an event. What it found goes in a
// comment of the door App's on the status task: a hidden findings line the alert run reads (it
// checks the comment is the door App's), then the same in words, so the comment itself tells you.
import {
  type Findings,
  findingsLine,
  noFindings,
  renderProblem,
  WATCH_LABELS,
} from "../../cli/contracts/index.ts";
import type { GitHub } from "./github.ts";
import type { StatusTask } from "./settings.ts";

/** Remove the label, then add it: an event fires even when it was there. */
export async function ring(gh: GitHub, issue: number, label: string) {
  await gh.call("DELETE", `repos/${gh.repo}/issues/${issue}/labels/${encodeURIComponent(label)}`);
  await gh.json("POST", `repos/${gh.repo}/issues/${issue}/labels`, { labels: [label] });
}

/** Findings, in words: a line per change, then each note's problem. */
export function findingsText(f: Findings): string {
  const lines = [
    ...Object.entries(f.boxes).map(([b, s]) =>
      s === "offline" ? `- ${b} is offline` : s === "online" ? `- ${b} is back` : `- ${b} is gone`,
    ),
    ...Object.entries(f.apps).map(([a, s]) =>
      s === "failing"
        ? `- ${a} is failing`
        : s === "fine"
          ? `- ${a} is fine again`
          : `- ${a}: ${s}`,
    ),
    ...Object.entries(f.channels).map(([c, s]) =>
      s.state === "failing" ? `- ${c} is failing: ${s.error}` : `- ${c} is fine again`,
    ),
  ];
  return ["**The watch found:**", lines.join("\n"), ...f.notes.map((n) => renderProblem(n.problem))]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Findings on the status task, then the alert run rung: on a box when one is online, else on
 * GitHub's machines. When an alert run is rung already, the comment is still written (the alert
 * run reads every one), but it isn't rung twice.
 */
export async function sayFindings(
  gh: GitHub,
  status: StatusTask,
  findings: Findings,
  online: boolean,
): Promise<boolean> {
  if (noFindings(findings)) return false;
  await gh.json("POST", `repos/${gh.repo}/issues/${status.number}/comments`, {
    body: `${findingsLine(findings)}\n${findingsText(findings)}`,
  });
  const pending = status.labels.some(
    (l) => l === WATCH_LABELS.alert || l === WATCH_LABELS.alertGithub,
  );
  if (!pending)
    await ring(gh, status.number, online ? WATCH_LABELS.alert : WATCH_LABELS.alertGithub);
  return true;
}

export const emptyFindings = (): Findings => ({
  v: 1,
  boxes: {},
  apps: {},
  channels: {},
  notes: [],
});
