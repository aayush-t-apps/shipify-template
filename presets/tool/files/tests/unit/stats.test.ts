import { describe, expect, it } from "vitest";
import { textStats } from "../../src/web/lib/stats";

describe("textStats", () => {
  it("counts an empty input as zero", () => {
    expect(textStats("")).toEqual({ characters: 0, words: 0, lines: 0 });
  });

  it("counts words across lines and extra spaces", () => {
    expect(textStats("hello  world\nagain ")).toEqual({ characters: 19, words: 3, lines: 2 });
  });
});
