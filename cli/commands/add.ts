// `ship add <name>` and `ship remove <name>` (ADR 0030 §6): one way to set up every plug-in, from
// its entry's `setup`, and every gateway (ADR 0038): its key, checked, and SHIPIFY_GATEWAYS. It shows the plan (what you need, the keys, the steps), then with --yes does
// one step at a time, each checked; a failure stops with the fix, and running it again picks up
// where it stopped. Keys are pasted at a hidden prompt (or found in the credentials file), never
// printed, and go where their verb runs: a GitHub secret on shipify, or the edge's Worker (a chat
// channel's keys, put there from this PC: ADR 0031, edge/setup/). The credentials file keeps a
// copy, so a check works here. --new asks again for every key, to replace one its provider refused.
import { spawnSync } from "node:child_process";
import { deleteEdgeSecret, edgeSecretNames, putEdgeSecret } from "../../edge/setup/worker.ts";
import { type Gateway, readExecutors } from "../lib/agents.ts";
import {
  credential,
  forgetCredential,
  hidden,
  loadCredentials,
  setCredential,
} from "../lib/credentials.ts";
import { platformRepo } from "../lib/github.ts";
import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import type { Setup, ToolEntry } from "../lib/plugins/tool.ts";
import { sourceControl } from "../lib/providers.ts";
import { command, loadTools, toolChecks } from "../lib/tools.ts";

// ---------------------------------------------------------------- gateways (ADR 0038)

/** The variable that says which gateways have a key set here, and since when (the web chat shows it). */
const GATEWAYS_VAR = "SHIPIFY_GATEWAYS";

/** A gateway in executors.json, by its name: `ship add openrouter`. */
const gatewayOf = (name: string) => readExecutors().gateways[name];

/** SHIPIFY_GATEWAYS, with this gateway set (a date) or taken out (undefined). */
function recordGateway(name: string, since: string | undefined) {
  const repo = platformRepo();
  const sc = sourceControl();
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(sc.repoState(repo).variables[GATEWAYS_VAR] ?? "{}") as Record<string, string>;
  } catch {}
  if (since) all[name] = since;
  else delete all[name];
  sc.setVariable(repo, GATEWAYS_VAR, JSON.stringify(all));
}

/** Whether a gateway takes this key: its `check` address answers 200 (no check: taken as it is). */
async function gatewayTakes(g: Gateway, key: string, fetcher: typeof fetch): Promise<Check> {
  const name = "the gateway takes the key";
  if (!g.check) return { name, ok: true, detail: "it has no check" };
  const res = await fetcher(`${g.url}${g.check}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => ({ status: 0, statusText: e.message }) as Response);
  return res.status === 200
    ? { name, ok: true }
    : {
        name,
        ok: false,
        detail: `it answered ${res.status || res.statusText}`,
        fix: `make a new key (${g.how}), then pnpm ship add <gateway> --new --yes`,
      };
}

async function addGateway(
  name: string,
  g: Gateway,
  yes: boolean,
  opts: {
    interactive: boolean;
    renew?: boolean;
    ask?: (q: string) => Promise<string>;
    fetch?: typeof fetch;
  },
): Promise<Result> {
  const repo = platformRepo();
  const again = `pnpm ship add ${name}${opts.renew ? " --new" : ""} --yes`;
  const set = !opts.renew && sourceControl().repoState(repo).secrets.includes(g.key);
  if (!yes)
    return {
      command: "add",
      status: "requires-approval",
      summary: `would set up ${name}: ${g.description}`,
      plannedActions: [
        `you need: a key (${g.how})`,
        set ? `${g.key}: set on ${repo} already` : `${g.key}: you paste it, hidden; set on ${repo}`,
        "then: check it with the gateway",
        `then: ${GATEWAYS_VAR} says ${name} is set up (the web chat's Setup shows it)`,
      ],
      nextSteps: [again],
    };
  const put = await setKeys([{ secret: g.key, ask: `your ${name} key (${g.how})`, repo }], {
    interactive: opts.interactive,
    ...(opts.renew ? { renew: true } : {}),
    ...(opts.ask ? { ask: opts.ask } : {}),
    again,
  });
  if (put.stopped)
    return {
      command: "add",
      status: "blocked",
      summary: `${name}: its key is needed`,
      checks: put.checks,
    };
  const key = credential(loadCredentials().values, g.key) ?? "";
  const works = await gatewayTakes(g, key, opts.fetch ?? fetch);
  const checks = [...put.checks, { ...works, fix: works.fix?.replace("<gateway>", name) }];
  if (!works.ok)
    return {
      command: "add",
      status: "blocked",
      summary: `${name}: the gateway refused the key`,
      checks,
    };
  recordGateway(name, new Date().toISOString().slice(0, 10));
  checks.push({ name: `${GATEWAYS_VAR} says ${name} is set up`, ok: true });
  return ok("add", `${name} is set up`, {
    checks,
    nextSteps: [
      `try it: a task that says \`use <agent>\` for an agent through ${name} (executors.json)`,
    ],
  });
}

function removeGateway(name: string, g: Gateway, yes: boolean): Result {
  const repo = platformRepo();
  if (!yes)
    return {
      command: "remove",
      status: "requires-approval",
      summary: `would remove ${name}`,
      plannedActions: [
        `delete secret ${g.key} from ${repo}, and its line in your credentials file`,
        `${GATEWAYS_VAR} no longer lists ${name}`,
      ],
      nextSteps: [`pnpm ship remove ${name} --yes`],
    };
  sourceControl().deleteSecret(repo, g.key);
  forgetCredential(g.key);
  recordGateway(name, undefined);
  return ok("remove", `${name} is removed`, {
    checks: [{ name: `${g.key} deleted from ${repo}`, ok: true }],
  });
}

function entryOf(name: string): ToolEntry & { setup: Setup } {
  const tools = loadTools();
  const t = tools[name];
  const can = Object.entries(tools)
    .filter(([, e]) => e.setup)
    .map(([n]) => n);
  if (!t)
    throw new ShipError(
      `No plug-in "${name}" in tools.json, nor a gateway in executors.json. With a setup: ${[...can, ...Object.keys(readExecutors().gateways)].join(", ") || "none"}.`,
      "blocked",
    );
  if (!t.setup)
    throw new ShipError(`${name} has no setup in tools.json (docs/plug-ins.md).`, "blocked");
  return t as ToolEntry & { setup: Setup };
}

/** Where the edge's keys are said to go, in a plan and a check. */
export const EDGE = "the edge's Worker";

/** Where a key goes: the shipify repo, or the edge's Worker. */
const repoFor = (to: "shipify" | "edge") => (to === "edge" ? EDGE : platformRepo());

/** A key to put in place: its secret's name, what you paste, and where it's set (a repo, or EDGE). */
export interface KeyToSet {
  secret: string;
  ask: string;
  repo: string;
}

/** The secrets a place holds (names only): a repo's, or the edge's. */
function secretsIn(repo: string): string[] {
  if (repo !== EDGE) return sourceControl().repoState(repo).secrets;
  const held = edgeSecretNames();
  return held.ok ? held.names : [];
}

/** How keys are taken: at a hidden prompt (or a test's), and whether to ask again for each. */
export interface KeyOpts {
  interactive: boolean;
  /** Ask again for every key, even one already set (--new), and replace it. */
  renew?: boolean;
  ask?: (question: string) => Promise<string>;
  /** The command that does it again, for a fix: `pnpm ship add notion --new --yes`. */
  again: string;
}

/**
 * Keys put where they go, one at a time, shared by `ship add` and `ship setup`. A key already in
 * the credentials file and on its repo is left as it is (unless renewed); else it's the file's, or
 * pasted at the hidden prompt (trimmed; one with a space inside isn't a key). Each is kept in the
 * credentials file and set as its repo's secret, never printed. It stops at the first it can't
 * set, saying how; `set` names those set now.
 */
export async function setKeys(
  keys: KeyToSet[],
  opts: KeyOpts,
): Promise<{ checks: Check[]; set: string[]; stopped?: string }> {
  const sc = sourceControl();
  const onRepo = new Map<string, string[]>();
  const secretsOf = (repo: string) => {
    if (!onRepo.has(repo)) onRepo.set(repo, secretsIn(repo));
    return onRepo.get(repo) ?? [];
  };
  const ask = opts.ask ?? hidden;
  const checks: Check[] = [];
  const set: string[] = [];
  for (const k of keys) {
    const known = credential(loadCredentials().values, k.secret);
    if (!opts.renew && known && secretsOf(k.repo).includes(k.secret)) {
      checks.push({ name: `${k.secret} is set`, ok: true });
      continue;
    }
    const pasted =
      opts.renew || !known ? (opts.interactive ? await ask(`Paste ${k.ask} (hidden): `) : "") : "";
    const value = (opts.renew ? pasted : (known ?? pasted)).trim();
    if (!value || /\s/.test(value)) {
      checks.push({
        name: `${k.secret} is set`,
        ok: false,
        detail: value ? "that has a space in it, so it isn't one" : undefined,
        fix:
          opts.renew || value
            ? `run ${opts.again} in a terminal, and paste ${k.ask}`
            : `run ${opts.again} in a terminal and paste ${k.ask}, or put ${k.secret}=… in your credentials file`,
      });
      return { checks, set, stopped: k.secret };
    }
    setCredential(k.secret, value);
    if (k.repo === EDGE) {
      const put = putEdgeSecret(k.secret, value);
      if (!put.ok) {
        checks.push({
          name: `${k.secret} is set on ${k.repo}`,
          ok: false,
          detail: put.why,
          fix: opts.again,
        });
        return { checks, set, stopped: k.secret };
      }
    } else sc.setSecret(k.repo, k.secret, value);
    set.push(k.secret);
    checks.push({ name: `${k.secret} is set on ${k.repo}`, ok: true });
  }
  return { checks, set };
}

/**
 * A setup step's command, with this plug-in's keys from the credentials file, by their names, and
 * the names of those set in this run (SHIPIFY_KEYS_SET), so a step knows what changed.
 */
function runStep(
  argv: string[],
  setup: Setup,
  set: string[] = [],
  renew = false,
): { ok: boolean; said: string } {
  const values = loadCredentials().values;
  const env = Object.fromEntries(
    Object.keys(setup.keys).flatMap((k) =>
      credential(values, k) ? [[k, credential(values, k) as string]] : [],
    ),
  );
  const { command: cmd, args } = command(argv);
  // Its words reach you as it goes (a link to open, a question), and its last line is its answer.
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      SHIPIFY_KEYS_SET: set.join(","),
      ...(renew ? { SHIPIFY_RENEW: "1" } : {}),
    },
    stdio: ["inherit", "pipe", "inherit"],
    timeout: 10 * 60_000,
  });
  const said = `${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return { ok: r.status === 0, said };
}

export async function add(
  name: string,
  yes: boolean,
  opts: {
    interactive?: boolean;
    /** --new: ask again for every key, and replace it. */
    renew?: boolean;
    ask?: (question: string) => Promise<string>;
    /** How a gateway's key is checked (a test's stand-in). */
    fetch?: typeof fetch;
  } = {},
): Promise<Result> {
  const g = gatewayOf(name);
  if (g)
    return addGateway(name, g, yes, {
      interactive: opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
      ...(opts.renew ? { renew: true } : {}),
      ...(opts.ask ? { ask: opts.ask } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  const t = entryOf(name);
  const { setup } = t;
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const keys = Object.entries(setup.keys).map(([secret, k]) => ({
    secret,
    ask: k.ask,
    repo: repoFor(k.to),
  }));
  const onRepo = new Map([...new Set(keys.map((k) => k.repo))].map((r) => [r, secretsIn(r)]));
  const planned = [
    ...setup.needs.map((n) => `you need: ${n}`),
    ...keys.map((k) =>
      !opts.renew && onRepo.get(k.repo)?.includes(k.secret)
        ? `${k.secret}: set on ${k.repo} already`
        : `${k.secret}: you paste it (${k.ask}), hidden; set on ${k.repo}`,
    ),
    ...setup.steps.map((s) => `then: ${s.say}`),
    ...(t.check ? ["then: check it works"] : []),
  ];
  const again = `pnpm ship add ${name}${opts.renew ? " --new" : ""} --yes`;
  if (!yes)
    return {
      command: "add",
      status: "requires-approval",
      summary: `would set up ${name}: ${t.description}`,
      plannedActions: planned,
      nextSteps: [again],
    };
  const put = await setKeys(keys, { interactive, renew: opts.renew, ask: opts.ask, again });
  const checks = put.checks;
  if (put.stopped)
    return {
      command: "add",
      status: "blocked",
      summary: `${name}: ${put.stopped} is needed`,
      checks,
    };
  for (const s of setup.steps) {
    const r = runStep(s.run, setup, put.set, opts.renew);
    checks.push({ name: s.say, ok: r.ok, detail: r.said });
    if (!r.ok)
      return {
        command: "add",
        status: "blocked",
        summary: `${name}: "${s.say}" didn't work`,
        checks,
        nextSteps: [`fix what it says, then again: pnpm ship add ${name} --yes`],
      };
  }
  const values = loadCredentials().values;
  const works = toolChecks(name, t, (secret) => credential(values, secret));
  checks.push(...works);
  const broken = works.filter((c) => !c.ok);
  return broken.length
    ? {
        command: "add",
        status: "blocked",
        summary: `${name} is set up, but its check failed`,
        checks,
      }
    : ok("add", `${name} is set up`, {
        checks,
        nextSteps: [`check it any time: pnpm ship selftest ${name}`],
      });
}

export async function remove(name: string, yes: boolean): Promise<Result> {
  const g = gatewayOf(name);
  if (g) return removeGateway(name, g, yes);
  const t = entryOf(name);
  const { setup } = t;
  const sc = sourceControl();
  const keys = Object.entries(setup.keys).map(([secret, k]) => ({ secret, repo: repoFor(k.to) }));
  const planned = [
    ...(setup.remove ? ["undo its own setup"] : []),
    ...keys.map(
      (k) => `delete secret ${k.secret} from ${k.repo}, and its line in your credentials file`,
    ),
  ];
  if (!yes)
    return {
      command: "remove",
      status: "requires-approval",
      summary: `would remove ${name}`,
      plannedActions: planned,
      nextSteps: [`pnpm ship remove ${name} --yes`],
    };
  const checks: Check[] = [];
  if (setup.remove) {
    const r = runStep(setup.remove, setup);
    checks.push({ name: "its own setup undone", ok: r.ok, detail: r.said });
    // Its keys stay until its own undo works: it needs them to try again.
    if (!r.ok)
      return {
        command: "remove",
        status: "blocked",
        summary: `${name}: its own setup couldn't be undone, so its keys are kept`,
        checks,
        nextSteps: [`fix what it says, then again: pnpm ship remove ${name} --yes`],
      };
  }
  for (const k of keys) {
    if (k.repo === EDGE) deleteEdgeSecret(k.secret);
    else sc.deleteSecret(k.repo, k.secret);
    forgetCredential(k.secret);
    checks.push({ name: `${k.secret} deleted from ${k.repo}`, ok: true });
  }
  return ok("remove", `${name} is removed`, { checks });
}
