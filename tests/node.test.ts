// Node's major and the day its support ends, in one place (cli/lib/node-support.ts): each copy
// that can't import it holds the same major, and pnpm comes without corepack (Node has none from 25
// on).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { machineChecks } from "../cli/commands/doctor.ts";
import { NODE_ENDS, NODE_MAJOR, NODE_WARN_DAYS, nodeEnding } from "../cli/lib/node-support.ts";
import { ROOT } from "./helpers.ts";

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
type Steps = { uses?: string; run?: string; with?: Record<string, unknown> }[];
const steps = (file: string): Steps => {
  const y = parse(read(file)) as {
    jobs?: Record<string, { steps?: Steps }>;
    runs?: { steps?: Steps };
  };
  return [...Object.values(y.jobs ?? {}).flatMap((j) => j.steps ?? []), ...(y.runs?.steps ?? [])];
};
const workflows = readdirSync(join(ROOT, ".github", "workflows")).map(
  (f) => `.github/workflows/${f}`,
);

describe("Node, one major everywhere (cli/lib/node-support.ts)", () => {
  it("is an LTS (an even major), whose end the digest warns of", () => {
    expect(NODE_MAJOR % 2).toBe(0);
    const ends = NODE_ENDS[NODE_MAJOR] as string;
    expect(ends).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    /** What the digest says, so many days before the support ends. */
    const said = (days: number) =>
      nodeEnding(`v${NODE_MAJOR}.1.0`, new Date(Date.parse(ends) - days * 86_400_000));
    expect(said(NODE_WARN_DAYS + 1)).toBeUndefined();
    expect(said(NODE_WARN_DAYS)).toEqual({ major: NODE_MAJOR, date: ends, days: NODE_WARN_DAYS });
  });

  it("is what doctor and `ship setup` ask a machine for", () => {
    expect(machineChecks([])[0]).toMatchObject({
      name: `node ≥ ${NODE_MAJOR}`,
      fix: `install Node ${NODE_MAJOR} (docs/setup.md)`,
    });
  });

  it("is what every workflow's setup-node asks for, and the stacks' .nvmrc", () => {
    const setups = workflows.flatMap((f) =>
      steps(f).filter((s) => s.uses?.startsWith("actions/setup-node@")),
    );
    expect(setups.length).toBeGreaterThan(5);
    for (const s of setups) expect(s.with?.["node-version"]).toBe(NODE_MAJOR);
    const action = steps("stacks/_ts/files/.github/actions/setup/action.yml");
    const node = action.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(node?.with?.["node-version-file"]).toBe(".nvmrc");
    expect(read("stacks", "_ts", "files", ".nvmrc")).toBe(`${NODE_MAJOR}\n`);
  });

  it("is the floor of Shipify's engines and each stack's", () => {
    const engines = (p: string) =>
      (JSON.parse(read(p)) as { engines?: { node?: string } }).engines?.node;
    expect(engines("package.json")).toBe(`>=${NODE_MAJOR}`);
    const stacks = readdirSync(join(ROOT, "stacks"))
      .map((s) => `stacks/${s}/files/package.json`)
      .filter((p) => {
        try {
          return Boolean(engines(p));
        } catch {
          return false;
        }
      });
    expect(stacks).toHaveLength(3);
    for (const p of stacks) expect(engines(p), p).toBe(`>=${NODE_MAJOR}`);
  });

  it("is what box setup and here.sh download, and what a box's run checks for", () => {
    const setup = read("box", "setup.sh");
    expect(setup).toMatch(new RegExp(`^NODE=${NODE_MAJOR}$`, "m"));
    expect(setup).toContain("base=https://nodejs.org/dist/latest-v$NODE.x");
    const here = read("box", "here.sh");
    expect(here).toContain(`local node=${NODE_MAJOR} base file`);
    expect(here).toContain("base=https://nodejs.org/dist/latest-v$node.x");
    const check = steps(".github/workflows/task.yml").find((s) =>
      s.run?.includes("this box's Node is"),
    );
    expect(check?.run).toContain(`v${NODE_MAJOR}.*) ;;`);
  });
});

describe("pnpm, without corepack", () => {
  it("comes from npm on a box, at the version Shipify pins", () => {
    const setup = read("box", "setup.sh");
    const pinned = (JSON.parse(read("package.json")) as { packageManager: string }).packageManager;
    expect(pinned).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(setup).toMatch(new RegExp(`^PNPM=${pinned.slice("pnpm@".length)}$`, "m"));
    expect(setup).toContain('--prefix /opt/node "pnpm@$PNPM"');
    // What setup 17 and before left is taken away.
    expect(setup).toContain(
      "rm -f /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg",
    );
  });

  it("is never started through corepack, on a box, in a job or in the PC's setup", () => {
    for (const f of [
      "box/setup.sh",
      "box/here.sh",
      "cli/commands/setup.ts",
      "stacks/_ts/files/.github/actions/setup/action.yml",
      ...workflows,
    ])
      expect(read(f), f).not.toMatch(/corepack (enable|install)/);
  });
});
