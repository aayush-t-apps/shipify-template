// The watch's runs (ADR 0019, docs/watch.md): what watch.yml runs when the watch (the edge's check
// every 5 minutes) or you press one of its buttons. Each is one job:
//   due      what's due now (lib: taskDue starts each due task's own run and closes a quiet one),
//            each box's weekly clean-up once its last is a week old, this box's health, and the
//            schedule (the soonest time is `watch.next`, which the watch reads)
//   cleanup  one box's weekly clean-up: closed or deleted tasks' folders, the agents' leftover run
//            folders (lib/sandbox.ts), old agent installs, doctor (the workflow prunes the
//            package caches after, while no other slot runs)
//   alert    what the watch saw change: a box offline, back, new or gone; an app failing or back
// A box knows none of this: it runs what the queue hands it. The status issue is the record.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { NEEDS_YOU_LABEL, replyLine } from "../contracts/index.ts";
import { tellDoor } from "../kernel/door.ts";
import { hash8 } from "../kernel/keys.ts";
import { replyTo } from "../kernel/route.ts";
import { doorLogin } from "../kernel/snapshot.ts";
import { tidyTools } from "../lib/agent-install.ts";
import { loadExecutors } from "../lib/agents.ts";
import { boxFacts } from "../lib/box-facts.ts";
import { findStack } from "../lib/catalog.ts";
import { defaultChannels } from "../lib/channels.ts";
import { copySetting, PLATFORM_ROOT } from "../lib/config.ts";
import { platformRepo } from "../lib/github.ts";
import { readKeyDates } from "../lib/key-dates.ts";
import { ok, type Result } from "../lib/output.ts";
import { readPeople } from "../lib/people.ts";
import type { RunRow } from "../lib/runs.ts";
import { cleanStaleRuns, pruneContainers } from "../lib/sandbox.ts";
import {
  addEvent,
  applyFindings,
  keepRepos,
  readFindings,
  readStatusIssue,
  type StatusIssueState,
  setBox,
  setCleanup,
  setUpcoming,
  updateStatusIssue,
} from "../lib/status-issue.ts";
import { findStatus } from "../lib/task.ts";
import { newer } from "../lib/versions.ts";
import { cleanupsUnderWay, pressWatch, watchRuns } from "../lib/watch.ts";
import { doctor } from "./doctor.ts";
import { rec, timeZone, tryOr } from "./task/context.ts";
import { countSkills, type DigestFacts, digestDue, digestNext, digestText } from "./task/digest.ts";
import { type Due, keepRecipes } from "./task/due.ts";
import { nearlyFull, readNotebook } from "./task/notebook.ts";
import { cleanUpTasks, runUrl, taskDue } from "./task.ts";

const WEEK = 7 * 24 * 60 * 60_000;
const inActions = () => process.env.GITHUB_ACTIONS === "true";
/**
 * The box this run is on: the box its slot belongs to (SHIPIFY_BOX, from the slot's `.env`, ADR
 * 0020), else its runner's name in a job, else this machine's name.
 */
const thisBox = () => process.env.SHIPIFY_BOX || process.env.RUNNER_NAME || hostname();

/** The due run: what's due, each box's clean-up once a week, this box's health, the schedule. */
export async function watchDue(): Promise<Result> {
  const repo = platformRepo();
  const at = new Date();
  const box = thisBox();
  const due = taskDue(at);
  const data = due.data ?? { upcoming: [], events: [], apps: [] };
  // Recipes and their tasks, kept in step with recipes/ on main (ADR 0032).
  const recipes = keepRecipes();
  const events = [...data.events, ...recipes.events];
  // Each box the record knows, and this one: a clean-up when its last one is a week old (or it has
  // none yet), unless it's offline or one is already under way.
  const record = readStatusIssue();
  const boxes = new Set(Object.keys(record.boxes));
  if (inActions()) boxes.add(box);
  const underWay = cleanupsUnderWay(watchRuns(repo));
  const started: string[] = [];
  for (const name of [...boxes].sort()) {
    const last = record.cleanups[name]?.at;
    if (record.boxes[name]?.offline || underWay.has(name)) continue;
    if (last && at.getTime() - Date.parse(last) < WEEK) continue;
    const r = pressWatch({ run: "cleanup", box: name }, repo);
    if (r.ok) started.push(name);
    events.push(
      r.ok
        ? `started ${name}'s weekly clean-up`
        : `couldn't start ${name}'s clean-up: ${r.error.slice(0, 200)}`,
    );
  }
  // The weekly digest (ADR 0053): its next time kept in the record, and what waits on you read only
  // when it's said.
  const digestAt = digestNext(copySetting("SHIPIFY_DIGEST"), at, timeZone());
  const sayDigest = digestDue(record.watch.digest, digestAt, at);
  const waiting = sayDigest
    ? tryOr(
        () =>
          rec()
            .issues({ labels: [NEEDS_YOU_LABEL] })
            .filter((i) => !i.pull_request)
            .map((i) => ({ n: i.number, title: i.title })),
        [] as { n: number; title: string }[],
      )
    : [];
  // The week's run rows, for the digest's skills: read only when it's said.
  const rows = sayDigest ? tryOr(() => weekRows(at), undefined) : undefined;
  const posted = updateStatusIssue(
    (s) => {
      s.watch = { ...s.watch, last: at.toISOString(), box, run: runUrl(), digest: digestAt };
      setUpcoming(s, data.upcoming);
      for (const e of events) addEvent(s, e, at.toISOString());
      // Every app, for the edge's /apps and its health guard (ADR 0031), keeping what the watch saw.
      // What the watch saw (failing) and what an operation said (paused) are kept.
      if (data.apps.length)
        s.apps = data.apps.map(({ stack: _, ...a }) => {
          const was = s.apps.find((x) => x.id === a.id);
          const paused = a.paused ?? was?.paused;
          return {
            ...a,
            ...(paused ? { paused: true } : {}),
            ...(was?.failing && !paused ? { failing: was.failing } : {}),
          };
        });
      if (recipes.rows) s.recipes = recipes.rows;
      // Shipify's own repos as just read, for /repos and the web chat's Change a repo (ADR 0047).
      if (data.repos) keepRepos(s, data.repos, at.toISOString());
      const health = inActions() ? setBox(s, box, boxFacts()) : undefined;
      // A recipe file that doesn't read is said once (until it changes): never silent.
      const bad = recipes.problems.filter(
        (p) => !s.alerted.includes(`recipe:${p.file}:${p.problem}`),
      );
      for (const p of bad) s.alerted.push(`recipe:${p.file}:${p.problem}`);
      const said = bad.map((p) => `- \`${p.file}\` doesn't read: ${p.problem}. Fix it in a PR.`);
      const skills = rows ? countSkills(rows, skillsOnMain(), at) : undefined;
      const digest = sayDigest
        ? digestText({ ...digestFacts(s, data.apps, waiting, at), skills }, whenHere)
        : "";
      const text = [health, said.length ? `**Recipes**\n\n${said.join("\n")}` : "", digest]
        .filter(Boolean)
        .join("\n\n");
      return text ? alertReply(text) : undefined;
    },
    { timeZone: timeZone() },
  );
  await toYourChats(posted);
  const cleaning = started.length ? `; started ${started.join(", ")}'s clean-up` : "";
  return ok("watch due", `${due.summary}${cleaning}`);
}

const DAY = 24 * 3600_000;

/** The week as the digest says it (ADR 0053): from the record and the apps the due run just read. */
function digestFacts(
  s: StatusIssueState,
  apps: Due["apps"],
  waiting: { n: number; title: string }[],
  at: Date,
): DigestFacts {
  const keys = Object.entries(readKeyDates(copySetting("SHIPIFY_KEY_DATES")))
    .map(([name, date]) => ({
      name,
      date,
      days: Math.ceil((Date.parse(date) - at.getTime()) / DAY),
    }))
    .filter((k) => k.days <= 30)
    .sort((a, b) => a.days - b.days);
  return {
    boxes: Object.entries(s.boxes).map(([name, b]) => ({ name, online: !b.offline })),
    apps: apps.map((a) => {
      const seen = s.apps.find((x) => x.id === a.id);
      const now = a.stack
        ? tryOr(() => findStack(a.stack?.id ?? "").version, undefined)
        : undefined;
      return {
        id: a.id,
        ...(seen?.failing ? { failing: true } : {}),
        ...(seen?.paused ? { paused: true } : {}),
        ...(a.stack && now && newer(now, a.stack.version)
          ? { behind: { stack: a.stack.id, from: a.stack.version, to: now } }
          : {}),
      };
    }),
    waiting,
    upcoming: { count: s.upcoming.length, ...(s.upcoming[0] ? { next: s.upcoming[0].next } : {}) },
    keys,
  };
}

/**
 * The run rows of every task updated this week: each task's own runs, from its status
 * comment. Pull requests and the status issue have none.
 */
function weekRows(at: Date): RunRow[] {
  const since = new Date(at.getTime() - 7 * DAY).toISOString();
  return rec()
    .issues({ state: "all", since })
    .filter((i) => !i.pull_request)
    .flatMap((i) => findStatus(rec().comments(i.number)).state.runs ?? []);
}

/** The skills on main: each folder of skills/ in this copy of Shipify. */
const skillsOnMain = (): string[] =>
  tryOr(
    () =>
      readdirSync(join(PLATFORM_ROOT, "skills")).filter((d) =>
        statSync(join(PLATFORM_ROOT, "skills", d)).isDirectory(),
      ),
    [] as string[],
  );

/** A time as your chats read it: the day and the hour, in your copy's time zone. */
const whenHere = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone(),
  }).format(new Date(iso));

/**
 * Whether the door still answers, for the weekly clean-up (ADR 0027): an unsigned ping, which a
 * door that's up refuses as unproven (401), so no key is needed. Nothing when there's no door.
 */
export async function doorAnswers(
  url = process.env.SHIPIFY_DOOR_URL,
  get: (u: string) => Promise<number> = async (u) =>
    (await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(10_000) })).status,
): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const status = await get(`${url.replace(/\/$/, "")}/health`.replace("/door/health", "/health"));
    if (status === 200) return "the door answers";
    if (status >= 300 && status < 400)
      return "the door is behind the sign-in: let /door/* through (docs/door.md)";
    return `the door didn't answer as it should (${status}): pnpm ship door check`;
  } catch (e) {
    return `the door didn't answer (${(e as Error).message.slice(0, 80)}): pnpm ship door check`;
  }
}

/**
 * One box's weekly clean-up: the tasks' leftovers and the agents' old run folders (removed as each
 * slot's agent, who owns them), then doctor, all on the status issue.
 */
export async function watchCleanup(boxArg?: string): Promise<Result> {
  // The box it's on is the truth; the input says which box was meant.
  const box = process.env.SHIPIFY_BOX || process.env.RUNNER_NAME || boxArg || hostname();
  const at = new Date().toISOString();
  const t = cleanUpTasks();
  const runs = cleanStaleRuns();
  // On a box, its shared tools kept to the agents' pinned versions and two Node versions, and each
  // slot's containers' images pruned (ADR 0064), only while no other slot runs (a run in flight
  // keeps what it uses).
  const onBox = Boolean(process.env.RUNNER_TOOL_CACHE);
  const idle = onBox && !otherSlotBusy();
  const tidied = idle ? tryOr(() => tidyTools(loadExecutors()), [] as string[]) : [];
  const images = idle ? pruneContainers() : { pruned: 0, failed: [] as string[] };
  // A notebook page nearly full is said.
  const full = tryOr(() => nearlyFull(readNotebook()), [] as string[]);
  const door = await doorAnswers();
  const d = await doctor();
  const checks = (d.checks ?? []).map((c) => ({
    ok: c.ok,
    name: c.name,
    detail: c.detail,
    fix: c.fix,
  }));
  const agents = `${runs.removed ? `, ${runs.removed} old agent run folder(s) removed` : ""}${runs.failed.length ? `; couldn't clean ${runs.failed.join(", ")}` : ""}${tidied.length ? `, old tools removed (${tidied.join(", ")})` : ""}${images.pruned ? `, containers' images removed (${images.pruned} slot(s))` : ""}${images.failed.length ? `; couldn't prune containers of ${images.failed.join(", ")}` : ""}${onBox && !idle ? "; tools and images left as they are (another slot is busy)" : ""}`;
  const summary = `${t.folders} task folder(s) removed${agents}${full.length ? `; notebook pages nearly full, to split: ${full.join(", ")}` : ""}${door ? `; ${door}` : ""}`;
  const posted = updateStatusIssue(
    (s) => {
      const doctorSays = setCleanup(s, box, { at, run: runUrl(), summary, checks });
      const health = inActions() ? setBox(s, box, boxFacts()) : undefined;
      const said = [doctorSays, health].filter(Boolean).join("\n\n");
      return said ? alertReply(said) : undefined;
    },
    { timeZone: timeZone() },
  );
  await toYourChats(posted);
  return ok("watch cleanup", `${box}: ${summary}`, { checks: d.checks });
}

/**
 * Whether another of this box's slots is running a job (the runner's Worker processes; this job's
 * own is one). When it can't tell, it says busy: the tidy waits for next week.
 */
function otherSlotBusy(): boolean {
  const r = spawnSync(
    "pgrep",
    ["-u", String(process.getuid?.() ?? ""), "-fc", "bin/Runner.Worker"],
    {
      encoding: "utf8",
    },
  );
  if (r.error || (r.status !== 0 && r.status !== 1)) return true;
  return Number(r.stdout?.trim() || 0) > 1;
}

/**
 * Something you'd want to know on the status task, as a reply the door copies to your default
 * channels (an alert: SHIPIFY_SEND), keyed by its words and the hour so a repeat is written once.
 */
function alertReply(text: string): string {
  const key = `alert:${hash8(text)}:${new Date().toISOString().slice(0, 13)}`;
  const people = readPeople().people[0];
  const to = replyTo({
    kind: "alert",
    asked: [],
    defaults: defaultChannels(),
    ...(people ? { owner: people } : {}),
  });
  const line = replyLine({
    v: 1,
    kind: "alert",
    state: "Alert",
    title: "Shipify status",
    links: [],
    to,
    key,
  });
  return [line, text].join("\n\n");
}

/** The door told of an alert just posted, so it reaches your chat now (else the watch's notice). */
async function toYourChats(posted: { issue?: number; comment?: number }) {
  if (posted.issue && posted.comment)
    await tellDoor(posted.issue, posted.comment, []).catch(() => {});
}

/**
 * The watch saw something change (ADR 0031): written on the status task, and, when you'd care, a
 * reply there that the door copies to your default channels. The findings come as the argument, or
 * from the newest findings comment the door App left on the status task with its doorbell.
 */
export async function watchAlert(json: string | undefined): Promise<Result> {
  const raw = json ?? latestFindings();
  if (!raw) return ok("watch alert", "no findings to note");
  const { findings, dropped } = readFindings(raw);
  if (dropped.length)
    process.stderr.write(`  … dropped, not a known name or state: ${dropped.join(", ")}\n`);
  let changed = false;
  const posted = updateStatusIssue(
    (s) => {
      const before = JSON.stringify([s.boxes, s.apps, s.channels, s.alerted]);
      const comment = applyFindings(s, findings);
      changed = JSON.stringify([s.boxes, s.apps, s.channels, s.alerted]) !== before;
      return comment ? alertReply(comment) : undefined;
    },
    { timeZone: timeZone() },
  );
  await toYourChats(posted);
  const seen = [
    ...Object.entries(findings.boxes).map(([n, st]) => `${n} ${st}`),
    ...Object.entries(findings.apps).map(([n, st]) => `${n} ${st}`),
    ...Object.entries(findings.channels ?? {}).map(([n, c]) => `${n} ${c.state}`),
  ];
  return ok(
    "watch alert",
    seen.length ? `${seen.join(", ")}${changed ? "" : " (nothing new)"}` : "nothing to note",
  );
}

/** The newest findings the door App left on the status task with its doorbell: a hidden JSON line. */
function latestFindings(): string | undefined {
  const door = doorLogin();
  const s = tryOr(() => rec().issues({ labels: ["shipify-status"] })[0], undefined);
  if (!s || !door) return undefined;
  const found = [...rec().comments(s.number)]
    .reverse()
    .find((c) => c.user.login === door && c.body.includes("<!-- shipify-findings "));
  const m = found ? /<!-- shipify-findings (\{[^\n]*\}) -->/.exec(found.body) : null;
  return m?.[1];
}
