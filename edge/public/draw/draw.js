// @ts-nocheck
// The chat's diagram frame (ADR 0036): draws the Mermaid source in this address's #fragment and
// hands the chat the SVG ({ draw: "<svg…" }), which it shows as a picture; { draw: "" } when it
// doesn't draw, so the chat keeps the source. It runs in a sandbox with no origin of its own, and
// holds nothing but the diagram. Labels are plain SVG text, so the picture needs no HTML inside.
const tell = (svg) => parent.postMessage({ draw: svg }, "*");
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
try {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: dark ? "dark" : "default",
  });
  mermaid.render("d0", decodeURIComponent(location.hash.slice(1))).then(
    ({ svg }) => {
      const box = document.getElementById("d");
      box.innerHTML = svg;
      const s = box.querySelector("svg");
      const v = s.viewBox.baseVal;
      // Its own size, so it shows as big as it was drawn, and smaller on a phone.
      s.setAttribute("width", String(Math.ceil(v.width)));
      s.setAttribute("height", String(Math.ceil(v.height)));
      s.style.maxWidth = "";
      tell(new XMLSerializer().serializeToString(s));
    },
    () => tell(""),
  );
} catch {
  tell("");
}
