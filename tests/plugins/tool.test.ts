// The tool plug-in's conformance test (ADR 0015, ADR 0027, cli/lib/plugins/tool.ts): tools.json is
// right entry by entry, a broken entry is left out with a plain reason, and every tool's server
// offers exactly the calls it sorts into look and act. A new tool passes this by being in
// tools.json: no test to write, unless it needs a fake service (tests/fixtures/fake-notion.mjs).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPluginFile, TOOLS_VERSION, ToolEntry } from "../../cli/lib/plugins/tool.ts";
import {
  listServerTools,
  readTools,
  runTools,
  sortProblems,
  type Tools,
} from "../../cli/lib/tools.ts";
import { ROOT } from "../helpers.ts";

const { tools, problems } = readTools(join(ROOT, "tools.json"));

const why = (entry: unknown) => {
  const r = ToolEntry.safeParse(entry);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("tools.json", () => {
  it("is right, entry by entry", () => {
    expect(problems).toEqual([]);
  });
});

describe.each(Object.entries(tools).filter(([, t]) => t.run))("the tool plug-in: %s", (name, t) => {
  it("offers exactly its look and act calls", async () => {
    // Its keys set to stand-ins: listing calls needs no real key.
    const env = Object.fromEntries(Object.keys(t.keys).map((v) => [v, "stand-in"]));
    // Its first start compiles it, which can pass 20 s while the whole suite runs: a minute here.
    // A server that never answers still fails, saying so.
    const offered = await listServerTools(t.run as string[], env, 60_000);
    expect(sortProblems(name, t, offered)).toEqual([]);
  }, 90_000);
});

describe("a tool's server that never answers", () => {
  it("fails, saying how long it waited", async () => {
    const silent = [process.execPath, "-e", "setInterval(() => {}, 1000)"];
    await expect(listServerTools(silent, {}, 300)).rejects.toThrow(
      "the server didn't answer within 0.3 seconds",
    );
  });
});

describe("a tool's entry", () => {
  const server = { description: "x", run: ["server"], keys: { K: { look: "R", act: "W" } } };

  it("takes a tool with calls, and a chat channel (its adapter lives in the edge)", () => {
    expect(why({ ...server, look: ["search"], act: ["update"] })).toEqual([]);
    expect(why({ description: "x", in: { door: "telegram" } })).toEqual([]);
  });

  it("says what's wrong, in plain words", () => {
    expect(why({ description: "x" })).toContain("a tool does at least one thing: look, act or in");
    expect(why({ ...server, look: [], act: [] })).toContain(
      "a server with no look or act calls does nothing",
    );
    expect(why({ description: "x", look: ["a"] })).toContain(
      "a tool with look or act calls has a server: either run or url",
    );
    expect(why({ ...server, look: ["a"], act: ["a"] })).toContain(
      '"a" is both look and act: each call is one or the other',
    );
    expect(why({ ...server, keys: { K: { act: "W" } }, look: ["a"], act: ["b"] })).toContain(
      "keys.K has no look secret, and the tool has look calls",
    );
    expect(why({ ...server, look: ["Bad-Name"] })[0]).toMatch(/lowercase/);
  });
});

describe("a plug-in file", () => {
  it("leaves out a broken entry, and keeps the rest", () => {
    const r = loadPluginFile(
      "tools.json",
      {
        version: 1,
        good: { description: "x", in: { door: "x" } },
        bad: { description: "x" },
        "Not-A-Name": {},
      },
      ToolEntry,
      TOOLS_VERSION,
    );
    expect(Object.keys(r.entries)).toEqual(["good"]);
    expect(r.problems).toEqual([
      "tools.json: bad: a tool does at least one thing: look, act or in",
      'tools.json: "Not-A-Name" isn\'t a name (lowercase letters, digits and _)',
    ]);
  });

  it("names the broken entries, so a run can say each isn't connected", () => {
    const dir = mkdtempSync(join(tmpdir(), "tools-"));
    const file = join(dir, "tools.json");
    writeFileSync(file, JSON.stringify({ version: 1, broken: { description: "x" } }));
    expect(readTools(file)).toMatchObject({ tools: {}, broken: ["broken"] });
  });

  it("refuses a version newer than it reads, and anything that isn't an object", () => {
    expect(loadPluginFile("tools.json", { version: 2 }, ToolEntry, 1).problems).toEqual([
      "tools.json: version 2 is newer than this Shipify reads (1): update Shipify",
    ]);
    expect(loadPluginFile("tools.json", [], ToolEntry, 1).problems).toEqual([
      "tools.json: not an object of entries",
    ]);
  });
});

describe("a run's tools", () => {
  const all: Tools = {
    notes: ToolEntry.parse({
      description: "x",
      run: ["s"],
      keys: { K: { look: "R" } },
      look: ["read"],
    }),
    chat: ToolEntry.parse({ description: "x", in: { door: "chat" } }),
  };

  it("never hands the agent a channel, and an act run uses a look-only tool's look key", () => {
    expect(runTools(all, "look", { R: "1", S: "1" })).toEqual({
      ready: { notes: ["read"] },
      missing: [],
    });
    expect(runTools(all, "act", { R: "1" })).toEqual({ ready: { notes: ["read"] }, missing: [] });
  });
});
