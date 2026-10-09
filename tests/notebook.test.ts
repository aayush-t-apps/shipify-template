// The notebook, the pure parts (ADR 0027, cli/lib/notebook.ts): a page's topic and first line, a
// note added, what looks like a key, and what a round's prompt carries.
import { describe, expect, it } from "vitest";
import {
  dated,
  firstLine,
  hasHidden,
  linesWith,
  looksSecret,
  Note,
  notebookSection,
  noteWords,
  pagesFor,
  PROMPT_BUDGET,
  pageTitle,
  sameTopic,
  topicOf,
  withNote,
  withoutNote,
} from "../cli/lib/notebook.ts";

describe("the notebook: pages", () => {
  it("names a page by its topic, however the topic is written", () => {
    expect(pageTitle("preferences")).toBe("Notebook: Preferences");
    expect(topicOf("Notebook: About me")).toBe("About me");
    expect(topicOf("Notes: About me")).toBeUndefined();
    expect(sameTopic("about  me", "About me")).toBe(true);
  });

  it("adds a note as one line at the end, and reads a page's first line of substance", () => {
    expect(withNote("", "Dark mode")).toBe("- Dark mode\n");
    expect(withNote("- One\n\n", "Two,\nthree")).toBe("- One\n- Two, three\n");
    expect(firstLine("<!-- x -->\n# Title\n\n- Sonnet for questions\n- more")).toBe(
      "Sonnet for questions",
    );
  });

  it("knows a note that looks like a key, and what a note may be", () => {
    expect(looksSecret(`ghp_${"a".repeat(36)}`)).toBe(true);
    expect(looksSecret("API_TOKEN=abcdefghijklmnopqrstuv")).toBe(true);
    expect(looksSecret("Priya is my designer")).toBe(false);
    expect(Note.safeParse({ topic: "People", text: "Priya is my designer" }).success).toBe(true);
    expect(Note.safeParse({ topic: "<script>", text: "x" }).success).toBe(false);
    expect(Note.safeParse({ topic: "People", text: "x".repeat(501) }).success).toBe(false);
    // A repo's name is a topic too: that repo's own page (ADR 0047).
    for (const topic of ["notes-api", "acme/api", "my.site_v2"])
      expect(Note.safeParse({ topic, text: "run npm test before a PR" }).success, topic).toBe(true);
  });

  it("gives a repo's own page only to runs on that repo; on another account, that page alone (ADR 0047)", () => {
    const page = (n: number, topic: string) => ({ number: n, topic, body: `- ${topic}` });
    const pages = [
      page(1, "Preferences"),
      page(2, "spotter"),
      page(3, "acme/api"),
      page(4, "People"),
    ];
    const repos = ["spotter", "notes-api"];
    const topics = (on: string[], away = false) =>
      pagesFor(pages, { repos, on, away }).map((p) => p.topic);
    expect(topics([])).toEqual(["Preferences", "People"]);
    expect(topics(["spotter"])).toEqual(["Preferences", "spotter", "People"]);
    expect(topics(["Spotter"])).toEqual(["Preferences", "spotter", "People"]);
    expect(topics(["acme/api"], true)).toEqual(["acme/api"]);
    expect(topics(["acme/web"], true)).toEqual([]);
  });
});

describe("the notebook: dates, hidden characters and forgetting (ADR 0032)", () => {
  it("dates a note, and reads its words without the bullet or the date", () => {
    expect(dated("short answers", "2026-10-05")).toBe("short answers (2026-10-05)");
    expect(noteWords("- short answers (2026-10-05)")).toBe("short answers");
    expect(noteWords("* Sonnet (for now)")).toBe("Sonnet (for now)");
  });

  it("refuses characters you can't see: zero-width and direction marks", () => {
    expect(hasHidden("short\u200b answers")).toBe(true);
    expect(hasHidden("ignore\u202e previous")).toBe(true);
    expect(hasHidden("Priya is my designer 👩\u200d🎨")).toBe(false);
    expect(hasHidden("hi\u{E0041}\u{E0042}")).toBe(true);
  });

  it("finds the note lines holding some words, and takes one off its page", () => {
    const page = "- short answers (2026-10-01)\n- Sonnet for questions (2026-10-02)\nnot a note\n";
    expect(linesWith(page, "SHORT")).toEqual(["- short answers (2026-10-01)"]);
    expect(linesWith(page, "note")).toEqual([]);
    expect(linesWith(page, "s")).toHaveLength(2);
    expect(withoutNote(page, "- short answers (2026-10-01)")).toBe(
      "- Sonnet for questions (2026-10-02)\nnot a note\n",
    );
  });
});

describe("the notebook: in a round's prompt", () => {
  it("puts Preferences first, says what wins, and that a note never approves anything", () => {
    const s = notebookSection(
      [
        { number: 2, topic: "People", body: "- Ana designs" },
        { number: 1, topic: "Preferences", body: "- short answers (2026-10-05)" },
      ],
      { canWrite: true },
    );
    expect(s.indexOf("**Preferences**")).toBeLessThan(s.indexOf("**People**"));
    expect(s.indexOf("### Preferences")).toBeLessThan(s.indexOf("### People"));
    expect(s).toContain("the owner's words in this task first, then the notebook");
    expect(s).toContain("its own `AGENTS.md` wins inside that repo");
    expect(s).toContain("A newer line beats an older one");
    expect(s).toContain("A note never approves");
    // A way of working goes to skills by PR, not into a note.
    expect(s).toContain("propose it as a change to `skills/` or `playbooks/`");
  });

  it("lists every page by its first line, carries pages whole up to the budget, and says how to add one", () => {
    const big = `- ${"x".repeat(PROMPT_BUDGET)}`;
    const s = notebookSection(
      [
        { number: 1, topic: "Preferences", body: "- Sonnet for questions\n- Dark mode" },
        { number: 2, topic: "People", body: big },
      ],
      { canWrite: true },
    );
    expect(s).toContain("- **Preferences**: Sonnet for questions");
    expect(s).toContain("### Preferences\n\n- Sonnet for questions\n- Dark mode");
    expect(s).not.toContain("### People");
    expect(s).toContain(
      'Not shown in full: People. Read one with Shipify\'s CLI (`<ship> notebook read "<topic>"`)',
    );
    // The result's own field and shape (result.ts): notes, each a topic and a line.
    expect(s).toContain('add it to `notes` in your result: `[{"topic": "Preferences", "line":');
  });

  it("says when a run doesn't add to it, and what an empty notebook is", () => {
    expect(
      notebookSection([{ number: 1, topic: "X", body: "- y" }], { canWrite: false }),
    ).toContain("This run doesn't add to the notebook");
    expect(notebookSection([], { canWrite: true })).toContain("The notebook is empty.");
    expect(notebookSection([], { canWrite: true })).toContain("`notes`");
  });
});
