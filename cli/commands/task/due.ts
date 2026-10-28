// The due run (ADR 0019, ADR 0031): what's due, started as each task's own run. A task's comments
// and status are its own run's (task.yml, in its group); here only a quiet day's close (ADR 0040)
// is written on one. It reads every repeating, answered or deploying task, and dispatches the run
// of each one whose time has come; it keeps "Coming up" on the status task, and the apps list the
// edge reads.

import { STATE_LABELS, SUB_TASK_LABEL } from "../../contracts/index.ts";
import { doorLogin } from "../../kernel/snapshot.ts";
import { PLATFORM_ROOT } from "../../lib/config.ts";
import { platformRepo, RECORD_WRITER } from "../../lib/github.ts";
import { ok, type Result } from "../../lib/output.ts";
import { projectsOnGitHub, reposOnGitHub } from "../../lib/projects-on-github.ts";
import { RECIPE_LABEL, readRecipes, recipeOf, recipeTitle } from "../../lib/recipes.ts";
import { loadRegistry } from "../../lib/registry.ts";
import {
  errandWaits,
  isOnce,
  nextLook,
  nextRun,
  parseSchedule,
  REPEATS_LABEL,
  WAITING_LABEL,
} from "../../lib/repeat.ts";
import { isStatusIssue } from "../../lib/status-issue.ts";
import { findStatus, TASK_LABELS, type TaskState } from "../../lib/task.ts";
import { type Issue, owner, queue, rec, timeZone, tryOr } from "./context.ts";
import { DEPLOYING, deployState, errandState, GIVE_UP_MS, releaseState } from "./deploys.ts";

/** A due repeat whose task is busy is looked at again after this long. */
const BUSY_AGAIN_MS = 10 * 60_000;

export interface Due {
  /**
   * Every repeat and quiet close waiting for its time, for the status task. The soonest is the
   * watch's next due time (setUpcoming), so none is ever a time already past.
   */
  upcoming: { n: number; title: string; next: string; every?: string }[];
  /** What this tick did, as the status task says it. */
  events: string[];
  /** Every app, for the edge. */
  apps: AppRow[];
  /** Shipify's own account's repos as a task names them, and which are projects (ADR 0047);
   * none when unread. */
  repos?: { name: string; project: boolean }[];
}

/** The tasks with a run queued or under way, by number: their run-name is "task #<n>". */
export function activeTasks(): Set<number> {
  return new Set(
    queue()
      .active()
      .map((name) => /^task #(\d+)$/.exec(name)?.[1])
      .filter((x): x is string => Boolean(x))
      .map(Number),
  );
}

export function taskDue(at = new Date()): Result<Due> {
  const who = owner();
  const door = doorLogin();
  // Yours, the door's for you, or a task the box opened: a recipe's (the due run opens those: ADR
  // 0032), or a part of a split task (your `yes` opens those: ADR 0066).
  const mine = (i: Issue) =>
    !i.pull_request &&
    !isStatusIssue(i) &&
    (i.user.login === who ||
      (door !== undefined && i.user.login === door) ||
      (i.user.login === RECORD_WRITER &&
        i.labels.some((l) => l.name === RECIPE_LABEL.name || l.name === SUB_TASK_LABEL)));
  const listed = new Map<number, Issue>();
  for (const label of [
    REPEATS_LABEL.name,
    TASK_LABELS.answered.name,
    TASK_LABELS["needs-you"].name,
  ])
    for (const i of tryOr(() => rec().issues({ labels: [label] }), []))
      if (mine(i)) listed.set(i.number, i);
  // A merge closes its task: a deploy, and an errand (ADR 0054), are followed open or closed.
  for (const label of [DEPLOYING.name, WAITING_LABEL.name])
    for (const i of tryOr(() => rec().issues({ labels: [label], state: "all", newest: 30 }), []))
      if (mine(i)) listed.set(i.number, i);
  const busy = tryOr(activeTasks, new Set<number>());
  const events: string[] = [];
  const upcoming: Due["upcoming"] = [];
  const start = (i: Issue, why: string) => {
    const r = queue().dispatch("task.yml", { issue: String(i.number), job: "run" });
    events.push(r.ok ? `started #${i.number} (${why})` : `couldn't start #${i.number}: ${r.error}`);
  };
  // A quiet day's close, made here (ADR 0040): the task closed and its state labels off, as the
  // door closes one; no run for it. Its status catches up when a run next reads the task.
  const close = (i: Issue) => {
    const done = tryOr(() => {
      rec().updateIssue(i.number, { state: "closed", state_reason: "completed" });
      for (const l of i.labels.map((x) => x.name))
        if ((STATE_LABELS as readonly string[]).includes(l)) rec().removeLabel(i.number, l);
      return true;
    }, false);
    events.push(
      done ? `closed #${i.number} (a quiet day)` : `couldn't close #${i.number}: next time`,
    );
  };

  for (const i of listed.values()) {
    const st: TaskState = tryOr(
      () => findStatus(rec().comments(i.number)).state,
      undefined as unknown as TaskState,
    );
    if (!st) continue;
    const now = at.getTime();
    // A repeat: listed at its own next time, whatever runs now, since this list replaces the
    // whole of "Coming up" (ADR 0042). One whose time has come is started, and listed at the time
    // after, as its run saves it. One whose task is busy is listed at the time it's looked at
    // again, in 10 minutes: never at a time already past, which would ring a due run every watch
    // tick while the task's run goes. Its own time stays in its task's status, due once it's free.
    // A time once has no time after: started, it's listed as a busy one is until its run ends it.
    const r = st.repeat;
    // An errand (ADR 0054): at its look, one read with no agent. Done (or its time is up, or it
    // can't be read: its run says so), the task's run is started; otherwise it's listed at its next
    // look, which rings the watch. Its run saves the look after, as a time once's run ends it.
    if (r?.on) {
      const every = `waiting for ${errandWaits(r.on)}`;
      const due = Date.parse(r.next) <= now;
      if (!due || busy.has(i.number)) {
        const next = due ? new Date(now + BUSY_AGAIN_MS).toISOString() : r.next;
        upcoming.push({ n: i.number, title: i.title, next, every });
        continue;
      }
      const ends = Date.parse(r.on.until) <= now;
      const seen = ends
        ? undefined
        : errandState(r.on, process.env.SHIPIFY_READ_TOKEN || undefined);
      if (!seen || seen.state !== "waiting") {
        start(i, "its errand");
        upcoming.push({
          n: i.number,
          title: i.title,
          next: new Date(now + BUSY_AGAIN_MS).toISOString(),
          every,
        });
      } else
        upcoming.push({
          n: i.number,
          title: i.title,
          next: nextLook(r.on, at).toISOString(),
          every,
        });
      continue;
    }
    if (r && !r.paused) {
      const due = Date.parse(r.next) <= now;
      const schedule = parseSchedule(r.every);
      const next = !due
        ? r.next
        : busy.has(i.number) || isOnce(r)
          ? new Date(now + BUSY_AGAIN_MS).toISOString()
          : schedule
            ? nextRun(schedule, at, timeZone()).toISOString()
            : r.next;
      upcoming.push({ n: i.number, title: i.title, next, every: r.every });
      if (due && !busy.has(i.number))
        start(
          i,
          `${r.kind === "reminder" ? "a reminder" : r.kind === "check" ? "a check" : "its job"}`,
        );
      continue;
    }
    if (busy.has(i.number)) continue;
    // An answered task closes after a quiet day (once: a closed one is listed for its deploy).
    if (st.phase === "answered" && st.closes && i.state === "open") {
      if (Date.parse(st.closes) <= now) close(i);
      else {
        upcoming.push({ n: i.number, title: i.title, next: st.closes, every: "closes if quiet" });
      }
      continue;
    }
    // A merged PR's deploy: its run is started once the pipeline says up or failed, or it's late.
    if (st.deploy) {
      const d = deployState(st.deploy, process.env.SHIPIFY_READ_TOKEN || undefined);
      const late = now - Date.parse(st.deploy.since) > GIVE_UP_MS;
      if (d.state === "up" || d.state === "failed" || late || d.state === "unreadable")
        start(i, "its deploy");
      continue;
    }
    // A release PR: its run is started once it's merged or closed (then its deploy is followed).
    const rel = st.pending.release;
    if (rel) {
      const r = releaseState(rel.pr, process.env.SHIPIFY_READ_TOKEN || undefined);
      if (r.state === "merged" || r.state === "closed") start(i, "its release");
    }
  }

  const apps = tryOr(appsHere, []);
  // Shipify's own repos (ADR 0047), from the list the apps were read from (one read per token).
  const token = process.env.SHIPIFY_READ_TOKEN || undefined;
  const repos = token
    ? tryOr(
        () => reposOnGitHub(token).map((r) => ({ name: r.name, project: r.project })),
        undefined,
      )
    : undefined;
  return ok(
    "task due",
    events.length ? events.join("; ") : `nothing due (${listed.size} looked at)`,
    {
      data: {
        upcoming: upcoming.sort((a, b) => Date.parse(a.next) - Date.parse(b.next)),
        events,
        apps,
        ...(repos ? { repos } : {}),
      },
    },
  );
}

type AppRow = {
  id: string;
  url?: string;
  paused?: boolean;
  stack?: { id: string; version: string };
};

/**
 * Every app, for the edge's /apps and its health check: this machine's registry when it has one
 * (a PC), else each repo's shipify.json on GitHub, read with the bot's read-only token (a box keeps
 * no registry). Whether an app is down on purpose is the status record's (the Operate job marks
 * it), so the GitHub list says nothing about it.
 */
function appsHere(): AppRow[] {
  const local = tryOr(
    () =>
      loadRegistry()
        .projects.filter((p) => p.kind === "app")
        .map((p) => {
          const [id, version] = String(p.stack ?? "").split("@");
          return {
            id: p.id,
            ...(p.urls?.production ? { url: p.urls.production } : {}),
            ...((p as { paused?: boolean }).paused ? { paused: true } : {}),
            ...(id && version ? { stack: { id, version } } : {}),
          };
        }),
    [] as AppRow[],
  );
  return local.length ? local : appsOnGitHub(process.env.SHIPIFY_READ_TOKEN || undefined);
}

/** Apps from GitHub (lib/projects-on-github.ts): each one whose shipify.json says app. */
export const appsOnGitHub = (token: string | undefined): AppRow[] =>
  projectsOnGitHub(token)
    .filter((p) => p.kind === "app")
    .map((p) => ({
      id: p.id,
      ...(p.url ? { url: p.url } : {}),
      ...(p.stack ? { stack: p.stack } : {}),
    }));

// ---------------------------------------------------------------- recipes (ADR 0032)

export interface RecipesKept {
  /** Each recipe on main and its task, for the status task, `/recipes` and the page; undefined
   * when GitHub couldn't list the tasks (the record keeps what it had). */
  rows?: { name: string; task?: number; every?: string; next?: string; paused?: boolean }[];
  events: string[];
  /** Files that don't read, each with what's wrong: said on the status task, nothing silent. */
  problems: { file: string; problem: string }[];
}

/**
 * Recipes and their tasks kept in step, one more duty of the due run: a new file gets its task
 * ("Recipe: <name>", labelled recipe and repeats) and that task's run; a changed or removed file
 * starts its task's run, which updates or ends the repeat. A closed task is a paused recipe. The
 * repeat's times are the due run's as for any repeat.
 */
export function keepRecipes(root = PLATFORM_ROOT): RecipesKept {
  const { recipes, problems } = readRecipes(root);
  const events: string[] = [];
  // Without the list of tasks nothing is opened: a recipe would look task-less and get a second.
  let tasks: Issue[];
  try {
    tasks = rec()
      .issues({ labels: [RECIPE_LABEL.name], state: "all" })
      .filter((i) => !i.pull_request);
  } catch (e) {
    return {
      events: [
        `couldn't list the recipes' tasks (${(e as Error).message.slice(0, 120)}): next time`,
      ],
      problems,
    };
  }
  const busy = tryOr(activeTasks, new Set<number>());
  const start = (n: number, why: string) => {
    if (busy.has(n)) return;
    const r = queue().dispatch("task.yml", { issue: String(n), job: "run" });
    events.push(r.ok ? `started #${n} (${why})` : `couldn't start #${n}: ${r.error}`);
  };
  const stateOf = (n: number): TaskState | undefined =>
    tryOr(() => findStatus(rec().comments(n)).state, undefined);
  const rows: NonNullable<RecipesKept["rows"]> = [];
  for (const r of recipes) {
    const mine = tasks.filter((i) => recipeOf(i.title) === r.name);
    const task =
      mine.find((i) => i.state === "open") ?? mine.sort((a, b) => b.number - a.number)[0];
    if (!task) {
      const made = tryOr(() => {
        rec().makeLabel(RECIPE_LABEL);
        rec().makeLabel(REPEATS_LABEL);
        return rec().createIssue({
          title: recipeTitle(r.name),
          body: `This task runs the recipe [\`recipes/${r.name}.md\`](https://github.com/${platformRepo()}/blob/main/recipes/${r.name}.md), as merged on main. Each run's reply comes here. Say \`again\` to run it now; close this task to pause it; remove the file to end it.`,
          labels: [RECIPE_LABEL.name, REPEATS_LABEL.name],
        });
      }, undefined);
      if (!made) {
        events.push(`couldn't open the task for recipes/${r.name}.md`);
        continue;
      }
      events.push(`opened #${made.number} for recipes/${r.name}.md`);
      start(made.number, "a new recipe");
      rows.push({ name: r.name, task: made.number });
      continue;
    }
    const st = stateOf(task.number);
    const paused = task.state === "closed";
    if (!paused && st?.recipe?.hash !== r.hash) start(task.number, "its recipe changed");
    rows.push({
      name: r.name,
      task: task.number,
      ...(st?.repeat?.every ? { every: st.repeat.every } : {}),
      ...(st?.repeat?.next && !paused ? { next: st.repeat.next } : {}),
      ...(paused || st?.repeat?.paused ? { paused: true } : {}),
    });
  }
  // A recipe whose file is gone: its open task's run ends it.
  const names = new Set([
    ...recipes.map((r) => r.name),
    ...problems.map((p) => p.file.slice(8, -3)),
  ]);
  for (const t of tasks.filter((i) => i.state === "open")) {
    const name = recipeOf(t.title);
    if (name && !names.has(name)) start(t.number, "its recipe was removed");
  }
  // A file that doesn't read: its task's run pauses it and says why.
  for (const p of problems) {
    const name = p.file.slice(8, -3);
    const t = tasks.find((i) => i.state === "open" && recipeOf(i.title) === name);
    if (t && stateOf(t.number)?.recipe?.hash !== "broken")
      start(t.number, "its recipe doesn't read");
  }
  return { rows, events, problems };
}
