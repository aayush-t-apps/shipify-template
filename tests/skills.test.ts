// The skill check (ADR 0038, skills/README.md): every agent loads Shipify's skills from their
// headers, and a strict reader (pi's) skips a skill whose header isn't plain YAML. Each skill has
// its name and when to use it, with no task numbers or dates (a lesson, not a log), and both
// tables that list the skills name each one.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ROOT } from "./helpers.ts";

const DIR = join(ROOT, "skills");
const SKILLS = readdirSync(DIR).filter((d) => statSync(join(DIR, d)).isDirectory());

/** A skill's header, read strictly (a colon in an unquoted line is an error, as in pi). */
function header(skill: string): Record<string, unknown> {
  const text = readFileSync(join(DIR, skill, "SKILL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error(`skills/${skill}/SKILL.md starts with no --- header`);
  return parse(m[1] as string, { strict: true, uniqueKeys: true }) as Record<string, unknown>;
}

/** The skills a table names in its first column, by the row's pattern. */
const listed = (text: string, row: RegExp) => [...text.matchAll(row)].map((m) => m[1]).sort();

describe("the skills", () => {
  it("are folders, each with its SKILL.md", () => {
    expect(SKILLS.length).toBeGreaterThan(0);
    for (const s of SKILLS) expect(existsSync(join(DIR, s, "SKILL.md")), s).toBe(true);
  });

  it.each(SKILLS)("%s has a strict header: its folder's name, and when to use it", (s) => {
    const h = header(s);
    expect(h.name).toBe(s);
    expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(typeof h.description).toBe("string");
    const d = h.description as string;
    expect(d.length, "a description agents can list").toBeLessThanOrEqual(1024);
    expect(d, "says when to use it").toMatch(/\bwhen\b/i);
    expect(d, "no task numbers").not.toMatch(/#\d/);
    expect(d, "no dates").not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });

  it("are each listed in skills/README.md and AGENTS.md, and nothing else is", () => {
    const all = [...SKILLS].sort();
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    expect(listed(readme, /^\| \[([a-z0-9-]+)\]\(\1\/SKILL\.md\) \|/gm)).toEqual(all);
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const section = agents.split("\n## Skills\n")[1]?.split("\n## ")[0] ?? "";
    expect(listed(section, /^\| `([a-z0-9-]+)` \|/gm)).toEqual(all);
  });
});
