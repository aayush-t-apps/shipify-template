// One way to run git (ADR 0044, cli/lib/clones.ts): the clone shapes, the key only ever in the
// environment, the disk, and apply's checkout with real git. What a read checks out is
// tests/reads.test.ts's, end to end.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cloneArgs,
  DISK_FLOOR_BYTES,
  fits,
  gitConfig,
  gitEnv,
  keyFor,
  SAFE,
  sizeSaid,
} from "../cli/lib/clones.ts";
import { sparse } from "../cli/kernel/apply.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("the clone shapes (ADR 0044)", () => {
  it("a read is depth 1, one branch, no tags and no checkout; outside your account, no links", () => {
    expect(cloneArgs("read", "U", "D")).toEqual([
      "git",
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--no-tags",
      "--single-branch",
      "--no-checkout",
      "U",
      "D",
    ]);
    expect(cloneArgs("read", "U", "D", { outside: true })).toContain("core.symlinks=false");
  });

  it("a change keeps its whole history, as it always did", () => {
    expect(cloneArgs("change", "U", "work")).toEqual(["git", "clone", "--quiet", "U", "work"]);
  });

  it("apply's is history without contents and no checkout: main, or nothing in an empty repo", () => {
    const a = cloneArgs("apply", "U", "D");
    expect(a).toEqual(
      expect.arrayContaining(["--filter=blob:none", "--no-checkout", "--single-branch"]),
    );
    expect(a.join(" ")).toContain("--branch main");
    expect(cloneArgs("apply", "U", "D", { empty: true })).not.toContain("--branch");
  });

  it("never puts a key in the arguments", () => {
    for (const shape of ["read", "change", "apply"] as const)
      expect(cloneArgs(shape, "https://github.com/o/r.git", "D").join(" ")).not.toMatch(
        /AUTHORIZATION|token/i,
      );
  });
});

describe("git's environment", () => {
  it("numbers its settings for git, the safe ones first", () => {
    expect(
      gitConfig([
        ["a.b", "1"],
        ["c.d", ""],
      ]),
    ).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "a.b",
      GIT_CONFIG_VALUE_0: "1",
      GIT_CONFIG_KEY_1: "c.d",
      GIT_CONFIG_VALUE_1: "",
    });
    const env = gitEnv("ghs_x");
    expect(env.GIT_CONFIG_KEY_0).toBe(SAFE[0]?.[0]);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("carries the key as github.com's header, and nothing of it without a key", () => {
    const [name, value] = keyFor("ghs_x");
    expect(name).toBe("http.https://github.com/.extraheader");
    expect(value).toBe(
      `AUTHORIZATION: basic ${Buffer.from("x-access-token:ghs_x").toString("base64")}`,
    );
    expect(Object.values(gitEnv("ghs_x"))).toContain(value);
    expect(JSON.stringify(gitEnv())).not.toContain("AUTHORIZATION");
  });

  it("is built from nothing: none of this process's own git settings or keys", () => {
    const was = { ...process.env };
    Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/x", GH_TOKEN: "ghs_y", GIT_ASKPASS: "/y" });
    try {
      expect(Object.keys(gitEnv()).sort()).toEqual(
        ["GIT_TERMINAL_PROMPT", "HOME", "PATH", ...Object.keys(gitConfig(SAFE))].sort(),
      );
    } finally {
      process.env = was;
    }
  });
});

describe("the disk", () => {
  it("fits a clone only when it leaves doctor's floor free", () => {
    const gb = 1024 ** 3;
    expect(DISK_FLOOR_BYTES).toBe(5 * gb);
    expect(fits(1 * gb, 7 * gb)).toBe(true);
    expect(fits(3 * gb, 7 * gb)).toBe(false);
    expect(sizeSaid(1.84 * gb)).toBe("1.8 GB");
    expect(sizeSaid(640 * 1024 ** 2)).toBe("640 MB");
  });
});

describe("apply's checkout: only the files its checks read (ADR 0044)", () => {
  it("checks out exactly the paths it names, wildcards and all taken literally", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparse-"));
    const src = join(dir, "src");
    mkdirSync(join(src, ".github", "workflows"), { recursive: true });
    git(src, "init", "-q", "-b", "main");
    for (const f of [
      "a[1].ts",
      "a1.ts",
      "*.md",
      "x.md",
      "shipify.json",
      ".github/workflows/ship.yml",
    ])
      writeFileSync(join(src, f), "x\n");
    git(src, "add", "-A");
    git(src, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    const [, ...args] = cloneArgs("apply", `file://${src}`, join(dir, "apply"));
    git(dir, "-c", "protocol.file.allow=always", "-c", "uploadpack.allowFilter=true", ...args);
    const at = join(dir, "apply");
    execFileSync("git", ["sparse-checkout", "set", "--no-cone", "--stdin"], {
      cwd: at,
      input: sparse(["a[1].ts", "*.md", "shipify.json", ".github/workflows/"]),
    });
    git(at, "checkout", "-q", "main");
    const on = git(at, "ls-files", "-t")
      .split("\n")
      .filter((l) => l.startsWith("H "))
      .map((l) => l.slice(2))
      .sort();
    expect(on).toEqual([".github/workflows/ship.yml", "*.md", "a[1].ts", "shipify.json"].sort());
  });
});
