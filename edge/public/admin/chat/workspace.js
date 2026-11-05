// @ts-check
// Shipify chat: projects as workspaces (ADR 0065), loaded the first time one is needed: a
// project's page, the doc pane beside the thread, Files, and the quick switcher (Ctrl+K). It keeps
// nothing but the pane's width, in the browser, with the rest. A project has no tab row (ADR 0069):
// its name in a thread's header goes to its page, and Ctrl+K opens on the chats seen last.
import { $, api, h, icon, set, size, unfile } from "./compose.js";

/** What the page lends it (app.js `ws`): its state and a few of its helpers. @type {any} */
let A;
const enc = encodeURIComponent;
const IMG = /^image\/(png|jpeg|gif|webp)$/;
const WORD = {
  "needs-you": "Needs you",
  working: "Working",
  staying: "Staying",
  stuck: "Stopped",
  waiting: "Waiting",
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

/**
 * Every task the page has: the list, its older and closed pages, then the threads kept here, with
 * no state: a kept one's is as last read (a chat closed since said Needs you).
 */
function known() {
  const R = A.R;
  const all = [...(A.S.list?.tasks || []), ...(R.old?.tasks || []), ...(R.closed?.tasks || [])];
  for (const t of Object.values(A.S.threads)) all.push({ ...t.task, state: "", staying: 0 });
  const seen = new Set();
  return all.filter((t) => t?.title && !seen.has(t.n) && seen.add(t.n));
}
/** Open now, as the list has them (all of yours), your close or reopen at once (app.js `moved`). */
function opened() {
  const T = A.R.turned;
  return A.join(A.S.list?.tasks || [], A.R.old?.tasks || [])
    .filter((t) => !T[t.n] && t.state !== "closed")
    .concat(Object.values(T).flatMap((v) => (v.open ? [v.t] : [])));
}
/** Your projects and their docs (ADR 0069): the Library's read, once a page, untagged (no 304). */
export function index() {
  const R = A.R;
  if (!A.GUEST && !R.ix)
    R.ix = A.get("notebook", undefined, true, "").then(
      (d) => (R.nb = d || R.notebook || {}),
      () => (R.ix = 0),
    );
  return R.ix || Promise.resolve();
}
/** A task's mark: the list's run first, then its state (none for a thread kept here). */
const mark = (t) => (A.runs().has(t?.n) ? "working" : t?.staying ? "staying" : t?.state);
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

/** The list changed: a page of this module's on screen, drawn again. */
export function redraw() {
  const v = A.R.page;
  if (v?.ws && v.body.isConnected && A.R.files) set(v.body, v.draw(A.R.files));
}

// ---------------------------------------------------------------- a project's page and Files

/** A file dragged onto the box goes with your next message, as Ask about this does (ADR 0069). */
const drag = (e, f) => {
  const ref = /^api\/file\/([\w-]+)$/.exec(f.src || "")?.[1];
  if (!ref) return e;
  e.draggable = true;
  e.ondragstart = (d) =>
    d.dataTransfer.setData(
      "text/x-shipify-file",
      JSON.stringify({ ref, name: f.name, type: f.type || "", size: f.size || 0 }),
    );
  return e;
};

/** Deleted for good, after you say so: the list shows it at once, then reads again. */
async function del(f) {
  if (!confirm(`Delete ${f.name}? It goes from every message that has it.`)) return;
  const r = await unfile(f.ref).catch(() => 0);
  if (!r?.ok) return alert("It couldn't be deleted just now: try again.");
  const d = A.R.files;
  A.R.files = {
    ...d,
    files: d.files.filter((x) => x !== f),
    count: d.count - 1,
    bytes: d.bytes - f.size,
  };
  redraw();
  A.fresh();
}

/** A doc in a list: a thumbnail or an icon, its name (opens it; drag it to the box), size, who. */
const kept = (f) => [
  IMG.test(f.type) ? h("img.thumb", { src: f.src, alt: "", loading: "lazy" }) : icon("file"),
  A.what(
    drag(
      A.btn(f.name, () => doc(f), ".name"),
      f,
    ),
    A.meta(size(f.size), f.by === "you" ? "by you" : "by a run", ago(f.at)),
  ),
  A.btn("Delete", () => del(f), ".danger"),
];
const byAt = (a, b) => Date.parse(b.at) - Date.parse(a.at);
const docs = (l, none) => A.list(l.sort(byAt), kept, none);

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

/** The project's page: where it stands, its chats, its docs. */
export function project(P) {
  const top = () => A.btn([icon("plus"), "New chat here"], () => A.start(`${P}: `), ".primary");
  A.page(`${name(P)} · repo`, "files", (d) => overview(P, d), top);
  A.R.page.ws = 1;
}

/** Its open chats: the list's (`opened`). Its files: those of each of its chats the page knows. */
function overview(P, d) {
  const mine = known().filter((t) => A.projOf(t) === P);
  const open = opened().filter((t) => A.projOf(t) === P);
  const nums = new Set(mine.map((t) => t.n));
  const files = d.files.filter((f) => nums.has(f.task));
  const app = A.S.menu?.apps?.find((a) => a.id === P);
  const n = (f) => open.filter(f).length;
  const need = n((t) => t.state === "needs-you");
  const tile = (l, v, c = "") => h(`div.tile${c}`, h("small", l), h("b", `${v}`));
  // In one row, a phone's too (workspace.css).
  const now = h(
    "div.strip.counts",
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
  const kind = (by, l, s) =>
    h(
      "section",
      h("h4", l, h("small", s)),
      docs(
        files.filter((f) => f.by === by),
        "Nothing yet.",
      ),
    );
  return [
    now,
    h("h3", "Chats"),
    A.list(sorted, chat, "No open chats here: start one."),
    h("h3", "Docs"),
    // None yet: one line, not an empty In and Out.
    files.length
      ? [kind("you", "In", "what you sent"), kind("run", "Out", "what runs made")]
      : h("p.quiet", "None yet: what you send in its chats, and what runs make, shows here."),
    repoDocs(P),
  ];
}

/**
 * Files (ADR 0069, ADR 0071): what you sent and runs made, kept as long as their chat, by project
 * (a project's name opens its screen), then by chat, the newest first; the total at the top. One
 * with no chat (a draft's, or from before) is last, under No chat.
 */
export function files() {
  A.page(
    "Files",
    "files",
    (d) => {
      const all = known();
      const at = (n) => all.find((x) => x.n === n);
      // A chat's project: the index's first, open or closed as it is now (a project, a chat under
      // it, or one of its docs: an Inbox's finds); else its own, or the one it's in (the edge says).
      const nb = A.R.nb || {};
      const doc = (n) => nb.library?.find((g) => g.n === n)?.project;
      const mine = (t) =>
        t?.project && { n: t.n, name: t.project.name, open: t.state !== "closed" };
      const pj = (n, t = at(n), up = t?.parent || d.parents?.[n]) =>
        nb.projects?.find((x) => x.n === n || x.n === up || x.name === doc(n)) ||
        mine(t) ||
        mine(at(up));
      const ps = new Map();
      const by = new Map();
      for (const f of d.files.sort(byAt)) {
        const o = f.task && pj(f.task);
        if (o) ps.set(o.n, o);
        const p = f.task ? o?.n || 0 : -1;
        const g = by.get(p) || new Map();
        by.set(p, g.set(f.task || 0, [...(g.get(f.task || 0) || []), f]));
      }
      if (!by.size) return h("p.quiet", "No files yet: what you send in a chat shows here.");
      const head = (n, t = at(n)) =>
        h("h4", n ? A.to(n, t ? `#${n} ${A.bare(t.title)}` : `#${n}`) : "No chat");
      // Projects by name, then chats in no project, then files in no chat.
      const order = (p) => (p > 0 ? ps.get(p).name : p ? "￿" : "￾");
      return [
        h("p.quiet", `${d.count} ${d.count === 1 ? "file" : "files"} · ${size(d.bytes)} in all`),
        [...by]
          .sort(([a], [b]) => (order(a) < order(b) ? -1 : 1))
          .map(([p, g]) => [
            p > 0 && h("h3", A.to(p, `${ps.get(p).name}${ps.get(p).open ? "" : " · closed"}`)),
            [...g].map(([n, l]) => [head(n), docs(l, "")]),
          ]),
      ];
    },
    top,
  );
  const pg = A.R.page;
  pg.ws = 1;
  // Drawn again once the index is in.
  if (!A.R.nb)
    index().then(() => pg.body.isConnected && A.R.files && set(pg.body, pg.draw(A.R.files)));
}

/**
 * Export everything (ADR 0069, export.js): every file kept, as one zip your browser builds, its
 * size said first; shared as a drop from a new chat's box.
 */
const top = () =>
  A.btn(
    [icon("save"), "Export everything"],
    (e) => {
      const at = e.currentTarget;
      const share = (f) =>
        A.into((co) => {
          co.add([f]);
          co.fill("share this as a drop");
        });
      A.lazy("export")((x) => x.offer(at, x.exportFiles(), share));
    },
    ".primary",
  );

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

/** The pane, open with these in its head and body; a step in the history, as a thread is. */
function pane(head, body) {
  const p = $("#doc");
  const x = A.btn(icon("x"), close, ".icon");
  x.ariaLabel = x.title = "Close";
  head.append(x);
  set(p, grip(), head, body);
  p.hidden = false;
  document.body.classList.add("doc");
  if (!history.state?.doc) {
    history.pushState({ doc: 1 }, "");
    at = location.href;
  }
}

/**
 * A file beside the thread (on a phone, the whole screen): a picture, a PDF in the browser's own
 * viewer (or pdf.js's, `pdfIn`), Markdown, a CSV or text read through the edge, else Download. Ask about this puts it in
 * your next message. Its kept copy gone (ADR 0071): Archived, its chip (`chip`) too.
 */
export async function doc(f, chip) {
  const ref = /^api\/file\/([\w-]+)$/.exec(f.src || "")?.[1];
  const dl =
    f.src &&
    h(
      "a.icon",
      { href: f.src, download: f.name, title: "Download", "aria-label": "Download" },
      icon("save"),
    );
  // Ask about this puts it in your next message; Share asks for a drop of it (one short run).
  const asked = (w) => () => {
    A.ask({ ref, name: f.name, type: f.type || "", size: f.size || 0 }, w);
    if (!matchMedia("(min-width: 800px)").matches) close();
  };
  const on = ref && A.S.menu?.files?.on;
  const ask = on && A.btn([icon("chat"), "Ask about this"], asked(), ".btn.askit");
  const share = on && A.btn([icon("open"), "Share"], asked("share this as a drop"), ".btn.askit");
  const body = h("div.dbody", h("div.ph"));
  const head = h(
    "header.head",
    h("div.title", drag(h("h2", f.name), f), h("p.tags", f.size && size(f.size))),
    ask,
    share,
    dl,
  );
  pane(head, body);
  const pdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  // What the edge has of it (not for a picture, which shows from itself): gone is a 404 or 410.
  const d = ref && !IMG.test(f.type || "") && (await api(`doc/${ref}`).catch((e) => e));
  let c;
  if (d?.status === 404 || d?.status === 410) {
    A.R.gone[f.src] = 1;
    chip?.replaceWith(A.lost(f));
    c = h(
      "p.quiet",
      "Archived: its copy here has gone. ",
      f.backup ? A.ext(f.backup, "Open its backup") : "Ask the chat for it again.",
    );
  } else if (IMG.test(f.type || "")) {
    const i = h("img.pic", { src: f.src, alt: f.name });
    i.onclick = () => A.view(h("img", { src: f.src, alt: f.name }));
    c = i;
  } else if (pdf && ref)
    // A browser with no PDF viewer of its own (Chrome on a phone): pdf.js draws it in /pdf/.
    c = navigator.pdfViewerEnabled
      ? h("iframe.pdf", { src: `${f.src}?view=1`, title: f.name })
      : pdfIn(f);
  else if (ref) {
    const r = (!(d instanceof Error) && d) || DOCS[ref];
    if (r) DOCS[ref] = r;
    c = r ? shown(r) : h("p.quiet", "It couldn't be read just now: Download it, or try again.");
  } else c = h("p.quiet", "This file opens in the chat it came from: Download it.");
  if (body.isConnected) set(body, c);
}

/**
 * A PDF in /pdf/, a sandboxed frame (no same-origin: pdf.js never runs here), for a browser with
 * no PDF viewer of its own. Once it's ready, it gets the file's bytes; one it can't show says so.
 */
function pdfIn(f) {
  const fr = h("iframe.pdf", { src: "/pdf/", sandbox: "allow-scripts", title: f.name });
  const failed = () =>
    fr.isConnected && fr.replaceWith(h("p.quiet", "It couldn't be shown here: Download it."));
  fr.said = async (what) => {
    if (what !== "ready") return what === "failed" && failed();
    const b = await fetch(f.src)
      .then((r) => (r.ok ? r.arrayBuffer() : 0))
      .catch(() => 0);
    if (!b) return failed();
    fr.contentWindow?.postMessage({ pdf: b }, "*", [b]);
  };
  return fr;
}
addEventListener("message", (e) => {
  const fr = [...document.querySelectorAll("iframe.pdf")].find((x) => x.contentWindow === e.source);
  if (fr?.said && typeof e.data?.pdf === "string") fr.said(e.data.pdf);
});

/**
 * A doc in the pane (ADR 0071): its words as GitHub renders them, **Edit** (plain Markdown) and
 * **History** (GitHub's). Save sends when it changed as you read it: one changed since is refused,
 * your words left in the box. An Inbox shows its finds under it, with their files.
 */
export async function page(n) {
  const body = h("div.dbody", h("div.ph"));
  const title = h("h2", `#${n}`);
  const tools = h("span.dtools");
  pane(h("header.head", h("div.title", title), tools), body);
  const t = await A.get(`task/${n}`, undefined, false, "").catch(() => 0);
  if (!body.isConnected) return;
  if (!t) return set(body, h("p.quiet", "It couldn't be read just now: try again."));
  const T = t.task;
  const [own, ...finds] = t.messages.filter((x) => !x.tap);
  title.textContent = T.doc?.name || A.bare(T.title);
  const md = (x) => Object.assign(h("div.md"), { innerHTML: x?.html || "" });
  const chip = (f) => (f.src ? A.btn(f.name, () => doc(f), ".chip") : A.lost(f));
  const find = (x) => h("article.msg", md(x), x.files.map(chip));
  const read = () => set(body, md(own), finds.length > 0 && [h("h3", "Finds"), finds.map(find)]);
  const ta = h("textarea.edit", { "aria-label": "Its words, in Markdown" });
  const o = A.out();
  const save = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const s = await A.get("edit", { n, words: ta.value, updated: T.doc.updated }).catch((x) => {
      o.textContent = `${x.message.replace(/\.$/, "")}: ${x.fix}`;
    });
    b.disabled = false;
    if (s) page(n);
  };
  const edit = () => {
    ta.value = own?.md || "";
    set(body, ta, h("p.links", A.btn("Save", save, ".primary"), A.btn("Cancel", read, ".btn")), o);
    ta.focus();
  };
  // Download keeps its words on this device, as Markdown (a guest's too). A doc's history is on
  // GitHub, which a guest can't open (ADR 0071).
  const name = `${(title.textContent || `doc-${n}`).replace(/[^\w.-]+/g, "-")}.md`;
  const dl = A.btn(icon("save"), () => A.save(name, own?.md || ""), ".icon");
  dl.ariaLabel = dl.title = "Download";
  set(
    tools,
    own && dl,
    T.doc && A.btn("Edit", edit, ".btn"),
    !A.GUEST && A.ext(T.url, "History", ".btn"),
  );
  read();
}

// ---------------------------------------------------------------- Ctrl+K

/**
 * Find a project, a repo, a chat or a doc by its name, and go there: the arrows move, Enter opens.
 * With nothing typed, the open chats seen last come first (ADR 0069); by meaning when you pick it
 * (ADR 0070).
 */
export function quick() {
  $(".qk")?.remove();
  const q = h("input", {
    type: "search",
    placeholder: "Find a project, a repo, a chat or a doc",
    "aria-label": "Find",
  });
  const out = h("div.qlist");
  const d = h("dialog.qk", q, out);
  document.body.append(d);
  d.onclose = () => d.remove();
  d.onclick = (e) => e.target === d && d.close();
  const all = (w) => {
    const tasks = known();
    const ps = [...new Set(["shipify", ...tasks.map((t) => A.projOf(t)).filter(Boolean)])];
    // A repo is a repo; "project" is one you made (ADR 0070).
    const projects = ps.map((p) => ({ k: "code", t: name(p), s: "Repo", go: `#/p/${enc(p)}` }));
    // Projects you made (ADR 0069) go to their own page: the index's, the closed ones marked.
    const ix = A.R.nb?.projects || [];
    const pj = (n, t, open) =>
      projects.unshift({ k: "app", t, s: open ? "Project" : "Project · closed", go: `#/t/${n}` });
    for (const t of tasks)
      if (t.project && !ix.some((x) => x.n === t.n)) pj(t.n, t.project.name, 1);
    for (const x of ix) pj(x.n, x.name, x.open);
    const chat = (t) => ({
      k: "chat",
      t: A.bare(t.title),
      s: [`#${t.n}`, A.projOf(t) && name(A.projOf(t)), WORD[mark(t)]].filter(Boolean).join(" · "),
      go: `#/t/${t.n}`,
    });
    // Nothing typed: the chats seen last (the one on screen aside), open ones only, newest first;
    // then the projects.
    if (!w) {
      const on = opened();
      const last = A.S.seen.map((n) => on.find((t) => t.n === n));
      const open = last.filter((t) => t && location.hash !== `#/t/${t.n}`);
      return [...open.reverse().map(chat), ...projects];
    }
    return [
      ...projects,
      ...tasks.map(chat),
      ...(A.R.files?.files || []).map((f) => ({
        k: "file",
        t: f.name,
        s: `Doc · ${size(f.size)}`,
        f,
      })),
    ];
  };
  const open = (x) => () => {
    d.close();
    if (x.f) doc(x.f);
    else A.go(x.go);
  };
  const row = (x) =>
    h("button", { type: "button", onclick: open(x) }, icon(x.k), h("span", x.t), h("small", x.s));
  // Find by meaning (ADR 0070): the page knows only names; GitHub's search reads every chat's and
  // page's words, by what they mean. Asked only when you pick it; words when GitHub is busy.
  const KIND = { chat: ["chat", "Chat"], project: ["app", "Project"], page: ["book", "Page"] };
  const deep = async () => {
    const w = q.value.trim();
    set(out, h("p.quiet", "Finding…"));
    const r = await A.get(`search?q=${enc(w)}`, undefined, true, "").catch(() => null);
    const hits = (r?.items || []).map((x) => {
      const [k, s] = KIND[x.kind];
      return { k, t: x.title, s: `${s} · #${x.n}${x.open ? "" : " · closed"}`, go: `#/t/${x.n}` };
    });
    if (d.open)
      set(
        out,
        hits.map(row),
        h(
          "p.quiet",
          !r
            ? "The search didn't answer. "
            : r.words
              ? "By words: search by meaning is busy, so try again in a minute. "
              : !hits.length && "Nothing found. ",
          !A.GUEST && A.ext(`${repoOf("shipify")}/issues?q=${enc(w)}`, "Search on GitHub"),
        ),
      );
  };
  const draw = () => {
    const w = q.value.trim().toLowerCase();
    const hit = all(w)
      .filter((x) => `${x.t} ${x.s}`.toLowerCase().includes(w))
      .slice(0, 30);
    set(
      out,
      hit.map(row),
      !hit.length && h("p.quiet", "Nothing by that name here."),
      w &&
        h(
          "button",
          { type: "button", onclick: deep },
          icon("search"),
          h("span", "Find by meaning"),
          h("small", "GitHub's search"),
        ),
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
  if (!A.R.nb) index().then(() => d.open && draw());
  // Docs come from Files' read (kept 60 s at the edge), once a page.
  if (A.R.files) return;
  A.get("files", undefined, true).then((x) => {
    if (!x) return;
    A.R.files = x;
    if (d.open) draw();
  }, Boolean);
}
