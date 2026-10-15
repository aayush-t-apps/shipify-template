// The owner's time zone: every repeat runs in it, on the box, and every chat says it beside a time
// of day ("every Sunday at 14:00 IST"). One zone, read by the core and the edge alike: your copy's
// SHIPIFY_TIME_ZONE (ADR 0047), handed in once where each starts (the CLI, each edge request);
// UTC until then. Pure: Intl only.

let zone = "UTC";

/** Your copy's zone, from where it starts: an IANA name, else UTC. */
export function useTimeZone(timeZone: string | undefined): void {
  const z = (timeZone ?? "").trim();
  zone = z && validZone(z) ? z : "UTC";
}

/** The zone repeats run in, as handed in (UTC when none was). */
export const timeZoneNow = () => zone;

const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

/**
 * The zone's short name at a moment: its own ("CEST", "PDT"), or, where Intl's short name is only an
 * offset ("GMT+5:30"), the initials of its long name ("India Standard Time"), when it has three
 * words or more; else the offset.
 */
export function zoneName(iso: string, timeZone = zone): string {
  const named = (style: "short" | "long") =>
    new Intl.DateTimeFormat("en", { timeZone, timeZoneName: style })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  const short = named("short");
  if (!/^GMT[+-]/.test(short)) return short;
  const words = named("long").split(" ");
  return words.length >= 3 ? words.map((w) => w[0]).join("") : short;
}

/** The ways a schedule may name the zone it runs in: "IST", "Asia/Kolkata", "GMT+5:30". */
function zoneWords(timeZone: string, now: string): string[] {
  const offset =
    new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(now))
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return [zoneName(now, timeZone), timeZone, offset].filter(Boolean).map((w) => w.toLowerCase());
}

/**
 * A schedule's words with a trailing name of the owner's zone taken off ("every Sunday at 2 pm IST"
 * is read as "every Sunday at 2 pm"). Another zone's name stays, and the schedule doesn't read: a
 * repeat runs in one zone, never converted.
 */
export function withoutZone(text: string, timeZone = zone): string {
  const t = text.trim();
  const names = zoneWords(timeZone, new Date().toISOString());
  const last = /\s+(\S+)$/.exec(t);
  return last && names.includes((last[1] ?? "").toLowerCase()) ? t.slice(0, last.index) : t;
}

/** A schedule as a chat shows it: its zone said when it has a time of day ("… at 14:00 IST"). */
export function withZone(every: string, timeZone = zone): string {
  const name = zoneName(new Date().toISOString(), timeZone);
  return /\d{1,2}:\d{2}$/.test(every.trim()) ? `${every.trim()} ${name}` : every;
}
