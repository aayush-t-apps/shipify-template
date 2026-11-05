// The secret scan before a PR (cli/lib/secret-scan.ts): the pipeline's own gitleaks, pinned the
// same, on what the PR will hold, and what to do when it finds something. The stand-in gitleaks
// here (tests/fixtures/fake-gitleaks.mjs, every test's), and the real one once, with this config.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canScan,
  GITLEAKS,
  GITLEAKS_CONFIG,
  secretFindings,
  secretScan,
} from "../cli/lib/secret-scan.ts";
import { ROOT, STATELESS } from "./helpers.ts";

describe("the secret scan before a PR", () => {
  const had = process.env.SHIPIFY_GITLEAKS;
  afterEach(() => {
    if (had === undefined) delete process.env.SHIPIFY_GITLEAKS;
    else process.env.SHIPIFY_GITLEAKS = had;
    delete process.env.FAKE_GITLEAKS_SEEN;
    delete process.env.FAKE_GITLEAKS_ARGS;
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
    process.env.FAKE_GITLEAKS_SEEN = join(dir, "..", `seen-${Math.random()}`);
    expect(secretScan(dir)).toBeUndefined();
    expect(readFileSync(process.env.FAKE_GITLEAKS_SEEN, "utf8")).not.toContain("node_modules");
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
    process.env.FAKE_GITLEAKS_ARGS = join(dir, "..", `args-${Math.random()}`);
    expect(secretScan(dir)).toBeUndefined();
    const args = JSON.parse(readFileSync(process.env.FAKE_GITLEAKS_ARGS, "utf8")) as string[];
    expect(args[args.indexOf("--config") + 1]).toBe(GITLEAKS_CONFIG);
  });

  it("the pinned gitleaks itself reads this config: the stateless token found, a clean file passed", (ctx) => {
    // The one real scan in the tests, fetched once a machine (30 s a start on a Raspberry Pi).
    // Where it can't run (not Linux on x64 or arm64), the pipeline scans on main.
    delete process.env.SHIPIFY_GITLEAKS;
    if (!canScan()) ctx.skip();
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    spawnSync("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "fine.ts"), "const ok = 1;\n");
    writeFileSync(join(dir, "key.ts"), `const t = "${STATELESS}";\n`);
    const found = secretFindings(dir) ?? [];
    expect(found).toContain("key.ts:1 (github-token-stateless)");
    expect(found.filter((f) => !f.startsWith("key.ts:1 "))).toEqual([]);
  }, 180_000);
});
