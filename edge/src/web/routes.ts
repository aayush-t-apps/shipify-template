// The web chat's routes (ADR 0036), all under /admin/chat, so the one Cloudflare Access application
// for /admin (the status page's too) covers them; each checks Access's token as the status page
// does (accessTokenOk), and nothing more: no users. Reads go to GitHub, read-only (reads.ts). What
// you send goes through the door's own code (doorIn) as the `web` channel, with a proof only this
// Worker can make: the same commands, dedupe, albums and answers as Telegram, and no webhook.
//   GET  /admin/chat[/…]           the page (edge/public/admin/chat/, Workers static assets)
//   GET  …/api/list[?closed=1][&page=]|menu|repeats|notebook|files|setup     what the page shows
//   GET  …/api/models?agent=<id>&q=<word>  an agent's gateway searched for models (the chip)
//   GET  …/api/task/<n>[?since=|?page=]   a thread (a task, or a PR to review)
//   GET  …/api/file/<ref>          a file the chat keeps: pictures inline, the rest downloads
//   GET  …/api/sent/<chat>:<id>    a file you sent from another chat (Telegram's), the same way
//   POST …/api/file                one file into the store (7 days); back comes its ref
//   POST …/api/send                words, a `use` line and files, into the door
//   POST …/api/repeat              a new repeat, written under the Repeat form's headings
// A POST must come from the page itself: the edge's own Origin and `x-shipify-chat: 1`.
import {
  agentsSeen,
  instantOf,
  problem as known,
  maskSecrets,
  modelSearches,
  modelsFound,
} from "../../../cli/contracts/index.ts";
import { accessTokenOk } from "../access.ts";
import { cached } from "../cache.ts";
import { channelOf } from "../channels/index.ts";
import { writtenTo } from "../chat.ts";
import { doorIn, listOf } from "../door-in.ts";
import type { Deps, Env } from "../env.ts";
import { GITHUB_NEEDS, kvOf, logOf, missing, OWN_PROOF_HEADER, ownProof } from "../env.ts";
import { DoorKeyRefused, GitHubError, github } from "../github.ts";
import { type Settings, settings } from "../settings.ts";
import {
  type FileMeta,
  has,
  keep,
  listed,
  MOST_BYTES,
  newId,
  PICTURE,
  safeName,
  safeType,
  serve,
} from "./files.ts";
import { type RepeatAnswers, repeatProblems, repeatWords } from "./forms.ts";
import { fileSrc, list, notebook, repeats, thread } from "./reads.ts";
import { ADD, menu, setup } from "./setup.ts";
import * as shapes from "./shapes.ts";

export const BASE = "/admin/chat";
/** How long a read is kept for every tab and phone: polling stays cheap. */
const KEEP_MS = 5_000;

const PAGE_HEADERS = {
  "cache-control": "private, no-cache",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://*.githubusercontent.com https://github.com; connect-src 'self'; manifest-src 'self'; frame-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** The one library the chat uses, Mermaid, pinned to a version and its hash (draw.js checks it). */
export const MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js";

/**
 * The diagram frame (/draw/): a static page with no data and no sign-in, which the chat shows in a
 * sandboxed iframe (no same-origin, so nothing in it can reach the chat, its cookies or the door).
 * It draws the diagram source in its address's #fragment with Mermaid and says how tall it is.
 */
export async function drawFrame(req: Request, env: Env): Promise<Response> {
  const assets = (env as unknown as { ASSETS?: { fetch(r: Request): Promise<Response> } }).ASSETS;
  const url = new URL(req.url);
  if (!assets || (req.method !== "GET" && req.method !== "HEAD"))
    return new Response(null, { status: 404 });
  const file = url.pathname.endsWith(".js") ? "/draw/draw.js" : "/draw/index.html";
  const res = await assets.fetch(new Request(new URL(file, req.url), { method: "GET" }));
  if (!res.ok) return new Response(null, { status: 404 });
  const headers = new Headers(res.headers);
  const csp = `default-src 'none'; script-src ${url.origin}/draw/draw.js ${MERMAID}; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors ${url.origin}`;
  headers.set("content-security-policy", csp);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(req.method === "HEAD" ? null : res.body, { status: 200, headers });
}

/** An answer for the page: JSON, never cached by anyone but the browser, with what to do. */
const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
const problem = (status: number, error: string, fix: string) =>
  answer(shapes.Problem.parse({ error, fix }), status);

/** A read's answer, with its ETag: the page's copy unchanged is a 304, with no body. */
async function tagged(req: Request, body: unknown) {
  const text = JSON.stringify(body);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const etag = `"${[...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
  if (req.headers.get("if-none-match") === etag)
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "private, no-cache" },
    });
  return answer(body, 200, { etag });
}

/** The page's own files: through Workers static assets, behind the same check. */
async function page(req: Request, env: Env, path: string) {
  const assets = (env as unknown as { ASSETS?: { fetch(r: Request): Promise<Response> } }).ASSETS;
  if (!assets) return problem(404, "The page isn't deployed here.", "Deploy the edge.");
  const rest = path.slice(BASE.length).replace(/^\/+/, "");
  if (rest && !/^[\w-]+\.(?:html|js|css|json|svg|png)$/.test(rest))
    return problem(404, "Nothing here.", `Open ${BASE}.`);
  const url = new URL(`${BASE}/${rest || "index.html"}`, req.url);
  const res = await assets.fetch(new Request(url, { method: "GET" }));
  if (!res.ok) return problem(404, "Nothing here.", `Open ${BASE}.`);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v);
  return new Response(req.method === "HEAD" ? null : res.body, { status: 200, headers });
}

export async function webChat(req: Request, env: Env, deps: Deps): Promise<Response> {
  const log = logOf(deps, "web");
  const url = new URL(req.url);
  const path = url.pathname;
  if (missing(env, GITHUB_NEEDS).length)
    return problem(503, "The edge isn't set up yet.", "Run pnpm ship door setup --yes on your PC.");
  let s: Settings;
  try {
    s = await settings(github(env, deps), deps.now());
  } catch (e) {
    return unread(e, log);
  }
  // The status page's sign-in, checked here too: no rule, or no token, shows nothing.
  if (
    !s.access ||
    !(await accessTokenOk(req.headers.get("cf-access-jwt-assertion"), s.access, deps))
  ) {
    log.warn("page.refused", { why: s.access ? "no access" : "not set up" });
    return problem(
      403,
      "Sign in through Cloudflare Access to use the chat.",
      s.access
        ? `If you're signed in already, the Access application's path must be admin/* (${ADD} says how).`
        : "Set up the status page first: pnpm ship door page --yes.",
    );
  }
  const api = /^\/admin\/chat\/api\/([a-z]+)(?:\/([^/]{1,600}))?$/.exec(path);
  if (!api) {
    if (req.method !== "GET" && req.method !== "HEAD")
      return problem(405, "Read-only.", `Open ${BASE}.`);
    return page(req, env, path);
  }
  const me = s.people.find((p) => channelOf("web")?.chatId.test(p.on.web ?? ""));
  if (!me) return problem(409, "The web chat is off.", `Run ${ADD} on your PC.`);
  const [, route, arg] = api;
  try {
    if (req.method === "GET") return await get(req, env, deps, s, route ?? "", arg, url);
    if (req.method !== "POST") return problem(405, "Not here.", "Reload the page.");
    // Only the page itself may post: the edge's own origin, and the chat's header.
    const origin = new URL(env.SHIPIFY_DOOR_URL ?? url.origin).origin;
    if (req.headers.get("origin") !== origin || req.headers.get("x-shipify-chat") !== "1") {
      log.warn("page.refused", { why: "foreign origin" });
      return problem(403, "That didn't come from the chat page.", "Send it from the chat.");
    }
    const id = me.on.web as string;
    if (route === "file" && !arg) return await upload(req, env, deps);
    if (route === "send" && !arg) return await send(req, env, deps, id);
    if (route === "repeat" && !arg) return await newRepeat(req, env, deps, id);
    return problem(404, "Not here.", "Reload the page.");
  } catch (e) {
    if (e instanceof GitHubError || e instanceof DoorKeyRefused) return unread(e, log);
    log.error("page.refused", {
      why: "unexpected",
      message: maskSecrets(String((e as Error)?.message ?? e)).slice(0, 200),
    });
    return problem(
      500,
      "Something went wrong in the edge.",
      "Try again; if it keeps happening, look at the edge's logs.",
    );
  }
}

/** GitHub couldn't be read: its key refused (with the fix), or down. */
function unread(e: unknown, log: ReturnType<typeof logOf>) {
  const p = known(e instanceof DoorKeyRefused ? "door-key-refused" : "github-unread");
  log.warn("page.refused", { why: p.code, status: (e as { status?: number })?.status ?? 0 });
  return problem(503, p.what, p.fix);
}

async function get(
  req: Request,
  env: Env,
  deps: Deps,
  s: Settings,
  route: string,
  arg: string | undefined,
  url: URL,
): Promise<Response> {
  const kv = kvOf(env);
  const now = deps.now();
  const repo = env.GITHUB_REPO ?? "";
  if (route === "list" && !arg) {
    const page = url.searchParams.get("page") ?? "1";
    const closed = url.searchParams.get("closed") === "1";
    if (!/^[1-9]\d{0,3}$/.test(page))
      return problem(400, "That page doesn't read.", "Reload the page.");
    return tagged(
      req,
      shapes.List.parse(
        await cached(
          `web:list:${repo}:${page}:${closed}`,
          KEEP_MS,
          () => list(env, deps, Number(page), closed),
          now,
        ),
      ),
    );
  }
  if (route === "sent" && arg) return sent(env, deps, s, arg, url.searchParams.get("type") ?? "");
  if (route === "task" && arg && /^\d{1,9}$/.test(arg)) {
    const since = url.searchParams.get("since") ?? undefined;
    if (since !== undefined && Number.isNaN(Date.parse(since)))
      return problem(400, "That time doesn't read.", "Reload the page.");
    const older = url.searchParams.get("page") ?? "";
    if (older && !/^[1-9]\d{0,4}$/.test(older))
      return problem(400, "That page doesn't read.", "Reload the page.");
    const t = await cached(
      `web:task:${repo}:${arg}:${since ?? ""}:${older}`,
      KEEP_MS,
      () => thread(env, deps, s, Number(arg), since, older ? Number(older) : undefined),
      now,
    );
    if (!t) return problem(404, `There's no task #${arg}.`, "Check the number.");
    return tagged(req, shapes.Thread.parse(t));
  }
  if (route === "menu" && !arg)
    return tagged(req, shapes.Menu.parse(await menu(env, deps, Boolean(kv))));
  if (route === "models" && !arg) return models(url, deps, now);
  if (route === "repeats" && !arg)
    return tagged(req, shapes.Repeats.parse(await repeats(env, deps)));
  if (route === "notebook" && !arg)
    return tagged(req, shapes.Notebook.parse(await notebook(env, deps)));
  if (route === "setup" && !arg) return tagged(req, shapes.Setup.parse(await setup(env, deps, s)));
  if (route === "files" && !arg) {
    if (!kv) return tagged(req, { v: 1, files: [] });
    const files = await cached(`web:files`, 60_000, () => listed(kv), now);
    return tagged(
      req,
      shapes.Files.parse({
        v: 1,
        files: files.map((f) => ({
          ref: f.ref,
          name: f.meta.name,
          type: f.meta.type,
          size: f.meta.size,
          ...(f.meta.task ? { task: f.meta.task } : {}),
          by: f.meta.by,
          at: new Date(f.meta.at).toISOString(),
          ...(f.until ? { until: new Date(f.until).toISOString() } : {}),
          src: fileSrc(f.ref),
        })),
      }),
    );
  }
  if (route === "file" && arg) {
    if (!kv) return problem(404, "Files aren't set up.", `Run ${ADD} on your PC.`);
    return serve(kv, arg, url.searchParams.get("download") === "1");
  }
  return problem(404, "Not here.", "Reload the page.");
}

/**
 * An agent's gateway, for the picker: with a word, searched as /models <word> does (kept 10
 * minutes); with none, the agent's listed models, each found by its id for its facts (kept a day,
 * read only when the picker opens). A failure is never kept. No ETag: each is read once.
 */
async function models(url: URL, deps: Deps, now: number) {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 40);
  const agent = agentsSeen().find(([id]) => id === url.searchParams.get("agent"))?.[1];
  const gateway = agent?.gateway;
  if (!gateway) return problem(404, "That agent has no list to search.", "Pick from its models.");
  const look = (word: string, keep: number) => {
    const search = modelSearches(word).find((g) => g.gateway === gateway);
    if (!search) return Promise.resolve(null);
    const read = async () =>
      modelsFound(search.gateway, await listOf(search.url, deps)) ?? Promise.reject();
    return cached(`web:models:${search.url}`, keep, read, now).catch(() => null);
  };
  if (!q) {
    const each = await Promise.all(
      (agent.models ?? []).map(async (id) =>
        (await look(id, 86_400_000))?.find((m) => m.id === id),
      ),
    );
    return answer(shapes.Models.parse({ v: 1, models: each.filter(Boolean) }));
  }
  if (q.length < 2) return problem(400, "Search with a word.", "Type 2 letters or more.");
  const found = await look(q, 600_000);
  if (!found)
    return problem(502, `Couldn't read ${gateway}'s list just now.`, "Try again in a minute.");
  return answer(shapes.Models.parse({ v: 1, models: found }));
}

/**
 * A file you sent from another chat (`telegram:<id>`, as its `from` line names it), fetched
 * through that channel as a run's is (files.ts at the root): nothing kept here, served as a file of
 * the store is. A picture the page names (`type`) shows inline; anything else downloads.
 */
async function sent(env: Env, deps: Deps, s: Settings, arg: string, type: string) {
  let ref = "";
  try {
    ref = decodeURIComponent(arg);
  } catch {}
  const hit = /^([a-z][a-z0-9-]{0,30}):(.+)$/.exec(ref);
  const ch = hit?.[1] && hit[1] !== "web" ? channelOf(hit[1]) : undefined;
  if (!ch?.file || !hit?.[2] || missing(env, ch.needs).length)
    return problem(404, "That file isn't here.", "Open it in the chat it came from.");
  if (s.closed) return problem(503, "The door is closed.", "Open it again to see files.");
  const res = await ch.file(env, deps, hit[2]);
  if (!res.ok || !res.body)
    return problem(410, "That chat no longer has the file.", "Open it in the chat it came from.");
  const inline = PICTURE.test(type) ? type : undefined;
  const name = safeName(ref.slice(ref.lastIndexOf(":") + 1).slice(0, 40));
  const length = res.headers.get("content-length");
  return new Response(res.body, {
    headers: {
      "content-type": inline ?? "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      ...(length ? { "content-length": length } : {}),
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

/** One file from the page into the store: 10 MB at most. */
async function upload(req: Request, env: Env, deps: Deps) {
  const kv = kvOf(env);
  if (!kv) return problem(409, "Files aren't set up.", `Run ${ADD} on your PC; words still go.`);
  if (Number(req.headers.get("content-length") ?? 0) > MOST_BYTES)
    return problem(413, "That file is over 10 MB.", "Send a smaller one, or a link to it.");
  const body = await req.arrayBuffer();
  if (body.byteLength > MOST_BYTES)
    return problem(413, "That file is over 10 MB.", "Send a smaller one, or a link to it.");
  if (!body.byteLength) return problem(400, "That file is empty.", "Pick it again.");
  let name = "file";
  try {
    name = safeName(decodeURIComponent(req.headers.get("x-file-name") ?? "file"));
  } catch {}
  const meta: FileMeta = {
    name,
    type: safeType(req.headers.get("content-type") ?? ""),
    size: body.byteLength,
    by: "you",
    at: deps.now(),
  };
  const ref = `up-${newId()}`;
  try {
    await keep(kv, ref, body, meta);
  } catch {
    return problem(
      507,
      "The file store refused it (its daily limit, perhaps).",
      "Try again later; words still go.",
    );
  }
  logOf(deps, "web").info("page.served", { what: "file kept", bytes: meta.size });
  return answer(
    shapes.Uploaded.parse({ v: 1, ref, name: meta.name, type: meta.type, size: meta.size }),
  );
}

/** What the door said to one of the chat's messages: its words, or what broke (nothing saved). */
type DoorSaid = { text?: string; status: number; trouble?: { what: string; fix: string } };

async function door(env: Env, deps: Deps, message: Record<string, unknown>): Promise<DoorSaid> {
  const ch = channelOf("web");
  if (!ch) return { status: 404 };
  const req = new Request("https://shipify-edge.internal/door/web", {
    method: "POST",
    headers: { "content-type": "application/json", [OWN_PROOF_HEADER]: await ownProof(env, ch.id) },
    body: JSON.stringify(message),
  });
  const res = await doorIn(req, env, deps, ch);
  const body = (await res.json().catch(() => null)) as { text?: unknown; trouble?: unknown } | null;
  const trouble = body?.trouble as { what?: unknown; fix?: unknown } | undefined;
  return {
    status: res.status,
    ...(typeof body?.text === "string" ? { text: body.text } : {}),
    ...(typeof trouble?.what === "string" && typeof trouble.fix === "string"
      ? { trouble: { what: trouble.what, fix: trouble.fix } }
      : {}),
  };
}

/**
 * Your words, a `use` line and up to five files, as the door's own messages: files as an album. A
 * command answered at once (/models kimi) goes alone, as a pick is for a task's runs. A `use` line
 * of your own comes after the pick's, so the box takes yours (the last one it can use).
 */
async function into(
  env: Env,
  deps: Deps,
  user: string,
  b: { id: string; task?: number; words: string; use?: string; files: shapes.SendBody["files"] },
) {
  const use = b.use && !instantOf(b.words) ? `use ${b.use}` : "";
  const words = [use, b.words.trim()].filter(Boolean).join("\n");
  if (!words && !b.files.length)
    return problem(400, "There's nothing to send.", "Write something first.");
  if (!words && !b.task)
    return problem(400, "Say what the files are for.", "Add a few words, then send.");
  const kv = kvOf(env);
  if (b.files.length && !kv)
    return problem(409, "Files aren't set up.", `Send the words alone, or run ${ADD}.`);
  for (const f of b.files)
    if (kv && !(await has(kv, f.ref)))
      return problem(410, `“${f.name}” is gone from the store.`, "Attach it again.");
  const album = b.files.length > 1 ? b.id : undefined;
  const parts = b.files.length ? b.files : [undefined];
  let first: DoorSaid | undefined;
  for (const [i, f] of parts.entries()) {
    const said = await door(env, deps, {
      id: i ? `${b.id}-${i}` : b.id,
      chat: user,
      user,
      words: i ? "" : words,
      forwarded: false,
      ...(b.task ? { repliesTo: b.task } : {}),
      ...(album ? { album } : {}),
      ...(f ? { file: { ref: f.ref, name: f.name, type: f.type, size: f.size } } : {}),
    });
    // What broke, in the door's own words: the page keeps your message to send again, and what's
    // written already (an album's first files) isn't written twice.
    if (said.trouble) return problem(503, said.trouble.what, said.trouble.fix);
    if (said.status !== 200)
      return problem(500, "The door refused the chat.", "Run pnpm ship door check on your PC.");
    if (!i) {
      if (said.text === undefined)
        return problem(
          403,
          "The door didn't let it in.",
          `Run ${ADD}, so your words are let in from the chat.`,
        );
      first = said;
    }
  }
  // A task only when the door wrote your words onto one: an answer at once (/help, a refusal)
  // names none, so the page shows it, in the thread you wrote it in.
  const text = first?.text ?? "";
  const n = writtenTo(text);
  return answer(shapes.Sent.parse({ v: 1, text, ...(n ? { task: n } : {}) }));
}

async function send(req: Request, env: Env, deps: Deps, user: string) {
  const raw = await req.json().catch(() => null);
  const b = shapes.SendBody.safeParse(raw);
  const long = String((raw as { words?: unknown } | null)?.words ?? "").length > shapes.MOST_CHARS;
  if (long)
    return problem(
      413,
      `That message is over ${shapes.MOST_CHARS.toLocaleString("en")} characters.`,
      "Attach it as a file, or split it in two.",
    );
  if (!b.success)
    return problem(400, "That message doesn't read.", "Reload the page and send it again.");
  return into(env, deps, user, b.data);
}

async function newRepeat(req: Request, env: Env, deps: Deps, user: string) {
  const raw = (await req.json().catch(() => null)) as
    | (Partial<RepeatAnswers> & { id?: unknown })
    | null;
  const id = typeof raw?.id === "string" && /^[\w-]{8,64}$/.test(raw.id) ? raw.id : "";
  const a: RepeatAnswers = {
    what: String(raw?.what ?? ""),
    when: String(raw?.when ?? ""),
    kind: String(raw?.kind ?? ""),
    ...(raw?.check ? { check: String(raw.check) } : {}),
    ...(raw?.model ? { model: String(raw.model) } : {}),
  };
  if (!id) return problem(400, "That form doesn't read.", "Reload the page and send it again.");
  const wrong = repeatProblems(a);
  if (wrong.length) return problem(400, wrong.join(" "), "Change it, then create it again.");
  return into(env, deps, user, { id, words: repeatWords(a), files: [] });
}
