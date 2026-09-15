import type { Measurement } from '../trailer.js';
import type { HttpProbe } from './probe.js';

export type ResultClass = 'ok' | 'warn' | 'critical' | 'error';

export function classifyProbe(p: HttpProbe): ResultClass {
  if (!p.ok && p.status === undefined) return 'error'; // connection-level failure
  if (!p.ok && p.status !== undefined && p.status >= 500) return 'critical';
  if (!p.ok && p.status !== undefined && p.status >= 400) return 'warn';
  return 'ok';
}

function marker(cls: ResultClass): string {
  switch (cls) {
    case 'critical':
      return '🔴';
    case 'warn':
      return '⚠ ';
    case 'error':
      return '✗ ';
    case 'ok':
      return '  ';
  }
}

export function renderProbeSummaryLine(p: HttpProbe): string {
  const prefix = marker(classifyProbe(p));
  if (!p.ok && p.status === undefined) {
    return `${prefix} ${p.name} ${p.url} — failed: ${p.error ?? 'unknown'}`;
  }
  const statusStr = p.status !== undefined ? `HTTP ${p.status}` : 'no response';
  const ms = p.responseMs !== undefined ? `${p.responseMs}ms` : '—';
  const size = p.bodySize !== undefined ? `${p.bodySize}B` : '—';
  return `${prefix} ${p.name} ${p.url} — ${statusStr} · ${ms} · ${size}`;
}

/**
 * Numeric measurements to report as observation trailers (spec 03).
 *
 * Keyed off what the probe actually captured, not off `ok`: a 500 response is
 * a failed check but a real latency and status sample, and the status trend is
 * precisely what makes "usually 200, now 500" detectable. Only an endpoint
 * that never answered yields nothing.
 */
export function httpMeasurements(probes: readonly HttpProbe[]): Measurement[] {
  const out: Measurement[] = [];
  for (const p of probes) {
    if (p.responseMs !== undefined) {
      out.push({ subject: p.name, metric: 'response_ms', value: p.responseMs });
    }
    if (p.status !== undefined) {
      out.push({ subject: p.name, metric: 'status_code', value: p.status });
    }
    if (p.bodySize !== undefined) {
      out.push({ subject: p.name, metric: 'body_bytes', value: p.bodySize });
    }
  }
  return out;
}

export function renderProbeDetail(p: HttpProbe): string {
  const lines: string[] = [`Name:       ${p.name}`, `URL:        ${p.url}`];
  if (!p.ok && p.status === undefined) {
    lines.push(`Status:     connection failure`);
    if (p.error) lines.push(`Error:      ${p.error}`);
    if (p.responseMs !== undefined) lines.push(`Time:       ${p.responseMs}ms`);
    return lines.join('\n');
  }
  if (p.status !== undefined) lines.push(`Status:     HTTP ${p.status}`);
  if (p.responseMs !== undefined) lines.push(`Time:       ${p.responseMs}ms`);
  if (p.bodySize !== undefined) lines.push(`Body size:  ${p.bodySize} bytes`);
  return lines.join('\n');
}

export interface Summary {
  total: number;
  ok: number;
  warn: number;
  critical: number;
  error: number;
}

export function summarize(probes: readonly HttpProbe[]): Summary {
  const s: Summary = { total: probes.length, ok: 0, warn: 0, critical: 0, error: 0 };
  for (const p of probes) s[classifyProbe(p)]++;
  return s;
}

export function renderSummaryFooter(s: Summary): string {
  return `Summary: ${s.total} probed, ${s.critical} critical, ${s.warn} warning, ${s.error} error, ${s.ok} ok.`;
}
