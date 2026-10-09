// The workflows (ADR 0031): who may start a run, which keys each step holds, and that a box is a
// clean machine. Plus their inline scripts: a single quote inside `node -e '…'` ends the shell's
// string (shellcheck SC1011), so `pnpm verify` catches it before the PR.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { GIVE_UP_MS } from "../cli/kernel/decide.ts";
import { REPOS_PERMISSIONS } from "../cli/commands/bot.ts";
import { agentOf, agentRepos } from "../cli/kernel/run.ts";
import { workflowsMismatch } from "../cli/kernel/workflows.ts";
import { THINK_MINUTES } from "../cli/kernel/think.ts";
import type { Plan, Snapshot } from "../cli/kernel/types.ts";
import { loginOf, readExecutors } from "../cli/lib/agents.ts";
import { newState, type TaskState } from "../cli/lib/task.ts";
import { ROOT } from "./helpers.ts";

const dir = join(ROOT, ".github", "workflows");
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
    expect(t.concurrency?.group).toContain("task-{0}");
    expect(t.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(t.concurrency?.queue).toBeUndefined();
  });

  it("has two jobs: a run on a sandbox box, and the github job on GitHub's machines", () => {
    expect(Object.keys(t.jobs).sort()).toEqual(["github", "run"]);
    expect(run["runs-on"]).toEqual(["self-hosted", "shipify-box", "sandbox"]);
    expect(github["runs-on"]).toBe("ubuntu-latest");
  });

  it("starts a run only for you or the door App, never for the status issue, a notebook page or a PR", () => {
    expect(run.if).toContain("github.event.sender.login == vars.SHIPIFY_OWNER");
    expect(run.if).toContain("format('{0}[bot]', vars.SHIPIFY_DOOR_SLUG)");
    expect(run.if).toContain("!contains(github.event.issue.labels.*.name, 'shipify-status')");
    expect(run.if).toContain("!contains(github.event.issue.labels.*.name, 'notebook')");
    // A setting (a `use …` alone from a chat) starts no run: the next one reads it.
    expect(run.if).toContain(`!contains(github.event.comment.body, '"setting":true')`);
    // The door's own close follows the `close` it wrote (that comment's run does the work, once);
    // its own reopen needs no run.
    expect(run.if).toContain(
      "!((github.event.action == 'closed' || github.event.action == 'reopened')",
    );
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

  it("the think step holds the agent's login and read-only keys: no write token, no write key, no record write", () => {
    const env = step("think").env ?? {};
    expect(Object.keys(env)).not.toContain("SHIPIFY_WRITE_TOKEN");
    expect(Object.keys(env).filter((k) => k.endsWith("_WRITE"))).toEqual([]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(env.SHIPIFY_ISSUES_TOKEN).toBe("${{ steps.agent_token.outputs.token }}");
    // The chosen agent's login alone (plan names the secret: an agent's login or its gateway's key).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
    expect(env.SHIPIFY_AGENT_LOGIN).toBe("${{ secrets[steps.plan.outputs.login] }}");
  });

  it("names no agent: it installs the one plan names, from executors.json (ADR 0038)", () => {
    const text = readFileSync(join(dir, "task.yml"), "utf8");
    expect(text).not.toMatch(/claude|CLAUDE/);
    const install = run.steps.find((s) => s.run?.includes("ship run agent")) as Step;
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

  it("gives the job the sum of its clocks, and keeps a run's copy of Shipify at least as long (ADR 0035)", () => {
    const job = run["timeout-minutes"] ?? 0;
    // think's steps, plan's follow of a deploy, and about 15 for setup, decide and apply.
    expect(job).toBeGreaterThanOrEqual(THINK_MINUTES + GIVE_UP_MS / 60_000 + 15);
    const copy = run.steps.find((s) => s.run?.includes("shipify-app"))?.run ?? "";
    expect(Number(/now - \$1 > (\d+)/.exec(copy)?.[1])).toBeGreaterThanOrEqual(job * 60);
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
    expect(writes.map((s) => s.name)).toEqual([expect.stringContaining("Apply")]);
    for (const [k, v] of Object.entries(writes[0]?.env ?? {}))
      if (k.endsWith("_WRITE")) expect(v).toContain("steps.decide.outputs.act ==");
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
    expect(step("task").run).toBe('pnpm ship run task "$ISSUE"');
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
    // One secret by name, the agent's login, which plan takes from executors.json alone.
    expect(text.match(/secrets\[[^\]]+\]/g)).toEqual(["secrets[steps.plan.outputs.login]"]);
    const h = readExecutors(join(ROOT, "executors.json"));
    const logins = new Set(Object.values(h.executors).map((e) => loginOf(e, h.gateways)?.secret));
    for (const [id, e] of Object.entries(h.executors))
      if (e.adapter)
        expect(agentOf(planFor(id)).login, id).toBe(loginOf(e, h.gateways)?.secret ?? "");
    expect([...logins].filter(Boolean).sort()).toEqual([
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
  it("runs nothing for a docs-only change, and has no job that only waits", () => {
    expect(pipeline).toContain('paths-ignore: ["docs/**", "**/*.md"]');
    expect(pipeline).not.toMatch(/^ {2}(merged|redeploy):/m);
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
