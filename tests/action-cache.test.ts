// The runner's own cache of actions (box setup 19, cli/lib/action-cache.ts): GitHub's archive of
// each action the box's workflows pin, where the runner looks before it downloads one in "Set up
// job". Only an archive that unpacks to one folder goes in, whole, so no job's set-up fails on it.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ActionCacheIo,
  actionsSaid,
  archiveOf,
  boxPins,
  keepActions,
  type Pin,
  unpacksToOneFolder,
} from "../cli/lib/action-cache.ts";

const SHA = (c: string) => c.repeat(40);
const TOKEN: Pin = { repo: "actions/create-github-app-token", sha: SHA("a") };
const CHECKOUT: Pin = { repo: "actions/checkout", sha: SHA("b") };
const temp = () => mkdtempSync(join(tmpdir(), "action-cache-"));

/** A download that hands back each pin's name, and a check that takes what `good` says. */
const fake = (good = (_: string) => true) => {
  const asked: string[] = [];
  const io: ActionCacheIo = {
    download: async (p) => {
      asked.push(p.repo);
      if (p.repo === "fails/here") throw new Error("HTTP 502");
      return new TextEncoder().encode(p.repo);
    },
    unpacks: (file) => good(readFileSync(file, "utf8")),
  };
  return { io, asked };
};

describe("the runner's cache of actions (box setup 19)", () => {
  it("takes the pins of the workflows that run on a box, each once, and none on a tag", () => {
    const dir = temp();
    writeFileSync(
      join(dir, "task.yml"),
      [
        "    runs-on: [self-hosted, shipify-box, sandbox]",
        `        uses: actions/create-github-app-token@${SHA("a")} # v3.2.0`,
        `        uses: actions/create-github-app-token@${SHA("a")} # v3.2.0`,
        `      - uses: actions/checkout@${SHA("b")} # v7.0.1`,
        `      - uses: github/codeql-action/init@${SHA("c")}`,
        "      - uses: actions/setup-node@v7",
        "      - uses: ./.github/actions/local",
      ].join("\n"),
    );
    // A workflow only GitHub's machines run: its pins aren't the box's.
    const gh = `    runs-on: ubuntu-latest\n      - uses: o/gh-only@${SHA("d")}\n`;
    writeFileSync(join(dir, "ci.yml"), gh);
    expect(boxPins(dir)).toEqual([
      CHECKOUT,
      TOKEN,
      { repo: "github/codeql-action", sha: SHA("c") },
    ]);
    expect(boxPins(join(dir, "none"))).toEqual([]);
  });

  it("reads task.yml's and the watch's own pins", () => {
    const pins = boxPins().map((p) => p.repo);
    expect(pins).toContain("actions/create-github-app-token");
    expect(pins).toContain("actions/checkout");
    for (const p of boxPins()) expect(p.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("puts each missing archive where the runner looks, whole, once; a pin there already is no download", async () => {
    const dir = temp();
    const { io, asked } = fake();
    const k = await keepActions([TOKEN, CHECKOUT], dir, { prune: false, io });
    expect(k).toEqual({
      added: ["actions/create-github-app-token@aaaaaaa", "actions/checkout@bbbbbbb"],
      removed: [],
      failed: [],
    });
    // `<owner>_<repo>/<sha>.tar.gz`, as actions/runner's ActionManager reads it.
    expect(archiveOf(dir, TOKEN)).toBe(
      join(dir, "actions_create-github-app-token", `${SHA("a")}.tar.gz`),
    );
    expect(readFileSync(archiveOf(dir, TOKEN), "utf8")).toBe(TOKEN.repo);
    expect(readdirSync(join(dir, "actions_checkout"))).toEqual([`${SHA("b")}.tar.gz`]);
    const again = await keepActions([TOKEN, CHECKOUT], dir, { prune: false, io });
    expect(again).toEqual({ added: [], removed: [], failed: [] });
    expect(asked).toEqual([TOKEN.repo, CHECKOUT.repo]);
  });

  it("keeps out an archive that doesn't unpack to one folder, or didn't download, and leaves no part", async () => {
    const dir = temp();
    const { io } = fake((body) => body !== CHECKOUT.repo);
    const failing: Pin = { repo: "fails/here", sha: SHA("e") };
    const k = await keepActions([CHECKOUT, failing, TOKEN], dir, { prune: false, io });
    expect(k?.failed).toEqual(["actions/checkout@bbbbbbb", "fails/here@eeeeeee"]);
    expect(k?.added).toEqual(["actions/create-github-app-token@aaaaaaa"]);
    expect(existsSync(archiveOf(dir, CHECKOUT))).toBe(false);
    expect(readdirSync(join(dir, "actions_checkout"))).toEqual([]);
    expect(actionsSaid(k)).toBe(
      '1 action(s) cached for "Set up job"; couldn\'t cache actions/checkout@bbbbbbb, fails/here@eeeeeee (the next run tries)',
    );
  });

  it("prunes what no workflow pins any more, only when asked, and never to nothing", async () => {
    const dir = temp();
    const { io } = fake();
    const old: Pin = { repo: "actions/checkout", sha: SHA("f") };
    const gone: Pin = { repo: "pnpm/action-setup", sha: SHA("9") };
    await keepActions([TOKEN, old, gone], dir, { prune: false, io });
    writeFileSync(`${archiveOf(dir, TOKEN)}.part-1`, "cut off");
    // The due run fills, and removes nothing.
    expect((await keepActions([TOKEN, CHECKOUT], dir, { prune: false, io }))?.removed).toEqual([]);
    expect(existsSync(archiveOf(dir, old))).toBe(true);
    // No pins read (a checkout with no workflows): nothing removed.
    expect((await keepActions([], dir, { prune: true, io }))?.removed).toEqual([]);
    // The weekly clean-up: the pins only, an empty folder gone with its last archive.
    const k = await keepActions([TOKEN, CHECKOUT], dir, { prune: true, io });
    expect(k?.removed.sort()).toEqual(["actions/checkout@fffffff", "pnpm/action-setup@9999999"]);
    const token = "actions_create-github-app-token";
    expect(readdirSync(dir).sort()).toEqual(["actions_checkout", token]);
    expect(readdirSync(join(dir, token))).toEqual([`${SHA("a")}.tar.gz`]);
    expect(actionsSaid(k)).toBe("2 old one(s) removed");
  });

  it("does nothing where the box has no cache: before setup 19, or a PC", async () => {
    const { io, asked } = fake();
    expect(await keepActions([TOKEN], undefined, { prune: true, io })).toBeUndefined();
    expect(await keepActions([TOKEN], join(temp(), "none"), { prune: true, io })).toBeUndefined();
    expect(asked).toEqual([]);
    expect(actionsSaid(undefined)).toBe("");
  });

  it("checks an archive as the runner unpacks it: one folder with its files, nothing beside it", () => {
    const dir = temp();
    const tar = (name: string, ...paths: string[]) => {
      const src = join(dir, `src-${name}`);
      for (const p of paths) {
        mkdirSync(join(src, p, ".."), { recursive: true });
        writeFileSync(join(src, p), "x");
      }
      const out = join(dir, `${name}.tar.gz`);
      expect(spawnSync("tar", ["-czf", out, "-C", src, "."]).status).toBe(0);
      return out;
    };
    expect(unpacksToOneFolder(tar("one", "actions-checkout-3d3c42e/action.yml"))).toBe(true);
    expect(unpacksToOneFolder(tar("two", "a/action.yml", "b/action.yml"))).toBe(false);
    expect(unpacksToOneFolder(tar("loose", "action.yml"))).toBe(false);
    writeFileSync(join(dir, "html.tar.gz"), "<html>rate limited</html>");
    expect(unpacksToOneFolder(join(dir, "html.tar.gz"))).toBe(false);
  });
});
