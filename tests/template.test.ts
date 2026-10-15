// Releases and updates (ADR 0047, cli/commands/template.ts, docs/releases.md), end to end with real
// git: a copy where Shipify is built, the template it publishes to, and another copy made from the
// template that takes each release as a PR. GitHub's API is a fake answering from those repos;
// nothing reaches the network, and the full check is the test's own.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_APP, setFormProjects } from "../cli/lib/forms.ts";
import { isYours, keptForm, productFiles, templateForm, versionOf } from "../cli/lib/template.ts";

// GitHub, as the release and the update ask it, answered from the bare repos on disk.
const world = vi.hoisted(() => ({
  dir: "",
  /** Each gh call's arguments. */
  calls: [] as string[][],
  /** The copy's variables, as `gh variable set` left them. */
  vars: {} as Record<string, string>,
  /** Releases, newest first: [tag, notes]. */
  releases: [] as [string, string][],
  /** PRs by branch: [state, url]. */
  prs: {} as Record<string, [string, string]>,
}));
const bare = (repo: string) => join(world.dir, "github", `${repo}.git`);
vi.mock("../cli/lib/exec.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cli/lib/exec.ts")>();
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
  const no = { code: 1, stdout: "", stderr: "HTTP 404: Not Found" };
  return {
    ...real,
    run: (cmd: string, args: string[], opts?: Parameters<typeof real.run>[2]) => {
      if (cmd !== "gh") return real.run(cmd, args, opts);
      world.calls.push(args);
      const [a0, a1, a2] = args;
      if (a0 === "variable" && a1 === "set") {
        world.vars[a2 ?? ""] = args[args.indexOf("--body") + 1] ?? "";
        return ok();
      }
      if (a0 === "repo" && a1 === "create") {
        real.run("git", ["init", "-q", "--bare", "-b", "main", bare(a2 ?? "")]);
        return ok();
      }
      if (a0 === "pr" && a1 === "list") {
        const head = args[args.indexOf("--head") + 1] ?? "";
        const pr = world.prs[head];
        return ok(pr ? `${pr[0]}\t${pr[1]}` : "");
      }
      if (a0 === "pr" && a1 === "create") {
        const head = args[args.indexOf("--head") + 1] ?? "";
        world.prs[head] = ["OPEN", "https://github.com/f/shipify/pull/7"];
        return ok("https://github.com/f/shipify/pull/7\n");
      }
      if (a0 !== "api") return no;
      const path = args.find((x, i) => i > 0 && x.startsWith("repos/")) ?? "";
      const m = /^repos\/([^/]+\/[^/?]+)(.*)$/.exec(path);
      const repo = m?.[1] ?? "";
      const rest = m?.[2] ?? "";
      if (args.includes("-X")) return ok();
      // A copy made with Use this template would name it; none here was.
      if (rest === "" && args.includes(".template_repository.full_name // empty")) return ok("");
      if (rest === "") return existsSync(bare(repo)) ? ok(repo) : no;
      if (rest === "/contents/package.json") {
        const r = real.run("git", ["--git-dir", bare(repo), "show", "main:package.json"]);
        return r.code === 0 ? ok(Buffer.from(r.stdout).toString("base64")) : no;
      }
      if (rest.startsWith("/releases?"))
        return ok(
          world.releases.map(([t]) => `${t}\thttps://github.com/${repo}/releases/${t}`).join("\n"),
        );
      if (rest.startsWith("/releases/tags/"))
        return ok(world.releases.find(([t]) => rest.endsWith(t))?.[1] ?? "");
      return no;
    },
  };
});

const { templateRelease, shipUpdate } = await import("../cli/commands/template.ts");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (root: string, files: Record<string, string>) => {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
};
const FORM = (apps: string[]) =>
  setFormProjects(
    "body:\n  - type: dropdown\n    attributes:\n      options:\n        # Projects: `ship forms` keeps this list current (publishing a project updates it).\n        - x\n",
    apps,
  );
const pkg = (v: string) => `{\n  "name": "shipify",\n  "version": "${v}"\n}\n`;

/** A repo on "GitHub" (a bare repo) and its checkout, with these files committed on main. */
function repoWith(name: string, files: Record<string, string>) {
  const origin = bare(name);
  git(world.dir, "init", "-q", "--bare", "-b", "main", origin);
  const root = join(world.dir, "work", name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "remote", "add", "origin", origin);
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  git(root, "push", "-q", "origin", "main");
  return root;
}
const onGitHub = (repo: string, path: string, ref = "main") =>
  git(world.dir, "--git-dir", bare(repo), "show", `${ref}:${path}`);
const filesOn = (repo: string, ref = "main") =>
  git(world.dir, "--git-dir", bare(repo), "ls-tree", "-r", "--name-only", ref).split("\n");

const TEMPLATE = "o/shipify-template";
const deps = (root: string, check = () => true, scan = (_dir: string): string[] => []) => ({
  root,
  remote: (repo: string) => bare(repo),
  check,
  scan,
  download: (repo: string, tag: string, into: string) => {
    execFileSync("sh", [
      "-c",
      `git --git-dir "${bare(repo)}" archive "${tag}" | tar -x -C "${into}"`,
    ]);
    return true;
  },
});

/** The copy Shipify is built in: its own files, and yours beside them. */
function source() {
  return repoWith("o/shipify", {
    "package.json": pkg("0.1.0"),
    "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n- The first release.\n",
    "cli/x.ts": "export const x = 1;\n",
    "docs/old.md": "gone in 0.1.1\n",
    ".github/ISSUE_TEMPLATE/7-operate.yml": FORM(["spotter"]),
    "plans/.gitkeep": "",
    "plans/spotter.plan.md": "your plan\n",
    "recipes/README.md": "recipes\n",
    "recipes/examples/daily.md": "an example\n",
    "recipes/mine.md": "your recipe\n",
    "checks/README.md": "checks\n",
    "checks/example.mjs": "// example\n",
    "checks/mine.mjs": "// your check\n",
  });
}

beforeEach(() => {
  world.dir = mkdtempSync(join(tmpdir(), "releases-"));
  world.calls = [];
  world.vars = {};
  world.releases = [];
  world.prs = {};
  for (const [k, v] of Object.entries({
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    SHIPIFY_TEMPLATE: "",
    SHIPIFY_TEMPLATE_TOKEN: "",
    SHIPIFY_PRIVATE_WORDS: "",
    // This PC's copies of its settings: the template's name is kept there by a release.
    SHIPIFY_CREDENTIALS: join(world.dir, "credentials.env"),
  }))
    vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(world.dir, { recursive: true, force: true });
});

describe("what's yours and what's Shipify's (lib/template.ts)", () => {
  it("keeps your plans, recipes and checks out, and their READMEs and examples in", () => {
    expect(
      productFiles([
        "cli/x.ts",
        "plans/.gitkeep",
        "plans/spotter.plan.md",
        "recipes/README.md",
        "recipes/examples/daily.md",
        "recipes/mine.md",
        "checks/README.md",
        "checks/example.mjs",
        "checks/mine.mjs",
      ]),
    ).toEqual([
      "cli/x.ts",
      "plans/.gitkeep",
      "recipes/README.md",
      "recipes/examples/daily.md",
      "checks/README.md",
      "checks/example.mjs",
    ]);
    expect(isYours("plans/x.plan.md")).toBe(true);
    expect(isYours("docs/plans.md")).toBe(false);
    // Dependabot's updates come where Shipify is built; a copy takes them with each version.
    expect(isYours(".github/dependabot.yml")).toBe(true);
    expect(isYours(".github/workflows/ci.yml")).toBe(false);
  });

  it("publishes the forms with no app (one option, as GitHub needs), and an update keeps yours", () => {
    const yours = FORM(["links", "spotter"]);
    const published = templateForm("7-operate.yml", yours);
    expect(published).toContain(`- ${NO_APP}`);
    expect(published).not.toContain("spotter");
    expect(keptForm("7-operate.yml", published, yours)).toBe(yours);
    expect(templateForm("4-repeat.yml", "as it is")).toBe("as it is");
  });

  it("reads a release's version from its tag", () => {
    expect(versionOf("v0.1.1")).toBe("0.1.1");
    expect(versionOf("v1")).toBeUndefined();
  });
});

describe("a release: ship template (shipify: release)", () => {
  beforeEach(() => vi.stubEnv("GITHUB_REPOSITORY", "o/shipify"));

  it("shows its plan first, and changes nothing", () => {
    const root = source();
    const r = templateRelease({ repo: TEMPLATE, yes: false }, deps(root));
    expect(r.status).toBe("requires-approval");
    expect(r.summary).toBe(`would release Shipify 0.1.0 to ${TEMPLATE}`);
    const plan = (r.plannedActions ?? []).join("\n");
    expect(plan).toContain(`make ${TEMPLATE}: private, marked as a template`);
    expect(plan).toContain("Never your plans, recipes or checks");
    expect(plan).toContain("its full check. Nothing is published or recorded if that fails");
    expect(String(r.data)).toContain("The first release.");
    expect(existsSync(bare(TEMPLATE))).toBe(false);
    expect(world.vars).toEqual({});
  });

  it("the first: makes the template, publishes Shipify's own files, records the version here", () => {
    const root = source();
    const r = templateRelease({ repo: TEMPLATE, yes: true }, deps(root));
    expect(r.status, r.summary).toBe("succeeded");
    expect(world.calls).toContainEqual(
      expect.arrayContaining(["repo", "create", TEMPLATE, "--private"]),
    );
    expect(world.calls).toContainEqual(expect.arrayContaining(["-F", "is_template=true"]));
    // On the template: one commit, Shipify's own files, none of yours, the forms with no app.
    expect(git(world.dir, "--git-dir", bare(TEMPLATE), "log", "--format=%s", "main")).toBe(
      "Shipify 0.1.0",
    );
    expect(filesOn(TEMPLATE).sort()).toEqual(
      [
        ".github/ISSUE_TEMPLATE/7-operate.yml",
        "CHANGELOG.md",
        "checks/README.md",
        "checks/example.mjs",
        "cli/x.ts",
        "docs/old.md",
        "package.json",
        "plans/.gitkeep",
        "recipes/README.md",
        "recipes/examples/daily.md",
      ].sort(),
    );
    expect(onGitHub(TEMPLATE, ".github/ISSUE_TEMPLATE/7-operate.yml")).toContain(`- ${NO_APP}`);
    expect(onGitHub(TEMPLATE, "CHANGELOG.md")).toMatch(
      /## \[0\.1\.0\] - \d{4}-\d{2}-\d{2}\n\n- The first release\./,
    );
    // Its version file names it: every copy made from it follows it by that.
    expect(JSON.parse(onGitHub(TEMPLATE, "package.json")).shipify).toEqual({ template: TEMPLATE });
    // Recorded here: the same version and notes on main, and the copy follows the template.
    expect(git(world.dir, "--git-dir", bare("o/shipify"), "log", "-1", "--format=%s", "main")).toBe(
      "Shipify 0.1.0",
    );
    expect(onGitHub("o/shipify", "CHANGELOG.md")).toBe(onGitHub(TEMPLATE, "CHANGELOG.md"));
    expect(onGitHub("o/shipify", "plans/spotter.plan.md")).toBe("your plan");
    expect(world.vars).toEqual({ SHIPIFY_TEMPLATE: TEMPLATE });
    // And kept on this PC, so `ship update` and the next release read it there too.
    expect(readFileSync(join(world.dir, "credentials.env"), "utf8")).toContain(
      `SHIPIFY_TEMPLATE=${TEMPLATE}`,
    );
    // This checkout was never touched: the release worked in its own folders.
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "log", "-1", "--format=%s")).toBe("start");
    // Again, with nothing new: nothing to do.
    vi.stubEnv("SHIPIFY_TEMPLATE", TEMPLATE);
    expect(templateRelease({ yes: true }, deps(root)).status).toBe("skipped");
  });

  it("the next: months of changes as one commit on the template, at the next version", () => {
    const root = source();
    templateRelease({ repo: TEMPLATE, yes: true }, deps(root));
    vi.stubEnv("SHIPIFY_TEMPLATE", TEMPLATE);
    // Changes merged here since: a file changed, one gone, notes under Unreleased.
    git(root, "pull", "-q", "origin", "main");
    write(root, {
      "cli/x.ts": "export const x = 2;\n",
      "CHANGELOG.md": readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(
        "## [Unreleased]\n",
        "## [Unreleased]\n\n- Faster.\n- Simpler.\n",
      ),
    });
    git(root, "rm", "-q", "docs/old.md");
    git(root, "commit", "-qam", "changes");
    git(root, "push", "-q", "origin", "main");
    const r = templateRelease({ yes: true, bump: "minor" }, deps(root));
    expect(r.status, r.summary).toBe("succeeded");
    expect(
      git(world.dir, "--git-dir", bare(TEMPLATE), "log", "--format=%s", "main").split("\n"),
    ).toEqual(["Shipify 0.2.0", "Shipify 0.1.0"]);
    expect(onGitHub(TEMPLATE, "cli/x.ts")).toBe("export const x = 2;");
    expect(filesOn(TEMPLATE)).not.toContain("docs/old.md");
    expect(onGitHub(TEMPLATE, "package.json")).toContain('"version": "0.2.0"');
    expect(onGitHub(TEMPLATE, "CHANGELOG.md")).toMatch(
      /## \[0\.2\.0\][^\n]*\n\n- Faster\.\n- Simpler\./,
    );
    expect(onGitHub("o/shipify", "package.json")).toContain('"version": "0.2.0"');
  });

  it("publishes and records nothing when the check fails", () => {
    const root = source();
    const r = () =>
      templateRelease(
        { repo: TEMPLATE, yes: true },
        deps(root, () => false),
      );
    expect(r).toThrow("The check failed on the files to publish");
    expect(existsSync(bare(TEMPLATE))).toBe(false);
    expect(git(world.dir, "--git-dir", bare("o/shipify"), "log", "--format=%s", "main")).toBe(
      "start",
    );
  });

  it("publishes your private words as their stand-ins, in their case; your copy keeps them", () => {
    const root = source();
    write(root, { "docs/accounts.md": "On Globex's account: globex/api, GLOBEX.\n" });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "an example");
    git(root, "push", "-q", "origin", "main");
    vi.stubEnv("SHIPIFY_PRIVATE_WORDS", '{"globex": "acme"}');
    const plan = templateRelease({ repo: TEMPLATE, yes: false }, deps(root));
    expect((plan.plannedActions ?? []).join("\n")).toContain("your 1 private word(s) replaced");
    const r = templateRelease({ repo: TEMPLATE, yes: true }, deps(root));
    expect(r.status, r.summary).toBe("succeeded");
    expect(onGitHub(TEMPLATE, "docs/accounts.md")).toBe("On Acme's account: acme/api, ACME.");
    expect(onGitHub("o/shipify", "docs/accounts.md")).toBe(
      "On Globex's account: globex/api, GLOBEX.",
    );
  });

  it("publishes nothing when a tailnet's name or a key is in what it would publish", () => {
    const root = source();
    // Made at run time: this file is published too, and the check would stop on it.
    write(root, { "docs/box.md": `Cockpit: https://pi.${"tail"}1a2b3c.ts.net\n` });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "a link");
    git(root, "push", "-q", "origin", "main");
    expect(() => templateRelease({ repo: TEMPLATE, yes: true }, deps(root))).toThrow(
      "Not published: docs/box.md: a tailnet's name",
    );
    expect(existsSync(bare(TEMPLATE))).toBe(false);
    const keyed = () =>
      templateRelease(
        { repo: TEMPLATE, yes: true },
        deps(root, undefined, () => ["cli/x.ts:1 (github-pat)"]),
      );
    expect(keyed).toThrow("cli/x.ts:1 (github-pat)");
    expect(existsSync(bare(TEMPLATE))).toBe(false);
    expect(git(world.dir, "--git-dir", bare("o/shipify"), "log", "--format=%s", "main")).toBe(
      "a link\nstart",
    );
  });

  it("refuses words it can't read, and a stand-in that holds its word", () => {
    const root = source();
    vi.stubEnv("SHIPIFY_PRIVATE_WORDS", "globex");
    expect(() => templateRelease({ repo: TEMPLATE, yes: false }, deps(root))).toThrow(
      "SHIPIFY_PRIVATE_WORDS isn't JSON",
    );
    vi.stubEnv("SHIPIFY_PRIVATE_WORDS", '{"acme": "acme-co"}');
    expect(() => templateRelease({ repo: TEMPLATE, yes: false }, deps(root))).toThrow(
      "stand-in contains it",
    );
  });

  it("on GitHub's machine, never makes the template: its first release is from your PC", () => {
    const root = source();
    expect(() => templateRelease({ repo: TEMPLATE, yes: true, inJob: true }, deps(root))).toThrow(
      "its first release makes it, from your PC once",
    );
  });
});

describe("an update: ship update (update.yml), on a copy made from the template", () => {
  /** The template at 0.1.0 and 0.2.0, and a copy made from 0.1.0 with its own files. */
  function made() {
    const root = source();
    vi.stubEnv("GITHUB_REPOSITORY", "o/shipify");
    templateRelease({ repo: TEMPLATE, yes: true }, deps(root));
    git(world.dir, "--git-dir", bare(TEMPLATE), "tag", "v0.1.0", "main");
    vi.stubEnv("SHIPIFY_TEMPLATE", TEMPLATE);
    git(root, "pull", "-q", "origin", "main");
    write(root, {
      "cli/x.ts": "export const x = 2;\n",
      "CHANGELOG.md": readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(
        "## [Unreleased]\n",
        "## [Unreleased]\n\n- Faster.\n",
      ),
    });
    git(root, "rm", "-q", "docs/old.md");
    git(root, "commit", "-qam", "changes");
    git(root, "push", "-q", "origin", "main");
    templateRelease({ yes: true, bump: "minor" }, deps(root));
    git(world.dir, "--git-dir", bare(TEMPLATE), "tag", "v0.2.0", "main");
    world.releases = [
      ["v0.2.0", "- Faster."],
      ["v0.1.0", "- The first release."],
    ];
    // Someone's copy, made from 0.1.0: their own plan, recipe, plug-in and app list.
    const files: Record<string, string> = {};
    for (const f of filesOn(TEMPLATE, "v0.1.0")) files[f] = `${onGitHub(TEMPLATE, f, "v0.1.0")}\n`;
    const theirs = repoWith("f/shipify", {
      ...files,
      "plans/notes-app.plan.md": "their plan\n",
      "recipes/weekly.md": "their recipe\n",
      "tools/mine/mine.ts": "their tool\n",
      ".github/ISSUE_TEMPLATE/7-operate.yml": FORM(["notes-app"]),
    });
    vi.stubEnv("GITHUB_REPOSITORY", "f/shipify");
    vi.stubEnv("SHIPIFY_TEMPLATE", TEMPLATE);
    world.calls = [];
    return theirs;
  }

  it("offers the newest as one PR: Shipify's own files as released, theirs kept, every note since", () => {
    const root = made();
    const plan = shipUpdate({ yes: false }, deps(root));
    expect(plan.status).toBe("requires-approval");
    expect(plan.summary).toBe("would offer Shipify 0.2.0 (this copy has 0.1.0)");
    const r = shipUpdate({ yes: true }, deps(root));
    expect(r.status, r.summary).toBe("succeeded");
    const at = "shipify/update-0.2.0";
    expect(onGitHub("f/shipify", "cli/x.ts", at)).toBe("export const x = 2;");
    expect(onGitHub("f/shipify", "package.json", at)).toContain('"version": "0.2.0"');
    expect(filesOn("f/shipify", at)).not.toContain("docs/old.md");
    // Theirs, as they were.
    expect(onGitHub("f/shipify", "plans/notes-app.plan.md", at)).toBe("their plan");
    expect(onGitHub("f/shipify", "recipes/weekly.md", at)).toBe("their recipe");
    // A plug-in they added: only what the template itself took out since 0.1.0 goes.
    expect(onGitHub("f/shipify", "tools/mine/mine.ts", at)).toBe("their tool");
    expect(onGitHub("f/shipify", ".github/ISSUE_TEMPLATE/7-operate.yml", at)).toContain(
      "- notes-app",
    );
    // Main untouched: the PR is the only way in.
    expect(onGitHub("f/shipify", "package.json")).toContain('"version": "0.1.0"');
    const pr = world.calls.find((c) => c[0] === "pr" && c[1] === "create") ?? [];
    expect(pr[pr.indexOf("--title") + 1]).toBe("Shipify 0.2.0");
    const body = pr[pr.indexOf("--body") + 1] ?? "";
    expect(body).toContain("## v0.2.0\n\n- Faster.");
    expect(body).not.toContain("## v0.1.0");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("asks nothing again: its PR open, or closed by you; and a copy that has it is up to date", () => {
    const root = made();
    world.prs["shipify/update-0.2.0"] = ["OPEN", "https://github.com/f/shipify/pull/7"];
    expect(shipUpdate({ yes: true }, deps(root)).summary).toBe(
      "Shipify 0.2.0's PR is open: https://github.com/f/shipify/pull/7",
    );
    world.prs["shipify/update-0.2.0"] = ["CLOSED", "https://github.com/f/shipify/pull/7"];
    expect(shipUpdate({ yes: true }, deps(root)).summary).toContain(
      "you closed Shipify 0.2.0's PR",
    );
    world.releases = [["v0.1.0", ""]];
    expect(shipUpdate({ yes: true }, deps(root)).summary).toBe(
      `up to date: Shipify 0.1.0, as ${TEMPLATE} has it`,
    );
    expect(world.calls.some((c) => c[1] === "create")).toBe(false);
  });

  it("never offers an older version: a copy ahead of the template's newest release is up to date", () => {
    // Where Shipify is built, a release is recorded here before the template's CI releases it.
    const root = made();
    world.releases = [["v0.0.9", ""]];
    const r = shipUpdate({ yes: true }, deps(root));
    expect(r.status).toBe("succeeded");
    expect(r.summary).toBe(`up to date: Shipify 0.1.0, newer than ${TEMPLATE}'s 0.0.9`);
    expect(world.calls.some((c) => c[1] === "create")).toBe(false);
  });

  it("takes nothing out when the template has no release of this copy's version, and says so", () => {
    const root = made();
    world.releases = [["v0.2.0", "- Faster."]];
    expect(shipUpdate({ yes: true }, deps(root)).status).toBe("succeeded");
    expect(filesOn("f/shipify", "shipify/update-0.2.0")).toContain("docs/old.md");
    const pr = world.calls.find((c) => c[0] === "pr" && c[1] === "create") ?? [];
    expect(pr[pr.indexOf("--body") + 1]).toContain(
      `**Nothing taken out:** ${TEMPLATE} has no release of 0.1.0`,
    );
  });

  it("follows the template its version file names, with no setting; none when neither names one", () => {
    const root = made();
    vi.stubEnv("SHIPIFY_TEMPLATE", "");
    vi.stubEnv("SHIPIFY_CREDENTIALS", join(world.dir, "another-pc.env"));
    expect(shipUpdate({ yes: false }, deps(root)).summary).toBe(
      "would offer Shipify 0.2.0 (this copy has 0.1.0)",
    );
    write(root, { "package.json": pkg("0.1.0") });
    git(root, "commit", "-qam", "names none");
    git(root, "push", "-q", "origin", "main");
    expect(shipUpdate({ yes: true }, deps(root)).status).toBe("skipped");
  });
});
