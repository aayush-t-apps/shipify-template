// @ts-check
// Shipify chat: a pull down to refresh, on a phone (compose.js `refresher`), loaded on the first
// touch, so the first screen doesn't carry it. One finger from the top of the list, a thread or a
// page, let go past 80px (↻ lit: `pull`): ↻'s read. The browser's own pull stays off (app.css): it
// would reload the page, and lose what you typed.

/** What the page lends (app.js `lazy`): nothing needed. */
export const init = () => {};

const b = document.body.classList;
let y = Number.NaN;
let go;
const on = (k, f) => addEventListener(k, f, { passive: true });
on("touchmove", (e) => b.toggle("pull", e.touches[0].clientY - y > 80));
on("touchend", () => b.contains("pull") && go() && b.remove("pull"));

/** A touch begins (`f`, ↻'s read): one finger at the top of what scrolls may pull. */
export function start(e, f) {
  const s = !e.touches[1] && e.target.closest("#list, .msgs, .page");
  y = s?.scrollTop < 1 ? e.touches[0].clientY : Number.NaN;
  go = f;
  b.remove("pull");
}
