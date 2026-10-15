// <Name>'s fixtures for the channel conformance suite. Copy to tests/edge/channels/<id>.ts, list it
// in tests/edge/channels/index.ts, and fill in webhooks as the platform really sends them.
import type { ChannelFixture } from "./fixture.ts";

export const example: ChannelFixture = {
  env: { EXAMPLE_TOKEN: "token", EXAMPLE_SECRET: "secret" },
  proven: (body) =>
    new Request("https://shipify.example.com/door/example", {
      method: "POST",
      headers: { "x-example-signature": "secret" },
      body,
    }),
  unproven: (body) => [
    new Request("https://shipify.example.com/door/example", { method: "POST", body }),
  ],
  messages: {
    text: {
      body: JSON.stringify({ id: "e1", user: "u1", text: "hello" }),
      want: { id: "e1", chat: "u1", user: "u1", words: "hello" },
    },
    file: { body: "{}", want: { ref: "", kind: "a file" } },
    reply: { body: "{}", task: 12 },
    forwarded: { body: "{}" },
    // With buttons: a tap as the platform sends it, its words, and the task its message named.
    // tap: { body: "{}", words: "continue", task: 12 },
    ignored: ["not json"],
  },
  chat: "u1",
  platform() {
    throw new Error("a stand-in for the platform's API: see tests/edge/channels/telegram.ts");
  },
};
