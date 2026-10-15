// Apply's push from the agent's bundle (ADR 0031), against local repos: git's file transport is off
// in apply's clone, but the bundle, which git reads through it, must still come in, into a repo
// with a main or into a new project's empty one.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterRefusedPush, fetchBundle, labelled, onBranch } from "../cli/kernel/apply.ts";

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function agentBundle(dir: string, origin: string, empty: boolean): string {
  const agent = join(dir, "agent");
  git(dir, "clone", "-q", origin, agent);
  if (empty) git(agent, "checkout", "-q", "--orphan", "work");
  else git(agent, "checkout", "-q", "-B", "work", "origin/main");
  git(agent, "commit", "-q", "--allow-empty", "-m", "the agent's change");
  const bundle = join(dir, "work.bundle");
  if (empty) git(agent, "bundle", "create", "-q", bundle, "work");
  else git(agent, "bundle", "create", "-q", bundle, "work", "--not", "origin/main");
  return bundle;
}

describe("apply's push from a bundle", () => {
  it("fetches the agent's commits onto the task's branch, with the file transport off", () => {
    const dir = mkdtempSync(join(tmpdir(), "push-"));
    const origin = join(dir, "origin.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed");
    git(dir, "clone", "-q", origin, seed);
    git(seed, "commit", "-q", "--allow-empty", "-m", "first");
    git(seed, "push", "-q", "origin", "main");
    const bundle = agentBundle(dir, origin, false);
    const apply = join(dir, "apply");
    git(dir, "clone", "-q", "--no-checkout", origin, apply);
    fetchBundle(apply, "token", bundle, "task/12-x");
    expect(git(apply, "log", "--format=%s", "task/12-x")).toBe("the agent's change\nfirst\n");
  });

  it("fetches a new project's first commits onto an empty repo's main", () => {
    const dir = mkdtempSync(join(tmpdir(), "push-"));
    const origin = join(dir, "empty.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const bundle = agentBundle(dir, origin, true);
    const apply = join(dir, "apply");
    git(dir, "clone", "-q", "--no-checkout", origin, apply);
    fetchBundle(apply, "token", bundle, "main");
    expect(git(apply, "log", "--format=%s", "main")).toBe("the agent's change\n");
  });
});

describe("a refused push (ADR 0032's review)", () => {
  it("turns the run's reply into one Failed reply: no PR to merge, no question, the agent's words in sight", () => {
    const r = afterRefusedPush({
      w: "reply",
      kind: "needs-you",
      state: "Needs you",
      text: "Merge the PR to approve it.",
      question: "Merge it?",
      step: "think-work",
    });
    expect(r).toMatchObject({ kind: "failed", state: "Failed", step: "think-work" });
    expect(r.question).toBeUndefined();
    expect(r.text).toBe("**What the agent said:**\n\nMerge the PR to approve it.");
  });
});

describe("a PR step that can't fail on what a repo lacks (task #163)", () => {
  it("a run with nothing new still opens the PR for an earlier run's commits on the task's branch", () => {
    const dir = mkdtempSync(join(tmpdir(), "resume-"));
    const origin = join(dir, "origin.git");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(dir, "seed");
    git(dir, "clone", "-q", origin, seed);
    git(seed, "commit", "-q", "--allow-empty", "-m", "first");
    git(seed, "push", "-q", "origin", "main");
    git(seed, "checkout", "-q", "-b", "task/163-expiry");
    git(seed, "commit", "-q", "--allow-empty", "-m", "the agent's change, pushed before");
    git(seed, "push", "-q", "origin", "task/163-expiry");
    git(seed, "push", "-q", "origin", "main:task/164-same-as-main");
    const clone = join(dir, "apply");
    git(dir, "clone", "-q", "--no-checkout", origin, clone);
    expect(onBranch(clone, "t", "task/163-expiry")).toBe(
      git(seed, "rev-parse", "task/163-expiry").trim(),
    );
    // Nothing ahead of main, or no branch at all: there's truly nothing to open.
    expect(() => onBranch(clone, "t", "task/164-same-as-main")).toThrow("no commits to push");
    expect(() => onBranch(clone, "t", "task/165-none")).toThrow("no commits to push");
  });

  it("puts the preview label on after the PR, making it first when the repo has none", () => {
    const bin = mkdtempSync(join(tmpdir(), "gh-"));
    const log = join(bin, "calls");
    writeFileSync(log, "");
    const fake = (fails: string) => {
      writeFileSync(
        join(bin, "gh"),
        `#!/bin/sh\necho "$*" >> ${log}\ncase "$*" in *${fails}*) exit 1;; esac\nexit 0\n`,
      );
      chmodSync(join(bin, "gh"), 0o755);
    };
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    try {
      fake("never-matches");
      expect(labelled("o/links", "https://github.com/o/links/pull/9", "t")).toBe(true);
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls[0]).toMatch(/^label create preview -R o\/links .*--force/);
      expect(calls[1]).toBe(
        "pr edit https://github.com/o/links/pull/9 -R o/links --add-label preview",
      );
      // The label can't be put on: said, never a failed PR.
      fake("pr edit");
      expect(labelled("o/links", "https://github.com/o/links/pull/9", "t")).toBe(false);
    } finally {
      process.env.PATH = was;
    }
  });
});
