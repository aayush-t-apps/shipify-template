// Open a docs PR (a plan, or a change doc and its ADRs) without touching the checkout's branch, so
// several agents can share a checkout or work in worktrees. The commit is made in a temporary
// worktree from origin/main; afterwards the files live on their branch and the checkout keeps
// main's version (`git pull` brings them back once the PR is merged). Files given as `contents` are
// written straight into the PR's branch, so the checkout isn't touched at all (`ship connect`).
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./exec.ts";
import { ShipError } from "./output.ts";
import { sourceControl } from "./providers.ts";

function git(cwd: string, ...args: string[]): string {
  const r = run("git", args, { cwd });
  if (r.code !== 0) throw new ShipError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export function submitFiles(opts: {
  /** The checkout the files are in. */
  dir: string;
  /** The files, relative to dir. */
  files: string[];
  /** More files, relative to dir, written on the branch as given: the checkout keeps its own. */
  contents?: Record<string, string>;
  branch: string;
  message: string;
  title: string;
  body: string;
}): string {
  const { dir, files, branch } = opts;
  git(dir, "fetch", "-q", "origin", "main");
  const tmp = mkdtempSync(join(tmpdir(), "ship-submit-"));
  const wt = join(tmp, "wt");
  git(dir, "worktree", "add", "-q", "-b", branch, wt, "origin/main");
  try {
    for (const file of files) {
      mkdirSync(dirname(join(wt, file)), { recursive: true });
      copyFileSync(join(dir, file), join(wt, file));
    }
    for (const [file, text] of Object.entries(opts.contents ?? {})) {
      mkdirSync(dirname(join(wt, file)), { recursive: true });
      writeFileSync(join(wt, file), text);
    }
    git(wt, "add", ...files, ...Object.keys(opts.contents ?? {}));
    git(wt, "commit", "-q", "-m", opts.message);
    git(wt, "push", "-q", "-u", "origin", branch);
    const url = sourceControl().openPullRequest({
      cwd: wt,
      base: "main",
      head: branch,
      title: opts.title,
      body: opts.body,
    });
    // The files now live on their branch; the checkout goes back to main's version of them.
    for (const file of files) {
      if (run("git", ["ls-files", "--error-unmatch", file], { cwd: dir }).code === 0)
        git(dir, "checkout", "--", file);
      else unlinkSync(join(dir, file));
    }
    return url;
  } finally {
    run("git", ["worktree", "remove", "--force", wt], { cwd: dir });
    run("git", ["branch", "-D", branch], { cwd: dir });
    rmSync(tmp, { recursive: true, force: true });
  }
}
