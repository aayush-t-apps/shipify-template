// @ts-check
// Shipify chat: projects as workspaces (ADR 0065), loaded the first time one is needed: a
// project's tabs and its page, the doc pane beside the thread, Files, and the quick switcher
// (Ctrl+K). It keeps nothing but the open tabs and the pane's width, in the browser, with the rest.
import { $, h, icon, set, size } from "./compose.js";

/** What the page lends it (app.js `ws`): its state and a few of its helpers. @type {any} */
let A;
const enc = encodeURIComponent;
const IMG = /^image\/(png|jpeg|gif|webp)$/;
/** The most tabs a project keeps open: the oldest goes. */
const MOST = 12;
const WORD = {
  "needs-you": "Needs you",
  working: "Working",
  staying: "Staying",
  stuck: "Stopped",
  open: "Open",
  closed: "Closed",
};

/** Takes what the page lends, and loads its stylesheet; ready once it has. */
export function init(a) {
  A = a;
  if (A.S.dw) $("#app").style.setProperty("--dw", `${A.S.dw}px`);
  return new Promise((r) =>
    document.head.append(
      h("link", { rel: "stylesheet", href: "workspace.css", onload: r, onerror: r }),
    ),
  );
}

// ---------------------------------------------------------------- what the page knows

/** Every task the page has: the list, its older and closed pages, then the threads kept. */
function known() {
  const R = A.R;
  const all = [...(A.S.list?.tasks || []), ...(R.old?.tasks || []), ...(R.closed?.tasks || [])];
  for (const t of Object.values(A.S.threads)) all.push(t.task);
  const seen = new Set();
  return all.filter((t) => t?.title && !seen.has(t.n) && seen.add(t.n));
}
const task = (n) => known().find((t) => t.n === n);
/** A task's mark: the list's run first, then its state. */
const mark = (t) => (A.runs().has(t?.n) ? "working" : t?.staying ? "staying" : t?.state || "open");
const name = (P) => A.named(P);
const ago = (t) => (A.ago(t) === "now" ? "now" : `${A.ago(t)} ago`);

/** A project's repo on GitHub: Shipify's own as its tasks say, another of yours by its name. */
function repoOf(P) {
  const url = A.S.list?.tasks[0]?.url || "";
  const own = /^https:\/\/github\.com\/[^/]+\/[^/]+/.exec(url)?.[0];
  if (P === "shipify") return own;
  const real = (A.S.menu?.repos || []).find((r) => r.toLowerCase() === P) || P;
  const owner = own?.split("/")[3];
  return real.includes("/")
    ? `https://github.com/${real}`
    : owner && `https://github.com/${owner}/${real}`;
}

// ---------------------------------------------------------------- tabs

const tabsOf = (P) => (A.S.tabs[P] ||= []);

/** A project's tabs: its page, the tasks open in it (state, title, ✕), and + for a new chat. */
function nav(P, n) {
  const one = (t) => {
    const x = task(t);
    const st = mark(x);
    const title = x ? A.bare(x.title) : `#${t}`;
    const x2 = A.btn(icon("x"), () => shut(P, t, n), ".icon.x");
    x2.ariaLabel = x2.title = `Close ${title}`;
    return h(
      `div.wt${t === n ? ".on" : ""}`,
      h(
        "a",
        { href: `#/t/${t}`, title: `${title} · ${WORD[st]}`, "aria-current": t === n && "page" },
        h(`i.mark.${st}`),
        h("span", title),
      ),
      x2,
    );
  };
  const home = h(
    `div.wt.home${n ? "" : ".on"}`,
    h(
      "a",
      { href: `#/p/${enc(P)}`, title: "The project's page", "aria-current": !n && "page" },
      icon("app"),
      h("span", name(P)),
    ),
  );
  const add = A.btn(icon("plus"), () => A.start(`${P}: `), ".icon.add");
  add.ariaLabel = add.title = "New chat here";
  const e = h("nav.wtabs", { "aria-label": `${name(P)}'s tabs` }, home, tabsOf(P).map(one), add);
  Object.assign(e.dataset, { p: P, n: String(n) });
  return e;
}

/** A project's tabs above a view, this task's added (the oldest goes past MOST). */
export function strip(box, P, n) {
  const T = tabsOf(P);
  if (n && !T.includes(n)) {
    T.push(n);
    T.splice(0, T.length - MOST);
    A.keep();
  }
  box.querySelector(".wtabs")?.remove();
  const e = nav(P, n);
  box.prepend(e);
  e.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** ✕: the tab goes; the one open goes to its neighbour, or to the project's page. */
function shut(P, t, n) {
  const T = tabsOf(P);
  const i = T.indexOf(t);
  T.splice(i, 1);
  A.keep();
  const next = T[i] || T[i - 1];
  if (t === n) location.replace(next ? `#/t/${next}` : `#/p/${enc(P)}`);
  else redraw();
}

/** Alt+1…9: the project's page is 1, its tabs after it. */
export function pick(i) {
  $(".wtabs")?.querySelectorAll(".wt > a")[i - 1]?.click();
}

/** The list changed: the tabs on screen, and a page of this module's, drawn again. */
export function redraw() {
  for (const e of document.querySelectorAll(".wtabs")) {
    const f = nav(e.dataset.p, Number(e.dataset.n));
    e.replaceWith(f);
    f.scrollLeft = e.scrollLeft;
  }
  const v = A.R.page;
  if (v?.ws && v.body.isConnected && A.R.files) set(v.body, v.draw(A.R.files));
}

// ---------------------------------------------------------------- a project's page and Files

/** A doc in a list: a thumbnail or an icon, its name (opens it), its size, who, when it goes. */
const kept = (f) => [
  IMG.test(f.type) ? h("img.thumb", { src: f.src, alt: "", loading: "lazy" }) : icon("file"),
  A.what(
    A.btn(f.name, () => doc(f), ".name"),
    A.meta(
      size(f.size),
      f.by === "you" ? "by you" : "by a run",
      f.until && `goes ${A.until(f.until)}`,
    ),
    f.task && [" · ", A.to(f.task)],
  ),
];
const byAt = (a, b) => Date.parse(b.at) - Date.parse(a.at);
const docs = (l, none) => A.list(l.sort(byAt), kept, none);
/** The project of a file's task, as far as the page knows the task. */
const projOfFile = (f, all) => {
  const t = all.find((x) => x.n === f.task);
  return t ? A.projOf(t) : "";
};

/** Its repo's docs, on GitHub (the door App can't read a repo's files): what each kind keeps. */
function repoDocs(P) {
  const gh = repoOf(P);
  if (!gh) return "";
  const at = (l, p, tree = false) =>
    h(
      "a.btn",
      { href: `${gh}/${tree ? "tree" : "blob"}/HEAD/${p}`, target: "_blank", rel: "noopener" },
      l,
    );
  const built = A.S.menu?.projects?.some((x) => x.toLowerCase() === P);
  const links =
    P === "shipify"
      ? [
          at("Tour", "docs/tour.md"),
          at("Design", "docs/design.md"),
          at("Decisions", "docs/adr", true),
          at("Plans", "plans", true),
          at("Roadmap", "docs/roadmap.md"),
          at("Changelog", "CHANGELOG.md"),
        ]
      : built
        ? [
            at("Spec", "docs/spec.md"),
            at("Decisions", "docs/adr", true),
            at("Changelog", "CHANGELOG.md"),
            at("README", "README.md"),
          ]
        : [at("README", "README.md")];
  const repo = h("a.btn", { href: gh, target: "_blank", rel: "noopener" }, "The repo");
  return h("section", h("h4", "Repo docs", h("small", "on GitHub")), h("p.links", repo, links));
}

/** The project's page, under its tabs: where it stands, its chats, its docs. */
export function project(P) {
  const top = () => A.btn([icon("plus"), "New chat here"], () => A.start(`${P}: `), ".primary");
  A.page(name(P), "files", (d) => overview(P, d), top);
  A.R.page.ws = 1;
  $("#main .view")?.prepend(nav(P, 0));
}

function overview(P, d) {
  const all = known();
  const mine = all.filter((t) => A.projOf(t) === P);
  const open = mine.filter((t) => t.state !== "closed");
  const nums = new Set(mine.map((t) => t.n));
  const files = d.files.filter((f) => nums.has(f.task));
  const app = A.S.menu?.apps?.find((a) => a.id === P);
  const n = (f) => open.filter(f).length;
  const need = n((t) => t.state === "needs-you");
  const tile = (l, v, c = "") => h(`div.tile${c}`, h("small", l), h("b", `${v}`));
  const now = h(
    "div.strip",
    tile("Open", open.length),
    tile("Needs you", need, need ? ".need" : ""),
    tile(
      "Working",
      n((t) => A.runs().has(t.n)),
    ),
    // The app, if it's one Shipify built and runs: up, failing or paused, and a way to it.
    app &&
      h(
        `div.tile${app.failing && !app.paused ? ".bad" : ""}`,
        h("small", "The app"),
        h("b", A.ext(app.url, app.paused ? "paused" : app.failing ? "failing" : "up")),
      ),
  );
  const chat = (t) => [
    h(`i.mark.${mark(t)}`),
    A.what(A.to(t.n, A.bare(t.title)), A.meta(WORD[mark(t)], `#${t.n}`, ago(t.updated))),
  ];
  const sorted = open.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
  return [
    now,
    h("h3", "Chats"),
    A.list(sorted, chat, "No open chats here: start one."),
    h("h3", "Docs"),
    h(
      "section",
      h("h4", "In", h("small", "what you sent")),
      docs(
        files.filter((f) => f.by === "you"),
        "Nothing in the last 7 days.",
      ),
    ),
    h(
      "section",
      h("h4", "Out", h("small", "what runs made")),
      docs(
        files.filter((f) => f.by === "run"),
        "Nothing in the last 7 days.",
      ),
    ),
    repoDocs(P),
  ];
}

/** Files: what was sent or made in the last 7 days, by project. */
export function files() {
  A.page("Files", "files", (d) => {
    const all = known();
    const by = new Map();
    for (const f of d.files.sort(byAt)) {
      const p = projOfFile(f, all);
      by.set(p, [...(by.get(p) || []), f]);
    }
    if (!by.size) return h("p.quiet", "No files in the last 7 days.");
    const head = (p) =>
      p ? h("h3", h("a", { href: `#/p/${enc(p)}` }, name(p))) : h("h3", "General");
    return [...by].map(([p, l]) => [by.size > 1 && head(p), docs(l, "")]);
  });
  A.R.page.ws = 1;
}

// ---------------------------------------------------------------- the doc pane

/** Each doc's view as last read: an unchanged one is a 304, with nothing in it. */
const DOCS = {};
let at = "";
const hide = () => {
  const p = $("#doc");
  p.hidden = true;
  set(p);
  document.body.classList.remove("doc");
};
// Back closes it (it's a step in the history, as a thread is); going to another task doesn't.
addEventListener("popstate", () => !history.state?.doc && location.href === at && hide());
const close = () => (history.state?.doc ? history.back() : hide());

/** The pane's width, dragged or with the arrows, kept: at least 18rem, at most 70% of the screen. */
function width(w) {
  A.S.dw = Math.round(Math.max(288, Math.min(w, innerWidth * 0.7)));
  $("#app").style.setProperty("--dw", `${A.S.dw}px`);
}
function grip() {
  const g = h("div.grip", { role: "separator", "aria-label": "Resize", tabindex: "0" });
  g.onpointerdown = (e) => {
    g.setPointerCapture(e.pointerId);
    g.onpointermove = (m) => width(innerWidth - m.clientX);
  };
  g.onpointerup = () => {
    g.onpointermove = null;
    A.keep();
  };
  g.onkeydown = (e) => {
    const d = { ArrowLeft: 32, ArrowRight: -32 }[e.key];
    if (d) width($("#doc").offsetWidth + d) || A.keep();
  };
  return g;
}

/** What a doc's read gave: Markdown rendered, a CSV as a table, text as it is. */
const shown = (d) => [
  d.html != null
    ? Object.assign(h("div.md"), { innerHTML: d.html })
    : d.rows
      ? h(
          "div.md.csv",
          h(
            "table",
            d.rows.map((r, i) =>
              h(
                "tr",
                r.map((x) => h(i ? "td" : "th", x)),
              ),
            ),
          ),
        )
      : d.text != null
        ? h("pre.text", d.text)
        : h("p.quiet", "No view for this kind of file: Download it."),
  d.cut && h("p.hint", "Only its start shows here: Download has all of it."),
];

/**
 * A file beside the thread (on a phone, the whole screen): a picture, a PDF in the browser's own
 * viewer, Markdown, a CSV or text read through the edge, else Download. Ask about this puts it in
 * your next message.
 */
export async function doc(f) {
  const pane = $("#doc");
  const ref = /^api\/file\/([\w-]+)$/.exec(f.src || "")?.[1];
  const x = A.btn(icon("x"), close, ".icon");
  x.ariaLabel = x.title = "Close";
  const dl =
    f.src &&
    h(
      "a.icon",
      { href: f.src, download: f.name, title: "Download", "aria-label": "Download" },
      icon("save"),
    );
  const asked = () => {
    A.ask({ ref, name: f.name, type: f.type || "", size: f.size || 0 });
    if (!matchMedia("(min-width: 800px)").matches) close();
  };
  const ask =
    ref && A.S.menu?.files?.on && A.btn([icon("chat"), "Ask about this"], asked, ".btn.askit");
  const body = h("div.dbody", h("div.ph"));
  const head = h(
    "header.head",
    h("div.title", h("h2", f.name), h("p.tags", f.size && size(f.size))),
    ask,
    dl,
    x,
  );
  set(pane, grip(), head, body);
  pane.hidden = false;
  document.body.classList.add("doc");
  if (!history.state?.doc) {
    history.pushState({ doc: 1 }, "");
    at = location.href;
  }
  const pdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  let c;
  if (IMG.test(f.type || "")) {
    const i = h("img.pic", { src: f.src, alt: f.name });
    i.onclick = () => A.view(h("img", { src: f.src, alt: f.name }));
    c = i;
  } else if (pdf && ref)
    // A browser with no PDF viewer of its own (Chrome on a phone) opens it with the phone's.
    c = navigator.pdfViewerEnabled
      ? h("iframe.pdf", { src: `${f.src}?view=1`, title: f.name })
      : h(
          "p.quiet",
          "This browser shows a PDF on its own: ",
          h("a", { href: `${f.src}?view=1`, target: "_blank", rel: "noopener" }, "open it"),
        );
  else if (ref) {
    const d = (await A.get(`doc/${ref}`).catch(() => 0)) || DOCS[ref];
    if (d) DOCS[ref] = d;
    c = d ? shown(d) : h("p.quiet", "It couldn't be read just now: Download it, or try again.");
  } else c = h("p.quiet", "This file opens in the chat it came from: Download it.");
  if (body.isConnected) set(body, c);
}

// ---------------------------------------------------------------- Ctrl+K

/** Find a project, a task or a doc by its name, and go there: the arrows move, Enter opens. */
export function quick() {
  $(".qk")?.remove();
  const q = h("input", {
    type: "search",
    placeholder: "Find a project, a task or a doc",
    "aria-label": "Find",
  });
  const out = h("div.qlist");
  const d = h("dialog.qk", q, out);
  document.body.append(d);
  d.onclose = () => d.remove();
  d.onclick = (e) => e.target === d && d.close();
  const all = () => {
    const tasks = known();
    const ps = [...new Set(["shipify", ...tasks.map((t) => A.projOf(t)).filter(Boolean)])];
    return [
      ...ps.map((p) => ({ k: "app", t: name(p), s: "Project", go: `#/p/${enc(p)}` })),
      ...tasks.map((t) => ({
        k: "chat",
        t: A.bare(t.title),
        s: [`#${t.n}`, A.projOf(t) && name(A.projOf(t)), WORD[mark(t)]].filter(Boolean).join(" · "),
        go: `#/t/${t.n}`,
      })),
      ...(A.R.files?.files || []).map((f) => ({
        k: "file",
        t: f.name,
        s: `Doc · ${size(f.size)}`,
        f,
      })),
    ];
  };
  const draw = () => {
    const w = q.value.trim().toLowerCase();
    const hit = all()
      .filter((x) => `${x.t} ${x.s}`.toLowerCase().includes(w))
      .slice(0, 30);
    const open = (x) => () => {
      d.close();
      if (x.f) doc(x.f);
      else A.go(x.go);
    };
    set(
      out,
      hit.map((x) =>
        h(
          "button",
          { type: "button", onclick: open(x) },
          icon(x.k),
          h("span", x.t),
          h("small", x.s),
        ),
      ),
      !hit.length && h("p.quiet", "Nothing by that name."),
    );
  };
  q.oninput = draw;
  d.onkeydown = (e) => {
    const l = [q, ...out.querySelectorAll("button")];
    const i = l.indexOf(/** @type {any} */ (document.activeElement));
    const m = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (e.key === "Enter" && e.target === q) out.querySelector("button")?.click();
    else if (m && i >= 0) l[Math.max(0, Math.min(l.length - 1, i + m))]?.focus();
    else return;
    e.preventDefault();
  };
  draw();
  d.showModal();
  // Docs come from Files' read (kept 60 s at the edge), once a page.
  if (A.R.files) return;
  A.get("files", undefined, true).then((x) => {
    if (!x) return;
    A.R.files = x;
    if (d.open) draw();
  }, Boolean);
}
