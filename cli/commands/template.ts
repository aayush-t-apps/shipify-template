// Releases and updates (ADR 0047, docs/releases.md). Shipify is built in your copy; a release puts
// its own files on the template, one clean commit per version, and every other copy takes it as one
// PR. One direction only: your copy, then the template, then the copies.
//   ship template [<owner/repo>] [--minor|--major] [--yes]   release: check, version, record, publish
//   ship update [--yes]                                     this copy: the template's newest, as a PR
// On GitHub, `shipify: release` runs the first (the github job, with the bot's keys), and
// update.yml the second, weekly.
import {
  cpSync,
  type Dirent,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { copySetting, PLATFORM_ROOT, VERSION_FILE } from "../lib/config.ts";
import { type Bump, bumpVersion, releaseChangelog, unreleased } from "../lib/docs.ts";
import { run } from "../lib/exec.ts";
import { FORM_PROJECTS, FORMS_DIR } from "../lib/forms.ts";
import { ghRun, platformRepo } from "../lib/github.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { isYours, keptForm, productFiles, templateForm, versionOf } from "../lib/template.ts";

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const FORMS = relative(PLATFORM_ROOT, FORMS_DIR);

const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });
const must = (r: { code: number; stderr: string }, what: string) => {
  if (r.code !== 0) throw new ShipError(`${what}: ${r.stderr.trim().split("\n")[0]}`);
};
const versionIn = (text: string) => (JSON.parse(text) as { version: string }).version;

/**
 * Main as GitHub has it: fetched, so a release and an update work from what's merged, whatever this
 * checkout holds. Each works in a worktree of its own and never touches this one.
 */
function fetchMain(root: string): void {
  must(git(root, "fetch", "-q", "origin", "main"), "Couldn't read main from GitHub");
}
const MAIN = "origin/main";
const onMain = (root: string, path: string) => git(root, "show", `${MAIN}:${path}`).stdout;
const mainFiles = (root: string) =>
  git(root, "ls-tree", "-r", "--name-only", MAIN).stdout.split("\n").filter(Boolean);

/** A worktree of main as GitHub has it, in `dir`, detached: removed by `drop`. */
function worktree(root: string, dir: string): { dir: string; drop: () => void } {
  must(
    git(root, "worktree", "add", "-q", "--detach", dir, MAIN),
    "Couldn't make a worktree of main",
  );
  return { dir, drop: () => void git(root, "worktree", "remove", "--force", dir) };
}

/** A repo's file on its main, as text, or undefined when there's none (or no repo). */
function fileOn(repo: string, path: string, token?: string): string | undefined {
  const r = ghRun(
    ["api", `repos/${repo}/contents/${path}`, "--jq", ".content"],
    token ? { token } : {},
  );
  return r.code === 0 ? Buffer.from(r.stdout.trim(), "base64").toString("utf8") : undefined;
}

/** Every file under a folder, by its path from there. */
const filesIn = (dir: string) =>
  (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)));

// ---------------------------------------------------------------- the outside world

/** What a release and an update reach outside this process; tests hand in their own. */
export interface ReleaseDeps {
  /** This copy's checkout. */
  root: string;
  /** A repo's git address. */
  remote: (repo: string) => string;
  /** The full check on the files to publish, in their folder: as the template's CI runs it. */
  check: (dir: string) => boolean;
  /** A release's files, unpacked into `into`, read with the template's key. */
  download: (repo: string, tag: string, into: string, token?: string) => boolean;
}

export const releaseDeps = (): ReleaseDeps => ({
  root: PLATFORM_ROOT,
  remote: (repo) => `https://github.com/${repo}.git`,
  check: (dir) =>
    run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: dir, show: true })
      .code === 0 && run("pnpm", ["verify"], { cwd: dir, show: true }).code === 0,
  download: (repo, tag, into, token) => {
    const tgz = join(into, "..", "release.tgz");
    const got = run("sh", ["-c", `gh api "repos/${repo}/tarball/${tag}" > "${tgz}"`], {
      ...(token ? { env: { GH_TOKEN: token } } : {}),
    });
    return (
      got.code === 0 && run("tar", ["-xzf", tgz, "-C", into, "--strip-components=1"]).code === 0
    );
  },
});

// ---------------------------------------------------------------- release

/**
 * A release: Shipify's own files as merged here, at the next version, checked, recorded on this
 * copy's main and published to the template as one commit, whose CI releases it. The version is
 * main's while the template doesn't have it yet (the first release: 0.1.0), else the next one
 * (`bump`, patch by default). Your files never go: your plans, recipes and checks, and your forms'
 * apps. Safe to run again: what's done already is skipped.
 */
export function templateRelease(
  opts: {
    repo?: string;
    bump?: Bump;
    yes: boolean;
    /** On GitHub's machine (the github job): it can't make the template's repo. */
    inJob?: boolean;
  },
  deps: ReleaseDeps = releaseDeps(),
): Result {
  const root = deps.root;
  const copy = platformRepo();
  const target = opts.repo ?? copySetting("SHIPIFY_TEMPLATE");
  if (!target)
    throw new ShipError(
      "Name the template the first time: pnpm ship template <owner>/shipify-template (docs/releases.md).",
      "blocked",
    );
  if (!REPO.test(target) || target.toLowerCase() === copy.toLowerCase())
    throw new ShipError(
      `${target} can't be the template: name another repo, owner/name.`,
      "blocked",
    );
  fetchMain(root);
  const exists = ghRun(["api", `repos/${target}`, "--jq", ".full_name"]).code === 0;
  const pkgText = onMain(root, VERSION_FILE);
  const current = versionIn(pkgText);
  const theirs = exists ? fileOn(target, VERSION_FILE) : undefined;
  const published = theirs ? versionIn(theirs) : undefined;
  const changelog = onMain(root, "CHANGELOG.md");
  const pending = unreleased(changelog);
  if (published === current && !pending)
    return {
      command: "template",
      status: "skipped",
      summary: `${target} has Shipify ${current}, and nothing is new since: CHANGELOG.md's Unreleased is empty`,
    };
  // Main's version while the template doesn't have it, else the next one.
  const next = published === current ? bumpVersion(current, opts.bump ?? "patch") : current;
  const notes = pending || sectionOf(changelog, next);
  const tracked = mainFiles(root);
  const files = productFiles(tracked);
  const record = next !== current || Boolean(pending);
  const planned = [
    exists
      ? `publish to ${target}, which has ${published ? `Shipify ${published}` : "nothing yet"}`
      : `make ${target}: private, marked as a template (its "Use this template"), empty`,
    `Shipify ${next}: ${pending ? "CHANGELOG.md's Unreleased becomes its notes" : "its notes as CHANGELOG.md has them"} (below)`,
    `its files: Shipify's own, ${files.length} of this copy's ${tracked.length}. Never your plans, recipes or checks; the forms' app lists empty`,
    "check them first in a folder of their own, as the template's CI will: its install, then its full check. Nothing is published or recorded if that fails",
    ...(record
      ? [
          `record ${next} on ${copy}'s main: its version and CHANGELOG.md, one commit "Shipify ${next}" (its CI tags it)`,
        ]
      : []),
    `one commit on ${target}'s main, "Shipify ${next}": its CI releases v${next}, and every copy that follows it gets an update PR`,
    ...(copySetting("SHIPIFY_TEMPLATE") === target
      ? []
      : [`set the variable SHIPIFY_TEMPLATE=${target} on ${copy}, so its update check follows it`]),
  ];
  if (!opts.yes)
    return {
      command: "template",
      status: "requires-approval",
      summary: `would release Shipify ${next} to ${target}`,
      plannedActions: planned,
      data: notes ? `  Its notes:\n${notes.replace(/^/gm, "    ")}` : undefined,
      nextSteps: [
        `pnpm ship template${opts.repo ? ` ${target}` : ""}${opts.bump && opts.bump !== "patch" ? ` --${opts.bump}` : ""} --yes`,
      ],
    };
  if (!exists && opts.inJob)
    throw new ShipError(
      `${target} isn't there yet: its first release makes it, from your PC once: pnpm ship template ${target} --yes.`,
      "blocked",
    );

  const tmp = mkdtempSync(join(tmpdir(), "shipify-release-"));
  try {
    const tree = join(tmp, "tree");
    mkdirSync(tree);
    // The product as merged, at the new version.
    must(
      run("sh", ["-c", `git archive ${MAIN} | tar -x -C "${tree}"`], { cwd: root }),
      "Couldn't take the files from main",
    );
    for (const f of tracked) if (isYours(f)) rmSync(join(tree, f), { force: true });
    for (const file of Object.keys(FORM_PROJECTS)) {
      const path = join(tree, FORMS, file);
      writeFileSync(path, templateForm(file, readFileSync(path, "utf8")));
    }
    const newLog = pending ? releaseChangelog(changelog, next, []) : changelog;
    const newPkg = pkgText.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`);
    writeFileSync(join(tree, "CHANGELOG.md"), newLog);
    writeFileSync(join(tree, VERSION_FILE), newPkg);
    // One commit on the template's main (its first, for a new one).
    must(git(tree, "init", "-q", "-b", "main"), "Couldn't start the release's commit");
    // Its remote, as the template's own checkout has it: the check runs as its CI will.
    must(git(tree, "remote", "add", "origin", deps.remote(target)), "Couldn't name the template");
    if (published) {
      must(
        git(tree, "fetch", "-q", "--depth", "1", deps.remote(target), "main"),
        `Couldn't read ${target}`,
      );
      must(
        git(tree, "reset", "-q", "--soft", "FETCH_HEAD"),
        "Couldn't start on the template's main",
      );
    }
    git(tree, "add", "-A");
    must(git(tree, "commit", "-q", "-m", `Shipify ${next}`), "Couldn't make the release's commit");
    // Checked as the template's CI checks it: nothing leaves before this passes.
    if (!deps.check(tree))
      throw new ShipError(
        `The check failed on the files to publish (above): nothing was published or recorded. Fix it here in a PR, then release again.`,
        "blocked",
      );
    // Recorded here first, in a worktree of main: a release stopped after this carries on from it
    // when run again (main then has the version, and the template doesn't yet).
    if (record) {
      const w = worktree(root, join(tmp, "main"));
      try {
        writeFileSync(join(w.dir, "CHANGELOG.md"), newLog);
        writeFileSync(join(w.dir, VERSION_FILE), newPkg);
        must(
          git(w.dir, "commit", "-q", "-m", `Shipify ${next}`, "--", VERSION_FILE, "CHANGELOG.md"),
          "Couldn't record the version",
        );
        must(
          git(w.dir, "push", "-q", "origin", "HEAD:main"),
          `Couldn't record ${next} on ${copy} (main moved since? release again)`,
        );
      } finally {
        w.drop();
      }
    }
    if (!exists) {
      must(
        ghRun([
          "repo",
          "create",
          target,
          "--private",
          "--description",
          'Shipify: your own, from "Use this template" (docs/getting-started.md)',
        ]),
        `Couldn't make ${target}`,
      );
      must(
        ghRun(["api", "-X", "PATCH", `repos/${target}`, "-F", "is_template=true"]),
        `Couldn't mark ${target} a template`,
      );
    }
    must(
      git(tree, "push", "-q", deps.remote(target), "HEAD:main"),
      `Couldn't publish to ${target}`,
    );
    if (copySetting("SHIPIFY_TEMPLATE") !== target)
      ghRun(["variable", "set", "SHIPIFY_TEMPLATE", "-R", copy, "--body", target]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return ok(
    "template",
    `Shipify ${next} is on ${target}: its CI releases v${next} in a few minutes`,
    {
      nextSteps: [`gh run list -R ${target} -w ci -L 1`, `https://github.com/${target}/releases`],
    },
  );
}

/** A version's section of a changelog, without its heading. */
function sectionOf(changelog: string, version: string): string {
  const m = new RegExp(
    `## \\[${version.replaceAll(".", "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`,
  ).exec(changelog);
  return (m?.[1] ?? "").trim();
}

// ---------------------------------------------------------------- update

/** The template this copy follows: its setting, else the one GitHub says it was made from. */
function templateOf(copy: string): string | undefined {
  const set = copySetting("SHIPIFY_TEMPLATE");
  if (set) return set;
  const r = ghRun(["api", `repos/${copy}`, "--jq", ".template_repository.full_name // empty"]);
  return r.stdout.trim() || undefined;
}

/**
 * This copy's update (update.yml, weekly or by hand): the template's newest release, as one PR
 * "Shipify X.Y.Z" with the notes of every version since this copy's. Shipify's own files as the
 * template has them; your files and your forms' apps kept. It merges nothing, and a PR you closed
 * stays closed: that version is skipped.
 */
export function shipUpdate(opts: { yes: boolean }, deps: ReleaseDeps = releaseDeps()): Result {
  const root = deps.root;
  const copy = platformRepo();
  const target = templateOf(copy);
  if (!target)
    return {
      command: "update",
      status: "skipped",
      summary: "this copy follows no template (docs/releases.md)",
    };
  // A private template on another account takes its own read-only key.
  const read = process.env.SHIPIFY_TEMPLATE_TOKEN || undefined;
  const list = ghRun(
    ["api", `repos/${target}/releases?per_page=50`, "--jq", ".[] | [.tag_name, .html_url] | @tsv"],
    read ? { token: read } : {},
  );
  if (list.code !== 0)
    throw new ShipError(
      `Couldn't read ${target}'s releases (${list.stderr.trim().split("\n")[0]}). A private template on another account: its read-only key, pnpm ship setup (updates).`,
      "blocked",
    );
  const releases = list.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string])
    .filter(([tag]) => versionOf(tag));
  const newest = releases[0];
  fetchMain(root);
  const have = versionIn(onMain(root, VERSION_FILE));
  if (!newest)
    return { command: "update", status: "skipped", summary: `${target} has no release yet` };
  const [tag, url] = newest;
  const version = versionOf(tag) as string;
  if (version === have) return ok("update", `up to date: Shipify ${have}, as ${target} has it`);
  const branch = `shipify/update-${version}`;
  const prs = ghRun([
    "pr",
    "list",
    "-R",
    copy,
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "url,state",
    "--jq",
    ".[] | [.state, .url] | @tsv",
  ]).stdout.trim();
  if (prs) {
    const [state, pr] = prs.split("\n")[0]?.split("\t") ?? [];
    return {
      command: "update",
      status: "skipped",
      summary:
        state === "OPEN"
          ? `Shipify ${version}'s PR is open: ${pr}`
          : `you closed Shipify ${version}'s PR (${pr}): this copy stays on ${have} until a newer version`,
    };
  }
  const planned = [
    `take Shipify ${version} from ${target} (${url}): Shipify's own files, as its release has them`,
    "keep yours as they are: your plans, recipes and checks, and the apps your forms list",
    `open one PR on ${copy}, "Shipify ${version}", with the notes of each version since ${have}. It merges nothing: you do, and CI takes it from there`,
  ];
  if (!opts.yes)
    return {
      command: "update",
      status: "requires-approval",
      summary: `would offer Shipify ${version} (this copy has ${have})`,
      plannedActions: planned,
      nextSteps: ["pnpm ship update --yes"],
    };
  const tmp = mkdtempSync(join(tmpdir(), "shipify-update-"));
  const w = worktree(root, join(tmp, "main"));
  try {
    const tree = join(tmp, "tree");
    mkdirSync(tree);
    // The release's own files, read with the template's key.
    if (!deps.download(target, tag, tree, read))
      throw new ShipError(`Couldn't download ${target}'s ${tag}.`);
    // Its files over this copy's, those it no longer has gone; never one of yours.
    const theirs = filesIn(tree).filter((f) => !isYours(f));
    const ours = productFiles(mainFiles(root));
    must(git(w.dir, "checkout", "-q", "-b", branch), `Couldn't start ${branch}`);
    const forms = Object.fromEntries(
      Object.keys(FORM_PROJECTS).map((f) => [f, readFileSync(join(w.dir, FORMS, f), "utf8")]),
    );
    for (const f of theirs) {
      mkdirSync(dirname(join(w.dir, f)), { recursive: true });
      cpSync(join(tree, f), join(w.dir, f));
    }
    const gone = ours.filter((f) => !theirs.includes(f));
    if (gone.length)
      must(git(w.dir, "rm", "-q", "--", ...gone), "Couldn't take out the files it no longer has");
    for (const [file, yours] of Object.entries(forms)) {
      const path = join(w.dir, FORMS, file);
      writeFileSync(path, keptForm(file, readFileSync(path, "utf8"), yours));
    }
    git(w.dir, "add", "-A");
    must(
      git(w.dir, "commit", "-q", "-m", `Shipify ${version}`),
      "Couldn't make the update's commit",
    );
    must(git(w.dir, "push", "-q", "origin", branch), `Couldn't push ${branch}`);
    const since = releases.filter(([t]) => newer(versionOf(t) as string, have));
    const notes = since
      .map(([t]) => {
        const body = ghRun(
          ["api", `repos/${target}/releases/tags/${t}`, "--jq", ".body"],
          read ? { token: read } : {},
        ).stdout.trim();
        return `## ${t}\n\n${body || "(no notes)"}`;
      })
      .join("\n\n");
    const pr = ghRun([
      "pr",
      "create",
      "-R",
      copy,
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `Shipify ${version}`,
      "--body",
      [
        `Shipify ${have} → ${version}, from ${target} (${url}).`,
        "",
        "- **Shipify's own files**, as the release has them. Your plans, recipes and checks, and the apps your forms list, are as they were.",
        "- **Merge it to take it:** CI then releases it here and deploys your edge. Then `pnpm ship setup` and `pnpm ship doctor` name anything a new version asks of you.",
        "",
        notes,
      ].join("\n"),
    ]);
    must(pr, "Couldn't open the PR");
    return ok("update", `Shipify ${version} is offered: ${pr.stdout.trim()}`);
  } finally {
    w.drop();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** a is newer than b (x.y.z). */
function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number)) as [number[], number[]];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
