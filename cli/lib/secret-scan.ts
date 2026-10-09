// The secret scan before a PR: the pipeline's first check on main (gitleaks, pinned), run by
// `ship pr` on what the PR will hold, so a test value that looks like a key is caught before the
// merge, never after it as a deploy that stops. Downloaded once per machine, checked against its
// pinned hash. The pipeline pins the same version (a test holds them together).
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
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./exec.ts";

/**
 * gitleaks' own rules, and one for the shape they miss: GitHub's stateless installation token.
 */
export const GITLEAKS_CONFIG = fileURLToPath(new URL("./gitleaks.toml", import.meta.url));

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

/** What the scan found, each `file:line (rule)`; [] when it can't say where; undefined when clean. */
export function secretFindings(dir: string, files?: string[]): string[] | undefined {
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
  const report = join(copy, ".report.json");
  try {
    for (const f of listed.stdout.split("\0").filter(Boolean)) {
      const from = join(dir, f);
      if (!existsSync(from) || !lstatSync(from).isFile()) continue;
      mkdirSync(dirname(join(copy, "tree", f)), { recursive: true });
      copyFileSync(from, join(copy, "tree", f));
    }
    const r = run(bin, [
      "dir",
      join(copy, "tree"),
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
    ]);
    if (r.code === 0) return undefined;
    let found: string[] = [];
    try {
      found = (
        JSON.parse(readFileSync(report, "utf8")) as {
          File: string;
          StartLine: number;
          RuleID: string;
        }[]
      ).map((x) => `${x.File.replace(`${join(copy, "tree")}/`, "")}:${x.StartLine} (${x.RuleID})`);
    } catch {}
    return found;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
