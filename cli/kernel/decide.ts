// Decide (ADR 0031): what a run does next, from a snapshot of its task, with no GitHub. Two
// passes: `plan` before the agent (fixed words, forms, intents, what's pending, what's due) and
// `afterThink` with the agent's result (what it proposed, kept as far as the task allows). Both
// return plain data; apply makes the writes. Every path ends in a reply or says why it's silent.
import {
  AFTER_CLOSE_MS,
  acknowledgement,
  DEPLOYING_LABEL,
  type Instant,
  instantOf,
  LIST_HEAD,
  LIST_MAX,
  type Link,
  PERSONALITY_MAX,
  PERSONALITY_TOPIC,
  type PersonalityWord,
  personalityWord,
  pickerAsked,
  PROJECT_LABEL,
  problem,
  REMINDER,
  renderProblem,
  STARTED_LABEL,
  STATE_LABELS,
  STAYING_LABEL,
  SUB_TASK_LABEL,
  type ToolCall,
  goPartOf,
  listCodeOf,
  signInOf,
} from "../contracts/index.ts";
import {
  closedProjectText,
  GUEST_LABEL,
  guestLabel,
  guestPrefix,
  projectLabel,
  projectNameOf,
  shownProject,
  useLine,
  withoutLine,
} from "../contracts/index.ts";
import { RECIPE_LABEL, type Recipe } from "../lib/recipes.ts";
import {
  type ErrandSeen,
  type ErrandWhere,
  errandName,
  errandPrUrl,
  errandWaits,
  formatWhen,
  isOnce,
  labelOf,
  nextLook,
  nextRun,
  ONCE,
  parseSchedule,
  REPEATS_LABEL,
  readWhen,
  WAITING_LABEL,
} from "../lib/repeat.ts";
import { limitName } from "../lib/runs.ts";
import {
  AT_ONCE,
  droppedBy,
  type HeldList,
  looksAt,
  nextBranch,
  type Op,
  PLATFORM,
  PLAYGROUND,
  type SplitEntry,
  TASK_LABELS,
  type TaskState,
} from "../lib/task.ts";
import { fingerprint, listCode } from "./keys.ts";
import {
  firstLine,
  firstPart,
  goParts,
  isPart,
  openParts,
  partClosed,
  partsOf,
  skipped,
  splitLines,
  splitParts,
  stopParts,
  unstarted,
  waitingText,
} from "./parts.ts";
import { type Result, saidAs, stopWords, type Unusable } from "./result.ts";
import type {
  Decided,
  Plan,
  Read,
  Said,
  Snapshot,
  Stop,
  Think,
  ThinkMeta,
  ThinkWhy,
  Write,
} from "./types.ts";
import { NOT_A_GUESTS, type Word, wordOf } from "./words.ts";
import { patchParts } from "./workflows.ts";

/** Said under a pick it can't take: nothing ran with another. */
const PICK_AGAIN = "Nothing ran: send your message again with a pick it takes.";

/** A list of calls waits this long for your yes. */
export const CALLS_GOOD_FOR_MS = 24 * 60 * 60 * 1000;
/**
 * When a deploy that hasn't shown up is said so, and no longer followed: the pipeline's deploy job
 * stops itself at 25 minutes (each project's ship.yml, `main`), so nothing comes later. One takes about a minute.
 */
export const GIVE_UP_MS = 30 * 60_000;

/** What decide needs beyond the snapshot: plain data the run reads once. */
export interface Context {
  /** Each tool's act calls: their argument checks and pre-approved forms (tools.json). */
  tools: Record<string, ToolAct>;
  /**
   * Parse a `use` comment into the task's agent, model and effort; undefined when it isn't one. One
   * it can't take says why (`reply`), and whether its words tried a pick (`tried`: they name an
   * agent or a model), as opposed to words for the agent ("use tailwind"). `/use` alone asks to see
   * the pick (`asked`): answered, never a pick refused.
   */
  use: (
    text: string,
    current: TaskState["use"],
  ) => { use?: TaskState["use"]; reply: string; tried?: boolean; asked?: boolean } | undefined;
  /** Whether a plan is merged on main (plans/<id>.plan.md). */
  planMerged: (id: string) => boolean;
  /** The merged plan whose `task:` line names this task: its id. The plan file is the link. */
  taskPlan: () => string | undefined;
  /** Your time zone, for repeats. */
  timeZone: string;
  /** A deploy's state, read by the snapshot when the task follows one. */
  deploy?: {
    state: "live" | "failed" | "held" | "waiting" | "gone";
    url?: string;
    run?: string;
    staging?: boolean;
  };
  /** A staging app's release PR the task follows, read by the snapshot. */
  release?: { state: "open" | "merged" | "closed" | "unknown"; sha?: string; url?: string };
  /** The deploy of the task's PR that just merged (closing it), read by the snapshot. */
  merged?: NonNullable<TaskState["deploy"]>;
  /** The task's PR that just merged when no app deploys it (Shipify, a package, a recipe). */
  mergedPr?: { url: string; title: string };
  /** An errand's PR or branch, read by the snapshot once its look has come (ADR 0054). */
  errand?: ErrandSeen;
  /** The task's own URL, for links. */
  taskUrl: string;
  /** The answer to `/ping`, `/apps`, `/help`, `/notebook` or `/recipes`, as a chat gets it. */
  instant: (name: Instant, rest: string) => string;
  /** A recipe's task: its file on main, read by the snapshot (ADR 0032). */
  recipe?: { name: string; read: { recipe: Recipe } | { gone: true } | { problem: string } };
  /**
   * The agents whose login is a sign-in their adapter makes with a one-time code (ADR 0074:
   * Codex's ChatGPT session), by id, with their names: `<id> sign in` names one.
   */
  signsIn: Record<string, string>;
}

export interface ToolAct {
  /** Each act call's argument check: true when the arguments fit. */
  calls: Record<string, (args: Record<string, unknown>) => boolean>;
  /** Per call, what an argument does that its value doesn't show, said on its list line. */
  warn?: Record<string, Record<string, string>>;
  /** Per call, the argument that names files the task shared (the box fetches them for it). */
  files?: Record<string, string>;
  /**
   * Pre-approved forms: the call, its fixed fields, its capped text fields, the fields it takes with
   * any value, the most per run, and the tools whose look calls it still counts after (ADR 0049).
   */
  pre: (Form & { after?: string[] })[];
  /** The forms a guest's run may ask for (ADR 0073): made at once, as a guest approves nothing. */
  guest?: Form[];
}

/** A form a call must fit (tools.json's `pre` and `guest`). */
interface Form {
  call: string;
  fixed: Record<string, unknown>;
  caps: Record<string, number>;
  any?: string[];
  max: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The guest whose task it is (ADR 0071): the one its opening `from` line names, which only the door
 * writes. None: the task is yours.
 */
export const guestOf = (s: Pick<Snapshot, "issue">) => s.issue.from?.guest;

/**
 * The project of a guest's task, when it's the guest's own (its name carries their prefix, which
 * the door refuses for yours): a guest's run reads and writes only its pages. None otherwise.
 */
export function guestsProject(s: Pick<Snapshot, "issue" | "project">) {
  const guest = guestOf(s);
  return guest && s.project?.name.startsWith(`${guestPrefix(guest)}-`) ? s.project : undefined;
}
const isYou = (c: Said) => c.author === "owner" || c.author === "door";
/** Words that ask a run something: yours, or a guest's on their own task (ADR 0071). */
const asking = (c: Said) => isYou(c) || c.author === "guest";
const viaGithub = (c: Said) => c.author === "owner" && c.channel === "github";
/** Your words this run hasn't read: after the cursor, from you on GitHub or through the door. */
export const freshOf = (s: Snapshot) => s.said.filter((c) => asking(c) && c.id > s.state.seen);

/**
 * The files you sent through a chat on this task, by the refs on its own from-lines
 * (`<channel>:<id>`) and their names: a call's files may name one of them (a drop of it), and the
 * box fetches it from the door (ADR 0069). Only the door's lines count, so a run can share only
 * what its thread has.
 */
export function sentRefs(s: Snapshot): Record<string, string> {
  const door = (a: string) => a === "door" || a === "guest";
  const from = [
    ...(door(s.issue.author) ? [s.issue.from] : []),
    ...s.said.filter((c) => door(c.author)).map((c) => c.from),
  ];
  const all = from.flatMap((f) => f?.files ?? []).filter((f) => !/^https?:/.test(f.ref));
  return Object.fromEntries(all.map((f) => [f.ref, f.name]));
}

/** A file uploaded on GitHub, in a comment's words. */
const UPLOAD = /github\.com\/(user-attachments\/|[^/\s]+\/[^/\s]+\/files\/\d)/;
/** Words that come with a file: one sent through a chat, or uploaded on GitHub. */
const withFiles = (c: Said) => Boolean(c.from?.files?.length) || UPLOAD.test(c.text);

/**
 * Your words written after a run read its task (`after`: the newest comment it had), as its agent
 * can take them in before it answers: the plain ones, oldest first, up to the first that the next
 * run must read itself (a fixed word, a `use`, a command, a note, a thanks, an edit; a file too,
 * unless the run can fetch it: `files`). How many of yours wait for the next run. And a `stop`, if
 * you said one.
 */
export function laterWords(
  said: Said[],
  after: number,
  files = false,
): { plain: Said[]; waiting?: number; stop?: Said } {
  const yours = said.filter((c) => asking(c) && c.id > after).sort((a, b) => a.id - b.id);
  const plain: Said[] = [];
  for (const c of yours) {
    const own =
      c.edited ||
      wordOf(c.text) ||
      useLine(c.text) !== undefined ||
      pickerAsked(c.text) ||
      instantOf(c.text) ||
      noteOf(c.text) ||
      acknowledgement(c.text) ||
      (!files && withFiles(c));
    if (own) break;
    plain.push(c);
  }
  const stop = yours.find((c) => !c.edited && wordOf(c.text) === "stop");
  const waiting = yours.length - plain.length - (stop ? 1 : 0);
  return { plain, ...(waiting > 0 ? { waiting } : {}), ...(stop ? { stop } : {}) };
}

/**
 * Your words that came in after the run last read the task (its checks ran meanwhile), read once
 * more as its reply goes out: said in the reply, so its "needs you" never hides them. The run their
 * comments queued reads them next.
 */
export function stillWaiting(d: Decided, later: Said[]): void {
  const n = later.filter((c) => asking(c) && c.id > d.state.seen).length;
  const r = d.writes.find((w): w is Extract<Write, { w: "reply" }> => w.w === "reply");
  if (!n || !r) return;
  r.text += `\n\n${n === 1 ? "A message" : `${n} messages`} you sent after this run last read the task ${n === 1 ? "is" : "are"} next: the run ${n === 1 ? "it" : "they"} started reads ${n === 1 ? "it" : "them"} now.`;
}

/**
 * A stay's turn (ADR 0057): your `stop`, with nothing after it, that came as its agent answered (its
 * last read, `later`) came too late to stop anything. It's read with this answer, which says so,
 * so no run starts for it alone and the stay goes on.
 */
export function lateStop(d: Decided, later: Said[]): void {
  const after = later.filter((c) => asking(c) && c.id > d.state.seen);
  const r = d.writes.find((w): w is Extract<Write, { w: "reply" }> => w.w === "reply");
  if (!r || !after.length || !after.every((c) => !c.edited && wordOf(c.text) === "stop")) return;
  d.state.seen = Math.max(...after.map((c) => c.id));
  d.writes.push(...after.map((c): Write => ({ w: "react", comment: c.id, content: "eyes" })));
  r.text += "\n\nYour `stop` came as it answered, so there was nothing left to stop.";
}

/** A shared file's name, as apply finds it in the agent's out folder. */
const nameOf = (f: string) => f.split("/").pop() ?? f;
/** How many shared files a task's status keeps, newest last. */
export const SHARED_KEPT = 20;

/** The task's shared files after a reply shared `files` (paths), with their hashes and links. */
export function sharedNow(
  was: TaskState["shared"],
  files: string[],
  hashes: string[],
  links: Map<string, string>,
): TaskState["shared"] {
  const now = { ...was };
  files.forEach((f, i) => {
    const url = links.get(f);
    const hash = hashes[i];
    if (!url || !hash) return;
    // Newest last: shared again, it moves to the end.
    delete now[nameOf(f)];
    now[nameOf(f)] = { hash, url };
  });
  return Object.fromEntries(Object.entries(now).slice(-SHARED_KEPT));
}

/**
 * A file the task has shared already, unchanged (the same hash, by its name), isn't uploaded again:
 * the reply links that copy. So an answer that only lists it again needs no files key, and a
 * stay's turn goes on (ADR 0062). `hashOf` reads the file the agent left; undefined if it's gone.
 */
export function sharedBefore(d: Decided, hashOf: (name: string) => string | undefined): void {
  const shared = d.state.shared ?? {};
  for (const r of d.writes) {
    if (r.w !== "reply" || !r.files?.length) continue;
    const links: Link[] = [];
    const files = r.files.filter((f) => {
      const name = nameOf(f);
      const was = shared[name];
      if (!was || hashOf(name) !== was.hash) return true;
      links.push([`${name.slice(0, 66)} (unchanged)`, was.url]);
      return false;
    });
    if (!links.length) continue;
    if (files.length) r.files = files;
    else delete r.files;
    r.links = [...(r.links ?? []), ...links];
  }
}

const reply = (
  kind: Extract<Write, { w: "reply" }>["kind"],
  state: string,
  text: string,
  step: string,
  extra: Partial<Extract<Write, { w: "reply" }>> = {},
): Write => ({ w: "reply", kind, state, text, step, ...extra });

const box = (st: TaskState, why: string, ...writes: Write[]): Plan => ({
  do: "box",
  writes,
  state: st,
  why,
});
const nothing = (why: string, state?: TaskState): Plan => ({ do: "nothing", why, state });

/**
 * A button's word (ADR 0069: Stop the run, Stop repeating, from the web chat) is answered on the
 * status's Last action line, not with a reply, so its thread shows nothing for it. A typed word
 * keeps its reply.
 */
function byButton(s: Snapshot, st: TaskState, button: boolean, writes: Write[]): Write[] {
  if (!button) return writes;
  const r = writes.find((w) => w.w === "reply");
  if (r?.w === "reply") st.action = { text: r.text.slice(0, 500), at: s.now };
  return writes.filter((w) => w !== r);
}

/**
 * `remember: …`, `remember <Topic>: …` (one word, or a repo's name: its own page, ADR 0047) or
 * `forget: …` as a whole one-line comment: a note
 * to write or to remove. Anything longer ("Remember the old design: blue header, bring it back") is
 * words for the agent. A new task's title is read by lib/task.ts' parseTitle, which takes longer topics.
 * And `personality: …` (ADR 0078), whole, lines too: the Personality page's new words.
 */
const noteOf = (
  text: string,
):
  | { kind: "remember"; ask: string; topic?: string }
  | { kind: "forget"; ask: string }
  | { kind: "personality"; set: PersonalityWord }
  | undefined => {
  // `personality: …` (ADR 0078): your words for how it talks to you, lines too.
  const voice = personalityWord(text);
  if (voice) return { kind: "personality", set: voice };
  const t = text.trim();
  if (t.includes("\n")) return undefined;
  const m = /^(remember|forget)(?:\s+([\p{L}\p{N}'&./_-]{1,140}))?\s*:\s*(\S.{0,499})$/iu.exec(t);
  if (!m?.[1] || !m[3]) return undefined;
  if (m[1].toLowerCase() === "forget")
    return m[2] ? undefined : { kind: "forget", ask: m[3].trim() };
  return { kind: "remember", ask: m[3].trim(), ...(m[2] ? { topic: m[2] } : {}) };
};

/**
 * A note, a forget or a Personality, as the box writes it: on your pages, or on a guest's own page
 * (`guest`, by their id, ADR 0078), which has no topics.
 */
const noteWrite = (n: NonNullable<ReturnType<typeof noteOf>>, guest = ""): Write => {
  const theirs = guest ? { guest } : {};
  if (n.kind === "personality") return { w: "personality", set: n.set, ...theirs };
  if (n.kind === "forget") return { w: "forget", words: n.ask, ...theirs };
  return { w: "note", topic: n.topic ?? "Preferences", line: n.ask, ...theirs };
};

/** The newest comment id among these, or the cursor. */
const upTo = (s: Snapshot, fresh: Said[]) => Math.max(s.state.seen, ...fresh.map((c) => c.id));
/**
 * When an answered task closes by itself: never, but a split's part, a quiet day later (the due run
 * closes it then, ADR 0040), since its close starts the parts that wait for it (ADR 0069).
 */
const quietDay = (s: Snapshot) =>
  s.issue.labels.includes(SUB_TASK_LABEL)
    ? new Date(Date.parse(s.now) + 24 * 3600_000).toISOString()
    : undefined;
/** The state labels a closed task drops. */
const GONE: string[] = [...STATE_LABELS];
/** What `close` does to the task's status, wherever it's closed: done, read, its repeat paused (`resume` carries it on). */
/** The list waiting for your yes, gone: its calls, its notes and its time. */
function dropList(st: TaskState) {
  st.pending.calls = undefined;
  st.pending.notes = undefined;
  st.pending.split = undefined;
  st.pending.clean = undefined;
  st.pending.workflow = undefined;
  st.pending.first = undefined;
  st.pending.atOnce = undefined;
  st.pending.list = undefined;
}

/**
 * A list's held kinds (ADR 0075), as its code names them: a workflow change by its patch's hash;
 * an operation from a chat by its project (ADR 0049).
 */
const heldKinds = (p: TaskState["pending"], project?: string): unknown[] => [
  ...(p.workflow ? [{ workflow: p.workflow.sha256, branch: p.workflow.branch }] : []),
  ...(p.first ? [{ first: p.first }] : []),
  ...(p.atOnce ? [{ operate: p.atOnce, project }] : []),
];

/**
 * A held workflow change's lines on the list (ADR 0075 §5.3): each file, where, the box's facts,
 * and its exact lines, in one item with no blank line, so a chat shows it whole.
 */
export function heldLines(h: HeldList, pr?: string): string[] {
  const where = `\`${h.branch}\`${pr ? ` (PR #${pr.split("/").pop()})` : ""}`;
  const parts = patchParts(h.patch);
  return h.files.map((f, i) => {
    const diff = parts.get(f) ?? "";
    const ticks = Math.max(3, ...[...diff.matchAll(/`+/g)].map((m) => m[0].length + 1));
    const fence = "`".repeat(ticks);
    return [
      [
        `Change \`${f}\` on ${where} ${h.facts[i] ?? ""}`.trim(),
        h.mainNewer && i === 0
          ? "The run merged `main`, which changed it too: the patch carries `main`'s newer lines, so approve it before you merge (until then the PR takes them out)."
          : "",
        h.outside && i === 0 ? "This run read from outside: read each line before your Yes." : "",
      ]
        .filter(Boolean)
        .join(" "),
      `${fence}diff`,
      ...diff.split("\n"),
      fence,
    ].join("\n   ");
  });
}

/** What else a list holds besides calls, notes and a split (ADR 0075): its lines. */
const heldListLines = (st: TaskState) => [
  ...(st.pending.workflow ? heldLines(st.pending.workflow, openPr(st)) : []),
  ...(st.pending.first ? [firstLine(st.pending.first)] : []),
];

/** A clean start's list (ADR 0070), a line a chat, as its reply shows it and its yes approves it. */
const cleanLines = (clean: { n: number; title: string }[]) =>
  clean.map((c, i) => `${i + 1}. Close #${c.n} ${c.title.replace(/\s+/g, " ").slice(0, 60)}`);

/**
 * `clean start` (ADR 0070 §7): the open chats outside your projects that nothing keeps open (the
 * 30-day close's rules, whatever their age), listed for your yes, with no agent. Nothing closes
 * before it; this chat isn't one of them.
 */
function cleanStart(s: Snapshot, st: TaskState, fresh: Said[], writes: Write[]): Plan {
  st.seen = upTo(s, fresh);
  st.bodyHash = s.bodyHash;
  const step = `clean-${fresh.at(-1)?.id ?? 0}`;
  const said = (text: string) =>
    box(st, "clean start", ...writes, reply("answer", "Done", text, step));
  if (!s.cleanable)
    return said(
      "The open chats couldn't be read, so nothing is listed: say `clean start` again in a minute.",
    );
  if (!s.cleanable.length)
    return said(
      "Nothing to close: every other open chat is in a project, or kept open (a repeat, an errand, an open PR or part, one at work or waiting on you).",
    );
  dropList(st);
  const clean = s.cleanable.map(({ n, title }) => ({ n, title }));
  st.pending.clean = clean;
  st.pending.list = { post: 0, at: s.now };
  st.phase = "needs-you";
  st.closes = undefined;
  const lines = cleanLines(clean);
  const long = lines.join("\n").length > LIST_MAX;
  const text = [
    `A clean start: ${clean.length} open chat${clean.length === 1 ? "" : "s"} outside your projects that nothing keeps open (no repeat, errand, open PR or part, and none at work or waiting on you). Export first what you want to keep: **Export everything** in Files, or a project's **Export**.`,
    "",
    `${LIST_HEAD} (${long ? "comment `yes` on the task on GitHub, within a day: it's too long for a chat" : "tap Yes, or say `yes`, within a day"}):`,
    ...lines,
    "",
    "On `yes`, each is read again and closed as done, as the 30-day close does: one with new words since this list stays open. Writing on one opens it again. Their files go 30 days after, by the weekly clean-up (**Delete** in Files takes one now). Your projects and their pages stay.",
  ].join("\n");
  return box(
    st,
    "clean start",
    ...writes,
    reply("needs-you", "Needs you", text, step, {
      list: long ? "github" : listCode([], [], [], clean),
    }),
  );
}

/**
 * The agent a `sign in` names, by its id or its name, when it signs in with a code (`codex sign
 * in`); a bare `sign in`, the only one that does. None: the words aren't one.
 */
function signingIn(text: string, ctx: Context): string | undefined {
  const named = signInOf(text);
  if (named === undefined) return undefined;
  const ids = Object.keys(ctx.signsIn);
  if (!named) return ids.length === 1 ? ids[0] : undefined;
  return ids.find((id) => id === named || ctx.signsIn[id]?.toLowerCase() === named);
}

/**
 * `<agent> sign in` (ADR 0074): the agent signs in to your account with a one-time code, on GitHub's
 * machine, by the github job, with no agent and no box. Its reply shows you a link and the code for
 * any device; once you've used them, the job sets the agent's secret and says so. Only yours: a
 * guest's is words.
 */
function signIn(
  s: Snapshot,
  st: TaskState,
  fresh: Said[],
  writes: Write[],
  agent: string,
  ctx: Context,
): Plan {
  st.seen = upTo(s, fresh);
  st.pending.signIn = { agent, at: s.now };
  // A new chat's is at work until the job answers; a task's own state stays as it was.
  if (st.phase === "waiting") st.phase = "working";
  return box(
    st,
    "a sign-in",
    ...writes,
    { w: "dispatch", job: "github" },
    reply(
      "answer",
      "Working",
      `Starting ${ctx.signsIn[agent] ?? agent}'s sign-in on GitHub's machine: a link and a one-time code come here in a minute or two, for your phone or any device.`,
      `sign-in-${fresh.at(-1)?.id ?? 0}`,
    ),
  );
}

/** `close`, and what it writes: an errand's label off, when it drops one; a project's chats. */
function closeWord(s: Snapshot, st: TaskState, fresh: Said[]): Write[] {
  st.seen = upTo(s, fresh);
  st.working = undefined;
  const off = closeRepeat(st);
  dropList(st);
  st.closes = undefined;
  st.phase = "done";
  return [...off, ...projectChats(s, fresh), ...projectPages(s, "closed")];
}

/**
 * A project's pages follow it (task #744): closed as it closes, open as it opens again, so none
 * waits to be closed by hand. They stay its pages either way. None for a task that isn't a project.
 */
function projectPages(s: Snapshot, state: "open" | "closed"): Write[] {
  const name = s.issue.labels.includes(PROJECT_LABEL) ? projectNameOf(s.issue.title) : undefined;
  if (!name) return [];
  const guest = guestOf(s);
  return [{ w: "project-pages", label: projectLabel(name), state, ...(guest ? { guest } : {}) }];
}

/** What keeps a project's chat open as the project closes: a run on it, a repeat or an errand. */
const KEEPS_OPEN = new Set([
  TASK_LABELS.working.name,
  STAYING_LABEL,
  DEPLOYING_LABEL,
  REPEATS_LABEL.name,
  WAITING_LABEL.name,
]);
/** The status line of a chat closed with its project. */
export const WITH_PROJECT_CLOSED = "Closed with its project: write on it to open it again";

/**
 * A project's `close` closes its open chats too, as done, as a clean start does: but one a run is
 * on, or a repeat or an errand keeps open, which the reply names. Only those on the project's side
 * of the wall (ADR 0071): a guest's project closes their chats alone, yours none of a guest's (only
 * a link made by hand on GitHub can mix them). Its reply always says what stays and when its files
 * go; its chats unread, it says so.
 */
function projectChats(s: Snapshot, fresh: Said[]): Write[] {
  if (!s.issue.labels.includes(PROJECT_LABEL)) return [];
  const step = `close-${fresh.at(-1)?.id ?? 0}`;
  const stays = closedProjectText(s.issue.closedAt ?? s.now);
  const said = (...text: string[]) => [reply("answer", "Done", [...text, stays].join(" "), step)];
  const chats = s.project?.number === s.n ? s.project.chats : undefined;
  if (!chats)
    return s.familyUnread
      ? said("Its chats couldn't be read, so they stay open: say `reopen`, then close it again.")
      : said();
  const guest = guestOf(s);
  const ours = (labels: string[]) =>
    guest ? labels.includes(guestLabel(guest)) : !labels.includes(GUEST_LABEL);
  const open = chats.filter((c) => c.state === "open" && ours(c.labels));
  const kept = open.filter((c) => c.labels.some((l) => KEEPS_OPEN.has(l)));
  const shut = open.filter((c) => !kept.includes(c));
  return [
    ...(shut.length
      ? [
          {
            w: "close-chats",
            chats: shut.map((c) => ({ number: c.number, labels: c.labels })),
            why: WITH_PROJECT_CLOSED,
          } as const,
        ]
      : []),
    ...said(
      ...(kept.length
        ? [
            `Left open, as a run, a repeat or an errand keeps them open: ${kept.map((c) => `#${c.number}`).join(", ")}. Close each when it's done.`,
          ]
        : []),
    ),
  ];
}

/**
 * Closing pauses a repeat (`resume` carries it on), and drops a time once. An errand is dropped
 * with its label (the due run lists closed tasks by it), unless a merge closed the task: then it
 * waits on, and that merge may be what it waits for (ADR 0054 §4).
 */
function closeRepeat(st: TaskState, byMerge = false): Write[] {
  const r = st.repeat;
  if (r?.on && byMerge) return [];
  if (r && isOnce(r)) st.repeat = undefined;
  else if (r) r.paused = true;
  return r?.on ? [{ w: "labels", remove: [labelOf(r).name] }] : [];
}

// ---------------------------------------------------------------------------------------- plan

/**
 * What a run does next, from the task (ADR 0031). Two things the box answers itself, with the
 * cause and the fix, so no agent runs only to say them (ADR 0045):
 * - another of your accounts the repos App can't reach;
 * - on a task's first run, a change on a name it refused (an account you haven't added, a repo the
 *   App doesn't reach, a repo on another account). Later runs carry on as words, so you can still
 *   ask about it.
 */
export function plan(s: Snapshot, ctx: Context): Plan {
  const p = planned(s, ctx);
  if (p.do !== "think") return p;
  const text =
    p.think.account && s.account && !s.account.reached
      ? unreached(s, s.account.login)
      : p.think.refused && p.think.why === "new"
        ? p.think.refused
        : undefined;
  if (!text) return p;
  const st: TaskState = {
    ...p.state,
    working: undefined,
    seen: Math.max(p.state.seen, ...p.think.fresh),
    bodyHash: s.bodyHash,
  };
  return box(
    st,
    "a name or an account it can't work on",
    ...(p.writes ?? []),
    reply("needs-you", "Needs you", text, "name-refused"),
  );
}

function planned(s: Snapshot, ctx: Context): Plan {
  const st = clone(s.state);
  if (!s.isTask) return nothing("not a task");
  if (s.issue.isPr) return nothing("a PR");
  if (s.issue.author === "other") return nothing("opened by someone else: nothing runs for it");
  // A merged plan is its task's by the plan's own `task:` line, whatever a run said.
  st.plan ??= ctx.taskPlan();

  if (s.trigger.kind === "dispatch" && s.trigger.job === "github") return githubJob(st, ctx);

  const first = s.state.bodyHash === undefined && s.statusId === undefined;
  // A part no run has started (ADR 0066): the box's run on it is its start, even after the box
  // answered words on it (that it waits, a setting), which gave it a status but no state label.
  const part = unstarted(s);
  const starting = part !== undefined && s.trigger.kind === "dispatch" && s.trigger.job === "run";
  let fresh = freshOf(s);
  const writes: Write[] = [];
  /** Your words seen, and the box answers them with no agent: what `writes` holds, then `more`. */
  const answered = (why: string, ...more: Write[]): Plan => {
    st.seen = upTo(s, fresh);
    return box(st, why, ...writes, ...more);
  };
  // The model a task starts with (its form's Model, or a first line `use <model>`): a pick made on
  // purpose, so one it can't take is said, a typo too, and nothing runs with another (ADR 0042).
  if (first && s.firstUse && !st.use) {
    const u = ctx.use(`use ${s.firstUse}`, undefined);
    if (u?.use) st.use = u.use;
    else if (u && !u.asked) {
      st.bodyHash = s.bodyHash;
      return answered(
        "a `use` it can't take",
        reply("needs-you", "Needs you", `${u.reply} ${PICK_AGAIN}`, "use-first"),
      );
    }
  }

  const edited = !first && s.bodyHash !== s.state.bodyHash;

  // A closed task: a close is handled once; a message well after it carries the task on.
  if (s.issue.state === "closed") {
    const closed = Date.parse(s.issue.closedAt ?? "") || 0;
    const later = fresh.filter((c) => Date.parse(c.at) > closed + AFTER_CLOSE_MS);
    // A merged task's deploy still says how it went, on the closed task.
    if (s.trigger.kind === "dispatch" && !later.length) {
      const due = dispatched(s, st, ctx, writes);
      if (due) return due;
    }
    if (s.trigger.kind === "closed" || !later.length) return closedPlan(s, st, ctx);
    // A close no run has handled yet is handled first, as its own run would have (ADR 0040): your
    // `close` from a chat starts no run, and a merge's own run may have been replaced by this one
    // (one waits per task). Your later words then carry the task on.
    if (st.phase !== "done" && st.phase !== "dropped") {
      const asClosed = fresh.filter((c) => Math.abs(Date.parse(c.at) - closed) <= AFTER_CLOSE_MS);
      if (wordOf(asClosed.at(-1)?.text ?? "") === "close") {
        writes.push(...closeWord(s, st, asClosed), { w: "coming-up" });
      } else if (ctx.merged || ctx.mergedPr) {
        const closing = closedPlan(s, st, ctx);
        if (closing.do === "box") writes.push(...closing.writes.filter((w) => w.w !== "close"));
        // An errand's job the merge fired runs first, the thread with your words in it.
        if (closing.do === "think") return closing;
      }
    }
    // A thanks after it closed leaves it closed (its close seen to as ever) with a 👍, unless it
    // answers a question that was waiting: then it carries the task on, as any words do.
    if (!edited && !questionWaits(st) && later.every((c) => acknowledgement(c.text) === "thanks")) {
      st.seen = upTo(s, fresh);
      const closing = closedPlan(s, st, ctx);
      if (closing.do === "think") return closing;
      return box(
        st,
        `a thanks on a closed task (${closing.why})`,
        ...(closing.do === "box" ? closing.writes : []),
        ...thumbsUp(later),
      );
    }
    writes.push({ w: "reopen" }, ...projectPages(s, "open"));
    // Its new words: yours since, and any from before the close no run read (a merge came first),
    // as runPlan's 👀 says; not those said as it closed.
    fresh = fresh.filter((c) => Math.abs(Date.parse(c.at) - closed) > AFTER_CLOSE_MS);
  }

  st.bodyHash = s.bodyHash;

  // A recipe's task follows its file on main: set, updated, paused or ended by it.
  const inStep = recipeInStep(s, st, ctx, writes);
  if (inStep) return inStep;

  // An operation runs by itself, once (the Operate form, or its title); see opPlan for where from.
  // A guest's title is only words (snapshot's parsedOf, ADR 0071): never an operation, checked here too.
  if (s.parsed.kind === "op" && !guestOf(s)) return opPlan(s, st, fresh, first, ctx, writes);

  // A form with a wrong answer runs nothing until an edit fixes it.
  if (s.form?.problems.length && (first || edited || st.form)) {
    st.form = s.form.problems.join(" ");
    const p = problem("form-wrong", { answer: s.form.problems.join(" ") });
    return answered(
      "a form to fix",
      reply("needs-you", "Needs you", renderProblem(p), "form", { problem: p }),
    );
  }
  if (st.form && !s.form?.problems.length) st.form = undefined;

  // The Repeat form sets its repeat with no agent, and an edit changes it.
  if (s.repeatForm && (first || edited) && !guestOf(s)) return repeatFromForm(s, st, ctx, writes);

  // `clean start` as a new chat's words (ADR 0070): its list, with no agent. Never a guest's.
  if (
    first &&
    !guestOf(s) &&
    wordOf(s.issue.title) === "clean start" &&
    (!s.issue.body.trim() || wordOf(s.issue.body) === "clean start")
  )
    return cleanStart(s, st, fresh, writes);

  // `<agent> sign in` as a new chat's words (ADR 0074): its sign-in with a code. Never a guest's.
  const signsInFirst =
    first && !guestOf(s) && (!s.issue.body.trim() || s.issue.body.trim() === s.issue.title.trim())
      ? signingIn(s.issue.title, ctx)
      : undefined;
  if (signsInFirst) return signIn(s, st, fresh, writes, signsInFirst, ctx);

  // A command on its own as a new task's title (`/apps`): answered with no agent, then closed.
  // A guest's are words for their agent (ADR 0071): the door refuses yours from them already.
  const asked = first && !s.issue.body.trim() && !guestOf(s) ? instantOf(s.issue.title) : null;
  if (asked)
    return answered(
      `/${asked.name}`,
      reply("answer", "Done", ctx.instant(asked.name, asked.rest), `instant-${asked.name}`),
      { w: "close", reason: "completed" },
    );

  // Fixed words: whole comments, each accepted only from where it may be said.
  // `yes` and `no` approve or drop a list; with nothing waiting they're plain words (an answer to
  // the agent's own question), but a list's Yes (`yes <code>`) is answered: its list is gone.
  const listed = Boolean(
    st.pending.calls ||
      st.pending.notes ||
      st.pending.split ||
      st.pending.clean ||
      st.pending.workflow ||
      st.pending.first,
  );
  // Picks build on each other in the order you said them: each is read against the pick as it
  // stands after the ones before (`use sonnet`, then `use high`, is Sonnet at high).
  let picked = st.use;
  const said = fresh.map((c) => {
    const use = ctx.use(c.text, picked);
    if (use?.use) picked = use.use;
    // A guest's words (ADR 0071): a `use` picks, but no approval, command or note is theirs.
    const guest = c.author === "guest";
    const fixed = wordOf(c.text);
    // A `sign in` that names no agent signing in ("please sign in") is words for the agent.
    const word =
      (guest && fixed && NOT_A_GUESTS.has(fixed)) ||
      (fixed === "sign in" && !signingIn(c.text, ctx))
        ? undefined
        : fixed;
    // A `use` line in a longer message: this run thinks with it. One that tries a pick it can't
    // take is told (below); one that names no agent or model stays words for the agent.
    const line = use
      ? undefined
      : c.text
          .split(/\r?\n/)
          .map((l) => ctx.use(l, picked))
          .filter((u) => u?.use || u?.tried)
          .at(-1);
    if (line?.use) picked = line.use;
    return {
      c,
      word: (word === "yes" || word === "no") && !listed && !listCodeOf(c.text) ? undefined : word,
      use,
      choice: line?.use,
      refused: line && !line.use ? line.reply : undefined,
      instant: guest ? undefined : instantOf(c.text),
      // A guest's `remember:`, `forget:` and `personality:` write their own page (ADR 0078).
      note: noteOf(c.text),
    };
  });
  // A list's Yes with no list waiting (made, dropped, expired): said, with no agent.
  const gone = (x: (typeof said)[number]) => x.word === "yes" && !listed;
  for (const x of said.filter(gone)) {
    const p = problem("list-gone");
    writes.push(reply("answer", "Done", renderProblem(p), `yes-gone-${x.c.id}`, { problem: p }));
  }
  const usable = said.filter((x) => !gone(x));
  // `use <model>` changes the task's model. Alone, it's all this run does, and the reply says so;
  // with your words (a setting from a chat, then them), this run thinks with it and says nothing.
  const withWords = usable.some((x) => !x.use && !x.instant && !x.note);
  for (const x of usable.filter((x) => x.use)) {
    if (x.use?.use) st.use = x.use.use;
    // One it can't take, with your words beside it, is told below, and runs nothing.
    else if (withWords && !x.use?.asked) continue;
    if (!withWords || !x.use?.use)
      writes.push(reply("answer", "Done", x.use?.reply ?? "", `use-${x.c.id}`));
  }
  // `/apps`, `/ping`, `/notebook`…: the same answer as in a chat, with no agent.
  for (const x of usable.filter((x) => !x.use && x.instant)) {
    const i = x.instant as NonNullable<typeof x.instant>;
    writes.push(reply("answer", "Done", ctx.instant(i.name, i.rest), `instant-${x.c.id}`));
  }
  // `remember: …`, `forget: …` and `personality: …` on any task: the box writes or removes the
  // note, or sets the Personality, with no agent. A guest's go on their own page (ADR 0078).
  const notes = usable.filter((x) => !x.use && !x.instant && x.note);
  for (const x of notes)
    writes.push(
      noteWrite(
        x.note as NonNullable<typeof x.note>,
        x.c.author === "guest" ? (guestOf(s) ?? "") : "",
      ),
    );
  if (notes.length)
    writes.push(
      reply(
        "answer",
        "Done",
        "",
        `notes-${notes.at(-1)?.c.id}`,
        notes.some((x) => x.note?.kind === "personality") ? { undo: true } : {},
      ),
    );
  const rest = usable.filter((x) => !x.use && !x.instant && !x.note);
  // A pick it can't take, in your words: said, and nothing runs, never with a model you didn't
  // choose (ADR 0042). Your words are read: send them again with a pick it takes.
  const refused = [
    ...(withWords ? usable.filter((x) => x.use && !x.use.use && !x.use.asked) : []),
    ...rest.filter((x) => x.refused),
  ];
  if (refused.length)
    return answered(
      "a `use` it can't take",
      ...refused.map((x) =>
        reply(
          "needs-you",
          "Needs you",
          `${x.refused ?? x.use?.reply} ${PICK_AGAIN}`,
          `use-${x.c.id}`,
        ),
      ),
    );
  const choice = rest.findLast((x) => x.choice)?.choice;
  if (choice) st.use = choice;
  const words = rest.filter((x) => x.word).map((x) => x.word as Word);
  const plain = rest.filter((x) => !x.word);
  const refusedOnly = said.length > 0 && !usable.length;
  if (refusedOnly || (said.length && !rest.length && !edited))
    return answered(refusedOnly ? "a word it can't take here" : "a command");

  // A lone thanks ("ok", "thanks", 👍) is your answer only while a question waits on you; after a
  // PR to merge, a list for your `yes`, or an answer, it's a thanks: a 👍, and the agent stays idle.
  if (
    !first &&
    !edited &&
    fresh.length > 0 &&
    fresh.every((c) => acknowledgement(c.text) === "thanks") &&
    !questionWaits(st)
  )
    return answered("a thanks", ...thumbsUp(fresh));

  // Calls, a split or a clean start listed for your yes: the newest of yes and no decides;
  // anything else plans again.
  if (
    (st.pending.calls ||
      st.pending.split ||
      st.pending.clean ||
      st.pending.workflow ||
      st.pending.first) &&
    rest.length
  ) {
    if (rest.every((x) => x.word === "yes" || x.word === "no"))
      return yesOrNo(
        s,
        st,
        rest.map((x) => x.c),
        ctx,
        writes,
      );
    dropList(st);
  }
  if (st.pending.notes && rest.length && rest.every((x) => x.word === "yes" || x.word === "no"))
    return yesOrNo(
      s,
      st,
      rest.map((x) => x.c),
      ctx,
      writes,
    );

  // `clean start` (ADR 0070): the chats to close, listed for your yes, with no agent.
  if (words.at(-1) === "clean start" && !plain.length) return cleanStart(s, st, fresh, writes);

  // `<agent> sign in` (ADR 0074): its sign-in with a code, by the github job, with no agent.
  const signing = signingIn(rest.findLast((x) => x.word)?.c.text ?? "", ctx);
  if (words.at(-1) === "sign in" && signing && !plain.length)
    return signIn(s, st, fresh, writes, signing, ctx);

  // `close`: the task is done, with no agent (its PRs stay as they are; a repeat stops).
  if (words.at(-1) === "close" && !plain.length) {
    const off = closeWord(s, st, fresh);
    return box(
      st,
      "close",
      ...writes,
      ...off,
      { w: "coming-up" },
      reply(
        "answer",
        "Done",
        "Closed. Write again to carry it on, or say `reopen`.",
        `close-${fresh.at(-1)?.id ?? 0}`,
      ),
      { w: "close", reason: "completed" },
      // A part closed as done (ADR 0066): what waited for it may start.
      ...partClosed(s, { reason: "completed" }),
    );
  }

  // A split task's own words (ADR 0066): `go` starts its ready parts, `go #n` that one, and `stop`
  // starts no more. `go #n` on a task with no parts is said, with nothing started.
  const last = rest.findLast((x) => x.word);
  if (last && !plain.length && (last.word === "go" || last.word === "stop")) {
    const n = last.word === "go" ? goPartOf(last.c.text) : undefined;
    // A task first (ADR 0075) leaves `go` and `stop` as on a task without parts.
    const parent = splitParts(s).length > 0;
    const stops = last.word === "stop" && parent;
    if ((last.word === "go" && (parent || n !== undefined)) || stops) {
      const said = !parent
        ? {
            writes: [],
            text: `#${n} isn't a part of this task: \`go #n\` starts a sub-task from its parent's thread.`,
          }
        : stops
          ? stopParts(s)
          : goParts(s, n);
      // A parent waits for its parts, never closed for quiet: it closes with them.
      if (parent) {
        st.phase = stops ? "needs-you" : "answered";
        st.closes = undefined;
      }
      return answered(
        stops ? "stop on a split task" : "go on a split task",
        ...said.writes,
        reply(
          stops ? "needs-you" : "answer",
          stops ? "Needs you" : "Done",
          said.text,
          `parts-${last.c.id}`,
        ),
      );
    }
  }

  // A project's pages open with it (task #744), in the run that reads its `reopen`, with your words
  // after it too (one run waits per task), unless the reopen above (words on it closed) took them.
  const reopened = writes.some((w) => w.w === "reopen");
  const pages = words.includes("reopen") && !reopened ? projectPages(s, "open") : [];
  writes.push(...pages);
  // `reopen`: the task open again with no agent (written above, or by the door as it wrote the
  // word); your next words carry it on. One the door did is a setting, and it said so in the chat
  // already: a run that finds it (one queued for a `close` before it) notes it and says nothing. A
  // project's is words, so this run opens its pages, quietly too.
  if (words.at(-1) === "reopen" && !plain.length) {
    if (fresh.at(-1)?.from?.setting) return answered("reopened by the door");
    if (pages.length && fresh.at(-1)?.from) return answered("a project reopened");
    const was = reopened || st.phase === "done" || st.phase === "dropped";
    return answered(
      "reopen",
      reply(
        "needs-you",
        "Needs you",
        was ? "Reopened: say what you'd like next." : "It's open: say what you'd like next.",
        `reopen-${fresh.at(-1)?.id ?? 0}`,
      ),
    );
  }

  // `stop` here: no run was going (a run reads it while its agent works, and marks it read).
  if (words.length && !plain.length && words.every((w) => w === "stop")) {
    st.seen = upTo(s, fresh);
    const more = st.repeat ? " To end the repeat, say `stop repeating`." : "";
    return box(
      st,
      "stop with no run going",
      ...byButton(s, st, Boolean(fresh.at(-1)?.from?.button), [
        ...writes,
        reply(
          "answer",
          "Done",
          `Nothing was working by then, so there was nothing to stop.${more}`,
          `stop-${fresh.at(-1)?.id ?? 0}`,
        ),
      ]),
    );
  }

  // A repeat's own words, with no agent.
  if (
    st.repeat &&
    words.length &&
    !plain.length &&
    words.every((w) => w === "stop repeating" || w === "resume")
  )
    return repeatWords(s, st, words, fresh, writes);

  // A merged plan's build, or again after it stopped. `go` on a new project's task is the same:
  // its plan is the doc you merged until it's built (a big change's `go` is below).
  const go = words.includes("go") && Boolean(st.plan) && (st.built !== st.plan || !docMerged(st));
  if (words.includes("publish") || go) {
    if (!st.plan || !ctx.planMerged(st.plan))
      return answered(
        "publish with no merged plan",
        reply(
          "answer",
          "Done",
          st.plan
            ? `Merge the plan's PR first; then say \`${go ? "go" : "publish"}\`.`
            : "There's no merged plan on this task to publish.",
          "publish-none",
        ),
      );
    const again = st.prepared === st.plan || st.built === st.plan;
    st.pending.prepare = { plan: st.plan, at: s.now };
    return answered(
      "publish",
      { w: "dispatch", job: "github" },
      reply(
        "answer",
        "Working",
        `Publishing ${st.plan}${again ? " again" : ""}: its repo and keys first, then the build.`,
        "publish",
      ),
    );
  }
  if (words.includes("preview")) {
    const pr = openPr(st);
    if (!pr || !st.project)
      return answered(
        "preview with no PR",
        reply("answer", "Done", "There's no PR yet to preview.", "preview-none"),
      );
    // A repo that keeps its own rules has no preview: that's an app's, and nothing of Shipify's
    // goes into such a repo (ADR 0044).
    if (st.ownRules)
      return answered(
        "preview of a repo",
        reply(
          "answer",
          "Done",
          `A preview is an app's: \`${st.project}\` isn't a Shipify project, so its own CI checks its PR.`,
          "preview-repo",
        ),
      );
    st.preview = true;
    return answered(
      "preview",
      { w: "preview", repo: st.project, pr },
      reply(
        "answer",
        "Needs you",
        "Preview is on for this PR: its pipeline builds it now, and its link shows on the PR once it's up.",
        "preview",
      ),
    );
  }

  // A reminder's time always fires: it needs no agent. Your words wait, unread, for your
  // `continue` (ADR 0042); any other repeat's time gives way to them, as before.
  if (s.trigger.kind === "dispatch" && fresh.length && st.repeat?.kind === "reminder") {
    const due = repeatTime(s, st, ctx, writes);
    if (due) return due;
  }
  // Due work a dispatch brings: a repeat's time, a deploy, work for a project.
  if (s.trigger.kind === "dispatch" && !fresh.length) {
    const due = dispatched(s, st, ctx, writes);
    if (due) return due;
  }
  // Work you asked for, waiting, its own run replaced by this one (one waits per task, ADR 0040):
  // done now, with your newer words in it. The rest a dispatch brings is due again at the next due
  // run (a repeat's time and a deploy are on the task).
  if (st.pending.work && fresh.length) {
    const due = dispatched(s, st, ctx, writes);
    if (due?.do === "think")
      return { ...due, think: { ...due.think, fresh: fresh.map((c) => c.id) } };
  }

  // Nothing new: a second job for one event, or a run asked for with nothing to do. A run that
  // ended before it finished waits for your `continue` (ADR 0040), never for the watch (ADR 0042).
  if (!first && !fresh.length && !edited && !starting) {
    return writes.length
      ? box(st, "its recipe kept in step", ...writes)
      : nothing("nothing new", st);
  }

  // `remember: …`, `forget: …` or `personality: …` as a task: the box writes the note, takes it off
  // its page or sets the Personality, with no agent. A guest's go on their own page (ADR 0078).
  const kind = s.parsed.kind;
  if ((kind === "remember" || kind === "forget" || kind === "personality") && first) {
    const line = s.parsed.ask.trim();
    // Your Personality's words whole: the message's, as a title holds only its first line.
    const said = withoutLine(s.issue.body).trim();
    const voice =
      kind === "personality"
        ? personalityWord(/^personality\s*:/i.test(said) ? said : s.issue.title)
        : undefined;
    if (!line || (kind === "personality" && !voice))
      return answered(
        kind === "remember"
          ? "a note with no words"
          : kind === "forget"
            ? "forget with no words"
            : "a Personality with no words it takes",
        reply(
          "needs-you",
          "Needs you",
          kind === "personality"
            ? `How should I talk to you? Write it after \`personality:\`: a preset (default, friendly, candid, efficient, quirky) or your own words, ${PERSONALITY_MAX.toLocaleString("en")} characters at most.`
            : `What should I ${kind}? Write it after \`${kind}:\`.`,
          `${kind}-empty`,
        ),
      );
    return answered(
      kind === "remember" ? "a note" : kind,
      noteWrite(
        voice
          ? { kind: "personality", set: voice }
          : kind === "forget"
            ? { kind, ask: line }
            : { kind: "remember", ask: line, ...(s.parsed.topic ? { topic: s.parsed.topic } : {}) },
        guestOf(s),
      ),
      reply("answer", "Done", "", kind, voice ? { undo: true } : {}),
      { w: "close", reason: "completed" },
    );
  }

  // Nothing to do yet: a first run with no words at all.
  const words0 = s.parsed.ask.replace(/^\s*[\w.-]+\s*:\s*$/, "").trim();
  if (first && !words0 && !fresh.length && !/\*\*Files:\*\*/.test(s.issue.body))
    return answered(
      "nothing to do yet",
      reply(
        "needs-you",
        "Needs you",
        "There's nothing to do yet: say what you want. Comment here, or reply to this message in the chat.",
        "empty",
      ),
    );

  // `again` on a repeat, a recipe's included: its job runs now (`continue` still retries a failure).
  const again = fresh.some((c) => /^\s*(run\s+)?again[.!]?\s*$/i.test(c.text));
  if (again && words.includes("continue") && st.repeat) {
    if (ctx.recipe && !("recipe" in ctx.recipe.read))
      return answered(
        "again on a recipe that doesn't read",
        reply(
          "answer",
          "Done",
          `\`recipes/${ctx.recipe.name}.md\` doesn't read, so it can't run: fix it in a PR first.`,
          `again-${fresh.at(-1)?.id}`,
        ),
      );
    st.seen = upTo(s, fresh);
    st.failed = undefined;
    return runRepeat(s, st, ctx, writes, `again-${fresh.at(-1)?.id ?? s.now}`);
  }

  // A part no run has started starts on the box's run or your `go` on it (ADR 0066). While it
  // waits, your other words (or an edit) get the box's answer, and its run reads them.
  const goHere = part !== undefined && words.includes("go");
  if (part?.length && !starting && !goHere)
    return answered(
      "words on a part that waits",
      reply("answer", "Waiting", waitingText(s, part), `part-waits-${fresh.at(-1)?.id ?? 0}`),
    );

  // The agent thinks: on a project's checkout (work), or reading every project (talk).
  const why: ThinkWhy =
    starting || goHere
      ? "sub-task"
      : words.includes("start over")
        ? "start-over"
        : words.includes("go")
          ? "go"
          : words.includes("continue")
            ? "continue"
            : first
              ? "new"
              : edited && !fresh.length
                ? "edited"
                : "comment";
  if (words.includes("go") && !goHere && !docMerged(st))
    return answered(
      "go before the doc merged",
      reply("answer", "Done", "Merge the change doc's PR first; then say `go`.", "go-early"),
    );
  if (why === "continue") {
    st.failed = undefined;
    // You checked what an earlier run left unfinished: it may run again.
    if (st.journal) st.journal = st.journal.filter((j) => j.done);
  }
  // Start over: a new branch from main; the open PRs are closed by the github job after this run.
  if (why === "start-over") {
    const open = (st.prs ?? []).filter((u) => (st.prInfo?.[u]?.state ?? "open") === "open");
    if (st.branch) st.branch = nextBranch(st.branch);
    if (open.length) st.pending.closePrs = open;
    st.notes = undefined;
  }
  const think = thinkFor(s, st, why, fresh);
  if (goHere && part?.length)
    think.notes.push(
      `${skipped(part)}: the owner's \`go\` here started it anyway. Say so in your reply.`,
    );
  if (starting && s.said.some((c) => isYou(c) && c.id <= s.state.seen))
    think.notes.push(
      "The owner wrote on this part before it started, and no agent has read those words: they are in the conversation, and are for this run too.",
    );
  // A merged plan whose build never started: the run that started it is one dispatch, which a
  // newer run of the task can replace (one waits per task, ADR 0040). This run starts it, once.
  if (st.plan && ctx.planMerged(st.plan) && st.built !== st.plan && st.prepared !== st.plan) {
    st.pending.prepare ??= { plan: st.plan, at: s.now };
    writes.push({ w: "dispatch", job: "github" });
    think.notes.push(
      `The plan ${st.plan} is merged, and its build starts after this run (its repo and keys first, then a build run): tell the owner so, and don't ask them to say \`go\` or \`publish\`.`,
    );
  }
  return {
    do: "think",
    think,
    state: withWriting(st, s),
    why: `think (${think.profile})`,
    ...(writes.length ? { writes } : {}),
  };
}

/** The status's `working` line, written first by the plan step: the watch reads it. */
const withWriting = (st: TaskState, s: Snapshot): TaskState => ({
  ...st,
  working: Number(s.run.id) > 0 ? Number(s.run.id) : undefined,
});

/** The watch's cursor (contracts/watch.ts): the newest comment read, and when it was written. */
export const cursorOf = (s: Snapshot, st: TaskState): TaskState["cursor"] => ({
  id: st.seen,
  at: s.said.find((c) => c.id === st.seen)?.at ?? s.now,
});

/** A 👍 on each of your comments: how a thanks is answered. */
const thumbsUp = (said: Said[]): Write[] =>
  said.map((c) => ({ w: "react", comment: c.id, content: "+1" }));

/** A question waits on you: the task needs you, with no PR to merge and no list for your `yes`. */
export const questionWaits = (st: TaskState) =>
  st.phase === "needs-you" &&
  !st.pending.calls &&
  !st.pending.notes &&
  !st.pending.split &&
  !st.pending.clean &&
  !(st.prs ?? []).some((u) => (st.prInfo?.[u]?.state ?? "open") === "open");

/** What a merged plan's build run is asked: the first one, and any after it until it's published. */
export const buildBrief = (plan: string) =>
  `Build the merged plan plans/${plan}.plan.md in your clone of the new repo: the box has laid the stack's files out there, so follow playbooks/build-app.md, then ask for a PR of kind publish.`;

/** Your accounts as the snapshot names them (ADR 0045); none off a box. */
const accountsOf = (s: Snapshot) => s.accounts ?? { own: "", listed: [] };

/** The account a repo's owner/name is on, as decide says it: another of yours, or undefined. */
const otherAccount = (s: Snapshot, repo: string) => {
  const owner = (repo.split("/")[0] ?? "").toLowerCase();
  return repo.includes("/") && accountsOf(s).listed.includes(owner) ? owner : undefined;
};

/** Where an account is named for the owner: another of theirs by its login, else Shipify's own. */
const accountName = (login: string | undefined) =>
  login ? `\`${login}\`` : "Shipify's own account";

/** One task, one account (ADR 0045): what's said when a name is on an account the task isn't. */
const elsewhere = (s: Snapshot, name: string, on: string | undefined) =>
  `\`${name}\` is on ${accountName(on)}, and this task works on ${accountName(s.account?.login)}: one task works on one account, so ask for it in a task of its own.`;

/** Why the repos App doesn't reach one of your accounts (ADR 0045), with the fix. */
const unreached = (s: Snapshot, login: string) => {
  const app = accountsOf(s).app;
  const why = s.account?.why;
  if (!app)
    return `The repos App isn't set up yet, so Shipify can't reach \`${login}\`: run \`pnpm ship bot repos\`, then \`pnpm ship bot repos ${login}\`, and ask again.`;
  const install = `https://github.com/apps/${app}/installations/new`;
  if (!why || why === "no-token")
    return `GitHub gave the repos App no token for \`${login}\`: it isn't installed there yet, an owner's approval is still pending, or the account's settings refuse it (an IP allow list). Install it there (${install}), then ask again. This run's step "A read-only token for plan on the task's other account" has GitHub's own words.`;
  if (why.startsWith("`")) return `${why}.`;
  return `GitHub refused the repos App on \`${login}\` (${why}). If the account has an IP allow list, the box's address needs to be on it, or its "allow GitHub Apps' IP lists" on; else install the App there again (${install}), then ask again.`;
};

/**
 * What a task's name stands for (ADR 0044, ADR 0045), wherever a run starts on it (your words, or
 * work a talk run found): a project, Shipify itself, a merged plan's new project before its first
 * push, another repo on Shipify's own account, or a repo on another of your accounts by its
 * owner/name, each changed its own way against its default branch. Matched whatever its case, and
 * named as the repos list names it. One task works on one account: a name on another is refused,
 * with how to ask. Undefined when it's none of these.
 */
export function named(
  s: Snapshot,
  st: TaskState,
  name: string,
): { project: string; ownRules?: true } | { refused: string } | undefined {
  const lower = name.toLowerCase();
  const here = s.account?.login;
  if (lower.includes("/")) return namedFull(s, st, name, lower);
  // A bare name is on Shipify's own account.
  const own = (): { project: string; ownRules?: true } | undefined => {
    if (lower === PLATFORM || lower === PLAYGROUND) return { project: lower };
    // A merged plan's new project: its repo is made empty (no shipify.json yet), and it's a project.
    if (st.built && lower === st.built.toLowerCase()) return { project: st.built };
    const project = s.projects.find((p) => p.toLowerCase() === lower);
    if (project) return { project };
    const repo = s.repos.find(
      (r) => !r.project && !r.name.includes("/") && r.name.toLowerCase() === lower,
    );
    return repo ? { project: repo.name, ownRules: true } : undefined;
  };
  const found = own();
  if (found && here) return { refused: elsewhere(s, name, undefined) };
  return found;
}

/** An owner/name: a repo on Shipify's own account, or on another of yours (ADR 0045). */
function namedFull(
  s: Snapshot,
  st: TaskState,
  name: string,
  lower: string,
): { project: string; ownRules?: true } | { refused: string } | undefined {
  const owner = lower.split("/")[0] ?? "";
  const here = s.account?.login;
  const repo = s.repos.find((r) => r.repo.toLowerCase() === lower);
  const other = otherAccount(s, lower);
  if (!other) {
    if (!repo) {
      // A repo GitHub has, on an account you haven't added: told how to add it. One it hasn't
      // (`CI/CD: …`, `UI/UX: …`) is only words.
      const seen = s.looked?.[lower];
      const own = accountsOf(s).own;
      return own && owner !== own && seen && "repo" in seen
        ? {
            refused: `\`${owner}\` isn't one of your accounts, so Shipify only reads its repos (\`look at ${name}\`). To change one, add the account first: \`pnpm ship bot repos ${owner}\`.`,
          }
        : undefined;
    }
    // A repo on Shipify's own account, by its full name: the same as by its own name (Shipify
    // itself, a project, or a repo that keeps its own rules).
    return named(s, st, repo.name);
  }
  if (other !== here) return { refused: elsewhere(s, name, other) };
  if (!s.account?.reached) return { refused: unreached(s, other) };
  if (!repo) {
    const app = accountsOf(s).app;
    return {
      refused: `The repos App doesn't reach \`${name}\` on \`${other}\`: add it to the App's repos there${app ? ` (https://github.com/apps/${app}/installations/new)` : ""}, then ask again.`,
    };
  }
  return { project: repo.name, ownRules: true };
}

/** Every word of the task that's yours: its title, its description and your messages. */
export const yourWords = (s: { issue: { title: string; body: string }; said: Said[] }) => [
  s.issue.title,
  s.issue.body,
  ...s.said.filter((c) => c.author === "owner" || c.author === "door").map((c) => c.text),
];

/**
 * The repos a task's words name with `look at` (ADR 0044), as its runs read them: yours (a project
 * or another of your repos, by its name or its owner/name) with the run's key, and anyone else's
 * public repo, as plan looked it up, with no key. A word that names no repo (a file's path, a plain
 * word, a repo GitHub doesn't have) is only a word; the notes say which, when it looked like one.
 */
export function readsOf(s: Snapshot): { reads: Read[]; notes: string[]; unsure: string[] } {
  const reads: Read[] = [];
  const notes: string[] = [];
  // Repos GitHub couldn't say anything about (not a 404): maybe someone else's, so unread, and the
  // run only reads, as for one that is.
  const unsure: string[] = [];
  const add = (r: Read) => {
    if (!reads.some((x) => x.repo.toLowerCase() === r.repo.toLowerCase())) reads.push(r);
  };
  const here = s.account?.login;
  // A repo on an account the task isn't on (ADR 0045): told, never read with another's key.
  const away = (ref: string, on: string | undefined) =>
    notes.push(`${elsewhere(s, ref, on)} Say so in your reply.`);
  for (const ref of [...new Set(yourWords(s).flatMap(looksAt))]) {
    const lower = ref.toLowerCase();
    const mine = ref.includes("/")
      ? s.repos.find((r) => r.repo.toLowerCase() === lower)
      : s.repos.find((r) => !r.name.includes("/") && r.name.toLowerCase() === lower);
    if (mine) {
      const on = otherAccount(s, mine.repo);
      if (on !== here) away(ref, on);
      else add({ name: mine.name, repo: mine.repo, mine: true, sizeKB: mine.sizeKB });
      continue;
    }
    if (!ref.includes("/")) continue;
    // One of your accounts, whose repo the repos App doesn't reach: told with the fix, not read as
    // someone else's.
    const other = otherAccount(s, lower);
    if (other) {
      if (other !== here) away(ref, other);
      else
        notes.push(
          `${s.account?.reached ? `The repos App doesn't reach \`${ref}\` on \`${other}\`: add it to the App's repos there.` : unreached(s, other)} Say so in your reply.`,
        );
      continue;
    }
    const seen = s.looked?.[lower];
    if (seen && "repo" in seen)
      add({ name: seen.repo, repo: seen.repo, mine: false, sizeKB: seen.sizeKB });
    else if (seen?.status === 404)
      notes.push(
        `\`${ref}\` after "look at" is no public repo on GitHub (none by that name, or one private to another account), so nothing was cloned for it: read it as plain words.`,
      );
    else if (seen) {
      unsure.push(ref);
      notes.push(
        `GitHub couldn't say whether \`${ref}\` is a repo (${seen.status ? `HTTP ${seen.status}` : "no answer"}), so it wasn't read, and this run only reads: tell the owner, and to ask again later.`,
      );
    }
  }
  return { reads, notes, unsure };
}

/**
 * A run's reads (ADR 0044): what the task's words look at, and the read profile when a repo isn't
 * yours. That run only reads and changes nothing, whatever started it. And where it works (ADR
 * 0045): its account, when it's another of yours, and its repo's default branch, when it isn't
 * `main`. Every think passes here, so each run gets them the same way.
 */
function withReads(s: Snapshot, t0: Think): Think {
  const repo = t0.ownRules && t0.project ? s.repos.find((r) => r.name === t0.project) : undefined;
  const t: Think = {
    ...t0,
    ...(s.account ? { account: s.account.login } : {}),
    ...(repo && repo.branch !== "main" ? { base: repo.branch } : {}),
  };
  const { reads, notes, unsure } = readsOf(s);
  const outside = [...reads.filter((r) => !r.mine).map((r) => r.repo), ...unsure];
  if (!outside.length)
    return reads.length || notes.length
      ? { ...t, ...(reads.length ? { reads } : {}), notes: [...t.notes, ...notes] }
      : t;
  const { project, ownRules, base, ...rest } = t;
  return {
    ...rest,
    profile: "read",
    ...(reads.length ? { reads } : {}),
    web: false,
    notes: [
      ...t.notes,
      ...notes,
      ...(t.profile === "work"
        ? [
            `This task's words look at a repo outside the owner's account (${outside.join(", ")}), so this run only reads, and changes nothing. Answer from reading; for the change, the owner asks in a new task${project ? ` (\`${project}: …\`)` : ""}, saying what to take from your answer.`,
          ]
        : []),
    ],
  };
}

/**
 * A guest run's answer (ADR 0071): words, a question, choices, files, its own project's pages, the
 * calls that fit a tool's guest forms (ADR 0073), and notes, lines to forget and a Personality for
 * their own memory page (ADR 0078). Anything else is dropped, and named in `left`.
 */
function guestsOnly<T extends Result>(r: T, left: string[], ctx: Context): T {
  const {
    pr,
    work,
    calls,
    split,
    first,
    repeat,
    quiet,
    ...kept
  }: T & Partial<Pick<Result, "pr" | "work" | "calls" | "split" | "first" | "repeat" | "quiet">> =
    r;
  const why = "a guest's run holds no key, tool or notebook";
  if (pr || work) left.push(`a change (${why}: it changes no repo)`);
  if (first) left.push(`a task first (${why}: it opens no task)`);
  // Their calls: only a guest form's, which the box makes with no key in their run (ADR 0073).
  const theirs = (calls ?? []).filter((c) => guestForm(ctx, c, calls ?? []));
  for (const c of (calls ?? []).filter((c) => !theirs.includes(c)))
    left.push(
      `${c.tool}.${c.name} (not a call a guest's run may ask for, or its arguments don't fit)`,
    );
  if (split?.length) left.push(`a split (${why}: it opens no task)`);
  if (repeat) left.push(`a repeat (${why}: it sets none)`);
  if (quiet) left.push("quiet (a guest's run always answers)");
  return (theirs.length ? { ...kept, calls: theirs } : kept) as T;
}

function thinkFor(s: Snapshot, st: TaskState, why: ThinkWhy, fresh: Said[]): Think {
  // A guest's task (ADR 0071) runs in the guest profile, whoever writes on it later: no project's
  // clone, no repo it reads, no account. A repo's name in its words is only words.
  if (guestOf(s))
    return { profile: "guest", why, notes: [], fresh: fresh.map((c) => c.id), web: true };
  const notes: string[] = [];
  const p = s.parsed;
  // A `new:` task plans in Shipify until its plan is built; from then on it works on the project.
  let project = st.project ?? (p.kind === "new" ? PLATFORM : p.project);
  // A merged plan's project before its first push: real, though GitHub doesn't list it yet.
  const unpublished =
    Boolean(project) && project === st.built && !s.projects.includes(project ?? "");
  const n = project ? named(s, st, project) : undefined;
  if (unpublished) notes.push(`The work: ${buildBrief(project as string)}`);
  else if (project && !n) {
    notes.push(
      `The title starts with “${project}:”, which is no project or repo here: read it as plain words, and ask which one if it matters.`,
    );
    project = undefined;
  } else if (n && "refused" in n) {
    notes.push(`${n.refused} Tell the owner so, and change nothing.`);
    project = undefined;
  } else if (n) project = n.project;
  const refused = n && "refused" in n ? n.refused : undefined;
  const work =
    Boolean(project) && (p.kind === "app" || p.kind === "new" || st.project !== undefined);
  return withReads(s, {
    profile: work ? "work" : "talk",
    ...(work && project ? { project } : {}),
    ...(work && n && "project" in n && n.ownRules ? { ownRules: true as const } : {}),
    why,
    notes,
    fresh: fresh.map((c) => c.id),
    web: true,
    ...(refused ? { refused } : {}),
  });
}

// ------------------------------------------------------------------------- pieces of plan

function githubJob(st: TaskState, ctx: Context): Plan {
  // A merged plan not built yet (its push to main): its repo and keys, once.
  if (!st.pending.prepare && st.plan && st.built !== st.plan && ctx.planMerged(st.plan))
    st.pending.prepare = { plan: st.plan, at: new Date().toISOString() };
  if (st.pending.prepare)
    return { do: "github", job: "prepare", state: st, why: "a merged plan's repo and keys" };
  if (st.pending.operate) return { do: "github", job: "operate", state: st, why: "an operation" };
  if (st.pending.closePrs?.length)
    return {
      do: "github",
      job: "close-prs",
      state: st,
      why: "PRs of a task closed as not planned",
    };
  if (st.pending.signIn)
    return { do: "github", job: "sign-in", state: st, why: "an agent's sign-in with a code" };
  return nothing("nothing pending for the github job", st);
}

/**
 * A deploy's end, told once: live (or on staging), failed, or never showed. A task still open when
 * its deploy is live in production (a new project's first, a release's) is done, and closes, as a
 * merge closes its own; on staging it stays open for its release. A run GitHub holds for your
 * approval is told once, and the deploy followed on from then, so "Live" still comes.
 */
function deployTold(
  st: TaskState,
  d: NonNullable<Context["deploy"]>,
  followed: NonNullable<TaskState["deploy"]>,
  why: string,
  writes: Write[],
  remove: string[],
  open = false,
  more = "",
): Plan {
  const sha = followed.sha;
  if (d.state === "held" && d.run) {
    st.deploy = { ...followed, held: d.run, since: new Date().toISOString() };
    const app = st.project ?? "the app";
    return box(
      st,
      `${why}: held by GitHub`,
      ...writes,
      { w: "labels", remove: remove.filter((l) => l !== "deploying"), add: ["deploying"] },
      reply(
        "needs-you",
        "Needs you",
        `GitHub holds the deploy of ${app}: it says its workflow file may be malicious, so it won't run until someone with write access approves it. Open the run, look at the workflow, and approve it. Then it deploys, and I say **Live** here.${more}`,
        "deploy-held",
        { links: [["The run", d.run]], occasion: sha },
      ),
    );
  }
  st.deploy = undefined;
  // Live in production ends the task; on staging, it waits for its release.
  const ends = open && d.state === "live" && !d.staging;
  if (ends) st.phase = "done";
  const app = st.project ?? "the app";
  const text =
    d.state === "live"
      ? `**${d.staging ? "On staging" : "Live"}:** ${app}${d.url ? ` at ${d.url}` : ""}.`
      : d.state === "failed"
        ? `The deploy of ${app} failed: production keeps its last good version.`
        : `The deploy of ${app} never showed up after ${GIVE_UP_MS / 60_000} minutes.`;
  const links: Link[] = [
    ...(d.url ? [["Open it", d.url] as Link] : []),
    ...(d.run ? [["The deploy run", d.run] as Link] : []),
  ];
  return box(
    st,
    why,
    ...writes,
    { w: "labels", remove },
    reply(
      d.state === "live" ? "live" : "failed",
      d.state === "live" ? (d.staging ? "On staging" : "Live") : "Failed",
      text + more,
      "deploy",
      { links, occasion: sha },
    ),
    ...(ends ? [{ w: "close" as const, reason: "completed" as const }] : []),
  );
}

/**
 * A close, handled once; a part's (ADR 0066) also starts what waited for it, or tells its parent,
 * in this same run, with no agent.
 */
function closedPlan(s: Snapshot, st: TaskState, ctx: Context): Plan {
  const handled = st.phase === "done" || st.phase === "dropped";
  const p = closing(s, st, ctx);
  if (handled || !isPart(s)) return p;
  const more = partClosed(s, {
    reason: droppedBy(s.issue.stateReason) ? "not_planned" : "completed",
    ...(ctx.mergedPr ? { pr: ctx.mergedPr.url } : {}),
  });
  if (!more.length) return p;
  if (p.do === "box") return { ...p, writes: [...p.writes, ...more] };
  if (p.do === "think") return { ...p, writes: [...(p.writes ?? []), ...more] };
  if (p.do === "nothing") return box(p.state ?? st, "a part closed", ...more);
  return p;
}

function closing(s: Snapshot, st: TaskState, ctx: Context): Plan {
  const notPlanned = droppedBy(s.issue.stateReason);
  st.working = undefined;
  dropList(st);
  st.pending.work = undefined;
  // A close already handled leaves an errand as it was: one a merge kept waits on (ADR 0054).
  const handled = st.phase === "done" || st.phase === "dropped";
  const off = handled ? [] : closeRepeat(st, Boolean(ctx.merged || ctx.mergedPr) && !notPlanned);
  // Closed by the door as it wrote your `close` (ADR 0031): what the word does, quietly, since the
  // chat already said "Closed". Read once, it isn't new when you write again.
  const fresh = freshOf(s);
  const at = Date.parse(s.issue.closedAt ?? "") || 0;
  const last = fresh.at(-1);
  if (
    last &&
    wordOf(last.text) === "close" &&
    Math.abs(Date.parse(last.at) - at) <= AFTER_CLOSE_MS &&
    st.phase !== "dropped"
  ) {
    return box(st, "closed by its `close`", ...off, ...closeWord(s, st, fresh), {
      w: "coming-up",
    });
  }
  if (handled) return nothing("closed already", st);
  if (notPlanned) {
    const open = (st.prs ?? []).filter(
      (u) => st.prInfo?.[u]?.state !== "merged" && st.prInfo?.[u]?.state !== "closed",
    );
    st.phase = "dropped";
    if (open.length) {
      st.pending.closePrs = open;
      return box(st, "closed as not planned", ...off, { w: "dispatch", job: "github" });
    }
    return box(st, "closed as not planned", ...off);
  }
  st.phase = "done";
  // Your words from before the merge that no run read (it came first): said with it, so none is
  // left unseen; words written now carry the task on with them (plan).
  const closed = Date.parse(s.issue.closedAt ?? "") || 0;
  const unread = freshOf(s).filter(
    (c) => Date.parse(c.at) < closed - AFTER_CLOSE_MS && !acknowledgement(c.text),
  );
  const told = unread.length
    ? `\n\n${unread.length === 1 ? "A message of yours" : `${unread.length} of your messages`} came in before the merge, and no run read ${unread.length === 1 ? "it" : "them"}. Write here again and the task carries on with ${unread.length === 1 ? "it" : "them"}.`
    : "";
  // A merged PR's deploy, followed to the end by this run (runPlan): told now. A PR opened outside
  // a run names its project only here.
  if (ctx.merged) st.project = ctx.merged.app;
  if (ctx.merged) {
    const d =
      ctx.deploy && ctx.deploy.state !== "waiting" ? ctx.deploy : { state: "gone" as const };
    return errandOnMerge(
      s,
      st,
      ctx,
      deployTold(st, d, ctx.merged, "closed by its merge", [], GONE, false, told),
      // Held for your approval: an errand waits on, as the deploy is followed on.
      d.state === "held" ? undefined : d,
    );
  }
  // Merged with nothing to deploy (Shipify itself, a package, a recipe): said once, now. A change
  // doc's merge closes the task too (its PR may say "Closes"), so it names the word that builds it.
  if (ctx.mergedPr) {
    const doc =
      st.prInfo?.[ctx.mergedPr.url]?.kind === "change"
        ? "\n\nSay `go` here to build it: the task opens again for it."
        : "";
    return errandOnMerge(
      s,
      st,
      ctx,
      box(
        st,
        "closed by its merge",
        reply("live", "Merged", `**Merged:** ${ctx.mergedPr.title}.${doc}${told}`, "merged", {
          links: [["The PR", ctx.mergedPr.url]],
          occasion: ctx.mergedPr.url,
        }),
      ),
    );
  }
  return box(st, "closed", ...off);
}

/**
 * The merge of the task's own PR, when an errand waits for it (ADR 0054 §3): fired in the close's
 * own run, after its Merged or its deploy's end, with no due run. The task stays closed. One that
 * waits for a deploy where no app deploys (Shipify itself) is looked at from now on; any other
 * errand waits on as it was.
 */
function errandOnMerge(
  s: Snapshot,
  st: TaskState,
  ctx: Context,
  closing: Plan,
  deploy?: NonNullable<Context["deploy"]>,
): Plan {
  const on = st.repeat?.on;
  const url = on && errandPrUrl(on);
  if (!on || !url || on.what === "checks" || closing.do !== "box") return closing;
  const merged = ctx.mergedPr
    ? ctx.mergedPr.url.toLowerCase() === url.toLowerCase()
    : st.prs.some((u) => u.toLowerCase() === url.toLowerCase()) &&
      on.repo.toLowerCase() === ctx.merged?.repo.toLowerCase();
  if (!merged) return closing;
  const name = errandName(on);
  if (on.what === "deployed" && !deploy) {
    (st.repeat as NonNullable<TaskState["repeat"]>).next = nextLook(
      on,
      new Date(s.now),
    ).toISOString();
    return { ...closing, writes: [...closing.writes, { w: "coming-up" }] };
  }
  const said =
    on.what === "merged"
      ? `${name} was merged`
      : deploy?.state === "live"
        ? `${name} is deployed: ${deploy.staging ? "on staging" : "live"}`
        : deploy?.state === "failed"
          ? `${name}'s deploy failed`
          : `${name}'s deploy never showed up`;
  return fireErrand(s, st, ctx, [...closing.writes], {
    state: "done",
    said,
    links: [["The PR", url], ...(deploy?.run ? [["The deploy run", deploy.run] as Link] : [])],
  });
}

/** What an operation does to the live app, as its list says it before your yes. */
function operationLine(op: Op, project: string, version?: string): string {
  if (op === "down")
    return `Take ${project} down: its URLs go off, and CI checks every change but deploys none. Nothing is deleted, and \`${project}: bring it back\` undoes it.`;
  if (op === "up")
    return `Bring ${project} back: its URLs come back on now, and deploys start again with the next merge.`;
  return `Roll ${project}'s production back to ${version ?? "the release before"}.`;
}

/**
 * An operation from a chat that changes the live app at once (ADR 0049, 2026-11-11): listed for
 * your yes, as calls are, so a word misread or a tap by mistake runs nothing.
 */
function listOperation(s: Snapshot, st: TaskState, fresh: Said[], writes: Write[], op: Op): Plan {
  const p = s.parsed;
  st.seen = upTo(s, fresh);
  st.bodyHash = s.bodyHash;
  dropList(st);
  st.project = p.project;
  st.pending.atOnce = { op, ...(p.version ? { version: p.version } : {}) };
  st.pending.list = { post: 0, at: s.now };
  st.phase = "needs-you";
  st.closes = undefined;
  const text = [
    `\`${p.project}: ${p.ask}\` changes the live app at once, with no merge, so it runs only after your \`yes\`.`,
    "",
    `${LIST_HEAD} (tap Yes, or say \`yes\`, within a day):`,
    `1. ${operationLine(op, p.project ?? "", p.version)}`,
  ].join("\n");
  return box(
    st,
    "an operation from a chat",
    ...writes,
    reply("needs-you", "Needs you", text, `op-list-${fresh.at(-1)?.id ?? 0}`, {
      list: listCode([], [], [], [], heldKinds(st.pending, st.project)),
    }),
  );
}

function opPlan(
  s: Snapshot,
  st: TaskState,
  fresh: Said[],
  first: boolean,
  ctx: Context,
  writes: Write[],
): Plan {
  const p = s.parsed;
  // A release starts from GitHub or a chat alike (one flow, ADR 0049): it opens a PR that only
  // your merge deploys. Taking an app down, bringing it back and a rollback change the live app at
  // once: on GitHub they run at once; from a chat (a new chat, or its `continue`), only after your
  // `yes` to them as a list (ADR 0049, 2026-11-11). A guest's title is never an operation.
  const atOnce = p.op !== undefined && AT_ONCE.includes(p.op);
  const fromChat = atOnce && s.issue.author === "door";
  const yesOrNoOnly = fresh.every((c) => wordOf(c.text) === "yes" || wordOf(c.text) === "no");
  if (st.pending.atOnce && fresh.length) {
    if (yesOrNoOnly) return yesOrNo(s, st, fresh, ctx, writes);
    dropList(st);
  }
  const again = (c: Said) => wordOf(c.text) === "continue";
  const githubAgain = fresh.some((c) => viaGithub(c) && again(c));
  if (atOnce && p.op && ((fromChat && first) || (!githubAgain && fresh.some(again))))
    return listOperation(s, st, fresh, writes, p.op);
  if (
    (first && !fromChat) ||
    githubAgain ||
    (!atOnce && fresh.some(again)) ||
    (s.trigger.kind === "dispatch" && s.trigger.job === "run" && !fresh.length && !fromChat)
  ) {
    if (!p.op) return nothing("an operation with no action");
    st.seen = upTo(s, fresh);
    st.project = p.project;
    st.pending.operate = {
      op: p.op,
      ...(p.version ? { version: p.version } : {}),
      ...(p.bump ? { bump: p.bump } : {}),
      at: s.now,
    };
    return box(
      st,
      "an operation",
      ...writes,
      { w: "dispatch", job: "github" },
      reply("answer", "Working", `Running ${p.op} for ${p.project} on GitHub's machines.`, "op"),
    );
  }
  if (!fresh.length) return nothing("nothing new", st);
  st.seen = upTo(s, fresh);
  return box(
    st,
    "a comment on an operation",
    ...writes,
    reply(
      "answer",
      "Done",
      "This task runs by itself, with no agent. Say `continue` (or `again`) to run it again, or open a new task for anything else.",
      "op-comment",
    ),
  );
}

function repeatFromForm(s: Snapshot, st: TaskState, ctx: Context, writes: Write[]): Plan {
  const f = s.repeatForm as NonNullable<Snapshot["repeatForm"]>;
  const set = setRepeat(
    st,
    { when: f.when, kind: f.kind === "agent" ? "job" : f.kind, text: f.what, check: f.check },
    s.now,
    ctx.timeZone,
    whereOf(s, st, ctx),
    s.issue.labels,
  );
  st.seen = Math.max(st.seen, ...s.said.map((c) => c.id));
  return box(
    st,
    "the Repeat form",
    ...writes,
    ...set.labels,
    { w: "coming-up" },
    reply(
      set.ok ? "answer" : "needs-you",
      set.ok ? "Repeating" : "Needs you",
      set.line,
      "repeat-form",
    ),
  );
}

/**
 * Where an errand's words are read (ADR 0054): your account (Shipify's own), the task's repo (its
 * project's, else Shipify's), the repos it can name, and its PRs.
 */
function whereOf(s: Snapshot, st: TaskState, ctx: Context): ErrandWhere {
  const platform = /github\.com\/([^/]+\/[^/]+)\/issues\//.exec(ctx.taskUrl)?.[1] ?? "";
  const repos = s.repos.map((r) => ({ name: r.name, repo: r.repo }));
  const project = st.project ? repos.find((r) => r.name === st.project)?.repo : undefined;
  return {
    own: s.accounts?.own ?? platform.split("/")[0] ?? "",
    repo: project ?? platform,
    repos,
    prs: st.prs ?? [],
  };
}

/** A repeat set or changed from the words or a form: its schedule read, its next time worked out. */
export function setRepeat(
  st: TaskState,
  r: {
    when: string;
    kind: "reminder" | "job" | "check";
    text?: string;
    check?: string;
    onChange?: "reply" | "think";
  },
  now: string,
  timeZone: string,
  where?: ErrandWhere,
  /** The task's labels now. */
  has: string[] = [],
): { ok: boolean; line: string; labels: Write[] } {
  const kind = r.kind === "job" ? "agent" : r.kind;
  const when = readWhen(r.when, kind, new Date(now), timeZone, where);
  if ("problem" in when) return { ok: false, line: when.problem, labels: [] };
  if (kind === "check" && !r.check)
    return { ok: false, line: "A check needs its script's name: `checks/<name>.mjs`.", labels: [] };
  // One time per task, and never on one that repeats: it would end that repeat as it fired.
  if (when.every === ONCE && st.repeat && !isOnce(st.repeat))
    return {
      ok: false,
      line: `This task repeats already (${st.repeat.every}), so it takes no time once: ask on a task of its own, or say \`stop repeating\` first.`,
      labels: [],
    };
  const was = st.repeat && labelOf(st.repeat).name;
  const next = when.next.toISOString();
  st.repeat = {
    kind,
    every: when.every,
    ...(r.text ? { text: r.text } : {}),
    ...(r.check ? { check: r.check } : {}),
    ...(r.onChange ? { onChange: r.onChange } : {}),
    next,
    fails: 0,
    ...(when.on ? { on: when.on } : {}),
  };
  st.phase = "repeating";
  // The due run finds it by its label, whatever the task's phase (`taskDue`): one, and the other
  // off when the task has it (the last repeat's, or the Repeat form's own `repeats`).
  const label = labelOf(st.repeat).name;
  const other = [REPEATS_LABEL.name, WAITING_LABEL.name].find((l) => l !== label) as string;
  const off = was === other || has.includes(other);
  const labels: Write[] = [{ w: "labels", add: [label], ...(off ? { remove: [other] } : {}) }];
  if (when.on)
    return {
      ok: true,
      line: `Set: waiting for ${errandWaits(when.on)}, until ${formatWhen(when.on.until, timeZone, true)}. Then it tells you once and ends; \`stop repeating\` cancels it.`,
      labels,
    };
  if (isOnce(st.repeat))
    return {
      ok: true,
      line: `Set: once, at ${formatWhen(next, timeZone, true)} (within about 5 minutes of it). Then it ends; \`stop repeating\` cancels it.`,
      labels,
    };
  return {
    ok: true,
    line: `Set: ${st.repeat.every}. Next: ${formatWhen(next, timeZone, true)}. Say \`stop repeating\` to end it.`,
    labels,
  };
}

function repeatWords(
  s: Snapshot,
  st: TaskState,
  words: Word[],
  fresh: Said[],
  writes: Write[],
): Plan {
  st.seen = upTo(s, fresh);
  const r = st.repeat as NonNullable<TaskState["repeat"]>;
  if (words.at(-1) === "stop repeating") {
    st.repeat = undefined;
    st.phase = "done";
    return box(
      st,
      "stop repeating",
      ...byButton(s, st, Boolean(fresh.at(-1)?.from?.button), [
        ...writes,
        { w: "coming-up" },
        // Its label goes, so it leaves every list of repeats; closing alone only pauses one.
        { w: "labels", remove: [labelOf(r).name] },
        reply(
          "answer",
          "Done",
          isOnce(r) ? "Cancelled: it won't run." : "Stopped: it won't repeat again.",
          "stop",
        ),
        { w: "close", reason: "completed" },
      ]),
    );
  }
  r.paused = false;
  r.fails = 0;
  st.phase = "repeating";
  return box(
    st,
    "resume",
    ...writes,
    { w: "coming-up" },
    reply("answer", "Repeating", `Resumed: ${r.every}.`, "resume"),
  );
}

function yesOrNo(s: Snapshot, st: TaskState, said: Said[], ctx: Context, writes: Write[]): Plan {
  const fresh = freshOf(s);
  st.seen = upTo(s, fresh);
  /** The box's answer: what `writes` holds, then `more`. */
  const told = (why: string, ...more: Write[]) => box(st, why, ...writes, ...more);
  const pend = st.pending.calls;
  // A Yes or No under an older reply names another list: it counts for nothing, and the newest of
  // the rest decides.
  const code = listCode(
    pend?.calls,
    st.pending.notes,
    st.pending.split,
    st.pending.clean,
    heldKinds(st.pending, st.project),
  );
  const last = said.filter((c) => (listCodeOf(c.text) ?? code) === code).at(-1);
  if (!last) {
    const p = problem("list-gone");
    return told(
      "a yes for another list",
      reply("answer", "Done", renderProblem(p), `yes-gone-${said.at(-1)?.id}`, { problem: p }),
    );
  }
  const word = wordOf(last.text);
  if (word === "no") {
    dropList(st);
    st.phase = "answered";
    st.closes = quietDay(s);
    return told("no", reply("answer", "Done", "Dropped: nothing was changed.", `no-${last.id}`));
  }
  // A yes counts from you, on GitHub or through your chat (ADR 0049): whole and unedited, after the
  // list, within a day, with no edit to the task since the list. A chat approves only a list it
  // can show whole.
  const cleanLong = cleanLines(st.pending.clean ?? []).join("\n").length > LIST_MAX;
  if (
    !viaGithub(last) &&
    (cleanLong ||
      listTooLong(ctx.tools, pend?.calls, st.pending.notes, st.pending.split, heldListLines(st)))
  ) {
    const p = problem("list-too-long");
    return told(
      "a yes from a chat to a long list",
      reply("answer", "Done", renderProblem(p), `yes-long-${last.id}`, {
        links: [["The task on GitHub", ctx.taskUrl]],
        problem: p,
      }),
    );
  }
  if (last.edited)
    return told(
      "an edited yes",
      reply(
        "answer",
        "Done",
        "That `yes` was edited after it was written, so it doesn't count. Tap Yes, or write a new `yes`, to approve the list.",
        `yes-edited-${last.id}`,
      ),
    );
  // A yes counts only after the reply that asked: one written while the run was still thinking
  // never saw the list.
  const list = st.pending.list;
  const asked = list?.post || s.state.reply || 0;
  if (last.id < asked)
    return told(
      "a yes before the list",
      reply(
        "answer",
        "Done",
        "That `yes` came before the list it would approve. Read the list above, then tap Yes or write a new `yes`.",
        `yes-early-${last.id}`,
      ),
    );
  if (list && Date.parse(s.now) - Date.parse(list.at) > CALLS_GOOD_FOR_MS) {
    dropList(st);
    const p = problem("approval-expired");
    return told(
      "an expired yes",
      reply("answer", "Done", renderProblem(p), `yes-late-${last.id}`, { problem: p }),
    );
  }
  // A clean start (ADR 0070): its chats read again as you say yes; one that changed since the list
  // (a word, a label), or that something keeps open now, stays open. Unread, nothing closes, and
  // the list stays for another yes.
  const clean = st.pending.clean;
  if (clean && !s.cleanable)
    return told(
      "a yes to a clean start, unread",
      reply(
        "answer",
        "Done",
        "The chats couldn't be read again, so none was closed: tap Yes again in a minute.",
        `yes-clean-${last.id}`,
      ),
    );
  if (clean) {
    const since = Date.parse(list?.at ?? s.now);
    const now = new Map((s.cleanable ?? []).map((c) => [c.n, c]));
    const shut = clean.flatMap((c) => {
      const there = now.get(c.n);
      return there && !(there.updatedAt && Date.parse(there.updatedAt) > since)
        ? [{ number: c.n, labels: there.labels }]
        : [];
    });
    const kept = clean.filter((c) => !shut.some((x) => x.number === c.n)).map((c) => `#${c.n}`);
    dropList(st);
    st.phase = "answered";
    st.closes = quietDay(s);
    return told(
      "yes to a clean start",
      ...(shut.length ? [{ w: "close-chats", chats: shut } as const] : []),
      reply(
        "answer",
        "Done",
        kept.length
          ? `Left open, as they changed since the list or something keeps them open now: ${kept.join(", ")}.`
          : "",
        `yes-${last.id}`,
      ),
    );
  }
  // An operation from a chat (ADR 0049, 2026-11-11): the github job runs it once, as from GitHub.
  const atOnce = st.pending.atOnce;
  if (atOnce) {
    dropList(st);
    st.phase = "working";
    st.pending.operate = { ...atOnce, at: s.now };
    return told(
      "yes to an operation",
      { w: "dispatch", job: "github" },
      reply(
        "answer",
        "Working",
        `Running ${atOnce.op} for ${st.project} on GitHub's machines.`,
        "op",
      ),
    );
  }
  const out: Write[] = [...writes];
  if (st.pending.notes?.length) for (const n of st.pending.notes) out.push(noteOfList(n));
  if (pend) out.push({ w: "calls", calls: pend.calls, fingerprint: pend.fingerprint });
  // A held workflow change (ADR 0075 §5.5): exactly its patch, pushed by apply with workflows write.
  if (st.pending.workflow) out.push({ w: "workflow", change: st.pending.workflow, code });
  // A task first (ADR 0075 §6), with the words you approved: opened, linked and started. This task
  // waits for it, and goes on with your `continue`.
  const first = st.pending.first;
  if (first) out.push({ w: "first", ...firstPart(s, first, st.use) });
  // A split's parts (ADR 0066), opened with the words you approved; nothing starts. The task then
  // waits for your `go`, never closed for quiet.
  const split = st.pending.split;
  dropList(st);
  if (first) {
    st.phase = "needs-you";
    st.closes = undefined;
    out.push(reply("needs-you", "Needs you", "", `yes-${last.id}`));
    return box(st, "yes to a task first", ...out);
  }
  if (split) {
    const parts = partsOf(s, split, st.use);
    if ("wrong" in parts)
      return told(
        "a split that no longer fits",
        reply(
          "answer",
          "Done",
          `Nothing was opened: ${parts.wrong}, as the task's parts stand now. Say what you'd like, and the next run lists the split again.`,
          `yes-split-${last.id}`,
        ),
      );
    out.push({ w: "split", parts: parts.parts });
    st.phase = "needs-you";
    st.closes = undefined;
    out.push(reply("needs-you", "Needs you", "", `yes-${last.id}`));
    return box(st, "yes to a split", ...out);
  }
  // A workflow change pushed to a PR: the PR waits for your merge.
  const pr = out.some((w) => w.w === "workflow");
  st.phase = pr ? "needs-you" : "answered";
  st.closes = pr ? undefined : quietDay(s);
  out.push(reply(pr ? "needs-you" : "answer", pr ? "Needs you" : "Done", "", `yes-${last.id}`));
  return box(st, "yes", ...out);
}

function dispatched(s: Snapshot, st: TaskState, ctx: Context, writes: Write[]): Plan | undefined {
  // Work a talk run found for a project or another of your repos, on what that name stands for.
  if (st.pending.work) {
    const w = st.pending.work;
    st.pending.work = undefined;
    const n = named(s, st, w.project);
    if (!n || "refused" in n)
      return box(
        st,
        "work on no project or repo",
        ...writes,
        reply(
          "failed",
          "Failed",
          n ? n.refused : `“${w.project}” is no project or repo here, so no change was started.`,
          "work-refused",
        ),
      );
    st.project = n.project;
    st.ownRules = n.ownRules;
    const think = withReads(s, {
      profile: "work",
      project: n.project,
      ...(n.ownRules ? { ownRules: true as const } : {}),
      why: "work",
      notes: [`The work: ${w.brief}`],
      fresh: [],
      web: true,
    });
    return { do: "think", think, state: withWriting(st, s), why: "work for a project" };
  }
  // A release PR: merged, its production deploy is followed; closed unmerged, said once.
  if (
    st.pending.release &&
    ctx.release &&
    ctx.release.state !== "open" &&
    ctx.release.state !== "unknown"
  ) {
    const rel = st.pending.release;
    st.pending.release = undefined;
    if (ctx.release.state === "merged" && ctx.release.sha) {
      st.deploy = {
        repo: rel.repo,
        sha: ctx.release.sha,
        ...(ctx.release.url ? { url: ctx.release.url } : {}),
        staging: false,
        production: true,
        since: s.now,
      };
      return box(st, "a release merged");
    }
    return box(
      st,
      "a release closed",
      ...writes,
      { w: "labels", remove: ["deploying"] },
      reply(
        "answer",
        "Done",
        "The release PR was closed without merging: production keeps its version.",
        "release-closed",
      ),
    );
  }
  // A deploy the watch followed (a release, a new project's first push), told once it ended. A
  // part it closes starts what waited for it here: the box's own close starts no close run.
  if (st.deploy && ctx.deploy && ctx.deploy.state !== "waiting") {
    const told = deployTold(
      st,
      ctx.deploy,
      st.deploy,
      "a deploy",
      writes,
      ["deploying"],
      s.issue.state === "open",
    );
    return told.do === "box" && told.writes.some((w) => w.w === "close")
      ? { ...told, writes: [...told.writes, ...partClosed(s, { reason: "completed" })] }
      : told;
  }
  // An answered part quiet for a day is the due run's to close (ADR 0040), with no run of its own.
  return repeatTime(s, st, ctx, writes);
}

/** A repeat whose time has come: its next time saved, and its job run now. */
function repeatTime(s: Snapshot, st: TaskState, ctx: Context, writes: Write[]): Plan | undefined {
  const r = st.repeat;
  if (!r || r.paused || Date.parse(r.next) > Date.parse(s.now)) return undefined;
  if (r.on) return errandTime(s, st, ctx, writes);
  const occasion = r.next;
  const schedule = parseSchedule(r.every);
  // The next time is saved before the reply, so a second job for the same time does nothing.
  if (schedule) r.next = nextRun(schedule, new Date(s.now), ctx.timeZone).toISOString();
  r.last = s.now;
  // A repeat that comes due while its PR waits for you is skipped this time; a time once never is,
  // as looking at that PR is often what it's for.
  if (!isOnce(r) && openPr(st)) return box(st, "a repeat with a PR waiting", { w: "coming-up" });
  return runRepeat(s, st, ctx, writes, occasion);
}

/**
 * An errand's look has come (ADR 0054): what the snapshot read now decides. Not yet, it waits for its
 * next look, with nothing told; a read that fails three times in a row ends it, as its time does,
 * said with no agent. Done, it fires once.
 */
function errandTime(s: Snapshot, st: TaskState, ctx: Context, writes: Write[]): Plan {
  const r = st.repeat as NonNullable<TaskState["repeat"]>;
  const on = r.on as NonNullable<typeof r.on>;
  const now = new Date(s.now);
  const seen: ErrandSeen = ctx.errand ?? { state: "unreadable" };
  const ends = Date.parse(on.until) <= now.getTime();
  if (seen.state === "unreadable") on.misses = (on.misses ?? 0) + 1;
  else on.misses = undefined;
  if (seen.state === "done") return fireErrand(s, st, ctx, writes, seen);
  if (!ends && (seen.state === "waiting" || (on.misses ?? 0) < 3)) {
    r.next = nextLook(on, now).toISOString();
    return box(st, "an errand not done yet", ...writes, { w: "coming-up" });
  }
  const at = `Stopped waiting at ${formatWhen(on.until, ctx.timeZone, true)}`;
  const why =
    seen.state === "waiting"
      ? `${at}: ${seen.said}.`
      : (on.misses ?? 0) >= 3
        ? `Stopped waiting: ${errandName(on)} couldn't be read 3 times in a row (deleted, or its repo gone or private to Shipify's key).`
        : `${at}: ${errandName(on)} couldn't be read.`;
  const url = errandPrUrl(on);
  // Its job was asked for once the thing happened: an end with nothing happened is said, no agent.
  return fireErrand(
    s,
    st,
    ctx,
    writes,
    { state: "done", said: why, links: url ? [["The PR", url]] : [] },
    true,
  );
}

/**
 * An errand fires once: a reminder's words with what happened, with no agent; a job's run with it
 * (runRepeat ends it either way). `told`: only what happened is said, with no agent.
 */
function fireErrand(
  s: Snapshot,
  st: TaskState,
  ctx: Context,
  writes: Write[],
  seen: Extract<ErrandSeen, { state: "done" }>,
  told = false,
): Plan {
  const r = st.repeat as NonNullable<TaskState["repeat"]>;
  const at = seen.at ? ` (at ${formatWhen(seen.at, ctx.timeZone, true)})` : "";
  const said = told ? seen.said : `**${seen.said}**${at}.`;
  return runRepeat(s, st, ctx, writes, `errand-${r.on?.since ?? s.now}`, {
    said,
    links: seen.links,
    ...(told ? { told } : {}),
  });
}

/** A job once's line for the agent: the owner asked to be told, so it always says what it found. */
const ONCE_NOTE =
  "This is a check-back the owner asked for, once: do it now and say what you found, even when it's that nothing changed (never `quiet`). It ends after this run: set no new `repeat` unless the owner's words ask for one.";

/** An errand's job's line for the agent (ADR 0054): what happened, and what it may do about it. */
const errandNote = (said: string) =>
  `This is an errand the owner asked for, once, and what it waited for has happened: ${said} Do what the task's words ask about it now, and say what you found (never \`quiet\`). Change or fix something (\`work\`) only when the owner's words said to; merging stays the owner's. It ends after this run: set no new \`repeat\` unless the owner's words ask for one.`;

/** Said once, as a repeat's third failure in a row pauses it (docs/tasks.md, "Repeats"). */
const PAUSED = "Paused after three failures in a row: `resume` starts it again.";

/**
 * A repeat's run that failed (its check's script, its job's own `failed`, or a result that doesn't
 * read): one more in a row, and the third pauses it. The line its reply adds as it pauses.
 */
function failedInARow(st: TaskState, think: Think): string | undefined {
  const r = st.repeat;
  if (!r || think.why !== "scheduled") return undefined;
  r.fails = (r.fails ?? 0) + 1;
  if (r.paused || r.fails < 3) return undefined;
  r.paused = true;
  return PAUSED;
}

/**
 * A repeat's job, now: at its time, or on `again`. A reminder's words with no agent; a job's think;
 * a check's script, then the agent when the repeat thinks on a change (a recipe with a check); a
 * recipe's body, read from main, as the job.
 */
function runRepeat(
  s: Snapshot,
  st: TaskState,
  ctx: Context,
  writes: Write[],
  occasion: string,
  /** An errand's: what happened, its links, and whether only that is said (ADR 0054). */
  errand?: { said: string; links: [string, string][]; told?: boolean },
): Plan {
  const r = st.repeat as NonNullable<TaskState["repeat"]>;
  r.last = s.now;
  // A time once ends as it fires: off the task and its label as this run starts, so nothing rings
  // it again, even when the run stops before its answer.
  if (isOnce(r)) {
    st.repeat = undefined;
    writes.push({ w: "labels", remove: [labelOf(r).name] });
  }
  // A reminder needs nothing that can fail: once it's said, a failed task is repeating again, and
  // one said once is answered (a closed one stays done). An errand's says what happened first.
  if (r.kind === "reminder" || errand?.told) {
    if (st.phase === "failed" || (!st.repeat && st.phase === "repeating")) {
      st.phase = st.repeat ? "repeating" : "answered";
      st.closes = st.repeat ? undefined : quietDay(s);
    }
    st.failed = undefined;
    const text = errand
      ? [errand.said, errand.told ? "" : (r.text ?? "")].filter(Boolean).join("\n\n")
      : (r.text ?? s.issue.title);
    return box(
      st,
      errand ? "an errand" : "a reminder",
      ...writes,
      { w: "coming-up" },
      reply("answer", REMINDER, text, "reminder", {
        occasion,
        ...(errand?.links.length ? { links: errand.links } : {}),
      }),
    );
  }
  const recipe = ctx.recipe && "recipe" in ctx.recipe.read ? ctx.recipe.read.recipe : undefined;
  // A repeat on a task that reads a repo outside your account runs in the read profile too.
  const think = withReads(s, {
    profile: "talk",
    why: "scheduled",
    notes: st.repeat ? [] : [errand ? errandNote(errand.said) : ONCE_NOTE],
    fresh: [],
    web: true,
    occasion,
    ...(r.kind === "check" && r.check ? { check: r.check } : {}),
    ...(r.kind === "check" && r.onChange === "think"
      ? { thenAsk: r.value ? { was: r.value } : {} }
      : {}),
    ...(recipe ? { recipe: { name: recipe.name, body: recipe.body } } : {}),
  });
  return {
    do: "think",
    think,
    state: withWriting(st, s),
    why: r.kind === "check" ? "a check" : "a repeat's job",
    ...(writes.length ? { writes } : {}),
  };
}

/**
 * A recipe's task, kept in step with its file on main (ADR 0032): set or updated when the file is
 * new or changed, paused while it doesn't read, ended when it's removed. Undefined when it's in step.
 */
function recipeInStep(s: Snapshot, st: TaskState, ctx: Context, writes: Write[]): Plan | undefined {
  const rc = ctx.recipe;
  if (!rc) return undefined;
  const file = `\`recipes/${rc.name}.md\``;
  const fresh = freshOf(s);
  if ("gone" in rc.read) {
    st.seen = upTo(s, fresh);
    st.repeat = undefined;
    st.recipe = undefined;
    st.phase = "done";
    return box(
      st,
      "its recipe was removed",
      ...writes,
      { w: "labels", remove: [REPEATS_LABEL.name] },
      { w: "coming-up" },
      reply(
        "answer",
        "Done",
        `${file} was removed from main, so this recipe has ended.`,
        "recipe-gone",
      ),
      { w: "close", reason: "completed" },
    );
  }
  if ("problem" in rc.read) {
    // Said once per breakage; a comment meanwhile is still answered.
    if (st.recipe?.hash === "broken") return undefined;
    if (st.repeat) st.repeat.paused = true;
    st.recipe = { name: rc.name, hash: "broken" };
    writes.push(
      { w: "coming-up" },
      reply(
        "needs-you",
        "Needs you",
        `${file} doesn't read: ${rc.read.problem}. Fix it in a PR; until then it doesn't run.`,
        `recipe-problem-${s.now}`,
      ),
    );
    if (fresh.length) return undefined;
    return box(st, "a recipe that doesn't read", ...writes);
  }
  const recipe = rc.read.recipe;
  if (st.recipe?.hash === recipe.hash) return undefined;
  const updated = Boolean(st.recipe && st.recipe.hash !== "broken");
  const was = st.repeat?.next;
  const set = setRepeat(
    st,
    {
      when: recipe.when,
      kind: recipe.check ? "check" : "job",
      ...(recipe.check ? { check: recipe.check, onChange: "think" as const } : {}),
    },
    s.now,
    ctx.timeZone,
  );
  st.recipe = { name: recipe.name, hash: recipe.hash };
  if (recipe.model) {
    const u = ctx.use(`use ${recipe.model}`, st.use);
    if (u?.use) st.use = u.use;
  }
  if (!set.ok) {
    if (st.repeat) st.repeat.paused = true;
    writes.push(reply("needs-you", "Needs you", `${file}: ${set.line}`, `recipe-${recipe.hash}`));
  } else {
    // A time that had come still runs now: the change is noticed, not skipped over.
    if (st.repeat && was && Date.parse(was) <= Date.parse(s.now)) st.repeat.next = was;
    writes.push(
      { w: "labels", add: [REPEATS_LABEL.name, RECIPE_LABEL.name] },
      { w: "coming-up" },
      reply(
        "answer",
        "Repeating",
        `${updated ? "Updated" : "Set"} from ${file}: ${set.line} Say \`again\` to run it now; closing this task pauses it.`,
        `recipe-${recipe.hash}`,
      ),
    );
  }
  // A comment, or a time that has come, carries on in this run; otherwise this run was for the file.
  const due = st.repeat && !st.repeat.paused && Date.parse(st.repeat.next) <= Date.parse(s.now);
  if (fresh.length || due) return undefined;
  return box(st, updated ? "its recipe changed" : "a new recipe", ...writes);
}

export const openPr = (st: TaskState) =>
  [...(st.prs ?? [])].reverse().find((u) => (st.prInfo?.[u]?.state ?? "open") === "open");
const docMerged = (st: TaskState) =>
  Object.values(st.prInfo ?? {}).some((p) => p.kind === "change" && p.state === "merged");

// ---------------------------------------------------------------------------------- afterThink

/**
 * What the agent's result becomes: the reply, the PR, the calls, notes, a repeat, more work. A run
 * that read outside content (the web, a tool, a repo you don't own) has its replies' images made
 * inert when they're posted (ADR 0044), whatever field they're in.
 */
export function afterThink(
  s: Snapshot,
  st0: TaskState,
  think: Think,
  result: Result | Unusable,
  meta: ThinkMeta,
  ctx: Context,
): Decided {
  const d = decideAfter(s, st0, think, result, meta, ctx);
  // A run on another of your accounts (ADR 0045) read repos other people write: its images too.
  const outside =
    meta.readOutside ||
    Boolean(think.account) ||
    ("error" in result ? false : Boolean(result.read_outside));
  if (outside) for (const w of d.writes) if (w.w === "reply") w.outside = true;
  return d;
}

/** A result that says it failed: the task's state, with its first line as the problem. */
function failedWith(st: TaskState, s: Snapshot, text: string) {
  st.phase = "failed";
  st.failed = {
    at: s.now,
    problem: problem("unexpected", { first_line: text.split("\n")[0] ?? "" }),
  };
}

function decideAfter(
  s: Snapshot,
  st0: TaskState,
  think: Think,
  result: Result | Unusable,
  meta: ThinkMeta,
  ctx: Context,
): Decided {
  const st = clone(st0);
  const fresh = s.said.filter((c) => think.fresh.includes(c.id));
  st.working = undefined;
  // Its handoff for the next run, however this one ended (ADR 0041); none leaves the last one.
  if (meta.handoff) st.notes = meta.handoff;
  // Read too: what you wrote while it worked that it took in, and your `stop`.
  const asked = meta.stopped?.why === "asked" ? meta.stopped.comment : 0;
  const cursor = Math.max(st.seen, asked, ...fresh.map((c) => c.id), ...(meta.caughtUp ?? []));
  const step = `think-${think.why}`;
  const needs: Decided["needs"] = {};

  // Your `stop`: no failure, and its work kept for the next run, as when it fails.
  if (asked) {
    st.seen = cursor;
    st.phase = "needs-you";
    st.failed = undefined;
    const writes: Write[] = [{ w: "react", comment: asked, content: "eyes" }];
    const why = keepWork(s, st, think, meta, { writes, needs });
    const kept =
      writes.length > 1
        ? "What it had committed is kept on the task's branch, and the next run starts from it."
        : why;
    // A split task's `stop` starts no more parts too (ADR 0066).
    const parts = s.issue.labels.includes(STARTED_LABEL) && splitParts(s).length > 0;
    if (parts) writes.push({ w: "labels", remove: [STARTED_LABEL] });
    // Stop the run from the web chat: its answer goes on the status's Last action (ADR 0069).
    const button = meta.stopped?.why === "asked" && Boolean(meta.stopped.button);
    return {
      state: st,
      needs,
      writes: byButton(s, st, button, [
        ...writes,
        reply(
          "needs-you",
          "Stopped",
          [
            "Stopped, as you asked.",
            parts ? "No more parts start." : "",
            kept,
            "Say what you'd like next, or `continue`.",
          ]
            .filter(Boolean)
            .join(" "),
          `${step}-stop`,
          think.occasion ? { occasion: think.occasion } : {},
        ),
      ]),
    };
  }

  if ("error" in result) {
    // A slip in its result's shape is named first: the agent finished, and its words are below.
    const p = result.wrong
      ? problem("result-wrong", { fields: result.wrong })
      : (stopProblem(meta.stopped, ctx.timeZone) ??
        problem("unexpected", { first_line: result.error }));
    st.failed = { at: s.now, problem: p };
    st.seen = cursor;
    st.phase = "failed";
    const pauses = failedInARow(st, think);
    // What it read as it started counts as read, as the words the run began with; a repeat paused
    // now comes off "Coming up".
    const writes: Write[] = [
      ...(pauses ? [{ w: "coming-up" as const }] : []),
      ...(meta.caughtUp ?? []).map((id): Write => ({ w: "react", comment: id, content: "eyes" })),
    ];
    const why = keepWork(s, st, think, meta, { writes, needs });
    return {
      state: st,
      needs,
      writes: [
        ...writes,
        reply(
          "failed",
          "Failed",
          [renderProblem(p), saidAs(result.text), why, pauses].filter(Boolean).join("\n\n"),
          step,
          {
            problem: p,
            ...(think.occasion ? { occasion: think.occasion } : {}),
          },
        ),
      ],
    };
  }

  const left: string[] = [];
  const r = think.profile === "guest" ? guestsOnly(result, left, ctx) : result;
  const writes: Write[] = [];
  // The list is the box's alone (ADR 0049): a copy in the agent's words goes, from its heading on.
  let text = withoutList(r.text);
  const links: Link[] = [];

  // A check: its output decides, with no agent unless the repeat asks for one. When it did ask and
  // the output changed, the agent followed: its result is a job's, below.
  const same = Boolean(meta.checkHash) && st.repeat?.value === meta.checkHash;
  if (think.check && st.repeat && meta.checkHash) st.repeat.value = meta.checkHash;
  if (think.check && (!think.thenAsk || same || !meta.checkHash)) {
    st.seen = cursor;
    const occasion = think.occasion ? { occasion: think.occasion } : {};
    // Its script failed (it exited non-zero, ran for more than a minute, or isn't there): a failure
    // with its cause, counted as a job's is, never a change. Its last output stays the one to beat.
    if (r.state === "failed") {
      failedWith(st, s, r.text);
      const pauses = failedInARow(st, think);
      return {
        state: st,
        needs,
        writes: [
          { w: "coming-up" },
          reply(
            "failed",
            "Failed",
            [r.text, pauses].filter(Boolean).join("\n\n"),
            "check",
            occasion,
          ),
        ],
      };
    }
    st.phase = "repeating";
    st.failed = undefined;
    if (think.why === "scheduled" && st.repeat) st.repeat.fails = 0;
    if (same) return { state: st, needs, writes: [{ w: "coming-up" }] };
    return {
      state: st,
      needs,
      writes: [
        { w: "coming-up" },
        reply("answer", "Changed", meta.checkOutput ?? r.text, "check", occasion),
      ],
    };
  }

  // A split (ADR 0066): its parts listed for your yes, and alone, so the list is only what opens:
  // a change, a PR or calls in the same answer aren't made (a PR's commits are kept on the task's
  // branch), and the reply says so. A part splits no further, and a task whose PR would close it
  // before its parts isn't split.
  const alone =
    Boolean(r.split) &&
    splitFits(s, st, think, r.split ?? [], left, (t) => {
      text += `\n\n${t}`;
    });
  if (alone && (r.work || r.pr || r.calls?.length))
    text += `\n\nA split comes alone, so what else this answer asked for wasn't made${r.pr ? " (its commits are kept on the task's branch)" : ""}: ask for it again once the parts are open.`;
  // A task first (ADR 0075 §6): listed for your yes, and alone, as a split is; never from a read
  // run (a guest's has none left), nor on a project's own thread.
  const notFirst = !r.first
    ? undefined
    : r.split
      ? "a split came with it: ask for it after the split"
      : think.profile === "read"
        ? "a run that reads a repo outside your account opens no task"
        : s.project?.number === s.n
          ? "a project's own thread opens none: ask in a chat in it"
          : undefined;
  if (notFirst) left.push(`a task first (${notFirst})`);
  const first = Boolean(r.first) && !alone && !notFirst;
  if (first && (r.work || r.pr || r.calls?.length))
    text += `\n\nA task first comes alone, so what else this answer asked for wasn't made${r.pr ? " (its commits are kept on the task's branch)" : ""}: ask for it again once it's merged.`;
  const work = alone || first ? undefined : r.work;
  const pr = alone || first ? undefined : r.pr;

  // What your yes approves: calls, notes, a split, a held workflow change or a task first.
  let listed = false;
  // The run's workflow change (ADR 0075 §5.2), as the box read it from its commits: apply holds it
  // out of the push, and it's listed for your yes when nothing it changes runs before your merge;
  // else it stays held, and the reply says why. All the run changed: nothing is pushed before the
  // yes, which pushes it and opens the PR asked for.
  const held = meta.held;
  const onlyHeld = Boolean(held?.only && !held.why);
  const holdIt = (
    repo: string,
    branch: string,
    ask?: { kind: "closes" | "part-of"; title: string; body: string },
  ) => {
    if (!held) return;
    if (held.why) {
      const files = held.files.map((f) => `\`${f}\``).join(", ");
      const pipeline =
        repo !== PLATFORM &&
        !think.ownRules &&
        held.files.some(
          (f) => f === ".github/workflows/ship.yml" || f.startsWith(".github/actions/"),
        );
      text += `\n\n${
        files
          ? `The workflow change (${files}) is held out of the push, and not listed for your yes: ${held.why}. ${held.key ? "A workflow reads a key only as a secret (`secrets.NAME`), never in its lines." : pipeline ? "A project's pipeline changes through its stack: a `shipify:` task changes the stack, and `upgrade` brings it here." : "It's yours to make on GitHub, if you want it."}`
          : `The run's workflow change is held out of the push, and not listed for your yes: ${held.why}. Say \`continue\`, and the next run makes it again.`
      }`;
      return;
    }
    st.branch = branch;
    st.project = repo;
    st.pending.workflow = {
      repo,
      branch,
      ...(think.base ? { base: think.base } : {}),
      at: held.at,
      files: held.files,
      patch: held.patch,
      sha256: held.sha256,
      facts: held.facts,
      ...(held.mainNewer ? { mainNewer: true as const } : {}),
      ...(meta.readOutside || r.read_outside || think.account ? { outside: true as const } : {}),
      ...(onlyHeld && ask ? { pr: ask } : {}),
    };
    listed = true;
  };

  // Work found for a project, or another of your repos, that this run has no clone of: a work run
  // follows on it. A work run, a stay's turn too, makes a change to its own project itself (ADR
  // 0076): a new run for it would start over from the thread, so it's left out, and said.
  const own = work && think.profile === "work" ? named(s, st, work.project) : undefined;
  if (work && think.profile === "read")
    left.push(
      "a change (a run that reads a repo outside your account changes nothing: ask for it in a new task)",
    );
  else if (own && "project" in own && own.project === think.project)
    left.push(
      `a work run on ${work?.project} (this run works on its clone, so it makes the change itself and asks for its PR: reply \`continue\` to have it done)`,
    );
  else if (work && (think.profile === "talk" || think.profile === "work")) {
    const n = named(s, st, work.project);
    if (n && "refused" in n) text += `\n\n${n.refused}`;
    else if (n) {
      st.pending.work = { project: work.project, brief: work.brief, at: s.now };
      writes.push({ w: "dispatch", job: "run" });
      // Said by the box, whatever the agent wrote: a run starts from this reply, so it's no surprise.
      // Once: an agent that said it in its own words too isn't repeated.
      const starts = `A work run on ${work.project} starts now, from this reply: say \`stop\` to stop it.`;
      if (!text.includes(starts)) text += `\n\n${starts}`;
    } else {
      const p = problem("no-such-project", {
        project: work.project,
        projects: s.projects.join(", "),
      });
      text += `\n\n${renderProblem(p)}`;
    }
  }

  // The PR it asked for: pushed from its bundle by apply, on this task's own branch. A publish is
  // a merged plan's new project's first push, never a repo that keeps its own rules.
  if (pr && (think.profile !== "work" || !think.project))
    left.push("a PR (only a run on a project's checkout opens one)");
  else if (pr?.kind === "publish" && (think.ownRules || think.project !== st0.built))
    left.push("a publish (only a merged plan's new project publishes)");
  else if (pr && r.state !== "failed") {
    const repo = think.project as string;
    const branch = st.branch ?? branchName(s.n, s.issue.title);
    st.branch = branch;
    // A new project's plan, read from the run's commits: its PR is the plan's.
    st.plan = wrotePlan(s, think, meta) ?? st.plan;
    // A split task closes with its parts (ADR 0066), never with a PR of its own; a task first
    // (ADR 0075) leaves its PR as asked.
    const parent = pr.kind === "closes" && splitParts(s).length > 0;
    if (parent) text += "\n\nIts PR is `part-of`: this task closes with its sub-tasks.";
    const kind = parent ? "part-of" : pr.kind;
    // A PR always says what it is: the agent's description, or its reply when it gave none.
    const body = pr.body.trim() ? pr.body : r.text;
    // Its workflow change all it changed: nothing to push before your yes, which opens the PR.
    if (!onlyHeld || kind === "publish") {
      writes.push({
        w: "push",
        repo,
        branch,
        kind,
        title: pr.title,
        body,
        ...(think.base ? { base: think.base } : {}),
        // A preview is an app's (its pipeline makes it); a repo that keeps its own rules has none.
        ...((pr.preview || st.preview) && !think.ownRules ? { preview: true } : {}),
      });
      needs.repo = repo;
      if (meta.touchesWorkflows) needs.workflows = true;
    }
    if (kind !== "publish") holdIt(repo, branch, { kind, title: pr.title, body });
    st.project = repo;
    st.ownRules = think.ownRules;
    // A preview the agent asked for is on for the task's PR, as your `preview` turns it on.
    if (pr.preview && !think.ownRules) st.preview = true;
  }
  // A failed run's commits (its checks failed, or it couldn't finish): kept for the next run, its
  // workflow change held and not listed: the next run makes it again.
  if (r.state === "failed") {
    const why = keepWork(s, st, think, meta, { writes, needs }, wrotePlan(s, think, meta));
    if (why) text += `\n\n${why}`;
  }
  // A question mid-change (ADR 0041): its commits wait on the task's branch for your answer. The
  // reply reads as it would without them: a guard that keeps them out says nothing new. So are a
  // split's, whose PR waits (ADR 0066), and a task first's, whatever its state (ADR 0075). A
  // question's workflow change waits beside it on the list.
  else if ((r.state === "needs-you" && !r.pr) || (alone && r.pr) || first) {
    const asks = !alone && !first;
    const before = writes.length;
    if (!(asks && onlyHeld)) keepWork(s, st, think, meta, { writes, needs }, undefined, true);
    if (asks && (onlyHeld || writes.length > before) && think.project)
      holdIt(think.project, st.branch ?? branchName(s.n, s.issue.title));
  }
  // A call's files (its tool's args.<call>.files) are ones the task shared, before or in this
  // answer, or ones you sent through a chat on it, by their refs (ADR 0069). Apply
  // shares this answer's before it makes calls, so a pre-approved one can name them.
  const shared = new Set([...Object.keys(st.shared ?? {}), ...Object.keys(sentRefs(s))]);
  const sharing = new Set((r.files ?? []).map(nameOf));
  const filesOf = (c: ToolCall): unknown => {
    const arg = ctx.tools[c.tool]?.files?.[c.name];
    return arg && arg in c.args ? c.args[arg] : [];
  };
  const calls = (alone || first ? [] : (r.calls ?? [])).filter((c) => {
    const ok = ctx.tools[c.tool]?.calls[c.name]?.(c.args) ?? false;
    if (!ok) left.push(`${c.tool}.${c.name} (not a call it may make, or its arguments don't fit)`);
    const files = filesOf(c);
    const unshared =
      ok &&
      (!Array.isArray(files) ||
        files.some(
          (f) => typeof f !== "string" || !(shared.has(nameOf(f)) || sharing.has(nameOf(f))),
        ));
    if (unshared)
      left.push(
        `${c.tool}.${c.name} (it names a file this task hasn't shared: share it in the answer's files)`,
      );
    return ok && !unshared;
  });
  if (calls.length) {
    const outside = meta.readOutside || Boolean(r.read_outside) || Boolean(think.account);
    // One tool per list: its act key is the only one the run gets.
    const tool = calls[0]?.tool as string;
    for (const c of calls.filter((c) => c.tool !== tool))
      left.push(`${c.tool}.${c.name} (one tool per list: ask again for it after this one)`);
    calls.splice(0, calls.length, ...calls.filter((c) => c.tool === tool));
    // The agent saying it read outside counts as the web; another account's run (ADR 0045) holds
    // none of your tools: what either asks waits for your yes. A guest's fit their forms, made at
    // once, as no one's yes is theirs to give (ADR 0073).
    const away = Boolean(r.read_outside) || Boolean(think.account);
    const guest = think.profile === "guest";
    if (guest || (!away && calls.every((c) => preApproved(ctx, c, calls, meta)))) {
      writes.push({ w: "calls", calls, fingerprint: fingerprint(calls) });
      needs.act = tool;
    } else {
      st.pending.calls = {
        calls,
        fingerprint: fingerprint(calls),
        ...(outside ? { outside } : {}),
      };
      listed = true;
    }
  }

  // Pages rewritten (ADR 0069): the box checks each one as it writes it, and leaves one that changed
  // after the run read it (ADR 0070). None from another account, nor from a read run (ADR 0044):
  // what it read is a repo outside your account, data. Before the notes, so a note on the same page
  // goes on its new text.
  // A closed project is read-only (ADR 0069): nothing is added to its pages until it's reopened.
  // Its own thread runs only once words reopened it.
  const shut = s.project?.state === "closed" && s.project.number !== s.n ? s.project : undefined;
  if (r.pages?.length && think.profile === "read")
    left.push("pages (a run that reads a repo outside your account writes none)");
  else if (r.pages?.length && shut)
    left.push(`pages (${shownProject(shut.name)} is closed · #${shut.number}: reopen it first)`);
  else if (r.pages?.length && !think.account && !alone && !first)
    writes.push({
      w: "pages",
      pages: r.pages,
      ...((think.profile === "guest" ? guestsProject(s) : s.project)
        ? { project: (s.project as NonNullable<Snapshot["project"]>).name }
        : {}),
      outside: Boolean(meta.readOutside || r.read_outside),
      ...(meta.pagesAt ? { since: meta.pagesAt } : {}),
      chat: s.n,
      // A guest's run writes only its own project's pages (ADR 0071).
      ...(think.profile === "guest" && guestOf(s) ? { guest: guestOf(s) } : {}),
    });
  // Notes: your own words, written now; from a run that read outside content (any tool's too), or
  // one on another of your accounts (ADR 0045), whose repos others write too, after your yes. So
  // are the lines your newer words undo, taken off first, and your Personality's new words (ADR
  // 0078). A guest's go on their own page, only from a run that read nothing from outside: a guest
  // approves no list, so they say `remember: …` instead.
  const memory: Note[] = [
    ...(r.forget ?? []).map((line) => ({ topic: "", line, kind: "forget" as const })),
    ...(r.notes ?? []),
    ...(r.personality
      ? [{ topic: PERSONALITY_TOPIC, line: r.personality, kind: "personality" as const }]
      : []),
  ];
  const fromOutside = Boolean(meta.readOutside || r.read_outside || think.account);
  const theirs = think.profile === "guest" ? (guestOf(s) ?? "") : "";
  if (memory.length && think.profile === "guest" && (fromOutside || !theirs))
    text += `\n\nNot kept in your memory, as this run read from outside: say \`remember: …\`${r.personality ? " or `personality: …`" : ""} to keep it.`;
  else if (memory.length && fromOutside && !theirs) {
    st.pending.notes = memory;
    listed = true;
  } else if (memory.length) writes.push(...memory.map((n) => noteOfList(n, theirs)));
  // Its Personality, written now: Change it back under the reply.
  const voiced = Boolean(r.personality) && !fromOutside && (think.profile !== "guest" || !!theirs);

  if (alone) {
    st.pending.split = r.split;
    listed = true;
  }
  if (first) {
    st.pending.first = r.first;
    listed = true;
  }

  // A repeat it read in your words. A read run sets none (ADR 0044): a repeat is a future run, and
  // a repo you don't own is data; your own `repeat: …` sets one.
  if (r.repeat && think.profile === "read")
    left.push("a repeat (a run that reads a repo outside your account sets none: say `repeat: …`)");
  else if (r.repeat) {
    const set = setRepeat(
      st,
      {
        when: r.repeat.when,
        kind: r.repeat.kind,
        text: r.repeat.text,
        check: r.repeat.check,
        onChange: r.repeat.onChange,
      },
      s.now,
      ctx.timeZone,
      whereOf(s, st, ctx),
      s.issue.labels,
    );
    text += `\n\n${set.line}`;
    if (set.ok) writes.push(...set.labels, { w: "coming-up" });
  }

  if (left.length) text += `\n\n(Left out: ${left.join("; ")}.)`;
  // The list, once and last: all your yes approves, and its code, which its Yes names (ADR 0049).
  const pend = st.pending;
  const more = heldListLines(st);
  const list = !listed
    ? undefined
    : listTooLong(ctx.tools, pend.calls?.calls, pend.notes, pend.split, more)
      ? "github"
      : listCode(pend.calls?.calls, pend.notes, pend.split, [], heldKinds(pend));
  if (listed) {
    text += `

${callList(ctx.tools, pend.calls?.calls, pend.notes, pend.split, more)}`;
    // Its time starts now; apply names the reply that shows it.
    pend.list = { post: 0, at: s.now };
  }

  // The reply: what needs you (a question, a list, a PR to merge, one this run opened or one still
  // open from before), a failure, or an answer. A task waiting on a PR is never closed for quiet.
  const waiting = Boolean(
    r.question ||
      st.pending.calls ||
      st.pending.notes ||
      st.pending.split ||
      st.pending.workflow ||
      st.pending.first ||
      pr ||
      openPr(st),
  );
  st.failed = undefined;
  st.seen = cursor;
  if (r.state === "failed") failedWith(st, s, r.text);
  else
    st.phase =
      waiting || r.state === "needs-you" ? "needs-you" : st.repeat ? "repeating" : "answered";
  // An errand's job on a task its merge closed answers there, and the task stays closed and done.
  if (
    st.phase === "answered" &&
    think.why === "scheduled" &&
    !st.repeat &&
    s.issue.state === "closed"
  )
    st.phase = "done";
  // A split task waits for its parts, never closed for quiet: it closes with them (ADR 0066). Only a
  // part closes for quiet (ADR 0069).
  st.closes = st.phase === "answered" && !openParts(s).length ? quietDay(s) : undefined;
  if (think.why === "start-over" && st.pending.closePrs?.length)
    writes.push({ w: "dispatch", job: "github" });
  // A repeat's job counts its own `failed` as a failure in a row, as one that doesn't read (paused
  // now, it comes off "Coming up"); one that ran starts the count over.
  const pauses = r.state === "failed" ? failedInARow(st, think) : undefined;
  if (pauses) {
    text += `\n\n${pauses}`;
    writes.push({ w: "coming-up" });
  } else if (r.state !== "failed" && think.why === "scheduled" && st.repeat) st.repeat.fails = 0;
  // 👀 on what you wrote while it worked, as on what the run read first.
  for (const id of meta.caughtUp ?? []) writes.push({ w: "react", comment: id, content: "eyes" });
  // A scheduled job with nothing to say stays quiet; a failure is always said (ADR 0042), and so
  // is a job once (it has no repeat left by now): you asked to be told.
  const quiet =
    Boolean(r.quiet) &&
    think.why === "scheduled" &&
    Boolean(st.repeat) &&
    !waiting &&
    r.state !== "failed";
  // An answer in a project's chat that kept nothing yet: Keep on page under it (ADR 0070).
  const keep =
    Boolean(s.project) &&
    s.project?.number !== s.n &&
    r.state !== "failed" &&
    !waiting &&
    !r.pages?.length;
  if (!quiet)
    writes.push(
      reply(
        r.state === "failed" ? "failed" : waiting ? "needs-you" : "answer",
        r.state === "failed" ? "Failed" : waiting ? "Needs you" : "Done",
        text,
        step,
        {
          ...(r.question ? { question: r.question } : {}),
          // With no question, its next steps as buttons (ADR 0078); never under a list, whose
          // buttons are its Yes and No alone.
          ...(r.choices?.length && (r.question || !list) ? { choices: r.choices } : {}),
          ...(list ? { list } : {}),
          ...(keep ? { keep: true as const } : {}),
          ...(voiced ? { undo: true as const } : {}),
          links,
          ...(r.files?.length ? { files: r.files } : {}),
          ...(think.occasion ? { occasion: think.occasion } : {}),
        },
      ),
    );
  return { state: st, needs, writes };
}

/** The plan a `new:` task's run wrote in its clone of Shipify (plans/<id>.plan.md in its commits),
 * never from a run on another account or a repo that keeps its own rules (ADR 0045). */
const wrotePlan = (s: Snapshot, think: Think, meta: ThinkMeta) =>
  s.parsed.kind === "new" && think.project === PLATFORM && !think.ownRules && !think.account
    ? meta.plan
    : undefined;

/**
 * The commits of a work run that failed, stopped or asks you something (ADR 0041), kept on the
 * task's branch with no PR, so the next run starts from them (think's clone); or a line saying why
 * not: never a new project's first push (it goes to main, which deploys), and never into an open
 * PR, which you might merge.
 */
function keepWork(
  s: Snapshot,
  st: TaskState,
  think: Think,
  meta: ThinkMeta,
  d: { writes: Write[]; needs: Decided["needs"] },
  plan?: string,
  /** A question's (ADR 0041): its push says nothing, and the task's project and plan stay as they were. */
  quiet = false,
): string {
  if (think.profile !== "work" || !think.project || !meta.commits) return "";
  if (meta.firstPush)
    return "Its commits weren't kept: a new project's first push goes to `main`, which deploys.";
  if ((st.prs ?? []).some((u) => (st.prInfo?.[u]?.state ?? "open") === "open"))
    return "Its commits weren't kept: its PR is open, and only work that passed the checks goes into it.";
  const branch = st.branch ?? branchName(s.n, s.issue.title);
  st.branch = branch;
  if (!quiet) {
    st.project = think.project;
    st.ownRules = think.ownRules;
  }
  if (plan && !quiet) st.plan = plan;
  d.writes.push({
    w: "push",
    repo: think.project,
    branch,
    open: false,
    ...(quiet ? { quiet } : {}),
    ...(think.base ? { base: think.base } : {}),
  });
  d.needs.repo = think.project;
  if (meta.touchesWorkflows) d.needs.workflows = true;
  return "";
}

/** Why the agent stopped, as the problem the reply shows: what it ended on in its own words, your
 * plan's limit, or the rest. */
function stopProblem(stop: Stop | undefined, timeZone: string) {
  if (!stop) return undefined;
  if ((stop.why === "crash" || stop.why === "no-answer") && stop.error)
    return problem("agent-error", { model: stop.error.by, error: stop.error.said });
  if (stop.why === "plan")
    return problem("plan-used-up", {
      limit: limitName(stop.window),
      when: stop.resets ? formatWhen(stop.resets, timeZone) : "it resets",
    });
  return problem("agent-stopped", { why: stopWords(stop) });
}

/**
 * Whether a run's reads let a form count (ADR 0049): it read nothing from outside, or only the look
 * calls of tools its `after` names. Never after the web, a check or a read profile (`elsewhere`),
 * nor when the box can't say what it read.
 */
const readsFit = (meta: ThinkMeta, after: string[] = []) =>
  !meta.readOutside ||
  (!meta.elsewhere &&
    Boolean(meta.looked?.length) &&
    (meta.looked ?? []).every((t) => after.includes(t)));

/**
 * Whether a call fits one of its tool's pre-approved forms: fixed fields equal, text within caps,
 * other fields only those it takes with any value, no more than its most, and the run's reads
 * within its `after`.
 */
export function preApproved(ctx: Context, c: ToolCall, all: ToolCall[], meta: ThinkMeta): boolean {
  const forms = ctx.tools[c.tool]?.pre ?? [];
  return forms.some((p) => readsFit(meta, p.after) && fits(p, c, all));
}

/**
 * Whether a guest's call fits one of its tool's guest forms (ADR 0073). No rule on reads: a guest's
 * call makes a drop only they open, or changes one of theirs, which the tool checks.
 */
export const guestForm = (ctx: Context, c: ToolCall, all: ToolCall[]) =>
  (ctx.tools[c.tool]?.guest ?? []).some((p) => fits(p, c, all));

/** A call fits a form: its call, fixed fields equal, text within caps, others only its `any`. */
const fits = (p: Form, c: ToolCall, all: ToolCall[]) =>
  p.call === c.name &&
  all.filter((x) => x.tool === c.tool && x.name === c.name).length <= p.max &&
  Object.entries(p.fixed).every(([k, v]) => JSON.stringify(c.args[k]) === JSON.stringify(v)) &&
  Object.entries(c.args).every(
    ([k, v]) =>
      k in p.fixed ||
      (p.any ?? []).includes(k) ||
      (k in p.caps && typeof v === "string" && v.length <= (p.caps[k] ?? 0)),
  );

/** A note on a list, or a line to take off, or the Personality's new words (ADR 0078). */
type Note = { topic: string; line: string; kind?: "forget" | "personality" };

/** A listed note as the box writes it, after your yes or at once: on a guest's page with `guest`. */
const noteOfList = (n: Note, guest = ""): Write => {
  const theirs = guest ? { guest } : {};
  if (n.kind === "forget") return { w: "forget", words: n.line, ...theirs };
  if (n.kind === "personality") return { w: "personality", set: { set: n.line }, ...theirs };
  return { w: "note", topic: n.topic, line: n.line, ...theirs };
};

/** A listed note's line: what your yes writes, takes off or sets. */
const noteLine = (n: Note) =>
  (n.kind === "forget"
    ? `Take off the note: ${n.line}`
    : n.kind === "personality"
      ? `Your Personality, its new words: ${n.line}`
      : `Note in ${n.topic}: ${n.line}`
  ).replace(/\s+/g, " ");

/**
 * A list's lines, as you approve them: each call (the tool, the call, what its tool says an
 * argument it has does, its arguments), then each note, then each part a split opens (ADR 0066).
 */
const listLines = (
  tools: Context["tools"],
  calls: ToolCall[] = [],
  notes: Note[] = [],
  split: SplitEntry[] = [],
  /** A held workflow change's and a task first's lines (ADR 0075), made already. */
  held: string[] = [],
) =>
  [
    ...calls.map((c) => {
      const warn = Object.entries(tools[c.tool]?.warn?.[c.name] ?? {})
        .filter(([arg]) => arg in c.args)
        .map(([, w]) => w);
      return `\`${c.tool}.${c.name}\`${warn.length ? ` (${warn.join("; ")})` : ""} with \`${JSON.stringify(c.args)}\``;
    }),
    ...notes.map(noteLine),
    ...splitLines(split),
    ...held,
  ].map((l, i) => `${i + 1}. ${l}`);

/** A list too long for a chat to show whole (LIST_MAX): approved only on GitHub. */
export const listTooLong = (
  tools: Context["tools"],
  calls?: ToolCall[],
  notes?: Note[],
  split?: SplitEntry[],
  held?: string[],
) => listLines(tools, calls, notes, split, held).join("\n").length > LIST_MAX;

/** The list, as you approve it: its heading, saying where your `yes` counts, then its lines. */
export function callList(
  tools: Context["tools"],
  calls?: ToolCall[],
  notes?: Note[],
  split?: SplitEntry[],
  held?: string[],
): string {
  const where = listTooLong(tools, calls, notes, split, held)
    ? "comment `yes` on the task on GitHub, within a day: it's too long for a chat"
    : "tap Yes, or say `yes`, within a day";
  return `${LIST_HEAD} (${where}):\n${listLines(tools, calls, notes, split, held).join("\n")}`;
}

/**
 * Whether a run's split is listed (ADR 0066), saying why not: never from a run that reads a repo
 * outside your account, nor on a part (one level only), nor on a task whose own PR would close it
 * before its parts, nor one whose `after` names no entry before it or no part of the task.
 */
function splitFits(
  s: Snapshot,
  st: TaskState,
  think: Think,
  split: SplitEntry[],
  left: string[],
  say: (text: string) => void,
): boolean {
  const pr = (st.prs ?? []).find(
    (u) => st.prInfo?.[u]?.state === "open" && (st.prInfo?.[u]?.kind ?? "code") === "code",
  );
  const parts = partsOf(s, split);
  if (think.profile === "read")
    left.push("a split (a run that reads a repo outside your account opens no task)");
  else if (isPart(s)) say("A sub-task can't split. Say it as a task of its own.");
  // A project is never a split's parent (ADR 0069): parts under it would never start.
  else if (s.project?.number === s.n)
    say(
      "A project's own thread doesn't split: open a chat in it (**New chat here**), and ask for the split there.",
    );
  else if (pr)
    say(
      `The split isn't listed: this task's PR (${pr}) would close it before its parts. Merge or close that PR first, then ask again.`,
    );
  else if ("wrong" in parts) left.push(`a split (${parts.wrong})`);
  else return true;
  return false;
}

/**
 * The agent's words without a list of its own: from a list's heading on (the box adds the list),
 * and the heading's mark gone from anywhere else in them, so only the box's list reads as one.
 */
export function withoutList(md: string): string {
  const at = md.search(/^[\s>*_#-]*To (do|note) after your `?yes`?/im);
  const words = at < 0 ? md : md.slice(0, at).trimEnd();
  return words.split(LIST_HEAD).join("To do after your yes");
}

/** task/12-a-few-words: a task's own branch. */
export function branchName(n: number, title: string): string {
  const words = title
    .toLowerCase()
    .replace(/^[\w.-]+\s*:\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return `task/${n}${words ? `-${words}` : ""}`;
}
