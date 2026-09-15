import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

interface TraceContext {
  trace_id: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Normalize an inbound `x-trace-id`. The dashboard BFF forwards the
 * trace-id half of a W3C traceparent (32 hex chars); accept anything
 * that looks hex-ish and 8–64 long, otherwise mint a fresh id so every
 * request is always correlatable.
 */
export function normalizeTraceId(header: string | undefined): string {
  if (header && /^[0-9a-f]{8,64}$/i.test(header)) return header.toLowerCase();
  return randomBytes(16).toString('hex');
}

/**
 * Bind a trace id to the current async execution. Called once per
 * request from the Fastify onRequest hook via `enterWith`, so all
 * downstream handlers (and the audit emitter) see the same id without
 * threading it through every call.
 */
export function enterTrace(trace_id: string): void {
  storage.enterWith({ trace_id });
}

/** The trace id bound to the current request, or null outside a request. */
export function currentTraceId(): string | null {
  return storage.getStore()?.trace_id ?? null;
}
