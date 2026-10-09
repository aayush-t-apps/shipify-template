import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOT_PERMISSIONS,
  botManifest,
  exchangeCode,
  REPOS_PERMISSIONS,
} from "../cli/commands/bot.ts";
import { boxOf, boxUnit, slotDir, slotName, slotOf, sshAdvice } from "../cli/commands/box.ts";
import {
  freeFile,
  saveAttachments,
  saveLinkedFiles,
  slotWorkspaces,
  whereThisRuns,
} from "../cli/commands/task.ts";
import { addToPrBody, CHECKED_MARK } from "../cli/commands/workspace.ts";
import {
  ADD_ALL_BUT_CHECKOUTS,
  gitTakesPathspecFiles,
  strayCheckouts,
} from "../cli/lib/checkouts.ts";
import { helpGuide, useTimeZone, wordOf } from "../cli/contracts/index.ts";
import {
  mergeChangelogBlocks,
  reopenChangelog,
  resolveChangelogConflicts,
  unreleased,
} from "../cli/lib/docs.ts";
import { loadForms, readForm } from "../cli/lib/form-reader.ts";
import { FORMS_DIR, setFormProjects } from "../cli/lib/forms.ts";
import { describeSchedule, nextRun, parseSchedule, type Schedule } from "../cli/lib/repeat.ts";
import {
  attachmentsIn,
  branchFor,
  type Comment,
  findStatus,
  MARK,
  newState,
  nextBranch,
  parseTask,
  parseTitle,
  renderStatus,
  repeatForm,
  taskForm,
} from "../cli/lib/task.ts";
import { cleanupsUnderWay, lastDueRun } from "../cli/lib/watch.ts";
import { ROOT, type Sandbox, sandbox, ship } from "./helpers.ts";

const read = (f: string) => readFileSync(f, "utf8");
const json = (f: string) => JSON.parse(read(f));
/** The real task forms, from this repo's templates. */
const FORMS = loadForms(FORMS_DIR);

describe("the watch's runs (ADR 0019)", () => {
  const run = (
    title: string,
    status: string,
    conclusion: string | null,
    created = "2026-10-01T09:00:00Z",
  ) => ({
    status,
    conclusion,
    display_title: title,
    created_at: created,
  });

  it("finds the last due run that worked, newest first", () => {
    expect(lastDueRun([])).toBeUndefined();
    expect(
      lastDueRun([
        run("due", "in_progress", null, "2026-10-01T12:00:00Z"),
        run("due", "completed", "failure", "2026-10-01T11:00:00Z"),
        run("alert", "completed", "success", "2026-10-01T10:30:00Z"),
        run("due", "completed", "success", "2026-10-01T10:00:00Z"),
        run("due", "completed", "success", "2026-10-01T09:00:00Z"),
      ]),
    ).toBe("2026-10-01T10:00:00Z");
  });

  it("knows which boxes' clean-ups are queued or running, one at a time each", () => {
    expect(
      cleanupsUnderWay([
        run("cleanup homepi", "queued", null),
        run("cleanup pi2", "completed", "success"),
        run("due", "in_progress", null),
      ]),
    ).toEqual(new Set(["homepi"]));
  });
});

describe("nothing runs the clock any more (ADR 0019)", () => {
  it("names no clock workflow, command, label or check in the code and workflows", () => {
    const files = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      );
    const gone =
      /automations\.yml|ensureClock|clockOff|clockRunning|queueClock|CLOCK_LABEL|ship task (sweep|due|clock)|labels: \[[^\]]*shipify-clock/;
    const found = [...files("cli"), ...files(".github"), "box/setup.sh"].filter((f) =>
      gone.test(read(join(ROOT, f))),
    );
    expect(found).toEqual([]);
    expect(existsSync(join(ROOT, ".github/workflows/automations.yml"))).toBe(false);
    expect(existsSync(join(ROOT, ".github/workflows/watch.yml"))).toBe(true);
  });
});

describe("tasks: forms, read from their templates", () => {
  // The form's own first app, whatever this copy lists (the template lists none: "(none yet)").
  const app =
    FORMS.find((f) => f.id === "operate")?.fields.find((x) => x.id === "project")?.options[0] ?? "";
  const op = (action: string, version = "_No response_") =>
    `### Project\n\n${app}\n\n### Action\n\n${action}\n\n### Version\n\n${version}`;
  const rep = (when: string) =>
    `### What\n\nLook at the servers\n\n### When\n\n${when}\n\n### Kind\n\nA reminder (posts the text; no agent)`;

  it("reads every form's fields from its template: only Repeat and Operate are forms (ADR 0031)", () => {
    expect(FORMS.map((f) => f.id)).toEqual(["repeat", "operate"]);
    expect(
      FORMS.find((f) => f.id === "repeat")?.fields.map((f) => [f.id, f.type, f.required]),
    ).toEqual([
      ["what", "textarea", true],
      ["when", "input", true],
      ["kind", "dropdown", true],
      ["check", "input", false],
      ["model", "dropdown", false],
    ]);
    const model = FORMS.find((f) => f.id === "repeat")?.fields.find((x) => x.id === "model");
    expect(model?.options[0]).toBe("Auto");
    expect(FORMS.find((f) => f.id === "operate")?.fields.some((x) => x.id === "model")).toBe(false);
  });

  it("the Operate form lists every project below its marker", () => {
    const yaml = read(join(FORMS_DIR, "7-operate.yml"));
    expect(setFormProjects(yaml, ["alpha", "playground"])).toMatch(/- alpha\n\s+- playground\n/);
  });

  it("tells forms apart, and doesn't take one heading in a plain issue for a form", () => {
    expect(readForm(op("Take it down"), FORMS)?.form.id).toBe("operate");
    expect(readForm(rep("every day at 09:00"), FORMS)?.form.id).toBe("repeat");
    expect(readForm("Some notes first.\n\n### What\n\nmy plan", FORMS)).toBeUndefined();
    expect(readForm("plain words", FORMS)).toBeUndefined();
    expect(readForm(null, FORMS)).toBeUndefined();
  });

  it("says what's wrong: an empty answer, a choice not on the list, a field an edit removed", () => {
    expect(readForm(op("Take it down"), FORMS)?.problems).toEqual([]);
    expect(readForm(op("take it DOWN"), FORMS)?.answers.action).toBe("Take it down");
    expect(readForm(op("Delete it"), FORMS)?.problems).toEqual([
      "“Action” says “Delete it”, which isn't one of its choices: Release to production, Take it down, Bring it back, Roll back production.",
    ]);
    expect(readForm(`### Project\n\n${app}\n\n### Version\n\nv1.0.3`, FORMS)?.problems).toEqual([
      "“Action” is empty.",
    ]);
    expect(readForm(op("Take it down").replace(/\n/g, "\r\n"), FORMS)?.problems).toEqual([]);
  });

  it("checks what each kind needs: a schedule it can read, a rollback's release", () => {
    expect(taskForm(op("Roll back production", "latest"), FORMS)?.problems).toEqual([
      "“Version” says “latest”: a release looks like v1.0.3. Leave it empty for the release before the current one.",
    ]);
    expect(taskForm(op("Roll back production"), FORMS)?.problems).toEqual([]);
    expect(taskForm(op("Roll back production", "v1.0.3"), FORMS)?.problems).toEqual([]);
    // A version only means something for a rollback.
    expect(taskForm(op("Take it down", "latest"), FORMS)?.problems).toEqual([]);
    expect(taskForm(rep("whenever"), FORMS)?.problems[0]).toContain(
      "“When” says “whenever”, which isn't a schedule I can read.",
    );
    expect(taskForm(rep("every weekday at 8:30"), FORMS)?.problems).toEqual([]);
    // How often each kind may repeat: a reminder or a check every 15 minutes, a job every hour.
    expect(taskForm(rep("every 30 minutes"), FORMS)?.problems).toEqual([]);
    expect(taskForm(rep("every 10 minutes"), FORMS)?.problems[0]).toContain(
      "“every 10 minutes” is too often: the most is every 15 minutes",
    );
    const job = (when: string) =>
      rep(when).replace(
        "A reminder (posts the text; no agent)",
        "A job for the agent (quiet when there's nothing to do)",
      );
    expect(taskForm(job("every hour from 9am to 9pm"), FORMS)?.problems).toEqual([]);
    expect(taskForm(job("every 30 minutes"), FORMS)?.problems[0]).toContain(
      "“every 30 minutes” is too often for a job for the agent: the most is every hour",
    );
  });

  it("names every reply word in docs/tasks.md and in /help", () => {
    const docs = read("docs/tasks.md");
    const help = helpGuide().join("\n");
    for (const w of [
      "yes",
      "no",
      "continue",
      "start over",
      "preview",
      "publish",
      "go",
      "stop repeating",
      "resume",
    ]) {
      expect(wordOf(w), w).toBeDefined();
      expect(help, w).toContain(w);
      expect(docs, w).toContain(`\`${w}\``);
    }
  });
});

describe("tasks: titles, state and the status comment", () => {
  it("reads what a title asks for", () => {
    expect(parseTitle("spotter: bigger margins on cards")).toEqual({
      kind: "app",
      project: "spotter",
      ask: "bigger margins on cards",
    });
    expect(parseTitle("new: a tip calculator").kind).toBe("new");
    // The playground is a project like any other.
    expect(parseTitle("playground: a landing page")).toEqual({
      kind: "app",
      project: "playground",
      ask: "a landing page",
    });
    expect(parseTitle("ask: how much disk?").kind).toBe("question");
    expect(parseTitle("make it faster").kind).toBe("none");
    // A note is the box's to write, with no agent.
    expect(parseTitle("remember: short answers, in bullets")).toEqual({
      kind: "remember",
      ask: "short answers, in bullets",
    });
    expect(parseTitle("Remember People: Ana is my designer")).toEqual({
      kind: "remember",
      ask: "Ana is my designer",
      topic: "People",
    });
    expect(parseTitle("remember")).toEqual({ kind: "remember", ask: "" });
    expect(parseTitle("remember:")).toEqual({ kind: "remember", ask: "" });
    // Words that only start with it are plain words.
    expect(parseTitle("Remember the milk").kind).toBe("none");
    expect(parseTitle("remembering: the old flow").kind).toBe("app");
  });

  it("reads a repo on any account by its owner/name, dots and all (ADR 0045)", () => {
    expect(parseTitle("Acme/Web.App: rate-limit /login")).toEqual({
      kind: "app",
      project: "acme/web.app",
      ask: "rate-limit /login",
    });
    expect(parseTitle("o/spotter: bigger cards")).toMatchObject({ project: "o/spotter" });
    // What isn't a repo's name stays plain words: a path, `..`.
    expect(parseTitle("see docs/a/b.md: it's wrong").kind).toBe("none");
    expect(parseTitle("acme/..: x").kind).toBe("none");
  });

  it("reads a blank issue by its title; only the Operate form changes what it is", () => {
    expect(parseTask("spotter: bigger margins", "", FORMS)).toMatchObject({
      kind: "app",
      project: "spotter",
    });
    expect(parseTask("bigger margins", "The cards feel cramped.", FORMS).kind).toBe("none");
  });

  it("reads operations, questions and releases, with no agent needed for operations", () => {
    const op = (action: string, version = "_No response_") =>
      `### Project\n\nspotter\n\n### Action\n\n${action}\n\n### Version\n\n${version}`;
    expect(parseTask("", op("Take it down"), FORMS)).toMatchObject({
      kind: "op",
      project: "spotter",
      op: "down",
    });
    expect(parseTask("", op("Bring it back"), FORMS).op).toBe("up");
    expect(parseTask("", op("Roll back production", "v1.0.3"), FORMS)).toMatchObject({
      op: "rollback",
      version: "v1.0.3",
    });
    expect(parseTask("", op("Roll back production", "latest"), FORMS).version).toBeUndefined();
    expect(parseTask("", op("Release to production"), FORMS).op).toBe("release");
    expect(parseTitle("spotter: release")).toMatchObject({
      kind: "op",
      op: "release",
      project: "spotter",
    });
    // Shipify itself: its release to the template (docs/releases.md), the same operation.
    expect(parseTitle("shipify: release")).toMatchObject({
      kind: "op",
      op: "release",
      project: "shipify",
    });
    expect(parseTitle("question: where are sessions defined?").kind).toBe("question");
  });

  it("keeps its facts in the bot's status comment, and trusts only a bot's", () => {
    const state = {
      ...newState(),
      phase: "needs-you" as const,
      project: "spotter",
      branch: "task/12-x",
      prs: ["https://github.com/o/spotter/pull/7"],
      seen: 42,
    };
    const body = renderStatus(state, {
      summary: "Cards are 24px apart.",
      links: [["PR", "https://github.com/o/spotter/pull/7"]],
    });
    expect(body.startsWith(MARK)).toBe(true);
    expect(body).toContain("**Needs you** · spotter");
    expect(body).toContain("- PR: https://github.com/o/spotter/pull/7");
    const c = (login: string, id: number, text: string): Comment => ({
      id,
      body: text,
      user: { login },
      created_at: "",
    });
    const forged = c("someone", 1, renderStatus({ ...state, prs: ["https://evil"] }));
    const found = findStatus([forged, c("github-actions[bot]", 2, body)]);
    expect(found.comment?.id).toBe(2);
    expect(found.state).toMatchObject({ phase: "needs-you", branch: "task/12-x", seen: 42 });
    expect(findStatus([forged]).state.phase).toBe("waiting");
    // Another bot (the agent's own token can comment) never writes the status either.
    expect(findStatus([c("shipify-bot[bot]", 1, body)]).comment).toBeUndefined();
  });

  it("never lets a value end the hidden state line early", () => {
    const state = { ...newState(), phase: "needs-you" as const, notes: "an arrow --> inside" };
    const body = renderStatus(state);
    expect(body.split("\n")[0]?.endsWith(" -->")).toBe(true);
    expect(body.split("\n")[0]?.slice(0, -4)).not.toContain("-->");
    const found = findStatus([
      { id: 1, body, user: { login: "github-actions[bot]" }, created_at: "now" },
    ]);
    expect(found.state.notes).toBe("an arrow --> inside");
  });

  it("lists every PR the task opened, with its kind and state, on every update", () => {
    const body = renderStatus(
      {
        ...newState(),
        phase: "working",
        prs: ["https://github.com/o/s/pull/1", "https://github.com/o/s/pull/2"],
        prInfo: {
          "https://github.com/o/s/pull/1": { kind: "plan", state: "merged" },
          "https://github.com/o/s/pull/2": { kind: "code", state: "open" },
        },
      },
      {
        links: [
          ["PR", "https://github.com/o/s/pull/2"],
          ["Preview", "https://p"],
        ],
      },
    );
    expect(body).toContain(
      "- Plan PR (merged): https://github.com/o/s/pull/1\n- PR (open): https://github.com/o/s/pull/2\n- Preview: https://p",
    );
  });

  it("names branches, and new ones after a PR closes", () => {
    expect(branchFor(12, "Bigger margins on cards!")).toBe("task/12-bigger-margins-on-cards");
    expect(branchFor(3, `${"a".repeat(30)} ${"b".repeat(30)}`).length).toBeLessThanOrEqual(48);
    expect(nextBranch("task/12-x")).toBe("task/12-x-r2");
    expect(nextBranch("task/12-x-r2")).toBe("task/12-x-r3");
    expect(wordOf("Start over, please")).toBeUndefined();
    expect(wordOf("start over")).toBe("start over");
    expect(wordOf("Preview.")).toBe("preview");
    expect(wordOf("no preview needed, just make it blue")).toBeUndefined();
  });

  it("registers a private bot with only known permission names", () => {
    const m = botManifest("aayush-t-apps", "http://localhost:1/done");
    expect(m.public).toBe(false);
    expect(m.name.length).toBeLessThanOrEqual(34);
    expect(m.hook_attributes.active).toBe(false);
    // From GitHub's REST description (components.schemas.app-permissions).
    const known = [
      "actions",
      "administration",
      "checks",
      "contents",
      "issues",
      "metadata",
      "pull_requests",
      "secrets",
      "statuses",
      "workflows",
    ];
    expect(Object.keys(BOT_PERMISSIONS).every((k) => known.includes(k))).toBe(true);
  });

  it("registers the repos App public and small: code and PRs, read the rest, no webhook (ADR 0045)", () => {
    const m = botManifest("aayush-t-apps", "http://localhost:1/done", "repos");
    expect(m.public).toBe(true);
    expect(m.name).toBe("aayush-t-apps-shipify-repos");
    expect(m.name.length).toBeLessThanOrEqual(34);
    expect(m.hook_attributes.active).toBe(false);
    expect(m.default_events).toEqual([]);
    expect(m.default_permissions).toEqual({
      contents: "write",
      pull_requests: "write",
      issues: "read",
      actions: "read",
      checks: "read",
      statuses: "read",
      metadata: "read",
    });
    // A long org's name is cut, never the App's own part: the two Apps' names never meet.
    const long = "abcdefghijklmnopqrstuvwxyz";
    const [bot, repos] = [botManifest(long, "x").name, botManifest(long, "x", "repos").name];
    expect(bot).not.toBe(repos);
    expect(repos).toMatch(/-shipify-repos$/);
    expect(Math.max(bot.length, repos.length)).toBeLessThanOrEqual(34);
    // Nothing that would need an org owner to install it, or reach past code and PRs.
    for (const never of [
      "administration",
      "secrets",
      "workflows",
      "members",
      "organization_administration",
    ])
      expect(Object.keys(REPOS_PERMISSIONS)).not.toContain(never);
  });

  it("the bot's code is exchanged without a token, and a stale one says what to do", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const post = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return url.includes("0000")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ id: 1, slug: "org-shipify", client_id: "Iv1", pem: "k" }), {
            status: 201,
          });
    }) as unknown as typeof fetch;
    const app = await exchangeCode("9663d5f42bb40f9a152326ef2d093191daaa69ad", post);
    expect(app.slug).toBe("org-shipify");
    expect(calls[0]?.url).toBe(
      "https://api.github.com/app-manifests/9663d5f42bb40f9a152326ef2d093191daaa69ad/conversions",
    );
    expect(Object.keys(calls[0]?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain(
      "authorization",
    );
    await expect(exchangeCode("00000000000000000000", post)).rejects.toThrow(/works once/);
    await expect(exchangeCode("not-a-code; rm -rf", post)).rejects.toThrow(/isn't a code/);
  });
});

describe("tasks: the forms list the projects", () => {
  it("rewrites only the marked list", () => {
    const form = [
      "      options:",
      "        # Projects: `ship forms` keeps this list current (publishing a project updates it).",
      "        - old-one",
      "    validations:",
      "      options:",
      "        - Take it down",
    ].join("\n");
    const out = setFormProjects(form, ["shipify-admin", "spotter"]);
    expect(out).toContain("        - shipify-admin\n        - spotter\n    validations:");
    expect(out).not.toContain("old-one");
    expect(out).toContain("        - Take it down");
  });
});

describe("tasks: changelogs when branches meet", () => {
  const cl = (unrel: string, ...sections: string[]) =>
    `# Changelog\n\n## [Unreleased]\n${unrel ? `\n${unrel}\n` : ""}\n${sections.join("\n")}`;

  it("puts a release's lines back under Unreleased", () => {
    const text = cl(
      "",
      "## [1.0.1] - 2026-09-29\n\n### Fixed\n\n- A fix.\n",
      "## [1.0.0] - 2026-09-01\n\n### Added\n\n- First.\n",
    );
    const back = reopenChangelog(text, "1.0.1");
    expect(back).not.toContain("## [1.0.1]");
    expect(unreleased(back)).toBe("### Fixed\n\n- A fix.");
    expect(back).toContain("## [1.0.0] - 2026-09-01");
  });

  it("merges blocks by heading without repeating lines", () => {
    expect(
      mergeChangelogBlocks("### Fixed\n\n- a", "### Added\n\n- b\n\n### Fixed\n\n- a\n- c"),
    ).toBe("### Fixed\n\n- a\n- c\n\n### Added\n\n- b");
  });

  it("resolves a conflict by keeping both sides, this branch's first", () => {
    const text = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "<<<<<<< HEAD",
      "### Changed",
      "",
      "- Bigger margins.",
      "=======",
      "## [1.1.0] - 2026-09-29",
      "",
      "### Added",
      "",
      "- Search.",
      ">>>>>>> origin/main",
      "",
      "## [1.0.0] - 2026-09-01",
      "",
    ].join("\n");
    const out = resolveChangelogConflicts(text);
    expect(out).not.toMatch(/<<<<<<<|=======|>>>>>>>/);
    expect(unreleased(out)).toBe("### Changed\n\n- Bigger margins.");
    expect(out.indexOf("- Bigger margins.")).toBeLessThan(out.indexOf("## [1.1.0]"));
    expect(out).toContain("## [1.0.0]");
  });
});

describe("tasks: pr and refresh against a real git remote", () => {
  let sb: Sandbox;
  let dir: string;
  let origin: string;
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, env: sb.env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const addLine = (cwd: string, line: string, heading = "Changed") => {
    const f = join(cwd, "CHANGELOG.md");
    writeFileSync(
      f,
      read(f).replace("## [Unreleased]\n", `## [Unreleased]\n\n### ${heading}\n\n- ${line}\n`),
    );
  };
  const worktree = (name: string) => {
    const wt = join(sb.dir, "worktrees", name);
    git(dir, "fetch", "-q", "origin");
    git(dir, "worktree", "add", "-q", "-b", `task/${name}`, wt, "origin/main");
    return wt;
  };

  beforeAll(() => {
    sb = sandbox();
    ship(sb, "new", "tsk-app", "--stack", "ts-worker", "--preset", "tool", "--skip-install");
    dir = join(sb.apps, "tsk-app");
    origin = join(sb.dir, "origin.git");
    git(sb.dir, "init", "-q", "--bare", "-b", "main", origin);
    git(dir, "remote", "add", "origin", origin);
    const m = json(join(dir, "shipify.json"));
    m.repository.url = "https://github.com/mock/tsk-app";
    writeFileSync(join(dir, "shipify.json"), `${JSON.stringify(m, null, 2)}\n`);
    git(dir, "commit", "-q", "-am", "Record the repository");
    git(dir, "push", "-q", "-u", "origin", "main");
  });

  it("pr commits, pushes and opens the PR once, and refuses main", () => {
    expect(ship(sb, "pr", dir, "--title", "x", "--yes").status).toBe("blocked");
    const wt = worktree("12-margins");
    writeFileSync(join(wt, "NOTE.md"), "margins\n");
    const plan = ship(sb, "pr", wt, "--task", "12", "--title", "Bigger margins");
    expect(plan.status).toBe("requires-approval");
    expect(plan.plannedActions?.join("\n")).toContain("closes");
    // The checks before a PR (ADR 0018), the quick rules first, the same `pr --check` (the box)
    // runs: merging ships a version, so one not bumped is refused, and nothing is pushed.
    const unbumped = ship(sb, "pr", wt, "--task", "12", "--title", "Bigger margins", "--yes");
    expect(unbumped.status).toBe("blocked");
    expect(unbumped.summary).toContain("shipify.json is still 0.1.0");
    expect(ship(sb, "pr", wt, "--check").summary).toContain("shipify.json is still 0.1.0");
    const changelog = join(wt, "CHANGELOG.md");
    writeFileSync(
      changelog,
      read(changelog).replace(
        "## [Unreleased]\n",
        "## [Unreleased]\n\n### Changed\n\n- Bigger margins.\n",
      ),
    );
    expect(ship(sb, "version", wt, "patch").status).toBe("succeeded");
    expect(ship(sb, "pr", wt, "--check").status).toBe("succeeded");
    // Then make verify fails (a stand-in make, so it fails on any machine): nothing is pushed.
    const failing = join(sb.dir, "failing-make");
    mkdirSync(failing, { recursive: true });
    writeFileSync(join(failing, "make"), "#!/bin/sh\necho 'verify: failed' >&2\nexit 2\n", {
      mode: 0o755,
    });
    const path = sb.env.PATH;
    sb.env.PATH = `${failing}:${path}`;
    const refused = ship(sb, "pr", wt, "--task", "12", "--title", "Bigger margins", "--yes");
    sb.env.PATH = path;
    expect(refused.status).toBe("blocked");
    expect(refused.summary).toContain("make verify failed");
    expect(git(origin, "branch", "--list", "task/12-margins")).toBe("");
    const first = ship(
      sb,
      "pr",
      wt,
      "--task",
      "12",
      "--title",
      "Bigger margins",
      "--summary",
      "24px.",
      "--preview",
      "--no-verify",
      "--yes",
    );
    expect(first.status).toBe("succeeded");
    // A preview asked for: the PR opens with its label, so the pipeline's first run makes it.
    expect(read(`${sb.env.SHIPIFY_MOCK_PRS}.labels`)).toBe("preview");
    // No issue reference in commits: GitHub would add a line to the task for each one.
    expect(git(origin, "log", "--format=%s%n%b", "task/12-margins", "-1")).not.toContain("#12");
    writeFileSync(join(wt, "NOTE.md"), "margins, 20px\n");
    const again = ship(
      sb,
      "pr",
      wt,
      "--task",
      "12",
      "--title",
      "Less",
      "--summary",
      "20px.",
      "--no-verify",
      "--yes",
    );
    expect(again.summary).toContain("pushed to");
    // The description keeps the first round and adds this one, above the task link.
    const body = read(`${sb.env.SHIPIFY_MOCK_PRS}.body`);
    expect(body.indexOf("24px.")).toBeLessThan(body.indexOf("- 20px."));
    expect(body.indexOf("- 20px.")).toBeLessThan(body.indexOf("Closes"));
  });

  it("pr names the task run's own task, and what made it, when --task isn't given", () => {
    const wt = worktree("14-colours");
    writeFileSync(join(wt, "NOTE.md"), "colours\n");
    const before = { ...sb.env };
    Object.assign(sb.env, {
      SHIPIFY_TASK: "14",
      SHIPIFY_MADE_BY: "Claude Code (Sonnet, medium)",
      SHIPIFY_RUN_URL: "https://x/runs/9",
    });
    try {
      expect(ship(sb, "pr", wt, "--title", "Colours", "--no-verify", "--yes").status).toBe(
        "succeeded",
      );
    } finally {
      sb.env = before;
    }
    const body = read(`${sb.env.SHIPIFY_MOCK_PRS}.body`);
    expect(body).toMatch(/Closes [\w.-]+\/[\w.-]+#14/);
    expect(body).toContain(
      "Made by Claude Code (Sonnet, medium) with Shipify in [this run](https://x/runs/9). Merging it is the approval",
    );
    // Its checks didn't run here: its merge is checked in full.
    expect(body).not.toContain(CHECKED_MARK);
  });

  it("a PR whose checks passed carries the mark; a round pushed without them takes it away", () => {
    const wt = worktree("15-mark");
    addLine(wt, "A mark.", "Fixed");
    const bumped = ship(sb, "version", wt, "patch");
    if (bumped.status !== "succeeded") console.log("BUMP", JSON.stringify(bumped));
    expect(bumped.status).toBe("succeeded");
    const passing = join(sb.dir, "passing-make");
    mkdirSync(passing, { recursive: true });
    writeFileSync(join(passing, "make"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const path = sb.env.PATH;
    sb.env.PATH = `${passing}:${path}`;
    try {
      expect(ship(sb, "pr", wt, "--title", "A mark", "--yes").status).toBe("succeeded");
    } finally {
      sb.env.PATH = path;
    }
    expect(read(`${sb.env.SHIPIFY_MOCK_PRS}.body`)).toContain(`\n\n${CHECKED_MARK}`);
    writeFileSync(join(wt, "NOTE.md"), "mark, again\n");
    const again = ship(
      sb,
      "pr",
      wt,
      "--title",
      "Again",
      "--summary",
      "More.",
      "--no-verify",
      "--yes",
    );
    expect(again.summary).toContain("pushed to");
    const body = read(`${sb.env.SHIPIFY_MOCK_PRS}.body`);
    expect(body).toContain("- More.");
    expect(body).not.toContain(CHECKED_MARK);
  });

  it("change new from a worktree path names the app by its id", () => {
    const wt = worktree("13-search");
    expect(ship(sb, "change", "new", wt, "search").status).toBe("succeeded");
    const doc = read(join(wt, "docs/changes/0002-search.md"));
    expect(doc).toContain("app: tsk-app\n");
    const checked = ship(sb, "change", "check", wt, "2");
    expect(checked.checks?.find((c) => c.name === "front matter is valid")?.ok).toBe(true);
  });

  it("a PR's description lists each later round once", () => {
    const first = "Bigger margins.\n\nCloses o/shipify#12\n\nOpened by Shipify.";
    const two = addToPrBody(first, "Smaller on phones.");
    expect(two).toBe(
      "Bigger margins.\n\n**After review:**\n- Smaller on phones.\n\nCloses o/shipify#12\n\nOpened by Shipify.",
    );
    const three = addToPrBody(two, "Lighter\ntitles.");
    expect(three).toContain("- Smaller on phones.\n- Lighter titles.\n\nCloses");
    expect(addToPrBody(three, "Lighter titles.")).toBe(three);
    expect(addToPrBody("", "x")).toBe("**After review:**\n- x");
  });

  it("refresh merges main, keeps both changelogs, renumbers a clashing doc and bumps on top", () => {
    // Two tasks start from the same main: A is a fix, B is a feature with a change doc.
    const a = worktree("20-fix");
    const b = worktree("21-feature");
    addLine(a, "A fix.", "Fixed");
    expect(ship(sb, "version", a, "patch").summary).toContain("0.1.0 → 0.1.1");
    mkdirSync(join(a, "docs/changes"), { recursive: true });
    writeFileSync(
      join(a, "docs/changes/0002-fix-notes.md"),
      "---\nchange: 2\napp: tsk-app\ntitle: Fix notes\nbump: patch\nreleased: null\n---\n\n# 0002: Fix notes\n",
    );
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "A: the fix");
    addLine(b, "Search.", "Added");
    writeFileSync(
      join(b, "docs/changes/0002-search.md"),
      "---\nchange: 2\napp: tsk-app\ntitle: Search\nbump: minor\nreleased: null\n---\n\n# 0002: Search\n",
    );
    expect(ship(sb, "version", b, "minor").summary).toContain("0.1.0 → 0.2.0");
    git(b, "add", "-A");
    git(b, "commit", "-q", "-m", "B: search");
    // B merges first.
    git(b, "push", "-q", "origin", "HEAD:main");
    const r = ship(sb, "refresh", a);
    expect(r.status, r.summary).toBe("succeeded");
    expect(r.summary).toContain("merged main");
    expect(json(join(a, "shipify.json")).version).toBe("0.2.1");
    expect(json(join(a, "package.json")).version).toBe("0.2.1");
    const changelog = read(join(a, "CHANGELOG.md"));
    expect(changelog).not.toMatch(/<<<<<<<|>>>>>>>/);
    expect(changelog).toContain("## [0.2.1]");
    expect(changelog).toContain("## [0.2.0]");
    expect(changelog).not.toContain("## [0.1.1]");
    expect(changelog.indexOf("- A fix.")).toBeLessThan(changelog.indexOf("## [0.2.0]"));
    expect(existsSync(join(a, "docs/changes/0003-fix-notes.md"))).toBe(true);
    expect(read(join(a, "docs/changes/0003-fix-notes.md"))).toContain("change: 3");
    expect(read(join(a, "docs/changes/0003-fix-notes.md"))).toContain("released: v0.2.1");
    expect(git(a, "status", "--porcelain")).toBe("");
    expect(ship(sb, "refresh", a).status).toBe("skipped");
  });

  it("refresh stops on a real conflict and finishes after the fix", () => {
    const a = worktree("30-copy");
    const b = worktree("31-copy");
    writeFileSync(join(a, "COPY.md"), "hello from a\n");
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "A copy");
    writeFileSync(join(b, "COPY.md"), "hello from b\n");
    git(b, "add", "-A");
    git(b, "commit", "-q", "-m", "B copy");
    git(b, "push", "-q", "origin", "HEAD:main");
    const r = ship(sb, "refresh", a);
    expect(r.status).toBe("blocked");
    expect(r.checks?.map((c) => c.name)).toEqual(["COPY.md"]);
    expect(ship(sb, "refresh", a).status).toBe("blocked");
    writeFileSync(join(a, "COPY.md"), "hello from a and b\n");
    const done = ship(sb, "refresh", a);
    expect(done.status).toBe("succeeded");
    expect(git(a, "status", "--porcelain")).toBe("");
    expect(git(a, "log", "-1", "--format=%s")).toContain("Merge");
  });

  it("a conflict settled with a plain commit leaves the bump undone, and the PR's check asks for it", () => {
    const a = worktree("40-fix");
    const b = worktree("41-fix");
    writeFileSync(join(a, "NOTE.md"), "from a\n");
    addLine(a, "A note.", "Fixed");
    ship(sb, "version", a, "patch");
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "A: the note");
    writeFileSync(join(b, "NOTE.md"), "from b\n");
    addLine(b, "B note.", "Fixed");
    ship(sb, "version", b, "minor");
    git(b, "add", "-A");
    git(b, "commit", "-q", "-m", "B: the note");
    git(b, "push", "-q", "origin", "HEAD:main");
    expect(ship(sb, "refresh", a).status).toBe("blocked");
    // Settled by hand: a plain commit, not refresh again.
    writeFileSync(join(a, "NOTE.md"), "from a and b\n");
    git(a, "commit", "-q", "-am", "Settled by hand");
    // The same check the box runs before any PR names the missing bump.
    const check = ship(sb, "pr", a, "--check");
    expect(check.status).toBe("blocked");
    expect(check.summary).toMatch(/shipify\.json is still/);
    // Refresh, run again, finishes it: the recorded bump redone once, on top of main's version.
    const main = json(join(b, "shipify.json")).version as string;
    const r = ship(sb, "refresh", a);
    expect(r.status).toBe("succeeded");
    expect(r.summary).toContain("settled by hand");
    const [maj, min, pat] = main.split(".").map(Number);
    expect(json(join(a, "shipify.json")).version).toBe(`${maj}.${min}.${(pat ?? 0) + 1}`);
    expect(ship(sb, "pr", a, "--check").status).toBe("succeeded");
    // Never twice.
    expect(ship(sb, "refresh", a).status).toBe("skipped");
  });

  it("adds everything but the checkouts inside a tree, whatever their names (ADR 0041)", () => {
    const r = join(sb.dir, "add-all");
    git(sb.dir, "init", "-q", "-b", "main", r);
    writeFileSync(join(r, ".gitignore"), "deps/\n");
    writeFileSync(join(r, "a.txt"), "a\n");
    git(r, "add", "-A");
    git(r, "commit", "-q", "-m", "base");
    git(r, "worktree", "add", "-q", "-b", "helper", join(r, ".claude", "worktrees", "helper"));
    git(r, "init", "-q", join(r, "odd", "café [1]"));
    git(r, "init", "-q", join(r, "nested", "repo"));
    mkdirSync(join(r, "glob[1]"));
    writeFileSync(join(r, "glob[1]", "g.txt"), "g\n");
    mkdirSync(join(r, "deps", "p"), { recursive: true });
    git(r, "init", "-q", join(r, "deps", "p", "inner"));
    writeFileSync(join(r, "new.txt"), "n\n");
    const added = spawnSync("sh", ["-c", ADD_ALL_BUT_CHECKOUTS], {
      cwd: r,
      env: sb.env,
      encoding: "utf8",
    });
    expect(added.status, added.stderr).toBe(0);
    git(r, "commit", "-q", "-m", "wip");
    expect(git(r, "ls-tree", "-r", "--name-only", "HEAD").split("\n").sort()).toEqual([
      ".gitignore",
      "a.txt",
      "glob[1]/g.txt",
      "new.txt",
    ]);
    expect(strayCheckouts(r)).toEqual([]);
    // It needs git 2.26 or newer, which ship doctor checks.
    expect(gitTakesPathspecFiles("git version 2.43.0")).toBe(true);
    expect(gitTakesPathspecFiles("git version 2.26.0")).toBe(true);
    expect(gitTakesPathspecFiles("git version 2.25.1")).toBe(false);
    expect(gitTakesPathspecFiles("git version 3.0.0")).toBe(true);
  });

  it("the PR's checks refuse a checkout recorded in the commits, on the box and this PC, staged or committed; a declared submodule is fine (ADR 0041)", () => {
    const w = worktree("60-helper");
    const sha = git(w, "rev-parse", "HEAD");
    // A helper's worktree added by mistake (`git add -A` beside it): a gitlink with nothing behind it.
    git(w, "update-index", "--add", "--cacheinfo", `160000,${sha},.claude/worktrees/helper`);
    git(w, "commit", "-q", "-m", "A helper's worktree, by mistake");
    const check = ship(sb, "pr", w, "--check");
    expect(check.status).toBe("blocked");
    expect(check.summary).toContain(".claude/worktrees/helper");
    expect(check.summary).toContain(`git -C ${w} rm --cached .claude/worktrees/helper`);
    // ship pr here refuses it as the box's check does, before anything is pushed.
    const pr = ship(sb, "pr", w, "--title", "x", "--yes");
    expect(pr.status).toBe("blocked");
    expect(pr.summary).toContain(
      "A checkout is recorded in the commits (.claude/worktrees/helper)",
    );
    // Taken out of the index but not committed: the commits still hold it.
    git(w, "rm", "-q", "--cached", ".claude/worktrees/helper");
    expect(ship(sb, "pr", w, "--check").summary).toContain(".claude/worktrees/helper");
    git(w, "reset", "-q");
    // Declared in .gitmodules, it's a submodule the project meant: this rule passes, the next speaks.
    writeFileSync(
      join(w, ".gitmodules"),
      '[submodule "helper"]\n\tpath = .claude/worktrees/helper\n\turl = https://example.com/x.git\n',
    );
    git(w, "add", ".gitmodules");
    git(w, "commit", "-q", "-m", "Declared");
    expect(ship(sb, "pr", w, "--check").summary).not.toContain(".claude/worktrees/helper");
  });

  it("the PR's check refuses a version below main's: main moved past the branch", () => {
    const a = worktree("50-old");
    const m = json(join(a, "shipify.json"));
    writeFileSync(
      join(a, "shipify.json"),
      `${JSON.stringify({ ...m, version: "0.0.1" }, null, 2)}\n`,
    );
    git(a, "commit", "-q", "-am", "An old version");
    const check = ship(sb, "pr", a, "--check");
    expect(check.status).toBe("blocked");
    expect(check.summary).toContain("below main's");
    expect(check.summary).toContain("set its version to");
    // Behind main (a sibling merged first), the fix is a refresh, whatever the versions say.
    const c = worktree("51-behind");
    const other = worktree("52-ahead");
    addLine(other, "Ahead.", "Fixed");
    ship(sb, "version", other, "patch");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "Ahead");
    git(other, "push", "-q", "origin", "HEAD:main");
    git(c, "fetch", "-q", "origin");
    const behind = ship(sb, "pr", c, "--check");
    expect(behind.status).toBe("blocked");
    expect(behind.summary).toContain("main moved past this branch");
  });
});

describe("boxes: adding one over SSH", () => {
  const cfg = { hostname: "192.168.1.100", user: "homepi", identity: "~/.ssh/id_ed25519_pi" };

  it("says how to fix each SSH problem", () => {
    expect(
      sshAdvice("shipify-pi", "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!", cfg),
    ).toContain("ssh-keygen -R 192.168.1.100");
    expect(
      sshAdvice("shipify-pi", "homepi@192.168.1.100: Permission denied (publickey,password).", cfg),
    ).toContain("ssh-copy-id -i ~/.ssh/id_ed25519_pi.pub homepi@192.168.1.100");
    expect(sshAdvice("pi@10.0.0.5", "Permission denied (publickey).")).toContain("pi@10.0.0.5");
    expect(
      sshAdvice("shipify-pi", "connect to host 192.168.1.100 port 22: Connection refused", cfg),
    ).toContain("SSH isn't on");
    expect(
      sshAdvice("shipify-pi", "connect to host 192.168.1.100 port 22: Connection timed out", cfg),
    ).toContain("is it on");
  });
});

describe("boxes: one service definition for every machine", () => {
  it("a system service run as shipify, the same on a Pi, a VPS or this PC (ADR 0047)", () => {
    const u = boxUnit({ name: "homepi", dir: "/home/shipify/runner" });
    // GitHub's service entry point, restarted by systemd, stopped without leftovers.
    expect(u).toMatch(/^ExecStart=\/.+\/bin\/runsvc\.sh$/m);
    expect(u).toContain("\nRestart=always\nRestartSec=10\n");
    expect(u).toContain("\nKillMode=mixed\n");
    expect(u).not.toContain("KillMode=process");
    expect(u).toContain("\nUser=shipify\n");
    // Setup 5: what the runner writes is its own, so no agent user can read it.
    expect(u).toMatch(/^UMask=0077$/m);
    expect(u).toContain("After=network-online.target");
    expect(u).toContain("WantedBy=multi-user.target");
    expect(u).toContain("WorkingDirectory=/home/shipify/runner\n");
  });

  it("is one slot: a runner that runs what the queue hands it, one task at a time (ADR 0020)", () => {
    const unit = boxUnit({ name: "homepi-2", dir: "/home/shipify/runner/slot-2" });
    expect(unit).toContain(
      "Description=Shipify box homepi-2 (a slot: a GitHub runner that runs what the queue hands it, one task at a time)",
    );
    expect(unit).toContain("ExecStart=/home/shipify/runner/slot-2/bin/runsvc.sh\n");
    expect(unit).not.toContain("clock");
  });
});

describe("boxes: what setup opens and closes", () => {
  const setup = readFileSync(join(ROOT, "box", "setup.sh"), "utf8");
  it("turns SSH passwords off only for an account with a key, and only once sshd accepts it", () => {
    const keys = setup.indexOf('[ ! -s "$keys" ]');
    const write = setup.indexOf('> "$SSHD_DROPIN"');
    const check = setup.indexOf('"$SSHD" -t');
    const undo = setup.indexOf('rm -f "$SSHD_DROPIN"');
    expect(keys).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(keys);
    expect(check).toBeGreaterThan(write);
    expect(undo).toBeGreaterThan(check);
    expect(setup).toContain("PasswordAuthentication no");
  });
  it("lets the firewall in only once Tailscale is up, with every allow before it turns on", () => {
    const fw = setup.slice(setup.indexOf("firewall() {"));
    const gate = fw.indexOf("tailscale0 2>/dev/null | grep -q inet");
    const enable = fw.indexOf("ufw --force enable");
    expect(gate).toBeGreaterThan(0);
    for (const allow of ["ufw allow in on tailscale0", 'ufw allow from "$net" to any port 22'])
      expect(fw.indexOf(allow)).toBeGreaterThan(gate);
    expect(enable).toBeGreaterThan(fw.indexOf("ufw allow from"));
    // No moment without the allows: the default turns to deny only after them.
    expect(fw.indexOf("ufw default deny incoming")).toBeGreaterThan(fw.indexOf("ufw allow from"));
    // Added, never reset: the owner's own rules stay.
    expect(setup).not.toMatch(/ufw (--force )?reset/);
  });
});

describe("boxes: slots, so a box runs several tasks at once (ADR 0020)", () => {
  it("names and places each slot: slot 1 is the box itself, slot k is <box>-<k>", () => {
    expect(slotName("homepi", 1)).toBe("homepi");
    expect(slotName("homepi", 3)).toBe("homepi-3");
    expect(slotDir("/home/shipify/runner", 1)).toBe("/home/shipify/runner");
    expect(slotDir("/home/shipify/runner", 2)).toBe("/home/shipify/runner/slot-2");
    expect(slotOf("homepi", "homepi")).toBe(1);
    expect(slotOf("homepi", "homepi-3")).toBe(3);
    expect(slotOf("homepi", "homepi-1")).toBe(0);
    expect(slotOf("homepi", "homepi-x")).toBe(0);
    expect(slotOf("homepi", "other")).toBe(0);
  });

  it("knows a runner's box by its box-<name> label, which every slot has", () => {
    const labels = (...l: string[]) => l.map((name) => ({ name }));
    expect(boxOf({ name: "homepi-2", labels: labels("shipify-box", "box-homepi") })).toBe("homepi");
    // A runner from before labels: its own name.
    expect(boxOf({ name: "oldbox", labels: labels("shipify-box") })).toBe("oldbox");
  });

  it("says where a run is: the box, and its slot when it has several", () => {
    expect(whereThisRuns("homepi-2", "homepi")).toBe("homepi (slot 2)");
    expect(whereThisRuns("homepi", "homepi")).toBe("homepi");
    // A box from before slots has no SHIPIFY_BOX: its runner's name.
    expect(whereThisRuns("homepi", undefined)).toBe("homepi");
  });

  it("finds every slot's workspace on the box, and just this one elsewhere", () => {
    const box = mkdtempSync(join(tmpdir(), "box-"));
    for (const d of ["_work/shipify", "slot-2/_work/shipify", "slot-3/_work/shipify", "slot-x"])
      mkdirSync(join(box, d), { recursive: true });
    const here = join(box, "slot-2/_work/shipify");
    expect(slotWorkspaces(here, box).sort()).toEqual(
      [join(box, "_work/shipify"), here, join(box, "slot-3/_work/shipify")].sort(),
    );
    // "" rather than undefined: undefined means this box's own SHIPIFY_BOX_DIR, set on a box.
    expect(slotWorkspaces(here, "")).toEqual([here]);
    expect(slotWorkspaces(here, join(box, "missing"))).toEqual([here]);
  });
});

describe("boxes: this machine's box", () => {
  // A fake systemctl, sudo and gh: nothing touches this machine's real services. The machine's
  // slots are its shipify-box-* system services, as box add makes them on any machine.
  const setup = (opts: {
    box?: string;
    busy?: boolean;
    /** Slots beyond the first: each a runner `<box>-<k>`, and its service. */
    slots?: number;
    /** The box is another machine: its runners on GitHub, none of its services here. */
    elsewhere?: boolean;
  }) => {
    const sb = sandbox();
    const bin = join(sb.dir, "bin");
    mkdirSync(bin, { recursive: true });
    const slots = opts.box
      ? Array.from({ length: opts.slots ?? 1 }, (_, i) =>
          i === 0 ? (opts.box as string) : `${opts.box}-${i + 1}`,
        )
      : [];
    const calls = join(sb.dir, "systemctl.log");
    const files = (opts.elsewhere ? [] : slots)
      .map((n) => `shipify-box-${n}.service enabled enabled`)
      .join("\\n");
    writeFileSync(
      join(bin, "systemctl"),
      `#!/bin/sh
case "$1" in
  list-unit-files) printf '${files}\\n' ;;
  is-active) echo active ;;
  is-enabled) echo enabled ;;
  *) echo "systemctl $*" >> "${calls}" ;;
esac
`,
      { mode: 0o755 },
    );
    writeFileSync(join(bin, "sudo"), `#!/bin/sh\necho "sudo $*" >> "${calls}"\n`, {
      mode: 0o755,
    });
    const runner = {
      id: 1,
      name: opts.box,
      os: "Linux",
      status: "online",
      busy: !!opts.busy,
      labels: [{ name: "shipify-box" }, { name: `box-${opts.box}` }, { name: "sandbox" }],
    };
    // Slot k: the box's label, idle, the last one offline.
    const more = Array.from({ length: (opts.slots ?? 1) - 1 }, (_, i) => ({
      ...runner,
      id: 10 + i,
      name: `${opts.box}-${i + 2}`,
      busy: false,
      status: i + 2 === opts.slots && (opts.slots ?? 1) > 2 ? "offline" : "online",
    }));
    const list = { runners: [runner, ...more] };
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh
case "$*" in
  *actions/runners*) echo '${JSON.stringify(list)}' ;;
  *status=in_progress*) echo '{"workflow_runs":[{"id":5,"display_title":"task #9","html_url":"https://x/5"}]}' ;;
  */jobs*) echo '{"jobs":[{"runner_name":"${opts.box}"}]}' ;;
esac
`,
      { mode: 0o755 },
    );
    sb.env = { ...sb.env, PATH: `${bin}:${process.env.PATH}` };
    return { sb, calls };
  };

  it("says when this machine isn't a box, and how to make it one", () => {
    const r = ship(setup({}).sb, "box", "stop");
    expect(r.summary).toContain("isn't a box");
    expect(r.summary).toContain("pnpm ship box add --yes");
  });

  it("stop asks first while a task runs, then turns its services off with sudo", () => {
    const { sb, calls } = setup({ box: "pi-1", busy: true });
    const asked = ship(sb, "box", "stop");
    expect(asked.status).toBe("requires-approval");
    expect(asked.summary).toContain("task #9");
    expect(existsSync(calls)).toBe(false);
    expect(ship(sb, "box", "stop", "--yes").status).toBe("succeeded");
    expect(read(calls)).toContain("sudo systemctl disable --now shipify-box-pi-1.service");
    expect(ship(sb, "box", "start").status).toBe("succeeded");
    expect(read(calls)).toContain("sudo systemctl enable --now shipify-box-pi-1.service");
  });

  it("stops, starts and lists every slot of the box as one box (ADR 0020)", () => {
    const { sb, calls } = setup({ box: "pi-1", busy: true, slots: 3 });
    expect(ship(sb, "box", "stop").status).toBe("requires-approval");
    expect(ship(sb, "box", "stop", "--yes").status).toBe("succeeded");
    expect(read(calls)).toContain(
      "sudo systemctl disable --now shipify-box-pi-1.service shipify-box-pi-1-2.service shipify-box-pi-1-3.service",
    );
    expect(ship(sb, "box", "restart", "--yes").status).toBe("succeeded");
    expect(read(calls)).toContain("sudo systemctl restart shipify-box-pi-1.service");
    const list = ship(sb, "box", "list");
    expect(list.summary).toContain("1 box(es), 1 online");
    expect(String(list.data)).toMatch(/pi-1\s+online\s+3 slot\(s\), 1 busy, 1 offline/);
    expect(String(list.data)).not.toMatch(/pi-1-2/);
    const status = ship(sb, "box", "status");
    expect(status.summary).toBe("pi-1: 3 slot(s), 2 online, 1 busy");
    expect(String(status.data)).toMatch(/pi-1-3\s+active, starts with the machine\s+offline/);
  });

  it("removes its own box with sudo here; a Pi's, by saying what to run there", () => {
    const { sb, calls } = setup({ box: "pi-1", slots: 2 });
    const plan = ship(sb, "box", "remove", "pi-1");
    expect(plan.status).toBe("requires-approval");
    expect(plan.nextSteps).toEqual(["pnpm ship box remove pi-1 --yes"]);
    expect(ship(sb, "box", "remove", "pi-1", "--yes").status).toBe("succeeded");
    expect(read(calls)).toContain(
      "sudo systemctl disable --now shipify-box-pi-1.service shipify-box-pi-1-2.service",
    );
    const there = ship(setup({ box: "pi-2", elsewhere: true }).sb, "box", "remove", "pi-2");
    expect(there.nextSteps?.[1]).toBe(
      "on the machine, so its services stop restarting: sudo systemctl disable --now shipify-box-pi-2",
    );
  });
});

describe("boxes: what a box says about itself", () => {
  const none = { read: () => undefined, exec: () => undefined, changed: () => undefined };

  it("reads the system, memory and temperature, and skips what the board lacks", async () => {
    const { boxFacts } = await import("../cli/lib/box-facts.ts");
    const files: Record<string, string> = {
      "/etc/os-release": 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 22.04.5 LTS"\n',
      "/proc/meminfo": "MemTotal:  8000000 kB\nMemAvailable:  7340032 kB\n",
      "/sys/class/thermal/thermal_zone0/temp": "53600\n",
      "/proc/device-tree/model": "Raspberry Pi 4 Model B Rev 1.5\0",
    };
    const facts = Object.fromEntries(
      boxFacts({ ...none, read: (f) => files[f] }).map((f) => [f.name, f.value]),
    );
    expect(facts.system).toMatch(/^Ubuntu 22\.04\.5 LTS, \w+, \d+ cores, Node v\d+/);
    expect(facts.board).toBe("Raspberry Pi 4 Model B Rev 1.5");
    expect(facts.memory).toMatch(/^7\.0 GB free of /);
    expect(facts.disk).toMatch(/ GB free of .* GB \(\d+% used\)$/);
    expect(facts.temperature).toBe("53.6 °C");
    expect(facts.restart).toBe("not needed");
    const names = boxFacts(none).map((f) => f.name);
    for (const lacking of ["board", "temperature", "throttling", "updates", "services"])
      expect(names).not.toContain(lacking);
  });

  it("says what needs a look: throttling, a pending restart, updates and failed services", async () => {
    const { boxFacts } = await import("../cli/lib/box-facts.ts");
    const files: Record<string, string> = {
      "/sys/devices/platform/soc/soc:firmware/get_throttled": "50005\n",
      "/run/reboot-required.pkgs": "linux-base\nlibc6\nlinux-base\n",
      "/etc/apt/apt.conf.d/52shipify-updates":
        'Unattended-Upgrade::Automatic-Reboot-Time "04:30";\n',
    };
    const out: Record<string, string> = {
      "apt list --upgradable":
        "Listing...\ncurl/noble-security 8.5.0-2ubuntu10.7 arm64 [upgradable from: 8.5.0-2ubuntu10.6]\n" +
        "gh/stable 2.80.0 arm64 [upgradable from: 2.79.0]\n",
      "systemctl --version": "systemd 255\n",
      "systemctl list-unit-files --no-legend shipify-box-* tailscaled.service cockpit.socket":
        "shipify-box-homepi.service enabled enabled\ntailscaled.service enabled enabled\n",
      "systemctl is-active shipify-box-homepi.service": "active\n",
      "systemctl is-active tailscaled.service": "failed\n",
      "systemctl list-units --failed --no-legend --plain":
        "tailscaled.service loaded failed failed Tailscale node agent\n",
    };
    const facts = Object.fromEntries(
      boxFacts({
        read: (f) => files[f],
        exec: (cmd, args) => out[[cmd, ...args].join(" ")] ?? "",
        changed: (f) => (f === "/run/reboot-required" ? new Date(2026, 9, 1, 11, 12) : undefined),
      }).map((f) => [f.name, f.value]),
    );
    expect(facts.throttling).toBe("now: under-voltage, throttled");
    expect(facts.restart).toBe(
      "needed since Thu 1 Oct, 11:12 (linux-base, libc6); it restarts by itself at 04:30",
    );
    expect(facts.updates).toBe("2 waiting (1 security): curl, gh");
    expect(facts.services).toBe(
      "shipify-box-homepi active, tailscaled failed, failed: tailscaled.service",
    );
    const earlier = boxFacts({
      ...none,
      read: (f) => (f.endsWith("get_throttled") ? "50000\n" : undefined),
    });
    expect(earlier.find((f) => f.name === "throttling")?.value).toBe(
      "not now; since boot: under-voltage, throttled",
    );
    expect(earlier.find((f) => f.name === "throttling")?.look).toBeUndefined();
  });

  it("marks what needs a look, for the status issue: throttled now, a failed service, a late restart, heat", async () => {
    const { boxFacts } = await import("../cli/lib/box-facts.ts");
    const restartAt = new Date(2026, 9, 1, 11, 12);
    const io = (temp: string, throttled: string, failed: string) => ({
      read: (f: string) =>
        ({
          "/sys/class/thermal/thermal_zone0/temp": temp,
          "/sys/devices/platform/soc/soc:firmware/get_throttled": throttled,
          "/etc/apt/apt.conf.d/52shipify-updates":
            'Unattended-Upgrade::Automatic-Reboot-Time "04:30";\n',
        })[f],
      exec: (cmd: string, args: string[]) =>
        ({
          "systemctl --version": "systemd 255\n",
          "systemctl list-unit-files --no-legend shipify-box-* tailscaled.service cockpit.socket":
            "shipify-box-homepi.service enabled enabled\n",
          "systemctl is-active shipify-box-homepi.service": failed ? "inactive\n" : "active\n",
          "systemctl list-units --failed --no-legend --plain": failed,
        })[[cmd, ...args].join(" ")] ?? "",
      changed: (f: string) => (f === "/run/reboot-required" ? restartAt : undefined),
    });
    const looks = (facts: { name: string; look?: string }[]) =>
      Object.fromEntries(facts.filter((f) => f.look).map((f) => [f.name, f.look]));
    // Fine: a restart waiting since this morning still has tonight's 04:30.
    expect(looks(boxFacts(io("53600", "0", ""), restartAt.getTime() + 3_600_000))).toEqual({});
    // Hot, throttled now, a service stopped and one failed, and the night's restart missed.
    expect(
      looks(
        boxFacts(
          io("81000", "4", "cockpit.socket loaded failed failed Cockpit\n"),
          restartAt.getTime() + 31 * 3_600_000,
        ),
      ),
    ).toEqual({
      temperature: "it's running hot, 81.0 °C",
      throttling: "it's throttled now: throttled",
      restart: "a restart has waited since Thu 1 Oct, 11:12: the 04:30 restart didn't happen",
      services: "failed: cockpit.socket; not running: shipify-box-homepi inactive",
    });
  });
});

describe("tasks: what the owner attaches", () => {
  // How GitHub renders a pasted image, an attached PDF and an outside image in a private repo.
  const IMG = "https://private-user-images.githubusercontent.com/1/2-abc.png?jwt=eyJ.a.b&X-Id=9";
  const html = [
    '<p dir="auto">What does this error mean?</p>',
    `<p><a target="_blank" href="${IMG.replace("&", "&amp;")}"><img width="800" alt="Image" src="${IMG.replace("&", "&amp;")}" style="max-width: 100%;"></a></p>`,
    '<p><a href="https://github.com/user-attachments/files/2222/router-manual.pdf">router-manual.pdf</a></p>',
    '<p><img src="https://camo.githubusercontent.com/xyz" data-canonical-src="https://example.com/a.png"></p>',
    '<video src="https://private-user-images.githubusercontent.com/1/3-v.mp4?jwt=eyJ.c.d" data-canonical-src="https://github.com/user-attachments/assets/v1" controls="controls" muted="muted"></video>',
  ].join("\n");

  it("finds the pasted images, names the files a box can't download, and counts videos", () => {
    expect(attachmentsIn(html)).toEqual({ images: [IMG], files: ["router-manual.pdf"], videos: 1 });
    expect(attachmentsIn("<p>No attachments.</p>")).toEqual({ images: [], files: [], videos: 0 });
  });

  it("saves the images for the agent and says what it couldn't get", async () => {
    const sb = sandbox();
    const dir = join(sb.dir, "files");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old.png"), "last round");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const get = async (url: string) =>
      url === IMG
        ? new Response(png, { headers: { "content-type": "image/png" } })
        : new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } });
    const { notes, unread, videos } = await saveAttachments(
      dir,
      [
        { where: "in the description", html },
        {
          where: "in the comment of t2",
          html: '<img src="https://github.com/user-attachments/assets/u1">',
        },
      ],
      get,
    );
    expect(existsSync(join(dir, "old.png"))).toBe(false);
    expect(readFileSync(join(dir, "1.png"))).toEqual(Buffer.from(png));
    expect(notes[0]).toContain(`\`${join(dir, "1.png")}\` (in the description)`);
    expect(notes.join("\n")).toContain("1 image(s) couldn't be downloaded");
    // The agent hears what it can't have, and that the reply already says so.
    expect(notes.join("\n")).toContain(
      "no key can download it (GitHub's rule for private repos): router-manual.pdf",
    );
    expect(notes.join("\n")).toContain("don't mention it: the reply already tells the owner");
    expect(notes.join("\n")).toContain("pasted a video, which you can't watch");
    expect(unread).toEqual(["router-manual.pdf"]);
    expect(videos).toBe(1);

    // Words taken in before it answers (ADR 0037): their images go beside the first ones, and the
    // agent says itself what it couldn't open, since the reply never read them.
    const later = await saveAttachments(dir, [{ where: "in the comment of t3", html }], get, true);
    expect(readFileSync(join(dir, "1.png"))).toEqual(Buffer.from(png));
    expect(readFileSync(join(dir, "2.png"))).toEqual(Buffer.from(png));
    expect(later.notes[0]).toContain(`\`${join(dir, "2.png")}\` (in the comment of t3)`);
    expect(later.notes.join("\n")).toContain("say in your reply that it couldn't be opened");
  });

  it("downloads files linked from the org's repos with the bot's key, and only those", async () => {
    const sb = sandbox();
    const dir = join(sb.dir, "files");
    const asked: { url: string; auth?: string }[] = [];
    const get = async (url: string, init?: RequestInit) => {
      asked.push({ url, auth: (init?.headers as Record<string, string>)?.authorization });
      if (url.includes("/missing.md")) return new Response("{}", { status: 404 });
      return new Response("# Notes\n\nhello", { headers: { "content-length": "15" } });
    };
    const texts = [
      "Read https://github.com/o/notes/blob/main/docs/plan.md and https://github.com/o/notes/blob/main/plan.md.",
      "Also https://github.com/o/notes/blob/v1/missing.md, https://github.com/other/x/blob/main/a.md and https://github.com/o/notes/blob/main/bad%E0%A4.md",
    ];
    const notes = await saveLinkedFiles(dir, texts, "o", get, "bot-key");
    // Two files of one name both kept; another org's link is the agent's to fetch.
    expect(readFileSync(join(dir, "plan.md"), "utf8")).toBe("# Notes\n\nhello");
    expect(existsSync(join(dir, "2-plan.md"))).toBe(true);
    expect(asked.map((a) => a.url)).not.toContain(expect.stringContaining("/other/"));
    expect(asked[0]).toEqual({
      url: "https://api.github.com/repos/o/notes/contents/docs/plan.md?ref=main",
      auth: "Bearer bot-key",
    });
    expect(notes[0]).toContain("The owner linked files, saved on this box.");
    // A file that isn't there, and a link that can't be read, say so and stop nothing.
    expect(notes[1]).toContain("missing.md (HTTP 404)");
    expect(notes[1]).toContain("bad%E0%A4.md (URI malformed)");
    // Without the bot's key: nothing to download with.
    expect(await saveLinkedFiles(dir, texts, "o", get, "")).toEqual([
      "The owner linked files in the org's repos, but this run has no bot key to read them: ask for the text if you need it.",
    ]);
    expect(await saveLinkedFiles(dir, ["no links here"], "o", get, "bot-key")).toEqual([]);
  });

  it("keeps two chat files of one name: every Telegram photo is photo.jpg", () => {
    const dir = join(sandbox().dir, "files");
    mkdirSync(dir, { recursive: true });
    const names = ["photo.jpg", "photo.jpg", "photo.jpg", "notes.pdf"].map((name, i) => {
      const file = freeFile(dir, name);
      writeFileSync(file, `file ${i}`);
      return file.slice(dir.length + 1);
    });
    expect(names).toEqual(["photo.jpg", "2-photo.jpg", "3-photo.jpg", "notes.pdf"]);
    expect(readFileSync(join(dir, "photo.jpg"), "utf8")).toBe("file 0");
    expect(readFileSync(join(dir, "2-photo.jpg"), "utf8")).toBe("file 1");
  });
});

describe("tasks that repeat: schedules", () => {
  // The owner's zone, as the CLI hands it in at its start (ADR 0047): IST here.
  beforeAll(() => useTimeZone("Asia/Kolkata"));
  afterAll(() => useTimeZone(undefined));
  const tz = "Asia/Kolkata";
  const at = (iso: string) => new Date(iso);
  const next = (text: string, after: string, zone = tz) => {
    const s = parseSchedule(text);
    if (!s) throw new Error(`can't read ${text}`);
    return nextRun(s, at(after), zone).toISOString();
  };

  it("reads schedules in plain words, and writes them back the same way", () => {
    const cases: [string, string | undefined][] = [
      ["every day at 09:00", "every day at 09:00"],
      ["daily 9am", "every day at 09:00"],
      ["every day", "every day at 09:00"],
      ["every weekday at 8:30", "every weekday at 08:30"],
      ["every Monday at 9", "every Monday at 09:00"],
      ["weekly on Friday 17:00", "every Friday at 17:00"],
      ["every mon at 9:30pm", "every Monday at 21:30"],
      ["on the 1st of every month at 09:00", "on the 1st of every month at 09:00"],
      ["monthly on the 15th", "on the 15th of every month at 09:00"],
      ["every hour", "every hour"],
      ["hourly", "every hour"],
      ["every 1 hour", "every hour"],
      ["every 6 hours", "every 6 hours"],
      ["every half hour", "every 30 minutes"],
      ["every 90 mins", "every 90 minutes"],
      ["every 120 minutes", "every 2 hours"],
      ["every 30 minutes from 08:15", "every 30 minutes from 08:15"],
      ["every 2 hours from 9am to 9pm", "every 2 hours from 09:00 to 21:00"],
      ["hourly between 9 and 18", "every hour from 09:00 to 18:00"],
      ["every hour until 17:00", "every hour from 00:00 to 17:00"],
      ["every 0 hours", undefined],
      ["every 25 hours", undefined],
      ["every hour from 18:00 to 09:00", undefined],
      ["every hour from noonish", undefined],
      ["every 2 days", undefined],
      ["every day at 25:00", undefined],
      ["sometimes", undefined],
      // Your own zone may be said (every repeat runs in it); another can't be, and is refused.
      ["every Sunday at 2 pm IST", "every Sunday at 14:00"],
      ["every day at 09:00 Asia/Kolkata", "every day at 09:00"],
      ["every day at 09:00 PST", undefined],
    ];
    for (const [text, want] of cases) {
      const s = parseSchedule(text);
      expect(s ? describeSchedule(s) : undefined, text).toBe(want);
      if (s) expect(describeSchedule(parseSchedule(describeSchedule(s)) as Schedule)).toBe(want);
    }
  });

  it("finds the next time in the owner's time zone", () => {
    // Thursday 1 Oct 2026, 11:30 in India.
    const now = "2026-10-01T06:00:00Z";
    expect(next("every day at 09:00", now)).toBe("2026-10-02T03:30:00.000Z");
    expect(next("every day at 12:00", now)).toBe("2026-10-01T06:30:00.000Z");
    expect(next("every Monday at 9", now)).toBe("2026-10-05T03:30:00.000Z");
    // Friday evening: the next weekday is Monday.
    expect(next("every weekday at 8:30", "2026-10-02T15:00:00Z")).toBe("2026-10-05T03:00:00.000Z");
    // The 31st falls on the last day of shorter months.
    expect(next("on the 31st of every month at 10:00", "2027-02-01T00:00:00Z")).toBe(
      "2027-02-28T04:30:00.000Z",
    );
  });

  it("finds the next time of a schedule that repeats within the day", () => {
    // Thursday 1 Oct 2026, 11:30 in India.
    const now = "2026-10-01T06:00:00Z";
    expect(next("every hour", now)).toBe("2026-10-01T06:30:00.000Z"); // 12:00
    expect(next("every 6 hours", now)).toBe("2026-10-01T06:30:00.000Z"); // 12:00
    expect(next("every 6 hours", "2026-10-01T06:30:00Z")).toBe("2026-10-01T12:30:00.000Z"); // 18:00
    // Counted from the start of each day, as cron does: 00:00, 00:45, … 11:15, 12:00.
    expect(next("every 45 minutes", now)).toBe("2026-10-01T06:30:00.000Z"); // 12:00
    expect(next("every hour from 00:30", now)).toBe("2026-10-01T07:00:00.000Z"); // 12:30
    // After the window's last time, the first time of the next day.
    expect(next("every hour from 09:00 to 21:00", "2026-10-01T16:00:00Z")).toBe(
      "2026-10-02T03:30:00.000Z",
    );
    // 00:00, 05:00, 10:00, 15:00, 20:00, then 00:00 again.
    expect(next("every 5 hours", "2026-10-01T15:30:00Z")).toBe("2026-10-01T18:30:00.000Z");
  });

  it("keeps the wall-clock time across a clock change", () => {
    // London leaves summer time on 25 Oct 2026: 09:00 is 08:00 UTC before and 09:00 UTC after.
    expect(next("every day at 09:00", "2026-10-24T12:00:00Z", "Europe/London")).toBe(
      "2026-10-25T09:00:00.000Z",
    );
    expect(next("every day at 09:00", "2026-10-23T12:00:00Z", "Europe/London")).toBe(
      "2026-10-24T08:00:00.000Z",
    );
  });

  it("reads the Repeat form and the stop and resume comments", () => {
    const body =
      "### What\n\nLook at the servers\n\n### When\n\nevery day at 09:00\n\n### Kind\n\nA reminder (posts the text; no agent)";
    expect(repeatForm(taskForm(body, FORMS))).toEqual({
      what: "Look at the servers",
      when: "every day at 09:00",
      kind: "reminder",
    });
    const agent = body.replace(
      "A reminder (posts the text; no agent)",
      "A job for the agent (quiet when there's nothing to do)",
    );
    expect(repeatForm(taskForm(agent, FORMS))?.kind).toBe("agent");
    expect(
      repeatForm(
        taskForm("### What\n\n_No response_\n\n### When\n\ndaily\n\n### Kind\n\nA reminder", FORMS),
      ),
    ).toBeUndefined();
    expect(repeatForm(taskForm(null, FORMS))).toBeUndefined();
    expect(wordOf("Stop repeating.")).toBe("stop repeating");
    expect(wordOf("stop repeating this and also fix X")).toBeUndefined();
    expect(wordOf("resume")).toBe("resume");
    expect(wordOf("resume and change it to 8am")).toBeUndefined();
  });
});
