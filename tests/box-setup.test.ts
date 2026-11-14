// box/setup.sh, version 5 (ADR 0031, docs/box-setup.md): what can be checked without a box. The
// script runs only on a fresh Ubuntu LTS machine as root (pnpm ship box add), so these hold
// its order and its words: the sandbox's users, the sudo rule, the folders, and the proof at the end.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("is version 16, and bash reads it", () => {
    expect(setup).toMatch(/^SETUP_VERSION=16$/m);
    expect(spawnSync("bash", ["-n", file]).status).toBe(0);
  });

  /** A function of setup.sh's, as its text: from `name() {` to its closing brace. */
  const fn = (name: string) => {
    const m = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, "m").exec(setup);
    expect(m, name).not.toBeNull();
    return m?.[0] ?? "";
  };
  /** A bash script run under setup.sh's own `set -euo pipefail`. */
  const bash = (lines: string[], env: Record<string, string> = {}) =>
    spawnSync("bash", ["-c", ["set -euo pipefail", ...lines].join("\n")], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });

  it("waits out Ubuntu's own updates after a first boot, in what it runs too, and finishes a cut-off install first (setup 9)", () => {
    // Every apt, its own and its children's (a stack's fix, the runner's dependencies, Tailscale's
    // installer), waits for the lock: through apt's own setting, never a flag on one command.
    expect(code).toContain(`printf 'DPkg::Lock::Timeout "1200";\\n' > "$WORK/apt.conf"`);
    expect(code).toContain('export APT_CONFIG="$WORK/apt.conf"');
    // apt's lists only through apt_update (below).
    expect(code.match(/apt_get update/g)).toHaveLength(1);
    expect(fn("apt_update")).toContain("apt_get update -q && return 0");
    // Every download is tried again and stops when it stalls, the same way.
    expect(code).toContain('export CURL_HOME="$WORK"');
    expect(code).toMatch(/"retry = 3" [^\n]*"speed-time = 60" > "\$WORK\/\.curlrc"/);
    // A run cut off mid-install: dpkg finished before the first apt.
    expect(at("dpkg --configure -a")).toBeLessThan(at("apt_update\napt_get install -y -q git"));
    // apt's lists, tried again while another apt holds their lock (apt-get update doesn't wait).
    const tries = (fails: number) =>
      bash([
        "n=0",
        `apt_get() { n=$((n + 1)); [ "$n" -gt ${fails} ]; }`,
        "sleep() { :; }",
        fn("apt_update"),
        'if apt_update; then echo "updated after $n"; else echo "gave up after $n"; fi',
      ]);
    const twice = tries(2);
    expect(twice.stdout).toContain("updated after 3");
    expect(twice.stdout.match(/again in 30 seconds/g)).toHaveLength(2);
    expect(tries(99).stdout).toContain("gave up after 20");
  });

  it("never stops at the updates' progress line, which a fresh install's log doesn't have yet (setup 9)", () => {
    const dir = sandbox().dir;
    const log = join(dir, "dpkg.log");
    const now = () =>
      bash([
        fn("updating_now"),
        `now=$(updating_now "${log}")`,
        'echo "went on: ${now:-starting}"',
      ]);
    // No log, then one with no such line: before setup 9 either stopped the whole setup, silently.
    expect(now().stdout).toBe("went on: starting\n");
    writeFileSync(log, "2026-10-24 12:00:00 startup archives unpack\n");
    expect(now().stdout).toBe("went on: starting\n");
    writeFileSync(log, "Unpacking linux-image-6.8.0-87-generic (6.8.0-87.88) ...\nnot this\n");
    expect(now().stdout).toBe(
      "went on: Unpacking linux-image-6.8.0-87-generic (6.8.0-87.88) ...\n",
    );
  });

  it("installs the updates waiting now once the slots are registered, and --manage only once the sandbox checks out (setup 9)", () => {
    const services = at('say "The slots as services');
    const updates = at('say "The updates waiting now"');
    const proof = at('say "Checking the sandbox"');
    const recorded = at('record "$SETUP_VERSION" "manage: not finished"');
    const managed = at("  (manage)\n");
    // The registration tokens last an hour: a long first update comes after they're used.
    expect(at('say "The GitHub runners')).toBeLessThan(updates);
    expect(services).toBeLessThan(updates);
    expect(updates).toBeLessThan(proof);
    // Tailscale's sign-in waits for you, 15 minutes at most: after the check and the record.
    expect(recorded).toBeLessThan(managed);
    expect(code).toContain("tailscale up --ssh --timeout 15m");
    // The settings stay where they were: written early, every day's rules.
    expect(at("cat > /etc/apt/apt.conf.d/52shipify-updates")).toBeLessThan(services);
    expect(setup).toContain('"origin=Ubuntu,archive=${distro_codename}-backports"');
  });

  it("registers again a slot GitHub deleted, and restarts it (setup 9)", () => {
    const registered = (env: Record<string, string>, k: number) =>
      bash([fn("registered"), `registered ${k} && echo yes || echo no`], env).stdout.trim();
    // box add lists the slots GitHub has: one it deleted (box remove, or 14 days off) isn't there.
    expect(registered({ RUNNER_REGISTERED: "1 3" }, 1)).toBe("yes");
    expect(registered({ RUNNER_REGISTERED: "1 3" }, 2)).toBe("no");
    expect(registered({ RUNNER_REGISTERED: "1 3" }, 3)).toBe("yes");
    expect(registered({ RUNNER_REGISTERED: "" }, 1)).toBe("no");
    expect(registered({ RUNNER_REGISTERED: "12" }, 1)).toBe("no");
    // An older box add says nothing: a registration here counts, as before.
    expect(registered({}, 2)).toBe("yes");
    // Its registration here goes, so config.sh registers it again, and its service restarts.
    const loop = setup.slice(at('say "The GitHub runners'), at("unset RUNNER_TOKENS TOKENS"));
    expect(loop).toContain('if [ -f "$home/.runner" ] && ! registered "$k"; then');
    expect(loop).toContain(
      'rm -f "$home/.runner" "$home/.credentials" "$home/.credentials_rsaparams"',
    );
    expect(loop).toContain('RESTART="$RESTART$home "');
    expect(code).toContain('case "$RESTART" in *" $home "*) restart=1 ;; esac');
  });

  it("drops Ubuntu installer's swap file for swap in memory, only on a box you keep (setup 9)", () => {
    const zram = setup.slice(at('say "Swap in memory (zram)"'), at('say "What the stacks need"'));
    // The installer's file alone, never another swap; never this PC without --manage.
    expect(zram).toContain(
      'if [ "$other" = /swap.img ] && ! { [ "${SHIPIFY_HERE:-}" = 1 ] && [ "${SHIPIFY_MANAGE:-}" != 1 ]; } &&',
    );
    // Off first: only then its line in fstab and the file go.
    expect(zram.indexOf("swapoff /swap.img")).toBeLessThan(zram.indexOf("sed -i"));
    expect(zram).toContain("sed -i '\\|^/swap\\.img[[:space:]]|d' /etc/fstab");
    expect(zram.indexOf("rm -f /swap.img")).toBeGreaterThan(zram.indexOf("sed -i"));
  });

  /** agents_net, whole: its here-document has a closing brace of its own. */
  const agentsNet = () => setup.slice(at("agents_net() {"), at("\nNFT\n}\n") + "\nNFT\n}".length);

  it("walls the agents and their containers off every private network, and proves it (setup 9)", () => {
    // The table: each agent and its range, out to the internet and DNS, never a private address.
    const table = bash([agentsNet(), "agents_net '998, 100000-165535'"]).stdout;
    // Only their own sockets' packets go to their chain (setup 11): the machine's own have no
    // user, and a rule naming users never matches them (a ping's reply, IPv6's neighbours).
    expect(table).toMatch(
      /policy accept;\n\s*meta skuid \{ 998, 100000-165535 \} jump agents\n\s*\}\n\s*chain agents \{\n/,
    );
    expect(table).toContain("meta l4proto { tcp, udp } th dport 53 accept");
    for (const net of [
      "10.0.0.0/8",
      "100.64.0.0/10",
      "169.254.0.0/16",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ])
      expect(table, net).toContain(net);
    // No IPv6 address but ::1 (setup 11): a home network's are public.
    expect(table).toContain("ip6 daddr != ::1 goto refuse");
    // Refused at once: TCP with a reset (a program goes on to IPv4 with no wait), the rest with an
    // ICMP error.
    expect(table).toMatch(
      /chain refuse \{\n\s*meta l4proto tcp reject with tcp reset\n\s*reject with icmpx admin-prohibited\n\s*\}/,
    );
    // Made again whole each time, in one go; nothing else's rules flushed.
    expect(table).toMatch(
      /^table inet shipify_agents\ndelete table inet shipify_agents\ntable inet shipify_agents \{$/m,
    );
    expect(code).not.toMatch(/flush ruleset|ufw reset/);
    // The IDs: each agent's own and its range's, from /etc/subuid.
    expect(fn("agent_ids")).toContain("/etc/subuid");
    // Loaded at every start, before the network, by a unit of its own; never in a container.
    expect(code).toContain('"Before=network-pre.target shutdown.target"');
    expect(code).toContain('"WantedBy=sysinit.target"');
    expect(code).toContain('systemctl enable -q "$AGENTS_NET_UNIT"');
    expect(setup).toContain("skipped: a box in Docker reaches what its host lets it");
    // The proof, before the label: the table there, and no agent reaches this machine's own
    // private address, which root does.
    const check = setup.slice(at('say "Checking the sandbox"'), at("# --manage last"));
    expect(check).toContain("nft list table inet shipify_agents");
    expect(check).toContain('if reaches "$u" "$ip" "$port"; then');
    expect(check).toContain('if [ -n "$port" ] && reaches "" "$ip" "$port"; then');
    expect(at("say \"The agents' network")).toBeLessThan(at('say "Checking the sandbox"'));
    expect(at("say \"The agents' network")).toBeGreaterThan(at("(lab)"));
  });

  it("closes this machine's SSH and Cockpit to the agents, never what their containers publish (setup 10)", () => {
    const table = bash([agentsNet(), "agents_net '998'"]).stdout;
    expect(table).toContain("ip daddr 127.0.0.0/8 tcp dport { 22, 9090 } goto refuse");
    expect(table).toContain("ip6 daddr ::1 tcp dport { 22, 9090 } goto refuse");
    // Only those ports: a container's published port on 127.0.0.1 stays reachable.
    expect(table).not.toMatch(/daddr (127\.0\.0\.0\/8|::1) (reject|drop|goto)/);
    // Proved where SSH listens: root reaches it, no agent does.
    const check = setup.slice(at('say "Checking the sandbox"'), at("# --manage last"));
    expect(check).toContain('reaches "" 127.0.0.1 22');
    expect(check).toContain('if reaches "$u" 127.0.0.1 22; then');
  });

  // GitHub's machines have nftables and sudo with no password: nft reads the table there.
  const nft = spawnSync("sudo", ["-n", "nft", "--version"]).status === 0;
  it.runIf(nft)("writes a table nft takes", () => {
    const table = bash([agentsNet(), "agents_net '998, 100000-165535'"]).stdout;
    const f = join(sandbox().dir, "agents.nft");
    writeFileSync(f, table);
    const r = spawnSync("sudo", ["-n", "nft", "-c", "-f", f], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("keeps Cockpit on the machine from its first start, restarts it only when it changed, and leaves NetworkManager out (setup 9)", () => {
    const manage = setup.slice(at("manage() {"), at("firewall() {"));
    // Where it listens is in place before its install starts it.
    expect(manage.indexOf("cockpit.socket.d/listen.conf")).toBeLessThan(
      manage.indexOf("apt_get install"),
    );
    // From backports only where the box's sources have them (setup 10): never apt's "the value
    // is invalid" error, and one install.
    expect(manage).toContain(
      '[ -z "$(ubuntu_suite "${VERSION_CODENAME}-backports")" ] || from=(-t "${VERSION_CODENAME}-backports")',
    );
    expect(manage).toContain(
      'apt_get install -y -q --no-install-recommends "${from[@]}" cockpit cockpit-packagekit',
    );
    expect(manage.match(/apt_get install/g)).toHaveLength(1);
    expect(manage).toContain('if [ -n "$cockpit" ]; then');
    // put_file: in place only when it differs, and says so.
    const dir = sandbox().dir;
    const put = (body: string) =>
      bash([
        fn("put_file"),
        `printf '${body}' > "${dir}/new"`,
        `put_file "${dir}/new" "${dir}/etc/x.conf" && echo changed || echo same`,
      ]).stdout.trim();
    expect(put("a")).toBe("changed");
    expect(readFileSync(join(dir, "etc", "x.conf"), "utf8")).toBe("a");
    expect(put("a")).toBe("same");
    expect(put("b")).toBe("changed");
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
    expect(code).toMatch(
      /useradd --system --user-group --no-create-home [^\n]*--home-dir "\$AGENT_ROOT\/\$u" --shell \/usr\/sbin\/nologin "\$u"/,
    );
    expect(code).toContain('gpasswd -d "$u" shipify');
    // 2711 (setup 11): with 2710, Podman added the x bits as the agent, and Linux dropped the setgid.
    expect(code).toContain('install -d -o "$u" -g shipify -m 2711 "$AGENT_ROOT/$u"');
    expect(code).toContain("/etc/cron.deny /etc/at.deny");
    expect(code).toContain('agent_user() { echo "shipify-agent-$1"; }');
    expect(code).toContain("AGENT_ROOT=/srv");
    // Its kept folders, each time, once its folder is right.
    expect(at('agent_dirs "$u" "$AGENT_ROOT/$u"')).toBeGreaterThan(
      at('chmod 2711 "$AGENT_ROOT/$u"'),
    );
  });

  it("gives the look server a user of its own (setup 16, ADR 0077): no home, shell or range, outside the runner's group, in the agents' network rules", () => {
    expect(code).toContain("LOOK_USER=shipify-look");
    expect(code).toContain(
      'useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$LOOK_USER"',
    );
    expect(code).not.toMatch(/--add-subids-for-system[^\n]*LOOK_USER/);
    expect(code).toContain('gpasswd -d "$LOOK_USER" shipify');
    expect(code).toContain('grep -qx "$LOOK_USER" "$deny"');
    // Made before the sudo rule names it, and before the network rules take its ID.
    expect(at("LOOK_USER=shipify-look")).toBeLessThan(at('say "The sudo rules'));
    expect(at("LOOK_USER=shipify-look")).toBeLessThan(at('agents_net "$(agent_ids)"'));
    expect(fn("agent_ids")).toContain('echo "$ids, $(id -u "$LOOK_USER")"');
  });

  it("makes each slot's kept folders its agent's own, with no setgid, and mends what setup 8 and 9 left (setup 10)", () => {
    // Made in the slot folder (setgid, group shipify), they took that group, which has no ID in the
    // agent's user namespace: Podman's store couldn't mount. A real run of agent_dirs, as this
    // user, with a group of its own standing in for shipify.
    const id = (flag: string) =>
      spawnSync("id", [flag], { encoding: "utf8" }).stdout.trim().split(/\s+/);
    const [user] = id("-un");
    const [own] = id("-gn");
    const body = fn("agent_dirs");
    expect(body).toContain("-group shipify -type d -exec chmod g-s {} +");
    expect(body).toContain('-group shipify -exec chgrp -h "$u" {} +');
    expect(body).toContain('chmod 00700 "$d"');
    // A user whose own group has its name (as each agent's), and another group: one a folder here
    // takes already (in a box's run), or a second group of the user's (GitHub's machines).
    const base = sandbox().dir;
    mkdirSync(join(base, "probe"));
    const inherited = spawnSync("stat", ["-c", "%G", join(base, "probe")], {
      encoding: "utf8",
    }).stdout.trim();
    const other = inherited !== own ? inherited : id("-Gn").find((g) => g !== own);
    if (!user || !other || own !== user) return;
    const slot = join(base, "shipify-agent-1");
    const mode = (p: string) =>
      spawnSync("stat", ["-c", "%a %G", p], { encoding: "utf8" }).stdout.trim();
    const r = bash([
      // The slot folder, setgid with that group (a folder made here takes both already).
      `mkdir "${slot}"`,
      inherited === other ? "" : `chgrp ${other} "${slot}" && chmod g+s "${slot}"`,
      // What setup 9 left: data/ and its store with the slot folder's group, and setgid.
      `mkdir -m 700 "${slot}/data" && mkdir -p "${slot}/data/containers/storage" && touch "${slot}/data/containers/storage/x"`,
      `ln -s nowhere "${slot}/data/link"`,
      `[ "$(stat -c %G "${slot}/data/containers/storage")" = ${other} ] || { echo "no setgid group to mend" >&2; exit 1; }`,
      fn("agent_dirs").replaceAll("shipify", other),
      `agent_dirs ${user} "${slot}"`,
      `agent_dirs ${user} "${slot}"`,
    ]);
    expect(r.status, r.stderr).toBe(0);
    for (const d of ["cache", "data"]) expect(mode(join(slot, d)), d).toBe(`700 ${user}`);
    expect(mode(join(slot, "data", "containers", "storage"))).toMatch(
      new RegExp(`^7\\d\\d ${user}$`),
    );
    expect(mode(join(slot, "data", "containers", "storage", "x"))).toMatch(new RegExp(` ${user}$`));
    // The slot folder itself keeps its group and setgid: out/ needs them.
    expect(mode(slot)).toMatch(new RegExp(`^2\\d{3} ${other}$`));
  });

  it("installs the sudo rules only once visudo accepts them, and takes them out if sudo's whole configuration then fails", () => {
    expect(code).toContain('rule="shipify ALL=($agents,$LOOK_USER) NOPASSWD: ALL"');
    expect(code).toContain("Defaults:shipify !use_pty");
    // As root, only the box's own update (setup 14), and not in a container (a new image is its
    // update): the same file, the same checks.
    expect(code).toContain('update_rule="shipify ALL=(root) NOPASSWD: $UPDATER"');
    expect(code).toContain("rules=$rule${update_rule:+$'\\n'$update_rule}");
    expect(code).toContain(`printf '%s\\nDefaults:shipify !use_pty\\n%s\\n' "$head" "$rules"`);
    expect(code).not.toMatch(/ALL=\(root\) NOPASSWD: ALL/);
    const check = at('visudo -cqf "$WORK/shipify-agents"');
    const install = at('install -m 0440 -o root -g root "$WORK/shipify-agents" "$SUDOERS"');
    const all = at("if ! visudo -cq >/dev/null 2>&1; then");
    const undo = at('  rm -f "$SUDOERS"');
    expect(install).toBeGreaterThan(check);
    expect(all).toBeGreaterThan(install);
    expect(undo).toBeGreaterThan(all);
    expect(code).toContain("SUDOERS=/etc/sudoers.d/shipify-agents");
  });

  it("turns on swap in memory (zram) only where there's no swap, and never fails the setup over it (ADR 0061)", () => {
    const zram = setup.slice(at('say "Swap in memory (zram)"'), at('say "What the stacks need"'));
    // Its own swap kept (WSL's, a VPS's file), no systemd, no zram in the kernel, no package: a line each.
    expect(zram).toContain(
      "swapon --show=NAME --noheadings 2>/dev/null | grep -v '^/dev/zram' || true",
    );
    expect(zram).toContain("skipped: this box has swap of its own");
    expect(zram).toContain("skipped: systemd isn't running here");
    expect(zram).toContain("skipped: this kernel has no zram");
    expect(zram).toContain("skipped: systemd-zram-generator didn't install");
    // Half the memory, at most 8 GB, compressed; settings for swap that's fast.
    expect(zram).toContain('"zram-size = min(ram / 2, 8192)" "compression-algorithm = zstd"');
    expect(zram).toContain('"vm.swappiness = 180" "vm.page-cluster = 0"');
    // Run again, it changes nothing: the file replaced (and zram restarted) only when it differs.
    expect(zram).toContain('if ! cmp -s "$WORK/zram.conf" "$ZRAM_CONF"; then');
    // Never in an image or a container, and never a swap file on the disk.
    expect(setup).toContain('if [ -z "$IMAGE$CONTAINER" ]; then\nsay "Swap in memory (zram)"');
    expect(code).not.toMatch(/mkswap|fallocate|swapfile/);
  });

  it("installs shellcheck, fd and sqlite3 in a step of their own, with fd under its own name for every user", () => {
    const step = setup.slice(at('say "shellcheck, fd and sqlite3"'), at('say "Node 22'));
    // After the system packages and gh, where an image installs too; never in the main apt line,
    // so a machine without Ubuntu's universe still gets the rest.
    expect(at('if [ -z "$CONTAINER" ]; then\nsay "System packages"')).toBeLessThan(
      at('say "shellcheck, fd and sqlite3"'),
    );
    expect(at("  apt_get install -y -q gh\n")).toBeLessThan(at('say "shellcheck, fd and sqlite3"'));
    expect(code).toMatch(/apt_get install -y -q git make [^\n]* procps\n/);
    expect(code.match(/fd-find sqlite3/g)).toHaveLength(1);
    expect(step).toContain("if apt_get install -y -q fd-find sqlite3; then");
    // The link only to an fdfind that's there, and never over an fd the machine has.
    expect(step).toContain(
      "if [ -x /usr/bin/fdfind ] && ! command -v fd >/dev/null; then ln -sf /usr/bin/fdfind /usr/local/bin/fd; fi",
    );
  });

  it("installs the shellcheck CI checks with, from its release and its checksum, not Ubuntu's (setup 15)", () => {
    const step = setup.slice(at('say "shellcheck, fd and sqlite3"'), at('say "Node 22'));
    // Ubuntu 24.04's is 0.9.0; GitHub's machines (Ubuntu 26.04) check with 0.11.0.
    expect(code).not.toMatch(/apt_get install[^\n]*shellcheck/);
    expect(step).toContain("SHELLCHECK=0.11.0\n");
    expect(step).toContain('file="shellcheck-v$SHELLCHECK.linux.$(uname -m).tar.xz"');
    expect(step).toContain(
      "x64) sum=8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198 ;;",
    );
    expect(step).toContain(
      "arm64) sum=12b331c1d2db6b9eb13cfca64306b1b157a86eb69db83023e261eaa7e7c14588 ;;",
    );
    expect(step).toContain(
      '"https://github.com/koalaman/shellcheck/releases/download/v$SHELLCHECK/$file"',
    );
    // Checked before it's installed, in /usr/local/bin: ahead of Ubuntu's in every user's PATH.
    expect(step.indexOf("sha256sum -c --quiet -")).toBeLessThan(step.indexOf("install -m 0755"));
    expect(step).toContain(
      'install -m 0755 "$WORK/shellcheck-v$SHELLCHECK/shellcheck" /usr/local/bin/shellcheck\n}; then',
    );
  });

  it("goes on when fd, sqlite3 or shellcheck don't install, with a line each; installs no download that isn't the release", () => {
    const dir = mkdtempSync(join(tmpdir(), "tools-"));
    // Its shellcheck in the test's folder, not /usr/local/bin.
    const step = setup
      .slice(at('say "shellcheck, fd and sqlite3"'), at('say "Node 22'))
      .replaceAll("/usr/local/bin/shellcheck", join(dir, "shellcheck"));
    // Not the release: a file of the same name, whose checksum isn't the one setup holds.
    mkdirSync(join(dir, "src", "shellcheck-v0.11.0"), { recursive: true });
    writeFileSync(join(dir, "src", "shellcheck-v0.11.0", "shellcheck"), "#!/bin/sh\n");
    const tar = ["-cJf", join(dir, "fake.tar.xz"), "-C", join(dir, "src"), "shellcheck-v0.11.0"];
    expect(spawnSync("tar", tar).status).toBe(0);
    const run = (curl: string) =>
      bash([
        `say() { printf '\\n== %s\\n' "$*"; }`,
        'apt_get() { echo "E: Unable to locate package fd-find" >&2; return 100; }',
        `curl() { echo curl >> "$WORK/calls"; ${curl}; }`,
        `WORK='${dir}' ARCH=arm64`,
        step,
        'echo "went on"',
      ]);
    for (const curl of [
      'echo "curl: (6) Could not resolve host: github.com" >&2; return 6',
      `cp '${join(dir, "fake.tar.xz")}' "$3"`,
    ]) {
      const r = run(curl);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(
        "  skipped: fd and sqlite3 didn't install (fd needs Ubuntu's universe: sudo add-apt-repository universe, then box add again)\n",
      );
      expect(r.stdout).toContain(
        "  skipped: shellcheck 0.11.0 didn't install (above); the setup's next run tries again\n",
      );
      expect(r.stdout).toContain("went on");
      expect(r.stdout).not.toContain("done");
      expect(existsSync(join(dir, "shellcheck"))).toBe(false);
    }
    // There already: nothing downloaded.
    writeFileSync(
      join(dir, "shellcheck"),
      "#!/bin/sh\nprintf 'ShellCheck\\nversion: 0.11.0\\n'\n",
      {
        mode: 0o755,
      },
    );
    rmSync(join(dir, "calls"));
    const again = run("return 6");
    expect(again.stdout).toContain("  shellcheck 0.11.0: done\n");
    expect(existsSync(join(dir, "calls"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps every box awake and its slots running through updates, the same on any machine (setup 7)", () => {
    const part = setup.slice(
      at('say "Updates leave the slots running"'),
      at('say "Swap in memory (zram)"'),
    );
    // Inside the part an image or a container skips: its host decides both.
    expect(at('if [ -z "$IMAGE$CONTAINER" ]; then\nsay "Automatic security updates"')).toBeLessThan(
      at('say "Updates leave the slots running"'),
    );
    expect(part).toContain("'$nrconf{override_rc}{qr(^shipify-box-)} = 0;'");
    expect(part).toContain("/etc/needrestart/conf.d/50-shipify-box.conf");
    // No check for a laptop: the lid lines change nothing on a Pi or a VPS.
    const runs = part
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(runs).not.toMatch(/laptop|chassis|battery|\/sys\/class\/power_supply/i);
    for (const line of [
      "HandleLidSwitch=ignore",
      "HandleLidSwitchExternalPower=ignore",
      "HandleLidSwitchDocked=ignore",
    ])
      expect(part).toContain(line);
    // Sleep masked; when that fails, the setup goes on and says so.
    expect(part).toContain(
      "if systemctl mask -q sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target; then",
    );
    expect(part).toContain("but sleep isn't off (systemctl mask failed, above)");
    // A reload, never a restart of logind (which could end sessions), and only when it changed.
    expect(part).toContain('if ! cmp -s "$WORK/logind.conf" "$LOGIND_DROPIN"; then');
    expect(part).toContain("systemctl reload systemd-logind");
    expect(part).not.toContain("restart systemd-logind");
    // This PC keeps its own power settings, as it keeps its SSH; with --manage it's a box you keep.
    expect(part).toContain(
      'if [ "${SHIPIFY_HERE:-}" = 1 ] && [ "${SHIPIFY_MANAGE:-}" != 1 ]; then',
    );
    expect(part).toContain("its power settings stay as they are");
  });

  it("gives every box containers for its agents, rootless, in a step that never fails the setup (setup 8, ADR 0064)", () => {
    const step = setup.slice(at("lab() {"), at("# The box's own update (setup 14): its settings"));
    // After the agents' users (their ranges need them), and never in an image or a box in Docker.
    expect(at("say \"The agents' users")).toBeLessThan(at("lab() {"));
    expect(step).toContain('if [ -n "$IMAGE$CONTAINER" ]; then');
    expect(step).toContain("skipped: a box in Docker makes no containers");
    // The exact list, nothing it recommends, and never a package removed.
    expect(step).toContain(
      'pkgs="podman podman-compose uidmap slirp4netns catatonit netavark aardvark-dns"',
    );
    expect(step).toContain("apt_get install -y -q --no-install-recommends --no-remove $pkgs");
    // The docker command, only where no other docker is: a Docker of the machine's own stays.
    expect(step).toContain(
      'if dpkg -s podman-docker >/dev/null 2>&1 || ! command -v docker >/dev/null; then pkgs="$pkgs podman-docker"',
    );
    // No Docker Engine, no docker group, nothing for root.
    expect(code).not.toMatch(/apt_get install[^\n]*(docker\.io|docker-ce)/);
    expect(code).not.toMatch(/groupadd docker|-aG docker|usermod -G/);
    expect(step).toContain(
      "systemctl disable --now -q podman.socket podman.service podman-auto-update.timer",
    );
    expect(code).not.toMatch(/systemctl (enable|start)[^\n]*podman/);
    // The agents' settings alone, in a file the runner names in each agent command.
    expect(code).toContain("CONTAINERS_CONF=/etc/containers/shipify-agents.conf");
    for (const line of [
      "'log_driver = \"k8s-file\"'",
      "'cgroup_manager = \"cgroupfs\"'",
      "'events_logger = \"file\"'",
      "'compose_providers = [\"podman-compose\"]'",
      '"compose_warning_logs = false"',
    ])
      expect(step, line).toContain(line);
    // Setup 12: their network goes through slirp4netns on every Ubuntu, as on 24.04. Ubuntu
    // 26.04's Podman 5 takes pasta by default, which the exact list doesn't install, so no
    // container with a network started there. The file as setup writes it, section by section.
    const write =
      /printf '%s\\n' "# Written by Shipify box setup[^\n]*Podman's settings[\s\S]*?> "\$CONTAINERS_CONF"/.exec(
        step,
      )?.[0];
    expect(write).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "agents-conf-"));
    const conf = join(dir, "shipify-agents.conf");
    const r = bash([write ?? ""], { CONTAINERS_CONF: conf });
    expect(r.status, r.stderr).toBe(0);
    const sections = Object.fromEntries(
      readFileSync(conf, "utf8")
        .split(/^(?=\[)/m)
        .filter((s) => s.startsWith("["))
        .map((s) => [/^\[(\w+)\]/.exec(s)?.[1], s]),
    );
    expect(sections.network).toContain('default_rootless_network_cmd = "slirp4netns"');
    expect(sections.engine).toContain('cgroup_manager = "cgroupfs"');
    rmSync(dir, { recursive: true, force: true });
    // Docker's habits: a short name is Docker Hub's, and no notice from podman-docker.
    expect(step).toContain("'unqualified-search-registries = [\"docker.io\"]'");
    expect(step).toContain("/etc/containers/registries.conf.d/50-shipify.conf");
    expect(step).toContain("touch /etc/containers/nodocker");
    // Ubuntu's normal updates, only where they're missing, in a file of their own.
    expect(step).toContain(
      'if [ -n "$codename" ] && [ -z "$(ubuntu_suite "$codename-updates")" ]; then',
    );
    expect(step).toContain("/etc/apt/sources.list.d/shipify-updates.sources");
    // Never the setup's end: the step runs on its own, and says so when it stops.
    expect(setup).toContain("(lab)");
    expect(setup).toContain("skipped: the containers didn't install (above)");
  });

  it("gives each agent a range of IDs of its own, overlapping no other, and takes it back with its slot", () => {
    // A new agent gets one from shadow itself; one that exists, the next free one.
    expect(code).toContain(
      'useradd --system --user-group --no-create-home --add-subids-for-system --home-dir "$AGENT_ROOT/$u" --shell /usr/sbin/nologin "$u"',
    );
    const step = setup.slice(at("lab() {"), at("# The box's own update (setup 14): its settings"));
    expect(step).toContain("first=$(next_ids /etc/subuid /etc/subgid)");
    expect(step).toContain(
      'grep -q "^$u:" /etc/subuid || usermod --add-subuids "$first-$((first + 65535))" "$u"',
    );
    expect(step).toContain(
      'grep -q "^$u:" /etc/subgid || usermod --add-subgids "$first-$((first + 65535))" "$u"',
    );
    // A slot that goes: its processes, its containers' too (a kill as the agent), its ranges, then
    // its user.
    const gone = setup.slice(
      at("goes, with its slot"),
      at("# The box's own update (setup 14): its settings"),
    );
    expect(gone.indexOf('sudo -u "$u" kill -KILL -1')).toBeGreaterThan(0);
    expect(gone.indexOf('sudo -u "$u" kill -KILL -1')).toBeLessThan(
      gone.indexOf("usermod --del-subuids"),
    );
    expect(gone.indexOf("usermod --del-subuids")).toBeGreaterThan(0);
    expect(gone.indexOf("usermod --del-subuids")).toBeLessThan(gone.indexOf('userdel "$u"'));
    // next_ids: past every range in either file, and never below Ubuntu's SUB_UID_MIN.
    const fn = /^next_ids\(\) \{.*\}$/m.exec(setup)?.[0] ?? "";
    expect(fn).not.toBe("");
    const dir = sandbox().dir;
    const uid = join(dir, "subuid");
    const gid = join(dir, "subgid");
    const next = (u: string, g: string) => {
      writeFileSync(uid, u);
      writeFileSync(gid, g);
      return spawnSync("bash", ["-c", `${fn}\nnext_ids "$1" "$2"`, "x", uid, gid], {
        encoding: "utf8",
      }).stdout.trim();
    };
    expect(next("", "")).toBe("100000");
    expect(next("homepi:100000:65536\nshipify:165536:65536\n", "homepi:100000:65536\n")).toBe(
      "231072",
    );
    expect(next("a:100000:65536\n", "b:300000:65536\n")).toBe("365536");
  });

  it("goes on when the containers don't install, with one line on what it means", () => {
    const step = setup.slice(
      at("next_ids() {"),
      at("# The box's own update (setup 14): its settings"),
    );
    const dir = sandbox().dir;
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // A box whose sources have Ubuntu's normal updates, so nothing is added.
    writeFileSync(
      join(bin, "apt-cache"),
      [
        "#!/bin/sh",
        ". /etc/os-release",
        'echo " 500 http://archive.ubuntu.com/ubuntu ${VERSION_CODENAME}-updates/main amd64 Packages"',
        'echo "     release v=24.04,o=Ubuntu,a=${VERSION_CODENAME}-updates,n=${VERSION_CODENAME},l=Ubuntu,c=main,b=amd64"',
      ].join("\n"),
      { mode: 0o755 },
    );
    const run = spawnSync(
      "bash",
      [
        "-c",
        [
          "set -euo pipefail",
          'IMAGE="" CONTAINER=""',
          `say() { printf '\\n== %s\\n' "$*"; }`,
          'apt_get() { echo "E: Unable to locate package podman" >&2; return 100; }',
          step,
          'echo "went on"',
        ].join("\n"),
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(
      "  skipped: the containers didn't install (above); the box works without them, and box add again tries again\n",
    );
    expect(run.stdout).not.toContain("added Ubuntu's normal updates");
    expect(run.stdout).toContain("went on");
  });

  it("finds Ubuntu's own source for a suite, never another source with the same suite's name", () => {
    const fn = setup.slice(at("ubuntu_suite() {"), at("lab() {"));
    const dir = sandbox().dir;
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // homepi's: no noble-updates, and Tailscale's own source is "noble" too.
    writeFileSync(
      join(bin, "apt-cache"),
      `#!/bin/sh\ncat <<'EOF'\n${[
        "Package files:",
        " 100 /var/lib/dpkg/status",
        "     release a=now",
        " 500 http://ports.ubuntu.com/ubuntu-ports noble-security/main arm64 Packages",
        "     release v=24.04,o=Ubuntu,a=noble-security,n=noble,l=Ubuntu,c=main,b=arm64",
        "     origin ports.ubuntu.com",
        " 500 http://ports.ubuntu.com/ubuntu-ports noble/universe arm64 Packages",
        "     release v=24.04,o=Ubuntu,a=noble,n=noble,l=Ubuntu,c=universe,b=arm64",
        "     origin ports.ubuntu.com",
        " 500 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 Packages",
        "     release v=24.04,o=Ubuntu,a=noble,n=noble,l=Ubuntu,c=main,b=arm64",
        "     origin ports.ubuntu.com",
        " 500 https://pkgs.tailscale.com/stable/ubuntu noble/main arm64 Packages",
        "     release o=Tailscale,n=noble,l=Tailscale,c=main,b=arm64",
        "     origin pkgs.tailscale.com",
      ].join("\n")}\nEOF\n`,
      { mode: 0o755 },
    );
    const suite = (s: string) =>
      spawnSync("bash", ["-c", `${fn}\nubuntu_suite "$1"`, "x", s], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }).stdout;
    expect(suite("noble")).toBe(
      "http://ports.ubuntu.com/ubuntu-ports universe\nhttp://ports.ubuntu.com/ubuntu-ports main\n",
    );
    expect(suite("noble-updates")).toBe("");
    expect(suite("noble-security")).toBe("http://ports.ubuntu.com/ubuntu-ports main\n");
  });

  it("checks the containers' walls: no agent writes a root container socket, and the box's kill leaves nothing", () => {
    const proof = at('say "Checking the sandbox"');
    const check = setup.slice(proof, at('record "$SETUP_VERSION" "manage: not finished"'));
    // A wall, on every box (Podman or not): a docker group or a root socket would give an agent
    // the box.
    expect(check).toContain("for sock in /run/docker.sock /run/podman/podman.sock; do");
    expect(check).toContain('if sudo -u "$u" test -w "$sock"; then');
    // Where Podman is: each agent's range, and on one slot the whole way, with a run's names.
    expect(check).toContain('if [ -z "$CONTAINER" ] && command -v podman >/dev/null; then');
    expect(check).toContain("unshare cat /proc/self/uid_map");
    const lab = setup.slice(at("podman_as() {"), proof);
    for (const step of [
      // The box's HOME for Podman (containerEnv): setup 10's was in the check's own folder, which its
      // last step removed, and Podman stopped ("cannot resolve …").
      'HOME="$s"',
      'XDG_DATA_HOME="$s/data" XDG_RUNTIME_DIR="$s/runtime"',
      'CONTAINERS_CONF_OVERRIDE="$CONTAINERS_CONF"',
      'pull -q "$CHECK_IMAGE"',
      // A folder laid out as a run's (prepareRun: only out/ keeps the slot folder's group), which
      // the container gives to a user of its own and runs as, as a database's image does.
      "mkdir -m 2750 run-setup-check/out && chmod g-s run-setup-check && mkdir -m 700",
      '-v "$c/work/c:/w"',
      "chown nobody:nobody /w && chmod 700 /w",
      'su -s /bin/sh -c "touch /w/f && exec sleep 600" nobody',
      "$((first + 65533))",
      "/proc/$pid/cgroup",
      'kill_agent "$u"',
      "system prune --force --volumes",
      "unshare rm -rf",
    ])
      expect(lab, step).toContain(step);
    // What Podman said when it couldn't remove the folder, never hidden (setup 10 hid it).
    expect(fn("lab_check")).toMatch(/✗ containers: the box can't remove[^\n]*lab_error/);
    // The kill reaches the agent's range too: a process that survives is a wall, so no label.
    expect(lab).toContain('walls=""');
    // Each slot's store, as its runs open it (setup 10): where setup 8 and 9 failed on a box.
    expect(check).toContain('elif ! podman_as "$u" info >/dev/null 2>"$WORK/lab.log"; then');
    // Each failure says Podman's own error, never a warning that came after it, nor a fix that
    // isn't one ("run box add again").
    const log = join(sandbox().dir, "lab.log");
    writeFileSync(
      log,
      'Error: failed to mount overlay for metacopy check with "" options: permission denied\ntime="…" level=warning msg="dbus: couldn\'t determine address of session bus"\n',
    );
    expect(bash([fn("lab_error"), `lab_error "${log}"`]).stdout.trim()).toBe(
      'Error: failed to mount overlay for metacopy check with "" options: permission denied',
    );
    writeFileSync(log, "one\nthe last\n");
    expect(bash([fn("lab_error"), `lab_error "${log}"`]).stdout.trim()).toBe("the last");
    // A container's own words (podman logs), with no Error: line: its last line, never a warning.
    writeFileSync(log, 'chown: /w: Operation not permitted\ntime="…" level=warning msg="dbus"\n');
    expect(bash([fn("lab_error"), `lab_error "${log}"`]).stdout.trim()).toBe(
      "chown: /w: Operation not permitted",
    );
    expect(setup).not.toMatch(/tail -n 1 "\$WORK\/lab\.log"/);
    expect(check).not.toMatch(/✗ containers[^\n]*run box add again/);
  });

  it("never says done when containers don't work: exit 3, after --manage, which box add reads (setup 10)", () => {
    const end = setup.slice(at("# --manage last"));
    expect(end).toContain(
      'if [ -z "$CONTAINER" ] && [ "$lab_ok" != ok ] && [ "$lab_ok" != unproven ]; then',
    );
    // What failed may be a container's start or the box's clean-up after one: the ✗ line says which.
    expect(end).toContain("Done, except containers: their check failed (✗ above)");
    expect(end).toContain("Done, except containers: they didn't install");
    const exit = at('[ -z "$no_lab" ] || exit 3\nsay "Done: ask');
    // The rest of the box is recorded first: it works, and gets its label.
    expect(exit).toBeGreaterThan(at('record "$SETUP_VERSION" "manage: not finished"'));
    expect(exit).toBeGreaterThan(at("(manage)"));
    // An image that didn't pull is the network's, not the box's: the store's check still holds.
    expect(fn("lab_check")).toContain('[ -z "$lab_ok" ] || lab_ok=unproven');
    expect(setup).toContain("lab_ok=none");
    expect(setup).toContain("CHECK_IMAGE=docker.io/library/busybox:1.37");
    // left_of counts the agent's processes and its range's, from one read of the process list.
    expect(setup).toMatch(/^left_of\(\) \{/m);
  });

  it("records the setup as done only once --manage finishes, else ends with exit 4, which box add reads (setup 13)", () => {
    // The end of setup.sh, as it runs, with --manage and the sandbox's result stood in for.
    const dir = sandbox().dir;
    const end = setup
      .slice(at("record() {"))
      .replaceAll("/home/shipify/.shipify-setup", `${dir}/.shipify-setup`)
      .replace("sudo -u shipify tee", "tee");
    const run = (manage: number, lab = "ok", env: Record<string, string> = {}) => {
      const r = bash(
        [
          "SETUP_VERSION=13 CONTAINER=''",
          `lab_ok='${lab}'`,
          'say() { echo "== $*"; }',
          `manage() { echo "  managing"; return ${manage}; }`,
          end,
        ],
        { SHIPIFY_MANAGE: "1", ...env },
      );
      return {
        code: r.status,
        out: r.stdout,
        file: readFileSync(join(dir, ".shipify-setup"), "utf8"),
      };
    };
    // A missed sign-in, Cockpit not served, a Ctrl-C: noted, never done, and doctor names the box.
    const stopped = run(1);
    expect(stopped.code).toBe(4);
    expect(stopped.file).toBe("13\nmanage: not finished\n");
    expect(stopped.out).toContain("Done, except --manage: it stopped (above)");
    expect(stopped.out).not.toContain("== Done: ask");
    // Containers failing too: both said, and exit 4, as the firewall matters more.
    const both = run(1, "");
    expect(both.code).toBe(4);
    expect(both.out).toContain("Done, except containers: their check failed");
    // Finished: the plain version, and done.
    const done = run(0);
    expect(done.code).toBe(0);
    expect(done.file).toBe("13\n");
    expect(done.out).toContain("== Done: ask");
    expect(run(0, "").code).toBe(3);
    // No --manage: nothing for it to finish.
    const plain = run(1, "ok", { SHIPIFY_MANAGE: "" });
    expect(plain.code).toBe(0);
    expect(plain.file).toBe("13\n");
    expect(plain.out).not.toContain("managing");
  });

  it("puts the firewall right after Tailscale's sign-in, before Cockpit, and fails --manage when Tailscale isn't up (setup 13)", () => {
    const manage = fn("manage");
    const signIn = manage.indexOf("tailscale up --ssh --timeout 15m");
    const wall = manage.indexOf("\n  firewall\n");
    expect(signIn).toBeGreaterThan(0);
    expect(wall).toBeGreaterThan(signIn);
    // A Cockpit that doesn't install or serve never leaves the machine open.
    expect(manage.indexOf("apt_get install")).toBeGreaterThan(wall);
    expect(manage.indexOf("tailscale serve")).toBeGreaterThan(wall);
    // No Tailscale address: the firewall says so and fails, so --manage does too.
    const r = bash([
      "ip() { :; }",
      "sleep() { :; }",
      'say() { echo "== $*"; }',
      'ufw() { echo "ufw $*"; }',
      fn("firewall"),
      "firewall && echo on || echo failed",
    ]);
    expect(r.stdout).toContain("✗ not on: Tailscale isn't up");
    expect(r.stdout).not.toContain("ufw ");
    expect(r.stdout.trim().split("\n").pop()).toBe("failed");
  });

  it("takes out older setups' rules, says each of yours that lets more in, never 'only' then, and filters IPv6 (setup 13)", () => {
    const dir = sandbox().dir;
    const run = (rules: string[], defaults: string) => {
      writeFileSync(join(dir, "added"), `${rules.join("\n")}\n`);
      writeFileSync(join(dir, "defaults"), defaults);
      writeFileSync(join(dir, "calls"), "");
      // A ufw that keeps its rules in a file: `show added` lists them, `delete` takes one out.
      const r = bash([
        "ip() { echo '    inet 100.101.102.103/32 scope global tailscale0'; }",
        "sleep() { :; }",
        "ss() { :; }",
        "systemctl() { return 1; }",
        'say() { echo "== $*"; }',
        `ufw() { echo "ufw $*" >> "${dir}/calls"; case "$1" in show) echo "Added user rules (see 'ufw status' for running firewall):"; cat "${dir}/added" ;; delete) shift; grep -vF "ufw $*" "${dir}/added" > "${dir}/kept" || true; mv "${dir}/kept" "${dir}/added" ;; esac; }`,
        fn("firewall").replaceAll("/etc/default/ufw", join(dir, "defaults")),
        "firewall",
      ]);
      return {
        out: r.stdout,
        calls: readFileSync(join(dir, "calls"), "utf8"),
        defaults: readFileSync(join(dir, "defaults"), "utf8"),
      };
    };
    const ours = "ufw allow in on tailscale0 comment 'Tailscale: Cockpit, SSH'";
    // A VPS whose guide allowed SSH, a box from setup 12, and ufw's IPv6 off.
    const vps = run(
      [
        ours,
        "ufw allow from 192.168.1.0/24 to any port 22 proto tcp comment 'SSH from this network'",
        "ufw allow 41641/udp comment 'Tailscale direct connections'",
        "ufw allow OpenSSH",
        "ufw allow out 53",
      ],
      'IPV6=no\nDEFAULT_INPUT_POLICY="DROP"\n',
    );
    expect(vps.out).toContain("taken out: allow from 192.168.1.0/24 to any port 22 proto tcp");
    expect(vps.out).toContain("taken out: allow 41641/udp");
    expect(vps.out).toContain(
      "on: in through Tailscale, and through rules of your own that are still there:\n    allow OpenSSH\n",
    );
    expect(vps.out).toContain(
      "For Tailscale only, take each out: sudo ufw delete <the rule above>",
    );
    expect(vps.out).not.toContain("Tailscale only; out as before");
    expect(vps.out).not.toContain("allow out 53");
    expect(vps.defaults).toBe('DEFAULT_INPUT_POLICY="DROP"\nIPV6=yes\n');
    expect(vps.out).toContain("IPv6 filtered too now");
    expect(vps.calls.indexOf("ufw reload")).toBeGreaterThan(
      vps.calls.indexOf("ufw --force enable"),
    );
    // Nothing of yours: Tailscale only, and no reload when IPv6 was on already.
    const plain = run([ours], "IPV6=yes\n");
    expect(plain.out).toContain("on: in through Tailscale only; out as before");
    expect(plain.calls).not.toContain("ufw reload");
    expect(plain.defaults).toBe("IPV6=yes\n");
  });

  it("proves the sandbox before it records setup 5", () => {
    const proof = at('say "Checking the sandbox"');
    const record = at('record "$SETUP_VERSION" "manage: not finished"');
    expect(record).toBeGreaterThan(proof);
    const check = setup.slice(proof, record);
    for (const wall of [
      'sudo -u shipify sudo -n -u "$u" true',
      'wall "$u" /home/shipify',
      'wall "$u" "$RUNNER_HOME/_work"',
      'wall "$u" "/proc/$listener/environ"',
      'wall "$u" "$AGENT_ROOT/$(agent_user "$j")"',
      // The look server's user (setup 16): the runner starts it, and it reads nothing of the
      // runner's, nor a slot's runs.
      'sudo -u shipify sudo -n -u "$LOOK_USER" true',
      'wall "$LOOK_USER" /home/shipify',
      'wall "$LOOK_USER" "$RUNNER_HOME/_work"',
      'wall "$LOOK_USER" "/proc/$listener/environ"',
      'wall "$LOOK_USER" "$AGENT_ROOT/$(agent_user "$k")"',
      // The agent's memory, where its login is: a command reads only its own children's.
      '"$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo 0)" -lt 1',
      "exit 1",
    ])
      expect(check, wall).toContain(wall);
  });

  it("on WSL, gives no sandbox while an agent can reach Windows, and names the fix in wsl.conf", () => {
    const proof = at('say "Checking the sandbox"');
    const check = setup.slice(proof, at('record "$SETUP_VERSION" "manage: not finished"'));
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

  it("runs the runner's dependencies' installer from root's own copy, never the runner's folder (setup 14)", () => {
    const deps = fn("runner_deps");
    expect(deps).toContain('tar -xzf "$TARBALL" -C "$WORK/runner"');
    expect(deps).toContain('"$WORK/runner/bin/installdependencies.sh"');
    // The runner's user (and so a job) can change its own folder: root runs nothing from it.
    expect(code).not.toContain('"$home/bin/installdependencies.sh"');
    // No token, nothing run: a slot only registers with one (the box's own update has none).
    const register = fn("register");
    expect(register.indexOf('[ -n "$token" ] ||')).toBeLessThan(register.indexOf("runner_deps"));
    // The image's build, the same way.
    expect(setup.slice(at('say "The runner\'s libraries"'))).toMatch(/^ {2}runner_deps$/m);
  });

  it("keeps its settings and installs its own update, root's own, outside a container (setup 14)", () => {
    const step = setup.slice(
      at("# The box's own update (setup 14): its settings"),
      at('say "The sudo rules'),
    );
    expect(step).toContain('if [ -z "$CONTAINER" ] && [ -f "$UPDATE_FILE" ]; then');
    expect(step).toContain('install -m 0600 -o root -g root "$WORK/box.env" /etc/shipify/box.env');
    // A new file renamed into place: an update running the old one reads it to its end.
    expect(
      step.indexOf('install -m 0755 -o root -g root "$UPDATE_FILE" "$UPDATER.new"'),
    ).toBeLessThan(step.indexOf('mv -f "$UPDATER.new" "$UPDATER"'));
    expect(code).toContain("UPDATER=/usr/local/sbin/shipify-box-update");
    // The settings, as box add gave them, never a registration token; read back the same by bash.
    const loop = /^ {4}for v in RUNNER_URL [^\n]*$/m.exec(step)?.[0] ?? "";
    expect(loop).not.toContain("TOKENS");
    const dir = sandbox().dir;
    const env = {
      RUNNER_URL: "https://github.com/someone/shipify",
      RUNNER_NAME: "homepi",
      RUNNER_LABELS: "self-hosted,shipify-box,box-homepi",
      RUNNER_SLOTS: "3",
      SHIPIFY_MANAGE: "1",
      RUNNER_TOKENS: "reg-token-never-kept",
      SUDO_USER: "it's me",
    };
    const r = bash(
      [
        `{ ${loop}; printf 'SHIPIFY_ADMIN=%q\\n' "\${SUDO_USER:-}"; } > ${dir}/box.env`,
        'env -i bash -c \'set -a; . "$1"; echo "$RUNNER_LABELS|$RUNNER_SLOTS|$SHIPIFY_MANAGE|$SHIPIFY_HERE|$SHIPIFY_ADMIN"\' x ' +
          `${dir}/box.env`,
      ],
      env,
    );
    expect(r.stdout).toBe("self-hosted,shipify-box,box-homepi|3|1||it's me\n");
    expect(readFileSync(join(dir, "box.env"), "utf8")).not.toContain("reg-token-never-kept");
  });

  it("in the box's own update, keeps the slots' services, waits for no updates and no sign-in (setup 14)", () => {
    expect(code).toContain("REFRESH=${SHIPIFY_REFRESH:-}");
    // SSH's keys and words stay those of the account you set it up with.
    expect(code).toContain('[ -z "$REFRESH" ] || SUDO_USER=${SHIPIFY_ADMIN:-}');
    expect(code).toContain('if [ -z "$CONTAINER$REFRESH" ]; then\nsay "The updates waiting now"');
    // The services as they are: the update stopped the idle slots, and starts them after.
    const services = at('elif [ -n "$REFRESH" ]; then');
    expect(services).toBeLessThan(at('[ -f "$UNIT_FILE" ] || { echo "No service file'));
    // Tailscale's sign-in waits for you: never in an update.
    const manage = fn("manage");
    expect(manage.indexOf('if [ -n "$REFRESH" ]; then')).toBeLessThan(
      manage.indexOf("tailscale up --ssh --timeout 15m"),
    );
  });

  it("leaves a mark when the sandbox check fails, and takes it away when it passes (setup 14)", () => {
    const dir = sandbox().dir;
    const end = setup
      .slice(
        at("SANDBOX_OPEN=/etc/shipify/sandbox-open"),
        at('echo "  done: $RUNNER_SLOTS agent(s)'),
      )
      .replaceAll("/etc/shipify", dir);
    const run = (walls: string) =>
      bash(["SETUP_VERSION=14", `walls='${walls}'`, end, "echo passed"]);
    const failed = run("");
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain(
      "The sandbox isn't right (above), so no task runs here until it is",
    );
    expect(readFileSync(join(dir, "sandbox-open"), "utf8")).toMatch(
      /^box setup 14's sandbox check failed on \d{4}-\d\d-\d\d \d\d:\d\d UTC\n$/,
    );
    const passed = run("ok");
    expect(passed.stdout).toBe("passed\n");
    expect(existsSync(join(dir, "sandbox-open"))).toBe(false);
    // Before the record: a box whose check failed keeps its old version, and tries again.
    expect(at("SANDBOX_OPEN=/etc/shipify/sandbox-open")).toBeLessThan(at("record() {"));
  });
});

describe("box/update.sh: the box's own setup update (setup 14), checked without a box", () => {
  const file = join(ROOT, "box", "update.sh");
  const update = readFileSync(file, "utf8");
  const code = update
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const fn = (name: string) => {
    const m = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, "m").exec(update);
    expect(m, name).not.toBeNull();
    return m?.[0] ?? "";
  };
  const oneLine = (name: string) => {
    const m = new RegExp(`^${name}\\(\\) \\{ .* \\}$`, "m").exec(update);
    expect(m, name).not.toBeNull();
    return m?.[0] ?? "";
  };

  it("passes shellcheck where it's installed, and runs only as root", () => {
    const sc = spawnSync("shellcheck", [file], { encoding: "utf8" });
    if (!sc.error) expect(sc.stdout).toBe("");
    const r = spawnSync("bash", [file], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Run it with sudo.");
  });

  it("takes the token on stdin, uses it for one download from the box's own repo, and keeps it nowhere", () => {
    expect(code).toContain('[ $# = 0 ] || { echo "It takes no arguments');
    expect(code).toContain("IFS= read -r -t 10 token || true");
    // Into a header file only root reads, never on a command line, gone after the download.
    expect(code).toContain(
      `(umask 077 && printf 'Authorization: Bearer %s\\n' "$token" > "$DIR/auth")`,
    );
    expect(code).toContain('-H @"$DIR/auth"');
    expect(code).not.toMatch(/-H "Authorization/);
    expect(code.indexOf('rm -f "$DIR/auth"')).toBeLessThan(
      code.indexOf('want=$(version_of "$DIR/setup.sh")'),
    );
    // From the repo the box was set up for, its default branch, over HTTPS only.
    expect(code).toContain("url=$(setting RUNNER_URL)");
    expect(code).toContain('"https://api.github.com/repos/$repo/contents/box/$1"');
    expect(code).toContain("--proto '=https'");
    expect(code).not.toContain("ref=");
    const repo = (url: string) =>
      spawnSync(
        "bash",
        [
          "-c",
          `url='${url}'; repo=\${url#https://github.com/}; if [ "$url" = "$repo" ] || ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then echo refused; else echo "$repo"; fi`,
        ],
        { encoding: "utf8" },
      ).stdout.trim();
    expect(code).toContain(
      'if [ "$url" = "$repo" ] || ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then',
    );
    expect(repo("https://github.com/someone/shipify")).toBe("someone/shipify");
    expect(repo("https://evil.example/someone/shipify")).toBe("refused");
    expect(repo("https://github.com/someone/shipify/../other")).toBe("refused");
  });

  it("runs only what root downloaded, from a folder only root opens, as box add would (no tokens)", () => {
    expect(code).toContain("DIR=/var/lib/shipify/update");
    expect(code.indexOf('rm -rf "$DIR"')).toBeLessThan(code.indexOf('install -d -m 0700 "$DIR"'));
    expect(code).toContain('bash "$DIR/setup.sh" "$DIR/box.env" "" "" "$DIR/update.sh"');
    expect(code).toContain('echo "SHIPIFY_REFRESH=1"');
    // In a service of its own, so a job that ends or is cancelled doesn't cut the setup off.
    expect(code).toContain('systemd-run --quiet --wait --collect --unit "$UNIT"');
    expect(code).toContain("UNIT=shipify-setup-update");
    // Never a slot's own name (shipify-box-*), which its stop would take for a slot.
    expect(update).not.toMatch(/UNIT=shipify-box-/);
  });

  it("registers nothing: a slot with no registration here stops it before any download", () => {
    expect(code).toContain('f="/home/shipify/runner/slot-$k/.runner"');
    expect(code.indexOf("Slot $k has no registration here")).toBeLessThan(
      code.indexOf("fetch setup.sh"),
    );
  });

  it("applies a setup only when it's newer, and one that failed only a day later", () => {
    const dir = sandbox().dir;
    writeFileSync(join(dir, "setup.sh"), "#!/bin/sh\nSETUP_VERSION=14\n");
    const say = (lines: string[]) =>
      spawnSync("bash", ["-c", ["set -euo pipefail", ...lines].join("\n")], {
        encoding: "utf8",
      }).stdout;
    const versions = [oneLine("version_of"), `RECORD=${dir}/.shipify-setup`, fn("recorded")];
    expect(say([...versions, `version_of ${dir}/setup.sh`, "recorded"])).toBe("14\n0\n");
    writeFileSync(join(dir, ".shipify-setup"), "13\nmanage: not finished\n");
    expect(say([...versions, "recorded"])).toBe("13\n");
    expect(code).toContain('if [ "$want" -le "$have" ]; then');
    expect(code).toContain(
      'if [ "$failed" = "$want" ] && [ $(($(date +%s) - at)) -lt 86400 ]; then',
    );
    expect(code).toContain('echo "$want $(date +%s)" > "$TRIED"');
  });

  it("stops only the slots with no job, never while another runs one, and starts them again however it ends", () => {
    const apply = code.slice(
      code.indexOf('if [ "${1:-}" = --apply ]; then'),
      code.indexOf("\nfi\n"),
    );
    expect(apply).toContain('if [ "$(printf \'%s\\n\' "$running" | grep -c .)" -gt 1 ]; then');
    expect(apply).toContain('echo 75 > "$DIR/exit"');
    expect(apply).toContain('printf \'%s\\n\' "$running" | grep -qx "$unit" && continue');
    expect(apply.indexOf("trap start_again EXIT")).toBeLessThan(
      apply.indexOf('systemctl stop "$unit"'),
    );
    // A job's slot, from its Worker's group.
    const busy = fn("busy");
    expect(busy).toContain("pgrep -u shipify -f 'bin/Runner\\.Worker'");
    expect(busy).toContain(String.raw`sed -n 's|^0::.*/\(shipify-box-[^/]*\.service\)$|\1|p'`);
  });
});

describe("ship box add: setup 5 over SSH, or on this PC (a fake ssh, bash, sudo and gh)", () => {
  // What the machine says: its arch, os-release's ID and VERSION_ID, hostname, MemTotal in KiB.
  const pi = "aarch64\\nubuntu 24.04\\nhomepi\\n7969000\\n";
  const machine = (
    setupExit: number,
    probe = pi,
    systemd = true,
    repo = "true",
    wsl = false,
    status = "online",
    tailnet = "",
  ) => {
    const sb = sandbox();
    const bin = join(sb.dir, "bin");
    const got = join(sb.dir, "got");
    mkdirSync(bin);
    mkdirSync(got);
    const log = join(sb.dir, "calls.log");
    const runners = join(sb.dir, "runners.json");
    // The slots' services on this machine, as systemctl lists them: homepi's, here.
    const units = join(sb.dir, "units");
    writeFileSync(
      units,
      "shipify-box-homepi.service enabled\nshipify-box-homepi-2.service enabled\n",
    );
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
            status,
            busy: false,
            labels: labels("shipify-box", "box-homepi"),
          },
          {
            id: 2,
            name: "homepi-2",
            os: "Linux",
            status,
            busy: false,
            labels: labels("shipify-box", "box-homepi", "sandbox"),
          },
        ],
      }),
    );
    const script = (body: string) => `#!/bin/sh\n${body}\n`;
    // The wait for slots to come online takes no time here.
    writeFileSync(join(bin, "sleep"), script(`echo "sleep $*" >> "${log}"`), { mode: 0o755 });
    writeFileSync(
      join(bin, "systemctl"),
      script(`echo "systemctl $*" >> "${log}"
case "$*" in
  *list-unit-files*) cat "${units}" ;;
esac`),
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, "ssh"),
      script(`echo "ssh $*" >> "${log}"
case "$*" in
  *"uname -m"*) printf '${probe}' ;;
  *"systemctl cat"*) echo same ;;
  *"mktemp -d"*) echo /tmp/tmp.Ab12 ;;
  *"cat > "*) f=\${*##* }; cat > "${got}/\${f##*/}" ;;
  *"tailscale status"*) echo '${tailnet}' ;;
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
  *"/proc/version"*) ${wsl ? "echo wsl" : "exit 1"} ;;
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
    return {
      sb,
      log: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
      got,
      units,
      runners,
    };
  };

  it("--container is the container's own setup: never with a target, never outside a container", () => {
    const { sb, log } = machine(0);
    const r = ship(sb, "box", "add", "pi@host", "--container", "--yes");
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("docker run … register runs it");
    expect(log()).not.toContain("registration-token");
  });

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
    expect(readFileSync(join(got, "setup.sh"), "utf8")).toBe(
      readFileSync(join(ROOT, "box", "setup.sh"), "utf8"),
    );
    // The box's own update goes with it (setup 14), for setup to install as root's own.
    expect(readFileSync(join(got, "update.sh"), "utf8")).toContain(
      "/usr/local/sbin/shipify-box-update",
    );
    // The slots GitHub has, so setup registers again one it deleted.
    expect(readFileSync(join(got, "box.env"), "utf8")).toContain('RUNNER_REGISTERED="1 2"');
    // The folder goes in the same session as the setup: no SSH connection after it (setup 13). As
    // you, after sudo: a wrong password, which never runs the setup, leaves no token there either.
    expect(calls).toContain(
      "ssh -t homepi sh -c 'sudo bash /tmp/tmp.Ab12/setup.sh /tmp/tmp.Ab12/box.env /tmp/tmp.Ab12/prep.tsv /tmp/tmp.Ab12/box.service /tmp/tmp.Ab12/update.sh; r=$?; rm -rf /tmp/tmp.Ab12; exit $r'",
    );
    expect(calls.slice(calls.indexOf("ssh -t homepi") + 1)).not.toMatch(/^ssh /m);
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

  it("labels the slots when only containers don't work (setup's exit 3), and says so plainly, never done (setup 10)", () => {
    const { sb, log } = machine(3);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2", "--yes");
    expect(r.status).toBe("failed");
    expect(r.summary).toContain(
      "takes tasks, but its agents' containers failed the setup's check (above), so a task that needs one may fail",
    );
    expect(r.summary).toContain('docs/troubleshooting.md, "Containers don\'t start"');
    // The rest of the box works: its slots get their label, so task runs go to them.
    expect(log()).toMatch(/runners\/1\/labels -f labels\[\]=sandbox/);
  });

  it("labels the slots when --manage stopped (setup's exit 4), and says the firewall may not be on, never done (setup 13)", () => {
    const { sb, log } = machine(4);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2", "--manage", "--yes");
    expect(r.status).toBe("failed");
    expect(r.summary).toContain("takes tasks, but its --manage part stopped");
    expect(r.summary).toContain("its firewall may not be on");
    expect(r.summary).toContain("ship doctor names this box");
    // Its firewall may still let in SSH from the home network: no "from now on, over Tailscale".
    expect(r.nextSteps?.join("\n") ?? "").not.toContain("reach it over Tailscale only");
    // Or it came on before Cockpit's part stopped: then the same command runs over Tailscale.
    expect(r.nextSteps).toContain(
      "if SSH from your network no longer answers, its firewall came on before it stopped: run it again over Tailscale (in ~/.ssh/config, its HostName is its Tailscale name)",
    );
    expect(log()).toMatch(/runners\/1\/labels -f labels\[\]=sandbox/);
  });

  it("over SSH without --manage, says plainly that it gets no firewall (setup 13)", () => {
    const { sb } = machine(0);
    const plain = (ship(sb, "box", "add", "homepi", "--slots", "2").plannedActions ?? []).join(
      "\n",
    );
    expect(plain).toContain(
      "no --manage, so no firewall: its SSH (keys only) answers on its network",
    );
    const managed = (
      ship(sb, "box", "add", "homepi", "--slots", "2", "--manage").plannedActions ?? []
    ).join("\n");
    expect(managed).not.toContain("no --manage");
    expect(managed).toContain(
      "Tailscale (installed, and signed in at a link it prints within 15 minutes, if it isn't yet), then the firewall, then Cockpit",
    );
  });

  it("is done only when every slot has the sandbox label and one is online, and says so plainly (setup 9)", () => {
    // A slot GitHub doesn't show: the setup passed, but it takes no task runs.
    const short = machine(0);
    const three = ship(short.sb, "box", "add", "homepi", "--slots", "3", "--yes");
    expect(three.status).toBe("failed");
    expect(three.summary).toContain(
      "The setup passed, but only 2 of 3 slot(s) have the sandbox label on GitHub",
    );
    // No slot online after a minute (here, at once): never "done".
    const off = machine(0, pi, true, "true", false, "offline");
    const r = ship(off.sb, "box", "add", "homepi", "--slots", "2", "--yes");
    expect(r.status).toBe("failed");
    expect(r.summary).toContain("none of its 2 slot(s) is online on GitHub after a minute");
    expect(r.summary).toContain("sudo systemctl status shipify-box-homepi");
    expect(off.log().match(/^sleep 5$/gm)).toHaveLength(12);
  });

  it("shows the agents' network wall, and the updates after the registration, in its plan (setup 9)", () => {
    const { sb } = machine(0);
    const plan = (ship(sb, "box", "add", "homepi", "--slots", "2").plannedActions ?? []).join("\n");
    expect(plan).toContain(
      "the agents' network (setup 9): out to the internet as the work needs, never to a private network",
    );
    expect(plan).toContain("nor reach a private network");
    expect(plan).toContain("the updates waiting now, once the slots are registered");
    expect(plan).toContain("Ubuntu's installer's swap file on the disk (/swap.img) goes for it");
    // This PC without --manage keeps its swap file, as its power settings.
    const pc = (ship(sb, "box", "add", "--slots", "2").plannedActions ?? []).join("\n");
    expect(pc).not.toContain("/swap.img");
    const managed = (ship(sb, "box", "add", "--manage").plannedActions ?? []).join("\n");
    expect(managed).toContain("--manage, last, once the sandbox checks out");
    expect(managed).toContain("without NetworkManager");
  });

  it("box remove --purge takes Shipify off this machine too, with remove.sh as root (setup 9)", () => {
    const { sb, log, got } = machine(0);
    const plan = ship(sb, "box", "remove", "homepi", "--purge");
    expect(plan.status).toBe("requires-approval");
    expect((plan.plannedActions ?? []).join("\n")).toContain(
      "then take Shipify off this machine (box/remove.sh, with sudo)",
    );
    expect(plan.nextSteps?.[0]).toBe("pnpm ship box remove homepi --purge --yes");
    const r = ship(sb, "box", "remove", "homepi", "--purge", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    expect(r.summary).toBe('removed "homepi", and Shipify is off this machine');
    const calls = log();
    // In order: its services stopped, its slots off GitHub, then the script from its own folder.
    const stop = calls.indexOf(
      "sudo systemctl disable --now shipify-box-homepi.service shipify-box-homepi-2.service",
    );
    const off = calls.indexOf("-X DELETE");
    const purged = calls.indexOf("sudo bash /tmp/tmp.Ab12/remove.sh");
    expect(stop).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(stop);
    expect(purged).toBeGreaterThan(off);
    expect(readFileSync(join(got, "remove.sh"), "utf8")).toContain("userdel");
    expect(calls).toContain("rm -rf /tmp/tmp.Ab12");
  });

  it("box remove --purge only on the box's own machine, and without it says how", () => {
    const { sb, log, units } = machine(0);
    // Without --purge, here: the services stop, and the next step names --purge.
    const kept = ship(sb, "box", "remove", "homepi", "--yes");
    expect(kept.status).toBe("succeeded");
    expect(kept.nextSteps?.join("\n")).toContain("pnpm ship box remove homepi --purge --yes");
    expect(log()).not.toContain("remove.sh");
    // Another machine's box: refused before anything changes.
    writeFileSync(units, "");
    const r = ship(sb, "box", "remove", "homepi", "--purge", "--yes");
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("--purge takes Shipify off this machine");
  });

  it("box remove --purge never while a slot runs a task, and clears what's left on a machine that is no box (setup 10)", () => {
    const { sb, log, units, runners } = machine(0);
    const all = JSON.parse(readFileSync(runners, "utf8")) as { runners: { busy: boolean }[] };
    const [first] = all.runners;
    if (first) first.busy = true;
    writeFileSync(runners, JSON.stringify(all));
    const busy = ship(sb, "box", "remove", "homepi", "--purge", "--yes");
    expect(busy.status).toBe("blocked");
    expect(busy.summary).toContain("homepi is running a task: run this again when it's done");
    expect(log()).not.toContain("-X DELETE");
    expect(log()).not.toContain("remove.sh");
    // No box of that name on GitHub, and none here: what's left of Shipify goes (a purge that
    // stopped, or here.sh --fresh on a machine set up before).
    writeFileSync(runners, JSON.stringify({ runners: [] }));
    writeFileSync(units, "");
    const plan = ship(sb, "box", "remove", "homepi", "--purge");
    expect(plan.status).toBe("requires-approval");
    expect(plan.summary).toBe(
      `no box "homepi" is here or on GitHub: would take what's left of Shipify off this machine`,
    );
    expect(plan.nextSteps).toEqual(["pnpm ship box remove homepi --purge --yes"]);
    const r = ship(sb, "box", "remove", "homepi", "--purge", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    expect(r.summary).toBe(
      'no box "homepi" was here or on GitHub, and Shipify is off this machine',
    );
    expect(log()).toContain("sudo bash /tmp/tmp.Ab12/remove.sh");
    // Never on a machine that is another box, nor without --purge.
    writeFileSync(units, "shipify-box-laptop.service enabled\n");
    expect(ship(sb, "box", "remove", "homepi", "--purge", "--yes").status).toBe("blocked");
    writeFileSync(units, "");
    expect(ship(sb, "box", "remove", "homepi", "--yes").summary).toContain("No box called homepi");
  });

  it("shows the sandbox in its plan before anything happens", () => {
    const { sb, log } = machine(0);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2");
    expect(r.status).toBe("requires-approval");
    const plan = (r.plannedActions ?? []).join("\n");
    expect(plan).toContain("shipify-agent-1, shipify-agent-2");
    expect(plan).toContain("/etc/sudoers.d/shipify-agents");
    expect(plan).toContain('the label "sandbox"');
    expect(plan).toContain("swap in memory (zram, ADR 0061)");
    expect(plan).toContain("shellcheck, fd, sqlite3");
    expect(plan).toContain(
      "automatic updates never restart a slot mid-task (needrestart), and the box never sleeps",
    );
    expect(plan).toContain(
      "containers for each slot's agent (ADR 0064): rootless Podman, with docker and docker compose",
    );
    expect(plan).toContain("no Docker Engine, no docker group and no root socket");
    expect(log()).not.toContain("sudo bash");
  });

  it("gives a new box the slots its memory and cores fit, and a box that has slots keeps them", () => {
    const fresh = (probe: string) => {
      const { sb } = machine(0, probe);
      return (ship(sb, "box", "add", "newpi", "--name", "newpi").plannedActions ?? []).join("\n");
    };
    expect(fresh(pi)).toContain("runs 3 slot(s) (what its 7.6 GB of memory fits)");
    expect(fresh("x86_64\\nubuntu 24.04\\nvps\\n3900000\\n")).toContain("runs 1 slot(s) (what its");
    // A laptop is a box like any other: its cores and memory decide.
    expect(fresh("x86_64\\nubuntu 24.04\\nlaptop\\n32600000\\nmax\\n8\\n")).toContain(
      "runs 8 slot(s) (what its 31.1 GB of memory and 8 cores fit)",
    );
    expect(fresh("x86_64\\nubuntu 24.04\\nlaptop\\n32600000\\nmax\\n2\\n")).toContain(
      "runs 2 slot(s) (what its 31.1 GB of memory and 2 cores fit)",
    );
    const { sb } = machine(0);
    const kept = (ship(sb, "box", "add", "homepi").plannedActions ?? []).join("\n");
    expect(kept).toContain("runs 2 slot(s), one task");
  });

  it("takes more slots than its memory or cores suggest, with a warning, up to setup's 9 (ADR 0061)", () => {
    const plan = (
      slots: string,
      probe = "aarch64\\nubuntu 24.04\\nnewpi\\n7969000\\nmax\\n4\\n",
    ) => {
      const { sb } = machine(0, probe);
      return ship(sb, "box", "add", "newpi", "--name", "newpi", "--slots", slots);
    };
    const six = plan("6");
    expect(six.status).toBe("requires-approval");
    const said = (six.plannedActions ?? []).join("\n");
    expect(said).toContain("runs 6 slot(s)");
    expect(said).toContain(
      "6 slots on 7.6 GB and 4 cores: more than it suggests (3), so tasks whose checks overlap get slower",
    );
    // At or under what it suggests, no warning; on a big box, up to 9, which setup.sh takes.
    expect((plan("3").plannedActions ?? []).join("\n")).not.toContain("more than it suggests");
    const big = plan("9", "x86_64\\nubuntu 24.04\\nnewpi\\n67000000\\nmax\\n16\\n");
    const bigSaid = (big.plannedActions ?? []).join("\n");
    expect(bigSaid).toContain("runs 9 slot(s)");
    expect(bigSaid).not.toContain("more than it suggests");
    // Refused before anything happens: no token is asked for slots setup.sh would refuse.
    expect(plan("0").summary).toContain("--slots is a whole number from 1 to 9");
    expect(plan("12").summary).toContain("--slots is a whole number from 1 to 9");
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
    expect(said).toContain("this PC's power settings stay as they are");
    expect(said).toContain('the label "sandbox"');
    expect(plan.nextSteps).toEqual(["pnpm ship box add --slots 2 --yes"]);
    const r = ship(sb, "box", "add", "--slots", "2", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    expect(r.summary).toContain('this PC is the box "homepi"');
    const calls = log();
    expect(calls).not.toMatch(/^ssh /m);
    expect(calls).toContain(
      "sudo bash /tmp/tmp.Ab12/setup.sh /tmp/tmp.Ab12/box.env /tmp/tmp.Ab12/prep.tsv /tmp/tmp.Ab12/box.service /tmp/tmp.Ab12/update.sh",
    );
    expect(calls).toContain("bash -c rm -rf /tmp/tmp.Ab12");
    expect(calls).not.toContain("reg-token-never-shown");
    expect(readFileSync(join(got, "box.env"), "utf8")).toContain("SHIPIFY_HERE=1");
  });

  it("on this PC: needs systemd on, before anything happens", () => {
    const off = machine(0, pi, false);
    expect(ship(off.sb, "box", "add", "--yes").summary).toContain("systemd isn't running");
    expect(off.log()).not.toContain("registration-token");
  });

  it("on this machine with --manage: a box you keep, as over SSH, its SSH by key too", () => {
    const { sb, got } = machine(0);
    const plan = ship(sb, "box", "add", "--manage");
    expect(plan.status).toBe("requires-approval");
    const said = (plan.plannedActions ?? []).join("\n");
    // Never sleeps, Tailscale, Cockpit and the firewall, the same as a box over SSH.
    expect(said).toContain("and the box never sleeps: the lid does nothing, and sleep is off");
    expect(said).not.toContain("power settings stay as they are");
    expect(said).toContain("--manage, last, once the sandbox checks out: Tailscale");
    expect(said).toContain("--manage: the firewall");
    // A box you keep: SSH by key, once your account has one (setup.sh checks it), as over SSH.
    expect(said).toContain(
      "SSH takes keys only (no passwords, no root), once your account there has a key",
    );
    expect(said).not.toContain("SSH settings stay as they are");
    expect(said).not.toContain("no --manage, so no firewall");
    expect(plan.nextSteps).toEqual(["pnpm ship box add --manage --yes"]);
    const r = ship(sb, "box", "add", "--manage", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    const env = readFileSync(join(got, "box.env"), "utf8");
    expect(env).toContain("SHIPIFY_HERE=1");
    expect(env).toContain("SHIPIFY_MANAGE=1");
  });

  it("on WSL, takes no --manage: Windows runs that machine", () => {
    const { sb, log } = machine(0, pi, true, "true", true);
    const r = ship(sb, "box", "add", "--manage", "--yes");
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("--manage isn't for WSL");
    expect(log()).not.toContain("registration-token");
    expect(log()).not.toContain("sudo bash");
  });

  it("with --manage over SSH: Cockpit's address before the setup, and the way in over Tailscale after (setup 13)", () => {
    const ts = '{"Self":{"DNSName":"homepi.tail1.ts.net."}}';
    const { sb, log } = machine(0, pi, true, "true", false, "online", ts);
    const r = ship(sb, "box", "add", "homepi", "--slots", "2", "--manage", "--yes");
    expect(r.status, r.summary).toBe("succeeded");
    const calls = log();
    // Asked once, before the setup: after it, the firewall takes no SSH from the home network.
    expect(calls.match(/tailscale status/g)).toHaveLength(1);
    expect(calls.indexOf("tailscale status")).toBeLessThan(calls.indexOf("sudo bash"));
    expect(calls).toMatch(
      /gh variable set \S+ -R \S+ --body \{"homepi":"https:\/\/homepi\.tail1\.ts\.net"\}/,
    );
    expect(r.nextSteps).toContain(
      "from now on, reach it over Tailscale only: in ~/.ssh/config, its HostName is homepi.tail1.ts.net",
    );
    expect(r.nextSteps?.join("\n")).not.toContain("Disable key expiry");
    // Its key expires (Tailscale's default): said from the same answer, with where to turn it off.
    const self = { DNSName: "homepi.tail1.ts.net.", HostName: "homepi", KeyExpiry: "2027-05-10Z" };
    const status = JSON.stringify({ BackendState: "Running", Self: self });
    const expiring = machine(0, pi, true, "true", false, "online", status);
    const said = ship(expiring.sb, "box", "add", "homepi", "--slots", "2", "--manage", "--yes");
    expect(expiring.log().match(/tailscale status/g)).toHaveLength(1);
    expect(said.nextSteps?.join("\n")).toContain(
      "Tailscale: it expires on 2027-05-10: then the box drops off your tailnet",
    );
    expect(said.nextSteps?.join("\n")).toContain("homepi → ⋯ → Disable key expiry");
    // Not on Tailscale before (a new box): asked again after, and said either way.
    const fresh = machine(0);
    const first = ship(fresh.sb, "box", "add", "homepi", "--slots", "2", "--manage", "--yes");
    expect(first.status, first.summary).toBe("succeeded");
    expect(fresh.log().match(/tailscale status/g)).toHaveLength(2);
    expect(first.nextSteps?.join("\n")).toContain(
      "its HostName is its Tailscale name (Cockpit's address above, without https://)",
    );
  });
});

describe("box/remove.sh: Shipify off a machine, the machine's own left (setup 9)", () => {
  const file = join(ROOT, "box", "remove.sh");
  const text = readFileSync(file, "utf8");
  const code = text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it("passes shellcheck where it's installed, and runs only as root", () => {
    const sc = spawnSync("shellcheck", [file], { encoding: "utf8" });
    if (!sc.error) expect(sc.stdout).toBe("");
    const r = spawnSync("bash", [file], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Run it with sudo.");
  });

  it("takes off what setup made for the box: services, users with their ranges, folders and rules", () => {
    for (const step of [
      'systemctl disable --now -q "$unit"',
      "systemctl disable --now -q shipify-agents-net.service",
      "nft delete table inet shipify_agents",
      "grep -E '^shipify(-agent-[0-9]+|-look)?$'",
      'pkill -KILL -u "$u"',
      'usermod --del-subuids 0-4294967294 --del-subgids 0-4294967294 "$u"',
      'userdel "$u"',
      "rm -rf /home/shipify /srv/shipify-agent-* /opt/shipify",
      "sed -i -e '/^shipify-agent-[0-9]*$/d' -e '/^shipify-look$/d' \"$deny\"",
      "/etc/sudoers.d/shipify-agents /etc/needrestart/conf.d/50-shipify-box.conf",
    ])
      expect(code, step).toContain(step);
    // An agent's ranges go before its user, its processes before both: its containers' too, which
    // only a kill as the agent reaches (they run as IDs of its range).
    expect(code.indexOf('sudo -u "$u" kill -KILL -1')).toBeLessThan(code.indexOf("pkill"));
    expect(code.indexOf("pkill")).toBeLessThan(code.indexOf("usermod --del-subuids"));
    expect(code.indexOf("usermod --del-subuids")).toBeLessThan(code.indexOf('userdel "$u"'));
    // Then it checks, and says what's left.
    expect(code).toContain("still here:");
  });

  it("leaves the machine's own alone: updates, SSH, zram, sleep, Tailscale, Cockpit, the firewall", () => {
    expect(code).not.toMatch(
      /ufw|tailscale|cockpit|zram|logind|sshd|unattended|apt-get|apt |flush ruleset|52shipify-updates/i,
    );
  });
});

describe("a box's OS and slots", () => {
  it("takes Ubuntu LTS from 24.04 on, and nothing else", () => {
    for (const os of ["ubuntu 24.04", "ubuntu 26.04"]) expect(isBoxOs(os), os).toBe(true);
    const others = ["ubuntu 22.04", "ubuntu 24.10", "ubuntu 25.04", "debian 12", "raspbian 12", ""];
    for (const os of others) expect(isBoxOs(os), os).toBe(false);
  });

  it("keeps 1 GB for the system and fits a slot per 2 GB, no more than the cores, 1 to 9", () => {
    const gib = (n: number) => n * 1024 * 1024;
    // Memory decides: 4 cores, or cores unknown (0).
    expect(slotsFor(gib(0.9), 4)).toBe(1);
    expect(slotsFor(gib(1.9), 4)).toBe(1);
    expect(slotsFor(gib(3.8), 4)).toBe(1);
    expect(slotsFor(gib(5.8), 4)).toBe(2);
    expect(slotsFor(gib(7.6), 4)).toBe(3); // a Pi 4 or 5, 8 GB
    expect(slotsFor(gib(7.6), 0)).toBe(3);
    expect(slotsFor(gib(15.6), 0)).toBe(7);
    // Cores decide: the same rule on a laptop, a spare PC or a VPS.
    expect(slotsFor(gib(11.6), 4)).toBe(4);
    expect(slotsFor(gib(31), 8)).toBe(8);
    expect(slotsFor(gib(31), 2)).toBe(2);
    expect(slotsFor(gib(31), 1)).toBe(1);
    // Never past 9, which setup.sh takes; memory unknown (0) leaves the cores to decide.
    expect(slotsFor(gib(62), 16)).toBe(9);
    expect(slotsFor(0, 6)).toBe(6);
    expect(slotsFor(0, 0)).toBe(9);
  });
});
