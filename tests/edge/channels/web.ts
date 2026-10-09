// The web chat's fixtures for the channel conformance suite (ADR 0036): messages as the chat's own
// routes hand them to the door, proven with the door App's key, and its "platform", the file
// store (Workers KV), since its replies are read in place on the task.
import type { Deps } from "../../../edge/src/env.ts";
import { memoryKv } from "../kv.ts";
import type { ChannelFixture, Mode } from "./fixture.ts";

const KEY = "door-app-key";
const store = memoryKv();
const UP = "up-0123456789abcdef0123";

/** The proof the chat's routes make (edge/src/web/routes.ts), made here by hand. */
async function proof(secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("shipify web chat v1"),
  );
  return Buffer.from(mac).toString("hex");
}
const PROOF = await proof(KEY);

const call = (body: string, p?: string) =>
  new Request("https://shipify.example.com/door/web", {
    method: "POST",
    headers: p === undefined ? {} : { "x-shipify-web-proof": p },
    body,
  });
const msg = (m: Record<string, unknown>) =>
  JSON.stringify({ id: "abc12345", chat: "me", user: "me", words: "", forwarded: false, ...m });

export const web: ChannelFixture = {
  env: { SHIPIFY_DOOR_APP_KEY: KEY, FILES: store.kv as unknown as string },
  proven: (body) => call(body, PROOF),
  unproven: (body) => [call(body), call(body, "0".repeat(64))],
  messages: {
    text: {
      body: msg({ words: "hello there" }),
      want: { id: "abc12345", chat: "me", user: "me", words: "hello there" },
    },
    file: {
      body: msg({ words: "this", file: { ref: UP, name: "shot.png", type: "image/png", size: 3 } }),
      want: { ref: UP, kind: "a photo" },
    },
    reply: { body: msg({ words: "more", repliesTo: 12 }), task: 12 },
    forwarded: { body: msg({ words: "theirs", forwarded: true }) },
    ignored: [
      "not json",
      "[]",
      msg({ chat: "Not A Chat" }),
      msg({ words: 5 }),
      msg({ file: { ref: "../../etc/passwd", name: "x" } }),
    ],
  },
  chat: "me",
  file: { ref: UP, bytes: "png" },
  platform() {
    store.items.clear();
    store.state.down = false;
    void store.kv.put(UP, new TextEncoder().encode("png").buffer as ArrayBuffer, {
      metadata: { name: "shot.png", type: "image/png", size: 3, by: "you", at: 0 },
    });
    const deps: Deps = {
      now: () => Date.parse("2026-10-05T12:00:00Z"),
      sleep: async () => {},
      write: () => {},
      fetch: async () => new Response(null, { status: 599 }),
    };
    return {
      deps,
      mode(m: Mode) {
        store.state.down = m === "down";
      },
      texts: () => [],
      files: () =>
        [...store.items.entries()]
          .filter(([k]) => k.startsWith("run-"))
          .map(([, v]) => (v.metadata as { name: string }).name),
      healthy() {},
    };
  },
};
