// The status page (ADR 0032; at /admin/status since ADR 0036): one read-only HTML page behind
// Cloudflare Access. It shows what the record already says: what needs you, your apps, boxes, what's coming up, recipes,
// recent events, key dates, the notebook's pages and the links to all of it. No script, no form, no
// write; every GitHub string escaped. Access's token is checked here too, so a missing rule shows
// nothing. What it reads (about four GitHub calls) is kept a minute in Cloudflare's cache.
import {
  NEEDS_YOU_LABEL,
  plural,
  problem,
  timeAgo,
  withUpcoming,
} from "../../cli/contracts/index.ts";
import pkg from "../../package.json" with { type: "json" };
import { accessTokenOk } from "./access.ts";
import type { Deps, Env } from "./env.ts";
import { GITHUB_NEEDS, logOf, missing } from "./env.ts";
import { DoorKeyRefused, type GitHub, github } from "./github.ts";
import {
  notebookPages,
  runners,
  type Settings,
  settings,
  statusTask,
  toBoxes,
} from "./settings.ts";

/** How long a page is kept: the watch looks every 5 minutes, so a minute old is fresh enough. */
const KEEP_S = 60;
const cacheUrl = (repo: string) =>
  new Request(`https://shipify-edge.internal/status-page/${encodeURIComponent(repo)}`);
const place = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
/** A link, only to https. */
const a = (href: string, text: string) =>
  /^https:\/\//.test(href) ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text);

export async function statusPage(req: Request, env: Env, deps: Deps): Promise<Response> {
  const log = logOf(deps, "page");
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response("Read-only.", { status: 405, headers: { ...HEADERS, allow: "GET, HEAD" } });
  if (missing(env, GITHUB_NEEDS).length) return refused(503, "The edge isn't set up yet.");
  const gh = github(env, deps);
  let s: Settings;
  try {
    s = await settings(gh, deps.now());
  } catch {
    return refused(503, "GitHub didn't answer: try again in a minute.");
  }
  if (!s.access) {
    log.warn("page.refused", { why: "not set up" });
    return refused(
      403,
      "The status page isn't set up: run <code>pnpm ship door page</code> on your PC.",
    );
  }
  if (!(await accessTokenOk(req.headers.get("cf-access-jwt-assertion"), s.access, deps))) {
    log.warn("page.refused", { why: "no access" });
    return refused(403, "Sign in through Cloudflare Access to see this page.");
  }
  const c = place();
  const hit = await c?.match(cacheUrl(gh.repo)).catch(() => undefined);
  if (hit)
    return new Response(req.method === "HEAD" ? null : await hit.text(), { headers: HEADERS });
  let html: string;
  try {
    html = render(await gather(gh, s, env, deps), deps.now());
  } catch (e) {
    // Signed in by now: the door's own trouble is said as it is, with its fix.
    const p = problem(e instanceof DoorKeyRefused ? "door-key-refused" : "github-down");
    return refused(503, esc(`${p.what} ${p.fix}`));
  }
  await c
    ?.put(
      cacheUrl(gh.repo),
      new Response(html, { headers: { "cache-control": `s-maxage=${KEEP_S}` } }),
    )
    .catch(() => {});
  log.info("page.served", {});
  return new Response(req.method === "HEAD" ? null : html, { headers: HEADERS });
}

function refused(status: number, words: string) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shipify</title><style>${CSS}</style><main><p class="state">${words}</p></main></html>`,
    { status, headers: HEADERS },
  );
}

// ---------------------------------------------------------------- what it reads

interface View {
  repo: string;
  commit: string;
  record?: Awaited<ReturnType<typeof statusTask>>;
  boxes: ReturnType<typeof toBoxes>;
  needs: { number: number; title: string; url: string }[];
  pages: Awaited<ReturnType<typeof notebookPages>>;
  keyDates: Record<string, string>;
}

async function gather(gh: GitHub, s: Settings, env: Env, deps: Deps): Promise<View> {
  const [record, list, needs, pages] = await Promise.all([
    statusTask(gh),
    runners(gh, deps.now(), KEEP_S * 1000),
    gh.json<{ number: number; title: string; html_url: string; pull_request?: unknown }[]>(
      "GET",
      `repos/${gh.repo}/issues?labels=${encodeURIComponent(NEEDS_YOU_LABEL)}&state=open&per_page=20`,
    ),
    notebookPages(gh).catch(() => []),
  ]);
  return {
    repo: gh.repo,
    commit: env.GIT_SHA ?? "dev",
    record,
    boxes: toBoxes(list),
    needs: needs
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, url: i.html_url })),
    pages,
    keyDates: s.keyDates,
  };
}

// ---------------------------------------------------------------- how it looks

const DAY = 86_400_000;

function timeUntil(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return "unknown";
  if (ms <= 60_000) return "now";
  if (ms < 3_600_000) return `in ${Math.ceil(ms / 60_000)}m`;
  if (ms < DAY) return `in ${Math.round(ms / 3_600_000)}h`;
  return `in ${Math.round(ms / DAY)}d`;
}

const when = (iso: string, text: string) => `<time datetime="${esc(iso)}">${esc(text)}</time>`;

/** A state as a symbol, a word and a colour: never colour alone. */
const mark = (kind: "ok" | "warn" | "bad" | "off", word: string) =>
  `<span class="mark ${kind}"><span aria-hidden="true">${{ ok: "●", warn: "▲", bad: "■", off: "○" }[kind]}</span> ${esc(word)}</span>`;

function section(title: string, id: string, body: string) {
  return `<section id="${id}"><h2>${esc(title)}</h2>${body}</section>`;
}

const rows = (items: string[], empty: string) =>
  items.length
    ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
    : `<p class="quiet">${esc(empty)}</p>`;

export function render(v: View, now: number): string {
  const gh = `https://github.com/${v.repo}`;
  const owner = v.repo.split("/")[0] ?? "";
  const rec = v.record?.record;
  const apps = rec?.apps ?? [];
  const offline = v.boxes.filter((b) => !b.online);
  const failing = apps.filter((x) => x.failing && !x.paused);
  const keys = Object.entries(v.keyDates)
    .map(([name, date]) => ({ name, date, days: Math.ceil((Date.parse(date) - now) / DAY) }))
    .sort((x, y) => x.days - y.days);
  const soon = keys.filter((k) => k.days <= 30);

  const wrong = [
    ...(v.needs.length ? [`${plural(v.needs.length, "thing needs", "things need")} you`] : []),
    ...failing.map((x) => `${x.id} is failing`),
    ...offline.map((b) => `${b.name} is offline`),
    ...(v.boxes.length ? [] : ["no box yet"]),
  ];
  const state: "ok" | "warn" | "bad" =
    failing.length || (v.boxes.length && offline.length === v.boxes.length)
      ? "bad"
      : wrong.length || soon.some((k) => k.days <= 7)
        ? "warn"
        : "ok";
  const headline = wrong.length
    ? `${wrong[0]?.charAt(0).toUpperCase()}${wrong[0]?.slice(1)}`
    : "All good";

  const needs = rows(
    v.needs.map((n) => `${a(n.url, `#${n.number}`)} <span>${esc(n.title)}</span>`),
    "Nothing needs you.",
  );
  const appRows = rows(
    apps.map((x) => {
      const m = x.paused
        ? mark("off", "taken down")
        : x.failing
          ? mark("bad", "failing")
          : mark("ok", "up");
      return `<strong>${a(x.url, x.id)}</strong> ${m} <span class="aside">${a(`https://github.com/${owner}/${x.id}`, "repo")}${x.failing ? `, failing since ${when(x.failing, timeAgo(x.failing, now))}` : ""}</span>`;
    }),
    "No apps yet.",
  );
  const boxRows = rows(
    v.boxes.map(
      (b) =>
        `<strong>${esc(b.name)}</strong> ${b.online ? mark("ok", "online") : mark("bad", "offline")} <span class="aside">${plural(b.slots, "slot")}, ${b.busy} busy</span>`,
    ),
    "No box yet: tasks wait for one.",
  );
  const coming = rows(
    (rec?.upcoming ?? [])
      .slice()
      .sort((x, y) => Date.parse(x.next) - Date.parse(y.next))
      .slice(0, 12)
      .map(
        (u) =>
          `${when(u.next, timeUntil(u.next, now))} ${a(`${gh}/issues/${u.n}`, `#${u.n}`)} <span>${esc(u.title)}</span>${u.every ? ` <span class="aside">${esc(u.every)}</span>` : ""}`,
      ),
    "Nothing repeats yet.",
  );
  const recipes = rows(
    withUpcoming(rec?.recipes ?? [], rec?.upcoming ?? []).map(
      (r) =>
        `<strong>${a(`${gh}/blob/main/recipes/${r.name}.md`, r.name)}</strong> ${r.paused ? mark("off", "paused") : r.next ? `<span>next ${when(r.next, timeUntil(r.next, now))}</span>` : `<span class="quiet">starting</span>`}${r.task ? ` <span class="aside">${a(`${gh}/issues/${r.task}`, `#${r.task}`)}</span>` : ""}`,
    ),
    "No recipes yet: see recipes/examples.",
  );
  const recent = rows(
    (rec?.events ?? [])
      .slice(0, 10)
      .map((e) => `${when(e.at, timeAgo(e.at, now))} <span>${esc(e.text)}</span>`),
    "Nothing yet.",
  );
  const upkeep = rows(
    keys.map(
      (k) =>
        `<strong>${esc(k.name)}</strong> ${k.days <= 7 ? mark("bad", `${k.days} days left`) : k.days <= 30 ? mark("warn", `${k.days} days left`) : mark("ok", `${k.days} days left`)} <span class="aside">${esc(k.date)}</span>`,
    ),
    "No key dates recorded.",
  );
  const notebook = rows(
    v.pages.map(
      (p) =>
        `<strong>${a(p.url, p.topic)}</strong> <span class="aside">${plural(p.lines, "line")}: ${esc(p.first)}</span>`,
    ),
    "The notebook is empty: say remember: … to add a note.",
  );
  const status = v.record ? `${gh}/issues/${v.record.number}` : `${gh}/issues`;
  const links = [
    `<a href="/admin/chat/">Chat</a>`,
    a(`${gh}/issues`, "Tasks"),
    a(status, "Status task"),
    a(`${gh}/actions`, "Actions"),
    a(`${gh}/tree/main/recipes`, "Recipes"),
    a(`${gh}/tree/main/docs`, "Docs"),
  ].join(" ");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Shipify</title><style>${CSS}</style></head><body><main>
<header><h1 class="state ${state}"><span class="dot" aria-hidden="true"></span>${esc(headline)}</h1>
<p class="aside">Shipify ${esc(pkg.version)}, ${esc(v.commit.slice(0, 7))}. As of ${when(new Date(now).toISOString(), new Date(now).toISOString().slice(11, 16))} UTC${rec?.watch.last ? `; the last due run ${when(rec.watch.last, timeAgo(rec.watch.last, now))}` : ""}.</p>
<nav>${links}</nav></header>
${section("Needs you", "needs-you", needs)}
${section("Apps", "apps", appRows)}
${section("Boxes", "boxes", boxRows)}
${section("Coming up", "coming-up", coming)}
${section("Recipes", "recipes", recipes)}
${section("Recent", "recent", recent)}
${section("Key dates", "upkeep", upkeep)}
${section("Notebook", "notebook", notebook)}
</main></body></html>`;
}

const CSS = `
:root{--bg:#f6f7f9;--ink:#1d2330;--muted:#5f6878;--line:#dde1e7;--ok:#2f7d4f;--warn:#9a5c00;--bad:#b3261e;--link:#2457c5}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--ink:#e6e9ef;--muted:#9aa3b3;--line:#2b313b;--ok:#5fbf86;--warn:#e0a640;--bad:#f07167;--link:#8ab0ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1rem 4rem}
header{padding-bottom:1.25rem;border-bottom:1px solid var(--line)}
h1{margin:0 0 .35rem;font-size:clamp(1.9rem,6vw,2.6rem);line-height:1.15;font-weight:650;letter-spacing:-.01em;display:flex;align-items:center;gap:.6rem}
.dot{width:.7em;height:.7em;border-radius:50%;background:currentColor;flex:none}
.state.ok{color:var(--ok)}.state.warn{color:var(--warn)}.state.bad{color:var(--bad)}
h2{font-size:1rem;font-weight:650;margin:2rem 0 .4rem}
ul{list-style:none;margin:0;padding:0}
li{padding:.5rem 0;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.25rem .6rem;align-items:baseline}
li:first-child{border-top:0}
a{color:var(--link);text-decoration-thickness:1px;text-underline-offset:2px}
a:focus-visible{outline:2px solid var(--link);outline-offset:2px;border-radius:2px}
.aside,.quiet,time{color:var(--muted)}.aside{font-size:.9rem}.quiet{margin:.3rem 0}
.mark{font-size:.9rem;white-space:nowrap}.mark.ok{color:var(--ok)}.mark.warn{color:var(--warn)}.mark.bad{color:var(--bad)}.mark.off{color:var(--muted)}
nav{display:flex;flex-wrap:wrap;gap:.4rem 1.1rem;margin-top:.6rem}
`;
