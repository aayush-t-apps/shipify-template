import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ShipError } from "./output.ts";

const NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const RESERVED = new Set([
  "api",
  "app",
  "platform",
  "shipify",
  "staging",
  "production",
  "preview",
  "test",
  "www",
  // A task title's first word says its kind (`new: …`, `remember: …`), so no project can be one.
  "ask",
  "do",
  "new",
  "ping",
  "question",
  "recipe",
  "remember",
  "repeat",
  "try",
]);

/** App names become repo names, Worker names and DNS labels, so keep them boring. */
export function validateAppName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ShipError(
      `Invalid app name "${name}". Use 3-32 characters: lowercase letters, digits and dashes, starting with a letter and not ending with a dash.`,
      "blocked",
    );
  }
  if (name.includes("--")) {
    throw new ShipError(`Invalid app name "${name}": double dashes are not allowed.`, "blocked");
  }
  if (RESERVED.has(name)) {
    throw new ShipError(`"${name}" is reserved. Pick a more specific name.`, "blocked");
  }
}

/**
 * Resolve an output directory and make sure it stays inside the apps root and does not exist yet.
 * Symlinked parents are resolved so a link cannot point the output somewhere else.
 */
export function safeOutputPath(appsRoot: string, target: string): string {
  const root = resolve(appsRoot);
  mkdirSync(root, { recursive: true });
  const realRoot = realpathSync(root);
  const abs = resolve(root, target);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ShipError(
      `Output path "${target}" must be inside the apps directory ${root}.`,
      "blocked",
    );
  }
  const parent = dirname(abs);
  if (existsSync(parent)) {
    const realParent = realpathSync(parent);
    const relParent = relative(realRoot, realParent);
    if (relParent.startsWith("..") || isAbsolute(relParent)) {
      throw new ShipError(
        `Output path "${target}" escapes the apps directory through a symlink.`,
        "blocked",
      );
    }
  }
  if (existsSync(abs) || isDanglingLink(abs)) {
    throw new ShipError(`"${abs}" already exists. ship never overwrites a directory.`, "blocked");
  }
  return abs;
}

function isDanglingLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Patterns that look like credentials. Used to refuse writing them into manifests, plans or logs. */
const SECRET_PATTERNS: RegExp[] = [
  // GitHub's tokens, in both shapes: 36 letters or digits, and the stateless ghs_<app id>_<JWT>.
  /\bgh[pousr]_(?:[A-Za-z0-9]{30,}|\d+_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}/,
  /(?:api[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/i,
];

export function findSecretLike(text: string): string | undefined {
  for (const re of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) return re.source;
  }
  return undefined;
}

/**
 * Text going onto an issue with anything that looks like a credential replaced: GitHub and API
 * tokens, private keys, JWTs, bearer headers and key=value secrets. What the agent writes is shown
 * to whoever can read the repo, so a token it read by mistake never reaches a comment.
 */
export { maskSecrets } from "../contracts/mask.ts";
