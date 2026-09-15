import { describe, expect, it } from 'vitest';
import { parseOpenObservePayload, summarizeAlert } from './openobserve.js';

describe('parseOpenObservePayload', () => {
  it('accepts a minimal alert payload', () => {
    const body = JSON.stringify({
      alert_name: 'disk-high',
      stream: 'acme',
      severity: 'critical',
      fired_at: '2026-04-22T02:14:07Z',
    });
    const r = parseOpenObservePayload(body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.alert.alert_name).toBe('disk-high');
      expect(r.parsed.alert.labels).toEqual({});
    }
  });

  it('accepts a richer payload and preserves labels + evaluation', () => {
    const body = JSON.stringify({
      alert_name: 'api-5xx',
      stream: 'initech',
      severity: 'warn',
      fired_at: '2026-04-22T02:15:00Z',
      description: '5xx rate above threshold',
      labels: { service: 'api', env: 'prod' },
      evaluation: { query: 'rate(5xx)', value: 4.2, threshold: 1.0 },
    });
    const r = parseOpenObservePayload(body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.alert.labels['service']).toBe('api');
      expect(r.parsed.alert.evaluation?.value).toBe(4.2);
    }
  });

  it('rejects malformed JSON', () => {
    const r = parseOpenObservePayload('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid JSON/);
  });

  it('rejects when required field is missing', () => {
    const body = JSON.stringify({ stream: 'acme', severity: 'warn', fired_at: '...' });
    const r = parseOpenObservePayload(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/schema mismatch/);
  });
});

describe('summarizeAlert', () => {
  it('just alert_name when minimal', () => {
    const summary = summarizeAlert({
      alert_name: 'x',
      stream: 's',
      severity: 'warn',
      fired_at: '2026-04-22',
      description: '',
      labels: {},
    });
    expect(summary).toBe('x');
  });

  it('includes description + evaluation when present', () => {
    const summary = summarizeAlert({
      alert_name: 'disk-high',
      stream: 'acme',
      severity: 'critical',
      fired_at: '...',
      description: '/data at 98%',
      labels: {},
      evaluation: { value: 98, threshold: 90 },
    });
    expect(summary).toBe('disk-high — /data at 98% — (value=98 threshold=90)');
  });
});
