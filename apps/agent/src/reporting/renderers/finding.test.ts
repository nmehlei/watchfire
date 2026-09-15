import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../../config/types.js';
import type { Finding } from '../../memory/types.js';
import { renderFinding } from './finding.js';

const GRAPH: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme', 'globex', 'initech'] },
  ],
};

const KNOWN = ['acme', 'globex', 'initech', 'umbrella'];

function baseFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    fingerprint: '9b9896' + 'f'.repeat(58),
    resource_id: 'sql.acme.internal',
    issue_class: 'disk-pressure',
    state: 'new',
    severity: 'critical',
    prev_severity: null,
    title: 'Disk at 94% on sql.acme.internal',
    evidence: '/data at 94% used (was 88% last night). Growth ~0.3%/h.',
    likely_cause: 'globex audit-log rotation disabled since deploy on 04-18.',
    first_seen_at: '2026-04-20 02:30:00',
    last_seen_at: '2026-04-20 02:30:00',
    resolved_at: null,
    run_count: 1,
    first_run_id: 1,
    last_run_id: 1,
    ...overrides,
  };
}

describe('renderFinding — new, full', () => {
  it('renders header, short id, resource, evidence, likely_cause as HTML', () => {
    const out = renderFinding(baseFinding(), 'full', { graph: GRAPH, knownTenants: KNOWN });
    expect(out).toContain('🆕 🔴 [acme, globex, initech] <b>Disk at 94% on sql.acme.internal</b>');
    expect(out).toContain('<code>9b9896</code> · <code>sql.acme.internal</code>');
    expect(out).toContain('<blockquote>/data at 94% used (was 88% last night). Growth ~0.3%/h.</blockquote>');
    expect(out).toContain('<i>globex audit-log rotation disabled since deploy on 04-18.</i>');
  });

  it('omits likely_cause line when null', () => {
    const out = renderFinding(baseFinding({ likely_cause: null }), 'full', {
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(out).not.toContain('<i>');
  });

  it('escapes <, >, & in title and evidence', () => {
    const out = renderFinding(
      baseFinding({
        title: 'Saw <script>alert(1)</script> & friends',
        evidence: 'a < b > c & d',
      }),
      'full',
      { graph: GRAPH, knownTenants: KNOWN },
    );
    expect(out).toContain('<b>Saw &lt;script&gt;alert(1)&lt;/script&gt; &amp; friends</b>');
    expect(out).toContain('<blockquote>a &lt; b &gt; c &amp; d</blockquote>');
    expect(out).not.toContain('<script>');
  });
});

describe('renderFinding — escalating', () => {
  it('adds severity delta footer + age on the resource line', () => {
    const now = Date.parse('2026-04-23T02:30:00Z');
    const out = renderFinding(
      baseFinding({
        state: 'ongoing',
        severity: 'critical',
        prev_severity: 'warn',
        first_seen_at: '2026-04-20 02:30:00',
      }),
      'full',
      { graph: GRAPH, knownTenants: KNOWN, now },
    );
    expect(out).toMatch(/⚠️/);
    expect(out).toContain('severity 🟡 warn → 🔴 critical');
    expect(out).toContain('age <code>3d</code>');
  });
});

describe('renderFinding — ongoing, condensed', () => {
  it('renders single-line evidence and run_count + age footer', () => {
    const now = Date.parse('2026-04-28T02:30:00Z');
    const out = renderFinding(
      baseFinding({
        state: 'ongoing',
        severity: 'warn',
        prev_severity: 'warn',
        first_seen_at: '2026-04-20 02:30:00',
        run_count: 8,
        evidence: 'multi\n line\n evidence',
      }),
      'condensed',
      { graph: GRAPH, knownTenants: KNOWN, now },
    );
    expect(out).toContain('🔁 🟡');
    expect(out).toContain('<blockquote>multi line evidence</blockquote>');
    expect(out).toContain('<code>8</code> nights in a row · age <code>8d</code>');
  });

  it('escapes the <1h age literal so Telegram HTML parses cleanly', () => {
    const now = Date.parse('2026-04-20T03:00:00Z');
    const out = renderFinding(
      baseFinding({
        state: 'ongoing',
        run_count: 1,
        first_seen_at: '2026-04-20 02:30:00',
      }),
      'condensed',
      { graph: GRAPH, knownTenants: KNOWN, now },
    );
    expect(out).toContain('age <code>&lt;1h</code>');
    expect(out).not.toContain('<code><1h</code>');
  });

  it('singularizes "night" when run_count=1', () => {
    const now = Date.parse('2026-04-21T02:30:00Z');
    const out = renderFinding(
      baseFinding({
        state: 'ongoing',
        run_count: 1,
        first_seen_at: '2026-04-20 02:30:00',
      }),
      'condensed',
      { graph: GRAPH, knownTenants: KNOWN, now },
    );
    expect(out).toContain('<code>1</code> night in a row');
  });

  it('omits likely_cause in condensed mode', () => {
    const now = Date.parse('2026-04-21T02:30:00Z');
    const out = renderFinding(
      baseFinding({
        state: 'ongoing',
        run_count: 2,
        first_seen_at: '2026-04-20 02:30:00',
        likely_cause: 'should not appear',
      }),
      'condensed',
      { graph: GRAPH, knownTenants: KNOWN, now },
    );
    expect(out).not.toContain('should not appear');
  });
});

describe('renderFinding — resolved', () => {
  it('renders one-liner with cleared date', () => {
    const out = renderFinding(
      baseFinding({
        state: 'resolved',
        resolved_at: '2026-04-18 02:31:00',
      }),
      'full',
      { graph: GRAPH, knownTenants: KNOWN },
    );
    expect(out).toBe(
      '✅ [acme, globex, initech] <b>Disk at 94% on sql.acme.internal</b> — cleared 2026-04-18',
    );
  });

  it('resolved-oneliner mode', () => {
    const out = renderFinding(
      baseFinding({ state: 'resolved', resolved_at: '2026-04-18 00:00:00' }),
      'resolved-oneliner',
      { graph: GRAPH, knownTenants: KNOWN },
    );
    expect(out.startsWith('✅')).toBe(true);
    expect(out).toContain('<b>');
  });
});

describe('renderFinding — affects fallbacks', () => {
  it('uses heuristic owner derivation for unlisted resources', () => {
    const out = renderFinding(
      baseFinding({ resource_id: 'api.globex.app' }),
      'full',
      { graph: GRAPH, knownTenants: KNOWN },
    );
    expect(out).toContain('[globex]');
  });

  it('uses [?] when everything fails', () => {
    const out = renderFinding(
      baseFinding({ resource_id: 'totally.unknown.resource' }),
      'full',
      { graph: GRAPH },
    );
    expect(out).toContain('[?]');
  });
});
