// Every test file starts outside any job (vitest.config.ts's setupFiles): nothing a CI job or a
// box's task run sets reaches a test in this process either, so `pnpm verify` gives the same result
// on this PC, in CI and inside a task (a release's own check runs there, ADR 0047).

/**
 * Everything a CI job or a box's task run sets: its identity (GitHub's GITHUB_*, RUNNER_* and
 * ACTIONS_*), Shipify's own settings (SHIPIFY_*, APPS_DOMAIN), Cloudflare's (CLOUDFLARE_*, CF_*:
 * your copy's deploy values, which a task's agent gets for its own `ship build`), and keys. Tests
 * run the same on this PC, in CI and inside a task: a job's run id once made a test pass here and
 * fail in CI. A test that needs one of these sets it.
 */
export const JOB_ENV =
  /^(GITHUB_|RUNNER_|ACTIONS_|SHIPIFY_|TELEGRAM_|DOOR_|CLOUDFLARE_|CF_)|^(APPS_DOMAIN|GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)$/;

for (const name of Object.keys(process.env)) if (JOB_ENV.test(name)) delete process.env[name];
// Tests that run Shipify in-process never read this PC's credentials file.
process.env.SHIPIFY_CREDENTIALS = "/nonexistent/shipify-credentials.env";
