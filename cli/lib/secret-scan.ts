// The secret scan before a PR: the pipeline's first check on main (gitleaks, pinned), run by
// `ship pr` on what the PR will hold, so a test value that looks like a key is caught before the
// merge, never after it as a deploy that stops. Downloaded once per machine, checked against its
// pinned hash. The pipeline pins the same version (a test holds them together). A box scans a
// run's change while its checks run (scanAhead), and apply takes that answer for the same bytes.
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { run, runAsync } from "./exec.ts";
import { PLATFORM_ROOT } from "./config.ts";

/**
 * gitleaks' own rules, and one for the shape they miss: GitHub's stateless installation token.
 * Found from `PLATFORM_ROOT` (ADR 0051 B1): the built CLI is one file in `cli/dist/`, where its own
 * `import.meta.url` would look in the wrong place for it.
 */
export const GITLEAKS_CONFIG = join(PLATFORM_ROOT, "cli", "lib", "gitleaks.toml");

export const GITLEAKS = {
  version: "8.30.1",
  sha256: {
    x64: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    arm64: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  } as Record<string, string>,
};

/** This machine's gitleaks: SHIPIFY_GITLEAKS, or the pinned one, fetched once. None: can't here. */
function gitleaks(): string | undefined {
  if (process.env.SHIPIFY_GITLEAKS) return process.env.SHIPIFY_GITLEAKS;
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined;
  const sha = arch && GITLEAKS.sha256[arch];
  if (process.platform !== "linux" || !arch || !sha) return undefined;
  const cache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "shipify");
  const bin = join(cache, `gitleaks-${GITLEAKS.version}-${arch}`);
  if (existsSync(bin)) return bin;
  mkdirSync(cache, { recursive: true });
  const tgz = join(mkdtempSync(join(tmpdir(), "gitleaks-")), "gl.tgz");
  const v = GITLEAKS.version;
  const got = run("curl", [
    "-fsSL",
    "-o",
    tgz,
    `https://github.com/gitleaks/gitleaks/releases/download/v${v}/gitleaks_${v}_linux_${arch}.tar.gz`,
  ]);
  if (got.code !== 0) return undefined;
  if (createHash("sha256").update(readFileSync(tgz)).digest("hex") !== sha) return undefined;
  if (run("tar", ["-xzf", tgz, "-C", dirname(tgz), "gitleaks"]).code !== 0) return undefined;
  copyFileSync(join(dirname(tgz), "gitleaks"), bin);
  chmodSync(bin, 0o755);
  rmSync(dirname(tgz), { recursive: true, force: true });
  return bin;
}

/** Whether the scan can run on this machine: a release refuses to publish without it (ADR 0055). */
export const canScan = () => gitleaks() !== undefined;

/**
 * The scan on what a PR from `dir` will hold (its files, tracked and new, never what git ignores),
 * or only on `files` when given (what a change adds: a run's push scans its change, not the whole
 * repo): nothing when it's clean, or what to do. When gitleaks can't run here it says so and passes:
 * the pipeline scans on main anyway.
 */
export function secretScan(dir: string, files?: string[]): string | undefined {
  const found = secretFindings(dir, files);
  if (!found) return undefined;
  return `The secret scan (gitleaks, as the pipeline runs it on main) found what looks like a key${found.length ? `: ${found.join(", ")}` : ""}. A test value: make it look like no real key ("test-token"). A real key never goes in the code. Then run ship pr again.`;
}

/** What gitleaks found in a file: its path in the change, the line, and the rule. */
interface Finding {
  file: string;
  line: number;
  rule: string;
}

/**
 * A scan's answer, kept for a later scan of the same files: each file's sha256 as gitleaks read it,
 * what it found, and with what (the binary and its rules). Only the box writes one, in a run's out
 * folder (SCANNED), and a scan takes it only for exactly those bytes (secretFindings).
 */
export interface Scanned {
  tool: string;
  files: Record<string, string>;
  found: Finding[];
}

/** A run's kept answer, beside its bundle: think's scan of the change, for decide and apply. */
export const SCANNED = "scanned.json";

/** gitleaks reads this file at the top of the tree for every file it scans. */
const IGNORE = ".gitleaksignore";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** The scan's binary and its rules, as one value: an answer counts only from the same. */
const toolOf = (bin: string) => sha256(`${bin}\n${readFileSync(GITLEAKS_CONFIG, "utf8")}`);

const argsFor = (tree: string, report: string) => [
  "dir",
  tree,
  "--config",
  GITLEAKS_CONFIG,
  "--redact",
  "--no-banner",
  "--exit-code",
  "1",
  "--report-format",
  "json",
  "--report-path",
  report,
];

/** What gitleaks' report says, each path as the change has it; undefined when it can't be read. */
function findingsOf(report: string, tree: string): Finding[] | undefined {
  try {
    return (
      JSON.parse(readFileSync(report, "utf8")) as {
        File: string;
        StartLine: number;
        RuleID: string;
      }[]
    ).map((x) => ({ file: x.File.replace(`${tree}/`, ""), line: x.StartLine, rule: x.RuleID }));
  } catch {
    return undefined;
  }
}

const said = (found: Finding[]) => found.map((x) => `${x.file}:${x.line} (${x.rule})`);

/**
 * What an earlier scan found in these files, when it read each of them as they are now, with the
 * same gitleaks and rules; undefined when it can't answer for them. gitleaks scans each file alone,
 * but for the top's .gitleaksignore: a scan that had one answers only with it.
 */
function answered(
  known: Scanned | undefined,
  files: Record<string, string>,
  tool: string,
): Finding[] | undefined {
  if (!known || known.tool !== tool) return undefined;
  const has = (set: Record<string, string>, f: string) => Object.hasOwn(set, f);
  const same = Object.keys(files).every((f) => has(known.files, f) && known.files[f] === files[f]);
  if (!same || (has(known.files, IGNORE) && !has(files, IGNORE))) return undefined;
  return known.found.filter((x) => has(files, x.file));
}

/** A box's kept answer (SCANNED in `dir`), or none. */
export function scannedIn(dir: string | undefined): Scanned | undefined {
  if (!dir) return undefined;
  try {
    const s = JSON.parse(readFileSync(join(dir, SCANNED), "utf8")) as Scanned;
    return typeof s.tool === "string" && s.files && Array.isArray(s.found) ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the scan found, each `file:line (rule)`; [] when it can't say where; undefined when clean.
 * `known`: a box's earlier answer (scanAhead), taken instead of a new scan when it read exactly
 * these files' bytes; any other set or byte, and gitleaks runs as before.
 */
export function secretFindings(
  dir: string,
  files?: string[],
  known?: Scanned,
): string[] | undefined {
  const bin = gitleaks();
  if (!bin) {
    process.stderr.write("  … secret scan: gitleaks can't run here; the pipeline scans on main\n");
    return undefined;
  }
  if (files && !files.length) return undefined;
  const listed = files
    ? { code: 0, stdout: files.join("\0") }
    : run("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: dir });
  if (listed.code !== 0) return undefined;
  const copy = mkdtempSync(join(tmpdir(), "shipify-scan-"));
  const tree = join(copy, "tree");
  const report = join(copy, ".report.json");
  try {
    const read: Record<string, string> = {};
    for (const f of listed.stdout.split("\0").filter(Boolean)) {
      const from = join(dir, f);
      if (!existsSync(from) || !lstatSync(from).isFile()) continue;
      mkdirSync(dirname(join(tree, f)), { recursive: true });
      copyFileSync(from, join(tree, f));
      read[f] = sha256(readFileSync(join(tree, f)));
    }
    // Nothing left to read (a change that only deletes): nothing to find.
    if (!Object.keys(read).length) return undefined;
    const before = answered(known, read, toolOf(bin));
    if (before) {
      process.stderr.write(
        "  … secret scan: the same files the box scanned while its checks ran\n",
      );
      return before.length ? said(before) : undefined;
    }
    const r = run(bin, argsFor(tree, report));
    if (r.code === 0) return undefined;
    return said(findingsOf(report, tree) ?? []);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** A path a change can hold: relative, plain, inside its tree. */
const plainPath = (f: string) =>
  f.length > 0 &&
  !isAbsolute(f) &&
  normalize(f) === f &&
  !f.split("/").some((p) => p === ".." || p === ".git") &&
  !f.includes("\0");

/**
 * The scan of a change given as its files' paths and bytes, started now and answered later: the box
 * runs it while a run's checks run (kernel/think.ts), and keeps the answer for apply (SCANNED). The
 * bytes come from the agent's side, so the answer is keyed by them: apply takes it only for the same
 * bytes. None when gitleaks can't run here, a path isn't one a change can hold, or it can't say.
 */
export async function scanAhead(
  files: [string, Buffer][],
  timeoutMs: number,
): Promise<Scanned | undefined> {
  const bin = gitleaks();
  if (!bin || !files.length || !files.every(([f]) => plainPath(f))) return undefined;
  const copy = mkdtempSync(join(tmpdir(), "shipify-scan-"));
  const tree = join(copy, "tree");
  const report = join(copy, ".report.json");
  try {
    const read: Record<string, string> = {};
    for (const [f, body] of files) {
      mkdirSync(dirname(join(tree, f)), { recursive: true });
      // `wx`: never the same path twice, never through a link.
      writeFileSync(join(tree, f), body, { flag: "wx" });
      read[f] = sha256(body);
    }
    const tool = toolOf(bin);
    const r = await runAsync(bin, argsFor(tree, report), { timeoutMs });
    if (r.code === 0) return { tool, files: read, found: [] };
    // 1 is both what it found and its own error: only a report that names what it found counts.
    const found = r.code === 1 ? findingsOf(report, tree) : undefined;
    return found?.length ? { tool, files: read, found } : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
