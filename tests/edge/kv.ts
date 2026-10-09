// Workers KV, in memory, for the web chat's tests: values with their metadata and expiry, listed
// by prefix as KV lists them. `down` makes every call fail, as a store over its limits does.
import type { Kv } from "../../edge/src/env.ts";

export function memoryKv(now: () => number = Date.now) {
  const items = new Map<string, { bytes: Uint8Array; metadata: unknown; until?: number }>();
  const state = { down: false, puts: 0, lists: 0 };
  const alive = (k: string) => {
    const it = items.get(k);
    if (it?.until !== undefined && it.until <= now()) items.delete(k);
    return items.get(k);
  };
  const stream = (b: Uint8Array) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(b);
        c.close();
      },
    });
  const check = () => {
    if (state.down) throw new Error("KV: over its limits");
  };
  const kv: Kv = {
    async get(key) {
      check();
      const it = alive(key);
      return it ? stream(it.bytes) : null;
    },
    async getWithMetadata<M>(key: string) {
      check();
      const it = alive(key);
      return it
        ? { value: stream(it.bytes), metadata: it.metadata as M }
        : { value: null, metadata: null };
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
      items.set(key, {
        bytes,
        metadata: options?.metadata ?? null,
        ...(options?.expirationTtl ? { until: now() + options.expirationTtl * 1000 } : {}),
      });
    },
    async list<M>(options?: { prefix?: string }) {
      check();
      state.lists++;
      const keys = [...items.keys()]
        .filter((k) => k.startsWith(options?.prefix ?? "") && alive(k))
        .sort()
        .map((name) => {
          const it = items.get(name);
          return {
            name,
            ...(it?.until ? { expiration: Math.floor(it.until / 1000) } : {}),
            metadata: it?.metadata as M,
          };
        });
      return { keys, list_complete: true };
    },
  };
  return { kv, items, state };
}
