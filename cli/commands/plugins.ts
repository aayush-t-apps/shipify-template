// `ship plugins` and `ship selftest` (ADR 0027, ADR 0031, docs/plug-ins.md). Plugins: every kind
// of plug-in, its contract and test, and what's there now, so adding one starts from what exists.
// Selftest: each part's live check, end to end, cleaned up after (the core, the door, the chat, the
// sandbox, approved calls, the notebook), so one command proves the whole system after a merge.

import { agentLive, chat, notebookLive } from "../../edge/setup/chat.ts";
import { doorCheck } from "../../edge/setup/door.ts";
import { defaultAgent, loadExecutors, readExecutors } from "../lib/agents.ts";
import { listStacks } from "../lib/catalog.ts";
import { credential, loadCredentials } from "../lib/credentials.ts";
import { has, run } from "../lib/exec.ts";
import { ghRun, githubQueue, platformRepo } from "../lib/github.ts";
import { notebookSection } from "../lib/notebook.ts";
import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import { KINDS } from "../lib/plugins/index.ts";
import { sourceControl } from "../lib/providers.ts";
import { sandboxSlots } from "../lib/sandbox.ts";
import {
  command,
  isChannel,
  isSetUp,
  listServerTools,
  loadTools,
  readTools,
  sortProblems,
  type ToolEntry,
  toolChecks,
  verbsOf,
} from "../lib/tools.ts";
import { WATCH_WORKFLOW, watchState } from "../lib/watch.ts";
import { gatewayTakes } from "./add.ts";
import { boxOf, isBoxRunner, runners } from "./box.ts";
import { pluginFilesCheck, sandboxCheck } from "./doctor.ts";

/** What's there now, for each kind. */
function present(): Record<string, string[]> {
  const { tools } = readTools();
  const agents = loadExecutors();
  const fallback = defaultAgent(agents, "");
  return {
    record: ["github: the record, the queue and the first channel"],
    agent: Object.entries(agents)
      .filter(([, e]) => !e.manual)
      .map(
        ([id, e]) =>
          `${id}${id === fallback ? " (default)" : ""}: ${e.adapter ? `adapter ${e.adapter}` : "a plain program"}`,
      ),
    tool: Object.entries(tools)
      .filter(([, t]) => t.look.length || t.act.length)
      .map(([n, t]) => `${n}: ${verbsOf(t).join(", ")}`),
    channel: [
      "github: always (the record)",
      ...Object.entries(tools)
        .filter(([, t]) => isChannel(t))
        .map(([n, t]) => `${n}: ${verbsOf(t).join(", ")}`),
    ],
    door: ["the edge's /door/ routes (ADR 0031)"],
    stack: listStacks().map((s) => `${s.id} ${s.version}`),
    host: ["each stack's own deploy (stack.json, its make deploy)"],
    box: ["pnpm ship box list"],
    timer: ["the watch, in the edge (ADR 0031)"],
  };
}

export function pluginsList(): Result {
  const now = present();
  const lines = KINDS.flatMap((k) => [
    `  ${k.name}: ${k.contract}`,
    `    contract: ${k.where}`,
    `    now:      ${(now[k.id] ?? []).join(" · ") || "none"}`,
    `    add one:  ${k.add}`,
    `    its test: ${k.test}`,
  ]);
  const problems = [...readTools().problems, ...readExecutors().problems];
  return ok("plugins", `${KINDS.length} kinds of plug-in (docs/plug-ins.md)`, {
    data: [...lines, ...problems.map((p) => `  ✗ ${p}`)].join("\n"),
  });
}

// ---------------------------------------------------------------- selftest

/** A part's live checks: what it proves, end to end, and anything it made, cleaned up after. */
type Part = () => Promise<Check[]> | Check[];

/**
 * The core: the plug-in files are right, the queue answers, the watch is running, and an agent is
 * here. It makes nothing, so it has nothing to clean up.
 */
function core(): Check[] {
  const checks: Check[] = [pluginFilesCheck()];
  try {
    const runs = githubQueue().runs(WATCH_WORKFLOW, 1);
    checks.push({
      name: "the queue answers (GitHub Actions)",
      ok: true,
      detail: `${runs.length} recent watch run(s)`,
    });
  } catch (e) {
    checks.push({
      name: "the queue answers (GitHub Actions)",
      ok: false,
      detail: (e as Error).message.slice(0, 200),
      fix: "pnpm ship doctor: the GitHub login and its permissions",
    });
  }
  try {
    checks.push({ name: "the watch starts due runs", ...watchState(), fix: "docs/watch.md" });
  } catch (e) {
    checks.push({ name: "the watch starts due runs", ok: false, detail: (e as Error).message });
  }
  const agents = loadExecutors();
  const id = defaultAgent(agents, "");
  const program = agents[id]?.task?.[0] ?? agents[id]?.command?.[0];
  checks.push({
    name: `the default agent (${id}) is here`,
    ok: Boolean(program && has(program)),
    detail: program,
    blocking: false,
    fix: "install it on this machine; boxes install their own in task.yml",
  });
  return checks;
}

/**
 * The door (ADR 0031): the edge answers /health with its version, the door App is installed on
 * shipify alone with exactly its permissions, and its Telegram route wants Telegram's secret.
 */
async function door(): Promise<Check[]> {
  const r = await doorCheck();
  return r.checks ?? [];
}

/**
 * The agent's sandbox (ADR 0031, box setup 5): each slot's agent user exists, sudo starts it, and it
 * can't read the runner's folders, its environment or another slot's runs. On a box, doctor's check
 * right here. From this PC, live: each box's clean-up is run now (watch.yml), which runs doctor on
 * the box, and its sandbox line is read from the run's log.
 */
async function sandbox(): Promise<Check[]> {
  if (sandboxSlots().length) {
    const c = sandboxCheck();
    return c ? [c] : [];
  }
  const repo = platformRepo();
  const boxes = [...new Set(runners(repo).filter(isBoxRunner).map(boxOf))].sort();
  if (!boxes.length)
    return [
      {
        name: "each box's agent is walled off",
        ok: false,
        detail: "no box yet",
        fix: "pnpm ship box add <user@host> --manage",
      },
    ];
  const q = githubQueue();
  const checks: Check[] = [];
  for (const box of boxes) {
    const name = `${box}: each slot's agent is walled off`;
    const since = Date.now() - 5_000;
    const d = q.dispatch("watch.yml", { run: "cleanup", box });
    if (!d.ok) {
      checks.push({
        name,
        ok: false,
        detail: `its clean-up couldn't start: ${d.error.slice(0, 200)}`,
      });
      continue;
    }
    // Its run: the newest clean-up of this box since now, done within 8 minutes.
    let run: (ReturnType<typeof q.runs>[number] & { id?: number; html_url?: string }) | undefined;
    for (let i = 0; i < 48; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      run = q
        .runs("watch.yml", 10)
        .find((r) => r.display_title === `cleanup ${box}` && Date.parse(r.created_at) >= since);
      if (run?.status === "completed") break;
    }
    if (run?.status !== "completed" || !run.id) {
      checks.push({
        name,
        ok: false,
        detail: run
          ? `its clean-up hasn't finished: ${run.html_url}`
          : "its clean-up didn't start: is the box online? (pnpm ship box list)",
      });
      continue;
    }
    const log = ghRun(["run", "view", String(run.id), "-R", repo, "--log"]).stdout;
    const line = log.split("\n").find((l) => /[✓✗] sandbox/.test(l));
    checks.push({
      name,
      ok: Boolean(line?.includes("✓")),
      detail: line
        ? line
            .replace(/^.*?([✓✗] sandbox)/, "$1")
            .trim()
            .slice(0, 200)
        : `no sandbox line in its clean-up (${run.html_url})`,
      ...(line?.includes("✓")
        ? {}
        : { fix: `pnpm ship box add <${box}'s SSH address> --manage --yes (box setup 5)` }),
    });
  }
  return checks;
}

/**
 * Approved calls (ADR 0031): the box makes them itself, with no agent. For each tool with act
 * calls, its server starts here with no key and offers every call tools.json sorts as act.
 */
async function act(): Promise<Check[]> {
  const checks: Check[] = [];
  for (const [name, t] of Object.entries(loadTools())) {
    if (!t.act.length || !t.run) continue;
    try {
      const offered = await listServerTools(t.run, {}, 30_000);
      const wrong = sortProblems(name, t, offered);
      checks.push({
        name: `${name}: the box can make its act calls (${t.act.join(", ")})`,
        ok: !wrong.length,
        detail: wrong.join("; ") || `${offered.length} calls offered`,
        ...(wrong.length ? { fix: "pnpm ship tools check" } : {}),
      });
    } catch (e) {
      checks.push({
        name: `${name}: the box can make its act calls`,
        ok: false,
        detail: (e as Error).message,
        fix: "pnpm ship tools check",
      });
    }
  }
  return checks;
}

/** The notebook (ADR 0027, ADR 0032): a run's prompt carries it; then, live, a note through the
 * door is kept, shown and forgotten. */
async function notebook(): Promise<Check[]> {
  return [...notebookPrompt(), ...(await notebookLive())];
}

function notebookPrompt(): Check[] {
  const section = notebookSection(
    [{ number: 1, topic: "Preferences", body: "- Sonnet for questions" }],
    {
      canWrite: true,
    },
  );
  return [
    {
      name: "a run's prompt carries the notebook",
      ok: section.includes("- **Preferences**: Sonnet for questions"),
    },
  ];
}

/** Every part, in the order a build adds them. `all` runs each that's set up here. */
export const PARTS: Record<string, Part> = {
  core,
  door,
  chat: () => chat(),
  sandbox,
  act,
  notebook,
};

/**
 * A plug-in's check (ADR 0030 §6), with its keys from the credentials file: each must pass. One with
 * no keys at all (the web chat's) runs its check once as it is.
 */
function pluginChecks(name: string, t: ToolEntry): Check[] {
  const values = loadCredentials().values;
  if (t.check && !Object.keys(t.keys).length && !Object.keys(t.setup?.keys ?? {}).length) {
    const { command: cmd, args } = command(t.check);
    const r = run(cmd, args);
    const detail = (r.stdout || r.stderr).trim().split("\n").at(-1) ?? "";
    const fix = /pnpm ship .*$/.exec(detail)?.[0] ?? `pnpm ship add ${name} --yes`;
    return [
      { name: `${name}'s check passes`, ok: r.code === 0, detail, ...(r.code ? { fix } : {}) },
    ];
  }
  return toolChecks(name, t, (secret) => credential(values, secret)).map((c) => ({
    ...c,
    blocking: true,
  }));
}

export async function selftest(part = "all"): Promise<Result> {
  // `all` runs the parts set up here: the door's and the chat's once the door App is (door setup).
  const doorSetUp = () =>
    Boolean(sourceControl().repoState(platformRepo()).variables.SHIPIFY_DOOR_APP_ID);
  const setUp = (n: string) => (n !== "door" && n !== "chat") || doorSetUp();
  // A plug-in by name (ADR 0030 §6): its check, with the keys in the credentials file.
  const tools = loadTools();
  const t =
    part !== "all" && !Object.hasOwn(PARTS, part) && Object.hasOwn(tools, part)
      ? tools[part]
      : undefined;
  if (t) {
    const checks = pluginChecks(part, t);
    const failed = checks.filter((c) => !c.ok);
    return {
      command: "selftest",
      status: failed.length || !checks.length ? "failed" : "succeeded",
      summary: !checks.length
        ? `${part}: no key of it here to check (pnpm ship add ${part})`
        : failed.length
          ? `${part}: ${failed.length} of ${checks.length} checks failed`
          : `${part}: ${checks.length} checks passed`,
      checks,
    };
  }
  // A gateway by name (ADR 0038): its key, from the credentials file, taken by the gateway.
  const gateways = readExecutors().gateways;
  const g =
    !Object.hasOwn(PARTS, part) && Object.hasOwn(gateways, part) ? gateways[part] : undefined;
  if (g) {
    const key = credential(loadCredentials().values, g.key);
    const works = key ? await gatewayTakes(g, key, fetch) : undefined;
    return {
      command: "selftest",
      status: works?.ok ? "succeeded" : "failed",
      summary: !works
        ? `${part}: no key of it here to check (pnpm ship add ${part})`
        : `${part}: ${works.ok ? "its key works" : "it refused its key"}`,
      checks: works ? [{ ...works, fix: works.fix?.replace("<gateway>", part) }] : [],
    };
  }
  // An agent by name (ADR 0038): a question it answers, live, through the door.
  if (part !== "all" && !Object.hasOwn(PARTS, part) && loadExecutors()[part]?.adapter) {
    const checks = await agentLive(part);
    const failed = checks.filter((c) => !c.ok && c.blocking !== false);
    return {
      command: "selftest",
      status: failed.length ? "failed" : "succeeded",
      summary: failed.length
        ? `${part}: ${failed.length} of ${checks.length} checks failed`
        : `${part}: ${checks.length} checks passed`,
      checks,
    };
  }
  const names = part === "all" ? Object.keys(PARTS).filter(setUp) : [part];
  // Its own parts only: "constructor" or "toString" isn't a part, though every object has one.
  const unknown = names.filter((n) => !Object.hasOwn(PARTS, n));
  if (unknown.length)
    throw new ShipError(
      `No part "${unknown.join(", ")}". Parts: ${Object.keys(PARTS).join(", ")}, all.`,
      "blocked",
    );
  const checks: Check[] = [];
  for (const n of names) {
    // One part that breaks is a failed check, and the rest still run.
    const got = await Promise.resolve()
      .then(() => (PARTS[n] as Part)())
      .catch((e: Error) => [{ name: "its check ran", ok: false, detail: e.message.slice(0, 300) }]);
    checks.push(...got.map((c) => ({ ...c, name: `${n}: ${c.name}` })));
  }
  // And with `all`, every plug-in set up here: its own check.
  if (part === "all") {
    const values = loadCredentials().values;
    for (const [n, entry] of Object.entries(tools)) {
      if (!entry.check || !isSetUp(entry, (s) => credential(values, s))) continue;
      const got = pluginChecks(n, entry);
      if (!got.length) continue;
      names.push(n);
      checks.push(...got.map((c) => ({ ...c, name: `${n}: ${c.name}` })));
    }
  }
  const failed = checks.filter((c) => !c.ok && c.blocking !== false);
  return {
    command: "selftest",
    status: failed.length ? "failed" : "succeeded",
    summary: failed.length
      ? `${failed.length} of ${checks.length} checks failed: ${failed.map((c) => c.name).join("; ")}`
      : `${checks.length} checks passed (${names.join(", ")})`,
    checks,
  };
}
