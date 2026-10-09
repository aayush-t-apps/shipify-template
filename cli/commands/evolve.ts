// How apps evolve after creation (ADR 0020): change docs, versions, releases, rollback by version.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { PLATFORM_ROOT } from "../lib/config.ts";
import {
  BUMPS,
  type Bump,
  bumpVersion,
  changesDir,
  listChanges,
  maxBump,
  mermaidBlocks,
  parseChange,
  releaseChangelog,
  setReleased,
  unreleased,
} from "../lib/docs.ts";
import { hasMakeTarget, run } from "../lib/exec.ts";
import { ghRun } from "../lib/github.ts";
import { madeByLine, taskLine, taskNumber, withTask } from "../lib/links.ts";
import { readManifest, writeManifest } from "../lib/manifest.ts";
import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import { AC_RE, TASK_RE } from "../lib/plan.ts";
import { entryFromManifest, loadRegistry } from "../lib/registry.ts";
import { renderString } from "../lib/render.ts";
import { findSecretLike } from "../lib/safety.ts";
import type { RegistryEntry } from "../lib/schemas.ts";
import { submitFiles } from "../lib/submit.ts";

export const MAX_CHANGE_LINES = 150;

/**
 * A registered project by id, or by the path of any checkout of it (a worktree, say), so commands
 * act on the files there. `home` is the registered checkout. By path, an unregistered checkout
 * (a run's clone on a box, which keeps no registry) is read from its own shipify.json.
 */
export function appEntry(
  ref: string,
): RegistryEntry & { dir: string; home: string; registered: boolean } {
  const byPath = ref.includes("/") || ref === ".";
  const manifest = byPath ? readManifest(resolve(ref)) : undefined;
  const id = manifest ? manifest.id : ref;
  const entry = loadRegistry().projects.find((a) => a.id === id);
  if (!entry) {
    if (!manifest) throw new ShipError(`${id} is not registered. Run: pnpm ship list`, "blocked");
    const dir = resolve(ref);
    return { ...entryFromManifest(manifest, dir), dir, home: dir, registered: false };
  }
  const home = resolve(PLATFORM_ROOT, entry.path);
  return { ...entry, dir: byPath ? resolve(ref) : home, home, registered: true };
}

/** Change doc files on origin/main (after a quiet fetch), or [] without a remote. */
function changesOnMain(dir: string): string[] {
  run("git", ["fetch", "-q", "origin", "main"], { cwd: dir });
  const r = run("git", ["ls-tree", "--name-only", "origin/main", "docs/changes/"], { cwd: dir });
  return r.code === 0
    ? r.stdout
        .split("\n")
        .filter(Boolean)
        .map((f) => basename(f))
    : [];
}

const git = (dir: string, ...args: string[]) => {
  const r = run("git", args, { cwd: dir });
  if (r.code !== 0) throw new ShipError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

const projectVersion = (dir: string) => readManifest(dir).version;

function findChange(dir: string, n: number) {
  const doc = listChanges(dir).find((d) => d.meta.change === n);
  if (!doc)
    throw new ShipError(
      `No change ${String(n).padStart(4, "0")} in ${changesDir(dir)}.`,
      "blocked",
    );
  return doc;
}

// ---------------------------------------------------------------- change docs

export function changeNew(
  id: string,
  slug: string,
  opts: { title?: string; bump?: string },
): Result {
  const app = appEntry(id);
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    throw new ShipError("Slug must be 3-40 lowercase letters, digits or dashes.", "blocked");
  }
  const bump = (opts.bump ?? "minor") as Bump;
  if (!BUMPS.includes(bump))
    throw new ShipError("--bump must be patch, minor or major.", "blocked");
  // The next number after every change doc here and on main (another branch may have merged one).
  const onMain = changesOnMain(app.dir).map((f) => Number(f.slice(0, 4)) || 0);
  const n = Math.max(0, ...listChanges(app.dir).map((d) => d.meta.change), ...onMain) + 1;
  const nnnn = String(n).padStart(4, "0");
  const file = join(changesDir(app.dir), `${nnnn}-${slug}.md`);
  const template = readFileSync(join(PLATFORM_ROOT, "guides", "change-template.md"), "utf8");
  writeFileSync(
    file,
    withTask(
      renderString(template, {
        N: String(n),
        NNNN: nnnn,
        APP: app.id,
        TITLE: opts.title ?? slug.replace(/-/g, " "),
        BUMP: bump,
      }),
    ),
  );
  return ok("change new", `wrote ${relative(process.cwd(), file)}`, {
    nextSteps: [
      "fill it in: why, spec changes (Added/Changed/Removed with ids), tasks linked to criteria",
      `pnpm ship change check ${id} ${n}`,
    ],
  });
}

/** The project ADRs a change doc links (docs/adr/NNNN-slug.md). */
export const adrLinks = (text: string) => [
  ...new Set(text.match(/docs\/adr\/\d{4}-[a-z0-9-]+\.md/g) ?? []),
];

export function checkChangeText(raw: string, file: string, app: string): Check[] {
  const dir = resolve(dirname(file), "..", "..");
  const checks: Check[] = [];
  const add = (name: string, fn: () => string | undefined) => {
    try {
      checks.push({ name, ok: true, detail: fn() });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message });
    }
  };
  let body = "";
  add("front matter is valid", () => {
    const doc = parseChange(raw, file);
    body = doc.body;
    if (doc.meta.app !== app) throw new Error(`app is ${doc.meta.app}, expected ${app}`);
    if (doc.meta.released)
      throw new Error(`already released in ${doc.meta.released}; write a new change doc`);
    return `${String(doc.meta.change).padStart(4, "0")} · bump ${doc.meta.bump}`;
  });
  add("required sections present", () => {
    const missing = [
      "## Why",
      "## Spec changes",
      "## Alternatives considered",
      "## Rollout and rollback",
      "## Tasks",
      "## Verification",
    ].filter((s) => !body.includes(s));
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
    return undefined;
  });
  add("diagrams are valid Mermaid", () => {
    const { count, problems } = mermaidBlocks(body);
    if (problems.length) throw new Error(problems.join("; "));
    return count ? `${count} diagram(s)` : "none";
  });
  add("linked ADRs are in the project", () => {
    // A hard-to-reverse choice ships its ADR in the same PR as the change doc.
    const links = adrLinks(body);
    const missing = links.filter((l) => {
      const f = join(dir, l);
      return !existsSync(f) || !readFileSync(f, "utf8").includes("## Decision");
    });
    if (missing.length) throw new Error(`write ${missing.join(", ")} (guides/adr-template.md)`);
    return links.length ? links.join(", ") : "none linked";
  });
  const delta = body.split("## Spec changes")[1]?.split("\n## ")[0] ?? "";
  const adds = (delta.split("### Removed")[0] ?? "").trim();
  const acs = [...new Set([...adds.matchAll(AC_RE)].map((m) => m[1] as string))];
  add("added or changed criteria are testable (EARS)", () => {
    const onlyRemovals = !/AC\d/.test(adds) && !/\*\*US\d/.test(adds);
    if (onlyRemovals) return "removals only";
    if (!acs.length) throw new Error("write criteria as ACn.m WHEN … THE APP SHALL …");
    return `${acs.length} criteria`;
  });
  add("every added or changed criterion is verified by a task", () => {
    const tasks = body.split("## Tasks")[1]?.split("\n## ")[0] ?? "";
    if (!(tasks.match(TASK_RE) ?? []).length)
      throw new Error("write tasks as - [ ] T1 [USn] … — verifies: ACn.m");
    const missing = acs.filter((a) => !new RegExp(`\\bAC${a.replace(".", "\\.")}\\b`).test(tasks));
    if (missing.length) throw new Error(`no task verifies AC${missing.join(", AC")}`);
    return undefined;
  });
  add("change number is free on main", () => {
    const mine = basename(file);
    const clash = changesOnMain(dir).find((f) => f.slice(0, 5) === mine.slice(0, 5) && f !== mine);
    if (clash)
      throw new Error(
        `${clash} took ${mine.slice(0, 4)} on main: git mv this doc to the next number`,
      );
    return undefined;
  });
  add("no open questions", () => {
    const n = raw.split("[NEEDS CLARIFICATION").length - 1;
    if (n) throw new Error(`${n} [NEEDS CLARIFICATION] marker(s) left`);
    return undefined;
  });
  add(`change doc stays under ${MAX_CHANGE_LINES} lines`, () => {
    const n = raw.split("\n").length;
    if (n > MAX_CHANGE_LINES) throw new Error(`${n} lines; split it into smaller changes`);
    return `${n} lines`;
  });
  add("no secrets", () => {
    const hit = findSecretLike(raw);
    if (hit) throw new Error(`matches secret pattern ${hit}`);
    return undefined;
  });
  return checks;
}

export function changeCheck(id: string, n: number): Result {
  const app = appEntry(id);
  const doc = findChange(app.dir, n);
  const checks = checkChangeText(doc.raw, doc.file, app.id);
  const failed = checks.filter((c) => !c.ok).length;
  return {
    command: "change check",
    status: failed ? "blocked" : "succeeded",
    summary: failed ? `${failed} check(s) failing` : `${basename(doc.file)} is ready for review`,
    checks,
    nextSteps: failed ? undefined : [`pnpm ship change submit ${id} ${n} --yes`],
  };
}

/** Open a docs-only PR in the app repo. Merging it approves the change. */
export function changeSubmit(id: string, n: number, yes: boolean): Result {
  const check = changeCheck(id, n);
  if (check.status !== "succeeded") return { ...check, command: "change submit" };
  const app = appEntry(id);
  const doc = findChange(app.dir, n);
  const rel = relative(app.dir, doc.file);
  const branch = `change/${basename(doc.file, ".md")}`;
  const planned = [
    `git worktree add <tmp> -b ${branch} origin/main   (your checkout stays on its branch)`,
    `copy ${rel}, commit, git push -u origin ${branch}`,
    "gh pr create (docs only)",
    `${rel} moves to that branch; pull or rebase on main after the merge to get it back`,
  ];
  if (!yes) {
    return {
      command: "change submit",
      status: "requires-approval",
      summary: `would open a docs-only PR for ${rel}`,
      plannedActions: planned,
      nextSteps: [`pnpm ship change submit ${id} ${n} --yes`],
    };
  }
  // Linked ADRs travel in the same PR as the change doc that makes the decision.
  const url = submitFiles({
    dir: app.dir,
    files: [rel, ...adrLinks(doc.body)],
    branch,
    message: `Change ${doc.meta.change}: ${doc.meta.title}`,
    title: `Change ${String(doc.meta.change).padStart(4, "0")}: ${doc.meta.title}`,
    body: [
      `Change doc for review (docs only, no deploy). **Merging approves the change.** Bump: \`${doc.meta.bump}\`.`,
      taskLine(taskNumber(doc.meta.task), true),
      madeByLine(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  return ok("change submit", `opened ${url}`, {
    data: { url },
    nextSteps: [
      "the owner merges the PR to approve",
      "then pull (or rebase on origin/main), implement it and update docs/spec.md",
    ],
  });
}

// ---------------------------------------------------------------- versions

/**
 * Bump shipify.json and CHANGELOG.md for the next release, then run `make version` (if the project
 * has it) so native files follow. Pending change docs (released: null) decide the default bump and
 * get their changelog line and `released:` stamp. Local files only.
 */
export function versionApp(id: string, bumpArg?: string, dirOverride?: string): Result {
  const dir = dirOverride ?? appEntry(id).dir;
  const pending = listChanges(dir).filter((d) => !d.meta.released);
  if (bumpArg && !BUMPS.includes(bumpArg as Bump)) {
    throw new ShipError("Bump must be patch, minor or major.", "blocked");
  }
  const bump = (bumpArg as Bump | undefined) ?? maxBump(pending.map((d) => d.meta.bump));
  const manifest = readManifest(dir);
  if (manifest.releases === false)
    throw new ShipError(
      `${manifest.id} doesn't cut releases (shipify.json "releases": false).`,
      "unsupported",
    );
  const current = manifest.version;
  const next = bumpVersion(current, bump);
  const clFile = join(dir, "CHANGELOG.md");
  if (!existsSync(clFile))
    throw new ShipError("CHANGELOG.md is missing. Run: pnpm ship upgrade", "blocked");
  const lines = pending.map((d) => `${d.meta.title} (docs/changes/${basename(d.file)}).`);
  writeFileSync(clFile, releaseChangelog(readFileSync(clFile, "utf8"), next, lines));
  writeManifest(dir, { ...manifest, version: next });
  for (const d of pending) setReleased(d, next);
  if (hasMakeTarget(dir, "version")) {
    const r = run("make", ["-s", "version"], { cwd: dir, env: { SHIPIFY_VERSION: next } });
    if (r.code !== 0) throw new ShipError(`make version failed: ${(r.stdout + r.stderr).trim()}`);
  }
  return ok("version", `${id} ${current} → ${next} (${bump})`, {
    data: { from: current, to: next, bump, changes: pending.map((d) => basename(d.file)) },
    nextSteps: ["commit these files with the change (or run ship release for staging apps)"],
  });
}

// ---------------------------------------------------------------- releases (apps with staging)

/**
 * The PRs merged since the last release, each with the task it came from (ADR 0017): naming the
 * task here puts "mentioned in Release vX" on its timeline, so it shows when its change went live.
 */
function shippedPrs(repo: string, dir: string, tag: string | undefined): string | undefined {
  const since = tag
    ? run("git", ["log", "-1", "--format=%cI", tag], { cwd: dir }).stdout.trim()
    : "";
  const r = ghRun([
    "pr",
    "list",
    "-R",
    repo,
    "--state",
    "merged",
    "--base",
    "main",
    "--limit",
    "30",
    ...(since ? ["--search", `merged:>=${since}`] : []),
    "--json",
    "number,title,body",
  ]);
  if (r.code !== 0) return undefined;
  let prs: { number: number; title: string; body?: string }[];
  try {
    prs = JSON.parse(r.stdout);
  } catch {
    return undefined;
  }
  if (!prs.length) return undefined;
  const lines = prs.map((p) => {
    const task = /(?:Closes|Part of) ([\w.-]+\/[\w.-]+#\d+)/.exec(p.body ?? "")?.[1];
    return `- #${p.number} ${p.title}${task ? ` (task ${task})` : ""}`;
  });
  return `**Ships:**\n${lines.join("\n")}`;
}

function latestTag(dir: string): string | undefined {
  run("git", ["fetch", "-q", "--tags", "origin"], { cwd: dir });
  return (
    run("git", ["tag", "-l", "v*", "--sort=-v:refname"], { cwd: dir })
      .stdout.split("\n")
      .filter(Boolean)[0] ?? undefined
  );
}

/**
 * Staging apps (ADR 0048: it asks once, and never waits): with nothing new tagged, the next version
 * goes on main, which deploys it to staging, and it says to release again once staging passes; with
 * main's version not yet live, it opens the "Release vX.Y.Z" PR if staging passed it, or says where
 * staging is. The owner merges the PR; CI deploys production and tags the release.
 */
export async function releaseApp(
  id: string,
  yes: boolean,
  opts: { task?: number } = {},
): Promise<Result> {
  const app = appEntry(id);
  if (!app.staging) {
    throw new ShipError(
      `${id} has no staging: its change PR ships it. Bump the version in that PR with: pnpm ship version ${id} <bump>`,
      "unsupported",
    );
  }
  if (!app.repository) throw new ShipError(`${id} is not published yet.`, "blocked");
  const repo = app.repository.replace("https://github.com/", "");
  const dir = app.dir;
  git(dir, "fetch", "-q", "origin");
  if (git(dir, "branch", "--show-current") !== "main")
    throw new ShipError("Switch the app to main first.", "blocked");
  if (git(dir, "status", "--porcelain"))
    throw new ShipError("The app has uncommitted changes.", "blocked");
  if (git(dir, "rev-parse", "HEAD") !== git(dir, "rev-parse", "origin/main")) {
    throw new ShipError("Local main differs from origin/main. Pull or push first.", "blocked");
  }
  const tag = latestTag(dir);
  const version = projectVersion(dir);
  const alreadyTagged = tag === `v${version}`;
  const pendingDocs = listChanges(dir).filter((d) => !d.meta.released);
  const hasPending =
    pendingDocs.length > 0 || unreleased(readFileSync(join(dir, "CHANGELOG.md"), "utf8")) !== "";
  if (alreadyTagged && !hasPending) {
    return {
      command: "release",
      status: "skipped",
      summary: `nothing to release: v${version} is live and nothing is pending`,
    };
  }
  const planned = alreadyTagged
    ? [
        `ship version ${id} (from pending change docs) → commit "Release vNEXT" → push main, which deploys it to staging`,
        "then release again once staging passes it",
      ]
    : [
        `if staging passed v${version}: open PR production ← main "Release v${version}" with the changelog section`,
      ];
  if (!yes) {
    return {
      command: "release",
      status: "requires-approval",
      summary: alreadyTagged
        ? `would release the next version of ${id}`
        : `would release v${version} of ${id}`,
      plannedActions: planned,
      nextSteps: [`pnpm ship release ${id} --yes`],
    };
  }
  if (alreadyTagged) {
    const next = (versionApp(id, undefined, dir).data as { to: string }).to;
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", `Release v${next}`);
    git(dir, "push", "-q", "origin", "main");
    return ok(
      "release",
      `v${next} is on main, and deploys to staging now: release again once it passes`,
      {
        nextSteps: [`gh run watch -R ${repo}`, `then again: pnpm ship release ${id} --yes`],
      },
    );
  }
  const next = version;
  const sha = git(dir, "rev-parse", "HEAD");
  // Where staging is with this commit, read once.
  const state = ghRun([
    "api",
    `repos/${repo}/commits/${sha}/status`,
    "--jq",
    '[.statuses[] | select(.context=="shipify/staging")][0].state // "pending"',
  ]).stdout.trim();
  if (state === "failure" || state === "error")
    throw new ShipError(`Staging failed for v${next}. See: gh run list -R ${repo}`, "failed");
  if (state !== "success")
    return {
      command: "release",
      status: "blocked",
      summary: `staging hasn't passed v${next} yet: release again once it has`,
      nextSteps: [`gh run watch -R ${repo}`, `then again: pnpm ship release ${id} --yes`],
    };
  const existing = ghRun([
    "pr",
    "list",
    "-R",
    repo,
    "--base",
    "production",
    "--head",
    "main",
    "--json",
    "url",
    "--jq",
    ".[0].url // empty",
  ]).stdout.trim();
  const cl = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  const section =
    new RegExp(`## \\[${next.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`)
      .exec(cl)?.[1]
      ?.trim() ?? "";
  const body = [
    `Release **v${next}** (${sha.slice(0, 7)}), which passed staging: ${app.urls.staging ?? ""}`,
    section,
    shippedPrs(repo, dir, tag),
    `Merge with **Create a merge commit**. CI deploys exactly this commit, smoke-tests it (automatic rollback on failure), then tags v${next} and publishes the GitHub Release.`,
    taskLine(opts.task, true),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (existing) {
    ghRun(["pr", "edit", existing, "-R", repo, "--title", `Release v${next}`, "--body", body]);
    return ok("release", `updated ${existing} for v${next}`, {
      data: { url: existing, version: next },
    });
  }
  const url = ghRun([
    "pr",
    "create",
    "-R",
    repo,
    "--base",
    "production",
    "--head",
    "main",
    "--title",
    `Release v${next}`,
    "--body",
    body,
  ]).stdout.trim();
  return ok("release", `opened ${url} (v${next})`, {
    data: { url, version: next },
    nextSteps: ["the owner reviews and merges it (Create a merge commit) to go live"],
  });
}
