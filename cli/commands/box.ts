// Boxes (ADR 0012, docs/tasks.md): any Linux machine that runs tasks, as GitHub runners that
// belong to the platform repo only. One way for every machine (ADR 0047): `add` sets up a Pi or a
// VPS over SSH, or this PC with no target, with the same script, once. A box runs its tasks in
// slots (ADR 0020): one runner each, so one task at a time each. Registration uses your gh login;
// its one-hour tokens are never printed. Setup 5 (ADR 0031) runs each slot's agent as a user of
// its own, and once that checks out its slots get the label `sandbox`, which run jobs need.

import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { yourAccounts } from "../lib/accounts.ts";
import { defaultAgent, loadExecutors, loginOf } from "../lib/agents.ts";
import { boxFacts, factLines } from "../lib/box-facts.ts";
import { listStacks } from "../lib/catalog.ts";
import { PLATFORM_ROOT } from "../lib/config.ts";
import { has, type RunResult, run } from "../lib/exec.ts";
import { gh, ghJson, ghRun, platformRepo } from "../lib/github.ts";
import { type Check, ok, type Result, ShipError } from "../lib/output.ts";
import { sourceControl } from "../lib/providers.ts";
import { SANDBOX_LABEL, slotOf as slotOfRunner } from "../lib/sandbox.ts";

export const BOX_LABEL = "shipify-box";
/**
 * Each box's own label too, on every slot: a run can go to that box (its weekly clean-up, ADR
 * 0019), and the label is how GitHub's runners group into boxes (ADR 0020).
 */
export const boxLabel = (name: string) => `box-${name}`;
const labelsOf = (name: string) => `${BOX_LABEL},${boxLabel(name)}`;
/**
 * Slots (ADR 0020): slot 1 is the runner named after the box, in the box's folder; slot k is the
 * runner `<box>-<k>`, in `<folder>/slot-<k>`. A new box gets slotsFor its memory (DEFAULT_SLOTS
 * when it doesn't say); `--slots` changes it.
 */
export const MAX_SLOTS = 4;
export const DEFAULT_SLOTS = 2;
/**
 * A new Pi or VPS's slots, from its memory (MemTotal, in KiB): 1 GiB for the system, then one
 * per 2 GiB (a task peaks at about 1.7 GB, ADR 0020), 1 to MAX_SLOTS. 4 GB gives 1, 6 GB 2, a
 * Pi's 8 GB 3, 12 GB and up 4.
 */
const GIB = 1024 * 1024;
export const slotsFor = (memKiB: number) =>
  Math.min(MAX_SLOTS, Math.max(1, Math.floor((memKiB - GIB) / (2 * GIB))));
/**
 * The one OS a Pi or VPS runs (docs/box-setup.md): Ubuntu, an LTS from 24.04 on, from
 * os-release's `$ID $VERSION_ID`. Raspberry Pi OS (`debian`) is out: its kernel's 39-bit
 * addresses are too few for some stacks' tests.
 */
export function isBoxOs(os: string): boolean {
  const m = /^ubuntu (\d\d)\.04$/.exec(os.trim());
  return !!m && Number(m[1]) >= 24 && Number(m[1]) % 2 === 0;
}
export const slotName = (box: string, k: number) => (k === 1 ? box : `${box}-${k}`);
const slotNumbers = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
/** The box a runner belongs to: its `box-<name>` label, which every slot has, or else its name. */
export const boxOf = (r: { name: string; labels: { name: string }[] }) =>
  r.labels.map((l) => /^box-(.+)$/.exec(l.name)?.[1]).find(Boolean) ?? r.name;
/** Which slot of `box` a runner is: 1 for the box's own name, k for `<box>-<k>`, else 0. */
export const slotOf = (box: string, runner: string): number => slotOfRunner(runner, box);

function parseSlots(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS)
    throw new ShipError(`--slots is a number from 1 to ${MAX_SLOTS}.`, "blocked");
  return n;
}

const safeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

interface Runner {
  id: number;
  name: string;
  os: string;
  status: "online" | "offline";
  busy: boolean;
  labels: { name: string }[];
}

export const runners = (repo: string) =>
  ghJson<{ runners: Runner[] }>(["api", `repos/${repo}/actions/runners?per_page=100`]).runners;
export const isBoxRunner = (r: Runner) => r.labels.some((l) => l.name === BOX_LABEL);
/** A slot whose agent runs in the sandbox (setup 5): run jobs go only to such a slot. */
export const isSandboxed = (r: Runner) => r.labels.some((l) => l.name === SANDBOX_LABEL);
/** A box's slots on GitHub, slot 1 first. */
const slotsOf = (all: Runner[], box: string) =>
  all
    .filter((r) => isBoxRunner(r) && boxOf(r) === box && slotOf(box, r.name) > 0)
    .sort((a, b) => slotOf(box, a.name) - slotOf(box, b.name));

/** A slot's name must be the box's own: refuse one another box's runner already has. */
function checkSlotNames(all: Runner[], box: string, slots: number) {
  for (const k of slotNumbers(slots)) {
    const taken = all.find((r) => r.name === slotName(box, k) && boxOf(r) !== box);
    if (taken)
      throw new ShipError(
        `The runner name "${taken.name}" belongs to the box "${boxOf(taken)}". Give this box another name with --name.`,
        "blocked",
      );
  }
}

const registrationToken = (repo: string) =>
  ghJson<{ token: string }>([
    "api",
    "-X",
    "POST",
    `repos/${repo}/actions/runners/registration-token`,
  ]).token;

/** Secret and variable names on the platform repo (never values). */
export function repoSettings(repo: string) {
  const names = (path: string, key: string) => {
    const r = ghRun(["api", `${path}?per_page=30`, "--paginate", "--jq", `.${key}[].name`]);
    return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
  };
  const vars = ghRun([
    "api",
    `repos/${repo}/actions/variables?per_page=30`,
    "--paginate",
    "--jq",
    ".variables[] | [.name, .value] | @tsv",
  ]);
  return {
    secrets: names(`repos/${repo}/actions/secrets`, "secrets"),
    vars: Object.fromEntries(
      (vars.code === 0 ? vars.stdout.split("\n").filter(Boolean) : []).map(
        (l) => l.split("\t") as [string, string],
      ),
    ),
  };
}

/** What jobs will use for GitHub and the agent: the bot and secrets, or this machine's logins. */
function readiness(repo: string): Check[] {
  const s = repoSettings(repo);
  const bot = Boolean(s.vars.SHIPIFY_BOT_CLIENT_ID) && s.secrets.includes("SHIPIFY_BOT_KEY");
  // The default agent's login (your SHIPIFY_AGENT, else executors.json's: its own, or its
  // gateway's key): the secret its task jobs hand it.
  const agents = loadExecutors();
  const login = loginOf(agents[defaultAgent(agents, s.vars.SHIPIFY_AGENT)]);
  const agent = !login || s.secrets.includes(login.secret);
  // What a task needs to publish a new app (ADR 0026): each stack's deploy secrets and variables,
  // on shipify as a secret or a variable (ADR 0047: your copy's settings live on GitHub).
  const publishing = [
    ...new Set(
      listStacks().flatMap((st) => [
        ...Object.values(st.deploy?.secrets ?? {}),
        ...(st.deploy?.vars ?? []),
      ]),
    ),
  ];
  const lacking = publishing.filter((name) => !s.secrets.includes(name) && !s.vars[name]);
  // The repos App (ADR 0045): needed once you've added another account.
  const accounts = yourAccounts({ SHIPIFY_ACCOUNTS: s.vars.SHIPIFY_ACCOUNTS ?? "" });
  const reposApp =
    Boolean(s.vars.SHIPIFY_REPOS_CLIENT_ID) && s.secrets.includes("SHIPIFY_REPOS_KEY");
  return [
    {
      name: "the bot (a GitHub App) opens PRs",
      ok: bot,
      blocking: false,
      detail: bot
        ? s.vars.SHIPIFY_BOT_SLUG
        : "until then, jobs on a box use that machine's own gh login",
      fix: "pnpm ship bot",
    },
    {
      name: "the repos App (your other accounts) reads and opens PRs there",
      ok: reposApp || !accounts.length,
      blocking: false,
      detail: reposApp
        ? `${s.vars.SHIPIFY_REPOS_SLUG}; your accounts: ${accounts.join(", ") || "none yet"}`
        : accounts.length
          ? `your accounts (${accounts.join(", ")}) need it set up`
          : "only for repos on another of your accounts",
      fix: accounts.length && !reposApp ? "pnpm ship bot repos --yes" : undefined,
    },
    {
      name: `the agent's login is a repo secret (${login?.secret ?? "none needed"})`,
      ok: agent,
      blocking: false,
      detail: agent ? undefined : "until then, jobs on a box use that machine's own agent login",
      fix: login ? "pnpm ship setup agent" : undefined,
    },
    {
      name: `tasks can publish new projects (${publishing.join(", ")})`,
      ok: !lacking.length,
      blocking: false,
      detail: lacking.length
        ? `missing: ${lacking.join(", ")}. A merged plan's build stops before building until they're set`
        : "and the bot needs Variables: Read and write (its page, docs/setup.md)",
      fix: 'pnpm ship setup apps (docs/setup.md, "Publishing new projects from a task")',
    },
  ];
}

/** Only the owner's issues and comments start tasks: task.yml compares against this variable. */
function ensureOwner(repo: string) {
  const who = sourceControl().whoami()?.login;
  if (!who) throw new ShipError("gh isn't logged in. Run: gh auth login", "blocked");
  if (repoSettings(repo).vars.SHIPIFY_OWNER !== who)
    gh(["variable", "set", "SHIPIFY_OWNER", "--repo", repo, "--body", who]);
  return who;
}

function checkAdmin(repo: string) {
  const r = ghRun(["api", `repos/${repo}`, "--jq", '"\\(.permissions.admin) \\(.private)"']);
  const [admin, priv] = r.stdout.trim().split(" ");
  if (admin !== "true")
    throw new ShipError(
      `Your gh login can't manage ${repo}'s runners (needs Administration: write).`,
      "blocked",
    );
  // On a public repo anyone's pull request or issue could reach a box (ADR 0055): never a runner.
  if (priv === "false")
    throw new ShipError(
      `${repo} is public: a box serves only a private copy. Make it private (Settings → General → Danger Zone), then run this again.`,
      "blocked",
    );
}

// ---------------------------------------------------------------- the service

const unitName = (name: string) => `shipify-box-${name}.service`;

/**
 * A slot's systemd unit, the same on every machine: a system service run as the box's own user,
 * `shipify`, which has no sudo. A container has no systemd: it runs the same bin/runsvc.sh as its
 * main process and its runtime restarts it.
 */
export function boxUnit(opts: { name: string; dir: string }): string {
  const { name, dir } = opts;
  return `# The Shipify box ${name} (docs/box-setup.md). Written by \`ship box\`; changes here are replaced.
[Unit]
Description=Shipify box ${name} (a slot: a GitHub runner that runs what the queue hands it, one task at a time)
Wants=network-online.target
After=network-online.target

[Service]
User=shipify
# What the runner writes is its own (setup 5): no agent user can read it.
UMask=0077
WorkingDirectory=${dir}
# GitHub's entry point for a service: it keeps the listener running and applies runner updates.
# bin/ is the copy those updates keep current.
ExecStart=${dir}/bin/runsvc.sh
Restart=always
RestartSec=10
# SIGTERM to runsvc.sh, which asks the runner to cancel its job and stop; whatever is still running
# then is killed, so no leftover listener can take a job twice (actions/runner#3909).
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=5min

[Install]
WantedBy=multi-user.target
`;
}

/** On GitHub: the registrations of a box's slots above `slots` go (their services stopped first). */
function dropSlots(repo: string, name: string, slots: number) {
  for (const x of slotsOf(runners(repo), name))
    if (slotOf(name, x.name) > slots)
      gh(["api", "-X", "DELETE", `repos/${repo}/actions/runners/${x.id}`]);
}

/**
 * On GitHub: the label `sandbox` on each of a box's slots that lacks it (the API adds it to the
 * runner's own labels), once its setup has checked the sandbox. How many slots have it now.
 */
function labelSandbox(repo: string, name: string): number {
  let have = 0;
  for (const x of slotsOf(runners(repo), name)) {
    if (!isSandboxed(x)) {
      const r = ghRun([
        "api",
        "-X",
        "POST",
        `repos/${repo}/actions/runners/${x.id}/labels`,
        "-f",
        `labels[]=${SANDBOX_LABEL}`,
      ]);
      if (r.code !== 0) continue;
    }
    have++;
  }
  return have;
}

// ---------------------------------------------------------------- the machine: over SSH, or this PC

/**
 * Where a box is set up: another machine over SSH, or this PC, with the same steps (ADR 0047). Only
 * the way there differs, and on this PC its SSH settings and its network are left as they are.
 */
interface Machine {
  /** As the plan says it: `user@host`, or "this PC". */
  label: string;
  here: boolean;
  /** A command there, as you; `input` goes to its stdin. */
  sh(cmd: string, input?: string): RunResult;
  /** A command there as root, in this terminal, where sudo asks for your password. */
  asRoot(args: string[]): RunResult;
}

/** A machine never seen before is trusted on first contact; one whose identity changed isn't. */
const SSH = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "StrictHostKeyChecking=accept-new",
];

const overSsh = (target: string): Machine => ({
  label: target,
  here: false,
  sh: (cmd, input) => run("ssh", [...SSH, target, cmd], input === undefined ? {} : { input }),
  asRoot: (args) => run("ssh", ["-t", target, `sudo ${args.join(" ")}`], { inherit: true }),
});

const thisPc = (): Machine => ({
  label: "this PC",
  here: true,
  sh: (cmd, input) => run("bash", ["-c", cmd], input === undefined ? {} : { input }),
  asRoot: (args) => run("sudo", args, { inherit: true }),
});

// ---------------------------------------------------------------- add: a Pi, a VPS, or this PC

/** The address, user and key ssh would use for a target (an alias in ~/.ssh/config, or user@host). */
function sshConfig(target: string): { hostname?: string; user?: string; identity?: string } {
  const r = run("ssh", ["-G", target]);
  const get = (key: string) =>
    r.stdout
      .split("\n")
      .find((l) => l.startsWith(`${key} `))
      ?.slice(key.length + 1)
      .trim();
  return r.code === 0
    ? { hostname: get("hostname"), user: get("user"), identity: get("identityfile") }
    : {};
}

/** What a failed SSH check means, and the command that fixes it. */
export function sshAdvice(
  target: string,
  stderr: string,
  cfg: { hostname?: string; user?: string; identity?: string } = {},
): string {
  const host = cfg.hostname ?? target.split("@").pop() ?? target;
  const login = `${cfg.user ?? target.split("@")[0]}@${host}`;
  if (/IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr))
    return `${target} has a new SSH identity, as after a reinstall. If you reinstalled it, forget the old one with \`ssh-keygen -R ${host}\`, then run this again.`;
  if (/Permission denied/i.test(stderr))
    return (
      `${target} answers, but doesn't have this PC's SSH key yet (a fresh install doesn't). Add it with ` +
      `\`ssh-copy-id -i ${cfg.identity ?? "~/.ssh/id_ed25519"}.pub ${login}\`, which asks for its password once, then run this again. ` +
      'If the key has a passphrase, unlock it first: `eval "$(ssh-agent)" && ssh-add`.'
    );
  if (/Connection refused/i.test(stderr))
    return `${host} is on the network, but SSH isn't on. Turn it on in Raspberry Pi Imager's settings (Services) and write the OS again, or on the machine itself.`;
  if (/timed out|No route to host|Could not resolve|not known|unreachable/i.test(stderr))
    return `Can't reach ${host}: is it on, and on this network? Your router lists its address.`;
  return `Can't reach ${target} over SSH: ${stderr.trim()}`;
}

export function boxAdd(
  target: string | undefined,
  opts: { name?: string; manage?: boolean; replace?: boolean; slots?: string; yes: boolean },
): Result {
  if (target === undefined && opts.manage)
    throw new ShipError(
      "--manage is for a machine you reach over SSH (Tailscale, Cockpit and a firewall): this PC's box needs none of them.",
      "blocked",
    );
  if (target === undefined && process.platform !== "linux")
    throw new ShipError(
      "A box runs Linux: on Windows, inside WSL (Ubuntu, with systemd on).",
      "unsupported",
    );
  if (target !== undefined && !has("ssh"))
    throw new ShipError("Needs ssh on this machine.", "blocked");
  const m = target === undefined ? thisPc() : overSsh(target);
  // Its slots are system services: on WSL, systemd is off until you turn it on.
  if (m.here && m.sh("test -d /run/systemd/system").code !== 0)
    throw new ShipError(
      "systemd isn't running on this PC: on WSL, add [boot] systemd=true to /etc/wsl.conf, run wsl --shutdown in Windows, open Ubuntu again, then run this again.",
      "blocked",
    );
  const repo = platformRepo();
  const probe = m.sh(
    "uname -m; . /etc/os-release; echo $ID $VERSION_ID; hostname -s; awk '/^MemTotal:/{print $2}' /proc/meminfo",
  );
  if (probe.code !== 0)
    throw new ShipError(
      target
        ? sshAdvice(target, probe.stderr, sshConfig(target))
        : `Couldn't read this PC: ${probe.stderr.trim()}`,
      "blocked",
    );
  const [machine, os, hostName, mem] = probe.stdout.trim().split("\n");
  // The machine's own name (Tailscale uses it too), not an IP address typed as the target.
  const host = target?.split("@").pop() ?? "";
  const name = safeName(opts.name ?? hostName ?? host.split(".")[0] ?? host);
  if (machine !== "aarch64" && machine !== "x86_64")
    throw new ShipError(
      `${m.label} is ${machine}; boxes are x86_64 or aarch64 (64-bit).`,
      "unsupported",
    );
  if (!isBoxOs(os ?? ""))
    throw new ShipError(
      `${m.label} runs ${os || "an unknown OS"}; a box runs Ubuntu Server 24.04 LTS (64-bit) or a newer LTS, the one setup Shipify tests (Raspberry Pi OS's kernel is too small for some stacks' tests). Write it fresh, then run this again: docs/box-setup.md.`,
      "unsupported",
    );
  const all = runners(repo);
  const have = slotsOf(all, name);
  // What --slots says, else what the box has, else what its memory fits.
  const asked = parseSlots(opts.slots);
  const memKiB = Number(mem);
  const fits = memKiB > 0 ? slotsFor(memKiB) : DEFAULT_SLOTS;
  const slots = asked ?? (have.length || fits);
  const why =
    asked || have.length || !(memKiB > 0)
      ? ""
      : ` (what its ${(memKiB / 1024 / 1024).toFixed(1)} GB of memory fits)`;
  checkSlotNames(all, name, slots);
  // One name, one machine: a second machine with the same hostname would silently take over the
  // first one's runners. Running box add again on the same machine is fine (it has the service).
  if (!opts.replace && have.length) {
    const same = m.sh(`systemctl cat shipify-box-${name} >/dev/null 2>&1 && echo same`);
    if (same.stdout.trim() !== "same")
      throw new ShipError(
        `Another machine is already the box "${name}". Give this one another name with --name, or take that one's place with --replace.`,
        "blocked",
      );
  }
  const agents = slotNumbers(slots)
    .map((k) => `shipify-agent-${k}`)
    .join(", ");
  const planned = [
    m.here
      ? `run box/setup.sh on this PC, from a folder of its own (made by mktemp -d), with sudo (${os ?? "?"}, ${machine})`
      : `copy box/setup.sh to ${m.label} (into a folder of its own, made by mktemp -d) and run it with sudo (${os ?? "?"}, ${machine})`,
    "it installs git, make, gh, Node and what each stack's doctor checks need",
    `it creates the user "shipify" (no sudo; its home 0700, only its own) and runs ${slots} slot(s)${why}, one task at a time each: the GitHub runners ${slotNumbers(
      slots,
    )
      .map((k) => `"${slotName(name, k)}"`)
      .join(
        ", ",
      )} (labels ${labelsOf(name)}), as the system services shipify-box-${name}${slots > 1 ? `[-2…-${slots}]` : ""} (UMask=0077), with one tool cache for the machine in /opt/shipify/tool`,
    `the sandbox (setup 5): one user per slot for its agent (${agents}), each with its own folder in /srv; one sudo rule, /etc/sudoers.d/shipify-agents, lets the runner run commands as them and no one else (installed only once visudo accepts it)`,
    `then a check that the runner starts each agent without a password, and no agent can read the runner's folders, its environment or another slot's runs (on WSL, nor open Windows' drives or start Windows programs: it prints the fix for /etc/wsl.conf); once it passes, the label "${SANDBOX_LABEL}" on each slot, so task runs can go to them`,
    ...have
      .filter((r) => slotOf(name, r.name) > slots)
      .map((r) => `it removes the slot "${r.name}": its service, its folder and its registration`),
    `the one-hour registration tokens go${m.here ? "" : " over SSH"} into a file only the setup reads, never printed, and are deleted after use`,
    m.here
      ? "this PC's SSH settings and network stay as they are"
      : "SSH takes keys only (no passwords, no root), once your account there has a key: the change is checked first, and left out if sshd doesn't accept it",
    ...(opts.manage
      ? [
          "--manage: Tailscale (installed, and signed in at a link it prints, if it isn't yet), and Cockpit, which listens on the machine itself only and is shared with your own devices by tailscale serve",
          "--manage: a firewall, once Tailscale is up: in through Tailscale, and SSH from the machine's own network; out as before. Rules are added, never reset (undo: sudo ufw disable)",
        ]
      : []),
  ];
  if (!opts.yes)
    return {
      command: "box add",
      status: "requires-approval",
      summary: `would set up ${m.label} as the box "${name}"`,
      plannedActions: planned,
      checks: readiness(repo),
      nextSteps: [
        `pnpm ship box add${target ? ` ${target}` : ""}${opts.name ? ` --name ${opts.name}` : ""}${opts.manage ? " --manage" : ""}${opts.replace ? " --replace" : ""}${asked ? ` --slots ${asked}` : ""} --yes`,
      ],
    };
  checkAdmin(repo);
  ensureOwner(repo);
  // Setup restarts a slot whose service or settings changed, which would stop its task.
  const busy = have.filter((r) => r.busy);
  if (busy.length)
    throw new ShipError(
      `${busy.map((r) => r.name).join(", ")} is running a task: run this again when it's done (pnpm ship box list).`,
      "blocked",
    );
  // Each stack's doctor checks, and the fixes the box runs as root when one fails.
  const checks = new Map(listStacks().flatMap((s) => s.doctor.map((d) => [d.name, d] as const)));
  const prep = [...checks.values()]
    .map((d) => `${d.name}\t${d.run}\t${(d.fix ?? "").replace(/^sudo /, "")}`)
    .join("\n");
  // A folder of its own there (mktemp -d: 0700, a name nobody could have made first), so no other
  // user on the machine, an agent's included, can read or swap the setup's files.
  const made = m.sh("mktemp -d");
  const tmp = made.stdout.trim();
  if (made.code !== 0 || !/^\/[\w./-]+$/.test(tmp))
    throw new ShipError(
      `Couldn't make a folder for the setup on ${m.label}: ${made.stderr.trim()}`,
    );
  // Every file goes in on stdin, the script too: nothing is on a command line.
  const put = (file: string, body: string) =>
    m.sh(`umask 077 && cat > ${file}`, body.endsWith("\n") ? body : `${body}\n`);
  // One registration token per slot: a slot that's already registered leaves its token unused.
  const env = [
    `RUNNER_URL=https://github.com/${repo}`,
    `RUNNER_NAME=${name}`,
    `RUNNER_LABELS=${labelsOf(name)}`,
    `RUNNER_SLOTS=${slots}`,
    `RUNNER_TOKENS="${slotNumbers(slots)
      .map(() => registrationToken(repo))
      .join(" ")}"`,
    ...(opts.manage ? ["SHIPIFY_MANAGE=1"] : []),
    ...(m.here ? ["SHIPIFY_HERE=1"] : []),
  ].join("\n");
  // One definition for every slot: setup.sh fills in each slot's name and folder.
  const unit = boxUnit({ name: "@SLOT_NAME@", dir: "@SLOT_DIR@" });
  if (
    put(`${tmp}/setup.sh`, readFileSync(join(PLATFORM_ROOT, "box", "setup.sh"), "utf8")).code !==
      0 ||
    put(`${tmp}/box.env`, env).code !== 0 ||
    put(`${tmp}/prep.tsv`, prep).code !== 0 ||
    put(`${tmp}/box.service`, unit).code !== 0
  ) {
    m.sh(`rm -rf ${tmp}`);
    throw new ShipError(`Couldn't send the setup files to ${m.label}.`);
  }
  const r = m.asRoot([
    "bash",
    `${tmp}/setup.sh`,
    `${tmp}/box.env`,
    `${tmp}/prep.tsv`,
    `${tmp}/box.service`,
  ]);
  m.sh(`rm -rf ${tmp}`);
  if (r.code !== 0)
    throw new ShipError(
      `The setup on ${m.label} failed (see above), so its slots have no sandbox label and take no task runs. It's safe to run again.`,
    );
  dropSlots(repo, name, slots);
  // Its sandbox checked out (setup.sh's last step): task runs can go to its slots.
  const labelled = labelSandbox(repo, name);
  // A slot's runner takes a few seconds to reach GitHub after its service starts: wait for them.
  let online = 0;
  for (let tries = 0; tries < 6; tries++) {
    online = slotsOf(runners(repo), name).filter((x) => x.status === "online").length;
    if (online >= slots) break;
    run("sleep", ["5"]);
  }
  // Its console (Cockpit, through Tailscale), for `box list`. Not signed in to
  // Tailscale yet: the next `box add --manage` records it.
  let web: string | undefined;
  if (opts.manage) {
    const ts = m.sh("tailscale status --json");
    try {
      const dns = (JSON.parse(ts.stdout) as { Self?: { DNSName?: string } }).Self?.DNSName;
      if (dns) {
        web = `https://${dns.replace(/\.$/, "")}`;
        setConsole(repo, name, web);
      }
    } catch {
      web = undefined;
    }
  }
  return ok(
    "box add",
    `${m.label} is the box "${name}", ${online} of ${slots} slot(s) online, ${labelled} with the sandbox label`,
    {
      data: web ? `  Console (Cockpit): ${web}` : undefined,
      checks: readiness(repo),
      nextSteps: [
        'ask "how is this box doing?" (a task, or the bot) to check it',
        "pnpm ship box list",
        ...(opts.manage ? ["open the Cockpit address it printed, on your phone or PC"] : []),
      ],
    },
  );
}

// ---------------------------------------------------------------- this machine's box

/** This machine's slots, by name: its shipify-box-* system services, which box add made. */
function slotsHere(): string[] {
  const r = run("systemctl", ["list-unit-files", "shipify-box-*", "--no-legend", "--plain"]);
  return r.stdout
    .split("\n")
    .map((l) => /^shipify-box-(.+)\.service\b/.exec(l.trim())?.[1])
    .filter((n): n is string => Boolean(n))
    .sort();
}

/**
 * This machine's box (the only one here, or the one named) and its slots, slot 1 first: the same
 * on a Pi, a VPS or this PC, as box add sets each up.
 */
function localBox(name?: string): { box: string; slots: string[] } {
  const here = slotsHere();
  // A slot `<box>-<k>` belongs to its box; what's left are the boxes.
  const boxes = here.filter((n) => !here.some((o) => o !== n && slotOf(o, n) > 1));
  if (name && !boxes.includes(name))
    throw new ShipError(
      `No box called ${name} on this machine${boxes.length ? ` (here: ${boxes.join(", ")})` : ""}.`,
      "blocked",
    );
  const box = name ?? (boxes.length === 1 ? boxes[0] : undefined);
  if (!box)
    throw new ShipError(
      boxes.length
        ? `This machine has ${boxes.join(", ")}: name one.`
        : "This machine isn't a box: pnpm ship box add --yes makes this PC one; for a Pi or VPS, run this there.",
      "blocked",
    );
  const slots = here
    .filter((n) => slotOf(box, n) > 0)
    .sort((x, y) => slotOf(box, x) - slotOf(box, y));
  return { box, slots };
}

/**
 * The box's slots on GitHub, and the task each busy one runs. Best effort: empty when GitHub
 * can't be reached.
 */
function onGitHub(box: string): { runner: Runner; job?: string }[] {
  try {
    const repo = platformRepo();
    const slots = slotsOf(runners(repo), box);
    if (!slots.some((r) => r.busy)) return slots.map((runner) => ({ runner }));
    const runs = ghJson<{
      workflow_runs: { id: number; display_title: string; html_url: string }[];
    }>(["api", `repos/${repo}/actions/runs?status=in_progress&per_page=50`]).workflow_runs;
    const on = new Map<string, string>();
    for (const r of runs)
      for (const j of ghJson<{ jobs: { runner_name: string | null }[] }>([
        "api",
        `repos/${repo}/actions/runs/${r.id}/jobs`,
      ]).jobs)
        if (j.runner_name) on.set(j.runner_name, `${r.display_title} (${r.html_url})`);
    return slots.map((runner) => ({
      runner,
      job: runner.busy ? (on.get(runner.name) ?? "a job") : undefined,
    }));
  } catch {
    return [];
  }
}

export function boxStatus(name?: string): Result {
  const { box, slots } = localBox(name);
  const github = onGitHub(box);
  const service = (unit: string) => {
    const state = run("systemctl", ["is-active", unit]).stdout.trim() || "unknown";
    const boot = run("systemctl", ["is-enabled", unit]).stdout.trim() === "enabled";
    return `${state}${boot ? ", starts with the machine" : ", off at boot"}`;
  };
  const rows = slots.map((slot) => {
    const there = github.find((g) => g.runner.name === slot);
    const state = there ? (there.runner.busy ? "busy" : there.runner.status) : "not on GitHub";
    return `  ${slot.padEnd(14)} ${service(unitName(slot)).padEnd(34)} ${state}${there?.job ? `: ${there.job}` : ""}`;
  });
  const busy = github.filter((g) => g.runner.busy).length;
  const online = github.filter((g) => g.runner.status === "online").length;
  return ok("box status", `${box}: ${rows.length} slot(s), ${online} online, ${busy} busy`, {
    data: [`  ${"SLOT".padEnd(14)} ${"SERVICE".padEnd(34)} GITHUB`, ...rows].join("\n"),
    nextSteps: ["pnpm ship box logs --follow", "pnpm ship box peek --follow"],
  });
}

/** Its services, every slot at once, as root: sudo asks for your password here. */
function services(action: string[], slots: string[]) {
  const r = run("sudo", ["systemctl", ...action, ...slots.map(unitName)], { inherit: true });
  if (r.code !== 0)
    throw new ShipError(`Couldn't ${action.join(" ")} the box's services (see above).`);
}

export function boxStart(name?: string): Result {
  const { box, slots } = localBox(name);
  services(["enable", "--now"], slots);
  return ok("box start", `${box} is on, and starts with the machine. Waiting runs begin now`);
}

/** stop: off until `box start`, even after a restart. restart: off and on again. Every slot. */
export function boxStop(
  action: "stop" | "restart",
  name: string | undefined,
  yes: boolean,
): Result {
  const { box, slots } = localBox(name);
  const jobs = onGitHub(box).filter((g) => g.job);
  if (jobs.length && !yes)
    return {
      command: `box ${action}`,
      status: "requires-approval",
      summary: `${box} is running ${jobs.map((g) => g.job).join(", ")}`,
      plannedActions: [
        `${action} ${box}: ${jobs.length === 1 ? "that run stops and its task shows" : "those runs stop and their tasks show"} failed (comment "continue" after)`,
      ],
      nextSteps: [`pnpm ship box ${action} ${box} --yes`],
    };
  services(action === "stop" ? ["disable", "--now"] : ["restart"], slots);
  return ok(
    `box ${action}`,
    action === "stop"
      ? `${box} is off until pnpm ship box start. Tasks wait for a box`
      : `${box} restarted`,
  );
}

/** The services' log, every slot together: the last 40 lines, or --follow. */
export function boxLogs(name: string | undefined, follow: boolean): Result {
  const { box, slots } = localBox(name);
  run(
    "journalctl",
    [
      ...slots.flatMap((slot) => ["-u", unitName(slot)]),
      "--no-pager",
      ...(follow ? ["-f"] : ["-n", "40"]),
    ],
    { inherit: true },
  );
  return ok("box logs", box);
}

/** What the agent is doing now (box/peek.mjs). */
export function boxPeek(follow: boolean): Result {
  run("node", [join(PLATFORM_ROOT, "box", "peek.mjs"), ...(follow ? ["--follow"] : [])], {
    inherit: true,
  });
  return ok("box peek", "done");
}

/**
 * A machine's health (lib/box-facts.ts): this one, or another over SSH, where the file goes to its
 * Node on stdin and nothing is installed or left behind.
 */
export function boxHealth(target: string | undefined): Result {
  if (!target) {
    process.stdout.write(`${factLines(boxFacts())}\n`);
    return ok("box health", hostname());
  }
  const source = readFileSync(join(PLATFORM_ROOT, "cli", "lib", "box-facts.ts"), "utf8");
  const r = run(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      target,
      "node --input-type=module-typescript",
    ],
    { input: `${source}\nconsole.log(factLines(boxFacts()));\n` },
  );
  if (r.code !== 0)
    throw new ShipError(
      /node: (command )?not found|input-type/.test(r.stderr)
        ? `${target} needs Node 22.18 or newer: \`pnpm ship box add ${target}\` sets it up.`
        : sshAdvice(target, r.stderr, sshConfig(target)),
      "blocked",
    );
  process.stdout.write(r.stdout);
  return ok("box health", target);
}

// ---------------------------------------------------------------- list, remove

/**
 * Each box's web console (`box add --manage` records Cockpit's address), as a repo variable:
 * {"<box>": "https://…"}. Any console works; nothing here is Cockpit-only.
 */
const CONSOLES = "SHIPIFY_CONSOLES";

function consoles(repo: string): Record<string, string> {
  const r = ghRun(["variable", "get", CONSOLES, "-R", repo]);
  if (r.code !== 0) return {};
  try {
    const v = JSON.parse(r.stdout) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function setConsole(repo: string, box: string, url: string | undefined) {
  const all = consoles(repo);
  if (url) all[box] = url;
  else if (box in all) delete all[box];
  else return;
  ghRun(["variable", "set", CONSOLES, "-R", repo, "--body", JSON.stringify(all)]);
}

/** One row per box: its slots grouped by its label (ADR 0020). */
export function boxList(): Result {
  const all = runners(platformRepo()).filter(isBoxRunner);
  const web = consoles(platformRepo());
  const names = [...new Set(all.map(boxOf))].sort();
  const rows = names.map((box) => {
    const slots = all.filter((r) => boxOf(r) === box);
    const online = slots.filter((r) => r.status === "online");
    const busy = online.filter((r) => r.busy).length;
    const state = !online.length ? "offline" : busy === online.length ? "busy" : "online";
    const off = slots.length - online.length;
    const sandbox = slots.some(isSandboxed) ? "" : ", no sandbox";
    const detail = `${slots.length} slot(s)${busy ? `, ${busy} busy` : ""}${online.length && off ? `, ${off} offline` : ""}${sandbox}`;
    return `  ${box.padEnd(16)} ${state.padEnd(8)} ${detail.padEnd(36)} ${(slots[0]?.os ?? "").padEnd(8)} ${web[box] ?? ""}`.trimEnd();
  });
  const up = names.filter((box) =>
    all.some((r) => boxOf(r) === box && r.status === "online"),
  ).length;
  return ok("box list", `${names.length} box(es), ${up} online`, {
    data: names.length
      ? [
          `  ${"NAME".padEnd(16)} ${"STATE".padEnd(8)} ${"SLOTS".padEnd(36)} ${"OS".padEnd(8)} CONSOLE`,
          ...rows,
        ].join("\n")
      : "  none yet: pnpm ship box add --yes (this PC), or pnpm ship box add <user@host> --yes",
    checks: readiness(platformRepo()),
  });
}

export function boxRemove(name: string, yes: boolean): Result {
  const repo = platformRepo();
  const all = runners(repo);
  const found = slotsOf(all, name);
  // Its services on this machine, when it's this machine's box: stopped here, with sudo.
  const here = slotsHere().filter((n) => slotOf(name, n) > 0);
  if (!found.length && !here.length)
    throw new ShipError(`No box called ${name}. See: pnpm ship box list`, "blocked");
  const units = (found.length ? found.map((r) => r.name) : [name]).map((n) => `shipify-box-${n}`);
  const planned = [
    ...found.map((r) => `remove the runner "${r.name}" from ${repo}`),
    ...(here.length
      ? [
          `stop its services here, so they stop restarting: sudo systemctl disable --now (asks for your password)`,
        ]
      : []),
  ];
  // A Pi or VPS keeps its services until they're stopped on the machine itself.
  const onMachine = here.length
    ? []
    : [
        `on the machine, so its services stop restarting: sudo systemctl disable --now ${units.join(" ")}`,
      ];
  if (!yes)
    return {
      command: "box remove",
      status: "requires-approval",
      summary: `would remove the box "${name}"`,
      plannedActions: planned,
      nextSteps: [`pnpm ship box remove ${name} --yes`, ...onMachine],
    };
  if (here.length) services(["disable", "--now"], here);
  for (const r of found) gh(["api", "-X", "DELETE", `repos/${repo}/actions/runners/${r.id}`]);
  setConsole(repo, name, undefined);
  return ok("box remove", `removed "${name}"`, { nextSteps: onMachine });
}
