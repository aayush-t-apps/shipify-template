// A run with pi (ADR 0038), off a box, through the real core: think hands it its login (its
// gateway's key, alone), its settings in the run's own tools folder (Shipify's gate, the gateway as
// a provider of its own), the model's id at its gateway, and reads its answer from its final
// message. The stand-in (tests/fixtures/fake-pi.mjs) keeps what it was given.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { think } from "../cli/kernel/think.ts";
import type { Snapshot, Think } from "../cli/kernel/types.ts";
import { newState, type TaskState } from "../cli/lib/task.ts";
import { ROOT, sandbox } from "./helpers.ts";

const saved = { ...process.env };
let dir = "";

beforeEach(() => {
  const sb = sandbox();
  dir = mkdtempSync(join(tmpdir(), "pi-run-"));
  const executors = JSON.parse(readFileSync(join(ROOT, "executors.json"), "utf8"));
  executors.pi.task = [process.execPath, join(ROOT, "tests/fixtures/fake-pi.mjs")];
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

const snap = (effort?: string): Snapshot => ({
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
    use: {
      agent: "pi",
      model: "poolside/laguna-s-2.1:free",
      ...(effort ? { effort } : {}),
      label: "Pi · laguna-s-2.1:free",
    },
  },
  trigger: { kind: "opened" },
  now: "2026-10-06T10:00:00.000Z",
  run: { id: "70", url: "https://github.com/o/shipify/actions/runs/70" },
  parsed: { kind: "question", ask: "what is 2+2?" },
  bodyHash: "aaaa",
  projects: [],
  repos: [],
  isTask: true,
});
const talk: Think = { profile: "talk", why: "new", notes: [], fresh: [], web: true };

describe("a run with pi", () => {
  it("hands it its gateway's key alone, its settings, the model's id, and reads its answer", async () => {
    const keep = join(dir, "keep");
    const out = await think(snap(), talk, {
      files: join(dir, "files"),
      keep,
      local: join(dir, "place"),
    });
    const result = JSON.parse(readFileSync(join(keep, "result.json"), "utf8"));
    expect(result).toMatchObject({ state: "done", text: "Two plus two is four." });
    const given = JSON.parse(readFileSync(join(dir, "place", "out", "pi-was-given.json"), "utf8"));
    // Its login is its gateway's key (on a box it starts from an empty environment: sandbox.test.ts).
    expect(given.key).toBe(true);
    expect(given.env).toEqual(
      expect.arrayContaining(["OPENROUTER_API_KEY", "PI_CODING_AGENT_DIR", "PI_OFFLINE"]),
    );
    // Its settings, in the run's own tools folder: the gate and its rules, the gateway's provider.
    expect(given.settings).toEqual(
      expect.arrayContaining(["gate.json", "gate.mjs", "models.json"]),
    );
    expect(given.models.providers["shipify-openrouter"]).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai-completions",
      apiKey: "$OPENROUTER_API_KEY",
    });
    const argv = given.argv.join(" ");
    expect(argv).toContain("--model poolside/laguna-s-2.1:free");
    expect(argv).toContain("--provider shipify-openrouter");
    expect(argv).toContain("--no-approve");
    // Auto's effort, High: a level every listed model takes, or the nearest one (OpenRouter).
    expect(argv).toContain("--thinking high");
    expect(given.models.providers["shipify-openrouter"].models).toEqual([
      { id: "poolside/laguna-s-2.1:free", reasoning: true, thinkingLevelMap: { max: "max" } },
    ]);
    // The run's details: pi, the version executors.json pins, the model, its tokens.
    expect(out.details).toMatchObject({
      agent: "pi",
      version: "1.0.2",
      model: "poolside/laguna-s-2.1:free",
    });
    expect(out.details?.tokens?.output).toBe(40);
    expect(out.meta.readOutside).toBe(false);
    // No cost is said: pi has no price for a gateway's model.
    expect(out.details?.cost).toBeUndefined();
  }, 30_000);

  it("says `off` and `max` to the gateway as they are: none (thinking off) and max", async () => {
    for (const effort of ["off", "max"]) {
      await think(snap(effort), talk, {
        files: join(dir, "files"),
        keep: join(dir, `keep-${effort}`),
        local: join(dir, `place-${effort}`),
      });
      const given = JSON.parse(
        readFileSync(join(dir, `place-${effort}`, "out", "pi-was-given.json"), "utf8"),
      );
      expect(given.argv.join(" ")).toContain(`--thinking ${effort}`);
      // A reasoning model to pi, so `off` goes out as effort "none", never as nothing (which is the
      // model's own default: GLM's is max); `max` is mapped, or pi would send high.
      expect(given.models.providers["shipify-openrouter"].models[0]).toMatchObject({
        reasoning: true,
        thinkingLevelMap: { max: "max" },
      });
    }
  }, 30_000);

  it("takes a question answered in plain words as its reply, and says so", async () => {
    const keep = join(dir, "keep-plain");
    process.env.FAKE_PI_SAYS = "Hi! How can I help you today?";
    try {
      const out = await think(snap(), talk, {
        files: join(dir, "files"),
        keep,
        local: join(dir, "place-plain"),
      });
      const result = JSON.parse(readFileSync(join(keep, "result.json"), "utf8"));
      expect(result).toEqual({ v: 2, state: "done", text: "Hi! How can I help you today?" });
      expect(out.details?.notes?.join(" ")).toContain("It answered in words");
    } finally {
      delete process.env.FAKE_PI_SAYS;
    }
  }, 30_000);
});
