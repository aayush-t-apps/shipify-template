import { describe, expect, it } from "vitest";
import { createLogger, redact, safeError } from "../../src/shared/logger";

describe("redact", () => {
  it("removes sensitive keys at any depth", () => {
    const out = redact({
      path: "/x",
      headers: { Authorization: "Bearer abc", cookie: "s=1", accept: "json" },
      nested: [{ apiKey: "k", ok: 1 }],
      password: "p",
    });
    expect(out).toEqual({
      path: "/x",
      headers: { Authorization: "[redacted]", cookie: "[redacted]", accept: "json" },
      nested: [{ apiKey: "[redacted]", ok: 1 }],
      password: "[redacted]",
    });
  });

  it("truncates very deep objects", () => {
    expect(redact({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toEqual({
      a: { b: { c: { d: { e: "[truncated]" } } } },
    });
  });
});

describe("logger", () => {
  it("writes one JSON line with the standard fields", () => {
    const lines: string[] = [];
    const log = createLogger({ app: "a", env: "e", version: "v", requestId: "r" }, (l) =>
      lines.push(l),
    );
    log.info("hello", { token: "t", n: 1 });
    log.warn("w");
    log.error("x");
    log.debug("d");
    const first = JSON.parse(lines[0] ?? "{}");
    expect(first).toMatchObject({
      level: "info",
      app: "a",
      env: "e",
      version: "v",
      requestId: "r",
    });
    expect(first.event).toBe("hello");
    expect(first.token).toBe("[redacted]");
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["info", "warn", "error", "debug"]);
  });

  it("describes errors safely", () => {
    expect(safeError(new TypeError("bad")).name).toBe("TypeError");
    expect(safeError("text")).toEqual({ name: "NonError", message: "text" });
  });
});
