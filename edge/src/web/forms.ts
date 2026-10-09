// A new repeat from the page (ADR 0036, "☰ Repeats"): the GitHub Repeat form's own fields, checked
// as the core will check them, then written as one new task through the door, under the form's
// own headings. The core reads a body by its `### <label>` headings, whoever wrote it, so it sets
// the repeat with no agent, as it does for the form. tests/edge/web/extension.test.ts keeps these
// labels and choices in step with .github/ISSUE_TEMPLATE/4-repeat.yml.
import { parseSchedule, tooOften } from "../../../cli/lib/repeat.ts";

export const REPEAT_KINDS = [
  "A reminder (posts the text; no agent)",
  "A job for the agent (quiet when there's nothing to do)",
  "A check (a script from checks/; says only what changed; no agent)",
] as const;
export const REPEAT_MODELS = [
  "Auto",
  "Fable",
  "Opus",
  "Opus high",
  "Sonnet",
  "Haiku",
  "Pi",
] as const;
export const REPEAT_WHEN =
  "every day at 09:00, every weekday at 08:30, every Monday at 9, on the 1st of every month at 09:00, every hour, every 6 hours, every 2 hours from 9am to 9pm";

export interface RepeatAnswers {
  what: string;
  when: string;
  kind: string;
  check?: string;
  model?: string;
}

const kindOf = (kind: string) =>
  /reminder/i.test(kind) ? "reminder" : /check/i.test(kind) ? "check" : "agent";

/** What's wrong with the answers, in the form's own words; empty when the core will take them. */
export function repeatProblems(a: RepeatAnswers): string[] {
  const out: string[] = [];
  const what = a.what.trim();
  if (!what) out.push("Say what to repeat.");
  if (what.length > 4_000) out.push("“What” is too long: 4,000 characters at most.");
  if (!(REPEAT_KINDS as readonly string[]).includes(a.kind)) out.push("Pick a kind.");
  const s = parseSchedule(a.when);
  if (!s)
    out.push(
      `“When” says “${a.when.trim()}”, which isn't a schedule I can read. Try “every day at 09:00”, “every Monday at 9” or “every hour from 9am to 9pm”.`,
    );
  else {
    const often = tooOften(s, kindOf(a.kind));
    if (often) out.push(often);
  }
  if (kindOf(a.kind) === "check" && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(a.check?.trim() ?? ""))
    out.push(
      "Name the check: its script's name in checks/ (price-watch for checks/price-watch.mjs).",
    );
  if (a.model && !(REPEAT_MODELS as readonly string[]).includes(a.model)) out.push("Pick a model.");
  return out;
}

/** The words of a new repeat: its title line, then the form's headings and answers. */
export function repeatWords(a: RepeatAnswers): string {
  const what = a.what.trim();
  const first = what.split("\n")[0]?.trim().slice(0, 200) ?? "";
  const job = kindOf(a.kind) === "agent";
  const check = kindOf(a.kind) === "check" ? (a.check?.trim() ?? "") : "";
  return [
    `repeat: ${first}`,
    "",
    "### What",
    "",
    what,
    "",
    "### When",
    "",
    a.when.trim(),
    "",
    "### Kind",
    "",
    a.kind,
    "",
    "### Check",
    "",
    check || "_No response_",
    "",
    "### Model",
    "",
    job ? a.model || "Auto" : "Auto",
  ].join("\n");
}
