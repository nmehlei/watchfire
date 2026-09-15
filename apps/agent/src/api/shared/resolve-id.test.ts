import { describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../../memory/schema.js';
import { normalizeShortId, resolveShortId } from './resolve-id.js';

function seedDb(): Db {
  const db = openMemoryDb();
  const insert = (fp: string, resource: string): void => {
    db.prepare(
      `INSERT INTO findings
         (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
          first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
       VALUES (?, ?, 'disk-pressure', 'new', 'warn', 't', 'e', NULL,
               datetime('now'), datetime('now'), 1, 0, 0)`,
    ).run(fp, resource);
  };
  insert('a'.repeat(64), 'r1');
  insert('a'.repeat(63) + 'b', 'r2');
  return db;
}

describe('normalizeShortId', () => {
  it('lowercases, trims, strips html tags', () => {
    expect(normalizeShortId('  <code>ABCdef</code>  ')).toBe('abcdef');
  });
});

describe('resolveShortId', () => {
  it('returns invalid for non-hex', () => {
    const db = seedDb();
    expect(resolveShortId(db, 'zzzz').kind).toBe('invalid');
  });

  it('rejects below default minHex (4)', () => {
    const db = seedDb();
    expect(resolveShortId(db, 'ab').kind).toBe('invalid');
  });

  it('rejects below minHex when API uses 6', () => {
    const db = seedDb();
    expect(resolveShortId(db, 'aaaa', { minHex: 6 }).kind).toBe('invalid');
    expect(resolveShortId(db, 'aaaaaa', { minHex: 6 }).kind).not.toBe('invalid');
  });

  it('returns none when no row matches', () => {
    const db = seedDb();
    expect(resolveShortId(db, 'cafe').kind).toBe('none');
  });

  it('returns unique on a long-enough match', () => {
    const db = seedDb();
    const r = resolveShortId(db, 'a'.repeat(64));
    expect(r.kind).toBe('unique');
    if (r.kind === 'unique') expect(r.fingerprint).toBe('a'.repeat(64));
  });

  it('returns ambiguous when prefix matches several', () => {
    const db = seedDb();
    const r = resolveShortId(db, 'aaaa');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.length).toBe(2);
  });
});
