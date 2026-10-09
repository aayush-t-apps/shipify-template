// Telegram, Shipify's side: its setup for the edge (ADR 0031: tools/telegram/setup.ts) against a
// fake Bot API, a fake edge and a fake wrangler, step by step and as `ship add telegram`. Each setup test has a world of its own: its credentials file, its
// servers, the mock provider's log of what it wrote to GitHub, and the edge's secrets (hashes).
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chatMenu } from "../cli/contracts/answers.ts";
import { SERVE_TIMEOUT, serve } from "./fixtures/fakes.ts";
import { ROOT, sandbox, ship } from "./helpers.ts";

const tsx = (script: string, args: string[], env: Record<string, string>, input?: string) =>
  spawnSync(process.execPath, ["--import", "tsx", join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });

const _SEND = "a-send-key-for-tests";

/** One write the mock provider made, from its log. */
type Write = { call: string; repo: string; name?: string; value?: string; sha?: string };

/**
 * A world of one test's own: a fake Bot API (the token "good"), a fake edge, a fake wrangler whose
 * state the edge reads (its secrets, as hashes), shipify's variable SHIPIFY_DOOR_URL pointing at the
 * fake edge, a credentials file (and `creds` added), and the mock provider's log (`writes`).
 */
async function world(opts: { creds?: string; log?: Write[]; app?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tg-"));
  const state = join(dir, "wrangler.json");
  writeFileSync(state, JSON.stringify({ secrets: {}, calls: [] }));
  const api = await serve("fake-telegram.mjs");
  const edge = await serve("fake-edge.mjs", {
    FAKE_WRANGLER_STATE: state,
    ...(opts.app ? { FAKE_EDGE_APP: opts.app } : {}),
  });
  const creds = join(dir, "creds.env");
  writeFileSync(creds, `CF_DEPLOY_TOKEN=cf-test\nCLOUDFLARE_ACCOUNT_ID=acct\n${opts.creds ?? ""}`, {
    mode: 0o600,
  });
  const log = join(dir, "calls.jsonl");
  const seed: Write[] = [
    { call: "setVariable", repo: "o/shipify", name: "SHIPIFY_DOOR_URL", value: edge.url },
    ...(opts.log ?? []),
  ];
  writeFileSync(log, seed.map((w) => `${JSON.stringify(w)}\n`).join(""));
  const env: Record<string, string> = {
    SHIPIFY_CREDENTIALS: creds,
    SHIPIFY_PROVIDER: "mock",
    SHIPIFY_MOCK_CALLS: log,
    SHIPIFY_OWNER: "owner",
    GITHUB_REPOSITORY: "o/shipify",
    TELEGRAM_API: api.url,
    SHIPIFY_WAIT_MS: "0",
    SHIPIFY_WRANGLER: join(ROOT, "tests/fixtures/fake-wrangler.mjs"),
    FAKE_WRANGLER_STATE: state,
  };
  const lines = (file: string) =>
    existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
  const w = {
    api,
    edge,
    dir,
    creds,
    env,
    step: (name: string, more: Record<string, string> = {}) =>
      tsx("tools/telegram/setup.ts", [name], { ...env, ...more }),
    /** What the bot was asked, in order. */
    bot: () =>
      lines(join(api.dir, "calls.jsonl")).map(
        (l) => JSON.parse(l) as { method: string; args: Record<string, unknown> },
      ),
    /** What the mock provider wrote to GitHub in this test, after what it started with. */
    writes: () =>
      lines(log)
        .map((l) => JSON.parse(l) as Write)
        .slice(seed.length),
    /** The edge's secrets: names, and hashes of their values. */
    secrets: () =>
      (JSON.parse(readFileSync(state, "utf8")) as { secrets: Record<string, string> }).secrets,
    credsText: () => readFileSync(creds, "utf8"),
    stop: () => {
      api.stop();
      edge.stop();
    },
  };
  worlds.push(w);
  return w;
}
const worlds: { stop: () => void }[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.stop();
});
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

describe("Telegram's setup steps", () => {
  it(
    "checks the token, and says plainly when Telegram refuses it",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      const ok = w.step("token");
      expect(ok.status, ok.stdout).toBe(0);
      expect(ok.stdout).toContain("the bot is @shipify_test_bot");
      expect(w.credsText()).toContain("TELEGRAM_BOT=shipify_test_bot");
      const bad = w.step("token", { TELEGRAM_TOKEN: "bad" });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain(
        "Telegram refused the token: copy it again from @BotFather, then pnpm ship add telegram --new --yes",
      );
      expect(bad.stdout + bad.stderr).not.toContain("bad/");
    },
    SERVE_TIMEOUT,
  );

  it(
    "sets the menu of four, the help as its description, and its photo once",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      expect(w.step("menu").status).toBe(0);
      const set = w
        .bot()
        .filter((c) => c.method === "setMyCommands")
        .at(-1);
      const names = ((set?.args.commands ?? []) as { command: string }[]).map((c) => c.command);
      // The menu of four (ADR 0042): the rest work typed, and /help lists them.
      expect(names).toEqual(["ask", "tasks", "use", "help"]);
      expect(names).toEqual(chatMenu().commands.map((c) => c.command));
      const said = w
        .bot()
        .filter((c) => c.method === "setMyDescription")
        .at(-1)?.args;
      expect(said?.description).toBe(chatMenu().description);
      // Its photo: Shipify's logo, uploaded as a JPG; once, so a second run stacks none.
      const photo = () => w.bot().filter((c) => c.method === "setMyProfilePhoto");
      expect(photo()).toHaveLength(1);
      expect(photo()[0]?.args).toMatchObject({
        photo: '{"type":"static","photo":"attach://logo"}',
        logo: "logo.jpg",
      });
      expect(w.step("menu").status).toBe(0);
      expect(photo()).toHaveLength(1);
    },
    SERVE_TIMEOUT,
  );

  it(
    "gives the edge Telegram's secret: made here, put with wrangler, kept here; a new one with --new",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      const r = w.step("edge");
      expect(r.status, r.stdout).toBe(0);
      const secret = /^TELEGRAM_SECRET=([0-9a-f]{64})$/m.exec(w.credsText())?.[1] as string;
      expect(w.secrets().TELEGRAM_SECRET).toBe(hash(secret));
      expect(r.stdout + r.stderr).not.toContain(secret);
      // With the token there too, a second run leaves it as it is.
      w.secrets();
      const state = JSON.parse(readFileSync(w.env.FAKE_WRANGLER_STATE as string, "utf8"));
      state.secrets.TELEGRAM_TOKEN = hash("good");
      writeFileSync(w.env.FAKE_WRANGLER_STATE as string, JSON.stringify(state));
      expect(w.step("edge").stdout).toContain("the edge has Telegram's keys already");
      expect(w.credsText()).toContain(`TELEGRAM_SECRET=${secret}`);
      expect(w.step("edge", { SHIPIFY_RENEW: "1" }).status).toBe(0);
      expect(w.credsText()).not.toContain(`TELEGRAM_SECRET=${secret}`);
    },
    SERVE_TIMEOUT,
  );

  it(
    "says why when wrangler can't reach the edge, and keeps no secret it couldn't put",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      const r = w.step("edge", { FAKE_WRANGLER_FAIL: "1" });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("Couldn't read the edge's secrets");
      expect(w.credsText()).not.toContain("TELEGRAM_SECRET=");
    },
    SERVE_TIMEOUT,
  );

  it(
    "links you by a code made from Telegram's secret: your id in SHIPIFY_PEOPLE, Telegram in SHIPIFY_SEND",
    async () => {
      const secret = "a".repeat(64);
      const w = await world({
        creds: `TELEGRAM_TOKEN=good\nTELEGRAM_BOT=shipify_test_bot\nTELEGRAM_SECRET=${secret}\n`,
        log: [
          {
            call: "setVariable",
            repo: "o/shipify",
            name: "SHIPIFY_PEOPLE",
            value: '[{"name":"Aayush","on":{"github":"aayush"}}]',
          },
          { call: "setVariable", repo: "o/shipify", name: "SHIPIFY_SEND", value: "email" },
        ],
      });
      const shown = w.step("link");
      const code = /\?start=(\d+)\.([0-9a-f]{16})\n/.exec(shown.stderr);
      expect(code).not.toBeNull();
      const key = createHmac("sha256", secret).update("shipify:link").digest("hex");
      expect(code?.[2]).toBe(
        createHmac("sha256", key).update(`telegram|${code?.[1]}`).digest("hex").slice(0, 16),
      );
      expect(w.step("link", { TELEGRAM_ID: "abc" }).status).toBe(1);
      const r = w.step("link", { TELEGRAM_ID: "123456789" });
      expect(r.status, r.stdout).toBe(0);
      expect(w.writes()).toEqual([
        {
          call: "setVariable",
          repo: "o/shipify",
          name: "SHIPIFY_PEOPLE",
          value: '[{"name":"Aayush","on":{"github":"aayush","telegram":"123456789"}}]',
        },
        { call: "setVariable", repo: "o/shipify", name: "SHIPIFY_SEND", value: "email,telegram" },
      ]);
    },
    SERVE_TIMEOUT,
  );
});

describe("Telegram's setup: pointing the bot at the edge", () => {
  it(
    "points the bot at the edge once it holds the secret: one update at a time, messages and taps",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      expect(w.step("edge").status).toBe(0);
      const r = w.step("webhook");
      expect(r.status, r.stdout).toBe(0);
      const secret = /^TELEGRAM_SECRET=(\w+)$/m.exec(w.credsText())?.[1];
      expect(w.bot().find((c) => c.method === "setWebhook")?.args).toEqual({
        url: `${w.edge.url}/door/telegram`,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        max_connections: 1,
      });
    },
    SERVE_TIMEOUT,
  );

  it(
    "won't point the bot at the old Worker before the release deploys the edge",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n", app: "shipify-admin" });
      expect(w.step("edge").status).toBe(0);
      const r = w.step("webhook");
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("isn't the edge yet (it says it's shipify-admin)");
      expect(w.bot().some((c) => c.method === "setWebhook")).toBe(false);
    },
    SERVE_TIMEOUT,
  );

  it(
    "says the route isn't ready when the edge never takes the secret, and points nothing",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\nTELEGRAM_SECRET=not-the-edges\n" });
      const r = w.step("webhook");
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("isn't ready (it answered 503)");
      expect(w.bot().some((c) => c.method === "setWebhook")).toBe(false);
    },
    SERVE_TIMEOUT,
  );
});

describe("Telegram's check", () => {
  it(
    "on your PC: pointed at the edge, one update at a time, no error lately; on a box: nothing to check",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      expect(w.step("--check").stdout).toContain("isn't pointed at the edge");
      expect(w.step("edge").status).toBe(0);
      expect(w.step("webhook").status).toBe(0);
      const ok = w.step("--check");
      expect(ok.status, ok.stdout).toBe(0);
      expect(ok.stdout).toContain("@shipify_test_bot, pointed at the edge");
      // Pointed without taps (set before buttons): named, with the fix.
      writeFileSync(join(w.api.dir, "updates"), '["message"]');
      const taps = w.step("--check");
      expect(taps.status).toBe(1);
      expect(taps.stdout).toContain(
        "doesn't send button taps to the edge: pnpm ship add telegram --yes",
      );
      writeFileSync(join(w.api.dir, "updates"), '["message","callback_query"]');
      writeFileSync(join(w.api.dir, "error"), "Wrong response from the webhook: 503");
      const late = w.step("--check");
      expect(late.status).toBe(1);
      expect(late.stdout).toContain("Wrong response from the webhook: 503");
      const box = w.step("--check", {
        SHIPIFY_CREDENTIALS: join(w.dir, "none.env"),
        TELEGRAM_TOKEN: "",
      });
      expect(box.status).toBe(0);
      expect(box.stdout).toContain("nothing to check here");
    },
    SERVE_TIMEOUT,
  );
});

describe("Telegram's setup: undone", () => {
  it(
    "points the bot nowhere, unlinks you, drops an empty SHIPIFY_SEND, and takes the secret off the edge",
    async () => {
      const w = await world({
        creds: "TELEGRAM_TOKEN=good\nTELEGRAM_ID=123\nTELEGRAM_SECRET=s\nTELEGRAM_BOT=b\n",
        log: [
          {
            call: "setVariable",
            repo: "o/shipify",
            name: "SHIPIFY_PEOPLE",
            value: '[{"name":"owner","on":{"github":"owner","telegram":"123"}}]',
          },
          { call: "setVariable", repo: "o/shipify", name: "SHIPIFY_SEND", value: "telegram" },
        ],
      });
      const state = JSON.parse(readFileSync(w.env.FAKE_WRANGLER_STATE as string, "utf8"));
      state.secrets.TELEGRAM_SECRET = hash("s");
      writeFileSync(w.env.FAKE_WRANGLER_STATE as string, JSON.stringify(state));
      const r = w.step("--remove");
      expect(r.status, r.stdout).toBe(0);
      expect(w.bot().some((c) => c.method === "deleteWebhook")).toBe(true);
      expect(w.writes()).toEqual([
        {
          call: "setVariable",
          repo: "o/shipify",
          name: "SHIPIFY_PEOPLE",
          value: '[{"name":"owner","on":{"github":"owner"}}]',
        },
        { call: "deleteVariable", repo: "o/shipify", name: "SHIPIFY_SEND" },
      ]);
      expect(w.secrets()).toEqual({});
      expect(w.credsText()).not.toMatch(/TELEGRAM_(ID|SECRET|BOT)=/);
    },
    SERVE_TIMEOUT,
  );
});

// `ship add telegram`, every step in order against the fakes, as you'd run it: the token you put
// in the credentials file, then each step, then its check; and `ship remove telegram` after.
describe("ship add telegram, end to end", () => {
  it(
    "puts the keys on the edge, points the bot at it, links you, and removes it all again",
    async () => {
      const w = await world({ creds: "TELEGRAM_TOKEN=good\n" });
      const s = sandbox();
      Object.assign(s.env, w.env, { TELEGRAM_ID: "123456789" });
      const plan = ship(s, "add", "telegram");
      expect(plan.status).toBe("requires-approval");
      expect(JSON.stringify(plan.plannedActions)).toContain("set on the edge's Worker");
      // The plan says what it will set: taps, the menu of four, the photo.
      for (const step of ["messages and taps", "menu of four", "its photo"])
        expect(JSON.stringify(plan.plannedActions)).toContain(step);
      const r = ship(s, "add", "telegram", "--yes");
      expect(r.checks?.map((c) => [c.name, c.ok])).toEqual([
        ["TELEGRAM_TOKEN is set on the edge's Worker", true],
        ["Check the token with Telegram", true],
        ["Give the edge Telegram's secret", true],
        ["Point the bot at the edge, one update at a time: messages and taps", true],
        ["Set the bot's menu of four, its description and its photo", true],
        ["Link you: open the link it shows, press Start, paste the id the bot sends", true],
        ["Send a test message to your phone", true],
        // Then its own check, with the key it just put in the credentials file.
        ["telegram's key works", true],
      ]);
      expect(r.status).toBe("succeeded");
      expect(Object.keys(w.secrets()).sort()).toEqual(["TELEGRAM_SECRET", "TELEGRAM_TOKEN"]);
      expect(w.secrets().TELEGRAM_TOKEN).toBe(hash("good"));
      expect(w.bot().find((c) => c.method === "sendMessage")?.args.chat_id).toBe(123456789);
      // Run again, it changes nothing: each step finds itself done.
      const again = ship(s, "add", "telegram", "--yes");
      expect(again.status, JSON.stringify(again.checks)).toBe("succeeded");
      expect(w.writes()).toHaveLength(2);
      // And removed: the bot points nowhere, and its keys are gone from the edge.
      const gone = ship(s, "remove", "telegram", "--yes");
      expect(gone.status, gone.summary).toBe("succeeded");
      expect(w.secrets()).toEqual({});
      expect(w.credsText()).not.toContain("TELEGRAM_");
    },
    SERVE_TIMEOUT * 4,
  );
});
