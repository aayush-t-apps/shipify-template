// <Name>, a chat channel (ADR 0032): the adapter. Copy to edge/src/channels/<id>.ts, then list it
// in edge/src/channels/index.ts. It knows its platform; the door knows Shipify.
// Buttons are words (ADR 0042): if the platform has buttons, show `out.buttons` (and an answer's
// `shown.buttons`) as buttons that send their words; read a tap as a Message with those words,
// replying to the message it sat on (readHead finds its task), with `tap` set; acknowledge it in
// `tapped`; and say the most bytes a button's words take in `limits.button`. Without buttons, its
// words are in the text already, to type. `shown.asks` opens a reply box, where there is one.
import { cut } from "../../../cli/contracts/index.ts";
import type { Env } from "../env.ts";
import { json, obj, same } from "../env.ts";
import type { Channel, Message, Sent } from "./channel.ts";

/** The platform's webhook body, as much of it as this reads. */
function parse(body: string): Message | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const e = obj(raw);
  // Only a person's own message to you; anything else (a group, an edit, a reaction) is null.
  if (!e || typeof e.id !== "string" || typeof e.user !== "string") return null;
  return {
    id: e.id,
    chat: e.user,
    user: e.user,
    words: typeof e.text === "string" ? cut(e.text, 16_000) : "",
    forwarded: false,
  };
}

export const example: Channel = {
  id: "example",
  name: "Example",
  needs: ["EXAMPLE_TOKEN", "EXAMPLE_SECRET"],
  chatId: /^[A-Za-z0-9_-]{1,64}$/,
  limits: { text: 4000 },
  verify: (req: Request, env: Env) =>
    same(req.headers.get("x-example-signature") ?? "", env.EXAMPLE_SECRET ?? ""),
  parse,
  answer: (_m, text) => json({ text }),
  async send(env, deps, chat, out): Promise<Sent> {
    try {
      const res = await deps.fetch("https://api.example.com/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.EXAMPLE_TOKEN ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: chat,
          text: `${out.state} · #${out.task ?? ""}\n\n${out.text}`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return { ok: true };
      if (res.status === 429)
        return { ok: false, wait: Number(res.headers.get("retry-after")) || 30 };
      if (res.status === 403 || res.status === 404)
        return { ok: false, refused: `HTTP ${res.status}` };
      return { ok: false, transient: true };
    } catch {
      return { ok: false, transient: true };
    }
  },
};
