import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { credential, loadCredentials } from "./credentials.ts";

export const PLATFORM_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** Where Shipify keeps its own version: a release sets it (docs/releases.md). */
export const VERSION_FILE = "package.json";
export const PLATFORM_VERSION = (
  JSON.parse(readFileSync(join(PLATFORM_ROOT, VERSION_FILE), "utf8")) as { version: string }
).version;

/**
 * Shipify's own settings, the same in every copy (ADR 0047). A copy's own live on GitHub, as its
 * repo's variables (`copySetting`); its owner and name are the repo's (`platformRepo`).
 */
export interface Config {
  /** Where projects live, relative to the platform root. Override with SHIPIFY_PROJECTS_DIR. */
  projectsDir: string;
  coverageFloor: number;
  defaultExecutor: string;
}

const CONFIG: Config = { projectsDir: "../projects", coverageFloor: 80, defaultExecutor: "manual" };

export const loadConfig = (): Config => ({ ...CONFIG });

/** Your copy's variables as a run has them: the workflows hand over all of them (toJSON(vars)). */
function runVars(): Record<string, string> {
  try {
    const all = JSON.parse(process.env.SHIPIFY_VARS ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(all).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

/**
 * One of your copy's own settings (ADR 0047), kept as a variable on its repo: your time zone, and
 * each value a stack deploys with (its `deploy.vars`). A run has every variable (SHIPIFY_VARS);
 * this PC keeps a copy in its credentials file. Never in a tracked file. A key is a secret, not a
 * setting (`credential`).
 */
export function copySetting(name: string): string | undefined {
  return process.env[name] || runVars()[name] || credential(loadCredentials().values, name);
}

/** Your time zone (IANA), the one repeats run in: SHIPIFY_TIME_ZONE, else UTC. */
export const copyTimeZone = () => copySetting("SHIPIFY_TIME_ZONE") || "UTC";

export function projectsDir(config: Config, root = PLATFORM_ROOT): string {
  return resolve(root, process.env.SHIPIFY_PROJECTS_DIR ?? config.projectsDir);
}
