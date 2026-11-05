// Guests (ADR 0071): the people you add in Setup → Guests, kept in one object in the web chat's
// store (R2, `_guests`, which no file's ref can be). The guests' Access application is set once on
// GitHub, with yours (SHIPIFY_ACCESS's `guests`): no page can change which door a guest's token opens.
// Access signs a guest in with a code it emails them, and only proves their email; this list says
// who is a guest. An email that isn't on it gets nothing (fails closed), as does every guest while
// the list can't be read. Read at most every 10 s, so a removed guest is refused within 10 s.
import {
  emailOf,
  GUEST_LABEL,
  guestIdOf,
  guestLabel,
  STATE_LABELS,
  STAYING_LABEL,
} from "../../cli/contracts/index.ts";
import { accessClaims } from "./access.ts";
import { cached, forget } from "./cache.ts";
import type { Bucket, Deps, Env } from "./env.ts";
import { bucketOf } from "./env.ts";
import type { GitHub } from "./github.ts";
import type { Settings } from "./settings.ts";

/** The store's key for the list: no file's ref looks like it, so Files never lists it. */
export const GUESTS_KEY = "_guests";
/** How long a read of the list is kept: a removed guest is refused within this. */
const GUESTS_MS = 10_000;
/** A guest's "last in" is written at most this often: a write a guest an hour, at most. */
const SEEN_MS = 3_600_000;
/** How many guests the list holds: Access's free plan has 50 seats, you among them. */
export const MOST_GUESTS = 49;

/** A guest, as you added them. */
export interface Guest {
  /** Their id, from their email (`guest-ana-3f9a2c`): their chat id and their marks. */
  id: string;
  email: string;
  /** The name you gave: what their chats say they're from. */
  name: string;
  /** When you added them (ms). */
  added: number;
  /** When they were last in (ms), to the hour. */
  seen?: number;
}

/** What the store keeps: the guests. */
export interface Guests {
  v: 1;
  guests: Guest[];
}

const NONE: Guests = { v: 1, guests: [] };
/** A guest's name: what their from-lines say (40 at most there). */
export const GUEST_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,39}$/u;

function parse(text: string): Guests {
  const o = JSON.parse(text) as Partial<Guests>;
  const guests = (Array.isArray(o.guests) ? o.guests : []).filter(
    (g): g is Guest =>
      typeof g?.id === "string" &&
      typeof g.email === "string" &&
      typeof g.name === "string" &&
      typeof g.added === "number",
  );
  return { v: 1, guests };
}

/** The list as the store has it, read now: none kept yet is no guests. */
async function readGuests(bucket: Bucket): Promise<Guests> {
  const o = await bucket.get(GUESTS_KEY);
  if (!o) return NONE;
  return parse(await new Response(o.body).text());
}

/** The list, kept 10 s for every request of this Worker. No store: no guests. */
export function guestsOf(env: Env, deps: Deps): Promise<Guests> {
  const bucket = bucketOf(env);
  if (!bucket) return Promise.resolve(NONE);
  return cached(GUESTS_KEY, GUESTS_MS, () => readGuests(bucket), deps.now());
}

/** The list changed: written whole, and read again by the next request. */
async function keep(bucket: Bucket, g: Guests) {
  await bucket.put(GUESTS_KEY, JSON.stringify(g));
  forget(GUESTS_KEY);
}

/** What a change to the list says back: the list, or why not. */
type Changed = { guests: Guests } | { why: string };

/**
 * A guest added: an email and a name. The same email again keeps its id (and finds their old
 * chats), with the new name.
 */
export async function addGuest(
  env: Env,
  deps: Deps,
  email: string,
  name: string,
): Promise<Changed> {
  const bucket = bucketOf(env);
  if (!bucket) return { why: "The chat's file store isn't set up: guests need it." };
  const e = emailOf(email);
  if (!e) return { why: "That isn't an email." };
  const n = name.trim().replace(/\s+/g, " ");
  if (!GUEST_NAME.test(n)) return { why: "Give a name of 40 letters or fewer." };
  const g = await readGuests(bucket);
  const id = await guestIdOf(e);
  const had = g.guests.find((x) => x.id === id);
  if (!had && g.guests.length >= MOST_GUESTS)
    return { why: `${MOST_GUESTS} guests at most: Access's free plan has 50 seats.` };
  const guests = had
    ? g.guests.map((x) => (x.id === id ? { ...x, name: n } : x))
    : [...g.guests, { id, email: e, name: n, added: deps.now() }];
  const next = { ...g, guests };
  await keep(bucket, next);
  return { guests: next };
}

/**
 * A guest removed: refused within 10 s. Their open chats and projects close, so their files go 30
 * days later (the weekly clean-up); their chats stay on GitHub. How many closed.
 */
export async function removeGuest(
  env: Env,
  gh: GitHub,
  id: string,
): Promise<Changed & { closed?: number }> {
  const bucket = bucketOf(env);
  if (!bucket) return { why: "The chat's file store isn't set up." };
  const g = await readGuests(bucket);
  if (!g.guests.some((x) => x.id === id)) return { why: "That guest isn't on the list." };
  const next = { ...g, guests: g.guests.filter((x) => x.id !== id) };
  await keep(bucket, next);
  return { guests: next, closed: await closeAll(gh, id) };
}

/** A guest's open chats and projects closed, as the door closes one (its state labels off). */
async function closeAll(gh: GitHub, id: string) {
  type Issue = { number: number; labels?: { name: string }[]; pull_request?: unknown };
  const open = await gh
    .json<Issue[]>(
      "GET",
      `repos/${gh.repo}/issues?labels=${encodeURIComponent(guestLabel(id))}&state=open&per_page=100`,
    )
    .catch(() => [] as Issue[]);
  const gone = new Set<string>([...STATE_LABELS, STAYING_LABEL]);
  let closed = 0;
  for (const i of open.filter((x) => !x.pull_request)) {
    const r = await gh
      .call("PATCH", `repos/${gh.repo}/issues/${i.number}`, {
        state: "closed",
        state_reason: "completed",
        labels: (i.labels ?? []).map((l) => l.name).filter((l) => !gone.has(l)),
      })
      .catch(() => undefined);
    if (r && r.status === 200) closed++;
  }
  return closed;
}

/** Who a request at `/guest/` is: a guest on the list, or why not (the page's words). */
export type Door =
  | { guest: Guest }
  | { why: "off" | "unread" | "signed out" | "not a guest"; status: number };

/**
 * The guest a request comes from: the guests' Access application's token (your team's, the AUD in
 * SHIPIFY_ACCESS's `guests`), its email on the list. Each check fails closed. Their "last in" is
 * kept, an hour at most.
 */
export async function guestAt(req: Request, env: Env, deps: Deps, s: Settings): Promise<Door> {
  if (!s.access?.guests) return { why: "off", status: 404 };
  let g: Guests;
  try {
    g = await guestsOf(env, deps);
  } catch {
    return { why: "unread", status: 503 };
  }
  const claims = await accessClaims(
    req.headers.get("cf-access-jwt-assertion"),
    { team: s.access.team, aud: s.access.guests },
    deps,
  );
  if (!claims) return { why: "signed out", status: 403 };
  const email = emailOf(claims.email);
  const guest = email ? g.guests.find((x) => x.email === email) : undefined;
  if (!guest) return { why: "not a guest", status: 403 };
  if (deps.now() - (guest.seen ?? 0) > SEEN_MS) {
    const bucket = bucketOf(env) as Bucket;
    const at = deps.now();
    const work = readGuests(bucket)
      .then((now) =>
        keep(bucket, {
          ...now,
          guests: now.guests.map((x) => (x.id === guest.id ? { ...x, seen: at } : x)),
        }),
      )
      .catch(() => {});
    if (deps.waitUntil) deps.waitUntil(work);
    else await work;
  }
  return { guest };
}

/** Whether an issue carries a guest's mark: your reads leave these out. */
export const markedGuest = (labels: string[]) => labels.includes(GUEST_LABEL);
