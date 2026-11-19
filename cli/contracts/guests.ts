// Guests (ADR 0071): people you add in Setup → Guests, each in a space of their own in the web chat.
// The names the core and the edge share, so both read a guest's marks the same way:
//   - a guest's id, from the email Access signed in: `guest-<the email's name part>-<6 hex>`;
//   - their prefix, `g<the same 6 hex>`: on their files' refs in R2 and their projects' names;
//   - their labels, `guest` and `guest:<id>`, for the lists, and a doc a run wrote;
//   - the truth, `guest` on the opening `from` line the door wrote (lines.ts), and a ref's prefix:
//     whose an issue is (`whose`); and what a guest may do (`GUEST_RULES`), one table.
// A thing with no guest mark is yours, so nothing of yours changes.
import type { Capture } from "./projects.ts";
import type { Word } from "./words.ts";

/** On every chat, project and doc of a guest's: your reads leave these out. */
export const GUEST_LABEL = "guest";
/** On each of one guest's: their list reads by it (an issue list, never a search). */
export const guestLabel = (id: string) => `${GUEST_LABEL}:${id}`;

/** A guest's id: `guest-<name, 16 at most>-<6 hex>`, the web chat's chat id for them (31 at most). */
export const GUEST_ID = /^guest-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?-[0-9a-f]{6}$/;
export const isGuestId = (id: string | undefined): id is string => GUEST_ID.test(id ?? "");

/**
 * Whose an issue is (ADR 0071): a guest's id, or undefined for yours. The one check, the edge's and
 * the box's, from its labels and who wrote it (`by`, as the reader proved it). What the door wrote
 * is whose its opening `from` line says (`from`, the guest it names); a doc a run wrote, whose
 * label it carries; anything else anyone wrote, yours. An item of a list whose writer the reader
 * didn't prove (no `by`: a project's chats, a page) is whose label it carries. One marked a
 * guest's with no id of theirs (`guest` alone) is `guest`: no guest's to open, and none of yours.
 */
export function whose(i: {
  labels?: readonly (string | { name?: string })[];
  by?: "door" | "run" | "other";
  from?: string;
}): string | undefined {
  if (i.by === "door") return i.from;
  if (i.by === "other") return undefined;
  const labels = (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? "")));
  const id = labels.find((l) => l.startsWith(`${GUEST_LABEL}:`))?.slice(GUEST_LABEL.length + 1);
  if (isGuestId(id)) return id;
  return labels.includes(GUEST_LABEL) ? GUEST_LABEL : undefined;
}

/** An email as Access gives it, trimmed and lowercase, or undefined for anything else. */
export function emailOf(v: unknown): string | undefined {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? e : undefined;
}

/** A guest's id from their email: the same for an email every time, different between emails. */
export async function guestIdOf(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e));
  const hex = [...new Uint8Array(hash).slice(0, 3)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const name =
    (e.split("@")[0] ?? "")
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 16)
      .replace(/^-+|-+$/g, "") || "guest";
  return `guest-${name}-${hex}`;
}

/** A guest's prefix (`g3f9a2c`): on their files' refs and their projects' names. */
export const guestPrefix = (id: string) => `g${id.slice(-6)}`;
/** A prefix's shape: what no ref or project of yours starts with. */
export const GUEST_PREFIX = /^g[0-9a-f]{6}-/;

/**
 * A file's ref in the web chat's store (R2): `f-<time counted down>-<id>` for yours, the guest's
 * prefix for theirs (`g3f9a2c-…`). Its time is counted down, so R2's list gives the newest first.
 */
export const fileRefOf = (now: number, guest?: string) =>
  `${guest ? guestPrefix(guest) : "f"}-${String(Math.max(0, 1e13 - Math.floor(now))).padStart(13, "0")}-${crypto.randomUUID().replace(/-/g, "")}`;
/**
 * A file's ref in the store: yours (`f-…`), a guest's (`g3f9a2c-…`), or one from before R2,
 * copied under its old key: yours (`up-…`) or a run's (`run-<task>-…`). Nothing else is read.
 */
export const WEB_FILE_REF =
  /^(?:(?:f|g[0-9a-f]{6})-\d{13}-[a-z0-9]{16,40}|up-[a-z0-9]{16,40}|run-\d{1,9}-[a-z0-9]{16,40})$/;
/** Whether a ref is this guest's: its prefix. */
export const guestOwns = (id: string, ref: string) => ref.startsWith(`${guestPrefix(id)}-`);

/** A guest's project's name on GitHub: their prefix, then the name they gave (`g3f9a2c-health`). */
export const guestProject = (id: string, name: string) => `${guestPrefix(id)}-${name}`;
/** The name a project shows in the window: a guest's without its prefix. */
export const shownProject = (name: string) => name.replace(GUEST_PREFIX, "");

/** What a guest may do (ADR 0071): the one table each guest list of the edge, page and box is made from. */
export const GUEST_RULES: {
  routes: Readonly<Record<string, "owner" | "guest">>;
  commands: readonly string[];
  words: readonly Word[];
  saves: readonly Capture["kind"][];
} = {
  /**
   * Whose each route of the window is (`<method> <route>`): a guest's too, or yours alone. One with
   * no rule answers 404 to everyone (the route test checks each). A screen has its GET route's name.
   */
  routes: {
    "GET list": "guest",
    "GET task": "guest",
    "GET menu": "guest",
    "GET models": "guest",
    "GET search": "guest",
    "GET files": "guest",
    "GET file": "guest",
    "GET doc": "guest",
    "GET repeats": "owner",
    "GET notebook": "owner",
    "GET setup": "owner",
    "GET sent": "owner",
    "POST file": "guest",
    "DELETE file": "guest",
    "POST send": "guest",
    "POST push": "guest",
    "POST move": "guest",
    "POST edit": "guest",
    "POST repeat": "owner",
    "POST guests": "owner",
  },
  /** The commands a guest may use: their menu shows these alone; the door refuses the rest. */
  commands: ["ask", "use", "models", "help"],
  /** The fixed words a guest never says: the door refuses them, the box reads them as words. */
  words: ["yes", "no", "go", "publish", "preview", "start over", "clean start", "sign in"],
  /** What only you save with no run (`jot: …`): the door refuses it. */
  saves: ["jot"],
};
