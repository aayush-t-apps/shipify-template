// The bare address, `/`, for everyone: you, a guest, or someone with only the link. It isn't behind
// Access, but Access's sign-in cookie (CF_Authorization) is the host's by default, so it comes here
// too: a token that checks out (accessClaims: the signature, the audience, the team, the time) for
// your application sends you to your chat, one for the guests' application to theirs. No cookie, or
// one that doesn't check out, gets a small page with both ways in (no GitHub read). It only sends
// people on: Access and each route's own check still guard both places, so it opens nothing.
import { accessClaims } from "../access.ts";
import type { Deps, Env } from "../env.ts";
import { GITHUB_NEEDS, missing } from "../env.ts";
import { github } from "../github.ts";
import { settings } from "../settings.ts";
import { doorPage } from "./door-page.ts";
import { BASE, GUEST_BASE } from "./routes.ts";

/** At most this many sign-in cookies are checked: a browser sends one, or one a path. */
const MOST_COOKIES = 4;

/** Access's sign-in tokens in the request's cookies. */
function signIns(req: Request): string[] {
  return (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c.startsWith("CF_Authorization="))
    .map((c) => c.slice("CF_Authorization=".length))
    .filter(Boolean)
    .slice(0, MOST_COOKIES);
}

/** Where a sign-in sends you: your chat, the guests', or nowhere (the page). */
async function placeOf(req: Request, env: Env, deps: Deps): Promise<string | undefined> {
  const tokens = signIns(req);
  if (!tokens.length || missing(env, GITHUB_NEEDS).length) return undefined;
  const access = (await settings(github(env, deps), deps.now()).catch(() => undefined))?.access;
  if (!access) return undefined;
  for (const t of tokens) if (await accessClaims(t, access, deps)) return `${BASE}/`;
  if (access.guests)
    for (const t of tokens)
      if (await accessClaims(t, { team: access.team, aud: access.guests }, deps))
        return `${GUEST_BASE}/`;
  return undefined;
}

/** GET / : on to your place when the sign-in says who you are, else the page with both ways in. */
export async function home(req: Request, env: Env, deps: Deps): Promise<Response> {
  const to = await placeOf(req, env, deps);
  if (to) return new Response(null, { status: 302, headers: { location: to } });
  return doorPage(200, "Shipify", "Sign in to open your chat.", [
    [`${GUEST_BASE}/`, "Sign in as a guest"],
    [`${BASE}/`, "Owner"],
  ]);
}
