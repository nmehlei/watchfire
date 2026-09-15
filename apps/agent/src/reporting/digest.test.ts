import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../config/types.js';
import type { SuppressedPagesWindow } from '../memory/runs.js';
import type { Finding, Run } from '../memory/types.js';
import { composeDigest } from './digest.js';

const GRAPH: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme', 'globex', 'initech'] },
  ],
};
const KNOWN = ['acme', 'globex', 'initech', 'umbrella'];

function baseRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    type: 'nightly',
    trigger: 'cron',
    started_at: '2026-04-20 02:30:00',
    completed_at: '2026-04-20 02:37:00',
    status: 'success',
    verdict: null,
    page_sent: null,
    finding_count: 0,
    turn_count: 14,
    tokens_in: 10000,
    tokens_out: 2000,
    tokens_cached: 8800,
    cost_eur: 0.11,
    error: null,
    transcript_path: '/var/lib/watchfire/transcripts/1.jsonl',
    ...overrides,
  };
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 1,
    fingerprint: 'fp'.padEnd(64, 'f'),
    resource_id: 'sql.acme.internal',
    issue_class: 'disk-pressure',
    state: 'new',
    severity: 'warn',
    prev_severity: null,
    title: 'Disk at 85%',
    evidence: 'evidence here',
    likely_cause: 'because',
    first_seen_at: '2026-04-20 02:30:00',
    last_seen_at: '2026-04-20 02:30:00',
    resolved_at: null,
    run_count: 1,
    first_run_id: 1,
    last_run_id: 1,
    ...overrides,
  };
}

const EMPTY_SUPPRESSED: SuppressedPagesWindow = { count: 0, windowStart: null, windowEnd: null };

describe('composeDigest', () => {
  it('empty nightly → "All quiet" + Run footer heartbeat', () => {
    const out = composeDigest({
      run: baseRun(),
      findings: [],
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('🌙 <b>Nightly digest</b>');
    expect(out).toContain('All quiet — nothing to report.');
    expect(out).toContain('━ Run ━');
    expect(out).toContain('0 findings');
    expect(out).toContain('14 turns');
    expect(out).toContain('€0.11');
    // tokens_in=10000 (uncached), tokens_cached=8800; cache hit rate is
    // 8800 / (10000 + 8800) = 46.8% → 47%.
    expect(out).toContain('cache 47%');
  });

  it('buckets findings across New / Escalating / Ongoing / Cleared', () => {
    const findings: Finding[] = [
      finding({ id: 1, state: 'new', severity: 'critical', title: 'new critical', resource_id: 'r1' }),
      finding({
        id: 2,
        state: 'ongoing',
        severity: 'critical',
        prev_severity: 'warn',
        title: 'escalating',
        resource_id: 'r2',
      }),
      finding({
        id: 3,
        state: 'ongoing',
        severity: 'warn',
        prev_severity: 'warn',
        title: 'steady ongoing',
        resource_id: 'r3',
        run_count: 4,
      }),
      finding({
        id: 4,
        state: 'resolved',
        severity: 'warn',
        title: 'resolved thing',
        resource_id: 'r4',
        resolved_at: '2026-04-18 02:30:00',
      }),
    ];
    const out = composeDigest({
      run: baseRun(),
      findings,
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('━ New ━ (1)');
    expect(out).toContain('━ Escalating ━ (1)');
    expect(out).toContain('━ Ongoing ━ (1)');
    expect(out).toContain('━ Cleared (last 7 days) ━ (1)');
  });

  it('sends a compact alert instead of the full digest for a hard error', () => {
    const out = composeDigest({
      run: baseRun({ status: 'error', error: 'model timeout' }),
      findings: [],
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('🔴 <b>NIGHTLY FAILED</b>');
    expect(out).toContain('<code>model timeout</code>');
    expect(out).toContain('No findings were open as of the last successful check.');
    // No repeated stale digest body/footer on a hard error.
    expect(out).not.toContain('🌙 <b>Nightly digest</b>');
    expect(out).not.toContain('━ Run ━');
  });

  it('hard-error alert surfaces the count of stale open findings without listing them', () => {
    const out = composeDigest({
      run: baseRun({ status: 'error', error: 'Credit balance is too low' }),
      findings: [
        finding({ id: 1, state: 'new', severity: 'critical', title: 'new critical', resource_id: 'r1' }),
        finding({ id: 2, state: 'ongoing', severity: 'warn', title: 'steady ongoing', resource_id: 'r3' }),
      ],
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('🔴 <b>NIGHTLY FAILED</b>');
    expect(out).toContain('2 findings were still open as of the last successful check');
    expect(out).not.toContain('new critical');
    expect(out).not.toContain('steady ongoing');
  });

  it('upgrades to SAFETY VIOLATION for safety: errors', () => {
    const out = composeDigest({
      run: baseRun({ status: 'error', error: 'safety: rm-recursive-or-force — rm -rf /' }),
      findings: [],
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('🚨 <b>SAFETY VIOLATION</b>');
  });

  it('prepends truncated header when status=truncated', () => {
    const out = composeDigest({
      run: baseRun({ status: 'truncated' }),
      findings: [],
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('<b>Nightly hit its 20-turn budget</b>');
  });

  it('prepends suppressed-pages header when count>0', () => {
    const out = composeDigest({
      run: baseRun(),
      findings: [],
      suppressedPages: {
        count: 3,
        windowStart: '2026-04-20 14:02:00',
        windowEnd: '2026-04-20 18:10:00',
      },
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).toContain('<b>3 pages were suppressed</b> between 14:02 and 18:10');
  });

  it('filters muted findings out of all sections and reports the count in the Run footer', () => {
    const findings: Finding[] = [
      finding({ id: 1, fingerprint: 'a'.repeat(64), state: 'new', title: 'visible-new' }),
      finding({ id: 2, fingerprint: 'b'.repeat(64), state: 'new', title: 'muted-new' }),
      finding({
        id: 3,
        fingerprint: 'c'.repeat(64),
        state: 'ongoing',
        prev_severity: 'warn',
        run_count: 3,
        title: 'muted-ongoing',
      }),
    ];
    const out = composeDigest({
      run: baseRun(),
      findings,
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
      mutedFingerprints: new Set(['b'.repeat(64), 'c'.repeat(64)]),
    });
    expect(out).toContain('visible-new');
    expect(out).not.toContain('muted-new');
    expect(out).not.toContain('muted-ongoing');
    expect(out).toContain('🤫 2 muted findings hidden');
  });

  it('omits the muted footer line when no mutes are active', () => {
    const out = composeDigest({
      run: baseRun(),
      findings: [],
      suppressedPages: EMPTY_SUPPRESSED,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).not.toContain('🤫');
  });

  it('headers stack in order Error → Truncated (never both actually) → Suppressed', () => {
    const out = composeDigest({
      run: baseRun({ status: 'truncated' }),
      findings: [],
      suppressedPages: {
        count: 1,
        windowStart: '2026-04-20 14:02:00',
        windowEnd: '2026-04-20 14:02:00',
      },
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    const truncIdx = out.indexOf('20-turn');
    const suppIdx = out.indexOf('suppressed');
    expect(truncIdx).toBeGreaterThan(-1);
    expect(suppIdx).toBeGreaterThan(truncIdx);
  });
});
