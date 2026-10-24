#!/usr/bin/env node
// ship: the one interface to Shipify for humans, agents and CI. Run `pnpm ship help`.
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { doorCheck, doorSetup } from "../edge/setup/door.ts";
import { doorPage } from "../edge/setup/page.ts";
import { add, remove } from "./commands/add.ts";
import { botSetup, reposAccount } from "./commands/bot.ts";
import {
  boxAdd,
  boxHealth,
  boxList,
  boxLogs,
  boxPeek,
  boxRemove,
  boxStart,
  boxStatus,
  boxStop,
} from "./commands/box.ts";
import { doctor } from "./commands/doctor.ts";
import { changeCheck, changeNew, changeSubmit, releaseApp, versionApp } from "./commands/evolve.ts";
import { notebookList, notebookRead } from "./commands/notebook.ts";
import {
  catalog,
  lifecycle,
  list,
  reconcile,
  register,
  status,
  unregister,
} from "./commands/operate.ts";
import { planCheck, planNew, planSubmit } from "./commands/plan.ts";
import { pluginsList, selftest } from "./commands/plugins.ts";
import {
  buildProject,
  newProject,
  publishProject,
  validateProject,
  verifyProject,
} from "./commands/project.ts";
import { setup } from "./commands/setup.ts";
import { taskPlans } from "./commands/task.ts";
import { toolsCheck, toolsList } from "./commands/tools.ts";
import { stagingSwitch, upgradeProject } from "./commands/upgrade.ts";
import { watchAlert, watchCleanup, watchDue } from "./commands/watch.ts";
import { shipUpdate, templateRelease } from "./commands/template.ts";
import { forms, openPr, prCheck, refresh, sync } from "./commands/workspace.ts";
import { useDefaultAgent } from "./contracts/answers.ts";
import { useTimeZone } from "./contracts/zone.ts";
import { copyTimeZone } from "./lib/config.ts";
import { BUMPS, type Bump } from "./lib/docs.ts";
import { EXIT_CODES, type Result, render, ShipError } from "./lib/output.ts";

const HELP = `ship: plan, build, ship and maintain Shipify projects (apps and packages)

  Tasks are issues on shipify, or messages to the bot (a title like \`<repo>: …\`, \`ask: …\`, \`new: …\`,
  \`remember: …\`, \`repeat: …\`, or the Operate and Repeat forms). Which one: the README's "Task, repeat,
  recipe or check?". Each runs on a box: task, plan, think (the agent, as its own user), decide, apply.

  Set up and check (docs/getting-started.md)
  setup                                     Shipify set up from nothing, a step at a time
  setup <step> [--new]                      one step's part here, an add-on's too (apps, updates):
                                            the keys you paste, hidden, and its values (--new: a key again)
  doctor [--yes]                            check tools, the GitHub login, the credentials stacks need, the
                                            watch and the box setup (--yes: tell the watch when this PC's token expires)
  stacks | presets                          what you can build with
  plugins                                   every kind of plug-in: its contract, its test, what's there now
  selftest [<part>|<plug-in>|<agent>]       each built part's live check, end to end (docs/plug-ins.md):
                                            core, door, chat, sandbox, act, notebook, or a plug-in's own check
                                            (ship add set it up; a gateway: its key, taken by it), or an agent
                                            answering a question (one model call, asked through your Telegram,
                                            so its answer comes there); all (the default): every part and
                                            every plug-in set up here

  The door, the status page, plug-ins and the notebook (ADR 0031, ADR 0032)
  door setup [--new [--key file.pem]] [--code <code>] [--yes] | door check
                                            the edge's door App (ADR 0031): made from a manifest (two clicks),
                                            its key put on the edge, its variables set (--new: a new key for
                                            it); the edge, the App and the door's route, checked
  door page [--yes]                         the status page and the chat (ADR 0032, 0036): one Access
                                            application for /admin/*, its two public values saved, the
                                            sign-in checked
  notebook [list] | notebook read "<topic>"   the notebook (docs/notebook.md): its pages, one in full (on a box)
  add <name> [--new] [--yes] · remove <name> [--yes]
                                            set up a plug-in from its entry's setup (tools.json), one checked
                                            step at a time (--new: paste every key again), or a gateway's key
                                            (executors.json's gateways); or undo it

  Create (docs/process.md)
  plan new <id> --stack <id> [--preset <id>] [--visibility public|private] [--title ..] [--summary ..]
  plan check <id> | plan submit <id> [--yes]        the plan PR (merge = approval)
  build <id> [--executor <id>] [--resume] [--source <dir>] [--into <dir>]   build an approved plan
  new <id> --stack <id> [--preset <id>] [--staging] [--secrets A,B] [--options <a,b>] [--service <name>] [--source <dir>]
      [--visibility ..] [--description ..] [--output <dir>] [--dry-run] [--skip-install] [--skip-verify]
  validate <path> | verify <path>           the Shipify contract / make verify
  publish <path> [--yes]                    create the repo, settings, variables, secrets; push

  Evolve
  <p> is a project id, or the path of any checkout of it (a worktree: playbooks/parallel-work.md)
  change new <p> <slug> [--title ..] [--bump patch|minor|major]    a change doc (RFC)
  change check <p> <n> | change submit <p> <n> [--yes]             check it / open its docs-only PR
  version <p> [patch|minor|major]           bump shipify.json + CHANGELOG, then make version (default: from change docs)
  release <id> [--yes]                      staging apps: bump, wait for staging, open "Release vX.Y.Z"
  upgrade <p> [--yes]                       apply the current stack version
  staging <p> on|off [--yes]                staging for an app: on (release PRs go live) or off (merges go live)
  pr <p> [--task <n>] [--title ..] [--summary ..] [--part-of] [--preview] [--no-verify] [--yes]
                                            push the branch, open its PR (--preview: CI makes a link)
  pr <p> --check                            what its PR needs besides tests (versions, changelog, change docs)
  refresh <p> [--no-fetch]                  merge main into a branch; redo its version bump

  Tasks and boxes (docs/tasks.md)
  sync [<id>]                               clone and index the org's projects on this machine
  forms [--yes]                             keep the task forms' project lists current (a PR)
  box add [<user@host>] [--name ..] [--slots N] [--manage] [--replace] [--yes]   make a box: a Pi, laptop
                                            or VPS over SSH, or this PC with no target (the same setup)
                                            (Ubuntu Server 24.04 LTS or newer; a new box has a slot per core, as memory fits)
                                            (--slots: tasks at once, 1-9)
                                            (--manage: Tailscale + Cockpit, to manage it from a browser;
                                             on this machine, a box you keep, which never sleeps)
                                            (--container: in the box's Docker image, which docker run … register runs)
  box list | box remove <name> [--purge] [--yes]   the boxes, online or not; one gone
                                            (--purge, on the machine itself: Shipify off it too)
  box status | start | stop | restart [<name>|--name ..] [--yes]   this machine's box (start, stop: sudo)
  box logs [<name>] [-f] | box peek [-f]    its log, and what the agent is doing now (-f, --follow: keep reading)
  box health [<user@host>]                  disk, memory, temperature, updates, services: here or over SSH

  Releases and updates (docs/releases.md)
  template [<owner/repo>] [--bump minor|major] [--yes]   release Shipify: check it, set its version, record it
                                            here, publish its own files to the template (the first time: make it)
  update [--yes]                            this copy: the template's newest release, offered as one PR
  tools list | tools check                  the tools tasks can use (tools.json), and whether each server matches it
  bot [--yes]                               register the bot that opens task PRs (two clicks)
  bot repos [--yes]                         register the repos App, for your other accounts
  bot repos <account> [--remove] [--yes]    add (or take off) one of your accounts, and install the App
  bot --code <code> --yes                   finish a bot GitHub created, with the code in its page's address
  run task|plan|agent|think|decide|apply|github|failed <n>   (task.yml's steps, ADR 0031: read the
                                            task and its account (ADR 0045); decide; its agent installed
                                            on the box (ADR 0038); the agent, in the slot's sandbox; its
                                            result into writes; the writes; the github job's pending
                                            work; a failure, said)
  task plans <before> <after>               (task.yml, on a push to main: merged plans start their tasks)
  watch due · watch cleanup [<box>] · watch alert '<findings>'   (watch.yml calls these, docs/watch.md)

  Operate
  list | status <id> | reconcile | register <path> | unregister <id>
  rollback <id> [--to vX.Y.Z] [--yes]
  down <id> [--yes] | up <id> [--yes]       take an app offline until further notice / bring it back

  --json for machine output. External writes need --yes; without it you get the plan of action.
  -h, --help after any command prints this. Every command, with what it changes: docs/cli.md.
  Exit codes: 0 ok, skipped, or a plan shown (requires-approval: add --yes), 1 failed, 2 blocked,
  4 unsupported.`;

/** A release's step, from --bump. */
function bumpOf(value: string): Bump {
  if (!BUMPS.includes(value as Bump))
    throw new ShipError("--bump is patch, minor or major.", "blocked");
  return value as Bump;
}

async function main(argv: string[]): Promise<Result> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "skip-install": { type: "boolean", default: false },
      "skip-verify": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      staging: { type: "boolean", default: false },
      stack: { type: "string" },
      preset: { type: "string" },
      source: { type: "string" },
      into: { type: "string" },
      secrets: { type: "string", default: "" },
      options: { type: "string" },
      service: { type: "string" },
      visibility: { type: "string", default: "private" },
      description: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      output: { type: "string" },
      executor: { type: "string" },
      to: { type: "string" },
      bump: { type: "string" },
      task: { type: "string" },
      name: { type: "string" },
      "part-of": { type: "boolean", default: false },
      "no-verify": { type: "boolean", default: false },
      "no-fetch": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      preview: { type: "boolean", default: false },
      follow: { type: "boolean", short: "f", default: false },
      manage: { type: "boolean", default: false },
      container: { type: "boolean", default: false },
      replace: { type: "boolean", default: false },
      purge: { type: "boolean", default: false },
      slots: { type: "string" },
      code: { type: "string" },
      new: { type: "boolean", default: false },
      remove: { type: "boolean", default: false },
      key: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [cmd, a1, a2, a3] = positionals;
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new ShipError(`Missing ${what}. Run: pnpm ship help`, "blocked");
    return v;
  };
  if (values.visibility !== "public" && values.visibility !== "private") {
    throw new ShipError("--visibility must be public or private", "blocked");
  }
  const visibility = values.visibility;

  if (values.help) return { command: "help", status: "succeeded", summary: "usage", data: HELP };
  switch (cmd) {
    case undefined:
    case "help":
      return { command: "help", status: "succeeded", summary: "usage", data: HELP };
    case "doctor":
      return doctor({ yes: values.yes });
    case "stacks":
    case "presets":
      return catalog(cmd);
    case "plan":
      if (a1 === "new") {
        return planNew({
          app: need(a2, "<id>"),
          stack: need(values.stack, "--stack"),
          preset: values.preset ?? "none",
          visibility,
          title: values.title,
          summary: values.summary,
        });
      }
      if (a1 === "check") return planCheck(need(a2, "<id>"));
      if (a1 === "submit") return planSubmit(need(a2, "<id>"), values.yes);
      throw new ShipError("Use: plan new | plan check | plan submit", "blocked");
    case "build":
      return buildProject({
        id: need(a1, "<id>"),
        executor: values.executor,
        resume: values.resume,
        source: values.source,
        into: values.into,
      });
    case "new":
      return newProject({
        name: need(a1, "<id>"),
        stack: need(values.stack, "--stack"),
        preset: values.preset ?? null,
        description: values.description ?? `${a1}`,
        visibility,
        staging: values.staging,
        secrets: values.secrets.split(",").filter(Boolean),
        service: values.service,
        options: (values.options ?? "").split(",").filter(Boolean),
        source: values.source,
        output: values.output,
        install: !values["skip-install"],
        verify: !values["skip-install"] && !values["skip-verify"],
        dryRun: values["dry-run"],
      });
    case "validate":
      return validateProject(need(a1, "<path>"));
    case "verify":
      return verifyProject(need(a1, "<path>"));
    case "publish":
      return publishProject(need(a1, "<path>"), values.yes);
    case "change": {
      const id = need(a2, "<id>");
      if (a1 === "new")
        return changeNew(id, need(a3, "<slug>"), { title: values.title, bump: values.bump });
      const n = Number(need(a3, "<n>"));
      if (a1 === "check") return changeCheck(id, n);
      if (a1 === "submit") return changeSubmit(id, n, values.yes);
      throw new ShipError("Use: change new | change check | change submit", "blocked");
    }
    case "version":
      return versionApp(need(a1, "<id>"), a2);
    case "release":
      return releaseApp(need(a1, "<id>"), values.yes);
    case "upgrade":
      return upgradeProject(need(a1, "<id>"), values.yes);
    case "staging": {
      const word = need(a2, "on|off");
      if (word !== "on" && word !== "off")
        throw new ShipError("Use: pnpm ship staging <p> on|off", "blocked");
      return stagingSwitch(need(a1, "<p>"), word === "on", values.yes);
    }
    case "pr":
      if (values.check) return prCheck(need(a1, "<p>"));
      return openPr(need(a1, "<p>"), {
        task: values.task ? Number(values.task) : undefined,
        title: values.title,
        summary: values.summary,
        partOf: values["part-of"],
        verify: !values["no-verify"],
        preview: values.preview,
        yes: values.yes,
      });
    case "refresh":
      return refresh(need(a1, "<p>"), !values["no-fetch"]);
    case "sync":
      return sync(a1);
    case "forms":
      return forms(values.yes);
    case "box":
      if (a1 === "add")
        return boxAdd(a2, {
          name: values.name,
          manage: values.manage,
          replace: values.replace,
          slots: values.slots,
          container: values.container,
          yes: values.yes,
        });
      if (a1 === "list") return boxList();
      if (a1 === "remove") return boxRemove(need(a2, "<name>"), values.yes, values.purge);
      if (a1 === "status") return boxStatus(values.name ?? a2);
      if (a1 === "start") return boxStart(values.name ?? a2);
      if (a1 === "stop" || a1 === "restart") return boxStop(a1, values.name ?? a2, values.yes);
      if (a1 === "logs") return boxLogs(values.name ?? a2, values.follow);
      if (a1 === "peek") return boxPeek(values.follow);
      if (a1 === "health") return boxHealth(a2);
      throw new ShipError(
        "Use: box add | list | status | start | stop | restart | logs | peek | health | remove",
        "blocked",
      );
    case "template":
      return templateRelease({
        repo: a1,
        ...(values.bump ? { bump: bumpOf(values.bump) } : {}),
        yes: values.yes,
      });
    case "update":
      return shipUpdate({ yes: values.yes });
    case "watch":
      if (a1 === "due") return watchDue();
      if (a1 === "cleanup") return watchCleanup(a2);
      if (a1 === "alert") return watchAlert(a2);
      throw new ShipError("Use: watch due | cleanup [<box>] | alert '<findings>'", "blocked");
    case "plugins":
      return pluginsList();
    case "door":
      if (a1 === "setup")
        return doorSetup(values.yes, { renew: values.new, code: values.code, key: values.key });
      if (a1 === "check") return doorCheck();
      if (a1 === "page") return doorPage(Boolean(values.yes));
      throw new ShipError(
        "Use: door setup [--new] [--yes] | door check | door page [--yes]",
        "blocked",
      );
    case "setup":
      return setup({
        interactive: values.json ? false : undefined,
        step: a1,
        renew: values.new,
      });
    case "add":
      return add(need(a1, "<name>"), values.yes, {
        interactive: values.json ? false : undefined,
        renew: values.new,
      });
    case "remove":
      return remove(need(a1, "<name>"), values.yes);
    case "notebook":
      if (a1 === "read") return notebookRead(a2);
      if (a1 === "list" || !a1) return notebookList();
      throw new ShipError('Use: notebook [list] | notebook read "<topic>"', "blocked");
    case "selftest":
      return selftest(a1 ?? "all");
    case "tools":
      if (a1 === "check") return toolsCheck();
      if (a1 === "list" || !a1) return toolsList();
      throw new ShipError("Use: tools list | check", "blocked");
    case "bot":
      // The repos App (ADR 0045): set up once, then each of your other accounts.
      if (values.remove && (a1 !== "repos" || !a2))
        throw new ShipError(
          "Name the account to take off: bot repos <account> --remove",
          "blocked",
        );
      if (a1 === "repos")
        return a2
          ? reposAccount(a2, values.yes, values.remove)
          : botSetup(values.yes, values.code, "repos");
      if (a1)
        throw new ShipError("Use: bot | bot repos | bot repos <account> [--remove]", "blocked");
      return botSetup(values.yes, values.code);
    case "run": {
      const n = Number(need(a2, "<n>"));
      const { isStep, runFailed, runStep, stepLine } = await import("./kernel/run.ts");
      // One timing line per step on the run's summary (ADR 0051 B0): what the fixed part costs.
      const timed = (step: string, run: () => Promise<Result>): Promise<Result> => {
        const started = Date.now();
        return run().finally(() => {
          const summary = process.env.GITHUB_STEP_SUMMARY;
          // Only a measure: a summary it can't write never hides the step's own outcome.
          try {
            if (summary) appendFileSync(summary, `\n${stepLine(step, Date.now() - started)}\n`);
          } catch {}
        });
      };
      if (isStep(a1)) return timed(a1, () => runStep(a1, n));
      if (a1 === "failed") return timed("failed", () => runFailed(n));
      throw new ShipError(
        "Use: run task | plan | agent | think | decide | apply | github | failed <n>",
        "blocked",
      );
    }
    case "task": {
      // A push of merged plans: each one's task gets its repo and keys made, then its build.
      if (a1 === "plans") return taskPlans(need(a2, "<before>"), need(a3, "<after>"));
      throw new ShipError(
        "Use: task plans <before> <after> (a run's steps are `ship run`)",
        "blocked",
      );
    }
    case "list":
      return list();
    case "status":
      return status(need(a1, "<id>"));
    case "reconcile":
      return reconcile();
    case "register":
      return register(need(a1, "<path>"));
    case "unregister":
      return unregister(need(a1, "<id>"));
    case "rollback":
      return lifecycle(need(a1, "<id>"), "rollback", values.yes, values.to);
    case "down":
    case "up":
      return lifecycle(need(a1, "<id>"), cmd, values.yes);
    default:
      return {
        command: cmd,
        status: "unsupported",
        summary: "unknown command. Run: pnpm ship help",
      };
  }
}

const argv = process.argv.slice(2);
const json = argv.includes("--json");
// Your copy's time zone (ADR 0047), once for the whole command: repeats and times read it. And
// its default agent (SHIPIFY_AGENT, a run's SHIPIFY_EXECUTOR), first in what the chats are told.
useTimeZone(copyTimeZone());
useDefaultAgent(process.env.SHIPIFY_EXECUTOR);
main(argv)
  .catch((e: unknown): Result => {
    if (e instanceof ShipError)
      return { command: argv[0] ?? "ship", status: e.status, summary: e.message, checks: e.checks };
    return {
      command: argv[0] ?? "ship",
      status: "failed",
      summary: (e as Error).message ?? String(e),
    };
  })
  .then((result) => {
    process.stdout.write(`${render(result, json)}\n`);
    process.exitCode = EXIT_CODES[result.status];
  });
