// The answers that need no run's thinking (ADR 0032, "Every channel can do the same things"): /help,
// /ping, /apps, /repos, /notebook, /recipes and /models, written once. The door answers them at once in a
// chat; a run answers them on GitHub, with no agent. Each channel only renders the words its own way.
// Pure: what's read (GitHub, a gateway's list) is read by each side and handed in.
import executors from "../../executors.json" with { type: "json" };
import intents from "../../intents.json" with { type: "json" };
import { NEEDS_YOU_LABEL, STUCK_LABEL } from "./labels.ts";
import type { ReposSeen } from "./watch.ts";
import { PICK, parseUse, pickedLine, pickWord, type Use, useLabel, useLine } from "./use.ts";
import { type Button, WORDS } from "./words.ts";
import { withZone } from "./zone.ts";

// ---------------------------------------------------------------- outside text

/** A string cut to n UTF-16 units, never half an emoji. */
export function cut(s: string, n: number): string {
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}

/**
 * Outside text (a title, an app's name) on one short line, shown as text: no control or format
 * characters, and nothing a chat would turn into a command, a link or a mention.
 */
export const line = (s: string, n = 80) => {
  const t = s
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (/\s/.test(c) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("://", ":∕∕")
    .replace(/\/(?=\p{L})/gu, "∕")
    .replace(/@(?=[\p{L}\p{N}_])/gu, "＠");
  return t.length > n ? `${cut(t, n - 1)}…` : t;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return "unknown";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------------------------------------------------------------- the commands

/** The commands answered with no thinking, beside intents.json's chat commands. */
export const INSTANT: [string, string][] = [
  ["tasks", "Your open tasks, by what they wait on: tap one to carry it on"],
  ["ping", "Is everything up? Every box and the watch, at once; /ping pin keeps it on top"],
  ["apps", "Your apps, with their links and health"],
  ["repos", "The repos Shipify can work on, by account: name one to change it or read it"],
  ["notebook", "What Shipify remembers about you: each page"],
  ["recipes", "Your recipes, and when each runs next"],
  ["models", "Each agent's models; with a word (/models kimi), a gateway's that match"],
  ["help", "What you can send"],
];
export type Instant =
  | "tasks"
  | "ping"
  | "apps"
  | "repos"
  | "notebook"
  | "recipes"
  | "models"
  | "help";
const NAMES = new Set(INSTANT.map(([c]) => c));

/**
 * One of these commands, when it's the whole of the words (`/apps`, `/notebook Preferences`): its
 * name and what follows. Read from a chat's message or a GitHub comment alike.
 */
export function instantOf(words: string): { name: Instant; rest: string } | null {
  const hit = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(words.trim());
  const name = hit?.[1]?.toLowerCase();
  return name && NAMES.has(name) ? { name: name as Instant, rest: (hit?.[2] ?? "").trim() } : null;
}

/** A task's pick as its status comment keeps it: none is the default agent's Auto. */
export type Picked = { agent?: string; model?: string; effort?: string };

/** A model's name in a label: a listed one by its pick word, any other whole (its maker kept). */
const nameOf = (seen: [string, AgentSeen][]) => {
  const listed = new Set(seen.flatMap(([, e]) => e.models ?? []));
  return (m: string) => (listed.has(m) ? pickWord(m) : m);
};

/**
 * A task's pick as a chat shows it ("Opus · High", "Pi · glm-5.3", "Auto"). `withAuto`: what Auto
 * is, when the pick is an agent's Auto ("Auto (Sonnet · Medium)").
 */
export function pickLabel(p: Picked = {}, withAuto = false): string {
  const seen = agentsSeen();
  const fallback = seen[0]?.[0] ?? "";
  const agent = p.agent ?? fallback;
  const name = nameOf(seen);
  const label = useLabel({ agent, model: p.model, effort: p.effort }, fallback, name);
  const auto = Object.fromEntries(seen)[agent]?.auto;
  if (!withAuto || p.model || p.effort || !auto?.model) return label;
  return `${label} (${useLabel({ agent: fallback, model: auto.model, effort: auto.effort }, fallback, name)})`;
}

/**
 * A pick, read by the one grammar (use.ts) against executors.json's agents, as the box reads it:
 * its agent, model, effort and label ("Pi · glm-5.3 · High"); none for words it can't take.
 * `current`: the task's pick (its status comment's `use`) when the door knows it, else the default
 * agent's Auto, which an effort alone or an id only a pattern takes is read against. A model no
 * agent lists keeps its maker in the label.
 */
export function pickOf(words: string, current: Picked = {}): Use | undefined {
  const seen = agentsSeen();
  const fallback = seen[0]?.[0] ?? "";
  if (!PICK.test(words.trim())) return undefined;
  return parseUse(
    words,
    Object.fromEntries(seen),
    { ...current, agent: current.agent ?? fallback },
    fallback,
    nameOf(seen),
  );
}

/**
 * The pick a message's `use` lines make, as the box reads them: the last line that is a pick it can
 * take, or one that tries a pick (namesPick). Undefined: none; no `use`: one it can't take.
 */
export function pickLine(
  text: string,
  current: Picked = {},
): { words: string; use?: Use } | undefined {
  const seen = agentsSeen();
  const fallback = seen[0]?.[0] ?? "";
  const words = pickedLine(
    text,
    Object.fromEntries(seen),
    { ...current, agent: current.agent ?? fallback },
    fallback,
  );
  if (words === undefined) return undefined;
  const use = pickOf(words, current);
  return use ? { words, use } : { words };
}

/** A pick as a chat says it ("Pi · glm-5.3 · High"), or none for words it can't take. */
export const pickSaid = (words: string, current: Picked = {}) => pickOf(words, current)?.label;

/**
 * A pick as `use` words that name it whole, whatever it's read against: its agent, its model and
 * its effort, or the agent's `auto` ("claude opus high", "pi z-ai/glm-5.3-flash", "pi auto").
 */
export const pickWords = (p: Picked & { agent: string }) =>
  [p.agent, p.model, p.effort].filter(Boolean).join(" ") + (p.model || p.effort ? "" : " auto");

/** The pick a text's last `use <pick>` line names, if any: the box's useLine. */
export const pickIn = useLine;

/** The chat commands intents.json names (`ask`, `new`…), each with the words its titles start with. */
export const CHATS: { chat: string; prefix?: string; says: string; starts: string }[] =
  Object.values(
    intents.intents as Record<
      string,
      { chat?: string; words: string[]; says: string; starts: string }
    >,
  ).flatMap((i) => {
    if (!i.chat) return [];
    const prefixes = i.words.flatMap((w) => /^([a-z]+)\s*:/.exec(w)?.[1] ?? []);
    const prefix = prefixes.includes(i.chat) ? i.chat : prefixes[0];
    return [{ chat: i.chat, says: i.says, starts: i.starts, ...(prefix ? { prefix } : {}) }];
  });

export const NO_MENU = "Type / to see what you can ask.";

/** `/use`: alone, the model picker (a chat's buttons; on GitHub, the task's pick); with words, a pick. */
export const USE_COMMAND: [string, string] = [
  "use",
  "Pick your model: new tasks start with it. #12 /use, or as a reply: that task's only",
];
/** The commands a chat's menu shows (ADR 0042 §7): the rest work typed, and /help lists them. */
const MENU = ["ask", "tasks", "use", "help"];

/** Every command, a line each: intents.json's chat commands, /use, then those answered at once. */
const commands = (): [string, string][] => [
  ...CHATS.map((c): [string, string] => [c.chat, c.says]),
  USE_COMMAND,
  ...INSTANT,
];

/** How to use a chat: intents.json's help, then the words a task takes, from the one list. */
export function helpGuide(): string[] {
  const where = (w: "anywhere" | "github") =>
    Object.entries(WORDS).flatMap(([k, d]) => (d.where === w ? [k] : []));
  const words = `Words on a task: ${[...where("anywhere"), "use <model>"].join(", ")}; on GitHub only: ${where("github").join(", ")}.`;
  return [...intents.help.guide, words];
}

/**
 * What a chat with a menu shows of Shipify (Telegram's): its four commands, and how to use it
 * (the guide and its short line). `ship add` sets it, and the watch keeps it in step.
 */
export function chatMenu() {
  const all = new Map(commands());
  const shown = MENU.filter((c) => all.has(c)).map((command) => ({
    command,
    description: (all.get(command) ?? "").slice(0, 256),
  }));
  return { commands: shown, description: intents.help.guide.join("\n"), short: intents.help.short };
}

/** /help: how it works, what you'd type, every command a line each, then the words a task takes. */
export function helpText(): string {
  const guide = helpGuide();
  const examples = (intents.help.examples as [string, string][]).map(
    ([w, does]) => `${w} → ${does}`,
  );
  const menu = commands().map(([c, says]) => `/${c}: ${says}`);
  return [
    guide.slice(0, -1).join("\n"),
    ...(examples.length ? [`Examples:\n${examples.join("\n")}`] : []),
    menu.length ? `Commands:\n${menu.join("\n")}` : NO_MENU,
    `${guide.at(-1) ?? ""}\nAn edited message isn't read again: send a new one.`,
  ].join("\n\n");
}

// ---------------------------------------------------------------- /models

/** An agent's entry in executors.json, as far as the menus and /models read it. */
export interface AgentSeen {
  adapter?: string;
  default?: boolean;
  manual?: boolean;
  gateway?: string;
  /** Its models: its own names (Claude Code's "sonnet"), or ids at its gateway ("z-ai/glm-5.3"). */
  models?: string[];
  /** A line about each listed model, for the picker. */
  about?: Record<string, string>;
  modelPattern?: string;
  efforts?: string[];
  noEffort?: string[];
  auto?: { model?: string; effort?: string };
}
type GatewaySeen = { url?: string; search?: string };

/**
 * executors.json's agents a `use` line may name (an entry with an adapter, none set aside to run by
 * hand), the default one first. A new agent or gateway is an entry there, never code here.
 */
export function agentsSeen(): [string, AgentSeen][] {
  const all = Object.entries(executors as Record<string, AgentSeen>).filter(
    ([, e]) => typeof e?.adapter === "string" && !e.manual,
  );
  const first = all.find(([, e]) => e.default) ?? all[0];
  return first ? [first, ...all.filter((a) => a !== first)] : [];
}

const gatewaysSeen = () => (executors as { gateways?: Record<string, GatewaySeen> }).gateways ?? {};

/** At most this many of a gateway's models in an answer, and of its list's bytes read. */
export const MOST_FOUND = 15;
export const MOST_LIST = 400_000;

/**
 * What a search for models reads (`/models <word>`, the web chat's chip): each gateway with a
 * `search` (its own list, public), with the word in its address. Read with no key and at most
 * MOST_LIST bytes, then handed to modelsFound.
 */
export function modelSearches(word: string): { gateway: string; url: string }[] {
  const w = word.trim().slice(0, 40);
  if (!w) return [];
  return Object.entries(gatewaysSeen()).flatMap(([gateway, g]) =>
    g.url && g.search
      ? [{ gateway, url: `${g.url}${g.search.replace("{word}", encodeURIComponent(w))}` }]
      : [],
  );
}

/**
 * A model a gateway's list has: its id, then what the gateway says of it, each when it does: its
 * name and maker, its price per million tokens (in, out), its context and longest answer, what it
 * can do (tools, reasoning, images) and its own efforts.
 */
export interface ModelFound {
  id: string;
  name?: string;
  maker?: string;
  price?: [number, number];
  context?: number;
  output?: number;
  can?: ("tools" | "reasoning" | "images")[];
  efforts?: string[];
}

const SAFE_ID = /^[a-z0-9][\w.:/-]{0,99}$/i;
const EFFORT = /^[a-z]{2,10}$/;

type Listed = {
  id: string;
  name?: unknown;
  pricing?: Record<string, unknown>;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown };
  top_provider?: { max_completion_tokens?: unknown };
  supported_parameters?: unknown;
  reasoning?: { supported_efforts?: unknown };
};

/** What a gateway says of one model, read with care: anything odd is left out. */
function factsOf(m: Listed): ModelFound {
  // Per million tokens, to a hundredth of a cent.
  const per = (v: unknown) => Math.round(Number(v) * 1e10) / 1e4;
  const price = [per(m.pricing?.prompt), per(m.pricing?.completion)];
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0);
  const has = (v: unknown, w: string) => Array.isArray(v) && v.includes(w);
  // "Z.ai: GLM 5.3 Flash" is its maker and its name.
  const full = typeof m.name === "string" ? line(m.name, 80) : "";
  const [maker, name] = full.includes(": ") ? full.split(": ", 2) : ["", full];
  const can = [
    has(m.supported_parameters, "tools") && "tools",
    has(m.supported_parameters, "reasoning") && "reasoning",
    has(m.architecture?.input_modalities, "image") && "images",
  ].filter(Boolean) as ModelFound["can"];
  const efforts = Array.isArray(m.reasoning?.supported_efforts)
    ? m.reasoning.supported_efforts.filter(
        (e): e is string => typeof e === "string" && EFFORT.test(e),
      )
    : [];
  return {
    id: m.id,
    ...(name ? { name } : {}),
    ...(maker ? { maker } : {}),
    ...(price.every(Number.isFinite) ? { price: price as [number, number] } : {}),
    ...(count(m.context_length) ? { context: count(m.context_length) } : {}),
    ...(count(m.top_provider?.max_completion_tokens)
      ? { output: count(m.top_provider?.max_completion_tokens) }
      : {}),
    ...(can?.length ? { can } : {}),
    ...(efforts.length ? { efforts } : {}),
  };
}

/**
 * What a gateway's list (`body`, the OpenAI shape `{data: [{id}]}`; more when it gives it) has that
 * its agent takes: each id its `modelPattern` matches, as it is, so a `use` line can name it, with
 * its facts. Null when the list didn't come or doesn't read.
 */
export function modelsFound(gateway: string, body: string | null): ModelFound[] | null {
  if (body === null || body.length > MOST_LIST) return null;
  let data: unknown;
  try {
    data = (JSON.parse(body) as { data?: unknown }).data;
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const e = agentsSeen().find(([, x]) => x.gateway === gateway)?.[1];
  const pattern = e?.modelPattern ? new RegExp(e.modelPattern) : null;
  const takes = (id: unknown): id is string =>
    Boolean(e) && typeof id === "string" && SAFE_ID.test(id) && (!pattern || pattern.test(id));
  return data
    .filter((m: { id?: unknown }) => takes(m?.id))
    .slice(0, MOST_FOUND)
    .map(factsOf);
}

const dollars = (n: number) => `$${n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`);

/** One found model: its id as `use` takes it, its price per million tokens and its context. */
function foundLine(m: ModelFound): string {
  const [i, o] = m.price ?? [];
  const price = !m.price
    ? ""
    : i === 0 && o === 0
      ? "free"
      : `${dollars(i ?? 0)} / ${dollars(o ?? 0)}`;
  const context = m.context ? `${tokens(m.context)} context` : "";
  return [m.id, [price, context].filter(Boolean).join(", ")].filter(Boolean).join(": ");
}

/** How an agent's effort reads: its list's ends. */
const span = (e: string[]) => (e.length > 2 ? `${e[0]} to ${e.at(-1)}` : e.join(" or "));

/**
 * /models: each agent with its Auto, its efforts and its models (a gateway's ids one a line), and
 * how to pick one. `/models <word>`: what each gateway's own list has for it (`read` is each
 * gateway's answer, null when it didn't come), each as a `use` line takes it.
 */
/**
 * `/models <word>`'s finds as buttons, each sending the words that pick it (`use pi <id>`), a row
 * each: the same picks its text names. None without a word, or a list that couldn't be read.
 */
export function modelsButtons(word = "", read: Record<string, string | null> = {}): Button[][] {
  if (!word.trim()) return [];
  const agents = agentsSeen();
  return modelSearches(word).flatMap(({ gateway }) => {
    const agent = agents.find(([, x]) => x.gateway === gateway)?.[0];
    const found = modelsFound(gateway, read[gateway] ?? null) ?? [];
    return agent ? found.map((m) => [{ label: m.id, words: `use ${agent} ${m.id}` }]) : [];
  });
}

export function modelsText(word = "", read: Record<string, string | null> = {}): string {
  const agents = agentsSeen();
  // No <angle brackets>: GitHub takes them for HTML and drops them. The example is executors.json's:
  // the last agent (named when it isn't the only one), a model, an effort.
  const [xa, xe] = agents.at(-1) ?? [];
  const like = [agents.length > 1 && xa, xe?.models?.at(-1), xe?.efforts?.at(-1)];
  const pick = `Pick one with a use line, like use ${like.filter(Boolean).join(" ") || "auto"}: in a task's first words, as a comment on it, or with the web chat's model chip.`;
  if (!word.trim()) {
    const each = agents.map(([id, e], k) => {
      const auto = e.auto?.model
        ? `Auto: ${[e.auto.model, e.auto.effort].filter(Boolean).join(", ")}`
        : "";
      const effort = e.efforts?.length ? `effort ${span(e.efforts)}` : "";
      const head = `${id}${k ? "" : " (the default)"}${e.gateway ? `, through ${e.gateway}` : ""}`;
      const about = [auto, effort].filter(Boolean).join("; ");
      const list = (e.models ?? []).join(e.gateway ? "\n" : ", ");
      const more =
        e.gateway && gatewaysSeen()[e.gateway]?.search
          ? `\nOr any model ${e.gateway} has: add a word to find them (/models kimi, /models coder).`
          : "";
      return `${head}${about ? `. ${about}` : ""}\n${list}${more}`;
    });
    return each.length ? [...each, pick].join("\n\n") : "No agent in executors.json.";
  }
  const w = line(word, 40);
  const searched = modelSearches(word);
  if (!searched.length) return "No gateway here has a list to search: /models shows every model.";
  const parts = searched.map(({ gateway }) => {
    const found = modelsFound(gateway, read[gateway] ?? null);
    if (!found) return `Couldn't read ${gateway}'s list just now: try again in a minute.`;
    const agent = agents.find(([, x]) => x.gateway === gateway)?.[0];
    if (!agent || !found.length)
      return `${gateway} has no model for “${w}” that an agent here takes.`;
    const priced = found.some((m) => m.price);
    return [
      `${gateway}, “${w}”${priced ? ": price per million tokens, in / out" : ""}`,
      ...found.map(foundLine),
      `Pick one with a line: use ${agent} ${found[0]?.id}`,
    ].join("\n");
  });
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- /ping

export interface PingBox {
  name: string;
  online: boolean;
  /** Its slots, and how many are busy, when its runners can be read (the edge can, a box can't). */
  slots?: number;
  busy?: number;
}

export const NO_BOX_YET = "No box yet: tasks wait for one (docs/box-setup.md).";
/** A day and a bit: a watch whose last due run is older has stopped. */
export const WATCH_STOPPED_MS = 26 * 3_600_000;

/** /ping: "All good", or what isn't; then a line per box, and one for the watch. */
export function pingText(
  boxes: PingBox[],
  lastDue: string | null | undefined,
  now: number,
): string {
  if (!boxes.length) return NO_BOX_YET;
  const last = lastDue ? Date.parse(lastDue) : null;
  const stopped = last !== null && now - last > WATCH_STOPPED_MS;
  const wrong = [
    ...boxes.filter((b) => !b.online).map((b) => `${line(b.name, 64)} is offline`),
    ...(stopped
      ? [`the watch hasn't run a due run for ${Math.floor((now - (last ?? now)) / 3_600_000)} h`]
      : []),
  ];
  const head = wrong.length ? wrong.join("; ").replace(/^the/, "The") : "All good";
  const rows = boxes.map((b) =>
    !b.online
      ? `${line(b.name, 64)}: offline`
      : b.slots === undefined
        ? `${line(b.name, 64)}: online`
        : `${line(b.name, 64)}: online, ${plural(b.slots, "slot")} (${b.busy ?? 0} busy)`,
  );
  const watch =
    last === null
      ? "The watch: no due run yet"
      : `The watch: last due run ${timeAgo(lastDue, now)}`;
  return [head, ...rows, watch].join("\n");
}

/** The status's last line: how the chat's pinned message is known as the one to keep up to date. */
export const PIN_MARK = "Kept up to date every 5 minutes, silently. Unpin it to stop.";

/**
 * The status a chat keeps pinned (`/ping pin`): its first line, all a chat's top bar shows, says
 * it all ("2 of 3 slots busy · #245 #247"); then a line per box and per task working. Nothing in
 * it changes with the clock, so it's edited only when what it says does.
 */
export function pinText(boxes: PingBox[], working: { n: number; title: string }[]): string {
  if (!boxes.length) return [NO_BOX_YET, PIN_MARK].join("\n");
  const up = boxes.filter((b) => b.online);
  const slots = up.reduce((n, b) => n + (b.slots ?? 0), 0);
  const busy = up.reduce((n, b) => n + (b.busy ?? 0), 0);
  const top = [
    ...boxes.filter((b) => !b.online).map((b) => `${line(b.name, 64)} offline`),
    ...(slots
      ? [busy ? `${busy} of ${plural(slots, "slot")} busy` : `${plural(slots, "slot")} free`]
      : []),
    ...(working.length ? [working.map((t) => `#${t.n}`).join(" ")] : []),
  ];
  const rows = boxes.map((b) =>
    !b.online
      ? `${line(b.name, 64)}: offline`
      : `${line(b.name, 64)}: ${b.busy ?? 0} of ${plural(b.slots ?? 0, "slot")} busy`,
  );
  const tasks = working.map((t) => `#${t.n} · ${line(t.title, 60)}`);
  return [top.join(" · ") || "All good", ...rows, ...tasks, PIN_MARK].join("\n");
}

// ---------------------------------------------------------------- /apps

export interface AppHealth {
  id: string;
  url: string;
  paused: boolean;
  health?: { ok: boolean; version?: string };
}

/** /apps: each app with its health and its link; paused ones say so. */
export function appsText(apps: AppHealth[]): string {
  if (!apps.length) return "No apps yet.";
  return apps
    .map((a) => {
      const state = a.paused
        ? "taken down"
        : !a.health
          ? "not read"
          : a.health.ok
            ? `live${a.health.version ? ` · v${line(a.health.version, 20)}` : ""}`
            : "failing";
      return `${line(a.id, 60)}: ${state}\n${a.url}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------- /repos

/** The most names /repos shows of each kind: the rest are counted. */
const MOST_SHOWN = 60;

/**
 * /repos (ADR 0047): every repo Shipify can work on, one kind of extension. Shipify's own
 * account's, as the due run last read them: the projects it built, then the repos that keep their
 * own rules. Then your other accounts, whose repos a task names by owner/name. A name is shown as
 * it is (the record keeps only repo names: none is a link, a mention or a command), so it can be
 * copied into a task.
 */
export function reposText(
  r: { own: string; repos: ReposSeen; accounts: string[] },
  now: number,
): string {
  const line = (label: string, names: string[]) => {
    const shown = names.slice(0, MOST_SHOWN);
    const more = names.length - shown.length;
    return `${label}: ${shown.join(" · ") || "none"}${more > 0 ? ` · and ${more} more` : ""}`;
  };
  const own = r.repos.at
    ? [
        `${r.own} (read ${timeAgo(r.repos.at, now)}):`,
        line("Projects (Shipify built them)", r.repos.projects),
        line(
          "Repos (their own rules)",
          r.repos.names.filter((n) => !r.repos.projects.includes(n)),
        ),
      ]
    : [`${r.own}: not read yet. The daily check lists them.`];
  const others = r.accounts.map(
    (a) => `${a}: name a repo as ${a}/<repo>. The first task checks Shipify can reach it.`,
  );
  return [
    ...own,
    ...others,
    "",
    "To change one: <name>: what to change. To read one: look at <name>. A repo made since works by its name at once. Its notes: remember <name>: …",
  ].join("\n");
}

// ---------------------------------------------------------------- /notebook

export interface PageSeen {
  topic: string;
  /** Its first line, as the prompt's index shows it. */
  first: string;
  lines: number;
  url: string;
}

/** /notebook: each page with its first line and link; or how to start one. */
export function notebookText(pages: PageSeen[]): string {
  if (!pages.length) return "The notebook is empty. Say remember: … to add a note.";
  return [
    ...pages.map(
      (p) =>
        `${line(p.topic, 60)} (${plural(p.lines, "line")}): ${line(p.first, 100) || "(empty)"}\n${p.url}`,
    ),
    "remember: … adds a note, forget: … removes one.",
  ].join("\n\n");
}

// ---------------------------------------------------------------- /tasks

/** What an open task waits on, as /tasks groups it. */
export type TaskGroup = "working" | "needs-you" | "repeating" | "answered";

export interface TaskRow {
  n: number;
  title: string;
  group: TaskGroup;
  /** A repeat's next time. */
  next?: string;
}

const GROUPS: [TaskGroup, string][] = [
  ["working", "Working"],
  ["needs-you", "Needs you"],
  ["repeating", "Repeating"],
  ["answered", "Answered"],
];
/** A group's tasks at most, in /tasks: the rest are on GitHub. */
export const MOST_EACH = 8;

/** A task's group, from its labels and whether a run is going: needing you comes first. */
export function groupOf(labels: string[], working = false): TaskGroup {
  if (labels.some((l) => l === NEEDS_YOU_LABEL || l === STUCK_LABEL || l === "failed"))
    return "needs-you";
  if (working || labels.includes("working")) return "working";
  if (labels.includes("repeats") || labels.includes("recipe")) return "repeating";
  return "answered";
}

/**
 * /tasks' rows from open issues as GitHub lists them (the door's read and the box's alike): each
 * task but a PR or one labelled `hidden` (the status task, a notebook page), with its group and a
 * repeat's next time from "Coming up".
 */
export function taskRows(
  issues: { number: number; title: string; labels?: { name: string }[]; pull_request?: unknown }[],
  hidden: string[],
  upcoming: { n: number; next: string }[] = [],
): TaskRow[] {
  return issues
    .filter((i) => !i.pull_request && !(i.labels ?? []).some((l) => hidden.includes(l.name)))
    .map((i) => {
      const next = upcoming.find((u) => u.n === i.number)?.next;
      return {
        n: i.number,
        title: i.title,
        group: groupOf((i.labels ?? []).map((l) => l.name)),
        ...(next ? { next } : {}),
      };
    });
}

/** The open tasks by group, in /tasks' order: each group's name, its first tasks, how many more. */
export function inGroups(rows: TaskRow[]): { name: string; rows: TaskRow[]; more: number }[] {
  return GROUPS.flatMap(([group, name]) => {
    const each = rows.filter((r) => r.group === group);
    return each.length
      ? [{ name, rows: each.slice(0, MOST_EACH), more: Math.max(0, each.length - MOST_EACH) }]
      : [];
  });
}

/** /tasks: the open tasks by group, as they come (newest first), a repeat with its next time. */
export function tasksText(rows: TaskRow[], now: number): string {
  if (!rows.length) return "No open tasks. Send me anything to start one.";
  const one = (r: TaskRow) =>
    `#${r.n} · ${line(r.title, 60)}${r.next ? ` · next ${timeUntil(r.next, now)}` : ""}`;
  return inGroups(rows)
    .map((g) =>
      [g.name, ...g.rows.map(one), ...(g.more ? [`and ${g.more} more on GitHub`] : [])].join("\n"),
    )
    .join("\n\n");
}

// ---------------------------------------------------------------- /recipes

export interface RecipeSeen {
  name: string;
  /** Its task, once the due run has opened it. */
  task?: number;
  every?: string;
  next?: string;
  paused?: boolean;
}

/**
 * Each recipe with its next time and schedule from "Coming up", where its task's own run put them
 * at once; the recipes list itself is written by the next due run.
 */
export function withUpcoming(
  recipes: RecipeSeen[],
  upcoming: { n: number; next: string; every?: string }[],
): RecipeSeen[] {
  return recipes.map((r) => {
    const u = r.task ? upcoming.find((x) => x.n === r.task) : undefined;
    return u && !r.paused ? { ...r, next: u.next, ...(u.every ? { every: u.every } : {}) } : r;
  });
}

/** /recipes: each recipe, when it runs next, and its task; or how to start one. */
export function recipesText(recipes: RecipeSeen[], now: number): string {
  if (!recipes.length)
    return "No recipes yet. Say “turn on the daily brief recipe”, or see recipes/examples.";
  return recipes
    .map((r) => {
      const when = r.paused
        ? "paused (resume on its task)"
        : r.next
          ? `${r.every ? `${line(withZone(r.every), 60)}, ` : ""}next ${timeUntil(r.next, now)}`
          : "starting";
      return `${line(r.name, 60)}: ${when}${r.task ? ` · #${r.task}` : ""}`;
    })
    .join("\n");
}

function timeUntil(iso: string, now: number): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (Number.isNaN(s)) return "unknown";
  if (s <= 60) return "now";
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

// ---------------------------------------------------------------- acknowledgements

/** Words that only thank or agree: the door answers them at once, and a run reads them as a thanks
 * unless a question waits on you. One list for both. */
const THANKS_WORDS = new Set([
  "ok",
  "okay",
  "thanks",
  "thank you",
  "thx",
  "done",
  "cool",
  "great",
  "nice",
]);
/** A yes or a no: on a task, written (its run says approvals are on GitHub); alone, answered. */
const YES_NO = new Set(["yes", "no"]);
const TRAIL = /(?:[\s.!\p{Extended_Pictographic}\p{Emoji_Modifier}]|‍|️)+$/u;

/** "thanks", "yes", or none: what a message's words only say, with dots, ! and emoji after. */
export function acknowledgement(words: string): "thanks" | "yes-no" | null {
  const t = words.trim().toLowerCase();
  const base = t.replace(TRAIL, "").replace(/\s+/g, " ");
  if (!base) return t.startsWith("👍") || t.startsWith("🙏") ? "thanks" : null;
  return THANKS_WORDS.has(base) ? "thanks" : YES_NO.has(base) ? "yes-no" : null;
}
