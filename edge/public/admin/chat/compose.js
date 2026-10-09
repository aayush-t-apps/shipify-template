// @ts-check
// Shipify chat: helpers, the box you write in (files, photos, / commands), New repeat, and the
// model picker.

/**
 * An element: "tag.class", then attributes if any (`on…` listen), then children (falsy left out).
 * @param {string} t @param {any[]} k @returns {any}
 */
export function h(t, ...k) {
  const [tag, ...c] = t.split(".");
  const e = document.createElement(tag);
  const a = k[0]?.constructor === Object ? k.shift() : {};
  if (c.length) e.className = c.join(" ");
  for (const [n, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (n.startsWith("on")) e.addEventListener(n.slice(2), v);
    else e.setAttribute(n, v === true ? "" : v);
  }
  e.append(...k.flat(9).filter(Boolean));
  return e;
}
export const set = (e, ...k) => e.replaceChildren(...k.flat(9).filter(Boolean));
export const $ = (s) => document.querySelector(s);
export const uid = () => crypto.randomUUID().replace(/-/g, "");
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// A model as shown: an alias capitalised ("Sonnet"), a gateway's id by its name ("kimi-k3").
export const nm = (s) => (s.includes("/") ? s.replace(/^\S*\//, "") : cap(s));
export const pretty = (s) => (s ? s.split(" ").map(nm).join(" · ") : "Auto");
export const size = (b) => (b < 1e6 ? `${Math.ceil(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);

// Icons: one stroked path each, on a 24px grid; the stylesheet gives them their size and colour.
const P = {
  seen: "M2 12.5l4 4L15 7.5M10 15.5l1 1L20 7.5",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  down: "M7 10l5 5 5-5",
  x: "M6 6l12 12M18 6L6 18",
  send: "M12 19V5M6 11l6-6 6 6",
  stop: "M8 8h8v8H8z",
  clip: "M20 11.5l-8.2 8.2a5 5 0 0 1-7-7L13 4.5a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4L15 7.3",
  search: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM20 20l-4.8-4.8",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  chat: "M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  app: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7",
  pin: "M7 3h10v18l-5-4-5 4z",
  repeat: "M17 3l3 3-3 3M4 12V10a4 4 0 0 1 4-4h12M7 21l-3-3 3-3M20 12v2a4 4 0 0 1-4 4H4",
  book: "M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2zM5 20a2 2 0 0 0 2 1h12v-3",
  folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  gear: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  pulse: "M3 12h4l3-7 4 14 3-7h4",
  copy: "M9 9h11v11H9zM5 15V4h11",
  save: "M12 4v11M7 10l5 5 5-5M5 20h14",
  open: "M14 4h6v6M20 4l-9 9M19 14v6H4V5h6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  box: "M4 4h16v7H4zM4 13h16v7H4zM8 7.5h.01M8 16.5h.01",
  spark: "M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z",
};
const NS = "http://www.w3.org/2000/svg";
/** @param {keyof typeof P} n */
export function icon(n) {
  const s = document.createElementNS(NS, "svg");
  const p = document.createElementNS(NS, "path");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  p.setAttribute("d", P[n]);
  s.append(p);
  return s;
}
const fail = (j, off = false) =>
  Object.assign(new Error(j?.error || (off ? "Offline" : "The edge gave an odd answer")), {
    fix: j?.fix ?? "Try again in a minute.",
    off,
  });

const tags = {};
// GETs (or POSTs) JSON under api/; null means unchanged (304). Given up after 20s, as offline, so
// a stalled network never stops the polling. The chat's routes never redirect: a redirect is
// Access's sign-in, its session ended (followed, it would fail as if offline, and stay stale).
export async function api(p, body) {
  const headers = { "x-shipify-chat": "1", "if-none-match": (!body && tags[p]) || "" };
  if (body) headers["content-type"] = "application/json";
  /** @type {RequestInit} */
  const init = { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) };
  init.signal = AbortSignal.timeout(2e4);
  init.redirect = "manual";
  const r = await fetch(`api/${p}`, init).catch(() => null);
  if (!r) throw fail(null, true);
  if (r.type === "opaqueredirect")
    throw Object.assign(fail({ error: "Your sign-in ended", fix: "Tap to sign in again." }), {
      signin: true,
    });
  if (r.status === 304) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw fail(j);
  if (!body) tags[p] = r.headers.get("etag") || "";
  return j;
}

function upload(f, onp) {
  const x = new XMLHttpRequest();
  const p = new Promise((ok, no) => {
    x.open("POST", "api/file");
    x.responseType = "json";
    x.setRequestHeader("x-shipify-chat", "1");
    x.setRequestHeader("content-type", f.type || "application/octet-stream");
    x.setRequestHeader("x-file-name", encodeURIComponent(f.name));
    x.upload.onprogress = (e) => onp(e.loaded / e.total);
    x.onload = () => (x.status < 300 && x.response?.ref ? ok(x.response) : no(fail(x.response)));
    x.onerror = () => no(fail(null, true));
    x.onabort = x.onerror;
    x.send(f);
  });
  return { p, abort: () => x.abort() };
}

// A photo at most 2048px, the right way up, without EXIF or location; small PNGs as they are.
async function shrink(f) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type)) return f;
  try {
    const b = await createImageBitmap(f, { imageOrientation: "from-image" });
    const s = Math.min(1, 2048 / Math.max(b.width, b.height));
    if (f.type === "image/png" && s === 1) return f;
    const c = h("canvas", { width: Math.round(b.width * s), height: Math.round(b.height * s) });
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(b, 0, 0, c.width, c.height);
    const o = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return o ? new File([o], `${f.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}

export function pop(at, items, cls = "") {
  $(".pop")?.remove();
  const m = h(`div.pop${cls && `.${cls}`}`, {
    role: "menu",
    onkeydown: (e) => e.key === "Escape" && close(),
  });
  const close = () => m.remove() || removeEventListener("click", off, true);
  const off = (e) => m.contains(e.target) || close();
  const item = ([l, f]) => h("button", { type: "button", onclick: () => close() || f() }, l);
  // A string is a heading over the items; an element goes as it is.
  const one = (x) => (typeof x === "string" ? h("small.sec", x) : x.nodeType ? x : item(x));
  m.append(...items.filter(Boolean).map(one));
  const r = at.getBoundingClientRect();
  // Where it goes, as variables the stylesheet uses (a sheet on a phone sets its own).
  const up = r.top > innerHeight / 2;
  m.style.setProperty(up ? "--b" : "--t", `${up ? innerHeight - r.top : r.bottom}px`);
  document.body.append(m);
  // Within the screen, however wide it grows (a search's results).
  const left = () =>
    m.style.setProperty(
      "--l",
      `${Math.max(4, Math.min(r.left, innerWidth - m.offsetWidth - 4))}px`,
    );
  left();
  new ResizeObserver(left).observe(m);
  m.querySelector("button")?.focus();
  setTimeout(() => addEventListener("click", off, true));
  return item;
}

// A key's shape: a PEM header, word_ and 20+, or a long mixed-case run with digits.
export const secret = (s) =>
  /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}|\b[A-Za-z]+_[A-Za-z0-9]{20,}\b/.test(s) ||
  s
    .split(/\s+/)
    .some((w) => /^[\w+/=-]{32,}$/.test(w) && /\d/.test(w) && /[a-z].*[A-Z]|[A-Z].*[a-z]/.test(w));

const NONE = { models: [], commands: [], files: {} };

/**
 * The box you write in; `o.send(body, previews, note)` takes over once it's sent.
 * @param {{menu:any, task?:number, model?:string, words?:string, root:any, send:Function, label?:Function, fill?:Function, stop?:Function|false, state?:Function}} o
 */
export function composer(o) {
  // The menu as it is now: a newer one comes in place (`o.menu`), the box kept as it is.
  const m = () => o.menu || NONE;
  const touch = matchMedia("(pointer:coarse)").matches;
  let files = [];
  let use = "";
  let warned = "";
  let msg = "";
  const ta = h("textarea", { rows: 1, "aria-label": "Message" });
  Object.assign(ta, {
    placeholder: o.task ? "Reply" : "Ask anything, or attach a file",
    value: o.words || "",
  });
  const hint = h("p.hint", { "aria-live": "polite" });
  const tray = h("div.tray");
  const cmds = h("div.cmds", { hidden: true });
  const pick = h("input", { type: "file", multiple: true, hidden: true });
  const clip = h("button.icon", { type: "button" }, icon("clip"));
  // Who thinks, with what and how hard: one chip, its picker (below).
  const chip = h("button.chip", { type: "button", title: "Model" });
  const go = h("button.send", { "aria-label": "Send" }, icon("send"));
  const now = () => read(m(), use || o.model);
  o.label = () => {
    set(chip, h("span", label(m(), now())), icon("down"));
    chip.classList.toggle("next", Boolean(o.task && use));
  };
  // Empty while a run works (`o.stop`): the send button stops it.
  const halt = () => o.stop && !ta.value.trim() && !files.length;
  const state = () => {
    const w = ta.value.trim();
    const up = files.some((f) => !f.ref);
    const bare = !o.task && files.length > 0 && !w;
    const most = m().chars || 16e3;
    clip.disabled = !m().files.on;
    clip.title = clip.ariaLabel = m().files.on ? "Attach files" : "Files aren't set up";
    const long = w.length > most;
    const s = halt();
    set(go, icon(s ? "stop" : "send"));
    go.title = go.ariaLabel = s ? "Stop the run" : "Send";
    go.classList.toggle("halt", !!s);
    go.disabled = !s && (up || bare || long || !(w || files.length));
    const bad =
      (long && `${w.length - most} characters over ${most}: attach it as a file, or split it.`) ||
      (files.some((f) => f.err) && "Retry or remove the file that failed.");
    const sec =
      warned &&
      "This looks like a secret: use pnpm ship add <tool> on your PC instead. Send again to send it.";
    hint.textContent =
      msg || bad || (up && "Uploading…") || (bare && "Say what they're for.") || sec;
  };
  o.state = state;
  const drop = (it) => {
    it.abort();
    files = files.filter((f) => f !== it);
    draw();
  };
  const att = (it) => {
    const x = h(
      "button.icon",
      { type: "button", "aria-label": `Remove ${it.name}`, onclick: () => drop(it) },
      icon("x"),
    );
    const retry = it.err && h("button", { type: "button", onclick: () => put(it) }, "Retry");
    const bar = !it.ref && !it.err && h("progress", { max: 1, value: it.p });
    const name = h("span", it.name, h("small", it.err || size(it.size)));
    return h(
      "div.att",
      it.url ? h("img", { src: it.url, alt: "" }) : icon("file"),
      name,
      bar,
      retry,
      x,
    );
  };
  const draw = () => set(tray, files.map(att)) || state();
  const put = (it) => {
    const u = upload(it.file, (p) => Object.assign(it, { p }) && draw());
    Object.assign(it, { err: "", p: 0, abort: u.abort });
    const no = (e) => Object.assign(it, { err: `${e.message}: ${e.fix}` });
    u.p.then((r) => Object.assign(it, r), no).finally(draw);
    draw();
  };
  const add = async (list) => {
    msg = "";
    for (const f0 of list) {
      if (files.length >= m().files.most) {
        msg = `At most ${m().files.most} files a message.`;
        break;
      }
      const f = await shrink(f0);
      if (f.size > m().files.bytes) msg = `${f.name} is over ${size(m().files.bytes)}.`;
      else {
        if (/^(audio|video)\//.test(f.type)) msg = "A run can't listen to or watch this.";
        const url = /^image\//.test(f.type) && URL.createObjectURL(f);
        const it = { file: f, name: f.name, type: f.type, size: f.size, url };
        files.push(it);
        put(it);
      }
    }
    draw();
  };
  // A pick goes with your next message: no run starts only to change a model.
  const choose = (v) => {
    use = v;
    o.label?.();
    o.after?.();
  };
  // What's ticked is what the task's runs use; a pick stays until you pick again.
  chip.onclick = () => picker(chip, m(), now, choose, o.task);
  // A reply's Another model: the same picker.
  o.pick = () => chip.onclick();
  const fill = (c) => {
    Object.assign(ta, { value: `/${c} ` }).focus();
    cmds.hidden = true;
  };
  const cmd = ([c, about]) =>
    h("button", { type: "button", onclick: () => fill(c) }, h("b", `/${c}`), ` ${about}`);
  const slash = () => {
    const v = ta.value;
    set(
      cmds,
      (/^\/\S*$/.test(v) ? m().commands : []).filter(([c]) => `/${c}`.startsWith(v)).map(cmd),
    );
    cmds.hidden = !cmds.children.length;
  };
  const submit = () => {
    state();
    const words = ta.value.trim();
    if (go.disabled || halt()) return;
    if (secret(words) && warned !== words) {
      warned = words;
      return state();
    }
    const refs = files.map(({ ref, name, type, size }) => ({ ref, name, type, size }));
    // A new chat on the default agent's Auto needs no `use` line.
    const p = read(m(), use);
    const plain = !o.task && p.a === (m().agents?.[0] || p.a) && p.model === "auto" && !p.effort;
    const u = plain ? undefined : use || undefined;
    const prev = files.filter((f) => f.url).map((f) => f.url);
    o.send({ id: uid(), task: o.task, words, use: u, files: refs }, prev);
    o.model = use || o.model;
    Object.assign(ta, { value: "" }).style.height = "";
    files = [];
    use = /^\//.test(words) ? use : "";
    msg = "";
    draw();
    o.label?.();
  };
  ta.oninput = () => {
    warned = "";
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 160)}px`;
    slash();
    state();
  };
  ta.onkeydown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || touch || e.isComposing) return;
    e.preventDefault();
    submit();
  };
  const shot = () => `screenshot-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.png`;
  const named = (x) => (x.type === "image/png" ? new File([x], shot(), { type: x.type }) : x);
  ta.onpaste = (e) => {
    const f = [...(e.clipboardData?.files || [])];
    if (!f.length || !m().files.on) return;
    e.preventDefault();
    add(f.map(named));
  };
  // A starter: its words in the box, and the file picker for one about a file.
  o.fill = (w, file) => {
    Object.assign(ta, { value: w }).focus();
    ta.oninput();
    if (file && m().files.on) pick.click();
  };
  pick.onchange = () => add([...pick.files]) && Object.assign(pick, { value: "" });
  clip.onclick = () => pick.click();
  o.root.ondragover = (e) => e.preventDefault();
  o.root.ondrop = (e) => e.preventDefault() || (m().files.on && add([...e.dataTransfer.files]));
  o.label();
  state();
  if (!touch) setTimeout(() => ta.focus());
  const field = h("div.field", tray, ta, h("div.under", clip, chip, go));
  const f = h("form.compose", cmds, field, hint, pick);
  // Only the button stops a run, never Enter in an empty box.
  f.onsubmit = (e) => e.preventDefault() || (halt() ? o.stop() : submit());
  return f;
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
  const model = h("select", opts(r.models));
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

// ---------------------------------------------------------------- the model picker
// Who thinks, with what and how hard: the agent (tabs), its models (and a search), the effort.

/** A pick ("pi z-ai/glm-5.3 high", "opus", "auto") read against the menu: agent, model, effort. */
export function read(m, s) {
  const as = m.agents?.length ? m.agents : [{ id: "", models: m.models || [], auto: m.auto }];
  const w = (s || "auto").toLowerCase().split(" ");
  const a = as.find((x) => x.id === w[0]) || as[0];
  if (a.id && a.id === w[0]) w.shift();
  // An effort alone ("high") is Auto's at that effort; `auto` as an effort is the default one.
  if (a.efforts?.includes(w[0])) w.unshift("auto");
  return { a, model: w[0] || "auto", effort: w[1] === "auto" ? "" : w[1] || "" };
}

/**
 * A pick as a `use` line says it: its agent named when there's a choice, so it holds from either,
 * and `auto` said, so Auto (or, as an effort, the default) resets what was picked before.
 */
const say = (m, p, reset = false) =>
  [m.agents?.[1] && p.a.id, p.model, p.effort || (reset && p.model !== "auto" && "auto")]
    .filter(Boolean)
    .join(" ");

/** The chip's words: "Opus · High", "Pi · glm-5.3", "Auto · Sonnet" (what Auto runs, if short). */
export function label(m, p) {
  const A = p.a.auto?.model;
  const name = p.model === "auto" ? `Auto${A && !p.a.gateway ? ` · ${nm(A)}` : ""}` : nm(p.model);
  return [p.a !== m.agents?.[0] && cap(p.a.id), name, p.effort && cap(p.effort)]
    .filter(Boolean)
    .join(" · ");
}

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
  const chips = h("div.chips");
  const list = h("div.list");
  const foot = h("div.effort");
  const done = h("button.btn.primary", { type: "button" }, "Done");
  const known = (id) => FACTS[tab.id]?.get(id) || found?.models?.find((x) => x.id === id) || {};
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
    const keep = (id) => (efforts(tab, id).includes(p.effort) ? p.effort : "");
    const opt = (id) => row(id, { a: tab, model: id, effort: keep(id) }, mine && p.model === id);
    const listed = (tab.models || []).map((x) => x.id).filter((id) => id.includes(w) && fits(id));
    const more = (found?.models || [])
      .map((x) => x.id)
      .filter((id) => !listed.includes(id) && fits(id));
    const A = tab.auto || {};
    set(
      agents,
      m.agents?.[1] &&
        m.agents.map((a) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": String(a === tab),
              onclick: () => {
                tab = a;
                q.value = "";
                found = null;
                want.clear();
                load();
              },
            },
            h("b", cap(a.id)),
            h("small", a === m.agents[0] ? "default" : a.gateway || ""),
          ),
        ),
    );
    q.hidden = chips.hidden = !tab.gateway;
    set(
      chips,
      Object.keys(FILTERS).map((k) => {
        const flip = () => {
          if (!want.delete(k)) want.add(k);
          draw();
        };
        const b = h("button.chip", { type: "button", onclick: flip }, k);
        b.ariaPressed = String(want.has(k));
        return b;
      }),
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
    // The efforts the picked model takes: the agent's, as far as its gateway says the model has.
    const own = known(p.model).efforts;
    const e = mine
      ? efforts(tab, p.model).filter((x) => !own || x === "off" || own.includes(x))
      : [];
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
    FACTS[a.id] = new Map((r?.models || []).map((x) => [x.id, x]));
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
  item = pop(at, [head, agents, q, chips, list, foot], "pick");
  done.onclick = () => $(".pop")?.remove();
  load();
  (matchMedia("(pointer:fine)").matches && !q.hidden
    ? q
    : list.querySelector(".ck")?.parentElement
  )?.focus();
}
