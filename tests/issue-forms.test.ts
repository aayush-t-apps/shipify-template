// The New issue page's forms (.github/ISSUE_TEMPLATE, ADR 0028), held to GitHub's rules for issue
// forms, so a form GitHub would refuse or leave off the page can't merge.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { loadForms } from "../cli/lib/form-reader.ts";
import { parseTask } from "../cli/lib/task.ts";
import { ROOT } from "./helpers.ts";

const dir = join(ROOT, ".github", "ISSUE_TEMPLATE");
const files = readdirSync(dir).filter((f) => /^\d+-.+\.yml$/.test(f));
interface Element {
  type: string;
  id?: string;
  attributes?: { label?: string; value?: string; options?: unknown[]; default?: number };
  validations?: { required?: boolean };
}
const form = (f: string) =>
  YAML.parse(readFileSync(join(dir, f), "utf8")) as {
    name?: string;
    description?: string;
    title?: string;
    body?: Element[];
  };

describe("the issue forms", () => {
  // Two forms (ADR 0031): everything else is a blank issue in plain words. The core links the Operate
  // form by name (an operation asked from a chat is pointed there).
  it("are the two, Repeat and Operate", () => {
    expect(files).toEqual(["4-repeat.yml", "7-operate.yml"]);
  });

  it.each(files)("%s keeps GitHub's rules for a form", (f) => {
    const t = form(f);
    expect(t.name, "a name").toBeTruthy();
    expect(t.description, "a description").toBeTruthy();
    // One short line, the same for every form: the two over 200 characters (Repeat, Make a
    // recipe) were left off the New issue page.
    expect(t.description?.length, "a description of one short line").toBeLessThanOrEqual(100);
    const body = t.body ?? [];
    // GitHub lists a form only with at least one field to fill in.
    const fields = body.filter((e) => e.type !== "markdown");
    expect(fields.length, "at least one field that isn't markdown").toBeGreaterThan(0);
    const ids = fields.map((e) => e.id);
    expect(new Set(ids).size, "unique ids").toBe(ids.length);
    for (const e of body) {
      expect(["markdown", "textarea", "input", "dropdown", "checkboxes"]).toContain(e.type);
      if (e.type === "markdown") {
        expect(e.attributes?.value, "markdown has its text").toBeTruthy();
        expect(e.validations, "markdown can't be required").toBeUndefined();
        continue;
      }
      expect(e.id, "an id").toMatch(/^[A-Za-z0-9_-]+$/);
      expect(e.attributes?.label, `${e.id} has a label`).toBeTruthy();
      if (e.type === "dropdown" || e.type === "checkboxes") {
        const options = e.attributes?.options ?? [];
        expect(options.length, `${e.id} has options`).toBeGreaterThan(0);
        const names = options.map((o) =>
          typeof o === "string" ? o : (o as { label: string }).label,
        );
        expect(new Set(names).size, `${e.id}'s options are unique`).toBe(names.length);
        if (e.attributes?.default !== undefined)
          expect(e.attributes.default).toBeLessThan(options.length);
      }
    }
    const labels = fields.map((e) => e.attributes?.label);
    expect(new Set(labels).size, "unique labels").toBe(labels.length);
  });

  it("the chooser is the forms and a blank issue, nothing else", () => {
    const c = YAML.parse(readFileSync(join(dir, "config.yml"), "utf8")) as {
      blank_issues_enabled: boolean;
      contact_links?: unknown[];
    };
    // The GitHub app can't fill in forms: a blank issue is its way in.
    expect(c.blank_issues_enabled).toBe(true);
    expect(c.contact_links, "no extra links").toBeUndefined();
  });

  it("each form's answers read as its kind, whatever its title says", () => {
    const forms = loadForms(dir);
    const body = (answers: Record<string, string>) =>
      Object.entries(answers)
        .map(([label, v]) => `### ${label}\n\n${v}`)
        .join("\n\n");
    // The Operate form: its Project and Action fields win, whatever the title says.
    expect(
      parseTask(
        "anything",
        body({ Project: "spotter", Action: "Take it down", Version: "_No response_" }),
        forms,
      ),
    ).toMatchObject({ kind: "op", project: "spotter", op: "down" });
    // The Repeat form reads as its words: the box sets the repeat from its fields.
    expect(
      parseTask(
        "repeat: ",
        body({
          What: "Stretch",
          When: "every day at 09:00",
          Kind: "A reminder (posts the text; no agent)",
        }),
        forms,
      ).kind,
    ).toBe("none");
  });
});
