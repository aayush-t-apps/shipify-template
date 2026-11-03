// The web chat's routes (ADR 0036), all under /admin/chat, so the one Cloudflare Access application
// for /admin (the status page's too) covers them; each checks Access's token as the status page
// does (accessTokenOk), and nothing more: no users. Reads go to GitHub, read-only (reads.ts). What
// you send goes through the door's own code (doorIn) as the `web` channel, with a proof only this
// Worker can make: the same commands, dedupe, albums and answers as Telegram, and no webhook.
//   GET  /admin/chat[/…]           the page (edge/public/admin/chat/, Workers static assets)
//   GET  …/api/list[?closed=1][&page=]|menu|repeats|notebook|files|setup     what the page shows
//   GET  …/api/models?agent=<id>&q=<word>  an agent's gateway searched for models (the chip)
//   GET  …/api/task/<n>[?since=|?page=]   a thread (a task, or a PR to review)
//   GET  …/api/file/<ref>[?view=1] a file the chat keeps: pictures inline (a PDF too, to view), the
//                                  rest downloads
//   GET  …/api/doc/<ref>           a kept file for the doc pane: Markdown rendered, a CSV's rows
//   GET  …/api/sent/<chat>:<id>    a file you sent from another chat (Telegram's), the same way
//   POST …/api/file                one file streamed into the store (R2, 95 MB at most), with its
//                                  chat's number when it has one (x-file-task); back comes its ref
//   DELETE …/api/file/<ref>        a file deleted: Files' Delete, or one taken off the box
//   POST …/api/send                words, a `use` line and files, into the door
//   POST …/api/repeat              a new repeat, written under the Repeat form's headings
//   POST …/api/move                a chat moved into a project (ADR 0069: Move to project)
//   POST …/api/push                notifications on this device, or off (ADR 0050)
// A POST or a DELETE must come from the page itself: the edge's own Origin and `x-shipify-chat: 1`.
// The page's service worker (sw.js, one of its files) keeps the page's own files for offline
// (network first, never `api/`), shows notifications and takes Android's shares: a share that
// reaches the edge instead (no worker yet) opens New chat.
import {
  agentsSeen,
  instantOf,
  problem as known,
  maskSecrets,
  modelLookup,
  modelPool,
  modelSearches,
  poolMatching,
} from "../../../cli/contracts/index.ts";
import { accessTokenOk } from "../access.ts";
import { cached, forget, stale } from "../cache.ts";
import { inboxOf, moveToProject } from "../capture.ts";
import { channelOf } from "../channels/index.ts";
import { writtenTo } from "../chat.ts";
import { doorIn, listOf } from "../door-in.ts";
import type { Bucket, Deps, Env, Kept } from "../env.ts";
import {
  bucketOf,
  devicesOf,
  FILE_REF,
  GITHUB_NEEDS,
  keepDevices,
  kvOf,
  logOf,
  MOST_DEVICES,
  missing,
  OWN_PROOF_HEADER,
  ownProof,
} from "../env.ts";
import { DoorKeyRefused, GitHubError, github } from "../github.ts";
import { deviceOf } from "../push.ts";
import { type Settings, settings } from "../settings.ts";
import { copyFor, head, listed, newRef, put, remove, stamp } from "../store.ts";
import { docOf } from "./docs.ts";
import { type FileMeta, GONE, MOST_BYTES, PICTURE, safeName, safeType, serve } from "./files.ts";
import { type RepeatAnswers, repeatProblems, repeatWords } from "./forms.ts";
import { fileSrc, list, notebook, repeats, search, thread } from "./reads.ts";
import { ADD, devicesSeen, menu, pushKey, setup } from "./setup.ts";
import * as shapes from "./shapes.ts";

export const BASE = "/admin/chat";
/**
 * How long a read is kept for every tab and phone: past the page's 5-second poll while a run works
 * (5 s after the last one ends), so most polls are answered here and polling stays cheap.
 */
const KEEP_MS = 8_000;

/**
 * A read the page polls (the list, a thread), kept KEEP_MS. When GitHub can't be read (on its
 * second try too), the last good answer this instance has, marked `stale`: the page says it's
 * retrying, not that something broke. None kept: the error, as before.
 */
async function polled<T>(key: string, fn: () => Promise<T>, deps: Deps) {
  try {
    return await cached(key, KEEP_MS, fn, deps.now());
  } catch (e) {
    const had = e instanceof GitHubError ? stale<T>(key) : undefined;
    if (!had) throw e;
    logOf(deps, "web").warn("page.served", {
      what: "last good copy",
      status: e instanceof GitHubError ? e.status : 0,
    });
    return { ...had, stale: true as const };
  }
}

const PAGE_HEADERS = {
  "cache-control": "private, no-cache",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://*.githubusercontent.com https://github.com; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** The one library the chat uses, Mermaid, pinned to a version and its hash (draw.js checks it). */
export const MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js";

/** One of the edge's static files with no sign-in, for a GET or HEAD alone, with these headers. */
async function openFile(req: Request, env: Env, file: string, more: Record<string, string>) {
  const assets = (env as unknown as { ASSETS?: { fetch(r: Request): Promise<Response> } }).ASSETS;
  if (!assets || (req.method !== "GET" && req.method !== "HEAD"))
    return new Response(null, { status: 404 });
  const res = await assets.fetch(new Request(new URL(file, req.url), { method: "GET" }));
  if (!res.ok) return new Response(null, { status: 404 });
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(more)) headers.set(k, v);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(req.method === "HEAD" ? null : res.body, { status: 200, headers });
}

/**
 * The diagram frame (/draw/): a static page with no data and no sign-in, which the chat shows in a
 * sandboxed iframe (no same-origin, so nothing in it can reach the chat, its cookies or the door).
 * It draws the diagram source in its address's #fragment with Mermaid and says how tall it is.
 */
export function drawFrame(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const file = url.pathname.endsWith(".js") ? "/draw/draw.js" : "/draw/index.html";
  return openFile(req, env, file, {
    "content-security-policy": `default-src 'none'; script-src ${url.origin}/draw/draw.js ${MERMAID}; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors ${url.origin}`,
    "cache-control": "public, max-age=3600",
  });
}

/** The notification's pictures, the only files under /note/. */
export const NOTE_PICTURES = ["/note/icon.png", "/note/badge.png"];

/**
 * A notification's icon or badge (ADR 0050), with no sign-in: the phone fetches it by itself when
 * one shows, maybe long after the chat's Access session ran out, and a picture it can't fetch
 * becomes Android's plain bell.
 */
export const notePicture = (req: Request, env: Env): Promise<Response> =>
  openFile(req, env, new URL(req.url).pathname, {
    "content-type": "image/png",
    "cache-control": "public, max-age=86400",
  });

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

/**
 * The page's own files: through Workers static assets, behind the same check. The browser's copy
 * unchanged (its ETag, or its time) is a 304 with no body, as the assets say.
 */
async function page(req: Request, env: Env, path: string) {
  const assets = (env as unknown as { ASSETS?: { fetch(r: Request): Promise<Response> } }).ASSETS;
  if (!assets) return problem(404, "The page isn't deployed here.", "Deploy the edge.");
  const rest = path.slice(BASE.length).replace(/^\/+/, "");
  if (rest && !/^[\w-]+\.(?:html|js|css|json|svg|png)$/.test(rest))
    return problem(404, "Nothing here.", `Open ${BASE}.`);
  const url = new URL(`${BASE}/${rest || "index.html"}`, req.url);
  const ask = new Headers();
  for (const h of ["if-none-match", "if-modified-since"]) {
    const v = req.headers.get(h);
    if (v) ask.set(h, v);
  }
  const res = await assets.fetch(new Request(url, { method: "GET", headers: ask }));
  const same = res.status === 304;
  if (!res.ok && !same) return problem(404, "Nothing here.", `Open ${BASE}.`);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v);
  return new Response(req.method === "HEAD" || same ? null : res.body, {
    status: same ? 304 : 200,
    headers,
  });
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
    // Android's share, before the page's worker took over: New chat, the share left behind.
    if (path === `${BASE}/share` && req.method === "POST")
      return Response.redirect(new URL(`${BASE}/#/new`, url).href, 303);
    if (req.method !== "GET" && req.method !== "HEAD")
      return problem(405, "Read-only.", `Open ${BASE}.`);
    return page(req, env, path);
  }
  const me = s.people.find((p) => channelOf("web")?.chatId.test(p.on.web ?? ""));
  if (!me) return problem(409, "The web chat is off.", `Run ${ADD} on your PC.`);
  const [, route, arg] = api;
  const id = me.on.web as string;
  try {
    if (req.method === "GET") return await get(req, env, deps, s, id, route ?? "", arg, url);
    if (req.method !== "POST" && req.method !== "DELETE")
      return problem(405, "Not here.", "Reload the page.");
    // Only the page itself may post or delete: the edge's own origin, and the chat's header.
    const origin = new URL(env.SHIPIFY_DOOR_URL ?? url.origin).origin;
    if (req.headers.get("origin") !== origin || req.headers.get("x-shipify-chat") !== "1") {
      log.warn("page.refused", { why: "foreign origin" });
      return problem(403, "That didn't come from the chat page.", "Send it from the chat.");
    }
    if (req.method === "DELETE")
      return route === "file" && arg
        ? await deleted(env, deps, arg)
        : problem(404, "Not here.", "Reload the page.");
    if (route === "file" && !arg) return await upload(req, env, deps);
    if (route === "send" && !arg) return await send(req, env, deps, id);
    if (route === "repeat" && !arg) return await newRepeat(req, env, deps, id);
    if (route === "push" && !arg) return await notifications(req, env, deps, id);
    if (route === "move" && !arg) return await move(req, env, deps, s);
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
  me: string,
  route: string,
  arg: string | undefined,
  url: URL,
): Promise<Response> {
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
        await polled(
          `web:list:${repo}:${page}:${closed}`,
          () => list(env, deps, Number(page), closed),
          deps,
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
    const t = await polled(
      `web:task:${repo}:${arg}:${since ?? ""}:${older}`,
      () => thread(env, deps, s, Number(arg), since, older ? Number(older) : undefined),
      deps,
    );
    if (!t) return problem(404, `There's no task #${arg}.`, "Check the number.");
    return tagged(req, shapes.Thread.parse(t));
  }
  if (route === "menu" && !arg)
    return tagged(req, shapes.Menu.parse(await menu(env, deps, Boolean(bucketOf(env)))));
  if (route === "models" && !arg) return models(url, deps, now);
  if (route === "repeats" && !arg)
    return tagged(req, shapes.Repeats.parse(await repeats(env, deps)));
  if (route === "notebook" && !arg)
    return tagged(req, shapes.Notebook.parse(await notebook(env, deps)));
  // Find by meaning (ADR 0070): asked only when you pick it in Ctrl+K, never as you type.
  if (route === "search" && !arg) {
    const words = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
    if (!words || words.length > 200)
      return problem(400, "Say what to find, in 200 characters or fewer.", "Type it again.");
    return tagged(req, shapes.Found.parse(await search(env, deps, words)));
  }
  if (route === "setup" && !arg)
    return tagged(req, shapes.Setup.parse(await setup(env, deps, s, me)));
  if (route === "files" && !arg) {
    const bucket = bucketOf(env);
    if (!bucket) return tagged(req, { v: 1, files: [], count: 0, bytes: 0 });
    const kept = await cached(FILES_KEY, 60_000, () => listed(bucket), now);
    return tagged(
      req,
      shapes.Files.parse({
        v: 1,
        count: kept.count,
        bytes: kept.bytes,
        files: kept.files.map((f) => ({
          ref: f.ref,
          name: f.meta.name,
          type: f.meta.type,
          size: f.meta.size,
          ...(f.meta.task ? { task: f.meta.task } : {}),
          by: f.meta.by,
          at: new Date(f.meta.at).toISOString(),
          src: fileSrc(f.ref),
        })),
      }),
    );
  }
  if (route === "file" && arg) {
    const bucket = bucketOf(env);
    if (!bucket) return problem(404, "Files aren't set up.", `Run ${ADD} on your PC.`);
    const q = url.searchParams;
    return serve(bucket, arg, q.get("download") === "1", q.get("view") === "1");
  }
  if (route === "doc" && arg) {
    const bucket = bucketOf(env);
    if (!bucket) return problem(404, "Files aren't set up.", `Run ${ADD} on your PC.`);
    const d = await docOf(env, deps, bucket, arg);
    if (!d) return problem(410, GONE.error, GONE.fix);
    return tagged(req, shapes.Doc.parse(d));
  }
  return problem(404, "Not here.", "Reload the page.");
}

/** How long a search for models is kept, and a listed model's facts. */
const SEARCH_MS = 600_000;
const DAY_MS = 86_400_000;

/**
 * An agent's gateway, for the picker: with a word, searched as /models <word> does (kept 10
 * minutes); with none, each of the agent's listed models looked up as a run looks it up
 * (`modelLookup`: one model's own answer where its gateway gives one), for its facts (kept a day,
 * read only when the picker opens). A failure is never kept. No ETag: each is read once.
 */
async function models(url: URL, deps: Deps, now: number) {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 40);
  const agent = agentsSeen().find(([id]) => id === url.searchParams.get("agent"))?.[1];
  const gateway = agent?.gateway;
  if (!gateway) return problem(404, "That agent has no list to search.", "Pick from its models.");
  if (!q) {
    const each = await Promise.all(
      (agent.models ?? []).map((id) => {
        const at = modelLookup(gateway, id);
        // A model the answer doesn't have is kept as none; an answer that didn't come, not at all.
        const read = async () => {
          const pool = modelPool(gateway, at ? await listOf(at, deps) : null);
          return pool ? (pool.find((m) => m.id === id) ?? null) : Promise.reject();
        };
        return at
          ? cached(`web:model:${at}:${id}`, DAY_MS, read, now).catch(() => undefined)
          : undefined;
      }),
    );
    return answer(shapes.Models.parse({ v: 1, models: each.filter(Boolean) }));
  }
  if (q.length < 2) return problem(400, "Search with a word.", "Type 2 letters or more.");
  const search = modelSearches(q).find((g) => g.gateway === gateway);
  const read = async () =>
    modelPool(gateway, search ? await listOf(search.url, deps) : null) ?? Promise.reject();
  const found =
    search &&
    (await cached(`web:models:${search.url}`, SEARCH_MS, read, now)
      .then((pool) => poolMatching(gateway, pool, q))
      .catch(() => null));
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

/** Files' list, kept a minute; a change made here reads it again. */
const FILES_KEY = "web:files";

/**
 * One file from the page, streamed into the store as it comes (its length said first, 95 MB at
 * most: MOST_BYTES), with the open chat's number when it has one (x-file-task).
 */
async function upload(req: Request, env: Env, deps: Deps) {
  const bucket = bucketOf(env);
  if (!bucket)
    return problem(409, "Files aren't set up.", `Run ${ADD} on your PC; words still go.`);
  const said = req.headers.get("content-length");
  const size = Number(said);
  const over = `That file is over ${MOST_BYTES / 1e6} MB.`;
  if (size > MOST_BYTES) return problem(413, over, "Send a smaller one, or a link to it.");
  if (said === "0") return problem(400, "That file is empty.", "Pick it again.");
  if (!said || !Number.isSafeInteger(size) || size < 0 || !req.body)
    return problem(411, "That file's size wasn't said.", "Pick it again.");
  let name = "file";
  try {
    name = safeName(decodeURIComponent(req.headers.get("x-file-name") ?? "file"));
  } catch {}
  const task = /^[1-9]\d{0,8}$/.exec(req.headers.get("x-file-task") ?? "")?.[0];
  const meta: FileMeta = {
    name,
    type: safeType(req.headers.get("content-type") ?? ""),
    size,
    by: "you",
    at: deps.now(),
    ...(task ? { task: Number(task) } : {}),
  };
  const ref = newRef(meta.at);
  try {
    await put(bucket, ref, req.body, meta);
  } catch {
    return problem(507, "The file store didn't take it.", "Try again; words still go.");
  }
  forget(FILES_KEY);
  logOf(deps, "web").info("page.served", { what: "file kept", bytes: meta.size });
  return answer(
    shapes.Uploaded.parse({ v: 1, ref, name: meta.name, type: meta.type, size: meta.size }),
  );
}

/** A file deleted, for good: Files' Delete, or one taken off the box before Send. */
async function deleted(env: Env, deps: Deps, ref: string) {
  const bucket = bucketOf(env);
  if (!bucket) return problem(409, "Files aren't set up.", `Run ${ADD} on your PC.`);
  if (!FILE_REF.test(ref)) return problem(404, "That isn't a file here.", "Reload the page.");
  await remove(bucket, [ref]);
  forget(FILES_KEY);
  logOf(deps, "web").info("page.served", { what: "file deleted" });
  return answer({ v: 1, deleted: ref });
}

/**
 * Each file as this chat's own (ADR 0069): one of another chat's (or one from before R2) is copied
 * for it once, under a new ref; one with no chat yet stays, to get this chat's number after the
 * door. The refs to send, those to stamp, and the copies made (`gone`: a file that isn't there).
 */
async function owned(bucket: Bucket, files: shapes.SendBody["files"], now: number, task?: number) {
  const out: shapes.SendBody["files"] = [];
  const unstamped: string[] = [];
  const copies: string[] = [];
  for (const f of files) {
    const meta = await head(bucket, f.ref);
    if (!meta) return { gone: f, files: out, unstamped, copies };
    const fresh = !meta.task && f.ref.startsWith("f-");
    const mine = (task && meta.task === task) || fresh;
    const ref = mine ? f.ref : await copyFor(bucket, f.ref, now, task);
    if (!ref) return { gone: f, files: out, unstamped, copies };
    if (!mine) copies.push(ref);
    if (!task || fresh) unstamped.push(ref);
    out.push({ ...f, ref });
  }
  return { files: out, unstamped, copies };
}

/**
 * After the door: the files it wrote onto a chat get that chat's number when they have none (a new
 * chat's, an Inbox item's page). A copy made for this message that no chat holds (the door refused
 * it, wrote it on no chat, or a file was gone) is deleted now: the clean-up keeps a file with no
 * chat, and its chat's number is all that ever deletes a copy.
 */
async function settle(
  bucket: Bucket,
  deps: Deps,
  own: { files: shapes.SendBody["files"]; unstamped: string[]; copies: string[] },
  written: { parts: number; chat?: number; task?: number },
) {
  const sent = new Set(own.files.slice(0, written.parts).map((f) => f.ref));
  const held = written.chat ? sent : new Set<string>();
  const stray = own.copies.filter((r) => !held.has(r));
  if (stray.length) {
    await remove(bucket, stray).catch(() => {});
    forget(FILES_KEY);
  }
  const unstamped = own.unstamped.filter((r) => sent.has(r) && !stray.includes(r));
  if (written.task && unstamped.length) await stamped(bucket, deps, unstamped, written.task);
}

/** A new chat's files get its number, after the reply: one that fails keeps none (kept). */
function stamped(bucket: Bucket, deps: Deps, refs: string[], task: number) {
  const work = Promise.all(refs.map((r) => stamp(bucket, r, task).catch(() => false))).then(() =>
    forget(FILES_KEY),
  );
  if (deps.waitUntil) deps.waitUntil(work);
  else return work;
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
  b: {
    id: string;
    task?: number;
    words: string;
    use?: string;
    button?: true;
    under?: number;
    files: shapes.SendBody["files"];
  },
) {
  const use = b.use && !instantOf(b.words) ? `use ${b.use}` : "";
  const words = [use, b.words.trim()].filter(Boolean).join("\n");
  if (!words && !b.files.length)
    return problem(400, "There's nothing to send.", "Write something first.");
  if (!words && !b.task)
    return problem(400, "Say what the files are for.", "Add a few words, then send.");
  const bucket = b.files.length ? bucketOf(env) : undefined;
  if (b.files.length && !bucket)
    return problem(409, "Files aren't set up.", `Send the words alone, or run ${ADD}.`);
  const own = bucket ? await owned(bucket, b.files, deps.now(), b.task) : undefined;
  if (bucket && own?.gone) {
    await settle(bucket, deps, own, { parts: 0 });
    return problem(410, `“${own.gone.name}” is gone from the store.`, "Attach it again.");
  }
  const files = own?.files ?? [];
  const album = files.length > 1 ? b.id : undefined;
  const parts = files.length ? files : [undefined];
  let first: DoorSaid | undefined;
  // How many parts the door took, and what it refused: the parts from there aren't written.
  let taken = 0;
  let refused: Response | undefined;
  for (const [i, f] of parts.entries()) {
    const said = await door(env, deps, {
      id: i ? `${b.id}-${i}` : b.id,
      chat: user,
      user,
      words: i ? "" : words,
      forwarded: false,
      ...(b.task ? { repliesTo: b.task } : {}),
      // New chat here (ADR 0069): the first of them opens the chat in the project.
      ...(b.under && !b.task && !i ? { under: b.under } : {}),
      // A button's word on a task (ADR 0069): the web chat shows no message for it.
      ...(b.button && b.task && !f ? { button: true as const } : {}),
      ...(album ? { album } : {}),
      ...(f ? { file: { ref: f.ref, name: f.name, type: f.type, size: f.size } } : {}),
    });
    // What broke, in the door's own words: the page keeps your message to send again, and what's
    // written already (an album's first files) isn't written twice.
    if (said.trouble) refused = problem(503, said.trouble.what, said.trouble.fix);
    else if (said.status !== 200)
      refused = problem(500, "The door refused the chat.", "Run pnpm ship door check on your PC.");
    else if (!i && said.text === undefined)
      refused = problem(
        403,
        "The door didn't let it in.",
        `Run ${ADD}, so your words are let in from the chat.`,
      );
    if (refused) break;
    if (!i) first = said;
    taken = i + 1;
  }
  // A task only when the door wrote your words onto one: an answer at once (/help, a refusal)
  // names none, so the page shows it, in the thread you wrote it in.
  const text = first?.text ?? "";
  const n = writtenTo(text);
  // The files with no chat yet (a new chat's) get the number your words were written onto; an
  // Inbox item's (ADR 0069), its Inbox page's, so they're kept while its project is open.
  const chat = n ?? inboxOf(text);
  if (bucket && own) await settle(bucket, deps, own, { parts: taken, chat, task: b.task ?? chat });
  if (refused) return refused;
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

/**
 * Notifications on this device, or off (ADR 0050): the browser's subscription kept (a sixth device
 * replaces the oldest), or one dropped by its address. Back come the devices kept. Only a device
 * on a known push service is kept, so nobody can point the edge at another address; one already
 * kept as it is costs no write.
 */
async function notifications(req: Request, env: Env, deps: Deps, chat: string) {
  const kv = kvOf(env);
  if (!pushKey(env)) return problem(409, "Notifications aren't set up.", `Run ${ADD} on your PC.`);
  if (!kv) return problem(409, "The chat's store isn't set up.", `Run ${ADD} on your PC.`);
  const b = shapes.PushBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return problem(400, "That doesn't read.", "Reload the page and try again.");
  const had = await devicesOf(kv, "web", chat);
  // The list as it's to be kept, or undefined when nothing changes.
  let list: Kept[] | undefined;
  const { data } = b;
  if ("on" in data) {
    const d = deviceOf(data.on);
    if (!d)
      return problem(
        400,
        "This browser's push service isn't one Shipify sends to.",
        "Use Chrome, Safari, Firefox or Edge.",
      );
    const same = had.find((x) => x.endpoint === d.endpoint);
    if (same?.p256dh !== d.p256dh || same.auth !== d.auth)
      list = [...had.filter((x) => x !== same), { ...d, at: deps.now() }].slice(-MOST_DEVICES);
  } else if (had.some((x) => x.endpoint === data.off))
    list = had.filter((x) => x.endpoint !== data.off);
  if (list) {
    try {
      await keepDevices(kv, "web", chat, list);
    } catch {
      return problem(429, "The store took another change just now.", "Try again in a moment.");
    }
    const what = "on" in data ? "notifications on" : "notifications off";
    logOf(deps, "web").info("page.served", { what, devices: list.length });
  }
  return answer(shapes.Devices.parse({ v: 1, devices: await devicesSeen(list ?? had) }));
}

/**
 * **Move to project** (ADR 0069): the chat linked under the project, with the `in-project` label and
 * no edit of its words, so no run starts. Written as the door App, as the door writes; refused while
 * the door is closed. Back come the words to show.
 */
async function move(req: Request, env: Env, deps: Deps, s: Settings) {
  const b = shapes.MoveBody.safeParse(await req.json().catch(() => null));
  if (!b.success) return problem(400, "That doesn't read.", "Reload the page and try again.");
  const p = known("door-closed");
  if (s.closed) return problem(503, p.what, p.fix);
  const text = await moveToProject(github(env, deps), b.data.task, b.data.project);
  // The list and the project's thread show it on the next read, not 8 s on.
  const repo = env.GITHUB_REPO ?? "";
  forget(`web:list:${repo}:1:false`);
  forget(`web:task:${repo}:${b.data.project}::`);
  forget(`web:plan:${repo}:${b.data.project}`);
  forget(`web:moved:${repo}:${b.data.task}`);
  logOf(deps, "web").info("page.served", { what: "moved to a project" });
  return answer(shapes.Sent.parse({ v: 1, text }));
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
