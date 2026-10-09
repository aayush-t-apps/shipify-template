// One log shape for the box and the edge (ADR 0031): a JSON line per event, masked. On a box it
// goes to the job's log (stderr); in the edge, to Workers' logs (console). A run collects its
// warnings so they show in its run details, and no one has to open a log to learn something
// went sideways.
import type { EventName } from "./labels.ts";
import { maskSecrets } from "./mask.ts";

export type Level = "info" | "warn" | "error";

export interface LogContext {
  task?: number;
  run?: string;
  step?: string;
}

export interface LogLine extends LogContext {
  at: string;
  level: Level;
  event: EventName;
  [k: string]: unknown;
}

/** A logger: each call writes one masked line, and warnings and errors are kept for the run. */
export function logger(
  context: LogContext,
  write: (line: string) => void,
  now: () => Date = () => new Date(),
) {
  const kept: string[] = [];
  const emit = (level: Level, event: EventName, data: Record<string, unknown> = {}) => {
    const line: LogLine = { at: now().toISOString(), level, event, ...context, ...data };
    const text = maskSecrets(JSON.stringify(line));
    write(text);
    if (level !== "info") {
      const said = typeof data.message === "string" ? data.message : event;
      kept.push(maskSecrets(said).slice(0, 300));
    }
  };
  return {
    info: (event: EventName, data?: Record<string, unknown>) => emit("info", event, data),
    warn: (event: EventName, data?: Record<string, unknown>) => emit("warn", event, data),
    error: (event: EventName, data?: Record<string, unknown>) => emit("error", event, data),
    /** What went sideways in this run, for its run details. */
    warnings: () => [...kept],
  };
}
export type Logger = ReturnType<typeof logger>;
