// Agents as plug-ins and what a run shows (ADR 0017): the model and effort a task gets, Claude
// Code's adapter against a recorded real stream (2.1.284), run details, links back to the task,
// the status issue, and a box's setup version.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setupCheck } from "../cli/commands/doctor.ts";
import { claude } from "../cli/lib/agents/claude.ts";
import {
  type Choice,
  choose,
  loadExecutors,
  mergeReports,
  ownReport,
  parseUse,
  useChoices,
  useCommand,
} from "../cli/lib/agents.ts";
import { Stopwatch } from "../cli/kernel/agent.ts";
import { brief } from "../cli/kernel/apply.ts";
import { stream } from "../cli/lib/exec.ts";
import { madeByLine, taskLine, taskNumber, withTask } from "../cli/lib/links.ts";
import {
  count,
  duration,
  modelName,
  type RunDetails,
  recordRun,
  renderRunDetails,
  renderRuns,
} from "../cli/lib/runs.ts";
import {
  addEvent,
  applyFindings,
  dropRepeat,
  parseStatusIssue,
  readFindings,
  renderStatusIssue,
  StatusIssueState,
  setBox,
  setCleanup,
  setUpcoming,
  upsertRepeat,
} from "../cli/lib/status-issue.ts";
import { ROOT } from "./helpers.ts";

// The agents as executors.json makes them.
const executors = loadExecutors();
const STREAM = readFileSync(join(ROOT, "tests/fixtures/claude-stream.jsonl"), "utf8")
  .trim()
  .split("\n");

describe("agents: the model and effort a run gets", () => {
  it("Auto is executors.json's auto: Sonnet at medium effort", () => {
    const c = choose("claude", executors.claude, {});
    expect(c).toMatchObject({
      model: "sonnet",
      effort: "medium",
      auto: { model: true, effort: true },
      notes: [],
    });
    expect(choose("claude", executors.claude, { model: "Auto", effort: "auto" })).toMatchObject({
      model: "sonnet",
      effort: "medium",
    });
  });

  it("a use line's choice wins, in the agent's own names, and any model id it takes", () => {
    const c = choose("claude", executors.claude, { model: "Opus", effort: "xhigh" });
    expect(c).toMatchObject({
      model: "opus",
      effort: "xhigh",
      auto: { model: false, effort: false },
    });
    // A model that isn't listed yet, by its id: executors.json's modelPattern takes it.
    expect(choose("claude", executors.claude, { model: "claude-opus-5-5" }).model).toBe(
      "claude-opus-5-5",
    );
  });

  it("a choice that can't apply runs Auto's, and says why", () => {
    const c = choose("claude", executors.claude, { model: "GPT", effort: "Loud" });
    expect(c).toMatchObject({ model: "sonnet", effort: "medium" });
    expect(c.notes).toEqual([
      "claude has no model “GPT” in executors.json, so it ran Auto's.",
      "claude has no effort “Loud” in executors.json, so it ran Auto's.",
    ]);
    // Haiku has no effort: none is passed, and a chosen one is noted.
    expect(choose("claude", executors.claude, { model: "Haiku", effort: "High" })).toMatchObject({
      model: "haiku",
      effort: undefined,
      notes: ["Haiku has no effort setting."],
    });
    expect(choose("claude", executors.claude, { model: "Haiku" }).notes).toEqual([]);
  });

  it("reads a choice (ADR 0025): an agent, a model, an effort, or auto; each from the last", () => {
    /** Choices one after another, as `use` comments come: one that names nothing changes nothing. */
    const use = (...said: string[]) => {
      let u: { agent: string; model?: string; effort?: string; label?: string } = {
        agent: "claude",
      };
      for (const words of said) u = parseUse(words, executors, u, "claude") ?? u;
      return u;
    };
    expect(use("opus")).toMatchObject({ agent: "claude", model: "opus", label: "Opus" });
    expect(use("Opus high")).toMatchObject({ model: "opus", effort: "high", label: "Opus · High" });
    expect(use("claude-opus-5-5")).toMatchObject({ model: "claude-opus-5-5" });
    // Words that name no agent, model or effort are no choice.
    expect(parseUse("the new colours", executors, { agent: "claude" }, "claude")).toBeUndefined();
    expect(
      parseUse("opus for the cards", executors, { agent: "claude" }, "claude"),
    ).toBeUndefined();
    // Another agent starts afresh; its own model id and effort.
    expect(use("opus high", "pi")).toMatchObject({ agent: "pi", model: undefined });
    expect(use("pi z-ai/glm-5.3 high")).toMatchObject({
      agent: "pi",
      model: "z-ai/glm-5.3",
      effort: "high",
      label: "Pi · glm-5.3 · High",
    });
    expect(use("opus", "auto")).toMatchObject({ agent: "claude", model: undefined, label: "Auto" });
    expect(use("opus", "high")).toMatchObject({ model: "opus", effort: "high" });
    // "manual" can't run a task.
    expect(use("manual")).toEqual({ agent: "claude" });
    // An agent's models come only from its list or its pattern: a tool's name stays words.
    const pi = { agent: "pi" };
    expect(parseUse("next.js", executors, pi, "claude")).toBeUndefined();
    expect(parseUse("openai/gpt-5", executors, pi, "claude")).toMatchObject({
      model: "openai/gpt-5",
    });
    expect(
      parseUse("anthropic/claude-sonnet-5-5", executors, { agent: "opencode" }, "claude"),
    ).toMatchObject({ agent: "opencode", model: "anthropic/claude-sonnet-5-5" });
    expect(useChoices(executors, "claude")).toContain("an agent (claude");
  });

  it("takes a use command only as the whole text: a comment, or a blank issue's first line", () => {
    expect(useCommand("use opus")).toBe("opus");
    expect(useCommand("  Use opus high.  ")).toBe("opus high");
    expect(useCommand("use opsu")).toBe("opsu");
    // Inside other words it's no command: those are a request for the round.
    expect(useCommand("More detail, please.\n\nuse opus")).toBeUndefined();
    expect(useCommand("use opus\nand make the header blue")).toBeUndefined();
    expect(useCommand("lnk.example.com use opus")).toBeUndefined();
    expect(useCommand("because opus")).toBeUndefined();
  });

  it("has one form that runs the agent, its Model words a `use` line says, so no list to keep", () => {
    const dir = join(ROOT, ".github/ISSUE_TEMPLATE");
    const withModel = readdirSync(dir).filter((f) =>
      readFileSync(join(dir, f), "utf8").includes("id: model"),
    );
    // The one form that can run the agent (ADR 0031: Repeat; a blank issue's first line takes `use`).
    expect(withModel.map((f) => f.replace(/^\d+-|\.yml$/g, ""))).toEqual(["repeat"]);
    // Its examples are picks the real file takes.
    const form = readFileSync(join(dir, withModel[0] ?? ""), "utf8");
    const real = loadExecutors(join(ROOT, "executors.json"));
    const said = /id: model[\s\S]*?description: "([^"]*)"/.exec(form)?.[1] ?? "";
    const examples = [...said.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1] ?? "")
      .filter((x) => !/^(use|\/)/.test(x));
    expect(examples.length).toBeGreaterThan(2);
    for (const x of examples)
      expect(parseUse(x, real, { agent: "claude" }, "claude"), x).toBeDefined();
  });
});

describe("agents: Claude Code's adapter", () => {
  it("adds the model, the effort and its own output, whatever executors.json says", () => {
    const argv = claude.argv({
      command: ["claude", "-p", "--output-format", "text", "--allowedTools", "Read"],
      model: "opus",
      effort: "high",
    });
    expect(argv).toEqual([
      "claude",
      "-p",
      "--allowedTools",
      "Read",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
      "--effort",
      "high",
    ]);
    expect(claude.argv({ command: ["claude", "-p"] })).not.toContain("--model");
  });

  it("may read your files and its copy of Shipify, and write its out/, outside its working folder", () => {
    const root = "/opt/shipify/tool/shipify-app/abc";
    const argv = claude.argv({
      command: ["claude", "-p", "--allowedTools", "Bash(ls:*)"],
      folders: { read: [root, "/srv/a/run-1/in"], write: ["/srv/a/run-1/out"] },
    });
    const i = argv.indexOf("--allowedTools");
    expect(argv.slice(i + 1, i + 4)).toEqual([
      `Read(/${root}/**)`,
      "Read(//srv/a/run-1/in/**)",
      "Edit(//srv/a/run-1/out/**)",
    ]);
    expect(argv).toContain("Bash(ls:*)");
    // Its out/ is a working folder, so a command may list it and read back a log it wrote there;
    // the folders it only reads aren't (Edit stays out of them).
    expect(argv.slice(-2)).toEqual(["--add-dir", "/srv/a/run-1/out"]);
    expect(argv.filter((a) => a === "--add-dir")).toHaveLength(1);
  });

  it("reads a real run: version, model, tokens, turns, tools, a refused call, the plan's limits", () => {
    const r = claude.reader();
    const shown = STREAM.map((l) => r.line(l)).filter(Boolean);
    const report = r.report();
    expect(report.version).toBe("2.1.284");
    expect(report.model).toBe("claude-haiku-4-5-20251001");
    expect(report.turns).toBe(5);
    expect(report.tools).toEqual({ Read: 1, Bash: 3 });
    expect(report.denied).toEqual(["Bash: touch made.txt"]);
    expect(report.cost?.plan).toBe(true);
    expect(report.cost?.usd).toBeGreaterThan(0);
    expect(report.tokens?.output).toBeGreaterThan(0);
    expect(report.tokens?.cacheRead).toBeGreaterThan(0);
    expect(report.limits?.map((l) => l.window)).toContain("five_hour");
    expect(report.limits?.every((l) => l.used >= 0 && l.used <= 1)).toBe(true);
    expect(report.error).toBeUndefined();
    // The live log: one readable line per step.
    expect(shown[0]).toBe("  · Claude Code 2.1.284 · claude-haiku-4-5-20251001");
    expect(shown).toContain("  → Bash: echo hello");
    expect(shown.some((l) => l?.startsWith("  → Read: /work/note.txt"))).toBe(true);
    expect(shown.some((l) => l?.startsWith("  ✗ Exit code 128"))).toBe(true);
    expect(shown.at(-1)).toBe("  · finished: success, 5 turns");
  });

  it("passes on what isn't its JSON, and names tools.json's calls as tool.call", () => {
    const r = claude.reader();
    expect(r.line("not json")).toBe("not json");
    r.line(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "mcp__notion__read_page", input: { page: "x" } }],
        },
      }),
    );
    r.line(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }));
    expect(r.report()).toMatchObject({
      tools: { "notion.read_page": 1 },
      error: "error_max_turns",
    });
    // An error it put in words is named as it said it, never as "reported an error".
    const t = claude.reader();
    t.line(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Prompt is too long",
      }),
    );
    expect(t.report().error).toBe("Prompt is too long");
  });

  it("says it read outside the run for its web tools and a command that fetches, never a local one", () => {
    const outside = (name: string, input: Record<string, unknown>) => {
      const r = claude.reader();
      r.line(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name, input }] },
        }),
      );
      return Boolean(r.report().readOutside);
    };
    expect(outside("WebFetch", { url: "https://example.com" })).toBe(true);
    expect(outside("WebSearch", { query: "x" })).toBe(true);
    for (const command of [
      "curl -s https://example.com/health",
      "curl example.com",
      "cd app && wget -qO- example.com",
      "echo $(curl example.com)",
      "cd app\ncurl example.com",
      "timeout 10 curl example.com",
      "env A=1 curl example.com",
      "/usr/bin/curl example.com",
      "if curl -sf example.com; then echo up; fi",
      "{ curl example.com; }",
      `node -e "fetch('https://example.com').then((r) => r.text()).then(console.log)"`,
      "python3 -c 'import urllib.request as u; print(u.urlopen(\"http://example.com\").read())'",
    ])
      expect(outside("Bash", { command }), command).toBe(true);
    for (const command of ["make verify", "git log --oneline", "grep -rn curl src", "ls curl"])
      expect(outside("Bash", { command }), command).toBe(false);
    expect(outside("Read", { file_path: "/work/curl.md" })).toBe(false);
  });

  it("counts a resumed session's ask once: Claude Code's counts are its session's from the start", () => {
    // Measured live (Claude Code 2.1.283, haiku): an ask, then the same session resumed.
    const haiku = "claude-haiku-4-5";
    const first = { input: 909, cacheRead: 22562, cacheWrite: 8019, output: 52, thinking: 38 };
    const both = { input: 919, cacheRead: 53143, cacheWrite: 8109, output: 94, thinking: 74 };
    const resumed = {
      sessionTotals: true,
      models: { [haiku]: both },
      tokens: both,
      cost: { usd: 0.0229, plan: true },
    };
    const own = ownReport(resumed, { models: { [haiku]: first }, usd: 0.0195 });
    expect(own.tokens).toEqual({
      input: 10,
      cacheRead: 30581,
      cacheWrite: 90,
      output: 42,
      thinking: 36,
    });
    expect(own.cost?.usd).toBeCloseTo(0.0034);
    // The first ask of a session, and an agent that counts each ask alone, as they are.
    expect(ownReport(resumed, undefined)).toBe(resumed);
    const pi = { tokens: first, models: { m: first } };
    expect(ownReport(pi, { models: { m: first } })).toBe(pi);
    // A run's asks in one session (a catch-up round) add up to the session's totals, once.
    const w = new Stopwatch();
    const asked = { sessionTotals: true, models: { [haiku]: first }, tokens: first };
    w.ran("claude", {} as Choice, { report: asked, secs: 1 });
    w.ran("claude", {} as Choice, { report: resumed, secs: 1 });
    expect(w.report.tokens).toEqual(both);
    expect(w.sessionUsed?.models[haiku]).toEqual(both);
    // A stay's next turn starts from what its session had counted.
    const next = new Stopwatch(w.sessionUsed);
    next.ran("claude", {} as Choice, { report: resumed, secs: 1 });
    expect(next.report.tokens?.cacheRead).toBe(0);
  });

  it("adds up a round's runs: counts sum, the latest version and limits win", () => {
    const t = { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 };
    const merged = mergeReports(
      { tools: { Bash: 2 }, tokens: t, turns: 3, cost: { usd: 0.1, plan: true }, version: "1" },
      {
        tools: { Bash: 1, Read: 1 },
        tokens: t,
        turns: 2,
        cost: { usd: 0.2, plan: true },
        version: "2",
      },
    );
    expect(merged).toMatchObject({
      tools: { Bash: 3, Read: 1 },
      tokens: { input: 2, cacheRead: 4, cacheWrite: 6, output: 8 },
      turns: 5,
      version: "2",
    });
    expect(merged.cost?.usd).toBeCloseTo(0.3);
    // Outside content in any ask (a catch-up, the fix round) counts for the whole run.
    expect(mergeReports({}, {}).readOutside).toBeUndefined();
    expect(mergeReports({ readOutside: true }, {}).readOutside).toBe(true);
    expect(mergeReports({}, { readOutside: true }).readOutside).toBe(true);
    // The skills of every ask, each once.
    expect(mergeReports({ skills: ["notion"] }, { skills: ["notion", "plug-ins"] }).skills).toEqual(
      ["notion", "plug-ins"],
    );
    expect(mergeReports({}, {}).skills).toBeUndefined();
  });
});

describe("runs: what each run shows on its task", () => {
  const details = (over: Partial<RunDetails> = {}): RunDetails => ({
    at: "2026-10-01T08:50:00Z",
    why: "comment",
    box: "homepi",
    run: "https://github.com/o/shipify/actions/runs/1",
    agent: "claude",
    name: "Claude Code",
    version: "2.1.284",
    model: "claude-sonnet-5-5",
    effort: "medium",
    auto: { model: true, effort: true },
    secs: { box: 22, ready: 9, agent: 55, total: 92 },
    tokens: { input: 1200, cacheRead: 175_000, cacheWrite: 9500, output: 6100, thinking: 2300 },
    turns: 14,
    tools: { Read: 8, Bash: 12, "notion.search": 2 },
    denied: ["Bash: git push"],
    cost: { usd: 0.43, plan: true },
    limits: [
      { window: "five_hour", used: 0.24, resets: "2026-10-01T13:00:00Z" },
      { window: "seven_day", used: 0.39 },
    ],
    result: "needs-you",
    ...over,
  });

  it("reads numbers and models the way people say them", () => {
    expect([duration(42), duration(92), duration(3900)]).toEqual(["42s", "1m 32s", "1h 05m"]);
    expect([count(940), count(6100), count(185_700), count(1_250_000)]).toEqual([
      "940",
      "6.1k",
      "186k",
      "1.3M",
    ]);
    expect(modelName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("gpt-5")).toBe("gpt-5");
  });

  it("folds a run's details under one line", () => {
    const md = renderRunDetails(details(), "Asia/Kolkata");
    expect(md).toContain(
      "<summary>Run details: Sonnet 5.5 · medium · 1m 32s · 186k in, 6.1k out</summary>",
    );
    expect(md).toContain(
      "| Started | your comment · Thu 1 Oct, 14:20 · on **homepi** · [the run](",
    );
    expect(md).toContain(
      "| Agent | Claude Code 2.1.284 · `claude-sonnet-5-5` (Auto) · effort medium (Auto) |",
    );
    expect(md).toContain(
      "| Time | box setup 22s · getting ready 09s · the agent 55s · 1m 32s in all |".replace(
        "09s",
        "9s",
      ),
    );
    expect(md).toContain("| Tools | Bash ×12 · Read ×8 · notion.search ×2 |");
    expect(md).toContain("| Refused | Bash: git push |");
    expect(md).toContain(
      "| Your plan | 24% of the 5-hour limit, resets Thu 1 Oct, 18:30 · 39% of the weekly limit |",
    );
    expect(md).toContain("| At API prices | $0.43, which your subscription covers |");
    // A run its key pays for: what it cost, and the same, short, on its brief line. A cost of
    // nothing isn't said: the agent may not know a gateway's prices, so "free" would be a guess.
    const paid = { cost: { usd: 0.034, plan: false } };
    expect(renderRunDetails(details(paid), "UTC")).toContain(
      "| At API prices | $0.03, billed to its key |",
    );
    expect(renderRunDetails(details({ cost: { usd: 0, plan: false } }), "UTC")).not.toContain(
      "At API prices",
    );
    expect(brief(details(paid))).toMatch(/ · \$0\.03$/);
    expect(brief(details({ cost: { usd: 0.004, plan: false } }))).toMatch(/ · under \$0\.01$/);
    expect(brief(details({ cost: { usd: 0, plan: false } }))).not.toMatch(/free|\$/);
    // A plan's run: its cost is the plan's, so the line doesn't say one.
    expect(brief(details())).not.toContain("$");
    // A run with no agent is one line.
    expect(renderRunDetails(details({ agent: undefined, secs: { total: 4 } }), "UTC")).toBe(
      "<sub>Run details: your comment · Thu 1 Oct, 08:50 · on **homepi** · [the run](https://github.com/o/shipify/actions/runs/1) · 4s, no agent</sub>",
    );
    // Pipes in a refused command don't break the table.
    expect(renderRunDetails(details({ denied: ["Bash: ls | wc"] }), "UTC")).toContain(
      "| Refused | Bash: ls \\| wc |",
    );
    // The skills its agent loaded, and no row when it loaded none.
    const skilled = details({ skills: ["systematic-debugging", "test-driven-development"] });
    expect(renderRunDetails(skilled, "UTC")).toContain(
      "| Skills | systematic-debugging · test-driven-development |",
    );
    expect(renderRunDetails(details(), "UTC")).not.toContain("| Skills |");
  });

  it("keeps the last 20 runs as rows, the newest in full, and counts them all", () => {
    const state: Parameters<typeof recordRun>[0] = {};
    for (let i = 0; i < 25; i++)
      recordRun(state, details({ at: `2026-10-0${1 + (i % 9)}T08:00:00Z` }));
    expect(state.runs).toHaveLength(20);
    expect(state.ran).toBe(25);
    expect(state.last?.tools).toEqual({ Read: 8, Bash: 12, "notion.search": 2 });
    expect(state.runs?.[0]).toMatchObject({ in: 185_700, out: 6100, secs: 92, why: "comment" });
    expect(state.runs?.[0]?.skills).toBeUndefined();
    const table = renderRuns(state.runs ?? [], state.ran ?? 0, "UTC");
    expect(table).toContain("<summary>Runs: the last 20 of 25</summary>");
    expect(table).toContain(
      "| comment | homepi | Sonnet 5.5 · medium | 1m 32s | 186k / 6.1k | [needs you](https://github.com/o/shipify/actions/runs/1) |",
    );
    // A row keeps the skills its run loaded, for the weekly digest.
    recordRun(state, details({ skills: ["notion"] }));
    expect(state.runs?.at(-1)?.skills).toEqual(["notion"]);
  });
});

describe("links: every PR names its task", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("takes the task from the run when it isn't given, and says what made the PR", () => {
    process.env.GITHUB_REPOSITORY = "o/shipify";
    process.env.SHIPIFY_TASK = "";
    expect(taskLine(undefined, false)).toBeUndefined();
    expect(taskLine(12, false)).toBe("Closes o/shipify#12");
    process.env.SHIPIFY_TASK = "7";
    expect(taskLine(undefined, false)).toBe("Closes o/shipify#7");
    expect(taskLine(undefined, true)).toBe("Part of o/shipify#7");
    process.env.SHIPIFY_TASK_REPEATS = "1";
    expect(taskLine(undefined, false)).toBe("Part of o/shipify#7");
    // A task run sets it: cleared here, as SHIPIFY_TASK is above.
    process.env.SHIPIFY_MADE_BY = "";
    expect(madeByLine()).toBeUndefined();
    process.env.SHIPIFY_MADE_BY = "Claude Code (Sonnet, medium)";
    process.env.SHIPIFY_RUN_URL = "https://x/runs/1";
    expect(madeByLine()).toBe(
      "Made by Claude Code (Sonnet, medium) with Shipify in [this run](https://x/runs/1).",
    );
  });

  it("records the task in a plan's or change doc's front matter, once", () => {
    process.env.GITHUB_REPOSITORY = "o/shipify";
    process.env.SHIPIFY_TASK = "7";
    const doc = "---\nchange: 2\napp: x\n---\n\n# Body\n";
    const withIt = withTask(doc);
    expect(withIt).toBe("---\nchange: 2\napp: x\ntask: o/shipify#7\n---\n\n# Body\n");
    expect(withTask(withIt)).toBe(withIt);
    expect(withTask("no front matter")).toBe("no front matter");
    expect(taskNumber("o/shipify#7")).toBe(7);
    expect(taskNumber("other/repo#7")).toBeUndefined();
  });
});

describe("the status issue (ADR 0017, ADR 0019)", () => {
  const fresh = () => StatusIssueState.parse({ v: 2 });

  it("keeps its state in its body, the schedule the watch reads, and the last 30 events", () => {
    const s = fresh();
    setUpcoming(s, [
      {
        n: 20,
        title: "Weekly notes",
        next: "2026-10-05T03:30:00Z",
        every: "every Monday at 09:00",
      },
      {
        n: 16,
        title: "Pi health check",
        next: "2026-10-02T03:30:00Z",
        every: "every day at 09:00",
      },
    ]);
    s.watch = { ...s.watch, last: "2026-10-01T13:45:00Z", box: "homepi", run: "https://r/1" };
    for (let i = 0; i < 35; i++) addEvent(s, `event ${i}`, "2026-10-01T14:00:00Z");
    addEvent(s, "a --> b", "2026-10-01T14:05:00Z");
    const body = renderStatusIssue(s, "Asia/Kolkata");
    expect(parseStatusIssue(body)).toEqual(s);
    // The soonest repeat is the watch's next due time.
    expect(s.watch.next).toBe("2026-10-02T03:30:00Z");
    expect(s.upcoming.map((u) => u.n)).toEqual([16, 20]);
    expect(s.events).toHaveLength(30);
    expect(s.events[0]?.text).toBe("a --> b");
    expect(body).toContain(
      "**The watch:** last due run Thu 1 Oct, 19:15 on **homepi** · [its run](https://r/1) · next due Fri 2 Oct, 09:00.",
    );
    expect(body).toContain("| #16 Pi health check | Fri 2 Oct, 09:00 | every day at 09:00 |");
    expect(body).toContain("None yet: the due run starts each box's once a week.");
    expect(parseStatusIssue("someone's own text")).toEqual(fresh());
    // Before the watch's first due run, the issue says how to run what's due by hand.
    expect(renderStatusIssue(fresh(), "UTC")).toContain(
      "**The watch hasn't started a due run yet** · nothing repeats.",
    );
  });

  it("keeps the watch's next due time when a repeat is set up, changed or stopped", () => {
    const s = fresh();
    upsertRepeat(s, { n: 16, title: "Pi", next: "2026-10-02T03:30:00Z" });
    upsertRepeat(s, { n: 20, title: "Notes", next: "2026-10-01T20:00:00Z" });
    expect(s.watch.next).toBe("2026-10-01T20:00:00Z");
    upsertRepeat(s, { n: 20, title: "Notes", next: "2026-10-03T20:00:00Z" });
    expect(s.upcoming).toHaveLength(2);
    expect(s.watch.next).toBe("2026-10-02T03:30:00Z");
    dropRepeat(s, 16);
    expect(s.watch.next).toBe("2026-10-03T20:00:00Z");
    dropRepeat(s, 20);
    expect(s.watch.next).toBeUndefined();
  });

  it("starts fresh from anything but version 2 (the clock's version 1 is long gone)", () => {
    const v1 = { v: 1, clock: { off: true }, box: { name: "homepi-clock", at: "x", facts: [] } };
    const s = parseStatusIssue(`<!-- shipify-status ${JSON.stringify(v1)} -->\n\nold text`);
    expect(s.v).toBe(2);
    expect(s.boxes).toEqual({});
  });

  it("shows each box's health, and comments once when something needs a look and once when it's fine", () => {
    const s = fresh();
    const facts = (temp: string, look?: string) => [
      { name: "disk", value: "47.8 GB free of 56 GB (11% used)" },
      { name: "temperature", value: temp, look },
    ];
    expect(setBox(s, "homepi", facts("48.1 °C"), "2026-10-01T16:30:00Z")).toBeUndefined();
    expect(renderStatusIssue(s, "UTC")).toContain(
      "- **Boxes:** **homepi** checked Thu 1 Oct, 16:30: all fine",
    );
    expect(setBox(s, "homepi", facts("81.0 °C", "it's running hot, 81.0 °C"))).toBe(
      "**homepi** needs a look:\n\n- it's running hot, 81.0 °C",
    );
    // A degree more is the same problem: no second comment.
    expect(setBox(s, "homepi", facts("82.0 °C", "it's running hot, 82.0 °C"))).toBeUndefined();
    expect(renderStatusIssue(s, "UTC")).toContain("needs a look (it's running hot, 82.0 °C)");
    expect(renderStatusIssue(s, "UTC")).toContain("| ✗ temperature | 82.0 °C |");
    expect(setBox(s, "homepi", facts("50.0 °C"))).toBe("**homepi** is fine again.");
    expect(setBox(s, "homepi", facts("49.0 °C"))).toBeUndefined();
    // A second box has its own health, and its own "needs a look".
    expect(setBox(s, "pi2", facts("85.0 °C", "it's running hot, 85.0 °C"))).toContain("**pi2**");
    expect(Object.keys(s.boxes)).toEqual(["homepi", "pi2"]);
  });

  it("comments on doctor's problems once per new set on each box, and once when they're fixed", () => {
    const s = fresh();
    const run = (box: string, checks: { ok: boolean; name: string }[]) =>
      setCleanup(s, box, { at: "2026-10-01T04:00:00Z", summary: "0 stuck", checks });
    expect(run("homepi", [{ ok: true, name: "gh" }])).toBeUndefined();
    expect(run("homepi", [{ ok: false, name: "disk space" }])).toContain(
      "Doctor found a problem on **homepi**",
    );
    expect(run("homepi", [{ ok: false, name: "disk space" }])).toBeUndefined();
    // Another box's problem is its own.
    expect(run("pi2", [{ ok: false, name: "disk space" }])).toContain("on **pi2**");
    expect(run("homepi", [{ ok: true, name: "disk space" }])).toBe(
      "All of doctor's checks on **homepi** are fine again.",
    );
    expect(run("homepi", [{ ok: true, name: "disk space" }])).toBeUndefined();
    expect(renderStatusIssue(s, "UTC")).toContain("**Doctor:** 1 of 1 checks fine.");
  });

  it("takes the watch's findings: fixed names and states only, and each change once", () => {
    const { findings, dropped } = readFindings(
      JSON.stringify({
        boxes: { homepi: "offline", "bad name!": "offline", pi2: "exploded" },
        apps: { spotter: "failing", playground: "fine" },
        other: { x: 1 },
      }),
    );
    expect(findings).toEqual({
      boxes: { homepi: "offline" },
      apps: { spotter: "failing", playground: "fine" },
    });
    expect(dropped).toEqual(["bad name!", "pi2"]);
    expect(readFindings("not json").dropped).toEqual(["the findings aren't JSON"]);

    const s = fresh();
    setBox(s, "homepi", [], "2026-10-01T16:30:00Z");
    const said = applyFindings(s, findings, "2026-10-01T18:00:00Z");
    expect(said).toContain("**homepi** is offline");
    expect(said).toContain("**spotter** isn't answering its health check");
    // playground was never reported failing: "fine" is nothing new.
    expect(said).not.toContain("playground");
    expect(s.boxes.homepi?.offline).toBe("2026-10-01T18:00:00Z");
    // The same findings again change nothing, and say nothing.
    expect(applyFindings(s, findings)).toBeUndefined();
    const body = renderStatusIssue(s, "UTC");
    expect(body).toContain("**homepi** offline since Thu 1 Oct, 18:00");
    expect(body).toContain("- **Apps:** **spotter** failing since Thu 1 Oct, 18:00");
    // Back again: one comment each.
    expect(applyFindings(s, { boxes: { homepi: "online" }, apps: { spotter: "fine" } })).toBe(
      "- **homepi** is back online.\n- **spotter** is answering again.",
    );
    expect(renderStatusIssue(s, "UTC")).toContain("- **Apps:** none failing");
    // A new box joins quietly; a removed one goes, with its clean-up.
    expect(applyFindings(s, { boxes: { pi2: "online" }, apps: {} })).toBeUndefined();
    setCleanup(s, "pi2", { at: "2026-10-01T04:00:00Z", summary: "0 stuck", checks: [] });
    expect(applyFindings(s, { boxes: { pi2: "gone" }, apps: {} })).toBeUndefined();
    expect(Object.keys(s.boxes)).toEqual(["homepi"]);
    expect(s.cleanups.pi2).toBeUndefined();
    // An app taken down on purpose while failing: no longer failing, and nothing to tell.
    applyFindings(s, { boxes: {}, apps: { spotter: "failing" } });
    expect(applyFindings(s, { boxes: {}, apps: { spotter: "paused" } })).toBeUndefined();
    expect(s.apps.filter((a) => a.failing)).toEqual([]);
    // The watch's notes (ADR 0031): each said once, by its key.
    const note = {
      key: "key-expiring:door",
      problem: {
        code: "key-expiring",
        what: "The door App's key is a year old.",
        fix: "Rotate it.",
      },
    };
    const { findings: withNote } = readFindings(JSON.stringify({ notes: [note] }));
    expect(applyFindings(s, withNote)).toBe("- The door App's key is a year old. Rotate it.");
    expect(applyFindings(s, withNote)).toBeUndefined();
    expect(s.alerted).toEqual(["key-expiring:door"]);
  });

  it("takes a chat channel failing, with what its service said, and fine again (ADR 0030)", () => {
    const { findings, dropped } = readFindings(
      JSON.stringify({
        boxes: {},
        apps: {},
        channels: {
          telegram: { state: "failing", error: "Wrong response from the webhook: 503 `x` <b>" },
          other: { state: "exploded" },
        },
      }),
    );
    expect(dropped).toEqual(["other"]);
    expect(findings.channels).toEqual({
      telegram: { state: "failing", error: "Wrong response from the webhook: 503 x b" },
    });
    const s = fresh();
    const said = applyFindings(s, findings, "2026-10-04T12:00:00Z");
    expect(said).toContain("**telegram** isn't reaching the door");
    expect(said).toContain("Wrong response from the webhook: 503 x b");
    expect(s.channels.telegram).toEqual({ failing: "2026-10-04T12:00:00Z" });
    expect(applyFindings(s, findings)).toBeUndefined();
    expect(renderStatusIssue(s, "UTC")).toContain(
      "- **Channels:** **telegram** failing since Sun 4 Oct, 12:00",
    );
    expect(
      applyFindings(s, { boxes: {}, apps: {}, channels: { telegram: { state: "fine" } } }),
    ).toBe("- **telegram** reaches the door again.");
    expect(renderStatusIssue(s, "UTC")).not.toContain("**Channels:**");
  });
});

describe("boxes: the setup version (ADR 0017)", () => {
  it("names a box set up by an older box/setup.sh, only on a box", () => {
    const dir = join(ROOT, "tests", "fixtures");
    expect(setupCheck("someone", dir)).toBeUndefined();
    // No record (its setup never finished): version 1, behind the repo's.
    expect(setupCheck("shipify", dir)).toMatchObject({
      ok: false,
      detail: "version 1; the repo's is 6",
    });
    // The repo's script moved on: the box says so, and how to catch up.
    const tmp = mkdtempSync(join(tmpdir(), "setup-"));
    writeFileSync(join(tmp, "setup.sh"), "#!/bin/sh\nSETUP_VERSION=2\n");
    writeFileSync(join(tmp, ".shipify-setup"), "1\n");
    expect(setupCheck("shipify", tmp, join(tmp, "setup.sh"))).toMatchObject({
      ok: false,
      detail: "version 1; the repo's is 2",
    });
  });
});

describe("exec: streaming a long command", () => {
  it("hands over each line, and at the timeout stops it and what it started", async () => {
    const lines: string[] = [];
    expect(await stream("sh", ["-c", "echo one; echo two"], { onLine: (l) => lines.push(l) })).toBe(
      0,
    );
    expect(lines).toEqual(["one", "two"]);
    const started = Date.now();
    const code = await stream("sh", ["-c", "sleep 30 & sleep 30; echo late"], {
      timeoutMs: 300,
      onLine: (l) => lines.push(l),
    });
    expect(code).toBe(124);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(lines).not.toContain("late");
    expect(await stream("no-such-command-here", [], { onLine: () => {} })).toBe(127);
  });
});

describe("a run's details", () => {
  it("name the gateway an agent went through when it isn't its first (pi · Vercel)", async () => {
    const { Stopwatch } = await import("../cli/kernel/agent.ts");
    const name = (agent: string) => {
      const watch = new Stopwatch();
      watch.ran(agent, choose(agent, loadExecutors()[agent], {}), { report: {}, secs: 1 });
      return watch.details("new", "answered").name;
    };
    expect(name("pi")).toBe("pi");
    expect(name("pi-vercel")).toBe("pi · Vercel");
    expect(name("opencode-vercel")).toBe("OpenCode · Vercel");
    expect(name("claude")).toBe("Claude Code");
  });
});

describe("a run's seconds, on the monotonic clock", () => {
  it("never go negative when the wall clock steps back, so the reply's line still posts", async () => {
    const { Stopwatch } = await import("../cli/kernel/agent.ts");
    const { replyLine } = await import("../cli/contracts/index.ts");
    const { runNumbers } = await import("../cli/kernel/apply.ts");
    const wall = Date.now;
    const watch = new Stopwatch();
    try {
      // An NTP fix, or a VM's clock, moves the wall clock back hours while the run goes.
      Date.now = () => wall() - 8 * 3_600_000;
      const d = watch.details("new", "answered");
      expect(d.secs.total).toBeGreaterThanOrEqual(0);
      expect(d.secs.total).toBeLessThan(60);
      expect(() =>
        replyLine({
          v: 1,
          kind: "answer",
          state: "Done",
          title: "t",
          links: [],
          to: [],
          key: "k",
          run: runNumbers(d),
        }),
      ).not.toThrow();
    } finally {
      Date.now = wall;
    }
  });
});
