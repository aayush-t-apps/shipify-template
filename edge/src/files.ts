// A file you sent from a chat, for a run (ADR 0031, "Files, both ways"): GET /door/file/<ref>,
// where ref is the `<channel>:<id>` the door wrote in the task's `from` line. The run proves itself
// with its GitHub OIDC token, as for /door/replied; the channel's keys stay here. Its adapter fetches
// the bytes, 10 MB at most, and nothing is kept.
import { channelOf } from "./channels/index.ts";
import type { Deps, Env } from "./env.ts";
import { json, logOf, missing, OIDC_NEEDS, unconfigured } from "./env.ts";
import { github } from "./github.ts";
import { bearer, verifyRun } from "./oidc.ts";
import { settings } from "./settings.ts";

export { capped, MAX_FILE_BYTES } from "./channels/channel.ts";

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
