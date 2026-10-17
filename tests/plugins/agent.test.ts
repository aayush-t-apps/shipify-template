// The agent plug-in's conformance test (ADR 0017, ADR 0027, cli/lib/plugins/agent.ts): executors.json
// is right entry by entry, and every adapter turns the core's one ask into its agent's command and
// reads its agent's real output into a report. A new adapter adds a recorded run of its agent to
// RECORDED, and passes the same tests.
import {
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain JavaScript, as OpenCode loads it
import { ShipifyGate } from "../../cli/lib/agents/opencode-gate.mjs";
// @ts-expect-error: plain JavaScript, as pi loads it
import { refused, refusedCommand } from "../../cli/lib/agents/pi-gate.mjs";
import {
  ADAPTERS,
  defaultAgent,
  type Executors,
  loginOf,
  readExecutors,
} from "../../cli/lib/agents.ts";
import { type Gateway, LOGIN_FD } from "../../cli/lib/plugins/agent.ts";
import { ROOT } from "../helpers.ts";

/** Each adapter's agent, recorded in a real run (with its version), for its reader. */
const RECORDED: Record<string, string> = {
  claude: "tests/fixtures/claude-stream.jsonl",
  pi: "tests/fixtures/pi-stream.jsonl",
  opencode: "tests/fixtures/opencode-stream.jsonl",
};

/**
 * OpenCode's gate as its adapter wrote it into a run's tools folder (this file, and pi's gate beside
 * it), with its rules: its own check of one of OpenCode's calls.
 */
function openCodeGate(tools: string) {
  for (const [to, from] of [
    ["gate.mjs", "opencode-gate.mjs"],
    ["pi-gate.mjs", "pi-gate.mjs"],
  ] as const)
    expect(readFileSync(join(tools, to), "utf8")).toBe(
      readFileSync(join(ROOT, "cli/lib/agents", from), "utf8"),
    );
  const rules = JSON.parse(readFileSync(join(tools, "gate.json"), "utf8"));
  return (tool: string, args: Record<string, unknown>, cwd: string): string | undefined =>
    ShipifyGate.refused(rules, tool, args, cwd, tools);
}

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
  opencode: {
    lines: [
      {
        type: "error",
        sessionID: "ses_1",
        error: {
          name: "APIError",
          data: { message: "z-ai/glm-9 is not a valid model ID", statusCode: 400 },
        },
      },
    ],
    error: "z-ai/glm-9 is not a valid model ID",
  },
};

/**
 * Each adapter's agent loading skills its own way: Claude Code's Skill tool or a Read,
 * pi's read of a SKILL.md, OpenCode's skill tool or a read, as its gate says them. Each loads
 * test-driven-development twice and reads one file that isn't a skill.
 */
const SKILL = "/opt/shipify/skills";
const SKILL_LOADS: Record<string, unknown[]> = {
  claude: [
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Skill", input: { skill: "test-driven-development" } },
          { type: "tool_use", name: "Read", input: { file_path: `${SKILL}/notion/SKILL.md` } },
          { type: "tool_use", name: "Read", input: { file_path: "/work/src/skills.ts" } },
          { type: "tool_use", name: "Skill", input: { skill: "test-driven-development" } },
        ],
      },
    },
  ],
  pi: [
    { type: "tool_execution_start", toolName: "read", args: { path: `${SKILL}/notion/SKILL.md` } },
    { type: "tool_execution_start", toolName: "read", args: { path: "/work/src/skills.ts" } },
    ...[1, 2].map(() => ({
      type: "tool_execution_start",
      toolName: "read",
      args: { path: `${SKILL}/test-driven-development/SKILL.md` },
    })),
  ],
  opencode: [
    { type: "shipify", call: "skill", skill: "test-driven-development" },
    { type: "shipify", call: "read", path: `${SKILL}/notion/SKILL.md` },
    { type: "shipify", call: "read", path: "/work/src/skills.ts" },
    { type: "shipify", call: "skill", skill: "test-driven-development" },
  ],
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
  // OpenCode: its gate's own answer (its own permissions refuse fewer forms, so they're a second
  // line), with the config its adapter wrote loading it.
  opencode(_argv, tools) {
    const config = JSON.parse(readFileSync(join(tools, "opencode.json"), "utf8"));
    expect(config.plugin).toEqual(["./gate.mjs"]);
    expect(config.permission.bash).toMatchObject({ "*": "allow", "git push*": "deny" });
    const refuses = openCodeGate(tools);
    return (command) => Boolean(refuses("bash", { command }, tools));
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
    // OpenCode: every tool but its reading ones denied (out of the model's list), and its gate's
    // own answers for what's left.
    opencode(_argv, tools, cwd) {
      const config = JSON.parse(readFileSync(join(tools, "opencode.json"), "utf8"));
      expect(config.permission).toMatchObject({ "*": "deny", read: "allow", grep: "allow" });
      expect(config.mcp).toBeUndefined();
      expect(config.skills).toBeUndefined();
      const refuses = openCodeGate(tools);
      return {
        run: (c) => config.permission.bash === "allow" && !refuses("bash", { command: c }, cwd),
        fetch: () => config.permission.webfetch === "allow" && !refuses("webfetch", {}, cwd),
        read: (f) => !refuses("read", { filePath: f }, cwd),
      };
    },
  };

/** The version an adapter's agent runs: its own say, else the one executors.json pins. */
const pinned = (adapter: string) =>
  Object.values(readExecutors(join(ROOT, "executors.json")).executors).find(
    (e) => e.adapter === adapter,
  )?.install?.version;

/** The login of an adapter's agent, as executors.json names it: its own, or its gateway's key. */
const loginName = (adapter: string) => {
  const { executors, gateways } = readExecutors(join(ROOT, "executors.json"));
  return loginOf(
    Object.values(executors).find((e) => e.adapter === adapter),
    gateways,
  )?.secret;
};

/**
 * How each adapter's agent reads its login from the pipe, given the variables its adapter names.
 * Claude Code: its own setting, checked live on the version executors.json pins (a dummy login on
 * fd 3 reached a stand-in API, and was in neither its environment nor its files); check it again
 * when the version moves. pi: Shipify's gate reads it, closes the pipe and hands the key to the
 * gateway's provider, which its adapter names in the gate's rules.
 */
type Piped = (vars: Record<string, string>) => Promise<void> | void;
const PIPED: Record<string, Piped> = {
  claude(vars) {
    expect(vars).toEqual({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(LOGIN_FD) });
    expect(pinned("claude"), "check live that Claude Code reads its login from fd 3").toBe(
      "2.1.284",
    );
  },
  async pi(vars) {
    expect(vars).toEqual({ SHIPIFY_LOGIN_FD: String(LOGIN_FD) });
    const dir = mkdtempSync(join(tmpdir(), "piped-"));
    const tools = join(dir, "tools");
    const { gateways } = readExecutors(join(ROOT, "executors.json"));
    ADAPTERS.pi?.argv({
      command: ["pi"],
      model: "z-ai/glm-5.3",
      gateway: { ...(gateways.openrouter as Gateway), id: "openrouter" },
      tools: { mode: "look", dir: tools, root: ROOT },
    });
    // The pipe stands in as a file here: the gate reads what the variable names, then closes it.
    writeFileSync(join(dir, "login"), "sk-or-piped\n");
    const fd = openSync(join(dir, "login"), "r");
    const was = process.env.SHIPIFY_LOGIN_FD;
    process.env.SHIPIFY_LOGIN_FD = String(fd);
    const given: [string, unknown][] = [];
    try {
      const { default: gate } = await import(join(tools, "gate.mjs"));
      gate({
        on() {},
        registerProvider: (name: string, config: unknown) => given.push([name, config]),
      });
      expect(given).toEqual([["shipify-openrouter", { apiKey: "sk-or-piped" }]]);
      expect(() => fstatSync(fd), "the pipe is closed once read").toThrow();
      expect(process.env.SHIPIFY_LOGIN_FD).toBeUndefined();
    } finally {
      if (was === undefined) delete process.env.SHIPIFY_LOGIN_FD;
      else process.env.SHIPIFY_LOGIN_FD = was;
    }
  },
  // OpenCode: as pi's, its gate reads the key, closes the pipe, and puts it on each call to the
  // gateway's provider alone (OpenCode's `chat.headers`); its config holds none. Checked live on the
  // version executors.json pins: a dummy key on fd 3 (a pipe, or a socket off a box) reached a
  // stand-in gateway, and a command it ran had no fd 3 and no key in its environment.
  async opencode(vars) {
    expect(vars).toEqual({ SHIPIFY_LOGIN_FD: String(LOGIN_FD) });
    const dir = mkdtempSync(join(tmpdir(), "piped-"));
    const tools = join(dir, "tools");
    const { gateways } = readExecutors(join(ROOT, "executors.json"));
    ADAPTERS.opencode?.argv({
      command: ["opencode", "run"],
      model: "z-ai/glm-5.3",
      gateway: { ...(gateways.openrouter as Gateway), id: "openrouter" },
      tools: { mode: "look", dir: tools, root: ROOT },
    });
    const config = JSON.parse(readFileSync(join(tools, "opencode.json"), "utf8"));
    expect(config.provider["shipify-openrouter"].options).toEqual({
      baseURL: gateways.openrouter?.url,
    });
    writeFileSync(join(dir, "login"), "sk-or-piped\n");
    const fd = openSync(join(dir, "login"), "r");
    const was = process.env.SHIPIFY_LOGIN_FD;
    process.env.SHIPIFY_LOGIN_FD = String(fd);
    try {
      const { ShipifyGate: gate } = await import(join(tools, "gate.mjs"));
      const first = await gate();
      expect(() => fstatSync(fd), "the pipe is closed once read").toThrow();
      expect(process.env.SHIPIFY_LOGIN_FD).toBeUndefined();
      const headers = async (hooks: typeof first, providerID: string) => {
        const output = { headers: {} as Record<string, string> };
        await hooks["chat.headers"]({ model: { providerID } }, output);
        return output.headers;
      };
      const key = { Authorization: "Bearer sk-or-piped" };
      expect(await headers(first, "shipify-openrouter")).toEqual(key);
      // Read once: a second start of the plugin still has it; another provider never gets it.
      expect(await headers(await gate(), "shipify-openrouter")).toEqual(key);
      expect(await headers(first, "anthropic")).toEqual({});
      // The config it runs with, once OpenCode has read every source, must be its adapter's: with
      // its provider's calls sent elsewhere (a source read after it, such as OpenCode's sessions'
      // database, which a run can write), it never gets the key.
      const plugin = [pathToFileURL(join(tools, "gate.mjs")).href];
      await first.config({ plugin, provider: config.provider });
      expect(await headers(first, "shipify-openrouter")).toEqual(key);
      const ours = config.provider["shipify-openrouter"];
      const elsewhere = { ...ours, options: { baseURL: "https://elsewhere.example/v1" } };
      await first.config({ plugin, provider: { "shipify-openrouter": elsewhere } });
      expect(await headers(first, "shipify-openrouter")).toEqual({});
    } finally {
      if (was === undefined) delete process.env.SHIPIFY_LOGIN_FD;
      else process.env.SHIPIFY_LOGIN_FD = was;
    }
    expect(pinned("opencode"), "check live that OpenCode reads its key from fd 3").toBe("1.18.34");
  },
};

/**
 * How each adapter's agent finds Shipify's skills (ADR 0038), from what its adapter does with the
 * run's skills folder: a flag, or a link where it reads its own. Each was checked live on the
 * version executors.json pins: every skill in skills/ listed by the agent itself (Claude Code's
 * init event, pi's skill list); check it again when the version moves.
 */
type Handed = (argv: string[], link: string | undefined, paths: { config: string }) => void;
const SKILLS_HANDED: Record<string, Handed> = {
  claude(argv, link, paths) {
    expect(link).toBe(join(paths.config, "skills"));
    expect(argv).not.toContain("--disable-slash-commands");
    expect(pinned("claude"), "check live that Claude Code lists the linked skills").toBe("2.1.284");
  },
  pi(argv, link) {
    expect(link).toBeUndefined();
    expect(after(argv, "--skill")).toEqual([join(ROOT, "skills")]);
    expect(argv).not.toContain("--no-skills");
    expect(pinned("pi"), "check live that pi lists the skills it's given").toBe("1.0.2");
  },
  // OpenCode: its config's skills.paths (the run's tools folder, beside its config folder).
  opencode(argv, link, paths) {
    expect(link).toBeUndefined();
    expect(argv).not.toContain("--pure");
    const config = JSON.parse(
      readFileSync(join(paths.config, "..", "tools", "opencode.json"), "utf8"),
    );
    expect(config.skills).toEqual({ paths: [join(ROOT, "skills")] });
    expect(pinned("opencode"), "check live that OpenCode lists the skills it's given").toBe(
      "1.18.34",
    );
  },
};

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
      for (const name of Object.keys(e.modelEfforts ?? {}))
        expect(e.models, `${id}: ${name}`).toContain(name);
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

  it("chooses the default unless the repo's variable names one", () => {
    const all: Executors = {
      plain: { description: "a plain program", command: ["plain"] },
      main: { description: "the default", adapter: "claude", default: true, command: ["x"] },
    };
    expect(defaultAgent(all, "")).toBe("main");
    expect(defaultAgent(all, "plain")).toBe("plain");
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

  it("reports the skills its agent loaded, each once", () => {
    const loads = SKILL_LOADS[name];
    expect(loads, `add how ${name}'s agent loads a skill to SKILL_LOADS`).toBeTruthy();
    const reader = adapter.reader();
    for (const line of loads ?? []) reader.line(JSON.stringify(line));
    expect(reader.report().skills).toEqual(["notion", "test-driven-development"]);
    // A run that loaded none says none.
    const quiet = adapter.reader();
    for (const line of readFileSync(join(ROOT, RECORDED[name] as string), "utf8").split("\n"))
      if (line) quiet.line(line);
    expect(quiet.report().skills).toBeUndefined();
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
      // Its gate loads: pi's with -e, OpenCode's as the plugin its config names, beside it.
      if (name === "opencode")
        expect(
          JSON.parse(readFileSync(join(dir, "tools", "opencode.json"), "utf8")).plugin,
        ).toEqual(["./gate.mjs"]);
      else expect(argv).toContain(join(dir, "tools", "gate.mjs"));
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

  it("takes its login on a pipe (fd 3), never in its environment", async () => {
    const login = loginName(name);
    expect(login, `${name}'s agent has a login in executors.json`).toBeTruthy();
    const vars = adapter.loginFromPipe?.(login as string);
    expect(vars, `say how ${name}'s agent reads its login from fd 3 (loginFromPipe)`).toBeTruthy();
    // Only where to read it, never a key: the login's own name isn't among them.
    expect(Object.keys(vars ?? {})).not.toContain(login);
    for (const v of Object.values(vars ?? {})) expect(v).toBe(String(LOGIN_FD));
    const piped = PIPED[name];
    expect(piped, `add how ${name}'s agent reads its login from the pipe to PIPED`).toBeTruthy();
    await piped?.(vars ?? {});
  });

  it("hands its agent Shipify's skills, and none in the read profile (ADR 0038)", () => {
    const handed = SKILLS_HANDED[name];
    expect(handed, `add how ${name}'s agent finds Shipify's skills to SKILLS_HANDED`).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const paths = {
      home: join(dir, "home"),
      config: join(dir, "config"),
      tools: join(dir, "in", "tools"),
    };
    const run = {
      command: ["agent-program"],
      commands: { deny: ["git push"], web: true },
      tools: { mode: "look" as const, dir: join(dir, "tools"), root: ROOT },
      config: paths.config,
      skills: join(ROOT, "skills"),
    };
    const link = adapter.skillsLink?.(paths);
    // A link stays in the agent's own folders, where the run makes it as the agent.
    if (link) expect(link.startsWith(`${dir}/`), link).toBe(true);
    handed?.(adapter.argv(run), link, paths);
    // Shipify's skills alone: Claude Code's own bundled ones (loop, schedule, claude-api…) are off.
    if (name === "claude")
      expect(adapter.env?.(paths).CLAUDE_CODE_DISABLE_BUNDLED_SKILLS).toBe("1");
    // The read profile reads nothing of Shipify's: the core gives no skills, and none are added.
    const reading = adapter.argv({ ...run, commands: { ...run.commands, run: false } });
    if (!link) expect(reading.join(" ")).not.toContain(join(ROOT, "skills"));
  });

  it("asks for read-only and cleared paths only inside the run's own: where its agent reads its rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "read-only-"));
    const paths = {
      home: join(dir, "home"),
      config: join(dir, "config"),
      tools: join(dir, "in", "tools"),
    };
    for (const d of [...(adapter.readOnly?.(paths) ?? []), ...(adapter.cleared?.(paths) ?? [])])
      expect(d.startsWith(`${dir}/`), d).toBe(true);
    // OpenCode installs its plugin package from npm into its own config folder when it can write it,
    // loads its home's .opencode (its config, plugins, agents) after its own config, and takes its
    // provider's package from its cache's models list.
    if (name === "opencode") {
      const env = adapter.env?.(paths) ?? {};
      expect(adapter.readOnly?.(paths)).toEqual([join(env.XDG_CONFIG_HOME ?? "?", "opencode")]);
      expect(adapter.cleared?.(paths)).toEqual([join(paths.home, ".opencode"), env.XDG_CACHE_HOME]);
    }
    // Claude Code reads its own user's settings (`--setting-sources user`): hooks, env, a key helper.
    if (name === "claude")
      expect(adapter.cleared?.(paths)).toEqual([join(paths.config, "settings.json")]);
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
    // Claude Code doesn't look inside another shell (the read-only token and the box's own push are
    // the wall); Shipify's gate does.
    expect(CLAUDE.ran).toContain('sh -c "git push"');
    expect(refusedCommand(gate, 'sh -c "git push"')).toBeTruthy();
  });
});
