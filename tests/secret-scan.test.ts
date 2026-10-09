// The secret scan before a PR (cli/lib/secret-scan.ts): the pipeline's own gitleaks, pinned the
// same, on what the PR will hold, and what to do when it finds something. A stand-in gitleaks
// here: a test never downloads.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GITLEAKS, GITLEAKS_CONFIG, secretScan } from "../cli/lib/secret-scan.ts";
import { ROOT, STATELESS } from "./helpers.ts";

/** A stand-in: flags each line with LEAK in it, and lists every file it was shown. */
const FAKE = `#!/usr/bin/env node
const { readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const a = process.argv.slice(2);
if (process.env.ARGS) writeFileSync(process.env.ARGS, JSON.stringify(a));
const root = a[1];
const found = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n);
  if (statSync(p).isDirectory()) walk(p); else {
    appendFileSync(process.env.SEEN, p.slice(root.length + 1) + "\\n");
    readFileSync(p, "utf8").split("\\n").forEach((l, i) => {
      if (l.includes("LEAK")) found.push({ File: p, StartLine: i + 1, RuleID: "generic-api-key" }); }); } } };
walk(root);
writeFileSync(a[a.indexOf("--report-path") + 1], JSON.stringify(found));
process.exit(found.length ? 1 : 0);
`;

describe("the secret scan before a PR", () => {
  const had = process.env.SHIPIFY_GITLEAKS;
  afterEach(() => {
    if (had === undefined) delete process.env.SHIPIFY_GITLEAKS;
    else process.env.SHIPIFY_GITLEAKS = had;
    delete process.env.SEEN;
    delete process.env.ARGS;
  });

  it("pins the same gitleaks as each project's pipeline", () => {
    const yml = readFileSync(join(ROOT, "stacks/_base/files/.github/workflows/ship.yml"), "utf8");
    expect(yml).toContain(`GITLEAKS_VERSION: "${GITLEAKS.version}"`);
    expect(yml).toContain(`GITLEAKS_SHA256: "${GITLEAKS.sha256.x64}"`);
  });

  it("scans what the PR holds (never what git ignores), and says what it found and what to do", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    const git = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/x.js"), "LEAK in a dependency\n");
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests/a.test.ts"), "const ok = 1;\n");
    const fake = join(dir, "..", `gitleaks-${Math.random()}`);
    writeFileSync(fake, FAKE);
    chmodSync(fake, 0o755);
    process.env.SHIPIFY_GITLEAKS = fake;
    process.env.SEEN = join(dir, "..", `seen-${Math.random()}`);
    expect(secretScan(dir)).toBeUndefined();
    expect(readFileSync(process.env.SEEN, "utf8")).not.toContain("node_modules");
    // A new file, not committed yet: the PR will hold it, so it's scanned.
    writeFileSync(join(dir, "tests/b.test.ts"), "const t = 1;\nconst TOKEN = 'LEAK';\n");
    const said = secretScan(dir);
    expect(said).toContain("tests/b.test.ts:2 (generic-api-key)");
    expect(said).toContain("look like no real key");
    // A run's push scans its change alone: a file it didn't touch isn't its to answer for.
    writeFileSync(join(dir, "tests/a.test.ts"), "const fine = 1;\n");
    expect(secretScan(dir, ["tests/a.test.ts"])).toBeUndefined();
    expect(secretScan(dir, ["tests/b.test.ts", "gone.txt"])).toContain("tests/b.test.ts:2");
    expect(secretScan(dir, [])).toBeUndefined();
  });

  it("keeps gitleaks' own rules and adds GitHub's stateless installation token, which they miss", () => {
    const toml = readFileSync(GITLEAKS_CONFIG, "utf8");
    expect(toml).toMatch(/\[extend\]\s*\nuseDefault = true/);
    const regex = /^regex = '''(.+)'''$/m.exec(toml)?.[1] ?? "";
    // gitleaks' RE2 and JavaScript read this pattern the same way.
    const rule = new RegExp(regex);
    expect(rule.test(`const t = "${STATELESS}";`)).toBe(true);
    expect(rule.test(`ghs_${"d".repeat(36)}`)).toBe(false);
    expect(rule.test("see ghs_ tokens in docs/security.md.")).toBe(false);
    // The scan hands gitleaks that config.
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    spawnSync("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "a.txt"), "fine\n");
    const fake = join(dir, "..", `gitleaks-${Math.random()}`);
    writeFileSync(fake, FAKE);
    chmodSync(fake, 0o755);
    process.env.SHIPIFY_GITLEAKS = fake;
    process.env.SEEN = join(dir, "..", `seen-${Math.random()}`);
    process.env.ARGS = join(dir, "..", `args-${Math.random()}`);
    expect(secretScan(dir)).toBeUndefined();
    const args = JSON.parse(readFileSync(process.env.ARGS, "utf8")) as string[];
    expect(args[args.indexOf("--config") + 1]).toBe(GITLEAKS_CONFIG);
  });
});
