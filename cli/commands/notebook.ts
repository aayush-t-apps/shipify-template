// `ship notebook` (ADR 0027, docs/notebook.md): its pages, and one page in full. The notebook is
// issues labelled `notebook` on shipify, so these run where issues can be read: on a box (a run's
// agent reads the rest of a page with `ship notebook read`), not with the PC's token.
import { firstLine, sameTopic } from "../lib/notebook.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { tryOr } from "./task/context.ts";
import { type Notebook, readNotebook } from "./task/notebook.ts";

function read(): Notebook {
  const nb = tryOr<Notebook | undefined>(readNotebook, undefined);
  if (!nb)
    throw new ShipError(
      "The notebook couldn't be read here: it's issues labelled notebook on shipify, which this machine's GitHub key can't read. Open them on GitHub, or ask in a task.",
      "blocked",
    );
  return nb;
}

/** `ship notebook [list]`: each page, by its topic and first line. */
export function notebookList(): Result {
  const nb = read();
  return ok("notebook", nb.pages.length ? `${nb.pages.length} page(s)` : "the notebook is empty", {
    data: [
      ...nb.pages.map((p) => `  - ${p.topic} (#${p.number}): ${firstLine(p.body) || "(empty)"}`),
      ...nb.skipped.map(
        (t) => `  - ${t}: left out (someone other than you or a run last edited it)`,
      ),
    ].join("\n"),
  });
}

/** `ship notebook read <topic>`: one page in full. */
export function notebookRead(topic: string | undefined): Result {
  if (!topic) throw new ShipError('Use: notebook read "<topic>"', "blocked");
  const nb = read();
  const page = nb.pages.find((p) => sameTopic(p.topic, topic));
  if (!page)
    throw new ShipError(
      `No page "${topic}". Pages: ${nb.pages.map((p) => p.topic).join(", ") || "none"}.`,
      "blocked",
    );
  return ok("notebook read", `${page.topic} (#${page.number})`, { data: page.body.trim() });
}
