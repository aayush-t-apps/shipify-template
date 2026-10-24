// What the watch (in the edge) and the runs on a box agree on, beyond the reply and from lines
// (ADR 0031, "The watch"). Three shapes, each read where it crosses:
//   TaskSeen    what the watch reads from a task's status comment: the run under way, the cursor
//   RecordSeen  what it reads from the status task's record: due times, boxes, apps, what's said
//   Findings    what it saw change, in a door-App comment on the status task the alert run reads
// Each is read leniently: a field that doesn't fit is left out, never the whole thing. Pure.
import { z } from "zod";
import { canonicalJson } from "./json.ts";
import { Problem } from "./problems.ts";

/** A box's or an app's name, as the record keeps it. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const time = z.string().refine((s) => !Number.isNaN(Date.parse(s)));

// ---------------------------------------------------------------- a task's status comment

/** A status comment's first line: `<!-- shipify-task {…} -->`, written by a run. */
export const TASK_MARK = "<!-- shipify-task ";

export const TaskSeen = z.object({
  /** Its version: 2 is this core's; another version's isn't read. */
  v: z.number().int().optional().catch(undefined),
  /** The run under way, by its id: plan writes it first, apply clears it when the run ends. */
  working: z.number().int().positive().optional().catch(undefined),
  /** The newest comment the last plan read: what came after it is still to answer. */
  cursor: z.object({ id: z.number().int().nonnegative(), at: time }).optional().catch(undefined),
  /** What its runs think with (a `use` line kept): none is Auto. */
  use: z
    .object({
      agent: z.string().max(40).optional(),
      model: z.string().max(80).optional(),
      effort: z.string().max(20).optional(),
    })
    .optional()
    .catch(undefined),
});
export type TaskSeen = z.infer<typeof TaskSeen>;

/** What a status comment says for the watch, or undefined when it isn't one. */
export function readTaskSeen(body: string | null | undefined): TaskSeen | undefined {
  const m = /^<!-- shipify-task (\{[^\n]*\}) -->/.exec(body ?? "");
  if (!m?.[1]) return undefined;
  try {
    const r = TaskSeen.safeParse(JSON.parse(m[1]));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- the status task's record

/** The record's first line on the status task: `<!-- shipify-status {…} -->`. */
export const STATUS_MARK = "<!-- shipify-status ";

/** An app the watch looks at: its public address (its /health), and whether it's down on purpose. */
export const AppSeen = z.object({
  id: z.string().regex(NAME),
  url: z.string().url(),
  /** Taken down (`SHIPIFY_DOWN`): not looked at. */
  paused: z.boolean().default(false),
  /** Since when the watch has reported it failing (the alert run writes it). */
  failing: time.optional().catch(undefined),
});
export type AppSeen = z.infer<typeof AppSeen>;

const lenientList = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) =>
      xs.flatMap((x) => {
        const r = item.safeParse(x);
        return r.success ? [r.data as z.infer<T>] : [];
      }),
    );

const lenientMap = <T extends z.ZodType>(item: T) =>
  z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((o) =>
      Object.fromEntries(
        Object.entries(o).flatMap(([k, v]) => {
          const r = item.safeParse(v);
          return NAME.test(k) && r.success ? [[k, r.data as z.infer<T>]] : [];
        }),
      ),
    );

export const BoxSeen = z.object({
  /** Since when the watch has reported it offline. */
  offline: time.optional().catch(undefined),
  /** When its health was last read, on the box. */
  at: time.optional().catch(undefined),
  /** What needs a look, from its health. */
  facts: lenientList(z.object({ name: z.string(), look: z.string().max(200).optional() })),
  /** Its runner's version, from its health ("2.329.0"). */
  runner: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional()
    .catch(undefined),
});

/** A repo as a task names it (ADR 0047): its own name on Shipify's account, else `owner/name`. */
export const REPO_NAME = /^(?:[A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/;
/** The most repos the record keeps. */
export const MOST_REPOS = 300;

/**
 * Shipify's own account's repos (ADR 0047), as a task names them, and when the due run read them:
 * one list, from the read the apps come from. `projects` are the ones Shipify built (a
 * shipify.json); the others keep their own rules.
 */
export const ReposSeen = z.object({
  at: time.optional().catch(undefined),
  names: lenientList(z.string().regex(REPO_NAME)).transform((xs) => xs.slice(0, MOST_REPOS)),
  projects: lenientList(z.string().regex(REPO_NAME)).transform((xs) => xs.slice(0, MOST_REPOS)),
});
export type ReposSeen = z.infer<typeof ReposSeen>;

/** A recipe as the record keeps it (ADR 0032): its file's name, its task, and its next time. */
export const RecipeInRecord = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  task: z.number().int().positive().optional().catch(undefined),
  every: z.string().max(120).optional().catch(undefined),
  next: time.optional().catch(undefined),
  paused: z.boolean().optional().catch(undefined),
});

export const RecordSeen = z.object({
  v: z.literal(2),
  watch: z
    .object({
      /** When the soonest repeat is due. */
      next: time.optional().catch(undefined),
      /** When the last due run finished. */
      last: time.optional().catch(undefined),
    })
    .catch({}),
  boxes: lenientMap(BoxSeen),
  /** The apps to look at (the due run writes them). Anything but a list reads as none. */
  apps: lenientList(AppSeen),
  /** Each chat channel the watch reported failing: since when. */
  channels: lenientMap(z.object({ failing: time })),
  /** The keys of notes already said (Findings.notes), so each is said once. */
  alerted: lenientList(z.string().max(120)),
  /** What's coming up: repeats and quiet closes, soonest first (the status page shows them). */
  upcoming: lenientList(
    z.object({
      n: z.number().int().positive(),
      title: z.string().max(300),
      next: time,
      every: z.string().max(120).optional().catch(undefined),
    }),
  ),
  /** What happened lately, newest first (the status page shows the last few). */
  events: lenientList(z.object({ at: time, text: z.string().max(500) })),
  /** The recipes on main and their tasks (the due run writes them). */
  recipes: lenientList(RecipeInRecord),
  /** Shipify's own account's repos (ADR 0047): for /repos and the web chat's starters. */
  repos: ReposSeen.catch({ names: [], projects: [] }).default({ names: [], projects: [] }),
});
export type RecordSeen = z.infer<typeof RecordSeen>;

/** The record in a status task's body, or undefined when there's none in this version. */
export function readRecordSeen(body: string | null | undefined): RecordSeen | undefined {
  const b = body ?? "";
  if (!b.startsWith(STATUS_MARK)) return undefined;
  try {
    const r = RecordSeen.safeParse(JSON.parse(b.slice(STATUS_MARK.length, b.indexOf(" -->"))));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** An issue labelled shipify-status, as a list of issues gives it. */
export interface StatusCandidate {
  number: number;
  state?: string;
  body?: string | null;
  pull_request?: unknown;
}

/** Whether an issue holds the record, so a lookup of open ones is enough. */
export const holdsRecord = (i: StatusCandidate | undefined) =>
  Boolean(i && (i.body ?? "").startsWith(STATUS_MARK));

/**
 * The status task, one rule for the door and the runs (docs/watch.md): an open one first, the one
 * that holds the record, then the oldest, so a stray new one never takes over. With none open,
 * the newest closed one that holds the record: the last one in use.
 */
export function pickStatusIssue<T extends StatusCandidate>(list: T[]): T | undefined {
  const closed = (i: T) => i.state === "closed";
  const rank = (i: T) => (closed(i) ? 2 : 0) + (holdsRecord(i) ? 0 : 1);
  return list
    .filter((i) => !i.pull_request)
    .sort(
      (a, b) => rank(a) - rank(b) || (closed(a) ? b.number - a.number : a.number - b.number),
    )[0];
}

// ---------------------------------------------------------------- findings

/** What the watch saw change, for the alert run. Boxes, apps and channels are changes from the record. */
export const Findings = z.object({
  v: z.literal(1),
  boxes: z.record(z.string(), z.enum(["offline", "online", "gone"])).default({}),
  apps: z.record(z.string(), z.enum(["failing", "fine", "paused", "gone"])).default({}),
  channels: z
    .record(
      z.string(),
      z.union([
        z.object({ state: z.literal("failing"), error: z.string().max(200) }),
        z.object({ state: z.literal("fine") }),
      ]),
    )
    .default({}),
  /** Things said once, each by a key the alert run keeps in the record's `alerted`. */
  notes: z
    .array(z.object({ key: z.string().min(1).max(120), problem: Problem }))
    .max(20)
    .default([]),
});
export type Findings = z.infer<typeof Findings>;

const FINDINGS = /^<!-- shipify-findings (\{[^\n]*\}) -->/;

/** The first line of a door-App comment carrying findings; the words people read follow it. */
export const findingsLine = (f: Findings) =>
  `<!-- shipify-findings ${canonicalJson(Findings.parse(f))} -->`;

/** The findings in a comment's body (the caller checks it's the door App's), when good. */
export function readFindings(body: string | null | undefined): Findings | undefined {
  const m = FINDINGS.exec(body ?? "");
  if (!m?.[1]) return undefined;
  try {
    const r = Findings.safeParse(JSON.parse(m[1]));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** Nothing to say. */
export const noFindings = (f: Findings) =>
  !Object.keys(f.boxes).length &&
  !Object.keys(f.apps).length &&
  !Object.keys(f.channels).length &&
  !f.notes.length;
