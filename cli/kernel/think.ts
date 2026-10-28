// Think (ADR 0031): the agent's step, and the only one where project code runs. On a box it runs as
// the slot's own Linux user (lib/sandbox.ts) in a fresh folder: its own clone, a read-only copy of
// Shipify's tools and skills, the owner's files. It holds the agent's login and read-only keys, and
// nothing that can write. What it leaves (result.json, files, its commits as a git bundle) is taken
// back into the runner's own folder once every process of the agent's is stopped.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { tryOr } from "../commands/task/context.ts";
import { readNotebook } from "../commands/task/notebook.ts";
import {
  canonicalJson,
  errorLine,
  MAX_FILES_OUT,
  maskSecrets,
  modelFacts,
  modelLookup,
} from "../contracts/index.ts";
import { accountOf } from "../lib/accounts.ts";
import { adapterOf, heldTo, loginOf, modelLabel, readExecutors } from "../lib/agents.ts";
import { ADD_ALL_BUT_CHECKOUTS } from "../lib/checkouts.ts";
import { cloneArgs, gitConfig, githubUrl, keyFor } from "../lib/clones.ts";
import { PLATFORM_ROOT } from "../lib/config.ts";
import { copyValues } from "../lib/generate.ts";
import { ghRun, platformRepo } from "../lib/github.ts";
import { notebookSection, pagesFor } from "../lib/notebook.ts";
import type { Adapter, AgentReport, SessionUsed } from "../lib/plugins/agent.ts";
import { repoFor } from "../lib/projects-on-github.ts";
import type { RunDetails } from "../lib/runs.ts";
import { onBox } from "../lib/sandbox.ts";
import { loadTools } from "../lib/tools.ts";
import { choiceFor, defaultAgent, executors, promptTools, Stopwatch, taskChoice } from "./agent.ts";
import { laterWords } from "./decide.ts";
import { hash8 } from "./keys.ts";
import { familyLines } from "./parts.ts";
import { binDir, type Place, placeFor } from "./place.ts";
import { asksOf, buildPrompt, coverEach } from "./prompt.ts";
import { type ReadIo, readRepos } from "./reads.ts";
import { RESULT_VERSION, Result, readResult, saidAs, stopWords } from "./result.ts";
import type { Said, Snapshot, Stop, Think, ThinkMeta } from "./types.ts";

// Each of think's steps stops at its own clock. Together they're the most a think can take, which
// task.yml's job limit covers (tests/workflows.test.ts): a run never outgrows its own job.
const CLONE_MINUTES = 5;
const LAYOUT_MINUTES = 5;
const SETUP_MINUTES = 15;
/** The session's clock (ADR 0059): the first ask and your words taken in share it. */
const AGENT_MINUTES = 200;
/** The fix round's own clock, when the box's checks fail. */
const FIX_MINUTES = 20;
const RULES_MINUTES = 2;
const VERIFY_MINUTES = 25;
const GIT_MINUTES = 2;
/** What you wrote while it worked is taken in only with this much of the agent's clock left. */
const CATCH_UP_MINUTES = 5;
/** A stay's turn on a project: it answers, and a change goes to a work run (ADR 0060). */
export const STAY_WORK_NOTE = (project: string) =>
  `This turn comes from a stay, which pushes nothing. Answer as before; if they ask for a change, change no files: say in \`text\` what you'll change, and set \`work\` to {"project": "${project}", "brief": "…"}. A work run on this task's branch does it, with the whole thread.`;
/** How often a run reads its task for your `stop` while the agent works: one small read. */
const STOP_EVERY_MS = 60_000;
/** `ship refresh` on a box: the CLI's start, a merge, and `make version` twice. */
const REFRESH_MINUTES = 5;
/** The clone, a new repo's layout and setup; a branch behind main refreshed, and the way back if
 * it stops; the agent and its fix round; the checks (its PR's rules, then make verify), twice with
 * the fix round; three git steps (is there a main, the work-in-progress commit, the bundle); and
 * the finish after it (ADR 0059): main fetched, refreshed, checked once more, bundled again. */
export const THINK_MINUTES =
  CLONE_MINUTES +
  LAYOUT_MINUTES +
  SETUP_MINUTES +
  REFRESH_MINUTES +
  GIT_MINUTES +
  AGENT_MINUTES +
  FIX_MINUTES +
  2 * (RULES_MINUTES + VERIFY_MINUTES) +
  3 * GIT_MINUTES +
  (CLONE_MINUTES + REFRESH_MINUTES + RULES_MINUTES + VERIFY_MINUTES + 2 * GIT_MINUTES);
/** A merge left half-done (the agent stopped mid-merge), dropped: conflict markers are never kept. */
const DROP_HALF_MERGE =
  'if [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then git merge --abort; fi';
/**
 * The agent's settings made fresh before an ask, as the agent: every path after $1 removed (made
 * writable first: a read-only folder may hold what a run put there), and those after the first $1
 * made again, empty and read-only.
 */
const FRESH =
  'n=$1; shift; chmod -R u+w -- "$@" 2>/dev/null; rm -rf -- "$@" || exit 1; shift "$n"; [ "$#" -eq 0 ] || mkdir -p -m 555 -- "$@"';
/** The most of its handoff the task's status keeps (ADR 0041). */
export const HANDOFF_MAX = 2_000;
/** The lines of failed checks the reply shows and the agent is told: a test runner's summary. */
const VERIFY_TAIL = 60;
const CHECK_SECONDS = 60;
const CHECK_MAX = 4 * 1024;
const BUNDLE_MAX = 100 * 1024 * 1024;
/** The result's JSON Schema, for an agent that can give its final answer in it. */
const RESULT_SCHEMA = JSON.stringify(z.toJSONSchema(Result, { target: "draft-7", io: "input" }));

export interface ThinkOut {
  /** The runner's own folder with what the agent left: result.json, its files, work.bundle. */
  out: string;
  meta: ThinkMeta;
  details?: RunDetails;
}

/**
 * Secrets the agent gets: its login (its own, or its gateway's key: on a box the job hands it over
 * as SHIPIFY_AGENT_LOGIN, named by plan's `login`), and the read-only keys it holds: GitHub's for
 * its repos, and the tools' look keys. Never a write key, never the run's own.
 * - A read run (ADR 0044) holds none: a repo outside your account is data, and the run holds
 *   nothing of yours for it to reach.
 * - A run on another of your accounts (ADR 0045) holds that account's key, and no tool's.
 */
export function agentSecrets(
  login: string | undefined,
  hold: { github?: string; tools?: boolean } = {
    github: process.env.SHIPIFY_AGENT_READ_TOKEN,
    tools: true,
  },
): Record<string, string> {
  const value = process.env.SHIPIFY_AGENT_LOGIN || (login ? process.env[login] : undefined);
  // The tools' look keys, as tools.json names them, for their MCP servers: the agent's config
  // names each as ${VAR}, which stays as written when the agent doesn't hold it.
  const look = hold.tools
    ? Object.values(loadTools()).flatMap((t) => Object.values(t.keys).map((k) => k.look ?? ""))
    : [];
  return {
    ...(login && value ? { [login]: value } : {}),
    ...(hold.github ? { GH_TOKEN: hold.github } : {}),
    ...Object.fromEntries(
      look.flatMap((k) => (k && process.env[k] ? [[k, process.env[k] as string]] : [])),
    ),
  };
}

/**
 * How the agent gets its login (`login`, its name in `secrets`): on fd 3, a pipe it reads once, with
 * the variables its adapter names for reading it there (loginFromPipe), so it's never in its
 * environment for a command it runs to read. An agent that can't read it there gets it in its
 * environment, as before, with its other keys.
 */
export function handOver(
  secrets: Record<string, string>,
  login: string | undefined,
  adapter: Pick<Adapter, "loginFromPipe"> | undefined,
): { secrets: Record<string, string>; login?: string; env: Record<string, string> } {
  const value = login ? secrets[login] : undefined;
  const env = login && value ? adapter?.loginFromPipe?.(login) : undefined;
  if (!login || !value || !env) return { secrets, env: {} };
  const keys = { ...secrets };
  delete keys[login];
  return { secrets: keys, login: value, env };
}

/**
 * The GitHub key a run holds for its repos: the repos App's for a run on another of your accounts
 * (ADR 0045, minted for that account's repos only), else the bot's read-only one.
 */
export const runKey = (t: Pick<Think, "account">) =>
  (t.account ? process.env.SHIPIFY_ACCOUNT_READ_TOKEN : process.env.SHIPIFY_AGENT_READ_TOKEN) ||
  undefined;

/**
 * The name a run's commits carry (ADR 0045): the App that pushes them, as GitHub shows its bot
 * (`<slug>[bot]`, with its noreply address), so a PR's commits read as Shipify's. The bot on
 * Shipify's own account, the repos App on another of yours; off a box, with neither named, the
 * box's own.
 */
export function committer(t: Pick<Think, "account">): { name: string; email: string } {
  const slug = t.account ? process.env.SHIPIFY_REPOS_SLUG : process.env.SHIPIFY_BOT_SLUG;
  if (!slug || !/^[A-Za-z0-9][A-Za-z0-9-]{0,33}$/.test(slug))
    return { name: "Shipify", email: "shipify@users.noreply.github.com" };
  const r = ghRun(["api", `users/${slug}%5Bbot%5D`, "--jq", ".id"], { timeoutMs: 20_000 });
  const id = r.code ? "" : r.stdout.trim();
  return {
    name: `${slug}[bot]`,
    email: /^\d+$/.test(id)
      ? `${id}+${slug}[bot]@users.noreply.github.com`
      : `${slug}[bot]@users.noreply.github.com`,
  };
}

export interface ThinkIn {
  /** The owner's files for this run (the runner's folder). */
  files: string;
  /** The runner's folder that gets what the agent left. */
  keep: string;
  /** Off a box: the folder the agent works in. */
  local: string;
  /** What the run found about the owner's files, for the agent. */
  notes?: string[];
  /** The task's words written since the run read it (on a box: one read of GitHub); none off it. */
  later?: () => Said[];
  /** The files on words it takes in before it answers, fetched into `files`: notes for the agent.
   * Without it, words with a file wait for the next run. */
  fetch?: (said: Said[]) => Promise<string[]>;
  /** How often `later` is read for your `stop` while the agent works. */
  everyMs?: number;
  /** How the repos it reads are sized and the disk read (tests stand in for GitHub). */
  readIo?: ReadIo;
  /**
   * A stay's turn (ADR 0057): the agent's session this run's earlier ask left, carried on in the
   * run's folder as it is, with only the words it answers now. Nothing is cloned or read again.
   */
  resume?: string;
  /** The agent's minutes, when fewer than its own clock: a stay's turn ends within its job's time. */
  minutes?: number;
  /** What the resumed session had counted (ThinkMeta.used): this turn counts only what's new. */
  used?: SessionUsed;
  /** A gateway's public answer, read with no key: what the run's model takes (none: not read). */
  look?: (url: string) => Promise<string | null>;
}

export async function think(s: Snapshot, t: Think, io: ThinkIn): Promise<ThinkOut> {
  const timing = new Stopwatch(io.resume ? io.used : undefined);
  const place = placeFor(s.run.id.replace(/[^A-Za-z0-9._-]/g, "-"), io.local, Boolean(io.resume));
  rmSync(io.keep, { recursive: true, force: true });
  mkdirSync(io.keep, { recursive: true });
  const env = runEnv(s);
  const keep = (name: string, body: string | Buffer) => writeFileSync(join(io.keep, name), body);
  try {
    // A check: its reviewed script, as the agent's user, with no keys and a minute at most. The agent
    // follows only when the repeat asks (a recipe with a check) and the output changed.
    let checked: ThinkMeta | undefined;
    if (t.check) {
      const c = await check(place, t.check, env, keep, io.keep);
      if (!t.thenAsk || !c.meta.checkHash || c.meta.checkHash === t.thenAsk.was) return c;
      checked = c.meta;
    }

    // What the agent may read: the owner's files, and a read-only copy of Shipify at this run's
    // commit (its tools, skills, playbooks and checks, and the CLI for local commands).
    const copy = shipifyCopy();
    /** Whether you sent files for this run: then its in/files holds them. */
    const sentFiles = () => existsSync(io.files) && readdirSync(io.files).length > 0;
    const giveFiles = () => {
      const given = existsSync(io.files) ? readdirSync(io.files) : [];
      place.give(
        Object.fromEntries(given.map((f) => [`in/files/${f}`, readFileSync(join(io.files, f))])),
      );
    };
    giveFiles();
    // The run's notes name its files where the agent reads them: its in/files, not the runner's.
    const asGiven = (note: string) =>
      io.files ? note.split(io.files).join(join(place.in, "files")) : note;

    // Its clone: of the project or repo it changes (its task branch, refreshed with main). Cloned
    // as the agent's user, with its read-only key; a talk run clones nothing up front.
    // The agent this task runs (executors.json), and what every agent shares: the commands it must
    // never run and its gateway.
    const executor = taskChoice(s.state).agent ?? defaultAgent();
    const harness = readExecutors();
    const ex = executors()[executor];
    const adapter = ex ? adapterOf(ex) : undefined;
    const gateway = ex?.gateway ? harness.gateways[ex.gateway] : undefined;
    const reading = t.profile === "read";
    // A run on another of your accounts (ADR 0045) holds that repo's key and Shipify's rules, and
    // none of the tools, nor of the notebook but that repo's own page (ADR 0047): that account's
    // repos are written by others too.
    const away = Boolean(t.account);
    const key = runKey(t);
    const login = loginOf(ex, harness.gateways)?.secret;
    const held = handOver(
      agentSecrets(login, reading ? {} : { ...(key ? { github: key } : {}), tools: !away }),
      login,
      adapter,
    );
    const notes = [
      ...t.notes,
      ...(io.notes ?? []).map(asGiven),
      ...(checked
        ? [
            `The check \`${t.check}\` ran first and its output changed. It now says:\n${checked.checkOutput ?? ""}`,
          ]
        : []),
    ];
    // Main moved past the task's branch (a sibling task's PR merged first): the box brings it up to
    // date with `ship refresh`, as the PC does: main merged, both changelogs kept, change docs
    // renumbered, the version bump redone. Where refresh stops (a real conflict), the clone goes
    // back to the branch as it was, so the agent never starts inside a half-done merge.
    // A stay's turn carries on in what the run's first ask had: its clone and the repos it read.
    const cloned = io.resume ? { behind: false } : await clone(place, s, t, env);
    // The repos it reads (ADR 0044): cloned now, into read/, before the agent starts.
    if (t.reads?.length && !io.resume)
      notes.push(...(await readRepos(place, t.reads, env, io.readIo, key)));
    // A repo that keeps its own rules has no `ship refresh` (no version bump of Shipify's to redo):
    // its default branch is merged its own way, by the agent.
    const trunk = t.base ?? "main";
    if (cloned.behind && t.ownRules)
      notes.push(
        `\`${trunk}\` moved past this task's branch: merge \`origin/${trunk}\` into your clone (\`git merge origin/${trunk}\`), keeping both changes where they meet, before you ask for the PR.`,
      );
    else if (cloned.behind) {
      const r = await refresh(place, copy.cli, env, cloned.head);
      notes.push(
        r.ok
          ? `Main moved past this task's branch, so the box brought it up to date with \`<ship> refresh\`, as on the PC: ${r.said}. Run the project's checks again before you ask for the PR.`
          : `Main moved past this task's branch, and refreshing it stopped: ${r.said}. Run \`<ship> refresh ${place.work} --no-fetch\` yourself; where it stops, keep both changes and remove the conflict markers, then run it again, not a plain \`git commit\`: it finishes the merge and redoes the version bump.`,
      );
    }
    // A repo with no default branch yet: a new project, whose first push goes to main.
    const newRepo =
      t.profile === "work" &&
      Boolean(t.project) &&
      (
        await place.run(["git", "rev-parse", "--verify", "--quiet", `origin/${trunk}`], {
          cwd: place.work,
          minutes: GIT_MINUTES,
          env,
        })
      ).code !== 0;
    // A merged plan's publish run, into its new, empty repo: the box lays the stack's files out
    // first (`ship build --into`), so the agent builds on them as on the PC.
    if (newRepo && t.project && s.state.built === t.project) {
      const laid = await place.run(
        [...copy.cli.split(" "), "build", t.project, "--into", place.work],
        { cwd: place.work, minutes: LAYOUT_MINUTES, env },
      );
      if (laid.code !== 0)
        notes.push(
          `The box couldn't lay out the stack's files: run \`<ship> build ${t.project} --into ${place.work}\` first.`,
        );
    }
    // A project's own setup (its make targets); a repo that keeps its own rules is set up its own
    // way, by the agent, as its docs say.
    // A stay's turn carries on in the clone its run set up.
    if (t.profile === "work" && !t.ownRules && !io.resume) await setUp(place, env);

    // The prompt, and the agent.
    const base = ex?.task ?? ex?.command;
    if (!ex || !base?.length || !adapter)
      throw new Error(`the agent "${executor}" can't run unattended here (executors.json)`);
    // The model and effort, held to what the model takes as its gateway's catalog says, read now.
    const chosen = choiceFor(executor, taskChoice(s.state));
    const lookup = ex.gateway && chosen.model ? modelLookup(ex.gateway, chosen.model) : undefined;
    const facts =
      lookup && chosen.effort && io.look && ex.gateway && chosen.model
        ? modelFacts(ex.gateway, await io.look(lookup), chosen.model)
        : undefined;
    const choice = heldTo(chosen, facts?.efforts, ex);
    // Your words after the newest the run read (ADR 0021): read once more as the agent starts (the
    // clone and setup take a while), for a `stop` while it works, and again before it answers. What
    // it takes in is read: 👀 on it with the reply, and the next run starts after it.
    const later = io.later;
    let after = Math.max(s.state.seen, ...s.said.map((c) => c.id));
    const caughtUp: number[] = [];
    const takeIn = (said: Said[]) => {
      caughtUp.push(...said.map((c) => c.id));
      after = Math.max(after, ...said.map((c) => c.id));
    };
    // Their files (a screenshot) fetched beside the run's own, and named where the agent reads them.
    const filesOf = async (said: Said[]) => {
      if (!io.fetch) return [];
      const fetched = await io
        .fetch(said)
        .catch((e: Error) => [
          `The files on these messages couldn't be fetched (${e.message}): say so in your reply.`,
        ]);
      if (fetched.length) giveFiles();
      return fetched.map(asGiven);
    };
    // A stay's turn starts a moment after its plan read the task, with no clone or setup between:
    // what came since is taken in before it answers.
    const early =
      later && !io.resume
        ? tryOr(() => laterWords(later(), after, Boolean(io.fetch)).plain, [])
        : [];
    if (early.length) {
      notes.push(...(await filesOf(early)));
      takeIn(early);
    }
    const nb = tryOr(readNotebook, undefined);
    const pages =
      nb && !reading
        ? pagesFor(nb.pages, {
            repos: s.repos.map((r) => r.name),
            on: [t.project, ...(t.reads ?? []).map((r) => r.name)].filter((n): n is string =>
              Boolean(n),
            ),
            away,
          })
        : [];
    const conversation = [...s.said, ...early]
      .filter((c) => c.author !== "other")
      .map((c) => ({
        who: c.author === "run" ? "Shipify" : "the owner",
        at: c.at,
        text: c.text,
        isNew: t.fresh.includes(c.id) || caughtUp.includes(c.id),
      }));
    // Every ask this run covers, so each catch-up lists them all again, not only the newest.
    // A stay's turn answers only its new words (ADR 0057): what came before was answered.
    const fresh = [...s.said.filter((c) => t.fresh.includes(c.id)), ...early];
    let asks = io.resume
      ? fresh.map((c) => c.text.trim())
      : asksOf({ why: t.why, body: s.issue.body, title: s.issue.title, conversation });
    const prompt = buildPrompt({
      repo: platformRepo(),
      n: s.n,
      title: s.issue.title,
      body: s.issue.body,
      parsed: s.parsed,
      why: t.why,
      profile: t.profile,
      ...(t.project ? { project: t.project } : {}),
      state: s.state,
      conversation,
      paths: {
        work: place.work,
        files: join(place.in, "files"),
        out: place.out,
        result: join(place.out, "result.json"),
        shipify: copy.root,
        ship: copy.cli,
        read: place.read,
      },
      ...(t.ownRules ? { ownRules: true } : {}),
      // The repos it may clone itself: its account's alone (ADR 0045), as its key reaches no other.
      ...(t.profile === "talk"
        ? {
            repos: s.repos
              .filter((r) => (t.account ? accountOf(r.repo) === t.account : !r.name.includes("/")))
              .map((r) => ({ name: r.name, repo: r.repo })),
          }
        : {}),
      notes,
      // Your notebook is yours: a read run (ADR 0044) gets none of it, so nothing private is in
      // reach. A repo's own page goes only to runs on that repo, and a run on another of your
      // accounts gets that page alone (ADR 0047), adding nothing to it.
      ...(pages.length || (nb && !reading && !away)
        ? { notebook: notebookSection(pages, { canWrite: !away }) }
        : {}),
      // A read run has no tool's calls (ADR 0044), nor a run on another account: none to name.
      ...(reading || away ? {} : { tools: promptTools(executor) }),
      ...(t.account ? { account: t.account } : {}),
      ...(t.base ? { base: t.base } : {}),
      playbook: readFileSync(join(PLATFORM_ROOT, "playbooks", "task.md"), "utf8"),
      ...(t.recipe ? { recipe: t.recipe } : {}),
      // A split task's parent and parts (ADR 0066), as plan read them: data, but for its parent's goal.
      ...(s.family && !reading ? { family: familyLines(s) } : {}),
      thinksWith: [adapter.name, choice.model ?? "its default model", choice.effort]
        .filter(Boolean)
        .join(" · ")
        .concat(choice.auto.model && choice.auto.effort ? " (Auto)" : " (the owner's `use`)"),
    });
    // The adapter writes its tool settings in a folder of the runner's; the agent gets a copy in
    // its own in/tools/, and the command names that.
    const toolsDir = join(io.keep, "..", "tools");
    rmSync(toolsDir, { recursive: true, force: true });
    // The run's folders as its adapter names them: its HOME, its own (config), its settings (tools).
    const own = { home: place.home, config: place.config, tools: join(place.in, "tools") };
    const inRun = (d: string) => d.startsWith(`${place.dir}/`);
    // Shipify's skills (ADR 0038), for every agent its own way: a flag its adapter adds, or a link
    // where it reads its own, made as the agent. None for a read run: nothing of Shipify's.
    const skillsDir = join(copy.root, "skills");
    const skills = !reading && existsSync(skillsDir) ? skillsDir : undefined;
    const link = skills ? adapter.skillsLink?.(own) : undefined;
    // What its agent reads its rules or code from that a command could write (its settings folder,
    // and what its adapter names), and the folders it wants read-only: inside the run's folders.
    const cleared = [own.tools, ...(adapter.cleared?.(own) ?? [])].filter(inRun);
    const fixed = (adapter.readOnly?.(own) ?? []).filter(inRun);
    const argvFor = (resume?: string) =>
      adapter
        .argv({
          command: base,
          ...(choice.model ? { model: choice.model } : {}),
          effort: choice.effort,
          // The read profile (ADR 0044): no command, no web, no tool's calls; else executors.json's.
          ...(reading
            ? { commands: { deny: harness.commands?.deny ?? [], web: false, run: false } }
            : harness.commands
              ? { commands: harness.commands }
              : {}),
          ...(gateway && ex.gateway ? { gateway: { ...gateway, id: ex.gateway } } : {}),
          config: place.config,
          tools: { mode: "look", dir: toolsDir, root: copy.root, ...(away ? { only: [] } : {}) },
          resultSchema: RESULT_SCHEMA,
          // A work run's folder is its clone: your files, its copy of Shipify and its out/ are
          // outside it. A read run reads its repos (its working folder) and your files, when you
          // sent some, and nothing of Shipify's; it writes nothing.
          folders: reading
            ? { read: sentFiles() ? [join(place.in, "files")] : [] }
            : { read: [copy.root, place.in], write: [place.out] },
          ...(skills ? { skills } : {}),
          ...(resume ? { resume } : {}),
        })
        .map((a) => a.split(toolsDir).join(join(place.in, "tools")));
    const argv = argvFor();
    // Its settings made fresh before every ask (the first, each catch-up, the fix round), as the
    // agent: what it reads its rules or code from removed, its read-only folders made again, empty,
    // then its settings and Shipify's skills given again. A run can't change the rules a later ask
    // starts with: not in its settings folder, nor in a file its agent reads beside them.
    const giveSettings = async () => {
      const made = await place.run(
        ["/bin/sh", "-c", FRESH, "fresh", String(cleared.length), ...cleared, ...fixed],
        { cwd: place.dir, minutes: 1, env },
      );
      if (made.code !== 0) throw new Error("the agent's settings couldn't be made fresh");
      const settings = existsSync(toolsDir) ? readdirSync(toolsDir) : [];
      place.give({
        ...Object.fromEntries(
          settings.map((f) => [`in/tools/${f}`, readFileSync(join(toolsDir, f))]),
        ),
        ...(skills && link ? { [relative(place.dir, link)]: { link: skills } } : {}),
      });
    };
    let stopBy: Said | undefined;
    // What the run's details say besides the agent's own; a read of your words that failed while
    // it worked is one, told once, never dropped (ADR 0059).
    const checkNotes: string[] = [];
    const tell = (note: string) => checkNotes.includes(note) || checkNotes.push(note);
    // One ask of the agent: the prompt, what you wrote since, or what to fix, in the same session.
    // While it works, the task is read now and then for your `stop`, which stops all of it.
    const agentMinutes = Math.min(io.minutes ?? AGENT_MINUTES, AGENT_MINUTES);
    const ask = async (args: string[], stdin: string, minutes = agentMinutes) => {
      await giveSettings();
      const reader = adapter.reader();
      const started = performance.now();
      const bin = binDir(args[0] ?? "");
      const halt = new AbortController();
      const watch =
        later &&
        setInterval(() => {
          // Once stopped, it's read no more: the agent is ending, however long that takes.
          if (stopBy) return;
          let stop: Said | undefined;
          try {
            stop = laterWords(later(), after).stop;
          } catch (e) {
            tell(`Your \`stop\` couldn't be read while it worked: ${maskSecrets(errorLine(e))}.`);
          }
          if (stop) {
            stopBy = stop;
            halt.abort();
          }
        }, io.everyMs ?? STOP_EVERY_MS);
      const outcome = await place
        .run(args, {
          ...(bin ? { path: [bin] } : {}),
          cwd: t.profile === "work" ? place.work : reading ? place.read : place.dir,
          stdin,
          minutes,
          secrets: held.secrets,
          ...(held.login !== undefined ? { login: held.login } : {}),
          env: {
            ...env,
            ...(adapter.env?.(own) ?? {}),
            ...held.env,
          },
          signal: halt.signal,
          onLine: (line) => {
            try {
              const shown = reader.line(line);
              if (shown !== undefined) process.stderr.write(`${shown}\n`);
            } catch {}
          },
        })
        .finally(() => watch && clearInterval(watch));
      const report = tryOr(() => reader.report(), {});
      // An agent that doesn't say its version runs the one executors.json pins.
      report.version ??= ex.install?.version;
      if (outcome.timedOut) report.error ??= `it ran for ${minutes} minutes and was stopped`;
      timing.ran(executor, choice, { report, secs: (performance.now() - started) / 1000 });
      if (!place.stop()) throw new Error("the agent left processes that couldn't be stopped");
      return { outcome, report };
    };
    // A stay's turn carries on in the place as the last turn left it (ADR 0057): a result.json
    // there is that answer, never this one's (#462).
    const before = io.resume ? place.take("result.json")?.toString("utf8") : undefined;
    const written = () => {
      const file = place.take("result.json");
      return file && file.toString("utf8") !== before ? file : undefined;
    };
    const began = performance.now();
    // A stay on a project pushes nothing (ADR 0060): a change it's asked for goes to a work run.
    // What it commits anyway is measured from where its turn began: the run before it already
    // pushed what came earlier, which its clone's origin/<branch> doesn't know (ADR 0063).
    let from: string | undefined;
    if (io.resume && t.profile === "work" && t.project) {
      notes.push(STAY_WORK_NOTE(t.project));
      await place.run(["git", "rev-parse", "--verify", "--quiet", "HEAD"], {
        cwd: place.work,
        minutes: GIT_MINUTES,
        env,
        onLine: (l) => {
          from = l.trim() || from;
        },
      });
    }
    const { outcome, report } = io.resume
      ? await ask(argvFor(io.resume), nextPrompt(fresh, notes))
      : await ask(argv, prompt);
    // Its command never started (exec's 126: not the agent's to run; 127: not there): said as that,
    // never as an agent that stopped early.
    if ((outcome.code === 126 || outcome.code === 127) && !written()) {
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "think.unstartable", code: outcome.code })}\n`,
      );
      keep(
        "result.json",
        canonicalJson({
          v: 2,
          state: "failed",
          text: `The agent couldn't start on this box: its command ${outcome.code === 126 ? "isn't the agent's user's to run" : "isn't there"} (exit ${outcome.code}). This is the box's setup, not your task: \`pnpm ship doctor\` on the box says what's wrong; then reply \`continue\`.`,
        }),
      );
      keep("meta.json", JSON.stringify({ readOutside: false, touchesWorkflows: false }));
      return {
        out: io.keep,
        meta: { readOutside: false, touchesWorkflows: false },
        details: timing.details(t.why, "the agent couldn't start"),
      };
    }

    // What it left, taken back: the file it wrote this time, else its final answer in the result's
    // schema (an adapter that can). A file that doesn't read is stale when its final answer does:
    // the agent fixed what its schema refused (#506, ADR 0061).
    const answer = (r: typeof report) => {
      const file = written();
      const final = r.result !== undefined ? Buffer.from(JSON.stringify(r.result)) : undefined;
      const reads = (b: Buffer) => !("error" in readResult(b.toString("utf8")));
      return file && final && !reads(file) && reads(final) ? final : (file ?? final);
    };
    const raw = answer(report);
    let result = readResult(raw?.toString("utf8"));
    if (raw) keep("result.json", raw);
    let touchesWorkflows = false;
    // A question answered in words, not in the result's shape (a smaller model): its words are the
    // reply. A change still needs the result, with what it asks for, so it fails as before.
    if (!raw && t.profile !== "work" && report.said && !report.error) {
      result = { v: RESULT_VERSION, state: "done", text: report.said };
      keep("result.json", canonicalJson(result));
      checkNotes.push("It answered in words, not in its result's shape: its words are the reply.");
    }

    // What you wrote while it worked, taken in before anything is posted: given to the same session
    // while its clock has time left, then the task read again, until nothing new came in (no round
    // count, ADR 0060), so one reply covers it all. Their files are fetched first. Words the next
    // run must read itself (a fixed word, a `use`…) wait for it, as before, and the details say so.
    let session = report.session;
    // The file in its place now: a catch-up round's answer is a file only when it differs.
    let last = place.take("result.json")?.toString("utf8");
    let waiting = 0;
    for (;;) {
      if (!later || stopBy || !session || "error" in result) break;
      let late: ReturnType<typeof laterWords> | undefined;
      try {
        late = laterWords(later(), after, Boolean(io.fetch));
      } catch (e) {
        tell(
          `What you wrote while it worked couldn't be read before it answered: ${maskSecrets(errorLine(e))}. The next run reads it.`,
        );
      }
      const plain = late?.plain ?? [];
      waiting = plain.length + (late?.waiting ?? 0);
      const left = agentMinutes - (performance.now() - began) / 60_000;
      if (!plain.length || left < CATCH_UP_MINUTES) break;
      // Their files first: a read run's folders, made with its arguments, take them in too.
      const fetched = await filesOf(plain);
      const more = await ask(
        argvFor(session),
        catchUpPrompt(plain, fetched, asks),
        Math.floor(left),
      );
      // Its new answer, not the file it left before.
      const file = place.take("result.json")?.toString("utf8");
      const next = readResult(
        more.report.result !== undefined
          ? JSON.stringify(more.report.result)
          : file !== last
            ? file
            : undefined,
      );
      if (stopBy || "error" in next) break;
      // The PR it asked for first stands, unless it asks again.
      result = { ...next, pr: next.pr ?? result.pr };
      keep("result.json", canonicalJson(result));
      last = file;
      session = more.report.session ?? session;
      takeIn(plain);
      asks = [...asks, ...plain.map((c) => c.text.trim())];
      waiting = late?.waiting ?? 0;
    }
    if (io.resume && !stopBy && !("error" in result))
      checkNotes.push(
        "The run stayed after its last answer (ADR 0057): this one came from the same session, with no new run.",
      );
    if (caughtUp.length && !stopBy && !("error" in result))
      checkNotes.push(
        `It took in ${caughtUp.length === 1 ? "the message" : `${caughtUp.length} messages`} you sent while it worked, before it answered.`,
      );
    if (waiting && !stopBy)
      checkNotes.push(
        `${waiting === 1 ? "A message" : `${waiting} messages`} you sent while it worked ${waiting === 1 ? "waits" : "wait"} for the next run, which starts by itself.`,
      );
    // Your `stop`: no answer and no PR. What it committed is kept, as when it stops by itself.
    const halted = () => {
      if (!stopBy) return;
      result = { error: "you said stop" };
      rmSync(join(io.keep, "result.json"), { force: true });
    };
    halted();

    // A repo that keeps its own rules has no project checks (ADR 0044): its own CI checks the PR.
    if (t.profile === "work" && !t.ownRules && !("error" in result) && result.pr) {
      // The box's checks before its commits go anywhere, the same `ship pr` makes (ADR 0018). When
      // they fail, the agent gets one round, in the same session, to fix what they found.
      let g = await gate(place, copy.cli, env);
      if (!g.ok && !g.timedOut && session && !stopBy) {
        const fixed = await ask(argvFor(session), fixPrompt(g.tail), FIX_MINUTES);
        // Its new answer, when it gave one; the PR it asked for stands either way.
        const next = readResult(
          (fixed.report.result !== undefined
            ? Buffer.from(JSON.stringify(fixed.report.result))
            : place.take("result.json")
          )?.toString("utf8"),
        );
        if (!("error" in next)) result = { ...next, pr: next.pr ?? result.pr };
        g = await gate(place, copy.cli, env);
        checkNotes.push(
          g.ok
            ? "The box's checks failed once; the agent fixed it in the same session."
            : "The box's checks failed, and again after the agent's one round to fix them.",
        );
      }
      const pr = result.pr;
      if (!g.ok && pr) {
        // Its commits are kept on the task's branch for the next run (no PR opens), except a new
        // project's first push: that goes to main, which deploys, so it waits for checks that pass.
        const publish = pr.kind === "publish";
        result = {
          ...result,
          state: "failed",
          pr: publish ? undefined : pr,
          text: `The box's checks failed${g.timedOut ? ` (they ran for ${VERIFY_MINUTES} minutes)` : ""}, so no PR was opened. Reply \`continue\` to try again, or say what to change.${g.tail ? `\n\n<details><summary>The end of their output</summary>\n\n\`\`\`\n${g.tail}\n\`\`\`\n\n</details>` : ""}\n\n${saidAs(result.text)}`,
        };
      }
      keep("result.json", canonicalJson(result));
      halted();
    }
    // The agent's commits, bundled for apply: for the PR it asked for, or, from a work run that
    // failed, stopped or asks you something with none, to keep on the task's branch (decide says
    // where they go). Edits it hadn't committed go in first, as one commit.
    // A slip in its answer's shape, with its session alive, isn't a stop: it finished, the reply says
    // what didn't fit, and the run stays for your next words (ADR 0061).
    const stopped: Stop | undefined = stopBy
      ? { why: "asked", comment: stopBy.id }
      : "error" in result && !(result.wrong && session)
        ? stopOf(outcome, report, modelBy(report.model ?? choice.model, adapter.name, gateway))
        : undefined;
    const failed = "error" in result || result.state === "failed";
    const asked = !("error" in result) && Boolean(result.pr);
    // A question mid-change (ADR 0041): its work waits on the task's branch for your answer.
    const waits = !("error" in result) && result.state === "needs-you" && !result.pr;
    let commits = false;
    if (t.profile === "work" && t.project && (asked || failed || waits)) {
      if (failed || waits)
        await place.run(
          [
            "sh",
            "-c",
            // Never a half-done merge: dropped first, so what was committed stays.
            // Never a checkout inside the clone (a helper's worktree): ADR 0041.
            `${DROP_HALF_MERGE}; ${ADD_ALL_BUT_CHECKOUTS} && { git diff --cached --quiet || git commit -q -m "$1"; }`,
            "sh",
            `Work in progress: ${stopped ? stopWords(stopped) : waits ? "waiting on your answer" : "the agent couldn't finish"}`,
          ],
          { cwd: place.work, minutes: GIT_MINUTES, env },
        );
      const changed = await bundle(place, s, from);
      place.stop();
      const b = place.take("work.bundle", BUNDLE_MAX);
      if (b) keep("work.bundle", b);
      commits = Boolean(b) && changed.length > 0;
      touchesWorkflows = changed.some((f) => f.startsWith(".github/workflows/"));
    }
    if (!("error" in result))
      for (const f of (result.files ?? []).slice(0, MAX_FILES_OUT)) {
        const name = f.split("/").pop() ?? "";
        const body = place.take(name);
        if (body) keep(name, body);
      }
    // Outside content, from every ask (the first, each catch-up, the fix round): the tools whose
    // look calls (tool.call) it made, and anything else (ADR 0049): what the adapter says its agent
    // read, a check (it reads the web), a read profile's repos.
    const all = timing.report;
    const looked = [
      ...new Set(
        Object.keys(all.tools ?? {})
          .filter((x) => x.includes("."))
          .map((x) => x.split(".")[0] as string),
      ),
    ];
    const elsewhere = reading || Boolean(checked) || Boolean(all.readOutside);
    const readOutside = elsewhere || looked.length > 0;
    // Its handoff (ADR 0041): the file it keeps as it works, taken however the run ended.
    const handoff = handoffOf(place.take("handoff.md", 64 * 1024)?.toString("utf8"));
    const meta: ThinkMeta = {
      readOutside,
      ...(looked.length ? { looked } : {}),
      ...(elsewhere ? { elsewhere } : {}),
      touchesWorkflows,
      ...(checked?.checkHash
        ? { checkOutput: checked.checkOutput, checkHash: checked.checkHash }
        : {}),
      ...(stopped ? { stopped } : {}),
      ...(caughtUp.length && !stopBy ? { caughtUp } : {}),
      ...(commits ? { commits } : {}),
      ...(commits && newRepo ? { firstPush: true } : {}),
      ...(handoff ? { handoff } : {}),
      ...(session ? { session } : {}),
      ...(session && timing.sessionUsed ? { used: timing.sessionUsed } : {}),
      ...(io.resume ? { stayed: true as const } : {}),
    };
    keep("meta.json", JSON.stringify(meta));
    return { out: io.keep, meta, details: timing.details(t.why, "thought", checkNotes) };
  } finally {
    place.stop();
  }
}

/** The model a run's agent thought with, for its error: "Sonnet", "glm-5.3-flash at openrouter.ai". */
export function modelBy(
  model: string | undefined,
  agent: string,
  gateway?: { url: string },
): string {
  // A gateway's model keeps its own name; an agent's own ("sonnet") reads as a name.
  const name = !model
    ? agent
    : model.includes("/")
      ? modelLabel(model)
      : modelLabel(model).replace(/^./, (c) => c.toUpperCase());
  return `${name}${gateway ? ` at ${new URL(gateway.url).hostname}` : ""}`;
}

/** A handoff as the status keeps it: masked, and cut to HANDOFF_MAX. None when it's empty. */
export function handoffOf(text: string | undefined): string | undefined {
  const t = maskSecrets(text ?? "").trim();
  if (!t) return undefined;
  return t.length > HANDOFF_MAX ? `${t.slice(0, HANDOFF_MAX - 1).trimEnd()}…` : t;
}

/**
 * Why the agent stopped with no answer: your plan's limit (its own report says so), its clock, a
 * crash, or an answer that didn't read; the last two with what it ended on, when its report says
 * (`by`: the model that said it).
 */
export function stopOf(
  outcome: { code: number; timedOut: boolean },
  report: Pick<AgentReport, "limits" | "error">,
  by = "The agent",
): Stop {
  const used = report.limits?.find((l) => l.rejected);
  if (used)
    return { why: "plan", window: used.window, ...(used.resets ? { resets: used.resets } : {}) };
  if (outcome.timedOut) return { why: "clock", minutes: AGENT_MINUTES };
  const error = report.error ? { error: { by, said: report.error } } : {};
  if (outcome.code !== 0) return { why: "crash", code: outcome.code, ...error };
  return { why: "no-answer", ...error };
}

/** A check's run: its script's output, cut and masked, as the result. */
async function check(
  place: Place,
  name: string,
  env: Record<string, string>,
  keep: (name: string, body: string) => void,
  out: string,
): Promise<ThinkOut> {
  const script = join(shipifyCopy().root, "checks", `${name}.mjs`);
  let output = "";
  const r = existsSync(script)
    ? await place.run(["node", script], {
        cwd: place.work,
        minutes: CHECK_SECONDS / 60,
        env,
        onLine: (l) => {
          if (output.length < CHECK_MAX) output += `${l}\n`;
        },
      })
    : { code: 1, timedOut: false };
  place.stop();
  output = maskSecrets(output.slice(0, CHECK_MAX)).trim();
  const ok = r.code === 0;
  keep(
    "result.json",
    canonicalJson({
      v: 2,
      state: ok ? "done" : "failed",
      text: ok
        ? output || "(no output)"
        : `The check ${name} failed${r.timedOut ? " (it ran for more than a minute)" : existsSync(script) ? "" : ` (there's no checks/${name}.mjs)`}.`,
    }),
  );
  const meta = {
    readOutside: true,
    touchesWorkflows: false,
    ...(ok ? { checkOutput: output, checkHash: hash8(output) } : {}),
  };
  return { out, meta };
}

/** What a run's own commands start with: its `<ship>` calls name your Shipify repo as the run
 * does, and lay out a project with your copy's settings (ADR 0047), so no file says them. */
const runEnv = (s: Snapshot) => ({
  LANG: "C.UTF-8",
  SHIPIFY_TASK: String(s.n),
  GITHUB_REPOSITORY: platformRepo(),
  ...copyValues(),
});

/**
 * The task's branch brought up to date with main by `ship refresh`, as the PC does: main merged,
 * both changelogs kept, change docs renumbered, the version bump redone. Where it stops (a real
 * conflict), the clone goes back to `head`, as it was: never left inside a half-done merge.
 */
async function refresh(
  place: Place,
  cli: string,
  env: Record<string, string>,
  head: string | undefined,
): Promise<{ ok: boolean; said: string }> {
  let out = "";
  const r = head
    ? await place.run([...cli.split(" "), "refresh", place.work, "--no-fetch", "--json"], {
        cwd: place.work,
        minutes: REFRESH_MINUTES,
        env,
        onLine: (l) => {
          out += `${l}\n`;
        },
      })
    : { code: 1, timedOut: false };
  const res = tryOr(
    () => JSON.parse(out) as { status?: string; summary?: string; checks?: { name: string }[] },
    {},
  );
  if (r.code === 0 && res.status === "succeeded")
    return { ok: true, said: maskSecrets(res.summary ?? "") };
  if (head) await backTo(place, head, env);
  const files = (res.checks ?? []).map((c) => c.name).join(", ");
  return {
    ok: false,
    said: `${maskSecrets(res.summary ?? "it didn't run")}${files ? ` (${files})` : ""}`,
  };
}

/** The clone back to a commit, with no half-done merge or refresh left behind. */
const backTo = (place: Place, head: string, env: Record<string, string>) =>
  place.run(
    [
      "sh",
      "-c",
      `${DROP_HALF_MERGE}; rm -f "$(git rev-parse --git-dir)/SHIPIFY_REFRESH"; git reset -q --hard "$1"`,
      "sh",
      head,
    ],
    { cwd: place.work, minutes: GIT_MINUTES, env },
  );

/**
 * The finish (ADR 0059): after a work run's agent, in its run's folder, with a read key minted
 * after it (SHIPIFY_READ_TOKEN). When main moved past the branch while the agent worked, the box
 * brings it up to date as a run's start does, runs its checks again and bundles it again, so the
 * PR opens up to date. Where refresh or the checks stop, the branch stays as the agent left it,
 * and its PR opens from that, as before; the note says so. No agent runs here: a conflict is the
 * next run's, from your `continue`.
 */
export async function finish(
  s: Snapshot,
  t: Think,
  io: { keep: string; local: string },
): Promise<{ note?: string; changed?: string[] }> {
  const place = placeFor(s.run.id.replace(/[^A-Za-z0-9._-]/g, "-"), io.local, true);
  const done = await upToDate(place, s, t, io.keep).catch((e) => ({
    note: `The branch couldn't be brought up to date with main: ${maskSecrets(errorLine(e))}. ${AS_LEFT}`,
  }));
  // As after the agent: nothing of its user's left running before a write key is minted.
  if (!place.stop()) throw new Error("the finish left processes that couldn't be stopped");
  return done;
}

const AS_LEFT =
  "Its PR opens as the agent left it: reply `continue`, and the next run brings it up to date first.";

/** The finish's work: main fetched; behind it, refreshed, checked and bundled again (see finish). */
async function upToDate(
  place: Place,
  s: Snapshot,
  t: Think,
  keep: string,
): Promise<{ note?: string; changed?: string[] }> {
  const env = runEnv(s);
  const cli = shipifyCopy().cli;
  const key = process.env.SHIPIFY_READ_TOKEN;
  let said = "";
  await place.run(
    [
      "sh",
      "-c",
      'git fetch --quiet origin "$1" && { git merge-base --is-ancestor "origin/$1" work || echo "BEHIND $(git rev-parse HEAD)"; }',
      "sh",
      t.base ?? "main",
    ],
    {
      cwd: place.work,
      minutes: CLONE_MINUTES,
      secrets: key ? gitConfig([keyFor(key)]) : {},
      env: { ...env, GIT_TERMINAL_PROMPT: "0" },
      onLine: (l) => {
        said += `${l}\n`;
      },
    },
  );
  const head = /^BEHIND ([0-9a-f]{40,64})$/m.exec(said)?.[1];
  if (!head) return {};
  const r = await refresh(place, cli, env, head);
  if (!r.ok)
    return {
      note: `Main moved while it worked, and refreshing the branch stopped: ${r.said}. ${AS_LEFT}`,
    };
  if (!(await gate(place, cli, env)).ok) {
    await backTo(place, head, env);
    return {
      note: `Main moved while it worked; brought up to date, the box's checks failed. ${AS_LEFT}`,
    };
  }
  const changed = await bundle(place, s);
  const b = place.take("work.bundle", BUNDLE_MAX);
  if (!b)
    return {
      note: `Main moved while it worked, and the branch couldn't be bundled again. ${AS_LEFT}`,
    };
  writeFileSync(join(keep, "work.bundle"), b);
  return {
    note: "Main moved while it worked, so the box brought the branch up to date (`ship refresh`) and checked it again before its PR.",
    changed,
  };
}

/**
 * A change run's clone, made as the agent's user, of the project or repo it changes: its whole
 * history, as always (ADR 0044). The run's read key reaches git through its environment (on stdin,
 * never on a command line) and the clone alone: the agent's own git needs none, since the clone
 * has every object. Behind: main has
 * moved past the task's branch, whose commit is `head` (none if it couldn't be read).
 */
async function clone(
  place: Place,
  s: Snapshot,
  t: Think,
  env: Record<string, string>,
): Promise<{ behind: boolean; head?: string }> {
  if (t.profile !== "work" || !t.project) return { behind: false };
  const branch = s.state.branch ?? "";
  const trunk = t.base ?? "main";
  const plain = /^[A-Za-z0-9._/-]{1,200}$/;
  if (branch && !plain.test(branch)) throw new Error("the task's branch isn't a plain name");
  if (!plain.test(trunk))
    throw new Error(
      `the repo's default branch, \`${trunk.slice(0, 80)}\`, isn't a name the box takes (letters, digits, \`.\`, \`_\`, \`/\` and \`-\`): rename it on GitHub (Settings → Branches), then ask again`,
    );
  const key = runKey(t);
  const by = committer(t);
  const script = [
    "set -e",
    // The URL, the branches and the commits' name are arguments ($1 to $5), never pasted in.
    `${cloneArgs("change", '"$1"', "work").join(" ")}`,
    "cd work",
    // The task's branch (whether its repo's default branch has moved past it is said); else that
    // branch; else, in a new project's empty repo, a first branch of its own.
    'if [ -n "$2" ] && git ls-remote --exit-code --heads origin "$2" >/dev/null 2>&1; then git fetch --quiet origin "$2"; git checkout --quiet -B work "origin/$2"; if git rev-parse --quiet --verify "origin/$3" >/dev/null; then git merge-base --is-ancestor "origin/$3" work || echo "BEHIND $(git rev-parse HEAD)"; fi; elif git rev-parse --quiet --verify "origin/$3" >/dev/null; then git checkout --quiet -B work "origin/$3"; else git checkout --quiet --orphan work; fi',
    'git config user.name "$4" && git config user.email "$5"',
  ].join("\n");
  let said = "";
  const url = githubUrl(repoFor(t.project, s.repos));
  await place.run(["sh", "-c", script, "sh", url, branch, trunk, by.name, by.email], {
    cwd: place.dir,
    minutes: CLONE_MINUTES,
    secrets: key ? gitConfig([keyFor(key)]) : {},
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    onLine: (l) => {
      said += `${l}\n`;
    },
  });
  const behind = /^BEHIND ?(\S*)$/m.exec(said);
  const head = behind?.[1];
  return { behind: Boolean(behind), ...(head && /^[0-9a-f]{40,64}$/.test(head) ? { head } : {}) };
}

/**
 * The project's own setup, as the agent in its run (the stack contract's `make setup`: its
 * packages, and whatever its checks need, like a test browser), since the runner's caches are
 * walled off from the agent's user. A failure here shows in verify.
 */
async function setUp(place: Place, env: Record<string, string>): Promise<void> {
  await place.run(["sh", "-c", "make setup >/dev/null 2>&1 || true"], {
    cwd: place.work,
    minutes: SETUP_MINUTES,
    env,
  });
}

/**
 * The box's checks on the agent's clone, as the agent's user, before anything is pushed: what its
 * PR needs besides tests (`ship pr --check`, quick), then the project's `make verify`. Their output
 * goes to the run's log, and its end comes back, so a failure says why.
 */
export async function gate(
  place: Place,
  cli: string,
  env: Record<string, string>,
): Promise<{ ok: boolean; timedOut: boolean; tail: string }> {
  const lines: string[] = [];
  const onLine = (l: string) => {
    // In the run's log as it goes (masked), and its end for the reply and the agent.
    process.stderr.write(`${maskSecrets(l)}\n`);
    lines.push(l);
    if (lines.length > VERIFY_TAIL) lines.shift();
  };
  const tail = () => maskSecrets(lines.join("\n")).trim();
  const rules = await place.run(["sh", "-c", `${cli} pr "$1" --check 2>&1`, "sh", place.work], {
    cwd: place.work,
    minutes: RULES_MINUTES,
    env,
    onLine,
  });
  place.stop();
  if (rules.code !== 0) return { ok: false, timedOut: false, tail: tail() };
  lines.length = 0;
  const v = await place.run(["sh", "-c", "make verify 2>&1"], {
    cwd: place.work,
    minutes: VERIFY_MINUTES,
    env,
    onLine,
  });
  place.stop();
  return { ok: v.code === 0, timedOut: v.timedOut, tail: tail() };
}

/** What the agent is told when the box's checks failed on its work. */
export const fixPrompt = (tail: string) =>
  [
    "The box's checks failed on your work, so nothing has been pushed yet. The end of their output:",
    "",
    "```",
    tail || "(no output)",
    "```",
    "",
    "Fix the cause in your clone: the change, its tests, its version or its docs. Never skip, weaken or delete a check to pass it. Commit, then give your result again as before.",
  ].join("\n");

/**
 * What the agent is told in a stay's turn (ADR 0057): the owner's words since its last reply, which
 * was posted, in the same session. One reply covers each of them.
 */
export const nextPrompt = (said: Said[], notes: string[] = []) =>
  [
    "The owner read your reply and wrote again. These messages are instructions, as the NEW ones were (oldest first):",
    "",
    ...said.map((c) => `- the owner, ${c.at}:\n${c.text.trim().replace(/^/gm, "  ")}`),
    "",
    ...(notes.length ? ["Notes from the box:", ...notes.map((n) => `- ${n}`), ""] : []),
    ...coverEach(said.map((c) => c.text.trim())),
    "Give your result as before, in the same shape: one reply to what they asked now.",
  ].join("\n");

/** What the agent is told of the words you wrote while it worked, before anything is posted. */
export const catchUpPrompt = (said: Said[], files: string[] = [], before: string[] = []) =>
  [
    "While you worked, the owner wrote more. Nothing of yours has been posted yet, so take it in now: these messages are instructions, as the NEW ones were (oldest first):",
    "",
    ...said.map((c) => `- the owner, ${c.at}:\n${c.text.trim().replace(/^/gm, "  ")}`),
    "",
    ...(files.length ? ["Their files:", ...files.map((f) => `- ${f}`), ""] : []),
    ...coverEach([...before, ...said.map((c) => c.text.trim())]),
    "Change the work if they ask for it (commit as before), then give your whole result again as before: one reply that covers what they asked before and now.",
  ].join("\n");

/** The agent's commits as a bundle in out/, made by the agent; the files they change. `from`: a
 * stay's turn's start, so only that turn's commits go. */
async function bundle(place: Place, s: Snapshot, from?: string): Promise<string[]> {
  const base = from ?? (s.state.branch ? `origin/${s.state.branch}` : "origin/main");
  let changed = "";
  await place.run(
    [
      "sh",
      "-c",
      // Against the task's branch, else main; a new project's first commits go whole.
      `b=${base}; git rev-parse --verify --quiet "$b" >/dev/null || b=origin/main; if git rev-parse --verify --quiet "$b" >/dev/null; then git diff --name-only "$b"..work; git bundle create --quiet ${place.out}/work.bundle work --not "$b"; else git ls-files; git bundle create --quiet ${place.out}/work.bundle work; fi`,
    ],
    {
      cwd: place.work,
      minutes: GIT_MINUTES,
      onLine: (l) => {
        changed += `${l}\n`;
      },
    },
  );
  return changed.split("\n").filter(Boolean);
}

/**
 * A read-only copy of Shipify for the agent (ADR 0031): on a box, the workflow makes one per commit
 * in the box's shared tools, readable by the agents' users, and names it (SHIPIFY_COPY). Off a box
 * (tests, this PC), the checkout itself. On a box the CLI the agent starts is the one the copy's
 * step built, `node <copy>/cli/dist/ship.mjs` (ADR 0051 B1): one file, no packages to install in
 * the copy. Off a box it's the source through `ship.mjs`, which needs no build.
 */
export function shipifyCopy(): { root: string; cli: string } {
  const copy = process.env.SHIPIFY_COPY;
  const root = onBox() && copy && existsSync(copy) ? copy : PLATFORM_ROOT;
  const built = join(root, "cli", "dist", "ship.mjs");
  const cli = onBox() && existsSync(built) ? built : join(root, "cli", "ship.mjs");
  return { root, cli: `node ${cli}` };
}
