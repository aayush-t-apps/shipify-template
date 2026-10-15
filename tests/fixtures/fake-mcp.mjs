#!/usr/bin/env node
// A stand-in MCP tool over stdio for run tests: `list` (look) and `add` (act). Each call is logged
// to the file its key names (JOT_LOG), so a test sees exactly which calls were made, with which key.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.JOT_LOG;
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize")
    send({
      id: m.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "jot", version: "1" },
      },
    });
  else if (m.method === "tools/list")
    send({ id: m.id, result: { tools: [{ name: "list" }, { name: "add" }] } });
  else if (m.method === "tools/call") {
    if (log) appendFileSync(log, `${JSON.stringify(m.params)}\n`);
    send({
      id: m.id,
      result: { content: [{ type: "text", text: `added ${m.params.arguments.text}` }] },
    });
  }
});
