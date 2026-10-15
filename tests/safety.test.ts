import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSecretLike, maskSecrets, safeOutputPath, validateAppName } from "../cli/lib/safety.ts";
import { STATELESS } from "./helpers.ts";

describe("validateAppName", () => {
  it.each(["md-preview", "gym-exercises", "a1b", "x".repeat(32)])("accepts %s", (n) => {
    expect(() => validateAppName(n)).not.toThrow();
  });
  it.each([
    "ab",
    "Md-Preview",
    "1app",
    "app-",
    "my--app",
    "my_app",
    "../etc",
    "x".repeat(33),
    "platform",
    "staging",
  ])("rejects %s", (n) => {
    expect(() => validateAppName(n)).toThrow();
  });
});

describe("safeOutputPath", () => {
  const root = () => mkdtempSync(join(tmpdir(), "ship-paths-"));

  it("resolves a new directory inside the root", () => {
    const r = root();
    expect(safeOutputPath(r, "demo")).toBe(join(r, "demo"));
  });
  it.each(["../escape", "/etc/passwd", ".", "a/../../b"])("blocks %s", (p) => {
    expect(() => safeOutputPath(root(), p)).toThrow(/inside the apps directory/);
  });
  it("refuses an existing directory", () => {
    const r = root();
    mkdirSync(join(r, "taken"));
    expect(() => safeOutputPath(r, "taken")).toThrow(/already exists/);
  });
  it("blocks escape through a symlinked parent", () => {
    const r = root();
    symlinkSync(tmpdir(), join(r, "link"));
    expect(() => safeOutputPath(r, "link/app")).toThrow(/symlink/);
  });
});

describe("findSecretLike", () => {
  it("spots common token shapes", () => {
    expect(findSecretLike(`token: ghp_${"a".repeat(36)}`)).toBeDefined();
    expect(findSecretLike(`GH_TOKEN=${STATELESS}`)).toBeDefined();
    expect(findSecretLike(`x ${STATELESS} y`)).toBeDefined();
    // Words in snake_case are words, however long.
    expect(findSecretLike("def weighs_more_than_the_maximum_allowed_value():")).toBeUndefined();
    expect(findSecretLike("ghs_and_lows_of_the_quarterly_report_numbers")).toBeUndefined();
    expect(findSecretLike("-----BEGIN RSA PRIVATE KEY-----")).toBeDefined();
    expect(findSecretLike(`api_token = "${"x".repeat(40)}"`)).toBeDefined();
  });
  it("ignores names of secrets", () => {
    expect(findSecretLike("secrets: [CLOUDFLARE_API_TOKEN]")).toBeUndefined();
  });
});

describe("maskSecrets", () => {
  it("hides keys and tokens before anything goes on an issue, and leaves words alone", () => {
    const cases: [string, string][] = [
      [`ghp_${"a".repeat(36)}`, "[token hidden]"],
      // GitHub's stateless installation token: the whole of it, its two dots and underscores too.
      [`run: ${STATELESS} done`, "run: [token hidden] done"],
      [`ghs_${"c".repeat(36)}`, "[token hidden]"],
      [
        "highs_and_lows_of_the_quarterly_report_numbers",
        "highs_and_lows_of_the_quarterly_report_numbers",
      ],
      [
        "CLOUDFLARE_API_TOKEN=abcdefghijklmnopqrstuvwxyz0123456789ABCD",
        "CLOUDFLARE_API_TOKEN=[hidden]",
      ],
      ['"client_secret": "abcdefghijklmnop1234"', '"client_secret": "[hidden]"'], // gitleaks:allow
      ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123", "Authorization: Bearer [hidden]"],
      [`sk-ant-${"b".repeat(40)}`, "[key hidden]"],
      ["token: none", "token: none"],
      ["Use the token budget wisely.", "Use the token budget wisely."],
    ];
    for (const [text, masked] of cases) expect(maskSecrets(text), text).toBe(masked);
  });
});
