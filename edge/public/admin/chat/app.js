// @ts-check
// Shipify chat: the list, threads, the pages, downloads, polling and the copy kept in the browser.
import {
  $,
  api,
  cap,
  composer,
  h,
  icon,
  pop,
  said,
  repeatForm,
  set,
  size,
  timed,
  uid,
} from "./compose.js";

const KEY = "shipify-chat";
const OFF = "Offline: showing what it last had";
/** Kept in the browser. @type {Record<string, any>} */
const S = { list: null, menu: null, threads: {}, seen: [], saw: {}, tabs: {}, fold: [] };
try {
  Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}"));
} catch {}
/** @type {Record<string, any>} */
const R = { pend: {}, n: 0, tk: 0, busy: 0, turned: {}, drafts: {}, gone: {}, old: {}, miss: 0 };
const keep = () => {
  S.seen = S.seen.slice(-30);
  for (const n in S.threads) if (!S.seen.includes(+n)) delete S.threads[n];
  for (const n in S.saw) if (!S.list?.tasks.some((t) => t.n === +n)) delete S.saw[n];
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    S.seen = S.seen.slice(-5);
  }
};
const no = () => {};
const go = (x) => Object.assign(location, { hash: x });

// The thin bars at the top; each key is also its class.
const bars = {};
const bar = (k, t, f) => {
  bars[k] = t && [t, f];
  const one = ([c, v]) => v && h(`${v[1] ? "button" : "p"}.b.${c}`, { onclick: v[1] }, v[0]);
  set($("#bar"), Object.entries(bars).map(one));
};
const told = (t) => bar("said", t, () => bar("said"));
const why = (e) => `${e.message.replace(/\.$/, "")}: ${e.fix}`;
// A part that fails to draw says so, with a reload; the list, the thread and the polling go on.
const oops = (e) => {
  console.error(e);
  bar("err", "Something went wrong on this page: tap to reload", () => location.reload());
};
const safe = (f) => {
  try {
    f();
  } catch (e) {
    oops(e);
  }
};
addEventListener("error", (e) => oops(e.error || e.message));
addEventListener("unhandledrejection", (e) => !e.reason?.fix && oops(e.reason));
// What a reload would lose: words in a box or a form, files attached, a message not yet gone.
const written = () =>
  [...document.querySelectorAll("textarea, input:not([type]), input[type=text]")].some((e) =>
    e.value.trim(),
  ) ||
  !!R.draft?.trim() ||
  Object.values(R.drafts).some((d) => d?.trim()) ||
  !!document.querySelector(".tray > *") ||
  Object.values(R.pend).some((q) => q.length);
const reload = () => location.reload();
// Access's session ended: the page loads again through its sign-in, by itself when nothing you
// wrote would go (once a minute at most), else when you tap.
const signin = () => {
  const last = Number(sessionStorage.getItem("shipify-signin") || 0);
  if (!written() && Date.now() - last > 6e4) {
    sessionStorage.setItem("shipify-signin", String(Date.now()));
    return reload();
  }
  bar("off");
  bar("in", "Your sign-in ended: tap to sign in again", reload);
};
// The bar at the top moves only while you wait: a poll for what's on screen already is quiet.
// GitHub not read just now: a poll says nothing and tries again, slower each time (tick); after a
// minute, or on the edge's last good copy (`stale`), a calm line says so. A read you waited for
// that failed says why, and the next good read takes it away.
const DOWN = "Can't reach GitHub · retrying";
async function get(p, b, quiet = false) {
  if (!quiet && !R.busy++) document.body.classList.add("busy");
  try {
    const j = await api(p, b);
    if (j) R.old[p] = j.stale;
    if (R.old[p]) R.down ||= Date.now();
    else R.down = 0;
    bar("off", R.old[p] && DOWN);
    if (!b && R.readErr) {
      R.readErr = false;
      bar("err");
    }
    return j;
  } catch (e) {
    if (e.signin) signin();
    else if (quiet) {
      R.down ||= Date.now();
      if (Date.now() - R.down > 6e4) bar("off", e.off ? OFF : DOWN);
    } else if (e.off) bar("off", OFF);
    else {
      bar("err", why(e), () => bar("err"));
      R.readErr = !b;
    }
    throw e;
  } finally {
    if (!quiet && !--R.busy) document.body.classList.remove("busy");
  }
}
// A newer page (the edge deployed): loaded by itself when you come back with nothing written.
const ver = (v) => {
  R.ver ||= v;
  if (v === R.ver) return;
  if (R.woke && !written()) return reload();
  bar("up", "Updated: tap to reload", reload);
};

const secs = (t) => (Date.now() - Date.parse(t)) / 1e3;
const unit = (s, m = s / 60) =>
  m < 60 ? `${m | 0}m` : m < 1440 ? `${(m / 60) | 0}h` : `${(m / 1440) | 0}d`;
const ago = (t, s = secs(t)) => (s < 60 ? "now" : unit(s));
// A time already gone (the record is a little behind) is due, not "next now".
const until = (t, s = -secs(t)) => (s < 60 ? "due" : `in ${unit(s)}`);
const dur = (t, s = Math.max(0, secs(t) | 0)) =>
  `${(s / 60) | 0}m ${String(s % 60).padStart(2, "0")}s`;
setInterval(() => {
  for (const e of document.querySelectorAll("[data-since]"))
    e.textContent = `Working · ${dur(e.getAttribute("data-since") || "")}`;
}, 1e3);

const ext = (u, t, c = "") => h(`a${c}`, { href: u, target: "_blank", rel: "noopener" }, t);
const to = (n, t = `#${n}`) => h("a", { href: `#/t/${n}` }, t);
const back = () => h("a.icon.back", { href: "#/", "aria-label": "Back to the list" }, icon("back"));
// ↻ in each header (ADR 0049): a tap does what coming back to the page does (wake), and spins until
// what's on screen is read again. What you've typed stays.
const refreshBtn = () => {
  const b = btn(icon("reload"), refresh, ".icon.reload");
  b.ariaLabel = "Refresh";
  b.title = "Refresh";
  return b;
};
async function refresh() {
  document.body.classList.add("spin");
  try {
    await wake();
  } finally {
    document.body.classList.remove("spin");
  }
}
const ph = () => [1, 2, 3].map(() => h("div.ph"));
// A state as a symbol and a word, never colour alone; the word says whose turn it is.
const WORD = { "needs-you": "Needs you", open: "Open", stuck: "Stopped", closed: "Closed" };
const dot = (s, w = WORD[s] || cap(s)) => h(`span.st.${s}`, w);
const mark = (ok, w) => dot(ok ? "ok" : "bad", w);
const online = () => S.list?.boxes.some((b) => b.online);
const working = (r) =>
  r.queued
    ? h("span.st.open", online() ? "Queued" : "Waiting for a box")
    : h("span.st.working", { "data-since": r.since }, `Working · ${dur(r.since)}`);
// A task's state, the same in its row and its header: its run, your words starting one, a run
// staying for them (ADR 0057), else its state ("Open" said only in the header).
const status = (T, run, open = false) => {
  const t = S.threads[T.n];
  const go = !run && t && starting(T, t);
  const st = T.staying ? "staying" : (open || T.state !== "open") && T.state;
  return run ? working(run) : go ? go() : st && dot(st);
};
// A title's kind ("ask:", "shipify:", a repo's, "Recipe:"): a label of its own, only the
// kinds Shipify takes; the rest is the title.
const KIND = /^([\w.-]+):\s*/;
const kindIn = (t, k = KIND.exec(t)?.[1].toLowerCase()) =>
  [
    "ask",
    "new",
    "shipify",
    "repeat",
    "recipe",
    ...(S.menu?.repos || []).map((r) => r.toLowerCase()),
  ].includes(k) && k;
const kindOf = (t) => (/^re(peat|cipe)$/.test(t.from) ? t.from : kindIn(t.title));
const bare = (t) => (kindIn(t) ? t.replace(KIND, "") : t);
const NAME = {
  ask: "Ask",
  new: "New app",
  repeat: "Repeat",
  recipe: "Recipe",
};
const named = (k) => NAME[k] || cap(k);
// A task's project (ADR 0065): the repo its title names, Shipify's own too; none is General.
const projOf = (t, k = kindIn(t.title)) => (k && !NAME[k] ? k : "");
// Parts loaded the first time they're needed (ADR 0065), lent what they read here: workspace.js
// (a project's tabs and page, the doc pane, Files, Ctrl+K), setup.js (Status & setup) and plan.js
// (a split task's Plan card, ADR 0066).
const M = {};
const lazy = (k) => (f) => {
  M[k] ||= import(`./${k}.js`).then(async (m) => {
    const lent = { S, R, go, get, keep, start, bare, named, projOf, runs, ago, until, secs, to };
    const ui = { page, what, meta, list, btn, view, ext, mark, dot, out, copy, quick, fresh, ws };
    await m.init({ ...lent, ...ui, ask, join, notify, sync, say });
    return m;
  });
  return M[k].then(f).catch(oops);
};
const ws = lazy("workspace");
// The tasks a run works on now, as the list shows them.
const runs = () => new Set((S.list?.running || []).filter(goes).map((r) => r.n));
// A run the list shows, till a reply comes after it began: what's left of it is its end, or a run
// queued for words it already read (it finds nothing new). Your words after the reply, or any of
// yours with no 👀 yet (sent as the reply was written), count again.
// One begun for a word that starts no agent (`close`, `reopen`…) is only its tidying: not shown.
// Its one argument only: it's given to `filter`, which passes more.
const goes = (r) => {
  const t = S.threads[r.n];
  const m = t?.messages.at(-1);
  const y = t?.messages.findLast((x) => x.who === "you" && x.id);
  if (y && NORUN.test(y.md) && Date.parse(r.since) > Date.parse(y.at) - 5e3) return false;
  return !(m?.who === "shipify" && Date.parse(m.at) > Date.parse(r.since)) || (y && !y.read);
};
// A task's run: the list knows first (from the runs), the thread once the run writes its status.
const runOf = (T) =>
  timed(
    T.staying,
    T.running,
    Date.now() - R.at < 12e4 && S.list.running.find((r) => r.n === T.n && goes(r)),
  );
// Closed or open now: the door changes the task as it writes the word, and the next read agrees.
function turn(T) {
  T.open = !T.open;
  say(T.n, T.open ? "reopen" : "close");
  moved(T.n, T.open, { title: T.title, from: T.from, url: T.url });
}
// Your own close, reopen, pause or resume shows at once in every view (Open, Closed, Repeats), and
// holds till the lists agree: GitHub's can lag a minute behind a change. Five minutes at most.
function moved(n, open, seen = {}) {
  const state = open ? "open" : "closed";
  const copies = [...(S.list?.tasks || []), ...(R.old?.tasks || []), ...(R.closed?.tasks || [])];
  for (const x of copies) if (x.n === n) x.state = state;
  const t = copies.find((x) => x.n === n) || seen;
  R.turned[n] = { open, at: Date.now(), t: { ...t, n, state, updated: new Date().toISOString() } };
  safe(drawList);
}
const stop = (n) => confirm("Stop this run? What it committed is kept.") && say(n, "stop");
// Your words waiting for a run (in the last 10 minutes): the list is asked too, to see it start.
const waits = (t) => {
  const m = t?.messages.at(-1);
  return m?.who === "you" && secs(m.at) < 600;
};
// Your words are in and no run shows yet: it's starting, a closed task too when they carry it on.
// A fixed word or a bare `use` starts none.
const NORUN =
  /^\s*(no|yes|close|reopen|resume|stop( repeating)?|preview|publish|use [\w.: -]+)\W*$/i;
const soon = (t) =>
  (t.task.open || t.task.wakes) &&
  waits(t) &&
  !NORUN.test(t.messages.at(-1).md) &&
  (() => h("span.st.working", online() ? "Starting…" : "Waiting for a box"));
const IMG = /^image\/(png|jpeg|gif|webp)$/;
const save = (name, text) =>
  h("a", { href: URL.createObjectURL(new Blob([text])), download: name }).click();
const copy = (t) => navigator.clipboard.writeText(t).then(() => told("Copied"), no);
const li = (f) => (x) => h("li", f(x));
const list = (a, f, none) => (a.length ? h("ul.items", a.map(li(f))) : h("p.quiet", none));
const meta = (...a) => h("small", a.filter(Boolean).join(" · "));
const btn = (l, f, c = "") => h(`button${c}`, { type: "button", onclick: f }, l);
const moreBtn = (f, c = ".icon") => btn(icon("more"), f, c);
const start = (w, where = "#/new") => go(where) && Object.assign(R, { draft: w });
// A task that stopped before it finished starts again only on your `continue` (ADR 0040).
const resumed = (t) => /^\s*continue\W*$/i.test(t?.messages.at(-1)?.md ?? "");
const starting = (T, t) => (T.state !== "stuck" || resumed(t)) && soon(t);

// Older pages of the list, 50 tasks each, read once when asked for (not kept, not polled).
const join = (a, b) => {
  const have = new Set(a.map((t) => t.n));
  return a.concat(b.filter((t) => !have.has(t.n)));
};
async function olderTasks() {
  const k = R.shut ? "closed" : "old";
  const d = await get(`list?${R.shut ? "closed=1&" : ""}page=${(R[k]?.page || 1) + 1}`).catch(no);
  if (!d) return;
  R[k] = { page: d.page, more: d.more, tasks: join(R[k]?.tasks || [], d.tasks) };
  drawList();
}
// The closed ones, to look back through: read when the tab opens, never polled.
async function shut(on) {
  R.shut = on;
  drawList();
  if (!on) return;
  const d = await get("list?closed=1").catch(no);
  if (!d) return;
  const was = R.closed;
  R.closed = {
    page: was?.page || 1,
    more: was ? was.more : d.more,
    tasks: join(d.tasks, was?.tasks || []),
  };
  drawList();
}

// The list by project (ADR 0065): each group folds open and shut (open while you search) and
// counts what needs you and what works; tasks with no project are General. One group alone is a
// plain list.
function groups(l, row, runs, q) {
  const by = new Map();
  for (const t of l) by.set(projOf(t), [...(by.get(projOf(t)) || []), t]);
  if (by.size < 2) return h("ul.rows", l.map(row));
  return [...by].map(([p, g]) => {
    const shut = !q && S.fold.includes(p);
    const n = (f, c, w, k = g.filter(f).length) => k > 0 && h(`small.${c}`, { title: w }, `${k}`);
    const fold = btn(
      [
        icon("down"),
        h("b", p ? named(p) : "General"),
        n((t) => t.state === "needs-you", "n", "Needs you"),
        n((t) => runs.has(t.n), "w", "Working"),
      ],
      () => {
        S.fold = shut ? S.fold.filter((x) => x !== p) : [...S.fold, p];
        keep();
        drawList();
      },
      ".fold",
    );
    fold.ariaExpanded = String(!shut);
    const page = {
      href: `#/p/${encodeURIComponent(p)}`,
      title: "Its page",
      "aria-label": "Its page",
    };
    return [
      h("div.proj", fold, p && h("a.icon", page, icon("app"))),
      !shut && h("ul.rows", g.map(row)),
    ];
  });
}

// The list: what needs you first, then what runs; open repeats and recipes last. Open, Needs
// you and Closed are one control; the filters under it (a kind, a project, your labels) count what
// it shows. No call but for closed ones.
function drawList() {
  const L = S.list;
  if (!L) {
    R.key = "";
    return set($("#list"), ph());
  }
  const q = $("#q").value.trim().toLowerCase();
  const runs = new Map(R.shut ? [] : L.running.filter(goes).map((r) => [r.n, r]));
  const need = (t) => 2 * +(t.state === "needs-you") + +runs.has(t.n);
  const C = R.shut && R.closed;
  const every = (t) => /^re(peat|cipe)$/.test(kindOf(t));
  const listed = R.shut
    ? (C?.tasks || []).filter((t) => t.state === "closed")
    : join(L.tasks, R.old?.tasks || []).filter((t) => t.state !== "closed");
  const mine = Object.values(R.turned).filter((v) => v.open === !R.shut);
  const all = listed.filter((t) => !R.turned[t.n]).concat(mine.map((v) => v.t));
  const needs = all.filter((t) => t.state === "needs-you").length;
  // New since you last looked: a task you've opened that changed after (a reply, mostly). The one
  // open now is looked at.
  const me = all.find((t) => t.n === R.n);
  if (me && !(S.saw[me.n] > Date.parse(me.updated))) S.saw[me.n] = Date.parse(me.updated);
  const shown = all.filter((t) => !R.need || t.state === "needs-you");
  // A project is its group, not a filter.
  const tagsOf = (t) =>
    [every(t) ? "repeats" : !projOf(t) && kindOf(t), ...(t.labels || [])].filter(Boolean);
  const count = new Map();
  for (const t of shown) for (const k of new Set(tagsOf(t))) count.set(k, (count.get(k) || 0) + 1);
  if (!count.has(R.tag)) R.tag = "";
  const keys = [...count.keys()].sort((a, b) => count.get(b) - count.get(a)).slice(0, 10);
  const filter = (k) => {
    const n = k ? count.get(k) : shown.length;
    const b = btn([k ? named(k) : "All", h("small", `${n}`)], () => {
      R.tag = R.tag === k ? "" : k;
      drawList();
    });
    b.ariaPressed = String(R.tag === k);
    return b;
  };
  const rows = shown
    .filter((t) => `#${t.n} ${t.title.toLowerCase()}`.includes(q))
    .filter((t) => !R.tag || tagsOf(t).includes(R.tag))
    .sort((a, b) => need(b) - need(a) || Date.parse(b.updated) - Date.parse(a.updated));
  const tab = (l, c, closed, mine = false) => {
    const b = btn([l, c > 0 && h(mine ? "small.n" : "small", `${c}`)], () => {
      R.need = mine;
      R.tag = "";
      shut(closed);
      // Open and Needs you read the list now, as Closed does: no wait for the next refresh.
      if (!closed) tick();
    });
    b.ariaPressed = String(!R.shut === !closed && !R.need === !mine);
    return b;
  };
  // A PR waiting for you: read it here; the task it's for beside it.
  const rev = (p) =>
    h("p", to(p.n, `#${p.n} ${p.title}`), p.task && to(p.task, `Task #${p.task}`), ago(p.updated));
  const review = R.shut ? [] : L.review || [];
  const more = R.shut ? C?.more : R.old ? R.old.more : L.more;
  // A split task's parts done of all, as a thin bar (its width set from script, ADR 0066).
  const bar = ({ done, total }, i = h("i")) => {
    i.style.width = `${(100 * done) / total}%`;
    return [h("span.bar", i), h("span", `${done}/${total}`)];
  };
  // A row: a mark for its state, its title and age; then the state's word, its kind and number. A
  // split task's open parts fold under it, in order (ADR 0066): `#n` in S.fold is one shown open.
  const row = (t) => {
    const job = runs.get(t.n);
    // Its thread's turn only when it's this job's (by the run's id): a kept thread may be older.
    const turn = S.threads[t.n]?.task.running;
    const same = job && turn?.url.split("/").pop() === job.url.split("/").pop();
    const r = timed(t.staying, same && turn, job);
    // New wins over a guess from the thread kept here (its "Starting…" may be from before a reply).
    const fresh = !r && S.saw[t.n] && Date.parse(t.updated) > S.saw[t.n];
    const st = fresh && t.state !== "needs-you" ? h("span.st.fresh", "New") : status(t, r);
    const k = kindOf(t);
    const c = `a${R.n === t.n ? ".on" : ""}${t.state === "needs-you" ? ".need" : ""}${fresh ? ".fresh" : ""}`;
    // The row's state is its dot (its word on hover, and for a screen reader); the header says it.
    const mark = h(`i.mark.${st ? st.className.replace("st ", "") : t.state}`, {
      title: st ? st.textContent : WORD[t.state],
    });
    const meta = h("span.meta", st, k && h("span", named(k)), h("span", `#${t.n}`));
    const kids = t.parts ? all.filter((x) => x.parent === t.n).sort((a, b) => a.n - b.n) : [];
    const f = `#${t.n}`;
    const open = S.fold.includes(f);
    const sub =
      kids.length > 0 &&
      btn(
        [icon("down"), `${kids.length} part${kids.length > 1 ? "s" : ""}`],
        () => {
          S.fold = open ? S.fold.filter((x) => x !== f) : [...S.fold, f];
          keep();
          drawList();
        },
        ".fold.sub",
      );
    if (sub) sub.ariaExpanded = String(open);
    if (t.parts) meta.append(...bar(t.parts));
    return h(
      "li",
      h(
        c,
        { href: `#/t/${t.n}` },
        mark,
        h("span.t", bare(t.title)),
        h("time.age", ago(t.updated)),
        meta,
      ),
      sub,
      open && h("ul.rows.subs", kids.map(row)),
    );
  };
  const on = L.boxes.filter((b) => b.online);
  const boxes = on.map((b) => `${b.name} online · ${b.busy} of ${b.slots} busy`).join("; ");
  const late = (t) => !R.shut && every(t) && !need(t);
  const rest = rows.filter(late);
  const none =
    q || R.tag
      ? "No task matches."
      : R.need
        ? "Nothing needs you now."
        : R.shut
          ? "Nothing closed yet."
          : "Nothing open: start a new chat.";
  // The boxes' line opens Status & setup.
  const box = { href: "#/setup", title: "Status & setup" };
  const next = h(
    "div",
    h(`a.boxes${on.length ? ".live" : ""}`, box, boxes || "No box online: tasks wait"),
    h(
      "div.tabs",
      { role: "group", "aria-label": "Show" },
      tab("Open", R.shut ? 0 : all.length, false),
      tab("Needs you", R.shut ? 0 : needs, false, true),
      tab("Closed", 0, true),
    ),
    keys.length > 1 &&
      h("div.filters", { role: "group", "aria-label": "Filter" }, ["", ...keys].map(filter)),
    review.length > 0 && h("section.run", h("h2", "For review"), review.map(rev)),
    R.shut && !C
      ? ph()
      : [
          groups(
            rows.filter((t) => !late(t)),
            row,
            runs,
            q,
          ),
          rest.length > 0 && [
            h("a.group", { href: "#/repeats" }, "Repeats", h("small", "Manage")),
            h("ul.rows", rest.map(row)),
          ],
          !rows.length && h("p.quiet", none),
        ],
    more && btn(R.shut ? "Older closed tasks" : "Older tasks", olderTasks, ".earlier.older"),
  );
  // Put in only when it changed (a run's clock ticking doesn't count): a row isn't swapped under
  // a click for nothing.
  const key = next.innerHTML.replace(/(data-since="[^"]*">)[^<]*/g, "$1");
  if (key === R.key && $("#list").firstChild) return;
  R.key = key;
  $("#list").replaceChildren(...next.childNodes);
  M.workspace?.then((m) => m.redraw());
}

const stub = (n) => ({ task: { n, title: "", prs: [] }, messages: [], writable: true, ph: n > 0 });
const near = (m) => m.scrollHeight - m.scrollTop - m.clientHeight < 80;
const end = () =>
  Object.assign(R.v.msgs, { scrollTop: 1e9 }) && Object.assign(R.v.pill, { hidden: true });
const redraw = () => R.v && safe(() => drawThread(S.threads[R.v.n] || stub(R.v.n)));
const queue = (k) => {
  R.pend[k] ||= [];
  return R.pend[k];
};

/** Messages drawn at first in a thread; Earlier messages shows this many more, then reads older. */
const SHOW = 40;

function thread() {
  const n = R.n;
  const v = { n, head: h("header.head"), msgs: h("div.msgs", { role: "log" }), done: new Map() };
  // Something new below where you're reading: a small round button in the corner, gone at the end.
  const label = { type: "button", hidden: true, onclick: end, "aria-label": "New below" };
  v.pill = h("button.pill", label, icon("down"));
  v.pill.title = "New below";
  v.foot = h("div.foot", v.pill);
  v.box = h("section.view", v.head, v.msgs, v.foot);
  v.msgs.onscroll = () => {
    v.low = near(v.msgs);
    if (v.low) v.pill.hidden = true;
  };
  // A picture that loads late pushes the end down: still at the end, stay there.
  v.msgs.addEventListener("load", () => v.low && end(), true);
  set($("#main"), v.box);
  if (n) S.seen = S.seen.filter((x) => x !== n).concat(n);
  else R.pend[0] = queue(0).filter((p) => p.st === "fail");
  R.v = v;
  redraw();
}

// The open thread: only what's newer while a run is going.
async function pull(n) {
  const old = S.threads[n];
  const since = old?.task.running && old.messages.at(-1)?.at;
  const d = await get(
    `task/${n}${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    !!old && !R.woke,
  );
  if (!d) return;
  // Only what's newer, or the newest page with older ones loaded: kept with what's here.
  if (since || old?.page < d.page) {
    const all = new Map(old.messages.map((x) => [x.id, x]));
    for (const x of d.messages) all.set(x.id, x);
    Object.assign(d, { messages: [...all.values()], earlier: old.earlier, page: old.page });
  }
  S.threads[n] = d;
  keep();
  redraw();
}

// Redraws above where you're reading, and keeps you there.
function above() {
  const m = R.v.msgs;
  const below = m.scrollHeight - m.scrollTop;
  redraw();
  m.scrollTop = m.scrollHeight - below;
  R.v.pill.hidden = true;
}

// Earlier messages: the ones here not drawn yet, else the page of 100 before the oldest here.
async function older(n) {
  let t = S.threads[n];
  const reveal = (at) => Object.assign(R.v, { from: t.messages[Math.max(0, at - SHOW)]?.id });
  const at = t.messages.findIndex((x) => x.id === R.v?.from);
  if (at > 0) return reveal(at) && above();
  const d = await get(`task/${n}?page=${t.page - 1 || 1}`).catch(no);
  t = S.threads[n];
  if (!d || !t) return;
  const had = new Set(t.messages.map((x) => x.id));
  const got = d.messages.filter((x) => !had.has(x.id));
  t.messages = got.concat(t.messages);
  Object.assign(t, { earlier: d.earlier, page: d.page });
  keep();
  if (R.v?.n !== n) return;
  reveal(got.length);
  above();
}

const threadMenu = (t) => {
  const T = t.task;
  const n = T.n;
  const slug = T.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const top = `# #${n} ${T.title}\n\n${t.earlier ? `Earlier messages: ${T.url}\n\n` : ""}`;
  const md = t.messages.map((x) => `**${x.name}** · ${x.at}\n\n${x.md}`).join("\n\n---\n\n");
  const i = (k, l) => [icon(k), l];
  const gh = (u) => () => open(u, "_blank", "noopener");
  const task = !T.pr && t.writable;
  return [
    [i("open", "On GitHub"), gh(T.url)],
    task && runOf(T) && [i("x", "Stop the run"), () => stop(n)],
    T.pr && [i("code", "The changes"), gh(`${T.url}/files`)],
    [
      i("save", "Download the thread"),
      () => save(`#${n}-${slug.slice(0, 40)}.md`, `${top}${md}\n`),
    ],
    task && [i("repeat", "Run again"), () => say(n, "again")],
    task &&
      T.repeats &&
      T.open && [i("x", "Stop repeating"), () => confirm("Sure?") && say(n, "stop repeating")],
    task && T.repeats && !T.open && [i("repeat", "Resume"), () => say(n, "resume")],
  ];
};

function drawThread(t) {
  const v = R.v;
  const T = t.task;
  const n = T.n;
  if (v?.n !== n) return;
  const real = n && !t.ph;
  const was = near(v.msgs);
  const you = t.messages.filter((x) => x.who === "you").length;
  // Shipify's own PRs (their state is known) open here, to review; others on GitHub.
  const pr = (p, l = [`PR #${p.n}`, p.state].filter(Boolean).join(" · ")) =>
    p.state ? h("a.chip", { href: `#/t/${p.n}` }, l) : ext(p.url, l, ".chip");
  // The model once: on the box you write in, else here.
  const model = !t.writable && h("span.tag", said(S.menu, T.model));
  const run = real && runOf(T);
  const start = real && !run && starting(T, t);
  const k = !T.pr && kindOf(T);
  const all = totals(t);
  // Its state, number and kind, its runs added up (each reply's line has its own), its PRs.
  const kind = T.pr
    ? [h("span.tag", `PR · ${T.pr}`), T.for && to(T.for, `Task #${T.for}`)]
    : [
        status(T, run, true),
        h("span", `#${n}`),
        T.parent && to(T.parent, `Part of #${T.parent}`),
        k && h("span", named(k)),
        model,
        all.runs.length > 0 && h("span.sum", summary(all)),
        T.prs.map((p) => pr(p)),
      ];
  const tags = real && h("p.tags", kind);
  const more = real && moreBtn((e) => pop(e.currentTarget, threadMenu(t)));
  if (more) more.ariaLabel = "Task menu";
  // Close and Reopen in sight: the door changes the task as it writes the word, so it shows now.
  const flip =
    real &&
    t.writable &&
    !T.pr &&
    !T.repeats &&
    btn(
      [icon(T.open ? "check" : "undo"), h("span", T.open ? "Close" : "Reopen")],
      () => turn(T),
      ".btn.flip",
    );
  if (flip) flip.ariaLabel = T.open ? "Close" : "Reopen";
  const title = n ? (T.pr ? `#${n} ${T.title}` : bare(T.title)) : "New chat";
  set(v.head, back(), h("div.title", h("h2", title), tags), refreshBtn(), flip, more);
  // A project's task: its tabs above (ADR 0065). A split task: its Plan card under the header.
  const P = real && !T.pr && projOf(T);
  if (P && v.p !== P) {
    v.p = P;
    ws((w) => R.v === v && w.strip(v.box, P, n));
  }
  if (real && T.plan) lazy("plan")((m) => R.v === v && m.plan(v, t));
  // No plan this time (its read failed, or the parts were unlinked): no card left from before.
  else if (v.pk) {
    v.box.querySelector(".plan")?.remove();
    v.pk = undefined;
  }
  // A command's answer stays until the thread's newest message changes; a note, a minute.
  const live = (p) =>
    p.sys
      ? !n || (p.keep ? t.messages.at(-1)?.id === p.last : Date.now() - p.t < 6e4)
      : p.st !== "sent" || you <= p.base;
  R.pend[n] = queue(n).filter(live);
  let added = 0;
  const one = (x, i) => {
    const e = v.done.get(x.id);
    if (!e) added++;
    if (e?.k === x.html) return e;
    v.done.set(x.id, Object.assign(msg(x, i, n), { k: x.html }));
    return v.done.get(x.id);
  };
  // Your `stop` is in: the run reads it within a minute.
  const halt = run && /^\s*stop\W*$/i.test(t.messages.at(-1)?.md);
  const work = run
    ? h("div.msg.work", halt ? dot("working", "Stopping…") : working(run), ext(run.url, "Watch it"))
    : start && h("div.msg.work", start());
  // The newest SHOW are drawn, then from the oldest drawn on (`v.from`), whatever comes after it.
  let cut = t.messages.findIndex((x) => x.id === v.from);
  if (cut < 0) cut = Math.max(0, t.messages.length - SHOW);
  v.from = t.messages[cut]?.id;
  const earlier = (cut || t.earlier) && btn("Earlier messages", () => older(n), ".earlier");
  const last = t.messages.at(-1)?.reply;
  const wait = R.pend[n].some((p) => !n || !p.keep);
  // A run that stopped before it finished (ADR 0040): nothing starts it but your `continue`.
  const stopped =
    T.state === "stuck" &&
    !resumed(t) &&
    h(
      "p.links.quick",
      btn("Continue", () => say(n, "continue"), ".btn.answer"),
    );
  const words = !run && !wait && (stopped || (last && quickWords(T, last)));
  const msgs = t.ph ? ph() : t.messages.slice(cut).map((x, i) => one(x, i + cut));
  set(v.msgs, earlier, msgs, !n && !wait && starts(), R.pend[n].map(pend), words, work);
  if (!v.drawn || was) end();
  else if (added && !near(v.msgs)) v.pill.hidden = false;
  v.low = near(v.msgs);
  v.drawn = !t.ph;
  if (v.w !== t.writable) {
    v.w = t.writable;
    v.seen = T.model;
    v.co = {
      menu: S.menu,
      task: n || undefined,
      model: T.model,
      words: R.draft || R.drafts[n],
      root: v.box,
      send,
      after: redraw,
    };
    R.draft = "";
    const changes = ext(`${T.url}/files`, "The changes");
    const note = T.pr
      ? h("p.note", "Read it here. ", changes, " and the merge are on GitHub.")
      : h("p.note", "This task doesn't take words from here: ", ext(T.url, "open it on GitHub"));
    set(v.foot, v.pill, t.writable ? composer(v.co) : note);
    if (R.ask && v.co.attach) v.co.attach(R.ask);
    R.ask = 0;
  } else if (real && v.co && v.seen !== T.model) {
    // The task's model as GitHub has it, once it changes: a pick here stays till then.
    v.seen = v.co.model = T.model;
    v.co.label();
  }
  // Words sent while a run works are taken in before it answers (tasks.md): the box says so.
  // While it works, an empty box's send button stops it, as in other chats.
  const ta = n && v.foot.querySelector("textarea");
  if (ta) ta.placeholder = run || start ? "Reply · read before it answers" : "Reply";
  if (!v.co?.state) return;
  v.co.stop = run && !halt && !wait && T.open && (() => stop(n));
  v.co.state();
}

// A task's runs added up from their replies' lines (time, tokens, cost when the agent knew it):
// no read of its own.
const totals = (t) => {
  const runs = t.messages.filter((x) => x.reply?.run).map((x) => x.reply.run);
  const sum = (k) => runs.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    runs,
    secs: sum("secs"),
    tokens: sum("tokens"),
    usd: sum("usd"),
    plan: runs.some((r) => r.plan),
  };
};
const took = (s) =>
  s < 60 ? `${s | 0}s` : `${(s / 60) | 0}m ${String((s % 60) | 0).padStart(2, "0")}s`;
const kilo = (n) =>
  n < 1e3 ? `${n}` : n < 1e6 ? `${+(n / 1e3).toFixed(1)}k` : `${+(n / 1e6).toFixed(1)}M`;
const money = (r) =>
  r.usd ? (r.usd < 0.01 ? "under $0.01" : `$${r.usd.toFixed(2)}`) : r.plan ? "your plan" : "";
const summary = (a) =>
  [
    `${a.runs.length} run${a.runs.length > 1 ? "s" : ""}`,
    money(a),
    took(a.secs),
    a.tokens > 0 && `${kilo(a.tokens)} tokens`,
  ]
    .filter(Boolean)
    .join(" · ");

// The newest reply's buttons, as every chat has them: each sends its words (its question's short
// answers, then the words it names; Another model opens the chip), or said on GitHub.
function quickWords(T, r) {
  const now = { close: T.open, reopen: !T.open };
  const answers = (r.question && r.choices) || [];
  const tap = (w) => (w === "/use" ? R.v?.co?.pick?.() : w in now ? turn(T) : say(T.n, w));
  const here = (r.buttons || [])
    .filter((b) => now[b.words] ?? true)
    .map((b) =>
      btn(b.label, () => tap(b.words), answers.includes(b.words) ? ".btn.answer" : ".btn"),
    );
  return here.length && h("p.links.quick", here);
}

// A new chat's starters, each filling the box you write in.
function starts() {
  const says = Object.fromEntries(S.menu?.commands || []);
  const fill = (w, file) => () => R.v?.co?.fill(w, file);
  const one = (k, t, about, f) => btn([icon(k), h("b", t), h("small", about)], f, ".start");
  // Your repos as the record keeps them (ADR 0047): Shipify's own first.
  const p = [...new Set(["shipify", ...(S.menu?.repos || [])])].map((x) => [x, fill(`${x}: `)]);
  const file = fill("Summarize this: ", 1);
  const grid = h(
    "div.starts",
    one("chat", "Ask anything", "Plain words are enough", fill("")),
    one("file", "About a file", "A PDF, photo or document: a summary, the key points", file),
    one("code", "Change a repo", says.change, (e) => pop(e.currentTarget, ["Which one?", ...p])),
    one("app", "New app", says.new, fill("new: ")),
    one("pin", "Remember", says.remember, fill("remember: ")),
    one("repeat", "Repeat", says.repeat, () => go("#/repeats")),
  );
  return h("div.hello", h("h3", "What should Shipify do?"), grid);
}

// `close` or `reopen` alone changes the task's state: a quiet line in the thread, not words.
const TURN = /^\s*(close|reopen)\W*$/i;
const turned = (w, s, done = true) => {
  const c = /^\s*close/i.test(w);
  return h("p.sys", `${c ? (done ? "Closed" : "Closing…") : done ? "Reopened" : "Reopening…"}${s}`);
};

function msg(x, i, n) {
  if (x.who !== "shipify" && !x.files.length && TURN.test(x.md))
    return turned(x.md, `${x.who === "other" ? ` by ${x.name}` : ""} · ${ago(x.at)}`);
  const r = x.reply;
  const md = Object.assign(h("div.md"), { innerHTML: x.html, onclick: zoom });
  draw(md, x.md);
  const det =
    x.details && Object.assign(h("div.md.details", { hidden: true }), { innerHTML: x.details });
  const dl = () => save(`#${n}-reply-${i}.md`, x.md);
  const menu = () =>
    pop(more, [
      [[icon("copy"), "Copy"], () => copy(x.md)],
      [[icon("save"), "Download"], dl],
    ]);
  const more = moreBtn(menu, ".more");
  more.ariaLabel = "More";
  const fold = (e) =>
    Object.assign(e.currentTarget, { ariaExpanded: det.hidden }) &&
    Object.assign(det, { hidden: !det.hidden });
  const line = r?.brief && btn([r.brief, det && icon("down")], det && fold, ".runline");
  const links =
    r?.links.length > 0 &&
    h(
      "p.links",
      r.links.map(([l, u]) => ext(u, l, ".btn")),
    );
  const ask = r?.question && h("p.ask", r.question);
  const who = x.who === "other" && h("p.who", x.name);
  // Under your words, as in any chat: the model you picked for it, when, and a tick once a run
  // has read it.
  const use = x.use && h("span.use", said(S.menu, x.use.replace(/^use /, "")));
  const seen = x.read && h("span.seen", { title: "A run read it" }, icon("seen"));
  const at = h("time", { title: new Date(x.at).toLocaleString() }, ago(x.at));
  const foot = h("footer", use, at, seen, more);
  return h(`article.msg.${x.who}`, who, md, x.files.map(file), links, ask, line, det, foot);
}

function file(f) {
  const u = f.src;
  const s = f.size ? ` · ${size(f.size)}` : "";
  const gone = () => h("span.chip.gone", `${f.name} · no longer kept`);
  if (!u) return h("span.chip.gone", f.name);
  if (!IMG.test(f.type))
    return btn([icon("file"), h("span", `${f.name}${s}`)], () => see(f), ".chip");
  // A picture: yours from here (kept 7 days) or from Telegram (read through the edge).
  const i = h("img", { src: u, alt: f.name, loading: "lazy" });
  const b = btn(i, zoom, ".pic");
  i.onerror = () => b.replaceWith(gone());
  b.ariaLabel = `Open ${f.name}`;
  return b;
}
// A picture (a diagram too) opens full size here, not on GitHub.
const pic = (src, alt) => h("img", { src, alt });
function zoom(e, i = e.target) {
  if (i.tagName !== "IMG") return;
  e.preventDefault();
  view(pic(i.src, i.alt));
}
// The viewer is a step in the history: Back closes it.
function view(...c) {
  set($("#view"), c);
  $("#view").showModal();
  history.pushState({ view: 1 }, "");
}
// A file opens here, never in a new tab: in the doc pane, beside the thread (workspace.js).
const see = (f) => ws((w) => w.doc(f));
// Its Ask about this: the file goes with your next message, here or in a new chat.
const ask = (f) => {
  if (R.v?.co?.attach) return R.v.co.attach(f);
  R.ask = f;
  go("#/new");
};

// A ```mermaid block is drawn in /draw/, a sandboxed frame (Mermaid never runs here), and comes
// back as SVG, shown as a picture (one runs no script). Its source stays if it doesn't draw.
const MER = /```mermaid.*\n([\s\S]*?)```/g;
function draw(md, text) {
  const src = [...text.replace(/\r/g, "").matchAll(MER)].map((m) => m[1].trim());
  for (const pre of md.querySelectorAll("pre")) {
    const s = pre.textContent.trim();
    if (!src.includes(s)) continue;
    const at = `/draw/#${encodeURIComponent(s)}`;
    const f = h("iframe.draw", { src: at, sandbox: "allow-scripts" });
    f.drawn = (svg) => pre.replaceWith(pic(`data:image/svg+xml,${encodeURIComponent(svg)}`, s));
    pre.before(f);
  }
}
addEventListener("message", (e) => {
  const f = [...document.querySelectorAll(".draw")].find((x) => x.contentWindow === e.source);
  const svg = e.data?.draw;
  if (!f || typeof svg !== "string") return;
  f.remove();
  if (svg.startsWith("<svg") && svg.length < 2e6) f.drawn(svg);
});

function pend(p) {
  // A command's answer (/help, /ping…) reads as Shipify's, lines kept; a note stays a small line.
  if (p.sys) return p.keep ? h("article.msg", h("div.md.pre", p.sys)) : h("p.sys", p.sys);
  const b = p.b;
  const fail = [h("span.st.bad", p.err), btn("Retry", () => sendIt(p))];
  if (TURN.test(b.words) && !b.files.length)
    return p.st === "fail" ? h("p.sys", fail) : turned(b.words, "", p.st === "sent");
  const st = p.st === "fail" ? fail : h("em", p.st === "sent" ? p.text : "Sending…");
  const pics = p.prev.map((u) => h("img.thumb", { src: u, alt: "" }));
  const docs = b.files.length > p.prev.length && b.files.map((f) => h("span.chip", f.name));
  const use = b.use && h("span.use", said(S.menu, b.use));
  return h("article.msg.you", h("div.md.pre", b.words), pics, docs, h("footer", use, st));
}

// Sends a message: shown at once, kept with Retry if it fails; the id is made once.
function send(b, prev = [], note = "") {
  const L = queue(b.task || 0);
  const base = (S.threads[b.task]?.messages || []).filter((x) => x.who === "you").length;
  L.push({ b, prev, note, base: base + L.filter((p) => p.b).length });
  sendIt(L.at(-1));
}
const say = (n, words) => send({ id: uid(), task: n, words, files: [] });
async function sendIt(p) {
  p.st = "sending";
  redraw();
  try {
    const s = await api("send", p.b);
    const n = p.b.task || 0;
    const k = s.task || n;
    bar("off");
    Object.assign(p, { st: "sent", text: s.task ? `Sent · #${s.task}` : "Sent" });
    // What you sent isn't news to you (a few seconds' grace for the clocks; a reply takes longer).
    S.saw[s.task || n] = Date.now() + 5e3;
    if (k !== n) {
      R.pend[n] = queue(n).filter((x) => x !== p);
      p.base = 0;
      queue(k).push(p);
      go(`#/t/${k}`);
    }
    if (p.note || !s.task) {
      const last = S.threads[k]?.messages.at(-1)?.id;
      queue(k).push({ sys: p.note || s.text, keep: !p.note, last, t: Date.now() });
    }
    setTimeout(tick, 5500);
  } catch (e) {
    Object.assign(p, { st: "fail", err: why(e) });
    if (e.off) bar("off", OFF);
    // Not sent for want of a line (offline, or GitHub not reached: nothing was saved): sent again
    // by itself, with the same id (so never twice), at most three times, and when you're online
    // again. Retry stays.
    const late = e.off || e.status === 503;
    if (late) p.again = (p.again || 0) + 1;
    if (late && p.again <= 3) setTimeout(() => p.st === "fail" && sendIt(p), 5e3 * 2 ** p.again);
  }
  redraw();
}
const again = () => {
  for (const L of Object.values(R.pend))
    for (const p of L) if (p.st === "fail" && p.again <= 3) sendIt(p);
};

async function page(title, p, draw, top = no) {
  const body = h("div.stack", R[p] ? draw(R[p]) : ph());
  R.page = { p, body, draw };
  const head = h("header.head", back(), h("h2.title", title), refreshBtn());
  set($("#main"), h("section.view", head, h("div.page", top(), body)));
  const d = await get(p).catch(no);
  if (!d) return;
  R[p] = d;
  if (body.isConnected) set(body, draw(d));
}
// Words sent from a button: it waits while they go, a failure keeps a Retry (with the same id).
async function quick(task, words, out, b, id = uid()) {
  if (b) b.disabled = true;
  const s = await get("send", { id, task, words, files: [] }).catch((e) => {
    if (!e.off) bar("err", `${why(e)} · Retry`, () => bar("err") || quick(task, words, out, b, id));
  });
  if (b) b.disabled = false;
  if (s && out) out.textContent = s.text;
  else if (s) told(s.text);
  return s;
}
// After a change made on a page, the page shows it at once, then reads again (ETag: no change, no
// redraw): what you did is there without leaving it.
async function reread() {
  const v = R.page;
  if (!v?.body.isConnected) return;
  set(v.body, v.draw(R[v.p]));
  await fresh();
}
// The page on screen read again, quietly: redrawn only when it changed.
async function fresh() {
  const v = R.page;
  if (!v?.body.isConnected) return;
  const d = await get(v.p, undefined, true).catch(no);
  if (!d) return;
  R[v.p] = d;
  if (v.body.isConnected) set(v.body, v.draw(d));
}
const act = (l, n, w, sure = false, c = "", done = reread) =>
  btn(
    l,
    async (e) => (!sure || confirm("Sure?")) && (await quick(n, w, 0, e.currentTarget)) && done(),
    c,
  );
const out = () => h("p.hint", { "aria-live": "polite" });
// An item on a page (Repeats, Notebook, Files): its name over a line about it.
const what = (name, ...about) => h("div.what", name, h("span.meta", about));
const live = (on) => dot(on ? "ok" : "closed", on ? "on" : "paused");

const rep = (r) => {
  const on = R.turned[r.n]?.open ?? r.open;
  const next = on && r.next && `next ${until(r.next)}`;
  const flip = (open) => () => moved(r.n, open, { title: r.title, from: "repeat" }) || reread();
  const pause = on
    ? act("Pause", r.n, "close", false, "", flip(false))
    : act("Resume", r.n, "resume", false, "", flip(true));
  const change = btn("Change", () => start("Change it to: ", `#/t/${r.n}`));
  const acts = h("span.acts", act("Run now", r.n, "again"), pause, change);
  // Stopped: it leaves at once (its run takes the label off in a minute or so).
  const stopped = () => {
    R.gone[r.n] = Date.now();
    flip(false)();
  };
  acts.append(act("Stop", r.n, "stop repeating", true, ".danger", stopped));
  return [what(to(r.n, `#${r.n} ${r.title}`), live(on), meta(r.every, next)), acts];
};
const recipe = (r) => {
  const next = !r.paused && r.next && `next ${until(r.next)}`;
  const at = r.task ? to(r.task, `Task #${r.task}`) : ext(r.url, "On GitHub", ".chip");
  // A recipe is a file: for good, it's a change that removes it, which you send and then merge.
  const gone = r.paused
    ? btn("Remove", () => start(`shipify: remove the recipe ${r.name} (recipes/${r.name}.md)`))
    : "";
  return [what(h("b", r.name), live(!r.paused), meta(r.every, next)), h("span.acts", gone, at)];
};
const newRepeat = (e) => e.currentTarget.replaceWith(repeatForm(S.menu, (n) => go(`#/t/${n}`)));
const isOn = (r) => R.turned[r.n]?.open ?? r.open;
// One you stopped here, for five minutes: back after that only if the stop didn't take.
const shown = (r) => !(Date.now() - (R.gone[r.n] || 0) < 3e5);
// What runs, then what's paused, folded away: a stopped repeat isn't here at all.
const repeats = () =>
  page(
    "Repeats",
    "repeats",
    (d) => {
      const mine = d.repeats.filter(shown);
      const paused = [...mine.filter((r) => !isOn(r)), ...d.recipes.filter((r) => r.paused)];
      return [
        h("h3", "Your repeats"),
        list(mine.filter(isOn), rep, "Nothing repeats now."),
        h("h3", "Waiting"),
        list(d.waiting ?? [], (r) => what(to(r.n), r.every), "Nothing waits."),
        h("h3", "Recipes"),
        list(
          d.recipes.filter((r) => !r.paused),
          recipe,
          "No recipes running.",
        ),
        paused.length
          ? h(
              "details.paused",
              h("summary", `Paused (${paused.length})`),
              list(paused, (x) => ("n" in x ? rep(x) : recipe(x)), ""),
            )
          : "",
      ];
    },
    () => btn([icon("plus"), "New repeat"], newRepeat, ".primary"),
  );

const forget = (p) => {
  const w = prompt("Words to forget", p.first)?.trim();
  if (w) quick(undefined, `forget: ${w}`).then((s) => s && reread());
};
const note = (p) => [
  what(ext(p.url, p.topic), meta(`${p.lines} lines`, p.first)),
  btn("Remove", () => forget(p), ".danger"),
];
const addNote = () => {
  const topic = h("input");
  const text = h("textarea", { rows: 2 });
  const o = out();
  const f = h("form.card.form", h("label", "Topic (optional)", topic), h("label", "Note", text));
  f.append(h("button.primary", "Add"), o);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const w = text.value.trim();
    const tp = topic.value.trim();
    if (!w) o.textContent = "Write the note.";
    else if (await quick(undefined, `remember${tp && ` ${tp}`}: ${w}`, o)) {
      text.value = "";
      reread();
    }
  };
  return f;
};
const notebook = () =>
  page("Notebook", "notebook", (d) => [list(d.pages, note, "The notebook is empty.")], addNote);

// Files: every project's docs, sorted as a project's page sorts its own (workspace.js).
const files = () => ws((w) => w.files());

// Status & setup: setup.js, loaded when it opens.
const setup = () => lazy("setup")((m) => m.setup());
// Notifications (ADR 0050): sw.js shows them and takes shares. Sent again on opening if the
// subscription or the edge's key changed.
const SW = navigator.serviceWorker;
const reg = SW?.register("sw.js").catch(no);
const b64 = (k) =>
  Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = async (u) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(u)))]
    .slice(0, 4)
    .map((b) => (b + 256).toString(16).slice(1))
    .join("");
async function notify(on) {
  const pm = (await reg).pushManager;
  const k = S.menu?.notifications?.key;
  let s = await pm.getSubscription();
  if (!on) {
    S.note = "";
    keep();
    return s && get("push", { off: s.endpoint }).finally(() => s.unsubscribe());
  }
  if ((await Notification.requestPermission()) !== "granted")
    throw Error("Blocked: allow them in the site's settings, or the phone's");
  // An older key's: made again (the old is dropped once gone).
  if (s && !S.note?.endsWith(` ${k}`)) s = (await s.unsubscribe()) && null;
  s ||= await pm.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k) });
  await get("push", { on: s.toJSON() });
  S.note = `${s.endpoint} ${k}`;
  keep();
}
const sync = async () => {
  const pm = (await reg)?.pushManager;
  const k = S.menu?.notifications?.key;
  let s = await pm?.getSubscription();
  if (k && S.note && S.note !== `${s?.endpoint} ${k}` && Notification.permission === "granted") {
    await notify(true);
    s = await pm.getSubscription();
  }
  R.mine = s && (await hex(s.endpoint));
};
function route() {
  const [, p = "", n = ""] = location.hash.match(/^#\/(\w*)\/?(\d*)/) || [];
  R.n = p === "t" ? +n : 0;
  R.proj = p === "p";
  // What you were writing in a task (or a new chat) waits there till you come back, as in a chat.
  const ta = R.v?.foot.querySelector("textarea");
  if (ta) R.drafts[R.v.n] = ta.value;
  R.v = null;
  document.body.classList.toggle("in", !!p);
  // A thread (or a new chat) takes the whole phone; a page keeps the tabs.
  document.body.classList.toggle("talk", p === "t" || p === "new");
  for (const a of $("#pages").children)
    a.ariaCurrent = a.dataset.p === (p === "t" || p === "new" ? "" : p) ? "page" : null;
  $(".pop")?.remove();
  // Nothing picked is a new chat: its starters, ready to type in.
  const proj = () => ws((w) => w.project(decodeURIComponent(location.hash.slice(4))));
  safe({ repeats, notebook, files, setup, p: proj }[p] || thread);
  safe(drawList);
  tick();
}

const gotList = (d) => {
  R.at = Date.now();
  if (!d) return;
  // A close or reopen of yours the list now agrees with (or five minutes on) is the list's again.
  for (const [n, v] of Object.entries(R.turned))
    if (v.open === d.tasks.some((t) => t.n === +n) || Date.now() - v.at > 3e5) delete R.turned[n];
  S.list = d;
  ver(d.version);
  keep();
  safe(drawList);
  redraw();
};
// On a phone the list and a page take turns: only what's on screen is asked for, the list while
// your words wait for a run, to show it start, and once on coming back (a newer page shows there).
const WIDE = matchMedia("(min-width: 800px)");
async function tick() {
  clearTimeout(R.timer);
  if (document.hidden) return;
  // The thread on screen: its notification leaves the tray.
  const tag = `t${R.n}`;
  reg
    ?.then((r) => r?.getNotifications({ tag }))
    .then((l) => {
      for (const x of l || []) x.close();
    }, no);
  const me = ++R.tk;
  let next = 3e4;
  // Whatever happens in a round, the next one comes: the page never stops updating.
  try {
    const t = S.threads[R.n];
    const wait = (t?.task.open || t?.task.wakes) && !t.task.running && waits(t);
    // A project's page shows its tasks: the list is on screen there too.
    const listed =
      WIDE.matches || !document.body.classList.contains("in") || wait || R.woke || R.proj;
    await Promise.all([
      listed && get("list", undefined, !!S.list).then(gotList, no),
      R.n && pull(R.n).catch(gone),
    ]);
    const run = S.threads[R.n] && runOf(S.threads[R.n].task);
    next = run ? 5e3 : wait ? 1e4 : 3e4;
    // GitHub not read: 5s, 10s, 20s, 40s, then each minute.
    if (R.down) next = Math.min(6e4, 5e3 * 2 ** R.miss++);
    else R.miss = 0;
  } catch (e) {
    oops(e);
  }
  if (me !== R.tk) return;
  R.woke = false;
  R.timer = setTimeout(tick, next);
}
// Back from away (another app, the phone asleep, the tab again) or ↻: what's on screen reads again
// at once, a page too, and a newer page loads by itself (ver); the times shown ("5m") are drawn
// again even when nothing else changed. Away, nothing is asked for.
async function wake() {
  if (document.hidden) return clearTimeout(R.timer);
  R.woke = true;
  safe(drawList);
  redraw();
  await Promise.all([tick(), fresh()]);
}
// A thread that can't be read (no such task) says so, not a placeholder for good.
function gone(e) {
  const v = R.v;
  if (v?.n === R.n && !S.threads[R.n] && !e.off) set(v.msgs, h("p.quiet", why(e)));
}

if (!location.pathname.endsWith("/"))
  history.replaceState(null, "", `${location.pathname}/${location.hash}`);
// The pages: a row under the list on a PC, tabs at the foot on a phone (Tasks there too).
set(
  $("#pages"),
  [
    ["chat", "Tasks", ""],
    ["repeat", "Repeats"],
    ["book", "Notebook"],
    ["folder", "Files"],
    ["pulse", "Setup", "setup"],
  ].map(([k, l, p = l.toLowerCase()]) =>
    h(`a${p ? "" : ".home"}`, { href: `#/${p}`, "data-p": p }, icon(k), h("span", l)),
  ),
);
// Back: Tasks is under every page; a tab from another page takes its place.
$("#pages").onclick = (e) => {
  const a = e.target.closest("a");
  if (!a || !location.hash.replace(/^#\/?/, "")) return;
  e.preventDefault();
  if (a.dataset.p) location.replace(a.href);
  else history.back();
};
$("#new").prepend(icon("plus"));
$("#new").before(refreshBtn());
$(".search").prepend(icon("search"));
$("#q").oninput = drawList;
$("#q").onkeydown = (e) => {
  const m = /^#(\d+)$/.exec(e.target.value.trim());
  if (e.key === "Enter" && m) go(`#/t/${m[1]}`);
};
// Ctrl+K (⌘K) finds a project, a task or a doc; Alt+1…9 picks a project's tab.
addEventListener("keydown", (e) => {
  const tab = e.altKey && /^Digit[1-9]$/.test(e.code) && $(".wtabs");
  if ((e.ctrlKey || e.metaKey) && e.key === "k") ws((w) => w.quick());
  else if (tab) ws((w) => w.pick(+e.code.slice(5)));
  else return;
  e.preventDefault();
});
$("#view").onclick = (e) =>
  (e.target === e.currentTarget || e.target.tagName === "IMG") && $("#view").close();
$("#view").onclose = () => history.state?.view && history.back();
addEventListener("popstate", () => $("#view").open && $("#view").close());
addEventListener("hashchange", route);
document.onvisibilitychange = wake;
addEventListener("online", () => {
  again();
  tick();
});
addEventListener("offline", () => bar("off", OFF));
// The menu (agents, models, commands, repos): what's kept draws at once; a newer one is put in
// where it shows, never by drawing the page again (what you're typing stays).
get("menu").then((d) => {
  if (!d) return;
  S.menu = d;
  ver(d.version);
  keep();
  const co = R.v?.co;
  if (co) safe(() => Object.assign(co, { menu: d }).label() || co.state());
  safe(drawList);
  redraw();
  sync().catch(no);
}, no);
// Opened on a page or a thread with nothing behind: the list goes under, so Back stays in.
if (history.length < 2 && /^#\/\w/.test(location.hash)) {
  const at = location.hash;
  history.replaceState(null, "", "#/");
  history.pushState(null, "", at);
}
route();
// From the worker: a push (read now), a tap on one (open its thread), a share (into New chat).
if (SW)
  SW.onmessage = ({ data: m }) => {
    const co = R.v?.co;
    if (m === "read") wake();
    else if (m?.open) {
      go(m.open);
      wake();
    } else if (m?.shared && co) {
      co.fill(
        [R.v.foot.querySelector("textarea")?.value, m.shared.text].filter(Boolean).join("\n"),
      );
      co.add(m.shared.files);
    }
  };
if (location.hash.endsWith("?shared")) {
  history.replaceState(null, "", "#/new");
  SW?.controller?.postMessage("shared?");
}
