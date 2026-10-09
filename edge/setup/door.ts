// `ship door` (ADR 0031, "Setup"): the edge's door App, made the way the bot is, and its check.
//   door setup [--new] [--yes]  makes the door App from a manifest (two clicks in your browser:
//                               Create, then Install on shipify only), puts its key on the edge's
//                               Worker as PKCS#8 (`wrangler secret put`, from stdin), sets the
//                               variables the edge is deployed with, and starts that deploy.
//                               --new: a new key for the same App (made on its page), put in place
//   door check                  the edge answers /health with its version, the door App is installed
//                               on shipify alone with exactly its permissions, and /door/telegram
//                               without Telegram's secret answers 401 (not a sign-in's redirect)
// The App's key is never printed or saved here: it goes from GitHub's answer (or the file GitHub
// downloaded) straight to the Worker. `ship door` runs this; it lives with the edge, since it names
// the edge's host and routes, which the core doesn't (tests/core.test.ts).

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { exchangeCode, openBrowser } from "../../cli/commands/bot.ts";
import { credential, loadCredentials } from "../../cli/lib/credentials.ts";
import type { RunResult } from "../../cli/lib/exec.ts";
import { ghRun, platformRepo, settingsHome } from "../../cli/lib/github.ts";
import { type Check, type Result, ShipError } from "../../cli/lib/output.ts";
import { sourceControl } from "../../cli/lib/providers.ts";
import { parseAccess } from "../src/access.ts";
import { CHANNELS } from "../src/channels/index.ts";
import { pageCheck } from "./page.ts";
import { EDGE_SETTINGS } from "./settings.ts";
import {
  appJwt,
  cloudflareFound,
  cloudflareMissing,
  EDGE_APP,
  edgeOrigin,
  edgeSecretNames,
  putEdgeSecret,
  toPkcs8,
} from "./worker.ts";

/** What the door App may do (ADR 0031): shipify's issues, and reading its runs and runners. */
export const DOOR_PERMISSIONS = {
  issues: "write",
  actions: "read",
  administration: "read",
  metadata: "read",
} as const;
/** Variables: read, ticked by hand after: like the bot's, it has no manifest key. */
const VARIABLES = ["variables", "actions_variables"];
/**
 * What door setup sets on your copy, from the one list (edge/setup/settings.ts): the variables the
 * edge is deployed with (ci.yml passes them to the Worker; APPS_DOMAIN only with a domain), and the
 * key its deploy runs with, from your credentials file.
 */
const OWN = EDGE_SETTINGS.filter((s) => s.steps?.includes("door") && !s.optional);
export const DOOR_VARS = OWN.filter((s) => s.lives[0] === "variable").map((s) => s.name);
const DOOR_KEYS = OWN.filter((s) => s.lives[0] === "secret").map((s) => s.name);

export function doorManifest(org: string, base: string) {
  return {
    name: `${org}-shipify-door`.slice(0, 34),
    url: `https://github.com/${org}/shipify`,
    description:
      "Shipify's door: writes your chat messages onto tasks and copies replies back. Shipify only.",
    hook_attributes: { url: `https://github.com/${org}/shipify`, active: false },
    redirect_url: `${base}/done`,
    setup_url: `${base}/installed`,
    public: false,
    default_permissions: DOOR_PERMISSIONS,
    default_events: [],
  };
}

/** The App GitHub made: its id, name and key (PKCS#1, as GitHub gives it), and its install. */
export interface DoorApp {
  id: number;
  slug: string;
  pem: string;
  installation?: number;
}

export interface DoorDeps {
  fetch: typeof fetch;
  wait: (ms: number) => Promise<void>;
  /** The App made in your browser from its manifest, and installed: two clicks. */
  create: (org: string) => Promise<DoorApp>;
  /** A line typed in the terminal. */
  ask: (question: string) => Promise<string>;
  /** gh, for this PC's own reads and the deploy's start. */
  gh: (args: string[]) => RunResult;
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${html(title)}</title><body style="font:16px system-ui;max-width:36rem;margin:3rem auto">${body}`;

/**
 * The manifest flow on this PC (as `ship bot`): a local page posts the manifest to GitHub, you
 * press Create, GitHub sends back a one-time code (exchanged for the App's key), then you install
 * it on shipify only and GitHub brings you back with its installation's id.
 */
export function createInBrowser(org: string): Promise<DoorApp> {
  const state = randomBytes(12).toString("hex");
  return new Promise((resolve, reject) => {
    let app: DoorApp | undefined;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const port = (server.address() as { port: number } | null)?.port;
      const base = `http://localhost:${port}`;
      if (url.pathname === "/" && !app) {
        const manifest = JSON.stringify(doorManifest(org, base));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          page(
            "Shipify's door",
            `<h1>Create Shipify's door</h1><p>GitHub opens next: check the name and press <b>Create GitHub App</b>.</p>
<form id="f" method="post" action="${html(settingsHome(org))}/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${html(manifest)}"><button>Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script>`,
          ),
        );
        return;
      }
      if (url.pathname === "/done" && !app) {
        const code = url.searchParams.get("code");
        if (url.searchParams.get("state") !== state || !code) {
          res.writeHead(400).end("This link isn't from this setup.");
          return;
        }
        try {
          const made = await exchangeCode(code);
          app = { id: made.id, slug: made.slug, pem: made.pem };
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            page(
              "Shipify's door",
              `<h1>${html(made.slug)} is created</h1><p>Now <a href="https://github.com/apps/${html(made.slug)}/installations/new"><b>install it</b></a> on <b>${html(org)}</b>, choosing <b>Only select repositories</b> and <b>shipify</b>.</p>`,
            ),
          );
        } catch (e) {
          res.writeHead(500).end(`Setup failed: ${(e as Error).message}`);
          server.close();
          reject(e);
        }
        return;
      }
      if (url.pathname === "/installed" && app) {
        const id = Number(url.searchParams.get("installation_id"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          page(
            "Shipify's door",
            `<h1>Installed</h1><p>One last step: in its <a href="${html(settingsHome(org))}/apps/${html(app.slug)}/permissions">permissions</a>, set <b>Variables</b> to <b>Read-only</b>, save, and accept the change on the install. Then go back to the terminal.</p>`,
          ),
        );
        server.close();
        resolve({ ...app, ...(Number.isSafeInteger(id) && id > 0 ? { installation: id } : {}) });
        return;
      }
      res.writeHead(app ? 410 : 404).end("This setup has moved on: see the terminal.");
    });
    server.listen(0, "127.0.0.1", () => {
      const url = `http://localhost:${(server.address() as { port: number }).port}/`;
      process.stderr.write(
        `  … ${openBrowser(url) ? "opened" : "open"} ${url} in your browser: create the App, then install it on shipify only.\n`,
      );
    });
    setTimeout(() => {
      server.close();
      reject(
        new ShipError("Timed out after 15 minutes. Run it again when you're ready.", "blocked"),
      );
    }, 15 * 60_000).unref();
  });
}

const defaultDeps = (): DoorDeps => ({
  fetch: (input, init) => fetch(input, init),
  gh: (args) => ghRun(args),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  create: createInBrowser,
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
});

// ---------------------------------------------------------------- the App, as GitHub knows it

/** One call as the App (its JWT), or with an installation's token. */
async function asApp<T>(deps: DoorDeps, auth: string, path: string, method = "GET") {
  const res = await deps.fetch(`https://api.github.com/${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${auth}`,
      "user-agent": "shipify",
      "x-github-api-version": "2022-11-28",
    },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null };
}

/** The App's install on the org: its id, the repos it reaches, and its permissions. */
export async function installation(app: DoorApp, org: string, deps: DoorDeps) {
  const jwt = appJwt(app.id, app.pem);
  let id = app.installation;
  if (!id) {
    const list = await asApp<{ id: number; account?: { login?: string } }[]>(
      deps,
      jwt,
      "app/installations",
    );
    id = list.body?.find((i) => i.account?.login?.toLowerCase() === org.toLowerCase())?.id;
  }
  if (!id) return undefined;
  const got = await asApp<{ permissions?: Record<string, string>; repository_selection?: string }>(
    deps,
    jwt,
    `app/installations/${id}`,
  );
  if (got.status !== 200) return undefined;
  const token = await asApp<{ token?: string }>(
    deps,
    jwt,
    `app/installations/${id}/access_tokens`,
    "POST",
  );
  const repos = token.body?.token
    ? await asApp<{ repositories?: { name: string }[] }>(
        deps,
        token.body.token,
        "installation/repositories?per_page=10",
      )
    : undefined;
  return {
    id,
    permissions: got.body?.permissions ?? {},
    selection: got.body?.repository_selection ?? "",
    repos: (repos?.body?.repositories ?? []).map((r) => r.name),
  };
}

/** What's wrong with an install's reach or permissions, a line each; nothing when it's right. */
export function installProblems(i: {
  permissions: Record<string, string>;
  selection: string;
  repos: string[];
}): string[] {
  const out: string[] = [];
  if (i.selection !== "selected" || i.repos.join(",") !== "shipify")
    out.push(
      `it reaches ${i.selection === "all" ? "every repository" : i.repos.join(", ") || "no repository"}, not shipify alone`,
    );
  const want: Record<string, string> = { ...DOOR_PERMISSIONS };
  const got = { ...i.permissions };
  const variables = VARIABLES.find((k) => got[k]);
  if (variables) {
    if (got[variables] !== "read") out.push(`Variables is ${got[variables]}, not read-only`);
    delete got[variables];
  } else out.push("Variables isn't read-only yet");
  for (const [k, v] of Object.entries(want))
    if (got[k] !== v) out.push(`${k} is ${got[k] ?? "off"}, not ${v}`);
  for (const k of Object.keys(got).filter((k) => !(k in want)))
    out.push(`${k} is on: it shouldn't be`);
  return out;
}

/** The newest key GitHub downloaded for an App in the last day (`<slug>.<date>.private-key.pem`). */
export function downloadedKey(dirs = downloadDirs()): string | undefined {
  const found = dirs.flatMap((d) =>
    existsSync(d)
      ? readdirSync(d)
          .filter((f) => f.endsWith(".private-key.pem") && f.includes("shipify-door"))
          .map((f) => join(d, f))
      : [],
  );
  const fresh = found
    .map((f) => ({ f, at: statSync(f).mtimeMs }))
    .filter((x) => Date.now() - x.at < 86_400_000)
    .sort((a, b) => b.at - a.at);
  return fresh[0]?.f;
}

const downloadDirs = () => {
  const dirs = [join(homedir(), "Downloads")];
  if (existsSync("/mnt/c/Users"))
    for (const u of readdirSync("/mnt/c/Users")) dirs.push(join("/mnt/c/Users", u, "Downloads"));
  return dirs;
};

// ---------------------------------------------------------------- door setup

const blocked = (summary: string, nextSteps: string[] = [], checks: Check[] = []): Result => ({
  command: "door setup",
  status: "blocked",
  summary,
  checks,
  nextSteps,
});

/** shipify's numeric id and its owner's: what a run's OIDC token is checked against. */
function repoIds(repo: string, deps: DoorDeps): { repo: string; owner: string } | undefined {
  const r = deps.gh(["api", `repos/${repo}`, "--jq", "[.id, .owner.id] | @tsv"]);
  const [id, owner] = r.stdout.trim().split("\t");
  return r.code === 0 && id && owner ? { repo: id, owner } : undefined;
}

/** `ship door setup [--new] [--yes]`. */
export async function doorSetup(
  yes: boolean,
  opts: { renew?: boolean; code?: string; key?: string; deps?: Partial<DoorDeps> } = {},
): Promise<Result> {
  const deps = { ...defaultDeps(), ...opts.deps };
  const repo = platformRepo();
  const org = repo.split("/")[0] as string;
  const sc = sourceControl();
  const state = sc.repoState(repo);
  const vars = state.variables;
  let origin = edgeOrigin(vars);
  let cf = cloudflareMissing();
  // The edge's deploy key, on your copy from this PC's credentials file: ci.yml deploys with it.
  const keysOff = DOOR_KEYS.filter((n) => !state.secrets.includes(n));
  const putKeys = (): Check[] => {
    if (!keysOff.length) return [];
    const values = loadCredentials().values;
    for (const n of keysOff) sc.setSecret(repo, n, credential(values, n) ?? "");
    return [{ name: `the edge's deploy key is on ${repo}`, ok: true, detail: keysOff.join(", ") }];
  };
  const appId = vars.SHIPIFY_DOOR_APP_ID;
  const keyFile = opts.renew ? (opts.key ?? downloadedKey()) : undefined;
  const planned = [
    cf ? `first: ${cf}` : "this PC has Cloudflare's deploy token (credentials file): ✓",
    origin
      ? `the edge's address: ${origin}`
      : "the edge's address: its free shipify.<your workers.dev name>.workers.dev, read from Cloudflare with the deploy token (or your domain, with APPS_DOMAIN in the credentials file)",
    ...(opts.renew
      ? [
          `read the new key GitHub downloaded for the door App ${appId ?? "(none yet)"}: ${keyFile ?? "you give its path"}, check it's that App's`,
        ]
      : [
          `open a page on this PC that sends GitHub the door App's manifest: you press Create GitHub App for ${org} (a private App named ${doorManifest(org, "").name}: Issues read and write; Actions, Administration and Metadata read)`,
          `you install it on ${repo} only (Only select repositories → shipify), and set Variables to Read-only in its permissions`,
        ]),
    "put its key, as PKCS#8, on the edge's Worker: wrangler secret put SHIPIFY_DOOR_APP_KEY (from stdin; never printed or saved)",
    `set the variables on ${repo}: ${DOOR_VARS.join(", ")}${origin ? ` (SHIPIFY_DOOR_URL=${origin})` : ""}`,
    ...(keysOff.length
      ? [
          `set the secret ${keysOff.join(", ")} on ${repo}, from your credentials file: the edge's deploy runs with it`,
        ]
      : []),
    `start ci.yml on main, so the edge is deployed with them`,
  ];
  const again = `pnpm ship door setup${opts.renew ? " --new" : ""} --yes`;
  if (!yes)
    return {
      command: "door setup",
      status: "requires-approval",
      summary: opts.renew
        ? "would put a new key for the door App in place"
        : "would make the door App, and give the edge its key",
      plannedActions: planned,
      nextSteps: [again, "then: pnpm ship door check"],
    };
  // Found, not typed (ADR 0047): your account and its workers.dev name, when this PC lacks them.
  const found = await cloudflareFound(deps.fetch);
  if (found.length) {
    cf = cloudflareMissing();
    origin = edgeOrigin(vars);
  }
  if (cf) return blocked(cf, [cf]);
  if (!origin)
    return blocked("the edge's address is unknown", [
      "Cloudflare didn't say your workers.dev name: open Workers once on its dashboard (it makes one), or put APPS_DOMAIN=<your domain> in your credentials file, then run this again",
    ]);
  // Set up already: nothing to make (a new key is --new's). Only when every variable is there too:
  // a setup stopped while it waited for the install has the App and its key, but not them.
  const held = edgeSecretNames();
  const unset = DOOR_VARS.filter((v) => !vars[v]);
  if (
    !opts.renew &&
    appId &&
    held.ok &&
    held.names.includes("SHIPIFY_DOOR_APP_KEY") &&
    unset.length
  )
    return blocked(
      `the door App ${appId} and its key are there, but the setup stopped before it finished (not set: ${unset.join(", ")})`,
      [
        "on the App's page, Private keys → Generate a private key (it downloads), then: pnpm ship door setup --new --yes (it finds the download and finishes)",
      ],
    );
  if (!opts.renew && appId && held.ok && held.names.includes("SHIPIFY_DOOR_APP_KEY")) {
    // Set up before its deploy key was one of its settings: only that is left to do.
    const put = putKeys();
    return {
      command: "door setup",
      status: put.length ? "succeeded" : "skipped",
      summary: `the door App ${appId} is set up, and the edge holds its key`,
      checks: put,
      nextSteps: [
        "pnpm ship door check",
        "a new key: make one on the App's page, then pnpm ship door setup --new --yes",
      ],
    };
  }
  if (!opts.renew && appId)
    return blocked(
      `the door App ${appId} exists, but the edge doesn't hold its key${held.ok ? "" : ` (${held.why})`}`,
      [
        "make a new key on the App's page (Private keys → Generate), then: pnpm ship door setup --new --yes",
      ],
    );
  const checks: Check[] = [];
  // The App: made now, or (--new) the one there is, with the key you downloaded.
  let app: DoorApp;
  if (opts.renew) {
    if (!appId) return blocked("there's no door App yet", ["pnpm ship door setup --yes"]);
    const file =
      keyFile ?? (await deps.ask("Path to the .pem GitHub downloaded for the door App: "));
    if (!file || !existsSync(file))
      return blocked("no key file to read", [
        `run it again with the key's path: pnpm ship door setup --new --key <file.pem> --yes`,
      ]);
    const pem = readFileSync(file, "utf8");
    const me = await asApp<{ id?: number; slug?: string }>(deps, appJwt(appId, pem), "app");
    if (me.status !== 200 || String(me.body?.id) !== appId)
      return blocked(`that key isn't the door App ${appId}'s (GitHub answered ${me.status})`, [
        "download a new key from the App's page, then run this again",
      ]);
    app = { id: Number(appId), slug: me.body?.slug ?? "", pem };
    checks.push({ name: `the key is the door App ${appId}'s`, ok: true, detail: file });
  } else {
    app = opts.code ? { ...(await exchangeCode(opts.code, deps.fetch)) } : await deps.create(org);
    checks.push({ name: `the door App ${app.slug} is made`, ok: true, detail: `id ${app.id}` });
  }
  // Its key on the Worker first: from here a run that stops can carry on with --new.
  const put = putEdgeSecret("SHIPIFY_DOOR_APP_KEY", toPkcs8(app.pem));
  checks.push({ name: "the edge holds the door App's key (PKCS#8)", ok: put.ok, detail: put.why });
  if (!put.ok)
    return blocked(
      "the key couldn't be put on the edge",
      [`fix it, then: pnpm ship door setup --new --yes`],
      checks,
    );
  sc.setVariable(repo, "SHIPIFY_DOOR_APP_ID", String(app.id));
  // An App's key never expires: no key date for it (ADR 0047: only real ones).
  // Its install: right when GitHub reaches shipify alone with exactly its permissions (Variables
  // is ticked by hand, so it's waited for, 10 minutes at most).
  let inst = await installation(app, org, deps);
  let said = "";
  for (let i = 0; i < 60 && (!inst || installProblems(inst).length); i++) {
    // What it waits for, each time that changes: never a silent wait.
    const now = inst ? installProblems(inst).join("; ") : "it isn't installed on the org yet";
    if (now !== said) {
      process.stderr.write(
        `  … waiting (10 minutes at most) for the door App's install: ${now}. Its permissions: ${settingsHome(org)}/apps/${app.slug}/permissions (then accept the change on the install)\n`,
      );
      said = now;
    }
    await deps.wait(10_000);
    inst = await installation({ ...app, ...(inst ? { installation: inst.id } : {}) }, org, deps);
  }
  const problems = inst ? installProblems(inst) : ["it isn't installed on the org"];
  checks.push({
    name: `it's installed on ${repo} alone, with exactly its permissions`,
    ok: !problems.length,
    detail: problems.join("; ") || `installation ${inst?.id}`,
  });
  if (!inst)
    return blocked(
      "the door App isn't installed yet",
      [
        `install it: https://github.com/apps/${app.slug}/installations/new (Only select repositories → shipify), then: pnpm ship door setup --new --yes`,
      ],
      checks,
    );
  const ids = repoIds(repo, deps);
  if (!ids) return blocked(`GitHub didn't say ${repo}'s ids`, [again], checks);
  // The runs know the door App's comments by its slug (`<slug>[bot]`); the edge's deploy, its
  // account, and your domain when the edge is on it (shipify.<APPS_DOMAIN>; else workers.dev).
  const host = new URL(origin).hostname;
  const domain = host.endsWith(".workers.dev") ? host : host.replace(/^shipify\./, "");
  const account = credential(loadCredentials().values, "CLOUDFLARE_ACCOUNT_ID");
  const want: Record<string, string> = {
    SHIPIFY_DOOR_APP_ID: String(app.id),
    ...(app.slug ? { SHIPIFY_DOOR_SLUG: app.slug } : {}),
    SHIPIFY_DOOR_INSTALLATION: String(inst.id),
    SHIPIFY_DOOR_URL: origin,
    SHIPIFY_REPO_ID: ids.repo,
    SHIPIFY_OWNER_ID: ids.owner,
    ...(domain !== host ? { APPS_DOMAIN: domain } : {}),
    ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}),
  };
  for (const [name, value] of Object.entries(want))
    if (vars[name] !== value) sc.setVariable(repo, name, value);
  checks.push({ name: `the variables are set on ${repo}`, ok: true, detail: DOOR_VARS.join(", ") });
  checks.push(...putKeys());
  // A deploy hands them to the Worker. Before the edge is on main, there's nothing to deploy yet.
  const d = deps.gh(["workflow", "run", "ci.yml", "--ref", "main", "-R", repo]);
  checks.push({
    name: "the edge is deploying with them (ci.yml on main)",
    ok: d.code === 0,
    blocking: false,
    detail: d.code === 0 ? `gh run list -R ${repo} -w ci -L 1` : d.stderr.trim().split("\n")[0],
  });
  return {
    command: "door setup",
    status: problems.length ? "blocked" : "succeeded",
    summary: problems.length
      ? `the door App is made and the edge holds its key, but its install isn't right: ${problems.join("; ")}`
      : `the door App ${app.slug} is set up: the edge holds its key, and is deploying with its variables`,
    checks,
    nextSteps: [
      ...(problems.length
        ? [`fix it on ${settingsHome(org)}/installations/${inst.id}, then: pnpm ship door check`]
        : []),
      "once ci's edge job is done: pnpm ship door check",
      "then: pnpm ship add telegram --yes",
    ],
  };
}

// ---------------------------------------------------------------- door check

interface Health {
  status?: string;
  app?: string;
  version?: string;
  commit?: string;
  door?: {
    permissions?: Record<string, string>;
    selection?: string;
    repos?: string[];
    error?: string;
  } | null;
}

/** `ship door check`: the edge, the door App, and the door's route, each said plainly. */
/** The edge redeploys only when its inputs change: what changed on main since its commit says if it's behind. */
const EDGE_INPUTS = /^(edge\/|cli\/contracts\/|intents\.json$)/;
function edgeBehind(
  deps: Pick<DoorDeps, "gh">,
  repo: string,
  commit: string | undefined,
  main: string,
): string {
  if (!main || !commit || commit === main) return ", main";
  const changed = deps
    .gh(["api", `repos/${repo}/compare/${commit}...${main}`, "--jq", ".files[].filename"])
    .stdout.split("\n")
    .filter(Boolean);
  return changed.some((f) => EDGE_INPUTS.test(f))
    ? `; main (${main.slice(0, 7)}) has edge changes since: its deploy may be on its way`
    : ", in step with main (nothing the edge runs has changed since)";
}

export async function doorCheck(
  deps: Pick<DoorDeps, "fetch" | "gh"> = defaultDeps(),
): Promise<Result> {
  const repo = platformRepo();
  const vars = sourceControl().repoState(repo).variables;
  const origin = edgeOrigin(vars);
  if (!origin)
    throw new ShipError("The edge's address is unknown: pnpm ship door setup says how.", "blocked");
  const checks: Check[] = [];
  const unset = DOOR_VARS.filter((v) => !vars[v]);
  checks.push({
    name: `shipify's variables for the edge are set`,
    ok: !unset.length,
    detail: unset.length ? `not set: ${unset.join(", ")}` : undefined,
    fix: unset.length ? "pnpm ship door setup --yes" : undefined,
  });
  let health: Health | undefined;
  try {
    const res = await deps.fetch(`${origin}/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    health = res.status === 200 ? ((await res.json()) as Health) : undefined;
    const main = deps.gh(["api", `repos/${repo}/commits/main`, "--jq", ".sha"]).stdout.trim();
    const isEdge = health?.app === EDGE_APP;
    checks.push({
      name: "the edge answers /health with its version",
      ok: Boolean(isEdge && health?.version),
      detail: !health
        ? `it answered ${res.status}`
        : !isEdge
          ? `it's ${health.app ?? "something else"}, not the edge yet: its deploy comes with the release`
          : `v${health.version} at ${(health.commit ?? "").slice(0, 7)}${edgeBehind(deps, repo, health.commit, main)}`,
      fix: isEdge ? undefined : `gh run list -R ${repo} -w ci -L 3: the edge job deploys it`,
    });
  } catch (e) {
    checks.push({
      name: "the edge answers /health with its version",
      ok: false,
      detail: (e as Error).message,
    });
  }
  const door = health?.door;
  const problems = door?.permissions
    ? installProblems({
        permissions: door.permissions,
        selection: door.selection ?? "",
        repos: door.repos ?? [],
      })
    : [door?.error ?? "the edge can't say: it has no door App key, or GitHub refused it"];
  checks.push({
    name: "the door App is installed on shipify alone, with exactly its permissions",
    ok: !problems.length,
    detail: problems.join("; ") || undefined,
    fix: problems.length ? "pnpm ship door setup --yes (or --new with a new key)" : undefined,
  });
  // Each chat channel's route, without its proof: 401 (not a sign-in in front, not a missing key).
  for (const ch of Object.values(CHANNELS).filter((c) => c.verify)) {
    const name = `/door/${ch.id} without ${ch.name}'s proof answers 401`;
    try {
      const res = await deps.fetch(`${origin}/door/${ch.id}`, {
        method: "POST",
        body: "{}",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      const s = res.status;
      checks.push({
        name,
        ok: s === 401,
        detail:
          s === 401
            ? undefined
            : s >= 300 && s < 400
              ? "a sign-in is in front of the door: Access belongs on /admin alone (Cloudflare → Zero Trust → Access)"
              : s === 503
                ? `the edge is missing a key: pnpm ship door setup --yes, and pnpm ship add ${ch.id} --yes`
                : `it answered ${s}`,
      });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message });
    }
  }
  // The status page, once set up (ADR 0032): behind Access's sign-in.
  if (parseAccess(vars.SHIPIFY_ACCESS)) checks.push(await pageCheck(origin, deps.fetch));
  else
    checks.push({
      name: "the status page",
      ok: true,
      blocking: false,
      detail: "not set up: pnpm ship door page --yes",
    });
  const bad = checks.filter((c) => !c.ok && c.blocking !== false);
  return {
    command: "door check",
    status: bad.length ? "failed" : "succeeded",
    summary: bad.length
      ? `the door: ${bad[0]?.name}: ${bad[0]?.detail ?? "no"}`
      : `the edge at ${origin} works`,
    checks,
  };
}
