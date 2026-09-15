import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../config/types.js';
import type { Finding, Run } from '../memory/types.js';
import { composePage } from './page.js';

const GRAPH: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme', 'globex', 'initech'] },
  ],
};
const KNOWN = ['acme', 'globex', 'initech', 'umbrella'];

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    type: 'watch',
    trigger: 'webhook',
    started_at: '2026-04-20 14:02:00',
    completed_at: '2026-04-20 14:02:45',
    status: 'success',
    verdict: 'page',
    page_sent: 1,
    finding_count: 1,
    turn_count: 6,
    tokens_in: 1000,
    tokens_out: 200,
    tokens_cached: 800,
    cost_eur: 0.015,
    error: null,
    transcript_path: '/var/lib/iris/transcripts/2.jsonl',
    ...overrides,
  };
}

function finding(id: number, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    fingerprint: `fp-${id}`.padEnd(64, 'f'),
    resource_id: 'sql.acme.internal',
    issue_class: 'disk-pressure',
    state: 'new',
    severity: 'critical',
    prev_severity: null,
    title: `Finding #${id}`,
    evidence: 'evidence',
    likely_cause: 'cause',
    first_seen_at: '2026-04-20 14:02:00',
    last_seen_at: '2026-04-20 14:02:00',
    resolved_at: null,
    run_count: 1,
    first_run_id: 1,
    last_run_id: 1,
    ...overrides,
  };
}

describe('composePage', () => {
  it('returns null when there are no findings', () => {
    expect(
      composePage({
        run: run(),
        findings: [],
        alertSummary: 'OO alert "disk-high"',
        graph: GRAPH,
        knownTenants: KNOWN,
        nextNightlyHHMM: '02:30',
      }),
    ).toBeNull();
  });

  it('renders a single-finding page with all lines', () => {
    const out = composePage({
      run: run(),
      findings: [finding(1, { title: 'Disk at 98%', severity: 'critical' })],
      alertSummary: 'OpenObserve "disk-high" — /data at 98%',
      graph: GRAPH,
      knownTenants: KNOWN,
      nextNightlyHHMM: '02:30',
      verdictReason: 'Crossed critical threshold; likely needs an eyeball tonight.',
    })!;
    expect(out).toContain('🚨 [acme, globex, initech] <b>Disk at 98%</b>');
    expect(out).toContain('<code>sql.acme.internal</code>');
    expect(out).toContain('Severity: 🔴 <b>critical</b>');
    expect(out).toContain('Triggered by: OpenObserve "disk-high" — /data at 98%');
    expect(out).toContain('<blockquote>evidence</blockquote>');
    expect(out).toContain('<i>cause</i>');
    expect(out).toContain('Reason: Crossed critical threshold');
    expect(out).toContain('→ Next nightly: <code>02:30</code>');
  });

  it('picks the highest-severity finding as primary', () => {
    const out = composePage({
      run: run(),
      findings: [
        finding(1, { title: 'warn-thing', severity: 'warn', resource_id: 'a' }),
        finding(2, { title: 'critical-thing', severity: 'critical', resource_id: 'b' }),
      ],
      alertSummary: 'alert',
      graph: GRAPH,
      knownTenants: KNOWN,
      nextNightlyHHMM: '02:30',
    })!;
    const firstLine = out.split('\n')[0]!;
    expect(firstLine).toContain('critical-thing');
  });

  it('appends extras under "Also seen"', () => {
    const out = composePage({
      run: run(),
      findings: [
        finding(1, { title: 'primary', severity: 'critical', resource_id: 'a' }),
        finding(2, { title: 'extra one', severity: 'warn', resource_id: 'b' }),
        finding(3, { title: 'extra two', severity: 'warn', resource_id: 'c' }),
      ],
      alertSummary: 'alert',
      graph: GRAPH,
      knownTenants: KNOWN,
      nextNightlyHHMM: '02:30',
    })!;
    expect(out).toContain('Also seen:');
    expect(out).toContain('<b>extra one</b>');
    expect(out).toContain('<code>b</code>');
    expect(out).toContain('<b>extra two</b>');
    expect(out).toContain('<code>c</code>');
  });
});
