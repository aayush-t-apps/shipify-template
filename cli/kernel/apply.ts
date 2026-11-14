// Apply (ADR 0031): the one place a run changes anything. It makes decide's writes in order, each
// safe to repeat (a reply's key, a journal line before an outside change), saves the status last,
// and tells the door of each new reply. It never runs code the agent wrote: a PR is pushed from the
// agent's bundle, fetched into apply's own clone with git's hooks and monitors off.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { queue, rec, thisRun, timeZone } from "../commands/task/context.ts";
import { publishedDeploy } from "../commands/task/deploys.ts";
import { fileHash, publishMade } from "../commands/task/files.ts";
import { Status, type StatusIssue } from "../commands/task/issue.ts";
import {
  forget,
  forgetFor,
  pagesTo,
  remember,
  rememberFor,
  setPersonality,
  writePages,
} from "../commands/task/notebook.ts";
import { CLEAN_CLOSED, closeQuiet } from "../commands/task/sweep.ts";
import {
  asProblem,
  errorLine,
  FIRST_LABEL,
  fileRefOf,
  inertImages,
  type Link,
  MAX_FILES_OUT,
  maskSecrets,
  type Problem,
  problem,
  type ReplyLine,
  readReply,
  renderProblem,
  replyLine,
  RUN_WRITER,
  STARTED_LABEL,
  type ToolResult,
} from "../contracts/index.ts";
import { accountOf } from "../lib/accounts.ts";
import { modelLabel } from "../lib/agents.ts";
import { cloneArgs, gitEnv, githubUrl } from "../lib/clones.ts";
import { gh, ghRun, previewLabel, withToken } from "../lib/github.ts";
import { madeWith, taskLine } from "../lib/links.ts";
import type { RecordComment, RecordWrite } from "../lib/plugins/record.ts";
import { repoFor } from "../lib/projects-on-github.ts";
import { type RunDetails, recordRun, renderRunDetails } from "../lib/runs.ts";
import { secretFindings } from "../lib/secret-scan.ts";
import { dropRepeat, tryStatusIssue, upsertRepeat } from "../lib/status-issue.ts";
import { findStatus, MAX_REPLY, safeMarkdown, type TaskState } from "../lib/task.ts";
import { cursorOf, guestOf, sentRefs, sharedNow } from "./decide.ts";
import { doorGuest, typeOf } from "./door.ts";
import { replyKey } from "./keys.ts";
import { callFiles, makeCalls } from "./mcp-client.ts";
import { openedText, SUB_TASK } from "./parts.ts";
import { saidAs } from "./result.ts";
import { type Person, replyTo, scheduledReply } from "./route.ts";
import { taskReadOf } from "./snapshot.ts";
import { committer } from "./think.ts";
import type { Held, Snapshot, Write } from "./types.ts";
import {
  factsOf,
  hold,
  holdOf,
  isWorkflowFile,
  patchParts,
  runsBeforeMerge,
  workflowsMismatch,
} from "./workflows.ts";

/** A run's file as its reply's line names it: its ref in the web chat's store (ADR 0071). */
type KeptFile = NonNullable<ReplyLine["files"]>[number];

export interface ApplyEnv {
  /** Your default channels and your ids on them, for replies that need you. */
  defaults: string[];
  owner?: Person;
  /** The run's details, when an agent or a check ran. */
  details?: RunDetails;
  /** The agent's out folder: its bundle, its files. */
  out?: string;
  /** Write tokens minted after think: the project's, and shipify's for files. */
  tokens: { repo?: string; files?: string };
  /** Tell the door of a new reply (POST /door/replied with the run's OIDC token). */
  tellDoor?: (task: number, comment: number, files: string[]) => Promise<void>;
  /**
   * The task's comments as a stay's turn read them a moment ago (ADR 0057): no one but this run
   * replies on the task, so they hold every reply written, and apply reads them no more.
   */
  comments?: RecordComment[];
  /**
   * The comments written since the task step's read, as decide's step read them a moment ago: for
   * the same reason, apply takes them with the task step's read and reads none.
   */
  since?: RecordComment[];
}

export interface Applied {
  replies: number[];
  problems: Problem[];
  /** Every problem reached a reply on the task: none left that only the run's log says. */
  told: boolean;
}

/** Makes the writes, then tells the door, then saves the status. */
export async function apply(
  s: Snapshot,
  st: TaskState,
  writes: Write[],
  env: ApplyEnv,
): Promise<Applied> {
  // One read of what's new since the task step's read (ADR 0051 B2): its saved record keeps every
  // reply key it saw, and plan saved the status comment's id, so the issue needs no second read.
  // A task read that wasn't this run's own (a failure path with no task step) reads them all.
  const task = taskReadOf(s.n);
  const own = task && task.run === thisRun() ? task : undefined;
  // A comment the read held and the new one edited since is there twice: the newer copy counts.
  // Decide's step read the new ones already, from the same time on (ADR 0051 B2).
  const raw = env.comments ?? [
    ...new Map(
      [...(own?.record.comments ?? []), ...(env.since ?? rec().comments(s.n, own?.at))].map((c) => [
        c.id,
        c,
      ]),
    ).values(),
  ];
  const issue: StatusIssue = { number: s.n, labels: s.issue.labels.map((name) => ({ name })) };
  const status = new Status(issue, findStatus(raw).comment?.id ?? s.statusId, st);
  const written = new Set(
    raw.filter((c) => c.user.login === RUN_WRITER).flatMap((c) => readReply(c.body)?.key ?? []),
  );
  const outcomes: string[] = [];
  const problems: Problem[] = [];
  let pushFailed = false;
  const replies: number[] = [];
  const asked = askedFrom(s);
  const links: Link[] = [];
  /**
   * The door told of a reply as soon as it's written (ADR 0057), before the status is saved, so a
   * status GitHub refuses never keeps a written reply from your chat; one it wasn't told of gets the
   * watch's notice.
   */
  const tellDoor = async (id: number, made: string[], n = s.n) =>
    env.tellDoor?.(n, id, made).catch((e) => {
      process.stderr.write(
        `${JSON.stringify({ level: "warn", event: "door.out.failed", task: n, comment: id, what: maskSecrets(errorLine(e)) })}\n`,
      );
    });
  /** A write GitHub (or anything) refused, as its problem; in the run's log too, so its cause shows
   * on GitHub's run page, not only in a reply. */
  const failed = (write: string, e: unknown) => {
    const p = asProblem(e, s.run.url);
    process.stderr.write(
      `${JSON.stringify({ level: "error", event: "apply.write", task: s.n, write, code: p.code, what: maskSecrets(p.what) })}\n`,
    );
    return p;
  };

  // A journal line before each outside change; one started and not finished is said, not redone.
  /** `quiet`: a write whose reply never names it (a question's kept commits, ADR 0041). */
  const journal = async (
    key: string,
    what: string,
    act: () => Promise<void> | void,
    quiet = false,
  ) => {
    if (!st.journal) st.journal = [];
    const j = st.journal;
    const seen = j.find((x) => x.key === key);
    if (seen?.done) return;
    if (seen) {
      if (!quiet)
        outcomes.push(
          `(${what}: started by an earlier run and not finished; check it, then \`continue\`.)`,
        );
      return;
    }
    j.push({ key, what, at: s.now });
    if (j.length > 40) j.splice(0, j.length - 40);
    await status.save(st.phase, {});
    try {
      await act();
    } catch (e) {
      // It failed and said so: nothing half-done to check, so a retry may run it again. Only a run
      // that died inside it leaves the line, for you to check and then `continue`.
      st.journal = (st.journal ?? []).filter((x) => x.key !== key);
      throw e;
    }
    const line = j.find((x) => x.key === key);
    if (line) line.done = true;
  };

  /**
   * A reply's files, shared once: before this run's calls, so a pre-approved one can name a file
   * this answer made (a drop of it), else as the reply is written. Yours are backed up on
   * shipify-files; a guest's never are (ADR 0071). Each gets a ref in the web chat's store, which
   * the reply's line names, and the door keeps a copy under it.
   */
  const guest = guestOf(s);
  const shares = new Map<
    Write,
    { out: string[]; made?: ReturnType<typeof publishMade>; kept: KeptFile[] }
  >();
  const share = (w: Extract<Write, { w: "reply" }>) => {
    const was = shares.get(w);
    if (was) return was;
    const out =
      w.files?.length && env.out
        ? w.files.map((f) => join(env.out as string, basename(f))).filter(existsSync)
        : [];
    // Each file's hash as the agent left it (publishMade hides keys in a text one first).
    const hashes = out.map(fileHash);
    const made =
      out.length && env.tokens.files && !guest
        ? withToken(env.tokens.files, () => publishMade(s.n, out))
        : undefined;
    if (made) st.shared = sharedNow(st.shared, out, hashes, made.links);
    const kept = out.slice(0, MAX_FILES_OUT).map((f): KeptFile => {
      const backup = made?.links.get(f);
      return {
        name: basename(f).slice(0, 200),
        ref: fileRefOf(Date.now(), guest),
        type: typeOf(f),
        size: statSync(f).size,
        ...(backup ? { backup } : {}),
      };
    });
    const got = { out, kept, ...(made ? { made } : {}) };
    shares.set(w, got);
    return got;
  };
  /**
   * The files a call that worked took, by name (a page given to Drop, ADR 0072): its answer stands
   * for each in the reply, so the reply and the chat's store leave it out. It stays on
   * shipify-files, where the call read it. A call that failed, or waits for a Yes, takes none.
   */
  const taken = new Set<string>();

  for (const w of writes) {
    // A reply's words, once it's about to be written: kept for the next reply if GitHub refuses it.
    let unsaid = "";
    try {
      switch (w.w) {
        case "labels":
          // The adds and removes go together (ADR 0051 B3): independent, one call each.
          await rec().together([
            ...(w.add ?? []).map((name): RecordWrite => ({ w: "labels", n: s.n, names: [name] })),
            ...(w.remove ?? []).map((name): RecordWrite => ({ w: "unlabel", n: s.n, name })),
          ]);
          break;
        case "reopen":
          rec().updateIssue(s.n, { state: "open" });
          break;
        case "close":
          rec().updateIssue(s.n, {
            state: "closed",
            ...(w.reason ? { state_reason: w.reason } : {}),
          });
          break;
        case "react":
          await rec().together([{ w: "react", on: { comment: w.comment }, content: w.content }]);
          break;
        case "note":
          // A guest's go on their own memory page, never on yours (ADR 0078).
          outcomes.push(
            ...(w.guest
              ? rememberFor(w.guest, [w.line])
              : remember(
                  [{ topic: w.topic, text: w.line }],
                  true,
                  s.repos.map((r) => r.name),
                )),
          );
          break;
        case "forget":
          outcomes.push(...(w.guest ? forgetFor(w.guest, w.words) : forget(w.words)));
          break;
        case "personality":
          outcomes.push(...setPersonality(w.set, w.guest));
          break;
        case "pages":
          outcomes.push(...writePages(w.pages, { ...w, dir: env.out }));
          break;
        case "close-chats":
          // A clean start's yes (ADR 0070), or a project's close: each closed as the 30-day close
          // does it.
          await journal(
            `close-chats:${s.state.seen}:${s.run.id}`,
            `closing ${w.chats.length} chat(s)`,
            async () => {
              const shut: string[] = [];
              const left: string[] = [];
              for (const c of w.chats)
                ((await closeQuiet(c, s.now, w.why ?? CLEAN_CLOSED)) ? shut : left).push(
                  `#${c.number}`,
                );
              outcomes.push(
                ...(shut.length
                  ? [
                      `Closed ${shut.length} chat${shut.length === 1 ? "" : "s"} as done: ${shut.join(", ")}. Writing on one opens it again; their files go 30 days after.`,
                    ]
                  : []),
                ...(left.length
                  ? [
                      `Not closed, as GitHub refused: ${left.join(", ")}. ${w.why ? "Close each on its own." : "Say `clean start` again."}`,
                    ]
                  : []),
              );
            },
          );
          break;
        case "project-pages": {
          // A project's pages close and open with it (task #744). Setting a state twice is
          // harmless, so no journal: what didn't happen is said, and the weekly clean-up closes
          // the pages a closed project left open.
          const closing = w.state === "closed";
          const then = closing
            ? "the weekly clean-up closes them"
            : "they're its pages all the same, and open as a run writes them";
          try {
            const { left } = pagesTo(w.label, w.state, w.guest);
            if (left.length)
              outcomes.push(
                `Not ${closing ? "closed" : "opened"} with the project, as GitHub refused: ${left.map((n) => `#${n}`).join(", ")}; ${then}.`,
              );
          } catch {
            outcomes.push(`The project's pages couldn't be read just now: ${then}.`);
          }
          break;
        }
        case "calls":
          await journal(
            `calls:${w.fingerprint}`,
            `the ${w.calls.length} approved call(s)`,
            async () => {
              for (const r of writes) if (r.w === "reply") share(r);
              // A guest's calls (ADR 0073): who they are from the door's list, and their files
              // from this run's folder, as none are on the branch. One the door doesn't know (a
              // guest you removed) makes none.
              const who = guest ? await doorGuest(guest) : undefined;
              if (guest && !who) {
                outcomes.push(
                  ...w.calls.map(
                    (c) =>
                      `✗ \`${c.tool}.${c.name}\`: nothing was made, as the door couldn't say you're a guest here now`,
                  ),
                );
                return;
              }
              const local = Object.fromEntries(
                [...shares.values()].flatMap((x) => x.out).map((f) => [basename(f), f]),
              );
              const done = await makeCalls(
                w.calls,
                process.env,
                st.shared,
                fetch,
                sentRefs(s),
                undefined,
                guest ? { local, guest: who } : {},
              );
              const took = w.calls.filter((_, i) => done[i]?.ok);
              // A guest's page stays in their chat too: their files have no other copy (ADR 0073).
              if (took.length && !guest) for (const f of callFiles(took)) taken.add(f);
              outcomes.push(
                ...done.map(
                  (r: ToolResult, i: number) =>
                    `${r.ok ? "✓" : "✗"} \`${w.calls[i]?.tool}.${w.calls[i]?.name}\`: ${r.text}`,
                ),
              );
            },
          );
          break;
        case "dispatch":
          await journal(
            `dispatch:${w.job}:${s.state.seen}:${s.run.id}`,
            `starting the ${w.job} job`,
            () => {
              const r = queue().dispatch("task.yml", { issue: String(s.n), job: w.job });
              if (!r.ok) throw Object.assign(new Error(r.error), { problem: undefined });
            },
          );
          break;
        case "split":
          // On your yes (ADR 0066): the parts opened as sub-issues, with their links; none starts.
          await journal(
            `split:${s.state.seen}:${s.run.id}`,
            `opening the ${w.parts.length} sub-tasks`,
            () => {
              const made = rec().openParts(s.n, w.parts, SUB_TASK);
              outcomes.push(openedText(w.parts, made));
            },
          );
          break;
        case "workflow":
          // The workflow change you approved (ADR 0075 §5.5): pushed once, by its patch's hash.
          await journal(
            `workflow:${w.change.sha256.slice(0, 16)}`,
            "pushing the workflow change you approved",
            () => {
              outcomes.push(pushApproved(s, st, w, env));
            },
          );
          break;
        case "first":
          // A task first, on your yes (ADR 0075 §6): opened under the parent, with the task that
          // waits for it blocked by it, and started at once, as `go #n` starts a part.
          await journal(`first:${s.state.seen}:${s.run.id}`, `opening ${w.part.title}`, () => {
            const [n] = rec().openParts(w.parent, [w.part], SUB_TASK);
            if (!n) throw new Error("GitHub didn't open the task first");
            rec().addLabels(n, [FIRST_LABEL]);
            const r = queue().dispatch("task.yml", { issue: String(n), job: "run" });
            outcomes.push(
              r.ok
                ? `Opened #${n} and started it. When it merges, I'll say so here, and \`continue\` carries on.`
                : `Opened #${n}, but it couldn't start: ${r.error}. Say \`continue\` on #${n} to start it.`,
            );
          });
          break;
        case "start":
          // A part's run (ADR 0066): your `go` on its parent, or the part it waited for merged.
          await journal(`start:${w.n}:${s.run.id}`, `starting #${w.n}`, () => {
            const r = queue().dispatch("task.yml", { issue: String(w.n), job: "run" });
            if (!r.ok) throw new Error(`#${w.n} couldn't start: ${r.error}`);
          });
          break;
        case "tell": {
          // On the parent (ADR 0066): to your default channels, as no chat asked for it. Its key
          // names this run, so a run again writes it once; two parts closing at once may both.
          const key = replyKey({ task: w.n, cursor: 0, body: w.text, step: w.step });
          const to = replyTo({
            kind: w.kind,
            asked: [],
            defaults: env.defaults,
            owner: env.owner,
            ownTask: true,
          });
          await journal(`tell:${w.n}:${w.step}:${s.run.id}`, `telling #${w.n}`, async () => {
            const id = rec().comment(
              w.n,
              [
                replyLine({
                  v: 1,
                  kind: w.kind,
                  state: w.state,
                  title: (w.title ?? s.family?.parent.title ?? `#${w.n}`).slice(0, 256),
                  links: [],
                  to,
                  key,
                }),
                safeMarkdown(maskSecrets(w.text)),
              ].join("\n\n"),
            );
            await tellDoor(id, [], w.n);
            if (w.close) {
              rec().updateIssue(w.n, { state: "closed", state_reason: "completed" });
              rec().removeLabel(w.n, STARTED_LABEL);
            }
          });
          break;
        }
        case "coming-up":
          tryStatusIssue(
            (x) => {
              if (st.repeat && !st.repeat.paused)
                upsertRepeat(x, {
                  n: s.n,
                  title: s.issue.title,
                  next: st.repeat.next,
                  every: st.repeat.every,
                });
              else dropRepeat(x, s.n);
              return undefined;
            },
            { timeZone: timeZone() },
          );
          break;
        case "preview": {
          const token = env.tokens.repo;
          if (token)
            await journal(`preview:${w.pr}:${s.run.id}`, `a preview of ${w.pr}`, () => {
              previewOn(repoFor(w.repo, s.repos), w.pr, token);
            });
          break;
        }
        case "push":
          // By the words it answers too: a stay's push comes in the same job as its run's (ADR 0076).
          await journal(
            `push:${w.repo}:${w.branch}:${st.seen}:${s.run.id}`,
            `pushing ${w.branch}`,
            () => {
              const pushed = pushFromBundle(s, st, w, env);
              if (pushed.url) links.push(["PR", pushed.url]);
              if (pushed.signedOnly)
                outcomes.push(
                  `${pushed.signedOnly} takes signed commits only, and Shipify's are pushed unsigned, so GitHub won't merge this PR yet, squashed or not: merge it with a bypass if you have one, or sign its commits again on your PC.`,
                );
              // Kept, not opened: the next run starts from these commits (think's clone).
              if (w.open === false) {
                if (pushed.sha && !w.quiet)
                  outcomes.push(
                    `Its commits are kept on \`${w.branch}\`, so \`continue\` carries on from them.`,
                  );
                return;
              }
              // A preview asked for: the label after the PR, then an empty commit, so the pipeline's
              // next run carries the label (the opened run's payload never does).
              if (pushed.url && w.preview && env.tokens.repo)
                try {
                  previewOn(repoFor(w.repo, s.repos), pushed.url, env.tokens.repo);
                } catch {
                  outcomes.push(PREVIEW_UNSET);
                }
              // A new project's first deploy is followed: your merge of its plan started it. A PR's
              // checks never are (ADR 0046): you look at the PR, and ask.
              if (w.kind === "publish") {
                const deploy = publishedDeploy(w.repo, env.tokens.repo);
                if (deploy) follow(s, st, { deploy });
              }
            },
            w.open === false && w.quiet === true,
          );
          break;
        case "reply": {
          // A push refused in this run: its reply can't ask you to merge a PR that wasn't opened.
          // It becomes one Failed reply: the problem and its fix first, the agent's words below in sight.
          const r = pushFailed ? afterRefusedPush(w) : w;
          // A run that read outside content: every field's images made inert (ADR 0044).
          const inert = (t: string) => (w.outside ? inertImages(t) : t);
          const question = r.question ? inert(r.question) : undefined;
          // A choice with an image in it is left out: made inert it'd no longer be a short answer.
          const choices = r.choices?.filter((c) => inert(c) === c);
          const body = inert(
            pushFailed ? [...outcomes, r.text].filter(Boolean).join("\n\n") : textOf(r, outcomes),
          );
          outcomes.length = 0;
          const key = replyKey({
            task: s.n,
            cursor: st.seen,
            body,
            step: r.step,
            occasion: r.occasion,
          });
          if (written.has(key)) break;
          unsaid = body;
          const { out, made, kept } = share(w);
          const shown = (f: string | undefined) => !taken.has(basename(f ?? ""));
          const sent = out.filter(shown);
          const named = kept.filter((_, i) => shown(out[i]));
          const lines = sent.flatMap((f) => made?.lines.get(f) ?? []);
          // A guest's files have no backup: the reply names them, and the window opens them.
          const filesBlock = lines.length
            ? ["**Files:**", ...lines].join("\n")
            : named.length
              ? `**Files:** ${named.map((f) => f.name.replace(/[[\]]/g, "")).join(" · ")}`
              : "";
          const allLinks = [...(r.links ?? []), ...links];
          const to = replyTo({
            kind: r.kind,
            asked,
            defaults: env.defaults,
            // A guest's replies go to their chat alone, never to yours (ADR 0071).
            ...(guest ? {} : { owner: env.owner }),
            ownTask: s.issue.author === "run",
            scheduled: scheduledReply(r.step, r.occasion),
          });
          const details = env.details ? renderRunDetails(env.details, timeZone()) : "";
          const line = replyLine({
            v: 1,
            kind: r.kind,
            state: r.state,
            title: s.issue.title.slice(0, 256),
            links: allLinks.slice(0, 10),
            ...(env.details ? { brief: brief(env.details), run: runNumbers(env.details) } : {}),
            ...(question ? { question: question.slice(0, 2_000) } : {}),
            // Its question's short answers, or with none its next steps (ADR 0078).
            ...(choices?.length ? { choices } : {}),
            ...(r.list ? { list: r.list } : {}),
            ...(r.keep ? { keep: true as const } : {}),
            ...(r.undo ? { undo: true as const } : {}),
            ...(named.length ? { files: named } : {}),
            to,
            key,
          });
          let text = safeMarkdown(maskSecrets(body));
          if (text.length > MAX_REPLY)
            text = `${text.slice(0, MAX_REPLY - 200)}\n\n_(cut: the rest was longer than a comment holds)_`;
          const full = [
            line,
            text,
            // Its question, with its short answers when it gave some: every chat reads these words
            // (the web chat shows them as its question box and buttons instead).
            question
              ? `> **Question:** ${question}${choices?.length ? `\n>\n> Answers: ${choices.map((c) => `“${c}”`).join(" · ")}` : ""}`
              : "",
            filesBlock,
            allLinks.map(([l, u]) => `- ${l}: ${u}`).join("\n"),
            details,
          ]
            .filter(Boolean)
            .join("\n\n");
          const id = rec().comment(s.n, full);
          written.add(key);
          replies.push(id);
          st.reply = id;
          // A reply says what's new: a button's Last action (ADR 0069) is behind it now.
          st.action = undefined;
          // Told at once (ADR 0057): the writes after it never hold your reply back.
          await tellDoor(id, sent);
          // The list this reply asks a yes for: only a yes after it counts.
          if (st.pending.list && !st.pending.list.post) st.pending.list.post = id;
          break;
        }
      }
    } catch (e) {
      const p = failed(w.w, e);
      // A question's kept commits (ADR 0041) never change its reply: their push's failure is logged
      // above, and the question stands, as before such commits were kept.
      if (w.w === "push" && w.open === false && w.quiet) continue;
      problems.push(p);
      outcomes.push(renderProblem(p));
      if (unsaid) outcomes.push(`\n${unsaid}`);
      if (w.w === "push") pushFailed = true;
    }
  }
  // Whether every problem reached a reply: nothing left unsaid, or the reply below is written.
  let told = !outcomes.length;
  // Anything left unsaid (a write that failed after the last reply) gets a reply of its own. If
  // GitHub refuses that too, it's logged, and the status is still saved below.
  if (outcomes.length) {
    const body = outcomes.join("\n");
    const key = replyKey({ task: s.n, cursor: st.seen, body, step: "after", occasion: s.run.id });
    if (!written.has(key)) {
      const to = replyTo({
        kind: problems.length ? "failed" : "answer",
        asked,
        defaults: env.defaults,
        owner: env.owner,
        ownTask: s.issue.author === "run",
      });
      try {
        const id = rec().comment(
          s.n,
          [
            replyLine({
              v: 1,
              kind: problems.length ? "failed" : "answer",
              state: problems.length ? "Failed" : "Done",
              title: s.issue.title.slice(0, 256),
              links: [],
              to,
              key,
            }),
            body,
          ].join("\n\n"),
        );
        replies.push(id);
        told = true;
        await tellDoor(id, []);
      } catch (e) {
        problems.push(failed("reply", e));
      }
    } else told = true;
  }
  if (problems.length && st.phase !== "failed") {
    st.phase = "failed";
    st.failed = { at: s.now, problem: problems[0] as Problem };
  }
  if (env.details) recordRun(st, env.details);
  // Only the current cursor's journal is kept.
  st.journal = (st.journal ?? []).filter((j) => !j.done || j.at === s.now);
  st.cursor = cursorOf(s, st);
  // The status last, after everything else has settled (ADR 0051 B3).
  await status.save(st.phase, { summary: summaryOf(writes) });
  return { replies, problems, told };
}

/** A deploy for the watch's due runs to follow: the `deploying` label, and the task's state. */
function follow(s: Snapshot, st: TaskState, f: { deploy: NonNullable<TaskState["deploy"]> }) {
  st.deploy = f.deploy;
  rec().addLabels(s.n, ["deploying"]);
}

/**
 * The chats this run answers: those of your new messages (none for words on GitHub). The task's own
 * chat on its first answer, and when there are no new words (a deploy, a cut-off run): a task you
 * carry on elsewhere is answered there, not where it started.
 */
export function askedFrom(s: Snapshot): string[] {
  // A guest's words too (ADR 0071): their reply goes to their chat.
  const fresh = s.said.filter(
    (c) =>
      (c.author === "owner" || c.author === "door" || c.author === "guest") && c.id > s.state.seen,
  );
  const out = new Set<string>();
  if (s.issue.from && (!s.state.reply || !fresh.length))
    out.add(`${s.issue.from.channel}:${s.issue.from.chat}`);
  for (const c of fresh) if (c.from) out.add(`${c.from.channel}:${c.from.chat}`);
  return [...out];
}

type ReplyWrite = Extract<Write, { w: "reply" }>;

/**
 * A run's reply after its push was refused (a key in the change, a workflow edit): one Failed reply,
 * whose problem and fix come first (apply puts them before it), with the agent's words below, and
 * no question: it can't ask you to merge a PR that wasn't opened.
 */
export function afterRefusedPush(w: ReplyWrite): ReplyWrite {
  const { question: _, ...rest } = w;
  return {
    ...rest,
    kind: "failed",
    state: "Failed",
    text: saidAs(w.text),
  };
}

/** A reply's words: its own, or, when it has none, what the box did (notes noted, calls made). */
const textOf = (w: Extract<Write, { w: "reply" }>, outcomes: string[]) =>
  [w.text, ...outcomes].filter(Boolean).join("\n\n") || "Done.";

const summaryOf = (writes: Write[]) => {
  const r = writes.find((w): w is Extract<Write, { w: "reply" }> => w.w === "reply");
  return r?.text ? r.text.split("\n")[0]?.slice(0, 280) : undefined;
};

/** A run in numbers, on its reply's line, for a chat to add up a task's. */
export function runNumbers(d: RunDetails) {
  const t = d.tokens;
  const tokens = t ? t.input + t.cacheRead + t.cacheWrite + t.output : 0;
  return {
    secs: Math.round(d.secs.total),
    ...(tokens ? { tokens } : {}),
    ...(d.cost?.plan
      ? { plan: true }
      : d.cost?.usd
        ? { usd: Math.round(d.cost.usd * 1e4) / 1e4 }
        : {}),
    ...(d.model ? { model: d.model.slice(0, 100) } : {}),
  };
}

/**
 * A run in one line, for a chat: "Sonnet · 48 s · 3 tool calls", or with what it cost when no plan
 * covers it, "kimi-k3 · 72 s · 11 tool calls · $0.03".
 */
export function brief(d: RunDetails): string {
  const tools = Object.values(d.tools ?? {}).reduce((a, b) => a + b, 0);
  // What it cost, when no plan covers it and the agent knows (a gateway's price, an API key's).
  const usd = d.cost && !d.cost.plan ? d.cost.usd : 0;
  const cost = !usd ? "" : usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`;
  return [
    d.model ? modelLabel(d.model) : d.name,
    `${Math.round(d.secs.total)} s`,
    tools ? `${tools} tool call${tools === 1 ? "" : "s"}` : "",
    cost,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 120);
}

/** git with the token in its environment (never on the command line) and nothing of the repo's run:
 * clones.ts's environment, built from nothing. */
function git(dir: string, token: string, ...args: string[]) {
  return gitIn(dir, token, undefined, ...args);
}

/** git as above, with this on its stdin. */
function gitIn(dir: string, token: string, input: string | undefined, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...(input === undefined ? {} : { input }),
    env: gitEnv(token),
  });
}

/** Paths as a sparse checkout's patterns: each one anchored and literal, nothing a wildcard. */
export const sparse = (paths: string[]) =>
  `${paths.map((p) => `/${p.replace(/[\\*?[\]!#]/g, "\\$&")}`).join("\n")}\n`;

/**
 * The agent's commits from its bundle into apply's clone, as `target`. The bundle is the one local
 * file git may read here (git counts a bundle as the file transport, which is otherwise off); an
 * empty repo's clone takes them on its unborn main.
 */
export function fetchBundle(dir: string, token: string, bundle: string, target: string) {
  git(
    dir,
    token,
    "-c",
    "protocol.file.allow=always",
    "fetch",
    "--quiet",
    "--update-head-ok",
    bundle,
    `+refs/heads/work:refs/heads/${target}`,
  );
}

/**
 * The agent's commits, pushed from apply's own clone: fetched from its bundle, scanned for secrets,
 * pushed only to the task's own branch (or, for a new project's first push, to an empty repo's
 * main), and the PR opened or updated. Safe to repeat: a run with nothing new still opens the PR for
 * an earlier run's commits on the task's branch. Returns the PR's URL and the branch's sha.
 */
function pushFromBundle(
  s: Snapshot,
  st: TaskState,
  w: Extract<Write, { w: "push" }>,
  env: ApplyEnv,
): { url?: string; sha: string; signedOnly?: string } {
  const token = env.tokens.repo;
  const bundle = env.out ? join(env.out, "work.bundle") : undefined;
  const fresh = Boolean(bundle && existsSync(bundle));
  // Commits to keep (the checks failed): none made this run is nothing to keep.
  if (w.open === false && !fresh) return { sha: "" };
  if (!token || (!fresh && w.kind === "publish")) throw new Error("there were no commits to push");
  if (w.kind !== "publish" && !/^(task|plan)\/\d+[\w./-]*$/.test(w.branch))
    throw new Error(`apply pushes only to a task's own branch, not ${w.branch}`);
  const repo = repoFor(w.repo, s.repos);
  // The branch its PR goes against: the repo's default (ADR 0045), main for a project.
  const base = w.base ?? "main";
  const dir = mkdtempSync(join(tmpdir(), "shipify-apply-"));
  try {
    cloneTask(dir, token, repo, w.kind === "publish" ? undefined : w.branch, base);
    // Nothing new this run: an earlier run's commits on the task's branch (its push went through,
    // its PR didn't) still get their PR. A branch with nothing ahead of main has nothing to open.
    const sha = fresh
      ? pushed(dir, token, bundle as string, w, base, repo)
      : onBranch(dir, token, w.branch, base);
    if (w.kind === "publish" || w.open === false) return { sha };
    const url = openPr(s, st, { ...w, repo }, env, token);
    return {
      ...(url ? { url } : {}),
      sha,
      ...(url && signedOnly(repo, base, token) ? { signedOnly: `${repo}'s \`${base}\`` } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Apply's clone of a repo (ADR 0044): history without file contents, its default branch only, and
 * the task's branch as an earlier run pushed it, by name, in one fetch. No branch: a new project's
 * empty repo, which has none. Whether the task's branch is on GitHub: one not there yet is none;
 * any other failure stops the write.
 */
function cloneTask(
  dir: string,
  token: string,
  repo: string,
  branch: string | undefined,
  base: string,
): boolean {
  const [, ...clone] = cloneArgs("apply", githubUrl(repo), dir, { empty: !branch, branch: base });
  git(tmpdir(), token, ...clone);
  if (!branch) {
    if (git(dir, token, "ls-remote", "--heads", "origin").trim())
      throw new Error(`${repo} already has commits: publishing pushes only into an empty repo`);
    return false;
  }
  try {
    git(
      dir,
      token,
      "fetch",
      "--quiet",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    );
    return true;
  } catch (e) {
    if (/couldn't find remote ref/.test(String((e as { stderr?: unknown }).stderr ?? "")))
      return false;
    throw e;
  }
}

/**
 * The PR for the task's branch, opened, or updated with this run's title and body when it's open
 * already, so its task line (`Closes` or `Part of`) is the kind asked for now. Its URL.
 */
function openPr(
  s: Snapshot,
  st: TaskState,
  w: {
    repo: string;
    branch: string;
    kind: "closes" | "part-of" | "publish";
    title: string;
    body: string;
    base?: string;
  },
  env: ApplyEnv,
  token: string,
): string {
  const { repo } = w;
  const existing = withToken(token, () =>
    gh([
      "pr",
      "list",
      "-R",
      repo,
      "--head",
      w.branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url",
    ]).trim(),
  );
  const body = prBody(s, w, env.details, accountOf(repo) === undefined);
  if (existing)
    withToken(token, () =>
      gh(["pr", "edit", existing, "-R", repo, "--title", maskSecrets(w.title), "--body", body]),
    );
  // Never with a label: a repo without it would refuse the whole PR.
  const url =
    existing ||
    withToken(
      token,
      () =>
        gh([
          "pr",
          "create",
          "-R",
          repo,
          "--base",
          w.base ?? "main",
          "--head",
          w.branch,
          "--title",
          maskSecrets(w.title),
          "--body",
          body,
        ])
          .trim()
          .split("\n")
          .pop() ?? "",
    );
  if (url) {
    st.prs = [...new Set([...(st.prs ?? []), url])];
    st.prInfo = {
      ...(st.prInfo ?? {}),
      [url]: { kind: w.kind === "part-of" ? (st.plan ? "plan" : "change") : "code", state: "open" },
    };
  }
  return url;
}

/**
 * Whether a branch's rules ask for signed commits (ADR 0045). Shipify's commits are pushed by git,
 * unsigned, so GitHub won't merge its PR there, even squashed. Read from the branch's rulesets,
 * which the Apps' metadata read reaches; a classic protection rule needs more, and GitHub says that
 * one on the PR itself. False when the rules can't be read.
 */
function signedOnly(repo: string, branch: string, token: string): boolean {
  const r = ghRun(["api", `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`], { token });
  if (r.code) return false;
  try {
    return (JSON.parse(r.stdout) as { type?: string }[]).some(
      (rule) => rule.type === "required_signatures",
    );
  } catch {
    return false;
  }
}

/**
 * This run's commits from the agent's bundle, onto the task's branch (or an empty repo's main):
 * scanned for keys, its workflow change held (ADR 0075), workflow files then only as the branch on
 * GitHub or the stack has them, pushed. Their sha.
 */
function pushed(
  dir: string,
  token: string,
  bundle: string,
  w: Extract<Write, { w: "push" }>,
  trunk: string,
  repo: string,
) {
  const target = w.kind === "publish" ? "main" : w.branch;
  fetchBundle(dir, token, bundle, target);
  // What the PR changes against its base (three dots: from where they meet), never the base's own
  // changes the agent merged in, a rename as both its paths; a new project's first push: every file.
  const base = w.kind === "publish" ? "" : `origin/${trunk}`;
  const changed = (
    base
      ? git(dir, token, "diff", "--no-renames", "--name-only", `${base}...${target}`)
      : git(dir, token, "ls-tree", "-r", "--name-only", target)
  )
    .split("\n")
    .filter(Boolean);
  // Only the files the checks read are checked out (ADR 0044): the changed ones, shipify.json and
  // the workflows, so a big repo costs what its change does. A first push has them all already.
  if (base)
    gitIn(
      dir,
      token,
      sparse([...changed, "shipify.json", ".github/workflows/"]),
      "sparse-checkout",
      "set",
      "--no-cone",
      "--stdin",
    );
  git(dir, token, "checkout", "--quiet", target);
  // The change's own files (a new project's first push: all of them): what this push adds, its
  // workflow lines too, before any is held.
  const found = secretFindings(dir, base ? changed : undefined);
  if (found) {
    const p = problem("secret-in-change", { file: found.join(", ") || "a file it didn't name" });
    throw Object.assign(new Error(p.what), { problem: p });
  }
  // One the owner changed on the task's branch on GitHub, left as it is there, isn't the run's.
  const onGitHub = base && git(dir, token, "for-each-ref", `refs/remotes/origin/${target}`).trim();
  // The run's own workflow change (ADR 0075 §5.2): held, each file back as the branch on GitHub has
  // it (else as main had it where the branch left it), in one commit of the bot's; decide lists it
  // for your yes. The repos App can't push a workflow file even in a commit's history: never held
  // there, it's refused.
  const g = (...args: string[]) => git(dir, token, ...args);
  const h = base ? holdOf(g, dir, onGitHub ? `origin/${target}` : base, target) : undefined;
  if (h && accountOf(repo))
    throw new Error(
      `the change edits a workflow file (${h.files.join(", ")}), so it wasn't pushed: the repos App can't push one to ${repo}, even in a commit's history. Take it out of the branch, and make it there yourself if you want it`,
    );
  if (h) hold(g, h, committer({}));
  // Then today's check, on what the push changes after the hold: nothing of the run's.
  const left = base
    ? git(
        dir,
        token,
        "diff",
        "--name-only",
        ...(onGitHub ? [`origin/${target}`, target] : [`${base}...${target}`]),
      )
    : changed.join("\n");
  const wrong = workflowsMismatch(dir, left.split("\n").filter(Boolean));
  if (wrong) throw new Error(`the change edits a workflow file, so it wasn't pushed: ${wrong}`);
  git(dir, token, "push", "--quiet", "origin", `refs/heads/${target}:refs/heads/${target}`);
  if (w.kind === "publish" && stagingOf(dir))
    git(dir, token, "push", "--quiet", "origin", `refs/heads/${target}:refs/heads/production`);
  return git(dir, token, "rev-parse", target).trim();
}

/** The most a held change's patch may be for one yes (ADR 0075 §5.3). */
export const HELD_MAX = 12_000;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A file as a checkout has it, or nothing when it isn't there. */
const fileIn = (dir: string, f: string) => {
  const p = join(dir, f);
  return existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined;
};

/** The patch of these files from `at` to `head`: plain text, no renames, no repo's diff tools. */
const patchOf = (dir: string, token: string, at: string, head: string, files: string[]) =>
  git(
    dir,
    token,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-renames",
    at,
    head,
    "--",
    ...files,
  );

/**
 * The workflow change a run's commits hold (ADR 0075 §5.2), as decide reads it: the run's bundle
 * in a clone of its own, as apply's (hooks off, only `.github/` and shipify.json checked out),
 * against the task's branch on GitHub, else its base. Its patch, its facts, and why it can't be
 * listed (§5.4, a key, too big); none when its commits change no workflow file.
 */
export function heldChange(
  repo: string,
  branch: string,
  trunk: string,
  bundle: string,
  token: string,
): Held | undefined {
  const dir = mkdtempSync(join(tmpdir(), "shipify-held-"));
  try {
    const onGitHub = cloneTask(dir, token, repo, branch, trunk);
    const target = "shipify-held";
    fetchBundle(dir, token, bundle, target);
    const base = onGitHub ? `origin/${branch}` : `origin/${trunk}`;
    const all = git(dir, token, "diff", "--no-renames", "--name-only", `${base}...${target}`)
      .split("\n")
      .filter(Boolean);
    const touched = all.filter(isWorkflowFile);
    if (!touched.length) return undefined;
    gitIn(
      dir,
      token,
      sparse([...touched, ".github/workflows/", "shipify.json"]),
      "sparse-checkout",
      "set",
      "--no-cone",
      "--stdin",
    );
    git(dir, token, "checkout", "--quiet", target);
    const h = holdOf((...a) => git(dir, token, ...a), dir, base, target);
    if (!h) return undefined;
    const patch = patchOf(dir, token, h.at, target, h.files);
    const read = (f: string) => fileIn(dir, f);
    const parts = patchParts(patch);
    const workflows = git(
      dir,
      token,
      "ls-tree",
      "-r",
      "--name-only",
      target,
      "--",
      ".github/workflows/",
    )
      .split("\n")
      .filter(Boolean);
    const found = secretFindings(dir, h.files);
    const why = found
      ? `what looks like a key is in it (${found.join(", ") || "a file it didn't name"})`
      : /^(Binary files |GIT binary patch)/m.test(patch)
        ? "it has a binary file, which a list can't show"
        : patch.length > HELD_MAX
          ? "it's too big for one yes: ask for it in steps"
          : runsBeforeMerge(h.files, read, workflows, trunk);
    // The run merged main, which changed one of these files since the branch left it.
    const left = onGitHub ? git(dir, token, "merge-base", base, `origin/${trunk}`).trim() : "";
    const newer =
      left &&
      git(dir, token, "diff", "--name-only", left, `origin/${trunk}`, "--", ...h.files).trim();
    return {
      files: h.files,
      at: h.at,
      patch,
      sha256: sha256(patch),
      facts: h.files.map((f) => factsOf(f, read(f), parts.get(f) ?? "", trunk)),
      only: all.every((f) => h.files.includes(f)),
      ...(why ? { why } : {}),
      ...(found ? { key: true as const } : {}),
      ...(newer ? { mainNewer: true as const } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The workflow change you approved (ADR 0075 §5.5), in a fresh clone of the task's branch (or, not
 * on GitHub yet, from where it left its base): the patch checked against the list, applied, checked
 * again (the rule and the key scan), committed by the bot and pushed to that branch, once; the PR
 * the run asked for opened when it has none. What the reply says.
 */
function pushApproved(
  s: Snapshot,
  st: TaskState,
  w: Extract<Write, { w: "workflow" }>,
  env: ApplyEnv,
): string {
  const c = w.change;
  const token = env.tokens.repo;
  if (!token) throw new Error("there was no key to push the workflow change with");
  if (sha256(c.patch) !== c.sha256) throw new Error("the patch isn't the one on the list");
  if (!/^(task|plan)\/\d+[\w./-]*$/.test(c.branch))
    throw new Error(`apply pushes only to a task's own branch, not ${c.branch}`);
  const repo = repoFor(c.repo, s.repos);
  const trunk = c.base ?? "main";
  const prs = JSON.parse(
    withToken(token, () =>
      gh(["pr", "list", "-R", repo, "--head", c.branch, "--state", "all", "--json", "url,state"]),
    ) || "[]",
  ) as { url: string; state: string }[];
  const open = prs.find((p) => p.state === "OPEN");
  const merged = prs.find((p) => p.state === "MERGED");
  // A refusal you can act on is a ✗ with why; anything else, a problem as any write's.
  const refused = (why: string) => `✗ The workflow change you approved wasn't pushed: ${why}.`;
  if (!open && merged)
    return refused(
      `PR #${merged.url.split("/").pop()} merged without it. Say \`continue\`, and a run makes it again in a new PR`,
    );
  const dir = mkdtempSync(join(tmpdir(), "shipify-approved-"));
  try {
    const onGitHub = cloneTask(dir, token, repo, c.branch, trunk);
    gitIn(
      dir,
      token,
      sparse([".github/", "shipify.json"]),
      "sparse-checkout",
      "set",
      "--no-cone",
      "--stdin",
    );
    git(dir, token, "checkout", "--quiet", "-B", c.branch, onGitHub ? `origin/${c.branch}` : c.at);
    // Only the listed files, each under .github/, then applied where the list left them.
    const paths = gitIn(dir, token, c.patch, "apply", "--numstat", "-")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t")[2] ?? "");
    if (!paths.length || paths.some((f) => !c.files.includes(f) || !isWorkflowFile(f)))
      throw new Error("the patch changes a file the list doesn't name");
    try {
      gitIn(dir, token, c.patch, "apply", "--index", "--whitespace=nowarn", "-");
    } catch {
      return refused(
        "the branch changed since the list, so it no longer fits. Say `continue`, and the run makes it again",
      );
    }
    const workflows = git(dir, token, "ls-files", "--", ".github/workflows/")
      .split("\n")
      .filter(Boolean);
    const why = runsBeforeMerge(paths, (f) => fileIn(dir, f), workflows, trunk);
    if (why) return refused(`on the branch as it is now, it would run before your merge (${why})`);
    const found = secretFindings(dir, paths);
    if (found) {
      const p = problem("secret-in-change", { file: found.join(", ") || "a file it didn't name" });
      throw Object.assign(new Error(p.what), { problem: p });
    }
    const by = committer({});
    git(
      dir,
      token,
      "-c",
      `user.name=${by.name}`,
      "-c",
      `user.email=${by.email}`,
      "commit",
      "-q",
      "--no-verify",
      "-m",
      `ci: the workflow change you approved (list ${w.code})`,
    );
    git(dir, token, "push", "--quiet", "origin", `HEAD:refs/heads/${c.branch}`);
    const sha = git(dir, token, "rev-parse", "--short", "HEAD").trim();
    const files = c.files.map((f) => `\`${f}\``).join(", ");
    const url =
      open?.url ??
      (c.pr ? openPr(s, st, { ...c.pr, repo, branch: c.branch, base: trunk }, env, token) : "");
    return url
      ? `✓ Pushed the workflow change you approved to PR #${url.split("/").pop()}: ${files} (commit \`${sha}\`).${open ? "" : ` It's open now: ${url}`}`
      : `✓ Pushed the workflow change you approved to \`${c.branch}\`: ${files} (commit \`${sha}\`).`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether the project in this checkout has staging (its shipify.json): then it has production too. */
function stagingOf(dir: string): boolean {
  try {
    return (
      (JSON.parse(readFileSync(join(dir, "shipify.json"), "utf8")) as { staging?: boolean })
        .staging === true
    );
  } catch {
    return false;
  }
}

/** The task's branch as an earlier run pushed it, when it holds commits its base doesn't: its sha. */
export function onBranch(dir: string, token: string, branch: string, base = "main"): string {
  let sha = "";
  try {
    sha = git(dir, token, "rev-parse", "--verify", "--quiet", `origin/${branch}`).trim();
  } catch {}
  const ahead = sha
    ? Number(git(dir, token, "rev-list", "--count", `origin/${base}..origin/${branch}`).trim())
    : 0;
  if (!ahead) throw new Error("there were no commits to push");
  return sha;
}

/**
 * A PR's body (ADR 0045): what the agent wrote (the repo's own template filled in, or Shipify's
 * format, as the playbook says), then the core's footer: the task it's for, and what made it,
 * with the run's link only where its readers can open it (Shipify's own account).
 */
export function prBody(
  s: Snapshot,
  w: { kind: "closes" | "part-of" | "publish"; body: string },
  details: RunDetails | undefined,
  ownAccount: boolean,
): string {
  const by = details?.name
    ? `${details.name}${details.model ? ` (${modelLabel(details.model)})` : ""}`
    : undefined;
  const footer = [
    taskLine(s.n, w.kind === "part-of"),
    madeWith(by, ownAccount ? s.run.url : undefined),
  ].filter(Boolean);
  // Masked as every reply is: a PR on another account is read by other people too.
  return [maskSecrets(w.body.trim()), footer.length ? `---\n${footer.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

const PREVIEW_UNSET =
  "The PR couldn't get its `preview` label, so no preview runs: add the label on the PR, or say `preview` again.";

/** The `preview` label on a PR, made first when its repo has none: whether it's on. */
export function labelled(repo: string, pr: string, token: string): boolean {
  return withToken(token, () => {
    previewLabel(repo);
    try {
      gh(["pr", "edit", pr, "-R", repo, "--add-label", "preview"]);
      return true;
    } catch {
      return false;
    }
  });
}

/** A preview for an open PR: its label, then an empty commit so its pipeline runs. Its sha. */
function previewOn(repo: string, pr: string, token: string): string {
  return withToken(token, () => {
    if (!labelled(repo, pr, token)) throw new Error(PREVIEW_UNSET);
    const head = JSON.parse(
      gh(["pr", "view", pr, "-R", repo, "--json", "headRefName,headRefOid"]),
    ) as { headRefName: string; headRefOid: string };
    const tree = JSON.parse(gh(["api", `repos/${repo}/git/commits/${head.headRefOid}`])) as {
      tree: { sha: string };
    };
    const commit = JSON.parse(
      gh([
        "api",
        `repos/${repo}/git/commits`,
        "-f",
        "message=Preview, please",
        "-f",
        `tree=${tree.tree.sha}`,
        "-f",
        `parents[]=${head.headRefOid}`,
      ]),
    ) as { sha: string };
    gh([
      "api",
      "-X",
      "PATCH",
      `repos/${repo}/git/refs/heads/${head.headRefName}`,
      "-f",
      `sha=${commit.sha}`,
    ]);
    return commit.sha;
  });
}
