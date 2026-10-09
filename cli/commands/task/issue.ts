// The task's issue on the record (lib/plugins/record.ts): reading it, replying on it, its state
// label, and the status comment that holds its state (ADR 0017).
import { platformRepo, postComment } from "../../lib/github.ts";
import { ShipError } from "../../lib/output.ts";
import { type RepeatState, repeatLine } from "../../lib/repeat.ts";
import { maskSecrets } from "../../lib/safety.ts";
import {
  type LabelKey,
  type Phase,
  renderStatus,
  type StatusView,
  TASK_LABELS,
  type TaskState,
} from "../../lib/task.ts";
import { type Issue, now, rec, runUrl, timeZone } from "./context.ts";

export const getComments = (n: number) => rec().comments(n);

/**
 * A reply on the task: what the agent wrote, made safe to post (anything like a credential hidden,
 * an open fold or code block closed) and cut to fit one comment.
 */
export function reply(n: number, body: string): number {
  const d = postComment(rec(), n, maskSecrets(body));
  if (!d.ok) throw new ShipError(d.error || "the reply couldn't be posted");
  return d.id;
}

const commentUrl = (n: number, id: number) =>
  `https://github.com/${platformRepo()}/issues/${n}#issuecomment-${id}`;

let labelsReady = false;
export function setLabel(issue: Issue, key: LabelKey | undefined) {
  const record = rec();
  // The state labels, created once: one read per run, and a create only for a missing one.
  if (!labelsReady) {
    const have = new Set(record.labels());
    for (const l of Object.values(TASK_LABELS)) if (!have.has(l.name)) record.makeLabel(l);
    labelsReady = true;
  }
  const want = key ? TASK_LABELS[key].name : undefined;
  const ours = Object.values(TASK_LABELS).map((l) => l.name as string);
  for (const l of issue.labels.map((x) => x.name))
    if (ours.includes(l) && l !== want) record.removeLabel(issue.number, l);
  if (want && !issue.labels.some((l) => l.name === want)) record.addLabels(issue.number, [want]);
  issue.labels = want ? [{ name: want }] : [];
}

export const LABEL_OF: Partial<Record<Phase, LabelKey>> = {
  working: "working",
  "needs-you": "needs-you",
  failed: "failed",
  answered: "answered",
};

/** One status comment per task, edited in place: the facts line plus what the owner reads. */
export class Status {
  constructor(
    private issue: Issue,
    private id: number | undefined,
    public state: TaskState,
  ) {}
  /** The status comment's id, once it exists. */
  get commentId() {
    return this.id;
  }
  /** keepRun: a due run's own saves leave the "Run" link on the task's last run. */
  save(phase: Phase, view: StatusView = {}, opts: { keepRun?: boolean } = {}) {
    // In place: the run keeps filling in the same state object (branch, PRs, lane, notes).
    Object.assign(this.state, {
      phase,
      run: opts.keepRun ? this.state.run : (runUrl() ?? this.state.run),
      updated: now(),
    });
    const live = this.state.repeat && phase !== "done" && phase !== "dropped";
    const repeat = live ? repeatLine(this.state.repeat as RepeatState, timeZone()) : undefined;
    const replyUrl = this.state.reply ? commentUrl(this.issue.number, this.state.reply) : undefined;
    // What the owner reads is masked; the hidden state line stays exact (a list's fingerprint).
    const [line, ...rest] = renderStatus(this.state, {
      repeat,
      timeZone: timeZone(),
      replyUrl,
      ...view,
    }).split("\n");
    const body = [line, maskSecrets(rest.join("\n"))].join("\n");
    if (this.id) rec().editComment(this.id, body);
    else this.id = reply(this.issue.number, body);
    setLabel(this.issue, LABEL_OF[phase]);
  }
}
