import "server-only";

type Level = "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
  trace_id?: string;
}

/**
 * Structured JSON logger. Goes to stdout, where the App Service Log
 * Stream picks it up and the OTel collector forwards to OpenObserve
 * (stream "watchfire-dashboard.*", separate from "watchfire.*"). Spec 12
 * §Observability.
 *
 * Always JSON on a single line — easier to parse and correlate.
 */
function emit(level: Level, message: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: "watchfire-dashboard",
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};

/**
 * 16 random bytes as 32-char lowercase hex. Matches the trace-id half
 * of the W3C traceparent format; we forward this as `x-trace-id` so
 * Watchfire can include the same id in its own audit log entries.
 */
export function newTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
