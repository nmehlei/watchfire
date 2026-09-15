// OpenObserve live integration tests. Gated off by default.
// Runs when OPENOBSERVE_URL + USER + PASSWORD are set AND
// IRIS_RUN_OO_INTEGRATION=1.

import { describe, expect, it } from 'vitest';
import { listStreams, parseDuration, searchLogs } from './openobserve.js';

try {
  process.loadEnvFile?.();
} catch {
  // no .env
}

const shouldRun =
  process.env['IRIS_RUN_OO_INTEGRATION'] === '1' &&
  !!process.env['OPENOBSERVE_URL'] &&
  !!process.env['OPENOBSERVE_USER'] &&
  !!process.env['OPENOBSERVE_PASSWORD'];

const cfg = shouldRun
  ? {
      url: process.env['OPENOBSERVE_URL']!,
      user: process.env['OPENOBSERVE_USER']!,
      password: process.env['OPENOBSERVE_PASSWORD']!,
      ...(process.env['OPENOBSERVE_ORG'] ? { org: process.env['OPENOBSERVE_ORG']! } : {}),
    }
  : { url: '', user: '', password: '' };

describe.skipIf(!shouldRun)('OpenObserve — live', () => {
  it('listStreams returns at least one stream', async () => {
    const streams = await listStreams(cfg);
    expect(streams.length).toBeGreaterThan(0);
  }, 30_000);

  it(
    'searchLogs returns hits for a broad 24h window on the "acme" stream',
    async () => {
      const result = await searchLogs(cfg, {
        stream: 'acme',
        sinceMs: parseDuration('24h'),
        limit: 5,
      });
      // We can't assert on content — tenants differ. But the query must succeed.
      expect(result.tookMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.hits)).toBe(true);
    },
    30_000,
  );
});
