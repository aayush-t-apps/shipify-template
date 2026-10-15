// @ts-check
// Shipify chat's service worker (ADR 0050): it shows a notification, opens its thread on a tap,
// and takes Android's shares into New chat. It caches nothing: every request goes to the network.
/** The worker itself (the page's types know no worker's). @type {any} */
const sw = self;
const IN = sw.registration.scope;
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
let taken = () => {};

sw.addEventListener("install", (e) => {
  // Every read goes to the network without waking the worker (Chrome 123+).
  const routes = e.addRoutes?.({ condition: { requestMethod: "GET" }, source: "network" });
  e.waitUntil(Promise.resolve(routes).catch(() => {}));
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

// Android's share (the manifest's share_target): New chat opens and asks for it. Nothing is sent
// until you tap Send there.
sw.addEventListener("fetch", (e) => {
  const r = e.request;
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
    .catch(() => undefined);
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
