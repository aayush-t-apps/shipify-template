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
    expect(runIt(UBUNTU("24.04"), "--slots", "0").out).toContain(
      "--slots is a whole number from 1",
    );
    expect(runIt(UBUNTU("24.04"), "--slots", "two").out).toContain(
      "--slots is a whole number from 1",
    );
    // setup.sh takes 1 to 9: refused here, before the login and the clone.
    expect(runIt(UBUNTU("24.04"), "--slots", "12").out).toContain(
      "--slots is a whole number from 1 to 9.",
    );
  });

  it("--manage makes a box you keep: passed to box add, and refused with --remove or --container", () => {
    expect(runIt(UBUNTU("24.04"), "--help").out).toContain("--manage");
    expect(text).toContain('[ "$MANAGE" = 1 ] && args+=(--manage)');
    // The plan run and the --yes run take the same args, so the plan shows what --yes does. A plan
    // that can't go ahead stops it there: nothing is asked.
    expect(text).toContain(
      'ship "${args[@]}" || die "nothing changed: box add can\'t go ahead (above), and names the fix."',
    );
    expect(text).toContain('ship "${args[@]}" --yes </dev/tty');
    const remove = runIt(UBUNTU("24.04"), "--manage", "--remove");
    expect(remove.out).toContain("--manage is for adding a box");
    const container = runIt(UBUNTU("24.04"), "--manage", "--container");
    expect(container.out).toContain("--manage isn't for a box in Docker");
    // Before anything: the OS isn't even looked at.
    expect(remove.out).not.toContain("Looking at this machine");
    expect([remove.left, container.left]).toEqual([[], []]);
  });

  it("stops at an option with no value, naming it, where it once stopped without a word", () => {
    for (const args of [["--copy"], ["--name"], ["--slots"], ["--copy", "--manage"]]) {
      const r = runIt(UBUNTU("24.04"), ...args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.out).toContain(`${args[0]} needs a value: ${args[0]} <value>.`);
    }
  });

  it("--replace goes to box add; --purge only with --remove, to box remove (setup 9)", () => {
    expect(runIt(UBUNTU("24.04"), "--help").out).toContain("--replace");
    expect(text).toContain('[ "$REPLACE" = 1 ] && args+=(--replace)');
    expect(text).toContain("args+=(--purge)");
    expect(runIt(UBUNTU("24.04"), "--purge").out).toContain("--purge goes with --remove");
    expect(runIt(UBUNTU("24.04"), "--replace", "--remove").out).toContain(
      "--replace is for adding a box",
    );
    expect(runIt(UBUNTU("24.04"), "--remove", "--purge", "--container").out).toContain(
      "--purge isn't for a box in Docker",
    );
  });

  /** One of here.sh's functions, with `ask` answering `answer`. */
  const yesTo = (answer: string) => {
    const fn = /^yes_to\(\) \{\n[\s\S]*?\n\}$/m.exec(text)?.[0] ?? "";
    return spawnSync(
      "bash",
      ["-c", `ask() { printf '%s' "$ANSWER"; }\n${fn}\nyes_to "Go" && echo yes || echo no`],
      { encoding: "utf8", env: { PATH: process.env.PATH, ANSWER: answer } },
    ).stdout.trim();
  };

  it("takes yes in any case, as a phone's keyboard writes it, and anything else as no", () => {
    for (const a of ["yes", "Yes", "YES", "y", "Y"]) expect(yesTo(a), a).toBe("yes");
    for (const a of ["no", "", "yes please", "N"]) expect(yesTo(a), a).toBe("no");
    // Every yes it asks goes through it: yes_to's is the only answer read as a case.
    expect(text.match(/case "\$\(ask /g)).toHaveLength(1);
    expect(text.match(/yes_to "/g)?.length).toBe(4);
  });

  it("--fresh starts over in one go: Shipify off this machine, then the box again, with its slots (setup 10)", () => {
    expect(runIt(UBUNTU("24.04"), "--help").out).toContain("--fresh");
    for (const [args, says] of [
      [["--fresh", "--remove"], "--fresh sets the box up again"],
      [["--fresh", "--replace"], "--fresh starts over on this machine's own box"],
      [["--fresh", "--container"], "--fresh isn't for a box in Docker"],
    ] as const) {
      const r = runIt(UBUNTU("24.04"), ...args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.out).toContain(says);
      expect(r.out).not.toContain("Looking at this machine");
    }
    // add() for real, with ship, the answer and systemctl standing in: both plans, one yes, then
    // the purge, then the box again with the slots it had.
    const add = /^add\(\) \{\n[\s\S]*?\n\}$/m.exec(text)?.[0] ?? "";
    const fresh = (slots: string, answer = "yes") =>
      spawnSync(
        "bash",
        [
          "-c",
          [
            "set -euo pipefail",
            'say() { echo "== $*"; }',
            'note() { echo "  $*"; }',
            'die() { echo "Stopped: $1"; exit 1; }',
            `ask() { printf '%s' "${answer}"; }`,
            /^yes_to\(\) \{\n[\s\S]*?\n\}$/m.exec(text)?.[0] ?? "",
            'ship() { echo "ship $*"; }',
            "systemctl() { printf '%s\\n' 'shipify-box-homepi.service enabled enabled' 'shipify-box-homepi-2.service enabled enabled' 'shipify-box-homepi-3.service enabled enabled' 'shipify-box-homepi-lab.service enabled enabled'; }",
            // No terminal here: ship's own stands in for it.
            add.replaceAll(" </dev/tty", ""),
            `FRESH=1 NAME=homepi SLOTS="${slots}" MANAGE=1 CONTAINER=0 REPLACE=0`,
            "add",
          ].join("\n"),
        ],
        { encoding: "utf8", env: { PATH: process.env.PATH } },
      ).stdout;
    const out = fresh("");
    const ships = out.split("\n").filter((l) => l.startsWith("ship "));
    expect(ships).toEqual([
      "ship box remove homepi --purge",
      "ship box add --name homepi --manage --slots 3",
      "ship box remove homepi --purge --yes",
      "ship box add --name homepi --manage --slots 3 --yes",
    ]);
    expect(out).toContain("Live: homepi takes the next task");
    // --slots given wins; a no changes nothing.
    expect(fresh("2")).toContain("ship box add --name homepi --slots 2 --manage --yes");
    const no = fresh("", "no");
    expect(no).toContain("Stopped: nothing changed: you said no.");
    expect(no).not.toContain("--purge --yes");
  });

  it("offers the private Shipify copy you manage, an organization's too, as the default", () => {
    expect(text).toContain(
      'select(.name == "shipify" and .private and .permissions.admin) | .full_name',
    );
    // Only one such copy is a default; else <you>/shipify.
    expect(text).toContain(
      '[ "$(printf \'%s\\n\' "$mine" | grep -c /)" = 1 ] || mine="$LOGIN/shipify"',
    );
  });
});
