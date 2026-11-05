// Guests (ADR 0071): people you add in Setup → Guests, each in a space of their own in the web chat.
// The names the core and the edge share, so both read a guest's marks the same way:
//   - a guest's id, from the email Access signed in: `guest-<the email's name part>-<6 hex>`;
//   - their prefix, `g<the same 6 hex>`: on their files' refs in R2 and their projects' names;
//   - their labels, `guest` and `guest:<id>`, for the lists only;
//   - the truth, `guest` on the opening `from` line the door wrote (lines.ts), and a ref's prefix.
// A thing with no guest mark is yours, so nothing of yours changes.

/** On every chat, project and doc of a guest's: your reads leave these out. */
export const GUEST_LABEL = "guest";
/** On each of one guest's: their list reads by it (an issue list, never a search). */
export const guestLabel = (id: string) => `${GUEST_LABEL}:${id}`;

/** A guest's id: `guest-<name, 16 at most>-<6 hex>`, the web chat's chat id for them (31 at most). */
export const GUEST_ID = /^guest-[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?-[0-9a-f]{6}$/;
export const isGuestId = (id: string | undefined): id is string => GUEST_ID.test(id ?? "");

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
