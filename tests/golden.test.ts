import { describe, expect, it } from "vitest";
import { sandbox, ship } from "./helpers.ts";

// Slow: installs dependencies and runs each generated project's full `make verify` (including
// Playwright for apps). Run with `pnpm test:golden`. Needs Chromium system libraries (docs/setup.md).
const combos: [string, string | null, boolean][] = [
  ["ts-worker", "blank", true],
  ["ts-worker", "tool", false],
  ["ts-static", "site", false],
  ["ts-static", "site", true],
  ["ts-package", null, false],
];

describe.runIf(process.env.GOLDEN)(
  "golden: every stack/preset/staging combination is green",
  () => {
    it.each(combos)(
      "%s + %s (staging %s)",
      (stack, preset, staging) => {
        const sb = sandbox();
        const args = [
          "new",
          `g-${stack}-${preset ?? "none"}-${staging ? "s" : "p"}`,
          "--stack",
          stack,
        ];
        if (preset) args.push("--preset", preset);
        if (staging) args.push("--staging");
        const r = ship(sb, ...args);
        expect(r.status, r.summary + JSON.stringify(r.checks, null, 1)).toBe("succeeded");
        // Templates are stored formatted: a fresh project matches its stack byte for byte.
        const up = ship(sb, "upgrade", args[1] as string);
        expect(up.status, JSON.stringify(up.plannedActions, null, 1)).toBe("skipped");
      },
      900_000,
    );
  },
);
