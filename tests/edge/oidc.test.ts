// A run proving itself to the door (edge/src/oidc.ts): only shipify's own task.yml or watch.yml, on
// main, with a token GitHub signed for the edge's origin, in date.
import { beforeAll, describe, expect, it } from "vitest";
import { claimsProblem, verifyRun } from "../../edge/src/oidc.ts";
import { envFor, type Keys, keys, REPO, runToken, world } from "./fake.ts";

let k: Keys;
beforeAll(async () => {
  k = await keys();
});

describe("a run's OIDC token", () => {
  it("takes shipify's task.yml and watch.yml on main", async () => {
    const { deps } = world(k);
    const env = envFor(k);
    for (const wf of ["task.yml", "watch.yml"]) {
      const token = await runToken(k, deps.now(), {
        workflow_ref: `${REPO}/.github/workflows/${wf}@refs/heads/main`,
      });
      expect(await verifyRun(token, env, deps)).toMatchObject({ ok: true });
    }
  });

  it("refuses another repository, owner, workflow, branch, audience or issuer", async () => {
    const { deps } = world(k);
    const env = envFor(k);
    const cases: [string, Record<string, unknown>][] = [
      ["repository", { repository_id: "9999" }],
      ["owner", { repository_owner_id: "9999" }],
      ["workflow", { workflow_ref: `${REPO}/.github/workflows/ci.yml@refs/heads/main` }],
      ["workflow", { workflow_ref: `${REPO}/.github/workflows/task.yml@refs/heads/feature` }],
      ["workflow", { workflow_ref: `evil/shipify/.github/workflows/task.yml@refs/heads/main` }],
      ["ref", { ref: "refs/heads/feature" }],
      ["audience", { aud: "https://elsewhere.example.com" }],
      ["issuer", { iss: "https://evil.example.com" }],
    ];
    for (const [why, claims] of cases)
      expect(await verifyRun(await runToken(k, deps.now(), claims), env, deps)).toEqual({
        ok: false,
        why,
      });
  });

  it("refuses an expired token, and one not yet good, past a minute's grace", async () => {
    const { deps } = world(k);
    const env = envFor(k);
    const s = Math.floor(deps.now() / 1000);
    expect(
      await verifyRun(await runToken(k, deps.now(), { exp: s - 61, iat: s - 400 }), env, deps),
    ).toEqual({ ok: false, why: "expired" });
    expect(
      await verifyRun(await runToken(k, deps.now(), { exp: s - 30, iat: s - 400 }), env, deps),
    ).toMatchObject({ ok: true });
    expect(
      await verifyRun(await runToken(k, deps.now(), { nbf: s + 120, iat: s + 120 }), env, deps),
    ).toEqual({ ok: false, why: "not yet valid" });
  });

  it("refuses a forged signature, another algorithm, and an unknown key", async () => {
    const { deps } = world(k);
    const env = envFor(k);
    const good = await runToken(k, deps.now());
    const [h, p] = good.split(".");
    const other = await keys();
    const forged = (await runToken(other, deps.now())).split(".")[2];
    expect(await verifyRun(`${h}.${p}.${forged}`, env, deps)).toEqual({
      ok: false,
      why: "signature",
    });
    expect(await verifyRun(await runToken(k, deps.now(), {}, { alg: "HS256" }), env, deps)).toEqual(
      {
        ok: false,
        why: "algorithm",
      },
    );
    expect(await verifyRun(await runToken(k, deps.now(), {}, { alg: "none" }), env, deps)).toEqual({
      ok: false,
      why: "algorithm",
    });
    expect(await verifyRun(await runToken(k, deps.now(), {}, { kid: "k9" }), env, deps)).toEqual({
      ok: false,
      why: "unknown key",
    });
    expect(await verifyRun("not.a-token", env, deps)).toEqual({ ok: false, why: "malformed" });
  });

  it("fetches GitHub's keys again for a key id it doesn't know, at most once a minute", async () => {
    const { w, deps } = world(k);
    const env = envFor(k);
    w.jwks = { keys: [] };
    expect(await verifyRun(await runToken(k, deps.now()), env, deps)).toEqual({
      ok: false,
      why: "unknown key",
    });
    // GitHub rotated its keys: the new one is found on the next fetch, a minute on.
    w.jwks = { keys: [k.jwk] };
    expect(await verifyRun(await runToken(k, deps.now()), env, deps)).toEqual({
      ok: false,
      why: "unknown key",
    });
    w.at += 61_000;
    expect(await verifyRun(await runToken(k, deps.now()), env, deps)).toMatchObject({ ok: true });
    const fetches = w.calls.filter((c) => c.includes("jwks")).length;
    expect(fetches).toBe(3);
  });

  it("says why claims fail, with nothing configured meaning no", () => {
    const now = Date.now();
    const s = Math.floor(now / 1000);
    expect(
      claimsProblem(
        { iss: "https://token.actions.githubusercontent.com", aud: "x", exp: s + 10, iat: s },
        {},
        now,
      ),
    ).toBe("audience");
  });
});
