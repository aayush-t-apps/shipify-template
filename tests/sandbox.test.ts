// The agent's sandbox (box setup 5, ADR 0031, cli/lib/sandbox.ts): what runs as the agent, with
// what environment, and how its runs are made, killed and cleaned. A fake io stands in for sudo,
// so nothing here needs a box; the wrapper's own shell is run for real, without sudo.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sandboxCheck } from "../cli/commands/doctor.ts";
import {
  agentUser,
  asAgent,
  CONTAINERS_CONF,
  cleanRuns,
  cleanStaleRuns,
  containerEnv,
  give,
  killAll,
  listOut,
  onBox,
  prepareRun,
  pruneContainers,
  readOut,
  runPaths,
  type SandboxIo,
  SPAWN_ENV,
  STALE_RUN_MS,
  sandboxProblems,
  sandboxSlots,
  slotOf,
  sudoArgs,
} from "../cli/lib/sandbox.ts";

interface Call {
  cmd: string;
  args: string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  input?: string;
  streamed?: boolean;
}

/** A fake machine: records every command, and answers through `answer` (code 0 by default). */
function fakeIo(
  answer: (c: Call) => {
    code?: number;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
  } = () => ({}),
  root = "/srv",
): SandboxIo & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    root,
    run(cmd, args, opts) {
      const c = { cmd, args, cwd: opts.cwd, env: opts.env, input: opts.input };
      calls.push(c);
      const a = answer(c);
      return { code: a.code ?? 0, stdout: a.stdout ?? "", stderr: a.stderr ?? "", ...a };
    },
    async stream(cmd, args, opts) {
      const c = { cmd, args, cwd: opts.cwd, env: opts.env, input: opts.input, streamed: true };
      calls.push(c);
      for (const line of (answer(c).stdout ?? "").split("\n").filter(Boolean)) opts.onLine(line);
      return answer(c).code ?? 0;
    },
    sleep() {},
  };
}

/** The command a call ran as the agent: what follows the wrapper's folder, secret count and login. */
const command = (c: Call) => {
  const i = c.args.indexOf("shipify-agent");
  return i < 0 ? c.args : c.args.slice(i + 4);
};

/** killAll's check that nothing of the agent's, nor of its range, is left (as the runner). */
const isLeftCheck = (c: Call) => c.cmd === "/bin/sh" && c.args[2] === "left";

/** The names a call gave the agent, from env -i's arguments. */
const namesOf = (c: Call) =>
  Object.fromEntries(
    c.args
      .slice(c.args.indexOf("-i") + 1, c.args.indexOf("/bin/sh"))
      .map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
  );

/** Every value of every call, for "this never shows up anywhere" checks. */
const everything = (calls: Call[]) =>
  calls
    .map((c) => [c.cmd, ...c.args, ...Object.values(c.env), c.input ?? ""].join("\n"))
    .join("\n");

describe("the sandbox: who runs where", () => {
  it("names each slot's agent, and refuses a slot that isn't one", () => {
    expect(agentUser(1)).toBe("shipify-agent-1");
    expect(agentUser(4)).toBe("shipify-agent-4");
    expect(() => agentUser(0)).toThrow(/1 to 9/);
    expect(() => agentUser(10)).toThrow(/1 to 9/);
    expect(() => agentUser(1.5)).toThrow(/1 to 9/);
  });

  it("knows a runner's slot from its name and its box", () => {
    expect(slotOf("homepi", "homepi")).toBe(1);
    expect(slotOf("homepi-2", "homepi")).toBe(2);
    expect(slotOf("homepi-1", "homepi")).toBe(0);
    expect(slotOf("homepi-x", "homepi")).toBe(0);
    expect(slotOf("other", "homepi")).toBe(0);
    // A box named like a slot: its own runner is slot 1, never slot 2 of "pi".
    expect(slotOf("pi-2", "pi-2")).toBe(1);
    expect(slotOf("pi-2-3", "pi-2")).toBe(3);
    expect(slotOf(undefined, "homepi")).toBe(0);
    expect(slotOf("homepi", undefined)).toBe(0);
  });

  it("finds the slots with a sandbox on this machine: none without /srv's folders", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    expect(sandboxSlots(root)).toEqual([]);
    for (const d of ["shipify-agent-2", "shipify-agent-1", "shipify-agent-x", "other"])
      mkdirSync(join(root, d));
    expect(sandboxSlots(root)).toEqual([1, 2]);
    expect(sandboxSlots(join(root, "missing"))).toEqual([]);
  });

  it("is on a box only in a box's job with its slot's folder; a box without one never falls back", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    mkdirSync(join(root, "shipify-agent-2"));
    const job = {
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "self-hosted",
      SHIPIFY_BOX: "homepi",
    };
    // This PC and tests: not in a job.
    expect(onBox({}, root)).toBeUndefined();
    // GitHub's own machines: not a box.
    expect(
      onBox({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" }, root),
    ).toBeUndefined();
    expect(onBox({ ...job, RUNNER_NAME: "homepi-2" }, root)).toEqual({ slot: 2 });
    // Slot 1 has no folder: setup 5 never ran for it. No agent runs as the runner instead.
    expect(() => onBox({ ...job, RUNNER_NAME: "homepi" }, root)).toThrow(/no sandbox/);
    expect(() => onBox({ ...job, RUNNER_NAME: "someone-else" }, root)).toThrow(/box add/);
  });

  it("lays out a run's folders, and refuses a run id that isn't one", () => {
    const run = runPaths(2, "123456-1");
    expect(run.dir).toBe("/srv/shipify-agent-2/run-123456-1");
    expect(run).toMatchObject({
      user: "shipify-agent-2",
      home: `${run.dir}/home`,
      config: `${run.dir}/config`,
      work: `${run.dir}/work`,
      in: `${run.dir}/in`,
      out: `${run.dir}/out`,
    });
    expect(run.env).toMatchObject({
      HOME: run.home,
      TMPDIR: `${run.dir}/tmp`,
    });
    for (const bad of ["", "../x", "a/b", "-rf", "x".repeat(65)])
      expect(() => runPaths(1, bad)).toThrow(/run id/);
  });

  it("gives every agent command the names Podman keeps, the same at every run (ADR 0064)", () => {
    const run = runPaths(2, "123456-1");
    // The slot's kept folders by their real paths, never through the run's home: Podman records
    // its paths at its first use and reuses them.
    expect(run.env).toMatchObject({
      XDG_DATA_HOME: "/srv/shipify-agent-2/data",
      XDG_RUNTIME_DIR: "/srv/shipify-agent-2/runtime",
      CONTAINERS_CONF_OVERRIDE: CONTAINERS_CONF,
    });
    expect(CONTAINERS_CONF).toBe("/etc/containers/shipify-agents.conf");
    expect(containerEnv(3, "/x")).toEqual({
      XDG_DATA_HOME: "/x/shipify-agent-3/data",
      XDG_RUNTIME_DIR: "/x/shipify-agent-3/runtime",
      CONTAINERS_CONF_OVERRIDE: CONTAINERS_CONF,
    });
    // An agent may be handed them.
    expect(() => sudoArgs(2, ["true"], { cwd: run.work, env: run.env })).not.toThrow();
  });
});

describe("the sandbox: a command as the agent", () => {
  const SENTINEL = "s3cr3t-value-never-shown";
  const LEAKY = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_RUNTIME_TOKEN",
    "SHIPIFY_ISSUES_TOKEN",
    "SHIPIFY_SEND_KEY",
    "SHIPIFY_DOOR_KEY",
    "SHIPIFY_BOT_KEY",
    "SHIPIFY_NOTION_WRITE",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ];
  const before: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of LEAKY) {
      before[k] = process.env[k];
      process.env[k] = SENTINEL;
    }
  });
  afterEach(() => {
    for (const k of LEAKY) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });

  it("starts it with sudo -n as the slot's agent, from an empty environment, in its folder", async () => {
    const io = fakeIo((c) => ({ stdout: c.streamed ? "one\ntwo\n" : "" }));
    const lines: string[] = [];
    const r = await asAgent(
      2,
      ["claude", "-p", "--output-format", "stream-json"],
      {
        cwd: "/srv/shipify-agent-2/run-9/work",
        env: { HOME: "/srv/shipify-agent-2/run-9/home", SHIPIFY_TASK: "12" },
        stdin: "the prompt",
        timeoutMs: 60_000,
        onLine: (l) => lines.push(l),
      },
      io,
    );
    expect(r).toEqual({ code: 0, timedOut: false });
    expect(lines).toEqual(["one", "two"]);
    const [call] = io.calls;
    expect(call?.cmd).toBe("sudo");
    expect(call?.args.slice(0, 6)).toEqual([
      "-n",
      "-u",
      "shipify-agent-2",
      "--",
      "/usr/bin/env",
      "-i",
    ]);
    // sudo itself starts from a fixed environment, never this process's, and from the root folder.
    expect(call?.env).toEqual(SPAWN_ENV);
    expect(call?.cwd).toBe("/");
    // The names the agent gets: the defaults and what was given, nothing else.
    const names = (call?.args ?? [])
      .slice(6, call?.args.indexOf("/bin/sh"))
      .map((kv) => kv.split("=")[0]);
    expect(names.sort()).toEqual(
      [
        "HOME",
        "LANG",
        "LOGNAME",
        "PATH",
        "SHIPIFY_TASK",
        "USER",
        ...(process.env.TZ ? ["TZ"] : []),
      ].sort(),
    );
    expect(call?.args).toContain("HOME=/srv/shipify-agent-2/run-9/home");
    expect(call?.args).toContain("PATH=/usr/local/bin:/usr/bin:/bin");
    expect(command(call as Call)).toEqual(["claude", "-p", "--output-format", "stream-json"]);
    expect(call?.args[call.args.indexOf("shipify-agent") + 1]).toBe(
      "/srv/shipify-agent-2/run-9/work",
    );
    expect(call?.input).toBe("the prompt");
    expect(everything(io.calls)).not.toContain(SENTINEL);
  });

  it("hands secrets over on stdin, ahead of its input: never on a command line", async () => {
    const io = fakeIo();
    await asAgent(
      1,
      ["claude"],
      {
        cwd: "/srv/shipify-agent-1",
        secrets: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-xyz", GH_TOKEN: "read-only-abc" },
        stdin: "prompt",
        timeoutMs: 60_000,
      },
      io,
    );
    const [call] = io.calls;
    expect(call?.args.join(" ")).not.toContain("oauth-xyz");
    expect(call?.args.join(" ")).not.toContain("read-only-abc");
    expect(call?.args[call.args.indexOf("shipify-agent") + 2]).toBe("2");
    expect(call?.args[call.args.indexOf("shipify-agent") + 3]).toBe("0");
    expect(call?.input).toBe("CLAUDE_CODE_OAUTH_TOKEN=oauth-xyz\nGH_TOKEN=read-only-abc\nprompt");
  });

  it("hands the login over on stdin too, after the secrets, for fd 3: never as a name", async () => {
    const io = fakeIo();
    await asAgent(
      1,
      ["claude"],
      {
        cwd: "/srv/shipify-agent-1",
        env: { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3" },
        secrets: { GH_TOKEN: "read-only-abc" },
        login: "oauth-xyz",
        stdin: "prompt",
        timeoutMs: 60_000,
      },
      io,
    );
    const [call] = io.calls;
    expect(call?.args.join(" ")).not.toContain("oauth-xyz");
    expect(call?.args).toContain("CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3");
    expect(call?.args[call.args.indexOf("shipify-agent") + 2]).toBe("1");
    expect(call?.args[call.args.indexOf("shipify-agent") + 3]).toBe("1");
    expect(call?.input).toBe("GH_TOKEN=read-only-abc\noauth-xyz\nprompt");
  });

  it("refuses what never reaches an agent, and a secret passed as a plain name", () => {
    const at =
      (env: Record<string, string>, secrets: Record<string, string> = {}) =>
      () =>
        sudoArgs(1, ["true"], { cwd: "/srv/shipify-agent-1", env, secrets });
    for (const name of [
      "GITHUB_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_URL",
      "GITHUB_ENV",
      "RUNNER_TEMP",
      "SHIPIFY_NOTION_WRITE",
      "SHIPIFY_LABELLER_WRITE",
      "SHIPIFY_SEND_KEY",
      "SHIPIFY_DOOR_KEY",
      "SHIPIFY_BOT_KEY",
      "SHIPIFY_ISSUES_TOKEN",
      "CF_DEPLOY_TOKEN",
      "LD_PRELOAD",
    ]) {
      expect(at({ [name]: "x" }), name).toThrow(/never reaches an agent|looks like a secret/);
      expect(at({}, { [name]: "x" }), name).toThrow(/never reaches an agent/);
    }
    // The agent's login and a read-only token: secrets only.
    expect(at({ CLAUDE_CODE_OAUTH_TOKEN: "x" })).toThrow(/looks like a secret/);
    expect(at({ GH_TOKEN: "x" })).toThrow(/looks like a secret/);
    expect(at({ SHIPIFY_NOTION_READ: "x" })).not.toThrow();
    // Your Shipify repo's name, for the agent's own `ship` calls; nothing else of GitHub's.
    expect(at({ GITHUB_REPOSITORY: "o/shipify" })).not.toThrow();
    expect(at({ GITHUB_REPOSITORY_OWNER: "o" })).toThrow(/never reaches an agent/);
    expect(at({}, { CLAUDE_CODE_OAUTH_TOKEN: "x", GH_TOKEN: "y" })).not.toThrow();
    // Where to read the login is a plain name: a file descriptor's number, never a key.
    expect(at({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3" })).not.toThrow();
    expect(at({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "sk-ant-x" })).toThrow(
      /looks like a secret/,
    );
    expect(at({ "BAD NAME": "x" })).toThrow(/variable name/);
    expect(at({}, { TOKEN_A: "two\nlines" })).toThrow(/can't be passed/);
    expect(() =>
      sudoArgs(1, ["true"], { cwd: "/srv/shipify-agent-1", login: "two\nlines" }),
    ).toThrow(/can't be passed/);
    expect(() => sudoArgs(1, [], { cwd: "/" })).toThrow(/Nothing to run/);
    expect(() => sudoArgs(1, ["true"], { cwd: "relative" })).toThrow(/absolute/);
  });

  it("at its time limit, kills every process of the agent's and ends with 124", async () => {
    let release: (code: number) => void = () => {};
    const io = fakeIo((c) => {
      if (isLeftCheck(c)) return { code: 1 };
      // The agent's processes die: the command it was running ends.
      if (c.args.includes("kill")) release(137);
      return {};
    });
    io.stream = async (cmd, args, opts) => {
      io.calls.push({ cmd, args, cwd: opts.cwd, env: opts.env, input: opts.input, streamed: true });
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };
    const r = await asAgent(
      3,
      ["sleep", "999"],
      { cwd: "/srv/shipify-agent-3", timeoutMs: 20 },
      io,
    );
    expect(r).toEqual({ code: 124, timedOut: true });
    const kill = io.calls.find((c) => c.args.includes("kill"));
    expect(kill?.args).toEqual(["-n", "-u", "shipify-agent-3", "--", "kill", "-KILL", "-1"]);
  });

  it("runs the wrapper's shell as it would as the agent: secrets exported, the rest of stdin, umask 027", () => {
    const work = mkdtempSync(join(tmpdir(), "agent-"));
    const { args, head } = sudoArgs(
      1,
      ["/bin/sh", "-c", 'printf "%s|%s|%s|" "$TOKEN_A" "$(umask)" "$(pwd)"; cat; env | sort'],
      {
        cwd: work,
        env: { HOME: work, SHIPIFY_TASK: "7" },
        secrets: { TOKEN_A: "a value with spaces, $dollars and 'quotes'" },
      },
    );
    // Without sudo (args[4] on is what sudo runs): the same env -i and wrapper.
    const r = spawnSync(args[4] as string, args.slice(5), {
      input: `${head}the rest of stdin\n`,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `a value with spaces, $dollars and 'quotes'|0027|${realpathSync(work)}|the rest of stdin\n`,
    );
    const names = r.stdout
      .split("\n")
      .slice(1)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => l.split("=")[0]);
    // Only what was given (sh adds PWD), and nothing of this process's environment.
    expect(
      names.filter((n) => !["PWD", "SHLVL", "OLDPWD", "_"].includes(n as string)).sort(),
    ).toEqual(
      [
        "HOME",
        "LANG",
        "LOGNAME",
        "PATH",
        "SHIPIFY_TASK",
        "TOKEN_A",
        "USER",
        ...(process.env.TZ ? ["TZ"] : []),
      ].sort(),
    );
    expect(r.stdout).not.toContain(SENTINEL);
  });

  it("runs the wrapper's shell with a login: on fd 3, a pipe read once, in no environment", () => {
    const work = mkdtempSync(join(tmpdir(), "agent-"));
    const login = "a login with spaces, $dollars, `ticks`, \\ and 'quotes'";
    const { args, head } = sudoArgs(
      1,
      [
        "/bin/sh",
        "-c",
        '[ -p /dev/fd/3 ] && echo pipe; printf "first[%s]\\n" "$(cat <&3)"; printf "again[%s]\\n" "$(cat <&3)"; cat; env',
      ],
      { cwd: work, secrets: { TOKEN_A: "a" }, login },
    );
    const r = spawnSync(args[4] as string, args.slice(5), {
      input: `${head}the rest of stdin\n`,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`pipe\nfirst[${login}]\nagain[]\nthe rest of stdin\n`);
    // Once, and only on the pipe: not exported, nor anywhere in its environment.
    expect(r.stdout.split(login)).toHaveLength(2);
    expect(r.stdout).toContain("TOKEN_A=a");
  });
});

describe("the sandbox: killing and cleaning", () => {
  it("kills as the agent, and checks nothing is left", () => {
    const io = fakeIo((c) =>
      isLeftCheck(c) ? { code: 1 } : { code: 1, stderr: "kill: (-1) - No such process" },
    );
    expect(killAll(2, io)).toBe(true);
    const [kill, left] = io.calls;
    expect([kill?.cmd, ...(kill?.args ?? [])]).toEqual([
      "sudo",
      "-n",
      "-u",
      "shipify-agent-2",
      "--",
      "kill",
      "-KILL",
      "-1",
    ]);
    // The check, as the runner itself (no sudo), for that agent.
    expect(left && isLeftCheck(left)).toBe(true);
    expect(left?.args.at(-1)).toBe("shipify-agent-2");
    expect(io.calls).toHaveLength(2);
    // Something survived the first time: killed again.
    let survivors = 2;
    const again = fakeIo((c) => (isLeftCheck(c) ? { code: survivors-- > 0 ? 0 : 1 } : {}));
    expect(killAll(1, again)).toBe(true);
    expect(again.calls.filter(isLeftCheck)).toHaveLength(3);
    // sudo refused (no rule, or no such user): not done, and said so.
    const refused = fakeIo(() => ({ code: 1, stderr: "sudo: a password is required" }));
    expect(killAll(1, refused)).toBe(false);
    // A process that never goes, or a check that can't tell: not done.
    for (const code of [0, 2])
      expect(
        killAll(
          1,
          fakeIo((c) => (isLeftCheck(c) ? { code } : {})),
        ),
      ).toBe(false);
  });

  it("checks the agent's range too: its containers' processes run as IDs of it (ADR 0064)", () => {
    const io = fakeIo((c) => (isLeftCheck(c) ? { code: 1 } : {}));
    killAll(1, io);
    const script = io.calls.find(isLeftCheck)?.args[1] ?? "";
    // One read of the process list, and the agent's range from /etc/subuid.
    expect(script).toContain("ps -A -o uid=");
    expect(script).toContain("/etc/subuid");
    expect(script.match(/\bps\b/g)).toHaveLength(1);
    // Run for real, as this user: this process is one of its own, so something is left; a user
    // that doesn't exist can't be told about.
    const me = spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim();
    const run = (user: string) =>
      spawnSync("/bin/sh", ["-c", script, "left", user], { encoding: "utf8" }).status;
    expect(run(me)).toBe(0);
    expect(run("shipify-no-such-user")).toBe(2);
  });

  it("removes a slot's old runs as its agent, counting them; nothing where there's no slot folder", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    mkdirSync(join(root, "shipify-agent-1"));
    const io = fakeIo(() => ({ stdout: "gone\ngone\n" }), root);
    expect(cleanRuns(1, STALE_RUN_MS, io)).toEqual({ ok: true, removed: 2 });
    const [call] = io.calls;
    expect(call?.args.slice(0, 3)).toEqual(["-n", "-u", "shipify-agent-1"]);
    expect(call?.args[call.args.indexOf("shipify-agent") + 1]).toBe(join(root, "shipify-agent-1"));
    const find = command(call as Call);
    expect(find.slice(0, 10)).toEqual([
      "find",
      ".",
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-name",
      "run-*",
      "-mmin",
      "+480",
    ]);
    // All of them (before a run): no age.
    cleanRuns(1, 0, io);
    expect(command(io.calls[1] as Call)).not.toContain("-mmin");
    // No folder for slot 2 here: nothing to run.
    expect(cleanRuns(2, 0, io)).toEqual({ ok: true, removed: 0 });
    expect(io.calls).toHaveLength(2);
    const failing = fakeIo(() => ({ code: 1, stderr: "sudo: a password is required" }), root);
    expect(cleanRuns(1, 0, failing)).toMatchObject({
      ok: false,
      error: "sudo: a password is required",
    });
  });

  it("removes what a container wrote under its own IDs through podman unshare, with Podman's names (ADR 0064)", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    mkdirSync(join(root, "shipify-agent-1"));
    const io = fakeIo(() => ({}), root);
    cleanRuns(1, 0, io);
    const [call] = io.calls;
    const rm = command(call as Call).at(-4) ?? "";
    // Plain rm first; only what it couldn't remove goes through podman unshare, where the agent is
    // root over its range; a folder still there is an error.
    expect(rm).toContain('rm -rf -- "$d" 2>/dev/null');
    expect(rm).toContain('podman unshare rm -rf -- "$d"');
    expect(rm.indexOf("rm -rf")).toBeLessThan(rm.indexOf("podman unshare"));
    expect(namesOf(call as Call)).toMatchObject(containerEnv(1, root));
  });

  it("cleans every slot's leftovers on this machine, and nothing where there's no sandbox", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    expect(
      cleanStaleRuns(
        STALE_RUN_MS,
        fakeIo(() => ({}), root),
      ),
    ).toEqual({ removed: 0, failed: [] });
    mkdirSync(join(root, "shipify-agent-1"));
    mkdirSync(join(root, "shipify-agent-2"));
    const io = fakeIo(
      (c) =>
        c.args.includes("shipify-agent-2") ? { code: 1, stderr: "nope" } : { stdout: "gone\n" },
      root,
    );
    expect(cleanStaleRuns(STALE_RUN_MS, io)).toEqual({
      removed: 1,
      failed: ["shipify-agent-2: nope"],
    });
  });

  it("trims the kept caches, never inside the containers' store, which Podman prunes (ADR 0064)", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    mkdirSync(join(root, "shipify-agent-1"));
    const io = fakeIo(() => ({}), root);
    cleanStaleRuns(STALE_RUN_MS, io);
    const trim = io.calls.map((c) => command(c)).find((c) => c[0] === "/bin/sh")?.[2] ?? "";
    expect(trim).toContain("-atime +30");
    expect(trim.match(/! -path "data\/containers\/\*"/g)).toHaveLength(2);
    expect(trim).toContain('! -path "data/containers"');
  });

  it("prunes each slot's containers' store weekly, as its agent: every image, and what an unclean stop left", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    for (const d of ["shipify-agent-1", "shipify-agent-2"]) mkdirSync(join(root, d));
    const io = fakeIo(
      (c) =>
        c.args.includes("shipify-agent-2")
          ? { code: 1, stderr: "Error: something\n" }
          : { stdout: "pruned\n" },
      root,
    );
    expect(pruneContainers(io)).toEqual({
      pruned: 1,
      failed: ["shipify-agent-2: Error: something"],
    });
    const [call] = io.calls;
    expect(call?.args.slice(0, 3)).toEqual(["-n", "-u", "shipify-agent-1"]);
    expect(call?.args[call.args.indexOf("shipify-agent") + 1]).toBe(join(root, "shipify-agent-1"));
    const script = command(call as Call)[2] ?? "";
    // Only where the slot has a store; reset as after a restart; every image, then the leftovers.
    expect(script).toContain("[ -d data/containers ]");
    expect(script).toContain("podman system prune --all --force --volumes");
    expect(script).toContain("podman system prune --external --force");
    expect(script.indexOf("--all")).toBeLessThan(script.indexOf("--external"));
    expect(namesOf(call as Call)).toMatchObject(containerEnv(1, root));
    // A slot whose agent has no store, or no Podman: nothing said, nothing failed.
    expect(pruneContainers(fakeIo(() => ({}), root))).toEqual({ pruned: 0, failed: [] });
  });

  it("prepares a run: what's left of the slot's agent killed, its earlier runs gone, fresh folders", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    mkdirSync(join(root, "shipify-agent-2"));
    const io = fakeIo((c) => (isLeftCheck(c) ? { code: 1 } : {}), root);
    const run = prepareRun(2, "77-1", io);
    expect(run.dir).toBe(join(root, "shipify-agent-2", "run-77-1"));
    const [kill, left, clean, make] = io.calls;
    expect(kill?.args).toContain("kill");
    expect(left && isLeftCheck(left)).toBe(true);
    expect(command(clean as Call)[0]).toBe("find");
    // Nothing of Podman's ran (the script said nothing): no second kill.
    expect(io.calls).toHaveLength(4);
    const script = command(make as Call);
    expect(script.slice(0, 2)).toEqual(["/bin/sh", "-c"]);
    expect(script[2]).toContain('mkdir -m 2710 -- "$1"');
    expect(script[2]).toContain("mkdir -m 700 home config tmp work read in");
    // The slot's kept caches, under the agent's home: downloads once per slot, not per run. A test
    // browser too: Playwright's own place is ~/.cache (ADR 0041), with no folder shared between slots.
    expect(script[2]).toContain("mkdir -p -m 700 -- cache data\n");
    expect(script[2]).toContain("ln -s ../../cache home/.cache");
    expect(script[2]).toContain("mkdir -m 2750 out");
    expect(script[2]).not.toContain("shared");
    expect(script.slice(3)).toEqual(["prepare", run.dir]);
    expect(Object.keys(run.env).filter((k) => /BROWSERS|SHARED/.test(k))).toEqual([]);
    // sudo refused: no run.
    const refused = fakeIo(() => ({ code: 1, stderr: "sudo: a password is required" }), root);
    expect(() => prepareRun(2, "78", refused)).toThrow(/Couldn't stop/);
  });

  it("starts a run as after a restart for Podman: runtime/ emptied, the last run's containers pruned only when it used them (ADR 0064)", () => {
    const root = mkdtempSync(join(tmpdir(), "srv-"));
    mkdirSync(join(root, "shipify-agent-1"));
    // The reset says it ran Podman: the agent's processes are killed and checked again after it.
    const io = fakeIo(
      (c) =>
        isLeftCheck(c)
          ? { code: 1 }
          : command(c).at(-2) === "prepare"
            ? { stdout: "podman\n" }
            : {},
      root,
    );
    prepareRun(1, "80-1", io);
    const make = io.calls.find((c) => command(c).at(-2) === "prepare") as Call;
    const script = command(make)[2] ?? "";
    // Before the run's folder, with Podman's names: runtime/ emptied, and only when Podman left
    // state there (runtime/libpod), one prune of the containers, pods, volumes and networks (the
    // images stay), with the pause process it starts stopped and runtime/ emptied again.
    expect(script.indexOf("fresh")).toBeLessThan(script.indexOf('mkdir -m 2710 -- "$1"'));
    expect(script).toContain("[ -d runtime/libpod ]");
    expect(script).toContain("podman system prune --force --volumes");
    expect(script).not.toContain("prune --all");
    expect(script).toContain("kill -KILL -1");
    expect(namesOf(make)).toMatchObject(containerEnv(1, root));
    const after = io.calls.slice(io.calls.indexOf(make) + 1);
    expect(after.map((c) => (isLeftCheck(c) ? "left" : command(c).slice(-3).join(" ")))).toEqual([
      "kill -KILL -1",
      "left",
    ]);
  });

  it("gives the agent its files as the agent, on stdin, only inside its run's folder", () => {
    const io = fakeIo();
    const run = runPaths(1, "5");
    give(run, { "in/prompt.md": "hello", "in/skills/x/SKILL.md": Buffer.from([0, 1, 2]) }, io);
    const [call] = io.calls;
    expect(command(call as Call).slice(0, 2)).toEqual(["/usr/local/bin/node", "-e"]);
    expect(call?.args[call.args.indexOf("shipify-agent") + 1]).toBe(run.dir);
    expect(JSON.parse(call?.input ?? "")).toEqual([
      ["in/prompt.md", Buffer.from("hello").toString("base64")],
      ["in/skills/x/SKILL.md", "AAEC"],
    ]);
    for (const bad of ["/etc/passwd", "../run-6/in/x", "in/../../x", ""])
      expect(() => give(run, { [bad]: "x" }, io), bad).toThrow(/inside the run/);
  });

  it("links a folder it may read into its own, as the agent: only to an absolute path", () => {
    const io = fakeIo();
    const run = runPaths(1, "5");
    give(run, { "config/skills": { link: "/opt/shipify/tool/shipify-app/abc/skills" } }, io);
    expect(JSON.parse(io.calls[0]?.input ?? "")).toEqual([
      ["config/skills", "", "/opt/shipify/tool/shipify-app/abc/skills"],
    ]);
    for (const bad of ["skills", "/opt/x/../etc", ""])
      expect(() => give(run, { "config/skills": { link: bad } }, io), bad).toThrow(/to link to/);
    expect(() => give(run, { "../x": { link: "/opt" } }, io)).toThrow(/inside the run/);
  });
});

describe("the sandbox: taking back what the agent left in out/", () => {
  const made = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "srv-")));
    const run = runPaths(1, "9", root);
    mkdirSync(run.out, { recursive: true });
    return run;
  };

  it("reads a plain file, and lists only plain files", () => {
    const run = made();
    writeFileSync(join(run.out, "result.json"), '{"v":1}');
    mkdirSync(join(run.out, "folder"));
    symlinkSync("/etc/hostname", join(run.out, "link.txt"));
    expect(readOut(run, "result.json")?.toString()).toBe('{"v":1}');
    expect(listOut(run)).toEqual(["result.json"]);
  });

  it("never follows a link, reads a pipe, a folder or a big file, or a name that's a path", () => {
    const run = made();
    const secret = join(run.dir, "runner-secret");
    writeFileSync(secret, "the runner's");
    symlinkSync(secret, join(run.out, "result.json"));
    expect(readOut(run, "result.json")).toBeUndefined();
    mkdirSync(join(run.out, "dir"));
    expect(readOut(run, "dir")).toBeUndefined();
    writeFileSync(join(run.out, "big.bin"), Buffer.alloc(2048));
    expect(readOut(run, "big.bin", 1024)).toBeUndefined();
    expect(readOut(run, "big.bin", 4096)?.length).toBe(2048);
    expect(readOut(run, "../runner-secret")).toBeUndefined();
    if (spawnSync("mkfifo", [join(run.out, "pipe")]).status === 0)
      expect(readOut(run, "pipe")).toBeUndefined();
  });

  it("refuses an out/ the agent swapped for a link to somewhere else", () => {
    const run = made();
    const elsewhere = mkdtempSync(join(tmpdir(), "runner-"));
    writeFileSync(join(elsewhere, ".credentials"), "the runner's");
    // out/ replaced by a link: the runner's own folder, as the agent would like it read.
    spawnSync("rm", ["-rf", run.out]);
    symlinkSync(elsewhere, run.out);
    expect(listOut(run)).toEqual([]);
    expect(readOut(run, ".credentials")).toBeUndefined();
  });
});

describe("doctor: the sandbox check", () => {
  const box = (opts: { mode?: number; slots?: number } = {}) => {
    const home = mkdtempSync(join(tmpdir(), "shipify-home-"));
    chmodSync(home, opts.mode ?? 0o700);
    const dir = join(home, "runner");
    mkdirSync(dir);
    for (let k = 2; k <= (opts.slots ?? 1); k++) mkdirSync(join(dir, `slot-${k}`));
    return { home, dir };
  };
  /** What the login probe finds on a right box: a pipe, read once, in no environment, ptrace 1. */
  const WALLED = "pipe\nread\nonce\nunseen\nptrace 1\n";
  /** A machine where each probe fails (can't read) unless it's for `leaky`. */
  const machine = (leaky?: string, sudo = 0, login = WALLED) =>
    fakeIo((c) => {
      if (c.cmd === "id") return {};
      const cmd = command(c);
      if (cmd[0] === "true")
        return { code: sudo, stderr: sudo ? "sudo: a password is required" : "" };
      if (cmd.at(-1) === "login") return { stdout: login };
      return { code: cmd.at(-1) === leaky ? 0 : 1 };
    });

  it("on a box: each slot's agent exists, starts without a password and reads none of the runner's", () => {
    const { home, dir } = box({ slots: 2 });
    const io = machine();
    const c = sandboxCheck({
      user: "shipify",
      home,
      boxDir: dir,
      inJob: true,
      umask: 0o077,
      pid: 4242,
      io,
    });
    expect(c).toMatchObject({ ok: true });
    expect(c?.detail).toContain("shipify-agent-1, shipify-agent-2");
    const probed = io.calls
      .filter((x) => command(x)[0] === "/bin/sh")
      .map((x) => [x.args[2], command(x).at(-1)]);
    expect(probed).toEqual([
      ["shipify-agent-1", home],
      ["shipify-agent-1", join(dir, "_work")],
      ["shipify-agent-1", "/srv/shipify-agent-2"],
      ["shipify-agent-1", "/proc/4242/environ"],
      ["shipify-agent-1", "windows"],
      ["shipify-agent-1", "sockets"],
      ["shipify-agent-1", "login"],
      ["shipify-agent-2", home],
      ["shipify-agent-2", join(dir, "_work")],
      ["shipify-agent-2", "/srv/shipify-agent-1"],
      ["shipify-agent-2", "/proc/4242/environ"],
      ["shipify-agent-2", "windows"],
      ["shipify-agent-2", "sockets"],
      ["shipify-agent-2", "login"],
    ]);
    // The login probe gets a dummy login, through the wrapper as a run's does, and again on its
    // stdin to compare: never on a command line.
    const probe = io.calls.find((x) => command(x).at(-1) === "login");
    const [first, again] = (probe?.input ?? "").split("\n");
    expect(first).toMatch(/^shipify-check-[0-9a-f]{16}$/);
    expect(again).toBe(first);
    expect(probe?.args.join(" ")).not.toContain(first);
  });

  it("proves the login's walls with a dummy: on a pipe, read once, in no environment, memory closed", () => {
    const { home, dir } = box();
    const check = (login: string) =>
      sandboxCheck({ user: "shipify", home, boxDir: dir, inJob: false, io: machine("", 0, login) })
        ?.detail;
    expect(check("read\nonce\nptrace 1\n")).toBe(
      "shipify-agent-1's login: isn't on a pipe, is in its environment",
    );
    expect(check("pipe\nunseen\nptrace 1\n")).toBe(
      "shipify-agent-1's login: doesn't reach it on fd 3, can be read twice",
    );
    expect(check("pipe\nread\nonce\nunseen\nptrace 0\n")).toContain(
      "shipify-agent-1's commands can read its memory, its login there: kernel.yama.ptrace_scope is 0, not 1",
    );
    expect(check("pipe\nread\nonce\nunseen\nptrace \n")).toContain("ptrace_scope is missing");
    expect(check(WALLED)).toContain("can't read the runner's folders");
  });

  it("on WSL: says what of Windows an agent can reach, and where it's closed", () => {
    const { home, dir } = box();
    const io = fakeIo((c) => {
      if (c.cmd === "id") return {};
      const cmd = command(c);
      if (cmd.at(-1) === "windows") return { stdout: "Windows programs (interop)\n/mnt/c\n" };
      return { code: cmd[0] === "true" ? 0 : 1 };
    });
    const c = sandboxCheck({ user: "shipify", home, boxDir: dir, inJob: false, io });
    expect(c).toMatchObject({ ok: false });
    expect(c?.detail).toContain(
      "shipify-agent-1 can reach Windows: Windows programs (interop), /mnt/c (WSL: close it in /etc/wsl.conf",
    );
  });

  it("gives no sandbox while an agent can write to a root container socket (ADR 0064)", () => {
    const { home, dir } = box();
    const io = fakeIo((c) => {
      if (c.cmd === "id") return {};
      const cmd = command(c);
      if (cmd.at(-1) === "sockets") return { stdout: "/run/docker.sock\n" };
      if (cmd.at(-1) === "login") return { stdout: WALLED };
      return { code: cmd[0] === "true" ? 0 : 1 };
    });
    const c = sandboxCheck({ user: "shipify", home, boxDir: dir, inJob: false, io });
    expect(c).toMatchObject({ ok: false });
    expect(c?.detail).toBe(
      "shipify-agent-1 can write /run/docker.sock, a root container socket (the docker group, or Docker's or Podman's root socket, gives the box: docs/security.md#the-agents-sandbox)",
    );
    // The probe: Docker's socket and Podman's root one, each written only by whom it lets in.
    const probe = io.calls.find((x) => command(x).at(-1) === "sockets");
    const script = command(probe as Call)[2] ?? "";
    expect(script).toContain("/run/docker.sock /run/podman/podman.sock");
    expect(script).toContain('[ -w "$s" ]');
  });

  it("says what's open, each with the fix", () => {
    const { home, dir } = box();
    const leak = sandboxCheck({
      user: "shipify",
      home,
      boxDir: dir,
      inJob: false,
      pid: 7,
      io: machine("/proc/7/environ"),
    });
    expect(leak).toMatchObject({ ok: false, detail: "shipify-agent-1 can read /proc/7/environ" });
    expect(leak?.fix).toContain("pnpm ship box add");
    expect(leak?.blocking).not.toBe(false);
    const nosudo = sandboxCheck({
      user: "shipify",
      home,
      boxDir: dir,
      inJob: false,
      io: machine(undefined, 1),
    });
    expect(nosudo?.detail).toContain("sudo -n doesn't start shipify-agent-1");
    const missing = sandboxCheck({
      user: "shipify",
      home,
      boxDir: dir,
      inJob: false,
      io: fakeIo((c) => (c.cmd === "id" ? { code: 1 } : {})),
    });
    expect(missing?.detail).toBe("no user shipify-agent-1");
    const open = box({ mode: 0o750 });
    expect(
      sandboxCheck({
        user: "shipify",
        home: open.home,
        boxDir: open.dir,
        inJob: false,
        io: machine(),
      })?.detail,
    ).toContain("is 0750, not 0700");
    expect(
      sandboxCheck({ user: "shipify", home, boxDir: dir, inJob: true, umask: 0o022, io: machine() })
        ?.detail,
    ).toContain("umask 0022, not 0077");
  });

  it("checks only a box's own user: your login, on this PC or any machine, gets no check", () => {
    const home = mkdtempSync(join(tmpdir(), "home-"));
    expect(sandboxCheck({ user: "me", home, boxDir: undefined, io: machine() })).toBeUndefined();
    expect(sandboxCheck({ user: "me", home, boxDir: "/somewhere", io: machine() })).toBeUndefined();
  });
});

describe("the sandbox's own scripts, run for real (as this user, without the sudo hop)", () => {
  /** A machine that runs what sudo would, as this user: env -i, the wrapper and the command. */
  const local = (root: string): SandboxIo => ({
    ...fakeIo(() => ({}), root),
    root,
    run(cmd, args, opts) {
      if (cmd === "/bin/sh" && args[2] === "left") return { code: 1, stdout: "", stderr: "" };
      if (args.includes("kill"))
        return { code: 1, stdout: "", stderr: "kill: (-1) - No such process" };
      const argv = cmd === "sudo" ? args.slice(4) : [cmd, ...args];
      const r = spawnSync(
        argv[0] as string,
        argv.slice(1).map((a) => (a === "/usr/local/bin/node" ? process.execPath : a)),
        { cwd: opts.cwd, input: opts.input, encoding: "utf8" },
      );
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
  });
  const mode = (p: string) => statSync(p).mode & 0o7777;

  it("prepares a run's folders with their modes, and clears the slot's earlier runs", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "srv-")));
    const slot = join(root, "shipify-agent-1");
    mkdirSync(slot);
    // An earlier run, with a folder the agent made read-only (as Go's module cache does).
    mkdirSync(join(slot, "run-old", "work", "locked"), { recursive: true });
    writeFileSync(join(slot, "run-old", "work", "locked", "f"), "x");
    chmodSync(join(slot, "run-old", "work", "locked"), 0o500);
    const io = local(root);
    const run = prepareRun(1, "42-1", io);
    expect(existsSync(join(slot, "run-old"))).toBe(false);
    expect(mode(run.dir)).toBe(0o2710);
    // Only the agent's (each keeps the setgid bit it inherits, as Linux does).
    for (const d of [run.home, run.config, run.work, run.in, join(run.dir, "tmp")])
      expect(mode(d) & 0o777, d).toBe(0o700);
    expect(mode(run.out)).toBe(0o2750);
    expect(existsSync(join(slot, "shared"))).toBe(false);
    // Its files, given as the agent; the result taken back from out/.
    give(run, { "in/prompt.md": "do it", "in/skills/a/SKILL.md": "skill" }, io);
    expect(readFileSync(join(run.in, "skills", "a", "SKILL.md"), "utf8")).toBe("skill");
    expect(mode(join(run.in, "prompt.md"))).toBe(0o600);
    // A link to a folder it reads, made as the agent, in place of what it left there.
    mkdirSync(join(run.config, "skills", "old"), { recursive: true });
    give(run, { "config/skills": { link: run.in } }, io);
    expect(readFileSync(join(run.config, "skills", "prompt.md"), "utf8")).toBe("do it");
    writeFileSync(join(run.out, "result.json"), "{}");
    expect(readOut(run, "result.json")?.toString()).toBe("{}");
    // Its caches are the slot's: what a run downloads is there for the next, its work isn't.
    writeFileSync(join(run.home, ".cache", "pkg"), "downloaded once");
    writeFileSync(join(run.work, "change"), "this run's");
    // What a tool left in runtime/ goes at the next run's start. (Never Podman's own state here:
    // with it, the reset stops every process of the agent's, which in this test is this user.)
    expect(mode(join(slot, "runtime")) & 0o777).toBe(0o700);
    writeFileSync(join(slot, "runtime", "a-socket"), "");
    mkdirSync(join(slot, "runtime", "locked"));
    chmodSync(join(slot, "runtime", "locked"), 0o500);
    const next = prepareRun(1, "43-1", io);
    expect(readFileSync(join(next.home, ".cache", "pkg"), "utf8")).toBe("downloaded once");
    expect(existsSync(join(next.home, ".local", "share"))).toBe(true);
    expect(existsSync(join(next.work, "change"))).toBe(false);
    expect(existsSync(run.dir)).toBe(false);
    expect(readdirSync(join(slot, "runtime"))).toEqual([]);
    expect(mode(join(slot, "runtime")) & 0o777).toBe(0o700);
    // The data the run's home links to is the slot's, as XDG_DATA_HOME names it.
    expect(realpathSync(join(next.home, ".local", "share"))).toBe(next.env.XDG_DATA_HOME);
  });

  it("proves a login's walls for real: the dummy reaches the probe on a pipe, once, in no environment", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "srv-")));
    mkdirSync(join(root, "shipify-agent-1"));
    const io = local(root);
    const run = io.run.bind(io);
    // The agent's user is this one here; every other wall is a path nobody can read.
    io.run = (cmd, args, opts) =>
      cmd === "id" ? { code: 0, stdout: "", stderr: "" } : run(cmd, args, opts);
    const nowhere = join(root, "missing");
    const problems = sandboxProblems([1], { home: nowhere, work: nowhere, pid: 0 }, io);
    expect(problems.filter((p) => p.includes("'s login:"))).toEqual([]);
  });

  it("removes only runs older than asked, each whole", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "srv-")));
    const slot = join(root, "shipify-agent-2");
    for (const r of ["run-old", "run-new", "keep-me"])
      mkdirSync(join(slot, r, "work"), { recursive: true });
    const hours = (h: number) => new Date(Date.now() - h * 3_600_000);
    utimesSync(join(slot, "run-old"), hours(9), hours(9));
    const io = local(root);
    expect(cleanRuns(2, STALE_RUN_MS, io)).toEqual({ ok: true, removed: 1 });
    expect(readdirSync(slot).sort()).toEqual(["keep-me", "run-new"]);
    expect(cleanStaleRuns(0, io)).toEqual({ removed: 1, failed: [] });
    expect(readdirSync(slot)).toEqual(["keep-me"]);
  });
});
