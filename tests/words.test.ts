// The fixed words, defined once (cli/contracts/words.ts, ADR 0042 §8), and what every chat makes of
// them: the words a reply asks for, its buttons (§2), the door's own `close` and `reopen`. Every list
// a chat or the box reads is held here to the one definition.
import { describe, expect, it } from "vitest";
import {
  asked,
  CHAT_WORDS,
  PICKER,
  REMINDER,
  type ReplyLine,
  replyButtons,
  WORDS,
  wordOf,
  listCodeOf,
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
  it("are the box's own, and every chat's list is made from them: one list, the same everywhere", () => {
    expect(BOX_WORDS).toBe(WORDS);
    for (const w of CHAT_WORDS) expect(wordOf(w), w).toBeDefined();
    for (const w of Object.keys(WORDS)) expect(CHAT_WORDS, w).toContain(w);
    // No word is GitHub's alone (ADR 0049, 2026-10-18): only a PR's merge is.
    for (const d of Object.values(WORDS)) expect(Object.keys(d).sort()).not.toContain("where");
  });

  it("a reply asks for the ones it names in backticks, and nothing else", () => {
    expect(asked("Reply `continue` after 14:30, or `close` it. Say `start over`.")).toEqual([
      "continue",
      "start over",
      "close",
    ]);
    // A list's `yes` and `no` are said from anywhere, but only its own buttons send them.
    expect(asked("Say `yes` or `no` to the list.")).toEqual([]);
    expect(asked("Merge it, then say `Go`.")).toEqual(["go"]);
    expect(asked("Then say `preview`.")).toEqual(["preview"]);
    expect(asked("Closed. Write again to carry it on, or say `reopen`.")).toEqual(["reopen"]);
    expect(asked("Continue? `use opus high` or `pnpm ship go`")).toEqual([]);
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

  it("`yes` is a chat word too (ADR 0049), alone or with the code of the list it approves", () => {
    expect(CHAT_WORDS).toContain("yes");
    for (const text of ["yes", "Yes.", "yes 1a2b3c4d", " YES 1A2B3C4D! "])
      expect(wordOf(text), text).toBe("yes");
    expect(listCodeOf("yes")).toBeUndefined();
    expect(listCodeOf("Yes 1A2B3C4D")).toBe("1a2b3c4d");
    expect(listCodeOf("no 1a2b3c4d")).toBe("1a2b3c4d");
    for (const text of ["yes please", "yes 1a2b", "yes 1a2b3c4d5", "yes, 1a2b3c4d"])
      expect(wordOf(text), text).toBeUndefined();
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
      [
        { label: "Continue", words: "continue" },
        { label: "Start over", words: "start over" },
      ],
    ]);
    // A question always asks: a chat opens its reply box when none of its buttons fit.
    expect(b.asks).toBe(true);
    // Every fixed word is a button where the agent offers it, as it works from a chat too. Never a
    // "Yes" or a "No": tapped later, it would answer a list.
    const go = replyButtons(
      reply({ kind: "needs-you", question: "Ready?", choices: ["Preview", "Go", "Yes"] }),
      "",
    );
    expect(go.rows.flat().map((x) => x.words)).toEqual(["Preview", "Go"]);
    const no = replyButtons(reply({ kind: "needs-you", question: "Sure?", choices: ["No"] }), "");
    expect(no.rows).toEqual([]);
  });

  it("under a list, only its Yes (naming its code) and No: never the agent's or its words' (ADR 0049)", () => {
    const listed = reply({
      kind: "needs-you",
      state: "Needs you",
      question: "Shall I make it?",
      choices: ["Yes, I'll comment it on GitHub", "No, drop it"],
      list: "1a2b3c4d",
    });
    const b = replyButtons(listed, "Reply `continue`, or `close` it. Say `yes`.");
    expect(b.rows).toEqual([
      [
        { label: "Yes", words: "yes 1a2b3c4d" },
        { label: "No", words: "no 1a2b3c4d" },
      ],
    ]);
    // One only GitHub takes: no buttons at all; its reply says where.
    expect(replyButtons({ ...listed, list: "github" }, "").rows).toEqual([]);
    // A `yes` in backticks with no list is no button.
    expect(replyButtons(reply(), "Say `yes` or `no`.").rows).toEqual([]);
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
