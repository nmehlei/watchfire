import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendObservation,
  getBaselineWindow,
  getObservations,
  pruneOldObservations,
} from './observations.js';
import { insertRun } from './runs.js';
import { openMemoryDb, type Db } from './schema.js';

describe('observations', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('appendObservation stores a sample and returns its id', () => {
    const id = appendObservation(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 'public',
      metric: 'response_ms',
      value: 123.4,
      runId,
    });
    expect(id).toBeGreaterThan(0);
  });

  it('getBaselineWindow returns recent values newest-first', () => {
    for (const v of [10, 20, 30]) {
      appendObservation(db, {
        tenant: 'acme',
        source: 'check-http',
        subject: 'public',
        metric: 'response_ms',
        value: v,
        runId,
      });
    }
    const values = getBaselineWindow(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 'public',
      metric: 'response_ms',
    });
    expect(values).toHaveLength(3);
    // Newest-first; all inserted in the same second, so order among equal
    // timestamps is by id DESC, which matches insertion order reversed.
    expect(values).toEqual([30, 20, 10]);
  });

  it('getBaselineWindow filters by tenant/source/subject/metric', () => {
    appendObservation(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 'api',
      metric: 'response_ms',
      value: 100,
      runId,
    });
    appendObservation(db, {
      tenant: 'other',
      source: 'check-http',
      subject: 'api',
      metric: 'response_ms',
      value: 999,
      runId,
    });
    const values = getBaselineWindow(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 'api',
      metric: 'response_ms',
    });
    expect(values).toEqual([100]);
  });

  it('getObservations returns full rows', () => {
    appendObservation(db, {
      tenant: 'acme',
      source: 'check-ssl',
      subject: 'acme.example',
      metric: 'days_until_expiry',
      value: 28,
      runId,
    });
    const rows = getObservations(db, {
      tenant: 'acme',
      source: 'check-ssl',
      subject: 'acme.example',
      metric: 'days_until_expiry',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.run_id).toBe(runId);
    expect(rows[0]!.observed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('pruneOldObservations deletes past the cutoff', () => {
    const id = appendObservation(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 'x',
      metric: 'response_ms',
      value: 50,
      runId,
    });
    db.prepare(`UPDATE observations SET observed_at = datetime('now', '-45 days') WHERE id = ?`).run(
      id,
    );
    expect(pruneOldObservations(db, 30)).toBe(1);
  });

  it('pruneOldObservations leaves recent samples alone', () => {
    appendObservation(db, {
      tenant: 'acme',
      source: 'check-http',
      subject: 'x',
      metric: 'response_ms',
      value: 50,
      runId,
    });
    expect(pruneOldObservations(db, 30)).toBe(0);
  });
});
