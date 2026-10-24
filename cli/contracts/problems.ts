// One shape for every error you see (ADR 0031): in a reply, in the CLI, in the door's chat answers
// and in the watch's alerts. Each known code has its words and its fix here, once; an error with no
// code still shows, as "unexpected", with its first line. Pure: the edge imports it too.
import { z } from "zod";
import { maskSecrets } from "./mask.ts";

export const Problem = z.object({
  code: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** What happened, in one plain sentence. */
  what: z.string().min(1).max(300),
  why: z.string().max(500).optional(),
  /** The one thing to do: a command, a link, or a few words. */
  fix: z.string().min(1).max(300),
  /** Where to look: a run, a PR, a page. */
  where: z.string().url().optional(),
});
export type Problem = z.infer<typeof Problem>;

/** Known problems: what each says and what to do. `{x}` is filled in from the details given. */
export const CATALOGUE = {
  "box-offline": {
    what: "No box is online, so nothing can run.",
    fix: "Start the box (`pnpm ship box start <box>`), or check it with `pnpm ship box status`.",
  },
  "key-missing": {
    what: "{key} isn't set, so {tool} can't run here.",
    fix: "pnpm ship add {tool}",
  },
  "key-refused": {
    what: "{tool} refused its key.",
    fix: "pnpm ship add {tool} --new --yes",
  },
  "tool-refused": {
    what: "{tool} refused {call}: {answer}",
    fix: "Change the request and say it again, or fix it in {tool} by hand.",
  },
  "verify-failed": {
    what: "`make verify` failed, so no PR was opened.",
    fix: "Reply `continue` to try again, or say what to change.",
  },
  "agent-stopped": {
    what: "The agent stopped before it finished: {why}.",
    fix: "Reply `continue` to carry on.",
  },
  "agent-error": {
    what: "{model} answered: {error}",
    fix: "Reply `continue` to try again, or pick another model with /use.",
  },
  "result-wrong": {
    what: "The agent's answer didn't fit Shipify's shape ({fields}).",
    fix: "Reply `continue`, or pick another model with /use.",
  },
  "plan-used-up": {
    what: "Your plan's {limit} limit is used up, so the agent stopped.",
    fix: "Reply `continue` after {when}.",
  },
  "secret-in-change": {
    what: "The change has something that looks like a key ({file}), so it wasn't pushed.",
    fix: "Say how to remove it, then `continue`.",
  },
  "github-down": {
    what: "Couldn't reach GitHub: nothing was saved.",
    fix: "Send it again in a minute.",
  },
  "github-unread": {
    what: "Couldn't read GitHub just now.",
    fix: "Try again in a minute.",
  },
  "github-refused": {
    what: "GitHub refused it, so nothing was saved.",
    fix: "Send it again, or write it on GitHub.",
  },
  "door-closed": {
    what: "The door is closed (SHIPIFY_DOOR is closed), so nothing was saved.",
    fix: "Delete the variable SHIPIFY_DOOR on GitHub to open it, then send it again.",
  },
  "door-failed": {
    what: "Something went wrong in the door ({first_line}), so nothing was saved.",
    fix: "Send it again. If it happens again, it's Shipify's bug: the edge's logs have the rest.",
  },
  "turn-failed": {
    what: "Couldn't {turn} #{task}: GitHub failed, so nothing was saved.",
    fix: "Send it again.",
  },
  "chat-refused": {
    what: "{channel} refused to deliver to {chat}: {answer}",
    fix: "Unblock the bot or start it again in the chat, then `pnpm ship selftest chat`.",
  },
  "chat-rendering": {
    what: "{channel} refused #{task}'s reply as Shipify made it (“{answer}”).",
    fix: "That's Shipify's bug, not yours: read the reply on GitHub.",
  },
  "files-unsent": {
    what: "{files} of the reply didn't send here.",
    fix: "{they} on the reply on GitHub.",
  },
  stopped: {
    what: "This task's run stopped before it finished (the box restarted, or the run broke off).",
    fix: "Reply `continue` to carry it on from where it got to, or close it.",
  },
  "words-unanswered": {
    what: "#{task} wasn't answered: no run replied to your words (none started, or one broke before it could say so).",
    fix: "Reply `continue`.",
  },
  "form-wrong": {
    what: "The form has a wrong answer: {answer}",
    fix: "Edit the issue to fix it; that starts it.",
  },
  "no-such-task": {
    what: "There's no task #{task} to carry on.",
    fix: "Reply to one of my messages, or start with the right number.",
  },
  "no-such-project": {
    what: "There's no project {project}.",
    fix: "Name one of: {projects}.",
  },
  "approval-expired": {
    what: "That `yes` came after the list stopped being good (a day, or the task changed).",
    fix: "Ask again for a fresh list.",
  },
  "list-gone": {
    what: "That Yes is for a list that isn't waiting any more, so nothing was changed.",
    fix: "Tap Yes under the newest list, or ask again for a fresh one.",
  },
  "list-too-long": {
    what: "That list is too long to show whole in a chat, so it's approved only on GitHub.",
    fix: "Comment `yes` on the task there.",
  },
  "too-big": {
    what: "{what_too_big} is too big to keep.",
    fix: "Ask for less at a time.",
  },
  "door-key-refused": {
    what: "GitHub refused the door App's key, so the door can't write your messages or copy replies.",
    fix: "Make a new key on the App's page, then: pnpm ship door setup --new --yes",
  },
  "key-expiring": {
    what: "{key} expires on {date}: {days} days left.",
    fix: "{how}",
  },
  "runner-old": {
    what: "{box}'s runner is {version}; GitHub stops sending it jobs 30 days after {latest} came out ({date}).",
    fix: "Re-add the box to update it: pnpm ship box add {box} --manage --yes",
  },
  "reply-unsent": {
    what: "#{task} has a reply you may have missed here.",
    fix: "Open it on GitHub.",
  },
  "op-blocked": {
    what: "{first_line}",
    fix: "Do what it says first, then ask for the {op} again: `continue` would stop the same way.",
  },
  "step-failed": {
    what: "The run's {step} step failed: {error}",
    fix: "Reply `continue` to try again. If it fails the same way, it's Shipify, not your task: the run's log has the rest.",
  },
  unexpected: {
    what: "Something went wrong: {first_line}",
    fix: "Reply `continue` to try again; the run's log has the rest.",
  },
} as const satisfies Record<string, { what: string; fix: string }>;
export type ProblemCode = keyof typeof CATALOGUE;

const fill = (s: string, details: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => details[k] ?? `{${k}}`);

/** A known problem, filled in from its details and masked. */
export function problem(
  code: ProblemCode,
  details: Record<string, string> = {},
  extra: { why?: string; where?: string } = {},
): Problem {
  const c = CATALOGUE[code];
  return Problem.parse({
    code,
    what: maskSecrets(fill(c.what, details)).slice(0, 300),
    fix: maskSecrets(fill(c.fix, details)).slice(0, 300),
    ...(extra.why ? { why: maskSecrets(extra.why).slice(0, 500) } : {}),
    ...(extra.where ? { where: extra.where } : {}),
  });
}

/** An error's first line, at most 200 characters: how an error is quoted in a problem. */
export const errorLine = (e: unknown) =>
  (String((e as Error)?.message ?? e).split("\n")[0] || "no message").slice(0, 200);

/** Any error as a problem: a known code when it carries one, else "unexpected". */
export function asProblem(e: unknown, where?: string): Problem {
  const known = (e as { problem?: Problem } | undefined)?.problem;
  if (known) return known;
  return problem("unexpected", { first_line: errorLine(e) }, where ? { where } : {});
}

/** How a problem reads, in markdown: what, why, then what to do. */
export const renderProblem = (p: Problem) =>
  [`**${p.what}**`, p.why, `**What to do:** ${p.fix}`, p.where ? `(${p.where})` : ""]
    .filter(Boolean)
    .join("\n\n");
