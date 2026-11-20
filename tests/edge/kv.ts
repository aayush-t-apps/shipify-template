// Workers KV, in memory, for the edge's tests (model picks and devices): one value a key, read whole.
// `down` makes every call fail, as a store over its limits does.
import type { Kv } from "../../edge/src/env.ts";

export function memoryKv() {
  const items = new Map<string, { bytes: Uint8Array }>();
  const state = { down: false, puts: 0 };
  const check = () => {
    if (state.down) throw new Error("KV: over its limits");
  };
  const kv: Kv = {
    async get(key) {
      check();
      const it = items.get(key);
      return it
        ? new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(it.bytes);
              c.close();
            },
          })
        : null;
    },
    async put(key, value) {
      check();
      state.puts++;
      items.set(key, { bytes: new TextEncoder().encode(value) });
    },
  };
  return { kv, items, state };
}
