import { beforeEach, describe, expect, it } from 'vitest';
import { upsertFinding } from './findings.js';
import { appendObservation } from './observations.js';
import { pruneOldData } from './retention.js';
import { insertRun } from './runs.js';
import { openMemoryDb, type Db } from './schema.js';

describe('pruneOldData', () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
  });

  it('runs all three sweeps and returns counts', () => {
    const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });

    // Old resolved finding.
    const f = upsertFinding(db, runId, {
      resource_id: 'a',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-100 days') WHERE fingerprint=?`,
    ).run(f.fingerprint);

    // Old observation.
    const obsId = appendObservation(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 's',
      metric: 'response_ms',
      value: 1,
      runId,
    });
    db.prepare(`UPDATE observations SET observed_at=datetime('now','-45 days') WHERE id=?`).run(obsId);

    // Old run row.
    const oldRun = insertRun(db, { type: 'nightly', trigger: 'cron' });
    db.prepare(`UPDATE runs SET started_at=datetime('now','-400 days') WHERE id=?`).run(oldRun);

    const result = pruneOldData(db);
    expect(result.findingsDeleted).toBe(1);
    expect(result.observationsDeleted).toBe(1);
    expect(result.runsDeleted).toBe(1);
  });

  it('respects custom retention config', () => {
    const runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const f = upsertFinding(db, runId, {
      resource_id: 'a',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-10 days') WHERE fingerprint=?`,
    ).run(f.fingerprint);

    // Default 90 days wouldn't prune; setting to 7 should.
    const result = pruneOldData(db, { findingsDays: 7 });
    expect(result.findingsDeleted).toBe(1);
  });

  it('returns zeros when nothing to prune', () => {
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    const result = pruneOldData(db);
    expect(result).toEqual({
      findingsDeleted: 0,
      mutesDeleted: 0,
      observationsDeleted: 0,
      runsDeleted: 0,
    });
  });
});
