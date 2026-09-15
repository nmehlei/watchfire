import { describe, expect, it } from 'vitest';
import { upsertFinding } from '../../../memory/findings.js';
import { insertRun } from '../../../memory/runs.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleSearchFindings } from './search-findings.js';

const GRAPH = { resources: [] };

describe('handleSearchFindings', () => {
  it('returns matches', () => {
    const db = openMemoryDb();
    const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
    upsertFinding(db, runId, {
      resource_id: 'r1', issue_class: 'disk-pressure', severity: 'warn',
      title: 'Disk full', evidence: 'e',
    });
    const out = handleSearchFindings({ db, graph: GRAPH, knownTenants: [] }, { q: 'disk' });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.findings.length).toBe(1);
  });

  it('rejects empty q', () => {
    const out = handleSearchFindings(
      { db: openMemoryDb(), graph: GRAPH, knownTenants: [] },
      { q: '' },
    );
    expect(out.kind).toBe('invalid_argument');
  });

  it('rejects bad limit', () => {
    const out = handleSearchFindings(
      { db: openMemoryDb(), graph: GRAPH, knownTenants: [] },
      { q: 'x', limit: 999 },
    );
    expect(out.kind).toBe('invalid_argument');
  });
});
