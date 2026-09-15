import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAgentContextFindings,
  getDigestFindings,
  getFindingByFingerprint,
  getFindingsForResource,
  getRecentFindings,
  pruneOldResolvedFindings,
  resolveUnseenFindings,
  searchFindings,
  upsertFinding,
} from './findings.js';
import { insertRun } from './runs.js';
import { openMemoryDb, type Db } from './schema.js';
import type { AgentFinding } from './types.js';

function sampleFinding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    resource_id: 'sql.acme.internal',
    issue_class: 'disk-pressure',
    severity: 'warn',
    title: 'Disk at 85% on sql.acme.internal',
    evidence: 'Used 85% of 1TB; growth ~0.3%/h.',
    ...overrides,
  };
}

describe('upsertFinding', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('inserts a new finding with state=new on first sighting', () => {
    const result = upsertFinding(db, runId, sampleFinding());
    expect(result.inserted).toBe(true);
    expect(result.state).toBe('new');
    const f = getFindingByFingerprint(db, result.fingerprint)!;
    expect(f.state).toBe('new');
    expect(f.severity).toBe('warn');
    expect(f.prev_severity).toBeNull();
    expect(f.run_count).toBe(1);
    expect(f.first_run_id).toBe(runId);
    expect(f.last_run_id).toBe(runId);
    expect(f.resource_id).toBe('sql.acme.internal');
  });

  it('transitions new → ongoing on re-sighting', () => {
    const first = upsertFinding(db, runId, sampleFinding());
    const run2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const second = upsertFinding(db, run2, sampleFinding({ severity: 'critical' }));
    expect(second.inserted).toBe(false);
    expect(second.state).toBe('ongoing');
    const f = getFindingByFingerprint(db, first.fingerprint)!;
    expect(f.state).toBe('ongoing');
    expect(f.severity).toBe('critical');
    expect(f.prev_severity).toBe('warn');
    expect(f.run_count).toBe(2);
    expect(f.first_run_id).toBe(runId);
    expect(f.last_run_id).toBe(run2);
  });

  it('transitions resolved → new on re-emergence, resetting first_seen and first_run_id', () => {
    const first = upsertFinding(db, runId, sampleFinding());
    // Force the finding resolved directly.
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now') WHERE fingerprint=?`,
    ).run(first.fingerprint);

    const run2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const second = upsertFinding(db, run2, sampleFinding());
    expect(second.state).toBe('new');
    const f = getFindingByFingerprint(db, first.fingerprint)!;
    expect(f.state).toBe('new');
    expect(f.resolved_at).toBeNull();
    expect(f.first_run_id).toBe(run2); // reset on re-emergence
    expect(f.last_run_id).toBe(run2);
    expect(f.run_count).toBe(2); // still monotonic
  });

  it('truncates evidence over 2000 chars', () => {
    const long = 'x'.repeat(5000);
    const result = upsertFinding(db, runId, sampleFinding({ evidence: long }));
    const f = getFindingByFingerprint(db, result.fingerprint)!;
    expect(f.evidence!.length).toBe(2000);
    expect(f.evidence!.endsWith('… [truncated]')).toBe(true);
  });

  it('canonicalizes resource_id before storing', () => {
    const result = upsertFinding(db, runId, sampleFinding({ resource_id: '  SQL.ACME.Internal:1433  ' }));
    const f = getFindingByFingerprint(db, result.fingerprint)!;
    expect(f.resource_id).toBe('sql.acme.internal');
  });

  it('different issue_class on the same resource creates a distinct finding', () => {
    const a = upsertFinding(db, runId, sampleFinding({ issue_class: 'disk-pressure' }));
    const b = upsertFinding(db, runId, sampleFinding({ issue_class: 'cert-expiry' }));
    expect(a.fingerprint).not.toBe(b.fingerprint);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM findings').get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it('updates title/evidence/likely_cause on re-sighting', () => {
    upsertFinding(db, runId, sampleFinding({ title: 'old', evidence: 'old-evidence' }));
    const run2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const r = upsertFinding(
      db,
      run2,
      sampleFinding({ title: 'new', evidence: 'new-evidence', likely_cause: 'aha' }),
    );
    const f = getFindingByFingerprint(db, r.fingerprint)!;
    expect(f.title).toBe('new');
    expect(f.evidence).toBe('new-evidence');
    expect(f.likely_cause).toBe('aha');
  });
});

describe('resolveUnseenFindings', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('marks findings not seen this run as resolved', () => {
    // A finding from yesterday.
    const older = upsertFinding(db, runId, sampleFinding());
    // Backdate last_seen_at to before today's run.
    db.prepare(
      `UPDATE findings SET last_seen_at = datetime('now', '-1 day') WHERE fingerprint = ?`,
    ).run(older.fingerprint);

    // Today's run started_at.
    const run2StartedAt = db
      .prepare(`SELECT datetime('now') AS t`)
      .get() as { t: string };
    const resolved = resolveUnseenFindings(db, run2StartedAt.t);
    expect(resolved).toBe(1);

    const f = getFindingByFingerprint(db, older.fingerprint)!;
    expect(f.state).toBe('resolved');
    expect(f.resolved_at).not.toBeNull();
  });

  it('leaves findings refreshed this run alone', () => {
    // Simulate a run started an hour ago.
    const longAgo = db
      .prepare(`SELECT datetime('now', '-1 hour') AS t`)
      .get() as { t: string };
    const runId2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    // Insert a finding right now (its last_seen_at > run2.started_at).
    const res = upsertFinding(db, runId2, sampleFinding());
    const resolved = resolveUnseenFindings(db, longAgo.t);
    expect(resolved).toBe(0);
    expect(getFindingByFingerprint(db, res.fingerprint)!.state).toBe('new');
  });

  it('does not touch already-resolved findings', () => {
    const r = upsertFinding(db, runId, sampleFinding());
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-2 days'), last_seen_at=datetime('now','-2 days') WHERE fingerprint=?`,
    ).run(r.fingerprint);
    const now = db.prepare(`SELECT datetime('now') AS t`).get() as { t: string };
    const resolved = resolveUnseenFindings(db, now.t);
    expect(resolved).toBe(0);
  });
});

describe('query helpers', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('getDigestFindings returns active + recently-resolved', () => {
    const a = upsertFinding(db, runId, sampleFinding({ resource_id: 'a' }));
    const b = upsertFinding(db, runId, sampleFinding({ resource_id: 'b' }));
    const c = upsertFinding(db, runId, sampleFinding({ resource_id: 'c' }));

    // a: ongoing (leave as-is after insert = 'new', also included)
    // b: resolved 3 days ago (included, within 7)
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-3 days') WHERE fingerprint=?`,
    ).run(b.fingerprint);
    // c: resolved 10 days ago (excluded from default 7-day digest window)
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-10 days') WHERE fingerprint=?`,
    ).run(c.fingerprint);

    const digest = getDigestFindings(db);
    const fps = digest.map((f) => f.fingerprint).sort();
    expect(fps).toEqual([a.fingerprint, b.fingerprint].sort());
  });

  it('getAgentContextFindings returns active + last 30 days seen', () => {
    const a = upsertFinding(db, runId, sampleFinding({ resource_id: 'a' }));
    const old = upsertFinding(db, runId, sampleFinding({ resource_id: 'old' }));
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-60 days'), last_seen_at=datetime('now','-60 days') WHERE fingerprint=?`,
    ).run(old.fingerprint);

    const ctx = getAgentContextFindings(db);
    const fps = ctx.map((f) => f.fingerprint);
    expect(fps).toContain(a.fingerprint);
    expect(fps).not.toContain(old.fingerprint);
  });

  it('getFindingsForResource finds by canonical resource_id', () => {
    upsertFinding(db, runId, sampleFinding({ resource_id: 'SQL.ACME.Internal' }));
    const found = getFindingsForResource(db, 'sql.acme.internal');
    expect(found).toHaveLength(1);
  });

  it('pruneOldResolvedFindings removes rows resolved beyond the cutoff', () => {
    const old = upsertFinding(db, runId, sampleFinding({ resource_id: 'old' }));
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-100 days') WHERE fingerprint=?`,
    ).run(old.fingerprint);
    const recent = upsertFinding(db, runId, sampleFinding({ resource_id: 'recent' }));
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-10 days') WHERE fingerprint=?`,
    ).run(recent.fingerprint);
    const removed = pruneOldResolvedFindings(db);
    expect(removed).toBe(1);
    expect(getFindingByFingerprint(db, old.fingerprint)).toBeNull();
    expect(getFindingByFingerprint(db, recent.fingerprint)).not.toBeNull();
  });

  it('pruneOldResolvedFindings does not touch active findings', () => {
    upsertFinding(db, runId, sampleFinding({ resource_id: 'still-active' }));
    expect(pruneOldResolvedFindings(db, 1)).toBe(0);
  });
});

describe('getRecentFindings', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  function seed(): { fp1: string; fp2: string; fp3: string; fp4: string } {
    const r1 = upsertFinding(db, runId, sampleFinding({ resource_id: 'r1', severity: 'critical' }));
    const r2 = upsertFinding(db, runId, sampleFinding({ resource_id: 'r2', severity: 'warn' }));
    const r3 = upsertFinding(db, runId, sampleFinding({ resource_id: 'r3', severity: 'info' }));
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-3 days') WHERE fingerprint=?`,
    ).run(r3.fingerprint);
    const r4 = upsertFinding(db, runId, sampleFinding({ resource_id: 'r4', severity: 'critical' }));
    db.prepare(
      `UPDATE findings SET state='resolved', resolved_at=datetime('now','-30 days') WHERE fingerprint=?`,
    ).run(r4.fingerprint);

    // Pin all last_seen_at so the severity-rank tiebreak is the deterministic ordering signal.
    db.prepare(`UPDATE findings SET last_seen_at='2026-05-04 10:00:00'`).run();

    db.prepare(
      `INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
       VALUES (?, NULL, datetime('now'), NULL, 'manual')`,
    ).run(r2.fingerprint);

    return { fp1: r1.fingerprint, fp2: r2.fingerprint, fp3: r3.fingerprint, fp4: r4.fingerprint };
  }

  it('default: active only, mutes filtered', () => {
    const { fp1 } = seed();
    const out = getRecentFindings(db, { limit: 20, includeResolved: false, includeMuted: false });
    expect(out.findings.map((f) => f.fingerprint)).toEqual([fp1]);
    expect(out.total).toBe(1);
  });

  it('includeMuted=true brings muted active back, severity-ranked', () => {
    const { fp1, fp2 } = seed();
    const out = getRecentFindings(db, { limit: 20, includeResolved: false, includeMuted: true });
    expect(out.findings.map((f) => f.fingerprint)).toEqual([fp1, fp2]);
    expect(out.total).toBe(2);
  });

  it('includeResolved=true adds r3 (within 7 days) but not r4 (>7 days)', () => {
    const { fp1, fp3 } = seed();
    const out = getRecentFindings(db, { limit: 20, includeResolved: true, includeMuted: false });
    expect(new Set(out.findings.map((f) => f.fingerprint))).toEqual(new Set([fp1, fp3]));
    expect(out.total).toBe(2);
  });

  it('limit caps the result; total reflects pre-limit count', () => {
    seed();
    const out = getRecentFindings(db, { limit: 1, includeResolved: true, includeMuted: true });
    expect(out.findings.length).toBe(1);
    expect(out.total).toBe(3);
  });

  it('orders by severity rank when last_seen_at ties (critical > warn > info)', () => {
    seed();
    const out = getRecentFindings(db, { limit: 20, includeResolved: true, includeMuted: true });
    expect(out.findings.length).toBe(3);
    expect(out.findings[0]!.severity).toBe('critical');
    expect(out.findings[1]!.severity).toBe('warn');
    expect(out.findings[2]!.severity).toBe('info');
  });
});

describe('searchFindings', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('matches title substring (case-insensitive)', () => {
    upsertFinding(db, runId, sampleFinding({ resource_id: 'r1', title: 'Disk at 95%' }));
    upsertFinding(db, runId, sampleFinding({ resource_id: 'r2', title: 'Cert expiring' }));
    expect(searchFindings(db, { q: 'disk', limit: 20 }).map((f) => f.resource_id)).toEqual(['r1']);
    expect(searchFindings(db, { q: 'DISK', limit: 20 }).map((f) => f.resource_id)).toEqual(['r1']);
    expect(searchFindings(db, { q: 'cert', limit: 20 }).map((f) => f.resource_id)).toEqual(['r2']);
  });

  it('matches resource_id substring', () => {
    upsertFinding(db, runId, sampleFinding({ resource_id: 'sql.acme.internal', title: 't' }));
    upsertFinding(db, runId, sampleFinding({ resource_id: 'web.acme.internal', title: 't' }));
    expect(searchFindings(db, { q: 'sql', limit: 20 }).map((f) => f.resource_id)).toEqual(['sql.acme.internal']);
  });

  it('returns empty for no match', () => {
    expect(searchFindings(db, { q: 'zzz', limit: 20 })).toEqual([]);
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      upsertFinding(db, runId, sampleFinding({ resource_id: `r${i}`, title: 'Disk full' }));
    }
    expect(searchFindings(db, { q: 'disk', limit: 3 }).length).toBe(3);
  });
});
