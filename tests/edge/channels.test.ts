// The chat channel conformance suite (ADR 0032, "Chat adapters"): every adapter in
// edge/src/channels/index.ts passes the same checks, through the contract alone
// (edge/src/channels/channel.ts), from its fixtures in tests/edge/channels/. A new channel is one
// adapter, one registry line and one fixtures file, and this suite says whether it fits.
import { describe, expect, it } from "vitest";
import { agentsSeen, type Button, CHAT_WORDS, PICKER, problem } from "../../cli/contracts/index.ts";
import type { Channel, Outgoing } from "../../edge/src/channels/channel.ts";
import { CHANNELS } from "../../edge/src/channels/index.ts";
import { PICK_BUTTONS, WELCOME_BUTTONS } from "../../edge/src/chat.ts";
import { picker } from "../../edge/src/guide.ts";
import type { Env } from "../../edge/src/env.ts";
import { FIXTURES } from "./channels/index.ts";

const reply = (over: Partial<Outgoing> = {}): Outgoing => ({
  state: "Done",
  task: 12,
  title: "make it faster",
  text: "It's **faster** now.\n\n- one\n- two",
  brief: "Sonnet · 40 s",
  links: [["On GitHub", "https://github.com/o/shipify/issues/12#issuecomment-1"]],
  ...over,
});

it("every adapter in the registry has its fixtures, and its id is its key", () => {
  for (const [id, ch] of Object.entries(CHANNELS)) {
    expect(FIXTURES[id], `tests/edge/channels/${id}.ts`).toBeDefined();
    expect(ch.id).toBe(id);
  }
});

for (const [id, ch] of Object.entries(CHANNELS) as [string, Channel][]) {
  const fx = FIXTURES[id];
  if (!fx) continue;
  const env = fx.env as Env;

  describe(`the ${id} adapter`, () => {
    it("names itself: an id for routes and lines, a name for people, its secrets, its chats", () => {
      expect(ch.id).toMatch(/^[a-z][a-z0-9-]{0,30}$/);
      expect(ch.name.trim()).not.toBe("");
      expect(ch.needs.length).toBeGreaterThan(0);
      for (const n of ch.needs) expect(env[n], `fixture sets ${n}`).toBeTruthy();
      expect(ch.chatId.test(fx.chat)).toBe(true);
      for (const bad of ["", "@channel", "1 2", "x".repeat(200)])
        expect(ch.chatId.test(bad)).toBe(false);
      expect(ch.limits.text).toBeGreaterThan(200);
    });

    if (ch.verify && ch.parse) {
      const verify = ch.verify.bind(ch);
      const parse = ch.parse.bind(ch);

      it("proves a webhook: its proof passes, a missing or wrong one doesn't", async () => {
        const body = fx.messages.text.body;
        expect(await verify(fx.proven(body), env)).toBe(true);
        for (const req of fx.unproven(body)) expect(await verify(req, env)).toBe(false);
        // With its secret unset, nothing passes.
        expect(await verify(fx.proven(body), {} as Env)).toBe(false);
      });

      it("reads words, a file, a reply to one of Shipify's messages and a forward into one Message", () => {
        expect(parse(fx.messages.text.body)).toMatchObject(fx.messages.text.want);
        expect(parse(fx.messages.text.body)?.forwarded).toBe(false);
        expect(parse(fx.messages.file.body)?.file).toMatchObject(fx.messages.file.want);
        expect(parse(fx.messages.reply.body)?.repliesTo).toBe(fx.messages.reply.task);
        expect(parse(fx.messages.forwarded.body)?.forwarded).toBe(true);
      });

      if (fx.messages.tap) {
        const tap = fx.messages.tap;
        it("reads a tap as the same words typed, replying to the message the button sat on, and acknowledges it", async () => {
          const t = parse(tap.body);
          const typed = parse(fx.messages.text.body);
          expect(t).toMatchObject({ words: tap.words, repliesTo: tap.task, forwarded: false });
          expect(t?.tap).toBeTruthy();
          expect([t?.chat, t?.user]).toEqual([typed?.chat, typed?.user]);
          expect(ch.tapped, "a channel with buttons acknowledges a tap").toBeDefined();
          if (!t || !ch.tapped) return;
          const p = fx.platform();
          expect(await ch.tapped(env, p.deps, t, { toast: "Got it · #12", spent: true })).toBe(
            true,
          );
          // Not taken: said, never thrown, and never tried again.
          p.mode("down");
          expect(await ch.tapped(env, p.deps, t, {})).toBe(false);
        });
      }

      it("gives null for what isn't a message for the door, and never throws", () => {
        for (const body of fx.messages.ignored) expect(parse(body), body).toBeNull();
        expect(parse("")).toBeNull();
      });
    }

    if (ch.parse) {
      it("answers at once as a 200, holding the words, a failure too: nothing is sent again", async () => {
        const m = ch.parse?.(fx.messages.text.body);
        expect(m).toBeTruthy();
        expect(ch.answer, "a channel that takes messages answers them").toBeDefined();
        if (!m || !ch.answer) return;
        const res = ch.answer(m, "Got it · #3");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Got it · #3");
        const down = problem("github-down");
        const failed = ch.answer(m, `${down.what} ${down.fix}`, down);
        expect(failed.status).toBe(200);
        expect(await failed.text()).toContain("Couldn't reach GitHub");
      });
    }

    const file = () => new File(["png"], "shot.png", { type: "image/png" });

    if (ch.inPlace) {
      it("is read in place: a reply's send pushes no words, and its files are kept", async () => {
        const p = fx.platform();
        expect(await ch.send(env, p.deps, fx.chat, reply())).toEqual({ ok: true });
        expect(p.texts()).toEqual([]);
        expect(await ch.sendFiles?.(env, p.deps, fx.chat, 12, [file()])).toBe(0);
        expect(p.files()).toEqual(["shot.png"]);
        p.mode("down");
        expect(await ch.sendFiles?.(env, p.deps, fx.chat, 12, [file()])).toBe(1);
      });
    } else {
      it("sends a reply's words without markup, within its limit; its files come on their own", async () => {
        const p = fx.platform();
        expect(await ch.send(env, p.deps, fx.chat, reply())).toEqual({ ok: true });
        const [text] = p.texts();
        expect(text).toContain("faster");
        expect(text).toContain("#12");
        expect(text).not.toContain("**");
        expect(p.files()).toEqual([]);
        // A long reply stays within the channel's limit.
        await ch.send(env, p.deps, fx.chat, reply({ text: "word ".repeat(5000) }));
        expect(p.texts().at(-1)?.length).toBeLessThanOrEqual(ch.limits.text);
      });

      if (ch.limits.button) {
        const most = ch.limits.button;
        it("sends word buttons whose words fit it, and leaves out one that doesn't (its words stay to type)", async () => {
          const bytes = (w: string) => new TextEncoder().encode(w).length;
          for (const w of [...CHAT_WORDS, PICKER]) expect(bytes(w), w).toBeLessThanOrEqual(most);
          // Every button the door makes: the welcome's, the Model button, every picker's.
          const pickers = agentsSeen().flatMap(([agent, e]) =>
            [undefined, ...(e.models ?? [])].flatMap((model) =>
              [undefined, ...(e.efforts ?? [])].map((effort) =>
                picker(1, { agent, model, effort }),
              ),
            ),
          );
          const door: Button[] = [
            ...[WELCOME_BUTTONS, PICK_BUTTONS, picker(undefined).buttons].flat(2),
            ...pickers.flatMap((p) => p.buttons.flat()),
          ];
          for (const b of door) expect(bytes(b.words), b.words).toBeLessThanOrEqual(most);
          const p = fx.platform();
          const long = "ü".repeat(most);
          await ch.send(env, p.deps, fx.chat, {
            ...reply(),
            buttons: [
              [
                { label: "Continue", words: "continue" },
                { label: "long", words: long },
              ],
            ],
          });
          expect(p.buttons?.()).toEqual(["continue"]);
        });
      }

      it("says what a failed send means: wait, can't be reached, refused as made, or not confirmed; it never throws", async () => {
        const p = fx.platform();
        p.mode("wait");
        const wait = await ch.send(env, p.deps, fx.chat, reply());
        expect(!wait.ok && "wait" in wait && wait.wait).toBeGreaterThan(0);
        p.mode("refused");
        const refused = await ch.send(env, p.deps, fx.chat, reply());
        expect(!refused.ok && "refused" in refused && refused.refused).toBeTruthy();
        p.mode("wrong");
        const wrong = await ch.send(env, p.deps, fx.chat, reply());
        expect(!wrong.ok && "rendering" in wrong && wrong.rendering).toBeTruthy();
        p.mode("down");
        expect(await ch.send(env, p.deps, fx.chat, reply())).toEqual({
          ok: false,
          transient: true,
        });
      });

      if (ch.sendFiles) {
        const sendFiles = ch.sendFiles.bind(ch);
        it("sends a reply's files, each once, and counts those that didn't go", async () => {
          const p = fx.platform();
          expect(await sendFiles(env, p.deps, fx.chat, 12, [file()])).toBe(0);
          expect(p.files()).toEqual(["shot.png"]);
          p.mode("wait");
          expect(await sendFiles(env, p.deps, fx.chat, 12, [file(), file()])).toBe(2);
          expect(p.files()).toEqual(["shot.png"]);
        });
      }
    }

    if (ch.file && fx.file) {
      const file = ch.file.bind(ch);
      const known = fx.file;
      it("fetches a file a person sent by its reference, and nothing it doesn't know", async () => {
        const p = fx.platform();
        const res = await file(env, p.deps, known.ref);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(known.bytes);
        expect((await file(env, p.deps, "not-a-ref-it-knows")).status).toBe(404);
        expect((await file(env, p.deps, "../../etc/passwd")).status).toBe(404);
      });
    }

    if (ch.health) {
      const health = ch.health.bind(ch);
      it("says its own health for the watch: fine, or failing with why", async () => {
        const p = fx.platform();
        expect(await health(env, p.deps)).toEqual({ failing: false });
        p.healthy(false);
        const bad = await health(env, p.deps);
        expect(bad?.failing).toBe(true);
        expect(bad?.error).toBeTruthy();
      });
    }

    if (ch.menu) {
      it("keeps its menu in step with intents.json: set where it differs, then left alone", async () => {
        const p = fx.platform();
        await ch.menu?.(env, p.deps);
        expect(p.sets?.().length).toBeGreaterThan(0);
        const after = p.sets?.().length;
        await ch.menu?.(env, p.deps);
        expect(p.sets?.().length).toBe(after);
      });
    }

    if (ch.linkSecret) {
      it("keys its link codes with one of its own secrets", () => {
        expect(ch.linkSecret?.(env)).toBeTruthy();
        expect(ch.needs.some((n) => env[n] === ch.linkSecret?.(env))).toBe(true);
      });
    }
  });
}
