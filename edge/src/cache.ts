// What the edge remembers, per Worker instance (an isolate) and never longer: an answer it read
// lately, kept a short while so a burst of messages or a tick doesn't ask GitHub the same thing
// twice. Nothing here is state: an isolate can go any time, and every value is read again then.
// Tests clear it between cases.

const memo = new Map<string, { until: number; value: unknown }>();
const last = new Map<string, unknown>();
/** Kept at most, in each: a thread's key holds its `since`, so each new message adds one. */
const MOST = 200;

/** One more kept, as the newest; past MOST, the oldest goes. */
function put<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MOST) map.delete(map.keys().next().value as string);
}

/** Remembered for `ms`: past MOST, what's past its time goes before anything fresh. */
function keep(key: string, value: unknown, ms: number, now: number) {
  if (!memo.has(key) && memo.size >= MOST)
    for (const [k, v] of memo) if (v.until <= now) memo.delete(k);
  put(memo, key, { until: now + ms, value });
}

/** What's under `key` and still fresh; one past its time is dropped as it's read. */
function fresh(key: string, now: number) {
  const hit = memo.get(key);
  if (hit && hit.until <= now) memo.delete(key);
  return hit && hit.until > now ? hit : undefined;
}

/**
 * fn's value, remembered `ms` milliseconds under `key`. A failure isn't remembered. A read still
 * going is never shared: it belongs to the request that started it, and Workers may cancel it with
 * that request.
 */
export async function cached<T>(key: string, ms: number, fn: () => Promise<T>, now = Date.now()) {
  const hit = fresh(key, now);
  if (hit) return hit.value as T;
  const value = await fn();
  keep(key, value, ms, now);
  put(last, key, value);
  return value;
}

/**
 * The last good value read under `key`, however old: only to know who's who while GitHub can't be
 * read (settings.ts: lastPeople), never to act on.
 */
export const stale = <T>(key: string): T | undefined => last.get(key) as T | undefined;

/** Kept as is, for `ms`: a value the edge made itself (a write it just did, a token). */
export function remember(key: string, value: unknown, ms: number, now = Date.now()) {
  keep(key, value, ms, now);
}

/** What's remembered under `key` and still fresh. */
export const recall = <T>(key: string, now = Date.now()): T | undefined =>
  fresh(key, now)?.value as T | undefined;

export function forget(key: string) {
  memo.delete(key);
}

/** Every key that starts with `prefix`: a thread's reads, whatever their `since` or page. */
export function forgetAll(prefix: string) {
  for (const key of memo.keys()) if (key.startsWith(prefix)) memo.delete(key);
}

export function clearCaches() {
  memo.clear();
  last.clear();
}

// ---------------------------------------------------------------- shared by the instances

/** Cloudflare's cache for this place: shared by the Worker's instances there; none in tests. */
const place = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;
const shareUrl = (key: string) =>
  new Request(`https://shipify-edge.internal/shared/${encodeURIComponent(key)}`);

/**
 * A number the edge wrote (a task it made for an update), for its other instances too, `ms` at
 * most: a repeat that lands on another instance before GitHub's listings show the write is caught.
 * Still a cache: a miss reads GitHub, as before.
 */
export async function share(key: string, value: number, ms: number): Promise<void> {
  const c = place();
  if (!c) return;
  await c
    .put(
      shareUrl(key),
      new Response(String(value), {
        headers: { "cache-control": `max-age=${Math.max(1, Math.ceil(ms / 1000))}` },
      }),
    )
    .catch(() => {});
}

/** What another instance shared under `key`, while it's fresh. */
export async function shared(key: string): Promise<number | undefined> {
  const c = place();
  if (!c) return undefined;
  const hit = await c.match(shareUrl(key)).catch(() => undefined);
  const n = hit ? Number(await hit.text()) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
