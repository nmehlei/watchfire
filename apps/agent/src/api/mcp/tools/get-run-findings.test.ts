import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../../../config/types.js';
import { upsertFinding } from '../../../memory/findings.js';
import { insertRun } from '../../../memory/runs.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleGetRunFindings } from './get-run-findings.js';

const GRAPH: ResourceGraph = {
  resources: [{ id: 'r1', type: 'mssql-server', owner: 'acme', affects: ['acme'] }],
};

describe('handleGetRunFindings', () => {
  it('returns findings touched by the run', () => {
    const db = openMemoryDb();
    const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
    upsertFinding(db, runId, {
      resource_id: 'r1', issue_class: 'disk-pressure', severity: 'warn',
      title: 't', evidence: 'e',
    });
    const out = handleGetRunFindings({ db, graph: GRAPH, knownTenants: ['acme'] }, { id: runId });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.findings.length).toBe(1);
      expect(out.findings[0]!.resource_id).toBe('r1');
    }
  });

  it('invalid_argument for bad id', () => {
    const out = handleGetRunFindings(
      { db: openMemoryDb(), graph: GRAPH, knownTenants: ['acme'] },
      { id: 0 },
    );
    expect(out.kind).toBe('invalid_argument');
  });
});
