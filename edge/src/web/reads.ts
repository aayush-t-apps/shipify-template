// What the chat shows (ADR 0036, "What it looks like"): every read is GitHub's record, as the door
// App sees it, shaped for the page (shapes.ts). Nothing here writes. A list is three calls (50
// open tasks and PRs, without their rendered bodies; the task runs; the runners), and an older page
// of it, or of the closed ones, one; a thread two (the task or PR and its newest 100 comments; past
// 100, its first page too, for the run's status comment) and one per PR of shipify's it names, at
// most three; a split task's (ADR 0066) one GraphQL read more, for its parts, kept 60 s.
import {
  AFTER_CLOSE_MS,
  acknowledgement,
  NEEDS_YOU_LABEL,
  pickIn,
  readFrom,
  readReply,
  readTaskSeen,
  replyButtons,
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
import pkg from "../../../package.json" with { type: "json" };
import { cached } from "../cache.ts";
import { channelOf } from "../channels/index.ts";
import type { Deps, Env } from "../env.ts";
import { byDoor, byRun, type GitHub, github, RUN_WRITER } from "../github.ts";
import {
  NOTEBOOK_LABEL,
  notebookPages,
  runners,
  type Settings,
  STATUS_LABEL,
  statusTask,
  toBoxes,
} from "../settings.ts";
import { clean, esc, splitDetails, withoutEchoes, withoutPick } from "./clean.ts";
import { PICTURE } from "./files.ts";
import { read, readOr } from "./gh.ts";
import { defaultAgentId } from "./setup.ts";
import type {
  FileSeen,
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
]);
/** A task's other labels (yours from GitHub, "failed", "deploying"): the list filters by them. */
const tagsOf = (i: Issue) => labelsOf(i).filter((l) => !SAID.has(l));

/** Not a task the chat lists: a PR, the status task, a notebook page. */
const hidden = (i: Issue) =>
  Boolean(i.pull_request) || labelsOf(i).some((l) => l === STATUS_LABEL || l === NOTEBOOK_LABEL);

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

/** A part's parent (ADR 0066): its body's first line, `Part of #<n>`, on a task labelled so. */
const parentOf = (i: Issue) =>
  (labelsOf(i).includes(SUB_TASK_LABEL) &&
    Number(/^Part of #(\d+)[ \t]*(?:\r?\n|$)/.exec(i.body ?? "")?.[1])) ||
  undefined;

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
  repository(owner: $owner, name: $name) { issue(number: $n) { subIssues(first: 50) { nodes {
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

/** Tasks (and PRs) a page of the list reads. */
export const LIST_PAGE = 50;

/** The task a PR's body names: "Closes owner/shipify#12", or "Part of …". */
const taskOfPr = (body: string | null | undefined) =>
  Number(/\b(?:Closes|Fixes|Part of)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/i.exec(body ?? "")?.[1]) ||
  undefined;

/**
 * The list: what's running, the boxes, shipify's open PRs (for review), and the 50 open tasks
 * updated last. The closed ones (`closed`), and an older page (`page` 2 on), are only their tasks:
 * what's running, the boxes and the PRs come with the open list's first page.
 */
export async function list(env: Env, deps: Deps, page = 1, closed = false): Promise<List> {
  const gh = github(env, deps);
  const first = page === 1 && !closed;
  const [issues, live, boxes] = await Promise.all([
    read<Issue[]>(
      env,
      deps,
      `repos/${gh.repo}/issues?state=${closed ? "closed" : "open"}&sort=updated&direction=desc&per_page=${LIST_PAGE}${page > 1 ? `&page=${page}` : ""}`,
      { html: false },
    ),
    first ? liveRuns(env, deps, gh) : new Map<number, Running>(),
    first
      ? runners(gh, deps.now(), 30_000)
          .then(toBoxes)
          .catch(() => [])
      : [],
  ]);
  const tasks = issues
    .filter((i) => !hidden(i))
    .map((i) => {
      const labels = tagsOf(i);
      const parts = partsOf(i);
      const parent = parentOf(i);
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
        ...(parent ? { parent } : {}),
      };
    });
  const review = issues
    .filter((i) => first && i.pull_request && i.state === "open")
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
  return {
    v: 1,
    version: pkg.version,
    boxes,
    running: [...live.values()].map((r) => ({ ...r, title: titles.get(r.n) ?? `#${r.n}` })),
    review,
    tasks,
    closed,
    page,
    more: issues.length === LIST_PAGE,
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

const html = (h: string | undefined, url: string) => {
  const c = clean(h ?? "");
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
  ];
  const split = who === "shipify" ? splitDetails(html(c.body_html, c.html_url)) : undefined;
  const use = who === "you" ? useOf(md) : undefined;
  // A reply's question and links show from its line, your pick from its tag: not twice.
  const shown = split ? split.html : html(c.body_html, c.html_url);
  const words = use ? withoutPick(shown) : shown;
  return {
    id: c.id,
    who,
    name: who === "shipify" ? "Shipify" : (from?.person ?? login),
    at: c.created_at,
    html: reply ? withoutEchoes(words, reply) : words,
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
    url: c.html_url,
  };
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

/** A PR's state, from its issue: open, merged or closed. */
const prState = (i: Issue) =>
  i.pull_request?.merged_at ? "merged" : i.state === "closed" ? "closed" : "open";

/**
 * A thread: the task and its newest page of messages (only those after `since`, when given), or an
 * older page (`page`, for "Earlier messages"). A PR of shipify's reads the same way, to review in
 * the chat: its description and comments, and the task it's for; it takes no words from here.
 */
export async function thread(
  env: Env,
  deps: Deps,
  s: Settings,
  n: number,
  since: string | undefined,
  older?: number,
): Promise<Thread | null> {
  const gh = github(env, deps);
  const issue = await readOr<Issue>(env, deps, `repos/${gh.repo}/issues/${n}`);
  if (!issue) return null;
  const count = issue.comments ?? 0;
  const newest = Math.max(1, Math.ceil(count / 100));
  const last = older && older < newest ? older : newest;
  // The newest page by default. The run's status comment is the first a run wrote (findStatus), so
  // it's on page 1: read too when the page shown is a later one. Unchanged, each is a 304.
  const page = (p: number) =>
    read<Comment[]>(env, deps, `repos/${gh.repo}/issues/${n}/comments?per_page=100&page=${p}`);
  const [comments, first, plan] = await Promise.all([
    page(last),
    // Only for the Working line: a page 1 that can't be read leaves it out, never the thread.
    last > 1 ? page(1).catch(() => [] as Comment[]) : Promise.resolve([] as Comment[]),
    // A split task's Plan card (ADR 0066): a plan that can't be read leaves the card out.
    partsOf(issue) && !issue.pull_request ? planOf(gh, deps, n).catch(() => undefined) : undefined,
  ]);
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
  const messages = all
    .filter((c) => !since || Date.parse(c.created_at) > after)
    .flatMap((c) => messageOnce(gh, owner, c) ?? []);
  // The run under way, from its status comment (the run writes it first, and clears it at the end).
  const status = [...first, ...comments].find(
    (c) => (c.body ?? "").startsWith(TASK_MARK) && byRun(c),
  );
  const working = readTaskSeen(status?.body)?.working;
  const running = working
    ? {
        n,
        title: issue.title,
        since: status?.updated_at ?? issue.updated_at,
        url: `https://github.com/${gh.repo}/actions/runs/${working}`,
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
  const prs = await Promise.all(
    prUrls.slice(0, 6).map(async (url, i) => {
      const pr = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
      const ours = url.startsWith(`https://github.com/${gh.repo}/pull/`) && i < 3;
      const it = ours
        ? await readOr<Issue>(env, deps, `repos/${gh.repo}/issues/${pr}`, { html: false }).catch(
            () => null,
          )
        : null;
      return { n: pr, url, state: it ? prState(it) : "" };
    }),
  );
  const model = choiceOf(gh, owner, all, status);
  const labels = labelsOf(issue);
  const forTask = issue.pull_request ? taskOfPr(issue.body) : undefined;
  const parent = issue.pull_request ? undefined : parentOf(issue);
  return {
    v: 1,
    task: {
      n,
      title: issue.title,
      state: stateOf(issue, Boolean(running)),
      from: originOf(gh, issue),
      open: issue.state === "open",
      ...(last === newest && wakes(gh, owner, issue, all) ? { wakes: true } : {}),
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
      ...(plan ? { plan } : {}),
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
    statusTask(gh).catch(() => undefined),
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

/** Notebook (the page): its pages. */
export async function notebook(env: Env, deps: Deps): Promise<Notebook> {
  return { v: 1, pages: await notebookPages(github(env, deps)) };
}
