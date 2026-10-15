// `ship door` on the PC (ADR 0031): the door App made from a manifest, its key put on the edge's
// Worker as PKCS#8 (a fake wrangler keeps only a hash of it), shipify's variables set, and the
// check of the edge, the App and the door's route. And `ship selftest`'s parts.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never this machine's own agent users: on a box (/srv/shipify-agent-*) selftest would check them.
vi.mock("../cli/lib/sandbox.ts", async (real) => ({
  ...(await real<typeof import("../cli/lib/sandbox.ts")>()),
  sandboxSlots: () => [],
}));

import { selftest } from "../cli/commands/plugins.ts";
import type { RunResult } from "../cli/lib/exec.ts";
import {
  DOOR_PERMISSIONS,
  DOOR_VARS,
  type DoorDeps,
  doorCheck,
  doorManifest,
  doorSetup,
  installProblems,
} from "../edge/setup/door.ts";
import { doorPage, pageCheck } from "../edge/setup/page.ts";
import { appJwt, edgeOrigin, toPkcs8 } from "../edge/setup/worker.ts";
import { ROOT } from "./helpers.ts";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const GOOD = { ...DOOR_PERMISSIONS, variables: "read" };

/** A world of one test's own: credentials, the mock provider's log, a fake wrangler's state. */
function world(
  opts: {
    creds?: string;
    vars?: Record<string, string>;
    /** The Worker's secrets. */
    secrets?: string[];
    /** Your copy's secrets on GitHub. */
    onCopy?: string[];
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "door-"));
  const creds = join(dir, "creds.env");
  writeFileSync(
    creds,
    opts.creds ?? "CF_DEPLOY_TOKEN=cf-test\nCLOUDFLARE_ACCOUNT_ID=acct\nAPPS_DOMAIN=example.com\n",
    { mode: 0o600 },
  );
  const log = join(dir, "calls.jsonl");
  const before = [
    ...Object.entries(opts.vars ?? {}).map(([name, value]) => ({
      call: "setVariable",
      repo: "o/shipify",
      name,
      value,
    })),
    ...(opts.onCopy ?? []).map((name) => ({ call: "setSecret", repo: "o/shipify", name })),
  ];
  writeFileSync(log, before.map((c) => `${JSON.stringify(c)}\n`).join(""));
  const state = join(dir, "wrangler.json");
  writeFileSync(
    state,
    JSON.stringify({
      secrets: Object.fromEntries((opts.secrets ?? []).map((s) => [s, "x"])),
      calls: [],
    }),
  );
  vi.stubEnv("SHIPIFY_CREDENTIALS", creds);
  vi.stubEnv("SHIPIFY_PROVIDER", "mock");
  vi.stubEnv("SHIPIFY_MOCK_CALLS", log);
  vi.stubEnv("SHIPIFY_WRANGLER", join(ROOT, "tests/fixtures/fake-wrangler.mjs"));
  vi.stubEnv("FAKE_WRANGLER_STATE", state);
  vi.stubEnv("GITHUB_REPOSITORY", "o/shipify");
  vi.stubEnv("APPS_DOMAIN", "");
  vi.stubEnv("CF_DEPLOY_TOKEN", "");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  const gh: string[][] = [];
  return {
    dir,
    gh,
    writes: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { call: string; name?: string; value?: string })
        .slice(before.length),
    wrangler: () =>
      JSON.parse(readFileSync(state, "utf8")) as {
        secrets: Record<string, string>;
        calls: string[];
      },
    /** GitHub's App API and gh, as this PC sees them. */
    deps(
      over: {
        selection?: string;
        repos?: string[];
        permissions?: Record<string, string>;
        installation?: number;
      } = {},
    ): Partial<DoorDeps> {
      return {
        create: async () => ({
          id: 42,
          slug: "o-shipify-door",
          pem: PEM,
          installation: over.installation ?? 99,
        }),
        wait: async () => {},
        ask: async () => "",
        gh: (args: string[]): RunResult => {
          gh.push(args);
          if (args[0] === "api" && args[1] === "repos/o/shipify")
            return { code: 0, stdout: "1001\t2002\n", stderr: "" };
          if (args[0] === "workflow") return { code: 0, stdout: "", stderr: "" };
          return { code: 1, stdout: "", stderr: "fake gh: no" };
        },
        fetch: (async (input: string | URL | Request) => {
          const url = String(input);
          const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
          if (url.endsWith("/app")) return ok({ id: 42, slug: "o-shipify-door" });
          if (url.endsWith("/app/installations")) return ok([{ id: 99, account: { login: "o" } }]);
          if (url.endsWith("/app/installations/99"))
            return ok({
              permissions: over.permissions ?? GOOD,
              repository_selection: over.selection ?? "selected",
            });
          if (url.endsWith("/access_tokens"))
            return new Response(JSON.stringify({ token: "t" }), { status: 201 });
          if (url.includes("/installation/repositories"))
            return ok({ repositories: (over.repos ?? ["shipify"]).map((name) => ({ name })) });
          // Cloudflare, with the deploy token: one account, and its workers.dev name.
          if (url.endsWith("/client/v4/accounts"))
            return ok({ result: [{ id: "0123456789abcdef0123456789abcdef" }] });
          if (url.endsWith("/workers/subdomain")) return ok({ result: { subdomain: "mine" } });
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      };
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the door App", () => {
  it("asks GitHub for exactly its permissions, on a private App, sending it back here", () => {
    // Your copy, whatever its name: platformRepo() takes any.
    const m = doorManifest("o/my-shipify", "http://localhost:5000");
    expect(m.default_permissions).toEqual({
      issues: "write",
      actions: "read",
      administration: "read",
      metadata: "read",
    });
    expect(m).toMatchObject({
      name: "o-shipify-door",
      url: "https://github.com/o/my-shipify",
      public: false,
      redirect_url: "http://localhost:5000/done",
      setup_url: "http://localhost:5000/installed",
      default_events: [],
    });
  });

  it("knows an install that reaches more than shipify, or may do more or less than it should", () => {
    // Your copy, whatever its name: platformRepo() takes any.
    const right = { permissions: GOOD, selection: "selected", repos: ["my-shipify"] };
    const problems = (i: Parameters<typeof installProblems>[0]) =>
      installProblems(i, "o/my-shipify");
    expect(problems(right)).toEqual([]);
    expect(problems({ ...right, selection: "all" })).toEqual([
      "it reaches every repository, not my-shipify alone",
    ]);
    expect(problems({ ...right, repos: ["shipify"] })).toEqual([
      "it reaches shipify, not my-shipify alone",
    ]);
    expect(problems({ ...right, repos: ["my-shipify", "spotter"] })).toHaveLength(1);
    expect(problems({ ...right, permissions: { ...DOOR_PERMISSIONS } })).toEqual([
      "Variables isn't read-only yet",
    ]);
    expect(problems({ ...right, permissions: { ...GOOD, contents: "read" } })).toEqual([
      "contents is on: it shouldn't be",
    ]);
    expect(problems({ ...right, permissions: { ...GOOD, actions: "write" } })).toEqual([
      "actions is write, not read",
    ]);
    expect(
      problems({
        ...right,
        permissions: { ...DOOR_PERMISSIONS, actions_variables: "read" },
      }),
    ).toEqual([]);
  });

  it("turns GitHub's PKCS#1 key into the PKCS#8 WebCrypto reads, and signs its JWT", () => {
    const p8 = toPkcs8(PEM);
    expect(PEM).toContain("BEGIN RSA PRIVATE KEY");
    expect(p8).toContain("-----BEGIN PRIVATE KEY-----");
    const [head, body] = appJwt(42, PEM, Date.parse("2026-10-04T12:00:00Z")).split(".");
    expect(JSON.parse(Buffer.from(head ?? "", "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(body ?? "", "base64url").toString())).toMatchObject({
      iss: "42",
    });
  });

  it("finds the edge's address: the variable, else your domain, else its workers.dev", () => {
    world();
    expect(edgeOrigin({ SHIPIFY_DOOR_URL: "https://shipify.acme.dev" })).toBe(
      "https://shipify.acme.dev",
    );
    expect(edgeOrigin({})).toBe("https://shipify.example.com");
    expect(edgeOrigin({ SHIPIFY_DOOR_URL: "http://evil.example.com" })).toBe(
      "https://shipify.example.com",
    );
    world({ creds: "CF_DEPLOY_TOKEN=cf-test\n" });
    expect(edgeOrigin({ CF_WORKERS_SUBDOMAIN: "mine" })).toBe("https://shipify.mine.workers.dev");
    expect(edgeOrigin({})).toBeUndefined();
  });
});

describe("ship door setup", () => {
  it("shows its plan and changes nothing without --yes", async () => {
    const w = world();
    const r = await doorSetup(false, { deps: w.deps() });
    expect(r.status).toBe("requires-approval");
    const plan = r.plannedActions?.join("\n") ?? "";
    for (const v of DOOR_VARS) expect(plan).toContain(v);
    expect(plan).toContain("SHIPIFY_DOOR_URL=https://shipify.example.com");
    expect(plan).toContain("wrangler secret put SHIPIFY_DOOR_APP_KEY");
    expect(plan).toContain(
      "set the secret CF_DEPLOY_TOKEN on o/shipify, from your credentials file: the edge's deploy runs with it",
    );
    expect(w.writes()).toEqual([]);
    expect(w.wrangler().calls).toEqual([]);
  });

  it("makes the App, puts its key on the edge as PKCS#8, sets the variables and the deploy's key, and starts the deploy", async () => {
    const w = world();
    const r = await doorSetup(true, { deps: w.deps() });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(Object.keys(w.wrangler().secrets)).toEqual(["SHIPIFY_DOOR_APP_KEY"]);
    const vars = Object.fromEntries(
      w
        .writes()
        .filter((c) => c.call === "setVariable")
        .map((c) => [c.name, c.value]),
    );
    expect(vars).toEqual({
      SHIPIFY_DOOR_APP_ID: "42",
      // The runs know the door App's comments by it.
      SHIPIFY_DOOR_SLUG: "o-shipify-door",
      SHIPIFY_DOOR_INSTALLATION: "99",
      SHIPIFY_DOOR_URL: "https://shipify.example.com",
      SHIPIFY_REPO_ID: "1001",
      SHIPIFY_OWNER_ID: "2002",
      // The edge's deploy puts it at shipify.<APPS_DOMAIN>, in your Cloudflare account.
      APPS_DOMAIN: "example.com",
      CLOUDFLARE_ACCOUNT_ID: "acct",
    });
    // An App's key never expires: no key date is made up for it.
    expect(vars.SHIPIFY_KEY_DATES).toBeUndefined();
    // The deploy on GitHub runs with this PC's deploy token, set from the credentials file.
    expect(w.writes().filter((c) => c.call === "setSecret")).toMatchObject([
      { name: "CF_DEPLOY_TOKEN" },
    ]);
    expect(w.gh).toContainEqual(["workflow", "run", "ci.yml", "--ref", "main", "-R", "o/shipify"]);
    expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");
  });

  it("with no domain and only the deploy token here, finds your account and its workers.dev name, and puts the edge there", async () => {
    const w = world({ creds: "CF_DEPLOY_TOKEN=cf-test\n" });
    const r = await doorSetup(true, { deps: w.deps() });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    const vars = Object.fromEntries(
      w
        .writes()
        .filter((c) => c.call === "setVariable")
        .map((c) => [c.name, c.value]),
    );
    expect(vars.SHIPIFY_DOOR_URL).toBe("https://shipify.mine.workers.dev");
    expect(vars.CLOUDFLARE_ACCOUNT_ID).toBe("0123456789abcdef0123456789abcdef");
    // No domain: none is set, so the deploy adds none.
    expect(vars.APPS_DOMAIN).toBeUndefined();
  });

  it("stops at an install that reaches every repository, saying how to fix it", async () => {
    const w = world();
    const r = await doorSetup(true, {
      deps: w.deps({ selection: "all", repos: ["shipify", "spotter"] }),
    });
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("not shipify alone");
    expect(r.nextSteps?.[0]).toContain("settings/installations/99");
  });

  it("is done already when the App, its key and its variables are there; a new key is --new's", async () => {
    const all = {
      SHIPIFY_DOOR_APP_ID: "42",
      SHIPIFY_DOOR_SLUG: "o-shipify-door",
      SHIPIFY_DOOR_INSTALLATION: "99",
      SHIPIFY_DOOR_URL: "https://shipify.example.com",
      SHIPIFY_REPO_ID: "1001",
      SHIPIFY_OWNER_ID: "2002",
      CLOUDFLARE_ACCOUNT_ID: "acct",
      APPS_DOMAIN: "example.com",
    };
    const w = world({ vars: all, secrets: ["SHIPIFY_DOOR_APP_KEY"], onCopy: ["CF_DEPLOY_TOKEN"] });
    expect(await doorSetup(true, { deps: w.deps() })).toMatchObject({ status: "skipped" });
    // Set up before its deploy key was on the list: that alone is done.
    const keyless = world({ vars: all, secrets: ["SHIPIFY_DOOR_APP_KEY"] });
    const put = await doorSetup(true, { deps: keyless.deps() });
    expect(put).toMatchObject({ status: "succeeded" });
    expect(keyless.writes().map((c) => [c.call, c.name])).toEqual([
      ["setSecret", "CF_DEPLOY_TOKEN"],
    ]);
    // Stopped while it waited for the install: the App and its key, but not its variables.
    const stopped = world({
      vars: { SHIPIFY_DOOR_APP_ID: "42" },
      secrets: ["SHIPIFY_DOOR_APP_KEY"],
    });
    const half = await doorSetup(true, { deps: stopped.deps() });
    expect(half.status).toBe("blocked");
    expect(half.summary).toContain("not set: SHIPIFY_DOOR_SLUG");
    expect(half.nextSteps?.[0]).toContain("Generate a private key");
    expect(half.nextSteps?.[0]).toContain("pnpm ship door setup --new --yes");
    const lost = world({ vars: { SHIPIFY_DOOR_APP_ID: "42" } });
    const r = await doorSetup(true, { deps: lost.deps() });
    expect(r.status).toBe("blocked");
    expect(r.nextSteps?.[0]).toContain("pnpm ship door setup --new --yes");
  });

  it("--new: reads the key GitHub downloaded, checks it's the App's, and puts it in place", async () => {
    const w = world({ vars: { SHIPIFY_DOOR_APP_ID: "42" }, secrets: ["SHIPIFY_DOOR_APP_KEY"] });
    const file = join(w.dir, "o-shipify-door.2026-10-04.private-key.pem");
    writeFileSync(file, PEM, { mode: 0o600 });
    const r = await doorSetup(true, { renew: true, key: file, deps: w.deps() });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(r.checks?.[0]).toMatchObject({ name: "the key is the door App 42's", ok: true });
    expect(w.wrangler().calls).toContain("secret put SHIPIFY_DOOR_APP_KEY");
    const other = world({ vars: { SHIPIFY_DOOR_APP_ID: "7" } });
    const refused = await doorSetup(true, { renew: true, key: file, deps: other.deps() });
    expect(refused.status).toBe("blocked");
    expect(refused.summary).toContain("isn't the door App 7's");
  });

  it("needs Cloudflare's deploy token on this PC, and says where it goes", async () => {
    const w = world({ creds: "APPS_DOMAIN=example.com\n" });
    const r = await doorSetup(true, { deps: w.deps() });
    expect(r.status).toBe("blocked");
    expect(r.summary).toContain("CF_DEPLOY_TOKEN and CLOUDFLARE_ACCOUNT_ID");
    expect(w.wrangler().calls).toEqual([]);
    // And a workers.dev name, a domain or not: the edge deploys there too (wrangler.jsonc), and
    // Cloudflare refuses the deploy on an account with none.
    const bare = world();
    const none = await doorSetup(true, {
      deps: {
        ...bare.deps(),
        fetch: (async () => new Response("{}", { status: 404 })) as typeof fetch,
      },
    });
    expect(none.status).toBe("blocked");
    expect(none.nextSteps?.join(" ")).toContain("open Workers once on its dashboard");
    expect(bare.wrangler().calls).toEqual([]);
  });
});

describe("ship door check", () => {
  const edge = (health: unknown, telegram = 401) =>
    (async (input: string | URL | Request) =>
      String(input).endsWith("/health")
        ? new Response(JSON.stringify(health), { status: 200 })
        : new Response("{}", { status: telegram })) as typeof fetch;
  const gh = () => ({ code: 0, stdout: "abc\n", stderr: "" });
  // You, on each chat channel: their routes are checked.
  const people = [{ name: "me", on: { github: "o", telegram: "42", web: "me" } }];
  const vars = {
    ...Object.fromEntries(
      DOOR_VARS.map((v) => [v, v === "SHIPIFY_DOOR_URL" ? "https://shipify.example.com" : "1"]),
    ),
    SHIPIFY_PEOPLE: JSON.stringify(people),
  };
  const good = {
    status: "ok",
    app: "shipify-edge",
    version: "0.1.0",
    commit: "abc",
    door: { permissions: GOOD, selection: "selected", repos: ["shipify"] },
  };

  it("says the edge is in step when main moved on with nothing it runs, and behind when it did", async () => {
    world({ vars });
    const gh = (files: string) => (args: string[]) => ({
      code: 0,
      stdout: args.some((a) => a.includes("/compare/")) ? files : "def\n",
      stderr: "",
    });
    const health = (r: Awaited<ReturnType<typeof doorCheck>>) =>
      r.checks?.find((c) => c.name.includes("/health"))?.detail;
    expect(health(await doorCheck({ fetch: edge(good), gh: gh("docs/tour.md\n") }))).toBe(
      "v0.1.0 at abc, in step with main (nothing the edge runs has changed since)",
    );
    expect(health(await doorCheck({ fetch: edge(good), gh: gh("edge/src/page.ts\n") }))).toContain(
      "has edge changes since: its deploy may be on its way",
    );
  });

  it("passes when the edge answers, the App is right, and its route wants Telegram's secret", async () => {
    world({ vars });
    const r = await doorCheck({ fetch: edge(good), gh });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(r.checks?.find((c) => c.name.includes("/health"))?.detail).toBe("v0.1.0 at abc, main");
  });

  it("says plainly what's wrong: another Worker, an App with too much, a sign-in in the way, a missing key", async () => {
    world({ vars });
    const other = await doorCheck({ fetch: edge({ ...good, app: "something-else" }), gh });
    expect(other.checks?.find((c) => c.name.includes("/health"))?.detail).toContain(
      "not the edge yet",
    );
    const much = await doorCheck({
      fetch: edge({ ...good, door: { ...good.door, permissions: { ...GOOD, contents: "write" } } }),
      gh,
    });
    expect(much.summary).toContain("contents is on");
    const signIn = await doorCheck({ fetch: edge(good, 302), gh });
    expect(signIn.summary).toContain(
      "a sign-in is in front of the door: Access belongs on /admin alone",
    );
    const keyless = await doorCheck({ fetch: edge(good, 503), gh });
    expect(keyless.summary).toContain("missing a key");
    // Each failing check names its fix.
    for (const r of [other, much, signIn, keyless])
      for (const c of r.checks ?? []) if (!c.ok) expect(c.fix, c.name).toBeTruthy();
  });

  it("a channel no one's on isn't added yet: its route isn't checked, and nothing fails", async () => {
    world({
      vars: { ...vars, SHIPIFY_PEOPLE: JSON.stringify([{ name: "me", on: { github: "o" } }]) },
    });
    const r = await doorCheck({ fetch: edge(good, 503), gh });
    expect(r.status, JSON.stringify(r.checks)).toBe("succeeded");
    expect(r.checks?.find((c) => c.name.startsWith("/door/telegram"))).toMatchObject({
      ok: true,
      blocking: false,
      detail: "not added: pnpm ship add telegram --yes",
    });
  });
});

// ---------------------------------------------------------------- selftest

interface FakeGh {
  calls: string[];
  runs: Record<string, unknown[]>;
}

function useFakeGh() {
  let file = "";
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "door-"));
    symlinkSync(join(ROOT, "tests/fixtures/fake-gh.mjs"), join(dir, "gh"));
    file = join(dir, "gh.json");
    writeFileSync(
      file,
      JSON.stringify({
        repo: "o/shipify",
        bot: "github-actions[bot]",
        nextId: 100,
        issue: {
          number: 12,
          title: "x",
          body: "",
          state: "open",
          labels: [],
          user: { login: "o" },
        },
        comments: [],
        calls: [],
        runs: { "task.yml": [], "watch.yml": [] },
        logs: {},
      }),
    );
    vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
    vi.stubEnv("FAKE_GH_STATE", file);
    vi.stubEnv("GITHUB_REPOSITORY", "o/shipify");
    vi.stubEnv("SHIPIFY_PROVIDER", "mock");
    vi.stubEnv("SHIPIFY_MOCK_CALLS", join(dir, "calls.jsonl"));
  });
  const read = (): FakeGh => JSON.parse(readFileSync(file, "utf8"));
  return {
    read,
    set(change: (f: FakeGh) => void) {
      const f = read();
      change(f);
      writeFileSync(file, JSON.stringify(f));
    },
  };
}

describe("ship door page (ADR 0032)", () => {
  const vars = { SHIPIFY_DOOR_URL: "https://shipify.example.com" };
  const behind = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://myteam.cloudflareaccess.com/cdn-cgi/access/login/x" },
    })) as unknown as typeof fetch;
  const open = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
  const AUD = "f".repeat(64);

  it("checks the page sends a stranger to Access's sign-in, and says what's wrong when not", async () => {
    expect((await pageCheck("https://shipify.example.com", behind)).ok).toBe(true);
    const bare = await pageCheck("https://shipify.example.com", open);
    expect(bare.ok).toBe(false);
    expect(bare.detail).toContain("no Access application covers /admin yet");
  });

  it("shows the plan first: the dashboard steps, nothing set", async () => {
    const w = world({ vars });
    const r = await doorPage(false, { fetch: open, ask: async () => "", say: () => {} });
    expect(r.summary).toContain("one Access application for shipify.example.com/admin/*");
    expect(r.checks?.some((c) => c.name.includes("path: admin/*"))).toBe(true);
    expect(w.writes()).toEqual([]);
  });

  it("with --yes, takes the two public values, saves them, and checks the sign-in", async () => {
    const w = world({ vars });
    const answers = ["myteam.cloudflareaccess.com", AUD];
    const said: string[] = [];
    const r = await doorPage(true, {
      fetch: behind,
      ask: async () => answers.shift() ?? "",
      say: (l) => said.push(l),
    });
    expect(said.join("\n")).toContain("Zero Trust → Access → Applications");
    expect(w.writes()).toContainEqual({
      call: "setVariable",
      repo: "o/shipify",
      name: "SHIPIFY_ACCESS",
      value: JSON.stringify({ team: "myteam.cloudflareaccess.com", aud: AUD }),
    });
    expect(r.status).toBe("succeeded");
  });

  it("refuses values that don't read as Access's, and saves nothing", async () => {
    const w = world({ vars });
    const answers = ["example.com", "not-a-tag"];
    await expect(
      doorPage(true, { fetch: open, ask: async () => answers.shift() ?? "", say: () => {} }),
    ).rejects.toThrow("team address");
    expect(w.writes()).toEqual([]);
  });

  it("set up and signing in already: says so, and changes nothing", async () => {
    const w = world({
      vars: {
        ...vars,
        SHIPIFY_ACCESS: JSON.stringify({ team: "myteam.cloudflareaccess.com", aud: AUD }),
      },
    });
    const r = await doorPage(true, { fetch: behind, ask: async () => "x", say: () => {} });
    expect(r.summary).toContain("is set up");
    expect(w.writes()).toEqual([]);
  });

  it("set up, but no sign-in in front: walks you through it again, and Enter keeps both values", async () => {
    const saved = JSON.stringify({ team: "myteam.cloudflareaccess.com", aud: AUD });
    const w = world({ vars: { ...vars, SHIPIFY_ACCESS: saved } });
    const said: string[] = [];
    let moved = false;
    const fetch = (async (input: string) =>
      moved ? behind(input) : open(input)) as unknown as typeof globalThis.fetch;
    const r = await doorPage(true, {
      fetch,
      ask: async (q) => {
        expect(q).toContain("Enter keeps the one saved");
        moved = true;
        return "";
      },
      say: (l) => said.push(l),
    });
    expect(said.join("\n")).toContain("path: admin/*");
    expect(w.writes()).toContainEqual({
      call: "setVariable",
      repo: "o/shipify",
      name: "SHIPIFY_ACCESS",
      value: saved,
    });
    expect(r.status).toBe("succeeded");
  });
});

describe("ship selftest", () => {
  const gh = useFakeGh();
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "selftest-"));
    writeFileSync(
      join(dir, "executors.json"),
      JSON.stringify({ fake: { description: "fake", task: [process.execPath] } }),
    );
    vi.stubEnv("SHIPIFY_EXECUTORS_FILE", join(dir, "executors.json"));
    vi.stubEnv("SHIPIFY_EXECUTOR", "fake");
    vi.stubEnv("SHIPIFY_CREDENTIALS", join(dir, "none.env"));
    // Nothing here may knock on the edge.
    vi.stubGlobal("fetch", () => {
      throw new Error("no edge in this test");
    });
  });
  const due = (hoursAgo: number) =>
    gh.set((f) => {
      f.runs["watch.yml"] = [
        {
          id: 1,
          html_url: "https://github.com/o/shipify/actions/runs/1",
          status: "completed",
          conclusion: "success",
          display_title: "due",
          created_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
        },
      ];
    });

  it("refuses a part it doesn't have, and runs none", async () => {
    await expect(selftest("nope")).rejects.toMatchObject({
      status: "blocked",
      message: 'No part "nope". Parts: core, door, chat, sandbox, act, notebook, all.',
    });
    await expect(selftest("constructor")).rejects.toMatchObject({ status: "blocked" });
    expect(gh.read().calls).toEqual([]);
  });

  it("core: the plug-in files, the queue, the watch and the agent, each checked", async () => {
    due(1);
    const r = await selftest("core");
    expect(r.checks?.map((c) => [c.name, c.ok])).toEqual([
      ["core: plug-in files are right (tools.json, executors.json)", true],
      ["core: the queue answers (GitHub Actions)", true],
      ["core: the watch starts due runs", true],
      ["core: the default agent (fake) is here", true],
    ]);
    expect(r).toMatchObject({ status: "succeeded", summary: "4 checks passed (core)" });
  });

  it("all: the parts set up here (no door App yet: no door or chat), and each plug-in's check", async () => {
    due(1);
    const r = await selftest("all");
    const names = r.checks?.map((c) => c.name) ?? [];
    expect(names.some((n) => n.startsWith("door:") || n.startsWith("chat:"))).toBe(false);
    expect(names.some((n) => n.startsWith("sandbox:"))).toBe(true);
    expect(names.some((n) => n.startsWith("act: notion"))).toBe(true);
  });

  it("chat: skipped, passing, until Telegram is set up on this PC", async () => {
    const r = await selftest("chat");
    expect(r.checks).toEqual([
      {
        name: "chat: a message through the door, answered once",
        ok: true,
        blocking: false,
        detail: "skipped: Telegram isn't set up on this PC (pnpm ship add telegram --yes)",
      },
    ]);
  });

  it("a chat channel by name: its own check, with its setup's key from the credentials file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-"));
    writeFileSync(
      join(dir, "tools.json"),
      JSON.stringify({
        pager: {
          description: "a pager",
          in: { door: "pager" },
          check: [
            process.execPath,
            "-e",
            'const ok = Boolean(process.env.PAGER_TOKEN); console.log(ok ? "@pager, pointed at the edge" : "no token"); process.exit(ok ? 0 : 1)',
          ],
          setup: { keys: { PAGER_TOKEN: { ask: "the pager's token", to: "edge" } } },
        },
      }),
    );
    vi.stubEnv("SHIPIFY_TOOLS_FILE", join(dir, "tools.json"));
    vi.stubEnv("SHIPIFY_CREDENTIALS", join(dir, "credentials.env"));
    writeFileSync(join(dir, "credentials.env"), "");
    expect(await selftest("pager")).toMatchObject({
      status: "failed",
      summary: "pager: no key of it here to check (pnpm ship add pager)",
    });
    writeFileSync(join(dir, "credentials.env"), "PAGER_TOKEN=pager-token\n");
    const r = await selftest("pager");
    expect(r).toMatchObject({ status: "succeeded", summary: "pager: 1 checks passed" });
    expect(r.checks?.[0]).toMatchObject({ ok: true, detail: "@pager, pointed at the edge" });
  });

  it("a gateway, or a plug-in with no keys, by name: its own check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "named-"));
    writeFileSync(
      join(dir, "executors.json"),
      JSON.stringify({
        gateways: {
          gw: {
            description: "a gateway",
            url: "https://gw.example.com/v1",
            protocol: "openai-chat",
            key: "GW_KEY",
            how: "its keys page",
            check: "/key",
          },
        },
        fake: { description: "fake", task: [process.execPath] },
      }),
    );
    vi.stubEnv("SHIPIFY_EXECUTORS_FILE", join(dir, "executors.json"));
    writeFileSync(
      join(dir, "tools.json"),
      JSON.stringify({
        page: {
          description: "a chat on a page, with no keys",
          in: { door: "page" },
          check: [process.execPath, "-e", 'console.log("the page is fine")'],
        },
      }),
    );
    vi.stubEnv("SHIPIFY_TOOLS_FILE", join(dir, "tools.json"));
    vi.stubEnv("SHIPIFY_CREDENTIALS", join(dir, "credentials.env"));
    writeFileSync(join(dir, "credentials.env"), "");
    expect(await selftest("gw")).toMatchObject({
      status: "failed",
      summary: "gw: no key of it here to check (pnpm ship add gw)",
    });
    writeFileSync(join(dir, "credentials.env"), "GW_KEY=gw-key\n");
    vi.stubGlobal("fetch", async (url: string) =>
      String(url) === "https://gw.example.com/v1/key"
        ? new Response("{}", { status: 200 })
        : new Response("{}", { status: 401 }),
    );
    expect(await selftest("gw")).toMatchObject({
      status: "succeeded",
      summary: "gw: its key works",
    });
    expect(await selftest("page")).toMatchObject({
      status: "succeeded",
      checks: [{ name: "page's check passes", ok: true, detail: "the page is fine" }],
    });
  });

  it("chat: every channel someone is on, by its own check from tools.json, naming none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-"));
    const check = (last: string, code: number) => [
      process.execPath,
      "-e",
      `console.log("looked"); console.log(${JSON.stringify(last)}); process.exit(${code})`,
    ];
    writeFileSync(
      join(dir, "tools.json"),
      JSON.stringify({
        page: {
          description: "a chat on a page",
          in: { door: "page" },
          check: check("the page is fine", 0),
        },
        pager: {
          description: "a pager",
          in: { door: "pager" },
          check: check("the pager's hook is gone: pnpm ship add pager --yes", 1),
        },
        nobody: { description: "no one's on it", in: { door: "nobody" }, check: check("x", 1) },
      }),
    );
    vi.stubEnv("SHIPIFY_TOOLS_FILE", join(dir, "tools.json"));
    const people = [{ name: "me", on: { github: "o", page: "me", pager: "42" } }];
    writeFileSync(
      process.env.SHIPIFY_MOCK_CALLS as string,
      `${JSON.stringify({ call: "setVariable", repo: "o/shipify", name: "SHIPIFY_PEOPLE", value: JSON.stringify(people) })}\n`,
    );
    const r = await selftest("chat");
    expect(r.checks?.slice(0, 2)).toEqual([
      { name: "chat: page, by its own check", ok: true, detail: "the page is fine" },
      {
        name: "chat: pager, by its own check",
        ok: false,
        detail: "the pager's hook is gone: pnpm ship add pager --yes",
        fix: "pnpm ship add pager --yes",
      },
    ]);
    expect(r.checks).toHaveLength(3);
  });
});
