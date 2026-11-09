#!/usr/bin/env node
// A stand-in for Codex in the run's think step (tests/agent-codex.test.ts): it reads the prompt on
// stdin, keeps what it was handed beside its answer for the test (its arguments, the names of its
// variables, the login in its home), refreshes its session there as Codex does (the same account,
// a newer `last_refresh`), and answers in Codex's own events, its final message in the result's
// shape.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prompt = readFileSync(0, "utf8");
const out = /Write `([^`]+)result\.json`/.exec(prompt)?.[1] ?? ".";
const home = process.env.CODEX_HOME ?? "";
let login = "";
try {
  login = readFileSync(join(home, "auth.json"), "utf8");
} catch {}
writeFileSync(
  join(out, "given.json"),
  JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env), login }),
);
const session = JSON.parse(login || "{}");
if (session.tokens)
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify(
      {
        ...session,
        tokens: { ...session.tokens, access_token: "renewed.e30.x", refresh_token: "rt-2" },
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
const say = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
say({ type: "thread.started", thread_id: "thr-1" });
say({ type: "turn.started" });
say({
  type: "item.completed",
  item: {
    id: "item_0",
    type: "agent_message",
    text: JSON.stringify({ v: 2, state: "done", text: "Two plus two is four." }),
  },
});
say({
  type: "turn.completed",
  usage: {
    input_tokens: 1000,
    cached_input_tokens: 400,
    output_tokens: 20,
    reasoning_output_tokens: 5,
  },
});
