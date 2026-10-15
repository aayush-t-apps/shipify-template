// executors.json says two things apart: the agents (a program: its install, its adapter, the
// gateways it may use) and the gateways (where models are served: their key, their models, their
// Auto, and how to read what each model is). A run works on one entry per agent through a gateway, and this is
// the one place that makes them: `pi` is pi through its first gateway, `pi-vercel` through the
// second, named by the gateway's `word`. What a gateway says wins; the agent's own are the defaults.
// They are one program, so a box installs it once. A part that can't be made is left out, said.
// Pure: the CLI's loader and the menus (edge and chat) both read executors.json through it.

type Entry = Record<string, unknown>;
const isEntry = (v: unknown): v is Entry =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What a gateway gives the agents on it, over their own: the models they list, their ids, a line each. */
const FROM_GATEWAY = ["models", "modelPattern", "about"] as const;
/** The names in executors.json that aren't agents. */
const SHARED = ["version", "commands", "gateways"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The entries a run works on, and a plain line for each part left out. */
export interface Expanded {
  entries: Record<string, unknown>;
  problems: string[];
}

/**
 * An agent through one gateway. The gateway, which knows its models, says over the agent: its
 * models, its ids and Auto (else the agent's, else its first model with no effort). What each
 * model takes is its catalog's, read when it's needed, so the agent's own per-model list isn't kept.
 */
function through(agent: Entry, gid: string, g: Entry): Entry {
  const { gateways: _, modelEfforts: __, ...rest } = agent;
  const given = Object.fromEntries(
    FROM_GATEWAY.flatMap((k) => (g[k] === undefined ? [] : [[k, g[k]]])),
  );
  const first =
    Array.isArray(g.models) && typeof g.models[0] === "string" ? g.models[0] : undefined;
  const auto = g.auto ?? agent.auto ?? (first ? { model: first } : undefined);
  return { ...rest, ...given, ...(auto ? { auto } : {}), gateway: gid };
}

/** The agent through a gateway that isn't its first: its own program, so its install is shared. */
function another(id: string, entry: Entry, name: string): Entry {
  const install = entry.install as Entry | undefined;
  const own = typeof entry.name === "string" ? entry.name : cap(id);
  return {
    ...entry,
    default: undefined,
    name: `${own} · ${name}`,
    ...(typeof entry.description === "string"
      ? { description: `${entry.description} Through ${name}.` }
      : {}),
    extends: id,
    ...(isEntry(install) ? { install: { ...install, dir: install.dir ?? id } } : {}),
  };
}

/**
 * Each agent through each of its gateways: its own id through the first, `<id>-<word>` through
 * each other. An agent whose first gateway isn't there is left out (its id means that gateway);
 * another one that isn't there, one listed twice, or an id that's taken is skipped. Each is said.
 */
export function expandAgents(file: Record<string, unknown>): Expanded {
  const gateways = isEntry(file.gateways) ? file.gateways : {};
  const problems: string[] = [];
  const say = (id: string, what: string) => problems.push(`executors.json: ${id}: ${what}`);
  // Every id written in the file first, so a made one never takes one of them.
  const entries: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(file)) {
    if (SHARED.includes(id) || !isEntry(raw)) {
      entries[id] = raw;
      continue;
    }
    const { extends: x, gateway: one, ...own } = raw;
    if (x !== undefined) say(id, "`extends` isn't read (ADR 0052): list the agent's `gateways`");
    if (one !== undefined) say(id, "`gateway` is made from `gateways` (ADR 0052): list it there");
    entries[id] = own;
  }
  for (const [id, raw] of Object.entries(entries)) {
    if (SHARED.includes(id) || !isEntry(raw) || !Array.isArray(raw.gateways)) continue;
    if (!raw.gateways.length) {
      say(id, "lists no gateway, so it's left out");
      delete entries[id];
      continue;
    }
    const seen = new Set<string>();
    for (const [k, gid] of raw.gateways.entries()) {
      const g = typeof gid === "string" ? gateways[gid] : undefined;
      if (!isEntry(g)) {
        say(
          id,
          `its gateway "${String(gid)}" isn't a working one in "gateways"${k ? "" : ", so it's left out"}`,
        );
        if (k) continue;
        delete entries[id];
        break;
      }
      if (seen.has(gid as string)) {
        say(id, `lists its gateway "${gid}" twice`);
        continue;
      }
      seen.add(gid as string);
      if (!k) {
        entries[id] = through(raw, gid as string, g);
        continue;
      }
      const word = typeof g.word === "string" ? g.word : (gid as string);
      const made = `${id}-${word}`;
      if (made in entries) {
        say(made, `${id} through "${gid}" would be this, and it's taken: left out`);
        continue;
      }
      const name = typeof g.name === "string" ? g.name : cap(word);
      entries[made] = another(id, through(raw, gid as string, g), name);
    }
  }
  return { entries, problems };
}
