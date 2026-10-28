// What each run did, as the owner reads it on the task (ADR 0017):
// - the details at the end of each reply;
// - the last run's details, and a table of recent runs, in the status comment.
// The pure parts: the records kept in the task's state and how they read. commands/task.ts
// records them.

import { z } from "zod";
import { modelLabel } from "./agents.ts";
import { formatWhen } from "./repeat.ts";

const Tokens = z.object({
  input: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  thinking: z.number().optional(),
});

/** One run in full: kept for the newest run only. */
export const RunDetails = z.object({
  /** When it started. */
  at: z.string(),
  /** What started it: a Reason, or "reminder", "check", "operation". */
  why: z.string(),
  box: z.string().optional(),
  /** Its Actions run. */
  run: z.string().optional(),
  /** The agent (an executors.json entry), and its name for people. None: the box ran it alone. */
  agent: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  /** The model it used (its id), or the one asked for when the agent didn't say. */
  model: z.string().optional(),
  effort: z.string().optional(),
  /** Which came from Auto. */
  auto: z.object({ model: z.boolean(), effort: z.boolean() }).optional(),
  /** Seconds: the box's job setup, getting the task ready, the agent, CI, and all of it. */
  secs: z.object({
    box: z.number().optional(),
    ready: z.number().optional(),
    agent: z.number().optional(),
    ci: z.number().optional(),
    total: z.number(),
  }),
  tokens: Tokens.optional(),
  models: z.record(z.string(), Tokens).optional(),
  turns: z.number().optional(),
  tools: z.record(z.string(), z.number()).optional(),
  /** The skills its agent loaded. */
  skills: z.array(z.string()).optional(),
  denied: z.array(z.string()).optional(),
  cost: z.object({ usd: z.number(), plan: z.boolean() }).optional(),
  limits: z
    .array(
      z.object({
        window: z.string(),
        used: z.number(),
        resets: z.string().optional(),
        rejected: z.boolean().optional(),
      }),
    )
    .optional(),
  notes: z.array(z.string()).optional(),
  /** How it ended: a phase, or "quiet" (a scheduled run with nothing to say), or "posted". */
  result: z.string(),
});
export type RunDetails = z.infer<typeof RunDetails>;

/** One row of the task's run history. */
export const RunRow = z.object({
  at: z.string(),
  why: z.string(),
  box: z.string().optional(),
  run: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  secs: z.number().optional(),
  in: z.number().optional(),
  out: z.number().optional(),
  /** The skills its agent loaded: what the weekly digest counts. */
  skills: z.array(z.string()).optional(),
  result: z.string(),
});
export type RunRow = z.infer<typeof RunRow>;

/** Rows kept per task: enough history to read, small enough for the status comment. */
export const KEEP_RUNS = 20;

/** A model's name for people, as its agent's adapter says it ("Sonnet 5.5"); other ids as they are. */
export const modelName = (id: string): string => modelLabel(id);

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A run's record for the task's state: its full details, a row, and the count. */
export function recordRun(
  state: { runs?: RunRow[]; last?: RunDetails; ran?: number },
  d: RunDetails,
): void {
  const kept: RunDetails = {
    ...d,
    denied: d.denied?.slice(0, 10).map((x) => cap(x, 160)),
    notes: d.notes?.slice(0, 5).map((x) => cap(x, 300)),
  };
  state.last = kept;
  const tokens = d.tokens;
  state.runs = [
    ...(state.runs ?? []),
    {
      at: d.at,
      why: d.why,
      box: d.box,
      run: d.run,
      model: d.model,
      effort: d.effort,
      secs: Math.round(d.secs.total),
      in: tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite : undefined,
      out: tokens?.output,
      ...(d.skills?.length ? { skills: d.skills } : {}),
      result: d.result,
    },
  ].slice(-KEEP_RUNS);
  state.ran = (state.ran ?? 0) + 1;
}

/** 42s · 1m 32s · 1h 05m */
export function duration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** 940 · 6.1k · 186k · 1.2M */
export function count(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const WHY: Record<string, [short: string, long: string]> = {
  new: ["opened", "you opened it"],
  comment: ["comment", "your comment"],
  edited: ["edited", "your edit of the task"],
  continue: ["continue", "your “continue”"],
  "start-over": ["start over", "your “start over”"],
  go: ["go", "your “go”"],
  publish: ["publish", "your “publish”"],
  work: ["work", "work a run found for a project"],
  scheduled: ["schedule", "the watch: its time came"],
  "sub-task": ["sub-task", "your “go”, or the part before it merged"],
};
const whyShort = (why: string) => WHY[why]?.[0] ?? why;
const whyLong = (why: string) => WHY[why]?.[1] ?? why;

const RESULT: Record<string, string> = { "needs-you": "needs you", repeating: "done" };
const result = (r: string) => RESULT[r] ?? r;

const LIMIT: Record<string, string> = {
  five_hour: "5-hour",
  seven_day: "weekly",
  seven_day_opus: "weekly Opus",
  seven_day_sonnet: "weekly Sonnet",
};
/** A plan limit's name, from the window the agent's report gives: "5-hour", "weekly". */
export const limitName = (window: string) => LIMIT[window] ?? window.replace(/_/g, " ");

/** Markdown table cells hold no pipes or line breaks. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** "Sonnet 5.5 · medium" */
const modelAndEffort = (model?: string, effort?: string) =>
  [model ? modelName(model) : undefined, effort].filter(Boolean).join(" · ");

/** The one line a run's details fold under. */
export function runSummary(d: RunDetails): string {
  if (!d.agent) return `the box itself, no agent · ${duration(d.secs.total)}`;
  const t = d.tokens;
  return [
    modelAndEffort(d.model, d.effort) || d.name || d.agent,
    duration(d.secs.total),
    t ? `${count(t.input + t.cacheRead + t.cacheWrite)} in, ${count(t.output)} out` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A run's details, folded: at the end of its reply, and in the status comment for the last run. */
export function renderRunDetails(d: RunDetails, timeZone: string, label = "Run details"): string {
  const run = d.run ? ` · [the run](${d.run})` : "";
  const started = `${whyLong(d.why)} · ${formatWhen(d.at, timeZone)}${d.box ? ` · on **${d.box}**` : ""}${run}`;
  if (!d.agent)
    return `<sub>${label}: ${cell(started)} · ${duration(d.secs.total)}, no agent</sub>`;
  const rows: [string, string][] = [["Started", started]];
  const auto = (on?: boolean) => (on ? " (Auto)" : "");
  rows.push([
    "Agent",
    [
      `${d.name ?? d.agent}${d.version ? ` ${d.version}` : ""}`,
      d.model ? `\`${d.model}\`${auto(d.auto?.model)}` : "its own model",
      d.effort ? `effort ${d.effort}${auto(d.auto?.effort)}` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  ]);
  const s = d.secs;
  rows.push([
    "Time",
    [
      s.box !== undefined ? `box setup ${duration(s.box)}` : undefined,
      s.ready !== undefined ? `getting ready ${duration(s.ready)}` : undefined,
      s.agent !== undefined ? `the agent ${duration(s.agent)}` : undefined,
      s.ci ? `CI ${duration(s.ci)}` : undefined,
      `${duration(s.total)} in all`,
    ]
      .filter(Boolean)
      .join(" · "),
  ]);
  const t = d.tokens;
  if (t)
    rows.push([
      "Tokens",
      [
        `${count(t.input + t.cacheRead + t.cacheWrite)} in: ${count(t.input)} new, ${count(t.cacheRead)} read from cache, ${count(t.cacheWrite)} written to cache`,
        `${count(t.output)} out${t.thinking ? `, ${count(t.thinking)} of it thinking` : ""}`,
        d.turns ? `${d.turns} turns` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  const models = Object.entries(d.models ?? {});
  if (models.length > 1)
    rows.push([
      "Models",
      models
        .map(
          ([id, m]) =>
            `${modelName(id)}: ${count(m.input + m.cacheRead + m.cacheWrite)} in, ${count(m.output)} out`,
        )
        .join(" · "),
    ]);
  const tools = Object.entries(d.tools ?? {}).sort((a, b) => b[1] - a[1]);
  rows.push(["Tools", tools.length ? tools.map(([n, c]) => `${n} ×${c}`).join(" · ") : "none"]);
  if (d.skills?.length) rows.push(["Skills", d.skills.join(" · ")]);
  if (d.denied?.length) rows.push(["Refused", d.denied.join(" · ")]);
  if (d.limits?.length)
    rows.push([
      "Your plan",
      d.limits
        .map((l) => {
          const what = `the ${limitName(l.window)} limit`;
          const resets = l.resets ? `, resets ${formatWhen(l.resets, timeZone)}` : "";
          return l.rejected
            ? `${what} is used up${resets}`
            : `${Math.round(l.used * 100)}% of ${what}${resets}`;
        })
        .join(" · "),
    ]);
  if (d.cost && (d.cost.plan || d.cost.usd > 0))
    rows.push([
      "At API prices",
      `$${d.cost.usd.toFixed(2)}, ${d.cost.plan ? "which your subscription covers" : "billed to its key"}`,
    ]);
  if (d.notes?.length) rows.push(["Notes", d.notes.join(" ")]);
  return [
    `<details><summary>${label}: ${runSummary(d)}</summary>`,
    "",
    "| | |",
    "|:--|:--|",
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
    "",
    "</details>",
  ].join("\n");
}

/** The task's recent runs, newest first, folded under a line that says how the last one went. */
export function renderRuns(
  rows: RunRow[],
  ran: number,
  timeZone: string,
  last?: RunDetails,
): string {
  const count_ =
    ran > rows.length ? `Runs: the last ${rows.length} of ${ran}` : `Runs: ${rows.length}`;
  const title = last ? `${count_} · last: ${runSummary(last)}` : count_;
  const lines = [...rows].reverse().map((r) => {
    const when = formatWhen(r.at, timeZone);
    const tokens = r.in !== undefined ? `${count(r.in)} / ${count(r.out ?? 0)}` : "—";
    const end = r.run ? `[${result(r.result)}](${r.run})` : result(r.result);
    return `| ${when} | ${whyShort(r.why)} | ${r.box ?? "—"} | ${modelAndEffort(r.model, r.effort) || "—"} | ${r.secs !== undefined ? duration(r.secs) : "—"} | ${tokens} | ${end} |`;
  });
  return [
    `<details><summary>${title}</summary>`,
    "",
    "| When | Why | Box | Model | Time | Tokens in / out | Result |",
    "|---|---|---|---|---|---|---|",
    ...lines,
    "",
    "</details>",
  ].join("\n");
}
