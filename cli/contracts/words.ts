// The fixed words (ADR 0031, ADR 0042 §8), defined once for the box, the door and every chat: whole
// comments the box reads with no agent. Each says where it's accepted: anywhere (GitHub or a chat),
// or GitHub only, where your own account says it. The agent never decides whether one was said.
// `use <model>` is read by use.ts, the one grammar the door reads too. A reply's buttons (§2) are
// made here, once, for every chat: each is exactly words you could type.
import type { ReplyLine } from "./lines.ts";

export type Where = "anywhere" | "github";

export interface FixedWord {
  re: RegExp;
  where: Where;
  /** What it does, for docs/tasks.md and the status comment's help. */
  does: string;
  /** Another way to say it, which a reply may name (`again` for `continue`). */
  also?: string[];
}

export const WORDS = {
  yes: {
    re: /^\s*yes[.!]?\s*$/i,
    where: "github",
    does: "approve exactly the listed calls (whole comment, unedited, within a day)",
  },
  no: { re: /^\s*no[.!]?\s*$/i, where: "anywhere", does: "drop the listed calls" },
  continue: {
    re: /^\s*(continue|(run\s+)?again)[.!]?\s*$/i,
    where: "anywhere",
    does: "try again after a failure, or run an operation again",
    also: ["again"],
  },
  "start over": {
    re: /^\s*start\s+over\b[.!]?\s*$/i,
    where: "github",
    does: "close the open PR and begin again from the repo's default branch",
  },
  preview: {
    re: /^\s*preview(\s+please)?[.!]?\s*$/i,
    where: "github",
    does: "a live preview link for the open PR",
  },
  publish: {
    re: /^\s*publish[.!]?\s*$/i,
    where: "github",
    does: "build and publish a merged plan again",
  },
  go: { re: /^\s*go[.!]?\s*$/i, where: "github", does: "build a big change after its doc merged" },
  "stop repeating": {
    re: /^\s*stop\s+repeating[.!]?\s*$/i,
    where: "anywhere",
    does: "end a repeat",
  },
  resume: { re: /^\s*resume[.!]?\s*$/i, where: "anywhere", does: "start a paused repeat again" },
  close: {
    re: /^\s*close(\s+(it|this))?[.!]?\s*$/i,
    where: "anywhere",
    does: "close the task (its PRs stay; write again to reopen it)",
  },
  reopen: {
    re: /^\s*reopen(\s+(it|this))?[.!]?\s*$/i,
    where: "anywhere",
    does: "reopen a closed task with no agent, to say what's next",
  },
  stop: {
    re: /^\s*stop(\s+(it|this|now))?[.!]?\s*$/i,
    where: "anywhere",
    does: "stop the run that's going, within a minute; its commits stay on the task's branch",
  },
} as const satisfies Record<string, FixedWord>;

export type Word = keyof typeof WORDS;

/** The fixed word a comment is, if it's exactly one. */
export function wordOf(text: string): Word | undefined {
  for (const [w, d] of Object.entries(WORDS)) if (d.re.test(text)) return w as Word;
  return undefined;
}

/** Whether a word may be said from where it was said. */
export const acceptedFrom = (w: Word, fromGithub: boolean) =>
  WORDS[w].where === "anywhere" || fromGithub;

const entries = Object.entries(WORDS) as [Word, FixedWord][];
/** Words a chat may say, as a button sends them: each taken anywhere, and its other ways. */
export const CHAT_WORDS: string[] = entries.flatMap(([w, d]) =>
  d.where === "anywhere" ? [w, ...(d.also ?? [])] : [],
);
/** Words that count only on GitHub, from your own account: never a chat's button. */
export const GITHUB_WORDS: string[] = entries.flatMap(([w, d]) =>
  d.where === "github" ? [w] : [],
);

/** The fixed words a reply's markdown names in backticks, in the order of each list. */
export function asked(md: string): { say: string[]; github: string[] } {
  const named = new Set([...md.matchAll(/`([a-z ]{2,20})`/gi)].map((m) => m[1]?.toLowerCase()));
  return {
    say: CHAT_WORDS.filter((w) => named.has(w)),
    github: GITHUB_WORDS.filter((w) => named.has(w)),
  };
}

// ---------------------------------------------------------------- buttons (ADR 0042 §2)

/** A button: its label, and the exact words it sends for you, as if you'd typed them. */
export interface Button {
  label: string;
  words: string;
}

/** The words that show the model picker: in a chat at once, on GitHub from a run. */
export const PICKER = "/use";
/** `/use` alone (a chat may add the bot's name): the picker, or on GitHub the task's pick. */
export const pickerAsked = (text: string | null | undefined) =>
  /^\s*\/use(?:@\w+)?\s*$/i.test(text ?? "");
/** A reminder's reply's state: Stop repeating sits under it. */
export const REMINDER = "Reminder";

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const button = (words: string, label = title(words)): Button => ({ label, words });

/**
 * A reply's buttons, the same for every chat: the agent's quick answers to its question, then the
 * chat words its words name, Another model on a failure, and Stop repeating under a reminder.
 * GitHub-only words are never buttons. A question with no quick answers opens the reply box
 * (`asks`) instead; with them, a tap replies. Nothing else opens it.
 */
export function replyButtons(
  r: Pick<ReplyLine, "kind" | "state" | "question" | "choices">,
  md: string,
): { rows: Button[][]; asks: boolean } {
  // A quick answer that is a word only GitHub takes ("Go", "Yes" to a list) stays text: a tap of
  // it would be refused, not read as the answer.
  const answers = r.question
    ? (r.choices ?? [])
        .filter((c) => {
          const w = wordOf(c);
          return !w || WORDS[w].where !== "github";
        })
        .map((c) => button(c, c))
    : [];
  const words = asked(md).say.map((w) => button(w));
  if (r.kind === "failed") words.push(button(PICKER, "Another model"));
  if (r.state === REMINDER && !words.some((b) => b.words === "stop repeating"))
    words.push(button("stop repeating"));
  return {
    rows: [answers, words].filter((row) => row.length),
    // A question always asks: a chat opens its reply box on it when none of its buttons fit.
    asks: Boolean(r.question),
  };
}
