import { beforeEach, describe, expect, it } from 'vitest';
import { upsertFinding } from './findings.js';
import {
  deleteMutesByFingerprint,
  getActiveMutedFingerprints,
  insertMute,
  isMuted,
  listActiveMutes,
  pruneExpiredMutes,
  resolveFingerprintByPrefix,
} from './mutes.js';
import { insertRun } from './runs.js';
import { openMemoryDb, type Db } from './schema.js';

function seedFinding(db: Db, runId: number, resource: string, issue = 'disk-pressure' as const): string {
  const f = upsertFinding(db, runId, {
    resource_id: resource,
    issue_class: issue,
    severity: 'warn',
    title: `title for ${resource}`,
    evidence: 'e',
  });
  return f.fingerprint;
}

describe('mutes', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('isMuted false by default; true after insert; respects expiry', () => {
    const fp = seedFinding(db, runId, 'sql.acme');
    expect(isMuted(db, fp)).toBe(false);

    insertMute(db, { fingerprint: fp, source: 'telegram', expiresAt: null });
    expect(isMuted(db, fp)).toBe(true);

    deleteMutesByFingerprint(db, fp);
    insertMute(db, {
      fingerprint: fp,
      source: 'telegram',
      // already expired
      expiresAt: new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19),
    });
    expect(isMuted(db, fp)).toBe(false);
  });

  it('multiple stacked rows: any active row keeps it muted', () => {
    const fp = seedFinding(db, runId, 'sql.acme');
    insertMute(db, {
      fingerprint: fp,
      source: 'telegram',
      expiresAt: new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19),
    });
    insertMute(db, { fingerprint: fp, source: 'telegram', expiresAt: null });
    expect(isMuted(db, fp)).toBe(true);
  });

  it('getActiveMutedFingerprints returns just the active set', () => {
    const a = seedFinding(db, runId, 'a.acme');
    const b = seedFinding(db, runId, 'b.acme');
    const c = seedFinding(db, runId, 'c.acme');
    insertMute(db, { fingerprint: a, source: 'telegram', expiresAt: null });
    insertMute(db, { fingerprint: b, source: 'telegram', expiresAt: null });
    insertMute(db, {
      fingerprint: c,
      source: 'telegram',
      expiresAt: new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19),
    });
    const set = getActiveMutedFingerprints(db);
    expect(set.has(a)).toBe(true);
    expect(set.has(b)).toBe(true);
    expect(set.has(c)).toBe(false);
  });

  it('resolveFingerprintByPrefix returns matches', () => {
    const fp = seedFinding(db, runId, 'sql.acme');
    const prefix = fp.slice(0, 6);
    expect(resolveFingerprintByPrefix(db, prefix)).toEqual([fp]);
    expect(resolveFingerprintByPrefix(db, 'deadbeefcafe')).toEqual([]);
  });

  it('listActiveMutes joins finding title', () => {
    const fp = seedFinding(db, runId, 'sql.acme');
    insertMute(db, { fingerprint: fp, source: 'telegram', expiresAt: null, reason: 'r' });
    const rows = listActiveMutes(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fingerprint).toBe(fp);
    expect(rows[0]?.finding_title).toBe('title for sql.acme');
    expect(rows[0]?.reason).toBe('r');
  });

  it('pruneExpiredMutes removes only expired rows', () => {
    const fp = seedFinding(db, runId, 'sql.acme');
    insertMute(db, {
      fingerprint: fp,
      source: 'telegram',
      expiresAt: new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19),
    });
    insertMute(db, { fingerprint: fp, source: 'telegram', expiresAt: null });
    const removed = pruneExpiredMutes(db);
    expect(removed).toBe(1);
    expect(isMuted(db, fp)).toBe(true);
  });
});
