// The CLI built as one file (ADR 0051 B1): what a box starts for every step and for the agent's
// own `ship` commands, from a copy of Shipify with no packages installed. It must hold everything
// it needs and find its files from that copy. Whole runs from it: tests/kernel-flow.test.ts.
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ROOT } from "./helpers.ts";

let copy: string;
let metafile: { outputs: Record<string, { imports: { path: string; external?: boolean }[] }> };

const ship = (...args: string[]) =>
  spawnSync(process.execPath, [join(copy, "cli", "dist", "ship.mjs"), ...args], {
    encoding: "utf8",
    cwd: copy,
  });

beforeAll(() => {
  // As a box makes it: this commit's files, no node_modules, the CLI built into it.
  copy = mkdtempSync(join(tmpdir(), "copy-"));
  execSync(`git archive HEAD | tar -x -C "${copy}"`, { cwd: ROOT });
  const meta = join(copy, "meta.json");
  const built = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts", "build-cli.mjs"),
      "--out",
      join(copy, "cli", "dist", "ship.mjs"),
      "--metafile",
      meta,
    ],
    { encoding: "utf8", cwd: ROOT },
  );
  expect(built.status, built.stderr).toBe(0);
  metafile = JSON.parse(readFileSync(meta, "utf8"));
}, 60_000);

describe("the built CLI", () => {
  it("depends on nothing outside itself but Node's own modules", () => {
    const imports = Object.values(metafile.outputs).flatMap((o) => o.imports);
    const outside = imports.filter((i) => !isBuiltin(i.path)).map((i) => i.path);
    expect(outside).toEqual([]);
  });

  it("runs from a copy with no packages: finds its plug-ins, and starts each tool's server on Node", () => {
    const plugins = ship("plugins");
    expect(plugins.status, plugins.stdout + plugins.stderr).toBe(0);
    const tools = ship("tools", "check");
    expect(tools.status, tools.stdout + tools.stderr).toBe(0);
  });
});
