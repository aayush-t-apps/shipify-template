// The chat commands answered on GitHub (cli/kernel/instant.ts): /models reads a gateway's public
// list at once, as decide is synchronous, and says so when it can't.
import { describe, expect, it } from "vitest";
import { instantAnswer, listOf } from "../cli/kernel/instant.ts";

describe("/models on GitHub", () => {
  it("lists each agent's models with no read at all", () => {
    expect(instantAnswer("models", Date.now())).toContain("pi, through openrouter");
  });

  it("reads a list with Node's own fetch, and gives null for one that doesn't come", () => {
    const body = '{"data":[{"id":"a/b"}]}';
    expect(listOf(`data:application/json,${encodeURIComponent(body)}`)).toBe(body);
    expect(listOf("http://127.0.0.1:9/models")).toBeNull();
  });
});
