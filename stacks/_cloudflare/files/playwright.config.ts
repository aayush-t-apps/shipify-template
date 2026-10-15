import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Local: builds and serves the app with `wrangler dev`, exactly like production, on ports of this
// checkout's own (from its path, or E2E_PORT), so parallel checkouts never test each other's server
// or fight over wrangler's debugger port.
// CI against a deployed URL: set E2E_BASE_URL and no local server starts.
const remote = process.env.E2E_BASE_URL;
const hash = createHash("sha1").update(process.cwd()).digest().readUInt16BE(0);
const port = Number(process.env.E2E_PORT) || 8800 + (hash % 1000);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: remote ?? `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: remote
    ? undefined
    : {
        // A D1 app's local database gets its migrations first (cloudflare.mjs local).
        command: `node scripts/shipify/cloudflare.mjs local && wrangler dev --port ${port} --inspector-port ${port + 1000} --var APP_ENV:local`,
        url: `http://localhost:${port}/health`,
        // Never test a server something else started: a busy port is an error, not a reuse.
        reuseExistingServer: false,
        env: { WRANGLER_SEND_METRICS: "false" },
      },
});
