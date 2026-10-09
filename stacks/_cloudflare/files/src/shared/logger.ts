// Structured JSON logs. One line per event, safe to ship to any log store.
// Never log request bodies, headers or anything that could hold a credential.

export type Level = "debug" | "info" | "warn" | "error";

export interface LogContext {
  app: string;
  env: string;
  version: string;
  requestId?: string;
}

const SENSITIVE_KEY = /authorization|cookie|token|password|passwd|secret|api[-_]?key|session/i;
const MAX_DEPTH = 4;

/** Replace values whose key looks sensitive. Walks nested objects and arrays. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Error details that are safe to log: name, message and the first stack frames. */
export function safeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 4) };
  }
  return { name: "NonError", message: String(err) };
}

export function createLogger(ctx: LogContext, sink: (line: string) => void = console.log) {
  const log = (level: Level, event: string, data: Record<string, unknown> = {}) => {
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        app: ctx.app,
        env: ctx.env,
        version: ctx.version,
        requestId: ctx.requestId,
        event,
        ...(redact(data) as Record<string, unknown>),
      }),
    );
  };
  return {
    debug: (event: string, data?: Record<string, unknown>) => log("debug", event, data),
    info: (event: string, data?: Record<string, unknown>) => log("info", event, data),
    warn: (event: string, data?: Record<string, unknown>) => log("warn", event, data),
    error: (event: string, data?: Record<string, unknown>) => log("error", event, data),
  };
}
export type Logger = ReturnType<typeof createLogger>;
