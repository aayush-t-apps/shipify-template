// A run's workflow change (ADR 0031, ADR 0075): a workflow pushed on a branch can run on that push
// with the repo's keys, so a run's own change to `.github/workflows/` or `.github/actions/` is held:
// apply pushes the rest of the work without it, and lists it for your yes when nothing it changes
// can run before your merge. One helper finds it, for `ship pr --check`, decide and apply alike. A
// project's pipeline as its stack renders it (`ship upgrade`, ADR 0048) isn't a change of the run's.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { renderStack } from "../commands/upgrade.ts";
import { findStack } from "../lib/catalog.ts";
import { loadConfig, PLATFORM_ROOT } from "../lib/config.ts";
import { projectVars } from "../lib/generate.ts";
import { readManifest } from "../lib/manifest.ts";

/** A file a workflow runs: a workflow, or an action one uses. */
export const isWorkflowFile = (f: string) =>
  f.startsWith(".github/workflows/") || f.startsWith(".github/actions/");

/** git in a checkout: its output. */
export type Git = (...args: string[]) => string;

/** The files of these that are exactly what the project's stack renders: none in a repo that isn't
 * a Shipify project. */
export function stackOwn(checkout: string, files: string[]): Set<string> {
  const own = new Set<string>();
  if (!files.length) return own;
  let m: ReturnType<typeof readManifest>;
  try {
    m = readManifest(checkout);
  } catch {
    return own;
  }
  const out = mkdtempSync(join(tmpdir(), "shipify-stack-"));
  try {
    renderStack(
      PLATFORM_ROOT,
      m.stack.id,
      projectVars(loadConfig(), findStack(m.stack.id), m),
      out,
    );
    for (const f of files) {
      const mine = join(checkout, f);
      const theirs = join(out, f);
      if (
        existsSync(mine) &&
        existsSync(theirs) &&
        readFileSync(mine, "utf8") === readFileSync(theirs, "utf8")
      )
        own.add(f);
    }
    return own;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Nothing when every changed workflow file is the stack's own; else what's different, in a line:
 * apply's last check, after the hold, that the push changes no workflow file of the run's. */
export function workflowsMismatch(checkout: string, changed: string[]): string | undefined {
  const files = changed.filter(isWorkflowFile);
  const own = stackOwn(checkout, files);
  const wrong = files.find((f) => existsSync(join(checkout, f)) && !own.has(f));
  return wrong ? `${wrong} would be pushed as the run changed it` : undefined;
}

/**
 * The run's workflow change (ADR 0075 §5.2): each workflow file `head` changes from where it left
 * `base` (the task's branch on GitHub, else main), but the stack's own render. `checkout` holds
 * `head`'s files, for that comparison. A rename is both its files, so the hold puts the old one back.
 */
export function workflowChange(git: Git, checkout: string, base: string, head: string): string[] {
  const files = git(
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--name-only",
    `${base}...${head}`,
    "--",
    ".github/workflows",
    ".github/actions",
  )
    .split("\n")
    .filter(Boolean);
  const own = stackOwn(checkout, files);
  return files.filter((f) => !own.has(f));
}

/** Events GitHub runs from the default branch's copy of a workflow, in words (§5.4). */
const FROM_DEFAULT: Record<string, string> = {
  issues: "an issue",
  issue_comment: "a comment",
  schedule: "a schedule",
  workflow_dispatch: "a start",
  repository_dispatch: "a dispatch",
  workflow_run: "another workflow's run",
};

/**
 * When a workflow runs, from its `on:` (§5.4): the words for each event, when every one runs only
 * from the default branch (`trunk`), after your merge; else why it would run before it.
 */
export function whenItRuns(text: string, trunk = "main"): { words: string[] } | { why: string } {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch {
    return { why: "can't read its `on:`" };
  }
  const o = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  const on = o.on ?? o.true;
  const events: [string, unknown][] =
    typeof on === "string"
      ? [[on, null]]
      : Array.isArray(on)
        ? on.map((e) => [String(e), null])
        : on && typeof on === "object"
          ? Object.entries(on)
          : [];
  if (!events.length) return { why: "can't read its `on:`" };
  const words: string[] = [];
  for (const [event, v] of events) {
    const said = FROM_DEFAULT[event];
    if (said) {
      words.push(said);
      continue;
    }
    if (event === "push") {
      const p = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      const b = p.branches;
      const branches = typeof b === "string" ? [b] : Array.isArray(b) ? b : [];
      const other = ["tags", "tags-ignore", "branches-ignore"].find((k) => k in p);
      if (branches.length === 1 && branches[0] === trunk && !other) {
        words.push(`a push to \`${trunk}\``);
        continue;
      }
      return {
        why: other
          ? `it runs on a push with \`${other}\`, so on a push to this branch too`
          : branches.length
            ? `its \`push\` names more than \`${trunk}\`, so it can run on a push to this branch`
            : "it runs on a push to any branch, so on this branch's own push",
      };
    }
    return {
      why:
        event === "workflow_call"
          ? "it runs on `workflow_call`, inside whichever workflow calls it"
          : event === "pull_request" || event === "pull_request_target"
            ? `it runs on \`${event}\`, before the merge`
            : `it runs on \`${event}\`, which may run from this branch`,
    };
  }
  return { words };
}

/**
 * Why the change would run before your merge (§5.4), or nothing when it can't. `read` gives a
 * file as the change leaves it (nothing: removed, so it runs nothing); `workflows`, every workflow
 * on the branch after it, which an action's change reaches.
 */
export function runsBeforeMerge(
  files: string[],
  read: (f: string) => string | undefined,
  workflows: string[],
  trunk = "main",
): string | undefined {
  for (const f of files.filter((f) => f.startsWith(".github/workflows/"))) {
    const text = read(f);
    if (text === undefined) continue;
    const r = whenItRuns(text, trunk);
    if ("why" in r) return `\`${f}\`: ${r.why}`;
  }
  const action = files.find((f) => f.startsWith(".github/actions/") && read(f) !== undefined);
  if (action)
    for (const w of workflows) {
      const text = read(w);
      const r = text === undefined ? undefined : whenItRuns(text, trunk);
      if (r && "why" in r)
        return `\`${action}\` is an action, and \`${w}\`, which may use it, ${r.why.replace(/^it /, "")}`;
    }
  return undefined;
}

const and = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`;
const names = (xs: string[]) => [...new Set(xs)].map((x) => `\`${x}\``).join(", ");

/**
 * One file's facts on the list (§5.3), the box's own, after its name: the lines added and removed,
 * when it runs, and each secret and action its new lines name. `diff` is its part of the patch.
 */
export function factsOf(
  file: string,
  text: string | undefined,
  diff: string,
  trunk = "main",
): string {
  const lines = diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const runs = text === undefined ? undefined : whenItRuns(text, trunk);
  const when =
    text === undefined
      ? "It's removed."
      : file.startsWith(".github/actions/")
        ? `It's an action: it runs inside the workflows that use it, each only from \`${trunk}\`.`
        : runs && "words" in runs
          ? `It runs only from \`${trunk}\`, after your merge: on ${and([...new Set(runs.words)])}.`
          : "";
  const found = (re: RegExp) =>
    added.flatMap((l) => [...l.matchAll(re)].map((m) => m[1] as string));
  const secrets = found(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g);
  const actions = found(/uses:\s*["']?([^\s"'#]+)/g);
  const uses = [
    secrets.length ? `the secret${new Set(secrets).size > 1 ? "s" : ""} ${names(secrets)}` : "",
    actions.length ? `the action${new Set(actions).size > 1 ? "s" : ""} ${names(actions)}` : "",
  ].filter(Boolean);
  return [
    `(+${added.length} −${removed}).`,
    when,
    uses.length ? `Its new lines use ${uses.join(" and ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The files a run's change holds, and where its branch left its base (§5.2). */
export interface Hold {
  files: string[];
  /** The commit each held file goes back to: the branch on GitHub, else where it left main. */
  at: string;
}

/** The run's workflow change as a hold, in a checkout of `head` (none when it has none). */
export function holdOf(git: Git, checkout: string, base: string, head: string): Hold | undefined {
  const files = workflowChange(git, checkout, base, head);
  if (!files.length) return undefined;
  return { files, at: git("merge-base", base, head).trim() };
}

/** The hold commit's message: its yes pushes the change back. */
export const HOLD_COMMIT = "Hold the workflow change for your yes";

/**
 * The hold (§5.2): each held file put back as `at` has it, or removed when it isn't there, in one
 * commit by `by` on the branch checked out. The run's lines stay in its history, and run nowhere.
 */
export function hold(git: Git, h: Hold, by: { name: string; email: string }) {
  for (const f of h.files) {
    if (git("ls-tree", "--name-only", h.at, "--", f).trim()) git("checkout", h.at, "--", f);
    else git("rm", "-q", "--", f);
  }
  git(
    "-c",
    `user.name=${by.name}`,
    "-c",
    `user.email=${by.email}`,
    "commit",
    "-q",
    "--no-verify",
    "-m",
    HOLD_COMMIT,
  );
}

/** A patch's part for each file it changes, by the file's path. */
export function patchParts(patch: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of patch.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(part);
    if (m?.[2]) parts.set(m[2] === "/dev/null" ? (m[1] as string) : m[2], part.trimEnd());
  }
  return parts;
}
