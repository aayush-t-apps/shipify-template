// The run and the door (ADR 0031). A run proves itself with its own GitHub OIDC token (shipify's
// main, task.yml or watch.yml): no key is shared between boxes and the door.
//   POST <door>/door/replied     a new reply: the task, its comment, the files the run made (50 MB in
//                                all; the rest are on the branch, linked from the reply). The door
//                                reads the reply from GitHub itself; this only says where to look. A
//                                failed nudge isn't tried again: the watch tells you of the reply.
//   GET  <door>/door/file/<ref>  a file you sent through a chat, for the agent (100 MB at most)
//   POST <door>/door/files/forget  closed chats' files deleted from the web chat's store, and those
//                                no chat used in 60 days: the weekly clean-up's, from watch.yml
//                                (the door takes no other workflow's)
// SHIPIFY_DOOR_URL is the edge's origin.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { logger } from "../contracts/index.ts";
import { defaultChannels } from "../lib/channels.ts";
import { readPeople } from "../lib/people.ts";

/** The run's OIDC token for the door's origin, when this job may have one. */
async function oidcToken(audience: string): Promise<string | undefined> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return undefined;
  const r = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!r.ok) return undefined;
  return ((await r.json()) as { value?: string }).value;
}

/** The door's origin and this run's token for it, or nothing (no door set up, or no OIDC here). */
async function door(): Promise<{ origin: string; token: string } | undefined> {
  const url = process.env.SHIPIFY_DOOR_URL;
  if (!url) return undefined;
  const origin = new URL(url).origin;
  const token = await oidcToken(origin);
  return token ? { origin, token } : undefined;
}

async function within<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** The types a run's files are sent with, by their names' endings: a picture shows as a picture. */
const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
};

/** A file's type from its name; anything else is plain bytes. */
export const typeOf = (name: string) =>
  TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * Where every run's replies go besides the chat they answer: your default channels (SHIPIFY_SEND),
 * to you, told through the door. Each step that applies writes takes this, so none misses a channel.
 */
export function outward() {
  const owner = readPeople().people[0];
  return { defaults: defaultChannels(), ...(owner ? { owner } : {}), tellDoor };
}

/** A reply's files sent to the door in all: one request stays well inside the edge's 100 MB. */
export const MOST_SENT_BYTES = 50 * 1024 * 1024;
/** The most files a reply sends the door, and the most bytes a file fetched for a run. */
const MOST_SENT = 10;
const MOST_FETCHED_BYTES = 100 * 1024 * 1024;

export async function tellDoor(task: number, comment: number, files: string[]): Promise<void> {
  const log = logger({ task, step: "apply" }, (l) => process.stderr.write(`${l}\n`));
  const d = await door();
  if (!d) return;
  const form = new FormData();
  form.set("task", String(task));
  form.set("comment", String(comment));
  // In order, while they fit: one too big for what's left stays on the branch, linked from the reply.
  let room = MOST_SENT_BYTES;
  let left = 0;
  for (const f of files.slice(0, MOST_SENT)) {
    const size = statSync(f).size;
    if (size > room) {
      left++;
      continue;
    }
    room -= size;
    form.append("file", new Blob([readFileSync(f)], { type: typeOf(f) }), basename(f));
  }
  if (left) log.info("door.out.sent", { comment, why: "on the branch only: over 50 MB", left });
  // 50 MB takes a while from a home line: words alone are quick.
  const r = await within(room < MOST_SENT_BYTES ? 120_000 : 30_000, (signal) =>
    fetch(`${d.origin}/door/replied`, {
      method: "POST",
      headers: { Authorization: `Bearer ${d.token}` },
      body: form,
      signal,
    }),
  );
  const said = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.ok) log.info("door.out.sent", { comment, ...said });
  else log.warn("door.out.failed", { comment, status: r.status, ...said });
}

/**
 * A file you sent through a chat (its `from` line's ref), from the door, 100 MB at most: undefined
 * if it can't.
 */
export async function doorFile(ref: string): Promise<Buffer | undefined> {
  const d = await door();
  if (!d) return undefined;
  return within(120_000, async (signal) => {
    const r = await fetch(`${d.origin}/door/file/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${d.token}` },
      signal,
    });
    if (!r.ok || Number(r.headers.get("content-length") ?? 0) > MOST_FETCHED_BYTES) {
      await r.body?.cancel().catch(() => {});
      return undefined;
    }
    const body = Buffer.from(await r.arrayBuffer());
    return body.length > MOST_FETCHED_BYTES ? undefined : body;
  }).catch(() => undefined);
}

/** What the door's forget deleted: the closed chats' files, and the files no chat used, with bytes. */
export interface Forgotten {
  deleted: number;
  bytes: number;
  unclaimed: number;
  unclaimedBytes: number;
  /** The door didn't take them all (no door, no token here, or it refused): the rest next week. */
  failed?: true;
}

/** The most chats one forget names, as the door takes. */
const MOST_FORGOTTEN = 500;

/**
 * The weekly clean-up's step (ADR 0069, section 15): these closed chats' files deleted from the web
 * chat's store, and the files no chat used in 60 days, proven by this job's OIDC token
 * (watch.yml's: the door takes no other). 500 chats a call, and one call with none: what each
 * deleted, added up. A call that fails stops the rest, and what went before it is still counted.
 */
export async function forgetFiles(chats: number[]): Promise<Forgotten> {
  const all = { deleted: 0, bytes: 0, unclaimed: 0, unclaimedBytes: 0 };
  const counts = Object.keys(all) as (keyof typeof all)[];
  const n = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  // No door, no store of files: nothing to clean, and nothing failed.
  if (!process.env.SHIPIFY_DOOR_URL) return all;
  const d = await door();
  if (!d) return { ...all, failed: true };
  for (let i = 0; i === 0 || i < chats.length; i += MOST_FORGOTTEN) {
    const r = await within(60_000, (signal) =>
      fetch(`${d.origin}/door/files/forget`, {
        method: "POST",
        headers: { Authorization: `Bearer ${d.token}`, "content-type": "application/json" },
        body: JSON.stringify({ chats: chats.slice(i, i + MOST_FORGOTTEN) }),
        signal,
      }),
    ).catch(() => undefined);
    const said = (await r?.json().catch(() => null)) as Record<string, unknown> | null;
    // An edge from before it deleted the files no chat used says nothing of them: none went.
    const got: Record<string, unknown> = { unclaimed: 0, unclaimedBytes: 0, ...said };
    if (!r?.ok || !counts.every((k) => n(got[k]))) return { ...all, failed: true };
    for (const k of counts) all[k] += got[k] as number;
  }
  return all;
}
