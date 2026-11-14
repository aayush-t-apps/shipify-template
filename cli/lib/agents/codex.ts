// Codex's adapter (ADR 0074): OpenAI's Codex (`@openai/codex`, Apache-2.0), run headless with
// `codex exec --json`: one JSON event a line, the prompt on stdin. Checked against Codex 0.167.0
// (tests/fixtures/codex-stream.jsonl, a real run against a stand-in model). What it gets, all in the
// run's own folders:
// - its login: your ChatGPT session, Codex's own auth.json, which the run writes in its home
//   (CODEX_HOME, the run's config/codex) before its first ask (`loginFile`). Codex takes a ChatGPT
//   session only from there, so its commands can read it: its entry's `login.file` keeps it from a
//   read run and a guest's. It refreshes the session there, and the box writes a newer one back to
//   the secret after the run (`renewed`, its entry's `login.renews`);
// - every setting on its command line (`-c`), and none of its own files: not its home's
//   config.toml (`--ignore-user-config`, so a repo's .codex is never trusted, and isn't loaded),
//   no rules files (`--ignore-rules`), no bundled skills, nothing in the background (updates,
//   analytics, feedback, history); its own sandbox off, as the walls are outside the agent (ADR
//   0043; its bubblewrap fails on a Pi anyway), and commands get the run's whole environment;
// - Shipify's gate as its PreToolUse hook (gate.mjs, with pi's gate beside it and the run's rules,
//   gate.json), which checks each command, patch and tool call before it runs, its helpers' too;
// - the look tools, each at the run's look server (ADR 0077), only their look calls enabled and
//   approved, the run's token named, never its value;
// - Shipify's skills, linked where it reads a user's ($HOME/.agents/skills).
// Its answer: the result file, or its final message in the result's shape.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  type Adapter,
  type AgentReport,
  type AgentRun,
  agentFile,
  asResult,
  fetchesOutside,
  loadTools,
  type OutputReader,
  offered,
  oneLine,
  runTools,
  secretFor,
  skillRead,
  skillsSeen,
} from "../plugins/agent.ts";

/** A tool's call as Codex names it: tools.json's notion.search is mcp__notion__search. */
const callName = (tool: string, call: string) =>
  `mcp__${tool}__${call}`.replace(/[^A-Za-z0-9_-]/g, "_");

/** A value as TOML writes it inline, for Codex's `-c key=value`: a JSON string is a TOML one. */
const toml = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(toml).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.entries(v)
          .map(([k, x]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)}=${toml(x)}`)
          .join(",")}}`
      : typeof v === "string"
        ? JSON.stringify(v)
        : String(v);

/** Codex's settings for the run, as `-c` values, with its gate and rules in the run's tools folder. */
function settings(run: AgentRun): string[] {
  if (run.commands?.run === false)
    throw new Error(
      "Codex takes no read run: its commands can read its login (ADR 0074), so the default agent reads",
    );
  const set: [string, unknown][] = [
    ["sandbox_mode", "danger-full-access"],
    ["approval_policy", "never"],
    ["cli_auth_credentials_store", "file"],
    ["check_for_update_on_startup", false],
    ["analytics.enabled", false],
    ["feedback.enabled", false],
    ["history.persistence", "none"],
    ["skills.bundled.enabled", false],
    // Its commands get the run's whole environment, as every agent's do: its read-only GitHub key
    // too, which Codex's own default would drop (a name with KEY, SECRET or TOKEN in it).
    ["shell_environment_policy.inherit", "all"],
    ["shell_environment_policy.ignore_default_excludes", true],
  ];
  if (run.effort) set.push(["model_reasoning_effort", run.effort]);
  if (run.commands?.web === false) set.push(["web_search", "disabled"]);
  // The look tools, each a remote one at the run's look server (`offered`, ADR 0077): only their
  // look calls enabled, approved (with no one to ask, an MCP call that needs approval is refused),
  // its bearer token or a header that is one key named by its variable, never its value.
  const mode = run.tools?.mode ?? "look";
  const all = offered(loadTools(), run.tools?.served);
  const look: string[] = [];
  for (const [name, calls] of Object.entries(runTools(all, mode, process.env).ready)) {
    const t = all[name];
    if (!t?.url) continue;
    const vars = Object.entries(t.keys).map(([v, k]) => [v, secretFor(k, mode)] as const);
    // A tool's variable, or else a variable of the agent's own by that name (the run's token).
    const named = (v: string) =>
      vars.find(([x]) => v === `\${${x}}`)?.[1] ?? /^\$\{(\w+)\}$/.exec(v)?.[1];
    const bearer = /^Bearer (\$\{\w+\})$/.exec(t.headers?.Authorization ?? "")?.[1];
    const headers = Object.entries(t.headers ?? {}).filter(
      ([h]) => !(bearer && h === "Authorization"),
    );
    const env = headers.map(([h, v]) => [h, named(v)] as const);
    if (!env.every(([, v]) => v) || (bearer && !named(bearer))) continue;
    const where = {
      url: t.url,
      ...(bearer ? { bearer_token_env_var: named(bearer) } : {}),
      ...(env.length ? { env_http_headers: Object.fromEntries(env) } : {}),
    };
    set.push([
      `mcp_servers.${name}`,
      { ...where, enabled_tools: calls, default_tools_approval_mode: "approve" },
    ]);
    look.push(...calls.map((c) => callName(name, c)));
  }
  // The gate and its rules, in the run's tools folder, found through the contract's `agentFile`
  // (ADR 0051 B1), as Codex's PreToolUse hook for every call.
  const dir = run.tools?.dir;
  if (dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const [to, from] of [
      ["gate.mjs", "codex-gate.mjs"],
      ["pi-gate.mjs", "pi-gate.mjs"],
    ] as const)
      writeFileSync(join(dir, to), readFileSync(agentFile(from)));
    writeFileSync(
      join(dir, "gate.json"),
      `${JSON.stringify(
        { deny: run.commands?.deny ?? [], write: run.folders?.write ?? [], look },
        null,
        2,
      )}\n`,
    );
    set.push([
      "hooks.PreToolUse",
      [{ matcher: "*", hooks: [{ type: "command", command: `node ${join(dir, "gate.mjs")}` }] }],
    ]);
  }
  return set.map(([k, v]) => `${k}=${toml(v)}`);
}

function argv(run: AgentRun): string[] {
  const flags = [
    "--json",
    "--skip-git-repo-check",
    // Its own config and rules files aren't read: everything is said here. Its hooks are this
    // run's gate alone, so they run without Codex's own approval of them, which no one is there to
    // give.
    "--ignore-user-config",
    "--ignore-rules",
    "--dangerously-bypass-hook-trust",
    ...(run.model ? ["-m", run.model] : []),
    ...settings(run).flatMap((c) => ["-c", c]),
  ];
  // The prompt on stdin (`-`); a catch-up and the fix round carry on in its session.
  return run.resume
    ? [...run.command, "resume", ...flags, run.resume, "-"]
    : [...run.command, ...flags, "-"];
}

/** An error that says its ChatGPT session ended: then the fix is to sign in again. */
const SIGNED_OUT =
  /refresh token|sign(?:ed)? in again|log(?:ged)? ?(?:in|out)|401|unauthori[sz]ed|token_expired|not logged in/i;

/** A warning Codex says of a setting the adapter chose, not of the run. */
const OURS = /--dangerously-bypass-hook-trust/;

type Item = {
  id?: string;
  type?: string;
  text?: string;
  message?: string;
  command?: string;
  server?: string;
  tool?: string;
  status?: string;
};

function reader(run?: Pick<AgentRun, "model">): OutputReader {
  const report: AgentReport = {};
  const tools: Record<string, number> = {};
  const skills: string[] = [];
  const notes: string[] = [];
  let usage:
    | { input: number; cacheRead: number; cacheWrite: number; output: number; thinking?: number }
    | undefined;
  let last = "";
  const fail = (message: unknown) => {
    const said = oneLine(message ?? "it stopped with an error", 200);
    report.error = SIGNED_OUT.test(said)
      ? `${said} (sign in to ChatGPT again: say \`codex sign in\`, or on a PC \`pnpm ship setup agent codex --new\`)`
      : said;
    return `  ✗ ${said}`;
  };
  return {
    line(text) {
      let e: {
        type?: string;
        thread_id?: string;
        item?: Item;
        usage?: Record<string, number>;
        error?: { message?: string };
        message?: string;
      };
      try {
        e = JSON.parse(text);
      } catch {
        return text;
      }
      if (!e || typeof e !== "object") return text;
      if (e.type === "thread.started" && typeof e.thread_id === "string") {
        report.session = e.thread_id;
        return run?.model ? `  · Codex · ${run.model}` : undefined;
      }
      if (e.type === "turn.completed" && e.usage) {
        const u = e.usage;
        report.turns = (report.turns ?? 0) + 1;
        // A turn that finished after an error it got past: the error isn't the run's.
        report.error = undefined;
        // Its session's counts so far (a resumed session counts from its start): OpenAI's input
        // counts what came from its cache too.
        usage = {
          input: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
          cacheRead: u.cached_input_tokens ?? 0,
          cacheWrite: u.cache_write_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          thinking: u.reasoning_output_tokens || undefined,
        };
        return "  · finished";
      }
      if (e.type === "turn.failed") return fail(e.error?.message);
      if (e.type === "error") return fail(e.message);
      const item = e.item;
      if (!item || typeof item !== "object") return undefined;
      const done = e.type === "item.completed";
      if (item.type === "agent_message") {
        if (!done) return undefined;
        const said = String(item.text ?? "").trim();
        if (said) last = said;
        return said || undefined;
      }
      if (item.type === "error") {
        if (done && item.message && !OURS.test(item.message))
          notes.push(oneLine(item.message, 200));
        return undefined;
      }
      if (item.type === "reasoning" || item.type === "todo_list") return undefined;
      // A call: counted once, when it's done, by Shipify's name for it.
      const name =
        item.type === "command_execution"
          ? "bash"
          : item.type === "file_change"
            ? "apply_patch"
            : item.type === "mcp_tool_call"
              ? `${item.server}.${item.tool}`
              : String(item.type ?? "?");
      if (e.type === "item.started")
        return item.type === "command_execution"
          ? `  → bash: ${oneLine(item.command ?? "")}`
          : `  → ${name}`;
      if (!done) return undefined;
      tools[name] = (tools[name] ?? 0) + 1;
      if (item.type === "web_search") report.readOutside = true;
      if (item.type === "command_execution") {
        const c = String(item.command ?? "");
        if (fetchesOutside(c)) report.readOutside = true;
        for (const p of c.match(/[^\s'"]*skills\/[a-z0-9-]+\/SKILL\.md/g) ?? []) {
          const s = skillRead(p);
          if (s) skills.push(s);
        }
      }
      return undefined;
    },
    report() {
      if (Object.keys(tools).length) report.tools = tools;
      report.skills = skillsSeen(skills);
      if (notes.length) report.notes = [...new Set(notes)];
      // The stream doesn't name its model: it's the one the run chose.
      if (run?.model) report.model = run.model;
      if (usage) {
        report.tokens = usage;
        report.models = { [report.model ?? "codex"]: usage };
        report.sessionTotals = true;
      }
      const result = asResult(last);
      if (result !== undefined) report.result = result;
      else if (last) report.said = last;
      return report;
    },
  };
}

/** Codex's home in the run's folders: its login, sessions and own files. */
const home = (p: { config: string }) => join(p.config, "codex");

type Session = {
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
    login_owner_id?: unknown;
  };
  last_refresh?: unknown;
};

/** A ChatGPT session in Codex's auth.json, or undefined for anything else. */
function session(text: string): Session | undefined {
  try {
    const a = JSON.parse(text) as Session;
    const t = a?.tokens;
    return t &&
      [t.id_token, t.access_token, t.refresh_token].every((x) => typeof x === "string" && x) &&
      typeof t.account_id === "string" &&
      t.account_id &&
      typeof a.last_refresh === "string" &&
      !Number.isNaN(Date.parse(a.last_refresh))
      ? a
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the session Codex left (`found`) is the given one, renewed: a ChatGPT session for the same
 * account (and the same sign-in, when both say it), refreshed later. Anything else isn't written back.
 */
export function renewed(given: string, found: string): boolean {
  const was = session(given);
  const now = session(found);
  if (!was || !now || found.trim() === given.trim()) return false;
  if (now.tokens?.account_id !== was.tokens?.account_id) return false;
  const owner = [was.tokens?.login_owner_id, now.tokens?.login_owner_id];
  if (owner.every(Boolean) && owner[0] !== owner[1]) return false;
  return Date.parse(String(now.last_refresh)) > Date.parse(String(was.last_refresh));
}

/** A JWT's claims, unchecked: only to say what a session is, never to trust it. */
const claims = (jwt: unknown): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
};

/** The plans OpenAI lists Codex's CLI for (its plans page, 2026-11-06): Go's card shows the app. */
const CLI_PLANS = ["plus", "pro", "business", "team", "enterprise", "edu"];

/** How long Codex's one-time code lasts: Codex stops waiting for it then (0.167.0). */
const CODE_MINUTES = 15;
/** The most a sign-in with a code takes in all, Codex's download too: inside the github job's 20. */
const CODE_SIGN_IN_MS = 17 * 60_000;
/**
 * All a sign-in with a code is handed from this machine's environment: what npx needs, never a key
 * (in the github job, the bot's own token is there).
 */
const CODE_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "HTTPS_PROXY", "NO_PROXY"];

/**
 * The link and the one-time code in what `codex login --device-auth` prints (in colour, each on the
 * line under its step), or undefined until both are there.
 */
export function deviceCode(out: string): { link: string; code: string } | undefined {
  const lines = stripVTControlCharacters(out)
    .split(/\r?\n/)
    .map((l) => l.trim());
  const link = lines.find((l) => /^https:\/\/[\w.-]+\/codex\/device$/.test(l));
  const at = lines.findIndex((l) => /one-time code/i.test(l));
  const code = at < 0 ? undefined : lines.slice(at + 1).find(Boolean);
  return link && code && /^\S{4,40}$/.test(code) ? { link, code } : undefined;
}

/**
 * Codex's sign-in with a code: its link and code to `show` as soon as Codex prints them, then the
 * wait for you to type it. Its output is read, never printed. `why`: what stopped it, Codex's own
 * last line when it was Codex.
 */
function withCode(
  args: string[],
  env: NodeJS.ProcessEnv,
  show: (c: { link: string; code: string; minutes: number }) => Promise<void>,
): Promise<{ ok: boolean; shown: boolean; why: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let shown = false;
    let why = "";
    let done = false;
    const stop = (w: string) => {
      why ||= w;
      child.kill("SIGTERM");
    };
    const timer = setTimeout(
      () => stop(`it took more than ${CODE_SIGN_IN_MS / 60_000} minutes`),
      CODE_SIGN_IN_MS,
    );
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const last = stripVTControlCharacters(err)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .at(-1);
      resolve({ ok: ok && !why, shown, why: oneLine(why || last || "it stopped", 200) });
    };
    child.stdout.on("data", (d: Buffer) => {
      if (shown) return;
      out += d.toString("utf8");
      const c = deviceCode(out);
      if (!c) return;
      shown = true;
      show({ ...c, minutes: CODE_MINUTES }).catch((e: unknown) =>
        stop(`the code couldn't be shown (${oneLine((e as Error)?.message ?? e, 120)})`),
      );
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString("utf8")).slice(-4000);
    });
    child.on("error", (e) => {
      why ||= e.message;
      end(false);
    });
    child.on("close", (status) => end(status === 0));
  });
}

/**
 * Codex's own sign-in (`codex login`), at the version executors.json pins, through npx, so your PC
 * needs no Codex: in your browser, or with a one-time code you type on any device (`code`: from a
 * chat, on GitHub's machine, or `--device` on a PC). In a folder of its own, so it's a session for
 * Shipify alone and Codex on your PC keeps its own. Says its plan and how long its access token
 * lasts; on a plan OpenAI doesn't list Codex's CLI for, asks before going on (`ask`), or says so.
 * The folder is gone after, whatever happened; the session is never printed.
 */
async function signIn(o: {
  version: string;
  ask?(question: string): Promise<string>;
  code?(c: { link: string; code: string; minutes: number }): Promise<void>;
}): Promise<{ login?: string; said: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "shipify-codex-"));
  try {
    const args = [
      "-y",
      `@openai/codex@${o.version}`,
      "login",
      ...(o.code ? ["--device-auth"] : []),
      "-c",
      'cli_auth_credentials_store="file"',
    ];
    const env = {
      ...(o.code
        ? Object.fromEntries(CODE_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
        : process.env),
      CODEX_HOME: dir,
    };
    const file = join(dir, "auth.json");
    if (o.code) {
      const r = await withCode(args, env, o.code);
      if (!r.ok || !existsSync(file))
        return {
          said: [
            r.shown
              ? `The sign-in didn't finish, so nothing was set: ${r.why}. A code lasts ${CODE_MINUTES} minutes, and works once.`
              : `Codex gave no code, so nothing was set: ${r.why}.`,
          ],
        };
    } else {
      const r = spawnSync("npx", args, { stdio: "inherit", env });
      if (r.status !== 0 || !existsSync(file))
        return { said: ["The sign-in didn't finish, so nothing was set. Run it again."] };
    }
    const text = readFileSync(file, "utf8").trim();
    const s = session(text);
    if (!s)
      return {
        said: [
          "That isn't a ChatGPT sign-in (an API key, or a Business token), so nothing was set.",
        ],
      };
    const auth = claims(s.tokens?.id_token)["https://api.openai.com/auth"] as
      | { chatgpt_plan_type?: unknown }
      | undefined;
    const plan = String(auth?.chatgpt_plan_type ?? "unknown").toLowerCase();
    const exp = Number(claims(s.tokens?.access_token).exp);
    const said = [
      `Signed in with ChatGPT, on the ${plan} plan.`,
      ...(exp
        ? [
            `Its access token lasts until ${new Date(exp * 1000).toUTCString()}; Codex renews it in a run, and the box keeps the renewed one.`,
          ]
        : []),
    ];
    if (!CLI_PLANS.includes(plan)) {
      const warning = `OpenAI lists Codex's CLI for Plus, Pro, Business and Enterprise, not for ${plan}: its runs may be refused.`;
      if (!o.ask) return { login: text, said: [...said, warning] };
      const a = await o.ask(`${warning} Go on anyway? (y/N) `);
      if (!/^y(es)?$/i.test(a.trim())) return { said: [...said, "Stopped: nothing was set."] };
    }
    return { login: text, said };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A Codex model for people: gpt-6.1-sol is "GPT-6.1 Sol". */
const modelName = (id: string) => {
  const m = /^gpt-(\d[\d.]*)-([a-z]+)$/.exec(id);
  return m ? `GPT-${m[1]} ${(m[2] ?? "").replace(/^./, (c) => c.toUpperCase())}` : undefined;
};

export const codex: Adapter = {
  name: "Codex",
  tools: true,
  callName,
  modelName,
  env: (p) => ({ CODEX_HOME: home(p) }),
  loginFile: (p) => join(home(p), "auth.json"),
  renewed,
  signIn,
  // Shipify's skills, where Codex reads a user's: its bundled ones are off.
  skillsLink: (p) => join(p.home, ".agents", "skills"),
  // What it reads from its home that a command could write (its home's config, hooks and rules
  // aren't read: `--ignore-user-config`, `--ignore-rules`): its own instructions, and skills and
  // plugins of its own. Its login and sessions stay.
  cleared: (p) =>
    [
      "AGENTS.md",
      "AGENTS.override.md",
      "config.toml",
      "hooks.json",
      "rules",
      "skills",
      "plugins",
    ].map((f) => join(home(p), f)),
  argv,
  reader,
};
