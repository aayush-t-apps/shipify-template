import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import { inAYear, withKeyDates } from "../lib/key-dates.ts";

const tryJson = <T>(s: string): T | undefined => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
};

import { cpus, freemem, homedir, totalmem, userInfo } from "node:os";
import { join } from "node:path";
import { type Executors, loadExecutors, readExecutors } from "../lib/agents.ts";
import { listStacks } from "../lib/catalog.ts";
import { gitTakesPathspecFiles } from "../lib/checkouts.ts";
import { PLATFORM_ROOT } from "../lib/config.ts";
import { credential, credentialsFile, loadCredentials } from "../lib/credentials.ts";
import { has, run } from "../lib/exec.ts";
import { ghRun, platformRepo } from "../lib/github.ts";
import { type Check, ok, type Result } from "../lib/output.ts";
import { sourceControl } from "../lib/providers.ts";
import { stale } from "../lib/settings.ts";
import {
  agentsNetProblems,
  agentUser,
  containersProblems,
  REAL_IO,
  type SandboxIo,
  sandboxProblems,
} from "../lib/sandbox.ts";
import { loadTools, readTools, toolChecks } from "../lib/tools.ts";
import { watchState } from "../lib/watch.ts";
import { DISK_FLOOR_BYTES } from "../lib/clones.ts";

const GB = 1024 ** 3;
const DAY = 86_400_000;

/**
 * This login's expiry, from the header GitHub sends with every reply: YYYY-MM-DD, "never" for a
 * token without one, or undefined when GitHub didn't answer.
 */
export function tokenExpiry(headers: string): string | undefined {
  const line = headers.split("\n").find((l) => /^github-authentication-token-expiration:/i.test(l));
  if (!line) return "never";
  return /(\d{4}-\d{2}-\d{2})/.exec(line)?.[1];
}

/** The machine itself: what a box needs to build and test projects (docs/tasks.md). */
function hostChecks(): Check[] {
  const checks: Check[] = [];
  const disk = statfsSync(".");
  const free = (disk.bavail * disk.bsize) / GB;
  checks.push({
    name: "host",
    ok: true,
    detail: `${process.platform} ${process.arch}, ${cpus().length} CPUs, ${(totalmem() / GB).toFixed(1)} GB RAM (${(freemem() / GB).toFixed(1)} free)`,
    blocking: false,
  });
  checks.push({
    name: `disk space (${DISK_FLOOR_BYTES / GB} GB free or more)`,
    ok: free >= DISK_FLOOR_BYTES / GB,
    detail: `${free.toFixed(1)} GB free`,
    blocking: false,
    fix: "free some space: pnpm store prune, or remove old worktrees",
  });
  if (process.arch === "arm64") {
    // Some runtimes that tests start locally reserve 48-bit addresses; a 39-bit kernel breaks them.
    const configs = [
      "/proc/config.gz",
      `/boot/config-${readFileSync("/proc/sys/kernel/osrelease", "utf8").trim()}`,
    ];
    const text = configs
      .map((f) => {
        if (!existsSync(f)) return "";
        const r = f.endsWith(".gz") ? run("sh", ["-c", `zcat ${f}`]) : run("cat", [f]);
        return r.stdout;
      })
      .join("\n");
    const bits = /^CONFIG_ARM64_VA_BITS=(\d+)$/m.exec(text)?.[1];
    checks.push({
      name: "kernel address size (48-bit for local test servers)",
      ok: !bits || Number(bits) >= 48,
      detail: bits ? `${bits}-bit` : "unknown",
      blocking: false,
      fix: "use Ubuntu Server 24.04 LTS (Raspberry Pi OS's kernel is 39-bit: docs/box-setup.md)",
    });
  }
  return checks;
}

/**
 * What this machine needs to run Shipify and build its stacks, each blocking, with its fix: Node 22,
 * the CLI's tools and each stack's, and each stack's own checks (its libraries). `ship setup`'s
 * first step is these too.
 */
export function machineChecks(stacks = listStacks()): Check[] {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node ≥ 22",
    ok: major >= 22,
    detail: process.version,
    fix: "install Node 22 (docs/setup.md)",
  });
  // The CLI itself runs on node, pnpm, git and gh; stacks name what their make targets need
  // (make among them), so the core needs no more (ADR 0047).
  const tools = [
    ...new Set([
      "pnpm",
      "git",
      "gh",
      ...(stacks.length ? ["make"] : []),
      ...stacks.flatMap((s) => s.requires),
    ]),
  ];
  for (const tool of tools) {
    const found = has(tool);
    const version = found ? run(tool, ["--version"]).stdout.split("\n")[0]?.trim() : undefined;
    checks.push({
      name: tool,
      ok: found,
      detail: version,
      fix: found ? undefined : `install ${tool} (see docs/setup.md)`,
    });
    // Every commit Shipify makes leaves out a checkout inside the tree (ADR 0041): git 2.26 on.
    if (tool === "git" && found && !gitTakesPathspecFiles(version ?? ""))
      checks.push({
        name: "git ≥ 2.26",
        ok: false,
        detail: version,
        fix: "update git to 2.26 or newer (see docs/setup.md)",
      });
  }
  const seen = new Set<string>();
  for (const stack of stacks) {
    for (const d of stack.doctor.filter((x) => !seen.has(x.name))) {
      seen.add(d.name);
      checks.push({
        name: `${d.name} (${stack.id})`,
        ok: run("sh", ["-c", d.run]).code === 0,
        fix: d.fix,
      });
    }
  }
  return checks;
}

export async function doctor(opts: { yes?: boolean } = {}): Promise<Result> {
  const checks: Check[] = [];
  const stacks = listStacks();
  checks.push(...machineChecks(stacks));
  checks.push(agentCheck());
  checks.push(pluginFilesCheck());
  checks.push(...hostChecks());
  const setup = setupCheck();
  if (setup) checks.push(setup);
  const sandbox = sandboxCheck();
  if (sandbox) checks.push(sandbox);
  const containers = containersCheck();
  if (containers) checks.push(containers);
  checks.push(watchCheck());
  checks.push(...toolKeyChecks());
  checks.push({
    name: "tmux (optional, for phone sessions)",
    ok: has("tmux"),
    blocking: false,
    fix: "sudo apt install -y tmux",
  });

  // In a task job, the bot's token has no user: check that it reaches the platform repo instead.
  const inJob = process.env.GITHUB_ACTIONS === "true";
  if (inJob) {
    const r = ghRun(["api", `repos/${platformRepo()}`, "--jq", ".full_name"]);
    checks.push({
      name: "GitHub access from this job",
      ok: r.code === 0,
      detail: r.stdout.trim() || r.stderr.trim(),
    });
  }
  const who = inJob ? undefined : sourceControl().whoami();
  if (!inJob)
    checks.push({
      name: "GitHub login",
      ok: Boolean(who),
      detail: who ? `${who.login}` : undefined,
      fix: "gh auth login",
    });
  if (who) {
    // Fine-grained tokens report no OAuth scopes; classic/OAuth logins do.
    const fineGrained = who.scopes.length === 0;
    checks.push({
      name: "gh uses a fine-grained token limited to the org (recommended)",
      ok: fineGrained,
      detail: fineGrained ? "fine-grained" : `broad OAuth login: ${who.scopes.join(", ")}`,
      blocking: false,
      fix: "make a fine-grained token (shipify-pc) as in docs/setup.md, Tokens and secrets",
    });
    // Your copy, on your own account or an org's (ADR 0047): this login administers it.
    const repo = platformRepo();
    const admin = ghRun(["api", `repos/${repo}`, "--jq", ".permissions.admin"]);
    checks.push({
      name: `token can administer ${repo}`,
      ok: admin.code === 0 && admin.stdout.trim() === "true",
      fix: "sign this PC in as your copy's owner (or an admin of its org): a fine-grained token for it, with Administration (docs/setup.md, Tokens and secrets)",
    });
    // Its boxes run what its issues and comments start: a public copy could reach them (ADR 0055).
    const priv = ghRun(["api", `repos/${repo}`, "--jq", ".private"]);
    checks.push({
      name: `${repo} is private`,
      ok: priv.stdout.trim() !== "false",
      fix: "make your copy private (Settings → General → Danger Zone): only the template is public",
    });
    // Your copy holds Shipify's settings alone (ADR 0047, docs/settings.md): a variable on no list,
    // or a value kept as a secret, is a leftover nothing reads.
    const held = sourceControl().repoState(repo);
    const left = stale({ vars: held.variables, secrets: held.secrets });
    checks.push({
      name: `${repo} holds only Shipify's settings`,
      ok: !left.length,
      detail: left.length ? `nothing reads ${left.join(", ")}` : undefined,
      blocking: false,
      fix: left.length
        ? left
            .map((l) => {
              const [kind, name] = l.split(" ");
              return `gh ${kind} delete ${name} -R ${repo}`;
            })
            .join("; ")
        : undefined,
    });
    if (!fineGrained) {
      checks.push({
        name: 'gh scope "workflow"',
        ok: who.scopes.includes("workflow"),
        fix: "gh auth refresh -s workflow",
      });
    }
    // The watch reminds you before a key expires (ADR 0031): it can't see this PC's token, so its
    // date goes in the variable SHIPIFY_KEY_DATES (a date, never the token), as "this PC's token".
    const r = ghRun(["api", "-i", "rate_limit"]);
    const expires = r.code === 0 ? tokenExpiry(r.stdout) : undefined;
    if (expires) {
      const days = expires === "never" ? null : Math.ceil((Date.parse(expires) - Date.now()) / DAY);
      checks.push({
        name: "GitHub token isn't expiring within 30 days",
        ok: days === null || days > 30,
        detail: days === null ? "doesn't expire" : `${expires}, in ${days} days`,
        blocking: false,
        fix: "make a new one with the same access (docs/setup.md, Tokens and secrets), then gh auth login",
      });
      // The dates the watch reminds you of: this PC's token, and each agent's login a year after
      // its secret was last set (executors.json names each login's secret).
      const set: Record<string, string> = {};
      if (expires !== "never") set["this PC's token"] = expires.slice(0, 10);
      const secrets = ghRun([
        "secret",
        "list",
        "-R",
        platformRepo(),
        "--json",
        "name,updatedAt",
      ]).stdout;
      const when = tryJson<{ name: string; updatedAt: string }[]>(secrets) ?? [];
      for (const [id, e] of Object.entries(loadExecutors())) {
        const s = e.login?.secret && when.find((x) => x.name === e.login?.secret);
        if (s) set[`${id}'s login`] = inAYear(s.updatedAt);
      }
      const name = "SHIPIFY_KEY_DATES";
      const raw = ghRun(["variable", "get", name, "-R", platformRepo()]).stdout.trim();
      const next = withKeyDates(raw, set);
      if (next) {
        const ok =
          opts.yes &&
          ghRun(["variable", "set", name, "-R", platformRepo(), "--body", next]).code === 0;
        checks.push({
          name: "the watch knows when your keys expire",
          ok: Boolean(ok),
          detail: ok
            ? `recorded ${Object.entries(set)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}`
            : `not recorded yet: ${Object.keys(set).join(", ")}`,
          blocking: false,
          fix: "pnpm ship doctor --yes",
        });
      }
    }
    const proto = ghRun(["config", "get", "git_protocol", "-h", "github.com"]).stdout.trim();
    checks.push({
      name: "git pushes use HTTPS through gh (not your SSH key)",
      ok: proto === "https",
      detail: proto || "unset",
      fix: "gh config set git_protocol https -h github.com && gh auth setup-git",
      blocking: false,
    });
  }

  const creds = loadCredentials();
  checks.push({
    name: "credentials file",
    ok: creds.exists || inJob,
    blocking: !inJob,
    detail: credentialsFile(),
    fix: `create ${credentialsFile()} (chmod 600) with NAME=value lines (docs/setup.md)`,
  });
  if (creds.exists) {
    checks.push({
      name: "credentials file is private (chmod 600)",
      ok: !creds.tooOpen,
      fix: `chmod 600 ${credentialsFile()}`,
    });
  }
  // What publish will need for each stack's apps: its secrets' sources and its variables.
  const needs = new Map<string, string[]>();
  for (const stack of stacks) {
    const d = stack.deploy;
    if (!d) continue;
    const names = [...Object.values(d.secrets), ...d.vars];
    for (const n of names) needs.set(n, [...(needs.get(n) ?? []), stack.id]);
  }
  // In a job these don't apply: only publishing needs them, and the workflow passes them then. So a
  // box's doctor (the weekly clean-up, on the status issue) never reports them missing. Apps are an
  // add-on: none blocks, and `ship setup apps` sets each.
  if (!inJob)
    for (const [name, users] of needs) {
      checks.push({
        name: `${name} set (for ${users.join(", ")})`,
        ok: Boolean(credential(creds.values, name)),
        blocking: false,
        fix: `pnpm ship setup apps (it keeps each in ${credentialsFile()})`,
      });
    }

  const blocking = checks.filter((c) => !c.ok && c.blocking !== false);
  return {
    ...ok("doctor", blocking.length ? `${blocking.length} problem(s) to fix` : "all good"),
    status: blocking.length ? "blocked" : "succeeded",
    checks,
  };
}

/**
 * On a box that box/setup.sh set up (it runs as the user "shipify"): whether its setup is the
 * repo's, so a change to that script never goes unnoticed on boxes set up before it (ADR 0017).
 * A box from before setup versions has version 1.
 */
export function setupCheck(
  user = userInfo().username,
  home = homedir(),
  script = join(PLATFORM_ROOT, "box", "setup.sh"),
): Check | undefined {
  if (user !== "shipify" || !existsSync(script)) return undefined;
  const want = Number(/^SETUP_VERSION=(\d+)$/m.exec(readFileSync(script, "utf8"))?.[1] ?? 1);
  const file = join(home, ".shipify-setup");
  const have = (existsSync(file) && Number(readFileSync(file, "utf8").trim())) || 1;
  return {
    name: "box setup is the repo's",
    ok: have >= want,
    detail: have >= want ? `version ${have}` : `version ${have}; the repo's is ${want}`,
    blocking: false,
    fix: "when no task is running: on the box, its here.sh command again; or from a PC, pnpm ship box add <its SSH address> --manage (it asks for sudo once)",
  };
}

/** The slots in a box's folder: slot 1's runner in it, slot k's in `slot-<k>` (ADR 0020). */
function boxSlots(dir: string): number[] {
  if (!existsSync(dir)) return [1];
  const more = readdirSync(dir)
    .map((d) => Number(/^slot-(\d)$/.exec(d)?.[1] ?? 0))
    .filter((k) => k >= 2);
  return [1, ...more].sort((a, b) => a - b);
}

/** This process's umask, as Linux reports it (the runner's service sets it for every job). */
function umaskNow(): number | undefined {
  try {
    const line = /^Umask:\s*([0-7]+)$/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1];
    return line === undefined ? undefined : Number.parseInt(line, 8);
  } catch {
    return undefined;
  }
}

/**
 * The agent's sandbox (box setup 5, ADR 0031, lib/sandbox.ts). On a box that box/setup.sh set up
 * (as the user "shipify"): each slot's agent user exists, sudo starts it without a password, and
 * it can't read the runner's home, its jobs' folder, another slot's runs or this process's
 * environment; the home is 0700 and, in a job, the runner's umask 0077. Elsewhere (your own login,
 * on this PC or any machine), nothing: every box is set up that way (ADR 0047).
 */
export function sandboxCheck(
  opts: {
    user?: string;
    home?: string;
    boxDir?: string;
    inJob?: boolean;
    umask?: number;
    pid?: number;
    io?: SandboxIo;
  } = {},
): Check | undefined {
  const user = opts.user ?? userInfo().username;
  const home = opts.home ?? homedir();
  const boxDir = "boxDir" in opts ? opts.boxDir : process.env.SHIPIFY_BOX_DIR;
  if (user !== "shipify") return undefined;
  const dir = boxDir ?? join(home, "runner");
  const slots = boxSlots(dir);
  const problems: string[] = [];
  const mode = existsSync(home) ? statSync(home).mode & 0o777 : undefined;
  if (mode !== undefined && mode & 0o077)
    problems.push(`${home} is ${mode.toString(8).padStart(4, "0")}, not 0700`);
  const inJob = opts.inJob ?? process.env.GITHUB_ACTIONS === "true";
  const umask = opts.umask ?? umaskNow();
  if (inJob && umask !== undefined && umask !== 0o077)
    problems.push(
      `the runner's jobs run with umask ${umask.toString(8).padStart(4, "0")}, not 0077 (its service's UMask)`,
    );
  problems.push(
    ...sandboxProblems(
      slots,
      { home, work: join(dir, "_work"), pid: opts.pid ?? process.pid },
      opts.io ?? REAL_IO,
    ),
  );
  problems.push(...agentsNetProblems(opts.io ?? REAL_IO));
  const agents = slots.map(agentUser).join(", ");
  return {
    name: "sandbox: each slot's agent is walled off (box setup 5)",
    ok: !problems.length,
    detail: problems.length
      ? problems.join("; ")
      : `${agents}: can't read the runner's folders, its environment or another slot's runs, nor write a root container socket, and get their login on a pipe only`,
    fix: "when no task runs: on the box, its here.sh command again; or from a PC, pnpm ship box add <its SSH address> --manage (it asks for sudo once)",
  };
}

/**
 * The agents' containers (box setup 8 and 10, ADR 0064): on a box that box/setup.sh set up (as the
 * user "shipify"), each slot's agent opens its container store, as its runs do. Not a wall: a box
 * whose containers don't work takes every task but one that needs a container.
 */
export function containersCheck(
  opts: { user?: string; home?: string; boxDir?: string; io?: SandboxIo } = {},
): Check | undefined {
  const user = opts.user ?? userInfo().username;
  if (user !== "shipify") return undefined;
  const boxDir = "boxDir" in opts ? opts.boxDir : process.env.SHIPIFY_BOX_DIR;
  const slots = boxSlots(boxDir ?? join(opts.home ?? homedir(), "runner"));
  const problems = containersProblems(slots, opts.io ?? REAL_IO);
  return {
    name: "containers: each slot's agent runs them (box setup 10)",
    ok: !problems.length,
    detail: problems.length
      ? problems.join("; ")
      : `${slots.map(agentUser).join(", ")}: their stores open`,
    blocking: false,
    fix: 'when no task runs: on the box, its here.sh command again; if it says the same, docs/troubleshooting.md, "Containers don\'t start"',
  };
}

/**
 * Whether a box's task runs installed this program in the runner's tool cache (task.yml puts each
 * agent's pinned version in <tool cache>/<name>/<version>/bin): where a box keeps its agent.
 */
function inToolCache(program: string, cache = process.env.RUNNER_TOOL_CACHE): boolean {
  if (!cache || !existsSync(cache)) return false;
  try {
    return readdirSync(cache).some((name) => {
      const dir = join(cache, name);
      return (
        statSync(dir).isDirectory() &&
        readdirSync(dir).some((v) => existsSync(join(dir, v, "bin", program)))
      );
    });
  } catch {
    return false;
  }
}

/**
 * An agent to work with: any program executors.json can start, installed here, or on a box in the
 * runner's tool cache, where its task runs install their own (task.yml). The core names none.
 */
export function agentCheck(
  executors: Executors = loadExecutors(),
  found: (program: string) => boolean = (p) => has(p) || inToolCache(p),
): Check {
  const programs = [
    ...new Set(
      Object.values(executors).flatMap((e) =>
        e.manual ? [] : [e.task?.[0] ?? e.command?.[0] ?? ""].filter(Boolean),
      ),
    ),
  ];
  const here = programs.filter((p) => found(p));
  return {
    name: "an agent (executors.json)",
    ok: here.length > 0,
    detail: here.length ? here.join(", ") : undefined,
    blocking: false,
    fix: `install one of ${programs.join(", ")}, and sign in to it`,
  };
}

/**
 * The plug-in files (ADR 0027, docs/plug-ins.md), entry by entry: a broken entry is left out of
 * every run, so this says which and why.
 */
export function pluginFilesCheck(): Check {
  const problems = [...readTools().problems, ...readExecutors().problems];
  return {
    name: "plug-in files are right (tools.json, executors.json)",
    ok: !problems.length,
    detail: problems.length
      ? `${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ""}`
      : undefined,
    blocking: false,
    fix: "fix each named entry (docs/plug-ins.md); the rest keep working meanwhile",
  };
}

/** The watch (ADR 0019): it starts a due run at least once a day, so an older one means it stopped. */
function watchCheck(): Check {
  const name = "the watch starts due runs (repeats and clean-ups)";
  try {
    return {
      name,
      ...watchState(),
      blocking: false,
      fix: "the status task shows the watch; docs/watch.md says what to check",
    };
  } catch (e) {
    return { name, ok: false, detail: `couldn't check: ${(e as Error).message}`, blocking: false };
  }
}

/**
 * Each tool's keys (ADR 0015), where this run has them: the tool's check calls its provider once
 * with each. Elsewhere the keys are GitHub secrets, out of sight.
 */
export function toolKeyChecks(env: NodeJS.ProcessEnv = process.env): Check[] {
  return Object.entries(loadTools()).flatMap(([name, t]) =>
    toolChecks(name, t, (secret) => env[secret]),
  );
}
