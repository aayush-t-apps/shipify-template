// The web chat's routes (edge/src/web/routes.ts, ADR 0036), through the edge's own handler, in the
// fake world: the status page's sign-in on every route, posts only from the page itself, your words
// into the door as the `web` channel (once, files as an album, `use` lines, the door's answers),
// files kept and served safely, and reads in the shapes the page knows.
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  fromLine,
  readFrom,
  replyLine,
  STATUS_MARK,
  withoutLine,
} from "../../../cli/contracts/index.ts";
import { readExecutors } from "../../../cli/lib/agents.ts";
import { loadForms } from "../../../cli/lib/form-reader.ts";
import { repeatForm, taskForm } from "../../../cli/lib/task.ts";
import { clearCertsCache } from "../../../edge/src/access.ts";
import { handle } from "../../../edge/src/app.ts";
import { clearCaches } from "../../../edge/src/cache.ts";
import { web } from "../../../edge/src/channels/web.ts";
import { alertOf } from "../../../edge/src/chat.ts";
import type { Env } from "../../../edge/src/env.ts";
import { clearSeen } from "../../../edge/src/web/gh.ts";
import { clearBuilt } from "../../../edge/src/web/reads.ts";
import { MERMAID } from "../../../edge/src/web/routes.ts";
import { ROOT } from "../../helpers.ts";
import { browser, pushKey } from "../browser.ts";
import {
  APP_ID,
  DOOR,
  envFor,
  type Keys,
  keys,
  ORIGIN,
  OWNER,
  RUN,
  runToken,
  world,
} from "../fake.ts";
import { memoryKv } from "../kv.ts";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "b".repeat(64);
let k: Keys;
let access: CryptoKeyPair;
let jwk: JsonWebKey;
beforeAll(async () => {
  k = await keys();
  access = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey("jwk", access.publicKey)), kid: "ak1" } as JsonWebKey;
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function token(now: number, aud = AUD) {
  const head = b64({ alg: "RS256", kid: "ak1" });
  const body = b64({
    aud: [aud],
    iss: `https://${TEAM}`,
    exp: Math.floor(now / 1000) + 600,
    nbf: Math.floor(now / 1000) - 10,
  });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    access.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

const PAGE = "<!doctype html><title>Shipify</title>";

function setUp() {
  clearCertsCache();
  clearSeen();
  clearBuilt();
  const f = world(k);
  f.w.variables.SHIPIFY_ACCESS = JSON.stringify({ team: TEAM, aud: AUD });
  f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([
    { name: "owner", on: { github: "owner", telegram: "4242", web: "me" } },
  ]);
  f.w.apps[`https://${TEAM}/cdn-cgi/access/certs`] = { body: { keys: [jwk] } };
  const store = memoryKv(() => f.w.at);
  const assets = {
    fetch: async (r: Request) =>
      [
        "/admin/chat/index.html",
        "/draw/index.html",
        "/draw/draw.js",
        "/note/icon.png",
        "/note/badge.png",
      ].includes(new URL(r.url).pathname)
        ? new Response(PAGE, { headers: { "content-type": "text/html" } })
        : new Response("nope", { status: 404 }),
  };
  const env = envFor(k, { FILES: store.kv, ASSETS: assets } as unknown as Partial<Env>);
  const call = async (path: string, init: RequestInit = {}, signed: boolean | string = true) => {
    const headers = new Headers(init.headers);
    if (signed)
      headers.set(
        "cf-access-jwt-assertion",
        await token(f.w.at, typeof signed === "string" ? signed : AUD),
      );
    return handle(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, f.deps);
  };
  const post = (path: string, body: unknown, more: Record<string, string> = {}) =>
    call(path, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "x-shipify-chat": "1",
        "content-type": "application/json",
        ...more,
      },
      body: JSON.stringify(body),
    });
  const upload = (name: string, type: string, bytes: string) =>
    call("/admin/chat/api/file", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "x-shipify-chat": "1",
        "content-type": type,
        "x-file-name": encodeURIComponent(name),
      },
      body: bytes,
    });
  return { f, env, store, call, post, upload };
}

describe("the sign-in and the page", () => {
  it("every route asks for the status page's Access token, and shows nothing without it", async () => {
    const t = setUp();
    for (const path of ["/admin/chat", "/admin/chat/api/list", "/admin/chat/api/task/1"]) {
      const res = await t.call(path, {}, false);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({
        error: expect.any(String),
        fix: expect.any(String),
      });
      expect((await t.call(path, {}, "c".repeat(64))).status, path).toBe(403);
    }
    const sent = await t.post("/admin/chat/api/send", { id: "abcdefgh1", words: "hi" });
    expect(sent.status).toBe(200);
    expect(t.f.w.issues).toHaveLength(1);
  });

  it("says GitHub refused the door App's key, with the fix, not that GitHub didn't answer", async () => {
    const t = setUp();
    t.f.w.tokenStatus = 401;
    const res = await t.call("/admin/chat/api/list");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("refused the door App's key"),
      fix: expect.stringContaining("pnpm ship door setup --new --yes"),
    });
  });

  it("refuses everything before the status page is set up", async () => {
    const t = setUp();
    delete t.f.w.variables.SHIPIFY_ACCESS;
    const res = await t.call("/admin/chat/api/list");
    expect(res.status).toBe(403);
    expect((await res.json()).fix).toContain("ship door page");
  });

  it("serves the page's files behind the check, with a strict CSP; nothing else", async () => {
    const t = setUp();
    for (const path of ["/admin/chat", "/admin/chat/"]) {
      const res = await t.call(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PAGE);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      // Its service worker (ADR 0050), from its own files only.
      expect(csp).toContain("worker-src 'self'");
      expect(csp).not.toContain("unsafe");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await t.call("/admin/chat/app.js")).status).toBe(404);
    expect((await t.call("/admin/chat/sub/dir.js")).status).toBe(404);
    expect((await t.call("/admin/chat/x", { method: "POST" })).status).toBe(405);
  });

  it("/ and /admin send you to the chat; nothing else moves", async () => {
    const t = setUp();
    const to = async (path: string, method = "GET") =>
      (await t.call(path, { method, redirect: "manual" }, false)).headers.get("location");
    expect(await to("/")).toBe("/admin/chat/");
    expect(await to("/admin")).toBe("/admin/chat/");
    expect(await to("/admin/")).toBe("/admin/chat/");
    expect(await to("/status")).toBeNull();
    expect(await to("/admin", "POST")).toBeNull();
    // The status page is at /admin/status, behind the same check.
    expect((await t.call("/admin/status", {}, false)).status).toBe(403);
  });

  it("the diagram frame is a static page outside the sign-in, with only its pinned scripts", async () => {
    const t = setUp();
    for (const path of ["/draw/", "/draw/draw.js"]) {
      const res = await t.call(path, {}, false);
      expect(res.status, path).toBe(200);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain(`script-src ${ORIGIN}/draw/draw.js ${MERMAID};`);
      expect(csp).toContain(`frame-ancestors ${ORIGIN}`);
      expect(csp).not.toMatch(/connect-src|unsafe-eval/);
    }
    expect(t.f.w.issues).toHaveLength(0);
    expect((await t.call("/draw/other.js", {}, false)).status).toBe(404);
    expect((await t.call("/draw/", { method: "POST" }, false)).status).toBe(404);
  });

  it("a notification's pictures are outside the sign-in: a phone fetches them after it ends", async () => {
    const t = setUp();
    for (const path of ["/note/icon.png", "/note/badge.png"]) {
      const res = await t.call(path, {}, false);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    }
    expect((await t.call("/note/other.png", {}, false)).status).toBe(404);
    expect((await t.call("/note/icon.png", { method: "POST" }, false)).status).toBe(404);
  });

  it("is off until someone has an id on the chat: it says how to turn it on", async () => {
    const t = setUp();
    t.f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([{ name: "owner", on: { github: "owner" } }]);
    const res = await t.call("/admin/chat/api/list");
    expect(res.status).toBe(409);
    expect((await res.json()).fix).toContain("pnpm ship add webchat --yes");
  });
});

describe("what you send goes through the door", () => {
  it("a POST from another site, or without the chat's header, is refused and writes nothing", async () => {
    const t = setUp();
    const body = { id: "abcdefgh1", words: "hi" };
    expect(
      (await t.post("/admin/chat/api/send", body, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect((await t.post("/admin/chat/api/send", body, { "x-shipify-chat": "0" })).status).toBe(
      403,
    );
    expect(t.f.w.issues).toHaveLength(0);
  });

  it("POST /door/web from outside gets the door's 401, as a forged webhook does", async () => {
    const t = setUp();
    const res = await handle(
      new Request(`${ORIGIN}/door/web`, {
        method: "POST",
        body: JSON.stringify({
          id: "x1234567",
          chat: "me",
          user: "me",
          words: "hi",
          forwarded: false,
        }),
      }),
      t.env,
      t.f.deps,
    );
    expect(res.status).toBe(401);
    expect(t.f.w.issues).toHaveLength(0);
  });

  it("your words become a task, written once, as the web channel, and the door's answer comes back", async () => {
    const t = setUp();
    const body = { id: "msg00000001", words: "make spotter faster" };
    const res = await t.post("/admin/chat/api/send", body);
    expect(res.status).toBe(200);
    const sent = await res.json();
    expect(sent).toMatchObject({ v: 1, task: 1 });
    expect(sent.text).toMatch(/^Got it · #1/);
    const issue = t.f.w.issues[0];
    expect(issue?.title).toBe("make spotter faster");
    expect(readFrom(issue?.body)).toMatchObject({ person: "owner", channel: "web", chat: "me" });
    // A double tap, a retry or a second tab: the same id, written once.
    expect(await (await t.post("/admin/chat/api/send", body)).json()).toMatchObject({ task: 1 });
    expect(t.f.w.issues).toHaveLength(1);
    expect(t.f.w.comments).toHaveLength(0);
  });

  it("on a task: a model picked alone is a `use` line, and fixed words go as you'd type them", async () => {
    const t = setUp();
    t.f.issue({ title: "a task", user: { login: "owner" } });
    await t.post("/admin/chat/api/send", {
      id: "msg00000002",
      task: 1,
      words: "",
      use: "opus high",
    });
    await t.post("/admin/chat/api/send", { id: "msg00000003", task: 1, words: "again" });
    expect(t.f.w.comments.map((c) => withoutLine(c.body))).toEqual(["use opus high", "again"]);
  });

  it("a `use` alone with no task is your model here too: kept, and the next new task starts with it", async () => {
    const t = setUp();
    const sent = await (
      await t.post("/admin/chat/api/send", { id: "msg00000009", words: "use opus" })
    ).json();
    expect(sent.task).toBeUndefined();
    expect(sent.text).toMatch(/^Your model: Opus\./);
    expect(t.f.w.issues).toHaveLength(0);
    const next = await (
      await t.post("/admin/chat/api/send", { id: "msg00000010", words: "plan a trip" })
    ).json();
    expect(next.text).toMatch(/^Got it · #1 · Opus/);
    expect(t.f.w.issues[0]?.body).toContain("use claude opus\nplan a trip");
  });

  it("/ping is answered at once and writes nothing", async () => {
    const t = setUp();
    const sent = await (
      await t.post("/admin/chat/api/send", { id: "msg00000004", words: "/ping" })
    ).json();
    expect(sent.task).toBeUndefined();
    expect(sent.text).toContain("pi: online");
    expect(t.f.w.issues).toHaveLength(0);
  });

  it("a command with a pick is answered at once; a `use` line of your own comes after the pick's", async () => {
    const t = setUp();
    const sent = await (
      await t.post("/admin/chat/api/send", { id: "msg00000005", words: "/ping", use: "pi laguna" })
    ).json();
    expect(sent.text).toContain("pi: online");
    expect(t.f.w.issues).toHaveLength(0);
    const r = await t.post("/admin/chat/api/send", {
      id: "msg00000006",
      words: "what is 2+2?\nuse pi moonshotai/kimi-k3",
      use: "pi laguna high",
    });
    expect(r.status).toBe(200);
    const issue = t.f.w.issues[0];
    expect(issue?.title).toBe("what is 2+2?");
    // The box takes the last use line it can: yours, typed under your words.
    expect(withoutLine(issue?.body ?? "")).toBe(
      "use pi laguna high\nwhat is 2+2?\nuse pi moonshotai/kimi-k3",
    );
    // The pick goes first whatever your words say, as it always did; the box reads the lines.
    await t.post("/admin/chat/api/send", {
      id: "msg00000016",
      words: "hi\nuse the new API",
      use: "claude claude-opus-5-5[1m] high",
    });
    expect(t.f.w.issues[1]?.title).toBe("hi");
    expect(withoutLine(t.f.w.issues[1]?.body ?? "")).toBe(
      "use claude claude-opus-5-5[1m] high\nhi\nuse the new API",
    );
  });

  it("on a task, an answer at once names no task, so the page shows it there; written words name it", async () => {
    const t = setUp();
    t.f.issue({ title: "a task", user: { login: "owner" } });
    const help = await (
      await t.post("/admin/chat/api/send", { id: "msg00000007", task: 1, words: "/help" })
    ).json();
    expect(help.task).toBeUndefined();
    expect(help.text).toContain("/ping");
    expect(t.f.w.comments).toHaveLength(0);
    const said = await (
      await t.post("/admin/chat/api/send", { id: "msg00000008", task: 1, words: "make it blue" })
    ).json();
    expect(said).toMatchObject({ task: 1, text: expect.stringMatching(/^Got it · #1/) });
    const closed = await (
      await t.post("/admin/chat/api/send", { id: "msg00000009", task: 1, words: "close" })
    ).json();
    expect(closed).toMatchObject({ task: 1, text: "Closed · #1" });
  });

  it("with the door closed nothing is written, and the page says why", async () => {
    const t = setUp();
    t.f.w.variables.SHIPIFY_DOOR = "closed";
    const res = await t.post("/admin/chat/api/send", { id: "msg00000005", words: "hi" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("closed");
    expect(t.f.w.issues).toHaveLength(0);
  });

  it("with GitHub down nothing is written, the page says so in the door's words, and keeps it to send again", async () => {
    const t = setUp();
    await t.call("/admin/chat/api/list"); // who's who read, as the page's first look does
    t.f.w.githubDown = true;
    const res = await t.post("/admin/chat/api/send", { id: "msg00000006", words: "hi" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Couldn't reach GitHub: nothing was saved.",
      fix: "Send it again in a minute.",
    });
    expect(t.f.w.issues).toHaveLength(0);
  });

  it("words over the limit are refused with the limit named, and nothing is written", async () => {
    const t = setUp();
    const words = "x".repeat(16_001);
    const res = await t.post("/admin/chat/api/send", { id: "msg00000006", words });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "That message is over 16,000 characters.",
      fix: "Attach it as a file, or split it in two.",
    });
    expect(t.f.w.issues).toHaveLength(0);
    const menu = await (await t.call("/admin/chat/api/menu")).json();
    expect(menu.chars).toBe(16_000);
  });

  it("three files land on one task as an album, and a run fetches each through the door", async () => {
    const t = setUp();
    const refs: string[] = [];
    for (const [i, name] of ["a.png", "b.png", "notes.txt"].entries()) {
      const up = await (
        await t.upload(name, i < 2 ? "image/png" : "text/plain", `bytes-${i}`)
      ).json();
      expect(up).toMatchObject({ v: 1, name, size: 7 });
      refs.push(up.ref);
    }
    const files = refs.map((ref, i) => ({
      ref,
      name: ["a.png", "b.png", "notes.txt"][i] as string,
      type: i < 2 ? "image/png" : "text/plain",
      size: 7,
    }));
    const sent = await (
      await t.post("/admin/chat/api/send", { id: "album00001", words: "look at these", files })
    ).json();
    expect(sent.task).toBe(1);
    expect(t.f.w.issues).toHaveLength(1);
    expect(t.f.w.comments.map((c) => c.issue)).toEqual([1, 1]);
    const all = [t.f.w.issues[0]?.body, ...t.f.w.comments.map((c) => c.body)];
    const got = all.flatMap((b) => readFrom(b)?.files?.map((x) => x.ref) ?? []);
    expect(got).toEqual(refs.map((r) => `web:${r}`));
    const run = await runToken(k, t.f.w.at);
    const res = await handle(
      new Request(`${ORIGIN}/door/file/web:${refs[2]}`, {
        headers: { authorization: `Bearer ${run}` },
      }),
      t.env,
      t.f.deps,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes-2");
  });

  it("files: a sixth, or one that isn't in the store, is refused; with no words on a new chat too", async () => {
    const t = setUp();
    const file = { ref: "up-0123456789abcdef0123", name: "x.png", type: "image/png", size: 1 };
    expect(
      (
        await t.post("/admin/chat/api/send", {
          id: "files0001",
          words: "x",
          files: Array(6).fill(file),
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.post("/admin/chat/api/send", { id: "files0002", words: "x", files: [file] })).status,
    ).toBe(410);
    const up = await (await t.upload("x.png", "image/png", "b")).json();
    expect(
      (
        await t.post("/admin/chat/api/send", {
          id: "files0003",
          words: "",
          files: [{ ...file, ref: up.ref }],
        })
      ).status,
    ).toBe(400);
    expect(t.f.w.issues).toHaveLength(0);
  });
});

describe("files the chat keeps", () => {
  it("pictures show inline; anything else downloads, never sniffed; past 7 days it's gone", async () => {
    const t = setUp();
    const png = await (await t.upload("shot.png", "image/png", "png")).json();
    const svg = await (await t.upload("evil.svg", "image/svg+xml", "<svg onload=x>")).json();
    const a = await t.call(`/admin/chat/api/file/${png.ref}`);
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(a.headers.get("content-disposition")).toMatch(/^inline/);
    const b = await t.call(`/admin/chat/api/file/${svg.ref}`);
    expect(b.headers.get("content-type")).toBe("application/octet-stream");
    expect(b.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(b.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await t.call("/admin/chat/api/file/..%2F..%2Fetc")).status).toBe(404);
    const listed = await (await t.call("/admin/chat/api/files")).json();
    expect(listed.files.map((f: { name: string }) => f.name).sort()).toEqual([
      "evil.svg",
      "shot.png",
    ]);
    t.f.later(8 * 86_400_000);
    expect((await t.call(`/admin/chat/api/file/${png.ref}`)).status).toBe(410);
  });

  it("over 10 MB is refused at the edge", async () => {
    const t = setUp();
    const res = await t.upload(
      "big.bin",
      "application/octet-stream",
      "x".repeat(10 * 1024 * 1024 + 1),
    );
    expect(res.status).toBe(413);
  });
});

describe("what the page reads", () => {
  it("the list: tasks with their state and where they started, the boxes; unchanged is a 304", async () => {
    const t = setUp();
    t.f.issue({
      title: "Shipify status",
      body: `${STATUS_MARK}{"v":2} -->`,
      labels: ["shipify-status"],
    });
    t.f.issue({ title: "from GitHub", user: { login: "owner" } });
    t.f.issue({ title: "waiting on you", user: { login: "owner" }, labels: ["needs you"] });
    await t.post("/admin/chat/api/send", { id: "list00001", words: "from the chat" });
    const res = await t.call("/admin/chat/api/list");
    const list = await res.json();
    expect(list.boxes).toEqual([{ name: "pi", online: true, slots: 1, busy: 0 }]);
    expect(
      list.tasks.map((x: { title: string; state: string; from: string }) => [
        x.title,
        x.state,
        x.from,
      ]),
    ).toEqual([
      ["from the chat", "open", "web"],
      ["waiting on you", "needs-you", "github"],
      ["from GitHub", "open", "github"],
    ]);
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toBeTruthy();
    t.f.later(10_000);
    expect(
      (await t.call("/admin/chat/api/list", { headers: { "if-none-match": etag } })).status,
    ).toBe(304);
  });

  it("the list: a task's own labels, to filter by, not those its row already says", async () => {
    const t = setUp();
    t.f.issue({ title: "plain", user: { login: "owner" }, labels: ["stuck"] });
    t.f.issue({
      title: "labelled",
      user: { login: "owner" },
      labels: ["needs you", "bug", "working", "deploying", "answered", "repeats", "failed"],
    });
    const list = await (await t.call("/admin/chat/api/list")).json();
    const by = Object.fromEntries(
      list.tasks.map((x: { title: string; labels?: string[] }) => [x.title, x.labels]),
    );
    // A run's own state labels show as each row's state, not as filters; "failed" stays one.
    expect(by).toEqual({ plain: undefined, labelled: ["bug", "deploying", "failed"] });
  });

  it("the list and the thread: a run that stays waits for you, so it isn't Working, it's Staying (ADR 0057)", async () => {
    const t = setUp();
    const i = t.f.issue({
      title: "disk",
      user: { login: "owner" },
      labels: ["answered", "staying"],
    });
    const j = t.f.issue({ title: "cpu", user: { login: "owner" }, labels: ["answered"] });
    const going = (n: number, id: number) => ({
      id,
      status: "in_progress",
      conclusion: null,
      display_title: `task #${n}`,
      created_at: new Date(t.f.w.at).toISOString(),
    });
    t.f.w.runs["task.yml"] = [going(i.number, 90), going(j.number, 91)];
    const list = await (await t.call("/admin/chat/api/list")).json();
    const row = (title: string) => list.tasks.find((x: { title: string }) => x.title === title);
    expect(row("cpu").state).toBe("working");
    expect(row("disk").state).toBe("open");
    expect(row("disk").staying).toBe(true);
    // Said as its state, not a filter of yours.
    expect(row("disk").labels).toBeUndefined();
    expect(row("cpu").staying).toBeUndefined();
    const thread = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
    expect(thread.task.staying).toBe(true);
    expect(thread.task.state).toBe("open");
  });

  it("a thread: hidden lines never reach the page, a reply's bits are read, its HTML is cleaned", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", {
      id: "thread001",
      words: "use opus high\nmake it faster",
    });
    const line = replyLine({
      v: 1,
      kind: "needs-you",
      state: "Needs you",
      title: "make it faster",
      links: [["PR", "https://github.com/o/shipify/pull/9"]],
      brief: "Opus 5.5 · high · 5m",
      run: { secs: 300, tokens: 41200, usd: 0.05, model: "claude-opus-5-5" },
      question: "Merge it?",
      choices: ["Merge it", "Not yet"],
      to: ["web:me"],
      key: "k1",
    });
    t.f.w.comments.push({
      ...t.f.comment(1, `${line}\nDone: **faster**. Merge it, or reply \`continue\`.`, RUN),
      // As apply writes it for GitHub: the question and the links too, which the line carries.
      html: '<p>Done: <strong>faster</strong>.</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a><blockquote><p><strong>Question:</strong> Merge it?</p></blockquote><ul><li>PR: <a href="https://github.com/o/shipify/pull/9">https://github.com/o/shipify/pull/9</a></li></ul><details><summary>Run details: Opus</summary><table><tr><td>Time</td></tr></table></details>',
    });
    t.f.w.comments.splice(0, 1);
    const thread = await (await t.call("/admin/chat/api/task/1")).json();
    // Reading a thread asks nothing of the file store: KV's lists are 1,000 a day on the free plan.
    expect(t.store.state.lists).toBe(0);
    expect(thread.task).toMatchObject({ n: 1, from: "web", model: "opus high", open: true });
    expect(thread.writable).toBe(true);
    const [mine, reply] = thread.messages;
    expect(mine).toMatchObject({ who: "you", name: "owner", use: "opus high" });
    expect(mine.md).not.toContain("<!--");
    // Your pick shows from its tag, never as words (GitHub leaves a newline where the line was).
    expect(mine.html).not.toContain("use opus");
    expect(mine.html).toContain("make it faster");
    expect(reply).toMatchObject({
      who: "shipify",
      reply: {
        kind: "needs-you",
        brief: "Opus 5.5 · high · 5m",
        run: { secs: 300, tokens: 41200, usd: 0.05, model: "claude-opus-5-5" },
        question: "Merge it?",
        choices: ["Merge it", "Not yet"],
        // The same buttons every chat has: its answers, then the words it names.
        buttons: [
          { label: "Merge it", words: "Merge it" },
          { label: "Not yet", words: "Not yet" },
          { label: "Continue", words: "continue" },
        ],
        github: [],
      },
    });
    expect(reply.html).toContain("<strong>faster</strong>");
    // Its question and links show from the line (a box, buttons), not twice.
    for (const bad of ["<script", "onerror", "javascript:", "Run details", "Question:", "pull/9"])
      expect(reply.html).not.toContain(bad);
    expect(reply.details).toContain("<table>");
    expect(reply.md).toBe("Done: **faster**. Merge it, or reply `continue`.");
    expect(JSON.stringify(thread)).not.toContain("shipify-reply");
    expect((await t.call("/admin/chat/api/task/99")).status).toBe(404);
  });

  it("a reply with a list has only its Yes and No, as every chat has them (ADR 0049)", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "listed001", words: "write a quote in Notion" });
    const line = replyLine({
      v: 1,
      kind: "needs-you",
      state: "Needs you",
      title: "write a quote in Notion",
      links: [],
      question: "Shall I?",
      choices: ["Yes, I'll comment it on GitHub", "No, drop it"],
      list: "1a2b3c4d",
      to: ["web:me"],
      key: "k2",
    });
    const words =
      "I'd add it.\n\n**To do after your `yes`** (tap Yes, or say `yes`, within a day):";
    t.f.w.comments.push(t.f.comment(1, `${line}\n${words}\n1. \`notion.create_page\``, RUN));
    const thread = await (await t.call("/admin/chat/api/task/1")).json();
    expect(thread.messages.at(-1).reply).toMatchObject({
      buttons: [
        { label: "Yes", words: "yes 1a2b3c4d" },
        { label: "No", words: "no 1a2b3c4d" },
      ],
      github: [],
    });
  });

  it("a closed task your words carry on says so (wakes), but not for a thanks or a close's comment", async () => {
    const t = setUp();
    const ago = new Date(t.f.w.at - 300_000).toISOString();
    const i = t.f.issue({ title: "done with", state: "closed", ...{ closed_at: ago } });
    // Each read past the edge's 5 seconds of memory.
    const wakes = async () => {
      t.f.later(10_000);
      return (await (await t.call(`/admin/chat/api/task/${i.number}`)).json()).task;
    };
    expect((await wakes()).wakes).toBeUndefined();
    t.f.w.comments.push(t.f.comment(i.number, "thanks!", { login: OWNER }));
    expect((await wakes()).wakes).toBeUndefined();
    t.f.w.comments.push(t.f.comment(i.number, "one more: and the Pi?", { login: OWNER }));
    expect(await wakes()).toMatchObject({ open: false, wakes: true });
    // Words just as it closed ("Close with comment") don't carry it on.
    Object.assign(i, { closed_at: new Date(t.f.w.at).toISOString() });
    expect((await wakes()).wakes).toBeUndefined();
  });

  it("your words a run read (its 👀) say so, from GitHub's count on the comment: no extra read", async () => {
    const t = setUp();
    const i = t.f.issue({ title: "two asks" });
    t.f.comment(i.number, "first ask", { login: OWNER }).reactions.push({
      content: "eyes",
      user: { login: "github-actions[bot]", type: "Bot" },
    });
    t.f.comment(i.number, "sent as it replied", { login: OWNER });
    const thread = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
    const [first, second] = thread.messages.filter((m: { id: number }) => m.id);
    expect(first).toMatchObject({ md: "first ask", read: true });
    expect(second.read).toBeUndefined();
  });

  it("the task's own words show read (✓✓) once a run put 👀 on the task", async () => {
    const t = setUp();
    const i = t.f.issue({
      title: "what is shipify?",
      body: "what is shipify?",
      ...{ reactions: { eyes: 1 } },
    });
    const thread = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
    expect(thread.messages[0]).toMatchObject({ who: "you", read: true });
  });

  it("a task written on GitHub with only a title starts with that title, not an empty message", async () => {
    const t = setUp();
    const i = t.f.issue({ title: "check the <b>footer</b> & logo", body: "" });
    const thread = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
    expect(thread.messages[0]).toMatchObject({
      who: "you",
      md: "check the <b>footer</b> & logo",
      html: "<p>check the &lt;b&gt;footer&lt;/b&gt; &amp; logo</p>",
    });
  });

  it("a message is built once, and again only when its comment is edited or a run reads it", async () => {
    const t = setUp();
    const i = t.f.issue({ title: "one ask" });
    const c = t.f.comment(i.number, "make it faster", { login: OWNER });
    c.html = "<p>make it faster</p>";
    // Each read past the edge's 5 seconds of memory, as an open thread's refreshes are.
    const mine = async () => {
      t.f.later(10_000);
      const thread = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
      return thread.messages.find((m: { id: number }) => m.id === c.id);
    };
    expect(await mine()).toMatchObject({ html: "<p>make it faster</p>" });
    // GitHub moves a comment's edit time with its words: the same time is the same message.
    c.html = "<p>not read again</p>";
    expect((await mine()).html).toBe("<p>make it faster</p>");
    // A run's 👀 doesn't move the edit time, and still shows.
    c.reactions.push({ content: "eyes", user: { login: "github-actions[bot]", type: "Bot" } });
    expect((await mine()).read).toBe(true);
    Object.assign(c, {
      html: "<p>make it much faster</p>",
      updated_at: new Date(t.f.w.at).toISOString(),
    });
    expect((await mine()).html).toBe("<p>make it much faster</p>");
  });

  it("a long thread: the newest page first, and ?page= reads an older one", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "long00001", words: "a long one" });
    for (let i = 0; i < 130; i++) t.f.w.comments.push(t.f.comment(1, `note ${i}`, RUN));
    const newest = await (await t.call("/admin/chat/api/task/1")).json();
    expect(newest.earlier).toBe(true);
    expect(newest.page).toBeGreaterThan(1);
    const older = await (await t.call("/admin/chat/api/task/1?page=1")).json();
    expect(older).toMatchObject({ earlier: false, page: 1 });
    expect(older.messages[0].md).toBe("a long one");
    const ids = new Set(newest.messages.map((m: { id: number }) => m.id));
    expect(older.messages.some((m: { id: number }) => ids.has(m.id))).toBe(false);
    expect((await t.call("/admin/chat/api/task/1?page=0")).status).toBe(400);
    expect((await t.call("/admin/chat/api/task/1?page=9")).status).toBe(200);
  });

  it("a long thread still shows its run and model: the status comment is on page 1, read too", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "long00002", words: "a long one" });
    const use = { agent: "claude", model: "opus", label: "Opus" };
    t.f.comment(
      1,
      `<!-- shipify-task ${JSON.stringify({ v: 2, working: 77, use })} -->\nWorking on it.`,
      RUN,
    );
    for (let i = 0; i < 130; i++) t.f.w.comments.push(t.f.comment(1, `note ${i}`, RUN));
    const newest = await (await t.call("/admin/chat/api/task/1")).json();
    expect(newest.page).toBeGreaterThan(1);
    expect(newest.task.running).toMatchObject({ n: 1, queued: false });
    expect(newest.task.running.url).toMatch(/\/actions\/runs\/77$/);
    expect(newest.task.model).toBe("opus");
    // Never shown as a message, on any page.
    const older = await (await t.call("/admin/chat/api/task/1?page=1")).json();
    expect(older.messages.some((m: { md?: string }) => m.md?.includes("shipify-task"))).toBe(false);
  });

  it("the list: shipify's open PRs for review, with their task; 50 at a time, without rendered bodies", async () => {
    const t = setUp();
    for (let i = 0; i < 55; i++) t.f.issue({ title: `task ${i}`, user: { login: "owner" } });
    t.f.issue({
      title: "The chat as a cockpit",
      body: "What changed.\n\nCloses o/shipify#3",
      user: { login: "shipify-bot[bot]", type: "Bot" },
      pull_request: { merged_at: null },
    });
    const asked: [string, string][] = [];
    const fetch = t.f.deps.fetch;
    t.f.deps.fetch = (input, init = {}) => {
      asked.push([String(input), new Headers(init.headers).get("accept") ?? ""]);
      return fetch(input, init);
    };
    const first = await (await t.call("/admin/chat/api/list")).json();
    expect(first).toMatchObject({ page: 1, more: true });
    // The listing asks for no rendered bodies: it shows none.
    const listing = asked.find(([u]) => u.includes("/issues?state=open"));
    expect(listing?.[1]).toBe("application/vnd.github+json");
    expect(first.review).toEqual([
      expect.objectContaining({ n: 56, title: "The chat as a cockpit", task: 3 }),
    ]);
    expect(first.tasks.some((x: { n: number }) => x.n === 56)).toBe(false);
    const older = await (await t.call("/admin/chat/api/list?page=2")).json();
    expect(older).toMatchObject({ page: 2, more: false, review: [], running: [], boxes: [] });
    expect(older.tasks.map((x: { n: number }) => x.n)).toEqual([6, 5, 4, 3, 2, 1]);
    expect((await t.call("/admin/chat/api/list?page=0")).status).toBe(400);
  });

  it("the list is the open tasks; ?closed=1 reads the closed ones, only their tasks", async () => {
    const t = setUp();
    t.f.issue({ title: "still going", user: { login: "owner" } });
    t.f.issue({ title: "done with", user: { login: "owner" }, state: "closed" });
    const open = await (await t.call("/admin/chat/api/list")).json();
    expect(open).toMatchObject({ closed: false });
    expect(open.tasks.map((x: { title: string }) => x.title)).toEqual(["still going"]);
    const shut = await (await t.call("/admin/chat/api/list?closed=1")).json();
    expect(shut).toMatchObject({ closed: true, page: 1, review: [], running: [], boxes: [] });
    expect(shut.tasks.map((x: { title: string; state: string }) => [x.title, x.state])).toEqual([
      ["done with", "closed"],
    ]);
  });

  it("a task's model: its status comment's choice, a `use` said since, and the same on a poll for what's newer", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "model0001", words: "make it faster" });
    const status = (use: unknown) =>
      `<!-- shipify-task ${JSON.stringify({ v: 2, working: 77, ...(use ? { use } : {}) })} -->\nWorking on it.`;
    const s = t.f.comment(
      1,
      status({ agent: "claude", model: "opus", effort: "high", label: "Opus · high" }),
      RUN,
    );
    t.f.later(60_000);
    const at = new Date(t.f.w.at).toISOString();
    t.f.later(60_000);
    t.f.reply(
      1,
      replyLine({
        v: 1,
        kind: "answer",
        state: "Done",
        title: "x",
        links: [],
        to: ["web:me"],
        key: "k",
      }),
    );
    const read = async (q = "") =>
      (await (await t.call(`/admin/chat/api/task/1${q}`)).json()).task.model;
    expect(await read()).toBe("opus high");
    // While a run goes the page asks only for what's newer: the model is still the task's.
    t.f.later(10_000);
    expect(await read(`?since=${encodeURIComponent(at)}`)).toBe("opus high");
    // A `use` you said after the status comment was written wins, until a run reads it.
    t.f.later(10_000);
    await t.post("/admin/chat/api/send", { id: "model0002", task: 1, words: "use sonnet low" });
    t.f.later(10_000);
    expect(await read()).toBe("sonnet low");
    // Read by a run since, the status comment says: Auto now.
    s.body = status({ agent: "claude", label: "Auto" });
    s.updated_at = new Date(t.f.w.at + 1000).toISOString();
    t.f.later(10_000);
    expect(await read()).toBeUndefined();
  });

  it("a photo you sent on Telegram shows here: fetched through Telegram, inline, never kept", async () => {
    const t = setUp();
    const from = fromLine({
      v: 1,
      person: "owner",
      channel: "telegram",
      chat: "4242",
      id: "9",
      files: [
        { name: "photo.jpg", ref: "telegram:AgACAgQ", type: "image/jpeg" },
        { name: "notes.pdf", ref: "telegram:BQACAgQ", type: "application/pdf" },
      ],
    });
    t.f.issue({
      title: "look at this",
      body: `${from}\nlook at this\n\n📎 photo.jpg`,
      user: { login: DOOR, type: "Bot" },
      performed_via_github_app: { id: APP_ID },
    });
    const thread = await (await t.call("/admin/chat/api/task/1")).json();
    const [photo, pdf] = thread.messages[0].files;
    expect(photo).toEqual({
      name: "photo.jpg",
      type: "image/jpeg",
      src: "api/sent/telegram%3AAgACAgQ?type=image%2Fjpeg",
    });
    expect(pdf.src).toBe("api/sent/telegram%3ABQACAgQ");
    const pic = await t.call(`/admin/chat/${photo.src}`);
    expect(pic.status).toBe(200);
    expect(await pic.text()).toBe("bytes");
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
    expect(pic.headers.get("content-disposition")).toMatch(/^inline/);
    expect(pic.headers.get("content-security-policy")).toContain("sandbox");
    expect(t.f.w.sent.find((x) => x.method === "getFile")?.body).toEqual({ file_id: "AgACAgQ" });
    const doc = await t.call(`/admin/chat/${pdf.src}`);
    expect(doc.headers.get("content-type")).toBe("application/octet-stream");
    expect(doc.headers.get("content-disposition")).toMatch(/^attachment/);
    // A type that isn't a picture's downloads; another chat's, or none, isn't here.
    const odd = await t.call("/admin/chat/api/sent/telegram%3AAgACAgQ?type=text%2Fhtml");
    expect(odd.headers.get("content-type")).toBe("application/octet-stream");
    for (const ref of ["web%3Aup-abc", "nope%3Ax", "AgACAgQ", "telegram%3Anot%20a%20ref!"])
      expect((await t.call(`/admin/chat/api/sent/${ref}`)).status).toBeGreaterThanOrEqual(400);
    expect((await t.call(`/admin/chat/${photo.src}`, {}, false)).status).toBe(403);
  });

  it("a PR reads as a thread to review: its description, its task, and no words from here", async () => {
    const t = setUp();
    t.f.issue({ title: "a task", user: { login: "owner" } });
    t.f.issue({
      title: "The chat as a cockpit",
      body: "## What changed\n\nReopen from the chat.\n\nCloses o/shipify#1",
      user: { login: "shipify-bot[bot]", type: "Bot" },
      pull_request: { merged_at: null },
    });
    const pr = await (await t.call("/admin/chat/api/task/2")).json();
    expect(pr.task).toMatchObject({ n: 2, pr: "open", for: 1, open: true });
    expect(pr.writable).toBe(false);
    expect(pr.messages[0].md).toContain("Reopen from the chat.");
  });

  it("menu, repeats, notebook and setup answer in their shapes, with nothing secret", async () => {
    const t = setUp();
    for (const route of ["menu", "repeats", "notebook", "setup", "files"]) {
      const res = await t.call(`/admin/chat/api/${route}`);
      expect(res.status, route).toBe(200);
      expect((await res.json()).v).toBe(1);
    }
    const menu = await (await t.call("/admin/chat/api/menu")).json();
    expect(menu.models.map((m: { id: string }) => m.id)).toContain("opus");
    // Each agent with its own models and Auto (executors.json's, without what they share).
    expect(menu.agents.map((a: { id: string }) => a.id)).toEqual(
      Object.keys(readExecutors(join(ROOT, "executors.json")).executors),
    );
    const pi = menu.agents.find((a: { id: string }) => a.id === "pi");
    expect(pi).toMatchObject({
      gateway: "openrouter",
      efforts: ["off", "low", "medium", "high", "max"],
      auto: { model: "z-ai/glm-5.3-flash" },
    });
    expect(pi.models.map((m: { id: string }) => m.id)).toContain("z-ai/glm-5.3");
    // An agent through another gateway: under its first's tab, its models the agent's efforts,
    // which the picker narrows to each model's own as the gateway's catalog says.
    const vercel = menu.agents.find((a: { id: string }) => a.id === "pi-vercel");
    expect(vercel).toMatchObject({ gateway: "vercel-ai-gateway", of: "pi", via: "Vercel" });
    expect(vercel.models[0].efforts).toEqual(pi.efforts);
    // An agent's name for people reaches the chip and Who thinks (OpenCode, not Opencode).
    expect(menu.agents.find((a: { id: string }) => a.id === "opencode")?.name).toBe("OpenCode");
    expect(menu.files).toEqual({ on: true, most: 5, bytes: 10 * 1024 * 1024 });
    // "Change a repo" offers the record's repos (ADR 0047): none read yet here.
    expect(menu.repos).toEqual([]);
    // The repeat form's zone is your copy's variable as it is now, the deployed one only until set.
    expect(menu.repeat.zone).toBe("IST");
    // The default is the repo variable's agent, the first in the menu, so the chip says what runs.
    expect(menu.agents[0].id).toBe("claude");
    clearCaches();
    t.f.w.variables.SHIPIFY_AGENT = "pi-vercel";
    const moved = await (await t.call("/admin/chat/api/menu")).json();
    expect(moved.agents[0].id).toBe("pi-vercel");
    expect(moved.auto.model).toBe("zai/glm-5.3-flash");
    delete t.f.w.variables.SHIPIFY_AGENT;
    clearCaches();
    t.f.w.variables.SHIPIFY_TIME_ZONE = "Europe/London";
    expect((await (await t.call("/admin/chat/api/menu")).json()).repeat.zone).toBe("BST");
    const got = await (await t.call("/admin/chat/api/setup")).json();
    // Tools are what a run uses; the chats (a door is their way in) are under Chats.
    expect(got.tools.map((x: { id: string }) => x.id)).toEqual(["notion"]);
    const setup = JSON.stringify(got);
    expect(setup).not.toContain("PRIVATE KEY");
    expect(setup).not.toContain("4242");
  });

  it("searches an agent's gateway for the chip: ids its use line takes, no key, kept 10 minutes", async () => {
    clearCaches();
    const t = setUp();
    const list = "https://openrouter.ai/api/v1/models";
    const search = (q: string, agent = "pi") =>
      t.call(`/admin/chat/api/models?agent=${agent}&q=${encodeURIComponent(q)}`);
    t.f.w.apps[list] = {
      body: {
        data: [
          { id: "moonshotai/kimi-k3", pricing: { prompt: "0.00000069", completion: "0.000015" } },
          { id: "~moonshotai/kimi-latest" },
          {
            id: "x/kimi-free:free",
            pricing: { prompt: "0", completion: "0" },
            context_length: 9e5,
          },
        ],
      },
    };
    const res = await search("Kimi");
    expect(res.headers.get("etag")).toBeNull();
    expect(await res.json()).toEqual({
      v: 1,
      models: [
        { id: "moonshotai/kimi-k3", price: [0.69, 15] },
        { id: "x/kimi-free:free", price: [0, 0], context: 9e5 },
      ],
    });
    const asked = () => t.f.w.calls.filter((c) => c.includes("openrouter"));
    expect(asked()).toEqual([
      "GET openrouter.ai/api/v1/models?supported_parameters=tools&limit=20&q=kimi",
    ]);
    // The same words again: kept, not asked again.
    expect((await search("kimi")).status).toBe(200);
    expect(asked()).toHaveLength(1);
    // A word too short, an agent with no gateway, one that isn't there.
    expect((await search("k")).status).toBe(400);
    expect((await search("kimi", "claude")).status).toBe(404);
    expect((await search("kimi", "nope")).status).toBe(404);
    // A gateway that doesn't answer: said, and not kept.
    t.f.w.apps[list] = { status: 502 };
    const down = await search("glm");
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ error: "Couldn't read openrouter's list just now." });
    t.f.w.apps[list] = { body: { data: [{ id: "z-ai/glm-5.3" }] } };
    expect(await (await search("glm")).json()).toEqual({ v: 1, models: [{ id: "z-ai/glm-5.3" }] });
    // No word: the agent's listed models, each found by its id with its facts; kept a day, so a
    // second look reads nothing.
    t.f.w.apps[list] = {
      body: {
        data: [
          { id: "z-ai/glm-5.3-flashx" },
          {
            id: "z-ai/glm-5.3-flash",
            name: "Z.ai: GLM 5.3 Flash",
            pricing: { prompt: "0.00000015", completion: "0.0000005" },
          },
        ],
      },
    };
    const listed = async () =>
      (await (await t.call("/admin/chat/api/models?agent=pi")).json()).models;
    const before = asked().length;
    expect(await listed()).toEqual([
      { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", maker: "Z.ai", price: [0.15, 0.5] },
    ]);
    const looked = asked().length - before;
    expect(looked).toBe(readExecutors(join(ROOT, "executors.json")).executors.pi?.models?.length);
    await listed();
    expect(asked().length - before).toBe(looked);
  });

  it("a gateway with its list whole (Vercel's): searched here from one read; its listed models each by its own small answer", async () => {
    clearCaches();
    const t = setUp();
    const list = "https://ai-gateway.vercel.sh/v1/models";
    const model = (id: string, name: string, input: string) => ({
      id,
      name,
      type: "language",
      tags: ["tool-use"],
      zdr: "some",
      pricing: { input, output: input },
    });
    const flash = model("zai/glm-5.3-flash", "GLM 5.3 Flash", "0");
    t.f.w.apps[list] = {
      body: {
        data: [
          model("moonshotai/kimi-k3", "Kimi K3", "0.000003"),
          model("zai/glm-5.3", "GLM 5.3", "0.000001"),
          flash,
          { ...model("x/kimi-image", "Kimi image", "0.1"), type: "image" },
        ],
      },
    };
    // Each listed model's own answer (`list.model`), as a run reads it too.
    const listedIds =
      readExecutors(join(ROOT, "executors.json")).executors["pi-vercel"]?.models ?? [];
    for (const id of listedIds)
      t.f.w.apps[`${list}/${id}`] = { body: id === flash.id ? flash : model(id, id, "0.000001") };
    const asked = () => t.f.w.calls.filter((c) => c.includes("vercel.sh"));
    const call = async (q: string) =>
      (await (await t.call(`/admin/chat/api/models?agent=pi-vercel&q=${q}`)).json()).models;
    // The picker opening: each listed model looked up by itself, kept a day.
    const open = async () =>
      (await (await t.call("/admin/chat/api/models?agent=pi-vercel")).json()).models;
    expect((await open()).map((m: { id: string }) => m.id)).toEqual(listedIds);
    expect((await open())[0]).toEqual(
      expect.objectContaining({ id: "zai/glm-5.3-flash", name: "GLM 5.3 Flash", price: [0, 0] }),
    );
    const looked = asked().length;
    expect(asked()).toContain("GET ai-gateway.vercel.sh/v1/models/zai/glm-5.3-flash");
    expect(asked()).not.toContain("GET ai-gateway.vercel.sh/v1/models");
    await open();
    expect(asked()).toHaveLength(looked);
    // A word, and another: one read of the whole list, searched here.
    expect((await call("kimi")).map((m: { id: string }) => m.id)).toEqual(["moonshotai/kimi-k3"]);
    expect((await call("glm")).map((m: { id: string }) => m.id)).toEqual([
      "zai/glm-5.3",
      "zai/glm-5.3-flash",
    ]);
    expect(asked().filter((c) => c.endsWith("/v1/models"))).toHaveLength(1);
    // Kept 10 minutes: then read again.
    t.f.later(11 * 60_000);
    await call("kimi");
    expect(asked().filter((c) => c.endsWith("/v1/models"))).toHaveLength(2);
  });

  it("setup: each gateway, and since when its key is set (SHIPIFY_GATEWAYS, from `ship add`)", async () => {
    const t = setUp();
    const before = await (await t.call("/admin/chat/api/setup")).json();
    expect(before.gateways.map((g: { id: string }) => g.id)).toEqual([
      "openrouter",
      "vercel-ai-gateway",
    ]);
    expect(before.gateways[0].since).toBeUndefined();
    clearCaches();
    t.f.w.variables.SHIPIFY_GATEWAYS = JSON.stringify({ openrouter: "2026-10-06" });
    const after = await (await t.call("/admin/chat/api/setup")).json();
    expect(after.gateways[0]).toMatchObject({ id: "openrouter", since: "2026-10-06" });
  });

  it("setup: the watch's view and each box's health and console, from reads it already makes", async () => {
    const t = setUp();
    t.f.w.variables.SHIPIFY_CONSOLES = JSON.stringify({
      pi: "https://pi.tail1.ts.net",
      other: "javascript:alert(1)",
    });
    const record = {
      v: 2,
      watch: { last: "2026-10-04T11:55:00Z", next: "2026-10-04T13:00:00Z" },
      boxes: {
        pi: {
          at: "2026-10-04T11:50:00Z",
          facts: [{ name: "disk", look: "91% full" }, { name: "temperature" }],
        },
      },
      events: Array.from({ length: 7 }, (_, i) => ({
        at: "2026-10-04T11:00:00Z",
        text: `event ${i}`,
      })),
    };
    t.f.issue({
      title: "Shipify status",
      body: `${STATUS_MARK}${JSON.stringify(record)} -->`,
      labels: ["shipify-status"],
    });
    const setup = await (await t.call("/admin/chat/api/setup")).json();
    expect(setup.boxes[0]).toMatchObject({
      name: "pi",
      look: ["disk: 91% full"],
      at: "2026-10-04T11:50:00Z",
      console: "https://pi.tail1.ts.net",
    });
    expect(setup.watch.last).toBe("2026-10-04T11:55:00Z");
    expect(setup.watch.next).toBe("2026-10-04T13:00:00Z");
    expect(setup.watch.events.map((e: { text: string }) => e.text)).toEqual([
      "event 0",
      "event 1",
      "event 2",
      "event 3",
      "event 4",
    ]);
    expect(JSON.stringify(setup)).not.toContain("javascript:");
  });
});

describe("notifications (ADR 0050)", () => {
  const on = async (t: ReturnType<typeof setUp>, endpoint?: string) =>
    t.post("/admin/chat/api/push", { on: (await browser(endpoint)).subscription });
  const ids = async (r: Response) =>
    ((await r.json()).devices as { id: string; service: string }[]).map((d) => d.service);

  it("the menu has the key only when the edge has one, and Setup lists the devices", async () => {
    const t = setUp();
    expect((await (await t.call("/admin/chat/api/menu")).json()).notifications).toBeUndefined();
    expect((await (await t.call("/admin/chat/api/setup")).json()).devices).toBeUndefined();
    expect((await on(t)).status).toBe(409);
    t.env.WEB_PUSH_KEY = pushKey();
    const menu = await (await t.call("/admin/chat/api/menu")).json();
    expect(Buffer.from(menu.notifications.key, "base64url")).toHaveLength(65);
    expect((await on(t)).status).toBe(200);
    const setup = await (await t.call("/admin/chat/api/setup")).json();
    expect(setup.devices).toEqual([
      { id: expect.stringMatching(/^[0-9a-f]{8}$/), service: "Google", since: expect.any(String) },
    ]);
    // Only a short id: never the device's address.
    expect(JSON.stringify(setup)).not.toContain("fcm.googleapis.com");
  });

  it("turns on a device, keeps it once, and turns it off by its address", async () => {
    const t = setUp();
    t.env.WEB_PUSH_KEY = pushKey();
    const b = await browser("https://web.push.apple.com/QGxyz");
    const sub = { on: b.subscription };
    expect(await ids(await t.post("/admin/chat/api/push", sub))).toEqual(["Apple"]);
    const writes = t.store.state.puts;
    // The same again (the page opening): no write.
    expect(await ids(await t.post("/admin/chat/api/push", sub))).toEqual(["Apple"]);
    expect(t.store.state.puts).toBe(writes);
    const off = await t.post("/admin/chat/api/push", { off: b.subscription.endpoint });
    expect(await ids(off)).toEqual([]);
    expect(t.store.items.get("push:web:me")?.bytes).toEqual(new TextEncoder().encode("[]"));
  });

  it("keeps 5 devices: a sixth replaces the oldest", async () => {
    const t = setUp();
    t.env.WEB_PUSH_KEY = pushKey();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      t.f.later(1_000);
      await on(t, `https://fcm.googleapis.com/fcm/send/d${n}`);
    }
    const kept = JSON.parse(new TextDecoder().decode(t.store.items.get("push:web:me")?.bytes));
    expect(kept.map((d: { endpoint: string }) => d.endpoint.slice(-2))).toEqual([
      "d2",
      "d3",
      "d4",
      "d5",
      "d6",
    ]);
  });

  it("refuses a device on another address, a POST from elsewhere, and anyone not signed in", async () => {
    const t = setUp();
    t.env.WEB_PUSH_KEY = pushKey();
    const evil = await browser("https://evil.example.com/push/1");
    expect((await t.post("/admin/chat/api/push", { on: evil.subscription })).status).toBe(400);
    expect((await t.post("/admin/chat/api/push", { on: "x", off: "y" })).status).toBe(400);
    const good = { on: (await browser()).subscription };
    const foreign = await t.post("/admin/chat/api/push", good, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    const unsigned = await t.call(
      "/admin/chat/api/push",
      {
        method: "POST",
        headers: { origin: ORIGIN, "x-shipify-chat": "1", "content-type": "application/json" },
        body: JSON.stringify(good),
      },
      false,
    );
    expect(unsigned.status).toBe(403);
    expect(t.store.items.has("push:web:me")).toBe(false);
  });

  it("an alert with no task says its first sentence and opens the chat", async () => {
    const t = setUp();
    t.env.WEB_PUSH_KEY = pushKey();
    const b = await browser();
    await t.post("/admin/chat/api/push", { on: b.subscription });
    const got: Uint8Array[] = [];
    const deps = {
      ...t.f.deps,
      fetch: async (_: string, init?: RequestInit) => {
        got.push(new Uint8Array(init?.body as Uint8Array));
        return new Response(null, { status: 201 });
      },
    };
    const said = alertOf("The door App's key was refused.", "Run pnpm ship door setup --new.");
    await web.send(t.env, deps, "me", said);
    expect(JSON.parse(await b.read(got[0] as Uint8Array)).notification).toEqual({
      title: "Alert",
      body: "The door App's key was refused.",
      navigate: `${ORIGIN}/admin/chat/`,
      tag: "alert",
      renotify: true,
      lang: "en",
    });
  });

  it("a share that reaches the edge (no worker yet) opens New chat", async () => {
    const t = setUp();
    const res = await t.call("/admin/chat/share", { method: "POST", body: new FormData() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/chat/#/new`);
  });
});

describe("a new repeat from the page", () => {
  const forms = loadForms(join(ROOT, ".github/ISSUE_TEMPLATE"));
  it("is written under the Repeat form's headings, so the core sets it up with no agent", async () => {
    const t = setUp();
    for (const [i, a] of [
      {
        what: "Look at the servers",
        when: "every day at 09:00",
        kind: "A reminder (posts the text; no agent)",
      },
      {
        what: "Update spotter's deps",
        when: "every Monday at 9",
        kind: "A job for the agent (quiet when there's nothing to do)",
        model: "pi-vercel",
      },
      {
        what: "The price",
        when: "every hour",
        kind: "A check (a script from checks/; says only what changed; no agent)",
        check: "price-watch",
      },
    ].entries()) {
      const res = await t.post("/admin/chat/api/repeat", { id: `repeat000${i}`, ...a });
      expect(res.status).toBe(200);
      const issue = t.f.w.issues[i];
      expect(issue?.title).toBe(`repeat: ${a.what}`);
      const read = taskForm(withoutLine(issue?.body), forms);
      expect(read?.problems).toEqual([]);
      expect(repeatForm(read)).toMatchObject({
        what: a.what,
        when: a.when,
        kind: ["reminder", "agent", "check"][i],
        ...(a.check ? { check: a.check } : {}),
      });
    }
  });

  it("an answer the core won't take is refused before anything is written", async () => {
    const t = setUp();
    const res = await t.post("/admin/chat/api/repeat", {
      id: "repeat0009",
      what: "x",
      when: "whenever",
      kind: "A reminder (posts the text; no agent)",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("whenever");
    expect(t.f.w.issues).toHaveLength(0);
  });
});
