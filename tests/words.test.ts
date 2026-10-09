// The fixed words, defined once (cli/contracts/words.ts, ADR 0042 §8), and what every chat makes of
// them: the words a reply asks for, its buttons (§2), the door's own `close` and `reopen`. Every list
// a chat or the box reads is held here to the one definition.
import { describe, expect, it } from "vitest";
import {
  acceptedFrom,
  asked,
  CHAT_WORDS,
  GITHUB_WORDS,
  PICKER,
  REMINDER,
  type ReplyLine,
  replyButtons,
  WORDS,
  type Word,
  wordOf,
} from "../cli/contracts/index.ts";
import { WORDS as BOX_WORDS } from "../cli/kernel/words.ts";
import { turnOf } from "../edge/src/chat.ts";

const reply = (over: Partial<ReplyLine> = {}) =>
  ({
    v: 1,
    kind: "answer",
    state: "Done",
    title: "x",
    links: [],
    to: [],
    key: "k",
    ...over,
  }) as ReplyLine;

describe("the fixed words, defined once", () => {
  it("are the box's own, and every chat's list is made from them", () => {
    expect(BOX_WORDS).toBe(WORDS);
    for (const w of CHAT_WORDS) {
      const word = wordOf(w);
      expect(word, w).toBeDefined();
      expect(acceptedFrom(word as Word, false), w).toBe(true);
    }
    for (const w of GITHUB_WORDS) {
      expect(wordOf(w), w).toBe(w);
      expect(acceptedFrom(w as Word, false), w).toBe(false);
    }
    const all = new Set<string>([...CHAT_WORDS, ...GITHUB_WORDS]);
    for (const w of Object.keys(WORDS)) expect(all.has(w), w).toBe(true);
  });

  it("a reply asks for the ones it names in backticks, and nothing else", () => {
    expect(asked("Reply `continue` after 14:30, or `close` it. Say `yes` on GitHub.")).toEqual({
      say: ["continue", "close"],
      github: ["yes"],
    });
    expect(asked("Merge it, then say `Go`.")).toEqual({ say: [], github: ["go"] });
    expect(asked("Closed. Write again to carry it on, or say `reopen`.").say).toEqual(["reopen"]);
    expect(asked("Continue? `use opus high` or `pnpm ship go`")).toEqual({ say: [], github: [] });
  });

  it("the door acts on `close` and `reopen` alone, after a leading #n, as the box reads them", () => {
    const texts = ["close", "Close it.", "reopen this", "reopen!", " close ", "closed"];
    for (const text of [...texts, "close the PR", "reopen and fix it", "please close"]) {
      const word = wordOf(text);
      const core = word === "close" || word === "reopen" ? word : undefined;
      expect(turnOf(text, 12), text).toBe(core);
      expect(turnOf(`#12 ${text}`, 12), text).toBe(core);
    }
    expect(turnOf("#13 close", 12)).toBeUndefined();
  });
});

describe("a reply's buttons, one list for every chat", () => {
  it("are its quick answers, then the chat words it names: each the exact words, never GitHub's", () => {
    const r = reply({ kind: "needs-you", question: "Which colours?", choices: ["Teal", "My own"] });
    const b = replyButtons(r, "Reply `continue`, or say `yes` on GitHub, or `start over`.");
    expect(b.rows).toEqual([
      [
        { label: "Teal", words: "Teal" },
        { label: "My own", words: "My own" },
      ],
      [{ label: "Continue", words: "continue" }],
    ]);
    // A question always asks: a chat opens its reply box when none of its buttons fit.
    expect(b.asks).toBe(true);
    for (const row of b.rows) for (const x of row) expect(GITHUB_WORDS).not.toContain(x.words);
    // An agent's quick answer that is a word only GitHub takes is never a button: it stays text.
    const go = replyButtons(
      reply({ kind: "needs-you", question: "Ready?", choices: ["Go", "Preview first", "Yes"] }),
      "",
    );
    expect(go.rows.flat().map((x) => x.words)).toEqual(["Preview first"]);
  });

  it("opens the reply box on a question with no quick answers; an answer, a reminder never", () => {
    expect(replyButtons(reply({ kind: "needs-you", question: "Which one?" }), "").asks).toBe(true);
    expect(replyButtons(reply(), "Done.").asks).toBe(false);
    expect(replyButtons(reply({ state: REMINDER }), "take vitamin D").asks).toBe(false);
  });

  it("offers Another model on a failure, and Stop repeating under a reminder", () => {
    const failed = replyButtons(reply({ kind: "failed", state: "Failed" }), "Reply `continue`.");
    expect(failed.rows).toEqual([
      [
        { label: "Continue", words: "continue" },
        { label: "Another model", words: PICKER },
      ],
    ]);
    expect(replyButtons(reply({ state: REMINDER }), "take vitamin D").rows).toEqual([
      [{ label: "Stop repeating", words: "stop repeating" }],
    ]);
    // Named already, it's there once.
    const named = replyButtons(reply({ state: REMINDER }), "Say `stop repeating` to end it.");
    expect(named.rows.flat()).toHaveLength(1);
  });

  it("shows no quick answers without their question", () => {
    expect(replyButtons(reply({ choices: ["a"] }), "").rows).toEqual([]);
  });
});
