// Our Drop tool (docs/tools.md, Drop), end to end against a fake Drop: its server over MCP with the
// read token, and the box's approved calls (makeCalls) with the write token and the task's shared
// files. The fake answers as docs/tools.md says Drop's /api does (Drop 0.3.0, as its admin page
// calls it), and as Access does for a token it doesn't know (its sign-in page).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeCalls } from "../cli/kernel/mcp-client.ts";
import { command, loadTools } from "../cli/lib/tools.ts";
import { baseOf, explain } from "../tools/drop/drop.ts";
import { idOf } from "../tools/drop/server.ts";

const READ = { id: "read-id", secret: "read-secret" };
const WRITE = { id: "write-id", secret: "write-secret" };
const ROLE: Record<string, string> = { view: "view", add: "add", collect: "send" };

interface FakeDrop {
  address: string;
  title: string;
  expires: string | null;
  expired?: boolean;
  gate: string;
  pin: string | null;
  /** A link made before Drop 0.3.0 has no secret kept: only its hash. */
  link: { role: string; secret: string | null } | null;
  people: Record<string, string>;
  requests: string[];
  files: Record<string, string>;
  limits: { mb: number; files: number };
  /** The guest it's for (Drop 0.6.0): set only when it's made. */
  by?: { email: string; name: string };
}
let drops: Record<string, FakeDrop> = {};
let seen: string[] = [];
let next = 0;
const people = [
  { id: "p1", name: "Mom", email: null, mode: "easy", drops: 0 },
  { id: "p2", name: "Dad", email: "dad@example.com", mode: "signin", drops: 0 },
];

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((done) => {
    const parts: Buffer[] = [];
    req.on("data", (d: Buffer) => parts.push(d));
    req.on("end", () => done(Buffer.concat(parts)));
  });

let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, data ? { "content-type": "application/json" } : {});
      res.end(data ? JSON.stringify(data) : undefined);
    };
    const id = req.headers["cf-access-client-id"];
    const secret = req.headers["cf-access-client-secret"];
    const token = [READ, WRITE].find((t) => t.id === id && t.secret === secret);
    seen.push(`${req.method} ${req.url}`);
    // Access: a token it doesn't know goes to its sign-in page.
    if (!token) {
      res.writeHead(302, { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" });
      return res.end();
    }
    // Drop with ACCESS_READ_ID set: the read token only looks.
    if (token === READ && req.method !== "GET")
      return send(403, { error: "forbidden", message: "This token may only read." });
    const raw = await body(req);
    const json = () => JSON.parse(raw.toString() || "{}");
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const d = parts[2] ? drops[parts[2]] : undefined;
    const summary = (x: FakeDrop) => ({
      address: x.address,
      title: x.title,
      gate: x.gate,
      pin: Boolean(x.pin),
      expires: x.expires,
      expired: Boolean(x.expired),
      peopleCount: Object.keys(x.people).length,
      requestCount: x.requests.filter(Boolean).length,
      link: x.link
        ? {
            role: x.link.role,
            ref: "ab12cd34",
            ...(x.link.secret ? { path: `/d/${x.address}.${x.link.secret}` } : {}),
          }
        : null,
      ...(x.by ? { by: x.by } : {}),
    });
    const detail = (x: FakeDrop) => ({
      ...summary(x),
      files: Object.entries(x.files).map(([name, b]) => ({ name, size: b.length })),
      people: Object.entries(x.people).map(([key, role]) => {
        const p = people.find((p) => p.id === key);
        return { key, role, ...(p ? { name: p.name, email: p.email } : { email: key }) };
      }),
      requests: x.requests.flatMap((email, i) => (email ? [{ id: `r${i}`, email }] : [])),
      limits: x.limits,
    });
    // A link is a path: the drop's address and a secret Drop keeps, so it shows it again.
    const link = (x: FakeDrop, role: string) => {
      x.link = { role, secret: `secret${++next}` };
      return `/d/${x.address}.${x.link.secret}`;
    };
    if (url.pathname === "/api/people") return send(200, { people });
    // A request is "<drop>.<its id>": allow takes a role (view by default), deny none.
    if (parts[1] === "requests" && req.method === "POST") {
      const [address, rid] = (parts[2] ?? "").split(".");
      const x = drops[address ?? ""];
      const at = Number(rid?.slice(1));
      const email = x?.requests[at];
      if (!x || !email) return send(404, { error: "not_found", message: "No such request." });
      if (parts[3] === "allow") x.people[email] = json().role ?? "view";
      x.requests[at] = "";
      return send(200, { ok: true });
    }
    if (url.pathname === "/api/drops" && req.method === "GET") {
      const bytes = Object.values(drops).flatMap((x) => Object.values(x.files));
      return send(200, {
        drops: Object.values(drops).map(summary),
        usage: { bytes: bytes.join("").length, capBytes: 9e9 },
      });
    }
    if (url.pathname === "/api/drops" && req.method === "POST") {
      const b = json();
      if (!["me", "view", "add", "people", "collect"].includes(b.gate))
        return send(400, { error: "bad_request", message: "Pick who can open it." });
      // A guest's drop starts as only theirs, for 30 days at most, with no PIN.
      if (b.by && (b.gate !== "me" || b.expiry === "keep" || b.pin))
        return send(400, { error: "bad_request", message: "A guest's drop starts as Only me." });
      const x: FakeDrop = {
        address: `w${String(++next).padStart(12, "0")}`,
        title: b.title,
        expires: b.expiry === "keep" ? null : "2026-11-04T08:00:00.000Z",
        gate: b.gate,
        pin: /^\d{6}$/.test(b.pin) ? b.pin : null,
        link: null,
        people: {},
        requests: [],
        files: {},
        limits: { mb: 2000, files: 500 },
        ...(b.by ? { by: b.by } : {}),
      };
      drops[x.address] = x;
      const made = ROLE[x.gate] ? link(x, ROLE[x.gate] as string) : undefined;
      return send(201, { drop: detail(x), ...(made ? { link: made } : {}) });
    }
    if (!d) return send(404, { error: "not_found", message: "No such drop." });
    if (parts[3] === "files" && req.method === "PUT") {
      if (parts[4] === "too-big.bin")
        return send(413, { error: "too_big", message: "A file can be 100 MB at most." });
      // A name already there gets a number.
      const name = (parts[4] as string) in d.files ? `2-${parts[4]}` : (parts[4] as string);
      d.files[name] = raw.toString();
      return send(201, { name, ticket: "t1" });
    }
    if (parts[3] === "links" && req.method === "POST")
      return send(201, { link: link(d, json().role) });
    if (req.method === "GET") return send(200, { drop: detail(d) });
    if (req.method === "PATCH") {
      const b = json();
      if ("by" in b || (d.by && b.limits))
        return send(400, { error: "bad_request", message: "Not on a guest's drop." });
      let made: string | undefined;
      if (b.gate) {
        // A drop keeps its link through every gate; one with a link role and no link gets one.
        const role = ROLE[b.gate];
        if (role && !d.link) made = link(d, role);
        else if (role && d.link) d.link.role = role;
        d.gate = b.gate;
      }
      for (const [who, role] of Object.entries(b.people ?? {}))
        if (role === null) delete d.people[who];
        else d.people[who] = role as string;
      if ("pin" in b) d.pin = b.pin;
      if ("title" in b) d.title = b.title;
      if (b.limits) d.limits = b.limits;
      if (b.expiry) d.expires = b.expiry === "keep" ? null : "2026-11-29T08:00:00.000Z";
      return send(200, { drop: detail(d), ...(made ? { link: made } : {}) });
    }
    if (parts[3] === "files" && req.method === "DELETE") {
      if (!((parts[4] as string) in d.files))
        return send(404, { error: "not_found", message: "No such file." });
      delete d.files[parts[4] as string];
      return send(204);
    }
    if (req.method === "DELETE") {
      delete drops[d.address];
      return send(204);
    }
    send(405, { error: "method", message: "Not here." });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server?.close();
});
beforeEach(() => {
  drops = {};
  seen = [];
});

const tool = loadTools().drop;

/** Look calls on our server over MCP (stdio), with these keys; each answer's text. */
async function look(keys: { id: string; secret: string } | undefined, list: [string, object][]) {
  const { command: cmd, args } = command(tool?.run as string[]);
  const child = spawn(cmd, args, {
    env: {
      PATH: process.env.PATH,
      DROP_URL: base,
      ...(keys ? { DROP_CLIENT_ID: keys.id, DROP_CLIENT_SECRET: keys.secret } : {}),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const answers = new Map<number, string>();
  let buf = "";
  const all = new Promise<void>((done) => {
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      for (const line of buf.split("\n").slice(0, -1)) {
        const m = JSON.parse(line) as {
          id: number;
          result?: { content?: { text: string }[]; isError?: boolean };
        };
        if (m.id > 0)
          answers.set(
            m.id,
            `${m.result?.isError ? "ERROR " : ""}${m.result?.content?.[0]?.text ?? ""}`,
          );
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
      if (answers.size === list.length) done();
    });
  });
  const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  send({
    id: 0,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {} },
  });
  send({ method: "notifications/initialized" });
  for (const [i, [name, a]] of list.entries())
    send({ id: i + 1, method: "tools/call", params: { name, arguments: a } });
  await all;
  child.stdin.end();
  child.kill();
  return list.map((_, i) => answers.get(i + 1) ?? "(no answer)");
}

/** The box's approved calls: the write token, and the task's shared files read from "GitHub". */
const shared = {
  "photo.jpg": {
    hash: "h1",
    url: "https://github.com/o/shipify/blob/shipify-files/task-9/2026-10-28T08-00-00-000Z/photo.jpg",
  },
  "notes.md": {
    hash: "h2",
    url: "https://github.com/o/shipify/blob/shipify-files/task-9/2026-10-28T08-00-00-000Z/notes.md",
  },
  "too-big.bin": {
    hash: "h3",
    url: "https://github.com/o/shipify/blob/shipify-files/task-9/2026-10-28T08-00-00-000Z/too-big.bin",
  },
};
const fetched: string[] = [];
const github = (async (url: string, init?: RequestInit) => {
  fetched.push(`${url} ${(init?.headers as Record<string, string> | undefined)?.authorization}`);
  const name = url.split("?")[0]?.split("/").pop() ?? "";
  return new Response(`the bytes of ${name}`);
}) as typeof fetch;
const act = (calls: { name: string; args: Record<string, unknown> }[], keys = WRITE) =>
  makeCalls(
    calls.map((c) => ({ tool: "drop", ...c })),
    {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GH_TOKEN: "read-token",
      SHIPIFY_DROP_URL: base,
      SHIPIFY_DROP_WRITE_ID: keys.id,
      SHIPIFY_DROP_WRITE_SECRET: keys.secret,
    },
    shared,
    github,
  );
const fake = (x: Partial<FakeDrop> & { address: string; title: string; gate: string }) => {
  drops[x.address] = {
    expires: null,
    pin: null,
    link: null,
    people: {},
    requests: [],
    files: {},
    limits: { mb: 2000, files: 500 },
    ...x,
  };
};

describe("tools: our Drop server, against a fake Drop", () => {
  it("lists drops and Drop's people with the read token, and finds one by its title", async () => {
    fake({
      address: "w000000000001",
      title: "Ladakh 2026",
      expires: "2026-11-04T08:00:00.000Z",
      gate: "view",
      pin: "123456",
      link: { role: "view", secret: "x" },
      requests: ["aunt@example.com"],
      files: { "a.jpg": "x", "b.jpg": "y" },
    });
    fake({
      address: "k000000000002",
      title: "Diwali",
      gate: "people",
      people: { p1: "view", "dad@example.com": "add" },
    });
    fake({
      address: "a000000000003",
      title: "Old",
      expires: "2026-10-01T08:00:00.000Z",
      expired: true,
      gate: "add",
      link: { role: "add", secret: null },
    });
    fake({
      address: "m000000000004",
      title: "Mine",
      gate: "me",
      link: { role: "view", secret: "y" },
    });
    const [all, one, byId] = await look(READ, [
      ["list", {}],
      ["list", { query: "ladakh" }],
      ["list", { query: "a000000000003" }],
    ]);
    expect(all).toBe(
      [
        "4 drops:",
        `- "Ladakh 2026" · id w000000000001 · anyone with the link can view, with a PIN · until 2026-11-04 · 1 request to answer · link ${base}/d/w000000000001.x`,
        `- "Diwali" · id k000000000002 · the people on it · 2 people · kept · people link ${base}/d/k000000000002`,
        '- "Old" · id a000000000003 · anyone with the link can view and add · expired · its link is from before Drop kept links: new_link makes one to copy',
        '- "Mine" · id m000000000004 · only you · kept',
        "Used 2 B of 9 GB in Drop.",
        "People in Drop: Mom, Dad.",
      ].join("\n"),
    );
    // One drop found: its files and limits too.
    expect(one).toBe(
      [
        '1 drop with "ladakh":',
        all?.split("\n")[1],
        "Its 2 files: a.jpg (1 B), b.jpg (1 B).",
        "It holds up to 2000 MB and 500 files.",
        "Asking to open it: aunt@example.com.",
        "Used 2 B of 9 GB in Drop.",
        "People in Drop: Mom, Dad.",
      ].join("\n"),
    );
    expect(byId).toContain('- "Old" · id a000000000003');
    expect(byId).toContain("No files in it yet.");
    expect(all).not.toContain("Its ");
  }, 60_000);

  it("makes a drop from the task's shared files on your yes, with its link and PIN, and leaves none by half", async () => {
    const [made] = await act([
      {
        name: "publish",
        args: { title: "Trip photos", files: ["photo.jpg", "notes.md"], share: "view", pin: true },
      },
    ]);
    expect(made?.ok).toBe(true);
    const d = Object.values(drops)[0] as FakeDrop;
    expect(d.pin).toMatch(/^\d{6}$/);
    expect(made?.text).toBe(
      [
        `Made "Trip photos" (drop ${d.address}), until 2026-11-04, with 2 files: photo.jpg, notes.md.`,
        `Anyone with the link can view: ${base}/d/${d.address}.${d.link?.secret}`,
        `PIN: ${d.pin} (asked before anything shows: send it apart from the link).`,
        `Manage it in Drop: ${base}/admin/d/${d.address}`,
      ].join("\n"),
    );
    // Each file as the task shared it, read from shipify-files with the run's read key.
    expect(d.files).toEqual({
      "photo.jpg": "the bytes of photo.jpg",
      "notes.md": "the bytes of notes.md",
    });
    expect(fetched).toContain(
      "https://api.github.com/repos/o/shipify/contents/task-9/2026-10-28T08-00-00-000Z/photo.jpg?ref=shipify-files Bearer read-token",
    );
    expect(d).toMatchObject({ gate: "view", link: { role: "view" } });

    // A file Drop refuses: the drop is removed, so nothing goes out by half.
    seen = [];
    const [half] = await act([
      {
        name: "publish",
        args: { title: "Half", files: ["notes.md", "too-big.bin"], share: "add" },
      },
    ]);
    expect(half?.ok).toBe(false);
    expect(half?.text).toBe(
      "Nothing was shared: too-big.bin couldn't be added (Drop refused the file as too big: A file can be 100 MB at most.), so the drop was removed.",
    );
    expect(Object.values(drops).map((x) => x.title)).toEqual(["Trip photos"]);
    expect(seen.at(-1)).toMatch(/^DELETE \/api\/drops\/w\d{12}$/);

    // A file the task never shared: nothing is fetched, and nothing reaches Drop.
    seen = [];
    const [unshared] = await act([
      { name: "publish", args: { title: "x", files: ["secret.txt"], share: "view" } },
    ]);
    expect(unshared?.text).toBe(
      "secret.txt: not among this task's shared files, so nothing was made",
    );
    expect(seen).toEqual([]);
  }, 60_000);

  // ADR 0069: a file you sent from the web chat, by the ref on this task's own from-line, fetched
  // from the door: no copy on the shipify-files branch.
  it("makes a drop of a file you sent, by its ref, fetched from the door; only a ref on the task", async () => {
    const ref = "web:f-8000000000000-0123456789abcdef0123";
    const asked: string[] = [];
    const fromDoor = async (r: string) => {
      asked.push(r);
      return Buffer.from("the bytes you sent");
    };
    const call = (refs: Record<string, string>) =>
      makeCalls(
        [{ tool: "drop", name: "publish", args: { title: "Sent", files: [ref], share: "me" } }],
        {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          GH_TOKEN: "read-token",
          SHIPIFY_DROP_URL: base,
          SHIPIFY_DROP_WRITE_ID: WRITE.id,
          SHIPIFY_DROP_WRITE_SECRET: WRITE.secret,
        },
        shared,
        github,
        refs,
        fromDoor,
      );
    fetched.length = 0;
    const [made] = await call({ [ref]: "my photo.jpg" });
    expect(made?.ok).toBe(true);
    const d = Object.values(drops).find((x) => x.title === "Sent") as FakeDrop;
    expect(d.files).toEqual({ "my-photo.jpg": "the bytes you sent" });
    expect(asked).toEqual([ref]);
    // Nothing read from the branch.
    expect(fetched).toEqual([]);
    // A ref not on this task's from-lines: nothing is fetched.
    asked.length = 0;
    const [other] = await call({});
    expect(other?.text).toBe(`${ref}: not among this task's shared files, so nothing was made`);
    expect(asked).toEqual([]);
  }, 60_000);

  it("shares with people by name or email, and collects files with no files of its own", async () => {
    const [made, collect, nobody] = await act([
      {
        name: "publish",
        args: {
          title: "Diwali",
          files: ["photo.jpg"],
          share: "people",
          people: { mom: "view", "Dad@Example.com": "add", "aunt@example.com": "view" },
          expiry: "keep",
        },
      },
      { name: "publish", args: { title: "Send me your photos", share: "collect" } },
      {
        name: "publish",
        args: { title: "x", files: ["photo.jpg"], share: "people", people: { Aunt: "view" } },
      },
    ]);
    const [d, c] = Object.values(drops) as FakeDrop[];
    // A person Drop knows by their id (Dad by his email too); anyone else by their email.
    expect(d?.people).toEqual({ p1: "view", p2: "add", "aunt@example.com": "view" });
    expect(made?.text).toContain("kept, with 1 file: photo.jpg.");
    expect(made?.text).toContain(
      `Shared with mom (view), Dad@Example.com (add), aunt@example.com (view): it's on their home pages, and its people link is ${base}/d/${d?.address}`,
    );
    expect(collect?.text).toContain("no files yet");
    expect(collect?.text).toContain(
      `Anyone with the link can send files (and sees only their own): ${base}/d/${c?.address}.${c?.link?.secret}`,
    );
    expect(c?.link?.role).toBe("send");
    expect(nobody?.text).toBe(
      'No one called "Aunt" in Drop\'s People: add them there first (Drop → People), or give an email.',
    );
    expect(Object.keys(drops)).toHaveLength(2);
  }, 60_000);

  it("changes a drop: who may open it, people, a new link that stops the old one, and revokes it", async () => {
    await act([{ name: "publish", args: { title: "Plans", files: ["notes.md"], share: "me" } }]);
    const d = Object.values(drops)[0] as FakeDrop;
    const a = d.address;
    const linkTo = () => `${base}/d/${a}.${d.link?.secret}`;
    const [opened] = await act([
      { name: "update", args: { drop: a, share: "view", people: { Mom: "add" }, pin: true } },
    ]);
    expect(opened?.text).toBe(
      [
        `Updated "Plans" (drop ${a}):`,
        "- who may open it: anyone with the link can view",
        "- Mom can add",
        `- PIN: ${d.pin} (the old one stops)`,
        `- Anyone with the link can view: ${linkTo()}`,
      ].join("\n"),
    );
    const kept = linkTo();
    const [again, more, less, renewed] = await act([
      // The same option again, by its link: nothing changes.
      { name: "update", args: { drop: `${base}/d/${a}.whatever`, share: "view" } },
      { name: "update", args: { drop: a, share: "add" } },
      { name: "update", args: { drop: a, share: "view" } },
      { name: "update", args: { drop: a, new_link: true, remove: ["mom"] } },
    ]);
    expect(again?.text).toBe(
      `Updated "Plans" (drop ${a}):\n- who may open it: anyone with the link can view, as before`,
    );
    // Drop 0.3.0 keeps the link through a change of who may open it; new_link ends it.
    expect(kept).not.toBe(linkTo());
    expect(more?.text).toBe(
      [
        `Updated "Plans" (drop ${a}):`,
        "- who may open it: anyone with the link can view and add",
        `- Anyone with the link can view and add: ${kept} (the same link)`,
      ].join("\n"),
    );
    expect(less?.text).toContain(`- Anyone with the link can view: ${kept} (the same link)`);
    expect(renewed?.text).toBe(
      [
        `Updated "Plans" (drop ${a}):`,
        "- mom taken off",
        `- Anyone with the link can view: ${linkTo()} (the old link stops now)`,
      ].join("\n"),
    );
    expect(d.people).toEqual({});
    const [revoked, gone] = await act([
      { name: "revoke", args: { drop: a } },
      { name: "update", args: { drop: a, pin: false } },
    ]);
    expect(revoked?.text).toBe(`Revoked drop ${a}: its links stop now, and its files are deleted.`);
    expect(gone?.ok).toBe(false);
    expect(gone?.text).toBe("No such drop: it was revoked, or it expired.");
    expect(drops).toEqual({});
  }, 60_000);

  it("changes a drop's title, expiry and limits in one request, and adds and deletes its files", async () => {
    const a = "w000000000001";
    fake({ address: a, title: "Plans", gate: "view", files: { "old.txt": "x", "notes.md": "y" } });
    const [changed, half] = await act([
      {
        name: "update",
        args: {
          drop: a,
          title: "Trip plans",
          expiry: "30d",
          limits: { files: 50 },
          delete_files: ["old.txt"],
          files: ["photo.jpg", "notes.md"],
        },
      },
      { name: "update", args: { drop: a, files: ["photo.jpg", "too-big.bin"] } },
    ]);
    expect(changed?.text).toBe(
      [
        `Updated "Plans" (drop ${a}):`,
        '- title: "Trip plans"; expires 2026-11-29; holds up to 2000 MB and 50 files',
        "- deleted old.txt",
        "- added photo.jpg",
        "- added 2-notes.md",
      ].join("\n"),
    );
    expect(seen.filter((s) => s.startsWith("PATCH"))).toHaveLength(1);
    expect(half?.ok).toBe(false);
    expect(half?.text).toBe(
      "Done: added 2-photo.jpg. Then: too-big.bin couldn't be added (Drop refused the file as too big: A file can be 100 MB at most.)",
    );
    expect(drops[a]).toMatchObject({
      title: "Trip plans",
      expires: "2026-11-29T08:00:00.000Z",
      limits: { mb: 2000, files: 50 },
      files: {
        "notes.md": "y",
        "photo.jpg": "the bytes of photo.jpg",
        "2-notes.md": "the bytes of notes.md",
        "2-photo.jpg": "the bytes of photo.jpg",
      },
    });
    expect(drops[a]?.files).not.toHaveProperty("old.txt");
  }, 60_000);

  it("answers who asked to open a drop, as Drop's Requests page does", async () => {
    const a = "k000000000002";
    fake({
      address: a,
      title: "Diwali",
      gate: "people",
      requests: ["aunt@example.com", "spam@example.com"],
    });
    const [answered, unknown] = await act([
      {
        name: "update",
        args: { drop: a, requests: { "Aunt@example.com": "add", "spam@example.com": "deny" } },
      },
      { name: "update", args: { drop: a, requests: { "who@example.com": "view" } } },
    ]);
    expect(answered?.text).toBe(
      [
        `Updated "Diwali" (drop ${a}):`,
        "- aunt@example.com can add",
        "- spam@example.com turned down",
      ].join("\n"),
    );
    expect(seen).toContain(`POST /api/requests/${a}.r0/allow`);
    expect(seen).toContain(`POST /api/requests/${a}.r1/deny`);
    expect(drops[a]?.people).toEqual({ "aunt@example.com": "add" });
    expect(unknown?.ok).toBe(false);
    expect(unknown?.text).toContain("who@example.com hasn't asked to open this drop.");
  }, 60_000);

  it("says plainly when Access or Drop refuses the token, and refuses arguments that don't fit", async () => {
    // The read token can't change anything (Drop refuses its writes, with ACCESS_READ_ID set).
    const [readOnly] = await act(
      [{ name: "publish", args: { title: "x", files: ["notes.md"], share: "view" } }],
      READ,
    );
    expect(readOnly?.text).toMatch(/^Drop refused the key \(This token may only read\)/);
    expect(readOnly?.text).toContain("pnpm ship add drop --new --yes");
    const [wrong, unset] = await Promise.all([
      look({ id: "nope", secret: "nope" }, [["list", {}]]),
      look(undefined, [["list", {}]]),
    ]);
    expect(wrong[0]).toMatch(/^ERROR Cloudflare Access sent the request to its sign-in page/);
    expect(unset[0]).toMatch(
      /^ERROR Drop isn't connected on this run: its service token isn't set/,
    );
    fake({ address: "w000000000001", title: "Plans", gate: "me" });
    const bad = await act([
      { name: "publish", args: { title: "x", share: "view" } },
      { name: "publish", args: { title: "x", files: ["notes.md"], share: "people" } },
      { name: "publish", args: { title: "x", files: ["notes.md"], share: "view", expiry: "1y" } },
      { name: "publish", args: { title: "x", files: ["notes.md"], share: "me", pin: true } },
      { name: "update", args: { drop: "w000000000001" } },
      { name: "update", args: { drop: "w000000000001", new_link: true } },
      { name: "update", args: { drop: "w000000000001", remove: ["Mom"] } },
      { name: "update", args: { drop: "w000000000001", limits: { mb: 0 } } },
      { name: "update", args: { drop: "w000000000001", limits: { pages: 3 } } },
      { name: "update", args: { drop: "w000000000001", title: "x".repeat(121) } },
      { name: "update", args: { drop: "w000000000001", delete_files: ["nope.txt"] } },
    ]);
    expect(bad.map((b) => b.text)).toEqual([
      'Name the files to share in "files" (a drop that collects files needs none).',
      'Share with "people" names them in "people".',
      '"expiry" is one of: 1d, 7d, 30d, keep.',
      'A PIN guards a link: share "me" has none.',
      "Say what to change: title, expiry, limits, files, delete_files, share, people, remove, requests, pin or new_link.",
      '"new_link" needs share view, add or collect: this drop is "me".',
      "Mom isn't on this drop.",
      '"limits" is { "mb": 1 to 2000, "files": 1 to 5000 }.',
      '"limits" is { "mb": 1 to 2000, "files": 1 to 5000 }.',
      '"title" is 120 characters at most.',
      "nope.txt isn't in this drop.",
    ]);
    expect(seen.some((s) => s.startsWith("PATCH"))).toBe(false);
    expect(Object.keys(drops)).toEqual(["w000000000001"]);
  }, 60_000);

  // ADR 0073: every new drop is only its owner's, unless the words say who.
  it("makes a drop with no `share` only yours, and says how to share it", async () => {
    const [made] = await act([{ name: "publish", args: { title: "Report", files: ["notes.md"] } }]);
    const d = Object.values(drops)[0] as FakeDrop;
    expect(d).toMatchObject({ gate: "me", link: null });
    expect(d.by).toBeUndefined();
    expect(made?.text).toBe(
      [
        `Made "Report" (drop ${d.address}), until 2026-11-04, with 1 file: notes.md.`,
        "Only you can open it. To share it: its page in Drop, or ask for anyone with the link, or names.",
        `Manage it in Drop: ${base}/admin/d/${d.address}`,
      ].join("\n"),
    );
  }, 60_000);

  // ADR 0073: a guest's calls, with SHIPIFY_GUEST from the door and their files from the run's folder.
  describe("for a guest", () => {
    const ANA = { email: "ana@example.com", name: "Ana" };
    const dir = mkdtempSync(join(tmpdir(), "drop-guest-"));
    writeFileSync(join(dir, "trip.html"), "<h1>Goa</h1>");
    const local = { "trip.html": join(dir, "trip.html") };
    const asGuest = (calls: { name: string; args: Record<string, unknown> }[]) =>
      makeCalls(
        calls.map((c) => ({ tool: "drop", ...c })),
        {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SHIPIFY_DROP_URL: base,
          SHIPIFY_DROP_WRITE_ID: WRITE.id,
          SHIPIFY_DROP_WRITE_SECRET: WRITE.secret,
        },
        {},
        github,
        {},
        undefined,
        { local, guest: ANA },
      );

    it("makes a drop only they can open, `by` them, for 30 days, and names no email", async () => {
      fetched.length = 0;
      const [made] = await asGuest([
        { name: "publish", args: { title: "Goa trip", files: ["trip.html"], share: "me" } },
      ]);
      expect(made?.ok).toBe(true);
      const d = Object.values(drops)[0] as FakeDrop;
      expect(d).toMatchObject({ gate: "me", by: ANA, files: { "trip.html": "<h1>Goa</h1>" } });
      expect(seen).toContain("POST /api/drops");
      expect(made?.text).toBe(
        [
          `Made "Goa trip" (drop ${d.address}), until 2026-11-04, with 1 file: trip.html.`,
          `Only you can open it, signed in: ${base}/d/${d.address}`,
          `Manage it in Drop: ${base}/mine/d/${d.address}`,
        ].join("\n"),
      );
      expect(made?.text).not.toContain("ana@");
      // Their file came from the run's folder: nothing read from the branch.
      expect(fetched).toEqual([]);
    }, 60_000);

    it("changes only the title and files of a drop made for them", async () => {
      fake({
        address: "g000000000001",
        title: "Goa",
        gate: "me",
        by: ANA,
        files: { "trip.html": "old" },
      });
      fake({
        address: "g000000000002",
        title: "Ben's",
        gate: "me",
        by: { email: "ben@example.com", name: "Ben" },
      });
      fake({ address: "y000000000003", title: "Yours", gate: "view" });
      const [changed, bens, yours] = await asGuest([
        {
          name: "update",
          args: {
            drop: `${base}/d/g000000000001`,
            title: "Goa, 12-14 Dec",
            delete_files: ["trip.html"],
            files: ["trip.html"],
          },
        },
        { name: "update", args: { drop: "g000000000002", files: ["trip.html"] } },
        { name: "update", args: { drop: "y000000000003", title: "Mine now" } },
      ]);
      expect(changed?.text).toBe(
        [
          'Updated "Goa" (drop g000000000001):',
          '- title: "Goa, 12-14 Dec"',
          "- deleted trip.html",
          "- added trip.html",
          `- its link stays the same: ${base}/d/g000000000001`,
          `Manage it in Drop: ${base}/mine/d/g000000000001`,
        ].join("\n"),
      );
      expect(drops.g000000000001).toMatchObject({
        title: "Goa, 12-14 Dec",
        files: { "trip.html": "<h1>Goa</h1>" },
      });
      for (const r of [bens, yours]) {
        expect(r?.ok).toBe(false);
        expect(r?.text).toBe("That drop isn't one made for you, so nothing was changed.");
        expect(r?.text).not.toContain("ben@");
      }
      expect(drops.g000000000002?.files).toEqual({});
      expect(drops.y000000000003?.title).toBe("Yours");
    }, 60_000);

    it("shares nothing and revokes nothing", async () => {
      fake({ address: "g000000000001", title: "Goa", gate: "me", by: ANA });
      const shares =
        "Only you can open a drop made for you: share it in Drop's My drops (a link, or people by email).";
      const out = await asGuest([
        { name: "publish", args: { title: "x", files: ["trip.html"], share: "view" } },
        {
          name: "publish",
          args: { title: "x", files: ["trip.html"], people: { "sam@example.com": "view" } },
        },
        { name: "publish", args: { title: "x", files: ["trip.html"], expiry: "keep" } },
        { name: "update", args: { drop: "g000000000001", share: "view" } },
        { name: "update", args: { drop: "g000000000001", expiry: "keep" } },
        { name: "revoke", args: { drop: "g000000000001" } },
      ]);
      expect(out.map((r) => r.text)).toEqual([
        shares,
        shares,
        '"expiry" is one of: 1d, 7d, 30d.',
        `A guest's run changes only a drop's title and files. ${shares}`,
        `A guest's run changes only a drop's title and files. ${shares}`,
        "A guest's run makes and changes only their own drops.",
      ]);
      expect(Object.keys(drops)).toEqual(["g000000000001"]);
      expect(drops.g000000000001?.gate).toBe("me");
    }, 60_000);
  });

  it("reads a drop's id from its link, and sends its key only over https", () => {
    expect(idOf("w3k9xq2m7p4a1")).toBe("w3k9xq2m7p4a1");
    expect(idOf("https://drop.example.com/d/w3k9xq2m7p4a1.Zm9vYmFy?x=1")).toBe("w3k9xq2m7p4a1");
    expect(idOf("https://drop.example.com/admin/d/w3k9xq2m7p4a1")).toBe("w3k9xq2m7p4a1");
    expect(() => idOf("the Diwali one")).toThrow("isn't a drop's id or link");
    expect(baseOf("https://drop.example.com/")).toBe("https://drop.example.com");
    expect(() => baseOf("drop.example.com")).toThrow("like https://drop.example.com");
    expect(() => baseOf('"https://drop.example.com"')).toThrow("like https://drop.example.com");
    expect(baseOf("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(() => baseOf("http://drop.example.com")).toThrow("must start with https://");
    expect(explain(404, {})).toBe("No such drop: it was revoked, or it expired.");
    expect(explain(400, { error: "bad_request", message: "Pick who can open it." })).toBe(
      "Drop didn't accept that: Pick who can open it.",
    );
  });
});
