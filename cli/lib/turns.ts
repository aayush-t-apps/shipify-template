// The box's checks take turns (task #791): one at a time per 4 cores, across every slot of the box,
// so each check has the CPU to itself and none times out from the load of the others. A turn is a
// lock (flock) on one of the box's turn files, held by a small process of the runner's own: it ends
// when the check does, or when the runner's process does, so a run that dies never keeps a turn.
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { join } from "node:path";

/** How many checks a box runs at once: one per 4 cores, at least one. */
export const turnsFor = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 4));

/** How often a check that waits tries each turn again. */
const TRY_EVERY_SECONDS = 3;

/**
 * Holds the first turn file that's free, else tries them all again after a while. Without flock, it
 * ends at once: then the check runs with no turn, as before. $@: the turn files.
 */
const HOLD = [
  "command -v flock >/dev/null || exit 3",
  "while :; do",
  '  for f in "$@"; do',
  '    exec 9>>"$f" || exit 1',
  // The turn is this process's for as long as its input stays open: the runner closes it after the
  // check, and so does the runner's end.
  "    if flock -n 9; then echo turn; exec cat >/dev/null; fi",
  "  done",
  "  exec 9>&-",
  `  sleep ${TRY_EVERY_SECONDS}`,
  "done",
].join("\n");

export interface Turn {
  /** It has a turn. Without one (no flock, or the wait ran out), the check runs all the same. */
  got: boolean;
  waitedMs: number;
  /** The turn given back, for the next check. */
  release(): void;
}

/**
 * A turn for one of the box's checks: one of `turns` turn files in `dir`, the box's folder, which
 * its slots share. Waits at most `maxMs`, then goes on without one, so a run never outgrows its
 * clocks.
 */
export function takeTurn(dir: string, turns: number, maxMs: number, now = Date.now): Promise<Turn> {
  const began = now();
  const files = Array.from({ length: Math.max(1, turns) }, (_, i) =>
    join(dir, `.check-turn-${i + 1}`),
  );
  const child = spawn("sh", ["-c", HOLD, "turn", ...files], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const release = () => {
    child.stdin?.end();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  return new Promise((resolve) => {
    let said = "";
    let settled = false;
    const done = (got: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!got) release();
      resolve({ got, waitedMs: now() - began, release });
    };
    const timer = setTimeout(() => done(false), Math.max(0, maxMs));
    child.stdout?.on("data", (d: Buffer) => {
      said += d.toString();
      if (said.includes("turn")) done(true);
    });
    child.stdin?.on("error", () => {});
    child.on("error", () => done(false));
    child.on("exit", () => done(false));
  });
}
