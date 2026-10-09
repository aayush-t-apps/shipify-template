// The tool plug-in's contract (ADR 0015, ADR 0027, docs/plug-ins.md): one entry in tools.json. A
// tool does up to three things, its verbs:
//   look   MCP calls the agent may make on any run: reading
//   act    MCP calls that change something: only in an approved run, only by the box, after your yes or as a pre-approved call
//   in     a chat channel: its adapter in the edge (edge/src/channels/), its route /door/<in.door>,
//          and its setup here (`ship add <name>`)
// Each verb's key comes from a GitHub secret, named per verb in `keys`, so a run holds only the key
// its verb needs. A broken entry turns off that entry, never the file: loadPluginFile says why, in
// plain words, for `ship doctor` and `pnpm verify`.
import { z } from "zod";

/** tools.json's version: an optional top-level "version". A file without one is version 1. */
export const TOOLS_VERSION = 1;

const name = /^[a-z][a-z0-9_]*$/;
const call = z.string().regex(name, "a call's name is lowercase letters, digits and _");

/** Which GitHub secret a tool's variable comes from, for each verb that needs it. */
export const KeyFor = z.object({
  look: z.string().optional(),
  act: z.string().optional(),
});

/**
 * How a plug-in sets up, the same for every one (ADR 0030 §6): `ship add <name>` shows it, then does
 * it one step at a time; `ship remove <name>` undoes it.
 */
export const Setup = z.object({
  /** What you need first, in plain words, each with where to get it. */
  needs: z.array(z.string().min(1)).default([]),
  /**
   * The secrets it asks for, by name, each pasted at a hidden prompt (or found in the credentials
   * file): what to paste, and where it goes: the shipify repo (a tool's verb keys), or the edge's
   * Worker, set from this PC (a chat channel's own keys, ADR 0031).
   */
  keys: z
    .record(
      z.string().regex(/^[A-Z][A-Z0-9_]*$/, "a secret's name is upper case"),
      z.object({ ask: z.string().min(1), to: z.enum(["shipify", "edge"]).default("shipify") }),
    )
    .default({}),
  /** Its own steps, in order: each says what it does, and runs a command that checks itself first. */
  steps: z.array(z.object({ say: z.string().min(1), run: z.array(z.string()).min(1) })).default([]),
  /** What else to undo when it's removed (its keys always go). */
  remove: z.array(z.string()).min(1).optional(),
});
export type Setup = z.infer<typeof Setup>;

export const ToolEntry = z
  .object({
    description: z.string(),
    /** A server to start: a command, where a relative path (tools/…) is a path in this repo. */
    run: z.array(z.string()).min(1).optional(),
    /** Or a remote server that takes a key in a header. */
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    /** The tool's variables, and the GitHub secrets they come from for each verb. */
    keys: z.record(z.string(), KeyFor).default({}),
    /** The provider can't make a read-only key: look runs rely on the agent's tool list alone. */
    oneKey: z.boolean().optional(),
    look: z.array(call).default([]),
    act: z.array(call).default([]),
    /** A chat channel: its adapter's id in the edge, whose route /door/<door> takes its messages. */
    in: z.object({ door: z.string().regex(/^[a-z][a-z0-9-]*$/) }).optional(),
    /** A command that checks the key once (ship doctor). */
    check: z.array(z.string()).optional(),
    /**
     * Each act call's arguments, as decide checks a proposed call (ADR 0031): the names it needs,
     * and the only names it takes. A call with none here takes any arguments.
     */
    args: z
      .record(
        z.string(),
        z.object({
          required: z.array(z.string()).optional(),
          properties: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    /**
     * Pre-approved calls (ADR 0031): made with no `yes` when a run read nothing from outside. Each
     * names the call, the arguments fixed to these values, the text arguments capped at these
     * lengths (nothing else allowed), and the most such calls in one run. Merging this approves it.
     */
    pre: z
      .array(
        z.object({
          call: z.string(),
          fixed: z.record(z.string(), z.unknown()).default({}),
          caps: z.record(z.string(), z.number().int().positive().max(10_000)).default({}),
          max: z.number().int().min(1).max(20).default(1),
        }),
      )
      .optional(),
    /** How it sets up (ADR 0030 §6): `ship add <name>`. */
    setup: Setup.optional(),
  })
  .superRefine((t, ctx) => {
    const say = (message: string) => ctx.addIssue({ code: "custom", message });
    const calls = t.look.length + t.act.length;
    if (calls && Boolean(t.run) === Boolean(t.url))
      say("a tool with look or act calls has a server: either run or url");
    if (!calls && (t.run || t.url)) say("a server with no look or act calls does nothing");
    if (!calls && !t.in) say("a tool does at least one thing: look, act or in");
    for (const c of t.look.filter((c) => t.act.includes(c)))
      say(`"${c}" is both look and act: each call is one or the other`);
    for (const c of Object.keys(t.args ?? {}))
      if (!t.act.includes(c)) say(`args.${c} isn't one of its act calls`);
    for (const p of t.pre ?? [])
      if (!t.act.includes(p.call)) say(`a pre-approved "${p.call}" isn't one of its act calls`);
    for (const [v, k] of Object.entries(t.keys)) {
      if (t.look.length && !k.look)
        say(`keys.${v} has no look secret, and the tool has look calls`);
      if (t.act.length && !k.act) say(`keys.${v} has no act secret, and the tool has act calls`);
    }
    // What setup asks for on the shipify repo is a secret one of its verbs reads.
    const secrets = Object.values(t.keys).flatMap((k) => [k.look, k.act]);
    for (const [secret, k] of Object.entries(t.setup?.keys ?? {}))
      if (k.to === "shipify" && !secrets.includes(secret))
        say(`setup.keys.${secret} isn't a secret any of its keys names`);
  });
export type ToolEntry = z.infer<typeof ToolEntry>;
export type Tools = Record<string, ToolEntry>;

/** What a tool does, in the order the verbs are listed. */
export const verbsOf = (t: ToolEntry) =>
  [
    t.look.length ? "look" : undefined,
    t.act.length ? "act" : undefined,
    t.in ? "in" : undefined,
  ].filter((v): v is string => Boolean(v));

/** A chat channel: you and Shipify talk through it, by the door. */
export const isChannel = (t: ToolEntry) => Boolean(t.in);

/** A zod issue in plain words: "keys.NOTION_TOKEN: …". */
export const plainIssue = (i: { path: PropertyKey[]; message: string }) =>
  `${i.path.length ? `${i.path.map(String).join(".")}: ` : ""}${i.message}`;

/**
 * A plug-in file (tools.json, executors.json) read entry by entry: the good entries, and a plain
 * line for each one that's wrong (which is then left out). An optional top-level "version" up to
 * `supported` is taken; a newer one is a problem, and nothing is read from it.
 */
export function loadPluginFile<T>(
  file: string,
  raw: unknown,
  entry: z.ZodType<T>,
  supported: number,
  names: { rule: RegExp; says: string } = {
    rule: name,
    says: "lowercase letters, digits and _",
  },
): { entries: Record<string, T>; problems: string[]; broken: string[] } {
  const problems: string[] = [];
  const entries: Record<string, T> = {};
  const broken: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { entries, problems: [`${file}: not an object of entries`], broken };
  const { version, ...rest } = raw as Record<string, unknown>;
  if (version !== undefined && (typeof version !== "number" || version > supported))
    return {
      entries,
      problems: [
        `${file}: version ${String(version)} is newer than this Shipify reads (${supported}): update Shipify`,
      ],
      broken: Object.keys(rest),
    };
  for (const [key, value] of Object.entries(rest)) {
    if (!names.rule.test(key)) {
      problems.push(`${file}: "${key}" isn't a name (${names.says})`);
      broken.push(key);
      continue;
    }
    const r = entry.safeParse(value);
    if (r.success) entries[key] = r.data;
    else {
      problems.push(...r.error.issues.map((i) => `${file}: ${key}: ${plainIssue(i)}`));
      broken.push(key);
    }
  }
  return { entries, problems, broken };
}
