// The workflows (ADR 0031): who may start a run, which keys each step holds, and that a box is a
// clean machine. Plus their inline scripts: a single quote inside `node -e '…'` ends the shell's
// string (shellcheck SC1011), so `pnpm verify` catches it before the PR.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPOS_PERMISSIONS } from "../cli/commands/bot.ts";
import { NEEDS_YOU_LABEL } from "../cli/contracts/labels.ts";
import { GIVE_UP_MS } from "../cli/kernel/decide.ts";
import { agentOf, agentRepos } from "../cli/kernel/run.ts";
import { JOB_MINUTES } from "../cli/kernel/stay.ts";
import { THINK_MINUTES } from "../cli/kernel/think.ts";
import { STALE_RUN_MS } from "../cli/lib/sandbox.ts";
import type { Plan, Snapshot } from "../cli/kernel/types.ts";
import { workflowsMismatch } from "../cli/kernel/workflows.ts";
import { loginOf, readExecutors } from "../cli/lib/agents.ts";
import { WAITING_LABEL } from "../cli/lib/repeat.ts";
import { newState, TASK_LABELS, type TaskState } from "../cli/lib/task.ts";
import { ROOT } from "./helpers.ts";

const dir = join(ROOT, ".github", "workflows");
/** How a box's steps start the CLI (ADR 0051): the built file in the copy made first. */
const BUILT = 'node "$SHIPIFY_COPY/cli/dist/ship.mjs"';
type Step = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  "continue-on-error"?: string | boolean;
};
type Job = {
  if?: string;
  "runs-on": unknown;
  "timeout-minutes"?: number;
  steps: Step[];
  env?: Record<string, unknown>;
};
const wf = (f: string) =>
  parse(readFileSync(join(dir, f), "utf8")) as {
    jobs: Record<string, Job>;
    on: unknown;
    permissions: Record<string, string>;
    concurrency?: Record<string, unknown>;
  };

/** A think plan whose task names this agent. */
const planFor = (agent: string): Plan => ({
  do: "think",
  why: "x",
  think: { profile: "talk", why: "new", notes: [], fresh: [], web: true },
  state: { ...(newState() as TaskState), use: { agent, label: agent } },
});

describe("the workflows' inline node scripts", () => {
  it("hold no single quote, which would end the shell's string", () => {
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/node -e '\n([\s\S]*?)\n\s*'/g)) {
        const at = text.slice(0, m.index).split("\n").length;
        (m[1] ?? "").split("\n").forEach((line, i) => {
          if (line.includes("'")) bad.push(`${f}:${at + 1 + i}: ${line.trim()}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("task.yml (ADR 0031)", () => {
  const t = wf("task.yml");
  const run = t.jobs.run as Job;
  const github = t.jobs.github as Job;
  const step = (id: string) => run.steps.find((s) => s.id === id) as Step;
  const at = (id: string) => run.steps.findIndex((s) => s.id === id);

  it("runs one per task at a time, with one waiting (ADR 0040): no queue of runs with nothing new", () => {
    expect(t.concurrency?.group).toContain("task-{0}{1}");
    // Your comment while a run stays skips in a group of its own: it never takes a waiting run's
    // place (ADR 0057).
    expect(t.concurrency?.group).toContain(
      "github.event_name == 'issue_comment' && contains(github.event.issue.labels.*.name, 'staying') && '-staying' || ''",
    );
    expect(t.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(t.concurrency?.queue).toBeUndefined();
  });

  it("has two jobs: a run on a sandbox box, and the github job on GitHub's machines", () => {
    expect(Object.keys(t.jobs).sort()).toEqual(["github", "run"]);
    expect(run["runs-on"]).toEqual(["self-hosted", "shipify-box", "sandbox"]);
    expect(github["runs-on"]).toBe("ubuntu-latest");
  });

  it("downloads no checkout or setup-node on a box: the box's Node, Shipify fetched only when needed (ADR 0057)", () => {
    // The runner downloads every action a job names on every job, so the run job names neither.
    for (const s of run.steps) {
      expect(String(s.uses ?? "")).not.toMatch(/^actions\/(checkout|setup-node)@/);
    }
    const fetch = run.steps[0] as Step;
    expect(fetch.name).toBe("Shipify at this commit, only if this box has no copy of it");
    // Its key only in this step, and only in git's environment: never on a command line or a file.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template
    expect(fetch.env?.FETCH_TOKEN).toBe("${{ github.token }}");
    expect(fetch.run).toContain("GIT_CONFIG_VALUE_0=");
    for (const line of (fetch.run ?? "").split("\n").filter((l) => /\bgit\b/.test(l)))
      expect(line).not.toContain("FETCH_TOKEN");
    expect(
      run.steps.slice(1).every((s) => !JSON.stringify(s.env ?? {}).includes("FETCH_TOKEN")),
    ).toBe(true);
  });

  it("fetches Shipify only when the box has no copy, a push's two ends too, and empties the workspace (ADR 0057)", () => {
    const script = (run.steps[0] as Step).run ?? "";
    const tmp = mkdtempSync(join(tmpdir(), "fetch-"));
    const origin = join(tmp, "origin");
    const bin = join(tmp, "bin");
    mkdirSync(origin);
    mkdirSync(bin);
    const git = (...a: string[]) => execFileSync("git", ["-C", origin, ...a], { encoding: "utf8" });
    const commit = (file: string) => {
      writeFileSync(join(origin, file), file);
      git("add", ".");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", file);
      return git("rev-parse", "HEAD").trim();
    };
    git("init", "-q");
    git("config", "uploadpack.allowReachableSHA1InWant", "true");
    const before = commit("a.txt");
    const after = commit("plans.md");
    const go = (ws: string, env: Record<string, string>, node = "v22.1.0") => {
      mkdirSync(ws, { recursive: true });
      writeFileSync(join(bin, "node"), `#!/bin/sh\necho ${node}\n`, { mode: 0o755 });
      return spawnSync(
        "bash",
        ["-c", script.replace("https://github.com/$GITHUB_REPOSITORY", origin)],
        {
          cwd: ws,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            RUNNER_TOOL_CACHE: join(tmp, "tools"),
            GITHUB_SHA: after,
            GITHUB_REPOSITORY: "o/r",
            FETCH_TOKEN: "t0ken",
            PUSH: "",
            BEFORE: "",
            ...env,
          },
        },
      );
    };
    // No copy yet: this commit, checked out, and an earlier job's file gone.
    const ws = join(tmp, "ws");
    mkdirSync(ws);
    writeFileSync(join(ws, "stale.txt"), "old");
    expect(go(ws, {}).status).toBe(0);
    expect(readdirSync(ws).sort()).toEqual([".git", "a.txt", "plans.md"]);
    expect(readFileSync(join(ws, ".git", "config"), "utf8")).not.toContain("t0ken");
    // A copy built: nothing fetched, the workspace left empty.
    mkdirSync(join(tmp, "tools", "shipify-app", after), { recursive: true });
    writeFileSync(join(tmp, "tools", "shipify-app", after, ".built"), "");
    expect(go(ws, {}).status).toBe(0);
    expect(readdirSync(ws)).toEqual([]);
    // A push: both ends, so its plans step can compare them, copy or not.
    const pushed = join(tmp, "push");
    expect(go(pushed, { PUSH: "yes", BEFORE: before }).status).toBe(0);
    const diff = execFileSync("git", ["-C", pushed, "diff", "--name-only", before, after], {
      encoding: "utf8",
    });
    expect(diff.trim()).toBe("plans.md");
    // A box whose Node isn't 22 says so, with its fix.
    const old = go(join(tmp, "old"), {}, "v20.1.0");
    expect(old.status).not.toBe(0);
    expect(old.stdout).toContain("run its box setup again");
  });

  it("starts a run only for you or the door App, never for the status issue, a notebook page or a PR", () => {
    expect(run.if).toContain("github.event.sender.login == vars.SHIPIFY_OWNER");
    expect(run.if).toContain("format('{0}[bot]', vars.SHIPIFY_DOOR_SLUG)");
    expect(run.if).toContain("!contains(github.event.issue.labels.*.name, 'shipify-status')");
    expect(run.if).toContain("!contains(github.event.issue.labels.*.name, 'notebook')");
    // A setting (a `use …` alone from a chat) starts no run: the next one reads it.
    expect(run.if).toContain(`!contains(github.event.comment.body, '"setting":true')`);
    // A reopen, or a close with nothing waiting on the task, is a change of state (ADR 0053): only
    // a close that still says `needs you` or `working` starts a run. The labels are the core's own.
    expect(run.if).toContain("github.event.action != 'reopened'");
    // An errand's `waiting` too: closed by hand or from a chat, its close run drops it (ADR 0054).
    for (const label of [NEEDS_YOU_LABEL, TASK_LABELS.working.name, WAITING_LABEL.name])
      expect(run.if).toContain(`contains(github.event.issue.labels.*.name, '${label}')`);
    expect(run.if).toContain("!github.event.issue.pull_request");
  });

  it("takes no label as a start: the watch never starts a run (ADR 0042)", () => {
    const on = t.on as { issues?: { types?: string[] } };
    expect(on.issues?.types).not.toContain("labeled");
    expect(run.if).not.toContain("labeled");
  });

  it("runs a dispatch only from main, in both jobs: a branch's code never gets their keys", () => {
    expect(run.if).toContain("github.ref == 'refs/heads/main'");
    expect(github.if).toContain("github.ref == 'refs/heads/main'");
    expect(github.if).toContain("inputs.job == 'github'");
  });

  it("the think step holds the agent's login and read-only keys, and the record's token for the runner alone: no write token or key", () => {
    const env = step("think").env ?? {};
    expect(Object.keys(env)).not.toContain("SHIPIFY_WRITE_TOKEN");
    expect(Object.keys(env).filter((k) => k.endsWith("_WRITE"))).toEqual([]);
    // The runner reads your `stop` and words with the record's token, which lasts the job, as a
    // stay's does (ADR 0059); the sandbox keeps it from the agent (sandbox.test.ts).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(env.SHIPIFY_ISSUES_TOKEN).toBe("${{ github.token }}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(env.GH_TOKEN).toBe("${{ steps.agent_token.outputs.token }}");
    // The chosen agent's login alone (plan names the secret: an agent's login or its gateway's key).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(env.SHIPIFY_AGENT_LOGIN).toBe("${{ secrets[steps.plan.outputs.login] }}");
  });

  it("names no agent: it installs the one plan names, from executors.json (ADR 0038)", () => {
    const text = readFileSync(join(dir, "task.yml"), "utf8");
    expect(text).not.toMatch(/claude|CLAUDE/);
    const install = run.steps.find((s) => s.run?.includes('ship.mjs" run agent')) as Step;
    expect(install.if).toBe("steps.plan.outputs.agent != ''");
    expect(at("plan")).toBeLessThan(run.steps.indexOf(install));
    expect(run.steps.indexOf(install)).toBeLessThan(at("think"));
  });

  it("hands every step the default agent (SHIPIFY_AGENT), so plan's `use` lines and think agree", () => {
    const top = (t as unknown as { env: Record<string, string> }).env;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(top.SHIPIFY_EXECUTOR).toBe("${{ vars.SHIPIFY_AGENT }}");
    for (const s of run.steps) expect(Object.keys(s.env ?? {})).not.toContain("SHIPIFY_EXECUTOR");
  });

  it("mints write tokens only after the agent, for exactly the repo decide named", () => {
    expect(at("write")).toBeGreaterThan(at("think"));
    expect(at("write")).toBeGreaterThan(at("decide"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(step("write").with?.repositories).toBe("${{ steps.decide.outputs.repo }}");
    expect(step("write").if).toContain("steps.decide.outputs.repo != ''");
    expect(step("read").with?.["permission-contents"]).toBe("read");
  });

  it("posts a question even when the write token for its kept commits can't be minted (ADR 0041)", () => {
    expect(step("write")["continue-on-error"]).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
      "${{ steps.decide.outputs.keep == 'quiet' }}",
    );
    // Only then: a PR's token, or any other push's, still stops the run when it can't be minted.
    expect(String(step("write")["continue-on-error"])).not.toContain("||");
  });

  it("mints each phase's read token right before it: plan's, the agent's for plan's repos, decide and apply's (ADR 0035)", () => {
    const apply = run.steps.find((s) => s.name?.startsWith("Apply")) as Step;
    expect(at("read")).toBeLessThan(at("plan"));
    expect(at("agent_token")).toBeGreaterThan(at("plan"));
    expect(at("agent_token")).toBeLessThan(at("think"));
    expect(at("apply_token")).toBeGreaterThan(at("think"));
    expect(at("apply_token")).toBeLessThan(at("decide"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(step("agent_token").with?.repositories).toBe("${{ steps.plan.outputs.repos }}");
    expect(step("read").with?.repositories).toBeUndefined();
    expect(step("apply_token").with?.repositories).toBeUndefined();
    const perms = (id: string) =>
      Object.entries(step(id).with ?? {}).filter(([k]) => k.startsWith("permission-"));
    // The agent's tokens read a PR's checks too, for "why did they fail?" (on request only).
    expect(perms("agent_token")).toEqual([...perms("read"), ["permission-checks", "read"]]);
    expect(perms("apply_token")).toEqual(perms("read"));
    // A step's token, as a GitHub Actions expression.
    const token = (id: string) => `\${{ steps.${id}.outputs.token }}`;
    expect(step("think").env?.SHIPIFY_AGENT_READ_TOKEN).toBe(token("agent_token"));
    for (const s of [step("decide"), apply])
      expect(s.env?.SHIPIFY_READ_TOKEN).toBe(token("apply_token"));
  });

  it("finishes a work run after think with the read key minted then, before decide: no agent, no write key (ADR 0059)", () => {
    expect(at("finish")).toBeGreaterThan(at("apply_token"));
    expect(at("finish")).toBeLessThan(at("decide"));
    expect(step("finish").if).toBe(
      "steps.think.outcome == 'success' && steps.plan.outputs.profile == 'work'",
    );
    const key = `\${{ steps.apply_token.outputs.token }}`;
    expect(step("finish").env).toEqual({ SHIPIFY_READ_TOKEN: key });
    expect(step("finish").run).toContain('run finish "$ISSUE"');
  });

  it("starts every step of a box's run from the CLI built once per commit, in a copy made first (ADR 0051)", () => {
    const copyAt = run.steps.findIndex((s) => s.run?.includes("scripts/build-cli.mjs"));
    const copy = run.steps[copyAt] as Step;
    // Made on every run, right after Shipify's fetch, before any step needs the CLI.
    expect(copyAt).toBeGreaterThan(-1);
    expect(copy.if).toBeUndefined();
    expect(run.steps.slice(0, copyAt).every((s) => !s.run?.includes(BUILT))).toBe(true);
    expect(copy.run).toContain('"$dir/.built"');
    expect(copy.run).toContain("SHIPIFY_COPY=$dir");
    // No `pnpm ship` on a box, and no step before the copy is named after the CLI.
    const starts = run.steps.filter((s) => s.run?.includes(BUILT));
    expect(starts.length).toBeGreaterThanOrEqual(7);
    for (const s of run.steps) expect(s.run ?? "").not.toContain("pnpm ship");
    // The workspace stays where the checkout's `../projects` put it, not in the shared tools.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template
    expect(run.env?.SHIPIFY_PROJECTS_DIR).toBe("${{ github.workspace }}/../projects");
    // GitHub's own machines keep the source, through pnpm: edits need no build there.
    expect(github.steps.some((s) => s.run?.includes("pnpm ship run github"))).toBe(true);
  });

  it("builds the CLI's copy once when runs start together on a new commit (#352-#356)", async () => {
    // The step's own script, run five times at once against a throwaway repo, with a slow pnpm and
    // a slow build standing in for the real ones.
    const script = run.steps.find((s) => s.run?.includes("scripts/build-cli.mjs"))?.run ?? "";
    const tmp = mkdtempSync(join(tmpdir(), "copy-race-"));
    const repo = join(tmp, "repo");
    const bin = join(tmp, "bin");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(bin);
    for (const tool of ["pnpm", "corepack"])
      writeFileSync(join(bin, tool), "#!/bin/sh\nsleep 0.2\n", { mode: 0o755 });
    writeFileSync(join(repo, "package.json"), '{"packageManager":"pnpm@1.0.0"}\n');
    writeFileSync(
      join(repo, "scripts", "build-cli.mjs"),
      [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'import { dirname } from "node:path";',
        "const out = process.argv[process.argv.indexOf('--out') + 1];",
        "await new Promise((r) => setTimeout(r, 200));",
        "mkdirSync(dirname(out), { recursive: true });",
        "writeFileSync(out, 'built');",
      ].join("\n"),
    );
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
    const sha = git("rev-parse", "HEAD").trim();
    const tools = join(tmp, "tools");
    const one = (id: number) =>
      new Promise<number>((done) =>
        spawn("bash", ["-e", "-c", script], {
          cwd: repo,
          stdio: "ignore",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            RUNNER_TOOL_CACHE: tools,
            RUNNER_TEMP: join(tmp, `temp-${id}`),
            GITHUB_SHA: sha,
            GITHUB_RUN_ID: String(id),
            GITHUB_ENV: join(tmp, `env-${id}`),
          },
        }).on("close", (code) => done(code ?? 1)),
      );
    expect(await Promise.all([1, 2, 3, 4, 5].map(one))).toEqual([0, 0, 0, 0, 0]);
    // One copy, built, with the commit's files, and nothing of another run's inside or beside it.
    const base = join(tools, "shipify-app");
    expect(readdirSync(base)).toEqual([sha]);
    expect(readdirSync(join(base, sha)).sort()).toEqual([
      ".built",
      ".git",
      "cli",
      "package.json",
      "scripts",
    ]);
    expect(readFileSync(join(base, sha, "cli", "dist", "ship.mjs"), "utf8")).toBe("built");
    for (const id of [1, 2, 3, 4, 5])
      expect(readFileSync(join(tmp, `env-${id}`), "utf8")).toBe(
        `SHIPIFY_COPY=${join(base, sha)}\n`,
      );
  });

  it("stays after an answer with no write key, its events skipped, its label off however it ends (ADR 0057)", () => {
    expect(run.if).toContain(
      "!(github.event_name == 'issue_comment' && contains(github.event.issue.labels.*.name, 'staying'))",
    );
    const stayStep = step("stay");
    expect(stayStep.if).toBe("steps.decide.outputs.stay == 'yes'");
    expect(stayStep.run).toContain(`${BUILT} run stay`);
    for (const [k, v] of Object.entries(stayStep.env ?? {})) {
      expect(k).not.toMatch(/_WRITE$/);
      expect(String(v)).not.toMatch(/steps\.(write|write_account|files)\./);
    }
    // After apply: the answer is out before it stays.
    const at = (s: Step) => run.steps.indexOf(s);
    const applied = run.steps.find((s) => s.name?.startsWith("Apply")) as Step;
    expect(at(stayStep)).toBeGreaterThan(at(applied));
    const off = run.steps.find((s) => s.name === "Its stay's label off, however the job ends");
    expect(off?.if).toBe("always() && steps.decide.outputs.stay == 'yes'");
    expect(off?.run).toContain("/labels/staying");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template
    expect(step("decide").env?.SHIPIFY_STAY).toBe("${{ vars.SHIPIFY_STAY }}");
  });

  it("applies a stay's answer that needs a token in the same job, with decide's mints (ADR 0062)", () => {
    const at = (s: Step) => run.steps.indexOf(s);
    const named = (prefix: string) => run.steps.filter((s) => s.name?.startsWith(prefix));
    const [apply, stayApply] = named("Apply") as [Step, Step];
    expect(stayApply.name).toBe("Apply the stay's answer (as apply does)");
    expect(stayApply.if).toBe(
      "steps.stay.outcome == 'success' && steps.stay.outputs.apply == 'yes'",
    );
    // The same steps as decide's, each reading the stay's outputs: nothing more is minted.
    const asStay = (v: unknown) =>
      JSON.stringify(v)
        .replaceAll("steps.decide.outputs.", "steps.stay.outputs.")
        .replace(
          /steps\.(apply_token|write|write_account|files)\.outputs/g,
          "steps.stay_$1.outputs",
        );
    const pairs = [
      ["apply_token", "stay_apply_token"],
      ["write", "stay_write"],
      ["write_account", "stay_write_account"],
      ["files", "stay_files"],
    ] as const;
    for (const [was, now] of pairs) {
      expect(JSON.stringify(step(now).with), now).toBe(asStay(step(was).with));
      expect(String(step(now)["continue-on-error"] ?? ""), now).toBe(
        JSON.parse(asStay(String(step(was)["continue-on-error"] ?? ""))),
      );
      expect(step(now).if, now).toContain("steps.stay.outputs.apply == 'yes'");
      // Only after the stay, its agent done: no write key while an agent runs.
      expect(at(step(now)), now).toBeGreaterThan(at(step("stay")));
      expect(at(step(now)), now).toBeLessThan(at(stayApply));
    }
    for (const [was, now] of pairs.slice(1))
      expect(step(now).if, now).toBe(
        `steps.stay.outputs.apply == 'yes' && ${JSON.parse(asStay(step(was).if))}`,
      );
    expect(JSON.stringify(stayApply.env)).toBe(asStay(apply.env));
    expect(stayApply.run).toBe(apply.run);
    // Then the label's step, however the job ends.
    const off = run.steps.find((s) => s.name === "Its stay's label off, however the job ends");
    expect(at(off as Step)).toBeGreaterThan(at(stayApply));
  });

  it("gives the job the sum of its clocks, and keeps a run's copy of Shipify at least as long (ADR 0035)", () => {
    const job = run["timeout-minutes"] ?? 0;
    // think's steps, plan's follow of a deploy, and about 15 for setup, decide and apply. A stay
    // takes what's left of the job, by the job's limit it knows (ADR 0057).
    expect(job).toBeGreaterThanOrEqual(THINK_MINUTES + GIVE_UP_MS / 60_000 + 15);
    expect(JOB_MINUTES).toBe(job);
    const copy = run.steps.find((s) => s.run?.includes("scripts/build-cli.mjs"))?.run ?? "";
    expect(Number(/now - \$1 > (\d+)/.exec(copy)?.[1])).toBeGreaterThanOrEqual(job * 60);
    // Nor is a run's folder swept as left over while its job can still be using it (ADR 0059).
    expect(STALE_RUN_MS).toBeGreaterThanOrEqual(job * 60_000);
  });

  it("reads only outputs its steps write, each a plain word or a list of them (#174)", () => {
    const yml = readFileSync(join(dir, "task.yml"), "utf8");
    const src = readFileSync(join(ROOT, "cli", "kernel", "run.ts"), "utf8");
    const written = new Set([...src.matchAll(/output\("([a-z_]+)"/g)].map((m) => m[1]));
    const read = [...yml.matchAll(/steps\.(?:task|plan|decide)\.outputs\.([a-z_]+)/g)].map(
      (m) => m[1],
    );
    expect(read.length).toBeGreaterThan(0);
    for (const name of new Set(read)) expect(written).toContain(name);
  });

  it("gives a tool's write key only to apply, only for calls decide found approved", () => {
    const writes = run.steps.filter((s) =>
      Object.keys(s.env ?? {}).some((k) => k.endsWith("_WRITE")),
    );
    // Apply, and the apply of a stay's answer (ADR 0062), each for the calls its own decide found.
    expect(writes.map((s) => s.name)).toEqual([
      expect.stringMatching(/^Apply \(/),
      "Apply the stay's answer (as apply does)",
    ]);
    for (const [s, by] of [
      [writes[0], "decide"],
      [writes[1], "stay"],
    ] as const)
      for (const [k, v] of Object.entries(s?.env ?? {}))
        if (k.endsWith("_WRITE")) expect(v).toContain(`steps.${by}.outputs.act ==`);
  });

  it("mints each token for another of your accounts from the repos App, for that account alone (ADR 0045)", () => {
    const expr = (x: string) => `\${{ ${x} }}`;
    const repos = {
      app: expr("vars.SHIPIFY_REPOS_CLIENT_ID"),
      key: expr("secrets.SHIPIFY_REPOS_KEY"),
    };
    // The task step reads the task before any token, and names its account for them.
    expect(at("task")).toBeLessThan(at("read"));
    expect(at("read_account")).toBeLessThan(at("plan"));
    expect(step("task").run).toBe(`${BUILT} run task "$ISSUE"`);
    // Each one: the repos App, the owner the step before named, and no more than the bot's own.
    // Each: its id, its owner, its repos, and what it waits for (no other account: no step).
    const minted = [
      ["read_account", "steps.task.outputs.account", undefined, "steps.task.outputs.account"],
      [
        "agent_account_token",
        "steps.plan.outputs.account",
        "steps.plan.outputs.account_repos",
        "steps.plan.outputs.account_repos",
      ],
      [
        "write_account",
        "steps.decide.outputs.account",
        "steps.decide.outputs.repo",
        "steps.decide.outputs.account",
      ],
    ] as const;
    for (const [id, owner, only, guard] of minted) {
      const w = step(id).with ?? {};
      expect(w["client-id"], id).toBe(repos.app);
      expect(w["private-key"], id).toBe(repos.key);
      expect(w.owner, id).toBe(expr(owner));
      expect(w.repositories, id).toBe(only ? expr(only) : undefined);
      // Never workflows: GitHub refuses the repos App's push of a workflow file too.
      expect(w["permission-workflows"], id).toBeUndefined();
      // With no other account, the step doesn't run: every flow is today's.
      expect(step(id).if, id).toContain(`${guard} != ''`);
    }
    // No mint asks the repos App for more than it has: a permission its installs lack fails the mint.
    const gh0 = (t.jobs.github as Job).steps.find((s) => s.id === "account") as Step;
    for (const s of [step("read_account"), step("agent_account_token"), step("write_account"), gh0])
      for (const [k, v] of Object.entries(s.with ?? {}).filter(([k]) =>
        k.startsWith("permission-"),
      )) {
        const name = k.slice("permission-".length).replace("-", "_");
        const has = REPOS_PERMISSIONS[name as keyof typeof REPOS_PERMISSIONS];
        expect(has, `${s.id}: ${k}`).toBeDefined();
        if (v === "write") expect(has, `${s.id}: ${k}`).toBe("write");
      }
    expect(gh0.if).toContain("steps.task.outputs.pr_repos != ''");
    expect(gh0.with?.repositories).toBe(expr("steps.task.outputs.pr_repos"));
    expect(gh0["continue-on-error"]).toBe(true);
    expect(
      Object.entries(step("read_account").with ?? {}).filter(([k]) => k.startsWith("permission-")),
    ).toEqual(Object.entries(step("read").with ?? {}).filter(([k]) => k.startsWith("permission-")));
    // A missing install is plan's to tell; the bot's write step never runs for another account.
    expect(step("read_account")["continue-on-error"]).toBe(true);
    expect(step("write").if).toContain("steps.decide.outputs.account == ''");
    expect(step("write_account").if).toContain("steps.decide.outputs.account != ''");
    const apply = run.steps.find((s) => s.name?.startsWith("Apply")) as Step;
    expect(apply.env?.SHIPIFY_WRITE_TOKEN).toBe(
      expr("steps.write.outputs.token || steps.write_account.outputs.token"),
    );
    expect(step("plan").env?.SHIPIFY_ACCOUNT_TOKEN).toBe(expr("steps.read_account.outputs.token"));
    expect(step("think").env?.SHIPIFY_ACCOUNT_READ_TOKEN).toBe(
      expr("steps.agent_account_token.outputs.token"),
    );
    // The github job reads the task first too, and closes another account's PRs with its token.
    const gh = t.jobs.github as Job;
    const g = (id: string) => gh.steps.findIndex((s) => s.id === id);
    expect(g("task")).toBeGreaterThan(-1);
    expect(g("account")).toBeGreaterThan(g("task"));
    expect(gh.steps[g("account")]?.with?.owner).toBe(expr("steps.task.outputs.account"));
    expect(gh.steps.find((s) => s.name === "Run what's pending")?.env?.SHIPIFY_ACCOUNT_TOKEN).toBe(
      expr("steps.account.outputs.token"),
    );
  });

  it("asks GitHub for its own token (OIDC), which runs prove themselves to the door with", () => {
    expect(t.permissions["id-token"]).toBe("write");
  });

  it("no job on a box gets a repo secret but the Apps' keys, the agent's login and the tools' keys", () => {
    const text = JSON.stringify(run);
    const secrets = text.match(/secrets\.[A-Z_]+/g) ?? [];
    expect([...new Set(secrets)].sort()).toEqual(
      [
        "secrets.SHIPIFY_BOT_KEY",
        "secrets.SHIPIFY_REPOS_KEY",
        "secrets.SHIPIFY_NOTION_READ",
        "secrets.SHIPIFY_NOTION_WRITE",
      ].sort(),
    );
    // The Apps' keys go to the pinned mint action alone, never to a step of Shipify's, in either
    // job; the one step that reads every secret (a new project's keys) skips them both by name.
    for (const job of [run, t.jobs.github as Job])
      for (const s of job.steps) {
        if (/secrets\.SHIPIFY_(BOT|REPOS)_KEY/.test(JSON.stringify(s)))
          expect(s.uses, s.name).toMatch(/^actions\/create-github-app-token@/);
        if (JSON.stringify(s.env ?? {}).includes("toJSON(secrets)"))
          for (const key of ["SHIPIFY_BOT_KEY", "SHIPIFY_REPOS_KEY"])
            expect(s.run, s.name).toContain(`"${key}"`);
      }
    // One secret by name, the agent's login, which plan takes from executors.json alone: to think,
    // and to a stay's turns, which think again in the same session (ADR 0057).
    expect(new Set(text.match(/secrets\[[^\]]+\]/g))).toEqual(
      new Set(["secrets[steps.plan.outputs.login]"]),
    );
    expect(
      run.steps.filter((s) => JSON.stringify(s.env ?? {}).includes("secrets[")).map((s) => s.id),
    ).toEqual(["think", "stay"]);
    const h = readExecutors(join(ROOT, "executors.json"));
    const logins = new Set(Object.values(h.executors).map((e) => loginOf(e, h.gateways)?.secret));
    for (const [id, e] of Object.entries(h.executors))
      if (e.adapter)
        expect(agentOf(planFor(id)).login, id).toBe(loginOf(e, h.gateways)?.secret ?? "");
    expect([...logins].filter(Boolean).sort()).toEqual([
      "AI_GATEWAY_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "OPENROUTER_API_KEY",
    ]);
    // A mistyped SHIPIFY_AGENT ("Claude Code"): plan still installs the default (think says why).
    const was = process.env.SHIPIFY_EXECUTOR;
    process.env.SHIPIFY_EXECUTOR = "Claude Code";
    try {
      expect(agentOf(planFor("claude code"))).toEqual({
        agent: "claude",
        login: "CLAUDE_CODE_OAUTH_TOKEN",
      });
    } finally {
      if (was === undefined) delete process.env.SHIPIFY_EXECUTOR;
      else process.env.SHIPIFY_EXECUTOR = was;
    }
  });
});

describe("ci.yml's release (ADR 0047, ADR 0055)", () => {
  const job = wf("ci.yml").jobs.release as Job;
  const run = job.steps.find((s) => s.name === "Tag and release")?.run ?? "";
  it("attaches box/here.sh, with its SHA-256 in the notes: latest/download/here.sh finds it", () => {
    expect(run).toMatch(/gh release create [^\n]*box\/here\.sh$/m);
    expect(run).toContain("sha256sum box/here.sh");
    expect(run).toContain("releases/latest/download/here.sh | bash");
  });
  it("builds the box's image only after a release, only where the repo is public (ADR 0056)", () => {
    const jobs = wf("ci.yml").jobs as Record<
      string,
      Job & { needs?: unknown; permissions?: unknown }
    >;
    expect(jobs.image?.if).toContain("needs.release.result == 'success'");
    expect(jobs.image?.if).toContain("!github.event.repository.private");
    // A skipped job before it (golden) skips it unless it says always(), as the release does.
    expect(jobs.image?.if).toMatch(/^always\(\) && /);
    expect(jobs["image-tags"]?.if).toBe("always() && needs.image.result == 'success'");
    expect(jobs.image?.permissions).toEqual({ contents: "read", packages: "write" });
    expect(jobs["image-tags"]?.needs).toBe("image");
    // No secret but the run's own token: the image holds no key.
    expect(JSON.stringify(jobs.image)).not.toContain("secrets.");
  });
  it("never runs on a pull request: a public template's runs are its owner's pushes alone", () => {
    const on = wf("ci.yml").on as Record<string, unknown>;
    expect(Object.keys(on).sort()).toEqual(["push", "workflow_dispatch"]);
  });
});

describe("watch.yml (ADR 0031)", () => {
  const w = wf("watch.yml");
  const job = w.jobs.watch as Job;
  it("rings by labels on the status task, from the door App or you; dispatches only from main", () => {
    expect(job.if).toContain("startsWith(github.event.label.name, 'watch:')");
    expect(job.if).toContain("contains(github.event.issue.labels.*.name, 'shipify-status')");
    expect(job.if).toContain("format('{0}[bot]', vars.SHIPIFY_DOOR_SLUG)");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
  });
  it("takes its own doorbell off, so the next ring fires", () => {
    expect(job.steps.some((s) => s.name?.startsWith("Its doorbell off"))).toBe(true);
  });
  it("runs a due run on your merge that touched recipes/, and only yours (ADR 0032)", () => {
    const on = w.on as { push?: { branches?: string[]; paths?: string[] } };
    expect(on.push).toEqual({ branches: ["main"], paths: ["recipes/**"] });
    expect(job.if?.replace(/\s+/g, " ")).toContain(
      "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.event.sender.login == vars.SHIPIFY_OWNER",
    );
    expect(String(job.env?.RUN)).toContain("github.event_name == 'push'");
  });
  it("its clean-up runs only on its box, never on GitHub's machines or your PC", () => {
    expect(String(job["runs-on"])).toContain(
      "inputs.run == 'cleanup' && fromJSON(format('[\"self-hosted\",\"box-{0}\"]', inputs.box))",
    );
  });
});

describe("the workflow rule: a run pushes no workflow or action of its own", () => {
  it("checks a project's actions as its workflows (ADR 0048), and refuses both in a repo that isn't one", () => {
    const repo = mkdtempSync(join(tmpdir(), "not-a-project-"));
    expect(workflowsMismatch(repo, [".github/actions/setup/action.yml"])).toContain(
      "isn't a Shipify project",
    );
    expect(workflowsMismatch(repo, [".github/workflows/ci.yml"])).toContain(
      "isn't a Shipify project",
    );
    expect(workflowsMismatch(repo, [".github/dependabot.yml", "src/index.ts"])).toBeUndefined();
  });
});

describe("each project's pipeline (ADR 0048: the stack's ship.yml)", () => {
  const pipeline = readFileSync(
    join(ROOT, "stacks/_base/files/.github/workflows/ship.yml"),
    "utf8",
  );
  it("is its own: it calls no other repo's workflow, and hands no secret out", () => {
    expect(pipeline).not.toMatch(/uses:\s*[\w.-]+\/[\w.-]+\/\.github\/workflows\//);
    expect(pipeline).not.toContain("secrets: inherit");
    expect(pipeline).not.toContain("workflow_call");
    // Nothing a machine's settings would render differently: the workflow rule's check is the same
    // on a box and on the PC.
    expect(pipeline).not.toMatch(/\{\{[A-Z_]+\}\}|#if /);
  });
  it("uses every anchor it defines (actionlint fails on one that isn't)", () => {
    // A YAML anchor: after "- " or ": ", never a shell redirect (2>&1).
    for (const [, name] of pipeline.matchAll(/(?:- |: )&([A-Za-z_][\w-]*)/g))
      expect(pipeline, `anchor ${name}`).toContain(`*${name}`);
  });
  it("runs every commit on main and production, docs too (each gets its mark); a PR of docs runs nothing", () => {
    const on = (parse(pipeline) as { on: Record<string, Record<string, unknown>> }).on;
    expect(on.pull_request?.["paths-ignore"]).toEqual(["docs/**", "**/*.md"]);
    expect(on.push).toEqual({ branches: ["main", "production"] });
    expect(pipeline).not.toMatch(/^ {2}(merged|redeploy):/m);
  });
  it("lets a bot push a staging app's release to main (ship release), and nothing more", () => {
    const steps = (parse(pipeline) as { jobs: Record<string, Job> }).jobs.main?.steps ?? [];
    const script = steps.find((st) => st.name?.startsWith("Only the owner's merges"))?.run ?? "";
    const repo = mkdtempSync(join(tmpdir(), "bot-push-"));
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], {
        encoding: "utf8",
      }).trim();
    const put = (f: string, text: string) => {
      mkdirSync(dirname(join(repo, f)), { recursive: true });
      writeFileSync(join(repo, f), text);
    };
    const json = (v: object) => `${JSON.stringify(v, null, 2)}\n`;
    git("init", "-q");
    put("shipify.json", json({ id: "a", version: "0.1.0", staging: true }));
    put("package.json", json({ name: "a", version: "0.1.0", private: true }));
    put("CHANGELOG.md", "# Changelog\n");
    put("docs/changes/0001-x.md", "released: null\n");
    put("src/a.ts", "1\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    const before = git("rev-parse", "HEAD");
    const push = (change: () => void) => {
      git("reset", "-q", "--hard", before);
      change();
      git("add", "-A");
      git("commit", "-qm", "push");
      const env = { ACTOR: "app[bot]", BEFORE: before, STAGING: "true", GITHUB_REF_NAME: "main" };
      const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, ...env, GITHUB_SHA: git("rev-parse", "HEAD") },
      });
      return `${r.status} ${r.stdout}${r.stderr}`;
    };
    // versionApp's files: both versions (package.json by make version), the changelog, the stamp.
    const release = () => {
      put("shipify.json", json({ id: "a", version: "0.2.0", staging: true }));
      put("package.json", json({ name: "a", version: "0.2.0", private: true }));
      put("CHANGELOG.md", "# Changelog\n\n## [0.2.0]\n");
      put("docs/changes/0001-x.md", "released: 0.2.0\n");
    };
    expect(push(release)).toMatch(/^0 /);
    expect(push(() => (release(), put("src/a.ts", "2\n")))).toMatch(/^1 /);
    expect(
      push(() => (release(), put("package.json", json({ name: "a", version: "0.2.0" })))),
    ).toMatch(/^1 /);
    // A file moved into the change docs leaves its old place: code gone, so it's refused.
    expect(push(() => (release(), git("mv", "src/a.ts", "docs/changes/0002-y.md")))).toMatch(/^1 /);
  });
  const s = /- name: Preview \(main's make preview-from[\s\S]*?\n {6}- /.exec(pipeline)?.[0] ?? "";
  it("gives an app with runtime keys no preview, and the rest only their deploy keys", () => {
    expect(s).toContain("(.secrets.runtime // []) | length");
    expect(s).toContain("exit 0");
    expect(s).toContain("($m[0].secrets.deploy // []) as $k");
    expect(s).not.toContain("secrets.runtime // [])) as $k");
  });
});

describe("plan's repos: what a work run's agent may read (ADR 0035, ADR 0044)", () => {
  const snap = {
    projects: ["links", "spotter"],
    repos: [
      { name: "links", repo: "o/links", sizeKB: 1, project: true, branch: "main" },
      { name: "spotter", repo: "o/spotter", sizeKB: 1, project: true, branch: "main" },
      { name: "My.Notes", repo: "o/My.Notes", sizeKB: 1, project: false, branch: "main" },
    ],
  } as unknown as Snapshot;
  const thinking = (profile: "work" | "talk" | "read", project?: string, reads?: unknown[]) =>
    ({
      do: "think",
      think: { profile, ...(project ? { project } : {}), ...(reads ? { reads } : {}) },
    }) as unknown as Plan;
  const saved = process.env.GITHUB_REPOSITORY;

  it("its project and Shipify for a work run; every repo (empty) for the rest", () => {
    process.env.GITHUB_REPOSITORY = "o/shipify";
    try {
      expect(agentRepos(snap, thinking("work", "links"))).toBe("links,shipify");
      expect(agentRepos(snap, thinking("work", "shipify"))).toBe("shipify");
      // A new project isn't on GitHub before its repo is made.
      expect(agentRepos(snap, thinking("work", "fresh"))).toBe("");
      expect(agentRepos(snap, thinking("talk"))).toBe("");
      expect(agentRepos(snap, { do: "nothing", why: "x" })).toBe("");
      // Another of your repos: its own name, dots and capitals kept.
      expect(agentRepos(snap, thinking("work", "My.Notes"))).toBe("My.Notes,shipify");
      // A read run: the key stays with the box, for the task and your repos it reads.
      const reads = [
        { name: "spotter", repo: "o/spotter", mine: true },
        { name: "acme/x", repo: "acme/x", mine: false },
      ];
      expect(agentRepos(snap, thinking("read", undefined, reads))).toBe("spotter,shipify");
      expect(agentRepos(snap, thinking("read", undefined, [reads[1]]))).toBe("shipify");
      // A change run that reads one of your repos clones it with the same key (ADR 0044).
      expect(agentRepos(snap, thinking("work", "links", [reads[0]]))).toBe("links,spotter,shipify");
    } finally {
      if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = saved;
    }
  });
});
