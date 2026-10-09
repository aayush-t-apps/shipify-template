// A merged task's deploy, as its run follows it (cli/commands/task/deploys.ts): live, failed or gone,
// read from the pipeline's mark on the merge commit.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deployState, followDeploy, GIVE_UP_MS } from "../cli/commands/task/deploys.ts";

const was = process.env.PATH;
afterEach(() => {
  process.env.PATH = was;
});

describe("a merged task's deploy, followed by the run that saw the merge", () => {
  const d = {
    app: "links",
    repo: "o/links",
    sha: "abc",
    url: "https://lnk.app",
    staging: false,
    since: "2026-10-05T10:00:00.000Z",
  };
  const instantly = async () => {};
  it("says live as soon as the pipeline marks it, looking every 15 seconds", async () => {
    const seen = ["waiting", "waiting", "up"] as const;
    let looks = 0;
    const end = await followDeploy(d, undefined, instantly, () => ({
      state: seen[looks++] ?? "up",
    }));
    expect(end).toEqual({ state: "live", url: "https://lnk.app" });
    expect(looks).toBe(3);
  });
  it("says failed with its run, and gone when unreadable or after the give-up time", async () => {
    expect(
      await followDeploy(d, undefined, instantly, () => ({ state: "failed", run: "r" })),
    ).toEqual({ state: "failed", run: "r" });
    expect(await followDeploy(d, undefined, instantly, () => ({ state: "unreadable" }))).toEqual({
      state: "gone",
    });
    let looks = 0;
    const end = await followDeploy(d, undefined, instantly, () => {
      looks++;
      return { state: "waiting" };
    });
    expect(end).toEqual({ state: "gone" });
    expect(looks).toBe(GIVE_UP_MS / 15_000 + 1);
  });
});

describe("a deploy's state, when merges land close together", () => {
  /** A stand-in gh for `api`: each path's answer (the compare's is its status). */
  function api(answers: Record<string, string>) {
    const bin = mkdtempSync(join(tmpdir(), "gh-"));
    const cases = Object.entries(answers)
      .map(([path, out]) => `  "${path}") echo '${out}' ;;`)
      .join("\n");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$2" in\n${cases}\n  *) echo '{}' ;;\nesac\n`);
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}:${was}`;
  }
  const d = { repo: "o/links", sha: "abc", since: "2026-10-05T10:00:00.000Z" };
  const marked = (state: string) =>
    JSON.stringify({ statuses: [{ context: "shipify/main", state, target_url: "run" }] });

  it("its own mark decides", () => {
    api({ "repos/o/links/commits/abc/status": marked("success") });
    expect(deployState(d).state).toBe("up");
  });

  it("with no mark of its own, a later commit on main that holds it decides (its run was dropped)", () => {
    api({
      "repos/o/links/commits/abc/status": JSON.stringify({ statuses: [] }),
      "repos/o/links/compare/abc...main": "ahead",
      "repos/o/links/commits/main/status": marked("success"),
    });
    expect(deployState(d).state).toBe("up");
    // Main still at this commit: its own run is under way.
    api({
      "repos/o/links/commits/abc/status": JSON.stringify({ statuses: [] }),
      "repos/o/links/compare/abc...main": "identical",
      "repos/o/links/commits/main/status": marked("success"),
    });
    expect(deployState(d).state).toBe("waiting");
  });
});
