// How the edge is deployed (ADR 0031): ci.yml's `edge` job after the checks, with the deploy token
// on its wrangler steps alone, its commit checked on /health, and a rollback when it doesn't come;
// and the Worker it deploys: the same name and address as before, nothing on workers.dev, no
// previews, the watch's cron, and its own logs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ROOT } from "../helpers.ts";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
};
const ci = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, { needs?: string; if?: string; permissions?: unknown; steps: Step[] }>;
};

describe("ci.yml's edge job", () => {
  const job = ci.jobs.edge;
  const step = (name: string) => job?.steps.find((s) => s.name?.startsWith(name));

  it("runs after the checks, only when the edge, its contracts or intents.json changed (or by hand), and only once the door is set up (a fresh copy stays green)", () => {
    expect(job?.needs).toBe("verify");
    expect(job?.if).toBe("needs.verify.outputs.edge == 'true' && vars.SHIPIFY_DOOR_URL != ''");
    expect(job?.permissions).toEqual({ contents: "read" });
    const changed = ci.jobs.verify?.steps.find((s) => s.name?.startsWith("What this change needs"));
    expect(changed?.run).toContain("^(edge/|cli/contracts/|intents\\.json$)");
    expect(changed?.run).toContain('[ "$EVENT" = workflow_dispatch ]');
  });

  it("deploys with its commit and a message, to shipify.<APPS_DOMAIN>, the values from shipify's variables", () => {
    const run = step("Deploy the edge")?.run ?? "";
    expect(run).toContain("wrangler deploy --config edge/wrangler.jsonc");
    expect(run).toContain('--domain "shipify.$APPS_DOMAIN"');
    expect(run).toContain('--var "GIT_SHA:$GITHUB_SHA"');
    expect(run).toContain('--message "edge v$VERSION $GITHUB_SHA"');
    for (const v of [
      "GITHUB_REPO",
      "SHIPIFY_DOOR_URL",
      "SHIPIFY_DOOR_APP_ID",
      "SHIPIFY_DOOR_INSTALLATION",
      "SHIPIFY_REPO_ID",
      "SHIPIFY_OWNER_ID",
    ])
      expect(run).toContain(`--var "${v}:`);
    // Values reach the script through its environment, never pasted into it.
    for (const s of job?.steps ?? []) expect(s.run ?? "").not.toMatch(/\$\{\{/);
    // No secret is uploaded: the Worker keeps its own.
    expect(run).not.toContain("secret");
  });

  it("gives the deploy token to the wrangler steps alone", () => {
    const holders = (job?.steps ?? [])
      .filter((s) => JSON.stringify(s).includes("secrets."))
      .map((s) => s.name);
    expect(holders).toEqual(["Deploy the edge", "Roll back"]);
  });

  it("waits 2 minutes for /health to say its commit, and rolls back when it doesn't", () => {
    const wait = step("Wait for /health")?.run ?? "";
    expect(wait).toContain("seq 1 24");
    expect(wait).toContain("sleep 5");
    expect(wait).toContain(".commit == $sha");
    const back = step("Roll back");
    expect(back?.if).toBe("failure() && steps.deploy.outcome == 'success'");
    expect(back?.run).toContain("wrangler rollback --config edge/wrangler.jsonc --yes");
  });
});

describe("the edge's Worker (edge/wrangler.jsonc)", () => {
  const text = readFileSync(join(ROOT, "edge/wrangler.jsonc"), "utf8");
  const config = JSON.parse(
    text
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .map((l) => l.replace(/\s\/\/ .*$/, ""))
      .join("\n"),
  ) as Record<string, unknown>;

  it("is the Worker `shipify`, at its workers.dev address (and your domain when there is one), with no previews, the watch every 5 minutes", () => {
    expect(config).toMatchObject({
      name: "shipify",
      main: "src/index.ts",
      workers_dev: true,
      preview_urls: false,
      compatibility_flags: ["global_fetch_strictly_public"],
      triggers: { crons: ["*/5 * * * *"] },
      observability: { enabled: true, logs: { enabled: true, invocation_logs: false } },
    });
    // No secret in its config, and no binding beyond its commit's default.
    expect(config.vars).toEqual({ GIT_SHA: "dev" });
  });
});
