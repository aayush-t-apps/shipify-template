// A run and the door (cli/kernel/door.ts): a reply's files go to the door with their types, so a
// picture shows as a picture in every chat.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tellDoor } from "../cli/kernel/door.ts";

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
});
