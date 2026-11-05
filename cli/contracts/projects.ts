// Projects you make and the Library (ADR 0069): names the core and the edge share. A project is an
// issue `Project: <name>` labelled `project`, its brief its body (a `Repos: …` line when it owns
// repos); its chats are its sub-issues, each with `Part of #<project>` or the `in-project` label.
// Its pages are notebook pages labelled `library` and `project:<name>`, never sub-issues, so a
// project keeps GitHub's 100 sub-issues for its chats. A `library` page with no project is read
// only on demand (the Journal, idea dumps). Saving into them (`project:`, `add`, `jot`) starts no run.
// A project is open or closed, and every surface shows which: closed, it's read-only.
import { timeZoneNow } from "./zone.ts";

/** On a project's issue: the door opens it, and the box runs nothing for its opening or edits. */
export const PROJECT_LABEL = "project";
/** On a chat moved into a project: its link is the sub-issue; the label says so with no body edit. */
export const IN_PROJECT_LABEL = "in-project";
/** On a Library page: read by no run until one asks, unless a project's label says whose it is. */
export const LIBRARY_LABEL = "library";
/** A project's issue title starts so. */
const PROJECT_PREFIX = "Project: ";
/** GitHub's limit of sub-issues on one issue: a project's chats. */
export const MOST_CHATS = 100;

/** A project's name: as a repo's, lowercase letters, digits and dashes. */
export const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,38}$/;

/** The label on a project's pages. */
export const projectLabel = (name: string) => `project:${name}`;
/** The project a page belongs to, from its labels. */
export const projectOfLabels = (labels: string[]) =>
  labels.find((l) => l.startsWith("project:"))?.slice("project:".length) || undefined;
/** A project's title, and its name from one. */
export const projectTitle = (name: string) => `${PROJECT_PREFIX}${name}`;
export const projectNameOf = (title: string) => {
  const name = title.startsWith(PROJECT_PREFIX) ? title.slice(PROJECT_PREFIX.length).trim() : "";
  return PROJECT_NAME.test(name) ? name : undefined;
};
/** A project's Inbox page's topic: `Notebook: <name>-inbox`. */
export const inboxTopic = (name: string) => `${name}-inbox`;
/**
 * An Inbox's items that wait for a collate (ADR 0070): its comments, less the ones its last
 * collate counted on its line `Collated up to item <id> (<count> items).`
 */
export const waitingItems = (body: string, comments: number) =>
  Math.max(
    0,
    comments - (Number(/^Collated up to item \d+ \((\d+) items?\)/m.exec(body)?.[1]) || 0),
  );
/** This month's Journal page's topic, for a day as `YYYY-MM-DD`. */
export const journalTopic = (day: string) => `Journal ${day.slice(0, 7)}`;

/** A closed project's files (its chats' and its docs') go at the weekly clean-up this long after. */
export const FILES_KEPT_DAYS = 30;
/** A day as `5 Dec`, in your zone. */
export const shortDay = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timeZoneNow(), day: "numeric", month: "short" })
    .format(new Date(ms))
    .replace(".", "");
/**
 * What a project's close says, every time (ADR 0069): what stays, what goes and when, and how to
 * undo it. `closedAt`: when it closed (ISO).
 */
export const closedProjectText = (closedAt: string) =>
  `Its docs stay in the Library, read-only. Its files go from ${shortDay(Date.parse(closedAt) + FILES_KEPT_DAYS * 86_400_000)}, unless you reopen it before.`;
/** A word that would add to a closed project, refused (ADR 0069): nothing is written. */
export const projectClosed = (name: string, n: number) =>
  `${name} is closed · #${n}: Reopen it first. Nothing was written.`;

/** The repos a project's brief names on its `Repos:` line (its first such line). */
export function reposOf(brief: string): string[] {
  const line = /^\s*repos\s*:\s*(.+)$/im.exec(brief)?.[1] ?? "";
  return [
    ...new Set(
      line
        .split(/[\s,]+/)
        .map((r) => r.trim().toLowerCase())
        .filter((r) => /^[a-z0-9][a-z0-9._-]{0,99}$/.test(r)),
    ),
  ];
}

/** What a word saves, with no run (ADR 0069). */
export type Capture =
  | { kind: "project"; name: string; repos: string[]; brief: string }
  | { kind: "add"; name: string; words: string }
  | { kind: "jot"; words: string };

/**
 * `project: <name> [repos: a, b]` (lines below are its brief), `add <name>: …` (an Inbox item) or
 * `jot: …` (a Journal line): what it saves, or undefined for any other words. A name that isn't
 * one says so as `wrong`.
 */
export function captureOf(text: string): Capture | { wrong: string } | undefined {
  const t = text.trim();
  const jot = /^jot\s*:\s*([\s\S]*)$/i.exec(t);
  if (jot) {
    const words = (jot[1] ?? "").trim();
    return words ? { kind: "jot", words } : { wrong: "Write the thought after `jot:`." };
  }
  const add = /^add\s+([A-Za-z0-9-]+)\s*:\s*([\s\S]*)$/i.exec(t);
  if (add) {
    const name = (add[1] ?? "").toLowerCase();
    const words = (add[2] ?? "").trim();
    if (!PROJECT_NAME.test(name)) return { wrong: `“${add[1]}” isn't a project's name.` };
    return { kind: "add", name, words };
  }
  const project = /^project\s*:\s*([^\n]*)(?:\n([\s\S]*))?$/i.exec(t);
  if (!project) return undefined;
  const head = (project[1] ?? "").trim();
  const [first = "", ...rest] = head.split(/\s+/);
  const name = first.toLowerCase();
  if (!PROJECT_NAME.test(name))
    return {
      wrong:
        "Name the project after `project:`: lowercase letters, digits and dashes (`project: games`).",
    };
  const tail = rest.join(" ");
  const repos = /^repos\s*:/i.test(tail) ? reposOf(tail) : [];
  const said = [repos.length ? "" : tail, (project[2] ?? "").trim()].filter(Boolean).join("\n");
  const brief = [repos.length ? `Repos: ${repos.join(", ")}` : "", said]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "project", name, repos, brief };
}
