// @ts-check
// Shipify chat: the Library (ADR 0069), loaded the first time it opens (from the Desk or its tab),
// so the first screen doesn't carry it. The notebook's pages every run reads, then the Library's by
// project, the Journal first among those with none.
import { h } from "./compose.js";

/** What the page lends (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;
export const init = (a) => {
  A = a;
};

const forget = (p) => {
  const w = prompt("Words to forget", p.first)?.trim();
  if (w) A.quick(undefined, `forget: ${w}`).then((s) => s && A.reread());
};
const note = (p) => [
  A.what(A.ext(p.url, p.topic), A.meta(`${p.lines} lines`, p.first)),
  A.btn("Remove", () => forget(p), ".danger"),
];
// A Library page opens here, as a thread you read; its edits are on GitHub. In a project's group,
// its main page and its Inbox say what they are.
const page = (g) => {
  const p = g.project;
  const box = p && g.topic === `${p}-inbox`;
  return [
    A.what(
      A.to(g.n, g.topic === p ? "Main page" : box ? "Inbox" : g.topic),
      box ? A.meta("Its items wait for “collate the inbox”") : A.meta(`${g.lines} lines`, g.first),
    ),
    A.ext(g.url, "On GitHub", ".chip"),
  ];
};
// A project's main page comes first; with none yet, a line says how one comes.
const group = (p, l) => [
  !l.some((g) => g.topic === p) &&
    h("p.quiet", "No main page yet: a run writes it when you ask for a summary, or to collate."),
  A.list(
    l.sort((a, b) => +(b.topic === p) - +(a.topic === p)),
    page,
  ),
];
const addNote = () => {
  const topic = h("input");
  const text = h("textarea", { rows: 2 });
  const o = A.out();
  const f = h("form.card.form", h("label", "Topic (optional)", topic), h("label", "Note", text));
  f.append(h("button.primary", "Add"), o);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const w = text.value.trim();
    const tp = topic.value.trim();
    if (!w) o.textContent = "Write the note.";
    else if (await A.quick(undefined, `remember${tp && ` ${tp}`}: ${w}`, o)) {
      text.value = "";
      A.reread();
    }
  };
  return f;
};

/**
 * The Library: the pages every run reads (the notebook's), then the Library's, by project (each
 * read by that project's runs), the Journal first among those with none (read when a run asks).
 */
export function library() {
  A.page(
    "Library",
    "notebook",
    (d) => {
      const by = new Map();
      for (const g of d.library || [])
        by.set(g.project || "", [...(by.get(g.project || "") || []), g]);
      const J = (g) => +/^Journal /.test(g.topic);
      const none = (by.get("") || []).sort((a, b) => J(b) - J(a));
      by.delete("");
      const at = (p) => A.S.list?.tasks.find((t) => t.project?.name === p);
      const head = (p, t = at(p)) => (t ? A.to(t.n, p) : p);
      return [
        h("h3", "Always", h("small", " · every run reads these")),
        A.list(d.pages, note, "Nothing yet: add a note."),
        none.length > 0 && [
          h("h3", "Journal and more", h("small", " · read when a run asks")),
          A.list(none, page),
        ],
        [...by]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([p, l]) => [h("h3", head(p), h("small", " · its runs read these")), group(p, l)]),
      ];
    },
    addNote,
  );
}
