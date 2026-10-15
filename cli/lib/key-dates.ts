// The dates the watch reminds you of (SHIPIFY_KEY_DATES on shipify, docs/setup.md): each key's
// renewal date, by a plain name. Written where a key is made or read: `ship doctor --yes` (this
// PC's token, each agent's login) and `ship door setup` (the door App's key). Dates, never keys.

/** A date a year from `from` (YYYY-MM-DD): a login or a key that wants renewing yearly. */
export const inAYear = (from: string | Date = new Date()) => {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

/** The variable's dates, read leniently: anything that isn't an object of names and dates is none. */
export function readKeyDates(raw: string | undefined): Record<string, string> {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(o).filter(
        (e): e is [string, string] => typeof e[1] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e[1]),
      ),
    );
  } catch {
    return {};
  }
}

/** The dates with these set: the variable's new value, or undefined when nothing changed. */
export function withKeyDates(raw: string | undefined, set: Record<string, string>) {
  const dates = readKeyDates(raw);
  const changed = Object.entries(set).some(([k, v]) => dates[k] !== v);
  return changed ? JSON.stringify({ ...dates, ...set }) : undefined;
}
