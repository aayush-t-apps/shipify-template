import { STAYING_LABEL } from "../../contracts/index.ts";
import { findStack } from "../../lib/catalog.ts";
import { copySetting, PLATFORM_ROOT } from "../../lib/config.ts";
import { credential, loadCredentials } from "../../lib/credentials.ts";
import { ghRun, platformRepo } from "../../lib/github.ts";
import { ok, type Result } from "../../lib/output.ts";
import { readPlan } from "../../lib/plan.ts";
import { findStatus } from "../../lib/task.ts";
import { git, queue, rec } from "./context.ts";
import { getComments } from "./issue.ts";

/**
 * What publishing a plan's project needs and this run lacks (ADR 0026): the stack's deploy
 * variables (your copy's settings) and secrets (the run's credentials) and a GitHub
 * token that may set a repo's variables (the task bot's Variables permission). Empty: all there.
 */
export function publishNeeds(plan: string, root = PLATFORM_ROOT): string[] {
  const stack = findStack(readPlan(plan, root).meta.stack);
  const deploy = stack.kind === "app" ? stack.deploy : undefined;
  const creds = loadCredentials().values;
  const has = (name: string) => Boolean(credential(creds, name));
  const missing = [
    ...(deploy?.vars ?? [])
      .filter((v) => !copySetting(v))
      .map(
        (v) =>
          `\`${v}\`: one of your copy's settings, a variable on the shipify repo (pnpm ship setup)`,
      ),
    ...[...new Set(Object.values(deploy?.secrets ?? {}))]
      .filter((s) => !has(s))
      .map(
        (s) =>
          `\`${s}\`: a secret on the shipify repo (docs/setup.md, "Publishing new projects from a task")`,
      ),
  ];
  // Listing the shipify repo's variables needs the same permission as setting a new repo's, asked
  // with the token that sets them: the bot's (GH_TOKEN). The workflow's own token (the job's
  // SHIPIFY_ISSUES_TOKEN) has no Variables permission at all, so it always said this was missing.
  if (ghRun(["api", `repos/${platformRepo()}/actions/variables?per_page=1`]).code)
    missing.push(
      'Variables: Read and write for the task bot (the GitHub App): its settings, then accept it on the install (docs/setup.md, "Tasks")',
    );
  return missing;
}

/** "Before building …, it would stop": what's missing, and how to go on once it's there. */
export function wouldStop(plan: string, missing: string[]): string {
  return `Before building **${plan}**, I checked what publishing it needs, and it would stop:\n\n${missing.map((m) => `- ${m}`).join("\n")}\n\nOnce that's done, comment **publish** and the build starts.`;
}

// ---------------------------------------------------------------- plans merged

/** A push to main merged plans: each task that wrote one builds and publishes it. */
export async function taskPlans(before: string, after: string): Promise<Result> {
  const range = /^0+$/.test(before)
    ? ["diff-tree", "--no-commit-id", "--name-only", "-r", after]
    : ["diff", "--name-only", before, after];
  // The push's two ends are in the job's own checkout (its full history); the copy of Shipify a box
  // runs from (ADR 0051) may have been cloned from a shallow one.
  const ids = git(process.env.GITHUB_WORKSPACE || PLATFORM_ROOT, ...range, "--", "plans/")
    .split("\n")
    .map((f) => /^plans\/([a-z0-9-]+)\.plan\.md$/.exec(f)?.[1])
    .filter((x): x is string => Boolean(x));
  if (!ids.length) return { command: "task plans", status: "skipped", summary: "no plans changed" };
  const open = rec()
    .issues()
    .filter((i) => !i.pull_request);
  // Each build is its task's own run (reason plan-merged): it waits its turn behind that task's
  // other rounds, as every round does (ADR 0020), and shows as "task #n".
  const started: string[] = [];
  for (const i of open) {
    const s = findStatus(getComments(i.number)).state;
    if (s.plan && ids.includes(s.plan)) {
      // A run that stays on the task holds its turn (ADR 0057): its label off, the stay leaves
      // within seconds, rather than after its quiet minutes, and the build runs next (#528).
      if (i.labels.some((l) => l.name === STAYING_LABEL))
        rec().removeLabel(i.number, STAYING_LABEL);
      // Its repo and keys first, on GitHub's machines; that job then starts the build on a box.
      const d = queue().dispatch("task.yml", { issue: String(i.number), job: "github" });
      started.push(d.ok ? `#${i.number}` : `#${i.number} (not started: ${d.error})`);
    }
  }
  return ok(
    "task plans",
    started.length
      ? `started the build of task(s) ${started.join(", ")}`
      : `no task wrote ${ids.join(", ")}`,
  );
}
