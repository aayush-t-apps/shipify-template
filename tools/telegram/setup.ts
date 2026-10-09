// Telegram's setup steps (ADR 0031, "Setup"; ADR 0042), each one `ship add telegram` runs in turn,
// each checking itself first so a second run picks up where the first stopped. The bot's token comes in
// as TELEGRAM_TOKEN (`ship add` took it at a hidden prompt and put it on the edge's Worker;
// SHIPIFY_KEYS_SET names it when that was this run; SHIPIFY_RENEW is --new). Telegram's secret is
// made here and put on the Worker too: the edge's keys live only there and in your credentials
// file. Nothing here prints a key; Telegram's answers never carry one.
//   tsx tools/telegram/setup.ts token|edge|webhook|menu|link|test|--check|--remove
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { chatMenu } from "../../cli/contracts/answers.ts";
import { PLATFORM_ROOT } from "../../cli/lib/config.ts";
import {
  credential,
  forgetCredential,
  loadCredentials,
  setCredential,
} from "../../cli/lib/credentials.ts";
import { ghRun, platformRepo } from "../../cli/lib/github.ts";
import { fetchAgain } from "../../cli/lib/net.ts";
import { type Person, readPeople, withId } from "../../cli/lib/people.ts";
import { sourceControl } from "../../cli/lib/providers.ts";
import {
  deleteEdgeSecret,
  EDGE_APP,
  edgeOrigin,
  edgeSecretNames,
  putEdgeSecret,
} from "../../edge/setup/worker.ts";

const API = process.env.TELEGRAM_API ?? "https://api.telegram.org";
const say = (line: string) => process.stdout.write(`${line}\n`);
/** Why a step stopped: its last line, which `ship add` shows with the fix. */
const fail = (why: string): never => {
  process.stdout.write(`${why}\n`);
  process.exit(1);
};

const values = () => loadCredentials().values;
const renewing = () => process.env.SHIPIFY_RENEW === "1";
/** The bot's token, where there is one: your PC's credentials file, never a box. */
const tokenHere = () => process.env.TELEGRAM_TOKEN || credential(values(), "TELEGRAM_TOKEN");
const token = () =>
  tokenHere() ??
  fail("No TELEGRAM_TOKEN: run pnpm ship add telegram --yes, and paste the bot's token");

/** Shipify's logo, the bot's photo: Telegram takes only a JPG. */
const LOGO = join(PLATFORM_ROOT, "docs", "assets", "logo.jpg");

/**
 * One Bot API call (a FormData body: with a file); its error says what Telegram said, never the
 * token in the address.
 */
async function bot<T>(method: string, body: Record<string, unknown> | FormData = {}): Promise<T> {
  const form = body instanceof FormData;
  // A passing blip is tried again; a message sent (the test) or a photo only when nothing went out.
  const res = await fetchAgain(
    `${API}/bot${token()}/${method}`,
    form
      ? { method: "POST", body }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
    { once: method === "sendMessage" || form },
  ).catch((e: Error) =>
    fail(`Telegram didn't answer (${e.message}): check this machine's network, then run it again`),
  );
  const said = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!said.ok)
    fail(
      res.status === 401
        ? "Telegram refused the token: copy it again from @BotFather, then pnpm ship add telegram --new --yes"
        : `Telegram said: ${said.description ?? `HTTP ${res.status}`}`,
    );
  return said.result as T;
}

/** shipify's variables, read once. */
let vars: Record<string, string> | undefined;
const repoVars = () => {
  vars ??= sourceControl().repoState(platformRepo()).variables;
  return vars;
};

/** The edge's origin, from shipify's variables (door setup sets it). */
const origin = () =>
  edgeOrigin(repoVars()) ?? fail("The edge's address is unknown: pnpm ship door setup --yes first");

/** The link key: Telegram's secret's, for /start's one-time codes (the edge checks them the same). */
const linkKey = (secret: string) =>
  createHmac("sha256", secret).update("shipify:link").digest("hex");

/**
 * What the edge's Telegram route answers an empty update carrying this secret, as Telegram sends it
 * (0: nothing): 200 once the Worker holds this very secret, 401 while it holds another, 503 while it
 * lacks a key.
 */
const answers = (url: string, secret: string) =>
  fetchAgain(
    `${url}/door/telegram`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: "{}",
    },
    { timeoutMs: 10_000 },
  )
    .then((r) => r.status)
    .catch(() => 0);

/** What /health says the edge is: "shipify-edge" once the edge is deployed there. */
const healthApp = (url: string) =>
  fetchAgain(`${url}/health`, {}, { timeoutMs: 10_000 })
    .then((r) => r.json() as Promise<{ app?: string }>)
    .then((h) => h.app)
    .catch(() => undefined);

/** The people, from the shipify repo's variable (unset: you, from SHIPIFY_OWNER). */
function people(): Person[] {
  return readPeople(repoVars().SHIPIFY_PEOPLE, process.env.SHIPIFY_OWNER ?? whoAmI()).people;
}
const whoAmI = () => ghRun(["api", "user", "--jq", ".login"]).stdout.trim() || undefined;

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long to wait between looks at the edge's route (a test's is 0). */
const WAIT_MS = Number(process.env.SHIPIFY_WAIT_MS ?? 10_000);

/** Your default channels (SHIPIFY_SEND), as a list. */
const sendList = () => (repoVars().SHIPIFY_SEND ?? "").split(/[\s,]+/).filter(Boolean);
/** SHIPIFY_SEND set to these, or gone when there are none: GitHub keeps no empty variable. */
function setSend(list: string[]) {
  const sc = sourceControl();
  if (list.length) sc.setVariable(platformRepo(), "SHIPIFY_SEND", list.join(","));
  else sc.deleteVariable(platformRepo(), "SHIPIFY_SEND");
}

// ---------------------------------------------------------------- the steps

/** The token works: the bot's name, kept for the link. */
async function stepToken() {
  const me = await bot<{ username: string }>("getMe");
  setCredential("TELEGRAM_BOT", me.username);
  say(`the bot is @${me.username}`);
}

/**
 * The edge holds Telegram's secret: made here (a new one with --new), kept in your credentials
 * file, and put on the Worker. Done already, it's left as it is.
 */
async function stepEdge() {
  const had = credential(values(), "TELEGRAM_SECRET");
  const held = edgeSecretNames();
  if (!held.ok) fail(`Couldn't read the edge's secrets: ${held.why}`);
  const names = held.ok ? held.names : [];
  if (had && !renewing() && names.includes("TELEGRAM_SECRET") && names.includes("TELEGRAM_TOKEN")) {
    say("the edge has Telegram's keys already");
    return;
  }
  const secret = had && !renewing() ? had : randomBytes(32).toString("hex");
  const put = putEdgeSecret("TELEGRAM_SECRET", secret);
  if (!put.ok) fail(`Couldn't put Telegram's secret on the edge: ${put.why}`);
  setCredential("TELEGRAM_SECRET", secret);
  say("the edge has Telegram's keys");
}

/** What the bot sends the edge: messages, and taps on its buttons (ADR 0042). */
const UPDATES = ["message", "callback_query"];

/**
 * The bot points at the edge, one update at a time (max_connections 1, so a retry and an album are
 * written once), messages and taps, with its secret: once the edge is deployed and holds that
 * secret.
 */
async function stepWebhook() {
  const url = origin();
  const hook = `${url}/door/telegram`;
  const secret =
    credential(values(), "TELEGRAM_SECRET") ?? fail("No TELEGRAM_SECRET: run the edge step first");
  // The edge must answer first: CI's edge job deploys it once the door is set up.
  const app = await healthApp(url);
  if (app !== EDGE_APP)
    fail(
      `${url} isn't the edge yet (it says it's ${app ?? "nothing"}): CI's edge job deploys it after pnpm ship door setup; once it's done, run pnpm ship add telegram --yes again`,
    );
  // A new secret reaches a running Worker in a few seconds: wait for it, then point the bot.
  for (let i = 0; ; i++) {
    const r = await answers(url, secret);
    if (r === 200) break;
    if (i >= 36)
      fail(
        `${hook} isn't ready (it answered ${r || "nothing"}): run pnpm ship door check, then this again`,
      );
    await sleep(WAIT_MS);
  }
  await bot("setWebhook", {
    url: hook,
    secret_token: secret,
    allowed_updates: UPDATES,
    max_connections: 1,
  });
  const info = await bot<{ url: string; max_connections?: number }>("getWebhookInfo");
  if (info.url !== hook) fail(`Telegram kept ${info.url || "no address"}, not ${hook}`);
  say(`the bot points at ${hook}, one update at a time, messages and taps`);
}

/**
 * The bot's menu of four (/ask, /tasks, /use, /help), how to use it (the help's guide) on its start
 * screen, the same ones the watch keeps in step; and its photo, Shipify's logo, set once: a bot
 * that has a photo keeps it, so running this again stacks none.
 */
async function stepMenu() {
  const { commands, description, short } = chatMenu();
  await bot("setMyDescription", { description });
  await bot("setMyShortDescription", { short_description: short });
  await bot("setMyCommands", { commands });
  const me = await bot<{ id: number }>("getMe");
  const has = await bot<{ total_count?: number }>("getUserProfilePhotos", {
    user_id: me.id,
    limit: 1,
  });
  if ((has.total_count ?? 0) === 0) {
    const form = new FormData();
    form.set("photo", JSON.stringify({ type: "static", photo: "attach://logo" }));
    form.set("logo", new Blob([readFileSync(LOGO)], { type: "image/jpeg" }), "logo.jpg");
    await bot("setMyProfilePhoto", form);
  }
  say(
    `its menu has ${commands.length} commands, and its photo is ${has.total_count ? "kept" : "Shipify's logo"}`,
  );
}

/** You, linked: a one-time link for the bot, and the id it sends back, kept with your name. */
async function stepLink() {
  const secret =
    credential(values(), "TELEGRAM_SECRET") ?? fail("No TELEGRAM_SECRET: run the edge step first");
  const name = credential(values(), "TELEGRAM_BOT") ?? fail("Run the token step first");
  let id = process.env.TELEGRAM_ID ?? credential(values(), "TELEGRAM_ID");
  if (!id) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const mac = createHmac("sha256", linkKey(secret))
      .update(`telegram|${exp}`)
      .digest("hex")
      .slice(0, 16);
    process.stderr.write(
      // The link carries the code only when it's opened: a Start pressed in a chat found another way
      // sends no code, and the bot says nothing to someone it doesn't know yet.
      `\nOpen this on your phone and press Start: https://t.me/${name}?start=${exp}.${mac}\n` +
        `(Or send the bot exactly this: /start ${exp}.${mac})\n`,
    );
    id = await ask("Paste the id the bot sends you: ");
  }
  if (!/^\d{1,15}$/.test(id ?? ""))
    fail("That isn't a Telegram id (only digits): run pnpm ship add telegram --yes again");
  setCredential("TELEGRAM_ID", id as string);
  // Your id with your name (SHIPIFY_PEOPLE), and Telegram among your default channels
  // (SHIPIFY_SEND): what needs you, deploys and alerts reach it too. Each only if it changes.
  const now = people();
  if (now[0]?.on.telegram !== id)
    sourceControl().setVariable(
      platformRepo(),
      "SHIPIFY_PEOPLE",
      JSON.stringify(withId(now, "telegram", id as string)),
    );
  const list = sendList();
  if (!list.includes("telegram")) setSend([...list, "telegram"]);
  say(`you're linked: ${now[0]?.name} on Telegram`);
}

/** A message to your phone, from the bot: it can reach you. Replies come through the edge. */
async function stepTest() {
  const id = credential(values(), "TELEGRAM_ID") ?? fail("Run the link step first");
  await bot("sendMessage", {
    chat_id: Number(id),
    text: "Shipify is connected. Send me anything, or try /help. Approvals stay on GitHub: my messages link there.",
  });
  say("a test message is on its way to your phone");
}

/**
 * Whether it works, from your PC (with the bot's token): pointed at the edge, one update at a time,
 * taking taps, and no error in the last 30 minutes. A box holds none of Telegram's keys: nothing to check there.
 */
async function check() {
  if (!tokenHere()) {
    say("nothing to check here: the edge holds Telegram's keys");
    return;
  }
  const url = origin();
  const me = await bot<{ username: string }>("getMe");
  const info = await bot<{
    url: string;
    max_connections?: number;
    allowed_updates?: string[];
    last_error_date?: number;
    last_error_message?: string;
  }>("getWebhookInfo");
  if (info.url !== `${url}/door/telegram`)
    fail(
      `@${me.username} isn't pointed at the edge (${url}/door/telegram) yet: pnpm ship add telegram --yes`,
    );
  if (info.max_connections !== undefined && info.max_connections !== 1)
    fail(
      `@${me.username} takes ${info.max_connections} updates at once, not 1: pnpm ship add telegram --new --yes`,
    );
  // None listed is every kind; a list without taps was set before buttons.
  if (info.allowed_updates && !UPDATES.every((u) => info.allowed_updates?.includes(u)))
    fail(`@${me.username} doesn't send button taps to the edge: pnpm ship add telegram --yes`);
  if (info.last_error_date && Date.now() / 1000 - info.last_error_date < 1800)
    fail(
      `@${me.username}'s edge answered with an error lately: ${info.last_error_message ?? "no reason given"}`,
    );
  say(`@${me.username}, pointed at the edge`);
}

/**
 * Undone: the bot points nowhere, you're unlinked and Telegram is off your default channels, and
 * its secret is gone from the edge (ship remove drops the token).
 */
async function remove() {
  await bot("deleteWebhook", {});
  const now = people();
  if (now.some((p) => p.on.telegram))
    sourceControl().setVariable(
      platformRepo(),
      "SHIPIFY_PEOPLE",
      JSON.stringify(
        now.map((p) => {
          const { telegram: _, ...on } = p.on;
          return { ...p, on };
        }),
      ),
    );
  const list = sendList();
  if (list.includes("telegram")) setSend(list.filter((c) => c !== "telegram"));
  const gone = deleteEdgeSecret("TELEGRAM_SECRET");
  if (!gone.ok) fail(`Couldn't take Telegram's secret off the edge: ${gone.why}`);
  for (const k of ["TELEGRAM_SECRET", "TELEGRAM_ID", "TELEGRAM_BOT"]) forgetCredential(k);
  say("the bot points nowhere, and you're unlinked");
}

const steps: Record<string, () => Promise<void>> = {
  token: stepToken,
  edge: stepEdge,
  webhook: stepWebhook,
  menu: stepMenu,
  link: stepLink,
  test: stepTest,
  "--check": check,
  "--remove": remove,
};
const step = steps[process.argv[2] ?? ""];
if (!step) fail(`usage: setup.ts ${Object.keys(steps).join("|")}`);
await (step as () => Promise<void>)();
