// The product and your copy (ADR 0047): Shipify's own files go to the template, one clean commit per
// version (`ship template`), and come back to every copy as one PR (`ship update`, update.yml). Your
// files are never in either: your plans, recipes and checks, and the apps your forms list.
import { stripVTControlCharacters } from "node:util";
import { FORM_PROJECTS, formIds, setFormProjects } from "./forms.ts";

/**
 * Yours: in your copy alone. Your folders, and what each keeps of the product's (its README, its
 * examples); and Dependabot's config, which brings Shipify's own pins up to date where Shipify is
 * built (a copy takes them with each version's update).
 */
const YOURS: { dir: string; product: string[] }[] = [
  { dir: "plans/", product: ["plans/.gitkeep"] },
  { dir: "recipes/", product: ["recipes/README.md", "recipes/examples/"] },
  { dir: "checks/", product: ["checks/README.md", "checks/example.mjs"] },
  { dir: ".github/dependabot.yml", product: [] },
];

/** A file of yours (a tracked path): never published, never touched by an update. */
export const isYours = (path: string) =>
  YOURS.some(
    (y) =>
      path.startsWith(y.dir) &&
      !y.product.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p)),
  );

/** The product's files among these tracked paths: every one but yours. */
export const productFiles = (tracked: string[]) => tracked.filter((p) => !isYours(p));

/** A form as the template has it: its list of apps empty, for each copy's own (`ship forms`). */
export const templateForm = (file: string, text: string) =>
  file in FORM_PROJECTS ? setFormProjects(text, []) : text;

/** A form as an update leaves it: the template's, with the apps this copy's form listed. */
export const keptForm = (file: string, theirs: string, yours: string) =>
  file in FORM_PROJECTS ? setFormProjects(theirs, formIds(yours)) : theirs;

/** A release's tag (`v0.1.1`) as a version, or undefined when it isn't one. */
export const versionOf = (tag: string) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];

/** A repo's owner/name, as GitHub allows them. */
export const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/**
 * The template a version file names (`"shipify": { "template": "owner/name" }`), or undefined. A
 * release writes it, so a copy made from the template knows it whoever can read what.
 */
export function templateIn(text: string | undefined): string | undefined {
  try {
    const t = (JSON.parse(text ?? "") as { shipify?: { template?: unknown } }).shipify?.template;
    return typeof t === "string" && REPO.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** A version file as a release leaves it: at its version, naming the template it's published to. */
export function released(text: string, version: string, template: string): string {
  const file = JSON.parse(text) as { shipify?: object };
  return `${JSON.stringify({ ...file, version, shipify: { ...file.shipify, template } }, null, 2)}\n`;
}

// ---------------------------------------------------------------- what's never published (ADR 0055)

/** Your words never published, each with its stand-in (SHIPIFY_PRIVATE_WORDS), or why it's wrong. */
export function privateWords(
  json: string | undefined,
): Record<string, string> | { problem: string } {
  if (!json?.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return { problem: 'SHIPIFY_PRIVATE_WORDS isn\'t JSON: {"<word>": "<stand-in>"}' };
  }
  if (!v || typeof v !== "object" || Array.isArray(v))
    return { problem: 'SHIPIFY_PRIVATE_WORDS isn\'t {"<word>": "<stand-in>"}' };
  const out: Record<string, string> = {};
  for (const [word, stand] of Object.entries(v)) {
    if (typeof stand !== "string" || word.trim().length < 3)
      return { problem: `SHIPIFY_PRIVATE_WORDS: "${word}" needs 3 letters or more and a stand-in` };
    if (stand.toLowerCase().includes(word.toLowerCase()))
      return { problem: `SHIPIFY_PRIVATE_WORDS: "${word}"'s stand-in contains it` };
    out[word] = stand;
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The stand-in in the found word's case: ACME for GLOBEX, Acme for Globex, acme for globex. */
const inCase = (found: string, stand: string) =>
  found === found.toUpperCase() && found !== found.toLowerCase()
    ? stand.toUpperCase()
    : found[0] === found[0]?.toUpperCase() && found[0] !== found[0]?.toLowerCase()
      ? stand[0]?.toUpperCase() + stand.slice(1)
      : stand;

/** Text with each of your words replaced by its stand-in, in any case, the longest first. */
export function replaceWords(text: string, words: Record<string, string>): string {
  let out = text;
  for (const word of Object.keys(words).sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(escapeRe(word), "gi"), (m) => inCase(m, words[word] as string));
  return out;
}

/** A tailnet's own name (`<host>.tail1a2b3c.ts.net`): it says which network your machines are on. */
const TAILNET = /\b[a-z0-9-]+\.tail[0-9a-f]{6,}\.ts\.net\b/i;

/** What in this text must not be published: one of your words, or a tailnet's name. */
export function unpublishable(text: string, words: Record<string, string>): string | undefined {
  for (const word of Object.keys(words))
    if (new RegExp(escapeRe(word), "i").test(text)) return `your word "${word}"`;
  if (TAILNET.test(text)) return "a tailnet's name";
  return undefined;
}

/**
 * What a failed check names, from its output, for a reply that has no log in view: each failing
 * test (the test runner's `FAIL` lines) and the first error after them, else the first lines that
 * say an error (the format, lint, types or install). At most five lines, each cut to 200
 * characters.
 */
export function checkFailures(output: string): string[] {
  const lines = stripVTControlCharacters(output).split("\n");
  const cut = (l: string) => l.trim().slice(0, 200);
  const failed = [
    ...new Set(lines.map((l) => /^\s*FAIL\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean)),
  ] as string[];
  if (failed.length) {
    const after = lines.slice(lines.findIndex((l) => /^\s*FAIL\s/.test(l)));
    const error = after.find((l) => /^\s*(\w*Error|ERR_\w+)\b[^:]*:/.test(l));
    return [
      ...failed.slice(0, error ? 4 : 5).map((t) => `Failed: ${cut(t)}`),
      ...(error ? [cut(error)] : []),
    ];
  }
  return lines
    .filter(
      (l) => /\berror\b|ERR_PNPM|×/i.test(l) && !/ELIFECYCLE|Command failed with exit/.test(l),
    )
    .slice(0, 5)
    .map(cut);
}
