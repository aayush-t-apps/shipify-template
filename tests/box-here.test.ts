// box/here.sh (ADR 0055): one command makes any Ubuntu machine a box. Its shape, read as text, and
// what it does before it changes anything, run for real with no terminal (setsid): it stops early
// with the reason, and leaves nothing behind.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "box", "here.sh");
const text = readFileSync(SCRIPT, "utf8");

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** here.sh run with no terminal, against an os-release of its own, in a TMPDIR of its own. */
function runIt(osRelease: string, ...args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "here-"));
  dirs.push(dir);
  const os = join(dir, "os-release");
  writeFileSync(os, osRelease);
  const tmp = join(dir, "tmp");
  spawnSync("mkdir", [tmp]);
  const r = spawnSync("setsid", ["bash", SCRIPT, ...args], {
    encoding: "utf8",
    input: "",
    env: { PATH: process.env.PATH, HOME: dir, TMPDIR: tmp, SHIPIFY_OS_RELEASE: os },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, left: readdirSync(tmp) };
}

const UBUNTU = (v: string) =>
  `PRETTY_NAME="Ubuntu ${v} LTS"\nNAME="Ubuntu"\nVERSION_ID="${v}"\nID=ubuntu\n`;

describe("box/here.sh: its shape", () => {
  it("runs only once the whole file is read: main is called on its last line", () => {
    expect(text.trimEnd().split("\n").at(-1)).toBe('main "$@"');
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });

  it("reads every answer from the terminal, so it works piped, and never runs os-release", () => {
    const reads = text.split("\n").filter((l) => /\bread -r/.test(l) && !l.includes("<<<"));
    expect(reads.length).toBeGreaterThan(0);
    for (const l of reads) expect(l).toContain("</dev/tty");
    expect(text).not.toMatch(/^\s*(\.|source) "\$os"/m);
  });

  it("keeps the login in its own folder, and deletes it on every way out", () => {
    expect(text).toContain('export GH_CONFIG_DIR="$WORK/gh"');
    expect(text).toContain("trap cleanup EXIT");
    // Ctrl-C, a stop, and the SSH session dropping each end through it; gh's wait is interruptible.
    for (const sig of ["INT", "TERM", "HUP"])
      expect(text).toMatch(new RegExp(`trap 'exit \\d+' ${sig}`));
    expect(text).toMatch(/--web <\/dev\/null &\n\s*WAITING=\$!\n\s*wait "\$WAITING"/);
    expect(text).toContain('export TMPDIR="$WORK/tmp"');
    expect(text).toMatch(/cleanup\(\) \{[\s\S]*rm -rf "\$WORK"/);
    // Downloads are checked, never piped into a shell.
    expect(text.match(/sha256sum -c -/g)?.length).toBe(2);
    const code = text.split("\n").filter((l) => !/^\s*(#|note |printf)/.test(l));
    for (const l of code) expect(l).not.toMatch(/curl[^\n]*\|\s*(sudo )?(ba)?sh\b/);
  });
});

describe("box/here.sh: shellcheck, where it's installed (GitHub's machines have it)", () => {
  const has = spawnSync("shellcheck", ["--version"]).status === 0;
  it.runIf(has)("is clean", () => {
    const r = spawnSync("shellcheck", [SCRIPT], { encoding: "utf8" });
    expect(r.stdout).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("box/here.sh: before it changes anything", () => {
  it("--help says how to use it, and does nothing", () => {
    const r = runIt(UBUNTU("24.04"), "--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("--remove");
    expect(r.left).toEqual([]);
  });

  it("stops on another OS, or an Ubuntu that isn't 24.04 LTS or newer", () => {
    const debian = runIt('PRETTY_NAME="Debian GNU/Linux 12"\nID=debian\nVERSION_ID="12"\n');
    expect(debian.code).toBe(1);
    expect(debian.out).toContain(
      "this is Debian GNU/Linux 12: a box needs Ubuntu Server 24.04 LTS",
    );
    const old = runIt(UBUNTU("22.04"));
    expect(old.out).toContain("a box needs Ubuntu Server 24.04 LTS");
    const interim = runIt(UBUNTU("25.10"));
    expect(interim.out).toContain("a box needs Ubuntu Server 24.04 LTS");
    expect([debian.left, old.left, interim.left]).toEqual([[], [], []]);
  });

  it("with no terminal (a start-up script), stops: it needs your approval", () => {
    const r = runIt(UBUNTU("24.04"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("it needs a terminal");
    expect(r.left).toEqual([]);
  });

  it("refuses an option it doesn't know, and slots out of range", () => {
    expect(runIt(UBUNTU("24.04"), "--fast").out).toContain("unknown option --fast");
    expect(runIt(UBUNTU("24.04"), "--slots", "9").out).toContain("--slots is a number from 1 to 4");
  });
});
