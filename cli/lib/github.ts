// GitHub, the record plug-in (ADR 0027, docs/plug-ins.md): every call Shipify makes to GitHub goes
// through this file's gh helpers, each with a timeout. githubRecord and githubQueue are the record's
// contract (plugins/record.ts) on GitHub: tasks, comments and labels, and starting runs. Without
// `token`, gh uses GH_TOKEN (the bot's token in a task job) or its own login; with it, that one call
// runs as another identity, such as the workflow's token for the task's issue.

import { PLATFORM_ROOT } from "./config.ts";
import { type RunResult, run } from "./exec.ts";
import { ShipError } from "./output.ts";
import type {
  IssuePatch,
  IssueQuery,
  Queue,
  QueueRun,
  RecordComment,
  RecordIssue,
  RecordLabel,
  TaskRecord,
} from "./plugins/record.ts";

export interface GhOpts {
  token?: string;
  input?: string;
  cwd?: string;
  /** How long one call may take: 3 minutes unless said, so a hung call can't stall a run. */
  timeoutMs?: number;
}

export function ghRun(args: string[], opts: GhOpts = {}): RunResult {
  return run("gh", args, {
    cwd: opts.cwd,
    input: opts.input,
    env: opts.token ? { GH_TOKEN: opts.token } : undefined,
    timeoutMs: opts.timeoutMs ?? 180_000,
  });
}

export function gh(args: string[], opts: GhOpts = {}): string {
  const r = ghRun(args, opts);
  if (r.code !== 0)
    throw new ShipError(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export function ghJson<T>(args: string[], opts: GhOpts = {}): T {
  const out = gh(args, opts).trim();
  return (out ? JSON.parse(out) : null) as T;
}

/**
 * `fn` with GH_TOKEN set to `token` for every gh and git call it makes (git goes through gh), when
 * there is one; the token this process had comes back after.
 */
export function withToken<T>(token: string | undefined, fn: () => T): T {
  if (!token) return fn();
  const had = process.env.GH_TOKEN;
  process.env.GH_TOKEN = token;
  try {
    return fn();
  } finally {
    if (had === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = had;
  }
}

/** The label that asks a PR's pipeline for a preview, made on its repo if it isn't there. */
export function previewLabel(repo: string) {
  ghRun([
    "label",
    "create",
    "preview",
    "-R",
    repo,
    "--color",
    "2f5bd3",
    "--description",
    "Make a preview link for this PR",
    "--force",
  ]);
}

/** Every page of a list endpoint, flattened. */
export function ghPages<T>(path: string, opts: GhOpts = {}): T[] {
  return ghJson<T[][]>(["api", "--paginate", "--slurp", path], opts).flat();
}

let checkoutRepo: string | undefined;

/**
 * Your Shipify repo, `owner/name`: the one tasks live in and boxes register with. A run's is
 * GitHub's own (GITHUB_REPOSITORY, the agent's too); this PC's, the checkout's GitHub remote. Never
 * typed (ADR 0047).
 */
export function platformRepo(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  if (checkoutRepo) return checkoutRepo;
  const url = run("git", ["-C", PLATFORM_ROOT, "remote", "get-url", "origin"]).stdout.trim();
  const m = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url);
  if (!m?.[1] || !m[2])
    throw new ShipError(
      "This checkout has no GitHub remote, so it isn't your Shipify copy yet: push it to your repo first (docs/getting-started.md).",
      "unsupported",
    );
  checkoutRepo = `${m[1]}/${m[2]}`;
  return checkoutRepo;
}

/** Your Shipify repo's owner: a user account or an org (ADR 0047). */
export const platformOwner = () => platformRepo().split("/")[0] ?? "";

/**
 * Where an account's own GitHub Apps and their installs are set (ADR 0047): a user account's
 * settings, or an organization's. GitHub's `type` decides; an org's when it can't be read.
 */
export function settingsHome(account: string): string {
  const type = ghRun(["api", `users/${account}`, "--jq", ".type"]).stdout.trim();
  return type === "User"
    ? "https://github.com/settings"
    : `https://github.com/organizations/${account}/settings`;
}

/** A PR's repo, `owner/name`, from its URL (`https://github.com/<owner>/<name>/pull/<n>`). */
export const repoOfPr = (url: string) =>
  /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/\d+$/.exec(url)?.[1];

/** owner/name from a GitHub URL: its name whole (dots and all), without a `.git` ending. */
export function repoOf(url: string): string {
  const m = /github\.com[/:]([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?(?:[/#?]|$)/.exec(url);
  if (!m?.[1]) throw new ShipError(`Not a GitHub repository URL: ${url}`, "blocked");
  return m[1];
}

// ---------------------------------------------------------------- the record and the queue

/** Who the record's calls run as, and for how long each may take. */
export interface RecordOpts {
  /** The repo tasks live in: the platform repo unless said. */
  repo?: string;
  /** The key for issues: the workflow's own token in a task job (SHIPIFY_ISSUES_TOKEN). */
  token?: string;
  timeoutMs?: number;
}

const issuesToken = () => process.env.SHIPIFY_ISSUES_TOKEN || undefined;

/**
 * Who a run's own steps write the record as: the workflow's token (SHIPIFY_ISSUES_TOKEN). The agent
 * never holds it (it has the bot's token, for PRs), so only words this login wrote can carry the
 * door's mark (ADR 0027).
 */
export const RECORD_WRITER = "github-actions[bot]";

/** Who wrote something, as GraphQL names them. */
type GqlActor = { login: string; __typename?: string } | null;
type GqlIssue = {
  number: number;
  title: string;
  body: string;
  url: string;
  author: GqlActor;
  editor: GqlActor;
};
/** GraphQL names an app "github-actions"; REST, and the rest of the core, "github-actions[bot]". */
const login = (a: GqlActor) =>
  a
    ? a.__typename === "Bot" && !a.login.endsWith("[bot]")
      ? `${a.login}[bot]`
      : a.login
    : undefined;

/** Tasks on GitHub: issues, their comments, labels and reactions (plugins/record.ts). */
export function githubRecord(opts: RecordOpts = {}): TaskRecord {
  const repo = opts.repo ?? platformRepo();
  /** A GraphQL query about this repo: its owner and name, and string and number variables. */
  const graphql = <T>(
    query: string,
    vars: Record<string, string> = {},
    ints: Record<string, number> = {},
  ): T => {
    const [owner, name] = repo.split("/") as [string, string];
    const r = ghRun(
      [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        ...Object.entries({ owner, name, ...vars }).flatMap(([k, v]) => ["-f", `${k}=${v}`]),
        ...Object.entries(ints).flatMap(([k, v]) => ["-F", `${k}=${v}`]),
      ],
      call(),
    );
    if (r.code !== 0) throw new ShipError(`gh api graphql failed: ${r.stderr.trim()}`);
    return ((JSON.parse(r.stdout) as { data?: T }).data ?? {}) as T;
  };
  const call = (more: GhOpts = {}): GhOpts => ({
    token: opts.token ?? issuesToken(),
    timeoutMs: opts.timeoutMs,
    ...more,
  });
  const api = <T>(method: string, path: string, body?: unknown): T => {
    const args = ["api", "-X", method, path];
    if (body !== undefined) args.push("--input", "-");
    return ghJson<T>(args, call({ input: body === undefined ? undefined : JSON.stringify(body) }));
  };
  const issues = `repos/${repo}/issues`;
  return {
    id: "github",
    issue: (n) => api<RecordIssue>("GET", `${issues}/${n}`),
    issues(q: IssueQuery = {}) {
      const params = [
        `state=${q.state ?? "open"}`,
        ...(q.labels?.length ? [`labels=${q.labels.map(encodeURIComponent).join(",")}`] : []),
      ];
      if (q.newest)
        return ghJson<RecordIssue[]>(
          [
            "api",
            `${issues}?${[...params, "sort=created", "direction=desc", `per_page=${Math.min(q.newest, 100)}`].join("&")}`,
          ],
          call(),
        );
      return ghPages<RecordIssue>(`${issues}?${[...params, "per_page=100"].join("&")}`, call());
    },
    createIssue: (i) => api<RecordIssue>("POST", issues, i),
    updateIssue(n, patch: IssuePatch) {
      api("PATCH", `${issues}/${n}`, patch);
    },
    issueState(n) {
      const r = ghRun(["api", `${issues}/${n}`], call());
      if (r.code !== 0)
        return /\b(404|410)\b|Not Found|was deleted/i.test(r.stderr) ? "gone" : "unknown";
      try {
        return (JSON.parse(r.stdout) as { state?: string }).state === "closed" ? "closed" : "open";
      } catch {
        return "unknown";
      }
    },
    comments: (n, since) =>
      ghPages<RecordComment>(
        `${issues}/${n}/comments?per_page=100${since ? `&since=${encodeURIComponent(since)}` : ""}`,
        call(),
      ),
    rendered(n, since) {
      const html = ["-H", "Accept: application/vnd.github.html+json"];
      const body: { body_html?: string } = since
        ? {}
        : ghJson<{ body_html?: string }>(["api", ...html, `${issues}/${n}`], call());
      const after = since ? `&since=${encodeURIComponent(since)}` : "";
      const comments = ghJson<{ id: number; created_at: string; body_html?: string }[][]>(
        ["api", "--paginate", "--slurp", ...html, `${issues}/${n}/comments?per_page=100${after}`],
        call(),
      )
        .flat()
        .map((c) => ({ id: c.id, created_at: c.created_at, html: c.body_html ?? "" }));
      return { body: body.body_html ?? "", comments };
    },
    comment: (n, body) => api<{ id: number }>("POST", `${issues}/${n}/comments`, { body }).id,
    editComment(id, body) {
      api("PATCH", `${issues}/comments/${id}`, { body });
    },
    deleteComment: (id) =>
      ghRun(["api", "-X", "DELETE", `${issues}/comments/${id}`], call()).code === 0,
    labels: () =>
      ghPages<{ name: string }>(`repos/${repo}/labels?per_page=100`, call()).map((l) => l.name),
    makeLabel(l: RecordLabel) {
      ghRun(
        [
          "label",
          "create",
          l.name,
          "-R",
          repo,
          "--color",
          l.color,
          "--description",
          l.description,
          "--force",
        ],
        call(),
      );
    },
    addLabels(n, names) {
      api("POST", `${issues}/${n}/labels`, { labels: names });
    },
    removeLabel(n, name) {
      ghRun(["api", "-X", "DELETE", `${issues}/${n}/labels/${encodeURIComponent(name)}`], call());
    },
    react(on, content) {
      const path = "issue" in on ? `${issues}/${on.issue}` : `${issues}/comments/${on.comment}`;
      ghRun(["api", "-X", "POST", `${path}/reactions`, "-f", `content=${content}`], call());
    },
    pages(label, state = "open") {
      const nodes = graphql<{
        repository?: {
          issues?: {
            nodes: (GqlIssue & { state: string; labels: { nodes: { name: string }[] } })[];
          };
        };
      }>(
        `query($owner: String!, $name: String!, $label: String!) { repository(owner: $owner, name: $name) { issues(first: 100, labels: [$label], states: [${state === "all" ? "OPEN, CLOSED" : "OPEN"}], orderBy: {field: CREATED_AT, direction: ASC}) { nodes { number title body url state labels(first: 20) { nodes { name } } author { login __typename } editor { login __typename } } } } }`,
        { label },
      ).repository?.issues?.nodes;
      return (nodes ?? []).map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        state: i.state === "CLOSED" ? "closed" : "open",
        labels: i.labels?.nodes ?? [],
        url: i.url,
        author: login(i.author) ?? "ghost",
        editor: login(i.editor),
      }));
    },
    writers(n) {
      const i = graphql<{ repository?: { issue?: GqlIssue } }>(
        "query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { issue(number: $n) { author { login __typename } editor { login __typename } } } }",
        {},
        { n },
      ).repository?.issue;
      return { author: login(i?.author ?? null) ?? "ghost", editor: login(i?.editor ?? null) };
    },
    commentWriters(comment) {
      const id =
        comment.node_id ??
        ghJson<{ node_id?: string }>(["api", `${issues}/comments/${comment.id}`], call()).node_id;
      if (!id) return { author: "ghost" };
      const r = ghRun(
        [
          "api",
          "graphql",
          "-f",
          "query=query($id: ID!) { node(id: $id) { ... on IssueComment { author { login __typename } editor { login __typename } } } }",
          "-f",
          `id=${id}`,
        ],
        call(),
      );
      if (r.code !== 0) throw new ShipError(`gh api graphql failed: ${r.stderr.trim()}`);
      const node = (JSON.parse(r.stdout) as { data?: { node?: GqlIssue | null } }).data?.node;
      return {
        author: login(node?.author ?? null) ?? "ghost",
        editor: login(node?.editor ?? null),
      };
    },
    pin(issue) {
      if (!issue.node_id) return;
      ghRun(
        [
          "api",
          "graphql",
          "-f",
          "query=mutation($id: ID!) { pinIssue(input: {issueId: $id}) { issue { number } } }",
          "-f",
          `id=${issue.node_id}`,
        ],
        call(),
      );
    },
  };
}

/** Runs on GitHub Actions: starting one, and what's queued or under way (plugins/record.ts). */
export function githubQueue(opts: RecordOpts = {}): Queue {
  const repo = opts.repo ?? platformRepo();
  const call = (): GhOpts => ({ token: opts.token ?? issuesToken(), timeoutMs: opts.timeoutMs });
  return {
    dispatch(workflow, inputs) {
      const fields = Object.entries(inputs).flatMap(([k, v]) => (v ? ["-f", `${k}=${v}`] : []));
      const r = ghRun(["workflow", "run", workflow, "-R", repo, ...fields], call());
      return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
    },
    active: () =>
      ["in_progress", "queued"].flatMap((s) =>
        ghJson<{ workflow_runs: { display_title: string }[] }>(
          ["api", `repos/${repo}/actions/runs?status=${s}&per_page=100`],
          call(),
        ).workflow_runs.map((r) => r.display_title),
      ),
    runs: (workflow, count = 30) =>
      ghJson<{ workflow_runs: QueueRun[] }>(
        ["api", `repos/${repo}/actions/workflows/${workflow}/runs?per_page=${count}`],
        call(),
      ).workflow_runs,
  };
}

// ---------------------------------------------------------------- GitHub as a channel

/** GitHub's comment limit is 65,536 characters; a body over it is cut, saying so. */
export function fitComment(body: string): string {
  const max = 65_000;
  if (body.length <= max) return body;
  return `${body.slice(0, max - 200).replace(/\n[^\n]*$/, "")}\n\n_(Cut here: GitHub takes 65,536 characters in a comment.)_`;
}

/**
 * A comment on the record (a task's reply, the status task's alert), cut to fit one comment. GitHub
 * is always there: no command, no key of its own (the run's issue token). Its id, or why not.
 */
export function postComment(
  record: TaskRecord,
  issue: number,
  text: string,
): { ok: true; id: number } | { ok: false; error: string } {
  try {
    return { ok: true, id: record.comment(issue, fitComment(text)) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
