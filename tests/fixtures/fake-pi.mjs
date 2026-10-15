#!/usr/bin/env node
// A stand-in for pi in the run's think step (tests/kernel-pi.test.ts): it reads the prompt on
// stdin, keeps what it was handed beside its answer for the test (its arguments, the names of its
// variables, the settings in its folder), and answers in pi's own events, its final message in the
// result's shape, or in plain words when FAKE_PI_SAYS gives them (as a smaller model may). It never
// sees a value it shouldn't. Its key, as Shipify's gate reads it: from the pipe SHIPIFY_LOGIN_FD names.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prompt = readFileSync(0, "utf8");
const out = /Write `([^`]+)result\.json`/.exec(prompt)?.[1] ?? ".";
const dir = process.env.PI_CODING_AGENT_DIR ?? "";
const fd = process.env.SHIPIFY_LOGIN_FD;
writeFileSync(
  join(out, "pi-was-given.json"),
  JSON.stringify({
    argv: process.argv.slice(2),
    env: Object.keys(process.env)
      .filter((k) => /^(PI_|OPENROUTER|CLAUDE|SHIPIFY_LOGIN)/.test(k))
      .sort(),
    key: fd ? readFileSync(Number(fd), "utf8").trim() === "sk-or-test" : false,
    settings: existsSync(dir) ? readdirSync(dir).sort() : [],
    models: existsSync(join(dir, "models.json"))
      ? JSON.parse(readFileSync(join(dir, "models.json"), "utf8"))
      : null,
  }),
);
const answer = { v: 2, state: "done", text: "Two plus two is four." };
const line = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
line({
  type: "session",
  version: 3,
  id: "pi-session-1",
  timestamp: "2026-10-06T00:00:00Z",
  cwd: ".",
});
line({ type: "agent_start" });
line({
  type: "message_end",
  message: {
    role: "assistant",
    provider: "shipify-openrouter",
    model: "poolside/laguna-s-2.1:free",
    usage: {
      input: 900,
      output: 40,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      cost: { total: 0 },
    },
    content: [
      {
        type: "text",
        text: process.env.FAKE_PI_SAYS ?? `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
      },
    ],
    stopReason: "stop",
  },
});
line({ type: "agent_end", messages: [] });
