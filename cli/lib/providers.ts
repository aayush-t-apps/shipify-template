// Source control boundary. The core never talks to GitHub directly; it goes through this interface
// so another provider (GitLab) or a mock can be swapped in. SHIPIFY_PROVIDER=mock selects the mock,
// which records calls instead of making them (and with SHIPIFY_MOCK_CALLS, keeps each write in that
// file, so a test reads what several ship processes did). Hosts are not a core concern: each
// stack's make targets deploy, and the pipeline only checks the health URL.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ghRun } from "./github.ts";
import { ShipError } from "./output.ts";

/** Repo state ship needs before the first push. Read with read-only permissions. */
export interface RepoState {
  exists: boolean;
  empty: boolean;
  visibility?: "public" | "private";
  mergeCommitOnly?: boolean;
  secrets: string[];
  variables: Record<string, string>;
}

/**
 * Source control for the org-scoped fine-grained token (ADR 0014). ship never deletes, archives
 * or transfers repositories; there is deliberately no method for it.
 */
export interface SourceControlProvider {
  id: string;
  whoami(): { login: string; scopes: string[] } | undefined;
  repoState(fullName: string): RepoState;
  createBranch(fullName: string, branch: string, from: string): void;
  /** Needs Variables: write. Variables are not secret (account id, subdomain). */
  setVariable(fullName: string, name: string, value: string): void;
  /** Needs Variables: write. One that would be empty goes instead: GitHub keeps no empty one. */
  deleteVariable(fullName: string, name: string): void;
  /** Needs Administration: write. Creates an empty repository. */
  createRepo(fullName: string, visibility: "public" | "private", description: string): void;
  /**
   * Needs Administration: write. With staging: merge commits only and keep branches (production
   * accepts only the release PR's merge commit). Without: squash allowed, delete merged branches.
   */
  configureSettings(fullName: string, staging: boolean): void;
  /** Needs Secrets: write. The value is passed on stdin and never printed. */
  setSecret(fullName: string, name: string, value: string): void;
  /** Needs Secrets: write. Only `ship remove`, for the keys a plug-in's setup set. */
  deleteSecret(fullName: string, name: string): void;
  openPullRequest(input: {
    cwd: string;
    base: string;
    head: string;
    title: string;
    body: string;
    /** Labels it opens with: the pipeline sees them on that first run (a preview's). */
    labels?: string[];
  }): string;
  /** The open PR from this branch, if there is one. */
  pullRequestFor(fullName: string, head: string): string | undefined;
  /** A PR's description, by its link. */
  pullRequestBody(url: string): string;
  setPullRequestBody(url: string, body: string): void;
}

// ---------------------------------------------------------------- GitHub via the gh CLI

function gh(args: string[], cwd?: string): string {
  const r = ghRun(args, { cwd });
  if (r.code !== 0)
    throw new ShipError(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export const githubProvider: SourceControlProvider = {
  id: "github",
  whoami() {
    const r = ghRun(["api", "-i", "user"]);
    if (r.code !== 0) return undefined;
    const scopes =
      /x-oauth-scopes:\s*(.*)/i
        .exec(r.stdout)?.[1]
        ?.split(",")
        .map((s) => s.trim()) ?? [];
    const login = /"login":\s*"([^"]+)"/.exec(r.stdout)?.[1] ?? "";
    return { login, scopes: scopes.filter(Boolean) };
  },
  repoState(fullName) {
    const repo = ghRun(["api", `repos/${fullName}`]);
    if (repo.code !== 0) return { exists: false, empty: true, secrets: [], variables: {} };
    const r = JSON.parse(repo.stdout) as {
      private: boolean;
      size: number;
      allow_merge_commit?: boolean;
      allow_squash_merge?: boolean;
      allow_rebase_merge?: boolean;
    };
    const branches = ghRun(["api", `repos/${fullName}/branches`, "--jq", "length"]);
    const secrets = ghRun([
      "api",
      `repos/${fullName}/actions/secrets?per_page=30`,
      "--paginate",
      "--jq",
      ".secrets[].name",
    ]);
    const vars = ghRun([
      "api",
      `repos/${fullName}/actions/variables?per_page=30`,
      "--paginate",
      "--jq",
      ".variables[] | [.name, .value] | @tsv",
    ]);
    return {
      exists: true,
      empty: branches.code === 0 && branches.stdout.trim() === "0",
      visibility: r.private ? "private" : "public",
      mergeCommitOnly:
        r.allow_merge_commit === undefined
          ? undefined
          : r.allow_merge_commit && !r.allow_squash_merge && !r.allow_rebase_merge,
      secrets: secrets.code === 0 ? secrets.stdout.split("\n").filter(Boolean) : [],
      variables: Object.fromEntries(
        vars.code === 0
          ? vars.stdout
              .split("\n")
              .filter(Boolean)
              .map((l) => l.split("\t") as [string, string])
          : [],
      ),
    };
  },
  setVariable(fullName, name, value) {
    gh(["variable", "set", name, "--repo", fullName, "--body", value]);
  },
  deleteVariable(fullName, name) {
    const r = ghRun(["variable", "delete", name, "--repo", fullName]);
    if (r.code !== 0 && !/not found|404/i.test(r.stderr))
      throw new ShipError(`Could not delete variable ${name}: ${r.stderr.trim()}`);
  },
  createRepo(fullName, visibility, description) {
    gh(["repo", "create", fullName, `--${visibility}`, "--description", description]);
  },
  configureSettings(fullName, staging) {
    const merge = staging
      ? [
          "allow_merge_commit=true",
          "allow_squash_merge=false",
          "allow_rebase_merge=false",
          "delete_branch_on_merge=false",
        ]
      : [
          "allow_merge_commit=true",
          "allow_squash_merge=true",
          "allow_rebase_merge=false",
          "delete_branch_on_merge=true",
        ];
    gh(["api", "-X", "PATCH", `repos/${fullName}`, ...merge.flatMap((f) => ["-F", f])]);
  },
  setSecret(fullName, name, value) {
    const r = ghRun(["secret", "set", name, "--repo", fullName], { input: value });
    if (r.code !== 0) throw new ShipError(`Could not set secret ${name}: ${r.stderr.trim()}`);
  },
  deleteSecret(fullName, name) {
    const r = ghRun(["secret", "delete", name, "--repo", fullName]);
    if (r.code !== 0 && !/not found|404/i.test(r.stderr))
      throw new ShipError(`Could not delete secret ${name}: ${r.stderr.trim()}`);
  },
  createBranch(fullName, branch, from) {
    if (ghRun(["api", `repos/${fullName}/git/ref/heads/${branch}`]).code === 0) return;
    const sha = gh([
      "api",
      `repos/${fullName}/git/ref/heads/${from}`,
      "--jq",
      ".object.sha",
    ]).trim();
    gh([
      "api",
      "-X",
      "POST",
      `repos/${fullName}/git/refs`,
      "-f",
      `ref=refs/heads/${branch}`,
      "-f",
      `sha=${sha}`,
    ]);
  },
  openPullRequest({ cwd, base, head, title, body, labels = [] }) {
    return gh(
      [
        "pr",
        "create",
        "--base",
        base,
        "--head",
        head,
        "--title",
        title,
        "--body",
        body,
        ...labels.flatMap((l) => ["--label", l]),
      ],
      cwd,
    ).trim();
  },
  pullRequestFor(fullName, head) {
    const url = gh([
      "pr",
      "list",
      "-R",
      fullName,
      "--head",
      head,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url // empty",
    ]).trim();
    return url || undefined;
  },
  pullRequestBody(url) {
    return gh(["api", prApi(url), "--jq", '.body // ""']).replace(/\n$/, "");
  },
  setPullRequestBody(url, body) {
    gh(["api", "-X", "PATCH", prApi(url), "-f", `body=${body}`]);
  },
};

/** repos/<owner>/<repo>/pulls/<n> for a PR's link. */
function prApi(url: string): string {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) throw new ShipError(`Not a PR link: ${url}`);
  return `repos/${m[1]}/pulls/${m[2]}`;
}

// ---------------------------------------------------------------- Mocks for tests and dry runs

export const mockCalls: string[] = [];
// Open mock PRs by branch, in a file when SHIPIFY_MOCK_PRS names one (each ship call is a process).
const mockPrs = {
  file: process.env.SHIPIFY_MOCK_PRS,
  mem: new Set<string>(),
  has(head: string) {
    return this.file && existsSync(this.file)
      ? readFileSync(this.file, "utf8").split("\n").includes(head)
      : this.mem.has(head);
  },
  add(head: string) {
    if (this.file) appendFileSync(this.file, `${head}\n`);
    else this.mem.add(head);
  },
  // The mock PR's description (there's one mock PR link), beside the list.
  memBody: "",
  body() {
    const f = this.file && `${this.file}.body`;
    return f && existsSync(f) ? readFileSync(f, "utf8") : this.memBody;
  },
  setBody(body: string) {
    if (this.file) writeFileSync(`${this.file}.body`, body);
    else this.memBody = body;
  },
};

/** In-memory repo for tests. SHIPIFY_MOCK_REPO=ready starts it fully prepared. */
const emptyRepo = (): RepoState => ({ exists: false, empty: true, secrets: [], variables: {} });
const mockRepo: RepoState =
  process.env.SHIPIFY_MOCK_REPO === "ready"
    ? {
        exists: true,
        empty: true,
        visibility: "private",
        mergeCommitOnly: true,
        secrets: ["DEPLOY_TOKEN"],
        variables: { ACCOUNT_ID: "mock-account" },
      }
    : emptyRepo();

/**
 * One write the mock made, as its log keeps it: a variable with its value, a secret with only a
 * hash of its value (the log never holds a key).
 */
export interface MockCall {
  call: string;
  repo: string;
  name?: string;
  value?: string;
  sha?: string;
}

const mockLog = () => process.env.SHIPIFY_MOCK_CALLS;

function mockWrite(c: MockCall, change: (r: RepoState) => void): void {
  mockCalls.push([c.call, c.repo, c.name ?? c.value].filter(Boolean).join(" "));
  const log = mockLog();
  if (log) appendFileSync(log, `${JSON.stringify(c)}\n`);
  else change(mockRepo);
}

/** The mock's writes so far, from its log: each ship process adds to it, and reads it back. */
export function mockCallsLogged(log = mockLog()): MockCall[] {
  if (!log || !existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as MockCall);
}

/** A repo as the mock knows it: what it starts as, and with a log, that repo's writes in it. */
function mockState(fullName: string): RepoState {
  const r = structuredClone(mockRepo);
  for (const c of mockCallsLogged().filter((x) => x.repo === fullName)) {
    if (c.call === "createRepo")
      Object.assign(r, { exists: true, empty: true, visibility: c.value });
    if (c.call === "configureSettings") r.mergeCommitOnly = true;
    if (c.call === "setSecret" && c.name && !r.secrets.includes(c.name)) r.secrets.push(c.name);
    if (c.call === "deleteSecret") r.secrets = r.secrets.filter((x) => x !== c.name);
    if (c.call === "setVariable" && c.name) r.variables[c.name] = c.value ?? "";
    if (c.call === "deleteVariable" && c.name) delete r.variables[c.name];
  }
  return r;
}

const hash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 12);

export const mockSourceControl: SourceControlProvider = {
  id: "mock-github",
  whoami: () => ({ login: "mock-user", scopes: [] }),
  repoState: (n) => mockState(n),
  createRepo: (n, visibility) =>
    mockWrite({ call: "createRepo", repo: n, value: visibility }, (r) =>
      Object.assign(r, { exists: true, empty: true, visibility }),
    ),
  configureSettings: (n) =>
    mockWrite({ call: "configureSettings", repo: n }, (r) =>
      Object.assign(r, { mergeCommitOnly: true }),
    ),
  setVariable: (n, k, v) =>
    mockWrite({ call: "setVariable", repo: n, name: k, value: v }, (r) => {
      r.variables[k] = v;
    }),
  deleteVariable: (n, k) =>
    mockWrite({ call: "deleteVariable", repo: n, name: k }, (r) => {
      delete r.variables[k];
    }),
  setSecret: (n, k, v) =>
    mockWrite({ call: "setSecret", repo: n, name: k, sha: hash(v) }, (r) => {
      r.secrets.push(k);
    }),
  deleteSecret: (n, k) =>
    mockWrite({ call: "deleteSecret", repo: n, name: k }, (r) => {
      r.secrets = r.secrets.filter((x) => x !== k);
    }),
  createBranch: (n, b) => mockWrite({ call: "createBranch", repo: n, value: b }, () => {}),
  openPullRequest: ({ head, base, body, labels }) => {
    mockCalls.push(
      `openPullRequest ${head}->${base}${labels?.length ? ` [${labels.join(",")}]` : ""}`,
    );
    mockPrs.add(head);
    mockPrs.setBody(body);
    // The labels it opened with, beside the list (a test reads them).
    if (mockPrs.file && labels?.length) writeFileSync(`${mockPrs.file}.labels`, labels.join("\n"));
    return "https://github.com/mock/shipify/pull/1";
  },
  pullRequestFor: (_n, head) =>
    mockPrs.has(head) ? "https://github.com/mock/shipify/pull/1" : undefined,
  pullRequestBody: () => mockPrs.body(),
  setPullRequestBody: (url, body) => {
    mockCalls.push(`setPullRequestBody ${url}`);
    mockPrs.setBody(body);
  },
};

export const useMocks = () => process.env.SHIPIFY_PROVIDER === "mock";
export const sourceControl = (): SourceControlProvider =>
  useMocks() ? mockSourceControl : githubProvider;
