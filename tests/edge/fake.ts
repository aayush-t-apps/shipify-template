// A world for the edge's tests: GitHub (shipify's issues, comments, labels, reactions, variables,
// runners and runs), Telegram's Bot API, GitHub's OIDC keys and your apps' /health, all in memory
// behind one fetch, so the edge's own code runs as it is, in Node. Every call is kept (`calls`), and
// what Telegram was asked (`sent`). The clock is the test's: `at`.
import { clearCaches } from "../../edge/src/cache.ts";
import type { Deps, Env } from "../../edge/src/env.ts";

export const REPO = "o/shipify";
export const APP_ID = 77;
/** An issue's id, as GitHub's REST answer carries it beside its number. */
const ISSUE_ID = 900_000;
export const DOOR = "shipify-door[bot]";
export const RUN = { login: "github-actions[bot]", id: 41898282, type: "Bot" };
export const OWNER = "owner";
export const ORIGIN = "https://shipify.example.com";
export const CHAT = 4242;

export interface Issue {
  number: number;
  title: string;
  body: string;
  user: { login: string; type?: string };
  labels: string[];
  state: "open" | "closed";
  locked?: boolean;
  pull_request?: unknown;
  performed_via_github_app?: { id: number } | null;
  created_at: string;
  updated_at?: string;
  /** GitHub's rendering of its body, when a test gives one. */
  html?: string;
  /** Why it closed, as GraphQL says it: "COMPLETED" (none given), "NOT_PLANNED" (dropped). */
  stateReason?: string;
  /** The tasks it's blocked by (GitHub's link, ADR 0066). */
  blockedBy?: number[];
  /** Its sub-issues, in order: GitHub's link, as the box makes it on a split's `yes`. */
  subIssues?: number[];
  /** The open PR that closes it. */
  closedBy?: { number: number; url: string };
  /** When it closed, as GitHub says it: set as a PATCH closes it. */
  closed_at?: string | null;
}

export interface Comment {
  id: number;
  issue: number;
  body: string;
  user: { login: string; id: number; type: string };
  performed_via_github_app?: { id: number } | null;
  created_at: string;
  updated_at: string;
  node_id: string;
  reactions: { content: string; user: { login: string; type: string } }[];
  editor?: string;
  html?: string;
}

export interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  display_title: string;
  created_at: string;
  updated_at?: string;
}

const b64url = (b: ArrayBuffer | Uint8Array) =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

/** Two RSA keys: the door App's (PKCS#8 PEM) and GitHub's OIDC signer (its public half in JWKS). */
export async function keys() {
  const gen = () =>
    crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    ) as Promise<CryptoKeyPair>;
  const [app, oidc] = await Promise.all([gen(), gen()]);
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", app.privateKey)).toString(
    "base64",
  );
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
  const jwk = (await crypto.subtle.exportKey("jwk", oidc.publicKey)) as JsonWebKey;
  return { pem, oidc: oidc.privateKey, jwk: { ...jwk, kid: "k1", alg: "RS256", use: "sig" } };
}

export type Keys = Awaited<ReturnType<typeof keys>>;

/** A run's OIDC token: shipify's task.yml on main, unless `claims` say otherwise. */
export async function runToken(
  k: Keys,
  now: number,
  claims: Record<string, unknown> = {},
  head: Record<string, unknown> = {},
) {
  const s = Math.floor(now / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const signing = `${enc({ alg: "RS256", kid: "k1", typ: "JWT", ...head })}.${enc({
    iss: "https://token.actions.githubusercontent.com",
    aud: ORIGIN,
    repository: REPO,
    repository_id: "1001",
    repository_owner_id: "2002",
    ref: "refs/heads/main",
    workflow_ref: `${REPO}/.github/workflows/task.yml@refs/heads/main`,
    iat: s - 5,
    nbf: s - 5,
    exp: s + 300,
    ...claims,
  })}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    k.oidc,
    new TextEncoder().encode(signing),
  );
  return `${signing}.${b64url(sig)}`;
}

export const envFor = (k: Keys, more: Partial<Env> = {}): Env => ({
  GIT_SHA: "abc123",
  GITHUB_REPO: REPO,
  // Your copy's time zone, as ci.yml deploys it (ADR 0047).
  SHIPIFY_TIME_ZONE: "Asia/Kolkata",
  SHIPIFY_DOOR_URL: ORIGIN,
  SHIPIFY_DOOR_APP_ID: String(APP_ID),
  SHIPIFY_DOOR_SLUG: "shipify-door",
  SHIPIFY_DOOR_INSTALLATION: "555",
  SHIPIFY_REPO_ID: "1001",
  SHIPIFY_OWNER_ID: "2002",
  SHIPIFY_DOOR_APP_KEY: k.pem,
  TELEGRAM_TOKEN: "bot-token",
  TELEGRAM_SECRET: "tg-secret",
  ...more,
});

type Reply = { status?: number; body?: unknown };

/** The world, and a fetch into it. */
export function world(k: Keys, start = Date.parse("2026-10-04T12:00:00Z")) {
  clearCaches();
  const w = {
    at: start,
    /** GitHub's listings lag a moment after a write: they show nothing while this is on. */
    listsLag: false,
    /** As GitHub did once for an hour, with no error: the next this many issue lists show nothing. */
    listsMiss: 0,
    issues: [] as Issue[],
    comments: [] as Comment[],
    events: {} as Record<number, Record<string, unknown>[]>,
    variables: {
      SHIPIFY_OWNER: OWNER,
      SHIPIFY_PEOPLE: JSON.stringify([
        { name: "owner", on: { github: OWNER, telegram: String(CHAT) } },
      ]),
    } as Record<string, string>,
    runners: [
      {
        name: "pi-1",
        status: "online",
        busy: false,
        labels: [{ name: "shipify-box" }, { name: "box-pi" }],
      },
    ] as { name: string; status: string; busy: boolean; labels: { name: string }[] }[],
    runs: {} as Record<string, Run[]>,
    tokenStatus: 201,
    githubDown: false,
    /** GitHub's GraphQL answers a 502 (a sub-task plan's read fails). */
    graphqlFails: false,
    /** How many times moved chats' parents were read (one GraphQL call for all). */
    parentReads: 0,
    /** How many times comments' reactions were read by GraphQL (the watch's notice: one for all). */
    markReads: 0,
    /** GitHub's next this many calls get a 502 (a moment's hiccup), its token's left alone. */
    githubBlips: 0,
    /** One task's read fails (a GitHub hiccup), by its number. */
    issueReadFails: undefined as number | undefined,
    /** One task's change (closing, reopening) fails, by its number. */
    issueWriteFails: undefined as number | undefined,
    /** Marking a comment (🚀, 😕) fails: GitHub having a bad minute. */
    reactionsFail: false,
    /** GitHub answers this to new comments (500, say), when set. */
    commentsFail: undefined as number | undefined,
    /** GitHub answers this to the read of shipify's variables (who's who), when set. */
    variablesFail: undefined as number | undefined,
    /** What Telegram answers a method, when not ok. */
    telegramFails: {} as Record<string, Reply & { times?: number }>,
    webhookInfo: { url: `${ORIGIN}/door/telegram` } as Record<string, unknown>,
    /** The bot's menu and start screen, as Telegram keeps them. */
    botMenu: { commands: [] as unknown[], description: "", short: "" },
    /** The chat's pinned message, as Telegram keeps it: getChat shows it, an edit changes it. */
    pinned: undefined as
      | { message_id: number; text: string; from: { is_bot: boolean } }
      | undefined,
    apps: {} as Record<string, Reply>,
    /** How many times GitHub rendered Markdown (`POST /markdown`). */
    rendered: 0,
    /** Each issue search's `q`, and whether search by meaning is spent for the minute (ADR 0070). */
    searches: [] as string[],
    searchBusy: false,
    jwks: { keys: [k.jwk] } as { keys: unknown[] },
    runnerRelease: { tag_name: "v2.330.0", published_at: "2026-08-01T00:00:00Z" },
    calls: [] as string[],
    sent: [] as { method: string; body: Record<string, unknown> }[],
    nextId: 1000,
    nextIssue: 1,
    logs: [] as string[],
  };
  const iso = () => new Date(w.at).toISOString();

  /** GitHub's rendering, as `full+json` gives it: a test's own HTML, else the words in a <p>. */
  // As GitHub renders it: a leading line (a comment) is dropped, but not the newline after it.
  const htmlOf = (body: string, html?: string) =>
    html ??
    `${/^<!--[^\n]*-->\n/.test(body) ? "\n" : ""}<p>${body
      .replace(/^<!--[^\n]*-->\n?/, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</p>`;
  const byNumber = (n: number) => w.issues.find((x) => x.number === n);
  // As GitHub's REST answer has them on every issue: its sub-issues done of all, its open blockers.
  const issueJson = (i: Issue) => {
    const { stateReason, blockedBy, subIssues, closedBy, ...rest } = i;
    const subs = (subIssues ?? []).map(byNumber);
    return {
      ...rest,
      id: ISSUE_ID + i.number,
      html_url: `https://github.com/${REPO}/issues/${i.number}`,
      labels: i.labels.map((name) => ({ name })),
      body_html: htmlOf(i.body, i.html),
      updated_at: i.updated_at ?? i.created_at,
      comments: w.comments.filter((c) => c.issue === i.number).length,
      sub_issues_summary: {
        total: subs.length,
        completed: subs.filter((s) => s?.state === "closed").length,
        percent_completed: 0,
      },
      issue_dependencies_summary: {
        blocked_by: (blockedBy ?? []).filter((b) => byNumber(b)?.state === "open").length,
        blocking: 0,
        total_blocked_by: (blockedBy ?? []).length,
        total_blocking: 0,
      },
    };
  };
  /** An issue's state, as GraphQL says it. */
  const status = (i: Issue) => ({
    state: i.state === "open" ? "OPEN" : "CLOSED",
    stateReason: i.state === "open" ? null : (i.stateReason ?? "COMPLETED"),
  });
  /** An issue as GraphQL's subIssues node has it. */
  const node = (i: Issue) => ({
    number: i.number,
    title: i.title,
    ...status(i),
    labels: { nodes: i.labels.map((name) => ({ name })) },
    blockedBy: {
      nodes: (i.blockedBy ?? []).flatMap((b) => {
        const x = byNumber(b);
        return x ? [{ number: b, ...status(x) }] : [];
      }),
    },
    closedByPullRequestsReferences: { nodes: i.closedBy ? [i.closedBy] : [] },
  });
  const commentJson = (c: Comment) => ({
    id: c.id,
    node_id: c.node_id,
    html_url: `https://github.com/${REPO}/issues/${c.issue}#issuecomment-${c.id}`,
    issue_url: `https://api.github.com/repos/${REPO}/issues/${c.issue}`,
    body: c.body,
    body_html: htmlOf(c.body, c.html),
    user: c.user,
    performed_via_github_app: c.performed_via_github_app ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    reactions: {
      rocket: c.reactions.filter((r) => r.content === "rocket").length,
      confused: c.reactions.filter((r) => r.content === "confused").length,
      eyes: c.reactions.filter((r) => r.content === "eyes").length,
    },
  });
  const byDoor = { login: DOOR, type: "Bot" };
  const label = (n: number, name: string) => {
    const i = w.issues.find((x) => x.number === n);
    if (!i) return false;
    if (!i.labels.includes(name)) i.labels.push(name);
    w.events[n] = [
      ...(w.events[n] ?? []),
      {
        event: "labeled",
        label: { name },
        created_at: iso(),
        actor: byDoor,
        performed_via_github_app: { id: APP_ID },
      },
    ];
    return true;
  };

  const github = (method: string, url: URL, body: unknown): Reply => {
    const path = url.pathname.replace(/^\//, "");
    const q = url.searchParams;
    if (path === `app/installations/555/access_tokens` && method === "POST")
      return w.tokenStatus === 201
        ? {
            status: 201,
            body: { token: "inst-token", expires_at: new Date(w.at + 3_600_000).toISOString() },
          }
        : { status: w.tokenStatus, body: { message: "Bad credentials" } };
    if (path === "app/installations/555")
      return {
        body: {
          permissions: {
            issues: "write",
            actions: "read",
            administration: "read",
            metadata: "read",
            variables: "read",
          },
          repository_selection: "selected",
        },
      };
    if (path === "installation/repositories")
      return { body: { repositories: [{ name: "shipify" }] } };
    if (path === "repos/actions/runner/releases/latest") return { body: w.runnerRelease };
    // GitHub's issue search (ADR 0070): by meaning (`search_type=hybrid`), any of the words in a
    // title or a body; by words, all of them. `searchBusy`: its 10 a minute by meaning are spent.
    if (path === "search/issues" && method === "GET") {
      const hybrid = q.get("search_type") === "hybrid";
      w.searches.push(q.get("q") ?? "");
      if (hybrid && w.searchBusy)
        return { status: 403, body: { message: "API rate limit exceeded for semantic search" } };
      const words = (q.get("q") ?? "")
        .split(/\s+/)
        .filter((x) => x && !x.includes(":"))
        .map((x) => x.toLowerCase());
      const has = (i: Issue, x: string) => `${i.title} ${i.body}`.toLowerCase().includes(x);
      const items = w.issues.filter((i) =>
        hybrid ? words.some((x) => has(i, x)) : words.every((x) => has(i, x)),
      );
      return {
        body: {
          total_count: items.length,
          items: items.slice(0, 10).map(issueJson),
          ...(hybrid ? { search_type: "hybrid" } : {}),
        },
      };
    }
    if (path === "graphql" && /subIssues/.test((body as { query?: string }).query ?? "")) {
      if (w.graphqlFails) return { status: 502 };
      const v = (body as { variables: { owner: string; name: string; n: number } }).variables;
      const i = `${v.owner}/${v.name}` === REPO ? byNumber(v.n) : undefined;
      const subs = (i?.subIssues ?? []).flatMap((n) => byNumber(n) ?? []);
      return {
        body: {
          data: { repository: { issue: i ? { subIssues: { nodes: subs.map(node) } } : null } },
        },
      };
    }
    // Moved chats' parents, each under its alias `i<n>`, as GitHub gives them: null for none.
    const asked = (body as { query?: string } | undefined)?.query ?? "";
    if (path === "graphql" && /parent \{ number \}/.test(asked)) {
      w.parentReads++;
      const repository = Object.fromEntries(
        [...asked.matchAll(/i(\d+): issue/g)].map(([, n]) => {
          const p = w.issues.find((x) => x.subIssues?.includes(Number(n)));
          return [`i${n}`, { parent: p ? { number: p.number } : null }];
        }),
      );
      return { body: { data: { repository } } };
    }
    // Comments' reactions by kind, with who gave each, as GitHub's GraphQL gives them: a bot by its
    // `<slug>`, with no `[bot]`; a comment that isn't there, null and an error.
    if (path === "graphql" && /reactionGroups/.test(asked)) {
      w.markReads++;
      const ids = (body as { variables: { ids: string[] } }).variables.ids;
      const nodes = ids.map((id) => {
        const c = w.comments.find((x) => x.node_id === id);
        if (!c) return null;
        const kinds = [...new Set(c.reactions.map((r) => r.content))];
        return {
          databaseId: c.id,
          reactionGroups: kinds.map((k) => ({
            content: k.toUpperCase(),
            reactors: {
              nodes: c.reactions
                .filter((r) => r.content === k)
                .map((r) =>
                  r.user.type === "Bot"
                    ? { __typename: "Bot", login: r.user.login.replace(/\[bot\]$/, "") }
                    : { __typename: "User" },
                ),
            },
          })),
        };
      });
      const missing = nodes.some((n) => !n);
      return { body: { data: { nodes }, ...(missing ? { errors: [{ type: "NOT_FOUND" }] } : {}) } };
    }
    if (path === "graphql") {
      const id = (body as { variables?: { id?: string } }).variables?.id;
      const c = w.comments.find((x) => x.node_id === id);
      return {
        body: {
          data: {
            node: c
              ? {
                  lastEditedAt: c.editor ? c.updated_at : null,
                  editor: c.editor ? { login: c.editor } : null,
                }
              : null,
          },
        },
      };
    }
    const base = `repos/${REPO}/`;
    if (!path.startsWith(base)) return { status: 404 };
    const p = path.slice(base.length);
    /** The path's numbers or names, for one route's pattern. */
    const at = (re: RegExp) => re.exec(p) ?? undefined;
    let m: RegExpExecArray | undefined;
    if (p === "actions/variables") {
      const all = Object.entries(w.variables).map(([name, value]) => ({ name, value }));
      return { body: { total_count: all.length, variables: all } };
    }
    if (p === "actions/runners")
      return { body: { total_count: w.runners.length, runners: w.runners } };
    // Newest first, a page of `per_page` (30 unless asked), as GitHub lists them.
    m = at(/^actions\/workflows\/([\w.-]+)\/runs$/);
    if (m) {
      const runs = [...(w.runs[m[1] as string] ?? [])].reverse();
      return { body: { workflow_runs: runs.slice(0, Number(q.get("per_page") ?? 30)) } };
    }
    m = at(/^actions\/runs\/(\d+)$/);
    if (m) {
      const run = Object.values(w.runs)
        .flat()
        .find((r) => r.id === Number(m?.[1]));
      return run ? { body: run } : { status: 404 };
    }
    if (p === "issues" && method === "GET") {
      const missed = w.listsMiss > 0;
      if (missed) w.listsMiss--;
      let list = w.listsLag || missed ? [] : [...w.issues];
      if (q.get("labels")) list = list.filter((i) => i.labels.includes(q.get("labels") as string));
      // As GitHub does: open ones unless asked for closed ones, or all.
      const state = q.get("state") ?? "open";
      if (state !== "all") list = list.filter((i) => i.state === state);
      list.sort((a, b) =>
        q.get("direction") === "asc" ? a.number - b.number : b.number - a.number,
      );
      const per = Number(q.get("per_page") ?? 30);
      const page = Number(q.get("page") ?? 1);
      return { body: list.slice((page - 1) * per, page * per).map(issueJson) };
    }
    if (p === "issues" && method === "POST") {
      const b = body as { title: string; body: string; labels?: string[] };
      const i: Issue = {
        number: w.nextIssue++,
        title: b.title,
        body: b.body,
        user: byDoor,
        labels: b.labels ?? [],
        state: "open",
        // As GitHub does: an issue an App opens with its own token names only its bot user.
        performed_via_github_app: null,
        created_at: iso(),
      };
      w.issues.push(i);
      return { status: 201, body: issueJson(i) };
    }
    m = at(/^issues\/(\d+)$/);
    if (m) {
      const i = w.issues.find((x) => x.number === Number(m?.[1]));
      if (i && method === "PATCH") {
        const b = body as { state?: Issue["state"]; labels?: string[]; body?: string };
        if (b.state) {
          i.state = b.state;
          i.closed_at = b.state === "closed" ? iso() : null;
        }
        if (b.labels) i.labels = b.labels;
        if (b.body !== undefined) i.body = b.body;
      }
      return i ? { body: issueJson(i) } : { status: 404, body: { message: "Not Found" } };
    }
    m = at(/^issues\/(\d+)\/comments$/);
    if (m && method === "GET") {
      const per = Number(q.get("per_page") ?? 30);
      const page = Number(q.get("page") ?? 1);
      const since = q.get("since") ? Date.parse(q.get("since") as string) : 0;
      const list = w.comments
        .filter((c) => c.issue === Number(m?.[1]) && Date.parse(c.updated_at) >= since)
        .sort((a, b) => a.id - b.id)
        .slice((page - 1) * per, page * per);
      return { body: list.map(commentJson) };
    }
    if (m && method === "POST") {
      const n = Number(m[1]);
      if (!w.issues.some((x) => x.number === n)) return { status: 404 };
      const c = addComment(n, (body as { body: string }).body, byDoor, { id: APP_ID });
      return { status: 201, body: commentJson(c) };
    }
    if (p === "issues/comments" && method === "GET") {
      const since = q.get("since") ? Date.parse(q.get("since") as string) : 0;
      const key = q.get("sort") === "created" ? "created_at" : "updated_at";
      const list = (w.listsLag ? [] : w.comments)
        .filter((c) => Date.parse(c.updated_at) >= since)
        .sort((a, b) => Date.parse(b[key]) - Date.parse(a[key]) || b.id - a.id);
      return { body: list.slice(0, Number(q.get("per_page") ?? 30)).map(commentJson) };
    }
    m = at(/^issues\/comments\/(\d+)$/);
    if (m) {
      const c = w.comments.find((x) => x.id === Number(m?.[1]));
      return c ? { body: commentJson(c) } : { status: 404 };
    }
    m = at(/^issues\/comments\/(\d+)\/reactions$/);
    if (m) {
      const c = w.comments.find((x) => x.id === Number(m?.[1]));
      if (!c) return { status: 404 };
      if (method === "POST" && w.reactionsFail) return { status: 502 };
      if (method === "POST") {
        const content = (body as { content: string }).content;
        if (c.reactions.some((r) => r.content === content && r.user.login === DOOR))
          return { status: 200, body: {} };
        c.reactions.push({ content, user: byDoor });
        return { status: 201, body: {} };
      }
      return {
        body: c.reactions
          .filter((r) => !q.get("content") || r.content === q.get("content"))
          .map((r) => ({ content: r.content, user: r.user })),
      };
    }
    // A sub-issue linked (ADR 0069), by the issue's id, as GitHub takes it: 100 a parent, and one
    // parent a sub-issue.
    m = at(/^issues\/(\d+)\/sub_issues$/);
    if (m && method === "POST") {
      const parent = byNumber(Number(m[1]));
      const sub = w.issues.find(
        (x) => ISSUE_ID + x.number === (body as { sub_issue_id: number }).sub_issue_id,
      );
      if (!parent || !sub) return { status: 404 };
      if ((parent.subIssues ?? []).length >= 100) return { status: 422 };
      if (w.issues.some((x) => x.subIssues?.includes(sub.number))) return { status: 422 };
      parent.subIssues = [...(parent.subIssues ?? []), sub.number];
      return { status: 201, body: issueJson(sub) };
    }
    m = at(/^issues\/(\d+)\/labels$/);
    if (m && method === "POST") {
      const n = Number(m[1]);
      for (const l of (body as { labels: string[] }).labels)
        if (!label(n, l)) return { status: 404 };
      return { body: [] };
    }
    m = at(/^issues\/(\d+)\/labels\/(.+)$/);
    if (m && method === "DELETE") {
      const i = w.issues.find((x) => x.number === Number(m?.[1]));
      const name = decodeURIComponent(m[2] as string);
      if (!i?.labels.includes(name))
        return { status: 404, body: { message: "Label does not exist" } };
      i.labels = i.labels.filter((l) => l !== name);
      return { body: [] };
    }
    m = at(/^issues\/(\d+)\/events$/);
    if (m) return { body: w.events[Number(m[1])] ?? [] };
    return { status: 404, body: { message: `fake: no ${method} ${p}` } };
  };

  const telegram = (method: string, body: Record<string, unknown>): Reply => {
    w.sent.push({ method, body });
    const fail = w.telegramFails[method];
    if (fail && (fail.times === undefined || fail.times > 0)) {
      if (fail.times !== undefined) fail.times--;
      return fail;
    }
    if (method === "getWebhookInfo") return { body: { ok: true, result: w.webhookInfo } };
    if (method === "getMyCommands") return { body: { ok: true, result: w.botMenu.commands } };
    if (method === "getMyDescription")
      return { body: { ok: true, result: { description: w.botMenu.description } } };
    if (method === "setMyCommands") w.botMenu.commands = body.commands as unknown[];
    if (method === "setMyDescription") w.botMenu.description = String(body.description);
    if (method === "getMyShortDescription")
      return { body: { ok: true, result: { short_description: w.botMenu.short } } };
    if (method === "setMyShortDescription") w.botMenu.short = String(body.short_description);
    if (method === "getFile")
      return { body: { ok: true, result: { file_path: "photos/file_1.jpg", file_size: 5 } } };
    if (method === "getChat")
      return { body: { ok: true, result: { id: body.chat_id, pinned_message: w.pinned } } };
    if (method === "pinChatMessage") {
      const at = w.sent.findIndex(
        (s, i) => s.method === "sendMessage" && i + 1 === Number(body.message_id),
      );
      const text = String(w.sent[at]?.body.text ?? "");
      w.pinned = { message_id: Number(body.message_id), text, from: { is_bot: true } };
      return { body: { ok: true, result: true } };
    }
    if (method === "editMessageText" && w.pinned?.message_id === Number(body.message_id))
      w.pinned.text = String(body.text);
    return { body: { ok: true, result: { message_id: w.sent.length } } };
  };

  const fetcher: Deps["fetch"] = async (input, init = {}) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    w.calls.push(`${method} ${url.host}${url.pathname}${url.search}`);
    let reply: Reply;
    if (url.host === "api.github.com") {
      if (w.githubDown && !url.pathname.includes("access_tokens"))
        return new Response(null, { status: 502 });
      if (w.githubBlips > 0 && !url.pathname.includes("access_tokens")) {
        w.githubBlips--;
        return new Response(null, { status: 502 });
      }
      if (method === "GET" && url.pathname.endsWith(`/issues/${w.issueReadFails}`))
        return new Response(null, { status: 502 });
      if (method === "PATCH" && url.pathname.endsWith(`/issues/${w.issueWriteFails}`))
        return new Response(null, { status: 502 });
      if (w.commentsFail && method === "POST" && /\/issues\/\d+\/comments$/.test(url.pathname))
        return new Response(null, { status: w.commentsFail });
      if (w.variablesFail && url.pathname.endsWith("/actions/variables"))
        return new Response(null, { status: w.variablesFail });
      const raw = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      // Markdown rendered as GitHub does it (HTML, not JSON), with a script it would never keep.
      if (method === "POST" && url.pathname === "/markdown") {
        w.rendered++;
        const words = String(raw?.text ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;");
        return new Response(`<h2>${raw?.mode}</h2><p>${words}</p><script>steal()</script>`, {
          headers: { "content-type": "text/html" },
        });
      }
      reply = github(method, url, raw);
      // As GitHub does: a body's rendering comes only when it's asked for (`full+json`).
      const accept = new Headers(init.headers).get("accept") ?? "";
      if (accept === "application/vnd.github+json" && Array.isArray(reply.body))
        reply = { ...reply, body: reply.body.map(({ body_html: _, ...x }) => x) };
    } else if (url.host === "token.actions.githubusercontent.com") {
      reply = { body: w.jwks };
    } else if (url.host === "api.telegram.org") {
      if (url.pathname.startsWith("/file/"))
        return new Response("bytes", { status: 200, headers: { "content-length": "5" } });
      const tm = /^\/bot[^/]+\/(\w+)$/.exec(url.pathname);
      let body: Record<string, unknown> = {};
      if (init.body instanceof FormData) {
        for (const [k2, v] of init.body.entries())
          body[k2] = typeof v === "string" ? v : { file: v.name, type: v.type };
      } else if (typeof init.body === "string") body = JSON.parse(init.body);
      reply = telegram(tm?.[1] ?? "", body);
    } else {
      reply = w.apps[`${url.origin}${url.pathname}`] ?? { status: 404 };
    }
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };

  const addComment = (
    issue: number,
    body: string,
    user: { login: string; id?: number; type?: string },
    app: { id: number } | null = null,
  ) => {
    const c: Comment = {
      id: w.nextId++,
      issue,
      body,
      user: { login: user.login, id: user.id ?? 9, type: user.type ?? "User" },
      performed_via_github_app: app,
      created_at: iso(),
      updated_at: iso(),
      node_id: `IC_${w.nextId}`,
      reactions: [],
    };
    w.comments.push(c);
    return c;
  };

  const deps: Deps = {
    fetch: fetcher,
    now: () => w.at,
    sleep: async () => {},
    write: (line) => w.logs.push(line),
  };

  return {
    w,
    deps,
    fetch: fetcher,
    /** An issue as it is on GitHub. */
    issue(i: Partial<Issue> & { title?: string } = {}) {
      const made: Issue = {
        number: w.nextIssue++,
        title: "a task",
        body: "",
        user: { login: OWNER },
        labels: [],
        state: "open",
        created_at: iso(),
        ...i,
      };
      w.issues.push(made);
      return made;
    },
    comment: addComment,
    /** A reply a run wrote. */
    reply: (issue: number, line: string, words = "Done: it's faster now.") =>
      addComment(issue, `${line}\n${words}`, RUN),
    /** Time passes. */
    later(ms: number) {
      w.at += ms;
    },
    /** GitHub calls made, as "METHOD path", without the host. */
    gh: () =>
      w.calls
        .filter((c) => c.includes("api.github.com"))
        .map((c) => c.replace("api.github.com/", "")),
  };
}

export type World = ReturnType<typeof world>;
