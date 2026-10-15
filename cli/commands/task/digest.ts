// The weekly digest (ADR 0053): one short message to your default chats at the time you set
// (SHIPIFY_DIGEST, `every monday at 9:00` by default, or `off`), even when all is clear, so a quiet
// week never looks like a fault. What's wrong is still said at once (the watch's alerts); this
// only gathers the week, from what the due run already reads. Nothing in it acts.

import { nextRun, parseSchedule } from "../../lib/repeat.ts";

export const DIGEST_EVERY = "every monday at 9:00";

/** Its next time after `at` (SHIPIFY_DIGEST's schedule, the default's when unset or unreadable);
 * none when it's `off`. */
export function digestNext(raw: string | undefined, at: Date, zone: string): string | undefined {
  const said = raw?.trim() ?? "";
  if (/^off$/i.test(said)) return undefined;
  const s = parseSchedule(said || DIGEST_EVERY) ?? parseSchedule(DIGEST_EVERY);
  return s ? nextRun(s, at, zone).toISOString() : undefined;
}

/** Whether this due run says it: its time has come, or it was never said (the first one shows it
 * works); never when it's off. */
export const digestDue = (planned: string | undefined, next: string | undefined, at: Date) =>
  next !== undefined && (planned === undefined || Date.parse(planned) <= at.getTime());

export interface DigestFacts {
  boxes: { name: string; online: boolean }[];
  apps: {
    id: string;
    failing?: boolean;
    paused?: boolean;
    behind?: { stack: string; from: string; to: string };
  }[];
  /** Tasks that wait on you (`needs you`): a PR to merge, a question, a list. */
  waiting: { n: number; title: string }[];
  /** Repeats and reminders set: how many, and the soonest. */
  upcoming: { count: number; next?: string };
  /** Keys due within 30 days. */
  keys: { name: string; date: string; days: number }[];
  /** The skills the week's runs loaded, when there were runs to count. */
  skills?: SkillsWeek;
}

/** What the week's agent runs loaded, from their tasks' run rows. */
export interface SkillsWeek {
  /** Agent runs this week, and how many of them loaded a skill. */
  runs: number;
  loaded: number;
  /** Each skill, and how many runs loaded it. */
  loads: Record<string, number>;
  /** The skills on main no run loaded this week: worth a look, never removed by themselves. */
  idle: string[];
}

const WEEK = 7 * 24 * 3600_000;

/**
 * The week before `at`, from task run rows (a row with a model is an agent's run), and the skills on
 * main none of them loaded.
 */
export function countSkills(
  rows: { at: string; model?: string; skills?: string[] }[],
  onMain: string[],
  at: Date,
): SkillsWeek {
  const from = at.getTime() - WEEK;
  const week = rows.filter((r) => r.model && Date.parse(r.at) >= from && Date.parse(r.at) <= +at);
  const loads: Record<string, number> = {};
  for (const r of week) for (const s of new Set(r.skills ?? [])) loads[s] = (loads[s] ?? 0) + 1;
  return {
    runs: week.length,
    loaded: week.filter((r) => r.skills?.length).length,
    loads,
    idle: onMain.filter((s) => !loads[s]).sort(),
  };
}

const list = (xs: string[]) =>
  xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", ");

/** The skills' line: the most loaded, in how many runs, and the ones none loaded. */
function skillLines(s?: SkillsWeek): string[] {
  if (!s?.runs) return [];
  const top = Object.entries(s.loads)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name} ×${n}`);
  const runs = `${s.runs} agent run${s.runs === 1 ? "" : "s"}`;
  const used = top.length ? `${list(top)}; in ${s.loaded} of ${runs}` : `none loaded in ${runs}`;
  const idle = top.length && s.idle.length ? `; none loaded ${list(s.idle)}` : "";
  return [`- **Skills:** ${used}${idle}`];
}

/** The message, short: what runs, what waits on you, what's due, and "all clear" when nothing is. */
export function digestText(f: DigestFacts, when: (iso: string) => string): string {
  const offline = f.boxes.filter((b) => !b.online).map((b) => b.name);
  const live = f.apps.filter((a) => !a.failing && !a.paused).map((a) => a.id);
  const failing = f.apps.filter((a) => a.failing && !a.paused).map((a) => a.id);
  const behind = f.apps.flatMap((a) =>
    a.behind
      ? [`${a.id} (${a.behind.stack} ${a.behind.from} → ${a.behind.to}: \`${a.id}: upgrade\`)`]
      : [],
  );
  const lines = [
    `- **Boxes:** ${f.boxes.length ? (offline.length ? `${list(offline)} offline` : `${list(f.boxes.map((b) => b.name))} online`) : "none yet"}`,
    `- **Apps:** ${[live.length ? `${list(live)} live` : "", failing.length ? `${list(failing)} failing` : ""].filter(Boolean).join("; ") || "none"}`,
    ...(f.waiting.length
      ? [`- **Waiting on you:** ${list(f.waiting.map((t) => `#${t.n} ${t.title}`))}`]
      : []),
    ...(behind.length ? [`- **Behind its stack:** ${list(behind)}`] : []),
    ...(f.keys.length
      ? [`- **Keys due:** ${list(f.keys.map((k) => `${k.name} on ${k.date} (${k.days} days)`))}`]
      : []),
    ...skillLines(f.skills),
    ...(f.upcoming.count
      ? [
          `- **Coming up:** ${f.upcoming.count} repeat${f.upcoming.count === 1 ? "" : "s"}${f.upcoming.next ? `, the next ${when(f.upcoming.next)}` : ""}`,
        ]
      : []),
  ];
  const clear =
    !offline.length && !failing.length && !f.waiting.length && !behind.length && !f.keys.length;
  return [`**This week${clear ? ": all clear" : ""}**`, "", ...lines].join("\n");
}
