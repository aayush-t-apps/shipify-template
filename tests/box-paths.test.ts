// What a box has and doesn't (task #163's sweep): no project registry, so a project's own commands
// read its shipify.json; a merged plan's publish run lays the stack out into the run's clone.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appEntry } from "../cli/commands/evolve.ts";
import { buildProject } from "../cli/commands/project.ts";
import { loadRegistry } from "../cli/lib/registry.ts";

// The merged plan a publish run reads: the fixture's, never a copy's own plans/ (they're yours).
vi.mock("../cli/lib/plan.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cli/lib/plan.ts")>();
  const { readFileSync: read } = await import("node:fs");
  const fixture = read(new URL("./fixtures/good.plan.md", import.meta.url), "utf8");
  return {
    ...real,
    readPlan: (app: string, root?: string) =>
      app === "fixture-app"
        ? real.parsePlan(fixture, "plans/fixture-app.plan.md")
        : real.readPlan(app, root),
  };
});

describe("on a box, with no registry", () => {
  it("a project's commands read an unregistered clone from its own shipify.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "clone-"));
    writeFileSync(
      join(dir, "shipify.json"),
      JSON.stringify({
        shipify: 1,
        id: "not-in-any-registry",
        name: "X",
        description: "x",
        kind: "app",
        version: "1.0.0",
        stack: { id: "ts-worker", version: "1.5.0" },
        preset: null,
        staging: false,
        service: null,
        repository: { visibility: "private", url: "https://github.com/o/not-in-any-registry" },
        urls: {},
        health: "/health",
        secrets: { deploy: [], runtime: [] },
        vars: [],
        platformVersion: "0.2.0",
        createdAt: "2026-10-05T00:00:00.000Z",
      }),
    );
    const e = appEntry(dir);
    expect(e).toMatchObject({ id: "not-in-any-registry", dir, home: dir, registered: false });
    expect(e.repository).toBe("https://github.com/o/not-in-any-registry");
    // By id alone it's still refused: nothing to read it from.
    expect(() => appEntry("not-in-any-registry")).toThrow("is not registered");
  });

  it("a merged plan's publish run lays the stack's files into the run's clone, and nothing else", () => {
    // Your copy's settings, as task.yml hands a run all its variables (ADR 0047).
    vi.stubEnv("SHIPIFY_VARS", JSON.stringify({ CF_WORKERS_SUBDOMAIN: "example" }));
    const into = mkdtempSync(join(tmpdir(), "work-"));
    execFileSync("git", ["init", "-q", into]);
    const before = JSON.stringify(loadRegistry());
    const r = buildProject({ id: "fixture-app", resume: false, into });
    expect(r.status).toBe("succeeded");
    const m = JSON.parse(readFileSync(join(into, "shipify.json"), "utf8"));
    expect(m.id).toBe("fixture-app");
    expect(m.repository.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]*fixture-app$/);
    expect(existsSync(join(into, ".git"))).toBe(true);
    expect(existsSync(join(into, "Makefile"))).toBe(true);
    // No registry change, no commit: the agent builds and commits in its clone.
    expect(JSON.stringify(loadRegistry())).toBe(before);
    expect(() =>
      execFileSync("git", ["-C", into, "rev-parse", "--verify", "HEAD"], { stdio: "ignore" }),
    ).toThrow();
    vi.unstubAllEnvs();
  });
});
