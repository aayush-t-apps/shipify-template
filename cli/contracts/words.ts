// The fixed words (ADR 0031, ADR 0042 §8), defined once for the box, the door and every chat: whole
// comments the box reads with no agent. One flow, any channel (ADR 0049, 2026-10-18): each works the
// same from GitHub or a chat; the one approval only GitHub gives is a PR's merge. The agent never
// decides whether one was said. `use <model>` is read by use.ts, the one grammar the door reads
// too. A reply's buttons (§2) are made here, once, for every chat: each is exactly words you could
// type. `yes` and `no` are a list's (ADR 0049): only its own Yes and No send them.
import type { ReplyLine } from "./lines.ts";

export interface FixedWord {
  re: RegExp;
  /** What it does, for docs/tasks.md and the status comment's help. */
  does: string;
  /** Another way to say it, which a reply may name (`again` for `continue`). */
  also?: string[];
}

export const WORDS = {
  yes: {
    re: /^\s*yes(\s+[0-9a-f]{8})?[.!]?\s*$/i,
    does: "approve exactly the listed calls (whole message, unedited, within a day); a list's Yes sends `yes <its code>`",
  },
  no: {
    re: /^\s*no(\s+[0-9a-f]{8})?[.!]?\s*$/i,
    does: "drop the listed calls; a list's No sends `no <its code>`",
  },
  continue: {
    re: /^\s*(continue|(run\s+)?again)[.!]?\s*$/i,
    does: "try again after a failure, or run an operation again",
    also: ["again"],
  },
  "start over": {
    re: /^\s*start\s+over\b[.!]?\s*$/i,
    does: "close the open PR and begin again from the repo's default branch",
  },
  preview: {
    re: /^\s*preview(\s+please)?[.!]?\s*$/i,
    does: "a live preview link for the open PR",
  },
  publish: {
    re: /^\s*publish[.!]?\s*$/i,
    does: "build and publish a merged plan (again, after it stopped)",
  },
  go: {
    re: /^\s*go[.!]?\s*$/i,
    does: "build a big change after its doc merged, or a new project after its plan merged",
  },
  "stop repeating": {
    re: /^\s*stop\s+repeating[.!]?\s*$/i,
    does: "end a repeat",
  },
  resume: { re: /^\s*resume[.!]?\s*$/i, does: "start a paused repeat again" },
  close: {
    re: /^\s*close(\s+(it|this))?[.!]?\s*$/i,
    does: "close the task (its PRs stay; write again to reopen it)",
  },
  reopen: {
    re: /^\s*reopen(\s+(it|this))?[.!]?\s*$/i,
    does: "reopen a closed task with no agent, to say what's next",
  },
  stop: {
    re: /^\s*stop(\s+(it|this|now))?[.!]?\s*$/i,
    does: "stop the run that's going, within a minute; its commits stay on the task's branch",
  },
} as const satisfies Record<string, FixedWord>;

export type Word = keyof typeof WORDS;

/** The fixed word a comment is, if it's exactly one. */
export function wordOf(text: string): Word | undefined {
  for (const [w, d] of Object.entries(WORDS)) if (d.re.test(text)) return w as Word;
  return undefined;
}

/** A list's own words: its Yes and No send them, and nothing else is a button for them. */
const LIST_WORDS: Word[] = ["yes", "no"];
/** The list a `yes <code>` or a `no <code>` names (its Yes or No button's words), or none for a
 * plain `yes` or `no`. */
export const listCodeOf = (text: string) =>
  (WORDS.yes.re.exec(text) ?? WORDS.no.re.exec(text))?.[1]?.trim().toLowerCase() || undefined;

const entries = Object.entries(WORDS) as [Word, FixedWord][];
/** Every fixed word as a button sends it, with its other ways. */
export const CHAT_WORDS: string[] = entries.flatMap(([w, d]) => [w, ...(d.also ?? [])]);

/**
 * The fixed words a reply's markdown names in backticks, in the order of the list: never a list's
 * `yes` or `no`, which only its own buttons send.
 */
export function asked(md: string): string[] {
  const named = new Set([...md.matchAll(/`([a-z ]{2,20})`/gi)].map((m) => m[1]?.toLowerCase()));
  return CHAT_WORDS.filter((w) => named.has(w) && !LIST_WORDS.includes(w as Word));
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
 * fixed words its words name, Another model on a failure, and Stop repeating under a reminder. A
 * question with no quick answers opens the reply box (`asks`) instead; with them, a tap replies.
 * Nothing else opens it. Under a list (ADR 0049) only its Yes (`yes <code>`, so it approves that
 * list alone) and No: none for a list too long for a chat to show whole, approved on GitHub.
 */
export function replyButtons(
  r: Pick<ReplyLine, "kind" | "state" | "question" | "choices" | "list">,
  md: string,
): { rows: Button[][]; asks: boolean } {
  const asks = Boolean(r.question);
  if (r.list)
    return {
      rows:
        r.list === "github" ? [] : [[button(`yes ${r.list}`, "Yes"), button(`no ${r.list}`, "No")]],
      asks,
    };
  // A quick answer "Yes" or "No" stays text: tapped later, it would answer a list.
  const answers = r.question
    ? (r.choices ?? [])
        .filter((c) => {
          const w = wordOf(c);
          return !w || !LIST_WORDS.includes(w);
        })
        .map((c) => button(c, c))
    : [];
  const words = asked(md).map((w) => button(w));
  if (r.kind === "failed") words.push(button(PICKER, "Another model"));
  if (r.state === REMINDER && !words.some((b) => b.words === "stop repeating"))
    words.push(button("stop repeating"));
  return {
    rows: [answers, words].filter((row) => row.length),
    // A question always asks: a chat opens its reply box on it when none of its buttons fit.
    asks,
  };
}
