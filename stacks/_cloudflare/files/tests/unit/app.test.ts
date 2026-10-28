// App-owned: tests for this app's own routes (src/worker/app.ts).
// #if OPTIONS
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, type Env } from "../../src/worker/app";
import { localBindings } from "./support/bindings";

// The app's storage, as `wrangler dev` runs it: in memory, with migrations/ applied.
const local = await localBindings<Env>();
const env: Env = { ...local.env, APP_ID: "{{APP_ID}}", APP_ENV: "test", GIT_SHA: "abc1234" };
beforeAll(() => local.ready);
afterAll(() => local.dispose());
// #endif
// #if !OPTIONS
import { describe, expect, it } from "vitest";
import { app, type Env } from "../../src/worker/app";

const env: Env = { APP_ID: "{{APP_ID}}", APP_ENV: "test", GIT_SHA: "abc1234" };
// #endif

describe("app routes", () => {
  it("serves /api/info", async () => {
    const res = await app.request("/api/info", {}, env);
    expect(await res.json()).toEqual({ app: "{{APP_ID}}", env: "test" });
  });
});
// #if OPTION_KV

describe("storage: KV", () => {
  it("keeps what it's given", async () => {
    await env.KV.put("greeting", "hello");
    expect(await env.KV.get("greeting")).toBe("hello");
  });
});
// #endif
// #if OPTION_D1

describe("storage: D1", () => {
  it("has the tables from migrations/", async () => {
    await env.DB.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").bind("v", "1").run();
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind("v").first();
    expect(row).toEqual({ value: "1" });
  });
});
// #endif
// #if OPTION_R2

describe("storage: R2", () => {
  it("keeps what it's given", async () => {
    await env.R2.put("tmp/hello.txt", "hello");
    expect(await (await env.R2.get("tmp/hello.txt"))?.text()).toBe("hello");
  });
});
// #endif
