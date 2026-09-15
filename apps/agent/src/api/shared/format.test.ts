import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../../config/types.js';
import type { Finding } from '../../memory/types.js';
import { ageDays, findingToDto, findingToSummaryDto, shortFingerprint } from './format.js';

const GRAPH: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme', 'globex'] },
  ],
};
const KNOWN = ['acme', 'globex', 'initech', 'umbrella'];

function f(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    fingerprint: 'abcdef'.padEnd(64, '0'),
    resource_id: 'sql.acme.internal',
    issue_class: 'disk-pressure',
    state: 'ongoing',
    severity: 'critical',
    prev_severity: 'warn',
    title: 'Disk at 95%',
    evidence: 'evidence',
    likely_cause: 'cause',
    first_seen_at: '2026-04-30 09:00:00',
    last_seen_at: '2026-05-04 09:00:00',
    resolved_at: null,
    run_count: 5,
    first_run_id: 1,
    last_run_id: 5,
    ...overrides,
  };
}

describe('shortFingerprint', () => {
  it('returns first 6 hex of fingerprint', () => {
    expect(shortFingerprint('a'.repeat(64))).toBe('aaaaaa');
  });
});

describe('ageDays', () => {
  it('floors diff in days using sqlite-utc parsing', () => {
    expect(ageDays('2026-05-01 00:00:00', new Date('2026-05-04T12:00:00Z').getTime())).toBe(3);
  });

  it('clamps negative to 0 for future timestamps', () => {
    expect(ageDays('2027-01-01 00:00:00', new Date('2026-05-04T00:00:00Z').getTime())).toBe(0);
  });
});

describe('findingToDto', () => {
  it('computes escalating, muted, affects, age_days', () => {
    const dto = findingToDto(f(), {
      isMuted: true,
      graph: GRAPH,
      knownTenants: KNOWN,
      now: new Date('2026-05-04T09:00:00Z').getTime(),
    });
    expect(dto.short_id).toBe('abcdef');
    expect(dto.escalating).toBe(true);
    expect(dto.muted).toBe(true);
    expect(dto.affects).toEqual(['acme', 'globex']);
    expect(dto.age_days).toBe(4);
    expect(dto.evidence).toBe('evidence');
  });

  it('escalating=false for state=new', () => {
    const dto = findingToDto(f({ state: 'new' }), {
      isMuted: false,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(dto.escalating).toBe(false);
  });

  it('evidence is empty string when null in DB', () => {
    const dto = findingToDto(f({ evidence: null as unknown as string }), {
      isMuted: false,
      graph: GRAPH,
      knownTenants: KNOWN,
    });
    expect(dto.evidence).toBe('');
  });
});

describe('findingToSummaryDto', () => {
  it('omits evidence/likely_cause/run-ids', () => {
    const dto = findingToSummaryDto(f(), { isMuted: false, graph: GRAPH, knownTenants: KNOWN });
    expect('evidence' in dto).toBe(false);
    expect('likely_cause' in dto).toBe(false);
    expect('first_run_id' in dto).toBe(false);
  });
});
