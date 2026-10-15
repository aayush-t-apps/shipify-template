// One way to set up every plug-in (ADR 0030 §6): `ship add <name>` from its entry's setup, one
// checked step at a time, and `ship remove <name>` undoing it; `ship selftest <name>` checks it.
// What each one writes to GitHub is read back from the mock provider's log (SHIPIFY_MOCK_CALLS).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { add } from "../cli/commands/add.ts";
import { readTools } from "../cli/lib/tools.ts";
import { ROOT, type Sandbox, sandbox, ship } from "./helpers.ts";

const node = (code: string) => [process.execPath, "-e", code];
const exit = (cond: string) => node(`process.exit(${cond} ? 0 : 1)`);
const sha = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 12);

/** One write the mock provider made, as its log keeps it. */
interface Call {
  call: string;
  repo: string;
  name?: string;
  value?: string;
  sha?: string;
}

/**
 * A plug-in whose check passes only with a key starting "good", and whose setup has one step (or
 * the setup given): in a tools.json of its own, with a credentials file and a mock log of its own.
 */
function plugin(sb: Sandbox, setup: Record<string, unknown> = {}) {
  const tools = join(sb.dir, "tools.json");
  writeFileSync(
    tools,
    JSON.stringify({
      version: 1,
      fakedb: {
        description: "A fake database",
        run: [process.execPath, "-e", "0"],
        keys: { FAKE_TOKEN: { look: "SHIPIFY_FAKE_READ" } },
        look: ["read"],
        check: exit('String(process.env.FAKE_TOKEN).startsWith("good")'),
        setup: {
          needs: ["A fake account"],
          keys: { SHIPIFY_FAKE_READ: { ask: "the fake key" } },
          steps: [{ say: "Link it", run: exit("process.env.SHIPIFY_FAKE_READ") }],
          ...setup,
        },
      },
    }),
  );
  const creds = join(sb.dir, "creds.env");
  const log = join(sb.dir, "calls.jsonl");
  const env = {
    ...sb.env,
    SHIPIFY_TOOLS_FILE: tools,
    SHIPIFY_CREDENTIALS: creds,
    SHIPIFY_MOCK_CALLS: log,
    GITHUB_REPOSITORY: "o/shipify",
  };
  return {
    env,
    creds,
    key: (v: string) => writeFileSync(creds, `SHIPIFY_FAKE_READ=${v}\n`, { mode: 0o600 }),
    /** Each write to GitHub so far. */
    calls: (): Call[] =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as Call)
        : [],
    logText: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
    run: (...args: string[]) => ship({ ...sb, env }, ...args),
  };
}

describe("ship add and ship remove", () => {
  it("shows the plan first: what you need, the key you paste, its steps and its check", () => {
    const p = plugin(sandbox());
    const r = p.run("add", "fakedb");
    expect(r.status).toBe("requires-approval");
    const said = JSON.stringify(r.plannedActions);
    expect(said).toContain("you need: A fake account");
    expect(said).toContain("SHIPIFY_FAKE_READ: you paste it (the fake key), hidden");
    expect(said).toContain("then: Link it");
    expect(said).toContain("then: check it works");
    expect(p.calls()).toEqual([]);
  });

  it("stops, saying how, when there's no key to set and no terminal to paste it in", () => {
    const p = plugin(sandbox());
    const r = p.run("add", "fakedb", "--yes");
    expect(r.status).toBe("blocked");
    expect(JSON.stringify(r.checks)).toContain("credentials file");
    expect(p.calls()).toEqual([]);
  });

  it("sets it up with the key, runs its steps, and checks it works; a bad key is caught", () => {
    const p = plugin(sandbox());
    p.key("good");
    const r = p.run("add", "fakedb", "--yes");
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    const names = r.checks?.map((c) => c.name) ?? [];
    expect(names).toEqual([
      "SHIPIFY_FAKE_READ is set on o/shipify",
      "Link it",
      "fakedb's look key works",
    ]);
    expect(p.run("selftest", "fakedb").status).toBe("succeeded");
    p.key("bad");
    const bad = p.run("add", "fakedb", "--yes");
    expect(bad.summary).toContain("check failed");
    // A key its provider refuses is made again, and pasted again.
    expect(JSON.stringify(bad.checks)).toContain("pnpm ship add fakedb --new --yes");
    expect(p.run("selftest", "fakedb").status).toBe("failed");
  });

  it("sets each key on its repo, as the mock's log shows, which never holds its value", () => {
    const p = plugin(sandbox());
    p.key("good-1");
    p.run("add", "fakedb", "--yes");
    expect(p.calls()).toEqual([
      { call: "setSecret", repo: "o/shipify", name: "SHIPIFY_FAKE_READ", sha: sha("good-1") },
    ]);
    expect(p.logText()).not.toContain("good-1");
  });

  it("skips a key already in the credentials file and on its repo", () => {
    const p = plugin(sandbox());
    p.key("good");
    p.run("add", "fakedb", "--yes");
    const again = p.run("add", "fakedb", "--yes");
    expect(again.status).toBe("succeeded");
    expect(again.checks?.[0]?.name).toBe("SHIPIFY_FAKE_READ is set");
    expect(p.calls().filter((c) => c.call === "setSecret")).toHaveLength(1);
  });

  it("stops at a failing step, runs none after it, and carries on from it when run again", () => {
    const sb = sandbox();
    // A command's words with a / in them are paths in this repo: so the files are named by env.
    const flag = join(sb.dir, "fixed");
    const three = join(sb.dir, "three-ran");
    Object.assign(sb.env, { FLAG: flag, THREE: three });
    const p = plugin(sb, {
      steps: [
        { say: "One", run: exit("true") },
        { say: "Two", run: exit('require("node:fs").existsSync(process.env.FLAG)') },
        { say: "Three", run: node('require("node:fs").writeFileSync(process.env.THREE, "")') },
      ],
    });
    p.key("good");
    const first = p.run("add", "fakedb", "--yes");
    expect(first.status).toBe("blocked");
    expect(first.summary).toContain('"Two" didn\'t work');
    expect(first.checks?.map((c) => [c.name, c.ok])).toEqual([
      ["SHIPIFY_FAKE_READ is set on o/shipify", true],
      ["One", true],
      ["Two", false],
    ]);
    expect(existsSync(three)).toBe(false);
    writeFileSync(flag, "");
    const second = p.run("add", "fakedb", "--yes");
    expect(second.status, JSON.stringify(second.checks)).toBe("succeeded");
    expect(existsSync(three)).toBe(true);
  });

  it("puts a key meant for the edge on its Worker with wrangler, never on a repo, and takes it off again", () => {
    const sb = sandbox();
    const state = join(sb.dir, "wrangler.json");
    writeFileSync(state, JSON.stringify({ secrets: {}, calls: [] }));
    const p = plugin(sb, {
      keys: { SHIPIFY_FAKE_BOT: { ask: "a bot's key", to: "edge" } },
      steps: [],
    });
    Object.assign(p.env, {
      SHIPIFY_WRANGLER: join(ROOT, "tests/fixtures/fake-wrangler.mjs"),
      FAKE_WRANGLER_STATE: state,
    });
    writeFileSync(p.creds, "SHIPIFY_FAKE_BOT=good-bot\n", { mode: 0o600 });
    const plan = p.run("add", "fakedb");
    expect(JSON.stringify(plan.plannedActions)).toContain(
      "SHIPIFY_FAKE_BOT: you paste it (a bot's key), hidden; set on the edge's Worker",
    );
    const r = p.run("add", "fakedb", "--yes");
    expect(r.checks?.[0]).toMatchObject({
      name: "SHIPIFY_FAKE_BOT is set on the edge's Worker",
      ok: true,
    });
    const held = () =>
      JSON.parse(readFileSync(state, "utf8")) as { secrets: Record<string, string> };
    expect(held().secrets.SHIPIFY_FAKE_BOT).toBe(
      createHash("sha256").update("good-bot").digest("hex"),
    );
    expect(p.calls()).toEqual([]);
    expect(p.run("remove", "fakedb", "--yes").status).toBe("succeeded");
    expect(held().secrets).toEqual({});
  });

  it("removes it: its keys go, from GitHub and the credentials file", () => {
    const p = plugin(sandbox());
    p.key("good");
    const plan = p.run("remove", "fakedb");
    expect(plan.status).toBe("requires-approval");
    expect(JSON.stringify(plan.plannedActions)).toContain("delete secret SHIPIFY_FAKE_READ");
    expect(p.run("remove", "fakedb", "--yes").status).toBe("succeeded");
    expect(existsSync(p.creds) ? readFileSync(p.creds, "utf8") : "").not.toContain(
      "SHIPIFY_FAKE_READ",
    );
    expect(p.calls()).toEqual([
      { call: "deleteSecret", repo: "o/shipify", name: "SHIPIFY_FAKE_READ" },
    ]);
  });

  it("removes nothing when its own undo fails: it's blocked, and its keys stay to try again", () => {
    const p = plugin(sandbox(), { remove: exit("false") });
    p.key("good");
    const r = p.run("remove", "fakedb", "--yes");
    expect(r.status).toBe("blocked");
    expect(r.checks?.[0]).toMatchObject({ name: "its own setup undone", ok: false });
    expect(readFileSync(p.creds, "utf8")).toContain("SHIPIFY_FAKE_READ=good");
    expect(p.calls()).toEqual([]);
  });

  it("names what it can set up, for a name that isn't one", () => {
    const p = plugin(sandbox());
    expect(p.run("add", "nothing").summary).toContain("With a setup: fakedb");
  });
});

// A key pasted at the hidden prompt: in this process, with the prompt's answers given.
describe("ship add: a key you paste", () => {
  afterEach(() => vi.unstubAllEnvs());
  const here = (setup: Record<string, unknown> = {}) => {
    const sb = sandbox();
    const p = plugin(sb, setup);
    for (const [k, v] of Object.entries(p.env)) if (v !== undefined) vi.stubEnv(k, v);
    return p;
  };
  /** The prompt: each question asked, answered in turn. */
  const prompt = (...answers: string[]) => {
    const asked: string[] = [];
    return {
      asked,
      ask: async (q: string) => {
        asked.push(q);
        return answers.shift() ?? "";
      },
    };
  };

  it("takes a pasted key without the spaces around it, and refuses one with a space inside", async () => {
    here();
    const a = prompt("  good-pasted \n");
    const r = await add("fakedb", true, { interactive: true, ask: a.ask });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(a.asked).toEqual(["Paste the fake key (hidden): "]);
    expect(readFileSync(process.env.SHIPIFY_CREDENTIALS as string, "utf8")).toContain(
      "SHIPIFY_FAKE_READ=good-pasted\n",
    );
    const b = prompt("good one");
    const refused = await add("fakedb", true, { interactive: true, ask: b.ask, renew: true });
    expect(refused.status).toBe("blocked");
    expect(JSON.stringify(refused.checks)).toContain("pnpm ship add fakedb --new --yes");
  });

  it("with --new, asks again for a key already set, and replaces it here and on its repo", async () => {
    const p = here();
    p.key("good-1");
    expect((await add("fakedb", true, { interactive: true, ask: prompt().ask })).status).toBe(
      "succeeded",
    );
    const a = prompt("good-2");
    const r = await add("fakedb", true, { interactive: true, ask: a.ask, renew: true });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(a.asked).toEqual(["Paste the fake key (hidden): "]);
    expect(readFileSync(p.creds, "utf8")).toContain("SHIPIFY_FAKE_READ=good-2\n");
    expect(p.calls().map((c) => c.sha)).toEqual([sha("good-1"), sha("good-2")]);
  });

  it("with --new and no terminal, says to run it in one", async () => {
    const p = here();
    p.key("good-1");
    const r = await add("fakedb", true, { interactive: false, renew: true });
    expect(r.status).toBe("blocked");
    expect(JSON.stringify(r.checks)).toContain(
      "run pnpm ship add fakedb --new --yes in a terminal",
    );
    expect(p.calls()).toEqual([]);
  });

  it("tells each step which keys it set in this run, by name", async () => {
    const sb = sandbox();
    const seen = join(sb.dir, "seen");
    sb.env.SEEN = seen;
    const p = plugin(sb, {
      steps: [
        {
          say: "Note",
          run: node(
            'require("node:fs").appendFileSync(process.env.SEEN, (process.env.SHIPIFY_KEYS_SET ?? "-") + "\\n")',
          ),
        },
      ],
    });
    for (const [k, v] of Object.entries(p.env)) if (v !== undefined) vi.stubEnv(k, v);
    p.key("good");
    await add("fakedb", true, { interactive: false });
    await add("fakedb", true, { interactive: false });
    expect(readFileSync(seen, "utf8")).toBe("SHIPIFY_FAKE_READ\n\n");
  });
});

describe("a plug-in's setup in tools.json", () => {
  it("asks only for secrets its keys name, on the shipify repo", () => {
    const sb = sandbox();
    const file = join(sb.dir, "t.json");
    writeFileSync(
      file,
      JSON.stringify({
        x: {
          description: "x",
          run: ["x"],
          keys: { X: { look: "SHIPIFY_X_READ" } },
          look: ["read"],
          setup: { keys: { SHIPIFY_OTHER: { ask: "a key" } } },
        },
      }),
    );
    const r = readTools(file);
    expect(r.broken).toEqual(["x"]);
    expect(r.problems.join(" ")).toContain("setup.keys.SHIPIFY_OTHER isn't a secret");
  });
});

describe("ship add <gateway> (ADR 0038)", () => {
  afterEach(() => vi.unstubAllEnvs());
  /** A gateway in an executors.json of its own, the mock's log, and a stand-in for its key check. */
  const gateway = () => {
    const sb = sandbox();
    const file = join(sb.dir, "executors.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        gateways: {
          models: {
            description: "Models through one key",
            url: "https://gw.example.com/v1",
            protocol: "openai-chat",
            key: "MODELS_API_KEY",
            how: "gw.example.com/keys",
            check: "/key",
          },
        },
      }),
    );
    const log = join(sb.dir, "calls.jsonl");
    const env = {
      ...sb.env,
      SHIPIFY_EXECUTORS_FILE: file,
      SHIPIFY_CREDENTIALS: join(sb.dir, "creds.env"),
      SHIPIFY_MOCK_CALLS: log,
      GITHUB_REPOSITORY: "o/shipify",
    };
    for (const [k, v] of Object.entries(env)) if (v !== undefined) vi.stubEnv(k, v);
    const asked: string[] = [];
    const seen: string[] = [];
    return {
      calls: (): Call[] =>
        existsSync(log)
          ? readFileSync(log, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l) as Call)
          : [],
      ask: (answer: string) => async (q: string) => {
        asked.push(q);
        return answer;
      },
      asked,
      seen,
      /** The gateway's check: 200 for a key that starts "good". */
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push(url);
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        return new Response("{}", { status: auth.startsWith("Bearer good") ? 200 : 401 });
      }) as typeof fetch,
    };
  };

  it("shows the plan first: the key you paste, its check, and what records it", async () => {
    const g = gateway();
    const r = await add("models", false);
    expect(r.status).toBe("requires-approval");
    const said = JSON.stringify(r.plannedActions);
    expect(said).toContain("MODELS_API_KEY: you paste it, hidden; set on o/shipify");
    expect(said).toContain("SHIPIFY_GATEWAYS");
    expect(g.calls()).toEqual([]);
  });

  it("sets the key, checks it with the gateway, and records it for the web chat; never prints it", async () => {
    const g = gateway();
    const r = await add("models", true, {
      interactive: true,
      ask: g.ask("good-key"),
      fetch: g.fetch,
    });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(g.asked[0]).toContain("your models key (gw.example.com/keys)");
    expect(g.seen).toEqual(["https://gw.example.com/v1/key"]);
    const calls = g.calls();
    expect(calls[0]).toEqual({
      call: "setSecret",
      repo: "o/shipify",
      name: "MODELS_API_KEY",
      sha: sha("good-key"),
    });
    expect(calls[1]).toMatchObject({ call: "setVariable", name: "SHIPIFY_GATEWAYS" });
    expect(Object.keys(JSON.parse(calls[1]?.value ?? "{}"))).toEqual(["models"]);
    expect(JSON.stringify(calls)).not.toContain("good-key");
  });

  it("stops when the gateway refuses the key, saying how to make a new one, and records nothing", async () => {
    const g = gateway();
    const r = await add("models", true, {
      interactive: true,
      ask: g.ask("bad-key"),
      fetch: g.fetch,
    });
    expect(r.status).toBe("blocked");
    expect(JSON.stringify(r.checks)).toContain("pnpm ship add models --new --yes");
    expect(g.calls().some((c) => c.call === "setVariable")).toBe(false);
  });

  it("removes it: its secret, its line here, and its record", async () => {
    const g = gateway();
    await add("models", true, { interactive: true, ask: g.ask("good-key"), fetch: g.fetch });
    const { remove } = await import("../cli/commands/add.ts");
    expect((await remove("models", false)).status).toBe("requires-approval");
    expect((await remove("models", true)).status).toBe("succeeded");
    const calls = g.calls();
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ call: "deleteSecret", name: "MODELS_API_KEY" }),
      ]),
    );
    expect(JSON.parse(calls.at(-1)?.value ?? "")).toEqual({});
  });
});
