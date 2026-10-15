// The notebook's reads and writes on a box (ADR 0027, lib/notebook.ts, docs/notebook.md). Only
// pages you or a run wrote are read, and last edited: a page anyone else touched (the agent's own
// token can edit issues) is left out until you save it again, so nothing can slip instructions
// into every later run. Notes are written by the box after a run (or for `remember: …`), never by
// the agent.
import { platformRepo, RECORD_WRITER } from "../../lib/github.ts";
import {
  dated,
  hasHidden,
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
  withNote,
  withoutNote,
} from "../../lib/notebook.ts";
import { isBot } from "../../lib/task.ts";
import { owner, rec, timeZone } from "./context.ts";

/** Today, in your time zone: the day a note carries. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: timeZone() }).format(new Date());
const pageUrl = (p: { number: number; url?: string }) =>
  p.url ?? `https://github.com/${platformRepo()}/issues/${p.number}`;

export interface Notebook {
  pages: Page[];
  /** Pages left out: someone other than you or a run opened or last edited them. */
  skipped: string[];
}

/** Whether a login may write what every round reads: you, or a run's own token. */
function trusted(login: string | undefined): boolean {
  if (!login) return false;
  if (login === RECORD_WRITER) return true;
  const who = owner();
  return who ? login === who : !isBot(login);
}

/** The notebook's pages that you or a run wrote and last edited, oldest first. */
export function readNotebook(): Notebook {
  const pages: Page[] = [];
  const skipped: string[] = [];
  for (const p of rec().pages(NOTEBOOK_LABEL.name)) {
    const topic = topicOf(p.title);
    if (!topic) continue;
    if (!trusted(p.author) || (p.editor && !trusted(p.editor))) {
      skipped.push(topic);
      continue;
    }
    // As its title says it: a repo's page keeps the repo's name (ADR 0047).
    pages.push({ number: p.number, topic, body: p.body, url: p.url });
  }
  return { pages, skipped };
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
    const topic = repo ?? parsed.data.topic;
    const title = repo ?? topicTitle(topic);
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
    const page = nb.pages.find((p) => sameTopic(p.topic, topic));
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
    let at: { number: number; url?: string };
    if (page) {
      record.updateIssue(page.number, { body });
      page.body = body;
      at = page;
    } else {
      record.makeLabel(NOTEBOOK_LABEL);
      const made = record.createIssue({
        title: repo ? `${PAGE_PREFIX}${repo}` : pageTitle(topic),
        body,
        labels: [NOTEBOOK_LABEL.name],
      });
      nb.pages.push({ number: made.number, topic: title, body });
      at = made;
    }
    said.push(
      repo
        ? `Noted for ${repo}: ${line}. Every task on ${repo} follows it from now on: ${pageUrl(at)}`
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
  rec().updateIssue(p.number, empty ? { body, state: "closed" } : { body });
  p.body = body;
  return [
    `Forgot, from ${p.topic}: ${noteWords(line)}.${empty ? " The page is empty now, so it's closed." : ""} ${pageUrl(p)}`,
  ];
}

/** Pages nearly full, for the weekly clean-up to say. */
export const nearlyFull = (nb: Notebook) =>
  nb.pages.filter((p) => p.body.length >= NEARLY_FULL).map((p) => `${p.topic} (#${p.number})`);
