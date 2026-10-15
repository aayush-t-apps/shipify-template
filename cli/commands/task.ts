// What's left of `ship task` and the box's task helpers (ADR 0031): a run's steps are `ship run`
// (cli/kernel/run.ts). task.yml calls `ship task plans` on a push to main (merged plans start their
// tasks); the watch's runs (commands/watch.ts) use taskDue for what's due and cleanUpTasks for a
// box's weekly clean-up.
//
// The parts, in task/:
//   context.ts    the issue's shape, where this runs, paths and small helpers
//   issue.ts      the task's issue on the record: replies, the labels, the status comment
//   files.ts      the owner's images and linked files; files a run shares
//   deploys.ts    a merged PR's deploy, followed
//   plans.ts      a merged plan's build, and `publish`
//   notebook.ts   the notebook's reads and writes
//   due.ts        what's due, for the watch's due run
//   lifecycle.ts  a box's clean-up, and every slot's workspace

export { runUrl, whereThisRuns } from "./task/context.ts";
export { type Due, taskDue } from "./task/due.ts";
export {
  freeFile,
  type Given,
  madeFiles,
  saveAttachments,
  saveLinkedFiles,
} from "./task/files.ts";
export { cleanUpTasks, slotWorkspaces } from "./task/lifecycle.ts";
export { taskPlans } from "./task/plans.ts";
