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
}

const list = (xs: string[]) =>
  xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", ");

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
