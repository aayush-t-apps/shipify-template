import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // Half the cores, never under two: the suite spawns tool servers and fakes, and on a small box
    // (a Raspberry Pi's four cores) the default leaves nothing for the runner or the agent.
    maxWorkers: Math.max(2, Math.floor(availableParallelism() / 2)),
    // Outside any job, and never this PC's credentials file (tests/env.ts).
    setupFiles: ["tests/env.ts"],
  },
});
