#!/usr/bin/env node
// Peek at what the agent is doing on this box right now, in plain words: each file it reads or
// edits, each command it runs, and what it says. It reads Claude Code's session log for the box's
// workspace; it never changes anything.
//   node shipify/box/peek.mjs            the last 30 steps
//   node shipify/box/peek.mjs --follow   and keep following (Ctrl+C stops)
// On a Pi or VPS (box setup 5), each slot's agent keeps its sessions in its own run folder
// (/srv/shipify-agent-<k>/run-<id>/config), which only it and root can read, so run it with sudo:
//   sudo node /home/shipify/runner/_work/shipify/shipify/box/peek.mjs --follow
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const follow = process.argv.includes("--follow");
const list = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * Where sessions are, and which of their workspaces count: this user's (the runner's _work/shipify
 * folder), and each slot's agent's runs (every workspace there is the agent's).
 */
function roots() {
  const own = [{ dir: join(homedir(), ".claude", "projects"), only: "-work-shipify" }];
  const agents = list("/srv")
    .filter((d) => /^shipify-agent-\d$/.test(d))
    .flatMap((slot) =>
      list(join("/srv", slot))
        .filter((r) => r.startsWith("run-"))
        .map((r) => ({ dir: join("/srv", slot, r, "config", "projects"), only: "" })),
    );
  return [...own, ...agents];
}

/** The newest session log of a box's agent. */
function newest() {
  const files = roots().flatMap(({ dir, only }) =>
    existsSync(dir)
      ? list(dir)
          .filter((d) => d.endsWith(only))
          .flatMap((d) =>
            list(join(dir, d))
              .filter((f) => f.endsWith(".jsonl"))
              .map((f) => join(dir, d, f)),
          )
      : [],
  );
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const short = (s) =>
  String(s)
    .replace(/\/home\/[^\s]*?\/_work\/shipify\//g, "")
    .replace(/\/srv\/shipify-agent-\d\/run-[^/\s]+\/work\//g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);

function steps(file) {
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    for (const c of e.message?.content ?? []) {
      if (c.type === "tool_use") {
        const i = c.input ?? {};
        out.push(
          `→ ${c.name} ${short(i.file_path ?? i.command ?? i.pattern ?? i.path ?? i.skill ?? "")}`,
        );
      } else if (c.type === "text" && e.message.role === "assistant" && c.text.trim()) {
        out.push(`  ${short(c.text.trim().split("\n")[0])}`);
      }
    }
  }
  return out;
}

let shown = 0;
let current;
for (;;) {
  const file = newest();
  if (!file) {
    console.log("No agent has run on this box yet.");
    process.exit(0);
  }
  if (file !== current) {
    current = file;
    const all = steps(file);
    console.log(
      `\n== ${new Date(statSync(file).mtimeMs).toLocaleString()} · ${all.length} steps so far`,
    );
    for (const s of all.slice(-30)) console.log(s);
    shown = all.length;
  } else {
    const all = steps(file);
    for (const s of all.slice(shown)) console.log(s);
    shown = all.length;
  }
  if (!follow) break;
  await new Promise((r) => setTimeout(r, 3000));
}
