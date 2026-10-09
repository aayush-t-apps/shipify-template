// `ship tools` (ADR 0015, ADR 0027, docs/tools.md): what tools.json lists (each tool's verbs, calls
// and keys, and any entry that's wrong), and whether each server really offers exactly the calls it
// sorts into look and act. CI runs the check, so a server update can't slip in a tool nobody sorted.

import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import { listServerTools, readTools, sortProblems, verbsOf } from "../lib/tools.ts";

export function toolsList(): Result {
  const { tools, problems } = readTools();
  const rows = Object.entries(tools).map(([name, t]) =>
    [
      `  ${name}: ${t.description}`,
      `    does: ${verbsOf(t).join(", ")}`,
      t.look.length ? `    look: ${t.look.join(", ")}` : "",
      t.act.length ? `    act:  ${t.act.join(", ")}` : "",
      t.in ? `    in:   the door's /door/${t.in.door}` : "",
      `    keys: ${
        Object.values(t.keys)
          .map((k) =>
            Object.entries(k)
              .map(([verb, secret]) => `${secret} (${verb})`)
              .join(", "),
          )
          .join("; ") || "none"
      }`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const broken = problems.map((p) => `  ✗ ${p}`);
  return ok(
    "tools list",
    `${rows.length} tool(s)${problems.length ? `, ${problems.length} problem(s)` : ""}`,
    {
      data: [...rows, ...broken].join("\n") || "  none yet",
    },
  );
}

export async function toolsCheck(): Promise<Result> {
  const { tools, problems } = readTools();
  // A broken entry is left out of every run: here, where it's checked, it fails.
  const checks: Check[] = problems.map((p) => ({
    name: "an entry is right",
    ok: false,
    detail: p,
    fix: "fix the entry (docs/plug-ins.md)",
  }));
  for (const [name, t] of Object.entries(tools)) {
    if (!t.look.length && !t.act.length) {
      checks.push({ name: `${name}: a channel`, ok: true, detail: "no calls for the agent" });
      continue;
    }
    if (!t.run) {
      checks.push({
        name: `${name}: a remote server`,
        ok: true,
        detail: "its calls are listed by hand",
      });
      continue;
    }
    try {
      const offered = await listServerTools(t.run);
      const problems = sortProblems(name, t, offered);
      checks.push({
        name: `${name}: every call is sorted into look or act`,
        ok: !problems.length,
        detail: problems.length ? problems.join("; ") : `${offered.length} calls`,
        fix: "sort each call in tools.json",
      });
    } catch (e) {
      checks.push({ name: `${name}: its server starts`, ok: false, detail: (e as Error).message });
    }
  }
  const bad = checks.filter((c) => !c.ok);
  if (bad.length)
    throw new ShipError(
      `tools.json has problems: ${bad.map((c) => c.detail).join("; ")}`,
      "failed",
    );
  return ok("tools check", `${checks.length} tool(s) match their servers`, { checks });
}
