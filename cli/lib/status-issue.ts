// The "Shipify status" issue (ADR 0017, ADR 0019): the record's page for the platform. It holds
// - the watch's side (docs/watch.md): the last due run, and when the soonest repeat is due
//   (`watch.next`), which the watch reads to know when to press `due`;
// - each box the record knows: its health, from its own due runs and clean-ups, and since when it's
//   been offline (an alert run writes that);
// - each app, and each chat channel (ADR 0030), the watch has seen failing, since when;
// - what's coming up, and what happened lately;
// - each box's weekly clean-up, with doctor's checks.
// Its edits notify nobody; a problem comes as a comment, which does. It's never a task: task.yml
// and `ship task` skip its label, and the workflow's own token opens it, which starts no workflow.
import { createHash } from "node:crypto";
import { z } from "zod";
import { Problem } from "../contracts/problems.ts";
import { holdsRecord, MOST_REPOS, pickStatusIssue, REPO_NAME } from "../contracts/watch.ts";
import { githubRecord, postComment } from "./github.ts";
import type { RecordIssue, TaskRecord } from "./plugins/record.ts";
import { formatWhen } from "./repeat.ts";

export const STATUS_LABEL = {
  name: "shipify-status",
  color: "6e7781",
  description: "Shipify's own status: the watch, boxes, apps and clean-ups (not a task)",
} as const;
const MARK = "<!-- shipify-status ";
const TITLE = "Shipify status";
const KEEP_EVENTS = 30;

const Check = z.object({
  ok: z.boolean(),
  name: z.string(),
  detail: z.string().optional(),
  fix: z.string().optional(),
});
const Fact = z.object({ name: z.string(), value: z.string(), look: z.string().optional() });
const Upcoming = z.object({
  n: z.number(),
  title: z.string(),
  next: z.string(),
  every: z.string().optional(),
});
export type Upcoming = z.infer<typeof Upcoming>;

export const StatusIssueState = z.object({
  v: z.literal(2),
  /** What the watch reads, and the due run writes (ADR 0019, docs/watch.md). */
  watch: z
    .object({
      /** When the soonest repeat is due: once it has passed, the watch presses `due`. */
      next: z.string().optional(),
      /** The last due run that finished: when, where, and its link. */
      last: z.string().optional(),
      box: z.string().optional(),
      run: z.string().optional(),
      /** When the weekly digest comes next (ADR 0053): `next` is never later than it. */
      digest: z.string().optional(),
    })
    .default({}),
  upcoming: z.array(Upcoming).default([]),
  /** Every app, for the edge's /apps and its health guard (ADR 0031, contracts/watch.ts): the due
   * run writes the list from the box's registry; a paused app (`ship down`) is skipped by the guard;
   * `failing` is since when the watch has seen it fail (the alert run writes it). */
  apps: z
    .array(
      z.object({
        id: z.string(),
        url: z.string().optional(),
        paused: z.boolean().optional(),
        failing: z.string().optional(),
      }),
    )
    .catch([])
    .default([]),
  /** The keys of the watch's notes already said, so each is said once. */
  alerted: z.array(z.string()).default([]),
  /** Newest first. */
  events: z.array(z.object({ at: z.string(), text: z.string() })).default([]),
  /** Each box the record knows, by name. */
  boxes: z
    .record(
      z.string(),
      z.object({
        /** When its health was last read, on the box itself. */
        at: z.string().optional(),
        facts: z.array(Fact).default([]),
        /** What needed a look when last posted, so it's posted once. */
        alerted: z.string().optional(),
        /** Since when the watch has seen it offline (an alert run wrote it). */
        offline: z.string().optional(),
        /** Its runner's version ("2.329.0"), from its health: the watch warns before it's too old. */
        runner: z.string().optional(),
      }),
    )
    .default({}),
  /** The recipes on main and their tasks (ADR 0032): the due run keeps them in step. */
  recipes: z
    .array(
      z.object({
        name: z.string(),
        task: z.number().optional(),
        every: z.string().optional(),
        next: z.string().optional(),
        paused: z.boolean().optional(),
      }),
    )
    .catch([])
    .default([]),
  /** Each chat channel the watch has seen failing (its calls to the door, ADR 0030): since when. */
  channels: z.record(z.string(), z.object({ failing: z.string() })).default({}),
  /**
   * Shipify's own account's repos as a task names them, and when the due run read them (ADR 0047):
   * for /repos and the web chat's "Change a repo". Read with the apps, from the same list.
   */
  repos: z
    .object({
      at: z.string().optional(),
      names: z.array(z.string()).default([]),
      projects: z.array(z.string()).default([]),
    })
    .catch({ names: [], projects: [] })
    .default({ names: [], projects: [] }),
  /** Each box's weekly clean-up, by box. */
  cleanups: z
    .record(
      z.string(),
      z.object({
        at: z.string(),
        run: z.string().optional(),
        summary: z.string(),
        checks: z.array(Check).default([]),
        /** The failing checks last posted as a comment, so the same ones aren't posted again. */
        alerted: z.string().optional(),
      }),
    )
    .default({}),
});
export type StatusIssueState = z.infer<typeof StatusIssueState>;
export type Cleanup = StatusIssueState["cleanups"][string];

const fresh = (): StatusIssueState => StatusIssueState.parse({ v: 2 });

export const isStatusIssue = (issue: { labels: { name: string }[] }) =>
  issue.labels.some((l) => l.name === STATUS_LABEL.name);

export function parseStatusIssue(body: string | null): StatusIssueState {
  const b = body ?? "";
  if (!b.startsWith(MARK)) return fresh();
  try {
    const raw = JSON.parse(b.slice(MARK.length, b.indexOf(" -->"))) as Record<string, unknown>;
    // A record of another version starts fresh.
    const parsed = StatusIssueState.safeParse(raw);
    return parsed.success ? parsed.data : fresh();
  } catch {
    return fresh();
  }
}

/** Something that happened, newest first, keeping the last 30. */
export function addEvent(s: StatusIssueState, text: string, at = new Date().toISOString()) {
  s.events = [{ at, text }, ...s.events].slice(0, KEEP_EVENTS);
}

/** What's coming up, soonest first; the soonest is the watch's next due time. */
export function setUpcoming(s: StatusIssueState, rows: Upcoming[]) {
  s.upcoming = [...rows].sort((a, b) => Date.parse(a.next) - Date.parse(b.next));
  // The soonest of the repeats and the weekly digest (ADR 0053): the watch rings the due run then.
  const soonest = [s.upcoming[0]?.next, s.watch.digest].filter((t): t is string => Boolean(t));
  s.watch.next = soonest.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

/** A repeat set up, changed or resumed: its row, and the watch's next due time if it's sooner. */
export const upsertRepeat = (s: StatusIssueState, row: Upcoming) =>
  setUpcoming(s, [...s.upcoming.filter((u) => u.n !== row.n), row]);

/** A repeat stopped, paused or closed: off the list. */
export const dropRepeat = (s: StatusIssueState, n: number) =>
  setUpcoming(
    s,
    s.upcoming.filter((u) => u.n !== n),
  );

/**
 * Shipify's own account's repos as the due run just read them (ADR 0047): repo names only, sorted,
 * and which of them are projects.
 */
export function keepRepos(
  s: StatusIssueState,
  repos: { name: string; project: boolean }[],
  at: string,
) {
  const names = [...new Set(repos.map((r) => r.name).filter((n) => REPO_NAME.test(n)))]
    .sort()
    .slice(0, MOST_REPOS);
  const projects = names.filter((n) => repos.some((r) => r.name === n && r.project));
  s.repos = { at, names, projects };
}

const keyOf = (lines: string[]) =>
  lines.length
    ? createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12)
    : undefined;

/**
 * A box's weekly clean-up. Returns a comment to post when doctor's failing checks are new, or all
 * fine again after some failed: once per change, so the same problem never notifies twice.
 */
export function setCleanup(
  s: StatusIssueState,
  box: string,
  c: Omit<Cleanup, "alerted">,
): string | undefined {
  const before = s.cleanups[box]?.alerted;
  const failing = c.checks.filter((x) => !x.ok);
  const key = keyOf(failing.map((x) => x.name));
  s.cleanups[box] = {
    ...c,
    checks: c.checks.map((x) => ({ ...x, detail: x.detail?.slice(0, 200) })),
    alerted: key,
  };
  addEvent(s, `${box}'s clean-up: ${c.summary}`, c.at);
  if (key === before) return undefined;
  if (!failing.length) return `All of doctor's checks on **${box}** are fine again.`;
  return [
    `Doctor found ${failing.length === 1 ? "a problem" : `${failing.length} problems`} on **${box}** in its weekly clean-up:`,
    "",
    ...failing.map(
      (x) => `- **${x.name}**${x.detail ? `: ${x.detail}` : ""}${x.fix ? ` (${x.fix})` : ""}`,
    ),
  ].join("\n");
}

/**
 * A box's health, read on the box itself. Returns a comment to post when what needs a look
 * changes (something new, or all fine again), so the same thing never notifies twice.
 */
export function setBox(
  s: StatusIssueState,
  name: string,
  facts: { name: string; value: string; look?: string }[],
  at = new Date().toISOString(),
): string | undefined {
  const b = s.boxes[name];
  const looks = facts.filter((f) => f.look).map((f) => f.look as string);
  const key = looks.length ? looks.map((l) => l.replace(/\d[\d.]*/g, "#")).join("\n") : undefined;
  const before = b?.alerted;
  s.boxes[name] = {
    ...b,
    at,
    facts: facts.map((f) => ({ ...f, value: f.value.slice(0, 300) })),
    alerted: key,
  };
  if (key === before) return undefined;
  if (!looks.length) return before ? `**${name}** is fine again.` : undefined;
  return [`**${name}** needs a look:`, "", ...looks.map((l) => `- ${l}`)].join("\n");
}

// ---------------------------------------------------------------- the watch's findings

/** A box's or an app's name, as runners and hosts allow: nothing else is ever written. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const BOX_STATES = ["offline", "online", "gone"] as const;
const APP_STATES = ["failing", "fine", "paused", "gone"] as const;
export interface Findings {
  boxes: Record<string, (typeof BOX_STATES)[number]>;
  apps: Record<string, (typeof APP_STATES)[number]>;
  /** A chat channel failing, with what its service said, or fine again: only when one changed. */
  channels?: Record<string, { state: "failing"; error: string } | { state: "fine" }>;
  /** Things to say once, each by its key (a key about to expire, a runner too old, a reply unsent). */
  notes?: { key: string; problem: Problem }[];
}

/**
 * What the watch saw change, from `watch.yml`'s `findings` input: only names it could name, in fixed
 * states. Anything else is dropped, and said in `dropped`.
 */
export function readFindings(json: string): { findings: Findings; dropped: string[] } {
  const findings: Findings = { boxes: {}, apps: {} };
  const dropped: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return { findings, dropped: ["the findings aren't JSON"] };
  }
  const take = <S extends string>(part: unknown, states: readonly S[], into: Record<string, S>) => {
    if (!part || typeof part !== "object") return;
    for (const [name, state] of Object.entries(part as Record<string, unknown>))
      if (NAME.test(name) && states.includes(state as S)) into[name] = state as S;
      else dropped.push(name.slice(0, 64));
  };
  const o = (raw ?? {}) as Record<string, unknown>;
  take(o.boxes, BOX_STATES, findings.boxes);
  take(o.apps, APP_STATES, findings.apps);
  if (o.channels && typeof o.channels === "object")
    for (const [name, c] of Object.entries(o.channels as Record<string, unknown>)) {
      const { state, error } = (c ?? {}) as { state?: unknown; error?: unknown };
      if (!NAME.test(name) || (state !== "failing" && state !== "fine")) {
        dropped.push(name.slice(0, 64));
        continue;
      }
      // What the service said is shown on the status issue: plain words only, never markup.
      const said = String(error ?? "")
        .replace(/[^\w .,:;()'/-]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      findings.channels ??= {};
      findings.channels[name] =
        state === "fine" ? { state } : { state, error: said || "no reason given" };
    }
  if (Array.isArray(o.notes))
    for (const n of o.notes.slice(0, 20)) {
      const key = (n as { key?: unknown })?.key;
      const p = Problem.safeParse((n as { problem?: unknown })?.problem);
      if (typeof key === "string" && /^[\w:.-]{1,120}$/.test(key) && p.success) {
        findings.notes ??= [];
        findings.notes.push({ key, problem: p.data });
      } else dropped.push("a note");
    }
  return { findings, dropped };
}

/**
 * The watch's findings on the record. Only a real change counts (a box reported offline twice is
 * reported once), and returns the comment that notifies you, if anything changed that you'd want
 * to know.
 */
export function applyFindings(
  s: StatusIssueState,
  f: Findings,
  at = new Date().toISOString(),
): string | undefined {
  const lines: string[] = [];
  for (const [name, state] of Object.entries(f.boxes)) {
    const b = s.boxes[name];
    if (state === "offline" && !b?.offline) {
      s.boxes[name] = { facts: [], ...b, offline: at };
      addEvent(s, `${name} went offline`, at);
      lines.push(
        `**${name}** is offline: it didn't answer twice, 4 minutes apart. Runs wait in the queue for a box, up to 24 hours.`,
      );
    } else if (state === "online" && b?.offline) {
      b.offline = undefined;
      addEvent(s, `${name} is back online`, at);
      lines.push(`**${name}** is back online.`);
    } else if (state === "online" && !b) {
      s.boxes[name] = { facts: [] };
      addEvent(s, `${name} joined`, at);
    } else if (state === "gone" && b) {
      delete s.boxes[name];
      delete s.cleanups[name];
      addEvent(s, `${name} was removed`, at);
    }
  }
  for (const [id, state] of Object.entries(f.apps)) {
    let a = s.apps.find((x) => x.id === id);
    const failing = Boolean(a?.failing);
    if (state === "failing" && !failing) {
      if (!a) {
        a = { id };
        s.apps.push(a);
      }
      a.failing = at;
      addEvent(s, `${id} stopped answering`, at);
      lines.push(`**${id}** isn't answering its health check: it failed twice, a minute apart.`);
    } else if (state === "fine" && a && failing) {
      a.failing = undefined;
      addEvent(s, `${id} is answering again`, at);
      lines.push(`**${id}** is answering again.`);
    } else if (state === "paused" && a && failing) {
      // Taken down on purpose (`ship down`): not failing any more, and nothing to tell.
      a.failing = undefined;
      addEvent(s, `${id} was paused`, at);
    } else if (state === "gone" && a) {
      s.apps = s.apps.filter((x) => x.id !== id);
      addEvent(s, `${id} is gone from its host`, at);
    }
  }
  for (const n of f.notes ?? []) {
    if (s.alerted.includes(n.key)) continue;
    s.alerted = [...s.alerted, n.key].slice(-100);
    addEvent(s, n.problem.what, at);
    lines.push(`${n.problem.what} ${n.problem.fix}`);
  }
  for (const [name, c] of Object.entries(f.channels ?? {})) {
    const was = s.channels[name];
    if (c.state === "failing" && !was) {
      s.channels[name] = { failing: at };
      addEvent(s, `${name} stopped reaching the door`, at);
      lines.push(
        `**${name}** isn't reaching the door: ${c.error}. \`pnpm ship selftest ${name}\` says what to fix (docs/channels.md).`,
      );
    } else if (c.state === "fine" && was) {
      delete s.channels[name];
      addEvent(s, `${name} reaches the door again`, at);
      lines.push(`**${name}** reaches the door again.`);
    }
  }
  return lines.length ? lines.map((l) => `- ${l}`).join("\n") : undefined;
}

// ---------------------------------------------------------------- the issue's text

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

export function renderStatusIssue(s: StatusIssueState, timeZone: string): string {
  const when = (iso: string) => formatWhen(iso, timeZone);
  const w = s.watch;
  const next = w.next ? `next due ${when(w.next)}` : "nothing repeats";
  const watch = w.last
    ? [
        `**The watch:** last due run ${when(w.last)}${w.box ? ` on **${w.box}**` : ""}${w.run ? ` · [its run](${w.run})` : ""} · ${next}.`,
        "The watch starts a due run at least once a day: an older time means it has stopped (docs/watch.md).",
      ].join("\n")
    : [
        `**The watch hasn't started a due run yet** · ${next}.`,
        "Until the watch is set up (docs/watch.md), repeats and clean-ups wait; Actions → watch → Run workflow (`due`) runs what's due now.",
      ].join("\n");
  const names = Object.keys(s.boxes).sort();
  const boxLine = names.length
    ? names
        .map((name) => {
          const b = s.boxes[name];
          if (!b) return name;
          if (b.offline) return `**${name}** offline since ${when(b.offline)}`;
          const looks = b.facts.filter((f) => f.look);
          if (!b.at) return `**${name}**, no health read yet`;
          return `**${name}** checked ${when(b.at)}: ${looks.length ? `needs a look (${looks.map((f) => f.look).join("; ")})` : "all fine"}`;
        })
        .join(" · ")
    : "none reported yet";
  const failing = s.apps.filter((a) => a.failing).sort((a, b) => a.id.localeCompare(b.id));
  const appLine = failing.length
    ? failing.map((a) => `**${a.id}** failing since ${when(a.failing as string)}`).join(" · ")
    : "none failing";
  const channels = Object.entries(s.channels).sort(([a], [b]) => a.localeCompare(b));
  const channelLine = channels
    .map(([name, c]) => `**${name}** failing since ${when(c.failing)}`)
    .join(" · ");
  const facts = names
    .map((name) => [name, s.boxes[name]] as const)
    .filter(([, b]) => b?.facts.length)
    .map(([name, b]) =>
      [
        `<details><summary>All of ${name}'s facts</summary>`,
        "",
        "| | |",
        "|---|---|",
        ...(b?.facts ?? []).map(
          (f) => `| ${f.look ? "✗ " : ""}${cell(f.name)} | ${cell(f.value)} |`,
        ),
        "",
        "</details>",
      ].join("\n"),
    );
  const upcoming = s.upcoming.length
    ? [
        "| Task | Next | Schedule |",
        "|---|---|---|",
        ...s.upcoming.map(
          (u) => `| #${u.n} ${cell(u.title)} | ${when(u.next)} | ${cell(u.every ?? "")} |`,
        ),
      ].join("\n")
    : "Nothing repeats yet.";
  const recent = s.events.length
    ? s.events.map((e) => `- ${when(e.at)} · ${e.text}`).join("\n")
    : "Nothing yet.";
  const cleanups = Object.keys(s.cleanups).sort();
  const cleanup = cleanups.length
    ? cleanups
        .map((box) => {
          const k = s.cleanups[box] as Cleanup;
          const bad = k.checks.filter((x) => !x.ok);
          return [
            `**${box}**, ${when(k.at)}${k.run ? ` · [its run](${k.run})` : ""}: ${k.summary}.${
              k.checks.length
                ? ` **Doctor:** ${k.checks.length - bad.length} of ${k.checks.length} checks fine${bad.length ? `; ✗ ${bad.map((x) => x.name).join(", ")}` : ""}.`
                : ""
            }`,
            k.checks.length
              ? [
                  `<details><summary>Doctor's checks on ${box}</summary>`,
                  "",
                  "| | Check | Detail |",
                  "|---|---|---|",
                  ...k.checks.map(
                    (x) => `| ${x.ok ? "✓" : "✗"} | ${cell(x.name)} | ${cell(x.detail ?? "")} |`,
                  ),
                  "",
                  "</details>",
                ].join("\n")
              : undefined,
          ]
            .filter(Boolean)
            .join("\n\n");
        })
        .join("\n\n")
    : "None yet: the due run starts each box's once a week.";
  return [
    `${MARK}${JSON.stringify(s).replaceAll("-->", "--\\u003e")} -->`,
    watch,
    "### Guards",
    [
      `- **Boxes:** ${boxLine}`,
      `- **Apps:** ${appLine}`,
      ...(channelLine ? [`- **Channels:** ${channelLine}`] : []),
    ].join("\n"),
    ...facts,
    "### Coming up",
    upcoming,
    "### Recent",
    recent,
    "### Clean-ups",
    cleanup,
    "<sub>Shipify keeps this issue up to date (ADR 0017, ADR 0019): due runs, clean-ups and alerts write here, and the watch reads it. A problem comes as a comment, which notifies you. Comments here start nothing: open a task to ask something.</sub>",
  ].join("\n\n");
}

// ---------------------------------------------------------------- on GitHub

/**
 * The status issue on the record (plugins/record.ts), by the door's own rule (pickStatusIssue): the
 * open ones, and all of them only when no open one holds the record. With it, where its record is
 * (its own, or the newest closed one's when it has none yet: one you or the door opened, which
 * takes the record over), and the other open ones.
 */
function findStatusIssue(record: TaskRecord): {
  found?: RecordIssue;
  from?: RecordIssue;
  others: RecordIssue[];
} {
  const labels = [STATUS_LABEL.name];
  const open = record.issues({ labels, state: "open" });
  const pick = pickStatusIssue(open);
  const all = holdsRecord(pick) ? [] : record.issues({ labels, state: "all" });
  const found = holdsRecord(pick) ? pick : (pickStatusIssue(all) ?? pick);
  const from = holdsRecord(found) ? found : pickStatusIssue(all.filter(holdsRecord));
  return {
    found,
    from,
    others: open.filter((i) => !i.pull_request && i.number !== found?.number),
  };
}

/** What the status issue holds now, without changing it. */
export function readStatusIssue(opts: { timeoutMs?: number } = {}): StatusIssueState {
  return parseStatusIssue(
    findStatusIssue(githubRecord({ timeoutMs: opts.timeoutMs })).from?.body ?? null,
  );
}

/**
 * Change the status issue: find it (open or closed) or open it, apply `change` to what it holds
 * now, and write it back. `change` may return a comment to post. Read just before writing, so two
 * writers (a due run and a clean-up) rarely meet; the later one wins if they do, and the next due
 * run writes the whole schedule again. A new one (yours, or the door's) takes the record over from
 * the newest closed one. Any other open status issue (a list that left this one out for a while)
 * is closed, unpinned and said under Recent.
 */
export function updateStatusIssue(
  change: (s: StatusIssueState) => string | undefined,
  opts: { timeZone: string; timeoutMs?: number; record?: TaskRecord },
): { issue?: number; comment?: number } {
  const record = opts.record ?? githubRecord({ timeoutMs: opts.timeoutMs });
  let looked = findStatusIssue(record);
  // A list can leave an issue out for a while, with no error: one empty answer isn't enough.
  if (!looked.found) looked = findStatusIssue(record);
  const { found, from, others } = looked;
  const state = parseStatusIssue(from?.body ?? null);
  if (found && from && from.number !== found.number)
    addEvent(state, `The record moved here from #${from.number}`);
  const alert = change(state) || undefined;
  const closed = others.filter((i) => {
    try {
      record.updateIssue(i.number, { state: "closed", state_reason: "not_planned" });
    } catch {
      return false;
    }
    record.unpin(i);
    return true;
  });
  if (found && closed.length)
    addEvent(
      state,
      `Closed ${closed.length === 1 ? "another status issue" : `${closed.length} other status issues`} (${closed
        .slice(0, 20)
        .map((i) => `#${i.number}`)
        .join(", ")}${closed.length > 20 ? ", …" : ""}): the record is #${found.number}`,
    );
  const body = renderStatusIssue(state, opts.timeZone);
  let number = found?.number;
  if (found) record.updateIssue(found.number, { body });
  else {
    record.makeLabel(STATUS_LABEL);
    const made = record.createIssue({ title: TITLE, body, labels: [STATUS_LABEL.name] });
    number = made.number;
    // Pinned on top of the issues, when the token may; otherwise the owner pins it once.
    record.pin(made);
  }
  // The alert is a comment, which notifies the owner: GitHub's channel. Best effort, as it always was.
  if (!alert || !number) return { ...(number ? { issue: number } : {}) };
  const d = postComment(record, number, alert);
  return { issue: number, ...(d.ok ? { comment: d.id } : {}) };
}

/**
 * Change the status issue, never failing the caller: a task's own work comes first. Whether it was
 * written, for a caller that tries again when it wasn't.
 */
export function tryStatusIssue(
  change: (s: StatusIssueState) => string | undefined,
  opts: { timeZone: string; timeoutMs?: number },
): boolean {
  try {
    updateStatusIssue(change, opts);
    return true;
  } catch (e) {
    process.stderr.write(`  … couldn't update the status issue (${(e as Error).message})\n`);
    return false;
  }
}
