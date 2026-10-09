import { defineConfig } from "vitest/config";

// Unit tests cover logic: the Worker, shared code and src/web/lib. UI components are covered by
// Playwright in tests/e2e. The coverage floor is set by the platform and may only be raised.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      exclude: ["src/worker/index.ts", "src/shared/health.ts"],
      include: ["src/worker/**/*.ts", "src/shared/**/*.ts", "src/web/lib/**/*.ts"],
      thresholds: { lines: {{COVERAGE_FLOOR}}, branches: {{COVERAGE_FLOOR}}, functions: {{COVERAGE_FLOOR}}, statements: {{COVERAGE_FLOOR}} },
    },
  },
});
