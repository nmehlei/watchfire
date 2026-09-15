import { describe, expect, it } from 'vitest';
import {
  listStreams,
  parseDuration,
  searchLogs,
  type HttpFetch,
  type HttpResponse,
} from './openobserve.js';

function resp(status: number, body: string): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  };
}

describe('parseDuration', () => {
  it.each([
    ['1s', 1_000],
    ['30m', 30 * 60 * 1000],
    ['2h', 2 * 60 * 60 * 1000],
    ['7d', 7 * 86_400_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('rejects malformed input', () => {
    expect(() => parseDuration('abc')).toThrow(/invalid duration/);
    expect(() => parseDuration('1y')).toThrow();
  });
});

describe('searchLogs', () => {
  it('builds a POST with basic auth + SQL body, parses hits', async () => {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const fetchMock: HttpFetch = async (url, init) => {
      calls.push({ url, init: init as Record<string, unknown> });
      return resp(
        200,
        JSON.stringify({
          hits: [
            {
              _timestamp: 1_700_000_000_000_000,
              level: 'error',
              service: 'api',
              message: 'boom',
            },
          ],
          total: 1,
          took: 15,
        }),
      );
    };
    const result = await searchLogs(
      { url: 'https://oo.example.com/', user: 'u', password: 'p', fetch: fetchMock },
      { stream: 'acme', match: 'error', sinceMs: 60 * 60 * 1000, limit: 10 },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://oo.example.com/api/default/_search');
    const init = calls[0]!.init as { method: string; headers: Record<string, string>; body: string };
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toMatch(/^Basic /);
    const body = JSON.parse(init.body) as { query: { sql: string; size: number; start_time: number; end_time: number } };
    expect(body.query.size).toBe(10);
    expect(body.query.sql).toContain('SELECT * FROM "acme"');
    expect(body.query.sql).toContain("match_all('error')");
    expect(body.query.end_time).toBeGreaterThan(body.query.start_time);

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.level).toBe('error');
    expect(result.hits[0]!.service).toBe('api');
    expect(result.hits[0]!.message).toBe('boom');
    expect(result.total).toBe(1);
    expect(result.tookMs).toBe(15);
  });

  it('overrides match with --sql when given', async () => {
    let capturedSql = '';
    const fetchMock: HttpFetch = async (_url, init) => {
      capturedSql = (JSON.parse(init.body ?? '{}') as { query: { sql: string } }).query.sql;
      return resp(200, JSON.stringify({ hits: [], total: 0 }));
    };
    await searchLogs(
      { url: 'https://x', user: 'u', password: 'p', fetch: fetchMock },
      { stream: 's', sql: 'SELECT foo FROM "s" WHERE x = 1', sinceMs: 60_000, limit: 10 },
    );
    expect(capturedSql).toBe('SELECT foo FROM "s" WHERE x = 1');
  });

  it('escapes single quotes in match term', async () => {
    let capturedSql = '';
    const fetchMock: HttpFetch = async (_url, init) => {
      capturedSql = (JSON.parse(init.body ?? '{}') as { query: { sql: string } }).query.sql;
      return resp(200, JSON.stringify({ hits: [] }));
    };
    await searchLogs(
      { url: 'https://x', user: 'u', password: 'p', fetch: fetchMock },
      { stream: 's', match: "it's broken", sinceMs: 60_000, limit: 10 },
    );
    expect(capturedSql).toContain("'it''s broken'");
  });

  it('raises on non-2xx', async () => {
    const fetchMock: HttpFetch = async () => resp(401, 'unauthorized');
    await expect(
      searchLogs(
        { url: 'https://x', user: 'u', password: 'bad', fetch: fetchMock },
        { stream: 's', sinceMs: 60_000, limit: 10 },
      ),
    ).rejects.toThrow(/401/);
  });

  it('falls back to empty hits on unexpected shape', async () => {
    const fetchMock: HttpFetch = async () => resp(200, 'not even close to JSON');
    const result = await searchLogs(
      { url: 'https://x', user: 'u', password: 'p', fetch: fetchMock },
      { stream: 's', sinceMs: 60_000, limit: 10 },
    );
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('handles OpenSearch-nested hits.hits form', async () => {
    const fetchMock: HttpFetch = async () =>
      resp(
        200,
        JSON.stringify({
          hits: { hits: [{ _timestamp: 1_700_000_000_000_000, message: 'nested' }], total: { value: 1 } },
        }),
      );
    const result = await searchLogs(
      { url: 'https://x', user: 'u', password: 'p', fetch: fetchMock },
      { stream: 's', sinceMs: 60_000, limit: 10 },
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.message).toBe('nested');
  });

  it('respects custom org', async () => {
    let seenUrl = '';
    const fetchMock: HttpFetch = async (url) => {
      seenUrl = url;
      return resp(200, JSON.stringify({ hits: [] }));
    };
    await searchLogs(
      { url: 'https://x', user: 'u', password: 'p', org: 'acme', fetch: fetchMock },
      { stream: 's', sinceMs: 60_000, limit: 10 },
    );
    expect(seenUrl).toContain('/api/acme/_search');
  });
});

describe('listStreams', () => {
  it('GET /api/{org}/streams, parses list', async () => {
    const fetchMock: HttpFetch = async (url) => {
      expect(url).toMatch(/\/api\/default\/streams$/);
      return resp(
        200,
        JSON.stringify({
          list: [
            { name: 'acme', stream_type: 'logs', storage_type: 'disk' },
            { name: 'initech', stream_type: 'logs' },
          ],
        }),
      );
    };
    const streams = await listStreams({
      url: 'https://oo/',
      user: 'u',
      password: 'p',
      fetch: fetchMock,
    });
    expect(streams).toHaveLength(2);
    expect(streams[0]).toEqual({ name: 'acme', type: 'logs', storageType: 'disk' });
    expect(streams[1]!.storageType).toBeUndefined();
  });

  it('tolerates bare-array response shape', async () => {
    const fetchMock: HttpFetch = async () =>
      resp(200, JSON.stringify([{ name: 'a' }, { name: 'b' }]));
    const streams = await listStreams({
      url: 'https://x',
      user: 'u',
      password: 'p',
      fetch: fetchMock,
    });
    expect(streams.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('raises on error', async () => {
    const fetchMock: HttpFetch = async () => resp(403, 'forbidden');
    await expect(
      listStreams({ url: 'https://x', user: 'u', password: 'p', fetch: fetchMock }),
    ).rejects.toThrow(/403/);
  });
});
