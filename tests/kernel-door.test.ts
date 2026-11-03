// A run and the door (cli/kernel/door.ts): a reply's files go to the door with their types, so a
// picture shows as a picture in every chat, 50 MB of them at most; the weekly clean-up asks it to
// forget closed chats' files.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetFiles, MOST_SENT_BYTES, tellDoor } from "../cli/kernel/door.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("tellDoor", () => {
  it("sends each file with its type, from its name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "door-"));
    const files = ["shot.png", "report.md", "data.bin"].map((n) => {
      writeFileSync(join(dir, n), n);
      return join(dir, n);
    });
    vi.stubEnv("SHIPIFY_DOOR_URL", "https://shipify.example.com");
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", "https://token.example.com/?x=1");
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "t");
    let sent: FormData | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://token.example.com")) return Response.json({ value: "oidc" });
      sent = init?.body as FormData;
      return Response.json({ sent: 1 });
    });
    await tellDoor(12, 34, files);
    expect(sent?.getAll("file").map((f) => [(f as File).name, (f as File).type])).toEqual([
      ["shot.png", "image/png"],
      ["report.md", "text/markdown"],
      ["data.bin", "application/octet-stream"],
    ]);
  });

  // ADR 0069: one request within Cloudflare's 100 MB, so the reply's words always get in.
  it("sends at most 50 MB of files in all; the rest stay on the branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "door-"));
    const MB = 1024 * 1024;
    const files = (
      [
        ["a.bin", 30],
        ["b.bin", 25],
        ["c.png", 19],
        ["d.md", 1],
      ] as const
    ).map(([n, mb]) => {
      writeFileSync(join(dir, n), Buffer.alloc(mb * MB));
      return join(dir, n);
    });
    door();
    let sent: FormData | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://token.example.com")) return Response.json({ value: "oidc" });
      sent = init?.body as FormData;
      return Response.json({ sent: 1 });
    });
    await tellDoor(12, 34, files);
    const got = (sent?.getAll("file") ?? []) as File[];
    expect(got.map((f) => f.name)).toEqual(["a.bin", "c.png", "d.md"]);
    expect(got.reduce((n, f) => n + f.size, 0)).toBeLessThanOrEqual(MOST_SENT_BYTES);
  });
});

/** A box's door and its job's OIDC token, as the workflow gives them. */
const door = () => {
  vi.stubEnv("SHIPIFY_DOOR_URL", "https://shipify.example.com");
  vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", "https://token.example.com/?x=1");
  vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "t");
};

describe("forgetFiles", () => {
  it("asks the door to delete these chats' files, with the job's own token, and says how many", async () => {
    door();
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.startsWith("https://token.example.com")) return Response.json({ value: "oidc" });
      return Response.json({ deleted: 3, bytes: 1200 });
    });
    expect(await forgetFiles([4, 5])).toEqual({ deleted: 3, bytes: 1200 });
    const [url, init] = calls.at(-1) ?? [];
    expect(url).toBe("https://shipify.example.com/door/files/forget");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ chats: [4, 5] });
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer oidc",
    );
  });

  it("says nothing when the door refuses, or there's no door or token here", async () => {
    door();
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("https://token.example.com")
        ? Response.json({ value: "oidc" })
        : Response.json({ error: "unproven", why: "workflow" }, { status: 403 }),
    );
    expect(await forgetFiles([4])).toBeUndefined();
    vi.stubEnv("SHIPIFY_DOOR_URL", "");
    expect(await forgetFiles([4])).toBeUndefined();
  });
});
