// The safe-HTML list (ADR 0036, "Markdown and photos"): GitHub renders each body (`body_html`) and
// cleans it already; this is the second lock, before the page puts it in place. Only the tags a
// reply uses are kept, each with only its plain attributes; links and pictures only to https. A
// tag that can carry code (script, style, iframe, svg, a form…) goes with everything inside it;
// any other unknown tag goes and keeps its words. The page's CSP is the third lock.

/** Tags kept, with the attributes each may keep. */
const KEEP: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  p: [],
  br: [],
  hr: [],
  div: [],
  span: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  ul: [],
  ol: ["start"],
  li: [],
  dl: [],
  dt: [],
  dd: [],
  blockquote: [],
  pre: [],
  code: [],
  kbd: [],
  em: [],
  strong: [],
  b: [],
  i: [],
  s: [],
  del: [],
  ins: [],
  sup: [],
  sub: [],
  mark: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ["align", "colspan", "rowspan"],
  td: ["align", "colspan", "rowspan"],
  details: ["open"],
  summary: [],
  input: ["type", "checked"],
};
/** Tags that go with all they hold. */
const DROP = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "template",
  "noscript",
  "textarea",
  "select",
  "form",
  "button",
  "video",
  "audio",
  "head",
  "title",
  "base",
  "link",
  "meta",
]);
const VOID = new Set(["br", "hr", "img", "input"]);

export const esc = (s: string) =>
  s
    .replace(/&(?![a-z0-9#]{1,12};)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const escAttr = (s: string) =>
  s
    .replace(/&(?![a-z0-9#]{1,12};)/gi, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

/** An entity-decoded attribute value, so `&#106;avascript:` can't hide a scheme. */
const decoded = (s: string) =>
  s
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&amp;/gi, "&");

/** A link or picture's address: https only (a link may also be a #fragment on the page). */
function address(v: string, tag: string, base: string): string | undefined {
  const plain = [...decoded(v)].filter((c) => c > " " && c !== "\u007f").join("");
  if (tag === "a" && /^#[\w-]{1,200}$/.test(plain)) return plain;
  try {
    const u = new URL(plain, base);
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export interface Cleaned {
  html: string;
  /** Something was left out (an embed, a style): the page says to open it on GitHub. */
  trimmed: boolean;
}

/** GitHub's HTML, kept to the safe list. `base` is where relative links point (the repo). */
export function clean(html: string, base = "https://github.com/"): Cleaned {
  let out = "";
  let trimmed = false;
  /** While inside a dropped tag: its name and depth. */
  let dropping: { tag: string; depth: number } | undefined;
  const open: string[] = [];
  const TOKEN =
    /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\/?[a-zA-Z][^>]*>?|[^<]+|</g;
  for (const m of html.matchAll(TOKEN)) {
    const t = m[0];
    if (t.startsWith("<!")) continue;
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)>?$/.exec(t);
    if (!tag) {
      if (!dropping) out += esc(t);
      continue;
    }
    const closing = tag[1] === "/";
    const name = (tag[2] ?? "").toLowerCase();
    if (dropping) {
      if (name === dropping.tag) dropping.depth += closing ? -1 : 1;
      if (dropping.depth <= 0) dropping = undefined;
      continue;
    }
    if (DROP.has(name)) {
      // Markdown can't hold an <svg>: one here is GitHub's own (a heading's link icon, a diagram's
      // spinner), so nothing of yours is left out.
      if (name !== "svg") trimmed = true;
      if (!closing && !tag[4]) dropping = { tag: name, depth: 1 };
      continue;
    }
    const allowed = KEEP[name];
    if (!allowed) {
      if (!/^(?:g-emoji|tt|picture|source|section|article|markdown-accessiblity-table)$/.test(name))
        trimmed = true;
      continue;
    }
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      // Close what's still open inside it, so the page gets whole tags.
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    const attrs: string[] = [];
    let ok = true;
    for (const a of (tag[3] ?? "").matchAll(ATTR)) {
      const key = (a[1] ?? "").toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (!allowed.includes(key)) continue;
      if (key === "href" || key === "src") {
        const to = address(value, name, base);
        if (!to) {
          if (name === "img") ok = false;
          continue;
        }
        attrs.push(`${key}="${escAttr(to)}"`);
      } else if (key === "type") {
        if (value.toLowerCase() !== "checkbox") ok = false;
        else attrs.push('type="checkbox"');
      } else if (key === "checked" || key === "open") attrs.push(key);
      else if (/^(?:width|height|colspan|rowspan|start)$/.test(key)) {
        if (/^\d{1,5}$/.test(value)) attrs.push(`${key}="${value}"`);
      } else if (key === "align") {
        if (/^(?:left|right|center)$/i.test(value)) attrs.push(`align="${value.toLowerCase()}"`);
      } else attrs.push(`${key}="${escAttr(decoded(value).slice(0, 300))}"`);
    }
    if (name === "input" && !attrs.includes('type="checkbox"')) ok = false;
    if (!ok) {
      trimmed = true;
      continue;
    }
    if (name === "a") attrs.push('rel="noopener noreferrer nofollow"', 'target="_blank"');
    if (name === "img") attrs.push('loading="lazy"', 'referrerpolicy="no-referrer"');
    if (name === "input") attrs.push("disabled");
    out += `<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
    if (!VOID.has(name)) open.push(name);
  }
  while (open.length) out += `</${open.pop()}>`;
  return { html: out, trimmed };
}

/** A reply's own "Run details" fold, taken out of its HTML so the page shows it under the run line. */
export function splitDetails(html: string): { html: string; details?: string } {
  const hits = [...html.matchAll(/<details(?: open)?>\s*<summary>\s*Run details/g)];
  const at = hits.at(-1)?.index;
  if (at === undefined) return { html };
  const rest = html.slice(at);
  const end = rest.indexOf("</details>");
  if (end < 0) return { html };
  const fold = rest.slice(0, end + "</details>".length);
  const inner = fold.replace(/^<details[^>]*>\s*<summary>[\s\S]*?<\/summary>/, "").slice(0, -10);
  return { html: html.slice(0, at) + rest.slice(end + "</details>".length), details: inner.trim() };
}

/** Your words without their leading `use …` line: the page shows the pick as a tag. */
export const withoutPick = (html: string) =>
  html.replace(/^\s*(<p[^>]*>)\s*use [^<\n]*(?:<br>)?\s*/i, "$1").replace(/^<p[^>]*><\/p>\s*/, "");

const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A reply's words without what its line shows on its own (apply writes both, for GitHub): the
 * question ("> **Question:** …"), shown in its box, and its links' list ("- label: url"), shown as
 * buttons. A list left empty goes.
 */
export function withoutEchoes(
  html: string,
  r: { question?: string; links: readonly (readonly [string, string])[] },
): string {
  let out = html;
  if (r.question)
    out = out.replace(
      /<blockquote>\s*<p><strong>Question:<\/strong>[\s\S]*?<\/blockquote>\s*/g,
      "",
    );
  for (const [, u] of r.links) {
    // As clean() writes it (a URL made whole: "https://x.io" is "https://x.io/"), last in its item,
    // and never past that item's end.
    let to = u;
    try {
      to = new URL(u).href;
    } catch {}
    const href = re(escAttr(to));
    const item = `<li>(?:(?!</?li>)[\\s\\S])*?<a href="${href}"[^>]*>[^<]*</a>\\s*</li>\\s*`;
    out = out.replace(new RegExp(item, "g"), "");
  }
  return out.replace(/<ul>\s*<\/ul>\s*/g, "");
}
