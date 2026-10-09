// A merged PR's deploy (ADR 0030 §5, ADR 0031). The run that saw a task's merge follows its deploy
// to the end and tells it (followDeploy). What no event of its own reports (a staging release PR
// merged in the app's repo, a new project's first deploy) is recorded and labelled `deploying`; the
// watch then rings due runs, which start the task's run once the pipeline has said. A PR's checks
// are never followed (ADR 0046).

import { GIVE_UP_MS } from "../../kernel/decide.ts";
import { ghRun, platformRepo, repoOfPr } from "../../lib/github.ts";
import { repoFor } from "../../lib/projects-on-github.ts";
import type { TaskState } from "../../lib/task.ts";

export const DEPLOYING = {
  name: "deploying",
  color: "8250df",
  description: "Merged: Shipify tells you when its deploy is up",
};
export { GIVE_UP_MS };

/** How often a run following its deploy looks: a deploy takes about a minute. */
const LOOK_MS = 15_000;
/** Only a merge this recent is followed: closing an old task again never says "Live" twice. */
const RECENT_MS = 60 * 60_000;
type Deploy = NonNullable<TaskState["deploy"]>;

/**
 * An app's repo, address and whether it has staging, from the shipify.json on its main: what the
 * pipeline deploys by. None for a package, or anything unread.
 */
function appOf(id: string | undefined, token?: string) {
  if (!id) return undefined;
  const repo = repoFor(id);
  const r = ghRun(["api", `repos/${repo}/contents/shipify.json`, "--jq", ".content"], { token });
  if (r.code) return undefined;
  try {
    const m = JSON.parse(Buffer.from(r.stdout.trim(), "base64").toString("utf8")) as {
      kind?: string;
      staging?: boolean;
      urls?: { production?: string; staging?: string };
    };
    if (m.kind !== "app") return undefined;
    const staging = Boolean(m.staging);
    const url = (staging ? m.urls?.staging : m.urls?.production) || undefined;
    return { id, repo, staging, ...(url ? { url } : {}) };
  } catch {
    return undefined;
  }
}

const deployOf = (app: NonNullable<ReturnType<typeof appOf>>, sha: string): Deploy => ({
  app: app.id,
  repo: app.repo,
  sha,
  ...(app.url ? { url: app.url } : {}),
  staging: app.staging,
  since: new Date().toISOString(),
});

/** The task's PR that merged into its app's main lately, as the deploy to follow. */
export function mergedDeploy(state: TaskState, token?: string): Deploy | undefined {
  const app = appOf(state.project, token);
  if (!app) return undefined;
  for (const url of [...state.prs].reverse()) {
    const repo = repoOfPr(url);
    // Only a PR into this app's own repo: a task's other PRs (Shipify's) deploy nothing here.
    if (repo?.toLowerCase() !== app.repo.toLowerCase()) continue;
    const r = ghRun(["pr", "view", url, "--json", "state,baseRefName,mergeCommit,mergedAt"], {
      token,
    });
    if (r.code) continue;
    const pr = JSON.parse(r.stdout) as {
      state?: string;
      baseRefName?: string;
      mergeCommit?: { oid?: string };
      mergedAt?: string;
    };
    if (pr.state !== "MERGED" || pr.baseRefName !== "main" || !pr.mergeCommit?.oid) continue;
    if (!pr.mergedAt || Date.now() - Date.parse(pr.mergedAt) > RECENT_MS) continue;
    return deployOf(app, pr.mergeCommit.oid);
  }
  return undefined;
}

/**
 * The task's PR that merged lately when no app deploys it (Shipify itself, a package, a recipe):
 * what the closing run tells, once.
 */
export function mergedPr(
  state: TaskState,
  token: (url: string) => string | undefined,
): { url: string; title: string } | undefined {
  for (const url of [...state.prs].reverse()) {
    const r = ghRun(["pr", "view", url, "--json", "state,mergedAt,title"], { token: token(url) });
    if (r.code) continue;
    const pr = JSON.parse(r.stdout) as { state?: string; mergedAt?: string; title?: string };
    if (pr.state !== "MERGED" || !pr.mergedAt || Date.now() - Date.parse(pr.mergedAt) > RECENT_MS)
      continue;
    return { url, title: pr.title ?? url };
  }
  return undefined;
}

/**
 * The PR that closed a task, as GitHub's own record of the close names it: one opened outside a
 * run (`ship pr --task` from the PC) is in no task's state. Its URL, or none (closed by hand, by a
 * commit, or unreadable).
 */
export function closingPr(n: number, token?: string): string | undefined {
  const [owner, name] = platformRepo().split("/");
  const r = ghRun(
    [
      "api",
      "graphql",
      "-f",
      "query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){timelineItems(itemTypes:[CLOSED_EVENT],last:1){nodes{...on ClosedEvent{closer{...on PullRequest{url}}}}}}}}",
      "-f",
      `o=${owner}`,
      "-f",
      `r=${name}`,
      "-F",
      `n=${n}`,
      "--jq",
      ".data.repository.issue.timelineItems.nodes[0].closer.url // empty",
    ],
    { token },
  );
  const url = r.stdout.trim();
  return !r.code && repoOfPr(url) ? url : undefined;
}

/** A new project's first push, as the deploy to follow: its repo's main. */
export function publishedDeploy(id: string, token?: string): Deploy | undefined {
  const app = appOf(id, token);
  if (!app) return undefined;
  const r = ghRun(["api", `repos/${app.repo}/commits/main`, "--jq", ".sha"], { token });
  const sha = r.stdout.trim();
  return r.code || !/^[0-9a-f]{40}$/.test(sha) ? undefined : deployOf(app, sha);
}

/** A deploy's end, as decide tells it. */
export type DeployEnd = {
  state: "live" | "failed" | "gone";
  url?: string;
  run?: string;
  staging?: boolean;
};

/**
 * A merged task's deploy, followed by the run that saw the merge until it's up, failed, unreadable
 * or GIVE_UP_MS has passed, so its "Live" comes as soon as the pipeline says.
 */
export async function followDeploy(
  d: Deploy,
  token?: string,
  wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  read = deployState,
): Promise<DeployEnd> {
  for (let waited = 0; ; waited += LOOK_MS) {
    const r = read(d, token);
    if (r.state === "up")
      return {
        state: "live",
        ...(d.url ? { url: d.url } : {}),
        ...(d.staging ? { staging: true } : {}),
      };
    if (r.state === "failed") return { state: "failed", ...(r.run ? { run: r.run } : {}) };
    if (r.state === "unreadable" || waited >= GIVE_UP_MS) return { state: "gone" };
    await wait(LOOK_MS);
  }
}

/** A release PR: open, merged (with its merge commit), or closed unmerged. */
export function releaseState(
  pr: string,
  token?: string,
): { state: "open" | "merged" | "closed" | "unknown"; sha?: string } {
  const r = ghRun(["pr", "view", pr, "--json", "state,mergeCommit"], { token });
  if (r.code) return { state: "unknown" };
  const p = JSON.parse(r.stdout) as { state?: string; mergeCommit?: { oid?: string } };
  if (p.state === "MERGED" && p.mergeCommit?.oid)
    return { state: "merged", sha: p.mergeCommit.oid };
  return { state: p.state === "CLOSED" ? "closed" : "open" };
}

/** An app's production address, from the shipify.json on its main. */
export function productionUrl(id: string, token?: string): string | undefined {
  const repo = repoFor(id);
  const r = ghRun(["api", `repos/${repo}/contents/shipify.json`, "--jq", ".content"], { token });
  if (r.code) return undefined;
  try {
    const m = JSON.parse(Buffer.from(r.stdout.trim(), "base64").toString("utf8")) as {
      urls?: { production?: string };
    };
    return m.urls?.production;
  } catch {
    return undefined;
  }
}

/** A ref's mark from the pipeline in this context: none yet, or unreadable (no token may read it). */
function markOn(
  repo: string,
  ref: string,
  context: string,
  token?: string,
): { state: string; target_url?: string } | undefined | "unreadable" {
  const r = ghRun(["api", `repos/${repo}/commits/${ref}/status`], { token });
  if (r.code) return /HTTP 40[34]/.test(r.stderr) ? "unreadable" : undefined;
  const marks =
    (
      JSON.parse(r.stdout) as {
        statuses?: { context: string; state: string; target_url?: string }[];
      }
    ).statuses ?? [];
  return marks.find((s) => s.context === context);
}

/**
 * What the pipeline says of a deploy: up, failed (with its run), or not yet. Unreadable when no
 * token here may read the app's commit (GitHub says not found or forbidden): not a wait. A commit
 * with no mark of its own whose branch has moved on is deployed with the later commit that holds
 * it: GitHub keeps one waiting run per branch, so merges close together can drop one's run.
 */
export function deployState(
  d: Deploy,
  token?: string,
): { state: "up" | "failed" | "waiting" | "unreadable"; run?: string } {
  const context = d.production ? "shipify/production" : "shipify/main";
  const branch = d.production ? "production" : "main";
  let mark = markOn(d.repo, d.sha, context, token);
  if (mark === "unreadable") return { state: "unreadable" };
  if (!mark) {
    const moved = ghRun(
      ["api", `repos/${d.repo}/compare/${d.sha}...${branch}`, "--jq", ".status"],
      {
        token,
      },
    );
    const later =
      moved.stdout.trim() === "ahead" ? markOn(d.repo, branch, context, token) : undefined;
    if (later && later !== "unreadable") mark = later;
  }
  if (mark?.state === "success") return { state: "up" };
  if (mark?.state === "failure" || mark?.state === "error")
    return { state: "failed", run: mark.target_url };
  return { state: "waiting" };
}
