// The plan PR body: what the reviewer approves, readable on a phone without opening the file.
// Everything here is derived from the plan, its stack and your copy's settings, so it can't drift
// from what `ship build` and `ship publish` will actually create.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findStack } from "./catalog.ts";
import { type Config, PLATFORM_VERSION } from "./config.ts";
import { INITIAL_VERSION, projectVars, renderStackValue, stackUrls } from "./generate.ts";
import type { Plan } from "./plan.ts";
import { repoFor } from "./projects-on-github.ts";
import type { Manifest } from "./schemas.ts";

/** The plan's own `### Architecture` block, if it has one. */
function planArchitecture(body: string): string | undefined {
  const m = body.match(/^### Architecture\n([\s\S]*?)(?=^##+ |(?![\s\S]))/m);
  return m?.[1]?.trim() || undefined;
}

export function planPrBody(plan: Plan, config: Config, checks: number, fileUrl?: string): string {
  const m = plan.meta;
  const stack = findStack(m.stack);
  const isApp = stack.kind === "app";
  const repo = `github.com/${repoFor(m.app)}`;
  const draft: Manifest = {
    shipify: 1,
    id: m.app,
    name: m.title,
    description: m.summary,
    kind: stack.kind,
    version: INITIAL_VERSION,
    stack: { id: stack.id, version: stack.version },
    preset: null,
    staging: m.staging,
    service: m.service ?? null,
    repository: { visibility: m.visibility },
    urls: {},
    health: null,
    secrets: { deploy: Object.keys(stack.deploy?.secrets ?? {}), runtime: m.secrets },
    vars: [],
    platformVersion: PLATFORM_VERSION,
    createdAt: new Date().toISOString(),
  };
  const vars = projectVars(config, stack, draft);
  const urls: Manifest["urls"] = isApp ? stackUrls(stack, vars, m.staging) : {};
  const rows: [string, string][] = [
    ["Kind · stack", `${stack.kind} · ${m.stack}${m.preset ? ` (preset ${m.preset})` : ""}`],
    ["Repository", `${repo} (${m.visibility})`],
  ];
  if (isApp) {
    const own = "set up by the project (see ## Hosting)";
    rows.push(["Production", urls.production ?? own]);
    rows.push([
      "Staging",
      m.staging
        ? `${urls.staging ?? own}; production via a "Release vX.Y.Z" PR`
        : "none: merging a change PR releases it",
    ]);
    rows.push([
      "Secrets",
      [
        ...draft.secrets.deploy.map((s) => `\`${s}\` (deploy, CI only)`),
        ...m.secrets.map((s) => `\`${s}\` (runtime)`),
      ].join(", ") || "none",
    ]);
    rows.push([
      "Pipeline",
      "its own `ship.yml`: secret scan, `make setup` · `audit` · `verify`, version check, `make bundle` with no keys, then main's `make preview-from` on a fresh runner + `e2e`, `make deploy`, health check (rollback on failure), tag",
    ]);
  } else {
    rows.push(["Release", "tag `vX.Y.Z` + GitHub Release; consumers pin the tag"]);
    rows.push([
      "Pipeline",
      "its own `ship.yml`: secret scan, `make setup` · `audit` · `verify`, version check, tag",
    ]);
  }
  // The stack's own rows (table lines) and default architecture (the rest) in review.md.
  const reviewFile = join(stack.dir, "review.md");
  const review = existsSync(reviewFile)
    ? renderStackValue(stack, readFileSync(reviewFile, "utf8"), vars)
        .replace(/<!--[\s\S]*?-->\n?/g, "")
        .split("\n")
    : [];
  for (const line of review.filter((l) => l.startsWith("|"))) {
    const [k, ...v] = line.replace(/^\||\|$/g, "").split("|");
    rows.push([(k ?? "").trim(), v.join("|").trim()]);
  }
  const defaultArch = review
    .filter((l) => !l.startsWith("|"))
    .join("\n")
    .trim();
  const stories = [...plan.body.matchAll(/^- \*\*(US\d+ \(P[1-3]\)): ([^*]+)\*\*/gm)].map(
    (s) => `- ${s[1]}: ${(s[2] ?? "").replace(/\.$/, "")}`,
  );
  const arch = planArchitecture(plan.body) ?? (defaultArch || undefined);
  return [
    m.summary,
    "",
    "## What gets created",
    "",
    "| | |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    ...(arch ? ["", "## Architecture", "", arch] : []),
    ...(stories.length ? ["", "## Stories", "", ...stories] : []),
    "",
    "---",
    "",
    `Full plan: ${fileUrl ? `[plans/${m.app}.plan.md](${fileUrl})` : `\`plans/${m.app}.plan.md\``} · hash \`${plan.hash}\` · all ${checks} platform checks passed.`,
    "",
    "**Merging this PR approves the plan.** From a task, the rest follows: its repository and",
    "keys are made, a box builds it until `make verify` is green, and it goes live. From the PC:",
    `\`pnpm ship build ${m.app}\`, then \`pnpm ship publish ../projects/${m.app}\`.`,
  ].join("\n");
}
