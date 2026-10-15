// The task's issue on the record (lib/plugins/record.ts): reading it, replying on it, its state
// label, and the status comment that holds its state (ADR 0017).
import { fitComment, platformRepo, postComment } from "../../lib/github.ts";
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
import type { RecordWrite } from "../../lib/plugins/record.ts";
import { type Issue, now, rec, runUrl, timeZone } from "./context.ts";

/** What the status comment needs of its issue: its number, and its labels. The run's snapshot
 * holds both (ADR 0051 B2), so no step re-reads the issue to save a status. */
export type StatusIssue = Pick<Issue, "number" | "labels">;

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
/** The state labels, created once (ADR 0051 B3): one read per run, and a create only for a
 * missing one, before the writes that set them go together. */
const ensureLabels = () => {
  if (labelsReady) return;
  const record = rec();
  const have = new Set(record.labels());
  for (const l of Object.values(TASK_LABELS)) if (!have.has(l.name)) record.makeLabel(l);
  labelsReady = true;
};

export const LABEL_OF: Partial<Record<Phase, LabelKey>> = {
  working: "working",
  "needs-you": "needs-you",
  failed: "failed",
  answered: "answered",
};

/** One status comment per task, edited in place: the facts line plus what the owner reads. */
export class Status {
  constructor(
    private issue: StatusIssue,
    private id: number | undefined,
    public state: TaskState,
  ) {}
  /** The status comment's id, once it exists. */
  get commentId() {
    return this.id;
  }
  /** The issue's labels as this status left them (ADR 0051 B2): what the next status starts from,
   * so its saves need no second read of the issue. */
  get labels(): string[] {
    return this.issue.labels.map((l) => l.name);
  }
  /** keepRun: a due run's own saves leave the "Run" link on the task's last run. */
  async save(
    phase: Phase,
    view: StatusView = {},
    opts: { keepRun?: boolean; alongside?: RecordWrite[] } = {},
  ) {
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
    // Fitted to one comment, as every comment is (`postComment`), first or edited.
    const body = fitComment([line, maskSecrets(rest.join("\n"))].join("\n"));
    ensureLabels();
    // The comment written or edited, its label set, and (plan's) the 👀 and `stuck` writes that go
    // with it, all together (ADR 0051 B3). Each is one of the record's own writes.
    const want = LABEL_OF[phase] ? TASK_LABELS[LABEL_OF[phase] as LabelKey].name : undefined;
    const ours = Object.values(TASK_LABELS).map((l) => l.name as string);
    const mine: RecordWrite[] = [
      this.id
        ? { w: "editComment", id: this.id, body }
        : { w: "comment", n: this.issue.number, body },
      ...this.issue.labels
        .map((l) => l.name)
        .filter((l) => ours.includes(l) && l !== want)
        .map((name) => ({ w: "unlabel", n: this.issue.number, name }) as RecordWrite),
      ...(want && !this.issue.labels.some((l) => l.name === want)
        ? [{ w: "labels", n: this.issue.number, names: [want] } as RecordWrite]
        : []),
    ];
    this.issue.labels = want ? [{ name: want }] : [];
    const all = [...(opts.alongside ?? []), ...mine];
    const ids = await rec().together(all);
    const at = all.findIndex((w) => w.w === "comment");
    if (at >= 0) this.id ??= ids[all.slice(0, at).filter((w) => w.w === "comment").length];
  }
}
