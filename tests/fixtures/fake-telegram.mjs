#!/usr/bin/env node
// A stand-in for Telegram's Bot API, for the setup steps' tests (ADR 0030 §7): the token "good"
// works, any other is refused (401); each call is kept in <dir>/calls.jsonl (a multipart one by its
// fields: a text field's value, a file's name); setWebhook's address, max_connections and
// allowed_updates are what getWebhookInfo says after (<dir>/updates, a JSON list, overrides the
// last), <dir>/error (a line) makes it report a recent error, and the bot has a photo once
// setMyProfilePhoto set one.
//   node fake-telegram.mjs <dir>     (writes its port to <dir>/port)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const dir = process.argv[2];
let hook = "";
let connections;
let updates;
let photos = 0;
/** A multipart body's fields: a text field's value, a file field's file name. */
const fieldsOf = (body) =>
  Object.fromEntries(
    [
      ...body.matchAll(/name="([^"]+)"(?:; filename="([^"]+)")?\r\n(?:[^\r\n]+\r\n)*\r\n([^\r]*)/g),
    ].map((m) => [m[1], m[2] ?? m[3]]),
  );
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "");
    const send = (status, value) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (!m) return send(404, { ok: false, description: "Not Found" });
    if (m[1] !== "good") return send(401, { ok: false, description: "Unauthorized" });
    const multipart = /^multipart\//.test(req.headers["content-type"] ?? "");
    const args = multipart ? fieldsOf(body) : body ? JSON.parse(body) : {};
    appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify({ method: m[2], args })}\n`);
    if (m[2] === "getMe")
      return send(200, { ok: true, result: { id: 4242, username: "shipify_test_bot" } });
    if (m[2] === "getUserProfilePhotos")
      return send(200, { ok: true, result: { total_count: photos, photos: [] } });
    if (m[2] === "setMyProfilePhoto") photos++;
    if (m[2] === "setWebhook") {
      hook = args.url ?? "";
      connections = args.max_connections;
      updates = args.allowed_updates;
    }
    if (m[2] === "deleteWebhook") hook = "";
    if (m[2] === "getWebhookInfo") {
      const error = existsSync(join(dir, "error"))
        ? readFileSync(join(dir, "error"), "utf8").trim()
        : "";
      const allowed = existsSync(join(dir, "updates"))
        ? JSON.parse(readFileSync(join(dir, "updates"), "utf8"))
        : updates;
      return send(200, {
        ok: true,
        result: {
          url: hook,
          ...(connections ? { max_connections: connections } : {}),
          ...(allowed ? { allowed_updates: allowed } : {}),
          ...(error
            ? { last_error_date: Math.floor(Date.now() / 1000) - 60, last_error_message: error }
            : {}),
        },
      });
    }
    return send(200, { ok: true, result: true });
  });
});
server.listen(0, "127.0.0.1", () =>
  writeFileSync(join(dir, "port"), String(server.address().port)),
);
