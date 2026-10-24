// A run's steps (ADR 0031), one command each, called by task.yml's run job in order:
//   ship run task <n>     read the task once, for plan; output: its account (ADR 0045)
//   ship run plan <n>     decide; write `working` first; outputs: do, profile, repos, account
//   ship run think <n>    the agent (or a check), as the slot's own user; skipped when not needed
//   ship run decide <n>   its result into writes; outputs what to mint: repo, act, workflows, files
//   ship run apply <n>    make the writes, save the status, tell the door
//   ship run github <n>   the github job's pending work: a merged plan's repo and keys, an operation,
//                         PRs to close
// Each step leaves its file in .tasks/<n>/ for the next. Outputs come from fixed lists only.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { filesDir, queue, rec, thisRun, workspace } from "../commands/task/context.ts";
import { followDeploy } from "../commands/task/deploys.ts";
import { fileHash, freeFile, laterAttachments, taskAttachments } from "../commands/task/files.ts";
import { LOGIN } from "../contracts/accounts.ts";
import {
  asProblem,
  errorLine,
  logger,
  MAX_FILES_IN,
  type Problem,
  problem,
  renderProblem,
  STAYING_LABEL,
  STUCK_LABEL,
} from "../contracts/index.ts";
import { accountOf } from "../lib/accounts.ts";
import { installAgent } from "../lib/agent-install.ts";
import { loginOf } from "../lib/agents.ts";
import { callsSoFar } from "../lib/exec.ts";
import { ghRun, platformRepo, readsSeen, repoOfPr } from "../lib/github.ts";
import { onBox } from "../lib/sandbox.ts";
import { type Result, ShipError } from "../lib/output.ts";
import type { RecordWrite } from "../lib/plugins/record.ts";
import { repoFor } from "../lib/projects-on-github.ts";
import type { RunDetails } from "../lib/runs.ts";
import { PLATFORM, type TaskState } from "../lib/task.ts";
import { executors, taskAgent } from "./agent.ts";
import { apply } from "./apply.ts";
import {
  afterThink,
  cursorOf,
  plan as decidePlan,
  lateStop,
  sharedBefore,
  stillWaiting,
} from "./decide.ts";
import { doorFile, outward } from "./door.ts";
import { githubJob } from "./github-job.ts";
import { listOf } from "./instant.ts";
import { readResult } from "./result.ts";
import {
  context,
  readRecord,
  recordAccount,
  saidOf,
  saidSince,
  snapshot,
  type TaskRecord,
  textHash,
} from "./snapshot.ts";
import {
  ends,
  givesWay,
  needsMint,
  stay,
  stayMinutes,
  staysAfter,
  stayUntil,
  type Turn,
  takes,
} from "./stay.ts";
import { finish, think as runThink, type ThinkOut } from "./think.ts";
import type { Decided, Plan, Said, Snapshot, ThinkMeta, Trigger, Write } from "./types.ts";

const dir = (n: number) => join(workspace(), ".tasks", String(n));
const file = (n: number, name: string) => join(dir(n), `${name}.json`);
const save = (n: number, name: string, v: unknown) => {
  mkdirSync(dir(n), { recursive: true });
  writeFileSync(file(n, name), JSON.stringify(v));
};
const load = <T>(n: number, name: string): T | undefined =>
  existsSync(file(n, name)) ? (JSON.parse(readFileSync(file(n, name), "utf8")) as T) : undefined;

/**
 * One step's timing line, for the job's summary (ADR 0051 B0): its time, and every `gh` call it
 * made with each one's. Counted by `run`/`runAsync` in `cli/lib/exec.ts`, and nowhere else.
 */
export function stepLine(step: string, ms: number): string {
  const calls = callsSoFar();
  const secs = (x: number) => `${Math.round(x / 100) / 10} s`;
  const one = (c: { name: string; ms: number }) => `${c.name} ${secs(c.ms)}`;
  return [
    `${step} ${secs(ms)}`,
    calls.length
      ? `${calls.length} gh call${calls.length === 1 ? "" : "s"}, ${secs(
          calls.reduce((a, c) => a + c.ms, 0),
        )} (${calls.map(one).join(", ")})`
      : "no gh calls",
  ].join(" · ");
}

/** One word of a step's output: a name from a fixed list, or a project's id. */
const WORD = "[a-z][a-z0-9_-]{0,40}";
/** A repo's name, as GitHub allows it. */
const REPO = "[A-Za-z0-9._-]{1,100}";
/** A secret's name, as executors.json says it. */
const SECRET = "[A-Z][A-Z0-9_]{0,60}";
/** An account's login (ADR 0045), as `accounts.ts` reads them. */
const ACCOUNT = LOGIN.source.replace(/^\^|\$$/g, "");
/** A step's output for the workflow: a plain word, or a list of them (plan's `repos`: repo names),
 * never free text. */
function output(name: string, value: string, word = WORD) {
  if (!new RegExp(`^(${word}(,${word})*)?$`).test(value))
    throw new ShipError(`refusing an output that isn't plain words: ${name}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${name}=${value}\n`);
  else process.stderr.write(`  … ${name}=${value}\n`);
}

/** What started this run, from the workflow's event. */
export function triggerFromEnv(env: NodeJS.ProcessEnv = process.env): Trigger {
  const event = env.EVENT ?? "";
  const action = env.ACTION ?? "";
  if (event === "workflow_dispatch")
    return { kind: "dispatch", job: env.JOB === "github" ? "github" : "run" };
  if (event === "issue_comment") return { kind: "comment" };
  if (event === "issues" && ["opened", "edited", "closed", "reopened"].includes(action))
    return { kind: action as "opened" | "edited" | "closed" | "reopened" };
  return { kind: "comment" };
}

/**
 * The repos a work run's agent may read, for its token in task.yml: its project's and Shipify's, as
 * the work profile says. Empty for every other run, which the token reads as every repo: a talk
 * run reads them all, and a new project isn't on GitHub before its repo is made. A run on another
 * account (ADR 0045) gets Shipify's alone from the bot, for its task's record: its repo's key is
 * the repos App's (accountRepos).
 */
export function agentRepos(s: Snapshot, p: Plan): string {
  if (p.do !== "think") return "";
  const shipify = platformRepo().split("/")[1] ?? PLATFORM;
  if (p.think.account) return shipify;
  const name = (n: string) => repoFor(n, s.repos).split("/")[1] ?? n;
  // A read run (ADR 0044): its key stays with the box, for the task and your repos it reads.
  if (p.think.profile === "read")
    return [
      ...new Set([
        ...(p.think.reads ?? []).filter((r) => r.mine).map((r) => name(r.name)),
        shipify,
      ]),
    ].join(",");
  if (p.think.profile !== "work" || !p.think.project) return "";
  const project = p.think.project;
  // Your repos the task reads (ADR 0044) are cloned with this key too.
  const reads = (p.think.reads ?? []).filter((r) => r.mine).map((r) => name(r.name));
  if (project === PLATFORM) return [...new Set([shipify, ...reads])].join(",");
  if (!s.repos.some((r) => r.name === project)) return "";
  return [...new Set([name(project), ...reads, shipify])].join(",");
}

/**
 * The repos on another account a run's agent reads (ADR 0045), by name, for the repos App's token
 * on that account: a work run's repo and those it reads there; a talk run's, every repo the App
 * reaches there, as a talk run on Shipify's own reads every project. Empty for a run on Shipify's
 * own.
 */
export function accountRepos(s: Snapshot, p: Plan): string {
  if (p.do !== "think" || !p.think.account) return "";
  const account = p.think.account;
  const on = (n: string) => {
    const repo = repoFor(n, s.repos);
    return accountOf(repo) === account ? repo.split("/")[1] : undefined;
  };
  const talk =
    p.think.profile === "talk"
      ? s.repos.filter((r) => accountOf(r.repo) === account).map((r) => r.name)
      : [];
  const project = p.think.profile === "work" && p.think.project ? [p.think.project] : [];
  const reads = (p.think.reads ?? []).filter((r) => r.mine).map((r) => r.name);
  return [
    ...new Set([...talk, ...project, ...reads].map(on).filter((x): x is string => Boolean(x))),
  ].join(",");
}

/** The task step's read, when it was this run's (ADR 0045): plan carries on from it. */
const recordOf = (n: number): TaskRecord | undefined => {
  const saved = load<{ run?: string; record: TaskRecord }>(n, "task");
  const run = thisRun();
  return saved && run && saved.run === run ? saved.record : undefined;
};

/**
 * The task step (ADR 0045): the run's one read of its task, saved for plan, and the account it
 * works on besides Shipify's own, so the step after it mints plan's token for that account.
 */
export async function runTask(n: number): Promise<Result> {
  // `at` is taken before the read, so apply's "since" never starts after a comment the read missed.
  const at = new Date(Date.now() - 60_000).toISOString();
  const record = readRecord(n);
  save(n, "task", { run: thisRun(), at, record });
  const account = recordAccount(n, record) ?? "";
  output("account", account, ACCOUNT);
  // The repos on that account whose PRs the github job may close: its token's, and no more.
  const prRepos = (record.state.pending.closePrs ?? [])
    .map((u) => repoOfPr(u))
    .filter((r): r is string => Boolean(r && account && accountOf(r) === account))
    .map((r) => r.split("/")[1] as string);
  output("pr_repos", [...new Set(prRepos)].join(","), REPO);
  return {
    command: "run task",
    status: "succeeded",
    summary: `task #${n}: ${account ? `on ${account}` : "on Shipify's own account"}`,
  };
}

/**
 * The agent a think runs, and the secret its login is in (its own, or its gateway's key), for
 * task.yml: the box installs that agent, and the think step gets that one secret. Empty with no
 * agent to run.
 */
export function agentOf(p: Plan): { agent: string; login: string } {
  if (p.do !== "think" || profileOf(p) === "check") return { agent: "", login: "" };
  const agent = taskAgent(p.state);
  return { agent, login: loginOf(executors()[agent])?.secret ?? "" };
}

/** The run's profile for task.yml: a check alone needs no agent on the box; one the agent follows
 * (a recipe's, a repeat that thinks on a change) does. */
export const profileOf = (p: Plan) =>
  p.do === "think" ? (p.think.check && !p.think.thenAsk ? "check" : p.think.profile) : "none";

/** Plan's read and decision (plan's step, and each turn of a stay): the snapshot, then the plan. */
async function planned(
  n: number,
  trigger: Trigger,
  record?: TaskRecord,
): Promise<{ s: Snapshot; p: Plan }> {
  // The steps hand on through files the workspace keeps: a run starts with none of the last run's,
  // so one with no agent never applies another's thinking (its run line, its files).
  for (const step of ["think", "decided"]) rmSync(file(n, step), { force: true });
  const { s, ctx } = snapshot(n, trigger, { look: true, ...(record ? { record } : {}) });
  // A merge's own run follows its deploy to the end, so decide tells it now (about a minute).
  if (ctx.merged)
    ctx.deploy = await followDeploy(ctx.merged, process.env.SHIPIFY_READ_TOKEN || undefined);
  return { s, p: decidePlan(s, ctx) };
}

export async function runPlan(n: number): Promise<Result> {
  const log = logger({ task: n, step: "plan" }, (l) => process.stderr.write(`${l}\n`));
  const { s, p } = await planned(n, triggerFromEnv(), recordOf(n));
  // Your words on a closed task carry it on: it opens now, not after the agent, so every chat
  // lists it as open and working while the run goes. If this fails, apply opens it as before.
  if (p.do === "think" && p.writes?.some((w) => w.w === "reopen")) {
    try {
      rec().updateIssue(n, { state: "open" });
      p.writes = p.writes.filter((w) => w.w !== "reopen");
    } catch (e) {
      log.warn("run.plan.reopen", { what: String(e) });
    }
  }
  save(n, "plan", { s, p });
  output("do", p.do);
  output("profile", profileOf(p));
  output("repos", agentRepos(s, p), REPO);
  output("account", p.do === "think" ? (p.think.account ?? "") : "", ACCOUNT);
  output("account_repos", accountRepos(s, p), REPO);
  const { agent, login } = agentOf(p);
  output("agent", agent);
  output("login", login, SECRET);
  if (p.do === "nothing") {
    log.info("run.plan.nothing", { why: p.why });
    return { command: "run plan", status: "skipped", summary: `task #${n}: ${p.why}` };
  }
  await marked(n, s, p);
  log.info("run.plan.decided", { do: p.do, why: p.why });
  return { command: "run plan", status: "succeeded", summary: `task #${n}: ${p.why}` };
}

/** What plan marks on the task as it starts: 👀 on what it read, `working` on a think. */
async function marked(n: number, s: Snapshot, p: Plan): Promise<void> {
  // `stuck` comes off (this run takes the task on again), 👀 goes on what this run read, and a
  // think says `working` — all together, one write each (ADR 0051 B3).
  const newWords = s.said.filter(
    (c) => (c.author === "owner" || c.author === "door") && c.id > s.state.seen,
  );
  const newTaskWords =
    (s.state.bodyHash === undefined || s.state.bodyHash !== s.bodyHash) &&
    (s.issue.author === "owner" || s.issue.author === "door");
  const alongside: RecordWrite[] = [
    ...(s.issue.labels.includes(STUCK_LABEL)
      ? [{ w: "unlabel", n, name: STUCK_LABEL } as RecordWrite]
      : []),
    ...newWords.map((c) => ({ w: "react", on: { comment: c.id }, content: "eyes" }) as RecordWrite),
    ...(newTaskWords ? [{ w: "react", on: { issue: n }, content: "eyes" } as RecordWrite] : []),
  ];
  if (p.do === "think") {
    // The status comment is written from the snapshot's issue, never a second read of it, and its
    // id saved for apply (ADR 0051 B2).
    const { Status } = await import("../commands/task/issue.ts");
    const status = new Status(
      { number: n, labels: s.issue.labels.map((name) => ({ name })) },
      s.statusId,
      { ...p.state, cursor: cursorOf(s, p.state) },
    );
    await status.save("working", { summary: "Working on it." }, { alongside });
    if (status.commentId) s.statusId = status.commentId;
    // The labels as the status left them: apply's status saves start from these, never a second
    // read of the issue (ADR 0051 B2).
    s.issue.labels = status.labels;
  } else await rec().together(alongside);
  // Saved after the writes, so apply reads the status comment's id from here (ADR 0051 B2).
  save(n, "plan", { s, p });
}

/**
 * The chat files a run fetches: the newest few on the task, so what you sent last isn't crowded out
 * by a long task's first ones; the names of the older ones, to say they were left out.
 */
export function newestFiles(from: ({ files?: { ref: string; name: string }[] } | undefined)[]): {
  refs: { ref: string; name: string }[];
  older: string[];
} {
  const all = from.flatMap((f) => f?.files ?? []).filter((f) => !/^https?:/.test(f.ref));
  return {
    refs: all.slice(-MAX_FILES_IN),
    older: all.slice(0, Math.max(0, all.length - MAX_FILES_IN)).map((f) => f.name),
  };
}

/**
 * Files you sent through a chat: from the door, by the refs on these `from` lines, into the task's
 * files folder beside what's there. Notes for the agent.
 */
async function chatFiles(
  n: number,
  from: ({ files?: { ref: string; name: string }[] } | undefined)[],
): Promise<string[]> {
  const { refs, older } = newestFiles(from);
  const fetched: string[] = [];
  const missed: string[] = [];
  mkdirSync(filesDir(n), { recursive: true });
  for (const f of refs) {
    const body = await doorFile(f.ref).catch(() => undefined);
    const name = f.name.replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "") || "file";
    if (body) {
      // Telegram names every photo photo.jpg: two in one message mustn't overwrite each other.
      const file = freeFile(filesDir(n), name);
      writeFileSync(file, body);
      fetched.push(basename(file));
    } else missed.push(f.name);
  }
  return [
    ...(fetched.length ? [`From your chat: ${fetched.join(", ")} (in the files folder).`] : []),
    ...(missed.length
      ? [
          `These came through the chat but couldn't be fetched from the door: ${missed.join(", ")}. Say so in your reply.`,
        ]
      : []),
    ...(older.length
      ? [
          `Older files from the chat aren't in the files folder (a run takes the newest ${MAX_FILES_IN}): ${older.join(", ")}. If you need one, ask for it again.`,
        ]
      : []),
  ];
}

export async function runThinkStep(
  n: number,
  stay: {
    resume?: string;
    /** What the resumed session had counted when its last ask ended: this turn counts only what's new. */
    used?: ThinkMeta["used"];
    minutes?: number;
    record?: TaskRecord;
    /** Each read of your words since plan's, newest last: a stay's decide takes the newest. */
    heard?: (said: Said[]) => void;
  } = {},
): Promise<Result> {
  const saved = load<{ s: Snapshot; p: Plan }>(n, "plan");
  if (saved?.p.do !== "think")
    return {
      command: "run think",
      status: "skipped",
      summary: `task #${n}: nothing to think about`,
    };
  // The owner's pasted images and linked files, fetched now (their links last minutes) for the agent.
  const { s } = saved;
  const words = new Set(
    s.said.filter((c) => c.author === "owner" || c.author === "door").map((c) => c.id),
  );
  // A stay's turn hands in the read its plan made a moment ago (ADR 0057): no second read.
  const { record, heard, ...resume } = stay;
  const given = await taskAttachments(
    n,
    record?.issue ?? rec().issue(n),
    (record?.comments ?? rec().comments(n)).filter((c) => words.has(c.id)),
  ).catch((e: Error) => ({
    notes: [`The owner's files couldn't be fetched: ${e.message}`],
    unread: [],
    videos: 0,
  }));
  const notes = [
    ...(await chatFiles(n, [s.issue.from, ...s.said.map((c) => c.from)])),
    ...given.notes,
    ...(given.unread.length
      ? [
          `These were attached on GitHub, where no box can download them: ${given.unread.join(", ")}. Say so in your reply, and ask for a link to them in one of the owner's repos (or a paste) instead.`,
        ]
      : []),
    ...(given.videos
      ? [`${given.videos} video(s) were attached, which no box can read: say so in your reply.`]
      : []),
  ];
  // What you write while it works: comments since the plan read the task (a minute's margin; think
  // keeps those after the newest it had), read for your `stop` and before it answers.
  const since = new Date(Date.parse(s.now) - 60_000).toISOString();
  // The state as the plan left it: `start over` gave the task a new branch, cloned from main.
  const out = await runThink({ ...s, state: saved.p.state }, saved.p.think, {
    files: filesDir(n),
    keep: join(dir(n), "out"),
    local: join(dir(n), "agent"),
    notes,
    later: () => {
      const said = saidSince(n, since);
      heard?.(said);
      return said;
    },
    // What the run's model takes, from its gateway's public catalog.
    look: async (url) => listOf(url),
    // A stay's turn: its session, and what that had counted (`used`), so the turn counts only what
    // it adds (an agent that counts from the session's start).
    ...resume,
    // The files on words it takes in before it answers, fetched as the first ones were.
    fetch: async (said) => [
      ...(await chatFiles(
        n,
        said.map((c) => c.from),
      )),
      ...(await laterAttachments(n, said, since)),
    ],
  });
  save(n, "think", out);
  return { command: "run think", status: "succeeded", summary: `task #${n}: thought` };
}

/**
 * The finish (ADR 0059), between think and decide: a work run's branch, on a project of yours that
 * its PR is asked for, brought up to date with main and checked again, with a read key minted after
 * the agent. Any other run has nothing to finish.
 */
export async function runFinishStep(n: number): Promise<Result> {
  const saved = load<{ s: Snapshot; p: Plan }>(n, "plan");
  const t = load<ThinkOut>(n, "think");
  const nothing = { command: "run finish", status: "skipped" as const };
  if (saved?.p.do !== "think" || !t)
    return { ...nothing, summary: `task #${n}: nothing to finish` };
  const k = saved.p.think;
  const path = join(t.out, "result.json");
  const result = readResult(existsSync(path) ? readFileSync(path, "utf8") : undefined);
  const asks = !("error" in result) && result.state !== "failed" && result.pr?.kind !== "publish";
  const mine = k.profile === "work" && k.project && !k.ownRules && !k.account;
  if (!mine || !asks || !result.pr || !t.meta.commits || t.meta.firstPush)
    return { ...nothing, summary: `task #${n}: no PR to bring up to date` };
  const done = await finish({ ...saved.s, state: saved.p.state }, k, {
    keep: t.out,
    local: join(dir(n), "agent"),
  });
  if (done.note && t.details) t.details.notes = [...(t.details.notes ?? []), done.note];
  if (done.changed)
    t.meta.touchesWorkflows = done.changed.some((f) => f.startsWith(".github/workflows/"));
  save(n, "think", t);
  return {
    command: "run finish",
    status: "succeeded",
    summary: `task #${n}: ${done.note ?? "up to date with main"}`,
  };
}

/**
 * Decide's core (decide's step, and each turn of a stay): the writes, saved for apply. A stay's turn
 * hands in think's newest read of your words (`heard`), made as its agent answered: no read again.
 */
function decided(
  n: number,
  heard?: Said[],
): { s: Snapshot; p: Plan; d: Decided; meta?: ThinkMeta } | undefined {
  const saved = load<{ s: Snapshot; p: Plan }>(n, "plan");
  if (!saved || saved.p.do === "nothing" || saved.p.do === "github") return undefined;
  const { s, p } = saved;
  const meta = load<ThinkOut>(n, "think")?.meta;
  let d: Decided;
  if (p.do === "box") d = { writes: p.writes, state: p.state, needs: needsOf(p.writes, p.state) };
  else {
    const t = load<ThinkOut>(n, "think");
    const path = t ? join(t.out, "result.json") : undefined;
    const result = path
      ? readResult(existsSync(path) ? readFileSync(path, "utf8") : undefined)
      : { error: "the agent's step didn't run" };
    d = afterThink(
      s,
      p.state,
      p.think,
      result,
      t?.meta ?? { readOutside: true, touchesWorkflows: false },
      context(s),
    );
    // What the box makes anyway (a note, a command's answer, a `use` reply) goes first.
    if (p.writes?.length) d.writes = [...p.writes, ...d.writes];
    // A file shared before, unchanged, is linked: no upload, so no files key.
    const out = t?.out;
    if (out)
      sharedBefore(d, (name) => {
        const f = join(out, basename(name));
        return existsSync(f) ? fileHash(f) : undefined;
      });
    d.needs = { ...needsOf(d.writes, d.state), ...d.needs };
    // A stay's turn: a `stop` alone that came as it answered is read with this answer.
    if (heard) lateStop(d, heard);
    // Your words since its last read (its checks ran meanwhile): one more read, said in the reply.
    try {
      stillWaiting(d, heard ?? saidSince(n, new Date(Date.parse(s.now) - 60_000).toISOString()));
    } catch {}
  }
  save(n, "decided", d);
  return { s, p, d, ...(meta ? { meta } : {}) };
}

/**
 * What task.yml mints for a decided result, as step outputs: decide's, and a stay's turn that
 * ends with a result to apply (ADR 0062). Only task.yml's steps mint, after the agent is done.
 */
function mints(s: Snapshot, d: Decided) {
  const repo = d.needs.repo ? repoFor(d.needs.repo, s.repos) : "";
  output("repo", repo.split("/")[1] ?? "", REPO);
  // The repo's account, when it's another of yours (ADR 0045): its write token is the repos App's.
  output("account", accountOf(repo) ?? "", ACCOUNT);
  output("act", d.needs.act ?? "");
  output("workflows", d.needs.workflows ? "write" : "");
  output("files", d.writes.some((w) => w.w === "reply" && w.files?.length) ? "yes" : "");
  // Its only push keeps a question's commits (ADR 0041): its write token may fail to mint, and the
  // question is still posted (the push, without it, only logged).
  const pushes = d.writes.filter((w) => w.w === "push");
  output("keep", pushes.length && pushes.every((w) => w.open === false && w.quiet) ? "quiet" : "");
}

export async function runDecide(n: number): Promise<Result> {
  const got = decided(n);
  if (!got)
    return { command: "run decide", status: "skipped", summary: `task #${n}: nothing to decide` };
  const { s, p, d, meta } = got;
  // A run that stays after its answer (ADR 0057): `staying` goes on before the answer, so your next
  // words, from any chat, start no run of their own while it does.
  const stays = staysAfter(s, p, d, meta, stayMinutes(process.env.SHIPIFY_STAY));
  if (stays) {
    d.writes = [{ w: "labels", add: [STAYING_LABEL] }, ...d.writes];
    save(n, "decided", d);
  }
  output("stay", stays ? "yes" : "");
  mints(s, d);
  return {
    command: "run decide",
    status: "succeeded",
    summary: `task #${n}: ${d.writes.length} writes${stays ? ", then it stays" : ""}`,
  };
}

/** Apply's step; a stay's turn hands in the read its plan made (`record`): no read again. */
export async function runApply(n: number, record?: TaskRecord): Promise<Result> {
  const saved = load<{ s: Snapshot; p: Plan }>(n, "plan");
  const d = load<Decided>(n, "decided");
  if (!saved || !d)
    return { command: "run apply", status: "skipped", summary: `task #${n}: nothing to apply` };
  const t = load<ThinkOut>(n, "think");
  const done = await apply(saved.s, d.state, d.writes, {
    ...outward(),
    ...(record ? { comments: record.comments } : {}),
    ...(t?.details ? { details: t.details as RunDetails } : {}),
    ...(t?.out ? { out: t.out } : {}),
    tokens: {
      ...(process.env.SHIPIFY_WRITE_TOKEN ? { repo: process.env.SHIPIFY_WRITE_TOKEN } : {}),
      ...(process.env.SHIPIFY_FILES_TOKEN ? { files: process.env.SHIPIFY_FILES_TOKEN } : {}),
    },
  });
  // A problem told on the task (a reply carried it) is the task's, not a broken run: the job
  // stays green, so its failure step doesn't send a second message. Untold, the job fails, and its
  // failure step says this problem (not "the apply step failed").
  const run = thisRun();
  if (!done.told && run) save(n, "broke", { run, problem: done.problems[0] });
  return {
    command: "run apply",
    status: done.told ? "succeeded" : "failed",
    // The replies' kinds, for the log (ship selftest chat reads them: an answer, never a failure).
    summary: `task #${n}: ${done.replies.length} replies (${
      d.writes.flatMap((w) => (w.w === "reply" ? [w.kind] : [])).join(", ") || "none"
    })${done.problems.length ? `, ${done.problems.map((p) => p.code).join(", ")}` : ""}`,
  };
}

export async function runGithub(n: number): Promise<Result> {
  const record = recordOf(n);
  const { s, ctx } = snapshot(n, { kind: "dispatch", job: "github" }, record ? { record } : {});
  const p = decidePlan(s, ctx);
  if (p.do !== "github")
    return { command: "run github", status: "skipped", summary: `task #${n}: ${p.why}` };
  return githubJob(s, p);
}

/** The steps task.yml runs, by the name `ship run <step>` takes. */
/** The agent this run's plan named, installed on the box if it isn't yet (ADR 0038). */
export async function runAgentStep(n: number): Promise<Result> {
  const saved = load<{ s: Snapshot; p: Plan }>(n, "plan");
  const { agent } = saved ? agentOf(saved.p) : { agent: "" };
  const entry = executors()[agent];
  if (!agent || !entry?.install)
    return { command: "run agent", status: "skipped", summary: `task #${n}: no agent to install` };
  const bin = installAgent(agent, entry);
  return { command: "run agent", status: "succeeded", summary: `task #${n}: ${agent} at ${bin}` };
}

/**
 * A run that stays (ADR 0057, ADR 0063): after its answer, the run reads its task for a few quiet
 * minutes and does with your words what a normal run would, each turn as a run does (plan, think in
 * the same session, decide, apply), so the next answer starts in seconds. Only what needs another
 * agent, a fresh clone or the task's text read again goes to a normal run; a result that needs a
 * token minted after the agent ends the stay, and its job's next steps mint and apply it (ADR 0062).
 */
export async function runStay(n: number): Promise<Result> {
  const saved = load<{ s: Snapshot; p: Plan }>(n, "plan");
  const first = saved?.p;
  // The session and what it had counted, kept here: each turn's plan clears the last think's file.
  let session = load<ThinkOut>(n, "think")?.meta?.session;
  let used = load<ThinkOut>(n, "think")?.meta?.used;
  if (!saved || first?.do !== "think" || !session)
    return { command: "run stay", status: "skipped", summary: `task #${n}: nothing to stay for` };
  const log = logger({ task: n, step: "stay" }, (l) => process.stderr.write(`${l}\n`));
  // Every comment the run has read: only yours after them are new words.
  let after = Math.max(saved.s.state.seen, ...saved.s.said.map((c) => c.id));
  const since = new Date(Date.parse(saved.s.now) - 60_000).toISOString();
  const tags: { comments?: string; issue?: string; queue?: string } = {};
  let waits = false;
  // The task's text as the run read it: an edit since, even during its first think, is news.
  const text = saved.s.bodyHash;
  let queued: { since?: string; run?: number } | undefined;
  const began = Date.now();
  // The jobs this slot may take: any task's run, and its own box's weekly clean-up (`box-<name>`).
  const box = process.env.SHIPIFY_BOX;
  const mayTake = ["shipify-box", ...(box ? [`box-${box}`] : [])];
  // Your words, not a setting the door wrote (a `use` or `close` from a chat starts nothing).
  const yours = (c: Said) =>
    (c.author === "owner" || c.author === "door") && c.id > after && !c.from?.setting;
  const io = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    news() {
      const r = rec().commentsIfChanged(n, since, tags.comments);
      tags.comments = r.tag;
      if (r.comments) waits = saidOf(n, r.comments, saved.s.statusId).some(yours);
      return waits;
    },
    task(): "open" | "closed" | "edited" | "unlabelled" {
      const r = rec().issueIfChanged(n, tags.issue);
      tags.issue = r.tag;
      if (!r.issue) return "open";
      if (r.issue.state === "closed") return "closed";
      if (textHash(r.issue) !== text) return "edited";
      return r.issue.labels.some((l) => l.name === STAYING_LABEL) ? "open" : "unlabelled";
    },
    waiting() {
      const r = queue().waitingFor(mayTake, tags.queue);
      // Unchanged since the last look (no answer): the job seen waiting then still waits.
      if (r.tag !== tags.queue || r.waiting || !queued)
        queued = r.waiting ? { since: r.since, run: r.run } : undefined;
      tags.queue = r.tag;
      return givesWay(queued?.since, Date.now(), onBox()?.slot ?? 1, began);
    },
    async turn(minutes: number): Promise<Turn> {
      waits = false;
      const clock = turnClock();
      const record = readRecord(n);
      // Closed meanwhile: a normal run says what your words on a closed task do.
      if (record.issue.state === "closed") return "handover";
      const { s, p } = await planned(n, { kind: "comment" }, record);
      clock.lap("plan");
      const words = s.said.filter(yours);
      after = Math.max(after, ...s.said.map((c) => c.id));
      // Words that aren't yours, or only a setting, leave nothing to do.
      if (p.do === "nothing" || !words.length || (p.do === "box" && !p.writes.length))
        return "nothing";
      // What a normal run would do, done here (ADR 0063): plan's choice, a fixed word's too.
      if (!takes(first, p)) return "handover";
      await marked(n, s, p);
      clock.lap("marks");
      // One read of the task a turn, and one of your words as it answers (ADR 0057): decide takes
      // that newest, apply the turn's. Words after it are the next turn's, which the stay answers.
      let heard: Said[] | undefined;
      if (p.do === "think") {
        await runThinkStep(n, {
          resume: session,
          used,
          minutes,
          record,
          heard: (said) => {
            heard = said;
          },
        });
        clock.lap("think");
      }
      const got = decided(n, heard);
      clock.lap("decide");
      if (!got) return "handover";
      const { d, meta } = got;
      // What this answer read (words it took in, your `stop`) is no news after it.
      after = Math.max(after, d.state.seen);
      // A result that needs a token minted after the agent (a push, a call, files, your `yes` to a
      // list), ADR 0062: the stay ends with it decided, and the job's own steps mint and apply it.
      if (needsMint(d)) {
        mints(s, d);
        output("apply", "yes");
        process.stderr.write(`  · ${clock.line()}\n`);
        return "apply";
      }
      // Its reply refused, and the problem too: the step fails, and its failure step tells you.
      const applied = await runApply(n, record);
      if (applied.status === "failed") throw new ShipError(applied.summary);
      clock.lap("apply");
      // Where a turn's time went, in the run's log (ADR 0057): each phase, and apply's calls.
      process.stderr.write(`  · ${clock.line()}\n`);
      // A box answer leaves the session as it was.
      if (p.do === "box") return ends(d) ? "left" : "answered";
      session = meta?.session ?? session;
      used = meta?.used ?? used;
      // A write a stay never follows (a run started, a close): it answered, then leaves.
      return staysAfter(s, p, d, meta, 1) ? "answered" : "left";
    },
    leave: () => rec().removeLabel(n, STAYING_LABEL),
    handover() {
      rec().removeLabel(n, STAYING_LABEL);
      const d = queue().dispatch("task.yml", { issue: String(n), job: "run" });
      if (!d.ok) log.warn("run.stay.handover", { what: d.error });
    },
  };
  // Its job's clock, from when plan read the task: the stay's only bound besides its quiet minutes.
  const until = stayUntil(Date.parse(saved.s.now));
  const done = await stay(io, stayMinutes(process.env.SHIPIFY_STAY), until);
  // What its reads came to, and the run it gave way to, for a look in the run's log.
  log.info("run.stay.left", {
    answered: done.answered,
    why: done.why,
    reads: readsSeen(),
    ...(queued?.run && done.why.startsWith("another run waits") ? { to: queued.run } : {}),
  });
  return {
    command: "run stay",
    status: "succeeded",
    summary: `task #${n}: stayed, ${done.answered} answer${done.answered === 1 ? "" : "s"}; left: ${done.why}`,
  };
}

/** A stay's turn, timed by phase, with the gh calls each made (ADR 0051 B0's measure). */
function turnClock() {
  const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;
  const laps: string[] = [];
  let at = Date.now();
  let calls = callsSoFar().length;
  return {
    lap(name: string) {
      const made = callsSoFar().slice(calls);
      laps.push(
        `${name} ${secs(Date.now() - at)}${made.length ? ` (${made.map((c) => `${c.name} ${secs(c.ms)}`).join(", ")})` : ""}`,
      );
      at = Date.now();
      calls = callsSoFar().length;
    },
    line: () => `stay turn: ${laps.join(" · ")}`,
  };
}

const STEPS = {
  task: runTask,
  plan: runPlan,
  agent: runAgentStep,
  think: runThinkStep,
  finish: runFinishStep,
  decide: runDecide,
  apply: runApply,
  stay: runStay,
  github: runGithub,
} as const;
export type Step = keyof typeof STEPS;
export const isStep = (s: string | undefined): s is Step =>
  s !== undefined && Object.hasOwn(STEPS, s);

/**
 * The step of this job that failed, by its name in task.yml, when it's one of the workflow's own (a
 * key GitHub wouldn't mint): what `run failed` says broke, when no step of Shipify's did. None when
 * GitHub can't say: the reply then says the run stopped, as before.
 */
function failedStep(): string | undefined {
  const { GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt, GITHUB_JOB: job } = process.env;
  if (!id || !job) return undefined;
  const r = ghRun(
    ["api", `repos/${platformRepo()}/actions/runs/${id}/attempts/${attempt || "1"}/jobs`],
    { token: process.env.SHIPIFY_ISSUES_TOKEN || undefined, timeoutMs: 20_000 },
  );
  if (r.code) return undefined;
  try {
    const { jobs } = JSON.parse(r.stdout) as {
      jobs?: { name?: string; steps?: { name?: string; conclusion?: string | null }[] }[];
    };
    return jobs?.find((j) => j.name === job)?.steps?.find((st) => st.conclusion === "failure")
      ?.name;
  } catch {
    return undefined;
  }
}

/**
 * A step as task.yml runs it. One that breaks leaves its problem for this run only, so `run failed`
 * says it rather than "the run stopped": a known problem with its own fix, anything else named
 * with its step.
 */
export async function runStep(step: Step, n: number): Promise<Result> {
  try {
    return await STEPS[step](n);
  } catch (e) {
    const run = thisRun();
    const known = asProblem(e);
    if (run)
      save(n, "broke", {
        run,
        problem:
          known.code !== "unexpected"
            ? known
            : problem("step-failed", { step, error: errorLine(e) }),
      });
    throw e;
  }
}

/**
 * A run that broke before it could answer, or whose answer GitHub refused: one failed reply, with
 * the problem, written on the task as it is now.
 */
export async function runFailed(n: number, e?: unknown): Promise<Result> {
  // The task as it is now: never a plan's state, which an apply after it (or an earlier run's,
  // which the workspace keeps) may have moved on from.
  const { s } = snapshot(n, triggerFromEnv());
  // Never on what isn't a task: a PR, someone else's issue, the status issue.
  if (!s.isTask || s.issue.isPr || s.issue.author === "other")
    return { command: "run failed", status: "skipped", summary: `task #${n}: not a task` };
  // What broke in this run, as runStep left it.
  const broke = load<{ run: string; problem: Problem }>(n, "broke");
  const run = thisRun();
  const step = !e && broke?.run !== run ? failedStep() : undefined;
  const p =
    !e && run && broke?.run === run
      ? { ...broke.problem, where: s.run.url }
      : step
        ? problem(
            "step-failed",
            { step: `“${step}”`, error: "before Shipify could answer (the run's log says why)" },
            s.run.url ? { where: s.run.url } : {},
          )
        : asProblem(e ?? new Error("the run stopped before it could answer"), s.run.url);
  const st: TaskState = {
    ...s.state,
    working: undefined,
    phase: "failed",
    failed: { at: new Date().toISOString(), problem: p },
  };
  const writes: Write[] = [
    {
      w: "reply",
      kind: "failed",
      state: "Failed",
      text: renderProblem(p),
      step: "failed",
      problem: p,
      occasion: s.run.id,
    },
  ];
  await apply(s, st, writes, { ...outward(), tokens: {} });
  return { command: "run failed", status: "succeeded", summary: `task #${n}: failure reported` };
}

/** What a run needs minted for its writes: one repo to write, an act key, shipify for files. */
export function needsOf(writes: Write[], st: TaskState): Decided["needs"] {
  const needs: Decided["needs"] = {};
  for (const w of writes) {
    if (w.w === "push" || w.w === "preview") needs.repo = w.repo;
    if (w.w === "calls") needs.act = w.calls[0]?.tool;
  }
  if (!needs.repo && st.project && writes.some((w) => w.w === "preview")) needs.repo = st.project;
  return needs;
}
