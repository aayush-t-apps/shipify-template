import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// Platform-owned. The coverage floor is set by Shipify and may only be raised.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // Half the cores, never under two: on a small box the default leaves nothing for the
    // runner or the agent. The same cap Shipify's own config has.
    maxWorkers: Math.max(2, Math.floor(availableParallelism() / 2)),
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: {{COVERAGE_FLOOR}}, branches: {{COVERAGE_FLOOR}}, functions: {{COVERAGE_FLOOR}}, statements: {{COVERAGE_FLOOR}} },
    },
  },
});
