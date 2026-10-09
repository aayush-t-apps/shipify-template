// The agent plug-in's conformance test (ADR 0017, ADR 0027, cli/lib/plugins/agent.ts): executors.json
// is right entry by entry, and every adapter turns the core's one ask into its agent's command and
// reads its agent's real output into a report. A new adapter adds a recorded run of its agent to
// RECORDED, and passes the same tests.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  defaultAgent,
  type Executors,
  readExecutors,
  toolAgent,
} from "../../cli/lib/agents.ts";
// @ts-expect-error: plain JavaScript, as pi loads it
import { refused, refusedCommand } from "../../cli/lib/agents/pi-gate.mjs";
import { ROOT } from "../helpers.ts";

/** Each adapter's agent, recorded in a real run (with its version), for its reader. */
const RECORDED: Record<string, string> = {
  claude: "tests/fixtures/claude-stream.jsonl",
  pi: "tests/fixtures/pi-stream.jsonl",
};

/**
 * Each adapter's agent ending on its model's error, as its output says it (Claude Code's result
 * event; pi giving up its own retries, its gateway's JSON in the message), and that error in the
 * model's own words, as the report gives it to the Failed reply.
 */
const ERRORED: Record<string, { lines: unknown[]; error: string }> = {
  claude: {
    lines: [
      { type: "result", subtype: "success", is_error: true, result: "API Error: 529 Overloaded" },
    ],
    error: "API Error: 529 Overloaded",
  },
  pi: {
    lines: [
      { type: "auto_retry_start", attempt: 3, maxAttempts: 3, delayMs: 8000, errorMessage: "503" },
      {
        type: "auto_retry_end",
        success: false,
        attempt: 3,
        finalError:
          '503: {"message":"Upstream error from Nvidia: Service temporarily overloaded","code":503}',
      },
      { type: "agent_end", willRetry: false },
    ],
    error: "Upstream error from Nvidia: Service temporarily overloaded",
  },
};

/**
 * The same decisions for every agent (ADR 0043): the refused commands in any form an agent writes
 * them, and anything else, pipes, loops and reads outside its folders included.
 */
const SAME = {
  refused: [
    "git push",
    "git push origin main",
    "git -C ../x push",
    "make test && git push",
    'echo "$(git stash)"',
    "for r in x; do git push; done",
    "git stash pop",
    "(git push)",
    "{ git push; }",
    "if true; then git push; fi",
    "git --no-pager push",
    "git -c push.default=current push",
    "A=1 git push",
    "timeout -s KILL 9 git push",
    "nice -n 5 git push",
    "env -i git push",
    "echo x | xargs git push",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's own variable, as an agent writes it
    "git -C ${PWD} push",
  ],
  allowed: [
    "make verify",
    "find . -name '*.ts' | xargs grep -n TODO",
    "jq .version package.json",
    "for f in a b; do echo $f; done",
    "cat /etc/os-release",
    "ls /opt/shipify/tool",
    "sed -n 1,20p README.md",
    "git log --oneline -5",
    'echo scratch > "$TMPDIR/msg.txt"',
    'git commit --allow-empty -F "$TMPDIR/msg.txt"',
    'grep -rn "git push" README.md',
    "timeout 60 make verify",
    "find . -name '*.md' -exec grep -l TODO {} +",
  ],
};

/** Claude Code's own decisions, recorded live with the rules its adapter writes (ADR 0043). */
const CLAUDE = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/claude-decisions.json"), "utf8"));

/** The rules after a flag, up to the next flag. */
const after = (argv: string[], flag: string) => {
  const i = argv.indexOf(flag);
  const out: string[] = [];
  for (let j = i + 1; i >= 0 && j < argv.length && !argv[j]?.startsWith("--"); j++)
    out.push(argv[j] as string);
  return out;
};

/** Claude Code's rules for commands, among the rules its adapter writes. */
const commandRule = (r: string) => /^(Bash|Read|Glob|Grep|WebFetch|WebSearch)(\(git |$)/.test(r);

/**
 * How each adapter's agent decides, from the rules its adapter wrote: whether a command is refused.
 * Claude Code: its own answers, recorded live (tests/fixtures/claude-decisions.json) for exactly
 * the rules its adapter writes now; record them again when the rules or its version change.
 * pi: its gate's own answer, with the rules pi's adapter wrote beside it.
 */
const DECIDES: Record<string, (argv: string[], tools: string) => (command: string) => boolean> = {
  claude(argv) {
    expect(after(argv, "--allowedTools").filter(commandRule)).toEqual(CLAUDE.rules.allowedTools);
    expect(after(argv, "--disallowedTools").filter(commandRule)).toEqual(
      CLAUDE.rules.disallowedTools,
    );
    return (command) => {
      const refused = CLAUDE.refused.includes(command);
      expect(refused || CLAUDE.ran.includes(command), `record its answer to ${command}`).toBe(true);
      return refused;
    };
  },
  pi(argv, tools) {
    expect(argv).toContain(join(tools, "gate.mjs"));
    const rules = JSON.parse(readFileSync(join(tools, "gate.json"), "utf8"));
    return (command) => Boolean(refusedCommand(rules, command));
  },
};

/**
 * How each adapter's agent decides in the read profile (ADR 0044), from what its adapter wrote:
 * whether it may run a command, fetch a web page, and read a file. Claude Code: its own answers,
 * recorded live (claude-decisions.json's `read`) for exactly the flags its adapter writes, which
 * offer no command or web tool, and keep reads inside its working folder and its read folders.
 * pi: its gate's own answers, with the rules pi's adapter wrote beside it.
 */
type Reads = { run: (c: string) => boolean; fetch: () => boolean; read: (f: string) => boolean };
const READS: Record<string, (argv: string[], tools: string, cwd: string, read: string[]) => Reads> =
  {
    claude(argv, _tools, cwd, read) {
      const at = argv.indexOf("--restricted");
      expect(argv.slice(at, at + CLAUDE.read.flags.length)).toEqual(CLAUDE.read.flags);
      expect(CLAUDE.read.permissionMode).toBe("acceptEdits");
      expect(argv).not.toContain("bypassPermissions");
      for (const d of read) expect(argv.join(" ")).toContain(`--add-dir ${d}`);
      const tools: string[] = CLAUDE.read.tools;
      const inside = (f: string) => [cwd, ...read].some((d) => f === d || f.startsWith(`${d}/`));
      return {
        run: () => tools.includes("Bash"),
        fetch: () => tools.includes("WebFetch"),
        read: (f) => tools.includes("Read") && inside(f),
      };
    },
    pi(argv, tools, cwd) {
      expect(argv.join(" ")).toContain("--tools read,grep,find,ls --no-context-files");
      const rules = JSON.parse(readFileSync(join(tools, "gate.json"), "utf8"));
      expect(rules).toMatchObject({ run: false });
      const own = tools;
      return {
        run: (c) => !refused(rules, "bash", { command: c }, cwd, own),
        fetch: () => !refused(rules, "mcp__web__fetch", {}, cwd, own),
        read: (f) => !refused(rules, "read", { path: f }, cwd, own),
      };
    },
  };

/** The version an adapter's agent runs: its own say, else the one executors.json pins. */
const pinned = (adapter: string) =>
  Object.values(readExecutors(join(ROOT, "executors.json")).executors).find(
    (e) => e.adapter === adapter,
  )?.install?.version;

describe("executors.json", () => {
  const { executors, problems } = readExecutors(join(ROOT, "executors.json"));

  it("is right, entry by entry", () => {
    expect(problems).toEqual([]);
  });

  it("has one default agent, which has an adapter, and each login names a secret", () => {
    const defaults = Object.entries(executors).filter(([, e]) => e.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.[1].adapter).toBeTruthy();
    for (const e of Object.values(executors))
      if (e.login) expect(e.login.secret).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("lists a gateway's models by ids its pattern takes, Auto among them, and searches with the word", () => {
    for (const [id, e] of Object.entries(executors)) {
      if (e.auto?.model) expect(e.models, `${id}: Auto`).toContain(e.auto.model);
      for (const name of e.noEffort ?? []) expect(e.models, `${id}: ${name}`).toContain(name);
      for (const name of Object.keys(e.about ?? {}))
        expect(e.models, `${id}: ${name}`).toContain(name);
      if (!e.gateway) continue;
      expect(e.modelPattern, id).toBeTruthy();
      for (const m of e.models ?? []) expect(m, id).toMatch(new RegExp(e.modelPattern ?? ""));
    }
    const raw = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
    for (const g of Object.values(raw.gateways ?? {}) as { search?: string }[])
      if (g.search) expect(g.search).toContain("{word}");
  });

  it("takes any one-word agent id, as before", () => {
    const dir = mkdtempSync(join(tmpdir(), "executors-"));
    const file = join(dir, "executors.json");
    writeFileSync(
      file,
      JSON.stringify({ "claude-code": { description: "x", command: ["x"] }, "two words": {} }),
    );
    const r = readExecutors(file);
    expect(Object.keys(r.executors)).toEqual(["claude-code"]);
    expect(r.problems).toEqual([
      'executors.json: "two words" isn\'t a name (a lowercase word: letters, digits, - and _)',
    ]);
  });

  it("has no allow list (ADR 0043): one left over is named, and the refused list still holds", () => {
    const dir = mkdtempSync(join(tmpdir(), "executors-"));
    const file = join(dir, "executors.json");
    writeFileSync(
      file,
      JSON.stringify({ commands: { allow: ["make"], deny: ["git push"], web: false } }),
    );
    const r = readExecutors(file);
    expect(r.commands).toEqual({ deny: ["git push"], web: false });
    expect(r.problems.join("\n")).toMatch(/commands\.allow: isn't read any more \(ADR 0043\)/);
  });

  it("chooses the default unless the repo's variable names one, and a tool-taking agent for act runs", () => {
    const all: Executors = {
      plain: { description: "a plain program", command: ["plain"] },
      main: { description: "the default", adapter: "claude", default: true, command: ["x"] },
    };
    expect(defaultAgent(all, "")).toBe("main");
    expect(defaultAgent(all, "plain")).toBe("plain");
    expect(toolAgent(all, "plain")).toBe("main");
    expect(toolAgent(all, "main")).toBe("main");
  });
});

describe.each(Object.entries(ADAPTERS))("the agent plug-in: %s's adapter", (name, adapter) => {
  it("has a recorded run of its agent", () => {
    expect(RECORDED[name], `add a recorded run of ${name} to RECORDED`).toBeTruthy();
  });

  it("starts from the executors.json command, and adds the model, the effort and a resume", () => {
    const base = ["agent-program", "-p"];
    const plain = adapter.argv({ command: base });
    expect(plain[0]).toBe("agent-program");
    const told = adapter.argv({ command: base, model: "a-model", effort: "high", resume: "s-1" });
    expect(told.join(" ")).toContain("a-model");
    expect(told.join(" ")).toContain("high");
    expect(told.join(" ")).toContain("s-1");
  });

  it("asks for tools without breaking when none are ready", () => {
    if (!adapter.tools) return;
    const dir = mkdtempSync(join(tmpdir(), "agent-"));
    const run = {
      mode: "look" as const,
      dir,
      approved: join(dir, "a.json"),
      acted: join(dir, "b.jsonl"),
    };
    expect(adapter.argv({ command: ["agent-program"], tools: run })[0]).toBe("agent-program");
  });

  it("offers only the tools a run names, and none when it names none (ADR 0045)", () => {
    if (!adapter.tools) return;
    const was = { file: process.env.SHIPIFY_TOOLS_FILE, key: process.env.SHIPIFY_JOT_READ };
    const home = mkdtempSync(join(tmpdir(), "agent-tools-"));
    const file = join(home, "tools.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        jot: {
          description: "A list of jots",
          run: ["node", "jot.mjs"],
          keys: { JOT_LOG: { look: "SHIPIFY_JOT_READ", act: "SHIPIFY_JOT_WRITE" } },
          look: ["list"],
          act: ["add"],
        },
      }),
    );
    process.env.SHIPIFY_TOOLS_FILE = file;
    process.env.SHIPIFY_JOT_READ = "a-key";
    try {
      /** Everything the adapter hands its agent: its command, and the settings it wrote. */
      const handed = (only?: string[]) => {
        const dir = mkdtempSync(join(home, "run-"));
        const argv = adapter.argv({
          command: ["agent-program"],
          tools: { mode: "look", dir, ...(only ? { only } : {}) },
        });
        return [
          argv.join(" "),
          ...readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")),
        ].join("\n");
      };
      expect(handed()).toContain("jot");
      expect(handed(["jot"])).toContain("jot");
      expect(handed([])).not.toContain("jot");
    } finally {
      if (was.file === undefined) delete process.env.SHIPIFY_TOOLS_FILE;
      else process.env.SHIPIFY_TOOLS_FILE = was.file;
      if (was.key === undefined) delete process.env.SHIPIFY_JOT_READ;
      else process.env.SHIPIFY_JOT_READ = was.key;
    }
  });

  it("reads its agent's real output into a report, and never throws on a line", () => {
    const reader = adapter.reader();
    for (const line of readFileSync(join(ROOT, RECORDED[name] as string), "utf8").split("\n"))
      if (line) reader.line(line);
    for (const junk of ["", "not json", "{}", "null", '{"type":"assistant"}'])
      expect(() => reader.line(junk)).not.toThrow();
    const report = reader.report();
    expect(report.version ?? pinned(name)).toBeTruthy();
    expect(report.model).toBeTruthy();
    expect(report.tokens?.output).toBeGreaterThan(0);
  });

  it("reports its model's last error in the model's own words (#233)", () => {
    const errored = ERRORED[name];
    expect(errored, `add ${name}'s agent ending on an error to ERRORED`).toBeTruthy();
    const reader = adapter.reader();
    for (const line of errored?.lines ?? []) reader.line(JSON.stringify(line));
    expect(reader.report().error).toBe(errored?.error);
  });

  it("writes the one setup as its own rules, in the run's folder: the same commands, folders and refusals", () => {
    const dir = mkdtempSync(join(tmpdir(), "setup-"));
    const commands = { deny: ["git push"], web: false };
    const argv = adapter.argv({
      command: ["agent-program"],
      commands,
      tools: { mode: "look", dir: join(dir, "tools"), root: ROOT },
      config: join(dir, "config"),
      folders: { read: [join(dir, "in")], write: [join(dir, "out")] },
    });
    const all = argv.join("\n");
    // Nothing of the setup lands outside the run's folder.
    for (const a of argv.filter((x) => x.startsWith("/"))) expect(a.startsWith(dir), a).toBe(true);
    if (name === "claude") {
      // Its command and look tools whole (ADR 0043): no list of what it may run.
      expect(argv).toEqual(expect.arrayContaining(["Bash", "Read", "Glob", "Grep"]));
      expect(all).not.toMatch(/Bash\((?!git \* push|git push)/);
      expect(argv).toEqual(
        expect.arrayContaining(["Bash(git push:*)", "Bash(git * push)", "Bash(git * push *)"]),
      );
      expect(argv).toEqual(expect.arrayContaining(["--setting-sources", "user"]));
      // Still acceptEdits (as executors.json says), never a mode where its rules are skipped.
      expect(all).not.toContain("bypassPermissions");
      expect(all).not.toContain("WebFetch");
    } else {
      const gate = JSON.parse(readFileSync(join(dir, "tools", "gate.json"), "utf8"));
      expect(gate).toMatchObject({ deny: commands.deny, write: [join(dir, "out")] });
      expect(gate.allow).toBeUndefined();
      expect(argv).toContain(join(dir, "tools", "gate.mjs"));
    }
  });

  it("decides the same commands as every agent: the refused ones in any form, and anything else (ADR 0043)", () => {
    const decide = DECIDES[name];
    expect(decide, `add how ${name}'s agent decides a command to DECIDES`).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "decide-"));
    const argv = adapter.argv({
      command: ["agent-program"],
      commands: { deny: ["git push", "git stash"], web: true },
      tools: { mode: "look", dir: join(dir, "tools"), root: ROOT },
      folders: { write: [join(dir, "out")] },
    });
    const refuses = decide?.(argv, join(dir, "tools")) ?? (() => false);
    for (const c of SAME.refused) expect(refuses(c), `${name} refuses ${c}`).toBe(true);
    for (const c of SAME.allowed) expect(refuses(c), `${name} runs ${c}`).toBe(false);
  });

  it("starts its agent in the read profile with reading tools only, inside its folders (ADR 0044)", () => {
    const decide = READS[name];
    expect(decide, `add how ${name}'s agent decides in the read profile to READS`).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "read-"));
    const folders = { read: [join(dir, "shipify"), join(dir, "in", "files")] };
    for (const d of [...folders.read, join(dir, "read", "acme", "tool")])
      mkdirSync(d, { recursive: true });
    const argv = adapter.argv({
      command: ["agent-program"],
      commands: { deny: ["git push", "git stash"], web: false, run: false },
      tools: { mode: "look", dir: join(dir, "tools"), root: ROOT },
      config: join(dir, "config"),
      folders,
    });
    // No tool's calls: a read run holds none of their keys.
    expect(argv).not.toContain("--mcp-config");
    if (name === "pi")
      expect(readFileSync(join(dir, "tools", "gate.json"), "utf8")).toContain('"look": []');
    const may = decide?.(argv, join(dir, "tools"), join(dir, "read"), folders.read) ?? {
      run: () => true,
      fetch: () => true,
      read: () => false,
    };
    expect(may.run("echo hi"), `${name} runs no command`).toBe(false);
    expect(may.fetch(), `${name} fetches no web page`).toBe(false);
    expect(may.read(join(dir, "read", "acme", "tool", "README.md")), "a read repo").toBe(true);
    expect(may.read(join(dir, "in", "files", "note.txt")), "your files").toBe(true);
    for (const outside of ["/etc/hostname", "/proc/self/environ", join(dir, "config", "x")])
      expect(may.read(outside), `${name} refuses ${outside}`).toBe(false);
  });

  it("names tool calls one way, and only its own models", () => {
    if (adapter.callName) {
      const a = adapter.callName("notion", "search");
      expect(a).toBeTruthy();
      expect(adapter.callName("notion", "read_page")).not.toBe(a);
    }
    expect(adapter.modelName?.("not-a-model-of-any-agent")).toBeUndefined();
  });
});

describe("where the agents decide differently (ADR 0043, docs/agents.md)", () => {
  const gate = { deny: ["git push", "git stash"] };

  it("holds Claude Code's recorded decisions to the version executors.json pins", () => {
    expect(CLAUDE.version).toBe(pinned("claude"));
  });

  it("Claude Code matches the words: a message or a search with `push` is refused, a path isn't", () => {
    for (const c of [
      'git commit --allow-empty -m "add push notifications"',
      "git log --oneline --grep push",
    ]) {
      expect(CLAUDE.refused, c).toContain(c);
      expect(refusedCommand(gate, c), c).toBeUndefined();
    }
    expect(CLAUDE.ran).toContain("/usr/bin/git push");
    expect(refusedCommand(gate, "/usr/bin/git push")).toBeTruthy();
    // Neither looks inside another shell: the read-only token and the box's own push are the wall.
    expect(CLAUDE.ran).toContain('sh -c "git push"');
    expect(refusedCommand(gate, 'sh -c "git push"')).toBeUndefined();
  });
});
