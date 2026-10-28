// Tasks (ADR 0012, docs/tasks.md): an issue in shipify is a task. Everything about a task lives on
// GitHub: open or closed, one state label, and the bot's status comment, whose first line records
// the task's facts in a hidden JSON line. These are the pure parts: titles, state, the status
// comment, the agent's prompt and its result. commands/task.ts does the GitHub and git work.
import { z } from "zod";
import { NEEDS_YOU_LABEL, Problem, ToolCall } from "../contracts/index.ts";
import { type Form, type FormRead, readForm } from "./form-reader.ts";
import { RECORD_WRITER } from "./github.ts";
import { intentOfWord } from "./intents.ts";
import { planId } from "./plan.ts";
import { formatWhen, RepeatState, whenProblem } from "./repeat.ts";
import { RunDetails, RunRow, renderRuns } from "./runs.ts";

export const PLAYGROUND = "playground";
/** Shipify itself, as a task's project: its own repo, the platform (`shipify: …`). */
export const PLATFORM = "shipify";

export const TASK_LABELS = {
  working: { name: "working", color: "2f5bd3", description: "A box is running this task" },
  "needs-you": {
    name: NEEDS_YOU_LABEL,
    color: "d4a72c",
    description: "A PR or a question is waiting for the owner",
  },
  failed: { name: "failed", color: "cf222e", description: "The last run failed: comment to retry" },
  answered: {
    name: "answered",
    color: "1a7f37",
    description: "Answered: comment to carry on; it closes by itself after a quiet day",
  },
} as const;
export type LabelKey = keyof typeof TASK_LABELS;

/** A close that drops the task, its open PRs closed with it: GitHub's "not planned" or "duplicate". */
export const droppedBy = (reason?: string | null) =>
  reason === "not_planned" || reason === "duplicate";

export const PHASES = [
  "waiting",
  "working",
  "needs-you",
  "failed",
  "answered",
  "done",
  "dropped",
  "repeating",
] as const;
export type Phase = (typeof PHASES)[number];
export const LANES = ["tweak", "feature", "big"] as const;

export const OPS = ["release", "down", "up", "rollback"] as const;
export type Op = (typeof OPS)[number];
/**
 * The operations that change the live app at once, with no merge: they start only on GitHub, where
 * your GitHub sign-in says it's you (ADR 0049). A release opens a PR that only your merge deploys,
 * so it starts from any chat.
 */
export const AT_ONCE: readonly Op[] = ["down", "up", "rollback"];

export interface TaskTitle {
  kind: "app" | "new" | "question" | "remember" | "forget" | "op" | "none";
  project?: string;
  ask: string;
  /** kind "remember": the notebook page it goes on (Preferences when none is given). */
  topic?: string;
  /** kind "op": run by the box itself, no agent. */
  op?: Op;
  /** kind "op", rollback: the release to go back to. */
  version?: string;
  /** kind "op", Shipify's release: its minor or major version (patch when none). */
  bump?: "minor" | "major";
}

/** A repo's owner and name as GitHub allows them; a name is never `.` or `..`. */
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const NAME = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

/**
 * One word as a repo (ADR 0044): `owner/name`, a github.com link's owner/name, or a plain name
 * (a project's id or one of your repos', which only the task's repos list can say). Undefined for
 * anything else, so nothing that isn't a name ever reaches git.
 */
export function repoWord(word: string): string | undefined {
  const w = word.replace(/^[(`'"]+/, "").replace(/[`'")\].,;:!?]+$/, "");
  const link = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(w);
  const parts = link ? [link[1] ?? "", link[2] ?? ""] : w.split("/");
  const strip = (n: string) => n.replace(/\.git$/, "");
  if (parts.length === 2) {
    const [owner, name] = [parts[0] ?? "", strip(parts[1] ?? "")];
    return OWNER.test(owner) && NAME.test(name) ? `${owner}/${name}` : undefined;
  }
  if (parts.length === 1 && NAME.test(w) && /^[A-Za-z0-9]/.test(w)) return w;
  return undefined;
}

/**
 * The repos a task's words name with `look at` (ADR 0044), in order, each once: the names after it,
 * joined by commas or `and` ("look at acme-site, notes-app and acme/api"). Which plain names are repos is
 * the task's repos list's to say; anything that isn't a name ends the list.
 */
export function looksAt(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\blook at\s+/gi)) {
    const words = text.slice((m.index ?? 0) + m[0].length).split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const raw = words[i] ?? "";
      const ref = repoWord(raw);
      if (!ref) break;
      if (!out.includes(ref)) out.push(ref);
      // On to the next name only after a comma, or an `and`.
      if (raw.endsWith(",")) continue;
      if (/^and$/i.test(words[i + 1] ?? "")) {
        i++;
        continue;
      }
      break;
    }
  }
  return out;
}

/**
 * The title's first word, as intents.json names it (ADR 0031): `acme-site: bigger margins` ·
 * `new: a tip calculator` · `ask: …` · `remember: short answers` · `remember People: Ana designs` ·
 * `forget: short answers` ·
 * `acme-site: release`. Anything else is a question.
 */
export function parseTitle(title: string): TaskTitle {
  const t = title.trim();
  // A note for the notebook, which the box writes with no agent. The words before the colon name
  // its page; with none, it's Preferences. Just "remember" takes the note from the text.
  if (/^remember$/i.test(t)) return { kind: "remember", ask: "" };
  // A recipe's task (ADR 0032): its file says what it does, never a project's name.
  if (/^Recipe: [a-z0-9][a-z0-9-]*$/.test(t)) return { kind: "none", ask: t };
  // `forget: …` takes one note off your pages, by its words, with no agent either.
  const gone = /^forget\s*:\s*(.*)$/is.exec(t);
  if (gone || /^forget$/i.test(t)) return { kind: "forget", ask: (gone?.[1] ?? "").trim() };
  const note = /^remember(?:\s+([^:]+?))?\s*:\s*(.*)$/is.exec(t);
  if (note)
    return {
      kind: "remember",
      ask: (note[2] ?? "").trim(),
      ...(note[1] ? { topic: note[1].trim() } : {}),
    };
  // A repo on any account by its owner/name (ADR 0045), its name with dots too: a change on it.
  const full = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\s*:\s*(.+)$/.exec(t);
  if (full?.[1] && full[2] && full[3] && repoWord(`${full[1]}/${full[2]}`))
    return { kind: "app", project: `${full[1]}/${full[2]}`.toLowerCase(), ask: full[3].trim() };
  const m = /^([a-z0-9][a-z0-9-]*)\s*:\s*(.+)$/i.exec(t);
  if (!m?.[1] || !m[2]) return { kind: "none", ask: t };
  const name = m[1].toLowerCase();
  const ask = m[2].trim();
  const intent = intentOfWord(name);
  if (intent === "new") return { kind: "new", ask };
  if (intent === "question") return { kind: "question", ask };
  // A `repeat: …` title: the ask says what, and the agent works out the rest.
  if (intent === "repeat") return { kind: "none", ask };
  const release = /^release(?:\s+(minor|major))?$/i.exec(ask);
  if (release) {
    const bump = release[1]?.toLowerCase() as TaskTitle["bump"];
    return { kind: "op", project: name, ask, op: "release", ...(bump ? { bump } : {}) };
  }
  // The Operate form's own words, typed anywhere (one flow, ADR 0049): `spotter: take it down`.
  const action = ACTIONS[ask.toLowerCase().replace(/[.!]+$/, "")];
  if (action) return { kind: "op", project: name, ask, op: action };
  return { kind: "app", project: name, ask };
}

const ACTIONS: Record<string, Op> = {
  "release to production": "release",
  "take it down": "down",
  "bring it back": "up",
  "roll back production": "rollback",
};

/**
 * A task from its form (.github/ISSUE_TEMPLATE): the Operate form's Project and Action say what it
 * does, and the title is just a name for it. Without one, the title's first word decides.
 */
export function parseTask(title: string, body: string | null, forms: Form[]): TaskTitle {
  const a = readForm(body, forms)?.answers ?? {};
  const text = (id: string) => (typeof a[id] === "string" ? (a[id] as string) : undefined);
  const project = text("project")?.trim().split(/\s+/)[0]?.toLowerCase();
  const op = ACTIONS[(text("action") ?? "").toLowerCase()];
  if (!project || !op) return parseTitle(title);
  const version = text("version");
  return {
    kind: "op",
    project,
    ask: title.trim(),
    op,
    version: version && RELEASE.test(version) ? version : undefined,
  };
}

const RELEASE = /^v\d+\.\d+\.\d+$/;

/**
 * A task's form and everything wrong with it: the template's own rules (required, the dropdowns'
 * choices), then what each kind needs (a schedule the Repeat form can read, a rollback's release).
 * IssueOps: checked before a form's first run, and again on every edit.
 */
export function taskForm(body: string | null, forms: Form[]): FormRead | undefined {
  const read = readForm(body, forms);
  if (!read) return undefined;
  const a = read.answers;
  const when = typeof a.when === "string" ? a.when : undefined;
  const kind = String(a.kind ?? "");
  const wrong =
    read.form.id === "repeat" && when
      ? whenProblem(
          when,
          /reminder/i.test(kind) ? "reminder" : /check/i.test(kind) ? "check" : "agent",
        )
      : undefined;
  if (wrong) read.problems.push(`“When”: ${wrong}`);
  const version = typeof a.version === "string" ? a.version : undefined;
  if (
    ACTIONS[String(a.action ?? "").toLowerCase()] === "rollback" &&
    version &&
    !RELEASE.test(version)
  )
    read.problems.push(
      `“Version” says “${version}”: a release looks like v1.0.3. Leave it empty for the release before the current one.`,
    );
  return read;
}

/** The Repeat form's answers. */
export function repeatForm(
  read: FormRead | undefined,
):
  | { what: string; when: string; kind: "reminder" | "agent" | "check"; check?: string }
  | undefined {
  if (read?.form.id !== "repeat") return undefined;
  const { what, when, kind, check } = read.answers;
  if (typeof what !== "string" || typeof when !== "string" || typeof kind !== "string")
    return undefined;
  const k = /reminder/i.test(kind) ? "reminder" : /check/i.test(kind) ? "check" : "agent";
  return {
    what,
    when,
    kind: k,
    ...(typeof check === "string" && check.trim() ? { check: check.trim() } : {}),
  };
}

/**
 * One part of a split, as a run proposes it (ADR 0066): its title (naming its repo, as any task's
 * does), its brief, and what it waits for: the entries before it by their place (1 is the first),
 * or the task's parts already there (`#n`).
 */
export const SplitEntry = z.object({
  title: z.string().min(1).max(200),
  brief: z.string().min(1).max(600),
  after: z
    .array(z.union([z.number().int().min(1).max(8), z.string().regex(/^#\d+$/)]))
    .max(8)
    .optional(),
});
export type SplitEntry = z.infer<typeof SplitEntry>;

/** A task's state, version 2 (ADR 0031): facts, not a phase machine. A state of another version isn't read. */
export const TaskState = z.object({
  v: z.literal(2),
  phase: z.enum(PHASES),
  project: z.string().optional(),
  lane: z.enum(LANES).optional(),
  branch: z.string().optional(),
  /** Every PR this task opened, newest last. */
  prs: z.array(z.string()).default([]),
  /** Each PR's kind and its state when last looked at, so every status update lists them all. */
  prInfo: z
    .record(
      z.string(),
      z.object({
        kind: z.enum(["code", "plan", "change", "release"]),
        state: z.enum(["open", "merged", "closed"]),
      }),
    )
    .optional(),
  /** New projects: the plan id, so merging the plan starts the build. A path stored before reads
   * as its id (#587). */
  plan: z
    .string()
    .transform((v) => planId(v) ?? v)
    .optional(),
  /** The agent, model and effort its runs think with (ADR 0025): set by the form's Model field, a
   * blank issue's first line, or a `use` comment. None means the default agent's Auto. */
  use: z
    .object({
      agent: z.string(),
      model: z.string().optional(),
      effort: z.string().optional(),
      label: z.string(),
    })
    .optional(),
  /** The last run's handoff: what it did and where, so the next run doesn't start from zero. */
  notes: z.string().optional(),
  /** The owner asked for a live preview link (a "preview" comment, or the form's box). */
  preview: z.boolean().optional(),
  /** The task's project is a repo that keeps its own rules (ADR 0044): no project checks, no
   * preview. Kept with the project, so a later run needn't read the repos list to know it. */
  ownRules: z.literal(true).optional(),
  /** The newest comment id a run has read; later ones are new to the next run. */
  seen: z.number().default(0),
  /** A task that repeats on a schedule (ADR 0013). */
  repeat: RepeatState.optional(),
  /** A recipe's task (ADR 0032): its file's name, and the hash its repeat was last set from. */
  recipe: z.object({ name: z.string(), hash: z.string() }).optional(),
  /** What's wrong with the task's form: it waits for an edit that fixes it. */
  form: z.string().optional(),
  /** What's waiting, each with when it started (ADR 0031). */
  pending: z
    .object({
      /** Calls the agent proposed, listed for your exact yes: their fingerprint, and whether the
       * run that proposed them read the web or a tool's content. */
      calls: z
        .object({
          calls: z.array(ToolCall),
          fingerprint: z.string(),
          outside: z.boolean().optional(),
        })
        .optional(),
      /** Notes a run that read outside content proposed: written only after your yes. */
      notes: z.array(z.object({ topic: z.string(), line: z.string() })).optional(),
      /** A split a run proposed (ADR 0066): its parts open only after your yes. */
      split: z.array(SplitEntry).optional(),
      /** The list of those calls and notes: the reply that showed it, and when. A yes counts only
       * after that reply, and within a day of it (ADR 0049). */
      list: z.object({ post: z.number(), at: z.string() }).optional(),
      /** Work a talk run found for a project: a work run follows. */
      work: z.object({ project: z.string(), brief: z.string(), at: z.string() }).optional(),
      /** An operation for the github job to run once. */
      operate: z
        .object({
          op: z.enum(OPS),
          version: z.string().optional(),
          bump: z.enum(["minor", "major"]).optional(),
          at: z.string(),
        })
        .optional(),
      /** A merged plan's repo and keys, for the github job before the build. */
      prepare: z.object({ plan: z.string(), at: z.string() }).optional(),
      /** PRs to close because the task was closed as not planned (the github job does it). */
      closePrs: z.array(z.string()).optional(),
      /** A staging app's release PR, followed to its merge, then its production deploy. */
      release: z.object({ repo: z.string(), pr: z.string(), at: z.string() }).optional(),
    })
    .default({}),
  /** The run working on it now, by its id: written first by its plan step, cleared when it ends.
   * The watch (contracts/watch.ts) starts the task again when that run ended without finishing. */
  working: z.number().int().positive().optional().catch(undefined),
  /** The newest comment read (seen) and when it was written: the watch's cursor. */
  cursor: z.object({ id: z.number(), at: z.string() }).optional(),
  /** The task's body as last read: an edit counts as new. */
  bodyHash: z.string().optional(),
  /** A line saved before each outside change (a call, a push, a dispatch): one started and not
   * finished is reported, never repeated. Only the current cursor's lines are kept. */
  journal: z
    .array(
      z.object({ key: z.string(), what: z.string(), at: z.string(), done: z.boolean().optional() }),
    )
    .max(40)
    .optional(),
  /** The last failure, with what to do: only `continue` runs it again. */
  failed: z.object({ at: z.string(), problem: Problem }).optional(),
  /** The merged plan whose repo and keys were made, so a replay doesn't make them again. */
  built: z.string().optional(),
  /** The merged plan whose repo and keys were tried: a run starts a merged plan's build by itself
   * once; after that (it stopped and said why), `publish` or `go` does. */
  prepared: z.string().optional(),
  run: z.string().optional(),
  updated: z.string().optional(),
  /** An answered task closes by itself at this time, unless the owner says more first. */
  closes: z.string().optional(),
  /**
   * A merged PR's deploy, followed until it's up (ADR 0030 §5): the watch's due run reads the
   * pipeline's mark on the commit and tells you "Live: <link>". Gone once told.
   */
  deploy: z
    .object({
      /** The app's id (its repo's name may carry the org's prefix). */
      app: z.string().optional(),
      repo: z.string(),
      sha: z.string(),
      url: z.string().optional(),
      staging: z.boolean().optional(),
      /** A release's production deploy (marked shipify/production), not main's. */
      production: z.boolean().optional(),
      since: z.string(),
    })
    .optional(),
  /** The newest reply, so the status comment links it. */
  reply: z.number().optional(),
  /** The files its replies shared, by name: each one's hash and link, so one listed again unchanged
   * is linked, not uploaded again. The newest SHARED_KEPT names. */
  shared: z.record(z.string(), z.object({ hash: z.string(), url: z.string() })).optional(),
  /** The newest run in full, the last runs as rows, and how many there have been (ADR 0017). */
  last: RunDetails.optional(),
  runs: z.array(RunRow).optional(),
  ran: z.number().optional(),
});
export type TaskState = z.infer<typeof TaskState>;

export const newState = (): TaskState => TaskState.parse({ v: 2, phase: "waiting" });

export interface Comment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export const MARK = "<!-- shipify-task ";
export const isBot = (login: string) => login.endsWith("[bot]");

/**
 * What the owner attached, read from the HTML GitHub renders for a task or a comment. In a
 * private repo each pasted image gets a signed link that works for a few minutes; attached files
 * (a PDF, a zip) get none, and GitHub's API can't download them, so a box can only name them.
 * A pasted video is counted: the agent reads pictures, not videos.
 */
export function attachmentsIn(html: string): { images: string[]; files: string[]; videos: number } {
  const videos = new Set(
    [...html.matchAll(/<video\b[^>]*?\ssrc="([^"]+)"/g)].map((m) =>
      unescapeHtml(m[1] as string).replace(/\?.*$/, ""),
    ),
  ).size;
  const images = [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g)]
    .map((m) => unescapeHtml(m[1] as string))
    .filter((u) =>
      /^https:\/\/(private-user-images\.githubusercontent\.com|github\.com\/user-attachments\/assets)\//.test(
        u,
      ),
    );
  const files = [...html.matchAll(/<a\b[^>]*?\shref="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
    .filter((m) =>
      /^https:\/\/github\.com\/(user-attachments\/files|[^/]+\/[^/]+\/files)\/\d+\//.test(
        m[1] as string,
      ),
    )
    .map((m) => unescapeHtml((m[2] as string).trim()) || (m[1] as string).replace(/.*\//, ""));
  return { images: [...new Set(images)], files: [...new Set(files)], videos };
}

const unescapeHtml = (s: string) =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/**
 * The status comment and the state it records. Only a comment a run wrote (the workflow's own
 * login, RECORD_WRITER) counts, never another bot's (the agent's bot token can comment), and the
 * first one wins, so no later comment can stand in for it (the snapshot also checks who last
 * edited it, ADR 0031). A state this version can't read in full keeps
 * what it can (and the comment, so no second status comment starts over with nothing read).
 */
export function findStatus(comments: Comment[]): { comment?: Comment; state: TaskState } {
  for (const c of comments) {
    if (c.user.login !== RECORD_WRITER || !c.body.startsWith(MARK)) continue;
    const end = c.body.indexOf(" -->");
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(c.body.slice(MARK.length, end)) as Record<string, unknown>;
    } catch {
      continue;
    }
    // A state of another version isn't read: the task starts a version 2 status comment of its own.
    if (raw.v !== 2) continue;
    const parsed = TaskState.safeParse(raw);
    if (parsed.success) return { comment: c, state: parsed.data };
    return { comment: c, state: salvage(raw) };
  }
  return { state: newState() };
}

/** Every field of a state that still reads, the rest left out. */
function salvage(raw: Record<string, unknown>): TaskState {
  const state = newState();
  const shape = TaskState.shape as Record<string, z.ZodType>;
  for (const [key, value] of Object.entries(raw)) {
    const field = shape[key];
    if (!field || key === "v") continue;
    const r = field.safeParse(value);
    if (r.success) (state as Record<string, unknown>)[key] = r.data;
  }
  return state;
}

/**
 * The agent's markdown, made safe to post: an HTML comment would hide the rest of the reply, and
 * an unclosed fold or code block would swallow it, so those are closed or shown as text.
 */
export function safeMarkdown(text: string): string {
  let s = text.replace(/<!--/g, "&lt;!--");
  const fences = (s.match(/^\s*(```|~~~)/gm) ?? []).length;
  if (fences % 2) s += "\n```";
  const open = (s.match(/<details\b/gi) ?? []).length;
  const shut = (s.match(/<\/details>/gi) ?? []).length;
  if (open > shut) s += `\n\n${"</details>\n".repeat(open - shut)}`;
  return s;
}

/** HTML tags that fetch something when GitHub (or a chat) renders them. */
const FETCHES =
  /<(?=\/?\s*(?:img|picture|source|video|audio|svg|image|iframe|object|embed|input|link)\b)/gi;

/**
 * A reply's images made inert (ADR 0044), for a run that read outside content: GitHub's image
 * proxy fetches an image when the task is viewed, so a URL in one could carry data out. Every
 * markdown image's `!` is escaped (once, unless it already is), so it reads as the link it points
 * to, inline or by reference; every HTML tag that fetches is shown as text. Everywhere, code
 * included: telling code from text the way GitHub does is a parser's job, and a guess that's wrong
 * once lets an image through. In code that shows a stray `\` or `&lt;`, which is the price.
 */
export function inertImages(text: string): string {
  return text
    .replace(/(\\*)!\[/g, (_, bs: string) => `${bs}${bs.length % 2 ? "" : "\\"}![`)
    .replace(FETCHES, "&lt;");
}

/** A question, quoted on every line. */
export const quoted = (label: string, text: string) =>
  `> **${label}:** ${text.trim().replace(/\r?\n/g, "\n> ")}`;

const HEADLINE: Record<Phase, string> = {
  waiting: "**Waiting** for a box",
  working: "**Working** on it",
  "needs-you": "**Needs you**",
  failed: "**Failed**",
  answered: "**Answered**",
  done: "**Done**",
  dropped: "**Dropped**",
  repeating: "**Repeating**",
};

const HELP: Record<Phase, string> = {
  waiting: "A box picks this up when one is free.",
  working:
    "A box is on it. Comment any time: the next run reads it, and “use opus” (or another model) picks its model.",
  "needs-you":
    "Comment to change something, say “preview” for a live link to the PR or “start over” to begin again from its default branch, “use opus” (or another model) for the next runs, or close this task as not planned to end it.",
  failed:
    "Comment “continue” (or anything) to try again, “use opus” (or another model) first for a stronger one, or close this task to end it.",
  answered:
    "Comment to ask more or change something, or “remember …” to keep something for every task. After a quiet day it closes by itself, and a comment later carries on.",
  done: "Comment to carry on. On a release or a take-down, “again” runs it again.",
  dropped: "Comment to carry on.",
  repeating:
    "Comment to change it (“make it 8am”), say “stop repeating” to end it, or close this issue.",
};
/** A task with a plan (a new project) can also be published again (ADR 0026). */
const PUBLISH = " Say “publish” to publish its merged plan again.";

export interface StatusView {
  /** For the run details' times. */
  timeZone?: string;
  /** A repeating task's line: its schedule and next run. */
  repeat?: string;
  /** What the run said: the status comment shows its first paragraph, and links the reply. */
  summary?: string;
  question?: string;
  links?: [label: string, url: string][];
  /** The run's reply, which has it all: the summary and the run's details. */
  replyUrl?: string;
  /** What the owner can say here, instead of the phase's own help. */
  help?: string;
}

/**
 * The first paragraph of a reply, as one line: what the status comment shows of it, so the status
 * stays short and the reply is the one place with everything. Nothing for a reply that opens with
 * a table, code or HTML.
 */
export function gist(text: string, max = 280): string {
  const first =
    text
      .replace(/\r\n/g, "\n")
      .trim()
      .split(/\n\s*\n/)[0] ?? "";
  if (/^(```|~~~|\||<)/.test(first.trim())) return "";
  const line = first
    .split("\n")
    .map((l) => l.replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : line;
}

const PR_KIND = { code: "PR", plan: "Plan PR", change: "Change doc PR", release: "Release PR" };

/** Every PR the task opened, with its kind and state: "- Plan PR (merged): https://…". */
export function prLines(s: TaskState): string[] {
  return s.prs.map((url) => {
    const info = s.prInfo?.[url];
    return `- ${PR_KIND[info?.kind ?? "code"]}${info ? ` (${info.state})` : ""}: ${url}`;
  });
}

/**
 * The hidden state line. "-->" never appears in it, even inside a value, so the comment can't end
 * it early.
 */
export const stateLine = (s: TaskState) =>
  `${MARK}${JSON.stringify(s).replaceAll("-->", "--\\u003e")} -->`;

/**
 * The status comment, the task at a glance: a hidden JSON line with the facts, the state, the gist
 * of the latest reply with a link to it, the PRs, and the runs. It never repeats the reply (its full
 * text, the run's details): the reply is where those are.
 */
export function renderStatus(s: TaskState, view: StatusView = {}): string {
  const facts = [s.project, s.lane, s.use?.label].filter(Boolean).join(" · ");
  // PRs come from the state, so every update lists them; the view adds previews and checks.
  const links = [
    ...(view.links ?? []).filter(([, u]) => !s.prs.includes(u)),
    ...(s.run ? ([["Run", s.run]] as [string, string][]) : []),
  ];
  const tz = view.timeZone ?? "UTC";
  const said = view.summary ? gist(view.summary) : "";
  const more = view.replyUrl ? `[${said ? "The full reply" : "The reply"}](${view.replyUrl})` : "";
  return [
    stateLine(s),
    `${HEADLINE[s.phase]}${facts ? ` · ${facts}` : ""}`,
    view.repeat,
    s.phase === "answered" && s.closes
      ? `Closes by itself ${formatWhen(s.closes, tz)} if there's nothing more.`
      : undefined,
    [said, more].filter(Boolean).join(" ") || undefined,
    view.question ? quoted("Question", view.question) : undefined,
    [...prLines(s), ...links.map(([l, u]) => `- ${l}: ${u}`)].join("\n") || undefined,
    s.runs?.length ? renderRuns(s.runs, s.ran ?? s.runs.length, tz, s.last) : undefined,
    `<sub>${s.pending?.calls || s.pending?.notes || s.pending?.split ? "Say “yes” (exactly that, here or in your chat, where Yes is a tap) to make exactly the listed changes, or “no” to cancel them. Anything else you say plans again." : (view.help ?? `${HELP[s.phase]}${s.phase === "needs-you" && s.plan ? PUBLISH : ""}`)}</sub>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A new branch when the old one's PR is closed or merged: task/12-x, task/12-x-r2, … */
export function nextBranch(branch: string): string {
  const m = /^(.*)-r(\d+)$/.exec(branch);
  return m ? `${m[1]}-r${Number(m[2]) + 1}` : `${branch}-r2`;
}

/** The most a reply may say: GitHub's limit for a comment is 65,536 characters. */
export const MAX_REPLY = 60_000;
