// Storage for Cloudflare apps (ADR 0022): the deploy script finds each KV namespace and D1 database
// by name or makes it, applies the migrations, then deploys with the ids filled in, and a preview
// never touches production's data. Run for real against a fake Cloudflare API and a fake pnpm.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers.ts";

const SCRIPT = join(ROOT, "stacks/_cloudflare/files/scripts/shipify/cloudflare.mjs");

/** A fake fetch for Cloudflare's API: what exists, and every call, in FAKE_CF (JSON). */
const FAKE_FETCH = `
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.FAKE_CF;
globalThis.fetch = async (url, init = {}) => {
  const s = JSON.parse(readFileSync(file, "utf8"));
  const u = new URL(url);
  const path = u.pathname.replace(/^\\/client\\/v4\\/accounts\\/[^/]+/, "");
  const method = init.method ?? "GET";
  s.calls.push(method + " " + path + u.search);
  const json = (status, body) => {
    writeFileSync(file, JSON.stringify(s));
    return new Response(JSON.stringify(body), { status });
  };
  if (path === "/storage/kv/namespaces" && method === "GET")
    return json(200, { result: s.kv, result_info: { total_pages: 1 } });
  if (path === "/storage/kv/namespaces" && method === "POST") {
    const title = JSON.parse(init.body).title;
    s.kv.push({ id: "kv-" + s.kv.length, title });
    return json(200, { result: { id: "kv-" + (s.kv.length - 1), title } });
  }
  if (path === "/d1/database" && method === "GET")
    return json(200, { result: s.d1.filter((d) => d.name === u.searchParams.get("name")), result_info: { total_pages: 1 } });
  if (path === "/d1/database" && method === "POST") {
    const name = JSON.parse(init.body).name;
    s.d1.push({ uuid: "db-" + s.d1.length, name });
    return json(200, { result: { uuid: "db-" + (s.d1.length - 1), name } });
  }
  if (path.endsWith("/subdomain")) return json(200, { result: { enabled: true } });
  if (path === "/workers/domains" && method === "GET") return json(200, { result: [] });
  return json(404, { errors: [{ message: "not faked: " + path }] });
};
`;

/** A fake pnpm: it logs `exec wrangler …` and, for --config, the file it was given. */
const FAKE_PNPM = `#!/usr/bin/env node
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const at = args.indexOf("--config");
const config = at >= 0 ? JSON.parse(readFileSync(args[at + 1], "utf8")) : undefined;
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, config, ci: process.env.CI }) + "\\n");
// A dry run's bundle: the Worker as one file, where --outdir says.
const out = args.indexOf("--outdir");
if (out >= 0) {
  mkdirSync(args[out + 1], { recursive: true });
  writeFileSync(args[out + 1] + "/index.js", "export default {};");
}
`;

function app(opts: { staging: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "ship-storage-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pnpm"), FAKE_PNPM);
  chmodSync(join(bin, "pnpm"), 0o755);
  writeFileSync(join(dir, "fetch.mjs"), FAKE_FETCH);
  writeFileSync(
    join(dir, "shipify.json"),
    JSON.stringify({ id: "notes", staging: opts.staging, secrets: { runtime: [] } }),
  );
  const storage = (worker: string) =>
    `"kv_namespaces": [{ "binding": "KV" }],\n  "d1_databases": [{ "binding": "DB", "database_name": "${worker}-db" }],`;
  writeFileSync(
    join(dir, "wrangler.jsonc"),
    `// A D1 and KV app.\n{\n  "name": "notes",\n  ${storage("notes")}\n${
      opts.staging
        ? `  "env": { "staging": { "name": "notes-staging", ${storage("notes-staging")} "vars": {} } },\n`
        : ""
    }  "vars": {}\n}\n`,
  );
  mkdirSync(join(dir, "migrations"));
  writeFileSync(join(dir, "migrations/0001_init.sql"), "CREATE TABLE t (k TEXT);\n");
  const cf = join(dir, "cf.json");
  writeFileSync(cf, JSON.stringify({ kv: [], d1: [], calls: [] }));
  const log = join(dir, "wrangler.log");
  writeFileSync(log, "");
  const run = (command: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", join(dir, "fetch.mjs"), SCRIPT, command], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_CF: cf,
        FAKE_LOG: log,
        CLOUDFLARE_ACCOUNT_ID: "acct",
        CLOUDFLARE_API_TOKEN: "test-token",
        CF_WORKERS_SUBDOMAIN: "sub",
        SHIPIFY_SHA: "abc1234",
        SHIPIFY_VERSION: "1.0.0",
        SHIPIFY_PR: "7",
        CI: "",
        ...env,
      },
    });
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(
        (l) =>
          JSON.parse(l) as {
            args: string[];
            config?: {
              kv_namespaces?: unknown[];
              d1_databases?: unknown[];
              env?: { staging?: { kv_namespaces?: unknown[]; d1_databases?: unknown[] } };
            };
            ci?: string;
          },
      );
  const api = () =>
    JSON.parse(readFileSync(cf, "utf8")) as { kv: unknown[]; d1: unknown[]; calls: string[] };
  return { dir, run, calls, api };
}

describe("storage: the deploy script (ADR 0022)", () => {
  it("makes what's missing, migrates, then deploys with the ids; the next deploy finds them", () => {
    const a = app({ staging: false });
    const r = a.run("deploy");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Made KV namespace notes-kv.");
    expect(r.stdout).toContain("Made D1 database notes-db.");
    const [migrate, deploy] = a.calls();
    expect(migrate?.args.slice(0, 7)).toEqual([
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
    ]);
    expect(migrate?.ci).toBe("true");
    expect(deploy?.args.slice(0, 3)).toEqual(["exec", "wrangler", "deploy"]);
    expect(deploy?.config?.kv_namespaces).toEqual([{ binding: "KV", id: "kv-0" }]);
    expect(deploy?.config?.d1_databases).toEqual([
      { binding: "DB", database_name: "notes-db", database_id: "db-0" },
    ]);

    // Again, from a fresh checkout (no ids anywhere): the same ones, none made.
    expect(a.run("deploy").status).toBe(0);
    expect(a.api().kv).toHaveLength(1);
    expect(a.api().d1).toHaveLength(1);
    expect(a.calls().at(-1)?.config?.kv_namespaces).toEqual([{ binding: "KV", id: "kv-0" }]);
  });

  it("gives staging its own, and a preview runs there without new migrations", () => {
    const a = app({ staging: true });
    expect(a.run("deploy", { SHIPIFY_ENV: "staging" }).status).toBe(0);
    expect(a.api().d1).toEqual([{ uuid: "db-0", name: "notes-staging-db" }]);
    expect(a.calls()[0]?.args).toContain("--env");
    const p = a.run("preview");
    expect(p.status, p.stderr).toBe(0);
    const upload = a.calls().at(-1);
    expect(upload?.args.slice(0, 4)).toEqual(["exec", "wrangler", "versions", "upload"]);
    expect(upload?.config?.env?.staging?.d1_databases).toEqual([
      { binding: "DB", database_name: "notes-staging-db", database_id: "db-0" },
    ]);
    expect(a.calls().filter((c) => c.args.includes("migrations"))).toHaveLength(1);
  });

  it("a PR's preview: its own code bundles with no keys or storage; main's uploads it as it is", () => {
    const a = app({ staging: true });
    const w = readFileSync(join(a.dir, "wrangler.jsonc"), "utf8").replace(
      '"name": "notes",',
      '"name": "notes",\n  "main": "src/worker/index.ts",\n  "assets": { "directory": "./dist" },',
    );
    writeFileSync(join(a.dir, "wrangler.jsonc"), w);
    mkdirSync(join(a.dir, "dist"));
    writeFileSync(join(a.dir, "dist/index.html"), "<p>hi</p>");
    // make bundle, in the PR's job: no key, no account, no call to Cloudflare.
    const out = join(a.dir, "bundle");
    const b = a.run("bundle", {
      SHIPIFY_BUNDLE: out,
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
    });
    expect(b.status, b.stderr).toBe(0);
    type Seen = {
      args: string[];
      config?: Record<string, unknown> & { env?: { staging?: Record<string, unknown> } };
    };
    const dry = a.calls().at(-1) as Seen | undefined;
    expect(dry?.args).toEqual(expect.arrayContaining(["deploy", "--dry-run", "--outdir"]));
    for (const c of [dry?.config, dry?.config?.env?.staging]) {
      expect(c?.kv_namespaces).toBeUndefined();
      expect(c?.d1_databases).toBeUndefined();
    }
    expect(a.api().calls).toEqual([]);
    expect(existsSync(join(out, "worker/index.js"))).toBe(true);
    expect(readFileSync(join(out, "assets/index.html"), "utf8")).toBe("<p>hi</p>");
    // make preview-from, in main's checkout on a fresh runner: that bundle, as it is.
    const p = a.run("preview", { SHIPIFY_BUILT: out });
    expect(p.status, p.stderr).toBe(0);
    const up = a.calls().at(-1) as Seen | undefined;
    expect(up?.args).toContain("--no-bundle");
    expect(up?.config?.main).toBe(join(out, "worker/index.js"));
    expect((up?.config?.assets as { directory?: string })?.directory).toBe(join(out, "assets"));
  });

  it("makes no preview for an app that keeps data and has no staging", () => {
    const a = app({ staging: false });
    const p = a.run("preview");
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("No preview: this app keeps data");
    expect(a.calls()).toEqual([]);
  });

  it("applies the migrations locally before make dev and the browser tests", () => {
    const a = app({ staging: false });
    expect(a.run("local").status).toBe(0);
    expect(a.calls().map((c) => c.args)).toEqual([
      ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"],
    ]);
    expect(a.api().calls).toEqual([]);
  });
});
