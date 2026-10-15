// The door's way in (edge/src/door-in.ts): POST /door/telegram against a fake GitHub. Your words
// become a task or a comment, written once by the door App; what needs no run is answered at once,
// writing nothing; #n that can't take them is refused at once.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PIN_MARK, readFrom } from "../../cli/contracts/index.ts";
import { handle } from "../../edge/src/app.ts";
import { clearCaches } from "../../edge/src/cache.ts";
import type { Channel, Message } from "../../edge/src/channels/channel.ts";
import { doorIn } from "../../edge/src/door-in.ts";
import { APP_ID, CHAT, DOOR, envFor, type Keys, keys, world } from "./fake.ts";

let k: Keys;
beforeAll(async () => {
  k = await keys();
});

let nextUpdate = 900_000;
const update = (message: Record<string, unknown>, id = nextUpdate++) => ({
  update_id: id,
  message: {
    message_id: 3,
    chat: { id: CHAT, type: "private" },
    from: { id: CHAT },
    ...message,
  },
});

/** Telegram's call to the door, as it makes it. */
const post = (
  f: ReturnType<typeof world>,
  body: unknown,
  opts: { secret?: string; env?: Record<string, string> } = {},
) =>
  handle(
    new Request("https://shipify.example.com/door/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": opts.secret ?? "tg-secret" },
      body: JSON.stringify(body),
    }),
    envFor(k, opts.env),
    f.deps,
  );

const said = async (res: Response) => ((await res.json()) as { text?: string }).text;

describe("the proof comes first", () => {
  it("refuses a missing or wrong secret with 401, before anything is read", async () => {
    const f = world(k);
    expect((await post(f, update({ text: "hi" }), { secret: "nope" })).status).toBe(401);
    expect(f.w.calls).toEqual([]);
  });

  it("answers 503 without its keys, naming none of their values", async () => {
    const f = world(k);
    const res = await post(f, update({ text: "hi" }), { env: { TELEGRAM_SECRET: "" } });
    expect(res.status).toBe(503);
    expect(f.w.logs.join("\n")).toContain("TELEGRAM_SECRET");
  });

  it("ignores anyone not in SHIPIFY_PEOPLE, a group, and what isn't a message: 200, nothing written", async () => {
    const f = world(k);
    for (const body of [
      update({ text: "hi", from: { id: 1 }, chat: { id: 1, type: "private" } }),
      update({ text: "hi", chat: { id: -5, type: "group" } }),
      { update_id: 1, edited_message: { text: "x" } },
    ]) {
      const res = await post(f, body);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    }
    expect(f.w.issues).toEqual([]);
  });

  it("says at once that the door is closed, with how to open it, and writes nothing", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_DOOR = "closed";
    const res = await post(f, update({ text: "hi" }));
    // A 200: Telegram sends nothing again, and holds no later message behind it.
    expect(res.status).toBe(200);
    expect(await said(res)).toBe(
      "The door is closed (SHIPIFY_DOOR is closed), so nothing was saved. Delete the variable SHIPIFY_DOOR on GitHub to open it, then send it again.",
    );
    expect(f.w.issues).toEqual([]);
  });
});

describe("writing your words as the door App", () => {
  it("opens a new task titled from your words, with a from line naming you, and says Got it · #n", async () => {
    const f = world(k);
    const res = await post(f, update({ text: "/ask why is spotter slow?\nit takes ages" }, 41));
    expect(await said(res)).toBe("Got it · #1 · Auto (Sonnet · Medium)");
    const [issue] = f.w.issues;
    expect(issue?.title).toBe("ask: why is spotter slow?");
    // Opened with the App's own token: GitHub names only its bot user.
    expect(issue?.user).toEqual({ login: DOOR, type: "Bot" });
    expect(readFrom(issue?.body)).toEqual({
      v: 1,
      person: "owner",
      channel: "telegram",
      chat: String(CHAT),
      id: "41",
    });
    expect(issue?.body).toContain("ask: why is spotter slow?\nit takes ages");
  });

  it("drops a leading `use <model>` line from the title, and keeps it in the body", async () => {
    const f = world(k);
    await post(f, update({ text: "use opus\nplan a habit tracker" }));
    expect(f.w.issues[0]?.title).toBe("plan a habit tracker");
    expect(f.w.issues[0]?.body).toContain("use opus\nplan a habit tracker");
  });

  it("keeps a `use …` alone as a setting for the task's next run, answered at once", async () => {
    const f = world(k);
    f.issue({ title: "make it faster" });
    expect(await said(await post(f, update({ text: "#1 use pi z-ai/glm-5.3 high" })))).toBe(
      "From your next message: Pi · glm-5.3 · High · #1",
    );
    // Marked, so no run starts for it (task.yml) and the watch doesn't wait on it.
    expect(readFrom(f.w.comments.at(-1)?.body)).toMatchObject({ setting: true });
    expect(f.w.comments.at(-1)?.body).toContain('"setting":true');
    // One that names nothing: refused at once, nothing written. No task: your model, which an edge
    // with no store can't keep (said, and nothing changes); model.test.ts keeps one.
    expect(await said(await post(f, update({ text: "#1 use banana" })))).toContain(
      "names no model",
    );
    expect(await said(await post(f, update({ text: "use opus" })))).toContain(
      "Your model couldn't be kept",
    );
    expect(f.w.comments).toHaveLength(1);
    expect(f.w.issues).toHaveLength(1);
    // With words, it's words as ever (the box reads its line).
    await post(f, update({ text: "#1 use opus\nand smaller" }));
    expect(readFrom(f.w.comments.at(-1)?.body)?.setting).toBeUndefined();
  });

  it("writes a reply to one of its messages, or #n, as a comment on that task", async () => {
    const f = world(k);
    const task = f.issue({ title: "make it faster" });
    const a = await post(
      f,
      update({
        text: "and bigger",
        reply_to_message: { from: { is_bot: true }, text: "Done · #1 · make it faster" },
      }),
    );
    expect(await said(a)).toBe("Got it · #1");
    await post(f, update({ text: "#1 and blue" }));
    expect(
      f.w.comments.map((c) => [c.issue, c.user.login, c.body.split("\n").slice(1).join("\n")]),
    ).toEqual([
      [task.number, DOOR, "and bigger"],
      [task.number, DOOR, "#1 and blue"],
    ]);
  });

  it("writes a lone thanks on a task waiting on you as your answer; on any other task it's a thanks", async () => {
    const f = world(k);
    const asks = f.issue({ title: "make it faster", labels: ["needs you"] });
    const done = f.issue({ title: "make it bluer", labels: ["answered"] });
    const reply = (n: number, title: string) => ({
      text: "ok",
      reply_to_message: { from: { is_bot: true }, text: `Needs you · #${n} · ${title}` },
    });
    expect(await said(await post(f, update(reply(asks.number, asks.title))))).toBe(
      `Got it · #${asks.number}`,
    );
    expect(await said(await post(f, update(reply(done.number, done.title))))).toContain("👍");
    expect(f.w.comments.map((c) => [c.issue, c.body.split("\n").slice(1).join("\n")])).toEqual([
      [asks.number, "ok"],
    ]);
  });

  it("says GitHub couldn't be read when a lone thanks's task can't be, and writes nothing", async () => {
    const f = world(k);
    const task = f.issue({ title: "make it faster", labels: ["needs you"] });
    f.w.issueReadFails = task.number;
    const m = {
      text: "thanks",
      reply_to_message: { from: { is_bot: true }, text: `Needs you · #${task.number} · x` },
    };
    const res = await post(f, update(m));
    expect(res.status).toBe(200);
    expect(await said(res)).toBe(
      "Couldn't reach GitHub: nothing was saved. Send it again in a minute.",
    );
    expect(f.w.comments).toEqual([]);
  });

  it("reads `#12 ok` as a reply's `ok`: the #12 comes off before the thanks is read", async () => {
    const f = world(k);
    const asks = f.issue({ title: "make it faster", labels: ["needs you"] });
    const done = f.issue({ title: "make it bluer", labels: ["answered"] });
    expect(await said(await post(f, update({ text: `#${asks.number} ok` })))).toBe(
      `Got it · #${asks.number}`,
    );
    expect(await said(await post(f, update({ text: `#${done.number} thanks!` })))).toBe("👍");
    expect(f.w.comments.map((c) => c.issue)).toEqual([asks.number]);
  });

  it("closes or reopens a task at once on `close` or `reopen`, writing the word as a setting", async () => {
    const f = world(k);
    const task = f.issue({
      title: "make it faster",
      labels: ["answered", "needs you", "staying", "bug"],
    });
    f.w.runners = [];
    expect(await said(await post(f, update({ text: `#${task.number} close` })))).toBe(
      `Closed · #${task.number}`,
    );
    expect(task.state).toBe("closed");
    // The state labels go with the close, in the same write, and a stay's (ADR 0057); yours stay.
    expect(task.labels).toEqual(["bug"]);
    expect(await said(await post(f, update({ text: `#${task.number} Reopen it.` })))).toBe(
      `Reopened · #${task.number}`,
    );
    expect(task.state).toBe("open");
    // A close or reopen the door did is a setting: no run, and the next one that reads the task
    // notes it.
    expect(f.w.comments.map((c) => c.body.split("\n").slice(1).join("\n"))).toEqual([
      `#${task.number} close`,
      `#${task.number} Reopen it.`,
    ]);
    expect(f.w.comments.map((c) => readFrom(c.body)?.setting)).toEqual([true, true]);
  });

  it("says a task is already open or closed, and writes nothing: no run starts for it", async () => {
    const f = world(k);
    const task = f.issue({ title: "make it faster" });
    expect(await said(await post(f, update({ text: `#${task.number} reopen` })))).toBe(
      `Already open · #${task.number}`,
    );
    task.state = "closed";
    expect(await said(await post(f, update({ text: `#${task.number} close` })))).toBe(
      `Already closed · #${task.number}`,
    );
    expect(f.w.comments).toEqual([]);
    expect(f.w.calls.filter((c) => c.startsWith("PATCH"))).toEqual([]);
  });

  it("says a close GitHub didn't take failed, and writes nothing: nothing does it later", async () => {
    const f = world(k);
    const task = f.issue({ title: "make it faster" });
    f.w.issueWriteFails = task.number;
    const res = await post(f, update({ text: `#${task.number} close` }));
    expect(res.status).toBe(200);
    expect(await said(res)).toBe(
      `Couldn't close #${task.number}: GitHub failed, so nothing was saved. Send it again.`,
    );
    expect(task.state).toBe("open");
    expect(f.w.comments).toEqual([]);
  });

  it("says when no box is online, as well as Got it", async () => {
    const f = world(k);
    f.w.runners = [];
    expect(await said(await post(f, update({ text: "hi there" })))).toBe(
      "Got it · #1 · Auto (Sonnet · Medium)\nNo box is online: it runs when one is back.",
    );
  });
});

describe("refused at once, nothing written", () => {
  it("refuses a task that isn't there, a pull request, the status task, a notebook page, someone else's, a locked one", async () => {
    const f = world(k);
    const pr = f.issue({ pull_request: {} });
    const status = f.issue({ labels: ["shipify-status"] });
    const page = f.issue({ labels: ["notebook"] });
    const theirs = f.issue({ user: { login: "stranger" } });
    const locked = f.issue({ locked: true });
    const cases: [number, string][] = [
      [99999, "There's no task #99999 to carry on"],
      [pr.number, "is a pull request"],
      [status.number, "status page"],
      [page.number, "notebook page"],
      [theirs.number, "isn't one of your tasks"],
      [locked.number, "is locked"],
    ];
    for (const [n, words] of cases) {
      const res = await post(f, update({ text: `#${n} hello` }));
      expect(res.status).toBe(200);
      expect(await said(res)).toContain(words);
    }
    expect(f.w.comments).toEqual([]);
    expect(f.w.issues).toHaveLength(5);
  });
});

describe("carrying on a task the door opened", () => {
  it("takes `#n …` on a task it opened, known by its bot user (GitHub sets no App on it)", async () => {
    const f = world(k);
    expect(await said(await post(f, update({ text: "how much disk?" }, 41)))).toBe(
      "Got it · #1 · Auto (Sonnet · Medium)",
    );
    expect(f.w.issues[0]?.performed_via_github_app).toBeNull();
    const more = await post(f, update({ text: "#1 and memory?" }, 42));
    expect(await said(more)).toBe("Got it · #1");
    expect(f.w.comments.map((c) => c.issue)).toEqual([1]);
  });
});

describe("written once, whatever Telegram sends again", () => {
  it("answers a retried update as before, and writes nothing more", async () => {
    const f = world(k);
    const u = update({ text: "make a todo app" });
    expect(await said(await post(f, u))).toBe("Got it · #1 · Auto (Sonnet · Medium)");
    // Sent again: the same task, said again (its model was said the first time).
    expect(await said(await post(f, u))).toBe("Got it · #1");
    expect(f.w.issues).toHaveLength(1);
  });

  it("finds its own write on GitHub when this instance didn't make it (another isolate)", async () => {
    const f = world(k);
    const u = update({ text: "#1 more" });
    f.issue({ title: "x" });
    await post(f, u);
    clearCaches();
    f.later(60_000);
    const before = f.gh().length;
    expect(await said(await post(f, u))).toBe("Got it · #1");
    expect(f.w.comments).toHaveLength(1);
    // The look is the door App's newest issues and comments: two calls, and no write.
    const calls = f.gh().slice(before);
    expect(calls.filter((c) => /issues\?state=all|issues\/comments\?/.test(c))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith("POST") && !c.includes("access_tokens"))).toEqual([]);
  });

  it("catches a repeat on another instance before GitHub's listings show the write (Cloudflare's cache)", async () => {
    const store = new Map<string, string>();
    const cache = {
      put: async (req: Request, res: Response) => void store.set(req.url, await res.text()),
      match: async (req: Request) =>
        store.has(req.url) ? new Response(store.get(req.url)) : undefined,
    };
    vi.stubGlobal("caches", { default: cache });
    try {
      const f = world(k);
      const u = update({ text: "make a todo app" });
      expect(await said(await post(f, u))).toBe("Got it · #1 · Auto (Sonnet · Medium)");
      clearCaches(); // another instance
      f.w.listsLag = true; // and GitHub doesn't list the new issue yet
      expect(await said(await post(f, u))).toBe("Got it · #1");
      expect(f.w.issues).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("puts an album on one task: its first photo opens it, the rest are comments, said once", async () => {
    const f = world(k);
    const photo = (id: string) => [{ file_id: id, file_size: 10 }];
    const first = await post(
      f,
      update({ photo: photo("AgAC1"), caption: "these screens", media_group_id: "al1" }),
    );
    expect(await said(first)).toBe("Got it · #1 · Auto (Sonnet · Medium)");
    clearCaches(); // the next photo may reach another instance: GitHub's listing finds the album
    const second = await post(f, update({ photo: photo("AgAC2"), media_group_id: "al1" }));
    expect(await second.text()).toBe("");
    const third = await post(f, update({ photo: photo("AgAC3"), media_group_id: "al1" }));
    expect(await third.text()).toBe("");
    expect(f.w.issues).toHaveLength(1);
    expect(f.w.comments.map((c) => c.issue)).toEqual([1, 1]);
    const froms = [f.w.issues[0]?.body, ...f.w.comments.map((c) => c.body)].map(readFrom);
    expect(froms.map((x) => x?.files?.[0]?.ref)).toEqual([
      "telegram:AgAC1",
      "telegram:AgAC2",
      "telegram:AgAC3",
    ]);
    expect(froms.every((x) => x?.album === "al1")).toBe(true);
  });
});

describe("answered at once, writing nothing", () => {
  it("answers /help, a bare /start, a menu command alone, a lone thanks, a voice note, a wordless photo", async () => {
    const f = world(k);
    const cases: [Record<string, unknown>, string][] = [
      [{ text: "/help" }, "/ping:"],
      [{ text: "/start" }, "Send me anything"],
      [{ text: "/ask" }, "Send /ask with your words after it"],
      [{ text: "thanks!" }, "👍"],
      [
        { text: "thanks", reply_to_message: { from: { is_bot: true }, text: "Done · #4 · x" } },
        "👍",
      ],
      [{ text: "yes" }, "To answer a task, reply to its message"],
      [{ voice: { file_id: "AwAC" } }, "not voice notes or videos"],
      [{ photo: [{ file_id: "AgAC" }] }, "Add a caption"],
    ];
    for (const [m, words] of cases)
      expect(await said(await post(f, update(m))), JSON.stringify(m)).toContain(words);
    expect(f.w.issues).toEqual([]);
    expect(f.w.comments).toEqual([]);
  });

  it("answers /ping from the runners and the status task's record, /apps from its apps, /repos from its repos", async () => {
    const f = world(k);
    // Your other accounts (Shipify's own is never one of them).
    f.w.variables.SHIPIFY_ACCOUNTS = "acme:77,o";
    f.issue({
      labels: ["shipify-status"],
      body: `<!-- shipify-status ${JSON.stringify({
        v: 2,
        watch: { last: new Date(f.w.at - 3_600_000).toISOString() },
        apps: [
          { id: "spotter", url: "https://spotter.example.com" },
          { id: "links", url: "https://links.example.com", paused: true },
        ],
        repos: {
          at: new Date(f.w.at - 3_600_000).toISOString(),
          names: ["links", "notes-api", "shipify", "spotter", "bad name", "/help"],
          projects: ["links", "spotter"],
        },
      })} -->\n# Shipify status`,
    });
    f.w.apps["https://spotter.example.com/health"] = { body: { status: "ok", version: "1.4.0" } };
    expect(await said(await post(f, update({ text: "/ping" })))).toBe(
      "All good\npi: online, 1 slot (0 busy)\nThe watch: last due run 1h ago",
    );
    expect(await said(await post(f, update({ text: "/apps" })))).toBe(
      "spotter: live · v1.4.0\nhttps://spotter.example.com\n\nlinks: taken down\nhttps://links.example.com",
    );
    // Shipify's own account's, by kind (a name that isn't a repo's is never shown); then your
    // other accounts, from SHIPIFY_ACCOUNTS.
    expect(await said(await post(f, update({ text: "/repos" })))).toBe(
      [
        "o (read 1h ago):",
        "Projects (Shipify built them): links · spotter",
        "Repos (their own rules): notes-api · shipify",
        "acme: name a repo as acme/<repo>. The first task checks Shipify can reach it.",
        "",
        "To change one: <name>: what to change. To read one: look at <name>. A repo made since works by its name at once. Its notes: remember <name>: …",
      ].join("\n"),
    );
    expect(f.w.comments).toEqual([]);
  });

  it("pins the status on `/ping pin`, with no sound and no answer beside it, writing nothing", async () => {
    const f = world(k);
    const t = f.issue({ title: "make it blue", labels: ["working"] });
    const res = await post(f, update({ text: "/ping pin" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    const [sent, pinned] = f.w.sent;
    expect(sent?.method).toBe("sendMessage");
    expect(sent?.body.disable_notification).toBe(true);
    expect(sent?.body.text).toBe(
      [
        `1 slot free · #${t.number}`,
        "pi: 0 of 1 slot busy",
        `#${t.number} · make it blue`,
        PIN_MARK,
      ].join("\n"),
    );
    // The task's number, at the start of its line, links to it.
    expect(sent?.body.entities).toEqual([
      expect.objectContaining({
        type: "text_link",
        url: `https://github.com/o/shipify/issues/${t.number}`,
      }),
    ]);
    expect(pinned).toEqual({
      method: "pinChatMessage",
      body: { chat_id: CHAT, message_id: 1, disable_notification: true },
    });
    expect(f.w.comments).toEqual([]);
    // Telegram won't pin it: said, so you can send it again.
    f.w.telegramFails.pinChatMessage = { status: 400, body: { ok: false, description: "no" } };
    expect(await said(await post(f, update({ text: "/ping pin" })))).toContain(
      "didn't take the pinned status",
    );
  });

  it("answers /models from executors.json, and /models <word> from the gateway's list, with no key", async () => {
    const f = world(k);
    expect(await said(await post(f, update({ text: "/models" })))).toContain(
      "\nnvidia/nemotron-3-ultra-550b-a55b:free\n",
    );
    expect(f.w.calls.filter((c) => c.includes("openrouter"))).toEqual([]);
    f.w.apps["https://openrouter.ai/api/v1/models"] = {
      body: { data: [{ id: "moonshotai/kimi-k3", pricing: { prompt: "0", completion: "0" } }] },
    };
    // Vercel's list comes whole and is searched here; each gateway answers in its own part.
    f.w.apps["https://ai-gateway.vercel.sh/v1/models"] = {
      body: {
        data: [
          {
            id: "moonshotai/kimi-k3",
            name: "Kimi K3",
            type: "language",
            tags: ["tool-use"],
            zdr: "some",
            pricing: { input: "0.000003", output: "0.000015" },
          },
          { id: "zai/glm-5", name: "GLM 5", type: "language", tags: ["tool-use"], zdr: "all" },
        ],
      },
    };
    expect(await said(await post(f, update({ text: "/models kimi" })))).toBe(
      [
        "openrouter, “kimi”: price per million tokens, in / out\nmoonshotai/kimi-k3: free\nPick one with a line: use pi moonshotai/kimi-k3 or use opencode moonshotai/kimi-k3",
        "vercel-ai-gateway, “kimi”: price per million tokens, in / out\nmoonshotai/kimi-k3: $3.00 / $15.00\nPick one with a line: use pi-vercel moonshotai/kimi-k3 or use opencode-vercel moonshotai/kimi-k3",
      ].join("\n\n"),
    );
    expect(f.w.calls.filter((c) => c.includes("openrouter"))).toEqual([
      "GET openrouter.ai/api/v1/models?supported_parameters=tools&limit=20&q=kimi",
    ]);
    // Each one found is a button that picks it (ADR 0042 §3), on the agent the `use` grammar gives
    // it; as a reply on a task, its head names the task, so a tap picks for it.
    const found = (await (await post(f, update({ text: "/models kimi" }))).json()) as {
      text?: string;
      reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] };
    };
    expect(found.reply_markup?.inline_keyboard?.flat()).toContainEqual({
      text: "moonshotai/kimi-k3",
      callback_data: "use moonshotai/kimi-k3",
    });
    f.issue({ title: "a task" });
    const onTask = await said(
      await post(
        f,
        update({
          text: "/models kimi",
          reply_to_message: { from: { is_bot: true }, text: "Done · #1 · a task" },
        }),
      ),
    );
    expect(onTask?.split("\n")[0]).toMatch(/^#1 · openrouter/);
    f.w.apps["https://openrouter.ai/api/v1/models"] = { status: 502 };
    expect(await said(await post(f, update({ text: "/models kimi" })))).toContain(
      "Couldn't read openrouter's list just now",
    );
    // Not the other's: its part stays.
    expect(await said(await post(f, update({ text: "/models kimi" })))).toContain(
      "vercel-ai-gateway, “kimi”",
    );
    // Only the task made above: /models never writes one.
    expect(f.w.issues.map((i) => i.title)).toEqual(["a task"]);
  });

  it("tells anyone with a good link code their own id, before reading who's who", async () => {
    const f = world(k);
    const { createHmac } = await import("node:crypto");
    const key = createHmac("sha256", "tg-secret").update("shipify:link").digest("hex");
    const exp = Math.floor(f.w.at / 1000) + 600;
    const mac = createHmac("sha256", key).update(`telegram|${exp}`).digest("hex").slice(0, 16);
    const stranger = { from: { id: 77 }, chat: { id: 77, type: "private" } };
    expect(
      await said(await post(f, update({ text: `/start ${exp}.${mac}`, ...stranger }))),
    ).toContain("Your Telegram id is 77");
    expect(
      await (
        await post(f, update({ text: `/start ${exp}.${"0".repeat(16)}`, ...stranger }))
      ).text(),
    ).toBe("");
    expect(f.gh()).toEqual([]);
  });
});

describe("when GitHub says no", () => {
  const DOWN = "Couldn't reach GitHub: nothing was saved. Send it again in a minute.";

  it("says at once when GitHub is down, and writes nothing: Telegram sends nothing again", async () => {
    const f = world(k);
    await post(f, update({ text: "warm up the token" }));
    clearCaches();
    f.w.githubDown = true;
    const res = await post(f, update({ text: "hello" }));
    expect(res.status).toBe(200);
    expect(await said(res)).toBe(DOWN);
    // Down while writing, with who's who read: the same words.
    f.w.githubDown = false;
    await post(f, update({ text: "read who's who" }));
    f.w.githubDown = true;
    expect(await said(await post(f, update({ text: "hello again" })))).toBe(DOWN);
    expect(f.w.issues).toHaveLength(2);
  });

  it("tells only a person that GitHub refused the door App's key, with the fix", async () => {
    const f = world(k);
    await post(f, update({ text: "read who's who" }));
    f.w.tokenStatus = 401;
    clearCaches();
    // Who's who can't be read now: the last good read says who's writing, and nothing more.
    expect(await said(await post(f, update({ text: "hello" })))).toBe(DOWN);
    const g = world(k);
    await post(g, update({ text: "read who's who" }));
    g.w.tokenStatus = 401;
    const { forget } = await import("../../edge/src/cache.ts");
    forget(`gh:token:${APP_ID}:555`);
    forget("settings:o/shipify");
    expect(await said(await post(g, update({ text: "hello" })))).toContain(
      "pnpm ship door setup --new --yes",
    );
    const stranger = { from: { id: 77 }, chat: { id: 77, type: "private" } };
    const theirs = await post(g, update({ text: "hello", ...stranger }));
    expect(theirs.status).toBe(200);
    expect(await theirs.text()).toBe("");
  });

  it("logs what happened, never your words, your id or a key", async () => {
    const f = world(k);
    await post(f, update({ text: "my secret plan for spotter" }, 5151));
    const logs = f.w.logs.join("\n");
    expect(logs).toContain('"event":"door.in.written"');
    expect(logs).not.toContain("secret plan");
    expect(logs).not.toContain(String(CHAT));
    expect(logs).not.toContain("5151");
  });
});

describe("any channel: the door names none", () => {
  /** A channel that only this test has: its webhook is plain JSON, its proof a header. */
  const sent: { chat: string; text: string; trouble?: string }[] = [];
  const fake: Channel = {
    id: "fake",
    name: "Fake",
    needs: ["SHIPIFY_DOOR_URL"],
    chatId: /^u\d+$/,
    limits: { text: 1000 },
    verify: (req) => req.headers.get("x-fake") === "yes",
    parse: (body) => {
      try {
        return JSON.parse(body) as Message;
      } catch {
        return null;
      }
    },
    answer: (m, text, trouble) => {
      sent.push({ chat: m.chat, text, ...(trouble ? { trouble: trouble.code } : {}) });
      return new Response(null, { status: 200 });
    },
    send: async () => ({ ok: true }),
  };
  const call = (f: ReturnType<typeof world>, m: Partial<Message>) =>
    doorIn(
      new Request("https://shipify.example.com/door/fake", {
        method: "POST",
        headers: { "x-fake": "yes" },
        body: JSON.stringify({ id: "e1", chat: "u1", user: "u1", forwarded: false, ...m }),
      }),
      envFor(k),
      f.deps,
      fake,
    );

  it("writes your words onto a task through any adapter, and answers through it", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([{ name: "owner", on: { fake: "u1" } }]);
    sent.length = 0;
    expect((await call(f, { words: "what is spotter?" })).status).toBe(200);
    const [issue] = f.w.issues;
    expect(issue?.title).toBe("what is spotter?");
    expect(readFrom(issue?.body)).toMatchObject({
      person: "owner",
      channel: "fake",
      chat: "u1",
      id: "e1",
    });
    expect(sent.at(-1)?.text).toBe(`Got it · #${issue?.number} · Auto (Sonnet · Medium)`);
    // The same event again is written once.
    await call(f, { words: "what is spotter?" });
    expect(f.w.issues).toHaveLength(1);
    // The commands are the core's: /help answers through the adapter, writing nothing.
    await call(f, { id: "e2", words: "/help" });
    expect(sent.at(-1)?.text).toContain("/ping:");
    expect(f.w.issues).toHaveLength(1);
  });

  it("answers what broke in the door itself as a failure, with a 200: nothing is sent again", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([{ name: "owner", on: { fake: "u1" } }]);
    sent.length = 0;
    // An id longer than a from-line holds: the write can't be made.
    const res = await call(f, { id: "e".repeat(200), words: "hi" });
    expect(res.status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ trouble: "door-failed" });
    expect(sent.at(-1)?.text).toContain("nothing was saved");
    expect(f.w.issues).toEqual([]);
    // GitHub down: the same way, as a failure the channel can show as one.
    f.w.githubDown = true;
    await call(f, { id: "e3", words: "hi" });
    expect(sent.at(-1)).toMatchObject({ trouble: "github-down" });
  });

  it("lets in only a person on that channel, and only with the adapter's proof", async () => {
    const f = world(k);
    f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([{ name: "owner", on: { telegram: "u1" } }]);
    expect((await call(f, { words: "hi" })).status).toBe(200);
    expect(f.w.issues).toEqual([]);
    const unproven = await doorIn(
      new Request("https://shipify.example.com/door/fake", { method: "POST", body: "{}" }),
      envFor(k),
      f.deps,
      fake,
    );
    expect(unproven.status).toBe(401);
  });
});
