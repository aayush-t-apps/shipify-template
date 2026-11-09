// The door's way out (edge/src/door-out.ts) and a file for a run (edge/src/files.ts): only a run of
// shipify's on main gets in; only a run's own reply goes out; it goes out once, to people's chats.
import { beforeAll, describe, expect, it } from "vitest";
import { readFindings, replyLine } from "../../cli/contracts/index.ts";
import { handle } from "../../edge/src/app.ts";
import { devicesOf, type Env, keepDevices } from "../../edge/src/env.ts";
import { GUESTS_KEY } from "../../edge/src/guests.ts";
import { type Device, deviceOf } from "../../edge/src/push.ts";
import { browser, pushKey } from "./browser.ts";
import { CHAT, DOOR, envFor, type Keys, keys, runToken, world } from "./fake.ts";
import { memoryKv } from "./kv.ts";
import { memoryR2 } from "./r2.ts";

let k: Keys;
beforeAll(async () => {
  k = await keys();
});

const line = (more: Record<string, unknown> = {}) =>
  replyLine({
    v: 1,
    kind: "answer",
    state: "Done",
    title: "make it faster",
    links: [],
    to: [`telegram:${CHAT}`, "telegram:999"],
    key: "1:5:abcd1234:think:-",
    brief: "Sonnet · 48 s",
    ...more,
  } as never);

async function call(
  f: ReturnType<typeof world>,
  body: Record<string, unknown> | FormData,
  token?: string | null,
  env = envFor(k),
) {
  const auth: Record<string, string> =
    token === null ? {} : { authorization: `Bearer ${token ?? (await runToken(k, f.w.at))}` };
  return handle(
    new Request("https://shipify.example.com/door/replied", {
      method: "POST",
      headers: body instanceof FormData ? auth : { ...auth, "content-type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
    env,
    f.deps,
  );
}

const sends = (f: ReturnType<typeof world>) => f.w.sent.filter((s) => s.method.startsWith("send"));

describe("POST /door/replied", () => {
  it("takes only a run's OIDC token for shipify's main", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    expect((await call(f, { task: task.number, comment: c.id }, null)).status).toBe(401);
    const branch = await runToken(k, f.w.at, { ref: "refs/heads/x" });
    expect((await call(f, { task: task.number, comment: c.id }, branch)).status).toBe(401);
    expect(sends(f)).toEqual([]);
  });

  it("sends a run's reply to each person's chat in `to`, then marks it 🚀 as the door App", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line(), "It's faster now.");
    const res = await call(f, { task: task.number, comment: c.id });
    expect(await res.json()).toEqual({ sent: 1, refused: 0 });
    // Only people's ids: 999 isn't anyone's.
    expect(sends(f).map((s) => [s.method, s.body.chat_id, s.body.text])).toEqual([
      ["sendMessage", CHAT, "Done · #1 · make it faster\n\nIt's faster now.\n\nSonnet · 48 s"],
    ]);
    expect(c.reactions).toEqual([{ content: "rocket", user: { login: DOOR, type: "Bot" } }]);
  });

  it("sends a reply's buttons (the same words every chat has), its task's number linked", async () => {
    const f = world(k);
    const task = f.issue();
    const failed = f.reply(
      task.number,
      line({ kind: "failed", state: "Failed" }),
      "It broke. Reply `continue`, or `start over`.",
    );
    await call(f, { task: task.number, comment: failed.id });
    const [sent] = sends(f);
    expect(sent?.body.reply_markup).toMatchObject({
      inline_keyboard: [
        // Every word a reply names is a button: none is GitHub's alone (ADR 0049).
        [
          { text: "Continue", callback_data: "continue" },
          { text: "Start over", callback_data: "start over" },
          { text: "Another model", callback_data: "/use" },
        ],
        [{ text: "On GitHub" }],
      ],
    });
    expect(sent?.body.entities).toContainEqual({
      type: "text_link",
      offset: "Failed · ".length,
      length: 2,
      url: `https://github.com/o/shipify/issues/${task.number}`,
    });
    // A question with no quick answers opens the reply box on it.
    const asked = f.reply(task.number, line({ kind: "needs-you", question: "Which colours?" }));
    await call(f, { task: task.number, comment: asked.id });
    expect(sends(f).at(-1)?.body.reply_markup).toEqual({
      force_reply: true,
      input_field_placeholder: `Reply to #${task.number}…`,
    });
  });

  it("sends once: a reply the door App marked already is skipped", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    await call(f, { task: task.number, comment: c.id });
    const again = await call(f, { task: task.number, comment: c.id });
    expect(await again.json()).toEqual({ sent: 0, already: true });
    expect(sends(f)).toHaveLength(1);
  });

  it("trusts only the door App's own 🚀, not someone else's", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    c.reactions.push({ content: "rocket", user: { login: "owner", type: "User" } });
    c.reactions.push({ content: "rocket", user: { login: "other-app[bot]", type: "Bot" } });
    expect(await (await call(f, { task: task.number, comment: c.id })).json()).toMatchObject({
      sent: 1,
    });
    // The door's own name is SHIPIFY_DOOR_SLUG's: GitHub isn't asked for it.
    expect(f.gh()).not.toContain("GET app");
  });

  it("refuses what isn't a run's reply on that task: another author, another task, no line, edited", async () => {
    const f = world(k);
    const task = f.issue();
    const other = f.issue();
    const byYou = f.comment(task.number, `${line()}\nforged`, { login: "owner" });
    const lookalike = f.comment(task.number, `${line()}\nforged`, {
      login: "github-actions[bot]",
      id: 5,
    });
    const plain = f.reply(task.number, "", "no line");
    const edited = f.reply(task.number, line());
    edited.editor = "someone";
    edited.updated_at = new Date(f.w.at + 1000).toISOString();
    const elsewhere = f.reply(other.number, line());
    for (const id of [byYou.id, lookalike.id, plain.id, edited.id, elsewhere.id])
      expect((await call(f, { task: task.number, comment: id })).status, String(id)).toBe(409);
    expect((await call(f, { task: task.number, comment: 123456 })).status).toBe(404);
    expect(sends(f)).toEqual([]);
  });

  it("takes a reply a run edited itself", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    c.editor = "github-actions";
    c.updated_at = new Date(f.w.at + 1000).toISOString();
    expect((await call(f, { task: task.number, comment: c.id })).status).toBe(200);
  });

  const withFiles = (task: number, comment: number) => {
    const form = new FormData();
    form.set("task", String(task));
    form.set("comment", String(comment));
    form.append("file", new File(["png"], "phone.png", { type: "image/png" }));
    form.append("file", new File(["md"], "report.md", { type: "text/markdown" }));
    return form;
  };

  it("uploads the files a run made after the words are marked: images as photos, the rest as documents", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    expect((await call(f, withFiles(task.number, c.id))).status).toBe(200);
    expect(sends(f).map((s) => [s.method, s.body.caption])).toEqual([
      ["sendMessage", undefined],
      ["sendPhoto", "· #1 · phone.png"],
      ["sendDocument", "· #1 · report.md"],
    ]);
    // The 🚀 goes on as the words land, before any upload: a slow file can't make them look unsent.
    const at = (what: string) => f.w.calls.findIndex((x) => x.includes(what));
    const marked = at(`POST api.github.com/repos/o/shipify/issues/comments/${c.id}/reactions`);
    expect(marked).toBeGreaterThan(at("sendMessage"));
    expect(marked).toBeLessThan(at("sendPhoto"));
    const tooMany = new FormData();
    tooMany.set("task", "1");
    tooMany.set("comment", String(c.id));
    for (let i = 0; i < 11; i++) tooMany.append("file", new File(["x"], `${i}.txt`));
    expect((await call(f, tooMany)).status).toBe(413);
  });

  it("takes up to 50 MB of files in all; the web chat's store keeps a copy with its chat", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([
      { name: "owner", on: { github: "owner", web: "me" } },
    ]);
    const r2 = memoryR2();
    const env = envFor(k, { BUCKET: r2.bucket } as unknown as Partial<Env>);
    const task = f.issue();
    const c = f.reply(task.number, line({ to: ["web:me"] }));
    const big = new FormData();
    big.set("task", String(task.number));
    big.set("comment", String(c.id));
    big.append("file", new File([new Uint8Array(30 * 1024 * 1024)], "a.bin"));
    big.append("file", new File([new Uint8Array(21 * 1024 * 1024)], "b.bin"));
    expect((await call(f, big, undefined, env)).status).toBe(413);
    expect(await (await call(f, withFiles(task.number, c.id), undefined, env)).json()).toEqual({
      sent: 0,
      refused: 0,
    });
    const kept = [...r2.items].filter(([key]) => key.startsWith("f-")).map(([, v]) => v.meta);
    expect(kept.map((m) => [m.name, m.by, m.task])).toEqual([
      ["phone.png", "run", String(task.number)],
      ["report.md", "run", String(task.number)],
    ]);
  });

  // The refs the box picked, as a reply's line names them (ADR 0071).
  const PNG = `f-${"8".repeat(13)}-${"a".repeat(32)}`;
  const MD = `f-${"8".repeat(13)}-${"b".repeat(32)}`;
  const GUEST = "guest-ana-3f9a2c";
  const GUEST_MD = `g3f9a2c-${"8".repeat(13)}-${"c".repeat(32)}`;
  const named = (refs: [string, string][]) =>
    refs.map(([name, ref]) => ({
      name,
      ref,
      backup: `https://github.com/o/shipify/blob/x/${name}`,
    }));

  it("keeps every run file in R2 under the ref its reply's line names, whatever chat is in `to` (ADR 0071)", async () => {
    const f = world(k);
    const r2 = memoryR2();
    const env = envFor(k, { BUCKET: r2.bucket } as unknown as Partial<Env>);
    const task = f.issue();
    // Telegram's reply: Telegram gets its files as before, and the store keeps each under its ref.
    const files = named([
      ["phone.png", PNG],
      ["report.md", MD],
    ]);
    const c = f.reply(task.number, line({ files }));
    expect((await call(f, withFiles(task.number, c.id), undefined, env)).status).toBe(200);
    expect(sends(f).map((s) => s.method)).toEqual(["sendMessage", "sendPhoto", "sendDocument"]);
    expect([...r2.items].map(([key, v]) => [key, v.meta.name, v.meta.by, v.meta.task])).toEqual([
      [PNG, "phone.png", "run", String(task.number)],
      [MD, "report.md", "run", String(task.number)],
    ]);
    // A reply for no chat at all (on GitHub): kept all the same, so the window shows it.
    const quiet = f.reply(task.number, line({ to: [], files: named([["report.md", MD]]) }));
    r2.items.clear();
    const form = withFiles(task.number, quiet.id);
    expect(await (await call(f, form, undefined, env)).json()).toMatchObject({ none: true });
    expect([...r2.items.keys()]).toContain(MD);
  });

  it("reaches a guest's web chat, and says when the store didn't keep a guest's file", async () => {
    const f = world(k);
    const r2 = memoryR2();
    const env = envFor(k, { BUCKET: r2.bucket } as unknown as Partial<Env>);
    const task = f.issue();
    const files = [{ name: "report.md", ref: GUEST_MD }];
    const c = f.reply(task.number, line({ to: [`web:${GUEST}`], files }));
    const form = new FormData();
    form.set("task", String(task.number));
    form.set("comment", String(c.id));
    form.append("file", new File(["md"], "report.md", { type: "text/markdown" }));
    // The guest's chat is reached (read in place: 🚀), and their file kept under their prefix.
    expect(await (await call(f, form, undefined, env)).json()).toEqual({ sent: 0, refused: 0 });
    expect(c.reactions.map((r) => r.content)).toEqual(["rocket"]);
    expect([...r2.items.keys()]).toEqual([GUEST_MD]);
    // The store refuses: a guest's file has no backup, so the door says it wasn't kept.
    r2.items.clear();
    r2.state.down = true;
    const again = f.reply(task.number, line({ to: [`web:${GUEST}`], files }));
    form.set("comment", String(again.id));
    expect(await (await call(f, form, undefined, env)).json()).toMatchObject({ unkept: 1 });
    expect(f.w.logs.some((l) => l.includes('"files not kept"'))).toBe(true);
    // Yours have their backup: nothing to say.
    const mine = f.reply(task.number, line({ to: [], files: named([["report.md", MD]]) }));
    form.set("comment", String(mine.id));
    expect(await (await call(f, form, undefined, env)).json()).toEqual({ sent: 0, none: true });
  });

  it("says in one short message which files didn't send, and never sends one a second way", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    f.w.telegramFails.sendPhoto = { status: 500, body: { ok: false } };
    expect((await call(f, withFiles(task.number, c.id))).status).toBe(200);
    expect(sends(f).map((s) => s.method)).toEqual([
      "sendMessage",
      "sendPhoto",
      "sendDocument",
      "sendMessage",
    ]);
    expect(sends(f).at(-1)?.body.text).toBe(
      "Alert · #1\n\n1 file of the reply didn't send here. It's on the reply on GitHub.",
    );
    expect(c.reactions.map((r) => r.content)).toEqual(["rocket"]);
    // Telegram busy: the rest aren't tried, and are counted.
    const g = world(k);
    const t2 = g.issue();
    const c2 = g.reply(t2.number, line());
    g.w.telegramFails.sendPhoto = { status: 429, body: { ok: false } };
    await call(g, withFiles(t2.number, c2.id));
    expect(sends(g).map((s) => s.method)).toEqual(["sendMessage", "sendPhoto", "sendMessage"]);
    expect(sends(g).at(-1)?.body.text).toContain("2 files of the reply didn't send here.");
  });

  it("leaves it unmarked when Telegram says wait (429): the watch's notice covers it", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    f.w.telegramFails.sendMessage = {
      status: 429,
      body: { ok: false, description: "Too Many Requests", parameters: { retry_after: 7 } },
    };
    const res = await call(f, { task: task.number, comment: c.id });
    expect(res.status).toBe(502);
    expect(c.reactions).toEqual([]);
    expect(sends(f)).toHaveLength(1);
  });

  it("🚀 means every chat it was for: the web chat, read in place, doesn't count for Telegram", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([
      { name: "owner", on: { github: "owner", telegram: String(CHAT), web: "me" } },
    ]);
    const task = f.issue();
    const both = f.reply(task.number, line({ to: [`telegram:${CHAT}`, "web:me"] }));
    f.w.telegramFails.sendMessage = { status: 502, body: { ok: false } };
    expect((await call(f, { task: task.number, comment: both.id })).status).toBe(502);
    expect(both.reactions).toEqual([]);
    // For the web chat alone, it's there already: 🚀.
    const web = f.reply(task.number, line({ to: ["web:me"] }));
    expect(await (await call(f, { task: task.number, comment: web.id })).json()).toEqual({
      sent: 0,
      refused: 0,
    });
    expect(web.reactions.map((r) => r.content)).toEqual(["rocket"]);
  });

  it("tells the web chat's devices a reply came, beside Telegram's words: its notification never counts", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([
      { name: "owner", on: { github: "owner", telegram: String(CHAT), web: "me" } },
    ]);
    const store = memoryKv(() => f.w.at);
    const b = await browser();
    await keepDevices(store.kv, "web", "me", [
      { ...(deviceOf(b.subscription) as Device), at: f.w.at },
    ]);
    const env = envFor(k, { FILES: store.kv, WEB_PUSH_KEY: pushKey() } as unknown as Partial<Env>);
    const device = "https://fcm.googleapis.com/fcm/send/abc123";
    const pushes = () => f.w.calls.filter((c) => c === `POST ${device.slice(8)}`).length;
    f.w.apps[device] = { status: 201 };
    const task = f.issue();
    const to = [`telegram:${CHAT}`, "web:me"];
    const both = f.reply(task.number, line({ to }));
    const said = async (comment: number, e = env) =>
      (await call(f, { task: task.number, comment }, undefined, e)).json();
    expect(await said(both.id)).toEqual({ sent: 1, refused: 0 });
    expect(sends(f)).toHaveLength(1);
    expect(pushes()).toBe(1);
    expect(both.reactions.map((r) => r.content)).toEqual(["rocket"]);
    // Its push service down: 🚀 all the same, and `sent` counts Telegram's.
    f.w.apps[device] = { status: 500 };
    const next = f.reply(task.number, line({ to }));
    expect(await said(next.id)).toEqual({ sent: 1, refused: 0 });
    expect(pushes()).toBe(2);
    expect(next.reactions.map((r) => r.content)).toEqual(["rocket"]);
    // Once: a reply marked already tells no one.
    expect(await said(both.id)).toEqual({ sent: 0, already: true });
    expect(pushes()).toBe(2);
    // With no key, nothing is fetched.
    const alone = f.reply(task.number, line({ to: ["web:me"] }));
    expect(await said(alone.id, envFor(k, { FILES: store.kv } as unknown as Partial<Env>))).toEqual(
      { sent: 0, refused: 0 },
    );
    expect(pushes()).toBe(2);
    expect(alone.reactions.map((r) => r.content)).toEqual(["rocket"]);
    // Each send's one log line says how each push service answered, and what the store said.
    const logged = () => f.w.logs.filter((l) => l.includes('"door.out.failed"')).at(-1) ?? "";
    expect(logged()).toContain('"statuses":["Google 500"]');
    store.state.down = true;
    await said(f.reply(task.number, line({ to })).id);
    store.state.down = false;
    expect(logged()).toContain("the store didn't read");
    expect(logged()).toContain("KV: over its limits");
    // A device turned on while a gone one rings stays: only what came back gone is dropped.
    const other = await browser("https://updates.push.services.mozilla.com/wpush/v2/new");
    const plain = f.deps.fetch;
    f.deps.fetch = async (input, init) => {
      if (input === device)
        await keepDevices(store.kv, "web", "me", [
          ...(await devicesOf(store.kv, "web", "me")),
          { ...(deviceOf(other.subscription) as Device), at: f.w.at },
        ]);
      return plain(input, init);
    };
    f.w.apps[device] = { status: 410 };
    await said(f.reply(task.number, line({ to })).id);
    f.deps.fetch = plain;
    expect((await devicesOf(store.kv, "web", "me")).map((d) => d.endpoint)).toEqual([
      other.subscription.endpoint,
    ]);
  });

  it("tells the chat at once when Telegram refuses what Shipify made (a 400): our bug, in its words", async () => {
    const f = world(k);
    const status = f.issue({ labels: ["shipify-status"] });
    const task = f.issue();
    const c = f.reply(task.number, line());
    f.w.telegramFails.sendMessage = {
      status: 400,
      body: { ok: false, description: "Bad Request: can't parse entities" },
      times: 1,
    };
    expect(await (await call(f, { task: task.number, comment: c.id })).json()).toEqual({
      sent: 0,
      refused: 1,
    });
    const told = String(sends(f).at(-1)?.body.text);
    expect(told).toContain("Bad Request: can't parse entities");
    expect(told).toContain("Shipify's bug");
    expect(told).not.toContain("Unblock");
    // Told, and never noticed again; nothing on the status task while the chat could be told.
    expect(c.reactions.map((r) => r.content)).toEqual(["confused"]);
    expect(f.w.comments.filter((x) => x.issue === status.number)).toEqual([]);
  });

  it("gives up on a chat that blocked the bot: 😕, one alert on the status task, never retried", async () => {
    const f = world(k);
    const status = f.issue({ labels: ["shipify-status"] });
    const task = f.issue();
    const c = f.reply(task.number, line());
    f.w.telegramFails.sendMessage = {
      status: 403,
      body: { ok: false, description: "Forbidden: bot was blocked by the user" },
    };
    const res = await call(f, { task: task.number, comment: c.id });
    expect(await res.json()).toEqual({ sent: 0, refused: 1 });
    expect(c.reactions.map((r) => r.content)).toEqual(["confused"]);
    const note = f.w.comments.find((x) => x.issue === status.number);
    expect(readFindings(note?.body)?.notes[0]?.problem.code).toBe("chat-refused");
    expect(note?.body).toContain("bot was blocked");
    expect(status.labels).toContain("watch:alert");
  });

  it("reads the comment and its mark at once, not one after the other", async () => {
    const f = world(k);
    const task = f.issue();
    const c = f.reply(task.number, line());
    const real = f.deps.fetch;
    let flying = 0;
    let most = 0;
    const gets: string[] = [];
    f.deps.fetch = async (input, init) => {
      if (input.includes(`/issues/comments/${c.id}`) && (init?.method ?? "GET") === "GET")
        gets.push(input.includes("/reactions") ? "mark" : "comment");
      flying++;
      most = Math.max(most, flying);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await real(input, init);
      } finally {
        flying--;
      }
    };
    expect(await (await call(f, { task: task.number, comment: c.id })).json()).toMatchObject({
      sent: 1,
    });
    expect(gets.sort()).toEqual(["comment", "mark"]);
    expect(most).toBeGreaterThan(1);
  });

  it("is shut while the door is closed", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_DOOR = "closed";
    const task = f.issue();
    const c = f.reply(task.number, line());
    expect((await call(f, { task: task.number, comment: c.id })).status).toBe(503);
  });
});

describe("GET /door/file/<ref>", () => {
  const get = async (f: ReturnType<typeof world>, ref: string, token?: string | null) =>
    handle(
      new Request(`https://shipify.example.com/door/file/${encodeURIComponent(ref)}`, {
        headers:
          token === null ? {} : { authorization: `Bearer ${token ?? (await runToken(k, f.w.at))}` },
      }),
      envFor(k),
      f.deps,
    );

  it("hands a run the file's bytes, with its OIDC token, by the reference the door wrote", async () => {
    const f = world(k);
    const res = await get(f, "telegram:AgACAgQ");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
    expect(f.w.sent.find((s) => s.method === "getFile")?.body).toEqual({ file_id: "AgACAgQ" });
  });

  it("refuses without a token, or with another workflow's, before asking Telegram", async () => {
    const f = world(k);
    expect((await get(f, "telegram:AgAC", null)).status).toBe(401);
    const ci = await runToken(k, f.w.at, {
      workflow_ref: "o/shipify/.github/workflows/ci.yml@refs/heads/main",
    });
    expect((await get(f, "telegram:AgAC", ci)).status).toBe(401);
    expect(f.w.sent).toEqual([]);
    expect((await get(f, "telegram:not a ref!")).status).toBe(404);
  });

  it("refuses a file over 100 MB", async () => {
    const f = world(k);
    f.w.telegramFails.getFile = {
      body: { ok: true, result: { file_path: "documents/big.pdf", file_size: 101 * 1024 * 1024 } },
    };
    expect((await get(f, "telegram:BQAC")).status).toBe(413);
  });
});

// ADR 0073: the box's job asks for a guest's email and name, to make their drop theirs.
describe("GET /door/guest/<id>", () => {
  const ANA = { id: "guest-ana-3f9a2c", email: "ana@example.com", name: "Ana", added: 1 };
  const get = async (f: ReturnType<typeof world>, id: string, token?: string | null) => {
    const r2 = memoryR2();
    await r2.bucket.put(GUESTS_KEY, JSON.stringify({ v: 1, guests: [ANA] }));
    return handle(
      new Request(`https://shipify.example.com/door/guest/${id}`, {
        headers:
          token === null ? {} : { authorization: `Bearer ${token ?? (await runToken(k, f.w.at))}` },
      }),
      envFor(k, { BUCKET: r2.bucket } as unknown as Partial<Env>),
      f.deps,
    );
  };

  it("gives task.yml's run a guest's email and name, and 404 for one not on the list", async () => {
    const f = world(k);
    const res = await get(f, ANA.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "ana@example.com", name: "Ana" });
    expect((await get(f, "guest-ben-0a0b0c")).status).toBe(404);
    expect((await get(f, "not-a-guest")).status).toBe(404);
  });

  it("refuses without a token, or with any workflow's but task.yml's", async () => {
    const f = world(k);
    expect((await get(f, ANA.id, null)).status).toBe(401);
    for (const file of ["watch.yml", "ci.yml"]) {
      const other = await runToken(k, f.w.at, {
        workflow_ref: `o/shipify/.github/workflows/${file}@refs/heads/main`,
      });
      expect((await get(f, ANA.id, other)).status, file).toBe(401);
    }
  });
});

describe("POST /door/files/forget", () => {
  const watch = (f: ReturnType<typeof world>) =>
    runToken(k, f.w.at, { workflow_ref: "o/shipify/.github/workflows/watch.yml@refs/heads/main" });
  const forget = async (f: ReturnType<typeof world>, body: unknown, token: string, more = {}) =>
    handle(
      new Request("https://shipify.example.com/door/files/forget", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      envFor(k, more),
      f.deps,
    );
  const kept = () => {
    const r2 = memoryR2();
    void r2.keep("f-8000000000003-0123456789abcdef0123", "aaa", { name: "a", by: "you", task: 4 });
    void r2.keep("f-8000000000002-0123456789abcdef0123", "bbbb", { name: "b", by: "run", task: 4 });
    void r2.keep("f-8000000000001-0123456789abcdef0123", "c", { name: "c", by: "you", task: 5 });
    void r2.keep("up-0123456789abcdef0123", "dd", { name: "d", by: "you" });
    return r2;
  };

  it("deletes only the files of the chats it names, with watch.yml's token alone", async () => {
    const f = world(k);
    const r2 = kept();
    const env = { BUCKET: r2.bucket } as unknown as Partial<Env>;
    const res = await forget(f, { chats: [4, 9] }, await watch(f), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2, bytes: 7, unclaimed: 0, unclaimedBytes: 0 });
    // Chat 5's stays, and a file with no chat and no time.
    expect([...r2.items.keys()].sort()).toEqual([
      "f-8000000000001-0123456789abcdef0123",
      "up-0123456789abcdef0123",
    ]);
    // A second pass over the same chats deletes nothing more.
    expect(await (await forget(f, { chats: [4] }, await watch(f), env)).json()).toEqual({
      deleted: 0,
      bytes: 0,
      unclaimed: 0,
      unclaimedBytes: 0,
    });
  });

  it("deletes the files no chat used, made 60 days ago or more, a guest's too, in the same one listing", async () => {
    const f = world(k);
    const r2 = memoryR2();
    const days = (n: number) => f.w.at - n * 24 * 3600_000;
    const id = "0123456789abcdef0123";
    void r2.keep(`f-8000000000004-${id}`, "aaa", { name: "a", by: "you", at: days(61) });
    void r2.keep(`g3f9a2c-8000000000003-${id}`, "bb", { name: "b", by: "you", at: days(90) });
    void r2.keep(`f-8000000000002-${id}`, "c", { name: "c", by: "you", at: days(59) });
    void r2.keep(`f-8000000000001-${id}`, "d", { name: "d", by: "run", at: days(90), task: 5 });
    void r2.keep(`up-${id}`, "e", { name: "e", by: "you" });
    const env = { BUCKET: r2.bucket } as unknown as Partial<Env>;
    // A week with no closed chats asks too.
    const res = await forget(f, { chats: [] }, await watch(f), env);
    expect(await res.json()).toEqual({ deleted: 0, bytes: 0, unclaimed: 2, unclaimedBytes: 5 });
    // A newer one stays, an open chat's, and one with no time of its own.
    expect([...r2.items.keys()].sort()).toEqual([
      `f-8000000000001-${id}`,
      `f-8000000000002-${id}`,
      `up-${id}`,
    ]);
    expect(r2.state.lists).toBe(1);
  });

  it("refuses a task.yml token (any agent's run), and anything that isn't a list of chats", async () => {
    const f = world(k);
    const r2 = kept();
    const env = { BUCKET: r2.bucket } as unknown as Partial<Env>;
    const task = await runToken(k, f.w.at);
    expect((await forget(f, { chats: [4] }, task, env)).status).toBe(403);
    const branch = await runToken(k, f.w.at, {
      workflow_ref: "o/shipify/.github/workflows/watch.yml@refs/heads/x",
      ref: "refs/heads/x",
    });
    expect((await forget(f, { chats: [4] }, branch, env)).status).toBe(401);
    for (const body of [{}, { chats: [0] }, { chats: ["4"] }, { chats: Array(501).fill(1) }])
      expect((await forget(f, body, await watch(f), env)).status, JSON.stringify(body)).toBe(400);
    expect(r2.items.size).toBe(4);
  });
});

describe("GET /health, and nothing else", () => {
  it("says the version and the commit, and 404s anything else", async () => {
    const f = world(k);
    const res = await handle(new Request("https://shipify.example.com/health"), envFor(k), f.deps);
    expect(await res.json()).toMatchObject({
      status: "ok",
      app: "shipify-edge",
      commit: "abc123",
      // The door App's install, as GitHub says it, for `ship door check`: nothing secret.
      door: { selection: "selected", repos: ["shipify"], permissions: { issues: "write" } },
    });
    const keyless = await handle(
      new Request("https://shipify.example.com/health"),
      envFor(k, { SHIPIFY_DOOR_APP_KEY: "" }),
      f.deps,
    );
    expect(((await keyless.json()) as { door: unknown }).door).toBeNull();
    // `/` opens the status page (tests/edge/page.test.ts).
    for (const [method, path] of [
      ["GET", "/door/telegram"],
      ["POST", "/door/hook/x"],
      ["GET", "/api/x"],
      ["GET", "/.well-known/shipify.json"],
    ])
      expect(
        (
          await handle(
            new Request(`https://shipify.example.com${path}`, { method }),
            envFor(k),
            f.deps,
          )
        ).status,
      ).toBe(404);
  });
});
