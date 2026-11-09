// The web chat's routes (edge/src/web/routes.ts, ADR 0036), through the edge's own handler, in the
// fake world: the status page's sign-in on every route, posts only from the page itself, your words
// into the door as the `web` channel (once, files as an album, `use` lines, the door's answers),
// files kept and served safely, and reads in the shapes the page knows.
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  fileRefOf,
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
import type { Bucket, Env } from "../../../edge/src/env.ts";
import { COPY_STEP, MOVED, moveFromKv } from "../../../edge/src/store.ts";
import { clearSeen } from "../../../edge/src/web/gh.ts";
import { clearBuilt, INBOX_FULL, nextStep } from "../../../edge/src/web/reads.ts";
import { MERMAID, PDFJS } from "../../../edge/src/web/routes.ts";
import { ROOT } from "../../helpers.ts";
import { browser, pushKey } from "../browser.ts";
import {
  APP_ID,
  DOOR,
  envFor,
  type Issue,
  type Keys,
  keys,
  ORIGIN,
  OWNER,
  REPO,
  RUN,
  runToken,
  world,
} from "../fake.ts";
import { memoryKv } from "../kv.ts";
import { memoryR2 } from "../r2.ts";

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
/** The page's files' tag and time, as Workers static assets answer them. */
const TAG = '"v1"';
const MODIFIED = "Sun, 04 Oct 2026 10:00:00 GMT";

function setUp() {
  clearCaches();
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
    fetch: async (r: Request) => {
      if (
        ![
          "/admin/chat/index.html",
          "/draw/index.html",
          "/draw/draw.js",
          "/pdf/index.html",
          "/pdf/pdf.js",
          "/note/icon.png",
          "/note/badge.png",
        ].includes(new URL(r.url).pathname)
      )
        return new Response("nope", { status: 404 });
      const headers = { "content-type": "text/html", etag: TAG, "last-modified": MODIFIED };
      // The browser's copy unchanged: its tag, or with none its time.
      const tag = r.headers.get("if-none-match");
      if (tag === TAG || (!tag && r.headers.get("if-modified-since") === MODIFIED))
        return new Response(null, { status: 304, headers });
      return new Response(PAGE, { headers });
    },
  };
  const r2 = memoryR2();
  const env = envFor(k, {
    FILES: store.kv,
    BUCKET: r2.bucket,
    ASSETS: assets,
  } as unknown as Partial<Env>);
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
  // As a browser sends a file: its length said first.
  const upload = (name: string, type: string, bytes: string, task?: number) =>
    call("/admin/chat/api/file", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "x-shipify-chat": "1",
        "content-type": type,
        "content-length": String(Buffer.byteLength(bytes)),
        "x-file-name": encodeURIComponent(name),
        ...(task ? { "x-file-task": String(task) } : {}),
      },
      body: bytes,
    });
  const remove = (ref: string, more: Record<string, string> = {}) =>
    call(`/admin/chat/api/file/${ref}`, {
      method: "DELETE",
      headers: { origin: ORIGIN, "x-shipify-chat": "1", ...more },
    });
  return { f, env, store, r2, call, post, upload, remove };
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

  it("the page's files unchanged are a 304 with no body, still with the page's headers", async () => {
    const t = setUp();
    const first = await t.call("/admin/chat");
    expect(first.headers.get("etag")).toBe(TAG);
    const asks: Record<string, string>[] = [
      { "if-none-match": TAG },
      { "if-modified-since": MODIFIED },
    ];
    for (const headers of asks) {
      const again = await t.call("/admin/chat", { headers });
      expect(again.status).toBe(304);
      expect(await again.text()).toBe("");
      expect(again.headers.get("cache-control")).toBe("private, no-cache");
      expect(again.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(again.headers.get("x-content-type-options")).toBe("nosniff");
    }
    // Changed since: the whole file. A HEAD has no body either way.
    const changed = await t.call("/admin/chat", { headers: { "if-none-match": '"v0"' } });
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe(PAGE);
    const head = await t.call("/admin/chat", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("/admin sends you to the chat; / with no sign-in is a page; nothing else moves", async () => {
    const t = setUp();
    const to = async (path: string, method = "GET") =>
      (await t.call(path, { method, redirect: "manual" }, false)).headers.get("location");
    expect(await to("/")).toBeNull();
    expect((await t.call("/", {}, false)).status).toBe(200);
    expect((await t.call("/", { method: "POST" }, false)).status).toBe(404);
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

  it("the PDF frame is a static page outside the sign-in, with only pdf.js and its own script", async () => {
    const t = setUp();
    for (const path of ["/pdf/", "/pdf/pdf.js"]) {
      const res = await t.call(path, {}, false);
      expect(res.status, path).toBe(200);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain(`script-src ${ORIGIN}/pdf/pdf.js ${PDFJS} 'wasm-unsafe-eval';`);
      expect(csp).toContain(`connect-src ${PDFJS};`);
      expect(csp).toContain(`frame-ancestors ${ORIGIN}`);
      expect(csp).not.toMatch(/'unsafe-eval'|worker-src|'self'/);
    }
    expect(t.f.w.issues).toHaveLength(0);
    expect((await t.call("/pdf/other.js", {}, false)).status).toBe(404);
    expect((await t.call("/pdf/", { method: "POST" }, false)).status).toBe(404);
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

  it("names the commit deployed in its version, so an open page sees each deploy", async () => {
    const t = setUp();
    t.env.GIT_SHA = "5ee981611347a38ef0ebcbab7491bdf63340db0a";
    for (const path of ["/admin/chat/api/list", "/admin/chat/api/menu"]) {
      const res = await t.call(path);
      expect(res.status, path).toBe(200);
      expect((await res.json()).version, path).toMatch(/^\d+\.\d+\.\d+\+5ee9816$/);
    }
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

  it("a button's word (Stop, Close, Reopen, Stop repeating) is marked, and its thread hides it; a typed one shows (ADR 0069)", async () => {
    const t = setUp();
    const i = t.f.issue({ title: "a task", user: { login: "owner" } });
    const send = (id: string, words: string, button?: true) =>
      t.post("/admin/chat/api/send", { id, task: i.number, words, ...(button ? { button } : {}) });
    expect((await send("msg00000031", "stop", true)).status).toBe(200);
    expect((await send("msg00000032", "close", true)).status).toBe(200);
    const froms = t.f.w.comments.map((c) => readFrom(c.body));
    expect(froms.map((f) => f?.button)).toEqual([true, true]);
    // Close is still the door's at once, and written as a setting: no run answers it.
    expect(froms[1]?.setting).toBe(true);
    expect(i.state).toBe("closed");
    t.f.later(10_000);
    const closed = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
    expect(
      closed.messages.filter((m: { tap?: true }) => m.tap).map((m: { md: string }) => m.md),
    ).toEqual(["stop", "close"]);
    // The thread shows the close from the issue's own state.
    expect(closed.task).toMatchObject({ open: false, closed: i.closed_at });
    await send("msg00000033", "reopen");
    expect(readFrom(t.f.w.comments.at(-1)?.body)?.button).toBeUndefined();
    t.f.later(10_000);
    const open = await (await t.call(`/admin/chat/api/task/${i.number}`)).json();
    expect(open.task.open).toBe(true);
    expect(open.task.closed).toBeUndefined();
    expect(open.messages.at(-1)).toMatchObject({ md: "reopen" });
    expect(open.messages.at(-1).tap).toBeUndefined();
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
  it("pictures show inline; anything else downloads, never sniffed; kept past 7 days", async () => {
    const t = setUp();
    const png = await (await t.upload("shot.png", "image/png", "png")).json();
    const svg = await (await t.upload("evil.svg", "image/svg+xml", "<svg onload=x>")).json();
    const a = await t.call(`/admin/chat/api/file/${png.ref}`);
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(a.headers.get("content-disposition")).toMatch(/^inline/);
    expect(await a.text()).toBe("png");
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
    // R2 keeps a file as long as its chat (ADR 0069): no 7 days.
    t.f.later(8 * 86_400_000);
    expect((await t.call(`/admin/chat/api/file/${png.ref}`)).status).toBe(200);
  });

  it("keeps a file in R2 with its chat's number; Files lists the newest first, each size, the total", async () => {
    const t = setUp();
    const a = await (await t.upload("a.png", "image/png", "aaa", 12)).json();
    expect(a.ref).toMatch(/^f-\d{13}-[a-z0-9]{32}$/);
    t.f.later(60_000);
    const b = await (await t.upload("b.txt", "text/plain", "bbbbb")).json();
    // A ref is its key: the newer one sorts first, as R2 lists them.
    expect(b.ref < a.ref).toBe(true);
    expect(t.r2.items.get(a.ref)?.meta).toMatchObject({ name: "a.png", task: "12", by: "you" });
    expect(t.r2.items.get(b.ref)?.meta.task).toBeUndefined();
    const listed = await (await t.call("/admin/chat/api/files")).json();
    expect(listed).toMatchObject({ v: 1, count: 2, bytes: 8 });
    expect(listed.files.map((f: { name: string }) => f.name)).toEqual(["b.txt", "a.png"]);
    expect(listed.files[1]).toMatchObject({ task: 12, size: 3, by: "you" });
    expect(listed.files[0].task).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain("until");
  });

  it("streams a 95 MB file into R2; over 95 MB, or with no length said, is refused", async () => {
    const t = setUp();
    // As the page counts them (compose.js): 1 MB is 1,000,000 bytes. 95 of them leave room under the
    // 100 MB Cloudflare takes in a request (either count) before the Worker runs.
    const MB = 1_000_000;
    const chunk = new Uint8Array(MB);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 95) c.enqueue(chunk);
        else c.close();
      },
    });
    const res = await t.call("/admin/chat/api/file", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "x-shipify-chat": "1",
        "content-type": "video/mp4",
        "content-length": String(95 * MB),
        "x-file-name": "talk.mp4",
      },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(200);
    const { ref } = await res.json();
    expect(t.r2.items.get(ref)?.bytes.byteLength).toBe(95 * MB);
    expect(95 * MB).toBeLessThan(100 * 1000 * 1000);
    const over = await t.call("/admin/chat/api/file", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "x-shipify-chat": "1",
        "content-length": String(95 * MB + 1),
      },
      body: "x",
    });
    expect(over.status).toBe(413);
    expect((await over.json()).error).toBe("That file is over 95 MB.");
    const unsaid = await t.call("/admin/chat/api/file", {
      method: "POST",
      headers: { origin: ORIGIN, "x-shipify-chat": "1" },
      body: new Blob(["x"]).stream(),
      duplex: "half",
    } as RequestInit);
    expect(unsaid.status).toBe(411);
    expect([...t.r2.items.keys()].filter((k) => k.startsWith("f-"))).toEqual([ref]);
  });

  it("a new chat's files get its number once the door opens it", async () => {
    const t = setUp();
    const up = await (await t.upload("plan.pdf", "application/pdf", "%PDF")).json();
    const sent = await (
      await t.post("/admin/chat/api/send", {
        id: "newchat001",
        words: "read this",
        files: [{ ref: up.ref, name: "plan.pdf", type: "application/pdf", size: 4 }],
      })
    ).json();
    expect(sent.task).toBe(1);
    // The same file, its ref unchanged on the from-line, now with its chat.
    expect(readFrom(t.f.w.issues[0]?.body)?.files?.map((f) => f.ref)).toEqual([`web:${up.ref}`]);
    expect(t.r2.items.get(up.ref)?.meta.task).toBe("1");
    const listed = await (await t.call("/admin/chat/api/files")).json();
    expect(listed.files[0]).toMatchObject({ ref: up.ref, task: 1 });
  });

  it("an Inbox item's file is kept with its Inbox page, and the page isn't opened (ADR 0069)", async () => {
    const t = setUp();
    t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    const up = await (await t.upload("shot.png", "image/png", "png")).json();
    const sent = await (
      await t.post("/admin/chat/api/send", {
        id: "inbox00001",
        words: "add games: this engine",
        files: [{ ref: up.ref, name: "shot.png", type: "image/png", size: 3 }],
      })
    ).json();
    const inbox = t.f.w.issues.find((i) => i.title === "Notebook: games-inbox");
    expect(sent.text).toMatch(`Added to the games Inbox · #${inbox?.number}.`);
    expect(sent.task).toBeUndefined();
    expect(t.r2.items.get(up.ref)?.meta.task).toBe(String(inbox?.number));
  });

  it("a file from another chat is copied for this one; Delete deletes it, from the page only", async () => {
    const t = setUp();
    const task = t.f.issue({ title: "the other chat", user: { login: "owner" } });
    const theirs = await (await t.upload("a.png", "image/png", "png", 99)).json();
    const sent = await t.post("/admin/chat/api/send", {
      id: "copyfor001",
      task: task.number,
      words: "and this",
      files: [{ ref: theirs.ref, name: "a.png", type: "image/png", size: 3 }],
    });
    expect(sent.status).toBe(200);
    const refs = t.f.w.comments.flatMap((c) => readFrom(c.body)?.files?.map((x) => x.ref) ?? []);
    expect(refs).toHaveLength(1);
    const mine = refs[0]?.replace(/^web:/, "") ?? "";
    expect(mine).not.toBe(theirs.ref);
    expect(t.r2.items.get(mine)?.meta.task).toBe(String(task.number));
    expect(t.r2.items.get(theirs.ref)?.meta.task).toBe("99");
    // Only from the page: its origin and its header.
    expect((await t.remove(mine, { "x-shipify-chat": "0" })).status).toBe(403);
    expect((await t.remove("..%2Fetc")).status).toBe(404);
    expect((await t.remove(mine)).status).toBe(200);
    expect(t.r2.items.has(mine)).toBe(false);
    expect((await t.call(`/admin/chat/api/file/${mine}`)).status).toBe(410);
    const gone = await (await t.call(`/admin/chat/api/file/${mine}`)).json();
    expect(gone.error).toBe("That file is gone.");
    const listed = await (await t.call("/admin/chat/api/files")).json();
    expect(listed.files.map((f: { ref: string }) => f.ref)).toEqual([theirs.ref]);
  });

  it("the cron copies KV's files to R2 once: an old message's ref opens; devices stay in KV", async () => {
    const t = setUp();
    const meta = { name: "old.png", type: "image/png", size: 3, by: "you", at: t.f.w.at - 9e5 };
    const bytes = new TextEncoder().encode("old").buffer as ArrayBuffer;
    await t.store.kv.put("up-0123456789abcdef0123", bytes, {
      expirationTtl: 86_400,
      metadata: meta,
    });
    await t.store.kv.put("run-7-0123456789abcdef0123", bytes, {
      expirationTtl: 86_400,
      metadata: { ...meta, name: "made.md", by: "run" },
    });
    await t.store.kv.put("push:web:me", "[]");
    await moveFromKv(t.env, t.f.deps);
    const old = await t.call("/admin/chat/api/file/up-0123456789abcdef0123");
    expect(old.status).toBe(200);
    expect(await old.text()).toBe("old");
    expect(t.r2.items.get("run-7-0123456789abcdef0123")?.meta.task).toBe("7");
    expect(t.r2.items.get("up-0123456789abcdef0123")?.meta.task).toBeUndefined();
    expect(t.r2.items.has("push:web:me")).toBe(false);
    expect(t.r2.items.has("_moved-from-kv")).toBe(true);
    const listed = await (await t.call("/admin/chat/api/files")).json();
    expect(listed.count).toBe(2);
    // Once: a file put in KV after the copy isn't read.
    await t.store.kv.put("up-9999999999abcdef0123", bytes, { metadata: meta });
    await moveFromKv(t.env, t.f.deps);
    expect((await t.call("/admin/chat/api/file/up-9999999999abcdef0123")).status).toBe(410);
  });

  // A request that waited for a step of the copy took longer than the page's 20 s: a message with
  // a photo failed as "Offline", every try, while words alone went.
  it("nothing you do waits for KV's copy: an upload, a message with a file, its read, Files", async () => {
    const t = setUp();
    const meta = { name: "old.png", type: "image/png", size: 3, by: "you", at: t.f.w.at - 9e5 };
    const bytes = new TextEncoder().encode("old").buffer as ArrayBuffer;
    await t.store.kv.put("up-0123456789abcdef0123", bytes, { metadata: meta });
    const lists = t.store.state.lists;
    const up = await t.upload("new.png", "image/png", "new");
    expect(up.status).toBe(200);
    const { ref } = await up.json();
    const file = { ref, name: "new.png", type: "image/png", size: 3 };
    const sent = await t.post("/admin/chat/api/send", {
      id: "nowait001",
      words: "what's this",
      files: [file],
    });
    expect(sent.status).toBe(200);
    expect((await t.call(`/admin/chat/api/file/${ref}`)).status).toBe(200);
    expect((await t.call("/admin/chat/api/files")).status).toBe(200);
    expect(t.store.state.lists).toBe(lists);
    expect(t.r2.items.has(MOVED)).toBe(false);
    // Not copied yet: an old ref is gone till the cron's step, then it opens.
    expect((await t.call("/admin/chat/api/file/up-0123456789abcdef0123")).status).toBe(410);
    await moveFromKv(t.env, t.f.deps);
    expect((await t.call("/admin/chat/api/file/up-0123456789abcdef0123")).status).toBe(200);
  });

  it("the cron copies KV's files a step a tick, on from its mark after a failure; done, one look a tick", async () => {
    const t = setUp();
    const meta = { name: "old.png", type: "image/png", size: 3, by: "you", at: t.f.w.at - 9e5 };
    const bytes = new TextEncoder().encode("old").buffer as ArrayBuffer;
    const keys = Array.from(
      { length: 2 * COPY_STEP.files + 5 },
      (_, i) => `up-${String(i).padStart(3, "0")}3456789abcdef0123`,
    );
    expect(COPY_STEP.files).toBeGreaterThan(3);
    for (const key of keys) await t.store.kv.put(key, bytes, { metadata: meta });
    // The first is big: its step ends with it.
    const big = new Uint8Array(COPY_STEP.bytes).buffer;
    await t.store.kv.put(keys[0] ?? "", big, { metadata: { ...meta, size: COPY_STEP.bytes } });
    await t.store.kv.put("push:web:me", "[]");
    // R2 as the cron's tick has it: it counts its writes, and refuses one key when told.
    const writes: string[] = [];
    let refuse: string | undefined = keys[3];
    const bucket: Bucket = { ...t.r2.bucket };
    bucket.put = async (key, value, options) => {
      if (key === refuse) throw new Error("R2: refused");
      writes.push(key);
      return t.r2.bucket.put(key, value, options);
    };
    const tick = () =>
      moveFromKv({ FILES: t.store.kv, BUCKET: bucket } as unknown as Env, t.f.deps);
    const copied = () => keys.filter((key) => t.r2.items.has(key));
    // A step a tick: the big file alone, then on from its mark.
    await tick();
    expect(copied()).toEqual(keys.slice(0, 1));
    expect(t.r2.items.get(keys[0] ?? "")?.bytes.byteLength).toBe(COPY_STEP.bytes);
    // R2 refuses the fourth file: the step stops there, the third marked as the last copied, said.
    await tick();
    expect(copied()).toEqual(keys.slice(0, 3));
    expect(t.r2.items.get(MOVED)?.meta).toEqual({ after: keys[2] });
    expect(t.f.w.logs.join("\n")).toContain("KV's files not copied to R2 this tick");
    // The next tick carries on from the mark, COPY_STEP.files a tick, never from the start.
    refuse = undefined;
    writes.length = 0;
    await tick();
    expect(copied()).toEqual(keys.slice(0, 3 + COPY_STEP.files));
    await tick();
    await tick();
    expect(copied()).toEqual(keys);
    expect(writes.filter((key) => key !== MOVED)).toEqual(keys.slice(3));
    // Done, and marked so: a tick's one look at the mark is all it costs, no read of KV.
    expect(t.r2.items.get(MOVED)?.meta).toEqual({});
    const after = { lists: t.store.state.lists, r2: t.r2.state.lists, writes: writes.length };
    await tick();
    expect(t.store.state.lists).toBe(after.lists);
    expect(t.r2.state.lists).toBe(after.r2);
    expect(writes).toHaveLength(after.writes);
    expect(t.r2.items.has("push:web:me")).toBe(false);
  });

  // The doc pane (ADR 0065): a PDF in the browser's own viewer, which refuses a sandbox; framed only
  // by the chat, never sniffed. Without ?view=1, or as a download, it's the download it always was.
  it("a PDF shows inline for the doc pane, only with ?view=1; nothing else does", async () => {
    const t = setUp();
    const pdf = await (await t.upload("plan.pdf", "application/pdf", "%PDF-1.7")).json();
    const html = await (await t.upload("page.pdf.html", "text/html", "<script>x</script>")).json();
    const v = await t.call(`/admin/chat/api/file/${pdf.ref}?view=1`);
    expect(v.headers.get("content-type")).toBe("application/pdf");
    expect(v.headers.get("content-disposition")).toMatch(/^inline/);
    expect(v.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(v.headers.get("x-content-type-options")).toBe("nosniff");
    for (const path of [`${pdf.ref}`, `${pdf.ref}?view=1&download=1`, `${html.ref}?view=1`]) {
      const r = await t.call(`/admin/chat/api/file/${path}`);
      expect(r.headers.get("content-type"), path).toBe("application/octet-stream");
      expect(r.headers.get("content-disposition"), path).toMatch(/^attachment/);
      expect(r.headers.get("content-security-policy"), path).toBe("default-src 'none'; sandbox");
    }
  });

  it("a doc for the pane: Markdown rendered by GitHub and cleaned, once a file; a CSV as rows", async () => {
    const t = setUp();
    const md = await (await t.upload("notes.md", "text/markdown", "# Plan\n<b>bold</b>")).json();
    const doc = (ref: string) => t.call(`/admin/chat/api/doc/${ref}`);
    const a = await (await doc(md.ref)).json();
    expect(a).toMatchObject({ v: 1, name: "notes.md", kind: "md", size: 18 });
    expect(a.html).toContain("<h2>markdown</h2>");
    expect(a.html).toContain("# Plan");
    expect(a.html).not.toContain("script");
    expect(a.html).not.toContain("steal");
    // A file never changes: rendered once, and the page's copy unchanged is a 304.
    const again = await t.call(`/admin/chat/api/doc/${md.ref}`, {
      headers: { "if-none-match": (await doc(md.ref)).headers.get("etag") ?? "" },
    });
    expect(again.status).toBe(304);
    expect(t.f.w.rendered).toBe(1);
    const csv = await (
      await t.upload("costs.csv", "text/csv", 'item,cost\n"a, b",1\n"say ""hi""",2\r\n')
    ).json();
    expect((await (await doc(csv.ref)).json()).rows).toEqual([
      ["item", "cost"],
      ["a, b", "1"],
      ['say "hi"', "2"],
    ]);
    const txt = await (await t.upload("run.log", "text/plain", "line 1\nline 2")).json();
    expect(await (await doc(txt.ref)).json()).toMatchObject({
      kind: "text",
      text: "line 1\nline 2",
    });
    const pdf = await (await t.upload("a.pdf", "application/pdf", "%PDF")).json();
    const p = await (await doc(pdf.ref)).json();
    expect(p).toMatchObject({ kind: "pdf" });
    expect(p.text ?? p.html ?? p.rows).toBeUndefined();
    expect((await doc("up-0123456789abcdef0123")).status).toBe(410);
    expect((await doc("..%2Fetc")).status).toBe(410);
  });

  it("a doc GitHub can't render just now shows as text, and renders on the next look", async () => {
    const t = setUp();
    const md = await (await t.upload("notes.md", "text/markdown", "# Plan")).json();
    t.f.w.githubDown = true;
    const a = await (await t.call(`/admin/chat/api/doc/${md.ref}`)).json();
    expect(a).toMatchObject({ kind: "text", text: "# Plan" });
    t.f.w.githubDown = false;
    const b = await (await t.call(`/admin/chat/api/doc/${md.ref}`)).json();
    expect(b.kind).toBe("md");
  });

  it("Ask about this: a run's file the store keeps goes with your words, copied for the new chat", async () => {
    const t = setUp();
    const ref = "f-8000000000000-0123456789abcdef0123";
    await t.r2.keep(ref, "made", {
      name: "out.md",
      type: "text/markdown",
      size: 4,
      by: "run",
      at: t.f.w.at,
      task: 7,
    });
    const sent = await t.post("/admin/chat/api/send", {
      id: "askabout01",
      words: "what does this say?",
      files: [{ ref, name: "out.md", type: "text/markdown", size: 4 }],
    });
    expect(sent.status).toBe(200);
    const files = readFrom(t.f.w.issues[0]?.body)?.files ?? [];
    expect(files).toHaveLength(1);
    const copy = files[0]?.ref.replace(/^web:/, "") ?? "";
    expect(copy).toMatch(/^f-/);
    expect(copy).not.toBe(ref);
    expect(t.r2.items.get(copy)?.meta).toMatchObject({ name: "out.md", by: "run", task: "1" });
    expect(t.r2.items.get(ref)?.meta.task).toBe("7");
    // Only a ref the store could keep: never a path or another chat's.
    const bad = await t.post("/admin/chat/api/send", {
      id: "askabout02",
      words: "x",
      files: [{ ref: "telegram:123", name: "a", type: "", size: 1 }],
    });
    expect(bad.status).toBe(400);
  });

  it("a copy no chat takes is deleted: the send failed, or the door wrote it on no chat", async () => {
    const t = setUp();
    const theirs = await (await t.upload("a.png", "image/png", "png", 99)).json();
    const files = [{ ref: theirs.ref, name: "a.png", type: "image/png", size: 3 }];
    const kept = () => [...t.r2.items.keys()].filter((key) => key.startsWith("f-"));
    // The door closed: nothing is written, and the page keeps the message to send again.
    t.f.w.variables.SHIPIFY_DOOR = "closed";
    clearCaches();
    const shut = await t.post("/admin/chat/api/send", { id: "copygone01", words: "x", files });
    expect(shut.status).toBe(503);
    expect(kept()).toEqual([theirs.ref]);
    // On a task too: its copy was made with the task's number, and goes the same way.
    const task = t.f.issue({ title: "the other chat", user: { login: "owner" } });
    const on = await t.post("/admin/chat/api/send", {
      id: "copygone02",
      task: task.number,
      words: "and this",
      files,
    });
    expect(on.status).toBe(503);
    expect(kept()).toEqual([theirs.ref]);
    // Saved with no chat (a Journal line), or answered at once: no chat holds the copy.
    delete t.f.w.variables.SHIPIFY_DOOR;
    clearCaches();
    for (const [id, words] of [
      ["copygone03", "jot: look at this"],
      ["copygone04", "project: Games!"],
    ] as const) {
      const sent = await t.post("/admin/chat/api/send", { id, words, files });
      expect(sent.status).toBe(200);
      expect((await sent.json()).task).toBeUndefined();
      expect(kept()).toEqual([theirs.ref]);
    }
    // A second file that's gone: nothing is sent, and the first one's copy goes too.
    const gone = { ...files[0], ref: "f-8000000000000-0123456789abcdef0123", name: "b.png" };
    const half = await t.post("/admin/chat/api/send", {
      id: "copygone06",
      words: "both",
      files: [...files, gone],
    });
    expect(half.status).toBe(410);
    expect(kept()).toEqual([theirs.ref]);
    // Written onto a new chat: the copy gets its number, and stays.
    const ok = await (
      await t.post("/admin/chat/api/send", { id: "copygone05", words: "what's this?", files })
    ).json();
    const copy = kept().find((key) => key !== theirs.ref) ?? "";
    expect(t.r2.items.get(copy)?.meta.task).toBe(String(ok.task));
    expect(kept()).toHaveLength(2);
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

  // A moment's hiccup isn't shown: a read is tried once more, and when GitHub still isn't read, the
  // list and a thread are the last good answer, marked `stale` (the page says it's retrying).
  it("tries a read again, then serves the last good answer marked stale, else says so", async () => {
    clearCaches();
    const t = setUp();
    t.f.issue({ title: "from GitHub", user: { login: "owner" } });
    const n = t.f.w.issues[0]?.number;
    expect((await t.call(`/admin/chat/api/task/${n}`)).status).toBe(200);
    expect((await t.call("/admin/chat/api/list")).status).toBe(200);
    t.f.later(10_000);
    t.f.w.calls.length = 0;
    t.f.w.githubBlips = 1;
    const once = await t.call("/admin/chat/api/list");
    expect(once.status).toBe(200);
    expect((await once.json()).stale).toBeUndefined();
    expect(t.f.w.githubBlips).toBe(0);
    expect(t.f.w.calls.filter((c) => c.includes("/issues?state=open"))).toHaveLength(2);
    t.f.later(10_000);
    t.f.w.githubDown = true;
    const list = await t.call("/admin/chat/api/list");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ stale: true, tasks: [{ title: "from GitHub" }] });
    const thread = await t.call(`/admin/chat/api/task/${n}`);
    expect(await thread.json()).toMatchObject({ stale: true, task: { n } });
    // Nothing read before: GitHub's trouble, said as before.
    const closed = await t.call("/admin/chat/api/list?closed=1");
    expect(closed.status).toBe(503);
    expect(await closed.json()).toMatchObject({ error: "Couldn't read GitHub just now." });
    t.f.later(10_000);
    t.f.w.githubDown = false;
    expect((await (await t.call("/admin/chat/api/list")).json()).stale).toBeUndefined();
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
    // Reading a thread asks nothing of the stores: KV's lists are 1,000 a day on the free plan.
    expect(t.store.state.lists).toBe(0);
    expect(t.r2.state.lists).toBe(0);
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

  // ADR 0071: a reply's files are chips from the refs its line names; its words' links to shipify's
  // issues and to those files open in the window.
  it("a reply's files are chips, and its links to shipify's issues and its files stay inside", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "files0001", words: "write the guide" });
    const ref = "f-8236000000000-abcdef0123456789abcd";
    const backup = `https://github.com/${REPO}/blob/shipify-files/task-1/20261104/guide.pdf`;
    const line = replyLine({
      v: 1,
      kind: "answer",
      state: "Answered",
      title: "write the guide",
      links: [],
      files: [
        { name: "guide.pdf", ref, type: "application/pdf", size: 2048, backup },
        { name: "notes.md", ref: "f-8236000000001-abcdef0123456789abcd" },
      ],
      to: ["web:me"],
      key: "k1",
    });
    // As GitHub renders it: the file's link, and #2 linked.
    const c = t.f.comment(1, `${line}\nDone: the guide. See #2.`, RUN);
    c.html = `<p>Done: <a href="${backup}">the guide</a>. See <a class="issue-link" href="https://github.com/${REPO}/issues/2">#2</a>, or <a href="https://example.com/x">this</a>.</p>`;
    const thread = await (await t.call("/admin/chat/api/task/1")).json();
    const reply = thread.messages.at(-1);
    expect(reply.files).toEqual([
      { name: "guide.pdf", type: "application/pdf", size: 2048, src: `api/file/${ref}`, backup },
      { name: "notes.md", src: "api/file/f-8236000000001-abcdef0123456789abcd" },
    ]);
    expect(reply.html).toContain(`<a href="api/file/${ref}">the guide</a>`);
    expect(reply.html).toContain('<a href="#/t/2">#2</a>');
    expect(reply.html).toContain(
      'href="https://example.com/x" rel="noopener noreferrer nofollow" target="_blank"',
    );
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
    });
  });

  it("a closed task your words carry on says so (wakes), but not for a thanks or a close's comment", async () => {
    const t = setUp();
    const ago = new Date(t.f.w.at - 300_000).toISOString();
    const i = t.f.issue({ title: "done with", state: "closed", ...{ closed_at: ago } });
    // Each read past the edge's 4 seconds of memory.
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
    // Each read past the edge's 4 seconds of memory, as an open thread's refreshes are.
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

  it("a task's Progress (ADR 0069): its run's handoff, rendered once by GitHub and cleaned, pictures inert", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "progress01", words: "research this" });
    // No handoff yet: no Progress.
    expect((await (await t.call("/admin/chat/api/task/1")).json()).task.progress).toBeUndefined();
    const notes =
      "## Goal\nRead it all.\n![seen](https://evil.example/?d=1) <img src=https://evil.example/>";
    t.f.comment(1, `<!-- shipify-task ${JSON.stringify({ v: 2, notes })} -->\nAnswered.`, RUN);
    t.f.later(10_000);
    const before = t.f.w.rendered;
    const { task } = await (await t.call("/admin/chat/api/task/1")).json();
    // As a comment is (ADR 0071): its #12 links, which open in the window.
    expect(task.progress).toContain("<h2>gfm</h2>");
    expect(task.progress).toContain("Read it all.");
    // Its pictures are links, its fetching tags text: GitHub gets `\![` and `&lt;img`.
    expect(task.progress).toContain("\\![seen]");
    expect(task.progress).not.toMatch(/<img|script|steal/);
    expect(t.f.w.rendered).toBe(before + 1);
    // Unchanged, it's not rendered again (the thread itself read again).
    t.f.later(10_000);
    expect((await (await t.call("/admin/chat/api/task/1")).json()).task.progress).toBe(
      task.progress,
    );
    expect(t.f.w.rendered).toBe(before + 1);
    // An older page has none: the newest view shows it.
    for (let i = 0; i < 150; i++) t.f.comment(1, `note ${i}`, RUN);
    t.f.later(10_000);
    const newest = await (await t.call("/admin/chat/api/task/1")).json();
    expect(newest).toMatchObject({ earlier: true, page: 2 });
    expect(newest.task.progress).toBe(task.progress);
    const older = await (await t.call("/admin/chat/api/task/1?page=1")).json();
    expect(older.page).toBe(1);
    expect(older.task.progress).toBeUndefined();
  });

  it("a Progress GitHub can't render just now shows as its words, never failing the thread", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "progress02", words: "research this" });
    const notes = "## Goal\n<b>bold</b> & more";
    t.f.comment(1, `<!-- shipify-task ${JSON.stringify({ v: 2, notes })} -->\nAnswered.`, RUN);
    const markdown = t.f.deps.fetch;
    t.f.deps.fetch = async (input, init) =>
      input.endsWith("/markdown") ? new Response(null, { status: 502 }) : markdown(input, init);
    const { task } = await (await t.call("/admin/chat/api/task/1")).json();
    expect(task.progress).toBe("<pre>## Goal\n&lt;b&gt;bold&lt;/b&gt; &amp; more</pre>");
    t.f.deps.fetch = markdown;
    t.f.later(10_000);
    const again = await (await t.call("/admin/chat/api/task/1")).json();
    expect(again.task.progress).toContain("<h2>gfm</h2>");
  });

  it("a thread just past 100 opens full: a newest page under 40 brings the one before it", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "long00003", words: "a long one" });
    for (let i = 0; i < 101; i++) t.f.comment(1, `note ${i}`, RUN);
    const thread = await (await t.call("/admin/chat/api/task/1")).json();
    expect(thread).toMatchObject({ earlier: false, page: 1 });
    expect(thread.messages).toHaveLength(102);
    expect(thread.messages[0].md).toBe("a long one");
    expect(thread.messages.at(-1).md).toBe("note 100");
    // 150: the newest page has 50, enough alone.
    for (let i = 101; i < 150; i++) t.f.comment(1, `note ${i}`, RUN);
    t.f.later(10_000);
    const longer = await (await t.call("/admin/chat/api/task/1")).json();
    expect(longer).toMatchObject({ earlier: true, page: 2 });
    expect(longer.messages).toHaveLength(50);
    expect(longer.messages.at(-1).md).toBe("note 149");
  });

  it("a message at the 100 mark between two polls still comes: what's newer is read by time, not page", async () => {
    const t = setUp();
    await t.post("/admin/chat/api/send", { id: "long00004", words: "a long one" });
    for (let i = 0; i < 99; i++) {
      t.f.later(1_000);
      t.f.comment(1, `note ${i}`, RUN);
    }
    const open = await (await t.call("/admin/chat/api/task/1")).json();
    expect(open.messages).toHaveLength(100);
    const since = open.messages.at(-1).at;
    // Two between polls: the 100th ends page 1, the 101st starts page 2.
    t.f.later(1_000);
    t.f.comment(1, "the 100th", RUN);
    t.f.later(1_000);
    t.f.comment(1, "the 101st", RUN);
    t.f.later(10_000);
    t.f.w.calls.length = 0;
    const poll = await (
      await t.call(`/admin/chat/api/task/1?since=${encodeURIComponent(since)}`)
    ).json();
    expect(poll.messages.map((m: { md: string }) => m.md)).toEqual(["the 100th", "the 101st"]);
    // GitHub sends only what's new: asked with `since`, not for the newest page whole.
    const asked = t.f.gh().filter((c) => c.includes("issues/1/comments"));
    expect(asked.some((c) => c.includes(`since=${since}`))).toBe(true);
    expect(asked.some((c) => c.includes("page=2"))).toBe(false);
  });

  it("a thread reads its task and its comments at once", async () => {
    const t = setUp();
    t.f.issue({ title: "from GitHub", user: { login: "owner" } });
    const open = new Set<string>();
    let together = false;
    const fetch = t.f.deps.fetch;
    t.f.deps.fetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      const mine = /\/issues\/1(\/comments)?$/.test(path);
      if (mine) {
        open.add(path);
        together ||= open.size > 1;
      }
      try {
        await new Promise((r) => setTimeout(r, 1));
        return await fetch(input, init);
      } finally {
        open.delete(path);
      }
    };
    expect((await t.call("/admin/chat/api/task/1")).status).toBe(200);
    expect(together).toBe(true);
  });

  it("a read is kept 4 s, under the page's 5-second poll, so each poll as a run works sees its reply", async () => {
    const t = setUp();
    t.f.issue({ title: "from GitHub", user: { login: "owner" } });
    const reads = () => t.f.gh().filter((c) => c.endsWith("issues/1")).length;
    await t.call("/admin/chat/api/task/1");
    t.f.later(3_000);
    await t.call("/admin/chat/api/task/1");
    expect(reads()).toBe(1);
    t.f.later(2_000);
    await t.call("/admin/chat/api/task/1");
    expect(reads()).toBe(2);
  });

  it("your words on a task are in its next read, never one kept from before them", async () => {
    const t = setUp();
    t.f.issue({ title: "a task", user: { login: "owner" } });
    const yours = async (since = "") =>
      (
        (await (await t.call(`/admin/chat/api/task/1${since}`)).json()) as {
          messages: { who: string }[];
        }
      ).messages.filter((m) => m.who === "you").length;
    const at = `?since=${encodeURIComponent(new Date(t.f.w.at - 60_000).toISOString())}`;
    const before = [await yours(), await yours(at)];
    await t.post("/admin/chat/api/send", { id: "msg00000041", task: 1, words: "and the logo?" });
    // At once, within the 4 s a read is kept: the plain read and a running thread's `since` one.
    expect([await yours(), await yours(at)]).toEqual(before.map((k) => k + 1));
  });

  it("a thread's PRs: each one's state read once a minute, not on every poll", async () => {
    const t = setUp();
    t.f.issue({ title: "a task", user: { login: "owner" } });
    const pr = t.f.issue({
      title: "the fix",
      body: "Closes o/shipify#1",
      user: { login: "shipify-bot[bot]", type: "Bot" },
      pull_request: { merged_at: null },
    });
    const url = `https://github.com/${REPO}/pull/${pr.number}`;
    t.f.reply(
      1,
      replyLine({
        v: 1,
        kind: "answer",
        state: "Done",
        title: "x",
        links: [["PR", url]],
        to: ["web:me"],
        key: "k",
      }),
    );
    const prs = async () => {
      t.f.later(10_000);
      return (await (await t.call("/admin/chat/api/task/1")).json()).task.prs;
    };
    const reads = () => t.f.gh().filter((c) => c.endsWith(`issues/${pr.number}`)).length;
    expect(await prs()).toEqual([{ n: pr.number, url, state: "open" }]);
    Object.assign(pr, { state: "closed", pull_request: { merged_at: "2026-10-04T12:00:30Z" } });
    expect((await prs())[0].state).toBe("open");
    expect(reads()).toBe(1);
    t.f.later(60_000);
    expect((await prs())[0].state).toBe("merged");
    expect(reads()).toBe(2);
  });

  it("the list: shipify's open PRs for review, with their task; 100 at a time, without rendered bodies", async () => {
    const t = setUp();
    for (let i = 0; i < 105; i++) t.f.issue({ title: `task ${i}`, user: { login: "owner" } });
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
      expect.objectContaining({ n: 106, title: "The chat as a cockpit", task: 3 }),
    ]);
    expect(first.tasks.some((x: { n: number }) => x.n === 106)).toBe(false);
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

  it("lists a project with its name and chats, folds a chat under it, and hides Library pages (ADR 0069)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    const chat = t.f.issue({
      title: "which engine?",
      body: `Part of #${p.number}\n\nwhich engine?`,
    });
    p.subIssues = [chat.number];
    t.f.issue({ title: "Notebook: games", body: "## Map", labels: ["library", "project:games"] });
    const list = await (await t.call("/admin/chat/api/list")).json();
    const rows = list.tasks.map((r: { n: number }) => r.n);
    expect(rows).toEqual([chat.number, p.number]);
    const project = list.tasks.find((r: { n: number }) => r.n === p.number);
    expect(project).toMatchObject({ project: { name: "games", chats: 1 } });
    expect(project.parts).toBeUndefined();
    expect(project.labels).toBeUndefined();
    expect(list.tasks.find((r: { n: number }) => r.n === chat.number).parent).toBe(p.number);
  });

  it("a project's thread has its chats and pages, and no Plan card (ADR 0069)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    const chat = t.f.issue({ title: "which engine?", body: `Part of #${p.number}\n\nwhich?` });
    p.subIssues = [chat.number];
    const page = t.f.issue({
      title: "Notebook: games",
      body: "## Map",
      labels: ["library", "project:games"],
    });
    t.f.issue({ title: "Notebook: other", body: "- x", labels: ["library", "project:other"] });
    const th = await (await t.call(`/admin/chat/api/task/${p.number}`)).json();
    expect(th.task.plan).toBeUndefined();
    expect(th.task.project).toMatchObject({
      name: "games",
      chats: [{ n: chat.number, title: "which engine?" }],
      pages: [{ n: page.number, topic: "games", first: "Map" }],
    });
    // Its next step, from counts (ADR 0070): an empty Map asks for a first fact kept.
    expect(th.task.project.step).toContain("Keep on page");
    // Open, its Close asks first: the chats it closes too, and what stays and goes.
    expect(th.task.project.ask).toMatch(
      /^Close games and its 1 open chat\? Its docs stay in the Library, read-only\. Its files go from \d{1,2} \w{3}, unless you reopen it before\.$/,
    );
    // A doc of it names the project's number, so it opens over the project's Docs.
    const doc = await (await t.call(`/admin/chat/api/task/${page.number}`)).json();
    expect(doc.task.doc).toMatchObject({ name: "Overview", project: "games", of: p.number });
  });

  it("a closed project: in the index, its step says when and what stays, its Close asks nothing; its doc still finds it (ADR 0069)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: hacker", body: "x", labels: ["project"] });
    const page = t.f.issue({
      title: "Notebook: hacker",
      body: "## Map",
      labels: ["library", "project:hacker"],
    });
    t.f.issue({ title: "Project: g3f9a2c-trip", labels: ["project", "guest"] });
    p.state = "closed";
    p.closed_at = new Date().toISOString();
    const th = await (await t.call(`/admin/chat/api/task/${p.number}`)).json();
    expect(th.task.open).toBe(false);
    expect(th.task.project.ask).toBeUndefined();
    expect(th.task.project.step).toMatch(
      /^Closed \d{1,2} \w{3}\. Its docs stay in the Library, read-only\. Its files go from \d{1,2} \w{3}, unless you reopen it before\. Reopen it to ask or add again\.$/,
    );
    const doc = await (await t.call(`/admin/chat/api/task/${page.number}`)).json();
    expect(doc.task.doc.of).toBe(p.number);
    // The Library's read: your projects, open and closed; a guest's left out.
    const nb = await (await t.call("/admin/chat/api/notebook")).json();
    expect(nb.projects).toEqual([
      { n: p.number, name: "hacker", open: false, closed: p.closed_at },
    ]);
  });

  it("a project's page shows its Now first, and one next step from counts it read already (ADR 0070)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    const chat = t.f.issue({ title: "which engine?", body: `Part of #${p.number}\n\nwhich?` });
    p.subIssues = [chat.number];
    t.f.issue({
      title: "Notebook: games",
      body: "# games\n\n## Now\n\n- Now: picking an engine\n- Open questions: Defold's licence?\n\n## Map\n\n- [engines](#2)\n",
      labels: ["library", "project:games"],
    });
    const inbox = t.f.issue({
      title: "Notebook: games-inbox",
      body: "Collated up to item 3 (2 items).",
      labels: ["library", "project:games"],
    });
    const th = await (await t.call(`/admin/chat/api/task/${p.number}`)).json();
    expect(th.task.project.now).toEqual([
      "Now: picking an engine",
      "Open questions: Defold's licence?",
    ]);
    expect(th.task.project.step).toContain("say “check the project”");
    // Ten finds since the last collate come first: the Library's one read counts them.
    for (let i = 0; i < 12; i++) t.f.comment(inbox.number, "a find", { login: "owner" });
    clearCaches();
    t.f.later(120_000);
    const full = await (await t.call(`/admin/chat/api/task/${p.number}`)).json();
    expect(full.task.project.step).toBe("10 finds wait in the Inbox: Collate the inbox.");
  });

  it("finds chats and pages by meaning when you pick it, by words when GitHub is busy, each kept a minute (ADR 0070)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: clinic", body: "A clinic.", labels: ["project"] });
    const page = t.f.issue({
      title: "Notebook: clinic-licences",
      body: "- a licence from the state health office",
      labels: ["library", "project:clinic"],
    });
    t.f.issue({ title: "which licence does a clinic need?", body: `Part of #${p.number}` });
    const found = await (await t.call("/admin/chat/api/search?q=health+permits")).json();
    expect(found.words).toBeUndefined();
    expect(found.items).toEqual([
      { n: page.number, title: "clinic-licences", kind: "page", open: true },
    ]);
    // Yours leaves guests' out (ADR 0071).
    expect(t.f.w.searches).toEqual([`repo:${REPO} is:issue -label:guest health permits`]);
    // The same words within the minute: no second search.
    await t.call("/admin/chat/api/search?q=health+permits");
    expect(t.f.w.searches).toHaveLength(1);
    // Its 10 a minute spent: words, and the answer says so.
    t.f.w.searchBusy = true;
    const words = await (await t.call("/admin/chat/api/search?q=clinic")).json();
    expect(words.words).toBe(true);
    expect(words.items.map((i: { kind: string }) => i.kind).sort()).toEqual([
      "chat",
      "page",
      "project",
    ]);
    expect((await t.call("/admin/chat/api/search?q=")).status).toBe(400);
  });

  it("works out a project's one next step: you first, then a full Inbox, a first question, a fact kept, a check, Close (ADR 0070)", () => {
    const step = (p: Partial<Parameters<typeof nextStep>[0]>) =>
      nextStep({ chats: [], inbox: 0, map: 0, now: [], ...p });
    const chat = (n: number, state: string) => ({ n, state });
    expect(step({ chats: [chat(3, "needs-you")], inbox: 40 })).toBe(
      "#3 waits on you: open it below.",
    );
    expect(step({ chats: [chat(3, "open")], inbox: INBOX_FULL })).toContain("Collate the inbox");
    expect(step({ inbox: 9 })).toContain("Ask a first question");
    expect(step({ chats: [chat(3, "open")] })).toContain("Keep on page");
    expect(step({ chats: [chat(3, "open")], map: 4, now: ["Open questions: none"] })).toContain(
      "check the project",
    );
    expect(step({ chats: [chat(3, "closed")], map: 4 })).toContain("Close the project");
    expect(step({ chats: [chat(3, "open")], map: 4 })).toContain("Send starts a chat here");
  });

  // A project made from the Desk showed "Starting…" for ten minutes under its own words, and no run
  // ever came (task.yml skips them): those, and a page's, are marked, and the page waits for none.
  it("marks your words that start no run: a project's own, a page's (ADR 0069)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    const page = t.f.issue({ title: "Notebook: games", body: "## Map", labels: ["library"] });
    const read = async (n: number) =>
      (await (await t.call(`/admin/chat/api/task/${n}`)).json()).messages;
    expect((await read(p.number))[0]).toMatchObject({ who: "you", norun: true });
    expect((await read(page.number))[0]).toMatchObject({ who: "you", norun: true });
    // Words on the project after it (`collate the inbox`) start a run, as on any task.
    t.f.w.comments.push(t.f.comment(p.number, "collate the inbox", { login: OWNER }));
    t.f.later(10_000);
    expect((await read(p.number))[1]).toMatchObject({ who: "you", md: "collate the inbox" });
    expect((await read(p.number))[1].norun).toBeUndefined();
    const task = t.f.issue({ title: "fix the header", body: "fix it" });
    expect((await read(task.number))[0].norun).toBeUndefined();
  });

  it("New chat here opens a chat in the project; Move to project links one in, from the page only (ADR 0069)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    const res = await t.post("/admin/chat/api/send", {
      id: "msg0000under1",
      words: "which engine?",
      under: p.number,
    });
    expect(await res.json()).toMatchObject({ v: 1, task: 2 });
    expect(withoutLine(t.f.w.issues[1]?.body ?? "")).toBe(`Part of #${p.number}\n\nwhich engine?`);
    expect(p.subIssues).toEqual([2]);
    // On a task, `under` is nothing: the words are a comment, as ever.
    await t.post("/admin/chat/api/send", {
      id: "msg0000under2",
      task: 2,
      words: "try godot",
      under: 1,
    });
    expect(t.f.w.issues).toHaveLength(2);
    expect(t.f.w.comments).toHaveLength(1);
    // Move to project: linked, labelled, its words untouched.
    const old = t.f.issue({ title: "make it faster", body: "make it faster" });
    const moved = await t.post("/admin/chat/api/move", { task: old.number, project: p.number });
    expect(await moved.json()).toEqual({
      v: 1,
      text: `Moved #${old.number} into games · #${p.number}. Its next run reads the project's pages.`,
    });
    expect(old.labels).toEqual(["in-project"]);
    expect(old.body).toBe("make it faster");
    expect(p.subIssues).toEqual([2, old.number]);
    // The list and its thread name its project at once (it was left under General, task #645):
    // one GitHub read for all the moved chats, kept, not one each on every read.
    const listed = (await (await t.call("/admin/chat/api/list")).json()).tasks;
    expect(listed.find((x: { n: number }) => x.n === old.number)?.parent).toBe(p.number);
    const th = await (await t.call(`/admin/chat/api/task/${old.number}`)).json();
    expect(th.task.parent).toBe(p.number);
    t.f.later(60_000);
    await t.call("/admin/chat/api/list");
    expect(t.f.w.parentReads).toBe(1);
    // Not a project: said, nothing changed.
    const not = await t.post("/admin/chat/api/move", { task: 2, project: old.number });
    expect((await not.json()).text).toBe(`#${old.number} isn't a project.`);
    // From another site, a body that doesn't read, or the door closed: refused.
    const body = { task: 2, project: p.number };
    const evil = { origin: "https://evil.example" };
    expect((await t.post("/admin/chat/api/move", body, evil)).status).toBe(403);
    expect((await t.post("/admin/chat/api/move", { ...body, task: "2" })).status).toBe(400);
    expect((await t.post("/admin/chat/api/move", { ...body, more: 1 })).status).toBe(400);
    const c = setUp();
    c.f.w.variables.SHIPIFY_DOOR = "closed";
    const q = c.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    c.f.issue({ title: "make it faster" });
    const shut = await c.post("/admin/chat/api/move", { task: 2, project: q.number });
    expect(shut.status).toBe(503);
    expect((await shut.json()).error).toContain("closed");
    expect(q.subIssues ?? []).toEqual([]);
  });

  it("Notebook lists the Library's pages beside the notebook's, each with its project (ADR 0069)", async () => {
    const t = setUp();
    t.f.issue({ title: "Notebook: Preferences", body: "- short answers", labels: ["notebook"] });
    t.f.issue({
      title: "Notebook: games",
      body: "## Map\n\n- Godot",
      labels: ["library", "project:games"],
    });
    t.f.issue({ title: "Notebook: Journal 2026-11", body: "- a thought", labels: ["library"] });
    const nb = await (await t.call("/admin/chat/api/notebook")).json();
    expect(nb.pages.map((p: { topic: string }) => p.topic)).toEqual(["Preferences"]);
    expect(nb.library).toEqual([
      expect.objectContaining({ topic: "Journal 2026-11", first: "a thought" }),
      expect.objectContaining({ topic: "games", first: "Map", project: "games" }),
    ]);
  });

  it("Notebook's reads carry their ETags, and the Library's is kept a minute", async () => {
    const t = setUp();
    t.f.issue({ title: "Notebook: Preferences", body: "- short answers", labels: ["notebook"] });
    t.f.issue({ title: "Notebook: Journal 2026-11", body: "- a thought", labels: ["library"] });
    // GitHub's tags on these two: the same answer is a 304.
    const asked: { what: string; status: number }[] = [];
    const fetch = t.f.deps.fetch;
    t.f.deps.fetch = async (input, init = {}) => {
      const url = String(input);
      const what = url.includes("labels=notebook&")
        ? "notebook"
        : url.includes("labels=library&")
          ? "library"
          : "";
      const res = await fetch(input, init);
      if (!what) return res;
      const body = await res.text();
      const etag = `"${body.length}"`;
      const status = new Headers(init.headers).get("if-none-match") === etag ? 304 : res.status;
      asked.push({ what, status });
      return new Response(status === 304 ? null : body, {
        status,
        headers: { etag, "content-type": "application/json" },
      });
    };
    const of = (what: string) => asked.filter((x) => x.what === what).map((x) => x.status);
    for (let i = 0; i < 2; i++) expect((await t.call("/admin/chat/api/notebook")).status).toBe(200);
    expect(of("notebook")).toEqual([200, 304]);
    expect(of("library")).toEqual([200]);
    // Past a minute, read again: unchanged, a 304, and the same pages.
    t.f.later(61_000);
    const nb = await (await t.call("/admin/chat/api/notebook")).json();
    expect(of("library")).toEqual([200, 304]);
    expect(nb.pages).toEqual([expect.objectContaining({ topic: "Preferences" })]);
    expect(nb.library).toEqual([expect.objectContaining({ topic: "Journal 2026-11" })]);
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
    // The page says the limit as it counts it: "over 95.0 MB".
    expect(menu.files).toEqual({ on: true, most: 5, bytes: 95_000_000 });
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
    expect(got.tools.map((x: { id: string }) => x.id)).toEqual(["notion", "drop"]);
    // "Without asking": each pre-approved form by its call.
    expect(got.tools[1].pre).toEqual(["publish"]);
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
      apps: [{ id: "links", url: "https://links.example.com", failing: "2026-10-04T11:00:00Z" }],
      repos: { names: ["links", "notes"], projects: ["links"] },
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
    // A project's page (ADR 0065) reads its repos and apps from the menu: the same record.
    const menu = await (await t.call("/admin/chat/api/menu")).json();
    expect(menu).toMatchObject({
      repos: ["links", "notes"],
      projects: ["links"],
      apps: [{ id: "links", url: "https://links.example.com", failing: true, paused: false }],
    });
  });

  it("the runners and the status task are read with their ETags, the status task kept a minute", async () => {
    const t = setUp();
    t.f.issue({
      title: "Shipify status",
      body: `${STATUS_MARK}{"v":2} -->`,
      labels: ["shipify-status"],
    });
    // GitHub's tags on these two: the same answer is a 304.
    const asked: { what: string; status: number }[] = [];
    const fetch = t.f.deps.fetch;
    t.f.deps.fetch = async (input, init = {}) => {
      const url = String(input);
      const what = url.includes("/actions/runners")
        ? "runners"
        : url.includes("labels=shipify-status")
          ? "status"
          : "";
      const res = await fetch(input, init);
      if (!what) return res;
      const body = await res.text();
      const etag = `"${body.length}"`;
      const status = new Headers(init.headers).get("if-none-match") === etag ? 304 : res.status;
      asked.push({ what, status });
      return new Response(status === 304 ? null : body, {
        status,
        headers: { etag, "content-type": "application/json" },
      });
    };
    const of = (what: string) => asked.filter((x) => x.what === what);
    await t.call("/admin/chat/api/setup");
    const reads = of("status").length;
    expect(reads).toBeGreaterThan(0);
    expect(of("runners")).toHaveLength(1);
    // The menu and Repeats a moment later: the status task as Setup read it.
    for (const route of ["menu", "repeats"])
      expect((await t.call(`/admin/chat/api/${route}`)).status).toBe(200);
    expect(of("status")).toHaveLength(reads);
    // Past a minute, read again: unchanged, each a 304.
    t.f.later(61_000);
    expect((await t.call("/admin/chat/api/setup")).status).toBe(200);
    expect(
      of("status")
        .slice(reads)
        .map((x) => x.status),
    ).toEqual(Array(reads).fill(304));
    expect(of("runners").map((x) => x.status)).toEqual([200, 304]);
  });
});

// Sub-tasks (ADR 0066, "The web chat"): the list's counts and Waiting come from the list call that
// it makes already; a parent's Plan card is one GraphQL read when its thread opens, kept 60 s.
describe("the window (ADR 0071)", () => {
  it("a doc saves under a from line naming you, and a changed one, or one too long, doesn't", async () => {
    const t = setUp();
    const page = t.f.issue({
      title: "Notebook: games-research",
      body: "# Research\n\n- Godot",
      labels: ["library", "project:games"],
      user: RUN,
    });
    const th = await (await t.call(`/admin/chat/api/task/${page.number}`)).json();
    expect(th.task.doc).toEqual({
      name: "Research",
      project: "games",
      updated: expect.any(String),
    });
    expect(th.messages[0].md).toBe("# Research\n\n- Godot");
    const save = (words: string, updated = th.task.doc.updated, more = {}) =>
      t.post("/admin/chat/api/edit", { n: page.number, words, updated }, more);
    const ok = await save("# Research\n\n- Godot\n- Defold\n");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ v: 1, n: page.number });
    // As the door App, your hidden line first: the notebook counts the page as yours.
    expect(readFrom(page.body)).toMatchObject({ person: "owner", channel: "web", chat: "me" });
    expect(withoutLine(page.body)).toBe("# Research\n\n- Godot\n- Defold\n");
    expect(t.f.gh().filter((c) => c.startsWith("PATCH"))).toHaveLength(1);
    // Changed after you opened it (a run wrote it): refused, nothing written.
    page.updated_at = new Date(t.f.w.at + 60_000).toISOString();
    const late = await save("mine");
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({
      error: "It changed.",
      fix: "Copy your words, then reload.",
    });
    expect(withoutLine(page.body)).toContain("Defold");
    // Past 60,000 characters: said.
    const long = await save("x".repeat(60_001), page.updated_at);
    expect(long.status).toBe(413);
    expect((await long.json()).error).toContain("60,000");
    // A chat isn't a doc: its edit would start a run.
    const chat = t.f.issue({ title: "which engine?", body: "which?" });
    const notDoc = await t.post("/admin/chat/api/edit", {
      n: chat.number,
      words: "x",
      updated: chat.created_at,
    });
    expect(notDoc.status).toBe(409);
    expect(chat.body).toBe("which?");
    // From another site, or a body that doesn't read: refused.
    expect((await save("x", page.updated_at, { origin: "https://evil.example" })).status).toBe(403);
    const odd = await t.post("/admin/chat/api/edit", { n: page.number, words: "x" });
    expect(odd.status).toBe(400);
    expect(t.f.gh().filter((c) => c.startsWith("PATCH"))).toHaveLength(1);
  });

  it("a project's docs have short names, sizes and times; the Library's pages their numbers", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: games", body: "Offline games.", labels: ["project"] });
    t.f.issue({ title: "Notebook: games", body: "## Map", labels: ["library", "project:games"] });
    t.f.issue({
      title: "Notebook: games-inbox",
      body: "Collated up to item 0 (0 items).",
      labels: ["library", "project:games"],
    });
    const always = t.f.issue({
      title: "Notebook: Preferences",
      body: "- short",
      labels: ["notebook"],
    });
    const th = await (await t.call(`/admin/chat/api/task/${p.number}`)).json();
    const names = th.task.project.pages.map((g: { name: string }) => g.name).sort();
    expect(names).toEqual(["Inbox", "Overview"]);
    expect(th.task.project.pages[0]).toMatchObject({
      size: expect.any(Number),
      updated: expect.any(String),
    });
    const nb = await (await t.call("/admin/chat/api/notebook")).json();
    expect(nb.pages[0]).toMatchObject({ n: always.number, topic: "Preferences" });
    expect(nb.library.map((g: { name: string }) => g.name).sort()).toEqual(["Inbox", "Overview"]);
  });

  it("Files lists past the newest 500: a project's view keeps only its chats' files", async () => {
    const t = setUp();
    const at = t.f.w.at;
    // 550 newer files of chat 1, then 50 older ones of chat 7: past the newest 500.
    for (let i = 0; i < 600; i++) {
      const old = i >= 550;
      const when = at - (old ? 10_000_000 : 0) - i;
      await t.r2.keep(fileRefOf(when), "x", {
        name: `f${i}.txt`,
        type: "text/plain",
        size: 1,
        by: "run",
        at: when,
        task: old ? 7 : 1,
      });
    }
    const all = await (await t.call("/admin/chat/api/files")).json();
    expect(all).toMatchObject({ count: 600, bytes: 600 });
    expect(all.files).toHaveLength(500);
    expect(all.files.some((f: { task: number }) => f.task === 7)).toBe(false);
    // R2 lists 1,000 a call: one list, kept a minute, for both views.
    const lists = t.r2.state.lists;
    const mine = await (await t.call("/admin/chat/api/files?chats=7,8")).json();
    expect(mine).toMatchObject({ count: 50, bytes: 50 });
    expect(mine.files).toHaveLength(50);
    expect(mine.files.every((f: { task: number }) => f.task === 7)).toBe(true);
    expect(t.r2.state.lists).toBe(lists);
    expect((await t.call("/admin/chat/api/files?chats=7,x")).status).toBe(400);
  });

  it("Files says each chat's project, closed ones too, from one read of their parents kept a minute (ADR 0069)", async () => {
    const t = setUp();
    const p = t.f.issue({ title: "Project: hacker", labels: ["project"], state: "closed" });
    const chat = t.f.issue({ title: "level 3", state: "closed" });
    const loose = t.f.issue({ title: "tea?" });
    p.subIssues = [chat.number];
    for (const [i, task] of [chat.number, loose.number].entries())
      await t.r2.keep(fileRefOf(t.f.w.at - i), "x", {
        name: `f${i}.txt`,
        type: "text/plain",
        size: 1,
        by: "you",
        at: t.f.w.at - i,
        task,
      });
    const reads = t.f.w.parentReads;
    const all = await (await t.call("/admin/chat/api/files")).json();
    expect(all.parents).toEqual({ [chat.number]: p.number });
    await t.call("/admin/chat/api/files");
    expect(t.f.w.parentReads).toBe(reads + 1);
    // A project's own Files knows its chats: no read.
    const mine = await (await t.call(`/admin/chat/api/files?chats=${chat.number}`)).json();
    expect(mine.parents).toBeUndefined();
  });
});

describe("sub-tasks (ADR 0066)", () => {
  /** A split task #1 and its parts as the box opens them: #2 ran and merged, #3 waits for #2's
   * sibling #4, which waits for nothing; #5 was dropped. */
  function split(t: ReturnType<typeof setUp>) {
    const parent = t.f.issue({
      title: "shipify: sub-tasks",
      user: { login: OWNER },
      labels: ["started"],
    });
    const part = (title: string, more: Partial<Issue> = {}) =>
      t.f.issue({
        title,
        body: `Part of #${parent.number}\n\nThe brief.`,
        user: RUN,
        labels: ["sub-task"],
        ...more,
      });
    const a = part("shipify: the kernel", { state: "closed" });
    const b = part("links: use it", { labels: ["sub-task"] });
    const c = part("shipify: the web chat");
    const d = part("notes: try it", { state: "closed", stateReason: "NOT_PLANNED" });
    b.blockedBy = [c.number];
    c.closedBy = { number: 40, url: `https://github.com/${REPO}/pull/40` };
    c.labels.push("needs you");
    parent.subIssues = [a.number, b.number, c.number, d.number];
    return { parent, a, b, c, d };
  }
  const graphql = (t: ReturnType<typeof setUp>) =>
    t.f.gh().filter((c) => c === "POST graphql").length;

  it("the list: a parent's parts done of all, a part's parent, and Waiting, with no read more", async () => {
    const t = setUp();
    const { parent, b, c } = split(t);
    const list = await (await t.call("/admin/chat/api/list")).json();
    const row = (n: number) => list.tasks.find((x: { n: number }) => x.n === n);
    expect(row(parent.number)).toMatchObject({ parts: { done: 2, total: 4 }, state: "open" });
    expect(row(parent.number).parent).toBeUndefined();
    // A part the box opened is a task as a recipe's is; its own labels aren't filters.
    expect(row(b.number)).toMatchObject({ parent: parent.number, state: "waiting" });
    expect(row(b.number).labels).toBeUndefined();
    expect(row(parent.number).labels).toBeUndefined();
    expect(row(b.number).parts).toBeUndefined();
    // Waiting is for one with nothing else to say: needs you wins.
    expect(row(c.number)).toMatchObject({ parent: parent.number, state: "needs-you" });
    expect(graphql(t)).toBe(0);
    // Its blocker closed: it's open, not Waiting.
    const done = t.f.w.issues.find((x) => x.number === c.number);
    if (done) done.state = "closed";
    t.f.later(10_000);
    const again = await (await t.call("/admin/chat/api/list")).json();
    expect(again.tasks.find((x: { n: number }) => x.n === b.number).state).toBe("open");
  });

  it("a part waits only while it's open and no run works on it", async () => {
    const t = setUp();
    const { b } = split(t);
    t.f.w.runs["task.yml"] = [
      {
        id: 90,
        status: "in_progress",
        conclusion: null,
        display_title: `task #${b.number}`,
        created_at: new Date(t.f.w.at).toISOString(),
      },
    ];
    const list = await (await t.call("/admin/chat/api/list")).json();
    expect(list.tasks.find((x: { n: number }) => x.n === b.number).state).toBe("working");
  });

  it("a parent's thread: its Plan, one read when it opens, kept 60 s", async () => {
    const t = setUp();
    const { parent, a, b, c, d } = split(t);
    const res = await t.call(`/admin/chat/api/task/${parent.number}`);
    expect(res.status).toBe(200);
    const th = await res.json();
    expect(th.task.started).toBe(true);
    expect(th.task.plan).toEqual([
      { n: a.number, title: a.title, state: "closed" },
      { n: b.number, title: b.title, state: "waiting", after: [c.number] },
      {
        n: c.number,
        title: c.title,
        state: "needs-you",
        pr: { n: 40, url: `https://github.com/${REPO}/pull/40` },
      },
      { n: d.number, title: d.title, state: "closed", dropped: true },
    ]);
    expect(graphql(t)).toBe(1);
    // A poll (the thread's own read is kept 5 s) doesn't read the plan again within the minute.
    t.f.later(10_000);
    await t.call(`/admin/chat/api/task/${parent.number}`);
    expect(graphql(t)).toBe(1);
    t.f.later(55_000);
    await t.call(`/admin/chat/api/task/${parent.number}`);
    expect(graphql(t)).toBe(2);
  });

  it("a part that's ready says so: open, never ran, every blocker closed as completed", async () => {
    const t = setUp();
    const { parent, b, c, d } = split(t);
    const blocker = t.f.w.issues.find((x) => x.number === c.number);
    if (blocker) Object.assign(blocker, { state: "closed", labels: ["sub-task"] });
    const th = await (await t.call(`/admin/chat/api/task/${parent.number}`)).json();
    const part = (n: number) => th.task.plan.find((x: { n: number }) => x.n === n);
    expect(part(b.number)).toEqual({ n: b.number, title: b.title, state: "open", ready: true });
    // A dropped blocker isn't done: what waits for it waits.
    t.f.later(61_000);
    b.blockedBy = [d.number];
    const again = await (await t.call(`/admin/chat/api/task/${parent.number}`)).json();
    expect(again.task.plan.find((x: { n: number }) => x.n === b.number)).toMatchObject({
      state: "open",
      after: [d.number],
    });
    expect(again.task.plan.find((x: { n: number }) => x.n === b.number).ready).toBeUndefined();
  });

  it("a part's thread: its parent and Waiting, and it takes your words; no plan read", async () => {
    const t = setUp();
    const { parent, b } = split(t);
    const th = await (await t.call(`/admin/chat/api/task/${b.number}`)).json();
    expect(th.task).toMatchObject({ parent: parent.number, state: "waiting" });
    expect(th.task.plan).toBeUndefined();
    expect(th.writable).toBe(true);
    // A task with no sub-tasks reads no plan either.
    const plain = t.f.issue({ title: "plain", user: { login: OWNER } });
    const p = await (await t.call(`/admin/chat/api/task/${plain.number}`)).json();
    expect(p.task.plan).toBeUndefined();
    expect(p.task.parent).toBeUndefined();
    expect(graphql(t)).toBe(0);
  });

  it("a plan GitHub can't read leaves the card out, never the thread", async () => {
    const t = setUp();
    const { parent } = split(t);
    t.f.w.graphqlFails = true;
    const res = await t.call(`/admin/chat/api/task/${parent.number}`);
    expect(res.status).toBe(200);
    expect((await res.json()).task.plan).toBeUndefined();
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
