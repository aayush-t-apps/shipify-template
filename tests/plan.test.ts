import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../cli/lib/config.ts";
import { checkPlan, hashText, parsePlan, planSkeleton } from "../cli/lib/plan.ts";
import { renderString } from "../cli/lib/render.ts";
import { planPrBody } from "../cli/lib/review.ts";

const skeleton = planSkeleton({
  app: "demo-app",
  title: "Demo: a test",
  summary: "A small demo app for tests.",
  stack: "ts-worker",
  preset: "tool",
  visibility: "public",
});

describe("plans", () => {
  it("parses front matter and hashes content", () => {
    const p = parsePlan(skeleton);
    expect(p.meta).toMatchObject({
      app: "demo-app",
      preset: "tool",
      visibility: "public",
      revision: 1,
    });
    expect(p.hash).toBe(hashText(skeleton));
    expect(parsePlan(`${skeleton}\nchange`).hash).not.toBe(p.hash);
  });
  it("rejects a plan without front matter", () => {
    expect(() => parsePlan("# no front matter")).toThrow(/front matter/);
  });
  it("rejects invalid front matter", () => {
    expect(() => parsePlan(skeleton.replace("visibility: public", "visibility: secret"))).toThrow(
      /visibility/,
    );
  });
});

describe("renderString", () => {
  it("replaces known variables and leaves GitHub expressions alone", () => {
    const gh = "$" + "{{ github.sha }}";
    expect(renderString(`{{APP_ID}} ${gh}`, { APP_ID: "x" })).toBe(`x ${gh}`);
  });
  it("keeps or drops #if blocks", () => {
    const t = "a\n# #if STAGING\nstaging\n# #endif\n// #if !STAGING\nno-staging\n// #endif\nz";
    expect(renderString(t, { STAGING: "true" })).toBe("a\nstaging\nz");
    expect(renderString(t, { STAGING: "false" })).toBe("a\nno-staging\nz");
    expect(() => renderString("# #if X\n", { X: "true" })).toThrow(/Unclosed/);
    expect(() => renderString("# #if NOPE\n# #endif", {})).toThrow(/Unknown #if/);
  });

  it("fails on unknown variables", () => {
    expect(() => renderString("{{NOPE}}", {})).toThrow(/Unknown template variable/);
  });
});

describe("plan quality checks", () => {
  const good = readFileSync(join(import.meta.dirname, "fixtures/good.plan.md"), "utf8");
  const failing = (raw: string) =>
    checkPlan(parsePlan(raw), "/nonexistent")
      .filter((c) => !c.ok)
      .map((c) => c.name);

  it("accepts a complete, traceable plan", () => {
    expect(failing(good)).toEqual([]);
  });
  it("flags a story without an EARS criterion", () => {
    expect(
      failing(
        good.replace("  - AC2.1 WHEN I reload the page THE APP SHALL show the same count.\n", ""),
      ),
    ).toContain("stories have testable criteria (EARS: WHEN … SHALL …)");
  });
  it("flags a criterion no task verifies", () => {
    expect(failing(good.replace(" — verifies: AC2.1", ""))).toContain(
      "every criterion is verified by a task",
    );
  });
  it("requires what the stack asks every plan to decide (ts-worker: UI and design)", () => {
    const check = "covers what stack ts-worker asks every plan to decide";
    expect(failing(good.replace(/## Design[\s\S]*?## Tasks/, "## Tasks"))).toContain(check);
    expect(failing(good.replace(/## UI[\s\S]*?## Design/, "## Design"))).toContain(check);
    const site = good
      .replace("stack: ts-worker", "stack: ts-static")
      .replace("preset: tool", "preset: site");
    expect(
      failing(
        site
          .replace(/## UI[\s\S]*?## Design/, "## Design")
          .replace(/### Data[\s\S]*?## Tasks/, "## Tasks"),
      ),
    ).toEqual([]);
  });
  it("apps need a valid architecture diagram", () => {
    const noDiagram = good.replace(/```mermaid[\s\S]*?```\n/, "");
    expect(failing(noDiagram)).toContain("apps show their architecture as a diagram");
    const broken = good.replace("flowchart LR", "flowchrt LR");
    expect(failing(broken)).toContain("diagrams are valid Mermaid");
    const pkg = noDiagram
      .replace("stack: ts-worker", "stack: ts-package")
      .replace("preset: tool", "preset: none");
    expect(failing(pkg)).not.toContain("apps show their architecture as a diagram");
  });
  it("rejects bloated plans", () => {
    expect(failing(good + "\n".repeat(300))).toContain("plan stays under 250 lines");
  });
  it("the skeleton cannot pass until filled in", () => {
    const skeleton = planSkeleton({
      app: "x-app",
      title: "X app",
      summary: "Something small.",
      stack: "ts-worker",
      preset: "tool",
      visibility: "public",
    });
    expect(failing(skeleton)).toContain("no open questions");
  });
});

describe("plan PR body", () => {
  const good = parsePlan(readFileSync(join(__dirname, "fixtures", "good.plan.md"), "utf8"));
  const config = loadConfig();
  // Your copy's workers.dev name, as a run has it in its environment (ADR 0047).
  beforeAll(() => {
    process.env.CF_WORKERS_SUBDOMAIN = "sub";
  });
  afterAll(() => {
    delete process.env.CF_WORKERS_SUBDOMAIN;
  });

  it("shows what gets created, the architecture and the stories", () => {
    const body = planPrBody(good, config, 12);
    expect(body).toContain("| Production | https://fixture-app.sub.workers.dev |");
    expect(body).toContain("| Secrets | `CLOUDFLARE_API_TOKEN` (deploy, CI only) |");
    expect(body).toMatch(/\| Cost \| 1 of 100 free Cloudflare Workers/);
    expect(body).toContain("| Staging | none: merging a change PR releases it |");
    expect(body).toContain("## Architecture");
    expect(body).toContain("- US1 (P1): Count taps");
  });

  it("uses the plan's service name and staging", () => {
    const body = planPrBody(
      { ...good, meta: { ...good.meta, staging: true, service: "counter" } },
      config,
      12,
    );
    expect(body).toContain("| Staging | https://counter-staging.sub.workers.dev; production via");
    expect(body).toContain("`https://pr-<n>-counter-staging.sub.workers.dev`");
    expect(body).toMatch(/\| Cost \| 2 of 100 free Cloudflare Workers/);
  });

  it("a contract-only app says the project sets up hosting", () => {
    const own = { ...good, meta: { ...good.meta, stack: "custom-app", preset: "none" } };
    expect(planPrBody(own, config, 12)).toContain(
      "| Production | set up by the project (see ## Hosting) |",
    );
  });
});
