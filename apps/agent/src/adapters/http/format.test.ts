import { describe, expect, it } from 'vitest';
import {
  classifyProbe,
  renderProbeDetail,
  renderProbeSummaryLine,
  httpMeasurements,
  renderSummaryFooter,
  summarize,
} from './format.js';
import type { HttpProbe } from './probe.js';

function probe(overrides: Partial<HttpProbe> = {}): HttpProbe {
  return {
    name: 'public',
    url: 'https://example.com',
    ok: true,
    status: 200,
    responseMs: 120,
    bodySize: 1024,
    ...overrides,
  };
}

describe('classifyProbe', () => {
  it('ok on 2xx', () => expect(classifyProbe(probe())).toBe('ok'));
  it('warn on 4xx', () => expect(classifyProbe(probe({ ok: false, status: 404 }))).toBe('warn'));
  it('critical on 5xx', () => expect(classifyProbe(probe({ ok: false, status: 503 }))).toBe('critical'));
  it('error on connection failure', () =>
    expect(
      classifyProbe(probe({ ok: false, status: undefined, error: 'ECONNREFUSED' })),
    ).toBe('error'));
});

describe('renderProbeSummaryLine', () => {
  it('formats an ok probe', () => {
    const line = renderProbeSummaryLine(probe());
    expect(line).toContain('public');
    expect(line).toContain('https://example.com');
    expect(line).toContain('HTTP 200');
    expect(line).toContain('120ms');
    expect(line).toContain('1024B');
  });

  it('prefixes 🔴 for 5xx', () => {
    const line = renderProbeSummaryLine(probe({ ok: false, status: 503 }));
    expect(line.startsWith('🔴')).toBe(true);
  });

  it('prefixes ⚠ for 4xx', () => {
    const line = renderProbeSummaryLine(probe({ ok: false, status: 404 }));
    expect(line.startsWith('⚠')).toBe(true);
  });

  it('shows connection failure when no status', () => {
    const line = renderProbeSummaryLine(
      probe({ ok: false, status: undefined, error: 'ETIMEDOUT' }),
    );
    expect(line).toContain('failed: ETIMEDOUT');
  });
});

describe('renderProbeDetail', () => {
  it('renders multi-line detail', () => {
    const out = renderProbeDetail(probe());
    expect(out).toContain('Name:       public');
    expect(out).toContain('URL:        https://example.com');
    expect(out).toContain('Status:     HTTP 200');
    expect(out).toContain('Time:       120ms');
    expect(out).toContain('Body size:  1024 bytes');
  });

  it('renders connection failure detail', () => {
    const out = renderProbeDetail(
      probe({ ok: false, status: undefined, error: 'ECONNREFUSED', bodySize: undefined }),
    );
    expect(out).toContain('Status:     connection failure');
    expect(out).toContain('Error:      ECONNREFUSED');
  });
});

describe('summarize + renderSummaryFooter', () => {
  it('counts each class', () => {
    const s = summarize([
      probe({ status: 200 }),
      probe({ ok: false, status: 404 }),
      probe({ ok: false, status: 503 }),
      probe({ ok: false, status: undefined, error: 'x' }),
      probe({ status: 204 }),
    ]);
    expect(s).toEqual({ total: 5, ok: 2, warn: 1, critical: 1, error: 1 });
    expect(renderSummaryFooter(s)).toBe(
      'Summary: 5 probed, 1 critical, 1 warning, 1 error, 2 ok.',
    );
  });
});

describe('httpMeasurements', () => {
  it('emits response_ms, status_code and body_bytes per endpoint', () => {
    expect(httpMeasurements([probe({ responseMs: 120, status: 200, bodySize: 1024 })])).toEqual([
      { subject: 'public', metric: 'response_ms', value: 120 },
      { subject: 'public', metric: 'status_code', value: 200 },
      { subject: 'public', metric: 'body_bytes', value: 1024 },
    ]);
  });

  it('emits measurements for an HTTP error response', () => {
    // A 500 that came back fast is still a real latency sample, and the
    // status code itself is exactly the trend worth recording.
    const out = httpMeasurements([probe({ ok: false, status: 500, responseMs: 80 })]);
    expect(out).toContainEqual({ subject: 'public', metric: 'status_code', value: 500 });
    expect(out).toContainEqual({ subject: 'public', metric: 'response_ms', value: 80 });
  });

  it('emits nothing for an endpoint that could not be reached', () => {
    const out = httpMeasurements([
      probe({ ok: false, status: undefined, responseMs: undefined, bodySize: undefined, error: 'ECONNREFUSED' }),
    ]);
    expect(out).toEqual([]);
  });

  it('omits individual metrics the probe did not capture', () => {
    const out = httpMeasurements([probe({ responseMs: 90, status: 204, bodySize: undefined })]);
    expect(out.map((m) => m.metric)).toEqual(['response_ms', 'status_code']);
  });

  it('covers every endpoint probed', () => {
    const out = httpMeasurements([
      probe({ name: 'a', responseMs: 10, status: 200, bodySize: 1 }),
      probe({ name: 'b', responseMs: 20, status: 200, bodySize: 2 }),
    ]);
    expect(new Set(out.map((m) => m.subject))).toEqual(new Set(['a', 'b']));
  });
});
