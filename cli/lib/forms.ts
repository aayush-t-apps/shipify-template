// The task forms (.github/ISSUE_TEMPLATE) list the projects in their dropdowns. These keep those
// lists current: `ship forms` rewrites them from the index and opens a small PR, and publishing a
// project does it too, so a new project shows up in the forms after one merge.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_ROOT } from "./config.ts";
import type { RegistryEntry } from "./schemas.ts";

export const FORMS_DIR = join(PLATFORM_ROOT, ".github", "ISSUE_TEMPLATE");
const MARK = "# Projects: `ship forms` keeps this list current";

/** Which projects each form offers: operations, for apps. */
export const FORM_PROJECTS: Record<string, (p: RegistryEntry) => boolean> = {
  "7-operate.yml": (p) => p.kind === "app",
};

/** What a list with no app yet offers: GitHub's dropdowns need one option. */
export const NO_APP = "(none yet)";

/** Replace the "- item" lines after the marker comment with these ids (NO_APP for none). */
export function setFormProjects(text: string, ids: string[]): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(MARK));
  if (i < 0) return text;
  const indent = /^\s*/.exec(lines[i] ?? "")?.[0] ?? "";
  let j = i + 1;
  while (j < lines.length && lines[j]?.startsWith(`${indent}- `)) j++;
  const items = (ids.length ? ids : [NO_APP]).map((id) => `${indent}- ${id}`);
  return [...lines.slice(0, i + 1), ...items, ...lines.slice(j)].join("\n");
}

/** The ids a form lists after its marker (none for NO_APP). */
export function formIds(text: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(MARK));
  if (i < 0) return [];
  const indent = /^\s*/.exec(lines[i] ?? "")?.[0] ?? "";
  const ids: string[] = [];
  for (let j = i + 1; lines[j]?.startsWith(`${indent}- `); j++) {
    const id = (lines[j] as string).slice(indent.length + 2).trim();
    if (id !== NO_APP) ids.push(id);
  }
  return ids;
}

/** The forms as they should read for these projects: [file, current text, new text]. */
export function formUpdates(projects: RegistryEntry[]): [string, string, string][] {
  return Object.entries(FORM_PROJECTS)
    .map(([file, keep]) => {
      const path = join(FORMS_DIR, file);
      if (!existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      const ids = projects
        .filter(keep)
        .map((p) => p.id)
        .sort();
      return [file, text, setFormProjects(text, ids)] as [string, string, string];
    })
    .filter((x): x is [string, string, string] => Boolean(x));
}
