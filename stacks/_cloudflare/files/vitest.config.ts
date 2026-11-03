import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// Unit tests cover logic: the Worker, shared code and src/web/lib. UI components are covered by
// Playwright in tests/e2e. The coverage floor is set by the platform and may only be raised.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Half the cores, never under two: on a small box the default leaves nothing for the
    // runner or the agent. The same cap Shipify's own config has.
    maxWorkers: Math.max(2, Math.floor(availableParallelism() / 2)),
    coverage: {
      provider: "v8",
      // #if !OPTION_DO
      exclude: ["src/worker/index.ts", "src/shared/health.ts"],
      // #endif
      // #if OPTION_DO
      // Durable Objects run in workerd (tests/unit/support/worker.ts), where Node can't count them:
      // logic that needs branch tests goes in plain modules beside them.
      exclude: ["src/worker/index.ts", "src/shared/health.ts", "src/worker/objects/**"],
      // #endif
      include: ["src/worker/**/*.ts", "src/shared/**/*.ts", "src/web/lib/**/*.ts"],
      thresholds: { lines: {{COVERAGE_FLOOR}}, branches: {{COVERAGE_FLOOR}}, functions: {{COVERAGE_FLOOR}}, statements: {{COVERAGE_FLOOR}} },
    },
  },
});
