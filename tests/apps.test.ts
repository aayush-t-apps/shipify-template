// The apps the edge lists and the watch checks (ADR 0031): on a box, which keeps no registry, each
// repo's shipify.json on GitHub, read with the bot's read-only token.
import { describe, expect, it, vi } from "vitest";

const answers = new Map<string, string>();
/** Each repo's shipify.json as GraphQL reads it (owner/name → its text); one with none is left out. */
const manifests = new Map<string, string>();
/** Repos GraphQL can't resolve (another App's, or gone): null, and an error, as GitHub answers. */
const unreadable = new Set<string>();
/** What gh was asked: each call's path ("graphql" for a query). */
const calls: string[] = [];
let graphqlDown = false;
vi.mock("../cli/lib/exec.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cli/lib/exec.ts")>();
  return {
    ...real,
    run: (cmd: string, args: string[], opts?: Parameters<typeof real.run>[2]) => {
      if (cmd !== "gh") return real.run(cmd, args, opts);
      calls.push(args[1] ?? "");
      if (args[0] === "api" && args[1] === "graphql") {
        if (graphqlDown) return { code: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" };
        const query = args.find((a) => a.startsWith("query=")) ?? "";
        const data: Record<string, unknown> = {};
        for (const m of query.matchAll(/(r\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)/g)) {
          const repo = `${m[2]}/${m[3]}`;
          const text = manifests.get(repo);
          data[m[1] as string] = unreadable.has(repo) ? null : { object: text ? { text } : null };
        }
        // GitHub answers what it could read, and gh exits 1 when any part couldn't be.
        return {
          code: unreadable.size ? 1 : 0,
          stdout: `${JSON.stringify({ data })}\n`,
          stderr: "",
        };
      }
      const out = args[0] === "api" ? answers.get(args[1] ?? "") : undefined;
      return out === undefined
        ? { code: 1, stdout: "", stderr: "HTTP 404: Not Found" }
        : { code: 0, stdout: `${out}\n`, stderr: "" };
    },
  };
});

const manifest = (json: object) => JSON.stringify(json);

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
    manifests.set(
      "o/spotter",
      manifest({ id: "spotter", kind: "app", urls: { production: "https://spotter.example.com" } }),
    );
    manifests.set(
      "o/links",
      manifest({ id: "links", kind: "app", urls: { production: "javascript:alert(1)" } }),
    );
    manifests.set("o/old-admin", manifest({ id: "old-admin", kind: "app" }));
    manifests.set("o/kit", manifest({ id: "kit", kind: "package" }));
    calls.length = 0;
    expect(appsOnGitHub("read-token")).toEqual([
      // Only an https address is kept.
      { id: "links" },
      { id: "spotter", url: "https://spotter.example.com" },
    ]);
    // Two calls, whatever the number of repos: the list, then one query for every shipify.json.
    expect(calls).toEqual(["installation/repositories?per_page=100", "graphql"]);
    expect(appsOnGitHub(undefined)).toEqual([]);
  });

  it("reads 50 repos' shipify.json a query; one GitHub can't read is a repo, not a project", async () => {
    const { reposOnGitHub } = await import("../cli/lib/projects-on-github.ts");
    answers.clear();
    manifests.clear();
    const names = Array.from({ length: 60 }, (_, i) => `r${String(i).padStart(2, "0")}`);
    answers.set(
      "installation/repositories?per_page=100",
      JSON.stringify([{ repositories: names.map((n) => ({ name: n, full_name: `o/${n}` })) }]),
    );
    manifests.set("o/r07", manifest({ id: "seven", kind: "app" }));
    manifests.set("o/r55", manifest({ id: "fifty-five", kind: "app" }));
    unreadable.add("o/r56");
    manifests.set("o/r56", manifest({ id: "never-read", kind: "app" }));
    calls.length = 0;
    const listed = reposOnGitHub("big-token");
    unreadable.clear();
    expect(calls).toEqual(["installation/repositories?per_page=100", "graphql", "graphql"]);
    expect(listed).toHaveLength(60);
    expect(listed.filter((r) => r.project).map((r) => r.name)).toEqual(["fifty-five", "seven"]);
    expect(listed.find((r) => r.repo === "o/r56")).toMatchObject({ name: "r56", project: false });
  });

  it("says so when GitHub can't answer the query at all, rather than call every project a repo", async () => {
    const { reposOnGitHub } = await import("../cli/lib/projects-on-github.ts");
    answers.set(
      "installation/repositories?per_page=100",
      JSON.stringify([{ repositories: [{ name: "spotter", full_name: "o/spotter" }] }]),
    );
    graphqlDown = true;
    try {
      expect(() => reposOnGitHub("down-token")).toThrow(/HTTP 502: Bad Gateway/);
    } finally {
      graphqlDown = false;
    }
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
    manifests.set("Acme/api", manifest({ id: "api", kind: "app" }));
    calls.length = 0;
    const listed = reposOnGitHub("acme-token", "acme");
    expect(calls).toEqual(["installation/repositories?per_page=100"]);
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
