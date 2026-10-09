import { existsSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { loadConfig, PLATFORM_ROOT, projectsDir } from "../lib/config.ts";
import { run } from "../lib/exec.ts";
import { platformRepo } from "../lib/github.ts";
import { madeByLine, taskLine, taskNumber, withTask } from "../lib/links.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { checkPlan, planPath, planSkeleton, readPlan } from "../lib/plan.ts";
import { planPrBody } from "../lib/review.ts";
import { validateAppName } from "../lib/safety.ts";
import { submitFiles } from "../lib/submit.ts";

export function planNew(opts: {
  app: string;
  title?: string;
  summary?: string;
  stack: string;
  preset: string;
  visibility: "public" | "private";
}): Result {
  validateAppName(opts.app);
  const file = planPath(opts.app);
  if (existsSync(file)) throw new ShipError(`plans/${opts.app}.plan.md already exists.`, "blocked");
  writeFileSync(
    file,
    withTask(
      planSkeleton({
        app: opts.app,
        title: opts.title ?? opts.app,
        summary: opts.summary ?? "[NEEDS CLARIFICATION: one-sentence summary]",
        stack: opts.stack,
        preset: opts.preset,
        visibility: opts.visibility,
      }),
    ),
  );
  return ok("plan new", `wrote plans/${opts.app}.plan.md`, {
    nextSteps: [
      "fill it in using guides/ (architecture, design brief, quality bar); delete N/A sections",
      "remove every [NEEDS CLARIFICATION] marker",
      `pnpm ship plan check ${opts.app}`,
    ],
  });
}

export function planCheck(app: string): Result {
  const config = loadConfig();
  const plan = readPlan(app);
  const checks = checkPlan(plan, projectsDir(config));
  const failed = checks.filter((c) => !c.ok).length;
  return {
    command: "plan check",
    status: failed ? "blocked" : "succeeded",
    summary: failed
      ? `${failed} check(s) failing for ${app} r${plan.meta.revision}`
      : `${app} r${plan.meta.revision} is ready for review (hash ${plan.hash})`,
    checks,
    data: { hash: plan.hash, revision: plan.meta.revision },
    nextSteps: failed ? undefined : [`pnpm ship plan submit ${app} --yes`],
  };
}

/** Open a PR in shipify with the plan. Merging that PR is the approval. */
export function planSubmit(app: string, yes: boolean): Result {
  const check = planCheck(app);
  if (check.status !== "succeeded") return { ...check, command: "plan submit" };
  const plan = readPlan(app);
  const branch = `plan/${app}-r${plan.meta.revision}`;
  const rel = relative(PLATFORM_ROOT, planPath(app));
  const planned = [
    `git worktree add <tmp> -b ${branch} origin/main   (your checkout stays on its branch)`,
    `copy ${rel}, commit "Plan: ${app} r${plan.meta.revision}", git push -u origin ${branch}`,
    `gh pr create --base main --head ${branch} --title "Plan: ${plan.meta.title}"`,
    `${rel} moves to that branch; git pull brings it back after the merge`,
  ];
  if (!yes) {
    return {
      command: "plan submit",
      status: "requires-approval",
      summary: `would open a plan PR for ${app} r${plan.meta.revision}`,
      plannedActions: planned,
      nextSteps: [`pnpm ship plan submit ${app} --yes`],
    };
  }
  if (!run("git", ["remote"], { cwd: PLATFORM_ROOT }).stdout.split("\n").includes("origin")) {
    throw new ShipError("shipify has no 'origin' remote yet.", "blocked");
  }
  const config = loadConfig();
  const url = submitFiles({
    dir: PLATFORM_ROOT,
    files: [rel],
    branch,
    message: `Plan: ${app} r${plan.meta.revision}`,
    title: `Plan: ${plan.meta.title}`,
    body: [
      planPrBody(
        plan,
        config,
        check.checks?.length ?? 0,
        `https://github.com/${platformRepo()}/blob/${branch}/${rel}`,
      ),
      // A plan is part of its task: merging it starts the build, it doesn't finish the task.
      taskLine(taskNumber(plan.meta.task), true),
      madeByLine(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  return ok("plan submit", `opened ${url}`, {
    data: { url, hash: plan.hash },
    nextSteps: [
      "review the plan on GitHub and merge the PR to approve it",
      `then: git pull, and pnpm ship build ${app}`,
    ],
  });
}
