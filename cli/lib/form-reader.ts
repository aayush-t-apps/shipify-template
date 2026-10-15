// Reading the task forms' answers (.github/ISSUE_TEMPLATE/*.yml), from the templates themselves:
// which form an issue came from, its answers by field id, and what's wrong with them. GitHub writes
// a form's answers into the issue as "### <label>" sections, so a new form needs no reading code of
// its own. (forms.ts keeps the forms' project lists current.)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export interface FormField {
  id: string;
  type: "input" | "textarea" | "dropdown" | "checkboxes";
  label: string;
  required: boolean;
  options: string[];
  /** A dropdown with a default always has an answer, so its heading can't tell forms apart. */
  defaulted: boolean;
}

export interface Form {
  /** The file's name without its number: "repeat" for 4-repeat.yml. */
  id: string;
  name: string;
  fields: FormField[];
}

/** Text for inputs, textareas and dropdowns; the ticked boxes for checkboxes. */
export type Answers = Record<string, string | string[] | undefined>;

export interface FormRead {
  form: Form;
  answers: Answers;
  problems: string[];
}

interface Template {
  name?: string;
  body?: {
    type?: string;
    id?: string;
    attributes?: { label?: string; options?: (string | { label?: string })[]; default?: number };
    validations?: { required?: boolean };
  }[];
}

/** Every form in a folder of issue templates (config.yml isn't one). */
export function loadForms(dir: string): Form[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !/^config\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const t = YAML.parse(readFileSync(join(dir, file), "utf8")) as Template;
      const fields = (t.body ?? [])
        .filter((b) => b.type !== "markdown" && b.id && b.attributes?.label)
        .map((b) => ({
          id: b.id as string,
          type: b.type as FormField["type"],
          label: String(b.attributes?.label ?? "").trim(),
          required: b.validations?.required === true,
          options: (b.attributes?.options ?? []).map((o) =>
            (typeof o === "string" ? o : (o.label ?? "")).trim(),
          ),
          defaulted: b.attributes?.default !== undefined,
        }));
      return {
        id: file.replace(/^\d+-/, "").replace(/\.ya?ml$/, ""),
        name: t.name ?? file,
        fields,
      };
    });
}

/** A body's "### <label>" sections: label → what's under it. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.replace(/\r\n/g, "\n").split(/^### +(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2)
    out.set((parts[i] as string).trim(), (parts[i + 1] ?? "").trim());
  return out;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The form an issue came from, with its answers and their problems. A form matches when at least
 * half its fields' headings are there, so an issue that happens to use one heading isn't taken for
 * a form, and an edit that removes a field still reads as that form and says what's missing. A
 * dropdown with a default (Model) doesn't count: every issue from its forms has it. The closest
 * match wins (most headings found, then the fewest fields).
 */
export function readForm(body: string | null, forms: Form[]): FormRead | undefined {
  const secs = sections(body ?? "");
  if (!secs.size) return undefined;
  const has = (label: string) => [...secs.keys()].some((k) => same(k, label));
  const scored = forms
    .map((form) => ({ form, own: form.fields.filter((f) => !f.defaulted) }))
    .filter((s) => s.own.length)
    .map((s) => ({ ...s, found: s.own.filter((f) => has(f.label)).length }))
    .filter((s) => s.found > 0 && s.found * 2 >= s.own.length)
    .sort((a, b) => b.found - a.found || a.own.length - b.own.length);
  const form = scored[0]?.form;
  if (!form) return undefined;
  const answers: Answers = {};
  const problems: string[] = [];
  for (const f of form.fields) {
    const raw = [...secs.entries()].find(([k]) => same(k, f.label))?.[1];
    const text = raw && raw !== "_No response_" ? raw : undefined;
    if (f.type === "checkboxes") {
      const ticked = [...(raw ?? "").matchAll(/^- \[[xX]\] +(.+)$/gm)].map((m) =>
        (m[1] as string).trim(),
      );
      answers[f.id] = ticked;
      if (f.required && !ticked.length) problems.push(`“${f.label}” has nothing ticked.`);
      continue;
    }
    answers[f.id] = text;
    if (!text) {
      if (f.required) problems.push(`“${f.label}” is empty.`);
    } else if (f.type === "dropdown" && f.options.length) {
      const option = f.options.find((o) => same(o, text));
      if (option) answers[f.id] = option;
      else
        problems.push(
          `“${f.label}” says “${text}”, which isn't one of its choices: ${f.options.join(", ")}.`,
        );
    }
  }
  return { form, answers, problems };
}
