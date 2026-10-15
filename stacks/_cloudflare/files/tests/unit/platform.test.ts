// Platform-owned (Shipify; replaced by `ship upgrade`): the shared Worker contract every app keeps.
import { describe, expect, it, vi } from "vitest";
import manifest from "../../shipify.json";
import { createApp, facts, type PlatformEnv, REQUEST_ID_HEADER } from "../../src/shared/platform";

const env: PlatformEnv = { APP_ID: "{{APP_ID}}", APP_ENV: "test", GIT_SHA: "abc1234def" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(path, init, env);

describe("health contract", () => {
  it("reports status, app, env, semver version and commit", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, string>;
    expect(body).toMatchObject({
      status: "ok",
      app: "{{APP_ID}}",
      env: "test",
      version: manifest.version,
      commit: "abc1234def",
    });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Date.parse(body.time ?? "")).not.toBeNaN();
  });
});

describe("facts", () => {
  it("publishes only non-secret manifest fields", async () => {
    const res = await call("/.well-known/shipify.json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual(facts());
    expect(Object.keys(body).sort()).toEqual([
      "description",
      "id",
      "kind",
      "name",
      "platformVersion",
      "shipify",
      "stack",
      "staging",
      "version",
      "visibility",
    ]);
  });
});

describe("request correlation", () => {
  it("generates a request id", async () => {
    const res = await call("/health");
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reuses a well-formed incoming id and rejects a malformed one", async () => {
    const good = await call("/health", { headers: { [REQUEST_ID_HEADER]: "req-12345678" } });
    expect(good.headers.get(REQUEST_ID_HEADER)).toBe("req-12345678");
    const bad = await call("/health", { headers: { [REQUEST_ID_HEADER]: "<script>" } });
    expect(bad.headers.get(REQUEST_ID_HEADER)).not.toBe("<script>");
  });
});

describe("fallbacks and errors", () => {
  it("returns JSON 404 for unknown api routes", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("falls back to static assets, or 404 without them", async () => {
    expect((await call("/some/page")).status).toBe(404);
    const ASSETS = { fetch: vi.fn(async () => new Response("asset")) } as unknown as Fetcher;
    const res = await app.request("/some/page", {}, { ...env, ASSETS });
    expect(await res.text()).toBe("asset");
  });

  it("runs `before` first and app routes before the fallbacks", async () => {
    const order: string[] = [];
    const custom = createApp(
      (a) => a.get("/api/x", (c) => c.text("x")),
      (a) =>
        a.use("*", async (_c, next) => {
          order.push("before");
          await next();
        }),
    );
    const res = await custom.request("/api/x", {}, env);
    expect(await res.text()).toBe("x");
    expect(order).toEqual(["before"]);
  });

  it("hides internal errors and logs them safely", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => {
      lines.push(l);
    });
    const failing = createApp((a) =>
      a.get("/api/boom", () => {
        throw new Error("boom");
      }),
    );
    const res = await failing.request("/api/boom", {}, env);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "internal_error" });
    const errorLine = lines.map((l) => JSON.parse(l)).find((l) => l.event === "unhandled_error");
    expect(errorLine.error.message).toBe("boom");
    expect(errorLine.version).toBe(`${manifest.version}+abc1234`);
  });
});
