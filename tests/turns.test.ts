// The box's checks take turns (task #791): one per 4 cores, across the box's slots, through flock.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { takeTurn, turnsFor } from "../cli/lib/turns.ts";
import { ROOT } from "./helpers.ts";

/** flock is on every Linux box (util-linux); a Mac has none, so these wait for a box or CI. */
const flock = spawnSync("sh", ["-c", "command -v flock"]).status === 0;

describe("the box's checks take turns (task #791)", () => {
  it("one at a time per 4 cores, at least one", () => {
    expect(turnsFor(1)).toBe(1);
    expect(turnsFor(4)).toBe(1);
    expect(turnsFor(7)).toBe(1);
    expect(turnsFor(8)).toBe(2);
    expect(turnsFor(16)).toBe(4);
  });

  it.runIf(flock)(
    "a second check waits for the first's turn, and gets it once it's given back",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "turns-"));
      const first = await takeTurn(dir, 1, 60_000);
      expect(first.got).toBe(true);
      let second: Awaited<ReturnType<typeof takeTurn>> | undefined;
      const waiting = takeTurn(dir, 1, 60_000).then((t) => {
        second = t;
        return t;
      });
      await new Promise((r) => setTimeout(r, 1_000));
      expect(second).toBeUndefined();
      first.release();
      const t = await waiting;
      expect(t.got).toBe(true);
      expect(t.waitedMs).toBeGreaterThanOrEqual(1_000);
      t.release();
    },
    20_000,
  );

  it.runIf(flock)("a box with two turns runs two checks at once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "turns-"));
    const [a, b] = await Promise.all([takeTurn(dir, 2, 60_000), takeTurn(dir, 2, 60_000)]);
    expect([a.got, b.got]).toEqual([true, true]);
    expect(Math.max(a.waitedMs, b.waitedMs)).toBeLessThan(2_000);
    a.release();
    b.release();
  });

  it.runIf(flock)(
    "a wait that runs out goes on without a turn, so a run never outgrows its clocks",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "turns-"));
      const held = await takeTurn(dir, 1, 60_000);
      const late = await takeTurn(dir, 1, 500);
      expect(late.got).toBe(false);
      expect(late.waitedMs).toBeLessThan(5_000);
      held.release();
      // Given back: the next check has it at once.
      const next = await takeTurn(dir, 1, 60_000);
      expect(next.got).toBe(true);
      next.release();
    },
    20_000,
  );

  it.runIf(flock)(
    "a turn its holder never gave back ends with the holder's process",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "turns-"));
      // Another process takes the turn and exits without giving it back, as a run that died would.
      const script = `import("${join(ROOT, "cli/lib/turns.ts")}").then(async (m) => { const t = await m.takeTurn(process.argv[1], 1, 10000); console.log(t.got); process.exit(0); });`;
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", script, dir], {
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(r.stdout.trim()).toBe("true");
      return takeTurn(dir, 1, 5_000).then((t) => {
        expect(t.got).toBe(true);
        t.release();
      });
    },
    20_000,
  );
});
