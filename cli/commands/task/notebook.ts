// The notebook's reads and writes on a box (ADR 0027, lib/notebook.ts, docs/notebook.md). Only
// pages you or a run wrote are read, and last edited: a page anyone else touched (the agent's own
// token can edit issues) is left out until you save it again, so nothing can slip instructions
// into every later run. Notes are written by the box after a run (or for `remember: …`), never by
// the agent; a Library page's whole text too, from a run's `pages` (ADR 0069).
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  GUEST_LABEL,
  guestLabel,
  LIBRARY_LABEL,
  PROJECT_LABEL,
  PROJECT_NAME,
  projectClosed,
  projectLabel,
  projectNameOf,
  projectOfLabels,
  readFrom,
  RUN_WRITER,
  withoutLine,
} from "../../contracts/index.ts";
import { doorLogin } from "../../kernel/snapshot.ts";
import { platformRepo } from "../../lib/github.ts";
import type { RecordPage } from "../../lib/plugins/record.ts";
import {
  dated,
  hasHidden,
  guestLabels,
  libraryLabels,
  linesWith,
  looksSecret,
  MAX_PAGE,
  NEARLY_FULL,
  NOTEBOOK_LABEL,
  Note,
  noteWords,
  type Page,
  PAGE_PREFIX,
  pageTitle,
  repoPage,
  sameTopic,
  topicOf,
  topicTitle,
  withLog,
  withNote,
  withoutNote,
} from "../../lib/notebook.ts";
import { readPeople } from "../../lib/people.ts";
import { isBot } from "../../lib/task.ts";
import { owner, rec, timeZone } from "./context.ts";

/** Today, in your time zone: the day a note carries. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: timeZone() }).format(new Date());
/**
 * A page's link: the issue's page (ADR 0071). A page read has it as `url`; a new one, as GitHub's
 * API answers, as `html_url` (its `url` is the API's address).
 */
const pageUrl = (p: { number: number; url?: string; html_url?: string }) =>
  p.html_url ??
  (p.url?.startsWith("https://github.com/")
    ? p.url
    : `https://github.com/${platformRepo()}/issues/${p.number}`);

/**
 * A doc's short name, as the window shows it (ADR 0071): its project's name taken off the front,
 * and a capital first ("Research", not "health-project-research"). GitHub keeps the title.
 */
export function shortName(topic: string, project?: string): string {
  const t = topic.trim();
  const short =
    project && t.toLowerCase().startsWith(`${project.toLowerCase()}-`)
      ? t.slice(project.length + 1)
      : t;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

export interface Notebook {
  pages: Page[];
  /** Pages left out: someone other than you or a run opened or last edited them. */
  skipped: string[];
}

/**
 * Whether a login may write what every round reads: you, or a run's own token. The door App counts
 * as you (ADR 0069: the web chat's edits) only when the page's hidden line names you, the first
 * person: words it took from anyone else in SHIPIFY_PEOPLE stay untrusted.
 */
function trusted(login: string | undefined, body = "", guest?: string): boolean {
  if (!login) return false;
  if (login === RUN_WRITER) return true;
  // The door's line names whose it is (ADR 0071): yours names no guest; a guest's run trusts only
  // its guest's.
  if (login === doorLogin()) {
    const from = readFrom(body);
    return guest
      ? from?.guest === guest
      : !from?.guest && from?.person === readPeople().people[0]?.name;
  }
  const who = owner();
  return !guest && (who ? login === who : !isBot(login));
}

/**
 * The pages under a label that you or a run (or the door, for you) wrote and last edited. A
 * guest's pages (ADR 0071) are read only by that guest's runs (`guest`): yours never read them.
 */
function readPages(label: string, guest?: string): Notebook {
  const pages: Page[] = [];
  const skipped: string[] = [];
  for (const p of rec().pages(label)) {
    const topic = topicOf(p.title);
    if (!topic) continue;
    const theirs = p.labels.some((l) => l.name === GUEST_LABEL);
    if (guest ? !p.labels.some((l) => l.name === guestLabel(guest)) : theirs) continue;
    if (!trusted(p.author, p.body, guest) || (p.editor && !trusted(p.editor, p.body, guest))) {
      skipped.push(topic);
      continue;
    }
    // As its title says it: a repo's page keeps the repo's name (ADR 0047). The door's hidden line
    // is no part of its words.
    const labels = p.labels.map((l) => l.name);
    const project = projectOfLabels(labels);
    const from = readFrom(p.body) ? p.body.split("\n", 1)[0] : undefined;
    pages.push({
      number: p.number,
      topic,
      body: withoutLine(p.body),
      url: p.url,
      ...(labels.includes(LIBRARY_LABEL) ? { library: true } : {}),
      ...(project ? { project } : {}),
      ...(from ? { from } : {}),
      ...(p.editedAt ? { editedAt: p.editedAt } : {}),
    });
  }
  return { pages, skipped };
}

/** A page's new words, the door's hidden line kept first when it had one. */
const withFrom = (page: Page | undefined, body: string) =>
  page?.from ? `${page.from}\n${body}` : body;

/** The notebook's pages that every run reads (the `notebook` label), oldest first. */
export const readNotebook = (): Notebook => readPages(NOTEBOOK_LABEL.name);

/**
 * A project's pages (ADR 0069): the Library's pages labelled `project:<name>`; a guest's project's,
 * for that guest's run alone (ADR 0071).
 */
export const readProjectPages = (name: string, guest?: string): Notebook =>
  readPages(projectLabel(name), guest);

/**
 * The Library's pages a run reads on demand (ADR 0069): the always pages, then the `library` pages
 * of no project, or of this one (`*`: every project's); another project's pages stay out.
 */
export function readLibrary(project?: string): Notebook {
  const always = readNotebook();
  const library = readPages(LIBRARY_LABEL);
  return {
    pages: [
      ...always.pages,
      ...library.pages.filter((p) => !p.project || project === "*" || p.project === project),
    ],
    skipped: [...always.skipped, ...library.skipped],
  };
}

/**
 * The notes a run suggested (or `remember: …` gave), written now (the notebook read again just
 * before): each on its topic's page, made when it's new. A topic naming one of your repos (`repos`,
 * as a task names them) or `owner/name` is that repo's own page, titled with its name as it is
 * (ADR 0047). Never a secret, never past a page's size. Returns what the reply says, a line each.
 */
export function remember(notes: unknown[], canWrite: boolean, repos: string[] = []): string[] {
  if (!notes.length) return [];
  if (!canWrite) return ["(Nothing was noted: this run doesn't add to the notebook.)"];
  const record = rec();
  const nb = readNotebook();
  // Your projects (ADR 0069), open and closed, read once when a topic could name one: `remember
  // games: …` goes on the project's main page, which its runs read, and no other run does. A closed
  // one is read-only: its note is refused, never a page of its own that every run reads. A page you
  // have already (Preferences, People) is that page: no read for it.
  let projects: RecordPage[] | undefined;
  const projectNamed = (topic: string): string | { closed: number; name: string } | undefined => {
    const name = topic.trim().toLowerCase();
    if (!PROJECT_NAME.test(name) || nb.pages.some((p) => !p.project && sameTopic(p.topic, name)))
      return undefined;
    projects ??= record.pages(PROJECT_LABEL, "all");
    const named = projects.filter((p) => projectNameOf(p.title) === name);
    if (!named.some((p) => p.state === "open"))
      return named[0] ? { closed: named[0].number, name } : undefined;
    const theirs = readProjectPages(name);
    nb.pages.push(...theirs.pages.filter((p) => !nb.pages.some((q) => q.number === p.number)));
    nb.skipped.push(...theirs.skipped);
    return name;
  };
  const said: string[] = [];
  for (const raw of notes.slice(0, 5)) {
    const parsed = Note.safeParse(raw);
    if (!parsed.success) {
      said.push(`Not noted: ${parsed.error.issues[0]?.message ?? "it isn't a note"}.`);
      continue;
    }
    const { text } = parsed.data;
    const repo = repoPage(parsed.data.topic, repos)
      ? (repos.find((r) => sameTopic(r, parsed.data.topic)) ?? parsed.data.topic.toLowerCase())
      : undefined;
    const named = repo ? undefined : projectNamed(parsed.data.topic);
    if (typeof named === "object") {
      said.push(projectClosed(named.name, named.closed));
      continue;
    }
    const project = named;
    const topic = repo ?? project ?? parsed.data.topic;
    const title = repo ?? project ?? topicTitle(topic);
    const line = text.replace(/<!--/g, "&lt;!--");
    if (hasHidden(line)) {
      said.push(
        `Not noted under ${title}: it holds characters you can't see (zero-width or direction marks). Type it again without them.`,
      );
      continue;
    }
    if (looksSecret(line)) {
      said.push(
        `Not noted under ${title}: it looks like a key or a password, and the notebook never keeps one.`,
      );
      continue;
    }
    if (nb.skipped.some((t) => sameTopic(t, topic))) {
      said.push(
        `Not noted under ${title}: that page was last edited by someone other than you or a run, so it's left alone until you save it again.`,
      );
      continue;
    }
    const page = nb.pages.find(
      (p) => sameTopic(p.topic, topic) && (project ? p.project === project : !p.project),
    );
    const words = noteWords(line).toLowerCase();
    if (
      page?.body
        .split("\n")
        .some((l) => /^\s*[-*]\s+/.test(l) && noteWords(l).toLowerCase() === words)
    ) {
      said.push(`Already noted under ${title}: ${line}`);
      continue;
    }
    const body = withNote(page?.body ?? "", dated(line, today()));
    if (body.length > MAX_PAGE) {
      said.push(
        `Not noted under ${title}: the page is full (${MAX_PAGE.toLocaleString("en")} characters). Split it: move part of it to a new issue titled “${pageTitle(`${title} 2`)}”, labelled notebook.`,
      );
      continue;
    }
    let at: { number: number; url?: string; html_url?: string };
    if (page) {
      record.updateIssue(page.number, { body: withFrom(page, body) });
      page.body = body;
      at = page;
    } else {
      const labels = project ? libraryLabels(project) : [NOTEBOOK_LABEL];
      for (const l of labels) record.makeLabel(l);
      const made = record.createIssue({
        title: repo || project ? `${PAGE_PREFIX}${repo ?? project}` : pageTitle(topic),
        body,
        labels: labels.map((l) => l.name),
      });
      nb.pages.push({ number: made.number, topic: title, body, ...(project ? { project } : {}) });
      at = made;
    }
    said.push(
      repo
        ? `Noted for ${repo}: ${line}. Every task on ${repo} follows it from now on: ${pageUrl(at)}`
        : project
          ? `Noted on the project ${project}'s page: ${line}. Its chats read it from now on: ${pageUrl(at)}`
          : `Noted under ${title}: ${line}. Every task from now on follows it: ${pageUrl(at)}`,
    );
  }
  return said;
}

/**
 * `forget: …`: the one note on your pages that holds these words, removed. Several, and nothing is
 * removed: the reply lists them, so you say more of the line. Returns what the reply says.
 */
export function forget(words: string): string[] {
  const want = words.trim();
  if (!want) return ["What should I forget? Write it after `forget:`."];
  const nb = readNotebook();
  const hits = nb.pages.flatMap((p) => linesWith(p.body, want).map((line) => ({ p, line })));
  if (!hits.length) {
    const also = nb.skipped.length
      ? ` (${nb.skipped.join(", ")} ${nb.skipped.length === 1 ? "was" : "were"} left out: last edited by someone else)`
      : "";
    return [`Nothing in the notebook says “${want}”${also}.`];
  }
  if (hits.length > 1)
    return [
      `${hits.length} notes say “${want}”, so nothing was removed. Say \`forget:\` with more of the one you mean:`,
      ...hits.slice(0, 10).map((h) => `- ${h.p.topic}: ${noteWords(h.line)}`),
    ];
  const [{ p, line }] = hits as [(typeof hits)[number]];
  const body = withoutNote(p.body, line);
  // A page with no note left closes: nothing stays behind (a later note opens a new one).
  const empty = !body.split("\n").some((l) => l.trim() && !l.trim().startsWith("<!--"));
  const kept = withFrom(p, body);
  rec().updateIssue(p.number, empty ? { body: kept, state: "closed" } : { body: kept });
  p.body = body;
  return [
    `Forgot, from ${p.topic}: ${noteWords(line)}.${empty ? " The page is empty now, so it's closed." : ""} ${pageUrl(p)}`,
  ];
}

/**
 * A run's `pages` (ADR 0069): each page's whole new text, from a file in its out folder, written
 * with the notebook's checks (its size, no key, no hidden characters). A page of the run's own
 * project is written, or made with the project's labels; a Library page of no project (a Journal)
 * only when the run read nothing from outside. Never a page every run reads (only your words change
 * those) or another project's, nor one whose text changed after the run read the pages (`since`,
 * ADR 0070): the later write would drop the earlier one's lines. GitHub keeps each edit in the
 * page's history, so one is easy to undo. A project's writes get a line on its main page's Log
 * (`chat`: the task they came from). Returns what the reply says, a line each.
 */
export function writePages(
  pages: { page: string; file: string }[],
  o: {
    dir?: string;
    project?: string;
    outside: boolean;
    since?: string;
    chat?: number;
    /**
     * A guest's run (ADR 0071), by the guest's id: its own project's pages alone, never the
     * Library's; a new one gets their labels, so it shows in their window and not in yours.
     */
    guest?: string;
  },
): string[] {
  if (!o.dir) return ["(No page was written: the run's files weren't there.)"];
  const record = rec();
  // A guest's run reads its own project's pages alone, which yours never read (ADR 0071).
  const lib = o.guest
    ? o.project
      ? readProjectPages(o.project, o.guest)
      : { pages: [], skipped: [] }
    : readLibrary(o.project);
  const said: string[] = [];
  const read = o.since ? Date.parse(o.since) : Number.NaN;
  const ok: { topic: string; text: string; page?: Page; mine: boolean }[] = [];
  for (const { page: topic, file } of pages.slice(0, 5)) {
    const path = join(o.dir, basename(file));
    const not = (why: string) => said.push(`Not written, the page ${topic}: ${why}.`);
    if (!existsSync(path)) {
      not(`its file \`${basename(file)}\` isn't in the out folder`);
      continue;
    }
    const text = `${readFileSync(path, "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/<!--\s*shipify-/g, "&lt;!-- shipify-")
      .trim()}\n`;
    const page = lib.pages.find((p) => sameTopic(p.topic, topic));
    const changed = page?.editedAt ? Date.parse(page.editedAt) > read : false;
    if (text.length > MAX_PAGE)
      not(`it's over ${MAX_PAGE.toLocaleString("en")} characters: split it into two pages`);
    else if (hasHidden(text)) not("it holds characters you can't see");
    else if (looksSecret(text)) not("it looks like it holds a key or a password");
    else if (lib.skipped.some((t) => sameTopic(t, topic)))
      not("someone other than you or a run last edited it, so it's left alone");
    else if (page && !page.library)
      not("every run reads it, so only your words change it (`remember`, or GitHub's Edit)");
    else if (changed)
      not(
        'it changed after this run read it, so it\'s left as it is, and nothing of either is lost: ask again ("keep it again"), and the next run writes it from the new page',
      );
    else {
      const mine = Boolean(o.project) && (!page || page.project === o.project);
      if (!mine && o.guest) not("a guest's run writes only its own project's pages");
      else if (!mine && o.outside)
        not(
          "this run read outside content, so it writes only its project's pages: edit it on GitHub, or ask in a run that reads nothing from outside",
        );
      else if (!ok.some((w) => sameTopic(w.topic, topic))) ok.push({ topic, text, page, mine });
    }
  }
  // One new doc a run at most (ADR 0071): the first is made; a second's words stay in the reply.
  const made = ok.find((w) => !w.page);
  for (const w of ok)
    if (!w.page && w !== made)
      said.push(
        `Not written, the page ${w.topic}: a run makes one new doc at most, and this run made ${shortName(made?.topic ?? "", o.project)}. Its words are in this reply: ask for it in the next run.`,
      );
  const writes = ok.filter((w) => w.page || w === made);
  // The project's Log (ADR 0070): one dated line for this run's writes, on its main page, kept by
  // the box. With the main page in the writes, the line goes in that one write; else one edit more.
  const project = o.project;
  const theirs = writes.filter((w) => w.mine);
  const main = project
    ? lib.pages.find((p) => p.project === project && sameTopic(p.topic, project))
    : undefined;
  const line =
    project && theirs.length
      ? `${today()} · ${theirs.map((w) => w.topic.trim()).join(", ")}${o.chat ? ` · from #${o.chat}` : ""}`
      : undefined;
  for (const w of writes) {
    const isMain = Boolean(project) && w.mine && sameTopic(w.topic, project ?? "");
    const text = line && isMain ? withLog(w.text, w.page?.body ?? "", line) : w.text;
    let at: { number: number; url?: string; html_url?: string };
    if (w.page) {
      record.updateIssue(w.page.number, { body: withFrom(w.page, text) });
      at = w.page;
    } else {
      const labels = [
        ...libraryLabels(w.mine ? project : undefined),
        ...(o.guest ? guestLabels(o.guest) : []),
      ];
      for (const l of labels) record.makeLabel(l);
      at = record.createIssue({
        title: w.mine ? `${PAGE_PREFIX}${w.topic.trim()}` : pageTitle(w.topic),
        body: text,
        labels: labels.map((l) => l.name),
      });
    }
    said.push(
      w.page
        ? `Wrote the page ${w.topic} (GitHub keeps its old text in the page's history): ${pageUrl(at)}`
        : `New doc: ${shortName(w.topic, w.mine ? project : undefined)}: ${pageUrl(at)}`,
    );
  }
  // A main page someone else last edited isn't read (`skipped`), so it gets no line either.
  if (line && main?.library && !theirs.some((w) => sameTopic(w.topic, main.topic)))
    record.updateIssue(main.number, { body: withFrom(main, withLog(main.body, main.body, line)) });
  return said;
}

/** Pages nearly full, for the weekly clean-up to say. */
export const nearlyFull = (nb: Notebook) =>
  nb.pages.filter((p) => p.body.length >= NEARLY_FULL).map((p) => `${p.topic} (#${p.number})`);
