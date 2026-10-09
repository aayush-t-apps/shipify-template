// Tasks that repeat (ADR 0013, docs/tasks.md): the pure parts. A schedule in plain words, the next
// time it's due in the owner's time zone, and the Repeat form. commands/repeat.ts runs them.
import { z } from "zod";
import { withoutZone, zoneName } from "../contracts/zone.ts";

export { zoneName };

export const REPEATS_LABEL = {
  name: "repeats",
  color: "6f42c1",
  description: "Repeats on a schedule: close it to stop",
} as const;

export const RepeatState = z.object({
  /** reminder: its words, no agent; agent: the agent each time; check: a reviewed script from
   * checks/, and a reply only when its output changes (ADR 0031). */
  kind: z.enum(["reminder", "agent", "check"]),
  /** A check's script name (checks/<name>.mjs), and what a change does: reply, or think about it. */
  check: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  onChange: z.enum(["reply", "think"]).optional(),
  /** A check's last output, as its hash. */
  value: z.string().optional(),
  /** The schedule, as describeSchedule writes it ("every Monday at 09:00"). */
  every: z.string(),
  text: z.string().optional(),
  next: z.string(),
  last: z.string().optional(),
  /** Failed runs in a row; three pause it. */
  fails: z.number().default(0),
  paused: z.boolean().optional(),
  /** The last reminder's comment, replaced by the next one. */
  reminder: z.number().optional(),
});
export type RepeatState = z.infer<typeof RepeatState>;

export type Every =
  | { unit: "day" }
  | { unit: "weekday" }
  | { unit: "week"; day: number }
  | { unit: "month"; date: number }
  /** Every `minutes` from `at` each day, up to `until` (HH:MM) or the day's end, as cron does. */
  | { unit: "interval"; minutes: number; until?: string };
export interface Schedule {
  every: Every;
  /** HH:MM, 24-hour, in the owner's time zone: the time, or an interval's first each day. */
  at: string;
}

/**
 * How often each kind may repeat. The watch looks every 5 minutes and a due run takes a box for
 * about a minute, so a reminder every 15; a job is a whole agent run each time, so every hour.
 */
const SHORTEST = { reminder: 15, agent: 60, check: 15 } as const;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_NAMES = DAYS.map((d) => d[0]?.toUpperCase() + d.slice(1));

/** "9", "9am", "9:30pm", "09:00", "21:15" → "HH:MM"; undefined when it isn't a time. */
function parseTime(text: string): string | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * "every hour", "hourly", "every 6 hours", "every half hour", "every 90 minutes", each with an
 * optional window: "from 08:15", "from 9am to 9pm", "between 9 and 18", "until 17:00".
 */
function parseInterval(t: string): Schedule | undefined {
  const m =
    /^(?:every|each) (?:(\d+) )?(hour|hr|minute|min)s?(?: (?:from|between) (.+?))?(?: (?:to|until|till|and) (.+?))?$/.exec(
      t
        .replace(/^hourly\b/, "every hour")
        .replace(/^(every|each) half(?: an)? hour\b/, "$1 30 minutes"),
    );
  if (!m) return undefined;
  const minutes = Number(m[1] ?? 1) * (m[2]?.startsWith("h") ? 60 : 1);
  const at = m[3] ? parseTime(m[3]) : "00:00";
  const until = m[4] ? parseTime(m[4]) : undefined;
  if (!at || (m[4] && !until) || (until && until < at)) return undefined;
  if (minutes < 1 || minutes > 24 * 60) return undefined;
  return { every: { unit: "interval", minutes, ...(until ? { until } : {}) }, at };
}

/**
 * A schedule in plain words: "every day at 09:00", "daily 9am", "every weekday at 8:30",
 * "every Monday at 9", "weekly on Friday 17:00", "on the 1st of every month at 09:00",
 * "monthly on the 15th", "every hour", "every 6 hours from 9am to 9pm", "every 30 minutes".
 * Without a time it's 09:00.
 */
export function parseSchedule(text: string): Schedule | undefined {
  // Its zone may be said ("… at 2 pm IST"): the owner's, the only one a repeat runs in.
  const t = withoutZone(text).toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  const interval = parseInterval(t);
  if (interval) return interval;
  const at =
    /\bat\s+(\S+(?:\s*[ap]m)?)\s*$/.exec(t) ??
    /\s(\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2})$/.exec(t);
  const time = at ? parseTime(at[1] as string) : "09:00";
  if (!time) return undefined;
  const rest = at ? t.slice(0, at.index).trim() : t;
  if (/^(every day|daily|each day)$/.test(rest)) return { every: { unit: "day" }, at: time };
  if (/^(every weekday|weekdays|each weekday)$/.test(rest))
    return { every: { unit: "weekday" }, at: time };
  const week = /^(?:every|each|weekly on|every week on|on)\s+([a-z]+?)s?$/.exec(rest);
  const day = week ? DAYS.findIndex((d) => d.startsWith((week[1] as string).slice(0, 3))) : -1;
  if (week && day >= 0 && (week[1] as string).length >= 3)
    return { every: { unit: "week", day }, at: time };
  const month =
    /^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:every|each)\s+month$/.exec(
      rest,
    ) ?? /^(?:monthly|every month)(?:\s+on)?(?:\s+the)?\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(rest);
  const date = month ? Number(month[1]) : 0;
  if (date >= 1 && date <= 31) return { every: { unit: "month", date }, at: time };
  return undefined;
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** The schedule in the words parseSchedule reads back: "every Monday at 09:00". */
export function describeSchedule(s: Schedule): string {
  if (s.every.unit === "interval") {
    const n = s.every.minutes;
    const each = n === 60 ? "every hour" : n % 60 ? `every ${n} minutes` : `every ${n / 60} hours`;
    const window = s.every.until
      ? ` from ${s.at} to ${s.every.until}`
      : s.at === "00:00"
        ? ""
        : ` from ${s.at}`;
    return `${each}${window}`;
  }
  const when =
    s.every.unit === "day"
      ? "every day"
      : s.every.unit === "weekday"
        ? "every weekday"
        : s.every.unit === "week"
          ? `every ${DAY_NAMES[s.every.day]}`
          : `on the ${ordinal(s.every.date)} of every month`;
  return `${when} at ${s.at}`;
}

/** Why a kind can't repeat this often, or undefined when it can. */
export function tooOften(s: Schedule, kind: "reminder" | "agent" | "check"): string | undefined {
  if (s.every.unit !== "interval" || s.every.minutes >= SHORTEST[kind]) return undefined;
  return kind === "agent"
    ? `“${describeSchedule(s)}” is too often for a job for the agent: the most is every hour (each time is a whole agent run). A reminder can be every 15 minutes.`
    : `“${describeSchedule(s)}” is too often: the most is every 15 minutes.`;
}

const HHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** The schedule's times on a day it's due, as HH:MM in order. */
function timesOfDay(s: Schedule): string[] {
  if (s.every.unit !== "interval") return [s.at];
  const out: string[] = [];
  const end = s.every.until ? toMinutes(s.every.until) : 24 * 60 - 1;
  for (let t = toMinutes(s.at); t <= end; t += s.every.minutes) out.push(HHMM(t));
  return out;
}

/** A moment's wall-clock fields in a time zone. */
function wall(t: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
  };
}

/** The moment a wall-clock time in a time zone happens (the first one, around a clock change). */
function moment(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  let t = asUtc;
  for (let i = 0; i < 2; i++) {
    const w = wall(t, timeZone);
    t += asUtc - Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  }
  return t;
}

/** The first time the schedule is due after `after`, in the owner's time zone. */
export function nextRun(s: Schedule, after: Date, timeZone: string): Date {
  const times = timesOfDay(s).map((at) => at.split(":").map(Number) as [number, number]);
  const today = wall(after.getTime(), timeZone);
  for (let k = 0; k < 400; k++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + k));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const weekday = day.getUTCDay();
    const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const due =
      s.every.unit === "day" ||
      s.every.unit === "interval" ||
      (s.every.unit === "weekday" && weekday >= 1 && weekday <= 5) ||
      (s.every.unit === "week" && weekday === s.every.day) ||
      // The 31st falls on the last day of shorter months.
      (s.every.unit === "month" && d === Math.min(s.every.date, lastOfMonth));
    if (!due) continue;
    for (const [h, min] of times) {
      const t = moment(y, m, d, h, min, timeZone);
      if (t > after.getTime()) return new Date(t);
    }
  }
  throw new Error(`no time found for ${describeSchedule(s)}`);
}

/** "Thu 2 Oct, 09:00" in the owner's time zone; with `zone`, "Thu 2 Oct, 09:00 IST". */
export function formatWhen(iso: string, timeZone: string, zone = false): string {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(iso))
    .replace(/^(\w+) /, "$1 ")
    .replace(/ at /, ", ");
  return zone ? `${when} ${zoneName(iso, timeZone)}` : when;
}

/** The status line for a repeating task. */
export function repeatLine(r: RepeatState, timeZone: string): string {
  const what =
    r.kind === "reminder" ? "a reminder" : r.kind === "check" ? "a check" : "a job for the agent";
  const state = r.paused
    ? "paused after 3 failed runs: comment “resume” to start it again"
    : `next ${formatWhen(r.next, timeZone, true)}`;
  return `**Repeats** ${r.every} (${what}) · ${state}`;
}
