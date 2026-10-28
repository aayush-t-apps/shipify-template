// Names the core and the edge share (ADR 0031): labels the watch and runs set, reply kinds, and the
// event names logs use. One list each, so the box and the edge can't drift.

/**
 * Stopped: a task whose run ended before it finished, or whose words waited with no run. The watch
 * marks it and alerts once; nothing starts it but your `continue`, whose run takes it off.
 */
export const STUCK_LABEL = "stuck";
/**
 * On a task while its run stays after an answer (ADR 0057): task.yml starts no run for its events,
 * since the staying run answers them. Off when it leaves, however its job ends, as the door closes
 * the task, and as the watch marks it Stopped.
 */
export const STAYING_LABEL = "staying";
/**
 * On a part of a split task (ADR 0066): the box opened it on your `yes`, its run gets its parent's
 * goal, and its close tells its parent. Its body's first line is `Part of #<parent>`.
 */
export const SUB_TASK_LABEL = "sub-task";
/** On a split task after your `go` (ADR 0066): a part's merge starts the next. `stop` takes it off. */
export const STARTED_LABEL = "started";
/** On a task while its merged PR's deploy is followed by the due run. */
export const DEPLOYING_LABEL = "deploying";
/** On a task waiting for you (a question, a list for your yes, a PR to merge): the status page lists them. */
export const NEEDS_YOU_LABEL = "needs you";
/** A task's state as its runs label it; a closed task drops them (its run, or the door as it closes it). */
export const STATE_LABELS = ["working", NEEDS_YOU_LABEL, "failed", "answered"] as const;

/** Doorbells the watch rings on the status task; each watch.yml run removes its own. */
export const WATCH_LABELS = {
  due: "watch:due",
  alert: "watch:alert",
  /** The alert, on GitHub's machines: no box is online. */
  alertGithub: "watch:alert-github",
} as const;

/** What a reply is: it decides who hears it besides the chat it came from. */
export const REPLY_KINDS = ["answer", "needs-you", "live", "alert", "failed"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
/**
 * These reach your default channels (SHIPIFY_SEND) too: the watch's alerts, which no one asked
 * for. A task's reply goes back where you wrote (route.ts), even when it needs you.
 */
export const TO_DEFAULTS: ReplyKind[] = ["alert"];
/** A comment this long after a close carries the task on ("Close with comment" comes just after). */
export const AFTER_CLOSE_MS = 60_000;

/** Every log event's name, the same on a box and in the edge. */
export const EVENTS = [
  "door.in.written",
  "door.in.answered",
  "door.in.refused",
  "door.out.sent",
  "door.out.failed",
  "door.file.served",
  "page.served",
  "page.refused",
  "run.plan.decided",
  "run.plan.nothing",
  "run.stay.handover",
  "run.stay.left",
  "run.plan.reopen",
  "run.think.started",
  "run.think.ended",
  "run.apply.wrote",
  "run.apply.failed",
  "run.problem",
  "watch.due",
  "watch.stopped",
  "watch.stay.cleared",
  "watch.notice",
  "watch.guard",
] as const;
export type EventName = (typeof EVENTS)[number];
