// Your assistant (ADR 0078): a Personality you set by saying so or from Setup's menu, read first
// and never twice; a guest's memory, theirs alone; a run's `notes`, `forget` and `personality`
// under one rule; next steps as buttons; and a plain answer that keeps no handoff.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  forgetFor,
  readGuestMemory,
  rememberFor,
  setPersonality,
} from "../cli/commands/task/notebook.ts";
import {
  beforeOf,
  DEFAULT_VOICE,
  PERSONALITY_MAX,
  PRESETS,
  personalityWord,
  undoneVoice,
  voiceOf,
  withVoice,
} from "../cli/contracts/index.ts";
import { buildPrompt, type PromptInput } from "../cli/kernel/prompt.ts";
import {
  GUEST_MEMORY_MAX,
  guestMemory,
  memoryPage,
  memoryParts,
  librarySections,
} from "../cli/lib/notebook.ts";
import { newState, parseTitle, type TaskState } from "../cli/lib/task.ts";
import { fakeGh } from "./fixtures/fakes.ts";

const ROOT = join(import.meta.dirname, "..");
const GUEST = "guest-ana-3f9a2c";

const input = (over: Partial<PromptInput> = {}): PromptInput => ({
  repo: "o/shipify",
  n: 12,
  title: "hii",
  body: "",
  parsed: parseTitle("hii"),
  why: "new",
  profile: "talk",
  state: newState() as TaskState,
  conversation: [],
  paths: {
    work: "/w",
    files: "/in/files",
    out: "/out",
    result: "/out/result.json",
    shipify: "/s",
    ship: "node /s/cli/dist/ship.mjs",
    read: "/r",
  },
  notes: [],
  playbook: readFileSync(join(ROOT, "playbooks", "task.md"), "utf8"),
  ...over,
});

describe("the word `personality: …`", () => {
  it("takes a preset by its name, your own words whole, the Default or the last words back", () => {
    expect(personalityWord("personality: friendly")).toEqual({ set: PRESETS[1]?.words });
    expect(personalityWord("Personality: Candid.")).toEqual({ set: PRESETS[2]?.words });
    // A preset's name with more words is your words, whole.
    expect(personalityWord("personality: friendly, and call me Aayush")).toEqual({
      set: "friendly, and call me Aayush",
    });
    expect(personalityWord("personality: short answers\nno emojis")).toEqual({
      set: "short answers\nno emojis",
    });
    expect(personalityWord("personality: default")).toEqual({ default: true });
    expect(personalityWord("personality: undo")).toEqual({ undo: true });
    // No words, or more than a page holds: not the word, so they're words for the agent.
    expect(personalityWord("personality:")).toBeUndefined();
    expect(personalityWord(`personality: ${"x".repeat(PERSONALITY_MAX + 1)}`)).toBeUndefined();
    expect(personalityWord("what's your personality?")).toBeUndefined();
    expect(parseTitle("personality: quirky")).toEqual({ kind: "personality", ask: "quirky" });
  });

  it("keeps the page's last words under Before; undo puts them back, and a second undo the newer", () => {
    const one = withVoice("", "Short answers.");
    expect(one).toBe("Short answers.\n");
    expect(undoneVoice(one)).toBeUndefined();
    const two = withVoice(one, "Be blunt.");
    expect(voiceOf(two)).toBe("Be blunt.");
    expect(beforeOf(two)).toBe("Short answers.");
    const back = undoneVoice(two) as string;
    expect(voiceOf(back)).toBe("Short answers.");
    expect(voiceOf(undoneVoice(back) as string)).toBe("Be blunt.");
    // A line added with `remember Personality: …` is part of its words; Before never is.
    expect(voiceOf(`${two}- no emojis (2026-11-14)\n`)).toBe(
      "Be blunt.\n\n- no emojis (2026-11-14)",
    );
  });
});

describe("the prompt's voice (ADR 0078 section 13)", () => {
  // The line the Default's words took the place of.
  const BEFORE =
    "Be brief and direct, say what you're unsure of, and state a limit plainly rather than work\naround it. The owner's words, then their notebook's notes on tone, win over this.";

  it("speaks in the Default's words with no page, in no more than the line it took the place of", () => {
    const p = buildPrompt(input());
    const line = p.split("\n").find((l) => l.startsWith(DEFAULT_VOICE)) ?? "";
    expect(line).toContain("Say what you're unsure of");
    expect(line.length).toBeLessThanOrEqual(BEFORE.length);
    expect(p.indexOf(DEFAULT_VOICE)).toBeLessThan(p.indexOf("# Task #12"));
  });

  it("puts your Personality page first, says when it's cut, and the notebook never holds it too", () => {
    const words = "Friendly and short. Call me Aayush.";
    const p = buildPrompt(input({ personality: { words, cut: false } }));
    expect(p.indexOf(words)).toBeLessThan(p.indexOf("# Task #12"));
    expect(p).toContain("How you speak, in the owner's own words (their Personality page):");
    expect(p).toContain("Whatever the voice, say what you're unsure of");
    expect(p).not.toContain(DEFAULT_VOICE);
    const cut = buildPrompt(input({ personality: { words, cut: true } }));
    expect(cut).toContain(`cut at ${PERSONALITY_MAX.toLocaleString("en")} characters`);
    // think.ts gives the notebook's section the pages without it: once in the prompt.
    const pages = [
      { number: 1, topic: "Preferences", body: "- bullets (2026-11-14)" },
      { number: 2, topic: "People", body: "- Priya designs (2026-11-14)" },
    ];
    const notebook = librarySections(pages, { canWrite: true }).notebook;
    expect(
      buildPrompt(input({ personality: { words, cut: false }, notebook })).split(words),
    ).toHaveLength(2);
  });

  it("asks for a handoff only when the work goes on, and lists no past chats", () => {
    const plain = buildPrompt(input());
    expect(plain).toContain("A plain answer writes none.");
    expect(plain).not.toContain("Bring `/out/handoff.md` up to date first");
    // Work going on (a Progress there): the handoff as before.
    const going = buildPrompt(
      input({ state: { ...newState(), notes: "## Goal\n- x" } as TaskState }),
    );
    expect(going).toContain("Bring `/out/handoff.md` up to date first");
    // Past chats are fetched when needed, never added (section 4).
    expect(plain).not.toMatch(/your (?:newest|recent) chats/i);
    expect(plain).toContain("recall");
  });
});

describe("a guest's memory (ADR 0078 section 6)", () => {
  it("keeps their Personality first and their notes after, cut to the page's cap", () => {
    const body = memoryPage({
      voice: withVoice("", "Gentle, and in Hindi."),
      notes: "- tea (2026-11-14)",
    });
    expect(memoryParts(body)).toEqual({
      voice: "Gentle, and in Hindi.",
      notes: "- tea (2026-11-14)",
    });
    expect(guestMemory(body)).toEqual({
      voice: "Gentle, and in Hindi.",
      notes: "- tea (2026-11-14)",
      cut: false,
    });
    const long = guestMemory(
      memoryPage({ voice: "x", notes: `- ${"y".repeat(GUEST_MEMORY_MAX)}` }),
    );
    expect(long.cut).toBe(true);
    expect(long.voice.length + long.notes.length).toBeLessThanOrEqual(GUEST_MEMORY_MAX);
  });

  it("gives their run their memory and its own words, and nothing of yours", () => {
    const p = buildPrompt(
      input({
        profile: "guest",
        personality: { words: "Gentle.", cut: false },
        guestMemory: "- tea (2026-11-14)",
        playbook: readFileSync(join(ROOT, "playbooks", "guest.md"), "utf8"),
      }),
    );
    expect(p).toContain("How you speak, in the guest's own words");
    expect(p).toContain("## Their memory");
    expect(p).toContain("- tea (2026-11-14)");
    expect(p).not.toContain("## The notebook");
  });
});

describe("the box writes them (a fake GitHub)", () => {
  const withGh = <T>(fn: () => T): T => {
    const saved = { ...process.env };
    try {
      const g = fakeGh();
      Object.assign(process.env, g.env, { GITHUB_REPOSITORY: "o/shipify" });
      delete process.env.SHIPIFY_ISSUES_TOKEN;
      return fn();
    } finally {
      process.env = saved;
    }
  };

  it("sets your Personality, keeps the last words, changes it back, and closes it for the Default", () =>
    withGh(() => {
      expect(setPersonality({ undo: true })).toEqual([
        "Nothing to change back: your Personality keeps no earlier words.",
      ]);
      expect(setPersonality({ set: PRESETS[1]?.words ?? "" })[0]).toMatch(
        /^Personality: Friendly: “Warm and encouraging.*”\. Every chat from now on talks this way\. https:\/\/github\.com\/o\/shipify\/issues\/\d+$/,
      );
      expect(setPersonality({ set: "Be blunt." })[0]).toContain("Personality updated: “Be blunt.”");
      expect(setPersonality({ undo: true })[0]).toContain(
        "Personality changed back: “Warm and encouraging",
      );
      expect(setPersonality({ default: true })[0]).toContain(
        "back to the Default, so its page is closed",
      );
      expect(setPersonality({ default: true })).toEqual([
        "Your Personality is the Default already.",
      ]);
      // Its words come back from the closed page.
      expect(setPersonality({ undo: true })[0]).toContain(
        "Personality changed back: “Warm and encouraging",
      );
      // Never a key, and never what you can't see.
      expect(setPersonality({ set: `token ghp_${"a".repeat(36)}` })[0]).toContain(
        "looks like a key or a password",
      );
    }));

  it("writes a guest's notes, forgets and personality on their own page, made when first needed", () =>
    withGh(() => {
      expect(readGuestMemory(GUEST)).toEqual({});
      expect(rememberFor(GUEST, ["Likes tea"])).toEqual([
        "Noted: Likes tea. Your chats from now on know it.",
      ]);
      expect(rememberFor(GUEST, ["Likes tea"])).toEqual(["Already noted: Likes tea"]);
      expect(setPersonality({ set: "Gentle." }, GUEST)[0]).toContain(
        "Your personality is updated: “Gentle.”",
      );
      const { page } = readGuestMemory(GUEST);
      expect(page?.topic).toBe("g3f9a2c memory");
      expect(guestMemory(page?.body ?? "")).toMatchObject({ voice: "Gentle." });
      expect(guestMemory(page?.body ?? "").notes).toMatch(/^- Likes tea \(\d{4}-\d{2}-\d{2}\)$/);
      expect(forgetFor(GUEST, "tea")).toEqual(["Forgot: Likes tea."]);
      expect(forgetFor(GUEST, "tea")).toEqual(["Nothing in your memory says “tea”."]);
      // Yours never reads it.
      expect(setPersonality({ undo: true })).toEqual([
        "Nothing to change back: your Personality keeps no earlier words.",
      ]);
    }));
});
