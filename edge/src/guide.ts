// A chat that guides you (ADR 0042 §1–§3): what the door shows when you go to a task or pick a
// model, with buttons that send words you could type. Where a message goes is door-in.ts'; this is
// what it shows: a task's head (`#240` alone), /tasks, the picker, the pinned status, and the one
// read of a task they need. Nothing is stored: a task's pick is its status comment's, and a new task's lives in the
// message that asks for it. The core names no agent: the picker is executors.json's list.
import {
  agentName,
  agentsSeen,
  type Button,
  inGroups,
  line,
  NEEDS_YOU_LABEL,
  type Picked,
  pickLabel,
  pickOf,
  pickWord,
  pinText,
  readFrom,
  readTaskSeen,
  STATE_LABELS,
  STUCK_LABEL,
  TASK_MARK,
  taskRows,
  tasksText,
  useCommand,
  withoutLine,
  effortsFor,
} from "../../cli/contracts/index.ts";
import type { Shown } from "./channels/channel.ts";
import { NO_SUCH_TASK, REFUSED } from "./chat.ts";
import { byDoor, byRun, type GitHub, GitHubError, RUN_WRITER } from "./github.ts";
import {
  NOTEBOOK_LABEL,
  type RawRunner,
  type Settings,
  STATUS_LABEL,
  statusTask,
  toBoxes,
} from "./settings.ts";

/** A task's label while a run of it works. */
const WORKING_LABEL = STATE_LABELS[0];

// ---------------------------------------------------------------- a task, read once

/** Task #n as the door reads it: why it can't take your words, or its state and, when asked, its pick. */
export interface TaskRead {
  /** Why your words can't go on it (gone, a PR, the status task, a notebook page, locked, someone else's). */
  why?: string;
  waiting: boolean;
  open?: boolean;
  labels?: string[];
  title?: string;
  /** Its pick, from its status comment (none: Auto). */
  use?: Picked;
}

/**
 * Task #n as the door writes to it: one read of the issue and, with `pick`, its pick as it stands:
 * the status comment's (the first a run writes, in its first comments), then each pick you set
 * since that comment was saved, in order (a setting starts no run, so no run has read it yet).
 */
export async function readTask(
  n: number,
  s: Settings,
  gh: GitHub,
  pick = false,
): Promise<TaskRead> {
  const r = await gh.call("GET", `repos/${gh.repo}/issues/${n}`);
  if (r.status === 404 || r.status === 410) return { why: NO_SUCH_TASK(n), waiting: false };
  if (r.status !== 200) throw new GitHubError(r.status, `issue #${n}`);
  const issue = r.data as {
    title?: string;
    state?: string;
    pull_request?: unknown;
    locked?: boolean;
    labels?: { name: string }[];
    user?: { login?: string };
    performed_via_github_app?: { id?: number } | null;
  };
  const labels = (issue.labels ?? []).map((l) => l.name);
  const waiting = labels.includes(NEEDS_YOU_LABEL);
  const refused = (why: string) => ({ why, waiting });
  if (issue.pull_request) return refused(REFUSED.pr(n));
  if (labels.includes(STATUS_LABEL)) return refused(REFUSED.status(n));
  if (labels.includes(NOTEBOOK_LABEL)) return refused(REFUSED.notebook(n));
  if (issue.locked) return refused(REFUSED.locked(n));
  const login = issue.user?.login?.toLowerCase() ?? "";
  const yours =
    byDoor(gh, issue) ||
    login === RUN_WRITER ||
    (s.owner !== undefined && login === s.owner.toLowerCase());
  if (!yours) return refused(REFUSED.theirs(n));
  const read: TaskRead = {
    waiting,
    open: issue.state === "open",
    labels,
    title: issue.title ?? "",
  };
  if (!pick) return read;
  type Comment = {
    body?: string | null;
    user?: { login?: string; id?: number };
    performed_via_github_app?: { id?: number } | null;
    created_at?: string;
    updated_at?: string;
  };
  const path = `repos/${gh.repo}/issues/${n}/comments?per_page=100`;
  const first = await gh.json<Comment[]>("GET", path);
  const status = first.find((c) => byRun(c) && (c.body ?? "").startsWith(TASK_MARK));
  const saved = status?.updated_at ?? status?.created_at;
  const since = saved
    ? await gh.json<Comment[]>("GET", `${path}&since=${encodeURIComponent(saved)}`)
    : first;
  let use: Picked | undefined = readTaskSeen(status?.body)?.use;
  for (const c of since) {
    if (c === status || !byDoor(gh, c) || !readFrom(c.body)?.setting) continue;
    const words = useCommand(withoutLine(c.body).trim());
    const next = words === undefined ? undefined : pickOf(words, use ?? {});
    if (next) use = { agent: next.agent, model: next.model, effort: next.effort };
  }
  return use ? { ...read, use } : read;
}

/** A task's state, as its head says it. */
export function stateWord(open: boolean | undefined, labels: string[]): string {
  if (open === false) return "Closed";
  const says: [string, string][] = [
    [NEEDS_YOU_LABEL, "Needs you"],
    ["working", "Working"],
    [STUCK_LABEL, "Stopped"],
    ["failed", "Failed"],
    ["repeats", "Repeating"],
    ["waiting", "Waiting"],
    ["answered", "Answered"],
  ];
  return says.find(([l]) => labels.includes(l))?.[1] ?? "Open";
}

/** `#240` alone: the task's head, "#240 · title · state · pick", for the reply box to open on. */
export const taskHead = (n: number, r: TaskRead) =>
  `#${n} · ${line(r.title ?? "", 80)} · ${stateWord(r.open, r.labels ?? [])} · ${pickLabel(r.use)}`;

// ---------------------------------------------------------------- buttons in rows

/** Buttons in rows that fit a phone: `most` a row, and about `width` characters of labels. */
function rowsOf(buttons: Button[], most = 3, width = 32): Button[][] {
  const rows: Button[][] = [];
  for (const b of buttons) {
    const row = rows.at(-1);
    const used = (row ?? []).reduce((n, x) => n + x.label.length, 0);
    if (row && row.length < most && used + b.label.length <= width) row.push(b);
    else rows.push([b]);
  }
  return rows;
}

// ---------------------------------------------------------------- /tasks

/** Open issues /tasks reads: GitHub's most for one page. */
const MOST_OPEN = 100;

/** An open issue, as /tasks and the pinned status read it. */
export interface OpenIssue {
  number: number;
  title: string;
  labels?: { name: string }[];
  pull_request?: unknown;
}

/** The open issues, newest change first: the same read the watch makes each tick. */
export const openIssues = (gh: GitHub) =>
  gh.json<OpenIssue[]>(
    "GET",
    `repos/${gh.repo}/issues?state=open&sort=updated&direction=desc&per_page=${MOST_OPEN}`,
  );

/**
 * /tasks: the open tasks by what they wait on, from one listing of them (the one the web chat's
 * list makes) and "Coming up" for a repeat's next time, each a button whose words are `#240`, so
 * a tap goes to it.
 */
export async function tasksAnswer(
  gh: GitHub,
  now: number,
): Promise<{ text: string; buttons: Button[][] }> {
  const [open, status] = await Promise.all([openIssues(gh), statusTask(gh)]);
  const rows = taskRows(open, [STATUS_LABEL, NOTEBOOK_LABEL], status?.record?.upcoming);
  const shown = inGroups(rows).flatMap((g) =>
    g.rows.map((r) => ({ label: `#${r.n}`, words: `#${r.n}` })),
  );
  // GitHub gives 100 at most in one read: past that, it says so rather than miscount.
  const more =
    open.length >= MOST_OPEN
      ? "\n\nMore are open than one read shows: the rest are on GitHub."
      : "";
  return { text: tasksText(rows, now) + more, buttons: rowsOf(shown, 4) };
}

// ---------------------------------------------------------------- the pinned status

/**
 * The status a chat keeps pinned (`/ping pin`), from reads the door or the watch made already: each
 * box's busy slots from its runners, and the tasks working, each line's number a link.
 */
export function pinOf(gh: GitHub, list: RawRunner[], open: OpenIssue[]) {
  const working = open
    .filter((i) => !i.pull_request && i.labels?.some((l) => l.name === WORKING_LABEL))
    .map((i) => ({ n: i.number, title: i.title }))
    .sort((a, b) => a.n - b.n);
  const shown: Shown = { tasksAt: `https://github.com/${gh.repo}/issues/` };
  return { text: pinText(toBoxes(list), working), shown };
}

// ---------------------------------------------------------------- the picker

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const tick = (yes: boolean, label: string) => (yes ? `${label} ✓` : label);
/** Efforts whose word isn't its own name. */
const EFFORT_NAMES: Record<string, string> = { xhigh: "Extra high" };

/** A model's plain name on its button: an agent's own, or a gateway's id after its maker, "free" on a free one. */
function modelName(model: string, gateway: boolean): string {
  const w = pickWord(model);
  if (!gateway) return title(w);
  return w.endsWith(":free") ? `${w.slice(0, -":free".length)} · free` : w;
}

/**
 * The picker: the pick of task #`task`, or your model (the one new tasks start with), then each
 * agent in executors.json in its own rows, its Auto first and then each model it lists, ✓ on the
 * current one; and, while the pick's agent takes efforts and has no gateway (its own models take
 * them all; a gateway's may ignore them), a row of its efforts. Every button names the whole pick,
 * so an old one means exactly what it says.
 */
export function picker(
  task: number | undefined,
  current: Picked = {},
): { text: string; buttons: Button[][] } {
  const seen = agentsSeen();
  const agent = current.agent ?? seen[0]?.[0] ?? "";
  const own = Object.fromEntries(seen)[agent];
  // A model another agent lists too (two on one gateway), or one through another gateway, is named with its agent,
  // as the row it's in.
  const shared = (a: string, m: string) =>
    Boolean(Object.fromEntries(seen)[a]?.extends) ||
    seen.some(([b, x]) => b !== a && x.models?.includes(m));
  const groups = seen.map(([a, e]) =>
    rowsOf([
      {
        label: tick(
          a === agent && !current.model && !current.effort,
          `${agentName(Object.fromEntries(seen), a)} · Auto`,
        ),
        words: `use ${a} auto`,
      },
      ...(e.models ?? []).map((m) => ({
        label: tick(a === agent && m === current.model, modelName(m, Boolean(e.gateway))),
        words: `use ${shared(a, m) ? `${a} ` : ""}${pickWord(m)}`,
      })),
    ]),
  );
  const takes = own && !own.gateway && effortsFor(own, current.model).length > 0;
  const base = current.model ? pickWord(current.model) : agent;
  const efforts: Button[] =
    takes && own.efforts?.length
      ? [
          { label: tick(!current.effort, "Auto"), words: `use ${base} auto` },
          ...own.efforts.map((x) => ({
            label: tick(x === current.effort, EFFORT_NAMES[x] ?? title(x)),
            words: `use ${base} ${x}`,
          })),
        ]
      : [];
  const label = pickLabel(current, true);
  const text = [
    task ? `#${task} uses ${label}` : `Your model: ${label}`,
    // Its words stand without buttons too (a chat with none): what to type is said.
    task
      ? `Tap one, or send use and its name: #${task} uses it from your next message.`
      : "Tap one, or send use and its name: your new tasks start with it. To change one task only, reply /use to it.",
    ...(efforts.length
      ? [`The last rows are ${agentName(Object.fromEntries(seen), agent)}'s effort.`]
      : []),
  ].join("\n");
  return { text, buttons: [...groups.flat(), ...rowsOf(efforts)] };
}
