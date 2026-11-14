// Guests (ADR 0071), through the edge's own handler in the fake world: the guests' door behind its
// own Access application and your guest list, every route's "whose" rule, a guest's marks as the
// door writes them, and you and two guests, where no one sees another's chats or files.
import { beforeAll, describe, expect, it } from "vitest";
import {
  guestIdOf,
  guestLabel,
  guestPrefix,
  readFrom,
  replyLine,
} from "../../../cli/contracts/index.ts";
import { clearCertsCache } from "../../../edge/src/access.ts";
import { handle } from "../../../edge/src/app.ts";
import { clearCaches } from "../../../edge/src/cache.ts";
import type { Env } from "../../../edge/src/env.ts";
import { GUESTS_KEY } from "../../../edge/src/guests.ts";
import { clearSeen } from "../../../edge/src/web/gh.ts";
import { clearBuilt } from "../../../edge/src/web/reads.ts";
import { WHOSE } from "../../../edge/src/web/routes.ts";
import { envFor, type Keys, keys, ORIGIN, RUN, world } from "../fake.ts";
import { memoryKv } from "../kv.ts";
import { memoryR2 } from "../r2.ts";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "b".repeat(64);
const GUEST_AUD = "c".repeat(64);
const ANA = "ana@example.com";
const BEN = "ben@example.com";
let k: Keys;
let access: CryptoKeyPair;
let jwk: JsonWebKey;
let ana: string;
let ben: string;
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
  ana = await guestIdOf(ANA);
  ben = await guestIdOf(BEN);
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An Access token for an application (its AUD), with the email Access signed in. */
async function token(now: number, aud: string, email?: string) {
  const head = b64({ alg: "RS256", kid: "ak1" });
  const body = b64({
    aud: [aud],
    iss: `https://${TEAM}`,
    exp: Math.floor(now / 1000) + 600,
    nbf: Math.floor(now / 1000) - 10,
    ...(email ? { email } : {}),
  });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    access.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

const PAGE = '<!doctype html><base href="/admin/chat/"><title>Shipify</title>';

/** Who calls: you, a guest by their email, or no one signed in. */
type As = "owner" | { guest: string; aud?: string } | false;

function setUp(o: { aud?: boolean; guests?: string[] } = {}) {
  clearCaches();
  clearCertsCache();
  clearSeen();
  clearBuilt();
  const f = world(k);
  // The guests' application, set once on GitHub with yours: `aud: false` leaves it out.
  f.w.variables.SHIPIFY_ACCESS = JSON.stringify({
    team: TEAM,
    aud: AUD,
    ...(o.aud === false ? {} : { guests: GUEST_AUD }),
  });
  f.w.variables.SHIPIFY_PEOPLE = JSON.stringify([
    { name: "Aayush", on: { github: "owner", web: "me" } },
  ]);
  f.w.apps[`https://${TEAM}/cdn-cgi/access/certs`] = { body: { keys: [jwk] } };
  const store = memoryKv(() => f.w.at);
  const assets = {
    fetch: async (r: Request) =>
      new URL(r.url).pathname === "/admin/chat/index.html"
        ? new Response(PAGE, { headers: { "content-type": "text/html", etag: '"v1"' } })
        : new Response("nope", { status: 404 }),
  };
  const r2 = memoryR2();
  const env = envFor(k, {
    FILES: store.kv,
    BUCKET: r2.bucket,
    ASSETS: assets,
  } as unknown as Partial<Env>);
  const call = async (path: string, init: RequestInit = {}, as: As = "owner") => {
    const headers = new Headers(init.headers);
    if (as === "owner") headers.set("cf-access-jwt-assertion", await token(f.w.at, AUD));
    else if (as)
      headers.set("cf-access-jwt-assertion", await token(f.w.at, as.aud ?? GUEST_AUD, as.guest));
    return handle(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, f.deps);
  };
  const post = (path: string, body: unknown, as: As = "owner") =>
    call(
      path,
      {
        method: "POST",
        headers: { origin: ORIGIN, "x-shipify-chat": "1", "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      as,
    );
  const upload = (base: string, name: string, bytes: string, as: As) =>
    call(
      `${base}/api/file`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "x-shipify-chat": "1",
          "content-type": "text/plain",
          "content-length": String(Buffer.byteLength(bytes)),
          "x-file-name": encodeURIComponent(name),
        },
        body: bytes,
      },
      as,
    );
  const t = { f, env, r2, call, post, upload };
  return { ...t, ready: () => keep(t, o) };
}

/** The guest list in the store, as Setup → Guests keeps it. */
async function keep(
  t: { r2: ReturnType<typeof memoryR2>; f: ReturnType<typeof world> },
  o: { aud?: boolean; guests?: string[] },
) {
  const guests = await Promise.all(
    (o.guests ?? [ANA, BEN]).map(async (email) => ({
      id: await guestIdOf(email),
      email,
      name: email.split("@")[0] === "ana" ? "Ana" : "Ben",
      added: t.f.w.at,
    })),
  );
  await t.r2.bucket.put(GUESTS_KEY, JSON.stringify({ v: 1, guests }));
}

const asAna = () => ({ guest: ANA });
const asBen = () => ({ guest: BEN });

describe("the guests' door", () => {
  it("is off until SHIPIFY_ACCESS names the guests' application; your chat works as before", async () => {
    const t = setUp({ aud: false });
    await t.ready();
    // An audience in the store (as the first build kept it) opens nothing: only GitHub sets it.
    const stored = JSON.parse(
      await new Response((await t.r2.bucket.get(GUESTS_KEY))?.body).text(),
    ) as object;
    await t.r2.bucket.put(GUESTS_KEY, JSON.stringify({ ...stored, aud: GUEST_AUD }));
    const res = await t.call("/guest/api/list", {}, asAna());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Guests are off." });
    expect((await t.call("/admin/chat/api/list")).status).toBe(200);
  });

  it("lets in only a guest on your list, with the guests' application's token", async () => {
    const t = setUp();
    await t.ready();
    expect((await t.call("/guest/api/list", {}, asAna())).status).toBe(200);
    // No token, a stranger's email, or no email: refused.
    expect((await t.call("/guest/api/list", {}, false)).status).toBe(403);
    const stranger = await t.call("/guest/api/list", {}, { guest: "eve@example.com" });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toMatchObject({ error: "This email isn't on the guest list." });
    // Your token at /guest/, and a guest's at /admin/: each is for the other application.
    expect((await t.call("/guest/api/list", {}, { guest: ANA, aud: AUD })).status).toBe(403);
    expect((await t.call("/admin/chat/api/list", {}, asAna())).status).toBe(403);
  });

  it("serves the same page at /guest/, its address theirs", async () => {
    const t = setUp();
    await t.ready();
    const res = await t.call("/guest/", {}, asAna());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<base href="/guest/">');
    const moved = await t.call("/guest", {}, asAna());
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe(`${ORIGIN}/guest/`);
  });

  it("a page load refused at /guest/ is a page with the way to yours; the page's calls stay JSON", async () => {
    const t = setUp();
    await t.ready();
    const res = await t.call("/guest/", {}, { guest: "eve@example.com" });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("This email isn't on the guest list.");
    expect(html).toContain('href="/admin/chat/"');
    expect(html).not.toContain("<script");
    const api = await t.call("/guest/api/list", {}, { guest: "eve@example.com" });
    expect(api.headers.get("content-type")).toContain("application/json");
  });

  /** The bare address `/`, outside Access: only the sign-in cookie, if any, says who calls. */
  const root = (t: ReturnType<typeof setUp>, cookie?: string) =>
    t.call("/", cookie ? { headers: { cookie } } : {}, false);

  it("the bare address sends you to your chat, and a guest to theirs, by Access's cookie", async () => {
    const t = setUp();
    await t.ready();
    const mine = await root(t, `theme=dark; CF_Authorization=${await token(t.f.w.at, AUD, ANA)}`);
    expect(mine.status).toBe(302);
    expect(mine.headers.get("location")).toBe("/admin/chat/");
    const theirs = await root(t, `CF_Authorization=${await token(t.f.w.at, GUEST_AUD, ANA)}`);
    expect(theirs.status).toBe(302);
    expect(theirs.headers.get("location")).toBe("/guest/");
  });

  it("the bare address with no cookie, a bad one, or guests off, shows both ways in", async () => {
    const t = setUp();
    await t.ready();
    const good = await token(t.f.w.at, GUEST_AUD, ANA);
    const [h, p] = good.split(".");
    const forged = `${h}.${p}.${"A".repeat(342)}`;
    const old = await token(t.f.w.at - 3_600_000, GUEST_AUD, ANA);
    const other = await token(t.f.w.at, "d".repeat(64), ANA);
    for (const cookie of [
      undefined,
      `CF_Authorization=${forged}`,
      `CF_Authorization=${old}`,
      `CF_Authorization=${other}`,
      "CF_Authorization=",
    ]) {
      const res = await root(t, cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      const html = await res.text();
      expect(html).toContain('href="/guest/"');
      expect(html).toContain('href="/admin/chat/"');
      expect(html).not.toContain("<script");
    }
    const off = setUp({ aud: false });
    await off.ready();
    const res = await root(off, `CF_Authorization=${await token(off.f.w.at, GUEST_AUD, ANA)}`);
    expect(res.status).toBe(200);
  });

  it("a removed guest is refused within 10 seconds, and their open chats close", async () => {
    const t = setUp();
    await t.ready();
    const sent = await t.post(
      "/guest/api/send",
      { id: "abcdefgh1", words: "what is a VO2 max?" },
      asAna(),
    );
    expect(sent.status).toBe(200);
    const gone = await t.post("/admin/chat/api/guests", { do: "remove", id: ana });
    expect(gone.status).toBe(200);
    expect(t.f.w.issues[0]?.state).toBe("closed");
    t.f.w.at += 11_000;
    expect((await t.call("/guest/api/list", {}, asAna())).status).toBe(403);
  });
});

describe("whose each route is", () => {
  it("every route has a rule; a guest gets 404 on each of yours, before anything is read", async () => {
    const t = setUp();
    await t.ready();
    const yours = Object.entries(WHOSE).filter(([, w]) => w === "owner");
    expect(yours.length).toBeGreaterThan(0);
    for (const [key] of yours) {
      const [method, route] = key.split(" ") as [string, string];
      const path = `/guest/api/${route}${route === "sent" ? "/telegram:1" : ""}`;
      const res =
        method === "GET"
          ? await t.call(path, {}, asAna())
          : await t.call(
              path,
              {
                method,
                headers: { origin: ORIGIN, "x-shipify-chat": "1" },
                body: "{}",
              },
              asAna(),
            );
      expect(res.status, key).toBe(404);
    }
  });

  it("a route with no rule answers 404 to you too", async () => {
    const t = setUp();
    await t.ready();
    expect((await t.call("/admin/chat/api/nothing")).status).toBe(404);
  });

  it("a guest's menu holds nothing of yours, not even your name", async () => {
    const t = setUp();
    await t.ready();
    const m = (await (await t.call("/guest/api/menu", {}, asAna())).json()) as {
      guest?: { name: string };
      repos: string[];
      apps: unknown[];
      commands: [string, string][];
    };
    expect(m.guest).toEqual({ name: "Ana" });
    expect(m.repos).toEqual([]);
    expect(m.apps).toEqual([]);
    expect(m.commands.map(([c]) => c)).not.toContain("tasks");
  });
});

describe("you and two guests: no one sees another's", () => {
  it("each one's chats, threads and Find are their own; yours leave theirs out", async () => {
    const t = setUp();
    await t.ready();
    await t.post("/admin/chat/api/send", { id: "owner0001", words: "my own question" });
    await t.post("/guest/api/send", { id: "anaaaaaa1", words: "ana's question" }, asAna());
    await t.post("/guest/api/send", { id: "benbbbbb1", words: "ben's question" }, asBen());
    const [mine, anas, bens] = t.f.w.issues;
    // The door writes each guest's marks: their labels, and their id on the opening line.
    expect(mine?.labels).toEqual([]);
    expect(anas?.labels).toEqual(["guest", guestLabel(ana)]);
    expect(readFrom(anas?.body)?.guest).toBe(ana);
    expect(readFrom(bens?.body)?.guest).toBe(ben);
    const titles = async (path: string, as: As) =>
      ((await (await t.call(path, {}, as)).json()) as { tasks: { title: string }[] }).tasks.map(
        (x) => x.title,
      );
    expect(await titles("/admin/chat/api/list", "owner")).toEqual(["my own question"]);
    expect(await titles("/guest/api/list", asAna())).toEqual(["ana's question"]);
    expect(await titles("/guest/api/list", asBen())).toEqual(["ben's question"]);
    // A thread that isn't theirs is none to a guest: the same 404 as one that doesn't exist.
    for (const n of [mine?.number, bens?.number, 999]) {
      const res = await t.call(`/guest/api/task/${n}`, {}, asAna());
      expect(res.status, `#${n}`).toBe(404);
      expect(await res.json()).toMatchObject({ error: "Not your chat." });
    }
    expect((await t.call(`/guest/api/task/${anas?.number}`, {}, asAna())).status).toBe(200);
  });

  it("a guest's first chat is in their next read of the list, not one kept from before", async () => {
    const t = setUp();
    await t.ready();
    const titles = async () =>
      (
        (await (await t.call("/guest/api/list", {}, asAna())).json()) as {
          tasks: { title: string }[];
        }
      ).tasks.map((x) => x.title);
    expect(await titles()).toEqual([]);
    await t.post("/guest/api/send", { id: "anaaaaaa1", words: "what is a VO2 max?" }, asAna());
    expect(await titles()).toEqual(["what is a VO2 max?"]);
    // Whether a box is online, so it says "Starting…", and no name of yours; no marks as filters.
    const l = (await (await t.call("/guest/api/list", {}, asAna())).json()) as {
      boxes: unknown[];
      tasks: { labels?: string[] }[];
    };
    expect(l.boxes).toEqual([{ name: "", online: true, slots: 0, busy: 0 }]);
    expect(l.tasks[0]?.labels).toBeUndefined();
  });

  it("a guest's window gets no run details: your box, your plan's use, the run's link", async () => {
    const t = setUp();
    await t.ready();
    await t.post("/guest/api/send", { id: "anaaaaaa1", words: "what is a VO2 max?" }, asAna());
    const line = replyLine({
      v: 1,
      kind: "answer",
      state: "Answered",
      title: "what is a VO2 max?",
      links: [],
      run: { secs: 60, tokens: 1200, plan: true, model: "claude-opus-5-5" },
      to: [`web:${ana}`],
      key: "k1",
    });
    t.f.w.comments.push({
      ...t.f.comment(
        1,
        `${line}\nIt's how much oxygen you use at most.\n\n<details><summary>Run details: Opus</summary>\n\n| Started | on **homepi** · [the run](https://github.com/o/shipify/actions/runs/99) |\n\n</details>`,
        RUN,
      ),
      html: "<p>It's how much oxygen you use at most.</p><details><summary>Run details: Opus</summary><table><tr><td>homepi</td></tr></table></details>",
    });
    // The helper keeps one without its rendering: only the one above stays.
    t.f.w.comments.splice(0, 1);
    const thread = (await (await t.call("/guest/api/task/1", {}, asAna())).json()) as {
      messages: { who: string; md: string; details?: string; reply?: { run?: unknown } }[];
    };
    const reply = thread.messages.find((m) => m.who === "shipify");
    expect(reply?.reply).toBeDefined();
    expect(reply?.reply?.run).toBeUndefined();
    expect(reply?.details).toBeUndefined();
    // Its Markdown (Copy, Download) has none of them either.
    expect(reply?.md).toBe("It's how much oxygen you use at most.");
    // You see them on your own read.
    const yours = (await (await t.call("/admin/chat/api/task/1")).json()) as typeof thread;
    expect(yours.messages.find((m) => m.who === "shipify")?.details).toBeDefined();
  });

  it("a guest's words on a chat that isn't theirs write nothing, with no hint it exists", async () => {
    const t = setUp();
    await t.ready();
    await t.post("/admin/chat/api/send", { id: "owner0001", words: "my own question" });
    const before = JSON.stringify(t.f.w.comments);
    for (const task of [1, 999]) {
      const res = await t.post(
        "/guest/api/send",
        { id: `anaaaaa${task}`, task, words: "can I see this?" },
        asAna(),
      );
      expect(((await res.json()) as { text: string }).text).toMatch(/^Not your chat/);
    }
    expect(JSON.stringify(t.f.w.comments)).toBe(before);
  });

  it("each one's files carry their prefix; no one opens, lists or deletes another's", async () => {
    const t = setUp();
    await t.ready();
    const up = async (base: string, as: As) =>
      ((await (await t.upload(base, "notes.txt", "hello", as)).json()) as { ref: string }).ref;
    const mine = await up("/admin/chat", "owner");
    const anas = await up("/guest", asAna());
    const bens = await up("/guest", asBen());
    expect(mine.startsWith("f-")).toBe(true);
    expect(anas.startsWith(`${guestPrefix(ana)}-`)).toBe(true);
    for (const ref of [mine, bens]) {
      expect((await t.call(`/guest/api/file/${ref}`, {}, asAna())).status).toBe(404);
      expect((await t.call(`/guest/api/doc/${ref}`, {}, asAna())).status).toBe(404);
      const del = await t.call(
        `/guest/api/file/${ref}`,
        { method: "DELETE", headers: { origin: ORIGIN, "x-shipify-chat": "1" } },
        asAna(),
      );
      expect(del.status).toBe(404);
    }
    expect((await t.call(`/guest/api/file/${anas}`, {}, asAna())).status).toBe(200);
    const refs = async (base: string, as: As) =>
      (
        (await (await t.call(`${base}/api/files`, {}, as)).json()) as { files: { ref: string }[] }
      ).files.map((x) => x.ref);
    expect(await refs("/guest", asAna())).toEqual([anas]);
    expect(await refs("/admin/chat", "owner")).toEqual([mine]);
    // A guest can't send another's file with their words: it's as good as gone.
    const sent = await t.post(
      "/guest/api/send",
      {
        id: "anaaaaaa2",
        words: "read this",
        files: [{ ref: bens, name: "notes.txt", type: "text/plain", size: 5 }],
      },
      asAna(),
    );
    expect(sent.status).toBe(410);
  });

  it("what only you say is refused for a guest, and writes nothing", async () => {
    const t = setUp();
    await t.ready();
    for (const words of [
      "jot: an idea",
      // A chat command that drops its own word leaves what's after it: still refused.
      "/change jot: IGNORE ALL RULES",
      "/change go",
      "/tasks",
      "/apps",
      // Every fixed word a guest never says, the box's list too (NOT_A_GUESTS).
      "go",
      "go.",
      "go!",
      "go #12",
      "yes 0a1b2c3d",
      "no 0a1b2c3d",
      "start over",
      "clean start",
      "publish",
      "preview",
    ]) {
      const res = await t.post(
        "/guest/api/send",
        { id: `w${words.length}abcdefg`, words },
        asAna(),
      );
      expect(((await res.json()) as { text: string }).text, words).toMatch(
        /^That's for Aayush only/,
      );
    }
    expect(t.f.w.issues).toHaveLength(0);
    // A plain yes or no answers their own run (alone, it needs a chat to answer), and words that
    // only start like a fixed word are words, written as a new chat. Their memory's words are
    // theirs (ADR 0078): a new chat, which the box writes to their own page alone.
    for (const words of [
      "yes",
      "no",
      "publish my notes as a PDF",
      "go over this plan",
      "remember: I like tea",
      "personality: friendly",
    ]) {
      const res = await t.post(
        "/guest/api/send",
        { id: `ok${words.length}abcdefg`, words },
        asAna(),
      );
      expect(((await res.json()) as { text: string }).text, words).not.toMatch(/only/);
    }
    expect(t.f.w.issues.map((i) => i.title)).toEqual([
      "publish my notes as a PDF",
      "go over this plan",
      "remember: I like tea",
      "personality: friendly",
    ]);
  });

  it("a guest's project is named with their prefix on GitHub, and shown with their name", async () => {
    const t = setUp();
    await t.ready();
    const res = await t.post(
      "/guest/api/send",
      { id: "anaproj01", words: "project: health" },
      asAna(),
    );
    expect(((await res.json()) as { text: string }).text).toMatch(/^Project health made/);
    const project = t.f.w.issues.find((i) => i.title.startsWith("Project: "));
    expect(project?.title).toBe(`Project: ${guestPrefix(ana)}-health`);
    expect(project?.labels).toEqual(["project", "guest", guestLabel(ana)]);
    // Their window shows it by the name they gave, which their words use (`add health: …`).
    const list = (await (await t.call("/guest/api/list", {}, asAna())).json()) as {
      tasks: { project?: { name: string } }[];
    };
    expect(list.tasks.map((x) => x.project?.name).filter(Boolean)).toEqual(["health"]);
    // Your own names can't take a guest's prefix.
    const mine = await t.post("/admin/chat/api/send", {
      id: "ownerproj",
      words: `project: ${guestPrefix(ana)}-x`,
    });
    expect(((await mine.json()) as { text: string }).text).toMatch(/can't start with/);
  });

  it("a guest edits their own docs only; you don't move a guest's doc to your side", async () => {
    const t = setUp();
    await t.ready();
    await t.post("/guest/api/send", { id: "anaproj01", words: "project: health" }, asAna());
    const page = t.f.w.issues.find((i) => i.title === `Notebook: ${guestPrefix(ana)}-health`);
    expect(page?.labels).toEqual(expect.arrayContaining(["library", "guest", guestLabel(ana)]));
    const mine = t.f.issue({
      title: "Notebook: Preferences",
      body: "- tea",
      labels: ["notebook"],
      user: { login: "owner" },
    });
    const updated = async (n: number, as: As) =>
      (
        (await (
          await t.call(`${as === "owner" ? "/admin/chat" : "/guest"}/api/task/${n}`, {}, as)
        ).json()) as {
          task: { doc?: { updated: string } };
        }
      ).task.doc?.updated;
    const at = (await updated(page?.number ?? 0, asAna())) as string;
    const save = (n: number, as: As, when = at) =>
      t.post(
        `${as === "owner" ? "/admin/chat" : "/guest"}/api/edit`,
        { n, words: "# health\n\nmy notes", updated: when },
        as,
      );
    expect((await save(page?.number ?? 0, asAna())).status).toBe(200);
    expect(readFrom(page?.body)?.guest).toBe(ana);
    // Yours, or another guest's: none to them.
    expect((await save(mine.number, asAna(), new Date(t.f.w.at).toISOString())).status).toBe(404);
    expect((await save(page?.number ?? 0, asBen())).status).toBe(404);
    // You read it, but a save would put your line on it: refused, said why.
    const yours = await save(
      page?.number ?? 0,
      "owner",
      (await updated(page?.number ?? 0, "owner")) as string,
    );
    expect(yours.status).toBe(409);
    expect(await yours.json()).toMatchObject({ error: expect.stringMatching(/a guest's doc/) });
  });
});

describe("Setup → Guests", () => {
  it("adds a guest by email and name and lists them with their chats; no page sets the audience", async () => {
    const t = setUp({ guests: [] });
    await t.ready();
    expect(
      (await t.post("/admin/chat/api/guests", { do: "aud", aud: "d".repeat(64) })).status,
    ).toBe(400);
    const added = await t.post("/admin/chat/api/guests", { do: "add", email: ANA, name: "Ana" });
    expect(added.status).toBe(200);
    expect(((await added.json()) as { text: string }).text).toContain(`${ORIGIN}/guest/`);
    expect(
      (await t.post("/admin/chat/api/guests", { do: "add", email: "nope", name: "X" })).status,
    ).toBe(400);
    await t.post("/guest/api/send", { id: "anaaaaaa1", words: "hello" }, asAna());
    const s = (await (await t.call("/admin/chat/api/setup")).json()) as {
      guests?: { on: boolean; link: string; list: { id: string; name: string; chats: number }[] };
    };
    expect(s.guests?.on).toBe(true);
    expect(s.guests?.list).toEqual([expect.objectContaining({ id: ana, name: "Ana", chats: 1 })]);
    // Only you change it: a guest's post is refused.
    expect(
      (await t.post("/guest/api/guests", { do: "add", email: BEN, name: "Ben" }, asAna())).status,
    ).toBe(404);
  });
});
