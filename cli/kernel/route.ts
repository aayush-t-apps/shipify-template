// Where a reply goes besides the task itself (ADR 0031): worked out once, here. A reply goes back
// where you wrote: the chats of the messages this run answers (askedFrom). Your default channels
// get only what no one wrote for: an alert, a repeat's reply (ADR 0032: instead of the chat it began
// in, so it comes once), and every reply of a task Shipify opened itself (a recipe's), so its
// answers reach you too. A task you carry on in GitHub or the web chat stays there. The door copies
// a reply only to ids it knows are yours, so this can never reach anyone else.
import { type ReplyKind, TO_DEFAULTS } from "../contracts/index.ts";

export interface Person {
  name: string;
  /** Their id on each channel: { telegram: "123" }. */
  on: Record<string, string>;
}

/**
 * A repeat's own reply (a reminder, a job, a check that changed), which goes to your default
 * channels: never one you asked for with `again`, which answers where you wrote, as any reply does.
 */
export const scheduledReply = (step: string, occasion?: string) =>
  ["reminder", "think-scheduled", "check"].includes(step) && !occasion?.startsWith("again-");

export function replyTo(r: {
  kind: ReplyKind;
  /** `<channel>:<chat>` of the messages this run answers (askedFrom). */
  asked: string[];
  /** Your default channels (SHIPIFY_SEND): "telegram". */
  defaults: string[];
  /** You: the owner's ids, for the default channels. */
  owner?: Person;
  /** A task Shipify opened itself (a recipe's): every reply goes to your default channels. */
  ownTask?: boolean;
  /** A repeat's reply (a reminder, a job, a check that changed): asked to come, so it does. */
  scheduled?: boolean;
}): string[] {
  const out = new Set(r.asked);
  if ((r.ownTask || r.scheduled || TO_DEFAULTS.includes(r.kind)) && r.owner) {
    const to = r.defaults
      .filter((ch) => ch !== "github" && r.owner?.on[ch])
      .map((ch) => `${ch}:${r.owner?.on[ch]}`);
    // A repeat answers your default channels; the chat it began in only when none reaches you, so a
    // repeat made in Telegram doesn't come twice.
    if (r.scheduled && to.length) out.clear();
    for (const t of to) out.add(t);
  }
  return [...out].slice(0, 10);
}
