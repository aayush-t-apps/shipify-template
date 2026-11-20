// An agent's new version checked on a box (ADR 0079): the pins a branch moves, read as data and
// held to main's install; the record its findings make; and think, with a stand-in agent that
// moves a pin and a stand-in new version (tests/fixtures/fake-checked.mjs), checking it with the
// login on fd 3, in a folder of the run's own, before the box's checks, and committing its record.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentRecord,
  decisionsOf,
  type Found,
  firstPrompt,
  formatted,
  pinsMoved,
  RECORDS,
  recordOf,
} from "../cli/kernel/agent-check.ts";
import { type ThinkIn, think } from "../cli/kernel/think.ts";
import type { Snapshot, Think } from "../cli/kernel/types.ts";
import { readExecutors } from "../cli/lib/agents.ts";
import { DECISIONS, type Executors } from "../cli/lib/plugins/agent.ts";
import { newState, type TaskState } from "../cli/lib/task.ts";
import { ROOT, sandbox } from "./helpers.ts";

const FAKE = join(ROOT, "tests/fixtures/fake-checked.mjs");
const main = (): Executors => readExecutors(join(ROOT, "executors.json")).executors;
const branchOf = (edit: (all: Record<string, { install: Record<string, unknown> }>) => void) => {
  const all = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  edit(all);
  return JSON.stringify(all);
};

describe("the pins a branch moves (ADR 0079)", () => {
  it("installs a moved pin with main's words, its version and its day changed, and nothing else", () => {
    const branch = branchOf((all) => {
      const i = all.pi?.install as { version: string; run: string[] };
      i.version = "1.0.3";
      i.run = i.run.map((w) =>
        w.startsWith("--before=")
          ? "--before=2026-11-10"
          : w.replace("@1.0.2", "@1.0.3").replace(/@\d+\.\d+\.\d+$/, (v) => v),
      );
    });
    const [moved] = pinsMoved(main(), branch);
    expect(moved).toMatchObject({ program: "pi", from: "1.0.2", to: "1.0.3" });
    expect(moved?.why).toBeUndefined();
    expect(moved?.run).toContain("--before=2026-11-10");
    expect(moved?.run).toContain("@earendil-works/pi-coding-agent@1.0.3");
    // The rest is main's, word for word.
    const words = main().pi?.install?.run ?? [];
    expect(moved?.run?.length).toBe(words.length);
  });

  it("checks none when no pin moved, or when the branch's file doesn't read", () => {
    expect(pinsMoved(main(), readFileSync(join(ROOT, "executors.json"), "utf8"))).toEqual([]);
    expect(pinsMoved(main(), "not json")).toEqual([]);
    expect(pinsMoved(main(), undefined)).toEqual([]);
    expect(pinsMoved(main(), `{"x":"${"a".repeat(70 * 1024)}"}`)).toEqual([]);
  });

  it("says why it can't install one whose install changes more than its version", () => {
    const moved = (edit: (i: { version: string; run: string[]; bin: string }) => void) =>
      pinsMoved(
        main(),
        branchOf((all) => {
          const i = all.claude?.install as { version: string; run: string[]; bin: string };
          i.run = i.run.map((w) => w.replace(`@${i.version}`, "@9.9.9"));
          i.version = "9.9.9";
          edit(i);
        }),
      )[0];
    expect(moved(() => {})?.run).toBeDefined();
    expect(moved((i) => i.run.push("--foreground-scripts"))?.why).toMatch(/change more than/);
    expect(moved((i) => i.run.push("evil@1.0.0"))?.run).toBeUndefined();
    expect(moved((i) => (i.bin = "bin/other"))?.why).toMatch(/`bin`/);
    // Its version in one place and not the other.
    expect(moved((i) => (i.run = i.run.map((w) => w.replace("@9.9.9", "@9.9.8"))))?.why).toMatch(
      /change more than/,
    );
    expect(moved((i) => (i.version = "latest"))?.why).toMatch(/isn't a plain one/);
    expect(moved((i) => (i.version = "latest"))?.to).toBeUndefined();
  });
});

/** What a check that went right finds; each test changes one thing. */
const words = {
  instructions: "w1",
  readme: "w2",
  files: "w3",
  config: "w4",
  elsewhere: "w5",
};
const seenAll = [
  ...DECISIONS.refused.map((command) => ({ command, refused: true })),
  ...DECISIONS.ran.map((command) => ({ command, refused: false })),
  ...DECISIONS.differ.map((command, i) => ({ command, refused: i < 2 })),
];
const found = (more: Partial<Found> = {}): Found => ({
  program: "claude",
  version: "2.1.326",
  day: "2026-11-17",
  task: 767,
  run: "https://github.com/o/shipify/actions/runs/1",
  installed: { ok: true, said: "2.1.326 (Claude Code)" },
  first: {
    version: "2.1.326",
    model: "claude-haiku-4-5-20251001",
    tokens: { input: 1, cacheRead: 0, cacheWrite: 0, output: 10 },
    offered: { tools: ["Bash", "Task"], helpers: ["general-purpose"], skills: ["a", "b"] },
    commands: seenAll,
    said: "The word is w1.",
  },
  read: { said: "README: w2\nnote: w3\nrefused\nrefused", offered: { tools: ["Read", "Glob"] } },
  loginIn: [],
  skills: ["a", "b"],
  skill: "a",
  words,
  argv: ["-p"],
  ...more,
});

describe("an agent's record (ADR 0079)", () => {
  it("passes each check when each went right, and holds fixed fields only", () => {
    const r = recordOf(found());
    expect(AgentRecord.parse(r)).toEqual(r);
    expect(Object.values(r.checks).every((o) => o?.ok)).toBe(true);
    expect(Object.keys(r.checks)).toEqual([
      "answers",
      "login",
      "skills",
      "instructions",
      "helpers",
      "decisions",
      "read",
    ]);
    expect(r).toMatchObject({
      on: "box",
      version: "2.1.326",
      task: 767,
      model: expect.any(String),
    });
    expect(r.refused).toEqual([...DECISIONS.refused, ...DECISIONS.differ.slice(0, 2)]);
    expect(r.read?.tools).toEqual(["Glob", "Read"]);
    expect(JSON.stringify(r)).not.toMatch(/w[1-5]/);
  });

  it("says why each check failed", () => {
    const failed = (f: Found, check: string) => recordOf(f).checks[check as "answers"];
    expect(recordOf(found({ installed: { ok: false, said: "npm error 404" } })).checks).toEqual({
      answers: { ok: false, why: "it didn't install: npm error 404" },
    });
    expect(failed(found({ installed: { ok: true, said: "2.1.300" } }), "answers")?.why).toMatch(
      /--version said 2.1.300/,
    );
    expect(failed(found({ loginIn: ["config/leak.txt"] }), "login")?.why).toBe(
      "its login was in config/leak.txt",
    );
    expect(failed(found({ loginIn: undefined }), "login")?.ok).toBe(false);
    const f = found();
    expect(failed({ ...f, skills: ["a", "b", "c"] }, "skills")?.why).toBe("it didn't list c");
    expect(failed({ ...f, first: { ...f.first, said: "no word" } }, "instructions")?.why).toMatch(
      /AGENTS\.md/,
    );
    expect(
      failed({ ...f, first: { ...f.first, offered: { tools: ["Bash"] } } }, "skills")?.why,
    ).toBe("it didn't load a");
    const ran = seenAll.map((c) => (c.command === "git push" ? { ...c, refused: false } : c));
    expect(failed({ ...f, first: { ...f.first, commands: ran } }, "decisions")?.why).toBe(
      "it ran `git push`",
    );
    expect(failed({ ...f, read: { said: "w2 w3 w4" } }, "read")?.why).toBe(
      "it read a file outside its folders",
    );
  });

  it("names a command it didn't try, and takes what it decided as it wrote it", () => {
    const d = decisionsOf(seenAll.filter((c) => c.command !== "git stash pop"));
    expect(d.untried).toEqual(["git stash pop"]);
    expect(decisionsOf([{ command: "  git push ", refused: true }]).refused).toEqual(["git push"]);
  });

  it("is written as the repo's formatter writes it", () => {
    const text = `${formatted(recordOf(found()))}\n`;
    const biome = spawnSync(
      join(ROOT, "node_modules", ".bin", "biome"),
      ["format", "--stdin-file-path=record.json"],
      { input: text, encoding: "utf8", cwd: ROOT },
    );
    expect(biome.status).toBe(0);
    expect(biome.stdout).toBe(text);
  });

  it("asks for each command of the one list, as written", () => {
    const p = firstPrompt("a");
    for (const c of [...DECISIONS.refused, ...DECISIONS.ran, ...DECISIONS.differ])
      expect(p).toContain(`   - \`${c}\``);
  });
});

// Think, off a box, against a local remote: Shipify's own repo, whose executors.json pins a
// stand-in for Claude Code, installed by the stand-in's own install.
const saved = { ...process.env };
let dir = "";
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const manifest = JSON.stringify({
  shipify: 1,
  id: "shipify",
  name: "Shipify",
  description: "x",
  kind: "app",
  version: "1.0.0",
  releases: false,
  stack: { id: "ts-worker", version: "1.5.0" },
  preset: null,
  staging: false,
  service: null,
  repository: { visibility: "private", url: "https://github.com/o/shipify" },
  urls: {},
  health: "/health",
  secrets: { deploy: [], runtime: [] },
  vars: [],
  platformVersion: "0.2.0",
  createdAt: "2026-10-05T00:00:00.000Z",
});

/** Its verify passes once the record of `version` is there; with `fixed`, once that's committed too. */
const makefile = (fixed = false) =>
  `setup:\n\t@true\nverify:\n\t@grep -q '"version": "1.0.1"' ${RECORDS}/claude.json || { echo 'verify: no record of 1.0.1'; exit 1; }\n${fixed ? "\t@test -f fixed || { echo 'verify: fixed is missing'; exit 1; }\n" : ""}`;

function remote(executors: string, makeFile: string) {
  const origin = join(dir, "o", "shipify.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const seed = join(dir, "seed");
  git(dir, "clone", "-q", origin, seed);
  for (const [f, body] of Object.entries({
    "shipify.json": manifest,
    Makefile: makeFile,
    "executors.json": executors,
    [`${RECORDS}/claude.json`]: readFileSync(join(ROOT, RECORDS, "claude.json"), "utf8"),
  })) {
    mkdirSync(join(seed, f, ".."), { recursive: true });
    writeFileSync(join(seed, f), body);
  }
  git(seed, "add", "-A");
  // Its own name: a box's hostname has no domain, so git makes up none (and on Node 26 the
  // sandbox's GIT_AUTHOR_* in a replaced process.env reach no child).
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
  git(seed, "push", "-q", "origin", "main");
}

const snap = (): Snapshot => ({
  n: 767,
  issue: {
    title: "shipify: update claude to 1.0.1",
    body: "",
    state: "open",
    labels: [],
    author: "owner",
    isPr: false,
  },
  said: [],
  state: newState() as TaskState,
  trigger: { kind: "opened" },
  now: "2026-11-17T10:00:00.000Z",
  run: { id: "99", url: "https://github.com/o/shipify/actions/runs/99" },
  parsed: { kind: "question", ask: "update claude to 1.0.1" },
  bodyHash: "aaaa",
  projects: [],
  repos: [{ name: "shipify", repo: "o/shipify", sizeKB: 10, project: false, branch: "main" }],
  isTask: true,
});
const work: Think = {
  profile: "work",
  project: "shipify",
  why: "new",
  notes: [],
  fresh: [],
  web: false,
};

let looked: string[] = [];
let advisories = "[]";
async function run(more: Partial<ThinkIn> = {}) {
  const keep = join(dir, "keep");
  const out = await think(snap(), work, {
    files: join(dir, "files"),
    keep,
    local: join(dir, "place"),
    look: async (url) => {
      looked.push(url);
      return advisories;
    },
    ...more,
  });
  const file = join(keep, "result.json");
  const result = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  const clone = join(dir, "place", "work");
  const record = (agent = "claude") => {
    const r = spawnSync("git", ["show", `work:${RECORDS}/${agent}.json`], {
      cwd: clone,
      encoding: "utf8",
    });
    return r.status === 0 ? JSON.parse(r.stdout) : undefined;
  };
  const asks = () => {
    const f = join(dir, "place", "check", "asks.jsonl");
    return existsSync(f)
      ? readFileSync(f, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
  };
  const log = git(clone, "log", "--format=%an|%s", "origin/main..work").trim().split("\n");
  return { out, result, record, asks, log, notes: out.details?.notes ?? [] };
}

/** The test's executors.json: Claude Code's install is the stand-in's, at 1.0.0. */
function executorsFile() {
  const all = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  all.claude.task = ["claude", "-p", "--permission-mode", "acceptEdits"];
  all.claude.install = {
    version: "1.0.0",
    dir: "claude-code",
    bin: "bin/claude",
    run: [process.execPath, FAKE, "install", "--prefix", "{prefix}", "claude-code@1.0.0"],
    advisories: "https://api.github.com/advisories?affects=claude-code%40{version}",
  };
  const text = `${JSON.stringify(all, null, 2)}\n`;
  writeFileSync(join(dir, "executors.json"), text);
  return text;
}

beforeEach(() => {
  const sb = sandbox();
  dir = mkdtempSync(join(tmpdir(), "agent-check-"));
  looked = [];
  advisories = "[]";
  // The run's own agent: `claude` on its PATH, the stand-in that works in its clone.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nexec '${process.execPath}' '${join(ROOT, "tests/fixtures/fake-thinker.mjs")}' "$@"\n`,
    { mode: 0o755 },
  );
  process.env = {
    ...saved,
    ...sb.env,
    PATH: `${bin}:${saved.PATH}`,
    GITHUB_REPOSITORY: "o/shipify",
    SHIPIFY_EXECUTORS_FILE: join(dir, "executors.json"),
    SHIPIFY_AGENT_LOGIN: "the-login",
    SHIPIFY_AGENT_READ_TOKEN: "ghs_read",
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    FAKE_WORK: "ok",
  };
  writeFileSync(
    join(dir, "gitconfig"),
    `[url "${join(dir, "o")}/"]\n\tinsteadOf = https://github.com/o/\n[protocol "file"]\n\tallow = always\n`,
  );
  delete process.env.GITHUB_ACTIONS;
  delete process.env.SHIPIFY_BOX;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("think checks an agent's new version (ADR 0079)", () => {
  it("installs a moved pin and asks it with the login on fd 3, before the box's checks, and commits its record", async () => {
    remote(executorsFile(), makefile());
    process.env.FAKE_PIN = JSON.stringify({ agent: "claude", version: "1.0.1" });
    const { result, record, asks, log, notes } = await run();
    // The box's checks passed on the record: it was there before them.
    expect(result).toMatchObject({ pr: { kind: "closes" } });
    expect(result.state).not.toBe("failed");
    const r = record();
    expect(r).toMatchObject({ agent: "claude", version: "1.0.1", on: "box", task: 767 });
    expect(r.run).toBe("https://github.com/o/shipify/actions/runs/99");
    expect(Object.entries(r.checks).filter(([, o]) => !(o as { ok: boolean }).ok)).toEqual([]);
    expect(r.argv).toEqual(expect.arrayContaining(["--model", "haiku", "Bash(git push:*)"]));
    expect(JSON.stringify(r)).not.toContain(dir);
    expect(log[0]).toMatch(/\|check: Claude Code 1\.0\.1, checked live \(task #767, https:/);
    expect(notes.join("\n")).toMatch(/checked Claude Code 1\.0\.1 live: every check passed/);
    // Its login on fd 3 alone, at each ask; its own HOME; no other key (off a box the test's own
    // environment reaches it too); the first listed model.
    expect(asks().map((a) => a.ask)).toEqual(["first", "read"]);
    for (const a of asks()) {
      expect(a).toMatchObject({ login: true, model: "haiku" });
      expect(a.keys).toContain("CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR");
      for (const k of ["GH_TOKEN", "SHIPIFY_LOOK_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"])
        expect(a.keys).not.toContain(k);
      expect(a.home).toBe(join(dir, "place", "check", "home"));
    }
    // Installed with no login in reach, into the run's own folder.
    const installed = JSON.parse(
      readFileSync(join(dir, "place", "check", "agent", "installed.json"), "utf8"),
    );
    // Its own HOME, in its install's folder, which the login's search leaves out.
    expect(installed.home).toBe(join(dir, "place", "check", "agent", ".home"));
    expect(installed.keys).not.toContain("GH_TOKEN");
    expect(installed.keys).not.toContain("CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR");
    // GitHub's advisories for the new version, read with no key.
    expect(looked).toEqual(["https://api.github.com/advisories?affects=claude-code%401.0.1"]);
  });

  it("checks nothing when no pin moved", async () => {
    remote(executorsFile(), "setup:\n\t@true\nverify:\n\t@true\n");
    const { result, asks, log } = await run();
    expect(result).toMatchObject({ pr: { kind: "closes" } });
    expect(asks()).toEqual([]);
    expect(log.some((l) => l.includes("|check:"))).toBe(false);
    expect(looked).toEqual([]);
  });

  it("puts main's record back for a pin it didn't check, and tells the agent why", async () => {
    remote(executorsFile(), makefile());
    // Its install gains a word, and the agent writes the record itself.
    process.env.FAKE_PIN = JSON.stringify({
      agent: "claude",
      version: "1.0.1",
      words: ["--foreground-scripts"],
    });
    process.env.FAKE_RECORD = "claude";
    const { result, record, asks, notes } = await run();
    expect(asks()).toEqual([]);
    expect(record()).toEqual(JSON.parse(readFileSync(join(ROOT, RECORDS, "claude.json"), "utf8")));
    expect(notes.join("\n")).toMatch(
      /didn't check Claude Code 1\.0\.1 live: its install's words change more than its version/,
    );
    // The tests then fail on it, and the fix round is told why.
    expect(result.state).toBe("failed");
    const fix = readFileSync(join(dir, "place", "out", "fix-prompt.md"), "utf8");
    expect(fix).toMatch(/^The box didn't check Claude Code 1\.0\.1 live/);
    expect(fix).toMatch(/Never write the record yourself/);
  });

  it("checks only the agent the run thinks with", async () => {
    remote(executorsFile(), "setup:\n\t@true\nverify:\n\t@true\n");
    process.env.FAKE_PIN = JSON.stringify({ agent: "pi", version: "1.0.3" });
    process.env.FAKE_RECORD = "pi";
    const { asks, record, notes } = await run();
    expect(asks()).toEqual([]);
    // Main's record of pi (the job's copy's), in place of the agent's.
    expect(record("pi")).toEqual(JSON.parse(readFileSync(join(ROOT, RECORDS, "pi.json"), "utf8")));
    expect(notes.join("\n")).toMatch(
      /didn't check pi 1\.0\.3 live: this run thinks with Claude Code/,
    );
  });

  it("doesn't check a version GitHub lists an advisory against", async () => {
    remote(executorsFile(), makefile());
    advisories = JSON.stringify([{ summary: "Reads the wrong token", severity: "high" }]);
    process.env.FAKE_PIN = JSON.stringify({ agent: "claude", version: "1.0.1" });
    const { asks, notes } = await run();
    expect(asks()).toEqual([]);
    expect(notes.join("\n")).toMatch(/advisory against it: Reads the wrong token \(high\)/);
  });

  it("records a version that didn't install, with npm's last line", async () => {
    remote(executorsFile(), makefile());
    process.env.FAKE_PIN = JSON.stringify({ agent: "claude", version: "9.9.9" });
    const { record, notes } = await run();
    expect(record().checks).toEqual({
      answers: { ok: false, why: "it didn't install: npm error 404 Not Found - claude-code@9.9.9" },
    });
    expect(notes.join("\n")).toMatch(/these checks failed: answers/);
  });

  it("asks once more for a command it didn't try, and fails a login it wrote to a file", async () => {
    remote(executorsFile(), makefile());
    process.env.FAKE_PIN = JSON.stringify({ agent: "claude", version: "1.0.1" });
    process.env.FAKE_CHECKED_SKIP = "git stash pop";
    process.env.FAKE_CHECKED_LEAK = "1";
    const { record, asks } = await run();
    expect(asks().map((a) => a.ask)).toEqual(["first", "again", "read"]);
    const r = record();
    expect(r.refused).toContain("git stash pop");
    expect(r.checks.decisions).toEqual({ ok: true });
    expect(r.checks.login).toEqual({ ok: false, why: "its login was in config/leak.txt" });
  });

  it("puts its record back after the fix round", async () => {
    remote(executorsFile(), makefile(true));
    process.env.FAKE_PIN = JSON.stringify({ agent: "claude", version: "1.0.1" });
    process.env.FAKE_WORK = "fix";
    process.env.FAKE_FIX_RECORD = "claude";
    const { result, record } = await run();
    expect(result.state).not.toBe("failed");
    expect(record()).toMatchObject({ version: "1.0.1", on: "box" });
  });
});
