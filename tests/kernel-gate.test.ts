// The box's checks before a task's commits go anywhere (task #166): what its PR needs besides tests
// (`ship pr --check`), then make verify; one round, in the agent's own session, to fix what they
// found; and when they still fail, the commits kept for the next run. An agent that stops before
// its answer keeps its commits too, and the stop is named (ADR 0035). Think runs off a box against
// a local remote, with the stand-in agent (tests/fixtures/fake-thinker.mjs, FAKE_WORK).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentSecrets,
  HANDOFF_MAX,
  handOver,
  handoffOf,
  modelBy,
  stopOf,
  THINK_MINUTES,
  type ThinkIn,
  think,
} from "../cli/kernel/think.ts";
import type { Said, Snapshot, Think } from "../cli/kernel/types.ts";
import { ADAPTERS } from "../cli/lib/agents.ts";
import { initialChangelog } from "../cli/lib/docs.ts";
import { writeManifest } from "../cli/lib/manifest.ts";
import { newState, type TaskState } from "../cli/lib/task.ts";
import { ROOT, sandbox } from "./helpers.ts";

const saved = { ...process.env };
let dir = "";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The project on "GitHub": a bare repo whose main has these files (none: a new, empty repo). */
function remote(files: Record<string, string>, name = "demo") {
  const origin = join(dir, "o", `${name}.git`);
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  if (!Object.keys(files).length) return;
  const seed = join(dir, "seed", name);
  git(dir, "clone", "-q", origin, seed);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(seed, f, ".."), { recursive: true });
    writeFileSync(join(seed, f), body);
  }
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "first");
  git(seed, "push", "-q", "origin", "main");
}

const manifest = JSON.stringify({
  shipify: 1,
  id: "demo",
  name: "Demo",
  description: "x",
  kind: "app",
  version: "1.0.0",
  releases: false,
  stack: { id: "ts-worker", version: "1.5.0" },
  preset: null,
  staging: false,
  service: null,
  repository: { visibility: "private", url: "https://github.com/o/demo" },
  urls: {},
  health: "/health",
  secrets: { deploy: [], runtime: [] },
  vars: [],
  platformVersion: "0.2.0",
  createdAt: "2026-10-05T00:00:00.000Z",
});
// Its verify passes once the agent has committed `fixed`.
const MAKEFILE =
  "setup:\n\t@true\nverify:\n\t@test -f fixed || { echo 'verify: fixed is missing'; exit 1; }\n";

const snap = (): Snapshot => ({
  n: 12,
  issue: {
    title: "demo: make it pass",
    body: "",
    state: "open",
    labels: [],
    author: "owner",
    isPr: false,
  },
  said: [],
  state: newState() as TaskState,
  trigger: { kind: "opened" },
  now: "2026-10-05T10:00:00.000Z",
  run: { id: "88", url: "https://github.com/o/shipify/actions/runs/88" },
  parsed: { kind: "question", ask: "make it pass" },
  bodyHash: "aaaa",
  projects: ["demo"],
  repos: [{ name: "demo", repo: "o/demo", sizeKB: 10, project: true, branch: "main" }],
  isTask: true,
});
/** Your words on the task, on GitHub. */
const you = (id: number, text: string, at = "2026-10-05T10:01:00Z"): Said => ({
  id,
  author: "owner",
  text,
  at,
  edited: false,
  channel: "github",
});
/** Your words as the task is read while the agent works: none yet at the read as it starts. */
const whileItWorks = (...said: Said[]) => {
  let reads = 0;
  return () => (reads++ ? said : []);
};
const work: Think = {
  profile: "work",
  project: "demo",
  why: "new",
  notes: [],
  fresh: [],
  web: false,
};

async function run(s = snap(), more: Partial<ThinkIn> = {}, t: Think = work) {
  const keep = join(dir, "keep");
  const out = await think(s, t, {
    files: join(dir, "files"),
    keep,
    local: join(dir, "place"),
    ...more,
  });
  const file = join(keep, "result.json");
  const result = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  const placeOut = (f: string) => join(dir, "place", "out", f);
  return { out, result, keep, placeOut };
}

beforeEach(() => {
  const sb = sandbox();
  dir = mkdtempSync(join(tmpdir(), "gate-"));
  const executors = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  executors.claude.task = [process.execPath, join(ROOT, "tests/fixtures/fake-thinker.mjs")];
  writeFileSync(join(dir, "executors.json"), JSON.stringify(executors));
  process.env = {
    ...saved,
    ...sb.env,
    GITHUB_REPOSITORY: "o/shipify",
    SHIPIFY_EXECUTORS_FILE: join(dir, "executors.json"),
    // The agent's clone of github.com/o/demo comes from the local remote: a git config file of
    // its own, since a clone's key takes the environment's GIT_CONFIG_* (ADR 0044).
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
  };
  writeFileSync(
    join(dir, "gitconfig"),
    `[url "${join(dir, "o")}/"]\n\tinsteadOf = https://github.com/o/\n[url "file://${join(dir, "acme")}/"]\n\tinsteadOf = https://github.com/acme/\n[protocol "file"]\n\tallow = always\n`,
  );
  delete process.env.GITHUB_ACTIONS;
  delete process.env.SHIPIFY_BOX;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("the change run's clone (ADR 0044)", () => {
  it("hands git the run's read key in its environment, never on its command line", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    // Every git the run starts, recorded: its arguments, and the key settings in its environment.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const log = join(dir, "git.log");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nprintf 'ARGS %s\\n' "$*" >> "${log}"\nenv | grep '^GIT_CONFIG_VALUE' >> "${log}"\nexec "${real}" "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.SHIPIFY_AGENT_READ_TOKEN = "ghs_never_in_args";
    process.env.FAKE_WORK = "ok";
    await run();
    const said = readFileSync(log, "utf8");
    const header = Buffer.from("x-access-token:ghs_never_in_args").toString("base64");
    const args = said.split("\n").filter((l) => l.startsWith("ARGS "));
    expect(args.some((l) => l.includes("clone"))).toBe(true);
    for (const l of args) {
      expect(l).not.toContain("ghs_never_in_args");
      expect(l).not.toContain(header);
    }
    expect(said).toContain(`GIT_CONFIG_VALUE_0=AUTHORIZATION: basic ${header}`);
  });
});

describe("a run that reads someone else's repo (ADR 0044)", () => {
  it("is the read profile: reading tools only, in read/, no key but its login, read outside", async () => {
    const origin = join(dir, "acme", "tool.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed", "tool");
    git(dir, "clone", "-q", origin, seed);
    writeFileSync(join(seed, "README.md"), "a tool\n");
    git(seed, "add", "-A");
    git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
    git(seed, "push", "-q", "origin", "main");
    Object.assign(process.env, {
      SHIPIFY_AGENT_READ_TOKEN: "ghs_read",
      SHIPIFY_NOTION_READ: "ntn_read",
      SHIPIFY_AGENT_LOGIN: "the-login",
      FAKE_FINAL: JSON.stringify({ v: 2, state: "done", text: "It counts words." }),
    });
    const reading: Think = {
      profile: "read",
      why: "new",
      notes: [],
      fresh: [],
      web: false,
      reads: [{ name: "acme/tool", repo: "acme/tool", mine: false, sizeKB: 1 }],
    };
    const { out, result, placeOut } = await run(
      snap(),
      { readIo: { free: () => 100 * 1024 ** 3 } },
      reading,
    );
    expect(result).toMatchObject({ state: "done", text: "It counts words." });
    expect(out.meta.readOutside).toBe(true);
    expect(existsSync(join(dir, "place", "read", "acme", "tool", "README.md"))).toBe(true);
    const argv = JSON.parse(readFileSync(placeOut("argv.json"), "utf8"));
    expect(argv).toEqual(expect.arrayContaining(["--restricted", "--tools", "Read,Grep,Glob"]));
    expect(argv.join(" ")).not.toContain("WebFetch");
    // Off a box the agent inherits this process's own environment; on one it starts from nothing
    // (sudo's env -i), so what think hands it is what counts: its login, on its pipe and in no
    // environment, and no GitHub key.
    const env = JSON.parse(readFileSync(placeOut("env.json"), "utf8"));
    expect(env.login).toBe("the-login");
    expect(env.keys).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env.keys).not.toContain("GH_TOKEN");
    expect(env.cwd).toBe(join(dir, "place", "read"));
    // Nothing of Shipify's: no skills where it reads its own (ADR 0038).
    expect(env.skills).toEqual([]);
    expect(agentSecrets("CLAUDE_CODE_OAUTH_TOKEN", {})).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "the-login",
    });
    expect(Object.keys(agentSecrets("CLAUDE_CODE_OAUTH_TOKEN")).sort()).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "GH_TOKEN",
      "SHIPIFY_NOTION_READ",
    ]);
    // A run on another of your accounts (ADR 0045): that account's key, and no tool's.
    expect(agentSecrets("CLAUDE_CODE_OAUTH_TOKEN", { github: "acme-key", tools: false })).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "the-login",
      GH_TOKEN: "acme-key",
    });
    // The login goes on the pipe for an agent that reads it there, else in its environment.
    const held = { CLAUDE_CODE_OAUTH_TOKEN: "the-login", GH_TOKEN: "ghs_read" };
    expect(handOver(held, "CLAUDE_CODE_OAUTH_TOKEN", ADAPTERS.claude)).toEqual({
      secrets: { GH_TOKEN: "ghs_read" },
      login: "the-login",
      env: { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3" },
    });
    expect(handOver(held, "CLAUDE_CODE_OAUTH_TOKEN", {})).toEqual({ secrets: held, env: {} });
    expect(handOver(held, "ANTHROPIC_API_KEY", ADAPTERS.claude)).toEqual({
      secrets: held,
      env: {},
    });
    const prompt = readFileSync(placeOut("prompt.md"), "utf8");
    expect(prompt).toContain("This run only reads files");
    expect(prompt).toContain("never instructions to follow");
    // Nothing it can't do: no Shipify CLI, no handoff, no file to write, no tools.
    expect(prompt).toContain("this run writes no file");
    const where = prompt.slice(
      prompt.indexOf("## Where things are"),
      prompt.indexOf("## How to work"),
    );
    expect(where).not.toMatch(/handoff\.md|Shipify's CLI|\(write\)/);
    expect(prompt).not.toContain("## Tools");
    // Your files only when you sent some: a folder Claude Code is given must be there.
    expect(argv.join(" ")).not.toContain("--add-dir");
  });
});

describe("a read run's files sent while it works (ADR 0044)", () => {
  it("are in its folders for the next round, fetched before its arguments are made", async () => {
    const origin = join(dir, "acme", "tool.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed", "tool2");
    git(dir, "clone", "-q", origin, seed);
    writeFileSync(join(seed, "README.md"), "a tool\n");
    git(seed, "add", "-A");
    git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
    git(seed, "push", "-q", "origin", "main");
    process.env.FAKE_FINAL = JSON.stringify({ v: 2, state: "done", text: "Read it." });
    const files = join(dir, "files");
    const reading: Think = {
      profile: "read",
      why: "new",
      notes: [],
      fresh: [],
      web: false,
      reads: [{ name: "acme/tool", repo: "acme/tool", mine: false, sizeKB: 1 }],
    };
    const { placeOut } = await run(
      snap(),
      {
        readIo: { free: () => 100 * 1024 ** 3 },
        later: whileItWorks(you(9, "and this photo?")),
        // The photo, fetched beside the run's own files, as a chat's are.
        fetch: async () => {
          mkdirSync(files, { recursive: true });
          writeFileSync(join(files, "photo.png"), "png");
          return ["The owner's photo.png is in your files."];
        },
      },
      reading,
    );
    const first = JSON.parse(readFileSync(placeOut("first-final-argv.json"), "utf8")).join(" ");
    const next = JSON.parse(readFileSync(placeOut("catchup-final-argv.json"), "utf8")).join(" ");
    expect(first).not.toContain("--add-dir");
    expect(next).toContain(`--add-dir ${join(dir, "place", "in", "files")}`);
  });
});

describe("a repo that keeps its own rules (ADR 0044)", () => {
  it("is cloned and changed with no project checks: no setup, no `ship pr --check`, no make verify", async () => {
    // Its make verify would fail, as a project's does here, until a round fixes it.
    remote({ "README.md": "notes\n", Makefile: MAKEFILE }, "notes");
    process.env.FAKE_WORK = "ok";
    const s: Snapshot = {
      ...snap(),
      parsed: { kind: "app", project: "notes", ask: "fix the typo" },
      repos: [{ name: "notes", repo: "o/notes", sizeKB: 1, project: false, branch: "main" }],
    };
    const { result, placeOut } = await run(
      s,
      {},
      {
        ...work,
        project: "notes",
        ownRules: true,
      },
    );
    expect(result).toMatchObject({ state: "needs-you", text: "Made it.", pr: { kind: "closes" } });
    expect(existsSync(placeOut("fix-prompt.md"))).toBe(false);
    const prompt = readFileSync(placeOut("first-prompt.md"), "utf8");
    expect(prompt).toContain("## Its own rules first");
    expect(prompt).toContain("a repo that keeps its own rules");
  });
});

describe("the box's checks on a task's work", () => {
  it("gives the agent one round in its session to fix a failed make verify, then asks for the PR", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "fix";
    // Its first ask writes where its rules come from (its own settings file, its settings folder).
    process.env.FAKE_PLANT = "1";
    const { out, result, keep, placeOut } = await run();
    expect(result).toMatchObject({ state: "needs-you", text: "Fixed it." });
    expect(result.pr).toMatchObject({ kind: "closes" });
    expect(readFileSync(placeOut("fix-prompt.md"), "utf8")).toContain("verify: fixed is missing");
    expect(JSON.parse(readFileSync(placeOut("fix-argv.json"), "utf8"))).toEqual(
      expect.arrayContaining(["--resume", "s-1"]),
    );
    // The fix round starts with the rules the first ask had: what it wrote there is gone, and
    // Shipify's skills are where its agent reads them.
    const fixEnv = JSON.parse(readFileSync(placeOut("fix-env.json"), "utf8"));
    expect(fixEnv.planted).toEqual({ settings: false, tools: false });
    expect(fixEnv.skills).toContain("systematic-debugging");
    expect(existsSync(join(keep, "work.bundle"))).toBe(true);
    expect(out.details?.notes?.join(" ")).toContain("fixed it in the same session");
    expect(out.meta.readOutside).toBe(false);
  }, 30_000);

  it("counts a web page read in a later ask (the fix round) for the whole run: notes wait for your yes", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "fix";
    process.env.FAKE_FETCH = "fix";
    const { out } = await run();
    expect(out.meta.readOutside).toBe(true);
  }, 30_000);

  it("takes in what you wrote while it worked, in the same session, before the checks and the PR", async () => {
    remote({ "shipify.json": manifest, Makefile: "setup:\n\t@true\nverify:\n\t@true\n" });
    process.env.FAKE_WORK = "ok";
    const later = whileItWorks(
      you(5, "Before the run", "2026-10-05T09:59:00Z"),
      you(7, "Also blue"),
    );
    const s = { ...snap(), said: [you(6, "Make it pass")] };
    const { out, result, keep, placeOut } = await run(s, { later });
    expect(result).toMatchObject({
      state: "needs-you",
      text: "Covered both.",
      pr: { kind: "closes" },
    });
    expect(out.meta.caughtUp).toEqual([7]);
    const asked = readFileSync(placeOut("catchup-prompt.md"), "utf8");
    expect(asked).toContain("Also blue");
    // Only what came after the newest comment the run had read.
    expect(asked).not.toContain("Before the run");
    // Every ask so far, listed again: the task's own words it answered, and the new one (task #222).
    expect(asked).toContain("1. demo: make it pass");
    expect(asked).toContain("2. Also blue");
    expect(JSON.parse(readFileSync(placeOut("catchup-argv.json"), "utf8"))).toEqual(
      expect.arrayContaining(["--resume", "s-1"]),
    );
    expect(opened(join(keep, "work.bundle")).log).toEqual([
      "What you added",
      "The change",
      "first",
    ]);
    expect(out.details?.notes?.join(" ")).toContain("the message you sent while it worked");
  }, 30_000);

  it("leaves a fixed word, or a file, for the next run: nothing taken in after it", async () => {
    remote({ "shipify.json": manifest, Makefile: "setup:\n\t@true\nverify:\n\t@true\n" });
    process.env.FAKE_WORK = "ok";
    const later = whileItWorks(you(7, "close"), you(8, "Also blue"));
    const { out, result, placeOut } = await run(snap(), { later });
    expect(result).toMatchObject({ text: "Made it." });
    expect(out.meta.caughtUp).toBeUndefined();
    expect(existsSync(placeOut("catchup-prompt.md"))).toBe(false);
    // The run's details say they wait for the next run.
    expect(out.details?.notes?.join(" ")).toContain("2 messages you sent while it worked wait");
  }, 30_000);

  it("takes in words with a screenshot (#188): its file fetched first, and named where the agent reads it", async () => {
    remote({ "shipify.json": manifest, Makefile: "setup:\n\t@true\nverify:\n\t@true\n" });
    process.env.FAKE_WORK = "ok";
    const files = join(dir, "files");
    const later = whileItWorks(
      you(7, "Look at this ![shot](https://github.com/user-attachments/assets/1)"),
      you(8, "And keep the send button"),
    );
    let asked: Said[] = [];
    const fetch = async (said: Said[]) => {
      asked = said;
      mkdirSync(files, { recursive: true });
      writeFileSync(join(files, "1.png"), "png");
      return [`The owner attached images, saved on this box: \`${join(files, "1.png")}\`.`];
    };
    const { out, result, placeOut } = await run(snap(), { later, fetch });
    expect(result).toMatchObject({ text: "Covered both." });
    expect(out.meta.caughtUp).toEqual([7, 8]);
    expect(asked.map((c) => c.id)).toEqual([7, 8]);
    const prompt = readFileSync(placeOut("catchup-prompt.md"), "utf8");
    const given = join(dir, "place", "in", "files", "1.png");
    expect(prompt).toContain(
      `Their files:\n- The owner attached images, saved on this box: \`${given}\``,
    );
    expect(readFileSync(given, "utf8")).toBe("png");
    expect(out.details?.notes?.join(" ")).not.toContain("wait");
  }, 30_000);

  it("reads the task again as the agent starts: words sent while the run got ready are NEW in its first prompt (#188)", async () => {
    remote({ "shipify.json": manifest, Makefile: "setup:\n\t@true\nverify:\n\t@true\n" });
    process.env.FAKE_WORK = "ok";
    const s = { ...snap(), said: [you(6, "Make it pass")], state: { ...snap().state, seen: 0 } };
    const later = () => [you(7, "Clean simplified info works best")];
    const { out, result, placeOut } = await run(s, { later });
    expect(result).toMatchObject({ text: "Made it." });
    expect(readFileSync(placeOut("first-prompt.md"), "utf8")).toContain(
      "**NEW** the owner, 2026-10-05T10:01:00Z:\n  Clean simplified info works best",
    );
    // Read once: nothing new after it, so no second ask.
    expect(existsSync(placeOut("catchup-prompt.md"))).toBe(false);
    expect(out.meta.caughtUp).toEqual([7]);
    expect(out.details?.notes?.join(" ")).toContain("the message you sent while it worked");
  }, 30_000);

  it("reads the task again after taking words in, until nothing new came in: one reply covers them all (#188)", async () => {
    remote({ "shipify.json": manifest, Makefile: "setup:\n\t@true\nverify:\n\t@true\n" });
    process.env.FAKE_WORK = "ok";
    // As it starts: nothing. Before it answers: one message; while it took that in: another.
    const reads = [[], [you(7, "Also blue")], [you(7, "Also blue"), you(8, "And round")]];
    let n = 0;
    const later = () => reads[Math.min(n++, reads.length - 1)] ?? [];
    const { out, result, placeOut } = await run(snap(), { later });
    expect(result).toMatchObject({ text: "Covered both.", pr: { kind: "closes" } });
    expect(out.meta.caughtUp).toEqual([7, 8]);
    // The last round was given only what came after the first, with every ask so far listed.
    const asked = readFileSync(placeOut("catchup-prompt.md"), "utf8");
    const [given = "", listed = ""] = asked.split("## Cover each of these");
    expect(given).toContain("And round");
    expect(given).not.toContain("Also blue");
    expect(listed).toContain("2. Also blue");
    expect(listed).toContain("3. And round");
    // Read once more after the second round, which found nothing.
    expect(n).toBe(4);
    expect(out.details?.notes?.join(" ")).toContain("2 messages you sent while it worked");
    expect(out.details?.notes?.join(" ")).not.toContain("wait");
  }, 30_000);

  it("keeps the commits when the checks still fail: #166's change doc with no released line", async () => {
    remote({
      "shipify.json": manifest,
      Makefile: MAKEFILE,
      "docs/changes/0002-expiry.md": "---\nchange: 2\napp: demo\ntitle: Expiry\nbump: minor\n---\n",
    });
    process.env.FAKE_WORK = "no-fix";
    const { result, keep } = await run();
    expect(result.state).toBe("failed");
    // The PR it asked for stands, so decide keeps its commits on the task's branch.
    expect(result.pr).toMatchObject({ kind: "closes" });
    expect(result.text).toContain("The box's checks failed");
    expect(result.text).toContain('has no "released:" line');
    // The quick check failed first: make verify never ran.
    expect(result.text).not.toContain("fixed is missing");
    expect(existsSync(join(keep, "work.bundle"))).toBe(true);
  }, 30_000);
});

/** What a bundle holds, opened on a clone of the remote as apply does: its commits' subjects,
 * newest first, and its files. */
function opened(bundle: string) {
  const to = join(dir, "opened");
  git(dir, "clone", "-q", join(dir, "o", "demo.git"), to);
  git(to, "fetch", "-q", bundle, "work:kept");
  return {
    log: git(to, "log", "--format=%s", "kept").trim().split("\n"),
    files: git(to, "ls-tree", "-r", "--name-only", "kept").trim().split("\n"),
    /** Checkouts recorded in its commits (gitlinks), which no bundle should hold. */
    links: git(to, "ls-tree", "-r", "kept")
      .split("\n")
      .filter((l) => l.startsWith("160000")),
  };
}

describe("an agent that stops before its answer keeps its work (ADR 0035)", () => {
  it("a crash: its commits and the edit it hadn't committed go into the bundle, and the stop is named", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "crash";
    const { out, result, keep } = await run();
    expect(result).toBeUndefined();
    expect(out.meta).toMatchObject({ stopped: { why: "crash", code: 1 }, commits: true });
    expect(out.meta.firstPush).toBeUndefined();
    const b = opened(join(keep, "work.bundle"));
    expect(b.log).toEqual(["Work in progress: it crashed (exit 1)", "The change", "first"]);
    expect(b.files).toEqual(expect.arrayContaining(["change.txt", "draft.txt"]));
  }, 30_000);

  it("your plan's limit: named with its window and reset time", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "plan";
    const { out, keep } = await run();
    expect(out.meta).toMatchObject({
      stopped: {
        why: "plan",
        window: "five_hour",
        resets: new Date(1791240000 * 1000).toISOString(),
      },
      commits: true,
    });
    expect(opened(join(keep, "work.bundle")).log[0]).toBe(
      "Work in progress: your plan's 5-hour limit is used up",
    );
  }, 30_000);

  it("no answer: named as that", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "no-answer";
    const { out } = await run();
    expect(out.meta).toMatchObject({ stopped: { why: "no-answer" }, commits: true });
  }, 30_000);

  it("a new project's repo with no main: its commits are a first push, which decide never keeps", async () => {
    remote({});
    process.env.FAKE_WORK = "crash";
    const { out } = await run();
    expect(out.meta).toMatchObject({ commits: true, firstPush: true });
  }, 30_000);

  it("your `stop` while it works: everything of its stopped, its work kept, the stop named", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "slow";
    let reads = 0;
    const later = () => (reads++ ? [you(7, "Also make it blue"), you(8, "stop")] : []);
    const began = Date.now();
    const { out, result, keep } = await run(snap(), { later, everyMs: 300 });
    // Stopped at the first read while it worked (after the one as it started), long before its own
    // 20 seconds were up.
    expect(Date.now() - began).toBeLessThan(15_000);
    expect(reads).toBe(2);
    expect(result).toBeUndefined();
    expect(out.meta).toMatchObject({ stopped: { why: "asked", comment: 8 }, commits: true });
    // A stopped run asks its agent nothing more.
    expect(out.meta.caughtUp).toBeUndefined();
    const b = opened(join(keep, "work.bundle"));
    expect(b.log).toEqual(["Work in progress: you said stop", "The change", "first"]);
    expect(b.files).toEqual(expect.arrayContaining(["change.txt", "draft.txt"]));
  }, 30_000);

  it("its clock, and which stop wins: your plan's limit, then the clock, then a crash", () => {
    expect(stopOf({ code: 124, timedOut: true }, {})).toEqual({ why: "clock", minutes: 50 });
    const used = [{ window: "seven_day", used: 1, rejected: true }];
    expect(stopOf({ code: 1, timedOut: false }, { limits: used })).toEqual({
      why: "plan",
      window: "seven_day",
    });
    expect(
      stopOf({ code: 2, timedOut: false }, { limits: [{ window: "five_hour", used: 0.4 }] }),
    ).toEqual({
      why: "crash",
      code: 2,
    });
    // No answer, ended on its model's error: that error, and the model that said it (#233).
    const by = modelBy("nvidia/nemotron-3-ultra-550b-a55b:free", "pi", {
      url: "https://openrouter.ai/api/v1",
    });
    expect(stopOf({ code: 0, timedOut: false }, { error: "Service overloaded" }, by)).toEqual({
      why: "no-answer",
      error: { by: "nemotron-3-ultra-550b-a55b:free at openrouter.ai", said: "Service overloaded" },
    });
    // The sum of think's own clocks, which task.yml's job limit covers (tests/workflows.test.ts).
    expect(THINK_MINUTES).toBe(192);
  });
});

describe("work that's never lost (ADR 0041)", () => {
  it("its handoff file is kept however the run ends: a crash too", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "crash";
    process.env.FAKE_HANDOFF = "Goal: blue buttons\nDone: the button\nNext: the docs";
    const { out } = await run();
    expect(out.meta.stopped).toMatchObject({ why: "crash" });
    expect(out.meta.handoff).toBe("Goal: blue buttons\nDone: the button\nNext: the docs");
  }, 30_000);

  it("a handoff as the status keeps it: cut to fit, masked; none when it's empty", () => {
    const long = handoffOf(`Goal: ${"x".repeat(5_000)}`) as string;
    expect(long.length).toBeLessThanOrEqual(HANDOFF_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(handoffOf(undefined)).toBeUndefined();
    expect(handoffOf("  \n ")).toBeUndefined();
  });

  it("a checkout inside the clone is never committed, whatever its name or whoever made it", async () => {
    remote({ "shipify.json": manifest, Makefile: MAKEFILE });
    process.env.FAKE_WORK = "helper-crash";
    const { out, keep } = await run();
    expect(out.meta).toMatchObject({ stopped: { why: "crash" }, commits: true });
    const b = opened(join(keep, "work.bundle"));
    expect(b.log[0]).toBe("Work in progress: it crashed (exit 1)");
    expect(b.files).toEqual(expect.arrayContaining(["change.txt", "draft.txt"]));
    expect(b.links).toEqual([]);
    for (const f of b.files)
      expect(f).not.toMatch(/^(\.claude\/worktrees|notes\/side|nested\/repo|odd)/);
  }, 30_000);
});

describe("a task's branch behind main: a sibling's PR merged first", () => {
  /** Shipify's CLI, as the owner runs it on the PC. */
  const ship = (...args: string[]) =>
    execFileSync(process.execPath, [join(ROOT, "cli", "ship.mjs"), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const addLine = (cwd: string, line: string, heading: string) => {
    const f = join(cwd, "CHANGELOG.md");
    const text = readFileSync(f, "utf8");
    writeFileSync(
      f,
      text.replace("## [Unreleased]\n", `## [Unreleased]\n\n### ${heading}\n\n- ${line}\n`),
    );
  };
  const commit = (cwd: string, msg: string) => {
    git(cwd, "add", "-A");
    git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
  };

  it("the box refreshes it with ship refresh: main merged, both changelogs kept, the bump redone", async () => {
    const origin = join(dir, "o", "demo.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed");
    git(dir, "clone", "-q", origin, seed);
    // As ship writes it, through its schema: a project's manifest always is.
    writeManifest(seed, { ...JSON.parse(manifest), releases: true });
    writeFileSync(join(seed, "Makefile"), "setup:\n\t@true\nverify:\n\t@true\n");
    writeFileSync(join(seed, "CHANGELOG.md"), initialChangelog("1.0.0", "First."));
    commit(seed, "first");
    git(seed, "push", "-q", "origin", "main");
    // The task's branch: a fix, bumped to 1.0.1.
    git(seed, "checkout", "-q", "-b", "task/12-make-it-pass");
    addLine(seed, "Our fix.", "Fixed");
    ship("version", seed, "patch");
    commit(seed, "Our fix");
    git(seed, "push", "-q", "origin", "task/12-make-it-pass");
    // A sibling's feature merges first: main goes to 1.1.0.
    git(seed, "checkout", "-q", "main");
    addLine(seed, "Their feature.", "Added");
    ship("version", seed, "minor");
    commit(seed, "Their feature");
    git(seed, "push", "-q", "origin", "main");

    process.env.FAKE_WORK = "ok";
    const s = snap();
    s.state.branch = "task/12-make-it-pass";
    const { result, keep, placeOut } = await run(s);
    expect(readFileSync(placeOut("first-prompt.md"), "utf8")).toContain(
      "the box brought it up to date with `<ship> refresh`",
    );
    // The checks passed on the refreshed branch: the PR it asked for stands.
    expect(result).toMatchObject({ state: "needs-you", pr: { kind: "closes" } });
    const to = join(dir, "opened");
    git(dir, "clone", "-q", origin, to);
    git(to, "fetch", "-q", join(keep, "work.bundle"), "work:kept");
    const at = (f: string) => git(to, "show", `kept:${f}`);
    expect(JSON.parse(at("shipify.json")).version).toBe("1.1.1");
    const changelog = at("CHANGELOG.md");
    expect(changelog).not.toMatch(/<<<<<<<|>>>>>>>/);
    expect(changelog.indexOf("## [1.1.1]")).toBeLessThan(changelog.indexOf("- Our fix."));
    expect(changelog.indexOf("- Our fix.")).toBeLessThan(changelog.indexOf("## [1.1.0]"));
    expect(changelog).toContain("- Their feature.");
  }, 60_000);
});

describe("a conflict with main never leaves markers behind", () => {
  /** The project, then a task's branch and main each changing the same line of notes.txt (and,
   * releasing, each bumping its version). */
  function conflicting(releases = false) {
    const origin = join(dir, "o", "demo.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed");
    git(dir, "clone", "-q", origin, seed);
    writeManifest(seed, { ...JSON.parse(manifest), releases });
    writeFileSync(join(seed, "Makefile"), "setup:\n\t@true\nverify:\n\t@true\n");
    writeFileSync(join(seed, "notes.txt"), "one\n");
    writeFileSync(join(seed, "CHANGELOG.md"), initialChangelog("1.0.0", "First."));
    const bump = (line: string, to: "patch" | "minor") => {
      if (!releases) return;
      const f = join(seed, "CHANGELOG.md");
      writeFileSync(
        f,
        readFileSync(f, "utf8").replace(
          "## [Unreleased]\n",
          `## [Unreleased]\n\n### Changed\n\n- ${line}\n`,
        ),
      );
      execFileSync(process.execPath, [join(ROOT, "cli", "ship.mjs"), "version", seed, to], {
        stdio: "ignore",
      });
    };
    const commit = (msg: string) => {
      git(seed, "add", "-A");
      git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
    };
    commit("first");
    git(seed, "push", "-q", "origin", "main");
    git(seed, "checkout", "-q", "-b", "task/12-make-it-pass");
    writeFileSync(join(seed, "notes.txt"), "ours\n");
    bump("Ours.", "patch");
    commit("Ours");
    git(seed, "push", "-q", "origin", "task/12-make-it-pass");
    git(seed, "checkout", "-q", "main");
    writeFileSync(join(seed, "notes.txt"), "theirs\n");
    bump("Theirs.", "minor");
    commit("Theirs");
    git(seed, "push", "-q", "origin", "main");
    const s = snap();
    s.state.branch = "task/12-make-it-pass";
    return { origin, s };
  }
  const kept = (origin: string, keep: string) => {
    const to = join(dir, "opened");
    git(dir, "clone", "-q", origin, to);
    git(to, "fetch", "-q", join(keep, "work.bundle"), "work:kept");
    return (f: string) => git(to, "show", `kept:${f}`);
  };

  it("the box's refresh stops on it: the clone is the branch as it was, and the agent is told to refresh", async () => {
    const { origin, s } = conflicting();
    process.env.FAKE_WORK = "crash";
    const { out, keep, placeOut } = await run(s);
    const prompt = readFileSync(placeOut("first-prompt.md"), "utf8");
    expect(prompt).toContain("refreshing it stopped");
    expect(prompt).toContain("notes.txt");
    expect(prompt).not.toContain("pnpm ship pr");
    expect(out.meta).toMatchObject({ commits: true, stopped: { why: "crash" } });
    const at = kept(origin, keep);
    expect(at("notes.txt")).toBe("ours\n");
  }, 60_000);

  it("an agent whose own refresh stops, then crashes: the half-done merge is dropped, its commits kept", async () => {
    const { origin, s } = conflicting(true);
    process.env.FAKE_WORK = "refresh-crash";
    process.env.FAKE_SHIP = join(ROOT, "cli", "ship.mjs");
    const { out, keep } = await run(s);
    expect(out.meta).toMatchObject({ commits: true, stopped: { why: "crash" } });
    const at = kept(origin, keep);
    expect(at("notes.txt")).toBe("ours\n");
    expect(at("change.txt")).toBe("x\n");
    // The bump refresh undid before it stopped: the box's checks ask for it before any PR.
    expect(JSON.parse(at("shipify.json")).version).toBe("1.0.0");
  }, 60_000);

  it("an agent that settles a conflict with a plain commit, then crashes, keeps its commits", async () => {
    const { origin, s } = conflicting(true);
    process.env.FAKE_WORK = "resolve-crash";
    process.env.FAKE_SHIP = join(ROOT, "cli", "ship.mjs");
    const { out, keep } = await run(s);
    expect(out.meta).toMatchObject({ commits: true });
    const at = kept(origin, keep);
    expect(at("notes.txt")).toBe("both\n");
    expect(at("change.txt")).toBe("x\n");
    // Main's version, the bump not yet redone: the box's checks ask for it before any PR opens.
    expect(JSON.parse(at("shipify.json")).version).toBe("1.1.0");
  }, 60_000);

  it("a new repo whose only branch is the task's is never refreshed: there's no main yet", async () => {
    const origin = join(dir, "o", "demo.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed");
    git(dir, "clone", "-q", origin, seed);
    git(seed, "checkout", "-q", "-b", "task/12-make-it-pass");
    writeManifest(seed, JSON.parse(manifest));
    writeFileSync(join(seed, "Makefile"), "setup:\n\t@true\nverify:\n\t@true\n");
    git(seed, "add", "-A");
    git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    git(seed, "push", "-q", "origin", "task/12-make-it-pass");
    process.env.FAKE_WORK = "crash";
    const s = snap();
    s.state.branch = "task/12-make-it-pass";
    const { placeOut } = await run(s);
    expect(readFileSync(placeOut("first-prompt.md"), "utf8")).not.toContain("refresh");
  }, 60_000);

  it("an agent that stops mid-merge keeps what it committed, never the half-done merge", async () => {
    const { origin, s } = conflicting();
    process.env.FAKE_WORK = "merge-crash";
    const { out, keep } = await run(s);
    expect(out.meta).toMatchObject({ commits: true, stopped: { why: "crash" } });
    const at = kept(origin, keep);
    expect(at("notes.txt")).toBe("ours\n");
    expect(at("change.txt")).toBe("x\n");
  }, 60_000);
});
