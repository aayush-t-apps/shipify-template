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

/** An errand's task (ADR 0054): it waits for a PR or a branch, then fires once. */
export const WAITING_LABEL = {
  name: "waiting",
  color: "bf8700",
  description: "Waits for a PR or a branch, then tells you once: `stop repeating` cancels it",
} as const;

/**
 * What an errand waits for (ADR 0054): a PR's or a branch's checks to end, a PR merged (or closed),
 * or a PR deployed (merged, then its merge commit's checks ended). Only on your own account.
 */
export const ErrandOn = z.object({
  what: z.enum(["checks", "merged", "deployed"]),
  /** owner/name. */
  repo: z.string(),
  pr: z.number().optional(),
  branch: z.string().optional(),
  /** When it was asked, and when it stops waiting. */
  since: z.string(),
  until: z.string(),
  /** Looks in a row that couldn't read it: the third ends it. */
  misses: z.number().optional(),
});
export type ErrandOn = z.infer<typeof ErrandOn>;

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
  /** The schedule, as describeSchedule writes it ("every Monday at 09:00"); ONCE for one time. */
  every: z.string(),
  text: z.string().optional(),
  next: z.string(),
  last: z.string().optional(),
  /** Failed runs in a row; three pause it. */
  fails: z.number().default(0),
  paused: z.boolean().optional(),
  /** The last reminder's comment, replaced by the next one. */
  reminder: z.number().optional(),
  /** An errand's: what it waits for (ADR 0054). Its `every` is ONCE, and `next` its next look. */
  on: ErrandOn.optional(),
});
export type RepeatState = z.infer<typeof RepeatState>;

/** What an errand finds when it looks: done (with what happened), not yet, or that it couldn't read. */
export type ErrandSeen =
  | { state: "done"; said: string; at?: string; links: [string, string][] }
  | { state: "waiting"; said: string }
  | { state: "unreadable" };

/** The label the due run finds a task's repeat by: an errand's, or any other's. */
export const labelOf = (r: { on?: unknown }) => (r.on ? WAITING_LABEL : REPEATS_LABEL);

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

/** A repeat that runs once ("in 15 minutes", "at 17:30", "tomorrow at 9"), then ends: its `every`. */
export const ONCE = "once";
export const isOnce = (r: { every: string }) => r.every === ONCE;
/** How soon and how far a time once may be: the watch looks every 5 minutes. */
const ONCE_SOONEST = 5;
const ONCE_LATEST = 30 * 24 * 60;

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

/** A time once: so long from now, or a time of day (today's next, or tomorrow's). */
type Once = { minutes: number } | { at: string; day?: "today" | "tomorrow" };
const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 24 * 60 };

/**
 * A time once, in plain words: "in 15 minutes", "in 2 hours and 30 minutes", "in an hour",
 * "in 1h30m", "in a day", "at 17:30" (its next), "today at 5pm", "tomorrow at 9", "tomorrow".
 * Never a schedule: parseSchedule reads those, and a recipe or the digest reads only them.
 */
function parseOnce(text: string): Once | undefined {
  const t = withoutZone(text)
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^once /, "");
  const span = /^in (.+?)(?: from now)?$/.exec(t);
  if (span) {
    let minutes = 0;
    const left = (span[1] as string)
      .replace(/\band\b/g, " ")
      .replace(/\bhalf (?:an )?hour\b/g, "30 minutes")
      .replace(
        /(\d+|(?<![a-z])(?:an?|one)) ?(minute|min|m|hour|hr|h|day|d)s?(?![a-z])/g,
        (_, n: string, unit: string) => {
          minutes += (/^\d/.test(n) ? Number(n) : 1) * (UNIT_MINUTES[unit[0] as string] ?? 0);
          return " ";
        },
      );
    return minutes && !left.trim() ? { minutes } : undefined;
  }
  if (t === "tomorrow") return { at: "09:00", day: "tomorrow" };
  const clock = /^(?:(today|tomorrow) )?(at )?(.+?)(?: (today|tomorrow))?$/.exec(t);
  const day = (clock?.[1] ?? clock?.[4]) as "today" | "tomorrow" | undefined;
  if (!clock || (clock[1] && clock[4]) || (!clock[2] && !day)) return undefined;
  const at = parseTime(clock[3] as string);
  return at ? { at, ...(day ? { day } : {}) } : undefined;
}

/** An errand's words, before its repo is known: what, which PR or branch, and for how long. */
type ErrandWords = {
  what: ErrandOn["what"];
  /** A PR's URL, `[owner/]repo#n`, `#n`, or the task's newest ("the PR"). */
  target:
    | { pr: number; repo?: string; owner?: string }
    | { thePr: true }
    | { branch: string; repo?: string };
  minutes: number;
};

/** How long an errand waits: a day unless you say, at most 7 days (ADR 0054). */
const ERRAND_DEFAULT = 24 * 60;
const ERRAND_LATEST = 7 * 24 * 60;
/** Its looks: every 10 minutes for its first hour, then every 30. */
const LOOK_SOON = 10;
const LOOK_LATER = 30;

const NAME = "[a-z0-9][a-z0-9._-]*";
const EVENTS: [ErrandOn["what"], RegExp][] = [
  [
    "checks",
    /(?:'s)? (?:ci|checks?|pipeline)(?: runs?)? (?:finish(?:es)?|end(?:s)?|are (?:done|finished|over)|is (?:done|finished|over)|complete[sd]?|pass(?:es)?|fail(?:s)?)$/,
  ],
  ["merged", / (?:merges|is merged(?: or closed)?|gets merged|is closed|closes)$/],
  ["deployed", / (?:is live|goes live|is deployed|gets deployed|deploys|is out)$/],
];

/**
 * An errand in plain words (ADR 0054): "when links#12's checks finish", "when the PR's checks end",
 * "when shipify's main checks finish", "when #405 merges", "when it's deployed", each with "for 3
 * days" or "within 2 hours" when it should wait other than a day. Undefined when it isn't one.
 */
function parseErrand(text: string): ErrandWords | undefined {
  let t = withoutZone(text)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[,.!?]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bit's\b/g, "it is");
  const head = /^(?:(?:tell me|let me know|check back|ping me) )?(?:when|once|after) (.+)$/.exec(t);
  if (!head) return undefined;
  t = head[1] as string;
  let minutes = ERRAND_DEFAULT;
  const span =
    / (?:for|within|up to|until) (?:the next )?(\d+|an?|one) ?(minute|min|hour|hr|day)s?$/.exec(t);
  if (span) {
    const n = /^\d/.test(span[1] as string) ? Number(span[1]) : 1;
    minutes = n * (UNIT_MINUTES[(span[2] as string)[0] as string] ?? 0);
    t = t.slice(0, span.index);
  }
  for (const [what, re] of EVENTS) {
    const m = re.exec(t);
    if (!m) continue;
    const who = t.slice(0, m.index).trim();
    const url = /^https:\/\/github\.com\/([a-z0-9-]+)\/([a-z0-9._-]+)\/pull\/(\d+)\/?$/.exec(who);
    if (url) return { what, target: { pr: Number(url[3]), repo: url[2], owner: url[1] }, minutes };
    const ref = new RegExp(`^(?:(?:(${NAME})/)?(${NAME}))?#(\\d+)$`).exec(who);
    if (ref)
      return {
        what,
        target: {
          pr: Number(ref[3]),
          ...(ref[2] ? { repo: ref[2] } : {}),
          ...(ref[1] ? { owner: ref[1] } : {}),
        },
        minutes,
      };
    if (/^(?:the|this|my|its|the task's|our) pr$|^it$|^it is$/.test(who))
      return { what, target: { thePr: true }, minutes };
    // A branch's checks: "shipify's main", "the main branch", "main".
    const branch = new RegExp(`^(?:(${NAME})'s )?(?:the )?([a-z0-9._/-]+?)(?: branch)?$`).exec(who);
    if (what === "checks" && branch && branch[2] !== "pr")
      return {
        what,
        target: { branch: branch[2] as string, ...(branch[1] ? { repo: branch[1] } : {}) },
        minutes,
      };
    return undefined;
  }
  return undefined;
}

/** Where an errand's words are read: your account, the task's repo, its repos and its PRs. */
export interface ErrandWhere {
  /** Your account: the only one an errand reads. */
  own: string;
  /** The task's repo (its project's, else shipify's), owner/name. */
  repo: string;
  /** Repos by the name a task calls them. */
  repos: { name: string; repo: string }[];
  /** The task's PRs, oldest first. */
  prs: string[];
}

const prUrl = (on: { repo: string; pr?: number }) => `https://github.com/${on.repo}/pull/${on.pr}`;
export const errandPrUrl = (on: ErrandOn) => (on.pr ? prUrl(on) : undefined);

/** An errand's own words as its task reads them: its repo found, on your account; or why not. */
function errandOn(
  w: ErrandWords,
  where: ErrandWhere,
  now: Date,
): { on: ErrandOn; own: boolean } | { problem: string } {
  const repoOf = (name: string | undefined, owner?: string) => {
    if (!name) return where.repo;
    if (owner) return `${owner}/${name}`;
    return where.repos.find((r) => r.name.toLowerCase() === name)?.repo ?? `${where.own}/${name}`;
  };
  let repo: string;
  let pr: number | undefined;
  let branch: string | undefined;
  if ("thePr" in w.target) {
    const url = where.prs.at(-1);
    const m = url ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url) : null;
    if (!m)
      return {
        problem:
          "This task has no PR to wait for: name one, as `#12`, `links#12` or its link, or a branch, as “shipify's main checks”.",
      };
    repo = m[1] as string;
    pr = Number(m[2]);
  } else if ("pr" in w.target) {
    repo = repoOf(w.target.repo, w.target.owner);
    pr = w.target.pr;
  } else {
    repo = repoOf(w.target.repo);
    branch = w.target.branch;
  }
  if (repo.split("/")[0]?.toLowerCase() !== where.own.toLowerCase())
    return {
      problem: `${repo} is on another account: an errand waits only on your own account's repos (${where.own}), as the due run holds no key elsewhere.`,
    };
  const until = new Date(now.getTime() + w.minutes * 60_000).toISOString();
  const on: ErrandOn = {
    what: w.what,
    repo,
    ...(pr ? { pr } : {}),
    ...(branch ? { branch } : {}),
    since: now.toISOString(),
    until,
  };
  const url = pr ? prUrl({ repo, pr }) : undefined;
  return {
    on,
    own: Boolean(url && where.prs.some((u) => u.toLowerCase() === url.toLowerCase())),
  };
}

/** An errand's next look after `now`: 10 minutes on in its first hour, then 30, never past `until`. */
export function nextLook(on: ErrandOn, now: Date): Date {
  const first = now.getTime() - Date.parse(on.since) < 60 * 60_000;
  const next = now.getTime() + (first ? LOOK_SOON : LOOK_LATER) * 60_000;
  return new Date(Math.min(next, Date.parse(on.until)));
}

/** "links#12", "shipify's main": what an errand names, as you'd say it. */
export function errandName(on: ErrandOn): string {
  const name = on.repo.split("/")[1] ?? on.repo;
  return on.pr ? `${name}#${on.pr}` : `${name}'s ${on.branch}`;
}

/** "links#12's checks to finish": what an errand waits for. */
export function errandWaits(on: ErrandOn): string {
  const name = errandName(on);
  if (on.what === "merged") return `${name} to merge`;
  if (on.what === "deployed") return `${name} to be deployed`;
  return on.pr ? `${name}'s checks to finish` : `${name} checks to finish`;
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

/** When a time once comes after `now`; undefined for today's time already gone. */
function onceAt(o: Once, now: Date, timeZone: string): Date | undefined {
  if ("minutes" in o) return new Date(now.getTime() + o.minutes * 60_000);
  const [h, min] = o.at.split(":").map(Number) as [number, number];
  const w = wall(now.getTime(), timeZone);
  const on = (k: number) => {
    const d = new Date(Date.UTC(w.y, w.m - 1, w.d + k));
    return moment(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, min, timeZone);
  };
  if (o.day === "tomorrow") return new Date(on(1));
  if (on(0) > now.getTime()) return new Date(on(0));
  return o.day === "today" ? undefined : new Date(on(1));
}

type Kind = "reminder" | "agent" | "check";

/**
 * Why these words can't set a repeat of this kind, before its time is worked out (a form checks
 * them so); undefined when they can. One reader for the words, the Repeat form and the web chat.
 */
export function whenProblem(text: string, kind: Kind): string | undefined {
  const s = parseSchedule(text);
  if (s) return tooOften(s, kind);
  const o = parseOnce(text);
  const said = `“${text.trim()}”`;
  const e = o ? undefined : parseErrand(text);
  if (e && kind === "check")
    return `${said} waits for something once: a check repeats on a schedule, so ask for a reminder or a job.`;
  if (e && e.minutes > ERRAND_LATEST)
    return `${said} waits too long: an errand waits at most 7 days.`;
  if (e && e.minutes < LOOK_SOON)
    return `${said} is too short: an errand waits at least 10 minutes, as it looks every 10.`;
  if (e) return undefined;
  if (!o)
    return `${said} isn't a time I can read. Try “every day at 09:00”, “every Monday at 9” or “every hour from 9am to 9pm”; once, “in 15 minutes”, “at 17:30” or “tomorrow at 9”; or when something happens, “when #12's checks finish”, “when #12 merges” or “when it's deployed”.`;
  if (kind === "check")
    return `${said} is once: a check repeats on a schedule, so ask for a reminder or a job.`;
  if ("minutes" in o && o.minutes < ONCE_SOONEST)
    return `${said} is too soon: the soonest is in 5 minutes, as the watch looks every 5.`;
  if ("minutes" in o && o.minutes > ONCE_LATEST)
    return `${said} is too far off: once is at most 30 days ahead.`;
  return undefined;
}

/**
 * The words as a repeat, in the owner's time zone: its `every` and its first time, and an errand's
 * `on`; or why not. An errand is read only on a task (`where`). Its first look is in 10 minutes; one
 * waiting on the task's own PR to merge or deploy is fired by the merge's own run, so the due run
 * looks only at its end (ADR 0054 §3).
 */
export function readWhen(
  text: string,
  kind: Kind,
  now: Date,
  timeZone: string,
  where?: ErrandWhere,
): { every: string; next: Date; on?: ErrandOn } | { problem: string } {
  const problem = whenProblem(text, kind);
  if (problem) return { problem };
  const s = parseSchedule(text);
  if (s) return { every: describeSchedule(s), next: nextRun(s, now, timeZone) };
  const o = parseOnce(text);
  const e = o ? undefined : parseErrand(text);
  if (e) {
    if (!where) return { problem: `“${text.trim()}” waits for something: ask it on a task.` };
    const read = errandOn(e, where, now);
    if ("problem" in read) return read;
    const atEnd = read.own && read.on.what !== "checks";
    return {
      every: ONCE,
      next: atEnd ? new Date(read.on.until) : nextLook(read.on, now),
      on: read.on,
    };
  }
  const next = onceAt(o as Once, now, timeZone);
  return next
    ? { every: ONCE, next }
    : { problem: `“${text.trim()}” has passed today: say a time to come.` };
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
  if (r.on)
    return `**Waiting** for ${errandWaits(r.on)}, then ${what} · until ${formatWhen(r.on.until, timeZone, true)}`;
  if (isOnce(r)) return `**Once** at ${formatWhen(r.next, timeZone, true)} (${what})`;
  const state = r.paused
    ? "paused after 3 failed runs: comment “resume” to start it again"
    : `next ${formatWhen(r.next, timeZone, true)}`;
  return `**Repeats** ${r.every} (${what}) · ${state}`;
}
