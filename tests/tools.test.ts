import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeTools } from "../cli/lib/agents/claude.ts";
import {
  command,
  listServerTools,
  loadTools,
  runTools,
  sortProblems,
  type Tools,
} from "../cli/lib/tools.ts";
import {
  blockLines,
  explain,
  idOf,
  toBlocks,
  toProperties,
  valueText,
} from "../tools/notion/notion.ts";
import { ROOT } from "./helpers.ts";

const TOOLS = loadTools(join(ROOT, "tools.json"));
/** How a config names a key: \${NAME}, never its value. */
const ref = (name: string) => `\${${name}}`;
const notionTool = TOOLS.notion as Tools[string];

describe("tools: tools.json and the agent's settings (ADR 0015)", () => {
  const env = { SHIPIFY_NOTION_READ: "test-read", SHIPIFY_NOTION_WRITE: "test-write" };

  it("gives a look run the look calls, denies the act calls, and names keys, never their values", () => {
    const t = claudeTools(TOOLS, "look", env);
    expect(t.allow).toEqual([
      "mcp__notion__search",
      "mcp__notion__read_page",
      "mcp__notion__read_database",
      "mcp__notion__query_database",
    ]);
    expect(t.deny).toEqual(["mcp__notion__update_page", "mcp__notion__create_page"]);
    const config = JSON.stringify(t.config);
    expect(config).toContain(`"NOTION_TOKEN":"${ref("SHIPIFY_NOTION_READ")}"`);
    expect(config).not.toContain("test-read");
    expect(config).not.toContain("SHIPIFY_NOTION_WRITE");
  });

  it("gives an act run the act calls too, with the write key, and leaves out a tool whose key isn't set", () => {
    const act = claudeTools(TOOLS, "act", env);
    expect(act.allow).toContain("mcp__notion__update_page");
    expect(act.deny).toEqual([]);
    expect(JSON.stringify(act.config)).toContain(`"NOTION_TOKEN":"${ref("SHIPIFY_NOTION_WRITE")}"`);
    // A look run's job never has the write key, so an act run without it has no tool.
    expect(runTools({ notion: notionTool }, "act", { SHIPIFY_NOTION_READ: "test-read" })).toEqual({
      ready: {},
      missing: [{ tool: "notion", why: "SHIPIFY_NOTION_WRITE isn't set" }],
    });
    expect(runTools({ notion: notionTool }, "look", {}).missing[0]?.why).toBe(
      "SHIPIFY_NOTION_READ isn't set",
    );
  });

  it("makes relative paths in a server's command paths in this repo", () => {
    expect(command(["node_modules/.bin/tsx", "tools/notion/server.ts", "--check"])).toEqual({
      command: join(ROOT, "node_modules/.bin/tsx"),
      args: [join(ROOT, "tools/notion/server.ts"), "--check"],
    });
    expect(command(["npx", "-y", "some-server"])).toEqual({
      command: "npx",
      args: ["-y", "some-server"],
    });
  });

  it("passes every tool's look key to the think step, and its act key only to apply, for approved calls", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/task.yml"), "utf8");
    for (const [name, t] of Object.entries(TOOLS))
      for (const k of Object.values(t.keys)) {
        if (k.look) expect(yml).toContain(`${k.look}: \${{ secrets.${k.look} }}`);
        if (k.act)
          expect(yml, k.act).toContain(
            `${k.act}: \${{ steps.decide.outputs.act == '${name}' && secrets.${k.act} || '' }}`,
          );
      }
  });

  it("sorts every call its server offers into look or act (the check CI runs)", async () => {
    for (const [name, t] of Object.entries(TOOLS)) {
      if (!t.run) continue;
      // A minute for its first start under load (as tests/plugins/tool.test.ts).
      expect(sortProblems(name, t, await listServerTools(t.run, {}, 60_000))).toEqual([]);
    }
    expect(sortProblems("notion", notionTool, ["search", "delete_page"])).toEqual([
      'notion: "delete_page" is neither look nor act',
      'notion: "read_page" isn\'t offered by its server',
      'notion: "read_database" isn\'t offered by its server',
      'notion: "query_database" isn\'t offered by its server',
      'notion: "update_page" isn\'t offered by its server',
      'notion: "create_page" isn\'t offered by its server',
    ]);
  }, 90_000);
});

describe("tools: Notion's values and errors", () => {
  const schema = {
    Name: { name: "Name", type: "title" },
    Status: {
      name: "Status",
      type: "status",
      status: { options: [{ name: "To do" }, { name: "Done" }] },
    },
    Due: { name: "Due", type: "date" },
    Paid: { name: "Paid", type: "checkbox" },
    Cost: { name: "Cost", type: "number" },
  };

  it("finds the id in a link or an id", () => {
    expect(idOf("https://www.notion.so/me/Pay-rent-33333333333333333333333333333333?pvs=4")).toBe(
      "33333333333333333333333333333333",
    );
    expect(
      idOf(
        "https://www.notion.so/11111111111111111111111111111111?v=99999999999999999999999999999999",
      ),
    ).toBe("11111111111111111111111111111111");
    expect(idOf("33333333-3333-3333-3333-333333333333")).toBe("33333333333333333333333333333333");
    expect(() => idOf("Pay rent")).toThrow("isn't a Notion link or id");
  });

  it("turns plain values into Notion's format, and never invents a status", () => {
    expect(
      toProperties({ status: "done", Due: "2026-10-03", Paid: "yes", Cost: 1200 }, schema),
    ).toEqual({
      Status: { status: { name: "Done" } },
      Due: { date: { start: "2026-10-03" } },
      Paid: { checkbox: true },
      Cost: { number: 1200 },
    });
    expect(() => toProperties({ Status: "Finished" }, schema)).toThrow(
      '"Finished" isn\'t a choice for Status. Its choices: To do, Done.',
    );
    expect(() => toProperties({ Owner: "me" }, schema)).toThrow('There\'s no property "Owner"');
    expect(() => toProperties({ Cost: "a lot" }, schema)).toThrow("Cost needs a number");
  });

  it("reads values and blocks as plain text, and writes text as blocks", () => {
    expect(valueText({ type: "status", status: { name: "Done" } })).toBe("Done");
    expect(valueText({ type: "date", date: { start: "2026-10-03", end: "2026-10-04" } })).toBe(
      "2026-10-03 → 2026-10-04",
    );
    expect(
      blockLines([
        { type: "to_do", to_do: { rich_text: [{ plain_text: "Buy milk" }], checked: true } },
      ]),
    ).toEqual(["- [x] Buy milk"]);
    expect(toBlocks("# Plan\n- one\n- [ ] two\nText").map((b) => b.type)).toEqual([
      "heading_1",
      "bulleted_list_item",
      "to_do",
      "paragraph",
    ]);
  });

  it("says what to do about each error", () => {
    expect(explain(404, { code: "object_not_found" })).toContain("⋯ → Connections → add Shipify");
    expect(explain(401, { code: "unauthorized" })).toContain("wrong or was revoked");
    expect(explain(403, { code: "restricted_resource" })).toContain("read-only key");
  });
});

describe("tools: our Notion server, end to end against a fake Notion", () => {
  const dir = mkdtempSync(join(tmpdir(), "notion-"));
  const log = join(dir, "requests.log");
  let fake: ChildProcess;
  let base = "";

  beforeAll(async () => {
    writeFileSync(log, "");
    const portFile = join(dir, "port");
    fake = spawn(process.execPath, [join(ROOT, "tests/fixtures/fake-notion.mjs"), portFile], {
      env: { ...process.env, FAKE_NOTION_LOG: log },
      stdio: "ignore",
    });
    for (let i = 0; i < 100 && !existsSync(portFile); i++)
      await new Promise((r) => setTimeout(r, 50));
    base = `http://127.0.0.1:${readFileSync(portFile, "utf8")}/v1`;
  });
  afterAll(() => {
    fake?.kill();
  });

  /** Calls tools on our server over MCP (stdio), and returns each answer's text. */
  const calls = (key: string, list: [string, Record<string, unknown>][]) => {
    const { command: cmd, args } = command(notionTool.run as string[]);
    const input = [
      { id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
      { method: "notifications/initialized" },
      ...list.map(([name, args], i) => ({
        id: i + 1,
        method: "tools/call",
        params: { name, arguments: args },
      })),
    ]
      .map((m) => JSON.stringify({ jsonrpc: "2.0", ...m }))
      .join("\n");
    const r = spawnSync(cmd, args, {
      input: `${input}\n`,
      env: { ...process.env, NOTION_TOKEN: key, NOTION_API_URL: base },
      encoding: "utf8",
      timeout: 30_000,
    });
    const answers = r.stdout
      .split("\n")
      .filter(Boolean)
      .map(
        (l) =>
          JSON.parse(l) as {
            id: number;
            result: { content: { text: string }[]; isError?: boolean };
          },
      );
    return list.map((_, i) => {
      const a = answers.find((x) => x.id === i + 1);
      return `${a?.result.isError ? "ERROR " : ""}${a?.result.content[0]?.text ?? "(no answer)"}`;
    });
  };

  it("searches, reads and queries with the read-only key, sending Notion's pinned version", () => {
    const [found, db, open, page] = calls("read-key", [
      ["search", { query: "rent" }],
      ["read_database", { database: "11111111111111111111111111111111" }],
      [
        "query_database",
        {
          database: "11111111111111111111111111111111",
          filter: { property: "Status", status: { does_not_equal: "Done" } },
        },
      ],
      ["read_page", { page: "https://www.notion.so/Pay-rent-33333333333333333333333333333333" }],
    ]);
    expect(found).toContain('- "Pay rent" · Status: To do · Due: 2026-10-03');
    expect(db).toContain("- Status (status): To do, In progress, Done");
    expect(open).toBe(
      '"Tasks": 1 row\n- "Pay rent" · Status: To do · Due: 2026-10-03 · id 33333333333333333333333333333333',
    );
    expect(page).toContain("Rent goes to the landlord's account.");
    expect(readFileSync(log, "utf8")).toContain("2025-09-03");
  });

  it("can't change anything with the read-only key, and changes with the write key", () => {
    const update = [
      "update_page",
      { page: "33333333333333333333333333333333", properties: { Status: "Done" } },
    ] as [string, Record<string, unknown>];
    expect(calls("read-key", [update])[0]).toMatch(/^ERROR This key may not do that/);
    expect(calls("write-key", [update])[0]).toBe(
      'Updated "Pay rent": Status: Done · Due: 2026-10-03 · https://www.notion.so/Pay-rent-33333333333333333333333333333333',
    );
    expect(
      calls("write-key", [
        [
          "update_page",
          { page: "33333333333333333333333333333333", properties: { Status: "Finished" } },
        ],
      ])[0],
    ).toContain("isn't a choice for Status");
    const [created] = calls("write-key", [
      [
        "create_page",
        {
          parent: "11111111111111111111111111111111",
          title: "Renew passport",
          content: "- book a slot",
        },
      ],
    ]);
    expect(created).toContain('Created "Renew passport"');
  });

  it("says plainly when the key is wrong or a page isn't connected", () => {
    const [bad] = calls("nope", [["search", { query: "rent" }]]);
    expect(bad).toMatch(/^ERROR Notion refused the key/);
    expect(bad).toContain("pnpm ship add notion --new --yes");
    const [missing] = calls("read-key", [
      ["read_page", { page: "99999999999999999999999999999999" }],
    ]);
    expect(missing).toMatch(/^ERROR Not found, or not connected to Shipify/);
  });
});
