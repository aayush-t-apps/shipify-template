// Recipes (ADR 0032, cli/lib/recipes.ts): the file's three settings and its body, each wrong one
// named with its fix; and every file in recipes/ and recipes/examples/ reads, so a merged recipe
// never surprises you.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRecipe, readRecipes, recipeFile, recipeOf, recipeTitle } from "../cli/lib/recipes.ts";
import { ROOT } from "./helpers.ts";

const file = (front: string, body = "Say what's new.") => `---\n${front}\n---\n${body}\n`;
const problem = (text: string, checks?: (n: string) => boolean) => {
  const r = readRecipe("brief", text, checks ? { checks } : {});
  return "problem" in r ? r.problem : undefined;
};

describe("a recipe file", () => {
  it("reads when, check, model and its body, with a hash that changes with it", () => {
    const r = readRecipe(
      "daily-brief",
      file("when: every weekday at 08:30\ncheck: example\nmodel: sonnet", "Brief me."),
      { checks: () => true },
    );
    expect(r).toMatchObject({
      recipe: {
        name: "daily-brief",
        when: "every weekday at 08:30",
        check: "example",
        model: "sonnet",
        body: "Brief me.",
      },
    });
    const other = readRecipe("daily-brief", file("when: every weekday at 08:30", "Brief me more."));
    expect("recipe" in r && "recipe" in other && r.recipe.hash !== other.recipe.hash).toBe(true);
  });

  it("takes any agent's choice as a `use` line names it: an agent, its model, an effort", () => {
    for (const model of ["opus high", "pi", "pi laguna", "pi qwen/qwen3-coder:free low"]) {
      const r = readRecipe("brief", file(`when: every day at 09:00\nmodel: ${model}`));
      expect("recipe" in r && r.recipe.model, model).toBe(model);
    }
    expect(problem(file("when: every day at 09:00\nmodel: pi laguna high now"))).toBeTruthy();
  });

  it("names what's wrong, and how to fix it", () => {
    expect(problem("no front matter")).toContain("starts with --- front matter");
    expect(problem(file("when: [unclosed"))).toContain("isn't YAML");
    expect(problem(file("check: example"))).toContain("when");
    expect(problem(file("when: whenever"))).toContain("isn't a schedule");
    expect(problem(file("when: every day at 09:00\nact: notion.create_page"))).toContain(
      "takes only when, check and model",
    );
    expect(problem(file("when: every day at 09:00\ncheck: nope"), () => false)).toBe(
      "there's no checks/nope.mjs",
    );
    expect(problem(file("when: every day at 09:00", ""))).toContain("its body is empty");
    expect(problem(file("when: every day at 09:00", "x".repeat(9000)))).toContain("over 8000");
    expect("problem" in readRecipe("Bad Name", file("when: every day at 09:00"))).toBe(true);
  });

  it("finds its task by title, both ways", () => {
    expect(recipeTitle("daily-brief")).toBe("Recipe: daily-brief");
    expect(recipeOf("Recipe: daily-brief")).toBe("daily-brief");
    expect(recipeOf("recipe: daily-brief")).toBeUndefined();
    expect(recipeOf("Recipe: ../x")).toBeUndefined();
  });

  it("reads a folder: live recipes only (not README or examples), each read or named wrong", () => {
    const root = mkdtempSync(join(tmpdir(), "recipes-"));
    mkdirSync(join(root, "recipes", "examples"), { recursive: true });
    mkdirSync(join(root, "checks"));
    writeFileSync(join(root, "checks", "price.mjs"), "console.log(1)");
    writeFileSync(join(root, "recipes", "README.md"), "# Recipes");
    writeFileSync(join(root, "recipes", "examples", "x.md"), file("when: every day at 09:00"));
    writeFileSync(join(root, "recipes", "brief.md"), file("when: every day at 09:00"));
    writeFileSync(join(root, "recipes", "price.md"), file("when: every hour\ncheck: price"));
    writeFileSync(join(root, "recipes", "broken.md"), file("when: sometimes"));
    const r = readRecipes(root);
    expect(r.recipes.map((x) => x.name)).toEqual(["brief", "price"]);
    expect(r.problems).toEqual([
      { file: "recipes/broken.md", problem: expect.stringContaining("isn't a schedule") },
    ]);
    expect(recipeFile(root, "gone")).toEqual({ gone: true });
    expect(recipeFile(root, "../etc")).toEqual({ gone: true });
  });
});

describe("every recipe here keeps its contract", () => {
  it("recipes/ and recipes/examples/ read, with no problem", () => {
    for (const dir of ["recipes", "recipes/examples"]) {
      const r = readRecipes(ROOT, dir);
      expect(r.problems, dir).toEqual([]);
    }
    expect(
      readRecipes(ROOT, "recipes/examples")
        .recipes.map((r) => r.name)
        .sort(),
    ).toEqual(["daily-brief", "site-watch", "weekly-dependencies", "weekly-lessons"]);
  });
});
