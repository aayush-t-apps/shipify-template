// Stack-owned (Shipify; replaced by `ship upgrade`). The Cloudflare side of this app's make targets:
// deploy, preview, unpreview, rollback, pause and resume, `local` (before `make dev` and the
// browser tests), and `bundle` (a PR's Worker and assets for its preview, made with no keys). The Shipify pipeline runs `make <target>` with SHIPIFY_* variables, and passes
// the repository variables CLOUDFLARE_ACCOUNT_ID and CF_WORKERS_SUBDOMAIN as environment variables.
// Worker names come from wrangler.jsonc.
// Storage (KV namespaces, D1 databases, R2 buckets) has no ids in wrangler.jsonc: a deploy finds each by its
// name (a KV namespace is "<worker>-<binding>", a database its database_name) or makes it, applies
// the D1 migrations, then deploys with the ids filled in. An R2 bucket has a name, not an id: a
// deploy makes it when missing and sets its lifecycle rules from r2-lifecycle.json. Nothing is left to wrangler's guessing.
// One address (ADR 0024): the app lives where shipify.json's urls say. A URL on your own domain
// means that name is attached (through Cloudflare's API, after a check that nothing else answers
// there, so a deploy never replaces one) and workers.dev stays off; a workers.dev URL means no
// custom domain and workers.dev on. PR previews stay on workers.dev, only while a PR asks.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const env = process.env;
const manifest = JSON.parse(readFileSync("shipify.json", "utf8"));
const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
const workers = { production: config.name, staging: config.env?.staging?.name };
const secrets = env.SHIPIFY_SECRETS_FILE
  ? JSON.parse(readFileSync(env.SHIPIFY_SECRETS_FILE, "utf8"))
  : {};
const token = env.CLOUDFLARE_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN;
// A PR's bundle, made by its own code with no keys (make bundle, then main's make preview-from,
// ADR 0030 §0): uploaded as it is with this script, its tools and this config. Never for a deploy.
const built = env.SHIPIFY_BUILT;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function need(name, value) {
  if (!value) fail(`${name} is not set.`);
  return value;
}

/** wrangler.jsonc is JSON with comments and trailing commas; strip both outside strings. */
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = i;
      const m = end.exec(text);
      out += m[0];
      i += m[0].length - 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 1;
    } else if (c === "}" || c === "]") {
      out = `${out.replace(/,\s*$/, "")}${c}`;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

/** Only the runtime secrets named in shipify.json travel with the Worker version. */
function runtimeSecretsFile() {
  const picked = {};
  for (const name of manifest.secrets?.runtime ?? []) {
    if (secrets[name] === undefined) console.log(`::warning::runtime secret ${name} has no value`);
    else picked[name] = secrets[name];
  }
  const file = join(mkdtempSync(join(tmpdir(), "shipify-")), "secrets.json");
  writeFileSync(file, JSON.stringify(picked), { mode: 0o600 });
  return file;
}

function wrangler(args, extra = {}) {
  const r = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    stdio: "inherit",
    env: { ...(token ? { ...env, CLOUDFLARE_API_TOKEN: token } : env), ...extra },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** A call to Cloudflare's API under this account. */
async function api(path, init = {}) {
  const account = need("CLOUDFLARE_ACCOUNT_ID", env.CLOUDFLARE_ACCOUNT_ID);
  return request(`/accounts/${account}${path}`, init);
}

async function request(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN", token)}`,
      "content-type": "application/json",
    },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function subdomain() {
  if (env.CF_WORKERS_SUBDOMAIN) return env.CF_WORKERS_SUBDOMAIN;
  const host = manifest.urls?.production ? new URL(manifest.urls.production).hostname : "";
  return need("CF_WORKERS_SUBDOMAIN", host.endsWith(".workers.dev") ? host.split(".")[1] : "");
}

const staging = manifest.staging === true && Boolean(workers.staging);
const envArgs = (onStaging) => (onStaging ? ["--env", "staging"] : []);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Worker's own name: the host of its URL in shipify.json, unless that's on workers.dev. */
function ownHost(worker) {
  const url = worker === workers.staging ? manifest.urls?.staging : manifest.urls?.production;
  const host = url ? new URL(url).hostname.toLowerCase() : "";
  return host && !host.endsWith(".workers.dev") ? host : undefined;
}

/** Every Worker custom domain in the account: { id, hostname, service }. */
const workerDomains = () => listAll("/workers/domains", '"Workers Scripts: Edit"');

/** The zone in this account that holds host: the longest zone name that ends it. */
async function zoneOf(host) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    const { status, body } = await request(`/zones?name=${encodeURIComponent(name)}`);
    if (status !== 200) fail(`Can't list zones (HTTP ${status}).`);
    const zone = (body.result ?? []).find((z) => z.name === name && z.account?.id === account);
    if (zone) return zone;
  }
  fail(
    `No zone in this Cloudflare account holds ${host}. Add the domain, or fix the URL in shipify.json.`,
  );
}

/** Whether public DNS has an address for host already (a record of yours, say). */
async function answersInDns(host) {
  for (const type of ["A", "AAAA"]) {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`;
    const res = await fetch(url, { headers: { accept: "application/dns-json" } }).catch(() => null);
    if (!res?.ok) fail(`Couldn't look ${host} up in DNS, so nothing was attached. Re-run.`);
    if (((await res.json()).Answer ?? []).length) return true;
  }
  return false;
}

/**
 * The Worker's custom domains made to follow its URL: exactly its own name, or none (`want: null`,
 * for a pause).
 * A name it doesn't have yet is checked first: another Worker's, or one that answers in DNS, stops
 * here with nothing changed. `resume` skips the DNS check: its own name, detached by the pause, can
 * still answer from DNS caches for a few minutes.
 */
async function syncDomains(worker, { want = ownHost(worker), checkDns = true } = {}) {
  const all = await workerDomains();
  const mine = all.filter((d) => d.service === worker);
  if (want && !mine.some((d) => d.hostname === want)) {
    const other = all.find((d) => d.hostname === want);
    if (other)
      fail(
        `${want} belongs to the Worker ${other.service}. Nothing was changed: give this app another service name.`,
      );
    if (checkDns && (await answersInDns(want)))
      fail(
        `${want} already answers in DNS (a record in your zone?). Nothing was replaced: remove that record, or give this app another service name.`,
      );
    const zone = await zoneOf(want);
    const { status, body } = await api("/workers/domains", {
      method: "PUT",
      body: JSON.stringify({
        hostname: want,
        service: worker,
        zone_id: zone.id,
        environment: "production",
      }),
    });
    if (status === 401 || status === 403)
      fail(
        `The deploy token can't attach ${want} (HTTP ${status}). Give CF_DEPLOY_TOKEN "Zone → Workers Routes: Edit" for ${zone.name} (docs/setup.md).`,
      );
    if (status !== 200)
      fail(`Couldn't attach ${want}: HTTP ${status} ${JSON.stringify(body.errors ?? [])}`);
    console.log(`${worker}: attached ${want}`);
  }
  for (const d of mine.filter((d) => d.hostname !== want)) {
    const { status } = await api(`/workers/domains/${d.id}`, { method: "DELETE" });
    if (status !== 200) fail(`Couldn't detach ${d.hostname} from ${worker}: HTTP ${status}`);
    console.log(`${worker}: detached ${d.hostname}`);
  }
  return want;
}

/** Wait until host answers over HTTPS (a new name's certificate can take minutes), then say so. */
async function waitLive(host) {
  const until = Date.now() + Number(env.SHIPIFY_DOMAIN_WAIT_MS ?? 10 * 60 * 1000);
  const url = `https://${host}${manifest.health ?? "/"}`;
  for (;;) {
    // Any answer at all means HTTPS works (a sign-in redirect counts).
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) }).catch(
      () => null,
    );
    if (res) break;
    if (Date.now() >= until)
      fail(
        `${host} isn't answering over HTTPS yet (a new name's certificate can take a few minutes). It stays attached: re-run.`,
      );
    await sleep(10_000);
  }
  console.log(`Live at https://${host}`);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Live at https://${host}\n`);
}

/** A Worker's storage bindings, as wrangler.jsonc gives them (top level, or env.staging). */
function storageOf(onStaging) {
  const c = onStaging ? (config.env?.staging ?? {}) : config;
  return { kv: c.kv_namespaces ?? [], d1: c.d1_databases ?? [], r2: c.r2_buckets ?? [] };
}
const keepsData = (onStaging) => {
  const s = storageOf(onStaging);
  return s.kv.length > 0 || s.d1.length > 0 || s.r2.length > 0;
};
/** Wrangler's own name for a binding's resource: "<worker>-<binding>", lower case. */
const resourceName = (worker, binding) => `${worker}-${binding.toLowerCase().replaceAll("_", "-")}`;

/** Every page of a Cloudflare list. */
async function listAll(path, needs = '"Workers KV Storage: Edit" and "D1: Edit"') {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const { status, body } = await api(`${path}${sep}per_page=100&page=${page}`);
    if (status === 403 || status === 401)
      fail(
        `The deploy token can't read ${path.split("?")[0]} (HTTP ${status}). Give CF_DEPLOY_TOKEN ${needs} (docs/setup.md).`,
      );
    if (status !== 200)
      fail(`Cloudflare ${path}: HTTP ${status} ${JSON.stringify(body.errors ?? [])}`);
    out.push(...(body.result ?? []));
    const pages = body.result_info?.total_pages ?? 1;
    if (page >= pages || !(body.result ?? []).length) break;
  }
  return out;
}

/**
 * The config a deploy or preview uses: a copy of wrangler.jsonc beside it (so its paths still
 * resolve) with the Worker's storage found by name or made and every id filled in, and workers.dev
 * off when the Worker has its own name. Returns that file, or nothing when neither applies.
 */
async function deployConfig(onStaging) {
  const { kv, d1 } = storageOf(onStaging);
  const worker = onStaging ? workers.staging : workers.production;
  const own = Boolean(ownHost(worker));
  if (!kv.length && !d1.length && !own && !built) return undefined;
  const filled = structuredClone(config);
  if (built) {
    if (config.main) filled.main = bundledEntry();
    if (filled.assets?.directory) filled.assets.directory = join(built, "assets");
  }
  const target = onStaging ? filled.env.staging : filled;
  if (own) target.workers_dev = false;
  if (kv.length) {
    const have = await listAll("/storage/kv/namespaces");
    target.kv_namespaces = [];
    for (const b of kv) {
      if (b.id) {
        target.kv_namespaces.push(b);
        continue;
      }
      const title = resourceName(worker, b.binding);
      let id = have.find((n) => n.title === title)?.id;
      if (!id) {
        const { status, body } = await api("/storage/kv/namespaces", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        if (status !== 200) fail(`Couldn't make KV namespace ${title}: HTTP ${status}.`);
        id = body.result.id;
        console.log(`Made KV namespace ${title}.`);
      }
      target.kv_namespaces.push({ ...b, id });
    }
  }
  if (d1.length) {
    target.d1_databases = [];
    for (const b of d1) {
      if (b.database_id) {
        target.d1_databases.push(b);
        continue;
      }
      const name = b.database_name ?? resourceName(worker, b.binding);
      const found = (await listAll(`/d1/database?name=${encodeURIComponent(name)}`)).find(
        (d) => d.name === name,
      );
      let id = found?.uuid;
      if (!id) {
        const { status, body } = await api("/d1/database", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        if (status !== 200)
          fail(
            `Couldn't make D1 database ${name}: HTTP ${status} ${JSON.stringify(body.errors ?? [])}. The free plan allows 10 per account.`,
          );
        id = body.result.uuid;
        console.log(`Made D1 database ${name}.`);
      }
      target.d1_databases.push({ ...b, database_name: name, database_id: id });
    }
  }
  const file = ".shipify-wrangler.json";
  writeFileSync(file, `${JSON.stringify(filled, null, 2)}\n`);
  return file;
}

/** r2-lifecycle.json as R2 lifecycle rules: { "tmp/": 7 } is one rule per prefix. Undefined when absent. */
function lifecycleRules() {
  const file = "r2-lifecycle.json";
  if (!existsSync(file)) return undefined;
  let map;
  try {
    map = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(`${file} isn't valid JSON. Nothing was changed.`);
  }
  if (!map || typeof map !== "object" || Array.isArray(map))
    fail(`${file} must be an object of prefix to days, like {"tmp/": 7}. Nothing was changed.`);
  return Object.entries(map).map(([prefix, days]) => {
    if (!prefix || !Number.isInteger(days) || days < 1)
      fail(
        `${file}: "${prefix}" needs a non-empty prefix and whole days of 1 or more. Nothing was changed.`,
      );
    return {
      id: `expire-${prefix}`,
      enabled: true,
      conditions: { prefix },
      // The API counts seconds.
      deleteObjectsTransition: { condition: { type: "Age", maxAge: days * 86400 } },
    };
  });
}

/**
 * Each R2 bucket found by its bucket_name or made, then the app's lifecycle rules set on it. A
 * preview only makes the bucket: a PR's rules wait for its merge, as its migrations do.
 */
async function ensureBuckets(onStaging, { setRules = true } = {}) {
  const buckets = storageOf(onStaging).r2;
  if (!buckets.length) return;
  const rules = setRules ? lifecycleRules() : undefined;
  const needs = '"Workers R2 Storage: Edit"';
  const refused = (what, status) =>
    status === 401 || status === 403
      ? fail(
          `The deploy token can't ${what} (HTTP ${status}). Give CF_DEPLOY_TOKEN ${needs} (docs/setup.md). If R2 isn't turned on for the account, turn it on once in the dashboard (it asks for a card), then re-run.`,
        )
      : undefined;
  const { status: listed, body: listBody } = await api("/r2/buckets?per_page=1000");
  refused("list R2 buckets", listed);
  if (listed !== 200) fail(`Cloudflare R2 buckets: HTTP ${listed}`);
  const have = listBody.result?.buckets ?? listBody.result ?? [];
  for (const b of buckets) {
    const name = b.bucket_name;
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name))
      fail(`R2 bucket name "${name}" must be 3 to 63 lower-case letters, digits or hyphens.`);
    if (!have.some((x) => x.name === name)) {
      const { status, body } = await api("/r2/buckets", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      refused(`make R2 bucket ${name}`, status);
      if (status !== 200)
        fail(
          `Couldn't make R2 bucket ${name}: HTTP ${status} ${JSON.stringify(body.errors ?? [])}`,
        );
      console.log(`Made R2 bucket ${name}.`);
    }
    if (!rules) continue;
    const { status, body } = await api(`/r2/buckets/${name}/lifecycle`, {
      method: "PUT",
      body: JSON.stringify({ rules }),
    });
    refused(`set the lifecycle of ${name}`, status);
    if (status !== 200)
      fail(
        `Couldn't set the lifecycle of ${name}: HTTP ${status} ${JSON.stringify(body.errors ?? [])}`,
      );
    console.log(`${name}: ${rules.length} lifecycle rule(s).`);
  }
}

/** D1 migrations, applied to the Worker's databases (each runs once; wrangler keeps the list). */
function migrate(onStaging, configFile) {
  for (const b of storageOf(onStaging).d1)
    wrangler(
      [
        "d1",
        "migrations",
        "apply",
        b.binding,
        "--remote",
        ...envArgs(onStaging),
        "--config",
        configFile,
      ],
      { CI: "true" },
    );
}

async function deploy() {
  const toStaging = env.SHIPIFY_ENV === "staging";
  if (toStaging && !staging) fail("SHIPIFY_ENV is staging, but this app has no staging Worker.");
  const sha = need("SHIPIFY_SHA", env.SHIPIFY_SHA);
  const version = need("SHIPIFY_VERSION", env.SHIPIFY_VERSION);
  // The Shipify page and `rollback` read these messages: "release v1.2.0 <sha>".
  const message = `${toStaging ? "staging" : "release"} v${version} ${sha}`;
  const worker = toStaging ? workers.staging : workers.production;
  // A Worker that exists gets its name before the new code, so a failed attach changes nothing.
  const exists = (await api(`/workers/scripts/${worker}/subdomain`)).status === 200;
  if (exists) await syncDomains(worker);
  // Its storage first, then its migrations (they only add, so the running code is fine with them),
  // then the code that needs them.
  await ensureBuckets(toStaging);
  const configFile = await deployConfig(toStaging);
  try {
    if (configFile) migrate(toStaging, configFile);
    wrangler([
      "deploy",
      ...envArgs(toStaging),
      ...(configFile ? ["--config", configFile] : []),
      "--var",
      `GIT_SHA:${sha}`,
      "--message",
      message,
      "--secrets-file",
      runtimeSecretsFile(),
    ]);
  } finally {
    if (configFile) rmSync(configFile, { force: true });
  }
  // A brand-new Worker gets its name right after its first upload.
  const host = exists ? ownHost(worker) : await syncDomains(worker);
  if (host) await waitLive(host);
}

/**
 * A PR's bundle for its preview (make bundle, ADR 0030 §0), in $SHIPIFY_BUNDLE: the Worker as
 * wrangler would upload it (worker/), and its built assets (assets/). The PR's own code makes it,
 * with no keys; main's `make preview-from` uploads exactly that, so nothing of the PR's runs where
 * the deploy key is.
 */
function bundle() {
  const out = need("SHIPIFY_BUNDLE", env.SHIPIFY_BUNDLE);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  if (config.main) {
    // Bundling needs no storage ids and no keys: a copy without storage, beside wrangler.jsonc.
    const bare = structuredClone(config);
    for (const c of [bare, bare.env?.staging].filter(Boolean)) {
      delete c.kv_namespaces;
      delete c.d1_databases;
    }
    const file = ".shipify-wrangler.json";
    writeFileSync(file, `${JSON.stringify(bare, null, 2)}\n`);
    try {
      wrangler(["deploy", "--dry-run", "--outdir", join(out, "worker"), "--config", file]);
    } finally {
      rmSync(file, { force: true });
    }
  }
  if (config.assets?.directory)
    cpSync(config.assets.directory, join(out, "assets"), { recursive: true });
  console.log(`Bundled for a preview in ${out}.`);
}

/** The Worker's file in a PR's bundle: its entry's name as .js (wrangler's), else the only one. */
function bundledEntry() {
  const dir = join(built, "worker");
  const js = readdirSync(dir).filter((f) => f.endsWith(".js"));
  const named = basename(config.main).replace(/\.[cm]?[jt]sx?$/, ".js");
  const entry = js.includes(named) ? named : js.length === 1 ? js[0] : undefined;
  if (!entry) fail(`The PR's bundle has no single Worker file in ${dir}.`);
  return join(dir, entry);
}

async function preview() {
  const pr = need("SHIPIFY_PR", env.SHIPIFY_PR);
  const sha = need("SHIPIFY_SHA", env.SHIPIFY_SHA);
  // PR code runs on the staging Worker when there is one, so it never touches production.
  const worker = staging ? workers.staging : workers.production;
  // A preview is a version of its Worker, with that Worker's data: without staging, production's.
  if (!staging && keepsData(false)) {
    console.log(
      "No preview: this app keeps data (KV, D1 or R2) and has no staging, so a preview would use production's. Turn staging on for previews: pnpm ship staging <id> on.",
    );
    return;
  }
  const { status } = await api(`/workers/scripts/${worker}/subdomain`);
  if (status !== 200) {
    console.log(`No preview: ${worker} isn't deployed yet. Merging deploys it.`);
    return;
  }
  // Staging's own storage; a PR's new migrations wait for its merge (staging's data is shared).
  await ensureBuckets(staging, { setRules: false });
  const configFile = await deployConfig(staging);
  try {
    wrangler([
      "versions",
      "upload",
      ...envArgs(staging),
      ...(configFile ? ["--config", configFile] : []),
      // A PR's bundle is uploaded as wrangler bundled it in the PR's job.
      ...(built ? ["--no-bundle"] : []),
      "--preview-alias",
      `pr-${pr}`,
      "--var",
      `GIT_SHA:${sha}`,
      "--message",
      `preview PR ${pr}`,
      "--secrets-file",
      runtimeSecretsFile(),
    ]);
  } finally {
    if (configFile) rmSync(configFile, { force: true });
  }
  // Previews are off unless asked for (wrangler.jsonc): turn them on for this one.
  await setPreviews(true);
  console.log(`url=https://pr-${pr}-${worker}.${subdomain()}.workers.dev`);
}

/** The preview Worker's preview URLs on or off, leaving its own URL as it is. */
async function setPreviews(on) {
  const worker = staging ? workers.staging : workers.production;
  const current = await api(`/workers/scripts/${worker}/subdomain`);
  if (current.status !== 200)
    return console.log(`${worker} isn't deployed: no previews to turn ${on ? "on" : "off"}.`);
  const { status } = await api(`/workers/scripts/${worker}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: current.body?.result?.enabled ?? true, previews_enabled: on }),
  });
  if (status !== 200) fail(`${worker}: HTTP ${status}`);
  console.log(`${worker}: previews ${on ? "on" : "off"}`);
}

async function rollback() {
  const to = env.SHIPIFY_TO ?? "";
  if (to && !/^v\d+\.\d+\.\d+$/.test(to)) fail("SHIPIFY_TO must look like v1.2.3.");
  const args = ["rollback"];
  if (to) {
    const { status, body } = await api(`/workers/scripts/${workers.production}/versions`);
    if (status !== 200) fail(`Can't list the versions of ${workers.production} (HTTP ${status}).`);
    const hit = (body.result?.items ?? []).find((v) =>
      v.annotations?.["workers/message"]?.startsWith(`release ${to} `),
    );
    if (!hit) fail(`No production version was deployed as ${to} (Cloudflare keeps the last 100).`);
    args.push(hit.id);
  }
  const by = env.GITHUB_ACTOR ?? "shipify";
  wrangler([...args, "--yes", "--message", `rollback to ${to || "the previous version"} by ${by}`]);
}

async function setUrls(enabled) {
  for (const worker of [workers.production, workers.staging].filter(Boolean)) {
    // With its own name, workers.dev stays off: the name is its one address.
    const on = enabled && !ownHost(worker);
    const { status } = await api(`/workers/scripts/${worker}/subdomain`, {
      method: "POST",
      // Previews stay off either way: a PR that asks for one turns them on.
      body: JSON.stringify({ enabled: on, previews_enabled: false }),
    });
    if (status !== 200) fail(`${worker}: HTTP ${status}`);
    console.log(`${worker}: workers.dev URL ${on ? "on" : "off"}`);
    // Its own domain goes off and comes back with it.
    const host = await syncDomains(worker, enabled ? { checkDns: false } : { want: null });
    if (host) await waitLive(host);
  }
}

/**
 * Before `make dev` and the browser tests: the D1 migrations on this checkout's local databases
 * (.wrangler/state, the ones `wrangler dev` uses). Nothing for an app without D1.
 */
function local() {
  if (!existsSync("migrations")) return;
  for (const b of storageOf(false).d1)
    wrangler(["d1", "migrations", "apply", b.binding, "--local"], { CI: "true" });
}

const commands = {
  deploy,
  preview,
  bundle,
  local,
  rollback,
  unpreview: () => setPreviews(false),
  pause: () => setUrls(false),
  resume: () => setUrls(true),
};
const command = commands[process.argv[2]];
if (!command) fail(`usage: cloudflare.mjs ${Object.keys(commands).join("|")}`);
await command();
