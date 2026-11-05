// @ts-check
// Shipify chat: the list, threads, the pages, downloads, polling and the copy kept in the browser.
import { $, api, cap, composer, h, icon, pop, said, set, size, timed, uid } from "./compose.js";

// A guest, at /guest/ (ADR 0071): only theirs shows, kept apart from yours in this browser.
const GUEST = location.pathname.startsWith("/guest");
// Kept in the browser: the rest under KEY, each thread under a key of its own (TK + its number),
// written only when it changed, when the page is idle (or as it's left).
const KEY = GUEST ? "shipify-g" : "shipify-c";
const TK = GUEST ? "shipify-gt" : "shipify-t";
const OFF = "Offline: showing what it last had";
const LS = localStorage;
const got = (k) => {
  try {
    return JSON.parse(LS.getItem(k) || "null");
  } catch {}
};
/** @type {Record<string, any>} */
const S = { list: null, menu: null, threads: {}, seen: [], saw: {}, fold: [] };
// The copy kept whole under one key till 2026-11: split once, then gone.
const was = GUEST ? null : got("shipify-chat");
Object.assign(S, was || got(KEY), { threads: was?.threads || {} });
// A project's tabs went (ADR 0069): the ones a browser saved go with the next write.
delete S.tabs;
const THREAD = new RegExp(`^${TK}\\d+$`);
for (const k of Object.keys(LS)) {
  const t = THREAD.test(k) && got(k);
  if (t) S.threads[k.slice(TK.length)] = t;
}
// A reply's Markdown isn't kept, only its HTML (what's drawn): its words stand in for it till the
// thread is read whole again (`r`). A diagram's is kept, to draw it.
for (const t of Object.values(S.threads))
  for (const x of t.messages)
    if (x.md == null) {
      x.md = x.html.replace(/<[^>]+>/g, "");
      t.r = x.r = 1;
    }
/** @type {Record<string, any>} */
const R = { pend: {}, n: 0, tk: 0, busy: 0, turned: {}, gone: {}, st: {}, miss: 0, pj: {} };
const dirty = new Set();
const slim = (t) => ({
  ...t,
  messages: t.messages.map((x) =>
    x.who === "shipify" && !x.md.includes("```mermaid") ? { ...x, md: undefined } : x,
  ),
});
function flush() {
  R.idle = 0;
  S.seen = S.seen.slice(-30);
  for (const n in S.threads) if (!S.seen.includes(+n)) dirty.add(n) && delete S.threads[n];
  for (const n in S.saw) if (!S.list?.tasks.some((t) => t.n === +n)) delete S.saw[n];
  try {
    for (const n of dirty) {
      const t = S.threads[n];
      if (n === "") LS.setItem(KEY, JSON.stringify({ ...S, threads: 0 }));
      else if (t) LS.setItem(TK + n, JSON.stringify(slim(t)));
      else LS.removeItem(TK + n);
      dirty.delete(n);
    }
  } catch {
    S.seen = S.seen.slice(-5);
  }
}
/** Marks what changed (a thread's number, else the rest) to be written when the page is idle. */
const keep = (n = "") => {
  dirty.add(`${n}`);
  R.idle ||= (self.requestIdleCallback || setTimeout)(flush, { timeout: 2e3 });
};
if (was && !GUEST) {
  LS.removeItem("shipify-chat");
  for (const n in S.threads) keep(n);
  keep();
}
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
// The top bar moves only while you wait. GitHub unread: a poll tries again, slower each time
// (tick); after a minute, or on the edge's last good copy (`stale`), a calm line says so. A read
// you waited for that failed says why, till the next good one.
const DOWN = "Can't reach GitHub · retrying";
async function get(p, b, quiet = false, k = p) {
  if (!quiet && !R.busy++) document.body.classList.add("busy");
  try {
    const j = await api(p, b, k);
    if (j) R.st[p] = j.stale;
    if (R.st[p]) R.down ||= Date.now();
    else R.down = 0;
    bar("off", R.st[p] && DOWN);
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
// The clocks on screen ("Working · 2m 05s", "5m"), each second while shown; unchanged, unwritten.
function tock() {
  const l = document.querySelectorAll("[data-since],[data-at]");
  if (document.hidden || !l.length) R.clk = clearInterval(R.clk);
  for (const e of l) {
    const s = e.dataset.since;
    const t = s ? `· ${dur(s)}` : ago(e.dataset.at);
    if (e.textContent !== t) e.textContent = t;
  }
}
// A clock's text, left out where a redraw compares what it would draw.
const CLK = /(data-(?:since|at)="[^"]*">)[^<]*/g;
const clock = () => (R.clk ||= !document.hidden && setInterval(tock, 1e3));

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
    : // Its clock hidden from a screen reader, which would say it each second.
      h(
        "span.st.working",
        "Working",
        h("span", { "aria-hidden": "true", "data-since": r.since }, `· ${dur(r.since)}`),
      );
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
// Parts loaded when first needed (ADR 0065), lent what they read here. One that didn't load
// (offline) says so, and loads on the next tap.
const M = {};
const LOST = "Part of the page didn't load: tap to reload";
const lazy = (k) => (f) => {
  M[k] ||= import(`./${k}.js`).then(
    async (m) => {
      const lent = { S, R, GUEST, go, get, keep, start, bare, named, projOf, runs, ago, turn };
      const time = { until, secs, to, save };
      const ui = { page, what, meta, list, btn, view, ext, mark, dot, out, copy, quick, fresh };
      const does = { ask, join, reg, sync, say, lazy, into, told, moved, reread, redraw, lost };
      await m.init({ ...lent, ...time, ...ui, ...does });
      return m;
    },
    (e) => {
      delete M[k];
      throw Object.assign(e, { lost: true });
    },
  );
  return M[k].then(f).catch((e) => (e?.lost ? bar("err", LOST, reload) : oops(e)));
};
const ws = lazy("workspace");
// The tasks a run works on now, as the list shows them.
const runs = () => new Set((S.list?.running || []).filter(goes).map((r) => r.n));
// A run the list shows, till a reply after its start (what's left is its end, or a run for words
// read already); your words after it, or with no 👀 yet, count again. One for a word that starts
// no agent (`close`…) isn't shown. One argument: `filter` passes more.
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
// A project's Close asks first (ADR 0069).
function turn(T) {
  if (T.open && T.project?.ask && !confirm(T.project.ask)) return;
  T.open = !T.open;
  say(T.n, T.open ? "reopen" : "close");
  moved(T.n, T.open, { title: T.title, from: T.from, url: T.url });
}
// Your close, reopen, pause or resume shows at once in every view, and holds till the lists agree
// (GitHub's can lag a minute), five minutes at most.
function moved(n, open, seen = {}) {
  const state = open ? "open" : "closed";
  const copies = [...(S.list?.tasks || []), ...(R.old?.tasks || []), ...(R.closed?.tasks || [])];
  for (const x of copies) if (x.n === n) x.state = state;
  const t = copies.find((x) => x.n === n) || seen;
  R.turned[n] = { open, at: Date.now(), t: { ...t, n, state, updated: new Date().toISOString() } };
  safe(drawList);
}
const stop = (n) => confirm("Stop this run? What it committed is kept.") && say(n, "stop");
// Your words waiting for a run (in the last 10 minutes; a project's own start none): the list is
// asked too, to see it start.
const waits = (t) => {
  const m = t?.messages.at(-1);
  return m?.who === "you" && !m.norun && secs(m.at) < 600;
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
const free = (u) => URL.revokeObjectURL(u);
const save = (name, text, u = URL.createObjectURL(new Blob([text]))) => {
  h("a", { href: u, download: name }).click();
  setTimeout(() => free(u), 6e4);
};
// Called in the tap itself (Safari asks that); no clipboard here (not https) fails as a refusal does.
const copy = async (t) => {
  try {
    await navigator.clipboard.writeText(t);
    told("Copied");
  } catch {
    told("Couldn't copy: select it and copy it yourself");
  }
};
const li = (f) => (x) => h("li", f(x));
const list = (a, f, none) => (a.length ? h("ul.items", a.map(li(f))) : h("p.quiet", none));
const meta = (...a) => h("small", a.filter(Boolean).join(" · "));
const btn = (l, f, c = "") => h(`button${c}`, { type: "button", onclick: f }, l);
const moreBtn = (f, c = ".icon") => btn(icon("more"), f, c);
// A round button with only its icon: its name said on hover and to a screen reader.
const ib = (k, f, l, c = "") => {
  const b = btn(icon(k), f, `.icon${c}`);
  b.ariaLabel = b.title = l;
  return b;
};
// `u`: a new chat in this project (ADR 0069: New chat here), `{ n, name }`.
const start = (w, where = "#/new", u) => go(where) && Object.assign(R, { draft: w, u });
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
  R.pj = {};
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

// The list by project (ADR 0065, 0069, 0071): projects (shut till opened, `@n` in S.fold), then
// repos, then General, each counting what needs you and works. Open chats are the list's alone;
// under Closed, one opened reads its closed ones (no ETag), each time Closed opens.
function groups(l, row, runs, q) {
  const by = new Map();
  const shown = l.filter((t) => t.project);
  const pj = shown.concat(
    S.list.tasks.filter((t) => t.project && t.state !== "closed" && !shown.includes(t)),
  );
  for (const t of pj) by.set(`@${t.n}`, []);
  // A chat's project is its `parent`: its `Part of` line, or GitHub's link once moved in.
  for (const t of l) {
    const k = by.has(`@${t.parent}`) ? `@${t.parent}` : projOf(t);
    if (!t.project) by.set(k, [...(by.get(k) || []), t]);
  }
  for (const t of pj) if (!shown.includes(t) && !by.get(`@${t.n}`).length) by.delete(`@${t.n}`);
  const gen = by.get("");
  if (by.delete("")) by.set("", gen);
  if (by.size < 2 && ![...by.keys()].join().includes("@")) return h("ul.rows", l.map(row));
  // Projects, then Chats, each under its heading: a project is a card, its chats under it.
  return [...by].map(([p, g], i, a) => {
    const P = pj.find((t) => `@${t.n}` === p);
    const shut = !q && !R.need && S.fold.includes(p) === !P;
    const c = P?.project.chats;
    if (P && R.shut && !shut && !R.pj[P.n] && g.length < c) {
      R.pj[P.n] = [];
      get(`task/${P.n}`, undefined, 1, "").then((d) => {
        R.pj[P.n] = d?.task.project?.chats || R.pj[P.n];
        drawList();
      }, no);
    }
    const more = P && R.shut && !q ? R.pj[P.n] || [] : [];
    const rest = more.filter((x) => x.state === "closed" && !g.some((t) => t.n === x.n));
    // The project waiting on you, or closed (under Closed): its own row, first.
    const self = P && shown.includes(P) && (R.shut || P.state === "needs-you") ? [P] : [];
    const rows = [...self, ...g, ...rest];
    // None to show, its chats read: said, never an empty group.
    const none = P && !rows.length && !(R.shut && g.length < c && !R.pj[P.n]?.length);
    const n = (f, c, w, k = (P ? [P, ...g] : g).filter(f).length) =>
      k > 0 && h(`small.${c}`, { title: w }, `${k}`);
    const fold = btn(
      [
        icon("down"),
        h("b", P ? P.project.name : p ? named(p) : "General"),
        P && h("span", `${c} chat${c === 1 ? "" : "s"}`),
        n((t) => t.state === "needs-you", "n", "Needs you"),
        n((t) => runs.has(t.n), "w", "Working"),
      ],
      () => {
        S.fold = S.fold.includes(p) ? S.fold.filter((x) => x !== p) : [...S.fold, p];
        keep();
        drawList();
      },
      ".fold",
    );
    fold.ariaExpanded = String(!shut);
    // A project you made and a repo's group look apart: their pages aren't the same kind.
    const it = P ? "The project's page" : `The ${named(p)} repo's page`;
    const page = {
      href: P ? `#/t/${P.n}` : `#/p/${encodeURIComponent(p)}`,
      title: it,
      "aria-label": it,
    };
    const pk = (k) => k.startsWith("@");
    const sec = a.some(([k]) => pk(k)) && (!i || pk(a[i - 1][0]) !== pk(p));
    return [
      sec && h("h3.sec", P ? "Projects" : "Chats"),
      h(`div.proj${P ? ".pj" : ""}`, fold, p && h("a.icon", page, icon(P ? "app" : "code"))),
      !shut &&
        (none
          ? h("p.quiet.none", R.shut ? "No closed chats." : "No open chats.")
          : h("ul.rows", rows.map(row))),
    ];
  });
}

// The list: what needs you, then what runs; repeats last. Open, Needs you and Closed are one
// control; its filters count what it shows. No call but for closed ones.
function drawList() {
  clock();
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
  // A row: its state's mark, title, age, kind and number. A split task's parts fold under it
  // (ADR 0066): `#n` in S.fold is one open.
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
    // Its word only, not a clock's time.
    const mark = h(`i.mark.${st ? st.className.replace("st ", "") : t.state}`, {
      title: st ? st.firstChild.textContent : WORD[t.state],
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
        t.updated && h("time.age", { "data-at": t.updated }, ago(t.updated)),
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
  // Quiet (ADR 0069): no new word for 7 days, at the foot; opened, it reads the next page too. A
  // project stays with the projects.
  const hush = (t) =>
    !R.shut &&
    !q &&
    !t.project &&
    !late(t) &&
    !runs.has(t.n) &&
    Date.now() - Date.parse(t.updated) > 6048e5;
  const quiet = rows.filter(hush);
  const wide = S.fold.includes("~q");
  const hushed = btn(
    [icon("down"), h("b", "Quiet"), h("small", `${quiet.length}`)],
    () => {
      S.fold = wide ? S.fold.filter((x) => x !== "~q") : [...S.fold, "~q"];
      keep();
      (!wide && L.more && !R.old ? olderTasks : drawList)();
    },
    ".fold",
  );
  hushed.ariaExpanded = String(wide);
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
    !GUEST && h(`a.boxes${on.length ? ".live" : ""}`, box, boxes || "No box online: tasks wait"),
    h(
      "div.tabs",
      { role: "group", "aria-label": "Show" },
      // Chats: a project is a group.
      tab("Open", R.shut ? 0 : all.filter((t) => !t.project).length, false),
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
            rows.filter((t) => !late(t) && !hush(t)),
            row,
            runs,
            q,
          ),
          rest.length > 0 && [
            h("a.group", { href: "#/repeats" }, "Repeats", h("small", "Manage")),
            h("ul.rows", rest.map(row)),
          ],
          quiet.length > 0 && [h("div.proj", hushed), wide && h("ul.rows", quiet.map(row))],
          !rows.length && h("p.quiet", none),
        ],
    more && btn(R.shut ? "Older closed tasks" : "Older tasks", olderTasks, ".earlier.older"),
  );
  // Put in only when it changed (a run's clock ticking doesn't count): a row isn't swapped under
  // a click for nothing.
  const key = next.innerHTML.replace(CLK, "$1");
  if (key === R.key && $("#list").firstChild) return;
  R.key = key;
  $("#list").replaceChildren(...next.childNodes);
  for (const k in M) M[k].then((m) => m.redraw?.(), no);
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
  /** @type {Record<string, any>} */
  const v = {
    n,
    head: h("header.head"),
    msgs: h("div.msgs", { role: "log" }),
    done: new Map(),
    u: !n && R.u,
  };
  R.u = 0;
  // Away from the end: a small round button in the corner takes you back to the latest.
  const label = { type: "button", hidden: true, onclick: end, "aria-label": "To the latest" };
  v.pill = h("button.pill", label, icon("down"));
  v.pill.title = "To the latest";
  v.foot = h("div.foot", v.pill);
  // Find in this chat: its row under the head, find.js's, loaded when it opens.
  v.fb = ib("search", () => lazy("find")((m) => m.find(v)), "Find in this chat", ".fb");
  v.box = h("section.view", v.head, v.msgs, v.foot);
  v.msgs.onscroll = () => {
    v.low = near(v.msgs);
    v.pill.hidden = v.low;
  };
  // A picture that loads late pushes the end down: still at the end, stay there.
  v.msgs.addEventListener("load", () => v.low && end(), true);
  set($("#main"), v.box);
  if (n) {
    S.seen = S.seen.filter((x) => x !== n).concat(n);
    keep();
  } else R.pend[0] = queue(0).filter((p) => p.st === "fail");
  R.v = v;
  redraw();
}

// The open thread: only what's newer while a run is going (all of it once more, `whole`, when
// what's kept here stands in for a reply's words).
async function pull(n) {
  const old = S.threads[n];
  const since = !old?.r && old?.task.running && old.messages.at(-1)?.at;
  const d = await get(
    `task/${n}${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    !!old && !R.woke,
  );
  if (!d) return;
  // Only what's newer (or the newest page, older ones loaded), kept in order. Past 100 the edge
  // reads what's newer by time, so none is skipped.
  if (since || old?.page < d.page) {
    const all = new Map(old.messages.map((x) => [x.id, x]));
    for (const x of d.messages) all.set(x.id, x);
    const messages = [...all.values()].sort((a, b) => a.id - b.id);
    Object.assign(d, { messages, earlier: old.earlier, page: old.page });
  }
  // Your close or reopen holds here as in the list, till GitHub's read agrees.
  const v = R.turned[n];
  if (v && v.open !== d.task.open) Object.assign(d.task, { open: v.open, state: v.t.state });
  S.threads[n] = d;
  keep(n);
  redraw();
}

// Redraws above where you're reading, and keeps you there.
function above() {
  const m = R.v.msgs;
  const below = m.scrollHeight - m.scrollTop;
  redraw();
  m.scrollTop = m.scrollHeight - below;
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
  keep(n);
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
  const phone = !WIDE.matches;
  return [
    phone && [i("search", "Find in this chat"), () => R.v.fb.click()],
    phone &&
      task &&
      !T.repeats && [i(T.open ? "check" : "undo", T.open ? "Close" : "Reopen"), () => turn(T)],
    !GUEST && [i("open", "On GitHub"), gh(T.url)],
    task && runOf(T) && [i("x", "Stop the run"), () => stop(n)],
    T.pr && [i("code", "The changes"), gh(`${T.url}/files`)],
    [
      i("save", "Download the thread"),
      () => save(`#${n}-${slug.slice(0, 40)}.md`, `${top}${md}\n`),
    ],
    task && [i("repeat", "Run again"), () => say(n, "again")],
    task && !T.project && !T.parent && [i("app", "Move to project"), () => pjs((m) => m.move(n))],
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
  // The chat's files (ADR 0071): yours and its runs', newest first, each to open in the pane.
  const fl = t.messages.flatMap((x) => x.files.filter((f) => f.src)).reverse();
  const fs = (e) =>
    pop(
      e.currentTarget,
      fl.map((f) => [f.name, () => see(f)]),
    );
  // Its state, number and kind, its runs added up (each reply's line has its own), its PRs.
  const kind = T.pr
    ? [h("span.tag", `PR · ${T.pr}`), T.for && to(T.for, `Task #${T.for}`)]
    : [
        status(T, run, true),
        h("span", `#${n}`),
        T.parent && to(T.parent, `Part of #${T.parent}`),
        // A project's name goes to its page (ADR 0069: no tab row).
        k &&
          (k === projOf(T)
            ? h("a", { href: `#/p/${encodeURIComponent(k)}` }, named(k))
            : h("span", named(k))),
        model,
        all.runs.length > 0 && h("span.sum", summary(all)),
        T.prs.map((p) => pr(p)),
        fl.length > 0 && btn(`Files ${fl.length}`, fs, ".chip"),
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
  const title = n
    ? T.pr
      ? `#${n} ${T.title}`
      : bare(T.title)
    : R.home
      ? "Desk"
      : `New chat${v.u ? ` in ${v.u.name}` : ""}`;
  set(v.head, back(), h("div.title", h("h2", title), tags), real && v.fb, refreshBtn(), flip, more);
  // A split task: its Plan card under the header.
  if (real && T.plan) lazy("plan")((m) => R.v === v && m.plan(v, t));
  // No plan this time (its read failed, or the parts were unlinked): no card left from before.
  else if (v.pk) {
    v.box.querySelector(".plan")?.remove();
    v.pk = undefined;
  }
  // A project's screen (ADR 0071): Overview, Chats, Docs and Files under the header (project.js).
  if (real && T.project) lazy("project")((m) => R.v === v && m.screen(v, t));
  // A project's doc opens once: in the pane, over its project's Docs (ADR 0071), open or closed.
  const docIn = T.doc?.of;
  if (real && docIn && !v.pd) {
    v.pd = 1;
    R.tab = "Docs";
    location.replace(`#/t/${docIn}`);
    ws((w) => w.page(n));
  }
  // Its Progress (ADR 0069): the handoff, folded above the thread, drawn again only when changed,
  // as open as you left it. `v.pg` is the fold or "", never `false`.
  const g = (real && T.progress) || "";
  if ((v.pg?.k || "") !== g) {
    const d =
      g &&
      h(
        "details.prog",
        { open: v.pg?.open },
        h("summary", "Progress"),
        Object.assign(h("div.md"), { innerHTML: g }),
      );
    v.pg?.remove();
    if (d) v.msgs.before(d);
    v.pg = d ? Object.assign(d, { k: g }) : undefined;
  }
  // A command's answer stays until the thread's newest message changes; a note, a minute.
  const live = (p) =>
    p.sys
      ? !n || (p.keep ? t.messages.at(-1)?.id === p.last : Date.now() - p.t < 6e4)
      : p.st !== "sent" || you <= p.base;
  // One gone lets go of its pictures' previews.
  R.pend[n] = queue(n).filter((p) => live(p) || (p.prev?.map(free) && 0));
  // A message drawn once is drawn again only when it changed (or its words came in place of a
  // stand-in, `r`).
  const one = (x, i) => {
    const e = v.done.get(x.id);
    if (e?.k === x.html && e.r === x.r) return e;
    v.done.set(x.id, Object.assign(msg(x, i, n), { k: x.html, r: x.r }));
    return v.done.get(x.id);
  };
  // Your `stop` is in: the run reads it within a minute.
  const halt = run && /^\s*stop\W*$/i.test(t.messages.at(-1)?.md);
  const work = run
    ? h(
        "div.msg.work",
        halt ? dot("working", "Stopping…") : working(run),
        !GUEST && ext(run.url, "Watch it"),
      )
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
  // A button's word isn't drawn (ADR 0069); a close shows from the task's state.
  const msgs = t.ph
    ? ph()
    : t.messages.slice(cut).flatMap((x, i) => (x.tap ? [] : one(x, i + cut)));
  const shut =
    real &&
    !T.open &&
    !TURN.test(t.messages.findLast((x) => !x.tap)?.md) &&
    turned("close", T.closed ? ` · ${ago(T.closed)}` : "", !!T.closed);
  // A new chat's starters; on the first screen, the Desk (desk.js), made once a view.
  if (R.home) v.dk ||= home();
  const hi = !n && !wait && (v.dk || starts());
  const rest = [shut, hi, R.pend[n].map(pend), words, work].flat().filter(Boolean);
  // The same messages stay where they are (a picture, a diagram, what you selected): only what's
  // around them is put in again.
  if (msgs.length === v.ms?.length && msgs.every((e, i) => e === v.ms[i])) {
    for (const e of [v.er, ...v.tl]) e?.remove();
    if (earlier) v.msgs.prepend(earlier);
    v.msgs.append(...rest);
  } else set(v.msgs, earlier, msgs, rest);
  Object.assign(v, { ms: msgs, er: earlier || null, tl: rest });
  if (!v.drawn || was) end();
  v.pill.hidden = v.low = near(v.msgs);
  v.drawn = !t.ph;
  clock();
  // A project's box (ADR 0069) opens a new chat in it, or adds to its Inbox; its question, answered.
  const W = t.writable && (T.project && T.state !== "needs-you" ? 2 : 1);
  if (v.w !== W) {
    v.w = W;
    v.seen = T.model;
    v.co = {
      menu: S.menu,
      task: (W < 2 && n) || undefined,
      dk: n,
      model: T.model,
      words: R.draft,
      root: v.box,
      send: W > 1 ? inProject(v, T.project) : (b, p) => send(v.u ? { ...b, under: v.u.n } : b, p),
      after: redraw,
    };
    R.draft = "";
    const changes = ext(`${T.url}/files`, "The changes");
    const note = T.pr
      ? h("p.note", "Read it here. ", changes, " and the merge are on GitHub.")
      : T.doc
        ? h(
            "p.note",
            "A doc: ",
            btn("Edit it", () => ws((w) => w.page(n)), ".btn"),
          )
        : h("p.note", "This task doesn't take words from here: ", ext(T.url, "open it on GitHub"));
    set(v.foot, v.pill, t.writable ? composer(v.co) : note);
    if (R.ask && v.co.attach) R.ask(v.co);
    R.ask = 0;
  } else if (real && v.co && v.seen !== T.model) {
    // The task's model as GitHub has it, once it changes: a pick here stays till then.
    v.seen = v.co.model = T.model;
    v.co.label();
  }
  // Words sent while a run works are read before it answers: the box says so. While it works,
  // an empty box's send stops it. A project's box says its own (project.js).
  const ta = n && W < 2 && v.foot.querySelector("textarea");
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

const pjs = lazy("project");
// The first screen (ADR 0069): the Desk, drawn by desk.js, kept with the view.
const home = () => {
  const e = h("div.desk");
  lazy("desk")((m) => m.desk(e));
  return e;
};

// A new chat's starters, each filling the box you write in.
function starts() {
  const says = Object.fromEntries(S.menu?.commands || []);
  const fill = (w, file) => () => R.v?.co?.fill(w, file);
  const one = (k, t, about, f) => btn([icon(k), h("b", t), h("small", about)], f, ".start");
  // Your repos as the record keeps them (ADR 0047): Shipify's own first.
  const p = [...new Set(["shipify", ...(S.menu?.repos || [])])].map((x) => [x, fill(`${x}: `)]);
  const file = fill("Summarize this: ", 1);
  // A guest's: no repos, apps, notes or repeats.
  const grid = h(
    "div.starts",
    one("chat", "Ask anything", "Plain words are enough", fill("")),
    one("file", "About a file", "A PDF, photo or document: a summary, the key points", file),
    GUEST
      ? one("folder", "New project", "Its own chats, docs and files", fill("project: "))
      : [
          one("code", "Change a repo", says.change, (e) =>
            pop(e.currentTarget, ["Which one?", ...p]),
          ),
          one("app", "New app", says.new, fill("new: ")),
          one("pin", "Remember", says.remember, fill("remember: ")),
          one("repeat", "Repeat", says.repeat, () => go("#/repeats")),
        ],
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
  // A file its words name opens in the pane, as its chip does (ADR 0071).
  const seeIn = (e, a = e.target.closest("a")) => {
    const f = a && x.files.find((f) => f.src === a.getAttribute("href"));
    if (!f) return zoom(e);
    e.preventDefault();
    see(f);
  };
  const md = Object.assign(h("div.md"), { innerHTML: x.html, onclick: seeIn });
  // Copy on each block of code; a diagram's is drawn in its place (draw.js).
  if (x.md.includes("```mermaid")) lazy("draw")((m) => m.draw(md, x.md));
  for (const pre of md.querySelectorAll("pre")) {
    const b = ib("copy", () => copy(pre.textContent), "Copy", ".cp");
    pre.replaceWith(h("div.code", b));
    b.before(pre);
  }
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
  const at = h("time", { title: new Date(x.at).toLocaleString(), "data-at": x.at }, ago(x.at));
  const foot = h("footer", use, at, seen, more);
  return h(`article.msg.${x.who}`, who, md, x.files.map(file), links, ask, line, det, foot);
}

// A file's chip; its kept copy gone (ADR 0071), Archived, linked to its backup, else Gone.
const lost = (f) =>
  f.backup
    ? ext(f.backup, `${f.name} · Archived`, ".chip.gone")
    : h("span.chip.gone", `${f.name}${f.src ? " · Gone" : ""}`);
function file(f) {
  const u = f.src;
  const s = f.size ? ` · ${size(f.size)}` : "";
  const gone = () => lost(f);
  if (!u || R.gone[u]) return gone();
  if (!IMG.test(f.type))
    return btn([icon("file"), h("span", `${f.name}${s}`)], (e) => see(f, e.currentTarget), ".chip");
  // A picture: yours from here (kept with its chat) or from Telegram (read through the edge).
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
// A file opens here, never in a new tab: in the doc pane, beside the thread (workspace.js). Its
// chip (`c`) says Archived once its kept copy has gone.
const see = (f, c) => ws((w) => w.doc(f, c));
// `f` takes the box on screen, or a new chat's (in the project on screen).
const into = (f) => {
  if (R.v?.co?.attach) return f(R.v.co);
  R.ask = f;
  start(R.proj ? `${decodeURIComponent(location.hash.slice(4))}: ` : "");
};
// Ask about this: the file goes with your next message; Share asks for a drop of it.
const ask = (f, w) => into((co) => co.attach(f) || (w && co.fill(w)));
// Drop anywhere (ADR 0069): your files, or a row from Files (DZ), into the box. Never sent.
const DZ = "text/x-shipify-file";
const dz = (e, d = document.body.dataset) => {
  if (![...e.dataTransfer.types].some((x) => x === "Files" || x === DZ)) return;
  e.preventDefault();
  clearTimeout(R.dz);
  if (e.type === "dragover") {
    d.dz = S.menu?.files?.on ? "Drop to attach" : "Files aren't set up";
    R.dz = setTimeout(() => delete d.dz, 150);
    return;
  }
  delete d.dz;
  const l = [...e.dataTransfer.files];
  const f = e.dataTransfer.getData(DZ);
  if (S.menu?.files?.on) into((co) => (f ? co.attach(JSON.parse(f)) : co.add(l)));
};
addEventListener("dragover", dz);
addEventListener("drop", dz);

function pend(p) {
  // A command's answer (/help, /ping…) reads as Shipify's, lines kept; a note stays a small line.
  if (p.sys) return p.keep ? h("article.msg", h("div.md.pre", p.sys)) : h("p.sys", p.sys);
  const b = p.b;
  const fail = [h("span.st.bad", p.err), btn("Retry", () => sendIt(p))];
  if (b.button && p.st !== "fail") return;
  if (TURN.test(b.words) && !b.files.length)
    return p.st === "fail" ? h("p.sys", fail) : turned(b.words, "", p.st === "sent");
  const st = p.st === "fail" ? fail : h("em", p.st === "sent" ? p.text : "Sending…");
  const pics = p.prev.map((u) => h("img.thumb", { src: u, alt: "" }));
  const docs = b.files.length > p.prev.length && b.files.map((f) => h("span.chip", f.name));
  const use = b.use && h("span.use", said(S.menu, b.use));
  return h("article.msg.you", h("div.md.pre", b.words), pics, docs, h("footer", use, st));
}

// Sends a message: shown at once, kept with Retry if it fails; the id is made once. One from a
// project's box (`box`) is never kept: what isn't sent goes back in the box.
function send(b, prev = [], note = "", box) {
  const at = box?.n || b.task || 0;
  const L = queue(at);
  const base = (S.threads[at]?.messages || []).filter((x) => x.who === "you").length;
  L.push({ b, prev, note, at, box, base: base + L.filter((p) => p.b).length });
  sendIt(L.at(-1));
}
// A project's box (ADR 0069): Send opens a new chat in it (`under`); Add (project.js sets `v.add`)
// puts what you found in its Inbox, with no run. Not sent: your words and files back in the box.
const inProject = (v, P) => (b, p) =>
  send(v.add ? { ...b, words: `add ${P.name}: ${b.words}` } : { ...b, under: v.n }, p, "", {
    n: v.n,
    back() {
      if (R.v !== v) return;
      v.co.fill(b.words);
      for (const f of b.files) v.co.attach(f);
    },
  });
// A button's word, marked: no message shows for it (ADR 0069).
const TAP = /^(close|reopen|stop( repeating)?)$/;
const sent = (task, words, id = uid()) => ({
  id,
  task,
  words,
  files: [],
  button: TAP.test(words) || undefined,
});
// With `under` (a project's Collate, Check), a new chat in it.
const say = (n, words, under) => send({ ...sent(n, words), under });
async function sendIt(p) {
  p.st = "sending";
  redraw();
  try {
    const s = await api("send", p.b);
    const n = p.at;
    const k = s.task || n;
    bar("off");
    Object.assign(p, { st: "sent", text: s.task ? `Sent · #${s.task}` : "Sent" });
    // What you sent isn't news to you (a few seconds' grace for the clocks; a reply takes longer).
    S.saw[k] = Date.now() + 5e3;
    // In a new chat, it goes with you; from a project's box, an Add leaves only the door's answer.
    if (k !== n || p.box) R.pend[n] = queue(n).filter((x) => x !== p);
    if (k !== n) {
      p.base = 0;
      queue(k).push(p);
      go(`#/t/${k}`);
    }
    if (p.note || !s.task) {
      const last = S.threads[k]?.messages.at(-1)?.id;
      queue(k).push({ sys: p.note || s.text, keep: !p.note, last, t: Date.now() });
    }
    // One read after a send, however many go.
    clearTimeout(R.sent);
    R.sent = setTimeout(tick, 5500);
  } catch (e) {
    Object.assign(p, { st: "fail", err: why(e) });
    if (e.off) bar("off", OFF);
    // From a project's box: out of its page, why said at the top, your words back in the box.
    if (p.box) {
      R.pend[p.at] = queue(p.at).filter((x) => x !== p);
      p.prev.map(free);
      if (!e.off) told(p.err);
      p.box.back();
      return redraw();
    }
    // Not sent for want of a line (offline, late, GitHub unreached): sent again with the same id
    // (never twice), up to three times and when back online. Retry stays.
    const late = e.off || e.late || e.status === 503;
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
  await load(R.page);
}
// A page's read, drawn when it comes. One that fails with nothing kept says why in its place, with
// Retry: never placeholders for good.
async function load(v) {
  const retry = () => set(v.body, ph()) || load(v);
  const d = await get(v.p).catch((e) => {
    if (!R[v.p] && v.body.isConnected && !e.signin)
      set(v.body, h("p.quiet", why(e)), btn("Retry", retry));
  });
  if (!d) return;
  R[v.p] = d;
  if (v.body.isConnected) set(v.body, v.draw(d));
}
// Words sent from a button: it waits while they go, a failure keeps a Retry (with the same id).
async function quick(task, words, out, b, id = uid()) {
  if (b) b.disabled = true;
  const s = await get("send", sent(task, words, id)).catch((e) => {
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
const out = () => h("p.hint", { "aria-live": "polite" });
// An item on a page (Repeats, Notebook, Files): its name over a line about it.
const what = (name, ...about) => h("div.what", name, h("span.meta", about));
// Repeats: repeat.js, with its New repeat form, loaded when it opens (ADR 0069: from the Desk).
const repeats = () => lazy("repeat")((m) => m.repeats());

// The Library (ADR 0069): the notebook's pages, then the Library's by project (library.js).
const notebook = () => lazy("library")((m) => m.library());

// Files: every project's docs, sorted as a project's page sorts its own (workspace.js).
const files = () => ws((w) => w.files());

// Status & setup: setup.js, loaded when it opens.
const setup = () => lazy("setup")((m) => m.setup());
// Notifications (ADR 0050): sw.js shows them and takes shares. Sent again on opening if the
// subscription or the edge's key changed (setup.js `notify`, where they're turned on or off).
const SW = navigator.serviceWorker;
const reg = SW?.register("sw.js").catch(no);
const hex = async (u) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(u)))]
    .slice(0, 4)
    .map((b) => (b + 256).toString(16).slice(1))
    .join("");
const sync = async () => {
  const pm = (await reg)?.pushManager;
  const k = S.menu?.notifications?.key;
  let s = await pm?.getSubscription();
  if (k && S.note && S.note !== `${s?.endpoint} ${k}` && Notification.permission === "granted") {
    await lazy("setup")((m) => m.notify(true).catch(no));
    s = await pm.getSubscription();
  }
  R.mine = s && (await hex(s.endpoint));
};
/** Your pages: a guest never opens them. */
const YOURS = new Set(["repeats", "notebook", "setup"]);
function route() {
  const [, at = "", n = ""] = location.hash.match(/^#\/(\w*)\/?(\d*)/) || [];
  const p = GUEST && YOURS.has(at) ? "" : at;
  R.n = p === "t" ? +n : 0;
  R.proj = p === "p";
  // A guest's Desk is theirs: their chats and projects (desk.js).
  R.home = !p || p === "desk";
  R.v = null;
  document.body.classList.toggle("in", !!p);
  // A thread (or a new chat) takes the whole phone; a page keeps the tabs.
  document.body.classList.toggle("talk", p === "t" || p === "new");
  for (const a of $("#pages").children)
    a.ariaCurrent = a.dataset.p === (p === "t" || p === "new" ? "" : p) ? "page" : null;
  $(".pop")?.close();
  // Nothing picked is a new chat: its starters, ready to type in.
  const proj = () => ws((w) => w.project(decodeURIComponent(location.hash.slice(4))));
  safe({ repeats, notebook, files, setup, p: proj }[p] || thread);
  safe(drawList);
  tick();
  // Focus where it was went with it (a tap on a phone): the view's heading has it, for a screen
  // reader. The box you write in keeps it on a PC.
  setTimeout(() => {
    const e = document.activeElement === document.body && $("#main h2");
    if (e) Object.assign(e, { tabIndex: -1 }).focus();
  });
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
  // The open thread is drawn again only when its own run or state changed here.
  const n = R.v?.n;
  const k = JSON.stringify([
    n,
    online(),
    d.running.filter((r) => r.n === n),
    d.tasks.find((t) => t.n === n)?.state,
  ]);
  if (k !== R.lk) redraw();
  R.lk = k;
};
// On a phone the list and a page take turns: only what's on screen is read, the list too while
// your words wait for a run, and once on coming back.
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
    // A project's page and the Desk (a phone's first screen) show the list's tasks: it's read there
    // too.
    const listed =
      WIDE.matches || !document.body.classList.contains("in") || wait || R.woke || R.proj || R.home;
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
// Back from away, or ↻: what's on screen reads again at once, a newer page loads by itself (ver),
// and the times ("5m") are drawn again. Away, nothing is read, and what changed is kept now (a
// phone may close the app).
async function wake() {
  if (document.hidden) return flush() || clearTimeout(R.timer);
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
// The pages: a row under the list on a PC, tabs at the foot on a phone (the list, Projects, there
// too). Repeats is on the Desk (ADR 0069).
set(
  $("#pages"),
  [
    ["spark", "Desk"],
    ["app", "Projects", ""],
    ["folder", "Files"],
    ["book", "Library", "notebook"],
    ["pulse", "Setup", "setup"],
  ]
    .filter(([, l]) => !GUEST || l === "Desk" || l === "Projects" || l === "Files")
    .map(([k, l, p = l.toLowerCase()]) =>
      h(`a${p ? "" : ".home"}`, { href: `#/${p}`, "data-p": p }, icon(k), h("span", l)),
    ),
);
// Back: the list (Projects) is under every page; a tab from another page takes its place, the
// list's too, by its hash (never Back, which leaves the app when it was opened from elsewhere).
$("#pages").onclick = (e) => {
  const a = e.target.closest("a");
  if (!a || !location.hash.replace(/^#\/?/, "")) return;
  e.preventDefault();
  location.replace(a.href);
};
$("#new").prepend(icon("plus"));
$("#new").before(refreshBtn());
$(".search").prepend(icon("search"));
// The list follows what you type once you pause (100 ms), not each key.
$("#q").oninput = () => {
  clearTimeout(R.qt);
  R.qt = setTimeout(drawList, 100);
};
$("#q").onkeydown = (e) => {
  const m = /^#(\d+)$/.exec(e.target.value.trim());
  if (e.key === "Enter" && m) go(`#/t/${m[1]}`);
};
// Ctrl+K (⌘K), or Find beside New chat (ADR 0071: a phone too), finds a project, a task or a doc;
// with nothing typed, the chats seen last.
const find = () => ws((w) => w.quick());
$("#find").onclick = find;
$("#find").prepend(icon("search"));
addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key !== "k") return;
  find();
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
// A phone opens on the Desk (ADR 0069), a guest's too.
if (!location.hash.slice(2) && !WIDE.matches) history.replaceState(null, "", "#/desk");
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
