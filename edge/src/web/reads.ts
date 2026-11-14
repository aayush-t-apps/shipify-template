// What the chat shows (ADR 0036, "What it looks like"): every read is GitHub's record, as the door
// App sees it, shaped for the page (shapes.ts). Nothing here writes. A list is three calls (50
// open tasks and PRs, without their rendered bodies; the task runs; the runners), and an older page
// of it, or of the closed ones, one; a thread two at once (the task or PR, and its first 100
// comments: all of most threads, and the run's status comment), past 100 its newest page too (and
// the one before, when that's short) or only what's new since the page's last, and one per PR of
// shipify's it names, at most three, kept 60 s; a split task's (ADR 0066) one GraphQL read more,
// for its parts, kept 60 s; its Progress (ADR 0069) one render, kept a day by its words.
import {
  AFTER_CLOSE_MS,
  acknowledgement,
  closedProjectText,
  GUEST_LABEL,
  guestLabel,
  IN_PROJECT_LABEL,
  inertImages,
  LIBRARY_LABEL,
  NEEDS_YOU_LABEL,
  PROJECT_LABEL,
  projectNameOf,
  projectOfLabels,
  shownProject,
  pickIn,
  readFrom,
  readReply,
  readTaskSeen,
  replyButtons,
  shortDay,
  STARTED_LABEL,
  STATE_LABELS,
  STAYING_LABEL,
  STUCK_LABEL,
  SUB_TASK_LABEL,
  TASK_MARK,
  withoutLine,
  withUpcoming,
  withZone,
} from "../../../cli/contracts/index.ts";
import { cached, recall, remember } from "../cache.ts";
import { channelOf } from "../channels/index.ts";
import { build, type Deps, type Env } from "../env.ts";
import {
  byDoor,
  byRun,
  type GitHub,
  GitHubError,
  github,
  guestsOwn,
  RUN_WRITER,
} from "../github.ts";
import {
  libraryPages,
  NOTEBOOK_LABEL,
  notebookPages,
  runners,
  type Settings,
  STATUS_LABEL,
  toBoxes,
} from "../settings.ts";
import {
  clean,
  esc,
  type Inside,
  insideOf,
  splitDetails,
  withoutEchoes,
  withoutPick,
} from "./clean.ts";
import { render } from "./docs.ts";
import { PICTURE } from "./files.ts";
import { read, readOr, reader } from "./gh.ts";
import { defaultAgentId, statusOf } from "./setup.ts";
import type {
  FileSeen,
  Found,
  List,
  Msg,
  Notebook,
  Origin,
  Part,
  Repeats,
  Running,
  State,
  Thread,
} from "./shapes.ts";

/** Where the page asks for a file the edge keeps. */
export const fileSrc = (ref: string) => `api/file/${ref}`;
/** Where it asks for one a chat keeps (`telegram:<id>`): fetched through the channel each time. */
export const sentSrc = (ref: string, type?: string) =>
  `api/sent/${encodeURIComponent(ref)}${type && PICTURE.test(type) ? `?type=${encodeURIComponent(type)}` : ""}`;

interface Issue {
  number: number;
  title: string;
  state: string;
  body?: string | null;
  body_html?: string;
  html_url: string;
  updated_at: string;
  created_at: string;
  closed_at?: string | null;
  comments?: number;
  locked?: boolean;
  labels?: { name: string }[];
  user?: { login?: string; type?: string; id?: number } | null;
  performed_via_github_app?: { id?: number } | null;
  pull_request?: { merged_at?: string | null } | null;
  reactions?: { eyes?: number };
  /** GitHub's own counts, on every issue it answers (ADR 0066): its sub-issues, its open blockers. */
  sub_issues_summary?: { total?: number; completed?: number } | null;
  issue_dependencies_summary?: { blocked_by?: number } | null;
}

interface Comment {
  id: number;
  body?: string | null;
  body_html?: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  user?: { login?: string; type?: string; id?: number } | null;
  performed_via_github_app?: { id?: number } | null;
  reactions?: { eyes?: number };
}

interface Run {
  id: number;
  status: string;
  display_title: string;
  html_url?: string;
  created_at: string;
  run_started_at?: string;
}

const labelsOf = (i: Issue) => (i.labels ?? []).map((l) => l.name);

/** Labels the row says otherwise: its state, and where it came from. */
// A run's own phase labels ("working", "answered") are its state, which each row shows: not filters.
const SAID = new Set([
  NEEDS_YOU_LABEL,
  STAYING_LABEL,
  STUCK_LABEL,
  "working",
  "answered",
  "repeats",
  "recipe",
  "waiting",
  SUB_TASK_LABEL,
  STARTED_LABEL,
  PROJECT_LABEL,
  IN_PROJECT_LABEL,
]);
/** A task's other labels (yours from GitHub, "failed", "deploying"): the list filters by them. */
const tagsOf = (i: Issue) =>
  labelsOf(i).filter((l) => !SAID.has(l) && l !== GUEST_LABEL && !l.startsWith(`${GUEST_LABEL}:`));

/** Not a task the chat lists: a PR, the status task, a notebook or Library page (ADR 0069). */
const hidden = (i: Issue) =>
  Boolean(i.pull_request) ||
  labelsOf(i).some((l) => l === STATUS_LABEL || l === NOTEBOOK_LABEL || l === LIBRARY_LABEL);

/** Where a task started. */
function originOf(gh: GitHub, i: Issue): Origin {
  const labels = labelsOf(i);
  if (labels.includes("recipe")) return "recipe";
  if (labels.includes("repeats")) return "repeat";
  const from = byDoor(gh, i) ? readFrom(i.body)?.channel : undefined;
  return from ?? "github";
}

/** A run stays on it after its answer (ADR 0057): your next words are answered in seconds. */
const staying = (i: Issue) => i.state === "open" && labelsOf(i).includes(STAYING_LABEL);

function stateOf(i: Issue, running: boolean): State {
  if (i.state === "closed") return "closed";
  const labels = labelsOf(i);
  if (labels.includes(NEEDS_YOU_LABEL)) return "needs-you";
  // A run that stays after its answer (ADR 0057) is going, but waits for you: Working only while
  // a turn runs (the thread reads that from its status), else Staying (`staying`).
  if (running && !staying(i)) return "working";
  // Blocked by a task still open (ADR 0066): Waiting, from GitHub's own count.
  if ((i.issue_dependencies_summary?.blocked_by ?? 0) > 0) return "waiting";
  if (labels.includes(STUCK_LABEL)) return "stuck";
  return "open";
}

/**
 * A part's parent (ADR 0066), or a chat's project (ADR 0069): its body's first line after the
 * door's hidden one, `Part of #<n>`.
 */
const parentOf = (i: Issue) =>
  Number(/^Part of #(\d+)[ \t]*(?:\r?\n|$)/.exec(withoutLine(i.body ?? ""))?.[1]) || undefined;

/** How long a moved chat's project is kept: a move is once (capture.ts `moveToProject`). */
const MOVED_MS = 86_400_000;

/**
 * Each one's parent, as `parentOf` reads it, or for a chat moved into a project (its `in-project`
 * label, no `Part of` line) GitHub's link: those in one GraphQL call for all, each kept a day, so
 * the list folds it under its project at once and a read costs one call more at most.
 */
async function parentsOf(gh: GitHub, deps: Deps, issues: Issue[]) {
  const now = deps.now();
  const key = (n: number) => `web:moved:${gh.repo}:${n}`;
  const out = new Map<number, number>();
  const ask: number[] = [];
  for (const i of issues) {
    const was = parentOf(i) ?? recall<number>(key(i.number), now);
    if (was) out.set(i.number, was);
    else if (was === undefined && labelsOf(i).includes(IN_PROJECT_LABEL)) ask.push(i.number);
  }
  if (!ask.length) return out;
  const [owner, name] = gh.repo.split("/");
  const each = ask.map((n) => `i${n}: issue(number: ${n}) { parent { number } }`).join(" ");
  const d = await gh
    .graphql<{ repository?: Record<string, { parent?: { number: number } | null } | null> }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${each} } }`,
      { owner, name },
    )
    .catch(() => undefined);
  for (const n of d ? ask : []) {
    // None (0) is kept too, so a label with no link isn't asked on every read.
    const p = d?.repository?.[`i${n}`]?.parent?.number ?? 0;
    remember(key(n), p, MOVED_MS, now);
    if (p) out.set(n, p);
  }
  return out;
}

/**
 * The chat each of these tasks is under (a project, or a split's task), by number: one GraphQL read
 * for 100 at most, kept a minute. For Files (ADR 0069), so a closed project's chats, which the list
 * doesn't hold, stay under it. None for one that's under nothing, or when GitHub fails.
 */
export function chatParents(
  env: Env,
  deps: Deps,
  tasks: number[],
): Promise<Record<string, number>> {
  const gh = github(env, deps);
  const ns = [...new Set(tasks)].sort((a, b) => a - b).slice(0, 100);
  if (!ns.length) return Promise.resolve({});
  const [owner, name] = gh.repo.split("/");
  const each = ns.map((n) => `i${n}: issue(number: ${n}) { parent { number } }`).join(" ");
  const look = async () => {
    const d = await gh.graphql<{
      repository?: Record<string, { parent?: { number: number } | null } | null>;
    }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${each} } }`,
      { owner, name },
    );
    return Object.fromEntries(
      ns.flatMap((n) => {
        const p = d.repository?.[`i${n}`]?.parent?.number;
        return p ? [[String(n), p]] : [];
      }),
    );
  };
  return cached(`web:parents:${gh.repo}:${ns.join(",")}`, PLAN_MS, look, deps.now()).catch(
    () => ({}),
  );
}

/** A split task's parts, closed of all: GitHub's count, on the issue already. */
const partsOf = (i: Issue) => {
  const total = i.sub_issues_summary?.total ?? 0;
  return total > 0 ? { done: i.sub_issues_summary?.completed ?? 0, total } : undefined;
};

/** Done, as a blocker: closed as completed. A dropped one (not planned) isn't. */
const done = (x: { state: string; stateReason?: string | null }) =>
  x.state === "CLOSED" && (x.stateReason ?? "COMPLETED") === "COMPLETED";

interface PartNode {
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  labels?: { nodes?: { name: string }[] };
  blockedBy?: { nodes?: { number: number; state: string; stateReason?: string | null }[] };
  closedByPullRequestsReferences?: { nodes?: { number: number; url: string }[] };
}

const PLAN = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $n) { subIssues(first: 100) { nodes {
    number title state stateReason labels(first: 20) { nodes { name } }
    blockedBy(first: 20) { nodes { number state stateReason } }
    closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { nodes { number url } }
  } } } }
}`;
/** How long a plan is kept: a parent's thread polls every few seconds, its parts change seldom. */
const PLAN_MS = 60_000;

/** One part as the Plan card shows it: its state as a list row's, ready, what it waits for. */
function partOf(x: PartNode): Part {
  const labels = (x.labels?.nodes ?? []).map((l) => l.name);
  const open = x.state === "OPEN";
  const blockers = (x.blockedBy?.nodes ?? []).filter((b) => !done(b));
  const after = open ? blockers.map((b) => b.number) : [];
  const ran = labels.some((l) => (STATE_LABELS as readonly string[]).includes(l));
  const state = !open
    ? "closed"
    : labels.includes(NEEDS_YOU_LABEL)
      ? "needs-you"
      : labels.includes("working")
        ? "working"
        : blockers.some((b) => b.state === "OPEN")
          ? "waiting"
          : labels.includes(STUCK_LABEL)
            ? "stuck"
            : "open";
  const pr = x.closedByPullRequestsReferences?.nodes?.[0];
  return {
    n: x.number,
    title: x.title,
    state,
    ...(open || done(x) ? {} : { dropped: true as const }),
    ...(open && !ran && !after.length ? { ready: true as const } : {}),
    ...(after.length ? { after } : {}),
    ...(pr ? { pr: { n: pr.number, url: pr.url } } : {}),
  };
}

/** A split task's parts, in order: one GraphQL read, kept PLAN_MS for every tab and phone. */
function planOf(gh: GitHub, deps: Deps, n: number) {
  const [owner, name] = gh.repo.split("/");
  return cached(
    `web:plan:${gh.repo}:${n}`,
    PLAN_MS,
    async () => {
      const d = await gh.graphql<{
        repository?: { issue?: { subIssues?: { nodes?: PartNode[] } } | null } | null;
      }>(PLAN, { owner, name, n });
      return (d.repository?.issue?.subIssues?.nodes ?? []).map(partOf);
    },
    deps.now(),
  );
}

/** The task runs going now, by task. */
async function liveRuns(env: Env, deps: Deps, gh: GitHub): Promise<Map<number, Running>> {
  const runs = await read<{ workflow_runs?: Run[] }>(
    env,
    deps,
    `repos/${gh.repo}/actions/workflows/task.yml/runs?per_page=20`,
  ).catch(() => ({ workflow_runs: [] as Run[] }));
  const out = new Map<number, Running>();
  for (const r of runs.workflow_runs ?? []) {
    const n = Number(/^task #(\d+)$/.exec(r.display_title)?.[1] ?? 0);
    if (!n || r.status === "completed" || out.has(n)) continue;
    out.set(n, {
      n,
      title: "",
      since: r.run_started_at ?? r.created_at,
      url: r.html_url ?? `https://github.com/${gh.repo}/actions/runs/${r.id}`,
      queued: r.status === "queued" || r.status === "waiting" || r.status === "pending",
    });
  }
  return out;
}

/**
 * Your boxes as a guest's list has them (ADR 0071): only whether one is online, so their chat says
 * "Starting…", not "Waiting for a box"; no name, slot or load of yours.
 */
const unnamed = (b: { online: boolean }[]) => [
  { name: "", online: b.some((x) => x.online), slots: 0, busy: 0 },
];

/** Tasks (and PRs) a page of a guest's list reads. */
export const LIST_PAGE = 50;
/**
 * Tasks (and PRs) a page of your list reads (ADR 0071): GitHub's most, still one read, so guests'
 * open chats, which share the repo's open issues and are left out, don't push yours off the page.
 */
export const OWNER_PAGE = 100;

/** The task a PR's body names: "Closes owner/shipify#12", or "Part of …". */
const taskOfPr = (body: string | null | undefined) =>
  Number(/\b(?:Closes|Fixes|Part of)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/i.exec(body ?? "")?.[1]) ||
  undefined;

/**
 * The list: what's running, the boxes, shipify's open PRs (for review), and the 100 open tasks
 * updated last, guests' left out. The closed ones (`closed`), and an older page (`page` 2 on), are
 * only their tasks: what's running, the boxes and the PRs come with the open list's first page.
 * A guest's (ADR 0071): their own chats and projects, read by their label (an issue list, never a
 * search, so an unchanged answer is free), what of theirs is running, whether a box is online
 * (`unnamed`), and nothing else.
 */
export async function list(
  env: Env,
  deps: Deps,
  page = 1,
  closed = false,
  guest?: string,
): Promise<List> {
  const gh = github(env, deps);
  const first = page === 1 && !closed;
  const per = guest ? LIST_PAGE : OWNER_PAGE;
  const theirs = guest ? `&labels=${encodeURIComponent(guestLabel(guest))}` : "";
  const [issues, live, boxes] = await Promise.all([
    read<Issue[]>(
      env,
      deps,
      `repos/${gh.repo}/issues?state=${closed ? "closed" : "open"}${theirs}&sort=updated&direction=desc&per_page=${per}${page > 1 ? `&page=${page}` : ""}`,
      { html: false },
    ),
    first ? liveRuns(env, deps, gh) : new Map<number, Running>(),
    first
      ? runners(gh, deps.now(), 30_000, reader(env, deps))
          .then(toBoxes)
          .then((b) => (guest ? unnamed(b) : b))
          .catch(() => [])
      : [],
  ]);
  const shown = issues.filter(
    (i) => !hidden(i) && (guest ? !i.pull_request : !labelsOf(i).includes(GUEST_LABEL)),
  );
  const parents = await parentsOf(gh, deps, shown);
  const tasks = shown.map((i) => {
    const labels = tagsOf(i);
    // A project's chats aren't a split's parts (ADR 0069): it says its name and how many.
    const name = labelsOf(i).includes(PROJECT_LABEL) ? projectNameOf(i.title) : undefined;
    const parts = name ? undefined : partsOf(i);
    const parent = parents.get(i.number);
    return {
      n: i.number,
      title: i.title,
      state: stateOf(i, live.has(i.number)),
      from: originOf(gh, i),
      updated: i.updated_at,
      url: i.html_url,
      ...(staying(i) ? { staying: true as const } : {}),
      ...(labels.length ? { labels } : {}),
      ...(parts ? { parts } : {}),
      ...(name
        ? { project: { name: shownProject(name), chats: i.sub_issues_summary?.total ?? 0 } }
        : {}),
      ...(parent ? { parent } : {}),
    };
  });
  const review = issues
    .filter((i) => first && !guest && i.pull_request && i.state === "open")
    .map((i) => {
      const task = taskOfPr(i.body);
      return {
        n: i.number,
        title: i.title,
        updated: i.updated_at,
        url: i.html_url,
        ...(task ? { task } : {}),
      };
    });
  const titles = new Map(tasks.map((t) => [t.n, t.title]));
  // A guest sees only their own running, and no run's link (ADR 0071).
  const running = [...live.values()]
    .filter((r) => !guest || titles.has(r.n))
    .map((r) => ({
      ...r,
      title: titles.get(r.n) ?? `#${r.n}`,
      ...(guest ? { url: `https://github.com/${gh.repo}/issues/${r.n}` } : {}),
    }));
  return {
    v: 1,
    version: build(env),
    boxes,
    running,
    review,
    tasks,
    closed,
    page,
    more: issues.length === per,
  };
}

/** A body's `use …` line: its last, as the box reads it. */
const useOf = pickIn;

/** Yours: written by the door for you, or on GitHub by the owner. */
const yoursOn = (gh: GitHub, owner: string | undefined, c: Comment) =>
  (byDoor(gh, c) && Boolean(readFrom(c.body))) ||
  (owner !== undefined && (c.user?.login ?? "").toLowerCase() === owner);

/**
 * What a task's runs think with: a `use …` you said after its status comment was last written (not
 * read by a run yet), else the status comment's choice, else your newest `use …`. Read from the whole
 * page, so a poll for only what's newer still says it. Undefined is Auto.
 */
function choiceOf(gh: GitHub, owner: string | undefined, all: Comment[], status?: Comment) {
  const said = all
    .filter((c) => yoursOn(gh, owner, c))
    .map((c) => ({ at: c.created_at, use: useOf(withoutLine(c.body)) }))
    .filter((x) => x.use)
    .at(-1);
  const u = readTaskSeen(status?.body)?.use;
  if (said && (!u || Date.parse(said.at) > Date.parse(status?.updated_at ?? ""))) return said.use;
  // Its agent named when it isn't the default one, as a pick says it ("pi z-ai/glm-5.3").
  const agent = u?.agent && u.agent !== defaultAgentId() ? u.agent : undefined;
  return (u && [agent, u.model, u.effort].filter(Boolean).join(" ")) || undefined;
}

const html = (h: string | undefined, url: string, inside?: Inside) => {
  const c = clean(h ?? "", undefined, inside);
  return c.trimmed
    ? `${c.html}<p class="trimmed"><a href="${url.replace(/"/g, "")}" target="_blank" rel="noopener noreferrer">Open on GitHub to see all of it</a></p>`
    : c.html;
};

// A message comes out the same for the same comment as last time (where it is, when it was last
// edited, its 👀): built once in this Worker, not on every refresh, so an open thread's refreshes
// clean no HTML again. Only the newest few hundred are kept; nothing outside this instance.
const built = new Map<string, Msg | null>();
const MOST_BUILT = 400;
function messageOnce(gh: GitHub, owner: string | undefined, c: Comment & { id: number }) {
  const key = `${owner}|${c.html_url}|${c.updated_at ?? c.created_at}|${c.reactions?.eyes ?? 0}`;
  if (built.has(key)) return built.get(key) ?? null;
  const m = message(gh, owner, c);
  built.set(key, m);
  if (built.size > MOST_BUILT) built.delete(built.keys().next().value as string);
  return m;
}
/** For tests: each case starts with none built. */
export const clearBuilt = () => built.clear();

/** One message, as the page shows it. Null for what isn't one (a run's status comment). */
function message(gh: GitHub, owner: string | undefined, c: Comment & { id: number }): Msg | null {
  const body = c.body ?? "";
  if (body.startsWith(TASK_MARK)) return null;
  const md = withoutLine(body).trim();
  const login = c.user?.login ?? "";
  const from = byDoor(gh, c) ? readFrom(body) : undefined;
  const reply = byRun(c) ? readReply(body) : undefined;
  const yours = Boolean(from) || (owner !== undefined && login.toLowerCase() === owner);
  const who = reply || (byRun(c) && login === RUN_WRITER) ? "shipify" : yours ? "you" : "other";
  const files: FileSeen[] = [
    ...(from?.files ?? []).map((f) => {
      const [channel, ref] = [
        f.ref.slice(0, f.ref.indexOf(":")),
        f.ref.slice(f.ref.indexOf(":") + 1),
      ];
      return {
        name: f.name,
        ...(f.type ? { type: f.type } : {}),
        ...(f.size !== undefined ? { size: f.size } : {}),
        ...(channel === "web"
          ? { src: fileSrc(ref) }
          : channelOf(channel)?.file
            ? { src: sentSrc(f.ref, f.type) }
            : {}),
      };
    }),
    // A run's files (ADR 0071), each kept under the ref its reply's line names; yours, backed up
    // on `shipify-files` too: where its chip links once the kept copy has gone.
    ...(reply?.files ?? []).map((f) => ({
      name: f.name,
      ...(f.type ? { type: f.type } : {}),
      ...(f.size !== undefined ? { size: f.size } : {}),
      src: fileSrc(f.ref),
      ...(f.backup ? { backup: f.backup } : {}),
    })),
  ];
  // Its links to shipify's issues, and to the files it names, open in the window (ADR 0071).
  const inside = insideOf(gh.repo, files);
  const split = who === "shipify" ? splitDetails(html(c.body_html, c.html_url, inside)) : undefined;
  const use = who === "you" ? useOf(md) : undefined;
  // A reply's question and links show from its line, your pick from its tag: not twice.
  const shown = split ? split.html : html(c.body_html, c.html_url, inside);
  const words = use ? withoutPick(shown) : shown;
  return {
    id: c.id,
    who,
    name: who === "shipify" ? "Shipify" : (from?.person ?? login),
    at: c.created_at,
    html: reply ? withoutEchoes(words, reply, inside) : words,
    md,
    ...(split?.details ? { details: split.details } : {}),
    ...(reply
      ? {
          reply: {
            kind: reply.kind,
            state: reply.state,
            ...(reply.brief ? { brief: reply.brief } : {}),
            ...(reply.run ? { run: reply.run } : {}),
            ...(reply.question ? { question: reply.question } : {}),
            ...(reply.choices?.length ? { choices: reply.choices } : {}),
            links: reply.links,
            // Its buttons, as every chat has them.
            buttons: replyButtons(reply, md).rows.flat(),
          },
        }
      : {}),
    files,
    ...(use ? { use } : {}),
    // 👀 from a run: it read these words (GitHub's count comes with the comment, no extra read).
    ...(who === "you" && (c.reactions?.eyes ?? 0) > 0 ? { read: true as const } : {}),
    // A button's word (ADR 0069): kept for what follows from it, never drawn as a message.
    ...(from?.button ? { tap: true as const } : {}),
    url: c.html_url,
  };
}

/**
 * A message as a guest sees it (ADR 0071): no reply's run details (your box, your plan's use, the
 * run's link, its numbers).
 */
function forGuest(m: Msg): Msg {
  const { details: _d, ...rest } = m;
  if (!rest.reply) return rest;
  const { run: _r, ...reply } = rest.reply;
  // Its Markdown (Copy, Download) without the fold: the same HTML block in it.
  return { ...rest, md: splitDetails(rest.md).html.trimEnd(), reply };
}

/**
 * Your last words on a closed task carry it on: a minute or more after its close, and more than a
 * thanks (decide.ts). The run they start opens it again, so the page shows it starting meanwhile.
 */
function wakes(gh: GitHub, owner: string | undefined, i: Issue, all: Comment[]): boolean {
  if (i.state !== "closed") return false;
  const c = all.findLast((x) => !(x.body ?? "").startsWith(TASK_MARK));
  if (!c?.id) return false;
  const yours =
    (byDoor(gh, c) && readFrom(c.body)) ||
    (owner !== undefined && c.user?.login?.toLowerCase() === owner);
  return (
    Boolean(yours) &&
    Date.parse(c.created_at) > Date.parse(i.closed_at ?? "") + AFTER_CLOSE_MS &&
    acknowledgement(withoutLine(c.body ?? "")) !== "thanks"
  );
}

/** Whether the door writes your words on it: as it decides in door-in.ts (readTask). */
function writable(gh: GitHub, s: Settings, i: Issue) {
  if (hidden(i) || i.locked) return false;
  const login = i.user?.login?.toLowerCase() ?? "";
  return (
    byDoor(gh, i) ||
    login === RUN_WRITER ||
    (s.owner !== undefined && login === s.owner.toLowerCase())
  );
}

/** A newest page with fewer comments has the one before it read too. */
const FULL = 40;
/** How long a PR's state, named in a thread, is kept. */
const PR_MS = 60_000;

/** How long a Progress, once rendered, is kept: by its words, so a changed one renders again. */
const PROGRESS_MS = 86_400_000;

/**
 * A task's Progress (ADR 0069): its run's handoff, rendered by GitHub as the doc pane's Markdown is
 * and cleaned. A run that read the web may write anything, and a Progress needs no pictures: every
 * `![` is escaped and every tag that fetches is text before GitHub sees it (`inertImages`).
 * GitHub can't render it just now: its words as text, not kept, so a later read renders it.
 */
async function progressOf(env: Env, deps: Deps, notes: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(notes));
  const key = `web:progress:${[...new Uint8Array(hash).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const inert = inertImages(notes);
  return cached(
    key,
    PROGRESS_MS,
    () => render(env, deps, inert, env.GITHUB_REPO),
    deps.now(),
  ).catch(() => `<pre>${esc(notes)}</pre>`);
}

/** A PR's state, from its issue: open, merged or closed. */
const prState = (i: Issue) =>
  i.pull_request?.merged_at ? "merged" : i.state === "closed" ? "closed" : "open";

/** How long one search's answer is kept: GitHub allows 10 by meaning a minute (ADR 0070). */
const SEARCH_MS = 60_000;

/**
 * Find by meaning (ADR 0070): GitHub's hybrid issue search on your shipify repo, its chats,
 * projects and pages (an Inbox's items are comments, which it doesn't search). When GitHub refuses
 * it (its 10 a minute) or answers by words, the answer is words', and says so. Kept a minute.
 */
export async function search(env: Env, deps: Deps, words: string, guest?: string): Promise<Found> {
  // A guest's Find is kept to their label; yours leaves guests' out (ADR 0071).
  const whose = guest ? `label:"${guestLabel(guest)}"` : `-label:${GUEST_LABEL}`;
  const q = encodeURIComponent(`repo:${env.GITHUB_REPO} is:issue ${whose} ${words}`);
  type Hits = { items?: Issue[]; search_type?: string };
  const look = async (): Promise<Hits> => {
    try {
      return await read<Hits>(env, deps, `search/issues?q=${q}&search_type=hybrid&per_page=10`, {
        html: false,
      });
    } catch (e) {
      if (!(e instanceof GitHubError) || ![403, 422, 429].includes(e.status)) throw e;
      return read<Hits>(env, deps, `search/issues?q=${q}&per_page=10`, { html: false });
    }
  };
  const r = await cached(
    `web:search:${env.GITHUB_REPO}:${guest ?? ""}:${words.toLowerCase()}`,
    SEARCH_MS,
    look,
    deps.now(),
  );
  return {
    v: 1,
    ...(r.search_type === "hybrid" ? {} : { words: true as const }),
    items: (r.items ?? [])
      .filter(
        (i) =>
          !i.pull_request &&
          (guest ? labelsOf(i).includes(guestLabel(guest)) : !labelsOf(i).includes(GUEST_LABEL)),
      )
      .map((i) => {
        const labels = labelsOf(i);
        const page = /^Notebook: /.test(i.title);
        return {
          n: i.number,
          title: page ? i.title.slice("Notebook: ".length) : i.title,
          kind: page ? "page" : labels.includes(PROJECT_LABEL) ? "project" : "chat",
          open: i.state === "open",
        };
      }),
  };
}

/**
 * A doc's name in the window (ADR 0071): "Research", not "Notebook: health-project-research". A
 * project's main page is its Overview; its other pages, the rest of their topic. GitHub keeps the
 * title.
 */
export function docName(topic: string, project?: string) {
  if (!project) return topic;
  if (topic === project) return "Overview";
  const rest = topic.startsWith(`${project}-`) ? topic.slice(project.length + 1) : topic;
  return rest ? `${rest[0]?.toUpperCase()}${rest.slice(1).replace(/-/g, " ")}` : topic;
}

/**
 * What Close asks first, on a project (ADR 0069): how many of its chats it closes too, what stays,
 * and when its files go if it's closed now.
 */
export function closeAsk(name: string, chats: { state: string }[], now: number) {
  const open = chats.filter((c) => c.state !== "closed").length;
  const them = open ? ` and its ${open} open ${open === 1 ? "chat" : "chats"}` : "";
  return `Close ${name}${them}? ${closedProjectText(new Date(now).toISOString())}`;
}

/** Finds waiting in an Inbox that make a collate the next step: the one number here (ADR 0070). */
export const INBOX_FULL = 10;

/**
 * A project's one next step (ADR 0070), from counts its page reads already, with no run: a chat
 * waiting on you, a full Inbox, a first question, a first fact kept, a check before a decision,
 * and Close when every chat is done. Closed (ADR 0069): when, what stays and goes, and Reopen.
 */
export function nextStep(p: {
  chats: { n: number; state: string }[];
  inbox: number;
  map: number;
  now: string[];
  closed?: string;
}): string {
  if (p.closed)
    return `Closed ${shortDay(Date.parse(p.closed))}. ${closedProjectText(p.closed)} Reopen it to ask or add again.`;
  const open = p.chats.filter((c) => c.state !== "closed");
  const you = open.find((c) => c.state === "needs-you" || c.state === "stuck");
  if (you) return `#${you.n} waits on you: open it below.`;
  if (p.inbox >= INBOX_FULL) return `${p.inbox} finds wait in the Inbox: Collate the inbox.`;
  if (!p.chats.length)
    return "Ask a first question in the box below, or Add a find: no run starts.";
  if (!p.map)
    return "A good answer in a chat? Keep on page, under it, puts it on the project's page.";
  if (p.now.some((l) => /^open questions?:\s*\S/i.test(l)))
    return "Questions are open in Now: before you decide, say “check the project” in a chat.";
  if (!open.length) return "Every chat is done: Close the project when it is too. Its pages stay.";
  return "Send starts a chat here; open one below to carry it on. Add keeps a find, with no run.";
}

/**
 * A thread: the task and its newest page of messages (and the page before, when the newest has
 * few), or only those after `since`, when given; or an older page (`page`, for "Earlier
 * messages"). A PR of shipify's reads the same way, to review in the chat: its description and
 * comments, and the task it's for; it takes no words from here.
 */
export async function thread(
  env: Env,
  deps: Deps,
  s: Settings,
  n: number,
  since: string | undefined,
  older?: number,
  guest?: string,
): Promise<Thread | null> {
  const gh = github(env, deps);
  const path = `repos/${gh.repo}/issues/${n}/comments?per_page=100`;
  const page = (p: number) => read<Comment[]>(env, deps, `${path}&page=${p}`);
  // The task and its first page at once: the newest too for most threads, and the run's status
  // comment for all (the first a run wrote, findStatus). Unchanged, each is a 304.
  const one = page(1);
  // Only for the Working line, when page 1 isn't shown: one that can't be read leaves it out.
  const first = one.catch(() => [] as Comment[]);
  const [issue] = await Promise.all([
    readOr<Issue>(env, deps, `repos/${gh.repo}/issues/${n}`),
    first,
  ]);
  if (!issue) return null;
  // A guest's (ADR 0071): only a chat whose opening line the door wrote names them. Anything else
  // is none to them, read no further.
  if (guest && !guestsOwn(gh, issue, guest)) return null;
  const newest = Math.max(1, Math.ceil((issue.comments ?? 0) / 100));
  const at = (p: number) => (p === 1 ? one : page(p));
  const earlierPage = older && older < newest ? older : undefined;
  // What's shown, from its page on: an older page (`page`); past page 1, only what's new since
  // `since`, by time, so none landing as a page fills is missed; else the newest page, with the one
  // before when it has under FULL, so a thread just past 100 opens with its last messages.
  const shown = async (): Promise<[number, Comment[]]> => {
    if (earlierPage) return [earlierPage, await at(earlierPage)];
    if (since && newest > 1)
      return [
        newest,
        await read<Comment[]>(env, deps, `${path}&since=${new Date(since).toISOString()}`),
      ];
    const last = await at(newest);
    if (newest === 1 || last.length >= FULL) return [newest, last];
    return [newest - 1, [...(await at(newest - 1)), ...last]];
  };
  // A project (ADR 0069) is no split parent: its chats and pages instead of a Plan card.
  const projectName = labelsOf(issue).includes(PROJECT_LABEL)
    ? projectNameOf(issue.title)
    : undefined;
  const [[last, comments], plan, pages] = await Promise.all([
    shown(),
    // A split task's Plan card (ADR 0066): a plan that can't be read leaves the card out.
    (projectName || partsOf(issue)) && !issue.pull_request
      ? planOf(gh, deps, n).catch(() => undefined)
      : undefined,
    projectName ? keptLibrary(env, deps).catch(() => []) : undefined,
  ]);
  // Its main page's Now, and its one next step from counts (ADR 0070).
  const theirs = (pages ?? []).filter((p) => p.project === projectName);
  const main = theirs.find((p) => p.now);
  const project = projectName
    ? {
        // A guest's without their prefix (ADR 0071): the name they gave, which their words use.
        name: shownProject(projectName),
        chats: plan ?? [],
        pages: theirs.map(({ n, topic, first, size, updated, waiting, url }) => ({
          n,
          topic,
          name: docName(topic, projectName),
          first,
          size,
          updated,
          ...(waiting !== undefined ? { waiting } : {}),
          url,
        })),
        ...(main?.now?.length ? { now: main.now } : {}),
        step: nextStep({
          chats: plan ?? [],
          inbox: theirs.find((p) => p.waiting !== undefined)?.waiting ?? 0,
          map: main?.map ?? 0,
          now: main?.now ?? [],
          ...(issue.state === "closed" ? { closed: issue.closed_at ?? issue.updated_at } : {}),
        }),
        ...(issue.state === "open"
          ? { ask: closeAsk(shownProject(projectName), plan ?? [], deps.now()) }
          : {}),
      }
    : undefined;
  const owner = s.owner?.toLowerCase();
  // A task written on GitHub with only a title: its first message is that title, not an empty one.
  const words = Boolean(issue.body?.trim());
  const own: Comment = {
    id: 0,
    body: words ? (issue.body ?? "") : issue.title,
    ...(!words
      ? { body_html: `<p>${esc(issue.title)}</p>` }
      : issue.body_html !== undefined
        ? { body_html: issue.body_html }
        : {}),
    html_url: issue.html_url,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    user: issue.user ?? null,
    performed_via_github_app: issue.performed_via_github_app ?? null,
    // A run's 👀 on the task: its own words read, as a comment's.
    ...(issue.reactions ? { reactions: issue.reactions } : {}),
  };
  const all = [...(last > 1 ? [] : [own]), ...comments];
  const after = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  // Your words that start no run (task.yml): on a PR or a page, and a project's own (its body).
  const norun = (m: Msg) => m.who === "you" && (hidden(issue) || (projectName && m.id === 0));
  const messages = all
    .filter((c) => !since || Date.parse(c.created_at) > after)
    .flatMap((c) => messageOnce(gh, owner, c) ?? [])
    .map((m) => (norun(m) ? { ...m, norun: true as const } : m))
    .map((m) => (guest ? forGuest(m) : m));
  // The run under way, from its status comment (the run writes it first, and clears it at the end).
  const status = [...(await first), ...comments].find(
    (c) => (c.body ?? "").startsWith(TASK_MARK) && byRun(c),
  );
  const seen = readTaskSeen(status?.body);
  const working = seen?.working;
  // Its Progress, from there too: in a task's newest view, not an older page or a PR's.
  const notes = !earlierPage && !issue.pull_request && seen?.notes?.trim();
  const progress = notes ? progressOf(env, deps, notes) : undefined;
  const running = working
    ? {
        n,
        title: issue.title,
        since: status?.updated_at ?? issue.updated_at,
        url: guest ? issue.html_url : `https://github.com/${gh.repo}/actions/runs/${working}`,
        queued: false,
      }
    : undefined;
  // Its PRs, from the links in its replies: shipify's own say open or merged.
  const prUrls = [
    ...new Set(
      messages.flatMap((m) =>
        (m.reply?.links ?? []).map((l) => l[1]).filter((u) => /\/pull\/\d+$/.test(u)),
      ),
    ),
  ];
  // Each one's state kept a minute, not read again on every poll.
  const prs = await Promise.all(
    prUrls.slice(0, 6).map(async (url, i) => {
      const pr = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
      const ours = url.startsWith(`https://github.com/${gh.repo}/pull/`) && i < 3;
      const look = async () => {
        const it = await readOr<Issue>(env, deps, `repos/${gh.repo}/issues/${pr}`, {
          html: false,
        });
        return it ? prState(it) : "";
      };
      const state = ours
        ? await cached(`web:pr:${gh.repo}:${pr}`, PR_MS, look, deps.now()).catch(() => "")
        : "";
      return { n: pr, url, state };
    }),
  );
  const model = choiceOf(gh, owner, all, status);
  const labels = labelsOf(issue);
  // A doc (ADR 0071): its short name, and when it changed, for its Edit.
  const isDoc = labels.some((l) => l === NOTEBOOK_LABEL || l === LIBRARY_LABEL);
  const docOf = projectOfLabels(labels);
  // Its project, open or closed, from the index: the doc opens over that project's Docs, and with no
  // Edit while it's closed (task #744).
  const ix =
    isDoc && docOf
      ? (await projectIndex(env, deps).catch(() => [] as Indexed[])).find((p) => p.name === docOf)
      : undefined;
  const doc = isDoc
    ? {
        name: docName(issue.title.replace(/^Notebook: /, ""), docOf),
        ...(docOf ? { project: shownProject(docOf) } : {}),
        ...(ix ? { of: ix.n } : {}),
        ...(ix && !ix.open ? { shut: true as const } : {}),
        updated: issue.updated_at,
      }
    : undefined;
  const forTask = issue.pull_request ? taskOfPr(issue.body) : undefined;
  const parent = issue.pull_request ? undefined : (await parentsOf(gh, deps, [issue])).get(n);
  return {
    v: 1,
    task: {
      n,
      title: issue.title,
      state: stateOf(issue, Boolean(running)),
      from: originOf(gh, issue),
      open: issue.state === "open",
      ...(issue.state === "closed" && issue.closed_at ? { closed: issue.closed_at } : {}),
      ...(!earlierPage && wakes(gh, owner, issue, all) ? { wakes: true } : {}),
      repeats: labels.includes("repeats"),
      ...(staying(issue) ? { staying: true as const } : {}),
      url: issue.html_url,
      ...(model ? { model } : {}),
      prs,
      ...(running ? { running } : {}),
      ...(issue.pull_request ? { pr: prState(issue) } : {}),
      ...(forTask ? { for: forTask } : {}),
      ...(parent ? { parent } : {}),
      ...(labels.includes(STARTED_LABEL) ? { started: true as const } : {}),
      ...(project ? { project } : plan ? { plan } : {}),
      ...(progress ? { progress: await progress } : {}),
      ...(doc ? { doc } : {}),
    },
    messages,
    earlier: last > 1 && !since,
    page: last,
    writable: writable(gh, s, issue),
  };
}

/**
 * Repeats (the page): every repeating task, and the recipes, with their next times from the
 * record.
 */
export async function repeats(env: Env, deps: Deps): Promise<Repeats> {
  const gh = github(env, deps);
  const [issues, waiting, status] = await Promise.all([
    read<Issue[]>(env, deps, `repos/${gh.repo}/issues?labels=repeats&state=all&per_page=50`, {
      html: false,
    }),
    // Errands wait open or closed (a merge closes its task): the label comes off as one ends.
    read<Issue[]>(env, deps, `repos/${gh.repo}/issues?labels=waiting&state=all&per_page=50`, {
      html: false,
    }).catch(() => [] as Issue[]),
    statusOf(env, deps).catch(() => undefined),
  ]);
  const rec = status?.record;
  const next = new Map((rec?.upcoming ?? []).map((u) => [u.n, u]));
  // A task's state as GitHub says it now: closing a recipe's task pauses it at once, not at the
  // next due run, which is when the record learns it.
  const closed = new Set(issues.filter((i) => i.state !== "open").map((i) => i.number));
  return {
    v: 1,
    // Each task labelled `repeats`: open, it runs; closed, it's paused (resume opens it). One that
    // was stopped has lost the label, so it isn't here.
    repeats: issues
      .filter((i) => !i.pull_request && !labelsOf(i).includes("recipe"))
      .map((i) => {
        const u = next.get(i.number);
        return {
          n: i.number,
          title: i.title,
          open: i.state === "open",
          ...(u?.every ? { every: withZone(u.every) } : {}),
          ...(u?.next && i.state === "open" ? { next: u.next } : {}),
          url: i.html_url,
        };
      }),
    waiting: waiting
      .filter((i) => !i.pull_request)
      .map((i) => {
        const u = next.get(i.number);
        return {
          n: i.number,
          title: i.title,
          ...(u?.every ? { every: u.every } : {}),
          ...(u?.next ? { next: u.next } : {}),
          url: i.html_url,
        };
      }),
    recipes: withUpcoming(rec?.recipes ?? [], rec?.upcoming ?? []).map((r) => {
      const paused = Boolean(r.paused) || (r.task !== undefined && closed.has(r.task));
      return {
        name: r.name,
        ...(r.task ? { task: r.task } : {}),
        ...(r.every ? { every: withZone(r.every) } : {}),
        ...(r.next && !paused ? { next: r.next } : {}),
        paused,
        url: `https://github.com/${gh.repo}/blob/main/recipes/${r.name}.md`,
      };
    }),
  };
}

/** A project in the index: its number, its name on GitHub, open or closed (and when), whose. */
interface Indexed {
  n: number;
  name: string;
  open: boolean;
  closed?: string;
  guest: boolean;
}

/**
 * Every project, open and closed (ADR 0069): one read, the newest 100, kept a minute. What the page
 * knows a project by beyond the list's open tasks: the Library's sections, a doc's way to its
 * project, Find and Files. A closed project is one of these, never lost.
 */
export function projectIndex(env: Env, deps: Deps): Promise<Indexed[]> {
  const gh = github(env, deps);
  const look = async () =>
    (
      await read<Issue[]>(
        env,
        deps,
        `repos/${gh.repo}/issues?labels=${PROJECT_LABEL}&state=all&sort=created&direction=desc&per_page=100`,
        { html: false },
      )
    ).flatMap((i) => {
      const name = !i.pull_request && projectNameOf(i.title);
      return name
        ? [
            {
              n: i.number,
              name,
              open: i.state === "open",
              ...(i.state === "closed" && i.closed_at ? { closed: i.closed_at } : {}),
              guest: labelsOf(i).includes(GUEST_LABEL),
            },
          ]
        : [];
    });
  return cached(`web:projects:${gh.repo}`, PLAN_MS, look, deps.now());
}

/**
 * The Library's pages (ADR 0069), with their ETag, kept a minute: a project's thread and Notebook
 * read the same. A doc saved here drops them (routes.ts: edit).
 */
const keptLibrary = (env: Env, deps: Deps) => {
  const gh = github(env, deps);
  return cached(
    `web:library:${gh.repo}`,
    PLAN_MS,
    () => libraryPages(gh, reader(env, deps)),
    deps.now(),
  );
};

/**
 * Notebook (the page): its pages, and the Library's (ADR 0069), each by its number, to open in the
 * pane, and a Library page by its short name too (ADR 0071); and your projects, open and closed.
 * Each read with its ETag.
 */
export async function notebook(env: Env, deps: Deps): Promise<Notebook> {
  const gh = github(env, deps);
  const [pages, library, projects] = await Promise.all([
    notebookPages(gh, reader(env, deps)),
    keptLibrary(env, deps),
    projectIndex(env, deps).catch(() => [] as Indexed[]),
  ]);
  const n = (url: string) => Number(/\/issues\/(\d+)$/.exec(url)?.[1]) || undefined;
  return {
    v: 1,
    pages: pages.map((p) => ({ ...p, ...(n(p.url) ? { n: n(p.url) } : {}) })),
    // Guests' are theirs (ADR 0071): yours only.
    projects: projects.filter((p) => !p.guest).map(({ guest: _, ...p }) => p),
    // Guests' pages are theirs (ADR 0071): your Library leaves them out.
    library: library
      .filter((p) => !p.guest)
      .map(({ n, topic, first, lines, url, project }) => ({
        n,
        topic,
        name: docName(topic, project),
        first,
        lines,
        url,
        ...(project ? { project } : {}),
      })),
  };
}
