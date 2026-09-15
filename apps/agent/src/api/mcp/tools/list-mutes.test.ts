import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../../memory/fingerprint.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleListMutes } from './list-mutes.js';

describe('handleListMutes', () => {
  it('returns active mutes', () => {
    const db = openMemoryDb();
    const fp = fingerprint('r1', 'disk-pressure');
    db.prepare(
      `INSERT INTO findings
         (fingerprint, resource_id, issue_class, state, severity, title, evidence, likely_cause,
          first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
       VALUES (?, 'r1', 'disk-pressure', 'new', 'warn', 't', 'e', NULL,
               datetime('now'), datetime('now'), 1, 0, 0)`,
    ).run(fp);
    db.prepare(
      `INSERT INTO mutes (fingerprint, reason, created_at, expires_at, source)
       VALUES (?, NULL, datetime('now'), NULL, 'manual')`,
    ).run(fp);
    const out = handleListMutes({ db });
    expect(out.kind).toBe('ok');
    expect(out.mutes.length).toBe(1);
  });
});
