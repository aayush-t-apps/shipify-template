// @ts-check
// Shipify chat: the model picker, loaded the first time the box's chip (or a reply's Another
// model) opens it. Who thinks, with what and how hard: the agent (tabs), its models (and a
// search), the effort. It needs nothing of the page's but compose.js, and its stylesheet.
import { $, api, cap, h, icon, nm, pop, set } from "./compose.js";

/** Its stylesheet, asked for as it loads. */
const sheet = new Promise((r) =>
  document.head.append(h("link", { rel: "stylesheet", href: "pick.css", onload: r, onerror: r })),
);
/** What the page lends: the picker needs none of it. Ready once its stylesheet is. */
export const init = () => sheet;

/**
 * A pick as a `use` line says it: its agent named when there's a choice, so it holds from either,
 * and `auto` said, so Auto (or, as an effort, the default) resets what was picked before.
 */
const say = (m, p, reset = false) =>
  [m.agents?.[1] && p.a.id, p.model, p.effort || (reset && p.model !== "auto" && "auto")]
    .filter(Boolean)
    .join(" ");

/** A model's efforts: its own, or, for any other its gateway has, the agent's. */
const efforts = (a, id) =>
  id === "auto" ? [] : (a.models?.find((x) => x.id === id) || (a.gateway && a))?.efforts || [];

// What a gateway says of its models (name, maker, price, size, what each can do), read once a
// page for the agent's listed ones when its tab first opens; a search's come with it.
const FACTS = {};
const big = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`);
const cost = (p) => p && (p[0] + p[1] ? `$${p[0].toFixed(2)} · $${p[1].toFixed(2)}` : "free");
const FILTERS = {
  Free: (f) => f.price && !(f.price[0] + f.price[1]),
  Tools: 0,
  Reasoning: 0,
  Images: 0,
};

/** A small toggle: its words, whether it's on, what it does. */
const chip = (words, on, onclick) => {
  const b = h("button.chip", { type: "button", onclick }, words);
  b.ariaPressed = String(on);
  return b;
};

/**
 * Opens the picker at `at`. `now()` is the pick; `choose(words)` makes one. A model closes the
 * panel; an effort keeps it open. The agents as tabs, then a search with filters, the models with
 * what tells them apart, and the effort the picked one takes.
 */
export function picker(at, m, now, choose, task) {
  let tab = now().a;
  let item = (/** @type {any} */ x) => x;
  let found = /** @type {any} */ (null);
  let t = 0;
  const want = new Set();
  const q = h("input.q", { type: "search", placeholder: "Search models", "aria-label": "Search" });
  const agents = h("div.agents", { role: "tablist" });
  const via = h("div.chips");
  const chips = h("div.chips");
  const list = h("div.list");
  const foot = h("div.effort");
  const done = h("button.btn.primary", { type: "button" }, "Done");
  const known = (id) => FACTS[tab.id]?.get(id) || found?.models?.find((x) => x.id === id) || {};
  // What a model takes: the agent's efforts for it, as far as its gateway's list says it has them.
  const takes = (id) =>
    efforts(tab, id).filter((x) => !known(id).efforts || known(id).efforts.includes(x));
  const fits = (id) =>
    [...want].every((k) => {
      const f = known(id);
      return FILTERS[k] ? FILTERS[k](f) : f.can?.includes(k.toLowerCase());
    });
  const row = (id, p, on) => {
    const f = known(id);
    const about = tab.models?.find((x) => x.id === id)?.about;
    const can = f.can?.join(", ");
    const sub = [
      f.maker || (id.includes("/") && id.split("/")[0]),
      f.context && `${big(f.context)} context`,
      can || about,
    ]
      .filter(Boolean)
      .join(" · ");
    return item([
      [
        h("span.opt", h("span", id === "auto" ? "Auto" : f.name || nm(id)), sub && h("small", sub)),
        h("span.cost", id === "auto" ? cost(known(tab.auto?.model).price) : cost(f.price)),
        on && h("span.ck", icon("check")),
      ],
      () => choose(say(m, p)),
    ]);
  };
  const draw = () => {
    const p = now();
    const mine = p.a === tab;
    const w = q.value.trim().toLowerCase();
    const keep = (id) => (takes(id).includes(p.effort) ? p.effort : "");
    const opt = (id) => row(id, { a: tab, model: id, effort: keep(id) }, mine && p.model === id);
    const listed = (tab.models || []).map((x) => x.id).filter((id) => id.includes(w) && fits(id));
    const more = (found?.models || [])
      .map((x) => x.id)
      .filter((id) => !listed.includes(id) && fits(id));
    const A = tab.auto || {};
    // The agents as tabs; one through more than one gateway shows them in a row below.
    const root = (a) => m.agents.find((x) => x.id === a.of) || a;
    const kin = m.agents.filter((x) => root(x) === root(tab));
    const tabs = m.agents.filter((a) => !a.of);
    const go = (a) => () => {
      tab = a;
      q.value = "";
      found = null;
      want.clear();
      load();
    };
    set(
      agents,
      tabs[1] &&
        tabs.map((a) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": String(a === root(tab)),
              onclick: go(root(p.a) === a ? p.a : a),
            },
            h("b", a.name || cap(a.id)),
            h("small", a === root(m.agents[0]) ? "default" : a.via || ""),
          ),
        ),
    );
    via.hidden = !kin[1];
    set(via, kin[1] && kin.map((a) => chip(a.via, a === tab, go(a))));
    q.hidden = chips.hidden = !tab.gateway;
    set(
      chips,
      Object.keys(FILTERS).map((k) =>
        chip(k, want.has(k), () => {
          if (!want.delete(k)) want.add(k);
          draw();
        }),
      ),
    );
    set(
      list,
      !w &&
        !want.size && [
          row("auto", { a: tab, model: "auto", effort: "" }, mine && p.model === "auto"),
          h(
            "small.sec",
            `Auto runs ${[known(A.model).name || nm(A.model || ""), A.effort].filter(Boolean).join(", ")}`,
          ),
        ],
      // A model picked from a search stays in view, ticked.
      !w &&
        mine &&
        p.model !== "auto" &&
        !listed.includes(p.model) &&
        fits(p.model) &&
        opt(p.model),
      listed.length > 0 && tab.gateway && h("small.sec", "Your list"),
      listed.map(opt),
      w && !listed.length && !tab.gateway && h("small.sec", "No model matches"),
      found && [
        h(
          "small.sec",
          found.say || (more.length ? `More on ${tab.gateway}` : `Nothing else for “${w}”`),
        ),
        more.map(opt),
      ],
      tab.gateway &&
        h("small.sec.note", "Prices per million tokens, in · out, as the gateway lists them."),
    );
    // The efforts the picked model takes.
    const e = mine ? takes(p.model) : [];
    set(
      foot,
      e.length > 0 &&
        h(
          "div.seg",
          { role: "group", "aria-label": "Effort" },
          ["", ...e].map((x) =>
            h(
              "button",
              {
                type: "button",
                "aria-pressed": String(p.effort === x),
                onclick: () => {
                  choose(say(m, { ...p, effort: x }, true));
                  draw();
                },
              },
              x ? cap(x) : "Default",
            ),
          ),
        ),
      h("div.row", h("small", task ? "Goes with your next message" : "For this chat's runs"), done),
    );
  };
  // An agent's listed models' facts, once a page; then drawn again.
  const load = async () => {
    draw();
    if (!tab.gateway || FACTS[tab.id]) return;
    const a = tab;
    const r = await api(`models?agent=${a.id}`).catch(() => 0);
    // Kept only when it came: a failed read is asked again the next time the picker opens.
    if (r) FACTS[a.id] = new Map((r.models || []).map((x) => [x.id, x]));
    if (tab === a) draw();
  };
  // Typing narrows the list at once; a gateway's own list is searched once you pause.
  q.oninput = () => {
    const w = q.value.trim();
    clearTimeout(t);
    found = tab.gateway && w.length > 1 ? { say: "Searching…" } : null;
    draw();
    if (found)
      t = setTimeout(async () => {
        const r = await api(`models?agent=${tab.id}&q=${encodeURIComponent(w)}`).catch(() => 0);
        if (q.value.trim() !== w) return;
        found = r || { say: "Couldn't search just now: try again" };
        draw();
      }, 300);
  };
  // Enter in the search takes the first match; the arrows move through the list.
  q.onkeydown = list.onkeydown = (e) => {
    if (e.key === "Enter" && e.target === q) return list.querySelector("button")?.click();
    const all = [q, ...list.querySelectorAll("button")].filter((x) => !x.hidden);
    const i = all.indexOf(/** @type {any} */ (document.activeElement));
    const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!d || i < 0) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, i + d))]?.focus();
  };
  const head = h("header", h("strong", "Who thinks"));
  item = pop(at, [head, agents, via, q, chips, list, foot], "pick");
  done.onclick = () => $(".pop")?.close();
  load();
  (matchMedia("(pointer:fine)").matches && !q.hidden
    ? q
    : list.querySelector(".ck")?.parentElement
  )?.focus();
}
