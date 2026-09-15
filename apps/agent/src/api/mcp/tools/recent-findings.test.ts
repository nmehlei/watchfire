import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../../../config/types.js';
import { fingerprint } from '../../../memory/fingerprint.js';
import { openMemoryDb, type Db } from '../../../memory/schema.js';
import { handleRecentFindings } from './recent-findings.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function seed(): Db {
  const db = openMemoryDb();
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 't', 'e', NULL,
             datetime('now'), datetime('now'), 1, 0, 0)`,
  ).run(fingerprint('r1', 'disk-pressure'));
  return db;
}

describe('handleRecentFindings', () => {
  it('returns ok with summary list and total', () => {
    const out = handleRecentFindings(
      { db: seed(), graph: GRAPH, knownTenants: ['acme'] },
      { limit: 20, include_resolved: false, include_muted: false },
    );
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.body.findings.length).toBe(1);
      expect(out.body.total).toBe(1);
      expect(out.body.limit).toBe(20);
    }
  });

  it('rejects out-of-range limit', () => {
    const out = handleRecentFindings(
      { db: seed(), graph: GRAPH, knownTenants: ['acme'] },
      { limit: 200, include_resolved: false, include_muted: false },
    );
    expect(out.kind).toBe('invalid_argument');
  });

  it('uses default limit when omitted', () => {
    const out = handleRecentFindings(
      { db: seed(), graph: GRAPH, knownTenants: ['acme'] },
      {},
    );
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.body.limit).toBe(20);
  });
});
