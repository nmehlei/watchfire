import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../../../config/types.js';
import { fingerprint } from '../../../memory/fingerprint.js';
import { openMemoryDb, type Db } from '../../../memory/schema.js';
import { handleGetFinding } from './get-finding.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

function seed(): Db {
  const db = openMemoryDb();
  const fp = fingerprint('r1', 'disk-pressure');
  db.prepare(
    `INSERT INTO findings
       (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
        first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
     VALUES (?, 'r1', 'disk-pressure', 'new', 'critical', 'Disk full', 'ev', NULL,
             '2026-05-01 00:00:00', '2026-05-04 00:00:00', 3, 1, 5)`,
  ).run(fp);
  return db;
}

describe('handleGetFinding', () => {
  it('returns ok with full DTO on unique match', () => {
    const db = seed();
    const fp = fingerprint('r1', 'disk-pressure');
    const out = handleGetFinding(
      { db, graph: GRAPH, knownTenants: ['acme'] },
      { id: fp.slice(0, 6) },
    );
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.dto.title).toBe('Disk full');
      expect(out.dto.short_id).toBe(fp.slice(0, 6));
    }
  });

  it('returns invalid_argument for short id', () => {
    const out = handleGetFinding(
      { db: seed(), graph: GRAPH, knownTenants: ['acme'] },
      { id: 'abc' },
    );
    expect(out.kind).toBe('invalid_argument');
  });

  it('returns not_found for unknown id', () => {
    const out = handleGetFinding(
      { db: seed(), graph: GRAPH, knownTenants: ['acme'] },
      { id: 'cafefe' },
    );
    expect(out.kind).toBe('not_found');
  });
});
