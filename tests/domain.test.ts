// One address (ADR 0023, 0024): the deploy script gives each Worker the name its shipify.json URL
// says, after checking nothing else answers there, and keeps workers.dev off; a workers.dev URL means
// no custom domain and workers.dev on. Pause and resume take the name off and bring it back. Run for
// real against a fake Cloudflare API, DNS and pnpm.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers.ts";

const SCRIPT = join(ROOT, "stacks/_cloudflare/files/scripts/shipify/cloudflare.mjs");

interface Domain {
  id: string;
  hostname: string;
  service: string;
}
interface State {
  scripts: string[];
  domains: Domain[];
  zones: string[];
  dns: string[];
  live: string[];
  putStatus: number;
  calls: string[];
  /** What the last `wrangler deploy` was told about workers.dev. */
  workersDev?: boolean | string;
}

/** A fake fetch: Cloudflare's API, public DNS and the app's own name, all from FAKE_CF (JSON). */
const FAKE_FETCH = `
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.FAKE_CF;
globalThis.fetch = async (url, init = {}) => {
  const s = JSON.parse(readFileSync(file, "utf8"));
  const u = new URL(url);
  const method = init.method ?? "GET";
  const save = () => writeFileSync(file, JSON.stringify(s));
  const json = (status, body) => {
    save();
    return new Response(JSON.stringify(body), { status });
  };
  if (u.hostname === "cloudflare-dns.com") {
    const name = u.searchParams.get("name");
    s.calls.push("DNS " + name);
    return json(200, { Status: 0, Answer: s.dns.includes(name) ? [{ data: "192.0.2.1" }] : [] });
  }
  if (u.hostname !== "api.cloudflare.com") {
    s.calls.push("HTTPS " + u.hostname);
    save();
    if (!s.live.includes(u.hostname)) throw new Error("no certificate yet");
    return new Response("{}", { status: 200 });
  }
  const path = u.pathname.replace(/^\\/client\\/v4(\\/accounts\\/[^/]+)?/, "");
  s.calls.push(method + " " + path + u.search);
  const sub = /^\\/workers\\/scripts\\/([^/]+)\\/subdomain$/.exec(path);
  if (sub && method === "GET")
    return s.scripts.includes(sub[1]) ? json(200, { result: { enabled: true } }) : json(404, {});
  if (sub && method === "POST") {
    s.calls[s.calls.length - 1] += " enabled=" + JSON.parse(init.body).enabled;
    return json(200, { result: JSON.parse(init.body) });
  }
  if (path === "/workers/domains" && method === "GET") return json(200, { result: s.domains });
  if (path === "/workers/domains" && method === "PUT") {
    if (s.putStatus !== 200) return json(s.putStatus, { errors: [{ code: 10000 }] });
    const b = JSON.parse(init.body);
    s.domains.push({ id: "d" + s.calls.length, hostname: b.hostname, service: b.service, zone: b.zone_id });
    return json(200, { result: {} });
  }
  const del = /^\\/workers\\/domains\\/(.+)$/.exec(path);
  if (del && method === "DELETE") {
    s.domains = s.domains.filter((d) => d.id !== del[1]);
    return json(200, { result: null });
  }
  if (path === "/zones")
    return json(200, {
      result: s.zones
        .filter((z) => z === u.searchParams.get("name"))
        .map((z) => ({ id: "zone-" + z, name: z, account: { id: "acct" } })),
    });
  return json(404, { errors: [{ message: "not faked: " + path }] });
};
`;

/** A fake pnpm: `exec wrangler …` lands in the same call list, so the order shows. */
const FAKE_PNPM = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const s = JSON.parse(readFileSync(process.env.FAKE_CF, "utf8"));
const args = process.argv.slice(4);
const at = args.indexOf("--config");
s.calls.push("WRANGLER " + args.join(" "));
s.workersDev = at >= 0 ? JSON.parse(readFileSync(args[at + 1], "utf8")).workers_dev : "wrangler.jsonc";
writeFileSync(process.env.FAKE_CF, JSON.stringify(s));
`;

const NAME = "notes.apps.example.com";

function app(state: Partial<State> = {}, url = `https://${NAME}`) {
  const dir = mkdtempSync(join(tmpdir(), "ship-domain-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pnpm"), FAKE_PNPM);
  chmodSync(join(bin, "pnpm"), 0o755);
  writeFileSync(join(dir, "fetch.mjs"), FAKE_FETCH);
  writeFileSync(
    join(dir, "shipify.json"),
    JSON.stringify({
      id: "notes",
      staging: false,
      urls: { production: url },
      health: "/health",
      secrets: { runtime: [] },
    }),
  );
  writeFileSync(
    join(dir, "wrangler.jsonc"),
    '{\n  "name": "notes",\n  "workers_dev": true,\n  "vars": {}\n}\n',
  );
  const cf = join(dir, "cf.json");
  const initial: State = {
    scripts: ["notes"],
    domains: [],
    zones: ["example.com"],
    dns: [],
    live: [NAME],
    putStatus: 200,
    calls: [],
    ...state,
  };
  writeFileSync(cf, JSON.stringify(initial));
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const run = (command: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", join(dir, "fetch.mjs"), SCRIPT, command], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_CF: cf,
        CLOUDFLARE_ACCOUNT_ID: "acct",
        CLOUDFLARE_API_TOKEN: "test-token",
        CF_WORKERS_SUBDOMAIN: "sub",
        SHIPIFY_SHA: "abc1234",
        SHIPIFY_VERSION: "1.0.0",
        GITHUB_STEP_SUMMARY: summary,
        SHIPIFY_DOMAIN_WAIT_MS: "0",
        ...env,
      },
    });
  const s = () => JSON.parse(readFileSync(cf, "utf8")) as State;
  const set = (patch: Partial<State>) => writeFileSync(cf, JSON.stringify({ ...s(), ...patch }));
  /** The calls that change something, and the deploy, in order. */
  const writes = () =>
    s()
      .calls.filter((c) => /^(PUT|DELETE|POST|WRANGLER deploy)/.test(c))
      .map((c) => (c.startsWith("WRANGLER deploy") ? "WRANGLER deploy" : c));
  return { run, s, set, writes, summary: () => readFileSync(summary, "utf8") };
}

describe("one address: the deploy script (ADR 0023, 0024)", () => {
  it("attaches the name before the new code, with workers.dev off, then waits for HTTPS", () => {
    const a = app();
    const r = a.run("deploy");
    expect(r.status, r.stderr).toBe(0);
    expect(a.writes()).toEqual(["PUT /workers/domains", "WRANGLER deploy"]);
    expect(a.s().workersDev).toBe(false);
    expect(a.s().domains).toMatchObject([
      { hostname: NAME, service: "notes", zone: "zone-example.com" },
    ]);
    expect(a.s().calls).toContain(`DNS ${NAME}`);
    expect(r.stdout).toContain(`Live at https://${NAME}`);
    expect(a.summary()).toContain(`Live at https://${NAME}`);

    // Again: the name is there, so no lookup and no attach.
    const lookups = a.s().calls.filter((c) => c.startsWith("DNS")).length;
    expect(a.run("deploy").status).toBe(0);
    expect(a.s().domains).toHaveLength(1);
    expect(a.s().calls.filter((c) => c.startsWith("DNS"))).toHaveLength(lookups);
  });

  it("gives a brand-new Worker its name right after its first upload", () => {
    const a = app({ scripts: [] });
    expect(a.run("deploy").status).toBe(0);
    expect(a.writes()).toEqual(["WRANGLER deploy", "PUT /workers/domains"]);
  });

  it("finds the zone by the longest name that ends the host", () => {
    const a = app({ zones: ["example.com", "apps.example.com"] });
    expect(a.run("deploy").status).toBe(0);
    expect(a.s().domains).toMatchObject([{ zone: "zone-apps.example.com" }]);
  });

  it("stops, changing nothing, when the name already answers in DNS or is another Worker's", () => {
    const taken = app({ dns: [NAME] });
    const r = taken.run("deploy");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${NAME} already answers in DNS`);
    expect(taken.writes()).toEqual([]);

    const other = app({ domains: [{ id: "x", hostname: NAME, service: "blog" }] });
    const o = other.run("deploy");
    expect(o.status).toBe(1);
    expect(o.stderr).toContain(`${NAME} belongs to the Worker blog`);
    expect(other.writes()).toEqual([]);
  });

  it("names the missing permission when the token can't attach, before any new code", () => {
    const a = app({ putStatus: 403 });
    const r = a.run("deploy");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"Zone → Workers Routes: Edit" for example.com');
    expect(a.writes()).toEqual(["PUT /workers/domains"]);
  });

  it("follows the URL: a changed name replaces the old one; a workers.dev URL leaves none", () => {
    const old = { id: "old", hostname: "notes.old.example.com", service: "notes" };
    const changed = app({ domains: [old] });
    expect(changed.run("deploy").status).toBe(0);
    expect(changed.s().domains.map((d) => d.hostname)).toEqual([NAME]);

    const back = app({ domains: [old] }, "https://notes.sub.workers.dev");
    const r = back.run("deploy");
    expect(r.status, r.stderr).toBe(0);
    expect(back.s().domains).toEqual([]);
    expect(back.s().workersDev).toBe("wrangler.jsonc");
    expect(back.s().calls.some((c) => c.startsWith("DNS") || c.startsWith("PUT"))).toBe(false);
  });

  it("stops with a re-run hint when the new name isn't answering over HTTPS in time", () => {
    const a = app({ live: [] });
    const r = a.run("deploy");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("isn't answering over HTTPS yet");
    expect(a.s().domains).toHaveLength(1);
  });

  it("pause takes the name off with workers.dev; resume brings the name back, workers.dev off", () => {
    const a = app({ domains: [{ id: "d1", hostname: NAME, service: "notes" }] });
    expect(a.run("pause").status).toBe(0);
    expect(a.writes()).toEqual([
      "POST /workers/scripts/notes/subdomain enabled=false",
      "DELETE /workers/domains/d1",
    ]);
    expect(a.s().domains).toEqual([]);

    // Right after a pause, DNS caches may still answer for the name: resume doesn't ask them.
    a.set({ dns: [NAME], calls: [] });
    const r = a.run("resume");
    expect(r.status, r.stderr).toBe(0);
    expect(a.writes()).toEqual([
      "POST /workers/scripts/notes/subdomain enabled=false",
      "PUT /workers/domains",
    ]);
    expect(a.s().calls).not.toContain(`DNS ${NAME}`);
    expect(r.stdout).toContain(`Live at https://${NAME}`);
  });

  it("resumes an app without its own name on workers.dev", () => {
    const a = app({}, "https://notes.sub.workers.dev");
    expect(a.run("resume").status).toBe(0);
    expect(a.writes()).toEqual(["POST /workers/scripts/notes/subdomain enabled=true"]);
  });
});
