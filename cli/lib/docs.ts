// App-level docs: CHANGELOG (Keep a Changelog + SemVer), the living spec and change docs (ADR 0020).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ShipError } from "./output.ts";
import type { Plan } from "./plan.ts";

export type Bump = "patch" | "minor" | "major";
export const BUMPS: Bump[] = ["patch", "minor", "major"];

export function bumpVersion(version: string, bump: Bump): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new ShipError(`"${version}" is not a plain semantic version (x.y.z).`, "blocked");
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

export const maxBump = (bumps: Bump[]): Bump =>
  bumps.reduce<Bump>((a, b) => (BUMPS.indexOf(b) > BUMPS.indexOf(a) ? b : a), "patch");

const today = () => new Date().toISOString().slice(0, 10);

export function initialChangelog(version: string, entry: string): string {
  return `# Changelog

All notable changes to this app. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions: [Semantic Versioning](https://semver.org/). Change docs: \`docs/changes/\`.

## [Unreleased]

## [${version}] - ${today()}

### Added

- ${entry}
`;
}

/** Items under ## [Unreleased] (without the heading), trimmed. */
export function unreleased(changelog: string): string {
  const m = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|$)/.exec(changelog);
  return (m?.[1] ?? "").trim();
}

/** Move Unreleased (plus extra lines) into a new version section. */
export function releaseChangelog(changelog: string, version: string, extra: string[]): string {
  if (!changelog.includes("## [Unreleased]")) {
    throw new ShipError("CHANGELOG.md has no ## [Unreleased] section.", "blocked");
  }
  if (changelog.includes(`## [${version}]`)) {
    throw new ShipError(`CHANGELOG.md already has ## [${version}].`, "blocked");
  }
  const pending = unreleased(changelog);
  const body = mergeChangelogBlocks(
    extra.length ? `### Changed\n\n${extra.map((l) => `- ${l}`).join("\n")}` : "",
    pending,
  );
  if (!body)
    throw new ShipError(
      "Nothing to release: ## [Unreleased] is empty and no change docs are pending.",
      "blocked",
    );
  return changelog.replace(
    /## \[Unreleased\]\n[\s\S]*?(?=\n## \[|$)/,
    `## [Unreleased]\n\n## [${version}] - ${today()}\n\n${body}\n`,
  );
}

/** `### Heading` blocks of changelog lines, in order of first appearance (null: no heading). */
function sectionsOf(text: string): Map<string | null, string[]> {
  const out = new Map<string | null, string[]>();
  let cur: string | null = null;
  for (const line of text.split("\n")) {
    const h = /^### (.+?)\s*$/.exec(line);
    if (h?.[1]) {
      cur = h[1];
      if (!out.has(cur)) out.set(cur, []);
    } else if (line.trim()) {
      if (!out.has(cur)) out.set(cur, []);
      out.get(cur)?.push(line);
    }
  }
  return out;
}

/** Changelog lines from several blocks, one `### Heading` each. */
export function mergeChangelogBlocks(...blocks: string[]): string {
  const merged = new Map<string | null, string[]>();
  for (const b of blocks)
    for (const [h, lines] of sectionsOf(b))
      merged.set(h, [
        ...(merged.get(h) ?? []),
        ...lines.filter((l) => !merged.get(h)?.includes(l)),
      ]);
  return [...merged]
    .filter(([, lines]) => lines.length)
    .map(([h, lines]) => (h ? `### ${h}\n\n${lines.join("\n")}` : lines.join("\n")))
    .join("\n\n");
}

const setUnreleased = (changelog: string, body: string) =>
  changelog.replace(
    /## \[Unreleased\]\n[\s\S]*?(?=\n## \[|$)/,
    `## [Unreleased]\n${body ? `\n${body}\n` : ""}`,
  );

/**
 * Undo a release section: its lines go back under Unreleased and the heading goes. `ship refresh`
 * does this before merging main, then bumps again on top of main's version.
 */
export function reopenChangelog(changelog: string, version: string): string {
  const re = new RegExp(
    `\\n## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`,
  );
  const m = re.exec(changelog);
  if (!m) return changelog;
  const without = changelog.replace(re, "");
  return setUnreleased(without, mergeChangelogBlocks(unreleased(without), m[1] ?? ""));
}

/**
 * Resolve merge conflicts in a changelog: each side's lines are kept, this branch's first, and the
 * Unreleased section is tidied into one block per heading. Unresolvable text (no markers) is kept.
 */
export function resolveChangelogConflicts(text: string): string {
  const out: string[] = [];
  let mode: "none" | "ours" | "base" | "theirs" = "none";
  let ours: string[] = [];
  let theirs: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("<<<<<<< ")) {
      mode = "ours";
      ours = [];
      theirs = [];
    } else if (mode !== "none" && line.startsWith("||||||| ")) mode = "base";
    else if (mode !== "none" && line === "=======") mode = "theirs";
    else if (mode !== "none" && line.startsWith(">>>>>>> ")) {
      out.push(...ours, ...(ours.length && theirs.length ? [""] : []), ...theirs);
      mode = "none";
    } else if (mode === "ours") ours.push(line);
    else if (mode === "theirs") theirs.push(line);
    else if (mode === "none") out.push(line);
  }
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return joined.includes("## [Unreleased]")
    ? setUnreleased(joined, mergeChangelogBlocks(unreleased(joined)))
    : joined;
}

export function addUnreleased(changelog: string, line: string, heading = "Changed"): string {
  const current = unreleased(changelog);
  const block = current.includes(`### ${heading}`)
    ? current.replace(`### ${heading}\n`, `### ${heading}\n\n- ${line}\n`).replace("\n\n\n", "\n\n")
    : `${current ? `${current}\n\n` : ""}### ${heading}\n\n- ${line}`;
  return changelog.replace(
    /## \[Unreleased\]\n[\s\S]*?(?=\n## \[|$)/,
    `## [Unreleased]\n\n${block}\n`,
  );
}

// ---------------------------------------------------------------- change docs

export const ChangeFrontMatter = z.object({
  change: z.number().int().positive(),
  app: z.string(),
  title: z.string().min(3),
  bump: z.enum(["patch", "minor", "major"]),
  released: z.string().nullable(),
  /** The task that asked for it (ADR 0017): `owner/shipify#12`, written by `ship change new`. */
  task: z.string().optional(),
});
export type ChangeFrontMatter = z.infer<typeof ChangeFrontMatter>;

export interface ChangeDoc {
  file: string;
  meta: ChangeFrontMatter;
  body: string;
  raw: string;
}

export const changesDir = (appDir: string) => join(appDir, "docs", "changes");

export function parseChange(raw: string, file: string): ChangeDoc {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m?.[1] || m[2] === undefined)
    throw new ShipError(`${file} needs YAML front matter.`, "blocked");
  const fm = YAML.parse(m[1]) as Record<string, unknown> | null;
  // The line people forget when they write one by hand rather than with `ship change new`.
  if (fm && typeof fm === "object" && !("released" in fm))
    throw new ShipError(
      `${file} has no "released:" line: add "released: null" if it hasn't shipped, or "released: vX.Y.Z" with the version that shipped it (CHANGELOG.md says which).`,
      "blocked",
    );
  const parsed = ChangeFrontMatter.safeParse(fm);
  if (!parsed.success) {
    throw new ShipError(
      `${file} front matter is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      "blocked",
    );
  }
  return { file, meta: parsed.data, body: m[2], raw };
}

export function listChanges(appDir: string): ChangeDoc[] {
  const dir = changesDir(appDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    .sort()
    .map((f) => parseChange(readFileSync(join(dir, f), "utf8"), join(dir, f)));
}

export function setReleased(doc: ChangeDoc, version: string): void {
  writeFileSync(doc.file, doc.raw.replace(/^released: null$/m, `released: v${version}`));
}

/** The reverse of setReleased, for a doc stamped with this version. */
export function unsetReleased(doc: ChangeDoc, version: string): boolean {
  const next = doc.raw.replace(
    new RegExp(`^released: v?${version.replace(/\./g, "\\.")}$`, "m"),
    "released: null",
  );
  if (next === doc.raw) return false;
  writeFileSync(doc.file, next);
  return true;
}

/** Docs written when an app is created: living spec, frozen change 0001, changelog. */
export function writeCreationDocs(
  dir: string,
  input: { app: string; name: string; plan?: Plan; version: string },
) {
  mkdirSync(changesDir(dir), { recursive: true });
  const title = input.plan?.meta.title ?? `Create ${input.name}`;
  const specBody = input.plan
    ? stripSections(input.plan.body, [
        "## Tasks",
        "## Verification",
        "## Open questions",
        "## Complexity exceptions",
      ])
    : `\n# ${input.name}\n\n## Goal\n\n${input.name}.\n\n## Stories\n\n- None yet. Add them with change docs.\n`;
  writeFileSync(
    join(dir, "docs", "spec.md"),
    `<!-- Living spec: what this app is NOW. Every change doc's implementation updates it.
     History: docs/changes/. Releases: CHANGELOG.md. -->\n${specBody.trimEnd()}\n`,
  );
  const fm = YAML.stringify({
    change: 1,
    app: input.app,
    title,
    bump: "minor",
    released: `v${input.version}`,
  }).trimEnd();
  const source = input.plan
    ? `Approved as \`shipify/plans/${input.app}.plan.md\` r${input.plan.meta.revision} (hash \`${input.plan.hash}\`).\n`
    : "Created directly from the stack (no plan).\n";
  writeFileSync(
    join(changesDir(dir), "0001-create.md"),
    `---\n${fm}\n---\n\n# 0001: ${title}\n\n${source}${input.plan ? input.plan.body : ""}`.trimEnd() +
      "\n",
  );
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    initialChangelog(input.version, `${title} (docs/changes/0001-create.md).`),
  );
}

function stripSections(body: string, headings: string[]): string {
  const parts = body.split(/\n(?=## )/);
  return parts.filter((p) => !headings.some((h) => p.startsWith(h))).join("\n");
}

// ---------------------------------------------------------------- diagrams

/** The diagram types Mermaid knows: the first word of a block. */
const MERMAID_TYPE =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey-beta|xychart-beta|block-beta|architecture-beta|packet-beta|kanban)\b/;

/**
 * The Mermaid blocks in a markdown text, and a problem for each one that can't be a diagram: never
 * closed, no known diagram type, or nothing drawn. A light check that needs no renderer.
 */
export function mermaidBlocks(text: string): { count: number; problems: string[] } {
  const problems: string[] = [];
  const blocks = text.split(/^```mermaid[ \t]*$/m).slice(1);
  blocks.forEach((rest, i) => {
    const end = rest.search(/^```[ \t]*$/m);
    if (end < 0) {
      problems.push(`diagram ${i + 1} is never closed`);
      return;
    }
    let lines = rest
      .slice(0, end)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("%%"));
    // An optional config block (--- title: … ---) comes before the diagram type.
    if (lines[0] === "---") lines = lines.slice(lines.indexOf("---", 1) + 1);
    const first = lines[0] ?? "";
    if (!MERMAID_TYPE.test(first))
      problems.push(
        `diagram ${i + 1} starts with "${first.slice(0, 30)}", not a diagram type (flowchart, sequenceDiagram, …)`,
      );
    else if (lines.length < 2) problems.push(`diagram ${i + 1} draws nothing`);
  });
  return { count: blocks.length, problems };
}
