// @ts-check
// Shipify chat: Find in this chat (ADR 0069), loaded the first time it opens, so the first screen
// doesn't carry it. A row under a thread's head: the messages read here, newest first; Enter (or ↓)
// the next, ⇧Enter back, Escape closes it.
import { h, icon } from "./compose.js";

/** What the page lends (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;
export const init = (a) => {
  A = a;
};

/** A round button with only its icon: its name said on hover and to a screen reader. */
const ib = (k, f, l) => {
  const b = A.btn(icon(k), f, ".icon");
  b.ariaLabel = b.title = l;
  return b;
};

/** Opens the row in the thread's view `v` (made once a view), its box ready to type in. */
export function find(v) {
  if (!v.find) {
    const keys = (e) => {
      if (e.key === "Escape") return hide();
      if (e.key !== "Enter") return;
      e.preventDefault();
      hop(e.shiftKey ? -1 : 1);
    };
    v.q = h("input", { type: "search", "aria-label": "Find in this chat", onkeydown: keys });
    v.q.placeholder = "Find in this chat";
    v.q.oninput = () => {
      v.i = 0;
      hop(0);
    };
    v.hit = h("small", { "aria-live": "polite" });
    const hide = () => {
      v.find.hidden = true;
      v.q.value = "";
      hop(0);
    };
    const next = ib("down", () => hop(1), "Next");
    v.find = h("div.find", icon("search"), v.q, v.hit, next, ib("x", hide, "Close"));
    v.i = 0;
    v.head.after(v.find);
  }
  v.find.hidden = false;
  v.q.focus();
}

/**
 * The hits for the words in the open view's box, newest first; `d` moves on (or back) one, drawing
 * older messages when the hit is among them.
 */
function hop(d) {
  const v = A.R.v;
  const t = A.S.threads[v.n];
  const w = v.q.value.trim().toLowerCase();
  const l =
    w && t ? t.messages.filter((x) => !x.tap && x.md.toLowerCase().includes(w)).reverse() : [];
  if (l.length) v.i = (v.i + d + l.length) % l.length;
  v.hit.textContent = w && (l.length ? `${v.i + 1}/${l.length}` : "None");
  v.box.querySelector(".hit")?.classList.remove("hit");
  const x = l[v.i];
  if (!x) return;
  if (!v.done.get(x.id)?.isConnected) {
    v.from = x.id;
    A.redraw();
  }
  v.done.get(x.id)?.classList.add("hit");
  v.done.get(x.id)?.scrollIntoView({ block: "center" });
}
