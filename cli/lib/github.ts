// GitHub, the record plug-in (ADR 0027, docs/plug-ins.md): every call Shipify makes to GitHub goes
// through this file's gh helpers, each with a timeout. githubRecord and githubQueue are the record's
// contract (plugins/record.ts) on GitHub: tasks, comments and labels, and starting runs. Without
// `token`, gh uses GH_TOKEN (the bot's token in a task job) or its own login; with it, that one call
// runs as another identity, such as the workflow's token for the task's issue.

import { PLATFORM_ROOT } from "./config.ts";
import { type RunResult, run, runAsync } from "./exec.ts";
import { ShipError } from "./output.ts";
import type {
  IssuePatch,
  IssueQuery,
  NewPart,
  Queue,
  QueueRun,
  RecordComment,
  RecordIssue,
  RecordLabel,
  RecordWrite,
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

/** What the conditional reads came to (ADR 0057): how many, how many changed, and the rate budget. */
const seen: { reads: number; changed: number; first?: string; last?: string; limit?: string } = {
  reads: 0,
  changed: 0,
};
/** `150 reads, 4 changed; rate 120 → 128 of 5000`: a 304 is free, so only the changed ones cost. */
export const readsSeen = () =>
  seen.reads
    ? `${seen.reads} reads, ${seen.changed} changed${seen.first ? `; rate ${seen.first} → ${seen.last} of ${seen.limit}` : ""}`
    : undefined;

/**
 * A GET only when its answer changed since `tag` (GitHub's ETag): unchanged is `{ tag }`, a 304,
 * which costs the rate limit nothing (GitHub's REST guide; checked live for ADR 0057).
 */
export function ghIfChanged<T>(
  path: string,
  tag: string | undefined,
  opts: GhOpts = {},
): { tag?: string; body?: T } {
  const r = ghRun(["api", "-i", ...(tag ? ["-H", `If-None-Match: ${tag}`] : []), path], opts);
  const cut = r.stdout.search(/\r?\n\r?\n/);
  const head = cut < 0 ? r.stdout : r.stdout.slice(0, cut);
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1];
  const used = /^x-ratelimit-used:\s*(\d+)/im.exec(head)?.[1];
  seen.reads++;
  if (status === "200") seen.changed++;
  if (used) {
    seen.first ??= used;
    seen.last = used;
    seen.limit = /^x-ratelimit-limit:\s*(\d+)/im.exec(head)?.[1];
  }
  if (status === "304") return { ...(tag ? { tag } : {}) };
  if (r.code !== 0 || status !== "200")
    throw new ShipError(`gh api ${path} failed: ${(r.stderr || head).trim().split("\n")[0]}`);
  const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1];
  return { ...(etag ? { tag: etag } : {}), body: JSON.parse(r.stdout.slice(cut).trim()) as T };
}

export function ghJson<T>(args: string[], opts: GhOpts = {}): T {
  const out = gh(args, opts).trim();
  return (out ? JSON.parse(out) : null) as T;
}

/** `ghRun` without waiting for it (ADR 0051 B3): for writes that start together. */
export function ghRunAsync(args: string[], opts: GhOpts = {}): Promise<RunResult> {
  return runAsync("gh", args, {
    cwd: opts.cwd,
    input: opts.input,
    env: opts.token ? { GH_TOKEN: opts.token } : undefined,
    timeoutMs: opts.timeoutMs ?? 180_000,
  });
}

/** `gh` without waiting for it: resolves with stdout, rejects with stderr (ADR 0051 B3). */
export async function ghAsync(args: string[], opts: GhOpts = {}): Promise<string> {
  const r = await ghRunAsync(args, opts);
  if (r.code !== 0)
    throw new ShipError(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function ghJsonAsync<T>(args: string[], opts: GhOpts = {}): Promise<T> {
  const out = (await ghAsync(args, opts)).trim();
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
  /** A GraphQL mutation with only its own variables (strings and ids). */
  const mutate = <T>(query: string, vars: Record<string, string>): T => {
    const r = ghRun(
      [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        ...Object.entries(vars).flatMap(([k, v]) => ["-f", `${k}=${v}`]),
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
  const pinning = (mutation: "pinIssue" | "unpinIssue", issue: RecordIssue) => {
    if (!issue.node_id) return;
    ghRun(
      [
        "api",
        "graphql",
        "-f",
        `query=mutation($id: ID!) { ${mutation}(input: {issueId: $id}) { issue { number } } }`,
        "-f",
        `id=${issue.node_id}`,
      ],
      call(),
    );
  };
  return {
    id: "github",
    issue: (n) => api<RecordIssue>("GET", `${issues}/${n}`),
    issues(q: IssueQuery = {}) {
      const params = [
        `state=${q.state ?? "open"}`,
        ...(q.labels?.length ? [`labels=${q.labels.map(encodeURIComponent).join(",")}`] : []),
        ...(q.since ? [`since=${encodeURIComponent(q.since)}`] : []),
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
    commentsIfChanged(n, since, tag) {
      const r = ghIfChanged<RecordComment[]>(
        `${issues}/${n}/comments?per_page=100&since=${encodeURIComponent(since)}`,
        tag,
        call(),
      );
      return { ...(r.tag ? { tag: r.tag } : {}), ...(r.body ? { comments: r.body } : {}) };
    },
    issueIfChanged(n, tag) {
      const r = ghIfChanged<RecordIssue>(`${issues}/${n}`, tag, call());
      return { ...(r.tag ? { tag: r.tag } : {}), ...(r.body ? { issue: r.body } : {}) };
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
    async together(writes: RecordWrite[]): Promise<number[]> {
      // Each write starts at once (ADR 0051 B3): best effort stays best effort, the rest reject.
      const done = await Promise.all(
        writes.map(async (w) => {
          switch (w.w) {
            case "react": {
              const path =
                "issue" in w.on ? `${issues}/${w.on.issue}` : `${issues}/comments/${w.on.comment}`;
              await ghRunAsync(
                ["api", "-X", "POST", `${path}/reactions`, "-f", `content=${w.content}`],
                call(),
              );
              return undefined;
            }
            case "unlabel":
              await ghRunAsync(
                ["api", "-X", "DELETE", `${issues}/${w.n}/labels/${encodeURIComponent(w.name)}`],
                call(),
              );
              return undefined;
            case "labels":
              await ghJsonAsync(
                ["api", "-X", "POST", `${issues}/${w.n}/labels`, "--input", "-"],
                call({ input: JSON.stringify({ labels: w.names }) }),
              );
              return undefined;
            case "comment": {
              const { id } = await ghJsonAsync<{ id: number }>(
                ["api", "-X", "POST", `${issues}/${w.n}/comments`, "--input", "-"],
                call({ input: JSON.stringify({ body: w.body }) }),
              );
              return id;
            }
            case "editComment":
              await ghJsonAsync(
                ["api", "-X", "PATCH", `${issues}/comments/${w.id}`, "--input", "-"],
                call({ input: JSON.stringify({ body: w.body }) }),
              );
              return undefined;
          }
        }),
      );
      return done.filter((id): id is number => typeof id === "number");
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
    family(n) {
      const i = graphql<{ repository?: { issue?: GqlFamily & { parent?: GqlFamily | null } } }>(
        `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { issue(number: $n) { ${FAMILY} parent { ${FAMILY} } } } }`,
        {},
        { n },
      ).repository?.issue;
      const top = i?.parent ?? i;
      if (!top?.subIssues?.nodes.length) return undefined;
      return {
        parent: {
          number: top.number,
          title: top.title,
          body: top.body ?? "",
          state: top.state === "CLOSED" ? "closed" : "open",
          labels: names(top.labels),
        },
        parts: top.subIssues.nodes.map((p) => ({
          number: p.number,
          title: p.title,
          state: p.state === "CLOSED" ? "closed" : "open",
          ...(p.stateReason ? { reason: p.stateReason.toLowerCase() } : {}),
          labels: names(p.labels),
          blockedBy: (p.blockedBy?.nodes ?? []).map((b) => ({
            number: b.number,
            state: b.state === "CLOSED" ? "closed" : "open",
            ...(b.stateReason ? { reason: b.stateReason.toLowerCase() } : {}),
          })),
          ...(p.closedByPullRequestsReferences?.nodes[0]
            ? { pr: p.closedByPullRequestsReferences.nodes[0].url }
            : {}),
        })),
      };
    },
    openParts(parent, parts, label) {
      // One read: the repo's, the label's and the parent's ids, and its parts already there.
      type Ids = {
        repository?: {
          id: string;
          label?: { id: string } | null;
          issue?: {
            id: string;
            subIssues: { nodes: { id: string; number: number; title: string }[] };
          };
        };
      };
      const ids = () =>
        graphql<Ids>(
          "query($owner: String!, $name: String!, $label: String!, $n: Int!) { repository(owner: $owner, name: $name) { id label(name: $label) { id } issue(number: $n) { id subIssues(first: 50) { nodes { id number title } } } } }",
          { label: label.name },
          { n: parent },
        ).repository;
      let r = ids();
      if (r && !r.label) {
        this.makeLabel(label);
        r = ids();
      }
      if (!r?.issue || !r.label) throw new ShipError(`#${parent} or its label couldn't be read`);
      const there = r.issue.subIssues.nodes;
      const made: ({ id: string; number: number } | undefined)[] = parts.map((p) =>
        there.find((x) => x.title === p.title),
      );
      // One call makes the new ones, each a sub-issue of the parent as it's made.
      const fresh = parts.map((_, i) => i).filter((i) => !made[i]);
      if (fresh.length) {
        const vars: Record<string, string> = { repo: r.id, label: r.label.id, parent: r.issue.id };
        for (const i of fresh) {
          vars[`t${i}`] = parts[i]?.title ?? "";
          vars[`b${i}`] = parts[i]?.body ?? "";
        }
        const got = mutate<Record<string, { issue: { id: string; number: number } }>>(
          `mutation($repo: ID!, $label: ID!, $parent: ID!, ${fresh.map((i) => `$t${i}: String!, $b${i}: String!`).join(", ")}) { ${fresh.map((i) => `p${i}: createIssue(input: {repositoryId: $repo, title: $t${i}, body: $b${i}, labelIds: [$label], parentIssueId: $parent}) { issue { id number } }`).join(" ")} }`,
          vars,
        );
        for (const i of fresh) made[i] = got[`p${i}`]?.issue;
      }
      if (made.some((m) => !m)) throw new ShipError("GitHub didn't open every part");
      const all = made as { id: string; number: number }[];
      // One call links them: only the parts made now, so a second try adds no link twice.
      const links = fresh.flatMap((i) => {
        const p = parts[i] as NewPart;
        return [
          ...p.after.map((a) => all[a]?.id),
          ...p.waits.map((w) => there.find((x) => x.number === w)?.id),
        ]
          .filter((b): b is string => Boolean(b))
          .map((b) => [all[i]?.id as string, b] as const);
      });
      if (links.length) {
        const vars = Object.fromEntries(
          links.flatMap(([a, b], k) => [
            [`a${k}`, a],
            [`b${k}`, b],
          ]),
        );
        mutate(
          `mutation(${links.map((_, k) => `$a${k}: ID!, $b${k}: ID!`).join(", ")}) { ${links.map((_, k) => `l${k}: addBlockedBy(input: {issueId: $a${k}, blockingIssueId: $b${k}}) { clientMutationId }`).join(" ")} }`,
          vars,
        );
      }
      return all.map((m) => m.number);
    },
    pin: (issue) => pinning("pinIssue", issue),
    unpin: (issue) => pinning("unpinIssue", issue),
  };
}

/** What the family read takes of each issue (ADR 0066): the parent's words, and each part. */
const FAMILY =
  "number title body state labels(first: 20) { nodes { name } } subIssues(first: 50) { nodes { number title state stateReason labels(first: 20) { nodes { name } } blockedBy(first: 20) { nodes { number state stateReason } } closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { nodes { url } } } }";
type GqlState = "OPEN" | "CLOSED";
type GqlLabels = { nodes: { name: string }[] } | null | undefined;
type GqlFamily = {
  number: number;
  title: string;
  body: string | null;
  state: GqlState;
  labels: GqlLabels;
  subIssues?: {
    nodes: {
      number: number;
      title: string;
      state: GqlState;
      stateReason: string | null;
      labels: GqlLabels;
      blockedBy?: { nodes: { number: number; state: GqlState; stateReason: string | null }[] };
      closedByPullRequestsReferences?: { nodes: { url: string }[] };
    }[];
  };
};
const names = (l: GqlLabels) => (l?.nodes ?? []).map((x) => x.name);

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
    waitingFor(labels, tag) {
      const r = ghIfChanged<{ workflow_runs: { id: number }[] }>(
        `repos/${repo}/actions/runs?status=queued&per_page=20`,
        tag,
        call(),
      );
      // Unchanged since the last look: no job came to wait meanwhile.
      if (!r.body) return { ...(r.tag ? { tag: r.tag } : {}), waiting: false };
      const queued = r.body.workflow_runs
        .flatMap(
          (run) =>
            ghJson<{
              jobs: { status: string; labels: string[]; created_at?: string; run_id?: number }[];
            }>(["api", `repos/${repo}/actions/runs/${run.id}/jobs?filter=latest`], call()).jobs,
        )
        .filter((j) => j.status === "queued" && j.labels.some((l) => labels.includes(l)))
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      const first = queued[0];
      return {
        ...(r.tag ? { tag: r.tag } : {}),
        waiting: queued.length > 0,
        ...(first?.created_at ? { since: first.created_at } : {}),
        ...(first?.run_id ? { run: first.run_id } : {}),
      };
    },
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
