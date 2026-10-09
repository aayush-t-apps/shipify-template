import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // Tests that run Shipify in-process never read this PC's credentials file.
    env: { SHIPIFY_CREDENTIALS: "/nonexistent/shipify-credentials.env", APPS_DOMAIN: "" },
  },
});
