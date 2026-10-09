// The one list of settings (ADR 0047, cli/lib/settings.ts): each setting once, where it lives and
// what sets and reads it; every one a workflow reads is on it; each the core and the edge list is
// read somewhere; setup's checks and doctor's leftovers come from it; and docs/settings.md is it.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { steps } from "../cli/commands/setup.ts";
import { CORE_SETTINGS } from "../cli/contracts/index.ts";
import { absent, allSettings, settingsTable, stale } from "../cli/lib/settings.ts";
import { EDGE_SETTINGS } from "../edge/setup/settings.ts";
import { ROOT } from "./helpers.ts";

const all = allSettings();
const named = (name: string) => all.find((s) => s.name === name);

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** docs/settings.md: the list's table, with what it is. This test writes it (`-u`), never a hand. */
const page = () => `# Settings

<!-- Made from the one list (cli/lib/settings.ts) by tests/settings.test.ts: change the list, then
run \`pnpm vitest run tests/settings.test.ts -u\`. -->

Every setting your copy has, from one list: the core's (\`cli/contracts/settings.ts\`), the edge's
(\`edge/setup/settings.ts\`), and each plug-in's from its own file (a stack's deploy values and keys,
a tool's keys, an agent's login, a gateway's key). \`ship setup\` checks each step's, \`ship doctor\`
names what's on your copy but on no list, and a workflow can't read one that isn't here.

- **A variable** is on your copy (\`gh variable list -R <you>/shipify\`), not secret; every run gets
  them all. **A secret** is on your copy too, by name only. **The edge's Worker** holds its own
  secrets, put there from this PC. **This PC** keeps copies in its credentials file
  (\`~/.config/shipify/credentials.env\`, [configuration.md](configuration.md#the-credentials-file)).
- **Needed:** by the core (no task runs without it), by its add-on (once you set that up), or no
  (unset, its default applies).
- How to make and replace each key: [setup.md](setup.md#tokens-and-secrets).

${settingsTable(all)}
`;

describe("the settings list", () => {
  it("has each setting once, with where it lives, what it holds, and what sets and reads it", () => {
    expect(new Set(all.map((s) => s.name)).size).toBe(all.length);
    for (const s of all) {
      expect(s.name, s.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(s.lives.length, s.name).toBeGreaterThan(0);
      for (const text of [s.what, s.setBy, s.readBy]) expect(text, s.name).not.toBe("");
    }
  });

  it("names only real setup steps, and the core needs only what a core step sets", () => {
    const ids = new Set(steps().map((s) => s.id));
    const core = new Set(
      steps()
        .filter((s) => !s.optional)
        .map((s) => s.id),
    );
    for (const s of all) {
      for (const id of s.steps ?? []) expect(ids.has(id), `${s.name}: ${id}`).toBe(true);
      if (s.core)
        expect(
          s.steps?.some((id) => core.has(id)),
          s.name,
        ).toBe(true);
      expect(s.core && s.optional, s.name).toBeFalsy();
    }
  });

  it("has every variable and secret a workflow reads, where it lives", () => {
    for (const f of files(".github/workflows")) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const [, kind, name] of text.matchAll(/\b(vars|secrets)\.([A-Z][A-Z0-9_]*)/g)) {
        const home = kind === "vars" ? "variable" : "secret";
        expect(named(name ?? "")?.lives, `${f}: ${kind}.${name}`).toContain(home);
      }
    }
  });

  it("has nothing of the core's or the edge's that nothing reads", () => {
    const lists = ["cli/contracts/settings.ts", "edge/setup/settings.ts"];
    const code = [".github/workflows", "cli", "edge/src", "edge/setup", "stacks", "tools"]
      .flatMap(files)
      .filter((f) => !lists.includes(relative(ROOT, join(ROOT, f))))
      .map((f) =>
        readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          .filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l))
          .join("\n"),
      )
      .join("\n");
    for (const s of [...CORE_SETTINGS, ...EDGE_SETTINGS])
      expect(code.includes(s.name), `${s.name} is read nowhere`).toBe(true);
  });

  it("is what docs/settings.md shows", async () => {
    await expect(page()).toMatchFileSnapshot(join(ROOT, "docs/settings.md"));
  });
});

describe("what setup and doctor read from it", () => {
  it("a step's settings missing on your copy, by kind (never an optional one)", () => {
    expect(absent("bot", { vars: {}, secrets: [] }, all)).toEqual([
      "variables SHIPIFY_BOT_CLIENT_ID, SHIPIFY_BOT_SLUG",
      "secret SHIPIFY_BOT_KEY",
    ]);
    expect(
      absent(
        "bot",
        { vars: { SHIPIFY_BOT_CLIENT_ID: "Iv1", SHIPIFY_BOT_SLUG: "b" }, secrets: [] },
        all,
      ),
    ).toEqual(["secret SHIPIFY_BOT_KEY"]);
    expect(absent("settings", { vars: { SHIPIFY_TIME_ZONE: "UTC" }, secrets: [] }, all)).toEqual(
      [],
    );
  });

  it("leftovers on your copy: a variable on no list, a value kept as a secret; a new project's key is none", () => {
    expect(
      stale(
        {
          vars: { SHIPIFY_TIME_ZONE: "UTC", OLD_SETTING: "x" },
          secrets: ["SHIPIFY_BOT_KEY", "SHIPIFY_TIME_ZONE", "AN_APPS_API_KEY"],
        },
        all,
      ),
    ).toEqual(["variable OLD_SETTING", "secret SHIPIFY_TIME_ZONE"]);
  });
});
