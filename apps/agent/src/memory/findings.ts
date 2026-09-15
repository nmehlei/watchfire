import { canonicalizeResourceId, fingerprint } from './fingerprint.js';
import type { Db } from './schema.js';
import type { AgentFinding, Finding, FindingState } from './types.js';

const EVIDENCE_LIMIT = 2000;
const EVIDENCE_TRUNCATE_SUFFIX = '… [truncated]';

function truncateEvidence(s: string): string {
  if (s.length <= EVIDENCE_LIMIT) return s;
  return s.slice(0, EVIDENCE_LIMIT - EVIDENCE_TRUNCATE_SUFFIX.length) + EVIDENCE_TRUNCATE_SUFFIX;
}

export interface UpsertResult {
  fingerprint: string;
  state: FindingState;
  /** true if this call created a brand-new row (vs. updating an existing one). */
  inserted: boolean;
}

/**
 * Insert or update a finding by (resource_id, issue_class) fingerprint.
 * Transition semantics per specs/06-memory.md §Lifecycle.
 *
 * Runs in an IMMEDIATE transaction.
 */
export function upsertFinding(db: Db, runId: number, finding: AgentFinding): UpsertResult {
  const fp = fingerprint(finding.resource_id, finding.issue_class);
  const canonical = canonicalizeResourceId(finding.resource_id);
  const evidence = truncateEvidence(finding.evidence);
  const likelyCause = finding.likely_cause ?? null;

  const tx = db.transaction((): UpsertResult => {
    const existing = db
      .prepare('SELECT * FROM findings WHERE fingerprint = ?')
      .get(fp) as Finding | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO findings
           (fingerprint, resource_id, issue_class, state, severity, prev_severity,
            title, evidence, likely_cause,
            first_seen_at, last_seen_at, resolved_at, run_count,
            first_run_id, last_run_id)
         VALUES (?, ?, ?, 'new', ?, NULL,
                 ?, ?, ?,
                 datetime('now'), datetime('now'), NULL, 1,
                 ?, ?)`,
      ).run(
        fp,
        canonical,
        finding.issue_class,
        finding.severity,
        finding.title,
        evidence,
        likelyCause,
        runId,
        runId,
      );
      return { fingerprint: fp, state: 'new', inserted: true };
    }

    const wasResolved = existing.state === 'resolved';
    const newState: FindingState = wasResolved ? 'new' : 'ongoing';

    if (wasResolved) {
      db.prepare(
        `UPDATE findings
            SET state         = 'new',
                severity      = ?,
                prev_severity = ?,
                title         = ?,
                evidence      = ?,
                likely_cause  = ?,
                first_seen_at = datetime('now'),
                last_seen_at  = datetime('now'),
                resolved_at   = NULL,
                run_count     = run_count + 1,
                first_run_id  = ?,
                last_run_id   = ?
          WHERE fingerprint   = ?`,
      ).run(
        finding.severity,
        existing.severity,
        finding.title,
        evidence,
        likelyCause,
        runId,
        runId,
        fp,
      );
    } else {
      db.prepare(
        `UPDATE findings
            SET state         = 'ongoing',
                severity      = ?,
                prev_severity = ?,
                title         = ?,
                evidence      = ?,
                likely_cause  = ?,
                last_seen_at  = datetime('now'),
                resolved_at   = NULL,
                run_count     = run_count + 1,
                last_run_id   = ?
          WHERE fingerprint   = ?`,
      ).run(
        finding.severity,
        existing.severity,
        finding.title,
        evidence,
        likelyCause,
        runId,
        fp,
      );
    }

    return { fingerprint: fp, state: newState, inserted: false };
  });

  return tx.immediate();
}

/**
 * Resolution sweep — nightly-only. Marks findings whose last_seen_at predates
 * the run's started_at as resolved. Time-bounded rather than set-bounded so
 * concurrent watch writes correctly protect refreshed findings (spec 06).
 *
 * Returns the number of findings resolved.
 */
export function resolveUnseenFindings(db: Db, runStartedAt: string): number {
  const result = db
    .prepare(
      `UPDATE findings
          SET state = 'resolved',
              resolved_at = datetime('now')
        WHERE state IN ('new', 'ongoing')
          AND last_seen_at < ?`,
    )
    .run(runStartedAt);
  return result.changes;
}

export function getFindingByFingerprint(db: Db, fp: string): Finding | null {
  const row = db.prepare('SELECT * FROM findings WHERE fingerprint = ?').get(fp) as
    | Finding
    | undefined;
  return row ?? null;
}

export function getFindingsForResource(db: Db, resourceId: string): Finding[] {
  const canonical = canonicalizeResourceId(resourceId);
  return db
    .prepare('SELECT * FROM findings WHERE resource_id = ? ORDER BY last_seen_at DESC')
    .all(canonical) as Finding[];
}

/**
 * Seed context for the nightly agent prompt (specs/06-memory.md §Query patterns).
 * Returns active findings plus anything seen in the last `sinceDays`.
 */
export function getAgentContextFindings(db: Db, sinceDays = 30): Finding[] {
  return db
    .prepare(
      `SELECT * FROM findings
        WHERE state IN ('new', 'ongoing')
           OR last_seen_at > datetime('now', ?)
        ORDER BY last_seen_at DESC`,
    )
    .all(`-${sinceDays} days`) as Finding[];
}

/**
 * Digest composition: active findings plus recently-resolved.
 * Ordering is a display concern, left to the caller (spec 07).
 */
export function getDigestFindings(db: Db, resolvedWithinDays = 7): Finding[] {
  return db
    .prepare(
      `SELECT * FROM findings
        WHERE state IN ('new', 'ongoing')
           OR (state = 'resolved' AND resolved_at > datetime('now', ?))`,
    )
    .all(`-${resolvedWithinDays} days`) as Finding[];
}

export interface RecentFindingsQuery {
  /** 1..50, validated by caller. */
  limit: number;
  includeResolved: boolean;
  includeMuted: boolean;
  /** Resolved-within-N-days window. Default 7 (matches digest cutoff per specs/06+07). */
  resolvedWithinDays?: number;
}

export interface RecentFindingsResult {
  findings: Finding[];
  /** Count matching the filter, before `limit` is applied. */
  total: number;
}

/**
 * Spec 11 §recent_findings selection. Active findings (state ∈ new|ongoing) by
 * default; with `includeResolved`, also include rows resolved within the last
 * N days. Muted fingerprints are excluded unless `includeMuted=true`. Ordered
 * by `last_seen_at DESC` then severity rank DESC so a string-DESC sort doesn't
 * place 'warn' before 'critical'.
 */
export function getRecentFindings(db: Db, query: RecentFindingsQuery): RecentFindingsResult {
  const within = query.resolvedWithinDays ?? 7;
  const stateClause = query.includeResolved
    ? `(state IN ('new','ongoing') OR (state = 'resolved' AND resolved_at > datetime('now', ?)))`
    : `state IN ('new','ongoing')`;
  const muteClause = query.includeMuted
    ? ''
    : ` AND fingerprint NOT IN (SELECT fingerprint FROM mutes
                                 WHERE expires_at IS NULL OR expires_at > datetime('now'))`;

  const sevRank = `CASE severity WHEN 'critical' THEN 2 WHEN 'warn' THEN 1 ELSE 0 END`;
  const where = `WHERE ${stateClause}${muteClause}`;

  const params: unknown[] = [];
  if (query.includeResolved) params.push(`-${within} days`);

  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM findings ${where}`)
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      `SELECT * FROM findings ${where}
       ORDER BY last_seen_at DESC, ${sevRank} DESC
       LIMIT ?`,
    )
    .all(...params, query.limit) as Finding[];

  return { findings: rows, total: totalRow.c };
}

export interface SearchFindingsQuery {
  q: string;
  limit: number;
}

/**
 * LIKE-based search across `title` and `resource_id`, case-insensitive.
 * Spec 11 §search_findings — scope intentionally narrow (no evidence body).
 */
export function searchFindings(db: Db, query: SearchFindingsQuery): Finding[] {
  const pattern = `%${query.q.toLowerCase()}%`;
  return db
    .prepare(
      `SELECT * FROM findings
        WHERE LOWER(title) LIKE ? OR LOWER(resource_id) LIKE ?
        ORDER BY last_seen_at DESC
        LIMIT ?`,
    )
    .all(pattern, pattern, query.limit) as Finding[];
}

export function pruneOldResolvedFindings(db: Db, days = 90): number {
  const result = db
    .prepare(
      `DELETE FROM findings
        WHERE state = 'resolved'
          AND resolved_at < datetime('now', ?)`,
    )
    .run(`-${days} days`);
  return result.changes;
}
