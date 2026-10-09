import { defineConfig } from "vitest/config";

// Platform-owned. The coverage floor is set by Shipify and may only be raised.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: {{COVERAGE_FLOOR}}, branches: {{COVERAGE_FLOOR}}, functions: {{COVERAGE_FLOOR}}, statements: {{COVERAGE_FLOOR}} },
    },
  },
});
