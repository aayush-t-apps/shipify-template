// What anyone can ask, defined once (ADR 0030 §1): intents.json, held here to the forms, the
// blank-issue word list, the title parser, the commands a task understands and docs/tasks.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  chatMenu,
  helpGuide,
  helpText,
  pickSaid,
  useCommand,
  WORDS,
} from "../cli/contracts/index.ts";
import { loadForms } from "../cli/lib/form-reader.ts";
import { intentOfWord, loadIntents } from "../cli/lib/intents.ts";
import { parseTask, parseTitle, type TaskTitle } from "../cli/lib/task.ts";
import { ROOT } from "./helpers.ts";

const intents = loadIntents();
const dir = join(ROOT, ".github", "ISSUE_TEMPLATE");
const form = (id: string) =>
  YAML.parse(readFileSync(join(dir, `${id}.yml`), "utf8")) as {
    description?: string;
    title?: string;
  };
/** What each intent reads as: the parser's kind. */
const KIND: Record<string, TaskTitle["kind"]> = {
  question: "question",
  change: "app",
  new: "new",
  remember: "remember",
  repeat: "none",
  operate: "op",
};
/** Words that are a description, not a prefix: anything with no first word reads as plain words. */
const DESCRIBED: Record<string, TaskTitle["kind"]> = {
  "anything else": "none",
  // A phrase read in any message (ADR 0044), not a title's first word: the words around it decide.
  "look at <repo> …": "none",
  // remember's other half: a note taken off, with no agent either (ADR 0032).
  "forget: …": "forget",
};
/** A word as someone would type it. */
const typed = (w: string) =>
  w
    .replace("<account>/<repo>", "acme/api")
    .replace("<project or repo>", "spotter")
    .replace("<project>", "spotter")
    .replace("<repo>", "acme/tool")
    .replace("<app>", "spotter")
    .replace("<topic>", "People")
    .replace("…", "bigger cards");

describe("intents.json: what anyone can ask, written once", () => {
  it("names each kind the parser knows, once", () => {
    expect(Object.keys(intents.intents).sort()).toEqual(Object.keys(KIND).sort());
  });

  it.each(Object.entries(intents.intents))("%s: each of its words reads as it", (name, i) => {
    for (const w of i.words) expect(parseTitle(typed(w)).kind, w).toBe(DESCRIBED[w] ?? KIND[name]);
  });

  it("every title prefix the parser takes is a word here", () => {
    for (const p of ["new", "question", "ask", "repeat", "do"])
      expect(intentOfWord(p), p).toBeDefined();
    expect(intentOfWord("spotter")).toBeUndefined();
  });

  it("each form is an intent's, with its line as the form's description and its title's word", () => {
    const files = readdirSync(dir)
      .filter((f) => /^\d+-.+\.yml$/.test(f))
      .map((f) => f.replace(/\.yml$/, ""));
    const named = Object.values(intents.intents).flatMap((i) => (i.form ? [i.form] : []));
    expect(named.sort()).toEqual(files.sort());
    const forms = loadForms(dir);
    for (const [name, i] of Object.entries(intents.intents)) {
      if (!i.form) continue;
      const f = form(i.form);
      expect(f.description, name).toBe(i.says);
      // A form's title, when it has one, is the intent's first word: what it files reads as it.
      if (f.title) {
        expect(
          i.words.map((w) => w.replace(/…$/, "").trim()),
          name,
        ).toContain(f.title.trim());
        const title = /:\s*$/.test(f.title) ? `${f.title}x` : f.title;
        expect(parseTask(title, null, forms).kind, name).toBe(KIND[name]);
      }
    }
  });

  it("the blank-issue word list (config.yml) is the catalog's words", () => {
    const listed = readFileSync(join(dir, "config.yml"), "utf8")
      .split("\n")
      .flatMap((l) => /^#\s{3}(\S.*?)\s{2,}/.exec(l)?.[1] ?? [])
      .flatMap((l) => l.split(" / "))
      .map((w) => w.trim());
    const words = Object.values(intents.intents)
      .flatMap((i) => i.words)
      .filter((w) => !/<topic>/.test(w));
    expect(listed.sort()).toEqual(words.sort());
  });

  it("docs/tasks.md's title table names each word's first word", () => {
    const docs = readFileSync(join(ROOT, "docs/tasks.md"), "utf8");
    for (const w of Object.values(intents.intents).flatMap((i) => i.words)) {
      const first = /^([a-z]+)\s*:/.exec(w)?.[1];
      if (first) expect(docs, w).toContain(`\`${first}:`);
    }
  });

  it("/help and the chat's table say every word, the same everywhere, as WORDS does", () => {
    const anywhere = [...Object.keys(WORDS), "use <model>"].sort();
    // Made from the one list, never typed twice.
    const line = helpGuide().find((l) => l.startsWith("Words on a task")) ?? "";
    const [, here = ""] =
      /^Words on a task, the same from GitHub or a chat: (.*)\. Only on GitHub: a PR's merge, and taking an app down, bringing it back or rolling it back\.$/.exec(
        line,
      ) ?? [];
    const words = (l: string) =>
      l
        .split(",")
        .map((w) => w.trim())
        .sort();
    expect(words(here)).toEqual(anywhere);
    const chat = readFileSync(join(ROOT, "docs/channels.md"), "utf8");
    const row = chat.split("\n").find((l) => l.includes("a reply that's a fixed word")) ?? "";
    expect(
      [...row.matchAll(/`([^`]+)`/g)]
        .map((m) => m[1])
        .filter((w) => w !== "ok")
        .sort(),
    ).toEqual(anywhere);
    // No line said twice (the blank lines between its parts aside).
    const lines = helpText().split("\n").filter(Boolean);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("docs/tasks.md lists every word a task understands", () => {
    const docs = readFileSync(join(ROOT, "docs/tasks.md"), "utf8");
    for (const r of [...Object.keys(WORDS), "use <model>"]) expect(docs, r).toContain(`\`${r}\``);
  });

  it("a chat's guide, once for every chat channel: short, and says how to start and carry on", () => {
    const { short } = intents.help;
    expect(short.length).toBeLessThanOrEqual(120);
    // Telegram's description takes 512 characters: the guide fits, as one block.
    expect(chatMenu().description.length).toBeLessThanOrEqual(512);
    const text = helpGuide().join(" ");
    expect(text).toMatch(/reply to any of its messages/);
    expect(text).toMatch(/#\d+ alone/);
    expect(text).toMatch(/GitHub/);
    for (const own of chatMenu().commands) expect(text).toContain(`/${own.command}`);
  });

  it("/help's examples are read as they say: each `use` a pick the grammar takes, each #12 a task", () => {
    const examples = intents.help.examples as [string, string][];
    expect(examples.length).toBeGreaterThan(0);
    for (const [typed, does] of examples) {
      expect(helpText()).toContain(`${typed} → ${does}`);
      const rest = typed.replace(/^#\d+\s*/, "");
      if (/^#\d+/.test(typed)) expect(does, typed).toMatch(/task \d+/);
      const pick = useCommand(rest);
      if (pick) expect(pickSaid(pick), typed).toBeDefined();
    }
  });

  it("a chat's menu is the four (ADR 0042): a new task, your tasks, the model, help; /help lists every command", () => {
    expect(chatMenu().commands.map((c) => c.command)).toEqual(["ask", "tasks", "use", "help"]);
    for (const c of chatMenu().commands) expect(c.description.trim()).not.toBe("");
    for (const i of Object.values(intents.intents))
      if (i.chat) expect(helpText()).toContain(`/${i.chat}:`);
    for (const own of [
      "/tasks:",
      "/use:",
      "/ping:",
      "/apps:",
      "/notebook:",
      "/recipes:",
      "/models:",
    ])
      expect(helpText()).toContain(own);
  });

  it("chat commands are unique, and operations have none (a task's title says one)", () => {
    const chats = Object.values(intents.intents).flatMap((i) => (i.chat ? [i.chat] : []));
    expect(new Set(chats).size).toBe(chats.length);
    expect(intents.intents.operate?.chat).toBeUndefined();
  });
});
