// A box's own setup update (box setup 14, cli/lib/box-update.ts): when the due run or the weekly
// clean-up asks root for it, with what, and what it says. The machine is stood in for (UpdateIo).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boxSetup,
  setupNote,
  UPDATER,
  type UpdateIo,
  updateBox,
  updaterWorks,
} from "../cli/lib/box-update.ts";
import { ROOT } from "./helpers.ts";

const SETUP = `#!/usr/bin/env bash
# Setup 13: with --manage, nothing comes in but through Tailscale: the SSH from the machine's own
# network is taken out.
# Setup 14: a box applies main's newer setup by itself. It keeps its settings
# (no keys).
# Running it again updates Node.
SETUP_VERSION=14
`;

/** A box whose record says `have`, with the repo's setup above, and an updater that answers. */
function box(
  have: string,
  answer: (record: (v: string) => void) => {
    code: number;
    out: string;
    timedOut?: boolean;
  } = () => ({
    code: 0,
    out: "",
  }),
  over: Partial<UpdateIo> = {},
) {
  const home = mkdtempSync(join(tmpdir(), "box-"));
  const script = join(home, "setup.sh");
  writeFileSync(script, SETUP);
  writeFileSync(join(home, ".shipify-setup"), have);
  const inputs: string[] = [];
  const io: UpdateIo = {
    user: "shipify",
    home,
    script,
    token: "ghs_readOnlyToken123",
    exists: (p) => p === script || p === UPDATER,
    works: () => true,
    busy: () => false,
    update(input) {
      inputs.push(input);
      return answer((v) => writeFileSync(join(home, ".shipify-setup"), v));
    },
    ...over,
  };
  return { io, inputs };
}

describe("a box's own setup update (box setup 14)", () => {
  it("asks root only on a box that's behind, has the updater, a token and no other slot's job", () => {
    for (const [have, over] of [
      ["13\n", { user: "someone" }],
      ["14\n", {}],
      ["13\n", { exists: () => false }],
      ["13\n", { token: undefined }],
      ["13\n", { busy: () => true }],
    ] as const) {
      const { io, inputs } = box(have, undefined, over);
      if (over.exists) io.exists = (p) => p === io.script;
      expect(updateBox("homepi", io)).toBeUndefined();
      expect(inputs).toEqual([]);
    }
  });

  it("hands the job's token over on stdin, and says what the box got, each version's note", () => {
    const { io, inputs } = box("12\n", (record) => {
      record("14\n");
      return { code: 0, out: "Done: this box has setup 14 (the setup's exit 0).\n" };
    });
    const u = updateBox("homepi", io);
    expect(inputs).toEqual(["ghs_readOnlyToken123\n"]);
    expect(u).toEqual({
      event: "homepi updated its own setup: 12 → 14",
      said: [
        "**homepi** updated its own setup, 12 → 14 (main's box/setup.sh), and its sandbox checked out.",
        "- Setup 14: a box applies main's newer setup by itself.",
        "- Setup 13: with --manage, nothing comes in but through Tailscale: the SSH from the machine's own network is taken out.",
      ].join("\n"),
      key: "setup-update:homepi:14",
      failed: false,
    });
  });

  it("says what's left when the setup finished all but --manage, or its containers", () => {
    const run = (exit: number, record: string) =>
      updateBox(
        "homepi",
        box("13\n", (write) => {
          write(record);
          return { code: 0, out: `Done: this box has setup 14 (the setup's exit ${exit}).\n` };
        }).io,
      )?.said.split("\n")[0];
    expect(run(4, "14\nmanage: not finished\n")).toBe(
      "**homepi** updated its own setup, 13 → 14 (main's box/setup.sh), and its sandbox checked out. Its --manage part didn't finish (Tailscale, the firewall or Cockpit): on the box, its here.sh command again.",
    );
    expect(run(3, "14\n")).toContain(`Its agents' containers don't work`);
    expect(run(0, "14\n")).toMatch(/its sandbox checked out\.$/);
  });

  it("says nothing when it's current already, not now, or still going past the job's wait", () => {
    for (const answer of [
      { code: 10, out: "Current" },
      { code: 75, out: "Not now: another slot runs a job." },
      { code: 1, out: "", timedOut: true },
    ])
      expect(updateBox("homepi", box("13\n", () => answer).io)).toBeUndefined();
  });

  it("says why it couldn't, once per version: the setup's ✗ lines, else its last words", () => {
    const sandbox = box("13\n", () => ({
      code: 1,
      out: [
        "Setup 13 → 14: main's, applied in the service shipify-setup-update",
        "== Checking the sandbox",
        "  ✗ shipify-agent-1 can read /home/shipify",
        "The sandbox isn't right (above), so no task runs here until it is; it's safe to run this again.",
        "Not updated: the setup stopped (exit 1, above), so this box keeps setup 13.",
      ].join("\n"),
    }));
    expect(updateBox("homepi", sandbox.io)).toMatchObject({
      event: "homepi couldn't update its own setup to 14",
      key: "setup-update-failed:homepi:14",
      failed: true,
    });
    expect(updateBox("homepi", sandbox.io)?.said).toBe(
      "**homepi** couldn't update its own setup to 14, so it keeps 13: ✗ shipify-agent-1 can read /home/shipify. It tries again by itself (a failed setup a day later); to do it now, when no task runs: on the box, its here.sh command again.",
    );
    const refused = box("13\n", () => ({ code: 1, out: "sudo: a password is required\n" }));
    expect(updateBox("homepi", refused.io)?.said).toContain(
      "so it keeps 13: sudo: a password is required.",
    );
  });

  it("never asks an updater from before setup 17, which refuses GitHub's tokens, and says so once with the fix", () => {
    for (const over of [{}, { busy: () => true }, { token: undefined }]) {
      const old = box("13\n", undefined, { works: () => false, ...over });
      expect(updateBox("homepi", old.io)).toEqual({
        event: "homepi can't update its own setup to 14: its updater refuses GitHub's new tokens",
        said: "**homepi** can't update its own setup to 14: its updater is from before setup 17, and refuses GitHub's new token format (since 2026-04-27), so it never will by itself. Once, when no task runs: on the box, its here.sh command again; from then on, it updates itself.",
        key: "setup-update-token:homepi",
        failed: true,
      });
      expect(old.inputs).toEqual([]);
    }
  });

  it("tells a working updater by what it is: setup 17's takes GitHub's stateless tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-"));
    const file = join(dir, "shipify-box-update");
    expect(updaterWorks(file)).toBe(false);
    writeFileSync(file, readFileSync(join(ROOT, "box", "update.sh"), "utf8"));
    expect(updaterWorks(file)).toBe(true);
    // Setup 14 to 16's: the token checked by a case pattern that refuses . and -.
    writeFileSync(
      file,
      `case "$token" in '' | *[!A-Za-z0-9_]*) echo "No read token on stdin."; exit 1 ;; esac\n`,
    );
    expect(updaterWorks(file)).toBe(false);
  });

  it("reads the box's setup beside the repo's, and each version's note from box/setup.sh", () => {
    const { io } = box("13\nmanage: not finished\n");
    expect(boxSetup(io.home, io.script)).toEqual({ have: 13, want: 14, unmanaged: true });
    expect(boxSetup(mkdtempSync(join(tmpdir(), "none-")), io.script).have).toBe(1);
    // The real script: every version from 13 on has a note, which ship pr holds a new one to.
    const real = join(ROOT, "box", "setup.sh");
    expect(setupNote(14, real)).toBe("a box applies main's newer setup by itself.");
    expect(setupNote(13, real)).toMatch(/^with --manage, nothing comes in but through Tailscale/);
    expect(setupNote(99, real)).toBeUndefined();
  });
});
