import { describe, expect, it, vi } from 'vitest';
import { emitApiAudit } from './audit.js';
import { enterTrace, normalizeTraceId } from './trace.js';

describe('emitApiAudit', () => {
  it('emits a structured iris.api.request event', () => {
    const log = vi.fn();
    emitApiAudit(log, {
      surface: 'rest',
      operation: 'get_finding',
      args: { id: 'abcdef' },
      result: 'ok',
      result_count: 1,
      latency_ms: 4,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'iris.api.request',
      expect.objectContaining({
        surface: 'rest',
        operation: 'get_finding',
        args: { id: 'abcdef' },
        result: 'ok',
        result_count: 1,
        latency_ms: 4,
      }),
    );
  });

  it('passes through nulls for unauthorized events', () => {
    const log = vi.fn();
    emitApiAudit(log, {
      surface: 'mcp',
      operation: null,
      args: null,
      result: 'unauthorized',
      result_count: null,
      latency_ms: 1,
    });
    expect(log).toHaveBeenCalledWith(
      'iris.api.request',
      expect.objectContaining({ operation: null, args: null, result: 'unauthorized' }),
    );
  });

  it('omits trace_id when no trace is bound', () => {
    const log = vi.fn();
    emitApiAudit(log, {
      surface: 'rest', operation: 'list_runs', args: {}, result: 'ok',
      result_count: 0, latency_ms: 1,
    });
    const fields = log.mock.calls[0]![1] as Record<string, unknown>;
    expect(fields).not.toHaveProperty('trace_id');
  });

  it('includes the bound trace_id from the request-scoped store', () => {
    const log = vi.fn();
    enterTrace('deadbeefcafef00ddeadbeefcafef00d');
    emitApiAudit(log, {
      surface: 'rest', operation: 'list_runs', args: {}, result: 'ok',
      result_count: 0, latency_ms: 1,
    });
    expect(log).toHaveBeenCalledWith(
      'iris.api.request',
      expect.objectContaining({ trace_id: 'deadbeefcafef00ddeadbeefcafef00d' }),
    );
  });
});

describe('normalizeTraceId', () => {
  it('passes through a forwarded hex id (lowercased)', () => {
    expect(normalizeTraceId('DEADBEEFcafef00d')).toBe('deadbeefcafef00d');
  });

  it('mints a fresh 32-char hex id for missing or junk input', () => {
    expect(normalizeTraceId(undefined)).toMatch(/^[0-9a-f]{32}$/);
    expect(normalizeTraceId('not a trace id!!')).toMatch(/^[0-9a-f]{32}$/);
  });
});
