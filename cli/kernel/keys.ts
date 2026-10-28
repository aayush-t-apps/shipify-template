// Keys that make a run safe to repeat (ADR 0031): a reply is written once and sent once, a call
// is made once. A reply's key names the task, the cursor, the body's hash, the step and the
// occasion (a repeat's due time, a deploy's sha, a restart), so two reminders never collide.
import { createHash } from "node:crypto";
import { canonicalJson } from "../contracts/index.ts";

export const hash8 = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

export function replyKey(k: {
  task: number;
  cursor: number;
  body: string;
  step: string;
  occasion?: string;
}): string {
  return [k.task, k.cursor, hash8(k.body), k.step, k.occasion ?? "-"].join(":");
}

/** The same calls always have the same fingerprint, whatever the order of their arguments. */
export const fingerprint = (calls: unknown[]) =>
  createHash("sha256").update(canonicalJson(calls)).digest("hex").slice(0, 16);

/** A list's code (ADR 0049): all it lists, its calls, its notes and a split's parts (ADR 0066),
 * which its Yes names. */
export const listCode = (calls: unknown[] = [], notes: unknown[] = [], split: unknown[] = []) =>
  fingerprint(split.length ? [calls, notes, split] : [calls, notes]).slice(0, 8);
