import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../memory/fingerprint.js';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { applyMute, removeMute } from './mute-actions.js';

function seed(): { db: Db; fp1: string; fp2: string } {
  const db = openMemoryDb();
  const fp1 = fingerprint('r1', 'disk-pressure');
  const fp2 = fingerprint('r2', 'disk-pressure');
  const insert = (fp: string, resource: string): void => {
    db.prepare(
      `INSERT INTO findings
         (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
          first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
       VALUES (?, ?, 'disk-pressure', 'new', 'warn', 't', 'e', NULL,
               datetime('now'), datetime('now'), 1, 0, 0)`,
    ).run(fp, resource);
  };
  insert(fp1, 'r1');
  insert(fp2, 'r2');
  return { db, fp1, fp2 };
}

describe('applyMute', () => {
  it('inserts mute on unique id, indefinite by default', () => {
    const { db, fp1 } = seed();
    const out = applyMute(db, { id: fp1.slice(0, 6), reason: 'flapping' });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.fingerprint).toBe(fp1);
      expect(out.expires_at).toBeNull();
    }
  });

  it('honours valid duration', () => {
    const { db, fp1 } = seed();
    const out = applyMute(db, { id: fp1.slice(0, 6), duration: '7d' });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.expires_at).not.toBeNull();
    }
  });

  it('rejects unknown duration', () => {
    const { db, fp1 } = seed();
    const out = applyMute(db, { id: fp1.slice(0, 6), duration: 'bogus' });
    expect(out.kind).toBe('invalid_argument');
  });

  it('rejects too-short id', () => {
    const { db } = seed();
    const out = applyMute(db, { id: 'abc' });
    expect(out.kind).toBe('invalid_argument');
  });

  it('returns not_found for unknown id', () => {
    const { db } = seed();
    const out = applyMute(db, { id: 'cafefe' });
    expect(out.kind).toBe('not_found');
  });
});

describe('removeMute', () => {
  it('deletes existing mutes', () => {
    const { db, fp1 } = seed();
    applyMute(db, { id: fp1.slice(0, 6) });
    const out = removeMute(db, { id: fp1.slice(0, 6) });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.deleted_count).toBe(1);
    }
  });

  it('returns ok with zero count when no mute exists', () => {
    const { db, fp1 } = seed();
    const out = removeMute(db, { id: fp1.slice(0, 6) });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.deleted_count).toBe(0);
    }
  });
});
