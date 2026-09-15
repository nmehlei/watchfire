import { describe, expect, it } from 'vitest';
import { renderSearchResult, renderStreams } from './format.js';
import type { SearchHit, StreamInfo } from './openobserve.js';

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    timestamp: '2026-04-22T02:30:00.000Z',
    level: 'error',
    service: 'api',
    message: 'connection reset by peer',
    raw: {},
    ...overrides,
  };
}

describe('renderSearchResult', () => {
  it('renders a header and log lines', () => {
    const out = renderSearchResult(
      { hits: [hit(), hit({ level: 'warn' })], total: 2, tookMs: 42 },
      'acme',
      'acme',
    );
    expect(out).toContain('tenant=acme stream=acme hits=2 total=2 took=42ms');
    expect(out).toContain('[error]');
    expect(out).toContain('[warn]');
    expect(out).toContain('api');
    expect(out).toContain('connection reset by peer');
  });

  it('says "(no hits)" when empty', () => {
    const out = renderSearchResult({ hits: [], total: 0, tookMs: 5 }, 'acme', 'acme');
    expect(out).toContain('(no hits)');
  });

  it('truncates long messages', () => {
    const long = 'x'.repeat(400);
    const out = renderSearchResult({ hits: [hit({ message: long })], total: 1, tookMs: 1 }, 't', 's');
    const bodyLine = out.split('\n').find((l) => l.includes('xxxxx'))!;
    expect(bodyLine.endsWith('…')).toBe(true);
  });

  it('collapses whitespace in messages', () => {
    const out = renderSearchResult(
      { hits: [hit({ message: 'line1\n  line2\nline3' })], total: 1, tookMs: 1 },
      't',
      's',
    );
    expect(out).toContain('line1 line2 line3');
  });
});

describe('renderStreams', () => {
  it('lists names + optional type/storage', () => {
    const streams: StreamInfo[] = [
      { name: 'acme', type: 'logs', storageType: 'disk' },
      { name: 'initech', type: 'logs', storageType: undefined },
      { name: 'metrics-only', type: undefined, storageType: undefined },
    ];
    const out = renderStreams('acme', streams);
    expect(out).toContain('tenant=acme streams=3');
    expect(out).toContain('  acme [logs] storage=disk');
    expect(out).toContain('  initech [logs]');
    expect(out).toContain('  metrics-only');
    expect(out).not.toContain('  metrics-only [');
  });

  it('says "(none)" when empty', () => {
    expect(renderStreams('acme', [])).toContain('(none)');
  });
});
