// The run's look server (ADR 0077): the tools' look keys out of the agent's reach. For each run that
// offers tools, think starts it (`ship run look`): on a box as the user shipify-look (box setup 16),
// through the runner's sudo rule; off a box as a child of `ship`, as you. The first line of its stdin
// holds the run's token and each ready tool (its server, and its look keys by the names the server
// reads): never a command line, nor the environment. It starts each tool's server once, listens on
// 127.0.0.1 only, and tells think its port on stdout. Then it's a gate, in JSON only: it answers a
// request with the run's token, for the run's look calls, and nothing else; it says each call it
// sends on, for `looked` (ADR 0049); and it ends when its stdin closes (the run's end, or the
// runner's), its tools' servers with it. The agent holds only the token: it works on this box
// alone, and only while the run does.
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { z } from "zod";
import { maskSecrets } from "../contracts/index.ts";
import { UPDATER } from "../lib/box-update.ts";
import { LOOK_USER, lookArgs, lookUserThere, onBox, SPAWN_ENV, stopLook } from "../lib/sandbox.ts";
import { command, runTools, type Tools } from "../lib/tools.ts";

/** The MCP version the look server asks its tools' servers for. */
const PROTOCOL = "2025-06-18";
/** The biggest request it reads. */
export const MAX_BODY = 1024 * 1024;
/** The longest a look call may take. */
export const CALL_MS = 2 * 60_000;
/** The longest a tool's server may take to start and list its calls. */
const START_MS = 20_000;
/** The longest think waits for the server's port: its own start and its tools'. */
const READY_MS = 30_000;
/** The longest it takes to end once its stdin closes, before it's stopped. */
const END_MS = 5_000;

/** One tool as the look server gets it: its server (a command, or an address) and its look calls. */
const Given = z
  .object({
    run: z.array(z.string()).min(1).optional(),
    url: z.string().url().optional(),
    /** A remote server's headers, its keys in them. */
    headers: z.record(z.string(), z.string()).default({}),
    /** A local server's keys, by the names it reads. */
    env: z.record(z.string(), z.string()).default({}),
    look: z.array(z.string()),
  })
  .refine((t) => Boolean(t.run) !== Boolean(t.url), "a tool has a command or an address");
/** The first line of its stdin: the run's token and its tools. */
const LookIn = z.object({
  token: z.string().min(32),
  tools: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), Given),
});
export type LookTools = z.input<typeof LookIn>["tools"];

/** What it says on stdout, one JSON line each: once ready, then each call it sent on. */
interface Ready {
  port: number;
  pid: number;
  tools: string[];
  missing: { tool: string; why: string }[];
}

type Answer = { result?: unknown; error?: { code: number; message: string } };
interface Message {
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** One tool's server, as the look server speaks to it. */
interface Bridge {
  ask(method: string, params: unknown, ms: number): Promise<Answer>;
  notify(method: string): void;
  close(): void;
}

/** One tool, served: its look calls as its server lists them, and the way to its server. */
interface Served extends Bridge {
  calls: { name: string }[];
}

const failed = (message: string): Answer => ({ error: { code: -32603, message } });
const answerOf = (m: Message): Answer =>
  m.error
    ? { error: { code: m.error.code ?? -32603, message: m.error.message ?? "an error" } }
    : { result: m.result };

/**
 * A local tool's server: its command, with only its keys and the system's PATH, speaking MCP over
 * its stdin and stdout, one message a line (tools/mcp.ts). Its errors go to the run's log.
 */
function local(run: string[], env: Record<string, string>): Bridge {
  const [cmd, ...args] = run as [string, ...string[]];
  const child = spawn(cmd, args, {
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...env,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map<number, (a: Answer) => void>();
  let ended: string | undefined;
  const end = (why: string) => {
    ended ??= why;
    for (const done of waiting.values()) done(failed(ended));
    waiting.clear();
  };
  child.on("error", (e) => end(`its server couldn't start: ${e.message}`));
  child.on("exit", (code, signal) => end(`its server ended (${signal ?? `exit ${code}`})`));
  child.stdin.on("error", () => {});
  createInterface({ input: child.stdout }).on("line", (line) => {
    let m: Message;
    try {
      m = JSON.parse(line) as Message;
    } catch {
      return;
    }
    if (typeof m?.id !== "number") return;
    const done = waiting.get(m.id);
    waiting.delete(m.id);
    done?.(answerOf(m));
  });
  let next = 1;
  const write = (m: object) => {
    if (!ended) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  };
  return {
    ask: (method, params, ms) =>
      new Promise((resolve) => {
        if (ended) return resolve(failed(ended));
        const id = next++;
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve(failed(`its server didn't answer within ${ms / 1000} seconds`));
        }, ms);
        waiting.set(id, (a) => {
          clearTimeout(timer);
          resolve(a);
        });
        write({ id, method, params });
      }),
    notify: (method) => write({ method }),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}

/** The answer to request `id` in an event stream's events (Streamable HTTP), if one holds it. */
export function fromEvents(body: string, id: number): Message | undefined {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    try {
      const m = JSON.parse(data) as Message;
      if (m?.id === id) return m;
    } catch {}
  }
  return undefined;
}

/**
 * A remote tool's server (tools.json's `url`; none today): MCP's Streamable HTTP, a POST for each
 * message with its headers (its keys in them), and an answer in JSON or as an event stream. Its
 * session, when it gives one, goes with each message after its `initialize`.
 */
function remote(url: string, headers: Record<string, string>): Bridge {
  let session: string | undefined;
  let version: string | undefined;
  let next = 1;
  const post = (body: object, ms: number) =>
    fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(session ? { "mcp-session-id": session } : {}),
        ...(version ? { "mcp-protocol-version": version } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      redirect: "error",
      signal: AbortSignal.timeout(ms),
    });
  return {
    async ask(method, params, ms) {
      const id = next++;
      try {
        const r = await post({ id, method, params }, ms);
        if (!r.ok) return failed(`its server answered ${r.status}`);
        if (method === "initialize") session = r.headers.get("mcp-session-id") ?? undefined;
        const text = await r.text();
        const m = /text\/event-stream/.test(r.headers.get("content-type") ?? "")
          ? fromEvents(text, id)
          : (JSON.parse(text) as Message);
        if (!m) return failed("its server's answer held none to this call");
        const a = answerOf(m);
        if (method === "initialize")
          version = (a.result as { protocolVersion?: string } | undefined)?.protocolVersion;
        return a;
      } catch (e) {
        return failed(
          (e as Error).name === "TimeoutError"
            ? `its server didn't answer within ${ms / 1000} seconds`
            : `its server couldn't be reached: ${(e as Error).message}`,
        );
      }
    },
    notify(method) {
      post({ method }, START_MS).catch(() => {});
    },
    close() {
      if (session)
        fetch(url, { method: "DELETE", headers: { ...headers, "mcp-session-id": session } }).catch(
          () => {},
        );
    },
  };
}

/** A tool's server started and initialized once, with its look calls as it lists them. */
async function connect(t: z.output<typeof Given>): Promise<Served> {
  const bridge = t.url ? remote(t.url, t.headers) : local(t.run as string[], t.env);
  let list = await bridge.ask(
    "initialize",
    {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "shipify-look", version: "1" },
    },
    START_MS,
  );
  if (!list.error) {
    bridge.notify("notifications/initialized");
    list = await bridge.ask("tools/list", {}, START_MS);
  }
  if (list.error) {
    bridge.close();
    throw new Error(list.error.message);
  }
  const all = (list.result as { tools?: unknown[] } | undefined)?.tools ?? [];
  const calls = all.filter(
    (c): c is { name: string } =>
      typeof (c as { name?: unknown })?.name === "string" &&
      t.look.includes((c as { name: string }).name),
  );
  return { ...bridge, calls };
}

/** Whether a request's Authorization is the run's token: compared in constant time. */
export function sameToken(header: string | undefined, token: string): boolean {
  const given = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
  if (!given) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(token));
}

/** A request's body, or undefined when it's bigger than `max` (what's left is read and dropped). */
function bodyOf(req: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > max) {
      req.resume();
      return resolve(undefined);
    }
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= max) parts.push(chunk);
    });
    req.on("end", () => resolve(size > max ? undefined : Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

/** The version a client asks for, when it's one (a date), else the one its tools speak. */
const versionOf = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : PROTOCOL;

/**
 * The gate: a request without the run's token gets 401, a tool it doesn't serve 404, anything but
 * a POST 405, a body over MAX_BODY 413, a notification 202. It answers `initialize` and `ping`
 * itself, `tools/list` with the run's look calls, and sends a `tools/call` on only for one of them
 * (`said` first, for the run's record), with CALL_MS for its answer.
 */
export function gate(
  token: string,
  tools: Map<string, Served>,
  said: (call: string) => void,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const answer = async (tool: string, t: Served, m: Message): Promise<Answer> => {
    if (m.method === "initialize")
      return {
        result: {
          protocolVersion: versionOf(m.params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: `shipify-look-${tool}`, version: "1" },
        },
      };
    if (m.method === "ping") return { result: {} };
    if (m.method === "tools/list") return { result: { tools: t.calls } };
    if (m.method !== "tools/call")
      return { error: { code: -32601, message: `${String(m.method)} isn't served here` } };
    const call = m.params?.name;
    if (typeof call !== "string" || !t.calls.some((c) => c.name === call))
      return {
        result: {
          content: [
            {
              type: "text",
              text: `${tool}.${String(call)} isn't a look call of this run, so it was refused and sent nowhere.`,
            },
          ],
          isError: true,
        },
      };
    said(`${tool}.${call}`);
    const a = await t.ask(
      "tools/call",
      { name: call, arguments: m.params?.arguments ?? {} },
      CALL_MS,
    );
    return a.error
      ? { result: { content: [{ type: "text", text: a.error.message }], isError: true } }
      : a;
  };
  return async (req, res) => {
    const send = (status: number, body?: object, headers: Record<string, string> = {}) => {
      res.writeHead(status, body ? { ...headers, "content-type": "application/json" } : headers);
      res.end(body ? JSON.stringify(body) : undefined);
    };
    try {
      if (!sameToken(req.headers.authorization, token)) return send(401);
      const name = /^\/([a-z][a-z0-9_]*)\/?$/.exec(
        new URL(req.url ?? "/", "http://x").pathname,
      )?.[1];
      const t = name ? tools.get(name) : undefined;
      if (!name || !t) return send(404);
      if (req.method !== "POST") {
        req.resume();
        return send(405, undefined, { allow: "POST" });
      }
      const body = await bodyOf(req, MAX_BODY);
      if (body === undefined) return send(413, undefined, { connection: "close" });
      let m: Message;
      try {
        m = JSON.parse(body) as Message;
      } catch {
        return send(400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "not JSON" },
        });
      }
      if (!m || typeof m !== "object" || Array.isArray(m))
        return send(400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "one message at a time, as an object" },
        });
      // A notification, or an answer: nothing is sent on.
      if (m.id === undefined || m.id === null || typeof m.method !== "string") return send(202);
      send(200, { jsonrpc: "2.0", id: m.id, ...(await answer(name, t, m)) });
    } catch {
      if (!res.headersSent) send(500);
    }
  };
}

/**
 * `ship run look`: the look server itself. It reads its first line, starts its tools' servers,
 * says it's ready, and serves until its stdin closes.
 */
export async function serveLook(
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): Promise<void> {
  const say = (m: object) => io.output.write(`${JSON.stringify(m)}\n`);
  const lines = createInterface({ input: io.input });
  const closed = once(lines, "close");
  const first = await Promise.race([once(lines, "line").then(([l]) => l as string), closed]);
  if (typeof first !== "string") return;
  let given: z.output<typeof LookIn>;
  try {
    given = LookIn.parse(JSON.parse(first));
  } catch {
    say({ error: "its first line isn't what think sends" });
    return;
  }
  const tools = new Map<string, Served>();
  const missing: Ready["missing"] = [];
  await Promise.all(
    Object.entries(given.tools).map(async ([name, t]) => {
      try {
        tools.set(name, await connect(t));
      } catch (e) {
        missing.push({
          tool: name,
          why: `its server didn't start: ${maskSecrets((e as Error).message)}`,
        });
      }
    }),
  );
  const server = createServer(gate(given.token, tools, (call) => say({ called: call })));
  let ended = false;
  void closed.then(() => {
    ended = true;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  if (!ended)
    say({
      ready: {
        port: (server.address() as AddressInfo).port,
        pid: process.pid,
        tools: [...tools.keys()].sort(),
        missing,
      } satisfies Ready,
    });
  await closed;
  server.close();
  server.closeAllConnections();
  for (const t of tools.values()) t.close();
}

/**
 * Each ready tool as the look server gets it (`env`: the run's environment, with the look keys):
 * a local server's command from Shipify's copy at `root` (a box's read-only one, which its user
 * reads) with its look keys by the names it reads, or a remote one's address with its keys in its
 * headers.
 */
export function lookTools(
  tools: Tools,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): LookTools {
  const { ready } = runTools(tools, "look", env);
  return Object.fromEntries(
    Object.entries(ready).flatMap(([name, look]): [string, LookTools[string]][] => {
      const t = tools[name];
      if (!t) return [];
      const vars = Object.fromEntries(
        Object.entries(t.keys).flatMap(([v, k]) =>
          k.look && env[k.look] ? [[v, env[k.look] as string]] : [],
        ),
      );
      if (t.url)
        return [
          [
            name,
            {
              url: t.url,
              headers: Object.fromEntries(
                Object.entries(t.headers ?? {}).map(([h, v]) => [
                  h,
                  v.replace(/\$\{(\w+)\}/g, (all, x: string) => vars[x] ?? all),
                ]),
              ),
              look,
            },
          ],
        ];
      const c = command(t.run as string[], root);
      return [[name, { run: [c.command, ...c.args], env: vars, look }]];
    }),
  );
}

/** The run's look server, while it runs: what the agent's settings name, and its record. */
export interface Look {
  /** `http://127.0.0.1:<port>`: each tool at `<url>/<tool>`. */
  url: string;
  /** The run's token: the agent holds it as LOOK_TOKEN. */
  token: string;
  /** The tools it serves. */
  tools: string[];
  /** The tools it couldn't serve, and why. */
  missing: { tool: string; why: string }[];
  /** The tools whose look calls it sent on so far, each once. */
  looked(): string[];
  /** Ends it, and its tools' servers: its stdin closed, and stopped if it doesn't end at once. */
  close(): Promise<void>;
}

/**
 * Why a box's look server didn't start for want of its user (box setup 16, ADR 0077), and the fix
 * that's true for this box: one with its own updates (the updater, from setup 14) applies it by
 * itself; an older one can't, until it's set up once more. `why`: sudo's words, when it refused.
 */
export const lookMissing = (updates: boolean, why?: string) =>
  `didn't start: this box can't start its user ${LOOK_USER} yet${why ? ` (${why})` : ""}; box setup 16 adds it, ${
    updates
      ? "and the box applies it by itself at its next due run"
      : "and this box can't apply it by itself, as it was set up before setup 14 gave boxes their own updates: set it up once more, and from then on it updates itself (when no task runs: on the box, its here.sh command again; or from a PC, the `pnpm ship box add` command it was set up with)"
  }`;

/**
 * Starts the run's look server with these tools (`lookTools`), from Shipify's CLI (`cli`, as
 * shipifyCopy gives it): on a box as LOOK_USER, off a box as you. A new token for the run, 32
 * random bytes. When it doesn't start (a box before setup 16, no port within READY_MS), why: the
 * run then has no tools, and never their keys instead.
 */
export async function startLook(
  tools: LookTools,
  cli: string,
): Promise<{ look: Look } | { why: string }> {
  const token = randomBytes(32).toString("base64url");
  const argv = [...cli.split(" "), "run", "look"];
  const box = onBox();
  // A box before setup 16 has no look user: said plainly, with no sudo to fail in the run's log.
  if (box && !lookUserThere()) return { why: lookMissing(existsSync(UPDATER)) };
  const [cmd, ...args] = (box ? ["sudo", ...lookArgs(argv)] : argv) as [string, ...string[]];
  const child = spawn(cmd, args, {
    // On a box, from `/`, as an agent's command starts: the runner's folders aren't its user's.
    ...(box ? { cwd: "/" } : {}),
    env: box
      ? SPAWN_ENV
      : {
          PATH: process.env.PATH ?? "",
          LANG: "C.UTF-8",
          ...Object.fromEntries(
            ["HOME", "TMPDIR", "TZ"].flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])),
          ),
        },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdin.write(`${JSON.stringify({ token, tools })}\n`);
  // Its log goes to the run's, masked; its last line says why, when it didn't start.
  let last = "";
  createInterface({ input: child.stderr }).on("line", (l) => {
    process.stderr.write(`${maskSecrets(l)}\n`);
    if (l.trim()) last = maskSecrets(l.trim());
  });
  const exited = new Promise<void>((done) => {
    child.on("close", () => done());
    child.on("error", () => done());
  });
  const looked = new Set<string>();
  const ready = await new Promise<Ready | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), READY_MS);
    createInterface({ input: child.stdout }).on("line", (line) => {
      let m: { ready?: Ready; called?: unknown };
      try {
        m = JSON.parse(line) as typeof m;
      } catch {
        return;
      }
      if (m?.ready) {
        clearTimeout(timer);
        resolve(m.ready);
      } else if (typeof m?.called === "string") looked.add(m.called.split(".")[0] as string);
    });
    void exited.then(() => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
  /** Whether it ended within END_MS: never waited for longer, so a run never hangs on it. */
  const gone = () =>
    Promise.race([
      exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), END_MS).unref()),
    ]);
  let ending: Promise<void> | undefined;
  const close = () =>
    (ending ??= (async () => {
      child.stdin.end();
      if (await gone()) return;
      // On a box its process is the look user's, under sudo: stopped by the ID it gave.
      if (!box) child.kill("SIGKILL");
      else if (ready) stopLook(ready.pid);
      await gone();
    })());
  if (!ready) {
    await close();
    return {
      why:
        box && /^sudo:/.test(last)
          ? lookMissing(existsSync(UPDATER), last)
          : `didn't start${last ? ` (${last})` : ""}`,
    };
  }
  return {
    look: {
      url: `http://127.0.0.1:${ready.port}`,
      token,
      tools: ready.tools,
      missing: ready.missing,
      looked: () => [...looked],
      close,
    },
  };
}
