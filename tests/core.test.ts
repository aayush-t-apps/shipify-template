import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARED_KEYS } from "../cli/lib/plugins/agent.ts";
import { ROOT } from "./helpers.ts";

// Core runs the flow; stacks own every tool (docs/design.md). A project tool named in cli/ means
// something host- or language-specific leaked out of a stack.
const TOOLS = [
  /wrangler/i,
  /cloudflare/i,
  /workers\.dev/i,
  /\bbiome\b/i,
  /vitest/i,
  /playwright/i,
  /\bpnpm (install|exec|audit|add|format|build|test)\b/,
  /node_modules/,
  /\bnpm\b/,
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * The plug-ins' own names (ADR 0027): every agent in executors.json and tool in tools.json, and an
 * agent's way of naming tools. Only adapters (cli/lib/agents/) may say them; comments may mention
 * them, code may not.
 */
const pluginNames = () => {
  const json = (file: string) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  const names = (file: string) =>
    Object.keys(json(file)).filter((k) => !(SHARED_KEYS as readonly string[]).includes(k));
  // Every agent, tool and channel, and every gateway (executors.json's shared `gateways`).
  const words = [
    ...names("executors.json"),
    ...Object.keys(json("executors.json").gateways ?? {}),
    ...names("tools.json"),
  ].filter((n) => n !== "manual");
  return [...words.map((w) => new RegExp(`\\b${w}\\b`)), /mcp__/];
};
const code = (line: string) => line.replace(/\/\/.*$/, "").replace(/^\s*(\*|\/\*).*$/, "");

describe("core", () => {
  it("names no project tool, language or host", () => {
    const hits = files(join(ROOT, "cli")).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          TOOLS.some((re) => re.test(line))
            ? [`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(hits).toEqual([]);
  });
  it("names no agent, tool or channel in its code (only adapters do)", () => {
    const banned = pluginNames();
    const hits = [...files(join(ROOT, "cli")), ...files(join(ROOT, "edge", "src"))]
      .filter(
        (f) =>
          !f.includes(`${join("cli", "lib", "agents")}/`) &&
          !f.includes(`${join("edge", "src", "channels")}/`),
      )
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .flatMap((line, i) =>
            banned.some((re) => re.test(code(line)))
              ? [`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`]
              : [],
          ),
      );
    expect(hits).toEqual([]);
  });
  it("reads package.json only for its own version", () => {
    const hits = files(join(ROOT, "cli")).filter(
      (f) => readFileSync(f, "utf8").includes("package.json") && !f.endsWith("lib/config.ts"),
    );
    expect(hits).toEqual([]);
  });
});
