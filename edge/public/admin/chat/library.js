// @ts-check
// Shipify chat: the Library (ADR 0069), loaded the first time it opens (from the Desk or its tab),
// so the first screen doesn't carry it. What is no project's (ADR 0071): the notebook's pages every
// run reads, the Journal and loose pages, each opening in the pane, with Edit; then each project
// as one line, which opens its screen's Docs: a project's docs have one place. A closed project's
// docs stay, under Closed projects, read-only.
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
/** A doc's name, opening it in the pane (workspace.js), with Edit. */
const open = (n, l) =>
  n ? A.btn(l, () => A.lazy("workspace")((w) => w.page(n)), ".name") : h("span", l);
const note = (p) => [
  A.what(open(p.n, p.topic), A.meta(`${p.lines} lines`, p.first)),
  A.btn("Remove", () => forget(p), ".danger"),
];
const page = (g) => [A.what(open(g.n, g.name), A.meta(`${g.lines} lines`, g.first))];
/** A project, one line: its screen, on its Docs, by its number in the index (open or closed). */
const docsOf = (n) => {
  A.R.tab = "Docs";
  A.go(`#/t/${n}`);
};
const project = ([p, l, x]) => [
  A.what(
    x ? A.btn(p, () => docsOf(x.n), ".name") : h("span", p),
    A.meta(
      `${l.length} ${l.length === 1 ? "doc" : "docs"}`,
      x?.closed && `closed ${A.ago(x.closed)} ago`.replace("now ago", "now"),
    ),
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
 * The Library: the pages every run reads (the notebook's), then the Journal and loose pages (read
 * when a run asks), then the projects, a line each (its runs read its docs), the closed ones apart.
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
      // Each by name, with the newest project of that name in the index (an open one first).
      const ix = (p) =>
        (d.projects || []).find((x) => x.name === p && x.open) ||
        d.projects?.find((x) => x.name === p);
      const all = [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, l]) => [p, l, ix(p)]);
      const shut = all.filter(([, , x]) => x && !x.open);
      const open = all.filter((e) => !shut.includes(e));
      return [
        h("h3", "Always", h("small", " · every run reads these")),
        A.list(d.pages, note, "Nothing yet: add a note."),
        none.length > 0 && [
          h("h3", "Journal and more", h("small", " · read when a run asks")),
          A.list(none, page),
        ],
        open.length > 0 && [
          h("h3", "Projects", h("small", " · each one's docs are on its screen")),
          A.list(open, project),
        ],
        shut.length > 0 && [
          h("h3", "Closed projects", h("small", " · docs kept, read-only: Reopen to add")),
          A.list(shut, project),
        ],
      ];
    },
    addNote,
  );
}
