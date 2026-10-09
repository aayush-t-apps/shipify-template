import { describe, expect, it } from "vitest";
import { greet } from "../../src/index.ts";

describe("greet", () => {
  it("greets by name", () => expect(greet("Ada")).toBe("Hello, Ada!"));
  it("falls back to world", () => expect(greet("  ")).toBe("Hello, world!"));
});
