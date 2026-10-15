// box/setup.sh, version 5 (ADR 0031, docs/box-setup.md): what can be checked without a box. The
// script runs only on a fresh Ubuntu LTS machine as root (pnpm ship box add), so these hold
// its order and its words: the sandbox's users, the sudo rule, the folders, and the proof at the end.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBoxOs, slotsFor } from "../cli/commands/box.ts";
import { ROOT, sandbox, ship } from "./helpers.ts";

describe("box/setup.sh: setup 5, checked without a box", () => {
  const file = join(ROOT, "box", "setup.sh");
  const setup = readFileSync(file, "utf8");
  /** The script without its comments: what it runs. */
  const code = setup
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const at = (s: string) => {
    const i = setup.indexOf(s);
    expect(i, s).toBeGreaterThan(0);
    return i;
  };

  it("is version 5, and bash reads it", () => {
    expect(setup).toMatch(/^SETUP_VERSION=5$/m);
    expect(spawnSync("bash", ["-n", file]).status).toBe(0);
  });

  it("passes shellcheck, where it's installed", () => {
    const sc = spawnSync("shellcheck", ["-S", "warning", file], { encoding: "utf8" });
    if (sc.error) return; // not on this machine; CI's runners have it
    expect(sc.stdout).toBe("");
  });

  it("uses a temporary folder of its own, never a fixed name in /tmp", () => {
    expect(code).toContain("WORK=$(mktemp -d)");
    expect(code).toContain(`trap 'rm -rf "$WORK"' EXIT`);
    expect(code).not.toMatch(/\/tmp\//);
  });

  it("makes the runner's home its own, and its tools readable by all from /opt/shipify", () => {
    expect(code).toContain("chmod 0700 /home/shipify");
    expect(code).toContain("TOOL_DIR=/opt/shipify/tool");
    expect(code).toContain('install -d -o shipify -g shipify -m 0755 "$TOOL_DIR"');
    expect(code).toContain('echo "RUNNER_TOOL_CACHE=$TOOL_DIR"');
    // No browser folder shared by the slots (ADR 0041): each slot's agent keeps its own in its
    // cache.
    expect(code).not.toContain("BROWSERS_DIR");
    // The services: refused without the umask that keeps the runner's files its own.
    expect(code).toContain("grep -qx 'UMask=0077' \"$UNIT_FILE\"");
  });

  it("gives each slot's agent a user of its own, outside the runner's group, with a folder only it and the runner enter", () => {
    expect(code).toContain(
      'useradd --system --user-group --no-create-home --home-dir "$AGENT_ROOT/$u" --shell /usr/sbin/nologin "$u"',
    );
    expect(code).toContain('gpasswd -d "$u" shipify');
    expect(code).toContain('install -d -o "$u" -g shipify -m 2710 "$AGENT_ROOT/$u"');
    expect(code).toContain("/etc/cron.deny /etc/at.deny");
    expect(code).toContain('agent_user() { echo "shipify-agent-$1"; }');
    expect(code).toContain("AGENT_ROOT=/srv");
  });

  it("installs the sudo rule only once visudo accepts it, and takes it out if sudo's whole configuration then fails", () => {
    expect(code).toContain('rule="shipify ALL=($agents) NOPASSWD: ALL"');
    expect(code).toContain("Defaults:shipify !use_pty");
    const check = at('visudo -cqf "$WORK/shipify-agents"');
    const install = at('install -m 0440 -o root -g root "$WORK/shipify-agents" "$SUDOERS"');
    const all = at("if ! visudo -cq >/dev/null 2>&1; then");
    const undo = at('  rm -f "$SUDOERS"');
    expect(install).toBeGreaterThan(check);
    expect(all).toBeGreaterThan(install);
    expect(undo).toBeGreaterThan(all);
    expect(code).toContain("SUDOERS=/etc/sudoers.d/shipify-agents");
  });

  it("proves the sandbox before it records setup 5", () => {
    const proof = at('say "Checking the sandbox"');
    const record = at('echo "$SETUP_VERSION" > /home/shipify/.shipify-setup');
    expect(record).toBeGreaterThan(proof);
    const check = setup.slice(proof, record);
    for (const wall of [
      'sudo -u shipify sudo -n -u "$u" true',
      'wall "$u" /home/shipify',
      'wall "$u" "$RUNNER_HOME/_work"',
      'wall "$u" "/proc/$listener/environ"',
      'wall "$u" "$AGENT_ROOT/$(agent_user "$j")"',
      // The agent's memory, where its login is: a command reads only its own children's.
      '"$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo 0)" -lt 1',
      "exit 1",
    ])
      expect(check, wall).toContain(wall);
  });

  it("on WSL, gives no sandbox while an agent can reach Windows, and names the fix in wsl.conf", () => {
    const proof = at('say "Checking the sandbox"');
    const check = setup.slice(proof, at('echo "$SETUP_VERSION" > /home/shipify/.shipify-setup'));
    for (const wall of [
      "grep -qi microsoft /proc/version",
      '"$(head -n 1 "$f" 2>/dev/null)" = enabled',
      String.raw`awk '$1 ~ /^[A-Za-z]:(\\134)?$/ {print $2}' /proc/mounts`,
      `sudo -u "$u" sh -c 'cd -- "$1" || ls -A -- "$1"' wall "$d"`,
    ])
      expect(check, wall).toContain(wall);
    // The fix, then the stop: the label never comes, and nothing of WSL's is changed here.
    const fix = at("[interop]\\n    enabled=false\\n    appendWindowsPath=false");
    expect(setup).toContain('options="metadata,umask=077"');
    expect(setup).toContain("wsl --shutdown");
    expect(at("The sandbox isn't right (above)")).toBeGreaterThan(fix);
    expect(code).not.toMatch(/>\s*\/etc\/wsl\.conf/);
  });

  it("unpacks the runner from root's own folder, and keeps the registration token off command lines", () => {
    expect(code).toContain('sudo -u shipify tar -xzf - -C "$home" < "$TARBALL"');
    expect(code).toContain("--preserve-env=ACTIONS_RUNNER_INPUT_TOKEN");
    expect(code).not.toMatch(/--token\b/);
  });
});

describe("ship box add: setup 5 over SSH, or on this PC (a fake ssh, bash, sudo and gh)", () => {
  // What the machine says: its arch, os-release's ID and VERSION_ID, hostname, MemTotal in KiB.
  const pi = "aarch64\\nubuntu 24.04\\nhomepi\\n7969000\\n";
  const machine = (setupExit: number, probe = pi, systemd = true, repo = "true") => {
    const sb = sandbox();
    const bin = join(sb.dir, "bin");
    const got = join(sb.dir, "got");
    mkdirSync(bin);
    mkdirSync(got);
    const log = join(sb.dir, "calls.log");
    const runners = join(sb.dir, "runners.json");
    const labels = (...l: string[]) => l.map((name) => ({ name }));
    writeFileSync(
      runners,
      JSON.stringify({
        runners: [
          // Slot 1 has no sandbox label yet. Slot 2 already has it.
          {
            id: 1,
            name: "homepi",
            os: "Linux",
            status: "online",
            busy: false,
            labels: labels("shipify-box", "box-homepi"),
          },
          {
            id: 2,
            name: "homepi-2",
            os: "Linux",
            status: "online",
            busy: false,
            labels: labels("shipify-box", "box-homepi", "sandbox"),
          },
        ],
      }),
    );
    const script = (body: string) => `#!/bin/sh\n${body}\n`;
    writeFileSync(
      join(bin, "ssh"),
      script(`echo "ssh $*" >> "${log}"
case "$*" in
  *"uname -m"*) printf '${probe}' ;;
  *"systemctl cat"*) echo same ;;
  *"mktemp -d"*) echo /tmp/tmp.Ab12 ;;
  *"cat > "*) f=\${*##* }; cat > "${got}/\${f##*/}" ;;
  *"sudo bash"*) exit ${setupExit} ;;
esac`),
      { mode: 0o755 },
    );
    // This PC: the same commands through bash (as you) and sudo (as root).
    writeFileSync(
      join(bin, "bash"),
      script(`echo "bash $*" >> "${log}"
case "$*" in
  *"test -d /run/systemd/system"*) ${systemd ? "exit 0" : "exit 1"} ;;
  *"uname -m"*) printf '${probe}' ;;
  *"systemctl cat"*) echo same ;;
  *"mktemp -d"*) echo /tmp/tmp.Ab12 ;;
  *"cat > "*) f=\${*##* }; cat > "${got}/\${f##*/}" ;;
esac`),
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, "sudo"),
      script(`echo "sudo $*" >> "${log}"
exit ${setupExit}`),
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, "gh"),
      script(`echo "gh $*" >> "${log}"
case "$*" in
  *"/labels"*) echo '{}' ;;
  *registration-token*) echo '{"token":"reg-token-never-shown"}' ;;
  *"actions/runners?"*) cat "${runners}" ;;
  *permissions.admin*) echo "${repo}" ;;
  *actions/variables*) printf 'SHIPIFY_OWNER\\tmock-user\\n' ;;
esac`),
      { mode: 0o755 },
    );
    sb.env = { ...sb.env, PATH: `${bin}:${process.env.PATH}` };
    return { sb, log: () => (existsSync(log) ? readFileSync(log, "utf8") : ""), got };
  };

  it("never makes a box for a public repo: it stops before anything reaches the machine", () => {
    const { sb, log } = machine(0, pi, true, "true false");
    const r = ship(sb, "box", "add", "homepi", "--yes");
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("is public: a box serves only a private copy");
    expect(log()).not.toContain("registration-token");
    expect(log()).not.toContain("setup.sh");
  });

  it("runs the setup from a folder mktemp made, with the tokens on stdin, then labels the slots sandbox", () => {
    const { sb, log, got } = machine(0);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    expect(r.summary).toContain("2 with the sandbox label");
    const calls = log();
    expect(calls).toContain("mktemp -d");
    // The script goes in on stdin, as every file does: nothing but ssh reaches the machine.
    expect(calls).toContain("umask 077 && cat > /tmp/tmp.Ab12/setup.sh");
    expect(readFileSync(join(got, "setup.sh"), "utf8")).toContain("SETUP_VERSION=5");
    expect(calls).toContain(
      "sudo bash /tmp/tmp.Ab12/setup.sh /tmp/tmp.Ab12/box.env /tmp/tmp.Ab12/prep.tsv /tmp/tmp.Ab12/box.service",
    );
    expect(calls).toContain("rm -rf /tmp/tmp.Ab12");
    expect(calls).not.toContain("/tmp/shipify-box");
    // The registration tokens went to the file on stdin, never on a command line.
    expect(calls).not.toContain("reg-token-never-shown");
    expect(readFileSync(join(got, "box.env"), "utf8")).toContain("reg-token-never-shown");
    // The runners' service: their own files, unreadable to the agents.
    expect(readFileSync(join(got, "box.service"), "utf8")).toMatch(/^UMask=0077$/m);
    // Over SSH, the machine's SSH is hardened (setup.sh's own check); only this PC's stays.
    expect(readFileSync(join(got, "box.env"), "utf8")).not.toContain("SHIPIFY_HERE");
    // The label, once the setup's check passed, on the slot that lacked it.
    expect(calls).toMatch(
      /gh api -X POST repos\/[^/]+\/[^/]+\/actions\/runners\/1\/labels -f labels\[\]=sandbox/,
    );
    expect(calls).not.toMatch(/runners\/2\/labels/);
  });

  it("labels nothing when the setup (and so its sandbox check) fails, and tidies up all the same", () => {
    const { sb, log } = machine(1);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2", "--yes");
    expect(r.status).toBe("failed");
    expect(r.summary).toContain("no sandbox label");
    expect(log()).not.toContain("/labels");
    expect(log()).toContain("rm -rf /tmp/tmp.Ab12");
  });

  it("shows the sandbox in its plan before anything happens", () => {
    const { sb, log } = machine(0);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2");
    expect(r.status).toBe("requires-approval");
    const plan = (r.plannedActions ?? []).join("\n");
    expect(plan).toContain("shipify-agent-1, shipify-agent-2");
    expect(plan).toContain("/etc/sudoers.d/shipify-agents");
    expect(plan).toContain('the label "sandbox"');
    expect(log()).not.toContain("sudo bash");
  });

  it("gives a new box the slots its memory fits, and a box that has slots keeps them", () => {
    const fresh = (probe: string) => {
      const { sb } = machine(0, probe);
      return (ship(sb, "box", "add", "newpi", "--name", "newpi").plannedActions ?? []).join("\n");
    };
    expect(fresh(pi)).toContain("runs 3 slot(s) (what its 7.6 GB of memory fits)");
    expect(fresh("x86_64\\nubuntu 24.04\\nvps\\n3900000\\n")).toContain("runs 1 slot(s) (what its");
    const { sb } = machine(0);
    const kept = (ship(sb, "box", "add", "homepi").plannedActions ?? []).join("\n");
    expect(kept).toContain("runs 2 slot(s), one task");
  });

  it("refuses an OS other than Ubuntu LTS before anything happens", () => {
    const { sb, log } = machine(0, "aarch64\\ndebian 12\\nraspberrypi\\n7969000\\n");
    const r = ship(sb, "box", "add", "raspberrypi", "--yes");
    expect(r.status).not.toBe("succeeded");
    expect(r.summary).toContain("runs debian 12; a box runs Ubuntu Server 24.04 LTS");
    expect(log()).not.toContain("registration-token");
    expect(log()).not.toContain("cat > ");
  });

  it("on this PC: the same setup through bash and sudo, never ssh, its SSH left as it is (ADR 0047)", () => {
    const { sb, log, got } = machine(0);
    const plan = ship(sb, "box", "add", "--slots", "2");
    expect(plan.status).toBe("requires-approval");
    expect(plan.summary).toBe('would set up this PC as the box "homepi"');
    const said = (plan.plannedActions ?? []).join("\n");
    expect(said).toContain("run box/setup.sh on this PC");
    expect(said).toContain("this PC's SSH settings and network stay as they are");
    expect(said).toContain('the label "sandbox"');
    expect(plan.nextSteps).toEqual(["pnpm ship box add --slots 2 --yes"]);
    const r = ship(sb, "box", "add", "--slots", "2", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    expect(r.summary).toContain('this PC is the box "homepi"');
    const calls = log();
    expect(calls).not.toMatch(/^ssh /m);
    expect(calls).toContain(
      "sudo bash /tmp/tmp.Ab12/setup.sh /tmp/tmp.Ab12/box.env /tmp/tmp.Ab12/prep.tsv /tmp/tmp.Ab12/box.service",
    );
    expect(calls).toContain("rm -rf /tmp/tmp.Ab12");
    expect(calls).not.toContain("reg-token-never-shown");
    expect(readFileSync(join(got, "box.env"), "utf8")).toContain("SHIPIFY_HERE=1");
  });

  it("on this PC: needs systemd on, and takes no --manage, before anything happens", () => {
    const off = machine(0, pi, false);
    expect(ship(off.sb, "box", "add", "--yes").summary).toContain("systemd isn't running");
    expect(off.log()).not.toContain("registration-token");
    const { sb, log } = machine(0);
    expect(ship(sb, "box", "add", "--manage", "--yes").summary).toContain(
      "--manage is for a machine you reach over SSH",
    );
    expect(log()).toBe("");
  });
});

describe("a box's OS and slots", () => {
  it("takes Ubuntu LTS from 24.04 on, and nothing else", () => {
    for (const os of ["ubuntu 24.04", "ubuntu 26.04"]) expect(isBoxOs(os), os).toBe(true);
    const others = ["ubuntu 22.04", "ubuntu 24.10", "ubuntu 25.04", "debian 12", "raspbian 12", ""];
    for (const os of others) expect(isBoxOs(os), os).toBe(false);
  });

  it("keeps 1 GB for the system and fits a slot per 2 GB, 1 to 4", () => {
    const gib = (n: number) => n * 1024 * 1024;
    expect(slotsFor(gib(0.9))).toBe(1);
    expect(slotsFor(gib(1.9))).toBe(1);
    expect(slotsFor(gib(3.8))).toBe(1);
    expect(slotsFor(gib(5.8))).toBe(2);
    expect(slotsFor(gib(7.6))).toBe(3);
    expect(slotsFor(gib(11.6))).toBe(4);
    expect(slotsFor(gib(15.6))).toBe(4);
    expect(slotsFor(gib(62))).toBe(4);
  });
});
