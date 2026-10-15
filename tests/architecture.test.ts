// The four rules that keep each block developed on its own (ADR 0032, "Built to grow"), checked on
// every `pnpm verify` by reading the imports, with no tool beyond this file:
//   1. a plug-in imports only its kind's contract and cli/contracts/ (and Node's own modules);
//   2. plug-ins never import each other (rule 1 leaves no way to);
//   3. the core never names a plug-in: it finds them through a registry;
//   4. the shapes between blocks carry a version.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { From, RecordSeen, ReplyLine, TaskSeen } from "../cli/contracts/index.ts";
import { Result } from "../cli/kernel/result.ts";
import { ROOT } from "./helpers.ts";

/** Every .ts file under a folder of the repo, by its path from the repo's root. */
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(path);
    return e.name.endsWith(".ts") ? [path] : [];
  });
}

/** What a file imports: each specifier, as written. */
const importsOf = (path: string) =>
  [
    ...readFileSync(join(ROOT, path), "utf8").matchAll(
      /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gms,
    ),
  ].map((m) => m[1] ?? "");

/** A specifier as a path from the repo's root (a relative one), or as written (a package). */
const target = (from: string, spec: string) =>
  spec.startsWith(".") ? relative(ROOT, join(ROOT, from, "..", spec)) : spec;

/** Each kind with code plug-ins: where its adapters live, and what one may import. */
const KINDS = [
  {
    kind: "channel",
    dir: "edge/src/channels",
    // The channel kit: the contract, the edge's env, and Web Push for a chat read in place.
    contract: ["edge/src/channels/channel.ts", "edge/src/env.ts", "edge/src/push.ts"],
    registry: "edge/src/channels/index.ts",
  },
  {
    kind: "agent",
    dir: "cli/lib/agents",
    contract: ["cli/lib/plugins/agent.ts"],
    registry: "cli/lib/agents/index.ts",
  },
];

const adaptersOf = (k: (typeof KINDS)[number]) =>
  files(k.dir).filter((f) => f !== k.registry && !k.contract.includes(f));

describe("rule 1 and 2: a plug-in imports only its contract, cli/contracts and Node", () => {
  for (const k of KINDS)
    for (const file of adaptersOf(k))
      it(`${file} (a ${k.kind})`, () => {
        for (const spec of importsOf(file)) {
          const to = target(file, spec);
          const ok =
            to.startsWith("node:") || k.contract.includes(to) || to.startsWith("cli/contracts/");
          expect(ok, `${file} imports ${spec}`).toBe(true);
        }
      });

  it("Web Push, in the channel kit, imports nothing: it knows the standards, not Shipify", () => {
    expect(importsOf("edge/src/push.ts")).toEqual([]);
  });

  it("each kind has at least one plug-in, and a registry that lists it", () => {
    for (const k of KINDS) {
      const adapters = adaptersOf(k);
      expect(adapters.length, k.kind).toBeGreaterThan(0);
      const listed = importsOf(k.registry).map((s) => target(k.registry, s));
      for (const a of adapters) expect(listed, `${k.registry} lists ${a}`).toContain(a);
    }
  });
});

describe("rule 3: the core never names a plug-in", () => {
  const core = [...files("cli"), ...files("edge/src")];
  for (const k of KINDS) {
    const adapters = new Set(adaptersOf(k));
    it(`only ${k.registry} imports a ${k.kind} adapter`, () => {
      for (const file of core.filter((f) => f !== k.registry && !adapters.has(f)))
        for (const spec of importsOf(file))
          expect(adapters.has(target(file, spec)), `${file} imports ${spec}`).toBe(false);
    });
  }
});

describe("rule 4: the shapes between blocks carry a version", () => {
  it("a from-line, a reply line, a task's status, the status record and a run's result", () => {
    for (const [name, shape] of Object.entries({ From, ReplyLine, TaskSeen, RecordSeen, Result }))
      expect(Object.keys(shape.shape), name).toContain("v");
  });
});
