#!/usr/bin/env node
// A stand-in for an agent's new version under the box's check (tests/agent-check.test.ts, ADR
// 0079). `install --prefix <p> <name>@<version>` installs it as npm would (version 9.9.9 isn't
// there); installed, it's `bin/claude`, which says its version and answers the check's asks as
// Claude Code's stream does: its commands decided by Shipify's gate, its login read from fd 3, its
// instructions from where Claude Code reads them.
// What each ask saw is kept beside the check's scratch repo (asks.jsonl), never the login itself.
// FAKE_CHECKED_SKIP: a command its first ask leaves out. FAKE_CHECKED_RUNS: a refused command it
// runs. FAKE_CHECKED_LEAK: its login written to a file. FAKE_CHECKED_BARE: no instructions read.
import { execSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refusedCommand } from "../../cli/lib/agents/pi-gate.mjs";

const argv = process.argv.slice(2);
const after = (flag) => {
  const out = [];
  for (let i = argv.indexOf(flag) + 1; i > 0 && i < argv.length && !argv[i].startsWith("--"); i++)
    out.push(argv[i]);
  return out;
};

if (argv[0] === "install") {
  const prefix = argv[argv.indexOf("--prefix") + 1];
  const version = /@([^@]+)$/.exec(argv.at(-1))?.[1] ?? "";
  if (version === "9.9.9") {
    process.stdout.write(`npm error 404 Not Found - ${argv.at(-1)}\n`);
    process.exit(1);
  }
  mkdirSync(join(prefix, "bin"), { recursive: true });
  const program = join(prefix, "bin", "claude");
  writeFileSync(
    program,
    `#!/bin/sh\nFAKE_VERSION='${version}' exec '${process.execPath}' '${fileURLToPath(import.meta.url)}' "$@"\n`,
  );
  chmodSync(program, 0o755);
  // What the install held: no login or key in its environment, and a HOME of its own.
  writeFileSync(
    join(prefix, "installed.json"),
    JSON.stringify({
      keys: Object.keys(process.env).filter((k) => /TOKEN|LOGIN|_KEY$/.test(k)),
      home: process.env.HOME,
    }),
  );
  process.exit(0);
}

const version = process.env.FAKE_VERSION ?? "?";
if (argv.includes("--version")) {
  process.stdout.write(`${version} (Claude Code)\n`);
  process.exit(0);
}

const prompt = readFileSync(0, "utf8");
const fd = process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
const login = fd ? readFileSync(Number(fd), "utf8").trim() : "";
const reading = argv.includes("--restricted");
const resumed = argv.includes("--resume");
appendFileSync(
  join(process.cwd(), "..", "asks.jsonl"),
  `${JSON.stringify({
    ask: reading ? "read" : resumed ? "again" : "first",
    login: Boolean(login),
    keys: Object.keys(process.env).filter((k) => /TOKEN|_READ$|_KEY$|GH_/.test(k)),
    model: after("--model")[0],
    home: process.env.HOME,
  })}\n`,
);
if (process.env.FAKE_CHECKED_LEAK && login)
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR ?? ".", "leak.txt"), login);

const say = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const skillsDir = join(process.env.CLAUDE_CONFIG_DIR ?? "/nowhere", "skills");
say({
  type: "system",
  subtype: "init",
  session_id: "c-1",
  model: "claude-haiku-4-5-20251001",
  claude_code_version: version,
  tools: reading ? ["Glob", "Grep", "Read"] : ["Task", "Bash", "Read", "Skill"],
  agents: ["general-purpose"],
  skills: existsSync(skillsDir) ? readdirSync(skillsDir) : [],
});
const done = (text, denials = []) =>
  say({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    result: text,
    modelUsage: { "claude-haiku-4-5-20251001": { inputTokens: 1000, outputTokens: 100 } },
    permission_denials: denials,
  });

if (reading) {
  // Its reads: inside its working folder and the folders it was given, else refused.
  const inside = [process.cwd(), ...after("--add-dir")];
  const lines = [];
  const denials = [];
  for (const [, path] of prompt.matchAll(/^- (\S+)$/gm)) {
    const f = isAbsolute(path) ? path : resolve(process.cwd(), path);
    if (inside.some((d) => f.startsWith(`${d}/`)) && existsSync(f))
      lines.push(`${path}: ${readFileSync(f, "utf8").split("\n")[0]}`);
    else {
      lines.push(`${path}: refused`);
      denials.push({ tool_name: "Read", tool_use_id: path, tool_input: { file_path: f } });
    }
  }
  done(lines.join("\n"), denials);
  process.exit(0);
}

// Its commands: each one asked (the check's list), decided by Shipify's gate.
const asked = [...prompt.matchAll(/^\s*- `(.+)`$/gm)].map((m) => m[1]);
const skill = /Load the skill `([^`]+)`/.exec(prompt)?.[1];
const content = skill ? [{ type: "tool_use", id: "s", name: "Skill", input: { skill } }] : [];
const denials = [];
asked.forEach((command, i) => {
  if (!resumed && command === process.env.FAKE_CHECKED_SKIP) return;
  content.push({ type: "tool_use", id: `b${i}`, name: "Bash", input: { command } });
  const refused =
    command !== process.env.FAKE_CHECKED_RUNS &&
    refusedCommand({ deny: ["git push", "git stash"] }, command);
  if (refused) denials.push({ tool_name: "Bash", tool_use_id: `b${i}`, tool_input: { command } });
  // Off a box the test's own environment reaches it, its login's variable too; a box's sandbox
  // starts it with none (env -i), so that one is left out here.
  else if (command === "env > env.txt")
    execSync(command, {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== "SHIPIFY_AGENT_LOGIN"),
      ),
    });
});
say({ type: "assistant", message: { content } });
// Its instructions as Claude Code 2.1.284 loads them with `--setting-sources user` (checked live
// against a stand-in API): never its working folder's own, but an added folder's CLAUDE.md when its
// settings say so, with the files that imports (`@AGENTS.md`).
const settings = JSON.parse(after("--settings")[0] ?? "{}");
const added = settings.env?.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD
  ? argv.flatMap((a, i) => (a === "--add-dir" ? [argv[i + 1]] : []))
  : [];
const text = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const instructions = added
  .map((d) => text(join(d, "CLAUDE.md")).replace(/^@(\S+)$/gm, (_, f) => text(join(d, f))))
  .join("\n");
const word = process.env.FAKE_CHECKED_BARE
  ? undefined
  : /is (w[0-9a-f]+)\./.exec(instructions)?.[1];
done(word ? `The word is ${word}.` : "no word", denials);
