// Our Drop tool (docs/tools.md, Drop), end to end against a fake Drop: its server over MCP with the
// read token, and the box's approved calls (makeCalls) with the write token and the task's shared
// files. The fake answers as docs/tools.md says Drop's /api does (Drop 0.2.0, as its admin page
// calls it), and as Access does for a token it doesn't know (its sign-in page).
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
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
  gate: string;
  pin: string | null;
  link: { role: string; secret: string } | null;
  people: Record<string, string>;
  requests: string[];
  files: Record<string, string>;
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
      peopleCount: Object.keys(x.people).length,
      requestCount: x.requests.length,
      link: x.link ? { role: x.link.role, ref: "ab12cd34" } : null,
    });
    const detail = (x: FakeDrop) => ({
      ...summary(x),
      files: Object.entries(x.files).map(([name, b]) => ({ name, size: b.length })),
      people: Object.entries(x.people).map(([key, role]) => {
        const p = people.find((p) => p.id === key);
        return { key, role, ...(p ? { name: p.name, email: p.email } : { email: key }) };
      }),
      requests: x.requests.map((email, i) => ({ id: `r${i}`, email })),
      limits: { mb: 2000, files: 500 },
    });
    // A link is a path: the drop's address and a secret Drop keeps only the hash of.
    const link = (x: FakeDrop, role: string) => {
      x.link = { role, secret: `secret${++next}` };
      return `/d/${x.address}.${x.link.secret}`;
    };
    if (url.pathname === "/api/people") return send(200, { people });
    if (url.pathname === "/api/drops" && req.method === "GET")
      return send(200, { drops: Object.values(drops).map(summary) });
    if (url.pathname === "/api/drops" && req.method === "POST") {
      const b = json();
      if (!["me", "view", "add", "people", "collect"].includes(b.gate))
        return send(400, { error: "bad_request", message: "Pick who can open it." });
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
      };
      drops[x.address] = x;
      const made = ROLE[x.gate] ? link(x, ROLE[x.gate] as string) : undefined;
      return send(201, { drop: detail(x), ...(made ? { link: made } : {}) });
    }
    if (!d) return send(404, { error: "not_found", message: "No such drop." });
    if (parts[3] === "files" && req.method === "PUT") {
      if (parts[4] === "too-big.bin")
        return send(413, { error: "too_big", message: "A file can be 100 MB at most." });
      d.files[parts[4] as string] = raw.toString();
      return send(201, { name: parts[4], ticket: "t1" });
    }
    if (parts[3] === "links" && req.method === "POST")
      return send(201, { link: link(d, json().role) });
    if (req.method === "GET") return send(200, { drop: detail(d) });
    if (req.method === "PATCH") {
      const b = json();
      let made: string | undefined;
      if (b.gate) {
        // Only me ends the link and every person's access; a gate that gives more makes a new link.
        const role = ROLE[b.gate];
        if (!role) d.link = null;
        if (b.gate === "me") d.people = {};
        if (role && d.link?.role === "add" && role === "view") d.link.role = "view";
        else if (role && d.link?.role !== role) made = link(d, role);
        d.gate = b.gate;
      }
      for (const [who, role] of Object.entries(b.people ?? {}))
        if (role === null) delete d.people[who];
        else d.people[who] = role as string;
      if ("pin" in b) d.pin = b.pin;
      return send(200, { drop: detail(d), ...(made ? { link: made } : {}) });
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
    });
    fake({
      address: "k000000000002",
      title: "Diwali",
      gate: "people",
      people: { p1: "view", "dad@example.com": "add" },
    });
    const [all, one] = await look(READ, [
      ["list", {}],
      ["list", { query: "ladakh" }],
    ]);
    expect(all).toBe(
      [
        "2 drops:",
        '- "Ladakh 2026" · id w000000000001 · anyone with the link can view, with a PIN · until 2026-11-04 · 1 request to answer',
        '- "Diwali" · id k000000000002 · the people on it · 2 people · kept',
        "People in Drop: Mom, Dad.",
      ].join("\n"),
    );
    expect(one).toContain('1 drop with "ladakh":');
    expect(one).not.toContain("Diwali");
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
    expect(more?.text).toContain("- who may open it: anyone with the link can view and add\n");
    expect(more?.text).toMatch(
      /- Anyone with the link can view and add: .*\(the old link stops now\)$/,
    );
    expect(less?.text).toContain(
      "- its link stays the same: new_link makes a new one, and the old one stops",
    );
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
    ]);
    expect(bad.map((b) => b.text)).toEqual([
      'Name the files to share in "files" (a drop that collects files needs none).',
      'Share with "people" names them in "people".',
      '"expiry" is one of: 1d, 7d, 30d, keep.',
      'A PIN guards a link: share "me" has none.',
      "Say what to change: share, people, remove, pin or new_link.",
      '"new_link" needs share view, add or collect: this drop is "me".',
      "Mom isn't on this drop.",
    ]);
    expect(Object.keys(drops)).toEqual(["w000000000001"]);
  }, 60_000);

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
