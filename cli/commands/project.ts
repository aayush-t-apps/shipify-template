// Creating and publishing projects (apps and packages): new, validate, verify, build, publish.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadExecutors } from "../lib/agents.ts";
import { findStack } from "../lib/catalog.ts";
import { copySetting, loadConfig, PLATFORM_ROOT, projectsDir } from "../lib/config.ts";
import { credential, loadCredentials } from "../lib/credentials.ts";
import { hasMakeTarget, run } from "../lib/exec.ts";
import { platformOwner } from "../lib/github.ts";
import { type GenerateInput, generate, repoName } from "../lib/generate.ts";
import { MANIFEST_FILE, manifestPath, readManifest, writeManifest } from "../lib/manifest.ts";
import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import { checkPlan, hashText, planPath, readPlan } from "../lib/plan.ts";
import { type RepoState, sourceControl, useMocks } from "../lib/providers.ts";
import { entryFromManifest, loadRegistry, saveRegistry, upsert } from "../lib/registry.ts";
import { findSecretLike } from "../lib/safety.ts";
import { forms } from "./workspace.ts";

const rel = (p: string) => relative(process.cwd(), p) || ".";

export function newProject(input: GenerateInput): Result {
  const config = loadConfig();
  const out = generate({ ...input, log: (l) => process.stderr.write(`${l}\n`) }, config);
  if (input.dryRun) {
    return {
      command: "new",
      status: "skipped",
      summary: `dry run: would create ${out.target}`,
      data: {
        kind: out.manifest.kind,
        stack: `${out.manifest.stack.id}@${out.manifest.stack.version}`,
        preset: out.manifest.preset?.id ?? null,
        target: out.target,
        files: out.files,
        urls: out.manifest.urls,
        requiredVariables: out.manifest.vars,
        requiredSecrets: out.manifest.secrets,
      },
      nextSteps: ["run again without --dry-run"],
    };
  }
  return ok("new", `created ${out.target}`, {
    checks: out.checks,
    data: { path: out.target, id: out.manifest.id },
    nextSteps: [`pnpm ship validate ${rel(out.target)}`],
  });
}

// ---------------------------------------------------------------- the contract

/** Files every project has, whatever its stack (the _base layer plus the docs). */
const CONTRACT_FILES = [
  MANIFEST_FILE,
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "CHANGELOG.md",
  "Makefile",
  "docs/spec.md",
  "docs/changes",
  ".github/workflows/ship.yml",
  ".githooks/pre-push",
];
const TARGETS: Record<string, string[]> = {
  app: ["setup", "check", "test", "build", "verify", "deploy"],
  package: ["setup", "check", "test", "build", "verify"],
};

/** Files in the project that git would track: everything not ignored. */
function projectFiles(dir: string): string[] {
  const r = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: dir,
  });
  if (r.code !== 0) throw new Error(`not a git repository: ${r.stderr.trim()}`);
  return r.stdout.split("\0").filter((f) => f && existsSync(join(dir, f)));
}

/** Check a project against the Shipify contract (docs/design.md). */
export function validateProject(path: string): Result {
  const dir = resolve(path);
  const checks: Check[] = [];
  const add = (name: string, fn: () => string | undefined) => {
    try {
      checks.push({ name, ok: true, detail: fn() });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message });
    }
  };
  let kind = "app";
  let id = "";
  add(`${MANIFEST_FILE} is valid`, () => {
    const m = readManifest(dir);
    kind = m.kind;
    id = m.id;
    return `${m.id} · ${m.kind} · ${m.stack.id}@${m.stack.version}`;
  });
  add("contract files present", () => {
    const missing = CONTRACT_FILES.filter((f) => !existsSync(join(dir, f)));
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
    return undefined;
  });
  add("make targets present", () => {
    const missing = (TARGETS[kind] ?? []).filter((t) => !hasMakeTarget(dir, t));
    if (missing.length) throw new Error(`missing ${missing.map((t) => `make ${t}`).join(", ")}`);
    return undefined;
  });
  add("its pipeline is its own (ADR 0048)", () => {
    const pipeline = readFileSync(join(dir, ".github/workflows/ship.yml"), "utf8");
    // Its stack's ship.yml, calling no other repo's workflow: nothing outside it decides its CI.
    if (/^\s*uses:\s*[\w.-]+\/[\w.-]+\/\.github\/workflows\//m.test(pipeline))
      throw new Error("ship.yml calls another repo's workflow: run pnpm ship upgrade");
    return undefined;
  });
  add("semantic version with a changelog section", () => {
    const v = readManifest(dir).version;
    if (!readFileSync(join(dir, "CHANGELOG.md"), "utf8").includes(`## [${v}]`))
      throw new Error(`CHANGELOG.md has no ## [${v}]`);
    return `v${v}`;
  });
  if (kind === "app") {
    add("URLs and health path for the deploy check", () => {
      const m = readManifest(dir);
      if (!m.urls.production) return "no URL yet: CI can't smoke-test deploys until it's set";
      if (m.staging && !m.urls.staging)
        throw new Error("staging is on but urls.staging is missing");
      return m.health ? `${m.urls.production}${m.health}` : "no health path: CI can't smoke-test";
    });
  }
  add(".gitignore covers local secrets", () => {
    const gi = existsSync(join(dir, ".gitignore"))
      ? readFileSync(join(dir, ".gitignore"), "utf8")
      : "";
    const missing = [".env"].filter((p) => !gi.includes(p));
    if (missing.length) throw new Error(`add ${missing.join(", ")} to .gitignore`);
    return undefined;
  });
  add("no secret-looking values in files", () => {
    const hits = projectFiles(dir).filter((f) => {
      const p = join(dir, f);
      return (
        statSync(p).isFile() &&
        statSync(p).size < 512_000 &&
        !f.endsWith(".yaml") &&
        findSecretLike(readFileSync(p, "utf8"))
      );
    });
    if (hits.length) throw new Error(hits.join(", "));
    return undefined;
  });
  add("registered", () => {
    if (!loadRegistry().projects.some((a) => a.id === id))
      throw new Error("run: pnpm ship register <path>");
    return undefined;
  });
  const failed = checks.filter((c) => !c.ok).length;
  return {
    command: "validate",
    status: failed ? "failed" : "succeeded",
    summary: failed ? `${failed} check(s) failed` : "project meets the Shipify contract",
    checks,
  };
}

export function verifyProject(path: string): Result {
  const dir = resolve(path);
  readManifest(dir);
  const r = run("make", ["verify"], { cwd: dir, inherit: true });
  return r.code === 0
    ? ok("verify", "make verify passed")
    : { command: "verify", status: "failed", summary: "make verify failed (see output above)" };
}

// ---------------------------------------------------------------- build an approved plan

/** A plan is approved when the same file is on origin/main, i.e. its plan PR was merged. */
export function approvedPlanHash(
  id: string,
): { ok: true; hash: string } | { ok: false; reason: string } {
  const file = relative(PLATFORM_ROOT, planPath(id));
  if (run("git", ["fetch", "-q", "origin", "main"], { cwd: PLATFORM_ROOT }).code !== 0) {
    return {
      ok: false,
      reason: "Can't reach origin/main. The plan must be merged on GitHub before building.",
    };
  }
  const show = run("git", ["show", `origin/main:${file}`], { cwd: PLATFORM_ROOT });
  if (show.code !== 0)
    return {
      ok: false,
      reason: `${file} isn't on origin/main yet. Merge the plan PR to approve it.`,
    };
  return { ok: true, hash: hashText(show.stdout) };
}

export function buildProject(opts: {
  id: string;
  executor?: string;
  resume: boolean;
  source?: string;
  /** A run's clone of the new, empty repo on a box: lay the plan's stack out there, and stop. */
  into?: string;
}): Result {
  const config = loadConfig();
  const plan = readPlan(opts.id);
  // On a box, a merged plan's publish run: this copy of Shipify is main's, so the plan here is the
  // merged one, and the github job made its repo. The stack's files go into the run's clone; the
  // agent builds from there.
  if (opts.into) {
    const g = generate(
      {
        name: plan.meta.app,
        stack: plan.meta.stack,
        preset: plan.meta.preset,
        description: plan.meta.summary,
        visibility: plan.meta.visibility,
        staging: plan.meta.staging,
        secrets: plan.meta.secrets,
        service: plan.meta.service,
        options: plan.meta.options,
        plan,
        into: opts.into,
        repositoryUrl: `https://github.com/${platformOwner()}/${repoName(plan.meta.app)}`,
        install: false,
        verify: false,
        dryRun: false,
        log: (l) => process.stderr.write(`${l}\n`),
      },
      config,
    );
    return ok("build", `laid out ${opts.id} (${g.files.length} files) in ${opts.into}`);
  }
  const target = join(projectsDir(config), opts.id);
  if (!opts.resume) {
    const approved = approvedPlanHash(opts.id);
    if (!approved.ok) throw new ShipError(approved.reason, "blocked");
    if (approved.hash !== plan.hash) {
      throw new ShipError(
        `Local plan (${plan.hash}) differs from the merged plan (${approved.hash}). Pull main first.`,
        "blocked",
      );
    }
    if (existsSync(target))
      throw new ShipError(`${target} exists. Use --resume to continue a build.`, "blocked");
    const failing = checkPlan(plan, projectsDir(config)).filter((c) => !c.ok);
    if (failing.length)
      throw new ShipError("The plan no longer passes its checks.", "blocked", failing);
    generate(
      {
        name: plan.meta.app,
        stack: plan.meta.stack,
        preset: plan.meta.preset,
        description: plan.meta.summary,
        visibility: plan.meta.visibility,
        staging: plan.meta.staging,
        secrets: plan.meta.secrets,
        service: plan.meta.service,
        options: plan.meta.options,
        source: opts.source,
        plan,
        install: true,
        verify: false,
        dryRun: false,
        log: (l) => process.stderr.write(`${l}\n`),
      },
      config,
    );
  } else if (!existsSync(manifestPath(target))) {
    throw new ShipError(`Nothing to resume at ${target}.`, "blocked");
  }

  const executors = loadExecutors();
  const execId = opts.executor ?? config.defaultExecutor;
  // "manual" (the default): scaffold it, and you or the agent you're talking to builds it.
  const executor = execId === "manual" ? { manual: true, command: undefined } : executors[execId];
  if (!executor)
    throw new ShipError(`Unknown executor "${execId}". See executors.json.`, "blocked");
  const promptFile = join(target, ".ship-build-prompt.md"); // gitignored
  const prompt = [
    readFileSync(join(PLATFORM_ROOT, "playbooks", "build-app.md"), "utf8"),
    readFileSync(join(PLATFORM_ROOT, "guides", "design-brief.md"), "utf8"),
    readFileSync(join(PLATFORM_ROOT, "guides", "quality-bar.md"), "utf8"),
    `# Approved plan\n\n${plan.raw}`,
  ].join("\n\n---\n\n");
  writeFileSync(promptFile, prompt);

  if (!opts.resume) {
    if (executor.manual || !executor.command) {
      return {
        command: "build",
        status: "requires-approval",
        summary: `scaffolded ${target}; implement the plan with any agent or by hand`,
        nextSteps: [
          `the build prompt is ${rel(promptFile)} (run in ${rel(target)})`,
          `then: pnpm ship build ${opts.id} --resume`,
        ],
      };
    }
    const args = executor.command.map((a) =>
      a
        .replace("{promptFile}", promptFile)
        .replace("{promptText}", prompt)
        .replace("{cwd}", target),
    );
    const [cmd, ...rest] = args;
    process.stderr.write(`  … running executor "${execId}" in ${target}\n`);
    const r = run(cmd as string, rest, { cwd: target, inherit: true });
    if (r.code !== 0) {
      return {
        command: "build",
        status: "failed",
        summary: `executor "${execId}" exited with ${r.code}`,
        nextSteps: [`fix by hand or with another agent, then: pnpm ship build ${opts.id} --resume`],
      };
    }
  }
  const verify = run("make", ["verify"], { cwd: target, inherit: true });
  if (verify.code !== 0) {
    return {
      command: "build",
      status: "failed",
      summary: "make verify failed",
      nextSteps: [`fix, then: pnpm ship build ${opts.id} --resume`],
    };
  }
  run("git", ["add", "-A"], { cwd: target });
  run(
    "git",
    ["commit", "-q", "-m", `Build ${opts.id} from plan r${plan.meta.revision} (${plan.hash})`],
    { cwd: target },
  );
  return ok("build", `${opts.id} is built and verified`, {
    nextSteps: [`pnpm ship publish ${rel(target)}`],
  });
}

// ---------------------------------------------------------------- publish

/**
 * What a project's repo needs before its first push: everything that takes keys (ADR 0030 §0).
 * From a built project's manifest, or, before a build, from its merged plan (`repoSpecFromPlan`).
 */
export interface RepoSpec {
  id: string;
  kind: "app" | "package";
  description: string;
  visibility: "public" | "private";
  staging: boolean;
  stack: string;
  vars: string[];
  secrets: { deploy: string[]; runtime: string[] };
}

/** A merged plan's repo, as its build will make it (the same fields `generate` writes). */
export function repoSpecFromPlan(plan: string): RepoSpec {
  const { meta } = readPlan(plan);
  const stack = findStack(meta.stack);
  const isApp = stack.kind === "app";
  return {
    id: meta.app,
    kind: stack.kind,
    description: meta.summary,
    visibility: meta.visibility,
    staging: meta.staging,
    stack: stack.id,
    vars: isApp ? (stack.deploy?.vars ?? []) : [],
    secrets: {
      deploy: isApp ? Object.keys(stack.deploy?.secrets ?? {}) : [],
      runtime: meta.secrets ?? [],
    },
  };
}

function specFromManifest(m: ReturnType<typeof readManifest>): RepoSpec {
  return {
    id: m.id,
    kind: m.kind,
    description: m.description,
    visibility: m.repository.visibility,
    staging: m.staging,
    stack: m.stack.id,
    vars: m.vars,
    secrets: m.secrets,
  };
}

/** The repo's name, its values from this machine's config and credentials, and what's missing. */
function repoPlan(spec: RepoSpec) {
  const repo = `${platformOwner()}/${repoName(spec.id)}`;
  const creds = loadCredentials().values;
  // Variables: your copy's settings (ADR 0047).
  const wantVars: Record<string, string> = {};
  const missingVars = spec.vars.filter((name) => {
    const value = copySetting(name);
    if (value) wantVars[name] = value;
    return !value;
  });
  // Secrets: deploy secrets come from the local credential the stack names; runtime ones by name.
  const sources = spec.kind === "app" ? (findStack(spec.stack).deploy?.secrets ?? {}) : {};
  const secretValue = (name: string) => credential(creds, sources[name] ?? name);
  const allSecrets = [...spec.secrets.deploy, ...spec.secrets.runtime];
  return {
    repo,
    web: `https://github.com/${repo}`,
    wantVars,
    missingVars,
    secretValue,
    allSecrets,
  };
}

/**
 * The repo side of publishing, which needs keys (ADR 0030 §0): the repo, its settings, variables
 * and secrets. On GitHub's runners for a task (`ship run github`), or this PC. Safe to run again:
 * it only adds what's missing. `checks` names anything it couldn't do.
 */
export function prepareRepo(spec: RepoSpec): { repo: string; web: string; checks: Check[] } {
  const p = repoPlan(spec);
  const sc = sourceControl();
  const checks: Check[] = p.missingVars.map((v) => ({
    name: `variable ${v}`,
    ok: false,
    fix: `set ${v}, one of your copy's settings: pnpm ship setup`,
  }));
  if (checks.length) return { repo: p.repo, web: p.web, checks };
  let state = sc.repoState(p.repo);
  if (state.exists && !state.empty)
    throw new ShipError(
      `${p.repo} already has commits. Publishing only goes into a new or empty repo.`,
      "blocked",
    );
  if (!state.exists) sc.createRepo(p.repo, spec.visibility, spec.description);
  sc.configureSettings(p.repo, spec.staging);
  for (const [k, v] of Object.entries(p.wantVars))
    if (state.variables[k] !== v) sc.setVariable(p.repo, k, v);
  for (const s of p.allSecrets) {
    const value = p.secretValue(s);
    if (!state.secrets.includes(s) && value) sc.setSecret(p.repo, s, value);
  }
  state = sc.repoState(p.repo);
  for (const s of p.allSecrets.filter((s) => !state.secrets.includes(s)))
    checks.push({
      name: `secret ${s}`,
      ok: false,
      fix: `! gh secret set ${s} -R ${p.repo}   (paste the value at the prompt)`,
    });
  return { repo: p.repo, web: p.web, checks };
}

/**
 * Publish a built project: its repo (with keys), then its first push. In a task's build
 * (SHIPIFY_PUBLISH=prepared), the repo and its keys were made on GitHub's runners before the
 * build (`ship run github`), so this only pushes: a box never holds the keys (ADR 0030 §0).
 */
export async function publishProject(path: string, yes: boolean): Promise<Result> {
  const dir = resolve(path);
  const m = readManifest(dir);
  const spec = specFromManifest(m);
  const p = repoPlan(spec);
  const { repo, web } = p;
  const isApp = m.kind === "app";
  const prepared = process.env.SHIPIFY_PUBLISH === "prepared";

  const validation = validateProject(dir);
  if (validation.status !== "succeeded") return { ...validation, command: "publish" };
  const dirty = run("git", ["status", "--porcelain"], { cwd: dir }).stdout.trim();
  if (dirty) throw new ShipError(`Working tree is not clean:\n${dirty}`, "blocked");

  const sc = sourceControl();
  const state = sc.repoState(repo);
  const planned: string[] = [];
  if (prepared) {
    planned.push(`use ${repo}, made with its keys on GitHub's runners before the build`);
  } else {
    if (!state.exists) planned.push(`create ${m.repository.visibility} repository ${repo}`);
    planned.push(
      m.staging
        ? "repo settings: merge commits only, keep branches"
        : "repo settings: delete merged branches",
    );
    for (const [k, v] of Object.entries(p.wantVars))
      if (state.variables[k] !== v) planned.push(`set variable ${k}=${v}`);
    for (const v of p.missingVars) planned.push(`stop: variable ${v} has no value yet`);
    for (const s of p.allSecrets.filter((s) => !state.secrets.includes(s)))
      planned.push(
        p.secretValue(s)
          ? `set secret ${s} from your credentials file (never printed)`
          : `ask you to set secret ${s}`,
      );
  }
  planned.push(
    `record the repository in ${MANIFEST_FILE}, commit`,
    `git push -u origin main   (CI ${isApp ? (m.staging ? "deploys staging" : "verifies, deploys production and tags") : "verifies and tags"} v…)`,
  );
  if (m.staging) planned.push("create branch production from main");
  if (!yes) {
    return {
      command: "publish",
      status: "requires-approval",
      summary: `would publish ${m.id} to ${repo} (${m.repository.visibility})`,
      plannedActions: planned,
      nextSteps: [`pnpm ship publish ${path} --yes`],
    };
  }
  if (prepared) {
    if (!state.exists)
      throw new ShipError(
        `${repo} isn't there: it's made on GitHub's runners before the build. Comment **publish** on the task to make it again.`,
        "blocked",
      );
    if (!state.empty)
      throw new ShipError(
        `${repo} already has commits. Publishing only goes into a new or empty repo.`,
        "blocked",
      );
    // The repo's secrets were set from the plan: one the build added can't be set from here.
    const planned = existsSync(planPath(m.id)) ? (readPlan(m.id).meta.secrets ?? []) : [];
    const extra = m.secrets.runtime.filter((s) => !planned.includes(s));
    if (extra.length)
      return {
        command: "publish",
        status: "blocked",
        summary: `the build needs ${extra.length} secret(s) its plan didn't name`,
        checks: extra.map((s) => ({
          name: `secret ${s}`,
          ok: false,
          fix: `! gh secret set ${s} -R ${repo}   (paste the value at the prompt), then comment **publish**`,
        })),
      };
  } else {
    const prep = prepareRepo(spec);
    const vars = prep.checks.filter((c) => c.name.startsWith("variable "));
    if (prep.checks.length)
      return {
        command: "publish",
        status: "blocked",
        summary: vars.length
          ? `no value for ${vars.length} repository variable(s)`
          : `${repo} is ready except for ${prep.checks.length} secret(s)`,
        checks: prep.checks,
        nextSteps: [`then again: pnpm ship publish ${path} --yes`],
      };
  }
  const updated = { ...m, repository: { ...m.repository, url: web } };
  const urls = m.urls;
  writeManifest(dir, updated);
  run("git", ["add", MANIFEST_FILE], { cwd: dir });
  run("git", ["commit", "-q", "-m", "Record the repository"], { cwd: dir });
  if (!run("git", ["remote"], { cwd: dir }).stdout.split("\n").includes("origin")) {
    run("git", ["remote", "add", "origin", `${web}.git`], { cwd: dir });
  }
  const push = run("git", ["push", "-u", "origin", "main"], { cwd: dir });
  if (push.code !== 0) throw new ShipError(`git push failed: ${push.stderr.trim()}`);
  if (m.staging) sc.createBranch(repo, "production", "main");
  saveRegistry(upsert(loadRegistry(), entryFromManifest(updated, dir)));
  // The task forms list projects: a small PR adds this one (not in tests, which mock GitHub).
  let formsPr: string | undefined;
  if (!useMocks())
    try {
      formsPr = (forms(true).data as { url?: string } | undefined)?.url;
    } catch {}
  return ok("publish", `published ${web}`, {
    data: { repository: web, urls },
    nextSteps: [
      ...(formsPr ? [`merge ${formsPr} to add ${m.id} to the task forms`] : []),
      `watch CI: gh run watch -R ${repo}`,
      ...(urls.production
        ? [m.staging ? `staging: ${urls.staging}` : `production: ${urls.production}`]
        : []),
    ],
  });
}

export type { RepoState };
