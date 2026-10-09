#!/usr/bin/env node
// A stand-in agent for the run's think step (tests/kernel-flow.test.ts): it reads the prompt on
// stdin, keeps it and its arguments beside the result for the test to read, and writes the result
// FAKE_RESULT says (none when it's empty: an agent that stopped without one).
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const prompt = readFileSync(0, "utf8");
// A work run (tests/kernel-gate.test.ts), FAKE_WORK set: it commits in its clone (its working
// folder) and answers in the result's schema, with a session. Resumed (--resume), it's the round to
// fix what the box's checks found: FAKE_WORK=fix commits the file they want; anything else, nothing.
// Stopped before its answer (ADR 0035): it commits, leaves an edit it hasn't committed, then
// crashes (FAKE_WORK=crash), hits your plan's limit (plan), or ends with no answer (no-answer).
// What it was asked, kept beside its result for the test to read: the first ask, or the fix round
// (resumed).
// Resumed with what you wrote while it worked, it's the catch-up (catchup-prompt.md).
const catchUp = prompt.startsWith("While you worked");
if (process.env.FAKE_WORK) {
  const resumed = process.argv.slice(2).includes("--resume");
  const asked = resumed ? (catchUp ? "catchup" : "fix") : "first";
  writeFileSync(join("..", "out", `${asked}-prompt.md`), prompt);
  writeFileSync(join("..", "out", `${asked}-argv.json`), JSON.stringify(process.argv.slice(2)));
  // The keys it was handed, by name, and which GitHub key (a test's fake): what a run holds (ADR 0045).
  writeFileSync(
    join("..", "out", `${asked}-env.json`),
    JSON.stringify({
      keys: Object.keys(process.env).filter((k) => /TOKEN|_READ$|_KEY$/.test(k)),
      github: process.env.GH_TOKEN ?? null,
    }),
  );
  // FAKE_HANDOFF: the handoff it keeps as it works (ADR 0041), written before anything can stop it.
  if (process.env.FAKE_HANDOFF)
    writeFileSync(join("..", "out", "handoff.md"), process.env.FAKE_HANDOFF);
}
// FAKE_WORK=helper-crash: a helper of its own works in a worktree inside the clone (where Claude
// Code puts them), beside another under a name of its own and a nested repo, then it crashes: none of
// them is ever committed (ADR 0041).
// FAKE_WORK=merge-crash: it starts merging main, which conflicts, and crashes mid-merge.
// FAKE_WORK=refresh-crash: it runs Shipify's refresh itself (FAKE_SHIP), which stops on a
// conflict, and crashes there. FAKE_WORK=resolve-crash: it settles that conflict with a plain
// commit, then crashes.
if (
  [
    "crash",
    "plan",
    "no-answer",
    "merge-crash",
    "refresh-crash",
    "resolve-crash",
    "helper-crash",
  ].includes(process.env.FAKE_WORK ?? "")
) {
  writeFileSync("change.txt", "x\n");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["commit", "-q", "-m", "The change"]);
  if (process.env.FAKE_WORK === "resolve-crash") {
    try {
      execFileSync(process.execPath, [process.env.FAKE_SHIP ?? "", "refresh", ".", "--no-fetch"], {
        stdio: "ignore",
      });
    } catch {}
    writeFileSync("notes.txt", "both\n");
    execFileSync("git", ["commit", "-q", "-am", "Settled by hand"]);
    process.exit(1);
  }
  if (process.env.FAKE_WORK === "refresh-crash") {
    try {
      execFileSync(process.execPath, [process.env.FAKE_SHIP ?? "", "refresh", ".", "--no-fetch"], {
        stdio: "ignore",
      });
    } catch {}
    process.exit(1);
  }
  if (process.env.FAKE_WORK === "merge-crash") {
    try {
      execFileSync("git", ["merge", "-q", "--no-edit", "origin/main"], { stdio: "ignore" });
    } catch {}
    process.exit(1);
  }
  if (process.env.FAKE_WORK === "helper-crash") {
    execFileSync("git", ["worktree", "add", "-q", "-b", "helper", ".claude/worktrees/helper"]);
    writeFileSync(".claude/worktrees/helper/side.txt", "the helper's\n");
    execFileSync("git", ["worktree", "add", "-q", "-b", "side", "notes/side"]);
    execFileSync("git", ["init", "-q", "nested/repo"]);
    execFileSync("git", ["init", "-q", "odd/café [1]"]);
  }
  writeFileSync("draft.txt", "half done\n");
  if (process.env.FAKE_WORK === "plan")
    process.stdout.write(
      `${JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1791240000 } })}\n`,
    );
  process.exit(process.env.FAKE_WORK === "no-answer" ? 0 : 1);
}
// FAKE_WORK=slow: it commits, leaves an edit, then works on until it's stopped (your `stop`).
if (process.env.FAKE_WORK === "slow" && !catchUp) {
  writeFileSync("change.txt", "x\n");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["commit", "-q", "-m", "The change"]);
  writeFileSync("draft.txt", "half done\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
  process.exit(0);
} else if (process.env.FAKE_WORK) {
  const argv = process.argv.slice(2);
  const resumed = argv.includes("--resume") && !catchUp;
  if (catchUp) {
    appendFileSync("later.txt", "x\n");
    execFileSync("git", ["add", "-A"]);
    execFileSync("git", ["commit", "-q", "-m", "What you added"]);
  } else if (!resumed || process.env.FAKE_WORK === "fix") {
    // Appended, so a run that starts from earlier commits still has a change of its own.
    appendFileSync(resumed ? "fixed" : "change.txt", "x\n");
    execFileSync("git", ["add", "-A"]);
    execFileSync("git", [
      "commit",
      "-q",
      "-m",
      resumed ? "Fix what the checks found" : "The change",
    ]);
  }
  // FAKE_FETCH names the ask that reads a web page (first, catchup or fix): a read in any ask
  // counts for the whole run.
  if (process.env.FAKE_FETCH === (catchUp ? "catchup" : resumed ? "fix" : "first"))
    process.stdout.write(
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } }] } })}\n`,
    );
  const pr = { kind: "closes", title: "Make it pass", body: "Why" };
  const text = catchUp ? "Covered both." : resumed ? "Fixed it." : "Made it.";
  // FAKE_WORK=question: it stops mid-change to ask you, with an edit it hasn't committed and no PR
  // (ADR 0041).
  if (process.env.FAKE_WORK === "question") writeFileSync("draft.txt", "half done\n");
  // FAKE_WORK=question-workflow: the same, with a workflow file among its edits (a push refuses it).
  if (process.env.FAKE_WORK === "question-workflow") {
    mkdirSync(".github/workflows", { recursive: true });
    writeFileSync(".github/workflows/x.yml", "on: push\n");
  }
  const answer =
    process.env.FAKE_WORK === "question" || process.env.FAKE_WORK === "question-workflow"
      ? { v: 2, state: "needs-you", text: "Which colour?", question: "Blue or green?" }
      : { v: 2, state: "needs-you", text, pr };
  process.stdout.write(
    `${JSON.stringify({ type: "system", subtype: "init", session_id: "s-1" })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", num_turns: 1, structured_output: answer })}\n`,
  );
  process.exit(0);
}
const result = /Write `([^`]+result\.json)`/.exec(prompt)?.[1];
// A read run (ADR 0044) writes no file: its answer is its final message (FAKE_FINAL), and what the
// test reads is kept in out/, beside its working folder (read/).
const reading = prompt.includes("this run writes no file");
if (!result && !reading && !catchUp) {
  process.stderr.write("fake thinker: no result path in the prompt\n");
  process.exit(2);
}
const out = result ? dirname(result) : join(process.cwd(), "..", "out");
writeFileSync(join(out, "prompt.md"), prompt);
writeFileSync(join(out, "argv.json"), JSON.stringify(process.argv.slice(2)));
// The keys it was handed (names only), and where it ran: what a read run holds (ADR 0044).
writeFileSync(
  join(out, "env.json"),
  JSON.stringify({
    keys: [
      "GH_TOKEN",
      "SHIPIFY_AGENT_READ_TOKEN",
      "SHIPIFY_NOTION_READ",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ].filter((k) => process.env[k]),
    cwd: process.cwd(),
  }),
);
if (process.env.FAKE_FILE) writeFileSync(join(out, "report.txt"), process.env.FAKE_FILE);
if (process.env.FAKE_RESULT && result) writeFileSync(result, process.env.FAKE_RESULT);
// Its model's error, as Claude Code's stream ends on one when its own retries gave up: FAKE_ERROR.
if (process.env.FAKE_ERROR)
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", is_error: true, result: process.env.FAKE_ERROR })}\n`,
  );
// Its final answer in the result's schema, as Claude Code's stream gives it (--json-schema), with
// no file written: FAKE_FINAL. Its session first, as the real stream starts (a catch-up resumes it);
// each ask's arguments kept apart, for a test to compare them.
if (process.env.FAKE_FINAL) {
  if (!process.env.FAKE_WORK)
    process.stdout.write(
      `${JSON.stringify({ type: "system", subtype: "init", session_id: "s-1" })}\n`,
    );
  const resumed = process.argv.includes("--resume");
  writeFileSync(
    join(out, `${resumed ? "catchup" : "first"}-final-argv.json`),
    JSON.stringify(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", num_turns: 1, structured_output: JSON.parse(process.env.FAKE_FINAL) })}\n`,
  );
}
