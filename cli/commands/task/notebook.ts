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
  PERSONALITY_TOPIC,
  type PersonalityWord,
  PROJECT_LABEL,
  PROJECT_NAME,
  presetOf,
  projectClosed,
  projectLabel,
  projectNameOf,
  projectOfLabels,
  readFrom,
  RUN_WRITER,
  undoneVoice,
  voiceOf,
  withoutLine,
  withVoice,
} from "../../contracts/index.ts";
import { doorLogin } from "../../kernel/snapshot.ts";
import { platformRepo } from "../../lib/github.ts";
import type { RecordPage } from "../../lib/plugins/record.ts";
import {
  dated,
  guestMemoryTopic,
  hasHidden,
  guestLabels,
  libraryLabels,
  linesWith,
  looksSecret,
  MAX_PAGE,
  memoryPage,
  memoryParts,
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
 * The pages under a label that you or a run (or the door, for you) wrote and last edited: the open
 * ones, or all (`state`). A guest's pages (ADR 0071) are read only by that guest's runs (`guest`):
 * yours never read them.
 */
function readPages(label: string, guest?: string, state: "open" | "all" = "open"): Notebook {
  const pages: Page[] = [];
  const skipped: string[] = [];
  for (const p of rec().pages(label, state)) {
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
      ...(p.state === "closed" ? { closed: true as const } : {}),
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
 * A project's pages (ADR 0069): the Library's pages labelled `project:<name>`, open or closed, as
 * they close and open with the project (task #744); a guest's project's, for that guest's run alone
 * (ADR 0071).
 */
export const readProjectPages = (name: string, guest?: string): Notebook =>
  readPages(projectLabel(name), guest, "all");

/**
 * The Library's pages a run reads on demand (ADR 0069): the always pages, then the open `library`
 * pages of no project (`*`: every project's too), and this project's own, open or closed, by its
 * label; another project's pages stay out.
 */
export function readLibrary(project?: string): Notebook {
  const always = readNotebook();
  const library = readPages(LIBRARY_LABEL);
  const own = project && project !== "*" ? readProjectPages(project) : undefined;
  return {
    pages: [
      ...always.pages,
      ...library.pages.filter((p) => !p.project || project === "*"),
      ...(own?.pages ?? []),
    ],
    skipped: [...always.skipped, ...library.skipped, ...(own?.skipped ?? [])],
  };
}

/**
 * A project's pages set to its state (task #744): each page under its label that isn't so already,
 * on its side of the wall (a guest's project's, only theirs; yours, none of a guest's). Closed as
 * completed. Setting a state twice is harmless. The pages it changed, and those GitHub refused.
 */
export function pagesTo(
  label: string,
  state: "open" | "closed",
  guest?: string,
): { done: number[]; left: number[] } {
  const record = rec();
  const side = (labels: string[]) =>
    guest ? labels.includes(guestLabel(guest)) : !labels.includes(GUEST_LABEL);
  const pages = record
    .issues({ labels: [label], state: state === "open" ? "closed" : "open" })
    .filter((i) => !i.pull_request && topicOf(i.title) && side(i.labels.map((l) => l.name)));
  const done: number[] = [];
  const left: number[] = [];
  for (const p of pages)
    try {
      record.updateIssue(
        p.number,
        state === "open" ? { state } : { state, state_reason: "completed" },
      );
      done.push(p.number);
    } catch {
      left.push(p.number);
    }
  return { done, left };
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

// ---------------------------------------------------------------- your Personality (ADR 0078)

/** Words shown in a reply: their first 120 characters, on one line. */
const shortly = (words: string) => {
  const one = words.replace(/\s+/g, " ").trim();
  return one.length > 120 ? `${one.slice(0, 119).trimEnd()}…` : one;
};

/** Why these words can't be a Personality or a note, or undefined when they can. */
const refusedWords = (words: string) =>
  hasHidden(words)
    ? "it holds characters you can't see (zero-width or direction marks): type it again without them"
    : looksSecret(words)
      ? "it looks like a key or a password, and the notebook never keeps one"
      : undefined;

/**
 * Your Personality page, `Notebook: Personality`: the open one, or else the newest closed one
 * (`personality: default` closed it, and `undo` opens it again). One that someone other than you
 * or a run wrote or last edited is left alone (`skipped`).
 */
function personalityPage(): { page?: Page; open: boolean; skipped?: true } {
  const ours = rec()
    .pages(NOTEBOOK_LABEL.name, "all")
    .filter((p) => sameTopic(topicOf(p.title) ?? "", PERSONALITY_TOPIC))
    .filter((p) => !p.labels.some((l) => l.name === GUEST_LABEL))
    .sort((a, b) => (a.state === b.state ? b.number - a.number : a.state === "open" ? -1 : 1));
  const p = ours[0];
  if (!p) return { open: false };
  if (!trusted(p.author, p.body) || (p.editor && !trusted(p.editor, p.body)))
    return { open: p.state === "open", skipped: true };
  const from = readFrom(p.body) ? p.body.split("\n", 1)[0] : undefined;
  return {
    page: {
      number: p.number,
      topic: PERSONALITY_TOPIC,
      body: withoutLine(p.body),
      url: p.url,
      ...(from ? { from } : {}),
    },
    open: p.state === "open",
  };
}

/**
 * `personality: …`, a run's `personality`, or Setup's menu (ADR 0078): your Personality page's new
 * words, whole (its last words kept under Before), the Default (the page closes), or its Before
 * words back (`undo`). A guest's (`guest`) is the Personality on their own memory page. Returns
 * what the reply says, a line each.
 */
export function setPersonality(set: PersonalityWord, guest?: string): string[] {
  if ("set" in set) {
    const why = refusedWords(set.set);
    if (why) return [`Personality not changed: ${why}.`];
  }
  if (guest) return guestPersonality(set, guest);
  const { page, open, skipped } = personalityPage();
  if (skipped)
    return [
      "Personality not changed: its page was last edited by someone other than you or a run, so it's left alone until you save it again on GitHub.",
    ];
  const record = rec();
  const write = (body: string, state?: "open" | "closed") => {
    if (!page) return;
    record.updateIssue(page.number, { body: withFrom(page, body), ...(state ? { state } : {}) });
  };
  if ("default" in set) {
    if (!page || !open) return ["Your Personality is the Default already."];
    write(withVoice(page.body, ""), "closed");
    return [
      "Personality: back to the Default, so its page is closed. `personality: undo` brings your words back.",
    ];
  }
  if ("undo" in set) {
    const back = page ? undoneVoice(page.body) : undefined;
    if (!page || !back) return ["Nothing to change back: your Personality keeps no earlier words."];
    write(back, open ? undefined : "open");
    return [`Personality changed back: “${shortly(voiceOf(back))}”. ${pageUrl(page)}`];
  }
  const words = set.set.replace(/<!--/g, "&lt;!--").trim();
  const preset = presetOf(words);
  const said = `${preset ? `Personality: ${preset.name}` : "Personality updated"}: “${shortly(words)}”. Every chat from now on talks this way.`;
  if (page) {
    write(withVoice(page.body, words), open ? undefined : "open");
    return [`${said} ${pageUrl(page)}`];
  }
  record.makeLabel(NOTEBOOK_LABEL);
  const made = record.createIssue({
    title: pageTitle(PERSONALITY_TOPIC),
    body: `${words}\n`,
    labels: [NOTEBOOK_LABEL.name],
  });
  return [`${said} ${pageUrl(made)}`];
}

// ---------------------------------------------------------------- a guest's memory (ADR 0078)

/**
 * A guest's memory page, theirs alone: none until they first use it. One someone else last edited
 * on GitHub is left out (`skipped`), as a page of yours would be.
 */
export function readGuestMemory(guest: string): { page?: Page; skipped?: true } {
  const read = readPages(LIBRARY_LABEL, guest);
  const topic = guestMemoryTopic(guest);
  const page = read.pages.find((p) => sameTopic(p.topic, topic));
  return page ? { page } : read.skipped.some((t) => sameTopic(t, topic)) ? { skipped: true } : {};
}

/** What a guest is told when their page is left out: nothing is written over it. */
const EDITED_ELSEWHERE =
  "Your memory page was last edited by someone else, so it's left as it is: ask the person who invited you to save it again.";

/** A guest's memory page written whole, or made with their labels, never yours. */
function writeGuestMemory(guest: string, page: Page | undefined, body: string): Page {
  const record = rec();
  if (page) {
    record.updateIssue(page.number, { body: withFrom(page, body) });
    page.body = body;
    return page;
  }
  const labels = [...libraryLabels(), ...guestLabels(guest)];
  for (const l of labels) record.makeLabel(l);
  const topic = guestMemoryTopic(guest);
  const made = record.createIssue({
    title: `${PAGE_PREFIX}${topic}`,
    body,
    labels: labels.map((l) => l.name),
  });
  return { number: made.number, topic, body, library: true };
}

/** A guest's Personality, on their memory page: as yours, with no page of its own to close. */
function guestPersonality(set: PersonalityWord, guest: string): string[] {
  const { page, skipped } = readGuestMemory(guest);
  if (skipped) return [EDITED_ELSEWHERE];
  const parts = memoryParts(page?.body ?? "");
  if ("default" in set) {
    if (!voiceOf(parts.voice)) return ["Your personality is the default already."];
    writeGuestMemory(guest, page, memoryPage({ ...parts, voice: withVoice(parts.voice, "") }));
    return ["Your personality is back to the default. `personality: undo` brings your words back."];
  }
  if ("undo" in set) {
    const back = undoneVoice(parts.voice);
    if (!back) return ["Nothing to change back: your personality keeps no earlier words."];
    writeGuestMemory(guest, page, memoryPage({ ...parts, voice: back }));
    return [`Your personality changed back: “${shortly(voiceOf(back))}”.`];
  }
  const words = set.set.replace(/<!--/g, "&lt;!--").trim();
  writeGuestMemory(guest, page, memoryPage({ ...parts, voice: withVoice(parts.voice, words) }));
  const preset = presetOf(words);
  return [
    `${preset ? `Your personality: ${preset.name}` : "Your personality is updated"}: “${shortly(words)}”. Your chats from now on talk this way.`,
  ];
}

/** A guest's `remember: …` or their run's notes: lines on their memory page, never on yours. */
export function rememberFor(guest: string, lines: string[]): string[] {
  const said: string[] = [];
  const read = readGuestMemory(guest);
  if (read.skipped) return [EDITED_ELSEWHERE];
  let page = read.page;
  for (const raw of lines.slice(0, 5)) {
    const line = raw
      .replace(/<!--/g, "&lt;!--")
      .replace(/\s*\n\s*/g, " ")
      .trim();
    const why =
      !line || line.length > 500
        ? "a note is one line, 500 characters at most"
        : refusedWords(line);
    if (why) {
      said.push(`Not noted: ${why}.`);
      continue;
    }
    const parts = memoryParts(page?.body ?? "");
    const words = noteWords(line).toLowerCase();
    if (
      parts.notes
        .split("\n")
        .some((l) => /^\s*[-*]\s+/.test(l) && noteWords(l).toLowerCase() === words)
    ) {
      said.push(`Already noted: ${line}`);
      continue;
    }
    const body = memoryPage({ ...parts, notes: withNote(parts.notes, dated(line, today())) });
    if (body.length > MAX_PAGE) {
      said.push("Not noted: your memory is full. Say `forget: …` to take some notes off first.");
      continue;
    }
    page = writeGuestMemory(guest, page, body);
    said.push(`Noted: ${line}. Your chats from now on know it.`);
  }
  return said;
}

/** A guest's `forget: …` or their run's `forget`: the one line on their memory page that holds it. */
export function forgetFor(guest: string, words: string): string[] {
  const want = words.trim();
  if (!want) return ["What should I forget? Write it after `forget:`."];
  const { page, skipped } = readGuestMemory(guest);
  if (skipped) return [EDITED_ELSEWHERE];
  const parts = memoryParts(page?.body ?? "");
  const hits = linesWith(parts.notes, want);
  if (!page || !hits.length) return [`Nothing in your memory says “${want}”.`];
  if (hits.length > 1)
    return [
      `${hits.length} notes say “${want}”, so nothing was removed. Say \`forget:\` with more of the one you mean:`,
      ...hits.slice(0, 10).map((l) => `- ${noteWords(l)}`),
    ];
  const line = hits[0] as string;
  writeGuestMemory(guest, page, memoryPage({ ...parts, notes: withoutNote(parts.notes, line) }));
  return [`Forgot: ${noteWords(line)}.`];
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
      // A page a run writes is open (task #744): one an open project left closed opens with it.
      record.updateIssue(w.page.number, {
        body: withFrom(w.page, text),
        ...(w.page.closed ? { state: "open" as const } : {}),
      });
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
    record.updateIssue(main.number, {
      body: withFrom(main, withLog(main.body, main.body, line)),
      ...(main.closed ? { state: "open" as const } : {}),
    });
  return said;
}

/** Pages nearly full, for the weekly clean-up to say. */
export const nearlyFull = (nb: Notebook) =>
  nb.pages.filter((p) => p.body.length >= NEARLY_FULL).map((p) => `${p.topic} (#${p.number})`);
