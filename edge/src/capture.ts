// Saving with no run (ADR 0069): `project: <name>`, `add <name>: …` and `jot: …`, written by the
// door at once, as `remember` is by the box, and answered here. A project is an issue `Project:
// <name>` labelled `project`, made with its main page `Notebook: <name>`; an Inbox item is a comment on the project's Inbox page; a jot is a
// dated line on this month's Journal page. Pages are labelled `library` (and `project:<name>`), so
// the box starts no agent for them (task.yml skips them too, once you add its line), and each
// carries the door's hidden line naming you first, so the box trusts it as yours (only you).
import {
  type Capture,
  type From,
  fromLine,
  GUEST_LABEL,
  guestLabel,
  IN_PROJECT_LABEL,
  inboxTopic,
  journalTopic,
  LIBRARY_LABEL,
  MOST_CHATS,
  PROJECT_LABEL,
  projectClosed,
  projectLabel,
  projectNameOf,
  projectTitle,
  readFrom,
  SUB_TASK_LABEL,
  shownProject,
  timeZoneNow,
  withoutLine,
} from "../../cli/contracts/index.ts";
import { type GitHub, guestsOwn } from "./github.ts";

/** What the chat is told, and the issue it wrote on. */
interface Captured {
  text: string;
  task?: number;
}

type Issue = {
  number: number;
  title: string;
  body?: string | null;
  state?: string;
  pull_request?: unknown;
};

/** The issues under a label, newest first, open ones unless `all`: one call, 100 at most. */
const under = (gh: GitHub, label: string, state: "open" | "all" = "open") =>
  gh
    .json<Issue[]>(
      "GET",
      `repos/${gh.repo}/issues?labels=${encodeURIComponent(label)}&state=${state}&sort=created&direction=desc&per_page=100`,
    )
    .then((l) => l.filter((i) => !i.pull_request));

/**
 * The project of this name, open or closed (ADR 0069): an open one first, as a name made again
 * before closed names were refused may have both. One call.
 */
async function projectNamed(gh: GitHub, name: string) {
  const all = (await under(gh, PROJECT_LABEL, "all")).filter((i) => i.title === projectTitle(name));
  return all.find((i) => i.state !== "closed") ?? all[0];
}

/** Now, in your zone: the day (`2026-11-02`) and the minute (`13:40`). */
function nowIn(now: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZoneNow(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

const issueUrl = (gh: GitHub, n: number) => `https://github.com/${gh.repo}/issues/${n}`;

type Labelled = Issue & {
  id: number;
  state?: string;
  labels?: { name: string }[];
  /** GitHub's count of its sub-issues, on every issue it gives. */
  sub_issues_summary?: { total?: number };
};

/**
 * Whether an issue is on the right side of the wall (ADR 0071): a guest's own, for a guest; for you,
 * none of a guest's, so your chats and theirs never share a project.
 */
const onSide = (gh: GitHub, i: Labelled, guest: string | undefined) =>
  guest ? guestsOwn(gh, i, guest) : !(i.labels ?? []).some((l) => l.name === GUEST_LABEL);

/** An open project by its number, or why it isn't one; for a guest, only one of theirs. */
async function openProject(
  gh: GitHub,
  n: number,
  guest?: string,
): Promise<Labelled | { why: string }> {
  const r = await gh.call("GET", `repos/${gh.repo}/issues/${n}`);
  const p = r.data as Labelled | null;
  if (r.status !== 200 || !p || !onSide(gh, p, guest))
    return { why: guest ? "Not your project." : `There's no project #${n}.` };
  if (!(p.labels ?? []).some((l) => l.name === PROJECT_LABEL) || p.pull_request)
    return { why: `#${n} isn't a project.` };
  if (p.state === "closed") return { why: `The project #${n} is closed: reopen it first.` };
  return p;
}

/**
 * Links a chat under its project: GitHub's sub-issue, which holds 100 a parent and one parent a
 * chat. Nothing when it's linked, else why not: the project's full only by GitHub's own count.
 */
async function link(gh: GitHub, p: Labelled, chat: { id: number; number: number }) {
  const r = await gh.call("POST", `repos/${gh.repo}/issues/${p.number}/sub_issues`, {
    sub_issue_id: chat.id,
  });
  if (r.status >= 200 && r.status < 300) return undefined;
  if ((p.sub_issues_summary?.total ?? 0) >= MOST_CHATS)
    return `The project #${p.number} holds ${MOST_CHATS} chats, as many as GitHub allows: make a second project for more.`;
  if (r.status === 422)
    return `#${chat.number} is under another issue on GitHub already: an issue has one parent.`;
  return `GitHub didn't link #${chat.number} under #${p.number} just now (${r.status}): try again.`;
}

/** A chat's link to its project (or a part's to its task) in plain words, first after your line. */
const PART_OF = /^\s*Part of #(\d+)\b/;

/**
 * **New chat here** (ADR 0069): a new task in a project, its body's first line after yours `Part of
 * #<project>`, in plain words, then linked as the project's sub-issue. The number, or why not.
 */
export async function newChatIn(
  gh: GitHub,
  project: number,
  title: string,
  body: string,
  guest?: string,
): Promise<{ number: number } | { why: string }> {
  const p = await openProject(gh, project, guest);
  if ("why" in p) return p;
  const [head, ...rest] = body.split("\n");
  const made = await gh.json<{ number: number; id: number }>("POST", `repos/${gh.repo}/issues`, {
    title,
    body: [head, `Part of #${project}`, "", ...rest].join("\n"),
    ...(guest ? { labels: guestMarks(guest) } : {}),
  });
  // Unlinked, the chat still says its project in plain words; the reply says why.
  const why = await link(gh, p, made);
  if (why) return { why: `Made #${made.number}, but not under #${project}: ${why}` };
  return { number: made.number };
}

/**
 * **Move to project** (ADR 0069): a chat you have, linked under a project, with the `in-project`
 * label, and no edit of its words (an edit would start a run, and end a stay). Once: a chat in a
 * project already (its label, or its `Part of #n`) stays there, and a part of a split task (ADR
 * 0066) goes with its task. What to say.
 */
export async function moveToProject(
  gh: GitHub,
  task: number,
  project: number,
  guest?: string,
): Promise<string> {
  const p = await openProject(gh, project, guest);
  if ("why" in p) return p.why;
  const r = await gh.call("GET", `repos/${gh.repo}/issues/${task}`);
  const t = r.data as Labelled | null;
  if (r.status !== 200 || !t || t.pull_request || !onSide(gh, t, guest))
    return guest ? "Not your chat." : `There's no task #${task}.`;
  const labels = (t.labels ?? []).map((l) => l.name);
  if (labels.some((l) => [PROJECT_LABEL, LIBRARY_LABEL].includes(l)))
    return `#${task} is a project or a page: it can't go in a project.`;
  const above = PART_OF.exec(withoutLine(t.body ?? ""))?.[1];
  if (labels.includes(SUB_TASK_LABEL))
    return `#${task} is a part of ${above ? `#${above}` : "a split task"}: move ${above ? `#${above}` : "that task"} instead.`;
  if (labels.includes(IN_PROJECT_LABEL) || above) return `#${task} is in a project already.`;
  const why = await link(gh, p, t);
  if (why) return why;
  await gh.json("POST", `repos/${gh.repo}/issues/${task}/labels`, { labels: [IN_PROJECT_LABEL] });
  const name = shownProject(projectNameOf(p.title) ?? `#${project}`);
  return `Moved #${task} into ${name} · #${project}. Its next run reads the project's pages.`;
}

/** The Inbox page an `add <name>: …` answer names: the page its files are kept with. */
export const inboxOf = (text: string) =>
  Number(/^Added to the [a-z0-9-]+ Inbox · #(\d+)/.exec(text)?.[1]) || undefined;

/** A guest's marks on what the door makes for them (ADR 0071): for their lists. */
const guestMarks = (guest: string) => [GUEST_LABEL, guestLabel(guest)];

/**
 * A page by its topic among these, open or closed (an open one first), or a new one with its first
 * words (a guest's with their marks: their from-line names them already). A closed one opens as it
 * is written (task #744: a project reopened on GitHub's own button, a Journal closed by hand), so a
 * topic never gets a second page.
 */
async function pageOf(gh: GitHub, from: From, topic: string, labels: string[], first: string) {
  const title = `Notebook: ${topic}`;
  const all = (await under(gh, labels.at(-1) as string, "all")).filter((i) => i.title === title);
  const had = all.find((i) => i.state !== "closed") ?? all[0];
  if (had?.state === "closed")
    await gh.json("PATCH", `repos/${gh.repo}/issues/${had.number}`, { state: "open" });
  if (had) return { ...had, made: false };
  const made = await gh.json<Issue>("POST", `repos/${gh.repo}/issues`, {
    title,
    body: `${fromLine({ ...from, files: undefined })}\n${first}`,
    labels: [...labels, ...(from.guest ? guestMarks(from.guest) : [])],
  });
  return { ...made, made: true };
}

/**
 * Saves what the words say, as the door App, with your hidden line on each write: a project, an
 * Inbox item (with its file), or a Journal line. Nothing runs. Undefined for `add <name>: …` when no
 * open project has that name: those are words, and open a task as any do ("Add tests: …").
 */
export async function capture(
  gh: GitHub,
  c: Capture,
  from: From,
  file: string | undefined,
  now: number,
): Promise<Captured | undefined> {
  // A guest's project is named with their prefix on GitHub (the door named it so); the chat shows
  // the name they gave.
  const shown = "name" in c ? shownProject(c.name) : "";
  if (c.kind === "project") {
    const there = await projectNamed(gh, c.name);
    // A closed project keeps its name: one made again would split its docs across two (ADR 0069).
    if (there?.state === "closed")
      return {
        text: `The project ${shown} was closed · #${there.number}: Reopen it, or pick another name. Nothing was made.`,
        task: there.number,
      };
    if (there)
      return {
        text: `The project ${shown} is there already · #${there.number}: write in it, or \`add ${shown}: …\`.`,
        task: there.number,
      };
    const made = await gh.json<Issue>("POST", `repos/${gh.repo}/issues`, {
      title: projectTitle(c.name),
      body: `${fromLine({ ...from, files: undefined })}\n${c.brief || `The project ${shown}.`}`,
      labels: [PROJECT_LABEL, ...(from.guest ? guestMarks(from.guest) : [])],
    });
    // Its main page at once, so every project has one: the brief, then an empty Now and Map (ADR
    // 0070), kept by runs; the box adds the Log at its foot. A closed project of this name left its
    // page open: that one is kept, not made twice.
    const page = await pageOf(
      gh,
      from,
      c.name,
      [LIBRARY_LABEL, projectLabel(c.name)],
      `# ${shown}\n\n${c.brief || `The project ${shown}.`}\n\n## Now\n\n## Map\n`,
    );
    return {
      text: `Project ${shown} made · #${made.number}, its main page · #${page.number}. No run started. Ask in it, \`add ${shown}: …\` saves a find${from.guest ? "." : `, \`remember ${shown}: …\` a fact.`}`,
      task: made.number,
    };
  }
  if (c.kind === "add") {
    const project = await projectNamed(gh, c.name);
    if (!project) return undefined;
    // Closed, it's read-only: the find isn't kept, and no chat opens for it.
    if (project.state === "closed")
      return { text: projectClosed(shown, project.number), task: project.number };
    if (!c.words && !file) return { text: `Write what you found after \`add ${shown}:\`.` };
    const inbox = await pageOf(
      gh,
      from,
      inboxTopic(c.name),
      [LIBRARY_LABEL, projectLabel(c.name)],
      `# ${shown}: Inbox\n\nWhat you found for ${shown}, waiting to be collated: one comment each. Say "collate the inbox" in #${project.number}.`,
    );
    const words = [c.words, file ? `📎 ${file}` : ""].filter(Boolean).join("\n\n");
    await gh.json("POST", `repos/${gh.repo}/issues/${inbox.number}/comments`, {
      body: `${fromLine(from)}\n${words}`,
    });
    return {
      text: `Added to the ${shown} Inbox · #${inbox.number}. No run started: "collate the inbox" in #${project.number} folds it in.`,
      task: inbox.number,
    };
  }
  const { day, time } = nowIn(now);
  const topic = journalTopic(day);
  const page = await pageOf(gh, from, topic, [LIBRARY_LABEL], `# ${topic}\n`);
  const line = `- ${c.words.replace(/\s*\n\s*/g, " ").trim()} (${day} ${time})`;
  // The page's own words, the hidden line kept first: it names you, so the box trusts the page.
  const body = page.body ?? "";
  const head = readFrom(body) ? body.split("\n", 1)[0] : fromLine({ ...from, files: undefined });
  const words = withoutLine(body).trimEnd();
  await gh.json("PATCH", `repos/${gh.repo}/issues/${page.number}`, {
    body: `${head}\n${words}${words ? "\n" : ""}${line}\n`,
  });
  return { text: `Jotted in ${topic} · ${issueUrl(gh, page.number)}. No run started.` };
}
