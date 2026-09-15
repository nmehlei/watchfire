import { describe, expect, it } from 'vitest';
import {
  probeHttp,
  type HttpProbeFetch,
  type HttpProbeResponse,
} from './probe.js';

function makeResponse(status: number, body: string): HttpProbeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  };
}

describe('probeHttp — with injected fetch', () => {
  it('reports status, body size, response time on 200', async () => {
    const fetchMock: HttpProbeFetch = async () => makeResponse(200, 'hello');
    const result = await probeHttp('public', 'https://example.com', { fetch: fetchMock });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.bodySize).toBe(5);
    expect(result.responseMs).toBeGreaterThanOrEqual(0);
  });

  it('reports 404 as ok=false with status=404', async () => {
    const fetchMock: HttpProbeFetch = async () => makeResponse(404, 'Not Found');
    const result = await probeHttp('public', 'https://example.com', { fetch: fetchMock });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('reports connection failure without status when fetch throws', async () => {
    const fetchMock: HttpProbeFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await probeHttp('public', 'https://example.com', { fetch: fetchMock });
    expect(result.ok).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.error).toBe('ECONNREFUSED');
  });
});

// Optional network integration — skipped if offline.
const runNetworkTests = !process.env['IRIS_SKIP_NETWORK_TESTS'];

describe.skipIf(!runNetworkTests)('probeHttp — integration', () => {
  it('hits example.com and gets HTTP 200', async () => {
    const result = await probeHttp('public', 'https://example.com', { timeoutMs: 8000 });
    if (!result.ok && result.status === undefined) {
      console.warn('skipping http integration: network unavailable');
      return;
    }
    expect(result.status).toBeGreaterThanOrEqual(200);
    expect(result.status).toBeLessThan(400);
    expect(typeof result.responseMs).toBe('number');
    expect(typeof result.bodySize).toBe('number');
  }, 15000);
});
