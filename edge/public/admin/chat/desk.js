// @ts-check
// Shipify chat: the Desk (ADR 0069), the first screen, in a new chat's place (its box at the foot):
// what needs you, what works, your projects with their open chats, the Library's pages you opened
// last (kept on this device, as the chats you saw are), Jot, New project, and Repeats. All from
// what the page reads already (the list): no call of its own, so every device shows the same. It
// loads with the page, so what opens from it loads when it opens: the Library (library.js), New
// project's form (project.js), Repeats (repeat.js).
import { h, icon, set } from "./compose.js";

/** What the page lends (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;

/** Takes what the page lends, and loads its stylesheet; ready once it has. */
export function init(a) {
  A = a;
  return new Promise((r) =>
    document.head.append(h("link", { rel: "stylesheet", href: "desk.css", onload: r, onerror: r })),
  );
}

/** The Desk on screen, and its part drawn again as the list changes (Jot and its form stay). */
let E;
let live;

/** The Desk, in this element (the first screen's, app.js `home`). */
export function desk(e) {
  E = e;
  live = h("div.dl");
  const day = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const go = (k, l, p) => h("a.btn", { href: `#/${p}` }, icon(k), l);
  const links = h("p.links", go("repeat", "Repeats", "repeats"), go("book", "Library", "notebook"));
  set(e, h("h3.day", day), jot(), live, newProject(), links);
  redraw();
}

/** The list changed: the Desk on screen drawn again. */
export function redraw() {
  if (!E?.isConnected) return;
  const tasks = (A.S.list?.tasks || []).filter((t) => t.state !== "closed");
  const runs = A.runs();
  const pj = tasks.filter((t) => t.project);
  const need = tasks.filter((t) => t.state === "needs-you");
  const work = tasks.filter((t) => runs.has(t.n));
  // The Library's pages you opened last, newest first: the threads kept here are the chats seen.
  const pages = A.S.seen
    .map((n) => A.S.threads[n]?.task)
    .filter((t) => /^Notebook: /.test(t?.title || ""))
    .reverse()
    .slice(0, 5);
  const chat = (t) => [
    h(`i.mark.${runs.has(t.n) ? "working" : t.state}`),
    A.what(A.to(t.n, A.bare(t.title)), A.meta(`#${t.n}`, A.ago(t.updated))),
  ];
  const project = (p) => {
    const open = tasks.filter((t) => t.parent === p.n);
    const c = p.project.chats;
    return [
      icon("app"),
      A.what(A.to(p.n, p.project.name), A.meta(`${c} chat${c === 1 ? "" : "s"}`, `#${p.n}`)),
      open.length > 0 &&
        h(
          "p.chats",
          open.map((t) => h("a.chip", { href: `#/t/${t.n}` }, A.bare(t.title))),
        ),
    ];
  };
  const page = (t) => [icon("book"), A.what(A.to(t.n, t.title.slice(10)), A.meta(`#${t.n}`))];
  const head = (l, n, c = "") => h("h3", l, n > 0 && h(`small${c}`, `${n}`));
  set(
    live,
    !A.S.list && h("div.ph"),
    need.length > 0 && [head("Needs you", need.length, ".n"), A.list(need, chat)],
    work.length > 0 && [head("Working", work.length, ".w"), A.list(work, chat)],
    head("Projects", pj.length),
    A.list(pj, project, "No projects yet: a project keeps its chats, pages and finds together."),
    pages.length > 0 && [head("Opened last"), A.list(pages, page)],
  );
}

/** Jot (ADR 0069): a line in this month's Journal, with no run; the door's answer under it. */
function jot() {
  const i = h("input", { "aria-label": "Jot", placeholder: "Jot a thought: no run starts" });
  const o = A.out();
  const b = h("button.btn", "Jot");
  const f = h("form.jot", icon("pin"), i, b, o);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const w = i.value.trim();
    if (w && (await A.quick(undefined, `jot: ${w}`, o, b))) i.value = "";
  };
  return f;
}

/** New project: its form is project.js's, loaded when the button is tapped. */
function newProject() {
  const go = () => A.lazy("project")((m) => b.replaceWith(m.newProject()));
  const b = A.btn([icon("plus"), "New project"], go, ".btn");
  return b;
}
