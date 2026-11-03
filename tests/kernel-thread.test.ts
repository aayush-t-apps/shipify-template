// A long thread (ADR 0069 section 8): its Progress, and a lighter prompt past 40 KB of conversation,
// with older messages read whole on demand (`ship task read`). The sizes are the stress test's
// (ADR 0069 section 14, whose script these tests replaced): #632's and #633's messages, at 20,
// 100 and 200 of them.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskRead } from "../cli/commands/task/read.ts";
import { buildPrompt, CUT_AT, KEPT_WHOLE, type PromptInput } from "../cli/kernel/prompt.ts";
import { logStep } from "../cli/kernel/run.ts";
import { HANDOFF_MAX } from "../cli/kernel/think.ts";
import { ghName } from "../cli/lib/exec.ts";
import { newState, parseTitle, type TaskState } from "../cli/lib/task.ts";
import { fakeGh } from "./fixtures/fakes.ts";

const ROOT = join(import.meta.dirname, "..");
const playbook = readFileSync(join(ROOT, "playbooks", "task.md"), "utf8");
const KB = 1024;

const text = (size: number, seed: string) =>
  `${seed}: ${"research note with a link https://example.com/a and a number 42. ".repeat(Math.ceil(size / 66))}`.slice(
    0,
    size,
  );
/** #632's and #633's messages: the owner's ~400 characters, a reply's ~4,400; the newest is NEW. */
const thread = (messages: number) =>
  Array.from({ length: messages }, (_, i) => ({
    id: 5000 + i,
    who: i % 2 ? "Shipify" : "the owner",
    at: `2026-11-01T12:${String(i % 60).padStart(2, "0")}:00Z`,
    text: text(i % 2 ? 4_400 : 400, `message ${i}`),
    isNew: i === messages - 1,
  }));

const input = (over: Partial<PromptInput> = {}): PromptInput => {
  const title = "Research: lightweight games for the playground";
  return {
    repo: "o/shipify",
    n: 632,
    title,
    body: text(450, "the ask"),
    parsed: parseTitle(title),
    why: "comment",
    profile: "talk",
    state: newState() as TaskState,
    conversation: thread(2),
    paths: {
      work: "/w",
      files: "/in/files",
      out: "/out",
      result: "/out/result.json",
      shipify: "/s",
      ship: "node /s/cli/dist/ship.mjs",
      read: "/r",
    },
    notes: [],
    playbook,
    ...over,
  };
};
/** A task whose runs kept a full Progress: the most a status keeps. */
const progressed = (): TaskState => ({ ...newState(), notes: text(HANDOFF_MAX, "progress") });
const size = (s: string) => Buffer.byteLength(s);

describe("a long thread's prompt (ADR 0069 section 8)", () => {
  it("under 40 KB of conversation, every message is whole, as before", () => {
    const c = thread(6);
    const p = buildPrompt(input({ conversation: c }));
    for (const m of c) expect(p).toContain(m.text);
    expect(p).not.toContain("task read <id>");
  });

  it("past 40 KB: the newest 8 whole, each older one a line with its date, author, first line and id", () => {
    const c = thread(40);
    const p = buildPrompt(input({ conversation: c, state: progressed() }));
    for (const m of c.slice(-KEPT_WHOLE)) expect(p).toContain(m.text);
    for (const m of c.slice(0, -KEPT_WHOLE)) {
      expect(p).not.toContain(m.text);
      expect(p).toContain(`(id ${m.id}): ${m.text.slice(0, 40)}`);
    }
    expect(p).toContain("- 2026-11-01 12:00, the owner (id 5000): message 0");
    // How to read one whole, with the run's own CLI; and the Progress, where the work stands.
    expect(p).toContain("`node /s/cli/dist/ship.mjs task read <id>` prints one whole");
    expect(p).toContain("## Progress: the last run's handoff");
    expect(p).toContain("The Progress below says where the work stands.");
  });

  it("a NEW message stays whole however old: it's one of the asks", () => {
    const c = thread(30).map((m, i) => ({ ...m, isNew: i === 3 || i === 29 }));
    const p = buildPrompt(input({ conversation: c }));
    expect(p).toContain(c[3]?.text);
    expect(p).not.toContain(c[2]?.text);
  });

  it("a read run gets the thread whole: it has no command to read an older message with (ADR 0044)", () => {
    const c = thread(40);
    const p = buildPrompt(input({ conversation: c, profile: "read" }));
    for (const m of c) expect(p).toContain(m.text);
    expect(p).not.toContain("is one line");
    expect(p).not.toContain("task read <id>");
  });

  it("holds at the stress test's sizes: 20, 100 and 200 messages, with a 16,000-character Progress", () => {
    const [twenty, hundred, twoHundred] = [20, 100, 200].map((n) =>
      size(buildPrompt(input({ conversation: thread(n), state: progressed() }))),
    ) as [number, number, number];
    // Before the cut, the prompt carried the whole thread: 74, 263 and 500 KB (section 14).
    const whole = thread(200).reduce((a, m) => a + m.text.length, 0);
    expect(whole).toBeGreaterThan(450 * KB);
    expect(twenty).toBeLessThan(70 * KB);
    expect(hundred).toBeLessThan(80 * KB);
    expect(twoHundred).toBeLessThan(100 * KB);
    // It still grows, by a line a message: ~0.16 KB, not ~2.4.
    expect((twoHundred - hundred) / 100).toBeLessThan(0.25 * KB);
  });

  it("cuts at 40 KB of conversation, not before", () => {
    // Messages of ~4.4 KB: nine are under the line, ten over it.
    const big = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        who: "Shipify",
        at: "2026-11-01T12:00:00Z",
        text: text(4_400, `m${i}`),
        isNew: false,
      }));
    expect(9 * 4_400).toBeLessThan(CUT_AT);
    expect(buildPrompt(input({ conversation: big(9) }))).not.toContain("is one line");
    expect(buildPrompt(input({ conversation: big(10) }))).toContain("is one line");
  });
});

describe("the Progress, kept and seeded (ADR 0069 section 8)", () => {
  it("keeps 16,000 characters, and tells the run its handoff is seeded with the last one", () => {
    expect(HANDOFF_MAX).toBe(16_000);
    const p = buildPrompt(input({ state: { ...newState(), notes: "Goal: a games list" } }));
    expect(p).toContain("`/out/handoff.md` is seeded with the last one");
    expect(p).toContain("edit it in place");
    expect(p).toContain("## Progress: the last run's handoff\n\nGoal: a games list");
    // A first run has none to edit.
    expect(buildPrompt(input())).toContain("keep `/out/handoff.md` current as you work");
  });
});

describe("files earlier runs made (ADR 0069 section 13)", () => {
  const shared = {
    "games.md": {
      hash: "h1",
      url: "https://github.com/o/shipify/blob/shipify-files/task-632/20261101-1200/games.md",
    },
    "chart.png": {
      hash: "h2",
      url: "https://github.com/o/shipify/blob/shipify-files/task-632/20261101-1300/chart.png",
    },
  };

  it("are listed for the next run, with their links and how to read one", () => {
    const p = buildPrompt(input({ state: { ...newState(), shared } }));
    expect(p).toContain("## Files earlier runs made");
    expect(p).toContain(`- games.md: ${shared["games.md"].url}`);
    expect(p).toContain(`- chart.png: ${shared["chart.png"].url}`);
    expect(p).toContain('gh api "repos/o/shipify/contents/<path>?ref=shipify-files"');
  });

  it("aren't, to a read run or one on another account: neither can read Shipify's branch", () => {
    const state = { ...newState(), shared };
    expect(buildPrompt(input({ state, profile: "read" }))).not.toContain("Files earlier runs");
    expect(buildPrompt(input({ state, account: "acme" }))).not.toContain("Files earlier runs");
    expect(buildPrompt(input())).not.toContain("Files earlier runs");
  });
});

describe("a run's start-up reads, timed (ADR 0069 section 9)", () => {
  it("names each GraphQL read in a step's line by what it reads", () => {
    const q = (query: string) => ghName(["api", "graphql", "-f", `query=${query}`, "-F", "n=12"]);
    expect(
      q(
        "query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $n) { id } } }",
      ),
    ).toBe("graphql issueOrPullRequest");
    expect(q("query($id: ID!) { node(id: $id) { id } }")).toBe("graphql node");
    expect(q("mutation($id: ID!) { pinIssue(input: {issueId: $id}) { issue { number } } }")).toBe(
      "graphql pinIssue",
    );
    expect(
      ghName(["api", "--paginate", "--slurp", "repos/o/r/issues/12/comments?per_page=100"]),
    ).toBe("comments");
  });

  it("writes each step's line in the job's log, which GitHub's API reads, and on its summary", () => {
    const summary = join(mkdtempSync(join(tmpdir(), "summary-")), "summary.md");
    const was = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summary;
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      logStep("plan", 5_400);
      const logged = err.mock.calls.map((c) => String(c[0])).find((l) => l.includes("plan 5.4 s"));
      expect(logged).toMatch(/^ {2}· plan 5\.4 s · /);
      expect(readFileSync(summary, "utf8")).toContain(logged?.trim().slice(2));
    } finally {
      err.mockRestore();
      if (was === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = was;
    }
  });
});

describe("`ship task read <id>` (ADR 0069 section 8)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const gh = () => {
    const g = fakeGh({
      issue: {
        number: 12,
        title: "Research: games",
        body: "Find offline games.",
        state: "open",
        labels: [],
        user: { login: "o" },
      },
      comments: [
        {
          id: 7,
          body: '<!-- shipify-task {"v":2} -->\n**Working**',
          user: { login: "github-actions[bot]" },
          created_at: "2026-11-01T12:00:00Z",
        },
        {
          id: 8,
          body: "A long answer.\n\nWith a second paragraph.",
          user: { login: "github-actions[bot]" },
          created_at: "2026-11-01T12:05:00Z",
        },
      ],
    });
    Object.assign(process.env, g.env, { SHIPIFY_TASK: "12", GITHUB_REPOSITORY: "o/shipify" });
    delete process.env.SHIPIFY_ISSUES_TOKEN;
    return g;
  };

  it("prints one message of the run's task whole, by its id", () => {
    gh();
    const r = taskRead("8");
    expect(r.status).toBe("succeeded");
    expect(r.data).toBe("A long answer.\n\nWith a second paragraph.");
    expect(r.summary).toContain("#12, message 8");
  });

  it("0 is the task's own words; the status comment and an unknown id aren't messages", () => {
    gh();
    expect(taskRead("0").data).toBe("# Research: games\n\nFind offline games.");
    expect(() => taskRead("7")).toThrow(/has no message 7/);
    expect(() => taskRead("99")).toThrow(/has no message 99/);
    expect(() => taskRead("x")).toThrow(/Use: task read/);
  });

  it("needs a task: the run's own, or --task", () => {
    gh();
    delete process.env.SHIPIFY_TASK;
    expect(() => taskRead("8")).toThrow(/No task here/);
    expect(taskRead("8", "12").data).toContain("A long answer.");
  });
});
