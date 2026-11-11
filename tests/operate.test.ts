// Taking an app down (`ship down`, a task's take-down): the pipeline starts first, so GitHub's
// refusal changes nothing, and the bot's refusal names its fix.
import { afterEach, describe, expect, it, vi } from "vitest";

/** What gh was asked, and the answer to `workflow run`. */
const calls: string[] = [];
let dispatch = { code: 0, stdout: "", stderr: "" };
vi.mock("../cli/lib/exec.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cli/lib/exec.ts")>();
  const run = (cmd: string, args: string[], opts?: Parameters<typeof real.run>[2]) => {
    if (cmd !== "gh") return real.run(cmd, args, opts);
    calls.push(args.slice(0, 2).join(" "));
    if (args[0] === "workflow") return dispatch;
    if (args[0] === "api" && args[1] === "users/o")
      return { code: 0, stdout: "Organization\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { ...real, run };
});
vi.mock("../cli/lib/registry.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cli/lib/registry.ts")>()),
  loadRegistry: () => ({
    schemaVersion: 1,
    projects: [{ id: "games", kind: "app", repository: "https://github.com/o/games" }],
  }),
}));

afterEach(() => {
  calls.length = 0;
  dispatch = { code: 0, stdout: "", stderr: "" };
  vi.unstubAllEnvs();
});

describe("ship down", () => {
  it("starts the pipeline, then sets the flag", async () => {
    const { lifecycle } = await import("../cli/commands/operate.ts");
    expect(lifecycle("games", "down", true).status).toBe("succeeded");
    expect(calls).toEqual(["workflow run", "variable set"]);
  });

  it("a bot GitHub refuses changes nothing, and names the permission to give it", async () => {
    const { lifecycle } = await import("../cli/commands/operate.ts");
    vi.stubEnv("SHIPIFY_BOT_SLUG", "o-shipify");
    dispatch = {
      code: 1,
      stdout: "",
      stderr:
        "could not create workflow dispatch event: HTTP 403: Resource not accessible by integration",
    };
    expect(() => lifecycle("games", "down", true)).toThrow(
      "The bot may not start o/games's pipeline, so nothing changed.\nIn the bot's permissions, set Actions to Read and write, save, and accept the change on its install: https://github.com/organizations/o/settings/apps/o-shipify/permissions",
    );
    expect(calls).not.toContain("variable set");
  });
});
