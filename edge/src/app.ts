// The edge's routes (ADR 0031, ADR 0032): each proving its caller, and nothing else.
//   POST /door/<channel>     your messages from a chat (its adapter's proof: channels/)
//   POST /door/replied       a run's reply to copy to your chats (the run's GitHub OIDC token)
//   GET  /door/file/<ref>    a file you sent the bot, for a run (its OIDC token)
//   *    /admin/…            what's private, behind one Cloudflare Access application (path
//                            admin/*), whose token each route checks too (ADR 0036):
//     GET  /admin/status     the status page: read-only (page.ts)
//     *    /admin/chat[/…]   the web chat (web/routes.ts): what you send goes through doorIn as the
//                            `web` channel
//     GET  /admin, /         send you to the chat
//   GET  /draw               the chat's diagram frame: a static page with no data, outside the
//                            sign-in so the chat's sandboxed frame can load it (web/routes.ts)
//   GET  /health             the version and commit deployed, for ci.yml and `ship door check`,
//                            and the door App's install as GitHub says it (its reach and
//                            permissions, nothing secret), so the PC can check it without its key
// No sign-in in front of the door: each route proves who's calling. Access guards /admin alone.
// An error never shows its insides.

import { maskSecrets, useTimeZone } from "../../cli/contracts/index.ts";
import pkg from "../../package.json" with { type: "json" };
import { cached } from "./cache.ts";
import { channelOf } from "./channels/index.ts";
import { doorIn } from "./door-in.ts";
import { replied } from "./door-out.ts";
import type { Deps, Env } from "./env.ts";
import { GITHUB_NEEDS, json, logOf, missing, obj } from "./env.ts";
import { fileOut } from "./files.ts";
import { appJwt, DoorKeyRefused, github } from "./github.ts";
import { statusPage } from "./page.ts";
import { BASE, drawFrame, webChat } from "./web/routes.ts";

/** Where a bare address (/ or /admin) sends you: the chat. */
export function moved(path: string): string | undefined {
  return path === "/" || path === "/admin" || path === "/admin/" ? `${BASE}/` : undefined;
}

/** The door App's install, as GitHub says it: what it reaches and may do. Kept 10 minutes. */
async function doorFacts(env: Env, deps: Deps) {
  if (missing(env, GITHUB_NEEDS).length) return null;
  try {
    return await cached(
      "health:door",
      10 * 60_000,
      async () => {
        const jwt = await appJwt(
          env.SHIPIFY_DOOR_APP_ID ?? "",
          env.SHIPIFY_DOOR_APP_KEY ?? "",
          deps.now(),
        );
        const res = await deps.fetch(
          `https://api.github.com/app/installations/${encodeURIComponent(env.SHIPIFY_DOOR_INSTALLATION ?? "")}`,
          {
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${jwt}`,
              "user-agent": "shipify-edge",
              "x-github-api-version": "2022-11-28",
            },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (res.status === 401 || res.status === 404) throw new DoorKeyRefused(res.status);
        const inst = obj(await res.json().catch(() => null));
        const repos = await github(env, deps).json<{ repositories?: { name: string }[] }>(
          "GET",
          "installation/repositories?per_page=10",
        );
        return {
          permissions: (obj(inst?.permissions) ?? {}) as Record<string, string>,
          selection: String(inst?.repository_selection ?? ""),
          repos: (repos.repositories ?? []).map((r) => r.name),
        };
      },
      deps.now(),
    );
  } catch (e) {
    return {
      error:
        e instanceof DoorKeyRefused ? "GitHub refused the door App's key" : "GitHub didn't answer",
    };
  }
}

/** What /health says: its version (shipify's), the commit deployed, that it's the edge, the App. */
export const health = async (env: Env, deps: Deps) =>
  json({
    status: "ok",
    app: "shipify-edge",
    version: pkg.version,
    commit: env.GIT_SHA ?? "dev",
    time: new Date(deps.now()).toISOString(),
    door: await doorFacts(env, deps),
  });

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  useTimeZone(env.SHIPIFY_TIME_ZONE);
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/health") return await health(env, deps);
    if (path === "/admin/status") return await statusPage(req, env, deps);
    if (path === BASE || path.startsWith(`${BASE}/`)) return await webChat(req, env, deps);
    if (path === "/draw/" || path === "/draw/draw.js") return await drawFrame(req, env);
    const home = moved(path);
    if (home && (req.method === "GET" || req.method === "HEAD"))
      return new Response(null, { status: 302, headers: { location: home } });
    if (req.method === "POST" && path === "/door/replied") return await replied(req, env, deps);
    const file = /^\/door\/file\/([^/]{1,600})$/.exec(path);
    if (req.method === "GET" && file?.[1])
      return await fileOut(req, decodeURIComponent(file[1]), env, deps);
    const chat = /^\/door\/([a-z][a-z0-9-]{0,30})$/.exec(path);
    const ch = chat?.[1] ? channelOf(chat[1]) : undefined;
    if (req.method === "POST" && ch) return await doorIn(req, env, deps, ch);
    return json({ error: "not_found" }, 404);
  } catch (e) {
    logOf(deps, "edge").error("door.in.refused", {
      why: "unexpected",
      path,
      message: maskSecrets(String((e as Error)?.message ?? e)).slice(0, 200),
    });
    return json({ error: "internal_error" }, 500);
  }
}
