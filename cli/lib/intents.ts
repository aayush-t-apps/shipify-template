// What anyone can ask (ADR 0030 §1), defined once in intents.json: each intent's words, its form,
// its chat command and what it starts, and how to use a chat. The title parser reads its prefixes
// from here, a chat's menu is made from it, and tests hold the forms, the help and docs/tasks.md to
// it. The words a task understands are cli/contracts/words.ts'.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PLATFORM_ROOT } from "./config.ts";

export const INTENTS_VERSION = 1;

export const Intent = z.object({
  /** One line: the form's description, a chat's help. */
  says: z.string().min(1).max(100),
  /** The titles that mean it: `new: …`, `<project>: …`, `ask: …`. */
  words: z.array(z.string().min(1)).min(1),
  /** Its chat command (`/new`): a channel's menu. None: it isn't asked from a chat. */
  chat: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .optional(),
  /** Its issue form's file name, less `.yml`. */
  form: z
    .string()
    .regex(/^\d+-[a-z]+$/)
    .optional(),
  /** What it starts. */
  starts: z.enum(["task", "repeat", "remember", "operate"]),
});
export type Intent = z.infer<typeof Intent>;

export const Intents = z.object({
  version: z.literal(INTENTS_VERSION),
  intents: z.record(z.string().regex(/^[a-z]+$/), Intent),
  /**
   * How to use a chat with Shipify, the same for every chat channel: its one line (a start screen's
   * short text), its few lines (the start screen, and `/help` before the command list), and what
   * you'd type, each with what it does (`/help`'s examples).
   */
  help: z.object({
    short: z.string().min(1).max(120),
    guide: z.array(z.string().min(1).max(160)).min(1).max(8),
    examples: z.array(z.tuple([z.string().min(1).max(60), z.string().min(1).max(120)])).max(8),
  }),
});
export type Intents = z.infer<typeof Intents>;

let cached: Intents | undefined;

/** intents.json, checked once. A file that doesn't fit is an error for every caller, named. */
export function loadIntents(file = join(PLATFORM_ROOT, "intents.json")): Intents {
  if (cached && file === join(PLATFORM_ROOT, "intents.json")) return cached;
  const parsed = Intents.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success)
    throw new Error(
      `intents.json doesn't fit its shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  if (file === join(PLATFORM_ROOT, "intents.json")) cached = parsed.data;
  return parsed.data;
}

/** A word's fixed first word, before its colon: `new: …` → `new`; `<project>: …` → none. */
const prefixOf = (w: string) => /^([a-z]+)\s*:/.exec(w)?.[1];

/** A title's first word (`new`, `ask`, `do`), as the catalog names it, and its intent. */
export function intentOfWord(word: string, intents = loadIntents()): string | undefined {
  const w = word.toLowerCase();
  return Object.entries(intents.intents).find(([, i]) =>
    i.words.some((x) => prefixOf(x) === w),
  )?.[0];
}
