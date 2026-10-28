// Releases and updates (ADR 0047, docs/releases.md). Shipify is built in your copy; a release puts
// its own files on the template, one clean commit per version, and every other copy takes it as one
// PR. One direction only: your copy, then the template, then the copies.
//   ship template [<owner/repo>] [--bump minor|major] [--yes]   release: check, version, record, publish
//   ship update [--yes]                                         this copy: the template's newest, as a PR
// On GitHub, `shipify: release` (or `release minor`, `release major`) runs the first (the github
// job, with the bot's keys), and update.yml the second, weekly.
import {
  cpSync,
  type Dirent,
  existsSync,
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
import { setCredential } from "../lib/credentials.ts";
import { type Bump, bumpVersion, releaseChangelog, unreleased } from "../lib/docs.ts";
import { run } from "../lib/exec.ts";
import { FORM_PROJECTS, FORMS_DIR } from "../lib/forms.ts";
import { ghRun, platformRepo } from "../lib/github.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { canScan, secretFindings } from "../lib/secret-scan.ts";
import {
  checkFailures,
  isYours,
  keptForm,
  privateWords,
  productFiles,
  REPO,
  released,
  replaceWords,
  templateForm,
  templateIn,
  unpublishable,
  versionOf,
} from "../lib/template.ts";
import { newer } from "../lib/versions.ts";

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

/** A worktree of main as GitHub has it, in `dir`, detached: removed by `remove`. */
function worktree(root: string, dir: string): { dir: string; remove: () => void } {
  must(
    git(root, "worktree", "add", "-q", "--detach", dir, MAIN),
    "Couldn't make a worktree of main",
  );
  return { dir, remove: () => void git(root, "worktree", "remove", "--force", dir) };
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
  /**
   * The full check on the files to publish, in their folder: as the template's CI runs it. What
   * failed, a line each (checkFailures); [] when it passed.
   */
  check: (dir: string) => string[];
  /** A release's files, unpacked into `into`, read with the template's key. */
  download: (repo: string, tag: string, into: string, token?: string) => boolean;
  /** The secret scan on the files to publish: what it found, each `file:line (rule)`; [] clean. */
  scan: (dir: string) => string[];
}

export const releaseDeps = (): ReleaseDeps => ({
  root: PLATFORM_ROOT,
  remote: (repo) => `https://github.com/${repo}.git`,
  check: (dir) => {
    // Each step shown as it runs, and kept beside the folder: a reply in a chat names what
    // failed, since the log isn't in view there.
    const log = join(dir, "..", "check.log");
    const step = (args: string[]) =>
      run("bash", ["-o", "pipefail", "-c", '"$@" 2>&1 | tee -a "$CHECK_LOG"', "check", ...args], {
        cwd: dir,
        show: true,
        env: { CHECK_LOG: log },
      }).code;
    const code =
      step(["pnpm", "install", "--frozen-lockfile", "--prefer-offline"]) ||
      step(["pnpm", "verify"]);
    if (code === 0) return [];
    const said = checkFailures(existsSync(log) ? readFileSync(log, "utf8") : "");
    return said.length ? said : [`exit code ${code}`];
  },
  download: (repo, tag, into, token) => {
    const tgz = join(into, "..", "release.tgz");
    const got = run("sh", ["-c", `gh api "repos/${repo}/tarball/${tag}" > "${tgz}"`], {
      ...(token ? { env: { GH_TOKEN: token } } : {}),
    });
    return (
      got.code === 0 && run("tar", ["-xzf", tgz, "-C", into, "--strip-components=1"]).code === 0
    );
  },
  scan: (dir) => {
    if (!canScan()) return ["the secret scan (gitleaks) can't run on this machine"];
    const found = secretFindings(dir);
    return found === undefined ? [] : found.length ? found : ["something that looks like a key"];
  },
});

/**
 * The template this copy names (SHIPIFY_TEMPLATE): a run's variables or this PC's copy of it, else
 * the variable on the copy itself (a PC reads its copy's variables only through gh).
 */
function namedTemplate(copy: string): string | undefined {
  const set = copySetting("SHIPIFY_TEMPLATE");
  if (set) return set;
  const r = ghRun(["variable", "get", "SHIPIFY_TEMPLATE", "-R", copy]);
  return r.code === 0 ? r.stdout.trim() || undefined : undefined;
}

/** Your words never published (SHIPIFY_PRIVATE_WORDS), as namedTemplate reads its setting. */
function wordsOf(copy: string): Record<string, string> {
  const set =
    copySetting("SHIPIFY_PRIVATE_WORDS") ||
    (() => {
      const r = ghRun(["variable", "get", "SHIPIFY_PRIVATE_WORDS", "-R", copy]);
      return r.code === 0 ? r.stdout.trim() : "";
    })();
  const words = privateWords(set);
  if ("problem" in words)
    throw new ShipError(`${words.problem as string} (docs/settings.md).`, "blocked");
  return words as Record<string, string>;
}

/**
 * The files to publish made safe to publish (ADR 0055): your words replaced by their stand-ins,
 * then every file checked for one left, a tailnet's name, or anything the secret scan calls a key.
 * What's found stops the release, named by file.
 */
function cleanForPublishing(tree: string, words: Record<string, string>, deps: ReleaseDeps) {
  const found: string[] = [];
  for (const f of filesIn(tree)) {
    const path = join(tree, f);
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    const out = replaceWords(text, words);
    if (out !== text) writeFileSync(path, out);
    const why = unpublishable(out, words);
    if (why) found.push(`${f}: ${why}`);
  }
  found.push(...deps.scan(tree));
  if (found.length)
    throw new ShipError(
      `Not published: ${found.slice(0, 10).join("; ")}${found.length > 10 ? `; and ${found.length - 10} more` : ""}. Add a word to SHIPIFY_PRIVATE_WORDS, or fix it here in a PR, then release again.`,
      "blocked",
    );
}

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
  const named = namedTemplate(copy);
  const target = opts.repo ?? named;
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
  const words = wordsOf(copy);
  const record = next !== current || Boolean(pending);
  const planned = [
    exists
      ? `publish to ${target}, which has ${published ? `Shipify ${published}` : "nothing yet"}`
      : `make ${target}: private, marked as a template (its "Use this template"), empty`,
    `Shipify ${next}: ${pending ? "CHANGELOG.md's Unreleased becomes its notes" : "its notes as CHANGELOG.md has them"} (below)`,
    `its files: Shipify's own, ${files.length} of this copy's ${tracked.length}. Never your plans, recipes or checks; the forms' app lists empty`,
    `make them safe to publish: ${Object.keys(words).length ? `your ${Object.keys(words).length} private word(s) replaced (SHIPIFY_PRIVATE_WORDS), then ` : ""}checked for your words, a tailnet's name and keys (the secret scan). Nothing is published if anything is found`,
    "check them first in a folder of their own, as the template's CI will: its install, then its full check. Nothing is published or recorded if that fails",
    ...(record
      ? [
          `record ${next} on ${copy}'s main: its version (and the template's name) and CHANGELOG.md, one commit "Shipify ${next}" (its CI tags it)`,
        ]
      : []),
    `one commit on ${target}'s main, "Shipify ${next}": its CI releases v${next}, and every copy that follows it gets an update PR`,
    ...(named === target
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
        `pnpm ship template${opts.repo ? ` ${target}` : ""}${opts.bump && opts.bump !== "patch" ? ` --bump ${opts.bump}` : ""} --yes`,
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
    const newPkg = released(pkgText, next, target);
    writeFileSync(join(tree, "CHANGELOG.md"), newLog);
    writeFileSync(join(tree, VERSION_FILE), newPkg);
    cleanForPublishing(tree, words, deps);
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
    // What failed goes on the lines after the first: a reply shows them as its details.
    const failed = deps.check(tree);
    if (failed.length)
      throw new ShipError(
        `The check failed on the files to publish: nothing was published or recorded. Fix it here in a PR, then release again.\n${failed.join("\n")}`,
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
        w.remove();
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
    // Named on the copy, and kept on this PC as its other settings are.
    if (named !== target)
      ghRun(["variable", "set", "SHIPIFY_TEMPLATE", "-R", copy, "--body", target]);
    if (!opts.inJob) setCredential("SHIPIFY_TEMPLATE", target);
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

/**
 * The template this copy follows: its setting (an override), else the one its version file names
 * on main (a release writes it), else the one GitHub says it was made from (hidden from a bot's
 * key scoped to this copy, when the template is private).
 */
function templateOf(copy: string, versionFile: string): string | undefined {
  const set = namedTemplate(copy) || templateIn(versionFile);
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
  fetchMain(root);
  const mine = onMain(root, VERSION_FILE);
  const target = templateOf(copy, mine);
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
      `Couldn't read ${target}'s releases (${list.stderr.trim().split("\n")[0]}). A private template on another account: its read-only key, pnpm ship setup updates (expired or wrong: pnpm ship setup updates --new).`,
      "blocked",
    );
  const releases = list.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string])
    .filter(([tag]) => versionOf(tag));
  const newest = releases[0];
  const have = versionIn(mine);
  if (!newest)
    return { command: "update", status: "skipped", summary: `${target} has no release yet` };
  const [tag, url] = newest;
  const version = versionOf(tag) as string;
  // Never an older one: where Shipify is built, a release is here before the template's CI.
  if (!newer(version, have))
    return ok(
      "update",
      version === have
        ? `up to date: Shipify ${have}, as ${target} has it`
        : `up to date: Shipify ${have}, newer than ${target}'s ${version}`,
    );
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
    `take Shipify ${version} from ${target} (${url}): Shipify's own files, as its release has them; those it took out since ${have} go`,
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
    // Its files over this copy's, never one of yours. Gone: only what the template itself took
    // out since this copy's version (a plug-in added here stays), so read that release too.
    const theirs = filesIn(tree).filter((f) => !isYours(f));
    const ours = productFiles(mainFiles(root));
    const was = releases.find(([t]) => versionOf(t) === have)?.[0];
    const before = join(tmp, "before");
    mkdirSync(before);
    if (was && !deps.download(target, was, before, read))
      throw new ShipError(`Couldn't download ${target}'s ${was}.`);
    must(git(w.dir, "checkout", "-q", "-b", branch), `Couldn't start ${branch}`);
    const forms = Object.fromEntries(
      Object.keys(FORM_PROJECTS).map((f) => [f, readFileSync(join(w.dir, FORMS, f), "utf8")]),
    );
    for (const f of theirs) {
      mkdirSync(dirname(join(w.dir, f)), { recursive: true });
      cpSync(join(tree, f), join(w.dir, f));
    }
    const gone = filesIn(before).filter((f) => ours.includes(f) && !theirs.includes(f));
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
        ...(was
          ? []
          : [
              `- **Nothing taken out:** ${target} has no release of ${have}, so files ${version} no longer has stay here. Remove any you don't need.`,
            ]),
        "- **Merge it to take it:** CI then releases it here and deploys your edge. Then `pnpm ship setup` and `pnpm ship doctor` name anything a new version asks of you.",
        "",
        notes,
      ].join("\n"),
    ]);
    must(pr, "Couldn't open the PR");
    return ok("update", `Shipify ${version} is offered: ${pr.stdout.trim()}`);
  } finally {
    w.remove();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** a is newer than b (x.y.z). */
