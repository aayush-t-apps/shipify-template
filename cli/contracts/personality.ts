// Your Personality (ADR 0078): how Shipify speaks to you, one page of your words, `Notebook:
// Personality`, read first by every run of yours. Five presets are starting words for it, in one
// list that the word, the run's `personality`, Setup's menu and Change it back all read. The page
// keeps its last words folded under "Before", which no prompt reads and `personality: undo` puts
// back. Pure: the core and the edge read these as they are.

/** The page's topic: its title is `Notebook: Personality`. */
export const PERSONALITY_TOPIC = "Personality";
/** The most of the page a prompt carries: a longer page is cut there, and the prompt says so. */
export const PERSONALITY_MAX = 2_000;

export interface Preset {
  id: string;
  name: string;
  words: string;
}

/** The presets, Default first: its words are a run's when there's no page. */
export const PRESETS: readonly Preset[] = [
  {
    id: "default",
    name: "Default",
    words: "Warm, plain and direct, like a capable friend. The answer first. Short unless asked.",
  },
  {
    id: "friendly",
    name: "Friendly",
    words: "Warm and encouraging, a little humour, conversational. My name now and then.",
  },
  {
    id: "candid",
    name: "Candid",
    words: "Blunt and honest. Push back when I'm wrong, risks first, no flattery.",
  },
  {
    id: "efficient",
    name: "Efficient",
    words: "Bare answers: the result first, bullets, no small talk, no recap.",
  },
  {
    id: "quirky",
    name: "Quirky",
    words: "Playful and curious, light jokes and the odd emoji; the facts stay exact.",
  },
];

/** The Default's words: how a run speaks with no page. */
export const DEFAULT_VOICE = (PRESETS[0] as Preset).words;

/** A preset by its name or id, whatever its case ("friendly", "Friendly."), or undefined. */
export const presetNamed = (words: string): Preset | undefined => {
  const w = words
    .trim()
    .replace(/[.!]+$/, "")
    .toLowerCase();
  return PRESETS.find((p) => p.id === w);
};

/** What `personality: …` asks: your words (a preset's, by its name), the Default, or the last words back. */
export type PersonalityWord = { set: string } | { default: true } | { undo: true };

/**
 * `personality: …` as a whole comment, a chat's or a task's title: `personality: friendly`,
 * `personality: your own words` (up to PERSONALITY_MAX, lines too), `personality: default` (the page
 * closes) or `personality: undo`. A preset's name with more words is your words, whole.
 */
export function personalityWord(text: string): PersonalityWord | undefined {
  const m = /^personality\s*:\s*([\s\S]*)$/i.exec(text.trim());
  if (!m) return undefined;
  const words = (m[1] ?? "").trim();
  if (!words || words.length > PERSONALITY_MAX) return undefined;
  if (/^undo\W*$/i.test(words)) return { undo: true };
  if (/^default\W*$/i.test(words)) return { default: true };
  return { set: presetNamed(words)?.words ?? words };
}

/** The Before block: the page's last words, folded, left out of every prompt. */
const BEFORE = /<details><summary>Before<\/summary>\s*([\s\S]*?)\s*<\/details>/;

/** A page's words as a run reads them: all but its Before block. */
export const voiceOf = (body: string) =>
  body
    .replace(BEFORE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The page's last words, kept under Before, or "". */
export const beforeOf = (body: string) => BEFORE.exec(body)?.[1]?.trim() ?? "";

/** A page with new words, its words until now kept under Before (none when it had none). */
export function withVoice(body: string, words: string): string {
  const was = voiceOf(body);
  const now = words.trim();
  return was && was !== now
    ? `${now}\n\n<details><summary>Before</summary>\n\n${was}\n\n</details>\n`
    : `${now}\n`;
}

/** The page with its Before words back, and the words it had under Before: undefined with none. */
export function undoneVoice(body: string): string | undefined {
  const before = beforeOf(body);
  return before ? withVoice(body, before) : undefined;
}

/** A preset's name when the words are exactly its words, for the menu and the reply. */
export const presetOf = (words: string): Preset | undefined =>
  PRESETS.find((p) => p.words === words.trim());
