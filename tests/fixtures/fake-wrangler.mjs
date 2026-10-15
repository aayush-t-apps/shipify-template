#!/usr/bin/env node
// A stand-in for wrangler, for the edge's setup tests (ADR 0031): `secret list|put|delete` on the
// edge's Worker, kept in FAKE_WRANGLER_STATE (JSON: each secret's name and a hash of its value,
// never the value). `put` reads the value from stdin, as wrangler does. A PEM put as the door
// App's key must be PKCS#8. FAKE_WRANGLER_FAIL makes every call fail, as a refused token would.
//   SHIPIFY_WRANGLER=<this file> pnpm ship …
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.env.FAKE_WRANGLER_STATE;
const state =
  file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { secrets: {}, calls: [] };
const args = process.argv
  .slice(2)
  .filter((a, i, all) => a !== "--config" && all[i - 1] !== "--config");
state.calls.push(args.join(" "));
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
if (process.env.FAKE_WRANGLER_FAIL) {
  save();
  process.stderr.write("✘ [ERROR] Authentication error [code: 10000]\n");
  process.exit(1);
}
const [cmd, sub, name] = args;
if (cmd === "secret" && sub === "list") {
  save();
  process.stdout.write(
    JSON.stringify(Object.keys(state.secrets).map((n) => ({ name: n, type: "secret_text" }))),
  );
  process.exit(0);
}
if (cmd === "secret" && sub === "put" && name) {
  const value = readFileSync(0, "utf8");
  if (!value) {
    process.stderr.write("✘ [ERROR] no value\n");
    process.exit(1);
  }
  if (name === "SHIPIFY_DOOR_APP_KEY" && !value.startsWith("-----BEGIN PRIVATE KEY-----")) {
    process.stderr.write("✘ [ERROR] not PKCS#8\n");
    process.exit(1);
  }
  state.secrets[name] = createHash("sha256").update(value).digest("hex");
  save();
  process.stdout.write(`✨ Success! Uploaded secret ${name}\n`);
  process.exit(0);
}
if (cmd === "secret" && sub === "delete" && name) {
  delete state.secrets[name];
  save();
  process.exit(0);
}
save();
process.stderr.write(`fake wrangler: unsupported ${args.join(" ")}\n`);
process.exit(1);
