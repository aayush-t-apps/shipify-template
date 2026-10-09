// The check's contract (checks/README.md, ADR 0032's kinds): every checks/<name>.mjs is plain Node
// that runs as it is, imports only Node's own modules, and reads no keys. Checked without running
// one: a check may read the web, and tests don't.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers.ts";

const dir = join(ROOT, "checks");
const checks = readdirSync(dir).filter((f) => f.endsWith(".mjs"));

describe("every check keeps its contract", () => {
  it("there is at least the example to copy", () => {
    expect(checks).toContain("example.mjs");
  });

  for (const file of checks) {
    const source = readFileSync(join(dir, file), "utf8");

    it(`${file}: a name a repeat can say, and plain Node that parses`, () => {
      expect(file).toMatch(/^[a-z0-9][a-z0-9-]{0,40}\.mjs$/);
      const r = spawnSync(process.execPath, ["--check", join(dir, file)], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
    });

    it(`${file}: imports only Node's own modules, and reads no keys`, () => {
      const imports = [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)]
        .map((m) => m[1] ?? "")
        .filter(Boolean);
      for (const i of imports) expect(i, `${file} imports ${i}`).toMatch(/^node:/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/\brequire\s*\(/);
    });
  }
});
