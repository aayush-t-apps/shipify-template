// `ship setup` (ADR 0027, step 5, cli/commands/setup.ts): each step checked against the real
// world, the first one not done is next, and an optional step never blocks.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { machineChecks } from "../cli/commands/doctor.ts";
import { asked, hidden, type Step, setup, setupChecks, steps } from "../cli/commands/setup.ts";
import { PLATFORM_ROOT } from "../cli/lib/config.ts";
import { credentialsFile } from "../cli/lib/credentials.ts";

// GitHub, as setup's checks ask it: each answer by its API path (as its --jq gives it), and a
// failure for any path it doesn't have (nothing there yet, or no access). And a stack's own check
// failing on this machine, when `stackCheckFails` says (the browser libraries' check: ldconfig).
// Nothing else is faked.
const github = vi.hoisted(() => ({
  answers: new Map<string, string>(),
  stackCheckFails: false,
  /** Each `gh variable set <name> … --body <value>`, as [name, value]. */
  set: [] as [string, string][],
}));
vi.mock("../cli/lib/exec.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cli/lib/exec.ts")>();
  return {
    ...real,
    run: (cmd: string, args: string[], opts?: Parameters<typeof real.run>[2]) => {
      if (cmd === "sh" && github.stackCheckFails && args[1]?.includes("ldconfig"))
        return { code: 1, stdout: "", stderr: "" };
      if (cmd !== "gh") return real.run(cmd, args, opts);
      if (args[0] === "variable" && args[1] === "set") {
        github.set.push([args[2] ?? "", args[args.indexOf("--body") + 1] ?? ""]);
        return { code: 0, stdout: "", stderr: "" };
      }
      // The path as asked, else without its paging (?per_page=30, --paginate): the whole list.
      const path = args[1] ?? "";
      // An answer for one field (`path|.field`) when a test gives one, else the path's.
      const jq = args.includes("--jq") ? args[args.indexOf("--jq") + 1] : undefined;
      const out =
        args[0] === "api"
          ? (github.answers.get(`${path}|${jq}`) ??
            github.answers.get(path) ??
            github.answers.get(path.split("?per_page=")[0] ?? ""))
          : undefined;
      return out === undefined
        ? { code: 1, stdout: "", stderr: "HTTP 404: Not Found" }
        : { code: 0, stdout: `${out}\n`, stderr: "" };
    },
  };
});

const step = (id: string, ok: boolean | Error, more: Partial<Step> = {}): Step => ({
  id,
  title: `step ${id}`,
  check: () => {
    if (ok instanceof Error) throw ok;
    return { ok, detail: ok ? "done" : "not yet" };
  },
  how: [`do ${id}`],
  ...more,
});

describe("ship setup", () => {
  it("shows each step, and the first one not done is next, with what to do", () => {
    const { checks, next } = setupChecks([step("a", true), step("b", false), step("c", false)]);
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ["step a", true],
      ["step b", false],
      ["step c", false],
    ]);
    expect(next?.id).toBe("b");
    expect(checks[1]?.fix).toBe("do b");
  });

  it("never lets an optional step block, and a check that breaks is a step to do, saying why", () => {
    const { checks, next } = setupChecks([
      step("a", true),
      step("door", false, { optional: true }),
      step("b", new Error("GitHub didn't answer\nmore")),
    ]);
    expect(checks[1]).toMatchObject({ ok: false, blocking: false });
    expect(next?.id).toBe("b");
    expect(checks[2]).toMatchObject({ ok: false, detail: "GitHub didn't answer" });
  });

  it("walks the core first (your copy, the bot, the agent, a box), then the add-ons, none of which blocks", () => {
    const all = steps();
    expect(all.map((s) => s.id)).toEqual([
      "tools",
      "github",
      "settings",
      "bot",
      "agent",
      "box",
      "door",
      "watch",
      "plugins",
      "repos",
      "apps",
      "updates",
    ]);
    expect(all.filter((s) => s.optional).map((s) => s.id)).toEqual([
      "door",
      "watch",
      "plugins",
      "repos",
      "apps",
      "updates",
    ]);
    for (const s of all) {
      const how = typeof s.how === "function" ? s.how() : s.how;
      expect(how.length + (s.id === "agent" ? 1 : 0)).toBeGreaterThan(0);
    }
  });
});

describe("ship setup: each step's check, from what's there", () => {
  // Your copy's owner: its repo's (ADR 0047), o/shipify here.
  const owner = "o";
  const R = "repos/o/shipify";
  const DOOR = "https://shipify.example.com";
  const hostingKeys = () =>
    (steps().find((s) => s.id === "apps")?.keys ?? []).map(([name]) => name);
  /** Each step's check but the PC's tools (what's installed here), by its id. */
  const state = () =>
    Object.fromEntries(
      steps()
        .filter((s) => s.id !== "tools")
        .map((s) => [s.id, s.check()]),
    );

  /** The edge's Worker's secrets, as the fake wrangler keeps them. */
  let worker = "";
  const onEdge = (...names: string[]) =>
    writeFileSync(
      worker,
      JSON.stringify({ secrets: Object.fromEntries(names.map((n) => [n, "x"])), calls: [] }),
    );
  /** Your copy's variables, everything set up: you're on the web page's chat too. */
  const VARS = `SHIPIFY_TIME_ZONE\tAsia/Kolkata\nCLOUDFLARE_ACCOUNT_ID\tacct\nCF_WORKERS_SUBDOMAIN\texample\nSHIPIFY_BOT_CLIENT_ID\tIv1.abc\nSHIPIFY_BOT_SLUG\tshipify-bot\nSHIPIFY_REPOS_CLIENT_ID\tIv1.def\nSHIPIFY_REPOS_SLUG\tshipify-repos\nSHIPIFY_ACCOUNTS\tacme\nSHIPIFY_OWNER\tme\nSHIPIFY_PEOPLE\t[{"name":"me","on":{"github":"me","page":"me"}}]\nSHIPIFY_DOOR_APP_ID\t42\nSHIPIFY_DOOR_SLUG\to-door\nSHIPIFY_DOOR_INSTALLATION\t99\nSHIPIFY_DOOR_URL\t${DOOR}\nSHIPIFY_REPO_ID\t1\nSHIPIFY_OWNER_ID\t2\nSHIPIFY_TEMPLATE\to/shipify-template`;
  /** Everything set up: GitHub's answers, this PC's keys and the door. */
  const allThere = () => {
    for (const [path, answer] of Object.entries({
      user: "me",
      [`orgs/${owner}`]: owner,
      [R]: "shipify",
      [`${R}|.permissions.admin`]: "true",
      [`user/memberships/orgs/${owner}`]: "active",
      [`${R}/actions/secrets`]: [
        "SHIPIFY_BOT_KEY",
        "SHIPIFY_REPOS_KEY",
        "FAKE_AGENT_LOGIN",
        ...hostingKeys(),
      ].join("\n"),
      [`${R}/actions/variables`]: VARS,
      "repos/o/shipify-template/releases/latest|.tag_name": "v0.1.0",
      [`${R}/actions/runners?per_page=100`]: JSON.stringify({
        runners: [
          {
            id: 1,
            name: "mybox-1",
            status: "online",
            labels: [{ name: "shipify-box" }, { name: "sandbox" }],
          },
          { id: 2, name: "other", status: "online", labels: [{ name: "self-hosted" }] },
        ],
      }),
      [`${R}/actions/workflows/watch.yml/runs?per_page=30`]: JSON.stringify({
        workflow_runs: [
          {
            display_title: "due",
            status: "completed",
            conclusion: "success",
            created_at: new Date().toISOString(),
          },
        ],
      }),
    }))
      github.answers.set(path, answer);
    for (const k of hostingKeys()) vi.stubEnv(k, `${k.toLowerCase()}-for-tests`);
    vi.stubEnv("SHIPIFY_FAKE_READ", "fake-key-for-tests");
    onEdge("SHIPIFY_DOOR_APP_KEY");
  };

  beforeEach(() => {
    github.answers.clear();
    github.stackCheckFails = false;
    const executors = join(mkdtempSync(join(tmpdir(), "setup-")), "executors.json");
    writeFileSync(
      executors,
      JSON.stringify({
        // And an agent through a gateway, whose login is the gateway's key.
        gateways: {
          gw: {
            description: "a gateway",
            url: "https://gw.example.com/v1",
            protocol: "openai-chat",
            key: "FAKE_GATEWAY_KEY",
            how: "gw's keys page",
          },
        },
        fake: {
          description: "fake",
          task: [process.execPath],
          login: { secret: "FAKE_AGENT_LOGIN", how: "fake login" },
        },
        viagw: { description: "through gw", task: [process.execPath], gateways: ["gw"] },
      }),
    );
    vi.stubEnv("SHIPIFY_EXECUTORS_FILE", executors);
    vi.stubEnv("SHIPIFY_EXECUTOR", "fake");
    vi.stubEnv("GITHUB_REPOSITORY", "o/shipify");
    // One plug-in with a setup, whatever tools.json holds: its key added, or not. And a chat
    // channel with no keys (the web chat's kind): added once someone's on it.
    const tools = join(mkdtempSync(join(tmpdir(), "setup-")), "tools.json");
    writeFileSync(
      tools,
      JSON.stringify({
        fakedb: {
          description: "fake",
          run: ["x"],
          keys: { FAKE: { look: "SHIPIFY_FAKE_READ" } },
          look: ["read"],
          setup: { keys: { SHIPIFY_FAKE_READ: { ask: "a key" } } },
        },
        pagechat: { description: "a chat on a page", in: { door: "page" }, setup: {} },
      }),
    );
    vi.stubEnv("SHIPIFY_TOOLS_FILE", tools);
    // The edge's Worker: a fake wrangler's, holding nothing yet.
    worker = join(mkdtempSync(join(tmpdir(), "setup-")), "wrangler.json");
    onEdge();
    vi.stubEnv("SHIPIFY_WRANGLER", join(PLATFORM_ROOT, "tests/fixtures/fake-wrangler.mjs"));
    vi.stubEnv("FAKE_WRANGLER_STATE", worker);
    for (const k of [...hostingKeys(), "SHIPIFY_FAKE_READ"]) vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("from nothing, each step is to do, saying what's missing", () => {
    expect(state()).toEqual({
      github: { ok: false, detail: "this PC isn't signed in to GitHub (gh auth status)" },
      settings: { ok: false, detail: "once your copy's repo is there" },
      bot: { ok: false, detail: "not registered yet" },
      agent: { ok: false, detail: "o/shipify has no secret FAKE_AGENT_LOGIN" },
      box: { ok: false, detail: "the repo's runners couldn't be read" },
      door: { ok: false, detail: "no door App yet" },
      watch: { ok: false, detail: "the watch's runs couldn't be read" },
      plugins: { ok: false, detail: "available: fakedb, pagechat (pnpm ship add <name>)" },
      repos: { ok: false, detail: "not set up: only for repos on another of your accounts" },
      apps: hostingKeys().length
        ? { ok: false, detail: `${credentialsFile()} has no ${hostingKeys().join(", ")}` }
        : { ok: false, detail: "once your copy's repo is there" },
      updates: {
        ok: false,
        detail: "this copy follows no template (made with Use this template, it follows its own)",
      },
    });
  });

  it("all set up, each step is done, saying what's there, and nothing is next", () => {
    allThere();
    expect(state()).toEqual({
      github: { ok: true, detail: `o/shipify, in ${owner}` },
      settings: { ok: true, detail: "SHIPIFY_TIME_ZONE Asia/Kolkata" },
      bot: { ok: true, detail: "shipify-bot" },
      agent: { ok: true, detail: "FAKE_AGENT_LOGIN is set" },
      box: { ok: true, detail: "1 slot(s) online for tasks" },
      door: { ok: true, detail: `the door App 42, at ${DOOR} (pnpm ship door check tests it)` },
      watch: { ok: true, detail: "last due run within the hour" },
      plugins: { ok: true, detail: "added: fakedb, pagechat" },
      repos: { ok: true, detail: "shipify-repos; your accounts: acme" },
      apps: {
        ok: true,
        detail: `keys in ${credentialsFile()} and on o/shipify; your settings`,
      },
      updates: { ok: true, detail: "follows o/shipify-template (newest: v0.1.0)" },
    });
    expect(JSON.stringify(state())).not.toContain("for-tests");
    expect(setupChecks(steps().filter((s) => s.id !== "tools")).next).toBeUndefined();
  });

  it("each step half done says which half", () => {
    allThere();
    github.answers.set(`${R}|.permissions.admin`, "false");
    github.answers.delete(`${R}/actions/secrets`);
    github.answers.set(
      `${R}/actions/runners?per_page=100`,
      JSON.stringify({
        runners: [{ id: 1, name: "mybox-1", status: "offline", labels: [{ name: "shipify-box" }] }],
      }),
    );
    github.answers.set(
      `${R}/actions/workflows/watch.yml/runs?per_page=30`,
      JSON.stringify({
        workflow_runs: [
          {
            display_title: "due",
            status: "completed",
            conclusion: "success",
            created_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
          },
        ],
      }),
    );
    github.answers.set(`${R}/actions/variables`, "SHIPIFY_BOT_SLUG\tshipify-bot");
    const now = state();
    expect(now.github).toEqual({
      ok: false,
      detail: "me can't administer o/shipify: it isn't your copy",
    });
    expect(now.settings).toEqual({
      ok: false,
      detail: "o/shipify has no variable SHIPIFY_TIME_ZONE",
    });
    expect(now.bot).toEqual({ ok: false, detail: "not registered yet" });
    expect(now.agent).toEqual({ ok: false, detail: "o/shipify has no secret FAKE_AGENT_LOGIN" });
    expect(now.box).toEqual({ ok: false, detail: "every box is offline" });
    expect(now.watch).toEqual({
      ok: false,
      detail: "last due run 30 h ago: the watch has stopped (docs/watch.md)",
    });
    expect(now.door).toEqual({ ok: false, detail: "no door App yet" });
    if (hostingKeys().length)
      expect(now.apps).toEqual({
        ok: false,
        detail: `o/shipify has no variables CLOUDFLARE_ACCOUNT_ID, CF_WORKERS_SUBDOMAIN nor secret ${hostingKeys().join(", ")} yet (a merged plan is published with them)`,
      });
    // A box online with no sandbox (this PC's own, say) takes no task: never ✓.
    github.answers.set(
      `${R}/actions/runners?per_page=100`,
      JSON.stringify({
        runners: [{ id: 1, name: "mybox-1", status: "online", labels: [{ name: "shipify-box" }] }],
      }),
    );
    expect(state().box).toEqual({
      ok: false,
      detail: "1 slot(s) online, none with the sandbox, so none takes a task",
    });
    // The apps: each half, in order.
    secretsOnRepo("SHIPIFY_BOT_KEY", "FAKE_AGENT_LOGIN", ...hostingKeys());
    expect(state().apps).toEqual({
      ok: false,
      detail:
        "o/shipify has no variables CLOUDFLARE_ACCOUNT_ID, CF_WORKERS_SUBDOMAIN yet (a merged plan is published with them)",
    });
    github.answers.set(
      `${R}/actions/variables`,
      "CLOUDFLARE_ACCOUNT_ID\tacct\nCF_WORKERS_SUBDOMAIN\texample",
    );
    // Each app carries its own pipeline (ADR 0048): no workflow access to grant, no tag to wait for.
    expect(state().apps).toEqual({
      ok: true,
      detail: `keys in ${credentialsFile()} and on o/shipify; your settings`,
    });
    // Updates: the template the copy's version file names, on another account and unreadable from
    // here. Only a key reads it then, so the step asks for one.
    github.answers.set(
      `${R}/contents/package.json|.content`,
      Buffer.from(JSON.stringify({ shipify: { template: "acme/shipify-template" } })).toString(
        "base64",
      ),
    );
    expect(state().updates).toEqual({
      ok: false,
      detail:
        "acme/shipify-template is on another account, and private or not readable from this PC: o/shipify has no secret SHIPIFY_TEMPLATE_TOKEN, so its weekly check can't read it",
    });
    secretsOnRepo("SHIPIFY_TEMPLATE_TOKEN");
    expect(state().updates).toEqual({
      ok: true,
      detail: "follows acme/shipify-template, read with its key (not from this PC)",
    });
    // Its key, where this PC keeps a copy, must read the template: expired or wrong, it can't.
    const creds = join(mkdtempSync(join(tmpdir(), "updates-")), "creds.env");
    writeFileSync(creds, "SHIPIFY_TEMPLATE_TOKEN=expired-for-tests\n", { mode: 0o600 });
    vi.stubEnv("SHIPIFY_CREDENTIALS", creds);
    expect(state().updates).toEqual({
      ok: false,
      detail:
        "its key, SHIPIFY_TEMPLATE_TOKEN, can't read acme/shipify-template: expired, or not for that repo",
    });
    github.answers.set("repos/acme/shipify-template|.full_name", "acme/shipify-template");
    expect(state().updates).toEqual({
      ok: true,
      detail: "follows acme/shipify-template, read with its key",
    });
  });

  it("the door: its App's key on the edge too, which only the edge can say it holds", () => {
    allThere();
    onEdge();
    expect(state().door).toEqual({
      ok: false,
      detail: "the edge doesn't hold SHIPIFY_DOOR_APP_KEY",
    });
  });

  it("the agent's login is the default agent's (SHIPIFY_AGENT's): a gateway's key, then", () => {
    allThere();
    github.answers.set(`${R}/actions/variables`, `${VARS}\nSHIPIFY_AGENT\tviagw`);
    const agent = () => steps().find((s) => s.id === "agent") as Step;
    expect(agent().check()).toEqual({
      ok: false,
      detail: "o/shipify has no secret FAKE_GATEWAY_KEY",
    });
    const how = agent().how;
    expect((typeof how === "function" ? how() : how).join(" ")).toContain("checked with gw");
    secretsOnRepo("FAKE_GATEWAY_KEY");
    expect(agent().check()).toEqual({ ok: true, detail: "FAKE_GATEWAY_KEY is set" });
  });

  it("a copy on your own user account is yours: no organization needed", () => {
    allThere();
    github.answers.set("user", owner);
    expect(state().github).toEqual({ ok: true, detail: "o/shipify, on your own account" });
  });
});

describe("ship setup: your settings", () => {
  const settings = () => steps().find((s) => s.id === "settings") as Step;
  const pcZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let credentials = "";
  beforeEach(() => {
    github.answers.clear();
    github.set.length = 0;
    vi.stubEnv("GITHUB_REPOSITORY", "o/shipify");
    credentials = join(mkdtempSync(join(tmpdir(), "settings-")), "credentials.env");
    vi.stubEnv("SHIPIFY_CREDENTIALS", credentials);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("are the list's: your time zone (this PC's offered), and each value apps deploy with (this PC's copy offered, never shown)", () => {
    expect(asked("settings")).toEqual([
      {
        name: "SHIPIFY_TIME_ZONE",
        what: "Your time zone, like Europe/London",
        now: pcZone,
        shown: pcZone,
      },
    ]);
    writeFileSync(credentials, "CLOUDFLARE_ACCOUNT_ID=acct\n", { mode: 0o600 });
    expect(asked("apps").map((w) => [w.name, w.now, w.shown])).toEqual([
      ["CLOUDFLARE_ACCOUNT_ID", "acct", "this PC's copy"],
      ["CF_WORKERS_SUBDOMAIN", undefined, undefined],
    ]);
  });

  it("asks only what's missing, sets each on your copy's repo and keeps it here; a wrong one is said, and nothing is set", async () => {
    github.answers.set("repos/o/shipify", "shipify");
    github.answers.set(
      "repos/o/shipify/actions/variables",
      "CLOUDFLARE_ACCOUNT_ID\tacct\nCF_WORKERS_SUBDOMAIN\texample",
    );
    const asked: string[] = [];
    const ask = (answer: string) => ({
      line: async (q: string) => {
        asked.push(q);
        return answer;
      },
      hidden: async () => "",
    });
    const act = settings().act as NonNullable<Step["act"]>;
    expect(await act(ask("Not/AZone"))).toEqual([
      "Not/AZone isn't a time zone (like Europe/London): try again.",
    ]);
    expect(asked).toEqual([`Your time zone, like Europe/London [${pcZone}]: `]);
    expect(github.set).toEqual([]);
    // Enter takes what's shown: this PC's zone.
    expect(await act(ask(""))).toEqual([
      `Set SHIPIFY_TIME_ZONE on o/shipify, and kept it in ${credentials}.`,
    ]);
    expect(github.set).toEqual([["SHIPIFY_TIME_ZONE", pcZone]]);
    expect(readFileSync(credentials, "utf8")).toContain(`SHIPIFY_TIME_ZONE=${pcZone}`);
  });
});

describe("ship setup: the steps that do more than check", () => {
  const R = "repos/o/shipify";
  const step = (id: string) => steps().find((s) => s.id === id) as Step;
  const hostingKeys = () => (step("apps").keys ?? []).map(([name]) => name);
  beforeEach(() => {
    github.answers.clear();
    github.stackCheckFails = false;
    vi.stubEnv("GITHUB_REPOSITORY", "o/shipify");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the tools: the core's alone (Node, pnpm, git, gh); a stack's missing libraries are doctor's, and the apps'", () => {
    github.stackCheckFails = true;
    expect(step("tools").check().detail).not.toContain("browser libraries");
    if (!listsBrowserCheck()) return; // no stack here checks the browser libraries
    const lib = machineChecks().find((c) => c.name.includes("browser libraries"));
    expect(lib?.ok).toBe(false);
    expect(lib?.fix).toContain("install-deps");
  });

  it("your copy: points this checkout at your repo before the push", () => {
    const how = step("github").how;
    const text = (typeof how === "function" ? how() : how).join("\n");
    expect(text).toContain("git remote set-url origin https://github.com/<you>/shipify.git");
    expect(text.indexOf("git remote set-url")).toBeLessThan(text.indexOf("git push"));
  });

  it("the agent's login: pasted at setup's own hidden prompt and set as the secret, never shown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-"));
    const log = join(dir, "calls.jsonl");
    const executors = join(dir, "executors.json");
    writeFileSync(
      executors,
      JSON.stringify({
        fake: {
          description: "fake",
          task: [process.execPath],
          login: { secret: "FAKE_AGENT_LOGIN", how: "fake login" },
        },
      }),
    );
    vi.stubEnv("SHIPIFY_EXECUTORS_FILE", executors);
    vi.stubEnv("SHIPIFY_EXECUTOR", "fake");
    vi.stubEnv("SHIPIFY_CREDENTIALS", join(dir, "creds.env"));
    vi.stubEnv("SHIPIFY_PROVIDER", "mock");
    vi.stubEnv("SHIPIFY_MOCK_CALLS", log);
    let asks = 0;
    const prompt = {
      hidden: async () => {
        asks++;
        return "fake-login-for-tests";
      },
      line: async () => "",
    };
    const said = await step("agent").act?.(prompt);
    const written = readFileSync(log, "utf8");
    expect(written).toContain('"name":"FAKE_AGENT_LOGIN"');
    expect(written).not.toContain("for-tests");
    expect(JSON.stringify(said ?? "")).not.toContain("for-tests");
    // Set, it's left as it is; --new (a renewed login) asks again and replaces it.
    await step("agent").act?.(prompt);
    expect(asks).toBe(1);
    await step("agent").act?.(prompt, true);
    expect(asks).toBe(2);
    expect(readFileSync(log, "utf8").match(/"name":"FAKE_AGENT_LOGIN"/g)).toHaveLength(2);
  });

  it("the apps' keys: on this PC, then on your copy once it's there (ship setup apps), set from this PC and never shown; what they find, set too", async () => {
    if (!hostingKeys().length) return;
    // The host, asked with the deploy key: one account, and its workers.dev name.
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json({
        result: String(url).endsWith("/accounts")
          ? [{ id: "0123456789abcdef0123456789abcdef" }]
          : { subdomain: "mine" },
      }),
    );
    const dir = mkdtempSync(join(tmpdir(), "hosting-"));
    const creds = join(dir, "creds.env");
    const log = join(dir, "calls.jsonl");
    vi.stubEnv("SHIPIFY_CREDENTIALS", creds);
    vi.stubEnv("SHIPIFY_PROVIDER", "mock");
    vi.stubEnv("SHIPIFY_MOCK_CALLS", log);
    for (const k of hostingKeys()) vi.stubEnv(k, "");
    expect(step("apps").check().ok).toBe(false);
    writeFileSync(
      creds,
      hostingKeys()
        .map((k) => `${k}=${k.toLowerCase()}-for-tests\n`)
        .join(""),
      {
        mode: 0o600,
      },
    );
    // No repo yet: the keys are where they can be, and go on the repo once it's there.
    expect(step("apps").check()).toEqual({ ok: false, detail: "once your copy's repo is there" });
    github.answers.set(R, "shipify");
    secretsOnRepo("SHIPIFY_BOT_KEY");
    expect(step("apps").check()).toEqual({
      ok: false,
      detail: `o/shipify has no variables CLOUDFLARE_ACCOUNT_ID, CF_WORKERS_SUBDOMAIN nor secret ${hostingKeys().join(", ")} yet (a merged plan is published with them)`,
    });
    // An add-on, done by its name: `ship setup apps` (Enter takes what was found).
    github.set.length = 0;
    const said = await setup({
      step: "apps",
      interactive: true,
      prompt: { hidden: async () => "", line: async () => "" },
    });
    const written = readFileSync(log, "utf8");
    for (const k of hostingKeys()) expect(written).toContain(`"name":"${k}"`);
    expect(written).not.toContain("for-tests");
    expect(JSON.stringify(said)).not.toContain("for-tests");
    expect(existsSync(log)).toBe(true);
    expect(github.set).toEqual([
      ["CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef"],
      ["CF_WORKERS_SUBDOMAIN", "mine"],
    ]);
  });
});

/** Whether a stack here checks the browser libraries (ts-worker, ts-static do). */
const listsBrowserCheck = () =>
  readFileSync(join(PLATFORM_ROOT, "stacks/ts-worker/stack.json"), "utf8").includes("ldconfig");
const secretsOnRepo = (...names: string[]) =>
  github.answers.set("repos/o/shipify/actions/secrets", names.join("\n"));

describe("ship setup: a key you paste", () => {
  it("is taken with only the question shown, never the key, typed or pasted", async () => {
    for (const typing of [["k", "-for", "-tests", "\r"], ["k-for-tests\n"]]) {
      const input = new PassThrough();
      const output = new PassThrough();
      let shown = "";
      output.on("data", (d: Buffer) => {
        shown += d.toString();
      });
      const answer = hidden("Paste the key (hidden; Enter to skip): ", input, output);
      for (const t of typing) input.write(t);
      expect(await answer).toBe("k-for-tests");
      expect(shown).toContain("Paste the key (hidden; Enter to skip): ");
      expect(shown).not.toMatch(/k-|for|tests/);
    }
  });
});
