// What the agent hands back (ADR 0031): result.json, the only thing it writes for the box. It
// proposes; decide keeps what the task's intent allows and drops the rest, saying so. The agent
// never pushes, opens a PR or calls an act tool itself.
import { z } from "zod";
import { MAX_FILES_OUT, ToolCall } from "../contracts/index.ts";
import { planId } from "../lib/plan.ts";
import { limitName } from "../lib/runs.ts";
import { SplitEntry } from "../lib/task.ts";
import type { Stop } from "./types.ts";

export const RESULT_VERSION = 2;

export const Result = z.object({
  v: z.literal(RESULT_VERSION),
  state: z.enum(["done", "needs-you", "failed"]),
  /** The reply, in GitHub markdown: its first paragraph stands alone. */
  text: z.string().min(1),
  question: z.string().optional(),
  /** Up to three short answers to its question, which a chat shows as buttons. */
  choices: z.array(z.string().min(1).max(60)).max(3).optional(),
  /** Files it made, in its out folder: shown or linked on the reply. */
  files: z.array(z.string()).max(MAX_FILES_OUT).optional(),
  /** A scheduled job with nothing to say: the status is updated, nothing posted. */
  quiet: z.boolean().optional(),
  /** Work that belongs to a project (from a talk run): a work run follows, on that project. */
  work: z.object({ project: z.string(), brief: z.string().max(2_000) }).optional(),
  /** The PR it wants: its commits leave as a bundle, and apply pushes and opens it. */
  pr: z
    .object({
      kind: z.enum(["closes", "part-of", "publish"]),
      lane: z.enum(["tweak", "feature", "big"]).optional(),
      title: z.string().min(1).max(200),
      body: z.string().max(20_000),
      preview: z.boolean().optional(),
    })
    .optional(),
  /** A new project's plan id (plans/<id>.plan.md in its commits): its path reads as the id, and a
   * blank one as none. */
  plan: z
    .string()
    .refine((v) => !v.trim() || planId(v), "isn't a plan id (plans/<id>.plan.md)")
    .transform(planId)
    .optional(),
  /** Tool calls it proposes: shown to you exactly, made by the box after your yes. */
  calls: z.array(ToolCall).max(20).optional(),
  /**
   * The task split into parts (ADR 0066): listed for your yes, then opened as sub-tasks, nothing
   * starting. `after`: the entries it waits for, by their place in this list (1 is the first), or
   * the task's parts already there (`#n`).
   */
  split: z.array(SplitEntry).min(2).max(8).optional(),
  /** Notes for the notebook: your own words to keep. */
  notes: z
    .array(z.object({ topic: z.string().max(60), line: z.string().max(500) }))
    .max(5)
    .optional(),
  repeat: z
    .object({
      when: z.string().min(1).max(200),
      kind: z.enum(["reminder", "job", "check"]),
      text: z.string().max(500).optional(),
      check: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/)
        .optional(),
      onChange: z.enum(["reply", "think"]).optional(),
    })
    .optional(),
  /** Whether it read the web or a tool's content (the box checks this against its own log too). */
  read_outside: z.boolean().optional(),
});
export type Result = z.infer<typeof Result>;

/**
 * Why a result can't be used. A slip in its shape (a 61-character choice, a wrong field) names what
 * was wrong (`wrong`) and keeps the agent's words (`text`), so the reply says both: nothing is
 * salvaged, and nothing it said is lost.
 */
export interface Unusable {
  error: string;
  wrong?: string;
  text?: string;
}

/**
 * A field the agent has nothing for, written as `null` (a smaller model does), means the same as
 * leaving it out: it's dropped, in objects at any depth, so one unused field doesn't fail a run. A
 * tool call's `args` are the tool's own, kept as written: there a `null` clears a value.
 */
function withoutNulls(v: unknown, key?: string): unknown {
  if (key === "args") return v;
  if (Array.isArray(v)) return v.map((x) => withoutNulls(x));
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== null)
      .map(([k, x]) => [k, withoutNulls(x, k)]),
  );
}

/**
 * The box's own files in the out folder: its result, its handoff (kept for the next run however a
 * run ends), and what the box writes beside them. Never a file for you, so a reply never shares one,
 * and an answer that names one needs no files key (ADR 0063).
 */
export const BOX_FILES = ["result.json", "handoff.md", "meta.json", "work.bundle"];

/** The result file read, or why it can't be used. */
export function readResult(text: string | undefined): Result | Unusable {
  if (text === undefined) return { error: "the agent stopped without writing its result" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "its result isn't JSON" };
  }
  const r = Result.safeParse(withoutNulls(raw));
  if (r.success) {
    const { files, ...rest } = r.data;
    const yours = files?.filter((f) => !BOX_FILES.includes(f.split("/").pop() ?? ""));
    return yours?.length ? { ...rest, files: yours } : rest;
  }
  const wrong = r.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "it"}: ${i.message}`)
    .join("; ");
  const said = (raw as { text?: unknown } | null)?.text;
  return {
    error: `its result has the wrong shape (${wrong})`,
    wrong,
    ...(typeof said === "string" && said.trim() ? { text: said.trim() } : {}),
  };
}

/** The agent's own words under a Failed reply, in sight: a chat drops what's inside <details>. */
export const saidAs = (text: string | undefined) =>
  text ? `**What the agent said:**\n\n${text}` : "";

/** Why the agent stopped, in words: the work-in-progress commit's, and the reply's. */
export function stopWords(stop: Stop): string {
  switch (stop.why) {
    case "clock":
      return `it ran for ${stop.minutes} minutes`;
    case "plan":
      return `your plan's ${limitName(stop.window)} limit is used up`;
    case "crash":
      return `it crashed (exit ${stop.code})`;
    case "no-answer":
      return "its answer didn't read";
    case "asked":
      return "you said stop";
  }
}
