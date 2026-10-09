// A push that touches a project's workflow files (ADR 0031): allowed only when each one is exactly
// what the project's stack renders, as `ship upgrade` and `ship build` write it. Anything else is
// refused, because a workflow pushed on a branch can run on that push with the project's keys. Its
// own pipeline is one of them (ADR 0048), and so are its actions (`.github/actions/`), which that
// pipeline runs in the jobs that hold the keys.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStack } from "../commands/upgrade.ts";
import { findStack } from "../lib/catalog.ts";
import { loadConfig, PLATFORM_ROOT } from "../lib/config.ts";
import { projectVars } from "../lib/generate.ts";
import { readManifest } from "../lib/manifest.ts";

/** Nothing when every changed workflow file is the stack's own; else what's different, in a line. */
export function workflowsMismatch(checkout: string, changed: string[]): string | undefined {
  const files = changed.filter(
    (f) => f.startsWith(".github/workflows/") || f.startsWith(".github/actions/"),
  );
  if (!files.length) return undefined;
  let m: ReturnType<typeof readManifest>;
  try {
    m = readManifest(checkout);
  } catch {
    // A repo that keeps its own rules (ADR 0044): its CI is the owner's to change, never a run's.
    return `${files[0]} is in a repo that isn't a Shipify project, whose workflow files only you change`;
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
      if (!existsSync(mine)) continue;
      if (!existsSync(theirs) || readFileSync(mine, "utf8") !== readFileSync(theirs, "utf8"))
        return `${f} isn't what the ${m.stack.id} stack renders: a project's workflow files change only through \`ship upgrade\``;
    }
    return undefined;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
