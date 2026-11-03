// @ts-check
// Shipify chat's service worker (ADR 0050): it shows a notification, opens its thread on a tap,
// takes Android's shares into New chat, and keeps the page's own files so it opens offline too
// (ADR 0069). Never what the page reads (api/…).
/** The worker itself (the page's types know no worker's). @type {any} */
const sw = self;
const IN = sw.registration.scope;
const no = () => {};
/** The page, its scripts, styles, manifest and icons; not the worker. */
const own = (u) =>
  u.startsWith(IN) && /^(?!sw\.)([\w-]+\.(html|js|css|json|svg))?([?#]|$)/.test(u.slice(IN.length));
/** A good copy kept: never a sign-in's redirect. */
const save = (r, res) =>
  res.ok && !res.redirected && caches.open("chat").then((c) => c.put(r, res), no);
/** Only an address inside the chat is opened. */
const inChat = (u) => {
  try {
    return typeof u === "string" && new URL(u, IN).href.startsWith(IN);
  } catch {
    return false;
  }
};
const windows = () => sw.clients.matchAll({ type: "window", includeUncontrolled: true });
// What was shared, in memory only, till New chat takes it (a minute at most).
let shared;
let taken = no;

sw.addEventListener("install", (e) => {
  let r;
  try {
    // What the page reads goes to the network without waking the worker (Chrome 123+).
    const urlPattern = new URLPattern({ pathname: `${new URL(IN).pathname}api/*` });
    r = e.addRoutes?.({ condition: { urlPattern }, source: "network" });
  } catch {}
  // The page's files, kept now (the page that installed it came before it).
  const files = ["", "app.js", "compose.js", "app.css", "manifest.json", "icon.svg"];
  const kept = files.map((f) => fetch(IN + f).then((res) => save(IN + f, res), no));
  e.waitUntil(Promise.all([r?.catch(no), ...kept]));
  sw.skipWaiting();
});
sw.addEventListener("activate", (e) => e.waitUntil(sw.clients.claim()));

// The Push API's own message (edge/src/push.ts); an open chat reads now. Every push shows one.
sw.addEventListener("push", (e) => {
  /** @type {any} */
  let n = {};
  try {
    n = e.data.json().notification || {};
  } catch {}
  const tag = n.tag || "";
  e.waitUntil(
    Promise.all([
      sw.registration.showNotification(n.title || "Shipify", {
        body: n.body || "",
        // Outside the sign-in: the phone fetches them after Access's session ends too.
        icon: "/note/icon.png",
        badge: "/note/badge.png",
        tag,
        renotify: Boolean(tag && n.renotify),
        lang: n.lang || "",
        data: inChat(n.navigate) ? n.navigate : IN,
      }),
      windows().then((l) => {
        for (const c of l) c.postMessage("read");
      }),
    ]),
  );
});

// A tap: the chat at that thread, the open one if there is one.
sw.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const open = inChat(e.notification.data) ? e.notification.data : IN;
  e.waitUntil(
    windows().then((l) => {
      const c = l.find((x) => inChat(x.url));
      if (!c) return sw.clients.openWindow(open);
      c.postMessage({ open: new URL(open).hash || "#/" });
      return c.focus();
    }),
  );
});

// The page's own files: the network's, kept; offline, the last kept. Android's share (the
// manifest's share_target): New chat opens and asks for it. Nothing is sent until you tap Send.
sw.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method === "GET" && own(r.url))
    return e.respondWith(
      fetch(r).then(
        (res) => {
          e.waitUntil(save(r, res.clone()));
          return res;
        },
        () =>
          caches
            .match(r, { ignoreSearch: true, ignoreVary: true })
            .then((c) => c || Response.error()),
      ),
    );
  if (r.method !== "POST" || r.url !== `${IN}share`) return;
  const got = r
    .formData()
    .then((f) => ({
      text: ["title", "text", "url"]
        .map((k) => f.get(k))
        .filter(Boolean)
        .join("\n"),
      files: f.getAll("files").filter((x) => typeof x !== "string"),
    }))
    .catch(no);
  shared = got;
  e.respondWith(Response.redirect(`${IN}#/new?shared`, 303));
  const held = new Promise((done) => {
    taken = () => done(0);
    setTimeout(taken, 6e4);
  });
  e.waitUntil(
    held.then(() => {
      if (shared === got) shared = undefined;
    }),
  );
});
sw.addEventListener("message", (e) => {
  const s = shared;
  if (e.data !== "shared?" || !s) return;
  shared = undefined;
  e.waitUntil(s.then((x) => x && e.source?.postMessage({ shared: x })).finally(taken));
});
