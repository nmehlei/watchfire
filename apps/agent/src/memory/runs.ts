import type { Db } from './schema.js';
import type { Finding, Run, RunStatus, RunTrigger, RunType, WatchVerdict } from './types.js';

export interface InsertRunInput {
  type: RunType;
  trigger: RunTrigger;
}

/** Insert a new run row. started_at comes from datetime('now') on the DB host. */
export function insertRun(db: Db, input: InsertRunInput): number {
  const result = db
    .prepare(`INSERT INTO runs (type, trigger, started_at) VALUES (?, ?, datetime('now'))`)
    .run(input.type, input.trigger);
  return Number(result.lastInsertRowid);
}

export interface CompleteRunInput {
  status: RunStatus;
  verdict?: WatchVerdict | null;
  pageSent?: boolean | null;
  findingCount: number;
  turnCount?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  tokensCached?: number | null;
  costEur?: number | null;
  transcriptPath?: string | null;
  error?: string | null;
}

/** Finalize a run. completed_at comes from datetime('now') on the DB host. */
export function completeRun(db: Db, runId: number, input: CompleteRunInput): void {
  db.prepare(
    `UPDATE runs
        SET completed_at    = datetime('now'),
            status          = ?,
            verdict         = ?,
            page_sent       = ?,
            finding_count   = ?,
            turn_count      = ?,
            tokens_in       = ?,
            tokens_out      = ?,
            tokens_cached   = ?,
            cost_eur        = ?,
            error           = ?,
            transcript_path = ?
      WHERE id = ?`,
  ).run(
    input.status,
    input.verdict ?? null,
    input.pageSent == null ? null : input.pageSent ? 1 : 0,
    input.findingCount,
    input.turnCount ?? null,
    input.tokensIn ?? null,
    input.tokensOut ?? null,
    input.tokensCached ?? null,
    input.costEur ?? null,
    input.error ?? null,
    input.transcriptPath ?? null,
    runId,
  );
}

export function getRun(db: Db, id: number): Run | null {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run | undefined;
  return row ?? null;
}

/** Mark all unfinished rows as crashed. Call once at startup. Returns row count. */
export function markCrashedOnStartup(db: Db): number {
  const result = db
    .prepare(`UPDATE runs SET status='crashed' WHERE completed_at IS NULL AND status IS NULL`)
    .run();
  return result.changes;
}

/**
 * MAX(started_at) of the most recent nightly that produced a digest
 * (status='success' or 'truncated'). Used by startup catch-up.
 */
export function getLastSweptNightlyAt(db: Db): string | null {
  const row = db
    .prepare(
      `SELECT MAX(started_at) AS t FROM runs
        WHERE type='nightly' AND status IN ('success','truncated')`,
    )
    .get() as { t: string | null };
  return row.t;
}

/**
 * Page-activity-window query (specs/06-memory.md). Counts watch runs
 * where the agent voted 'page' AND a Telegram message actually went out.
 */
export function countRecentPages(db: Db, sinceMinutes = 60): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM runs
        WHERE type='watch' AND verdict='page' AND page_sent=1
          AND started_at > datetime('now', ?)`,
    )
    .get(`-${sinceMinutes} minutes`) as { n: number };
  return row.n;
}

export interface SuppressedPagesWindow {
  count: number;
  windowStart: string | null;
  windowEnd: string | null;
}

/**
 * Suppressed-pages-window query (specs/06-memory.md). The nightly digest
 * composer reads this to render the "N pages were suppressed" header.
 */
export function countSuppressedPages(db: Db, sinceHours = 24): SuppressedPagesWindow {
  const row = db
    .prepare(
      `SELECT COUNT(*)        AS count,
              MIN(started_at)  AS windowStart,
              MAX(started_at)  AS windowEnd
         FROM runs
        WHERE type='watch' AND verdict='page' AND page_sent=0
          AND started_at > datetime('now', ?)`,
    )
    .get(`-${sinceHours} hours`) as SuppressedPagesWindow;
  return row;
}

/** Retention sweep for runs. Returns rows deleted. */
export function pruneOldRuns(db: Db, days = 365): number {
  const result = db
    .prepare(`DELETE FROM runs WHERE started_at < datetime('now', ?)`)
    .run(`-${days} days`);
  return result.changes;
}

export interface RunsRecentQuery {
  type?: RunType;
  limit?: number;
}

const RUNS_DEFAULT_LIMIT = 20;
const RUNS_MAX_LIMIT = 50;

export function getRunsRecent(db: Db, query: RunsRecentQuery): Run[] {
  const limit = Math.min(query.limit ?? RUNS_DEFAULT_LIMIT, RUNS_MAX_LIMIT);
  const sql = query.type
    ? `SELECT * FROM runs WHERE type = ? ORDER BY started_at DESC, id DESC LIMIT ?`
    : `SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT ?`;
  return query.type
    ? (db.prepare(sql).all(query.type, limit) as Run[])
    : (db.prepare(sql).all(limit) as Run[]);
}

export function getRunFindings(db: Db, runId: number): Finding[] {
  return db
    .prepare(
      `SELECT * FROM findings
        WHERE first_run_id = ? OR last_run_id = ?
        ORDER BY last_seen_at DESC`,
    )
    .all(runId, runId) as Finding[];
}

export interface CostWindowQuery {
  days: number;
}

export interface CostWindowResult {
  total_eur: number;
  by_type: { nightly: number; watch: number; manual: number };
  daily_buckets: Array<{ date: string; eur: number }>;
}

export function getCostWindow(db: Db, query: CostWindowQuery): CostWindowResult {
  const since = `-${query.days} days`;
  const totalRow = db
    .prepare(
      `SELECT COALESCE(SUM(cost_eur), 0) AS total
         FROM runs
        WHERE started_at > datetime('now', ?)`,
    )
    .get(since) as { total: number };

  const byTypeRows = db
    .prepare(
      `SELECT type, COALESCE(SUM(cost_eur), 0) AS eur
         FROM runs
        WHERE started_at > datetime('now', ?)
        GROUP BY type`,
    )
    .all(since) as Array<{ type: RunType; eur: number }>;

  const by_type = { nightly: 0, watch: 0, manual: 0 };
  for (const row of byTypeRows) by_type[row.type] = row.eur;

  const buckets = db
    .prepare(
      `SELECT DATE(started_at) AS date, COALESCE(SUM(cost_eur), 0) AS eur
         FROM runs
        WHERE started_at > datetime('now', ?)
        GROUP BY DATE(started_at)
        ORDER BY date ASC`,
    )
    .all(since) as Array<{ date: string; eur: number }>;

  return { total_eur: totalRow.total, by_type, daily_buckets: buckets };
}
