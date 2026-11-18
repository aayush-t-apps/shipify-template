// The agent plug-in's conformance test (ADR 0017, ADR 0027, cli/lib/plugins/agent.ts): executors.json
// is right entry by entry, and every adapter turns the core's one ask into its agent's command and
// reads its agent's real output into a report. A new adapter adds a recorded run of its agent to
// RECORDED, and passes the same tests.
import {
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain JavaScript, as Codex runs it
import { decide as codexDecides } from "../../cli/lib/agents/codex-gate.mjs";
// @ts-expect-error: plain JavaScript, as OpenCode loads it
import { ShipifyGate } from "../../cli/lib/agents/opencode-gate.mjs";
// @ts-expect-error: plain JavaScript, as pi loads it
import { refused, refusedCommand } from "../../cli/lib/agents/pi-gate.mjs";
import { AgentRecord, failedOf, formatted, RECORDS } from "../../cli/kernel/agent-check.ts";
import {
  ADAPTERS,
  defaultAgent,
  type Executors,
  loginOf,
  readExecutors,
} from "../../cli/lib/agents.ts";
import { DECISIONS, type Gateway, LOGIN_FD } from "../../cli/lib/plugins/agent.ts";
import { ROOT } from "../helpers.ts";

/** Each adapter's agent, recorded in a real run (with its version), for its reader. */
const RECORDED: Record<string, string> = {
  claude: "tests/fixtures/claude-stream.jsonl",
  pi: "tests/fixtures/pi-stream.jsonl",
  opencode: "tests/fixtures/opencode-stream.jsonl",
  codex: "tests/fixtures/codex-stream.jsonl",
};

/**
 * Codex's gate as its adapter wrote it into a run's tools folder (this file, and pi's gate beside
 * it), with its rules: its own answer to one of Codex's calls, as its PreToolUse hook gets it.
 */
function codexGate(tools: string) {
  for (const [to, from] of [
    ["gate.mjs", "codex-gate.mjs"],
    ["pi-gate.mjs", "pi-gate.mjs"],
  ] as const)
    expect(readFileSync(join(tools, to), "utf8")).toBe(
      readFileSync(join(ROOT, "cli/lib/agents", from), "utf8"),
    );
  const rules = JSON.parse(readFileSync(join(tools, "gate.json"), "utf8"));
  return (
    tool_name: string,
    tool_input: Record<string, unknown>,
    cwd: string,
  ): string | undefined => codexDecides(rules, { tool_name, tool_input, cwd }, tools);
}

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
  codex: {
    lines: [
      { type: "error", message: "You've hit your usage limit. Try again at 3:05 PM." },
      {
        type: "turn.failed",
        error: { message: "You've hit your usage limit. Try again at 3:05 PM." },
      },
    ],
    error: "You've hit your usage limit. Try again at 3:05 PM.",
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
  // Codex reads a skill with a command, as it reads any file.
  codex: [
    `cat ${SKILL}/notion/SKILL.md`,
    "sed -n 1,40p /work/src/skills.ts",
    `sed -n 1,80p ${SKILL}/test-driven-development/SKILL.md`,
    `cat '${SKILL}/test-driven-development/SKILL.md'`,
  ].map((command, i) => ({
    type: "item.completed",
    item: { id: `item_${i}`, type: "command_execution", command, status: "completed" },
  })),
};

/**
 * Each command its agent ran and one its rules refused, as its output says them: Claude Code's
 * tool call and its result's denial, pi's call and the gate's refusal at its end, OpenCode's gate's
 * own lines, Codex's command in its login shell and one its hook declined.
 */
const COMMANDS_SEEN: Record<string, unknown[]> = {
  claude: [
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "make verify" } },
          { type: "tool_use", id: "t2", name: "Bash", input: { command: "git push" } },
          { type: "tool_use", id: "t3", name: "Read", input: { file_path: "/work/a.ts" } },
        ],
      },
    },
    {
      type: "result",
      subtype: "success",
      permission_denials: [
        { tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "git push" } },
      ],
    },
  ],
  pi: [
    {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "make verify" },
    },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", isError: false, result: {} },
    {
      type: "tool_execution_start",
      toolCallId: "c2",
      toolName: "bash",
      args: { command: "git push" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "c2",
      toolName: "bash",
      isError: true,
      result: {
        content: [
          { type: "text", text: "Refused by Shipify's rules: `git push` isn't for an agent" },
        ],
      },
    },
  ],
  opencode: [
    { type: "shipify", call: "bash", command: "make verify" },
    { type: "shipify", call: "bash", command: "git push", refused: "Refused by Shipify's rules" },
  ],
  codex: [
    { cmd: "/usr/bin/bash -lc 'make verify'", status: "completed" },
    { cmd: "/usr/bin/bash -lc 'git push'", status: "declined" },
  ].map(({ cmd, status }, i) => ({
    type: "item.completed",
    item: { id: `item_${i}`, type: "command_execution", command: cmd, status },
  })),
};

/** Each agent's record (ADR 0079): what its pinned version did when it was checked live. */
const recordOf = (agent: string): AgentRecord | undefined => {
  const file = join(ROOT, RECORDS, `${agent}.json`);
  return existsSync(file) ? AgentRecord.parse(JSON.parse(readFileSync(file, "utf8"))) : undefined;
};
const CLAUDE = recordOf("claude") as AgentRecord;

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
 * Claude Code: its own answers, as its record says (checked live, ADR 0079), for exactly the rules
 * its adapter writes now: a change of the rules is checked live again, as its version is.
 * pi: its gate's own answer, with the rules pi's adapter wrote beside it.
 */
const DECIDES: Record<string, (argv: string[], tools: string) => (command: string) => boolean> = {
  claude(argv) {
    const recorded = CLAUDE.argv ?? [];
    for (const flag of ["--allowedTools", "--disallowedTools"])
      expect(after(argv, flag).filter(commandRule), flag).toEqual(
        after(recorded, flag).filter(commandRule),
      );
    return (command) => {
      const refused = Boolean(CLAUDE.refused?.includes(command));
      expect(refused || CLAUDE.ran?.includes(command), `its record's answer to ${command}`).toBe(
        true,
      );
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
  // Codex: its gate's own answer, as its PreToolUse hook for every call (checked live, as its
  // record says: Codex names its exec_command `Bash`, and a refusal stops the command), with its
  // own rules files not read at all.
  codex(argv, tools) {
    expect(argv).toEqual(expect.arrayContaining(["--ignore-rules", "--ignore-user-config"]));
    expect(argv.join("\n")).toContain(`command="node ${join(tools, "gate.mjs")}"`);
    const refuses = codexGate(tools);
    return (command) => Boolean(refuses("Bash", { command }, tools));
  },
};

/**
 * The agents that take no read run (ADR 0074): their commands can read their login (its entry's
 * `login.file`), and a read run runs no command, so the core never gives them one and their adapter
 * refuses it.
 */
const NO_READS = (name: string) => Boolean(ADAPTERS[name]?.loginFile);

/**
 * How each adapter's agent decides in the read profile (ADR 0044), from what its adapter wrote:
 * whether it may run a command, fetch a web page, and read a file. Claude Code: its own answers,
 * as its record's `read` says (the tools it was offered, checked live) for exactly the flags its
 * adapter writes, which offer no command or web tool, and keep reads inside its working folder and
 * its read folders. pi: its gate's own answers, with the rules pi's adapter wrote beside it.
 */
type Reads = { run: (c: string) => boolean; fetch: () => boolean; read: (f: string) => boolean };
const READS: Record<string, (argv: string[], tools: string, cwd: string, read: string[]) => Reads> =
  {
    claude(argv, _tools, cwd, read) {
      const recorded = CLAUDE.read?.argv ?? [];
      const flags = (a: string[]) =>
        a.slice(a.indexOf("--restricted"), a.indexOf("--restricted") + 3);
      expect(recorded).toContain("--restricted");
      expect(flags(argv)).toEqual(flags(recorded));
      expect(after(recorded, "--permission-mode")).toEqual(["acceptEdits"]);
      expect(argv).not.toContain("bypassPermissions");
      for (const d of read) expect(argv.join(" ")).toContain(`--add-dir ${d}`);
      const tools = CLAUDE.read?.tools ?? [];
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
 * Claude Code: its own setting, checked live on each version (its record's `login`: it answered
 * with the login on fd 3, which was in neither its environment nor its files). pi: Shipify's gate
 * reads it, closes the pipe and hands the key to the gateway's provider, which its adapter names
 * in the gate's rules.
 */
type Piped = (vars: Record<string, string>) => Promise<void> | void;
const PIPED: Record<string, Piped> = {
  claude(vars) {
    expect(vars).toEqual({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(LOGIN_FD) });
    expect(CLAUDE.checks.login?.ok, "its record: it read its login from fd 3").toBe(true);
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
      tools: { mode: "look", dir: tools },
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
  // gateway's provider alone (OpenCode's `chat.headers`); its config holds none. Checked live, as
  // its record says: a dummy key on fd 3 (a pipe, or a socket off a box) reached a stand-in
  // gateway, and a command it ran had no fd 3 and no key in its environment.
  async opencode(vars) {
    expect(vars).toEqual({ SHIPIFY_LOGIN_FD: String(LOGIN_FD) });
    const dir = mkdtempSync(join(tmpdir(), "piped-"));
    const tools = join(dir, "tools");
    const { gateways } = readExecutors(join(ROOT, "executors.json"));
    ADAPTERS.opencode?.argv({
      command: ["opencode", "run"],
      model: "z-ai/glm-5.3",
      gateway: { ...(gateways.openrouter as Gateway), id: "openrouter" },
      tools: { mode: "look", dir: tools },
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
    expect(recordOf("opencode")?.checks.login?.ok, "its record: its gate read the key").toBe(true);
  },
};

/**
 * How each adapter's agent finds Shipify's skills (ADR 0038), from what its adapter does with the
 * run's skills folder: a flag, or a link where it reads its own. Each version is checked live
 * (its record's `skills`): every skill in skills/ listed by the agent itself (Claude Code's init
 * event, pi's skill list), or one it was asked to load, loaded.
 */
type Handed = (argv: string[], link: string | undefined, paths: { config: string }) => void;
const SKILLS_HANDED: Record<string, Handed> = {
  claude(argv, link, paths) {
    expect(link).toBe(join(paths.config, "skills"));
    expect(argv).not.toContain("--disable-slash-commands");
  },
  pi(argv, link) {
    expect(link).toBeUndefined();
    expect(after(argv, "--skill")).toEqual([join(ROOT, "skills")]);
    expect(argv).not.toContain("--no-skills");
  },
  // OpenCode: its config's skills.paths (the run's tools folder, beside its config folder).
  opencode(argv, link, paths) {
    expect(link).toBeUndefined();
    expect(argv).not.toContain("--pure");
    const config = JSON.parse(
      readFileSync(join(paths.config, "..", "tools", "opencode.json"), "utf8"),
    );
    expect(config.skills).toEqual({ paths: [join(ROOT, "skills")] });
  },
  // Codex: a link where it reads a user's ($HOME/.agents/skills, still read with its own config
  // ignored), and its own bundled ones off.
  codex(argv, link) {
    expect(link?.endsWith("/home/.agents/skills")).toBe(true);
    expect(argv).toContain("skills.bundled.enabled=false");
  },
};

/**
 * How each adapter's agent follows the repo it works in (`work`, its working folder): that repo's
 * AGENTS.md and no other folder's; in the read profile, no repo's (ADR 0044). Each version is checked
 * live (its record's `instructions`: the word in the scratch repo's AGENTS.md).
 */
type Follows = (
  argv: string[],
  run: { tools: string; work: string; write: string[]; reading: boolean },
) => Promise<void> | void;
const FOLLOWS: Record<string, Follows> = {
  // Claude Code: `--setting-sources user` leaves out the project's CLAUDE.md, so the repo is an
  // added folder whose CLAUDE.md it reads (a Shipify project's says `@AGENTS.md`), and none in a
  // folder it writes. Checked live on 2.1.284 against a stand-in API: without these, no word of the
  // repo's reached it; without the exclude, an out/ CLAUDE.md did.
  claude(argv, { work, write, reading }) {
    const settings = after(argv, "--settings");
    if (reading) {
      expect(settings).toEqual([]);
      expect(argv).not.toContain(work);
      return;
    }
    expect(argv.join(" ")).toContain(`--add-dir ${work}`);
    expect(JSON.parse(settings[0] ?? "{}")).toEqual({
      env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" },
      claudeMdExcludes: write.map((d) => `${d}/**`),
    });
  },
  // pi: its working folder's (and its parents'), by itself; none with `--no-context-files`.
  pi(argv, { reading }) {
    expect(argv.includes("--no-context-files")).toBe(reading);
  },
  // OpenCode: with the project's config off, the repo's AGENTS.md by its path in `instructions`.
  // Its read tool adds the AGENTS.md of each folder between a file and its working folder (1.18.34's
  // source): the gate keeps them only when they're all the work repo's.
  async opencode(_argv, { tools, work, reading }) {
    const config = JSON.parse(readFileSync(join(tools, "opencode.json"), "utf8"));
    expect(config.instructions).toEqual(reading ? undefined : [join(work, "AGENTS.md")]);
    const { ShipifyGate: gate } = await import(join(tools, "gate.mjs"));
    const hook = (await gate())["tool.execute.after"];
    const read = async (tool: string, ...loaded: string[]) => {
      const file = `<path>${work}/src/a.ts</path>\n<type>file</type>\n<content>\n1: x\n</content>`;
      const added = loaded.map((p) => `Instructions from: ${p}\nSay the word.`).join("\n\n");
      const output = {
        title: "a.ts",
        output: `${file}${loaded.length ? `\n\n<system-reminder>\n${added}\n</system-reminder>` : ""}`,
        metadata: { loaded },
      };
      await hook({ tool, sessionID: "s", callID: "c", args: {} }, output);
      return output.output.includes("Say the word.") ? "kept" : "dropped";
    };
    const own = join(work, "src", "AGENTS.md");
    const other = join(dirname(work), "read", "acme", "AGENTS.md");
    expect(await read("read", own)).toBe(reading ? "dropped" : "kept");
    expect(await read("read", other)).toBe("dropped");
    expect(await read("read", own, other)).toBe("dropped");
    // A folder beside it whose name starts the same isn't its.
    expect(await read("read", `${work}-other/AGENTS.md`)).toBe("dropped");
    // Another tool's output is its own.
    expect(await read("grep", other)).toBe("kept");
  },
  // Codex: its working folder's (from the repo's root), by itself; its home's own is cleared before
  // every ask. It takes no read run.
  codex(argv) {
    expect(argv.join(" ")).not.toContain("project_doc");
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
      // Auto on a plan of its login: a listed model, and an adapter that reads the plan.
      for (const [plan, m] of Object.entries(e.auto?.plans ?? {})) {
        expect(e.models, `${id}: Auto on ${plan}`).toContain(m);
        expect(ADAPTERS[e.adapter ?? ""]?.plan, `${id}: a plan read`).toBeTypeOf("function");
      }
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

  it("names each tool the run's look server serves as a remote one, with the run's token as its bearer, and none without one (ADR 0077)", () => {
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
      const handed = (tools?: string[]) => {
        const dir = mkdtempSync(join(home, "run-"));
        const argv = adapter.argv({
          command: ["agent-program"],
          tools: {
            mode: "look",
            dir,
            ...(tools ? { served: { url: "http://127.0.0.1:4000", tools } } : {}),
          },
        });
        return [
          argv.join(" "),
          ...readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")),
        ].join("\n");
      };
      const served = handed(["jot"]);
      expect(served).toContain("http://127.0.0.1:4000/jot");
      // The token by its name, as each agent writes a variable: never a value, nor the tool's key.
      expect(served).toMatch(/SHIPIFY_LOOK_TOKEN/);
      expect(served).toMatch(/Bearer|bearer_token_env_var/);
      expect(served).not.toMatch(/SHIPIFY_JOT_READ|a-key|jot\.mjs/);
      // No look server, no tools: never the tool's own server or key instead.
      expect(handed()).not.toContain("jot");
      expect(handed([])).not.toContain("jot");
    } finally {
      if (was.file === undefined) delete process.env.SHIPIFY_TOOLS_FILE;
      else process.env.SHIPIFY_TOOLS_FILE = was.file;
      if (was.key === undefined) delete process.env.SHIPIFY_JOT_READ;
      else process.env.SHIPIFY_JOT_READ = was.key;
    }
  });

  it("reads its agent's real output into a report, and never throws on a line", () => {
    // The run's model, as the core hands it over: for an agent whose output doesn't name it.
    const reader = adapter.reader({ model: "the-runs-model" });
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
      tools: { mode: "look", dir: join(dir, "tools") },
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
      // Its gate loads: pi's with -e, OpenCode's as the plugin its config names, beside it, and
      // Codex's as its PreToolUse hook.
      if (name === "opencode")
        expect(
          JSON.parse(readFileSync(join(dir, "tools", "opencode.json"), "utf8")).plugin,
        ).toEqual(["./gate.mjs"]);
      else if (name === "codex")
        expect(all).toContain(
          `hooks.PreToolUse=[{matcher="*",hooks=[{type="command",command="node ${join(dir, "tools", "gate.mjs")}"}]}]`,
        );
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
      tools: { mode: "look", dir: join(dir, "tools") },
      folders: { write: [join(dir, "out")] },
    });
    const refuses = decide?.(argv, join(dir, "tools")) ?? (() => false);
    for (const c of DECISIONS.refused) expect(refuses(c), `${name} refuses ${c}`).toBe(true);
    for (const c of DECISIONS.ran) expect(refuses(c), `${name} runs ${c}`).toBe(false);
    // Its record's decisions, when it has some, are what it decides: the four where the agents
    // differ too.
    const record = recordOf(name);
    for (const c of [...(record?.refused ?? []), ...(record?.ran ?? [])])
      expect(refuses(c), `${name}'s record: ${c}`).toBe(Boolean(record?.refused?.includes(c)));
  });

  it("has a record of the version executors.json pins, each of its checks passed (ADR 0079)", () => {
    const record = recordOf(name);
    const version = pinned(name);
    const start = `checked live on a box: start \`shipify: update ${name} to ${version}\``;
    expect(record, start).toBeDefined();
    expect(record?.agent).toBe(name);
    expect(record?.version, start).toBe(version);
    expect(failedOf(record as AgentRecord), start).toEqual([]);
    // A box checks each of these (the read profile, for an agent that takes read runs).
    if (record?.on === "box")
      expect(Object.keys(record.checks)).toEqual(
        expect.arrayContaining([
          "answers",
          "login",
          "skills",
          "instructions",
          "decisions",
          ...(NO_READS(name) ? [] : ["read"]),
        ]),
      );
  });

  it("reports each command its agent ran or was refused, as written, and what it was offered when its output says (ADR 0079)", () => {
    const seen = COMMANDS_SEEN[name];
    expect(
      seen,
      `add how ${name}'s agent runs and is refused a command to COMMANDS_SEEN`,
    ).toBeTruthy();
    const reader = adapter.reader();
    for (const line of seen ?? []) reader.line(JSON.stringify(line));
    expect(reader.report().commands).toEqual([
      { command: "make verify", refused: false },
      { command: "git push", refused: true },
    ]);
    // Its recorded run: what it was offered, as its output says it (Claude Code's init event).
    const recorded = adapter.reader({ model: "the-runs-model" });
    for (const line of readFileSync(join(ROOT, RECORDED[name] as string), "utf8").split("\n"))
      if (line) recorded.line(line);
    const offered = recorded.report().offered;
    if (name === "claude") {
      expect(offered?.tools).toEqual(expect.arrayContaining(["Bash", "Read", "Skill", "Task"]));
      expect(offered?.helpers).toEqual(expect.arrayContaining(["general-purpose"]));
      expect(offered?.skills?.length).toBeGreaterThan(0);
    } else if (offered) expect(offered.tools?.length).toBeGreaterThan(0);
  });

  it("starts its agent in the read profile with reading tools only, inside its folders (ADR 0044)", () => {
    const dir = mkdtempSync(join(tmpdir(), "read-"));
    const folders = { read: [join(dir, "shipify"), join(dir, "in", "files")] };
    for (const d of [...folders.read, join(dir, "read", "acme", "tool")])
      mkdirSync(d, { recursive: true });
    const run = {
      command: ["agent-program"],
      commands: { deny: ["git push", "git stash"], web: false, run: false },
      tools: { mode: "look" as const, dir: join(dir, "tools") },
      config: join(dir, "config"),
      folders,
    };
    // One whose login is a file takes none (ADR 0074): its entry says so, and it's never started.
    if (NO_READS(name)) {
      const entry = Object.values(readExecutors(join(ROOT, "executors.json")).executors).find(
        (e) => e.adapter === name,
      );
      expect(entry?.login?.file).toBe(true);
      expect(() => adapter.argv(run)).toThrow(/takes no read run/);
      return;
    }
    const decide = READS[name];
    expect(decide, `add how ${name}'s agent decides in the read profile to READS`).toBeTruthy();
    const argv = adapter.argv(run);
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

  it("takes its login on a pipe (fd 3), or as a file of its run's own, never in its environment", async () => {
    const login = loginName(name);
    expect(login, `${name}'s agent has a login in executors.json`).toBeTruthy();
    // A login its agent reads only from a file (ADR 0074): in the run's own folders, as its entry
    // says (so it never thinks for a read run or a guest's), and nothing on the pipe or in its
    // environment (think's handOver: tests/agent-codex.test.ts).
    if (adapter.loginFile) {
      const dir = mkdtempSync(join(tmpdir(), "login-"));
      const paths = { home: join(dir, "home"), config: join(dir, "config"), tools: join(dir, "t") };
      expect(adapter.loginFile(paths).startsWith(`${dir}/`)).toBe(true);
      for (const c of adapter.cleared?.(paths) ?? []) expect(c).not.toBe(adapter.loginFile(paths));
      expect(adapter.loginFromPipe).toBeUndefined();
      const entry = Object.values(readExecutors(join(ROOT, "executors.json")).executors).find(
        (e) => e.adapter === name,
      );
      expect(entry?.login?.file).toBe(true);
      expect(Object.values(adapter.env?.(paths) ?? {}).join(" ")).not.toContain(login);
      return;
    }
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
      tools: { mode: "look" as const, dir: join(dir, "tools") },
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
    if (NO_READS(name)) return;
    const reading = adapter.argv({ ...run, commands: { ...run.commands, run: false } });
    if (!link) expect(reading.join(" ")).not.toContain(join(ROOT, "skills"));
  });

  it("follows its work repo's AGENTS.md, never a read repo's, and no repo's in the read profile", async () => {
    const follows = FOLLOWS[name];
    expect(follows, `add how ${name}'s agent follows its work repo's to FOLLOWS`).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "follows-"));
    const work = join(dir, "work");
    const write = [join(dir, "out")];
    const tools = join(dir, "tools");
    const run = {
      command: ["agent-program"],
      commands: { deny: ["git push"], web: true },
      tools: { mode: "look" as const, dir: tools },
      config: join(dir, "config"),
      folders: { read: [join(dir, "in")], write },
      work,
    };
    await follows?.(adapter.argv(run), { tools, work, write, reading: false });
    if (NO_READS(name)) return;
    // The core gives a read run no work folder; its adapter would add none of it anyway.
    const reading = { ...run, commands: { ...run.commands, run: false }, folders: { read: [] } };
    await follows?.(adapter.argv(reading), { tools, work, write: [], reading: true });
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
  const [message, search, path, shell] = DECISIONS.differ;

  it("Claude Code matches the words: a message or a search with `push` is refused, and a path", () => {
    for (const c of [message, search]) {
      expect(CLAUDE.refused, c).toContain(c);
      expect(refusedCommand(gate, c), c).toBeUndefined();
    }
    // Refused by both since Claude Code 2.1.326 (2.1.284 ran it).
    expect(CLAUDE.refused).toContain(path);
    expect(refusedCommand(gate, path)).toBeTruthy();
    // Claude Code doesn't look inside another shell (the read-only token and the box's own push are
    // the wall); Shipify's gate does.
    expect(CLAUDE.ran).toContain(shell);
    expect(refusedCommand(gate, shell)).toBeTruthy();
  });
});

describe("the agents' records (ADR 0079)", () => {
  const { executors } = readExecutors(join(ROOT, "executors.json"));
  const programs = Object.entries(executors).filter(([, e]) => e.install && !e.extends);

  it("one for each agent the box installs, and none for another", () => {
    const files = readdirSync(join(ROOT, RECORDS)).sort();
    expect(files).toEqual(programs.map(([id]) => `${id}.json`).sort());
  });

  it("are written as the repo's formatter writes them, so a box's record passes its checks", () => {
    for (const [id] of programs) {
      const text = readFileSync(join(ROOT, RECORDS, `${id}.json`), "utf8");
      expect(`${formatted(JSON.parse(text))}\n`, id).toBe(text);
    }
  });
});
