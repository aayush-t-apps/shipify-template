#!/usr/bin/env node
// A stand-in for OpenCode in the run's think step (tests/kernel-opencode.test.ts): it reads the
// prompt on stdin, keeps what it was handed beside its answer for the test (its arguments, the
// names of its variables, whether it may write its own config folder, the key Shipify's gate puts
// on a call to its gateway, the XDG folders a command it runs gets), and answers in OpenCode's own
// events, its final message in the result's shape. It loads the gate as OpenCode does: its
// config's plugin, started once, then told the config it runs with (its plugin by its file's URL).
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const prompt = readFileSync(0, "utf8");
const out = /Write `([^`]+)result\.json`/.exec(prompt)?.[1] ?? ".";
const configFile = process.env.OPENCODE_CONFIG ?? "";
const config = JSON.parse(readFileSync(configFile, "utf8"));
const provider = String(config.model ?? "").split("/")[0];
const gateFile = join(dirname(configFile), "gate.mjs");
const { ShipifyGate } = await import(gateFile);
const hooks = await ShipifyGate();
await hooks.config?.({ ...config, plugin: [pathToFileURL(gateFile).href] });
const call = { headers: {} };
await hooks["chat.headers"]({ model: { providerID: provider } }, call);
const shell = { env: {} };
await hooks["shell.env"]?.({ cwd: process.cwd() }, shell);
const writable = (dir) => {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
const own = join(process.env.XDG_CONFIG_HOME ?? "", "opencode");
writeFileSync(
  join(out, "opencode-was-given.json"),
  JSON.stringify({
    argv: process.argv.slice(2),
    env: Object.keys(process.env)
      .filter((k) => /^(OPENCODE_|XDG_|OPENROUTER|CLAUDE|SHIPIFY_LOGIN)/.test(k))
      .sort(),
    headers: call.headers,
    xdg: Object.fromEntries(
      ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"].map((k) => [
        k,
        shell.env[k] ?? process.env[k],
      ]),
    ),
    ownConfig: { exists: existsSync(own), writable: writable(own) },
    provider: config.provider,
  }),
);
const answer = { v: 2, state: "done", text: "Two plus two is four." };
const line = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const session = "ses_fake1";
line({ type: "shipify", model: String(config.model).slice(provider.length + 1) });
line({
  type: "text",
  sessionID: session,
  part: { type: "text", text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` },
});
line({
  type: "step_finish",
  sessionID: session,
  part: {
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: { input: 900, output: 40, reasoning: 0, cache: { read: 0, write: 0 } },
  },
});
