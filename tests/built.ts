// The CLI built once for a test run (vitest.config.ts's globalSetup), as a box builds it (ADR 0051
// B1): `ship()` (tests/helpers.ts) and the flow test's whole runs start it, 0.7 s a start on a
// Raspberry Pi against the source's 2.2 s through tsx. An edit needs no build of yours: each test
// run makes it from the source as it is. And one temp folder for the run, every test's under it,
// removed after it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** Its own name in cli/dist (two folders down, so PLATFORM_ROOT holds), never the box's ship.mjs. */
export const BUILT = join(ROOT, "cli", "dist", "test-ship.mjs");

export default function setup() {
  // The run's temp folder: the test files' workers start after this, with TMPDIR set, so each
  // mkdtemp (a sandbox, a clone, a fake's state) lands in it, and none is left on the disk.
  const temp = mkdtempSync(join(tmpdir(), "shipify-tests-"));
  process.env.TMPDIR = temp;
  // Built aside, then moved in whole: a test run started at the same time never reads half a file.
  const aside = `${BUILT}.${process.pid}`;
  execFileSync(process.execPath, [join(ROOT, "scripts", "build-cli.mjs"), "--out", aside], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
  renameSync(aside, BUILT);
  return () => rmSync(temp, { recursive: true, force: true });
}
