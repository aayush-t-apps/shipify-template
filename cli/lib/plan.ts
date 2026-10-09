import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { resolveSelection, unknownOptions } from "./catalog.ts";
import { PLATFORM_ROOT } from "./config.ts";
import { mermaidBlocks } from "./docs.ts";
import { type Check, ShipError } from "./output.ts";
import { loadRegistry } from "./registry.ts";
import { renderString } from "./render.ts";
import { findSecretLike, validateAppName } from "./safety.ts";
import { PlanFrontMatter } from "./schemas.ts";

export const REQUIRED_SECTIONS = [
  "## Goal",
  "## Out of scope",
  "## Stories",
  "## Tasks",
  "## Verification",
];
export const MAX_PLAN_LINES = 250;
export const STORY_RE = /\*\*US(\d+) \(P[1-3]\)/g;
export const AC_RE = /\bAC(\d+\.\d+)\s+WHEN\b[^\n]*\bSHALL\b/g;
export const TASK_RE = /^- \[[ x]\] T\d+ \[US\d+\].*$/gm;

const CLARIFY = "[NEEDS CLARIFICATION";

export interface Plan {
  file: string;
  meta: PlanFrontMatter;
  body: string;
  raw: string;
  /** Short content hash, shown to reviewers and recorded in the app manifest. */
  hash: string;
}

export const planPath = (app: string, root = PLATFORM_ROOT) =>
  join(root, "plans", `${app}.plan.md`);

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function parsePlan(raw: string, file = "<plan>"): Plan {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m?.[1] || m[2] === undefined) {
    throw new ShipError(`${file} must start with YAML front matter between --- lines.`, "blocked");
  }
  const parsed = PlanFrontMatter.safeParse(YAML.parse(m[1]));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ShipError(`${file} front matter is invalid: ${issues}`, "blocked");
  }
  return { file, meta: parsed.data, body: m[2], raw, hash: hashText(raw) };
}

export function readPlan(app: string, root = PLATFORM_ROOT): Plan {
  const file = planPath(app, root);
  if (!existsSync(file)) throw new ShipError(`No plan at plans/${app}.plan.md.`, "blocked");
  return parsePlan(readFileSync(file, "utf8"), `plans/${app}.plan.md`);
}

export function checkPlan(plan: Plan, appsRoot: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, fn: () => string | undefined) => {
    try {
      const detail = fn();
      checks.push({ name, ok: true, detail });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message });
    }
  };
  const { meta, body } = plan;
  add("app name is valid", () => {
    validateAppName(meta.app);
    return meta.app;
  });
  add("app name is unused (or this is a revision of it)", () => {
    const exists = loadRegistry().projects.some((a) => a.id === meta.app);
    // A revision (r2+) of a published app is a change request: built as a change (ADR 0018).
    if (exists && meta.revision > 1) return `revision ${meta.revision} of an existing app`;
    if (exists) throw new Error("already registered");
    if (existsSync(join(appsRoot, meta.app))) throw new Error(`${appsRoot}/${meta.app} exists`);
    return undefined;
  });
  let required: string[] = [];
  let kind = "app";
  add("stack and preset are compatible", () => {
    const { stack } = resolveSelection(meta.stack, meta.preset);
    if (meta.staging && stack.kind === "package") throw new Error("packages have no staging");
    const unknown = unknownOptions(stack, meta.options);
    if (unknown) throw new Error(unknown);
    required = stack.plan.require;
    kind = stack.kind;
    return `${meta.stack} + ${meta.preset}`;
  });
  add("required sections present", () => {
    const missing = REQUIRED_SECTIONS.filter((s) => !body.includes(s));
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
    return undefined;
  });
  add(`covers what stack ${meta.stack} asks every plan to decide`, () => {
    const missing = required.filter((s) => !body.includes(s));
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
    return required.length ? `${required.length} items` : "nothing extra";
  });
  const diagrams = mermaidBlocks(body);
  add("diagrams are valid Mermaid", () => {
    if (diagrams.problems.length) throw new Error(diagrams.problems.join("; "));
    return `${diagrams.count} diagram(s)`;
  });
  add("apps show their architecture as a diagram", () => {
    if (kind !== "app") return "not required for a package";
    if (!diagrams.count)
      throw new Error(
        "add a Mermaid diagram under ### Architecture: who uses it, what you deploy, what it calls",
      );
    return undefined;
  });
  add("stories have testable criteria (EARS: WHEN … SHALL …)", () => {
    const stories = [...body.matchAll(STORY_RE)].map((m) => m[1]);
    if (!stories.length) throw new Error("write stories as **US1 (P1): …**");
    const acs = [...body.matchAll(AC_RE)].map((m) => m[1] as string);
    const bare = stories.filter((n) => !acs.some((a) => a.startsWith(`${n}.`)));
    if (bare.length) throw new Error(`US${bare.join(", US")} has no AC<n>.<m> WHEN … SHALL … line`);
    return `${stories.length} stories, ${acs.length} criteria`;
  });
  add("every criterion is verified by a task", () => {
    const acs = [...new Set([...body.matchAll(AC_RE)].map((m) => m[1] as string))];
    const tasks = body.split("## Tasks")[1]?.split("\n## ")[0] ?? "";
    if (!(tasks.match(TASK_RE) ?? []).length) {
      throw new Error("write tasks as - [ ] T1 [US1] outcome — verifies: AC1.1");
    }
    const unverified = acs.filter(
      (a) => !new RegExp(`\\bAC${a.replace(".", "\\.")}\\b`).test(tasks),
    );
    if (unverified.length) throw new Error(`no task verifies AC${unverified.join(", AC")}`);
    return undefined;
  });
  add(`plan stays under ${MAX_PLAN_LINES} lines`, () => {
    const n = plan.raw.split("\n").length;
    if (n > MAX_PLAN_LINES) throw new Error(`${n} lines; cut repetition and N/A sections`);
    return `${n} lines`;
  });
  add("no open questions", () => {
    const n = plan.raw.split(CLARIFY).length - 1;
    if (n) throw new Error(`${n} ${CLARIFY}] marker(s) left`);
    return undefined;
  });
  add("no secrets in plan", () => {
    const hit = findSecretLike(plan.raw);
    if (hit) throw new Error(`text matches secret pattern ${hit}`);
    return undefined;
  });
  return checks;
}

export function planSkeleton(input: {
  app: string;
  title: string;
  summary: string;
  stack: string;
  preset: string;
  visibility: "public" | "private";
}): string {
  const text = readFileSync(join(PLATFORM_ROOT, "guides", "plan-template.md"), "utf8");
  return renderString(text, {
    APP: input.app,
    // Quoted as YAML strings: titles and summaries often hold ": " or quotes.
    TITLE: JSON.stringify(input.title),
    SUMMARY: JSON.stringify(input.summary),
    STACK: input.stack,
    PRESET: input.preset,
    VISIBILITY: input.visibility,
  });
}
