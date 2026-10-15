// Every command returns a Result. Humans get a readable summary, agents and CI get --json.

export type Status =
  | "succeeded"
  | "failed"
  | "blocked"
  | "skipped"
  | "requires-approval"
  | "unsupported";

export const EXIT_CODES: Record<Status, number> = {
  succeeded: 0,
  skipped: 0,
  failed: 1,
  blocked: 2,
  // A plan shown is a good end, not a failure: pnpm says "failed" for any code but 0. Machines
  // read `status` in the --json output.
  "requires-approval": 0,
  unsupported: 4,
};

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  /** For missing credentials: where it must be configured and what it is for. */
  fix?: string;
  blocking?: boolean;
}

export interface Result<T = unknown> {
  command: string;
  status: Status;
  summary: string;
  data?: T;
  checks?: Check[];
  /** Commands that would run, shown in dry runs and approval requests. */
  plannedActions?: string[];
  nextSteps?: string[];
}

export function ok<T>(command: string, summary: string, extra: Partial<Result<T>> = {}): Result<T> {
  return { command, status: "succeeded", summary, ...extra };
}

export function fail<T>(
  command: string,
  summary: string,
  extra: Partial<Result<T>> = {},
): Result<T> {
  return { command, status: "failed", summary, ...extra };
}

export class ShipError extends Error {
  constructor(
    message: string,
    public status: Status = "failed",
    public checks?: Check[],
  ) {
    super(message);
  }
}

export function render(result: Result, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);
  const lines: string[] = [];
  const mark: Record<Status, string> = {
    succeeded: "✓",
    skipped: "–",
    failed: "✗",
    blocked: "■",
    "requires-approval": "?",
    unsupported: "!",
  };
  lines.push(`${mark[result.status]} ${result.command}: ${result.summary} [${result.status}]`);
  for (const c of result.checks ?? []) {
    lines.push(
      `  ${c.ok ? "✓" : c.blocking === false ? "·" : "✗"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`,
    );
    if (!c.ok && c.fix) lines.push(`      fix: ${c.fix}`);
  }
  if (result.plannedActions?.length) {
    lines.push("  would run:");
    for (const a of result.plannedActions) lines.push(`    $ ${a}`);
  }
  if (result.data !== undefined && typeof result.data === "string") lines.push(result.data);
  if (result.nextSteps?.length) {
    lines.push("  next:");
    for (const s of result.nextSteps) lines.push(`    → ${s}`);
  }
  return lines.join("\n");
}
