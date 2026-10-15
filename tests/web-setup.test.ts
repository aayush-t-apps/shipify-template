// The web chat's setup (ADR 0036, "Setup": tools/web/), with no network: its entry in tools.json,
// the verdicts it reads from what the edge and Cloudflare answer (tools/web/web.ts), and the steps
// that only read and write shipify's variables, run as `ship add web` runs them, against the mock
// provider's log. The sign-in and file checks ask the network, so only their verdicts are here.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Person } from "../cli/lib/people.ts";
import { readTools } from "../cli/lib/tools.ts";
import { publicKey } from "../edge/src/push.ts";
import {
  ACCESS_EDIT,
  chatUrl,
  FILES_OFF,
  filesVerdict,
  newPushKey,
  sendWithoutWeb,
  sendWithWeb,
  signinVerdict,
  withoutWeb,
  withWeb,
} from "../tools/web/web.ts";
import { ROOT } from "./helpers.ts";

const ORIGIN = "https://shipify.example.com";
const URL_ = chatUrl(ORIGIN);

describe("the web chat's entry in tools.json", () => {
  const { tools, problems } = readTools(join(ROOT, "tools.json"));
  // `webchat`, not `web`: a tool's name is banned from the core's code, and "web" is a plain word.
  const web = tools.webchat;

  it("is a chat channel through the door, with no keys, six steps, a check and an undo", () => {
    expect(problems).toEqual([]);
    expect(web?.in).toEqual({ door: "web" });
    expect(web?.keys).toEqual({});
    expect(web?.setup?.keys).toEqual({});
    expect(web?.setup?.needs.join(" ")).toContain("pnpm ship door page --yes");
    expect(web?.setup?.steps.map((s) => s.run.at(-1))).toEqual([
      "page",
      "signin",
      "you",
      "files",
      "notify",
      "open",
    ]);
    for (const s of web?.setup?.steps ?? []) expect(s.run[1]).toBe("tools/web/setup.ts");
    expect(web?.check?.at(-1)).toBe("--check");
    expect(web?.setup?.remove?.at(-1)).toBe("--remove");
  });
});

describe("the web chat's setup: what it reads", () => {
  it("passes a stranger sent to Access's sign-in, and shows the one edit for the edge's own 403", () => {
    expect(
      signinVerdict(URL_, 302, "https://me.cloudflareaccess.com/cdn-cgi/access/login/x"),
    ).toMatchObject({ ok: true });
    const no = signinVerdict(URL_, 403, null);
    expect(no.ok).toBe(false);
    expect(no.line).toContain("admin/*");
    expect(no.edit).toEqual(ACCESS_EDIT);
    expect(ACCESS_EDIT.join(" ")).toContain("“shipify status”");
    // A redirect elsewhere, or a page with no sign-in, isn't Access.
    expect(signinVerdict(URL_, 302, "https://elsewhere.example.com/").ok).toBe(false);
    expect(signinVerdict(URL_, 200, null)).toMatchObject({ ok: false });
  });

  it("finds FILES among the Worker's bindings, and only a KV namespace by that name", () => {
    const answer = (bindings: unknown[]) => ({ success: true, errors: [], result: { bindings } });
    expect(
      filesVerdict(200, answer([{ type: "kv_namespace", name: "FILES", namespace_id: "n" }])).kind,
    ).toBe("bound");
    const off = filesVerdict(200, answer([{ type: "plain_text", name: "FILES" }]));
    expect(off).toEqual({ kind: "unbound", line: FILES_OFF });
    expect(FILES_OFF).toContain("Workers KV Storage: Edit");
    expect(filesVerdict(200, answer([])).kind).toBe("unbound");
  });

  it("tells a refused token from a Worker not deployed, and from an answer it can't read", () => {
    const refused = filesVerdict(403, {
      success: false,
      errors: [{ code: 10000, message: "Authentication error" }],
    });
    expect(refused.kind).toBe("refused");
    expect(refused.line).toContain("Authentication error");
    expect(filesVerdict(401, {}).kind).toBe("refused");
    expect(filesVerdict(404, { success: false, errors: [{ code: 10007 }] })).toMatchObject({
      kind: "other",
      line: expect.stringContaining("no Worker called shipify"),
    });
    expect(filesVerdict(500, "not json").kind).toBe("other");
    expect(filesVerdict(200, { success: true, result: {} }).kind).toBe("other");
  });

  it("gives you an id on the chat once, and takes it from everyone", () => {
    const people: Person[] = [
      { name: "Aayush", on: { github: "aayush" } },
      { name: "Sam", on: { github: "sam", web: "me" } },
    ];
    const added = withWeb(people);
    expect(added?.[0]?.on).toEqual({ github: "aayush", web: "me" });
    expect(added?.[1]).toEqual(people[1]);
    expect(withWeb(added ?? [])).toBeUndefined();
    expect(withoutWeb(added ?? [])?.map((p) => p.on)).toEqual([
      { github: "aayush" },
      { github: "sam" },
    ]);
    expect(withoutWeb([{ name: "Aayush", on: { github: "aayush" } }])).toBeUndefined();
  });
});

/** One write the mock provider made, from its log. */
type Write = { call: string; repo: string; name?: string; value?: string };

/**
 * A world of one test's own, with no server: shipify's variables (the mock provider's log, seeded
 * with these writes), a credentials file with `creds`, the edge's Worker's secrets (a stand-in for
 * wrangler), and each step run as `ship add` runs it.
 */
function world(seed: Write[], creds = "") {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, seed.map((w) => `${JSON.stringify(w)}\n`).join(""));
  const file = join(dir, "creds.env");
  writeFileSync(file, creds, { mode: 0o600 });
  const worker = join(dir, "wrangler.json");
  return {
    step: (name: string, more: Record<string, string> = {}) =>
      spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "tools/web/setup.ts"), name], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          SHIPIFY_CREDENTIALS: file,
          SHIPIFY_PROVIDER: "mock",
          SHIPIFY_MOCK_CALLS: log,
          SHIPIFY_OWNER: "owner",
          GITHUB_REPOSITORY: "o/shipify",
          SHIPIFY_WRANGLER: join(ROOT, "tests/fixtures/fake-wrangler.mjs"),
          FAKE_WRANGLER_STATE: worker,
          ...more,
        },
      }),
    /** The Worker's secrets: each name, and a hash of its value. */
    secrets: (): Record<string, string> =>
      JSON.parse(readFileSync(worker, "utf8")).secrets as Record<string, string>,
    writes: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Write)
        .slice(seed.length),
  };
}
const variable = (name: string, value: string): Write => ({
  call: "setVariable",
  repo: "o/shipify",
  name,
  value,
});
const ACCESS = JSON.stringify({ team: "me.cloudflareaccess.com", aud: "a".repeat(64) });
const SETUP_TIMEOUT = 60_000;

describe("the web chat's setup steps, with no network", () => {
  it(
    "needs the status page first, and names the command that sets it up",
    () => {
      const none = world([]).step("page");
      expect(none.status).toBe(1);
      expect(none.stdout).toContain("run pnpm ship door page --yes first");
      const set = world([variable("SHIPIFY_ACCESS", ACCESS)]).step("page");
      expect(set.status, set.stdout).toBe(0);
      expect(set.stdout).toContain("the status page is set up (me.cloudflareaccess.com)");
    },
    SETUP_TIMEOUT,
  );

  it(
    "lets your words in from the chat once, and takes everyone's id off it when removed",
    () => {
      const w = world([variable("SHIPIFY_PEOPLE", '[{"name":"owner","on":{"github":"owner"}}]')]);
      const r = w.step("you");
      expect(r.status, r.stdout).toBe(0);
      expect(r.stdout).toContain("owner's words come in from the chat");
      expect(w.step("you").status).toBe(0);
      expect(w.writes()).toEqual([
        variable("SHIPIFY_PEOPLE", '[{"name":"owner","on":{"github":"owner","web":"me"}}]'),
      ]);
      const gone = w.step("--remove");
      expect(gone.status, gone.stdout).toBe(0);
      expect(gone.stdout).toContain("expire by themselves");
      expect(w.step("--remove").status).toBe(0);
      expect(w.writes().slice(1)).toEqual([
        variable("SHIPIFY_PEOPLE", '[{"name":"owner","on":{"github":"owner"}}]'),
      ]);
    },
    SETUP_TIMEOUT,
  );

  it(
    "never writes over people it can't read",
    () => {
      const w = world([variable("SHIPIFY_PEOPLE", "not json")]);
      const r = w.step("you");
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("SHIPIFY_PEOPLE isn't JSON");
      expect(w.writes()).toEqual([]);
    },
    SETUP_TIMEOUT,
  );

  it(
    "says what the file check needs from the credentials file, and where the chat is",
    () => {
      const w = world([variable("SHIPIFY_ACCESS", ACCESS), variable("APPS_DOMAIN", "example.com")]);
      const files = w.step("files");
      expect(files.status).toBe(1);
      expect(files.stdout).toContain("CF_DEPLOY_TOKEN and CLOUDFLARE_ACCOUNT_ID");
      const open = w.step("open");
      expect(open.status, open.stdout).toBe(0);
      expect(open.stdout).toContain("https://shipify.example.com/admin/chat/");
      expect(open.stdout).toContain("send /ping");
      expect(w.step("nope").stdout).toContain("usage: setup.ts page|signin|you|files|notify|open");
    },
    SETUP_TIMEOUT,
  );

  const CF = "CF_DEPLOY_TOKEN=cf-test\nCLOUDFLARE_ACCOUNT_ID=acct\n";

  it(
    "turns on notifications: their key made once, kept on a second run, new with --new; web your default channel when you have none",
    () => {
      const w = world(
        [variable("SHIPIFY_PEOPLE", '[{"name":"owner","on":{"github":"owner"}}]')],
        CF,
      );
      const first = w.step("notify");
      expect(first.status, first.stdout).toBe(0);
      expect(first.stdout).toContain("notifications are on (the edge has a new key)");
      const key = w.secrets().WEB_PUSH_KEY;
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(w.writes()).toEqual([variable("SHIPIFY_SEND", "web")]);
      // Again: the key stays, and SHIPIFY_SEND isn't written twice.
      const again = w.step("notify");
      expect(again.stdout).toContain("the edge has the key already");
      expect(w.secrets().WEB_PUSH_KEY).toBe(key);
      expect(w.writes()).toHaveLength(1);
      // --new: a new one.
      expect(w.step("notify", { SHIPIFY_RENEW: "1" }).stdout).toContain("a new key");
      expect(w.secrets().WEB_PUSH_KEY).not.toBe(key);
      // No key's value is ever printed.
      for (const r of [first, again]) expect(`${r.stdout}${r.stderr}`).not.toMatch(/"d":/);
      // Removed: the key's off the edge, and web off your default channels.
      expect(w.step("--remove").stdout).toContain("its notifications' key is off the edge");
      expect(w.secrets().WEB_PUSH_KEY).toBeUndefined();
      expect(w.writes().at(-1)).toEqual({
        call: "deleteVariable",
        repo: "o/shipify",
        name: "SHIPIFY_SEND",
      });
    },
    SETUP_TIMEOUT,
  );

  it(
    "leaves your default channels as they are when you have some, and says how to switch",
    () => {
      const w = world([variable("SHIPIFY_SEND", "telegram")], CF);
      const r = w.step("notify");
      expect(r.status, r.stdout).toBe(0);
      expect(r.stderr).toContain("pnpm ship remove telegram --yes");
      expect(w.writes()).toEqual([]);
      // Without Cloudflare's token here, it names what's missing.
      const bare = world([], "").step("notify");
      expect(bare.status).toBe(1);
      expect(bare.stdout).toContain("CF_DEPLOY_TOKEN and CLOUDFLARE_ACCOUNT_ID");
    },
    SETUP_TIMEOUT,
  );
});

describe("your default channels, with and without the web chat", () => {
  it("adds web only when there are none, and takes it out only when it's there", () => {
    expect(sendWithWeb([])).toEqual(["web"]);
    expect(sendWithWeb(["telegram"])).toBeUndefined();
    expect(sendWithoutWeb(["telegram", "web"])).toEqual(["telegram"]);
    expect(sendWithoutWeb(["telegram"])).toBeUndefined();
  });

  it("makes a key the edge reads: P-256, its public half inside", () => {
    expect(Buffer.from(publicKey(newPushKey()) ?? "", "base64url")).toHaveLength(65);
  });
});
