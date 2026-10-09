// `ship setup` (ADR 0027, step 5, docs/getting-started.md): Shipify set up from nothing, one step
// at a time, in plain words. Each step checks the real world first (what doctor and box list
// check), so it knows where you are without storing anything: stop any time, run it again, and it
// carries on. A step that's done shows ✓; the first that isn't says what to do and where, and, in
// a terminal, does what it can there (asks your settings, takes a key you paste), waits for you and
// checks again. Keys are typed only by you, into a hidden prompt in your own terminal: setup never
// prints one.
import { createInterface } from "node:readline";
import { yourAccounts } from "../lib/accounts.ts";
import { defaultAgent, loadExecutors, loginOf } from "../lib/agents.ts";
import {
  credential,
  credentialsFile,
  hidden,
  loadCredentials,
  setCredential,
} from "../lib/credentials.ts";
import { ghRun, platformRepo } from "../lib/github.ts";
import type { Check, Result } from "../lib/output.ts";
import { absent, allSettings } from "../lib/settings.ts";
import { isSetUp, loadTools } from "../lib/tools.ts";
import { watchState } from "../lib/watch.ts";
import { setKeys } from "./add.ts";
import { isBoxRunner, isSandboxed, repoSettings, runners } from "./box.ts";
import { machineChecks } from "./doctor.ts";

/** How a step asks you something in the terminal: a line, or a key at a hidden prompt. */
export interface Prompt {
  line(question: string): Promise<string>;
  hidden(question: string): Promise<string>;
}

/** One step of setting up: what it is, whether it's done, and how to do it. */
export interface Step {
  id: string;
  title: string;
  /** Whether it's done, and what's there now (never a key). */
  check(): { ok: boolean; detail?: string };
  /** What to do, a line each, plain: where to click, what to run (from its last check). */
  how: string[] | (() => string[]);
  /** Keys the owner can paste here, into a hidden prompt: [credential name, what it is]. */
  keys?: [name: string, what: string][];
  /** What it does itself in a terminal, when it's next: what it said, a line each. */
  act?(prompt: Prompt): Promise<string[]>;
  /** Not needed for tasks to work: shown, never blocking. */
  optional?: boolean;
}

const howOf = (s: Step) => (typeof s.how === "function" ? s.how() : s.how);

/** A GitHub API read, or undefined when it fails (nothing set up yet, or no access). */
function gh(path: string, jq?: string): string | undefined {
  const r = ghRun(["api", path, ...(jq ? ["--jq", jq] : [])]);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

// ---------------------------------------------------------------- your settings

/**
 * What a step asks you for (ADR 0047): its settings that are values, from the one list
 * (cli/lib/settings.ts), each a variable on your copy that a run reads, with a copy kept on this
 * PC. Offered: this PC's copy, else (your time zone) this PC's own. A key is a secret instead.
 */
export function asked(
  step: string,
  all = allSettings(),
): { name: string; what: string; now?: string; shown?: string }[] {
  const values = loadCredentials().values;
  const pcZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return all
    .filter((s) => s.steps?.includes(step) && s.lives[0] === "variable" && !s.optional)
    .map((s) => {
      const kept = credential(values, s.name);
      const zone = s.name === "SHIPIFY_TIME_ZONE" ? pcZone : undefined;
      // Shown: the zone itself, or only that this PC has one (it may be an account's id).
      const offer = kept
        ? { now: kept, shown: zone ? kept : "this PC's copy" }
        : zone
          ? { now: zone, shown: zone }
          : {};
      return { name: s.name, what: `${s.what[0]?.toUpperCase()}${s.what.slice(1)}`, ...offer };
    });
}

/** Why an answer can't be that setting, or undefined when it can. */
function notSetting(name: string, value: string): string | undefined {
  if (/\s/.test(value)) return `${value} has a space in it`;
  if (name === "SHIPIFY_TIME_ZONE")
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
    } catch {
      return `${value} isn't a time zone (like Europe/London)`;
    }
  return undefined;
}

// ---------------------------------------------------------------- the steps

/** Every step, in the order that works (docs/getting-started.md). */
export function steps(): Step[] {
  // Your copy (ADR 0047): this checkout's GitHub remote names it; none before it's pushed.
  let repo = "";
  try {
    repo = platformRepo();
  } catch {}
  const owner = repo.split("/")[0] ?? "";
  // Every setting, from the one list (ADR 0047): each step checks its own are on your copy.
  const all = allSettings();
  // Read once, for the steps that need them: GitHub's answers about the shipify repo.
  let settings: ReturnType<typeof repoSettings> | undefined;
  const repoSet = () => (settings ??= repoSettings(repo));
  const lacks = (step: string) => absent(step, repoSet(), all);
  const creds = () => loadCredentials().values;
  const agents = loadExecutors();
  const login = loginOf(agents[defaultAgent(agents)]);
  // What this PC needs: the core's own tools (doctor's checks with no stack). A box installs its
  // agent; apps add each stack's tools (stack.json). Never named here (ADR 0010).
  let missing: Check[] = [];
  // The keys apps are deployed with (each stack's deploy.secrets), kept here and on your copy.
  const hostingKeys = all
    .filter((s) => s.steps?.includes("apps") && s.lives[0] === "secret")
    .map((s) => [s.name, `${s.name}, ${s.what}`] as [string, string]);
  // Your settings: the time zone the core reads, and each value apps deploy with.
  const zone = asked("settings", all);
  const deployValues = asked("apps", all);
  type Wanted = typeof zone;
  const settingsCheck = (wanted: Wanted) => {
    if (!repo || !gh(`repos/${repo}`, ".name"))
      return { ok: false, detail: "once your copy's repo is there" };
    const vars = repoSet().vars;
    const unset = wanted.filter((w) => !vars[w.name]).map((w) => w.name);
    return unset.length
      ? { ok: false, detail: `${repo} has no variable ${unset.join(", ")}` }
      : {
          ok: true,
          // Names only (the time zone with its value): a setting may be an account's id.
          detail: wanted
            .map((w) => (w.name === "SHIPIFY_TIME_ZONE" ? `${w.name} ${vars[w.name]}` : w.name))
            .join(", "),
        };
  };
  const settingsAct = async (p: Prompt, wanted: Wanted) => {
    const said: string[] = [];
    const vars = repoSettings(repo).vars;
    for (const w of wanted) {
      if (vars[w.name]) continue;
      const a = (await p.line(`${w.what}${w.shown ? ` [${w.shown}]` : ""}: `)).trim() || w.now;
      if (!a) continue;
      const why = notSetting(w.name, a);
      if (why) {
        said.push(`${why}: try again.`);
        continue;
      }
      const r = ghRun(["variable", "set", w.name, "-R", repo, "--body", a]);
      if (r.code) {
        said.push(`Couldn't set ${w.name} on ${repo}: ${r.stderr.trim().slice(0, 200)}`);
        continue;
      }
      setCredential(w.name, a);
      said.push(`Set ${w.name} on ${repo}, and kept it in ${credentialsFile()}.`);
    }
    return said;
  };
  /** A step's settings, when one isn't on your copy: what's missing, by name. */
  const unsetOn = (step: string) => {
    const gone = lacks(step);
    return gone.length ? { ok: false, detail: `${repo} has no ${gone.join(" nor ")}` } : undefined;
  };
  // The template this copy follows: its setting, else the one GitHub says it was made from. A
  // private one on another account takes a read-only key: the bot reaches only this account.
  const template = () =>
    repoSet().vars.SHIPIFY_TEMPLATE ||
    (repo ? gh(`repos/${repo}`, ".template_repository.full_name // empty") : undefined) ||
    undefined;
  const needsKey = (t: string) =>
    t.split("/")[0]?.toLowerCase() !== owner.toLowerCase() &&
    gh(`repos/${t}`, ".private") === "true";
  return [
    // ------------------------------------------------ the core: four steps to a first answer
    {
      id: "tools",
      title: "This PC has its tools: Node 22, pnpm, git and gh",
      check: () => {
        missing = machineChecks([]).filter((c) => !c.ok && c.blocking !== false);
        return {
          ok: !missing.length,
          detail: missing.map((c) => c.name).join(", ") || "all there",
        };
      },
      how: () => [
        ...missing.flatMap((c) => (c.fix ? [`${c.name}: ${c.fix}`] : [])),
        "Each one's own site says how to install it. On Ubuntu, git: sudo apt install git; pnpm: corepack enable --install-directory ~/.local/bin.",
        "On Windows, all of it goes inside WSL (Ubuntu), with systemd on: docs/getting-started.md.",
      ],
    },
    {
      id: "github",
      title: "GitHub: your copy of Shipify, and this PC signed in",
      check: () => {
        const who = gh("user", ".login");
        if (!who)
          return { ok: false, detail: "this PC isn't signed in to GitHub (gh auth status)" };
        if (!repo)
          return {
            ok: false,
            detail: "this checkout has no GitHub remote, so it names no copy of yours yet",
          };
        const admin = gh(`repos/${repo}`, ".permissions.admin");
        if (admin === undefined)
          return { ok: false, detail: `${repo} isn't there, or ${who} can't see it` };
        if (admin !== "true")
          return { ok: false, detail: `${who} can't administer ${repo}: it isn't your copy` };
        return {
          ok: true,
          detail:
            who.toLowerCase() === owner.toLowerCase()
              ? `${repo}, on your own account`
              : `${repo}, in ${owner}`,
        };
      },
      how: [
        "Your copy is a private repo named shipify, on your own account or an organization of yours: on GitHub, make it, then point this checkout at it: git remote set-url origin https://github.com/<you>/shipify.git, then git push -u origin main.",
        "Sign this PC in: gh auth login (a fine-grained token named shipify-pc, docs/setup.md “Tokens and secrets”, or the browser), then gh config set git_protocol https -h github.com and gh auth setup-git.",
        "On an organization: allow fine-grained tokens; Actions → General: read repository contents, with creating PRs off.",
      ],
    },
    {
      id: "settings",
      title: "Your time zone: a variable on your copy",
      check: () => settingsCheck(zone),
      how: [
        `Answer here (Enter takes this PC's zone): it's set as a variable on ${repo || "your copy"}, which every run reads, and kept in this PC's credentials file. To change it later: gh variable set SHIPIFY_TIME_ZONE -R ${repo || "<your copy>"}.`,
      ],
      act: (p) => settingsAct(p, zone),
    },
    {
      id: "bot",
      title: "The bot: the GitHub App that runs tasks and opens their PRs",
      check: () => {
        if (!repoSet().vars.SHIPIFY_BOT_CLIENT_ID)
          return { ok: false, detail: "not registered yet" };
        return unsetOn("bot") ?? { ok: true, detail: repoSet().vars.SHIPIFY_BOT_SLUG };
      },
      how: [
        "Run: pnpm ship bot --yes. In the browser, click Create GitHub App, then install it with All repositories.",
        "In the app's permissions, set Variables to Read and write, save, and accept the change on the install.",
      ],
    },
    {
      id: "agent",
      title: "The agent's login, for boxes",
      check: () => {
        if (!login) return { ok: true, detail: "the default agent needs none" };
        return unsetOn("agent") ?? { ok: true, detail: `${login.secret} is set` };
      },
      how: login
        ? [
            `Run: ${login.how} (it lasts a year), then paste it here when asked: hidden as you type, and set as the secret ${login.secret} on ${repo || "your copy"}.`,
          ]
        : [],
      ...(login
        ? {
            act: async (p: Prompt) => {
              const r = await setKeys([{ secret: login.secret, ask: login.how, repo }], {
                interactive: true,
                ask: (q) => p.hidden(q),
                again: "pnpm ship setup",
              });
              return r.checks.map(
                (c) => `${c.ok ? "✓" : "·"} ${c.name}${c.fix ? `: ${c.fix}` : ""}`,
              );
            },
          }
        : {}),
    },
    {
      id: "box",
      title: "A box: a machine that runs tasks, its agent in a sandbox",
      check: () => {
        let boxes: ReturnType<typeof runners>;
        try {
          boxes = runners(repo).filter(isBoxRunner);
        } catch {
          return { ok: false, detail: "the repo's runners couldn't be read" };
        }
        const online = boxes.filter((r) => r.status === "online");
        const ready = online.filter(isSandboxed);
        // Only your events start runs: box add sets who you are (SHIPIFY_OWNER).
        if (ready.length)
          return unsetOn("box") ?? { ok: true, detail: `${ready.length} slot(s) online for tasks` };
        if (online.length)
          return {
            ok: false,
            detail: `${online.length} slot(s) online, none with the sandbox, so none takes a task`,
          };
        return { ok: false, detail: boxes.length ? "every box is offline" : "no box yet" };
      },
      how: [
        "This PC (Ubuntu 24.04 LTS or newer, or WSL with systemd on): pnpm ship box add, read the plan, then pnpm ship box add --yes. It asks for sudo once.",
        "Or a Raspberry Pi or a small VPS on Ubuntu 24.04 LTS or newer, that you reach over SSH with your key: pnpm ship box add <user@host> --manage --yes (docs/box-setup.md).",
      ],
    },
    // ------------------------------------------------ add-ons: each when you want it, none blocks
    {
      id: "door",
      title: "Chat and repeats: the edge's door App, so your chats and the watch reach Shipify",
      check: () => {
        const v = repoSet().vars;
        if (!v.SHIPIFY_DOOR_APP_ID) return { ok: false, detail: "no door App yet" };
        return (
          unsetOn("door") ?? {
            ok: true,
            detail: `the door App ${v.SHIPIFY_DOOR_APP_ID}, at ${v.SHIPIFY_DOOR_URL} (pnpm ship door check tests it)`,
          }
        );
      },
      how: [
        "Run: pnpm ship door setup, read the plan, then pnpm ship door setup --yes: a GitHub page opens; press Create, then Install on shipify only, then set Variables to Read-only.",
        "It puts the App's key on the edge and deploys it. Then: pnpm ship door check.",
      ],
      optional: true,
    },
    {
      id: "watch",
      title: "The watch: repeats, reminders, clean-ups and alerts",
      check: () => {
        try {
          return watchState();
        } catch {
          return { ok: false, detail: "the watch's runs couldn't be read" };
        }
      },
      how: [
        "The watch runs in the edge (ADR 0031): it starts once the door is set up (the step above).",
        "Its first tick opens the Shipify status issue: pin it and subscribe, so alerts reach you.",
      ],
      optional: true,
    },
    {
      id: "plugins",
      title: "The plug-ins you use (tools, channels): each sets up the same way",
      check: () => {
        const values = creds();
        const can = Object.entries(loadTools()).filter(([, t]) => t.setup);
        const added = can.filter(([, t]) => isSetUp(t, (k) => credential(values, k)));
        const left = can.filter(([n]) => !added.some(([a]) => a === n)).map(([n]) => n);
        const said = [
          ...(added.length ? [`added: ${added.map(([n]) => n).join(", ")}`] : []),
          ...(left.length ? [`available: ${left.join(", ")} (pnpm ship add <name>)`] : []),
        ];
        return { ok: !left.length, detail: said.join("; ") || "none to add" };
      },
      how: [
        "Add the ones you want, each in one command that shows its plan first: pnpm ship add <name>, then pnpm ship add <name> --yes (docs/plug-ins.md).",
      ],
      optional: true,
    },
    {
      id: "repos",
      title: "Other accounts: the repos App, so Shipify reads and opens PRs there (ADR 0045)",
      check: () => {
        const s = repoSet();
        if (!s.vars.SHIPIFY_REPOS_CLIENT_ID)
          return { ok: false, detail: "not set up: only for repos on another of your accounts" };
        const listed = yourAccounts({ SHIPIFY_ACCOUNTS: s.vars.SHIPIFY_ACCOUNTS ?? "" });
        return (
          unsetOn("repos") ?? {
            ok: true,
            detail: `${s.vars.SHIPIFY_REPOS_SLUG}; your accounts: ${listed.join(", ") || "none yet"}`,
          }
        );
      },
      how: [
        "Run: pnpm ship bot repos, read the plan, then pnpm ship bot repos --yes: in the browser, click Create GitHub App (a small public App that reads code and opens PRs, and nothing more).",
        "Then add each of your other accounts: pnpm ship bot repos <account> --yes, and on GitHub install the App there on the repos you pick.",
      ],
      optional: true,
    },
    {
      id: "apps",
      title: "Apps Shipify builds and deploys: your host's keys and values",
      check: () => {
        const file = credentialsFile();
        const here = hostingKeys.map(([n]) => n).filter((n) => !credential(creds(), n));
        if (here.length) return { ok: false, detail: `${file} has no ${here.join(", ")}` };
        if (!repo || !gh(`repos/${repo}`, ".name"))
          return { ok: false, detail: "once your copy's repo is there" };
        // A merged plan is published on GitHub's runners, with the keys as the repo's secrets and
        // its values as your settings.
        const off = lacks("apps");
        if (off.length)
          return {
            ok: false,
            detail: `${repo} has no ${off.join(" nor ")} yet (a merged plan is published with them)`,
          };
        // Each app carries its own pipeline (ADR 0048): nothing more to grant here.
        return { ok: true, detail: `keys in ${file} and on ${repo}; your settings` };
      },
      how: () => [
        "The stacks' own tools on this PC, for building an app here: pnpm ship doctor names any that's missing.",
        `Make your host's keys, as docs/setup.md says (“Tokens and secrets”): ${hostingKeys.map(([, what]) => what).join(", ")}; then paste each here: hidden as you type, kept in your credentials file, and set as a secret on ${repo || "your copy"}.`,
        `Your stacks' values (${deployValues.map((w) => w.name).join(", ") || "none"}): answered here, set as variables on ${repo || "your copy"}.`,
      ],
      keys: hostingKeys,
      act: async (p) => {
        const said = await settingsAct(p, deployValues);
        // Before the repo is there, each key is kept here; once it is, each goes on it too.
        if (!repo || !gh(`repos/${repo}`, ".name")) {
          for (const [name, what] of hostingKeys) {
            if (credential(creds(), name)) continue;
            const value = (await p.hidden(`Paste ${what} (hidden; Enter to skip): `)).trim();
            if (!value) continue;
            if (/\s/.test(value)) {
              said.push("That has a space in it, so it isn't one: try again.");
              continue;
            }
            setCredential(name, value);
            said.push(`Kept ${name} in ${credentialsFile()}.`);
          }
          return said;
        }
        const r = await setKeys(
          hostingKeys.map(([secret, what]) => ({ secret, ask: what, repo })),
          { interactive: true, ask: (q) => p.hidden(q), again: "pnpm ship setup" },
        );
        return [
          ...said,
          ...r.checks.map((c) => `${c.ok ? "✓" : "·"} ${c.name}${c.fix ? `: ${c.fix}` : ""}`),
        ];
      },
      optional: true,
    },
    {
      id: "updates",
      title: "Updates: each new Shipify version offered as a PR (docs/releases.md)",
      check: () => {
        const t = template();
        if (!t)
          return {
            ok: false,
            detail:
              "this copy follows no template (made with Use this template, it follows its own)",
          };
        const newest = gh(`repos/${t}/releases/latest`, ".tag_name");
        if (newest === undefined) return { ok: false, detail: `${t} can't be read from this PC` };
        if (needsKey(t) && !repoSet().secrets.includes("SHIPIFY_TEMPLATE_TOKEN"))
          return {
            ok: false,
            detail: `${t} is private and on another account: ${repo} has no secret SHIPIFY_TEMPLATE_TOKEN, so its weekly check can't read it`,
          };
        return { ok: true, detail: `follows ${t} (newest: ${newest || "none yet"})` };
      },
      how: () => [
        "A copy made with Use this template follows it at once: its weekly check (update.yml) offers each new version as a PR, and you merge it.",
        `A private template on another account needs a read-only key: a fine-grained token with access to that repo only, Contents read-only, pasted here (hidden) and set as the secret SHIPIFY_TEMPLATE_TOKEN on ${repo || "your copy"}.`,
      ],
      act: async (p: Prompt) => {
        const t = template();
        if (!t || !needsKey(t) || repoSet().secrets.includes("SHIPIFY_TEMPLATE_TOKEN")) return [];
        const r = await setKeys(
          [
            {
              secret: "SHIPIFY_TEMPLATE_TOKEN",
              ask: `a fine-grained token: only ${t}, Contents read-only`,
              repo,
            },
          ],
          { interactive: true, ask: (q) => p.hidden(q), again: "pnpm ship setup" },
        );
        return r.checks.map((c) => `${c.ok ? "✓" : "·"} ${c.name}${c.fix ? `: ${c.fix}` : ""}`);
      },
      optional: true,
    },
  ];
}

/** Each step's state, as checks: done, to do (with what to do), or optional. */
export function setupChecks(all = steps()): { checks: Check[]; next?: Step } {
  const checks: Check[] = [];
  let next: Step | undefined;
  for (const s of all) {
    let r: { ok: boolean; detail?: string };
    try {
      r = s.check();
    } catch (e) {
      r = { ok: false, detail: (e as Error).message.split("\n")[0] };
    }
    if (!r.ok && !s.optional) next ??= s;
    checks.push({
      name: s.title,
      ok: r.ok,
      detail: r.detail,
      blocking: !s.optional,
      fix: r.ok ? undefined : howOf(s).join(" "),
    });
  }
  return { checks, next };
}

export { hidden };

/** One line you type, as typed (trimmed). */
const line = (question: string) =>
  new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

/**
 * `ship setup`: every step's state, and the first one to do. In a terminal it walks you through:
 * it says what to do, does what it can there (your settings, a key you paste, hidden), waits, and
 * checks again until each step is done. Elsewhere (or with --json) it reports and stops.
 */
export async function setup(opts: { interactive?: boolean } = {}): Promise<Result> {
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) return report(steps());
  const prompt: Prompt = { line, hidden: (q) => hidden(q) };
  for (;;) {
    // Read again each time: a step may have changed what the others read (your settings).
    const all = steps();
    const { checks, next } = setupChecks(all);
    for (const c of checks)
      process.stdout.write(
        `${c.ok ? "✓" : c.blocking ? "·" : "○"} ${c.name}${c.detail ? `: ${c.detail}` : ""}\n`,
      );
    if (!next) {
      process.stdout.write(`\n${FIRST_ASK()}\n`);
      return report(all);
    }
    process.stdout.write(
      `\nNext: ${next.title}\n${howOf(next)
        .map((h) => `  - ${h}`)
        .join("\n")}\n\n`,
    );
    if (next.act) for (const said of await next.act(prompt)) process.stdout.write(`${said}\n`);
    const a = (await line("Press Enter to check again, or q to stop: ")).toLowerCase();
    if (a === "q") return report(steps());
    process.stdout.write("\n");
  }
}

/** The core's done: the first thing to do with it, and the add-ons left (ADR 0047). */
const FIRST_ASK = () => {
  let repo = "your copy";
  try {
    repo = platformRepo();
  } catch {}
  return `The core is set up. Ask your first question: open an issue in ${repo} (on GitHub or its phone app), "what can you do?", and a box answers within a minute or two. The add-ons (○) are there whenever you want them: run pnpm ship setup again.`;
};

function report(all: Step[]): Result {
  const { checks, next } = setupChecks(all);
  return {
    command: "setup",
    status: next ? "blocked" : "succeeded",
    summary: next
      ? `next: ${next.title}`
      : `the core is set up${checks.some((c) => !c.ok) ? " (the add-ons left are shown)" : ""}`,
    checks,
    nextSteps: next ? howOf(next) : [FIRST_ASK()],
  };
}
