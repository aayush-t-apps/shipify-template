// The watch (ADR 0031, "The watch"): the edge's check every 5 minutes, its cron. It reads shipify
// with the door App and does six duties, in this order, each from what GitHub says now:
//   due          a repeat's time came, or the daily run is due, or a task is deploying: ring
//                `watch:due` on the status task (the due run follows deploys, and keeps
//                recipes and their tasks in step; a merge that touches recipes/ starts one itself)
//   stopped      a task whose run died (its status says `working · <run>` and that run ended), or
//                whose words wait with no run for 10 minutes: marked Stopped (`stuck`), and one
//                alert. It never starts a run (ADR 0042): your `continue` does. Never the status
//                task, notebook pages or pull requests
//   notice       a run's reply with no mark of the door's after 2 minutes: one short notice to each
//                chat it was for, with its link, then 😕; if that can't be sent either, a note on
//                the status task. A reply is never sent twice
//   guard        boxes offline and back, apps failing (their public /health), each chat channel's
//                own health (its adapter's, its menu kept in step), key dates (SHIPIFY_KEY_DATES) and runners near
//                GitHub's 30-day update limit
//   pin          the status pinned in a chat (`/ping pin`), edited in place, silently, when what it
//                says changed; unpinned, it's left alone
//   alerts      what it found, in a door-App comment on the status task, then `watch:alert`
//                (or `watch:alert-github` when no box is online)
// Cloudflare allows 50 subrequests a call: the watch stops before 45, keeping the last few for its
// alert, and leaves the rest for the next tick. It keeps nothing between ticks.
import {
  DEPLOYING_LABEL,
  type Findings,
  problem,
  type RecordSeen,
  readFrom,
  readReply,
  readTaskSeen,
  STAYING_LABEL,
  STUCK_LABEL,
  TASK_MARK,
  useTimeZone,
  WATCH_LABELS,
} from "../../cli/contracts/index.ts";
import { emptyFindings, ring, sayFindings } from "./alerts.ts";
import { cached, forget, recall, remember } from "./cache.ts";
import type { Health } from "./channels/channel.ts";
import { CHANNELS, channelOf } from "./channels/index.ts";
import { alertOf } from "./chat.ts";
import { namesOf, type RunComment, react, ready } from "./door-out.ts";
import type { Deps, Env } from "./env.ts";
import { GITHUB_NEEDS, logOf, missing, obj } from "./env.ts";
import {
  appLogin,
  BudgetSpent,
  budgeted,
  byDoor,
  byRun,
  DoorKeyRefused,
  type GitHub,
  github,
  issueOf,
} from "./github.ts";
import { pinOf } from "./guide.ts";
import {
  BOX_LABEL,
  boxOf,
  chatsIn,
  chatsOf,
  lastPeople,
  NOTEBOOK_LABEL,
  type RawRunner,
  runners,
  type Settings,
  STATUS_LABEL,
  type StatusTask,
  settings,
  statusTask,
  zoneOf,
} from "./settings.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Subrequests a tick may make (Cloudflare's limit is 50), and those kept for its alert. */
export const BUDGET = 44;
export const RESERVE = 4;
/** Words that wait this long with no run: the task is Stopped, and you're told. */
export const QUIET_MS = 10 * MINUTE;
/** At most this many tasks marked Stopped, and replies noticed, in one tick. */
const MAX_STOPS = 3;
const MAX_NOTICES = 5;
/** A reply with no mark of the door's is noticed after this, and never once it's this old. */
const NOTICE_AFTER_MS = 2 * MINUTE;
const NOTICE_UNTIL_MS = HOUR + 10 * MINUTE;
/** A box offline now and still offline this much later is reported: longer than a restart. */
export const BOX_CONFIRM_MS = 4 * MINUTE;
/** An app failing now and still failing this much later is reported. */
export const APP_CONFIRM_MS = MINUTE;
/** Apps looked at, at most, in a tick: in turn, so every app is within ⌈apps ÷ 8⌉ ticks. */
export const MAX_APPS = 8;
/** The cron's step (wrangler.jsonc: every 5 minutes): a tick's number is the time over it. */
const TICK_MS = 5 * MINUTE;
/** GitHub stops sending jobs to a runner 30 days after a newer one came out: said 5 days before. */
const RUNNER_WARN_MS = 25 * DAY;
/** A rung doorbell's run shows within this: a label still on later, with no run of its kind, is lost. */
export const RING_GRACE_MS = 10 * MINUTE;

interface Issue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  user?: { login?: string } | null;
  labels: { name: string }[];
  /** How many comments it has: a run's status comment is one. */
  comments?: number;
  pull_request?: unknown;
  performed_via_github_app?: { id?: number } | null;
}

interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  display_title: string;
  created_at: string;
  updated_at?: string;
}

/** What one tick reads once and every duty shares. */
interface Tick {
  env: Env;
  deps: Deps;
  gh: GitHub;
  now: number;
  log: ReturnType<typeof logOf>;
  status: StatusTask;
  record?: RecordSeen;
  s: Settings;
  runners: RawRunner[];
  online: boolean;
  /** Changes from the record, said only when no alert run is rung already. */
  found: Findings;
  /** Notes said once whatever: a task Stopped, a reply no notice reached. */
  once: Findings["notes"];
  open: () => Promise<Issue[]>;
  /** Tasks with the deploying label, open or closed (a merge closes its task). */
  deploying: () => Promise<Issue[]>;
  comments: () => Promise<RunComment[]>;
  runs: (workflow: string) => Promise<Run[]>;
}

export interface TickReport {
  done: string[];
  /** Duties left for the next tick: the budget ran out. */
  left: string[];
  findings?: Findings;
  spent: number;
}

const lazy = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => {
    p ??= fn();
    return p;
  };
};

/** One tick: read, do each duty while the budget lasts, then say what was found. */
export async function tick(env: Env, deps: Deps): Promise<TickReport> {
  useTimeZone(zoneOf(env));
  const log = logOf(deps, "watch");
  const report: TickReport = { done: [], left: [], spent: 0 };
  const gone = missing(env, GITHUB_NEEDS);
  if (gone.length) {
    log.warn("watch.guard", { why: "unconfigured", missing: gone });
    return report;
  }
  const b = budgeted(deps.fetch, BUDGET, RESERVE);
  const d: Deps = { ...deps, fetch: b.fetch };
  const gh = github(env, d);
  const now = deps.now();
  let t: Tick;
  try {
    t = await read(env, d, gh, now, log);
  } catch (e) {
    if (e instanceof DoorKeyRefused) await keyRefused(env, deps, gh, log);
    else
      log.error("watch.guard", {
        why: "GitHub unreadable",
        message: String((e as Error)?.message ?? e),
      });
    report.spent = b.spent();
    return report;
  }
  // GitHub takes the key: a refusal from now on is new, and said again.
  forget(KEY_TOLD);
  const duties: [string, (t: Tick) => Promise<void>][] = [
    ["due", due],
    ["stopped", stopped],
    ["notice", notice],
    ["guard", guard],
    ["pin", pin],
  ];
  for (const [i, [name, duty]] of duties.entries()) {
    try {
      await duty(t);
      report.done.push(name);
    } catch (e) {
      if (e instanceof BudgetSpent) {
        report.left = duties.slice(i).map(([n]) => n);
        log.warn("watch.guard", { why: "budget spent", left: report.left });
        break;
      }
      if (e instanceof DoorKeyRefused) {
        await keyRefused(env, deps, gh, log);
        break;
      }
      log.warn("watch.guard", {
        duty: name,
        why: String((e as Error)?.message ?? e).slice(0, 200),
      });
    }
  }
  b.final();
  const pending = t.status.labels.some(
    (l) => l === WATCH_LABELS.alert || l === WATCH_LABELS.alertGithub,
  );
  const findings: Findings = pending
    ? { ...emptyFindings(), notes: t.once }
    : { ...t.found, notes: [...t.found.notes, ...t.once] };
  try {
    if (await sayFindings(gh, t.status, findings, t.online)) {
      report.findings = findings;
      log.info("watch.guard", { said: true, notes: findings.notes.map((n) => n.key) });
    }
  } catch (e) {
    log.warn("watch.guard", { why: `alert not said: ${String((e as Error)?.message ?? e)}` });
  }
  report.spent = b.spent();
  return report;
}

/** The status task (made when there's none yet), the settings and the runners. */
async function read(
  env: Env,
  deps: Deps,
  gh: GitHub,
  now: number,
  log: Tick["log"],
): Promise<Tick> {
  const [found, s, list] = await Promise.all([statusTask(gh), settings(gh, now), runners(gh, now)]);
  const repo = gh.repo;
  const kept = new Map<string, Promise<Run[]>>();
  const runs = (workflow: string) => {
    if (!kept.has(workflow))
      kept.set(
        workflow,
        gh
          .json<{ workflow_runs?: Run[] }>(
            "GET",
            `repos/${repo}/actions/workflows/${workflow}/runs?per_page=30`,
          )
          .then((r) => r.workflow_runs ?? []),
      );
    return kept.get(workflow) as Promise<Run[]>;
  };
  let status = found;
  // A doorbell left on with no run behind it would silence its duty for good: taken off, so it's
  // rung again when needed and no later tick reads the runs for it.
  if (status?.labels.some((l) => RUNG[l])) {
    const lost = lostRings(status.labels, await runs("watch.yml"), now);
    if (lost.length) {
      log.warn("watch.guard", { why: "a doorbell left on with no run", labels: lost });
      const n = status.number;
      await Promise.all(
        lost.map((l) =>
          gh.call("DELETE", `repos/${repo}/issues/${n}/labels/${encodeURIComponent(l)}`),
        ),
      );
      status = { ...status, labels: status.labels.filter((l) => !lost.includes(l)) };
    }
  }
  if (!status) {
    // A new Shipify: the status task the due runs keep, opened so there's a bell to ring.
    const made = await gh.json<{ number: number }>("POST", `repos/${gh.repo}/issues`, {
      title: "Shipify status",
      body: "Shipify's own status: the watch rings its runs here. The first due run writes the record.",
      labels: [STATUS_LABEL],
    });
    status = { number: made.number, labels: [STATUS_LABEL] };
  }
  return {
    env,
    deps,
    gh,
    now,
    log,
    status,
    ...(status.record ? { record: status.record } : {}),
    s,
    runners: list,
    online: list.some((r) => r.status === "online" && r.labels.some((l) => l.name === BOX_LABEL)),
    found: emptyFindings(),
    once: [],
    open: lazy(() =>
      gh.json<Issue[]>(
        "GET",
        `repos/${repo}/issues?state=open&sort=updated&direction=desc&per_page=100`,
      ),
    ),
    deploying: lazy(() =>
      gh.json<Issue[]>(
        "GET",
        `repos/${repo}/issues?labels=${DEPLOYING_LABEL}&state=all&sort=updated&direction=desc&per_page=10`,
      ),
    ),
    comments: lazy(() =>
      gh.json<RunComment[]>(
        "GET",
        `repos/${repo}/issues/comments?sort=updated&direction=desc&per_page=100&since=${new Date(now - DAY).toISOString()}`,
      ),
    ),
    runs,
  };
}

// ---------------------------------------------------------------- doorbells

/** Each doorbell, by the run it starts (watch.yml's run-name). */
const RUNG: Record<string, RegExp> = {
  [WATCH_LABELS.due]: /\bdue\b/,
  [WATCH_LABELS.alert]: /\balert\b/,
  [WATCH_LABELS.alertGithub]: /\balert\b/,
};

/**
 * The doorbells on the status task with no run behind them: none of their kind queued or going,
 * nor started within RING_GRACE_MS. GitHub dropped the event, or the run couldn't take its label
 * off; left alone, the label would keep its duty quiet for good (`ring` takes it off first).
 */
export function lostRings(labels: string[], runs: Run[], now: number): string[] {
  return labels.filter((l) => {
    const kind = RUNG[l];
    if (!kind) return false;
    return !runs.some(
      (r) =>
        kind.test(r.display_title) &&
        (r.status !== "completed" || now - Date.parse(r.created_at) < RING_GRACE_MS),
    );
  });
}

// ---------------------------------------------------------------- due

/** Whether it's time for a due run: a repeat's time, the daily one, or a task to follow. */
export function dueWhy(record: RecordSeen | undefined, following: boolean, now: number) {
  if (!record) return "no record yet";
  if (record.watch.next && Date.parse(record.watch.next) <= now) return "a repeat is due";
  if (!record.watch.last || now - Date.parse(record.watch.last) >= DAY) return "the daily run";
  if (following) return "a task is deploying";
  return undefined;
}

async function due(t: Tick) {
  // A merge closes its task, so a deploy is followed on open and closed tasks alike.
  const following = (await t.deploying()).length > 0;
  const why = dueWhy(t.record, following, t.now);
  if (!why) return;
  // Rung, and not started yet: once is enough.
  if (t.status.labels.includes(WATCH_LABELS.due)) return;
  const runs = (await t.runs("watch.yml")).filter((r) => /\bdue\b/.test(r.display_title));
  if (runs.some((r) => r.status !== "completed")) return;
  const last = runs.find((r) => r.status === "completed");
  const since = last ? t.now - Date.parse(last.created_at) : Number.POSITIVE_INFINITY;
  if (last && last.conclusion !== "success" && since < HOUR) return;
  // Following a deploy: a due run every 10 minutes is plenty.
  if (why === "a task is deploying" && since < QUIET_MS) return;
  await ring(t.gh, t.status.number, WATCH_LABELS.due);
  t.log.info("watch.due", { why });
}

// ---------------------------------------------------------------- stopped

const SKIPPED = [STATUS_LABEL, NOTEBOOK_LABEL, STUCK_LABEL];

/**
 * A task that should be working and isn't: its run ended before it finished, or your words waited
 * 10 minutes with no run for them (GitHub down when you wrote, say). It's marked Stopped, and you're
 * told once; nothing starts it but your `continue` (ADR 0040, ADR 0042). A few a tick.
 */
async function stopped(t: Tick) {
  const open = (await t.open()).filter(
    (i) => !i.pull_request && !i.labels.some((l) => SKIPPED.includes(l.name)),
  );
  if (!open.length) return;
  const comments = await t.comments();
  const owner = t.s.owner?.toLowerCase();
  // Your words: your own comments on GitHub, and what the door wrote for you.
  const yours = (c: RunComment) =>
    (owner !== undefined && c.user?.login?.toLowerCase() === owner) ||
    (byDoor(t.gh, c) && Boolean(readFrom(c.body)));
  let marked = 0;
  for (const issue of open) {
    if (marked >= MAX_STOPS) break;
    const mine = comments.filter((c) => issueOf(c.issue_url) === issue.number);
    const statusComment = mine.find((c) => byRun(c) && (c.body ?? "").startsWith(TASK_MARK));
    const seen = statusComment ? readTaskSeen(statusComment.body) : undefined;
    // A status of another version (not 2): not this core's to read, so left alone.
    if (statusComment && seen?.v !== 2) continue;
    // A run of it queued or going (waiting for a box, say) reads it: it isn't Stopped.
    const busy = async () =>
      (await t.runs("task.yml")).some(
        (r) => r.status !== "completed" && r.display_title === `task #${issue.number}`,
      );
    let note: Findings["notes"][number];
    if (seen?.working) {
      const run = await t.gh.call("GET", `repos/${t.gh.repo}/actions/runs/${seen.working}`);
      const r = obj(run.data);
      if (run.status === 200 && r?.status !== "completed") continue;
      if (run.status !== 200 && run.status !== 404) continue;
      // Ended just now: its last write may still be on its way.
      if (r && t.now - Date.parse(String(r.updated_at ?? r.created_at)) < 2 * MINUTE) continue;
      if (await busy()) continue;
      // Ended before it finished (a box restart, a crash): your `continue` carries it on from
      // where it got to.
      note = {
        key: `stopped:${issue.number}:${seen.working}`,
        problem: problem("stopped", {}, { where: issue.html_url }),
      };
    } else {
      const cursorAt = seen?.cursor ? Date.parse(seen.cursor.at) : 0;
      const cursorId = seen?.cursor?.id ?? 0;
      // Words a run has replied to since, even with a failure (one that broke before its agent read
      // them keeps the cursor where it was), have had their outcome: they don't wait.
      const replied = Math.max(
        0,
        ...mine.filter((c) => byRun(c) && readReply(c.body)).map((c) => Date.parse(c.created_at)),
      );
      // A setting (a `use …` alone from a chat) waits for your next words, not for a run.
      const waiting = mine
        .filter(
          (c) =>
            yours(c) &&
            !readFrom(c.body)?.setting &&
            c.id > cursorId &&
            Date.parse(c.created_at) > cursorAt &&
            Date.parse(c.created_at) > replied,
        )
        .map((c) => Date.parse(c.created_at));
      const ownIssue =
        byDoor(t.gh, issue) || (owner !== undefined && issue.user?.login?.toLowerCase() === owner);
      // A task no run has answered yet (no comment at all: the 100 read are only the newest, so a
      // status comment missing from them may just be older): its own words wait.
      if (
        !statusComment &&
        !issue.comments &&
        ownIssue &&
        t.now - Date.parse(issue.created_at) < DAY
      )
        waiting.push(Date.parse(issue.created_at));
      const last = Math.max(...waiting);
      if (!waiting.length || t.now - last < QUIET_MS) continue;
      if (await busy()) continue;
      note = {
        key: `unanswered:${issue.number}:${last}`,
        problem: problem(
          "words-unanswered",
          { task: String(issue.number) },
          { where: issue.html_url },
        ),
      };
    }
    marked++;
    await t.gh.json("POST", `repos/${t.gh.repo}/issues/${issue.number}/labels`, {
      labels: [STUCK_LABEL],
    });
    // A stay whose box died left its label (ADR 0057): off, or task.yml would skip your `continue`.
    if (issue.labels.some((l) => l.name === STAYING_LABEL))
      await t.gh.call(
        "DELETE",
        `repos/${t.gh.repo}/issues/${issue.number}/labels/${STAYING_LABEL}`,
      );
    t.once.push(note);
    t.log.warn("watch.stopped", { task: issue.number, why: note.problem.code });
  }
}

// ---------------------------------------------------------------- notice

/** The door App's own 🚀 or 😕 on a comment: it reached its chats, or they were told. */
async function doorMarked(t: Tick, c: RunComment) {
  // The listing counts everyone's: none at all is none of the door's, with no call.
  if (!c.reactions?.rocket && !c.reactions?.confused) return false;
  const door = await appLogin(t.env, t.deps);
  const list = await t.gh.json<{ content?: string; user?: { login?: string; type?: string } }[]>(
    "GET",
    `repos/${t.gh.repo}/issues/comments/${c.id}/reactions?per_page=100`,
  );
  return list.some(
    (r) =>
      r.user?.login === door &&
      r.user?.type === "Bot" &&
      (r.content === "rocket" || r.content === "confused"),
  );
}

/**
 * A run's reply the door didn't mark within 2 minutes (a chat busy, down, or slow to confirm; the
 * run never reached the door): each chat it was for gets one short notice with its link, never the
 * reply again, and 😕 marks it so it's never noticed twice. A notice that can't be sent either is a
 * note on the status task, unless the reply is the status task's own alert (said there already).
 */
async function notice(t: Tick) {
  if (t.s.closed) return;
  let done = 0;
  for (const c of await t.comments()) {
    if (done >= MAX_NOTICES) break;
    if (!byRun(c)) continue;
    const reply = readReply(c.body);
    if (!reply) continue;
    const age = t.now - Date.parse(c.created_at);
    if (age < NOTICE_AFTER_MS || age >= NOTICE_UNTIL_MS) continue;
    // Chats that are pushed to: one that reads in place has the reply already.
    const chats = chatsIn(reply.to, t.s.people).filter(
      (x) => ready(t.env, x.channel) && !channelOf(x.channel)?.inPlace,
    );
    if (!chats.length || (await doorMarked(t, c))) continue;
    const task = issueOf(c.issue_url);
    done++;
    // Marked first, so a notice is never sent twice: if GitHub won't take the mark, nothing is sent
    // this tick, and the reply is still unmarked at the next.
    await react(t.gh, c.id, "confused");
    const p = problem("reply-unsent", { task: String(task) });
    const missed: { channel: string }[] = [];
    let busy = false;
    for (const x of chats) {
      const sent = await channelOf(x.channel)?.send(
        t.env,
        t.deps,
        x.chat,
        alertOf(p.what, p.fix, task, c.html_url),
      );
      if (sent?.ok) continue;
      missed.push(x);
      busy ||= Boolean(sent && "wait" in sent);
    }
    if (missed.length && task !== t.status.number)
      t.once.push({
        key: `unsent:${c.id}`,
        problem: {
          ...p,
          why: `${namesOf(missed)} didn't take the notice either.`,
          where: c.html_url,
        },
      });
    t.log.warn("watch.notice", { task, missed: missed.length });
    // A chat said wait: the rest waits for the next tick.
    if (busy) return;
  }
}

// ---------------------------------------------------------------- guard

/** Each box online or not, from its runners (one per slot): online when any slot is. */
export function boxesUp(list: RawRunner[]): Map<string, boolean> {
  const up = new Map<string, boolean>();
  for (const r of list.filter((x) => x.labels.some((l) => l.name === BOX_LABEL)))
    up.set(boxOf(r), (up.get(boxOf(r)) ?? false) || r.status === "online");
  return up;
}

/** What differs between the boxes and the record: offline only when every slot is. */
export function boxChanges(list: RawRunner[], record: RecordSeen | undefined): Findings["boxes"] {
  const up = boxesUp(list);
  const known = record?.boxes ?? {};
  const out: Findings["boxes"] = {};
  for (const [name, online] of up) {
    if (!online && !known[name]?.offline) out[name] = "offline";
    else if (online && (!known[name] || known[name]?.offline)) out[name] = "online";
  }
  for (const name of Object.keys(known)) if (!up.has(name)) out[name] = "gone";
  return out;
}

/** A channel's health against the record: failing once (said), fine again (said), else nothing. */
export function channelChange(
  info: Health | null,
  reported: boolean,
): Findings["channels"][string] | undefined {
  if (!info) return undefined;
  if (info.failing && !reported)
    return { state: "failing", error: info.error || "no reason given" };
  if (!info.failing && reported) return { state: "fine" };
  return undefined;
}

/** "2.329.0" older than "2.330.1". */
export const olderThan = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

const healthy = async (t: Tick, url: string) => {
  try {
    const res = await t.deps.fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = obj(await res.json().catch(() => null));
    return res.ok && body?.status === "ok";
  } catch (e) {
    if (e instanceof BudgetSpent) throw e;
    return false;
  }
};

async function guard(t: Tick) {
  const rec = t.record;
  const said = new Set(rec?.alerted ?? []);
  // Boxes and apps, each confirmed a little later, both waits at once.
  const boxes = boxChanges(t.runners, rec);
  const all = rec?.apps ?? [];
  const from = all.length > MAX_APPS ? (Math.floor(t.now / TICK_MS) * MAX_APPS) % all.length : 0;
  const apps = [...all.slice(from), ...all.slice(0, from)].slice(0, MAX_APPS);
  const looks = await Promise.all(
    apps.map(async (a) => ({ a, ok: a.paused ? undefined : await healthy(t, a.url) })),
  );
  const appFound: Findings["apps"] = {};
  for (const { a, ok } of looks) {
    if (a.paused && a.failing) appFound[a.id] = "paused";
    else if (ok === false && !a.failing) appFound[a.id] = "failing";
    else if (ok === true && a.failing) appFound[a.id] = "fine";
  }
  const offline = Object.keys(boxes).filter((n) => boxes[n] === "offline");
  const failing = Object.keys(appFound).filter((n) => appFound[n] === "failing");
  await Promise.all([
    offline.length
      ? t.deps.sleep(BOX_CONFIRM_MS).then(async () => {
          const up = boxesUp(await runners(t.gh, t.deps.now()));
          for (const n of offline) if (up.get(n)) delete boxes[n];
        })
      : undefined,
    failing.length
      ? t.deps.sleep(APP_CONFIRM_MS).then(async () => {
          for (const n of failing) {
            const a = apps.find((x) => x.id === n);
            if (a && (await healthy(t, a.url))) delete appFound[n];
          }
        })
      : undefined,
  ]);
  t.found.boxes = boxes;
  t.found.apps = appFound;
  // Each chat channel's own health, read at most every 30 minutes, and its menu kept in step.
  for (const ch of Object.values(CHANNELS)) {
    const check = ch.health;
    if (!check || !ready(t.env, ch.id)) continue;
    const info = await cached(
      `watch:channel:${ch.id}`,
      30 * MINUTE,
      async () => {
        const h = await check(t.env, t.deps);
        if (!h) throw new Error(`${ch.name} didn't say`);
        return h;
      },
      t.now,
    ).catch((e) => {
      if (e instanceof BudgetSpent) throw e;
      return null;
    });
    const change = channelChange(info, Boolean(rec?.channels[ch.id]));
    if (change) t.found.channels[ch.id] = change;
    // What it shows of Shipify (its menu) changes only with a deploy, which starts new instances:
    // checked once an instance, while the channel is fine.
    const menu = ch.menu;
    if (menu && info && !info.failing)
      await cached(
        `watch:menu:${ch.id}`,
        DAY,
        () => menu.call(ch, t.env, t.deps).then(() => true),
        t.now,
      ).catch((e) => {
        if (e instanceof BudgetSpent) throw e;
      });
  }
  // Key dates: 30 days before, and 7.
  for (const [name, date] of Object.entries(t.s.keyDates)) {
    const days = Math.ceil((Date.parse(date) - t.now) / DAY);
    const level = days <= 7 ? 7 : days <= 30 ? 30 : 0;
    const key = `key:${name}:${level}`;
    if (!level || said.has(key)) continue;
    t.found.notes.push({
      key,
      problem: problem("key-expiring", {
        key: name,
        date,
        days: String(Math.max(0, days)),
        how: "Renew it (the agent's login: pnpm ship setup agent --new; this PC's token: docs/setup.md, Tokens and secrets), then pnpm ship doctor --yes records its new date.",
      }),
    });
  }
  // Runners: GitHub's newest, read every 6 hours, against each box's own from its health.
  const withRunner = Object.entries(rec?.boxes ?? {}).filter(([, b]) => b.runner);
  if (withRunner.length) {
    const latest = await cached(
      "watch:runner",
      6 * HOUR,
      () =>
        t.gh.json<{ tag_name?: string; published_at?: string }>(
          "GET",
          "repos/actions/runner/releases/latest",
        ),
      t.now,
    ).catch((e) => {
      if (e instanceof BudgetSpent) throw e;
      return null;
    });
    const version = latest?.tag_name?.replace(/^v/, "") ?? "";
    const out = Date.parse(latest?.published_at ?? "");
    if (/^\d+\.\d+\.\d+$/.test(version) && t.now - out >= RUNNER_WARN_MS)
      for (const [box, b] of withRunner) {
        const key = `runner:${box}:${version}`;
        if (!b.runner || !olderThan(b.runner, version) || said.has(key)) continue;
        t.found.notes.push({
          key,
          problem: problem("runner-old", {
            box,
            version: b.runner,
            latest: version,
            date: new Date(out).toISOString().slice(0, 10),
          }),
        });
      }
  }
}

// ---------------------------------------------------------------- pin

/**
 * The status pinned in your chats (`/ping pin`), kept up to date from what this tick read already
 * (the runners, the open tasks): the chat is asked only when the words changed since it last
 * answered, or half an hour on, and the message is edited, silently, only when they differ.
 */
async function pin(t: Tick) {
  if (t.s.closed) return;
  const chats = chatsOf(t.s.people).filter((c) => ready(t.env, c.channel));
  let p: ReturnType<typeof pinOf> | undefined;
  for (const c of chats) {
    const keep = channelOf(c.channel)?.pin;
    if (!keep) continue;
    p ??= pinOf(t.gh, t.runners, await t.open());
    const key = `watch:pin:${c.channel}:${c.chat}`;
    if (recall(key, t.now) === p.text) continue;
    const shows = await keep(t.env, t.deps, c.chat, p.text, p.shown);
    if (shows !== undefined) remember(key, p.text, 30 * MINUTE, t.now);
  }
}

// ---------------------------------------------------------------- the door App's key refused

/** This instance told you the key is refused: GitHub can't be written to mark it meanwhile. */
const KEY_TOLD = "watch:key-refused";

/**
 * GitHub refused the door App's key: said straight to your chats, once, until GitHub takes it
 * again. Who you are is the last good read's (lastPeople): with none, no one is guessed at.
 */
async function keyRefused(env: Env, deps: Deps, gh: GitHub, log: Tick["log"]) {
  log.error("watch.guard", { why: "door key refused" });
  if (recall(KEY_TOLD, deps.now())) return;
  const chats = chatsOf(lastPeople(gh) ?? []).filter((c) => ready(env, c.channel));
  if (!chats.length) return;
  remember(KEY_TOLD, true, 365 * DAY, deps.now());
  const p = problem("door-key-refused");
  for (const c of chats) {
    const sent = await CHANNELS[c.channel]?.send(env, deps, c.chat, alertOf(p.what, p.fix));
    if (sent && !sent.ok) log.warn("watch.guard", { why: "alert not sent", channel: c.channel });
  }
}
