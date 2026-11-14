// `ship notebook` (ADR 0027, docs/notebook.md): its pages, and one page in full. The notebook is
// issues labelled `notebook` on shipify, and the Library's are labelled `library` (ADR 0069: read
// only on demand, or by their project's runs), so these run where issues can be read: on a box (a
// run's agent reads the rest of a page, or a Library page, with `ship notebook read`), not with the
// PC's token.
import { firstLine, type Page, sameTopic } from "../lib/notebook.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { rec, tryOr } from "./task/context.ts";
import { type Notebook, readLibrary, readProjectPages } from "./task/notebook.ts";

/** Every page you or a run wrote: the always pages, then the Library's, any project's too. */
function read(): Notebook {
  const nb = tryOr<Notebook | undefined>(() => readLibrary("*"), undefined);
  if (!nb)
    throw new ShipError(
      "The notebook couldn't be read here: it's issues labelled notebook on shipify, which this machine's GitHub key can't read. Open them on GitHub, or ask in a task.",
      "blocked",
    );
  return nb;
}

/**
 * `ship notebook [list]`: each page by its topic and first line, the Library's marked; a project's
 * pages are counted by project (its runs get them, and `read` takes any by its topic).
 */
export function notebookList(): Result {
  const nb = read();
  const own = nb.pages.filter((p) => !p.project);
  const projects = new Map<string, number>();
  for (const p of nb.pages)
    if (p.project) projects.set(p.project, (projects.get(p.project) ?? 0) + 1);
  return ok("notebook", nb.pages.length ? `${nb.pages.length} page(s)` : "the notebook is empty", {
    data: [
      ...own.map((p) => `  - ${p.topic} (#${p.number}): ${firstLine(p.body) || "(empty)"}`),
      ...[...projects].map(([name, n]) => `  - the project ${name}: ${n} page(s)`),
      ...nb.skipped.map(
        (t) => `  - ${t}: left out (someone other than you or a run last edited it)`,
      ),
    ].join("\n"),
  });
}

/**
 * A closed project's page (task #744: its pages close with it), read by its project's label: the
 * project whose name the topic is, or starts (`games-pricing`), the longest name first.
 */
function closedProjectPage(topic: string): Page | undefined {
  const t = topic.trim().toLowerCase();
  const names = tryOr(() => rec().labels(), [] as string[])
    .filter((l) => l.startsWith("project:"))
    .map((l) => l.slice("project:".length))
    .filter((n) => n && (t === n || t.startsWith(`${n}-`)))
    .sort((a, b) => b.length - a.length);
  for (const n of names) {
    const page = tryOr(() => readProjectPages(n).pages, []).find((p) => sameTopic(p.topic, topic));
    if (page) return page;
  }
  return undefined;
}

/**
 * `ship notebook read <topic>`: one page in full, from the notebook or the Library; a closed
 * project's too.
 */
export function notebookRead(topic: string | undefined): Result {
  if (!topic) throw new ShipError('Use: notebook read "<topic>"', "blocked");
  const nb = read();
  const page = nb.pages.find((p) => sameTopic(p.topic, topic)) ?? closedProjectPage(topic);
  if (!page)
    throw new ShipError(
      `No page "${topic}". Pages: ${nb.pages.map((p) => p.topic).join(", ") || "none"}.`,
      "blocked",
    );
  return ok("notebook read", `${page.topic} (#${page.number})`, { data: page.body.trim() });
}
