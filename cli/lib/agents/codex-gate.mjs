// Shipify's gate for Codex (ADR 0074, ADR 0043): Codex's PreToolUse hook, which holds it to the
// rules every agent gets, with pi's gate's own checks (pi-gate.mjs, copied beside it). codex.ts's
// adapter names it in Codex's hooks, so each call is checked before it runs, its helpers' too:
// - a command (Codex names its exec_command `Bash`): runs, unless a part of it is a refused one, as
//   pi's gate decides; a patch through it (`apply_patch <<'…'`) writes only inside its working
//   folder or the folders it may write;
// - a tool's call (`mcp__<tool>__<call>`): only the look calls it was given (its adapter enables no
//   other);
// - anything else is Codex's own and touches no file of the box's (an image it views, its helpers):
//   it runs. Its web search is OpenAI's own, off when the run may not read the web (codex.ts).
// Checked live on Codex 0.167.0: input typed into a command already running (write_stdin) comes
// through no hook, so a shell it starts is past the gate; the walls are outside the agent (its own
// Linux user, read-only keys, the box's own push).
// Codex hands the call over on stdin and reads the answer on stdout, Claude Code's way: a refusal is
// `permissionDecision: "deny"` with the reason, which Codex gives the model; nothing is an allow.
// Plain JavaScript, so Node runs it as it is. tests/plugins/agent.test.ts holds it to the rules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REFUSED, refused, refusedCommand } from "./pi-gate.mjs";

/** The files a patch changes: `*** Add File: x`, `*** Update File: x`, `*** Move to: x`. */
const patched = (text) =>
  [
    ...String(text ?? "").matchAll(
      /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm,
    ),
  ].map((m) => (m[1] ?? m[2]).trim());

/** Why Codex's call (its hook's input) isn't allowed, or undefined when it is. */
export function decide(rules, input, own) {
  const tool = String(input?.tool_name ?? "");
  const args = input?.tool_input ?? {};
  const cwd = String(input?.cwd ?? process.cwd());
  if (tool === "Bash") {
    const command = String(args.command ?? "");
    const why = refusedCommand(rules, command);
    if (why || !/^\s*apply_patch\b/.test(command)) return why;
    const files = patched(command);
    if (!files.length) return "a patch that names no file";
    for (const f of files) {
      const no = refused(rules, "write", { path: f }, cwd, own);
      if (no) return no;
    }
    return undefined;
  }
  if (tool.startsWith("mcp__"))
    return rules.look.includes(tool) ? undefined : `${tool} isn't one of the look calls it has`;
  return undefined;
}

// As Codex's hook: the call on stdin, a refusal on stdout.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const own = dirname(fileURLToPath(import.meta.url));
  const rules = JSON.parse(readFileSync(join(own, "gate.json"), "utf8"));
  let why;
  try {
    why = decide(rules, JSON.parse(readFileSync(0, "utf8")), own);
  } catch {
    why = "a call Shipify's gate couldn't read";
  }
  if (why)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${REFUSED}: ${why}`,
        },
      }),
    );
}
