// Apply (ADR 0031): the one place a run changes anything. It makes decide's writes in order, each
// safe to repeat (a reply's key, a journal line before an outside change), saves the status last,
// and tells the door of each new reply. It never runs code the agent wrote: a PR is pushed from the
// agent's bundle, fetched into apply's own clone with git's hooks and monitors off.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { queue, rec, thisRun, timeZone } from "../commands/task/context.ts";
import { publishedDeploy } from "../commands/task/deploys.ts";
import { publishMade } from "../commands/task/files.ts";
import { Status, type StatusIssue } from "../commands/task/issue.ts";
import { forget, remember } from "../commands/task/notebook.ts";
import {
  asProblem,
  errorLine,
  type Link,
  maskSecrets,
  type Problem,
  problem,
  readReply,
  renderProblem,
  replyLine,
  type ToolResult,
} from "../contracts/index.ts";
import { accountOf } from "../lib/accounts.ts";
import { modelLabel } from "../lib/agents.ts";
import { cloneArgs, gitEnv, githubUrl } from "../lib/clones.ts";
import { gh, ghRun, RECORD_WRITER } from "../lib/github.ts";
import { madeWith, taskLine } from "../lib/links.ts";
import type { RecordComment, RecordWrite } from "../lib/plugins/record.ts";
import { repoFor } from "../lib/projects-on-github.ts";
import { type RunDetails, recordRun, renderRunDetails } from "../lib/runs.ts";
import { secretFindings } from "../lib/secret-scan.ts";
import { dropRepeat, tryStatusIssue, upsertRepeat } from "../lib/status-issue.ts";
import { findStatus, inertImages, MAX_REPLY, safeMarkdown, type TaskState } from "../lib/task.ts";
import { cursorOf } from "./decide.ts";
import { replyKey } from "./keys.ts";
import { makeCalls } from "./mcp-client.ts";
import { saidAs } from "./result.ts";
import { type Person, replyTo, scheduledReply } from "./route.ts";
import { taskReadOf } from "./snapshot.ts";
import type { Snapshot, Write } from "./types.ts";
import { workflowsMismatch } from "./workflows.ts";

export interface ApplyEnv {
  /** Your default channels and your ids on them, for replies that need you. */
  defaults: string[];
  owner?: Person;
  /** The run's details, when an agent or a check ran. */
  details?: RunDetails;
  /** The agent's out folder: its bundle, its files. */
  out?: string;
  /** Write tokens minted after think: the project's, and shipify's for files. */
  tokens: { repo?: string; files?: string };
  /** Tell the door of a new reply (POST /door/replied with the run's OIDC token). */
  tellDoor?: (task: number, comment: number, files: string[]) => Promise<void>;
  /**
   * The task's comments as a stay's turn read them a moment ago (ADR 0057): no one but this run
   * replies on the task, so they hold every reply written, and apply reads them no more.
   */
  comments?: RecordComment[];
}

export interface Applied {
  replies: number[];
  problems: Problem[];
  /** Every problem reached a reply on the task: none left that only the run's log says. */
  told: boolean;
}

/** Makes the writes, then tells the door, then saves the status. */
export async function apply(
  s: Snapshot,
  st: TaskState,
  writes: Write[],
  env: ApplyEnv,
): Promise<Applied> {
  // One read of what's new since the task step's read (ADR 0051 B2): its saved record keeps every
  // reply key it saw, and plan saved the status comment's id, so the issue needs no second read.
  // A task read that wasn't this run's own (a failure path with no task step) reads them all.
  const task = taskReadOf(s.n);
  const own = task && task.run === thisRun() ? task : undefined;
  // A comment the read held and the new one edited since is there twice: the newer copy counts.
  const raw = env.comments ?? [
    ...new Map(
      [...(own?.record.comments ?? []), ...rec().comments(s.n, own?.at)].map((c) => [c.id, c]),
    ).values(),
  ];
  const issue: StatusIssue = { number: s.n, labels: s.issue.labels.map((name) => ({ name })) };
  const status = new Status(issue, findStatus(raw).comment?.id ?? s.statusId, st);
  const written = new Set(
    raw.filter((c) => c.user.login === RECORD_WRITER).flatMap((c) => readReply(c.body)?.key ?? []),
  );
  const outcomes: string[] = [];
  const problems: Problem[] = [];
  let pushFailed = false;
  const replies: number[] = [];
  const asked = askedFrom(s);
  const links: Link[] = [];
  /**
   * The door told of a reply as soon as it's written (ADR 0057), before the status is saved, so a
   * status GitHub refuses never keeps a written reply from your chat; one it wasn't told of gets the
   * watch's notice.
   */
  const tellDoor = async (id: number, made: string[]) =>
    env.tellDoor?.(s.n, id, made).catch((e) => {
      process.stderr.write(
        `${JSON.stringify({ level: "warn", event: "door.out.failed", task: s.n, comment: id, what: maskSecrets(errorLine(e)) })}\n`,
      );
    });
  /** A write GitHub (or anything) refused, as its problem; in the run's log too, so its cause shows
   * on GitHub's run page, not only in a reply. */
  const failed = (write: string, e: unknown) => {
    const p = asProblem(e, s.run.url);
    process.stderr.write(
      `${JSON.stringify({ level: "error", event: "apply.write", task: s.n, write, code: p.code, what: maskSecrets(p.what) })}\n`,
    );
    return p;
  };

  // A journal line before each outside change; one started and not finished is said, not redone.
  /** `quiet`: a write whose reply never names it (a question's kept commits, ADR 0041). */
  const journal = async (
    key: string,
    what: string,
    act: () => Promise<void> | void,
    quiet = false,
  ) => {
    if (!st.journal) st.journal = [];
    const j = st.journal;
    const seen = j.find((x) => x.key === key);
    if (seen?.done) return;
    if (seen) {
      if (!quiet)
        outcomes.push(
          `(${what}: started by an earlier run and not finished; check it, then \`continue\`.)`,
        );
      return;
    }
    j.push({ key, what, at: s.now });
    if (j.length > 40) j.splice(0, j.length - 40);
    await status.save(st.phase, {});
    try {
      await act();
    } catch (e) {
      // It failed and said so: nothing half-done to check, so a retry may run it again. Only a run
      // that died inside it leaves the line, for you to check and then `continue`.
      st.journal = (st.journal ?? []).filter((x) => x.key !== key);
      throw e;
    }
    const line = j.find((x) => x.key === key);
    if (line) line.done = true;
  };

  for (const w of writes) {
    // A reply's words, once it's about to be written: kept for the next reply if GitHub refuses it.
    let unsaid = "";
    try {
      switch (w.w) {
        case "labels":
          // The adds and removes go together (ADR 0051 B3): independent, one call each.
          await rec().together([
            ...(w.add ?? []).map((name): RecordWrite => ({ w: "labels", n: s.n, names: [name] })),
            ...(w.remove ?? []).map((name): RecordWrite => ({ w: "unlabel", n: s.n, name })),
          ]);
          break;
        case "reopen":
          rec().updateIssue(s.n, { state: "open" });
          break;
        case "close":
          rec().updateIssue(s.n, {
            state: "closed",
            ...(w.reason ? { state_reason: w.reason } : {}),
          });
          break;
        case "react":
          await rec().together([{ w: "react", on: { comment: w.comment }, content: w.content }]);
          break;
        case "note":
          outcomes.push(
            ...remember(
              [{ topic: w.topic, text: w.line }],
              true,
              s.repos.map((r) => r.name),
            ),
          );
          break;
        case "forget":
          outcomes.push(...forget(w.words));
          break;
        case "calls":
          await journal(
            `calls:${w.fingerprint}`,
            `the ${w.calls.length} approved call(s)`,
            async () => {
              const done = await makeCalls(w.calls);
              outcomes.push(
                ...done.map(
                  (r: ToolResult, i: number) =>
                    `${r.ok ? "✓" : "✗"} \`${w.calls[i]?.tool}.${w.calls[i]?.name}\`: ${r.text}`,
                ),
              );
            },
          );
          break;
        case "dispatch":
          await journal(
            `dispatch:${w.job}:${s.state.seen}:${s.run.id}`,
            `starting the ${w.job} job`,
            () => {
              const r = queue().dispatch("task.yml", { issue: String(s.n), job: w.job });
              if (!r.ok) throw Object.assign(new Error(r.error), { problem: undefined });
            },
          );
          break;
        case "coming-up":
          tryStatusIssue(
            (x) => {
              if (st.repeat && !st.repeat.paused)
                upsertRepeat(x, {
                  n: s.n,
                  title: s.issue.title,
                  next: st.repeat.next,
                  every: st.repeat.every,
                });
              else dropRepeat(x, s.n);
              return undefined;
            },
            { timeZone: timeZone() },
          );
          break;
        case "preview": {
          const token = env.tokens.repo;
          if (token)
            await journal(`preview:${w.pr}:${s.run.id}`, `a preview of ${w.pr}`, () => {
              previewOn(repoFor(w.repo, s.repos), w.pr, token);
            });
          break;
        }
        case "push":
          await journal(
            `push:${w.repo}:${w.branch}:${s.run.id}`,
            `pushing ${w.branch}`,
            () => {
              const pushed = pushFromBundle(s, st, w, env);
              if (pushed.url) links.push(["PR", pushed.url]);
              if (pushed.signedOnly)
                outcomes.push(
                  `${pushed.signedOnly} takes signed commits only, and Shipify's are pushed unsigned, so GitHub won't merge this PR yet, squashed or not: merge it with a bypass if you have one, or sign its commits again on your PC.`,
                );
              // Kept, not opened: the next run starts from these commits (think's clone).
              if (w.open === false) {
                if (pushed.sha && !w.quiet)
                  outcomes.push(
                    `Its commits are kept on \`${w.branch}\`, so \`continue\` carries on from them.`,
                  );
                return;
              }
              // A preview asked for: the label after the PR, then an empty commit, so the pipeline's
              // next run carries the label (the opened run's payload never does).
              if (pushed.url && w.preview && env.tokens.repo)
                try {
                  previewOn(repoFor(w.repo, s.repos), pushed.url, env.tokens.repo);
                } catch {
                  outcomes.push(PREVIEW_UNSET);
                }
              // A new project's first deploy is followed: your merge of its plan started it. A PR's
              // checks never are (ADR 0046): you look at the PR, and ask.
              if (w.kind === "publish") {
                const deploy = publishedDeploy(w.repo, env.tokens.repo);
                if (deploy) follow(s, st, { deploy });
              }
            },
            w.open === false && w.quiet === true,
          );
          break;
        case "reply": {
          // A push refused in this run: its reply can't ask you to merge a PR that wasn't opened.
          // It becomes one Failed reply: the problem and its fix first, the agent's words below in sight.
          const r = pushFailed ? afterRefusedPush(w) : w;
          // A run that read outside content: every field's images made inert (ADR 0044).
          const inert = (t: string) => (w.outside ? inertImages(t) : t);
          const question = r.question ? inert(r.question) : undefined;
          // A choice with an image in it is left out: made inert it'd no longer be a short answer.
          const choices = r.choices?.filter((c) => inert(c) === c);
          const body = inert(
            pushFailed ? [...outcomes, r.text].filter(Boolean).join("\n\n") : textOf(r, outcomes),
          );
          outcomes.length = 0;
          const key = replyKey({
            task: s.n,
            cursor: st.seen,
            body,
            step: r.step,
            occasion: r.occasion,
          });
          if (written.has(key)) break;
          unsaid = body;
          const out =
            r.files?.length && env.out
              ? r.files.map((f) => join(env.out as string, basename(f))).filter(existsSync)
              : [];
          const filesBlock =
            out.length && env.tokens.files
              ? withToken(env.tokens.files, () => publishMade(s.n, out))
              : "";
          const allLinks = [...(r.links ?? []), ...links];
          const to = replyTo({
            kind: r.kind,
            asked,
            defaults: env.defaults,
            owner: env.owner,
            ownTask: s.issue.author === "run",
            scheduled: scheduledReply(r.step, r.occasion),
          });
          const details = env.details ? renderRunDetails(env.details, timeZone()) : "";
          const line = replyLine({
            v: 1,
            kind: r.kind,
            state: r.state,
            title: s.issue.title.slice(0, 256),
            links: allLinks.slice(0, 10),
            ...(env.details ? { brief: brief(env.details), run: runNumbers(env.details) } : {}),
            ...(question ? { question: question.slice(0, 2_000) } : {}),
            ...(question && choices?.length ? { choices } : {}),
            ...(r.list ? { list: r.list } : {}),
            to,
            key,
          });
          let text = safeMarkdown(maskSecrets(body));
          if (text.length > MAX_REPLY)
            text = `${text.slice(0, MAX_REPLY - 200)}\n\n_(cut: the rest was longer than a comment holds)_`;
          const full = [
            line,
            text,
            // Its question, with its short answers when it gave some: every chat reads these words
            // (the web chat shows them as its question box and buttons instead).
            question
              ? `> **Question:** ${question}${choices?.length ? `\n>\n> Answers: ${choices.map((c) => `“${c}”`).join(" · ")}` : ""}`
              : "",
            filesBlock,
            allLinks.map(([l, u]) => `- ${l}: ${u}`).join("\n"),
            details,
          ]
            .filter(Boolean)
            .join("\n\n");
          const id = rec().comment(s.n, full);
          written.add(key);
          replies.push(id);
          st.reply = id;
          // Told at once (ADR 0057): the writes after it never hold your reply back.
          await tellDoor(id, out);
          // The list this reply asks a yes for: only a yes after it counts.
          if (st.pending.list && !st.pending.list.post) st.pending.list.post = id;
          break;
        }
      }
    } catch (e) {
      const p = failed(w.w, e);
      // A question's kept commits (ADR 0041) never change its reply: their push's failure is logged
      // above, and the question stands, as before such commits were kept.
      if (w.w === "push" && w.open === false && w.quiet) continue;
      problems.push(p);
      outcomes.push(renderProblem(p));
      if (unsaid) outcomes.push(`\n${unsaid}`);
      if (w.w === "push") pushFailed = true;
    }
  }
  // Whether every problem reached a reply: nothing left unsaid, or the reply below is written.
  let told = !outcomes.length;
  // Anything left unsaid (a write that failed after the last reply) gets a reply of its own. If
  // GitHub refuses that too, it's logged, and the status is still saved below.
  if (outcomes.length) {
    const body = outcomes.join("\n");
    const key = replyKey({ task: s.n, cursor: st.seen, body, step: "after", occasion: s.run.id });
    if (!written.has(key)) {
      const to = replyTo({
        kind: problems.length ? "failed" : "answer",
        asked,
        defaults: env.defaults,
        owner: env.owner,
        ownTask: s.issue.author === "run",
      });
      try {
        const id = rec().comment(
          s.n,
          [
            replyLine({
              v: 1,
              kind: problems.length ? "failed" : "answer",
              state: problems.length ? "Failed" : "Done",
              title: s.issue.title.slice(0, 256),
              links: [],
              to,
              key,
            }),
            body,
          ].join("\n\n"),
        );
        replies.push(id);
        told = true;
        await tellDoor(id, []);
      } catch (e) {
        problems.push(failed("reply", e));
      }
    } else told = true;
  }
  if (problems.length && st.phase !== "failed") {
    st.phase = "failed";
    st.failed = { at: s.now, problem: problems[0] as Problem };
  }
  if (env.details) recordRun(st, env.details);
  // Only the current cursor's journal is kept.
  st.journal = (st.journal ?? []).filter((j) => !j.done || j.at === s.now);
  st.cursor = cursorOf(s, st);
  // The status last, after everything else has settled (ADR 0051 B3).
  await status.save(st.phase, { summary: summaryOf(writes) });
  return { replies, problems, told };
}

/** A deploy for the watch's due runs to follow: the `deploying` label, and the task's state. */
function follow(s: Snapshot, st: TaskState, f: { deploy: NonNullable<TaskState["deploy"]> }) {
  st.deploy = f.deploy;
  rec().addLabels(s.n, ["deploying"]);
}

/**
 * The chats this run answers: those of your new messages (none for words on GitHub). The task's own
 * chat on its first answer, and when there are no new words (a deploy, a cut-off run): a task you
 * carry on elsewhere is answered there, not where it started.
 */
export function askedFrom(s: Snapshot): string[] {
  const fresh = s.said.filter(
    (c) => (c.author === "owner" || c.author === "door") && c.id > s.state.seen,
  );
  const out = new Set<string>();
  if (s.issue.from && (!s.state.reply || !fresh.length))
    out.add(`${s.issue.from.channel}:${s.issue.from.chat}`);
  for (const c of fresh) if (c.from) out.add(`${c.from.channel}:${c.from.chat}`);
  return [...out];
}

type ReplyWrite = Extract<Write, { w: "reply" }>;

/**
 * A run's reply after its push was refused (a key in the change, a workflow edit): one Failed reply,
 * whose problem and fix come first (apply puts them before it), with the agent's words below, and
 * no question: it can't ask you to merge a PR that wasn't opened.
 */
export function afterRefusedPush(w: ReplyWrite): ReplyWrite {
  const { question: _, ...rest } = w;
  return {
    ...rest,
    kind: "failed",
    state: "Failed",
    text: saidAs(w.text),
  };
}

/** A reply's words: its own, or, when it has none, what the box did (notes noted, calls made). */
const textOf = (w: Extract<Write, { w: "reply" }>, outcomes: string[]) =>
  [w.text, ...outcomes].filter(Boolean).join("\n\n") || "Done.";

const summaryOf = (writes: Write[]) => {
  const r = writes.find((w): w is Extract<Write, { w: "reply" }> => w.w === "reply");
  return r?.text ? r.text.split("\n")[0]?.slice(0, 280) : undefined;
};

/** A run in numbers, on its reply's line, for a chat to add up a task's. */
export function runNumbers(d: RunDetails) {
  const t = d.tokens;
  const tokens = t ? t.input + t.cacheRead + t.cacheWrite + t.output : 0;
  return {
    secs: Math.round(d.secs.total),
    ...(tokens ? { tokens } : {}),
    ...(d.cost?.plan
      ? { plan: true }
      : d.cost?.usd
        ? { usd: Math.round(d.cost.usd * 1e4) / 1e4 }
        : {}),
    ...(d.model ? { model: d.model.slice(0, 100) } : {}),
  };
}

/**
 * A run in one line, for a chat: "Sonnet · 48 s · 3 tool calls", or with what it cost when no plan
 * covers it, "kimi-k3 · 72 s · 11 tool calls · $0.03".
 */
export function brief(d: RunDetails): string {
  const tools = Object.values(d.tools ?? {}).reduce((a, b) => a + b, 0);
  // What it cost, when no plan covers it and the agent knows (a gateway's price, an API key's).
  const usd = d.cost && !d.cost.plan ? d.cost.usd : 0;
  const cost = !usd ? "" : usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`;
  return [
    d.model ? modelLabel(d.model) : d.name,
    `${Math.round(d.secs.total)} s`,
    tools ? `${tools} tool call${tools === 1 ? "" : "s"}` : "",
    cost,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 120);
}

const withToken = <T>(token: string, f: () => T): T => {
  const was = process.env.GH_TOKEN;
  process.env.GH_TOKEN = token;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = was;
  }
};

/** git with the token in its environment (never on the command line) and nothing of the repo's run:
 * clones.ts's environment, built from nothing. */
function git(dir: string, token: string, ...args: string[]) {
  return gitIn(dir, token, undefined, ...args);
}

/** git as above, with this on its stdin. */
function gitIn(dir: string, token: string, input: string | undefined, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...(input === undefined ? {} : { input }),
    env: gitEnv(token),
  });
}

/** Paths as a sparse checkout's patterns: each one anchored and literal, nothing a wildcard. */
export const sparse = (paths: string[]) =>
  `${paths.map((p) => `/${p.replace(/[\\*?[\]!#]/g, "\\$&")}`).join("\n")}\n`;

/**
 * The agent's commits from its bundle into apply's clone, as `target`. The bundle is the one local
 * file git may read here (git counts a bundle as the file transport, which is otherwise off); an
 * empty repo's clone takes them on its unborn main.
 */
export function fetchBundle(dir: string, token: string, bundle: string, target: string) {
  git(
    dir,
    token,
    "-c",
    "protocol.file.allow=always",
    "fetch",
    "--quiet",
    "--update-head-ok",
    bundle,
    `+refs/heads/work:refs/heads/${target}`,
  );
}

/**
 * The agent's commits, pushed from apply's own clone: fetched from its bundle, scanned for secrets,
 * pushed only to the task's own branch (or, for a new project's first push, to an empty repo's
 * main), and the PR opened or updated. Safe to repeat: a run with nothing new still opens the PR for
 * an earlier run's commits on the task's branch. Returns the PR's URL and the branch's sha.
 */
function pushFromBundle(
  s: Snapshot,
  st: TaskState,
  w: Extract<Write, { w: "push" }>,
  env: ApplyEnv,
): { url?: string; sha: string; signedOnly?: string } {
  const token = env.tokens.repo;
  const bundle = env.out ? join(env.out, "work.bundle") : undefined;
  const fresh = Boolean(bundle && existsSync(bundle));
  // Commits to keep (the checks failed): none made this run is nothing to keep.
  if (w.open === false && !fresh) return { sha: "" };
  if (!token || (!fresh && w.kind === "publish")) throw new Error("there were no commits to push");
  if (w.kind !== "publish" && !/^(task|plan)\/\d+[\w./-]*$/.test(w.branch))
    throw new Error(`apply pushes only to a task's own branch, not ${w.branch}`);
  const repo = repoFor(w.repo, s.repos);
  // The branch its PR goes against: the repo's default (ADR 0045), main for a project.
  const base = w.base ?? "main";
  const dir = mkdtempSync(join(tmpdir(), "shipify-apply-"));
  try {
    // History without file contents, that branch only (ADR 0044): a new project's empty repo has
    // none.
    const [, ...clone] = cloneArgs("apply", githubUrl(repo), dir, {
      empty: w.kind === "publish",
      branch: base,
    });
    git(tmpdir(), token, ...clone);
    if (w.kind === "publish" && git(dir, token, "ls-remote", "--heads", "origin").trim())
      throw new Error(`${repo} already has commits: publishing pushes only into an empty repo`);
    // The task's branch as an earlier run pushed it, by name: the bundle's base, and onBranch's.
    if (w.kind !== "publish" && git(dir, token, "ls-remote", "--heads", "origin", w.branch).trim())
      git(
        dir,
        token,
        "fetch",
        "--quiet",
        "origin",
        `+refs/heads/${w.branch}:refs/remotes/origin/${w.branch}`,
      );
    // Nothing new this run: an earlier run's commits on the task's branch (its push went through,
    // its PR didn't) still get their PR. A branch with nothing ahead of main has nothing to open.
    const sha = fresh
      ? pushed(dir, token, bundle as string, w, base)
      : onBranch(dir, token, w.branch, base);
    if (w.kind === "publish" || w.open === false) return { sha };
    const existing = withToken(token, () =>
      gh([
        "pr",
        "list",
        "-R",
        repo,
        "--head",
        w.branch,
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        ".[0].url",
      ]).trim(),
    );
    const body = prBody(s, w, env.details, accountOf(repo) === undefined);
    // Never with a label: a repo without it would refuse the whole PR.
    const url =
      existing ||
      withToken(
        token,
        () =>
          gh([
            "pr",
            "create",
            "-R",
            repo,
            "--base",
            base,
            "--head",
            w.branch,
            "--title",
            maskSecrets(w.title),
            "--body",
            body,
          ])
            .trim()
            .split("\n")
            .pop() ?? "",
      );
    if (url) {
      st.prs = [...new Set([...(st.prs ?? []), url])];
      st.prInfo = {
        ...(st.prInfo ?? {}),
        [url]: {
          kind: w.kind === "part-of" ? (st.plan ? "plan" : "change") : "code",
          state: "open",
        },
      };
    }
    return {
      ...(url ? { url } : {}),
      sha,
      ...(url && signedOnly(repo, base, token) ? { signedOnly: `${repo}'s \`${base}\`` } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Whether a branch's rules ask for signed commits (ADR 0045). Shipify's commits are pushed by git,
 * unsigned, so GitHub won't merge its PR there, even squashed. Read from the branch's rulesets,
 * which the Apps' metadata read reaches; a classic protection rule needs more, and GitHub says that
 * one on the PR itself. False when the rules can't be read.
 */
function signedOnly(repo: string, branch: string, token: string): boolean {
  const r = ghRun(["api", `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`], { token });
  if (r.code) return false;
  try {
    return (JSON.parse(r.stdout) as { type?: string }[]).some(
      (rule) => rule.type === "required_signatures",
    );
  } catch {
    return false;
  }
}

/**
 * This run's commits from the agent's bundle, onto the task's branch (or an empty repo's main):
 * workflow files only as the stack renders them, scanned for keys, pushed. Their sha.
 */
function pushed(
  dir: string,
  token: string,
  bundle: string,
  w: Extract<Write, { w: "push" }>,
  trunk: string,
) {
  const target = w.kind === "publish" ? "main" : w.branch;
  fetchBundle(dir, token, bundle, target);
  // What the PR changes against its base (three dots: from where they meet), never the base's own
  // changes the agent merged in; a new project's first push: every file.
  const base = w.kind === "publish" ? "" : `origin/${trunk}`;
  const changed = (
    base
      ? git(dir, token, "diff", "--name-only", `${base}...${target}`)
      : git(dir, token, "ls-tree", "-r", "--name-only", target)
  )
    .split("\n")
    .filter(Boolean);
  // Only the files the checks read are checked out (ADR 0044): the changed ones, shipify.json and
  // the workflows, so a big repo costs what its change does. A first push has them all already.
  if (base)
    gitIn(
      dir,
      token,
      sparse([...changed, "shipify.json", ".github/workflows/"]),
      "sparse-checkout",
      "set",
      "--no-cone",
      "--stdin",
    );
  git(dir, token, "checkout", "--quiet", target);
  const wrong = workflowsMismatch(dir, changed);
  if (wrong) throw new Error(`the change edits a workflow file, so it wasn't pushed: ${wrong}`);
  // The change's own files (a new project's first push: all of them): what this push adds.
  const found = secretFindings(dir, base ? changed : undefined);
  if (found) {
    const p = problem("secret-in-change", { file: found.join(", ") || "a file it didn't name" });
    throw Object.assign(new Error(p.what), { problem: p });
  }
  git(dir, token, "push", "--quiet", "origin", `refs/heads/${target}:refs/heads/${target}`);
  if (w.kind === "publish" && stagingOf(dir))
    git(dir, token, "push", "--quiet", "origin", `refs/heads/${target}:refs/heads/production`);
  return git(dir, token, "rev-parse", target).trim();
}

/** Whether the project in this checkout has staging (its shipify.json): then it has production too. */
function stagingOf(dir: string): boolean {
  try {
    return (
      (JSON.parse(readFileSync(join(dir, "shipify.json"), "utf8")) as { staging?: boolean })
        .staging === true
    );
  } catch {
    return false;
  }
}

/** The task's branch as an earlier run pushed it, when it holds commits its base doesn't: its sha. */
export function onBranch(dir: string, token: string, branch: string, base = "main"): string {
  let sha = "";
  try {
    sha = git(dir, token, "rev-parse", "--verify", "--quiet", `origin/${branch}`).trim();
  } catch {}
  const ahead = sha
    ? Number(git(dir, token, "rev-list", "--count", `origin/${base}..origin/${branch}`).trim())
    : 0;
  if (!ahead) throw new Error("there were no commits to push");
  return sha;
}

/**
 * A PR's body (ADR 0045): what the agent wrote (the repo's own template filled in, or Shipify's
 * format, as the playbook says), then the core's footer: the task it's for, and what made it,
 * with the run's link only where its readers can open it (Shipify's own account).
 */
export function prBody(
  s: Snapshot,
  w: Extract<Write, { w: "push"; open?: undefined }>,
  details: RunDetails | undefined,
  ownAccount: boolean,
): string {
  const by = details?.name
    ? `${details.name}${details.model ? ` (${modelLabel(details.model)})` : ""}`
    : undefined;
  const footer = [
    taskLine(s.n, w.kind === "part-of"),
    madeWith(by, ownAccount ? s.run.url : undefined),
  ].filter(Boolean);
  // Masked as every reply is: a PR on another account is read by other people too.
  return [maskSecrets(w.body.trim()), footer.length ? `---\n${footer.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

const PREVIEW_UNSET =
  "The PR couldn't get its `preview` label, so no preview runs: add the label on the PR, or say `preview` again.";

/** The `preview` label on a PR, made first when its repo has none: whether it's on. */
export function labelled(repo: string, pr: string, token: string): boolean {
  return withToken(token, () => {
    try {
      gh([
        "label",
        "create",
        "preview",
        "-R",
        repo,
        "--color",
        "1d76db",
        "--description",
        "Shipify: a preview of this PR",
        "--force",
      ]);
    } catch {}
    try {
      gh(["pr", "edit", pr, "-R", repo, "--add-label", "preview"]);
      return true;
    } catch {
      return false;
    }
  });
}

/** A preview for an open PR: its label, then an empty commit so its pipeline runs. Its sha. */
function previewOn(repo: string, pr: string, token: string): string {
  return withToken(token, () => {
    if (!labelled(repo, pr, token)) throw new Error(PREVIEW_UNSET);
    const head = JSON.parse(
      gh(["pr", "view", pr, "-R", repo, "--json", "headRefName,headRefOid"]),
    ) as { headRefName: string; headRefOid: string };
    const tree = JSON.parse(gh(["api", `repos/${repo}/git/commits/${head.headRefOid}`])) as {
      tree: { sha: string };
    };
    const commit = JSON.parse(
      gh([
        "api",
        `repos/${repo}/git/commits`,
        "-f",
        "message=Preview, please",
        "-f",
        `tree=${tree.tree.sha}`,
        "-f",
        `parents[]=${head.headRefOid}`,
      ]),
    ) as { sha: string };
    gh([
      "api",
      "-X",
      "PATCH",
      `repos/${repo}/git/refs/heads/${head.headRefName}`,
      "-f",
      `sha=${commit.sha}`,
    ]);
    return commit.sha;
  });
}
