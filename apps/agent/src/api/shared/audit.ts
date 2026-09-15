import { currentTraceId } from './trace.js';
import type { ApiErrorCode } from './types.js';

export type ApiSurface = 'mcp' | 'rest';
export type ApiOperation =
  | 'get_finding'
  | 'recent_findings'
  | 'list_runs'
  | 'get_run'
  | 'get_run_findings'
  | 'search_findings'
  | 'list_mutes'
  | 'mute_finding'
  | 'unmute_finding'
  | 'cost_window'
  | 'adapter_health';
export type ApiResult = 'ok' | ApiErrorCode;

export type ApiAuditLogger = (msg: string, fields: Record<string, unknown>) => void;

export interface ApiAuditEvent {
  surface: ApiSurface;
  operation: ApiOperation | null;
  args: Record<string, unknown> | null;
  result: ApiResult;
  result_count: number | null;
  latency_ms: number;
}

/** Spec 11 §Audit emitter. One event per request, transport-agnostic. */
export function emitApiAudit(log: ApiAuditLogger, event: ApiAuditEvent): void {
  // trace_id is picked up ambiently from the request-scoped store (set
  // by the onRequest hook). When absent (e.g. unit tests calling the
  // emitter directly), the field is omitted. Lets dashboard ↔ Watchfire logs
  // correlate without threading the id through every handler.
  const trace_id = currentTraceId();
  log('watchfire.api.request', {
    surface: event.surface,
    operation: event.operation,
    args: event.args,
    result: event.result,
    result_count: event.result_count,
    latency_ms: event.latency_ms,
    ...(trace_id ? { trace_id } : {}),
  });
}
