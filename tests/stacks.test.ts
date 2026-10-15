// Every vitest config a project gets from its stack caps its test workers the way Shipify's own
// config does (task #332): half the cores, never under two, so a small box keeps room for the
// runner and the agent. The cap is read from the root config, so the two stay in step.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers.ts";

const ROOT_CAP = /maxWorkers:[^\n]*/.exec(
  readFileSync(join(ROOT, "vitest.config.ts"), "utf8"),
)?.[0];
const exists = (p: string) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
};
const vitestTemplates = readdirSync(join(ROOT, "stacks"), { withFileTypes: true }).flatMap((e) => {
  const p = join(ROOT, "stacks", e.name, "files", "vitest.config.ts");
  return e.isDirectory() && exists(p) ? [p] : [];
});

describe("stacks: project vitest configs", () => {
  it("cap the test workers exactly as Shipify's own config does", () => {
    expect(ROOT_CAP).toMatch(
      /^maxWorkers: Math\.max\(2, Math\.floor\(availableParallelism\(\) \/ 2\)\),?$/,
    );
    expect(vitestTemplates).toEqual(
      expect.arrayContaining([
        join(ROOT, "stacks/ts-package/files/vitest.config.ts"),
        join(ROOT, "stacks/_cloudflare/files/vitest.config.ts"),
      ]),
    );
    for (const p of vitestTemplates) {
      expect(readFileSync(p, "utf8"), p).toContain(ROOT_CAP);
    }
  });
});
