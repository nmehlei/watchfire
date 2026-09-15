import { describe, expect, it } from 'vitest';
import {
  classifyProbe,
  renderProbeDetail,
  renderProbeSummaryLine,
  renderSummaryFooter,
  sslMeasurements,
  summarize,
} from './format.js';
import type { CertProbe } from './probe.js';

function probe(overrides: Partial<CertProbe> = {}): CertProbe {
  return {
    host: 'example.com',
    connected: true,
    subject: 'CN=example.com',
    issuer: 'CN=Test CA',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-07-01T00:00:00.000Z',
    daysUntilExpiry: 70,
    hostnameMatch: true,
    chainValid: true,
    ...overrides,
  };
}

describe('classifyProbe', () => {
  it('ok for healthy cert', () => {
    expect(classifyProbe(probe())).toBe('ok');
  });
  it('warn for expiry < 14', () => {
    expect(classifyProbe(probe({ daysUntilExpiry: 10 }))).toBe('warn');
  });
  it('critical for expiry < 3', () => {
    expect(classifyProbe(probe({ daysUntilExpiry: 2 }))).toBe('critical');
  });
  it('critical for chain failure', () => {
    expect(classifyProbe(probe({ chainValid: false, error: 'expired' }))).toBe('critical');
  });
  it('critical for hostname mismatch', () => {
    expect(classifyProbe(probe({ hostnameMatch: false }))).toBe('critical');
  });
  it('error when not connected', () => {
    expect(classifyProbe(probe({ connected: false, error: 'ECONNREFUSED' }))).toBe('error');
  });
  it('error when no expiry available', () => {
    expect(classifyProbe(probe({ daysUntilExpiry: undefined }))).toBe('error');
  });
});

describe('renderProbeSummaryLine', () => {
  it('renders an ok probe as a single line', () => {
    const line = renderProbeSummaryLine(probe({ daysUntilExpiry: 163 }));
    expect(line).toContain('example.com');
    expect(line).toContain('(163d)');
    expect(line).toContain('chain ok');
    expect(line).toContain('hostname ok');
  });

  it('prefixes 🔴 for critical', () => {
    const line = renderProbeSummaryLine(probe({ daysUntilExpiry: 1 }));
    expect(line.startsWith('🔴')).toBe(true);
  });

  it('prefixes ⚠ for warn', () => {
    const line = renderProbeSummaryLine(probe({ daysUntilExpiry: 10 }));
    expect(line.startsWith('⚠')).toBe(true);
  });

  it('shows connection failure when not connected', () => {
    const line = renderProbeSummaryLine(probe({ connected: false, error: 'ETIMEDOUT' }));
    expect(line).toContain('connection failed');
    expect(line).toContain('ETIMEDOUT');
  });
});

describe('summarize', () => {
  it('counts each class', () => {
    const s = summarize([
      probe({ daysUntilExpiry: 100 }),
      probe({ daysUntilExpiry: 10 }),
      probe({ daysUntilExpiry: 1 }),
      probe({ connected: false, error: 'refused' }),
      probe({ daysUntilExpiry: 200 }),
    ]);
    expect(s).toEqual({ total: 5, ok: 2, warn: 1, critical: 1, error: 1 });
  });
});

describe('renderSummaryFooter', () => {
  it('formats the summary line', () => {
    const footer = renderSummaryFooter({ total: 5, ok: 2, warn: 1, critical: 1, error: 1 });
    expect(footer).toBe('Summary: 5 probed, 1 critical, 1 warning, 1 error, 2 ok.');
  });
});

describe('renderProbeDetail', () => {
  it('renders multi-line detail for a connected probe', () => {
    const out = renderProbeDetail(probe({ daysUntilExpiry: 1 }));
    expect(out).toContain('Host:      example.com');
    expect(out).toContain('Issuer:    CN=Test CA');
    expect(out).toContain('Subject:   CN=example.com');
    expect(out).toContain('Valid:     2026-01-01 → 2026-07-01 (1 day remaining)');
    expect(out).toContain('Chain:     ok');
    expect(out).toContain('Hostname:  ok');
  });

  it('renders connection failure', () => {
    const out = renderProbeDetail(probe({ connected: false, error: 'refused' }));
    expect(out).toContain('Status:    connection failed');
    expect(out).toContain('Error:     refused');
  });
});

describe('sslMeasurements', () => {
  it('emits days_until_expiry and chain_valid per host', () => {
    expect(sslMeasurements([probe({ daysUntilExpiry: 42, chainValid: true })])).toEqual([
      { subject: 'example.com', metric: 'days_until_expiry', value: 42 },
      { subject: 'example.com', metric: 'chain_valid', value: 1 },
    ]);
  });

  it('encodes an invalid chain as 0', () => {
    const out = sslMeasurements([probe({ daysUntilExpiry: 5, chainValid: false })]);
    expect(out).toContainEqual({ subject: 'example.com', metric: 'chain_valid', value: 0 });
  });

  it('emits nothing for a host that could not be reached', () => {
    // No connection means no measurement — not a measurement of zero.
    expect(sslMeasurements([probe({ connected: false, error: 'refused' })])).toEqual([]);
  });

  it('omits days_until_expiry when the probe could not determine it', () => {
    const out = sslMeasurements([probe({ daysUntilExpiry: undefined, chainValid: true })]);
    expect(out.map((m) => m.metric)).toEqual(['chain_valid']);
  });

  it('covers every reachable host', () => {
    const out = sslMeasurements([
      probe({ host: 'a.example.com', daysUntilExpiry: 10, chainValid: true }),
      probe({ host: 'b.example.com', daysUntilExpiry: 20, chainValid: true }),
    ]);
    expect(out.map((m) => m.subject)).toEqual([
      'a.example.com',
      'a.example.com',
      'b.example.com',
      'b.example.com',
    ]);
  });
});
