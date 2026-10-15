// What the edge reads from shipify on GitHub, with the door App, kept a short while per isolate:
//   its variables  who's who (SHIPIFY_PEOPLE), the owner, the kill switch (SHIPIFY_DOOR=closed)
//                  the key dates the watch reminds you of (SHIPIFY_KEY_DATES) and the status
//                  page's Access application (SHIPIFY_ACCESS), each box's console
//                  (SHIPIFY_CONSOLES), your time zone (SHIPIFY_TIME_ZONE), in one listing
//   its runners    the boxes, online or not
//   its status task  the record the due run writes (cli/contracts/watch.ts: RecordSeen)
// Every value is checked before it's used; a list that doesn't read is nobody, never everybody.
import {
  type PageSeen,
  parseAccounts,
  type RecordSeen,
  readRecordSeen,
  useDefaultAgent,
  useTimeZone,
} from "../../cli/contracts/index.ts";
import { type AccessApp, parseAccess } from "./access.ts";
import { cached, stale } from "./cache.ts";
import { channelOf } from "./channels/index.ts";
import { type Env, obj } from "./env.ts";
import type { GitHub } from "./github.ts";

/** One person in SHIPIFY_PEOPLE: their name and their id on each channel. */
export interface Person {
  name: string;
  on: Record<string, string>;
}

/** SHIPIFY_PEOPLE's people. Not JSON or not a list: nobody (fail closed). */
export function parsePeople(value: string | undefined): Person[] {
  let raw: unknown;
  try {
    raw = JSON.parse(value ?? "");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): Person[] => {
    const o = obj(p);
    const on = obj(o?.on);
    if (!o || !on || typeof o.name !== "string" || !o.name.trim()) return [];
    return [
      {
        name: o.name.trim().slice(0, 40),
        on: Object.fromEntries(
          Object.entries(on).filter((e): e is [string, string] => typeof e[1] === "string"),
        ),
      },
    ];
  });
}

/** A chat a message may go to: on a channel the edge has, in that channel's shape. */
export interface Chat {
  channel: string;
  chat: string;
}

/** The person whose id this is on this channel (its id, and the shape of its ids). */
export const personOf = (
  people: Person[],
  ch: { id: string; chatId: RegExp } | undefined,
  id: string,
) => (ch ? people.find((p) => ch.chatId.test(p.on[ch.id] ?? "") && p.on[ch.id] === id) : undefined);

/** Everyone's chat on every channel the edge has, for what goes to all of you (an alert). */
export const chatsOf = (people: Person[]): Chat[] =>
  people.flatMap((p) =>
    Object.entries(p.on).flatMap(([channel, chat]) =>
      channelOf(channel)?.chatId.test(chat) ? [{ channel, chat }] : [],
    ),
  );

/** A reply's `to` (`<channel>:<id>`), kept to the chats of people in SHIPIFY_PEOPLE. */
export const chatsIn = (to: string[], people: Person[]): Chat[] => {
  const seen = new Set<string>();
  return to.flatMap((t) => {
    const hit = /^([a-z][a-z0-9-]{0,30}):(.{1,64})$/.exec(t);
    if (!hit?.[1] || !hit[2] || seen.has(t) || !personOf(people, channelOf(hit[1]), hit[2]))
      return [];
    seen.add(t);
    return [{ channel: hit[1], chat: hit[2] }];
  });
};

export interface Settings {
  people: Person[];
  /** SHIPIFY_DOOR is "closed": the door answers 503, and nothing goes out. */
  closed: boolean;
  /** SHIPIFY_OWNER: your GitHub login. Unset, no one's words count but the door's. */
  owner?: string;
  /** SHIPIFY_KEY_DATES: {"<key>": "YYYY-MM-DD"}, for the watch's reminders. */
  keyDates: Record<string, string>;
  /** SHIPIFY_GATEWAYS: {"<gateway>": "YYYY-MM-DD"}, the gateways `ship add` set a key for, and when. */
  gateways: Record<string, string>;
  /** SHIPIFY_ACCESS: the Access application the status page trusts (`ship door page`). */
  access?: AccessApp;
  /** SHIPIFY_CONSOLES: each box's web console (`box add --manage`): {"<box>": "https://…"}. */
  consoles: Record<string, string>;
  /** SHIPIFY_ACCOUNTS: your other accounts, by login (ADR 0045). */
  accounts: string[];
  /** SHIPIFY_TIME_ZONE: your zone as your copy says now, so a change shows without a deploy. */
  timeZone?: string;
  /** SHIPIFY_AGENT: the agent a task runs when nothing picks one (the menus' default too). */
  agent?: string;
}

/** Box consoles, kept to box names and https addresses. */
export function parseConsoles(value: string | undefined): Record<string, string> {
  try {
    const o = obj(JSON.parse(value ?? "{}")) ?? {};
    return Object.fromEntries(
      Object.entries(o).filter(
        (e): e is [string, string] =>
          /^[\w.-]{1,64}$/.test(e[0]) &&
          typeof e[1] === "string" &&
          e[1].length < 300 &&
          /^https:\/\/[^\s"<>]+$/.test(e[1]),
      ),
    );
  } catch {
    return {};
  }
}

/** Key dates, kept to names and real dates. */
export function parseKeyDates(value: string | undefined): Record<string, string> {
  try {
    const o = obj(JSON.parse(value ?? "{}")) ?? {};
    return Object.fromEntries(
      Object.entries(o).filter(
        (e): e is [string, string] =>
          /^[\w .:'’-]{1,60}$/.test(e[0]) &&
          typeof e[1] === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(e[1]) &&
          !Number.isNaN(Date.parse(e[1])),
      ),
    );
  } catch {
    return {};
  }
}

const settingsKey = (repo: string) => `settings:${repo}`;

/**
 * shipify's variables, read in one listing (two pages at most) and kept a minute. A read that fails
 * goes up, to be told: nothing acts on an older read. It sets your zone, when the variable has one.
 */
export async function settings(gh: GitHub, now: number): Promise<Settings> {
  const s = await cached(
    settingsKey(gh.repo),
    60_000,
    async () => {
      const vars: Record<string, string> = {};
      for (let page = 1; page <= 2; page++) {
        const r = await gh.json<{ total_count?: number; variables?: unknown[] }>(
          "GET",
          `repos/${gh.repo}/actions/variables?per_page=30&page=${page}`,
        );
        for (const v of r.variables ?? []) {
          const o = obj(v);
          if (typeof o?.name === "string" && typeof o.value === "string") vars[o.name] = o.value;
        }
        if ((r.total_count ?? 0) <= page * 30) break;
      }
      return {
        people: parsePeople(vars.SHIPIFY_PEOPLE),
        closed: (vars.SHIPIFY_DOOR ?? "").trim().toLowerCase() === "closed",
        ...(vars.SHIPIFY_OWNER?.trim() ? { owner: vars.SHIPIFY_OWNER.trim() } : {}),
        keyDates: parseKeyDates(vars.SHIPIFY_KEY_DATES),
        gateways: parseKeyDates(vars.SHIPIFY_GATEWAYS),
        consoles: parseConsoles(vars.SHIPIFY_CONSOLES),
        ...(parseAccess(vars.SHIPIFY_ACCESS) ? { access: parseAccess(vars.SHIPIFY_ACCESS) } : {}),
        // Your other accounts (ADR 0045), by login: /repos names them.
        accounts: parseAccounts(vars.SHIPIFY_ACCOUNTS, gh.repo.split("/")[0] ?? "").map(
          (a) => a.login,
        ),
        ...(vars.SHIPIFY_TIME_ZONE?.trim() ? { timeZone: vars.SHIPIFY_TIME_ZONE.trim() } : {}),
        ...(vars.SHIPIFY_AGENT?.trim() ? { agent: vars.SHIPIFY_AGENT.trim() } : {}),
      };
    },
    now,
  );
  if (s.timeZone) useTimeZone(s.timeZone);
  useDefaultAgent(s.agent);
  return s;
}

/**
 * The zone a request or a tick starts in: SHIPIFY_TIME_ZONE as this instance last read it, else the
 * one deployed with (ci.yml), only a fallback since the variable can change after a deploy.
 */
export const zoneOf = (env: Env) =>
  stale<Settings>(settingsKey(env.GITHUB_REPO ?? ""))?.timeZone ?? env.SHIPIFY_TIME_ZONE;

/**
 * Who was who at this instance's last good read, however old: only to know who's writing while
 * GitHub can't be read, so what broke is told to people alone (the door's key, above all). It lets
 * no one in and decides nothing else. None when this instance has read nothing yet.
 */
export const lastPeople = (gh: GitHub): Person[] | undefined =>
  stale<Settings>(settingsKey(gh.repo))?.people;

// ---------------------------------------------------------------- the notebook

/** /notebook lists this many pages at most. */
const MAX_PAGES = 30;

/** The notebook's pages (open issues labelled `notebook`): topic, first line, size and link. */
export async function notebookPages(gh: GitHub): Promise<PageSeen[]> {
  const list = await gh.json<
    { title?: string; body?: string | null; html_url?: string; pull_request?: unknown }[]
  >("GET", `repos/${gh.repo}/issues?labels=${NOTEBOOK_LABEL}&state=open&per_page=${MAX_PAGES}`);
  return list
    .filter((i) => !i.pull_request && /^Notebook: /.test(i.title ?? ""))
    .map((i) => {
      const lines = (i.body ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("<!--"));
      return {
        topic: (i.title ?? "").slice("Notebook: ".length),
        first: (lines[0] ?? "").replace(/^[-*]\s+/, ""),
        lines: lines.length,
        url: i.html_url ?? "",
      };
    })
    .sort((a, b) =>
      a.topic === "Preferences"
        ? -1
        : b.topic === "Preferences"
          ? 1
          : a.topic.localeCompare(b.topic),
    );
}

// ---------------------------------------------------------------- boxes

/** Runners with this label are boxes (ADR 0020): one runner per slot, grouped by `box-<name>`. */
export const BOX_LABEL = "shipify-box";

export interface RawRunner {
  name: string;
  status: string;
  busy: boolean;
  labels: { name: string }[];
}

export interface Box {
  name: string;
  online: boolean;
  slots: number;
  busy: number;
}

/** The box a runner belongs to: its `box-<name>` label, else its own name. */
export const boxOf = (r: RawRunner) =>
  r.labels.map((l) => /^box-(.+)$/.exec(l.name)?.[1]).find(Boolean) ?? r.name;

/** Each box, from shipify's runners: online when any of its slots is. */
export function toBoxes(runners: RawRunner[]): Box[] {
  const groups = new Map<string, RawRunner[]>();
  for (const r of runners.filter((x) => x.labels.some((l) => l.name === BOX_LABEL))) {
    const name = boxOf(r).slice(0, 64);
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  return [...groups]
    .map(([name, slots]) => {
      const online = slots.filter((r) => r.status === "online");
      return {
        name,
        online: online.length > 0,
        slots: slots.length,
        busy: online.filter((r) => r.busy).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** shipify's runners, as they are now (or within `ms`). */
export const runners = (gh: GitHub, now: number, ms = 0) =>
  cached(
    `runners:${gh.repo}`,
    ms,
    async () =>
      (
        await gh.json<{ runners?: RawRunner[] }>(
          "GET",
          `repos/${gh.repo}/actions/runners?per_page=100`,
        )
      ).runners ?? [],
    now,
  );

// ---------------------------------------------------------------- the status task

export const STATUS_LABEL = "shipify-status";
export const NOTEBOOK_LABEL = "notebook";

export interface StatusTask {
  number: number;
  labels: string[];
  /** Its record, when a due run has written one this edge reads. */
  record?: RecordSeen;
}

/** The status task (labelled shipify-status, open or closed), and its record. */
export async function statusTask(gh: GitHub): Promise<StatusTask | undefined> {
  const list = await gh.json<
    { number: number; body?: string | null; pull_request?: unknown; labels?: { name: string }[] }[]
  >("GET", `repos/${gh.repo}/issues?labels=${STATUS_LABEL}&state=all&per_page=5`);
  const issues = list.filter((i) => !i.pull_request);
  const found =
    issues.find((i) => readRecordSeen(i.body)) ?? issues.sort((a, b) => a.number - b.number)[0];
  if (!found) return undefined;
  const record = readRecordSeen(found.body);
  return {
    number: found.number,
    labels: (found.labels ?? []).map((l) => l.name),
    ...(record ? { record } : {}),
  };
}
