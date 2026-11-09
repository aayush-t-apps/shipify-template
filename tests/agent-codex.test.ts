// Codex on your ChatGPT plan (ADR 0074), off a box, through the real core: its login is a file the
// run writes in its own folders before the first ask (never on the pipe or in its environment),
// Codex refreshes it there, and `ship run renew` writes only a newer session for the same account
// back to its secret. A read run and a guest's never start it. Its gate decides as Codex's
// PreToolUse hook, a process of its own; its reader says what Codex's events say; and its sign-in
// sets a session after its own login, asking first on a plan OpenAI lists no CLI for. The stand-in
// (tests/fixtures/fake-codex.mjs) refreshes the session as Codex does.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentForRun } from "../cli/kernel/agent.ts";
import { agentOf, runRenew } from "../cli/kernel/run.ts";
import { context } from "../cli/kernel/snapshot.ts";
import { handOver, think } from "../cli/kernel/think.ts";
import type { Plan, Snapshot, Think } from "../cli/kernel/types.ts";
import { codex, deviceCode, renewed } from "../cli/lib/agents/codex.ts";
import { loadExecutors } from "../cli/lib/agents.ts";
import { mockCallsLogged } from "../cli/lib/providers.ts";
import { newState, type TaskState } from "../cli/lib/task.ts";
import { models } from "../edge/src/web/setup.ts";
import { ROOT, sandbox } from "./helpers.ts";

/** A JWT with these claims, unsigned: only what Codex's auth.json holds, for its shape. */
const jwt = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

/** Codex's auth.json for a ChatGPT session. */
const sessionOf = (o: { account?: string; plan?: string; at?: string; access?: string } = {}) =>
  JSON.stringify(
    {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_plan_type: o.plan ?? "plus",
            chatgpt_account_id: o.account ?? "acc-1",
          },
        }),
        access_token: o.access ?? jwt({ exp: 1_800_000_000 }),
        refresh_token: "rt-1",
        account_id: o.account ?? "acc-1",
      },
      last_refresh: o.at ?? "2026-11-01T10:00:00.000Z",
    },
    null,
    2,
  );

const saved = { ...process.env };
let dir = "";
let sb: ReturnType<typeof sandbox>;

beforeEach(() => {
  sb = sandbox();
  dir = mkdtempSync(join(tmpdir(), "codex-run-"));
  const executors = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  executors.codex.task = [process.execPath, join(ROOT, "tests/fixtures/fake-codex.mjs")];
  writeFileSync(join(dir, "executors.json"), JSON.stringify(executors));
  process.env = {
    ...saved,
    ...sb.env,
    GITHUB_REPOSITORY: "o/shipify",
    SHIPIFY_EXECUTORS_FILE: join(dir, "executors.json"),
    // On a box the job hands the chosen agent's login over as this (task.yml).
    SHIPIFY_AGENT_LOGIN: sessionOf(),
    SHIPIFY_MOCK_CALLS: join(dir, "calls.jsonl"),
  };
  delete process.env.GITHUB_ACTIONS;
  delete process.env.SHIPIFY_BOX;
  delete process.env.SHIPIFY_EXECUTOR;
});
afterEach(() => {
  process.env = { ...saved };
});

const snap: Snapshot = {
  n: 7,
  issue: {
    title: "ask: what is 2+2?",
    body: "",
    state: "open",
    labels: [],
    author: "owner",
    isPr: false,
  },
  said: [],
  state: {
    ...(newState() as TaskState),
    use: { agent: "codex", model: "gpt-6.1-sol", label: "Codex · GPT-6.1 Sol" },
  },
  trigger: { kind: "opened" },
  now: "2026-11-06T10:00:00.000Z",
  run: { id: "70", url: "https://github.com/o/shipify/actions/runs/70" },
  parsed: { kind: "question", ask: "what is 2+2?" },
  bodyHash: "aaaa",
  projects: [],
  repos: [],
  isTask: true,
};
const talk: Think = { profile: "talk", why: "new", notes: [], fresh: [], web: true };

describe("a run with Codex", () => {
  it("writes its login as a file in its own home, never on the pipe or in its environment, and writes the renewed one back", async () => {
    // The run's folder where its job's later steps open it again (`run renew`).
    const task = join(sb.dir, ".tasks", "7");
    const keep = join(task, "out");
    const out = await think(snap, talk, {
      files: join(dir, "files"),
      keep,
      local: join(task, "agent"),
    });
    expect(JSON.parse(readFileSync(join(keep, "result.json"), "utf8"))).toMatchObject({
      state: "done",
      text: "Two plus two is four.",
    });
    const given = JSON.parse(readFileSync(join(task, "agent", "out", "given.json"), "utf8"));
    expect(given.login).toBe(sessionOf());
    // Not under its own name, as a login with no way in is (off a box, the agent has the test's
    // environment; on one, an empty one of its own).
    expect(given.env).not.toContain("CODEX_AUTH");
    expect(given.env).toContain("CODEX_HOME");
    expect(given.argv).toEqual(
      expect.arrayContaining(["--ignore-user-config", "-m", "gpt-6.1-sol"]),
    );
    expect(out.details?.model).toBe("gpt-6.1-sol");
    expect(out.details?.tokens).toMatchObject({ input: 600, cacheRead: 400, output: 20 });

    // After the run: the session Codex refreshed, written back to its secret, and only that.
    writeFileSync(
      join(task, "plan.json"),
      JSON.stringify({ s: snap, p: { do: "think", think: talk, state: snap.state, why: "new" } }),
    );
    const r = await runRenew(7);
    expect(r.status).toBe("succeeded");
    const renewedSession = readFileSync(
      join(task, "agent", "config", "codex", "auth.json"),
      "utf8",
    );
    expect(JSON.parse(renewedSession).tokens.refresh_token).toBe("rt-2");
    const sets = mockCallsLogged().filter((c) => c.call === "setSecret");
    expect(sets).toEqual([
      {
        call: "setSecret",
        repo: "o/shipify",
        name: "CODEX_AUTH",
        sha: createHash("sha256").update(renewedSession.trim()).digest("hex").slice(0, 12),
      },
    ]);
    // Nothing renewed since (the given login is the one there now): nothing written.
    process.env.SHIPIFY_AGENT_LOGIN = renewedSession;
    expect((await runRenew(7)).status).toBe("skipped");
    expect(mockCallsLogged().filter((c) => c.call === "setSecret")).toHaveLength(1);
  });

  it("hands a file login over as a file alone", () => {
    const h = handOver({ CODEX_AUTH: "{…}", GH_TOKEN: "ghs" }, "CODEX_AUTH", codex);
    expect(h).toEqual({ secrets: { GH_TOKEN: "ghs" }, file: "{…}", env: {} });
  });
});

describe("where Codex never thinks (ADR 0074)", () => {
  it("sends a read run and a guest's to the default agent, and refuses when that one's login is a file too", () => {
    const all = loadExecutors(join(ROOT, "executors.json"));
    expect(all.codex?.login).toMatchObject({ file: true, renews: true });
    expect(agentForRun("codex", "work", all)).toBe("codex");
    expect(agentForRun("codex", "talk", all)).toBe("codex");
    expect(agentForRun("codex", "read", all)).toBe("claude");
    expect(agentForRun("codex", "guest", all)).toBe("claude");
    expect(agentForRun("pi", "guest", all)).toBe("pi");
    const fileOnly = {
      ...all,
      claude: { ...all.claude, login: { secret: "X", how: "", file: true } },
    };
    expect(agentForRun("codex", "read", fileOnly as typeof all)).toBeUndefined();
  });

  it("names the default agent's login for a guest's run, and Codex's write-back for yours", () => {
    const plan = (profile: Think["profile"]): Plan => ({
      do: "think",
      think: { ...talk, profile },
      state: snap.state,
      why: "new",
    });
    expect(agentOf(plan("guest"))).toEqual({ agent: "claude", login: "CLAUDE_CODE_OAUTH_TOKEN" });
    expect(agentOf(plan("talk"))).toEqual({ agent: "codex", login: "CODEX_AUTH", renews: true });
  });

  it("leaves Codex out of a guest's picker, and refuses a guest's `use codex`", () => {
    expect(models().agents.map((a) => a.id)).toContain("codex");
    expect(models(true).agents.map((a) => a.id)).not.toContain("codex");
    const theirs: Snapshot = {
      ...snap,
      issue: {
        ...snap.issue,
        from: {
          v: 1,
          person: "Ana",
          channel: "web",
          chat: "c1",
          id: "m1",
          guest: "guest-ana-0a1b2c",
        },
      },
    };
    const said = context(theirs).use("use codex", undefined);
    expect(said?.use).toBeUndefined();
    expect(said?.reply).toMatch(
      /^Codex isn't for this chat: it thinks with the owner's own sign-in/,
    );
    expect(context(snap).use("use codex", undefined)?.use?.agent).toBe("codex");
  });

  it("takes no read run itself", () => {
    expect(() =>
      codex.argv({ command: ["codex", "exec"], commands: { deny: [], web: false, run: false } }),
    ).toThrow(/takes no read run/);
  });
});

describe("Codex's write-back check", () => {
  const given = sessionOf();
  it("keeps only a newer session for the same account", () => {
    expect(renewed(given, sessionOf({ at: "2026-11-06T10:00:00.000Z", access: "a2.e30.x" }))).toBe(
      true,
    );
    expect(renewed(given, given)).toBe(false);
    expect(renewed(given, sessionOf({ at: "2026-10-01T10:00:00.000Z" }))).toBe(false);
    expect(renewed(given, sessionOf({ account: "acc-2", at: "2026-11-06T10:00:00.000Z" }))).toBe(
      false,
    );
    expect(renewed(given, "not json")).toBe(false);
    expect(renewed(given, JSON.stringify({ OPENAI_API_KEY: "sk-x" }))).toBe(false);
  });
});

describe("Codex's command and report", () => {
  it("carries on in its session, and turns the web off when the run may not read it", () => {
    const argv = codex.argv({
      command: ["codex", "exec"],
      resume: "thr-1",
      commands: { deny: ["git push"], web: false },
    });
    expect(argv.slice(0, 3)).toEqual(["codex", "exec", "resume"]);
    expect(argv.slice(-2)).toEqual(["thr-1", "-"]);
    expect(argv).toContain('web_search="disabled"');
  });

  it("reads its events: tokens less its cache, its session, its calls, and a sign-in that ended", () => {
    const reader = codex.reader({ model: "gpt-6.1-sol" });
    for (const e of [
      { type: "thread.started", thread_id: "thr-9" },
      {
        type: "item.completed",
        item: { type: "error", message: "`--dangerously-bypass-hook-trust` is enabled." },
      },
      { type: "item.completed", item: { type: "web_search", query: "x" } },
      { type: "item.completed", item: { type: "mcp_tool_call", server: "notion", tool: "search" } },
      {
        type: "turn.completed",
        usage: { input_tokens: 900, cached_input_tokens: 300, output_tokens: 9 },
      },
      {
        type: "turn.failed",
        error: {
          message: "Your access token could not be refreshed: refresh token was already used",
        },
      },
    ])
      reader.line(JSON.stringify(e));
    const r = reader.report();
    expect(r).toMatchObject({
      session: "thr-9",
      model: "gpt-6.1-sol",
      tokens: { input: 600, cacheRead: 300, output: 9 },
      sessionTotals: true,
      tools: { web_search: 1, "notion.search": 1 },
      readOutside: true,
    });
    expect(r.notes).toBeUndefined();
    expect(r.error).toMatch(
      /refresh token was already used \(sign in to ChatGPT again: say `codex sign in`, or on a PC `pnpm ship setup agent codex --new`\)/,
    );
  });
});

describe("Codex's gate, as its PreToolUse hook", () => {
  it("answers each call in Codex's shape: a refusal with its reason, nothing for the rest", () => {
    const run = mkdtempSync(join(tmpdir(), "codex-gate-"));
    const tools = join(run, "tools");
    const work = join(run, "work");
    mkdirSync(work);
    const argv = codex.argv({
      command: ["codex", "exec"],
      commands: { deny: ["git push", "git stash"], web: true },
      tools: { mode: "look", dir: tools, root: ROOT, only: [] },
      folders: { write: [join(run, "out")] },
    });
    const hook = /command="(node [^"]+)"/.exec(argv.join("\n"))?.[1] ?? "";
    expect(hook).toBe(`node ${join(tools, "gate.mjs")}`);
    const ask = (tool_name: string, tool_input: object) => {
      const r = spawnSync(process.execPath, [join(tools, "gate.mjs")], {
        input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: work }),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : undefined;
    };
    expect(ask("Bash", { command: "env -i git push" })).toMatchObject({
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringMatching(/^Refused by Shipify's rules: `git push`/),
    });
    expect(ask("Bash", { command: "make test && ls" })).toBeUndefined();
    const patch = (file: string) =>
      `apply_patch <<'P'\n*** Begin Patch\n*** Add File: ${file}\n+hi\n*** End Patch\nP`;
    expect(ask("Bash", { command: patch("src/a.ts") })).toBeUndefined();
    expect(ask("Bash", { command: patch(join(run, "out", "a.md")) })).toBeUndefined();
    expect(ask("Bash", { command: patch("/etc/a") })).toMatchObject({ permissionDecision: "deny" });
    expect(ask("mcp__notion__update_page", {})).toMatchObject({ permissionDecision: "deny" });
    expect(ask("view_image", { path: "a.png" })).toBeUndefined();
  });
});

describe("Codex's sign-in on your PC", () => {
  /** A stand-in npx: `codex login` writes this session in CODEX_HOME, and says where it did. */
  const standIn = (session: string) => {
    const bin = mkdtempSync(join(tmpdir(), "codex-npx-"));
    writeFileSync(join(bin, "session.json"), session);
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "$CODEX_HOME" > "${bin}/home"\ncp "${bin}/session.json" "$CODEX_HOME/auth.json"\n`,
    );
    chmodSync(join(bin, "npx"), 0o755);
    process.env.PATH = `${bin}:${saved.PATH}`;
    return bin;
  };

  it("gives back its session and its plan, never printing it, and leaves no folder behind", async () => {
    const bin = standIn(sessionOf());
    const asked: string[] = [];
    const r = await codex.signIn?.({
      version: "0.167.0",
      ask: async (q) => {
        asked.push(q);
        return "";
      },
    });
    expect(r?.login).toBe(sessionOf());
    expect(r?.said.join("\n")).toMatch(/on the plus plan/);
    expect(r?.said.join("\n")).not.toContain("rt-1");
    expect(asked).toEqual([]);
    expect(existsSync(readFileSync(join(bin, "home"), "utf8").trim())).toBe(false);
  });

  it("asks before going on with a plan OpenAI lists no CLI for", async () => {
    standIn(sessionOf({ plan: "go" }));
    const no = await codex.signIn?.({ version: "0.167.0", ask: async () => "n" });
    expect(no?.login).toBeUndefined();
    expect(no?.said.at(-1)).toBe("Stopped: nothing was set.");
    const yes = await codex.signIn?.({ version: "0.167.0", ask: async () => "y" });
    expect(yes?.login).toBe(sessionOf({ plan: "go" }));
  });

  it("sets nothing when the sign-in didn't finish, or isn't a ChatGPT session", async () => {
    standIn(JSON.stringify({ OPENAI_API_KEY: "sk-x" }));
    const r = await codex.signIn?.({ version: "0.167.0", ask: async () => "y" });
    expect(r?.login).toBeUndefined();
    expect(
      readdirSync(tmpdir()).some(
        (d) => d.startsWith("shipify-codex-") && existsSync(join(tmpdir(), d, "auth.json")),
      ),
    ).toBe(false);
  });
});

describe("Codex's sign-in with a one-time code, from a chat or `--device`", () => {
  /** What `codex login --device-auth` prints at 0.167.0 (codex-rs/login/src/device_code_auth.rs). */
  const PROMPT =
    "\nWelcome to Codex [v\x1b[90m0.167.0\x1b[0m]\n\x1b[90mOpenAI's command-line coding agent\x1b[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mABCD-EFGH2\x1b[0m\n\n\x1b[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\x1b[0m\n\n";

  /**
   * A stand-in npx: prints Codex's prompt, then waits for the code to be typed (the `typed` file the
   * test's `code` writes), then writes the session; or, never typed, fails as Codex does.
   */
  const standIn = (session: string) => {
    const bin = mkdtempSync(join(tmpdir(), "codex-npx-"));
    writeFileSync(join(bin, "session.json"), session);
    writeFileSync(join(bin, "prompt.txt"), PROMPT);
    writeFileSync(
      join(bin, "npx"),
      [
        "#!/bin/sh",
        `echo "$@" > "${bin}/args"`,
        `env > "${bin}/env"`,
        `cat "${bin}/prompt.txt"`,
        "i=0",
        `while [ ! -f "${bin}/typed" ] && [ $i -lt 30 ]; do sleep 0.1; i=$((i+1)); done`,
        `[ -f "${bin}/typed" ] || { echo "Error logging in with device code: device auth timed out after 15 minutes" >&2; exit 1; }`,
        `cp "${bin}/session.json" "$CODEX_HOME/auth.json"`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "npx"), 0o755);
    process.env.PATH = `${bin}:${saved.PATH}`;
    return bin;
  };
  const typed = (bin: string) => async () => writeFileSync(join(bin, "typed"), "");

  it("reads the link and the code from Codex's prompt, colours and all, once both are there", () => {
    expect(deviceCode(PROMPT)).toEqual({
      link: "https://auth.openai.com/codex/device",
      code: "ABCD-EFGH2",
    });
    expect(deviceCode(PROMPT.slice(0, PROMPT.indexOf("2. Enter")))).toBeUndefined();
  });

  it("shows the link and the code as soon as Codex has them, then gives back the session", async () => {
    const bin = standIn(sessionOf());
    // The github job's own keys (the bot's): never handed to Codex's sign-in.
    Object.assign(process.env, { GH_TOKEN: "bot-token", SHIPIFY_ISSUES_TOKEN: "issues-token" });
    const shown: unknown[] = [];
    const r = await codex.signIn?.({
      version: "0.167.0",
      code: async (c) => {
        shown.push(c);
        await typed(bin)();
      },
    });
    expect(shown).toEqual([
      { link: "https://auth.openai.com/codex/device", code: "ABCD-EFGH2", minutes: 15 },
    ]);
    expect(readFileSync(join(bin, "args"), "utf8")).toMatch(
      /^-y @openai\/codex@0\.167\.0 login --device-auth -c cli_auth_credentials_store="file"/,
    );
    const env = readFileSync(join(bin, "env"), "utf8");
    expect(env).not.toMatch(/bot-token|issues-token/);
    expect(env).toMatch(/^CODEX_HOME=/m);
    expect(r?.login).toBe(sessionOf());
    expect(r?.said.join("\n")).toMatch(/on the plus plan/);
  });

  it("with no one to ask, a plan OpenAI lists no CLI for is a warning, and the session is set", async () => {
    const bin = standIn(sessionOf({ plan: "go" }));
    const r = await codex.signIn?.({ version: "0.167.0", code: typed(bin) });
    expect(r?.login).toBe(sessionOf({ plan: "go" }));
    expect(r?.said.at(-1)).toMatch(/not for go: its runs may be refused/);
  });

  it("says why when the code wasn't used in time, or couldn't be shown: nothing set", async () => {
    standIn(sessionOf());
    const late = await codex.signIn?.({ version: "0.167.0", code: async () => {} });
    expect(late?.login).toBeUndefined();
    expect(late?.said[0]).toMatch(
      /didn't finish, so nothing was set: .*timed out after 15 minutes/,
    );
    const unshown = await codex.signIn?.({
      version: "0.167.0",
      code: async () => {
        throw new Error("GitHub said no");
      },
    });
    expect(unshown?.login).toBeUndefined();
    expect(unshown?.said[0]).toMatch(/the code couldn't be shown \(GitHub said no\)/);
  });
});
