// A file you sent from a chat, for a run (ADR 0031, "Files, both ways"): GET /door/file/<ref>,
// where ref is the `<channel>:<id>` the door wrote in the task's `from` line. The run proves itself
// with its GitHub OIDC token, as for /door/replied; the channel's keys stay here. Its adapter fetches
// the bytes, 100 MB at most, and nothing is kept.
// And the weekly clean-up's (ADR 0069, section 15): POST /door/files/forget, `{"chats": [n, …]}`,
// deletes those chats' files from the web chat's store, and the files no chat used in 60 days. Only
// watch.yml's own token gets in, so no agent's run can delete a file.
import { channelOf } from "./channels/index.ts";
import type { Deps, Env } from "./env.ts";
import { bucketOf, json, logOf, missing, OIDC_NEEDS, unconfigured } from "./env.ts";
import { github } from "./github.ts";
import { bearer, verifyRun } from "./oidc.ts";
import { settings } from "./settings.ts";
import { forget } from "./store.ts";

/** The most chats one forget names. */
const MOST_FORGOTTEN = 500;

export async function fileOut(req: Request, ref: string, env: Env, deps: Deps): Promise<Response> {
  const log = logOf(deps, "door.file");
  const hit = /^([a-z][a-z0-9-]{0,30}):(.+)$/.exec(ref);
  const ch = hit?.[1] ? channelOf(hit[1]) : undefined;
  const gone = missing(env, [...OIDC_NEEDS, ...(ch?.needs ?? [])]);
  if (gone.length) return unconfigured(log, gone);
  const token = bearer(req);
  const verdict = token
    ? await verifyRun(token, env, deps)
    : { ok: false as const, why: "no token" };
  if (!verdict.ok) {
    log.warn("door.in.refused", { why: `file: unproven: ${verdict.why}` });
    return json({ error: "unproven", why: verdict.why }, 401);
  }
  if (!ch?.file || !hit?.[2]) return json({ error: "not_found" }, 404);
  // The kill switch, when the door App can say: closed, nothing goes out. Unread, it's not taken as
  // open: the run is told the file couldn't be fetched, and why.
  if (env.SHIPIFY_DOOR_APP_KEY) {
    const s = await settings(github(env, deps), deps.now()).catch(() => null);
    if (!s) return json({ error: "couldn't read the door's settings on GitHub" }, 503);
    if (s.closed) return json({ door: "closed" }, 503);
  }
  const res = await ch.file(env, deps, hit[2]);
  if (res.ok) {
    const length = Number(res.headers.get("content-length") ?? 0);
    log.info("door.file.served", { channel: ch.id, ...(length ? { bytes: length } : {}) });
  }
  return res;
}

/** The chats a forget names: positive numbers, MOST_FORGOTTEN at most; undefined for anything else. */
async function chatsOf(req: Request): Promise<number[] | undefined> {
  const body = (await req.json().catch(() => null)) as { chats?: unknown } | null;
  const l = body?.chats;
  if (!Array.isArray(l) || l.length > MOST_FORGOTTEN) return undefined;
  return l.every((n) => Number.isSafeInteger(n) && n > 0) ? (l as number[]) : undefined;
}

/**
 * The weekly clean-up's delete: every file of these chats, and every file no chat used in 60 days,
 * from the web chat's store; asked with no chats too. Proven by watch.yml's OIDC token alone:
 * task.yml's (any agent's run) is refused, 403. How many of each went, and their bytes.
 */
export async function forgetFiles(req: Request, env: Env, deps: Deps): Promise<Response> {
  const log = logOf(deps, "door.file");
  const gone = missing(env, OIDC_NEEDS);
  if (gone.length) return unconfigured(log, gone);
  const token = bearer(req);
  const verdict = token
    ? await verifyRun(token, env, deps, ["watch.yml"])
    : { ok: false as const, why: "no token" };
  if (!verdict.ok) {
    log.warn("door.in.refused", { why: `forget: unproven: ${verdict.why}` });
    return json({ error: "unproven", why: verdict.why }, verdict.why === "workflow" ? 403 : 401);
  }
  const chats = await chatsOf(req);
  if (!chats)
    return json({ error: `chats: a list of task numbers, ${MOST_FORGOTTEN} at most` }, 400);
  const bucket = bucketOf(env);
  const done = bucket
    ? await forget(bucket, chats, deps.now())
    : { deleted: 0, bytes: 0, unclaimed: 0, unclaimedBytes: 0 };
  log.info("door.file.served", { what: "forgotten", chats: chats.length, ...done });
  return json(done);
}
