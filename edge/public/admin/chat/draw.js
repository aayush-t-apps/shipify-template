// @ts-check
// Shipify chat: diagrams, loaded the first time a message has one, so the first screen doesn't
// carry it. A ```mermaid block is drawn in /draw/, a sandboxed frame (Mermaid never runs here), and
// comes back as SVG, shown as a picture (one runs no script). Its source stays, with Copy, if it
// doesn't draw. Each picture is kept by its source while the page is open: a thread opened again
// draws at once.
import { h } from "./compose.js";

/** What the page lends (app.js `lazy`): nothing needed. */
export const init = () => {};

const MER = /```mermaid.*\n([\s\S]*?)```/g;
const SVG = new Map();

/** The diagrams in a message's Markdown (`text`), drawn in its element `md`. */
export function draw(md, text) {
  const src = [...text.replace(/\r/g, "").matchAll(MER)].map((m) => m[1].trim());
  for (const pre of md.querySelectorAll("pre")) {
    const s = pre.textContent.trim();
    if (!src.includes(s)) continue;
    // Its block (with Copy): the picture takes its place once drawn.
    const b = pre.closest(".code") || pre;
    const pic = (svg) => h("img", { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, alt: s });
    const drawn = (svg) => b.replaceWith(pic(svg));
    if (SVG.has(s)) {
      drawn(SVG.get(s));
      continue;
    }
    const at = `/draw/#${encodeURIComponent(s)}`;
    const f = h("iframe.draw", { src: at, sandbox: "allow-scripts" });
    f.drawn = (svg) => drawn(SVG.set(s, svg).get(s));
    b.before(f);
  }
}
addEventListener("message", (e) => {
  const f = [...document.querySelectorAll(".draw")].find((x) => x.contentWindow === e.source);
  const svg = e.data?.draw;
  if (!f || typeof svg !== "string") return;
  f.remove();
  if (svg.startsWith("<svg") && svg.length < 2e6) f.drawn(svg);
});
