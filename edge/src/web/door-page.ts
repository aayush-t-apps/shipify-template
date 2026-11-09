// A small page outside the chat, for a browser at a door: the bare address's two ways in
// (home.ts), and the guests' door when it lets no one in (routes.ts). No script, no form, no
// outside load; light and dark; every word escaped, and each link one of the edge's own paths.

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

const CSS = `
:root{--bg:#f6f7f9;--ink:#1d2330;--muted:#5f6878;--line:#dde1e7;--card:#fff;--accent:#2457c5;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--ink:#e6e9ef;--muted:#9aa3b3;--line:#2b313b;--card:#1b1f27;--accent:#8ab0ff;--on:#0f1420}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:24rem;padding:2rem 1.25rem}
h1{margin:0 0 .4rem;font-size:1.6rem;line-height:1.2;font-weight:650}
p{margin:0 0 1.5rem;color:var(--muted)}
nav{display:grid;gap:.75rem}
a{display:block;padding:.85rem 1rem;border-radius:.6rem;border:1px solid var(--line);background:var(--card);color:var(--ink);text-decoration:none;font-weight:600;text-align:center}
a.go{background:var(--accent);border-color:var(--accent);color:var(--on)}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A page with a title, a line, and links, the first the main one. Each href is the edge's own path. */
export function doorPage(
  status: number,
  title: string,
  line: string,
  links: [href: `/${string}`, text: string][],
): Response {
  const nav = links
    .map(([href, text], i) => `<a${i ? "" : ' class="go"'} href="${esc(href)}">${esc(text)}</a>`)
    .join("");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Shipify</title><style>${CSS}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(line)}</p><nav>${nav}</nav></main></body></html>`,
    { status, headers: HEADERS },
  );
}
