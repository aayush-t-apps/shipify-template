// The run's look server (ADR 0077): the gate in front of the tools' servers, which holds their look
// keys so the agent holds only the run's token. In process for the gate's rules (serveLook on two
// streams), and once as think starts it (`ship run look`, off a box: as you).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  fromEvents,
  type LookTools,
  lookMissing,
  lookTools,
  MAX_BODY,
  sameToken,
  serveLook,
  startLook,
} from "../cli/kernel/look.ts";
import { offered } from "../cli/lib/plugins/agent.ts";
import { loadTools, type Tools } from "../cli/lib/tools.ts";
import { ROOT } from "./helpers.ts";

const TOKEN = "t".repeat(43);
const NODE = process.execPath;

/**
 * A stand-in tool's server over stdio: it logs each message's method (and a call's name) to LOG,
 * and the key it got (JOT_KEY) to KEYS, so a test sees what reached it. `crash` ends it.
 */
const FAKE = `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
appendFileSync(process.env.KEYS, (process.env.JOT_KEY ?? "none") + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  appendFileSync(process.env.LOG, [m.method, m.params?.name].filter(Boolean).join(" ") + "\\n");
  if (m.id === undefined) return;
  if (m.method === "initialize")
    send({ id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "jot", version: "1" } } });
  else if (m.method === "tools/list")
    send({ id: m.id, result: { tools: ["list", "add", "crash"].map((name) => ({ name, inputSchema: { type: "object" } })) } });
  else if (m.params?.name === "crash") process.exit(1);
  else send({ id: m.id, result: { content: [{ type: "text", text: "listed " + JSON.stringify(m.params.arguments) }] } });
});
`;

/** The calls a tools/list answer gives. */
const names = (list: { result?: Record<string, unknown> }) =>
  ((list.result?.tools ?? []) as { name: string }[]).map((t) => t.name);

const servers: Server[] = [];
const inputs: PassThrough[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const i of inputs.splice(0)) i.end();
});

/** A stand-in tool, and the look server in this process with it: its first line, and its output. */
async function served(tools?: (dir: string) => LookTools) {
  const dir = mkdtempSync(join(tmpdir(), "look-"));
  const fake = join(dir, "jot.mjs");
  writeFileSync(fake, FAKE);
  const log = join(dir, "log");
  const keys = join(dir, "keys");
  writeFileSync(log, "");
  writeFileSync(keys, "");
  const input = new PassThrough();
  const output = new PassThrough();
  inputs.push(input);
  const said: Record<string, unknown>[] = [];
  let ready: (r: Record<string, unknown>) => void = () => {};
  const isReady = new Promise<Record<string, unknown>>((r) => {
    ready = r;
  });
  output.on("data", (b: Buffer) => {
    for (const line of b.toString().split("\n").filter(Boolean)) {
      const m = JSON.parse(line) as Record<string, unknown>;
      said.push(m);
      if (m.ready) ready(m.ready as Record<string, unknown>);
    }
  });
  const ended = serveLook({ input, output });
  input.write(
    `${JSON.stringify({
      token: TOKEN,
      tools: tools?.(dir) ?? {
        jot: {
          run: [NODE, fake],
          env: { JOT_KEY: "the-look-key", LOG: log, KEYS: keys },
          look: ["list", "crash"],
        },
      },
    })}\n`,
  );
  const r = (await isReady) as { port: number; tools: string[]; missing: unknown[] };
  const url = `http://127.0.0.1:${r.port}`;
  let id = 0;
  /** One message to a tool, with the run's token unless `token` says otherwise. */
  const post = (tool: string, body: unknown, token: string | null = TOKEN) =>
    fetch(`${url}/${tool}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const ask = async (method: string, params: unknown = {}, tool = "jot") => {
    const r = await post(tool, { jsonrpc: "2.0", id: ++id, method, params });
    return (await r.json()) as { result?: Record<string, unknown>; error?: { message: string } };
  };
  const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean);
  return {
    ready: r,
    url,
    post,
    ask,
    said,
    log: () => lines(log),
    keys: () => lines(keys),
    end: async () => {
      input.end();
      await ended;
    },
  };
}

describe("the look server (ADR 0077)", () => {
  it("serves a tool's look calls with the run's token, and refuses a request without it", async () => {
    const s = await served();
    expect(s.ready.tools).toEqual(["jot"]);
    expect(s.ready.missing).toEqual([]);
    // Its key reached the tool's server, which the look server started once.
    expect(s.keys()).toEqual(["the-look-key"]);
    expect(
      (await s.post("jot", { jsonrpc: "2.0", id: 1, method: "tools/list" }, null)).status,
    ).toBe(401);
    expect(
      (await s.post("jot", { jsonrpc: "2.0", id: 1, method: "tools/list" }, "x".repeat(43))).status,
    ).toBe(401);
    // Only its look calls, as its server lists them: never `add`, an act call.
    const list = await s.ask("tools/list");
    expect(names(list)).toEqual(["list", "crash"]);
    const call = await s.ask("tools/call", { name: "list", arguments: { q: "rent" } });
    expect(call.result).toEqual({ content: [{ type: "text", text: 'listed {"q":"rent"}' }] });
    // Each call it sent on is said, for the run's record (`looked`).
    expect(s.said).toContainEqual({ called: "jot.list" });
    await s.end();
  });

  it("refuses an act call, or one the run doesn't offer, and sends it nowhere", async () => {
    const s = await served();
    for (const name of ["add", "delete_everything", 42]) {
      const r = await s.ask("tools/call", { name, arguments: {} });
      expect(r.result?.isError).toBe(true);
      expect(JSON.stringify(r.result)).toContain("isn't a look call of this run");
    }
    expect(s.log().filter((l) => l.startsWith("tools/call"))).toEqual([]);
    expect(s.said.filter((m) => m.called)).toEqual([]);
    await s.end();
  });

  it("answers initialize and ping itself: the tool's server is initialized once", async () => {
    const s = await served();
    for (const version of ["2025-11-25", "not a version"]) {
      const init = await s.ask("initialize", {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "an-agent", version: "1" },
      });
      expect(init.result).toMatchObject({
        protocolVersion: version === "2025-11-25" ? version : "2025-06-18",
        capabilities: { tools: {} },
      });
    }
    expect((await s.ask("ping")).result).toEqual({});
    expect((await s.ask("resources/list")).error?.message).toContain("isn't served here");
    expect(s.log()).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    await s.end();
  });

  it("speaks JSON only: 202 to a notification, 405 to a GET, 404 elsewhere, 413 past 1 MB, 400 to junk", async () => {
    const s = await served();
    expect(
      (await s.post("jot", { jsonrpc: "2.0", method: "notifications/initialized" })).status,
    ).toBe(202);
    const get = await fetch(`${s.url}/jot`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(get.status).toBe(405);
    expect((await s.post("other", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { x: "y".repeat(MAX_BODY) },
    });
    expect((await s.post("jot", big)).status).toBe(413);
    expect((await s.post("jot", "not json")).status).toBe(400);
    expect((await s.post("jot", [{ jsonrpc: "2.0", id: 1, method: "ping" }])).status).toBe(400);
    // Nothing of these reached the tool's server.
    expect(s.log()).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    await s.end();
  });

  it("answers an error when a tool's server ends mid-run, and goes on for the rest", async () => {
    const s = await served();
    const crash = await s.ask("tools/call", { name: "crash", arguments: {} });
    expect(crash.result?.isError).toBe(true);
    expect(JSON.stringify(crash.result)).toContain("its server ended");
    const after = await s.ask("tools/call", { name: "list", arguments: {} });
    expect(after.result?.isError).toBe(true);
    expect((await s.ask("ping")).result).toEqual({});
    await s.end();
  });

  it("leaves out a tool whose server doesn't start, and says why", async () => {
    const s = await served(() => ({
      gone: { run: [join(tmpdir(), "no-such-server")], look: ["list"] },
    }));
    expect(s.ready.tools).toEqual([]);
    expect(s.ready.missing).toEqual([
      { tool: "gone", why: expect.stringContaining("its server didn't start") },
    ]);
    expect((await s.post("gone", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
    await s.end();
  });

  it("serves a remote tool the same way, its keys in its headers, its answers JSON or an event stream", async () => {
    const seen: { auth?: string; session?: string; method: string }[] = [];
    const remote = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        if (req.method === "DELETE") return res.writeHead(200).end();
        const m = JSON.parse(body);
        seen.push({
          auth: req.headers.authorization,
          session: req.headers["mcp-session-id"] as string | undefined,
          method: m.method,
        });
        if (m.id === undefined) return res.writeHead(202).end();
        const result =
          m.method === "initialize"
            ? { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
            : m.method === "tools/list"
              ? { tools: [{ name: "search", inputSchema: { type: "object" } }, { name: "write" }] }
              : { content: [{ type: "text", text: "found it" }] };
        const json = JSON.stringify({ jsonrpc: "2.0", id: m.id, result });
        if (m.method === "tools/call")
          return res
            .writeHead(200, { "content-type": "text/event-stream" })
            .end(`event: message\ndata: ${json}\n\n`);
        res
          .writeHead(200, {
            "content-type": "application/json",
            ...(m.method === "initialize" ? { "mcp-session-id": "s-1" } : {}),
          })
          .end(json);
      });
    });
    servers.push(remote);
    await new Promise<void>((r) => remote.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${(remote.address() as AddressInfo).port}/mcp`;
    const s = await served(() => ({
      web: { url: at, headers: { Authorization: "Bearer the-remote-key" }, look: ["search"] },
    }));
    expect(s.ready.tools).toEqual(["web"]);
    const list = await s.ask("tools/list", {}, "web");
    expect(names(list)).toEqual(["search"]);
    const call = await s.ask("tools/call", { name: "search", arguments: {} }, "web");
    expect(call.result).toEqual({ content: [{ type: "text", text: "found it" }] });
    expect(seen.map((x) => x.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    expect(seen.every((x) => x.auth === "Bearer the-remote-key")).toBe(true);
    expect(seen.slice(1).every((x) => x.session === "s-1")).toBe(true);
    await s.end();
  });

  it("compares the token in constant time, and reads an event stream's answer by its id", () => {
    expect(sameToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(sameToken(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(sameToken(TOKEN, TOKEN)).toBe(false);
    expect(sameToken(undefined, TOKEN)).toBe(false);
    const two =
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":7,"result":{}}\n\n';
    expect(fromEvents(two, 7)).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
    expect(fromEvents(two, 8)).toBeUndefined();
  });

  it("gets each ready tool's look keys, never an act key; the agent gets the served tools as remote ones, with only the run's token", () => {
    const tools = loadTools(join(ROOT, "tools.json"));
    const env = {
      SHIPIFY_NOTION_READ: "ntn-read",
      SHIPIFY_NOTION_WRITE: "ntn-write",
      SHIPIFY_DROP_URL: "https://drop.example.com",
      SHIPIFY_DROP_READ_ID: "id",
      SHIPIFY_DROP_READ_SECRET: "secret",
      SHIPIFY_DROP_WRITE_SECRET: "drop-write",
    };
    const given = lookTools(tools, "/opt/shipify/tool/shipify-app/abc", env);
    expect(Object.keys(given).sort()).toEqual(["drop", "notion"]);
    expect(given.notion).toEqual({
      run: ["node", "/opt/shipify/tool/shipify-app/abc/tools/notion/server.ts"],
      env: { NOTION_TOKEN: "ntn-read" },
      look: ["search", "read_page", "read_database", "query_database"],
    });
    expect(JSON.stringify(given)).not.toMatch(/ntn-write|drop-write/);
    // A remote tool's keys go in its headers, for the look server alone.
    const remote: Tools = {
      web: {
        description: "x",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: `Bearer \${WEB_KEY}` },
        keys: { WEB_KEY: { look: "SHIPIFY_WEB_READ" } },
        look: ["search"],
        act: [],
      },
    };
    expect(lookTools(remote, "/r", { SHIPIFY_WEB_READ: "web-key" }).web).toEqual({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer web-key" },
      look: ["search"],
    });
    // What the agent's adapters get: the served tools, each at the look server, no key of its own.
    expect(offered(tools)).toEqual({});
    const mine = offered(tools, { url: "http://127.0.0.1:4000", tools: ["notion"] });
    expect(Object.keys(mine)).toEqual(["notion"]);
    expect(mine.notion).toMatchObject({
      url: "http://127.0.0.1:4000/notion",
      headers: { Authorization: `Bearer \${SHIPIFY_LOOK_TOKEN}` },
      keys: {},
      look: tools.notion?.look,
      act: tools.notion?.act,
    });
    expect(mine.notion?.run).toBeUndefined();
  });

  it("starts as think starts it (`ship run look`), and ends when think closes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "look-start-"));
    const fake = join(dir, "jot.mjs");
    writeFileSync(fake, FAKE);
    writeFileSync(join(dir, "log"), "");
    writeFileSync(join(dir, "keys"), "");
    const started = await startLook(
      {
        jot: {
          run: [NODE, fake],
          env: { JOT_KEY: "k", LOG: join(dir, "log"), KEYS: join(dir, "keys") },
          look: ["list"],
        },
      },
      `${NODE} ${join(ROOT, "cli", "ship.mjs")}`,
    );
    if (!("look" in started)) throw new Error(started.why);
    const { look } = started;
    expect(look.tools).toEqual(["jot"]);
    expect(look.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const r = await fetch(`${look.url}/jot`, {
      method: "POST",
      headers: { authorization: `Bearer ${look.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list" },
      }),
    });
    expect(((await r.json()) as { result: unknown }).result).toBeTruthy();
    await look.close();
    expect(look.looked()).toEqual(["jot"]);
    // Gone with the run: nothing answers on its port.
    await expect(fetch(`${look.url}/jot`, { method: "POST" })).rejects.toThrow();
  }, 60_000);

  it("says why, and holds no tool, when it doesn't start", async () => {
    const started = await startLook({}, `${NODE} ${join(tmpdir(), "no-such-cli.mjs")}`);
    expect(started).toEqual({ why: expect.stringContaining("didn't start") });
  }, 60_000);

  it("on a box with no look user yet, says the fix that's true for it: its own update, or its setup once more", () => {
    expect(lookMissing(true)).toBe(
      "didn't start: this box can't start its user shipify-look yet; box setup 16 adds it, and the box applies it by itself at its next due run",
    );
    // A box set up before setup 14 has no updater: it never applies setup 16 by itself.
    const old = lookMissing(false, "sudo: a password is required");
    expect(old).toContain("(sudo: a password is required)");
    expect(old).toContain("this box can't apply it by itself");
    expect(old).toContain("set it up once more, and from then on it updates itself");
    expect(old).not.toContain("by itself at its next due run");
  });
});
