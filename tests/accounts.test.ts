// Your accounts (ADR 0045): the list that makes an account yours, and the one account a task works
// on, said by one function for the task step and plan alike.
import { afterEach, describe, expect, it } from "vitest";
import {
  accountList,
  accountOf,
  accountsValue,
  taskAccount,
  yourAccounts,
} from "../cli/lib/accounts.ts";
import { keepRepos, parseStatusIssue } from "../cli/lib/status-issue.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("your accounts", () => {
  it("are the logins you added, each once, in lower case, never Shipify's own or a non-login", () => {
    process.env.GITHUB_REPOSITORY = "o/shipify";
    expect(yourAccounts({ SHIPIFY_ACCOUNTS: "Acme, beta  acme,o,-bad,good-one" })).toEqual([
      "acme",
      "beta",
      "good-one",
    ]);
    expect(yourAccounts({})).toEqual([]);
  });

  it("are pinned by GitHub's id, as `ship bot repos` writes them, and read back the same", () => {
    process.env.GITHUB_REPOSITORY = "o/shipify";
    const list = accountList({ SHIPIFY_ACCOUNTS: "acme:77,Beta,acme:99,bad:x1" });
    expect(list).toEqual([{ login: "acme", id: 77 }, { login: "beta" }, { login: "bad" }]);
    expect(accountsValue(list)).toBe("acme:77,beta,bad");
    expect(yourAccounts({ SHIPIFY_ACCOUNTS: "acme:77" })).toEqual(["acme"]);
  });

  it("place a repo by its owner: another of yours, or none (Shipify's own, or anyone else's)", () => {
    const listed = ["acme"];
    expect(accountOf("Acme/api", listed)).toBe("acme");
    expect(accountOf("o/spotter", listed)).toBeUndefined();
    expect(accountOf("stranger/x", listed)).toBeUndefined();
    expect(accountOf("spotter", listed)).toBeUndefined();
  });
});

describe("the account a task works on", () => {
  const listed = ["acme", "beta"];

  it("is its repo's: its state's first, then its title's, then its first look at one of yours", () => {
    expect(taskAccount({ project: "Acme/api", titled: "beta/web", looks: [] }, listed)).toBe(
      "acme",
    );
    expect(taskAccount({ work: "beta/web", looks: ["acme/api"] }, listed)).toBe("beta");
    expect(taskAccount({ titled: "acme/api", looks: ["beta/web"] }, listed)).toBe("acme");
    expect(taskAccount({ looks: ["stranger/x", "spotter", "beta/web", "acme/api"] }, listed)).toBe(
      "beta",
    );
  });

  it("is Shipify's own when its repo is there, whatever its words look at", () => {
    expect(taskAccount({ titled: "spotter", looks: ["acme/api"] }, listed)).toBeUndefined();
    expect(taskAccount({ project: "notes-app", looks: ["acme/api"] }, listed)).toBeUndefined();
    expect(taskAccount({ looks: ["stranger/x"] }, listed)).toBeUndefined();
  });
});

describe("Shipify's own repos, kept for /repos (ADR 0047)", () => {
  it("are kept sorted, repo names only, each once, with which are projects", () => {
    const s = parseStatusIssue(null);
    const at = "2026-10-09T10:00:00.000Z";
    keepRepos(
      s,
      [
        { name: "spotter", project: true },
        { name: "notes-api", project: false },
        { name: "spotter", project: true },
        { name: "not a name", project: false },
      ],
      at,
    );
    expect(s.repos).toEqual({ at, names: ["notes-api", "spotter"], projects: ["spotter"] });
  });
});
