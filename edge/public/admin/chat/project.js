// @ts-check
// Shipify chat: a project's screen (ADR 0069, ADR 0071), loaded the first time one opens, Move to
// project on a chat's menu, and New project's form (from the Desk). A project is an issue labelled
// `project`; its screen is four tabs under its header: Overview (Now, its next step, its buttons,
// then its own thread), Chats (by state), Docs (each opens in the pane, with Edit) and Files (its
// chats' and docs', from one read of Files kept a minute). The box at its foot replies to none:
// Send opens a new chat in the project, Add puts what you found in its Inbox, with no run.
import { h, icon, pop, size } from "./compose.js";

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

const TABS = ["Overview", "Chats", "Docs", "Files"];
const ws = (f) => A.lazy("workspace")(f);

/**
 * A project's screen under its header (ADR 0071), drawn again only when what it shows changed; and
 * its box. A tab other than Overview takes the thread's place. The Library's line for a project
 * opens it on Docs (`A.R.tab`).
 */
export function screen(v, t) {
  const T = t.task;
  const P = T.project;
  box(v, T);
  if (A.R.tab) [v.tab, A.R.tab] = [A.R.tab, 0];
  const tab = v.tab || "Overview";
  if (tab === "Files" && v.fl === undefined) files(v, t);
  v.box.classList.toggle("tab", tab !== "Overview");
  const k = JSON.stringify([P, T.state, T.open, tab, v.fl, A.runs().size]);
  if (v.pj?.k === k) return;
  const count = { Chats: P.chats.length, Docs: P.pages.length, Files: v.fl?.count };
  const one = (l) => {
    const b = A.btn([l, count[l] != null && h("small", `${count[l]}`)], () => {
      v.tab = l;
      v.fl = l === "Files" ? undefined : v.fl;
      screen(v, t);
    });
    b.ariaPressed = String(l === tab);
    return b;
  };
  const d = h(
    "div.pjs",
    h("div.tabs", { role: "group", "aria-label": "Show" }, TABS.map(one)),
    { Overview: overview, Chats: chats, Docs: docs, Files: kept }[tab](v, T, P),
  );
  v.pj?.remove();
  v.head.after(d);
  v.pj = Object.assign(d, { k });
}

/**
 * Overview: its Now, its one next step (ADR 0070) and the chats waiting on you, its buttons; its
 * own thread under it. Collate and Check the project each start a chat in it, as any ask does.
 * Closed (ADR 0069), it's read-only: the step says when and what stays; Reopen and Export only.
 */
function overview(v, T, P) {
  const u = { n: T.n, name: P.name };
  const inbox = P.pages.find((g) => g.name === "Inbox");
  const b = (l, f) => A.btn(l, f, ".btn");
  // Add: the box at its foot, ready to type in (its Add button saves with no run).
  const add = () => {
    v.foot.querySelector("textarea")?.focus();
    A.told("Write what you found, then Add: no run starts.");
  };
  const wait = P.chats.filter((c) => c.state === "needs-you" || c.state === "stuck");
  // Its own thread waiting on you (a question put to the project itself): answered in the box.
  const asks = T.state === "needs-you";
  return h(
    "div.pjo",
    P.now &&
      h(
        "ul",
        P.now.map((l) => h("li", l)),
      ),
    h(
      "p.quiet",
      h("b", "Next step: "),
      asks ? "The project asks you something, below: answer it in the box." : P.step,
    ),
    wait.length > 0 &&
      h(
        "ul.wait",
        wait.map((c) => h("li", A.to(c.n, A.bare(c.title)), " ", A.meta(WORD[c.state]))),
      ),
    h(
      "p.links",
      T.open
        ? [
            b([icon("plus"), "New chat here"], () => A.start("", "#/new", u)),
            b("Add", add),
            inbox && b("Collate", () => A.say(undefined, "Collate the inbox", T.n)),
            b("Check the project", () => A.say(undefined, "Check the project", T.n)),
          ]
        : b([icon("undo"), "Reopen"], () => A.turn(T)),
      b([icon("save"), "Export"], (e) => exp(e.currentTarget, T.n)),
    ),
  );
}

/** Chats: by state, what needs you first; quiet ones (no word for 7 days) apart. */
function chats(_v, _T, P) {
  const rows = A.S.list?.tasks || [];
  const quiet = (c) => {
    const r = rows.find((x) => x.n === c.n);
    return r && Date.now() - Date.parse(r.updated) > 6048e5;
  };
  const by = (c) =>
    c.state === "closed"
      ? "Closed"
      : c.state === "needs-you" || c.state === "stuck"
        ? "Needs you"
        : c.state === "working" || A.runs().has(c.n)
          ? "Working"
          : quiet(c)
            ? "Quiet"
            : "Open";
  const chat = (c) => [
    h(`i.mark.${c.state}`),
    A.what(A.to(c.n, A.bare(c.title)), A.meta(WORD[c.state] || c.state, `#${c.n}`)),
  ];
  const each = ["Needs you", "Working", "Open", "Quiet", "Closed"].map((l) => {
    const g = P.chats.filter((c) => by(c) === l);
    return g.length > 0 && [h("h3", l), A.list(g, chat)];
  });
  return h(
    "div.page",
    P.chats.length ? each : h("p.quiet", "No chats yet: ask a first question on Overview."),
  );
}

/** Docs: Overview, Sources and the Inbox first, then its topic docs; each opens in the pane. */
function docs(_v, _T, P) {
  const first = ["Overview", "Sources", "Inbox"];
  const at = (g) => first.indexOf(g.name) + 1 || 9;
  const l = [...P.pages].sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name));
  const doc = (g) => [
    icon("book"),
    A.what(
      A.btn(g.name, () => ws((w) => w.page(g.n)), ".name"),
      A.meta(
        g.waiting != null ? `${g.waiting} new finds` : size(g.size),
        `changed ${A.ago(g.updated)} ago`.replace("now ago", "now"),
      ),
    ),
  ];
  return h("div.page", A.list(l, doc, "No docs yet: a run writes them, and Add starts its Inbox."));
}

/** Files: every file of its chats and docs, newest first, each with its chat. */
function kept(v) {
  const f = (x) => [
    icon("file"),
    A.what(
      A.btn(x.name, () => ws((w) => w.doc(x)), ".name"),
      A.meta(size(x.size), x.by === "you" ? "by you" : "by a run"),
      x.task && A.to(x.task, `#${x.task}`),
    ),
  ];
  return h(
    "div.page",
    v.fl
      ? A.list(v.fl.files, f, "No files yet: what you send in its chats shows here.")
      : h("div.ph"),
  );
}

/** Its files: Files' one read (kept a minute at the edge), only its chats', docs' and its own. */
async function files(v, t) {
  const T = t.task;
  const P = T.project;
  const ns = [T.n, ...P.chats.map((c) => c.n), ...P.pages.map((g) => g.n)].slice(0, 300);
  // Read once each time its tab opens: null till then (placeholders).
  v.fl = null;
  const d = await A.get(`files?chats=${ns.join(",")}`, undefined, false, "").catch(() => 0);
  v.fl = d || { files: [], count: 0 };
  if (A.R.v === v) screen(v, t);
}

/**
 * The box at the foot, the page's own (app.js `inProject`): Send opens a new chat in the project
 * (`under`); Add, beside it (`v.add`), sends `add <name>: …` with its file, saved with no run. A
 * closed project has none: nothing goes into it till it's reopened.
 */
function box(v, T) {
  const f = v.foot.querySelector("form");
  if (f) f.style.display = T.open ? "" : "none";
  // Answering the project's own question (app.js): a reply box, as a chat's.
  if (!v.co || !f || v.w !== 2) return;
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
    // A guest's project has no repos (ADR 0071).
    !A.GUEST && h("label", "Its repos (optional)", repos),
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

/**
 * Move to project, from a chat's menu: pick one of your open projects (the index's, past the list's
 * first page; a guest's, from their list); the door links it, with no edit and no run.
 */
export function move(n) {
  const at = A.R.v?.head.querySelector('[aria-label="Task menu"]');
  const to = (p) => () =>
    A.get("move", { task: n, project: p.n }).then(
      (s) => A.told(s.text),
      () => {},
    );
  ws((w) => w.index()).then(() => {
    const mine = (A.S.list?.tasks || []).filter((t) => t.project);
    const ps = (
      A.R.nb?.projects || mine.map((t) => ({ n: t.n, name: t.project.name, open: 1 }))
    ).filter((p) => p.open && p.n !== n);
    if (at)
      pop(
        at,
        ps.length
          ? ["Move to which project?", ...ps.map((p) => [p.name, to(p)])]
          : ["No open projects: make one on the Desk"],
      );
  });
}
