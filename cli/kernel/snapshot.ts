// A task, read once (ADR 0031): its issue, its comments with who really wrote each, its status,
// and what decide needs beside them (a deploy's state, the tools' act calls).
// The task step reads the record (ADR 0045) and names the task's account, so plan's tokens are
// minted for it; plan carries on from that read, reading each repo with its own account's key.
// This is the run's only read of the task; decide works from it with no GitHub.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forms, rec, runUrl, timeZone, workspace } from "../commands/task/context.ts";
import {
  closingPr,
  deployState,
  errandState,
  GIVE_UP_MS,
  mergedDeploy,
  mergedPr,
  productionUrl,
  releaseState,
} from "../commands/task/deploys.ts";
import {
  namesPick,
  pickedLine,
  pickerAsked,
  readFrom,
  SUB_TASK_LABEL,
  withoutLine,
} from "../contracts/index.ts";
import { parseUse, useChoices, useCommand } from "../lib/agents.ts";
import { PLATFORM_ROOT } from "../lib/config.ts";
import { ghRun, platformRepo, RECORD_WRITER, repoOfPr } from "../lib/github.ts";
import { accountList, platformAccount, taskAccount, yourAccounts } from "../lib/accounts.ts";
import { maskSecrets } from "../contracts/index.ts";
import type { RecordComment, RecordIssue } from "../lib/plugins/record.ts";
import { type RepoRef, repoFor, reposOnGitHub } from "../lib/projects-on-github.ts";
import { RECIPE_LABEL, recipeFile, recipeOf } from "../lib/recipes.ts";
import { loadRegistry } from "../lib/registry.ts";
import { isStatusIssue } from "../lib/status-issue.ts";
import {
  droppedBy,
  findStatus,
  looksAt,
  nextBranch,
  PLATFORM,
  parseTask,
  repeatForm,
  type TaskState,
  taskForm,
} from "../lib/task.ts";
import { loadTools } from "../lib/tools.ts";
import { defaultAgent, executors, taskChoice } from "./agent.ts";
import { type Context, type ToolAct, yourWords } from "./decide.ts";
import { instantAnswer } from "./instant.ts";
import { hash8 } from "./keys.ts";
import type { Author, Said, Snapshot, Trigger } from "./types.ts";

/** The door App's login on GitHub (`<slug>[bot]`): its comments are your words through a chat. */
export const doorLogin = () => {
  const slug = process.env.SHIPIFY_DOOR_SLUG;
  return slug ? `${slug}[bot]` : undefined;
};

/** Words that start by naming this task (`#12 close`, as a chat carries a task on): the words alone. */
export const withoutTaskRef = (text: string, n: number) =>
  text.replace(new RegExp(`^\\s*#${n}(?!\\d)[\\s:,.-]*`), "");

/** Your login: with none set, nothing runs (fails closed). */
const ownerLogin = () => process.env.SHIPIFY_OWNER || undefined;

const unedited = (c: { created_at?: string; updated_at?: string }) =>
  !c.updated_at || !c.created_at || Date.parse(c.updated_at) - Date.parse(c.created_at) < 2_000;

/** Who wrote a comment or an issue, from the record's author and, for the door, its `from` line. */
function authorOf(
  login: string,
  body: string | null | undefined,
  never: boolean,
): { author: Author; from?: ReturnType<typeof readFrom> } {
  const owner = ownerLogin();
  if (owner && login === owner) return { author: "owner" };
  if (login === RECORD_WRITER) return { author: "run" };
  const door = doorLogin();
  if (door && login === door && never) {
    const from = readFrom(body);
    if (from) return { author: "door", from };
  }
  return { author: "other" };
}

/** A task as GitHub records it: its issue, its comments, and its status, as the task step reads it. */
export interface TaskRecord {
  issue: RecordIssue;
  comments: RecordComment[];
  state: TaskState;
  statusId?: number;
}

/** The task step's saved read (ADR 0045): the record, once. The status comment counts only when a run
 * wrote it and no one else edited it since. */
export function readRecord(n: number): TaskRecord {
  const issue = rec().issue(n);
  const comments = rec().comments(n);
  const found = findStatus(comments);
  if (found.comment) {
    const who = rec().commentWriters(found.comment);
    if (who.editor && who.editor !== RECORD_WRITER) {
      process.stderr.write(
        `  … the status comment was edited by ${who.editor}: starting from the task\n`,
      );
      return { issue, comments, state: findStatus([]).state };
    }
  }
  return {
    issue,
    comments,
    state: found.state,
    ...(found.comment ? { statusId: found.comment.id } : {}),
  };
}

/** The task step's read, as its file saved it: when it was read (`at`, ADR 0051 B2 — apply reads
 * only the comments from there on), with this run's id to say it's this attempt's. */
export function taskReadOf(
  n: number,
): { run?: string; at?: string; record: TaskRecord } | undefined {
  const file = join(workspace(), ".tasks", String(n), "task.json");
  if (!existsSync(file)) return undefined;
  const saved = JSON.parse(readFileSync(file, "utf8")) as {
    run?: string;
    at?: string;
    record: TaskRecord;
  };
  return saved.record ? saved : undefined;
}

/** A task's body as written (the door's line taken off), and who wrote it. */
function bodyOf(issue: RecordIssue) {
  const body = issue.body ?? "";
  const ia = authorOf(issue.user.login, body, true);
  return { words: ia.author === "door" ? withoutLine(body) : body, ia };
}

/** A task's title and words as a fingerprint (its snapshot's `bodyHash`): an edit changes it. */
export const textHash = (issue: RecordIssue) => hash8(`${issue.title}\n${bodyOf(issue).words}`);

/** A record's words: what was said on it, and its body as written. */
function wordsOf(n: number, r: TaskRecord) {
  return { said: saidOf(n, r.comments, r.statusId), ...bodyOf(r.issue) };
}

/**
 * The account a task works on besides Shipify's own (ADR 0045), from its record alone: what the
 * task step says, so the token minted before plan is for the account plan reads. None: Shipify's
 * own.
 */
export function recordAccount(n: number, r: TaskRecord): string | undefined {
  const { said, words } = wordsOf(n, r);
  const parsed = parseTask(r.issue.title, words, forms());
  return taskAccount({
    project: r.state.project,
    work: r.state.pending.work?.project,
    // A new project plans in Shipify: Shipify's own account, whatever its words look at.
    titled:
      parsed.kind === "app" || parsed.kind === "op"
        ? parsed.project
        : parsed.kind === "new"
          ? PLATFORM
          : undefined,
    looks: [
      ...new Set(
        yourWords({ issue: { title: r.issue.title, body: words }, said }).flatMap(looksAt),
      ),
    ],
  });
}

/**
 * The read token for a repo (ADR 0045): the repos App's for one on the task's other account (the
 * token minted for it before plan), else the bot's.
 */
export function readTokenFor(repo: string | undefined, account?: string): string | undefined {
  const owner = repo?.split("/")[0]?.toLowerCase();
  return account && owner === account
    ? process.env.SHIPIFY_ACCOUNT_TOKEN || undefined
    : process.env.SHIPIFY_READ_TOKEN || undefined;
}

/**
 * The task as one read of GitHub. `record`: the task step's read of it, carried on from (a step
 * that has none reads it now). `look`: plan's own, which also looks the task's outside repos up
 * (ADR 0044); the other steps' snapshots don't need them.
 */
export function snapshot(
  n: number,
  trigger: Trigger,
  opts: { look?: boolean; record?: TaskRecord } = {},
): { s: Snapshot; ctx: Context } {
  const r = opts.record ?? readRecord(n);
  const { issue, state, statusId } = r;
  const owner = ownerLogin();
  const statusIssue = isStatusIssue(issue);
  const labels = issue.labels.map((l) => l.name);
  const account = recordAccount(n, r);

  // Each PR the task still thinks open, read again: a merge or a close is seen (`go`, `preview`,
  // `start over` and repeats act on what's true). Each with its own account's key.
  let merged = false;
  for (const url of state.prs ?? []) {
    const info = state.prInfo?.[url];
    if (info?.state !== "open") continue;
    const now = releaseState(url, readTokenFor(repoOfPr(url), account)).state;
    if (now === "merged" || now === "closed") info.state = now;
    merged ||= now === "merged";
  }
  // A merge ends its branch: the task's next work starts a new one from the default branch, so its
  // PR holds only the new commits (a repo may keep merged branches, and a squash leaves them off).
  const open = (state.prs ?? []).some((u) => state.prInfo?.[u]?.state === "open");
  if (merged && state.branch && !open) state.branch = nextBranch(state.branch);

  const { said, words, ia } = wordsOf(n, r);
  const all = forms();
  const read = taskForm(words, all);
  const rf = repeatForm(read);
  // The projects and repos a task can name and its agent can read: this machine's registry (a PC:
  // its projects), else GitHub's (a box keeps none: your projects and your other repos).
  const repos = ((): RepoRef[] => {
    try {
      const local = loadRegistry().projects.map((p) => p.id);
      if (local.length)
        return local.map((id) => ({
          name: id,
          repo: repoFor(id),
          sizeKB: 0,
          project: true,
          branch: "main",
        }));
    } catch {}
    try {
      return reposOnGitHub(process.env.SHIPIFY_READ_TOKEN || undefined);
    } catch {
      return [];
    }
  })();
  // The task's other account (ADR 0045): its repos, by owner/name, when the repos App reached it,
  // and only on the account you added (its pinned id); else why not, in GitHub's words.
  const accountToken = account ? process.env.SHIPIFY_ACCOUNT_TOKEN || undefined : undefined;
  let reached = false;
  let why: string | undefined = account && !accountToken ? "no-token" : undefined;
  if (account && accountToken)
    try {
      const theirs = reposOnGitHub(accountToken, account);
      const pinned = accountList().find((a) => a.login === account)?.id;
      const other = theirs.find((r) => pinned && r.ownerId && r.ownerId !== pinned);
      if (other)
        why = `\`${account}\` is another account now (GitHub's id for it changed): check it's still yours, then add it again (pnpm ship bot repos ${account} --remove --yes, then pnpm ship bot repos ${account} --yes)`;
      else {
        repos.push(...theirs);
        reached = true;
      }
    } catch (e) {
      why = maskSecrets(
        String((e as Error).message ?? e)
          .trim()
          .split("\n")
          .pop() ?? "",
      ).slice(0, 200);
    }
  const projects = repos.filter((r) => r.project).map((r) => r.name);

  const s: Snapshot = {
    n,
    issue: {
      title: issue.title,
      body: words,
      state: issue.state,
      stateReason: issue.state_reason,
      closedAt: issue.closed_at,
      labels,
      author: ia.author,
      ...(ia.from ? { from: ia.from } : {}),
      isPr: Boolean(issue.pull_request),
    },
    said,
    state,
    ...(statusId ? { statusId } : {}),
    trigger,
    now: new Date().toISOString(),
    run: {
      id: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
      ...(runUrl() ? { url: runUrl() } : {}),
    },
    parsed: parseTask(issue.title, words, all),
    ...(read ? { form: read } : {}),
    ...(rf ? { repeatForm: rf } : {}),
    ...(firstUseOf(read, words) ? { firstUse: firstUseOf(read, words) } : {}),
    bodyHash: textHash(issue),
    projects,
    repos,
    ...(account ? { account: { login: account, reached, ...(why ? { why } : {}) } } : {}),
    accounts: {
      own: platformAccount(),
      listed: yourAccounts(),
      ...(process.env.SHIPIFY_REPOS_SLUG ? { app: process.env.SHIPIFY_REPOS_SLUG } : {}),
    },
    isTask: Boolean(owner) && !statusIssue && !labels.includes("notebook"),
  };
  const looked = opts.look ? lookedUp(s, process.env.SHIPIFY_READ_TOKEN || undefined) : undefined;
  if (looked) s.looked = looked;
  // A split task's family (ADR 0066): one read by plan, only for a part or a task with parts.
  if (opts.look && (labels.includes(SUB_TASK_LABEL) || (issue.sub_issues_summary?.total ?? 0) > 0))
    try {
      const family = rec().family(n);
      if (family) s.family = family;
    } catch (e) {
      process.stderr.write(`  … its sub-tasks couldn't be read: ${(e as Error).message}\n`);
    }
  return { s, ctx: context(s) };
}

/**
 * What GitHub says of each `owner/name` the task's words look at that isn't yours (ADR 0044): one
 * call each, with plan's read key (any App reads a public repo). So a word that's a file's path
 * (`look at src/App.tsx`) is only a word, and anyone else's repo is read under its own name, its
 * size known before its clone. None when the words look at nothing of the kind.
 */
export function lookedUp(
  s: Pick<Snapshot, "issue" | "said" | "repos"> & Partial<Pick<Snapshot, "parsed">>,
  token?: string,
): Snapshot["looked"] {
  const out: NonNullable<Snapshot["looked"]> = {};
  // Your accounts' repos are never looked up as someone else's (ADR 0045): the repos App reads them.
  const listed = yourAccounts();
  // A title's owner/name too (ADR 0045): a repo GitHub has, on an account you haven't added, is
  // told how to add; one it hasn't (`CI/CD: …`) is only words.
  const titled =
    s.parsed &&
    (s.parsed.kind === "app" || s.parsed.kind === "op") &&
    s.parsed.project?.includes("/")
      ? [s.parsed.project]
      : [];
  for (const ref of new Set([...yourWords(s).flatMap(looksAt), ...titled])) {
    const lower = ref.toLowerCase();
    if (
      !ref.includes("/") ||
      out[lower] ||
      s.repos.some((r) => r.repo.toLowerCase() === lower) ||
      listed.includes(lower.split("/")[0] ?? "")
    )
      continue;
    const r = ghRun(["api", `repos/${ref}`, "--jq", "[.full_name, .size, .private] | @tsv"], {
      token,
      timeoutMs: 30_000,
    });
    if (r.code) {
      out[lower] = { status: Number(/HTTP (\d{3})/.exec(r.stderr)?.[1] ?? 0) };
      continue;
    }
    const [repo, size, hidden] = r.stdout.trim().split("\t");
    // Private, yet not among your repos: another account's (or one of yours archived), unread.
    out[lower] = hidden === "true" || !repo ? { status: 404 } : { repo, sizeKB: Number(size) || 0 };
  }
  return Object.keys(out).length ? out : undefined;
}

/** A task's comments as what was said, each with who really wrote it; its status comment left out. */
export function saidOf(n: number, comments: RecordComment[], statusId?: number): Said[] {
  return comments
    .filter((c) => c.id !== statusId)
    .map((c) => {
      const never = unedited(c);
      const a = authorOf(c.user.login, c.body, never);
      return {
        id: c.id,
        author: a.author,
        text: withoutTaskRef(withoutLine(c.body), n),
        at: c.created_at,
        edited: !never,
        channel: a.from ? a.from.channel : "github",
        ...(a.from ? { from: a.from } : {}),
      };
    });
}

/** Your words written on a task since a time: one read, of only those (a run's `stop`, its
 * catch-up), given up after 20 seconds, since it's made while the agent works. */
export const saidSince = (n: number, since: string): Said[] =>
  saidOf(n, rec({ timeoutMs: 20_000 }).comments(n, since));

/** The words a task starts with for its model: its form's Model field (Auto is none), else a line of
 * its text that is a `use` command. */
function firstUseOf(read: ReturnType<typeof taskForm>, body: string): string | undefined {
  if (read) {
    // As a `use` line says it, with or without the word `use`; empty or Auto is Auto.
    const model = typeof read.answers.model === "string" ? read.answers.model : "";
    const words = model
      .trim()
      .replace(/^use\s+/i, "")
      .toLowerCase();
    return words && words !== "auto" ? words : undefined;
  }
  // The line the door chose, chosen the same way (a word for the agent never hides the pick).
  const choice = taskChoice(findStatus([]).state);
  return pickedLine(body, executors(), choice, defaultAgent());
}

/** What decide needs beside the snapshot, read once. */
export function context(s: Snapshot): Context {
  const repo = platformRepo();
  const ctx: Context = {
    tools: toolActs(),
    use: (text, current) => {
      const words = useCommand(text);
      const all = executors();
      const now = current ?? taskChoice(s.state);
      // `/use` alone: the task's pick and what a `use` takes (a chat's buttons, as words).
      if (pickerAsked(text))
        return {
          reply: `This task uses ${current?.label ?? "Auto"}. A \`use\` takes ${useChoices(all, now.agent)}.`,
          asked: true,
        };
      if (words === undefined) return undefined;
      const next = parseUse(words, all, now, defaultAgent());
      return next
        ? { use: next, reply: `From the next run: ${next.label}.` }
        : {
            reply: `“use ${words}” names no pick I can use, so the choice stays ${current?.label ?? "Auto"}. A \`use\` takes ${useChoices(all, now.agent)}.`,
            ...(namesPick(words, all) ? { tried: true } : {}),
          };
    },
    planMerged: (id) => existsSync(join(PLATFORM_ROOT, "plans", `${id}.plan.md`)),
    timeZone: timeZone(),
    taskUrl: `https://github.com/${repo}/issues/${s.n}`,
    operateForm: `https://github.com/${repo}/issues/new?template=7-operate.yml`,
    instant: (name, rest) => instantAnswer(name, Date.parse(s.now), rest),
  };
  // A recipe's task: its file as merged on main, in this run's checkout (ADR 0032).
  const recipe = s.issue.labels.includes(RECIPE_LABEL.name) ? recipeOf(s.issue.title) : undefined;
  if (recipe) ctx.recipe = { name: recipe, read: recipeFile(PLATFORM_ROOT, recipe) };
  const token = process.env.SHIPIFY_READ_TOKEN || undefined;
  // Closed by its merge: the deploy to follow, or "Merged". Not a close the task made itself (done).
  // Read by whichever run comes first after it (ADR 0040: the close's own run may be replaced).
  const closed =
    s.issue.state === "closed" &&
    !droppedBy(s.issue.stateReason) &&
    !s.state.deploy &&
    s.state.phase !== "done" &&
    s.state.phase !== "dropped";
  const found = (st: TaskState) => {
    const merged = mergedDeploy(st, token);
    if (merged) ctx.merged = merged;
    else {
      const pr = mergedPr(st, (url) => readTokenFor(repoOfPr(url), s.account?.login));
      if (pr) ctx.mergedPr = pr;
    }
    return Boolean(ctx.merged || ctx.mergedPr);
  };
  if (closed && !found(s.state)) {
    // A PR opened outside a run closed it: GitHub's record names it, and its repo is the project.
    const pr = closingPr(s.n, token);
    if (pr && !s.state.prs.includes(pr)) {
      const repo = repoOfPr(pr)?.toLowerCase();
      const project = s.repos.find((r) => r.repo.toLowerCase() === repo)?.name;
      // Its own project, whatever the task named: the PR is what landed.
      found({ ...s.state, prs: [pr], ...(project ? { project } : {}) });
    }
  }
  const rel = s.state.pending.release;
  if (rel) {
    const r = releaseState(rel.pr, token);
    const url =
      r.state === "merged" && s.state.project ? productionUrl(s.state.project, token) : undefined;
    ctx.release = { ...r, ...(url ? { url } : {}) };
  }
  // An errand whose look has come (ADR 0054): its PR or branch read now, so its run tells what's
  // true now, whatever the due run saw.
  const on = s.state.repeat?.on;
  if (on && Date.parse(s.state.repeat?.next ?? "") <= Date.parse(s.now))
    ctx.errand = errandState(on, token);
  const d = s.state.deploy;
  if (d) {
    const r = deployState(d, token);
    const late = Date.now() - Date.parse(d.since) > GIVE_UP_MS;
    ctx.deploy =
      r.state === "up"
        ? {
            state: "live",
            ...(d.url ? { url: d.url } : {}),
            ...(d.staging ? { staging: true } : {}),
          }
        : r.state === "failed"
          ? { state: "failed", ...(r.run ? { run: r.run } : {}) }
          : late || r.state === "unreadable"
            ? { state: "gone" }
            : { state: "waiting" };
  }
  return ctx;
}

/** Each tool's act calls and pre-approved forms (tools.json), as decide checks them. */
export function toolActs(): Record<string, ToolAct> {
  const out: Record<string, ToolAct> = {};
  for (const [name, t] of Object.entries(loadTools())) {
    const act = (t as { act?: string[] }).act ?? [];
    const schemas =
      (
        t as {
          args?: Record<
            string,
            {
              required?: string[];
              properties?: Record<string, unknown>;
              warn?: Record<string, string>;
              files?: string;
            }
          >;
        }
      ).args ?? {};
    const pre = (t as { pre?: ToolAct["pre"] }).pre ?? [];
    const warn = Object.fromEntries(
      Object.entries(schemas).flatMap(([c, sc]) => (sc.warn ? [[c, sc.warn]] : [])),
    );
    const files = Object.fromEntries(
      Object.entries(schemas).flatMap(([c, sc]) => (sc.files ? [[c, sc.files]] : [])),
    );
    out[name] = {
      ...(Object.keys(warn).length ? { warn } : {}),
      ...(Object.keys(files).length ? { files } : {}),
      calls: Object.fromEntries(
        act.map((c) => [
          c,
          (args: Record<string, unknown>) => {
            const sc = schemas[c];
            if (!sc) return true;
            if ((sc.required ?? []).some((k) => !(k in args))) return false;
            return !sc.properties || Object.keys(args).every((k) => k in (sc.properties ?? {}));
          },
        ]),
      ),
      pre,
    };
  }
  return out;
}
