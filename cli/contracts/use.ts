// One `use` grammar (ADR 0025, ADR 0042 §3): the words that pick a task's agent, model and
// effort, read the same by the door (answers.ts' pickSaid) and the box (lib/agents.ts), so the two
// can't disagree. `use <agent> <model> <effort>`, each part optional; `auto` starts afresh. A
// model names its agent: a word that is one agent's listed model or, for a gateway's model, its
// name after the maker ("glm-5.3-flash" for "z-ai/glm-5.3-flash") when no other listed model
// shares it.
// Pure: executors.json's agents are handed in, so tests pass their own.

/** What the grammar reads of an agent in executors.json. */
export interface UseAgent {
  /** Its name on labels, when its id capitalised isn't ("OpenCode"). */
  name?: string;
  /** The agent this is through another gateway than its first (cli/contracts/gateways.ts). */
  extends?: string;
  manual?: boolean;
  /** Its models: its own names ("sonnet"), or ids at its gateway ("z-ai/glm-5.3"). */
  models?: string[];
  /** Model ids it takes besides those (a regex). */
  modelPattern?: string;
  efforts?: string[];
  /** The efforts a model takes, where they differ from `efforts` (none: `[]`), by model id. */
  modelEfforts?: Record<string, string[]>;
  /** The model a run gets when no `use` line names one: an effort alone is held to what it takes. */
  auto?: { model?: string };
}

/**
 * The efforts an agent takes with a model: the model's own list when it has one (none: `[]`), else
 * the agent's. Every place that asks what a model takes asks here.
 */
export function effortsFor(e: UseAgent | undefined, model?: string): string[] {
  return (model && e?.modelEfforts?.[model]) || (e?.efforts ?? []);
}

/** Every effort the agent takes with any model: the words a `use` line may say. */
export const effortsOf = (e: UseAgent | undefined): string[] => [
  ...new Set([...(e?.efforts ?? []), ...Object.values(e?.modelEfforts ?? {}).flat()]),
];

/** A task's agent, model and effort, kept in its record. `label` is what it shows. */
export interface Use {
  agent: string;
  model?: string;
  effort?: string;
  label: string;
}

type Chosen = Pick<Use, "agent" | "model" | "effort">;

/**
 * A pick, as a `use` line says it: an agent, a model and an effort, each when it isn't the default
 * ("opus", "opus high", "pi moonshotai/kimi-k3 high"). The edge and the web chat write and show it.
 */
export const PICK = /^[\w.:/[\]-]+( [\w.:/[\]-]+){0,2}$/;

/** A `use` command: text that is exactly "use <words>", or "/use <words>" (a whole comment, or one line of one). */
export function useCommand(text: string | null | undefined): string | undefined {
  return /^\s*(?:\/use(?:@\w+)?|use)[ \t]+([^\n]+?)[ \t]*[.!]?\s*$/i.exec(text ?? "")?.[1];
}

/** A `use` line in a longer message: the last line that is "use" and a pick's words. */
export function useLine(text: string | null | undefined): string | undefined {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => useCommand(l))
    .filter((w): w is string => w !== undefined && PICK.test(w))
    .at(-1);
}

/** The word a listed model is picked by: its own name, or a gateway's id after its maker. */
export const pickWord = (model: string) => model.split("/").pop() ?? model;

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** An agent on labels: its `name` ("OpenCode"), else its id capitalised ("Pi"). */
export const agentName = (all: Record<string, UseAgent>, agent: string) =>
  all[agent]?.name ?? title(agent);
const ids = (all: Record<string, UseAgent>) => Object.keys(all).filter((id) => !all[id]?.manual);
const takesPattern = (e: UseAgent | undefined, model: string) =>
  e?.modelPattern !== undefined && new RegExp(e.modelPattern, "i").test(model);

/**
 * The agent and model a word names on its own: a listed model, or its pick word. Two models it
 * could name are ambiguous; one model two agents list (pi and OpenCode share a gateway) is the
 * first of `prefer`'s agents that lists it (the named one, then the task's), else the first. The
 * models an agent lists through another gateway (`pi-vercel`, with that gateway's ids) are read
 * when that agent leads, or when no agent through its first gateway has the word, so a bare word
 * stays one model's and an id only that gateway has still finds it.
 */
function listedModel(
  word: string,
  all: Record<string, UseAgent>,
  prefer: (string | undefined)[] = [],
): { agent: string; model: string } | "ambiguous" | undefined {
  const found = ids(all).flatMap((agent) =>
    (all[agent]?.models ?? [])
      .filter((m) => m === word || pickWord(m) === word)
      .map((model) => ({ agent, model })),
  );
  // The one that leads: the named agent, else the task's.
  const lead = prefer.find(Boolean);
  const first = found.filter((f) => !all[f.agent]?.extends);
  const own =
    all[lead ?? ""]?.extends && found.some((f) => f.agent === lead)
      ? found.filter((f) => f.agent === lead)
      : first.length
        ? first
        : found;
  // Its exact name wins over another model's pick word.
  const exact = own.filter((f) => f.model === word);
  const one = exact.length ? exact : own;
  if (new Set(one.map((f) => f.model)).size > 1) return "ambiguous";
  return prefer.map((a) => one.find((f) => f.agent === a)).find(Boolean) ?? one[0];
}

/**
 * The choice that words name: an agent, a model (one of its listed models, a pick word, or an id
 * its pattern takes), an effort, or "auto", three words at most. A listed model names its own
 * agent; an id only a pattern takes is the named agent's, else the current one's when its pattern
 * takes it, else the first agent's whose pattern does (pi and OpenCode share one). From `current`:
 * naming another agent, or "auto", starts its model and effort afresh. Words that name no choice,
 * or more than one, or an effort its agent or model doesn't take, give undefined.
 */
export function parseUse(
  text: string,
  all: Record<string, UseAgent>,
  current: Chosen,
  fallback: string,
  name?: (model: string) => string,
): Use | undefined {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return undefined;
  const agents = ids(all);
  const named = words.filter((w) => agents.includes(w));
  if (named.length > 1) return undefined;
  const rest = words.filter((w) => w !== named[0] && w !== "auto");
  const allEfforts = new Set(agents.flatMap((a) => effortsOf(all[a])));
  const efforts = rest.filter((w) => allEfforts.has(w));
  const models = rest.filter((w) => !allEfforts.has(w));
  if (efforts.length > 1 || models.length > 1) return undefined;
  let agent = named[0] ?? current.agent;
  let model: string | undefined;
  if (models[0]) {
    const w = models[0];
    const listed = listedModel(w, all, [named[0], current.agent]);
    if (listed === "ambiguous") return undefined;
    // An id the named agent's pattern takes; else a listed model (of the named agent, when one
    // is); else an id the current agent's pattern takes, or the first's that does.
    const takes = !named[0] && !listed && [agent, ...agents].find((a) => takesPattern(all[a], w));
    if (named[0] && takesPattern(all[agent], w)) model = w;
    else if (listed && (!named[0] || listed.agent === named[0])) ({ agent, model } = listed);
    else if (takes) [agent, model] = [takes, w];
    else return undefined;
  }
  const effort = efforts[0];
  const reset = agent !== current.agent || words.includes("auto");
  const u = {
    agent,
    model: model ?? (reset ? undefined : current.model),
    effort: effort ?? (reset ? undefined : current.effort),
  };
  // An effort the agent takes with this model (Auto's, when none is named): one asked for that it
  // doesn't is refused; one kept from before is dropped.
  if (u.effort && !effortsFor(all[agent], u.model ?? all[agent]?.auto?.model).includes(u.effort)) {
    if (effort) return undefined;
    u.effort = undefined;
  }
  return { ...u, label: useLabel(u, fallback, name, (a) => agentName(all, a)) };
}

/**
 * Whether words try to pick: three at most, and every one a pick's word (an agent, a listed model or
 * its pick word, an id an agent's pattern takes, any agent's effort, `auto`). A `use` line in a
 * longer message that tries one and can't be taken is told; anything else ("use tailwind", "use
 * haiku form.", "use pi to estimate the area") is the owner's words for the agent.
 */
export function namesPick(text: string, all: Record<string, UseAgent>): boolean {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  const agents = ids(all);
  const efforts = new Set(agents.flatMap((a) => effortsOf(all[a])));
  return words.every(
    (w) =>
      w === "auto" ||
      agents.includes(w) ||
      efforts.has(w) ||
      listedModel(w, all) !== undefined ||
      agents.some((a) => takesPattern(all[a], w)),
  );
}

/**
 * The words of the `use` line a message picks with, chosen the same by the door and the box: the
 * last line that is a pick it can take, or one that tries a pick it can't (said, then). Words for
 * the agent ("use tailwind") never hide the pick before them. Undefined when none picks.
 */
export function pickedLine(
  text: string,
  all: Record<string, UseAgent>,
  current: Chosen,
  fallback: string,
): string | undefined {
  return text
    .split(/\r?\n/)
    .flatMap((l) => useCommand(l) ?? [])
    .filter((w) => parseUse(w, all, current, fallback) || namesPick(w, all))
    .at(-1);
}

/**
 * "Opus · High", "Pi · glm-5.3", "Auto": the choice as the status comment and the chats show it.
 * `name` is a model's name for people (the box's adapters know them: "Opus 5.5"); without it a
 * gateway's model shows its pick word, and an agent's own its name.
 */
export function useLabel(
  u: Omit<Use, "label">,
  fallback: string,
  name: (model: string) => string = pickWord,
  who: (agent: string) => string = title,
): string {
  const model = u.model && (u.model.includes("/") ? name(u.model) : title(name(u.model)));
  return (
    [u.agent !== fallback && who(u.agent), model, u.effort && title(u.effort)]
      .filter(Boolean)
      .join(" · ") || "Auto"
  );
}

/** What a `use` command can name, for a reply that refused one: "an agent (claude, pi), …". */
export function useChoices(all: Record<string, UseAgent>, agent: string): string {
  const models = [...new Set(ids(all).flatMap((a) => (all[a]?.models ?? []).map(pickWord)))];
  const efforts = effortsOf(all[agent]);
  return [
    `an agent (${ids(all).join(", ")})`,
    models.length ? `a model (${models.join(", ")})` : undefined,
    efforts.length ? `an effort (${efforts.join(", ")})` : undefined,
    "or auto",
  ]
    .filter(Boolean)
    .join(", ");
}
