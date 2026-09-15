import { describe, expect, it } from 'vitest';
import { insertRun } from '../../../memory/runs.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleListRuns } from './list-runs.js';

describe('handleListRuns', () => {
  it('returns runs', () => {
    const db = openMemoryDb();
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    insertRun(db, { type: 'watch', trigger: 'webhook' });
    const out = handleListRuns({ db }, {});
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.runs.length).toBe(2);
  });

  it('filters by type', () => {
    const db = openMemoryDb();
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    insertRun(db, { type: 'watch', trigger: 'webhook' });
    const out = handleListRuns({ db }, { type: 'watch' });
    if (out.kind === 'ok') {
      expect(out.runs.every((r) => r.type === 'watch')).toBe(true);
    }
  });

  it('rejects bad limit', () => {
    const out = handleListRuns({ db: openMemoryDb() }, { limit: 1000 });
    expect(out.kind).toBe('invalid_argument');
  });
});
