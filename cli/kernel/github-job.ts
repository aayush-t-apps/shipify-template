// The github job (ADR 0030 §0, ADR 0031): what needs keys a box must never hold, on GitHub's
// machines, with no agent. It runs only what the task's status already has pending, once: a merged
// plan's repo and keys, an operation, or closing the PRs of a task closed as not planned. A replay
// finds nothing pending and does nothing.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseApp } from "../commands/evolve.ts";
import { lifecycle } from "../commands/operate.ts";
import { prepareRepo, repoSpecFromPlan } from "../commands/project.ts";
import { templateRelease } from "../commands/template.ts";
import { timeZone } from "../commands/task/context.ts";
import { publishNeeds, wouldStop } from "../commands/task/plans.ts";
import { problem, renderProblem } from "../contracts/index.ts";
import { run } from "../lib/exec.ts";
import { gh, platformRepo, repoOfPr, withToken } from "../lib/github.ts";
import { ok, type Result } from "../lib/output.ts";
import { gitConfig, keyFor } from "../lib/clones.ts";
import { repoFor } from "../lib/projects-on-github.ts";
import { tryStatusIssue } from "../lib/status-issue.ts";
import { apply } from "./apply.ts";
import { buildBrief } from "./decide.ts";
import { outward } from "./door.ts";
import type { Plan, Snapshot, Write } from "./types.ts";

export async function githubJob(s: Snapshot, p: Extract<Plan, { do: "github" }>): Promise<Result> {
  const st = p.state;
  const writes: Write[] = [];
  const say = (
    kind: "answer" | "needs-you" | "failed",
    state: string,
    text: string,
    step: string,
  ) => writes.push({ w: "reply", kind, state, text, step, occasion: s.run.id });

  if (p.job === "prepare" && st.pending.prepare) {
    // publish (GitHub only) makes them again, on purpose.
    const plan = st.pending.prepare.plan;
    st.pending.prepare = undefined;
    const missing = publishNeeds(plan);
    let stop = missing;
    if (!stop.length)
      try {
        const prep = prepareRepo(repoSpecFromPlan(plan));
        stop = prep.checks.map((c) => `${c.name}: ${c.fix}`);
        if (!stop.length) {
          st.built = plan;
          st.pending.work = {
            project: plan,
            brief: buildBrief(plan),
            at: s.now,
          };
          writes.push({ w: "dispatch", job: "run" });
          say(
            "answer",
            "Working",
            `${prep.web} is ready, with its settings and keys. Building **${plan}** on a box now.`,
            "prepare",
          );
        }
      } catch (e) {
        stop = [(e as Error).message];
      }
    if (stop.length) {
      st.phase = "needs-you";
      say("needs-you", "Needs you", wouldStop(plan, stop), "prepare-stopped");
    }
  } else if (p.job === "operate" && st.pending.operate) {
    const { op, version, bump } = st.pending.operate;
    st.pending.operate = undefined;
    const id = st.project ?? "";
    try {
      if (op === "release" && id === platformRepo().split("/")[1]) {
        // Shipify itself (docs/releases.md): checked, its version recorded on main, its own files
        // published to the template, with the bot's keys. Started on GitHub, as every operation.
        const r = templateRelease({ yes: true, inJob: true, bump });
        st.phase = r.status === "succeeded" || r.status === "skipped" ? "done" : "failed";
        say(
          r.status === "succeeded" || r.status === "skipped" ? "answer" : "failed",
          st.phase === "done" ? "Done" : "Failed",
          `${r.summary}.`,
          "release",
        );
        if (st.phase === "done") writes.push({ w: "close", reason: "completed" });
      } else if (op === "release") {
        // GitHub's machine has no clone of the app: release works in a fresh one, with the bot's
        // token for its git calls (in the environment, never written to a file).
        const r = await withClone(id, (dir) => releaseApp(dir, true, { task: s.n }));
        const url = (r.data as { url?: string } | undefined)?.url;
        if (url) {
          st.prs = [...new Set([...(st.prs ?? []), url])];
          st.phase = "needs-you";
          // Followed by the watch (deploying): its merge, then its production deploy, then "Live".
          const repo = repoOfPr(url);
          if (repo) {
            st.pending.release = { repo, pr: url, at: s.now };
            writes.push({ w: "labels", add: ["deploying"] });
          }
          writes.push({
            w: "reply",
            kind: "needs-you",
            state: "Needs you",
            text: `The release PR is open: merge it to go live (${r.summary}).`,
            step: "release",
            links: [["Release PR", url]],
            occasion: s.run.id,
          });
        } else {
          // The next version on its way to staging (release again once it passes), staging not
          // there yet, or nothing to release: said once, and nothing waits (ADR 0048).
          const said = r.status === "succeeded" || r.status === "skipped" || r.status === "blocked";
          say(
            said ? "answer" : "failed",
            said ? "Done" : "Failed",
            `${r.summary}.${r.status === "succeeded" || r.status === "blocked" ? ` Once staging passes it, release it: a task \`${id}: release\`.` : ""}`,
            "release",
          );
          if (said) {
            st.phase = "done";
            writes.push({ w: "close", reason: "completed" });
          }
        }
      } else {
        const r = lifecycle(id, op, true, version);
        // Down on purpose, or back: the watch's health check follows the status record.
        if (op === "down" || op === "up")
          tryStatusIssue(
            (x) => {
              const a = x.apps.find((y) => y.id === id);
              if (a) {
                a.paused = op === "down" ? true : undefined;
                a.failing = undefined;
              } else if (op === "down") x.apps.push({ id, paused: true });
              return undefined;
            },
            { timeZone: timeZone() },
          );
        st.phase = "done";
        say(
          "answer",
          "Done",
          `${r.summary.replace(/^started: /, "Started: ")}. The run is in the project's Actions.`,
          op,
        );
        writes.push({ w: "close", reason: "completed" });
      }
    } catch (e) {
      const pr = problem("unexpected", { first_line: (e as Error).message });
      st.phase = "failed";
      writes.push({
        w: "reply",
        kind: "failed",
        state: "Failed",
        text: renderProblem(pr),
        step: op,
        problem: pr,
        occasion: s.run.id,
      });
    }
  } else if (p.job === "close-prs" && st.pending.closePrs?.length) {
    const unclosed: string[] = [];
    for (const url of st.pending.closePrs)
      try {
        // A PR on another of your accounts (ADR 0045) is closed with the repos App's token there,
        // which this job mints for the task's account; the bot's own otherwise.
        const theirs = repoOfPr(url)?.split("/")[0]?.toLowerCase() === s.account?.login;
        const close = () =>
          gh([
            "pr",
            "close",
            url,
            "--delete-branch",
            "--comment",
            st.phase === "dropped"
              ? "Its task was closed as not planned."
              : "You said `start over`: this PR is replaced by a new one.",
          ]);
        if (s.account && theirs) {
          // No token for it: the repos App isn't on that account now, or GitHub refused it.
          if (!process.env.SHIPIFY_ACCOUNT_TOKEN) throw new Error("no token for that account");
          withToken(process.env.SHIPIFY_ACCOUNT_TOKEN, close);
        } else close();
        st.prInfo = {
          ...(st.prInfo ?? {}),
          [url]: { kind: st.prInfo?.[url]?.kind ?? "code", state: "closed" },
        };
      } catch {
        unclosed.push(url);
      }
    st.pending.closePrs = undefined;
    // Told once, with the fix: closed on GitHub by hand, or the App put back where it's missing.
    if (unclosed.length)
      say(
        "needs-you",
        "Needs you",
        `These PRs couldn't be closed, so close them on GitHub:\n${unclosed.map((u) => `- ${u}`).join("\n")}${s.account ? `\n\nOn \`${s.account.login}\`, the repos App needs to be installed there with that repo chosen.` : ""}`,
        "close-prs",
      );
  } else return ok("run github", `task #${s.n}: nothing pending`);

  await apply(s, st, writes, { ...outward(), tokens: {} });
  return ok("run github", `task #${s.n}: ${p.job}`);
}

/**
 * A fresh clone of an app on GitHub's machine, for what needs one (a release): git authenticates
 * with the bot's token through the environment (GIT_CONFIG_*), never a file, and commits as the bot.
 */
async function withClone<T>(id: string, act: (dir: string) => Promise<T>): Promise<T> {
  const token = process.env.GH_TOKEN ?? "";
  const repo = repoFor(id);
  const was = { ...process.env };
  Object.assign(
    process.env,
    gitConfig([
      keyFor(token),
      ["user.name", "shipify[bot]"],
      ["user.email", "shipify-bot@users.noreply.github.com"],
    ]),
  );
  const dir = mkdtempSync(join(tmpdir(), "shipify-release-"));
  try {
    const r = run("git", ["clone", "-q", `https://github.com/${repo}.git`, dir]);
    if (r.code !== 0) throw new Error(`couldn't clone ${repo}: ${r.stderr.trim().slice(0, 200)}`);
    return await act(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) if (!(k in was)) delete process.env[k];
  }
}
