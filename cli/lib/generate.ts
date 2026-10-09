import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { resolveSelection, type Stack, stackOptions, unknownOptions } from "./catalog.ts";
import {
  type Config,
  copySetting,
  PLATFORM_ROOT,
  PLATFORM_VERSION,
  projectsDir,
} from "./config.ts";
import { platformOwner } from "./github.ts";
import { writeCreationDocs } from "./docs.ts";
import { hasMakeTarget, run } from "./exec.ts";
import { writeManifest } from "./manifest.ts";
import { type Check, ShipError } from "./output.ts";
import type { Plan } from "./plan.ts";
import { entryFromManifest, loadRegistry, saveRegistry, upsert } from "./registry.ts";
import { listLayer, renderLayer, renderString } from "./render.ts";
import { safeOutputPath, validateAppName } from "./safety.ts";
import type { Manifest } from "./schemas.ts";

export interface GenerateInput {
  name: string;
  stack: string;
  preset: string | null;
  description: string;
  visibility: "public" | "private";
  staging: boolean;
  /** Runtime secret names an app needs (set as repo secrets by publish). */
  secrets?: string[];
  /** Apps: the deployed (URL) name when it should differ from the id. */
  service?: string;
  /** The stack's options to take ("kv", "d1"). */
  options?: string[];
  output?: string;
  /**
   * Lay it out in this folder instead (a run's clone of the new, empty repo on a box): no git init,
   * no registry, nothing installed; the folder may hold .git already.
   */
  into?: string;
  /** Its repository's address, when it's known before publishing (the repo a task's run made). */
  repositoryUrl?: string;
  /** Copy an existing site into the stack's import directory (stack.json `import`). */
  source?: string;
  plan?: Plan;
  install: boolean;
  verify: boolean;
  dryRun: boolean;
  log?: (line: string) => void;
}

export const INITIAL_VERSION = "0.1.0";

/** A project's repo name: its id, on your Shipify repo's owner. */
export const repoName = (id: string) => id;

export function titleCase(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Template variables for a project: the stack's deploy values that are set, required and optional
 * (your copy's settings, ADR 0047), stack vars, the project's own, then its URLs.
 */
export function projectVars(config: Config, stack: Stack, m: Manifest): Record<string, string> {
  const service = m.service ?? m.id;
  const names = [...(stack.deploy?.vars ?? []), ...(stack.deploy?.optionalVars ?? [])];
  const deployVars: Record<string, string> = {};
  for (const name of names) {
    const value = copySetting(name);
    if (value) deployVars[name] = value;
  }
  const vars: Record<string, string> = {
    ...deployVars,
    ...stack.vars,
    APP_ID: m.id,
    APP_NAME: m.name,
    APP_DESCRIPTION: m.description,
    KIND: m.kind,
    IS_APP: String(m.kind === "app"),
    STAGING: String(m.staging),
    // How a change ships, one of three: staging (a release bumps), a bump of its own, or no
    // versions at all (releases: false).
    BUMPS: String(!m.staging && m.releases !== false),
    NO_RELEASES: String(!m.staging && m.releases === false),
    SERVICE_NAME: service,
    SERVICE_NAME_STAGING: `${service}-staging`,
    STACK_ID: stack.id,
    STACK_VERSION: stack.version,
    PRESET_ID: m.preset?.id ?? "none",
    PLATFORM_VERSION,
    COVERAGE_FLOOR: String(config.coverageFloor),
    GH_OWNER: platformOwner(),
    REPO_NAME: repoName(m.id),
    RUNTIME_SECRETS: m.secrets.runtime.join(" "),
    ...optionVars(stack, m),
  };
  // Its URLs, for its files (the README): what the manifest records, else the stack's templates.
  const urls = m.urls?.production ? m.urls : stackUrls(stack, vars, m.staging);
  return { ...vars, URL_PRODUCTION: urls.production ?? "", URL_STAGING: urls.staging ?? "" };
}

/**
 * OPTION_<NAME> for each option the stack offers, OPTION_<NAME>_STAGING with staging on too, and
 * OPTIONS for any of them, as "true" or "false" (templates can't nest `#if`).
 */
function optionVars(stack: Stack, m: Manifest): Record<string, string> {
  const picked = new Set(m.options ?? []);
  return {
    // Any option at all: a block that every option needs (`#if OPTIONS`).
    OPTIONS: String(picked.size > 0),
    ...Object.fromEntries(
      Object.keys(stackOptions(stack)).flatMap((o) => {
        const key = `OPTION_${o.toUpperCase()}`;
        return [
          [key, String(picked.has(o))],
          [`${key}_STAGING`, String(picked.has(o) && m.staging)],
        ];
      }),
    ),
  };
}

/** Render a stack template value (a URL, a review row), naming the fix when a variable is missing. */
export function renderStackValue(stack: Stack, text: string, vars: Record<string, string>): string {
  try {
    return renderString(text, vars, `stacks/${stack.id}`);
  } catch (e) {
    throw new ShipError(
      `${(e as Error).message} Set it as a variable on your Shipify repo (a run reads it there), or in this PC's credentials file.`,
      "blocked",
    );
  }
}

/**
 * The app's URLs, from the stack's URL templates. A template can be a list: the first whose
 * variables are all set wins (your own domain when it's set, say, then the host's default).
 */
export function stackUrls(stack: Stack, vars: Record<string, string>, staging: boolean) {
  const u = stack.deploy?.urls ?? {};
  const isSet = (t: string) =>
    [...t.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)].every((x) => vars[x[1] as string] !== undefined);
  const r = (t?: string | string[]) => {
    if (!t) return undefined;
    const list = [t].flat();
    return renderStackValue(stack, list.find(isSet) ?? (list.at(-1) as string), vars);
  };
  return { production: r(u.production), staging: staging ? r(u.staging) : undefined };
}

export const layerDirs = (stack: Stack, root = PLATFORM_ROOT) =>
  [...stack.layers.map((l) => join(root, "stacks", l, "files")), join(stack.dir, "files")].filter(
    (d) => existsSync(d),
  );

export function generate(input: GenerateInput, config: Config) {
  const log = input.log ?? (() => {});
  validateAppName(input.name);
  const { stack, preset } = resolveSelection(input.stack, input.preset);
  const isApp = stack.kind === "app";
  if (!isApp && input.staging) {
    throw new ShipError("Packages have no staging: they ship as tagged code.", "blocked");
  }
  if (!isApp && input.secrets?.length) {
    throw new ShipError("Packages have no runtime, so no runtime secrets.", "blocked");
  }
  // Into a run's clone, the name is the repo the github job made for it: nothing to clash with here.
  if (!input.into && loadRegistry().projects.some((a) => a.id === input.name)) {
    throw new ShipError(`A project named "${input.name}" is already registered.`, "blocked");
  }
  if (input.source && !stack.import) {
    throw new ShipError(`Stack ${stack.id} can't import an existing site (--source).`, "blocked");
  }
  const target = input.into
    ? resolve(input.into)
    : safeOutputPath(projectsDir(config), input.output ?? input.name);
  const name = input.plan?.meta.title.split(":")[0]?.trim() || titleCase(input.name);
  const deploySecrets = isApp ? Object.keys(stack.deploy?.secrets ?? {}) : [];
  for (const s of input.secrets ?? []) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(s) || deploySecrets.includes(s)) {
      throw new ShipError(`Invalid secret name "${s}".`, "blocked");
    }
  }
  if (/["\\<>`{}]/.test(input.description) || /["\\<>`{}]/.test(name)) {
    throw new ShipError(
      "Name and description may not contain quotes, backslashes, <, >, ` or braces.",
      "blocked",
    );
  }
  if (input.service) validateAppName(input.service);
  const options = [...new Set(input.options ?? [])];
  const unknown = unknownOptions(stack, options);
  if (unknown) throw new ShipError(unknown, "blocked");
  const draft: Manifest = {
    shipify: 1,
    id: input.name,
    name,
    description: input.description,
    kind: stack.kind,
    version: INITIAL_VERSION,
    stack: { id: stack.id, version: stack.version },
    preset: preset ? { id: preset.id, version: preset.version } : null,
    staging: input.staging,
    service: isApp && input.service && input.service !== input.name ? input.service : null,
    repository: {
      visibility: input.visibility,
      ...(input.repositoryUrl ? { url: input.repositoryUrl } : {}),
    },
    urls: {},
    health: isApp ? (stack.deploy?.health ?? null) : null,
    secrets: { deploy: deploySecrets, runtime: input.secrets ?? [] },
    vars: isApp ? (stack.deploy?.vars ?? []) : [],
    ...(options.length ? { options } : {}),
    platformVersion: PLATFORM_VERSION,
    createdAt: new Date().toISOString(),
  };
  const vars = projectVars(config, stack, draft);
  const manifest: Manifest = {
    ...draft,
    urls: isApp ? stackUrls(stack, vars, input.staging) : {},
  };
  const dirs = [...layerDirs(stack), ...(preset ? [join(preset.dir, "files")] : [])];
  const files = [
    ...new Set([
      ...dirs.flatMap((d) => listLayer(d)),
      "shipify.json",
      "CHANGELOG.md",
      "docs/spec.md",
      "docs/changes/0001-create.md",
    ]),
  ].sort();
  if (input.dryRun) return { target, manifest, files, checks: [] as Check[] };

  const tmp = join(dirname(target), `.tmp-${basename(target)}-${randomBytes(4).toString("hex")}`);
  const checks: Check[] = [];
  const step = (verb: string) => {
    log(`  … make ${verb}`);
    const r = run("make", [verb], { cwd: tmp });
    checks.push({
      name: `make ${verb}`,
      ok: r.code === 0,
      detail: r.code === 0 ? undefined : tail(r.stdout + r.stderr),
    });
    if (r.code !== 0) {
      const logFile = join(dirname(tmp), `.ship-failed-${input.name}.log`);
      writeFileSync(logFile, `$ make ${verb}\n${r.stdout}\n${r.stderr}`);
      throw new ShipError(
        `Generation stopped at "make ${verb}". Full log: ${logFile}`,
        "failed",
        checks,
      );
    }
  };
  try {
    mkdirSync(tmp, { recursive: true });
    for (const d of dirs) renderLayer(d, tmp, vars);
    if (input.source && stack.import) {
      copySource(input.source, join(tmp, stack.import.into), stack.import.skip);
    }
    writeManifest(tmp, manifest);
    writeCreationDocs(tmp, { app: input.name, name, plan: input.plan, version: INITIAL_VERSION });
    checks.push({ name: "render and manifest", ok: true, detail: `${files.length} files` });
    // A contract-only stack has nothing to run yet: the project implements the targets.
    if (input.install && !stack.contractOnly) {
      step("setup");
      if (hasMakeTarget(tmp, "format")) step("format");
      if (input.verify) step("verify");
    }
    // Into a run's clone: the files only (its .git stays); the agent builds and commits.
    if (input.into) {
      cpSync(tmp, target, { recursive: true });
      return { target, manifest, files, checks };
    }
    renameSync(tmp, target);
    const label = preset
      ? `${stack.id}@${stack.version} + ${preset.id}`
      : `${stack.id}@${stack.version}`;
    for (const args of [
      ["init", "-q", "-b", "main"],
      ["config", "core.hooksPath", ".githooks"],
      ["add", "-A"],
      ["commit", "-q", "-m", `Create ${input.name} v${INITIAL_VERSION} from ${label}`],
    ]) {
      const r = run("git", args, { cwd: target });
      if (r.code !== 0) throw new ShipError(`git ${args[0]} failed: ${r.stderr.trim()}`);
    }
    checks.push({ name: "git repository initialised", ok: true, detail: "branch main" });
    saveRegistry(upsert(loadRegistry(), entryFromManifest(manifest, target, PLATFORM_ROOT)));
    checks.push({ name: "registered in registry/projects.json", ok: true });
    return { target, manifest, files, checks };
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}

/** Operating-system and version-control leftovers never belong in a served site. */
const JUNK = new Set([".git", ".DS_Store", "__MACOSX", "Thumbs.db"]);

/** Copy an existing site into the served directory, replacing the preset's placeholder. */
function copySource(src: string, dest: string, skip: string[]): void {
  if (!existsSync(src)) throw new ShipError(`Source ${src} does not exist.`, "blocked");
  const skipped = new Set([...JUNK, ...skip]);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (p) =>
      !relative(src, p)
        .split("/")
        .some((seg) => skipped.has(seg) || seg.startsWith("._")),
  });
}

function tail(text: string, lines = 25): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}
