// Shipify's gate for OpenCode (ADR 0038, ADR 0043): an OpenCode plugin that holds it to the rules
// every agent gets, with pi's gate's own checks (pi-gate.mjs, copied beside it). OpenCode's own
// permissions refuse `git push` in most forms, but not after a wrapper (`env git push`) or by its
// path (`/usr/bin/git push`), so opencode.ts's adapter loads this, and each tool call is checked
// before it runs; one that isn't allowed is refused with the reason, which the run's details list:
// - its tools on files and commands, as pi's gate decides them: read, list, glob and grep read;
//   write, edit and apply_patch write (inside its working folder or the folders it may write);
//   bash runs, unless a part of a command is a refused one;
// - the look calls it was given, the web when the run may read it, and its own tools that touch no
//   file (its to-dos, skills and helpers, whose calls come through here too);
// - anything else is refused: an act call, a tool Shipify doesn't know;
// - in the read profile (`run: false`, ADR 0044): reading its folders only, as pi's gate.
// Its gateway's key, as pi's gate does: read once from the pipe SHIPIFY_LOGIN_FD names, which is then
// closed, and put on each call to the provider its rules name (OpenCode's `chat.headers`), so it's
// in neither OpenCode's config nor its environment; and an OpenCode without this gate has no key.
// The config OpenCode runs with, once it has read every source, must be its adapter's: no plugin but
// this one, and its provider's calls going where opencode.json (beside it) says. A file a run wrote
// that OpenCode reads after that config (its sessions' database holds a login whose config it
// fetches) could change them for a later ask: then the key is never handed, and the run says why.
// A command OpenCode runs gets the run's own XDG folders back (its adapter moves OpenCode's own into
// the run's config folder), so its caches are the slot's kept ones: pnpm's store, a test browser.
// It also says, as lines of OpenCode's output, the model each ask goes to and each call it checked
// (a command's text with it, and why it was refused): OpenCode's own events carry neither, nor its
// helpers' calls, and the run's details and what the run read come from these. OpenCode starts every
// export of a plugin as a plugin, so this exports the one, with its check on it for the tests
// (tests/plugins/agent.test.ts).
import { readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { login, REFUSED, refused } from "./pi-gate.mjs";

/** OpenCode's tools on files and commands, by pi's names for them. */
const AS_PI = {
  bash: "bash",
  read: "read",
  list: "ls",
  glob: "find",
  grep: "grep",
  write: "write",
  edit: "edit",
};

/** Its tools that read the web, and its own that touch no file. */
const WEB = ["webfetch", "websearch"];
const OWN = ["todowrite", "todoread", "skill", "task"];

/** The files a patch changes: `*** Add File: x`, `*** Update File: x`, `*** Move to: x`. */
const patched = (text) =>
  [
    ...String(text ?? "").matchAll(
      /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm,
    ),
  ].map((m) => (m[1] ?? m[2]).trim());

/** Why OpenCode's call of `tool` isn't allowed, or undefined when it is. */
function refusedCall(rules, tool, args, cwd, own) {
  if (Object.hasOwn(AS_PI, tool))
    return refused(rules, AS_PI[tool], { ...args, path: args.filePath ?? args.path }, cwd, own);
  if (rules.run === false) return `${tool} isn't for a run that only reads its files`;
  if (tool === "apply_patch") {
    const files = patched(args.patchText);
    if (!files.length) return "a patch that names no file";
    for (const f of files) {
      const why = refused(rules, "write", { path: f }, cwd, own);
      if (why) return why;
    }
    return undefined;
  }
  if (Object.hasOwn(rules.look, tool)) return undefined;
  if (WEB.includes(tool)) return rules.web ? undefined : `${tool} isn't for this run`;
  if (OWN.includes(tool)) return undefined;
  return `${tool} isn't one of the look calls it has, or a tool Shipify knows`;
}

/** A value with its keys in order, so two configs compare by what they say. */
const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;

/**
 * Where calls to a provider go, as a config says: everything it says of the provider (its address,
 * its package), and each model's own way there, though not a model's other facts.
 */
const route = (p) => {
  const { models = {}, ...provider } = p ?? {};
  return JSON.stringify(
    sorted([provider, Object.entries(models).map(([id, m]) => [id, m?.provider ?? null])]),
  );
};

/** What in the config OpenCode runs with isn't its adapter's, or undefined when it all is. */
function changed(cfg, own, provider) {
  if ((cfg?.plugin ?? []).length !== 1) return "a plugin besides Shipify's gate";
  if (!provider) return undefined;
  try {
    const wrote = JSON.parse(readFileSync(join(own, "opencode.json"), "utf8")).provider?.[provider];
    if (wrote && route(cfg?.provider?.[provider]) === route(wrote)) return undefined;
  } catch {}
  return `where ${provider}'s calls go`;
}

/** The XDG folders a command gets: the run's own, its HOME's (as the box sets them), not OpenCode's. */
const runFolders = (home) =>
  home
    ? {
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_STATE_HOME: join(home, ".local", "state"),
      }
    : {};

/** The gateway's key, read from the pipe the first time the plugin starts: it's read only once. */
let key;

/**
 * A line of OpenCode's output, written straight to fd 1: its own stream to a pipe (the box reads
 * one) breaks when a plugin writes through process.stdout too. OpenCode makes fd 1 non-blocking, so
 * a full pipe is tried again and a line written in part is finished. Checked live on 1.18.34.
 */
const say = (e) => {
  const line = Buffer.from(`${JSON.stringify({ type: "shipify", ...e })}\n`);
  for (let at = 0; at < line.length; )
    try {
      at += writeSync(1, line, at);
    } catch (err) {
      if (err?.code !== "EAGAIN") throw err;
    }
};

export const ShipifyGate = async () => {
  const own = dirname(fileURLToPath(import.meta.url));
  const rules = JSON.parse(readFileSync(join(own, "gate.json"), "utf8"));
  key ??= login();
  const folders = runFolders(process.env.HOME);
  return {
    config: async (cfg) => {
      const what = changed(cfg, own, rules.provider);
      if (!what) return;
      key = "";
      say({
        error: `${REFUSED}: OpenCode's config isn't the one Shipify wrote (${what}), so it gets no key for its gateway`,
      });
    },
    "shell.env": async (_input, output) => {
      Object.assign(output.env, folders);
    },
    "tool.execute.before": async (input, output) => {
      const args = output.args ?? {};
      const why = refusedCall(rules, input.tool, args, process.cwd(), own);
      // A look call by Shipify's name (tool.call), any other by OpenCode's.
      say({
        call: Object.hasOwn(rules.look, input.tool) ? rules.look[input.tool] : input.tool,
        ...(input.tool === "bash" ? { command: String(args.command ?? "") } : {}),
        ...(why ? { refused: `${REFUSED}: ${why}` } : {}),
      });
      if (why) throw new Error(`${REFUSED}: ${why}`);
    },
    "chat.headers": async (input, output) => {
      if (key && rules.provider && input.model?.providerID === rules.provider)
        output.headers.Authorization = `Bearer ${key}`;
    },
    "chat.params": async (input) => {
      if (input.model?.id) say({ model: input.model.id });
    },
  };
};
ShipifyGate.refused = refusedCall;
