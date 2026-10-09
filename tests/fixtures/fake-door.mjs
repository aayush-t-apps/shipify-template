#!/usr/bin/env node
// A stand-in for the admin Worker's door, for a chat channel's tests (ADR 0030 §4, §7):
//   POST /door/send/<channel>  signed with the send key: keeps the message in <dir>/sent.jsonl and
//                              answers its id; a signed "{}" isn't a message (400), as the Worker
//                              answers a check; <dir>/no-keys: the Worker has no chat keys (503,
//                              unconfigured); <dir>/closed: the door is closed (503); the channel
//                              "plain" answers in words, not JSON
//   GET /door/file/<channel>   a file's bytes, for a signed reference
//   POST /door/telegram        Telegram's route, as a Worker deployed with the secret last set:
//                              200 to a call with it (any secret, or <dir>/telegram-secret's), 401
//                              to any other; <dir>/no-telegram: not there yet (404)
//   GET /.well-known/shipify.json   the Worker's version (FAKE_VERSION, 1.15.0 by default)
// Anything unsigned gets 401.
//   node fake-door.mjs <dir>     (FAKE_SEND_KEY; writes its port to <dir>/port)
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const dir = process.argv[2];
const key = process.env.FAKE_SEND_KEY ?? "";
const signed = (text, header) => {
  const want = Buffer.from(`sha256=${createHmac("sha256", key).update(text).digest("hex")}`);
  const got = Buffer.from(String(header ?? ""));
  return got.length === want.length && timingSafeEqual(got, want);
};
const flag = (name) => existsSync(join(dir, name));
const json = (res, status, value) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
let next = 7;
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://door");
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    if (req.method === "GET" && url.pathname === "/.well-known/shipify.json")
      return json(res, 200, { version: process.env.FAKE_VERSION ?? "1.15.0" });
    if (req.method === "POST" && url.pathname === "/door/telegram") {
      if (flag("no-telegram")) return res.writeHead(404).end();
      const got = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
      const secret = flag("telegram-secret")
        ? readFileSync(join(dir, "telegram-secret"), "utf8").trim()
        : got;
      return got && got === secret
        ? res.writeHead(200).end()
        : json(res, 401, { error: "unproven" });
    }
    const send = /^\/door\/send\/([a-z-]+)$/.exec(url.pathname);
    if (req.method === "POST" && send) {
      if (!signed(body, req.headers["x-shipify-signature"]))
        return res.writeHead(401).end("bad signature");
      if (flag("closed")) return json(res, 503, { door: "closed" });
      if (flag("no-keys")) return json(res, 503, { door: "unconfigured" });
      if (body.trim() === "{}") return json(res, 400, { error: "not a message" });
      appendFileSync(join(dir, "sent.jsonl"), `${body}\n`);
      if (send[1] === "plain") return res.writeHead(200).end("sent");
      return json(res, 200, { id: next++ });
    }
    if (req.method === "GET" && /^\/door\/file\/[a-z-]+$/.test(url.pathname)) {
      const ref = url.searchParams.get("ref") ?? "";
      if (!signed(ref, req.headers["x-shipify-signature"])) return res.writeHead(401).end();
      return res.writeHead(200).end(`the bytes of ${ref}`);
    }
    res.writeHead(404).end();
  });
});
server.listen(0, "127.0.0.1", () =>
  writeFileSync(join(dir, "port"), String(server.address().port)),
);
