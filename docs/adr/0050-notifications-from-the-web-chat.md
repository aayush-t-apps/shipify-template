---
status: accepted (merged #324) and built (task #321; the owner's go on 2026-10-10, "ok we are good lets follow the plan cleanly"); see [As built](#as-built-2026-10-10)
date: 2026-10-10
amends: 0032 (a channel read in place may tell you a reply came, from its `send`, and that answer counts for nothing), 0036 (its layer 5, notifications with the page closed, built; the page's first service worker; Android's share menu)
---

# 0050: Notifications from the web chat, and Android's share menu

## The owner's asks (task #321, 2026-10-10)

- "is it pull based … does it also use some push … cleanly we can add simple web push or something
  for the worker so even if user is away from tab they get notification for new message is there
  clean cheapest no extra resource simple way"
- "what all can this become can it make things lighter and cleaner poll is also good simple end to
  end does this work simply cleanly worth doing"
- "besides notifications … does it give anything long term … service worker or something is it
  additional resource of call for existing limits does it achieve or take off load … can it help in
  our other core tasks can simply help not coupling but decouple and clean"
- To "Shall I write the ADR for Web Push in the web chat, with the Android share button
  included?": "ok yes this looks good clean well lets plan a good nice common clean interface
  modular for other tasks also it can fit cleanly"

## Context

The web chat (ADR 0036) polls: it reads what's on screen every 5 to 30 seconds while it's open, and
nothing while it's hidden. Nothing is pushed to it, so a closed page tells you nothing. Its channel
is "read in place": its `send` does nothing, because the page reads the reply on the task.

So a task you start in the web chat can finish, or wait for your answer, and nothing tells you until
you open the page. Telegram doesn't hear of it either, because a reply goes back where you wrote.
ADR 0036 left this as layer 5: "a notification when something needs you, with the page closed (Web
Push) … Worth it only if you drop Telegram."

The owner asked for it, as cheap and clean as it can be, kept apart from the core, and as one
common interface that later work fits into.

## What was found (checked 2026-10-10, `main` at `dd5c677`)

| Fact | How it was checked |
|---|---|
| The page reads every 5 s while a run works, 10 s while your words wait for one, 30 s otherwise, and nothing while hidden. Coming back reads at once (`wake`) | `edge/public/admin/chat/app.js:1207-1240` (`tick`, `wake`) |
| Those reads are cheap: an unchanged one is a 304 with no body, and the edge keeps each read 5 s for every tab | `edge/src/web/routes.ts` (`tagged`, `KEEP_MS`), `edge/src/cache.ts` |
| The web chat's `send` does nothing. `deliver()` skips a channel read in place, and its files are kept by `sendFiles` | `edge/src/channels/web.ts` (`send`); `edge/src/door-out.ts:111-122, 230-236` |
| Every reply reaches the door once: right after writing it, apply calls `POST /door/replied` with the run's OIDC token, waits up to 30 s, and never calls again. A reply with the door's 🚀 isn't sent again | `cli/kernel/door.ts` (`tellDoor`); `edge/src/door-out.ts` (`markedBy`) |
| A reply goes back to the chat you wrote from. Alerts, repeats' replies and recipes' tasks also go to your default channels (`SHIPIFY_SEND`) | `cli/kernel/route.ts`; `cli/contracts/labels.ts` (`TO_DEFAULTS`) |
| When GitHub refuses the door App's key, the watch tells every chat directly, the web chat included, and the web chat drops it | `edge/src/watch.ts` (`keyRefused`) |
| The watch's notice, and the door's alerts about files and rendering, already skip a chat read in place | `edge/src/watch.ts` (`notice`); `edge/src/door-out.ts` (`settle`, `sendFiles`) |
| A channel adapter may import only `channel.ts`, `env.ts` and `cli/contracts/` | `tests/architecture.test.ts` (`KINDS`) |
| A channel is ready only when every secret in its `needs` is set, and the settings list is made from `needs` | `edge/src/door-out.ts` (`ready`); `edge/setup/settings.ts` |
| The chat's store (`FILES`, Workers KV) keeps files for 7 days, and your model under `model:<channel>:<chat>`, read with one `get` | `edge/src/channels/web.ts`; `edge/src/model.ts` |
| The page is 39,477 bytes as sent (gzip) of its 40,960: 1,483 bytes left | `tests/edge/web/extension.test.ts`; measured |
| The page installs as an app: a manifest with scope `/admin/chat/`, standalone | `edge/public/admin/chat/manifest.json`; the extension test |
| The page's files go through the Worker, behind the Access check, with `default-src 'none'` and `script-src 'self'`. A name like `sw.js` is served as one of them | `routes.ts` (`page`, `PAGE_HEADERS`) |
| A chat `POST` must carry the edge's own `Origin` and `x-shipify-chat: 1` | `routes.ts` |
| The Worker's secrets are put from your PC (`wrangler secret put`, from stdin) and listed by name. A step sees `--new` as `SHIPIFY_RENEW` | `edge/setup/worker.ts` (`putEdgeSecret`, `edgeSecretNames`, `deleteEdgeSecret`); `tools/telegram/setup.ts` |
| The edge knows its own address (`SHIPIFY_DOOR_URL`) | `edge/src/env.ts` |
| The log's event names are one list, and `door.out.sent` and `door.out.failed` fit | `cli/contracts/labels.ts` (`EVENTS`) |

## What the web offers (checked 2026-10-10)

| Fact | Source |
|---|---|
| A push service needs `TTL`, takes `Urgency` (`very-low` to `high`), and replaces a message not yet delivered with a newer one of the same `Topic` (32 characters at most, base64url). A subscription that's gone answers 404 or 410. A body of 4,096 bytes or less is always taken | [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) §5.2–5.4, §7.2, §7.3 |
| The payload is encrypted end to end (`aes128gcm`) | [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291). **Its Appendix A reproduced byte for byte with WebCrypto (Node 22) on this box** |
| The sender signs each request (VAPID: an ES256 JWT, `aud` the service's origin, `exp` within 24 h, `sub` a `mailto:` or `https:` address) | [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292); [Apple's guide](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) |
| Measured on this box (a Raspberry Pi 4, Node 22): **4.1 ms** to encrypt one notification with its one-time key, **0.5 ms** to sign. Cloudflare's servers are faster | a throwaway script. The live check after the build reads the real CPU time on the Worker |
| A Worker's WebCrypto has ECDSA and ECDH on P-256, HKDF and AES-GCM | [Cloudflare: Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) |
| A free Worker: 10 ms of CPU a request, 50 subrequests, 6 connections at once | [Cloudflare: limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Free KV: 100,000 reads and 1,000 writes a day, one write a second to a key | [Cloudflare: KV limits](https://developers.cloudflare.com/kv/platform/limits/) |
| Safari: every push must show a notification, or after 3 the subscription is removed. On an iPhone or iPad only a Home Screen app (16.4+) gets them, turned on by a tap. Apple's service is `*.push.apple.com` | [WebKit bug 236863](https://bugs.webkit.org/show_bug.cgi?id=236863) ("Enforce silent push quota"); Apple's guide; [WebKit: Web Push for web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| **Declarative Web Push:** a push whose data is `{"web_push": 8030, "notification": {"title", "navigate", "body", "tag", "renotify", …}}` is shown by the browser itself, with no service worker, so it's never silent. A browser without it hands the same JSON to the service worker | [the Push API](https://w3c.github.io/push-api/) (a working draft); [WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/): Safari 18.5, iOS 18.4 |
| Chrome lets a push show nothing only while the site's tab is focused | [Pushpad](https://pushpad.xyz/blog/chrome-push-notifications-this-site-has-been-updated-in-the-background) |
| **Share Target** (`share_target` in the manifest, a `POST` the service worker answers): Chrome on Android, for an installed app. Not Safari or Firefox, and on Windows and macOS only behind a flag | [Chrome's guide](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target); [WebKit bug 194593](https://bugs.webkit.org/show_bug.cgi?id=194593) |
| A service worker's static routes (`addRoutes`, Chrome 123+) send matching requests to the network without starting it | [Chrome's blog](https://developer.chrome.com/blog/service-worker-static-routing) |

## Options

**How a notification reaches you:**
- **A. From the web chat's own `send`.** (+ no new contract, kind or setting: whatever reaches the
  web chat now, or later, notifies you / − about 350 lines and a secret)
- **B. A channel of its own (`push`) beside `web`.** (− two names for one chat; the core, or
  `SHIPIFY_SEND`, has to pair them, and a reply to the web chat misses it without a new rule)
- **C. Keep a connection open** (SSE, WebSockets, a Durable Object). (− it works only while the page
  is open, which is when polling already works; a Worker held busy, or a new resource)
- **D. ntfy**, roadmap item 4's way to notify without Telegram. (− another app to install; its server
  reads the words unless you run one; a topic's name is the only lock)
- **E. Telegram, as now.** (+ nothing to build / − the web chat never stands alone)

**What a notification carries:**
- **A. The Push API's declarative message:** the state, the task's number and title, and where a tap
  goes. (+ a standard shape; Safari 18.4+ shows it with no service worker, so a broken one can't
  cost you the subscription / − the encryption, about 60 lines)
- **B. An empty push.** (+ no encryption / − every one says "New reply" and opens the list, and
  Safari's own path needs data)
- **C. The reply's words.** (− long, on your lock screen, and a reply can hold anything a run read)

**The key:**
- **A. Its own, made on your PC.** (+ a new door key doesn't silence your devices)
- **B. Made from the door App's key.** (+ no new secret / − a new door key silences every device, and
  one key does two jobs)

**The code:**
- **A. One small file of our own on WebCrypto.** (+ no dependency; tested on the RFC's own example)
- **B. A library.** (− `web-push` needs Node's crypto and https, not a Worker's; others add a
  dependency for about 150 lines)

## Decision

Chosen **A** each time: the one interface already there, the standard's own shape, a key of its
own, and no dependency.

### 1. The one interface already there: the web chat's `send` tells you

Everything that goes out to you already goes the same way: `deliver()` calls each chat's
`channel.send(out)`. That's every reply, Needs you, list for your Yes, alert, repeat's and recipe's
reply. The web chat's `send` does nothing today. It becomes the doorbell, so whatever reaches the
web chat notifies you, now and later, with nothing new to connect.

- **`deliver()`** calls the `send` of a chat read in place too, as a notification. It's started
  first and awaited at the end, so Telegram's send waits on nothing, and its answer is ignored. It
  never counts toward the 🚀, a refusal or the watch's notice.
- **`inPlace` stays.** The reply is read on the task, and the run's files are kept for the page,
  whatever happens to a notification.
- **The contract says so** (`inPlace` in `channel.ts`): its `send` may tell you a reply came, never
  with its words, and its answer counts for nothing.
- **Who gets one is decided where it is today** (`cli/kernel/route.ts`), with no new rule and no
  setting:
  - your words in the web chat put `web:me` in the reply's `to`;
  - alerts, repeats' replies and recipes go to `SHIPIFY_SEND`;
  - a task you carry on in Telegram tells Telegram, so nothing comes twice.

### 2. `edge/src/push.ts`: Web Push, and nothing of Shipify's

One file, WebCrypto only, no dependency. It knows the standards and nothing else.

```ts
/** A device that takes notifications: the browser's subscription, checked. */
export interface Device { endpoint: string; p256dh: string; auth: string }
/** What a notification says: the Push API's declarative message (section 3). */
export interface Note {
  web_push: 8030;
  notification: { title: string; body?: string; navigate: string; tag: string; renotify?: boolean; lang?: string };
}
/** What the page sends, if it's an https address on a known push service with keys of the right size. */
export function deviceOf(v: unknown): Device | undefined;
/** The key's public half (base64url), which the page subscribes with. */
export function publicKey(key: string): string | undefined;
/**
 * One notification to one device: `ok`, `gone` (404 or 410: drop it) or `failed` (anything else,
 * or no answer in 5 s). It never throws and never tries again.
 */
export function ring(fetch: Fetch, key: string, subject: string, device: Device, note: Note): Promise<"ok" | "gone" | "failed">;
```

- **Each message** is encrypted (RFC 8291) with its own one-time key and salt, and signed (RFC 8292)
  with a JWT kept 12 hours per push service in the Worker's memory.
- **Its headers:** `TTL` a day, `Urgency: high`, `Topic` the note's tag, `Content-Encoding:
  aes128gcm`.
- **Known push services:** Google's (`fcm.googleapis.com`: Chrome, and browsers on Android), Apple's
  (`*.push.apple.com`), Mozilla's (`updates.push.services.mozilla.com`) and Microsoft's
  (`*.notify.windows.com`: Edge on Windows). A device anywhere else is refused.
- **The channel kit:** the architecture test lists `push.ts` beside `channel.ts` and `env.ts`, so an
  adapter may import it. A later chat that's read in place uses it the same way.

### 3. A notification is the Push API's own shape

```json
{ "web_push": 8030,
  "notification": { "title": "Needs you · #321", "body": "Get me homepi box health cpu memory all of it",
                    "navigate": "https://<the edge>/admin/chat/#/t/321", "tag": "t321", "renotify": true, "lang": "en" } }
```

- **The title** is the reply's state and its task. **The body** is the task's title, 120 characters
  at most. **A tap** opens that thread.
- **It never carries the reply's words,** a file's name or a list. A lock screen shows it, and a
  reply can hold anything a run read. An alert with no task (the door's key refused) says
  `Alert`, its first sentence (Shipify's own words), and opens the chat.
- **No version of ours:** `web_push: 8030` is the standard's own mark.
- **Encrypted end to end:** Google, Apple, Mozilla and Microsoft carry it but can't read it.
- **One per task:** a newer one for the same task replaces the older and sounds again. A phone
  that's off gets only the newest when it's back (`Topic`), within a day (`TTL`).
- **Every one is urgent** (`Urgency: high`): Android holds normal ones back while the phone dozes,
  and each is a reply you asked for.

### 4. Your devices, in the store you have

- **One key per chat in `FILES`:** `push:web:<chat>`, beside your model's `model:web:<chat>`. It's a
  JSON list of at most 5 devices, each with when it was added. A sixth replaces the oldest.
- **One `get` per reply** that reaches the web chat. Never a `list`, which KV counts apart.
- **A device its push service calls gone** is dropped, with one write. Nothing else writes.
- **No `WEB_PUSH_KEY`, no store, or no device:** `send` does nothing, as today.
- **`env.ts` keeps the list's reading and writing,** beside the file store, since both the adapter
  and the chat's routes use it. Its `Kv` interface doesn't change.

### 5. Turning them on: `POST /admin/chat/api/push`

- **`{"on": <the browser's subscription>}`** keeps the device; **`{"off": "<its address>"}`** drops
  it. Back come the devices kept, each as a short id (the first 8 hex characters of its address's
  SHA-256), its push service, and since when.
- **The same locks as every chat `POST`:** Access's token, the edge's own `Origin` and
  `x-shipify-chat: 1`. `deviceOf` refuses anything but https on a known push service, so nobody can
  point the Worker at another address.
- **The menu read** gains `notifications: {key}` (the public key) when the edge has one. **Setup's
  read** gains the devices kept, on the web chat's card: one more `get`, kept 5 s like every read.

### 6. `sw.js`: the page's service worker, about 40 lines

| Event | What it does |
|---|---|
| `push` | Shows the notification from its JSON. An open chat is told to read now, through the same `wake()` as ↻. (Safari 18.4+ shows it itself and doesn't wake the worker, so an open chat there reads it at its next turn, within 5 to 30 s) |
| `notificationclick` | Focuses an open chat, or opens one, at `navigate`, only if that's inside `/admin/chat/`; otherwise the chat itself |
| `fetch` (the share's `POST` only) | Android: answers with New chat, and hands that page what was shared (`postMessage`). Nothing is stored or sent |
| `install` | `addRoutes`: every `GET` goes to the network without waking the worker (Chrome 123+). `skipWaiting` and `clients.claim`, so a new one takes over at once |

- **No cache and no offline copy.** Every request goes to the network, as now.
- **The page registers it on every load,** so the share and reading now work with notifications off
  too. Its scope is the chat's, `/admin/chat/`.
- **The page's CSP gains `worker-src 'self'`.**
- **Its own budget: 2 KB as sent,** apart from the page's 40 KB. It loads once, then a 304.

### 7. The page's part, about 1 KB as sent within the 40 KB

- **Setup → Notifications on this device:** a switch.
  - On: the browser asks you (only after a tap), the page subscribes with the menu's key and sends
    it.
  - Off: it drops it and unsubscribes.
  - Setup lists the devices kept, this one marked.
  - In Safari on an iPhone outside the Home Screen app, it says to add Shipify to the Home Screen
    and open it from there.
- **Each time the page opens with them on,** it subscribes again and sends it, with no tap, if the
  browser changed the subscription or the edge's key changed (`--new`).
- **When a thread shows,** its notification leaves the tray.
- **A share** lands in New chat's box as if picked with 📎 (the same 5 files, 10 MB each, checked
  the same way), with its words and link in the text. You add words and tap Send.

### 8. Android's share menu

- **The manifest gains `share_target`:** a `POST` (multipart) to `/admin/chat/share`, with a title,
  text, a link and files of any type, as 📎 takes.
- **Android only** (and ChromeOS), for the installed app. Not on an iPhone, or in Chrome on a PC.
- **After the deploy,** Android picks up the new manifest when it next updates the app (within a
  day), or at once if you install it again.

### 9. The key, and setup

- **`WEB_PUSH_KEY`, a Worker secret:**
  - a P-256 key pair as a JWK, its public half inside, made on your PC (`node:crypto`);
  - put on the Worker from stdin, and never printed or saved anywhere else;
  - not in the web adapter's `needs`, so the chat works without it;
  - on the edge's settings list, as optional;
  - signed for as the edge's own address (`SHIPIFY_DOOR_URL`, VAPID's `sub`).
- **`ship add webchat` gains a step, "Turn on notifications".** It makes the key if the Worker has
  none, and keeps it on a second run. `--new` makes a new one. It adds `web` to your default
  channels (`SHIPIFY_SEND`) when you have none, so alerts, repeats and recipes reach you too. With
  Telegram there, it leaves them as they are and says how to switch: `pnpm ship remove telegram
  --yes`, then this again.
- **`ship remove webchat`** also deletes the key and takes `web` out of `SHIPIFY_SEND`.

### 10. One word for it

"Notification" wherever a person reads it (Setup, the guides, the setup step). `/ping` stays the
boxes' check.

## Changed from the plan in the thread

- **The shape:** the Push API's declarative message, not one of ours (`{v, title, body, open,
  tag}`). Safari 18.4+ then shows it with no worker, and the worker reads the same JSON elsewhere.
- **Every notification is urgent,** not only Needs you, Failed and Alert: a Done one could wait
  minutes on a dozing Android phone.
- **The share is Android's** (and ChromeOS's), not desktop Chrome's: there it's behind a flag.
- **Setup lists the devices kept,** so you can see which get notifications.
- **"Notification", not "ping",** in what you read.
- **About 350 lines,** not 200, with the share and the devices in Setup.

## What it costs, and what it saves

- **Per reply that reaches the web chat:** one KV read, and one `POST` per device, in parallel, each
  5 s at most. They ride in the call the run already makes to the door. No new request, cron, store
  or service.
- **CPU:** a few milliseconds a device on this Pi, expected well under that on Cloudflare, within a
  request's 10 ms for your 1 or 2 devices. The signature is reused for hours.
- **Subrequests:** the door's few GitHub calls, one KV read and at most 5 notifications, far under 50.
- **Writes:** one per device turned on or dropped, of the 1,000 a day.
- **On your phone:** the worker sleeps until a notification or a share. Opening the chat checks
  `sw.js` with a 304.
- **Saved:** with the chat closed, nothing is read: you're told. And Telegram becomes optional. Drop
  it, and a bot, two secrets, a public webhook and the watch's Telegram checks go with it.
- **The core:** one line in `deliver()`, the contract's comment, and its conformance test. Nothing
  in `cli/`.

## What you accept

- **On an iPhone,** notifications come only to the Home Screen app (iOS 16.4+).
- **A tap after Access's sign-in has ended** goes through the sign-in first, and may land on the
  chat's list rather than the thread: a sign-in you type into drops the `#/t/321`. A longer session
  on the chat's Access application helps (no code).
- **A notification says what happened and where,** not the words. You read and answer in the chat.
- **It's best effort:** a phone saving power can hold one back. Nothing is lost: the reply is on the
  task.
- **Anyone holding your Cloudflare account** could send your devices a notification. They can
  already read everything the edge reads.

## Edge cases

- **No key yet:** nothing is sent. Setup says "Notifications aren't set up: `pnpm ship add webchat
  --yes`", and the switch is hidden.
- **No store (`FILES` unbound):** the switch says the store isn't set up, as 📎 does.
- **You said no to the browser's question:** the switch stays off and says where to allow it (the
  browser's site settings, or the phone's settings for the app).
- **A device gone** (uninstalled, its data cleared): its push service answers 404 or 410, and it's
  dropped.
- **A push service busy or down** (429, 5xx, 5 s with no answer): that device is skipped, and
  nothing tries again (ADR 0042). The reply is on the task.
- **A push service refuses the signature** (403): the device is kept, since the fault may be ours,
  and the log says so. After `--new`, each device subscribes again the next time it opens the chat.
- **A sixth device:** it replaces the oldest.
- **The Worker's CPU limit:** a request over its 10 ms fails, and the reply's 🚀 with it. The live
  check after the build reads the door's call's CPU time on Cloudflare. If it's near the limit, a
  fix keeps fewer devices.
- **Two devices turned on in the same second:** KV takes one write a second to a key, so the second is
  told to try again in a moment. From two places within a minute, KV may keep only the later.
  Setup's list shows which are kept: turn the other on again.
- **The chat open on that thread:** the notification shows, then the page reads the thread and
  clears it. Safari before 18.4 removes a subscription whose pushes show nothing, so the worker
  always shows one.
- **The chat open on another device that just read the thread:** the edge keeps a read 5 s, so a tap
  within those may show the thread a moment old. The next read has the reply.
- **A burst of replies on one task** (a repeat, a retry): one notification, the newest.
- **The run never reached the door** (the edge down at that moment): no notification. The watch's
  notice stays for chats that are pushed to, and the page shows the reply when you open it.
- **The door closed** (`SHIPIFY_DOOR=closed`): nothing goes out, notifications included.
- **A reply sent again:** a reply with the door's 🚀 isn't sent again, so it doesn't notify again.
- **A new `sw.js` after a deploy:** the browser finds it when the chat opens, and it takes over at
  once. It caches nothing, so there's no old copy to serve.
- **A check for a new `sw.js` after the sign-in has ended:** it fails quietly, and the one installed
  keeps working.
- **A share after the sign-in has ended:** the sign-in opens, and what was shared is dropped, since
  it was only in the worker's memory. Share it again.
- **A share of a sixth file, or one over 10 MB:** refused in the page, as 📎 does, before anything is
  sent.
- **A share while New chat holds a draft:** the files join it, up to 5.
- **A browser with no Push API, or no service worker:** no switch, and the chat works as today.
- **A forged subscription from another site:** refused, as every chat `POST` from elsewhere is.
- **`remove webchat`:** the key goes, so nothing more is sent. The device list stays in the store,
  unused, until a new key's first notifications drop the gone devices.

## Setup

About a minute, after the web chat, and only if you want notifications:

```sh
pnpm ship add webchat --yes   # one new step: Turn on notifications
```

| Step | What it does | It's done when |
|---|---|---|
| **Turn on notifications** (new) | makes the key on your PC and puts it on the Worker, if it has none; adds `web` to `SHIPIFY_SEND` when it's empty | the Worker lists `WEB_PUSH_KEY` |

**Then on each device:**
1. **On an iPhone,** first open the chat in Safari, tap Share, then **Add to Home Screen**, and open
   Shipify from there.
2. **In the chat,** open **Setup**, turn on **Notifications on this device**, and allow it.
3. **Check:** Setup lists this device. Ask something, close the chat, and the notification comes
   when the answer does.

**To have alerts, repeats and recipes notify you here instead of Telegram:** `pnpm ship remove
telegram --yes`, then `pnpm ship add webchat --yes` again.

## Docs and clean-up

The build updates each of these in the same PR:

- `docs/channels.md`:
  - the first table's "You get" row for the web chat;
  - "Replies are read in place … keep Telegram for pings" becomes a **Notifications** part: turning
    them on, the iPhone, what one says, and the share menu;
  - "A channel read in place": its `send` may tell you a reply came, never with its words, and its
    answer counts for nothing.
- `docs/door.md`: the way out (an in-place chat is told too), and the chat's routes
  (`…/api/push`, `sw.js`, `/admin/chat/share`).
- `docs/setup.md` and `docs/getting-started.md`: `ship add webchat`'s new step, and turning
  notifications on per device.
- `docs/settings.md`: `WEB_PUSH_KEY`, made from `edge/setup/settings.ts`.
- `docs/security.md`, the web chat's part:
  - what a notification carries;
  - the key;
  - devices only on known push services;
  - `worker-src`;
  - a share stays on the phone until you tap Send.
- `docs/troubleshooting.md`: the row "a reply didn't show while the page was closed" becomes rows for
  no notification (no key, not allowed, an iPhone outside the Home Screen app, a new key) and a tap
  that lands on the sign-in.
- `docs/glossary.md`: **notification** (new), and **web chat**.
- `docs/roadmap.md`:
  - the web chat's layer 5 moves to Done;
  - ntfy leaves item 4, since notifications without Telegram are here.
- `docs/tour.md`: "the web chat reads in place" gains "and notifies your devices".
- `README.md`: the lines on how replies reach the web chat.
- `AGENTS.md`: the channels row names `edge/src/push.ts` and `sw.js` with the web chat's code.
- `tools.json`: the webchat entry's new step and its description.
- The code's own words: the headers of `channel.ts`, `door-out.ts`, `web.ts` and `routes.ts`.
- `CHANGELOG.md` (Shipify's version moves at its next release, as ever).

Nothing becomes obsolete. ADR 0036's "keep Telegram for pings" and its layer 5 are answered here.

## Build plan

One PR, about 350 lines of code besides the tests and docs:

| Part | Where |
|---|---|
| Web Push: `deviceOf`, `publicKey`, `ring` | `edge/src/push.ts` (new) |
| The device list: read, keep, drop | `edge/src/env.ts`, beside the file store |
| The web chat's `send` tells your devices | `edge/src/channels/web.ts` |
| `deliver()` tells an in-place chat too, its answer ignored; the contract's words | `edge/src/door-out.ts`, `edge/src/channels/channel.ts` |
| `…/api/push`, the menu's key, Setup's devices, `worker-src` | `edge/src/web/routes.ts`, `setup.ts`, `shapes.ts` |
| The service worker | `edge/public/admin/chat/sw.js` (new) |
| The switch, reading now, clearing the tray, the share into New chat | `edge/public/admin/chat/app.js`, `compose.js` |
| `share_target` | `edge/public/admin/chat/manifest.json` |
| `WEB_PUSH_KEY` | `edge/setup/settings.ts`, `edge/src/env.ts` (`Env`) |
| The setup step, and remove | `tools/web/setup.ts`, `tools/web/web.ts`, `tools.json` |
| `push.ts` in the channel kit | `tests/architecture.test.ts` |

**Order:**
1. `push.ts`, test first.
2. The store and `send`.
3. `deliver()`.
4. The route and the reads.
5. `sw.js` and the page.
6. The setup step.
7. The docs.

**Then live, once the merge has deployed the edge** (no box can open a phone): one notification each
to Chrome on Android and to the iPhone's Home Screen app, and the door's call's CPU time, read in
Cloudflare's dashboard.

## Tests

- **`tests/edge/push.test.ts` (new):**
  - RFC 8291's Appendix A, byte for byte, with its salt and one-time key given;
  - the JWT checks out with `publicKey`, with `aud`, `exp` within 24 h and `sub`;
  - `deviceOf` refuses http, another host, keys of the wrong size and an address that's too long;
  - `ring`: 201 is `ok`; 404 and 410 are `gone`; 403, 429, 500 and no answer are `failed`;
  - its headers: `TTL`, `Urgency`, `Topic`, `Content-Encoding`.
- **`tests/edge/channels.test.ts`,** the rule for a channel read in place:
  - `send` says ok and pushes no words;
  - with devices, each notification, decrypted, carries no word of the reply's text, and its title
    is "<state> · #<n>";
  - a gone device is dropped;
  - with no key, nothing is fetched.
- **`tests/edge/door-out.test.ts`:**
  - a reply for Telegram and the web chat: Telegram gets the words, the web chat is told, and the
    reply is marked 🚀;
  - the web chat's notification failing still gives the 🚀, and `sent` counts Telegram only;
  - a reply that has the 🚀 already tells no one.
- **`tests/edge/web/routes.test.ts`:**
  - `…/api/push` with no token answers 403, and a foreign `Origin` is refused;
  - a device elsewhere is refused;
  - on, then off;
  - a sixth device replaces the oldest;
  - the menu has the key only when it's set.
- **`tests/edge/web/extension.test.ts`:**
  - `sw.js` is under 2 KB as sent and outside the page's sum, and the page is still under 40 KB;
  - the manifest's `share_target` is in scope;
  - the CSP has `worker-src 'self'`;
  - `sw.js` caches nothing and opens only paths inside `/admin/chat/`.
- **`tests/architecture.test.ts`:** `push.ts` is in the channel kit and imports nothing of Shipify's.
- **`tests/settings.test.ts`:** `WEB_PUSH_KEY` is on the list (`-u` for `docs/settings.md`).
- **`tests/web-setup.test.ts`:**
  - the step makes the key once, keeps it on a second run, and makes a new one with `--new`;
  - it adds `web` to `SHIPIFY_SEND` only when that's empty;
  - remove deletes the key and takes `web` out.

## Consequences

- **Easier:**
  - The web chat tells you when it has something, with the page closed. Everything that reaches it
    notifies you, and anything that reaches it later will too, through the same `send`.
  - It can stand alone, so Telegram is optional.
  - Android's share menu sends a file to Shipify in two taps.
- **Harder:**
  - The edge holds one more secret.
  - The page has a service worker, so a deploy's new `sw.js` must take over cleanly (it caches
    nothing, so it does).
  - A chat read in place is no longer silent: its `send` may make network calls, though their
    answer counts for nothing.
- **Unchanged:** polling, the core, the runs, the boxes, the record, Telegram, and every other
  channel.

## Confirmation

- The tests above, in `pnpm verify`.
- `pnpm ship selftest webchat` still passes, and `pnpm ship add webchat --yes` says the key is set.
- **Live, once it's built:** turn notifications on in the chat on your phone, ask something, close
  the chat, and the notification comes with the answer. A tap opens that thread. On Android, share
  a photo to Shipify: New chat opens with it attached, and nothing is sent until you tap Send.

## As built (2026-10-10)

Built in one PR on task #321, as planned, with these details settled:

- **`ring` takes the edge's clock with its fetch** (`ring(net, key, subject, device, note)`, where
  `net` is `{ fetch, now }`, which the edge's `Deps` fits): the signature's `exp` needs the time.
  `push.ts` also exports `serviceOf` (which company runs an address, for Setup) and `encrypt`
  (RFC 8291 alone, which the test checks on the RFC's example).
- **A device's keys are checked on every read** of the list, not only when it's turned on: a list
  that doesn't read is none, so the Worker never sends anywhere but a known push service.
- **A new key doesn't send `off`:** the page subscribes again and sends the new device; the old one
  is dropped as gone at its next notification. Sending both at once would hit KV's one write a
  second to a key.
- **The same device sent again costs no write** (the page sends it each time it opens with a
  changed subscription or key).
- **No store, with a key:** the switch shows, and turning it on says "The chat's store isn't set
  up" from the route, rather than a line of its own in the page: the page had 1.4 KB left.
- **The page's part** is 1.3 KB as sent: the page is 40,851 bytes of its 40,960, and `sw.js`
  1,449 bytes of its own 2,048. The next change to the page needs room made first.
- **A device turned on stays on when sending it again fails** (offline as the page opens): only
  turning it off clears it, so the next opening tries again.
- **A share that reaches the edge** (the worker not installed yet) answers 303 to New chat, so it
  never shows an error page; what was shared is dropped, and sharing again works.
- **Setup lists the devices on the Chats card,** each with its push service and since when, this
  one marked; the switch sits there too.
- **`ship remove webchat`** takes the key off the edge only when this PC holds Cloudflare's token
  (`--check` and the step need it too); without it, it says nothing of the key, as before.
- **Not checked here:** the CPU time on Cloudflare, and a real phone (no box can open one). Both
  are the live check above.
- **Later (2026-10-13, review fixes):** the icon and badge moved to `/note/icon.png` and
  `/note/badge.png`, outside `admin/*`: under the chat's path, a phone whose Access session had
  ended (24 h) showed the plain bell. `ring` now says why with each outcome (`{rung, why}`: the push
  service's status, or what stopped it), and `send` logs each device's push service and status,
  and any store error, in its one line, so a 403 shows as one. A gone device is dropped from the
  list read again just before the write, so one turned on while the others rang stays.
