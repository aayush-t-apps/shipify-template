import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { agentCheck, tokenExpiry } from "../cli/commands/doctor.ts";
import { platformOwner } from "../cli/lib/github.ts";
import { ROOT, type Sandbox, sandbox, ship } from "./helpers.ts";

const read = (p: string) => readFileSync(p, "utf8");
// Your copy's workers.dev name, as the sandbox sets it (helpers.ts), and its owner, the repo's.
const SUB = "example";
const OWNER = platformOwner();
const json = (p: string) => JSON.parse(read(p));

describe("ship: catalog and safety", () => {
  let sb: Sandbox;
  beforeAll(() => {
    sb = sandbox();
  });

  it("lists stacks (apps, packages, contract-only) and presets", () => {
    const stacks = ship(sb, "stacks").data as string;
    expect(stacks).toMatch(/ts-worker .*app .*Cloudflare/);
    expect(stacks).toMatch(/ts-package .*package/);
    expect(stacks).toMatch(/custom-app .*app \(contract only\)/);
    expect(ship(sb, "presets").data).toContain("tool");
  });

  it("dry-run shows files, variables and secrets without writing", () => {
    const r = ship(sb, "new", "dry-app", "--stack", "ts-worker", "--preset", "tool", "--dry-run");
    expect(r.status).toBe("skipped");
    const d = r.data as {
      files: string[];
      requiredSecrets: unknown;
      requiredVariables: string[];
      target: string;
      urls: unknown;
    };
    expect(d.files).toEqual(
      expect.arrayContaining([
        ".github/workflows/ship.yml",
        ".github/actions/setup/action.yml",
        "Makefile",
        "scripts/shipify/cloudflare.mjs",
        "shipify.json",
      ]),
    );
    expect(d.requiredSecrets).toEqual({ deploy: ["CLOUDFLARE_API_TOKEN"], runtime: [] });
    expect(d.requiredVariables).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CF_WORKERS_SUBDOMAIN"]);
    expect(d.urls).toEqual({ production: `https://dry-app.${SUB}.workers.dev` });
    expect(existsSync(d.target)).toBe(false);
  });

  it("puts a new app on your own domain when APPS_DOMAIN is set (ADR 0024)", () => {
    const own = { ...sb, env: { ...sb.env, APPS_DOMAIN: "apps.example.com" } };
    const r = ship(own, "new", "own-app", "--stack", "ts-static", "--staging", "--dry-run");
    expect(r.status, r.summary).toBe("skipped");
    expect((r.data as { urls: unknown }).urls).toEqual({
      production: "https://own-app.apps.example.com",
      staging: "https://own-app-staging.apps.example.com",
    });
  });

  it("blocks bad names, unsafe paths, unknown stacks/presets, and bad combinations", () => {
    expect(ship(sb, "new", "Bad_Name", "--stack", "ts-worker", "--dry-run").code).toBe(2);
    const unsafe = ship(
      sb,
      "new",
      "safe-name",
      "--stack",
      "ts-worker",
      "--output",
      "../../outside",
      "--dry-run",
    );
    expect(unsafe.summary).toMatch(/inside the apps directory/);
    expect(ship(sb, "new", "x-app", "--stack", "nope", "--dry-run").code).toBe(2);
    expect(
      ship(sb, "new", "x-app", "--stack", "ts-worker", "--preset", "site", "--dry-run").code,
    ).toBe(2);
    expect(
      ship(sb, "new", "x-app", "--stack", "ts-worker", "--service", "Bad", "--dry-run").code,
    ).toBe(2);
    expect(
      ship(sb, "new", "x-pkg", "--stack", "ts-package", "--secrets", "KEY", "--dry-run").code,
    ).toBe(2);
    expect(
      ship(sb, "new", "x-src", "--stack", "ts-worker", "--source", "/", "--dry-run").code,
    ).toBe(2);
    expect(ship(sb, "new", "x-pkg", "--stack", "ts-package", "--staging", "--dry-run").code).toBe(
      2,
    );
    expect(ship(sb, "frobnicate").code).toBe(4);
  });
});

describe("ship: projects follow the contract", () => {
  let sb: Sandbox;
  beforeAll(() => {
    sb = sandbox();
  });

  it("creates an app at 0.1.0 with manifest, docs, its own pipeline and git", () => {
    expect(
      ship(sb, "new", "demo-app", "--stack", "ts-worker", "--preset", "tool", "--skip-install")
        .status,
    ).toBe("succeeded");
    const dir = join(sb.apps, "demo-app");
    const m = json(join(dir, "shipify.json"));
    expect(m).toMatchObject({
      shipify: 1,
      id: "demo-app",
      kind: "app",
      version: "0.1.0",
      staging: false,
      service: null,
      urls: { production: `https://demo-app.${SUB}.workers.dev` },
      health: "/health",
      secrets: { deploy: ["CLOUDFLARE_API_TOKEN"], runtime: [] },
    });
    expect(read(join(dir, "README.md"))).toContain(
      `| Production | \`https://demo-app.${SUB}.workers.dev\` |`,
    );
    expect(json(join(dir, "package.json")).version).toBe("0.1.0");
    expect(read(join(dir, "CHANGELOG.md"))).toContain("## [0.1.0]");
    expect(read(join(dir, "docs/changes/0001-create.md"))).toContain("released: v0.1.0");
    // Its own pipeline (ADR 0048): the same file in every project, calling no other repo.
    const pipeline = read(join(dir, ".github/workflows/ship.yml"));
    expect(pipeline).toBe(read(join(ROOT, "stacks/_base/files/.github/workflows/ship.yml")));
    expect(pipeline).not.toMatch(/uses:\s*[\w.-]+\/[\w.-]+\/\.github\/workflows\//);
    expect(pipeline).not.toContain("secrets: inherit");
    expect(pipeline).not.toContain(OWNER);
    expect(read(join(dir, "Makefile"))).toMatch(/^deploy preview: build$/m);
    expect(read(join(dir, "wrangler.jsonc"))).not.toMatch(/-staging|#if/);
    expect(statSync(join(dir, ".githooks/pre-push")).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(ship(sb, "validate", dir).status).toBe("succeeded");
  });

  it("creates a package: no deploy, the same pipeline, docs and versioning", () => {
    expect(ship(sb, "new", "demo-lib", "--stack", "ts-package", "--skip-install").status).toBe(
      "succeeded",
    );
    const dir = join(sb.apps, "demo-lib");
    expect(json(join(dir, "shipify.json"))).toMatchObject({
      kind: "package",
      service: null,
      urls: {},
      health: null,
      secrets: { deploy: [], runtime: [] },
      vars: [],
    });
    expect(read(join(dir, ".github/workflows/ship.yml"))).toBe(
      read(join(ROOT, "stacks/_base/files/.github/workflows/ship.yml")),
    );
    expect(existsSync(join(dir, "wrangler.jsonc"))).toBe(false);
    expect(read(join(dir, "Makefile"))).not.toMatch(/^deploy/m);
    expect(ship(sb, "validate", dir).status).toBe("succeeded");
  });

  it("renders staging and runtime secrets only when asked", () => {
    ship(
      sb,
      "new",
      "staged-app",
      "--stack",
      "ts-worker",
      "--preset",
      "blank",
      "--staging",
      "--secrets",
      "MY_KEY",
      "--skip-install",
    );
    const dir = join(sb.apps, "staged-app");
    expect(json(join(dir, "shipify.json"))).toMatchObject({
      staging: true,
      urls: {
        production: `https://staged-app.${SUB}.workers.dev`,
        staging: `https://staged-app-staging.${SUB}.workers.dev`,
      },
      secrets: { deploy: ["CLOUDFLARE_API_TOKEN"], runtime: ["MY_KEY"] },
    });
    expect(read(join(dir, "wrangler.jsonc"))).toContain('"staged-app-staging"');
    expect(read(join(dir, ".github/workflows/ship.yml"))).toContain("branches: [main, production]");
    expect(read(join(dir, "AGENTS.md"))).toContain("pnpm ship release staged-app");
    expect(ship(sb, "validate", dir).status).toBe("succeeded");
    expect(
      ship(sb, "new", "bad-secret", "--stack", "ts-worker", "--secrets", "lower", "--dry-run").code,
    ).toBe(2);
  });

  it("names the deployed service when asked", () => {
    ship(
      sb,
      "new",
      "long-app-name",
      "--stack",
      "ts-static",
      "--service",
      "short",
      "--skip-install",
    );
    const dir = join(sb.apps, "long-app-name");
    expect(json(join(dir, "shipify.json"))).toMatchObject({
      service: "short",
      urls: { production: `https://short.${SUB}.workers.dev` },
    });
    expect(read(join(dir, "wrangler.jsonc"))).toContain('"name": "short"');
  });

  it("contract-only stacks: stubs to implement, the same docs and pipeline", () => {
    expect(ship(sb, "new", "own-app", "--stack", "custom-app").status).toBe("succeeded");
    const dir = join(sb.apps, "own-app");
    expect(json(join(dir, "shipify.json"))).toMatchObject({
      kind: "app",
      urls: {},
      health: null,
      secrets: { deploy: [], runtime: [] },
    });
    expect(read(join(dir, "Makefile"))).toMatch(/^deploy:/m);
    expect(read(join(dir, "AGENTS.md"))).toContain("SHIPIFY_SECRETS_FILE");
    expect(read(join(dir, ".github/workflows/ship.yml"))).toBe(
      read(join(ROOT, "stacks/_base/files/.github/workflows/ship.yml")),
    );
    expect(ship(sb, "validate", dir).status).toBe("succeeded");
    expect(ship(sb, "verify", dir).status).toBe("failed");
    // Under another make (a box's `make verify` runs these tests), make's own lines go to stderr:
    // the result stays readable (task #168's box checks failed on "unparsed").
    const nested = { ...sb, env: { ...sb.env, MAKELEVEL: "1", MAKEFLAGS: "w" } };
    expect(ship(nested, "verify", dir).status).toBe("failed");
    expect(ship(sb, "new", "own-lib", "--stack", "custom-package").status).toBe("succeeded");
    const lib = join(sb.apps, "own-lib");
    expect(read(join(lib, "Makefile"))).not.toMatch(/^deploy:/m);
    expect(ship(sb, "validate", lib).status).toBe("succeeded");
  });

  it("staging off and on again: the stack's staging files follow, on a branch; the pipeline is the same either way", () => {
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", args, { cwd, env: sb.env, encoding: "utf8" }).stdout.trim();
    expect(ship(sb, "new", "stg-app", "--stack", "custom-app", "--staging").status).toBe(
      "succeeded",
    );
    const dir = join(sb.apps, "stg-app");
    const wf = join(dir, ".github/workflows/ship.yml");
    const pipeline = read(wf);
    const plan = ship(sb, "staging", "stg-app", "off");
    expect(plan.status).toBe("requires-approval");
    // A plan shown is a good end: exit 0, so pnpm never says "failed" (its status says the rest).
    expect(plan.code).toBe(0);
    expect(plan.plannedActions?.join("\n")).toContain("AGENTS.md");
    expect(plan.plannedActions?.join("\n")).not.toContain(".github/workflows/ship.yml");
    expect(plan.plannedActions?.join("\n")).toContain("left as they are");
    expect(ship(sb, "staging", "stg-app", "off", "--yes").status).toBe("succeeded");
    expect(git(dir, "branch", "--show-current")).toBe("staging-off");
    expect(json(join(dir, "shipify.json")).staging).toBe(false);
    expect(read(wf)).toBe(pipeline);
    expect(read(join(dir, "CHANGELOG.md"))).toContain("Staging off");
    expect(ship(sb, "staging", "stg-app", "off").status).toBe("skipped");
    git(dir, "commit", "-qam", "Staging off");
    expect(ship(sb, "staging", "stg-app", "on", "--yes").status).toBe("succeeded");
    expect(json(join(dir, "shipify.json")).staging).toBe(true);
    expect(read(wf)).toBe(pipeline);
    expect(ship(sb, "staging", "stg-app", "sideways").code).toBe(2);
  });

  it("imports an existing static site with --source, skipping junk", () => {
    const src = join(sb.dir, "old-site");
    mkdirSync(join(src, ".wrangler"), { recursive: true });
    writeFileSync(join(src, "index.html"), "<main>hi</main>");
    writeFileSync(join(src, ".DS_Store"), "x");
    expect(
      ship(
        sb,
        "new",
        "ported-site",
        "--stack",
        "ts-static",
        "--preset",
        "site",
        "--source",
        src,
        "--skip-install",
      ).status,
    ).toBe("succeeded");
    const site = join(sb.apps, "ported-site/site");
    expect(read(join(site, "index.html"))).toBe("<main>hi</main>");
    expect(existsSync(join(site, ".DS_Store")) || existsSync(join(site, ".wrangler"))).toBe(false);
    expect(ship(sb, "validate", join(sb.apps, "ported-site")).status).toBe("succeeded");
  });

  it("refuses duplicates and a missing make target", () => {
    expect(ship(sb, "new", "demo-app", "--stack", "ts-worker", "--skip-install").summary).toMatch(
      /already registered/,
    );
    const file = join(sb.apps, "demo-app/Makefile");
    const original = read(file);
    writeFileSync(file, original.replace("deploy preview: build", "preview: build"));
    const r = ship(sb, "validate", join(sb.apps, "demo-app"));
    writeFileSync(file, original);
    expect(r.checks?.find((c) => c.name === "make targets present")).toMatchObject({ ok: false });
  });

  it("publish shows its plan, creates and configures the repo, then waits for missing secrets", () => {
    const dir = join(sb.apps, "demo-app");
    const plan = ship(sb, "publish", dir);
    expect(plan.status).toBe("requires-approval");
    expect(JSON.stringify(plan)).toMatch(/create private repository .*\/demo-app/);
    const noAccount = ship(sb, "publish", dir, "--yes");
    expect(noAccount.status).toBe("blocked");
    expect(noAccount.checks?.map((c) => c.name)).toEqual(["variable CLOUDFLARE_ACCOUNT_ID"]);
    const real = ship(
      { ...sb, env: { ...sb.env, CLOUDFLARE_ACCOUNT_ID: "acc" } },
      "publish",
      dir,
      "--yes",
    );
    expect(real.status).toBe("blocked");
    expect(real.checks?.map((c) => c.name)).toEqual(["secret CLOUDFLARE_API_TOKEN"]);
  });

  it("publish in a task's build only pushes: GitHub's runners made the repo and its keys first", () => {
    expect(
      ship(sb, "new", "pub-app", "--stack", "ts-static", "--preset", "site", "--skip-install")
        .status,
    ).toBe("succeeded");
    const dir = join(sb.apps, "pub-app");
    const inTask = (more: Record<string, string> = {}) => ({
      ...sb,
      env: { ...sb.env, SHIPIFY_PUBLISH: "prepared", ...more },
    });
    // Not made yet: it says where it's made, and makes nothing here (this box has no keys).
    const missing = ship(inTask(), "publish", dir, "--yes");
    expect(missing.status).toBe("blocked");
    expect(missing.summary).toContain("made on GitHub's runners before the build");
    // Made: the code goes up, with no key asked for.
    const bare = join(sb.dir, "pub-app.git");
    expect(spawnSync("git", ["init", "-q", "--bare", bare]).status).toBe(0);
    expect(spawnSync("git", ["-C", dir, "remote", "add", "origin", bare]).status).toBe(0);
    const done = ship(inTask({ SHIPIFY_MOCK_REPO: "ready" }), "publish", dir, "--yes");
    expect(done.status).toBe("succeeded");
    expect(JSON.stringify(done)).not.toMatch(/setSecret|setVariable|credentials/);
    expect(
      spawnSync("git", ["-C", bare, "log", "--oneline", "-1", "main"], { encoding: "utf8" }).stdout,
    ).toContain("Record the repository");
  });

  it("rebuilds the index from manifests", () => {
    writeFileSync(sb.registry, JSON.stringify({ schemaVersion: 1, projects: [] }));
    expect(ship(sb, "list").data).toContain("no projects");
    expect(ship(sb, "reconcile").status).toBe("succeeded");
    expect(ship(sb, "list").data).toMatch(/demo-lib\s+package/);
    expect(ship(sb, "unregister", "ported-site").status).toBe("succeeded");
    expect(ship(sb, "unregister", "ported-site").code).toBe(2);
  });
});

describe("ship: evolving a project", () => {
  let sb: Sandbox;
  let dir: string;
  beforeAll(() => {
    sb = sandbox();
    ship(sb, "new", "evo-app", "--stack", "ts-worker", "--preset", "tool", "--skip-install");
    dir = join(sb.apps, "evo-app");
  });

  it("change new → check blocks until filled in → passes; untraced criteria fail", () => {
    expect(
      ship(sb, "change", "new", "evo-app", "add-favourites", "--title", "Favourites").status,
    ).toBe("succeeded");
    const file = join(dir, "docs/changes/0002-add-favourites.md");
    expect(ship(sb, "change", "check", "evo-app", "2").status).toBe("blocked");
    const filled = read(file)
      .replace(
        "[NEEDS CLARIFICATION: the problem or opportunity, in 2–3 lines]",
        "People want to star items.",
      )
      .replace(
        "- **US?(P?): …**. As a …, I want …, so that …",
        "- **US2 (P2): Star items**. As a user, I want stars, so that I find things.",
      )
      .replace(
        "  - AC?.1 WHEN … THE APP SHALL …",
        "  - AC2.1 WHEN I tap the star THE APP SHALL keep the item in Favourites.",
      )
      .replace(
        "- [ ] T1 [US?] <outcome> — files: `…` — verifies: AC?.1",
        "- [ ] T1 [US2] star button — files: `src/web/App.tsx` — verifies: AC2.1",
      )
      .replace(
        "- [NEEDS CLARIFICATION: an alternative, and why not]",
        "- A separate favourites page: one more tap to reach. Stars stay in `localStorage` (docs/adr/0001-favourites-in-browser.md).",
      )
      .replace(
        "- [NEEDS CLARIFICATION: how it rolls out, and what a rollback does]",
        "- Ships with the release; a rollback keeps stored stars, which the old version ignores.",
      );
    const check = () => ship(sb, "change", "check", "evo-app", "2");
    writeFileSync(file, filled);
    expect(check().checks?.find((c) => !c.ok)?.name).toBe("linked ADRs are in the project");
    mkdirSync(join(dir, "docs/adr"), { recursive: true });
    writeFileSync(
      join(dir, "docs/adr/0001-favourites-in-browser.md"),
      "# 0001: Favourites in the browser\n\n## Decision\nlocalStorage.\n",
    );
    expect(check().checks?.filter((c) => !c.ok)).toEqual([]);
    writeFileSync(file, filled.replace(" — verifies: AC2.1", ""));
    expect(check().status).toBe("blocked");
    const diagram = "\n```mermaid\nsequenceDiagrm\n  A->>B: star\n```\n";
    writeFileSync(file, filled.replace("## Tasks", `## Design\n${diagram}\n## Tasks`));
    expect(check().checks?.find((c) => !c.ok)?.name).toBe("diagrams are valid Mermaid");
    writeFileSync(file, filled);
  });

  it("version bumps from pending change docs, stamps them released, and freezes them", () => {
    expect(ship(sb, "version", "evo-app").summary).toContain("0.1.0 → 0.2.0 (minor)");
    expect(json(join(dir, "shipify.json")).version).toBe("0.2.0");
    expect(json(join(dir, "package.json")).version).toBe("0.2.0"); // make version
    expect(read(join(dir, "CHANGELOG.md"))).toMatch(
      /## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}\n\n### Changed\n\n- Favourites/,
    );
    expect(read(join(dir, "docs/changes/0002-add-favourites.md"))).toContain("released: v0.2.0");
    expect(ship(sb, "change", "check", "evo-app", "2").status).toBe("blocked");
    expect(ship(sb, "version", "evo-app").status).toBe("blocked"); // nothing pending
    expect(ship(sb, "version", "evo-app", "sideways").code).toBe(2);
  });

  it("upgrade: nothing to do on the current stack", () => {
    expect(ship(sb, "upgrade", "evo-app").status).toBe("skipped");
  });

  it("upgrade replaces the stack's own files and leaves the project's alone, reading no history (ADR 0048)", () => {
    const mf = join(dir, "shipify.json");
    const m = json(mf);
    const current = m.stack.version;
    m.stack.version = "0.9.0";
    writeFileSync(mf, JSON.stringify(m, null, 2));
    // An owned file edited by hand, a project file deleted, and one the project changed.
    const makefile = read(join(dir, "Makefile"));
    writeFileSync(join(dir, "Makefile"), `${makefile}\n# edited by hand\n`);
    const readme = read(join(dir, "README.md"));
    rmSync(join(dir, "README.md"));
    const headers = read(join(dir, "public/_headers"));
    writeFileSync(join(dir, "public/_headers"), "/*\n  Cache-Control: no-cache\n");
    const r = ship(sb, "upgrade", "evo-app");
    writeFileSync(join(dir, "Makefile"), makefile);
    writeFileSync(join(dir, "README.md"), readme);
    writeFileSync(join(dir, "public/_headers"), headers);
    m.stack.version = current;
    writeFileSync(mf, JSON.stringify(m, null, 2));
    expect(r.summary).toBe(`evo-app: ts-worker 0.9.0 → ${current}`);
    const actions = r.plannedActions ?? [];
    expect(actions.some((a: string) => /^write\s+Makefile$/.test(a))).toBe(true);
    expect(
      actions.some((a: string) => a.includes("README.md")),
      actions.join("\n"),
    ).toBe(false);
    expect(actions.some((a: string) => a.includes("public/_headers"))).toBe(false);
  });

  it("release only for staging apps; rollback --to validates the tag", () => {
    expect(ship(sb, "release", "evo-app").code).toBe(4);
    expect(ship(sb, "rollback", "evo-app", "--to", "latest").code).toBe(2);
  });

  it("down and up: a lasting flag for CI plus the URLs off or on, shown before anything runs", () => {
    expect(ship(sb, "down", "evo-app").summary).toContain("not published");
    const reg = json(sb.registry);
    const entry = reg.projects.find((p: { id: string }) => p.id === "evo-app");
    entry.repository = "https://github.com/mock/evo-app";
    writeFileSync(sb.registry, JSON.stringify(reg));
    const down = ship(sb, "down", "evo-app");
    expect(down.status).toBe("requires-approval");
    expect(down.plannedActions).toEqual([
      "gh variable set SHIPIFY_DOWN -R mock/evo-app --body true",
      "gh workflow run ship.yml -R mock/evo-app -f action=pause",
    ]);
    const up = ship(sb, "up", "evo-app");
    expect(up.plannedActions?.join("\n")).toContain("--body false");
    expect(up.plannedActions?.join("\n")).toContain("action=resume");
  });
});

describe("ship: parallel work (worktrees, several features)", () => {
  let sb: Sandbox;
  let dir: string;
  let origin: string;
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, env: sb.env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const fill = (file: string, us: number) =>
    writeFileSync(
      file,
      read(file)
        .replace("[NEEDS CLARIFICATION: the problem or opportunity, in 2–3 lines]", "People ask.")
        .replace(
          "- **US?(P?): …**. As a …, I want …, so that …",
          `- **US${us} (P2): Thing**. As a user, I want it, so that it helps.`,
        )
        .replace(
          "  - AC?.1 WHEN … THE APP SHALL …",
          `  - AC${us}.1 WHEN I tap THE APP SHALL do it.`,
        )
        .replace(
          "- [ ] T1 [US?] <outcome> — files: `…` — verifies: AC?.1",
          `- [ ] T1 [US${us}] it — files: \`src/web/App.tsx\` — verifies: AC${us}.1`,
        )
        .replace("- [NEEDS CLARIFICATION: an alternative, and why not]", "- Nothing: too small.")
        .replace(
          "- [NEEDS CLARIFICATION: how it rolls out, and what a rollback does]",
          "- Ships with the release; a rollback restores the previous version.",
        ),
    );
  beforeAll(() => {
    sb = sandbox();
    ship(sb, "new", "par-app", "--stack", "ts-worker", "--preset", "tool", "--skip-install");
    dir = join(sb.apps, "par-app");
    origin = join(sb.dir, "origin.git");
    git(sb.dir, "init", "-q", "--bare", "-b", "main", origin);
    git(dir, "remote", "add", "origin", origin);
    git(dir, "push", "-q", "-u", "origin", "main");
  });

  it("commands take a worktree's path and act on it, not the main checkout", () => {
    const wt = join(sb.dir, "worktrees", "par-app", "feature");
    git(dir, "worktree", "add", "-q", "-b", "change/feature", wt);
    const cl = join(wt, "CHANGELOG.md");
    writeFileSync(
      cl,
      read(cl).replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n\n- A fix.\n"),
    );
    expect(ship(sb, "version", wt, "patch").summary).toContain("0.1.0 → 0.1.1");
    expect(json(join(wt, "shipify.json")).version).toBe("0.1.1");
    expect(json(join(dir, "shipify.json")).version).toBe("0.1.0");
    // A worktree inside the projects folder is still the same project, not a new one.
    const inside = join(sb.apps, "par-app-wt");
    git(dir, "worktree", "add", "-q", "-b", "change/inside", inside);
    expect(ship(sb, "reconcile").status).toBe("succeeded");
    const entries = json(sb.registry).projects.filter((p: { id: string }) => p.id === "par-app");
    expect(entries.map((p: { path: string }) => p.path.split("/").pop())).toEqual(["par-app"]);
  });

  it("numbers change docs after main's, and catches a number main already took", () => {
    const other = join(sb.dir, "other");
    git(sb.dir, "clone", "-q", origin, other);
    mkdirSync(join(other, "docs/changes"), { recursive: true });
    writeFileSync(join(other, "docs/changes/0002-merged-first.md"), "---\nchange: 2\n---\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "a sibling change merged first");
    git(other, "push", "-q", "origin", "main");
    expect(ship(sb, "change", "new", "par-app", "mine").status).toBe("succeeded");
    const mine = join(dir, "docs/changes/0003-mine.md");
    expect(existsSync(mine)).toBe(true);
    fill(mine, 3);
    expect(ship(sb, "change", "check", "par-app", "3").checks?.filter((c) => !c.ok)).toEqual([]);
    const clashing = join(dir, "docs/changes/0002-mine.md");
    writeFileSync(clashing, read(mine).replace("change: 3", "change: 2"));
    const clash = ship(sb, "change", "check", "par-app", "2").checks?.find((c) => !c.ok);
    expect(clash?.name).toBe("change number is free on main");
    rmSync(clashing);
  });

  it("submits a change doc without switching the checkout's branch", () => {
    const r = ship(sb, "change", "submit", "par-app", "3", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    expect(git(dir, "branch", "--show-current")).toBe("main");
    expect(existsSync(join(dir, "docs/changes/0003-mine.md"))).toBe(false); // moved to its branch
    const onBranch = git(origin, "ls-tree", "-r", "--name-only", "change/0003-mine");
    expect(onBranch).toContain("docs/changes/0003-mine.md");
    expect(git(origin, "log", "--format=%s", "change/0003-mine", "-1")).toBe("Change 3: mine");
  });
});

describe("doctor: when this PC's GitHub token expires", () => {
  it("reads the date from GitHub's reply headers", () => {
    expect(
      tokenExpiry(
        "HTTP/2.0 200 OK\nGithub-Authentication-Token-Expiration: 2027-09-28 05:10:13 UTC\n\n{}",
      ),
    ).toBe("2027-09-28");
    expect(tokenExpiry("HTTP/2.0 200 OK\nContent-Type: application/json\n\n{}")).toBe("never");
    expect(tokenExpiry("github-authentication-token-expiration: someday")).toBeUndefined();
  });
});

describe("doctor: an agent to work with", () => {
  const executors = {
    one: { description: "", task: ["agent-one", "-p"], command: ["agent-one"] },
    two: { description: "", command: ["agent-two", "{promptText}"] },
    manual: { description: "", manual: true },
  };
  it("passes when any agent in executors.json is installed, and names it", () => {
    const c = agentCheck(executors, (p) => p === "agent-two");
    expect(c).toMatchObject({ ok: true, detail: "agent-two", blocking: false });
  });
  it("names every agent it could use when none is installed", () => {
    const c = agentCheck(executors, () => false);
    expect(c.ok).toBe(false);
    expect(c.fix).toContain("agent-one, agent-two");
  });
});
