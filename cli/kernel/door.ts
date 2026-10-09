// The run and the door (ADR 0031). A run proves itself with its own GitHub OIDC token (shipify's
// main, task.yml or watch.yml): no key is shared between boxes and the door.
//   POST <door>/door/replied     a new reply: the task, its comment, the files the run made. The door
//                                reads the reply from GitHub itself; this only says where to look. A
//                                failed nudge isn't tried again: the watch tells you of the reply.
//   GET  <door>/door/file/<ref>  a file you sent through a chat, for the agent (10 MB at most)
// SHIPIFY_DOOR_URL is the edge's origin.
import { readFileSync } from "node:fs";
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
const typeOf = (name: string) =>
  TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * Where every run's replies go besides the chat they answer: your default channels (SHIPIFY_SEND),
 * to you, told through the door. Each step that applies writes takes this, so none misses a channel.
 */
export function outward() {
  const owner = readPeople().people[0];
  return { defaults: defaultChannels(), ...(owner ? { owner } : {}), tellDoor };
}

export async function tellDoor(task: number, comment: number, files: string[]): Promise<void> {
  const log = logger({ task, step: "apply" }, (l) => process.stderr.write(`${l}\n`));
  const d = await door();
  if (!d) return;
  const form = new FormData();
  form.set("task", String(task));
  form.set("comment", String(comment));
  for (const f of files.slice(0, 10))
    form.append("file", new Blob([readFileSync(f)], { type: typeOf(f) }), basename(f));
  const r = await within(30_000, (signal) =>
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

/** A file you sent through a chat (its `from` line's ref), from the door: undefined if it can't. */
export async function doorFile(ref: string): Promise<Buffer | undefined> {
  const d = await door();
  if (!d) return undefined;
  const r = await within(60_000, (signal) =>
    fetch(`${d.origin}/door/file/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${d.token}` },
      signal,
    }),
  ).catch(() => undefined);
  return r?.ok ? Buffer.from(await r.arrayBuffer()) : undefined;
}
