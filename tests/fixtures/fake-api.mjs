#!/usr/bin/env node
// A stand-in for GitHub's REST API, for the reads Shipify makes with fetch (ghIfChanged: a stay's and
// a run's ETag reads): each GET is answered by the fake gh (fake-gh.mjs `api -i`) from the state file
// its address names first (GITHUB_API_URL=http://127.0.0.1:<port>/<the state file, encoded>), with
// its status, ETag and body. Its own process, so a step a test starts and waits for reaches it too.
// It prints its port, and stops when its stdin closes (the test that started it is gone).
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const gh = fileURLToPath(new URL("./fake-gh.mjs", import.meta.url));

const server = createServer((req, res) => {
  const [, state, path] = /^\/([^/]+)\/(.*)$/.exec(req.url ?? "") ?? [];
  const tag = req.headers["if-none-match"];
  const args = ["api", "-i", ...(tag ? ["-H", `If-None-Match: ${tag}`] : []), path ?? ""];
  execFile(
    process.execPath,
    [gh, ...args],
    { env: { ...process.env, FAKE_GH_STATE: decodeURIComponent(state ?? "") } },
    (_, stdout, stderr) => {
      const cut = stdout.search(/\r?\n\r?\n/);
      const head = cut < 0 ? stdout : stdout.slice(0, cut);
      // The fake gh's own failure says its status as gh does ("Not Found (HTTP 404)").
      const status = Number(
        /^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1] ?? /HTTP (\d{3})/.exec(stderr)?.[1] ?? 500,
      );
      const etag = /^etag:\s*(.+?)\s*$/im.exec(head)?.[1];
      res.writeHead(status, {
        "content-type": "application/json",
        ...(etag ? { etag } : {}),
      });
      if (status === 304) res.end();
      else if (status === 200) res.end(stdout.slice(cut).trim());
      else res.end(JSON.stringify({ message: stderr.replace(/^fake gh: /, "").trim() }));
    },
  );
});
server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\n`));
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
