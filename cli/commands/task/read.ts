// `ship task read <id>` (ADR 0069 section 8): one message of a task, whole. A long thread's prompt
// gives its older messages as one line each, with their ids; a run reads the ones it needs with
// this. It reads the task the run is on (SHIPIFY_TASK, which the box sets for its agent) with the
// key it holds, as `ship notebook read` does; `--task <n>` names another.
import { withoutLine } from "../../contracts/index.ts";
import { ok, type Result, ShipError } from "../../lib/output.ts";
import { MARK } from "../../lib/task.ts";
import { rec } from "./context.ts";

const USE =
  "Use: task read <id> [--task <n>] (an id from the prompt's list; 0 is the task's own words)";

/** One message of a task, whole: a comment by its id, or (0) the task's own words. */
export function taskRead(id: string | undefined, task = process.env.SHIPIFY_TASK): Result {
  const n = Number(task);
  if (!id || !/^\d+$/.test(id)) throw new ShipError(USE, "blocked");
  if (!Number.isInteger(n) || n <= 0)
    throw new ShipError(`No task here to read: ${USE.slice(5)}`, "blocked");
  const record = rec();
  if (id === "0") {
    const i = record.issue(n);
    return ok("task read", `#${n}: its own words, by ${i.user.login}`, {
      data: `# ${i.title}\n\n${withoutLine(i.body ?? "").trim()}`,
    });
  }
  const c = record.comments(n).find((x) => String(x.id) === id && !x.body.startsWith(MARK));
  if (!c)
    throw new ShipError(
      `#${n} has no message ${id}: take an id from the prompt's list of older messages.`,
      "blocked",
    );
  return ok("task read", `#${n}, message ${id}: ${c.user.login}, ${c.created_at}`, {
    data: withoutLine(c.body).trim(),
  });
}
