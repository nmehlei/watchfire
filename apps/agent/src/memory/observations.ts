import type { Db } from './schema.js';
import type { Observation } from './types.js';

export interface AppendObservationInput {
  tenant: string;
  source: string;
  subject: string;
  metric: string;
  value: number;
  runId: number;
}

/** Append an observation. observed_at from datetime('now') on the DB host. */
export function appendObservation(db: Db, input: AppendObservationInput): number {
  const result = db
    .prepare(
      `INSERT INTO observations (tenant, source, subject, metric, value, observed_at, run_id)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
    )
    .run(input.tenant, input.source, input.subject, input.metric, input.value, input.runId);
  return Number(result.lastInsertRowid);
}

export interface BaselineWindowQuery {
  tenant: string;
  source: string;
  subject: string;
  metric: string;
  sinceDays?: number;
}

/**
 * Raw sample window. Callers compute p50/p95/stddev/etc. themselves
 * (specs/06-memory.md — "aggregation at read time").
 * Returns values newest-first.
 */
export function getBaselineWindow(db: Db, q: BaselineWindowQuery): number[] {
  const days = q.sinceDays ?? 30;
  const rows = db
    .prepare(
      `SELECT value FROM observations
        WHERE tenant = ? AND source = ? AND subject = ? AND metric = ?
          AND observed_at > datetime('now', ?)
        ORDER BY observed_at DESC, id DESC`,
    )
    .all(q.tenant, q.source, q.subject, q.metric, `-${days} days`) as Array<{ value: number }>;
  return rows.map((r) => r.value);
}

/** Debug / audit helper — returns full rows in the window. */
export function getObservations(db: Db, q: BaselineWindowQuery): Observation[] {
  const days = q.sinceDays ?? 30;
  return db
    .prepare(
      `SELECT * FROM observations
        WHERE tenant = ? AND source = ? AND subject = ? AND metric = ?
          AND observed_at > datetime('now', ?)
        ORDER BY observed_at DESC, id DESC`,
    )
    .all(q.tenant, q.source, q.subject, q.metric, `-${days} days`) as Observation[];
}

export function pruneOldObservations(db: Db, days = 30): number {
  const result = db
    .prepare(`DELETE FROM observations WHERE observed_at < datetime('now', ?)`)
    .run(`-${days} days`);
  return result.changes;
}
