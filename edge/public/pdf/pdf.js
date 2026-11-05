// @ts-nocheck
// The chat's PDF frame (ADR 0071): shows a PDF in the chat on a browser with no PDF viewer of its
// own (Chrome on a phone), with pdf.js. It says { pdf: "ready" }; the chat sends the file's bytes
// ({ pdf: ArrayBuffer }); it answers { pdf: "shown" }, or { pdf: "failed" } and the chat offers
// Download. It runs in a sandbox with no origin of its own, and holds nothing but that PDF. pdf.js
// and its worker both load as pinned scripts here (index.html, each checked against its hash), and
// the worker's part runs on this frame's own thread: a sandbox can start no worker from the CDN.
const CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/";
const tell = (pdf) => parent.postMessage({ pdf }, "*");
const box = document.getElementById("p");

// A page is drawn when it comes near the screen, so a long PDF doesn't fill a phone's memory.
const near = new IntersectionObserver(
  (seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      near.unobserve(e.target);
      draw(e.target);
    }
  },
  { rootMargin: "100% 0px" },
);

async function draw(c) {
  const one = c.page.getViewport({ scale: 1 });
  const scale = (c.clientWidth / one.width) * Math.min(devicePixelRatio || 1, 2);
  const v = c.page.getViewport({ scale });
  c.width = Math.floor(v.width);
  c.height = Math.floor(v.height);
  await c.page.render({ canvas: c, viewport: v }).promise;
}

async function show(data) {
  const doc = await globalThis.pdfjsLib.getDocument({
    data,
    cMapUrl: `${CDN}cmaps/`,
    standardFontDataUrl: `${CDN}standard_fonts/`,
    iccUrl: `${CDN}iccs/`,
    wasmUrl: `${CDN}wasm/`,
    enableXfa: false,
  }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const one = page.getViewport({ scale: 1 });
    const c = Object.assign(document.createElement("canvas"), { page });
    c.style.aspectRatio = `${one.width} / ${one.height}`;
    c.setAttribute("aria-label", `Page ${i} of ${doc.numPages}`);
    box.append(c);
    near.observe(c);
  }
}

let started = false;
addEventListener("message", (e) => {
  if (e.source !== parent || started || !(e.data?.pdf instanceof ArrayBuffer)) return;
  started = true;
  show(new Uint8Array(e.data.pdf)).then(
    () => tell("shown"),
    () => tell("failed"),
  );
});
tell(globalThis.pdfjsLib && globalThis.pdfjsWorker ? "ready" : "failed");
