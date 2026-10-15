// executors.json's two axes, agents and gateways, made into the entries a run works on
// (cli/contracts/gateways.ts), and what a model takes there: efforts per gateway and per model.
import { describe, expect, it } from "vitest";
import { expandAgents } from "../cli/contracts/gateways.ts";
import { choose, effortsFor, heldTo, parseUse } from "../cli/lib/agents.ts";

const install = { version: "1.0.0", run: ["x", "{prefix}"], bin: "bin/x" };
const file = {
  version: 1,
  gateways: {
    one: {
      name: "One",
      word: "one",
      auto: { model: "a/big", effort: "high" },
      models: ["a/big", "a/small"],
    },
    two: {
      name: "Two",
      word: "two",
      models: ["b/first", "b/second"],
      modelPattern: "^b/",
    },
    three: { models: ["c/m"] },
  },
  claude: { description: "claude", adapter: "claude", default: true, efforts: ["low", "high"] },
  tool: {
    description: "a tool",
    adapter: "pi",
    gateways: ["one", "two", "three", "nowhere"],
    modelPattern: "^a/",
    efforts: ["off", "low", "medium", "high", "max"],
    install,
  },
};
type Made = Record<string, Record<string, unknown>>;
const made = expandAgents(file);
const all = made.entries as Made;
/** The entries and problems a file makes. */
const of = (f: Record<string, unknown>) => {
  const r = expandAgents(f);
  return { all: r.entries as Made, said: r.problems.join("\n") };
};

describe("an agent through each of its gateways", () => {
  it("is its own id through the first, `<id>-<word>` through each other, never through one that isn't there", () => {
    expect(Object.keys(all).filter((k) => k.startsWith("tool"))).toEqual([
      "tool",
      "tool-two",
      "tool-three",
    ]);
    expect(all.tool).toMatchObject({ gateway: "one" });
    expect(all["tool-two"]).toMatchObject({ gateway: "two", extends: "tool", name: "Tool · Two" });
    // A gateway with no name or word is named by its id.
    expect(all["tool-three"]).toMatchObject({ gateway: "three", name: "Tool · Three" });
  });

  it("takes the gateway's models and Auto, over the agent's own, and the agent's pattern as a default", () => {
    expect(all.tool).toMatchObject({ models: ["a/big", "a/small"], auto: { model: "a/big" } });
    // The gateway knows its ids: its pattern is the one it says, else the agent's.
    expect(all.tool?.modelPattern).toBe("^a/");
    expect(all["tool-two"]?.modelPattern).toBe("^b/");
    expect(all["tool-three"]?.modelPattern).toBe("^a/");
  });

  it("falls back to the gateway's first model for Auto, with no effort, and to none without models", () => {
    expect(all["tool-two"]?.auto).toEqual({ model: "b/first" });
    expect(all["tool-three"]?.auto).toEqual({ model: "c/m" });
    const bare = of({
      gateways: { g: { word: "g" } },
      a: { description: "a", adapter: "pi", gateways: ["g"] },
    }).all;
    expect(bare.a).toMatchObject({ gateway: "g" });
    expect(bare.a?.auto).toBeUndefined();
    // The agent's own Auto comes before the gateway's first model; the gateway's own before both.
    const own = of({
      gateways: { g: { models: ["g/a", "g/b"] }, h: { word: "h", auto: { model: "h/x" } } },
      a: { description: "a", gateways: ["g", "h"], auto: { model: "g/b", effort: "high" } },
    }).all;
    expect(own.a?.auto).toEqual({ model: "g/b", effort: "high" });
    expect(own["a-h"]?.auto).toEqual({ model: "h/x" });
  });

  it("keeps the agent's own efforts; what each model takes is its gateway's catalog's, read for a run", () => {
    for (const id of ["tool", "tool-two", "tool-three"])
      expect(all[id]?.efforts, id).toEqual(["off", "low", "medium", "high", "max"]);
    // The agent's own per-model list isn't kept through a gateway: the catalog says it.
    const per = of({
      gateways: { g: {} },
      a: { gateways: ["g"], efforts: ["low", "max"], modelEfforts: { "g/m": ["max"] } },
    }).all.a;
    expect(per).toMatchObject({ efforts: ["low", "max"] });
    expect(per?.modelEfforts).toBeUndefined();
  });

  it("is one program: its install in the first's folder, never the default, nothing else touched", () => {
    expect(all["tool-two"]?.install).toEqual({ ...install, dir: "tool" });
    expect(all["tool-two"]?.default).toBeUndefined();
    expect(all.tool?.default).toBeUndefined();
    expect(all.gateways).toEqual(file.gateways);
    // An agent with no gateways is as written, and nothing is said of a file that's right.
    expect(all.claude).toEqual(file.claude);
    expect(made.problems).toEqual([
      'executors.json: tool: its gateway "nowhere" isn\'t a working one in "gateways"',
    ]);
  });
});

describe("a part that can't be made", () => {
  const g = { word: "two", models: ["x/m"] };
  it("leaves the agent out when its first gateway isn't there: its id means that gateway", () => {
    const r = of({ gateways: { two: g }, a: { gateways: ["gone", "two"] } });
    expect(Object.keys(r.all)).toEqual(["gateways"]);
    expect(r.said).toBe(
      'executors.json: a: its gateway "gone" isn\'t a working one in "gateways", so it\'s left out',
    );
    expect(of({ gateways: {}, a: { gateways: [] } }).said).toContain(
      "a: lists no gateway, so it's left out",
    );
  });

  it("skips a gateway listed twice, and one whose id is taken, saying so", () => {
    const twice = of({
      gateways: { one: { word: "one" }, two: g },
      a: { gateways: ["one", "two", "two"] },
    });
    expect(Object.keys(twice.all)).toEqual(["gateways", "a", "a-two"]);
    expect(twice.said).toContain('a: lists its gateway "two" twice');
    // An agent written with that id keeps it; two gateways with one word make it once.
    const taken = of({
      gateways: { one: { word: "one" }, two: g, three: { word: "two" } },
      a: { gateways: ["one", "two", "three"] },
      "a-two": { description: "mine" },
    });
    expect(taken.all["a-two"]).toEqual({ description: "mine" });
    expect(taken.said.match(/a-two: a through "\w+" would be this, and it's taken/g)).toHaveLength(
      2,
    );
  });

  it("refuses what the file no longer says by hand: `extends` and `gateway`", () => {
    const r = of({
      gateways: { one: { word: "one" } },
      a: { extends: "b", gateway: "one", task: ["x"] },
    });
    expect(r.all.a).toEqual({ task: ["x"] });
    expect(r.said).toContain("a: `extends` isn't read (ADR 0052)");
    expect(r.said).toContain("a: `gateway` is made from `gateways` (ADR 0052)");
  });
});

describe("what a model takes", () => {
  const e = {
    efforts: ["low", "medium", "high"],
    modelEfforts: { x: ["high"], z: [], haiku: [] },
  };
  it("is the model's own list, none when it says none, else the agent's", () => {
    expect(effortsFor(e, "x")).toEqual(["high"]);
    expect(effortsFor(e, "z")).toEqual([]);
    expect(effortsFor(e, "haiku")).toEqual([]);
    expect(effortsFor(e, "other")).toEqual(["low", "medium", "high"]);
    expect(effortsFor(e)).toEqual(["low", "medium", "high"]);
    expect(effortsFor(undefined, "x")).toEqual([]);
  });

  // An agent's own list for a model (Claude Code's Haiku takes none): the grammar and a run hold to it.
  const own = {
    adapter: "claude",
    description: "a",
    models: ["big", "haiku"],
    efforts: ["low", "medium", "high"],
    modelEfforts: { haiku: [] },
    auto: { model: "big", effort: "medium" },
  };
  const entries = { a: own } as never;

  it("is held to in a `use` line: refused when asked, dropped when kept from the model before", () => {
    const was = { agent: "a", model: "big", effort: "high" };
    expect(parseUse("a haiku low", entries, was, "a")).toBeUndefined();
    expect(parseUse("a haiku", entries, was, "a")).toMatchObject({
      model: "haiku",
      effort: undefined,
    });
    expect(parseUse("a big", entries, was, "a")?.effort).toBe("high");
  });

  it("is held to its gateway's catalog on a run: an effort it doesn't take is Auto's or none, said", () => {
    const pi = {
      adapter: "pi",
      description: "p",
      efforts: ["off", "low", "medium", "high", "max"],
      modelPattern: "^g/",
      auto: { model: "g/a", effort: "high" },
    } as never;
    const asked = choose("p", pi, { model: "g/a", effort: "max" });
    // The catalog says low and high: max isn't one, so Auto's (high), and the run says why.
    const held = heldTo(asked, ["low", "high"], pi);
    expect(held.effort).toBe("high");
    expect(held.notes.join(" ")).toContain("takes no “max” effort (low, high), so it ran at high");
    // None at all, or Auto's not one either: none, and Auto's own quietly.
    expect(heldTo(asked, [], pi)).toMatchObject({ effort: undefined });
    const auto = choose("p", pi, { model: "g/a" });
    expect(heldTo(auto, ["low"], pi)).toMatchObject({ effort: undefined, notes: [] });
    // A catalog that says nothing, or a taken effort: as chosen.
    expect(heldTo(asked, undefined, pi)).toBe(asked);
    expect(heldTo(asked, ["max"], pi)).toBe(asked);
  });
});
