// Platform-owned (Shipify; replaced by `ship upgrade`). The /health contract shared by every app.
// CI checks `commit` after each deploy; `/apps` shows `version`.
export interface Health {
  status: "ok" | "degraded" | "failing";
  app: string;
  env: string;
  /** Semantic version from shipify.json, e.g. "1.3.0". */
  version: string;
  /** Git commit deployed. */
  commit: string;
  time: string;
}

/** Public, non-secret facts at /.well-known/shipify.json: what the app is, for anyone looking. */
export interface Facts {
  shipify: 1;
  id: string;
  name: string;
  description: string;
  kind: "app";
  version: string;
  stack: { id: string; version: string };
  staging: boolean;
  visibility: "public" | "private";
  platformVersion: string;
}
