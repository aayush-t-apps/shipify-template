import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JOB_ENV } from "./env.ts";

export const ROOT = resolve(import.meta.dirname, "..");

export interface Sandbox {
  dir: string;
  /** The job's temporary folder (RUNNER_TEMP), outside the workspace, as on a runner. */
  temp: string;
  apps: string;
  registry: string;
  env: NodeJS.ProcessEnv;
}

const outsideAnyJob = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !JOB_ENV.test(k)));

/** Isolated apps dir + registry, mock providers, no real credentials, nothing from a job. */
export function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "ship-test-"));
  const apps = join(dir, "projects");
  const registry = join(dir, "projects.json");
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, projects: [] }));
  const temp = mkdtempSync(join(tmpdir(), "ship-test-temp-"));
  return {
    dir,
    temp,
    apps,
    registry,
    env: {
      ...outsideAnyJob(),
      RUNNER_TEMP: temp,
      SHIPIFY_PROJECTS_DIR: apps,
      SHIPIFY_REGISTRY_FILE: registry,
      SHIPIFY_PROVIDER: "mock",
      SHIPIFY_MOCK_PRS: join(dir, "mock-prs.txt"),
      SHIPIFY_CREDENTIALS: join(dir, "none.env"),
      // Your copy's workers.dev name (ADR 0047: a setting on GitHub), as a run would have it.
      CF_WORKERS_SUBDOMAIN: "example",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  };
}

export function ship(sb: Sandbox, ...args: string[]) {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", join(ROOT, "cli/cli.ts"), ...args, "--json"],
    {
      cwd: ROOT,
      env: sb.env,
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  let json: {
    status: string;
    summary: string;
    data?: unknown;
    checks?: { name: string; ok: boolean }[];
    plannedActions?: string[];
    nextSteps?: string[];
  } = {
    status: "unparsed",
    summary: r.stdout + r.stderr,
  };
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { code: r.status, ...json };
}

/**
 * A made-up GitHub installation token in its stateless shape (`ghs_<app id>_<JWT>`, rolled out
 * from 2026-04-27, about 520 characters): built here, so no file holds one.
 */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const STATELESS = `ghs_1234567_${b64({ alg: "RS256", typ: "JWT" })}.${b64({ installation: 12345678, app: 1234567, exp: 1791510958 })}.${Buffer.from("made-up-signature-".repeat(12)).toString("base64url")}`;
