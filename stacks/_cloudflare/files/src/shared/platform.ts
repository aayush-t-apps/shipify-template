// Platform-owned (Shipify; replaced by `ship upgrade`): request ids, structured logs, /health,
// /.well-known/shipify.json, JSON 404s for /api, static-asset fallback and safe errors.
// App routes go in src/worker/app.ts, which the app owns.
import { type Env as HonoEnv, Hono } from "hono";
import manifest from "../../shipify.json";
import type { Facts, Health } from "./health";
import { createLogger, type Logger, safeError } from "./logger";

export interface PlatformEnv {
  APP_ID: string;
  APP_ENV: string;
  GIT_SHA: string;
  ASSETS?: Fetcher;
}

export type PlatformVars = { log: Logger; requestId: string };
export type App<B extends PlatformEnv = PlatformEnv> = Hono<{
  Bindings: B;
  Variables: PlatformVars;
}>;

export const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const APP_VERSION: string = manifest.version;

export function facts(): Facts {
  return {
    shipify: 1,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    kind: "app",
    version: APP_VERSION,
    stack: manifest.stack,
    staging: manifest.staging,
    visibility: manifest.repository.visibility as Facts["visibility"],
    platformVersion: manifest.platformVersion,
  };
}

/**
 * Build the Worker app. `before` runs first (e.g. a method guard); `routes` adds the app's routes
 * before the /api 404 and the static-asset fallback.
 */
export function createApp<B extends PlatformEnv = PlatformEnv>(
  routes?: (app: App<B>) => void,
  before?: (app: App<B>) => void,
): App<B> {
  const app: App<B> = new Hono();
  before?.(app);

  // Correlate every request: reuse a well-formed incoming id, otherwise make one.
  app.use("*", async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    const log = createLogger({
      app: c.env.APP_ID,
      env: c.env.APP_ENV,
      version: `${APP_VERSION}+${c.env.GIT_SHA.slice(0, 7)}`,
      requestId,
    });
    c.set("requestId", requestId);
    c.set("log", log);
    const started = Date.now();
    await next();
    c.header(REQUEST_ID_HEADER, requestId);
    log.info("request", {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.get("/health", (c) => {
    const body: Health = {
      status: "ok",
      app: c.env.APP_ID,
      env: c.env.APP_ENV,
      version: APP_VERSION,
      commit: c.env.GIT_SHA,
      time: new Date().toISOString(),
    };
    c.header("cache-control", "no-store");
    return c.json(body);
  });

  app.get("/.well-known/shipify.json", (c) => {
    c.header("cache-control", "public, max-age=300");
    return c.json(facts());
  });

  routes?.(app);

  app.all("/api/*", (c) => c.json({ error: "not_found", requestId: c.get("requestId") }, 404));

  // Anything else that reaches the Worker falls back to the static assets.
  app.all("*", (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound()));

  app.onError((err, c) => {
    c.get("log")?.error("unhandled_error", { error: safeError(err) });
    return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
  });

  return app;
}

export type { HonoEnv };
