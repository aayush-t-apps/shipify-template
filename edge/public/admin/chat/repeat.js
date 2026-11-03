// @ts-check
// Shipify chat: Repeats and its New repeat form, loaded the first time Repeats opens (from the
// Desk, ADR 0069), so the page you open every day doesn't carry them.
import { api, h, icon, uid } from "./compose.js";

/** What the page lends (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;
/** Takes what the page lends, and loads its stylesheet; ready once it has. */
export function init(a) {
  A = a;
  return new Promise((r) =>
    document.head.append(
      h("link", { rel: "stylesheet", href: "repeat.css", onload: r, onerror: r }),
    ),
  );
}

/** "1st", "2nd", "3rd", "4th"… */
const nth = (n) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** How often, each as the words its schedule starts with. */
const OFTEN = [
  ["day", "Daily"],
  ["weekday", "Weekdays"],
  ["week", "Weekly"],
  ["month", "Monthly"],
  ["hours", "Every few hours"],
  ["own", "Your words"],
];

/**
 * When a repeat runs, picked rather than typed: how often, then only what that needs (a day, a
 * date, the hours) and the time, said back as the words the box reads ("every Monday at 09:00")
 * in your time zone. "Your words" takes any schedule the box reads, with examples.
 */
function whenPicker(r) {
  let often = "day";
  const time = h("input", { type: "time", value: "09:00", step: 60 });
  const day = h(
    "select",
    DAYS.map((d) => h("option", d)),
  );
  const date = h(
    "select",
    Array.from({ length: 28 }, (_, i) => h("option", { value: String(i + 1) }, nth(i + 1))),
  );
  const every = h(
    "select",
    [1, 2, 3, 4, 6, 8, 12].map((n) =>
      h("option", { value: String(n) }, n === 1 ? "every hour" : `every ${n} hours`),
    ),
  );
  const from = h("input", { type: "time" });
  const to = h("input", { type: "time" });
  const own = h("input", { placeholder: "every Monday at 9" });
  const eg = (x) => {
    const pick = () => {
      own.value = x;
      draw();
    };
    return h("button.chip", { type: "button", onclick: pick }, x);
  };
  const egs = h("p.links", r.when.split(", ").filter(Boolean).map(eg));
  const at = h("label", "At", time);
  const parts = {
    day: [at],
    weekday: [at],
    week: [h("label", "On", day), at],
    month: [h("label", "On the", date), at],
    hours: [
      h("label", "How often", every),
      h("label", "From (optional)", from),
      h("label", "To", to),
    ],
    own: [h("label.wide", "Say it", own), egs],
  };
  const words = () => {
    const t = time.value || "09:00";
    if (often === "day") return `every day at ${t}`;
    if (often === "weekday") return `every weekday at ${t}`;
    if (often === "week") return `every ${day.value} at ${t}`;
    if (often === "month") return `on the ${nth(Number(date.value))} of every month at ${t}`;
    if (often === "hours") {
      const n = Number(every.value);
      const base = n === 1 ? "every hour" : `every ${n} hours`;
      return from.value && to.value ? `${base} from ${from.value} to ${to.value}` : base;
    }
    return own.value.trim();
  };
  const box = h("div.parts");
  const said = h("p.hint", { "aria-live": "polite" });
  const chips = OFTEN.map(([k, label]) => {
    const choose = () => {
      often = k;
      draw();
    };
    return h("button.chip", { type: "button", onclick: choose }, label);
  });
  const draw = () => {
    box.replaceChildren(...parts[often]);
    for (const [i, c] of chips.entries())
      c.setAttribute("aria-pressed", String(OFTEN[i][0] === often));
    const w = words();
    // A time of day is your zone's: said, so "09:00" is never read as another zone's.
    const zone = /\d:\d\d$/.test(w) && r.zone ? ` ${r.zone}` : "";
    said.textContent = w ? `Runs ${w}${zone}.` : "Say when it runs.";
  };
  for (const x of [time, day, date, every, from, to, own]) x.oninput = x.onchange = draw;
  draw();
  return { root: h("div.when", h("b", "When"), h("p.links.often", chips), box, said), words };
}

/** The New repeat form, checked here first; `done(task)` once it's made. */
export function repeatForm(menu, done) {
  const r = menu?.repeat || { kinds: [], models: [], when: "", zone: "" };
  const id = uid();
  const opts = (a) => a.map((k) => h("option", k));
  const what = h("textarea", { rows: 2 });
  const when = whenPicker(r);
  const check = h("input");
  const kind = h("select", opts(r.kinds));
  const model = h(
    "select",
    r.models.map((o) => h("option", { value: o.words }, o.label)),
  );
  const cw = h("label", "Check", check);
  const mw = h("label", "Model", model);
  const err = h("p.hint", { "aria-live": "polite" });
  const b = h("button.primary", "Create");
  kind.onchange = () => {
    cw.hidden = !/^A check/i.test(kind.value);
    mw.hidden = /^A (check|reminder)/i.test(kind.value);
  };
  kind.onchange();
  const f = h("form.card.form", h("label", "What", what), when.root);
  f.append(h("label", "Kind", kind), cw, mw, b, err);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = { id, what: what.value.trim(), when: when.words(), kind: kind.value };
    if (!cw.hidden) v.check = check.value.trim();
    if (!mw.hidden && model.value) v.model = model.value;
    err.textContent =
      (!v.what && "Say what it should do.") ||
      (!v.when && "Say when it runs.") ||
      (!v.kind && "Pick a kind.") ||
      (v.check === "" && "Name the check.") ||
      "";
    if (err.textContent) return;
    b.disabled = true;
    const s = await api("repeat", v).catch(
      (x) => Object.assign(err, { textContent: `${x.message}: ${x.fix}` }) && 0,
    );
    b.disabled = false;
    if (s?.task) done(s.task);
    else if (s) err.textContent = s.text;
  };
  return f;
}

// ---------------------------------------------------------------- Repeats

/** A button that sends its words to a task (Sure? first, when asked), then reads the page again. */
const act = (l, n, w, sure = false, c = "", done = () => A.reread()) =>
  A.btn(
    l,
    async (e) => (!sure || confirm("Sure?")) && (await A.quick(n, w, 0, e.currentTarget)) && done(),
    c,
  );
const live = (on) => A.dot(on ? "ok" : "closed", on ? "on" : "paused");
const isOn = (r) => A.R.turned[r.n]?.open ?? r.open;
// One you stopped here, for five minutes: back after that only if the stop didn't take.
const shown = (r) => !(Date.now() - (A.R.gone[r.n] || 0) < 3e5);

const rep = (r) => {
  const on = isOn(r);
  const next = on && r.next && `next ${A.until(r.next)}`;
  const flip = (open) => () => A.moved(r.n, open, { title: r.title, from: "repeat" }) || A.reread();
  const pause = on
    ? act("Pause", r.n, "close", false, "", flip(false))
    : act("Resume", r.n, "resume", false, "", flip(true));
  const change = A.btn("Change", () => A.start("Change it to: ", `#/t/${r.n}`));
  const acts = h("span.acts", act("Run now", r.n, "again"), pause, change);
  // Stopped: it leaves at once (its run takes the label off in a minute or so).
  const stopped = () => {
    A.R.gone[r.n] = Date.now();
    flip(false)();
  };
  acts.append(act("Stop", r.n, "stop repeating", true, ".danger", stopped));
  return [A.what(A.to(r.n, `#${r.n} ${r.title}`), live(on), A.meta(r.every, next)), acts];
};
const recipe = (r) => {
  const next = !r.paused && r.next && `next ${A.until(r.next)}`;
  const at = r.task ? A.to(r.task, `Task #${r.task}`) : A.ext(r.url, "On GitHub", ".chip");
  // A recipe is a file: for good, it's a change that removes it, which you send and then merge.
  const gone = r.paused
    ? A.btn("Remove", () => A.start(`shipify: remove the recipe ${r.name} (recipes/${r.name}.md)`))
    : "";
  return [A.what(h("b", r.name), live(!r.paused), A.meta(r.every, next)), h("span.acts", gone, at)];
};
const newRepeat = (e) => e.currentTarget.replaceWith(repeatForm(A.S.menu, (n) => A.go(`#/t/${n}`)));

/** What runs, then what's paused, folded away: a stopped repeat isn't here at all. */
export function repeats() {
  A.page(
    "Repeats",
    "repeats",
    (d) => {
      const mine = d.repeats.filter(shown);
      const paused = [...mine.filter((r) => !isOn(r)), ...d.recipes.filter((r) => r.paused)];
      return [
        h("h3", "Your repeats"),
        A.list(mine.filter(isOn), rep, "Nothing repeats now."),
        h("h3", "Waiting"),
        A.list(d.waiting ?? [], (r) => A.what(A.to(r.n), r.every), "Nothing waits."),
        h("h3", "Recipes"),
        A.list(
          d.recipes.filter((r) => !r.paused),
          recipe,
          "No recipes running.",
        ),
        paused.length
          ? h(
              "details.paused",
              h("summary", `Paused (${paused.length})`),
              A.list(paused, (x) => ("n" in x ? rep(x) : recipe(x)), ""),
            )
          : "",
      ];
    },
    () => A.btn([icon("plus"), "New repeat"], newRepeat, ".primary"),
  );
}
