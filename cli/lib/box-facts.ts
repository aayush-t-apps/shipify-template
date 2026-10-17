// What a box can say about itself, for a ping, `ship box health` and the agent: read-only, no
// sudo, the same on any Linux, and it skips what a machine lacks (a sensor on WSL, systemd in a
// container). Node's own modules only: `box health` sends this file to another machine's Node.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statfsSync, statSync } from "node:fs";
import { arch, cpus, freemem, loadavg, totalmem, uptime } from "node:os";

export interface Fact {
  name: string;
  value: string;
  /** Why this needs a look, when it does (the status issue says so, and comments). */
  look?: string;
}

/** Where facts come from: files, commands and when a file changed. Tests pass their own. */
export interface BoxIo {
  read: (file: string) => string | undefined;
  /** A command's output, even when it says no (`systemctl is-active`); undefined if it can't run. */
  exec: (cmd: string, args: string[]) => string | undefined;
  changed: (file: string) => Date | undefined;
}

const machine: BoxIo = {
  read: (f) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return undefined;
    }
  },
  exec: (cmd, args) => {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    });
    return r.error ? undefined : r.stdout;
  },
  changed: (f) => (existsSync(f) ? statSync(f).mtime : undefined),
};

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const when = (t: Date) =>
  t.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** A Raspberry Pi's firmware flags: bits 0-3 are now, the same from bit 16 since boot. */
const THROTTLED = "/sys/devices/platform/soc/soc:firmware/get_throttled";
const THROTTLE_BITS = ["under-voltage", "frequency capped", "throttled", "soft temperature limit"];

/**
 * The system, uptime, load, memory and swap, disk, temperature and throttling (where the board has
 * them), a pending restart, waiting updates, the box's services, and its slots' memory.
 */
export function boxFacts(given: Partial<BoxIo> = {}, now = Date.now()): Fact[] {
  const { read, exec, changed } = { ...machine, ...given };
  const cores = cpus().length;
  const system = read("/etc/os-release")?.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? "Linux";
  // MemAvailable, not MemFree: what's really free for new work, counting reclaimable cache.
  const meminfo = read("/proc/meminfo");
  const available = Number(meminfo?.match(/^MemAvailable:\s+(\d+) kB/m)?.[1]) * 1024;
  const total = Number(meminfo?.match(/^MemTotal:\s+(\d+) kB/m)?.[1]) * 1024 || totalmem();
  // Its swap (ADR 0061): zram that box add turns on, a file of its own, or none.
  const swaps = (read("/proc/swaps") ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length >= 4)
    .map(([name = "", type = "", size = "0", used = "0"]) => {
      const kind = name.startsWith("/dev/zram") ? "zram" : type === "file" ? "a file" : name;
      return `${kind} ${gb(Number(size) * 1024)} (${gb(Number(used) * 1024)} used)`;
    });
  const facts: Fact[] = [
    { name: "system", value: `${system}, ${arch()}, ${cores} cores, Node ${process.version}` },
  ];
  const board = read("/proc/device-tree/model")?.replace(/\0/g, "").trim();
  if (board) facts.push({ name: "board", value: board });
  facts.push(
    { name: "up", value: duration(uptime()) },
    {
      name: "load",
      value: `${loadavg()
        .map((n) => n.toFixed(2))
        .join(" ")} (1, 5, 15 min; ${cores} cores)`,
    },
    {
      name: "memory",
      value: `${gb(Number.isFinite(available) && available > 0 ? available : freemem())} free of ${gb(total)}; swap: ${swaps.join(", ") || "none"}`,
    },
  );
  try {
    const s = statfsSync("/");
    const used = (s.blocks - s.bfree) * s.bsize;
    const free = s.bavail * s.bsize;
    const pct = Math.round((used / (used + free)) * 100);
    facts.push({
      name: "disk",
      value: `${gb(free)} free of ${gb(s.blocks * s.bsize)} (${pct}% used)`,
      look: pct >= 90 ? `the disk is ${pct}% full` : undefined,
    });
  } catch {
    // No statfs here: leave the disk out rather than guess.
  }
  const temp = Number(read("/sys/class/thermal/thermal_zone0/temp"));
  if (Number.isFinite(temp) && temp > 0)
    facts.push({
      name: "temperature",
      value: `${(temp / 1000).toFixed(1)} °C`,
      look: temp >= 80_000 ? `it's running hot, ${(temp / 1000).toFixed(1)} °C` : undefined,
    });
  const throttled = read(THROTTLED);
  if (throttled !== undefined) {
    const bits = Number.parseInt(throttled.trim(), 16);
    const current = THROTTLE_BITS.filter((_, i) => bits & (1 << i));
    const before = THROTTLE_BITS.filter((_, i) => bits & (1 << (16 + i)));
    facts.push({
      name: "throttling",
      value: current.length
        ? `now: ${current.join(", ")}`
        : before.length
          ? `not now; since boot: ${before.join(", ")}`
          : "none since boot",
      look: current.length ? `it's throttled now: ${current.join(", ")}` : undefined,
    });
  }
  const since = changed("/run/reboot-required");
  if (since) {
    const pkgs = [...new Set(read("/run/reboot-required.pkgs")?.split("\n").filter(Boolean))];
    // box add sets one (box/setup.sh).
    const at = read("/etc/apt/apt.conf.d/52shipify-updates")?.match(
      /Automatic-Reboot-Time\s+"([^"]+)"/,
    )?.[1];
    facts.push({
      name: "restart",
      value: `needed since ${when(since)}${pkgs.length ? ` (${pkgs.join(", ")})` : ""}${at ? `; it restarts by itself at ${at}` : ""}`,
      // A day and a bit: the nightly restart should have happened by then.
      look:
        now - since.getTime() > 30 * 3_600_000
          ? `a restart has waited since ${when(since)}${at ? `: the ${at} restart didn't happen` : ""}`
          : undefined,
    });
  } else facts.push({ name: "restart", value: "not needed" });
  const apt = exec("apt", ["list", "--upgradable"]);
  if (apt !== undefined) {
    const waiting = apt.split("\n").filter((l) => l.includes("[upgradable from"));
    const security = waiting.filter((l) => l.includes("-security")).length;
    const names = waiting.map((l) => l.split("/")[0]);
    facts.push({
      name: "updates",
      value: waiting.length
        ? `${waiting.length} waiting${security ? ` (${security} security)` : ""}: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}`
        : "none waiting",
    });
  }
  if (exec("systemctl", ["--version"]) !== undefined) {
    // The box's own services, a system one (a Pi, a VPS) or a user one (this PC), stopped too.
    const states: string[] = [];
    const failed: string[] = [];
    const peaks: { slot: string; peak: number; kills: number }[] = [];
    for (const scope of [[], ["--user"]]) {
      const ctl = (...args: string[]) => exec("systemctl", [...scope, ...args]) ?? "";
      const first = (out: string) =>
        out
          .split("\n")
          .map((l) => l.trim().split(/\s+/)[0])
          .filter((u): u is string => Boolean(u));
      const units = first(
        ctl(
          "list-unit-files",
          "--no-legend",
          "shipify-box-*",
          "tailscaled.service",
          "cockpit.socket",
        ),
      );
      for (const u of units) {
        states.push(`${u.replace(/\.service$/, "")} ${ctl("is-active", u).trim()}`);
        // A slot's memory (ADR 0061): the most it has used since it started, and its OOM kills.
        const slot = /^shipify-box-(.+)\.service$/.exec(u)?.[1];
        const group = slot && ctl("show", "-p", "ControlGroup", "--value", u).trim();
        const peak = group ? Number(read(`/sys/fs/cgroup${group}/memory.peak`)) : Number.NaN;
        if (slot && peak > 0) {
          const events = read(`/sys/fs/cgroup${group}/memory.events`) ?? "";
          peaks.push({ slot, peak, kills: Number(/^oom_kill (\d+)$/m.exec(events)?.[1] ?? 0) });
        }
      }
      failed.push(...first(ctl("list-units", "--failed", "--no-legend", "--plain")));
    }
    const stopped = states.filter((x) => /^shipify-/.test(x) && !/ active$/.test(x));
    facts.push({
      name: "services",
      value: [...states, failed.length ? `failed: ${failed.join(", ")}` : "nothing failed"].join(
        ", ",
      ),
      look:
        failed.length || stopped.length
          ? [
              ...(failed.length ? [`failed: ${failed.join(", ")}`] : []),
              ...(stopped.length ? [`not running: ${stopped.join(", ")}`] : []),
            ].join("; ")
          : undefined,
    });
    if (peaks.length) {
      const killed = peaks.filter((p) => p.kills > 0);
      facts.push({
        name: "slots",
        value: [
          `at most since each started: ${peaks.map((p) => `${p.slot} ${gb(p.peak)}`).join(", ")}`,
          ...killed.map((p) => `${p.slot} had ${p.kills} killed for memory`),
        ].join("; "),
        look: killed.length
          ? `${killed.map((p) => p.slot).join(", ")} had a task killed for memory: fewer slots, or swap (pnpm ship box add again turns it on)`
          : undefined,
      });
    }
  }
  return facts;
}

/** Facts as lines for a terminal: "disk         45.2 GB free of 56.0 GB (9% used)". */
export const factLines = (facts: Fact[]) =>
  facts.map((f) => `${f.name.padEnd(12)} ${f.value}`).join("\n");
