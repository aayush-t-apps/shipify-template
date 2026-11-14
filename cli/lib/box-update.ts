// The box's own setup update (box setup 14, box/update.sh, docs/box-setup.md): when main's
// box/setup.sh is newer than this box's and no other slot runs a job, the due run and the weekly
// clean-up ask root to apply it, through the one command the runner may run as root. Root downloads
// that setup from GitHub itself, with this job's read token on stdin: the job says "now", never
// what runs. How it went goes on the status task, and to your chats.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { PLATFORM_ROOT } from "./config.ts";

/** The box's own update, root's own: box/setup.sh installs box/update.sh there. */
export const UPDATER = "/usr/local/sbin/shipify-box-update";

/**
 * Whether this box's updater can update it (box setup 17 on). GitHub's installation tokens are
 * stateless since 2026-04-27 (ghs_<app ID>_<a JWT>, with . and -), and setup 14 to 16's updater
 * refuses them as no token at all. Read from the updater itself (root's, readable by all), not the
 * box's recorded setup: a setup that stopped at its sandbox check installed its updater already.
 */
export function updaterWorks(updater = UPDATER): boolean {
  try {
    return /^token_ok\(\) \{$/m.test(readFileSync(updater, "utf8"));
  } catch {
    return false;
  }
}

/** box/update.sh's exits: updated, current already, and not now (it's tried again later). */
const UPDATED = 0;
const CURRENT = 10;
const NOT_NOW = 75;

/** Where box/setup.sh is, in this copy of Shipify. */
const SETUP_SH = () => join(PLATFORM_ROOT, "box", "setup.sh");

export interface BoxSetup {
  /** The setup this box has (box/setup.sh's record in the runner's home); 1 from before versions. */
  have: number;
  /** The repo's: box/setup.sh's SETUP_VERSION. */
  want: number;
  /** A `--manage` setup that stopped before its end (box setup 13). */
  unmanaged: boolean;
}

/** This box's setup beside the repo's (ADR 0017). */
export function boxSetup(home = homedir(), script = SETUP_SH()): BoxSetup {
  const want = Number(/^SETUP_VERSION=(\d+)$/m.exec(readFileSync(script, "utf8"))?.[1] ?? 1);
  const file = join(home, ".shipify-setup");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const have = Number(/^\d+/.exec(text)?.[0] ?? 0) || 1;
  return { have, want, unmanaged: /^manage: not finished$/m.test(text) };
}

/**
 * What a setup version gives boxes: the first sentence of its "Setup N:" note in box/setup.sh's
 * header, which `ship pr` holds every new version to.
 */
export function setupNote(n: number, script = SETUP_SH()): string | undefined {
  const lines = readFileSync(script, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`# Setup ${n}: `));
  if (start < 0) return undefined;
  const note: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith("#") || (note.length && /^# Setup \d+: /.test(line))) break;
    note.push(line.replace(/^#\s?/, ""));
  }
  const text = note.join(" ").replace(/^Setup \d+: /, "");
  const first = /^.*?\.(?=\s|$)/.exec(text)?.[0] ?? text;
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

/**
 * Whether another of this box's slots is running a job (the runner's Worker processes; this job's
 * own is one). When it can't tell, it says busy: what waits for a quiet box waits for the next time.
 */
export function otherSlotBusy(): boolean {
  const r = spawnSync(
    "pgrep",
    ["-u", String(process.getuid?.() ?? ""), "-fc", "bin/Runner.Worker"],
    {
      encoding: "utf8",
    },
  );
  if (r.error || (r.status !== 0 && r.status !== 1)) return true;
  return Number(r.stdout?.trim() || 0) > 1;
}

/** What the update needs of the machine, so a test can stand in for it. */
export interface UpdateIo {
  user: string;
  home: string;
  script: string;
  /** This job's read token for the repo (GH_TOKEN), which root uses for its one download. */
  token?: string;
  exists(path: string): boolean;
  /** The updater takes GitHub's tokens (updaterWorks). */
  works(): boolean;
  busy(): boolean;
  /** `sudo -n` the updater with this on stdin: its exit, its words, and whether it ran out of time. */
  update(input: string): { code: number; out: string; timedOut?: boolean };
}

const REAL_IO = (): UpdateIo => ({
  user: userInfo().username,
  home: homedir(),
  script: SETUP_SH(),
  token: process.env.GH_TOKEN,
  exists: existsSync,
  works: () => updaterWorks(),
  busy: otherSlotBusy,
  update(input) {
    const r = spawnSync("sudo", ["-n", UPDATER], {
      input,
      encoding: "utf8",
      // The setup takes minutes; past this, the job goes on, and the setup too, in its own service.
      timeout: 12 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    // The whole setup, in this job's log.
    process.stderr.write(out);
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    return { code: r.status ?? 1, out, timedOut };
  },
});

export interface Updated {
  /** For the status task's events: one line. */
  event: string;
  /** For your chats. */
  said: string;
  /** Said once: a key for the status task's `alerted`. */
  key: string;
  failed: boolean;
}

/**
 * This box's own update, when it's due: on a box (the runner's user) whose setup is older than the
 * repo's, with an updater that works (setup 17 on), while no other slot runs a job. Nothing when
 * there's nothing to say: not a box, current, not now (tried again at the next due run). A box set
 * up before setup 14 has no updater: doctor says to run its setup once more. One from setup 14 to
 * 16 has an updater that refuses GitHub's tokens: never asked, and said once, with the fix.
 */
export function updateBox(box: string, io: UpdateIo = REAL_IO()): Updated | undefined {
  if (io.user !== "shipify" || !io.exists(io.script)) return undefined;
  const before = boxSetup(io.home, io.script);
  if (before.have >= before.want || !io.exists(UPDATER)) return undefined;
  if (!io.works())
    return {
      event: `${box} can't update its own setup to ${before.want}: its updater refuses GitHub's new tokens`,
      said: `**${box}** can't update its own setup to ${before.want}: its updater is from before setup 17, and refuses GitHub's new token format (since 2026-04-27), so it never will by itself. Once, when no task runs: on the box, its here.sh command again; from then on, it updates itself.`,
      key: `setup-update-token:${box}`,
      failed: true,
    };
  if (!io.token || io.busy()) return undefined;
  const r = io.update(`${io.token}\n`);
  if (r.timedOut || r.code === CURRENT || r.code === NOT_NOW) return undefined;
  const after = boxSetup(io.home, io.script);
  if (r.code === UPDATED && after.have > before.have) {
    const notes = Array.from({ length: after.have - before.have }, (_, i) => after.have - i)
      .map((n) => ({ n, note: setupNote(n, io.script) }))
      .filter((x) => x.note)
      .map((x) => `- Setup ${x.n}: ${x.note}`);
    // Done, but not all of it: the setup's exit 4 (--manage stopped) or 3 (no containers).
    const exit = Number(/the setup's exit (\d+)/.exec(r.out)?.[1] ?? 0);
    const left =
      exit === 4 || after.unmanaged
        ? " Its --manage part didn't finish (Tailscale, the firewall or Cockpit): on the box, its here.sh command again."
        : exit === 3
          ? ` Its agents' containers don't work: docs/troubleshooting.md, "Containers don't start".`
          : "";
    return {
      event: `${box} updated its own setup: ${before.have} → ${after.have}`,
      said: [
        `**${box}** updated its own setup, ${before.have} → ${after.have} (main's box/setup.sh), and its sandbox checked out.${left}`,
        ...notes,
      ].join("\n"),
      key: `setup-update:${box}:${after.have}`,
      failed: false,
    };
  }
  // Why: the setup's ✗ lines, else the last line before the updater's own last words.
  const lines = r.out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(Not updated:|Setup \d+ → \d+:)/.test(l));
  const marks = lines.filter((l) => l.startsWith("✗")).slice(-3);
  const why = (marks.length ? marks : lines.slice(-1)).join("; ").slice(0, 600);
  return {
    event: `${box} couldn't update its own setup to ${before.want}`,
    said: `**${box}** couldn't update its own setup to ${before.want}, so it keeps ${before.have}: ${why || `exit ${r.code}`}. It tries again by itself (a failed setup a day later); to do it now, when no task runs: on the box, its here.sh command again.`,
    key: `setup-update-failed:${box}:${before.want}`,
    failed: true,
  };
}
