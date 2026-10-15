// Recipes (ADR 0032, docs/recipes.md): a repeat written as a file, `recipes/<name>.md`, approved by
// merging it. Three settings in its front matter, all a repeat's own (`when`, and optionally `check`
// and `model`), and the job as its body. No engine of its own: the due run keeps one task per recipe
// ("Recipe: <name>"), its run sets the repeat from the file, and each time it runs like any repeat,
// reading the body from main. A recipe never carries permissions of its own: unattended changes are
// tools.json's pre-approved calls, as for every repeat. Every file passes tests/recipes.test.ts.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { PICK } from "../contracts/index.ts";
import { parseSchedule } from "./repeat.ts";

/** A recipe's name: its file's, `recipes/<name>.md`. */
export const RECIPE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** A recipe task's title, by which the due run finds it. */
export const recipeTitle = (name: string) => `Recipe: ${name}`;
export const recipeOf = (title: string) => /^Recipe: ([a-z0-9][a-z0-9-]{0,62})$/.exec(title)?.[1];
/** The label every recipe task carries (with `repeats`). */
export const RECIPE_LABEL = {
  name: "recipe",
  color: "5319e7",
  description: "A recipe's task: its file in recipes/ says what it does. Close it to pause",
} as const;
/** The body at most: what the agent is asked each time. */
const MAX_BODY = 8_000;

export const RecipeFile = z
  .object({
    /** When it runs, in a repeat's words: "every weekday at 08:30". */
    when: z.string().trim().min(1).max(120),
    /** A check (checks/<name>.mjs) that gates it: the agent runs only when its output changes. */
    check: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "a check is named like checks/<name>.mjs")
      .optional(),
    /** The model it thinks with, as a `use` line names it: "opus", "opus high", "pi z-ai/glm-5.3". */
    model: z.string().max(140).regex(PICK).optional(),
  })
  .strict();

export interface Recipe {
  name: string;
  when: string;
  check?: string;
  model?: string;
  /** What the agent is asked each time. */
  body: string;
  /** The file's hash: a change starts its task's run, which updates the repeat. */
  hash: string;
}

/** A recipe file read: the recipe, or the one thing wrong with it and how to fix it. */
export function readRecipe(
  name: string,
  text: string,
  opts: { checks?: (n: string) => boolean } = {},
): { recipe: Recipe } | { problem: string } {
  if (!RECIPE_NAME.test(name))
    return { problem: `the file's name is lowercase letters, digits and -: recipes/<name>.md` };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m)
    return {
      problem:
        "it starts with --- front matter (when:, and optionally check: and model:), then ---",
    };
  let raw: unknown;
  try {
    raw = parse(m[1] ?? "") ?? {};
  } catch (e) {
    return { problem: `its front matter isn't YAML: ${(e as Error).message.split("\n")[0]}` };
  }
  const front = RecipeFile.safeParse(raw);
  if (!front.success) {
    const i = front.error.issues[0];
    return {
      problem:
        i?.code === "unrecognized_keys"
          ? `it says ${i.keys.join(", ")}: a recipe takes only when, check and model`
          : `${i?.path.join(".") || "its front matter"}: ${i?.message ?? "doesn't read"}`,
    };
  }
  if (!parseSchedule(front.data.when))
    return {
      problem: `“${front.data.when}” isn't a schedule: try “every day at 09:00”, “every weekday at 08:30” or “every Monday at 9”`,
    };
  if (front.data.check && opts.checks && !opts.checks(front.data.check))
    return { problem: `there's no checks/${front.data.check}.mjs` };
  const body = (m[2] ?? "").trim();
  if (!body) return { problem: "its body is empty: say what the agent should do each time" };
  if (body.length > MAX_BODY) return { problem: `its body is over ${MAX_BODY} characters` };
  return {
    recipe: {
      name,
      when: front.data.when,
      ...(front.data.check ? { check: front.data.check } : {}),
      ...(front.data.model ? { model: front.data.model } : {}),
      body,
      hash: createHash("sha256").update(text).digest("hex").slice(0, 12),
    },
  };
}

/** Every recipe in a folder (`recipes/`, not its examples): each read, or what's wrong with it. */
export function readRecipes(root: string, dir = "recipes") {
  const at = join(root, dir);
  const checks = (n: string) => existsSync(join(root, "checks", `${n}.mjs`));
  const recipes: Recipe[] = [];
  const problems: { file: string; problem: string }[] = [];
  const files = existsSync(at)
    ? readdirSync(at).filter((f) => f.endsWith(".md") && f !== "README.md")
    : [];
  for (const f of files.sort()) {
    const r = readRecipe(f.slice(0, -3), readFileSync(join(at, f), "utf8"), { checks });
    if ("recipe" in r) recipes.push(r.recipe);
    else problems.push({ file: `${dir}/${f}`, problem: r.problem });
  }
  return { recipes, problems };
}

/** One recipe by name, from main's copy: read, gone, or what's wrong with it. */
export function recipeFile(root: string, name: string) {
  const file = join(root, "recipes", `${name}.md`);
  if (!RECIPE_NAME.test(name) || !existsSync(file)) return { gone: true as const };
  return readRecipe(name, readFileSync(file, "utf8"), {
    checks: (n) => existsSync(join(root, "checks", `${n}.mjs`)),
  });
}
