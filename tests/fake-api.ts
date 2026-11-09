// GitHub's REST API for a test, from the fake gh's state (tests/fixtures/fake-api.mjs): the reads
// Shipify makes with fetch (ghIfChanged) reach it through GITHUB_API_URL, never api.github.com.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

/** The fake API, started in a process of its own: `url(state)` is GITHUB_API_URL for that state. */
export async function fakeApi(): Promise<{ url: (state: string) => string; stop: () => void }> {
  const p = spawn(process.execPath, [join(ROOT, "tests/fixtures/fake-api.mjs")], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const port = await new Promise<string>((ok, no) => {
    p.stdout.once("data", (d) => ok(String(d).trim()));
    p.once("exit", () => no(new Error("the fake API didn't start")));
  });
  return {
    url: (state) => `http://127.0.0.1:${port}/${encodeURIComponent(state)}`,
    stop: () => p.kill(),
  };
}
