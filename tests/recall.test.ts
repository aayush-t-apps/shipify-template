// `ship recall` (ADR 0078 section 4): a run fetches an earlier chat only when the ask builds on one.
// `recall "<words>"` finds your chats and pages as the web chat's Find does (by meaning; by words when
// GitHub refuses it), guests' left out; `recall <n>` prints one chat, short: its Progress first, its
// newest 2 messages whole, each older one as one line with its id. Against the fake gh.
import { afterEach, describe, expect, it } from "vitest";
import { recall } from "../cli/commands/recall.ts";
import { taskRead } from "../cli/commands/task/read.ts";
import { fakeGh } from "./fixtures/fakes.ts";
import { sandbox, ship } from "./helpers.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

/** The fake gh with this state, for a run on #12 in o/shipify, whose owner is o. */
const gh = (state: Record<string, unknown>) => {
  const g = fakeGh(state);
  Object.assign(process.env, g.env, {
    SHIPIFY_TASK: "12",
    GITHUB_REPOSITORY: "o/shipify",
    SHIPIFY_OWNER: "o",
    SHIPIFY_DOOR_SLUG: "shipify-door",
  });
  delete process.env.SHIPIFY_ISSUES_TOKEN;
  return g;
};

/** An item as GitHub's issue search lists it. */
const hit = (
  number: number,
  title: string,
  o: { state?: string; labels?: string[]; at?: string; pr?: boolean } = {},
) => ({
  number,
  title,
  state: o.state ?? "open",
  updated_at: o.at ?? "2026-11-02T08:30:00Z",
  labels: (o.labels ?? []).map((name) => ({ name })),
  user: { login: "o" },
  ...(o.pr ? { pull_request: { url: "x" } } : {}),
});

const searches = (calls: string[]) => calls.filter((c) => c.startsWith("api search/issues?"));

describe('`ship recall "<words>"`: your earlier chats, found as Find does', () => {
  it("prints each hit on one line by meaning, one search; guests', the status task, PRs and the run's own task left out", () => {
    const g = gh({
      searched: [
        hit(41, "Trip to Goa", { state: "closed", at: "2026-10-02T21:10:00Z" }),
        hit(50, "Ana's trip", { labels: ["guest", "guest:guest-ana-a1b2c3"] }),
        hit(51, "Ana's hotels", { labels: ["guest:guest-ana-a1b2c3"] }),
        hit(12, "This chat"),
        hit(900, "Shipify status", { labels: ["shipify-status"] }),
        hit(60, "A PR", { pr: true }),
        hit(57, "Notebook: goa-hotels", { labels: ["library", "project:goa"] }),
      ],
    });
    const r = recall(["trip", "to", "Goa"]);
    expect(r.status).toBe("succeeded");
    expect(r.summary).toBe("2 found for “trip to Goa”: `<ship> recall <n>` prints one");
    expect(r.data).toBe(
      [
        "#41 Trip to Goa · closed · 2026-10-02",
        "#57 Notebook: goa-hotels · open · 2026-11-02",
      ].join("\n"),
    );
    // One search, by meaning, of your repo's issues with guests' left out (ADR 0071).
    const asked = searches(g.calls());
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("&search_type=hybrid&per_page=10");
    expect(decodeURIComponent(asked[0] ?? "")).toContain(
      "q=repo:o/shipify is:issue -label:guest trip to Goa&",
    );
  });

  it("searches by words when GitHub refuses the search by meaning, and says so in one line", () => {
    const g = gh({ searchRefused: 429, searched: [hit(41, "Trip to Goa")] });
    const r = recall(["Goa"]);
    expect(r.status).toBe("succeeded");
    expect(r.data).toBe(
      [
        "GitHub refused the search by meaning just now (HTTP 429), so this searched by words: other words may find more.",
        "#41 Trip to Goa · open · 2026-11-02",
      ].join("\n"),
    );
    // One by meaning, refused; one by words. Never a loop.
    const asked = searches(g.calls());
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("search_type=hybrid");
    expect(asked[1]).not.toContain("search_type");
  });

  it("says so in one line when nothing is found", () => {
    gh({ searched: [hit(50, "Ana's trip", { labels: ["guest"] })] });
    const r = recall(["trip"]);
    expect(r.status).toBe("succeeded");
    expect(r.summary).toBe("No earlier chat found for “trip”.");
    expect(r.data).toBeUndefined();
  });

  it("says what failed when GitHub can't search at all, with no second try", () => {
    const g = gh({ searchRefused: 500 });
    expect(() => recall(["Goa"])).toThrow(/The search couldn't run: .*HTTP 500/);
    expect(searches(g.calls())).toHaveLength(1);
  });
});

/** A chat (#41): its opening, its status (with or without a Progress), and its messages. */
const chat = (o: { n?: number; notes?: string; labels?: string[]; body?: string } = {}) => ({
  issue: {
    number: o.n ?? 41,
    title: "Trip to Goa",
    body: o.body ?? "Plan a trip to Goa in December.\nFour of us.",
    state: "closed",
    labels: (o.labels ?? []).map((name) => ({ name })),
    user: { login: "o" },
    created_at: "2026-10-01T09:00:00Z",
  },
  comments: [
    {
      id: 1001,
      body: `<!-- shipify-task ${JSON.stringify({ v: 2, phase: "answered", ...(o.notes ? { notes: o.notes } : {}) })} -->\n**Answered**`,
      user: { login: "github-actions[bot]" },
      created_at: "2026-10-01T09:01:00Z",
    },
    {
      id: 1002,
      body: `Three options:\n1. North Goa\n2. South Goa\n3. ${"x".repeat(200)}`,
      user: { login: "github-actions[bot]" },
      created_at: "2026-10-01T09:20:00Z",
    },
    {
      id: 1003,
      body: "Someone else's words.",
      user: { login: "stranger" },
      created_at: "2026-10-01T10:00:00Z",
    },
    {
      id: 1004,
      body: "South, please. Under 40k.",
      user: { login: "o" },
      created_at: "2026-10-02T10:00:00Z",
    },
    {
      id: 1005,
      body: "Booked: Palolem, 20-24 December.\n\nDetails below.",
      user: { login: "github-actions[bot]" },
      created_at: "2026-10-02T10:05:00Z",
    },
  ],
});

describe("`ship recall <n>`: one chat, short", () => {
  it("prints its Progress first, then each older message as one line with its id, then the newest 2 whole", () => {
    gh({ others: { 41: chat({ notes: "Booked Palolem for 20-24 Dec. Next: trains." }) } });
    const r = recall(["41"]);
    expect(r.status).toBe("succeeded");
    expect(r.summary).toBe("#41 Trip to Goa · closed · 4 messages");
    expect(r.data).toBe(
      [
        "## Progress: the last run's handoff",
        "",
        "Booked Palolem for 20-24 Dec. Next: trains.",
        "",
        "## Messages",
        "",
        "Each before the newest 2 is one line: when, who, its first line and its id.",
        "- 2026-10-01 09:00, the owner (id 0): Plan a trip to Goa in December.",
        "- 2026-10-01 09:20, Shipify (id 1002): Three options:",
        "- the owner, 2026-10-02T10:00:00Z:",
        "  South, please. Under 40k.",
        "- Shipify, 2026-10-02T10:05:00Z:",
        "  Booked: Palolem, 20-24 December.",
        "  ",
        "  Details below.",
        "",
        "`<ship> task read <id> --task 41` prints one whole (0: the chat's opening words).",
      ].join("\n"),
    );
    // The id it names reads whole, on that chat, with the command it names.
    expect(taskRead("1002", "41").data).toContain("3. xxxx");
    expect(taskRead("0", "41").data).toContain("Four of us.");
  });

  it("cuts an older message's first line to 100 characters, as the prompt does", () => {
    gh({
      others: {
        41: chat({ body: `${"a".repeat(150)}\nmore` }),
      },
    });
    const line = String(recall(["#41"]).data)
      .split("\n")
      .find((l) => l.includes("(id 0)"));
    expect(line).toBe(`- 2026-10-01 09:00, the owner (id 0): ${"a".repeat(99)}…`);
  });

  it("prints a chat with no Progress as a plain one: its messages alone", () => {
    gh({ others: { 41: chat() } });
    const data = String(recall(["41"]).data);
    expect(data).not.toContain("Progress");
    expect(data.startsWith("Each before the newest 2 is one line")).toBe(true);
    expect(data).not.toContain("shipify-task");
    expect(data).not.toContain("Someone else's words");
  });

  it("refuses a guest's chat, and sends a page to `notebook read`", () => {
    gh({
      others: {
        41: chat({ labels: ["guest", "guest:guest-ana-a1b2c3"] }),
        42: chat({ n: 42, labels: ["guest:guest-ana-a1b2c3"] }),
        // The door's opening line names a guest (ADR 0071): theirs, whatever its labels.
        43: chat({
          n: 43,
          body: `<!-- shipify-from {"channel":"web","chat":"guest-ana-a1b2c3","guest":"guest-ana-a1b2c3","id":"1","person":"Ana","v":1} -->\nHi`,
        }),
        57: {
          issue: {
            number: 57,
            title: "Notebook: goa-hotels",
            body: "- Palolem huts",
            state: "open",
            labels: [{ name: "library" }, { name: "project:goa" }],
            user: { login: "o" },
          },
          comments: [],
        },
      },
    });
    expect(() => recall(["41"])).toThrow("#41 is a guest's: it's theirs alone.");
    expect(() => recall(["42"])).toThrow("#42 is a guest's: it's theirs alone.");
    expect(() => recall(["43"])).toThrow("#43 is a guest's: it's theirs alone.");
    expect(() => recall(["57"])).toThrow(
      '#57 is a page: read it with `<ship> notebook read "goa-hotels"`.',
    );
  });

  it("needs words or a number, and the owner's login to tell whose words are whose", () => {
    gh({ others: { 41: chat() } });
    expect(() => recall([])).toThrow(/Use: recall "<words>" \| recall <n>/);
    delete process.env.SHIPIFY_OWNER;
    expect(() => recall(["41"])).toThrow(/whose words are whose/);
  });
});

describe("`ship recall` on the CLI", () => {
  it("takes its words unquoted, as one search", () => {
    const g = fakeGh({ searched: [hit(41, "Trip to Goa")] });
    const sb = sandbox();
    sb.env = { ...sb.env, ...g.env, GITHUB_REPOSITORY: "o/shipify", SHIPIFY_TASK: "12" };
    const r = ship(sb, "recall", "trip", "to", "Goa");
    expect(r.status).toBe("succeeded");
    expect(r.data).toBe("#41 Trip to Goa · open · 2026-11-02");
    expect(decodeURIComponent(searches(g.calls())[0] ?? "")).toContain(" trip to Goa&");
  });
});
