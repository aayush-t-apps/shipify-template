// R2, in memory, for the web chat's tests: objects with their metadata, listed by key as R2 lists
// them (`limit` a call, with a cursor), each list's metadata only when asked. `down` makes every call
// fail, as a store that refuses does.
import type { Bucket, R2Item } from "../../edge/src/env.ts";

export function memoryR2() {
  const items = new Map<string, { bytes: Uint8Array; meta: Record<string, string> }>();
  const state = { down: false, puts: 0, lists: 0, deletes: 0 };
  const check = () => {
    if (state.down) throw new Error("R2: refused");
  };
  const item = (key: string, include = true): R2Item | null => {
    const it = items.get(key);
    if (!it) return null;
    return {
      key,
      size: it.bytes.byteLength,
      ...(include ? { customMetadata: { ...it.meta } } : {}),
    };
  };
  const bucket: Bucket = {
    async head(key) {
      check();
      return item(key);
    },
    async get(key) {
      check();
      const it = items.get(key);
      const head = item(key);
      if (!it || !head) return null;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(it.bytes);
          c.close();
        },
      });
      return { ...head, body };
    },
    async put(key, value, options) {
      check();
      state.puts++;
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(await new Response(value).arrayBuffer());
      items.set(key, { bytes, meta: { ...(options?.customMetadata ?? {}) } });
      return item(key);
    },
    async list(options) {
      check();
      state.lists++;
      const limit = Math.min(options?.limit ?? 1000, 1000);
      const keys = [...items.keys()].filter((k) => k.startsWith(options?.prefix ?? "")).sort();
      const from = Number(options?.cursor ?? 0);
      const page = keys.slice(from, from + limit);
      const more = from + limit < keys.length;
      const meta = options?.include?.includes("customMetadata") ?? false;
      return {
        objects: page.map((k) => item(k, meta) as R2Item),
        truncated: more,
        ...(more ? { cursor: String(from + limit) } : {}),
      };
    },
    async delete(keys) {
      check();
      const l = Array.isArray(keys) ? keys : [keys];
      if (l.length > 1000) throw new Error("R2: 1,000 keys a delete at most");
      state.deletes++;
      for (const k of l) items.delete(k);
    },
  };
  /** A file as the edge keeps one, put straight in (a run's, or one from before). */
  const keep = (key: string, text: string, meta: Record<string, unknown>) =>
    bucket.put(key, text, {
      customMetadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
    });
  return { bucket, items, state, keep };
}
