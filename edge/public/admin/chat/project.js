// @ts-check
// Shipify chat: a project's page (ADR 0069), loaded the first time one opens, Move to project on
// a chat's menu, and New project's form (from the Desk). A project is an issue labelled `project`, and its page is its thread with a
// card under the header: its chats (open ones first) and New chat here, its pages (the Inbox among
// them), Export and Collate. The box at its foot replies to none: Send opens a new chat in the
// project, Add puts what you found in its Inbox, with no run.
import { h, icon, pop } from "./compose.js";

/** What the page lends (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;

/** Takes what the page lends, and loads its stylesheet; ready once it has. */
export function init(a) {
  A = a;
  return new Promise((r) =>
    document.head.append(
      h("link", { rel: "stylesheet", href: "project.css", onload: r, onerror: r }),
    ),
  );
}

const WORD = {
  "needs-you": "Needs you",
  stuck: "Stopped",
  waiting: "Waiting",
  open: "Open",
  closed: "Closed",
};

/** The card under a project's header, drawn again only when what it shows changed; and its box. */
export function card(v, t) {
  const T = t.task;
  const P = T.project;
  const u = { n: T.n, name: P.name };
  box(v);
  const k = JSON.stringify(P);
  if (v.pj?.k === k) return;
  const chats = [...P.chats].sort((a, b) => +(a.state === "closed") - +(b.state === "closed"));
  const open = chats.filter((c) => c.state !== "closed").length;
  const chat = (c) => [
    h(`i.mark.${c.state}`),
    A.what(A.to(c.n, A.bare(c.title)), A.meta(WORD[c.state] || c.state, `#${c.n}`)),
  ];
  const inbox = P.pages.find((g) => g.topic === `${P.name}-inbox`);
  // A page opens here, as a thread you read; its edits are on GitHub.
  const page = (g) => [
    A.what(A.to(g.n, g === inbox ? "Inbox" : g.topic), A.meta(g.first)),
    A.ext(g.url, "On GitHub", ".chip"),
  ];
  const b = (l, f) => A.btn(l, f, ".btn");
  const d = h(
    "details.prog.pj",
    // Shut till you open it, as a task's Progress; then as you left it.
    { open: v.pj?.open },
    h("summary", `${open} open of ${chats.length} chats · ${P.pages.length} pages`),
    // Its Now, then its next step (ADR 0070).
    P.now &&
      h(
        "ul",
        P.now.map((l) => h("li", l)),
      ),
    h("p.quiet", P.step),
    h(
      "p.links",
      b([icon("plus"), "New chat here"], () => A.start("", "#/new", u)),
      b([icon("save"), "Export"], (e) => exp(e.currentTarget, T.n)),
      inbox && b("Collate the inbox", () => A.say(T.n, "collate the inbox")),
    ),
    h("h4", "Chats"),
    A.list(chats, chat, "No chats yet: write one in the box below."),
    h("h4", "Pages"),
    A.list(P.pages, page, "No pages yet: a run adds them, and Add starts its Inbox."),
  );
  v.pj?.remove();
  v.head.after(d);
  v.pj = Object.assign(d, { k });
}

/**
 * The box at the foot, the page's own (app.js `inProject`): Send opens a new chat in the project
 * (`under`); Add, beside it (`v.add`), sends `add <name>: …` with its file, saved with no run.
 */
function box(v) {
  const f = v.foot.querySelector("form");
  if (!v.co || !f) return;
  const ta = f.querySelector("textarea");
  ta.placeholder = "A new chat in it, or Add to its Inbox";
  if (f.querySelector(".add")) return;
  const b = A.btn(
    "Add",
    () => {
      if (!ta.value.trim()) return A.told("Write what you found, then Add: no run starts.");
      if (f.querySelectorAll(".tray > *").length > 1)
        return A.told("Add takes one file at a time.");
      v.add = 1;
      f.requestSubmit();
      v.add = 0;
    },
    ".btn.add",
  );
  b.title = "Add to its Inbox, with no run";
  f.querySelector(".send").before(b);
}

/** Export (export.js): built in the browser, its size said, then downloaded or shared as a drop. */
function exp(at, n) {
  const whole = confirm("Put each chat in the zip, whole? Cancel leaves them out.");
  // To share: the zip in this box, with the words that ask for a drop; Send makes a chat for it.
  const share = (file) => {
    const co = A.R.v?.co;
    co?.add([file]);
    co?.fill("share this as a drop");
  };
  A.lazy("export")((x) => x.offer(at, x.exportProject(n, whole), share));
}

/** New project, from the Desk: a name, a line on what it's for, its repos if any; then its page. */
export function newProject() {
  const name = h("input", { placeholder: "games", maxlength: 39, autocapitalize: "off" });
  const what = h("textarea", { rows: 2, placeholder: "Offline games for the kids' tablet" });
  const repos = h("input", { placeholder: "shop, shop-api" });
  const o = A.out();
  const b = h("button.primary", "Make it");
  const f = h(
    "form.card.form",
    h("label", "Name", name),
    h("label", "What it's for", what),
    h("label", "Its repos (optional)", repos),
    b,
    o,
  );
  f.onsubmit = async (e) => {
    e.preventDefault();
    const n = name.value.trim().toLowerCase();
    const r = repos.value.trim();
    const w = what.value.trim();
    o.textContent = /^[a-z0-9][a-z0-9-]{0,38}$/.test(n)
      ? ""
      : "Name it in lowercase letters, digits and dashes: games, shop-2.";
    if (o.textContent) return;
    const s = await A.quick(undefined, `project: ${n}${r && ` repos: ${r}`}\n${w}`, o, b);
    if (s?.task) A.go(`#/t/${s.task}`);
  };
  return f;
}

/** Move to project, from a chat's menu: pick one; the door links it, with no edit and no run. */
export function move(n) {
  const at = A.R.v?.head.querySelector('[aria-label="Task menu"]');
  const ps = (A.S.list?.tasks || []).filter((t) => t.project && t.n !== n);
  const to = (p) => () =>
    A.get("move", { task: n, project: p.n }).then(
      (s) => A.told(s.text),
      () => {},
    );
  if (at)
    pop(
      at,
      ps.length
        ? ["Move to which project?", ...ps.map((p) => [p.project.name, to(p)])]
        : ["No projects yet: make one on the Desk"],
    );
}
