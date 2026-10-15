// The web chat's setup steps (ADR 0036, "Setup"), each one `ship add webchat` runs in turn, each
// checking itself first so a second run picks up where the first stopped. The chat lives on the
// edge at /admin/chat/, behind the Cloudflare Access application for
// /admin, the status page's too (SHIPIFY_ACCESS, from `ship door page`), and has no keys of its
// own: the door lets in only a person in SHIPIFY_PEOPLE with an id on the channel, so you get `"web": "me"`. Files sent
// from it are kept in Workers KV, bound to the Worker as FILES by the deploy; this PC only reads
// the Worker's bindings, with the deploy token from your credentials file. Its notifications
// (ADR 0050) are signed with a key made here and put on the Worker (WEB_PUSH_KEY), and go to your
// default channels' alerts too when you have none. Nothing here prints a key.
//   tsx tools/web/setup.ts page|signin|you|files|notify|open|--check|--remove
import { openBrowser } from "../../cli/commands/bot.ts";
import { credential, loadCredentials } from "../../cli/lib/credentials.ts";
import { ghRun, platformRepo } from "../../cli/lib/github.ts";
import { fetchAgain } from "../../cli/lib/net.ts";
import { type Person, readPeople } from "../../cli/lib/people.ts";
import { sourceControl } from "../../cli/lib/providers.ts";
import {
  cloudflareMissing,
  deleteEdgeSecret,
  edgeOrigin,
  edgeSecretNames,
  putEdgeSecret,
} from "../../edge/setup/worker.ts";
import { parseAccess } from "../../edge/src/access.ts";
import {
  chatUrl,
  filesVerdict,
  newPushKey,
  PUSH_KEY,
  sendWithoutWeb,
  sendWithWeb,
  signinVerdict,
  withoutWeb,
  withWeb,
} from "./web.ts";

/** Cloudflare's API (a test's own, with CLOUDFLARE_API_URL). */
const CF_API = process.env.CLOUDFLARE_API_URL ?? "https://api.cloudflare.com/client/v4";
/** The edge's Worker, as edge/wrangler.jsonc names it. */
const WORKER = "shipify";

const say = (line: string) => process.stdout.write(`${line}\n`);
/** Words for you, as a step goes: `ship add` shows only a step's last line on stdout. */
const tell = (line: string) => process.stderr.write(`${line}\n`);
/** Why a step stopped: its last line, which `ship add` shows with the fix. */
const fail = (why: string): never => {
  process.stdout.write(`${why}\n`);
  process.exit(1);
};

/** shipify's variables, read once. */
let vars: Record<string, string> | undefined;
const repoVars = () => {
  vars ??= sourceControl().repoState(platformRepo()).variables;
  return vars;
};

/** The edge's origin, from shipify's variables (door setup sets it). */
const origin = () =>
  edgeOrigin(repoVars()) ?? fail("The edge's address is unknown: pnpm ship door setup --yes first");

/** The people, from the shipify repo's variable (unset: you, from SHIPIFY_OWNER). */
function people(): Person[] {
  const r = readPeople(repoVars().SHIPIFY_PEOPLE, process.env.SHIPIFY_OWNER ?? whoAmI());
  // Written back from a value that didn't read, it would drop everyone else: say so instead.
  if (r.broken && repoVars().SHIPIFY_PEOPLE?.trim())
    fail(`${r.broken}: fix shipify's SHIPIFY_PEOPLE variable, then run it again`);
  return r.people;
}
const whoAmI = () => ghRun(["api", "user", "--jq", ".login"]).stdout.trim() || undefined;

const setPeople = (list: Person[]) =>
  sourceControl().setVariable(platformRepo(), "SHIPIFY_PEOPLE", JSON.stringify(list));

/** Your default channels (SHIPIFY_SEND), as a list. */
const sendList = () => (repoVars().SHIPIFY_SEND ?? "").split(/[\s,]+/).filter(Boolean);
/** SHIPIFY_SEND set to these, or gone when there are none: GitHub keeps no empty variable. */
function setSend(list: string[]) {
  const sc = sourceControl();
  if (list.length) sc.setVariable(platformRepo(), "SHIPIFY_SEND", list.join(","));
  else sc.deleteVariable(platformRepo(), "SHIPIFY_SEND");
}

// ---------------------------------------------------------------- the steps

/** The status page is set up: SHIPIFY_ACCESS names its Access application. */
function page(): string {
  const access = parseAccess(repoVars().SHIPIFY_ACCESS);
  if (!access)
    fail("The status page isn't set up (no SHIPIFY_ACCESS): run pnpm ship door page --yes first");
  return `the status page is set up (${access?.team})`;
}

/** A stranger at /admin/chat/ is sent to Access's sign-in, as at /admin/status. */
async function signin(): Promise<string> {
  const url = chatUrl(origin());
  const res = await fetchAgain(url, { redirect: "manual" }).catch((e: Error) =>
    fail(`${url} didn't answer (${e.message}): check this machine's network, then run it again`),
  );
  const v = signinVerdict(url, res.status, res.headers.get("location"));
  if (!v.ok) {
    for (const [i, s] of (v.edit ?? []).entries()) tell(`  ${i + 1}. ${s}`);
    fail(v.line);
  }
  return v.line;
}

/** You may write from the chat: `"web": "me"` on your entry in SHIPIFY_PEOPLE. */
function you(): string {
  const now = people();
  const next = withWeb(now);
  if (next) setPeople(next);
  return `${now[0]?.name}'s words come in from the chat`;
}

/**
 * The deployed edge keeps the chat's files: a Workers KV namespace bound as FILES. Unbound, it's a
 * note, not a failure: words work, and the next deploy makes the store. Only a token Cloudflare
 * refuses (or no answer at all) stops it.
 */
async function files(): Promise<string> {
  const missing = cloudflareMissing();
  if (missing) fail(missing);
  const values = loadCredentials().values;
  const account = credential(values, "CLOUDFLARE_ACCOUNT_ID") ?? "";
  const res = await fetchAgain(`${CF_API}/accounts/${account}/workers/scripts/${WORKER}/settings`, {
    headers: { authorization: `Bearer ${credential(values, "CF_DEPLOY_TOKEN") ?? ""}` },
  }).catch((e: Error) =>
    fail(
      `Cloudflare didn't answer (${e.message}): check this machine's network, then run it again`,
    ),
  );
  const v = filesVerdict(res.status, await res.json().catch(() => ({})));
  if (v.kind === "refused" || v.kind === "other") fail(v.line);
  return v.line;
}

/** The Worker's secrets' names, or the step stops with why. */
function held(): string[] {
  const missing = cloudflareMissing();
  if (missing) fail(missing);
  const names = edgeSecretNames();
  if (!names.ok) fail(`Couldn't read the edge's secrets: ${names.why}`);
  return names.ok ? names.names : [];
}

/**
 * Notifications (ADR 0050): their key, made here and put on the Worker from stdin, never printed or
 * kept anywhere else. Kept on a second run; `--new` makes a new one, and each device subscribes
 * again when it next opens the chat. With no default channels, `web` becomes yours, so alerts,
 * repeats and recipes notify you here too; with some, they stay as they are.
 */
function notify(): string {
  const renew = process.env.SHIPIFY_RENEW === "1";
  const had = held().includes(PUSH_KEY);
  if (!had || renew) {
    const put = putEdgeSecret(PUSH_KEY, newPushKey());
    if (!put.ok) fail(`Couldn't put the notifications' key on the edge: ${put.why}`);
  }
  const send = sendList();
  const next = sendWithWeb(send);
  if (next) setSend(next);
  else if (!send.includes("web"))
    tell(
      `  Alerts, repeats and recipes go to ${send.join(", ")} (SHIPIFY_SEND), not here. To switch, take them off it (for Telegram: pnpm ship remove telegram --yes), then run this again.`,
    );
  const key = had && !renew ? "the edge has the key already" : "the edge has a new key";
  return `notifications are on (${key}): in the chat, Setup → Notifications on this device, on each phone or PC`;
}

/** The chat's address, opened here when this terminal is yours. */
function open(): string {
  const url = chatUrl(origin());
  // `ship add` reads a step's stdout, so the terminal is stderr's.
  const opened = process.stderr.isTTY && !process.env.CI && openBrowser(url);
  tell(
    `${opened ? "Opened" : "Open"} ${url}: send /ping to check it end to end, and on your phone install it (Chrome: ⋮ → Install app).`,
  );
  return `the chat is at ${url}: send /ping to check it end to end, and on your phone install it (Chrome: ⋮ → Install app)`;
}

/**
 * Whether it works, from your PC: the status page, its sign-in over the chat, the file store, and
 * whether notifications have their key.
 */
async function check() {
  say(page());
  say(await signin());
  say(await files());
  say(
    held().includes(PUSH_KEY)
      ? "notifications have their key (WEB_PUSH_KEY)"
      : "notifications are off: pnpm ship add webchat --yes turns them on",
  );
}

/**
 * Undone: no one writes from the chat, it's off your default channels, and its notifications'
 * key is off the edge (when this PC holds Cloudflare's token). Its files in KV expire by themselves.
 */
function remove() {
  const next = withoutWeb(people());
  if (next) setPeople(next);
  const send = sendWithoutWeb(sendList());
  if (send) setSend(send);
  const gone = cloudflareMissing() ? undefined : deleteEdgeSecret(PUSH_KEY);
  if (gone && !gone.ok) fail(`Couldn't take the notifications' key off the edge: ${gone.why}`);
  say(
    `no one's words come in from the chat now${gone ? ", its notifications' key is off the edge" : ""}; its files in Cloudflare expire by themselves`,
  );
}

const steps: Record<string, () => Promise<unknown> | unknown> = {
  page: () => say(page()),
  signin: async () => say(await signin()),
  you: () => say(you()),
  files: async () => say(await files()),
  notify: () => say(notify()),
  open: () => say(open()),
  "--check": check,
  "--remove": remove,
};
const step = steps[process.argv[2] ?? ""];
if (!step) fail(`usage: setup.ts ${Object.keys(steps).join("|")}`);
await (step as () => Promise<unknown>)();
