// What the agent is told to run, it may run (a sweep after 0.2's live checks; ADR 0043): agents run
// any command but the refused ones (executors.json's `commands.deny`), so no instruction that
// reaches the agent (the task playbook, the prompt, the notebook's section, the recipes and their
// examples) names a refused command, unless on a line that says never. A new playbook step never
// needs a list changed. `<ship>` is read as task.yml starts it on a box.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shipifyCopy } from "../cli/kernel/think.ts";
import { readExecutors } from "../cli/lib/agents.ts";
import { ROOT } from "./helpers.ts";

const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** The commands every agent must never run, said once (executors.json's `commands`, ADR 0043). */
const denied = readExecutors(join(ROOT, "executors.json")).commands?.deny ?? [];
/** Refused the way every adapter refuses it: also after git's own options (`git -C x push`). */
const refused = (cmd: string, prefix: string) => {
  const git = /^git (\S+)$/.exec(prefix)?.[1];
  const words = cmd.split(/\s+/);
  return git
    ? words[0] === "git" && words.slice(1).includes(git)
    : cmd === prefix || cmd.startsWith(`${prefix} `);
};

/** How `<ship>` starts: the copy's CLI (think.ts), the same on a box and off one. */
const ship = shipifyCopy().cli;

/** The files whose words reach the agent, and the commands in them (`a|b` read as each). */
const SOURCES = [
  "playbooks/task.md",
  "cli/kernel/prompt.ts",
  "cli/lib/notebook.ts",
  ...readdirSync(join(ROOT, "recipes/examples")).map((f) => `recipes/examples/${f}`),
  ...readdirSync(join(ROOT, "recipes"))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => `recipes/${f}`),
];
/** Each line's commands, with whether the line says never. */
const commands = (text: string) =>
  text.split("\n").flatMap((line) =>
    [...line.matchAll(/`((?:<ship>|gh|git|make) [^`$]+)`/g)].flatMap((m) => {
      const c = (m[1] ?? "").replace(/\\$/, "").trim();
      const alt = /^(\S+) (\S+\|[^ ]+)(.*)$/.exec(c);
      const each = alt
        ? (alt[2] ?? "").split("|").map((v) => `${alt[1]} ${v}${alt[3] ?? ""}`)
        : [c];
      return each.map((cmd) => ({ cmd, never: /\bnever\b/i.test(line) }));
    }),
  );

describe("what the agent is told to run, it may run", () => {
  it("reads the box's command for `<ship>`, and the refused list", () => {
    expect(ship.startsWith("node ")).toBe(true);
    expect(denied).toEqual(expect.arrayContaining(["git push", "git stash"]));
  });

  for (const file of SOURCES) {
    const found = commands(read(file));
    it(`${file}: names a refused command only where it says never`, () => {
      for (const { cmd, never } of found) {
        const no = denied.find((p) => refused(cmd.replace(/^<ship>/, ship), p));
        expect(
          !no || never,
          `${file}: \`${cmd}\` is refused (executors.json's deny) but the line doesn't say never`,
        ).toBe(true);
      }
    });
  }

  it("says never to each refused command in the task playbook", () => {
    const never = commands(read("playbooks/task.md")).filter((c) => c.never);
    for (const d of denied)
      expect(
        never.some((c) => c.cmd === d),
        d,
      ).toBe(true);
  });
});
