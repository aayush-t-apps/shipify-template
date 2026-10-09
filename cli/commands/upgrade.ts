// `ship upgrade <project>`: bring a project to its stack's current version (ADR 0048). Every stack
// change reaches a project here, its pipeline (`.github/workflows/ship.yml`) included, and ships as
// a PR like any change. The stack's owned files are replaced, and one it no longer renders goes;
// the project's own files are never touched: what it must change by hand is in the stack's
// migration notes. No history is read. `ship staging <project> on|off` merges the stack's staging-dependent files into
// the project's with `git merge-file`, from two renders of the same stack: staging as it was (the
// base) and as it will be.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { findStack, ownedGlobs, type Stack } from "../lib/catalog.ts";
import { loadConfig, PLATFORM_ROOT, PLATFORM_VERSION } from "../lib/config.ts";
import { addUnreleased } from "../lib/docs.ts";
import { hasMakeTarget, run } from "../lib/exec.ts";
import { projectVars, stackUrls } from "../lib/generate.ts";
import { repoOf } from "../lib/github.ts";
import { readManifest, writeManifest } from "../lib/manifest.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { sourceControl } from "../lib/providers.ts";
import { entryFromManifest, loadRegistry, saveRegistry, upsert } from "../lib/registry.ts";
import { renderLayer } from "../lib/render.ts";
import type { Manifest } from "../lib/schemas.ts";
import { appEntry } from "./evolve.ts";

type Action = {
  file: string;
  kind: "write" | "add" | "delete" | "review" | "merge" | "conflict";
  note?: string;
  /** Merged content for merge/conflict. */
  text?: string;
};

export function globToRegExp(glob: string): RegExp {
  const re = glob
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${re}$`);
}

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);

/**
 * Render a stack's layers and files (not its preset: preset files belong to the project from day
 * one). Reads stack.json from `root`, so an older platform commit renders an older stack.
 */
export function renderStack(
  root: string,
  stackId: string,
  vars: Record<string, string>,
  out: string,
) {
  const def = JSON.parse(readFileSync(join(root, "stacks", stackId, "stack.json"), "utf8")) as {
    layers?: string[];
    vars?: Record<string, string>;
  };
  const all = { ...def.vars, ...vars };
  for (const layer of [...(def.layers ?? []), stackId]) {
    const d = join(root, "stacks", layer, "files");
    if (existsSync(d)) renderLayer(d, out, all);
  }
}

/** Three-way merge of one file's text with git: exit code 0 is clean, n > 0 is n conflicts. */
function mergeText(work: string, ours: string, base: string, theirs: string, labels: string[]) {
  const dir = mkdtempSync(join(work, "merge-"));
  const files = ["ours", "base", "theirs"].map((n) => join(dir, n));
  [ours, base, theirs].forEach((text, i) => {
    writeFileSync(files[i] as string, text);
  });
  const r = run("git", ["merge-file", "-p", ...labels.flatMap((l) => ["-L", l]), ...files]);
  if (r.code < 0 || r.code > 127) throw new ShipError(`git merge-file failed: ${r.stderr.trim()}`);
  return { text: r.stdout, conflicts: r.code };
}

/**
 * What `upgrade` (or `staging`) would change. `m` is the project as it will be (default: as it is);
 * `was`, the setting it had at the same stack version, renders the base that `staging` merges from.
 */
export function planUpgrade(dir: string, opts: { m?: Manifest; was?: Manifest } = {}) {
  const m = opts.m ?? readManifest(dir);
  const stack = findStack(m.stack.id);
  const ownedRes = ownedGlobs(stack).map(globToRegExp);
  const isOwned = (f: string) => ownedRes.some((re) => re.test(f));
  const vars = projectVars(loadConfig(), stack, m);

  const work = mkdtempSync(join(tmpdir(), "ship-upgrade-"));
  const next = join(work, "next");
  renderStack(PLATFORM_ROOT, stack.id, vars, next);
  let base: string | undefined;
  if (opts.was) {
    base = join(work, "base");
    renderStack(PLATFORM_ROOT, stack.id, projectVars(loadConfig(), stack, opts.was), base);
  }
  const labels = ["project", `${stack.id} as it was`, `${stack.id} as it will be`];

  const actions: Action[] = [];
  for (const f of walk(next)) {
    const ours = read(join(dir, f));
    const theirs = read(join(next, f)) as string;
    if (ours === theirs) continue;
    if (isOwned(f)) {
      actions.push({ file: f, kind: ours === undefined ? "add" : "write" });
      continue;
    }
    // An upgrade leaves the project's own files as they are: a migration note says what to do.
    if (!base) continue;
    const old = read(join(base, f));
    if (ours === undefined) {
      // New with the setting, or deleted by the project (then it stays deleted).
      if (old === undefined)
        actions.push({ file: f, kind: "add", note: "new with this setting (project-owned)" });
      continue;
    }
    if (old === theirs) continue;
    if (old === undefined)
      actions.push({
        file: f,
        kind: "review",
        note: "the project's own file; the stack's new default wasn't applied: compare by hand",
      });
    else if (ours === old)
      actions.push({ file: f, kind: "write", note: "project-owned, unchanged: updated" });
    else {
      const merged = mergeText(work, ours, old, theirs, labels);
      actions.push(
        merged.conflicts
          ? {
              file: f,
              kind: "conflict",
              text: merged.text,
              note: `${merged.conflicts} conflict(s): resolve the <<<<<<< markers`,
            }
          : {
              file: f,
              kind: "merge",
              text: merged.text,
              note: "the stack's change merged into the project's edits",
            },
      );
    }
  }
  // An owned file the stack no longer renders goes; so does one a setting no longer renders.
  const tracked = run("git", ["ls-files"], { cwd: dir }).stdout.split("\n").filter(Boolean);
  for (const f of tracked) {
    if (existsSync(join(next, f))) continue;
    if (isOwned(f)) actions.push({ file: f, kind: "delete", note: "no longer the stack's" });
    else if (base && existsSync(join(base, f)))
      actions.push(
        read(join(dir, f)) === read(join(base, f))
          ? { file: f, kind: "delete", note: "removed from the stack" }
          : { file: f, kind: "review", note: "removed from the stack but edited in the project" },
      );
  }
  const migrationsDir = join(stack.dir, "migrations");
  const migrations = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".md") && newer(f.replace(/\.md$/, ""), m.stack.version))
        .sort()
        .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    : [];
  return { m, stack, work, next, actions, migrations };
}

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export async function upgradeProject(id: string, yes: boolean): Promise<Result> {
  const project = appEntry(id);
  const dir = project.dir;
  const p = planUpgrade(dir);
  try {
    const from = p.m.stack.version;
    const to = p.stack.version;
    const lines = p.actions.map(
      (a) => `${a.kind.padEnd(8)} ${a.file}${a.note ? `  (${a.note})` : ""}`,
    );
    if (from !== to) lines.push(`record ${p.stack.id} ${to} in shipify.json and CHANGELOG`);
    const summary = `${id}: ${p.stack.id} ${from} → ${to}`;
    if (!lines.length)
      return {
        command: "upgrade",
        status: "skipped",
        summary: `${id} is on ${p.stack.id} ${to} already`,
      };
    if (!yes) {
      return {
        command: "upgrade",
        status: "requires-approval",
        summary,
        plannedActions: lines,
        data: p.migrations.length ? `\n  Migration notes:\n${p.migrations.join("\n")}` : undefined,
        nextSteps: [`pnpm ship upgrade ${id} --yes`],
      };
    }
    if (run("git", ["status", "--porcelain"], { cwd: dir }).stdout.trim())
      throw new ShipError("The project has uncommitted changes.", "blocked");
    // Every change is a PR: on main, the upgrade gets a branch of its own; a worktree or a task's
    // checkout is already on one.
    const onMain = run("git", ["branch", "--show-current"], { cwd: dir }).stdout.trim() === "main";
    if (onMain) run("git", ["switch", "-q", "-c", `upgrade/${p.stack.id}-${to}`], { cwd: dir });
    applyActions(dir, p);
    writeManifest(dir, {
      ...p.m,
      stack: { id: p.stack.id, version: to },
      platformVersion: PLATFORM_VERSION,
    });
    const cl = join(dir, "CHANGELOG.md");
    if (existsSync(cl) && from !== to)
      writeFileSync(
        cl,
        addUnreleased(
          readFileSync(cl, "utf8"),
          `Upgraded stack ${p.stack.id} ${from} → ${to} (Shipify v${PLATFORM_VERSION}).`,
        ),
      );
    // Install what the new files need, then format them the way the project does.
    const setupLog = runSetup(dir, p.stack);
    // A registered project's entry follows its new stack; a run's clone on a box has none to keep.
    if (project.registered)
      saveRegistry(upsert(loadRegistry(), entryFromManifest(readManifest(dir), project.home)));
    const attention = p.actions.filter(
      (a) => a.kind === "review" || a.kind === "conflict" || a.note?.includes("review"),
    );
    return ok(
      "upgrade",
      `${summary}: files updated in ${relative(process.cwd(), dir) || "."}; next: make verify`,
      {
        data:
          [
            ...(attention.length
              ? ["  Look at by hand:", ...attention.map((a) => `    ${a.file}: ${a.note}`)]
              : []),
            ...(p.migrations.length ? ["  Migration notes:", ...p.migrations] : []),
            ...(setupLog ? [setupLog] : []),
          ].join("\n") || undefined,
        nextSteps: [
          `cd ${relative(process.cwd(), dir)} && make verify   (apply migration notes first)`,
          project.staging
            ? `pnpm ship pr ${id} --title "Upgrade to ${p.stack.id} ${p.stack.version}" --yes (merging deploys staging), then: pnpm ship release ${id} --yes`
            : `pnpm ship version ${id} patch, then: pnpm ship pr ${id} --title "Upgrade to ${p.stack.id} ${p.stack.version}" --yes`,
        ],
      },
    );
  } finally {
    rmSync(p.work, { recursive: true, force: true });
  }
}

function applyActions(dir: string, p: { next: string; actions: Action[] }) {
  for (const a of p.actions) {
    const target = join(dir, a.file);
    if (a.kind === "delete") unlinkSync(target);
    if (a.kind === "review") continue;
    if (a.kind === "write" || a.kind === "add") {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(join(p.next, a.file)));
      chmodSync(target, statSync(join(p.next, a.file)).mode & 0o777);
    }
    if (a.kind === "merge" || a.kind === "conflict") writeFileSync(target, a.text ?? "");
  }
}

/**
 * `ship staging <project> on|off`: an app with staging (main deploys staging, a release PR goes
 * live) or without (a merge goes live). It merges the stack's staging-dependent files, updates
 * shipify.json and the repo's merge settings, and ships as a PR. Nothing is deleted: after "off",
 * the production branch and the staging Worker stay until you remove them.
 */
export function stagingSwitch(ref: string, on: boolean, yes: boolean): Result {
  const project = appEntry(ref);
  const dir = project.dir;
  const was = readManifest(dir);
  const word = on ? "on" : "off";
  if (was.kind !== "app")
    throw new ShipError("Only apps have staging; a package ships on each merge.", "unsupported");
  if (was.staging === on)
    return {
      command: "staging",
      status: "skipped",
      summary: `${was.id}: staging is ${word} already`,
    };
  const stack = findStack(was.stack.id);
  if (was.stack.version !== stack.version)
    throw new ShipError(
      `${was.id} is on ${stack.id} ${was.stack.version}; upgrade it first: pnpm ship upgrade ${ref}`,
      "blocked",
    );
  const vars = projectVars(loadConfig(), stack, { ...was, staging: on });
  const { staging: _old, ...rest } = was.urls;
  const m: Manifest = {
    ...was,
    staging: on,
    urls: on ? { ...rest, staging: stackUrls(stack, vars, true).staging } : rest,
  };
  const p = planUpgrade(dir, { m, was });
  const repo = was.repository.url ? repoOf(was.repository.url) : undefined;
  try {
    const lines = [
      ...p.actions.map((a) => `${a.kind.padEnd(8)} ${a.file}${a.note ? `  (${a.note})` : ""}`),
      `shipify.json: staging ${word}${on ? `, urls.staging ${m.urls.staging ?? "?"}` : ", urls.staging removed"}`,
      ...(repo
        ? [
            on
              ? `${repo}: merge commits only, keep branches; create the production branch from main`
              : `${repo}: allow squash merges, delete merged branches`,
          ]
        : []),
      ...(on
        ? []
        : [
            "left as they are: the production branch and the staging Worker (remove them by hand when you want)",
          ]),
    ];
    const next = on
      ? `then: make verify, pnpm ship pr ${ref} --yes; merging deploys staging`
      : `then: make verify, pnpm ship version ${ref} minor, pnpm ship pr ${ref} --yes; merging goes live`;
    if (!yes)
      return {
        command: "staging",
        status: "requires-approval",
        summary: `${was.id}: would turn staging ${word}`,
        plannedActions: lines,
        nextSteps: [`pnpm ship staging ${ref} ${word} --yes`, next],
      };
    if (run("git", ["status", "--porcelain"], { cwd: dir }).stdout.trim())
      throw new ShipError("The project has uncommitted changes.", "blocked");
    const onMain = run("git", ["branch", "--show-current"], { cwd: dir }).stdout.trim() === "main";
    if (onMain) run("git", ["switch", "-q", "-c", `staging-${word}`], { cwd: dir });
    applyActions(dir, p);
    writeManifest(dir, m);
    const cl = join(dir, "CHANGELOG.md");
    if (existsSync(cl))
      writeFileSync(
        cl,
        addUnreleased(
          readFileSync(cl, "utf8"),
          on
            ? "Staging on: main deploys staging, and a release PR goes live."
            : "Staging off: a merge goes live, health-checked and tagged.",
        ),
      );
    if (repo) {
      const sc = sourceControl();
      sc.configureSettings(repo, on);
      if (on) sc.createBranch(repo, "production", "main");
    }
    const setupLog = runSetup(dir, stack);
    // A registered project's entry follows its new stack; a run's clone on a box has none to keep.
    if (project.registered)
      saveRegistry(upsert(loadRegistry(), entryFromManifest(readManifest(dir), project.home)));
    const attention = p.actions.filter((a) => a.kind === "review" || a.kind === "conflict");
    return ok("staging", `${was.id}: staging ${word}; files updated, ${next}`, {
      data:
        [
          ...(attention.length
            ? ["  Look at by hand:", ...attention.map((a) => `    ${a.file}: ${a.note}`)]
            : []),
          ...(setupLog ? [setupLog] : []),
        ].join("\n") || undefined,
    });
  } finally {
    rmSync(p.work, { recursive: true, force: true });
  }
}

/** `make setup` then `make format` (if present). Failures are reported, not thrown: files are written. */
function runSetup(dir: string, stack: Stack): string | undefined {
  if (stack.contractOnly) return undefined;
  for (const target of ["setup", "format"]) {
    if (target === "format" && !hasMakeTarget(dir, target)) continue;
    const r = run("make", [target], { cwd: dir });
    if (r.code !== 0)
      return `  make ${target} failed; fix it before make verify:\n${(r.stdout + r.stderr).trim().split("\n").slice(-20).join("\n")}`;
  }
  return undefined;
}

export type { Stack };
