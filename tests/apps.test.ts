// The apps the edge lists and the watch checks (ADR 0031): on a box, which keeps no registry, each
// repo's shipify.json on GitHub, read with the bot's read-only token.
import { describe, expect, it, vi } from "vitest";

const answers = new Map<string, string>();
vi.mock("../cli/lib/exec.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cli/lib/exec.ts")>();
  return {
    ...real,
    run: (cmd: string, args: string[], opts?: Parameters<typeof real.run>[2]) => {
      if (cmd !== "gh") return real.run(cmd, args, opts);
      const out = args[0] === "api" ? answers.get(args[1] ?? "") : undefined;
      return out === undefined
        ? { code: 1, stdout: "", stderr: "HTTP 404: Not Found" }
        : { code: 0, stdout: `${out}\n`, stderr: "" };
    },
  };
});

const file = (json: object) => Buffer.from(JSON.stringify(json)).toString("base64");

describe("the apps, from GitHub", () => {
  it("lists each app the bot reaches, skipping archived repos, packages and the platform", async () => {
    const { appsOnGitHub } = await import("../cli/commands/task/due.ts");
    answers.set(
      "installation/repositories?per_page=100",
      // Its pages, as --paginate --slurp gives them: an org can have more than 100 repos.
      JSON.stringify([
        { repositories: [{ name: "spotter", full_name: "o/spotter" }] },
        {
          repositories: [
            { name: "links", full_name: "o/links" },
            { name: "old-admin", full_name: "o/old-admin", archived: true },
            { name: "kit", full_name: "o/kit" },
            { name: "shipify", full_name: "o/shipify" },
          ],
        },
      ]),
    );
    answers.set(
      "repos/o/spotter/contents/shipify.json",
      file({ id: "spotter", kind: "app", urls: { production: "https://spotter.example.com" } }),
    );
    answers.set(
      "repos/o/links/contents/shipify.json",
      file({ id: "links", kind: "app", urls: { production: "javascript:alert(1)" } }),
    );
    answers.set("repos/o/old-admin/contents/shipify.json", file({ id: "old-admin", kind: "app" }));
    answers.set("repos/o/kit/contents/shipify.json", file({ id: "kit", kind: "package" }));
    expect(appsOnGitHub("read-token")).toEqual([
      // Only an https address is kept.
      { id: "links" },
      { id: "spotter", url: "https://spotter.example.com" },
    ]);
    expect(appsOnGitHub(undefined)).toEqual([]);
  });
});

describe("another account's repos (ADR 0045)", () => {
  it("are named by owner/name, are never projects, and cost no read of a shipify.json", async () => {
    const { reposOnGitHub } = await import("../cli/lib/projects-on-github.ts");
    answers.clear();
    answers.set(
      "installation/repositories?per_page=100",
      JSON.stringify([
        {
          repositories: [
            {
              name: "api",
              full_name: "Acme/api",
              size: 120,
              default_branch: "develop",
              owner: { id: 77 },
            },
            { name: "web.app", full_name: "Acme/web.app", size: 5, owner: { id: 77 } },
            { name: "old", full_name: "Acme/old", archived: true },
          ],
        },
      ]),
    );
    // A shipify.json there would make no project: projects are Shipify's own account's.
    answers.set("repos/Acme/api/contents/shipify.json", file({ id: "api", kind: "app" }));
    const listed = reposOnGitHub("acme-token", "acme");
    expect(listed).toEqual([
      {
        name: "Acme/api",
        repo: "Acme/api",
        sizeKB: 120,
        project: false,
        branch: "develop",
        ownerId: 77,
      },
      {
        name: "Acme/web.app",
        repo: "Acme/web.app",
        sizeKB: 5,
        project: false,
        branch: "main",
        ownerId: 77,
      },
    ]);
    // Each call a copy: what a run adds to its list never reaches what's kept for the token.
    listed.push({ name: "x/y", repo: "x/y", sizeKB: 0, project: false, branch: "main" });
    expect(reposOnGitHub("acme-token", "acme")).toHaveLength(2);
  });
});
