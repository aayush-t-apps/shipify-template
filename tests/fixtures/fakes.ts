// The fakes a ship process talks to, from its tests: the fixtures' servers (fake-door.mjs,
// fake-telegram.mjs), each in a process of its own (a setup step or a send runs synchronously, so it
// can't share the test's), and the fake gh (fake-gh.mjs) on a PATH of its own.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
/** How long a hook that starts a server may take: the server's 20 s, and some. */
export const SERVE_TIMEOUT = 30_000;

export interface Served {
  url: string;
  /** Its folder: what it was handed (calls.jsonl, sent.jsonl), and the flag files that steer it. */
  dir: string;
  stop: () => void;
}

/**
 * A fake server: it writes its port to <dir>/port. A busy machine can take a while to start it, so
 * this waits up to 20 s, and says which server didn't start rather than failing later on no file.
 */
export async function serve(fixture: string, env: Record<string, string> = {}): Promise<Served> {
  const dir = mkdtempSync(join(tmpdir(), "fake-"));
  const p: ChildProcess = spawn(process.execPath, [join(ROOT, "tests/fixtures", fixture), dir], {
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  const file = join(dir, "port");
  const port = () => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
  for (let waited = 0; !port(); waited += 25) {
    if (waited >= 20_000 || p.exitCode !== null) {
      p.kill();
      throw new Error(
        `tests/fixtures/${fixture} didn't start within 20 s (${p.exitCode !== null ? `it exited with ${p.exitCode}` : `no port in ${file}`})`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return { url: `http://127.0.0.1:${port()}`, dir, stop: () => p.kill() };
}

/** A run of a workflow, as the fake gh keeps it (state.runs, by workflow file). */
export interface FakeRun {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  display_title?: string;
  head_sha?: string;
  created_at: string;
}

/**
 * The fake gh for a ship process (a subprocess): `env` puts it first on PATH with its state, and
 * `calls` says what it was asked. `state` is added to its starting state (runs, mainSha, …).
 */
export function fakeGh(state: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gh-"));
  symlinkSync(join(ROOT, "tests/fixtures/fake-gh.mjs"), join(dir, "gh"));
  const file = join(dir, "gh.json");
  writeFileSync(
    file,
    JSON.stringify({
      repo: "o/shipify",
      bot: "github-actions[bot]",
      nextId: 100,
      issue: { number: 12, title: "x", body: "", state: "open", labels: [], user: { login: "o" } },
      comments: [],
      calls: [],
      runs: {},
      logs: {},
      ...state,
    }),
  );
  return {
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, FAKE_GH_STATE: file },
    calls: (): string[] => JSON.parse(readFileSync(file, "utf8")).calls,
  };
}

/** A good deploy of a project's main, `daysAgo` days ago, of the commit `sha`. */
export const deployRun = (id: number, sha: string, daysAgo = 0): FakeRun => ({
  id,
  html_url: `https://github.com/o/runs/${id}`,
  status: "completed",
  conclusion: "success",
  head_sha: sha,
  created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});
