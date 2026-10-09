// `ship door page` (ADR 0032): the status page, set up once from your PC, one step at a time. You
// add one Cloudflare Access application for the page's path in the dashboard (this PC has no key
// that may), paste its two public values, and it checks that the page sends you to Access's sign-in.
// Nothing secret is asked for or kept: the team's address and the application's audience tag are
// in every token Access sends.
import { platformRepo } from "../../cli/lib/github.ts";
import { type Check, type Result, ShipError } from "../../cli/lib/output.ts";
import { sourceControl } from "../../cli/lib/providers.ts";
import { parseAccess } from "../src/access.ts";
import { edgeOrigin } from "./worker.ts";

export interface PageDeps {
  fetch: typeof fetch;
  /** A line typed in the terminal. */
  ask: (question: string) => Promise<string>;
  say: (line: string) => void;
}

const defaultDeps = (): PageDeps => ({
  fetch: (input, init) => fetch(input, init),
  ask: async (question) => {
    if (!process.stdin.isTTY) return "";
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((done) =>
      rl.question(question, (a) => {
        rl.close();
        done(a.trim());
      }),
    );
  },
  say: (line) => process.stderr.write(`${line}\n`),
});

/** The steps in Cloudflare's dashboard, for the page's address. */
export const accessSteps = (host: string) => [
  "In Cloudflare's dashboard, open Zero Trust → Access → Applications → Add an application → Self-hosted.",
  `Name it “shipify status”. Domain: ${host}, path: admin/* (only that: the door's routes must stay open).`,
  "Policies: choose your existing allow-me policy (or make one: Include → Emails → your email). Save.",
  "Open the application again and copy its Application Audience (AUD) Tag.",
  "Your team's address is in Zero Trust → Settings → Custom pages (or the address bar): <team>.cloudflareaccess.com.",
];

/** What `/admin/status` says to a browser that isn't signed in: Access's sign-in in front, or not. */
export async function pageCheck(origin: string, f: typeof fetch = fetch): Promise<Check> {
  const name = "the status page sends you to Cloudflare Access's sign-in";
  try {
    const res = await f(`${origin}/admin/status`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const to = res.headers.get("location") ?? "";
    const signIn = res.status >= 300 && res.status < 400 && /\.cloudflareaccess\.com\//.test(to);
    return {
      name,
      ok: signIn,
      ...(signIn
        ? { detail: `${origin}/admin/status` }
        : {
            detail:
              res.status === 403
                ? "the edge answered itself (403): no Access application covers /admin yet (its path must be admin/*)"
                : `it answered ${res.status}`,
            fix: "pnpm ship door page --yes walks you through the Access application",
          }),
    };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message };
  }
}

export async function doorPage(yes: boolean, deps: PageDeps = defaultDeps()): Promise<Result> {
  const repo = platformRepo();
  const sc = sourceControl();
  const vars = sc.repoState(repo).variables;
  const origin = edgeOrigin(vars);
  if (!origin)
    throw new ShipError(
      "The edge's address is unknown: run pnpm ship door setup --yes first.",
      "blocked",
    );
  const host = new URL(origin).host;
  const set = parseAccess(vars.SHIPIFY_ACCESS);
  if (!yes)
    return {
      command: "door page",
      status: "succeeded",
      summary: set
        ? `the status page is set up (${set.team}); --yes checks it again, or takes new values`
        : `the plan: one Access application for ${host}/admin/* in Cloudflare's dashboard, then its two public values into shipify's SHIPIFY_ACCESS variable, then a check. Run it with --yes.`,
      checks: accessSteps(host).map((s, i) => ({ name: `${i + 1}. ${s}`, ok: true })),
    };
  const before = await pageCheck(origin, deps.fetch);
  if (set && before.ok)
    return {
      command: "door page",
      status: "succeeded",
      summary: `the status page is set up: ${origin}/admin/status`,
      checks: [before],
    };
  for (const [i, s] of accessSteps(host).entries()) deps.say(`  ${i + 1}. ${s}`);
  // Set up before: Enter keeps each saved value.
  const keep = set ? " (Enter keeps the one saved)" : "";
  const team =
    (await deps.ask(`Your team's address (<team>.cloudflareaccess.com)${keep}: `)) || set?.team;
  const aud = (await deps.ask(`The application's AUD tag${keep}: `)) || set?.aud;
  const access = parseAccess(JSON.stringify({ team, aud }));
  if (!access)
    throw new ShipError(
      "Those don't read as a team address (<team>.cloudflareaccess.com) and an AUD tag (64 letters and digits): run it again and paste them as Cloudflare shows them.",
      "blocked",
    );
  sc.setVariable(repo, "SHIPIFY_ACCESS", JSON.stringify(access));
  const after = await pageCheck(origin, deps.fetch);
  return {
    command: "door page",
    status: after.ok ? "succeeded" : "failed",
    summary: after.ok
      ? `the status page is set up: open ${origin}/admin/status and sign in`
      : `saved, but ${after.detail}: check the application's domain and path (${host}, admin/*)`,
    checks: [{ name: "SHIPIFY_ACCESS is set (public values only)", ok: true }, after],
  };
}
