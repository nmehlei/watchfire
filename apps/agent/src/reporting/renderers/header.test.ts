import { describe, expect, it } from 'vitest';
import type { SuppressedPagesWindow } from '../../memory/runs.js';
import type { Run } from '../../memory/types.js';
import {
  renderErrorHeader,
  renderSuppressedHeader,
  renderTruncatedHeader,
} from './header.js';

function baseRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    type: 'nightly',
    trigger: 'cron',
    started_at: '2026-04-20 02:30:00',
    completed_at: '2026-04-20 02:37:12',
    status: 'error',
    verdict: null,
    page_sent: null,
    finding_count: 0,
    turn_count: 5,
    tokens_in: 100,
    tokens_out: 50,
    tokens_cached: 80,
    cost_eur: 0.05,
    error: 'model timeout',
    transcript_path: '/var/lib/watchfire/transcripts/1.jsonl',
    ...overrides,
  };
}

describe('renderErrorHeader', () => {
  it('renders the standard ⚠️ header for generic errors', () => {
    const header = renderErrorHeader(baseRun());
    expect(header).toContain('<b>Last nightly terminated on error</b>');
    expect(header).toContain('model timeout');
    expect(header).toContain('<b>SKIPPED</b>');
  });

  it('renders the 🚨 SAFETY VIOLATION header when error starts with safety:', () => {
    const header = renderErrorHeader(
      baseRun({ error: 'safety: rm-recursive-or-force — rm -rf /tmp/bad' }),
    );
    expect(header.startsWith('🚨 <b>SAFETY VIOLATION</b>')).toBe(true);
    expect(header).toContain('<code>safety: rm-recursive-or-force');
    expect(header).toContain('<b>SKIPPED</b>');
  });

  it('truncates safety reasons over 200 chars with ellipsis', () => {
    const long = 'safety: custom: ' + 'x'.repeat(500);
    const header = renderErrorHeader(baseRun({ error: long }));
    const reasonLine = header.split('\n').find((l) => l.startsWith('Reason:'))!;
    // Within <code>..</code>, the inner text is at most 200 chars and ends with '...'.
    const inner = reasonLine.replace(/^Reason: <code>(.*)<\/code>$/, '$1');
    expect(inner.length).toBeLessThanOrEqual(200);
    expect(inner.endsWith('...')).toBe(true);
  });

  it('escapes HTML in error reason', () => {
    const header = renderErrorHeader(baseRun({ error: 'crash <bad> & burn' }));
    expect(header).toContain('crash &lt;bad&gt; &amp; burn');
  });

  it('handles null error gracefully', () => {
    const header = renderErrorHeader(baseRun({ error: null }));
    expect(header).toContain('unknown');
  });
});

describe('renderTruncatedHeader', () => {
  it('mentions budget exhaustion and that sweep still ran', () => {
    const header = renderTruncatedHeader();
    expect(header).toContain('⚠️');
    expect(header).toContain('<b>Nightly hit its 20-turn budget</b>');
    expect(header).toContain('Resolution sweep ran');
  });
});

describe('renderSuppressedHeader', () => {
  it('returns empty string when count is zero', () => {
    const w: SuppressedPagesWindow = { count: 0, windowStart: null, windowEnd: null };
    expect(renderSuppressedHeader(w)).toBe('');
  });

  it('renders count + time window', () => {
    const w: SuppressedPagesWindow = {
      count: 4,
      windowStart: '2026-04-20 14:02:33',
      windowEnd: '2026-04-20 18:37:11',
    };
    const header = renderSuppressedHeader(w);
    expect(header).toContain('<b>4 pages were suppressed</b>');
    expect(header).toContain('between 14:02 and 18:37');
    expect(header).toContain('6/h');
  });

  it('singular form for count=1', () => {
    const w: SuppressedPagesWindow = {
      count: 1,
      windowStart: '2026-04-20 14:02:33',
      windowEnd: '2026-04-20 14:02:33',
    };
    const header = renderSuppressedHeader(w);
    expect(header).toContain('<b>1 page was suppressed</b>');
  });
});
