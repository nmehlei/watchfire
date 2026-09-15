import type { Measurement } from '../trailer.js';
import type { CertProbe } from './probe.js';

export type ResultClass = 'ok' | 'warn' | 'critical' | 'error';

export function classifyProbe(p: CertProbe): ResultClass {
  if (!p.connected) return 'error';
  if (p.error && !p.chainValid) return 'critical';
  if (p.hostnameMatch === false) return 'critical';
  if (p.daysUntilExpiry === undefined) return 'error';
  if (p.daysUntilExpiry < 3) return 'critical';
  if (p.daysUntilExpiry < 14) return 'warn';
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

export function renderProbeSummaryLine(p: CertProbe): string {
  const cls = classifyProbe(p);
  const prefix = marker(cls);

  if (!p.connected) {
    return `${prefix} ${p.host} — connection failed: ${p.error ?? 'unknown'}`;
  }
  if (p.daysUntilExpiry === undefined) {
    return `${prefix} ${p.host} — ${p.error ?? 'no expiry date'}`;
  }

  const expiresIso = p.validTo ? p.validTo.slice(0, 10) : '?';
  const chain = p.chainValid
    ? 'chain ok'
    : `chain FAIL${p.error ? ` (${p.error})` : ''}`;
  const sni = p.hostnameMatch === true ? 'hostname ok' : 'hostname MISMATCH';

  return `${prefix} ${p.host} — expires ${expiresIso} (${p.daysUntilExpiry}d) · ${chain} · ${sni}`;
}

export interface Summary {
  total: number;
  ok: number;
  warn: number;
  critical: number;
  error: number;
}

export function summarize(probes: readonly CertProbe[]): Summary {
  const s: Summary = { total: probes.length, ok: 0, warn: 0, critical: 0, error: 0 };
  for (const p of probes) s[classifyProbe(p)]++;
  return s;
}

export function renderSummaryFooter(s: Summary): string {
  return `Summary: ${s.total} probed, ${s.critical} critical, ${s.warn} warning, ${s.error} error, ${s.ok} ok.`;
}

/**
 * Numeric measurements to report as observation trailers (spec 03).
 *
 * Unreachable hosts yield nothing: absence of a measurement is not a
 * measurement of zero, and a fabricated 0 would drag the expiry baseline down.
 */
export function sslMeasurements(probes: readonly CertProbe[]): Measurement[] {
  const out: Measurement[] = [];
  for (const p of probes) {
    if (!p.connected) continue;
    if (p.daysUntilExpiry !== undefined) {
      out.push({ subject: p.host, metric: 'days_until_expiry', value: p.daysUntilExpiry });
    }
    out.push({ subject: p.host, metric: 'chain_valid', value: p.chainValid ? 1 : 0 });
  }
  return out;
}

export function renderProbeDetail(p: CertProbe): string {
  const lines: string[] = [`Host:      ${p.host}`];
  if (!p.connected) {
    lines.push(`Status:    connection failed`);
    if (p.error) lines.push(`Error:     ${p.error}`);
    return lines.join('\n');
  }
  if (p.issuer) lines.push(`Issuer:    ${p.issuer}`);
  if (p.subject) lines.push(`Subject:   ${p.subject}`);
  const from = p.validFrom ? p.validFrom.slice(0, 10) : '?';
  const to = p.validTo ? p.validTo.slice(0, 10) : '?';
  const remaining =
    p.daysUntilExpiry !== undefined ? ` (${p.daysUntilExpiry} day${p.daysUntilExpiry === 1 ? '' : 's'} remaining)` : '';
  lines.push(`Valid:     ${from} → ${to}${remaining}`);
  lines.push(`Chain:     ${p.chainValid ? 'ok' : `FAIL${p.error ? ` — ${p.error}` : ''}`}`);
  lines.push(`Hostname:  ${p.hostnameMatch ? 'ok' : 'MISMATCH'}`);
  return lines.join('\n');
}
