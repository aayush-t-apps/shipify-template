// @ts-check
// Shipify chat: helpers, and the box you write in (files, photos, / commands). The model picker
// (pick.js), a file's upload (attach.js) and New repeat (repeat.js) load the first time they open.

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
/** A pick as the chip says it ("Pi · Vercel · glm-5.3 · High"), once the menu is there. */
export const said = (m, s) => (s && m?.agents ? label(m, read(m, s)) : pretty(s));
export const size = (b) => (b < 1e6 ? `${Math.ceil(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);
/**
 * The run a task's clock times, the same in its row and its header: the turn its thread's status
 * says is `working` (from that answer's start), else the job the list knows (from the job's). A run
 * that stays after its answer (ADR 0057) began with the stay: its job never times a turn.
 */
export const timed = (staying, turn, job) => turn || (!staying && job) || undefined;

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
  reload: "M21 5v5h-5M19 14.5a7.5 7.5 0 1 1-1.8-7.8L21 10",
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
export const fail = (j, off = false) =>
  Object.assign(new Error(j?.error || (off ? "Offline" : "The edge gave an odd answer")), {
    fix: j?.fix ?? "Try again in a minute.",
    off,
  });

const tags = {};
// GETs (or POSTs) JSON under api/; null means unchanged (304). Given up after 20s, so a stalled
// network never stops the polling: with the network up, that's the edge slow (`late`), never
// "Offline". The chat's routes never redirect: a redirect is Access's sign-in, its session ended
// (followed, it would fail as if offline, and stay stale).
// A GET's ETag is kept by `k`, its path unless said: "" keeps none, for a read whose answer is
// kept apart from the path's (a 304 is only for the copy that has its ETag).
export async function api(p, body, k = p) {
  const headers = { "x-shipify-chat": "1", "if-none-match": (!body && tags[k]) || "" };
  if (body) headers["content-type"] = "application/json";
  /** @type {RequestInit} */
  // A GET with a body (`0` too) is never sent.
  const init = { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : null };
  init.signal = AbortSignal.timeout(2e4);
  init.redirect = "manual";
  const r = await fetch(`api/${p}`, init).catch((e) => e);
  if (r?.name === "TimeoutError" && navigator.onLine !== false)
    throw Object.assign(fail({ error: "The edge didn't answer in 20 s" }), { late: true });
  if (!r || r instanceof Error) throw fail(null, true);
  if (r.type === "opaqueredirect")
    throw Object.assign(fail({ error: "Your sign-in ended", fix: "Tap to sign in again." }), {
      signin: true,
    });
  if (r.status === 304) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw Object.assign(fail(j), { status: r.status });
  if (!body && k) tags[k] = r.headers.get("etag") || "";
  return j;
}

/** A file deleted (ADR 0069): Files' Delete, one taken off the box, an old draft's. */
export const unfile = (ref) =>
  fetch(`api/file/${ref}`, { method: "DELETE", headers: { "x-shipify-chat": "1" } });
// A draft untouched for 30 days goes, with the files sent up for it.
try {
  for (const k of Object.keys(localStorage)) {
    const d = /^shipify-draft-/.test(k) && JSON.parse(localStorage[k]);
    if (Date.now() - (d?.t || Date.now()) > 2592e6) {
      localStorage.removeItem(k);
      for (const f of d.f || []) if (f.u) unfile(f.ref).catch(Boolean);
    }
  }
} catch {}

export function pop(at, items, cls = "") {
  $(".pop")?.close();
  const m = h(`div.pop${cls && `.${cls}`}`, {
    role: "menu",
    onkeydown: (e) => e.key === "Escape" && close(),
  });
  // Closed, it lets go of what it listened with.
  const close = () => {
    m.remove();
    ro.disconnect();
    removeEventListener("click", off, true);
  };
  m.close = close;
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
  const ro = new ResizeObserver(left);
  ro.observe(m);
  m.querySelector("button")?.focus();
  setTimeout(() => m.isConnected && addEventListener("click", off, true));
  return item;
}

/** ↻ (ADR 0049), or a pull down (pull.js, loaded on the first touch): `f` reads, one at a time. */
export function refresher(f) {
  const b = document.body.classList;
  const go = async () => {
    if (b.contains("spin")) return;
    b.add("spin");
    await f().finally(() => b.remove("spin"));
  };
  const pull = (e) => import("./pull.js").then((m) => m.start(e, go), Boolean);
  addEventListener("touchstart", pull, { passive: true });
  return go;
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
 * @param {{menu:any, task?:number, dk?:number, model?:string, words?:string, root:any, send:Function, label?:Function, fill?:Function, attach?:Function, stop?:Function|false, state?:Function}} o
 */
export function composer(o) {
  // The menu as it is now: a newer one comes in place (`o.menu`), the box kept as it is.
  const m = () => o.menu || NONE;
  const touch = matchMedia("(pointer:coarse)").matches;
  // Your words and files sent up wait in the browser, a key a task, till they're sent: iOS closing
  // the app loses neither. A project's box (ADR 0069) replies to none: its draft is by its number.
  const DK = `shipify-draft-${o.dk || o.task || 0}`;
  let kept = "";
  let was = {};
  try {
    was = JSON.parse(localStorage.getItem(DK) || "{}");
    if (was.w || was.f) kept = JSON.stringify({ w: was.w, f: was.f });
  } catch {}
  let files = (was.f || []).map((f) => ({ ...f, abort() {} }));
  let use = "";
  let warned = "";
  let msg = "";
  const ta = h("textarea", { rows: 1, "aria-label": "Message" });
  Object.assign(ta, {
    placeholder: o.task ? "Reply" : "Ask anything, or attach a file",
    value: o.words || was.w || "",
  });
  // `u`: sent up from this box, so taking it off (or the draft going) deletes it.
  const refs = () =>
    files
      .filter((f) => f.ref)
      .map(({ ref, name, type, size, u }) => ({ ref, name, type, size, u }));
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
  // Files shared from another app wait for the menu (it says if files are on), never dropped unsaid.
  let held = [];
  const take = () => {
    if (!o.menu || !held.length) return;
    const l = held;
    held = [];
    if (m().files.on) add(l);
    else msg = "Files aren't set up, so what you shared wasn't attached.";
  };
  const state = () => {
    take();
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
    const as = long &&
      m().files.on && [
        " ",
        h("button.btn", { type: "button", onclick: asFile }, "Attach as a file"),
      ];
    set(hint, msg || bad || (up && "Uploading…") || (bare && "Say what they're for.") || sec, as);
    const f = refs();
    const k = w || f.length ? JSON.stringify({ w: ta.value, f }) : "";
    if (k === kept) return;
    kept = k;
    try {
      // When it changed last (`t`): a draft untouched for 30 days goes (above).
      if (k) localStorage.setItem(DK, JSON.stringify({ w: ta.value, f, t: Date.now() }));
      else localStorage.removeItem(DK);
    } catch {}
  };
  o.state = state;
  // Taken off the box: one sent up from it is deleted at once (ADR 0069).
  const drop = (it) => {
    it.abort();
    if (it.url) URL.revokeObjectURL(it.url);
    if (it.u && it.ref) unfile(it.ref).catch(Boolean);
    files = files.filter((f) => f !== it);
    draw();
  };
  const att = (it) => {
    const x = h(
      "button.icon",
      { type: "button", "aria-label": `Remove ${it.name}`, onclick: () => drop(it) },
      icon("x"),
    );
    const retry = it.err && h("button", { type: "button", onclick: () => put(it, "put") }, "Retry");
    const bar = !it.ref && !it.err && h("progress", { max: 1, value: it.p });
    it.bar = bar;
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
  // A file added is in the box at once, so Send waits ("Uploading…") while a photo is made smaller
  // and sent up: attach.js, loaded the first time, does both (`add`), and Retry (`put`).
  const box = {
    task: o.task,
    m,
    draw,
    drop,
    say: (t) => (msg = t),
    has: (it) => tray.isConnected && files.includes(it),
    signin: () => o.signin?.(),
  };
  const put = (it, k) =>
    import("./attach.js").then(
      (a) => a[k](it, box),
      () => {
        msg = "Files didn't load: try again once you're online.";
        drop(it);
      },
    );
  const add = (list) => {
    msg = "";
    for (const file of list) {
      if (files.length >= m().files.most) {
        msg = `At most ${m().files.most} files a message.`;
        break;
      }
      const it = { file, name: file.name, type: file.type, size: file.size, u: 1, abort() {} };
      files.push(it);
      put(it, "add");
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
  // The picker is pick.js, loaded the first time, with its stylesheet.
  chip.onclick = () =>
    import("./pick.js").then((p) => p.init().then(() => p.picker(chip, m(), now, choose, o.task)));
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
    // A new chat on the default agent's Auto needs no `use` line.
    const p = read(m(), use);
    const plain = !o.task && p.a === (m().agents?.[0] || p.a) && p.model === "auto" && !p.effort;
    const u = plain ? undefined : use || undefined;
    const prev = files.filter((f) => f.url).map((f) => f.url);
    o.send({ id: uid(), task: o.task, words, use: u, files: refs() }, prev);
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
    // Safari ends a word being composed (Japanese, Chinese…) with an Enter of its own: 229.
    if (e.key !== "Enter" || e.shiftKey || touch || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };
  const now14 = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const named = (x) =>
    x.type === "image/png" ? new File([x], `screenshot-${now14()}.png`, { type: x.type }) : x;
  // A paste over the limit: the words go as a file, and the box is free for a line about it.
  function asFile() {
    const f = new File([ta.value], `message-${now14()}.txt`, { type: "text/plain" });
    ta.value = "";
    ta.oninput();
    add([f]);
  }
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
  // A file the chat keeps (the doc pane's Ask about this): it goes as it is, nothing to upload.
  o.attach = (f) => {
    if (files.length < m().files.most && !files.some((x) => x.ref === f.ref))
      files.push({ ...f, abort() {} });
    draw();
    ta.focus();
  };
  // Files shared from another app (sw.js), as if picked, once the menu says files are on.
  o.add = (l) => held.push(...l) && state();
  pick.onchange = () => {
    add([...pick.files]);
    pick.value = "";
  };
  clip.onclick = () => pick.click();
  o.label();
  draw();
  if (!touch) setTimeout(() => ta.focus());
  const field = h("div.field", tray, ta, h("div.under", clip, chip, go));
  const f = h("form.compose", cmds, field, hint, pick);
  // Only the button stops a run, never Enter in an empty box.
  f.onsubmit = (e) => e.preventDefault() || (halt() ? o.stop() : submit());
  return f;
}

// ---------------------------------------------------------------- a pick, as the chip says it

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

/** The chip's words: "Opus · High", "Pi · glm-5.3", "Auto · Sonnet" (what Auto runs, if short). */
export function label(m, p) {
  const A = p.a.auto?.model;
  const name = p.model === "auto" ? `Auto${A && !p.a.gateway ? ` · ${nm(A)}` : ""}` : nm(p.model);
  return [p.a !== m.agents?.[0] && (p.a.name || cap(p.a.id)), name, p.effort && cap(p.effort)]
    .filter(Boolean)
    .join(" · ");
}
