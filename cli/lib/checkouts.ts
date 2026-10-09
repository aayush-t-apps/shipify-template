// Checkouts inside a working tree (ADR 0041): a helper's worktree, or a repo of its own, made beside
// the work by an agent or anyone. Never committed: `git add -A` would record each as a submodule
// with nothing behind it, or stop at one with no commit. One rule wherever work is committed: the
// box's "Work in progress" commit and `ship pr` on this PC, with the same check before any PR.
import { run } from "./exec.ts";

/**
 * `git add -A` that leaves out every checkout git lists among the untracked files (`<path>/`),
 * whatever its name: NUL-separated so no name is quoted, each a literal pathspec so none is a
 * pattern. A shell line with nothing but git, `xargs -0` and `sh`, for the box and this PC alike.
 * It needs git 2.26 or newer (`ship doctor` checks).
 */
export const ADD_ALL_BUT_CHECKOUTS = `{ printf '.\\0'; git ls-files -z -o --exclude-standard | xargs -0 sh -c 'for p do case "$p" in */) printf ":(exclude,literal)%s\\0" "$p" ;; esac; done' sh; } | git add -A --pathspec-from-file=- --pathspec-file-nul`;

/** Whether `git --version`'s line is git 2.26 or newer, which ADD_ALL_BUT_CHECKOUTS needs. */
export function gitTakesPathspecFiles(versionLine: string): boolean {
  const m = /(\d+)\.(\d+)/.exec(versionLine);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 2 || (major === 2 && minor >= 26);
}

/**
 * Checkouts recorded in a tree's commits or staged for the next one (gitlinks) that `.gitmodules`
 * doesn't declare: a submodule the project means is its own business.
 */
export function strayCheckouts(dir: string): string[] {
  const entries = (args: string[]) =>
    run("git", args, { cwd: dir }).stdout.split("\0").filter(Boolean);
  const links = new Set(
    [...entries(["ls-files", "-s", "-z"]), ...entries(["ls-tree", "-r", "-z", "HEAD"])]
      .filter((e) => e.startsWith("160000 "))
      .map((e) => e.slice(e.indexOf("\t") + 1)),
  );
  if (!links.size) return [];
  const declared = entries(["config", "-z", "-f", ".gitmodules", "--get-regexp", "\\.path$"]).map(
    (e) => e.slice(e.indexOf("\n") + 1),
  );
  return [...links].filter((p) => !declared.includes(p));
}
