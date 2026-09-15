import type { Db } from './schema.js';
import type { Mute, MuteSource } from './types.js';

export interface InsertMuteInput {
  fingerprint: string;
  reason?: string | null;
  /** Absolute ISO 8601 timestamp; null/undefined = indefinite. */
  expiresAt?: string | null;
  source: MuteSource;
}

/** Active mute row joined with the matching finding. */
export interface ActiveMute extends Mute {
  finding_title: string | null;
  finding_resource_id: string | null;
}

/** True iff at least one mute row covers this fingerprint and hasn't expired. */
export function isMuted(db: Db, fingerprint: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM mutes
        WHERE fingerprint = ?
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        LIMIT 1`,
    )
    .get(fingerprint) as { 1: number } | undefined;
  return row !== undefined;
}

/** Set of fingerprints with an active mute. Used by digest filtering. */
export function getActiveMutedFingerprints(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT fingerprint FROM mutes
        WHERE expires_at IS NULL OR expires_at > datetime('now')`,
    )
    .all() as Array<{ fingerprint: string }>;
  return new Set(rows.map((r) => r.fingerprint));
}

/**
 * Resolve a short ID (4–64 hex chars, lowercased) against findings.fingerprint.
 * Returns matching fingerprints up to `limit`.
 */
export function resolveFingerprintByPrefix(db: Db, prefix: string, limit = 5): string[] {
  const rows = db
    .prepare(
      `SELECT fingerprint FROM findings
        WHERE fingerprint LIKE ? || '%'
        ORDER BY last_seen_at DESC
        LIMIT ?`,
    )
    .all(prefix, limit) as Array<{ fingerprint: string }>;
  return rows.map((r) => r.fingerprint);
}

/** List active mutes with their matched finding's title + resource_id. */
export function listActiveMutes(db: Db, limit = 50): ActiveMute[] {
  return db
    .prepare(
      `SELECT m.id, m.fingerprint, m.reason, m.created_at, m.expires_at, m.source,
              f.title       AS finding_title,
              f.resource_id AS finding_resource_id
         FROM mutes m
         LEFT JOIN findings f ON f.fingerprint = m.fingerprint
        WHERE m.expires_at IS NULL OR m.expires_at > datetime('now')
        ORDER BY (m.expires_at IS NULL) DESC, m.expires_at ASC, m.created_at DESC
        LIMIT ?`,
    )
    .all(limit) as ActiveMute[];
}

export function insertMute(db: Db, input: InsertMuteInput): number {
  const result = db
    .prepare(
      `INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
       VALUES (?, ?, datetime('now'), ?, ?)`,
    )
    .run(input.fingerprint, input.reason ?? null, input.expiresAt ?? null, input.source);
  return result.lastInsertRowid as number;
}

/** Delete all mute rows (active and expired) for a fingerprint. Returns row count. */
export function deleteMutesByFingerprint(db: Db, fingerprint: string): number {
  const result = db.prepare('DELETE FROM mutes WHERE fingerprint = ?').run(fingerprint);
  return result.changes;
}

/** Retention sweep helper — delete expired rows. */
export function pruneExpiredMutes(db: Db): number {
  const result = db
    .prepare(`DELETE FROM mutes WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`)
    .run();
  return result.changes;
}
