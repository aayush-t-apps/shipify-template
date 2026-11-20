// Each box's web console, as a repo variable, SHIPIFY_CONSOLES: {"<box>": "https://…"}. `box add
// --manage` records Cockpit's address there, `box list` shows it and the web chat links it. Any
// console works; nothing here is Cockpit-only. `box remove` takes a box's own out; a box GitHub
// dropped (14 days off, or removed there) left its link, so the status task's github job takes out
// each whose box has no runner on GitHub (task #803).
import { BOX_LABEL, boxOf } from "../contracts/index.ts";
import { ghJson, ghRun } from "./github.ts";
import { ShipError } from "./output.ts";

export const CONSOLES = "SHIPIFY_CONSOLES";

/** The consoles a value holds: {} for none, or for a value that isn't a JSON object. */
export function consolesOf(value: string | undefined): Record<string, string> {
  try {
    const v = JSON.parse(value?.trim() || "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

/**
 * The consoles on GitHub now: {} when the variable isn't there. One that doesn't read throws, so
 * nothing is written over what it couldn't read.
 */
export function readConsoles(repo: string, token?: string): Record<string, string> {
  const r = ghRun(["variable", "get", CONSOLES, "-R", repo], token ? { token } : {});
  if (r.code === 0) return consolesOf(r.stdout);
  // gh's words for a 404 (`variable … was not found`).
  if (/was not found|HTTP 404/.test(r.stderr)) return {};
  throw new ShipError(`${CONSOLES} not read: ${r.stderr.trim().slice(0, 200)}`);
}

/** Keeps these consoles: the variable written, or deleted when none is left. */
export function keepConsoles(repo: string, all: Record<string, string>, token?: string) {
  const none = !Object.keys(all).length;
  const args = none
    ? ["variable", "delete", CONSOLES, "-R", repo]
    : ["variable", "set", CONSOLES, "-R", repo, "--body", JSON.stringify(all)];
  const r = ghRun(args, token ? { token } : {});
  // One deleted already is as good.
  if (r.code !== 0 && !(none && /HTTP 404/.test(r.stderr)))
    throw new ShipError(`${CONSOLES} not written: ${r.stderr.trim().slice(0, 200)}`);
}

/** The boxes GitHub has: each box runner's box (ADR 0020), offline ones too. */
export function boxesOnGitHub(repo: string, token?: string): Set<string> {
  const { runners } = ghJson<{ runners: { name: string; labels: { name: string }[] }[] }>(
    ["api", `repos/${repo}/actions/runners?per_page=100`],
    token ? { token } : {},
  );
  return new Set(
    runners.filter((r) => r.labels.some((l) => l.name === BOX_LABEL)).map((r) => boxOf(r)),
  );
}

/** The consoles of boxes gone from GitHub, by name. */
export const goneConsoles = (all: Record<string, string>, boxes: Set<string>) =>
  Object.keys(all)
    .filter((box) => !boxes.has(box))
    .sort();
