// The bot (ADR 0012): a GitHub App that opens every task's PRs with a token that lasts one hour,
// on Shipify's own account. The repos App (ADR 0045): a second, small, public App that another of
// your accounts installs, so Shipify reads its repos and opens PRs there, and nothing more. Each is
// registered from a manifest, which takes two clicks in the browser: create the app, then install
// it. Its private key goes straight into the platform repo's secrets and is never printed or
// written to disk. `ship bot repos <account>` adds an account to yours (SHIPIFY_ACCOUNTS): an
// install alone gives access, and only this list makes the account yours.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { LOGIN } from "../contracts/accounts.ts";
import { accountList, accountsValue, platformAccount, yourAccounts } from "../lib/accounts.ts";
import { has, run } from "../lib/exec.ts";
import { gh, ghRun, platformRepo, settingsHome } from "../lib/github.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";

/** What the bot may do. "Variables" has no manifest key: it's ticked by hand afterwards. */
export const BOT_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  issues: "write",
  actions: "read",
  statuses: "read",
  checks: "read",
  metadata: "read",
  administration: "write",
  secrets: "write",
  workflows: "write",
} as const;

/**
 * What the repos App may do (ADR 0045), on the repos an account installs it on: write code and PRs;
 * read their issues, CI and checks. No administration, secrets, workflows or organization
 * permission, so a repo's own admin can install it, and GitHub refuses its push of a workflow file.
 */
export const REPOS_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  issues: "read",
  actions: "read",
  checks: "read",
  statuses: "read",
  metadata: "read",
} as const;

/** The two Apps: the bot (Shipify's own account) and the repos App (your other accounts). */
export type AppKind = "bot" | "repos";

const APPS = {
  bot: {
    who: "the bot",
    suffix: "shipify",
    description: "Shipify tasks: opens PRs for the owner to review and merge.",
    public: false,
    permissions: BOT_PERMISSIONS,
    key: "SHIPIFY_BOT_KEY",
    id: "SHIPIFY_BOT_CLIENT_ID",
    slug: "SHIPIFY_BOT_SLUG",
  },
  repos: {
    who: "the repos App",
    suffix: "shipify-repos",
    description:
      "Shipify on your other accounts: reads code and opens PRs that a person merges, on the repos you pick.",
    public: true,
    permissions: REPOS_PERMISSIONS,
    key: "SHIPIFY_REPOS_KEY",
    id: "SHIPIFY_REPOS_CLIENT_ID",
    slug: "SHIPIFY_REPOS_SLUG",
  },
} as const;

export function botManifest(org: string, redirect: string, kind: AppKind = "bot") {
  const app = APPS[kind];
  return {
    // GitHub takes 34 characters: a long org's name is cut, never the App's own part, so the two
    // Apps' names never meet.
    name: `${org.slice(0, 34 - app.suffix.length - 1)}-${app.suffix}`,
    url: `https://github.com/${org}/shipify`,
    description: app.description,
    hook_attributes: { url: `https://github.com/${org}/shipify`, active: false },
    redirect_url: redirect,
    public: app.public,
    default_permissions: app.permissions,
    default_events: [],
  };
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Open a page in your browser, when this PC can: whether it did. */
export function openBrowser(url: string) {
  for (const [cmd, args] of [
    ["wslview", [url]],
    ["xdg-open", [url]],
    ["cmd.exe", ["/c", "start", "", url]],
  ] as const)
    if (has(cmd) && run(cmd, [...args]).code === 0) return true;
  return false;
}

interface NewApp {
  id: number;
  slug: string;
  client_id: string;
  pem: string;
}

/**
 * GitHub's manifest handshake: the one-time code on the page GitHub sends back (valid about an
 * hour, and once) for the new app's credentials. Sent without a token: GitHub answered a
 * fine-grained token's call with 404.
 */
export async function exchangeCode(
  code: string,
  post: typeof fetch = fetch,
  /** The command that makes the app again, for a code that's gone. */
  again = "pnpm ship bot --yes",
): Promise<NewApp> {
  if (!/^[0-9a-f]{20,64}$/i.test(code))
    throw new ShipError(
      "That isn't a code from GitHub: it's the part after code= in the page's address.",
      "blocked",
    );
  const res = await post(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "shipify",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok)
    throw new ShipError(
      res.status === 404
        ? `GitHub doesn't know that code (it works once, for about an hour). Delete the half-made app in the org's settings → GitHub Apps, then run: ${again}`
        : `GitHub refused the code (HTTP ${res.status}).`,
      "blocked",
    );
  return (await res.json()) as NewApp;
}

/** The key into the platform repo's secrets (never printed), the id and name into its variables. */
function storeApp(repo: string, app: NewApp, kind: AppKind) {
  const names = APPS[kind];
  const secret = ghRun(["secret", "set", names.key, "--repo", repo], {
    input: app.pem,
  });
  if (secret.code !== 0) throw new Error(`storing the key failed: ${secret.stderr.trim()}`);
  gh(["variable", "set", names.id, "--repo", repo, "--body", app.client_id]);
  gh(["variable", "set", names.slug, "--repo", repo, "--body", app.slug]);
}

const nextSteps = (org: string, slug: string, kind: AppKind) =>
  kind === "repos"
    ? [
        "add each of your other accounts, and install the App there: pnpm ship bot repos <account>",
        "then: pnpm ship box list (shows the repos App and your accounts)",
      ]
    : [
        `install it on all repositories: https://github.com/apps/${slug}/installations/new`,
        `tick Variables: Read and write: ${settingsHome(org)}/apps/${slug}/permissions`,
        "then: pnpm ship box list (shows the bot as ready)",
      ];

/** The platform repo's variables, by name; refused with the fix when GitHub won't list them. */
function repoVariables(repo: string): Record<string, string> {
  const vars = ghRun([
    "api",
    `repos/${repo}/actions/variables?per_page=30`,
    "--paginate",
    "--jq",
    ".variables[] | [.name, .value] | @tsv",
  ]);
  if (vars.code !== 0)
    throw new ShipError(
      `GitHub wouldn't list ${repo}'s variables: check this PC's login (gh auth status), which needs Variables on it.`,
      "blocked",
    );
  return Object.fromEntries(
    vars.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t") as [string, string]),
  );
}

/**
 * `ship bot` (the bot) and `ship bot repos` (the repos App): register the App from its manifest,
 * two clicks in the browser, or finish one GitHub made with its one-time code.
 */
export async function botSetup(
  yes: boolean,
  code?: string,
  kind: AppKind = "bot",
): Promise<Result> {
  const repo = platformRepo();
  const org = repo.split("/")[0] as string;
  const names = APPS[kind];
  const command = kind === "repos" ? "bot repos" : "bot";
  const set = repoVariables(repo);
  if (set[names.id] && set[names.slug])
    return {
      command,
      status: "skipped",
      summary: `${names.who} ${set[names.slug]} is set up`,
      nextSteps:
        kind === "repos"
          ? [
              `your accounts: ${yourAccounts({ SHIPIFY_ACCOUNTS: set.SHIPIFY_ACCOUNTS ?? "" }).join(", ") || "none yet"}`,
              "add one, and install the App there: pnpm ship bot repos <account>",
            ]
          : [
              `installed on all repositories? https://github.com/apps/${set[names.slug]}/installations/new`,
              `settings: ${settingsHome(org)}/apps/${set[names.slug]}/permissions`,
            ],
    };
  // The app was created, but finishing it here failed: finish it with the code from that page.
  if (code) {
    if (!yes)
      return {
        command,
        status: "requires-approval",
        summary: `would finish ${names.who} GitHub created, with its one-time code`,
        plannedActions: [
          "exchange the code with GitHub for the new app's key (never printed)",
          `store the key as ${names.key}, and its id and name as variables, in ${repo}`,
        ],
        nextSteps: [`pnpm ship ${command} --code <code> --yes`],
      };
    const app = await exchangeCode(code, fetch, `pnpm ship ${command} --yes`);
    storeApp(repo, app, kind);
    return ok(command, `finished ${names.who} ${app.slug}`, {
      nextSteps: nextSteps(org, app.slug, kind),
    });
  }
  const planned =
    kind === "repos"
      ? [
          "open a page on this machine that sends GitHub the repos App's manifest",
          `you click "Create GitHub App" for ${org} (a public app named ${botManifest(org, "", kind).name}: anyone can install it, and only the accounts you add count as yours)`,
          `its permissions: ${Object.entries(REPOS_PERMISSIONS)
            .map(([k, v]) => `${k.replace("_", " ")} ${v}`)
            .join(", ")}; no administration, secrets, workflows or webhook`,
          `store its private key as the secret ${names.key} in ${repo} (never printed)`,
          `store its client id and name as the variables ${names.id} and ${names.slug}`,
          "then you add your other accounts, one at a time: pnpm ship bot repos <account>",
        ]
      : [
          "open a page on this machine that sends GitHub the bot's manifest",
          `you click "Create GitHub App" for ${org} (a private app named ${botManifest(org, "").name})`,
          `store its private key as the secret ${names.key} in ${repo} (never printed)`,
          `store its client id and name as the variables ${names.id} and ${names.slug}`,
          "then you install it on all the org's repositories, and tick Variables: Read and write",
        ];
  if (!yes)
    return {
      command,
      status: "requires-approval",
      summary:
        kind === "repos"
          ? "would register the repos App, for your other accounts (two clicks in your browser)"
          : "would register the Shipify bot (two clicks in your browser)",
      plannedActions: planned,
      nextSteps: [`pnpm ship ${command} --yes`],
    };

  const state = randomBytes(12).toString("hex");
  const done = new Promise<{ slug: string; id: number }>((resolve, reject) => {
    let finished = false;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      // A browser can ask again after the setup ended (a reload, a prefetch).
      const address = server.address() as { port: number } | null;
      if (finished || !address) {
        res.writeHead(410).end("This setup has finished: see the terminal.");
        return;
      }
      const port = address.port;
      if (url.pathname === "/") {
        const manifest = JSON.stringify(botManifest(org, `http://localhost:${port}/done`, kind));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Shipify ${kind === "repos" ? "repos App" : "bot"}</title>
<body style="font:16px system-ui;max-width:36rem;margin:3rem auto">
<h1>Create the Shipify ${kind === "repos" ? "repos App" : "bot"}</h1><p>GitHub opens next. Check the name and click <b>Create GitHub App</b>.</p>
<form id="f" method="post" action="${html(settingsHome(org))}/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${html(manifest)}"><button>Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script>`);
        return;
      }
      if (url.pathname === "/done") {
        const code = url.searchParams.get("code");
        if (url.searchParams.get("state") !== state || !code) {
          res.writeHead(400).end("This link isn't from this setup.");
          return;
        }
        finished = true;
        try {
          const app = await exchangeCode(code, fetch, `pnpm ship ${command} --yes`);
          storeApp(repo, app, kind);
          const install = `https://github.com/apps/${app.slug}/installations/new`;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            kind === "repos"
              ? `<!doctype html><meta charset="utf-8"><title>Shipify repos App</title>
<body style="font:16px system-ui;max-width:36rem;margin:3rem auto"><h1>${html(app.slug)} is created</h1>
<p>Next, in your terminal, add each of your other accounts: <code>pnpm ship bot repos &lt;account&gt;</code>. It opens the page that installs the App there.</p><p>You can close this tab.</p>`
              : `<!doctype html><meta charset="utf-8"><title>Shipify bot</title>
<body style="font:16px system-ui;max-width:36rem;margin:3rem auto"><h1>${html(app.slug)} is created</h1>
<p>Two last steps on GitHub:</p><ol>
<li><a href="${install}">Install it</a> on <b>${html(org)}</b>, with <b>All repositories</b>.</li>
<li>In its <a href="${html(settingsHome(org))}/apps/${html(app.slug)}/permissions">permissions</a>, set <b>Variables</b> to <b>Read and write</b>, then save (and accept the change on the install).</li>
</ol><p>You can close this tab.</p>`,
          );
          server.close();
          resolve({ slug: app.slug, id: app.id });
        } catch (e) {
          res
            .writeHead(500)
            .end(
              `Setup failed: ${(e as Error).message}\n\nThe app may exist on GitHub already: finish it with pnpm ship ${command} --code <the code in this page's address> --yes`,
            );
          server.close();
          reject(e);
        }
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const url = `http://localhost:${port}/`;
      process.stderr.write(
        `  … ${openBrowser(url) ? "opened" : "open"} ${url} in your browser, and create the app on GitHub.\n`,
      );
    });
    setTimeout(() => {
      server.close();
      reject(
        new ShipError("Timed out after 15 minutes. Run it again when you're ready.", "blocked"),
      );
    }, 15 * 60_000).unref();
  });
  const app = await done;
  return ok(command, `created ${names.who} ${app.slug}`, {
    nextSteps: nextSteps(org, app.slug, kind),
  });
}

/**
 * `ship bot repos <account>` (ADR 0045): an account of yours, added to SHIPIFY_ACCOUNTS, and the
 * page that installs the repos App there, with the account chosen. `--remove` takes it off the list
 * (the App's install there is GitHub's to remove, where it says). Shows its plan, then `--yes`.
 */
export async function reposAccount(name: string, yes: boolean, remove = false): Promise<Result> {
  const account = name.toLowerCase();
  if (!LOGIN.test(account))
    throw new ShipError(`"${name}" isn't a GitHub account's name.`, "blocked");
  if (account === platformAccount())
    throw new ShipError(
      `${account} is Shipify's own account: the bot works there already.`,
      "blocked",
    );
  const repo = platformRepo();
  const set = repoVariables(repo);
  const list = accountList({ SHIPIFY_ACCOUNTS: set.SHIPIFY_ACCOUNTS ?? "" });
  const listed = list.map((a) => a.login);
  const slug = set.SHIPIFY_REPOS_SLUG;
  const command = `bot repos ${account}${remove ? " --remove" : ""}`;
  if (remove) {
    const after = list.filter((a) => a.login !== account);
    const uninstall = `uninstall the App there yourself, if you want it gone: ${account}'s Settings → GitHub Apps (https://github.com/settings/installations for your own account)`;
    if (!listed.includes(account))
      return {
        command,
        status: "skipped",
        summary: `${account} isn't one of your accounts`,
        nextSteps: [uninstall],
      };
    const planned = [
      after.length
        ? `set SHIPIFY_ACCOUNTS in ${repo} to ${accountsValue(after)}`
        : `delete SHIPIFY_ACCOUNTS in ${repo}: no account is left on it`,
      `from then on, a task on ${account} only reads its public repos, as anyone else's`,
    ];
    if (!yes)
      return {
        command,
        status: "requires-approval",
        summary: `would take ${account} off your accounts`,
        plannedActions: planned,
        nextSteps: [`pnpm ship ${command} --yes`],
      };
    if (after.length)
      gh(["variable", "set", "SHIPIFY_ACCOUNTS", "--repo", repo, "--body", accountsValue(after)]);
    else gh(["variable", "delete", "SHIPIFY_ACCOUNTS", "--repo", repo]);
    return ok("bot repos", `${account} is no longer one of your accounts`, {
      nextSteps: [uninstall],
    });
  }
  if (!slug)
    throw new ShipError(
      "Set up the repos App first: pnpm ship bot repos, read its plan, then pnpm ship bot repos --yes.",
      "blocked",
    );
  // The account as GitHub knows it: its id picks it on the install page.
  const who = ghRun(["api", `users/${account}`, "--jq", "[.id, .type] | @tsv"]);
  const [id, type] = who.stdout.trim().split("\t");
  if (who.code !== 0 || !id || !/^\d+$/.test(id))
    throw new ShipError(`GitHub has no account named ${account}.`, "blocked");
  const install = `https://github.com/apps/${slug}/installations/new/permissions?target_id=${id}`;
  // Pinned by GitHub's id: a login given up and taken again by someone else is another account.
  const after = [...list.filter((a) => a.login !== account), { login: account, id: Number(id) }];
  const known = list.find((a) => a.login === account);
  const how =
    type === "Organization"
      ? [
          `on GitHub, pick the repos and click Install: an owner of ${account} can install it on any of its repos, and a repo's admin on the repos they admin; anyone else clicks Request, and an owner approves`,
        ]
      : ["on GitHub, pick the repos and click Install"];
  const planned = [
    known?.id === Number(id)
      ? `${account} is one of your accounts already: SHIPIFY_ACCOUNTS stays ${accountsValue(list)}`
      : `set SHIPIFY_ACCOUNTS in ${repo} to ${accountsValue(after)} (${account} by its id on GitHub, ${id})`,
    `open the page that installs ${slug} on ${account}: ${install}`,
    ...how,
    `then ask for a change there: ${account}/<repo>: … (its first task says if the App can't reach it, with the fix)`,
  ];
  if (!yes)
    return {
      command,
      status: "requires-approval",
      summary: `would add ${account} to your accounts and install the repos App there`,
      plannedActions: planned,
      nextSteps: [`pnpm ship ${command} --yes`],
    };
  if (known?.id !== Number(id))
    gh(["variable", "set", "SHIPIFY_ACCOUNTS", "--repo", repo, "--body", accountsValue(after)]);
  const opened = openBrowser(install);
  return ok("bot repos", `${account} is one of your accounts`, {
    nextSteps: [
      `${opened ? "opened" : "open"} ${install}`,
      ...how,
      `then: ${account}/<repo>: … from any chat, or look at ${account}/<repo> …`,
    ],
  });
}
