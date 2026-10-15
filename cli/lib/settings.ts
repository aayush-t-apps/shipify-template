// The one list of settings (ADR 0047): the core's (cli/contracts/settings.ts), the edge's
// (edge/setup/settings.ts), and each plug-in's, read from its own file: a stack's deploy values and
// keys (stack.json), a tool's keys (tools.json), an agent's login and a gateway's key
// (executors.json). `ship setup`'s checks, `ship doctor`, the guides' table (docs/settings.md) and
// the workflows' test read it, never a list of their own.
import { EDGE_SETTINGS } from "../../edge/setup/settings.ts";
import { CORE_SETTINGS, type Home, type Setting } from "../contracts/index.ts";
import { defaultAgent, loadExecutors, loginOf, readExecutors } from "./agents.ts";
import { listStacks } from "./catalog.ts";
import { loadTools } from "./tools.ts";

const HOMES: Home[] = ["variable", "secret", "worker", "pc"];

/** Each plug-in's settings, from its own file. */
function pluginSettings(): Setting[] {
  const out: Setting[] = [];
  // A stack's deploy keys and values, once each, with every stack that deploys with it.
  const deploys = new Map<string, { ids: string[]; key: boolean; optional: boolean }>();
  const add = (name: string, id: string, key: boolean, optional: boolean) => {
    const d = deploys.get(name) ?? { ids: [], key, optional };
    deploys.set(name, { ...d, ids: [...d.ids, id], optional: d.optional && optional });
  };
  for (const st of listStacks()) {
    const d = st.deploy;
    if (!d) continue;
    for (const name of new Set(Object.values(d.secrets))) add(name, st.id, true, false);
    for (const name of d.vars) add(name, st.id, false, false);
    for (const name of d.optionalVars ?? []) add(name, st.id, false, true);
  }
  for (const [name, d] of deploys) {
    const apps = `${d.ids.join(", ")} apps`;
    out.push({
      name,
      lives: [d.key ? "secret" : "variable", "pc"],
      what: d.key ? `the deploy key ${apps} are given` : `a value ${apps} deploy with`,
      setBy: d.optional ? "you, in your credentials file" : "`ship setup apps`",
      ...(d.optional ? { optional: true } : { steps: ["apps"] }),
      readBy: `${apps}' deploys: \`ship publish\`, a merged plan's new repo`,
    });
  }
  for (const [id, t] of Object.entries(loadTools())) {
    for (const k of Object.values(t.keys)) {
      if (k.look)
        out.push({
          name: k.look,
          lives: ["secret", "pc"],
          what: `${id}'s read-only key`,
          setBy: `\`ship add ${id}\``,
          readBy: `\`task.yml\`'s think step: ${id}'s look calls`,
        });
      if (k.act && k.act !== k.look)
        out.push({
          name: k.act,
          lives: ["secret", "pc"],
          what: `${id}'s key for the changes you approved`,
          setBy: `\`ship add ${id}\``,
          readBy: `\`task.yml\`'s apply step, only for ${id}'s calls you approved`,
        });
    }
    for (const [name, k] of Object.entries(t.setup?.keys ?? {}))
      if (k.to === "edge")
        out.push({
          name,
          lives: ["worker", "pc"],
          what: `${id}'s key`,
          setBy: `\`ship add ${id}\` (\`--new\` for a new one)`,
          readBy: `the edge: ${id}'s messages`,
        });
  }
  const harness = readExecutors();
  const agents = loadExecutors();
  const first = defaultAgent(agents, "");
  // The agents each login is for: a gateway's key serves every agent on it (pi and OpenCode).
  const by = new Map<string, string[]>();
  for (const [id, e] of Object.entries(agents)) {
    const login = loginOf(e, harness.gateways);
    if (login) by.set(login.secret, [...(by.get(login.secret) ?? []), id]);
  }
  for (const ids of by.values()) {
    const id = ids[0] as string;
    const e = agents[id];
    const login = loginOf(e, harness.gateways);
    if (!e || !login) continue;
    const gateway = e.gateway && !e.login ? e.gateway : undefined;
    const all = (and: string) => ids.join(` ${and} `);
    out.push({
      name: login.secret,
      lives: gateway ? ["secret", "pc"] : ["secret"],
      what: gateway
        ? `${gateway}'s key: ${ids.map((i) => `${i}'s`).join(" and ")} models`
        : `${id}'s login`,
      setBy: gateway
        ? `\`ship add ${gateway}\``
        : id === first
          ? `\`ship setup agent\` (${login.how}; \`--new\` for a new one)`
          : `you: ${login.how}, then \`gh secret set ${login.secret}\``,
      ...(ids.includes(first) ? { steps: ["agent"], core: true } : {}),
      readBy: `\`task.yml\`'s think step, when ${all("or")} runs`,
    });
  }
  return out;
}

/** Two of the same setting, from two places, as one: where both live, and what both read it. */
function merge(a: Setting, b: Setting): Setting {
  const join = (x: string, y: string) => (x.includes(y) ? x : `${x}; ${y}`);
  const steps = [...new Set([...(a.steps ?? []), ...(b.steps ?? [])])];
  const m: Setting = {
    name: a.name,
    lives: HOMES.filter((h) => a.lives.includes(h) || b.lives.includes(h)),
    what: a.what,
    setBy: join(a.setBy, b.setBy),
    readBy: join(a.readBy, b.readBy),
  };
  if (steps.length) m.steps = steps;
  if (a.core || b.core) m.core = true;
  if (a.optional && b.optional) m.optional = true;
  return m;
}

/** Every setting a copy has, once each: the core's, then the edge's, then the plug-ins'. */
export function allSettings(): Setting[] {
  const by = new Map<string, Setting>();
  for (const s of [...CORE_SETTINGS, ...EDGE_SETTINGS, ...pluginSettings()]) {
    const had = by.get(s.name);
    by.set(s.name, had ? merge(had, s) : s);
  }
  return [...by.values()];
}

/** What your copy holds, by name: its variables (with their values) and its secrets. */
export interface CopyState {
  vars: Record<string, string>;
  secrets: string[];
}

/**
 * What a setup step's settings lack on your copy (none optional), by kind: "variables A, B",
 * "secret C".
 */
export function absent(step: string, copy: CopyState, all = allSettings()): string[] {
  const mine = all.filter((s) => s.steps?.includes(step) && !s.optional);
  const named = (kind: string, names: string[]) =>
    names.length ? [`${kind}${names.length > 1 ? "s" : ""} ${names.join(", ")}`] : [];
  return [
    ...named(
      "variable",
      mine.filter((s) => s.lives.includes("variable") && !copy.vars[s.name]).map((s) => s.name),
    ),
    ...named(
      "secret",
      mine
        .filter((s) => s.lives.includes("secret") && !copy.secrets.includes(s.name))
        .map((s) => s.name),
    ),
  ];
}

/**
 * What your copy holds that no setting is: a variable on no list, or a name set where it doesn't
 * live (a value kept as a secret). A secret on no list is a new project's key (task.yml copies
 * those), so it's never one.
 */
export function stale(copy: CopyState, all = allSettings()): string[] {
  const of = new Map(all.map((s) => [s.name, s]));
  return [
    ...Object.keys(copy.vars)
      .filter((n) => !of.get(n)?.lives.includes("variable"))
      .map((n) => `variable ${n}`),
    ...copy.secrets
      .filter((n) => of.has(n) && !of.get(n)?.lives.includes("secret"))
      .map((n) => `secret ${n}`),
  ];
}

const WHERE: Record<Home, string> = {
  variable: "a variable",
  secret: "a secret",
  worker: "the edge's Worker",
  pc: "this PC",
};

/** The guides' table of every setting (docs/settings.md), from the list. */
export function settingsTable(all = allSettings()): string {
  const cell = (s: string) => s.replaceAll("|", "\\|");
  const need = (s: Setting) =>
    s.core ? "by the core" : s.optional ? "no: unset, its default" : "by its add-on";
  const rows = [...all]
    .sort((a, b) => HOMES.indexOf(a.lives[0] as Home) - HOMES.indexOf(b.lives[0] as Home))
    .map(
      (s) =>
        `| \`${s.name}\` | ${s.lives.map((h) => WHERE[h]).join(", ")} | ${cell(s.what)} | ${cell(s.setBy)} | ${cell(s.readBy)} | ${need(s)} |`,
    );
  return [
    "| Setting | Lives | Holds | Set by | Read by | Needed |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
