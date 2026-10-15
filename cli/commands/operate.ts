// Seeing and operating projects: catalog, list, status, register/reconcile, down/up/rollback.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { listPresets, listStacks } from "../lib/catalog.ts";
import { loadConfig, PLATFORM_ROOT, projectsDir } from "../lib/config.ts";
import { ghRun } from "../lib/github.ts";
import { MANIFEST_FILE, readManifest } from "../lib/manifest.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { projectsOnGitHub } from "../lib/projects-on-github.ts";
import {
  entryFromManifest,
  loadRegistry,
  saveRegistry,
  scanProjects,
  upsert,
} from "../lib/registry.ts";
import type { RegistryEntry } from "../lib/schemas.ts";

export function catalog(what: "stacks" | "presets"): Result {
  const rows =
    what === "stacks"
      ? listStacks().map((t) => [
          t.id,
          t.version,
          `${t.kind}${t.contractOnly ? " (contract only)" : ""}`,
          t.description,
        ])
      : listPresets().map((p) => [p.id, p.version, p.stacks.join(", "), p.description]);
  return ok(what, `${rows.length} ${what}`, {
    data: rows
      .map(
        (r) =>
          `  ${(r[0] ?? "").padEnd(12)} ${(r[1] ?? "").padEnd(8)} ${(r[2] ?? "").padEnd(22)} ${r[3]}`,
      )
      .join("\n"),
  });
}

export function register(path: string): Result {
  const dir = resolve(path);
  const m = readManifest(dir);
  saveRegistry(upsert(loadRegistry(), entryFromManifest(m, dir)));
  return ok("register", `registered ${m.id}`);
}

export function unregister(id: string): Result {
  const reg = loadRegistry();
  if (!reg.projects.some((a) => a.id === id))
    throw new ShipError(`${id} is not registered.`, "blocked");
  saveRegistry({ ...reg, projects: reg.projects.filter((a) => a.id !== id) });
  return ok(
    "unregister",
    `removed ${id} from the index (its files, repo and Workers are untouched)`,
  );
}

export function reconcile(): Result {
  const before = loadRegistry();
  const found = scanProjects(projectsDir(loadConfig()));
  let reg = { schemaVersion: 1 as const, projects: [] as RegistryEntry[] };
  for (const e of found) {
    const old = before.projects.find((a) => a.id === e.id);
    reg = upsert(reg, old ? { ...e, registeredAt: old.registeredAt } : e);
  }
  const dropped = before.projects.filter((a) => !found.some((f) => f.id === a.id)).map((a) => a.id);
  saveRegistry(reg);
  return ok("reconcile", `index rebuilt from ${found.length} manifest(s)`, {
    data: dropped.length ? `  dropped (no manifest on disk): ${dropped.join(", ")}` : undefined,
  });
}

export function list(): Result {
  const reg = loadRegistry();
  const head = `  ${"PROJECT".padEnd(18)} ${"KIND".padEnd(8)} ${"STACK".padEnd(16)} ${"REPO".padEnd(8)} WHERE`;
  const lines = reg.projects.map(
    (a) =>
      `  ${a.id.padEnd(18)} ${a.kind.padEnd(8)} ${a.stack.padEnd(16)} ${a.visibility.padEnd(8)} ${a.kind === "app" ? (a.urls.production ?? "(not deployed)") : (a.repository ?? "(not published)")}`,
  );
  return ok("list", `${reg.projects.length} project(s)`, {
    data: reg.projects.length ? [head, ...lines].join("\n") : "  no projects yet",
  });
}

export async function status(id: string): Promise<Result> {
  const entry = loadRegistry().projects.find((a) => a.id === id);
  if (!entry) throw new ShipError(`${id} is not registered.`, "blocked");
  const lines = [
    `  ${entry.kind} · ${entry.stack}${entry.preset ? ` · preset ${entry.preset}` : ""}`,
    `  repo        ${entry.repository ?? "(not published)"}`,
  ];
  const dir = resolve(PLATFORM_ROOT, entry.path);
  const health = existsSync(join(dir, MANIFEST_FILE)) ? readManifest(dir).health : null;
  if (entry.kind === "app") {
    for (const env of ["staging", "production"] as const) {
      if (env === "staging" && !entry.staging) continue;
      const url = entry.urls[env];
      if (!url) {
        lines.push(`  ${env.padEnd(11)} (no URL yet)`);
        continue;
      }
      if (!health) {
        lines.push(`  ${env.padEnd(11)} ${url} (no health path in ${MANIFEST_FILE})`);
        continue;
      }
      const h = await fetch(`${url}${health}`, { signal: AbortSignal.timeout(5000) })
        .then(async (r) =>
          r.ok
            ? ((await r.json()) as { status: string; version: string; commit?: string })
            : undefined,
        )
        .catch(() => undefined);
      lines.push(
        `  ${env.padEnd(11)} ${h ? `${h.status} · v${h.version}${h.commit ? ` (${h.commit.slice(0, 7)})` : ""}` : "unreachable"} · ${url}`,
      );
    }
  }
  if (entry.repository) {
    const repo = entry.repository.replace("https://github.com/", "");
    const tag = ghRun([
      "release",
      "view",
      "-R",
      repo,
      "--json",
      "tagName,publishedAt",
      "--template",
      "{{.tagName}} ({{timeago .publishedAt}})",
    ]);
    lines.push(`  released    ${tag.code === 0 ? tag.stdout.trim() : "nothing yet"}`);
    const down = ghRun(["variable", "get", "SHIPIFY_DOWN", "-R", repo]).stdout.trim();
    if (down === "true")
      lines.push(`  down        yes: CI deploys nothing (pnpm ship up ${id} --yes)`);
    const runs = ghRun([
      "run",
      "list",
      "-R",
      repo,
      "-L",
      "5",
      "--json",
      "workflowName,headBranch,event,conclusion,status,createdAt",
      "--template",
      '{{range .}}    {{.headBranch | printf "%-24s"}} {{.event | printf "%-13s"}} {{if .conclusion}}{{.conclusion}}{{else}}{{.status}}{{end}}  {{timeago .createdAt}}{{"\\n"}}{{end}}',
    ]);
    lines.push(
      "  recent runs:",
      runs.code === 0 ? runs.stdout.trimEnd() || "    none" : "    (gh couldn't list runs)",
    );
    const pr = ghRun([
      "pr",
      "list",
      "-R",
      repo,
      "--base",
      "production",
      "--json",
      "url,title",
      "--jq",
      '.[0] | select(.) | "\\(.title): \\(.url)"',
    ]);
    if (pr.stdout.trim()) lines.push(`  waiting     ${pr.stdout.trim()}`);
  }
  return ok("status", id, { data: lines.join("\n") });
}

/** Run the app's pipeline with a lifecycle action (needs Actions: write on the PC token). */
/**
 * Operate a live app through its pipeline. `down` takes it offline until `up`: the repo variable
 * SHIPIFY_DOWN makes CI check every change and deploy none, and `make pause` turns its URLs off
 * (production, staging and previews). The repo, code, releases and secrets stay.
 */
export function lifecycle(
  id: string,
  action: "rollback" | "down" | "up",
  yes: boolean,
  to?: string,
): Result {
  // This PC's registry, else GitHub (GitHub's machines, where the task's operation runs, keep none).
  const onGitHub = (): Pick<RegistryEntry, "kind" | "repository"> | undefined => {
    const p = projectsOnGitHub(process.env.GH_TOKEN || process.env.SHIPIFY_READ_TOKEN).find(
      (x) => x.id === id,
    );
    return p
      ? { kind: p.kind as RegistryEntry["kind"], repository: `https://github.com/${p.repo}` }
      : undefined;
  };
  const entry = loadRegistry().projects.find((a) => a.id === id) ?? onGitHub();
  if (!entry) throw new ShipError(`${id} is not registered.`, "blocked");
  if (entry.kind !== "app")
    throw new ShipError(`${id} is a package: nothing is deployed to ${action}.`, "unsupported");
  if (!entry.repository) throw new ShipError(`${id} is not published yet.`, "blocked");
  if (to && !/^v\d+\.\d+\.\d+$/.test(to))
    throw new ShipError("--to must look like v1.2.3", "blocked");
  const repo = entry.repository.replace("https://github.com/", "");
  const target = action === "down" ? "pause" : action === "up" ? "resume" : action;
  const args = ["workflow", "run", "ship.yml", "-R", repo, "-f", `action=${target}`];
  if (to) args.push("-f", `to=${to}`);
  const flag =
    action === "down" || action === "up"
      ? ["variable", "set", "SHIPIFY_DOWN", "-R", repo, "--body", String(action === "down")]
      : undefined;
  const effect = {
    rollback: `roll production back to ${to ?? "the previous version"}`,
    down: "take it down: CI keeps checking but deploys nothing, and its URLs go off (nothing is deleted)",
    up: "bring it back: deploys resume on the next merge, and its URLs come back on now",
  }[action];
  if (!yes) {
    return {
      command: action,
      status: "requires-approval",
      summary: `would ${effect} for ${id}`,
      plannedActions: [...(flag ? [`gh ${flag.join(" ")}`] : []), `gh ${args.join(" ")}`],
      nextSteps: [`pnpm ship ${action} ${id} --yes`],
    };
  }
  if (flag) {
    const f = ghRun(flag);
    if (f.code !== 0) throw new ShipError(`gh variable set failed: ${f.stderr.trim()}`);
  }
  const r = ghRun(args);
  if (r.code !== 0) throw new ShipError(`gh workflow run failed: ${r.stderr.trim()}`);
  return ok(action, `started: ${effect} for ${id}`, {
    nextSteps: [`gh run watch -R ${repo}`, `pnpm ship status ${id}`],
  });
}
