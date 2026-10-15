// The workspace on any machine (docs/tasks.md): sync clones and indexes the org's projects, pr
// opens a task's PR the same way every time, and refresh brings a branch up to date with main when
// a sibling PR merged first, redoing the version bump in code rather than by hand.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ADAPTERS } from "../lib/agents.ts";
import { ADD_ALL_BUT_CHECKOUTS, strayCheckouts } from "../lib/checkouts.ts";
import { loadConfig, PLATFORM_ROOT, projectsDir } from "../lib/config.ts";
import {
  type Bump,
  listChanges,
  reopenChangelog,
  resolveChangelogConflicts,
  unreleased,
  unsetReleased,
} from "../lib/docs.ts";
import { hasMakeTarget, run } from "../lib/exec.ts";
import { FORMS_DIR, formUpdates } from "../lib/forms.ts";
import { ghJson, ghRun, platformOwner, platformRepo, previewLabel, repoOf } from "../lib/github.ts";
import { fixesLine, madeByLine, taskLine, taskOf } from "../lib/links.ts";
import { readManifest, writeManifest } from "../lib/manifest.ts";
import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import { sourceControl, useMocks } from "../lib/providers.ts";
import { loadRegistry } from "../lib/registry.ts";
import { secretScan } from "../lib/secret-scan.ts";
import { submitFiles } from "../lib/submit.ts";
import { appEntry, versionApp } from "./evolve.ts";
import { reconcile } from "./operate.ts";

const git = (dir: string, ...args: string[]) => {
  const r = run("git", args, { cwd: dir });
  if (r.code !== 0) throw new ShipError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};
const gitOk = (dir: string, ...args: string[]) => run("git", args, { cwd: dir }).code === 0;

// ---------------------------------------------------------------- sync

/**
 * Clone the org's projects (repos with a shipify.json) that aren't here yet, fast-forward the clean
 * ones on main, and rebuild the index. The index is per machine; GitHub is the source of truth.
 */
export function sync(id?: string): Result {
  const config = loadConfig();
  const owner = platformOwner();
  const dir = projectsDir(config);
  mkdirSync(dir, { recursive: true });
  const platform = platformRepo().split("/")[1];
  let names: string[];
  if (id) names = [id];
  else {
    names = ghJson<{ name: string; isArchived: boolean }[]>([
      "repo",
      "list",
      owner,
      "--limit",
      "500",
      "--json",
      "name,isArchived",
    ])
      .filter((r) => !r.isArchived && r.name !== platform)
      .map((r) => r.name)
      // A project already here is one; only a repo new to this machine is asked about.
      .filter(
        (n) =>
          existsSync(join(dir, n, "shipify.json")) ||
          ghRun(["api", `repos/${owner}/${n}/contents/shipify.json`, "--jq", ".name"]).code === 0,
      );
  }
  // Every project already here is fetched at once, not one after another.
  const present = names.map((n) => join(dir, n)).filter((d) => existsSync(d));
  if (present.length)
    run(
      "sh",
      ["-c", 'for d in "$@"; do git -C "$d" fetch -q origin & done; wait', "sh", ...present],
      {
        timeoutMs: 10 * 60_000,
      },
    );
  const checks: Check[] = [];
  for (const name of names) {
    const pid = name;
    const target = join(dir, pid);
    if (!existsSync(target)) {
      const r = ghRun(["repo", "clone", `${owner}/${name}`, target, "--", "-q"], {
        timeoutMs: 15 * 60_000,
      });
      if (r.code !== 0) {
        if (id) throw new ShipError(`Can't clone ${owner}/${name}: ${r.stderr.trim()}`, "blocked");
        checks.push({ name: pid, ok: false, detail: r.stderr.trim().split("\n").pop() });
        continue;
      }
      checks.push({ name: pid, ok: true, detail: "cloned" });
      continue;
    }
    const branch = run("git", ["branch", "--show-current"], { cwd: target }).stdout.trim();
    const dirty = run("git", ["status", "--porcelain"], { cwd: target }).stdout.trim();
    let detail: string;
    if (branch === "main" && !dirty)
      detail = gitOk(target, "merge", "-q", "--ff-only", "origin/main")
        ? "up to date"
        : "main has diverged from origin: left as it is";
    else
      detail = `on ${branch || "a detached HEAD"}${dirty ? " with local changes" : ""}: left as it is`;
    checks.push({ name: pid, ok: true, detail });
  }
  reconcile();
  writeWorkspaceGuide(dir);
  return ok("sync", `${names.length} project(s) in ${relative(process.cwd(), dir) || "."}`, {
    checks,
  });
}

/**
 * The workspace root (shipify/, projects/, .worktrees/) explains itself to any agent that starts
 * there. Written once, only when projects sit next to shipify.
 */
function writeWorkspaceGuide(dir: string) {
  const ws = dirname(PLATFORM_ROOT);
  if (dirname(dir) !== ws) return;
  const name = basename(PLATFORM_ROOT);
  const guide = `# Shipify workspace

Shipify manages everything in this folder. Run \`pnpm ship …\` from \`${name}/\`; each project is its
own repo in \`projects/<id>\` with its own \`AGENTS.md\`, and \`.worktrees/\` holds parallel work.
`;
  if (!existsSync(join(ws, "AGENTS.md")))
    writeFileSync(join(ws, "AGENTS.md"), `${guide}\nStart with \`${name}/AGENTS.md\`.\n`);
  // Each agent's own files (its instructions, its skills folder), from its adapter.
  for (const a of Object.values(ADAPTERS)) a.workspace?.(ws, name, guide);
}

// ---------------------------------------------------------------- pr

const AFTER_REVIEW = "**After review:**";

/**
 * A PR's description with a later round's change added: a list under "After review", above the
 * task link. The first round's summary stays on top.
 */
export function addToPrBody(body: string, change: string): string {
  const line = `- ${change.trim().replace(/\s*\n\s*/g, " ")}`;
  const parts = body
    .replace(/\r\n/g, "\n")
    .split("\n\n")
    .filter((p) => p.trim());
  if (parts.some((p) => p.split("\n").includes(line))) return parts.join("\n\n");
  const list = parts.findIndex((p) => p.startsWith(AFTER_REVIEW));
  if (list >= 0) parts[list] += `\n${line}`;
  else {
    const at = parts.findIndex((p) =>
      /^(Closes|Part of) |^Opened by Shipify|^Made by .+ with Shipify/.test(p),
    );
    parts.splice(at >= 0 ? at : parts.length, 0, `${AFTER_REVIEW}\n${line}`);
  }
  return parts.join("\n\n");
}

/**
 * A checkout of Shipify itself (the platform repo), such as a task's worktree of it: it has no
 * shipify.json, and its PRs go to the platform's own repo.
 */
export function isPlatformCheckout(dir: string): boolean {
  return ["cli/cli.ts", "intents.json", "stacks", "executors.json"].every((f) =>
    existsSync(join(dir, f)),
  );
}

/** What decides a new project's files: the golden tests check these (ci.yml says the same). */
const GOLDEN =
  /^(stacks|presets)\/|^\.github\/workflows\/pipeline\.yml$|^cli\/lib\/(generate|render|catalog)\.ts$|^cli\/commands\/project\.ts$/;

/** What the branch changes against main (as fetched), and what isn't committed yet. */
function changedFiles(dir: string): string[] {
  return run("git", ["diff", "--name-only", "origin/main...HEAD"], { cwd: dir })
    .stdout.split("\n")
    .concat(
      run("git", ["status", "--porcelain"], { cwd: dir })
        .stdout.split("\n")
        .map((l) => l.slice(3)),
    )
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * What a PR must meet besides its tests, the same wherever it's made (ADR 0018): `ship pr` here,
 * and a task's box before its commits go anywhere (`ship pr <clone> --check`), so nothing CI or a
 * later run would refuse gets in. Against origin/main as it is: the caller fetches when it can.
 *   Shipify:   a CHANGELOG entry under Unreleased, a new version for each stack whose files
 *              changed, and from a task no workflow change.
 *   A project: every change doc readable, and when merging ships a version (packages, apps
 *              without staging), the version bumped past main's with its changelog section.
 */
export function prRules(dir: string): string | undefined {
  return isPlatformCheckout(dir) ? platformRules(dir) : projectRules(dir, readManifest(dir));
}

/**
 * A checkout recorded in the commits (a gitlink no `.gitmodules` declares): a helper's worktree, or
 * a repo of its own, added beside the work by mistake (ADR 0041). The first rule for every PR, so
 * the box and this PC refuse it alike.
 */
function recordedCheckout(dir: string): string | undefined {
  const stray = strayCheckouts(dir);
  if (!stray.length) return undefined;
  return `A checkout is recorded in the commits (${stray.join(", ")}): a helper's worktree or a repo of its own, added by mistake. Merge its branch into yours if you need its work, then git -C ${dir} rm --cached ${stray.join(" ")} and commit, then run ship pr again.`;
}

/** A merge's conflict left in a file: both its labelled lines, which no other text starts with. */
const CONFLICT = /^<<<<<<< [^\n]*\n[\s\S]*?^>>>>>>> /m;

/**
 * A changed file still holding a merge's conflict (`ship staging`'s, or one merged by hand): no
 * check of a project's reads its guides, so this one does, for every PR, on the box and this PC.
 */
function leftConflicts(dir: string): string | undefined {
  const left = [...new Set(changedFiles(dir))].filter((f) => {
    const p = join(dir, f);
    return existsSync(p) && statSync(p).isFile() && CONFLICT.test(readFileSync(p, "utf8"));
  });
  if (!left.length) return undefined;
  return `A merge's conflict is still in ${left.join(", ")}: keep what fits from each side, take out the <<<<<<< ======= >>>>>>> lines, then run ship pr again.`;
}

function platformRules(dir: string): string | undefined {
  const recorded = recordedCheckout(dir) ?? leftConflicts(dir);
  if (recorded) return recorded;
  const changed = changedFiles(dir);
  // A workflow pushed on a branch can run on that push, with this repo's keys, before any review:
  // a task never pushes one (its token can't), and the PR says what to change instead.
  const workflows = changed.filter((f) => f.startsWith(".github/workflows/"));
  if (workflows.length && process.env.SHIPIFY_TASK)
    return `A task can't push workflow changes (${workflows.join(", ")}): they could run with Shipify's keys before your review. Take them out of the branch (playbooks/task.md, "Shipify itself", says how), and put the change in the PR's summary as a diff for the owner to apply.`;
  const docsOnly = changed.every((f) => /\.md$/.test(f) || f.startsWith("docs/"));
  if (!docsOnly && !changed.includes("CHANGELOG.md"))
    return "Add a CHANGELOG.md entry under ## [Unreleased] for this change, then run ship pr again.";
  // What a stack puts in projects (its files, or a layer's it's built from) changed: its version
  // moves (ADR 0005). Its guides and migration notes, read from shipify, don't count.
  const stacks = new Set<string>();
  for (const f of changed) {
    const m = /^stacks\/([^/]+)\/(files\/|layer\.json$|stack\.json$)/.exec(f);
    if (!m?.[1]) continue;
    if (!m[1].startsWith("_")) stacks.add(m[1]);
    else
      for (const s of readdirSync(join(dir, "stacks")))
        if (
          existsSync(join(dir, "stacks", s, "stack.json")) &&
          (
            JSON.parse(readFileSync(join(dir, "stacks", s, "stack.json"), "utf8")) as {
              layers?: string[];
            }
          ).layers?.includes(m[1])
        )
          stacks.add(s);
  }
  for (const s of stacks) {
    const file = `stacks/${s}/stack.json`;
    const before = run("git", ["show", `origin/main:${file}`], { cwd: dir });
    if (before.code !== 0 || !existsSync(join(dir, file))) continue;
    const was = (JSON.parse(before.stdout) as { version: string }).version;
    const now = (JSON.parse(readFileSync(join(dir, file), "utf8")) as { version: string }).version;
    if (was === now)
      return `Stack ${s} changed but ${file} is still ${was}: bump its version (and add stacks/${s}/migrations/<version>.md when projects need to act), then run ship pr again.`;
  }
  return undefined;
}

function projectRules(dir: string, m: ReturnType<typeof readManifest>): string | undefined {
  const recorded = recordedCheckout(dir) ?? leftConflicts(dir);
  if (recorded) return recorded;
  // A change doc `ship version` can't read stops every later release, so it never gets in.
  try {
    listChanges(dir);
  } catch (e) {
    return (e as Error).message;
  }
  if (m.releases === false || (m.kind === "app" && m.staging)) return undefined;
  const onMain = run("git", ["show", "origin/main:shipify.json"], { cwd: dir });
  let old: string | undefined;
  try {
    old =
      onMain.code === 0 ? (JSON.parse(onMain.stdout) as { version?: string }).version : undefined;
  } catch {
    old = undefined;
  }
  // Above main's, or merging ships no new version. Main moved past the branch (a sibling merged
  // first): refresh merges it and redoes the bump. Else the bump is the branch's own to make.
  if (old && !bumpBetween(old, m.version)) {
    if (!gitOk(dir, "merge-base", "--is-ancestor", "origin/main", "HEAD"))
      return `main moved past this branch (it's at ${old}): run pnpm ship refresh ${dir}, then ship pr again.`;
    return old === m.version
      ? `shipify.json is still ${old}, and merging ships a version: run pnpm ship version ${dir} patch (or minor, major), then ship pr again.`
      : `shipify.json is ${m.version}, below main's ${old}: set its version to ${old}, run pnpm ship version ${dir} patch (or minor, major), then ship pr again.`;
  }
  const changelog = join(dir, "CHANGELOG.md");
  if (
    old &&
    !(existsSync(changelog) && readFileSync(changelog, "utf8").includes(`## [${m.version}]`))
  )
    return `CHANGELOG.md has no ## [${m.version}] section: pnpm ship version ${dir} adds it.`;
  return undefined;
}

/**
 * Before a PR to Shipify itself (AGENTS.md, "Changing Shipify itself"): its rules, then pnpm verify
 * and the golden tests when what decides a new project's files changed. Their output goes to
 * stderr, as it runs.
 */
function platformChecks(dir: string): string | undefined {
  run("git", ["fetch", "-q", "origin", "main"], { cwd: dir });
  const problem = platformRules(dir);
  if (problem) return problem;
  const v = run("pnpm", ["verify"], { cwd: dir, show: true });
  if (v.code !== 0) return "pnpm verify failed (above). Fix it, then run ship pr again.";
  if (changedFiles(dir).some((f) => GOLDEN.test(f))) {
    const g = run("pnpm", ["run", "test:golden"], { cwd: dir, show: true });
    if (g.code !== 0)
      return "The golden tests (pnpm run test:golden) failed (above). Fix them, then run ship pr again.";
  }
  return undefined;
}

/**
 * On a PR whose full checks passed here before it opened (ADR 0018): shipify's CI then runs only
 * its fast checks after the merge. A PR without it (Dependabot's, an edit on GitHub, --no-verify)
 * is checked in full.
 */
export const CHECKED_MARK = "<!-- shipify-checked -->";

/**
 * Before a project's PR: its rules first (quick), then make verify (its output goes to stderr, as
 * it runs) and the pipeline's secret scan on what the PR holds.
 */
function prChecks(dir: string, m: ReturnType<typeof readManifest>): string | undefined {
  run("git", ["fetch", "-q", "origin", "main"], { cwd: dir });
  const problem = projectRules(dir, m);
  if (problem) return problem;
  const v = run("make", ["verify"], { cwd: dir, show: true });
  if (v.code !== 0) return "make verify failed (above). Fix it, then run ship pr again.";
  // Tests (a mock provider) scan only with a gitleaks they name: never a download.
  if (!useMocks() || process.env.SHIPIFY_GITLEAKS) {
    const leak = secretScan(dir);
    if (leak) return leak;
  }
  return undefined;
}

/** `ship pr <checkout> --check`: its PR's rules (prRules), with no tests, no fetch and no push. */
export function prCheck(ref: string): Result {
  const dir = resolve(ref);
  const problem = prRules(dir);
  if (problem) throw new ShipError(problem, "blocked");
  return ok("pr", "meets what its PR needs besides its tests");
}

/**
 * Commit what's in the checkout, push its branch and open (or keep) its PR. A task's PR closes the
 * task when it merges; `partOf` links it instead (a big change's doc PR).
 */
export function openPr(
  ref: string,
  opts: {
    task?: number;
    title?: string;
    summary?: string;
    partOf?: boolean;
    /** Also ask CI for a preview link (the PR's label "preview"). */
    preview?: boolean;
    /** false: skip make verify and the version check (--no-verify, for an emergency). */
    verify?: boolean;
    yes: boolean;
  },
): Result {
  // A checkout of Shipify itself opens its PR in the platform repo, after the platform's checks.
  const platform = isPlatformCheckout(resolve(ref));
  const dir = platform ? resolve(ref) : appEntry(ref).dir;
  const m = platform ? undefined : readManifest(dir);
  if (m && !m.repository.url) throw new ShipError(`${m.id} isn't published yet.`, "blocked");
  const repo = m ? repoOf(m.repository.url as string) : platformRepo();
  const branch = run("git", ["branch", "--show-current"], { cwd: dir }).stdout.trim();
  if (!branch || branch === "main" || branch === "production")
    throw new ShipError(
      `${dir} is on ${branch || "a detached HEAD"}. Work on a branch of its own (a worktree).`,
      "blocked",
    );
  const dirty = git(dir, "status", "--porcelain");
  const title = opts.title ?? (dirty ? undefined : git(dir, "log", "-1", "--format=%s"));
  if (!title) throw new ShipError("Give the PR a --title.", "blocked");
  // The task: --task, or the task run's own (ADR 0017), so a task's PR always names it.
  const task = taskOf(opts.task);
  const taskRef = task ? `${platformRepo()}#${task}` : undefined;
  // A repeating task (the box says so) stays open when its PR merges.
  if (process.env.SHIPIFY_TASK_REPEATS === "1") opts = { ...opts, partOf: true };
  const planned = [
    ...(dirty ? [`git add -A (but a checkout inside it) && git commit -m "${title}"`] : []),
    `git push -u origin ${branch}`,
    `open a PR ${branch} → main in ${repo}${taskRef ? ` (${opts.partOf ? "part of" : "closes"} ${taskRef})` : ""}, or keep the open one and add this change to its description`,
    ...(opts.preview ? ["label it preview, so CI makes a preview link"] : []),
  ];
  if (!opts.yes)
    return {
      command: "pr",
      status: "requires-approval",
      summary: `would push ${branch} and open its PR`,
      plannedActions: [
        ...(opts.verify === false
          ? []
          : [
              platform
                ? "pnpm verify (and the golden tests when the stacks changed), the changelog and stack versions, here first"
                : "make verify, and the version check, here first",
            ]),
        ...planned,
      ],
      nextSteps: [`pnpm ship pr ${ref} --yes`],
    };
  // The one check before a PR (ADR 0018), on this machine at no cost: GitHub checks again only
  // after the merge, before it deploys.
  if (opts.verify !== false) {
    const problem = m ? prChecks(dir, m) : platformChecks(dir);
    if (problem) throw new ShipError(problem, "blocked");
  }
  if (dirty) {
    // Everything but a checkout inside it (a helper's worktree): ADR 0041.
    const added = run("sh", ["-c", ADD_ALL_BUT_CHECKOUTS], { cwd: dir });
    if (added.code !== 0)
      throw new ShipError(
        `Couldn't stage the change: ${added.stderr.trim().split("\n")[0]}`,
        "blocked",
      );
    // No issue reference in the message: GitHub would add a line to the task for every commit.
    if (run("git", ["diff", "--cached", "--quiet"], { cwd: dir }).code !== 0)
      git(dir, "commit", "-q", "-m", title);
  }
  run("git", ["fetch", "-q", "origin", "main"], { cwd: dir });
  if (git(dir, "rev-list", "--count", "origin/main..HEAD") === "0")
    throw new ShipError(`${branch} has no commits beyond main: nothing to open.`, "blocked");
  const sc = sourceControl();
  // A preview asked for rides on the run its push or opening starts: the pipeline runs on those,
  // never on a label alone, so the label goes on first (and an open PR's before this push).
  const preview = opts.preview && !useMocks();
  if (preview) previewLabel(repo);
  const existing = sc.pullRequestFor(repo, branch);
  if (existing && preview) ghRun(["pr", "edit", existing, "--add-label", "preview"]);
  const push = run("git", ["push", "-q", "-u", "origin", branch], { cwd: dir });
  if (push.code !== 0)
    throw new ShipError(
      `git push failed: ${push.stderr.trim()}. If the branch moved on GitHub, run: pnpm ship refresh ${ref}`,
    );
  if (existing) {
    // A later round: its change joins the description, so the PR still says all it does.
    const change = opts.summary?.trim() || (dirty ? title : undefined);
    let note = "";
    // A round pushed without the checks takes the PR's mark away: its merge is then checked in full.
    if (change || opts.verify === false)
      try {
        const was = sc.pullRequestBody(existing);
        const now = change ? addToPrBody(was, change) : was;
        const body = opts.verify === false ? now.replace(`\n\n${CHECKED_MARK}`, "") : now;
        if (body !== was) sc.setPullRequestBody(existing, body);
      } catch (e) {
        note = ` (its description wasn't updated: ${(e as Error).message})`;
      }
    return ok("pr", `pushed to ${existing}${note}`, { data: { url: existing, branch } });
  }
  const made = madeByLine();
  const body = [
    opts.summary?.trim(),
    taskLine(task, Boolean(opts.partOf)),
    fixesLine(repo),
    `${made ?? "Opened by Shipify."} Merging it is the approval: CI checks it again, then ships it.`,
    opts.verify === false ? undefined : CHECKED_MARK,
  ]
    .filter(Boolean)
    .join("\n\n");
  const url = sc.openPullRequest({
    cwd: dir,
    base: "main",
    head: branch,
    title,
    body,
    labels: opts.preview ? ["preview"] : [],
  });
  return ok("pr", `opened ${url}`, { data: { url, branch, created: true } });
}

// ---------------------------------------------------------------- refresh

/** The bump a stopped refresh will redo, from its record (`.git/SHIPIFY_REFRESH`). */
const recorded = (stash: string): Bump | undefined =>
  (readFileSync(stash, "utf8").split("\n")[0]?.trim() as Bump) || undefined;

function bumpBetween(from: string, to: string): Bump | undefined {
  const [a, b] = [from, to].map((v) => v.split(".").map(Number)) as [number[], number[]];
  if ((b[0] ?? 0) > (a[0] ?? 0)) return "major";
  if ((b[0] ?? 0) < (a[0] ?? 0)) return undefined;
  if ((b[1] ?? 0) > (a[1] ?? 0)) return "minor";
  if ((b[1] ?? 0) < (a[1] ?? 0)) return undefined;
  return (b[2] ?? 0) > (a[2] ?? 0) ? "patch" : undefined;
}

const MARKERS = /^(<<<<<<<|=======|>>>>>>>)( |$)/m;

/**
 * Bring a task branch up to date with main by merging it (never rewriting history), when a sibling
 * PR merged first. The branch's own version bump is undone first and redone on top of main's
 * version, a change doc whose number main took is renumbered, and changelog conflicts resolve by
 * keeping both sides. Other conflicts stop it: fix the files, then run it again to finish.
 * `fetch: false` on a box, whose clone has just fetched main and holds no key to fetch it again.
 */
export function refresh(ref: string, fetch = true): Result {
  if (isPlatformCheckout(resolve(ref))) return refreshPlatform(ref, resolve(ref), fetch);
  const app = appEntry(ref);
  const dir = app.dir;
  const id = readManifest(dir).id;
  const gitDir = git(dir, "rev-parse", "--absolute-git-dir");
  const stash = join(gitDir, "SHIPIFY_REFRESH");
  const merging = existsSync(join(gitDir, "MERGE_HEAD"));
  const done: string[] = [];
  let bump: Bump | undefined;

  if (merging) {
    const conflicted = git(dir, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter(Boolean);
    const left = conflicted.filter((f) => MARKERS.test(readFileSync(join(dir, f), "utf8")));
    if (left.length) return conflictsLeft(ref, left);
    if (conflicted.length) git(dir, "add", ...conflicted);
    git(dir, "commit", "-q", "--no-edit");
    bump = existsSync(stash) ? recorded(stash) : undefined;
    done.push("finished the merge with your fixes");
  } else {
    if (git(dir, "status", "--porcelain"))
      throw new ShipError("Commit or discard local changes first.", "blocked");
    const branch = git(dir, "branch", "--show-current");
    if (!branch || branch === "main")
      throw new ShipError("Refresh works on a task or change branch, not main.", "blocked");
    if (fetch) git(dir, "fetch", "-q", "origin", "main");
    const merged = gitOk(dir, "merge-base", "--is-ancestor", "origin/main", "HEAD");
    // A refresh whose merge was settled by hand left its bump to redo: redone here, but only while
    // the version isn't above main's yet, so never twice. Any other record is stale.
    const redo = merged && existsSync(stash) ? recorded(stash) : undefined;
    const mainVersion = () =>
      (JSON.parse(git(dir, "show", "origin/main:shipify.json")) as { version: string }).version;
    if (merged && redo && !bumpBetween(mainVersion(), readManifest(dir).version)) {
      bump = redo;
      done.push("finished a refresh whose merge was settled by hand");
    } else if (merged) {
      rmSync(stash, { force: true });
      return {
        command: "refresh",
        status: "skipped",
        summary: `${branch} is up to date with main`,
      };
    } else {
      const base = git(dir, "merge-base", "HEAD", "origin/main");
      const baseVersion = (
        JSON.parse(git(dir, "show", `${base}:shipify.json`)) as { version: string }
      ).version;
      const ours = readManifest(dir).version;
      bump = bumpBetween(baseVersion, ours);
      // The bump to redo, recorded before anything changes.
      writeFileSync(stash, bump ?? "");
      if (bump) {
        // Undo this branch's bump, so main's version and changelog merge without conflicts.
        writeManifest(dir, { ...readManifest(dir), version: baseVersion });
        const cl = join(dir, "CHANGELOG.md");
        const reset = listChanges(dir).filter((d) => unsetReleased(d, ours));
        let text = reopenChangelog(readFileSync(cl, "utf8"), ours);
        // ship version writes pending docs' lines again, maybe under a new number.
        const docLines = reset.map((d) => `(docs/changes/${basename(d.file)})`);
        const pending = unreleased(text);
        const kept = pending
          .split("\n")
          .filter((l) => !docLines.some((d) => l.includes(d)))
          .join("\n");
        if (pending && kept !== pending) text = text.replace(pending, kept.trim());
        writeFileSync(cl, text.replace(/\n{3,}/g, "\n\n"));
        if (hasMakeTarget(dir, "version"))
          run("make", ["-s", "version"], { cwd: dir, env: { SHIPIFY_VERSION: baseVersion } });
        git(dir, "add", "-A");
        git(dir, "commit", "-q", "-m", `Refresh: back to ${baseVersion} before merging main`);
        done.push(`undid the bump to ${ours}`);
      }
      const merge = run("git", ["merge", "-q", "--no-edit", "origin/main"], { cwd: dir });
      if (merge.code !== 0) {
        const conflicted = git(dir, "diff", "--name-only", "--diff-filter=U")
          .split("\n")
          .filter(Boolean);
        if (!conflicted.length) {
          run("git", ["merge", "--abort"], { cwd: dir });
          throw new ShipError(`git merge failed: ${merge.stderr.trim()}`);
        }
        if (conflicted.includes("CHANGELOG.md")) {
          const cl = join(dir, "CHANGELOG.md");
          writeFileSync(cl, resolveChangelogConflicts(readFileSync(cl, "utf8")));
          git(dir, "add", "CHANGELOG.md");
        }
        const left = conflicted.filter((f) => f !== "CHANGELOG.md");
        if (left.length) return conflictsLeft(ref, left);
        git(dir, "commit", "-q", "--no-edit");
      }
      done.push("merged main");
    }
  }

  // A change doc whose number main took moves to the next free number.
  const onMain = git(dir, "ls-tree", "--name-only", "origin/main", "docs/changes/")
    .split("\n")
    .filter(Boolean)
    .map((f) => basename(f));
  const mine = git(
    dir,
    "diff",
    "--name-only",
    "--diff-filter=A",
    "origin/main",
    "HEAD",
    "--",
    "docs/changes/",
  )
    .split("\n")
    .filter(Boolean);
  let next = Math.max(
    0,
    ...onMain.map((f) => Number(f.slice(0, 4)) || 0),
    ...mine.map((f) => Number(basename(f).slice(0, 4)) || 0),
  );
  for (const file of mine) {
    const name = basename(file);
    if (!onMain.some((f) => f.slice(0, 5) === name.slice(0, 5))) continue;
    next += 1;
    const nnnn = String(next).padStart(4, "0");
    const to = join(dirname(file), `${nnnn}${name.slice(4)}`);
    git(dir, "mv", file, to);
    const raw = readFileSync(join(dir, to), "utf8")
      .replace(/^change: \d+$/m, `change: ${next}`)
      .replace(/^# \d{4}:/m, `# ${nnnn}:`);
    writeFileSync(join(dir, to), raw);
    done.push(`renumbered ${name} to ${nnnn}`);
  }
  if (git(dir, "status", "--porcelain")) {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "Refresh: renumber change docs after main");
  }

  if (bump) {
    const v = versionApp(id, bump, dir).data as { to: string };
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", `Version ${v.to}`);
    done.push(`bumped again to ${v.to} (${bump})`);
  }
  rmSync(stash, { force: true });
  return ok("refresh", done.join("; "), {
    nextSteps: [`make -C ${dir} verify`, `pnpm ship pr ${ref} --yes`],
  });
}

/**
 * A checkout of Shipify itself, brought up to date with main the same way, without a version to
 * redo (Shipify's releases are batched): a merge, its changelog conflicts kept on both sides.
 */
function refreshPlatform(ref: string, dir: string, fetch: boolean): Result {
  const gitDir = git(dir, "rev-parse", "--absolute-git-dir");
  if (existsSync(join(gitDir, "MERGE_HEAD"))) {
    const conflicted = git(dir, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter(Boolean);
    const left = conflicted.filter((f) => MARKERS.test(readFileSync(join(dir, f), "utf8")));
    if (left.length) return conflictsLeft(ref, left);
    if (conflicted.length) git(dir, "add", ...conflicted);
    git(dir, "commit", "-q", "--no-edit");
    return ok("refresh", "finished the merge with your fixes", {
      nextSteps: [`pnpm ship pr ${ref} --yes`],
    });
  }
  if (git(dir, "status", "--porcelain"))
    throw new ShipError("Commit or discard local changes first.", "blocked");
  const branch = git(dir, "branch", "--show-current");
  if (!branch || branch === "main")
    throw new ShipError("Refresh works on a task or change branch, not main.", "blocked");
  if (fetch) git(dir, "fetch", "-q", "origin", "main");
  if (gitOk(dir, "merge-base", "--is-ancestor", "origin/main", "HEAD"))
    return { command: "refresh", status: "skipped", summary: `${branch} is up to date with main` };
  const merge = run("git", ["merge", "-q", "--no-edit", "origin/main"], { cwd: dir });
  if (merge.code !== 0) {
    const conflicted = git(dir, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter(Boolean);
    if (!conflicted.length) {
      run("git", ["merge", "--abort"], { cwd: dir });
      throw new ShipError(`git merge failed: ${merge.stderr.trim()}`);
    }
    if (conflicted.includes("CHANGELOG.md")) {
      const cl = join(dir, "CHANGELOG.md");
      writeFileSync(cl, resolveChangelogConflicts(readFileSync(cl, "utf8")));
      git(dir, "add", "CHANGELOG.md");
    }
    const left = conflicted.filter((f) => f !== "CHANGELOG.md");
    if (left.length) return conflictsLeft(ref, left);
    git(dir, "commit", "-q", "--no-edit");
  }
  return ok("refresh", "merged main", { nextSteps: [`pnpm ship pr ${ref} --yes`] });
}

function conflictsLeft(ref: string, files: string[]): Result {
  return {
    command: "refresh",
    status: "blocked",
    summary: `main changed the same lines as this branch in ${files.length} file(s)`,
    checks: files.map((f) => ({
      name: f,
      ok: false,
      fix: "keep both changes where they fit; remove the <<<<<<< ======= >>>>>>> markers",
    })),
    nextSteps: [`then again: pnpm ship refresh ${ref}`],
  };
}

// ---------------------------------------------------------------- forms

/**
 * Keep the task forms' project lists current (lib/forms.ts): rewrite them from the index and open
 * a PR in shipify. Publishing runs this, so a new project shows up after one merge.
 */
export function forms(yes: boolean): Result {
  const updates = formUpdates(loadRegistry().projects).filter(
    ([, before, after]) => before !== after,
  );
  if (!updates.length)
    return { command: "forms", status: "skipped", summary: "the task forms list every project" };
  const files = updates.map(([f]) => relative(PLATFORM_ROOT, join(FORMS_DIR, f)));
  if (!yes)
    return {
      command: "forms",
      status: "requires-approval",
      summary: `would update the project lists in ${files.join(", ")}`,
      plannedActions: [`open a PR in shipify with ${files.join(", ")}`],
      nextSteps: ["pnpm ship forms --yes"],
    };
  for (const [f, , after] of updates) writeFileSync(join(FORMS_DIR, f), after);
  const url = submitFiles({
    dir: PLATFORM_ROOT,
    files,
    branch: `forms/${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`,
    message: "Task forms: the current projects",
    title: "Task forms: the current projects",
    body: 'The project lists in the task forms, from the projects Shipify knows. Merge it and the new ones show up on "New issue".',
  });
  return ok("forms", `opened ${url}`, { data: { url } });
}
