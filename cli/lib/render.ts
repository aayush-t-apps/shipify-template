import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";
import { ShipError } from "./output.ts";

const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2"]);
/** Only UPPER_SNAKE placeholders, so GitHub expressions like ${{ github.sha }} pass through. */
const VAR_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
/** Files stored under a safe name in the platform repo and renamed on render. */
const RENAMES: Record<string, string> = { _gitignore: ".gitignore", _npmrc: ".npmrc" };

/**
 * Line-level conditionals: lines between `#if NAME` and `#endif` markers (inside any comment,
 * e.g. `# #if STAGING`, `// #if !STAGING` or SQL's `-- #if OPTION_D1`) are kept when
 * vars[NAME] === "true" (or not, with `!`). The marker lines themselves are removed. No nesting.
 */
const IF_RE = /^\s*(?:#|\/\/|<!--|--)\s*#if\s+(!?)([A-Z][A-Z0-9_]*)\s*(?:-->)?\s*$/;
const ENDIF_RE = /^\s*(?:#|\/\/|<!--|--)\s*#endif\s*(?:-->)?\s*$/;

export function applyConditionals(
  text: string,
  vars: Record<string, string>,
  file: string,
): string {
  const out: string[] = [];
  let keep: boolean | undefined;
  for (const line of text.split("\n")) {
    const m = IF_RE.exec(line);
    if (m) {
      if (keep !== undefined) throw new ShipError(`Nested #if in ${file}.`);
      const [, neg, key] = m as unknown as [string, string, string];
      if (vars[key] === undefined) throw new ShipError(`Unknown #if ${key} in ${file}.`);
      keep = (vars[key] === "true") !== (neg === "!");
      continue;
    }
    if (ENDIF_RE.test(line)) {
      if (keep === undefined) throw new ShipError(`#endif without #if in ${file}.`);
      keep = undefined;
      continue;
    }
    if (keep !== false) out.push(line);
  }
  if (keep !== undefined) throw new ShipError(`Unclosed #if in ${file}.`);
  return out.join("\n");
}

export function renderString(
  text: string,
  vars: Record<string, string>,
  file = "<string>",
): string {
  return applyConditionals(text, vars, file).replace(VAR_RE, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new ShipError(`Unknown template variable {{${key}}} in ${file}.`);
    return v;
  });
}

/** Copy srcDir into destDir, substituting variables. Later layers overwrite earlier ones. */
export function renderLayer(
  srcDir: string,
  destDir: string,
  vars: Record<string, string>,
): string[] {
  const written: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src = join(dir, entry.name);
      const relPath = relative(srcDir, src)
        .split("/")
        .map((seg) => RENAMES[seg] ?? seg)
        .join("/");
      const dest = join(destDir, relPath);
      // Folders come with the files in them, so one whose files were all left out isn't made.
      if (entry.isDirectory()) walk(src);
      else if (entry.isFile()) {
        const binary = BINARY.has(extname(entry.name));
        const text = binary ? "" : renderString(readFileSync(src, "utf8"), vars, relPath);
        // A template whose every line was conditional, all off, isn't written: a file that only a
        // stack option brings (a D1 app's first migration).
        if (!binary && !text.trim()) continue;
        mkdirSync(join(dest, ".."), { recursive: true });
        if (binary) copyFileSync(src, dest);
        else writeFileSync(dest, text);
        chmodSync(dest, statSync(src).mode & 0o777); // keep hooks executable
        written.push(relPath);
      }
    }
  };
  walk(srcDir);
  return written;
}

/** List the files a render would produce, without writing. */
export function listLayer(srcDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src = join(dir, entry.name);
      if (entry.isDirectory()) walk(src);
      else
        out.push(
          relative(srcDir, src)
            .split("/")
            .map((s) => RENAMES[s] ?? s)
            .join("/"),
        );
    }
  };
  walk(srcDir);
  return out;
}
