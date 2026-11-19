// Node.js: the major Shipify runs on everywhere, and when each LTS major's support ends, from
// nodejs.org's release schedule (tasks #786, #790): the one place for both. The CLI's build,
// doctor, `ship setup` and the box's tools read the major; the copies that can't (box/setup.sh and
// here.sh, every workflow, the stacks' .nvmrc, Shipify's and the stacks' engines) are held to it by
// tests/node.test.ts. The weekly digest warns before the Node a box runs ends its support: the move
// to the next LTS is then a `shipify:` task, which adds its line to NODE_ENDS and moves NODE_MAJOR.

/** Each LTS major's end of support (its end of life). */
export const NODE_ENDS: Record<number, string> = {
  22: "2027-04-30",
  24: "2028-04-30",
  26: "2029-04-30",
};

/** The Node.js major Shipify runs on everywhere: an LTS, its end in NODE_ENDS. */
export const NODE_MAJOR = 26;

/** The digest warns from this many days before a major's end. */
export const NODE_WARN_DAYS = 90;

const DAY = 24 * 3600_000;

/**
 * This Node's end of support, from NODE_WARN_DAYS before it on (and after it): its major, the day,
 * and the days left (0 once it's past). None for a major the list doesn't name, or one further off.
 */
export function nodeEnding(
  version: string,
  at: Date,
): { major: number; date: string; days: number } | undefined {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  const date = NODE_ENDS[major];
  if (!date) return undefined;
  const days = Math.ceil((Date.parse(date) - at.getTime()) / DAY);
  return days <= NODE_WARN_DAYS ? { major, date, days: Math.max(0, days) } : undefined;
}
