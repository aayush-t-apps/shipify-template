// One `use` grammar (ADR 0025, ADR 0042 §3): the words that pick a task's agent, model and
// effort, read the same by the door (answers.ts' pickSaid) and the box (lib/agents.ts), so the two
// can't disagree. `use <agent> <model> <effort>`, each part optional; `auto` starts afresh. A
// model names its agent: a word that is one agent's listed model or, for a gateway's model, its
// name after the maker ("glm-5.3-flash" for "z-ai/glm-5.3-flash") when no other listed model
// shares it.
// Pure: executors.json's agents are handed in, so tests pass their own.

/** What the grammar reads of an agent in executors.json. */
export interface UseAgent {
  manual?: boolean;
  /** Its models: its own names ("sonnet"), or ids at its gateway ("z-ai/glm-5.3"). */
  models?: string[];
  /** Model ids it takes besides those (a regex). */
  modelPattern?: string;
  efforts?: string[];
  /** Models that take no effort setting. */
  noEffort?: string[];
}

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
const ids = (all: Record<string, UseAgent>) => Object.keys(all).filter((id) => !all[id]?.manual);
const takesPattern = (e: UseAgent | undefined, model: string) =>
  e?.modelPattern !== undefined && new RegExp(e.modelPattern, "i").test(model);

/** The agent and model a word names on its own: one agent's listed model, or its pick word. */
function listedModel(
  word: string,
  all: Record<string, UseAgent>,
): { agent: string; model: string } | "ambiguous" | undefined {
  const found = ids(all).flatMap((agent) =>
    (all[agent]?.models ?? [])
      .filter((m) => m === word || pickWord(m) === word)
      .map((model) => ({ agent, model })),
  );
  // Its exact name wins over another model's pick word.
  const exact = found.filter((f) => f.model === word);
  const one = exact.length ? exact : found;
  return one.length > 1 ? "ambiguous" : one[0];
}

/**
 * The choice that words name: an agent, a model (one of its listed models, a pick word, or an id
 * its pattern takes), an effort, or "auto", three words at most. A listed model names its own
 * agent; an id only a pattern takes is the named agent's, else the current one's. From `current`:
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
  const allEfforts = new Set(agents.flatMap((a) => all[a]?.efforts ?? []));
  const efforts = rest.filter((w) => allEfforts.has(w));
  const models = rest.filter((w) => !allEfforts.has(w));
  if (efforts.length > 1 || models.length > 1) return undefined;
  let agent = named[0] ?? current.agent;
  let model: string | undefined;
  if (models[0]) {
    const w = models[0];
    const listed = listedModel(w, all);
    if (listed === "ambiguous") return undefined;
    // An id the named agent's pattern takes; else a listed model (of the named agent, when one
    // is); else an id the current agent's pattern takes.
    if (named[0] && takesPattern(all[agent], w)) model = w;
    else if (listed && (!named[0] || listed.agent === named[0])) ({ agent, model } = listed);
    else if (!named[0] && !listed && takesPattern(all[agent], w)) model = w;
    else return undefined;
  }
  const effort = efforts[0];
  if (effort && !all[agent]?.efforts?.includes(effort)) return undefined;
  const reset = agent !== current.agent || words.includes("auto");
  const u = {
    agent,
    model: model ?? (reset ? undefined : current.model),
    effort: effort ?? (reset ? undefined : current.effort),
  };
  // A model that takes no effort: one asked for is refused; one kept from before is dropped.
  if (u.model && u.effort && all[agent]?.noEffort?.includes(u.model)) {
    if (effort) return undefined;
    u.effort = undefined;
  }
  return { ...u, label: useLabel(u, fallback, name) };
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
  const efforts = new Set(agents.flatMap((a) => all[a]?.efforts ?? []));
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
): string {
  const model = u.model && (u.model.includes("/") ? name(u.model) : title(name(u.model)));
  return (
    [u.agent !== fallback && title(u.agent), model, u.effort && title(u.effort)]
      .filter(Boolean)
      .join(" · ") || "Auto"
  );
}

/** What a `use` command can name, for a reply that refused one: "an agent (claude, pi), …". */
export function useChoices(all: Record<string, UseAgent>, agent: string): string {
  const models = ids(all).flatMap((a) => (all[a]?.models ?? []).map(pickWord));
  const efforts = all[agent]?.efforts ?? [];
  return [
    `an agent (${ids(all).join(", ")})`,
    models.length ? `a model (${models.join(", ")})` : undefined,
    efforts.length ? `an effort (${efforts.join(", ")})` : undefined,
    "or auto",
  ]
    .filter(Boolean)
    .join(", ");
}
