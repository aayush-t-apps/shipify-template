// A run with OpenCode (ADR 0038), off a box, through the real core: think hands it its gateway's
// key on the pipe, which Shipify's gate reads and puts on its calls to that gateway alone; its own
// config folder is made read-only before every ask (or it installs a package from npm there on
// every start); a command it runs gets the run's own XDG folders; and its answer comes from its
// final message. The stand-in
// (tests/fixtures/fake-opencode.mjs) loads the gate as OpenCode does, and keeps what it was given.
// And its report: the tools, what it read and what was refused, from the calls its gate saw.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { think } from "../cli/kernel/think.ts";
import type { Snapshot, Think } from "../cli/kernel/types.ts";
import { opencode } from "../cli/lib/agents/opencode.ts";
// @ts-expect-error: plain JavaScript, as OpenCode loads it
import { ShipifyGate } from "../cli/lib/agents/opencode-gate.mjs";
import { newState, type TaskState } from "../cli/lib/task.ts";
import { ROOT, sandbox } from "./helpers.ts";

const saved = { ...process.env };
let dir = "";

beforeEach(() => {
  const sb = sandbox();
  dir = mkdtempSync(join(tmpdir(), "opencode-run-"));
  const executors = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  executors.opencode.task = [process.execPath, join(ROOT, "tests/fixtures/fake-opencode.mjs")];
  writeFileSync(join(dir, "executors.json"), JSON.stringify(executors));
  process.env = {
    ...saved,
    ...sb.env,
    GITHUB_REPOSITORY: "o/shipify",
    SHIPIFY_EXECUTORS_FILE: join(dir, "executors.json"),
    // On a box the job hands the chosen agent's login over as this (task.yml).
    SHIPIFY_AGENT_LOGIN: "sk-or-test",
  };
  delete process.env.GITHUB_ACTIONS;
  delete process.env.SHIPIFY_BOX;
});
afterEach(() => {
  process.env = { ...saved };
});

const snap: Snapshot = {
  n: 7,
  issue: {
    title: "ask: what is 2+2?",
    body: "",
    state: "open",
    labels: [],
    author: "owner",
    isPr: false,
  },
  said: [],
  state: {
    ...(newState() as TaskState),
    use: { agent: "opencode", model: "z-ai/glm-5.3", label: "OpenCode · glm-5.3" },
  },
  trigger: { kind: "opened" },
  now: "2026-10-10T10:00:00.000Z",
  run: { id: "70", url: "https://github.com/o/shipify/actions/runs/70" },
  parsed: { kind: "question", ask: "what is 2+2?" },
  bodyHash: "aaaa",
  projects: [],
  repos: [],
  isTask: true,
};
const talk: Think = { profile: "talk", why: "new", notes: [], fresh: [], web: true };

describe("a run with OpenCode", () => {
  it("puts its gateway's key on its calls through the gate, its own config read-only, and reads its answer", async () => {
    const keep = join(dir, "keep");
    const out = await think(snap, talk, {
      files: join(dir, "files"),
      keep,
      local: join(dir, "place"),
    });
    const result = JSON.parse(readFileSync(join(keep, "result.json"), "utf8"));
    expect(result).toMatchObject({ state: "done", text: "Two plus two is four." });
    const given = JSON.parse(
      readFileSync(join(dir, "place", "out", "opencode-was-given.json"), "utf8"),
    );
    // Its key reached the gate on the pipe, and goes on its calls to the gateway; neither its config
    // nor its environment holds it (on a box it starts from an empty one: sandbox.test.ts), and the
    // gate took the pipe's name off once it read it.
    expect(given.headers).toEqual({ Authorization: "Bearer sk-or-test" });
    expect(given.env).not.toContain("SHIPIFY_LOGIN_FD");
    expect(given.env).not.toContain("OPENROUTER_API_KEY");
    expect(JSON.stringify(given.provider)).not.toContain("sk-or-test");
    // Its own config folder is there, and it can't write in it: it installs nothing at start. No
    // logins of its own, no skills of a repo's.
    expect(given.ownConfig).toEqual({ exists: true, writable: false });
    expect(given.env).toEqual(
      expect.arrayContaining(["OPENCODE_AUTH_CONTENT", "OPENCODE_DISABLE_EXTERNAL_SKILLS"]),
    );
    // A command it runs gets the run's own XDG folders, under its HOME (on a box, the slot's kept
    // caches: pnpm's store, a test browser), not those its own files moved to.
    const home = join(dir, "place", "home");
    expect(given.xdg).toEqual({
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_STATE_HOME: join(home, ".local", "state"),
    });
    expect(given.argv.join(" ")).toContain("--model shipify-openrouter/z-ai/glm-5.3");
    // The run's details: OpenCode, the version executors.json pins, the model, its tokens.
    expect(out.details).toMatchObject({
      agent: "opencode",
      name: "OpenCode",
      version: "1.18.34",
      model: "z-ai/glm-5.3",
    });
    expect(out.details?.tokens?.output).toBe(40);
    expect(out.details?.cost).toBeUndefined();
  }, 30_000);
});

describe("OpenCode's report", () => {
  const read = (lines: unknown[]) => {
    const r = opencode.reader();
    for (const l of lines) r.line(typeof l === "string" ? l : JSON.stringify(l));
    return r.report();
  };

  it("counts every call its gate saw, a helper's too, though OpenCode's own events carry only its own", () => {
    // A real run (1.18.34, a stand-in model): a command, `env git push` refused, and a helper that
    // read a page. OpenCode's events name only the helper; the gate's lines name what it did.
    const report = read(
      readFileSync(join(ROOT, "tests/fixtures/opencode-stream.jsonl"), "utf8").split("\n"),
    );
    expect(report.tools).toEqual({ bash: 2, task: 1, webfetch: 1 });
    expect(report.readOutside).toBe(true);
    expect(report.denied).toEqual([
      "bash: Refused by Shipify's rules: `git push` isn't for an agent (the box does it)",
    ]);
    expect(report.result).toMatchObject({ state: "done", text: "The helper read the page." });
  });

  it("names a look call as Shipify does, though a tool's id holds a `_`, as its gate knows it", () => {
    const home = mkdtempSync(join(tmpdir(), "opencode-tools-"));
    writeFileSync(
      join(home, "tools.json"),
      JSON.stringify({
        version: 1,
        my_notes: {
          description: "Notes",
          run: ["node", "notes.mjs"],
          keys: { NOTES_KEY: { look: "SHIPIFY_NOTES_READ", act: "SHIPIFY_NOTES_WRITE" } },
          look: ["read_page"],
          act: ["add"],
        },
      }),
    );
    process.env.SHIPIFY_TOOLS_FILE = join(home, "tools.json");
    process.env.SHIPIFY_NOTES_READ = "a-key";
    const tools = join(home, "run");
    opencode.argv({ command: ["opencode", "run"], tools: { mode: "look", dir: tools } });
    const rules = JSON.parse(readFileSync(join(tools, "gate.json"), "utf8"));
    expect(rules.look).toEqual({ my_notes_read_page: "my_notes.read_page" });
    const check = (tool: string) => ShipifyGate.refused(rules, tool, {}, home, tools);
    expect(check("my_notes_read_page")).toBeUndefined();
    expect(check("my_notes_add")).toBeTruthy();
    expect(check("constructor")).toBeTruthy();
  });

  it("names tools.json's calls as tool.call, and reads outside for the web and a command that fetches", () => {
    const gate = (call: string, more = {}) => ({ type: "shipify", call, ...more });
    expect(read([gate("my_notes.read_page"), gate("apply_patch")])).toMatchObject({
      tools: { "my_notes.read_page": 1, apply_patch: 1 },
    });
    expect(read([gate("notion.search")]).readOutside).toBeUndefined();
    expect(read([gate("websearch")]).readOutside).toBe(true);
    expect(read([gate("bash", { command: "env A=1 curl example.com" })]).readOutside).toBe(true);
    expect(read([gate("bash", { command: "make verify" })]).readOutside).toBeUndefined();
    // OpenCode's own event of a call counts nothing: the gate's line did.
    const own = { type: "tool_use", part: { tool: "webfetch", state: { input: { url: "x" } } } };
    expect(read([own])).toEqual({});
    // A gate's line that landed at the end of a piece of OpenCode's long event still counts; one
    // quoted inside OpenCode's own text is that text.
    const piece = '{"type":"tool_use","part":{"tool":"bash","state":{"output":"aaaa';
    expect(read([`${piece}{"type":"shipify","call":"webfetch"}`])).toMatchObject({
      tools: { webfetch: 1 },
      readOutside: true,
    });
    const quoted = { type: "text", part: { text: '{"type":"shipify","call":"webfetch"}' } };
    expect(read([quoted]).readOutside).toBeUndefined();
  });
});
