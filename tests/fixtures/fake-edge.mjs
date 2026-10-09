#!/usr/bin/env node
// A stand-in for the edge, for its setup tests (ADR 0031):
//   GET /health          {app: "shipify-edge"} (FAKE_EDGE_APP: another Worker's name)
//   POST /door/telegram  200 to a call carrying the TELEGRAM_SECRET the fake wrangler last put
//                        (compared by its hash), 401 to any other, 503 while it holds none; a
//                        message from FAKE_EDGE_CHAT is answered "Got it · #<n>", a retry the same
//   node fake-edge.mjs <dir>     (FAKE_WRANGLER_STATE; writes its port to <dir>/port)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const dir = process.argv[2];
const secrets = () =>
  existsSync(process.env.FAKE_WRANGLER_STATE ?? "")
    ? JSON.parse(readFileSync(process.env.FAKE_WRANGLER_STATE, "utf8")).secrets
    : {};
const json = (res, status, value) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
const tasks = new Map();
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/health")
      return json(res, 200, {
        status: "ok",
        app: process.env.FAKE_EDGE_APP ?? "shipify-edge",
        version: "0.1.0",
        commit: "abc",
      });
    if (req.method === "POST" && req.url === "/door/telegram") {
      const want = secrets().TELEGRAM_SECRET;
      if (!want) return json(res, 503, { door: "unconfigured" });
      const got = createHash("sha256")
        .update(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""))
        .digest("hex");
      if (got !== want) return json(res, 401, { error: "unproven" });
      const u = JSON.parse(body || "{}");
      if (!u.message) return res.writeHead(200).end();
      if (!tasks.has(u.update_id)) tasks.set(u.update_id, tasks.size + 12);
      return json(res, 200, { method: "sendMessage", text: `Got it · #${tasks.get(u.update_id)}` });
    }
    res.writeHead(404).end();
  });
});
server.listen(0, "127.0.0.1", () =>
  writeFileSync(join(dir, "port"), String(server.address().port)),
);
