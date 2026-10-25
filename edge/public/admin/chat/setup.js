// @ts-check
// Shipify chat: Status & setup (ADR 0039), read-only, one page, loaded the first time it opens
// (ADR 0065): the page you open every day doesn't carry it.
import { cap, h, icon, nm, pretty, uid } from "./compose.js";

/** What the page lends it (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;
export const init = (a) => {
  A = a;
};
const no = () => {};

const cmd = (c) =>
  h(
    "span.cmd",
    h("code", c),
    A.btn("Copy", () => A.copy(c)),
  );
const sec = (t, k, body, ...how) =>
  h("section.card", h("h3", icon(k), t), body, how.length > 0 && h("p.how", "To change it: ", how));
const past = (t, a = A.ago(t)) => (a === "now" ? "just now" : `${a} ago`);
const box = (b) => [
  h("b", b.name),
  A.mark(b.online, b.online ? "online" : "offline"),
  A.meta(`${b.busy} of ${b.slots} busy`, b.at && `health read ${past(b.at)}`),
  b.tasks.map((n) => A.to(n)),
  b.console && A.ext(b.console, "Console", ".btn"),
];
const chat = (c) => [
  h("b", c.name),
  A.mark(c.ready, c.ready ? "ready" : "not set up"),
  A.meta(`${c.people} ${c.people === 1 ? "person" : "people"}`),
];
const app = (a) => [
  A.ext(a.url, a.id),
  A.mark(!a.failing && !a.paused, a.paused ? "paused" : a.failing ? "failing" : "up"),
  A.btn("Change…", () => A.start(`${a.id}: `)),
];
const chats = ["add telegram", "add webchat", "selftest webchat"].map((c) => `pnpm ship ${c}`);
// Setup's switch, and the devices notified, this one marked.
const bell = (d) => {
  const S = A.S;
  const o = A.out();
  const sw = h("input", { type: "checkbox", checked: !!S.note });
  sw.onchange = () =>
    A.notify(sw.checked)
      .then(A.sync)
      .then(A.fresh, (e) => {
        sw.checked = !!S.note;
        o.textContent = e.message;
      });
  const dev = (x) => [
    h("b", x.service),
    A.meta(past(x.since)),
    x.id === A.R.mine && A.meta("this one"),
  ];
  const how = !S.menu?.notifications
    ? ["Notifications aren't set up: ", cmd("pnpm ship add webchat --yes")]
    : window.PushManager
      ? h("label", sw, "Notifications on this device")
      : navigator.standalone === false && "For notifications, open Shipify from the Home Screen";
  return [h("p", how), o, A.list(d.devices || [], dev, "")];
};
const can = (l, a) => a.length > 0 && A.meta(`${l}: ${a.join(", ")}`);
const tool = (t) => [
  h("b", cap(t.id)),
  t.about,
  can("Looks at", t.look),
  can("Changes after your yes", t.act),
  can("Without asking", t.pre),
];
// A look at the box by a run, with Haiku: what Cockpit shows, in words, and what needs doing.
const HEALTH =
  "How is the box doing? Disk, memory, temperature, load, updates waiting and the runner's service: say what needs doing, if anything.";
const health = async () => {
  const s = await A.get("send", { id: uid(), words: HEALTH, use: "haiku", files: [] }).catch(no);
  if (s?.task) A.go(`#/t/${s.task}`);
};
// Why the watch started a task's run, in plain words (the record says "started #160 (its job)").
const WHY = {
  "its job": "its repeat's time came",
  "a reminder": "its reminder's time came",
  "a check": "its check's time came",
  "a quiet day": "a quiet day, so it closed",
  "its deploy": "its deploy finished",
  "its release": "its release PR was merged or closed",
  "a new recipe": "a new recipe",
  "its recipe changed": "its recipe changed",
};
const ev = (e) => {
  const [, n, why] = /^started #(\d+) \((.+)\)$/.exec(e.text) || [];
  const t = n && A.join(A.S.list?.tasks || [], A.R.closed?.tasks || []).find((x) => x.n === +n);
  const name = A.to(n, t ? `#${n} ${A.bare(t.title)}` : `#${n}`);
  return [n ? A.what(name, WHY[why] || why) : h("span.what", e.text), h("time", A.ago(e.at))];
};
// What the box's watch did by itself lately: each run it started, and why. Below the setup.
const lately = (W) =>
  sec("Started by the watch", "repeat", [
    A.meta(
      "Runs no one asked for: a repeat's time, a PR's checks, a deploy",
      W.last && `last looked ${past(W.last)}`,
      W.next && `next repeat ${A.until(W.next)}`,
    ),
    A.list(W.events, ev, "Nothing lately."),
  ]);
// Now: what needs a look (from the record and the boxes, read anyway), the parts in a word each,
// and the way out to the status page, GitHub and each box's console.
const daysTo = (d) => Math.ceil(-A.secs(d) / 86400);
const now = (d) => {
  const o = A.out();
  const bad = [
    d.door.closed && "The door is closed: nothing comes in or goes out",
    ...d.boxes.filter((b) => !b.online).map((b) => `${b.name} is offline: tasks wait for it`),
    ...d.apps.filter((a) => a.failing && !a.paused).map((a) => `${a.id} is failing`),
    ...d.boxes.flatMap((b) => b.look.map((l) => `${b.name}: ${l}`)),
  ].filter(Boolean);
  const links = [
    A.ext("/admin/status", "Status page", ".btn"),
    A.ext(d.links.issues, "Tasks on GitHub", ".btn"),
    A.ext(d.links.actions, "Runs", ".btn"),
    d.boxes.map((b) => b.console && A.ext(b.console, `${b.name} console`, ".btn")),
  ];
  const b = d.boxes[0];
  const k = [...d.keyDates].sort((x, y) => x.date.localeCompare(y.date))[0];
  const tile = (l, v, w) => h("div.tile", h("small", l), h("b", v), w && h("small", w));
  return h(
    "div.strip",
    h(
      `section.card.now${bad.length ? ".bad" : ""}`,
      h("h3", icon("pulse"), bad.length ? "Needs a look" : "All good"),
      bad.map((w) => h("p", A.dot("needs-you", w))),
      h(
        "p.links",
        links,
        A.btn("Check now", () => A.quick(undefined, "/ping", o), ".btn"),
      ),
      o,
    ),
    tile(
      "Box",
      b ? b.name : "none yet",
      b && `${b.online ? "online" : "offline"} · ${b.busy} of ${b.slots} busy`,
    ),
    tile("The door", d.door.closed ? "closed" : "open", d.door.version),
    tile(
      "Chats",
      d.chats
        .filter((c) => c.ready)
        .map((c) => c.name)
        .join(", ") || "none",
      "",
    ),
    k && tile("Next key to renew", `${daysTo(k.date)} days`, k.name),
  );
};

/** The page: Now, then agents and models, then a card each for the rest. */
export const setup = () =>
  A.page("Status & setup", "setup", (d) => {
    const { mark, meta, list, btn, ext } = A;
    const vars = (v) => [ext(d.links.variables, v), " on GitHub "];
    const D = d.door;
    const door = h(
      "p",
      mark(!D.closed, D.closed ? "closed" : "open"),
      ` ${D.version} · ${D.commit.slice(0, 7)}`,
    );
    const add = btn("Add a tool…", () => A.start("shipify: add a tool "));
    // Agents and models: each with its login (a gateway's key, or its own), Auto, and its models.
    const agent = (a) => {
      const g = d.gateways.find((x) => x.id === a.gateway);
      const own = d.keyDates.find((k) => k.name.toLowerCase() === `${a.id}'s login`);
      // Its name and login on one line, then its Auto and efforts, then its models.
      const login = g
        ? mark(g.since, g.since ? `${g.id} key, set ${g.since}` : `no ${g.id} key`)
        : mark(true, "its own login");
      const effort = a.efforts[0] && `effort ${a.efforts[0]} to ${a.efforts.at(-1)}`;
      return h(
        "div.arow",
        h(
          "p.aname",
          h("b", a.name || cap(a.id)),
          a === d.agents[0] && h("span.tag", "default"),
          login,
          own && meta(`renew in ${daysTo(own.date)} days`),
        ),
        meta(`Auto: ${pretty(`${a.auto.model} ${a.auto.effort}`)}`, effort),
        h(
          "div.pills",
          a.models.map((x) => h("span.chip", nm(x.id))),
          g && meta(`and any other on ${g.id}`),
        ),
      );
    };
    const keys = d.gateways.filter((g) => !g.since).map((g) => cmd(`pnpm ship add ${g.id} --yes`));
    const boxes = [list(d.boxes, box, "No box yet."), btn("Check its health", health, ".btn")];
    // A key's days left, as a bar (its width set from script: the page takes no inline style).
    const days = (k) => {
      const fill = h("i");
      fill.style.width = `${Math.min(100, Math.max(2, (daysTo(k.date) / 365) * 100))}%`;
      return [h("div.what", h("b", k.name), h("span.bar", fill)), meta(`${daysTo(k.date)} days`)];
    };
    return [
      now(d),
      sec(
        "Agents and models",
        "spark",
        h("div.agentlist", d.agents.map(agent)),
        "the model picker, or a PR to executors.json",
        ...keys,
      ),
      h(
        "div.cards",
        sec(
          "Keys and dates",
          "pin",
          list(d.keyDates, days, "None set."),
          vars("SHIPIFY_KEY_DATES"),
        ),
        sec(
          "Tools",
          "gear",
          list(d.tools, tool, "None yet."),
          add,
          cmd("pnpm ship add <tool> --yes"),
        ),
        sec("Boxes", "box", boxes, cmd("pnpm ship box status"), " on the box"),
        sec("Projects", "app", list(d.apps, app, "No projects yet."), "Change… starts a chat"),
        sec("Chats", "chat", [list(d.chats, chat, ""), bell(d)], chats.map(cmd)),
        sec("The door", "open", [door, D.repo], vars("SHIPIFY_DOOR"), cmd("pnpm ship door check")),
        lately(d.watch),
      ),
    ];
  });
